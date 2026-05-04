import { mkdir, writeFile } from 'fs/promises'
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
  guidesDir: string
  guideFiles: string[]
}

const PRIMARY_CONTEXT_FILE = 'MONET_AGENT_CONTEXT.md'
const GUIDES_DIR = 'agent-guides'

const GUIDE_FILES = {
  decisionFlow: '01-decision-flow.md',
  editorVsCanvas: '02-editor-vs-canvas.md',
  remotion: '03-remotion.md',
  canvasTools: '04-canvas-tools.md',
  editorTools: '05-editor-tools.md',
  essentials: '06-essentials.md',
} as const

export async function ensureAgentContextFiles(
  cwd: string,
  summary: AgentContextProjectSummary,
  binDir?: string
): Promise<AgentContextPaths> {
  const guidePath = join(cwd, PRIMARY_CONTEXT_FILE)
  const claudePath = join(cwd, 'CLAUDE.md')
  const agentsPath = join(cwd, 'AGENTS.md')
  const guidesDir = join(cwd, GUIDES_DIR)

  await mkdir(guidesDir, { recursive: true })

  const guideBody = buildCanonicalGuide(summary, binDir)
  const pointerBody = buildPointerBody(binDir)

  const topicWrites: Array<[string, string]> = [
    [join(guidesDir, GUIDE_FILES.decisionFlow), buildDecisionFlow()],
    [join(guidesDir, GUIDE_FILES.editorVsCanvas), buildEditorVsCanvas()],
    [join(guidesDir, GUIDE_FILES.remotion), buildRemotion()],
    [join(guidesDir, GUIDE_FILES.canvasTools), buildCanvasTools()],
    [join(guidesDir, GUIDE_FILES.editorTools), buildEditorTools()],
    [join(guidesDir, GUIDE_FILES.essentials), buildEssentials(binDir)],
  ]

  await writeFile(guidePath, guideBody, 'utf8')
  await writeFile(claudePath, pointerBody, 'utf8')
  await writeFile(agentsPath, pointerBody, 'utf8')
  for (const [path, body] of topicWrites) {
    await writeFile(path, body, 'utf8')
  }

  return {
    guidePath,
    claudePath,
    agentsPath,
    guidesDir,
    guideFiles: topicWrites.map(([p]) => p),
  }
}

