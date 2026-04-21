import type { EditorBootstrapPayload, ToolDefinition } from '../../shared/editor'
import { searchSegments, searchSegmentsWithVectors, semanticSearch, semanticSearchWithVectors } from './semantic-index'
import { ProjectStore } from './project-store'
import type { EmbeddingService } from './embedding-service'

const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: 'get_project_snapshot',
    description: 'Return the current project graph including assets, sequences, tasks, and tool history.',
    inputSchema: {}
  },
  {
    name: 'list_project_assets',
    description: 'List all imported assets and their stored metadata, transcripts, and durations.',
    inputSchema: {}
  },
  {
    name: 'list_asset_segments',
    description: 'List the searchable semantic segments for a specific asset.',
    inputSchema: {
      type: 'object',
      required: ['assetId'],
      properties: {
        assetId: { type: 'string' }
      }
    }
  },
  {
    name: 'search_media_semantically',
    description: 'Search imported assets using filename terms, stored tags, summaries, transcript text, and embeddings when available.',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string' },
        limit: { type: 'number' }
      }
    }
  },
  {
    name: 'search_spoken_content',
    description: 'Search within actual transcript segments. Returns an explicit unavailable state when no transcripts exist yet.',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string' },
        limit: { type: 'number' }
      }
    }
  },
  {
    name: 'search_project_segments',
    description: 'Search time-based segments across the project and return matching asset ranges.',
    inputSchema: {
      type: 'object',
      required: ['query'],
      properties: {
        query: { type: 'string' },
        limit: { type: 'number' }
      }
    }
  },
  {
    name: 'create_rough_cut',
    description: 'Create a simple deterministic rough cut sequence from selected assets.',
    inputSchema: {
      type: 'object',
      required: ['assetIds'],
      properties: {
        assetIds: { type: 'array', items: { type: 'string' } },
        targetDuration: { type: 'number' },
        sequenceName: { type: 'string' }
      }
    }
  }
]

export class ToolRegistry {
  constructor(
    private readonly projectStore: ProjectStore,
    private readonly embeddingService?: EmbeddingService
  ) {}

  getBootstrap(): EditorBootstrapPayload {
    return {
      project: this.projectStore.getProject(),
      availableTools: TOOL_DEFINITIONS,
      availableModels: [],
      settings: {
        selectedModelId: 'claude-sonnet-4-20250514',
        apiKeys: {
          anthropic: '',
          openai: '',
          google: ''
        },
        semanticProvider: 'openai',
        semanticApiKeys: {
          openai: '',
          google: '',
          voyage: ''
        }
      },
      canUndo: this.projectStore.canUndo(),
      canRedo: this.projectStore.canRedo(),
      projectFilePath: this.projectStore.getProjectFilePath()
    }
  }

  listTools(): ToolDefinition[] {
    return TOOL_DEFINITIONS
  }

  runTool(name: string, args: Record<string, unknown>): unknown {
    this.projectStore.addToolHistory(name, args)

    switch (name) {
      case 'get_project_snapshot':
        return this.projectStore.getProject()

      case 'list_project_assets':
        return this.projectStore.getProject().assets

      case 'list_asset_segments': {
        const assetId = typeof args.assetId === 'string' ? args.assetId : ''
        if (!assetId) throw new Error('assetId is required.')
        return this.projectStore.getAssetSegments(assetId)
      }

      case 'search_media_semantically': {
        const query = typeof args.query === 'string' ? args.query : ''
        const limit = typeof args.limit === 'number' ? args.limit : 8
        const assets = this.projectStore.getProject().assets

        // Use vector search when embedding service is ready
        if (this.embeddingService?.isReady) {
          return this.embeddingService.embedText(query)
            .then((queryVector) => semanticSearchWithVectors(assets, query, queryVector, limit))
            .catch(() => semanticSearch(assets, query, limit)) // fall back on API error
        }

        return semanticSearch(assets, query, limit)
      }

      case 'search_project_segments': {
        const query = typeof args.query === 'string' ? args.query : ''
        const limit = typeof args.limit === 'number' ? args.limit : 12
        const assets = this.projectStore.getProject().assets

        if (this.embeddingService?.isReady) {
          return this.embeddingService.embedText(query)
            .then((queryVector) => searchSegmentsWithVectors(assets, query, queryVector, limit))
            .catch(() => searchSegments(assets, query, limit))
        }

        return searchSegments(assets, query, limit)
      }

      case 'search_spoken_content': {
        const query = typeof args.query === 'string' ? args.query.trim().toLowerCase() : ''
        const limit = typeof args.limit === 'number' ? args.limit : 8
        const assets = this.projectStore.getProject().assets
        const transcriptAssets = assets.filter((asset) => asset.semantic.transcript.length > 0)

        if (!query) {
          return {
            status: 'error',
            message: 'A spoken-content search query is required.'
          }
        }

        if (transcriptAssets.length === 0) {
          return {
            status: 'unavailable',
            message: 'No transcript data exists yet for this project.',
            limitation: 'Spoken-content search is unavailable until real transcription is added.'
          }
        }

        const matches = transcriptAssets.flatMap((asset) =>
          asset.semantic.transcript
            .filter((segment) => segment.text.toLowerCase().includes(query))
            .map((segment) => ({
              assetId: asset.id,
              assetName: asset.name,
              start: segment.start,
              end: segment.end,
              text: segment.text,
              speaker: segment.speaker
            }))
        )

        return {
          status: matches.length > 0 ? 'ok' : 'no_match',
          query,
          matches: matches.slice(0, limit),
          searchedAssets: transcriptAssets.length
        }
      }

      case 'create_rough_cut': {
        const assetIds = Array.isArray(args.assetIds) ? args.assetIds.filter((item): item is string => typeof item === 'string') : []
        const targetDuration = typeof args.targetDuration === 'number' ? args.targetDuration : 30
        const sequenceName = typeof args.sequenceName === 'string' ? args.sequenceName : 'AI Rough Cut'
        return this.projectStore.buildRoughCut(assetIds, targetDuration, sequenceName)
      }

      default:
        throw new Error(`Unknown tool: ${name}`)
    }
  }
}
