export type MediaType = 'video' | 'audio' | 'image'

export interface MediaAsset {
  id: string
  name: string
  path: string
  type: MediaType
  duration?: number
  thumbnail?: string
  transcript?: TranscriptSegment[]
  semanticSegments?: SemanticSegment[]
  tags?: string[]
  summary?: string
  addedAt: number
}

export interface TranscriptSegment {
  id: string
  start: number
  end: number
  text: string
  speaker?: string
}

export type SemanticSegmentKind = 'metadata' | 'speech' | 'visual'

export interface SemanticSegment {
  id: string
  kind: SemanticSegmentKind
  start: number
  end: number
  text: string
  label: string
  confidence: number
  embedded: boolean
}

export type ClipEffectType =
  | 'fade_in'
  | 'fade_out'
  | 'color_grade'
  | 'blur'
  | 'sharpen'
  | 'speed_ramp'
  | 'transform'
  | 'opacity'
  | 'blend_mode'
  | 'text_overlay'
  | 'chroma_key'
  | 'mask_box'

export type ClipEffectEasing = 'linear' | 'ease_in' | 'ease_out' | 'ease_in_out'

export interface ClipEffectKeyframe {
  id: string
  time: number
  easing?: ClipEffectEasing
  parameters: Record<string, number | string | boolean>
}

export interface ClipEffect {
  id: string
  type: ClipEffectType
  enabled: boolean
  parameters: Record<string, number | string | boolean>
  keyframes?: ClipEffectKeyframe[]
}

export interface TimelineClip {
  id: string
  assetId: string
  trackId: string
  name: string
  type: MediaType
  startTime: number
  duration: number
  inPoint: number
  color: string
  effects: ClipEffect[]
  volume: number
}

export interface Track {
  id: string
  name: string
  type: 'video' | 'audio' | 'caption'
  clips: TimelineClip[]
  muted?: boolean
  locked?: boolean
  height: number
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  timestamp: number
  toolCalls?: ToolCall[]
  status?: 'pending' | 'done' | 'error'
}

export interface ToolCall {
  id: string
  name: string
  args: Record<string, unknown>
  result?: unknown
  status: 'pending' | 'approved' | 'running' | 'done' | 'rejected' | 'error'
}

export interface BackgroundTask {
  id: string
  label: string
  type: 'transcribe' | 'proxy' | 'embed' | 'export' | 'analyze'
  progress: number
  status: 'queued' | 'running' | 'done' | 'error'
  assetId?: string
}

export interface SequenceSummary {
  id: string
  name: string
  duration: number
  active: boolean
}

export interface RecentProject {
  path: string
  name: string
  lastOpenedAt: number
}

export interface ProjectManagerState {
  currentProjectFilePath: string | null
  recentProjects: RecentProject[]
}

export type AppUpdateStatus = 'idle' | 'available' | 'downloading' | 'downloaded' | 'restarting' | 'error'

export interface AppUpdateState {
  status: AppUpdateStatus
  availableVersion: string | null
  currentVersion: string
  source: 'none' | 'dev-simulated' | 'github-release'
  message?: string
}

export type ExportProgressStage = 'preparing' | 'rendering' | 'finalizing' | 'done'

export interface ExportProgressState {
  stage: ExportProgressStage
  progress: number
  message: string
}

export type AIProvider = 'anthropic' | 'openai' | 'google'
export type SemanticProvider = 'openai' | 'google' | 'voyage'
export type Model = string

export interface SupportedModel {
  id: string
  label: string
  provider: AIProvider
  description: string
}

export interface ToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export interface AISettings {
  selectedModelId: string
  apiKeys: Record<AIProvider, string>
  semanticProvider: SemanticProvider
  semanticApiKeys: Record<SemanticProvider, string>
  analyticsEnabled: boolean
  onboardingCompleted: boolean
  agentInstallNudgeSeen: boolean
}

export type ExportQuality = 'draft' | 'standard' | 'high'
export type ExportResolution = '720p' | '1080p' | '4k'
export type ExportFormat = 'mp4' | 'mov'

export interface ExportOptions {
  quality: ExportQuality
  resolution: ExportResolution
  format: ExportFormat
}

export interface ExportResult {
  outputPath: string
  sequenceName: string
  duration: number
}

export type LeftTab = 'project' | 'media' | 'tasks'
export type RightTab = 'terminal' | 'tools' | 'context'
