import { spawn, type IPty } from 'node-pty'
import type { WebContents } from 'electron'
import { createId } from './id'

type TerminalSession = {
  id: string
  pty: IPty
  owner: WebContents
  cwd: string
}

type TerminalCreateOptions = {
  cols: number
  rows: number
  cwd?: string
  shell?: string
  env?: Record<string, string>
}

export class TerminalService {
  private readonly sessions = new Map<string, TerminalSession>()

  private canSend(owner: WebContents): boolean {
    return !owner.isDestroyed() && !owner.isCrashed()
  }

  private safeSend(owner: WebContents, channel: string, payload: unknown): void {
    if (!this.canSend(owner)) return
    try {
      owner.send(channel, payload)
    } catch {
      // Window teardown can race with PTY events during app close.
    }
  }

  createSession(owner: WebContents, options: TerminalCreateOptions): { id: string; cwd: string } {
    const shell = options.shell || process.env.SHELL || '/bin/zsh'
    const cwd = options.cwd || process.cwd()
    const id = createId('term')
    const env = {
      ...process.env,
      ...options.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
      CLICOLOR: '1',
      CLICOLOR_FORCE: '1',
      TERM_PROGRAM: 'Monet',
      TERM_PROGRAM_VERSION: options.env?.TERM_PROGRAM_VERSION || process.env.npm_package_version || 'unknown',
      AI_VIDEO_EDITOR_ROOT: process.cwd()
    }
    delete env.NO_COLOR

    const pty = spawn(shell, ['-l'], {
      name: 'xterm-256color',
      cols: Math.max(40, options.cols || 120),
      rows: Math.max(12, options.rows || 24),
      cwd,
      env
    })

    const session: TerminalSession = { id, pty, owner, cwd }
    this.sessions.set(id, session)

    pty.onData((data) => {
      this.safeSend(owner, 'terminal:data', { sessionId: id, data })
    })

    pty.onExit(({ exitCode, signal }) => {
      this.sessions.delete(id)
      this.safeSend(owner, 'terminal:exit', { sessionId: id, exitCode, signal })
    })

    return { id, cwd }
  }

  write(sessionId: string, data: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) {
      throw new Error('Terminal session not found.')
    }
    session.pty.write(data)
  }

  sendOutput(sessionId: string, data: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    this.safeSend(session.owner, 'terminal:data', { sessionId, data })
  }

  broadcastOutput(data: string): void {
    for (const [sessionId] of this.sessions.entries()) {
      this.sendOutput(sessionId, data)
    }
  }

  resize(sessionId: string, cols: number, rows: number): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    session.pty.resize(Math.max(20, cols), Math.max(8, rows))
  }

  kill(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    session.pty.kill()
    this.sessions.delete(sessionId)
  }

  killAllForOwner(owner: WebContents): void {
    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.owner !== owner) continue
      session.pty.kill()
      this.sessions.delete(sessionId)
    }
  }

  killAll(): void {
    for (const [sessionId, session] of this.sessions.entries()) {
      session.pty.kill()
      this.sessions.delete(sessionId)
    }
  }

  getSessionDirectories(): string[] {
    return [...new Set([...this.sessions.values()].map((session) => session.cwd))]
  }
}
