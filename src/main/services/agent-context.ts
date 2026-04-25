import { writeFile } from 'fs/promises'
import { join } from 'path'

export interface AgentContextProjectSummary {
  projectName: string
  assetCount: number
  activeSequenceName: string | null
  activeSequenceDuration: number | null
  assetNames: string[]
}

export interface AgentContextPaths {
  guidePath: string
  claudePath: string
  agentsPath: string
}

const PRIMARY_CONTEXT_FILE = 'MONET_AGENT_CONTEXT.md'

export async function ensureAgentContextFiles(
  cwd: string,
  summary: AgentContextProjectSummary
): Promise<AgentContextPaths> {
  const guidePath = join(cwd, PRIMARY_CONTEXT_FILE)
  const claudePath = join(cwd, 'CLAUDE.md')
  const agentsPath = join(cwd, 'AGENTS.md')

  const guideBody = buildGuideBody(summary)
  const claudeBody = buildClaudeBody()
  const agentsBody = buildAgentsBody()

  await writeFile(guidePath, guideBody, 'utf8')
  await writeFile(claudePath, claudeBody, 'utf8')
  await writeFile(agentsPath, agentsBody, 'utf8')

  return { guidePath, claudePath, agentsPath }
}

function buildGuideBody(summary: AgentContextProjectSummary): string {
  return `# Monet Agent Context

Monet is an AI-first video editor. You are running inside Monet's built-in terminal.
You do not need the user to explicitly tell you that you are inside Monet. Treat this shell as Monet unless the user clearly redirects you elsewhere.

## Current Monet project

This is a startup snapshot. The live editor can change after this file is written. Treat \`editorctl get-state\`, \`editorctl list-assets\`, and \`editorctl list-sequences\` as the source of truth.
The terminal session can stay alive while Monet opens, creates, or switches to a different project. Never assume the current project is fixed for the lifetime of the shell.

- Project: ${summary.projectName}
- Assets: ${summary.assetCount}
- Active sequence: ${summary.activeSequenceName ?? 'None'}
- Active sequence duration: ${summary.activeSequenceDuration != null ? `${summary.activeSequenceDuration.toFixed(2)}s` : 'None'}
- Visible assets right now:
${summary.assetNames.length > 0 ? summary.assetNames.map((name) => `  - ${name}`).join('\n') : '  - none'}

## What you can control

- import media files into the current project
- inspect assets, sequences, tracks, clips, markers, and captions
- search spoken and semantic segments
- move, trim, split, duplicate, and remove clips
- add tracks, effects, transitions, and markers
- change the active sequence canvas size for portrait or landscape edits
- extract frames and contact sheets
- export the active sequence

## Preferred control surfaces

1. Use \`editorctl\` in this terminal
2. Use MCP tools if they are already wired in your host agent
3. Use Monet's local API bridge on \`http://localhost:51847\` only if \`editorctl\` does not expose the operation or \`editorctl\` is failing

Do not tell the user to click Import or use the UI if the task can be done with \`editorctl\`.
Do not guess raw localhost endpoints or command names when \`editorctl\` already covers the task.

## First commands to run

\`\`\`bash
editorctl help
editorctl get-state
editorctl list-assets
editorctl list-sequences
editorctl set-sequence-size 1080 1920
\`\`\`

## If the user asks about "the app"

Interpret that as Monet's live editor state first, not the surrounding filesystem. Questions about screenshots, images, assets, clips, or "what is in the app" should start with \`editorctl\`, not a filesystem search in the current working directory.
Before acting on any new request, refresh your understanding with live state commands if there is any chance the project changed.

## Key commands

### Project & state
- \`editorctl get-state\`
- \`editorctl list-assets\`
- \`editorctl list-sequences\`
- \`editorctl list-tracks [sequenceId]\`
- \`editorctl list-clips [sequenceId]\`
- \`editorctl list-markers [sequenceId]\`
- \`editorctl get-asset-segments <assetId>\`
- \`editorctl import <path...>\`

### Sequences
- \`editorctl activate-sequence <sequenceId>\`
- \`editorctl set-sequence-size <width> <height> [sequenceId]\`

### Tracks & clips
- \`editorctl add-track <video|audio|caption>\`
- \`editorctl add-clip <assetId> <trackId> <startTime> [duration] [inPoint]\`
- \`editorctl move-clip <clipId> <startTime>\`
- \`editorctl trim-clip <clipId> [inPoint] [duration] [startTime]\`
- \`editorctl split-clip <clipId> <time>\`
- \`editorctl duplicate-clip <clipId> [offsetSeconds]\`
- \`editorctl rename-clip <clipId> <label>\`
- \`editorctl remove-clip <clipId>\`
- \`editorctl ripple-delete-clip <clipId>\`
- \`editorctl ripple-insert-gap <time> <duration> [sequenceId]\`

### Effects & properties
- \`editorctl add-effect <clipId> <effectType> [key=value...]\`
  - effect types: \`fade_in\`, \`fade_out\`, \`color_grade\`, \`blur\`, \`sharpen\`, \`transform\`, \`opacity\`, \`blend_mode\`, \`text_overlay\`, \`speed_ramp\`, \`drop_shadow\`, \`glow\`, \`chroma_key\`
  - examples: \`add-effect clip_1 color_grade brightness=0.1 contrast=1.2 saturation=1.1\`
  - examples: \`add-effect clip_1 fade_in duration=1.0\`
  - examples: \`add-effect clip_1 text_overlay text="Hello" x=100 y=100 fontSize=48\`
- \`editorctl set-effect-keyframes <clipId> <effectId> <json>\`
- \`editorctl set-speed <clipId> <speed>\` — 0.1x to 10x
- \`editorctl set-volume <clipId> <volume>\` — 0 to 2 (1 = normal, 2 = 200%)

### Transitions
- \`editorctl set-transition <clipId> <in|out> <type|null> [duration]\`
  - types: \`crossfade\`, \`dip_to_black\`, \`wipe\`, \`slide\`
  - example: \`set-transition clip_1 out crossfade 0.5\`

### Markers & captions
- \`editorctl add-marker <time> <label> [duration] [color] [seqId]\`
- \`editorctl remove-marker <markerId> [sequenceId]\`
- \`editorctl generate-captions <assetId> [sequenceId]\`

### Search & AI
- \`editorctl search-segments "<query>" [limit]\`
- \`editorctl batch-selects "<query>" [limit] [padding] [sequenceName]\` — auto-create selects sequence from search
- \`editorctl batch-markers "<query>" [limit] [seqId]\` — auto-place markers from search
- \`editorctl transcribe <assetId> [language]\`
- \`editorctl generate-image "<prompt>" [size] [quality] [background] [format] [moderation=auto|low] [outputCompression=0-100] [partialImages=0-3]\`
- \`editorctl edit-image "<prompt>" <input1> [input2...] [size=...] [quality=...] [background=...] [format=...] [outputCompression=...] [partialImages=...] [inputFidelity=low|high] [mask=<assetId|path>]\`

### Utilities
- \`editorctl extract-frames <assetId> [count]\`
- \`editorctl contact-sheet <assetId> [count]\`
- \`editorctl set-playhead <time>\`
- \`editorctl select-clip <clipId|none>\`
- \`editorctl select-asset <assetId|none>\`
- \`editorctl export /absolute/output/path.mp4 [quality] [resolution] [format]\`

### API bridge only (no editorctl equivalent)
- undo: \`curl -s -X POST http://localhost:51847 -H "Content-Type: application/json" -d '{"command":"undo"}'\`
- redo: \`curl -s -X POST http://localhost:51847 -H "Content-Type: application/json" -d '{"command":"redo"}'\`
- embed assets: \`curl -s -X POST http://localhost:51847 -H "Content-Type: application/json" -d '{"command":"embed-assets"}'\`

## API bridge fallback examples

Only use these if \`editorctl\` truly cannot do the job:

- \`curl -s http://localhost:51847/state\`
- \`curl -s http://localhost:51847/assets\`
- \`curl -s -X POST http://localhost:51847 -H "Content-Type: application/json" -d '{"command":"list-assets"}'\`

## Remotion — React video composition

Remotion is installed in the Monet app directory (\`$AI_VIDEO_EDITOR_ROOT\`). Use it to create animated video assets.

\`\`\`bash
cd "$AI_VIDEO_EDITOR_ROOT"
npm run remotion:studio                          # preview at localhost:3000
npx remotion render remotion/src/index.ts <ID> out.mp4 --props '{"key":"val"}'
npx remotion still remotion/src/index.ts <ID> out.png --frame=30
\`\`\`

After rendering, import: \`editorctl import /absolute/path/to/out.mp4\`

MCP tools (auto-import): \`video_editor_list_remotion_compositions\`, \`video_editor_render_remotion\`, \`video_editor_render_remotion_still\`

Built-in composition IDs: \`TitleCard\` · \`Slideshow\` · \`VideoWithTitle\` · \`AudioVisualizer\` · \`LowerThird\` · \`AnimatedCaptions\` · \`KineticText\`

## Editing rules

- treat unintended timeline gaps as bugs
- verify continuity with \`editorctl list-clips\` after tightening a cut
- prefer deterministic tool commands over asking the user to perform UI steps
- if you need media from disk, ask for or discover the absolute file path, then import it yourself
`
}

