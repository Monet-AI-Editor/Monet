import { generateText, stepCountIs } from 'ai'
import { createAnthropic } from '@ai-sdk/anthropic'
import { createOpenAI } from '@ai-sdk/openai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { z } from 'zod'
import type {
  AISettings,
  ChatRequestMessage,
  ChatResponseMessage,
  EditorChatResponse,
  EditorProjectRecord,
  SupportedModel,
  ToolCallRecord
} from '../../shared/editor'
import { createId } from './id'
import { getSupportedModel, normalizeStoredModelId } from './model-catalog'
import { ProjectStore } from './project-store'
import { ToolRegistry } from './tool-registry'

function summarizeProject(project: EditorProjectRecord): string {
  const activeSequence = project.sequences.find((sequence) => sequence.active) ?? project.sequences[0]
  const assetSummary = project.assets
    .slice(0, 12)
    .map((asset) => {
      const transcriptState = asset.semantic.transcript.length > 0 ? 'transcript=yes' : 'transcript=no'
      return `- ${asset.id}: ${asset.name} [${asset.type}] tags=${asset.semantic.tags.join(', ')} ${transcriptState} segments=${asset.semantic.segments.length} metadata_confidence=${asset.semantic.confidence.toFixed(2)}`
    })
    .join('\n')

  return [
    `Project: ${project.name}`,
    `Assets: ${project.assets.length}`,
    `Sequences: ${project.sequences.length}`,
    `Active sequence: ${activeSequence?.name ?? 'None'} (${activeSequence?.duration ?? 0}s)`,
    assetSummary ? `Asset inventory:\n${assetSummary}` : 'Asset inventory: no assets imported yet.'
  ].join('\n')
}

function mapToolCalls(messageId: string, toolCalls: Array<{ toolName: string; input: unknown }>, toolResults: Array<{ toolName: string; output: unknown }>): ToolCallRecord[] {
  return toolCalls.map((toolCall, index) => {
    const result = toolResults.find((toolResult) => toolResult.toolName === toolCall.toolName)
    return {
      id: `${messageId}_tool_${index}`,
      name: toolCall.toolName,
      args: (toolCall.input as Record<string, unknown>) || {},
      result: result?.output,
      status: result ? 'done' : 'approved'
    }
  })
}

export class AIChatService {
  constructor(
    private readonly projectStore: ProjectStore,
    private readonly toolRegistry: ToolRegistry
  ) {}

  async generateReply(messages: ChatRequestMessage[], modelId: string, settings: AISettings): Promise<EditorChatResponse> {
    const normalizedModelId = normalizeStoredModelId(modelId)
    const selectedModel = getSupportedModel(normalizedModelId)
    if (!selectedModel) {
      throw new Error(`Unsupported model: ${modelId}`)
    }

    const apiKey = settings.apiKeys[selectedModel.provider]
    if (!apiKey) {
      throw new Error(`Missing API key for ${selectedModel.provider}. Add it in the chat panel settings before sending a request.`)
    }

    const model = this.createModel(selectedModel, apiKey)
    const project = this.projectStore.getProject()
    const systemPrompt = [
      'You are the AI editing assistant inside a desktop video editor.',
      'Prefer deterministic edits over vague advice.',
      'When an editing action can be executed via tools, call the tool instead of only describing it.',
      'Prefer time-based segment search over broad asset guesses when the user asks where something appears.',
      'Use semantic search before suggesting missing assets.',
      'Use the spoken-content search tool whenever the user asks about words they said or speech timing.',
      'Do not imply that speech was transcribed unless the asset actually has transcript segments.',
      'If transcripts are missing, say that search is currently limited to filenames, imported type tags, summaries, and any saved embeddings.',
      'Do not present imported metadata as if it were full scene understanding.',
      'Keep the final answer short, friendly, and direct.',
      'Simple markdown is allowed. Use short paragraphs and simple dash bullets when it helps readability.',
      'Do not dump raw JSON unless the user explicitly asks for it.',
      'After using tools, explain what changed in plain language.',
      '',
      summarizeProject(project)
    ].join('\n')

    const result = await generateText({
      model,
      system: systemPrompt,
      messages: messages.map((message) => ({
        role: message.role,
        content: message.content
      })),
      tools: {
        get_project_snapshot: {
          description: 'Return the latest project graph and sequence state.',
          inputSchema: z.object({}),
          execute: async () => this.toolRegistry.runTool('get_project_snapshot', {})
        },
        list_project_assets: {
          description: 'List the imported media assets and their stored metadata.',
          inputSchema: z.object({}),
          execute: async () => this.toolRegistry.runTool('list_project_assets', {})
        },
        list_asset_segments: {
          description: 'List searchable segments for a specific asset.',
          inputSchema: z.object({
            assetId: z.string().min(1)
          }),
          execute: async (input) => this.toolRegistry.runTool('list_asset_segments', input)
        },
        search_media_semantically: {
          description: 'Search media by filename terms, stored tags, transcript content, summaries, or embeddings when available.',
          inputSchema: z.object({
            query: z.string().min(1),
            limit: z.number().int().positive().max(20).optional()
          }),
          execute: async (input) => this.toolRegistry.runTool('search_media_semantically', input)
        },
        search_project_segments: {
          description: 'Search time-based segments across all assets and return matching ranges.',
          inputSchema: z.object({
            query: z.string().min(1),
            limit: z.number().int().positive().max(20).optional()
          }),
          execute: async (input) => this.toolRegistry.runTool('search_project_segments', input)
        },
        search_spoken_content: {
          description: 'Search inside real transcript segments. If no transcripts exist, returns an unavailable state.',
          inputSchema: z.object({
            query: z.string().min(1),
            limit: z.number().int().positive().max(20).optional()
          }),
          execute: async (input) => this.toolRegistry.runTool('search_spoken_content', input)
        },
        create_rough_cut: {
          description: 'Create a rough cut sequence from specific asset ids and a target duration.',
          inputSchema: z.object({
            assetIds: z.array(z.string()).min(1),
            targetDuration: z.number().positive().max(300).optional(),
            sequenceName: z.string().min(1).max(100).optional()
          }),
          execute: async (input) => this.toolRegistry.runTool('create_rough_cut', input)
        }
      },
      stopWhen: stepCountIs(5),
      temperature: 0.2,
      maxOutputTokens: 1200
    })

    const messageId = createId('msg')
    const responseMessage: ChatResponseMessage = {
      id: messageId,
      role: 'assistant',
      content: result.text,
      timestamp: Date.now(),
      toolCalls: mapToolCalls(
        messageId,
        result.toolCalls as Array<{ toolName: string; input: unknown }>,
        result.toolResults as Array<{ toolName: string; output: unknown }>
      ),
      status: 'done'
    }

    return {
      project: this.projectStore.getProject(),
      message: responseMessage
    }
  }

  private createModel(selectedModel: SupportedModel, apiKey: string) {
    switch (selectedModel.provider) {
      case 'anthropic':
        return createAnthropic({ apiKey })(selectedModel.id)
      case 'openai':
        return createOpenAI({ apiKey }).chat(selectedModel.id)
      case 'google':
        return createGoogleGenerativeAI({ apiKey })(selectedModel.id)
    }
  }
}
