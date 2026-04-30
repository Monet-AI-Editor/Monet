export type EditableTargetSnapshot = {
  isHTMLElement: boolean
  isContentEditable: boolean
  tagName?: string
  insideXterm: boolean
}

export type UndoRedoShortcutDecision = 'undo' | 'redo' | 'ignore'

export function isEditableTargetSnapshot(target: EditableTargetSnapshot): boolean {
  if (!target.isHTMLElement) return false
  const tagName = target.tagName?.toLowerCase() ?? ''
  if (target.insideXterm) return true
  return target.isContentEditable || tagName === 'input' || tagName === 'textarea' || tagName === 'select'
}

export function decideUndoRedoShortcut(params: {
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
  key: string
  editableTarget: boolean
}): UndoRedoShortcutDecision {
  if (!params.metaKey || params.altKey || params.editableTarget) return 'ignore'
  if (params.key.toLowerCase() !== 'z') return 'ignore'
  return params.shiftKey ? 'redo' : 'undo'
}