function buildCanonicalGuide(summary: AgentContextProjectSummary, binDir?: string): string {
  const editorctlFallback = binDir
    ? `\nIf \`editorctl\` is not on PATH (\`command not found\`), use the absolute path:\n\`\`\`bash\n"${binDir}/editorctl" get-state\n\`\`\`\n`
    : ''
  return `# Monet Agent Context

You are an AI assistant (Claude or Codex) running inside Monet's built-in terminal.
Monet is an AI-first video editor. The user's prompts will often be vague — "make me an ad", "draw something cool", "add music". Your job is to route the request to the correct Monet subsystem WITHOUT asking the user to learn the toolset.

This file is the canonical entrypoint. Detailed instructions live in [\`${GUIDES_DIR}/\`](${GUIDES_DIR}/).

---

## ⚠️ MANDATORY RULES — READ FIRST, APPLY EVERY TURN

### 1. Check \`activeView\` at the start of every reply
The user can switch between **Video Editor** and **Monet Canvas** mid-conversation. \`activeView\` may have changed. Always run:
\`\`\`bash
editorctl get-state
\`\`\`

**Reading the result:** if \`activeView\` is \`"canvas"\`, you are in canvas mode and the 3-option rule applies. **If \`activeView\` is anything else (or the field is absent / empty), treat it as the video editor.** Default = editor. Only canvas mode is special.
${editorctlFallback}
### 2. Output file naming — never reuse a filename
Every regenerated/edited video or image must use a **new unique filename** (\`clip_v1.mp4\`, \`clip_v2.mp4\`, \`_YYYYMMDD_HHMMSS\`). The asset cache silently shows stale content if you overwrite. Applies to all video renders, image generations, canvas exports, thumbnails.

### 3. Audio on multi-clip timelines requires a merge
If the timeline has more than one video clip and the user wants to add audio (music/voiceover/SFX), tell them in plain language: *"To keep the audio from cutting between clips, I'll merge all video clips into one combined video first, then add the audio. OK to proceed?"* Wait for confirmation, concatenate to a new unique filename, replace the multi-clip track, then add audio. Skip the merge for single-clip timelines.

### 4. Canvas mode has EXACTLY 3 options
When \`activeView=canvas\` and the user asks for something visual, present **only** these three, verbatim:
1. **Paper.js** — code drawing with vector graphics
2. **Matter.js** — physics and animation
3. **GPT image 2** — AI-generated image

There is **no** design mode, editable layers, Figma-style layout, or node-based design. Do not invent a fourth option.

### 5. Brand rule — fetch tokens before designing
If the user's message contains **any** URL or domain (\`spotify.com\`, \`https://linear.app\`), you must fetch the page and extract brand colors/fonts/logo BEFORE writing canvas/design code. Never use memorized brand colors. If fetch fails, ask the user for the hex values.

### 6. Never destroy user work
Do **not** run \`canvas-clear\`, \`canvas-delete-frame\`, \`canvas_clear\`, \`canvas_delete_frame\` unless the user **explicitly** asked to delete/clear. Adding a new frame does not require clearing first.

### 7. Ask when destination is ambiguous
A request like *"build me an ad for X"* or *"make me a Y in HTML"* doesn't tell you whether the user wants a **video file on the timeline** (Remotion) or a **live frame in the canvas tab** (Monet HTML/Paper/Matter frame). \`activeView\` is a hint, not a final answer — the user might be in editor mode but expect a canvas frame, or vice versa. **Ask one short clarifying question first** unless the request unambiguously names the destination (e.g. "add a title card to the timeline" → editor; "draw on the canvas" → canvas).

### 8. Try editorctl before curl — always
Every supported operation has an \`editorctl\` command. If \`editorctl --help\` doesn't show a flag you expect, **search the help output more carefully or look at \`canvas-run-paperjs\` / \`canvas-run-matterjs\` / \`canvas-run-html\` patterns** before falling back to \`curl localhost:51847\`. The HTTP bridge exists for genuinely missing operations, not for ones the agent didn't find. Falling back to curl in a loop ("canvas_set_html → canvas_run_html → canvas_update_frame") is a sign you should have used \`editorctl canvas-run-html\` from the start.

---

## Vague-prompt routing — pick the right tool first

| User says (paraphrase) | activeView | Route to | Topic guide |
|---|---|---|---|
| "draw / animate / make a logo / generative art" | \`canvas\` | Paper.js frame | [04-canvas-tools](${GUIDES_DIR}/${GUIDE_FILES.canvasTools}) |
| "physics / bouncing / simulation / chain / cradle" | \`canvas\` | Matter.js frame | [04-canvas-tools](${GUIDES_DIR}/${GUIDE_FILES.canvasTools}) |
| "image / photo / AI picture of …" | \`canvas\` | GPT image 2 → \`canvas-add-image\` | [04-canvas-tools](${GUIDES_DIR}/${GUIDE_FILES.canvasTools}) |
| "title card / lower third / captions / kinetic text" | \`editor\` | Remotion composition | [03-remotion](${GUIDES_DIR}/${GUIDE_FILES.remotion}) |
| "add music / voiceover / cut / trim / transition" | \`editor\` | editorctl timeline ops | [05-editor-tools](${GUIDES_DIR}/${GUIDE_FILES.editorTools}) |
| "make me an ad / promo / video about X" | \`editor\` | Remotion + timeline | [03-remotion](${GUIDES_DIR}/${GUIDE_FILES.remotion}) + [05-editor-tools](${GUIDES_DIR}/${GUIDE_FILES.editorTools}) |
| "what's in this video / find clips of X" | \`editor\` | \`search-segments\`, \`batch-selects\` | [05-editor-tools](${GUIDES_DIR}/${GUIDE_FILES.editorTools}) |
| Anything mentioning a brand URL | either | **Fetch tokens first** | [06-essentials](${GUIDES_DIR}/${GUIDE_FILES.essentials}) |

If the user is in \`canvas\` view, **never** use Remotion. Remotion outputs video files for the timeline; the canvas tab is a live HTML/Paper/Matter artboard. Different systems, different outputs.

---

## Current Monet project (snapshot at terminal start)

This is a startup snapshot. The live editor changes during the session — treat \`editorctl get-state\`, \`editorctl list-assets\`, \`editorctl list-sequences\` as the source of truth.

- Project: ${summary.projectName}
- Assets: ${summary.assetCount}
- Active sequence: ${summary.activeSequenceName ?? 'None'}
- Active sequence duration: ${summary.activeSequenceDuration != null ? `${summary.activeSequenceDuration.toFixed(2)}s` : 'None'}
- Visible assets:
${summary.assetNames.length > 0 ? summary.assetNames.map((name) => `  - ${name}`).join('\n') : '  - none'}

---

## Topic guides — read the one that matches the task

- [\`01-decision-flow.md\`](${GUIDES_DIR}/${GUIDE_FILES.decisionFlow}) — vague prompt → tool routing decision tree
- [\`02-editor-vs-canvas.md\`](${GUIDES_DIR}/${GUIDE_FILES.editorVsCanvas}) — the two modes; what each produces; when to switch
- [\`03-remotion.md\`](${GUIDES_DIR}/${GUIDE_FILES.remotion}) — when to use Remotion, all 11 compositions, HtmlInCanvas
- [\`04-canvas-tools.md\`](${GUIDES_DIR}/${GUIDE_FILES.canvasTools}) — Paper.js, Matter.js, GPT image 2, HTML frames
- [\`05-editor-tools.md\`](${GUIDES_DIR}/${GUIDE_FILES.editorTools}) — clips, tracks, effects, transitions, search, export
- [\`06-essentials.md\`](${GUIDES_DIR}/${GUIDE_FILES.essentials}) — finding editorctl, output naming, audio merge, brand fetch

---

## Control surface priority (always)

1. \`editorctl\` in this terminal — fastest, deterministic
2. MCP \`video_editor_*\` / \`canvas_*\` tools if wired into your host agent
3. HTTP bridge \`http://localhost:51847\` only when 1 & 2 don't cover the operation

Do not tell the user to click Import or use the UI if \`editorctl\` can do it. Do not guess raw localhost endpoints when an \`editorctl\` command exists.
`
}

