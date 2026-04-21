#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { EditorProjectRecord, TimelineClipRecord, Effect } from '../shared/editor.js'

const PROJECT_FILE = process.env.AI_VIDEO_EDITOR_PROJECT || join(process.cwd(), 'project.aiveproj.json')
const API_PORT = 51847

async function checkLiveApp(): Promise<boolean> {
  try {
    const response = await fetch(`http://localhost:${API_PORT}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command: 'ping' })
    })
    const data = await response.json()
    return data.success === true
  } catch {
    return false
  }
}

async function callLiveApp(command: string, args: any = {}): Promise<any> {
  const response = await fetch(`http://localhost:${API_PORT}`, {
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
    process.exit(1)
  }
}

function saveProject(project: EditorProjectRecord): void {
  writeFileSync(PROJECT_FILE, JSON.stringify(project, null, 2), 'utf8')
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

  transcribe <assetId> [language]
                          Transcribe audio with Whisper
  generate-captions <assetId> [seqId]
                          Create caption clips from transcript segments

  get-asset-segments <assetId>
                          List searchable segments for an asset

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

  export <outputPath> [quality] [resolution] [format]
                          Export active sequence (quality: draft|standard|high, resolution: 720p|1080p|4k, format: mp4|mov)

NOTE: Auto-detects running app and uses live connection when available.
      Falls back to file I/O if app is not running.

EXAMPLES:
  editorctl import ~/Videos/clip1.mp4 ~/Videos/clip2.mp4
  editorctl list-clips
  editorctl list-markers
  editorctl list-tracks
  editorctl get-state
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
  editorctl export ~/Desktop/output.mov high 4k mov
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
