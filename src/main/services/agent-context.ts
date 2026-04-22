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

- \`editorctl import <path...>\`
- \`editorctl list-assets\`
- \`editorctl list-sequences\`
- \`editorctl list-tracks [sequenceId]\`
- \`editorctl list-clips [sequenceId]\`
- \`editorctl get-state\`
- \`editorctl set-sequence-size <width> <height> [sequenceId]\`
- \`editorctl add-track <video|audio|caption>\`
- \`editorctl add-clip <assetId> <trackId> <startTime> [duration] [inPoint]\`
- \`editorctl move-clip <clipId> <startTime>\`
- \`editorctl trim-clip <clipId> [inPoint] [duration] [startTime]\`
- \`editorctl split-clip <clipId> <time>\`
- \`editorctl duplicate-clip <clipId> [offsetSeconds]\`
- \`editorctl remove-clip <clipId>\`
- \`editorctl ripple-delete-clip <clipId>\`
- \`editorctl add-marker <time> <label> [duration] [color] [seqId]\`
- \`editorctl generate-captions <assetId> [seqId]\`
- \`editorctl transcribe <assetId> [language]\`
- \`editorctl search-segments "<query>" [limit]\`
- \`editorctl generate-image "<prompt>" [size] [quality] [background] [format] [moderation=auto|low] [outputCompression=0-100] [partialImages=0-3]\`
- \`editorctl edit-image "<prompt>" <input1> [input2...] [size=...] [quality=...] [background=...] [format=...] [outputCompression=...] [partialImages=...] [inputFidelity=low|high] [mask=<assetId|path>]\`
- \`editorctl extract-frames <assetId> [count]\`
- \`editorctl contact-sheet <assetId> [count]\`
- \`editorctl export /absolute/output/path.mp4 [quality] [resolution] [format]\`

## API bridge fallback examples

Only use these if \`editorctl\` truly cannot do the job:

- \`curl -s http://localhost:51847/state\`
- \`curl -s http://localhost:51847/assets\`
- \`curl -s -X POST http://localhost:51847 -H "Content-Type: application/json" -d '{"command":"list-assets"}'\`

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
Do not improvise localhost commands or endpoints when \`editorctl\` already supports the task.
`
}

function buildAgentsBody(): string {
  return `# Monet

Read \`MONET_AGENT_CONTEXT.md\` in this directory before operating on Monet.

Use Monet's built-in control surface first:
- \`editorctl\`
- MCP tools if available
- only then the local API bridge on \`http://localhost:51847\` as a fallback

Do not default to asking the user to click Import if you can import files yourself from an absolute path.
Do not improvise raw localhost commands when \`editorctl\` already supports the operation.
`
}
