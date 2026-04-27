import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
// Inline library content so iframes work in any environment (no CDN, no file:// path issues)
// @ts-ignore — vite ?raw import
import paperRaw from '../libs/paper-full.min.js?raw'
// @ts-ignore
import matterRaw from '../libs/matter.min.js?raw'
import {
  Plus, ZoomIn, ZoomOut, Maximize2, Code2, X, Check,
  Palette, Trash2, ChevronDown, LayoutGrid, Download, Upload
} from 'lucide-react'
import clsx from 'clsx'
import type { MediaAsset } from '../types'

type ArtboardMode = 'html' | 'paperjs' | 'matterjs'

interface Artboard {
  id: string
  name: string
  width: number
  height: number
  html: string
  script: string
  mode: ArtboardMode
  x: number
  y: number
}

const GRID = 40
const GAP = 80

let _id = 0
const uid = () => `ab-${++_id}-${Date.now()}`

function makeDoc(html: string, w: number, h: number) {
  return `<!DOCTYPE html><html><head>
<meta charset="utf-8">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&family=JetBrains+Mono:ital,wght@0,400;0,500;0,700;1,400&display=swap" rel="stylesheet">
<style>*{box-sizing:border-box;margin:0;padding:0;}body{width:${w}px;height:${h}px;overflow:hidden;}</style>
</head><body>${html}</body></html>`
}

function makeDocPaperJS(script: string, w: number, h: number) {
  return `<!DOCTYPE html><html><head>
<meta charset="utf-8">
<style>*{margin:0;padding:0;box-sizing:border-box;}body{width:${w}px;height:${h}px;overflow:hidden;background:#111;}canvas{display:block;}</style>
</head><body>
<canvas id="canvas" width="${w}" height="${h}"></canvas>
<script>${paperRaw}</script>
<script>
try {
paper.setup(document.getElementById('canvas'));
var width = ${w}, height = ${h};
(function() {
  with(paper) {
    var width = ${w}, height = ${h};
    ${script || 'new Path.Circle({ center: view.center, radius: 80, fillColor: "#5b82f7" });'}
  }
})();
paper.view.draw();
} catch(e) {
  var c = document.getElementById('canvas').getContext('2d');
  c.fillStyle='#111'; c.fillRect(0,0,${w},${h});
  c.fillStyle='#f07178'; c.font='14px monospace';
  c.fillText('Script error: '+e.message, 16, 40);
}
</script>
</body></html>`
}

function makeDocMatterJS(script: string, w: number, h: number) {
  return `<!DOCTYPE html><html><head>
<meta charset="utf-8">
<style>*{margin:0;padding:0;box-sizing:border-box;}body{width:${w}px;height:${h}px;overflow:hidden;background:#111;}canvas{display:block;}</style>
</head><body>
<canvas id="canvas"></canvas>
<script>${matterRaw}</script>
<script>
var { Engine, Render, Runner, Bodies, Composite, World, Body, Events, Constraint, Mouse, MouseConstraint } = Matter;
var width = ${w}, height = ${h};
var engine = Engine.create();
var render = Render.create({
  canvas: document.getElementById('canvas'),
  engine: engine,
  options: { width: ${w}, height: ${h}, wireframes: false, background: '#111318' }
});
${script || `// Default physics scene
var ground = Bodies.rectangle(width/2, height + 25, width, 50, { isStatic: true, render: { fillStyle: '#334155' } });
var wall1 = Bodies.rectangle(-25, height/2, 50, height, { isStatic: true, render: { fillStyle: '#1e293b' } });
var wall2 = Bodies.rectangle(width+25, height/2, 50, height, { isStatic: true, render: { fillStyle: '#1e293b' } });
var ball1 = Bodies.circle(width/3, 50, 30, { restitution: 0.8, render: { fillStyle: '#5b82f7' } });
var ball2 = Bodies.circle(width/2, 80, 20, { restitution: 0.9, render: { fillStyle: '#f07178' } });
var box = Bodies.rectangle(2*width/3, 100, 60, 60, { render: { fillStyle: '#8bd49c' } });
Composite.add(engine.world, [ground, wall1, wall2, ball1, ball2, box]);
engine.gravity.y = 1;`}
Runner.run(engine);
Render.run(render);
</script>
</body></html>`
}

function getArtboardSrcDoc(ab: Artboard, liveHtml: string, editHtml: string, editScript: string, editingId: string | null) {
  const isEditing = editingId === ab.id
  if (ab.mode === 'paperjs') {
    return makeDocPaperJS(isEditing ? editScript : ab.script, ab.width, ab.height)
  }
  if (ab.mode === 'matterjs') {
    return makeDocMatterJS(isEditing ? editScript : ab.script, ab.width, ab.height)
  }
  // html mode
  return makeDoc(isEditing ? liveHtml : ab.html, ab.width, ab.height)
}

function hasContent(ab: Artboard) {
  if (ab.mode === 'paperjs' || ab.mode === 'matterjs') return Boolean(ab.script)
  return Boolean(ab.html)
}

const PRESETS = [
  { label: '16:9 Video', w: 1280, h: 720 },
  { label: '4K', w: 3840, h: 2160 },
  { label: 'Desktop', w: 1440, h: 900 },
  { label: 'Mobile', w: 390, h: 844 },
  { label: 'Square', w: 1080, h: 1080 },
]

const MODE_BADGE: Record<ArtboardMode, { label: string; classes: string }> = {
  html:     { label: 'html',  classes: 'bg-surface-3 text-text-dim' },
  paperjs:  { label: 'pjs',   classes: 'bg-blue-900/50 text-blue-300' },
  matterjs: { label: 'mjs',   classes: 'bg-green-900/50 text-green-300' },
}

const GRID_COLS = 26
const GRID_ROWS = 7

