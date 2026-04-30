import test from 'node:test'
import assert from 'node:assert/strict'
import { getHasRecoverableWorkspace, getWelcomeTagline } from '../src/renderer/src/components/welcome-screen-state.js'

test('recoverable workspace is false while loading', () => {
  assert.equal(getHasRecoverableWorkspace({
    loading: true,
    projectFilePath: '/tmp/project.aiveproj.json',
    assetCount: 1,
    sequenceCount: 2,
    firstSequenceDuration: 10
  }), false)
})

test('recoverable workspace becomes true when a real session exists', () => {
  assert.equal(getHasRecoverableWorkspace({
    loading: false,
    projectFilePath: null,
    assetCount: 1,
    sequenceCount: 1,
    firstSequenceDuration: 0
  }), true)

  assert.equal(getHasRecoverableWorkspace({
    loading: false,
    projectFilePath: null,
    assetCount: 0,
    sequenceCount: 1,
    firstSequenceDuration: 5
  }), true)
})

test('welcome tagline matches onboarding state', () => {
  assert.equal(getWelcomeTagline(true), 'Set up Monet once, then edit with AI.')
  assert.equal(getWelcomeTagline(false), 'Edit faster with AI-native video workflows.')
})
