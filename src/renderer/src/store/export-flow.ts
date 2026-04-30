import type { ChatMessage, ExportOptions, ExportResult } from '../types'

type ExportFlowApi = {
  saveExportFile: (defaultFileName?: string) => Promise<string | null>
  exportActiveSequence: (outputPath: string, options: ExportOptions) => Promise<ExportResult>
}

type ExportFlowCallbacks = {
  clearExportToast: () => void
  showExportToast: (outputPath: string) => void
  setLastError: (message: string | null) => void
  setExportStatus: (status: 'idle' | 'running') => void
  setExportMessage: (message: string | null) => void
  setExportProgress: (progress: number | null) => void
  appendMessage: (message: ChatMessage) => void
}

type ExportFlowInput = {
  api: ExportFlowApi
  projectName: string
  options: ExportOptions
  createClientId: (prefix: string) => string
} & ExportFlowCallbacks

export async function runExportSequenceFlow({
  api,
  projectName,
  options,
  createClientId,
  clearExportToast,
  showExportToast,
  setLastError,
  setExportStatus,
  setExportMessage,
  setExportProgress,
  appendMessage
}: ExportFlowInput): Promise<boolean> {
  setLastError(null)
  clearExportToast()
  setExportStatus('running')
  setExportMessage('Choose where to save the export.')
  setExportProgress(0)

  try {
    const baseName = projectName.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '') || 'monet-export'
    const outputPath = await api.saveExportFile(`${baseName}.${options.format}`)
    if (!outputPath) return false

    setExportMessage(`Rendering ${options.resolution} ${options.format.toUpperCase()} export…`)
    const result = await api.exportActiveSequence(outputPath, options)
    showExportToast(result.outputPath)
    setExportMessage('Finalizing export…')
    appendMessage({
      id: createClientId('msg'),
      role: 'assistant',
      content: `Exported ${result.sequenceName} to ${result.outputPath} (${options.resolution}, ${options.quality}, ${options.format})`,
      timestamp: Date.now(),
      status: 'done'
    })
    return true
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Export failed.'
    setLastError(message)
    appendMessage({
      id: createClientId('msg'),
      role: 'assistant',
      content: message,
      timestamp: Date.now(),
      status: 'error'
    })
    return false
  } finally {
    setExportStatus('idle')
    setExportMessage(null)
    setExportProgress(null)
  }
}
