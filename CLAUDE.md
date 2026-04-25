# Monet — Claude Agent Guide

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

### Tips
- Duration is in **frames** (30fps by default). 150 frames = 5 seconds.
- Use `useCurrentFrame()` and `spring()` for animation.
- `durationInFrames` can be overridden per render call.
- Rendered videos land in `remotion-renders/` as MP4 — drag into the Monet timeline or use `video_editor_render_remotion` which auto-imports.
- Zod schemas on compositions let you pass typed props from MCP.

## Other editor capabilities

See `AGENT_CAPABILITIES.md` for the full MCP tool list and `SKILL.md` for detailed API reference.
