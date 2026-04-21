import { useEffect, useMemo, useRef, useState } from 'react'
import { Minus, Plus } from 'lucide-react'
import clsx from 'clsx'
import type { EditorState, EditorActions } from '../store/useEditorStore'
import type { MediaAsset, Track, TimelineClip } from '../types'

type Props = Pick<EditorState, 'tracks' | 'assets' | 'selectedClipId' | 'playheadTime' | 'totalDuration' | 'zoom'> &
  Pick<EditorActions, 'selectClip' | 'setPlayheadTime' | 'setZoom' | 'addTrack'>

const TRACK_LABEL_W = 136
const BASE_PX_PER_SEC = 48
const MIN_TIMELINE_WIDTH = 640
const FIT_PADDING_PX = 80
const TARGET_MAJOR_TICK_PX = 96
const TICK_STEPS_SECONDS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600]
const MIN_WAVEFORM_SAMPLE_COUNT = 2048
const MAX_WAVEFORM_SAMPLE_COUNT = 16384
const MAX_WAVEFORM_CANVAS_CSS_WIDTH = 4096

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function formatTimeLabel(totalSeconds: number): string {
  if (totalSeconds >= 3600) {
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    return `${hours}h ${String(minutes).padStart(2, '0')}m`
  }
  if (totalSeconds >= 60) {
    const minutes = Math.floor(totalSeconds / 60)
    const seconds = Math.floor(totalSeconds % 60)
    return `${minutes}:${String(seconds).padStart(2, '0')}`
  }
  return `${Math.floor(totalSeconds)}s`
}

function getMajorTickStep(pxPerSecond: number): number {
  const desiredSeconds = TARGET_MAJOR_TICK_PX / Math.max(pxPerSecond, 0.0001)
  return TICK_STEPS_SECONDS.find((step) => step >= desiredSeconds) ?? TICK_STEPS_SECONDS[TICK_STEPS_SECONDS.length - 1]
}

