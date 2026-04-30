import test from 'node:test'
import assert from 'node:assert/strict'
import { buildTerminalEnv } from '../src/main/services/terminal-service.js'

test('buildTerminalEnv stamps Monet terminal metadata', () => {
  const env = buildTerminalEnv({ TERM_PROGRAM_VERSION: '0.1.5' }, '/tmp/monet-root')
  assert.equal(env.TERM, 'xterm-256color')
  assert.equal(env.COLORTERM, 'truecolor')
  assert.equal(env.TERM_PROGRAM, 'Monet')
  assert.equal(env.TERM_PROGRAM_VERSION, '0.1.5')
  assert.equal(env.AI_VIDEO_EDITOR_ROOT, '/tmp/monet-root')
})

test('buildTerminalEnv removes NO_COLOR to preserve terminal UX', () => {
  const originalNoColor = process.env.NO_COLOR
  process.env.NO_COLOR = '1'
  try {
    const env = buildTerminalEnv({}, '/tmp/monet-root')
    assert.equal('NO_COLOR' in env, false)
  } finally {
    if (originalNoColor === undefined) delete process.env.NO_COLOR
    else process.env.NO_COLOR = originalNoColor
  }
})