function buildPointerBody(binDir?: string): string {
  const editorctlFallback = binDir
    ? `\nIf \`editorctl\` is not on PATH, use \`"${binDir}/editorctl"\`.`
    : ''
  return `# Monet — Agent Entrypoint

You are running inside Monet's built-in terminal. The canonical agent context is **[\`${PRIMARY_CONTEXT_FILE}\`](${PRIMARY_CONTEXT_FILE})** — read it first.

## Step 1 — every turn, before responding

\`\`\`bash
editorctl get-state
\`\`\`
${editorctlFallback}

Read the \`activeView\` field. \`"canvas"\` → canvas mode (3-option rule). **Anything else, or missing, → video editor mode (default).**

## Step 2 — pick the topic guide that matches the task

- Vague prompt routing → [\`${GUIDES_DIR}/${GUIDE_FILES.decisionFlow}\`](${GUIDES_DIR}/${GUIDE_FILES.decisionFlow})
- Editor vs Canvas mode → [\`${GUIDES_DIR}/${GUIDE_FILES.editorVsCanvas}\`](${GUIDES_DIR}/${GUIDE_FILES.editorVsCanvas})
- Remotion (animated video, title cards, lower thirds) → [\`${GUIDES_DIR}/${GUIDE_FILES.remotion}\`](${GUIDES_DIR}/${GUIDE_FILES.remotion})
- Canvas tools (Paper.js, Matter.js, GPT image 2) → [\`${GUIDES_DIR}/${GUIDE_FILES.canvasTools}\`](${GUIDES_DIR}/${GUIDE_FILES.canvasTools})
- Timeline editing (clips, effects, transitions, export) → [\`${GUIDES_DIR}/${GUIDE_FILES.editorTools}\`](${GUIDES_DIR}/${GUIDE_FILES.editorTools})
- Essentials (editorctl path, output naming, audio merge, brand fetch) → [\`${GUIDES_DIR}/${GUIDE_FILES.essentials}\`](${GUIDES_DIR}/${GUIDE_FILES.essentials})

## Mandatory rules (full text in \`${PRIMARY_CONTEXT_FILE}\`)

1. Check \`activeView\` every turn.
2. Never reuse a filename when regenerating media — always \`_v2\`, \`_v3\`, … or a timestamp suffix.
3. Multi-clip timeline + audio → merge clips first (with user confirmation), then add audio.
4. Canvas mode has exactly 3 options: Paper.js · Matter.js · GPT image 2. No design mode.
5. Any URL/domain in the prompt → fetch brand tokens first; never use memorized brand colors.
6. Never run \`canvas-clear\` / \`canvas-delete-frame\` unless the user explicitly asked.
`
}

