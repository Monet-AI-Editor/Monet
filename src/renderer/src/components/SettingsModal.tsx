import { useState, useEffect } from 'react'
import { X, Eye, EyeOff, Key, CheckCircle2, Loader2, BarChart3 } from 'lucide-react'
import clsx from 'clsx'
import type { EditorState, EditorActions } from '../store/useEditorStore'

type Props = Pick<EditorState, 'aiSettings'> &
  Pick<EditorActions, 'setApiKey' | 'setAnalyticsEnabled' | 'persistAISettings'> & {
    onClose: () => void
  }

function KeyInput({
  label, value, onChange, placeholder
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  const [visible, setVisible] = useState(false)
  return (
    <div className="flex flex-col gap-1">
      <label className="text-2xs font-medium text-text-dim uppercase tracking-wide">{label}</label>
      <div className="relative flex items-center">
        <input
          type={visible ? 'text' : 'password'}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder ?? 'sk-…'}
          className="w-full bg-surface-2 border border-border rounded px-2.5 py-1.5 text-xs text-text-primary font-mono pr-8 outline-none focus:border-accent placeholder:text-text-dim"
          spellCheck={false}
          autoComplete="off"
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          className="absolute right-2 text-text-dim hover:text-text-secondary"
          tabIndex={-1}
        >
          {visible ? <EyeOff size={11} /> : <Eye size={11} />}
        </button>
      </div>
    </div>
  )
}

export function SettingsModal({
  aiSettings,
  setApiKey, setAnalyticsEnabled, persistAISettings,
  onClose
}: Props) {
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  // Close on Escape
  useEffect(() => {
    function onKey(e: KeyboardEvent) { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function handleSave() {
    setSaving(true)
    setSaved(false)
    try {
      await persistAISettings()
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-surface-1 border border-border rounded-xl shadow-2xl w-[480px] max-h-[90vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border flex-shrink-0">
          <h2 className="text-sm font-semibold text-text-primary">Settings</h2>
          <button onClick={onClose} className="p-1 rounded hover:bg-surface-3 text-text-dim hover:text-text-primary">
            <X size={14} />
          </button>
        </div>

        <div className="overflow-y-auto flex-1 px-5 py-4 space-y-6">
          {/* OpenAI */}
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <Key size={13} className="text-accent" />
              <span className="text-xs font-semibold text-text-primary">OpenAI</span>
            </div>
            <KeyInput
              label="API Key"
              value={aiSettings.apiKeys.openai}
              onChange={(v) => setApiKey('openai', v)}
              placeholder="sk-…"
            />
            <p className="text-2xs text-text-dim leading-relaxed">
              Required for embeddings and semantic search. If local transcription is unavailable, Monet can also use OpenAI as a fallback, and the same key can be reused for GPT Image 2 generation. Embeddings use <span className="font-mono text-text-secondary">text-embedding-3-small</span>.
            </p>
          </section>

          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <BarChart3 size={13} className="text-accent" />
              <span className="text-xs font-semibold text-text-primary">Anonymous Analytics</span>
            </div>
            <label className="flex items-start gap-3 rounded-lg border border-border bg-surface-2 px-3 py-3 cursor-pointer">
              <input
                type="checkbox"
                checked={aiSettings.analyticsEnabled}
                onChange={(event) => setAnalyticsEnabled(event.target.checked)}
                className="mt-0.5"
              />
              <div>
                <div className="text-xs text-text-primary font-medium">Share anonymous usage analytics</div>
                <div className="mt-1 text-2xs text-text-dim leading-relaxed">
                  Sends anonymous usage events to Aptabase for feature trends like project open, import, transcription, and export completion. No filenames, transcript text, prompts, or media content are collected from Monet projects.
                </div>
              </div>
            </label>
            <div className="rounded-lg border border-border bg-surface-2 px-3 py-3">
              <div className="text-xs text-text-primary font-medium">Crash reporting</div>
              <div className="mt-1 text-2xs text-text-dim leading-relaxed">
                Crash and exception reports go to Sentry so launch-blocking failures can be fixed quickly. We do not send prompts, transcripts, media files, or API keys.
              </div>
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border flex-shrink-0 bg-surface-0">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded text-xs text-text-secondary hover:text-text-primary hover:bg-surface-3 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => void handleSave()}
            disabled={saving}
            className={clsx(
              'flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold transition-colors',
              saving ? 'bg-surface-3 text-text-dim cursor-wait' : 'bg-accent hover:bg-accent-hover text-black'
            )}
          >
            {saved
              ? <><CheckCircle2 size={11} /> Saved</>
              : saving
                ? <><Loader2 size={11} className="animate-spin" /> Saving…</>
                : 'Save'
            }
          </button>
        </div>
      </div>
    </div>
  )
}
