# AI Video Editor — Agent Control Reference

## ⚠️ OUTPUT FILE NAMING — MANDATORY (read this first)

**Never reuse a filename when editing or regenerating a video or image.** The asset cache holds the previous file by path, so writing to the same name silently shows stale content. Every edit/regenerate must produce a **new unique filename** (e.g. `clip_v1.mp4`, `clip_v2.mp4`, or a timestamp suffix). Applies to all video renders, image generations, canvas exports, and thumbnails. If a target path already exists, append `_v2`, `_v3`, … — do not overwrite.

## ⚠️ AUDIO ON MULTI-CLIP TIMELINES — MANDATORY

When adding audio to a timeline with **more than one video clip**, audio cuts at every clip boundary. Required flow:

1. Tell the user: *"To keep audio from cutting between clips, I'll merge all video clips into one combined video first, then add the audio. OK to proceed?"*
2. Wait for confirmation — do not auto-merge.
3. Concatenate all clips into a single new file (unique filename per the rule above).
4. Replace the multi-clip video track with that merged clip, then add the audio.

Single-clip timelines: skip the merge.

---

## ⚠️ CANVAS MODE — MANDATORY RULES (read this first)

When `activeView=canvas` is reported by the hook or `editorctl get-state`:

**There are EXACTLY 3 canvas options. No others exist.**
1. **Paper.js** — code drawing with vector graphics (`canvas-run-paperjs`)
2. **Matter.js** — physics and animation (`canvas-run-matterjs`)
3. **GPT image 2** — AI-generated image (`generate-image` + `canvas-add-image`)

**REMOVED — do NOT offer these under any name:**
- ~~Design mode~~ — removed
- ~~Editable layers~~ — removed
- ~~Figma-style layout~~ — removed
- ~~Node-based design~~ — removed
- ~~Direct canvas design~~ — removed

When the user asks for something visual in canvas mode, present ONLY these three options using these EXACT labels. Copy them verbatim. Do not invent a fourth option or rephrase option 1 as anything design-related.

---

**API Bridge:** `POST http://localhost:51847` — JSON body `{"command":"<name>","args":{...}}`

```python
import urllib.request, json

def call(command, **args):
    data = json.dumps({"command": command, "args": args}).encode()
    req = urllib.request.Request(
        "http://localhost:51847", data=data,
        headers={"Content-Type": "application/json"}, method="POST"
    )
    return json.loads(urllib.request.urlopen(req).read())["result"]

call("ping")   # → {"status":"ok","version":"1.0.0","port":51847}
call("help")   # → full command list
```

---

## Commands

### Project / Settings
| Command | Args | Returns |
|---------|------|---------|
| `get_project` | — | Full project JSON |
| `get_settings` | — | Model + provider config |

### Assets
| Command | Args | Returns |
|---------|------|---------|
| `list_assets` | — | `[{id, name, path, type, duration, semantic}]` |
| `get_asset` | `assetId` | Single asset with semantic + transcript |
| `import_files` | `paths: string[]` | Imported asset records |
| `transcribe_asset` | `assetId`, `language?` | `{segments}` via Whisper |
| `embed_assets` | `all?: bool` | `{embedded, total}` via text-embedding-3-small |
| `search_media` | `query, limit?` | Cosine similarity search (falls back to keyword) |
| `search_spoken` | `query, limit?` | Substring search within transcribed segments |

### Sequences & Tracks
| Command | Args | Returns |
|---------|------|---------|
| `list_sequences` | — | All sequences |
| `create_sequence` | `name` | New sequence |
| `activate_sequence` | `sequenceId` | Activated sequence |
| `get_tracks` | — | `[{id, name, kind, clipCount}]` for active sequence |
| `add_track` | `kind: video\|audio\|caption` | Updated sequence |

### Clips
| Command | Args | Returns |
|---------|------|---------|
| `list_clips` | `sequenceId?` | All clips sorted by startTime, with trackKind |
| `add_clip` | `assetId, trackId, startTime, duration?, inPoint?` | `{clipId, clip}` |
| `remove_clip` | `clipId` | `{success}` |
| `move_clip` | `clipId, startTime` | `{success}` |
| `trim_clip` | `clipId, inPoint?, duration?, startTime?` | Updated clip |
| `split_clip` | `clipId, time` | Updated sequence |
| `duplicate_clip` | `clipId, offsetSeconds?` | `{clipId, clip}` |
| `update_clip_label` | `clipId, label` | `{success}` |

### Effects & Properties
| Command | Args | Returns |
|---------|------|---------|
| `list_effects` | — | Available effects + parameter docs |
| `add_effect` | `clipId, effectType, parameters` | Updated project |
| `remove_effect` | `clipId, effectId` | Updated project |
| `set_speed` | `clipId, speed` | Updated project (0.1–10× playback) |
| `set_volume` | `clipId, volume` | Updated project (0–4, 1=normal) |
| `set_transition` | `clipId, side: in\|out, type, duration?` | `{success}` |

