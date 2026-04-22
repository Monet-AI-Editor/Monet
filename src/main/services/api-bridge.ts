import type { Server } from 'http'
import { BrowserWindow } from 'electron'
import { request as httpRequest } from 'http'
import type { ProjectStore } from './project-store'
import type { TranscriptionService } from './transcription-service'
import type { SettingsStore } from './settings-store'
import type { EmbeddingService } from './embedding-service'
import type { ExportService } from './export-service'
import type { FrameExtractionService } from './frame-extraction-service'
import type { ControlStateService } from './control-state-service'
import type { ImageGenerationService } from './image-generation-service'
import type { MediaAssetRecord } from '../../shared/editor'
import { searchSegments, searchSegmentsWithVectors, semanticSearch, semanticSearchWithVectors } from './semantic-index'
import { dirname, join } from 'path'
import { homedir } from 'os'

export class APIBridge {
  private server: Server | null = null
  private readonly PORT = 51847

  private buildStateSnapshot(): {
    playheadTime: number
    selectedClipId: string | null
    selectedAssetId: string | null
    activeSequenceId: string | null
    projectId: string
    projectName: string
    sequences: Array<{
      id: string
      name: string
      active: boolean
      width: number | null
      height: number | null
      trackCount: number
      clipCount: number
      markerCount: number
    }>
  } {
    const controlState = this.controlStateService.getState()
    const project = this.projectStore.getProject()
    return {
      ...controlState,
      projectId: project.id,
      projectName: project.name,
      sequences: project.sequences.map((sequence) => ({
        id: sequence.id,
        name: sequence.name,
        active: sequence.active,
        width: sequence.width ?? null,
        height: sequence.height ?? null,
        trackCount: sequence.tracks.length,
        clipCount: sequence.tracks.reduce((count, track) => count + track.clips.length, 0),
        markerCount: sequence.markers.length
      }))
    }
  }

