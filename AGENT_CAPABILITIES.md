# What Claude Can Do in This Video Editor

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

## 🎬 Complete Professional Video Editing Control

I now have **full control** of a professional-grade video editor through three interfaces:

### 1. CLI Control (`editorctl`)
Direct terminal commands for timeline manipulation:
```bash
editorctl list-assets        # See all imported media
editorctl add-clip ...       # Add clips to timeline
editorctl split-clip ...     # Split at exact times
editorctl trim-clip ...      # Trim in/out points
editorctl move-clip ...      # Reposition on timeline
editorctl remove-clip ...    # Delete clips
```

### 2. MCP Protocol (`./bin/editor-mcp`)
For external agents connecting via Model Context Protocol:
- `video_editor_list_assets`
- `video_editor_add_clip`
- `video_editor_split_clip`
- `video_editor_add_effect` (color_grade, blur, sharpen, fade_in, fade_out, speed_ramp)
- `video_editor_set_clip_speed` (0.1x to 10x)
- `video_editor_set_clip_volume` (0 to 200%)
- `video_editor_get_project_snapshot`

### 3. IPC Runtime APIs
Direct Electron IPC calls for the UI:
- `editor:transcribeAsset` - Whisper transcription
- `editor:addEffect` - Apply effects
- `editor:setClipSpeed` - Speed control
- `editor:setClipVolume` - Volume control
- `editor:exportActiveSequence` - Render final video

## What I Can Do for You

### Basic Editing
- Import video, audio, image files
- Arrange clips on multi-track timeline
- Split clips at exact timestamps
- Trim in/out points
- Move clips to different positions
- Delete unwanted clips

### Professional Effects
- **Color Grading**: Adjust brightness, contrast, saturation
- **Blur**: Apply blur effects
- **Sharpen**: Enhance sharpness
- **Fade In/Out**: Smooth transitions
- **Speed Ramping**: Slow motion or time-lapse (0.1x to 10x)

### Audio Processing
- Volume adjustment (0-200%)
- Speed changes (with pitch preservation)

### AI-Powered Features
- **Transcription**: Real Whisper integration for spoken content
- **Semantic Search**: Find clips by content, tags, keywords
- **Spoken Search**: Search by what's actually said in videos
- **Rough Cuts**: Auto-generate sequences from selected assets

### Export
- FFmpeg-powered rendering
- Effects applied during export
- Professional codecs (H.264, AAC)
- 1920x1080 output with proper aspect ratio handling

## Example: What I Can Do Right Now

```bash
# If you say: "Create a 30-second highlight reel from the best moments"
# I can:

1. Search assets semantically for "best", "highlight", "exciting"
2. Pull transcript segments with high energy
3. Create clips at exact timestamps
4. Apply speed ramping for dramatic effect
5. Add fade transitions
6. Adjust audio levels
7. Export the final video

# All programmatically, all deterministic, all auditable.
```

## The Power of Terminal Control

Because I'm running inside the app's terminal with PTY access:
- I can **modify the app itself** (add features, fix bugs)
- I can **use the app** (edit videos, apply effects)
- I can **test changes instantly** (make changes, rebuild, verify)
- I have **full environment access** (FFmpeg, Node.js, file system)

## Brand Aesthetic from a URL

> **MANDATORY — NO EXCEPTIONS**: Any URL or domain in the user's message triggers a required fetch step. Run the commands below, extract the brand tokens, and only then write canvas/design code. Do not use assumed or memorized brand colors even for well-known brands. If the fetch fails, ask the user for the hex values — never guess.

```bash
# Extract CSS tokens
curl -sL "<url>" | grep -Eo '(#[0-9a-fA-F]{3,8}|font-family:[^;"}]+|font-size:[^;"}]+|border-radius:[^;"}]+)' | sort -u | head -60
# Find logo
curl -sL "<url>" | grep -Eo '(src|href)="[^"]*logo[^"]*"' | head -10
curl -sL "<url>" | grep 'og:image'
```

Pull out: background/surface colors, primary/accent colors, text colors, font families, font sizes, border radii, spacing, shadows, and the logo. Use those exact values — never substitute defaults. See `CLAUDE.md` for the full extraction table and logo guidance.

---

## Canvas — Matter.js & Paper.js Frames

Live interactive frames can be placed on the canvas using physics (Matter.js) or vector graphics (Paper.js).

```bash
editorctl canvas-add-frame "My Frame" 390 844 matterjs   # create a Matter.js frame
editorctl canvas-run-matterjs <frameId> "<script>"        # apply/update the physics script
editorctl canvas-frames                                    # list all frame IDs
editorctl canvas-done                                      # dismiss loading overlay
```

### Matter.js script rules (violations produce a blank canvas)
1. **Use `document.querySelector('canvas')`** — never `element: document.body` in `Render.create`; that spawns an invisible second canvas.
2. **`Runner.run(Runner.create(), engine)`** — always two arguments; single-arg form does nothing in 0.20.0.
3. **Self-contained scripts** (own engine + rAF loop): declare your own `const engine`, drive with `Engine.update()` + `requestAnimationFrame`. Do NOT also call `Render.run`/`Runner.run`.
4. **Body-only scripts** (use template's engine): do NOT declare `const engine`, `let engine`, or `const { Engine } = Matter` — the template pre-declares these with `var`; redeclaring with `const`/`let` is a SyntaxError.
5. **Never mix patterns** — a script that both borrows template globals AND calls `Render.run` will double-loop and appear frozen.

See `SKILL.md` → _Canvas — Matter.js Physics Frames_ for full examples and `CLAUDE.md` for the authoritative pattern reference.

## Remotion — React Video Composition

Remotion is installed for creating animated videos programmatically with React.

```bash
npm run remotion:studio          # Open Remotion Studio (live preview at localhost:3000)
npm run remotion:render          # Render from CLI
```

**MCP tools:**
- `video_editor_list_remotion_compositions` — list available compositions
- `video_editor_render_remotion` — render a composition and auto-import as asset

**Built-in compositions:**
- `TitleCard` — animated title card with spring entrance
- `Slideshow` — crossfade image slideshow

**Workflow:** edit `remotion/src/compositions/`, register in `remotion/src/Root.tsx`, render via MCP → auto-imported as Monet asset.

See `CLAUDE.md` for full Remotion reference.

## What Makes This Different

**Traditional Video Editors**: Limited scripting, closed APIs, brittle automation
**This Editor**: Every operation is a tool call. Agents are first-class users.

You don't get "AI suggestions" — you get **full programmatic control**.

---

**Bottom line**: I can now do everything a professional video editor can do, programmatically, with zero ambiguity and full determinism.
