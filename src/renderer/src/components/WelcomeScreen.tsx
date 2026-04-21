import { useMemo, useState } from 'react'
import { ChevronRight, Clock, FilePlus2, FolderOpen, KeyRound, RotateCcw, TerminalSquare } from 'lucide-react'
import clsx from 'clsx'
import type { EditorActions, EditorState } from '../store/useEditorStore'

type Props = Pick<EditorState, 'projectManager'> &
  Pick<EditorState, 'projectName' | 'projectFilePath' | 'assets' | 'sequences' | 'aiSettings'> &
  Pick<EditorActions, 'openProject' | 'createProject' | 'setAnalyticsEnabled' | 'setApiKey' | 'setOnboardingCompleted' | 'persistAISettings'> & {
    loading?: boolean
    onOpenProjects: () => void
    onEnterWorkspace: () => void
  }

type AnalyticsChoice = 'enabled' | 'disabled' | null

function formatRelativeTime(timestamp: number): string {
  const deltaMs = Date.now() - timestamp
  const deltaMinutes = Math.max(1, Math.round(deltaMs / 60000))
  if (deltaMinutes < 60) return `${deltaMinutes}m ago`
  const deltaHours = Math.round(deltaMinutes / 60)
  if (deltaHours < 24) return `${deltaHours}h ago`
  return `${Math.round(deltaHours / 24)}d ago`
}

