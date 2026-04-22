import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { loadEnv } from 'vite'

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  const monetSentryDsn = env.MONET_SENTRY_DSN ?? process.env.MONET_SENTRY_DSN ?? ''
  const monetAptabaseAppKey = env.MONET_APTABASE_APP_KEY ?? process.env.MONET_APTABASE_APP_KEY ?? ''
  const rendererSentryDsn = env.VITE_MONET_SENTRY_DSN ?? process.env.VITE_MONET_SENTRY_DSN ?? monetSentryDsn

  return {
    main: {
      plugins: [externalizeDepsPlugin()],
      define: {
        'process.env.MONET_SENTRY_DSN': JSON.stringify(monetSentryDsn),
        'process.env.MONET_APTABASE_APP_KEY': JSON.stringify(monetAptabaseAppKey)
      }
    },
    preload: {
      plugins: [externalizeDepsPlugin()]
    },
    renderer: {
      define: {
        'import.meta.env.VITE_MONET_SENTRY_DSN': JSON.stringify(rendererSentryDsn)
      },
      resolve: {
        alias: {
          '@': resolve('src/renderer/src')
        }
      },
      plugins: [react()]
    }
  }
})
