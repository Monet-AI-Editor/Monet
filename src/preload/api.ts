export type IpcRendererLike = {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
  on: (channel: string, listener: (...args: unknown[]) => void) => void
  removeListener: (channel: string, listener: (...args: unknown[]) => void) => void
}

export type WebFrameLike = {
  getZoomFactor: () => number
  setZoomFactor: (value: number) => void
}

function clampZoomFactor(value: number): number {
  return Math.min(3, Math.max(0.5, value))
}

function addRendererSubscription<TPayload>(
  ipcRenderer: IpcRendererLike,
  channel: string,
  listener: (payload: TPayload) => void
): () => void {
  const subscription = (_event: unknown, payload: TPayload) => listener(payload)
  ipcRenderer.on(channel, subscription)
  return () => ipcRenderer.removeListener(channel, subscription)
}

export function stepZoom(webFrame: WebFrameLike, direction: 'in' | 'out'): number {
  const current = webFrame.getZoomFactor()
  const multiplier = direction === 'in' ? 1.1 : 1 / 1.1
  const next = clampZoomFactor(current * multiplier)
  webFrame.setZoomFactor(next)
  return next
}

export function createPreloadApi(ipcRenderer: IpcRendererLike, webFrame: WebFrameLike) {
  return {
    openFiles: (): Promise<string[]> => ipcRenderer.invoke('dialog:openFiles') as Promise<string[]>,
    openFolder: (): Promise<string | null> => ipcRenderer.invoke('dialog:openFolder') as Promise<string | null>,
    openPrivacySettings: (): Promise<boolean> => ipcRenderer.invoke('system:openPrivacySettings') as Promise<boolean>,
    revealInFinder: (filePath: string): Promise<boolean> => ipcRenderer.invoke('system:revealInFinder', filePath) as Promise<boolean>,
    saveExportFile: (defaultFileName?: string): Promise<string | null> =>
      ipcRenderer.invoke('dialog:saveExportFile', defaultFileName) as Promise<string | null>,
    openProjectFile: (): Promise<string | null> => ipcRenderer.invoke('dialog:openProjectFile') as Promise<string | null>,
    saveProjectFile: (): Promise<string | null> => ipcRenderer.invoke('dialog:saveProjectFile') as Promise<string | null>,
    getProjectManagerState: () => ipcRenderer.invoke('editor:getProjectManagerState'),
    getAgentToolStatus: () => ipcRenderer.invoke('system:getAgentToolStatus'),
    createProject: (name?: string) => ipcRenderer.invoke('editor:createProject', name),
    setWindowMode: (mode: 'welcome' | 'workspace') => ipcRenderer.invoke('window:setMode', mode),
    enterWorkspace: () => ipcRenderer.invoke('window:enterWorkspace'),
    getUpdateState: () => ipcRenderer.invoke('app:getUpdateState'),
    checkForUpdates: () => ipcRenderer.invoke('app:checkForUpdates'),
    applyUpdate: () => ipcRenderer.invoke('app:applyUpdate'),
    zoomIn: () => stepZoom(webFrame, 'in'),
    zoomOut: () => stepZoom(webFrame, 'out'),
    resetZoom: () => {
      webFrame.setZoomFactor(1)
      return 1
    },
    getEditorBootstrap: () => ipcRenderer.invoke('editor:getBootstrap'),
    trackAnalytics: (name: string, payload?: Record<string, string | number | boolean | null>) =>
      ipcRenderer.invoke('analytics:track', name, payload),
    updateControlState: (partial: unknown) => ipcRenderer.invoke('editor:updateControlState', partial),
    importFiles: (filePaths: string[]) => ipcRenderer.invoke('editor:importFiles', filePaths),
    removeAsset: (assetId: string) => ipcRenderer.invoke('editor:removeAsset', assetId),
    getWaveform: (filePath: string, sampleCount?: number) => ipcRenderer.invoke('editor:getWaveform', filePath, sampleCount),
    getPreviewPath: (filePath: string, mediaType: 'video' | 'audio' | 'image') =>
      ipcRenderer.invoke('editor:getPreviewPath', filePath, mediaType),
    getPreviewDescriptor: (filePath: string, mediaType: 'video' | 'audio' | 'image') =>
      ipcRenderer.invoke('editor:getPreviewDescriptor', filePath, mediaType),
    listEditorTools: () => ipcRenderer.invoke('editor:listTools'),
    runEditorTool: (name: string, args: Record<string, unknown>) => ipcRenderer.invoke('editor:runTool', name, args),
    updateProjectName: (name: string) => ipcRenderer.invoke('editor:updateProjectName', name),
    addTrack: (kind: 'video' | 'audio' | 'caption') => ipcRenderer.invoke('editor:addTrack', kind),
    activateSequence: (sequenceId: string) => ipcRenderer.invoke('editor:activateSequence', sequenceId),
    splitClip: (clipId: string, splitTime: number) => ipcRenderer.invoke('editor:splitClip', clipId, splitTime),
    undo: () => ipcRenderer.invoke('editor:undo'),
    redo: () => ipcRenderer.invoke('editor:redo'),
    saveProject: (targetPath?: string | null) => ipcRenderer.invoke('editor:saveProject', targetPath),
    openProject: (filePath: string) => ipcRenderer.invoke('editor:openProject', filePath),
    saveAISettings: (settings: unknown) => ipcRenderer.invoke('editor:saveAISettings', settings),
    embedAssets: () => ipcRenderer.invoke('editor:embedAssets'),
    chatWithEditor: (request: unknown) => ipcRenderer.invoke('editor:chat', request),
    exportActiveSequence: (outputPath: string, options?: unknown) =>
      ipcRenderer.invoke('editor:exportActiveSequence', outputPath, options),
    addEffect: (clipId: string, effectType: string, parameters: Record<string, unknown>) =>
      ipcRenderer.invoke('editor:addEffect', clipId, effectType, parameters),
    removeEffect: (clipId: string, effectId: string) => ipcRenderer.invoke('editor:removeEffect', clipId, effectId),
    updateEffectParameters: (clipId: string, effectId: string, parameters: Record<string, unknown>) =>
      ipcRenderer.invoke('editor:updateEffectParameters', clipId, effectId, parameters),
    createTerminalSession: (options: { cols: number; rows: number; cwd?: string; shell?: string }) =>
      ipcRenderer.invoke('terminal:createSession', options),
    writeTerminal: (sessionId: string, data: string) => ipcRenderer.invoke('terminal:write', sessionId, data),
    resizeTerminal: (sessionId: string, cols: number, rows: number) =>
      ipcRenderer.invoke('terminal:resize', sessionId, cols, rows),
    killTerminal: (sessionId: string) => ipcRenderer.invoke('terminal:kill', sessionId),
    onTerminalData: (listener: (payload: { sessionId: string; data: string }) => void) =>
      addRendererSubscription(ipcRenderer, 'terminal:data', listener),
    onTerminalExit: (listener: (payload: { sessionId: string; exitCode: number; signal?: number }) => void) =>
      addRendererSubscription(ipcRenderer, 'terminal:exit', listener),
    onProjectUpdated: (listener: (project: unknown) => void) =>
      addRendererSubscription(ipcRenderer, 'project:updated', listener),
    onSetPlayhead: (listener: (time: number) => void) =>
      addRendererSubscription(ipcRenderer, 'editor:setPlayhead', listener),
    onSelectClip: (listener: (clipId: string | null) => void) =>
      addRendererSubscription(ipcRenderer, 'editor:selectClip', listener),
    onSelectAsset: (listener: (assetId: string | null) => void) =>
      addRendererSubscription(ipcRenderer, 'editor:selectAsset', listener),
    onAppResume: (listener: () => void) =>
      addRendererSubscription(ipcRenderer, 'app:resume', listener),
    onUpdateState: (listener: (state: unknown) => void) =>
      addRendererSubscription(ipcRenderer, 'app:updateState', listener),
    onExportProgress: (listener: (progress: unknown) => void) =>
      addRendererSubscription(ipcRenderer, 'editor:exportProgress', listener),
    toFileUrl: (filePath: string) => `media://asset?path=${encodeURIComponent(filePath)}`,
    saveCanvasState: (artboards: unknown[]) => ipcRenderer.invoke('canvas:saveState', artboards),
    recoverLegacyCanvasState: () =>
      ipcRenderer.invoke('canvas:recoverLegacyState') as Promise<{ ok: boolean; artboards?: unknown[] }>,
    exportCanvasState: (artboards: unknown[]) =>
      ipcRenderer.invoke('canvas:exportState', artboards) as Promise<{ ok: boolean; filePath?: string; canceled?: boolean; error?: string }>,
    importCanvasState: () =>
      ipcRenderer.invoke('canvas:importState') as Promise<{ ok: boolean; artboards?: unknown[]; filePath?: string; canceled?: boolean; error?: string }>,
    setActiveView: (view: 'editor' | 'canvas') => ipcRenderer.invoke('app:setActiveView', view),
    drainCanvasQueue: () =>
      ipcRenderer.invoke('canvas:drainQueue') as Promise<Array<{ id: string; command: string; args: Record<string, unknown> }>>,
    onCanvasCommand: (listener: (payload: { command: string; args: Record<string, unknown> }) => void) =>
      addRendererSubscription(ipcRenderer, 'canvas:command', listener),
    saveFrameAsMedia: (dataUrl: string, name: string) =>
      ipcRenderer.invoke('canvas:saveFrameAsMedia', dataUrl, name) as Promise<{ ok: boolean; assetId?: string }>
  }
}
