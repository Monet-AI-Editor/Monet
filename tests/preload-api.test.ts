import test from 'node:test'
import assert from 'node:assert/strict'
import { createPreloadApi } from '../src/preload/api.js'

function createIpcRecorder() {
  const invokes: Array<{ channel: string; args: unknown[] }> = []
  const listeners = new Map<string, (...args: unknown[]) => void>()

  return {
    invokes,
    listeners,
    ipcRenderer: {
      invoke: async (channel: string, ...args: unknown[]) => {
        invokes.push({ channel, args })
        return { channel, args }
      },
      on: (channel: string, listener: (...args: unknown[]) => void) => {
        listeners.set(channel, listener)
      },
      removeListener: (channel: string, listener: (...args: unknown[]) => void) => {
        if (listeners.get(channel) === listener) {
          listeners.delete(channel)
        }
      }
    }
  }
}

test('createPreloadApi proxies invoke-based calls to the expected IPC channels', async () => {
  const ipc = createIpcRecorder()
  const zoomWrites: number[] = []
  const api = createPreloadApi(ipc.ipcRenderer, {
    getZoomFactor: () => 1,
    setZoomFactor: (value) => { zoomWrites.push(value) }
  })

  await api.openFiles()
  await api.saveExportFile('demo.mp4')
  await api.exportActiveSequence('/tmp/out.mp4', { format: 'mp4' })
  await api.saveFrameAsMedia('data:image/png;base64,abc', 'frame.png')

  assert.deepEqual(ipc.invokes, [
    { channel: 'dialog:openFiles', args: [] },
    { channel: 'dialog:saveExportFile', args: ['demo.mp4'] },
    { channel: 'editor:exportActiveSequence', args: ['/tmp/out.mp4', { format: 'mp4' }] },
    { channel: 'canvas:saveFrameAsMedia', args: ['data:image/png;base64,abc', 'frame.png'] }
  ])
  assert.deepEqual(zoomWrites, [])
})

test('createPreloadApi subscription helpers forward payloads and unsubscribe cleanly', async () => {
  const ipc = createIpcRecorder()
  const api = createPreloadApi(ipc.ipcRenderer, {
    getZoomFactor: () => 1,
    setZoomFactor: () => undefined
  })

  const payloads: Array<{ sessionId: string; data: string }> = []
  const unsubscribe = api.onTerminalData((payload) => {
    payloads.push(payload)
  })

  const listener = ipc.listeners.get('terminal:data')
  assert.ok(listener)
  listener?.({}, { sessionId: 'term-1', data: 'hello' })
  assert.deepEqual(payloads, [{ sessionId: 'term-1', data: 'hello' }])

  unsubscribe()
  assert.equal(ipc.listeners.has('terminal:data'), false)
})

test('createPreloadApi clamps zoom changes and supports reset', () => {
  let zoomFactor = 2.9
  const api = createPreloadApi(createIpcRecorder().ipcRenderer, {
    getZoomFactor: () => zoomFactor,
    setZoomFactor: (value) => { zoomFactor = value }
  })

  assert.equal(api.zoomIn(), 3)
  assert.ok(Math.abs(api.zoomOut() - (3 / 1.1)) < 1e-12)
  assert.equal(api.resetZoom(), 1)
  assert.equal(zoomFactor, 1)
})