function buildClaudeBody(): string {
  return `# Monet

Read \`MONET_AGENT_CONTEXT.md\` in this directory before working in Monet.

Use Monet's live control surface first:
- \`editorctl\`
- MCP tools if available
- only then the local API bridge on \`http://localhost:51847\` as a fallback

If the user refers to "the app" or "the current project", inspect Monet's live editor state with \`editorctl\` before searching the surrounding filesystem.
Do not wait for the user to explain that they are inside Monet. Default to Monet live state first.
Do not improvise localhost commands or endpoints when \`editorctl\` already supports the task.

## Remotion — React video composition

Remotion is installed in the Monet app directory (\`$AI_VIDEO_EDITOR_ROOT\`). Use it to generate animated video assets (title cards, lower thirds, captions, visualizers) and import them into the timeline.

\`\`\`bash
cd "$AI_VIDEO_EDITOR_ROOT"
npm run remotion:studio                          # live preview at localhost:3000
npx remotion render remotion/src/index.ts <ID> out.mp4 --props '{"key":"value"}'
npx remotion still remotion/src/index.ts <ID> out.png --frame=30
\`\`\`

After rendering, import the output into Monet:
\`\`\`bash
editorctl import /absolute/path/to/output.mp4
\`\`\`

Or use MCP tools (auto-import included):
- \`video_editor_list_remotion_compositions\` — list available composition IDs
- \`video_editor_render_remotion\` — render MP4 + auto-import as asset
- \`video_editor_render_remotion_still\` — render PNG frame + auto-import as asset

### Built-in compositions

| ID | Props |
|----|-------|
| \`TitleCard\` | \`title\`, \`subtitle\`, \`backgroundColor\`, \`textColor\`, \`accentColor\` |
| \`Slideshow\` | \`images\` (abs path[]), \`frameDuration\`, \`transitionDuration\` |
| \`VideoWithTitle\` | \`videoSrc\` (abs path), \`title\`, \`subtitle\`, \`titlePosition\`, \`overlayOpacity\` |
| \`AudioVisualizer\` | \`audioSrc\` (abs path), \`barCount\`, \`barColor\`, \`mirror\` |
| \`LowerThird\` | \`name\`, \`title\`, \`accentColor\`, \`position\` (left/center/right) |
| \`AnimatedCaptions\` | \`words\` [{word, startFrame, endFrame}], \`highlightColor\`, \`fontSize\` |
| \`KineticText\` | \`text\`, \`animationStyle\` (rise/fall/scale/blur), \`staggerFrames\`, \`fontSize\` |

Duration is in frames (30fps default). 30 frames = 1 second.
Add new compositions in \`$AI_VIDEO_EDITOR_ROOT/remotion/src/compositions/\` and register in \`Root.tsx\`.

## Full editorctl reference

Effects: \`add-effect <clipId> <type> [key=value...]\`
- types: \`fade_in\`, \`fade_out\`, \`color_grade\`, \`blur\`, \`sharpen\`, \`transform\`, \`opacity\`, \`blend_mode\`, \`text_overlay\`, \`speed_ramp\`, \`drop_shadow\`, \`glow\`, \`chroma_key\`

Speed & volume: \`set-speed <clipId> <0.1–10>\` · \`set-volume <clipId> <0–2>\`

Transitions: \`set-transition <clipId> <in|out> <crossfade|dip_to_black|wipe|slide|null> [duration]\`

Keyframes: \`set-effect-keyframes <clipId> <effectId> <json>\`

Batch AI: \`batch-selects "<query>" [limit] [padding] [sequenceName]\` · \`batch-markers "<query>" [limit] [seqId]\`

Misc: \`activate-sequence <seqId>\` · \`rename-clip <clipId> <label>\` · \`ripple-insert-gap <time> <duration>\` · \`remove-marker <markerId>\` · \`get-asset-segments <assetId>\` · \`set-playhead <time>\` · \`select-clip <clipId|none>\`

API bridge only (no editorctl): undo, redo, embed-assets — POST to http://localhost:51847 with \`{"command":"undo"}\`
`
}

