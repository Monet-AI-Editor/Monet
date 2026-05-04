# Monet — Claude Agent Guide

## ⚠️ OUTPUT FILE NAMING — MANDATORY (read this first)

**Never reuse a filename when editing or regenerating a video or image.** Electron/Chromium and the asset cache hold onto the previous file by path, so writing to the same name silently shows the old content. Every edit/regenerate must produce a **new unique filename**.

- ✅ `clip_v1.mp4`, `clip_v2.mp4`, `clip_v3.mp4` … (or timestamp/short hash suffix)
- ❌ Overwriting `clip.mp4` again and again
- Applies to: video renders (Remotion, FFmpeg), image generations (GPT image 2, edits), canvas exports, thumbnails — anything written to disk that the UI then loads.
- If an output path already exists, append `_v2`, `_v3`, … or a timestamp (`_YYYYMMDD_HHMMSS`). Do **not** delete-and-rewrite the same path.

## ⚠️ AUDIO ON MULTI-CLIP TIMELINES — MANDATORY

When adding audio (music, voiceover, SFX) to a timeline that has **more than one video clip**, audio gets cut at every clip boundary. To avoid this:

1. **Tell the user first**, in plain language: *"To keep the audio from cutting between clips, I'll merge all your video clips into a single combined video first, then layer the audio over it. The individual clips will still exist in your project. OK to proceed?"*
2. **Wait for confirmation.** Do not auto-merge.
3. After confirmation, concatenate every video clip into one continuous file (use a new unique filename per the rule above — e.g. `merged_v1.mp4`).
4. Replace the multi-clip video track with that single merged clip.
5. Then add the audio track on top.

If there is only one video clip, skip the merge and add audio directly. Never add audio across multiple clips without the merge + user confirmation.

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

## ⚠️ BRAND RULE — NO EXCEPTIONS (applies to ALL canvas work)

**If the user's message contains ANY URL or domain name (e.g. `spotify.com`, `https://linear.app`, `notion.so`), you MUST fetch that page and extract brand tokens BEFORE writing a single line of canvas/design code.**

Do not use assumed or memorized brand colors. Do not skip this step even if you think you know the brand. **Fetch first, design second — every time.**

```bash
# Step 1 — extract colors, fonts, border-radius
curl -sL "<url>" | grep -Eo '(#[0-9a-fA-F]{3,8}|font-family:[^;"}]+|font-size:[^;"}]+|border-radius:[^;"}]+)' | sort -u | head -60

# Step 2 — find logo
curl -sL "<url>" | grep -Eo '(src|href)="[^"]*logo[^"]*"' | head -10
curl -sL "<url>" | grep 'og:image'
```

Extract and hard-code before coding: background & surface colors, primary/accent colors, text colors, font families, font sizes/weights, border radius, and logo. Never guess — if fetch fails, tell the user and ask them to paste the hex values.

---

Monet is an Electron video editor with terminal-first AI agent control. You have three interfaces:
1. **MCP tools** (`video_editor_*`) — live timeline control via the MCP server
2. **CLI** (`editorctl`) — direct commands from this terminal
3. **HTTP API** — POST to `http://localhost:51847`

## Remotion — React-based Video Composition

Remotion is installed and ready. Use it to create animated videos, title cards, lower thirds, slideshows, and anything that's easier to express in React than to FFmpeg-filter.

### File layout
```
remotion/
  src/
    index.ts          # Entry point (do not edit)
    Root.tsx          # Register new compositions here
    compositions/
      TitleCard.tsx   # Animated title card (props: title, subtitle, colors)
      Slideshow.tsx   # Image slideshow (props: images[], frameDuration, transitionDuration)
```

### Workflow

**1. Preview in Remotion Studio**
```bash
npm run remotion:studio
# Opens http://localhost:3000 — live preview as you edit
```

**2. Add a new composition**
- Create `remotion/src/compositions/MyComp.tsx`
- Export a `myCompSchema` (zod) and `MyComp` component
- Register it in `remotion/src/Root.tsx` with a `<Composition>` entry

**3. Render via MCP (auto-imports into Monet)**
```
video_editor_render_remotion {
  compositionId: "TitleCard",
  props: { title: "Episode 1", subtitle: "The Beginning" }
}

video_editor_render_remotion_still {
  compositionId: "KineticText",
  frame: 45,
  props: { text: "Hello World" }
}
```
The rendered MP4/PNG is saved to `remotion-renders/` and **automatically imported** as a project asset.

**4. Render via CLI**
```bash
npx remotion render remotion/src/index.ts TitleCard out.mp4 --props '{"title":"Hello"}'
```

### Built-in compositions

