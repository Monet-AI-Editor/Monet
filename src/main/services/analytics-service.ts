import { trackEvent as trackAptabaseEvent } from '@aptabase/electron/main'
import { randomUUID } from 'crypto'
import { mkdir, readFile, appendFile, writeFile } from 'fs/promises'
import { dirname } from 'path'

type AnalyticsState = {
  installationId: string
}

type AnalyticsEvent = {
  id: string
  installationId: string
  name: string
  timestamp: number
  appVersion: string
  payload: Record<string, string | number | boolean | null>
}

const REMOTE_EVENT_ALLOWLIST = new Set([
  'app_opened',
  'project_created',
  'project_opened',
  'media_imported',
  'export_completed',
  'terminal_session_started',
  'workspace_resumed'
])

export class AnalyticsService {
  private state: AnalyticsState | null = null

  constructor(
    private readonly statePath: string,
    private readonly logPath: string,
    private readonly appVersion: string,
    private readonly remoteEnabled: boolean
  ) {}

  private sanitizeRemotePayload(payload: Record<string, string | number | boolean | null>): Record<string, string | number | boolean> {
    return Object.fromEntries(
      Object.entries(payload).filter((entry): entry is [string, string | number | boolean] => entry[1] !== null)
    )
  }

  private async getState(): Promise<AnalyticsState> {
    if (this.state) return this.state

    try {
      const raw = await readFile(this.statePath, 'utf8')
      const parsed = JSON.parse(raw) as Partial<AnalyticsState>
      if (typeof parsed.installationId === 'string' && parsed.installationId.length > 0) {
        this.state = { installationId: parsed.installationId }
        return this.state
      }
    } catch {
      // create fresh state
    }

    this.state = { installationId: randomUUID() }
    await mkdir(dirname(this.statePath), { recursive: true })
    await writeFile(this.statePath, JSON.stringify(this.state, null, 2), 'utf8')
    return this.state
  }

  async track(enabled: boolean, name: string, payload: Record<string, string | number | boolean | null> = {}): Promise<void> {
    if (!enabled) return
    const state = await this.getState()
    const event: AnalyticsEvent = {
      id: randomUUID(),
      installationId: state.installationId,
      name,
      timestamp: Date.now(),
      appVersion: this.appVersion,
      payload
    }
    await mkdir(dirname(this.logPath), { recursive: true })
    await appendFile(this.logPath, `${JSON.stringify(event)}\n`, 'utf8')
    if (this.remoteEnabled && REMOTE_EVENT_ALLOWLIST.has(name)) {
      try {
        await trackAptabaseEvent(name, this.sanitizeRemotePayload(payload))
      } catch {
        // Remote analytics must never block or break the app.
      }
    }
  }
}
