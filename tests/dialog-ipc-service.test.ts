import test from 'node:test'
import assert from 'node:assert/strict'
import { registerDialogIpcHandlers } from '../src/main/services/dialog-ipc-service.js'

type Handler = (event: { sender: unknown }, ...args: unknown[]) => Promise<unknown>

function createRegistrar() {
  const handlers = new Map<string, Handler>()

  return {
    handlers,
    ipcMain: {
      handle: (channel: string, handler: Handler) => {
        handlers.set(channel, handler)
      }
    }
  }
}

test('registerDialogIpcHandlers parents dialogs to the sender window and normalizes open-file cancel', async () => {
  const registrar = createRegistrar()
  const senderWindow = { id: 'window-1' }
  const openCalls: Array<{ window: unknown; options: unknown }> = []

  registerDialogIpcHandlers({
    ipcMain: registrar.ipcMain,
    dialog: {
      showOpenDialog: async (window, options) => {
        openCalls.push({ window, options })
        return { canceled: true, filePaths: ['/tmp/ignored.mp4'] }
      },
      showSaveDialog: async () => ({ canceled: true })
    },
    browserWindowLookup: {
      fromWebContents: () => senderWindow
    },
    downloadsPath: '/Users/me/Downloads',
    documentsPath: '/Users/me/Documents',
    resolveProjectPathSelection: async (selectionPath) => selectionPath
  })

  const openFiles = registrar.handlers.get('dialog:openFiles')
  assert.ok(openFiles)

  const result = await openFiles?.({ sender: { id: 'sender' } })
  assert.deepEqual(result, [])
  assert.equal(openCalls[0]?.window, senderWindow)
  assert.match(JSON.stringify(openCalls[0]?.options), /multiSelections/)
})

test('registerDialogIpcHandlers resolves project selections and save defaults through shared handlers', async () => {
  const registrar = createRegistrar()
  const resolvedSelections: string[] = []
  const saveCalls: Array<{ window: unknown; options: unknown }> = []

  registerDialogIpcHandlers({
    ipcMain: registrar.ipcMain,
    dialog: {
      showOpenDialog: async (_window, options) => {
        if (JSON.stringify(options).includes('Monet Project')) {
          return { canceled: false, filePaths: ['/tmp/project-folder'] }
        }
        return { canceled: false, filePaths: ['/tmp/asset.mp4'] }
      },
      showSaveDialog: async (window, options) => {
        saveCalls.push({ window, options })
        return { canceled: false, filePath: '/tmp/out.mp4' }
      }
    },
    browserWindowLookup: {
      fromWebContents: () => null
    },
    downloadsPath: '/Users/me/Downloads',
    documentsPath: '/Users/me/Documents',
    resolveProjectPathSelection: async (selectionPath) => {
      resolvedSelections.push(selectionPath)
      return `${selectionPath}/demo.aiveproj.json`
    }
  })

  const openProject = registrar.handlers.get('dialog:openProjectFile')
  const saveExport = registrar.handlers.get('dialog:saveExportFile')
  const saveProject = registrar.handlers.get('dialog:saveProjectFile')

  assert.equal(
    await openProject?.({ sender: {} }),
    '/tmp/project-folder/demo.aiveproj.json'
  )
  assert.deepEqual(resolvedSelections, ['/tmp/project-folder'])

  assert.equal(await saveExport?.({ sender: {} }, 'custom.mov'), '/tmp/out.mp4')
  assert.equal(await saveProject?.({ sender: {} }), '/tmp/out.mp4')
  assert.match(JSON.stringify(saveCalls[0]?.options), /custom\.mov/)
  assert.match(JSON.stringify(saveCalls[1]?.options), /untitled-project\.aiveproj\.json/)
})