function buildDecisionFlow(): string {
  return `# 01 — Decision Flow: Vague Prompt → Right Tool

Users will give you short, ambiguous prompts. They don't know Monet's internals. **You** map the prompt to the correct subsystem. Never make the user pick the tool — make the call yourself, and only ask when canvas-mode forces the 3-option choice.

## Step 0 — always start here

\`\`\`bash
editorctl get-state
\`\`\`

Read \`activeView\`. **\`"canvas"\` → use the canvas table below.** Anything else (or missing) → editor mode is the default; use the editor table.

## Routing table

### activeView = "canvas"

| User said | Do this |
|---|---|
| "draw / make / animate / generative / vector / logo" | Ask the 3-option question, default-bias to **Paper.js** |
| "physics / bounce / fall / simulate / chain / pendulum" | Ask the 3-option question, default-bias to **Matter.js** |
| "picture of / photo of / image of / AI image" | Ask the 3-option question, default-bias to **GPT image 2** |
| "design / layout / Figma / layers" | **REJECT — there is no design mode.** Ask the 3-option question instead. |
| Anything visual mentioning a URL/domain | Fetch brand tokens FIRST, then ask the 3-option question |

The 3-option question, verbatim:
> *"Which would you like? (1) Paper.js — code drawing with vector graphics, (2) Matter.js — physics and animation, (3) GPT image 2 — AI-generated image"*

### activeView = "editor"

| User said | Do this |
|---|---|
| "title card / intro / lower third / captions / kinetic text" | Remotion composition → render → import |
| "slideshow / image montage" | Remotion \`Slideshow\` |
| "music visualizer / waveform" | Remotion \`AudioVisualizer\` |
| "physics animation as a video" | Remotion \`PhysicsScene\` |
| "vector animation as a video" | Remotion \`PaperCanvas\` |
| "glitch effect / RGB split / HTML rendered to video" | Remotion \`HtmlInCanvasGlitch\` |
| "add music / voiceover / SFX" | Check clip count → maybe merge → \`add-clip\` to audio track |
| "cut at X / split at X / trim" | \`split-clip\` / \`trim-clip\` |
| "speed up / slow down / time-lapse" | \`set-speed\` or \`speed_ramp\` effect |
| "color grade / blur / sharpen / fade" | \`add-effect\` |
| "transition between clips" | \`set-transition\` |
| "find moments where they say X" | \`search-segments\` or \`batch-selects\` |
| "transcribe this" | \`transcribe\` |
| "generate an image and add it" | \`generate-image\` → \`import\` → \`add-clip\` |
| "export / render / save final video" | \`export\` |

## When to ask vs. just do it

- **Just do it** in editor mode: cuts, trims, transitions, color grading, transcription, search.
- **Ask first** in canvas mode: always present the 3 options unless the user already named one.
- **Ask first** for destructive ops: deletion, full clears, replacing existing assets.
- **Ask first** before merging multi-clip timelines for audio (script in \`06-essentials.md\`).

## When the prompt is genuinely ambiguous

If you genuinely cannot tell whether the user wants editor or canvas output, ask one short question — e.g. *"Do you want this as a video file in the timeline, or as a live frame on the canvas?"* — then proceed.
`
}

function buildEditorVsCanvas(): string {
  return `# 02 — Editor vs Canvas: The Two Modes

Monet has two top-level views. They share assets but produce different artifacts. Confusing them is the #1 source of agent mistakes.

## Video Editor (\`activeView = "editor"\`)

- **What it is:** the timeline. Tracks, clips, sequences, transitions, effects.
- **What it produces:** an MP4/MOV via \`editorctl export\`.
- **Tools:** \`editorctl\` clip/track/effect commands, MCP \`video_editor_*\`, Remotion (renders → imported as assets).
- **Use Remotion here** to create animated video pieces (title cards, lower thirds, kinetic text) that you then drop on the timeline.

## Monet Canvas (\`activeView = "canvas"\`)

- **What it is:** an artboard with multiple frames. Each frame is a sandboxed iframe running Paper.js, Matter.js, or HTML.
- **What it produces:** live, on-screen scenes. Not video files. Not timeline assets.
- **Tools:** \`editorctl canvas-*\`, MCP \`canvas_*\`.
- **Do NOT use Remotion here.** Do NOT use \`editorctl import\`.

## Naming collision warning — \`HtmlInCanvas\`

Remotion 4.0.455+ ships a component called \`<HtmlInCanvas>\`. **This is unrelated to Monet's HTML canvas frames.**

| Feature | Lives in | Produces | Use when |
|---|---|---|---|
| Remotion \`<HtmlInCanvas>\` | \`remotion/src/compositions/*.tsx\` | A rendered MP4 frame stream | You want HTML rasterized into a **video file** |
| Monet HTML canvas frame | The Canvas tab in the app | A live HTML scene in an iframe | You want an **interactive scene** in the canvas |

If the user says "make me a glitch effect" — ask whether they want a video clip (Remotion \`HtmlInCanvasGlitch\`) or a live canvas scene (HTML frame).

## Switching views

The user toggles between Editor and Canvas via the top bar. Each turn, your first action is \`editorctl get-state\` to read \`activeView\`. Never assume.

**Default = editor.** Only \`activeView: "canvas"\` activates canvas mode. If the field is missing, empty, or anything other than \`"canvas"\`, the user is in the video editor.

## Cross-mode workflows

- **Generate an image to use in canvas:** \`editorctl generate-image\` → \`editorctl canvas-add-image <path>\`
- **Generate an image to use on the timeline:** \`editorctl generate-image\` → \`editorctl import <path>\` → \`add-clip\`
- **Render a Remotion comp and use it on the timeline:** \`video_editor_render_remotion\` (auto-imports)
- **Take a canvas frame's output to the timeline:** export the frame to PNG/MP4 yourself with a unique filename, then \`editorctl import\`.
`
}

