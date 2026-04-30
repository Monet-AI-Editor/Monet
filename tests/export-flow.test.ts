import test from 'node:test'
import assert from 'node:assert/strict'
import { runExportSequenceFlow } from '../src/renderer/src/store/export-flow.js'
import type { ChatMessage, ExportOptions } from '../src/renderer/src/types/index.js'

function createRecorder() {
  const state = {
    lastError: null as string | null,
    exportStatus: null as 'idle' | 'running' | null,
    exportMessage: null as string | null,
    exportProgress: null as number | null,
    toastPath: null as string | null,
    clearedToast: false,
    messages: [] as ChatMessage[]
  }

  return {
    state,
    callbacks: {
      clearExportToast: () => { state.clearedToast = true },
      showExportToast: (outputPath: string) => { state.toastPath = outputPath },
      setLastError: (message: string | null) => { state.lastError = message },
      setExportStatus: (status: 'idle' | 'running') => { state.exportStatus = status },
      setExportMessage: (message: string | null) => { state.exportMessage = message },
      setExportProgress: (progress: number | null) => { state.exportProgress = progress },
      appendMessage: (message: ChatMessage) => { state.messages.push(message) }
    }
  }
}

const options: ExportOptions = {
  quality: 'high',
  resolution: '1080p',
  format: 'mp4'
}

test('runExportSequenceFlow returns false and does not append a message when save is canceled', async () => {
  const recorder = createRecorder()
  const completed = await runExportSequenceFlow({
    api: {
      saveExportFile: async () => null,
      exportActiveSequence: async () => {
        throw new Error('should not run')
      }
    },
    projectName: 'My Project',
    options,
    createClientId: (prefix) => `${prefix}_1`,
    ...recorder.callbacks
  })

  assert.equal(completed, false)
  assert.equal(recorder.state.clearedToast, true)
  assert.equal(recorder.state.toastPath, null)
  assert.equal(recorder.state.messages.length, 0)
  assert.equal(recorder.state.exportStatus, 'idle')
  assert.equal(recorder.state.exportMessage, null)
  assert.equal(recorder.state.exportProgress, null)
})

test('runExportSequenceFlow appends a success message and returns true on export completion', async () => {
  const recorder = createRecorder()
  const completed = await runExportSequenceFlow({
    api: {
      saveExportFile: async () => '/tmp/out.mp4',
      exportActiveSequence: async () => ({
        outputPath: '/tmp/out.mp4',
        sequenceName: 'Main Sequence',
        duration: 12
      })
    },
    projectName: 'My Project',
    options,
    createClientId: (prefix) => `${prefix}_1`,
    ...recorder.callbacks
  })

  assert.equal(completed, true)
  assert.equal(recorder.state.toastPath, '/tmp/out.mp4')
  assert.equal(recorder.state.messages.length, 1)
  assert.equal(recorder.state.messages[0]?.status, 'done')
  assert.match(recorder.state.messages[0]?.content ?? '', /Exported Main Sequence to \/tmp\/out\.mp4/)
})

test('runExportSequenceFlow appends an error message and returns false on export failure', async () => {
  const recorder = createRecorder()
  const completed = await runExportSequenceFlow({
    api: {
      saveExportFile: async () => '/tmp/out.mp4',
      exportActiveSequence: async () => {
        throw new Error('Export failed badly')
      }
    },
    projectName: 'My Project',
    options,
    createClientId: (prefix) => `${prefix}_1`,
    ...recorder.callbacks
  })

  assert.equal(completed, false)
  assert.equal(recorder.state.lastError, 'Export failed badly')
  assert.equal(recorder.state.messages.length, 1)
  assert.equal(recorder.state.messages[0]?.status, 'error')
  assert.equal(recorder.state.messages[0]?.content, 'Export failed badly')
})
