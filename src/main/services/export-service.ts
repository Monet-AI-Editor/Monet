import { execFile, spawn } from 'child_process'
import { mkdtemp, writeFile } from 'fs/promises'
import { tmpdir } from 'os'
import { join } from 'path'
import { promisify } from 'util'
import type {
  Effect,
  EditorProjectRecord,
  ExportOptions,
  ExportResult,
  MediaAssetRecord,
  SequenceRecord,
  TransitionType,
  TimelineClipRecord,
  TimelineTrackRecord
} from '../../shared/editor'
import { ProjectStore } from './project-store'
import { EffectsService } from './effects-service'
import { resolveFfmpegBinary } from './media-binaries'

const execFileAsync = promisify(execFile)

const RESOLUTION_SIZE: Record<ExportOptions['resolution'], { width: number; height: number }> = {
  '720p': { width: 1280, height: 720 },
  '1080p': { width: 1920, height: 1080 },
  '4k': { width: 3840, height: 2160 }
}

const QUALITY_PRESETS: Record<ExportOptions['quality'], { crf: number; preset: string; audioBitrate: string }> = {
  draft: { crf: 28, preset: 'veryfast', audioBitrate: '128k' },
  standard: { crf: 22, preset: 'medium', audioBitrate: '160k' },
  high: { crf: 18, preset: 'slow', audioBitrate: '192k' }
}

const EXPORT_REFERENCE_SIZE = {
  width: 1920,
  height: 1080
}

type CanvasSize = {
  width: number
  height: number
}

function getSequenceCanvasSize(sequence: SequenceRecord, options: ExportOptions): CanvasSize {
  const preset = RESOLUTION_SIZE[options.resolution]
  const isPortrait = sequence.height > sequence.width
  if (!isPortrait) return preset
  return {
    width: preset.height,
    height: preset.width
  }
}

function getScaleFilter(canvasSize: CanvasSize): string {
  const { width, height } = canvasSize
  return `scale=${width}:${height}:force_original_aspect_ratio=decrease,pad=${width}:${height}:(ow-iw)/2:(oh-ih)/2,fps=24,setsar=1`
}

async function runFfmpeg(
  args: string[],
  options: {
    durationSeconds?: number
    onProgress?: (progress: number) => void
  } = {}
): Promise<void> {
  const { durationSeconds, onProgress } = options
  const ffmpegBinary = resolveFfmpegBinary()

  console.log('[export] ffmpeg', ffmpegBinary, args.join(' '))

  if (!onProgress || !durationSeconds || durationSeconds <= 0) {
    const { stderr } = await execFileAsync(ffmpegBinary, args, { maxBuffer: 50 * 1024 * 1024, encoding: 'utf8' }).catch((err) => {
      console.error('[export] ffmpeg error (execFile):', err.message)
      throw err
    })
    if (stderr) console.error('[export] ffmpeg stderr:', stderr.slice(-2000))
    return
  }

  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      ffmpegBinary,
      ['-progress', 'pipe:1', '-nostats', ...args],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    )

    let stdoutBuffer = ''
    let stderrBuffer = ''
    let lastProgress = 0
    const startedAt = Date.now()
    const warmupTimer = setInterval(() => {
      // Some FFmpeg filter graphs take a while before emitting the first progress event.
      // Advance a small amount so packaged builds do not appear frozen at the segment start.
      const elapsedMs = Date.now() - startedAt
      const syntheticProgress = Math.min(0.15, elapsedMs / 15000 * 0.15)
      if (syntheticProgress > lastProgress) {
        lastProgress = syntheticProgress
        onProgress(syntheticProgress)
      }
    }, 500)

    const handleProgressChunk = (chunk: string) => {
      stdoutBuffer += chunk
      const lines = stdoutBuffer.split(/\r?\n/)
      stdoutBuffer = lines.pop() ?? ''

      for (const line of lines) {
        const [rawKey, ...rawValue] = line.split('=')
        const key = rawKey?.trim()
        const value = rawValue.join('=').trim()
        if (!key) continue

        if (key === 'out_time_ms') {
          const outTimeMs = Number.parseFloat(value)
          if (Number.isFinite(outTimeMs) && outTimeMs >= 0) {
            const ratio = Math.max(0, Math.min(1, outTimeMs / (durationSeconds * 1_000_000)))
            if (ratio > lastProgress) {
              lastProgress = ratio
              onProgress(ratio)
            }
          }
        }

        if (key === 'progress' && value === 'end') {
          lastProgress = 1
          onProgress(1)
        }
      }
    }

    child.stdout.on('data', (chunk: Buffer | string) => {
      handleProgressChunk(String(chunk))
    })

    child.stderr.on('data', (chunk: Buffer | string) => {
      stderrBuffer += String(chunk)
    })

    child.on('error', (error) => {
      clearInterval(warmupTimer)
      reject(error)
    })

    child.on('close', (code) => {
      clearInterval(warmupTimer)
      if (code !== 0) console.error('[export] ffmpeg stderr:', stderrBuffer.slice(-3000))
      if (code === 0) {
        if (lastProgress < 1) onProgress(1)
        resolve()
        return
      }

      reject(new Error(stderrBuffer.trim() || `ffmpeg exited with code ${code}`))
    })
  })
}

type ExportProgress =
  | {
      stage: 'preparing' | 'rendering' | 'finalizing' | 'done'
      progress: number
      message: string
    }

function escapeDrawtextText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/,/g, '\\,')
}

function escapeDrawtextOptionValue(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/:/g, '\\:')
    .replace(/'/g, "\\'")
    .replace(/,/g, '\\,')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
}

function normalizeTextAlign(value: string | undefined): 'left' | 'center' | 'right' {
  if (value === 'left' || value === 'right') return value
  return 'center'
}

function buildDrawtextXExpression(textAlign: 'left' | 'center' | 'right', offsetExpr: string): string {
  switch (textAlign) {
    case 'left':
      return `${offsetExpr}`
    case 'right':
      return `w-text_w-(${offsetExpr})`
    default:
      return `(w-text_w)/2+(${offsetExpr})`
  }
}

function applyEasingExpression(progressExpr: string, easing?: Effect['keyframes'] extends Array<infer T> ? T['easing'] : never): string {
  switch (easing) {
    case 'ease_in':
      return `pow(${progressExpr},2)`
    case 'ease_out':
      return `(1-pow(1-(${progressExpr}),2))`
    case 'ease_in_out':
      return `if(lt(${progressExpr},0.5),2*pow(${progressExpr},2),1-pow(-2*(${progressExpr})+2,2)/2)`
    default:
      return progressExpr
  }
}

function getNumericKeyframeExpression(effect: Effect | undefined, key: string, fallback: number): string {
  if (!effect) return `${fallback}`
  const keyframes = [...(effect.keyframes ?? [])]
    .filter((frame) => typeof frame.parameters[key] === 'number')
    .sort((left, right) => left.time - right.time)

  if (keyframes.length === 0) {
    const baseValue = effect.parameters[key]
    return `${typeof baseValue === 'number' ? baseValue : fallback}`
  }

  const initialValue =
    typeof effect.parameters[key] === 'number'
      ? Number(effect.parameters[key])
      : Number(keyframes[0]?.parameters[key] ?? fallback)

  let expression = `${initialValue}`
  let previousTime = 0
  let previousValue = initialValue

  for (const keyframe of keyframes) {
    const nextValue = Number(keyframe.parameters[key])
    const span = Math.max(0.0001, keyframe.time - previousTime)
    const progressExpr = `max(0,min(1,(t-${previousTime})/${span}))`
    const eased = applyEasingExpression(progressExpr, keyframe.easing)
    const segmentExpr = `${previousValue}+(${nextValue}-${previousValue})*(${eased})`
    expression = `if(lt(t,${keyframe.time}),${segmentExpr},${expression})`
    previousTime = keyframe.time
    previousValue = nextValue
  }

  return expression
}