function buildRemotion(): string {
  return `# 03 — Remotion (Editor Mode Only)

Remotion is React-based programmatic video composition. Use it when the desired output is a **video file** with code-driven animation.

> ⚠️ **Never use Remotion when \`activeView = "canvas"\`.** Remotion produces video files for the timeline; canvas frames are live scenes. Different systems.

## Workflow

1. Compositions live in \`remotion/src/compositions/*.tsx\` and are registered in \`remotion/src/Root.tsx\`.
2. Preview live: \`npm run remotion:studio\` (opens \`localhost:3000\`).
3. Render via MCP (auto-imports as Monet asset):
   \`\`\`
   video_editor_render_remotion {
     compositionId: "TitleCard",
     props: { title: "Episode 1", subtitle: "The Beginning" }
   }
   video_editor_render_remotion_still {
     compositionId: "KineticText",
     frame: 45,
     props: { text: "Hello World" }
   }
   \`\`\`
4. Render via CLI (then \`editorctl import\` the output):
   \`\`\`bash
   npx remotion render remotion/src/index.ts <ID> out_v1.mp4 --props '{"key":"val"}'
   \`\`\`

If \`remotion/\` doesn't exist in the working directory, scaffold it:
\`\`\`bash
mkdir -p remotion/src/compositions
cd remotion && npm init -y && npm install remotion @remotion/cli && cd ..
\`\`\`

## Built-in compositions (1920×1080, 30 fps unless noted)

| ID | Use for | Key props |
|---|---|---|
| \`TitleCard\` | Animated title with spring entrance | \`title\`, \`subtitle\`, \`backgroundColor\`, \`textColor\`, \`accentColor\` |
| \`Slideshow\` | Image crossfade montage | \`images[]\` (abs paths), \`frameDuration\`, \`transitionDuration\` |
| \`VideoWithTitle\` | Video file with animated title overlay | \`videoSrc\`, \`title\`, \`subtitle\`, \`titlePosition\`, \`overlayOpacity\` |
| \`AudioVisualizer\` | Waveform/bar visualizer | \`audioSrc\`, \`barCount\`, \`barColor\`, \`barColorPeak\`, \`mirror\` |
| \`LowerThird\` | Animated name + title graphic | \`name\`, \`title\`, \`accentColor\`, \`position\` |
| \`AnimatedCaptions\` | Word-by-word highlighted captions | \`words[{word,startFrame,endFrame}]\`, \`highlightColor\`, \`fontSize\` |
| \`KineticText\` | Staggered kinetic word animation | \`text\`, \`animationStyle\` (rise/fall/scale/blur), \`staggerFrames\` |
| \`PaperCanvas\` | Vector animation as video | \`script\` (uses \`frame\`, \`width\`, \`height\`, all Paper.js globals), \`backgroundColor\` |
| \`PhysicsScene\` | Physics simulation as video | \`setupScript\` (uses \`engine\`, \`world\`, \`width\`, \`height\`, \`Bodies\`), \`backgroundColor\`, \`wireframes\` |
| \`BrandAd\` | Brand promo card | \`logoSrc\`, \`tagline\`, \`cta\`, \`backgroundColor\`, \`accentColor\`, \`textColor\` |
| \`HtmlInCanvasGlitch\` | RGB-split glitch via \`<HtmlInCanvas>\` | \`title\`, \`subtitle\`, \`backgroundColor\`, \`textColor\`, \`accentColor\`, \`glitchIntensity\` |

## \`<HtmlInCanvas>\` (Remotion ≥ 4.0.455)

Renders a live DOM tree into a \`<canvas>\`, then post-processes with Canvas 2D / WebGL / WebGPU — perfect for glitch, magnifying glass, CRT, displacement effects.

Authoring rules (violating these breaks rendering):
1. Author inside \`onPaint({ canvas, element, elementImage })\`.
2. **Always call \`ctx.drawElementImage(...)\`** at least once — that's how the DOM gets onto the canvas.
3. **Reapply the returned transform** to \`element.style.transform\` so layout stays in sync.
4. **Never nest \`<HtmlInCanvas>\` inside another \`<HtmlInCanvas>\`.**
5. \`Config.setChromiumOpenGlRenderer('angle')\` is already set in \`remotion.config.ts\` — leave it.

> Don't conflate this with Monet canvas HTML frames (\`canvas-add-frame ... html\`). Same words, totally different systems. Pick by destination: timeline/video → Remotion; canvas tab → Monet HTML frame.

## Tips

- Duration is in **frames** (30 fps by default; 150 frames = 5 s).
- Use \`useCurrentFrame()\` and \`spring()\` for animation timing.
- Rendered MP4 lands in \`remotion-renders/\` and is auto-imported when using MCP.
- Always use a fresh output filename (\`out_v1.mp4\`, \`out_v2.mp4\`, …) — never overwrite.
`
}

