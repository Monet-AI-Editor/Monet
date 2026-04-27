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

## Step 1 — run at the start of EVERY reply, not just once

The user can switch between Video Editor and Monet Canvas at any time during the conversation.
\`activeView\` may have changed since your last message. **Check it every turn.**

\`\`\`bash
editorctl get-state
\`\`\`

Read \`activeView\` in the output — it decides everything:

| activeView | What to do |
|---|---|
| \`"editor"\` | Work on the video timeline: clips, tracks, effects, Remotion, import assets |
| \`"canvas"\` | Draw on Monet Canvas. **Do NOT use Remotion. Do NOT use \`editorctl import\`.** Ask the user draw-vs-photo first. If drawing: \`canvas-run-paperjs\`/\`canvas-run-matterjs\`. If image: \`generate-image\` then \`canvas-add-image\`. |

**Remotion (npx remotion render, video_editor_render_remotion) is for the video editor ONLY. Never use it when activeView is "canvas".**

---

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

Use Remotion to create animated video assets directly in this working directory. If \`remotion/\` does not exist here yet, scaffold it yourself:

\`\`\`bash
mkdir -p remotion/src/compositions
cd remotion
npm init -y
npm install remotion @remotion/cli
cd ..
\`\`\`

Then create compositions in \`remotion/src/compositions/MyComp.tsx\`, register them in \`remotion/src/Root.tsx\`, and render:

\`\`\`bash
npx remotion render remotion/src/index.ts <CompositionId> output.mp4 --props '{"key":"val"}'
npx remotion still remotion/src/index.ts <CompositionId> output.png --frame=30
npx remotion studio remotion/src/index.ts   # live preview at localhost:3000
\`\`\`

After rendering, import into Monet: \`editorctl import /absolute/path/to/output.mp4\`

MCP tools (auto-import): \`video_editor_list_remotion_compositions\`, \`video_editor_render_remotion\`, \`video_editor_render_remotion_still\`

## Monet Canvas — Paper.js & Matter.js

> **CANVAS CLARIFICATION RULE:** When \`activeView\` is \`"canvas"\` and the user asks you to "generate", "create", "draw", or "make" something visual, **always ask first in plain language before doing anything**. Do not mention Paper.js, Matter.js, or technical library names — the user may not know what those are. Ask like this:
>
> *"Quick question before I start — do you want me to **draw this in code** directly on the canvas (shapes, animation, physics — fully editable), or **generate it as an image using GPT image generation** (AI-rendered photo/illustration that gets imported into your timeline)?"*
>
> - If they say draw / code / canvas / animate / interactive / editable → use \`canvas_run_paperjs\` or \`canvas_run_matterjs\`
> - If they say photo / image / realistic / AI image / GPT / import / timeline → use \`generate_image\` or \`editorctl generate-image\`
> - If unclear → default to drawing in the canvas, tell them what you're doing, and offer: *"I'm drawing this in code on the canvas — let me know if you'd prefer a GPT-generated image instead."*
>
> Never assume. Always ask first when in canvas mode.

The Monet Canvas tab (switch at the top bar) has artboard-based design with three frame modes:
- **html** — raw HTML/CSS/JS (default)
- **paperjs** — full Paper.js vector graphics API, live preview in sandboxed iframe
- **matterjs** — full Matter.js 2D physics simulation, live in sandboxed iframe

### Decision guide: which surface to use

| Goal | Surface | Command |
|------|---------|---------|
| Vector illustration / graphic | Canvas → Paper.js frame | \`editorctl canvas-run-paperjs\` |
| Physics simulation (interactive) | Canvas → Matter.js frame | \`editorctl canvas-run-matterjs\` |
| Export physics animation as video | Remotion → PhysicsScene | \`video_editor_render_remotion\` |
| Export Paper.js artwork as video | Remotion → PaperCanvas | \`video_editor_render_remotion\` |
| Animated lower-third / title card | Remotion → LowerThird / TitleCard | \`video_editor_render_remotion\` |
| HTML design for social/thumbnail | Canvas → HTML frame | \`editorctl canvas-add-frame\` |
| Add motion to existing video clip | Timeline + Effects | \`editorctl add-effect\` |

### Control priority (use the first one that works)

1. **\`editorctl canvas-*\`** — fastest, use in this terminal first
2. **MCP \`canvas_*\` tools** — if MCP is wired in your host agent
3. **curl → http://localhost:51847** — HTTP fallback
4. **\`window.__monetCanvas.*\`** — DevTools console only

### Before and after doing canvas work — show a loading indicator

Always wrap canvas work with loading state so the user sees progress:

\`\`\`bash
editorctl canvas-loading "Drawing glitchy logo…"
# ... do the actual canvas work (canvas-add-frame, canvas-run-paperjs, etc.) ...
editorctl canvas-done
\`\`\`

This shows an animated grid on the canvas while you work, and clears it when done.

### editorctl canvas commands (use these first)

\`\`\`bash
editorctl canvas-frames                              # list all frames (id, name, mode, w, h)
editorctl canvas-add-frame <name> <w> <h> [mode]    # mode: html|paperjs|matterjs
editorctl canvas-run-paperjs <frameId> "<script>"   # set Paper.js script on frame
editorctl canvas-run-matterjs <frameId> "<scene>"   # set Matter.js scene on frame
editorctl canvas-update-frame <frameId> [name=X] [width=N] [height=N]
editorctl canvas-delete-frame <frameId>
editorctl canvas-clear
editorctl canvas-set-zoom <zoom>                     # e.g. 0.5, 1.0, 2.0
\`\`\`

### MCP canvas tools

\`\`\`
canvas_get_frames         — list all frames (id, name, mode, w, h, hasContent)
canvas_add_frame          — create frame with name/width/height/mode
canvas_run_paperjs        — set ANY Paper.js script on a frame
canvas_run_matterjs       — set ANY Matter.js scene on a frame
canvas_update_frame       — update name, size, html, or script
canvas_delete_frame       — delete frame by ID
canvas_paperjs_draw_shape — generate Paper.js snippet: circle/rect/star/polygon
canvas_paperjs_draw_text  — generate Paper.js styled PointText snippet
canvas_paperjs_animate    — generate Paper.js onFrame animation snippet
canvas_matterjs_scene     — generate full Matter.js scene: ballpit/chain/stack/pendulum/ragdoll
canvas_matterjs_add_bodies— generate code to append bodies to existing scene
canvas_clear_canvas       — remove all frames
canvas_set_zoom           — set viewport zoom (0.05–8.0)
\`\`\`

### window.__monetCanvas (DevTools / Playwright)

\`\`\`javascript
window.__monetCanvas.addFrame(name, w, h, html)
window.__monetCanvas.addPaperFrame(name, w, h, script)
window.__monetCanvas.addMatterFrame(name, w, h, scene)
window.__monetCanvas.setFrameMode(id, mode, content) // switch existing frame mode
window.__monetCanvas.setFrameHtml(id, html)
window.__monetCanvas.getFrames()          // [{id,name,mode,width,height}]
window.__monetCanvas.getFramesDetailed()  // full data incl. script
window.__monetCanvas.selectFrame(id)
window.__monetCanvas.deleteFrame(id)
window.__monetCanvas.clearAll()
window.__monetCanvas.fitAll()
window.__monetCanvas.setZoom(z)
\`\`\`

### Paper.js full API (paperjs frames + PaperCanvas Remotion)

Globals in scope: \`Path\`, \`Shape\`, \`CompoundPath\`, \`Group\`, \`Layer\`, \`PointText\`, \`Raster\`,
\`Color\`, \`Gradient\`, \`GradientStop\`, \`Point\`, \`Size\`, \`Rectangle\`, \`Matrix\`,
\`view\`, \`project\`, \`layer\`

**Paths**
\`\`\`javascript
new Path.Circle({ center: view.center, radius: 80, fillColor: '#5b82f7' })
new Path.Rectangle({ point: [x,y], size: [w,h], fillColor: 'red', radius: 8 })
new Path.Ellipse({ center: view.center, radius: new Size(120, 60) })
new Path.Line({ from: [0,0], to: [width,height], strokeColor: 'white', strokeWidth: 2 })
new Path.RegularPolygon({ center: view.center, sides: 6, radius: 100 })
new Path.Star({ center: view.center, points: 5, radius1: 40, radius2: 90, fillColor: '#f07178' })
// Custom bezier path
var p = new Path({ strokeColor: 'white', strokeWidth: 2 });
p.add(new Point(100, 200)); p.curveTo(new Point(200,100), new Point(300,200));
p.smooth(); p.simplify(); p.closePath();
\`\`\`

**Text**
\`\`\`javascript
new PointText({ point: view.center, content: 'Hello',
  fillColor: 'white', fontSize: 64, fontWeight: 700, justification: 'center' })
\`\`\`

**Colors & Gradients**
\`\`\`javascript
new Color(0.35, 0.51, 0.97)                       // RGB 0..1
new Color('#f07178')                               // hex
new Color({ hue: 220, saturation: 0.8, brightness: 0.9 })  // HSB
var g = new Gradient([new GradientStop(new Color('#7aa2f7'),0), new GradientStop(new Color('#f07178'),1)]);
shape.fillColor = new Color(g, new Point(0,0), new Point(width,height));
\`\`\`

**Transforms**
\`\`\`javascript
item.rotate(45);                  // around item center
item.rotate(45, view.center);    // around point
item.scale(2);  item.scale(1.5, 0.5);
item.translate(dx, dy);
item.opacity = 0.7;
item.blendMode = 'multiply';     // +23 other CSS blend modes
item.shadowColor = new Color(0,0,0,0.5); item.shadowOffset = new Point(4,4); item.shadowBlur = 8;
\`\`\`

**Boolean operations** (returns new path)
\`\`\`javascript
path1.unite(path2)    // union
path1.subtract(path2) // difference
path1.intersect(path2)
path1.exclude(path2)  // xor
path1.divide(path2)
\`\`\`

**Animation (in canvas iframe)**
\`\`\`javascript
view.onFrame = function(event) {
  // event.time (seconds), event.delta, event.count
  circle.rotate(2);
  circle.position.y = height/2 + Math.sin(event.time * 3) * 100;
};
\`\`\`

**Symbols & cloning**
\`\`\`javascript
var sym = new SymbolDefinition(path);
for (var i = 0; i < 20; i++) {
  var inst = new SymbolItem(sym);
  inst.position = Point.random().multiply(view.size);
  inst.scale(0.5 + Math.random());
}
\`\`\`

**Export** (in canvas iframe or browser context)
\`\`\`javascript
var svg = project.exportSVG({ asString: true });
var png = view.element.toDataURL('image/png');
\`\`\`

### Matter.js full API (matterjs frames + PhysicsScene Remotion)

Pre-declared in frame scope: \`Engine\`, \`Render\`, \`Runner\`, \`Bodies\`, \`Body\`,
\`Composite\`, \`World\`, \`Constraint\`, \`Events\`, \`Mouse\`, \`MouseConstraint\`,
\`width\`, \`height\`, \`engine\`, \`render\`

**Creating bodies**
\`\`\`javascript
Bodies.rectangle(x, y, w, h, options)
Bodies.circle(x, y, radius, options)
Bodies.polygon(x, y, sides, radius, options)     // 3=triangle, 6=hexagon, etc.
Bodies.trapezoid(x, y, w, h, slope, options)
Bodies.fromVertices(x, y, [{x,y},...], options)  // custom convex shape
\`\`\`

**Body options**
\`\`\`javascript
{
  isStatic: true,           // immovable (ground, walls)
  restitution: 0.8,         // bounce 0..1
  friction: 0.1,            // surface grip
  frictionAir: 0.01,        // air resistance
  density: 0.001,
  angle: Math.PI / 4,       // initial rotation (radians)
  velocity: { x: 5, y: -10 },
  angularVelocity: 0.1,
  label: 'ball',
  render: { fillStyle: '#5b82f7', strokeStyle: '#3b5fcf', lineWidth: 2, opacity: 1 }
}
\`\`\`

**Composites (built-in layouts)**
\`\`\`javascript
var { Composites } = Matter;
Composites.stack(x, y, cols, rows, colGap, rowGap, (x,y) => Bodies.circle(x,y,20))
Composites.pyramid(x, y, cols, rows, colGap, rowGap, (x,y) => Bodies.rectangle(x,y,40,40))
Composites.newtonsCradle(x, y, number, size, length)
Composites.chain(comp, 0.5, 0, -0.5, 0, { stiffness: 0.8 })
Composite.add(world, stack);
\`\`\`

**Constraints (joints & springs)**
\`\`\`javascript
Constraint.create({ bodyA, bodyB, length: 100, stiffness: 1 })              // rigid link
Constraint.create({ bodyA, bodyB, stiffness: 0.01, damping: 0.1 })         // spring
Constraint.create({ bodyA, pointB: { x: 400, y: 100 }, stiffness: 0.9 })  // pin to world
Composite.add(world, constraint);
\`\`\`

**Forces & velocity**
\`\`\`javascript
Body.applyForce(body, body.position, { x: 0, y: -0.05 });
Body.setVelocity(body, { x: 10, y: -15 });
Body.setAngularVelocity(body, 0.3);
Body.setPosition(body, { x: 400, y: 300 });
Body.setStatic(body, true);  // make dynamic body static at runtime
\`\`\`

**World & engine**
\`\`\`javascript
engine.gravity.y = 1;            // down (default)
engine.gravity.y = -1;           // up
engine.gravity.x = 0.3;          // sideways component
engine.gravity.y = 0;            // zero-g / space
engine.timing.timeScale = 0.5;   // slow motion (< 1) or fast-forward (> 1)
\`\`\`

**Events (in canvas iframe)**
\`\`\`javascript
Events.on(engine, 'collisionStart', (e) => {
  e.pairs.forEach(({ bodyA, bodyB }) => { /* ... */ });
});
Events.on(engine, 'beforeUpdate', () => { /* runs every tick */ });
\`\`\`

**Mouse interaction (in canvas iframe)**
\`\`\`javascript
var mouse = Mouse.create(render.canvas);
var mc = MouseConstraint.create(engine, { mouse, constraint: { stiffness: 0.2 } });
Composite.add(world, mc);
\`\`\`

**Querying**
\`\`\`javascript
Composite.allBodies(engine.world)           // all bodies
Matter.Query.point(bodies, { x, y })        // bodies under point
Matter.Query.region(bodies, bounds)         // bodies in rectangle
Matter.Query.ray(bodies, start, end)        // raycast
\`\`\`

### Remotion compositions for motion design (render to video)

| ID | Input props | Best for |
|----|------------|---------|
| \`PaperCanvas\` | \`script\` (JS: frame/fps/t/width/height + all Paper.js globals), \`backgroundColor\` | Vector art, generative, animated illustrations |
| \`PhysicsScene\` | \`setupScript\` (JS: engine/world/width/height/Bodies/Body/Composite/Constraint/Events), \`backgroundColor\`, \`wireframes\`, \`showVelocity\` | Physics animations, ballpit, pendulums |
| \`TitleCard\` | \`title\`, \`subtitle\`, \`backgroundColor\`, \`textColor\`, \`accentColor\` | Title sequences |
| \`Slideshow\` | \`images\` (abs paths[]), \`frameDuration\`, \`transitionDuration\` | Image montages |
| \`VideoWithTitle\` | \`videoSrc\`, \`title\`, \`subtitle\`, \`titlePosition\`, \`overlayOpacity\` | Video + overlay |
| \`AudioVisualizer\` | \`audioSrc\`, \`barCount\`, \`barColor\`, \`barColorPeak\`, \`mirror\` | Music visualizer |
| \`LowerThird\` | \`name\`, \`title\`, \`accentColor\`, \`position\` (left/center/right) | Name graphics |
| \`AnimatedCaptions\` | \`words\` [{word,startFrame,endFrame}], \`highlightColor\`, \`fontSize\` | Captions |
| \`KineticText\` | \`text\`, \`animationStyle\` (rise/fall/scale/blur), \`staggerFrames\` | Kinetic text |

**PaperCanvas script tips:**
- Call \`project.clear()\` at the top so each frame renders clean
- Use \`frame\` (int, 0-based) and \`t\` (0..1 over 10s) for time
- Color cycle: \`new Color(frame/300, 0.8, 0.9)\` → HSB rotating hue

**PhysicsScene setupScript tips:**
- Always add a static ground to catch bodies: \`Bodies.rectangle(width/2,height-25,width,50,{isStatic:true})\`
- \`engine.gravity.y=0\` for space/floating simulations
- Physics steps deterministically: same frame → same state, always

**Render commands:**
\`\`\`bash
# Via MCP (auto-imports into Monet):
# video_editor_render_remotion { compositionId: "PhysicsScene", durationInFrames: 300, props: { setupScript: "..." } }

# Via CLI:
npx remotion render remotion/src/index.ts PhysicsScene out.mp4 \\
  --props '{"setupScript":"engine.gravity.y=1; var b=Bodies.circle(960,50,60,{restitution:0.8,render:{fillStyle:\\"#5b82f7\\"}}); Composite.add(world,[b]);"}'
editorctl import /absolute/path/to/out.mp4
\`\`\`

## Editing rules

- treat unintended timeline gaps as bugs
- verify continuity with \`editorctl list-clips\` after tightening a cut
- prefer deterministic tool commands over asking the user to perform UI steps
- if you need media from disk, ask for or discover the absolute file path, then import it yourself
- for creative work: Canvas for interactive live preview, Remotion for final video output
\``
}