// Full-screen overlay — kept as fallback for explicit `set-loading` with no artboard ID
function CanvasLoadingOverlay({ message }: { message: string }) {
  const [tick, setTick] = useState(0)

  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 120)
    return () => clearInterval(id)
  }, [])

  const cells = useMemo(() => {
    const out: number[] = []
    for (let r = 0; r < GRID_ROWS; r++) {
      for (let c = 0; c < GRID_COLS; c++) {
        const wave = (c + r * 2 + tick) % 16
        const level = wave < 4 ? 0.08 : wave < 7 ? 0.25 : wave < 9 ? 0.7 : wave < 11 ? 0.45 : 0.15
        out.push(level)
      }
    }
    return out
  }, [tick])

  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none gap-6 bg-[#090909]/80 backdrop-blur-[2px] z-20">
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${GRID_COLS}, 10px)`,
          gridTemplateRows: `repeat(${GRID_ROWS}, 10px)`,
          gap: '3px',
        }}
      >
        {cells.map((alpha, i) => (
          <div
            key={i}
            style={{
              width: 10,
              height: 10,
              borderRadius: 2,
              backgroundColor: `rgba(99, 179, 237, ${alpha})`,
              transition: 'background-color 0.12s ease',
            }}
          />
        ))}
      </div>
      <div className="flex flex-col items-center gap-1.5">
        <div className="text-sm font-medium text-text-primary">{message || 'Working…'}</div>
        <div className="text-2xs text-text-dim opacity-60">Agent is drawing in the canvas</div>
      </div>
    </div>
  )
}

// Per-artboard loading overlay — compact 16×5 grid scaled to fit inside the frame
function ArtboardLoadingOverlay() {
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 100)
    return () => clearInterval(id)
  }, [])

  return (
    <div style={{
      position: 'absolute', inset: 0,
      background: 'rgba(0,0,0,0.55)',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      gap: 12, zIndex: 10,
    }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(16, 8px)', gridTemplateRows: 'repeat(5, 8px)', gap: '2px' }}>
        {Array.from({ length: 80 }, (_, i) => {
          const col = i % 16
          const row = Math.floor(i / 16)
          const wave = (col + row * 2 + tick) % 14
          const alpha = wave < 3 ? 0.08 : wave < 6 ? 0.3 : wave < 8 ? 0.75 : wave < 10 ? 0.4 : 0.12
          return (
            <div
              key={i}
              style={{
                width: 8, height: 8, borderRadius: 2,
                backgroundColor: `rgba(99,179,237,${alpha})`,
                transition: 'background-color 0.1s',
              }}
            />
          )
        })}
      </div>
      <div style={{ color: 'rgba(255,255,255,0.8)', fontSize: 11, fontFamily: 'monospace' }}>Rendering…</div>
    </div>
  )
}

export function CanvasPanel({ projectStorageKey, assets = [] }: { projectStorageKey: string; assets?: MediaAsset[] }) {
  const normalizeArtboards = useCallback((input: Artboard[]) => (
    input.map(ab => ({
      script: '',
      mode: 'html' as ArtboardMode,
      ...ab,
    }))
  ), [])

  const legacyStorageKey = 'monet-canvas-artboards'
  const storageKey = useMemo(() => `monet-canvas-artboards:${projectStorageKey}`, [projectStorageKey])
  const [artboards, setArtboards] = useState<Artboard[]>([])

  const buildArtboardsFromMediaAssets = useCallback((mediaAssets: MediaAsset[]): Artboard[] => {
    const canvasAssets = mediaAssets
      .filter((asset) => asset.type === 'image')
      .filter((asset) => {
        const path = asset.path.toLowerCase()
        const name = asset.name.toLowerCase()
        return path.includes('canvas-frame-') || name.includes('canvas-frame-')
      })
      .sort((left, right) => left.addedAt - right.addedAt)

    return canvasAssets.map((asset, index) => {
      const width = 1280
      const height = 720
      const x = index === 0 ? 80 : 80 + index * (width + GAP)
      const y = 80
      const imageUrl = window.api.toFileUrl(asset.path)
      const html = `<div style="width:${width}px;height:${height}px;background:#000;display:flex;align-items:center;justify-content:center;overflow:hidden;"><img src="${imageUrl}" style="max-width:100%;max-height:100%;object-fit:contain;" /></div>`

      return {
        id: uid(),
        name: asset.name.replace(/\.[a-z0-9]+$/i, ''),
        width,
        height,
        html,
        script: '',
        mode: 'html',
        x,
        y
      }
    })
  }, [])

  // Load canvas state for the active project whenever the project identity changes.
  useEffect(() => {
    let cancelled = false

    try {
      const raw = localStorage.getItem(storageKey)
      if (raw) {
        const parsed = JSON.parse(raw) as Artboard[]
        if (!cancelled) {
          setArtboards(normalizeArtboards(parsed))
        }
        return () => {
          cancelled = true
        }
      }
    } catch {
      // Fall back to empty state below.
    }

    try {
      const legacyRaw = localStorage.getItem(legacyStorageKey)
      if (legacyRaw) {
        const legacyParsed = JSON.parse(legacyRaw) as Artboard[]
        const normalized = normalizeArtboards(legacyParsed)
        if (!cancelled) {
          setArtboards(normalized)
        }
        localStorage.setItem(storageKey, JSON.stringify(normalized))
        return () => {
          cancelled = true
        }
      }
    } catch {
      // Fall back to empty state below.
    }

    if (typeof window !== 'undefined' && window.api?.recoverLegacyCanvasState) {
      void window.api.recoverLegacyCanvasState().then((result) => {
        if (cancelled || !result.ok || !Array.isArray(result.artboards) || result.artboards.length === 0) return
        const normalized = normalizeArtboards(result.artboards as Artboard[])
        setArtboards(normalized)
        localStorage.setItem(storageKey, JSON.stringify(normalized))
      }).catch(() => undefined)
    }

    const recoveredFromAssets = buildArtboardsFromMediaAssets(assets)
    if (recoveredFromAssets.length > 0) {
      if (!cancelled) {
        setArtboards(recoveredFromAssets)
      }
      localStorage.setItem(storageKey, JSON.stringify(recoveredFromAssets))
      return () => {
        cancelled = true
      }
    }

    if (!cancelled) setArtboards([])

    fetch('/monet-canvas-state.json')
      .then(r => r.json())
      .then((data: Artboard[]) => {
        if (cancelled || data.length === 0) return
        setArtboards(normalizeArtboards(data))
      })
      .catch(() => {})

    return () => {
      cancelled = true
    }
  }, [assets, buildArtboardsFromMediaAssets, legacyStorageKey, normalizeArtboards, storageKey])

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editHtml, setEditHtml] = useState('')
  const [editScript, setEditScript] = useState('')
  const [editMode, setEditMode] = useState<ArtboardMode>('html')
  const [editName, setEditName] = useState('')
  const [editW, setEditW] = useState(1280)
  const [editH, setEditH] = useState(720)
  const [zoom, setZoom] = useState(0.7)
  const [pan, setPan] = useState({ x: 120, y: 80 })
  const [showLayers, setShowLayers] = useState(true)
  const [showPresets, setShowPresets] = useState(false)
  const [liveHtml, setLiveHtml] = useState('')
  // Per-artboard loading: set of artboard IDs currently showing a loading overlay
  const [loadingFrameIds, setLoadingFrameIds] = useState<Set<string>>(new Set())
  // Global full-screen loading: only used when set-loading is sent with no specific artboard ID
  const [globalLoading, setGlobalLoading] = useState(false)
  const [globalLoadingMsg, setGlobalLoadingMsg] = useState('')

  const viewportRef = useRef<HTMLDivElement>(null)
  const isSpaceRef = useRef(false)
  const isPanningRef = useRef(false)
  const panStartRef = useRef({ mx: 0, my: 0, px: 0, py: 0 })
  // Figma-style: track a pending pan that activates once drag threshold is crossed
  const pendingPanRef = useRef<{ mx: number; my: number; px: number; py: number } | null>(null)
  // Track iframes by artboard ID so we can capture canvas snapshots
  const iframeRefs = useRef<Map<string, HTMLIFrameElement>>(new Map())

  const selectedAb = artboards.find(a => a.id === selectedId) ?? null
  const editingAb = artboards.find(a => a.id === editingId) ?? null

  // Persist artboards across HMR/reloads
  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(artboards))
  }, [artboards, storageKey])

  // Save canvas state to main process whenever artboards change
  useEffect(() => {
    if (typeof window !== 'undefined' && window.api?.saveCanvasState) {
      void window.api.saveCanvasState(artboards)
    }
  }, [artboards])

  // Live preview: update iframe while typing (html mode only)
  useEffect(() => {
    const timer = setTimeout(() => setLiveHtml(editHtml), 150)
    return () => clearTimeout(timer)
  }, [editHtml])

  // Per-artboard auto-clear timers; global timer keyed by '__global__'
  const loadingTimersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  // Capture the canvas element inside an artboard iframe and save it as a project media asset
  const captureFrameToMedia = useCallback((abId: string, name: string) => {
    const iframe = iframeRefs.current.get(abId)
    if (!iframe) return
    try {
      const canvas = iframe.contentDocument?.getElementById('canvas') as HTMLCanvasElement | null
      if (!canvas) return
      const dataUrl = canvas.toDataURL('image/png')
      void window.api.saveFrameAsMedia(dataUrl, name).catch(() => undefined)
    } catch { /* sandboxed iframe — cross-origin access blocked */ }
  }, [])

  // Helper: start per-artboard loading and schedule auto-clear + capture
  const startFrameLoading = useCallback((abId: string, abName: string) => {
    // Cancel any existing timer for this artboard
    const existing = loadingTimersRef.current.get(abId)
    if (existing) clearTimeout(existing)

    setLoadingFrameIds(prev => {
      const next = new Set(prev)
      next.add(abId)
      return next
    })

    const timer = setTimeout(() => {
      setLoadingFrameIds(prev => {
        const next = new Set(prev)
        next.delete(abId)
        return next
      })
      loadingTimersRef.current.delete(abId)
      captureFrameToMedia(abId, abName)
    }, 1200)

    loadingTimersRef.current.set(abId, timer)
  }, [captureFrameToMedia])

  // IPC command listener from API bridge
  useEffect(() => {
    if (!window.api?.onCanvasCommand) return
    const unsub = window.api.onCanvasCommand(({ command, args }) => {
      if (command === 'add-frame') {
        const name = typeof args.name === 'string' ? args.name : 'Frame'
        const w = typeof args.width === 'number' ? args.width : typeof args.w === 'number' ? args.w : 1280
        const h = typeof args.height === 'number' ? args.height : typeof args.h === 'number' ? args.h : 720
        const mode: ArtboardMode = (args.mode === 'paperjs' || args.mode === 'matterjs') ? args.mode : 'html'
        const html = typeof args.html === 'string' ? args.html : ''
        const script = typeof args.script === 'string' ? args.script : ''
        const newId = uid()
        setArtboards(prev => {
          const last = prev[prev.length - 1]
          const x = last ? last.x + last.width + GAP : 80
          const y = last ? last.y : 80
          return [...prev, { id: newId, name, width: w, height: h, html, script, mode, x, y }]
        })
        startFrameLoading(newId, name)
      } else if (command === 'update-frame') {
        const id = typeof args.id === 'string' ? args.id : null
        if (!id) return
        setArtboards(prev => prev.map(a => {
          if (a.id !== id) return a
          return {
            ...a,
            name: typeof args.name === 'string' ? args.name : a.name,
            width: typeof args.width === 'number' ? args.width : a.width,
            height: typeof args.height === 'number' ? args.height : a.height,
            html: typeof args.html === 'string' ? args.html : a.html,
            script: typeof args.script === 'string' ? args.script : a.script,
            mode: (args.mode === 'html' || args.mode === 'paperjs' || args.mode === 'matterjs') ? args.mode : a.mode,
          }
        }))
        // Find the current name for the frame (used for the capture filename)
        setArtboards(prev => {
          const ab = prev.find(a => a.id === id)
          if (ab) startFrameLoading(id, ab.name)
          return prev
        })
      } else if (command === 'delete-frame') {
        const id = typeof args.id === 'string' ? args.id : null
        if (!id) return
        const t = loadingTimersRef.current.get(id)
        if (t) { clearTimeout(t); loadingTimersRef.current.delete(id) }
        setLoadingFrameIds(prev => { const n = new Set(prev); n.delete(id); return n })
        iframeRefs.current.delete(id)
        setArtboards(prev => prev.filter(a => a.id !== id))
        setSelectedId(s => s === id ? null : s)
        setEditingId(e => e === id ? null : e)
      } else if (command === 'select-frame') {
        const id = typeof args.id === 'string' ? args.id : null
        setSelectedId(id)
      } else if (command === 'clear') {
        loadingTimersRef.current.forEach(t => clearTimeout(t))
        loadingTimersRef.current.clear()
        iframeRefs.current.clear()
        setLoadingFrameIds(new Set())
        setArtboards([])
        setSelectedId(null)
        setEditingId(null)
      } else if (command === 'set-zoom') {
        const z = typeof args.zoom === 'number' ? args.zoom : null
        if (z !== null) setZoom(z)
      } else if (command === 'set-loading') {
        // Explicit set-loading: if a specific ID is provided use per-artboard, otherwise global
        const targetId = typeof args.id === 'string' ? args.id : null
        if (targetId) {
          setArtboards(prev => {
            const ab = prev.find(a => a.id === targetId)
            if (ab) startFrameLoading(targetId, ab.name)
            return prev
          })
        } else {
          setGlobalLoading(true)
          setGlobalLoadingMsg(typeof args.message === 'string' ? args.message : 'Working…')
        }
      } else if (command === 'clear-loading') {
        // Clear all per-artboard loaders and global loader
        loadingTimersRef.current.forEach(t => clearTimeout(t))
        loadingTimersRef.current.clear()
        setLoadingFrameIds(new Set())
        setGlobalLoading(false)
        setGlobalLoadingMsg('')
      }
    })
    return () => {
      unsub()
      loadingTimersRef.current.forEach(t => clearTimeout(t))
    }
  }, [startFrameLoading])

  // File queue polling — picks up canvas commands written by editorctl or any other process.
  // Works regardless of which app owns port 51847.
  useEffect(() => {
    if (!window.api?.drainCanvasQueue) return
    const processCommand = (command: string, args: Record<string, unknown>) => {
      if (command === 'add-frame') {
        const name = typeof args.name === 'string' ? args.name : 'Frame'
        const w = typeof args.width === 'number' ? args.width : 1280
        const h = typeof args.height === 'number' ? args.height : 720
        const mode: ArtboardMode = (args.mode === 'paperjs' || args.mode === 'matterjs') ? args.mode : 'html'
        const html = typeof args.html === 'string' ? args.html : ''
        const script = typeof args.script === 'string' ? args.script : ''
        const newId = uid()
        setArtboards(prev => {
          const last = prev[prev.length - 1]
          const x = last ? last.x + last.width + GAP : 80
          const y = last ? last.y : 80
          return [...prev, { id: newId, name, width: w, height: h, html, script, mode, x, y }]
        })
        startFrameLoading(newId, name)
      } else if (command === 'update-frame') {
        const id = typeof args.id === 'string' ? args.id : null
        if (!id) return
        setArtboards(prev => prev.map(a => {
          if (a.id !== id) return a
          return {
            ...a,
            name: typeof args.name === 'string' ? args.name : a.name,
            width: typeof args.width === 'number' ? args.width : a.width,
            height: typeof args.height === 'number' ? args.height : a.height,
            html: typeof args.html === 'string' ? args.html : a.html,
            script: typeof args.script === 'string' ? args.script : a.script,
            mode: (args.mode === 'html' || args.mode === 'paperjs' || args.mode === 'matterjs') ? args.mode : a.mode,
          }
        }))
        setArtboards(prev => {
          const ab = prev.find(a => a.id === id)
          if (ab) startFrameLoading(id, ab.name)
          return prev
        })
      } else if (command === 'delete-frame') {
        const id = typeof args.id === 'string' ? args.id : null
        if (!id) return
        const t = loadingTimersRef.current.get(id)
        if (t) { clearTimeout(t); loadingTimersRef.current.delete(id) }
        setLoadingFrameIds(prev => { const n = new Set(prev); n.delete(id); return n })
        iframeRefs.current.delete(id)
        setArtboards(prev => prev.filter(a => a.id !== id))
        setSelectedId(s => s === id ? null : s)
      } else if (command === 'clear') {
        loadingTimersRef.current.forEach(t => clearTimeout(t))
        loadingTimersRef.current.clear()
        iframeRefs.current.clear()
        setLoadingFrameIds(new Set())
        setArtboards([])
        setSelectedId(null)
        setEditingId(null)
      } else if (command === 'set-zoom') {
        const z = typeof args.zoom === 'number' ? args.zoom : null
        if (z !== null) setZoom(z)
      } else if (command === 'set-loading') {
        const targetId = typeof args.id === 'string' ? args.id : null
        if (targetId) {
          setArtboards(prev => {
            const ab = prev.find(a => a.id === targetId)
            if (ab) startFrameLoading(targetId, ab.name)
            return prev
          })
        } else {
          setGlobalLoading(true)
          setGlobalLoadingMsg(typeof args.message === 'string' ? args.message : 'Working…')
        }
      } else if (command === 'clear-loading') {
        loadingTimersRef.current.forEach(t => clearTimeout(t))
        loadingTimersRef.current.clear()
        setLoadingFrameIds(new Set())
        setGlobalLoading(false)
        setGlobalLoadingMsg('')
      }
    }

    const id = setInterval(async () => {
      try {
        const commands = await window.api.drainCanvasQueue()
        for (const { command, args } of commands) processCommand(command, args)
      } catch { /* ignore */ }
    }, 500)
    return () => clearInterval(id)
  }, [startFrameLoading]) // eslint-disable-line react-hooks/exhaustive-deps

  // --- Pan & zoom via keyboard/mouse ---
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        const t = e.target as HTMLElement
        if (t.tagName === 'TEXTAREA' || t.tagName === 'INPUT') return
        e.preventDefault()
        isSpaceRef.current = true
        if (viewportRef.current) viewportRef.current.style.cursor = 'grab'
      }
      if (e.code === 'Escape' && editingId) {
        setEditingId(null)
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        isSpaceRef.current = false
        if (viewportRef.current) viewportRef.current.style.cursor = ''
      }
    }
    const onMouseMove = (e: MouseEvent) => {
      if (isPanningRef.current) {
        const { mx, my, px, py } = panStartRef.current
        setPan({ x: px + (e.clientX - mx), y: py + (e.clientY - my) })
      } else if (pendingPanRef.current) {
        // Activate pan once drag distance exceeds 4px (Figma-style threshold)
        const dx = e.clientX - pendingPanRef.current.mx
        const dy = e.clientY - pendingPanRef.current.my
        if (Math.sqrt(dx * dx + dy * dy) > 4) {
          isPanningRef.current = true
          panStartRef.current = pendingPanRef.current
          pendingPanRef.current = null
          if (viewportRef.current) viewportRef.current.style.cursor = 'grabbing'
        }
      }
    }
    const onMouseUp = () => {
      pendingPanRef.current = null
      if (isPanningRef.current) {
        isPanningRef.current = false
        if (viewportRef.current) viewportRef.current.style.cursor = isSpaceRef.current ? 'grab' : ''
      }
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    window.addEventListener('mousemove', onMouseMove)
    window.addEventListener('mouseup', onMouseUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      window.removeEventListener('mousemove', onMouseMove)
      window.removeEventListener('mouseup', onMouseUp)
    }
  }, [editingId])

  const onViewportMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button === 1 || isSpaceRef.current) {
      // Middle click or Space: immediate pan
      e.preventDefault()
      isPanningRef.current = true
      panStartRef.current = { mx: e.clientX, my: e.clientY, px: pan.x, py: pan.y }
      if (viewportRef.current) viewportRef.current.style.cursor = 'grabbing'
    } else if (e.button === 0 && e.target === viewportRef.current) {
      // Left click on empty canvas background: pending pan (activates after drag threshold)
      pendingPanRef.current = { mx: e.clientX, my: e.clientY, px: pan.x, py: pan.y }
    }
  }, [pan])

  const onWheel = useCallback((e: React.WheelEvent) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault()
      const rect = viewportRef.current?.getBoundingClientRect()
      if (!rect) return
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1
      const next = Math.max(0.05, Math.min(8, zoom * factor))
      setPan(p => ({
        x: mx - (mx - p.x) * (next / zoom),
        y: my - (my - p.y) * (next / zoom),
      }))
      setZoom(next)
    } else {
      setPan(p => ({ x: p.x - e.deltaX, y: p.y - e.deltaY }))
    }
  }, [zoom])

  // --- Artboard management ---
  const addArtboard = useCallback((w = 1280, h = 720, mode: ArtboardMode = 'html') => {
    const last = artboards[artboards.length - 1]
    const x = last ? last.x + last.width + GAP : 80
    const y = last ? last.y : 80
    const ab: Artboard = { id: uid(), name: `Frame ${artboards.length + 1}`, width: w, height: h, html: '', script: '', mode, x, y }
    setArtboards(prev => [...prev, ab])
    setSelectedId(ab.id)
    openEditor(ab)
    setShowPresets(false)
  }, [artboards]) // eslint-disable-line react-hooks/exhaustive-deps

  const deleteSelected = useCallback(() => {
    if (!selectedId) return
    setArtboards(prev => prev.filter(a => a.id !== selectedId))
    setSelectedId(null)
    if (editingId === selectedId) setEditingId(null)
  }, [selectedId, editingId])

  const exportCanvas = useCallback(async () => {
    if (artboards.length === 0) return
    try {
      await window.api.exportCanvasState(artboards)
    } catch { /* user canceled or error — non-fatal */ }
  }, [artboards])

  const importCanvas = useCallback(async () => {
    try {
      const result = await window.api.importCanvasState()
      if (!result.ok || !result.artboards || !Array.isArray(result.artboards)) return
      // Add imported artboards to current canvas (don't replace) — assign new IDs to avoid conflicts
      setArtboards(prev => {
        const last = prev[prev.length - 1]
        let nextX = last ? last.x + last.width + GAP : 80
        const baseY = last ? last.y : 80
        const remapped = (result.artboards as Artboard[]).map((ab, i) => {
          const safeAb: Artboard = {
            id: uid(),
            name: typeof ab.name === 'string' ? ab.name : `Imported ${i + 1}`,
            width: typeof ab.width === 'number' ? ab.width : 1280,
            height: typeof ab.height === 'number' ? ab.height : 720,
            html: typeof ab.html === 'string' ? ab.html : '',
            script: typeof ab.script === 'string' ? ab.script : '',
            mode: (ab.mode === 'paperjs' || ab.mode === 'matterjs' || ab.mode === 'html') ? ab.mode : 'html',
            x: nextX,
            y: baseY,
          }
          nextX += safeAb.width + GAP
          return safeAb
        })
        return [...prev, ...remapped]
      })
    } catch { /* non-fatal */ }
  }, [])

  const openEditor = useCallback((ab: Artboard) => {
    setEditingId(ab.id)
    setEditHtml(ab.html)
    setEditScript(ab.script)
    setEditMode(ab.mode)
    setLiveHtml(ab.html)
    setEditName(ab.name)
    setEditW(ab.width)
    setEditH(ab.height)
  }, [])

  const saveEdit = useCallback(() => {
    if (!editingId) return
    setArtboards(prev => prev.map(a =>
      a.id === editingId
        ? { ...a, html: editHtml, script: editScript, mode: editMode, name: editName, width: editW, height: editH }
        : a
    ))
    setEditingId(null)
  }, [editingId, editHtml, editScript, editMode, editName, editW, editH])

  const fitAll = useCallback(() => {
    if (!artboards.length || !viewportRef.current) return
    const rect = viewportRef.current.getBoundingClientRect()
    const vw = rect.width - (showLayers ? 176 : 0) - (editingId ? 384 : 0)
    const vh = rect.height
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    for (const a of artboards) {
      minX = Math.min(minX, a.x)
      minY = Math.min(minY, a.y)
      maxX = Math.max(maxX, a.x + a.width)
      maxY = Math.max(maxY, a.y + a.height)
    }
    const cw = maxX - minX + 160
    const ch = maxY - minY + 160
    const nz = Math.min(1.5, vw / cw, vh / ch)
    setZoom(nz)
    setPan({
      x: (showLayers ? 176 : 0) + (vw - cw * nz) / 2 - (minX - 80) * nz,
      y: (vh - ch * nz) / 2 - (minY - 80) * nz,
    })
  }, [artboards, showLayers, editingId])

  const scrollToAb = useCallback((ab: Artboard) => {
    if (!viewportRef.current) return
    const rect = viewportRef.current.getBoundingClientRect()
    const cx = ab.x * zoom + pan.x
    const cy = ab.y * zoom + pan.y
    const tx = rect.width / 2 - (ab.width * zoom) / 2
    const ty = rect.height / 2 - (ab.height * zoom) / 2
    setPan(p => ({ x: p.x + (tx - cx), y: p.y + (ty - cy) }))
  }, [zoom, pan])

  const zoomIn = () => setZoom(z => Math.min(8, +(z * 1.25).toFixed(3)))
  const zoomOut = () => setZoom(z => Math.max(0.05, +(z / 1.25).toFixed(3)))
  const zoom100 = () => setZoom(1)

  // Expose programmatic API for Playwright / AI control
  const artboardsRef = useRef<Artboard[]>(artboards)
  useEffect(() => { artboardsRef.current = artboards }, [artboards])

  useEffect(() => {
    ;(window as any).__monetCanvas = {
      addFrame: (name: string, w: number, h: number, html: string) => {
        const newId = uid()
        setArtboards(prev => {
          const last = prev[prev.length - 1]
          const x = last ? last.x + last.width + GAP : 80
          const y = last ? last.y : 80
          return [...prev, { id: newId, name, width: w, height: h, html, script: '', mode: 'html' as ArtboardMode, x, y }]
        })
        setSelectedId(newId)
        return newId
      },
      addPaperFrame: (name: string, w: number, h: number, script: string) => {
        const newId = uid()
        setArtboards(prev => {
          const last = prev[prev.length - 1]
          const x = last ? last.x + last.width + GAP : 80
          const y = last ? last.y : 80
          return [...prev, { id: newId, name, width: w, height: h, html: '', script: script || '', mode: 'paperjs' as ArtboardMode, x, y }]
        })
        setSelectedId(newId)
        return newId
      },
      addMatterFrame: (name: string, w: number, h: number, scene: string) => {
        const newId = uid()
        setArtboards(prev => {
          const last = prev[prev.length - 1]
          const x = last ? last.x + last.width + GAP : 80
          const y = last ? last.y : 80
          return [...prev, { id: newId, name, width: w, height: h, html: '', script: scene || '', mode: 'matterjs' as ArtboardMode, x, y }]
        })
        setSelectedId(newId)
        return newId
      },
      setFrameHtml: (id: string, html: string) => {
        setArtboards(prev => prev.map(a => a.id === id ? { ...a, html } : a))
      },
      setFrameName: (id: string, name: string) => {
        setArtboards(prev => prev.map(a => a.id === id ? { ...a, name } : a))
      },
      setFrameMode: (id: string, mode: ArtboardMode, content: string) => {
        setArtboards(prev => prev.map(a => {
          if (a.id !== id) return a
          if (mode === 'html') return { ...a, mode, html: content }
          return { ...a, mode, script: content }
        }))
      },
      deleteFrame: (id: string) => {
        setArtboards(prev => prev.filter(a => a.id !== id))
      },
      getFrames: () => artboardsRef.current.map(a => ({ id: a.id, name: a.name, width: a.width, height: a.height, mode: a.mode })),
      getFramesDetailed: () => artboardsRef.current,
      selectFrame: (id: string) => {
        const ab = artboardsRef.current.find(a => a.id === id)
        if (ab) { setSelectedId(id); scrollToAb(ab) }
      },
      clearAll: () => { setArtboards([]); setSelectedId(null); setEditingId(null) },
      fitAll,
      setZoom: (z: number) => setZoom(z),
    }
    return () => { delete (window as any).__monetCanvas }
  }, [fitAll, scrollToAb])

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[#090909] text-text-primary">

      {/* ── Toolbar ── */}
      <div className="flex items-center justify-between border-b border-border bg-surface-1 px-3 py-1.5 flex-shrink-0 gap-3">

        {/* Left: layers toggle + add */}
        <div className="flex items-center gap-2">
          <button
            title="Toggle layers panel"
            onClick={() => setShowLayers(v => !v)}
            className={clsx('rounded p-1.5 transition-colors', showLayers ? 'text-accent bg-accent/10' : 'text-text-dim hover:text-text-secondary')}
          >
            <LayoutGrid size={12} />
          </button>

          <div className="h-3.5 w-px bg-border" />

          {/* Add artboard */}
          <div className="relative">
            <button
              onClick={() => setShowPresets(v => !v)}
              className="flex items-center gap-1.5 rounded border border-accent/30 bg-accent/10 px-2 py-1 text-2xs font-medium text-accent hover:bg-accent/20 transition-colors"
            >
              <Plus size={11} />
              New Frame
              <ChevronDown size={10} className={clsx('transition-transform', showPresets && 'rotate-180')} />
            </button>
            {showPresets && (
              <div className="absolute top-full left-0 mt-1 z-50 rounded-lg border border-border bg-surface-2 shadow-2xl py-1 min-w-[160px]">
                <div className="px-3 py-1 text-[9px] font-semibold uppercase tracking-widest text-text-dim opacity-50">HTML Frames</div>
                {PRESETS.map(p => (
                  <button
                    key={p.label}
                    onClick={() => addArtboard(p.w, p.h, 'html')}
                    className="w-full text-left px-3 py-1.5 text-2xs text-text-secondary hover:bg-surface-3 hover:text-text-primary transition-colors flex items-center justify-between gap-4"
                  >
                    <span>{p.label}</span>
                    <span className="text-text-dim">{p.w}×{p.h}</span>
                  </button>
                ))}
                <div className="border-t border-border/40 mt-1 pt-1">
                  <div className="px-3 py-1 text-[9px] font-semibold uppercase tracking-widest text-text-dim opacity-50">Canvas Modes</div>
                  <button
                    onClick={() => addArtboard(1280, 720, 'paperjs')}
                    className="w-full text-left px-3 py-1.5 text-2xs text-blue-300 hover:bg-surface-3 transition-colors flex items-center gap-2"
                  >
                    <span className="text-[9px] font-mono bg-blue-900/50 text-blue-300 px-1 rounded">pjs</span>
                    Paper.js Frame
                  </button>
                  <button
                    onClick={() => addArtboard(1280, 720, 'matterjs')}
                    className="w-full text-left px-3 py-1.5 text-2xs text-green-300 hover:bg-surface-3 transition-colors flex items-center gap-2"
                  >
                    <span className="text-[9px] font-mono bg-green-900/50 text-green-300 px-1 rounded">mjs</span>
                    Matter.js Frame
                  </button>
                </div>
              </div>
            )}
          </div>

          {selectedAb && !editingId && (
            <button
              onClick={() => openEditor(selectedAb)}
              className="flex items-center gap-1.5 rounded border border-border px-2 py-1 text-2xs font-medium text-text-secondary hover:text-text-primary hover:border-text-dim transition-colors"
            >
              <Code2 size={11} />
              Edit
            </button>
          )}

          {selectedAb && !editingId && (
            <button
              onClick={deleteSelected}
              className="rounded p-1.5 text-text-dim hover:text-red-400 transition-colors"
              title="Delete selected frame"
            >
              <Trash2 size={12} />
            </button>
          )}
        </div>

        {/* Center: canvas name */}
        <div className="absolute left-1/2 -translate-x-1/2 text-2xs font-medium text-text-dim pointer-events-none">
          {selectedAb ? selectedAb.name : 'Monet Canvas'}
          {selectedAb && (
            <span className="ml-1.5 text-text-dim opacity-50">{selectedAb.width}×{selectedAb.height}</span>
          )}
        </div>

        {/* Right: import/export + zoom */}
        <div className="flex items-center gap-0.5">
          <button
            onClick={importCanvas}
            title="Import canvas (.json)"
            className="rounded p-1.5 text-text-dim hover:text-text-secondary transition-colors"
          >
            <Upload size={12} />
          </button>
          <button
            onClick={exportCanvas}
            disabled={artboards.length === 0}
            title="Export canvas (.json)"
            className="rounded p-1.5 text-text-dim hover:text-text-secondary transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
          >
            <Download size={12} />
          </button>
          <div className="h-3.5 w-px bg-border mx-1" />
          {artboards.length > 0 && (
            <>
              <button onClick={fitAll} title="Fit all frames" className="rounded p-1.5 text-text-dim hover:text-text-secondary transition-colors">
                <Maximize2 size={12} />
              </button>
              <div className="h-3.5 w-px bg-border mx-1" />
            </>
          )}
          <button onClick={zoomOut} className="rounded p-1.5 text-text-dim hover:text-text-secondary transition-colors">
            <ZoomOut size={12} />
          </button>
          <button
            onClick={zoom100}
            className="min-w-[40px] text-center text-2xs text-text-dim hover:text-text-secondary transition-colors tabular-nums"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button onClick={zoomIn} className="rounded p-1.5 text-text-dim hover:text-text-secondary transition-colors">
            <ZoomIn size={12} />
          </button>
        </div>
      </div>

      {/* ── Body ── */}
      <div className="flex flex-1 min-h-0 overflow-hidden">

        {/* Layers sidebar */}
        {showLayers && (
          <div className="w-44 flex-shrink-0 border-r border-border bg-surface-1 flex flex-col overflow-hidden">
            <div className="px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-text-dim border-b border-border flex-shrink-0">
              Frames
            </div>
            <div className="flex-1 overflow-y-auto">
              {artboards.length === 0 ? (
                <div className="px-3 py-6 text-center">
                  <Palette size={18} className="mx-auto mb-2 text-text-dim opacity-25" />
                  <div className="text-[11px] text-text-dim opacity-40 leading-relaxed">
                    No frames yet
                  </div>
                </div>
              ) : (
                artboards.map(ab => {
                  const badge = MODE_BADGE[ab.mode]
                  return (
                    <button
                      key={ab.id}
                      onClick={() => { setSelectedId(ab.id); scrollToAb(ab) }}
                      onDoubleClick={() => openEditor(ab)}
                      className={clsx(
                        'w-full text-left px-3 py-2 border-b border-border/40 transition-colors',
                        selectedId === ab.id
                          ? 'bg-accent/10 text-accent'
                          : 'text-text-secondary hover:bg-surface-2 hover:text-text-primary'
                      )}
                    >
                      <div className="flex items-center gap-1.5 min-w-0">
                        <Palette size={10} className="flex-shrink-0 opacity-50" />
                        <span className="truncate text-[11px] font-medium flex-1">{ab.name}</span>
                        <span className={clsx('text-[9px] font-mono px-1 rounded flex-shrink-0', badge.classes)}>
                          {badge.label}
                        </span>
                      </div>
                      <div className="text-[10px] text-text-dim mt-0.5 pl-4">{ab.width}×{ab.height}</div>
                    </button>
                  )
                })
              )}
            </div>
          </div>
        )}

        {/* Canvas viewport */}
        <div
          ref={viewportRef}
          className="flex-1 min-w-0 overflow-hidden relative select-none"
          style={{
            backgroundImage: `
              linear-gradient(rgba(255,255,255,0.035) 1px, transparent 1px),
              linear-gradient(90deg, rgba(255,255,255,0.035) 1px, transparent 1px)
            `,
            backgroundSize: `${GRID * zoom}px ${GRID * zoom}px`,
            backgroundPosition: `${pan.x % (GRID * zoom)}px ${pan.y % (GRID * zoom)}px`,
          }}
          onWheel={onWheel}
          onMouseDown={onViewportMouseDown}
          onClick={e => { if (e.target === viewportRef.current) { setSelectedId(null); setShowPresets(false) } }}
        >
          {/* Empty state */}
          {artboards.length === 0 && !globalLoading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none gap-3">
              <Palette size={36} className="text-text-dim opacity-15" />
              <div className="text-sm font-medium text-text-dim opacity-30">Monet Canvas</div>
              <div className="text-xs text-text-dim opacity-20">Click &ldquo;New Frame&rdquo; to get started</div>
            </div>
          )}

          {/* Global loading overlay — shown only for set-loading with no specific frame ID */}
          {globalLoading && <CanvasLoadingOverlay message={globalLoadingMsg} />}

          {/* Canvas transform root */}
          <div
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              transformOrigin: '0 0',
              transform: `translate(${pan.x}px,${pan.y}px) scale(${zoom})`,
            }}
          >
            {artboards.map(ab => (
              <div
                key={ab.id}
                style={{ position: 'absolute', left: ab.x, top: ab.y, width: ab.width, height: ab.height }}
              >
                {/* Name label */}
                <div
                  style={{
                    position: 'absolute',
                    top: -26,
                    left: 0,
                    fontSize: Math.max(11, 12 / zoom),
                    color: selectedId === ab.id ? 'rgba(99,179,237,0.85)' : 'rgba(255,255,255,0.3)',
                    fontFamily: 'Inter, sans-serif',
                    fontWeight: 500,
                    whiteSpace: 'nowrap',
                    userSelect: 'none',
                    pointerEvents: 'none',
                    lineHeight: 1,
                  }}
                >
                  {ab.name}
                  {ab.mode !== 'html' && (
                    <span style={{
                      marginLeft: 6,
                      fontSize: Math.max(9, 10 / zoom),
                      color: ab.mode === 'paperjs' ? 'rgba(147,197,253,0.7)' : 'rgba(134,239,172,0.7)',
                      fontFamily: 'monospace',
                    }}>
                      [{ab.mode === 'paperjs' ? 'pjs' : 'mjs'}]
                    </span>
                  )}
                </div>

                {/* Artboard frame */}
                <div
                  onClick={e => { e.stopPropagation(); setSelectedId(ab.id); setShowPresets(false) }}
                  onDoubleClick={e => { e.stopPropagation(); openEditor(ab) }}
                  style={{
                    width: ab.width,
                    height: ab.height,
                    overflow: 'hidden',
                    position: 'relative',
                    background: '#111',
                    cursor: 'default',
                    outline: selectedId === ab.id
                      ? '2px solid rgba(99,179,237,0.8)'
                      : editingId === ab.id
                      ? '2px solid rgba(99,179,237,0.4)'
                      : 'none',
                    outlineOffset: 1,
                    boxShadow: selectedId === ab.id
                      ? '0 20px 80px rgba(0,0,0,0.7), 0 0 0 1px rgba(99,179,237,0.2)'
                      : '0 8px 40px rgba(0,0,0,0.6)',
                  }}
                >
                  {(editingId === ab.id ? (ab.mode === 'html' ? liveHtml : editScript) : hasContent(ab)) ? (
                    <iframe
                      key={`${ab.id}-${editingId === ab.id ? 'live' : 'saved'}-${ab.mode}`}
                      ref={el => { if (el) iframeRefs.current.set(ab.id, el); else iframeRefs.current.delete(ab.id) }}
                      data-frame-id={ab.id}
                      srcDoc={getArtboardSrcDoc(ab, liveHtml, editHtml, editScript, editingId)}
                      style={{ width: ab.width, height: ab.height, border: 'none', display: 'block', pointerEvents: 'none' }}
                      sandbox="allow-scripts allow-same-origin"
                      title={ab.name}
                    />
                  ) : (
                    <div style={{
                      width: '100%', height: '100%',
                      display: 'flex', flexDirection: 'column',
                      alignItems: 'center', justifyContent: 'center',
                      gap: 8, background: '#111',
                    }}>
                      <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.18)', fontFamily: 'Inter,sans-serif' }}>Empty frame</div>
                      <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.1)', fontFamily: 'Inter,sans-serif' }}>Double-click to edit</div>
                    </div>
                  )}
                  {/* Per-artboard loading overlay — sits above the iframe, scales with zoom */}
                  {loadingFrameIds.has(ab.id) && <ArtboardLoadingOverlay />}
                </div>

                {/* Size label */}
                <div style={{
                  position: 'absolute', bottom: -20, right: 0,
                  fontSize: 11, color: 'rgba(255,255,255,0.18)',
                  fontFamily: 'Inter,sans-serif', userSelect: 'none', pointerEvents: 'none',
                }}>
                  {ab.width}×{ab.height}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* ── Editor panel ── */}
        {editingId && editingAb && (
          <div className="w-96 flex-shrink-0 border-l border-border bg-surface-1 flex flex-col overflow-hidden">

            {/* Editor header */}
            <div className="flex items-center justify-between border-b border-border px-3 py-2 flex-shrink-0">
              <div className="flex items-center gap-2">
                <Code2 size={12} className="text-accent" />
                <span className="text-xs font-semibold text-text-primary">Frame Editor</span>
                <span className="text-[10px] text-text-dim bg-accent/10 border border-accent/20 rounded px-1.5 py-0.5">live preview</span>
              </div>
              <button onClick={() => setEditingId(null)} className="rounded p-1 text-text-dim hover:text-text-secondary transition-colors">
                <X size={13} />
              </button>
            </div>

            {/* Name + size */}
            <div className="border-b border-border px-3 py-2 flex-shrink-0 space-y-2">
              <input
                value={editName}
                onChange={e => setEditName(e.target.value)}
                className="w-full bg-transparent text-xs font-medium text-text-primary outline-none placeholder:text-text-dim"
                placeholder="Frame name"
              />
              <div className="flex items-center gap-2">
                <div className="flex items-center gap-1.5 flex-1">
                  <span className="text-[10px] text-text-dim w-3">W</span>
                  <input
                    type="number"
                    value={editW}
                    onChange={e => setEditW(parseInt(e.target.value) || 1280)}
                    className="flex-1 bg-surface-2 border border-border rounded px-2 py-0.5 text-xs text-text-primary outline-none focus:border-accent/50 [appearance:textfield]"
                  />
                </div>
                <div className="flex items-center gap-1.5 flex-1">
                  <span className="text-[10px] text-text-dim w-3">H</span>
                  <input
                    type="number"
                    value={editH}
                    onChange={e => setEditH(parseInt(e.target.value) || 720)}
                    className="flex-1 bg-surface-2 border border-border rounded px-2 py-0.5 text-xs text-text-primary outline-none focus:border-accent/50 [appearance:textfield]"
                  />
                </div>
                <select
                  onChange={e => {
                    const p = PRESETS[parseInt(e.target.value)]
                    if (p) { setEditW(p.w); setEditH(p.h) }
                    e.target.value = ''
                  }}
                  defaultValue=""
                  className="bg-surface-2 border border-border rounded px-1.5 py-0.5 text-[10px] text-text-dim outline-none cursor-pointer"
                >
                  <option value="" disabled>preset</option>
                  {PRESETS.map((p, i) => (
                    <option key={p.label} value={i}>{p.label}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Mode selector */}
            <div className="border-b border-border px-3 py-2 flex-shrink-0">
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-text-dim mr-1">Mode:</span>
                {(['html', 'paperjs', 'matterjs'] as ArtboardMode[]).map(m => (
                  <button
                    key={m}
                    onClick={() => setEditMode(m)}
                    className={clsx(
                      'px-2 py-0.5 text-[10px] font-medium rounded transition-colors',
                      editMode === m
                        ? m === 'html'
                          ? 'bg-surface-3 text-text-primary'
                          : m === 'paperjs'
                          ? 'bg-blue-900/60 text-blue-200'
                          : 'bg-green-900/60 text-green-200'
                        : 'text-text-dim hover:text-text-secondary hover:bg-surface-2'
                    )}
                  >
                    {m === 'html' ? 'HTML' : m === 'paperjs' ? 'Paper.js' : 'Matter.js'}
                  </button>
                ))}
              </div>
            </div>

            {/* Editor textarea */}
            <div className="flex-1 min-h-0 overflow-hidden relative">
              {editMode === 'html' ? (
                <textarea
                  value={editHtml}
                  onChange={e => setEditHtml(e.target.value)}
                  placeholder={`<div style="width:${editingAb.width}px;height:${editingAb.height}px;background:#000;display:flex;align-items:center;justify-content:center;">\n  <!-- your design -->\n</div>`}
                  className="absolute inset-0 w-full h-full resize-none bg-[#0d0d0f] px-3 py-3 text-[11px] text-text-primary outline-none leading-relaxed placeholder:text-text-dim border-0"
                  spellCheck={false}
                  style={{ fontFamily: 'Menlo, Monaco, SF Mono, Consolas, monospace', tabSize: 2, lineHeight: 1.65 }}
                  onKeyDown={e => {
                    if (e.key === 'Tab') {
                      e.preventDefault()
                      const s = e.currentTarget.selectionStart
                      const end = e.currentTarget.selectionEnd
                      const v = editHtml.substring(0, s) + '  ' + editHtml.substring(end)
                      setEditHtml(v)
                      requestAnimationFrame(() => { e.currentTarget.selectionStart = e.currentTarget.selectionEnd = s + 2 })
                    }
                    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                      e.preventDefault()
                      saveEdit()
                    }
                  }}
                />
              ) : (
                <textarea
                  value={editScript}
                  onChange={e => setEditScript(e.target.value)}
                  placeholder={
                    editMode === 'paperjs'
                      ? `// Paper.js script\nvar circle = new Path.Circle({\n  center: view.center,\n  radius: 80,\n  fillColor: '#5b82f7'\n});\n// Animation:\n// view.onFrame = function(event) { circle.rotate(1); };`
                      : `// Matter.js scene\nvar ground = Bodies.rectangle(width/2, height-25, width, 50, { isStatic: true });\nComposite.add(engine.world, [ground]);\nengine.gravity.y = 1;`
                  }
                  className="absolute inset-0 w-full h-full resize-none bg-[#0d0d0f] px-3 py-3 text-[11px] text-text-primary outline-none leading-relaxed placeholder:text-text-dim border-0"
                  spellCheck={false}
                  style={{ fontFamily: 'Menlo, Monaco, SF Mono, Consolas, monospace', tabSize: 2, lineHeight: 1.65 }}
                  onKeyDown={e => {
                    if (e.key === 'Tab') {
                      e.preventDefault()
                      const s = e.currentTarget.selectionStart
                      const end = e.currentTarget.selectionEnd
                      const v = editScript.substring(0, s) + '  ' + editScript.substring(end)
                      setEditScript(v)
                      requestAnimationFrame(() => { e.currentTarget.selectionStart = e.currentTarget.selectionEnd = s + 2 })
                    }
                    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                      e.preventDefault()
                      saveEdit()
                    }
                  }}
                />
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between border-t border-border px-3 py-2 flex-shrink-0">
              <button
                onClick={() => {
                  if (!editingId) return
                  setArtboards(prev => prev.filter(a => a.id !== editingId))
                  setSelectedId(null)
                  setEditingId(null)
                }}
                className="text-[11px] text-red-400/60 hover:text-red-400 transition-colors"
              >
                Delete frame
              </button>
              <div className="flex items-center gap-2">
                <span className="text-[10px] text-text-dim">⌘↵ to apply</span>
                <button
                  onClick={() => setEditingId(null)}
                  className="rounded px-2.5 py-1 text-xs text-text-dim hover:text-text-secondary hover:bg-surface-2 transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={saveEdit}
                  className="flex items-center gap-1.5 rounded bg-accent px-3 py-1 text-xs font-medium text-white hover:opacity-90 transition-opacity"
                >
                  <Check size={11} />
                  Apply
                </button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Click-away to close presets */}
      {showPresets && (
        <div className="fixed inset-0 z-40" onClick={() => setShowPresets(false)} />
      )}
    </div>
  )
}