function buildCanvasTools(): string {
  return `# 04 — Canvas Tools (Canvas Mode Only)

Monet Canvas is a multi-frame artboard. Each frame is a sandboxed iframe running one of three modes: **paperjs**, **matterjs**, or **html**. There are exactly three creative paths.

> **Reminder:** When \`activeView = "canvas"\`, the user must pick one of the three options. There is no design mode, no editable layers, no Figma-style layout. Do not invent a fourth option.

## Always wrap canvas work with a loading indicator

\`\`\`bash
editorctl canvas-loading "Drawing…"
# … do the work …
editorctl canvas-done
\`\`\`

## Destruction warning

**Never** run \`canvas-clear\`, \`canvas_clear\`, \`canvas-delete-frame\`, \`canvas_delete_frame\` unless the user **explicitly** said to delete or clear. Adding a new frame does not require clearing first.

## Core editorctl canvas commands

\`\`\`bash
editorctl canvas-frames                            # list all frames (id, name, mode, w, h)
editorctl canvas-add-frame <name> <w> <h> [mode]   # mode: paperjs|matterjs|html (default paperjs)
editorctl canvas-run-paperjs <frameId> "<script>"
editorctl canvas-run-matterjs <frameId> "<script>"
editorctl canvas-run-html <frameId> "<html>"
editorctl canvas-update-frame <frameId> [name=X] [width=N] [height=N]
editorctl canvas-add-image <path>                  # add a generated/imported image as a frame
editorctl canvas-set-zoom <zoom>                   # 0.05 .. 8.0
editorctl canvas-loading "msg"
editorctl canvas-done
\`\`\`

## Option 1 — Paper.js (vector drawing, animation)

Globals available in scope: \`Path\`, \`Shape\`, \`CompoundPath\`, \`Group\`, \`Layer\`, \`PointText\`, \`Raster\`, \`Color\`, \`Gradient\`, \`GradientStop\`, \`Point\`, \`Size\`, \`Rectangle\`, \`Matrix\`, \`SymbolDefinition\`, \`SymbolItem\`, \`view\`, \`project\`, \`layer\`.

\`\`\`javascript
new Path.Circle({ center: view.center, radius: 80, fillColor: '#5b82f7' })
new Path.Star({ center: view.center, points: 5, radius1: 40, radius2: 90, fillColor: '#f07178' })
new PointText({ point: view.center, content: 'Hello', fillColor: 'white', fontSize: 64, fontWeight: 700, justification: 'center' })

// Animation
view.onFrame = function(e) { circle.rotate(2); circle.position.y = height/2 + Math.sin(e.time*3)*100; };

// Boolean ops
path1.unite(path2); path1.subtract(path2); path1.intersect(path2);
\`\`\`

## Option 2 — Matter.js (physics)

Globals: \`Engine\`, \`Render\`, \`Runner\`, \`Bodies\`, \`Body\`, \`Composite\`, \`World\`, \`Constraint\`, \`Events\`, \`Mouse\`, \`MouseConstraint\`, \`width\`, \`height\`, \`engine\`, \`render\`.

### Two valid script patterns — pick ONE, never mix

**Pattern A — self-contained** (rich custom UIs):
\`\`\`javascript
const { Engine, Bodies, Composite } = Matter;
const engine = Engine.create({ gravity: { y: 1.5 } });
const canvas = document.querySelector('canvas');   // never element: document.body
const ctx = canvas.getContext('2d');
Composite.add(engine.world, [Bodies.rectangle(width/2, height+25, width, 50, { isStatic: true })]);
function loop() { Engine.update(engine, 1000/60); ctx.clearRect(0,0,width,height); /* draw */ requestAnimationFrame(loop); }
loop();
\`\`\`

**Pattern B — bodies only** (template owns the engine):
\`\`\`javascript
// Do NOT redeclare engine/render/Engine — template uses var
var ground = Bodies.rectangle(width/2, height+25, width, 50, { isStatic: true, render: { fillStyle: '#334155' } });
var ball = Bodies.circle(width/2, 50, 30, { restitution: 0.8, render: { fillStyle: '#5b82f7' } });
Composite.add(engine.world, [ground, ball]);
engine.gravity.y = 1;
\`\`\`

### Hard rules (violations produce a blank canvas)

| Rule | Why |
|---|---|
| Never \`element: document.body\` in \`Render.create\` | Spawns a hidden second canvas |
| In Pattern B, never declare \`const engine\` / \`let engine\` / \`const { Engine } = Matter\` | Template uses \`var\` — redeclare = SyntaxError |
| In Pattern A, never also call \`Render.run\`/\`Runner.run\` | Double loop = frozen output |
| \`Runner.run\` requires two args: \`Runner.run(Runner.create(), engine)\` | 0.20.0 requirement |
| Always \`document.querySelector('canvas')\` | The iframe has exactly one canvas |

## Option 3 — GPT image 2 (AI-generated image)

\`\`\`bash
editorctl generate-image "<prompt>" [size] [quality] [background] [format]
editorctl edit-image "<prompt>" <input1> [input2...] [size=...] [mask=<assetId|path>]

# Then add the result to the canvas:
editorctl canvas-add-image <pathReturnedAbove>
\`\`\`

## HTTP bridge fallback

\`\`\`bash
curl -s -X POST http://localhost:51847 -H 'Content-Type: application/json' -d '{"command":"canvas_get_frames"}'
curl -s -X POST http://localhost:51847 -H 'Content-Type: application/json' -d '{"command":"canvas_add_frame","args":{"name":"My Frame","width":1280,"height":720,"mode":"paperjs"}}'
curl -s -X POST http://localhost:51847 -H 'Content-Type: application/json' -d '{"command":"canvas_run_paperjs","args":{"frameId":"<id>","script":"..."}}'
\`\`\`

## MCP canvas tools

\`canvas_get_frames\`, \`canvas_add_frame\`, \`canvas_run_paperjs\`, \`canvas_run_matterjs\`, \`canvas_update_frame\`, \`canvas_paperjs_draw_shape\`, \`canvas_paperjs_draw_text\`, \`canvas_paperjs_animate\`, \`canvas_matterjs_scene\`, \`canvas_matterjs_add_bodies\`, \`canvas_set_zoom\`. Use \`canvas_clear_canvas\` and \`canvas_delete_frame\` only when the user explicitly asks.
`
}

