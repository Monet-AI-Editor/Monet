import type { SupportedModel } from '../../shared/editor'

export const SUPPORTED_MODELS: SupportedModel[] = [
  {
    id: 'claude-sonnet-4-20250514',
    label: 'Claude Sonnet 4',
    provider: 'anthropic',
    description: 'Balanced default for editing plans, semantic reasoning, and tool use.'
  },
  {
    id: 'claude-opus-4-1-20250805',
    label: 'Claude Opus 4.1',
    provider: 'anthropic',
    description: 'Highest-depth Anthropic option for harder editing and planning tasks.'
  },
  {
    id: 'gpt-5.2',
    label: 'GPT-5.2',
    provider: 'openai',
    description: 'Strong reasoning model for planning edits and multi-step tool execution.'
  },
  {
    id: 'gpt-5-mini',
    label: 'GPT-5 mini',
    provider: 'openai',
    description: 'Lower-latency OpenAI option for routine assistant interactions.'
  },
  {
    id: 'gemini-2.5-pro',
    label: 'Gemini 2.5 Pro',
    provider: 'google',
    description: 'High-context Gemini model for project-wide media understanding.'
  },
  {
    id: 'gemini-2.5-flash',
    label: 'Gemini 2.5 Flash',
    provider: 'google',
    description: 'Fast Gemini option for quick suggestions and lightweight tasks.'
  }
]

const LEGACY_MODEL_ALIASES: Record<string, string> = {
  'claude-sonnet-4-6': 'claude-sonnet-4-20250514',
  'claude-opus-4-6': 'claude-opus-4-1-20250805',
  'gpt-5.4': 'gpt-5.2',
  'gpt-5.4-mini': 'gpt-5-mini',
  'gemini-3.1-pro-preview': 'gemini-2.5-pro'
}

export function getSupportedModel(modelId: string): SupportedModel | undefined {
  const normalizedId = normalizeStoredModelId(modelId)
  return SUPPORTED_MODELS.find((model) => model.id === normalizedId)
}

export function normalizeStoredModelId(modelId: string | undefined | null): string {
  if (!modelId) return SUPPORTED_MODELS[0].id
  return LEGACY_MODEL_ALIASES[modelId] || modelId
}
