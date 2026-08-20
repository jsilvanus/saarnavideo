#!/usr/bin/env python3
"""Small stdin/stdout transcription worker for SaarnaVideo.

Input JSON:
  {"input": "/path/to/media", "language": "fi"}

Output JSON is the stable application contract defined in src/domain/transcription.ts.
"""
import json
import sys
from pathlib import Path

from faster_whisper import WhisperModel


def transcribe(model: WhisperModel, input_path: str, language: str | None):
    segments, info = model.transcribe(
        input_path,
        language=language,
        vad_filter=True,
        word_timestamps=False,
    )
    result = []
    for segment in segments:
        result.append({
            "startSeconds": float(segment.start),
            "endSeconds": float(segment.end),
            "text": segment.text.strip(),
            "confidence": max(0.0, min(1.0, float(segment.avg_logprob + 1.0))),
        })
    return {
        "version": 1,
        "language": info.language,
        "segments": result,
    }


def main() -> int:
    request = json.loads(sys.stdin.read())
    input_path = Path(request["input"])
    if not input_path.is_file():
        raise FileNotFoundError(input_path)

    model_name = request.get("model", "small")
    device = request.get("device", "cpu")
    compute_type = request.get("computeType", "int8")
    model = WhisperModel(model_name, device=device, compute_type=compute_type)
    transcript = transcribe(model, str(input_path), request.get("language"))

    # Section detection is intentionally a separate step. Do not invent semantic
    # timestamps from raw transcription in this worker.
    print(json.dumps({"transcript": transcript, "suggestions": []}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
