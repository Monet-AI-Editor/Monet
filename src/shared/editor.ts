export type MediaType = 'video' | 'audio' | 'image'

export type EffectType =
  | 'color_grade'
  | 'blur'
  | 'sharpen'
  | 'fade_in'
  | 'fade_out'
  | 'speed_ramp'
  | 'transform'
  | 'opacity'
  | 'blend_mode'
  | 'text_overlay'
  | 'chroma_key'
  | 'mask_box'
export type TransitionType = 'crossfade' | 'dip_to_black' | 'wipe' | 'slide'
export type KeyframeEasing = 'linear' | 'ease_in' | 'ease_out' | 'ease_in_out'

export interface EffectKeyframe {
  id: string
  time: number
  easing?: KeyframeEasing
  parameters: Record<string, number | string | boolean>
}

export interface Effect {
  id: string
  type: EffectType
  enabled: boolean
  parameters: Record<string, number | string | boolean>
  keyframes?: EffectKeyframe[]
}

export interface Transition {
  id: string
  type: TransitionType
  duration: number
  parameters: Record<string, number | string | boolean>
}

export interface TranscriptSegment {
  id: string
  start: number
  end: number
  text: string
  speaker?: string
  confidence?: number
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
  vector?: number[]
}

export interface SemanticAnnotation {
  summary: string
  tags: string[]
  keywords: string[]
  transcript: TranscriptSegment[]
  visualSegments: SemanticSegment[]
  segments: SemanticSegment[]
  confidence: number
  vector?: number[]  // text-embedding-3-small (1536-dim), null until embedded
}

export interface MediaAssetRecord {
  id: string
  name: string
  path: string
  type: MediaType
  duration: number
  createdAt: number
  updatedAt: number
  semantic: SemanticAnnotation
}

export interface TimelineClipRecord {
  id: string
  assetId: string
  trackId: string
  startTime: number
  duration: number
  inPoint: number
  label: string
  effects?: Effect[]
  transitionIn?: Transition
  transitionOut?: Transition
  volume?: number
  speed?: number
}

export interface TimelineTrackRecord {
  id: string
  name: string
  kind: 'video' | 'audio' | 'caption'
  clips: TimelineClipRecord[]
}

export interface SequenceMarkerRecord {
  id: string
  time: number
  duration: number
  label: string
  color?: string
  assetId?: string
  segmentId?: string
  notes?: string
}

export interface SequenceRecord {
  id: string
  name: string
  duration: number
  active: boolean
  tracks: TimelineTrackRecord[]
  markers: SequenceMarkerRecord[]
}

export interface EditorTaskRecord {
  id: string
  type: 'transcribe' | 'embed' | 'proxy' | 'analyze' | 'rough_cut'
  status: 'queued' | 'running' | 'done' | 'error'
  label: string
  progress: number
  assetId?: string
  createdAt: number
}

export interface ToolExecutionRecord {
  id: string
  toolName: string
  args: Record<string, unknown>
  createdAt: number
}

export interface EditorProjectRecord {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  assets: MediaAssetRecord[]
  sequences: SequenceRecord[]
  tasks: EditorTaskRecord[]
  toolHistory: ToolExecutionRecord[]
}

export interface SearchResult {
  asset: MediaAssetRecord
  score: number
  matchedTerms: string[]
}

export interface SegmentSearchResult {
  asset: MediaAssetRecord
  segment: SemanticSegment
  score: number
  matchedTerms: string[]
}

export interface ExtractedFrame {
  time: number
  path: string
}

export interface ToolDefinition {
  name: string
  description: string
  inputSchema: Record<string, unknown>
}

export type AIProvider = 'anthropic' | 'openai' | 'google'
export type SemanticProvider = 'openai' | 'google' | 'voyage'

export interface SupportedModel {
  id: string
  label: string
  provider: AIProvider
  description: string
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

export interface ChatRequestMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
}

export interface ToolCallRecord {
  id: string
  name: string
  args: Record<string, unknown>
  result?: unknown
  status: 'pending' | 'approved' | 'running' | 'done' | 'rejected' | 'error'
}

export interface ChatResponseMessage {
  id: string
  role: 'assistant'
  content: string
  timestamp: number
  toolCalls?: ToolCallRecord[]
  status?: 'pending' | 'done' | 'error'
}

export interface EditorBootstrapPayload {
  project: EditorProjectRecord
  availableTools: ToolDefinition[]
  availableModels: SupportedModel[]
  settings: AISettings
  canUndo: boolean
  canRedo: boolean
  projectFilePath: string | null
}

export interface EditorChatRequest {
  modelId: string
  messages: ChatRequestMessage[]
}

export interface EditorChatResponse {
  project: EditorProjectRecord
  message: ChatResponseMessage
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
