import { mkdir, readFile, writeFile } from 'fs/promises'
import { dirname } from 'path'
import type { AISettings } from '../../shared/editor'
import { normalizeStoredModelId } from './model-catalog'

export const DEFAULT_SETTINGS: AISettings = {
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
  },
  analyticsEnabled: false,
  onboardingCompleted: false,
  agentInstallNudgeSeen: false
}

export class SettingsStore {
  constructor(private readonly filePath: string) {}

  async getSettings(): Promise<AISettings> {
    try {
      const raw = await readFile(this.filePath, 'utf8')
      const parsed = JSON.parse(raw) as Partial<AISettings>
      return {
        selectedModelId: normalizeStoredModelId(parsed.selectedModelId || DEFAULT_SETTINGS.selectedModelId),
        apiKeys: {
          anthropic: parsed.apiKeys?.anthropic || '',
          openai: parsed.apiKeys?.openai || '',
          google: parsed.apiKeys?.google || ''
        },
        semanticProvider: parsed.semanticProvider || DEFAULT_SETTINGS.semanticProvider,
        semanticApiKeys: {
          openai: parsed.semanticApiKeys?.openai || '',
          google: parsed.semanticApiKeys?.google || '',
          voyage: parsed.semanticApiKeys?.voyage || ''
        },
        analyticsEnabled: typeof parsed.analyticsEnabled === 'boolean' ? parsed.analyticsEnabled : DEFAULT_SETTINGS.analyticsEnabled,
        onboardingCompleted: typeof parsed.onboardingCompleted === 'boolean' ? parsed.onboardingCompleted : DEFAULT_SETTINGS.onboardingCompleted,
        agentInstallNudgeSeen: typeof parsed.agentInstallNudgeSeen === 'boolean' ? parsed.agentInstallNudgeSeen : DEFAULT_SETTINGS.agentInstallNudgeSeen
      }
    } catch {
      return DEFAULT_SETTINGS
    }
  }

  async saveSettings(input: AISettings): Promise<AISettings> {
    const settings: AISettings = {
      selectedModelId: normalizeStoredModelId(input.selectedModelId || DEFAULT_SETTINGS.selectedModelId),
      apiKeys: {
        anthropic: input.apiKeys.anthropic || '',
        openai: input.apiKeys.openai || '',
        google: input.apiKeys.google || ''
      },
      semanticProvider: input.semanticProvider || DEFAULT_SETTINGS.semanticProvider,
      semanticApiKeys: {
        openai: input.semanticApiKeys.openai || '',
        google: input.semanticApiKeys.google || '',
        voyage: input.semanticApiKeys.voyage || ''
      },
      analyticsEnabled: Boolean(input.analyticsEnabled),
      onboardingCompleted: Boolean(input.onboardingCompleted),
      agentInstallNudgeSeen: Boolean(input.agentInstallNudgeSeen)
    }

    await mkdir(dirname(this.filePath), { recursive: true })
    await writeFile(this.filePath, JSON.stringify(settings, null, 2), 'utf8')
    return settings
  }
}
