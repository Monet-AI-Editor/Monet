import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  AIProvider,
  AISettings,
  BackgroundTask,
  ChatMessage,
  ExportResult,
  ExportOptions,
  LeftTab,
  MediaAsset,
  Model,
  ExportProgressState,
  ProjectManagerState,
  RightTab,
  SequenceSummary,
  SupportedModel,
  ToolDefinition,
  Track
} from '../types'
import { runExportSequenceFlow } from './export-flow'

type BackendProject = {
  name: string
  assets: Array<{
    id: string
    name: string
    path: string
    type: 'video' | 'audio' | 'image'
    duration: number
    createdAt: number
    semantic: {
      summary: string
      tags: string[]
      transcript: Array<{ id: string; start: number; end: number; text: string; speaker?: string }>
      segments: Array<{
        id: string
        kind: 'metadata' | 'speech' | 'visual'
        start: number
        end: number
        text: string
        label: string
        confidence: number
        vector?: number[]
      }>
    }
  }>
  tasks: Array<{
    id: string
    label: string
    type: 'transcribe' | 'embed' | 'proxy' | 'analyze' | 'rough_cut'
    status: 'queued' | 'running' | 'done' | 'error'
    progress: number
    assetId?: string
  }>
  sequences: Array<{
    id: string
    name: string
    duration: number
    active: boolean
    width: number
    height: number
    tracks: Array<{
      id: string
      name: string
      kind: 'video' | 'audio' | 'caption'
      clips: Array<{
        id: string
        assetId: string
        label: string
        startTime: number
        duration: number
        inPoint: number
        transitionIn?: {
          id: string
          type: 'crossfade' | 'dip_to_black' | 'wipe' | 'slide'
          duration: number
          parameters: Record<string, number | string | boolean>
        }
        transitionOut?: {
          id: string
          type: 'crossfade' | 'dip_to_black' | 'wipe' | 'slide'
          duration: number
          parameters: Record<string, number | string | boolean>
        }
        effects?: Array<{
          id: string
          type: string
          enabled: boolean
          parameters: Record<string, number | string | boolean>
          keyframes?: Array<{
            id: string
            time: number
            easing?: 'linear' | 'ease_in' | 'ease_out' | 'ease_in_out'
            parameters: Record<string, number | string | boolean>
          }>
        }>
        volume?: number
      }>
    }>
  }>
}

type BootstrapPayload = {
  project: BackendProject
  availableTools: ToolDefinition[]
  availableModels: SupportedModel[]
  settings: AISettings
  canUndo: boolean
  canRedo: boolean
  projectFilePath: string | null
  projectManager: ProjectManagerState
  controlState?: {
    playheadTime: number
    selectedClipId: string | null
    selectedAssetId: string | null
    activeSequenceId: string | null
  }
}

type ProjectLoadPayload = {
  project: BackendProject
  projectManager: ProjectManagerState
}

type ChatPayload = {
  project: BackendProject
  message: ChatMessage
}

