import { useState } from 'react'
import {
  FolderOpen, Upload, Undo2, Redo2, Save, Download,
  Play, Square, SkipBack, Settings, RefreshCw
} from 'lucide-react'
import clsx from 'clsx'
import type { EditorState, EditorActions } from '../store/useEditorStore'
import type { AppUpdateState } from '../types'

type Props = Pick<EditorState, 'projectName' | 'isPlaying' | 'playheadTime' | 'totalDuration' | 'exportStatus' | 'exportMessage' | 'exportProgress'> &
  Pick<EditorState, 'canUndo' | 'canRedo' | 'projectFilePath'> &
  Pick<EditorActions, 'setProjectName' | 'setIsPlaying' | 'setPlayheadTime' | 'importMedia' | 'saveProject' | 'undo' | 'redo'> & {
    appUpdateState: AppUpdateState
    onOpenProjects: () => void
    onOpenSettings: () => void
    onOpenExport: () => void
    onApplyUpdate: () => void
  }

function formatTime(s: number): string {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  const frames = Math.floor((s % 1) * 24)
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}:${String(frames).padStart(2, '0')}`
}

export function TopBar({
  projectName,
  setProjectName,
  importMedia,
  saveProject,
  undo,
  redo,
  canUndo,
  canRedo,
  projectFilePath,
  exportStatus,
  exportMessage,
  exportProgress,
  isPlaying,
  setIsPlaying,
  playheadTime,
  totalDuration,
  appUpdateState,
  onOpenProjects,
  onOpenSettings,
  onOpenExport,
  onApplyUpdate
}: Props) {
  const [editingName, setEditingName] = useState(false)
  const [nameVal, setNameVal] = useState(projectName)

  async function commitProjectName(): Promise<void> {
    const nextName = nameVal.trim() || projectName
    setNameVal(nextName)
    await setProjectName(nextName)
    setEditingName(false)
  }

  const shouldShowUpdateButton =
    appUpdateState.status === 'available' ||
    appUpdateState.status === 'downloading' ||
    appUpdateState.status === 'downloaded' ||
    appUpdateState.status === 'restarting'

  const downloadPct =
    appUpdateState.status === 'downloading' && appUpdateState.downloadProgress !== null
      ? ` ${Math.round(appUpdateState.downloadProgress * 100)}%`
      : ''

  const updateLabel =
    appUpdateState.status === 'available' ? 'Update' :
    appUpdateState.status === 'downloading' ? `Downloading…${downloadPct}` :
    appUpdateState.status === 'downloaded' ? 'Install' :
    appUpdateState.status === 'restarting' ? 'Restarting…' :
    ''

  const updateDisabled =
    appUpdateState.status === 'downloading' ||
    appUpdateState.status === 'downloaded' ||
    appUpdateState.status === 'restarting'

  return (
    <div className="drag-region flex items-center h-11 bg-surface-1 border-b border-border px-3 gap-2 flex-shrink-0">
      {/* macOS window buttons spacer */}
      <div className="no-drag w-16 flex-shrink-0" />

      {/* Project name */}
      <div className="no-drag flex items-center gap-1 mr-2">
        {editingName ? (
          <input
            autoFocus
            className="bg-surface-3 text-text-primary text-xs font-medium px-2 py-1 rounded outline-none border border-accent w-44"
            value={nameVal}
            onChange={e => setNameVal(e.target.value)}
            onBlur={() => { void commitProjectName() }}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault()
                void commitProjectName()
              }
              if (e.key === 'Escape') {
                setNameVal(projectName)
                setEditingName(false)
              }
            }}
          />
        ) : (
          <button
            className="text-text-primary text-xs font-semibold hover:text-accent transition-colors px-1"
            onClick={() => setEditingName(true)}
          >
            {projectName}
          </button>
        )}
      </div>

      <div className="no-drag h-4 w-px bg-border mx-1" />

      {/* File actions */}
      <div className="no-drag flex items-center gap-1">
        <button
          onClick={onOpenProjects}
          className="flex items-center gap-1.5 px-2 py-1 rounded bg-surface-2 hover:bg-surface-3 border border-border transition-colors text-xs text-text-primary"
        >
          <FolderOpen size={12} />
          <span>Projects</span>
        </button>
        <TopBtn icon={<Upload size={13} />} label="Import" onClick={() => void importMedia()} />
        <TopBtn icon={<Save size={13} />} label="Save" onClick={() => void saveProject()} />
      </div>

      <div className="no-drag max-w-[220px] truncate text-2xs text-text-dim">
        {projectFilePath ? projectFilePath.split('/').at(-1) : 'Unsaved project'}
      </div>

      <div className="no-drag h-4 w-px bg-border mx-1" />

      {/* Edit actions */}
      <div className="no-drag flex items-center gap-1">
        <TopBtn icon={<Undo2 size={13} />} label="Undo" onClick={() => void undo()} disabled={!canUndo} />
        <TopBtn icon={<Redo2 size={13} />} label="Redo" onClick={() => void redo()} disabled={!canRedo} />
      </div>

      <div className="no-drag h-4 w-px bg-border mx-1" />

      {/* Playback controls */}
      <div className="no-drag flex items-center gap-1">
        <TopBtn icon={<SkipBack size={13} />} label="Go to start" onClick={() => setPlayheadTime(0)} />
        <button
          className={clsx(
            'no-drag flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-colors',
            isPlaying
              ? 'bg-accent text-black hover:bg-accent-hover'
              : 'bg-surface-3 text-text-primary hover:bg-surface-4'
          )}
          onClick={() => setIsPlaying(!isPlaying)}
        >
          {isPlaying ? <Square size={11} /> : <Play size={11} />}
          {isPlaying ? 'Stop' : 'Play'}
        </button>
      </div>

      {/* Timecode */}
      <div className="no-drag ml-1 font-mono text-xs text-text-secondary bg-surface-2 px-2 py-1 rounded border border-border select-text">
        {formatTime(playheadTime)} / {formatTime(totalDuration)}
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {shouldShowUpdateButton && (
        <>
          <button
            className={clsx(
              'no-drag flex items-center gap-1.5 px-3 py-1 rounded text-xs font-semibold transition-colors',
              updateDisabled
                ? 'bg-blue-400/80 text-black cursor-wait'
                : 'bg-blue-500 text-white hover:bg-blue-400'
            )}
            onClick={onApplyUpdate}
            disabled={updateDisabled}
            title={appUpdateState.message}
          >
            <RefreshCw size={12} className={clsx((appUpdateState.status === 'downloading' || appUpdateState.status === 'restarting') && 'animate-spin')} />
            {updateLabel}
          </button>
          <div className="no-drag h-4 w-px bg-border mx-1" />
        </>
      )}

      {/* Settings */}
      <TopBtn icon={<Settings size={13} />} label="Settings" onClick={onOpenSettings} />

      <div className="no-drag h-4 w-px bg-border mx-1" />

      {/* Export */}
      <button
        className={clsx(
          'no-drag flex items-center gap-1.5 px-3 py-1 rounded text-black text-xs font-semibold transition-colors',
          exportStatus === 'running' ? 'bg-surface-3 text-text-dim cursor-wait' : 'bg-accent hover:bg-accent-hover'
        )}
        onClick={onOpenExport}
        disabled={exportStatus === 'running'}
      >
        <Download size={12} />
        {exportStatus === 'running' ? 'Exporting...' : 'Export…'}
      </button>
      {exportStatus === 'running' && exportMessage && (
        <div className="no-drag ml-2 max-w-[220px] truncate text-2xs text-text-dim">
          {typeof exportProgress === 'number'
            ? `${Math.round(exportProgress * 100)}% · ${exportMessage}`
            : exportMessage}
        </div>
      )}
    </div>
  )
}

function TopBtn({ icon, label, onClick, disabled }: { icon: React.ReactNode; label: string; onClick?: () => void; disabled?: boolean }) {
  return (
    <button
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        'no-drag p-1.5 rounded transition-colors',
        disabled
          ? 'text-text-dim opacity-40 cursor-not-allowed'
          : 'hover:bg-surface-3 text-text-secondary hover:text-text-primary'
      )}
    >
      {icon}
    </button>
  )
}
