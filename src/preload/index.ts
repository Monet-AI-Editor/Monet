import { contextBridge, ipcRenderer, webFrame } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

function clampZoomFactor(value: number): number {
  return Math.min(3, Math.max(0.5, value))
}

function stepZoom(direction: 'in' | 'out'): number {
  const current = webFrame.getZoomFactor()
  const multiplier = direction === 'in' ? 1.1 : 1 / 1.1
  const next = clampZoomFactor(current * multiplier)
  webFrame.setZoomFactor(next)
  return next
}

const api = {
  openFiles: (): Promise<string[]> => ipcRenderer.invoke('dialog:openFiles'),
  openFolder: (): Promise<string> => ipcRenderer.invoke('dialog:openFolder'),
  openPrivacySettings: (): Promise<boolean> => ipcRenderer.invoke('system:openPrivacySettings'),
  revealInFinder: (filePath: string): Promise<boolean> => ipcRenderer.invoke('system:revealInFinder', filePath),
  saveExportFile: (defaultFileName?: string): Promise<string | null> => ipcRenderer.invoke('dialog:saveExportFile', defaultFileName),
  openProjectFile: (): Promise<string | null> => ipcRenderer.invoke('dialog:openProjectFile'),
  saveProjectFile: (): Promise<string | null> => ipcRenderer.invoke('dialog:saveProjectFile'),
  getProjectManagerState: () => ipcRenderer.invoke('editor:getProjectManagerState'),
  getAgentToolStatus: () => ipcRenderer.invoke('system:getAgentToolStatus'),
  createProject: (name?: string) => ipcRenderer.invoke('editor:createProject', name),
  setWindowMode: (mode: 'welcome' | 'workspace') => ipcRenderer.invoke('window:setMode', mode),
  enterWorkspace: () => ipcRenderer.invoke('window:enterWorkspace'),
  getUpdateState: () => ipcRenderer.invoke('app:getUpdateState'),
  checkForUpdates: () => ipcRenderer.invoke('app:checkForUpdates'),
  applyUpdate: () => ipcRenderer.invoke('app:applyUpdate'),
  zoomIn: () => stepZoom('in'),
  zoomOut: () => stepZoom('out'),
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
  getPreviewPath: (filePath: string, mediaType: 'video' | 'audio' | 'image') => ipcRenderer.invoke('editor:getPreviewPath', filePath, mediaType),
  getPreviewDescriptor: (filePath: string, mediaType: 'video' | 'audio' | 'image') => ipcRenderer.invoke('editor:getPreviewDescriptor', filePath, mediaType),
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
  exportActiveSequence: (outputPath: string, options?: unknown) => ipcRenderer.invoke('editor:exportActiveSequence', outputPath, options),
  addEffect: (clipId: string, effectType: string, parameters: Record<string, unknown>) => ipcRenderer.invoke('editor:addEffect', clipId, effectType, parameters),
  removeEffect: (clipId: string, effectId: string) => ipcRenderer.invoke('editor:removeEffect', clipId, effectId),
  updateEffectParameters: (clipId: string, effectId: string, parameters: Record<string, unknown>) =>
    ipcRenderer.invoke('editor:updateEffectParameters', clipId, effectId, parameters),
  createTerminalSession: (options: { cols: number; rows: number; cwd?: string; shell?: string }) =>
    ipcRenderer.invoke('terminal:createSession', options),
  writeTerminal: (sessionId: string, data: string) => ipcRenderer.invoke('terminal:write', sessionId, data),
  resizeTerminal: (sessionId: string, cols: number, rows: number) => ipcRenderer.invoke('terminal:resize', sessionId, cols, rows),
  killTerminal: (sessionId: string) => ipcRenderer.invoke('terminal:kill', sessionId),
  onTerminalData: (listener: (payload: { sessionId: string; data: string }) => void) => {
    const subscription = (_event: Electron.IpcRendererEvent, payload: { sessionId: string; data: string }) => listener(payload)
    ipcRenderer.on('terminal:data', subscription)
    return () => ipcRenderer.removeListener('terminal:data', subscription)
  },
  onTerminalExit: (listener: (payload: { sessionId: string; exitCode: number; signal?: number }) => void) => {
    const subscription = (
      _event: Electron.IpcRendererEvent,
      payload: { sessionId: string; exitCode: number; signal?: number }
    ) => listener(payload)
    ipcRenderer.on('terminal:exit', subscription)
    return () => ipcRenderer.removeListener('terminal:exit', subscription)
  },
  onProjectUpdated: (listener: (project: unknown) => void) => {
    const subscription = (_event: Electron.IpcRendererEvent, project: unknown) => listener(project)
    ipcRenderer.on('project:updated', subscription)
    return () => ipcRenderer.removeListener('project:updated', subscription)
  },
  onSetPlayhead: (listener: (time: number) => void) => {
    const subscription = (_event: Electron.IpcRendererEvent, time: number) => listener(time)
    ipcRenderer.on('editor:setPlayhead', subscription)
    return () => ipcRenderer.removeListener('editor:setPlayhead', subscription)
  },
  onSelectClip: (listener: (clipId: string | null) => void) => {
    const subscription = (_event: Electron.IpcRendererEvent, clipId: string | null) => listener(clipId)
    ipcRenderer.on('editor:selectClip', subscription)
    return () => ipcRenderer.removeListener('editor:selectClip', subscription)
  },
  onSelectAsset: (listener: (assetId: string | null) => void) => {
    const subscription = (_event: Electron.IpcRendererEvent, assetId: string | null) => listener(assetId)
    ipcRenderer.on('editor:selectAsset', subscription)
    return () => ipcRenderer.removeListener('editor:selectAsset', subscription)
  },
  onAppResume: (listener: () => void) => {
    const subscription = () => listener()
    ipcRenderer.on('app:resume', subscription)
    return () => ipcRenderer.removeListener('app:resume', subscription)
  },
  onUpdateState: (listener: (state: unknown) => void) => {
    const subscription = (_event: Electron.IpcRendererEvent, state: unknown) => listener(state)
    ipcRenderer.on('app:updateState', subscription)
    return () => ipcRenderer.removeListener('app:updateState', subscription)
  },
  onExportProgress: (listener: (progress: unknown) => void) => {
    const subscription = (_event: Electron.IpcRendererEvent, progress: unknown) => listener(progress)
    ipcRenderer.on('editor:exportProgress', subscription)
    return () => ipcRenderer.removeListener('editor:exportProgress', subscription)
  },
  toFileUrl: (filePath: string) => `media://asset?path=${encodeURIComponent(filePath)}`
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore
  window.electron = electronAPI
  // @ts-ignore
  window.api = api
}
