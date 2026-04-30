import { join } from 'path'
import { normalizeOpenFilesResult, normalizeOpenPathResult, normalizeSavePathResult, type OpenDialogResultLike, type SaveDialogResultLike } from './dialog-service.js'

type BrowserWindowLike = unknown

type IpcMainEventLike = {
  sender: unknown
}

type IpcMainLike = {
  handle: (channel: string, handler: (event: IpcMainEventLike, ...args: unknown[]) => Promise<unknown>) => void
}

type DialogLike = {
  showOpenDialog: (window: BrowserWindowLike | undefined, options: unknown) => Promise<OpenDialogResultLike>
  showSaveDialog: (window: BrowserWindowLike | undefined, options: unknown) => Promise<SaveDialogResultLike>
}

type BrowserWindowLookupLike = {
  fromWebContents: (sender: unknown) => BrowserWindowLike | null | undefined
}

export function registerDialogIpcHandlers(deps: {
  ipcMain: IpcMainLike
  dialog: DialogLike
  browserWindowLookup: BrowserWindowLookupLike
  downloadsPath: string
  documentsPath: string
  resolveProjectPathSelection: (selectionPath: string) => Promise<string>
}): void {
  const { ipcMain, dialog, browserWindowLookup, downloadsPath, documentsPath, resolveProjectPathSelection } = deps

  ipcMain.handle('dialog:openFiles', async (event) => {
    const senderWindow = browserWindowLookup.fromWebContents(event.sender) ?? undefined
    const result = await dialog.showOpenDialog(senderWindow, {
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: 'Media',
          extensions: [
            'mp4', 'm4v', 'mov', 'avi', 'mkv', 'webm', 'mpg', 'mpeg', 'wmv', 'ts', 'mts', 'm2ts',
            'mp3', 'wav', 'aac', 'm4a', 'flac', 'ogg', 'opus', 'aif', 'aiff',
            'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'tif', 'tiff', 'svg'
          ]
        }
      ]
    })
    return normalizeOpenFilesResult(result)
  })

  ipcMain.handle('dialog:openFolder', async (event) => {
    const senderWindow = browserWindowLookup.fromWebContents(event.sender) ?? undefined
    const result = await dialog.showOpenDialog(senderWindow, {
      properties: ['openDirectory']
    })
    return normalizeOpenPathResult(result)
  })

  ipcMain.handle('dialog:saveExportFile', async (event, defaultFileName?: unknown) => {
    const senderWindow = browserWindowLookup.fromWebContents(event.sender) ?? undefined
    const result = await dialog.showSaveDialog(senderWindow, {
      defaultPath: join(downloadsPath, typeof defaultFileName === 'string' && defaultFileName.length > 0 ? defaultFileName : 'monet-export.mp4'),
      filters: [
        { name: 'MP4 Video', extensions: ['mp4'] },
        { name: 'QuickTime Movie', extensions: ['mov'] }
      ]
    })
    return normalizeSavePathResult(result)
  })

  ipcMain.handle('dialog:openProjectFile', async (event) => {
    const senderWindow = browserWindowLookup.fromWebContents(event.sender) ?? undefined
    const result = await dialog.showOpenDialog(senderWindow, {
      properties: ['openFile', 'openDirectory'],
      filters: [{ name: 'Monet Project', extensions: ['aiveproj.json', 'json'] }]
    })
    const selectedPath = normalizeOpenPathResult(result)
    if (!selectedPath) return null
    return resolveProjectPathSelection(selectedPath)
  })

  ipcMain.handle('dialog:saveProjectFile', async (event) => {
    const senderWindow = browserWindowLookup.fromWebContents(event.sender) ?? undefined
    const result = await dialog.showSaveDialog(senderWindow, {
      defaultPath: join(documentsPath, 'untitled-project.aiveproj.json'),
      filters: [{ name: 'Monet Project', extensions: ['aiveproj.json', 'json'] }]
    })
    return normalizeSavePathResult(result)
  })
}
