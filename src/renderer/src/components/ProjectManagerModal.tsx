import { useEffect, useState } from 'react'
import { Clock3, FilePlus2, FolderOpen, X } from 'lucide-react'
import clsx from 'clsx'
import type { EditorState, EditorActions } from '../store/useEditorStore'

type Props = Pick<EditorState, 'projectManager'> &
  Pick<EditorActions, 'openProject' | 'createProject'> & {
    onClose: () => void
  }

function formatRelativeTime(timestamp: number): string {
  const deltaMs = Date.now() - timestamp
  const deltaMinutes = Math.max(1, Math.round(deltaMs / 60000))
  if (deltaMinutes < 60) return `${deltaMinutes}m ago`
  const deltaHours = Math.round(deltaMinutes / 60)
  if (deltaHours < 24) return `${deltaHours}h ago`
  const deltaDays = Math.round(deltaHours / 24)
  return `${deltaDays}d ago`
}

export function ProjectManagerModal({ projectManager, openProject, createProject, onClose }: Props) {
  const [projectName, setProjectName] = useState('')
  const [busy, setBusy] = useState<'create' | 'open' | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function handleCreate(): Promise<void> {
    setBusy('create')
    setError(null)
    try {
      await createProject(projectName.trim() || 'Untitled Project')
      onClose()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to create project.')
    } finally {
      setBusy(null)
    }
  }

  async function handleOpen(path?: string): Promise<void> {
    setBusy('open')
    setError(null)
    try {
      await openProject(path)
      onClose()
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : 'Failed to open project.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="w-[680px] max-w-[92vw] max-h-[88vh] bg-surface-1 border border-border rounded-xl shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div>
            <h2 className="text-sm font-semibold text-text-primary">Projects</h2>
            <p className="mt-1 text-2xs text-text-dim">Create a new project or reopen an existing Monet project. Import media after the project is open.</p>
          </div>
          <button onClick={onClose} className="p-1 rounded hover:bg-surface-3 text-text-dim hover:text-text-primary">
            <X size={14} />
          </button>
        </div>

        <div className="grid grid-cols-[240px,minmax(0,1fr)] min-h-[420px]">
          <div className="border-r border-border bg-surface-0/70 p-4 space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-text-primary">
              <FilePlus2 size={13} className="text-accent" />
              New Project
            </div>
            <input
              value={projectName}
              onChange={(event) => setProjectName(event.target.value)}
              placeholder="Untitled Project"
              className="w-full bg-surface-2 border border-border rounded px-2.5 py-2 text-xs text-text-primary outline-none focus:border-accent"
            />
            <button
              onClick={() => void handleCreate()}
              disabled={busy !== null}
              className={clsx(
                'w-full px-3 py-2 rounded text-xs font-semibold transition-colors',
                busy !== null
                  ? 'bg-surface-3 text-text-dim cursor-wait'
                  : 'bg-accent text-black hover:bg-accent-hover'
              )}
            >
              {busy === 'create' ? 'Creating…' : 'Create Project'}
            </button>
            <button
              onClick={() => void handleOpen()}
              disabled={busy !== null}
              className={clsx(
                'w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded text-xs font-medium transition-colors border',
                busy !== null
                  ? 'bg-surface-3 border-border text-text-dim cursor-wait'
                  : 'bg-surface-2 hover:bg-surface-3 border-border text-text-primary'
              )}
            >
              <FolderOpen size={12} />
              Open Existing Project…
            </button>
            {projectManager.currentProjectFilePath && (
              <div className="pt-3 border-t border-border">
                <div className="text-2xs uppercase tracking-wide text-text-dim">Current</div>
                <div className="mt-1 text-xs text-text-primary truncate">
                  {projectManager.currentProjectFilePath.split('/').at(-1)}
                </div>
                <div className="mt-1 text-2xs text-text-dim break-all">
                  {projectManager.currentProjectFilePath}
                </div>
              </div>
            )}
          </div>

          <div className="p-4 overflow-y-auto">
            <div className="flex items-center gap-2 text-xs font-semibold text-text-primary mb-3">
              <Clock3 size={13} className="text-text-secondary" />
              Recent Projects
            </div>
            {projectManager.recentProjects.length === 0 ? (
              <div className="rounded-lg border border-border bg-surface-0/50 p-4 text-xs text-text-dim leading-relaxed">
                No recent projects yet. Save a project once and it will show up here.
              </div>
            ) : (
              <div className="space-y-2">
                {projectManager.recentProjects.map((project) => {
                  const isCurrent = project.path === projectManager.currentProjectFilePath
                  return (
                    <button
                      key={project.path}
                      onClick={() => void handleOpen(project.path)}
                      disabled={busy !== null}
                      className={clsx(
                        'w-full text-left rounded-lg border px-3 py-3 transition-colors',
                        isCurrent
                          ? 'border-accent/40 bg-accent/10'
                          : 'border-border bg-surface-0/50 hover:bg-surface-2 hover:border-border'
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-medium text-text-primary truncate">{project.name}</span>
                        {isCurrent && (
                          <span className="px-1.5 py-0.5 rounded bg-accent/15 text-accent text-2xs font-medium">
                            Open
                          </span>
                        )}
                        <span className="ml-auto text-2xs text-text-dim">{formatRelativeTime(project.lastOpenedAt)}</span>
                      </div>
                      <div className="mt-1 text-2xs text-text-dim break-all">{project.path}</div>
                    </button>
                  )
                })}
              </div>
            )}
            {error && (
              <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 p-3 text-xs text-red-200">
                {error}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
