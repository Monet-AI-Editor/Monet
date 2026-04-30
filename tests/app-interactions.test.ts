import test from 'node:test'
import assert from 'node:assert/strict'
import { decideUndoRedoShortcut, isEditableTargetSnapshot } from '../src/renderer/src/app-interactions.js'

test('editable target detection treats xterm and form fields as editable', () => {
  assert.equal(isEditableTargetSnapshot({
    isHTMLElement: true,
    isContentEditable: false,
    tagName: 'input',
    insideXterm: false
  }), true)

  assert.equal(isEditableTargetSnapshot({
    isHTMLElement: true,
    isContentEditable: false,
    tagName: 'div',
    insideXterm: true
  }), true)
})

test('editable target detection ignores plain non-editable elements', () => {
  assert.equal(isEditableTargetSnapshot({
    isHTMLElement: true,
    isContentEditable: false,
    tagName: 'div',
    insideXterm: false
  }), false)
})

test('undo redo shortcut decision respects modifiers and editability', () => {
  assert.equal(decideUndoRedoShortcut({
    metaKey: true,
    altKey: false,
    shiftKey: false,
    key: 'z',
    editableTarget: false
  }), 'undo')

  assert.equal(decideUndoRedoShortcut({
    metaKey: true,
    altKey: false,
    shiftKey: true,
    key: 'z',
    editableTarget: false
  }), 'redo')

  assert.equal(decideUndoRedoShortcut({
    metaKey: true,
    altKey: false,
    shiftKey: false,
    key: 'z',
    editableTarget: true
  }), 'ignore')
})
