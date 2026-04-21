import { basename, dirname, extname } from 'path'
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs'
import { execFileSync } from 'child_process'
import type {
  EditorProjectRecord,
  MediaAssetRecord,
  MediaType,
  SemanticAnnotation,
  SemanticSegment,
  SegmentSearchResult,
  SequenceRecord,
  SequenceMarkerRecord,
  TimelineClipRecord,
  TimelineTrackRecord
} from '../../shared/editor'
import { createId } from './id'

const VIDEO_EXTENSIONS = new Set(['.mp4', '.m4v', '.mov', '.mkv', '.avi', '.webm', '.mpg', '.mpeg', '.wmv', '.ts', '.mts', '.m2ts'])
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.aac', '.m4a', '.flac', '.ogg', '.opus', '.aif', '.aiff'])
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tif', '.tiff', '.svg'])
const DEFAULT_STILL_DURATION_SECONDS = 5
const LEGACY_IMPORTED_MEDIA_DURATION_SECONDS = 12

const DEFAULT_SUMMARIES: Record<MediaType, string> = {
  video: 'Imported video asset. No transcript or scene analysis has been generated yet.',
  audio: 'Imported audio asset. No transcript has been generated yet.',
  image: 'Imported image asset available for overlays, cutaways, or title cards.'
}

function inferMediaType(filePath: string): MediaType {
  const extension = extname(filePath).toLowerCase()
  if (VIDEO_EXTENSIONS.has(extension)) return 'video'
  if (AUDIO_EXTENSIONS.has(extension)) return 'audio'
  if (IMAGE_EXTENSIONS.has(extension)) return 'image'
  return 'video'
}

function getFallbackDuration(type: MediaType): number {
  return type === 'image' ? DEFAULT_STILL_DURATION_SECONDS : LEGACY_IMPORTED_MEDIA_DURATION_SECONDS
}

function probeMediaDuration(filePath: string, type: MediaType): number {
  if (type === 'image') return DEFAULT_STILL_DURATION_SECONDS

  try {
    const raw = execFileSync(
      'ffprobe',
      [
        '-v',
        'error',
        '-print_format',
        'json',
        '-show_entries',
        'format=duration:stream=codec_type,duration',
        filePath
      ],
      { encoding: 'utf8' }
    )
    const parsed = JSON.parse(raw) as {
      format?: { duration?: string }
      streams?: Array<{ codec_type?: string; duration?: string }>
    }

    const candidates = [
      parsed.format?.duration,
      ...(parsed.streams?.map((stream) => stream.duration) ?? [])
    ]
      .map((value) => Number.parseFloat(value ?? ''))
      .filter((value) => Number.isFinite(value) && value > 0.05)

    if (candidates.length > 0) {
      return Math.max(...candidates)
    }
  } catch (error) {
    console.warn(`[ProjectStore] Failed to probe duration for ${filePath}:`, error)
  }

  return getFallbackDuration(type)
}

