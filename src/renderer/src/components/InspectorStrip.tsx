import { Tag, Clock, FileVideo, Mic } from 'lucide-react'
import type { EditorState } from '../store/useEditorStore'

type Props = Pick<EditorState, 'selectedClipId' | 'selectedAssetId' | 'assets' | 'playheadTime'>

export function InspectorStrip({ selectedClipId, selectedAssetId, assets, playheadTime }: Props) {
  const asset = selectedAssetId ? assets.find(a => a.id === selectedAssetId) : assets[0]
  const tags = asset?.tags?.slice(0, 2) ?? []
  const clipTypeIcon = asset?.type === 'audio' ? Mic : FileVideo
  const ClipTypeIcon = clipTypeIcon

  return (
    <div className="flex items-stretch gap-0 h-full bg-surface-1 border-t border-b border-border overflow-hidden">
      {/* Clip info */}
      <div className="flex items-center gap-3 px-3 border-r border-border min-w-0 flex-shrink-0 w-48">
        <div className="w-8 h-8 rounded bg-accent-dim border border-accent/20 flex items-center justify-center flex-shrink-0">
          <ClipTypeIcon size={14} className="text-accent" />
        </div>
        <div className="min-w-0">
          <div className="text-xs font-semibold text-text-primary truncate">
            {selectedClipId ? asset?.name ?? selectedClipId : asset?.name ?? 'No selection'}
          </div>
          <div className="flex items-center gap-2 text-2xs text-text-dim mt-0.5">
            <span className="flex items-center gap-0.5"><Clock size={8} />{Math.floor(playheadTime)}s</span>
            <span>{asset?.type ?? 'media'}</span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2 px-3 border-r border-border text-2xs text-text-dim min-w-0 flex-1">
        <span className="truncate">
          {asset?.path?.split('/').at(-1) ?? 'No media selected'}
        </span>
      </div>

      <div className="flex items-center gap-2 px-3 flex-shrink-0">
        <Tag size={11} className="text-text-dim flex-shrink-0" />
        <div className="flex items-center gap-1 flex-wrap">
          {tags.length > 0 ? tags.map(tag => (
            <span key={tag} className="text-2xs bg-accent-dim text-accent border border-accent/20 px-1.5 py-0.5 rounded-full">
              {tag}
            </span>
          )) : <span className="text-2xs text-text-dim">No tags</span>}
        </div>
      </div>
    </div>
  )
}