function buildClaudeBody(): string {
  return `# ⚠️ MONET AI EDITOR — READ BEFORE DOING ANYTHING

You are inside the Monet AI video editor. ALL creative and media tasks go through Monet's tools.
Do NOT use the AI SDK, Gemini, Anthropic SDK, or any external image/video generation library directly.
Run \`editorctl get-state\` first — every turn — to see where the user is.

## Step 1 — run at the start of EVERY reply turn, not just once

The user can switch between Video Editor and Monet Canvas at any time during the conversation.
Do not assume \`activeView\` is the same as your previous message. **Check it every turn.**

\`\`\`bash
editorctl get-state
\`\`\`

Read the \`activeView\` field. It decides everything below.

---

## If activeView is "canvas"

You are in the **Monet Canvas** drawing board. The user wants something drawn live on the canvas, not a file.

**What to do:**
1. Ask the user — in plain language, no jargon — before doing anything:
   *"Do you want me to draw this directly on the canvas (live, editable code), or generate it as an image using GPT image generation (photo/illustration saved as a file)?"*
2. If they say draw → use \`editorctl canvas-loading "…"\`, then \`canvas-add-frame\` + \`canvas-run-paperjs\` / \`canvas-run-matterjs\`, then \`editorctl canvas-done\`
3. If they say photo/image → use \`editorctl generate-image\`

**What NOT to do in canvas mode:**
- ❌ Do NOT use Remotion (npx remotion render, video_editor_render_remotion, etc.) — Remotion makes video files for the timeline, not canvas frames
- ❌ Do NOT create SVG, PNG, or any other file and import it
- ❌ Do NOT write to the filesystem for visual output
- ❌ Do NOT use \`editorctl generate-image\` unless the user explicitly asked for a photo/image file

**Remotion is for the video editor only. Never use it when activeView is "canvas".**

---

## If activeView is "editor"

You are in the **Video Editor** timeline view. Work on clips, tracks, assets, sequences, and effects.

- Use \`editorctl\` commands (add-clip, move-clip, add-effect, etc.)
- Use Remotion to create animated video assets and import them
- Use \`editorctl generate-image\` to create images and import them

---

## Control surface priority (both modes)

1. \`editorctl\` in this terminal
2. MCP tools if already wired
3. \`http://localhost:51847\` API bridge as last resort

---

## Canvas mode — draw vs. generate

When \`activeView\` is \`"canvas"\` and the user asks you to "generate", "create", "draw", or "make" something visual, **always ask first before doing anything**:

*"Quick question before I start — do you want me to **draw this in code** directly on the canvas (shapes, animation, physics — fully editable), or **generate it as an image using GPT image generation** (AI-rendered photo/illustration that gets imported into your timeline)?"*

- Draw / code / canvas / animate → \`canvas_run_paperjs\` or \`canvas_run_matterjs\`
- Photo / image / realistic / GPT / timeline → \`generate_image\` or \`editorctl generate-image\`
- If unclear → draw in canvas, tell the user, offer to swap.

Never assume. Always ask first when in canvas mode.


## Remotion — React video composition (editor mode ONLY)

Use Remotion to create animated video assets in this working directory. If \`remotion/\` doesn't exist, scaffold it:

\`\`\`bash
mkdir -p remotion/src/compositions
cd remotion && npm init -y && npm install remotion @remotion/cli && cd ..
\`\`\`

Render and import: \`npx remotion render remotion/src/index.ts <ID> out.mp4\` then \`editorctl import /abs/path/out.mp4\`

MCP tools (auto-import): \`video_editor_list_remotion_compositions\`, \`video_editor_render_remotion\`, \`video_editor_render_remotion_still\`

Built-in IDs: \`PaperCanvas\` · \`PhysicsScene\` · \`TitleCard\` · \`Slideshow\` · \`VideoWithTitle\` · \`AudioVisualizer\` · \`LowerThird\` · \`AnimatedCaptions\` · \`KineticText\`

## Full editorctl reference

Effects: \`add-effect <clipId> <type> [key=value...]\`
- types: \`fade_in\`, \`fade_out\`, \`color_grade\`, \`blur\`, \`sharpen\`, \`transform\`, \`opacity\`, \`blend_mode\`, \`text_overlay\`, \`speed_ramp\`, \`drop_shadow\`, \`glow\`, \`chroma_key\`

Speed & volume: \`set-speed <clipId> <0.1–10>\` · \`set-volume <clipId> <0–2>\`

Transitions: \`set-transition <clipId> <in|out> <crossfade|dip_to_black|wipe|slide|null> [duration]\`

Keyframes: \`set-effect-keyframes <clipId> <effectId> <json>\`

Batch AI: \`batch-selects "<query>" [limit] [padding] [sequenceName]\` · \`batch-markers "<query>" [limit] [seqId]\`

Misc: \`activate-sequence <seqId>\` · \`rename-clip <clipId> <label>\` · \`ripple-insert-gap <time> <duration>\` · \`remove-marker <markerId>\` · \`get-asset-segments <assetId>\` · \`set-playhead <time>\` · \`select-clip <clipId|none>\`

Canvas: \`canvas-frames\` · \`canvas-add-frame\` · \`canvas-run-paperjs\` · \`canvas-run-matterjs\` · \`canvas-loading "msg"\` · \`canvas-done\`

API bridge only (no editorctl): undo, redo, embed-assets — POST to http://localhost:51847 with \`{"command":"undo"}\`
`
}