| ID | Description | Key props |
|----|-------------|-----------|
| `TitleCard` | Animated title with spring entrance | `title`, `subtitle`, `backgroundColor`, `textColor`, `accentColor` |
| `Slideshow` | Image crossfade slideshow | `images` (array of absolute paths), `frameDuration`, `transitionDuration` |
| `VideoWithTitle` | Video file with animated title overlay | `videoSrc` (abs path), `title`, `subtitle`, `titlePosition`, `overlayOpacity` |
| `AudioVisualizer` | Waveform/bar visualizer from audio file | `audioSrc` (abs path), `barCount`, `barColor`, `barColorPeak`, `mirror` |
| `LowerThird` | Animated name/title lower third | `name`, `title`, `accentColor`, `position` (left/center/right) |
| `AnimatedCaptions` | Word-by-word highlighted captions | `words` [{word, startFrame, endFrame}], `highlightColor`, `fontSize`, `position` |
| `KineticText` | Staggered kinetic word animation | `text`, `animationStyle` (rise/fall/scale/blur), `staggerFrames`, `fontSize` |
| `HtmlInCanvasGlitch` | HTML-in-canvas RGB-split glitch | `title`, `subtitle`, `glitchIntensity`, `backgroundColor`, `textColor`, `accentColor` |

### HTML-in-canvas (Remotion ≥ 4.0.455)