function createClientId(prefix: string): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`
}

function getClipColor(trackKind: 'video' | 'audio' | 'caption', assetType: 'video' | 'audio' | 'image'): string {
  if (trackKind === 'caption') return '#888888'
  if (trackKind === 'audio') return '#eab308'
  if (assetType === 'image') return '#22c55e'
  return '#c8d4e0'
}

function mapProject(project: BackendProject) {
  const assets: MediaAsset[] = project.assets.map((asset) => ({
    id: asset.id,
    name: asset.name,
    path: asset.path,
    type: asset.type,
    duration: asset.duration,
    transcript: asset.semantic.transcript,
    semanticSegments: asset.semantic.segments.map((segment) => ({
      id: segment.id,
      kind: segment.kind,
      start: segment.start,
      end: segment.end,
      text: segment.text,
      label: segment.label,
      confidence: segment.confidence,
      embedded: Array.isArray(segment.vector) && segment.vector.length > 0
    })),
    tags: asset.semantic.tags,
    summary: asset.semantic.summary,
    addedAt: asset.createdAt
  }))

  const activeSequence = project.sequences.find((sequence) => sequence.active) ?? project.sequences[0]
  const tracks: Track[] =
    activeSequence?.tracks.map((track) => ({
      id: track.id,
      name: track.name,
      type: track.kind,
      height: track.kind === 'video' ? 52 : track.kind === 'audio' ? 40 : 28,
      clips: track.clips.map((clip) => {
        const asset = assets.find((item) => item.id === clip.assetId)
        return {
          id: clip.id,
          assetId: clip.assetId,
          trackId: track.id,
          name: clip.label,
          type: asset?.type ?? 'video',
          startTime: clip.startTime,
          duration: clip.duration,
          inPoint: clip.inPoint,
          color: getClipColor(track.kind, asset?.type ?? 'video'),
          effects: (clip.effects ?? []).map((effect) => ({
            ...effect,
            keyframes: effect.keyframes ?? []
          })),
          volume: clip.volume ?? 1,
          transitionIn: clip.transitionIn,
          transitionOut: clip.transitionOut
        }
      })
    })) ?? []

  const tasks: BackgroundTask[] = project.tasks.map((task) => ({
    id: task.id,
    label: task.label,
    type: task.type === 'rough_cut' ? 'analyze' : task.type,
    progress: task.progress,
    status: task.status,
    assetId: task.assetId
  }))

  const sequences: SequenceSummary[] = project.sequences.map((sequence) => ({
    id: sequence.id,
    name: sequence.name,
    duration: sequence.duration,
    active: sequence.active,
    width: sequence.width,
    height: sequence.height
  }))

  const totalDuration = activeSequence?.duration ?? 0
  const firstClipId = tracks.flatMap((track) => track.clips).at(0)?.id ?? null

  return {
    projectName: project.name,
    assets,
    tasks,
    tracks,
    sequences,
    totalDuration,
    firstClipId,
    activeSequenceWidth: activeSequence?.width ?? 1920,
    activeSequenceHeight: activeSequence?.height ?? 1080
  }
}

export interface EditorState {
  projectName: string
  assets: MediaAsset[]
  selectedAssetId: string | null
  tracks: Track[]
  sequences: SequenceSummary[]
  selectedClipId: string | null
  playheadTime: number
  totalDuration: number
  activeSequenceWidth: number
  activeSequenceHeight: number
  zoom: number
  isPlaying: boolean
  leftTab: LeftTab
  rightTab: RightTab
  leftWidth: number
  rightWidth: number
  model: Model
  availableModels: SupportedModel[]
  messages: ChatMessage[]
  aiThinking: boolean
  tasks: BackgroundTask[]
  availableTools: ToolDefinition[]
  aiSettings: AISettings
  isReady: boolean
  lastError: string | null
  exportStatus: 'idle' | 'running'
  exportMessage: string | null
  exportProgress: number | null
  lastExportPath: string | null
  canUndo: boolean
  canRedo: boolean
  projectFilePath: string | null
  projectManager: ProjectManagerState
}

export interface EditorActions {
  setProjectName: (name: string) => Promise<void>
  openProject: (filePath?: string) => Promise<boolean>
  createProject: (name?: string) => Promise<void>
  saveProject: () => Promise<void>
  importMedia: () => Promise<void>
  removeAsset: (id: string) => void
  selectAsset: (id: string | null) => void
  setLeftTab: (tab: LeftTab) => void
  setRightTab: (tab: RightTab) => void
  setLeftWidth: (w: number) => void
  setRightWidth: (w: number) => void
  setModel: (m: Model) => void
  setApiKey: (provider: AIProvider, value: string) => void
  setAnalyticsEnabled: (enabled: boolean) => void
  setOnboardingCompleted: (completed: boolean) => void
  persistAISettings: (overrides?: Partial<AISettings>) => Promise<void>
  sendMessage: (content: string) => Promise<void>
  runTool: (name: string, args?: Record<string, unknown>) => Promise<void>
  exportSequence: (options: ExportOptions) => Promise<boolean>
  setPlayheadTime: (t: number) => void
  setIsPlaying: (v: boolean) => void
  setZoom: (z: number) => void
  selectClip: (id: string | null) => void
  addTrack: (kind: 'video' | 'audio' | 'caption') => Promise<void>
  activateSequence: (sequenceId: string) => Promise<void>
  splitSelectedClip: () => Promise<void>
  addClipEffect: (clipId: string, effectType: string, parameters?: Record<string, unknown>) => Promise<void>
  updateClipEffectParameters: (clipId: string, effectId: string, parameters: Record<string, unknown>) => Promise<void>
  removeClipEffect: (clipId: string, effectId: string) => Promise<void>
  undo: () => Promise<void>
  redo: () => Promise<void>
}

const EMPTY_SETTINGS: AISettings = {
  selectedModelId: 'claude-sonnet-4-20250514',
  apiKeys: {
    anthropic: '',
    openai: '',
    google: ''
  },
  semanticProvider: 'openai',
  semanticApiKeys: {
    openai: '',
    google: '',
    voyage: ''
  },
  analyticsEnabled: false,
  onboardingCompleted: false,
  agentInstallNudgeSeen: false
}

export function isMissingProjectSelectionError(error: unknown): boolean {
  return error instanceof Error && /No \.aiveproj\.json project file was found in that folder\./.test(error.message)
}

export function useEditorStore(): EditorState & EditorActions {
  const [projectName, setProjectNameState] = useState('Untitled Project')
  const [projectInstanceId, setProjectInstanceId] = useState<string>(() =>
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `proj_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
  )
  const [assets, setAssets] = useState<MediaAsset[]>([])
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null)
  const [tracks, setTracks] = useState<Track[]>([])
  const [sequences, setSequences] = useState<SequenceSummary[]>([])
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null)
  const [playheadTime, setPlayheadTime] = useState(0)
  const [totalDuration, setTotalDuration] = useState(0)
  const [activeSequenceWidth, setActiveSequenceWidth] = useState(1920)
  const [activeSequenceHeight, setActiveSequenceHeight] = useState(1080)
  const [zoom, setZoom] = useState(1)
  const [isPlaying, setIsPlaying] = useState(false)
  const [leftTab, setLeftTab] = useState<LeftTab>('media')
  const [rightTab, setRightTab] = useState<RightTab>('terminal')
  const [leftWidth, setLeftWidth] = useState(240)
  const [rightWidth, setRightWidth] = useState(340)
  const [model, setModelState] = useState<Model>(EMPTY_SETTINGS.selectedModelId)
  const [availableModels, setAvailableModels] = useState<SupportedModel[]>([])
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [aiThinking, setAiThinking] = useState(false)
  const [tasks, setTasks] = useState<BackgroundTask[]>([])
  const [availableTools, setAvailableTools] = useState<ToolDefinition[]>([])
  const [aiSettings, setAiSettings] = useState<AISettings>(EMPTY_SETTINGS)
  const [isReady, setIsReady] = useState(false)
  const [lastError, setLastError] = useState<string | null>(null)
  const [exportStatus, setExportStatus] = useState<'idle' | 'running'>('idle')
  const [exportMessage, setExportMessage] = useState<string | null>(null)
  const [exportProgress, setExportProgress] = useState<number | null>(null)
  const [lastExportPath, setLastExportPath] = useState<string | null>(null)
  const [canUndo, setCanUndo] = useState(false)
  const [canRedo, setCanRedo] = useState(false)
  const [projectFilePath, setProjectFilePath] = useState<string | null>(null)
  const [projectManager, setProjectManager] = useState<ProjectManagerState>({
    currentProjectFilePath: null,
    recentProjects: []
  })
  const activeSequenceId = useMemo(
    () => sequences.find((sequence) => sequence.active)?.id ?? null,
    [sequences]
  )

  const messagesRef = useRef(messages)
  const settingsRef = useRef(aiSettings)
  const modelRef = useRef(model)
  const exportToastTimeoutRef = useRef<number | null>(null)

  useEffect(() => {
    messagesRef.current = messages
  }, [messages])

  useEffect(() => {
    settingsRef.current = aiSettings
  }, [aiSettings])

  useEffect(() => {
    modelRef.current = model
  }, [model])

  useEffect(() => {
    return () => {
      if (exportToastTimeoutRef.current != null) {
        window.clearTimeout(exportToastTimeoutRef.current)
      }
    }
  }, [])

  const clearExportToast = useCallback(() => {
    if (exportToastTimeoutRef.current != null) {
      window.clearTimeout(exportToastTimeoutRef.current)
      exportToastTimeoutRef.current = null
    }
    setLastExportPath(null)
  }, [])

  const showExportToast = useCallback((outputPath: string) => {
    if (exportToastTimeoutRef.current != null) {
      window.clearTimeout(exportToastTimeoutRef.current)
    }
    setLastExportPath(outputPath)
    exportToastTimeoutRef.current = window.setTimeout(() => {
      setLastExportPath(null)
      exportToastTimeoutRef.current = null
    }, 8000)
  }, [])

  const syncControlState = useCallback((partial: {
    playheadTime?: number
    selectedClipId?: string | null
    selectedAssetId?: string | null
    activeSequenceId?: string | null
  }) => {
    void window.api.updateControlState(partial).catch(() => undefined)
  }, [])

  const applyProject = useCallback((project: BackendProject) => {
    const mapped = mapProject(project)
    setProjectInstanceId(
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `proj_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
    )
    setProjectNameState(mapped.projectName)
    setAssets(mapped.assets)
    setTasks(mapped.tasks)
    setTracks(mapped.tracks)
    setSequences(mapped.sequences)
    setTotalDuration(mapped.totalDuration)
    setActiveSequenceWidth(mapped.activeSequenceWidth)
    setActiveSequenceHeight(mapped.activeSequenceHeight)
    setSelectedAssetId((current) => (current && mapped.assets.some((asset) => asset.id === current) ? current : mapped.assets[0]?.id ?? null))
    setSelectedClipId((current) => (current && mapped.tracks.some((track) => track.clips.some((clip) => clip.id === current)) ? current : mapped.firstClipId))
    setPlayheadTime((current) => Math.min(current, mapped.totalDuration))
  }, [])

  const applyBootstrapMeta = useCallback((payload: BootstrapPayload) => {
    setAvailableTools(payload.availableTools)
    setAvailableModels(payload.availableModels)
    setAiSettings(payload.settings)
    setModelState(payload.settings.selectedModelId)
    setCanUndo(payload.canUndo)
    setCanRedo(payload.canRedo)
    setProjectFilePath(payload.projectFilePath)
    setProjectManager(payload.projectManager)
    if (payload.controlState) {
      setPlayheadTime(payload.controlState.playheadTime)
      setSelectedClipId(payload.controlState.selectedClipId)
      setSelectedAssetId(payload.controlState.selectedAssetId)
    }
  }, [])

  const bootstrap = useCallback(async () => {
    const payload = (await window.api.getEditorBootstrap()) as BootstrapPayload
    applyProject(payload.project)
    applyBootstrapMeta(payload)
    setMessages([
      {
        id: createClientId('msg'),
        role: 'assistant',
        content:
          payload.project.assets.length > 0
            ? `Project loaded. I can inspect your media inventory, search transcripts when they exist, and build a rough cut with ${payload.availableModels.find((item) => item.id === payload.settings.selectedModelId)?.label ?? 'the selected model'}.`
            : 'Project loaded. Import media. Add an API key only if you want transcription, embeddings, or model-driven tools.',
        timestamp: Date.now(),
        status: 'done'
      }
    ])
    setIsReady(true)
  }, [applyBootstrapMeta, applyProject])

  useEffect(() => {
    void bootstrap().catch((error: Error) => {
      setLastError(error.message)
      setMessages([
        {
          id: createClientId('msg'),
          role: 'assistant',
          content: `Failed to initialize the editor runtime: ${error.message}`,
          timestamp: Date.now(),
          status: 'error'
        }
      ])
    })
  }, [bootstrap])

  useEffect(() => {
    if (typeof window.api.onProjectUpdated !== 'function') return
    return window.api.onProjectUpdated((project) => {
      applyProject(project as BackendProject)
    })
  }, [applyProject])

  useEffect(() => {
    if (typeof window.api.onSetPlayhead !== 'function') return
    return window.api.onSetPlayhead((time) => {
      setPlayheadTime(time)
    })
  }, [])

  useEffect(() => {
    if (typeof window.api.onSelectClip !== 'function') return
    return window.api.onSelectClip((clipId) => {
      setSelectedClipId(clipId)
    })
  }, [])

  useEffect(() => {
    if (typeof window.api.onSelectAsset !== 'function') return
    return window.api.onSelectAsset((assetId) => {
      setSelectedAssetId(assetId)
    })
  }, [])

  useEffect(() => {
    if (typeof window.api.onExportProgress !== 'function') return
    return window.api.onExportProgress((progress) => {
      const next = progress as ExportProgressState
      setExportStatus('running')
      setExportMessage(next.message)
      setExportProgress(Math.max(0, Math.min(1, next.progress)))
    })
  }, [])

  const setProjectName = useCallback(async (name: string) => {
    setProjectNameState(name)
    await window.api.updateProjectName(name)
    const payload = await window.api.getEditorBootstrap() as BootstrapPayload
    applyBootstrapMeta(payload)
  }, [applyBootstrapMeta])

  const importMedia = useCallback(async () => {
    const filePaths = await window.api.openFiles()
    if (filePaths.length === 0) return

    await window.api.importFiles(filePaths)
    const payload = (await window.api.getEditorBootstrap()) as BootstrapPayload
    applyProject(payload.project)
    applyBootstrapMeta(payload)
    setLeftTab('media')
  }, [applyBootstrapMeta, applyProject])

  const removeAsset = useCallback((id: string) => {
    void window.api.removeAsset(id).then((project) => {
      applyProject(project as BackendProject)
      return window.api.getEditorBootstrap()
    }).then((payload) => {
      if (payload) applyBootstrapMeta(payload as BootstrapPayload)
    })
  }, [applyBootstrapMeta, applyProject])

  const openProject = useCallback(async (explicitPath?: string) => {
    let filePath = explicitPath ?? null
    if (!filePath) {
      try {
        filePath = await window.api.openProjectFile()
      } catch (error) {
        if (isMissingProjectSelectionError(error)) return false
        throw error
      }
    }
    if (!filePath) return false
    setIsPlaying(false)
    clearExportToast()
    const payload = await window.api.openProject(filePath) as ProjectLoadPayload
    applyProject(payload.project)
    const bootstrap = await window.api.getEditorBootstrap() as BootstrapPayload
    applyBootstrapMeta(bootstrap)
    setMessages([
      {
        id: createClientId('msg'),
        role: 'assistant',
        content: `Opened project ${payload.project.name}.`,
        timestamp: Date.now(),
        status: 'done'
      }
    ])
    return true
  }, [applyBootstrapMeta, applyProject, clearExportToast])

  const createProject = useCallback(async (name?: string) => {
    setIsPlaying(false)
    clearExportToast()
    const payload = await window.api.createProject(name) as ProjectLoadPayload
    applyProject(payload.project)
    const bootstrap = await window.api.getEditorBootstrap() as BootstrapPayload
    applyBootstrapMeta(bootstrap)
    setMessages([
      {
        id: createClientId('msg'),
        role: 'assistant',
        content: `Created project ${payload.project.name}.`,
        timestamp: Date.now(),
        status: 'done'
      }
    ])
  }, [applyBootstrapMeta, applyProject, clearExportToast])

  const saveProject = useCallback(async () => {
    let outputPath = projectFilePath
    if (!outputPath) {
      outputPath = await window.api.saveProjectFile()
      if (!outputPath) return
    }

    const savedPath = await window.api.saveProject(outputPath)
    setProjectFilePath(savedPath)
    const nextProjectManager = await window.api.getProjectManagerState()
    setProjectManager(nextProjectManager)
    setMessages((current) => [
      ...current,
      {
        id: createClientId('msg'),
        role: 'assistant',
        content: `Saved project to ${savedPath}`,
        timestamp: Date.now(),
        status: 'done'
      }
    ])
  }, [projectFilePath])

  const selectAsset = useCallback((id: string | null) => {
    setSelectedAssetId(id)
    syncControlState({ selectedAssetId: id })
  }, [syncControlState])

  const setModel = useCallback((nextModel: Model) => {
    setModelState(nextModel)
    setAiSettings((current) => ({
      ...current,
      selectedModelId: nextModel
    }))
  }, [])

  const setApiKey = useCallback((provider: AIProvider, value: string) => {
    setAiSettings((current) => ({
      ...current,
      apiKeys: {
        ...current.apiKeys,
        [provider]: value
      }
    }))
  }, [])

  const setAnalyticsEnabled = useCallback((enabled: boolean) => {
    setAiSettings((current) => ({
      ...current,
      analyticsEnabled: enabled
    }))
  }, [])

  const setOnboardingCompleted = useCallback((completed: boolean) => {
    setAiSettings((current) => ({
      ...current,
      onboardingCompleted: completed
    }))
  }, [])

  const persistAISettings = useCallback(async (overrides?: Partial<AISettings>) => {
    const saved = await window.api.saveAISettings({
      ...settingsRef.current,
      ...overrides,
      selectedModelId: modelRef.current
    })
    setAiSettings(saved)
    setModelState(saved.selectedModelId)
    setLastError(null)
  }, [])

  const sendMessage = useCallback(async (content: string) => {
    const trimmed = content.trim()
    if (!trimmed) return

    const userMessage: ChatMessage = {
      id: createClientId('msg'),
      role: 'user',
      content: trimmed,
      timestamp: Date.now()
    }

    const nextMessages = [...messagesRef.current, userMessage]
    setMessages(nextMessages)
    setAiThinking(true)
    setLastError(null)

    try {
      await persistAISettings()
      const response = (await window.api.chatWithEditor({
        modelId: modelRef.current,
        messages: nextMessages
          .filter((message) => message.role === 'user' || message.role === 'assistant')
          .map((message) => ({
            id: message.id,
            role: message.role,
            content: message.content
          }))
      })) as ChatPayload

      applyProject(response.project)
      const payload = (await window.api.getEditorBootstrap()) as BootstrapPayload
      applyBootstrapMeta(payload)
      setMessages((current) => [...current, response.message])
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Chat request failed.'
      setLastError(message)
      setMessages((current) => [
        ...current,
        {
          id: createClientId('msg'),
          role: 'assistant',
          content: message,
          timestamp: Date.now(),
          status: 'error'
        }
      ])
    } finally {
      setAiThinking(false)
    }
  }, [applyBootstrapMeta, applyProject, persistAISettings])

  const exportSequence = useCallback(async (options: ExportOptions) => {
    return runExportSequenceFlow({
      api: {
        saveExportFile: (defaultFileName?: string) => window.api.saveExportFile(defaultFileName),
        exportActiveSequence: (outputPath: string, exportOptions: ExportOptions) =>
          window.api.exportActiveSequence(outputPath, exportOptions) as Promise<ExportResult>
      },
      projectName,
      options,
      createClientId,
      clearExportToast,
      showExportToast,
      setLastError,
      setExportStatus,
      setExportMessage,
      setExportProgress,
      appendMessage: (message) => {
        setMessages((current) => [...current, message])
      }
    })
  }, [clearExportToast, projectName, showExportToast])

  const runTool = useCallback(async (name: string, args: Record<string, unknown> = {}) => {
    setLastError(null)

    try {
      const result = await window.api.runEditorTool(name, args)
      const payload = (await window.api.getEditorBootstrap()) as BootstrapPayload
      applyProject(payload.project)
      applyBootstrapMeta(payload)
      setMessages((current) => [
        ...current,
        {
          id: createClientId('msg'),
          role: 'tool',
          content: `${name} completed`,
          timestamp: Date.now(),
          toolCalls: [
            {
              id: createClientId('tool'),
              name,
              args,
              result,
              status: 'done'
            }
          ],
          status: 'done'
        }
      ])
    } catch (error) {
      const message = error instanceof Error ? error.message : `Tool ${name} failed.`
      setLastError(message)
    }
  }, [applyBootstrapMeta, applyProject])

  const addClipEffect = useCallback(async (clipId: string, effectType: string, parameters: Record<string, unknown> = {}) => {
    const project = await window.api.addEffect(clipId, effectType, parameters)
    applyProject(project as BackendProject)
    const payload = await window.api.getEditorBootstrap() as BootstrapPayload
    applyBootstrapMeta(payload)
  }, [applyBootstrapMeta, applyProject])

  const updateClipEffectParameters = useCallback(async (clipId: string, effectId: string, parameters: Record<string, unknown>) => {
    const project = await window.api.updateEffectParameters(clipId, effectId, parameters)
    applyProject(project as BackendProject)
    const payload = await window.api.getEditorBootstrap() as BootstrapPayload
    applyBootstrapMeta(payload)
  }, [applyBootstrapMeta, applyProject])

  const removeClipEffect = useCallback(async (clipId: string, effectId: string) => {
    const project = await window.api.removeEffect(clipId, effectId)
    applyProject(project as BackendProject)
    const payload = await window.api.getEditorBootstrap() as BootstrapPayload
    applyBootstrapMeta(payload)
  }, [applyBootstrapMeta, applyProject])

  const addTrack = useCallback(async (kind: 'video' | 'audio' | 'caption') => {
    await window.api.addTrack(kind)
    const payload = (await window.api.getEditorBootstrap()) as BootstrapPayload
    applyProject(payload.project)
    applyBootstrapMeta(payload)
  }, [applyBootstrapMeta, applyProject])

  const activateSequence = useCallback(async (sequenceId: string) => {
    await window.api.activateSequence(sequenceId)
    const payload = (await window.api.getEditorBootstrap()) as BootstrapPayload
    applyProject(payload.project)
    applyBootstrapMeta(payload)
    syncControlState({ activeSequenceId: sequenceId })
  }, [applyBootstrapMeta, applyProject, syncControlState])

  const splitSelectedClip = useCallback(async () => {
    if (!selectedClipId) return
    await window.api.splitClip(selectedClipId, playheadTime)
    const payload = (await window.api.getEditorBootstrap()) as BootstrapPayload
    applyProject(payload.project)
    applyBootstrapMeta(payload)
  }, [applyBootstrapMeta, applyProject, playheadTime, selectedClipId])

  const undo = useCallback(async () => {
    const project = (await window.api.undo()) as BackendProject
    applyProject(project)
    const payload = (await window.api.getEditorBootstrap()) as BootstrapPayload
    applyBootstrapMeta(payload)
  }, [applyBootstrapMeta, applyProject])

  const redo = useCallback(async () => {
    const project = (await window.api.redo()) as BackendProject
    applyProject(project)
    const payload = (await window.api.getEditorBootstrap()) as BootstrapPayload
    applyBootstrapMeta(payload)
  }, [applyBootstrapMeta, applyProject])

  const memoizedState = useMemo(() => ({
    projectName,
    assets,
    selectedAssetId,
    tracks,
    sequences,
    selectedClipId,
    playheadTime,
    totalDuration,
    activeSequenceWidth,
    activeSequenceHeight,
    zoom,
    isPlaying,
    leftTab,
    rightTab,
    leftWidth,
    rightWidth,
    model,
    availableModels,
    messages,
    aiThinking,
    tasks,
    availableTools,
    aiSettings,
    isReady,
    lastError,
    exportStatus,
    exportMessage,
    exportProgress,
    lastExportPath,
    canUndo,
    canRedo,
    projectFilePath,
    projectInstanceId,
    projectManager
  }), [
    projectName,
    assets,
    selectedAssetId,
    tracks,
    sequences,
    selectedClipId,
    playheadTime,
    totalDuration,
    activeSequenceWidth,
    activeSequenceHeight,
    zoom,
    isPlaying,
    leftTab,
    rightTab,
    leftWidth,
    rightWidth,
    model,
    availableModels,
    messages,
    aiThinking,
    tasks,
    availableTools,
    aiSettings,
    isReady,
    lastError,
    exportStatus,
    exportMessage,
    exportProgress,
    lastExportPath,
    canUndo,
    canRedo,
    projectFilePath,
    projectInstanceId,
    projectManager
  ])

  return {
    ...memoizedState,
    setProjectName,
    openProject,
    createProject,
    saveProject,
    importMedia,
    removeAsset,
    selectAsset,
    setLeftTab,
    setRightTab,
    setLeftWidth,
    setRightWidth,
    setModel,
    setApiKey,
    setAnalyticsEnabled,
    setOnboardingCompleted,
    persistAISettings,
    sendMessage,
    runTool,
    exportSequence,
    setPlayheadTime: (time: number) => {
      setPlayheadTime(time)
      syncControlState({ playheadTime: time })
    },
    setIsPlaying,
    setZoom,
    selectClip: (id: string | null) => {
      setSelectedClipId(id)
      syncControlState({ selectedClipId: id })
    },
    addTrack,
    activateSequence,
    splitSelectedClip,
    addClipEffect,
    updateClipEffectParameters,
    removeClipEffect,
    undo,
    redo
  }
}
