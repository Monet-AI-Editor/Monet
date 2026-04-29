import { useEffect, useState } from 'react'
import { Download, X } from 'lucide-react'
import clsx from 'clsx'
import type { ExportFormat, ExportOptions, ExportQuality, ExportResolution } from '../types'

type Props = {
  exportStatus: 'idle' | 'running'
  exportMessage: string | null
  exportProgress: number | null
  onClose: () => void
  onExport: (options: ExportOptions) => Promise<void>
}

const QUALITY_OPTIONS: Array<{ value: ExportQuality; label: string; description: string }> = [
  { value: 'draft', label: 'Draft', description: 'Fastest render, smallest file.' },
  { value: 'standard', label: 'Standard', description: 'Balanced quality and speed.' },
  { value: 'high', label: 'High', description: 'Best quality, slower export.' }
]

const RESOLUTION_OPTIONS: Array<{ value: ExportResolution; label: string }> = [
  { value: '720p', label: '1280×720' },
  { value: '1080p', label: '1920×1080' },
  { value: '4k', label: '3840×2160' }
]

const FORMAT_OPTIONS: Array<{ value: ExportFormat; label: string }> = [
  { value: 'mp4', label: 'MP4 (H.264)' },
  { value: 'mov', label: 'MOV' }
]

export function ExportModal({ exportStatus, exportMessage, exportProgress, onClose, onExport }: Props) {
  const [quality, setQuality] = useState<ExportQuality>('high')
  const [resolution, setResolution] = useState<ExportResolution>('1080p')
  const [format, setFormat] = useState<ExportFormat>('mp4')

  async function handleSubmit(event?: React.FormEvent) {
    event?.preventDefault()
    if (exportStatus === 'running') return
    await onExport({ quality, resolution, format })
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape' && exportStatus !== 'running') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [exportStatus, onClose])

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(event) => {
        if (event.target === event.currentTarget && exportStatus !== 'running') onClose()
      }}
    >
      <form className="w-[420px] overflow-hidden rounded-xl border border-border bg-surface-1 shadow-2xl" onSubmit={(event) => void handleSubmit(event)}>
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <div>
            <h2 className="text-sm font-semibold text-text-primary">Export</h2>
            <p className="mt-1 text-2xs text-text-dim">Choose a render preset for the active sequence.</p>
          </div>
          <button
            onClick={onClose}
            disabled={exportStatus === 'running'}
            className="rounded p-1 text-text-dim hover:bg-surface-3 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
          >
            <X size={14} />
          </button>
        </div>

        <div className="space-y-5 px-5 py-4">
          {exportStatus === 'running' && exportMessage && (
            <section className="rounded-lg border border-accent/20 bg-accent/10 px-3 py-2.5">
              <div className="flex items-center justify-between gap-3 text-xs font-medium text-text-primary">
                <span>Export in progress</span>
                {typeof exportProgress === 'number' && <span>{Math.round(exportProgress * 100)}%</span>}
              </div>
              <div className="mt-1 text-2xs text-text-dim">{exportMessage}</div>
              {typeof exportProgress === 'number' && (
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/10">
                  <div
                    className="h-full rounded-full bg-accent transition-[width] duration-300"
                    style={{ width: `${Math.max(6, Math.round(exportProgress * 100))}%` }}
                  />
                </div>
              )}
            </section>
          )}

          <section className="space-y-2">
            <label className="text-2xs font-medium uppercase tracking-wide text-text-dim">Quality</label>
            <div className="space-y-2">
              {QUALITY_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setQuality(option.value)}
                  className={clsx(
                    'w-full rounded-lg border px-3 py-2 text-left transition-colors',
                    quality === option.value
                      ? 'border-accent bg-accent-dim'
                      : 'border-border bg-surface-2 hover:bg-surface-3'
                  )}
                >
                  <div className="text-xs font-medium text-text-primary">{option.label}</div>
                  <div className="mt-1 text-2xs text-text-dim">{option.description}</div>
                </button>
              ))}
            </div>
          </section>

          <section className="space-y-2">
            <label className="text-2xs font-medium uppercase tracking-wide text-text-dim">Resolution</label>
            <select
              value={resolution}
              onChange={(event) => setResolution(event.target.value as ExportResolution)}
              className="w-full rounded border border-border bg-surface-2 px-2.5 py-2 text-xs text-text-primary outline-none focus:border-accent"
            >
              {RESOLUTION_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </section>

          <section className="space-y-2">
            <label className="text-2xs font-medium uppercase tracking-wide text-text-dim">Format</label>
            <select
              value={format}
              onChange={(event) => setFormat(event.target.value as ExportFormat)}
              className="w-full rounded border border-border bg-surface-2 px-2.5 py-2 text-xs text-text-primary outline-none focus:border-accent"
            >
              {FORMAT_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </section>
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-border bg-surface-0 px-5 py-3">
          <button
            type="button"
            onClick={onClose}
            disabled={exportStatus === 'running'}
            className="rounded px-3 py-1.5 text-xs text-text-secondary hover:bg-surface-3 hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={exportStatus === 'running'}
            className={clsx(
              'flex items-center gap-1.5 rounded px-3 py-1.5 text-xs font-semibold transition-colors',
              exportStatus === 'running'
                ? 'cursor-wait bg-surface-3 text-text-dim'
                : 'bg-accent text-black hover:bg-accent-hover'
            )}
          >
            <Download size={12} />
            {exportStatus === 'running' ? 'Exporting…' : 'Start Export'}
          </button>
        </div>
      </form>
    </div>
  )
}
