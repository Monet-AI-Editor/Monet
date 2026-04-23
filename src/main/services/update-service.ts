export type AppUpdateStatus = 'idle' | 'available' | 'downloading' | 'downloaded' | 'restarting' | 'error'

export interface AppUpdateState {
  status: AppUpdateStatus
  availableVersion: string | null
  currentVersion: string
  source: 'none' | 'dev-simulated' | 'github-release'
  message?: string
  downloadProgress: number | null
}

interface GitHubReleaseAsset {
  name: string
  browser_download_url: string
}

interface GitHubLatestReleaseResponse {
  tag_name: string
  html_url: string
  draft: boolean
  prerelease: boolean
  assets: GitHubReleaseAsset[]
}

export interface GitHubReleaseInfo {
  version: string
  htmlUrl: string
  zipUrl: string | null
}

interface UpdateServiceOptions {
  owner: string
  repo: string
}

type Listener = (state: AppUpdateState) => void

export class UpdateService {
  private listeners = new Set<Listener>()

  private state: AppUpdateState

  private readonly owner: string

  private readonly repo: string

  private devSimulationArmed = false

  private transitionTimer: NodeJS.Timeout | null = null

  private latestRelease: GitHubReleaseInfo | null = null

  private inflightCheck: Promise<AppUpdateState> | null = null

  constructor(currentVersion: string, options: UpdateServiceOptions) {
    this.owner = options.owner
    this.repo = options.repo
    this.state = {
      status: 'idle',
      availableVersion: null,
      currentVersion,
      source: 'none',
      downloadProgress: null
    }
  }

  getState(): AppUpdateState {
    return { ...this.state }
  }

  getLatestRelease(): GitHubReleaseInfo | null {
    return this.latestRelease
  }

  setDownloadProgress(progress: number): void {
    this.state = { ...this.state, downloadProgress: progress }
    this.emit()
  }

  setStatus(status: AppUpdateStatus, message?: string): void {
    this.state = { ...this.state, status, message }
    this.emit()
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    listener(this.getState())
    return () => this.listeners.delete(listener)
  }

  scheduleDevSimulation(): void {
    if (this.devSimulationArmed) return
    this.devSimulationArmed = true
    this.setState({ status: 'available', availableVersion: this.bumpPatchVersion(this.state.currentVersion), source: 'dev-simulated', downloadProgress: null, message: 'Simulated update ready.' }, 1400)
  }

  async checkForUpdates(): Promise<AppUpdateState> {
    if (this.devSimulationArmed) return this.getState()
    if (this.inflightCheck) return this.inflightCheck
    this.inflightCheck = this.performGitHubReleaseCheck()
    try {
      return await this.inflightCheck
    } finally {
      this.inflightCheck = null
    }
  }

  dispose(): void {
    this.clearTransitionTimer()
    this.listeners.clear()
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener(this.getState())
    }
  }

  private setState(next: Omit<AppUpdateState, 'currentVersion'>, delayMs?: number): void {
    const apply = () => {
      this.state = { currentVersion: this.state.currentVersion, ...next }
      this.emit()
    }
    if (delayMs && delayMs > 0) {
      setTimeout(apply, delayMs)
      return
    }
    apply()
  }

  private bumpPatchVersion(version: string): string {
    const parts = version.split('.')
    const patchIndex = parts.length - 1
    const patch = Number.parseInt(parts[patchIndex] || '0', 10)
    if (Number.isNaN(patch)) return `${version}-update`
    parts[patchIndex] = String(patch + 1)
    return parts.join('.')
  }

  private clearTransitionTimer(): void {
    if (!this.transitionTimer) return
    clearTimeout(this.transitionTimer)
    this.transitionTimer = null
  }

  private async performGitHubReleaseCheck(): Promise<AppUpdateState> {
    try {
      const response = await fetch(`https://api.github.com/repos/${this.owner}/${this.repo}/releases/latest`, {
        headers: { Accept: 'application/vnd.github+json', 'User-Agent': `Monet/${this.state.currentVersion}` }
      })

      if (!response.ok) throw new Error(`GitHub release lookup failed (${response.status})`)

      const release = await response.json() as GitHubLatestReleaseResponse
      if (release.draft || release.prerelease) {
        this.latestRelease = null
        this.setState({ status: 'idle', availableVersion: null, source: 'none', downloadProgress: null, message: `${this.state.currentVersion} is the current installed version.` })
        return this.getState()
      }

      const releaseVersion = release.tag_name.replace(/^v/i, '').trim()
      const arch = process.arch === 'arm64' ? 'arm64' : 'x64'
      const zipAsset =
        release.assets.find((a) => a.name === `Monet-macOS-${arch}.zip`) ??
        release.assets.find((a) => a.name.endsWith('.zip')) ??
        null

      this.latestRelease = { version: releaseVersion, htmlUrl: release.html_url, zipUrl: zipAsset?.browser_download_url ?? null }

      if (this.compareVersions(releaseVersion, this.state.currentVersion) <= 0) {
        this.setState({ status: 'idle', availableVersion: null, source: 'none', downloadProgress: null, message: `${this.state.currentVersion} is the current installed version.` })
        return this.getState()
      }

      this.setState({ status: 'available', availableVersion: releaseVersion, source: 'github-release', downloadProgress: null, message: `Monet ${releaseVersion} is available.` })
      return this.getState()
    } catch (error) {
      this.latestRelease = null
      this.setState({ status: 'error', availableVersion: null, source: 'none', downloadProgress: null, message: error instanceof Error ? error.message : 'Failed to check for updates.' })
      return this.getState()
    }
  }

  private compareVersions(left: string, right: string): number {
    const leftParts = left.split(/[\.-]/).map((p) => Number.parseInt(p, 10))
    const rightParts = right.split(/[\.-]/).map((p) => Number.parseInt(p, 10))
    const length = Math.max(leftParts.length, rightParts.length)
    for (let i = 0; i < length; i++) {
      const l = Number.isFinite(leftParts[i]) ? leftParts[i] : 0
      const r = Number.isFinite(rightParts[i]) ? rightParts[i] : 0
      if (l > r) return 1
      if (l < r) return -1
    }
    return 0
  }
}
