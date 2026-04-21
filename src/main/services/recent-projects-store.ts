import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { dirname } from 'path'

export interface RecentProjectEntry {
  path: string
  name: string
  lastOpenedAt: number
}

type RecentProjectsPayload = {
  recentProjects: RecentProjectEntry[]
  lastOpenedProjectPath: string | null
}

const DEFAULT_PAYLOAD: RecentProjectsPayload = {
  recentProjects: [],
  lastOpenedProjectPath: null
}

export class RecentProjectsStore {
  private payload: RecentProjectsPayload = DEFAULT_PAYLOAD

  constructor(private readonly filePath: string) {
    if (!existsSync(filePath)) return
    try {
      const raw = readFileSync(filePath, 'utf8')
      const parsed = JSON.parse(raw) as Partial<RecentProjectsPayload>
      this.payload = {
        recentProjects: Array.isArray(parsed.recentProjects)
          ? parsed.recentProjects
              .filter((item): item is RecentProjectEntry =>
                Boolean(item && typeof item.path === 'string' && typeof item.name === 'string' && typeof item.lastOpenedAt === 'number')
              )
              .sort((left, right) => right.lastOpenedAt - left.lastOpenedAt)
          : [],
        lastOpenedProjectPath: typeof parsed.lastOpenedProjectPath === 'string' ? parsed.lastOpenedProjectPath : null
      }
    } catch (error) {
      console.warn('[RecentProjectsStore] Failed to load project history:', error)
    }
  }

  getState(): RecentProjectsPayload {
    return {
      recentProjects: [...this.payload.recentProjects],
      lastOpenedProjectPath: this.payload.lastOpenedProjectPath
    }
  }

  noteOpenedProject(path: string, name: string): RecentProjectsPayload {
    const now = Date.now()
    const nextEntry: RecentProjectEntry = { path, name, lastOpenedAt: now }
    this.payload = {
      recentProjects: [
        nextEntry,
        ...this.payload.recentProjects.filter((entry) => entry.path !== path)
      ].slice(0, 12),
      lastOpenedProjectPath: path
    }
    this.persist()
    return this.getState()
  }

  removeMissingProject(path: string): RecentProjectsPayload {
    const nextRecent = this.payload.recentProjects.filter((entry) => entry.path !== path)
    this.payload = {
      recentProjects: nextRecent,
      lastOpenedProjectPath: this.payload.lastOpenedProjectPath === path ? null : this.payload.lastOpenedProjectPath
    }
    this.persist()
    return this.getState()
  }

  clearLastOpenedProject(): RecentProjectsPayload {
    this.payload = {
      ...this.payload,
      lastOpenedProjectPath: null
    }
    this.persist()
    return this.getState()
  }

  replaceProjectPath(oldPath: string, newPath: string, name?: string): RecentProjectsPayload {
    let touched = false
    const nextRecent = this.payload.recentProjects.map((entry) => {
      if (entry.path !== oldPath) return entry
      touched = true
      return {
        ...entry,
        path: newPath,
        name: name ?? entry.name
      }
    })

    const nextLastOpenedProjectPath =
      this.payload.lastOpenedProjectPath === oldPath ? newPath : this.payload.lastOpenedProjectPath

    if (!touched && nextLastOpenedProjectPath === this.payload.lastOpenedProjectPath) {
      return this.getState()
    }

    const deduped = new Map<string, RecentProjectEntry>()
    for (const entry of nextRecent) {
      const existing = deduped.get(entry.path)
      if (!existing || entry.lastOpenedAt > existing.lastOpenedAt) {
        deduped.set(entry.path, entry)
      }
    }

    this.payload = {
      recentProjects: [...deduped.values()].sort((left, right) => right.lastOpenedAt - left.lastOpenedAt).slice(0, 12),
      lastOpenedProjectPath: nextLastOpenedProjectPath
    }
    this.persist()
    return this.getState()
  }

  private persist(): void {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true })
      writeFileSync(this.filePath, JSON.stringify(this.payload, null, 2), 'utf8')
    } catch (error) {
      console.warn('[RecentProjectsStore] Failed to persist project history:', error)
    }
  }
}