function titleize(value: string): string {
  return value
    .replace(/\.[^.]+$/, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function buildSemanticAnnotation(name: string, type: MediaType): SemanticAnnotation {
  const normalized = titleize(name).toLowerCase()
  const nameTerms = normalized.split(' ').filter(Boolean)

  return {
    summary: DEFAULT_SUMMARIES[type],
    tags: [type],
    keywords: [...new Set([...nameTerms, type])],
    transcript: [],
    visualSegments: [],
    segments: [],
    confidence: 0
  }
}

function buildMetadataSegment(asset: Pick<MediaAssetRecord, 'id' | 'name' | 'type' | 'duration' | 'semantic'>): SemanticSegment {
  return {
    id: `segment_${asset.id}_metadata`,
    kind: 'metadata',
    start: 0,
    end: Math.max(asset.duration, 0.1),
    text: [asset.name, asset.semantic.summary, ...asset.semantic.tags, ...asset.semantic.keywords].filter(Boolean).join(' | '),
    label: 'Asset metadata',
    confidence: 1
  }
}

function rebuildSemanticSegments(asset: MediaAssetRecord): void {
  const existingVectors = new Map(asset.semantic.segments?.map((segment) => [segment.id, segment.vector]))
  const metadataSegment = buildMetadataSegment(asset)
  metadataSegment.vector = existingVectors.get(metadataSegment.id)
  const visualSegments = (asset.semantic.visualSegments ?? []).map((segment, index) => {
    const nextSegment = {
      ...segment,
      id: segment.id || `segment_${asset.id}_visual_${index}`,
      kind: 'visual' as const,
      start: Math.max(0, segment.start),
      end: Math.max(segment.end, segment.start),
      text: segment.text.trim(),
      label: segment.label?.trim() || 'Visual',
      confidence: typeof segment.confidence === 'number' ? segment.confidence : 0.8,
      vector: undefined as number[] | undefined
    }
    nextSegment.vector = existingVectors.get(nextSegment.id)
    return nextSegment
  })
  const speechSegments = asset.semantic.transcript
    .filter((segment) => segment.text.trim().length > 0)
    .map((segment, index) => {
      const nextSegment = {
        id: segment.id || `segment_${asset.id}_speech_${index}`,
        kind: 'speech' as const,
        start: Math.max(0, segment.start),
        end: Math.max(segment.end, segment.start),
        text: segment.text.trim(),
        label: segment.speaker?.trim() ? `Speech: ${segment.speaker.trim()}` : 'Speech',
        confidence: typeof segment.confidence === 'number' ? segment.confidence : 0.9,
        vector: undefined as number[] | undefined
      }
      nextSegment.vector = existingVectors.get(nextSegment.id)
      return nextSegment
    })

  asset.semantic.segments = [metadataSegment, ...visualSegments, ...speechSegments]
}

function normalizeSemanticAnnotation(asset: MediaAssetRecord): void {
  const base = buildSemanticAnnotation(asset.name, asset.type)
  const changed =
    asset.semantic.summary !== base.summary ||
    asset.semantic.tags.join('|') !== base.tags.join('|') ||
    asset.semantic.keywords.join('|') !== base.keywords.join('|')

  asset.semantic.summary = base.summary
  asset.semantic.tags = base.tags
  asset.semantic.keywords = base.keywords
  if (!Array.isArray(asset.semantic.visualSegments)) asset.semantic.visualSegments = []
  asset.semantic.confidence = asset.semantic.transcript.length > 0 ? 0.95 : 0
  rebuildSemanticSegments(asset)
  if (changed) {
    delete asset.semantic.vector
    for (const segment of asset.semantic.segments) delete segment.vector
  }
}

function createTrack(kind: TimelineTrackRecord['kind'], index: number): TimelineTrackRecord {
  const label =
    kind === 'video' ? `V${index}` : kind === 'audio' ? `A${index}` : index === 1 ? 'Captions' : `Captions ${index}`

  return {
    id: createId('track'),
    name: label,
    kind,
    clips: []
  }
}

function createEmptySequence(name: string): SequenceRecord {
  return {
    id: createId('seq'),
    name,
    duration: 0,
    active: true,
    tracks: [createTrack('video', 1), createTrack('audio', 1), createTrack('caption', 1)],
    markers: []
  }
}

function cloneProject(project: EditorProjectRecord): EditorProjectRecord {
  return structuredClone(project)
}

export class ProjectStore {
  private project: EditorProjectRecord
  private undoStack: EditorProjectRecord[] = []
  private redoStack: EditorProjectRecord[] = []
  private projectFilePath: string | null = null
  private autosavePath: string | null = null
  private autosaveTimer: ReturnType<typeof setTimeout> | null = null
  private listeners = new Set<(project: EditorProjectRecord) => void>()

  constructor(autosavePath?: string) {
    this.autosavePath = autosavePath ?? null

    // Try to restore from autosave
    if (autosavePath && existsSync(autosavePath)) {
      try {
        const raw = readFileSync(autosavePath, 'utf8')
        const saved = JSON.parse(raw) as EditorProjectRecord
        this.project = saved
        const repaired = this.repairAssetDurations()
        this.normalizeProject()
        if (repaired) {
          writeFileSync(autosavePath, JSON.stringify(this.project, null, 2), 'utf8')
        }
        console.log(`[ProjectStore] Restored from autosave: ${saved.assets.length} assets`)
        return
      } catch {
        console.warn('[ProjectStore] Autosave corrupted, starting fresh')
      }
    }

    const now = Date.now()
    this.project = {
      id: createId('project'),
      name: 'Untitled Project',
      createdAt: now,
      updatedAt: now,
      assets: [],
      sequences: [createEmptySequence('Main Sequence')],
      tasks: [],
      toolHistory: []
    }
  }

  setAutosavePath(nextAutosavePath: string | null): void {
    this.autosavePath = nextAutosavePath
    if (this.autosavePath) {
      mkdirSync(dirname(this.autosavePath), { recursive: true })
    }
  }

  private scheduleAutosave(): void {
    if (!this.autosavePath) return
    if (this.autosaveTimer) clearTimeout(this.autosaveTimer)
    this.autosaveTimer = setTimeout(() => {
      this.flushAutosave()
    }, 500)
  }

  flushAutosave(): void {
    if (!this.autosavePath) return
    if (this.autosaveTimer) {
      clearTimeout(this.autosaveTimer)
      this.autosaveTimer = null
    }
    try {
      mkdirSync(dirname(this.autosavePath), { recursive: true })
      writeFileSync(this.autosavePath, JSON.stringify(this.project, null, 2), 'utf8')
    } catch (e) {
      console.warn('[ProjectStore] Autosave failed:', e)
    }
  }

  getProject(): EditorProjectRecord {
    return cloneProject(this.project)
  }

  getProjectFilePath(): string | null {
    return this.projectFilePath
  }

  subscribe(listener: (project: EditorProjectRecord) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  canUndo(): boolean {
    return this.undoStack.length > 0
  }

  canRedo(): boolean {
    return this.redoStack.length > 0
  }

  loadProject(project: EditorProjectRecord, projectFilePath?: string | null): EditorProjectRecord {
    this.project = cloneProject(project)
    this.repairAssetDurations()
    this.normalizeProject()
    this.undoStack = []
    this.redoStack = []
    this.projectFilePath = projectFilePath ?? null
    this.touch()
    return this.getProject()
  }

  createProject(name = 'Untitled Project'): EditorProjectRecord {
    const now = Date.now()
    this.project = {
      id: createId('project'),
      name: name.trim() || 'Untitled Project',
      createdAt: now,
      updatedAt: now,
      assets: [],
      sequences: [createEmptySequence('Main Sequence')],
      tasks: [],
      toolHistory: []
    }
    this.undoStack = []
    this.redoStack = []
    this.projectFilePath = null
    this.touch()
    return this.getProject()
  }

  markProjectSaved(projectFilePath: string): void {
    this.projectFilePath = projectFilePath
  }

  importFiles(filePaths: string[]): MediaAssetRecord[] {
    if (filePaths.length === 0) return []
    this.captureHistory()

    const now = Date.now()
    const importedAssets = filePaths.map((filePath) => {
      const name = basename(filePath)
      const type = inferMediaType(filePath)
      return {
        id: createId('asset'),
        name,
        path: filePath,
        type,
        duration: probeMediaDuration(filePath, type),
        createdAt: now,
        updatedAt: now,
        semantic: buildSemanticAnnotation(name, type)
      } satisfies MediaAssetRecord
    })

    this.project.assets.push(...importedAssets)

    this.appendAssetsToActiveSequence(importedAssets)
    this.touch()
    return importedAssets
  }

  removeAsset(assetId: string): void {
    this.captureHistory()
    this.project.assets = this.project.assets.filter((asset) => asset.id !== assetId)
    this.project.tasks = this.project.tasks.filter((task) => task.assetId !== assetId)
    this.project.sequences = this.project.sequences.map((sequence) => ({
      ...sequence,
      tracks: sequence.tracks.map((track) => ({
        ...track,
        clips: track.clips.filter((clip) => clip.assetId !== assetId)
      }))
    }))
    this.normalizeProject()
    this.touch()
  }

  upsertSequence(sequence: SequenceRecord): SequenceRecord {
    this.captureHistory()
    const index = this.project.sequences.findIndex((item) => item.id === sequence.id)
    if (index >= 0) {
      this.project.sequences[index] = sequence
    } else {
      this.project.sequences.push(sequence)
    }
    this.project.sequences = this.project.sequences.map((item) => ({
      ...item,
      active: item.id === sequence.id
    }))
    this.normalizeProject()
    this.touch()
    return sequence
  }

  activateSequence(sequenceId: string): SequenceRecord {
    const sequence = this.project.sequences.find((item) => item.id === sequenceId)
    if (!sequence) {
      throw new Error('Sequence not found.')
    }

    this.captureHistory()
    this.project.sequences = this.project.sequences.map((item) => ({
      ...item,
      active: item.id === sequenceId
    }))
    this.normalizeProject()
    this.touch()
    const activeSequence = this.project.sequences.find((item) => item.id === sequenceId)
    if (!activeSequence) {
      throw new Error('Sequence not found after activation.')
    }
    return structuredClone(activeSequence)
  }

  addTrack(kind: TimelineTrackRecord['kind']): SequenceRecord {
    this.captureHistory()
    const sequence = this.getActiveSequenceMutable()
    const nextIndex = sequence.tracks.filter((track) => track.kind === kind).length + 1
    sequence.tracks.push(createTrack(kind, nextIndex))
    this.normalizeProject()
    this.touch()
    return cloneProject(sequence)
  }

  listMarkers(sequenceId?: string): SequenceMarkerRecord[] {
    const sequence = sequenceId
      ? this.project.sequences.find((item) => item.id === sequenceId)
      : this.project.sequences.find((item) => item.active) ?? this.project.sequences[0]
    if (!sequence) throw new Error('Sequence not found.')
    return structuredClone(sequence.markers ?? [])
  }

  addMarker(params: {
    sequenceId?: string
    time: number
    duration?: number
    label: string
    color?: string
    assetId?: string
    segmentId?: string
    notes?: string
  }): SequenceMarkerRecord {
    const sequence = params.sequenceId
      ? this.project.sequences.find((item) => item.id === params.sequenceId)
      : this.getActiveSequenceMutable()
    if (!sequence) throw new Error('Sequence not found.')

    this.captureHistory()
    const marker: SequenceMarkerRecord = {
      id: createId('marker'),
      time: Math.max(0, params.time),
      duration: Math.max(0, params.duration ?? 0),
      label: params.label.trim() || 'Marker',
      color: params.color?.trim() || undefined,
      assetId: params.assetId,
      segmentId: params.segmentId,
      notes: params.notes?.trim() || undefined
    }
    sequence.markers.push(marker)
    this.touch()
    return structuredClone(marker)
  }

  removeMarker(markerId: string, sequenceId?: string): void {
    const sequences = sequenceId
      ? this.project.sequences.filter((item) => item.id === sequenceId)
      : this.project.sequences

    this.captureHistory()
    for (const sequence of sequences) {
      const index = (sequence.markers ?? []).findIndex((marker) => marker.id === markerId)
      if (index >= 0) {
        sequence.markers.splice(index, 1)
        this.touch()
        return
      }
    }

    throw new Error(`Marker ${markerId} not found`)
  }

  splitClip(clipId: string, splitTime: number): SequenceRecord {
    this.captureHistory()
    const sequence = this.getActiveSequenceMutable()

    for (const track of sequence.tracks) {
      const clipIndex = track.clips.findIndex((clip) => clip.id === clipId)
      if (clipIndex < 0) continue

      const clip = track.clips[clipIndex]
      const clipStart = clip.startTime
      const clipEnd = clip.startTime + clip.duration
      if (splitTime <= clipStart || splitTime >= clipEnd) {
        throw new Error('Move the playhead inside the selected clip before splitting.')
      }

      const leftDuration = splitTime - clipStart
      const rightDuration = clipEnd - splitTime
      const rightClip: TimelineClipRecord = {
        ...clip,
        id: createId('clip'),
        startTime: splitTime,
        duration: rightDuration,
        inPoint: clip.inPoint + leftDuration,
        label: `${clip.label} (Part 2)`
      }

      track.clips.splice(clipIndex, 1, { ...clip, duration: leftDuration }, rightClip)
      this.normalizeProject()
      this.touch()
      return cloneProject(sequence)
    }

    throw new Error('Selected clip was not found in the active sequence.')
  }

  addToolHistory(toolName: string, args: Record<string, unknown>): void {
    this.project.toolHistory.push({
      id: createId('tool'),
      toolName,
      args,
      createdAt: Date.now()
    })
    this.touch()
  }

  queueTask(params: {
    type: 'transcribe' | 'embed' | 'proxy' | 'analyze' | 'rough_cut'
    label: string
    assetId?: string
  }): import('../../shared/editor').EditorTaskRecord {
    const existing = this.project.tasks.find(
      (task) =>
        task.type === params.type &&
        task.assetId === params.assetId &&
        (task.status === 'queued' || task.status === 'running')
    )
    if (existing) {
      return structuredClone(existing)
    }

    const previous = [...this.project.tasks]
      .reverse()
      .find((task) => task.type === params.type && task.assetId === params.assetId)
    if (previous) {
      previous.status = 'queued'
      previous.progress = 0
      previous.label = params.label
      this.touch()
      return structuredClone(previous)
    }

    const task = {
      id: createId('task'),
      type: params.type,
      status: 'queued' as const,
      label: params.label,
      progress: 0,
      assetId: params.assetId,
      createdAt: Date.now()
    }
    this.project.tasks.push(task)
    this.touch()
    return structuredClone(task)
  }

  updateTask(
    taskId: string,
    patch: Partial<Pick<import('../../shared/editor').EditorTaskRecord, 'status' | 'label' | 'progress'>>
  ): import('../../shared/editor').EditorTaskRecord {
    const task = this.project.tasks.find((item) => item.id === taskId)
    if (!task) throw new Error(`Task ${taskId} not found`)

    if (patch.status) task.status = patch.status
    if (patch.label !== undefined) task.label = patch.label
    if (patch.progress !== undefined) task.progress = Math.max(0, Math.min(1, patch.progress))
    this.touch()
    return structuredClone(task)
  }

  getTask(taskId: string): import('../../shared/editor').EditorTaskRecord | null {
    const task = this.project.tasks.find((item) => item.id === taskId)
    return task ? structuredClone(task) : null
  }

  buildRoughCut(assetIds: string[], targetDuration = 30, sequenceName = 'AI Rough Cut'): SequenceRecord {
    const selectedAssets = this.project.assets.filter((asset) => assetIds.includes(asset.id))
    const roughCut = createEmptySequence(sequenceName)

    const videoTrack = roughCut.tracks.find((track) => track.kind === 'video')
    const audioTrack = roughCut.tracks.find((track) => track.kind === 'audio')
    if (!videoTrack || !audioTrack) return roughCut

    let currentTime = 0
    for (const asset of selectedAssets) {
      if (currentTime >= targetDuration) break

      const clipDuration = Math.max(2, Math.min(asset.duration, targetDuration - currentTime, 6))
      const clip: TimelineClipRecord = {
        id: createId('clip'),
        assetId: asset.id,
        trackId: videoTrack.id,
        startTime: currentTime,
        duration: clipDuration,
        inPoint: 0,
        label: asset.name
      }
      videoTrack.clips.push(clip)

      if (asset.type !== 'image') {
        audioTrack.clips.push({
          ...clip,
          id: createId('clip'),
          trackId: audioTrack.id
        })
      }

      currentTime += clipDuration
    }

    roughCut.duration = currentTime
    return this.upsertSequence(roughCut)
  }

  generateCaptionsForAsset(
    assetId: string,
    params: { sequenceId?: string; replaceExisting?: boolean; minDuration?: number } = {}
  ): SequenceRecord {
    const asset = this.project.assets.find((item) => item.id === assetId)
    if (!asset) throw new Error(`Asset ${assetId} not found`)
    if (asset.semantic.transcript.length === 0) {
      throw new Error('No transcript available for this asset. Run transcription first.')
    }

    const sequence = params.sequenceId
      ? this.project.sequences.find((item) => item.id === params.sequenceId)
      : this.getActiveSequenceMutable()
    if (!sequence) throw new Error('Sequence not found.')

    this.captureHistory()
    const captionTrack = this.ensureTrack(sequence, 'caption')
    if (params.replaceExisting) {
      captionTrack.clips = captionTrack.clips.filter((clip) => clip.assetId !== assetId)
    }

    const minDuration = Math.max(0.4, params.minDuration ?? 0.9)
    const preferredTrackKind = asset.type === 'audio' ? 'audio' : 'video'
    const preferredSourceClips = sequence.tracks
      .filter((track) => track.kind === preferredTrackKind)
      .flatMap((track) => track.clips)
    const fallbackSourceClips = sequence.tracks
      .filter((track) => track.kind !== 'caption')
      .flatMap((track) => track.clips)
    const sourceClips = (preferredSourceClips.length > 0 ? preferredSourceClips : fallbackSourceClips)
      .filter((clip) => clip.assetId === assetId)
      .sort((left, right) => left.startTime - right.startTime)

    if (sourceClips.length === 0) {
      throw new Error('Asset is not present in the target sequence.')
    }

    const newCaptions: TimelineClipRecord[] = []
    for (const sourceClip of sourceClips) {
      const sourceIn = sourceClip.inPoint
      const sourceOut = sourceClip.inPoint + sourceClip.duration

      for (const segment of asset.semantic.transcript) {
        const overlapStart = Math.max(segment.start, sourceIn)
        const overlapEnd = Math.min(segment.end, sourceOut)
        if (overlapEnd <= overlapStart) continue

        newCaptions.push({
          id: createId('clip'),
          assetId,
          trackId: captionTrack.id,
          startTime: sourceClip.startTime + (overlapStart - sourceIn),
          duration: Math.max(minDuration, overlapEnd - overlapStart),
          inPoint: overlapStart,
          label: segment.text.trim() || 'Caption'
        })
      }
    }

    captionTrack.clips.push(...newCaptions)
    this.touch()
    return structuredClone(sequence)
  }

  updateProjectName(name: string): string {
    this.project.name = name.trim() || this.project.name
    this.touch()
    return this.project.name
  }

  undo(): EditorProjectRecord {
    if (!this.canUndo()) return this.getProject()
    this.redoStack.push(cloneProject(this.project))
    const previous = this.undoStack.pop()
    if (!previous) return this.getProject()
    this.project = previous
    this.normalizeProject()
    return this.getProject()
  }

  redo(): EditorProjectRecord {
    if (!this.canRedo()) return this.getProject()
    this.undoStack.push(cloneProject(this.project))
    const next = this.redoStack.pop()
    if (!next) return this.getProject()
    this.project = next
    this.normalizeProject()
    return this.getProject()
  }

  private captureHistory(): void {
    this.undoStack.push(cloneProject(this.project))
    if (this.undoStack.length > 100) this.undoStack.shift()
    this.redoStack = []
  }

  private appendAssetsToActiveSequence(assets: MediaAssetRecord[]): void {
    const sequence = this.getActiveSequenceMutable()
    const videoTrack = this.ensureTrack(sequence, 'video')
    const audioTrack = this.ensureTrack(sequence, 'audio')

    let currentTime = sequence.duration
    for (const asset of assets) {
      const clipDuration = Math.max(1, asset.duration || getFallbackDuration(asset.type))

      if (asset.type === 'video' || asset.type === 'image') {
        videoTrack.clips.push({
          id: createId('clip'),
          assetId: asset.id,
          trackId: videoTrack.id,
          startTime: currentTime,
          duration: clipDuration,
          inPoint: 0,
          label: asset.name
        })
      }

      if (asset.type === 'video' || asset.type === 'audio') {
        audioTrack.clips.push({
          id: createId('clip'),
          assetId: asset.id,
          trackId: audioTrack.id,
          startTime: currentTime,
          duration: clipDuration,
          inPoint: 0,
          label: asset.name
        })
      }

      currentTime += clipDuration
    }
  }

  private ensureTrack(sequence: SequenceRecord, kind: TimelineTrackRecord['kind']): TimelineTrackRecord {
    const existing = sequence.tracks.find((track) => track.kind === kind)
    if (existing) return existing

    const nextIndex = sequence.tracks.filter((track) => track.kind === kind).length + 1
    const track = createTrack(kind, nextIndex)
    sequence.tracks.push(track)
    return track
  }

  private getActiveSequenceMutable(): SequenceRecord {
    const sequence = this.project.sequences.find((item) => item.active) ?? this.project.sequences[0]
    if (!sequence) {
      const created = createEmptySequence('Main Sequence')
      this.project.sequences = [created]
      return created
    }
    return sequence
  }

  private normalizeProject(): void {
    this.project.assets = this.project.assets.map((asset) => {
      normalizeSemanticAnnotation(asset)
      return asset
    })

    if (this.project.sequences.length === 0) {
      this.project.sequences = [createEmptySequence('Main Sequence')]
    }

    const desiredActiveSequenceId =
      this.project.sequences.find((sequence) => sequence.active)?.id ?? this.project.sequences[0]?.id ?? null

    this.project.sequences = this.project.sequences.map((sequence, index) => {
      const normalizedTracks =
        sequence.tracks.length > 0
          ? sequence.tracks.map((track, trackIndex) => ({
              ...track,
              name:
                track.name ||
                (track.kind === 'video'
                  ? `V${trackIndex + 1}`
                  : track.kind === 'audio'
                    ? `A${trackIndex + 1}`
                    : trackIndex === 0
                      ? 'Captions'
                      : `Captions ${trackIndex + 1}`),
              clips: [...track.clips].sort((left, right) => left.startTime - right.startTime)
            }))
          : [createTrack('video', 1), createTrack('audio', 1), createTrack('caption', 1)]

      const duration = normalizedTracks.reduce((maxDuration, track) => {
        const trackEnd = track.clips.reduce((maxClipEnd, clip) => Math.max(maxClipEnd, clip.startTime + clip.duration), 0)
        return Math.max(maxDuration, trackEnd)
      }, 0)

      return {
        ...sequence,
        active: sequence.id === desiredActiveSequenceId || (!desiredActiveSequenceId && index === 0),
        tracks: normalizedTracks,
        markers: [...(sequence.markers ?? [])].sort((left, right) => left.time - right.time),
        duration
      }
    })
  }

  private repairAssetDurations(): boolean {
    let didRepair = false
    const assetsById = new Map<string, MediaAssetRecord>()
    const previousDurations = new Map<string, number>()

    for (const asset of this.project.assets) {
      assetsById.set(asset.id, asset)
      previousDurations.set(asset.id, asset.duration)

      const probedDuration = probeMediaDuration(asset.path, asset.type)
      if (Math.abs(probedDuration - asset.duration) > 0.05) {
        asset.duration = probedDuration
        didRepair = true
      }
    }

    for (const sequence of this.project.sequences) {
      for (const track of sequence.tracks) {
        for (const clip of track.clips) {
          const asset = assetsById.get(clip.assetId)
          const previousDuration = previousDurations.get(clip.assetId)
          if (!asset || previousDuration === undefined || asset.type === 'image') continue

          const mirroredWholeAssetDuration = clip.inPoint === 0 && Math.abs(clip.duration - previousDuration) <= 0.05
          if (!mirroredWholeAssetDuration) continue

          if (Math.abs(asset.duration - clip.duration) > 0.05) {
            clip.duration = asset.duration
            didRepair = true
          }
        }
      }
    }

    return didRepair
  }

  updateAssetVector(assetId: string, vector: number[]): void {
    const asset = this.project.assets.find((a) => a.id === assetId)
    if (!asset) throw new Error(`Asset ${assetId} not found`)
    asset.semantic.vector = vector
    this.touch()
  }

  updateAssetSegmentVectors(
    assetId: string,
    segmentVectors: Array<{ segmentId: string; vector: number[] }>
  ): void {
    const asset = this.project.assets.find((a) => a.id === assetId)
    if (!asset) throw new Error(`Asset ${assetId} not found`)

    const vectorBySegmentId = new Map(segmentVectors.map((entry) => [entry.segmentId, entry.vector]))
    for (const segment of asset.semantic.segments) {
      const vector = vectorBySegmentId.get(segment.id)
      if (vector) segment.vector = vector
    }
    this.touch()
  }

  getAssetsWithoutVectors(): import('../../shared/editor').MediaAssetRecord[] {
    return this.project.assets.filter((a) => !a.semantic.vector)
  }

  getAssetsWithUnembeddedSegments(): import('../../shared/editor').MediaAssetRecord[] {
    return this.project.assets.filter((asset) => asset.semantic.segments.some((segment) => !segment.vector))
  }

  getAssetSegments(assetId: string): SemanticSegment[] {
    const asset = this.project.assets.find((a) => a.id === assetId)
    if (!asset) throw new Error(`Asset ${assetId} not found`)
    return structuredClone(asset.semantic.segments)
  }

  updateAssetTranscript(assetId: string, segments: import('../../shared/editor').TranscriptSegment[]): void {
    const asset = this.project.assets.find((a) => a.id === assetId)
    if (!asset) throw new Error(`Asset ${assetId} not found`)

    asset.semantic.transcript = segments
    asset.semantic.confidence = 0.95
    rebuildSemanticSegments(asset)
    delete asset.semantic.vector
    for (const segment of asset.semantic.segments) delete segment.vector
    this.captureHistory()
    this.touch()
  }

  updateAssetVisualSegments(assetId: string, segments: SemanticSegment[]): void {
    const asset = this.project.assets.find((a) => a.id === assetId)
    if (!asset) throw new Error(`Asset ${assetId} not found`)

    asset.semantic.visualSegments = segments.map((segment, index) => ({
      id: segment.id || `segment_${asset.id}_visual_${index}`,
      kind: 'visual',
      start: Math.max(0, segment.start),
      end: Math.max(segment.end, segment.start),
      text: segment.text.trim(),
      label: segment.label?.trim() || 'Visual',
      confidence: typeof segment.confidence === 'number' ? segment.confidence : 0.8
    }))
    rebuildSemanticSegments(asset)
    delete asset.semantic.vector
    for (const segment of asset.semantic.segments) delete segment.vector
    this.captureHistory()
    this.touch()
  }

  addClip(params: {
    assetId: string
    trackId: string
    startTime: number
    duration: number
    inPoint: number
    label: string
  }): { clipId: string; clip: TimelineClipRecord } {
    this.captureHistory()
    const clipId = createId('clip')
    for (const seq of this.project.sequences) {
      const track = seq.tracks.find((t) => t.id === params.trackId)
      if (track) {
        const clip: TimelineClipRecord = {
          id: clipId,
          assetId: params.assetId,
          trackId: params.trackId,
          startTime: params.startTime,
          duration: params.duration,
          inPoint: params.inPoint,
          label: params.label
        }
        track.clips.push(clip)
        this.touch()
        return { clipId, clip: structuredClone(clip) }
      }
    }
    throw new Error(`Track ${params.trackId} not found`)
  }

  duplicateClip(clipId: string, offsetSeconds = 0): { clipId: string; clip: TimelineClipRecord } {
    this.captureHistory()
    for (const seq of this.project.sequences) {
      for (const track of seq.tracks) {
        const src = track.clips.find((c) => c.id === clipId)
        if (src) {
          const newClip: TimelineClipRecord = {
            ...structuredClone(src),
            id: createId('clip'),
            startTime: src.startTime + src.duration + offsetSeconds
          }
          track.clips.push(newClip)
          this.touch()
          return { clipId: newClip.id, clip: structuredClone(newClip) }
        }
      }
    }
    throw new Error(`Clip ${clipId} not found`)
  }

  updateClipLabel(clipId: string, label: string): void {
    this.captureHistory()
    for (const seq of this.project.sequences) {
      for (const track of seq.tracks) {
        const clip = track.clips.find((c) => c.id === clipId)
        if (clip) { clip.label = label; this.touch(); return }
      }
    }
    throw new Error(`Clip ${clipId} not found`)
  }

  setClipTransition(
    clipId: string,
    side: 'in' | 'out',
    type: import('../../shared/editor').TransitionType | null,
    duration = 1.0
  ): void {
    this.captureHistory()
    for (const seq of this.project.sequences) {
      for (const track of seq.tracks) {
        const clip = track.clips.find((c) => c.id === clipId)
        if (clip) {
          if (type === null) {
            if (side === 'in') delete clip.transitionIn
            else delete clip.transitionOut
          } else {
            const transition: import('../../shared/editor').Transition = {
              id: createId('transition'),
              type,
              duration,
              parameters: {}
            }
            if (side === 'in') clip.transitionIn = transition
            else clip.transitionOut = transition
          }
          this.touch()
          return
        }
      }
    }
    throw new Error(`Clip ${clipId} not found`)
  }

  createSequence(name: string): import('../../shared/editor').SequenceRecord {
    this.captureHistory()
    const seq = createEmptySequence(name)
    this.project.sequences.push(seq)
    this.normalizeProject()
    this.touch()
    const created = this.project.sequences.find((item) => item.id === seq.id)
    if (!created) {
      throw new Error('Sequence not found after creation.')
    }
    return structuredClone(created)
  }

  rippleDeleteClip(clipId: string): void {
    this.captureHistory()
    for (const sequence of this.project.sequences) {
      for (const track of sequence.tracks) {
        const index = track.clips.findIndex((clip) => clip.id === clipId)
        if (index < 0) continue

        const clip = track.clips[index]
        const deleteStart = clip.startTime
        const deleteDuration = clip.duration
        track.clips.splice(index, 1)

        for (const affectedTrack of sequence.tracks) {
          for (const candidate of affectedTrack.clips) {
            if (candidate.startTime >= deleteStart + deleteDuration - 0.0001) {
              candidate.startTime = Math.max(deleteStart, candidate.startTime - deleteDuration)
            }
          }
        }

        for (const marker of sequence.markers ?? []) {
          if (marker.time >= deleteStart + deleteDuration - 0.0001) {
            marker.time = Math.max(deleteStart, marker.time - deleteDuration)
          }
        }

        this.touch()
        return
      }
    }

    throw new Error(`Clip ${clipId} not found`)
  }

  rippleInsertGap(time: number, duration: number, sequenceId?: string): SequenceRecord {
    const sequence = sequenceId
      ? this.project.sequences.find((item) => item.id === sequenceId)
      : this.getActiveSequenceMutable()
    if (!sequence) throw new Error('Sequence not found.')

    this.captureHistory()
    const gapStart = Math.max(0, time)
    const gapDuration = Math.max(0.1, duration)

    for (const track of sequence.tracks) {
      for (const clip of track.clips) {
        if (clip.startTime >= gapStart - 0.0001) {
          clip.startTime += gapDuration
        }
      }
    }

    for (const marker of sequence.markers ?? []) {
      if (marker.time >= gapStart - 0.0001) {
        marker.time += gapDuration
      }
    }

    this.touch()
    return structuredClone(sequence)
  }

  buildSelectsSequenceFromSegments(
    matches: SegmentSearchResult[],
    params: { sequenceName?: string; padding?: number; limit?: number } = {}
  ): SequenceRecord {
    const selects = createEmptySequence(params.sequenceName?.trim() || 'AI Selects')
    const videoTrack = selects.tracks.find((track) => track.kind === 'video')
    const audioTrack = selects.tracks.find((track) => track.kind === 'audio')
    if (!videoTrack || !audioTrack) throw new Error('Selects sequence tracks missing')

    const assetsById = new Map(this.project.assets.map((asset) => [asset.id, asset]))
    const padding = Math.max(0, params.padding ?? 0.35)
    const limitedMatches = matches.slice(0, Math.max(1, params.limit ?? matches.length))

    let cursor = 0
    for (const match of limitedMatches) {
      const asset = assetsById.get(match.asset.id)
      if (!asset) continue

      const clipIn = Math.max(0, match.segment.start - padding)
      const clipOut = Math.min(asset.duration, match.segment.end + padding)
      const duration = Math.max(0.25, clipOut - clipIn)
      const label = `${match.segment.label}: ${match.segment.text}`.trim()

      if (asset.type !== 'audio') {
        videoTrack.clips.push({
          id: createId('clip'),
          assetId: asset.id,
          trackId: videoTrack.id,
          startTime: cursor,
          duration,
          inPoint: clipIn,
          label
        })
      }

      if (asset.type !== 'image') {
        audioTrack.clips.push({
          id: createId('clip'),
          assetId: asset.id,
          trackId: audioTrack.id,
          startTime: cursor,
          duration,
          inPoint: clipIn,
          label
        })
      }

      selects.markers.push({
        id: createId('marker'),
        time: cursor,
        duration,
        label: match.segment.label,
        color: match.segment.kind === 'speech' ? 'blue' : match.segment.kind === 'visual' ? 'green' : 'gray',
        assetId: asset.id,
        segmentId: match.segment.id,
        notes: match.segment.text
      })

      cursor += duration
    }

    selects.duration = cursor
    return this.upsertSequence(selects)
  }

  trimClip(clipId: string, params: { inPoint?: number; duration?: number; startTime?: number }): TimelineClipRecord {
    this.captureHistory()
    for (const seq of this.project.sequences) {
      for (const track of seq.tracks) {
        const clip = track.clips.find((c) => c.id === clipId)
        if (clip) {
          if (params.inPoint !== undefined)  clip.inPoint   = Math.max(0, params.inPoint)
          if (params.duration !== undefined) clip.duration  = Math.max(0.1, params.duration)
          if (params.startTime !== undefined) clip.startTime = Math.max(0, params.startTime)
          this.touch()
          return structuredClone(clip)
        }
      }
    }
    throw new Error(`Clip ${clipId} not found`)
  }

  moveClip(clipId: string, newStartTime: number): void {
    this.captureHistory()
    for (const seq of this.project.sequences) {
      for (const track of seq.tracks) {
        const clip = track.clips.find((c) => c.id === clipId)
        if (clip) {
          clip.startTime = Math.max(0, newStartTime)
          this.touch()
          return
        }
      }
    }
    throw new Error(`Clip ${clipId} not found`)
  }

  removeClip(clipId: string): void {
    this.captureHistory()
    for (const seq of this.project.sequences) {
      for (const track of seq.tracks) {
        const idx = track.clips.findIndex((c) => c.id === clipId)
        if (idx >= 0) {
          track.clips.splice(idx, 1)
          this.touch()
          return
        }
      }
    }
    throw new Error(`Clip ${clipId} not found`)
  }

  addClipEffect(clipId: string, effectType: string, parameters: Record<string, unknown>): EditorProjectRecord {
    for (const seq of this.project.sequences) {
      for (const track of seq.tracks) {
        const clip = track.clips.find((c) => c.id === clipId)
        if (clip) {
          if (!clip.effects) clip.effects = []
          const effect: import('../../shared/editor').Effect = {
            id: createId('effect'),
            type: effectType as import('../../shared/editor').EffectType,
            enabled: true,
            parameters
          }
          clip.effects.push(effect)
          this.captureHistory()
          this.touch()
          return this.project
        }
      }
    }
    throw new Error(`Clip ${clipId} not found`)
  }

  setClipEffectKeyframes(
    clipId: string,
    effectId: string,
    keyframes: Array<{
      id?: string
      time: number
      easing?: 'linear' | 'ease_in' | 'ease_out' | 'ease_in_out'
      parameters: Record<string, unknown>
    }>
  ): EditorProjectRecord {
    for (const seq of this.project.sequences) {
      for (const track of seq.tracks) {
        const clip = track.clips.find((c) => c.id === clipId)
        const effect = clip?.effects?.find((item) => item.id === effectId)
        if (!clip || !effect) continue

        effect.keyframes = keyframes
          .map((keyframe) => ({
            id: keyframe.id || createId('kf'),
            time: Math.max(0, Number(keyframe.time) || 0),
            easing: keyframe.easing,
            parameters: keyframe.parameters as Record<string, number | string | boolean>
          }))
          .sort((left, right) => left.time - right.time)

        this.captureHistory()
        this.touch()
        return this.project
      }
    }

    throw new Error(`Clip ${clipId} or effect ${effectId} not found`)
  }

  removeClipEffect(clipId: string, effectId: string): EditorProjectRecord {
    for (const seq of this.project.sequences) {
      for (const track of seq.tracks) {
        const clip = track.clips.find((c) => c.id === clipId)
        if (clip && clip.effects) {
          clip.effects = clip.effects.filter((e) => e.id !== effectId)
          this.captureHistory()
          this.touch()
          return this.project
        }
      }
    }
    throw new Error(`Clip ${clipId} or effect ${effectId} not found`)
  }

  setClipVolume(clipId: string, volume: number): EditorProjectRecord {
    for (const seq of this.project.sequences) {
      for (const track of seq.tracks) {
        const clip = track.clips.find((c) => c.id === clipId)
        if (clip) {
          clip.volume = Math.max(0, Math.min(2, volume))
          this.captureHistory()
          this.touch()
          return this.project
        }
      }
    }
    throw new Error(`Clip ${clipId} not found`)
  }

  setClipSpeed(clipId: string, speed: number): EditorProjectRecord {
    for (const seq of this.project.sequences) {
      for (const track of seq.tracks) {
        const clip = track.clips.find((c) => c.id === clipId)
        if (clip) {
          clip.speed = Math.max(0.1, Math.min(10, speed))
          this.captureHistory()
          this.touch()
          return this.project
        }
      }
    }
    throw new Error(`Clip ${clipId} not found`)
  }

  private touch(): void {
    this.project.updatedAt = Date.now()
    this.normalizeProject()
    this.scheduleAutosave()
    const snapshot = cloneProject(this.project)
    for (const listener of this.listeners) listener(snapshot)
  }
}