### History
| Command | Args |
|---------|------|
| `undo` | — |
| `redo` | — |

---

## Effect Types
| Type | Parameters |
|------|-----------|
| `fade_in` | `duration` (sec) |
| `fade_out` | `duration` (sec) |
| `color_grade` | `brightness` (-1→1), `contrast` (0.5→2), `saturation` (0→3) |
| `blur` | `radius` (px, default 5) |
| `sharpen` | `amount` (0→3, default 1) |

## Transition Types
`crossfade` · `dip_to_black` · `wipe` · `slide`

---

## Key Concepts
- `inPoint` = position in the source file where clip playback starts
- `startTime` = position on the timeline where the clip is placed
- `duration` = how long the clip plays (can be shorter than source)
- Every mutation instantly pushes `project:updated` → UI reflects changes live
- Effects are previewed in real-time (CSS) and baked via FFmpeg on export

## Editing Safety Rules
- Treat timeline gaps as a bug unless the user explicitly asks for a pause, beat, or black gap.
- After creating a sequence or moving clips, verify continuity with `list_clips(sequenceId)` and check that each clip starts exactly when the previous clip ends if the edit is meant to be continuous.
- Do not assume `create_sequence` or `activate_sequence` is enough on its own. Always verify the active sequence afterward with `list_sequences` or `get_project`.
- When building a spoken highlight cut, move video, audio, captions, and markers together. Do not leave captions or markers on old timings after tightening the edit.
- If playback appears to stop between clips, inspect the timeline first for empty gaps before assuming the preview player is broken.
- Prefer exact target starts over cumulative offset math when tightening a cut. Recompute each clip's intended `startTime` from the cut plan.

---

## Brand Aesthetic from a URL

> **MANDATORY — NO EXCEPTIONS**: If the user's message contains any URL or domain, you MUST run the fetch commands below and extract brand tokens before writing any canvas/design code. Do not use assumed or memorized brand colors. Fetch first, design second — every time. If the fetch fails, ask the user to paste the hex values; never fall back to guessing.

```bash
curl -sL "<url>" | grep -Eo '(#[0-9a-fA-F]{3,8}|font-family:[^;"}]+|font-size:[^;"}]+|border-radius:[^;"}]+)' | sort -u | head -60
```

Extract: background colors, surface colors, primary/accent colors, text colors, font families, font sizes/weights, border radii, spacing, and box-shadows. Also find the logo — it's the ground truth for brand colors and visual tone. Hard-code those exact values — never guess when a real URL is available.

```bash
# Find logo
curl -sL "<url>" | grep -Eo '(src|href)="[^"]*logo[^"]*"' | head -10
curl -sL "<url>" | grep 'og:image'
```

---

## Canvas — Matter.js Physics Frames

Use `canvas_run_matterjs` to place a live interactive physics scene on the canvas.

### MCP tools
| Tool | Args |
|------|------|
| `canvas_run_matterjs` | `id?` (frame id to update), `name?`, `script` (JS string), `width?`, `height?` |
| `canvas_add_frame` | `name`, `width`, `height`, `mode: 'matterjs'` |
| `canvas_matterjs_scene` | `style` (balls/stacks/pendulum/bridge/ragdoll), `gravity?`, `count?`, `colors?` |
| `canvas_frames` | — → `{frames: [{id, name, mode, width, height}]}` |

### Script patterns — pick ONE

**Pattern A — Self-contained (rich UIs, custom 2D drawing, rAF loop)**
```js
const { Engine, Bodies, Composite, Mouse, MouseConstraint, Events } = Matter;
const W = 390, H = 844;
const engine = Engine.create({ gravity: { y: 1.5 } });
const canvas = document.querySelector('canvas'); // ← always use this; never create a new one
canvas.width = W; canvas.height = H;
const ctx = canvas.getContext('2d');
// ... add bodies, set up mouse ...
function loop() {
  Engine.update(engine, 1000/60);
  ctx.fillStyle = '#121212'; ctx.fillRect(0, 0, W, H);
  // draw with ctx
  requestAnimationFrame(loop);
}
loop();
```

**Pattern B — Bodies only (template manages engine/render/runner)**
```js
// engine, render, width, height, and all Matter vars are already declared — do NOT redeclare them
var ground = Bodies.rectangle(width/2, height+25, width, 50, { isStatic: true, render: { fillStyle: '#334155' } });
var ball = Bodies.circle(width/2, 50, 30, { restitution: 0.8, render: { fillStyle: '#5b82f7' } });
Composite.add(engine.world, [ground, ball]);
engine.gravity.y = 1;
// Runner.run and Render.run are called automatically after this script — do not call them here
```

### Critical rules

