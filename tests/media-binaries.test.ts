import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  resetResolvedMediaBinaryCache,
  resolveFfmpegBinary,
  resolveFfprobeBinary
} from '../src/main/services/media-binaries.js'

test('media binary resolution prefers binaries present on PATH', () => {
  const originalPath = process.env.PATH
  const fakeBinDir = mkdtempSync(join(tmpdir(), 'monet-bin-'))
  writeFileSync(join(fakeBinDir, 'ffmpeg'), '')
  writeFileSync(join(fakeBinDir, 'ffprobe'), '')
  process.env.PATH = `${fakeBinDir}:${originalPath ?? ''}`
  resetResolvedMediaBinaryCache()

  try {
    assert.equal(resolveFfmpegBinary(), join(fakeBinDir, 'ffmpeg'))
    assert.equal(resolveFfprobeBinary(), join(fakeBinDir, 'ffprobe'))
  } finally {
    process.env.PATH = originalPath
    resetResolvedMediaBinaryCache()
  }
})
