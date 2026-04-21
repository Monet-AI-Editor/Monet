import json
import os
import sys

from faster_whisper import WhisperModel


def main() -> int:
    if len(sys.argv) < 2:
        print("Usage: local_transcribe.py <media-path> [language]", file=sys.stderr)
        return 1

    media_path = sys.argv[1]
    language = sys.argv[2] if len(sys.argv) > 2 and sys.argv[2] else None
    model_name = os.environ.get("AI_VIDEO_EDITOR_LOCAL_STT_MODEL", "tiny")
    device = os.environ.get("AI_VIDEO_EDITOR_LOCAL_STT_DEVICE", "cpu")
    compute_type = os.environ.get("AI_VIDEO_EDITOR_LOCAL_STT_COMPUTE", "int8")

    model = WhisperModel(model_name, device=device, compute_type=compute_type)
    segments, info = model.transcribe(
        media_path,
        language=language,
        vad_filter=True,
        beam_size=5,
    )

    payload = {
        "language": getattr(info, "language", None),
        "duration": getattr(info, "duration", None),
        "segments": [],
    }

    for index, segment in enumerate(segments):
        payload["segments"].append(
            {
                "id": f"local_{index}",
                "start": float(segment.start),
                "end": float(segment.end),
                "text": segment.text.strip(),
            }
        )

    json.dump(payload, sys.stdout)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
