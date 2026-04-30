import test from 'node:test'
import assert from 'node:assert/strict'
import {
  normalizeOpenFilesResult,
  normalizeOpenPathResult,
  normalizeSavePathResult
} from '../src/main/services/dialog-service.js'

test('normalizeOpenFilesResult returns empty array on cancel', () => {
  assert.deepEqual(normalizeOpenFilesResult({ canceled: true, filePaths: ['/tmp/file.mp4'] }), [])
})

test('normalizeOpenFilesResult returns chosen files when not canceled', () => {
  assert.deepEqual(normalizeOpenFilesResult({ canceled: false, filePaths: ['/tmp/a.mp4', '/tmp/b.mp4'] }), ['/tmp/a.mp4', '/tmp/b.mp4'])
})

test('normalizeOpenPathResult returns null on cancel or empty selection', () => {
  assert.equal(normalizeOpenPathResult({ canceled: true, filePaths: ['/tmp/file'] }), null)
  assert.equal(normalizeOpenPathResult({ canceled: false, filePaths: [] }), null)
})

test('normalizeOpenPathResult returns the first selected path', () => {
  assert.equal(normalizeOpenPathResult({ canceled: false, filePaths: ['/tmp/file'] }), '/tmp/file')
})

test('normalizeSavePathResult returns null on cancel and file path otherwise', () => {
  assert.equal(normalizeSavePathResult({ canceled: true, filePath: '/tmp/out.mp4' }), null)
  assert.equal(normalizeSavePathResult({ canceled: false, filePath: '/tmp/out.mp4' }), '/tmp/out.mp4')
})
