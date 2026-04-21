import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'

const monetSentryDsn = process.env.MONET_SENTRY_DSN ?? ''
const monetAptabaseAppKey = process.env.MONET_APTABASE_APP_KEY ?? ''
const rendererSentryDsn = process.env.VITE_MONET_SENTRY_DSN ?? monetSentryDsn

export default defineConfig({
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
})