- **`Runner.run` needs two args**: `Runner.run(Runner.create(), engine)` — single-arg `Runner.run(engine)` silently does nothing in Matter.js 0.20.0
- **Never `element: document.body`** in `Render.create` — spawns an invisible second canvas; use `canvas: document.querySelector('canvas')` instead
- **Never declare `const engine` or `let engine` in Pattern B** — the template already has `var engine`; redeclaring with `const`/`let` causes a SyntaxError that silently blanks the canvas
- **Never call `Render.run` / `Runner.run` in Pattern B** — the template does this after your script runs; calling them twice causes double-speed or broken rendering
- **Never import or redeclare Matter vars in Pattern B** — `Engine`, `Bodies`, `Composite`, etc. are already destructured; `const { Engine } = Matter` will SyntaxError

### Pattern B available globals
`engine` · `render` · `width` · `height` · `Engine` · `Render` · `Runner` · `Bodies` · `Composite` · `World` · `Body` · `Events` · `Constraint` · `Mouse` · `MouseConstraint`

### CLI
```bash
editorctl canvas-add-frame "Name" 390 844 matterjs
editorctl canvas-run-matterjs <frameId> "$(cat script.js)"
editorctl canvas-frames
editorctl canvas-done
```

---

## Remotion — React Video Composition

Use Remotion to generate animated video assets (title cards, lower thirds, slideshows, motion graphics) and import them directly into the timeline.

### MCP tools
| Tool | Args | Returns |
|------|------|---------|
| `video_editor_list_remotion_compositions` | — | List of composition IDs |
| `video_editor_render_remotion` | `compositionId, outputFilename?, props?, durationInFrames?, fps?` | `{outputPath, assetId}` |

### CLI
```bash
npm run remotion:studio                                          # live preview at localhost:3000
npx remotion render remotion/src/index.ts <ID> out.mp4 --props '{"key":"value"}'
```

### Built-in compositions
| ID | Props |
|----|-------|
| `TitleCard` | `title` (str), `subtitle?` (str), `backgroundColor`, `textColor`, `accentColor` — 150 frames @ 30fps |
| `Slideshow` | `images` (abs path[]), `frameDuration` (frames), `transitionDuration` (frames) — 300 frames @ 30fps |
| `HtmlInCanvasGlitch` | `title`, `subtitle`, `glitchIntensity` (0–40), `backgroundColor`, `textColor`, `accentColor` — 180 frames @ 30fps. RGB-split glitch via `<HtmlInCanvas>` |

### HTML-in-canvas (Remotion ≥ 4.0.455)
Use [`<HtmlInCanvas>`](https://www.remotion.dev/docs/html-in-canvas) to draw a DOM subtree into a `<canvas>` and post-process with Canvas 2D / WebGL / WebGPU. Best for glitch, magnifying glass, CRT, displacement, hue-rotate effects.

```tsx
import { HtmlInCanvas, type HtmlInCanvasOnPaint } from 'remotion'

const onPaint: HtmlInCanvasOnPaint = ({ canvas, element, elementImage }) => {
  const ctx = canvas.getContext('2d')!
  ctx.reset()
  ctx.filter = 'blur(8px)'
  const transform = ctx.drawElementImage(elementImage, 0, 0)
  element.style.transform = transform.toString() // <-- always reapply
}

<HtmlInCanvas width={1920} height={1080} onPaint={onPaint}>
  <YourDomTree />
</HtmlInCanvas>
```

Rules:
- **Always** reapply the `drawElementImage` return value to `element.style.transform` so layout/input stay correct.
- **Never** nest `<HtmlInCanvas>` inside another — Chrome paints only the outer one and Remotion throws. Merge effects into one `onPaint`.
- `Config.setChromiumOpenGlRenderer('angle')` is already set in `remotion.config.ts` so WebGL/WebGPU shaders render correctly via `npx remotion render` and our MCP renderer.
- Studio preview needs Chrome Canary ≥ 149 with `chrome://flags/#canvas-draw-element` enabled. Renders work everywhere — Remotion ships its own patched Chromium.

### Adding a composition
1. Create `remotion/src/compositions/MyComp.tsx` — export `myCompSchema` (zod) + `MyComp` component
2. Register in `remotion/src/Root.tsx` with `<Composition id="MyComp" ... />`
3. Renders go to `remotion-renders/` and are auto-imported when using the MCP tool

### Timing
- Duration is in **frames** (`durationInFrames`). Default fps = 30. 30 frames = 1 second.
- Use `useCurrentFrame()` + `spring()` + `interpolate()` for animation.

---

## Example — Minimal Edit

```python
assets = call("list_assets")
tracks = call("get_tracks")

vid = next(a for a in assets if a["type"] == "video")
vt  = next(t for t in tracks if t["kind"] == "video")

# Place first 10s of video at t=0
r = call("add_clip", assetId=vid["id"], trackId=vt["id"],
         startTime=0, duration=10, inPoint=0)
cid = r["clipId"]

# Fade in over 1s, color grade, transition out
call("add_effect", clipId=cid, effectType="fade_in", parameters={"duration": 1.0})
call("add_effect", clipId=cid, effectType="color_grade",
     parameters={"brightness": 0.05, "contrast": 1.1, "saturation": 1.2})
call("set_transition", clipId=cid, side="out", type="dip_to_black", duration=0.8)
```
