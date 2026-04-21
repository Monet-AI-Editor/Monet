# AI Video Editor - Quick Start for Agents

## You Have Full Control

As an agent running in the embedded terminal, you have **complete professional video editing capabilities**:

### Direct Timeline Control
```bash
# List what's available
editorctl list-assets
editorctl list-sequences
editorctl list-clips seq_main

# Add clips to timeline
editorctl add-clip asset_abc123 track_video_0 0 5.5 0

# Edit timeline
editorctl split-clip clip_123 2.5
editorctl move-clip clip_123 10.0
editorctl trim-clip clip_123 1.5
editorctl remove-clip clip_123
```

### Professional Features You Can Use

**Effects** (via IPC or MCP):
- Color grading (brightness, contrast, saturation)
- Blur & sharpen
- Fade in/out
- Speed ramping (0.1x to 10x)

**Audio**:
- Volume control (0-200%)
- Speed adjustment

**AI Processing**:
- Whisper transcription (requires OpenAI API key)
- Semantic media search
- Spoken-content search

### MCP Integration
For external agents, start the MCP server:
```bash
./bin/editor-mcp
```

Then use MCP tools like:
- `video_editor_add_clip`
- `video_editor_add_effect`
- `video_editor_set_clip_speed`
- `video_editor_set_clip_volume`

### Environment Variables
- `AI_VIDEO_EDITOR_ROOT` - Project root directory
- `AI_VIDEO_EDITOR_SKILL` - Path to SKILL.md
- `AI_VIDEO_EDITOR_PROJECT` - Custom project file path

### Example: Complete Edit Workflow

```bash
# 1. Check what assets are available
editorctl list-assets

# 2. Get IDs and create a sequence
editorctl list-sequences
editorctl list-clips seq_main

# 3. Add clips to timeline
editorctl add-clip asset_xyz track_video_0 0 10 0
editorctl add-clip asset_abc track_video_0 10 5 2.5

# 4. Split and trim
editorctl split-clip clip_001 5.0
editorctl trim-clip clip_001_a 1.0

# 5. Export (use UI or IPC)
# The app will render with all effects applied
```

## What You Can Do Now

**As a professional video editor, you can:**
- Import and organize media assets
- Build complex multi-track timelines
- Apply professional effects and transitions
- Transcribe spoken content with Whisper
- Search by semantic meaning or spoken words
- Export final videos with FFmpeg

**All operations are deterministic, auditable, and scriptable.**

You have full control. Use it wisely.