function buildAgentsBody(): string {
  return `# Monet

Read \`MONET_AGENT_CONTEXT.md\` in this directory before operating on Monet.

Use Monet's built-in control surface first:
- \`editorctl\`
- MCP tools if available
- only then the local API bridge on \`http://localhost:51847\` as a fallback

Assume this shell belongs to Monet unless the user clearly says otherwise.
Do not default to asking the user to click Import if you can import files yourself from an absolute path.
Do not improvise raw localhost commands when \`editorctl\` already supports the operation.

## Remotion — React video composition

Remotion is installed in \`$AI_VIDEO_EDITOR_ROOT\`. Use it to generate animated video assets and import them into the timeline.

\`\`\`bash
cd "$AI_VIDEO_EDITOR_ROOT"
npm run remotion:studio
npx remotion render remotion/src/index.ts <CompositionId> out.mp4 --props '{"key":"value"}'
editorctl import /absolute/path/to/out.mp4
\`\`\`

MCP tools (auto-import): \`video_editor_list_remotion_compositions\`, \`video_editor_render_remotion\`, \`video_editor_render_remotion_still\`

Built-in IDs: \`TitleCard\` · \`Slideshow\` · \`VideoWithTitle\` · \`AudioVisualizer\` · \`LowerThird\` · \`AnimatedCaptions\` · \`KineticText\`

## Full editorctl capabilities

Clips: \`add-clip\` · \`move-clip\` · \`trim-clip\` · \`split-clip\` · \`duplicate-clip\` · \`rename-clip\` · \`remove-clip\` · \`ripple-delete-clip\` · \`ripple-insert-gap <time> <duration>\`

Effects: \`add-effect <clipId> <type> [key=value...]\` — types: \`fade_in\` \`fade_out\` \`color_grade\` \`blur\` \`sharpen\` \`transform\` \`opacity\` \`blend_mode\` \`text_overlay\` \`speed_ramp\` \`drop_shadow\` \`glow\` \`chroma_key\`

Properties: \`set-speed <clipId> <0.1–10>\` · \`set-volume <clipId> <0–2>\` · \`set-transition <clipId> <in|out> <crossfade|dip_to_black|wipe|slide|null> [dur]\` · \`set-effect-keyframes <clipId> <effectId> <json>\`

Search & AI: \`search-segments\` · \`batch-selects "<query>" [limit] [padding]\` · \`batch-markers "<query>" [limit]\` · \`transcribe\` · \`generate-image\` · \`edit-image\`

Misc: \`activate-sequence\` · \`set-sequence-size\` · \`add-marker\` · \`remove-marker\` · \`generate-captions\` · \`get-asset-segments\` · \`extract-frames\` · \`contact-sheet\` · \`set-playhead\` · \`select-clip\` · \`export\`

API bridge only: undo · redo · embed-assets — POST \`{"command":"undo"}\` to http://localhost:51847
`
}
