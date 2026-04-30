import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ExportModal } from '../src/renderer/src/components/ExportModal.js'

test('ExportModal renders the idle export form copy and actions', () => {
  const markup = renderToStaticMarkup(
    React.createElement(ExportModal, {
      exportStatus: 'idle',
      exportMessage: null,
      exportProgress: null,
      onClose: () => undefined,
      onExport: async () => undefined
    })
  )

  assert.match(markup, /<form/)
  assert.match(markup, /Choose a render preset for the active sequence\./)
  assert.match(markup, /Start Export/)
  assert.match(markup, /MP4 \(H\.264\)/)
  assert.doesNotMatch(markup, /Export in progress/)
})

test('ExportModal renders progress feedback while an export is running', () => {
  const markup = renderToStaticMarkup(
    React.createElement(ExportModal, {
      exportStatus: 'running',
      exportMessage: 'Rendering clips',
      exportProgress: 0.37,
      onClose: () => undefined,
      onExport: async () => undefined
    })
  )

  assert.match(markup, /Export in progress/)
  assert.match(markup, />37%<\/span>/)
  assert.match(markup, /Rendering clips/)
  assert.match(markup, /Exporting…/)
  assert.match(markup, /width:37%/)
})
