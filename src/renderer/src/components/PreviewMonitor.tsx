import { useEffect, useMemo, useRef, useState } from 'react'
import { Play, Pause, SkipBack, SkipForward, Volume2, VolumeX, Maximize2, Scissors } from 'lucide-react'
import clsx from 'clsx'
import type { EditorState, EditorActions } from '../store/useEditorStore'
import type { MediaAsset, TimelineClip, Transition } from '../types'

type Props = Pick<EditorState, 'isPlaying' | 'playheadTime' | 'totalDuration' | 'selectedClipId' | 'selectedAssetId' | 'assets' | 'tracks' | 'activeSequenceWidth' | 'activeSequenceHeight'> &
  Pick<EditorActions, 'setIsPlaying' | 'setPlayheadTime' | 'splitSelectedClip'>

function formatTimecode(s: number): string {
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  const frames = Math.floor((s % 1) * 24)
  return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}:${String(frames).padStart(2, '0')}`
}

function applyEasing(progress: number, easing?: 'linear' | 'ease_in' | 'ease_out' | 'ease_in_out'): number {
  const t = Math.max(0, Math.min(1, progress))
  switch (easing) {
    case 'ease_in':
      return t * t
    case 'ease_out':
      return 1 - (1 - t) * (1 - t)
    case 'ease_in_out':
      return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2
    default:
      return t
  }
}

function resolveEffectParameters(
  effect: { parameters: Record<string, number | string | boolean>; keyframes?: Array<{ time: number; easing?: 'linear' | 'ease_in' | 'ease_out' | 'ease_in_out'; parameters: Record<string, number | string | boolean> }> } | undefined,
  time: number
): Record<string, number | string | boolean> {
  if (!effect) return {}

  const resolved: Record<string, number | string | boolean> = { ...effect.parameters }
  const keyframes = [...(effect.keyframes ?? [])].sort((left, right) => left.time - right.time)
  if (keyframes.length === 0) return resolved

  const keys = new Set<string>([
    ...Object.keys(effect.parameters ?? {}),
    ...keyframes.flatMap((keyframe) => Object.keys(keyframe.parameters ?? {}))
  ])

  for (const key of keys) {
    const previous = [...keyframes].reverse().find((keyframe) => key in keyframe.parameters && keyframe.time <= time)
    const next = keyframes.find((keyframe) => key in keyframe.parameters && keyframe.time >= time)

    if (!previous && !next) continue
    if (!previous) {
      resolved[key] = next!.parameters[key]
      continue
    }
    if (!next || previous === next) {
      resolved[key] = previous.parameters[key]
      continue
    }

    const previousValue = previous.parameters[key]
    const nextValue = next.parameters[key]
    if (typeof previousValue === 'number' && typeof nextValue === 'number') {
      const span = Math.max(0.0001, next.time - previous.time)
      const progress = applyEasing((time - previous.time) / span, next.easing ?? previous.easing)
      resolved[key] = previousValue + (nextValue - previousValue) * progress
    } else {
      resolved[key] = time - previous.time < next.time - time ? previousValue : nextValue
    }
  }

  return resolved
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

function hexToRgba(value: string | undefined, alpha = 1, fallback = '#ffffff'): string {
  const normalized = normalizeHexColor(value, fallback)
  const r = Number.parseInt(normalized.slice(1, 3), 16)
  const g = Number.parseInt(normalized.slice(3, 5), 16)
  const b = Number.parseInt(normalized.slice(5, 7), 16)
  const clampedAlpha = Math.max(0, Math.min(1, alpha))
  return `rgba(${r}, ${g}, ${b}, ${clampedAlpha})`
}

function buildGradientCss(
  fromColor: string | undefined,
  toColor: string | undefined,
  angle: number,
  opacity: number
): string {
  return `linear-gradient(${angle}deg, ${hexToRgba(fromColor, opacity)} 0%, ${hexToRgba(toColor, opacity)} 100%)`
}

function normalizeTextAlign(value: string | undefined): 'left' | 'center' | 'right' {
  if (value === 'left' || value === 'right') return value
  return 'center'
}

type ActivePreviewLayer = {
  clip: TimelineClip
  asset: MediaAsset
  clipLocalTime: number
  videoFileTime: number
  opacityMultiplier?: number
  audioGain?: number
}

type PreviewTrackLayer = ActivePreviewLayer & {
  trackIndex: number
  isVisible: boolean
}

type ClipTransitionWindow = {
  transition: Transition
  startTime: number
  endTime: number
  fromClipId: string
  toClipId: string
}

function getClipEndTime(clip: TimelineClip): number {
  return clip.startTime + clip.duration
}

function getEffectiveTransition(previousClip: TimelineClip | undefined, nextClip: TimelineClip | undefined, previousAsset?: MediaAsset): ClipTransitionWindow | null {
  if (!previousClip || !nextClip) return null
  const boundaryTime = nextClip.startTime
  const gap = Math.abs(getClipEndTime(previousClip) - boundaryTime)
  if (gap > 0.05) return null

  const transition = nextClip.transitionIn ?? previousClip.transitionOut
  if (!transition) return null

  const availablePreviousTail = Math.max(
    0,
    (previousAsset?.duration ?? getClipEndTime(previousClip) + transition.duration) - (previousClip.inPoint + previousClip.duration)
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
    transition: {
      ...transition,
      duration
    },
    startTime: boundaryTime,
    endTime: boundaryTime + duration,
    fromClipId: previousClip.id,
    toClipId: nextClip.id
  }
}

function PreviewLayer({
  layer,
  assetUrl,
  muted,
  audioMuted,
  canvasWidth,
  canvasHeight,
  hidden = false,
  onTogglePlay,
  registerVideoRef
}: {
  layer: ActivePreviewLayer
  assetUrl: string | null
  muted: boolean
  audioMuted: boolean
  canvasWidth: number
  canvasHeight: number
  hidden?: boolean
  onTogglePlay: () => void
  registerVideoRef: (clipId: string, node: HTMLVideoElement | null) => void
}) {
  const effects = layer.clip.effects ?? []
  const fadeIn = effects.find((effect) => effect.type === 'fade_in' && effect.enabled)
  const fadeOut = effects.find((effect) => effect.type === 'fade_out' && effect.enabled)
  const grade = effects.find((effect) => effect.type === 'color_grade' && effect.enabled)
  const blurEffect = effects.find((effect) => effect.type === 'blur' && effect.enabled)
  const sharpenEffect = effects.find((effect) => effect.type === 'sharpen' && effect.enabled)
  const transformEffect = effects.find((effect) => effect.type === 'transform' && effect.enabled)
  const opacityEffect = effects.find((effect) => effect.type === 'opacity' && effect.enabled)
  const blendModeEffect = effects.find((effect) => effect.type === 'blend_mode' && effect.enabled)
  const textOverlayEffect = effects.find((effect) => effect.type === 'text_overlay' && effect.enabled)
  const maskBoxEffect = effects.find((effect) => effect.type === 'mask_box' && effect.enabled)
  const dropShadowEffect = effects.find((effect) => effect.type === 'drop_shadow' && effect.enabled)
  const glowEffect = effects.find((effect) => effect.type === 'glow' && effect.enabled)
  const backgroundFillEffect = effects.find((effect) => effect.type === 'background_fill' && effect.enabled)
  const gradientFillEffect = effects.find((effect) => effect.type === 'gradient_fill' && effect.enabled)
  const shapeOverlayEffects = effects.filter((effect) => effect.type === 'shape_overlay' && effect.enabled)

  let videoOpacity = 1
  if (fadeIn) {
    const duration = Number(fadeIn.parameters.duration ?? 1)
    if (layer.clipLocalTime < duration) videoOpacity = Math.max(0, layer.clipLocalTime / duration)
  }
  if (fadeOut) {
    const duration = Number(fadeOut.parameters.duration ?? 1)
    const fadeStart = layer.clip.duration - duration
    if (layer.clipLocalTime > fadeStart) {
      videoOpacity = Math.min(videoOpacity, Math.max(0, 1 - (layer.clipLocalTime - fadeStart) / duration))
    }
  }

  const filterParts: string[] = []
  if (grade) {
    const brightness = 1 + (Number(grade.parameters.brightness ?? 0))
    const contrast = Number(grade.parameters.contrast ?? 1)
    const saturation = Number(grade.parameters.saturation ?? 1)
    filterParts.push(`brightness(${brightness}) contrast(${contrast}) saturate(${saturation})`)
  }
  if (blurEffect) filterParts.push(`blur(${Math.round(Number(blurEffect.parameters.radius ?? 5) * 0.6)}px)`)
  if (sharpenEffect) filterParts.push(`contrast(${1 + Number(sharpenEffect.parameters.amount ?? 1) * 0.08})`)

  const resolvedTransform = resolveEffectParameters(transformEffect, layer.clipLocalTime)
  const resolvedOpacity = resolveEffectParameters(opacityEffect, layer.clipLocalTime)
  const resolvedBlendMode = resolveEffectParameters(blendModeEffect, layer.clipLocalTime)
  const resolvedTextOverlay = resolveEffectParameters(textOverlayEffect, layer.clipLocalTime)
  const resolvedMaskBox = resolveEffectParameters(maskBoxEffect, layer.clipLocalTime)
  const resolvedDropShadow = resolveEffectParameters(dropShadowEffect, layer.clipLocalTime)
  const resolvedGlow = resolveEffectParameters(glowEffect, layer.clipLocalTime)
  const resolvedBackgroundFill = resolveEffectParameters(backgroundFillEffect, layer.clipLocalTime)
  const resolvedGradientFill = resolveEffectParameters(gradientFillEffect, layer.clipLocalTime)
  const transformX = Number(resolvedTransform.x ?? 0)
  const transformY = Number(resolvedTransform.y ?? 0)
  const scaleX = Number(resolvedTransform.scaleX ?? resolvedTransform.scale ?? 1)
  const scaleY = Number(resolvedTransform.scaleY ?? resolvedTransform.scale ?? 1)
  const rotation = Number(resolvedTransform.rotation ?? 0)
  const blendMode = String(resolvedBlendMode.mode ?? 'normal') as React.CSSProperties['mixBlendMode']
  videoOpacity *= Math.max(0, Math.min(1, Number(resolvedOpacity.opacity ?? 1)))
  videoOpacity *= Math.max(0, Math.min(1, layer.opacityMultiplier ?? 1))

  const textOverlayText = String(resolvedTextOverlay.text ?? '').trim()
  const textOverlayX = Number(resolvedTextOverlay.x ?? 0)
  const textOverlayY = Number(resolvedTextOverlay.y ?? 0)
  const textOverlayScale = Number(resolvedTextOverlay.scale ?? 1)
  const textOverlayRotation = Number(resolvedTextOverlay.rotation ?? 0)
  const textOverlayOpacity = Math.max(0, Math.min(1, Number(resolvedTextOverlay.opacity ?? 1)))
  const textOverlayFontSize = Number(resolvedTextOverlay.fontSize ?? 56)
  const textOverlayColor = normalizeHexColor(typeof resolvedTextOverlay.color === 'string' ? resolvedTextOverlay.color : undefined)
  const textOverlayFontFamily = typeof resolvedTextOverlay.fontFamily === 'string' && resolvedTextOverlay.fontFamily.trim().length > 0
    ? resolvedTextOverlay.fontFamily
    : undefined
  const textOverlayFontWeight = typeof resolvedTextOverlay.fontWeight === 'string' || typeof resolvedTextOverlay.fontWeight === 'number'
    ? resolvedTextOverlay.fontWeight
    : 600
  const textOverlayLetterSpacing = Number(resolvedTextOverlay.letterSpacing ?? 0)
  const textOverlayLineHeight = Math.max(0.7, Number(resolvedTextOverlay.lineHeight ?? 1.05))
  const textOverlayAlign = normalizeTextAlign(typeof resolvedTextOverlay.textAlign === 'string' ? resolvedTextOverlay.textAlign : undefined)
  const textOverlayMaxWidth = Math.max(0, Number(resolvedTextOverlay.maxWidth ?? 0))
  const textOverlayStrokeColor = normalizeHexColor(
    typeof resolvedTextOverlay.strokeColor === 'string' ? resolvedTextOverlay.strokeColor : undefined,
    '#000000'
  )
  const textOverlayStrokeWidth = Math.max(0, Number(resolvedTextOverlay.strokeWidth ?? 0))

  const clipPath = maskBoxEffect
    ? `inset(${Math.max(0, Number(resolvedMaskBox.y ?? 0))}px ${Math.max(0, canvasWidth - (Number(resolvedMaskBox.x ?? 0) + Number(resolvedMaskBox.width ?? canvasWidth)))}px ${Math.max(0, canvasHeight - (Number(resolvedMaskBox.y ?? 0) + Number(resolvedMaskBox.height ?? canvasHeight)))}px ${Math.max(0, Number(resolvedMaskBox.x ?? 0))}px)`
    : undefined
  const dropShadowColor = hexToRgba(
    typeof resolvedDropShadow.color === 'string' ? resolvedDropShadow.color : undefined,
    Number(resolvedDropShadow.opacity ?? 0.45),
    '#000000'
  )
  const dropShadowBlur = Math.max(0, Number(resolvedDropShadow.blur ?? 18))
  const dropShadowOffsetX = Number(resolvedDropShadow.offsetX ?? 0)
  const dropShadowOffsetY = Number(resolvedDropShadow.offsetY ?? 10)
  const glowColor = hexToRgba(
    typeof resolvedGlow.color === 'string' ? resolvedGlow.color : undefined,
    Number(resolvedGlow.opacity ?? 0.35),
    '#ffffff'
  )
  const glowRadius = Math.max(0, Number(resolvedGlow.radius ?? 18))
  const backgroundFillColor = hexToRgba(
    typeof resolvedBackgroundFill.color === 'string' ? resolvedBackgroundFill.color : undefined,
    Number(resolvedBackgroundFill.opacity ?? 1),
    '#000000'
  )
  const gradientFillCss = buildGradientCss(
    typeof resolvedGradientFill.fromColor === 'string' ? resolvedGradientFill.fromColor : undefined,
    typeof resolvedGradientFill.toColor === 'string' ? resolvedGradientFill.toColor : undefined,
    Number(resolvedGradientFill.angle ?? 135),
    Number(resolvedGradientFill.opacity ?? 1)
  )

  if (dropShadowEffect) {
    filterParts.push(`drop-shadow(${dropShadowOffsetX}px ${dropShadowOffsetY}px ${dropShadowBlur}px ${dropShadowColor})`)
  }
  if (glowEffect) {
    filterParts.push(`drop-shadow(0 0 ${glowRadius}px ${glowColor})`)
    filterParts.push(`drop-shadow(0 0 ${Math.max(2, glowRadius * 0.45)}px ${glowColor})`)
  }

  return (
    <div
      className="absolute inset-0 flex items-center justify-center"
      style={{
        opacity: hidden ? 0 : videoOpacity,
        filter: filterParts.join(' ') || undefined,
        transform: `translate(${transformX}px, ${transformY}px) rotate(${rotation}deg) scale(${scaleX}, ${scaleY})`,
        mixBlendMode: blendMode,
        transformOrigin: 'center center',
        clipPath,
        backgroundColor: backgroundFillEffect ? backgroundFillColor : undefined,
        backgroundImage: gradientFillEffect ? gradientFillCss : undefined,
        pointerEvents: hidden ? 'none' : undefined,
        visibility: hidden ? 'hidden' : undefined
      }}
    >
      {layer.asset.type === 'video' && assetUrl ? (
        <video
          ref={(node) => registerVideoRef(layer.clip.id, node)}
          src={assetUrl}
          className="w-full h-full object-contain bg-transparent"
          controls={false}
          playsInline
          muted={muted || audioMuted}
          preload="auto"
          onClick={onTogglePlay}
        />
      ) : layer.asset.type === 'image' && assetUrl ? (
        <img src={assetUrl} alt={layer.asset.name} className="w-full h-full object-contain bg-transparent" />
      ) : null}

      {shapeOverlayEffects.map((shapeEffect) => {
        const resolvedShape = resolveEffectParameters(shapeEffect, layer.clipLocalTime)
        const shape = String(resolvedShape.shape ?? 'rect')
        const x = Number(resolvedShape.x ?? 0)
        const y = Number(resolvedShape.y ?? 0)
        const width = Math.max(1, Number(resolvedShape.width ?? 320))
        const height = Math.max(1, Number(resolvedShape.height ?? 180))
        const opacity = Math.max(0, Math.min(1, Number(resolvedShape.opacity ?? 1)))
        const color = hexToRgba(typeof resolvedShape.color === 'string' ? resolvedShape.color : undefined, opacity)
        const strokeWidth = Math.max(0, Number(resolvedShape.strokeWidth ?? 0))
        const lineThickness = shape === 'line'
          ? (width >= height ? Math.max(1, strokeWidth || height) : Math.max(1, strokeWidth || width))
          : strokeWidth

        return (
          <div
            key={shapeEffect.id}
            className="absolute pointer-events-none"
            style={{
              left: `${x}px`,
              top: `${y}px`,
              width: `${width}px`,
              height: `${height}px`,
              backgroundColor: shape === 'rect' && lineThickness <= 0 ? color : 'transparent',
              border:
                shape === 'rect' && lineThickness > 0
                  ? `${lineThickness}px solid ${color}`
                  : undefined,
              ...(shape === 'line'
                ? width >= height
                  ? { height: `${lineThickness}px`, backgroundColor: color }
                  : { width: `${lineThickness}px`, backgroundColor: color }
                : {})
            }}
          />
        )
      })}

      {textOverlayText ? (
        <div
          className="absolute inset-0 pointer-events-none flex items-center justify-center px-8"
          style={{
            opacity: textOverlayOpacity,
            transform: `translate(${textOverlayX}px, ${textOverlayY}px) rotate(${textOverlayRotation}deg) scale(${textOverlayScale})`,
            transformOrigin: 'center center'
          }}
        >
          <div
            className="drop-shadow-[0_6px_24px_rgba(0,0,0,0.55)] whitespace-pre-wrap break-words"
            style={{
              width: textOverlayMaxWidth > 0 ? `${textOverlayMaxWidth}px` : '85%',
              maxWidth: textOverlayMaxWidth > 0 ? `${textOverlayMaxWidth}px` : '85%',
              fontSize: `${textOverlayFontSize}px`,
              lineHeight: textOverlayLineHeight,
              color: textOverlayColor,
              textAlign: textOverlayAlign,
              fontFamily: textOverlayFontFamily,
              fontWeight: textOverlayFontWeight,
              letterSpacing: `${textOverlayLetterSpacing}px`,
              WebkitTextStrokeColor: textOverlayStrokeColor,
              WebkitTextStrokeWidth: textOverlayStrokeWidth > 0 ? `${textOverlayStrokeWidth}px` : undefined,
              paintOrder: 'stroke fill'
            }}
          >
            {textOverlayText}
          </div>
        </div>
      ) : null}
    </div>
  )
}

export function PreviewMonitor({
  isPlaying,
  setIsPlaying,
  playheadTime,
  setPlayheadTime,
  totalDuration,
  activeSequenceWidth,
  activeSequenceHeight,
  selectedClipId,
  selectedAssetId,
  assets,
  tracks,
  splitSelectedClip
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const layerVideoRefs = useRef<Record<string, HTMLVideoElement | null>>({})
  const layerAudioRefs = useRef<Record<string, HTMLAudioElement | null>>({})
  const rafRef = useRef<number | null>(null)
  const playbackGenerationRef = useRef(0)
  const playbackAnchorRef = useRef<{ startedAt: number; basePlayhead: number } | null>(null)
  const [muted, setMuted] = useState(false)
  const [resolvedPreviewPaths, setResolvedPreviewPaths] = useState<Record<string, { path: string; cacheKey: string }>>({})

  const getPreviewCacheKey = (previewAsset: Pick<MediaAsset, 'path' | 'type'>) => `${previewAsset.type}:${previewAsset.path}`
  const isPlayheadInsideClip = (clip: { startTime: number; duration: number }, time: number) =>
    time >= clip.startTime && time < clip.startTime + clip.duration
  const buildTrackPreviewLayers = (kind: 'video' | 'audio'): PreviewTrackLayer[] => {
    const assetMap = new Map(assets.map((asset) => [asset.id, asset]))

    return tracks
      .filter((track) => track.type === kind)
      .flatMap((track, trackIndex) => {
        const sortedClips = [...track.clips].sort((left, right) => left.startTime - right.startTime)
        const activeClipIndex = sortedClips.findIndex((candidate) => isPlayheadInsideClip(candidate, playheadTime))
        const activeClip = activeClipIndex >= 0 ? sortedClips[activeClipIndex] : null
        const previousClip = activeClipIndex > 0 ? sortedClips[activeClipIndex - 1] : null
        const nextClip = activeClipIndex >= 0 && activeClipIndex < sortedClips.length - 1 ? sortedClips[activeClipIndex + 1] : null
        const previousAsset = previousClip ? assetMap.get(previousClip.assetId) : undefined
        const outgoingTransition = activeClip ? getEffectiveTransition(previousClip ?? undefined, activeClip, previousAsset) : null
        const inOutgoingWindow =
          Boolean(outgoingTransition) &&
          playheadTime >= (outgoingTransition?.startTime ?? 0) &&
          playheadTime < (outgoingTransition?.endTime ?? 0)
        const transitionProgress = outgoingTransition
          ? Math.max(
              0,
              Math.min(
                1,
                (playheadTime - outgoingTransition.startTime) / Math.max(0.0001, outgoingTransition.transition.duration)
              )
            )
          : 0

        const layers: Array<PreviewTrackLayer | null> = []

        if (activeClip) {
          const asset = assetMap.get(activeClip.assetId)
          if (asset) {
            layers.push({
              clip: activeClip,
              asset,
              clipLocalTime: Math.max(0, playheadTime - activeClip.startTime),
              videoFileTime: activeClip.inPoint + Math.max(0, playheadTime - activeClip.startTime),
              opacityMultiplier: inOutgoingWindow ? transitionProgress : 1,
              audioGain: inOutgoingWindow ? transitionProgress : 1,
              trackIndex,
              isVisible: true
            })
          }
        }

        if (activeClip && previousClip && previousAsset && outgoingTransition && inOutgoingWindow) {
          const tailOffset = playheadTime - outgoingTransition.startTime
          layers.push({
            clip: previousClip,
            asset: previousAsset,
            clipLocalTime: previousClip.duration + tailOffset,
            videoFileTime: previousClip.inPoint + previousClip.duration + tailOffset,
            opacityMultiplier: 1 - transitionProgress,
            audioGain: 1 - transitionProgress,
            trackIndex,
            isVisible: true
          })
        }

        if (nextClip) {
          const asset = assetMap.get(nextClip.assetId)
          if (asset) {
            layers.push({
              clip: nextClip,
              asset,
              clipLocalTime: 0,
              videoFileTime: nextClip.inPoint,
              trackIndex,
              isVisible: false
            })
          }
        }

        return layers
          .filter((layer): layer is PreviewTrackLayer => Boolean(layer))

      })
      .sort((left, right) => left.trackIndex - right.trackIndex)
  }

  const videoClips = useMemo(
    () =>
      tracks
        .filter((track) => track.type === 'video')
        .flatMap((track) => track.clips)
        .sort((left, right) => left.startTime - right.startTime),
    [tracks]
  )
  const audioClips = useMemo(
    () =>
      tracks
        .filter((track) => track.type === 'audio')
        .flatMap((track) => track.clips)
        .sort((left, right) => left.startTime - right.startTime),
    [tracks]
  )
  const previewClips = videoClips.length > 0 ? videoClips : audioClips
  const selectedAsset = selectedAssetId ? assets.find((candidate) => candidate.id === selectedAssetId) ?? null : null

  const selectedClip = previewClips.find((clip) => clip.id === selectedClipId) ?? null
  const playheadClip =
    previewClips.find((clip) => isPlayheadInsideClip(clip, playheadTime)) ?? null
  const previewClip = playheadClip ?? selectedClip
  const previewVideoTrackLayers = useMemo(
    () => buildTrackPreviewLayers('video'),
    [assets, playheadTime, tracks]
  )
  const activeVideoLayers = useMemo(
    () => previewVideoTrackLayers.filter((layer) => layer.isVisible).map(({ trackIndex: _trackIndex, isVisible: _isVisible, ...layer }) => layer),
    [previewVideoTrackLayers]
  )
  const previewAudioTrackLayers = useMemo(
    () => buildTrackPreviewLayers('audio'),
    [assets, playheadTime, tracks]
  )
  const activeAudioLayers = useMemo(
    () => previewAudioTrackLayers.filter((layer) => layer.isVisible).map(({ trackIndex: _trackIndex, isVisible: _isVisible, ...layer }) => layer),
    [previewAudioTrackLayers]
  )
  const timelineAsset = previewClip ? assets.find((candidate) => candidate.id === previewClip.assetId) : undefined
  const shouldPreferSelectedAsset = Boolean(selectedAsset && selectedAsset.id !== timelineAsset?.id && !playheadClip)
  const renderedVideoLayers = shouldPreferSelectedAsset ? [] : activeVideoLayers
  const preloadedVideoLayers = shouldPreferSelectedAsset
    ? []
    : previewVideoTrackLayers.filter((layer) => !layer.isVisible)
  const standaloneSelectedAudioLayer = useMemo<ActivePreviewLayer | null>(() => {
    if (!shouldPreferSelectedAsset || !selectedAsset || selectedAsset.type !== 'audio') return null
    const duration = Math.max(0, selectedAsset.duration ?? totalDuration ?? 0)
    const clipLocalTime = Math.max(0, Math.min(duration, playheadTime))
    return {
      clip: {
        id: `selected-audio-preview:${selectedAsset.id}`,
        assetId: selectedAsset.id,
        trackId: 'selected-audio-preview',
        name: selectedAsset.name,
        type: 'audio',
        startTime: 0,
        duration,
        inPoint: 0,
        color: '#eab308',
        effects: [],
        volume: 1
      },
      asset: selectedAsset,
      clipLocalTime,
      videoFileTime: clipLocalTime
    }
  }, [playheadTime, selectedAsset, shouldPreferSelectedAsset, totalDuration])
  const renderedAudioLayers = activeAudioLayers.length > 0
    ? activeAudioLayers
    : standaloneSelectedAudioLayer
      ? [standaloneSelectedAudioLayer]
      : []
  const preloadedAudioLayers = activeAudioLayers.length > 0
    ? previewAudioTrackLayers.filter((layer) => !layer.isVisible).map(({ trackIndex: _trackIndex, isVisible: _isVisible, ...layer }) => layer)
    : []
  const activeVideoLayerKey = useMemo(
    () => activeVideoLayers.map((layer) => layer.clip.id).join('|'),
    [activeVideoLayers]
  )
  const activeAudioLayerKey = useMemo(
    () => renderedAudioLayers.map((layer) => layer.clip.id).join('|'),
    [renderedAudioLayers]
  )
  const currentPreviewClipId = previewClip?.id ?? null
  const asset = shouldPreferSelectedAsset ? selectedAsset : timelineAsset ?? selectedAsset ?? assets[0]

  const previewAssets = useMemo(
    () =>
      [...new Map([
        ...renderedVideoLayers
          .filter((layer) => Boolean(layer.asset.path))
          .map((layer) => [layer.asset.id, layer.asset] as const),
        ...preloadedVideoLayers
          .filter((layer) => Boolean(layer.asset.path))
          .map((layer) => [layer.asset.id, layer.asset] as const),
        ...renderedAudioLayers
          .filter((layer) => Boolean(layer.asset.path))
          .map((layer) => [layer.asset.id, layer.asset] as const),
        ...preloadedAudioLayers
          .filter((layer) => Boolean(layer.asset.path))
          .map((layer) => [layer.asset.id, layer.asset] as const),
        ...(asset?.path ? [[asset.id, asset] as const] : [])
      ]).values()],
    [preloadedAudioLayers, preloadedVideoLayers, renderedAudioLayers, renderedVideoLayers, asset]
  )
  const previewAssetKey = useMemo(
    () => previewAssets.map((previewAsset) => getPreviewCacheKey(previewAsset)).join('|'),
    [previewAssets]
  )

  const assetPreviewKey = asset ? getPreviewCacheKey(asset) : null
  const assetUrl = assetPreviewKey && resolvedPreviewPaths[assetPreviewKey]
    ? `${window.api.toFileUrl(resolvedPreviewPaths[assetPreviewKey].path)}&v=${encodeURIComponent(resolvedPreviewPaths[assetPreviewKey].cacheKey)}`
    : null

  useEffect(() => {
    let cancelled = false
    const missingPreviewAssets = previewAssets.filter((previewAsset) => !resolvedPreviewPaths[getPreviewCacheKey(previewAsset)])

    if (previewAssets.length === 0) return

    if (missingPreviewAssets.length === 0) return

    for (const previewAsset of missingPreviewAssets) {
      if (!previewAsset.path) continue
      void window.api.getPreviewDescriptor(previewAsset.path, previewAsset.type).then((descriptor) => {
        if (cancelled) return
        setResolvedPreviewPaths((current) => ({
          ...current,
          [getPreviewCacheKey(previewAsset)]: descriptor
        }))
      }).catch(() => {
        if (cancelled) return
        setResolvedPreviewPaths((current) => ({
          ...current,
          [getPreviewCacheKey(previewAsset)]: { path: previewAsset.path, cacheKey: `${Date.now()}` }
        }))
      })
    }

    return () => {
      cancelled = true
    }
  }, [previewAssetKey])

  // clipLocalTime : 0 → clip.duration  (within-clip position, drives scrub bar + effects)
  // videoFileTime : inPoint → inPoint+duration  (source file position, drives video.currentTime)
  const clipDuration = previewClip?.duration ?? asset?.duration ?? totalDuration ?? 0
  const clipLocalTime = previewClip
    ? Math.max(0, Math.min(previewClip.duration, playheadTime - previewClip.startTime))
    : Math.max(0, playheadTime)
  const videoFileTime = (previewClip?.inPoint ?? 0) + clipLocalTime
  const progress = totalDuration > 0 ? Math.min(100, (playheadTime / totalDuration) * 100) : 0

  // --- Live visual effects ---
  const effects     = previewClip?.effects ?? []
  const fadeIn      = effects.find((e) => e.type === 'fade_in'     && e.enabled)
  const fadeOut     = effects.find((e) => e.type === 'fade_out'    && e.enabled)
  const grade       = effects.find((e) => e.type === 'color_grade' && e.enabled)
  const blurEffect  = effects.find((e) => e.type === 'blur'        && e.enabled)
  const sharpEffect = effects.find((e) => e.type === 'sharpen'     && e.enabled)

  let videoOpacity = 1
  if (fadeIn) {
    const dur = (fadeIn.parameters.duration as number) ?? 1
    if (clipLocalTime < dur) videoOpacity = Math.max(0, clipLocalTime / dur)
  }
  if (fadeOut && previewClip) {
    const dur = (fadeOut.parameters.duration as number) ?? 1
    const fadeStart = previewClip.duration - dur
    if (clipLocalTime > fadeStart)
      videoOpacity = Math.min(videoOpacity, Math.max(0, 1 - (clipLocalTime - fadeStart) / dur))
  }
  const filterParts: string[] = []
  if (grade) {
    const b = 1 + ((grade.parameters.brightness as number) ?? 0)
    const c = (grade.parameters.contrast   as number) ?? 1
    const s = (grade.parameters.saturation as number) ?? 1
    filterParts.push(`brightness(${b}) contrast(${c}) saturate(${s})`)
  }
  if (blurEffect) {
    const radius = (blurEffect.parameters.radius as number) ?? 5
    filterParts.push(`blur(${Math.round(radius * 0.6)}px)`)
  }
  if (sharpEffect) {
    const amount = (sharpEffect.parameters.amount as number) ?? 1
    filterParts.push(`contrast(${1 + amount * 0.08})`)
  }
  const videoFilter = filterParts.join(' ')
  const transformEffect = effects.find((e) => e.type === 'transform' && e.enabled)
  const opacityEffect = effects.find((e) => e.type === 'opacity' && e.enabled)
  const blendModeEffect = effects.find((e) => e.type === 'blend_mode' && e.enabled)
  const textOverlayEffect = effects.find((e) => e.type === 'text_overlay' && e.enabled)

  const resolvedTransform = useMemo(
    () => resolveEffectParameters(transformEffect, clipLocalTime),
    [transformEffect, clipLocalTime]
  )
  const resolvedOpacity = useMemo(
    () => resolveEffectParameters(opacityEffect, clipLocalTime),
    [opacityEffect, clipLocalTime]
  )
  const resolvedBlendMode = useMemo(
    () => resolveEffectParameters(blendModeEffect, clipLocalTime),
    [blendModeEffect, clipLocalTime]
  )
  const resolvedTextOverlay = useMemo(
    () => resolveEffectParameters(textOverlayEffect, clipLocalTime),
    [textOverlayEffect, clipLocalTime]
  )

  const transformX = Number(resolvedTransform.x ?? 0)
  const transformY = Number(resolvedTransform.y ?? 0)
  const scaleX = Number(resolvedTransform.scaleX ?? resolvedTransform.scale ?? 1)
  const scaleY = Number(resolvedTransform.scaleY ?? resolvedTransform.scale ?? 1)
  const rotation = Number(resolvedTransform.rotation ?? 0)
  const compositeTransform = `translate(${transformX}px, ${transformY}px) rotate(${rotation}deg) scale(${scaleX}, ${scaleY})`
  const blendMode = String(resolvedBlendMode.mode ?? 'normal') as React.CSSProperties['mixBlendMode']
  const extraOpacity = Math.max(0, Math.min(1, Number(resolvedOpacity.opacity ?? 1)))
  videoOpacity *= extraOpacity

  const textOverlayText = String(resolvedTextOverlay.text ?? '').trim()
  const textOverlayX = Number(resolvedTextOverlay.x ?? 0)
  const textOverlayY = Number(resolvedTextOverlay.y ?? 0)
  const textOverlayScale = Number(resolvedTextOverlay.scale ?? 1)
  const textOverlayRotation = Number(resolvedTextOverlay.rotation ?? 0)
  const textOverlayOpacity = Math.max(0, Math.min(1, Number(resolvedTextOverlay.opacity ?? 1)))
  const textOverlayFontSize = Number(resolvedTextOverlay.fontSize ?? 56)

  // --- Stable refs for RAF and event callbacks ---
  const activeVideoLayersRef = useRef(activeVideoLayers)
  const renderedAudioLayersRef = useRef(renderedAudioLayers)
  const totalDurationRef   = useRef(totalDuration)
  const clipDurationRef    = useRef(clipDuration)
  const setIsPlayingRef    = useRef(setIsPlaying)
  const setPlayheadTimeRef = useRef(setPlayheadTime)
  const isPlayingRef       = useRef(isPlaying)
  const assetTypeRef       = useRef(asset?.type)
  const playheadTimeRef    = useRef(playheadTime)
  useEffect(() => { activeVideoLayersRef.current = activeVideoLayers }, [activeVideoLayers])
  useEffect(() => { renderedAudioLayersRef.current = renderedAudioLayers }, [renderedAudioLayers])
  useEffect(() => { totalDurationRef.current   = totalDuration   }, [totalDuration])
  useEffect(() => { clipDurationRef.current    = clipDuration    }, [clipDuration])
  useEffect(() => { setIsPlayingRef.current    = setIsPlaying    }, [setIsPlaying])
  useEffect(() => { setPlayheadTimeRef.current = setPlayheadTime }, [setPlayheadTime])
  useEffect(() => { isPlayingRef.current       = isPlaying       }, [isPlaying])
  useEffect(() => { assetTypeRef.current       = asset?.type     }, [asset?.type])
  useEffect(() => { playheadTimeRef.current    = playheadTime    }, [playheadTime])

  function restoreVideoState() {
    const videos = Object.values(layerVideoRefs.current).filter((node): node is HTMLVideoElement => Boolean(node))
    if (videos.length === 0 || assetTypeRef.current !== 'video') return
    const shouldResumePlayback = isPlayingRef.current

    for (const layer of activeVideoLayersRef.current) {
      const video = layerVideoRefs.current[layer.clip.id]
      if (!video) continue
      const desiredTime = layer.videoFileTime
      const sync = () => {
        if (Math.abs(video.currentTime - desiredTime) > 0.05) {
          video.currentTime = desiredTime
        }
        if (shouldResumePlayback) {
          void video.play().catch(() => setIsPlayingRef.current(false))
        } else {
          video.pause()
        }
      }

      video.load()
      if (video.readyState >= 1) {
        sync()
        continue
      }
      video.addEventListener('loadedmetadata', sync, { once: true })
    }
  }

  function restoreAudioState() {
    const shouldResumePlayback = isPlayingRef.current

    for (const layer of renderedAudioLayersRef.current) {
      const audio = layerAudioRefs.current[layer.clip.id]
      if (!audio) continue
      const desiredTime = layer.videoFileTime
      const sync = () => {
        audio.volume = Math.max(0, Math.min(1, (layer.clip.volume ?? 1) * (layer.audioGain ?? 1)))
        if (Math.abs(audio.currentTime - desiredTime) > 0.05) {
          audio.currentTime = desiredTime
        }
        if (shouldResumePlayback) {
          void audio.play().catch(() => setIsPlayingRef.current(false))
        } else {
          audio.pause()
        }
      }

      audio.load()
      if (audio.readyState >= 1) {
        sync()
        continue
      }
      audio.addEventListener('loadedmetadata', sync, { once: true })
    }
  }

  function syncVideoToTimelinePosition(force = false) {
    if (assetTypeRef.current !== 'video') return
    for (const layer of activeVideoLayersRef.current) {
      const video = layerVideoRefs.current[layer.clip.id]
      if (!video) continue
      const desiredTime = layer.videoFileTime
      if (force || Math.abs(video.currentTime - desiredTime) > 0.05) {
        video.currentTime = desiredTime
      }
    }
  }

  function playFromTimelinePosition() {
    if (assetTypeRef.current !== 'video') return
    const generation = playbackGenerationRef.current

    for (const layer of activeVideoLayersRef.current) {
      const video = layerVideoRefs.current[layer.clip.id]
      if (!video) continue
      const desiredTime = layer.videoFileTime

      const startPlayback = () => {
        if (playbackGenerationRef.current !== generation || !isPlayingRef.current) return
        void video.play().catch(() => setIsPlayingRef.current(false))
      }

      const performSeekThenPlay = () => {
        const delta = Math.abs(video.currentTime - desiredTime)
        if (delta <= 0.05) {
          startPlayback()
          return
        }

        const handleSeeked = () => {
          video.removeEventListener('seeked', handleSeeked)
          startPlayback()
        }

        video.addEventListener('seeked', handleSeeked, { once: true })
        video.currentTime = desiredTime
      }

      if (video.readyState >= 1) {
        performSeekThenPlay()
        continue
      }

      const handleMetadata = () => {
        video.removeEventListener('loadedmetadata', handleMetadata)
        performSeekThenPlay()
      }
      video.addEventListener('loadedmetadata', handleMetadata, { once: true })
      video.load()
    }
  }

  function syncAudioToTimelinePosition(force = false) {
    for (const layer of renderedAudioLayersRef.current) {
      const audio = layerAudioRefs.current[layer.clip.id]
      if (!audio) continue
      audio.volume = Math.max(0, Math.min(1, (layer.clip.volume ?? 1) * (layer.audioGain ?? 1)))
      const desiredTime = layer.videoFileTime
      if (force || Math.abs(audio.currentTime - desiredTime) > 0.05) {
        audio.currentTime = desiredTime
      }
    }
  }

  function playAudioFromTimelinePosition() {
    const generation = playbackGenerationRef.current

    for (const layer of renderedAudioLayersRef.current) {
      const audio = layerAudioRefs.current[layer.clip.id]
      if (!audio) continue
      audio.volume = Math.max(0, Math.min(1, (layer.clip.volume ?? 1) * (layer.audioGain ?? 1)))
      const desiredTime = layer.videoFileTime

      const startPlayback = () => {
        if (playbackGenerationRef.current !== generation || !isPlayingRef.current) return
        void audio.play().catch(() => setIsPlayingRef.current(false))
      }

      const performSeekThenPlay = () => {
        const delta = Math.abs(audio.currentTime - desiredTime)
        if (delta <= 0.05) {
          startPlayback()
          return
        }

        const handleSeeked = () => {
          audio.removeEventListener('seeked', handleSeeked)
          startPlayback()
        }

        audio.addEventListener('seeked', handleSeeked, { once: true })
        audio.currentTime = desiredTime
      }

      if (audio.readyState >= 1) {
        performSeekThenPlay()
        continue
      }

      const handleMetadata = () => {
        audio.removeEventListener('loadedmetadata', handleMetadata)
        performSeekThenPlay()
      }
      audio.addEventListener('loadedmetadata', handleMetadata, { once: true })
      audio.load()
    }
  }

  // --- Mute sync ---
  useEffect(() => {
    for (const video of Object.values(layerVideoRefs.current)) {
      if (video) video.muted = muted
    }
    for (const audio of Object.values(layerAudioRefs.current)) {
      if (audio) audio.muted = muted
    }
  }, [muted])

  // --- Prune stale video refs on clip/project changes ---
  useEffect(() => {
    const activeClipIds = new Set([
      ...activeVideoLayers.map((layer) => layer.clip.id),
      ...preloadedVideoLayers.map((layer) => layer.clip.id)
    ])
    for (const [clipId, video] of Object.entries(layerVideoRefs.current)) {
      if (activeClipIds.has(clipId)) continue
      if (video) {
        video.pause()
        video.currentTime = 0
      }
      delete layerVideoRefs.current[clipId]
    }
  }, [activeVideoLayers, preloadedVideoLayers])

  useEffect(() => {
    const activeClipIds = new Set([
      ...renderedAudioLayers.map((layer) => layer.clip.id),
      ...preloadedAudioLayers.map((layer) => layer.clip.id)
    ])
    for (const [clipId, audio] of Object.entries(layerAudioRefs.current)) {
      if (activeClipIds.has(clipId)) continue
      if (audio) {
        audio.pause()
        audio.currentTime = 0
      }
      delete layerAudioRefs.current[clipId]
    }
  }, [preloadedAudioLayers, renderedAudioLayers])

  // --- Play / pause ---
  useEffect(() => {
    if (isPlaying) {
      playbackGenerationRef.current += 1
      playbackAnchorRef.current = { startedAt: performance.now(), basePlayhead: playheadTimeRef.current }
      if (asset?.type === 'video') playFromTimelinePosition()
      if (renderedAudioLayers.length > 0) playAudioFromTimelinePosition()
    } else {
      playbackGenerationRef.current += 1
      playbackAnchorRef.current = null
      for (const video of Object.values(layerVideoRefs.current)) {
        video?.pause()
      }
      for (const audio of Object.values(layerAudioRefs.current)) {
        audio?.pause()
      }
    }
  }, [asset?.type, assetUrl, isPlaying, activeVideoLayerKey, activeAudioLayerKey, setIsPlaying])

  // --- Seek on scrub / initial position ---
  useEffect(() => {
    if (isPlaying) return

    const video = layerVideoRefs.current[previewClip?.id ?? ''] ?? null
    if (video && asset?.type === 'video') {
      const desired = videoFileTime
      const doSeek = () => {
        const delta = Math.abs(video.currentTime - desired)
        if (!isPlaying || delta > 0.2)
          video.currentTime = desired
      }
      if (video.readyState >= 1) {
        doSeek()
      } else {
        video.addEventListener('loadedmetadata', doSeek, { once: true })
        return () => video.removeEventListener('loadedmetadata', doSeek)
      }
    }
    syncAudioToTimelinePosition()
  }, [asset?.type, assetUrl, isPlaying, renderedAudioLayers, videoFileTime])

  // --- RAF loop: playhead is the master clock; media elements follow it ---
  useEffect(() => {
    if (!isPlaying) return

    function tick() {
      const totalDur = totalDurationRef.current
      const clipDur = clipDurationRef.current
      const anchor = playbackAnchorRef.current
      if (!anchor) return

      const elapsedSeconds = Math.max(0, (performance.now() - anchor.startedAt) / 1000)
      const nextPlayhead = Math.max(0, Math.min(totalDur || clipDur, anchor.basePlayhead + elapsedSeconds))
      playheadTimeRef.current = nextPlayhead
      setPlayheadTimeRef.current(nextPlayhead)

      if (nextPlayhead >= (totalDur || clipDur) - 0.001) {
        playbackAnchorRef.current = null
        for (const video of Object.values(layerVideoRefs.current)) {
          video?.pause()
        }
        for (const audio of Object.values(layerAudioRefs.current)) {
          audio?.pause()
        }
        setIsPlayingRef.current(false)
        return
      }

      rafRef.current = window.requestAnimationFrame(tick)
    }

    rafRef.current = window.requestAnimationFrame(tick)
    return () => {
      if (rafRef.current !== null) { window.cancelAnimationFrame(rafRef.current); rafRef.current = null }
    }
  }, [asset?.type, isPlaying, previewClip?.id, activeVideoLayers])

  useEffect(() => () => {
    if (rafRef.current !== null) window.cancelAnimationFrame(rafRef.current)
    for (const video of Object.values(layerVideoRefs.current)) {
      video?.pause()
    }
    for (const audio of Object.values(layerAudioRefs.current)) {
      audio?.pause()
    }
    layerVideoRefs.current = {}
    layerAudioRefs.current = {}
  }, [])

  useEffect(() => {
    if (!isPlaying) return
    syncVideoToTimelinePosition()
    syncAudioToTimelinePosition()
  }, [isPlaying, currentPreviewClipId, activeVideoLayerKey, activeAudioLayerKey])

  useEffect(() => {
    if (!isPlaying) return
    if (asset?.type === 'video') playFromTimelinePosition()
    if (renderedAudioLayers.length > 0) playAudioFromTimelinePosition()
  }, [asset?.type, isPlaying, activeVideoLayerKey, activeAudioLayerKey])

  useEffect(() => {
    if (asset?.type !== 'video') return

    const handleAppResume = () => {
      restoreVideoState()
      restoreAudioState()
    }
    const handleVisibilityChange = () => {
      if (!document.hidden) restoreVideoState()
    }
    const handleWindowFocus = () => {
      restoreVideoState()
    }

    const unsubscribeResume = window.api.onAppResume(handleAppResume)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('focus', handleWindowFocus)
    window.addEventListener('pageshow', handleWindowFocus)

    return () => {
      unsubscribeResume()
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('focus', handleWindowFocus)
      window.removeEventListener('pageshow', handleWindowFocus)
    }
  }, [asset?.type, assetUrl, renderedAudioLayers])

  // --- Scrub ---
  function handleScrub(ratio: number): void {
    const bounded = Math.max(0, Math.min(1, ratio))
    const capped = Math.max(0, Math.min(totalDuration || clipDuration, bounded * (totalDuration || clipDuration)))
    setPlayheadTime(capped)
  }

  async function toggleFullscreen(): Promise<void> {
    if (!containerRef.current) return
    if (document.fullscreenElement) { await document.exitFullscreen(); return }
    await containerRef.current.requestFullscreen()
  }

  const canvasWidth = Math.max(16, activeSequenceWidth || 1920)
  const canvasHeight = Math.max(16, activeSequenceHeight || 1080)
  const stageStyle =
    canvasHeight > canvasWidth
      ? {
          aspectRatio: `${canvasWidth} / ${canvasHeight}`,
          height: '100%',
          width: 'auto',
          maxWidth: '100%'
        }
      : {
          aspectRatio: `${canvasWidth} / ${canvasHeight}`,
          width: '100%',
          height: 'auto',
          maxHeight: '100%'
        }

  return (
    <div className="flex flex-col h-full bg-surface-0" ref={containerRef}>
      {/* Video area */}
      <div className="flex-1 relative bg-black flex items-center justify-center overflow-hidden min-h-0">
        <div className="relative flex h-full w-full items-center justify-center p-4">
          <div className="relative overflow-hidden bg-black border border-white/6 shadow-[0_0_0_1px_rgba(255,255,255,0.03)]" style={stageStyle}>
            {renderedVideoLayers.length > 0 || preloadedVideoLayers.length > 0 ? (
              [...renderedVideoLayers.map((layer) => ({ layer, hidden: false })), ...preloadedVideoLayers.map((layer) => ({ layer, hidden: true }))].map(({ layer, hidden }, index) => {
                const layerPreviewKey = getPreviewCacheKey(layer.asset)
                const layerAssetUrl = resolvedPreviewPaths[layerPreviewKey]
                  ? `${window.api.toFileUrl(resolvedPreviewPaths[layerPreviewKey].path)}&v=${encodeURIComponent(resolvedPreviewPaths[layerPreviewKey].cacheKey)}`
                  : null

                return layerAssetUrl || layer.asset.type === 'image' ? (
                  <PreviewLayer
                    key={layer.clip.id}
                    layer={layer}
                    assetUrl={layerAssetUrl}
                    muted={hidden || muted || renderedAudioLayers.length > 0}
                    audioMuted={hidden || true}
                    canvasWidth={canvasWidth}
                    canvasHeight={canvasHeight}
                    hidden={hidden}
                    onTogglePlay={() => setIsPlaying(!isPlaying)}
                    registerVideoRef={(clipId, node) => {
                      layerVideoRefs.current[clipId] = node
                      if (!hidden && index === 0) videoRef.current = node
                    }}
                  />
                ) : (
                  <div key={layer.clip.id} className="absolute inset-0 bg-black flex items-center justify-center">
                    <div className="text-center space-y-2">
                      <div className="w-8 h-8 rounded-full border-2 border-white/20 border-t-white/70 animate-spin mx-auto" />
                      <p className="text-text-dim text-xs">Preparing preview…</p>
                    </div>
                  </div>
                )
              })
            ) : asset?.type === 'image' && assetUrl ? (
              <img src={assetUrl} alt={asset.name} className="w-full h-full object-contain bg-black" />
            ) : (
              <div className="w-full h-full bg-gradient-to-br from-surface-2 to-surface-0 flex items-center justify-center relative">
                <div
                  className="absolute inset-0 opacity-5"
                  style={{
                    backgroundImage: 'linear-gradient(#fff 1px, transparent 1px), linear-gradient(90deg, #fff 1px, transparent 1px)',
                    backgroundSize: '48px 48px'
                  }}
                />
                <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
                  <div className="w-4 h-px bg-white/20" /><div className="h-4 w-px bg-white/20 absolute" />
                </div>
                <div className="text-center space-y-2 relative z-10">
                  <div className="w-16 h-16 rounded-full bg-surface-3 border border-border flex items-center justify-center mx-auto">
                    <Play size={24} className="text-text-dim ml-1" />
                  </div>
                  <p className="text-text-dim text-xs">{asset ? asset.name : 'No media loaded'}</p>
                </div>
              </div>
            )}
            {[...renderedAudioLayers, ...preloadedAudioLayers].map((layer) => {
              const layerPreviewKey = getPreviewCacheKey(layer.asset)
              const layerAssetUrl = resolvedPreviewPaths[layerPreviewKey]
                ? `${window.api.toFileUrl(resolvedPreviewPaths[layerPreviewKey].path)}&v=${encodeURIComponent(resolvedPreviewPaths[layerPreviewKey].cacheKey)}`
                : null

              if (!layerAssetUrl) return null

              return (
                <audio
                  key={layer.clip.id}
                  ref={(node) => {
                    layerAudioRefs.current[layer.clip.id] = node
                  }}
                  src={layerAssetUrl}
                  muted={muted}
                  preload="auto"
                  className="hidden"
                />
              )
            })}
          </div>
        </div>

        <div className="absolute top-2 left-2 bg-black/70 text-white font-mono text-2xs px-2 py-0.5 rounded pointer-events-none">
          {formatTimecode(clipLocalTime)}
        </div>
        <div className="absolute top-2 right-2 bg-black/70 text-text-dim text-2xs px-2 py-0.5 rounded pointer-events-none">
          {asset?.type === 'audio' ? 'Audio' : asset?.type === 'image' ? 'Still' : 'Preview'}
        </div>
        <button
          className="absolute bottom-2 right-2 p-1 bg-black/60 hover:bg-black/80 rounded text-text-secondary hover:text-white transition-colors"
          onClick={() => void toggleFullscreen()}
        >
          <Maximize2 size={12} />
        </button>
      </div>

      {/* Scrub bar */}
      <div className="px-3 py-1.5 bg-surface-1">
        <div
          className="relative h-1.5 bg-surface-4 rounded-full cursor-pointer group"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect()
            handleScrub((e.clientX - rect.left) / rect.width)
          }}
        >
          <div className="absolute left-0 top-0 h-full bg-accent rounded-full" style={{ width: `${progress}%` }} />
          <div
            className="absolute top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow-lg opacity-0 group-hover:opacity-100 transition-opacity -translate-x-1/2"
            style={{ left: `${progress}%` }}
          />
        </div>
      </div>

      {/* Transport controls */}
      <div className="flex items-center justify-between px-3 py-2 bg-surface-1 border-t border-border flex-shrink-0">
        <div className="flex items-center gap-1">
          <TransportBtn
            icon={<SkipBack size={13} />}
            onClick={() => {
              setPlayheadTime(previewClip?.startTime ?? 0)
              const v = videoRef.current
              if (v) v.currentTime = previewClip?.inPoint ?? 0
            }}
            title="Go to start"
          />
          <TransportBtn
            icon={<Scissors size={13} />}
            onClick={() => void splitSelectedClip()}
            title="Split at playhead"
            disabled={!selectedClip}
          />
        </div>
        <div className="flex items-center gap-1">
          <TransportBtn
            icon={isPlaying ? <Pause size={14} /> : <Play size={14} />}
            onClick={() => setIsPlaying(!isPlaying)}
            title={isPlaying ? 'Pause' : 'Play'}
            primary
            disabled={!asset}
          />
        </div>
        <div className="flex items-center gap-1">
          <TransportBtn
            icon={<SkipForward size={13} />}
            onClick={() => setPlayheadTime(totalDuration || clipDuration)}
            title="Go to end"
          />
          <TransportBtn
            icon={muted ? <VolumeX size={13} /> : <Volume2 size={13} />}
            onClick={() => setMuted((v) => !v)}
            title="Toggle audio"
          />
        </div>
      </div>
    </div>
  )
}

function TransportBtn({
  icon, onClick, title, primary, disabled
}: {
  icon: React.ReactNode; onClick: () => void; title: string; primary?: boolean; disabled?: boolean
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        'p-1.5 rounded transition-colors',
        disabled
          ? 'text-text-dim opacity-40 cursor-not-allowed'
          : primary
            ? 'bg-accent hover:bg-accent-hover text-black w-8 h-8 flex items-center justify-center'
            : 'text-text-secondary hover:text-text-primary hover:bg-surface-3'
      )}
    >
      {icon}
    </button>
  )
}
