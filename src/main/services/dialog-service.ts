export type OpenDialogResultLike = {
  canceled: boolean
  filePaths: string[]
}

export type SaveDialogResultLike = {
  canceled: boolean
  filePath?: string
}

export function normalizeOpenFilesResult(result: OpenDialogResultLike): string[] {
  return result.canceled ? [] : result.filePaths
}

export function normalizeOpenPathResult(result: OpenDialogResultLike): string | null {
  if (result.canceled || result.filePaths.length === 0) return null
  return result.filePaths[0] ?? null
}

export function normalizeSavePathResult(result: SaveDialogResultLike): string | null {
  return result.canceled ? null : result.filePath ?? null
}