function buildEditorTools(): string {
  return `# 05 — Editor Tools (Timeline)

Use these when \`activeView = "editor"\`. Everything is a deterministic \`editorctl\` command — prefer it over UI instructions or HTTP bridge calls.

## Project & state

\`\`\`bash
editorctl get-state
editorctl list-assets
editorctl list-sequences
editorctl list-tracks [sequenceId]
editorctl list-clips [sequenceId]
editorctl list-markers [sequenceId]
editorctl get-asset-segments <assetId>
editorctl import <path...>
\`\`\`

## Sequences

\`\`\`bash
editorctl activate-sequence <sequenceId>
editorctl set-sequence-size <width> <height> [sequenceId]   # e.g. 1080 1920 for portrait
\`\`\`

## Tracks & clips

\`\`\`bash
editorctl add-track <video|audio|caption>
editorctl add-clip <assetId> <trackId> <startTime> [duration] [inPoint]
editorctl move-clip <clipId> <startTime>
editorctl trim-clip <clipId> [inPoint] [duration] [startTime]
editorctl split-clip <clipId> <time>
editorctl duplicate-clip <clipId> [offsetSeconds]
editorctl rename-clip <clipId> <label>
editorctl remove-clip <clipId>
editorctl ripple-delete-clip <clipId>
editorctl ripple-insert-gap <time> <duration> [sequenceId]
\`\`\`

## Effects (\`add-effect <clipId> <type> [k=v ...]\`)

Types: \`fade_in\`, \`fade_out\`, \`color_grade\`, \`blur\`, \`sharpen\`, \`transform\`, \`opacity\`, \`blend_mode\`, \`text_overlay\`, \`speed_ramp\`, \`drop_shadow\`, \`glow\`, \`chroma_key\`.

Examples:
\`\`\`bash
editorctl add-effect clip_1 color_grade brightness=0.1 contrast=1.2 saturation=1.1
editorctl add-effect clip_1 fade_in duration=1.0
editorctl add-effect clip_1 text_overlay text="Hello" x=100 y=100 fontSize=48
editorctl set-effect-keyframes <clipId> <effectId> <json>
\`\`\`

## Properties

\`\`\`bash
editorctl set-speed <clipId> <0.1..10>
editorctl set-volume <clipId> <0..2>          # 1 = normal, 2 = 200%
editorctl set-transition <clipId> <in|out> <crossfade|dip_to_black|wipe|slide|null> [duration]
\`\`\`

## Markers & captions

\`\`\`bash
editorctl add-marker <time> <label> [duration] [color] [seqId]
editorctl remove-marker <markerId> [sequenceId]
editorctl generate-captions <assetId> [sequenceId]
\`\`\`

## Search & AI

\`\`\`bash
editorctl search-segments "<query>" [limit]
editorctl batch-selects "<query>" [limit] [padding] [sequenceName]   # auto-build a selects sequence
editorctl batch-markers "<query>" [limit] [seqId]                    # auto-place markers
editorctl transcribe <assetId> [language]
editorctl generate-image "<prompt>" [size] [quality] [background] [format]
editorctl edit-image "<prompt>" <input1> [...] [mask=<id|path>]
\`\`\`

## Utilities & export

\`\`\`bash
editorctl extract-frames <assetId> [count]
editorctl contact-sheet <assetId> [count]
editorctl set-playhead <time>
editorctl select-clip <clipId|none>
editorctl select-asset <assetId|none>
editorctl export /absolute/output_v1.mp4 [quality] [resolution] [format]
\`\`\`

## API bridge — only when no editorctl equivalent

\`\`\`bash
curl -s -X POST http://localhost:51847 -H 'Content-Type: application/json' -d '{"command":"undo"}'
curl -s -X POST http://localhost:51847 -H 'Content-Type: application/json' -d '{"command":"redo"}'
curl -s -X POST http://localhost:51847 -H 'Content-Type: application/json' -d '{"command":"embed-assets"}'
\`\`\`

## Editing rules

- Treat unintended timeline gaps as bugs. Verify with \`list-clips\` after tightening cuts.
- For audio on multi-clip timelines, **merge first** — see \`06-essentials.md\`.
- Always export to a new unique filename (\`final_v1.mp4\`, \`final_v2.mp4\`, …).
- Prefer deterministic commands over asking the user to perform UI steps.
`
}