function getStringKeyframeValue(effect: Effect | undefined, key: string, fallback: string): string {
  if (!effect) return fallback
  const frames = [...(effect.keyframes ?? [])]
    .filter((frame) => typeof frame.parameters[key] === 'string')
    .sort((left, right) => left.time - right.time)
  const lastFrameValue = frames.at(-1)?.parameters[key]
  const baseValue = effect.parameters[key]
  if (typeof lastFrameValue === 'string') return lastFrameValue
  if (typeof baseValue === 'string') return baseValue
  return fallback
}

function normalizeHexColor(value: string | undefined, fallback = '#ffffff'): string {
  if (!value) return fallback
  const trimmed = value.trim()
  if (/^#[0-9a-fA-F]{6}$/.test(trimmed)) return trimmed.toLowerCase()
  if (/^#[0-9a-fA-F]{3}$/.test(trimmed)) {
    return `#${trimmed[1]}${trimmed[1]}${trimmed[2]}${trimmed[2]}${trimmed[3]}${trimmed[3]}`.toLowerCase()
  }
  return fallback
}

function parseHexColor(value: string | undefined, fallback = '#ffffff'): { r: number; g: number; b: number } {
  const normalized = normalizeHexColor(value, fallback)
  return {
    r: Number.parseInt(normalized.slice(1, 3), 16),
    g: Number.parseInt(normalized.slice(3, 5), 16),
    b: Number.parseInt(normalized.slice(5, 7), 16)
  }
}

function ffmpegColorWithOpacity(value: string | undefined, opacity: number, fallback = '#ffffff'): string {
  const normalized = normalizeHexColor(value, fallback)
  return `${normalized}@${Math.max(0, Math.min(1, opacity))}`
}

function buildGradientSourceGraph(
  outputLabel: string,
  width: number,
  height: number,
  duration: number,
  fromColor: string | undefined,
  toColor: string | undefined,
  angle: number,
  opacity: number
): string {
  const from = parseHexColor(fromColor)
  const to = parseHexColor(toColor)
  const radians = (angle * Math.PI) / 180
  const cos = Number(Math.cos(radians).toFixed(6))
  const sin = Number(Math.sin(radians).toFixed(6))
  const pointExpr = `max(0,min(1,0.5+(((X/W)-0.5)*${cos})+(((Y/H)-0.5)*${sin})))`

  return `nullsrc=s=${width}x${height}:d=${duration},format=rgba,geq=r='${from.r}+(${to.r}-${from.r})*(${pointExpr})':g='${from.g}+(${to.g}-${from.g})*(${pointExpr})':b='${from.b}+(${to.b}-${from.b})*(${pointExpr})':a='255*${Math.max(0, Math.min(1, opacity))}'[${outputLabel}]`
}

function getOpacityAlphaFilters(effect: Effect | undefined): string[] {
  if (!effect) return []
  const keyframes = [...(effect.keyframes ?? [])]
    .filter((frame) => typeof frame.parameters.opacity === 'number')
    .sort((left, right) => left.time - right.time)

  if (keyframes.length < 2) return []

  const filters: string[] = []
  const firstValue = Number(keyframes[0].parameters.opacity)
  const secondValue = Number(keyframes[1].parameters.opacity)
  if (firstValue <= 0.001 && secondValue >= 0.999) {
    const duration = Math.max(0.0001, keyframes[1].time - keyframes[0].time)
    filters.push(`fade=t=in:st=${keyframes[0].time}:d=${duration}:alpha=1`)
  }

  const lastValue = Number(keyframes[keyframes.length - 1].parameters.opacity)
  const previousValue = Number(keyframes[keyframes.length - 2].parameters.opacity)
  if (lastValue <= 0.001 && previousValue >= 0.999) {
    const start = keyframes[keyframes.length - 2].time
    const duration = Math.max(0.0001, keyframes[keyframes.length - 1].time - start)
    filters.push(`fade=t=out:st=${start}:d=${duration}:alpha=1`)
  }

  return filters
}

function hasRenderedMotionEffects(clip: TimelineClipRecord): boolean {
  return (clip.effects ?? []).some(
    (effect) =>
      effect.enabled &&
      (
        effect.type === 'transform' ||
        effect.type === 'text_overlay' ||
        effect.type === 'opacity' ||
        effect.type === 'drop_shadow' ||
        effect.type === 'glow' ||
        effect.type === 'background_fill' ||
        effect.type === 'gradient_fill' ||
        effect.type === 'shape_overlay'
      )
  )
}

function buildRenderedVideoFilterScript(
  clip: TimelineClipRecord,
  canvasSize: CanvasSize,
  effectsService: EffectsService
): string {
  const { width, height } = canvasSize
  const xScale = width / EXPORT_REFERENCE_SIZE.width
  const yScale = height / EXPORT_REFERENCE_SIZE.height
  const effects = clip.effects ?? []
  const transformEffect = effects.find((effect) => effect.enabled && effect.type === 'transform')
  const opacityEffect = effects.find((effect) => effect.enabled && effect.type === 'opacity')
  const textOverlayEffect = effects.find((effect) => effect.enabled && effect.type === 'text_overlay')

  const baseFilters: string[] = []
  if (clip.speed && clip.speed !== 1.0) {
    baseFilters.push(`setpts=${1 / clip.speed}*PTS`)
  }
  baseFilters.push(getScaleFilter(canvasSize))
  for (const effect of effects) {
    if (!effect.enabled) continue
    if (effect.type === 'speed_ramp' || effect.type === 'transform' || effect.type === 'opacity' || effect.type === 'text_overlay' || effect.type === 'blend_mode') {
      continue
    }
    const filter = effectsService.getEffectFilter({
      ...effect,
      parameters: {
        ...effect.parameters,
        clipDuration: clip.duration
      }
    })
    if (filter) baseFilters.push(filter)
  }

  const transformXExpr = `(${getNumericKeyframeExpression(transformEffect, 'x', Number(transformEffect?.parameters.x ?? 0))})*${xScale}`
  const transformYExpr = `(${getNumericKeyframeExpression(transformEffect, 'y', Number(transformEffect?.parameters.y ?? 0))})*${yScale}`
  const scaleXExpr = getNumericKeyframeExpression(
    transformEffect,
    'scaleX',
    Number(transformEffect?.parameters.scaleX ?? transformEffect?.parameters.scale ?? 1)
  )
  const scaleYExpr = getNumericKeyframeExpression(
    transformEffect,
    'scaleY',
    Number(transformEffect?.parameters.scaleY ?? transformEffect?.parameters.scale ?? 1)
  )
  const rotationExpr = getNumericKeyframeExpression(transformEffect, 'rotation', Number(transformEffect?.parameters.rotation ?? 0))
  const textOpacityExpr = getNumericKeyframeExpression(
    textOverlayEffect,
    'opacity',
    Number(textOverlayEffect?.parameters.opacity ?? 1)
  )
  const textXExpr = `(${getNumericKeyframeExpression(textOverlayEffect, 'x', Number(textOverlayEffect?.parameters.x ?? 0))})*${xScale}`
  const textYExpr = `(${getNumericKeyframeExpression(textOverlayEffect, 'y', Number(textOverlayEffect?.parameters.y ?? 0))})*${yScale}`
  const textFontSizeExpr = getNumericKeyframeExpression(
    textOverlayEffect,
    'fontSize',
    Number(textOverlayEffect?.parameters.fontSize ?? 64)
  )
  const scaledTextFontSizeExpr = `(${textFontSizeExpr})*${yScale}`
  const textValue = escapeDrawtextText(getStringKeyframeValue(textOverlayEffect, 'text', ''))
  const textColor = normalizeHexColor(getStringKeyframeValue(textOverlayEffect, 'color', '#ffffff'))
  const textAlign = normalizeTextAlign(getStringKeyframeValue(textOverlayEffect, 'textAlign', 'center'))
  const textXPositionExpr = buildDrawtextXExpression(textAlign, textXExpr)
  const textLineHeight = Math.max(0.7, Number(textOverlayEffect?.parameters.lineHeight ?? 1.05))
  const textLineSpacing = Math.max(0, Number(textOverlayEffect?.parameters.fontSize ?? 64) * (textLineHeight - 1) * yScale)
  const textStrokeWidth = Math.max(0, Number(textOverlayEffect?.parameters.strokeWidth ?? 0) * Math.min(xScale, yScale))
  const textStrokeColor = normalizeHexColor(getStringKeyframeValue(textOverlayEffect, 'strokeColor', '#000000'))
  const textFontFamily = getStringKeyframeValue(textOverlayEffect, 'fontFamily', '').trim()
  const alphaFilters = getOpacityAlphaFilters(opacityEffect)

  const lines = [
    `color=c=black:s=${width}x${height}:r=24:d=${clip.duration}[bg]`,
    `[0:v]${effectsService.combineFilters(baseFilters)},format=rgba[base]`,
    `[base]scale=w='max(2,trunc(iw*(${scaleXExpr})/2)*2)':h='max(2,trunc(ih*(${scaleYExpr})/2)*2)':eval=frame,rotate='(${rotationExpr})*PI/180':c=black@0:ow=rotw(iw):oh=roth(ih)${alphaFilters.length > 0 ? `,${alphaFilters.join(',')}` : ''}[fg]`,
    `[bg][fg]overlay=x='(W-w)/2+(${transformXExpr})':y='(H-h)/2+(${transformYExpr})':eval=frame[composite]`
  ]

  if (textValue.length > 0) {
    const drawtextOptions = [
      `text='${textValue}'`,
      `x='${textXPositionExpr}'`,
      `y='(h-text_h)/2+(${textYExpr})'`,
      `fontsize='${scaledTextFontSizeExpr}'`,
      `fontcolor=${textColor}`,
      `alpha='${textOpacityExpr}'`,
      `shadowcolor=black@0.55`,
      'shadowx=0',
      'shadowy=6',
      'fix_bounds=1'
    ]
    if (textLineSpacing > 0) drawtextOptions.push(`line_spacing=${textLineSpacing}`)
    if (textStrokeWidth > 0) {
      drawtextOptions.push(`borderw=${textStrokeWidth}`)
      drawtextOptions.push(`bordercolor=${textStrokeColor}`)
    }
    if (textFontFamily.length > 0) {
      const escapedFont = escapeDrawtextOptionValue(textFontFamily)
      if (textFontFamily.startsWith('/')) {
        drawtextOptions.push(`fontfile='${escapedFont}'`)
      } else {
        drawtextOptions.push(`font='${escapedFont}'`)
      }
    }
    lines.push(
      `[composite]drawtext=${drawtextOptions.join(':')}[v]`
    )
  } else {
    lines.push('[composite]null[v]')
  }

  return `${lines.join(';\n')}\n`
}

function getActiveSequence(project: EditorProjectRecord): SequenceRecord {
  const sequence = project.sequences.find((s) => s.active) ?? project.sequences[0]
  if (!sequence) throw new Error('No active sequence to export.')
  return sequence
}

function getPrimaryVideoClips(sequence: SequenceRecord): TimelineClipRecord[] {
  const videoTrack = sequence.tracks.find((t) => t.kind === 'video')
  if (!videoTrack || videoTrack.clips.length === 0)
    throw new Error('The active sequence has no video clips to export.')
  return [...videoTrack.clips].sort((a, b) => a.startTime - b.startTime)
}

type ActiveTrackClip = {
  clip: TimelineClipRecord
  asset: MediaAssetRecord
  track: TimelineTrackRecord
  trackIndex: number
  transition?: {
    type: TransitionType
    duration: number
    role: 'incoming' | 'outgoing'
    progressAtIntervalStart: number
  }
  sourceOffset: number
}

type TimelineInterval = {
  start: number
  end: number
  duration: number
  videoLayers: ActiveTrackClip[]
  audioLayers: ActiveTrackClip[]
}

export type IntervalRenderStrategy = 'image' | 'video' | 'audio-only' | 'composite'

function getAsset(project: EditorProjectRecord, assetId: string): MediaAssetRecord {
  const asset = project.assets.find((a) => a.id === assetId)
  if (!asset) throw new Error(`Missing asset: ${assetId}`)
  return asset
}

function getClipEndTimeRecord(clip: TimelineClipRecord): number {
  return clip.startTime + clip.duration
}

function getEffectiveTransitionRecord(
  previousClip: TimelineClipRecord | undefined,
  nextClip: TimelineClipRecord | undefined,
  previousAsset: MediaAssetRecord | undefined
): { type: TransitionType; duration: number; startTime: number; endTime: number } | null {
  if (!previousClip || !nextClip) return null
  const gap = Math.abs(getClipEndTimeRecord(previousClip) - nextClip.startTime)
  if (gap > 0.05) return null

  const transition = nextClip.transitionIn ?? previousClip.transitionOut
  if (!transition) return null

  const availablePreviousTail = Math.max(
    0,
    (previousAsset?.duration ?? previousClip.inPoint + previousClip.duration + transition.duration) - (previousClip.inPoint + previousClip.duration)
  )
  const duration = Math.max(
    0,
    Math.min(
      transition.duration,
      nextClip.duration,
      availablePreviousTail > 0 ? availablePreviousTail : transition.duration
    )
  )
  if (duration <= 0.001) return null

  return {
    type: transition.type,
    duration,
    startTime: nextClip.startTime,
    endTime: nextClip.startTime + duration
  }
}

function findActiveTrackClips(
  track: TimelineTrackRecord,
  assetLookup: Map<string, MediaAssetRecord>,
  time: number,
  trackIndex: number
): ActiveTrackClip[] {
  const sortedClips = [...track.clips].sort((left, right) => left.startTime - right.startTime)
  const activeClipIndex = sortedClips.findIndex((candidate) => time >= candidate.startTime && time < candidate.startTime + candidate.duration - 0.0001)
  if (activeClipIndex < 0) return []

  const activeClip = sortedClips[activeClipIndex]
  const activeAsset = assetLookup.get(activeClip.assetId)
  if (!activeAsset) return []

  const layers: ActiveTrackClip[] = [{
    clip: activeClip,
    asset: activeAsset,
    track,
    trackIndex,
    sourceOffset: Math.max(0, time - activeClip.startTime)
  }]

  const previousClip = activeClipIndex > 0 ? sortedClips[activeClipIndex - 1] : undefined
  const previousAsset = previousClip ? assetLookup.get(previousClip.assetId) : undefined
  const transition = getEffectiveTransitionRecord(previousClip, activeClip, previousAsset)

  if (previousClip && previousAsset && transition && time >= transition.startTime && time < transition.endTime) {
    const progress = Math.max(0, Math.min(1, (time - transition.startTime) / Math.max(0.0001, transition.duration)))
    layers[0].transition = {
      type: transition.type,
      duration: transition.duration,
      role: 'incoming',
      progressAtIntervalStart: progress
    }
    layers.push({
      clip: previousClip,
      asset: previousAsset,
      track,
      trackIndex,
      sourceOffset: previousClip.duration + (time - transition.startTime),
      transition: {
        type: transition.type,
        duration: transition.duration,
        role: 'outgoing',
        progressAtIntervalStart: progress
      }
    })
  }

  return layers
}

function buildTimelineIntervals(project: EditorProjectRecord, sequence: SequenceRecord): TimelineInterval[] {
  const times = new Set<number>([0, sequence.duration])
  const assetLookup = new Map(project.assets.map((asset) => [asset.id, asset]))
  for (const track of sequence.tracks) {
    if (track.kind !== 'video' && track.kind !== 'audio') continue
    const sortedClips = [...track.clips].sort((left, right) => left.startTime - right.startTime)
    for (let index = 0; index < sortedClips.length; index += 1) {
      const clip = sortedClips[index]
      times.add(Number(clip.startTime.toFixed(6)))
      times.add(Number((clip.startTime + clip.duration).toFixed(6)))
      const nextClip = sortedClips[index + 1]
      const previousAsset = assetLookup.get(clip.assetId)
      const transition = getEffectiveTransitionRecord(clip, nextClip, previousAsset)
      if (transition) {
        times.add(Number(transition.startTime.toFixed(6)))
        times.add(Number(transition.endTime.toFixed(6)))
      }
    }
  }

  const sortedTimes = [...times].sort((left, right) => left - right)
  const intervals: TimelineInterval[] = []

  for (let index = 0; index < sortedTimes.length - 1; index += 1) {
    const start = sortedTimes[index]
    const end = sortedTimes[index + 1]
    const duration = end - start
    if (duration <= 0.01) continue

    const videoLayers = sequence.tracks
      .flatMap((track, trackIndex) =>
        track.kind === 'video' ? findActiveTrackClips(track, assetLookup, start, trackIndex) : []
      )

    const audioLayers = sequence.tracks
      .flatMap((track, trackIndex) =>
        track.kind === 'audio' ? findActiveTrackClips(track, assetLookup, start, trackIndex) : []
      )

    if (videoLayers.length === 0 && audioLayers.length === 0) continue

    intervals.push({
      start,
      end,
      duration,
      videoLayers,
      audioLayers
    })
  }

  return intervals
}

async function createGapSegment(segmentPath: string, duration: number, options: ExportOptions, canvasSize: CanvasSize): Promise<void> {
  const { width, height } = canvasSize
  const quality = QUALITY_PRESETS[options.quality]
  await runFfmpeg([
    '-y',
    '-f', 'lavfi', '-i', `color=c=black:s=${width}x${height}:r=24:d=${duration}`,
    '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000',
    '-shortest',
    '-c:v', 'libx264', '-preset', quality.preset, '-crf', String(quality.crf), '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', quality.audioBitrate,
    segmentPath
  ], { durationSeconds: duration })
}

async function createImageSegment(
  segmentPath: string,
  asset: MediaAssetRecord,
  duration: number,
  options: ExportOptions,
  canvasSize: CanvasSize,
  onProgress?: (progress: number) => void
): Promise<void> {
  const quality = QUALITY_PRESETS[options.quality]
  await runFfmpeg([
    '-y',
    '-loop', '1', '-i', asset.path,
    '-f', 'lavfi', '-i', 'anullsrc=channel_layout=stereo:sample_rate=48000',
    '-t', `${duration}`,
    '-vf', getScaleFilter(canvasSize),
    '-shortest',
    '-c:v', 'libx264', '-preset', quality.preset, '-crf', String(quality.crf), '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-b:a', quality.audioBitrate,
    segmentPath
  ], { durationSeconds: duration, onProgress })
}

async function createVideoSegment(
  segmentPath: string,
  asset: MediaAssetRecord,
  clip: TimelineClipRecord,
  effectsService: EffectsService,
  options: ExportOptions,
  canvasSize: CanvasSize,
  onProgress?: (progress: number) => void
): Promise<void> {
  const quality = QUALITY_PRESETS[options.quality]

  if (hasRenderedMotionEffects(clip)) {
    const workDir = await mkdtemp(join(tmpdir(), 'ai-video-editor-export-filter-'))
    const scriptPath = join(workDir, `${clip.id}-filter-complex.txt`)
    const filterScript = buildRenderedVideoFilterScript(clip, canvasSize, effectsService)
    await writeFile(scriptPath, filterScript, 'utf8')

    const audioFilterParts: string[] = []
    if (clip.speed && clip.speed !== 1.0) {
      let remaining = clip.speed
      while (remaining > 2.0) {
        audioFilterParts.push('atempo=2.0')
        remaining /= 2.0
      }
      while (remaining < 0.5) {
        audioFilterParts.push('atempo=0.5')
        remaining /= 0.5
      }
      audioFilterParts.push(`atempo=${remaining.toFixed(4)}`)
    }
    if (clip.volume !== undefined && clip.volume !== 1.0) {
      audioFilterParts.push(`volume=${Math.max(0, Math.min(4, clip.volume))}`)
    }

    const args = [
      '-y',
      '-ss', `${clip.inPoint}`,
      '-t', `${clip.duration}`,
      '-i', asset.path,
      '-filter_complex_script', scriptPath,
      '-map', '[v]',
      '-map', '0:a?',
      '-c:v', 'libx264', '-preset', quality.preset, '-crf', String(quality.crf), '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-b:a', quality.audioBitrate
    ]
    if (audioFilterParts.length > 0) {
      args.push('-af', audioFilterParts.join(','))
    }
    args.push(segmentPath)
    await runFfmpeg(args, { durationSeconds: clip.duration, onProgress })
    return
  }

  // Video filter chain:
  // 1. Speed (setpts must come before scale to apply to raw PTS)
  // 2. Scale/pad/fps normalization
  // 3. Visual effects (color grade, blur, fade, etc.)
  const videoFilterParts: string[] = []

  if (clip.speed && clip.speed !== 1.0) {
    videoFilterParts.push(`setpts=${1 / clip.speed}*PTS`)
  }

  videoFilterParts.push(getScaleFilter(canvasSize))

  if (clip.effects && clip.effects.length > 0) {
    for (const effect of clip.effects) {
      // Skip fade effects from the effects-service here — they use absolute timestamps
      // which are unreliable after speed changes; opacity fades look better baked via eq
      if (effect.type === 'speed_ramp') continue // handled by setpts above
      const f = effectsService.getEffectFilter({
        ...effect,
        parameters: {
          ...effect.parameters,
          clipDuration: clip.duration
        }
      })
      if (f) videoFilterParts.push(f)
    }
  }

  // Audio filter chain: combine speed (atempo) and volume into a single -af
  const audioFilterParts: string[] = []

  if (clip.speed && clip.speed !== 1.0) {
    // atempo only handles 0.5–2.0; chain multiple for extreme values
    let remaining = clip.speed
    while (remaining > 2.0) {
      audioFilterParts.push('atempo=2.0')
      remaining /= 2.0
    }
    while (remaining < 0.5) {
      audioFilterParts.push('atempo=0.5')
      remaining /= 0.5
    }
    audioFilterParts.push(`atempo=${remaining.toFixed(4)}`)
  }

  if (clip.volume !== undefined && clip.volume !== 1.0) {
    audioFilterParts.push(`volume=${Math.max(0, Math.min(4, clip.volume))}`)
  }

  const args = [
    '-y',
    '-ss', `${clip.inPoint}`,
    '-t',  `${clip.duration}`,
    '-i',  asset.path,
    '-vf', effectsService.combineFilters(videoFilterParts),
    '-c:v', 'libx264', '-preset', quality.preset, '-crf', String(quality.crf), '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-b:a', quality.audioBitrate
  ]

  if (audioFilterParts.length > 0) {
    args.push('-af', audioFilterParts.join(','))
  }

  args.push(segmentPath)
  await runFfmpeg(args, { durationSeconds: clip.duration, onProgress })
}

async function createAudioOnlySegment(
  segmentPath: string,
  asset: MediaAssetRecord,
  clip: TimelineClipRecord,
  options: ExportOptions,
  canvasSize: CanvasSize,
  onProgress?: (progress: number) => void
): Promise<void> {
  const { width, height } = canvasSize
  const quality = QUALITY_PRESETS[options.quality]
  const audioFilterParts: string[] = []
  if (clip.volume !== undefined && clip.volume !== 1.0)
    audioFilterParts.push(`volume=${Math.max(0, Math.min(4, clip.volume))}`)

  const args = [
    '-y',
    '-f', 'lavfi', '-i', `color=c=black:s=${width}x${height}:r=24:d=${clip.duration}`,
    '-ss', `${clip.inPoint}`,
    '-t',  `${clip.duration}`,
    '-i',  asset.path,
    '-shortest',
    '-c:v', 'libx264', '-preset', quality.preset, '-crf', String(quality.crf), '-pix_fmt', 'yuv420p',
    '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-b:a', quality.audioBitrate
  ]

  if (audioFilterParts.length > 0) args.push('-af', audioFilterParts.join(','))
  args.push(segmentPath)
  await runFfmpeg(args, { durationSeconds: clip.duration, onProgress })
}

function mapBlendMode(mode: string): string {
  switch (mode) {
    case 'screen':
    case 'multiply':
    case 'overlay':
    case 'lighten':
      return mode
    default:
      return 'normal'
  }
}

function buildClipScopedNumericExpression(
  effect: Effect | undefined,
  key: string,
  fallback: number,
  clipLocalOffset: number
): string {
  const expr = getNumericKeyframeExpression(effect, key, fallback)
  if (clipLocalOffset === 0) return expr
  return expr.replace(/\bt\b/g, `(t+${clipLocalOffset})`)
}

function buildLayerCanvasFilter(
  inputLabel: string,
  outputLabel: string,
  clip: TimelineClipRecord,
  duration: number,
  clipLocalOffset: number,
  options: ExportOptions,
  canvasSize: CanvasSize,
  effectsService: EffectsService,
  layerIndex: number
): string[] {
  const { width, height } = canvasSize
  const xScale = width / EXPORT_REFERENCE_SIZE.width
  const yScale = height / EXPORT_REFERENCE_SIZE.height
  const effects = clip.effects ?? []
  const transformEffect = effects.find((effect) => effect.enabled && effect.type === 'transform')
  const opacityEffect = effects.find((effect) => effect.enabled && effect.type === 'opacity')
  const textOverlayEffect = effects.find((effect) => effect.enabled && effect.type === 'text_overlay')
  const chromaKeyEffect = effects.find((effect) => effect.enabled && effect.type === 'chroma_key')
  const maskBoxEffect = effects.find((effect) => effect.enabled && effect.type === 'mask_box')
  const dropShadowEffect = effects.find((effect) => effect.enabled && effect.type === 'drop_shadow')
  const glowEffect = effects.find((effect) => effect.enabled && effect.type === 'glow')
  const backgroundFillEffect = effects.find((effect) => effect.enabled && effect.type === 'background_fill')
  const gradientFillEffect = effects.find((effect) => effect.enabled && effect.type === 'gradient_fill')
  const shapeOverlayEffects = effects.filter((effect) => effect.enabled && effect.type === 'shape_overlay')

  const baseFilters: string[] = []
  if (clip.speed && clip.speed !== 1.0) {
    baseFilters.push(`setpts=${1 / clip.speed}*PTS`)
  }
  baseFilters.push(getScaleFilter(canvasSize))
  for (const effect of effects) {
    if (!effect.enabled) continue
    if (['speed_ramp', 'transform', 'opacity', 'text_overlay', 'blend_mode', 'chroma_key', 'mask_box', 'drop_shadow', 'glow', 'background_fill', 'gradient_fill', 'shape_overlay'].includes(effect.type)) {
      continue
    }
    const filter = effectsService.getEffectFilter({
      ...effect,
      parameters: {
        ...effect.parameters,
        clipDuration: clip.duration
      }
    })
    if (filter) baseFilters.push(filter)
  }

  const transformXExpr = `(${buildClipScopedNumericExpression(transformEffect, 'x', Number(transformEffect?.parameters.x ?? 0), clipLocalOffset)})*${xScale}`
  const transformYExpr = `(${buildClipScopedNumericExpression(transformEffect, 'y', Number(transformEffect?.parameters.y ?? 0), clipLocalOffset)})*${yScale}`
  const scaleXExpr = buildClipScopedNumericExpression(
    transformEffect,
    'scaleX',
    Number(transformEffect?.parameters.scaleX ?? transformEffect?.parameters.scale ?? 1),
    clipLocalOffset
  )
  const scaleYExpr = buildClipScopedNumericExpression(
    transformEffect,
    'scaleY',
    Number(transformEffect?.parameters.scaleY ?? transformEffect?.parameters.scale ?? 1),
    clipLocalOffset
  )
  const rotationExpr = buildClipScopedNumericExpression(
    transformEffect,
    'rotation',
    Number(transformEffect?.parameters.rotation ?? 0),
    clipLocalOffset
  )
  const textOpacityExpr = buildClipScopedNumericExpression(
    textOverlayEffect,
    'opacity',
    Number(textOverlayEffect?.parameters.opacity ?? 1),
    clipLocalOffset
  )
  const textXExpr = `(${buildClipScopedNumericExpression(textOverlayEffect, 'x', Number(textOverlayEffect?.parameters.x ?? 0), clipLocalOffset)})*${xScale}`
  const textYExpr = `(${buildClipScopedNumericExpression(textOverlayEffect, 'y', Number(textOverlayEffect?.parameters.y ?? 0), clipLocalOffset)})*${yScale}`
  const textFontSizeExpr = buildClipScopedNumericExpression(
    textOverlayEffect,
    'fontSize',
    Number(textOverlayEffect?.parameters.fontSize ?? 64),
    clipLocalOffset
  )
  const scaledTextFontSizeExpr = `(${textFontSizeExpr})*${yScale}`
  const textValue = escapeDrawtextText(getStringKeyframeValue(textOverlayEffect, 'text', ''))
  const textColor = normalizeHexColor(getStringKeyframeValue(textOverlayEffect, 'color', '#ffffff'))
  const textAlign = normalizeTextAlign(getStringKeyframeValue(textOverlayEffect, 'textAlign', 'center'))
  const textXPositionExpr = buildDrawtextXExpression(textAlign, textXExpr)
  const textLineHeight = Math.max(0.7, Number(textOverlayEffect?.parameters.lineHeight ?? 1.05))
  const textLineSpacing = Math.max(0, Number(textOverlayEffect?.parameters.fontSize ?? 64) * (textLineHeight - 1) * yScale)
  const textStrokeWidth = Math.max(0, Number(textOverlayEffect?.parameters.strokeWidth ?? 0) * Math.min(xScale, yScale))
  const textStrokeColor = normalizeHexColor(getStringKeyframeValue(textOverlayEffect, 'strokeColor', '#000000'))
  const textFontFamily = getStringKeyframeValue(textOverlayEffect, 'fontFamily', '').trim()
  const alphaFilters = getOpacityAlphaFilters(opacityEffect)
  const chromaColor = String(chromaKeyEffect?.parameters.color ?? '#00ff00').replace('#', '0x')
  const chromaSimilarity = Number(chromaKeyEffect?.parameters.similarity ?? 0.18)
  const chromaBlend = Number(chromaKeyEffect?.parameters.blend ?? 0.08)
  const maskX = Number(maskBoxEffect?.parameters.x ?? 0) * xScale
  const maskY = Number(maskBoxEffect?.parameters.y ?? 0) * yScale
  const maskWidth = Number(maskBoxEffect?.parameters.width ?? EXPORT_REFERENCE_SIZE.width) * xScale
  const maskHeight = Number(maskBoxEffect?.parameters.height ?? EXPORT_REFERENCE_SIZE.height) * yScale
  const dropShadowColor = parseHexColor(typeof dropShadowEffect?.parameters.color === 'string' ? String(dropShadowEffect.parameters.color) : undefined, '#000000')
  const dropShadowOpacity = Math.max(0, Math.min(1, Number(dropShadowEffect?.parameters.opacity ?? 0.45)))
  const dropShadowBlur = Math.max(0, Number(dropShadowEffect?.parameters.blur ?? 18))
  const dropShadowOffsetX = Number(dropShadowEffect?.parameters.offsetX ?? 0) * xScale
  const dropShadowOffsetY = Number(dropShadowEffect?.parameters.offsetY ?? 10) * yScale
  const glowColor = parseHexColor(typeof glowEffect?.parameters.color === 'string' ? String(glowEffect.parameters.color) : undefined, '#ffffff')
  const glowOpacity = Math.max(0, Math.min(1, Number(glowEffect?.parameters.opacity ?? 0.35)))
  const glowRadius = Math.max(0, Number(glowEffect?.parameters.radius ?? 18))
  const backgroundFillColor = ffmpegColorWithOpacity(
    typeof backgroundFillEffect?.parameters.color === 'string' ? String(backgroundFillEffect.parameters.color) : undefined,
    Number(backgroundFillEffect?.parameters.opacity ?? 1),
    '#000000'
  )
  const transitionAlphaFilters: string[] = []
  if (clipLocalOffset >= clip.duration && clip.transitionOut) {
    transitionAlphaFilters.push(`fade=t=out:st=0:d=${duration}:alpha=1`)
  } else if (clipLocalOffset === 0 && clip.transitionIn) {
    transitionAlphaFilters.push(`fade=t=in:st=0:d=${duration}:alpha=1`)
  }

  const lines = [
    `${inputLabel}${effectsService.combineFilters(baseFilters)},format=rgba${chromaKeyEffect ? `,colorkey=${chromaColor}:${chromaSimilarity}:${chromaBlend}` : ''}[src${layerIndex}]`,
    `color=c=${backgroundFillEffect ? backgroundFillColor : 'black@0'}:s=${width}x${height}:r=24:d=${duration},format=rgba[blank${layerIndex}]`,
    `[src${layerIndex}]scale=w='max(2,trunc(iw*(${scaleXExpr})/2)*2)':h='max(2,trunc(ih*(${scaleYExpr})/2)*2)':eval=frame,rotate='(${rotationExpr})*PI/180':c=black@0:ow=rotw(iw):oh=roth(ih)${alphaFilters.length > 0 ? `,${alphaFilters.join(',')}` : ''}${transitionAlphaFilters.length > 0 ? `,${transitionAlphaFilters.join(',')}` : ''}[fg${layerIndex}]`,
  ]

  let baseCanvasLabel = `blank${layerIndex}`
  if (gradientFillEffect) {
    const gradientLabel = `gradient${layerIndex}`
    lines.push(
      buildGradientSourceGraph(
        gradientLabel,
        width,
        height,
        duration,
        typeof gradientFillEffect.parameters.fromColor === 'string' ? String(gradientFillEffect.parameters.fromColor) : '#ffffff',
        typeof gradientFillEffect.parameters.toColor === 'string' ? String(gradientFillEffect.parameters.toColor) : '#ffffff',
        Number(gradientFillEffect.parameters.angle ?? 135),
        Number(gradientFillEffect.parameters.opacity ?? 1)
      ),
      `[${baseCanvasLabel}][${gradientLabel}]overlay=x=0:y=0:format=auto[basegrad${layerIndex}]`
    )
    baseCanvasLabel = `basegrad${layerIndex}`
  }

  lines.push(
    `[${baseCanvasLabel}][fg${layerIndex}]overlay=x='(W-w)/2+(${transformXExpr})':y='(H-h)/2+(${transformYExpr})':eval=frame[layer${layerIndex}base]`
  )

  let currentLabel = `layer${layerIndex}base`
  for (const shapeEffect of shapeOverlayEffects) {
    const shape = getStringKeyframeValue(shapeEffect, 'shape', 'rect')
    const shapeColor = ffmpegColorWithOpacity(
      getStringKeyframeValue(shapeEffect, 'color', '#ffffff'),
      Number(shapeEffect.parameters.opacity ?? 1),
      '#ffffff'
    )
    const xExpr = `(${buildClipScopedNumericExpression(shapeEffect, 'x', Number(shapeEffect.parameters.x ?? 0), clipLocalOffset)})*${xScale}`
    const yExpr = `(${buildClipScopedNumericExpression(shapeEffect, 'y', Number(shapeEffect.parameters.y ?? 0), clipLocalOffset)})*${yScale}`
    const widthExpr = `(${buildClipScopedNumericExpression(shapeEffect, 'width', Number(shapeEffect.parameters.width ?? 320), clipLocalOffset)})*${xScale}`
    const heightExpr = `(${buildClipScopedNumericExpression(shapeEffect, 'height', Number(shapeEffect.parameters.height ?? 180), clipLocalOffset)})*${yScale}`
    const strokeWidth = Math.max(0, Number(shapeEffect.parameters.strokeWidth ?? 0))
    const scaledStrokeWidth = Math.max(1, strokeWidth * Math.min(xScale, yScale))
    const boxThickness =
      shape === 'line'
        ? width >= height
          ? `max(1,${scaledStrokeWidth})`
          : `max(1,${scaledStrokeWidth})`
        : strokeWidth > 0
          ? `${scaledStrokeWidth}`
          : 'fill'

    lines.push(
      `[${currentLabel}]drawbox=x='${xExpr}':y='${yExpr}':w='${shape === 'line' && Number(shapeEffect.parameters.width ?? 320) >= Number(shapeEffect.parameters.height ?? 12) ? widthExpr : shape === 'line' ? `${scaledStrokeWidth}` : widthExpr}':h='${shape === 'line' && Number(shapeEffect.parameters.width ?? 320) >= Number(shapeEffect.parameters.height ?? 12) ? `${scaledStrokeWidth}` : heightExpr}':color=${shapeColor}:t=${boxThickness}[shape${layerIndex}_${shapeEffect.id}]`
    )
    currentLabel = `shape${layerIndex}_${shapeEffect.id}`
  }

  if (textValue.length > 0) {
    const drawtextOptions = [
      `text='${textValue}'`,
      `x='${textXPositionExpr}'`,
      `y='(h-text_h)/2+(${textYExpr})'`,
      `fontsize='${scaledTextFontSizeExpr}'`,
      `fontcolor=${textColor}`,
      `alpha='${textOpacityExpr}'`,
      `shadowcolor=black@0.55`,
      'shadowx=0',
      'shadowy=6',
      'fix_bounds=1'
    ]
    if (textLineSpacing > 0) drawtextOptions.push(`line_spacing=${textLineSpacing}`)
    if (textStrokeWidth > 0) {
      drawtextOptions.push(`borderw=${textStrokeWidth}`)
      drawtextOptions.push(`bordercolor=${textStrokeColor}`)
    }
    if (textFontFamily.length > 0) {
      const escapedFont = escapeDrawtextOptionValue(textFontFamily)
      if (textFontFamily.startsWith('/')) {
        drawtextOptions.push(`fontfile='${escapedFont}'`)
      } else {
        drawtextOptions.push(`font='${escapedFont}'`)
      }
    }
    lines.push(
      `[${currentLabel}]drawtext=${drawtextOptions.join(':')}[layer${layerIndex}text]`
    )
    currentLabel = `layer${layerIndex}text`
  }

  if (maskBoxEffect) {
    lines.push(
      `[${currentLabel}]format=rgba,geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='if(between(X,${maskX},${maskX + maskWidth})*between(Y,${maskY},${maskY + maskHeight}),alpha(X,Y),0)'[layer${layerIndex}masked]`
    )
    currentLabel = `layer${layerIndex}masked`
  }

  if (dropShadowEffect) {
    lines.push(
      `[${currentLabel}]split[layer${layerIndex}keep][layer${layerIndex}shadowsrc]`,
      `[layer${layerIndex}shadowsrc]lutrgb=r='val*0+${dropShadowColor.r}':g='val*0+${dropShadowColor.g}':b='val*0+${dropShadowColor.b}',colorchannelmixer=aa=${dropShadowOpacity},gblur=sigma=${dropShadowBlur}[layer${layerIndex}shadow]`,
      `color=c=black@0:s=${width}x${height}:r=24:d=${duration},format=rgba[layer${layerIndex}shadowblank]`,
      `[layer${layerIndex}shadowblank][layer${layerIndex}shadow]overlay=x=${dropShadowOffsetX}:y=${dropShadowOffsetY}:format=auto[layer${layerIndex}shadowcomp]`,
      `[layer${layerIndex}shadowcomp][layer${layerIndex}keep]overlay=x=0:y=0:format=auto[layer${layerIndex}shadowed]`
    )
    currentLabel = `layer${layerIndex}shadowed`
  }

  if (glowEffect) {
    lines.push(
      `[${currentLabel}]split[layer${layerIndex}glowkeep][layer${layerIndex}glowsrc]`,
      `[layer${layerIndex}glowsrc]lutrgb=r='val*0+${glowColor.r}':g='val*0+${glowColor.g}':b='val*0+${glowColor.b}',colorchannelmixer=aa=${glowOpacity},gblur=sigma=${glowRadius}[layer${layerIndex}glow]`,
      `color=c=black@0:s=${width}x${height}:r=24:d=${duration},format=rgba[layer${layerIndex}glowblank]`,
      `[layer${layerIndex}glowblank][layer${layerIndex}glow]overlay=x=0:y=0:format=auto[layer${layerIndex}glowcomp]`,
      `[layer${layerIndex}glowcomp][layer${layerIndex}glowkeep]overlay=x=0:y=0:format=auto[layer${layerIndex}glowed]`
    )
    currentLabel = `layer${layerIndex}glowed`
  }

  lines.push(`[${currentLabel}]null[${outputLabel}]`)
  return lines
}

async function createCompositeSegment(
  segmentPath: string,
  interval: TimelineInterval,
  options: ExportOptions,
  canvasSize: CanvasSize,
  effectsService: EffectsService,
  onProgress?: (progress: number) => void
): Promise<void> {
  const { width, height } = canvasSize
  const quality = QUALITY_PRESETS[options.quality]
  const workDir = await mkdtemp(join(tmpdir(), 'ai-video-editor-export-composite-'))
  const scriptPath = join(workDir, `composite-${interval.start.toFixed(3)}.txt`)
  const args: string[] = ['-y']
  const filterLines: string[] = []
  const audioLabels: string[] = []

  args.push('-f', 'lavfi', '-i', `color=c=black:s=${width}x${height}:r=24:d=${interval.duration}`)
  filterLines.push('[0:v]format=rgba[comp0]')

  let inputIndex = 1
  const sortedVideoLayers = [...interval.videoLayers].sort((left, right) => left.trackIndex - right.trackIndex)
  for (let layerIndex = 0; layerIndex < sortedVideoLayers.length; layerIndex += 1) {
    const layer = sortedVideoLayers[layerIndex]
    const clipOffset = layer.sourceOffset
    if (layer.asset.type === 'image') {
      args.push('-loop', '1', '-t', `${interval.duration}`, '-i', layer.asset.path)
    } else {
      args.push('-ss', `${layer.clip.inPoint + clipOffset}`, '-t', `${interval.duration}`, '-i', layer.asset.path)
    }

    const layerLabel = `layer${layerIndex}`
    filterLines.push(
      ...buildLayerCanvasFilter(`[${inputIndex}:v]`, layerLabel, layer.clip, interval.duration, clipOffset, options, canvasSize, effectsService, layerIndex)
    )

    const blendModeEffect = (layer.clip.effects ?? []).find((effect) => effect.enabled && effect.type === 'blend_mode')
    const blendMode = mapBlendMode(String(blendModeEffect?.parameters.mode ?? 'normal'))
    if (layerIndex === 0 || blendMode === 'normal') {
      filterLines.push(`[comp${layerIndex}][${layerLabel}]overlay=x=0:y=0:format=auto[comp${layerIndex + 1}]`)
    } else {
      filterLines.push(`[comp${layerIndex}][${layerLabel}]blend=all_mode=${blendMode}[comp${layerIndex + 1}]`)
    }

    inputIndex += 1
  }

  const effectiveAudioLayers = interval.audioLayers

  for (const [audioIndex, layer] of effectiveAudioLayers.entries()) {
    const clipOffset = layer.sourceOffset
    args.push('-ss', `${layer.clip.inPoint + clipOffset}`, '-t', `${interval.duration}`, '-i', layer.asset.path)
    const filters: string[] = []
    if (layer.clip.speed && layer.clip.speed !== 1.0) {
      let remaining = layer.clip.speed
      while (remaining > 2.0) {
        filters.push('atempo=2.0')
        remaining /= 2.0
      }
      while (remaining < 0.5) {
        filters.push('atempo=0.5')
        remaining /= 0.5
      }
      filters.push(`atempo=${remaining.toFixed(4)}`)
    }
    if (layer.clip.volume !== undefined && layer.clip.volume !== 1.0) {
      filters.push(`volume=${Math.max(0, Math.min(4, layer.clip.volume))}`)
    }
    if (layer.transition) {
      if (layer.transition.role === 'incoming') {
        filters.push(`afade=t=in:st=0:d=${interval.duration}`)
      } else {
        filters.push(`afade=t=out:st=0:d=${interval.duration}`)
      }
    }
    const audioLabel = `aud${audioIndex}`
    filterLines.push(
      filters.length > 0 ? `[${inputIndex}:a]${filters.join(',')}[${audioLabel}]` : `[${inputIndex}:a]anull[${audioLabel}]`
    )
    audioLabels.push(`[${audioLabel}]`)
    inputIndex += 1
  }

  if (audioLabels.length === 0) {
    filterLines.push(`anullsrc=channel_layout=stereo:sample_rate=48000:d=${interval.duration}[mixout]`)
  } else if (audioLabels.length === 1) {
    filterLines.push(`${audioLabels[0]}anull[mixout]`)
  } else {
    filterLines.push(`${audioLabels.join('')}amix=inputs=${audioLabels.length}:normalize=0:duration=longest[mixout]`)
  }

  const finalVideoLabel = `comp${sortedVideoLayers.length}`
  filterLines.push(`[${finalVideoLabel}]format=yuv420p[vout]`)
  await writeFile(scriptPath, `${filterLines.join(';\n')}\n`, 'utf8')

  args.push(
    '-filter_complex_script',
    scriptPath,
    '-map',
    '[vout]',
    '-map',
    '[mixout]',
    '-c:v',
    'libx264',
    '-preset',
    quality.preset,
    '-crf',
    String(quality.crf),
    '-pix_fmt',
    'yuv420p',
    '-c:a',
    'aac',
    '-ar',
    '48000',
    '-ac',
    '2',
    '-b:a',
    quality.audioBitrate,
    segmentPath
  )

  await runFfmpeg(args, { durationSeconds: interval.duration, onProgress })
}

export function getIntervalRenderStrategy(interval: Pick<TimelineInterval, 'videoLayers' | 'audioLayers'>): IntervalRenderStrategy {
  const hasSingleVideoLayer = interval.videoLayers.length === 1
  const hasNoVisualStacking = interval.videoLayers.length <= 1
  const hasNoAudioStacking = interval.audioLayers.length <= 1

  if (hasSingleVideoLayer && hasNoVisualStacking && hasNoAudioStacking) {
    const videoLayer = interval.videoLayers[0]
    const audioLayer = interval.audioLayers[0]
    const hasTransition = Boolean(videoLayer.transition || audioLayer?.transition)

    const sameSourceAudio =
      audioLayer &&
      audioLayer.asset.id === videoLayer.asset.id &&
      Math.abs(audioLayer.clip.inPoint - videoLayer.clip.inPoint) <= 0.05 &&
      Math.abs(audioLayer.clip.duration - videoLayer.clip.duration) <= 0.05

    if (!hasTransition && (!audioLayer || sameSourceAudio)) {
      return videoLayer.asset.type === 'image' ? 'image' : 'video'
    }
  }

  if (interval.videoLayers.length === 0 && interval.audioLayers.length === 1 && !interval.audioLayers[0].transition) {
    return 'audio-only'
  }

  return 'composite'
}

async function createIntervalSegment(
  segmentPath: string,
  interval: TimelineInterval,
  options: ExportOptions,
  canvasSize: CanvasSize,
  effectsService: EffectsService,
  onProgress?: (progress: number) => void
): Promise<void> {
  const strategy = getIntervalRenderStrategy(interval)

  if (strategy === 'image') {
    const videoLayer = interval.videoLayers[0]
    await createImageSegment(segmentPath, videoLayer.asset, interval.duration, options, canvasSize, onProgress)
    return
  }

  if (strategy === 'video') {
    const videoLayer = interval.videoLayers[0]
    const audioLayer = interval.audioLayers[0]
    const mergedClip: TimelineClipRecord = {
      ...videoLayer.clip,
      volume: audioLayer?.clip.volume ?? videoLayer.clip.volume,
      speed: audioLayer?.clip.speed ?? videoLayer.clip.speed
    }
    await createVideoSegment(segmentPath, videoLayer.asset, mergedClip, effectsService, options, canvasSize, onProgress)
    return
  }

  if (strategy === 'audio-only') {
    const audioLayer = interval.audioLayers[0]
    await createAudioOnlySegment(segmentPath, audioLayer.asset, audioLayer.clip, options, canvasSize, onProgress)
    return
  }

  await createCompositeSegment(segmentPath, interval, options, canvasSize, effectsService, onProgress)
}

export class ExportService {
  private readonly effectsService = new EffectsService()

  constructor(private readonly projectStore: ProjectStore) {}

  async exportActiveSequence(
    outputPath: string,
    options: ExportOptions = { quality: 'high', resolution: '1080p', format: 'mp4' },
    onProgress?: (progress: ExportProgress) => void
  ): Promise<ExportResult> {
    const project = this.projectStore.getProject()
    const sequence = getActiveSequence(project)
    const canvasSize = getSequenceCanvasSize(sequence, options)
    const intervals = buildTimelineIntervals(project, sequence)
    console.log('[export] intervals:', intervals.length, 'outputPath:', outputPath)
    if (intervals.length === 0) {
      throw new Error('The active sequence has no media to export.')
    }

    // Preview continues to feel visually continuous at the tail, but the old export
    // path would emit any trailing audio-only interval as black video. For v1, trim
    // the render graph to the last interval that actually contains picture.
    const lastVideoIntervalIndex = [...intervals]
      .map((interval) => interval.videoLayers.length > 0)
      .lastIndexOf(true)
    const exportIntervals =
      lastVideoIntervalIndex >= 0 ? intervals.slice(0, lastVideoIntervalIndex + 1) : intervals

    if (exportIntervals.length === 0) {
      throw new Error('The active sequence has no video to export.')
    }

    onProgress?.({
      stage: 'preparing',
      progress: 0.08,
      message: `Preparing ${exportIntervals.length} export segment${exportIntervals.length === 1 ? '' : 's'}…`
    })

    const workDir = await mkdtemp(join(tmpdir(), 'ai-video-editor-export-'))
    const concatEntries: string[] = []
    const quality = QUALITY_PRESETS[options.quality]
    const renderProgressStart = 0.08
    const renderProgressEnd = 0.9
    const finalizingProgressStart = 0.9
    const finalizingProgressEnd = 0.995
    const lastRenderedEnd = exportIntervals[exportIntervals.length - 1]?.end ?? sequence.duration

    let currentTime = 0
    for (const [index, interval] of exportIntervals.entries()) {
      const intervalStartProgress =
        renderProgressStart + (index / exportIntervals.length) * (renderProgressEnd - renderProgressStart)
      const intervalEndProgress =
        renderProgressStart + ((index + 1) / exportIntervals.length) * (renderProgressEnd - renderProgressStart)
      onProgress?.({
        stage: 'rendering',
        progress: intervalStartProgress,
        message: `Rendering segment ${index + 1} of ${exportIntervals.length}…`
      })

      // Fill gap with black if there's a hole in the timeline
      if (interval.start > currentTime + 0.05) {
        const gapDuration = interval.start - currentTime
        const gapPath = join(workDir, `gap-${index}.mp4`)
        await createGapSegment(gapPath, gapDuration, options, canvasSize)
        concatEntries.push(`file '${gapPath.replace(/'/g, "\\'")}'`)
        currentTime += gapDuration
      }

      const segPath = join(workDir, `seg-${index}.mp4`)
      const strategy = getIntervalRenderStrategy(interval)
      console.log(`[export] segment ${index + 1}/${exportIntervals.length} strategy=${strategy} duration=${interval.duration.toFixed(3)}s layers=v${interval.videoLayers.length}+a${interval.audioLayers.length}`)
      await createIntervalSegment(segPath, interval, options, canvasSize, this.effectsService, (segmentProgress) => {
        const interpolated =
          intervalStartProgress + (intervalEndProgress - intervalStartProgress) * Math.max(0, Math.min(1, segmentProgress))
        onProgress?.({
          stage: 'rendering',
          progress: interpolated,
          message: `Rendering segment ${index + 1} of ${exportIntervals.length}…`
        })
      })

      concatEntries.push(`file '${segPath.replace(/'/g, "\\'")}'`)
      currentTime = interval.end
    }

    const concatPath = join(workDir, 'concat.txt')
    await writeFile(concatPath, `${concatEntries.join('\n')}\n`, 'utf8')

    // Re-encode on concat so all segments share identical codec params
    onProgress?.({
      stage: 'finalizing',
      progress: finalizingProgressStart,
      message: 'Finalizing export…'
    })

    await runFfmpeg([
      '-y',
      '-f', 'concat', '-safe', '0', '-i', concatPath,
      '-c:v', 'libx264', '-preset', quality.preset, '-pix_fmt', 'yuv420p', '-crf', String(quality.crf),
      '-c:a', 'aac', '-b:a', quality.audioBitrate,
      '-movflags', '+faststart',
      outputPath
    ], {
      durationSeconds: lastRenderedEnd,
      onProgress: (concatProgress) => {
        const progress =
          finalizingProgressStart + (finalizingProgressEnd - finalizingProgressStart) * Math.max(0, Math.min(1, concatProgress))
        onProgress?.({
          stage: 'finalizing',
          progress,
          message: 'Finalizing export…'
        })
      }
    })

    onProgress?.({
      stage: 'done',
      progress: 1,
      message: 'Export complete.'
    })

    return {
      outputPath,
      sequenceName: sequence.name,
      duration: exportIntervals[exportIntervals.length - 1]?.end ?? sequence.duration
    }
  }
}
