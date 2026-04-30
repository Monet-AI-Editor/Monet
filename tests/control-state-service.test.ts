import test from 'node:test'
import assert from 'node:assert/strict'
import { ControlStateService } from '../src/main/services/control-state-service.js'

test('ControlStateService starts with sane defaults', () => {
  const service = new ControlStateService()
  assert.deepEqual(service.getState(), {
    playheadTime: 0,
    selectedClipId: null,
    selectedAssetId: null,
    activeSequenceId: null,
    activeView: 'editor',
    canvasTerminalOpen: false
  })
})

test('ControlStateService merges updates without dropping previous state', () => {
  const service = new ControlStateService()
  service.update({
    playheadTime: 12.5,
    activeSequenceId: 'seq_1',
    activeView: 'canvas'
  })
  const next = service.update({
    selectedClipId: 'clip_1',
    canvasTerminalOpen: true
  })

  assert.equal(next.playheadTime, 12.5)
  assert.equal(next.activeSequenceId, 'seq_1')
  assert.equal(next.activeView, 'canvas')
  assert.equal(next.selectedClipId, 'clip_1')
  assert.equal(next.canvasTerminalOpen, true)
})
