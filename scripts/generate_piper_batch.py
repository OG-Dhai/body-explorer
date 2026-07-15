"""Load one Piper model and synthesize a JSON manifest of WAV files."""

from __future__ import annotations

import json
import sys
import wave
from pathlib import Path

from piper import PiperVoice
from piper.config import SynthesisConfig


def main() -> None:
    if len(sys.argv) != 2:
        raise SystemExit("Usage: generate_piper_batch.py <manifest.json>")

    manifest_path = Path(sys.argv[1])
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    voice = PiperVoice.load(
        manifest["modelPath"],
        config_path=manifest["configPath"],
    )
    synthesis_config = SynthesisConfig(
        speaker_id=manifest.get("speaker"),
        length_scale=1.15,
    )

    for item in manifest["items"]:
        wav_path = Path(item["wavPath"])
        wav_path.parent.mkdir(parents=True, exist_ok=True)
        with wave.open(str(wav_path), "wb") as wav_file:
            voice.synthesize_wav(
                item["text"],
                wav_file,
                syn_config=synthesis_config,
            )


if __name__ == "__main__":
    main()