function buildAgentsBody(): string {
  return `# Monet

## Step 1 — run at the start of EVERY reply turn, without exception

The user can switch views mid-conversation. \`activeView\` changes when they do.
**Check it at the start of every single response** — not just once per session.

\`\`\`bash
editorctl get-state
\`\`\`

Check \`activeView\` in the output.

---

## activeView: "canvas" → draw on the canvas

Do NOT use Remotion. Do NOT use \`editorctl import\` for canvas output.

\`generate-image\` IS allowed — but ask first. If using it:
1. \`editorctl generate-image "<prompt>"\` → get outputPath from result
2. \`editorctl canvas-add-image "<outputPath>"\` → shows in canvas AND video editor media

Ask the user first (plain language, no library names):
*"Do you want me to draw this on the canvas (live, editable code) or generate it as an image using GPT image generation?"*

If drawing:
\`\`\`bash
editorctl canvas-loading "Drawing…"
editorctl canvas-add-frame "My Frame" 1280 720 paperjs   # or matterjs or html
editorctl canvas-run-paperjs <frameId> "<script>"
editorctl canvas-done
\`\`\`

**Remotion is for the video editor timeline ONLY. Never use npx remotion or video_editor_render_remotion when activeView is "canvas".**

---

## activeView: "editor" → work on the video timeline

Canvas: \`canvas-frames\` · \`canvas-add-frame\` · \`canvas-run-paperjs\` · \`canvas-run-matterjs\` · \`canvas-loading "msg"\` · \`canvas-done\`

Clips: \`add-clip\` · \`move-clip\` · \`trim-clip\` · \`split-clip\` · \`duplicate-clip\` · \`rename-clip\` · \`remove-clip\` · \`ripple-delete-clip\` · \`ripple-insert-gap <time> <duration>\`

Effects: \`add-effect <clipId> <type> [key=value...]\` — types: \`fade_in\` \`fade_out\` \`color_grade\` \`blur\` \`sharpen\` \`transform\` \`opacity\` \`blend_mode\` \`text_overlay\` \`speed_ramp\` \`drop_shadow\` \`glow\` \`chroma_key\`

Properties: \`set-speed <clipId> <0.1–10>\` · \`set-volume <clipId> <0–2>\` · \`set-transition <clipId> <in|out> <crossfade|dip_to_black|wipe|slide|null> [dur]\` · \`set-effect-keyframes <clipId> <effectId> <json>\`

Search & AI: \`search-segments\` · \`batch-selects "<query>" [limit] [padding]\` · \`batch-markers "<query>" [limit]\` · \`transcribe\` · \`generate-image\` · \`edit-image\`

Misc: \`activate-sequence\` · \`set-sequence-size\` · \`add-marker\` · \`remove-marker\` · \`generate-captions\` · \`get-asset-segments\` · \`extract-frames\` · \`contact-sheet\` · \`set-playhead\` · \`select-clip\` · \`export\`

Remotion (editor only): \`video_editor_list_remotion_compositions\`, \`video_editor_render_remotion\`, \`video_editor_render_remotion_still\`
Built-in IDs: \`PaperCanvas\` · \`PhysicsScene\` · \`TitleCard\` · \`Slideshow\` · \`VideoWithTitle\` · \`AudioVisualizer\` · \`LowerThird\` · \`AnimatedCaptions\` · \`KineticText\`

API bridge only: undo · redo · embed-assets — POST \`{"command":"undo"}\` to http://localhost:51847
`
}
