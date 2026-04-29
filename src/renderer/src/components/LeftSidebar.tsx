import { useState } from 'react'
import {
  Film, Music, Image, FolderOpen, Search, Plus,
  Layers, ListTodo, ChevronRight, Clock, CheckCircle2,
  AlertCircle, Loader2, X, Tag, AlignLeft
} from 'lucide-react'
import clsx from 'clsx'
import type { EditorState, EditorActions } from '../store/useEditorStore'
import type { MediaAsset, BackgroundTask, LeftTab, SequenceSummary } from '../types'

type Props = Pick<EditorState, 'leftTab' | 'assets' | 'selectedAssetId' | 'tasks' | 'sequences'> &
  Pick<EditorActions, 'setLeftTab' | 'selectAsset' | 'removeAsset' | 'importMedia' | 'activateSequence'>

const TABS: { id: LeftTab; label: string; icon: React.ReactNode }[] = [
  { id: 'project', label: 'Project', icon: <Layers size={13} /> },
  { id: 'media', label: 'Media', icon: <Film size={13} /> },
  { id: 'tasks', label: 'Tasks', icon: <ListTodo size={13} /> },
]

export function LeftSidebar({ leftTab, setLeftTab, sequences, assets, selectedAssetId, selectAsset, removeAsset, importMedia, tasks, activateSequence }: Props) {
  return (
    <div className="flex flex-col h-full bg-surface-1 overflow-hidden">
      {/* Tabs */}
      <div className="flex items-center border-b border-border flex-shrink-0">
        {TABS.map(tab => (
          <button
            key={tab.id}
            onClick={() => setLeftTab(tab.id)}
            className={clsx(
              'flex items-center gap-1.5 flex-1 justify-center py-2 text-2xs font-medium transition-colors border-b-2',
              leftTab === tab.id
                ? 'text-accent border-accent'
                : 'text-text-secondary border-transparent hover:text-text-primary'
            )}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0">
        {leftTab === 'project' && <ProjectPanel sequences={sequences} activateSequence={activateSequence} />}
        {leftTab === 'media' && (
          <MediaPanel assets={assets} selectedAssetId={selectedAssetId} selectAsset={selectAsset} removeAsset={removeAsset} importMedia={importMedia} />
        )}
        {leftTab === 'tasks' && <TasksPanel tasks={tasks} />}
      </div>
    </div>
  )
}

// --- Project Panel ---
function ProjectPanel({ sequences, activateSequence }: { sequences: SequenceSummary[]; activateSequence: (sequenceId: string) => Promise<void> }) {
  const [expanded, setExpanded] = useState(true)

  return (
    <div className="p-2 space-y-1">
      <SectionHeader label="Sequences" expanded={expanded} onToggle={() => setExpanded(!expanded)} />
      {expanded && sequences.map((sequence) => (
        <button key={sequence.id} className={clsx(
          'w-full flex items-center gap-2 px-2 py-1.5 rounded text-2xs text-text-secondary hover:text-text-primary hover:bg-surface-3 transition-colors',
          sequence.active && 'bg-surface-3 text-text-primary'
        )} onClick={() => void activateSequence(sequence.id)}>
          <Film size={11} className="flex-shrink-0" />
          <span className="truncate">{sequence.name}</span>
          <span className="ml-auto text-text-dim">{Math.round(sequence.duration)}s</span>
        </button>
      ))}
    </div>
  )
}

// --- Media Panel ---
function MediaPanel({ assets, selectedAssetId, selectAsset, removeAsset, importMedia }: {
  assets: MediaAsset[]
  selectedAssetId: string | null
  selectAsset: (id: string | null) => void
  removeAsset: (id: string) => void
  importMedia: () => Promise<void>
}) {
  const [query, setQuery] = useState('')
  const filtered = assets.filter(a =>
    a.name.toLowerCase().includes(query.toLowerCase()) ||
    a.tags?.some(t => t.includes(query.toLowerCase()))
  )
  const videos = filtered.filter(a => a.type === 'video')
  const audios = filtered.filter(a => a.type === 'audio')
  const images = filtered.filter(a => a.type === 'image')

  return (
    <div className="flex flex-col gap-0">
      {/* Search + Import */}
      <div className="p-2 flex gap-1">
        <div className="flex-1 flex items-center gap-1.5 bg-surface-2 border border-border rounded px-2 py-1">
          <Search size={11} className="text-text-dim flex-shrink-0" />
          <input
            className="flex-1 bg-transparent text-2xs text-text-primary placeholder:text-text-dim outline-none"
            placeholder="Search media..."
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
        </div>
        <button className="p-1.5 bg-surface-3 hover:bg-surface-4 rounded border border-border text-text-secondary hover:text-text-primary transition-colors" onClick={() => void importMedia()}>
          <Plus size={12} />
        </button>
      </div>

      {/* Groups */}
      <MediaGroup label="Video" icon={<Film size={11} />} items={videos} selectedAssetId={selectedAssetId} selectAsset={selectAsset} removeAsset={removeAsset} />
      <MediaGroup label="Audio" icon={<Music size={11} />} items={audios} selectedAssetId={selectedAssetId} selectAsset={selectAsset} removeAsset={removeAsset} />
      <MediaGroup label="Images" icon={<Image size={11} />} items={images} selectedAssetId={selectedAssetId} selectAsset={selectAsset} removeAsset={removeAsset} />

      {/* Media picker */}
      <div className="m-2 border border-dashed border-border rounded-lg p-4 flex flex-col items-center gap-1 text-center hover:border-accent/50 hover:bg-accent-dim transition-colors cursor-pointer group" onClick={() => void importMedia()}>
        <FolderOpen size={18} className="text-text-dim group-hover:text-accent transition-colors" />
        <span className="text-2xs text-text-dim group-hover:text-text-secondary">Select media</span>
      </div>
    </div>
  )
}

function MediaGroup({ label, icon, items, selectedAssetId, selectAsset, removeAsset }: {
  label: string
  icon: React.ReactNode
  items: MediaAsset[]
  selectedAssetId: string | null
  selectAsset: (id: string | null) => void
  removeAsset: (id: string) => void
}) {
  const [open, setOpen] = useState(true)
  if (items.length === 0) return null
  return (
    <div className="mb-1">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-1.5 px-3 py-1 text-2xs text-text-dim hover:text-text-secondary transition-colors"
      >
        <ChevronRight size={10} className={clsx('transition-transform', open && 'rotate-90')} />
        {icon}
        {label} <span className="ml-auto opacity-50">{items.length}</span>
      </button>
      {open && items.map(asset => (
        <AssetRow key={asset.id} asset={asset} selected={asset.id === selectedAssetId} onSelect={() => selectAsset(asset.id)} onRemove={() => removeAsset(asset.id)} />
      ))}
    </div>
  )
}

function AssetRow({ asset, selected, onSelect, onRemove }: {
  asset: MediaAsset
  selected: boolean
  onSelect: () => void
  onRemove: () => void
}) {
  const [hover, setHover] = useState(false)
  const icon = asset.type === 'video' ? <Film size={11} /> : asset.type === 'audio' ? <Music size={11} /> : <Image size={11} />
  const color = asset.type === 'video' ? 'text-accent' : asset.type === 'audio' ? 'text-status-yellow' : 'text-status-green'

  return (
    <div
      className={clsx(
        'group flex items-center gap-2 px-3 py-1.5 cursor-pointer transition-colors relative',
        selected ? 'bg-accent-dim text-text-primary' : 'text-text-secondary hover:bg-surface-2 hover:text-text-primary'
      )}
      onClick={onSelect}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      <span className={color}>{icon}</span>
      <div className="flex-1 min-w-0">
        <div className="text-2xs truncate font-medium">{asset.name}</div>
        <div className="flex items-center gap-1 mt-0.5">
          {asset.duration && (
            <span className="text-2xs text-text-dim flex items-center gap-0.5">
              <Clock size={8} />{Math.floor(asset.duration)}s
            </span>
          )}
          {asset.transcript && asset.transcript.length > 0 && (
            <span className="text-2xs bg-accent-dim text-accent px-1 rounded flex items-center gap-0.5">
              <AlignLeft size={7} />{asset.transcript.length}
            </span>
          )}
          {asset.tags?.slice(0, 2).map(tag => (
            <span key={tag} className="text-2xs bg-surface-4 text-text-dim px-1 rounded flex items-center gap-0.5">
              <Tag size={7} />{tag}
            </span>
          ))}
        </div>
      </div>
      {hover && (
        <button
          className="absolute right-2 p-0.5 rounded hover:bg-surface-5 text-text-dim hover:text-status-red"
          onClick={e => { e.stopPropagation(); onRemove() }}
        >
          <X size={10} />
        </button>
      )}
    </div>
  )
}

// --- Tasks Panel ---
function TasksPanel({ tasks }: { tasks: BackgroundTask[] }) {
  const running = tasks.filter(t => t.status === 'running')
  const queued = tasks.filter(t => t.status === 'queued')
  const done = tasks.filter(t => t.status === 'done')

  if (tasks.length === 0) {
    return (
      <div className="p-3">
        <div className="bg-surface-2 border border-border rounded-lg p-3 text-2xs text-text-secondary leading-relaxed">
          No tracked background jobs. This list only shows real transcription, embedding, export, or analysis work after you start it.
        </div>
      </div>
    )
  }

  return (
    <div className="p-2 space-y-3">
      {running.length > 0 && (
        <div>
          <SectionHeader label={`Running (${running.length})`} expanded={true} onToggle={() => {}} />
          <div className="space-y-1">
            {running.map(t => <TaskRow key={t.id} task={t} />)}
          </div>
        </div>
      )}
      {queued.length > 0 && (
        <div>
          <SectionHeader label={`Queued (${queued.length})`} expanded={true} onToggle={() => {}} />
          <div className="space-y-1">
            {queued.map(t => <TaskRow key={t.id} task={t} />)}
          </div>
        </div>
      )}
      {done.length > 0 && (
        <div>
          <SectionHeader label="Completed" expanded={true} onToggle={() => {}} />
          <div className="space-y-1">
            {done.map(t => <TaskRow key={t.id} task={t} />)}
          </div>
        </div>
      )}
    </div>
  )
}

function TaskRow({ task }: { task: BackgroundTask }) {
  const statusIcon = {
    running: <Loader2 size={10} className="animate-spin text-accent" />,
    queued: <Clock size={10} className="text-text-dim" />,
    done: <CheckCircle2 size={10} className="text-status-green" />,
    error: <AlertCircle size={10} className="text-status-red" />,
  }[task.status]

  const typeColors: Record<BackgroundTask['type'], string> = {
    transcribe: 'bg-accent/20 text-accent',
    proxy: 'bg-blue-500/20 text-blue-400',
    embed: 'bg-green-500/20 text-green-400',
    export: 'bg-orange-500/20 text-orange-400',
    analyze: 'bg-sky-500/20 text-sky-400',
  }

  return (
    <div className="bg-surface-2 rounded p-2 space-y-1.5">
      <div className="flex items-center gap-1.5">
        {statusIcon}
        <span className="text-2xs text-text-primary flex-1 truncate">{task.label}</span>
        <span className={clsx('text-2xs px-1.5 py-0.5 rounded-full font-medium', typeColors[task.type])}>
          {task.type}
        </span>
      </div>
      {task.status === 'running' && (
        <div className="h-1 bg-surface-4 rounded-full overflow-hidden">
          <div
            className="h-full bg-accent rounded-full transition-all duration-300"
            style={{ width: `${task.progress}%` }}
          />
        </div>
      )}
    </div>
  )
}

function SectionHeader({ label, expanded, onToggle }: { label: string; expanded: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      className="w-full flex items-center gap-1 px-1 py-1 text-2xs text-text-dim hover:text-text-secondary transition-colors font-semibold uppercase tracking-wider"
    >
      <ChevronRight size={9} className={clsx('transition-transform', expanded && 'rotate-90')} />
      {label}
    </button>
  )
}
