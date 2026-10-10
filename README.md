# Body Explorer

A webcam game that teaches young children (roughly ages 3–7) to recognise the
parts of their own body by touching them. The game says *"Touch your nose!"* out
loud, the child touches it in front of the camera, and on-device computer vision
confirms the touch. No controllers, no tapping a screen.

Everything runs locally. No camera data ever leaves the device, and once loaded
the game works fully offline.

## Features

- **Learn by moving.** The child uses their own body as the controller instead
  of sitting still and tapping.
- **Private and offline.** Pose, hand, and face tracking all run on-device with
  MediaPipe. No cloud, no accounts, no network calls during play. It installs as
  a PWA and keeps working with no connection.
- **Five languages.** English, German, French, Spanish, and Russian, each with
  its own spoken prompts.
- **Three difficulty levels.** Easy, Medium, and Hard. The tolerance scales with
  the child's size; only the pace tightens on harder levels.
- **Badges, a how-to-play tutorial, and gentle feedback.** A bright chime for a
  correct touch and a soft nudge to try again, never a harsh buzzer.

## How to play

Pick a difficulty, allow the camera, and follow the spoken instruction. Touch
the body part it names and hold for a moment so it registers. Get enough right
to clear the level and move on.

## Getting started

You need Node 18+, a webcam, and a modern browser (Chromium works best).

```bash
npm install     # also pulls the MediaPipe WASM runtime used by the build
npm run dev     # http://localhost:5173
```

```bash
npm run build   # production build into dist/
npm run preview # serve the production build locally
```

Run `npm install` before building, since the WASM runtime is copied out of
`node_modules` at build time.

## How recognition works

Three MediaPipe landmarkers run in Web Workers (`src/perception/`):

| Model (`src/wasm/mediapipe/`) | Role |
|---|---|
| `hand_landmarker.task` | 21-point hand tracking to find the index fingertip, the point the child touches with |
| `pose_landmarker_full.task` | body-part locations (shoulders, hips, knees, and so on) |
| `face_landmarker.task` | precise face points (nose, eyes, ears, mouth), only turned on for face questions |

A touch is judged in `src/engine/hitValidator.js`, all in normalized image space
(distances are divided by shoulder width, so tolerances scale with how far the
child is from the camera). It counts only when the fingertip is inside the hit
radius of the asked part, that part is the *nearest* one (so a neighbour can't
win it), and the hand actually makes and holds contact rather than passing
through. The tunables live in `CONFIG.detection.hit` (`src/core/config.js`).

The model files are Apache-2.0, from Google's MediaPipe model pages, and are
committed under `src/wasm/mediapipe/`. Each worker loads its model with
`new URL(...)`, so the build bundles them automatically. There are no API keys
and nothing to provision.

## Voice narration

The spoken prompts are pre-generated MP3s under `public/audio/`, so the running
app never calls a text-to-speech service. It just plays the bundled files, which
keeps it offline and private. You only need to regenerate them when the wording
changes.

The text is read from one place, the localization dictionary in
`src/core/i18n.js` (`edu.*`, `fact.*`, `voice.*` keys), and one clip is written
per key per language.

```bash
npm run audio:generate         # rebuild only the clips whose text changed
npm run audio:generate:check   # check the engines/models are ready and print the plan
node generate_edu_audio.js --force   # rebuild everything
node generate_edu_audio.js en es     # limit to certain languages
```

Each clip's source text is fingerprinted in `audio-hashes.json`, so a normal
`npm run audio:generate` only touches the clips you actually changed.

Voices are picked per language for the most natural result:

| Language | Engine | Voice |
|----------|--------|-------|
| English (`en`) | Kokoro | `af_heart` |
| Spanish (`es`) | Kokoro | `ef_dora` |
| French (`fr`)  | Kokoro | `ff_siwis` |
| German (`de`)  | Piper  | `de_DE-thorsten-medium` |
| Russian (`ru`) | Piper  | `ru_RU-denis-medium` |

One-time setup for regenerating audio:

```bash
# Kokoro (en, es, fr) plus system espeak-ng for phonemes
pip install kokoro soundfile
#   macOS: brew install espeak-ng     Debian/Ubuntu: apt-get install espeak-ng

# Piper (de, ru) and its voice models
pip install piper-tts
python -m piper.download_voices --download-dir piper_models \
  de_DE-thorsten-medium ru_RU-denis-medium
```

`ffmpeg` is used to encode the final MP3s. Kokoro's own models download on first
run and cache locally, so generation is offline after that.

## Project structure

```
src/
  core/         config, i18n, palette, state machine, event bus
  perception/   camera + MediaPipe pose/hand/face workers and services
  engine/       game loop, hit validation, hold timing, scoring, badges, questions
  scene/        Three.js overlay, HUD, debug panel
  audio/        Web Audio engine
  math/         small vector/EMA helpers
  wasm/         MediaPipe model files
public/         audio, icons, badges, favicon, manifest, service worker
scripts/        dev and build tooling (TTS batches, image optimizer, browser checks)
```

## Testing

```bash
npm test                    # unit tests (Vitest)
npm run test:browser:facts  # headless browser check of the feedback flow (needs a dev server)
npm run test:fps            # render performance check
```

## Debug mode

Add `?debug=true` to the URL for a live FPS/frame-drop readout and a panel to
skip levels or force game states.

## Requirements and limits

- The room needs decent light. Strong backlight or near-darkness hurts tracking;
  a built-in lighting check warns when it's too dark.
- The child should stand back far enough for the camera to see their upper body.
  Parts that aren't in frame are skipped.
- Needs a modern browser with Service Worker, WASM, WebGL, and camera support.
  iOS Safari may need permissions enabled manually.

## Credits

- Music: "Bassa Island Game Loop" Kevin MacLeod (incompetech.com). Licensed under Creative Commons: By Attribution 4.0 License, http://creativecommons.org/licenses/by/4.0/
- Sound effects `error`, `success`, `fireworks` and `wellDone`: "GUI Sound Effects" by Lokif (OpenGameArt), CC0 1.0. `click.mp3` comes from an open-source sound library according to the author; its exact source and licence are pending recovery.
- MediaPipe model files: Google, Apache License 2.0 ([`LICENSE-APACHE-2.0.txt`](LICENSE-APACHE-2.0.txt)).

Details: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