We support [`<HtmlInCanvas>`](https://www.remotion.dev/docs/html-in-canvas) — draw a live DOM node into a `<canvas>` and post-process it with Canvas 2D / WebGL / WebGPU. Use this for effects that are easier to express as DOM + shader than to recreate in pure canvas (glitch, magnifying glass, CRT, hue-rotate, displacement, vintage screen).

- Already enabled in `remotion.config.ts` via `Config.setChromiumOpenGlRenderer('angle')`, so renders use the right GL backend by default.
- Author new compositions like `remotion/src/compositions/HtmlInCanvasGlitch.tsx`: wrap children in `<HtmlInCanvas width height onPaint>`, do the post-processing inside `onPaint({ canvas, element, elementImage })`, and **always** call `ctx.drawElementImage(elementImage, x, y)` and assign the returned transform back to `element.style.transform` so input/layout stays correct.
- **Do NOT nest `<HtmlInCanvas>`** inside another `<HtmlInCanvas>` — Chrome only paints the outer one and Remotion throws. Merge effects into a single `onPaint` callback.
- Studio preview requires Chrome Canary (≥ 149) with `chrome://flags/#canvas-draw-element` enabled. Renders via `npx remotion render` / `video_editor_render_remotion` work everywhere — Remotion ships its own patched Chromium for rendering.

### Tips
- Duration is in **frames** (30fps by default). 150 frames = 5 seconds.
- Use `useCurrentFrame()` and `spring()` for animation.
- `durationInFrames` can be overridden per render call.
- Rendered videos land in `remotion-renders/` as MP4 — drag into the Monet timeline or use `video_editor_render_remotion` which auto-imports.
- Zod schemas on compositions let you pass typed props from MCP.

## Brand Aesthetic from a URL

> **MANDATORY — NO EXCEPTIONS**
> If the user's message contains any URL or domain name (e.g. `spotify.com`, `https://linear.app`, `notion.so`), you **MUST** fetch that page and extract its brand tokens **before writing a single line of canvas/design code**. Do not use assumed or memorized brand colors. Do not skip this step even if you think you know the brand. Fetch first, design second — every time.

```bash
# Step 1 — fetch HTML and extract CSS tokens
curl -sL "<url>" | grep -Eo '(#[0-9a-fA-F]{3,8}|font-family:[^;"}]+|font-size:[^;"}]+|border-radius:[^;"}]+)' | sort -u | head -60

# Step 2 — find logo
curl -sL "<url>" | grep -Eo '(src|href)="[^"]*logo[^"]*"' | head -10
curl -sL "<url>" | grep 'og:image'
```

Or use the WebFetch / browser tool to read the live page and its `<style>` tags / inline CSS.

**Extract and note before coding:**
| Token | Where to look |
|-------|--------------|
| Background & surface colors | `background`, `background-color`, CSS variables like `--bg`, `--surface` |
| Primary / accent colors | Buttons, links, active states, `--primary`, `--accent` |
| Text colors | `color` on `body`, headings, muted text |
| Font families | `font-family` on `body` or headings |
| Font sizes & weights | `font-size`, `font-weight` on headlines vs body |
| Border radius | Cards, buttons, avatars |
| Spacing scale | Padding/margin on cards and containers |
| Shadows | `box-shadow` values |
| **Logo** | `<img>` with `logo` in src/alt/class, inline `<svg>` in header/nav, `og:image` meta tag |

**Also extract the logo.** The logo shape, color usage, and style (wordmark vs icon vs combination) tells you the brand's visual weight and personality. Use it to:
- Match the exact brand colors (logos are the ground truth — more reliable than CSS variables)
- Reproduce the logo mark as a canvas shape (e.g. a simplified SVG path drawn with `ctx`) when it adds authenticity to the frame
- Set the tone: a geometric minimal logo = clean spacing + sans-serif; a bold serif logo = heavier weights + tighter layout

```bash
# Find logo URLs in the page
curl -sL "<url>" | grep -Eo '(src|href)="[^"]*logo[^"]*"' | head -10
curl -sL "<url>" | grep -Eo 'content="[^"]*og:image[^"]*"' | head -5
# Or look at the og:image meta directly
curl -sL "<url>" | grep 'og:image'
```

**Then hard-code those exact values** into the Matter.js / Paper.js / HTML script.

> ⛔ **Never use assumed/memorized brand colors when a URL was provided.** If the fetch fails, tell the user and ask them to paste the hex values — do not fall back to guessing.

---

## Canvas — Matter.js Physics Frames

Use `canvas_run_matterjs` (MCP) or `editorctl canvas-run-matterjs <frameId> "<script>"` (CLI) to place a live physics scene on the canvas.

### Two valid script patterns — pick ONE, never mix

#### Pattern A — Self-contained (recommended for rich UIs)
The script creates and owns the engine, render loop, and runner. Use this when you need custom drawing (Canvas 2D API), manual `Engine.update`, or `requestAnimationFrame`.

```js
// ✅ Pattern A — self-contained
const { Engine, Bodies, Composite, Mouse, MouseConstraint, Events } = Matter;
const W = 390, H = 844;
const engine = Engine.create({ gravity: { y: 1.5 } });
const canvas = document.querySelector('canvas');   // always use THIS — do NOT create a new one
canvas.width = W; canvas.height = H;
const ctx = canvas.getContext('2d');

// add bodies, set up mouse, etc.
const ground = Bodies.rectangle(W/2, H+25, W, 50, { isStatic: true });
Composite.add(engine.world, [ground]);

function loop() {
  Engine.update(engine, 1000/60);
  ctx.clearRect(0, 0, W, H);
  // draw everything with ctx here
  requestAnimationFrame(loop);
}
loop();
```

#### Pattern B — Simple bodies only (for quick physics scenes)
Do NOT declare `engine`, `render`, `runner`, or Matter vars — the template provides them. Just add bodies and configure gravity. The template handles `Render.run` and `Runner.run`.

```js
// ✅ Pattern B — template-managed (engine, render, width, height are already declared)
var ground = Bodies.rectangle(width/2, height+25, width, 50, { isStatic: true, render: { fillStyle: '#334155' } });
var ball = Bodies.circle(width/2, 50, 30, { restitution: 0.8, render: { fillStyle: '#5b82f7' } });
Composite.add(engine.world, [ground, ball]);
engine.gravity.y = 1;
```

### Rules — read before writing any Matter.js script

| Rule | Why |
|------|-----|
| **Never use `element: document.body` in `Render.create`** | Creates a hidden second canvas; the visible canvas stays blank |
| **If using Pattern B, never declare `const engine` or `let engine`** | Conflicts with the template's `var engine` → SyntaxError → blank canvas |
| **If using Pattern A, never also call `Render.run` / `Runner.run` from Pattern B setup** | Double render loop = glitchy or invisible output |
| **Always use `document.querySelector('canvas')` for the canvas element** | The iframe has exactly one canvas; this is always the right one |
| **`Runner.run` requires TWO args: `Runner.run(Runner.create(), engine)`** | Matter.js 0.20.0 — single-arg `Runner.run(engine)` silently does nothing |
| **Wrap custom draw logic in `Events.on(render, 'afterRender', ...)` when using Pattern B** | Lets Matter.js Render handle the rAF loop while you overlay custom 2D drawing |

### Available globals in Pattern B scripts
```
engine    render    width    height
Engine    Render    Runner   Bodies   Composite   World
Body      Events    Constraint   Mouse   MouseConstraint
```

### Common mistake — mixing patterns (broken)
```js
// ❌ BROKEN — declares const engine (conflicts with template's var engine)
const { Engine, Bodies } = Matter;          // SyntaxError: can't redeclare
const engine = Engine.create();             // never reached
const canvas = document.querySelector('canvas');
Render.create({ element: document.body }); // creates invisible second canvas
```

### Canvas CLI commands
```bash
editorctl canvas-add-frame "My Frame" 390 844 matterjs        # create new frame
editorctl canvas-run-matterjs <frameId> "$(cat script.js)"    # apply script
editorctl canvas-frames                                        # list frames + IDs
editorctl canvas-done                                          # clear loading overlay
```

## Other editor capabilities

See `AGENT_CAPABILITIES.md` for the full MCP tool list and `SKILL.md` for detailed API reference.
