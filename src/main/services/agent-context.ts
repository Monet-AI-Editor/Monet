import { access, writeFile } from 'fs/promises'
import { constants as fsConstants } from 'fs'
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
  await ensureFileIfMissing(claudePath, claudeBody)
  await ensureFileIfMissing(agentsPath, agentsBody)

  return { guidePath, claudePath, agentsPath }
}

function buildGuideBody(summary: AgentContextProjectSummary): string {
  return `# Monet Agent Context

Monet is an AI-first video editor. You are running inside Monet's built-in terminal.

## Current Monet project

This is a startup snapshot. The live editor can change after this file is written. Treat \`editorctl get-state\`, \`editorctl list-assets\`, and the local API bridge as the source of truth.
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
- extract frames and contact sheets
- export the active sequence

## Preferred control surfaces

1. Use \`editorctl\` in this terminal
2. Use Monet's local API bridge on \`http://localhost:51847\`
3. Use MCP tools if they are already wired in your host agent

Do not tell the user to click Import or use the UI if the task can be done with \`editorctl\` or the local API bridge.

## First commands to run

\`\`\`bash
editorctl help
editorctl get-state
editorctl list-assets
editorctl list-sequences
curl -s http://localhost:51847/state
\`\`\`

## If the user asks about "the app"

Interpret that as Monet's live editor state first, not the surrounding filesystem. Use \`editorctl\` or the API bridge before searching the current working directory for unrelated files.
Before acting on any new request, refresh your understanding with live state commands if there is any chance the project changed.

## Key commands

- \`editorctl import <path...>\`
- \`editorctl list-assets\`
- \`editorctl list-sequences\`
- \`editorctl list-tracks [sequenceId]\`
- \`editorctl list-clips [sequenceId]\`
- \`editorctl get-state\`
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
- \`editorctl extract-frames <assetId> [count]\`
- \`editorctl contact-sheet <assetId> [count]\`
- \`editorctl export /absolute/output/path.mp4 [quality] [resolution] [format]\`

## API bridge examples

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
- local API bridge on \`http://localhost:51847\`

If the user refers to "the app" or "the current project", inspect Monet's live editor state before searching the surrounding filesystem.
`
}

function buildAgentsBody(): string {
  return `# Monet

Read \`MONET_AGENT_CONTEXT.md\` in this directory before operating on Monet.

Use Monet's built-in control surface first:
- \`editorctl\`
- local API bridge on \`http://localhost:51847\`

Do not default to asking the user to click Import if you can import files yourself from an absolute path.
`
}

async function ensureFileIfMissing(filePath: string, contents: string): Promise<void> {
  try {
    await access(filePath, fsConstants.F_OK)
    return
  } catch {
    // missing
  }

  await writeFile(filePath, contents, 'utf8')
}
