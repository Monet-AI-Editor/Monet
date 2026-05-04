#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'fs'
import { request as httpRequest } from 'http'
import { dirname, join } from 'path'
import { tmpdir } from 'os'

const PORT_FILE = join(tmpdir(), 'monet-api-port')
const BASE_PORT = 51847
const MAX_PORT = 51857
import type { EditorProjectRecord, TimelineClipRecord, Effect } from '../shared/editor.js'

const PROJECT_FILE = resolveProjectFile()
const API_HOST_CANDIDATES = ['localhost', '127.0.0.1']

function resolveProjectFile(): string {
  if (process.env.AI_VIDEO_EDITOR_PROJECT) return process.env.AI_VIDEO_EDITOR_PROJECT

  const preferred = join(process.cwd(), 'project.aiveproj.json')
  if (existsSync(preferred)) return preferred

  const cwd = process.cwd()
  try {
    const candidates = readdirSync(cwd)
      .filter((entry) => entry.endsWith('.aiveproj.json'))
      .map((entry) => {
        const path = join(cwd, entry)
        return {
          path,
          mtimeMs: statSync(path).mtimeMs
        }
      })
      .sort((left, right) => right.mtimeMs - left.mtimeMs)

    if (candidates.length > 0) return candidates[0].path
  } catch {
    // Fall through to the historical default path below.
  }

  return preferred
}

function readJsonArgument(input: string): unknown {
  const raw = input.startsWith('@') ? readFileSync(input.slice(1), 'utf8') : input
  return JSON.parse(raw)
}

async function probeLiveAppOnPort(host: string, port: number): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const request = httpRequest(
      {
        host,
        port,
        path: '/help',
        method: 'GET',
        timeout: 900
      },
      (response) => {
        let body = ''
        response.setEncoding('utf8')
        response.on('data', (chunk) => { body += chunk })
        response.on('end', () => {
          try {
            if (!response.statusCode || response.statusCode < 200 || response.statusCode >= 300) {
              resolve(false)
              return
            }
            const data = JSON.parse(body)
            resolve(data?.success === true)
          } catch {
            resolve(false)
          }
        })
      }
    )

    request.on('error', () => resolve(false))
    request.on('timeout', () => {
      request.destroy()
      resolve(false)
    })
    request.end()
  })
}

async function resolveLiveAppHost(): Promise<{ host: string; port: number } | null> {
  // Try the port written by the app first (fastest — avoids scanning)
  try {
    const savedPort = parseInt(readFileSync(PORT_FILE, 'utf8').trim(), 10)
    if (savedPort >= BASE_PORT && savedPort <= MAX_PORT) {
      for (const host of API_HOST_CANDIDATES) {
        if (await probeLiveAppOnPort(host, savedPort)) return { host, port: savedPort }
      }
    }
  } catch { /* port file doesn't exist yet */ }

  // Scan the port range to find whichever Monet instance is ours
  for (let port = BASE_PORT; port <= MAX_PORT; port++) {
    for (const host of API_HOST_CANDIDATES) {
      if (await probeLiveAppOnPort(host, port)) return { host, port }
    }
  }
  return null
}

async function checkLiveApp(): Promise<boolean> {
  return (await resolveLiveAppHost()) !== null
}