export function WelcomeScreen({
  projectManager,
  projectName,
  projectFilePath,
  assets,
  sequences,
  aiSettings,
  loading = false,
  createProject,
  openProject,
  setAnalyticsEnabled,
  setApiKey,
  setOnboardingCompleted,
  persistAISettings,
  onOpenProjects,
  onEnterWorkspace
}: Props) {
  const [analyticsChoice, setAnalyticsChoice] = useState<AnalyticsChoice>(null)
  const [savingSetup, setSavingSetup] = useState(false)

  const hasRecoverableWorkspace =
    !loading && (
      Boolean(projectFilePath) ||
      assets.length > 0 ||
      sequences.length > 1 ||
      (sequences[0]?.duration ?? 0) > 0
    )

  const recent = loading ? [] : projectManager.recentProjects.slice(0, 5)
  const sessionName = projectFilePath ? projectName : 'Recovered Session'
  const sessionSubtitle = projectFilePath
    ? projectFilePath
    : `${assets.length} asset${assets.length !== 1 ? 's' : ''} · ${sequences.length} sequence${sequences.length !== 1 ? 's' : ''}`
  const showRecoveredRecent = hasRecoverableWorkspace && !projectFilePath
  const recentCount = recent.length + (showRecoveredRecent ? 1 : 0)
  const showOnboarding = !loading && !aiSettings.onboardingCompleted

  const canFinishOnboarding = useMemo(() => {
    return (
      analyticsChoice !== null &&
      aiSettings.apiKeys.openai.trim().length > 0
    )
  }, [analyticsChoice, aiSettings.apiKeys.openai])

  async function completeOnboarding() {
    if (!canFinishOnboarding || savingSetup) return
    setSavingSetup(true)
    try {
      setAnalyticsEnabled(analyticsChoice === 'enabled')
      setOnboardingCompleted(true)
      await persistAISettings({
        analyticsEnabled: analyticsChoice === 'enabled',
        onboardingCompleted: true
      })
    } finally {
      setSavingSetup(false)
    }
  }

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-[#070709]">
      <div
        className="pointer-events-none absolute"
        style={{
          width: 600,
          height: 600,
          background: 'radial-gradient(ellipse at center, rgba(200,212,224,0.05) 0%, transparent 70%)'
        }}
      />
      <div className="drag-region absolute inset-x-0 top-0 h-8" />
      <div
        className="relative flex w-[460px] flex-col overflow-hidden rounded-2xl"
        style={{
          background: 'linear-gradient(170deg, #18181b 0%, #111113 100%)',
          boxShadow: '0 0 0 1px rgba(255,255,255,0.08), 0 24px 64px rgba(0,0,0,0.6)'
        }}
      >
        <div
          className="pointer-events-none absolute inset-x-0 top-0 h-px"
          style={{ background: 'linear-gradient(90deg, transparent 10%, rgba(255,255,255,0.12) 50%, transparent 90%)' }}
        />
        <div className="overflow-y-auto px-7 pt-8 pb-4" style={{ maxHeight: '82vh' }}>
          <div className="mb-6 text-center">
            <div className="text-2xl font-semibold tracking-tight text-white">Monet</div>
            <div className="mt-1.5 text-xs text-white/40">
              {showOnboarding ? 'Set up Monet once, then start cutting.' : 'Open a project. Start cutting.'}
            </div>
          </div>

          {loading ? (
            <div className="space-y-5">
              <section className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-4">
                <div className="text-xs font-semibold text-white">Loading Monet…</div>
                <p className="mt-2 text-[11px] leading-relaxed text-white/40">
                  Checking settings, autosave, and recent projects.
                </p>
                <div className="mt-4 space-y-2">
                  <div className="h-10 rounded-lg bg-white/[0.06]" />
                  <div className="h-10 rounded-lg bg-white/[0.04]" />
                  <div className="h-10 rounded-lg bg-white/[0.04]" />
                </div>
              </section>
            </div>
          ) : showOnboarding ? (
            <div className="space-y-5">
              <section className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-4">
                <div className="flex items-center gap-2 text-xs font-semibold text-white">
                  <KeyRound size={13} className="text-[#c8d4e0]" />
                  OpenAI embeddings key
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-white/40">
                  Required for embeddings and semantic search. Monet keeps this local on your device.
                </p>
                <input
                  type="password"
                  value={aiSettings.apiKeys.openai}
                  onChange={(event) => setApiKey('openai', event.target.value)}
                  placeholder="sk-..."
                  className="mt-3 w-full rounded-lg border border-white/[0.08] bg-[#111113] px-3 py-2 text-xs text-white outline-none focus:border-[#c8d4e0]/50 placeholder:text-white/20"
                  spellCheck={false}
                  autoComplete="off"
                />
                <div className="mt-2">
                  <a
                    href="https://platform.openai.com/api-keys"
                    target="_blank"
                    rel="noreferrer"
                    className="text-[11px] font-medium text-[#c8d4e0] transition-colors hover:text-white"
                  >
                    Get OpenAI API key
                  </a>
                </div>
              </section>

              <section className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-4">
                <div className="text-xs font-semibold text-white">Anonymous usage data</div>
                <p className="mt-2 text-[11px] leading-relaxed text-white/40">
                  Monet does not collect your project content. Filenames, prompts, transcript text, and media stay out of analytics. You can optionally share anonymous usage data, and you can change this later in Settings.
                </p>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <ChoiceButton
                    active={analyticsChoice === 'enabled'}
                    title="Share anonymous usage"
                    body="Help improve Monet with aggregate feature usage only."
                    onClick={() => setAnalyticsChoice('enabled')}
                  />
                  <ChoiceButton
                    active={analyticsChoice === 'disabled'}
                    title="Do not share usage"
                    body="Keep anonymous usage analytics turned off."
                    onClick={() => setAnalyticsChoice('disabled')}
                  />
                </div>
              </section>

              <section className="rounded-xl border border-white/[0.06] bg-white/[0.03] p-4">
                <div className="flex items-center gap-2 text-xs font-semibold text-white">
                  <TerminalSquare size={13} className="text-[#c8d4e0]" />
                  Coding agents
                </div>
                <p className="mt-2 text-[11px] leading-relaxed text-white/40">
                  Monet works with Claude Code or Codex in the built-in terminal. If neither is installed, Monet will show install help next to the terminal when you start using it.
                </p>
              </section>

              <button
                onClick={() => void completeOnboarding()}
                disabled={!canFinishOnboarding || savingSetup}
                className={clsx(
                  'w-full rounded-xl px-4 py-3 text-sm font-semibold transition-colors',
                  canFinishOnboarding && !savingSetup
                    ? 'bg-[#c8d4e0] text-black hover:bg-white'
                    : 'bg-white/[0.08] text-white/30 cursor-not-allowed'
                )}
              >
                {savingSetup ? 'Saving setup…' : 'Continue'}
              </button>
            </div>
          ) : (
            <>
              <div className="flex flex-col gap-2">
                {(loading || hasRecoverableWorkspace) && (
                  <button
                    onClick={loading ? undefined : onEnterWorkspace}
                    disabled={loading}
                    className={clsx(
                      'group flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left transition-colors',
                      'bg-[#c8d4e0]',
                      loading ? 'cursor-wait' : 'hover:bg-white'
                    )}
                  >
                    <RotateCcw size={14} className={clsx('flex-shrink-0', loading ? 'text-black/25' : 'text-black/70')} />
                    <div className="min-w-0 flex-1">
                      <div className={clsx('text-sm font-semibold leading-none', loading ? 'text-black/45' : 'text-black')}>
                        {loading ? 'Loading session…' : projectFilePath ? 'Resume Project' : 'Recover Session'}
                      </div>
                      <div className={clsx('mt-1 truncate text-xs', loading ? 'text-black/25' : 'text-black/55')}>
                        {loading ? 'Checking autosave and recent projects' : sessionSubtitle}
                      </div>
                    </div>
                    <ChevronRight
                      size={13}
                      className={clsx(
                        'flex-shrink-0 transition-transform',
                        loading ? 'text-black/20' : 'text-black/40 group-hover:translate-x-0.5'
                      )}
                    />
                  </button>
                )}

                <div className="grid grid-cols-2 gap-2">
                  <GhostButton icon={<FilePlus2 size={13} />} label="New Project" onClick={() => void createProject('Untitled Project')} disabled={loading} />
                  <GhostButton icon={<FolderOpen size={13} />} label="Open Existing…" onClick={() => void openProject()} disabled={loading} />
                </div>
                <p className="px-1 text-[10px] leading-relaxed text-white/30">
                  Open Existing looks for a saved Monet project. To bring in media from any folder, start a new project first.
                </p>
              </div>

              {!loading && recentCount > 0 && (
                <div className="mt-6">
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-[10px] font-semibold uppercase tracking-[0.15em] text-white/30">Recent</span>
                    {projectManager.recentProjects.length > 5 && (
                      <button onClick={onOpenProjects} className="text-[10px] text-white/30 hover:text-white/60 transition-colors">
                        See all
                      </button>
                    )}
                  </div>
                  <div className="flex flex-col">
                    {showRecoveredRecent && (
                      <button
                        onClick={onEnterWorkspace}
                        className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors bg-white/[0.07] hover:bg-white/[0.09]"
                      >
                        <RotateCcw size={12} className="flex-shrink-0 text-[#c8d4e0]" />
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-xs font-medium text-white">{sessionName}</div>
                          <div className="truncate text-[10px] text-white/25">{sessionSubtitle}</div>
                        </div>
                        <span className="rounded-full bg-[#c8d4e0]/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[#c8d4e0]">
                          Open
                        </span>
                      </button>
                    )}
                    {recent.map((project) => {
                      const isCurrent = project.path === projectManager.currentProjectFilePath
                      return (
                        <button
                          key={project.path}
                          onClick={() => void openProject(project.path)}
                          className={clsx(
                            'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors',
                            isCurrent ? 'bg-white/[0.07]' : 'hover:bg-white/[0.05]'
                          )}
                        >
                          <FolderOpen size={12} className={clsx('flex-shrink-0', isCurrent ? 'text-[#c8d4e0]' : 'text-white/30')} />
                          <div className="min-w-0 flex-1">
                            <div className={clsx('truncate text-xs font-medium', isCurrent ? 'text-white' : 'text-white/70')}>{project.name}</div>
                            <div className="truncate text-[10px] text-white/25">{project.path}</div>
                          </div>
                          <div className="flex flex-shrink-0 items-center gap-1.5">
                            {isCurrent && <span className="rounded-full bg-[#c8d4e0]/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[#c8d4e0]">Open</span>}
                            <span className="flex items-center gap-1 text-[10px] text-white/25">
                              <Clock size={9} />
                              {formatRelativeTime(project.lastOpenedAt)}
                            </span>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {!loading && recentCount === 0 && !hasRecoverableWorkspace && (
                <div className="mt-6 rounded-xl border border-dashed border-white/[0.07] p-5 text-center">
                  <p className="text-xs text-white/30 leading-relaxed">
                    No recent projects. Create a new project, or open an existing Monet project from a file or folder.
                  </p>
                </div>
              )}
            </>
          )}
        </div>

        {!showOnboarding && (
          <div className="flex items-center justify-between border-t border-white/[0.06] px-7 py-3 text-[10px] text-white/20">
            <span>No account required</span>
            <span>Settings controls privacy</span>
          </div>
        )}
      </div>
    </div>
  )
}

function GhostButton({ icon, label, onClick, disabled = false }: { icon: React.ReactNode; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex items-center justify-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.04] px-4 py-2.5 text-xs font-medium text-white/60 transition-colors hover:bg-white/[0.07] hover:text-white/90 disabled:cursor-not-allowed disabled:opacity-50"
    >
      {icon}
      {label}
    </button>
  )
}

function ChoiceButton({
  active,
  title,
  body,
  onClick
}: {
  active: boolean
  title: string
  body: string
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={clsx(
        'rounded-lg border px-3 py-3 text-left transition-colors',
        active ? 'border-[#c8d4e0]/60 bg-[#c8d4e0]/10' : 'border-white/[0.06] bg-[#111113] hover:bg-white/[0.05]'
      )}
    >
      <div className={clsx('text-xs font-medium', active ? 'text-white' : 'text-white/80')}>{title}</div>
      <div className="mt-1 text-[10px] leading-relaxed text-white/30">{body}</div>
    </button>
  )
}
