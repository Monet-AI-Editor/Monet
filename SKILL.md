# AI Video Editor — Agent Control Reference

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
