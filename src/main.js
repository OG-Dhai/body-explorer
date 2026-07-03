import { CameraService } from './input/cameraService.js';
import { PoseService } from './perception/poseService.js';
import { playClick, playSuccess, playError, speak, dispose as disposeAudio } from './audio/audioEngine.js';
import { SceneManager } from './scene/sceneManager.js';
import { GameEngine } from './engine/gameEngine.js';
import { HUDOverlay } from './scene/hudOverlay.js';
import { EMAFilter } from './math/spatialMath.js';
import eventBus from './core/eventBus.js';
import { i18n } from './core/i18n.js';

const statusEl = document.getElementById('status');
const btnStart = document.getElementById('btn-start');
const splashScreen = document.getElementById('splash-screen');
const gameContainer = document.getElementById('game-container');
const videoContainer = document.getElementById('video-container');
const canvasContainer = document.getElementById('canvas-container');
const hudContainer = document.getElementById('hud-overlay');
const langToggle = document.getElementById('lang-toggle');

const camera = new CameraService();
const pose = new PoseService();

let sceneManager = null;
let gameEngine = null;
let hudOverlay = null;

// Initialize 99 EMA filters (33 joints * 3 axes)
const filters = Array.from({ length: 33 }, () => ({
  x: new EMAFilter(0.6),
  y: new EMAFilter(0.6),
  z: new EMAFilter(0.6)
}));

function resetFilters() {
  for (const f of filters) {
    f.x.reset();
    f.y.reset();
    f.z.reset();
  }
}

/** @type {Array|null} */
let latestLandmarks = null;
let animationFrameId = null;

function setStatus(text) {
  statusEl.textContent = text;
}

// ── Pipeline Wiring ──

camera.onFrame(({ bitmap, timestamp }) => {
  pose.sendFrame(bitmap, timestamp);
});

pose.onResult((worldLandmarks) => {
  if (worldLandmarks && worldLandmarks.length > 0) {
    const lm = worldLandmarks[0];
    if (lm && lm.length >= 33) {
      latestLandmarks = lm.map((pt, idx) => ({
        x: filters[idx].x.update(pt.x),
        y: filters[idx].y.update(pt.y),
        z: filters[idx].z.update(pt.z)
      }));
      if (gameEngine) {
        gameEngine.update(latestLandmarks);
      }
    } else {
      latestLandmarks = null;
      resetFilters();
      if (gameEngine) {
        gameEngine.update(null);
      }
    }
  } else {
    latestLandmarks = null;
    resetFilters();
    if (gameEngine) {
      gameEngine.update(null);
    }
  }
});

pose.onError((msg) => {
  console.error(`[PoseService Error] ${msg}`);
});

// ── Render Loop ──

function renderLoop() {
  animationFrameId = requestAnimationFrame(renderLoop);

  if (gameEngine && sceneManager) {
    const distance = gameEngine._currentDistance;
    const threshold = gameEngine._dynamicThreshold;
    sceneManager.update(latestLandmarks, distance, threshold);
  }
}

// ── Event Bus Wiring ──
function setupEventBus() {
  eventBus.on('game:newQuestion', async ({ question }) => {
    // Play educational question via TTS
    const text = i18n.t(question.eduKey);
    const voice = i18n.t('tts.voice');
    speak(text, voice).catch(err => console.error('TTS error:', err));
  });

  eventBus.on('game:hit', () => {
    playSuccess();
  });

  eventBus.on('ui:restartClick', () => {
    playClick();
    gameEngine.start();
  });
}

// ── Boot Sequence ──

async function startPipeline() {
  btnStart.disabled = true;
  setStatus('Initializing pose model...');

  try {
    await pose.init();
    setStatus('Starting camera...');
    await camera.start();
    setStatus('Pipeline active — tracking pose.');
    playSuccess();

    // Instantiate game and rendering layers
    sceneManager = new SceneManager(canvasContainer);
    hudOverlay = new HUDOverlay(hudContainer);
    gameEngine = new GameEngine();

    setupEventBus();

    // Append the video feed to the background
    const videoElement = camera.videoElement;
    if (videoElement) {
      videoContainer.innerHTML = '';
      videoContainer.appendChild(videoElement);
    }

    // Language Toggle
    if (langToggle) {
      langToggle.addEventListener('click', () => {
        const newLang = i18n.getLocale() === 'en' ? 'de' : 'en';
        i18n.setLocale(newLang);
        langToggle.textContent = newLang === 'en' ? 'EN | 🇩🇪' : '🇬🇧 | DE';
      });
    }

    // Transition splash screen
    splashScreen.classList.add('fade-out');
    gameContainer.classList.remove('hidden');

    // Start game and render loop
    gameEngine.start();
    renderLoop();
  } catch (err) {
    setStatus(`Error: ${err.message}`);
    btnStart.disabled = false;
    console.error('[main] Boot failed:', err);
  }
}

btnStart.addEventListener('click', () => {
  playClick();
  startPipeline();
});

// ── Cleanup on page unload ──
window.addEventListener('beforeunload', () => {
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
  }
  camera.stop();
  pose.destroy();
  disposeAudio();
  if (sceneManager) {
    sceneManager.dispose();
  }
  if (hudOverlay) {
    hudOverlay.dispose();
  }
});
