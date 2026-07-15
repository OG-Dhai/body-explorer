# Body Explorer MVP Roadmap

## Completed

- **Codebase Analysis**: Complete codebase analysis and inventory audit.
- **Core Application & Entry Point**: Single-page entry point (`index.html`, `src/main.js`, `src/style.css`) with splash screen, webcam container, Three.js container, and language toggle.
- **Core Architecture Layer**:
  - Configuration manager (`src/core/config.js`) detailing landmarks and target mappings.
  - Decoupled publish-subscribe event system (`src/core/eventBus.js`).
  - Multi-language translation engine (`src/core/i18n.js`) with dictionary mappings for 5 languages (en, de, fr, es, ru).
  - General-purpose finite state machine (`src/core/stateMachine.js`).
- **Input Layer**: HTML5 webcam capture and frame extractor (`src/input/cameraService.js`).
- **Perception Layer**:
  - Web Worker dispatcher (`src/perception/poseService.js`) with backpressure control and selfie-mirror transformation.
  - Off-thread MediaPipe vision worker (`src/perception/poseWorker.js`) using local WASM tasks.
  - Perceived luminance lighting quality checker (`src/perception/lightingAnalyzer.js`).
- **Math Layer**: Exponential Moving Average smoothing filter (`src/math/spatialMath.js`) and body-size-based adaptive hitboxes.
- **Game Engine Layer**:
  - Game progression FSM (`src/engine/gameEngine.js`) coordinating Easy, Medium, and Hard difficulty levels.
  - Hold proximity validation machine (`src/engine/holdDetector.js`) tracking proximity hold frames.
  - Multi-tiered question generator (`src/engine/questionBank.js`) dynamically filtering out occluded joints.
  - Scoring module (`src/engine/scoringSystem.js`) recording fast reaction bonuses and streaks.
  - Average landmark visibility tracker (`src/engine/visibilityTracker.js`) keeping a 60-frame history.
- **3D Visual Scene Layer**:
  - Three.js renderer (`src/scene/sceneManager.js`) drawing bones, joints, and hold progress rings.
  - 2D layout overlay (`src/scene/hudOverlay.js`) animating timers, streaks, levels, and feedback messages.
  - Float-panel developer controller (`src/scene/debugUI.js`) forcing state changes and level jumping.
- **Audio & TTS Layer**:
  - Audio Context manager (`src/audio/audioEngine.js`) utilizing decoders and oscillator fallbacks.
  - Preloaded localized spoken voice assets for 5 languages (`public/audio/{en,de,fr,es,ru}/edu/*.mp3`).
- **Verification Scripts**:
  - Puppeteer headless manual FPS check utility (`scripts/manual-fps-check.mjs`) saving snapshots and measuring frame rates.
- **Testing**:
  - Vitest framework configured with 91 unit tests across 14 test files covering core, engine, input, math, and perception layers.
  - Integrated `npm run test:fps` for manual Puppeteer FPS profiling.

- **Offline PWA Support**: Implemented Service Worker for zero-network execution and caching.
- **Performance Profiling**: Optimized Hot loops in Three.js and Float32Array migrations for 60 FPS lockdown.

## In Progress

- [ ] **Phase 5**: Final Release Validation (Checklist and Documentation).

## Planned

- [ ] MVP Release.

## Postponed

- [ ] Local offline TTS audio generation setup (postponed: pre-generated Piper narrations are bundled for all 5 languages; embedding the Piper runtime adds unnecessary complexity and bundle size).

## Technical Debt

- [ ] **Checklist failures on Windows**: Python master checklist script fails due to console emoji encoding errors unless overridden with `PYTHONIOENCODING=utf-8`.
- [ ] **UX/SEO Check Failures**: Page audits are failing since standard webpage accessibility and metadata features are missing from this canvas-based game overlay.
- [ ] **MediaPipe WASM loader patch**: `patchMediapipeLoader()` in `vite.config.js` patches two upstream bugs in `@mediapipe/tasks-vision@0.10.35` (see comment in file). Must be re-verified on package upgrade.
- [ ] **Build dependency risk**: Since the vendored WASM runtime fallback was removed, a working `node_modules/` install (or internet access for a fresh `npm install`) is now REQUIRED before running `npm run build` on any new machine — there is no offline fallback.