function buildEssentials(binDir?: string): string {
  const fallbackBlock = binDir
    ? `\n\nMonet keeps \`editorctl\` on PATH for every shell it starts (the bin dir is also persisted to your shell rc). If \`command -v editorctl\` returns nothing, fall back in order:

1. \`"${binDir}/editorctl"\` — Monet's bundled CLI shim
2. \`"$HOME/Library/Application Support/Monet/bin/editorctl"\` — macOS install path
3. \`node /Applications/Monet.app/Contents/Resources/app.asar.unpacked/out/cli/cli/editorctl.js\` — packaged app
4. \`node ./out/cli/cli/editorctl.js\` — dev tree

Never give up after the first "command not found".`
    : ''
  return `# 06 — Essentials (Read Once, Apply Always)

Cross-cutting rules that apply regardless of mode.

## Finding \`editorctl\`${fallbackBlock}

## Output file naming — never reuse a filename

The asset cache holds onto previous file contents by path. Writing to the same name silently shows stale content.

- ✅ \`clip_v1.mp4\`, \`clip_v2.mp4\`, \`clip_20260503_141502.mp4\`
- ❌ Overwriting \`clip.mp4\` repeatedly

Applies to **all** outputs the UI loads: video renders (Remotion, FFmpeg), image generations (GPT image 2, edits), canvas exports, thumbnails. If a target path already exists, append \`_v2\`, \`_v3\`, … or a timestamp.

## Audio on multi-clip timelines

When the user asks to add audio (music/voiceover/SFX) and the active sequence has more than one video clip, audio gets cut at every clip boundary. Required flow:

1. Tell the user, in plain language:
   > *"To keep the audio from cutting between clips, I'll merge all video clips into one combined video first, then add the audio. The individual clips will still exist in your project. OK to proceed?"*
2. Wait for confirmation. Do **not** auto-merge.
3. Concatenate every video clip into one continuous file (new unique filename, e.g. \`merged_v1.mp4\`).
4. Replace the multi-clip video track with the merged clip.
5. Add the audio track on top.

Single-clip timelines: skip the merge.

## Brand rule — fetch tokens before designing

> **NO EXCEPTIONS.** If the user's message contains any URL or domain (e.g. \`spotify.com\`, \`https://linear.app\`, \`notion.so\`), fetch the page and extract brand tokens **before** writing a single line of canvas/design code. Do not use memorized brand colors even for well-known brands.

\`\`\`bash
# Step 1 — colors, fonts, border-radius
curl -sL "<url>" | grep -Eo '(#[0-9a-fA-F]{3,8}|font-family:[^;"}]+|font-size:[^;"}]+|border-radius:[^;"}]+)' | sort -u | head -60

# Step 2 — logo
curl -sL "<url>" | grep -Eo '(src|href)="[^"]*logo[^"]*"' | head -10
curl -sL "<url>" | grep 'og:image'
\`\`\`

Extract before coding: background/surface, primary/accent, text colors, font families, font sizes/weights, border radius, spacing, shadows, and the logo. Hard-code those exact values.

If fetch fails, tell the user and ask for the hex values. Never fall back to guessing.

## Control surface priority

1. \`editorctl\` in this terminal
2. MCP tools if wired into your host agent
3. \`http://localhost:51847\` HTTP bridge as last resort
4. \`window.__monetCanvas.*\` only inside DevTools / Playwright

## "The app" means Monet, not the filesystem

If the user asks about "the app", "what's in the editor", screenshots, assets, or clips — start with \`editorctl get-state\` / \`list-assets\`, not a filesystem search. Refresh live state before acting whenever the project may have changed.
`
}
