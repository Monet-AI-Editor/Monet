import { useEffect, useRef, useState } from 'react'
import { TerminalSquare } from 'lucide-react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import type { AISettings } from '../types'

export function TerminalPanel({
  aiSettings,
  persistAISettings,
  onGuideToggle
}: {
  aiSettings: AISettings
  persistAISettings: (overrides?: Partial<AISettings>) => Promise<void>
  onGuideToggle?: (open: boolean) => void
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const sessionIdRef = useRef<string | null>(null)
  const resizeFrameRef = useRef<number | null>(null)
  const lastGeometryRef = useRef<{ cols: number; rows: number } | null>(null)
  const deferredResizeRef = useRef(false)
  const [status, setStatus] = useState('Starting shell')
  const [cwd, setCwd] = useState('')
  const [agentStatus, setAgentStatus] = useState<{ codexInstalled: boolean; claudeInstalled: boolean } | null>(null)
  const [showGuide, setShowGuide] = useState(false)

  useEffect(() => {
    onGuideToggle?.(showGuide)
  }, [onGuideToggle, showGuide])

  useEffect(() => {
    if (!hostRef.current) return

    const terminal = new Terminal({
      cursorBlink: true,
      cursorStyle: 'bar',
      fontFamily: 'Menlo, Monaco, SFMono-Regular, SF Mono, Consolas, monospace',
      fontSize: 13,
      fontWeight: '400',
      letterSpacing: 0,
      lineHeight: 1,
      scrollback: 5000,
      theme: {
        background: '#111318',
        foreground: '#e8eaed',
        cursor: '#f5f7fb',
        cursorAccent: '#111318',
        selectionBackground: '#314056',
        black: '#111318',
        red: '#f07178',
        green: '#8bd49c',
        yellow: '#e6c073',
        blue: '#7aa2f7',
        magenta: '#c79bf0',
        cyan: '#7dcfff',
        white: '#c9d1d9',
        brightBlack: '#5c6370',
        brightRed: '#f78c6c',
        brightGreen: '#a6e3a1',
        brightYellow: '#f9e2af',
        brightBlue: '#89b4fa',
        brightMagenta: '#d2a8ff',
        brightCyan: '#94e2d5',
        brightWhite: '#ffffff'
      },
      allowTransparency: false,
      drawBoldTextInBrightColors: false,
      customGlyphs: false,
      rightClickSelectsWord: false,
      smoothScrollDuration: 0,
      scrollOnUserInput: false,
      fastScrollModifier: 'alt',
      fastScrollSensitivity: 5
    })
    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.open(hostRef.current)

    const applyResize = () => {
      if (!hostRef.current) return
      fitAddon.fit()
      const previous = lastGeometryRef.current
      const next = { cols: terminal.cols, rows: terminal.rows }
      const activeBufferType = terminal.buffer.active.type

      if (
        activeBufferType === 'alternate' &&
        previous &&
        (next.cols < previous.cols || next.rows < previous.rows)
      ) {
        deferredResizeRef.current = true
        terminal.resize(previous.cols, previous.rows)
        return
      }

      if (previous && previous.cols === next.cols && previous.rows === next.rows) return
      lastGeometryRef.current = next
      const sessionId = sessionIdRef.current
      if (!sessionId) return
      void window.api.resizeTerminal(sessionId, next.cols, next.rows).catch(() => undefined)
    }

    const scheduleResize = () => {
      if (resizeFrameRef.current != null) {
        window.cancelAnimationFrame(resizeFrameRef.current)
      }
      resizeFrameRef.current = window.requestAnimationFrame(() => {
        resizeFrameRef.current = null
        applyResize()
      })
    }

    scheduleResize()

    let disposed = false
    const unsubscribeData = window.api.onTerminalData(({ sessionId, data }) => {
      if (sessionId !== sessionIdRef.current) return
      terminal.write(data)
      if (deferredResizeRef.current && terminal.buffer.active.type === 'normal') {
        deferredResizeRef.current = false
        scheduleResize()
      }
    })
    const unsubscribeExit = window.api.onTerminalExit(({ sessionId, exitCode }) => {
      if (sessionId !== sessionIdRef.current) return
      sessionIdRef.current = null
      setStatus(`Exited (${exitCode})`)
    })

    terminal.onData((data) => {
      const sessionId = sessionIdRef.current
      if (!sessionId) return
      void window.api.writeTerminal(sessionId, data).catch(() => undefined)
    })

    const resizeObserver = new ResizeObserver(() => {
      scheduleResize()
    })
    resizeObserver.observe(hostRef.current)

    void window.api
      .createTerminalSession({ cols: terminal.cols, rows: terminal.rows })
      .then((session) => {
        if (disposed) {
          void window.api.killTerminal(session.id)
          return
        }

        sessionIdRef.current = session.id
        setCwd(session.cwd)
        setStatus('Ready')
        scheduleResize()
      })
      .catch((error: Error) => {
        setStatus(error.message)
      })

    return () => {
      disposed = true
      resizeObserver.disconnect()
      unsubscribeData()
      unsubscribeExit()
      const sessionId = sessionIdRef.current
      if (sessionId) {
        void window.api.killTerminal(sessionId).catch(() => undefined)
      }
      if (resizeFrameRef.current != null) {
        window.cancelAnimationFrame(resizeFrameRef.current)
      }
      terminal.dispose()
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void window.api.getAgentToolStatus()
      .then((result) => {
        if (!cancelled) setAgentStatus(result)
      })
      .catch(() => {
        if (!cancelled) setAgentStatus({ codexInstalled: false, claudeInstalled: false })
      })
    return () => {
      cancelled = true
    }
  }, [])

  const hasAnyAgent = Boolean(agentStatus?.codexInstalled || agentStatus?.claudeInstalled)
  const shouldShowAgentPrompt = Boolean(agentStatus && !hasAnyAgent && !aiSettings.agentInstallNudgeSeen)

  async function markAgentNudgeSeen() {
    if (aiSettings.agentInstallNudgeSeen) return
    await persistAISettings({ agentInstallNudgeSeen: true })
  }

  function runInTerminal(command: string) {
    const sessionId = sessionIdRef.current
    if (!sessionId) return
    void markAgentNudgeSeen().catch(() => undefined)
    void window.api.writeTerminal(sessionId, `${command}\n`).catch(() => undefined)
  }

  function launchAgent(agent: 'claude' | 'codex') {
    const startupPrompt =
      'You are inside Monet, an AI-first video editor. Read ./MONET_AGENT_CONTEXT.md first. Then inspect the live editor state with editorctl get-state and editorctl list-assets before answering the user.'

    const escapedPrompt = startupPrompt.replace(/"/g, '\\"')
    if (agent === 'claude') {
      runInTerminal(`clear && claude "${escapedPrompt}"`)
      return
    }

    runInTerminal(`clear && codex "${escapedPrompt}"`)
  }

  return (
    <div className="flex h-full flex-col overflow-hidden bg-surface-1">
      <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
        <div className="min-w-0 flex items-center gap-2">
          <TerminalSquare size={13} className="text-accent flex-shrink-0" />
          <div className="min-w-0">
            <div className="text-2xs uppercase tracking-wider text-text-dim">Terminal</div>
            <div className="truncate text-xs text-text-primary">{cwd || 'Launching shell…'}</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowGuide((current) => !current)}
            className="rounded-full border border-border px-2 py-0.5 text-2xs text-text-secondary transition-colors hover:text-text-primary hover:border-text-dim"
          >
            {showGuide ? 'Hide guide' : 'Guide'}
          </button>
          <span className="rounded-full border border-border px-2 py-0.5 text-2xs text-text-secondary">{status}</span>
        </div>
      </div>
      {showGuide && (
        <div className="border-b border-border bg-[#111318] px-3 py-3">
          <div className="select-text text-xs font-semibold text-text-primary">Getting started with coding agents</div>
          <div className="select-text mt-1 text-[11px] leading-relaxed text-text-dim">
            Use either Claude Code or Codex in this terminal. One installed tool is enough. Monet prepares
            <span className="select-text font-medium text-text-secondary"> CLAUDE.md</span>,
            <span className="select-text font-medium text-text-secondary"> AGENTS.md</span>, and
            <span className="select-text font-medium text-text-secondary"> MONET_AGENT_CONTEXT.md</span> in the terminal directory automatically.
          </div>
          <div className="mt-3 space-y-2 text-[10px] text-text-dim">
            <div>
              <div className="select-text mb-1 text-text-secondary">Claude Code</div>
              <code className="block select-text rounded bg-[#0f1115] px-2 py-1">npm install -g @anthropic-ai/claude-code</code>
              <code className="mt-1 block select-text rounded bg-[#0f1115] px-2 py-1">claude</code>
            </div>
            <div>
              <div className="select-text mb-1 text-text-secondary">Codex</div>
              <code className="block select-text rounded bg-[#0f1115] px-2 py-1">npm install -g @openai/codex</code>
              <code className="mt-1 block select-text rounded bg-[#0f1115] px-2 py-1">codex --login</code>
              <code className="mt-1 block select-text rounded bg-[#0f1115] px-2 py-1">codex</code>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={() => launchAgent('claude')}
              className="rounded-lg border border-accent/30 bg-accent/10 px-3 py-1.5 text-[11px] font-medium text-text-primary transition-colors hover:bg-accent/20"
            >
              Start Claude in Monet
            </button>
            <button
              onClick={() => launchAgent('codex')}
              className="rounded-lg border border-accent/30 bg-accent/10 px-3 py-1.5 text-[11px] font-medium text-text-primary transition-colors hover:bg-accent/20"
            >
              Start Codex in Monet
            </button>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              onClick={() => runInTerminal('npm install -g @anthropic-ai/claude-code')}
              className="rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-[11px] font-medium text-text-primary transition-colors hover:bg-surface-3"
            >
              Install Claude Code
            </button>
            <button
              onClick={() => runInTerminal('npm install -g @openai/codex')}
              className="rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-[11px] font-medium text-text-primary transition-colors hover:bg-surface-3"
            >
              Install Codex
            </button>
          </div>
        </div>
      )}
      {shouldShowAgentPrompt && (
        <div className="border-b border-border bg-[#111318] px-3 py-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs font-semibold text-text-primary">No coding agent detected</div>
              <div className="mt-1 text-[11px] leading-relaxed text-text-dim">
                Install Claude Code or Codex, then use it directly in this terminal. One installed tool is enough.
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  onClick={() => launchAgent('claude')}
                  className="rounded-lg border border-accent/30 bg-accent/10 px-3 py-1.5 text-[11px] font-medium text-text-primary transition-colors hover:bg-accent/20"
                >
                  Start Claude in Monet
                </button>
                <button
                  onClick={() => launchAgent('codex')}
                  className="rounded-lg border border-accent/30 bg-accent/10 px-3 py-1.5 text-[11px] font-medium text-text-primary transition-colors hover:bg-accent/20"
                >
                  Start Codex in Monet
                </button>
                <button
                  onClick={() => runInTerminal('npm install -g @anthropic-ai/claude-code')}
                  className="rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-[11px] font-medium text-text-primary transition-colors hover:bg-surface-3"
                >
                  Install Claude Code
                </button>
                <button
                  onClick={() => runInTerminal('npm install -g @openai/codex')}
                  className="rounded-lg border border-border bg-surface-2 px-3 py-1.5 text-[11px] font-medium text-text-primary transition-colors hover:bg-surface-3"
                >
                  Install Codex
                </button>
              </div>
              <div className="mt-2 space-y-1 text-[10px] text-text-dim">
                <code className="block rounded bg-[#0f1115] px-2 py-1">npm install -g @anthropic-ai/claude-code</code>
                <code className="block rounded bg-[#0f1115] px-2 py-1">npm install -g @openai/codex</code>
                <code className="block rounded bg-[#0f1115] px-2 py-1">codex --login</code>
              </div>
            </div>
            <button
              onClick={() => { void markAgentNudgeSeen().catch(() => undefined) }}
              className="text-[10px] text-text-dim transition-colors hover:text-text-secondary"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}
      <div ref={hostRef} className="min-h-0 flex-1 overflow-hidden bg-[#0f1115]" />
    </div>
  )
}
