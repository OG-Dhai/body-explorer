# Body Explorer 3D

An interactive, educational computer-vision game designed to help children learn body awareness in a fun, gamified way.

## Features
- **Offline-First PWA**: Can be played entirely offline with no cloud dependencies once installed.
- **Privacy-First Tracking**: Uses local WebAssembly (MediaPipe) for pose tracking. No camera data ever leaves the device.
- **60 FPS Rendering**: Highly optimized Three.js rendering overlay.
- **Multilingual**: Supports English, German, French, Spanish, and Russian, complete with localized voice-overs.
- **Dynamic Difficulty**: Adjusts hitboxes based on the child's body size and dynamically filters occluded targets (e.g. feet out of frame).

## Installation & Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Run Development Server:**
   ```bash
   npm run dev
   ```

3. **Build for Production:**
   ```bash
   npm run build
   ```

4. **Preview Production Build:**
   ```bash
   npm run preview
   ```

## Development & Debugging

**Debug Mode:**
Add `?debug=true` to the URL (e.g., `http://localhost:5173/?debug=true`).
This enables:
- A live FPS and frame-drop tracker in the top-left corner.
- A floating debug panel to manually skip levels, trigger states, or bypass gameplay phases.

## Testing

- **Unit Tests:** Run `npm run test:unit` to test core engine logic (spatial math, scoring, hold detection).
- **Browser Tests:** With a dev server running, `npm run test:browser:facts` runs a headless Puppeteer check of the fact-feedback flow, and `npm run test:fps` measures render performance.

## Narration Audio (offline TTS)

Narration is **pre-generated** at build time and bundled as MP3s under
`public/audio/{lang}/{edu,fact,voice}/`. The running app never calls a TTS
service — it only plays the bundled files, so it stays fully offline and
private. Regeneration is only needed when the narration text changes.

Voices are chosen **per language** for the most natural, child-friendly result
(see `ENGINE_BY_LANG` in `generate_edu_audio.js`):

| Language | Engine | Voice |
|----------|--------|-------|
| English (`en`) | Kokoro | `af_heart` |
| Spanish (`es`) | Kokoro | `ef_dora` |
| French (`fr`)  | Kokoro | `ff_siwis` |
| German (`de`)  | Piper  | `de_DE-thorsten-medium` |
| Russian (`ru`) | Piper  | `ru_RU-denis-medium` |

Kokoro is used where its quality/coverage is strong; Piper is retained for the
rest. Every language also keeps a Piper voice in `PIPER_MODELS` as a fallback.

### One-time install

```bash
# Kokoro (English, Spanish, French) — plus system espeak-ng for phonemes
pip install kokoro soundfile
#   macOS:  brew install espeak-ng      Debian/Ubuntu: apt-get install espeak-ng

# Piper (German, Russian) and its voice models
pip install piper-tts
python -m piper.download_voices --download-dir piper_models \
  de_DE-thorsten-medium ru_RU-denis-medium

# ffmpeg is used to encode the final MP3s (any recent build)
```

Kokoro voice models download automatically on first run and are cached locally,
so generation is offline after that.

### Generate / verify

```bash
npm run audio:generate           # generate clips that are missing OR whose text changed
npm run audio:generate:check     # verify engines/models are ready, print the plan
node generate_edu_audio.js --force        # rebuild every clip regardless of state
node generate_edu_audio.js en es          # limit to specific languages
```

Each clip's source text is fingerprinted in `audio-hashes.json`, so
`npm run audio:generate` regenerates **only the clips whose narration changed** —
no `--force` needed after a wording edit.

Narration text is read from the single source of truth — the localization
dictionary in `src/core/i18n.js` (`edu.*`, `fact.*`, `voice.*` keys) — and one
clip is written per key per language. `en`/`de` intentionally use non-verbal
feedback, so they have no `voice/` folder.

### Adding a language

1. Add the locale and its `edu.*` / `fact.*` (and optionally `voice.*`) strings
   to `DICTIONARY` in `src/core/i18n.js`.
2. In `generate_edu_audio.js`, set the engine in `ENGINE_BY_LANG` and add a
   `KOKORO_MODELS` entry (Kokoro `langCode` + `voice`) **or** a `PIPER_MODELS`
   entry (voice + model SHA-256).
3. Run `npm run audio:generate:check`, then `npm run audio:generate`.

## Recognition (on-device, offline)

"Recognition" here is **webcam body-pose recognition**, not tapping or speech: the
child physically touches their own body part and on-device computer vision
confirms it. Everything runs locally via MediaPipe Tasks-Vision — no camera data
leaves the device and no network calls are made at runtime.

Three landmarkers run in Web Workers (`src/perception/`):

| Model file (`src/wasm/mediapipe/`) | Role |
|---|---|
| `hand_landmarker.task` | 21-point hand tracking → the **index fingertip**, the point the child touches with |
| `pose_landmarker_full.task` | body-part target locations (shoulders, hips, knees, …) |
| `face_landmarker.task` | precise face-part targets (nose/eyes/ears/mouth), activated only for face questions |

A hit is decided in `src/engine/hitValidator.js`, entirely in **normalized image
space** (x/y ÷ shoulder width, so tolerances scale with the child's size). A touch
confirms only when the fingertip is (1) within the hit radius of the asked part,
(2) closest to the *asked* part rather than a neighbour, and (3) actually makes
contact and holds — not a drive-through hover. A light depth check (pose world-z)
rejects a hand held in front of the torso. All tunables live in
`CONFIG.detection.hit` (`src/core/config.js`).

The model files are Apache-2.0, from Google's MediaPipe model pages, and are
committed under `src/wasm/mediapipe/`. They are bundled automatically at build
time (via `new URL(...)` in each worker) — **no API keys and nothing to supply**.
The older `pose_landmarker_lite.task` is no longer used and can be deleted.

## Known Limitations
- **Lighting Requirements:** The app requires a decently lit room. Backlighting or extreme darkness will heavily degrade pose tracking. A built-in lighting analyzer will warn users if lighting is poor.
- **Camera Visibility:** The child needs to be reasonably far back so the camera can see their upper body or full body. Targets not visible will be skipped.
- **Mobile Browsers:** Service Workers and WASM binaries require modern browsers. iOS Safari may require specific settings for WebGL and Camera permissions.
