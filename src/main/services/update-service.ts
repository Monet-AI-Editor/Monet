export type AppUpdateStatus = 'idle' | 'available' | 'downloading' | 'downloaded' | 'restarting' | 'error'

export interface AppUpdateState {
  status: AppUpdateStatus
  availableVersion: string | null
  currentVersion: string
  source: 'none' | 'dev-simulated' | 'github-release'
  message?: string
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

interface GitHubReleaseInfo {
  version: string
  htmlUrl: string
  assetUrl: string | null
}

interface UpdateApplyHandlers {
  onRestart: () => void
  openExternal: (url: string) => Promise<void>
}

interface UpdateServiceOptions {
  owner: string
  repo: string
  assetName?: string
}

type Listener = (state: AppUpdateState) => void

export class UpdateService {
  private listeners = new Set<Listener>()

  private state: AppUpdateState

  private readonly owner: string

  private readonly repo: string

  private readonly assetName: string | null

  private devSimulationArmed = false

  private transitionTimer: NodeJS.Timeout | null = null

  private latestRelease: GitHubReleaseInfo | null = null

  private inflightCheck: Promise<AppUpdateState> | null = null

  constructor(currentVersion: string, options: UpdateServiceOptions) {
    this.owner = options.owner
    this.repo = options.repo
    this.assetName = options.assetName ?? null
    this.state = {
      status: 'idle',
      availableVersion: null,
      currentVersion,
      source: 'none'
    }
  }

  getState(): AppUpdateState {
    return { ...this.state }
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    listener(this.getState())
    return () => this.listeners.delete(listener)
  }

  scheduleDevSimulation(): void {
    if (this.devSimulationArmed) return
    this.devSimulationArmed = true
    this.setState({
      status: 'available',
      availableVersion: this.bumpPatchVersion(this.state.currentVersion),
      source: 'dev-simulated',
      message: 'Simulated update ready for this dev build.'
    }, 1400)
  }

  async checkForUpdates(): Promise<AppUpdateState> {
    if (this.devSimulationArmed) {
      return this.getState()
    }

    if (this.inflightCheck) {
      return this.inflightCheck
    }

    this.inflightCheck = this.performGitHubReleaseCheck()
    try {
      return await this.inflightCheck
    } finally {
      this.inflightCheck = null
    }
  }

  async applyUpdate({ onRestart, openExternal }: UpdateApplyHandlers): Promise<AppUpdateState> {
    if (this.state.source === 'github-release' && this.latestRelease) {
      await openExternal(this.latestRelease.assetUrl ?? this.latestRelease.htmlUrl)
      this.setState({
        status: 'available',
        availableVersion: this.latestRelease.version,
        source: 'github-release',
        message: this.latestRelease.assetUrl
          ? `Opened Monet ${this.latestRelease.version} for download. Install it to update.`
          : `Opened the Monet ${this.latestRelease.version} release page.`
      })
      return this.getState()
    }

    if (this.state.status !== 'available' && this.state.status !== 'downloaded') {
      return this.getState()
    }

    this.clearTransitionTimer()
    this.setState({
      status: 'downloading',
      availableVersion: this.state.availableVersion,
      source: this.state.source,
      message: 'Downloading update package.'
    })

    this.transitionTimer = setTimeout(() => {
      this.setState({
        status: 'downloaded',
        availableVersion: this.state.availableVersion,
        source: this.state.source,
        message: 'Update downloaded. Restarting Monet.'
      })

      this.transitionTimer = setTimeout(() => {
        this.setState({
          status: 'restarting',
          availableVersion: this.state.availableVersion,
          source: this.state.source,
          message: 'Restarting Monet to apply the update.'
        })

        this.transitionTimer = setTimeout(() => {
          onRestart()
          this.setState({
            status: 'idle',
            availableVersion: null,
            source: 'none',
            message: undefined
          })
        }, 700)
      }, 700)
    }, 900)

    return this.getState()
  }

  dispose(): void {
    this.clearTransitionTimer()
    this.listeners.clear()
  }

  private setState(next: Omit<AppUpdateState, 'currentVersion'>, delayMs?: number): void {
    const apply = () => {
      this.state = {
        currentVersion: this.state.currentVersion,
        ...next
      }
      for (const listener of this.listeners) {
        listener(this.getState())
      }
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
    if (Number.isNaN(patch)) {
      return `${version}-update`
    }
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
        headers: {
          Accept: 'application/vnd.github+json',
          'User-Agent': `Monet/${this.state.currentVersion}`
        }
      })

      if (!response.ok) {
        throw new Error(`GitHub release lookup failed (${response.status})`)
      }

      const release = await response.json() as GitHubLatestReleaseResponse
      if (release.draft || release.prerelease) {
        this.latestRelease = null
        this.setState({
          status: 'idle',
          availableVersion: null,
          source: 'none',
          message: `${this.state.currentVersion} is the current installed version.`
        })
        return this.getState()
      }

      const releaseVersion = release.tag_name.replace(/^v/i, '').trim()
      const assetUrl = this.resolveAssetUrl(release.assets)
      this.latestRelease = {
        version: releaseVersion,
        htmlUrl: release.html_url,
        assetUrl
      }

      if (this.compareVersions(releaseVersion, this.state.currentVersion) <= 0) {
        this.setState({
          status: 'idle',
          availableVersion: null,
          source: 'none',
          message: `${this.state.currentVersion} is the current installed version.`
        })
        return this.getState()
      }

      this.setState({
        status: 'available',
        availableVersion: releaseVersion,
        source: 'github-release',
        message: `Monet ${releaseVersion} is available to download.`
      })
      return this.getState()
    } catch (error) {
      this.latestRelease = null
      this.setState({
        status: 'error',
        availableVersion: null,
        source: 'none',
        message: error instanceof Error ? error.message : 'Failed to check for updates.'
      })
      return this.getState()
    }
  }

  private resolveAssetUrl(assets: GitHubReleaseAsset[]): string | null {
    if (assets.length === 0) return null

    if (this.assetName) {
      const exact = assets.find((asset) => asset.name === this.assetName)
      if (exact) return exact.browser_download_url
    }

    const preferred =
      assets.find((asset) => asset.name.endsWith('.dmg')) ??
      assets.find((asset) => asset.name.endsWith('.zip')) ??
      assets[0]

    return preferred?.browser_download_url ?? null
  }

  private compareVersions(left: string, right: string): number {
    const leftParts = left.split(/[\.-]/).map((part) => Number.parseInt(part, 10))
    const rightParts = right.split(/[\.-]/).map((part) => Number.parseInt(part, 10))
    const length = Math.max(leftParts.length, rightParts.length)

    for (let index = 0; index < length; index += 1) {
      const leftPart = Number.isFinite(leftParts[index]) ? leftParts[index] : 0
      const rightPart = Number.isFinite(rightParts[index]) ? rightParts[index] : 0
      if (leftPart > rightPart) return 1
      if (leftPart < rightPart) return -1
    }

    return 0
  }
}
