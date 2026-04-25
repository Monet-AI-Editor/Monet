#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'
import { readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { execSync } from 'child_process'
import type { EditorProjectRecord, TimelineClipRecord, Effect } from '../shared/editor.js'

const PROJECT_FILE = process.env.AI_VIDEO_EDITOR_PROJECT || join(process.cwd(), 'project.aiveproj.json')
const API_PORT = 51847

async function callLiveApp(command: string, args: any = {}): Promise<any> {
  const response = await fetch(`http://localhost:${API_PORT}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command, args })
  })
  const data = await response.json()
  if (!data.success) throw new Error(data.error || `Command failed: ${command}`)
  return data.result
}

function loadProject(): EditorProjectRecord {
  try {
    const raw = readFileSync(PROJECT_FILE, 'utf8')
    return JSON.parse(raw)
  } catch {
    throw new Error(`Failed to load project from ${PROJECT_FILE}`)
  }
}

function saveProject(project: EditorProjectRecord): void {
  writeFileSync(PROJECT_FILE, JSON.stringify(project, null, 2), 'utf8')
}

const server = new Server(
  {
    name: 'monet-mcp',
    version: '1.0.0'
  },
  {
    capabilities: {
      tools: {}
    }
  }
)

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'video_editor_list_assets',
        description: 'List all imported video assets in the project',
        inputSchema: {
          type: 'object',
          properties: {},
          required: []
        }
      },
      {
        name: 'video_editor_get_state',
        description: 'Get current editor playhead and selection state',
        inputSchema: {
          type: 'object',
          properties: {},
          required: []
        }
      },
      {
        name: 'video_editor_list_clips',
        description: 'List all clips on the timeline for a sequence',
        inputSchema: {
          type: 'object',
          properties: {
            sequenceId: { type: 'string', description: 'Sequence ID (use first sequence if not specified)' }
          }
        }
      },
      {
        name: 'video_editor_list_tracks',
        description: 'List timeline tracks for a sequence',
        inputSchema: {
          type: 'object',
          properties: {
            sequenceId: { type: 'string', description: 'Sequence ID (use active sequence if omitted)' }
          }
        }
      },
      {
        name: 'video_editor_list_markers',
        description: 'List markers for a sequence',
        inputSchema: {
          type: 'object',
          properties: {
            sequenceId: { type: 'string', description: 'Sequence ID (use active sequence if omitted)' }
          }
        }
      },
      {
        name: 'video_editor_get_asset_segments',
        description: 'List searchable semantic segments for a specific asset',
        inputSchema: {
          type: 'object',
          properties: {
            assetId: { type: 'string', description: 'Asset ID' }
          },
          required: ['assetId']
        }
      },
      {
        name: 'video_editor_search_segments',
        description: 'Search time-based semantic segments across the project',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Search query' }
          },
          required: ['query']
        }
      },
      {
        name: 'video_editor_extract_frames',
        description: 'Extract representative frames for a video asset via the local API bridge',
        inputSchema: {
          type: 'object',
          properties: {
            assetId: { type: 'string', description: 'Asset ID' },
            count: { type: 'number', description: 'Number of frames to extract' }
          },
          required: ['assetId']
        }
      },
      {
        name: 'video_editor_create_contact_sheet',
        description: 'Create a contact sheet for a video asset via the local API bridge',
        inputSchema: {
          type: 'object',
          properties: {
            assetId: { type: 'string', description: 'Asset ID' },
            count: { type: 'number', description: 'Number of sampled frames' }
          },
          required: ['assetId']
        }
      },
      {
        name: 'video_editor_add_clip',
        description: 'Add a clip to the timeline',
        inputSchema: {
          type: 'object',
          properties: {
            assetId: { type: 'string', description: 'Asset ID to add' },
            trackId: { type: 'string', description: 'Track ID to add to' },
            startTime: { type: 'number', description: 'Timeline start time in seconds' },
            duration: { type: 'number', description: 'Clip duration in seconds (defaults to asset duration)' },
            inPoint: { type: 'number', description: 'In point in the source asset (default: 0)' }
          },
          required: ['assetId', 'trackId', 'startTime']
        }
      },
      {
        name: 'video_editor_split_clip',
        description: 'Split a clip at a specific time',
        inputSchema: {
          type: 'object',
          properties: {
            clipId: { type: 'string', description: 'Clip ID to split' },
            time: { type: 'number', description: 'Timeline time to split at (seconds)' }
          },
          required: ['clipId', 'time']
        }
      },
      {
        name: 'video_editor_remove_clip',
        description: 'Remove a clip from the timeline',
        inputSchema: {
          type: 'object',
          properties: {
            clipId: { type: 'string', description: 'Clip ID to remove' }
          },
          required: ['clipId']
        }
      },
      {
        name: 'video_editor_ripple_delete_clip',
        description: 'Remove a clip and close the resulting gap across the active sequence',
        inputSchema: {
          type: 'object',
          properties: {
            clipId: { type: 'string', description: 'Clip ID to remove with ripple' }
          },
          required: ['clipId']
        }
      },
      {
        name: 'video_editor_ripple_insert_gap',
        description: 'Insert a gap and push later clips and markers to the right',
        inputSchema: {
          type: 'object',
          properties: {
            time: { type: 'number', description: 'Gap start time in seconds' },
            duration: { type: 'number', description: 'Gap duration in seconds' },
            sequenceId: { type: 'string', description: 'Optional sequence ID' }
          },
          required: ['time', 'duration']
        }
      },
      {
        name: 'video_editor_move_clip',
        description: 'Move a clip to a new start time',
        inputSchema: {
          type: 'object',
          properties: {
            clipId: { type: 'string', description: 'Clip ID to move' },
            startTime: { type: 'number', description: 'New timeline start time in seconds' }
          },
          required: ['clipId', 'startTime']
        }
      },
      {
        name: 'video_editor_trim_clip',
        description: 'Trim clip in point, duration, or start time',
        inputSchema: {
          type: 'object',
          properties: {
            clipId: { type: 'string', description: 'Clip ID to trim' },
            inPoint: { type: 'number', description: 'New source in point in seconds' },
            duration: { type: 'number', description: 'New clip duration in seconds' },
            startTime: { type: 'number', description: 'New timeline start time in seconds' }
          },
          required: ['clipId']
        }
      },
      {
        name: 'video_editor_add_track',
        description: 'Add a video, audio, or caption track to the active sequence',
        inputSchema: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: ['video', 'audio', 'caption'], description: 'Track kind' }
          },
          required: ['kind']
        }
      },
      {
        name: 'video_editor_set_playhead',
        description: 'Set the playhead time in seconds',
        inputSchema: {
          type: 'object',
          properties: {
            time: { type: 'number', description: 'Playhead time in seconds' }
          },
          required: ['time']
        }
      },
      {
        name: 'video_editor_select_clip',
        description: 'Set the selected clip',
        inputSchema: {
          type: 'object',
          properties: {
            clipId: { type: 'string', description: 'Clip ID or null-like string to clear' }
          },
          required: ['clipId']
        }
      },
      {
        name: 'video_editor_select_asset',
        description: 'Set the selected asset',
        inputSchema: {
          type: 'object',
          properties: {
            assetId: { type: 'string', description: 'Asset ID or null-like string to clear' }
          },
          required: ['assetId']
        }
      },
      {
        name: 'video_editor_activate_sequence',
        description: 'Make a sequence active',
        inputSchema: {
          type: 'object',
          properties: {
            sequenceId: { type: 'string', description: 'Sequence ID' }
          },
          required: ['sequenceId']
        }
      },
      {
        name: 'video_editor_add_marker',
        description: 'Add a marker to the timeline',
        inputSchema: {
          type: 'object',
          properties: {
            time: { type: 'number', description: 'Marker time in seconds' },
            label: { type: 'string', description: 'Marker label' },
            duration: { type: 'number', description: 'Optional marker duration' },
            color: { type: 'string', description: 'Optional marker color label' },
            sequenceId: { type: 'string', description: 'Optional sequence ID' }
          },
          required: ['time', 'label']
        }
      },
      {
        name: 'video_editor_remove_marker',
        description: 'Remove a marker from the timeline',
        inputSchema: {
          type: 'object',
          properties: {
            markerId: { type: 'string', description: 'Marker ID' },
            sequenceId: { type: 'string', description: 'Optional sequence ID' }
          },
          required: ['markerId']
        }
      },
      {
        name: 'video_editor_duplicate_clip',
        description: 'Duplicate a clip after itself',
        inputSchema: {
          type: 'object',
          properties: {
            clipId: { type: 'string', description: 'Clip ID' },
            offsetSeconds: { type: 'number', description: 'Extra gap after the duplicated clip' }
          },
          required: ['clipId']
        }
      },
      {
        name: 'video_editor_rename_clip',
        description: 'Update a clip label',
        inputSchema: {
          type: 'object',
          properties: {
            clipId: { type: 'string', description: 'Clip ID' },
            label: { type: 'string', description: 'New clip label' }
          },
          required: ['clipId', 'label']
        }
      },
      {
        name: 'video_editor_set_transition',
        description: 'Set or clear a transition on the clip in/out side',
        inputSchema: {
          type: 'object',
          properties: {
            clipId: { type: 'string', description: 'Clip ID' },
            side: { type: 'string', enum: ['in', 'out'], description: 'Transition side' },
            type: { type: 'string', description: 'Transition type or null to clear' },
            duration: { type: 'number', description: 'Transition duration in seconds' }
          },
          required: ['clipId', 'side', 'type']
        }
      },
      {
        name: 'video_editor_add_effect',
        description: 'Add an effect to a clip (color_grade, blur, sharpen, fade_in, fade_out, speed_ramp, transform, opacity, blend_mode, text_overlay)',
        inputSchema: {
          type: 'object',
          properties: {
            clipId: { type: 'string', description: 'Clip ID to add effect to' },
            effectType: {
              type: 'string',
              enum: ['color_grade', 'blur', 'sharpen', 'fade_in', 'fade_out', 'speed_ramp', 'transform', 'opacity', 'blend_mode', 'text_overlay'],
              description: 'Type of effect'
            },
            parameters: { type: 'object', description: 'Effect-specific parameters (e.g., brightness, contrast, radius)' }
          },
          required: ['clipId', 'effectType', 'parameters']
        }
      },
      {
        name: 'video_editor_set_effect_keyframes',
        description: 'Set ordered keyframes on an existing effect for motion or opacity animation',
        inputSchema: {
          type: 'object',
          properties: {
            clipId: { type: 'string', description: 'Clip ID' },
            effectId: { type: 'string', description: 'Effect ID' },
            keyframes: { type: 'array', description: 'Array of keyframes with time, easing, and parameters' }
          },
          required: ['clipId', 'effectId', 'keyframes']
        }
      },
      {
        name: 'video_editor_set_clip_speed',
        description: 'Set the playback speed of a clip (0.1 to 10x)',
        inputSchema: {
          type: 'object',
          properties: {
            clipId: { type: 'string', description: 'Clip ID' },
            speed: { type: 'number', description: 'Speed multiplier (0.5 = 50%, 2 = 200%)' }
          },
          required: ['clipId', 'speed']
        }
      },
      {
        name: 'video_editor_set_clip_volume',
        description: 'Set the volume of a clip (0 to 2)',
        inputSchema: {
          type: 'object',
          properties: {
            clipId: { type: 'string', description: 'Clip ID' },
            volume: { type: 'number', description: 'Volume level (0 = silent, 1 = 100%, 2 = 200%)' }
          },
          required: ['clipId', 'volume']
        }
      },
      {
        name: 'video_editor_generate_captions',
        description: 'Create caption clips from transcript segments for an asset already used in the sequence',
        inputSchema: {
          type: 'object',
          properties: {
            assetId: { type: 'string', description: 'Asset ID with transcript data' },
            sequenceId: { type: 'string', description: 'Optional sequence ID' },
            replaceExisting: { type: 'boolean', description: 'Replace previous caption clips for this asset' },
            minDuration: { type: 'number', description: 'Minimum caption clip duration in seconds' }
          },
          required: ['assetId']
        }
      },
      {
        name: 'video_editor_batch_selects_from_search',
        description: 'Create a selects sequence from semantic search matches',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Semantic search query' },
            limit: { type: 'number', description: 'Maximum matches to use' },
            padding: { type: 'number', description: 'Padding around each source segment in seconds' },
            sequenceName: { type: 'string', description: 'Optional output sequence name' }
          },
          required: ['query']
        }
      },
      {
        name: 'video_editor_batch_markers_from_search',
        description: 'Create timeline markers from semantic search matches',
        inputSchema: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Semantic search query' },
            limit: { type: 'number', description: 'Maximum matches to convert to markers' },
            sequenceId: { type: 'string', description: 'Optional sequence ID' }
          },
          required: ['query']
        }
      },
      {
        name: 'video_editor_get_project_snapshot',
        description: 'Get complete project state including assets, sequences, clips, and metadata',
        inputSchema: {
          type: 'object',
          properties: {},
          required: []
        }
      },
      {
        name: 'video_editor_list_remotion_compositions',
        description: 'List available Remotion compositions that can be rendered',
        inputSchema: {
          type: 'object',
          properties: {},
          required: []
        }
      },
      {
        name: 'video_editor_render_remotion',
        description: 'Render a Remotion composition to a video file and auto-import it as a project asset',
        inputSchema: {
          type: 'object',
          properties: {
            compositionId: { type: 'string', description: 'Composition ID (e.g. TitleCard, Slideshow)' },
            outputFilename: { type: 'string', description: 'Output filename without extension (default: compositionId-timestamp)' },
            props: { type: 'object', description: 'Props to pass to the composition (overrides defaultProps)' },
            durationInFrames: { type: 'number', description: 'Override composition duration in frames' },
            fps: { type: 'number', description: 'Override frames per second (default: 30)' }
          },
          required: ['compositionId']
        }
      },
      {
        name: 'video_editor_render_remotion_still',
        description: 'Render a single frame from a Remotion composition as a PNG and auto-import it as a project asset',
        inputSchema: {
          type: 'object',
          properties: {
            compositionId: { type: 'string', description: 'Composition ID' },
            frame: { type: 'number', description: 'Frame number to render (default: 0)' },
            outputFilename: { type: 'string', description: 'Output filename without extension' },
            props: { type: 'object', description: 'Props to pass to the composition' }
          },
          required: ['compositionId']
        }
      }
    ]
  }
})

// Handle tool execution
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params

  try {
    const project = loadProject()

    switch (name) {
      case 'video_editor_list_assets': {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(project.assets, null, 2)
            }
          ]
        }
      }

      case 'video_editor_get_state': {
        const result = await callLiveApp('get_control_state')
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
        }
      }

      case 'video_editor_list_clips': {
        const seqId = (args?.sequenceId as string) || project.sequences.find((s) => s.active)?.id || project.sequences[0]?.id
        const seq = project.sequences.find((s) => s.id === seqId)
        if (!seq) throw new Error(`Sequence not found: ${seqId}`)

        const allClips = seq.tracks.flatMap((t) => t.clips)
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(allClips, null, 2)
            }
          ]
        }
      }

      case 'video_editor_list_tracks': {
        const result = await callLiveApp('get_tracks', { sequenceId: args?.sequenceId as string | undefined })
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
        }
      }

      case 'video_editor_list_markers': {
        const result = await callLiveApp('list_markers', { sequenceId: args?.sequenceId as string | undefined })
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
        }
      }

      case 'video_editor_get_asset_segments': {
        const { assetId } = args as { assetId: string }
        const asset = project.assets.find((item) => item.id === assetId)
        if (!asset) throw new Error(`Asset not found: ${assetId}`)
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(asset.semantic.segments ?? [], null, 2)
            }
          ]
        }
      }

      case 'video_editor_search_segments': {
        const { query } = args as { query: string }
        const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
        const matches = project.assets.flatMap((asset) =>
          (asset.semantic.segments ?? [])
            .filter((segment) => {
              const text = `${asset.name} ${segment.label} ${segment.text}`.toLowerCase()
              return terms.every((term) => text.includes(term))
            })
            .map((segment) => ({
              assetId: asset.id,
              assetName: asset.name,
              segmentId: segment.id,
              kind: segment.kind,
              start: segment.start,
              end: segment.end,
              label: segment.label,
              text: segment.text
            }))
        )
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(matches, null, 2)
            }
          ]
        }
      }

      case 'video_editor_extract_frames': {
        const { assetId, count } = args as { assetId: string; count?: number }
        const response = await fetch('http://localhost:51847', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ command: 'extract_frames', args: { assetId, count } })
        })
        const data = await response.json()
        if (!data.success) throw new Error(data.error || 'extract_frames failed')
        return {
          content: [{ type: 'text', text: JSON.stringify(data.result, null, 2) }]
        }
      }

      case 'video_editor_create_contact_sheet': {
        const { assetId, count } = args as { assetId: string; count?: number }
        const response = await fetch('http://localhost:51847', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ command: 'create_contact_sheet', args: { assetId, count } })
        })
        const data = await response.json()
        if (!data.success) throw new Error(data.error || 'create_contact_sheet failed')
        return {
          content: [{ type: 'text', text: JSON.stringify(data.result, null, 2) }]
        }
      }

      case 'video_editor_add_clip': {
        const { assetId, trackId, startTime, duration, inPoint } = args as {
          assetId: string
          trackId: string
          startTime: number
          duration?: number
          inPoint?: number
        }

        const asset = project.assets.find((a) => a.id === assetId)
        if (!asset) throw new Error(`Asset not found: ${assetId}`)

        let track = null
        for (const seq of project.sequences) {
          track = seq.tracks.find((t) => t.id === trackId)
          if (track) break
        }
        if (!track) throw new Error(`Track not found: ${trackId}`)

        const clipId = `clip_${Date.now()}`
        const newClip: TimelineClipRecord = {
          id: clipId,
          assetId,
          trackId,
          startTime,
          duration: duration ?? asset.duration,
          inPoint: inPoint ?? 0,
          label: asset.name
        }

        track.clips.push(newClip)
        saveProject(project)

        return {
          content: [
            {
              type: 'text',
              text: `Added clip ${clipId} to ${trackId} at ${startTime}s`
            }
          ]
        }
      }

      case 'video_editor_split_clip': {
        const { clipId, time } = args as { clipId: string; time: number }

        let found = false
        for (const seq of project.sequences) {
          for (const track of seq.tracks) {
            const clipIndex = track.clips.findIndex((c) => c.id === clipId)
            if (clipIndex >= 0) {
              const originalClip = track.clips[clipIndex]
              const relativeTime = time - originalClip.startTime

              if (relativeTime <= 0 || relativeTime >= originalClip.duration) {
                throw new Error(`Split time ${time} is outside clip bounds`)
              }

              const clip1: TimelineClipRecord = {
                ...originalClip,
                id: `${clipId}_a`,
                duration: relativeTime
              }

              const clip2: TimelineClipRecord = {
                ...originalClip,
                id: `${clipId}_b`,
                startTime: originalClip.startTime + relativeTime,
                duration: originalClip.duration - relativeTime,
                inPoint: originalClip.inPoint + relativeTime
              }

              track.clips.splice(clipIndex, 1, clip1, clip2)
              found = true
              break
            }
          }
          if (found) break
        }

        if (!found) throw new Error(`Clip not found: ${clipId}`)

        saveProject(project)

        return {
          content: [
            {
              type: 'text',
              text: `Split clip ${clipId} at ${time}s`
            }
          ]
        }
      }

      case 'video_editor_remove_clip': {
        const { clipId } = args as { clipId: string }

        let found = false
        for (const seq of project.sequences) {
          for (const track of seq.tracks) {
            const clipIndex = track.clips.findIndex((c) => c.id === clipId)
            if (clipIndex >= 0) {
              track.clips.splice(clipIndex, 1)
              found = true
              break
            }
          }
          if (found) break
        }

        if (!found) throw new Error(`Clip not found: ${clipId}`)

        saveProject(project)

        return {
          content: [
            {
              type: 'text',
              text: `Removed clip ${clipId}`
            }
          ]
        }
      }

      case 'video_editor_ripple_delete_clip': {
        const { clipId } = args as { clipId: string }
        const result = await callLiveApp('ripple_delete_clip', { clipId })
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
        }
      }

      case 'video_editor_ripple_insert_gap': {
        const { time, duration, sequenceId } = args as { time: number; duration: number; sequenceId?: string }
        const result = await callLiveApp('ripple_insert_gap', { time, duration, sequenceId })
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
        }
      }

      case 'video_editor_move_clip': {
        const { clipId, startTime } = args as { clipId: string; startTime: number }
        const result = await callLiveApp('move_clip', { clipId, startTime })
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
        }
      }

      case 'video_editor_trim_clip': {
        const { clipId, inPoint, duration, startTime } = args as {
          clipId: string
          inPoint?: number
          duration?: number
          startTime?: number
        }
        const result = await callLiveApp('trim_clip', { clipId, inPoint, duration, startTime })
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
        }
      }

      case 'video_editor_add_track': {
        const { kind } = args as { kind: 'video' | 'audio' | 'caption' }
        const result = await callLiveApp('add_track', { kind })
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
        }
      }

      case 'video_editor_set_playhead': {
        const { time } = args as { time: number }
        const result = await callLiveApp('set_playhead', { time })
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
        }
      }

      case 'video_editor_select_clip': {
        const { clipId } = args as { clipId: string }
        const result = await callLiveApp('select_clip', {
          clipId: clipId === 'none' || clipId === 'null' ? null : clipId
        })
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
        }
      }

      case 'video_editor_select_asset': {
        const { assetId } = args as { assetId: string }
        const result = await callLiveApp('select_asset', {
          assetId: assetId === 'none' || assetId === 'null' ? null : assetId
        })
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
        }
      }

      case 'video_editor_activate_sequence': {
        const { sequenceId } = args as { sequenceId: string }
        const result = await callLiveApp('activate_sequence', { sequenceId })
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
        }
      }

      case 'video_editor_add_marker': {
        const { time, label, duration, color, sequenceId } = args as {
          time: number
          label: string
          duration?: number
          color?: string
          sequenceId?: string
        }
        const result = await callLiveApp('add_marker', { time, label, duration, color, sequenceId })
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
        }
      }

      case 'video_editor_remove_marker': {
        const { markerId, sequenceId } = args as { markerId: string; sequenceId?: string }
        const result = await callLiveApp('remove_marker', { markerId, sequenceId })
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
        }
      }

      case 'video_editor_duplicate_clip': {
        const { clipId, offsetSeconds } = args as { clipId: string; offsetSeconds?: number }
        const result = await callLiveApp('duplicate_clip', { clipId, offsetSeconds })
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
        }
      }

      case 'video_editor_rename_clip': {
        const { clipId, label } = args as { clipId: string; label: string }
        const result = await callLiveApp('update_clip_label', { clipId, label })
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
        }
      }

      case 'video_editor_set_transition': {
        const { clipId, side, type, duration } = args as {
          clipId: string
          side: 'in' | 'out'
          type: string
          duration?: number
        }
        const result = await callLiveApp('set_transition', {
          clipId,
          side,
          type: type === 'null' ? null : type,
          duration
        })
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
        }
      }

      case 'video_editor_add_effect': {
        const { clipId, effectType, parameters } = args as {
          clipId: string
          effectType: string
          parameters: Record<string, unknown>
        }

        let found = false
        for (const seq of project.sequences) {
          for (const track of seq.tracks) {
            const clip = track.clips.find((c) => c.id === clipId)
            if (clip) {
              if (!clip.effects) clip.effects = []

              const effect: Effect = {
                id: `effect_${Date.now()}`,
                type: effectType as Effect['type'],
                enabled: true,
                parameters: parameters as Record<string, string | number | boolean>
              }

              clip.effects.push(effect)
              found = true
              break
            }
          }
          if (found) break
        }

        if (!found) throw new Error(`Clip not found: ${clipId}`)

        saveProject(project)

        return {
          content: [
            {
              type: 'text',
              text: `Added ${effectType} effect to clip ${clipId}`
            }
          ]
        }
      }

      case 'video_editor_set_effect_keyframes': {
        const { clipId, effectId, keyframes } = args as {
          clipId: string
          effectId: string
          keyframes: Array<{
            id?: string
            time: number
            easing?: 'linear' | 'ease_in' | 'ease_out' | 'ease_in_out'
            parameters: Record<string, unknown>
          }>
        }

        const result = await callLiveApp('set_effect_keyframes', { clipId, effectId, keyframes })
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(result, null, 2)
            }
          ]
        }
      }

      case 'video_editor_set_clip_speed': {
        const { clipId, speed } = args as { clipId: string; speed: number }

        let found = false
        for (const seq of project.sequences) {
          for (const track of seq.tracks) {
            const clip = track.clips.find((c) => c.id === clipId)
            if (clip) {
              clip.speed = Math.max(0.1, Math.min(10, speed))
              found = true
              break
            }
          }
          if (found) break
        }

        if (!found) throw new Error(`Clip not found: ${clipId}`)

        saveProject(project)

        return {
          content: [
            {
              type: 'text',
              text: `Set clip ${clipId} speed to ${speed}x`
            }
          ]
        }
      }

      case 'video_editor_set_clip_volume': {
        const { clipId, volume } = args as { clipId: string; volume: number }

        let found = false
        for (const seq of project.sequences) {
          for (const track of seq.tracks) {
            const clip = track.clips.find((c) => c.id === clipId)
            if (clip) {
              clip.volume = Math.max(0, Math.min(2, volume))
              found = true
              break
            }
          }
          if (found) break
        }

        if (!found) throw new Error(`Clip not found: ${clipId}`)

        saveProject(project)

        return {
          content: [
            {
              type: 'text',
              text: `Set clip ${clipId} volume to ${volume}`
            }
          ]
        }
      }

      case 'video_editor_generate_captions': {
        const { assetId, sequenceId, replaceExisting, minDuration } = args as {
          assetId: string
          sequenceId?: string
          replaceExisting?: boolean
          minDuration?: number
        }
        const result = await callLiveApp('generate_captions', { assetId, sequenceId, replaceExisting, minDuration })
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
        }
      }

      case 'video_editor_batch_selects_from_search': {
        const { query, limit, padding, sequenceName } = args as {
          query: string
          limit?: number
          padding?: number
          sequenceName?: string
        }
        const result = await callLiveApp('batch_selects_from_search', { query, limit, padding, sequenceName })
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
        }
      }

      case 'video_editor_batch_markers_from_search': {
        const { query, limit, sequenceId } = args as {
          query: string
          limit?: number
          sequenceId?: string
        }
        const result = await callLiveApp('batch_markers_from_search', { query, limit, sequenceId })
        return {
          content: [{ type: 'text', text: JSON.stringify(result, null, 2) }]
        }
      }

      case 'video_editor_get_project_snapshot': {
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(project, null, 2)
            }
          ]
        }
      }

      case 'video_editor_list_remotion_compositions': {
        const rootPath = join(process.cwd(), 'remotion', 'src', 'Root.tsx')
        let rootSrc = ''
        try { rootSrc = readFileSync(rootPath, 'utf8') } catch { /* file missing */ }
        const ids = [...rootSrc.matchAll(/id="([^"]+)"/g)].map((m) => m[1])
        return {
          content: [{
            type: 'text',
            text: ids.length
              ? `Available compositions:\n${ids.map((id) => `  - ${id}`).join('\n')}\n\nRender with: video_editor_render_remotion { compositionId: "..." }`
              : 'No compositions found. Check remotion/src/Root.tsx'
          }]
        }
      }

      case 'video_editor_render_remotion': {
        const { compositionId, outputFilename, props, durationInFrames, fps } = args as {
          compositionId: string
          outputFilename?: string
          props?: Record<string, unknown>
          durationInFrames?: number
          fps?: number
        }

        const rendersDir = join(process.cwd(), 'remotion-renders')
        mkdirSync(rendersDir, { recursive: true })

        const filename = outputFilename ?? `${compositionId}-${Date.now()}`
        const outputPath = join(rendersDir, `${filename}.mp4`)
        const entryPoint = join(process.cwd(), 'remotion', 'src', 'index.ts')
        const remotionBin = join(process.cwd(), 'node_modules', '.bin', 'remotion')

        const renderArgs = [remotionBin, 'render', entryPoint, compositionId, outputPath, '--overwrite']
        if (props) renderArgs.push(`--props=${JSON.stringify(props)}`)
        if (durationInFrames) renderArgs.push(`--frames=0-${durationInFrames - 1}`)
        if (fps) renderArgs.push(`--fps=${fps}`)

        execSync(renderArgs.join(' '), { cwd: process.cwd(), stdio: 'pipe', timeout: 300_000 })

        const importResult = await callLiveApp('import_files', { paths: [outputPath] })
        const assetId = Array.isArray(importResult) ? importResult[0]?.id : importResult?.id

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ success: true, outputPath, assetId }, null, 2)
          }]
        }
      }

      case 'video_editor_render_remotion_still': {
        const { compositionId, frame = 0, outputFilename, props } = args as {
          compositionId: string
          frame?: number
          outputFilename?: string
          props?: Record<string, unknown>
        }

        const rendersDir = join(process.cwd(), 'remotion-renders')
        mkdirSync(rendersDir, { recursive: true })

        const filename = outputFilename ?? `${compositionId}-frame${frame}-${Date.now()}`
        const outputPath = join(rendersDir, `${filename}.png`)
        const entryPoint = join(process.cwd(), 'remotion', 'src', 'index.ts')
        const remotionBin = join(process.cwd(), 'node_modules', '.bin', 'remotion')

        const stillArgs = [remotionBin, 'still', entryPoint, compositionId, outputPath, `--frame=${frame}`, '--overwrite']
        if (props) stillArgs.push(`--props=${JSON.stringify(props)}`)

        execSync(stillArgs.join(' '), { cwd: process.cwd(), stdio: 'pipe', timeout: 120_000 })

        const importResult = await callLiveApp('import_files', { paths: [outputPath] })
        const assetId = Array.isArray(importResult) ? importResult[0]?.id : importResult?.id

        return {
          content: [{
            type: 'text',
            text: JSON.stringify({ success: true, outputPath, assetId }, null, 2)
          }]
        }
      }

      default:
        throw new Error(`Unknown tool: ${name}`)
    }
  } catch (error) {
    return {
      content: [
        {
          type: 'text',
          text: `Error: ${error instanceof Error ? error.message : String(error)}`
        }
      ],
      isError: true
    }
  }
})

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('Monet MCP server running on stdio')
}

main().catch(console.error)
