import test from 'node:test'
import assert from 'node:assert/strict'
import { getIntervalRenderStrategy } from '../src/main/services/export-service.js'

function createClip(overrides: Record<string, unknown> = {}) {
  return {
    id: 'clip_1',
    assetId: 'asset_1',
    trackId: 'track_1',
    startTime: 0,
    duration: 5,
    inPoint: 0,
    label: 'Clip',
    ...overrides
  }
}

function createLayer(assetType: 'video' | 'audio' | 'image', overrides: Record<string, unknown> = {}) {
  return {
    clip: createClip(overrides.clip as Record<string, unknown> | undefined),
    asset: {
      id: overrides.assetId ?? 'asset_1',
      name: 'Asset',
      path: '/tmp/asset',
      type: assetType,
      duration: 5,
      createdAt: 0,
      updatedAt: 0,
      semantic: {
        summary: '',
        tags: [],
        keywords: [],
        transcript: [],
        visualSegments: [],
        segments: [],
        confidence: 0
      }
    },
    track: { id: 'track_1', name: 'V1', kind: assetType === 'audio' ? 'audio' : 'video', clips: [] },
    trackIndex: 0,
    sourceOffset: 0,
    ...(overrides as Record<string, unknown>)
  }
}

test('simple same-source single-layer video intervals use video fast path', () => {
  const interval = {
    videoLayers: [createLayer('video')],
    audioLayers: [createLayer('audio', { assetId: 'asset_1' })]
  }
  assert.equal(getIntervalRenderStrategy(interval), 'video')
})

test('single image interval uses image fast path', () => {
  const interval = {
    videoLayers: [createLayer('image')],
    audioLayers: []
  }
  assert.equal(getIntervalRenderStrategy(interval), 'image')
})

test('single audio-only interval uses audio-only fast path', () => {
  const interval = {
    videoLayers: [],
    audioLayers: [createLayer('audio')]
  }
  assert.equal(getIntervalRenderStrategy(interval), 'audio-only')
})

test('layered or transition-heavy intervals fall back to composite rendering', () => {
  const interval = {
    videoLayers: [createLayer('video'), createLayer('video', { assetId: 'asset_2' })],
    audioLayers: []
  }
  assert.equal(getIntervalRenderStrategy(interval), 'composite')
})
