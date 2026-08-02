"""Load one Kokoro voice and synthesize a JSON manifest of WAV files.

Manifest shape: { "langCode": "a", "voice": "af_heart",
                  "items": [ { "text": "...", "wavPath": "..." }, ... ] }

Install once:  pip install kokoro soundfile   (plus system `espeak-ng`).
Kokoro voice models download automatically on first run and are cached locally,
so generation is fully offline after that. The app itself never calls Kokoro;
this is a build-time step that produces the bundled MP3s.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import soundfile as sf
from kokoro import KPipeline

SAMPLE_RATE = 24000  # Kokoro's native rate; the JS step re-encodes to 22.05 kHz MP3.
# Slightly slower than default for a calm, child-friendly pace.
SPEED = 0.9


def synthesize(pipeline: KPipeline, text: str, voice: str) -> np.ndarray:
    chunks = []
    for result in pipeline(text, voice=voice, speed=SPEED):
        # Kokoro versions yield either a Result object (.audio) or a
        # (graphemes, phonemes, audio) tuple.
        audio = getattr(result, "audio", None)
        if audio is None:
            audio = result[2]
        # Convert a torch tensor to numpy when needed.
        to_numpy = getattr(audio, "detach", None)
        audio = audio.detach().cpu().numpy() if to_numpy else np.asarray(audio)
        chunks.append(audio.astype(np.float32).reshape(-1))
    if not chunks:
        raise SystemExit(f"Kokoro produced no audio for: {text!r}")
    return np.concatenate(chunks)


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("Usage: generate_kokoro_batch.py <manifest.json>")

    manifest = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    pipeline = KPipeline(lang_code=manifest["langCode"])
    voice = manifest["voice"]

    for item in manifest["items"]:
        audio = synthesize(pipeline, item["text"], voice)
        wav_path = Path(item["wavPath"])
        wav_path.parent.mkdir(parents=True, exist_ok=True)
        sf.write(str(wav_path), audio, SAMPLE_RATE)


if __name__ == "__main__":
    main()
