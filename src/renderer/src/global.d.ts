import type { AISettings, ExportOptions, ExportProgressState, ExportResult, ProjectManagerState, SupportedModel, ToolDefinition } from './types'

declare global {
  interface Window {
    api: {
      openFiles: () => Promise<string[]>
      openFolder: () => Promise<string | null>
      openPrivacySettings: () => Promise<boolean>
      revealInFinder: (filePath: string) => Promise<boolean>
      saveExportFile: (defaultFileName?: string) => Promise<string | null>
      openProjectFile: () => Promise<string | null>
      saveProjectFile: () => Promise<string | null>
      getProjectManagerState: () => Promise<ProjectManagerState>
      getAgentToolStatus: () => Promise<{ codexInstalled: boolean; claudeInstalled: boolean }>
      createProject: (name?: string) => Promise<{
        project: unknown
        projectManager: ProjectManagerState
      }>
      setWindowMode: (mode: 'welcome' | 'workspace') => Promise<void>
      enterWorkspace: () => Promise<void>
      getUpdateState: () => Promise<{
        status: 'idle' | 'available' | 'downloading' | 'downloaded' | 'restarting' | 'error'
        availableVersion: string | null
        currentVersion: string
        source: 'none' | 'dev-simulated' | 'github-release'
        message?: string
      }>
      checkForUpdates: () => Promise<{
        status: 'idle' | 'available' | 'downloading' | 'downloaded' | 'restarting' | 'error'
        availableVersion: string | null
        currentVersion: string
        source: 'none' | 'dev-simulated' | 'github-release'
        message?: string
      }>
      zoomIn: () => number
      zoomOut: () => number
      resetZoom: () => number
      applyUpdate: () => Promise<{
        status: 'idle' | 'available' | 'downloading' | 'downloaded' | 'restarting' | 'error'
        availableVersion: string | null
        currentVersion: string
        source: 'none' | 'dev-simulated' | 'github-release'
        message?: string
      }>
      trackAnalytics: (name: string, payload?: Record<string, string | number | boolean | null>) => Promise<void>
      getEditorBootstrap: () => Promise<{
        project: unknown
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
      }>
      updateControlState: (partial: {
        playheadTime?: number
        selectedClipId?: string | null
        selectedAssetId?: string | null
        activeSequenceId?: string | null
      }) => Promise<unknown>
      importFiles: (filePaths: string[]) => Promise<unknown>
      removeAsset: (assetId: string) => Promise<unknown>
      getWaveform: (filePath: string, sampleCount?: number) => Promise<number[]>
      getPreviewPath: (filePath: string, mediaType: 'video' | 'audio' | 'image') => Promise<string>
      getPreviewDescriptor: (filePath: string, mediaType: 'video' | 'audio' | 'image') => Promise<{ path: string; cacheKey: string }>
      listEditorTools: () => Promise<ToolDefinition[]>
      runEditorTool: (name: string, args: Record<string, unknown>) => Promise<unknown>
      updateProjectName: (name: string) => Promise<string>
      addTrack: (kind: 'video' | 'audio' | 'caption') => Promise<unknown>
      activateSequence: (sequenceId: string) => Promise<unknown>
      splitClip: (clipId: string, splitTime: number) => Promise<unknown>
      undo: () => Promise<unknown>
      redo: () => Promise<unknown>
      saveProject: (targetPath?: string | null) => Promise<string>
      openProject: (filePath: string) => Promise<{
        project: unknown
        projectManager: ProjectManagerState
      }>
      saveAISettings: (settings: AISettings) => Promise<AISettings>
      embedAssets: () => Promise<{ embedded: number; total: number }>
      chatWithEditor: (request: unknown) => Promise<unknown>
      exportActiveSequence: (outputPath: string, options?: ExportOptions) => Promise<ExportResult>
      createTerminalSession: (options: { cols: number; rows: number; cwd?: string; shell?: string }) => Promise<{ id: string; cwd: string }>
      writeTerminal: (sessionId: string, data: string) => Promise<void>
      resizeTerminal: (sessionId: string, cols: number, rows: number) => Promise<void>
      killTerminal: (sessionId: string) => Promise<void>
      onTerminalData: (listener: (payload: { sessionId: string; data: string }) => void) => () => void
      onTerminalExit: (listener: (payload: { sessionId: string; exitCode: number; signal?: number }) => void) => () => void
      onProjectUpdated: (listener: (project: unknown) => void) => () => void
      onSetPlayhead: (listener: (time: number) => void) => () => void
      onSelectClip: (listener: (clipId: string | null) => void) => () => void
      onSelectAsset: (listener: (assetId: string | null) => void) => () => void
      onAppResume: (listener: () => void) => () => void
      onUpdateState: (listener: (state: {
        status: 'idle' | 'available' | 'downloading' | 'downloaded' | 'restarting' | 'error'
        availableVersion: string | null
        currentVersion: string
        source: 'none' | 'dev-simulated' | 'github-release'
        message?: string
      }) => void) => () => void
      onExportProgress: (listener: (progress: ExportProgressState) => void) => () => void
      toFileUrl: (filePath: string) => string
    }
  }
}

export {}
