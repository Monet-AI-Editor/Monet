import test from 'node:test'
import assert from 'node:assert/strict'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { WelcomeScreen } from '../src/renderer/src/components/WelcomeScreen.js'

function createBaseProps(): React.ComponentProps<typeof WelcomeScreen> {
  return {
    loading: false,
    projectManager: {
      currentProjectFilePath: null,
      recentProjects: []
    },
    projectName: 'Recovered Session',
    projectFilePath: null,
    assets: [],
    sequences: [],
    aiSettings: {
      onboardingCompleted: false,
      analyticsEnabled: false,
      apiKeys: { openai: '' },
      semanticApiKeys: { openai: '' },
      imageGenerationModel: 'gpt-image-2',
      localTranscriptionEnabled: false,
      localTranscriptionModel: 'tiny'
    },
    createProject: async () => undefined,
    openProject: async () => false,
    setAnalyticsEnabled: () => undefined,
    setApiKey: () => undefined,
    setOnboardingCompleted: () => undefined,
    persistAISettings: async () => undefined,
    onOpenProjects: () => undefined,
    onEnterWorkspace: () => undefined,
    appUpdateState: undefined,
    onApplyUpdate: undefined
  }
}

test('WelcomeScreen renders onboarding copy when setup is incomplete', () => {
  const markup = renderToStaticMarkup(
    React.createElement(WelcomeScreen, createBaseProps())
  )

  assert.match(markup, /Set up Monet once, then edit with AI\./)
  assert.match(markup, /OpenAI embeddings key/)
  assert.match(markup, /Anonymous usage data/)
  assert.match(markup, /Continue/)
})

test('WelcomeScreen renders recoverable workspace and recent-project copy after onboarding', () => {
  const props = createBaseProps()
  props.projectName = 'Demo Project'
  props.assets = [{ id: 'asset-1' } as never]
  props.sequences = [{ id: 'seq-1', duration: 44 } as never]
  props.projectManager.recentProjects = [
    {
      path: '/tmp/demo.aiveproj.json',
      name: 'Demo Project',
      lastOpenedAt: Date.now() - 60_000
    }
  ]
  props.aiSettings = {
    ...props.aiSettings,
    onboardingCompleted: true
  }

  const markup = renderToStaticMarkup(
    React.createElement(WelcomeScreen, props)
  )

  assert.match(markup, /Edit faster with AI-native video workflows\./)
  assert.match(markup, /Recover Session/)
  assert.match(markup, /Open Existing looks for a saved Monet project\./)
  assert.match(markup, /Recent/)
  assert.match(markup, /Demo Project/)
})