  private safeSendToAll(channel: string, payload: unknown): void {
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed() || win.webContents.isDestroyed()) continue
      try {
        win.webContents.send(channel, payload)
      } catch {
        // Window teardown can race with bridge pushes during app shutdown.
      }
    }
  }

  constructor(
    private readonly projectStore: ProjectStore,
    private readonly transcriptionService: TranscriptionService,
    private readonly settingsStore: SettingsStore,
    private readonly controlStateService: ControlStateService,
    private readonly embeddingService?: EmbeddingService,
    private readonly exportService?: ExportService,
    private readonly frameExtractionService?: FrameExtractionService,
    private readonly imageGenerationService?: ImageGenerationService
  ) {}

  start(): void {
    if (this.server) return
    const http = require('http')

    this.server = http.createServer(async (req: any, res: any) => {
      res.setHeader('Access-Control-Allow-Origin', '*')
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

      if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

      if (req.method === 'GET') {
        try {
          const path = typeof req.url === 'string' ? req.url.split('?')[0] : '/'
          const sequenceMatch = path.match(/^\/sequences\/([^/]+)$/)
          const command =
            path === '/' ? 'help'
            : path === '/state' ? 'get_control_state'
            : path === '/project' ? 'get_project'
            : path === '/settings' ? 'get_settings'
            : path === '/assets' ? 'list_assets'
            : path === '/sequences' ? 'list_sequences'
            : path === '/help' ? 'help'
            : sequenceMatch ? 'get_sequence'
            : null

          if (!command) {
            res.writeHead(404, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ success: false, error: `Unknown endpoint: ${path}` }))
            return
          }

          const args = sequenceMatch ? { sequenceId: decodeURIComponent(sequenceMatch[1] ?? '') } : {}
          const result = await this.handleCommand(command, args)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: true, result }))
          return
        } catch (error) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }))
          return
        }
      }

      let body = ''
      req.on('data', (chunk: Buffer) => { body += chunk.toString() })
      req.on('end', async () => {
        try {
          const data = body ? JSON.parse(body) : {}
          const args = data.args && typeof data.args === 'object'
            ? data.args
            : Object.fromEntries(
                Object.entries(data).filter(([key]) => key !== 'command')
              )
          const result = await this.handleCommand(data.command, args)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: true, result }))
        } catch (error) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ success: false, error: error instanceof Error ? error.message : String(error) }))
        }
      })
    })

    this.server.on('error', (error: NodeJS.ErrnoException) => {
      if (error.code === 'EADDRINUSE') {
        void this.recoverFromPortConflict()
        return
      }
      throw error
    })

    this.server.listen(this.PORT, 'localhost', () => {
      console.log(`[API Bridge] Listening on http://localhost:${this.PORT}`)
    })
  }

  stop(): void {
    if (this.server) { this.server.close(); this.server = null }
  }

  getPort(): number { return this.PORT }

  private async isBridgeReachable(): Promise<boolean> {
    return await new Promise<boolean>((resolve) => {
      const req = httpRequest(
        {
          hostname: 'localhost',
          port: this.PORT,
          method: 'POST',
          path: '/',
          headers: { 'Content-Type': 'application/json' }
        },
        (res) => {
          res.resume()
          resolve(Boolean(res.statusCode && res.statusCode >= 200 && res.statusCode < 600))
        }
      )

      req.on('error', () => resolve(false))
      req.setTimeout(600, () => {
        req.destroy()
        resolve(false)
      })
      req.write(JSON.stringify({ command: 'ping', args: {} }))
      req.end()
    })
  }

  private async recoverFromPortConflict(): Promise<void> {
    if (this.server) {
      this.server.close()
      this.server = null
    }

    if (await this.isBridgeReachable()) {
      console.warn(`[API Bridge] Port ${this.PORT} already in use. Reusing existing bridge.`)
      return
    }

    console.warn(`[API Bridge] Port ${this.PORT} looked busy but no bridge responded. Retrying…`)
    setTimeout(() => this.start(), 500)
  }

  private pushProjectUpdate(): void {
    const project = this.projectStore.getProject()
    this.safeSendToAll('project:updated', project)
  }

  private isTranscribableAsset(asset: MediaAssetRecord): boolean {
    return asset.type === 'video' || asset.type === 'audio'
  }

  private async syncEmbeddingKey(settings?: Awaited<ReturnType<SettingsStore['getSettings']>>): Promise<void> {
    if (!this.embeddingService) return
    const resolved = settings ?? (await this.settingsStore.getSettings())
    const key = resolved.semanticApiKeys.openai || resolved.apiKeys.openai
    if (key) this.embeddingService.setApiKey(key)
  }

  private async maybeEmbedAsset(assetId: string): Promise<void> {
    if (!this.embeddingService) return
    await this.syncEmbeddingKey()
    if (!this.embeddingService.isReady) return

    const asset = this.projectStore.getProject().assets.find((item) => item.id === assetId)
    if (!asset) return

    const [assetVector] = await this.embeddingService.embedAssets([asset])
    if (assetVector) this.projectStore.updateAssetVector(assetId, assetVector.vector)
    const segmentVectors = await this.embeddingService.embedAssetSegments([asset])
    if (segmentVectors.length > 0) {
      this.projectStore.updateAssetSegmentVectors(
        assetId,
        segmentVectors.map((result) => ({ segmentId: result.segmentId, vector: result.vector }))
      )
    }
  }

  private resolveGeneratedAssetsDirectory(): string {
    const projectPath = this.projectStore.getProjectFilePath()
    if (projectPath) return join(dirname(projectPath), 'Generated Assets')
    return join(homedir(), 'Documents', 'Monet', 'Generated Assets')
  }

  private async generateImageAsset(args: {
    prompt?: string
    size?: string
    quality?: string
    background?: string
    format?: string
    moderation?: string
    outputCompression?: number
    partialImages?: number
  }): Promise<{
    asset: MediaAssetRecord
    outputPath: string
    partialImagePaths: string[]
    revisedPrompt?: string
    model: string
    size: string
    quality: string
    background: string
    format: string
    moderation: string
    outputCompression?: number
    partialImages: number
  }> {
    if (!this.imageGenerationService) throw new Error('Image generation service not initialized')
    if (!args.prompt || !String(args.prompt).trim()) throw new Error('prompt required')

    const settings = await this.settingsStore.getSettings()
    const apiKey = settings.apiKeys.openai
    if (!apiKey) throw new Error('OpenAI API key not configured')

    this.imageGenerationService.setApiKey(apiKey)
    const task = this.projectStore.queueTask({
      type: 'generate',
      label: 'Generating image'
    })

    try {
      this.projectStore.updateTask(task.id, {
        status: 'running',
        progress: 0.1,
        label: 'Generating image'
      })
      this.pushProjectUpdate()

      const generated = await this.imageGenerationService.generateImage({
        prompt: String(args.prompt),
        outputDir: this.resolveGeneratedAssetsDirectory(),
        size: args.size as any,
        quality: args.quality as any,
        background: args.background as any,
        format: args.format as any,
        moderation: args.moderation as any,
        outputCompression: typeof args.outputCompression === 'number' ? args.outputCompression : undefined,
        partialImages: typeof args.partialImages === 'number' ? args.partialImages : undefined
      })

      this.projectStore.updateTask(task.id, {
        status: 'running',
        progress: 0.85,
        label: 'Importing generated image'
      })

      const [asset] = this.projectStore.importFiles([generated.outputPath])
      await this.maybeEmbedAsset(asset.id)

      this.projectStore.updateTask(task.id, {
        status: 'done',
        progress: 1,
        label: `Generated ${asset.name}`
      })
      this.pushProjectUpdate()

      return {
        asset,
        outputPath: generated.outputPath,
        partialImagePaths: generated.partialImagePaths,
        revisedPrompt: generated.revisedPrompt,
        model: generated.model,
        size: generated.size,
        quality: generated.quality,
        background: generated.background,
        format: generated.format,
        moderation: generated.moderation,
        outputCompression: generated.outputCompression,
        partialImages: generated.partialImages
      }
    } catch (error) {
      this.projectStore.updateTask(task.id, {
        status: 'error',
        progress: 1,
        label: `Image generation failed: ${error instanceof Error ? error.message : 'unknown error'}`
      })
      this.pushProjectUpdate()
      throw error
    }
  }

  private resolveImageInputPath(value: string): string {
    const asset = this.projectStore.getProject().assets.find((item) => item.id === value)
    if (asset) return asset.path
    return value
  }

  private async editImageAsset(args: {
    prompt?: string
    inputs?: string[]
    size?: string
    quality?: string
    background?: string
    format?: string
    outputCompression?: number
    partialImages?: number
    inputFidelity?: string
    mask?: string
  }): Promise<{
    asset: MediaAssetRecord
    outputPath: string
    partialImagePaths: string[]
    model: string
    size: string
    quality: string
    background: string
    format: string
    outputCompression?: number
    partialImages: number
    inputFidelity?: string
  }> {
    if (!this.imageGenerationService) throw new Error('Image generation service not initialized')
    if (!args.prompt || !String(args.prompt).trim()) throw new Error('prompt required')
    if (!args.inputs || args.inputs.length === 0) throw new Error('at least one input image is required')

    const settings = await this.settingsStore.getSettings()
    const apiKey = settings.apiKeys.openai
    if (!apiKey) throw new Error('OpenAI API key not configured')

    this.imageGenerationService.setApiKey(apiKey)
    const task = this.projectStore.queueTask({
      type: 'generate',
      label: 'Editing image'
    })

    try {
      this.projectStore.updateTask(task.id, {
        status: 'running',
        progress: 0.1,
        label: 'Editing image'
      })
      this.pushProjectUpdate()

      const edited = await this.imageGenerationService.editImage({
        prompt: String(args.prompt),
        inputPaths: args.inputs.map((input) => this.resolveImageInputPath(String(input))),
        outputDir: this.resolveGeneratedAssetsDirectory(),
        size: args.size as any,
        quality: args.quality as any,
        background: args.background as any,
        format: args.format as any,
        outputCompression: typeof args.outputCompression === 'number' ? args.outputCompression : undefined,
        partialImages: typeof args.partialImages === 'number' ? args.partialImages : undefined,
        inputFidelity: args.inputFidelity as any,
        maskPath: args.mask ? this.resolveImageInputPath(String(args.mask)) : undefined
      })

      this.projectStore.updateTask(task.id, {
        status: 'running',
        progress: 0.85,
        label: 'Importing edited image'
      })

      const [asset] = this.projectStore.importFiles([edited.outputPath])
      await this.maybeEmbedAsset(asset.id)

      this.projectStore.updateTask(task.id, {
        status: 'done',
        progress: 1,
        label: `Edited ${asset.name}`
      })
      this.pushProjectUpdate()

      return {
        asset,
        outputPath: edited.outputPath,
        partialImagePaths: edited.partialImagePaths,
        model: edited.model,
        size: edited.size,
        quality: edited.quality,
        background: edited.background,
        format: edited.format,
        outputCompression: edited.outputCompression,
        partialImages: edited.partialImages,
        inputFidelity: edited.inputFidelity
      }
    } catch (error) {
      this.projectStore.updateTask(task.id, {
        status: 'error',
        progress: 1,
        label: `Image edit failed: ${error instanceof Error ? error.message : 'unknown error'}`
      })
      this.pushProjectUpdate()
      throw error
    }
  }

  private async runTranscriptionJob(
    assetId: string,
    options: { language?: string; taskId?: string; requireKey?: boolean } = {}
  ): Promise<{ assetId: string; segments: Awaited<ReturnType<TranscriptionService['transcribeAudio']>> }> {
    const asset = this.projectStore.getProject().assets.find((item) => item.id === assetId)
    if (!asset) throw new Error(`Asset not found: ${assetId}`)
    if (!this.isTranscribableAsset(asset)) throw new Error('Only audio and video assets can be transcribed.')

    const task =
      (options.taskId && this.projectStore.getTask(options.taskId)) ||
      this.projectStore.queueTask({
        type: 'transcribe',
        label: `Transcribing ${asset.name}`,
        assetId
      })

    const settings = await this.settingsStore.getSettings()
    const canUseLocal = this.transcriptionService.isLocalAvailable()
    if (!canUseLocal && !settings.apiKeys.openai) {
      this.projectStore.updateTask(task.id, {
        status: 'error',
        progress: 1,
        label: `Transcription unavailable for ${asset.name}: install local transcription or add an OpenAI key`
      })
      this.pushProjectUpdate()
      if (options.requireKey) throw new Error('No transcription backend configured')
      return { assetId, segments: [] }
    }

    try {
      this.projectStore.updateTask(task.id, {
        status: 'running',
        progress: 0.1,
        label: `Transcribing ${asset.name}`
      })
      if (settings.apiKeys.openai) {
        this.transcriptionService.setApiKey(settings.apiKeys.openai)
      }
      const segments = await this.transcriptionService.transcribeAudio(asset.path, options.language)
      this.projectStore.updateTask(task.id, {
        status: 'running',
        progress: 0.75,
        label: `Indexing transcript for ${asset.name}`
      })
      this.projectStore.updateAssetTranscript(assetId, segments)
      try {
        this.projectStore.generateCaptionsForAsset(assetId, { replaceExisting: true })
      } catch {
        // Asset may not be present in the active sequence yet; transcript is still stored.
      }
      await this.maybeEmbedAsset(assetId)
      this.projectStore.updateTask(task.id, {
        status: 'done',
        progress: 1,
        label:
          segments.length > 0
            ? `Transcribed ${asset.name} (${segments.length} segments)`
            : `No speech detected in ${asset.name}`
      })
      this.pushProjectUpdate()
      return { assetId, segments }
    } catch (error) {
      this.projectStore.updateTask(task.id, {
        status: 'error',
        progress: 1,
        label: `Transcription failed for ${asset.name}: ${error instanceof Error ? error.message : 'unknown error'}`
      })
      this.pushProjectUpdate()
      throw error
    }
  }

  private queueAutomaticIngestionJobs(imported: MediaAssetRecord[]): void {
    for (const asset of imported) {
      if (!this.isTranscribableAsset(asset)) continue
      if (asset.semantic.transcript.length > 0) continue
      const task = this.projectStore.queueTask({
        type: 'transcribe',
        label: `Queued transcription for ${asset.name}`,
        assetId: asset.id
      })
      void this.runTranscriptionJob(asset.id, { taskId: task.id, requireKey: false }).catch((error) => {
        console.warn(`[API Bridge] Automatic transcription failed for ${asset.id}:`, error)
      })
    }
  }

  private async handleCommand(command: string, args: any = {}): Promise<any> {
    const normalizedCommand =
      command === 'get-state' ? 'get_control_state'
      : command === 'list-assets' ? 'list_assets'
      : command === 'list-sequences' ? 'list_sequences'
      : command === 'list-tracks' ? 'get_tracks'
      : command === 'list-clips' ? 'list_clips'
      : command === 'list-markers' ? 'list_markers'
      : command === 'add-clip' ? 'add_clip'
      : command === 'split-clip' ? 'split_clip'
      : command === 'move-clip' ? 'move_clip'
      : command === 'trim-clip' ? 'trim_clip'
      : command === 'remove-clip' ? 'remove_clip'
      : command === 'add-track' ? 'add_track'
      : command === 'activate-sequence' ? 'activate_sequence'
      : command === 'set-sequence-size' ? 'set_sequence_size'
      : command === 'add-marker' ? 'add_marker'
      : command === 'remove-marker' ? 'remove_marker'
      : command === 'set-playhead' ? 'set_playhead'
      : command === 'select-clip' ? 'select_clip'
      : command === 'select-asset' ? 'select_asset'
      : command === 'duplicate-clip' ? 'duplicate_clip'
      : command === 'rename-clip' ? 'update_clip_label'
      : command === 'set-transition' ? 'set_transition'
      : command === 'add-effect' ? 'add_effect'
      : command === 'remove-effect' ? 'remove_effect'
      : command === 'list-effects' ? 'list_effects'
      : command === 'set-speed' ? 'set_speed'
      : command === 'set-volume' ? 'set_volume'
      : command === 'set-effect-keyframes' ? 'set_effect_keyframes'
      : command === 'ripple-delete-clip' ? 'ripple_delete_clip'
      : command === 'ripple-insert-gap' ? 'ripple_insert_gap'
      : command === 'import-files' ? 'import_files'
      : command === 'transcribe-asset' ? 'transcribe_asset'
      : command === 'embed-assets' ? 'embed_assets'
      : command === 'search-media' ? 'search_media'
      : command === 'search-spoken' ? 'search_spoken'
      : command === 'get-asset-segments' ? 'get_asset_segments'
      : command === 'search-segments' ? 'search_segments'
      : command === 'extract-frames' ? 'extract_frames'
      : command === 'create-contact-sheet' ? 'create_contact_sheet'
      : command === 'generate-image' ? 'generate_image'
      : command === 'edit-image' ? 'edit_image'
      : command === 'export-sequence' ? 'export_sequence'
      : command

    switch (normalizedCommand) {

      // ── Meta ──────────────────────────────────────────────────────────────
      case 'ping':
        return { status: 'ok', version: '1.0.0', port: this.PORT }

      case 'help': {
        return {
          description: 'Monet HTTP API — POST JSON to http://localhost:51847',
          usage: '{"command": "<name>", "args": {...}}',
          commands: [
            // Project
            'ping', 'help', 'get_project', 'get_settings',
            'get_control_state', 'set_playhead', 'select_clip', 'select_asset',
            // Assets & Search
            'list_assets', 'get_asset', 'import_files', 'transcribe_asset', 'embed_assets', 'generate_image', 'edit_image',
            'search_media', 'search_spoken', 'get_asset_segments', 'search_segments',
            'extract_frames', 'create_contact_sheet',
            // Sequences
            'list_sequences', 'create_sequence', 'activate_sequence', 'set_sequence_size', 'list_markers', 'add_marker', 'remove_marker',
            // Export
            'export_sequence',
            // Tracks
            'get_tracks', 'add_track',
            // Clips
            'list_clips', 'add_clip', 'remove_clip', 'move_clip', 'trim_clip',
            'split_clip', 'duplicate_clip', 'update_clip_label', 'ripple_delete_clip', 'ripple_insert_gap',
            // Effects
            'add_effect', 'remove_effect', 'list_effects',
            // Clip properties
            'set_speed', 'set_volume', 'set_transition', 'generate_captions', 'batch_selects_from_search', 'batch_markers_from_search',
            // History
            'undo', 'redo',
          ]
        }
      }

      // ── Project ───────────────────────────────────────────────────────────
      case 'get_project':
        return this.projectStore.getProject()

      case 'get_settings': {
        const s = await this.settingsStore.getSettings()
        return { selectedModelId: s.selectedModelId, semanticProvider: s.semanticProvider }
      }

      case 'get_control_state':
        return this.buildStateSnapshot()

      case 'set_playhead': {
        if (args.time == null) throw new Error('time required')
        const next = this.controlStateService.update({ playheadTime: Number(args.time) })
        this.safeSendToAll('editor:setPlayhead', next.playheadTime)
        return next
      }

      case 'select_clip': {
        const clipId = args.clipId == null ? null : String(args.clipId)
        const next = this.controlStateService.update({ selectedClipId: clipId })
        this.safeSendToAll('editor:selectClip', clipId)
        return next
      }

      case 'select_asset': {
        const assetId = args.assetId == null ? null : String(args.assetId)
        const next = this.controlStateService.update({ selectedAssetId: assetId })
        this.safeSendToAll('editor:selectAsset', assetId)
        return next
      }

      // ── Assets ────────────────────────────────────────────────────────────
      case 'list_assets':
        return this.projectStore.getProject().assets

      case 'get_asset': {
        const proj = this.projectStore.getProject()
        const asset = proj.assets.find((a) => a.id === args.assetId)
        if (!asset) throw new Error(`Asset not found: ${args.assetId}`)
        return asset
      }

      case 'get_asset_segments': {
        if (!args.assetId) throw new Error('assetId required')
        return this.projectStore.getAssetSegments(String(args.assetId))
      }

      case 'import_files': {
        if (!Array.isArray(args.paths)) throw new Error('paths array required')
        const imported = this.projectStore.importFiles(args.paths)
        this.queueAutomaticIngestionJobs(imported)
        if (this.embeddingService) {
          void this.syncEmbeddingKey()
            .then(async () => {
              if (!this.embeddingService?.isReady) return
              const immediateAssets = imported.filter((asset) => !this.isTranscribableAsset(asset))
              if (immediateAssets.length === 0) return
              const assetResults = await this.embeddingService.embedAssets(immediateAssets.filter((asset) => !asset.semantic.vector))
              const segmentResults = await this.embeddingService.embedAssetSegments(immediateAssets)
              for (const { id, vector } of assetResults) {
                this.projectStore.updateAssetVector(id, vector)
              }
              for (const asset of immediateAssets) {
                const vectors = segmentResults
                  .filter((result) => result.assetId === asset.id)
                  .map((result) => ({ segmentId: result.segmentId, vector: result.vector }))
                if (vectors.length > 0) this.projectStore.updateAssetSegmentVectors(asset.id, vectors)
              }
              this.pushProjectUpdate()
            })
            .catch((err) => console.warn('[API Bridge] Auto-embed failed:', err))
        }
        this.pushProjectUpdate()
        return imported
      }

      case 'transcribe_asset': {
        if (!args.assetId) throw new Error('assetId required')
        const result = await this.runTranscriptionJob(String(args.assetId), {
          language: args.language ? String(args.language) : undefined,
          requireKey: true
        })
        return { assetId: result.assetId, segmentCount: result.segments.length, segments: result.segments }
      }

      case 'search_media': {
        // Semantic search over assets — uses cosine similarity if vectors exist, keyword fallback otherwise
        if (!args.query) throw new Error('query required')
        const assets = this.projectStore.getProject().assets
        const limit = args.limit ?? 8

        if (this.embeddingService?.isReady) {
          try {
            const queryVector = await this.embeddingService.embedText(String(args.query))
            return semanticSearchWithVectors(assets, String(args.query), queryVector, limit)
              .map((r) => ({ assetId: r.asset.id, name: r.asset.name, type: r.asset.type,
                             score: r.score, matchedTerms: r.matchedTerms,
                             duration: r.asset.duration, tags: r.asset.semantic.tags }))
          } catch {
            // fall through to keyword
          }
        }
        return semanticSearch(assets, String(args.query), limit)
          .map((r) => ({ assetId: r.asset.id, name: r.asset.name, type: r.asset.type,
                         score: r.score, matchedTerms: r.matchedTerms,
                         duration: r.asset.duration, tags: r.asset.semantic.tags }))
      }

      case 'search_spoken': {
        // Substring search within transcribed segments
        if (!args.query) throw new Error('query required')
        const query = String(args.query).trim().toLowerCase()
        const limit = args.limit ?? 20
        const proj = this.projectStore.getProject()
        const withTranscripts = proj.assets.filter((a) => a.semantic.transcript.length > 0)
        if (withTranscripts.length === 0)
          return { status: 'unavailable', message: 'No transcripts yet — run transcribe_asset first' }

        const matches = withTranscripts.flatMap((asset) =>
          asset.semantic.transcript
            .filter((seg) => seg.text.toLowerCase().includes(query))
            .map((seg) => ({ assetId: asset.id, assetName: asset.name,
                             start: seg.start, end: seg.end, text: seg.text, speaker: seg.speaker }))
        )
        return { status: matches.length > 0 ? 'ok' : 'no_match', query, matches: matches.slice(0, limit) }
      }

      case 'search_segments': {
        if (!args.query) throw new Error('query required')
        const assets = this.projectStore.getProject().assets
        const limit = args.limit ?? 12

        if (this.embeddingService?.isReady) {
          try {
            const queryVector = await this.embeddingService.embedText(String(args.query))
            return searchSegmentsWithVectors(assets, String(args.query), queryVector, limit)
              .map((result) => ({
                assetId: result.asset.id,
                assetName: result.asset.name,
                segmentId: result.segment.id,
                kind: result.segment.kind,
                start: result.segment.start,
                end: result.segment.end,
                label: result.segment.label,
                text: result.segment.text,
                score: result.score
              }))
          } catch {
            // fall through to keyword
          }
        }

        return searchSegments(assets, String(args.query), limit)
          .map((result) => ({
            assetId: result.asset.id,
            assetName: result.asset.name,
            segmentId: result.segment.id,
            kind: result.segment.kind,
            start: result.segment.start,
            end: result.segment.end,
            label: result.segment.label,
            text: result.segment.text,
            score: result.score
          }))
      }

      case 'extract_frames': {
        if (!this.frameExtractionService) throw new Error('Frame extraction service not initialized')
        if (!args.assetId) throw new Error('assetId required')
        const asset = this.projectStore.getProject().assets.find((item) => item.id === args.assetId)
        if (!asset) throw new Error(`Asset not found: ${args.assetId}`)
        return this.frameExtractionService.extractFrames(asset, {
          count: typeof args.count === 'number' ? args.count : undefined
        })
      }

      case 'create_contact_sheet': {
        if (!this.frameExtractionService) throw new Error('Frame extraction service not initialized')
        if (!args.assetId) throw new Error('assetId required')
        const asset = this.projectStore.getProject().assets.find((item) => item.id === args.assetId)
        if (!asset) throw new Error(`Asset not found: ${args.assetId}`)
        return this.frameExtractionService.createContactSheet(asset, {
          count: typeof args.count === 'number' ? args.count : undefined
        })
      }

      case 'embed_assets': {
        if (!this.embeddingService) throw new Error('Embedding service not initialized')
        const settings = await this.settingsStore.getSettings()
        const key = settings.semanticApiKeys.openai || settings.apiKeys.openai
        if (!key) throw new Error('OpenAI API key not configured')
        this.embeddingService.setApiKey(key)
        const toEmbed = args.all ? this.projectStore.getProject().assets : this.projectStore.getAssetsWithoutVectors()
        const toEmbedSegments = args.all ? this.projectStore.getProject().assets : this.projectStore.getAssetsWithUnembeddedSegments()
        if (toEmbed.length === 0 && toEmbedSegments.length === 0) {
          return { embeddedAssets: 0, embeddedSegments: 0, message: 'All assets already embedded' }
        }
        const assetResults = toEmbed.length > 0 ? await this.embeddingService.embedAssets(toEmbed) : []
        const segmentResults = toEmbedSegments.length > 0 ? await this.embeddingService.embedAssetSegments(toEmbedSegments) : []
        for (const { id, vector } of assetResults) this.projectStore.updateAssetVector(id, vector)
        for (const asset of toEmbedSegments) {
          const vectors = segmentResults
            .filter((result) => result.assetId === asset.id)
            .map((result) => ({ segmentId: result.segmentId, vector: result.vector }))
          if (vectors.length > 0) this.projectStore.updateAssetSegmentVectors(asset.id, vectors)
        }
        this.pushProjectUpdate()
        return {
          embeddedAssets: assetResults.length,
          embeddedSegments: segmentResults.length,
          totalAssets: toEmbed.length,
          totalAssetsWithUnembeddedSegments: toEmbedSegments.length
        }
      }

      case 'generate_image':
        return this.generateImageAsset({
          prompt: args.prompt ? String(args.prompt) : undefined,
          size: args.size ? String(args.size) : undefined,
          quality: args.quality ? String(args.quality) : undefined,
          background: args.background ? String(args.background) : undefined,
          format: args.format ? String(args.format) : undefined,
          moderation: args.moderation ? String(args.moderation) : undefined,
          outputCompression: typeof args.outputCompression === 'number' ? args.outputCompression : undefined,
          partialImages: typeof args.partialImages === 'number' ? args.partialImages : undefined
        })

      case 'edit_image':
        return this.editImageAsset({
          prompt: args.prompt ? String(args.prompt) : undefined,
          inputs: Array.isArray(args.inputs) ? args.inputs.map((item) => String(item)) : undefined,
          size: args.size ? String(args.size) : undefined,
          quality: args.quality ? String(args.quality) : undefined,
          background: args.background ? String(args.background) : undefined,
          format: args.format ? String(args.format) : undefined,
          outputCompression: typeof args.outputCompression === 'number' ? args.outputCompression : undefined,
          partialImages: typeof args.partialImages === 'number' ? args.partialImages : undefined,
          inputFidelity: args.inputFidelity ? String(args.inputFidelity) : undefined,
          mask: args.mask ? String(args.mask) : undefined
        })

      case 'export_sequence': {
        if (!this.exportService) throw new Error('Export service not initialized')
        if (!args.outputPath) throw new Error('outputPath required')
        return this.exportService.exportActiveSequence(String(args.outputPath), {
          quality: args.quality === 'draft' || args.quality === 'standard' || args.quality === 'high' ? args.quality : 'high',
          resolution: args.resolution === '720p' || args.resolution === '1080p' || args.resolution === '4k' ? args.resolution : '1080p',
          format: args.format === 'mov' ? 'mov' : 'mp4'
        })
      }

      // ── Sequences ─────────────────────────────────────────────────────────
      case 'list_sequences':
        return this.projectStore.getProject().sequences

      case 'get_sequence': {
        if (!args.sequenceId) throw new Error('sequenceId required')
        const sequence = this.projectStore.getProject().sequences.find((item) => item.id === String(args.sequenceId))
        if (!sequence) throw new Error(`Sequence not found: ${args.sequenceId}`)
        return sequence
      }

      case 'create_sequence': {
        if (!args.name) throw new Error('name required')
        const seq = this.projectStore.createSequence(
          args.name,
          typeof args.width === 'number' ? Number(args.width) : undefined,
          typeof args.height === 'number' ? Number(args.height) : undefined
        )
        this.controlStateService.update({ activeSequenceId: seq.id })
        this.pushProjectUpdate()
        return seq
      }

      case 'activate_sequence': {
        if (!args.sequenceId) throw new Error('sequenceId required')
        const seq = this.projectStore.activateSequence(args.sequenceId)
        this.controlStateService.update({ activeSequenceId: seq.id })
        this.pushProjectUpdate()
        return seq
      }

      case 'set_sequence_size': {
        if (args.width == null || args.height == null) {
          throw new Error('width and height required')
        }
        const seq = this.projectStore.setSequenceSize(
          args.sequenceId ? String(args.sequenceId) : undefined,
          Number(args.width),
          Number(args.height)
        )
        this.pushProjectUpdate()
        return seq
      }

      case 'list_markers':
        return this.projectStore.listMarkers(args.sequenceId ? String(args.sequenceId) : undefined)

      case 'add_marker': {
        if (args.time == null || !args.label) throw new Error('time and label required')
        const marker = this.projectStore.addMarker({
          sequenceId: args.sequenceId ? String(args.sequenceId) : undefined,
          time: Number(args.time),
          duration: args.duration != null ? Number(args.duration) : undefined,
          label: String(args.label),
          color: args.color ? String(args.color) : undefined,
          assetId: args.assetId ? String(args.assetId) : undefined,
          segmentId: args.segmentId ? String(args.segmentId) : undefined,
          notes: args.notes ? String(args.notes) : undefined
        })
        this.pushProjectUpdate()
        return marker
      }

      case 'remove_marker': {
        if (!args.markerId) throw new Error('markerId required')
        this.projectStore.removeMarker(String(args.markerId), args.sequenceId ? String(args.sequenceId) : undefined)
        this.pushProjectUpdate()
        return { success: true }
      }

      // ── Tracks ────────────────────────────────────────────────────────────
      case 'get_tracks': {
        const proj = this.projectStore.getProject()
        const seq = args.sequenceId
          ? proj.sequences.find((s) => s.id === args.sequenceId)
          : proj.sequences.find((s) => s.active) ?? proj.sequences[0]
        if (!seq) throw new Error('No active sequence')
        return seq.tracks.map((t) => ({ id: t.id, name: t.name, kind: t.kind, clipCount: t.clips.length }))
      }

      case 'add_track': {
        const kind = args.kind as 'video' | 'audio' | 'caption'
        if (!['video', 'audio', 'caption'].includes(kind)) throw new Error('kind must be video | audio | caption')
        const seq = this.projectStore.addTrack(kind)
        this.pushProjectUpdate()
        return seq
      }

      // ── Clips ─────────────────────────────────────────────────────────────
      case 'list_clips': {
        const proj = this.projectStore.getProject()
        const seq = args.sequenceId
          ? proj.sequences.find((s) => s.id === args.sequenceId)
          : proj.sequences.find((s) => s.active) ?? proj.sequences[0]
        if (!seq) throw new Error('Sequence not found')
        const clips = seq.tracks.flatMap((t) =>
          t.clips.map((c) => ({ ...c, trackKind: t.kind, trackName: t.name }))
        )
        return clips.sort((a, b) => a.startTime - b.startTime)
      }

      case 'add_clip': {
        const { assetId, trackId, startTime, duration, inPoint } = args
        const proj = this.projectStore.getProject()
        const asset = proj.assets.find((a) => a.id === assetId)
        if (!asset) throw new Error(`Asset not found: ${assetId}`)
        const trackExists = proj.sequences.some((s) => s.tracks.some((t) => t.id === trackId))
        if (!trackExists) throw new Error(`Track not found: ${trackId}`)
        const result = this.projectStore.addClip({
          assetId,
          trackId,
          startTime: startTime ?? 0,
          duration: duration ?? asset.duration,
          inPoint: inPoint ?? 0,
          label: asset.name
        })
        this.pushProjectUpdate()
        return result
      }

      case 'remove_clip': {
        if (!args.clipId) throw new Error('clipId required')
        this.projectStore.removeClip(args.clipId)
        this.pushProjectUpdate()
        return { success: true }
      }

      case 'move_clip': {
        if (!args.clipId) throw new Error('clipId required')
        this.projectStore.moveClip(args.clipId, args.startTime)
        this.pushProjectUpdate()
        return { success: true }
      }

      case 'trim_clip': {
        const { clipId, inPoint, duration, startTime } = args
        if (!clipId) throw new Error('clipId required')
        const result = this.projectStore.trimClip(clipId, { inPoint, duration, startTime })
        this.pushProjectUpdate()
        return result
      }

      case 'split_clip': {
        if (!args.clipId || args.time == null) throw new Error('clipId and time required')
        const result = this.projectStore.splitClip(args.clipId, args.time)
        this.pushProjectUpdate()
        return result
      }

      case 'duplicate_clip': {
        if (!args.clipId) throw new Error('clipId required')
        const result = this.projectStore.duplicateClip(args.clipId, args.offsetSeconds ?? 0)
        this.pushProjectUpdate()
        return result
      }

      case 'update_clip_label': {
        if (!args.clipId || !args.label) throw new Error('clipId and label required')
        this.projectStore.updateClipLabel(args.clipId, args.label)
        this.pushProjectUpdate()
        return { success: true }
      }

      case 'ripple_delete_clip': {
        if (!args.clipId) throw new Error('clipId required')
        this.projectStore.rippleDeleteClip(String(args.clipId))
        this.pushProjectUpdate()
        return { success: true }
      }

      case 'ripple_insert_gap': {
        if (args.time == null || args.duration == null) throw new Error('time and duration required')
        const sequence = this.projectStore.rippleInsertGap(
          Number(args.time),
          Number(args.duration),
          args.sequenceId ? String(args.sequenceId) : undefined
        )
        this.pushProjectUpdate()
        return sequence
      }

      // ── Effects ───────────────────────────────────────────────────────────
      case 'list_effects': {
        return {
          available: [
            'fade_in',
            'fade_out',
            'color_grade',
            'blur',
            'sharpen',
            'speed_ramp',
            'transform',
            'opacity',
            'blend_mode',
            'text_overlay',
            'chroma_key',
            'mask_box',
            'drop_shadow',
            'glow',
            'background_fill',
            'gradient_fill',
            'shape_overlay'
          ],
          parameters: {
            fade_in:     { duration: 'number (seconds, default 1)' },
            fade_out:    { duration: 'number (seconds, default 1)' },
            color_grade: { brightness: 'number (-1 to 1)', contrast: 'number (0.5–2)', saturation: 'number (0–3)' },
            blur:        { radius: 'number (pixels, default 5)' },
            sharpen:     { amount: 'number (0–3, default 1)' },
            speed_ramp:  { speed: 'number (0.1–10, use set_speed instead)' },
            transform:   { x: 'number (px)', y: 'number (px)', scaleX: 'number', scaleY: 'number', rotation: 'number (deg)' },
            opacity:     { opacity: 'number (0–1)' },
            blend_mode:  { mode: 'string (normal|screen|multiply|overlay|lighten)' },
            text_overlay:{
              text: 'string',
              x: 'number (px)',
              y: 'number (px)',
              scale: 'number',
              rotation: 'number (deg)',
              opacity: 'number (0–1)',
              fontSize: 'number (px)',
              color: 'string (#ffffff)',
              fontFamily: 'string (family name or absolute font path)',
              fontWeight: 'number|string (400|500|600|700...)',
              letterSpacing: 'number (px)',
              lineHeight: 'number (multiplier, e.g. 1.05)',
              textAlign: 'string (left|center|right)',
              maxWidth: 'number (px)',
              strokeColor: 'string (#000000)',
              strokeWidth: 'number (px)'
            },
            chroma_key:  { color: 'string (#00ff00)', similarity: 'number (0–1)', blend: 'number (0–1)' },
            mask_box:    { x: 'number (px)', y: 'number (px)', width: 'number (px)', height: 'number (px)', feather: 'number (px)' },
            drop_shadow: { color: 'string (#000000)', opacity: 'number (0–1)', blur: 'number (px)', offsetX: 'number (px)', offsetY: 'number (px)' },
            glow:        { color: 'string (#ffffff)', opacity: 'number (0–1)', radius: 'number (px)' },
            background_fill: { color: 'string (#000000)', opacity: 'number (0–1)' },
            gradient_fill: { fromColor: 'string (#ffffff)', toColor: 'string (#ffffff)', angle: 'number (deg)', opacity: 'number (0–1)' },
            shape_overlay: {
              shape: 'string (rect|line)',
              x: 'number (px)',
              y: 'number (px)',
              width: 'number (px)',
              height: 'number (px)',
              color: 'string (#ffffff)',
              opacity: 'number (0–1)',
              strokeWidth: 'number (px)'
            }
          },
          motion: {
            set_effect_keyframes: 'Attach ordered keyframes to an existing effect. Numeric parameters interpolate over time.'
          },
          transitions: ['crossfade', 'dip_to_black', 'wipe', 'slide']
        }
      }

      case 'add_effect': {
        if (!args.clipId || !args.effectType) throw new Error('clipId and effectType required')
        const result = this.projectStore.addClipEffect(args.clipId, args.effectType, args.parameters ?? {})
        this.pushProjectUpdate()
        return result
      }

      case 'remove_effect': {
        if (!args.clipId || !args.effectId) throw new Error('clipId and effectId required')
        const result = this.projectStore.removeClipEffect(args.clipId, args.effectId)
        this.pushProjectUpdate()
        return result
      }

      case 'set_effect_keyframes': {
        if (!args.clipId || !args.effectId || !Array.isArray(args.keyframes)) {
          throw new Error('clipId, effectId, and keyframes[] required')
        }
        const result = this.projectStore.setClipEffectKeyframes(
          String(args.clipId),
          String(args.effectId),
          args.keyframes as Array<{
            id?: string
            time: number
            easing?: 'linear' | 'ease_in' | 'ease_out' | 'ease_in_out'
            parameters: Record<string, unknown>
          }>
        )
        this.pushProjectUpdate()
        return result
      }

      // ── Clip properties ───────────────────────────────────────────────────
      case 'set_speed': {
        if (!args.clipId || args.speed == null) throw new Error('clipId and speed required')
        const result = this.projectStore.setClipSpeed(args.clipId, args.speed)
        this.pushProjectUpdate()
        return result
      }

      case 'set_volume': {
        if (!args.clipId || args.volume == null) throw new Error('clipId and volume required')
        const result = this.projectStore.setClipVolume(args.clipId, args.volume)
        this.pushProjectUpdate()
        return result
      }

      case 'set_transition': {
        // args: { clipId, side: 'in'|'out', type: 'crossfade'|'dip_to_black'|'wipe'|'slide'|null, duration? }
        if (!args.clipId || !args.side) throw new Error('clipId and side (in|out) required')
        this.projectStore.setClipTransition(args.clipId, args.side, args.type ?? null, args.duration ?? 1.0)
        this.pushProjectUpdate()
        return { success: true }
      }

      case 'generate_captions': {
        if (!args.assetId) throw new Error('assetId required')
        const sequence = this.projectStore.generateCaptionsForAsset(String(args.assetId), {
          sequenceId: args.sequenceId ? String(args.sequenceId) : undefined,
          replaceExisting: Boolean(args.replaceExisting),
          minDuration: args.minDuration != null ? Number(args.minDuration) : undefined
        })
        this.pushProjectUpdate()
        return sequence
      }

      case 'batch_selects_from_search': {
        if (!args.query) throw new Error('query required')
        const assets = this.projectStore.getProject().assets
        const limit = args.limit != null ? Number(args.limit) : 12
        const query = String(args.query)
        const matches = this.embeddingService?.isReady
          ? await (async () => {
              try {
                const queryVector = await this.embeddingService.embedText(query)
                return searchSegmentsWithVectors(assets, query, queryVector, limit)
              } catch {
                return searchSegments(assets, query, limit)
              }
            })()
          : searchSegments(assets, query, limit)

        const sequence = this.projectStore.buildSelectsSequenceFromSegments(matches, {
          sequenceName: args.sequenceName ? String(args.sequenceName) : undefined,
          padding: args.padding != null ? Number(args.padding) : undefined,
          limit
        })
        this.pushProjectUpdate()
        return sequence
      }

      case 'batch_markers_from_search': {
        if (!args.query) throw new Error('query required')
        const assets = this.projectStore.getProject().assets
        const limit = args.limit != null ? Number(args.limit) : 12
        const query = String(args.query)
        const matches = this.embeddingService?.isReady
          ? await (async () => {
              try {
                const queryVector = await this.embeddingService.embedText(query)
                return searchSegmentsWithVectors(assets, query, queryVector, limit)
              } catch {
                return searchSegments(assets, query, limit)
              }
            })()
          : searchSegments(assets, query, limit)

        const created = matches.map((match) =>
          this.projectStore.addMarker({
            sequenceId: args.sequenceId ? String(args.sequenceId) : undefined,
            time: match.segment.start,
            duration: Math.max(0, match.segment.end - match.segment.start),
            label: match.segment.label,
            color: match.segment.kind === 'speech' ? 'blue' : match.segment.kind === 'visual' ? 'green' : 'gray',
            assetId: match.asset.id,
            segmentId: match.segment.id,
            notes: match.segment.text
          })
        )
        this.pushProjectUpdate()
        return created
      }

      // ── History ───────────────────────────────────────────────────────────
      case 'undo': {
        const proj = this.projectStore.undo()
        this.pushProjectUpdate()
        return proj
      }

      case 'redo': {
        const proj = this.projectStore.redo()
        this.pushProjectUpdate()
        return proj
      }

      default:
        throw new Error(`Unknown command: "${command}". Send {"command":"help"} for the full command list.`)
    }
  }
}
