export type AppUpdateStatus = 'idle' | 'available' | 'downloading' | 'downloaded' | 'restarting' | 'error'

export interface AppUpdateState {
  status: AppUpdateStatus
  availableVersion: string | null
  currentVersion: string
  source: 'none' | 'dev-simulated' | 'github-release'
  message?: string
}

type Listener = (state: AppUpdateState) => void

export class UpdateService {
  private listeners = new Set<Listener>()

  private state: AppUpdateState

  private devSimulationArmed = false

  private transitionTimer: NodeJS.Timeout | null = null

  constructor(currentVersion: string) {
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
    return this.getState()
  }

  async applyUpdate(onRestart: () => void): Promise<AppUpdateState> {
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
}
