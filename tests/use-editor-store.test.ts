import test from 'node:test'
import assert from 'node:assert/strict'
import { isMissingProjectSelectionError } from '../src/renderer/src/store/useEditorStore.js'

test('isMissingProjectSelectionError matches the invalid project folder picker error', () => {
  assert.equal(
    isMissingProjectSelectionError(new Error('No .aiveproj.json project file was found in that folder.')),
    true
  )

  assert.equal(
    isMissingProjectSelectionError(new Error('Project file not found: /tmp/demo.aiveproj.json')),
    false
  )

  assert.equal(isMissingProjectSelectionError('No .aiveproj.json project file was found in that folder.'), false)
})
