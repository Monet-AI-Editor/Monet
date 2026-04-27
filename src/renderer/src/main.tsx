import * as SentryRenderer from '@sentry/electron/renderer'
import React from 'react'
import ReactDOM from 'react-dom/client'
import '@xterm/xterm/css/xterm.css'
import App from './App'
import { CanvasPanel } from './components/CanvasPanel'
import './index.css'

const sentryDsn = import.meta.env.VITE_MONET_SENTRY_DSN

if (sentryDsn) {
  SentryRenderer.init({
    dsn: sentryDsn,
    sendDefaultPii: false,
    environment: import.meta.env.DEV ? 'development' : 'production',
    beforeSend(event) {
      if (event.user) {
        delete event.user
      }
      return event
    }
  })
}

window.addEventListener('error', (event) => {
  console.error('[window.error]', event.error ?? event.message)
})

window.addEventListener('unhandledrejection', (event) => {
  console.error('[window.unhandledrejection]', event.reason)
})

const isCanvasStandalone = new URLSearchParams(window.location.search).get('view') === 'canvas-standalone'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  isCanvasStandalone ? (
    <div style={{ width: '100vw', height: '100vh', background: '#090909' }}>
      <CanvasPanel projectStorageKey="canvas-standalone" />
    </div>
  ) : (
    <App />
  )
)