async function callLiveApp(command: string, args: any = {}): Promise<any> {
  const endpoint = await resolveLiveAppHost()
  if (!endpoint) {
    throw new Error('Monet live app is not reachable')
  }

  const response = await fetch(`http://${endpoint.host}:${endpoint.port}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command, args })
  })

  const data = await response.json()
  if (!data.success) {
    throw new Error(data.error || 'Command failed')
  }
  return data.result
}

function loadProject(): EditorProjectRecord {
  try {
    const raw = readFileSync(PROJECT_FILE, 'utf8')
    return JSON.parse(raw)
  } catch {
    console.error(`Failed to load project from ${PROJECT_FILE}`)
    const parentDirectory = dirname(PROJECT_FILE)
    if (parentDirectory === process.cwd()) {
      console.error('No live Monet app was detected, and file mode could not find a usable project file in the current directory.')
      console.error('Open the running Monet app or run this command from a directory that contains a .aiveproj.json file.')
    }
    process.exit(1)
  }
}

function saveProject(project: EditorProjectRecord): void {
  writeFileSync(PROJECT_FILE, JSON.stringify(project, null, 2), 'utf8')
}

function parseKeyValueOptions(values: string[]): Record<string, string> {
  const options: Record<string, string> = {}
  for (const value of values) {
    const separatorIndex = value.indexOf('=')
    if (separatorIndex <= 0) continue
    options[value.slice(0, separatorIndex).trim()] = value.slice(separatorIndex + 1).trim()
  }
  return options
}

function parseOptionalNumber(value: string | undefined): number | undefined {
  if (value == null || value === '') return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}

function showHelp(): void {
  console.log(`
editorctl - Monet CLI Control

USAGE:
  editorctl <command> [options]

COMMANDS:
  list-assets              List all imported assets
  list-sequences           List all sequences
  list-tracks [seqId]      List tracks in sequence (defaults to active)
  list-clips [seqId]       List clips in sequence (defaults to active)
  list-markers [seqId]     List markers in sequence (defaults to active)
  get-state               Get current playhead/selection state

  import <path1> [path2...]
                          Import media files into project

  add-clip <assetId> <trackId> <startTime> [duration] [inPoint]
                          Add clip to timeline

  split-clip <clipId> <time>
                          Split clip at time

  move-clip <clipId> <newStartTime>
                          Move clip to new timeline position

  trim-clip <clipId> [inPoint] [duration] [startTime]
                          Trim clip timing fields

  remove-clip <clipId>    Remove clip from timeline
  ripple-delete-clip <clipId>
                          Remove clip and close the resulting gap across the sequence
  ripple-insert-gap <time> <duration> [seqId]
                          Insert a gap and push later clips/markers to the right

  add-track <kind>        Add track (video|audio|caption)

  activate-sequence <sequenceId>
                          Make a sequence active
  set-sequence-size <width> <height> [sequenceId]
                          Set sequence canvas size (defaults to active sequence)
  add-marker <time> <label> [duration] [color] [seqId]
                          Add a timeline marker
  remove-marker <markerId> [seqId]
                          Remove a marker
  set-playhead <time>      Set playhead time in seconds
  select-clip <clipId|none>
                          Set selected clip
  select-asset <assetId|none>
                          Set selected asset

  duplicate-clip <clipId> [offsetSeconds]
                          Duplicate a clip after itself

  rename-clip <clipId> <label>
                          Update clip label

  set-transition <clipId> <side> <type|null> [duration]
                          Set transition on clip side (in|out)

  add-effect <clipId> <effectType> [key=value...]
                          Add effect (fade_in, fade_out, color_grade, blur, sharpen, transform, opacity, blend_mode, text_overlay)

  set-effect-keyframes <clipId> <effectId> <json>
                          Set effect keyframes from a JSON array

  set-speed <clipId> <speed>
                          Set playback speed (0.1 to 10)

  set-volume <clipId> <volume>
                          Set volume (0 to 2)

  remove-effect <clipId> <effectId>
                          Remove an effect from a clip

  create-sequence <name> [width] [height]
                          Create a new sequence and activate it
  delete-sequence <sequenceId>
                          Delete a sequence (cannot delete the only one)
  undo                    Undo the last project change
  redo                    Redo the last undone change

  transcribe <assetId> [language]
                          Transcribe audio with Whisper
  generate-captions <assetId> [seqId]
                          Create caption clips from transcript segments

  get-asset-segments <assetId>
                          List searchable segments for an asset

  search-media <query> [limit]
                          Semantic search over assets (uses embeddings if available)
  search-spoken <query> [limit]
                          Substring search within transcripts (run transcribe first)
  embed-assets [all]      Generate embeddings for assets/segments (pass 'all' to re-embed)

  search-segments <query> [limit]
                          Search time-based segments across the project
  batch-selects <query> [limit] [padding] [sequenceName]
                          Build a selects sequence from semantic search matches
  batch-markers <query> [limit] [seqId]
                          Create markers from semantic search matches

  extract-frames <assetId> [count]
                          Extract representative frames for a video asset

  contact-sheet <assetId> [count]
                          Create a contact sheet image for a video asset

  generate-image <prompt> [size] [quality] [background] [format] [key=value...]
                          Generate an image with OpenAI and import it into the current project
  edit-image <prompt> <input1> [input2...] [key=value...]
                          Edit one or more images with OpenAI and import the result into the current project

  export <outputPath> [quality] [resolution] [format]
                          Export active sequence (quality: draft|standard|high, resolution: 720p|1080p|4k, format: mp4|mov)

CANVAS COMMANDS (Monet Canvas tab — requires live app):
  canvas-frames            List all canvas artboard frames
  canvas-add-frame <name> <width> <height> [mode]
                          Add a new frame (mode: paperjs|matterjs|html, default: paperjs)
  canvas-run-paperjs <frameId> <script>
                          Set Paper.js script on a frame. Full Paper.js API available.
                          Variables in scope: frame, fps, width, height
                          API: Path, Shape, Group, PointText, Raster, Color, Gradient,
                               view, project, layer — all Paper.js globals
  canvas-run-matterjs <frameId> <script>
                          Set Matter.js physics scene on a frame.
                          Pre-destructured: Engine, Render, Runner, Bodies, Body,
                          Composite, World, Constraint, Events, Mouse, MouseConstraint
                          Variables: width, height, engine, render
  canvas-run-html <frameId> <html>
                          Set the HTML content of an existing canvas frame
                          (mode flips to html). Use for static HTML/CSS scenes.
  canvas-update-frame <frameId> [name=<name>] [width=<w>] [height=<h>]
                          Update frame metadata
  canvas-select-frame <frameId|none>
                          Select (or clear selection of) a canvas frame
  canvas-delete-frame <frameId>
                          Delete a canvas frame
  canvas-clear            Remove all canvas frames
  canvas-set-zoom <zoom>  Set canvas zoom (e.g. 0.5, 1.0, 2.0)
  canvas-export <path>    Export entire canvas to a JSON file (state backup)
  canvas-import <path>    Import frames from a JSON file (adds to current canvas, doesn't replace)
  canvas-render-png <frameId> <outputPath.png>
                          Render a paperjs/matterjs frame as a PNG file

NOTE: Auto-detects running app and uses live connection when available.
      Falls back to file I/O if app is not running.

EXAMPLES:
  editorctl import ~/Videos/clip1.mp4 ~/Videos/clip2.mp4
  editorctl list-clips
  editorctl list-markers
  editorctl list-tracks
  editorctl get-state
  editorctl set-sequence-size 1080 1920
  editorctl add-clip asset_123 track_video_0 0 5.5
  editorctl move-clip clip_456 12.5
  editorctl trim-clip clip_456 3.0 5.0
  editorctl set-playhead 12.5
  editorctl add-effect clip_456 fade_in duration=1.5
  editorctl set-effect-keyframes clip_456 effect_123 '[{"time":0,"parameters":{"x":0}},{"time":2,"easing":"ease_in_out","parameters":{"x":200}}]'
  editorctl set-speed clip_456 0.5
  editorctl rename-clip clip_456 "Hook"
  editorctl transcribe asset_123 en
  editorctl search-segments "pricing"
  editorctl batch-selects "customer quote" 8 0.5 "Best Quotes"
  editorctl extract-frames asset_123 8
  editorctl generate-image "Minimal black hero shot of a laptop on a white plinth" 1536x1024 high opaque png moderation=low outputCompression=90
  editorctl edit-image "Remove the background and center the product" asset_123 background=transparent format=png inputFidelity=high
  editorctl export ~/Desktop/output.mov high 4k mov

  editorctl canvas-frames
  editorctl canvas-add-frame "Paper Layout" 1440 900 paperjs
  editorctl canvas-add-frame "Physics Demo" 1280 720 matterjs
  editorctl canvas-run-matterjs frame_123 "var ball = Bodies.circle(640, 50, 40, { restitution: 0.9 }); Composite.add(engine.world, [ball]);"
  editorctl canvas-run-paperjs frame_456 "var c = new Path.Circle({ center: view.center, radius: 100, fillColor: '#5b82f7' });"
`)
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  if (args.length === 0 || args[0] === 'help' || args[0] === '--help') {
    showHelp()
    return
  }

  const command = args[0]
  const useLive = await checkLiveApp()

  if (useLive) {
    console.error('[live mode]')
  } else {
    console.error('[file mode]')
  }

  // Commands that work in live mode
  if (useLive) {
    try {
      switch (command) {
        case 'list-assets': {
          const assets = await callLiveApp('list_assets')
          console.log(JSON.stringify(assets, null, 2))
          return
        }

        case 'get-state': {
          const state = await callLiveApp('get_control_state')
          // activeView may be missing from old app builds — read temp file as source of truth
          if (!(state as any).activeView) {
            try {
              const tmpPath = join(tmpdir(), 'monet-active-view')
              ;(state as any).activeView = readFileSync(tmpPath, 'utf8').trim() || 'editor'
            } catch {
              ;(state as any).activeView = 'editor'
            }
          }
          if ((state as any).activeView === 'canvas') {
            console.error(`
╔══════════════════════════════════════════════════════════════════════╗
║  ⚠️  CANVAS MODE ACTIVE                                              ║
║                                                                      ║
║  The user is looking at the Monet Canvas drawing board, NOT the      ║
║  video editor timeline.                                              ║
║                                                                      ║
║  DO:   ask whether the user wants Paper.js, Matter.js, or GPT image  ║
║        editorctl canvas-loading "…"                                  ║
║        editorctl canvas-add-frame <name> <w> <h> paperjs|matterjs    ║
║        editorctl canvas-done                                         ║
║                                                                      ║
║  OPTION A — Draw in canvas (Paper.js / Matter.js / HTML):            ║
║    editorctl canvas-loading "…"                                      ║
║    editorctl canvas-add-frame <name> <w> <h> paperjs|matterjs|html  ║
║    editorctl canvas-run-paperjs <id> "<script>"                      ║
║    editorctl canvas-done                                             ║
║                                                                      ║
║  OPTION B — Generate image (GPT image → canvas + media library):     ║
║    editorctl generate-image "<prompt>" [size] [quality]              ║
║    editorctl canvas-add-image "<absolute/path/to/output.png>"        ║
║                                                                      ║
║  ASK the user which they want before doing anything.                 ║
║  DO NOT use: npx remotion render  •  editorctl import (use above)   ║
╚══════════════════════════════════════════════════════════════════════╝
`)
          }
          console.log(JSON.stringify(state, null, 2))
          return
        }

        case 'list-sequences': {
          const sequences = await callLiveApp('list_sequences')
          console.log(JSON.stringify(sequences, null, 2))
          return
        }

        case 'list-clips': {
          const sequenceId = args[1]
          const clips = await callLiveApp('list_clips', { sequenceId })
          console.log(JSON.stringify(clips, null, 2))
          return
        }

        case 'list-tracks': {
          const sequenceId = args[1]
          const tracks = await callLiveApp('get_tracks', { sequenceId })
          console.log(JSON.stringify(tracks, null, 2))
          return
        }

        case 'list-markers': {
          const sequenceId = args[1]
          const markers = await callLiveApp('list_markers', { sequenceId })
          console.log(JSON.stringify(markers, null, 2))
          return
        }

        case 'import': {
          const paths = args.slice(1)
          if (paths.length === 0) {
            console.error('Usage: editorctl import <path1> [path2...]')
            process.exit(1)
          }
          const result = await callLiveApp('import_files', { paths })
          console.log(`Imported ${result.length} files`)
          return
        }

        case 'add-clip': {
          const [, assetId, trackId, startTimeStr, durationStr, inPointStr] = args
          if (!assetId || !trackId || !startTimeStr) {
            console.error('Usage: editorctl add-clip <assetId> <trackId> <startTime> [duration] [inPoint]')
            process.exit(1)
          }

          const result = await callLiveApp('add_clip', {
            assetId,
            trackId,
            startTime: parseFloat(startTimeStr),
            duration: durationStr ? parseFloat(durationStr) : undefined,
            inPoint: inPointStr ? parseFloat(inPointStr) : undefined
          })
          console.log(`Added clip ${result.clipId}`)
          return
        }

        case 'split-clip': {
          const [, clipId, timeStr] = args
          if (!clipId || !timeStr) {
            console.error('Usage: editorctl split-clip <clipId> <time>')
            process.exit(1)
          }

          await callLiveApp('split_clip', { clipId, time: parseFloat(timeStr) })
          console.log(`Split clip ${clipId}`)
          return
        }

        case 'move-clip': {
          const [, clipId, newStartTimeStr] = args
          if (!clipId || !newStartTimeStr) {
            console.error('Usage: editorctl move-clip <clipId> <newStartTime>')
            process.exit(1)
          }

          await callLiveApp('move_clip', { clipId, startTime: parseFloat(newStartTimeStr) })
          console.log(`Moved clip ${clipId} to ${newStartTimeStr}s`)
          return
        }

        case 'trim-clip': {
          const [, clipId, inPointStr, durationStr, startTimeStr] = args
          if (!clipId || (!inPointStr && !durationStr && !startTimeStr)) {
            console.error('Usage: editorctl trim-clip <clipId> [inPoint] [duration] [startTime]')
            process.exit(1)
          }

          const result = await callLiveApp('trim_clip', {
            clipId,
            inPoint: inPointStr !== undefined ? parseFloat(inPointStr) : undefined,
            duration: durationStr !== undefined ? parseFloat(durationStr) : undefined,
            startTime: startTimeStr !== undefined ? parseFloat(startTimeStr) : undefined
          })
          console.log(JSON.stringify(result, null, 2))
          return
        }

        case 'remove-clip': {
          const [, clipId] = args
          if (!clipId) {
            console.error('Usage: editorctl remove-clip <clipId>')
            process.exit(1)
          }

          await callLiveApp('remove_clip', { clipId })
          console.log(`Removed clip ${clipId}`)
          return
        }

        case 'set-effect-keyframes': {
          const [, clipId, effectId, json] = args
          if (!clipId || !effectId || !json) {
            console.error('Usage: editorctl set-effect-keyframes <clipId> <effectId> <json>')
            process.exit(1)
          }

          const keyframes = JSON.parse(json)
          const result = await callLiveApp('set_effect_keyframes', { clipId, effectId, keyframes })
          console.log(JSON.stringify(result, null, 2))
          return
        }

        case 'ripple-delete-clip': {
          const [, clipId] = args
          if (!clipId) {
            console.error('Usage: editorctl ripple-delete-clip <clipId>')
            process.exit(1)
          }
          await callLiveApp('ripple_delete_clip', { clipId })
          console.log(`Ripple deleted clip ${clipId}`)
          return
        }

        case 'ripple-insert-gap': {
          const [, timeStr, durationStr, sequenceId] = args
          if (!timeStr || !durationStr) {
            console.error('Usage: editorctl ripple-insert-gap <time> <duration> [seqId]')
            process.exit(1)
          }
          const result = await callLiveApp('ripple_insert_gap', {
            time: parseFloat(timeStr),
            duration: parseFloat(durationStr),
            sequenceId
          })
          console.log(JSON.stringify(result, null, 2))
          return
        }

        case 'add-track': {
          const [, kind] = args
          if (!kind) {
            console.error('Usage: editorctl add-track <video|audio|caption>')
            process.exit(1)
          }
          const result = await callLiveApp('add_track', { kind })
          console.log(JSON.stringify(result, null, 2))
          return
        }

        case 'create-sequence': {
          const [, name, widthStr, heightStr] = args
          if (!name) {
            console.error('Usage: editorctl create-sequence <name> [width] [height]')
            process.exit(1)
          }
          const result = await callLiveApp('create_sequence', {
            name,
            width: widthStr ? Number(widthStr) : undefined,
            height: heightStr ? Number(heightStr) : undefined
          })
          console.log(JSON.stringify(result, null, 2))
          return
        }

        case 'delete-sequence': {
          const [, sequenceId] = args
          if (!sequenceId) {
            console.error('Usage: editorctl delete-sequence <sequenceId>')
            console.error('  Cannot delete the only sequence in a project.')
            process.exit(1)
          }
          const result = await callLiveApp('delete_sequence', { sequenceId })
          console.log(JSON.stringify(result, null, 2))
          return
        }

        case 'activate-sequence': {
          const [, sequenceId] = args
          if (!sequenceId) {
            console.error('Usage: editorctl activate-sequence <sequenceId>')
            process.exit(1)
          }
          const result = await callLiveApp('activate_sequence', { sequenceId })
          console.log(JSON.stringify(result, null, 2))
          return
        }

        case 'set-sequence-size': {
          const [, widthStr, heightStr, sequenceId] = args
          if (!widthStr || !heightStr) {
            console.error('Usage: editorctl set-sequence-size <width> <height> [sequenceId]')
            process.exit(1)
          }

          const width = Number(widthStr)
          const height = Number(heightStr)
          if (!Number.isFinite(width) || !Number.isFinite(height)) {
            console.error('width and height must be numbers')
            process.exit(1)
          }

          const result = await callLiveApp('set_sequence_size', { width, height, sequenceId })
          console.log(JSON.stringify(result, null, 2))
          return
        }

        case 'add-marker': {
          const [, timeStr, label, durationStr, color, sequenceId] = args
          if (!timeStr || !label) {
            console.error('Usage: editorctl add-marker <time> <label> [duration] [color] [seqId]')
            process.exit(1)
          }
          const result = await callLiveApp('add_marker', {
            time: parseFloat(timeStr),
            label,
            duration: durationStr ? parseFloat(durationStr) : undefined,
            color,
            sequenceId
          })
          console.log(JSON.stringify(result, null, 2))
          return
        }

        case 'remove-marker': {
          const [, markerId, sequenceId] = args
          if (!markerId) {
            console.error('Usage: editorctl remove-marker <markerId> [seqId]')
            process.exit(1)
          }
          const result = await callLiveApp('remove_marker', { markerId, sequenceId })
          console.log(JSON.stringify(result, null, 2))
          return
        }

        case 'set-playhead': {
          const [, timeStr] = args
          if (!timeStr) {
            console.error('Usage: editorctl set-playhead <time>')
            process.exit(1)
          }
          const result = await callLiveApp('set_playhead', { time: parseFloat(timeStr) })
          console.log(JSON.stringify(result, null, 2))
          return
        }

        case 'select-clip': {
          const [, clipId] = args
          if (!clipId) {
            console.error('Usage: editorctl select-clip <clipId|none>')
            process.exit(1)
          }
          const result = await callLiveApp('select_clip', { clipId: clipId === 'none' ? null : clipId })
          console.log(JSON.stringify(result, null, 2))
          return
        }

        case 'select-asset': {
          const [, assetId] = args
          if (!assetId) {
            console.error('Usage: editorctl select-asset <assetId|none>')
            process.exit(1)
          }
          const result = await callLiveApp('select_asset', { assetId: assetId === 'none' ? null : assetId })
          console.log(JSON.stringify(result, null, 2))
          return
        }

        case 'duplicate-clip': {
          const [, clipId, offsetSecondsStr] = args
          if (!clipId) {
            console.error('Usage: editorctl duplicate-clip <clipId> [offsetSeconds]')
            process.exit(1)
          }
          const result = await callLiveApp('duplicate_clip', {
            clipId,
            offsetSeconds: offsetSecondsStr ? parseFloat(offsetSecondsStr) : undefined
          })
          console.log(JSON.stringify(result, null, 2))
          return
        }

        case 'rename-clip': {
          const [, clipId, ...labelParts] = args
          const label = labelParts.join(' ').trim()
          if (!clipId || !label) {
            console.error('Usage: editorctl rename-clip <clipId> <label>')
            process.exit(1)
          }
          await callLiveApp('update_clip_label', { clipId, label })
          console.log(`Renamed clip ${clipId} to "${label}"`)
          return
        }

        case 'set-transition': {
          const [, clipId, side, type, durationStr] = args
          if (!clipId || !side || !type) {
            console.error('Usage: editorctl set-transition <clipId> <in|out> <type|null> [duration]')
            process.exit(1)
          }
          const result = await callLiveApp('set_transition', {
            clipId,
            side,
            type: type === 'null' ? null : type,
            duration: durationStr ? parseFloat(durationStr) : undefined
          })
          console.log(JSON.stringify(result, null, 2))
          return
        }

        case 'add-effect': {
          const [, clipId, effectType, ...paramPairs] = args
          if (!clipId || !effectType) {
            console.error('Usage: editorctl add-effect <clipId> <effectType> [key=value...]')
            process.exit(1)
          }

          const parameters: Record<string, string | number | boolean> = {}
          for (const pair of paramPairs) {
            const [key, value] = pair.split('=')
            if (!key || value === undefined) continue
            if (value === 'true') parameters[key] = true
            else if (value === 'false') parameters[key] = false
            else if (!isNaN(parseFloat(value))) parameters[key] = parseFloat(value)
            else parameters[key] = value
          }

          if (effectType === 'fade_in' && !parameters.duration) parameters.duration = 1.0
          if (effectType === 'fade_out' && !parameters.duration) parameters.duration = 1.0

          await callLiveApp('add_effect', { clipId, effectType, parameters })
          console.log(`Added ${effectType} to clip ${clipId}`)
          return
        }

        case 'remove-effect': {
          const [, clipId, effectId] = args
          if (!clipId || !effectId) {
            console.error('Usage: editorctl remove-effect <clipId> <effectId>')
            process.exit(1)
          }
          await callLiveApp('remove_effect', { clipId, effectId })
          console.log(`Removed effect ${effectId} from clip ${clipId}`)
          return
        }

        case 'set-speed': {
          const [, clipId, speedStr] = args
          if (!clipId || !speedStr) {
            console.error('Usage: editorctl set-speed <clipId> <speed>')
            process.exit(1)
          }

          const speed = parseFloat(speedStr)
          await callLiveApp('set_speed', { clipId, speed })
          console.log(`Set clip ${clipId} speed to ${speed}x`)
          return
        }

        case 'set-volume': {
          const [, clipId, volumeStr] = args
          if (!clipId || !volumeStr) {
            console.error('Usage: editorctl set-volume <clipId> <volume>')
            process.exit(1)
          }

          const volume = parseFloat(volumeStr)
          await callLiveApp('set_volume', { clipId, volume })
          console.log(`Set clip ${clipId} volume to ${volume}`)
          return
        }

        case 'transcribe': {
          const [, assetId, language] = args
          if (!assetId) {
            console.error('Usage: editorctl transcribe <assetId> [language]')
            process.exit(1)
          }

          const result = await callLiveApp('transcribe_asset', { assetId, language })
          console.log(`Transcribed ${assetId}: ${result.segments.length} segments`)
          return
        }

        case 'generate-captions': {
          const [, assetId, sequenceId] = args
          if (!assetId) {
            console.error('Usage: editorctl generate-captions <assetId> [seqId]')
            process.exit(1)
          }
          const result = await callLiveApp('generate_captions', { assetId, sequenceId })
          console.log(JSON.stringify(result, null, 2))
          return
        }

        case 'get-asset-segments': {
          const [, assetId] = args
          if (!assetId) {
            console.error('Usage: editorctl get-asset-segments <assetId>')
            process.exit(1)
          }
          const result = await callLiveApp('get_asset_segments', { assetId })
          console.log(JSON.stringify(result, null, 2))
          return
        }

        case 'search-media': {
          const [, query, limitStr] = args
          if (!query) {
            console.error('Usage: editorctl search-media <query> [limit]')
            console.error('  Semantic search over assets (uses embeddings if available, keyword fallback otherwise).')
            process.exit(1)
          }
          const result = await callLiveApp('search_media', {
            query,
            limit: limitStr ? parseInt(limitStr, 10) : undefined
          })
          console.log(JSON.stringify(result, null, 2))
          return
        }

        case 'search-spoken': {
          const [, query, limitStr] = args
          if (!query) {
            console.error('Usage: editorctl search-spoken <query> [limit]')
            console.error('  Substring search within transcripts. Run `editorctl transcribe <assetId>` first.')
            process.exit(1)
          }
          const result = await callLiveApp('search_spoken', {
            query,
            limit: limitStr ? parseInt(limitStr, 10) : undefined
          })
          console.log(JSON.stringify(result, null, 2))
          return
        }

        case 'embed-assets': {
          const [, allArg] = args
          const all = allArg === 'all' || allArg === '--all' || allArg === 'true'
          const result = await callLiveApp('embed_assets', { all })
          console.log(JSON.stringify(result, null, 2))
          return
        }

        case 'search-segments': {
          const [, query, limitStr] = args
          if (!query) {
            console.error('Usage: editorctl search-segments <query> [limit]')
            process.exit(1)
          }
          const result = await callLiveApp('search_segments', {
            query,
            limit: limitStr ? parseInt(limitStr, 10) : undefined
          })
          console.log(JSON.stringify(result, null, 2))
          return
        }

        case 'batch-selects': {
          const [, query, limitStr, paddingStr, ...sequenceNameParts] = args
          if (!query) {
            console.error('Usage: editorctl batch-selects <query> [limit] [padding] [sequenceName]')
            process.exit(1)
          }
          const result = await callLiveApp('batch_selects_from_search', {
            query,
            limit: limitStr ? parseInt(limitStr, 10) : undefined,
            padding: paddingStr ? parseFloat(paddingStr) : undefined,
            sequenceName: sequenceNameParts.join(' ').trim() || undefined
          })
          console.log(JSON.stringify(result, null, 2))
          return
        }

        case 'batch-markers': {
          const [, query, limitStr, sequenceId] = args
          if (!query) {
            console.error('Usage: editorctl batch-markers <query> [limit] [seqId]')
            process.exit(1)
          }
          const result = await callLiveApp('batch_markers_from_search', {
            query,
            limit: limitStr ? parseInt(limitStr, 10) : undefined,
            sequenceId
          })
          console.log(JSON.stringify(result, null, 2))
          return
        }

        case 'extract-frames': {
          const [, assetId, countStr] = args
          if (!assetId) {
            console.error('Usage: editorctl extract-frames <assetId> [count]')
            process.exit(1)
          }
          const result = await callLiveApp('extract_frames', {
            assetId,
            count: countStr ? parseInt(countStr, 10) : undefined
          })
          console.log(JSON.stringify(result, null, 2))
          return
        }

        case 'contact-sheet': {
          const [, assetId, countStr] = args
          if (!assetId) {
            console.error('Usage: editorctl contact-sheet <assetId> [count]')
            process.exit(1)
          }
          const result = await callLiveApp('create_contact_sheet', {
            assetId,
            count: countStr ? parseInt(countStr, 10) : undefined
          })
          console.log(JSON.stringify(result, null, 2))
          return
        }

        case 'generate-image': {
          const [, prompt, size, quality, background, format, ...rest] = args
          if (!prompt) {
            console.error('Usage: editorctl generate-image <prompt> [size] [quality] [background] [format] [moderation=auto|low] [outputCompression=0-100] [partialImages=0-3]')
            process.exit(1)
          }
          const options = parseKeyValueOptions(rest)
          const result = await callLiveApp('generate_image', {
            prompt,
            size,
            quality,
            background,
            format,
            moderation: options.moderation,
            outputCompression: parseOptionalNumber(options.outputCompression),
            partialImages: parseOptionalNumber(options.partialImages)
          })
          console.log(JSON.stringify(result, null, 2))
          return
        }

        case 'edit-image': {
          const [, prompt, ...rest] = args
          if (!prompt) {
            console.error('Usage: editorctl edit-image <prompt> <input1> [input2...] [size=auto|1024x1024|1536x1024|1024x1536] [quality=auto|low|medium|high] [background=auto|opaque|transparent] [format=png|jpeg|webp] [outputCompression=0-100] [partialImages=0-3] [inputFidelity=low|high] [mask=<assetId|path>]')
            process.exit(1)
          }
          const inputs = rest.filter((value) => !value.includes('='))
          if (inputs.length === 0) {
            console.error('Usage: editorctl edit-image <prompt> <input1> [input2...] [key=value...]')
            process.exit(1)
          }
          const options = parseKeyValueOptions(rest.filter((value) => value.includes('=')))
          const result = await callLiveApp('edit_image', {
            prompt,
            inputs,
            size: options.size,
            quality: options.quality,
            background: options.background,
            format: options.format,
            outputCompression: parseOptionalNumber(options.outputCompression),
            partialImages: parseOptionalNumber(options.partialImages),
            inputFidelity: options.inputFidelity,
            mask: options.mask
          })
          console.log(JSON.stringify(result, null, 2))
          return
        }

        case 'export': {
          const [, outputPath, quality = 'high', resolution = '1080p', format = 'mp4'] = args
          if (!outputPath) {
            console.error('Usage: editorctl export <outputPath> [quality] [resolution] [format]')
            process.exit(1)
          }

          const result = await callLiveApp('export_sequence', { outputPath, quality, resolution, format })
          console.log(`Exported ${result.sequenceName} to ${result.outputPath}`)
          return
        }

        // ── Canvas commands ──────────────────────────────────────────────
        case 'canvas-frames': {
          const result = await callLiveApp('canvas-get-state', {})
          console.log(JSON.stringify(result, null, 2))
          return
        }

        case 'canvas-add-frame': {
          const [, name, widthStr, heightStr, mode = 'paperjs'] = args
          if (!name || !widthStr || !heightStr) {
            console.error('Usage: editorctl canvas-add-frame <name> <width> <height> [mode=paperjs|matterjs|html]')
            process.exit(1)
          }
          await callLiveApp('canvas-add-frame', {
            name,
            width: parseInt(widthStr, 10),
            height: parseInt(heightStr, 10),
            mode
          })
          console.log(`Added ${mode} frame: ${name}`)
          return
        }

        case 'canvas-add-design-frame': {
          const [, name, widthStr, heightStr, designArg] = args
          if (!name || !widthStr || !heightStr) {
            console.error('canvas-add-design-frame is no longer supported. Use canvas-add-frame with mode=paperjs or matterjs.')
            process.exit(1)
          }
          await callLiveApp('canvas-add-design-frame', {
            name,
            width: parseInt(widthStr, 10),
            height: parseInt(heightStr, 10),
            ...(designArg && { design: readJsonArgument(designArg) })
          })
          console.log(`Added design frame: ${name}`)
          return
        }

        case 'canvas-run-paperjs': {
          const [, frameId, ...scriptParts] = args
          const script = scriptParts.join(' ')
          if (!frameId || !script) {
            console.error('Usage: editorctl canvas-run-paperjs <frameId> <script>')
            console.error('  Script has access to: Path, Shape, Group, PointText, Color, Gradient, view, project, layer')
            console.error('  Example: editorctl canvas-run-paperjs frame_123 "new Path.Circle({ center: view.center, radius: 80, fillColor: \'#5b82f7\' });"')
            process.exit(1)
          }
          await callLiveApp('canvas-update-frame', { id: frameId, mode: 'paperjs', script })
          console.log(`Paper.js script applied to frame ${frameId}`)
          return
        }

        case 'canvas-run-matterjs': {
          const [, frameId, ...scriptParts] = args
          const script = scriptParts.join(' ')
          if (!frameId || !script) {
            console.error('Usage: editorctl canvas-run-matterjs <frameId> <script>')
            console.error('  Pre-available: Engine, Render, Runner, Bodies, Body, Composite, World, Constraint, Events')
            console.error('  Variables: width, height, engine, render')
            console.error('  Example: editorctl canvas-run-matterjs frame_123 "var b = Bodies.circle(640, 50, 40, { restitution: 0.9 }); Composite.add(engine.world, [b]);"')
            process.exit(1)
          }
          await callLiveApp('canvas-update-frame', { id: frameId, mode: 'matterjs', script })
          console.log(`Matter.js scene applied to frame ${frameId}`)
          return
        }

        case 'canvas-run-html': {
          const [, frameId, ...htmlParts] = args
          const html = htmlParts.join(' ')
          if (!frameId || !html) {
            console.error('Usage: editorctl canvas-run-html <frameId> <html>')
            console.error('  Sets the HTML content of an existing canvas frame.')
            console.error('  Example: editorctl canvas-run-html frame_123 "<h1 style=\'color:#fff\'>Hi</h1>"')
            process.exit(1)
          }
          await callLiveApp('canvas-update-frame', { id: frameId, mode: 'html', html })
          console.log(`HTML applied to frame ${frameId}`)
          return
        }

        case 'canvas-update-frame': {
          const [, frameId, ...kvPairs] = args
          if (!frameId) {
            console.error('Usage: editorctl canvas-update-frame <frameId> [name=<name>] [width=<w>] [height=<h>]')
            process.exit(1)
          }
          const opts = parseKeyValueOptions(kvPairs)
          await callLiveApp('canvas-update-frame', {
            id: frameId,
            ...(opts.name && { name: opts.name }),
            ...(opts.width && { width: parseInt(opts.width, 10) }),
            ...(opts.height && { height: parseInt(opts.height, 10) })
          })
          console.log(`Updated frame ${frameId}`)
          return
        }

        case 'canvas-update-design-frame': {
          const [, frameId, designArg] = args
          if (!frameId || !designArg) {
            console.error('Usage: editorctl canvas-update-design-frame <frameId> <@design.json|inline-json>')
            process.exit(1)
          }
          await callLiveApp('canvas-update-design-frame', {
            id: frameId,
            design: readJsonArgument(designArg)
          })
          console.log(`Updated design frame ${frameId}`)
          return
        }

        case 'canvas-select-frame': {
          const [, frameId] = args
          if (!frameId) {
            console.error('Usage: editorctl canvas-select-frame <frameId|none>')
            process.exit(1)
          }
          await callLiveApp('canvas_select_frame', { id: frameId === 'none' ? null : frameId })
          console.log(`Selected canvas frame: ${frameId}`)
          return
        }

        case 'undo': {
          const result = await callLiveApp('undo', {})
          console.log(JSON.stringify({ ok: true, projectId: (result as { id?: string })?.id }, null, 2))
          return
        }

        case 'redo': {
          const result = await callLiveApp('redo', {})
          console.log(JSON.stringify({ ok: true, projectId: (result as { id?: string })?.id }, null, 2))
          return
        }

        case 'canvas-delete-frame': {
          const [, frameId] = args
          if (!frameId) {
            console.error('Usage: editorctl canvas-delete-frame <frameId>')
            process.exit(1)
          }
          await callLiveApp('canvas-delete-frame', { id: frameId })
          console.log(`Deleted frame ${frameId}`)
          return
        }

        case 'canvas-clear': {
          await callLiveApp('canvas-clear', {})
          console.log('Canvas cleared')
          return
        }

        case 'canvas-set-zoom': {
          const [, zoomStr] = args
          if (!zoomStr) {
            console.error('Usage: editorctl canvas-set-zoom <zoom> (e.g. 0.5, 1.0, 2.0)')
            process.exit(1)
          }
          await callLiveApp('canvas-set-zoom', { zoom: parseFloat(zoomStr) })
          console.log(`Canvas zoom set to ${zoomStr}`)
          return
        }

        case 'canvas-loading': {
          const [, ...msgParts] = args
          const message = msgParts.join(' ') || 'Working…'
          await callLiveApp('canvas-set-loading', { message })
          return
        }

        case 'canvas-done': {
          await callLiveApp('canvas-clear-loading', {})
          return
        }

        case 'canvas-add-image': {
          const [, imagePath, widthStr, heightStr] = args
          if (!imagePath) {
            console.error('Usage: editorctl canvas-add-image <absoluteImagePath> [width] [height]')
            console.error('  Adds the image as a canvas frame AND imports it to the video editor media library.')
            process.exit(1)
          }
          const result = await callLiveApp('canvas-add-image', {
            imagePath,
            width: widthStr ? parseInt(widthStr, 10) : undefined,
            height: heightStr ? parseInt(heightStr, 10) : undefined,
          })
          console.log(JSON.stringify(result, null, 2))
          return
        }

        case 'canvas-render-png': {
          const [, frameId, outputPath] = args
          if (!frameId || !outputPath) {
            console.error('Usage: editorctl canvas-render-png <frameId> <absoluteOutputPath.png>')
            console.error('  Captures the rendered output of a paperjs/matterjs frame as a PNG file.')
            console.error('  Get frame IDs from `editorctl canvas-frames`.')
            process.exit(1)
          }
          const result = await callLiveApp('canvas-render-png', { frameId, outputPath })
          console.log(JSON.stringify(result, null, 2))
          return
        }

        case 'canvas-export': {
          const [, outputPath] = args
          if (!outputPath) {
            console.error('Usage: editorctl canvas-export <absolutePath.json>')
            console.error('  Exports the entire canvas (all frames) to a JSON file.')
            process.exit(1)
          }
          const result = await callLiveApp('canvas-export-to-path', { path: outputPath })
          console.log(JSON.stringify(result, null, 2))
          return
        }

        case 'canvas-import': {
          const [, inputPath] = args
          if (!inputPath) {
            console.error('Usage: editorctl canvas-import <absolutePath.json>')
            console.error('  Imports frames from a JSON file and ADDS them to the current canvas (existing frames are preserved).')
            process.exit(1)
          }
          const result = await callLiveApp('canvas-import-from-path', { path: inputPath })
          console.log(JSON.stringify(result, null, 2))
          return
        }
      }
    } catch (error) {
      console.error(`Error: ${error instanceof Error ? error.message : String(error)}`)
      process.exit(1)
    }
  }

  // Fallback to file mode for all commands
  const project = loadProject()

  switch (command) {
    case 'list-assets': {
      console.log(JSON.stringify(project.assets, null, 2))
      break
    }

    case 'list-sequences': {
      console.log(JSON.stringify(project.sequences, null, 2))
      break
    }

    case 'list-clips': {
      const seqId = args[1] || project.sequences.find(s => s.active)?.id || project.sequences[0]?.id
      const seq = project.sequences.find((s) => s.id === seqId)
      if (!seq) {
        console.error(`Sequence not found: ${seqId}`)
        process.exit(1)
      }
      const allClips = seq.tracks.flatMap((t) => t.clips)
      console.log(JSON.stringify(allClips, null, 2))
      break
    }

    case 'import': {
      console.error('Import requires live app connection')
      console.error('Start the app and try again')
      process.exit(1)
    }

    case 'transcribe': {
      console.error('Transcription requires live app connection')
      console.error('Start the app and try again')
      process.exit(1)
    }

    case 'generate-image': {
      console.error('Image generation requires live app connection')
      console.error('Start the app and try again')
      process.exit(1)
    }

    case 'edit-image': {
      console.error('Image editing requires live app connection')
      console.error('Start the app and try again')
      process.exit(1)
    }

    default:
      console.error(`Unknown command: ${command}`)
      console.error('Run "editorctl help" for usage')
      process.exit(1)
  }
}

main().catch((error) => {
  console.error(`Fatal error: ${error instanceof Error ? error.message : String(error)}`)
  process.exit(1)
})
