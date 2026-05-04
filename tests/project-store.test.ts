import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ProjectStore } from '../src/main/services/project-store.js'

function createTempFile(fileName: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'monet-project-store-'))
  const filePath = join(dir, fileName)
  writeFileSync(filePath, 'fixture')
  return filePath
}

test('new projects start with a default active sequence and tracks', () => {
  const store = new ProjectStore()
  const project = store.createProject('Test Project')
  assert.equal(project.name, 'Test Project')
  assert.equal(project.sequences.length, 1)
  assert.equal(project.sequences[0]?.active, true)
  assert.deepEqual(project.sequences[0]?.tracks.map((track) => track.kind), ['video', 'audio', 'caption'])
})

test('importing an image creates a 5 second video clip in the active sequence', () => {
  const store = new ProjectStore()
  store.createProject('Import Test')
  const imagePath = createTempFile('frame.png')
  const [asset] = store.importFiles([imagePath])
  const project = store.getProject()
  const activeSequence = project.sequences.find((sequence) => sequence.active) ?? project.sequences[0]
  const videoTrack = activeSequence?.tracks.find((track) => track.kind === 'video')
  const audioTrack = activeSequence?.tracks.find((track) => track.kind === 'audio')

  assert.ok(asset)
  assert.equal(asset.type, 'image')
  assert.equal(asset.duration, 5)
  assert.equal(activeSequence?.duration, 5)
  assert.equal(videoTrack?.clips.length, 1)
  assert.equal(audioTrack?.clips.length, 0)
})

test('splitClip divides a clip into left and right segments at the playhead time', () => {
  const store = new ProjectStore()
  store.createProject('Split Test')
  const imagePath = createTempFile('split.png')
  store.importFiles([imagePath])
  const project = store.getProject()
  const activeSequence = project.sequences.find((sequence) => sequence.active) ?? project.sequences[0]
  const clipId = activeSequence?.tracks.find((track) => track.kind === 'video')?.clips[0]?.id
  assert.ok(clipId)

  const updated = store.splitClip(clipId!, 2)
  const videoClips = updated.tracks.find((track) => track.kind === 'video')?.clips ?? []

  assert.equal(videoClips.length, 2)
  assert.equal(videoClips[0]?.duration, 2)
  assert.equal(videoClips[1]?.startTime, 2)
  assert.equal(videoClips[1]?.duration, 3)
  assert.equal(videoClips[1]?.inPoint, 2)
})

test('rippleInsertGap shifts later clips and markers forward', () => {
  const store = new ProjectStore()
  store.createProject('Gap Test')
  const first = createTempFile('first.png')
  const second = createTempFile('second.png')
  store.importFiles([first, second])
  store.addMarker({ time: 5, label: 'Beat' })

  const updated = store.rippleInsertGap(5, 2)
  const videoClips = updated.tracks.find((track) => track.kind === 'video')?.clips ?? []
  const markers = updated.markers ?? []

  assert.equal(videoClips[1]?.startTime, 7)
  assert.equal(markers[0]?.time, 7)
})

test('generateCaptionsForAsset creates caption clips from transcript segments', () => {
  const store = new ProjectStore()
  store.createProject('Caption Test')
  const imagePath = createTempFile('captions.png')
  const [asset] = store.importFiles([imagePath])
  store.updateAssetTranscript(asset.id, [
    { id: 'seg_1', start: 0, end: 1.5, text: 'Hello world' },
    { id: 'seg_2', start: 1.5, end: 3, text: 'Monet captions' }
  ])

  const updated = store.generateCaptionsForAsset(asset.id)
  const captionTrack = updated.tracks.find((track) => track.kind === 'caption')

  assert.ok(captionTrack)
  assert.equal(captionTrack?.clips.length, 2)
  assert.equal(captionTrack?.clips[0]?.label, 'Hello world')
  assert.equal(captionTrack?.clips[1]?.label, 'Monet captions')
})

test('importFiles always stores absolute paths (regression: relative paths caused black-frame playback)', () => {
  const store = new ProjectStore()
  store.createProject('Absolute Path Test')
  const tempDir = mkdtempSync(join(tmpdir(), 'monet-abs-'))
  const fileName = 'clip.png'
  const absolute = join(tempDir, fileName)
  writeFileSync(absolute, 'x')

  // Simulate the editorctl bug: caller passes a relative path. Even if the
  // CLI's resolution layer is removed or bypassed (e.g. via MCP), the store
  // must NEVER store a non-absolute path on the asset record — the renderer
  // would otherwise resolve it against Monet's cwd and play black frames.
  const originalCwd = process.cwd()
  try {
    process.chdir(tempDir)
    const [asset] = store.importFiles([fileName])
    assert.ok(asset, 'asset should exist')
    assert.ok(
      asset.path.startsWith('/') || /^[A-Za-z]:\\/.test(asset.path),
      `asset.path must be absolute, got: ${asset.path}`
    )
  } finally {
    process.chdir(originalCwd)
  }
})