export function Timeline({
  tracks,
  assets,
  selectedClipId,
  playheadTime,
  totalDuration,
  zoom,
  selectClip,
  setPlayheadTime,
  setZoom,
  addTrack
}: Props) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const surfaceRef = useRef<HTMLDivElement>(null)
  const [viewportWidth, setViewportWidth] = useState(960)
  const assetMap = useMemo(() => new Map(assets.map((asset) => [asset.id, asset])), [assets])

  useEffect(() => {
    const node = viewportRef.current
    if (!node) return

    const observer = new ResizeObserver(([entry]) => {
      const nextWidth = entry?.contentRect.width ?? node.clientWidth
      if (nextWidth > 0) setViewportWidth(nextWidth)
    })

    observer.observe(node)
    setViewportWidth(node.clientWidth || 960)
    return () => observer.disconnect()
  }, [])

  const fitZoom = useMemo(() => {
    if (totalDuration <= 0) return 1
    const width = Math.max(320, viewportWidth - FIT_PADDING_PX)
    return Math.max(0.01, Math.min(1, width / Math.max(totalDuration * BASE_PX_PER_SEC, 1)))
  }, [totalDuration, viewportWidth])

  const maxZoom = Math.max(8, fitZoom * 80)

  useEffect(() => {
    const clamped = clamp(zoom, fitZoom, maxZoom)
    if (Math.abs(clamped - zoom) > 0.0001) {
      setZoom(clamped)
    }
  }, [fitZoom, maxZoom, setZoom, zoom])

  const pxPerSecond = BASE_PX_PER_SEC * clamp(zoom, fitZoom, maxZoom)
  const totalW = Math.max(totalDuration * pxPerSecond, viewportWidth - 1, MIN_TIMELINE_WIDTH)
  const playheadX = playheadTime * pxPerSecond

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return

    const handleWheel = (event: WheelEvent) => {
      if (!event.ctrlKey && !event.metaKey) return

      event.preventDefault()
      const currentZoom = clamp(zoom, fitZoom, maxZoom)
      const nextZoom = clamp(currentZoom * Math.exp(-event.deltaY * 0.014), fitZoom, maxZoom)
      if (Math.abs(nextZoom - currentZoom) < 0.0001) return

      const rect = viewport.getBoundingClientRect()
      const pointerOffsetX = event.clientX - rect.left
      const timelineTime = (viewport.scrollLeft + pointerOffsetX) / pxPerSecond
      const nextPxPerSecond = BASE_PX_PER_SEC * nextZoom

      setZoom(nextZoom)
      window.requestAnimationFrame(() => {
        viewport.scrollLeft = Math.max(0, timelineTime * nextPxPerSecond - pointerOffsetX)
      })
    }

    viewport.addEventListener('wheel', handleWheel, { passive: false })
    return () => viewport.removeEventListener('wheel', handleWheel)
  }, [fitZoom, maxZoom, pxPerSecond, setZoom, zoom])

  const majorTickStep = getMajorTickStep(pxPerSecond)
  const minorDivisionCount = majorTickStep >= 60 ? 3 : 5
  const majorTicks: number[] = []
  for (let time = 0; time <= totalDuration + majorTickStep; time += majorTickStep) {
    majorTicks.push(time)
  }

  function selectClipAtTime(time: number) {
    const orderedTracks = [
      ...tracks.filter((track) => track.type === 'video'),
      ...tracks.filter((track) => track.type === 'audio'),
      ...tracks.filter((track) => track.type === 'caption')
    ]
    const clip =
      orderedTracks
        .flatMap((track) => track.clips)
        .find((candidate) => time >= candidate.startTime && time <= candidate.startTime + candidate.duration) ?? null
    selectClip(clip?.id ?? null)
  }

  function setPlayheadFromClientX(clientX: number) {
    const rect = surfaceRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = clientX - rect.left
    const nextTime = x / pxPerSecond
    const boundedTime = Math.max(0, Math.min(totalDuration, nextTime))
    setPlayheadTime(boundedTime)
    selectClipAtTime(boundedTime)
  }

  function handleTimelinePointerDown(event: React.PointerEvent) {
    setPlayheadFromClientX(event.clientX)
    const pointerTarget = event.currentTarget
    pointerTarget.setPointerCapture(event.pointerId)

    function move(nextEvent: PointerEvent) {
      setPlayheadFromClientX(nextEvent.clientX)
    }

    function up(nextEvent: PointerEvent) {
      setPlayheadFromClientX(nextEvent.clientX)
      pointerTarget.releasePointerCapture(nextEvent.pointerId)
      pointerTarget.removeEventListener('pointermove', move)
      pointerTarget.removeEventListener('pointerup', up)
    }

    pointerTarget.addEventListener('pointermove', move)
    pointerTarget.addEventListener('pointerup', up)
  }

  function adjustZoom(multiplier: number) {
    setZoom(clamp(zoom * multiplier, fitZoom, maxZoom))
  }

  return (
    <div className="flex flex-col h-full bg-surface-0 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-1.5 bg-surface-1 border-t border-b border-border flex-shrink-0">
        <span className="text-2xs text-text-dim uppercase tracking-wider font-semibold">Timeline</span>
        <span className="text-2xs text-text-dim">{formatTimeLabel(totalDuration)}</span>
        <div className="flex-1" />
        <div className="flex items-center gap-1">
          <button
            className="px-2 py-1 rounded bg-surface-3 hover:bg-surface-4 text-2xs text-text-secondary hover:text-text-primary transition-colors border border-border"
            onClick={() => setZoom(fitZoom)}
          >
            Fit
          </button>
          <button
            className="p-1 rounded bg-surface-3 hover:bg-surface-4 text-text-secondary hover:text-text-primary transition-colors border border-border"
            onClick={() => adjustZoom(0.8)}
            aria-label="Zoom out timeline"
          >
            <Minus size={10} />
          </button>
          <input
            type="range"
            min={fitZoom}
            max={maxZoom}
            step={Math.max((maxZoom - fitZoom) / 200, 0.005)}
            value={clamp(zoom, fitZoom, maxZoom)}
            onChange={(event) => setZoom(Number(event.target.value))}
            className="w-28 accent-[#c8d4e0]"
          />
          <button
            className="p-1 rounded bg-surface-3 hover:bg-surface-4 text-text-secondary hover:text-text-primary transition-colors border border-border"
            onClick={() => adjustZoom(1.25)}
            aria-label="Zoom in timeline"
          >
            <Plus size={10} />
          </button>
          <span className="text-2xs text-text-dim w-12 text-right">{clamp(zoom, fitZoom, maxZoom).toFixed(2)}x</span>
        </div>
        <button
          className="flex items-center gap-1 px-2 py-1 rounded bg-surface-3 hover:bg-surface-4 text-2xs text-text-secondary hover:text-text-primary transition-colors border border-border"
          onClick={() => void addTrack('video')}
        >
          <Plus size={10} /> Video
        </button>
        <button
          className="flex items-center gap-1 px-2 py-1 rounded bg-surface-3 hover:bg-surface-4 text-2xs text-text-secondary hover:text-text-primary transition-colors border border-border"
          onClick={() => void addTrack('audio')}
        >
          <Plus size={10} /> Audio
        </button>
      </div>

      <div className="flex flex-1 min-h-0 overflow-hidden">
        <div className="flex-shrink-0 overflow-hidden border-r border-border" style={{ width: TRACK_LABEL_W }}>
          <div className="h-6 bg-surface-1 border-b border-border" />
          <div className="overflow-y-auto h-full">
            {tracks.map((track) => (
              <TrackLabel key={track.id} track={track} />
            ))}
          </div>
        </div>

        <div ref={viewportRef} className="flex-1 overflow-auto min-w-0">
          <div ref={surfaceRef} style={{ width: totalW + FIT_PADDING_PX, minWidth: '100%' }}>
            <div
              className="relative h-6 bg-surface-1 border-b border-border cursor-pointer flex-shrink-0"
              onPointerDown={handleTimelinePointerDown}
              style={{ width: totalW + FIT_PADDING_PX }}
            >
              {majorTicks.map((time) => (
                <div
                  key={time}
                  className="absolute top-0 flex flex-col items-center"
                  style={{ left: time * pxPerSecond }}
                >
                  <div className="h-2.5 w-px bg-border" />
                  <span className="text-2xs text-text-dim mt-0.5 leading-none select-none">{formatTimeLabel(time)}</span>
                </div>
              ))}
              {majorTicks.flatMap((time) =>
                Array.from({ length: minorDivisionCount - 1 }, (_, index) => {
                  const tickTime = time + (majorTickStep / minorDivisionCount) * (index + 1)
                  if (tickTime >= totalDuration) return null
                  return (
                    <div
                      key={`${time}-${index + 1}`}
                      className="absolute top-0 h-1.5 w-px bg-surface-5"
                      style={{ left: tickTime * pxPerSecond }}
                    />
                  )
                }).filter(Boolean)
              )}
            </div>

            <div className="relative">
              {tracks.map((track) => (
                <TrackRow
                  key={track.id}
                  track={track}
                  pxPerSec={pxPerSecond}
                  selectedClipId={selectedClipId}
                  selectClip={selectClip}
                  onScrubStart={handleTimelinePointerDown}
                  assetMap={assetMap}
                />
              ))}

              <div
                className="absolute top-0 bottom-0 w-px bg-white/80 z-20 pointer-events-none"
                style={{ left: playheadX }}
              >
                <div className="w-2 h-2 bg-white rounded-full -translate-x-[3px] -translate-y-0.5" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function TrackLabel({ track }: { track: Track }) {
  const typeColors: Record<Track['type'], string> = {
    video: 'text-accent',
    audio: 'text-status-yellow',
    caption: 'text-text-dim'
  }

  return (
    <div
      className="flex items-center gap-1.5 px-2 border-b border-border bg-surface-1"
      style={{ height: track.height + 4 }}
    >
      <span className={clsx('text-2xs font-medium truncate flex-1', typeColors[track.type])}>{track.name}</span>
      <span className="text-[10px] text-text-dim tabular-nums">{track.clips.length}</span>
    </div>
  )
}

function TrackRow({
  track,
  pxPerSec,
  selectedClipId,
  selectClip,
  onScrubStart,
  assetMap
}: {
  track: Track
  pxPerSec: number
  selectedClipId: string | null
  selectClip: (id: string | null) => void
  onScrubStart: (event: React.PointerEvent) => void
  assetMap: Map<string, MediaAsset>
}) {
  return (
    <div
      className="relative border-b border-border bg-surface-0"
      style={{ height: track.height + 4 }}
      onPointerDown={onScrubStart}
    >
      {track.type === 'audio' && (
        <div
          className="absolute inset-0 opacity-[0.03]"
          style={{ backgroundImage: 'repeating-linear-gradient(90deg, #fff 0px, #fff 1px, transparent 1px, transparent 8px)' }}
        />
      )}

      {track.clips.map((clip) => (
        <Clip
          key={clip.id}
          clip={clip}
          trackType={track.type}
          trackHeight={track.height}
          pxPerSec={pxPerSec}
          selected={clip.id === selectedClipId}
          onSelect={() => selectClip(clip.id)}
          asset={assetMap.get(clip.assetId)}
        />
      ))}
    </div>
  )
}

function Clip({
  clip,
  trackType,
  trackHeight,
  pxPerSec,
  selected,
  onSelect,
  asset
}: {
  clip: TimelineClip
  trackType: Track['type']
  trackHeight: number
  pxPerSec: number
  selected: boolean
  onSelect: () => void
  asset?: MediaAsset
}) {
  const left = clip.startTime * pxPerSec
  const width = Math.max(clip.duration * pxPerSec, 8)

  return (
    <div
      className={clsx(
        'timeline-clip absolute top-0.5 rounded cursor-pointer flex items-center overflow-hidden border',
        selected ? 'ring-1 ring-white/60 border-white/40' : 'border-transparent hover:border-white/20'
      )}
      style={{
        left,
        width,
        height: trackHeight,
        background: `${clip.color}30`,
        borderColor: selected ? undefined : `${clip.color}60`
      }}
      onClick={onSelect}
    >
      <div className="absolute left-0 top-0 bottom-0 w-0.5 rounded-l" style={{ background: clip.color }} />

      {width > 40 && (
        <span
          className="text-2xs font-medium text-white/80 truncate relative z-[1]"
          style={{ maxWidth: width - 8, paddingLeft: 8, paddingRight: 8 }}
        >
          {clip.name}
        </span>
      )}

      {trackType === 'audio' && asset ? (
        <AudioWaveform
          filePath={asset.path}
          color={clip.color}
          width={width}
          clipDuration={clip.duration}
          clipInPoint={clip.inPoint}
          assetDuration={asset.duration ?? clip.duration}
        />
      ) : null}
    </div>
  )
}

function AudioWaveform({
  filePath,
  color,
  width,
  clipDuration,
  clipInPoint,
  assetDuration
}: {
  filePath: string
  color: string
  width: number
  clipDuration: number
  clipInPoint: number
  assetDuration: number
}) {
  const [peaks, setPeaks] = useState<number[] | null>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const sampleCount = clamp(Math.ceil(assetDuration * 4), MIN_WAVEFORM_SAMPLE_COUNT, MAX_WAVEFORM_SAMPLE_COUNT)

  useEffect(() => {
    let cancelled = false
    void window.api.getWaveform(filePath, sampleCount).then((nextPeaks) => {
      if (!cancelled) setPeaks(nextPeaks)
    }).catch(() => {
      if (!cancelled) setPeaks([])
    })

    return () => {
      cancelled = true
    }
  }, [filePath, sampleCount])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !peaks || peaks.length === 0) return

    const displayWidth = Math.max(1, Math.floor(width - 16))
    const cssWidth = Math.max(1, Math.floor(Math.min(displayWidth, MAX_WAVEFORM_CANVAS_CSS_WIDTH)))
    const cssHeight = 28
    const scale = window.devicePixelRatio || 1
    canvas.width = Math.max(1, Math.floor(cssWidth * scale))
    canvas.height = Math.max(1, Math.floor(cssHeight * scale))
    canvas.style.width = `${displayWidth}px`
    canvas.style.height = `${cssHeight}px`

    const context = canvas.getContext('2d')
    if (!context) return

    context.setTransform(scale, 0, 0, scale, 0, 0)
    context.clearRect(0, 0, cssWidth, cssHeight)
    context.strokeStyle = color
    context.globalAlpha = 0.72
    context.lineWidth = 1

    const duration = Math.max(assetDuration, 0.001)
    const startRatio = clamp(clipInPoint / duration, 0, 1)
    const endRatio = clamp((clipInPoint + clipDuration) / duration, 0, 1)
    const startIndex = Math.floor(startRatio * (peaks.length - 1))
    const endIndex = Math.max(startIndex + 1, Math.ceil(endRatio * (peaks.length - 1)))
    const visiblePeaks = peaks.slice(startIndex, endIndex + 1)
    const centerY = cssHeight / 2

    for (let x = 0; x < cssWidth; x += 1) {
      const sampleStart = Math.floor((x / cssWidth) * visiblePeaks.length)
      const sampleEnd = Math.max(sampleStart + 1, Math.ceil(((x + 1) / cssWidth) * visiblePeaks.length))
      let peak = 0
      for (let index = sampleStart; index < sampleEnd; index += 1) {
        peak = Math.max(peak, visiblePeaks[index] ?? 0)
      }
      const amplitude = Math.max(1, peak * centerY)
      context.beginPath()
      context.moveTo(x + 0.5, centerY - amplitude)
      context.lineTo(x + 0.5, centerY + amplitude)
      context.stroke()
    }
  }, [assetDuration, clipDuration, clipInPoint, color, peaks, width])

  if (!peaks || peaks.length === 0) return null

  return (
    <div className="absolute inset-x-2 inset-y-1 pointer-events-none flex items-center">
      <canvas ref={canvasRef} className="w-full h-7 opacity-60" />
    </div>
  )
}
