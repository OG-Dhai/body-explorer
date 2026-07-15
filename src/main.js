import { CameraService } from './input/cameraService.js';
import { PoseService } from './perception/poseService.js';
import { FaceMeshService } from './perception/faceMeshService.js';
import {
  dispose as disposeAudio,
  isMuted,
  pauseAudio,
  playBackgroundMusic,
  playClick,
  playError,
  playGameComplete,
  playGameStart,
  playMenuSelection,
  playSuccess,
  playWellDone,
  preloadAudioAssets,
  resumeAudio,
  stopAllAudio,
  speakKey,
  stopBackgroundMusic,
  stopGameStart,
  unlockAudio,
  toggleMuted,
} from './audio/audioEngine.js';
import { SceneManager } from './scene/sceneManager.js';
import { GameEngine } from './engine/gameEngine.js';
import { HUDOverlay } from './scene/hudOverlay.js';
import { setupDebugUI } from './scene/debugUI.js';
import { EMAFilter } from './math/spatialMath.js';
import { LightingAnalyzer } from './perception/lightingAnalyzer.js';
import eventBus from './core/eventBus.js';
import { CONFIG } from './core/config.js';
import { i18n, DICTIONARY } from './core/i18n.js';
import { PALETTE } from './core/palette.js';
import { resumeSessionInSameTick } from './core/sessionLifecycle.js';
import { badgeSystem, BADGE_DETAILS } from './engine/badgeSystem.js';

const statusEl = document.getElementById('status');
const btnStart = document.getElementById('btn-start');
const splashScreen = document.getElementById('splash-screen');
const loadingSpinner = document.getElementById('loading-spinner');
const gameContainer = document.getElementById('game-container');
const videoContainer = document.getElementById('video-container');
const canvasContainer = document.getElementById('canvas-container');
const hudContainer = document.getElementById('hud-overlay');
const langToggle = document.getElementById('lang-toggle');
const floatingControls = document.getElementById('floating-controls');
const btnHelp = document.getElementById('btn-help');
const helpTooltip = document.getElementById('help-tooltip');
const btnCloseHelp = document.getElementById('btn-close-help');
const btnInfo = document.getElementById('btn-info');
const infoTooltip = document.getElementById('info-tooltip');
const btnCloseInfo = document.getElementById('btn-close-info');
const btnMute = document.getElementById('btn-mute');
const muteIconUse = document.getElementById('mute-icon-use');
const btnExit = document.getElementById('btn-exit');
const exitConfirmDialog = document.getElementById('exit-confirm-dialog');
const btnExitConfirm = document.getElementById('btn-exit-confirm');
const btnExitCancel = document.getElementById('btn-exit-cancel');
const levelButtons = Array.from(document.querySelectorAll('.level-btn'));

const btnBadgesEntry = document.getElementById('btn-badges-entry');
const badgesDialog = document.getElementById('rewards-dialog');
const btnCloseBadges = document.getElementById('btn-close-badges');
const badgesGrid = document.getElementById('rewards-grid');

const camera = new CameraService();
const pose = new PoseService();
const faceMesh = new FaceMeshService();

let sceneManager = null;
let gameEngine = null;
let hudOverlay = null;
let disposeDebugControls = null;

const DEFAULT_LIGHTING_THRESHOLD_MULTIPLIER = 1.0;
const LOW_LIGHTING_THRESHOLD_MULTIPLIER = 1.5;
const DEFAULT_STARTING_LEVEL = 1;
const VALID_STARTING_LEVELS = new Set([1, 2, 3]);
const SUPPORTED_LOCALES = Object.freeze(Object.keys(DICTIONARY));

let selectedLevel = DEFAULT_STARTING_LEVEL;

// One EMA filter per axis and pose joint. Alpha 0.85 favors responsiveness
// while retaining light anti-jitter smoothing.
const filters = Array.from({ length: 33 }, () => ({
  x: new EMAFilter(0.85),
  y: new EMAFilter(0.85),
  z: new EMAFilter(0.85)
}));

const FACE_MESH_POINTS = {
  NOSE: [1, 4],
  LEFT_EYE: [362, 385, 387, 263, 373, 380],
  RIGHT_EYE: [33, 160, 158, 133, 153, 144],
  LEFT_FACE_SIDE: [454, 323, 356],
  RIGHT_FACE_SIDE: [234, 93, 127],
  LEFT_MOUTH: [291, 308, 415],
  RIGHT_MOUTH: [61, 78, 191],
};

const FACE_TARGET_REFINEMENTS = {
  nose: [{ poseIndex: 0, faceIndices: FACE_MESH_POINTS.NOSE }],
  left_eye: [{ poseIndex: 2, faceIndices: FACE_MESH_POINTS.LEFT_EYE }],
  right_eye: [{ poseIndex: 5, faceIndices: FACE_MESH_POINTS.RIGHT_EYE }],
  left_ear: [{ poseIndex: 7, faceIndices: FACE_MESH_POINTS.LEFT_FACE_SIDE }],
  right_ear: [{ poseIndex: 8, faceIndices: FACE_MESH_POINTS.RIGHT_FACE_SIDE }],
  mouth: [
    { poseIndex: 9, faceIndices: FACE_MESH_POINTS.LEFT_MOUTH },
    { poseIndex: 10, faceIndices: FACE_MESH_POINTS.RIGHT_MOUTH },
  ],
};

const FACE_TO_POSE_ANCHORS = [
  { poseIndex: 0, faceIndices: FACE_MESH_POINTS.NOSE },
  { poseIndex: 2, faceIndices: FACE_MESH_POINTS.LEFT_EYE },
  { poseIndex: 5, faceIndices: FACE_MESH_POINTS.RIGHT_EYE },
  { poseIndex: 7, faceIndices: FACE_MESH_POINTS.LEFT_FACE_SIDE },
  { poseIndex: 8, faceIndices: FACE_MESH_POINTS.RIGHT_FACE_SIDE },
  { poseIndex: 9, faceIndices: FACE_MESH_POINTS.LEFT_MOUTH },
  { poseIndex: 10, faceIndices: FACE_MESH_POINTS.RIGHT_MOUTH },
];

const FACE_TARGET_IDS = new Set(Object.keys(FACE_TARGET_REFINEMENTS));
const FACE_RESULT_TTL_MS = 250;

function resetFilters() {
  for (const f of filters) {
    f.x.reset();
    f.y.reset();
    f.z.reset();
  }
}

/** @type {Array|null} */
let latestLandmarks = null;
/** @type {Array|null} */
let latestPoseLandmarks = null;
/** @type {Array|null} */
let latestFaceLandmarks = null;
let latestFaceTargetId = null;
let latestFaceReceivedAt = 0;
let activeFaceTargetId = null;
let isDetectionActive = false;
let animationFrameId = null;
let firstFrameReceived = false;
let isPipelineActive = false;
let pipelineStarting = false;
let sessionPaused = false;
let returningHome = false;
let factNarrationGeneration = 0;

function setStatusKey(key) {
  statusEl.dataset.i18n = key;
  statusEl.textContent = i18n.t(key);
}

function selectLevel(button, { focus = false, playSound = false } = {}) {
  const nextLevel = Number(button?.dataset.level);
  if (!VALID_STARTING_LEVELS.has(nextLevel)) return;

  if (playSound) void playMenuSelection();

  selectedLevel = nextLevel;
  for (const levelButton of levelButtons) {
    const isSelected = levelButton === button;
    levelButton.classList.toggle('active', isSelected);
    levelButton.setAttribute('aria-checked', String(isSelected));
    levelButton.tabIndex = isSelected ? 0 : -1;
  }

  const difficultyName = i18n.t(`ui.level_${button.dataset.difficulty?.toLowerCase() || 'easy'}`);
  btnStart.setAttribute(
    'aria-label',
    `${i18n.t('ui.start_adventure')}: ${difficultyName}`
  );

  if (focus) button.focus();
}

function handleLevelKeydown(event) {
  const currentIndex = levelButtons.indexOf(event.currentTarget);
  if (currentIndex < 0) return;

  let nextIndex = null;
  if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
    nextIndex = (currentIndex + 1) % levelButtons.length;
  } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
    nextIndex = (currentIndex - 1 + levelButtons.length) % levelButtons.length;
  } else if (event.key === 'Home') {
    nextIndex = 0;
  } else if (event.key === 'End') {
    nextIndex = levelButtons.length - 1;
  }

  if (nextIndex === null) return;
  event.preventDefault();
  selectLevel(levelButtons[nextIndex], { focus: true, playSound: true });
}

function setLevelSelectorDisabled(disabled) {
  for (const levelButton of levelButtons) {
    levelButton.disabled = disabled;
  }
}

for (const levelButton of levelButtons) {
  levelButton.addEventListener('click', () => {
    selectLevel(levelButton, { playSound: true });
  });
  levelButton.addEventListener('keydown', handleLevelKeydown);
}

const defaultLevelButton = levelButtons.find(
  (button) => Number(button.dataset.level) === DEFAULT_STARTING_LEVEL
);
if (defaultLevelButton) selectLevel(defaultLevelButton);

function translateDOM() {
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    el.textContent = i18n.t(key);
  });
  document.querySelectorAll('[data-i18n-aria-label]').forEach(el => {
    const key = el.getAttribute('data-i18n-aria-label');
    el.setAttribute('aria-label', i18n.t(key));
  });
}

function renderMuteControl() {
  if (!btnMute) return;
  const muted = isMuted();
  const actionKey = muted ? 'ui.unmute_sound' : 'ui.mute_sound';
  const actionLabel = i18n.t(actionKey);
  btnMute.setAttribute('aria-pressed', String(muted));
  btnMute.setAttribute('aria-label', actionLabel);
  btnMute.setAttribute('title', actionLabel);
  muteIconUse?.setAttribute('href', muted ? '#icon-speaker-off' : '#icon-speaker-on');
}

function renderControlTranslations() {
  renderMuteControl();
  if (btnExit) {
    const exitLabel = i18n.t('ui.exit_game');
    btnExit.setAttribute('aria-label', exitLabel);
    btnExit.setAttribute('title', exitLabel);
  }
  btnExitConfirm?.setAttribute('aria-label', i18n.t('ui.return_home'));
  btnExitCancel?.setAttribute('aria-label', i18n.t('ui.keep_playing'));

  if (btnBadgesEntry) {
    btnBadgesEntry.setAttribute('aria-label', i18n.t('ui.aria_view_badges'));
  }

  for (const levelButton of levelButtons) {
    const difficultyKey = `ui.level_${levelButton.dataset.difficulty?.toLowerCase() || 'easy'}`;
    levelButton.setAttribute('aria-label', i18n.t(difficultyKey));
  }

  const activeLevelButton = levelButtons.find((button) => button.classList.contains('active'));
  if (activeLevelButton) selectLevel(activeLevelButton);
}

function renderLanguageToggle(lang) {
  if (!langToggle) return;
  document.documentElement.lang = lang;
  const btn = document.getElementById('current-lang-btn');
  if (btn) btn.textContent = lang.toUpperCase();
  translateDOM();
  langToggle.setAttribute('aria-label', i18n.t('ui.aria_switch_language', lang.toUpperCase()));
  renderControlTranslations();
}

function renderBadges() {
  if (!badgesGrid) return;
  badgesGrid.innerHTML = '';
  const unlockedStates = badgeSystem.getBadges();

  Object.values(BADGE_DETAILS).forEach(badge => {
    const state = unlockedStates[badge.id];
    const isUnlocked = !!state?.unlocked;
    const count = state?.count || 0;

    const item = document.createElement('div');
    item.className = `badge-item ${isUnlocked ? 'unlocked' : 'locked'}`;
    item.setAttribute('role', 'article');
    
    const statusText = isUnlocked 
      ? `${i18n.t('ui.badge_unlocked')} ${count > 1 ? `(x${count})` : ''}` 
      : i18n.t('ui.badge_locked');
    item.setAttribute('aria-label', `${i18n.t(badge.nameKey)}: ${i18n.t(badge.descKey)} - ${statusText}`);

    item.innerHTML = `
      <div class="badge-icon-container">
        ${isUnlocked 
          ? `<img class="ui-icon badge-icon" src="/badges/${badge.icon}.png" alt="${i18n.t(badge.nameKey)}" aria-hidden="true" draggable="false" />`
          : `<svg class="ui-icon badge-icon icon--locked" aria-hidden="true" focusable="false"><use href="#icon-lock"></use></svg>`
        }
      </div>
      <div class="badge-info">
        <h3 class="badge-name">${i18n.t(badge.nameKey)}</h3>
        <p class="badge-desc">${i18n.t(badge.descKey)}</p>
        ${isUnlocked && count > 1 ? `<span class="badge-count">x${count}</span>` : ''}
      </div>
    `;
    badgesGrid.appendChild(item);
  });
}

function handleLocaleChange({ lang } = {}) {
  factNarrationGeneration++;
  renderLanguageToggle(lang || i18n.getLocale());
  if (badgesDialog && badgesDialog.open) {
    renderBadges();
  }

  // If the child changes language while an instruction is being narrated,
  // replay that same question in the newly selected locale. AudioEngine has
  // already invalidated the old playback by the time this listener runs.
  if (gameEngine?.currentState === 'INSTRUCTION' && !sessionPaused) {
    const question = gameEngine.currentQuestion;
    if (question) eventBus.emit('game:replayQuestion', { question });
  } else if (gameEngine?.currentState === 'FEEDBACK' && !sessionPaused) {
    const question = gameEngine.currentQuestion;
    if (question) eventBus.emit('game:replayFact', { question });
  }
}

function handleLanguageToggleClick() {
  void playClick();
  const currentIndex = SUPPORTED_LOCALES.indexOf(i18n.getLocale());
  const nextIndex = currentIndex >= 0
    ? (currentIndex + 1) % SUPPORTED_LOCALES.length
    : 0;
  i18n.setLocale(SUPPORTED_LOCALES[nextIndex]);
}

// ── Pipeline Wiring ──

let lightingAnalyzer = null;
let lightingChecked = false;
let lightingThresholdMultiplier = DEFAULT_LIGHTING_THRESHOLD_MULTIPLIER;

function applyLightingAdaptation({ isTooDark, brightness }) {
  lightingThresholdMultiplier = isTooDark
    ? LOW_LIGHTING_THRESHOLD_MULTIPLIER
    : DEFAULT_LIGHTING_THRESHOLD_MULTIPLIER;

  if (gameEngine) {
    gameEngine.setEnvironmentThresholdMultiplier(lightingThresholdMultiplier);
  }

  if (isTooDark) {
    const brightnessLabel = Number.isFinite(brightness) ? brightness.toFixed(1) : 'unknown';
    console.warn(`[main] Lighting is poor (brightness ${brightnessLabel}). Increasing hitbox threshold multiplier to ${lightingThresholdMultiplier}x.`);
    setStatusKey('ui.lowlight_warning');
  }
}

function isFaceTargetQuestion(question) {
  return Boolean(question && FACE_TARGET_IDS.has(question.id));
}

function activateFaceMeshForQuestion(question) {
  if (!isFaceTargetQuestion(question)) {
    deactivateFaceMesh();
    return;
  }

  activeFaceTargetId = question.id;
  latestFaceLandmarks = null;
  latestFaceTargetId = null;
  latestFaceReceivedAt = 0;

  faceMesh.activate(question.id).catch((err) => {
    if (activeFaceTargetId === question.id) {
      console.error('[FaceMeshService Error]', err.message);
    }
  });
}

function deactivateFaceMesh() {
  if (!activeFaceTargetId && !faceMesh.isActive) return;

  activeFaceTargetId = null;
  latestFaceLandmarks = null;
  latestFaceTargetId = null;
  latestFaceReceivedAt = 0;
  faceMesh.deactivate();
}

function shouldRunFaceMeshForTarget(targetId) {
  return Boolean(targetId && activeFaceTargetId === targetId && faceMesh.isReady);
}

function routeFrameToPerception(bitmap, timestamp) {
  if (!shouldRunFaceMeshForTarget(activeFaceTargetId)) {
    pose.sendFrame(bitmap, timestamp);
    return;
  }

  const targetId = activeFaceTargetId;
  const video = camera.videoElement;

  if (video && video.readyState >= 2) {
    sendFaceFrameWhenReady(createImageBitmap(video), timestamp, targetId);
    pose.sendFrame(bitmap, timestamp);
    return;
  }

  // Send original bitmap to pose synchronously to maintain backpressure.
  // Create a separate bitmap for FaceMesh from the original before it's neutered.
  createImageBitmap(bitmap)
    .then((faceBitmap) => {
      sendFaceBitmap(faceBitmap, timestamp, targetId);
    })
    .catch((err) => {
      console.warn('[main] FaceMesh bitmap clone failed; pose-only frame used.', err);
    });
  pose.sendFrame(bitmap, timestamp);
}

function sendFaceFrameWhenReady(faceBitmapPromise, timestamp, targetId) {
  faceBitmapPromise
    .then((faceBitmap) => {
      sendFaceBitmap(faceBitmap, timestamp, targetId);
    })
    .catch((err) => {
      console.warn('[main] FaceMesh frame capture failed; using pose-only frame.', err);
    });
}

function sendFaceBitmap(faceBitmap, timestamp, targetId) {
  if (shouldRunFaceMeshForTarget(targetId)) {
    faceMesh.sendFrame(faceBitmap, timestamp, targetId);
  } else {
    faceBitmap.close();
  }
}

function clearTrackedLandmarks() {
  latestLandmarks = null;
  latestPoseLandmarks = null;
  latestFaceLandmarks = null;
  latestFaceTargetId = null;
  latestFaceReceivedAt = 0;
  resetFilters();

  if (gameEngine) {
    gameEngine.update(null);
  }
}

function updatePoseLandmarks(rawLandmarks) {
  latestPoseLandmarks = rawLandmarks.map((pt, idx) => ({
    x: filters[idx].x.update(pt.x),
    y: filters[idx].y.update(pt.y),
    z: filters[idx].z.update(pt.z),
    visibility: pt.visibility,
    presence: pt.presence
  }));

  latestLandmarks = buildGameLandmarks(latestPoseLandmarks);

  if (gameEngine) {
    gameEngine.update(latestLandmarks);
  }
}

function buildGameLandmarks(poseLandmarks) {
  if (!poseLandmarks || !hasFreshFaceTarget()) {
    return poseLandmarks;
  }

  return refineFaceTargetLandmarks(poseLandmarks, latestFaceLandmarks, activeFaceTargetId) ?? poseLandmarks;
}

function hasFreshFaceTarget() {
  return Boolean(
    activeFaceTargetId &&
    latestFaceTargetId === activeFaceTargetId &&
    latestFaceLandmarks &&
    performance.now() - latestFaceReceivedAt <= FACE_RESULT_TTL_MS
  );
}

function refineFaceTargetLandmarks(poseLandmarks, faceLandmarks, targetId) {
  const refinements = FACE_TARGET_REFINEMENTS[targetId];
  if (!refinements || !faceLandmarks) return null;

  const transform = createFaceToPoseTransform(faceLandmarks, poseLandmarks);
  if (!transform) return null;

  const refined = poseLandmarks.map((landmark) => (
    landmark ? { ...landmark } : landmark
  ));

  let applied = false;
  for (const refinement of refinements) {
    const facePoint = averageFacePoint(faceLandmarks, refinement.faceIndices);
    if (!facePoint || !refined[refinement.poseIndex]) continue;

    const projected = transform(facePoint);
    refined[refinement.poseIndex] = {
      ...refined[refinement.poseIndex],
      ...projected,
      visibility: Math.max(refined[refinement.poseIndex].visibility ?? 0, 0.95),
      presence: Math.max(refined[refinement.poseIndex].presence ?? 0, 0.95),
      source: 'facemesh',
    };
    applied = true;
  }

  return applied ? refined : null;
}

function createFaceToPoseTransform(faceLandmarks, poseLandmarks) {
  const pairs = [];

  for (const anchor of FACE_TO_POSE_ANCHORS) {
    const source = averageFacePoint(faceLandmarks, anchor.faceIndices);
    const target = poseLandmarks[anchor.poseIndex];
    if (source && isValidLandmark(target)) {
      pairs.push({ source, target });
    }
  }

  if (pairs.length < 3) return null;

  const xCoefficients = solveAffineAxis(pairs, 'x');
  const yCoefficients = solveAffineAxis(pairs, 'y');
  const zCoefficients = solveAffineAxis(pairs, 'z');

  if (!xCoefficients || !yCoefficients || !zCoefficients) return null;

  return (point) => ({
    x: applyAffine(xCoefficients, point),
    y: applyAffine(yCoefficients, point),
    z: applyAffine(zCoefficients, point),
  });
}

function averageFacePoint(faceLandmarks, indices) {
  let x = 0;
  let y = 0;
  let z = 0;
  let count = 0;

  for (const index of indices) {
    const landmark = faceLandmarks[index];
    if (!isValidFaceLandmark(landmark)) continue;

    x += landmark.x;
    y += landmark.y;
    z += landmark.z ?? 0;
    count++;
  }

  return count > 0 ? { x: x / count, y: y / count, z: z / count } : null;
}

function solveAffineAxis(pairs, axis) {
  let sumXX = 0;
  let sumXY = 0;
  let sumX = 0;
  let sumYY = 0;
  let sumY = 0;
  let sumXV = 0;
  let sumYV = 0;
  let sumV = 0;

  for (const { source, target } of pairs) {
    const x = source.x;
    const y = source.y;
    const value = target[axis];

    sumXX += x * x;
    sumXY += x * y;
    sumX += x;
    sumYY += y * y;
    sumY += y;
    sumXV += x * value;
    sumYV += y * value;
    sumV += value;
  }

  return solve3x3(
    [
      [sumXX, sumXY, sumX],
      [sumXY, sumYY, sumY],
      [sumX, sumY, pairs.length],
    ],
    [sumXV, sumYV, sumV]
  );
}

function solve3x3(matrix, rhs) {
  const determinant = det3(matrix);
  if (Math.abs(determinant) < 1e-8) return null;

  return [0, 1, 2].map((column) => {
    const replaced = matrix.map((row, rowIndex) => (
      row.map((value, colIndex) => (colIndex === column ? rhs[rowIndex] : value))
    ));
    return det3(replaced) / determinant;
  });
}

function det3(matrix) {
  const [[a, b, c], [d, e, f], [g, h, i]] = matrix;
  return a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
}

function applyAffine(coefficients, point) {
  return coefficients[0] * point.x + coefficients[1] * point.y + coefficients[2];
}

function isValidLandmark(landmark) {
  return Boolean(
    landmark &&
    Number.isFinite(landmark.x) &&
    Number.isFinite(landmark.y) &&
    Number.isFinite(landmark.z)
  );
}

function isValidFaceLandmark(landmark) {
  return Boolean(
    landmark &&
    Number.isFinite(landmark.x) &&
    Number.isFinite(landmark.y)
  );
}

camera.onFrame(({ bitmap, timestamp }) => {
  if (!isPipelineActive || sessionPaused) {
    bitmap.close?.();
    return;
  }

  if (!lightingChecked && lightingAnalyzer) {
    try {
      const lightingResult = lightingAnalyzer.analyze(bitmap);
      lightingChecked = true;
      applyLightingAdaptation(lightingResult);
    } catch (err) {
      lightingChecked = true;
      lightingThresholdMultiplier = DEFAULT_LIGHTING_THRESHOLD_MULTIPLIER;
      console.warn('[main] Lighting analysis unavailable; using normal tracking thresholds.', err);
    }
  }

  routeFrameToPerception(bitmap, timestamp);
});

pose.onResult((worldLandmarks) => {
  if (!isPipelineActive || sessionPaused) return;
  if (worldLandmarks && worldLandmarks.length > 0) {
    if (!firstFrameReceived) {
      firstFrameReceived = true;
      eventBus.emit('pipeline:ready');
    }
    const lm = worldLandmarks[0];
    if (lm && lm.length >= 33) {
      updatePoseLandmarks(lm);
    } else {
      clearTrackedLandmarks();
    }
  } else {
    clearTrackedLandmarks();
  }
});

pose.onError((msg) => {
  console.error(`[PoseService Error] ${msg}`);
});

faceMesh.onResult(({ faceLandmarks, targetId }) => {
  if (!isPipelineActive || sessionPaused) return;
  if (!shouldRunFaceMeshForTarget(targetId) || !faceLandmarks?.[0]) return;

  latestFaceLandmarks = faceLandmarks[0];
  latestFaceTargetId = targetId;
  latestFaceReceivedAt = performance.now();

  if (latestPoseLandmarks) {
    latestLandmarks = buildGameLandmarks(latestPoseLandmarks);
    if (isDetectionActive && gameEngine) {
      gameEngine.update(latestLandmarks);
    }
  }
});

faceMesh.onError((msg) => {
  console.error(`[FaceMeshService Error] ${msg}`);
});

// ── Render Loop ──

let frameCount = 0;
let lastFpsTime = performance.now();
let fpsDisplay = null;
if (new URLSearchParams(window.location.search).has('debug')) {
  fpsDisplay = document.createElement('div');
  fpsDisplay.id = 'fps-display';
  fpsDisplay.style.cssText = `position:fixed; top:10px; left:10px; color:${PALETTE.explorerNavy}; z-index:9999; background:${PALETTE.airySky}; border:2px solid ${PALETTE.explorerNavy}; padding:5px 10px; font-family:monospace; font-size:14px; border-radius:4px; pointer-events:none;`;
  fpsDisplay.textContent = 'FPS: 0 | Pose Drops: 0 | Face Drops: 0';
  document.body.appendChild(fpsDisplay);
}

function renderLoop() {
  animationFrameId = null;
  if (!isPipelineActive || sessionPaused) return;

  if (gameEngine && sceneManager) {
    const distance = gameEngine.currentDistance;
    const threshold = gameEngine.dynamicThreshold;
    sceneManager.update(latestLandmarks, distance, threshold);
  }

  frameCount++;
  const now = performance.now();
  if (now - lastFpsTime >= 1000) {
    if (fpsDisplay) {
      fpsDisplay.textContent = `FPS: ${frameCount} | Pose Drops: ${pose.droppedFrames} | Face Drops: ${faceMesh.droppedFrames}`;
    }
    frameCount = 0;
    lastFpsTime = now;
  }

  animationFrameId = requestAnimationFrame(renderLoop);
}

function startRenderLoop() {
  if (animationFrameId !== null || !isPipelineActive || sessionPaused) return;
  animationFrameId = requestAnimationFrame(renderLoop);
}

function stopRenderLoop() {
  if (animationFrameId === null) return;
  cancelAnimationFrame(animationFrameId);
  animationFrameId = null;
}

// ── Event Bus Wiring ──
let eventBusInitialized = false;

function setupEventBus() {
  if (eventBusInitialized) return;
  eventBusInitialized = true;

  eventBus.on('level:start', ({ level }) => {
    void playBackgroundMusic(level);
  });

  let narrationGeneration = 0;
  const playQuestionNarration = async ({ question } = {}) => {
    if (!question || !gameEngine || gameEngine.isDisposed) return;
    const generation = ++narrationGeneration;
    const activeEngine = gameEngine;
    isDetectionActive = false;
    activateFaceMeshForQuestion(question);

    try {
      await speakKey(question.eduKey);
    } catch (err) {
      console.error('TTS error:', err);
    } finally {
      if (generation === narrationGeneration
        && gameEngine === activeEngine
        && !activeEngine.isDisposed
        && activeEngine.currentQuestion === question) {
        eventBus.emit('audio:ttsComplete');
      }
    }
  };

  eventBus.on('game:newQuestion', playQuestionNarration);
  eventBus.on('game:replayQuestion', playQuestionNarration);

  const playFactNarration = async ({ question, playSuccessCue = false } = {}) => {
    if (!question?.factKey || !gameEngine || gameEngine.isDisposed) return;
    const generation = ++factNarrationGeneration;
    const activeEngine = gameEngine;

    if (playSuccessCue) {
      void playSuccess();
      await new Promise((resolve) => {
        setTimeout(resolve, CONFIG.game.timing.factNarrationLeadInMs);
      });
    }

    if (generation !== factNarrationGeneration
      || gameEngine !== activeEngine
      || activeEngine.isDisposed
      || activeEngine.currentState !== 'FEEDBACK'
      || activeEngine.currentQuestion !== question
      || sessionPaused) {
      return;
    }

    try {
      const played = await speakKey(question.factKey, { fallbackToTone: false });
      if (played
        && generation === factNarrationGeneration
        && gameEngine === activeEngine
        && !activeEngine.isDisposed
        && activeEngine.currentState === 'FEEDBACK'
        && activeEngine.currentQuestion === question
        && !sessionPaused
        && !isMuted()) {
        eventBus.emit('audio:factComplete', { question });
      }
    } catch (err) {
      console.error(`Fact narration error for ${question.factKey}:`, err);
    }
  };

  eventBus.on('game:replayFact', ({ question } = {}) => {
    void playFactNarration({ question });
  });

  eventBus.on('game:voiceFeedback', ({ key }) => {
    speakKey(key, { fallbackToTone: false }).catch((err) => {
      console.error(`Voice feedback error for ${key}:`, err);
    });
  });

  eventBus.on('game:hit', ({ question } = {}) => {
    isDetectionActive = false;
    deactivateFaceMesh();
    void playFactNarration({ question, playSuccessCue: true });
  });

  eventBus.on('game:miss', () => {
    isDetectionActive = false;
    deactivateFaceMesh();
    playError();
  });

  eventBus.on('level:complete', ({ passed }) => {
    isDetectionActive = false;
    deactivateFaceMesh();
    stopBackgroundMusic();
    if (passed) {
      playWellDone();
    } else {
      playError();
    }
  });

  eventBus.on('game:complete', ({ allLevelsPassed }) => {
    isDetectionActive = false;
    deactivateFaceMesh();
    stopBackgroundMusic();
    if (allLevelsPassed) {
      playGameComplete();
    }
  });

  eventBus.on('ui:restartClick', () => {
    returnToHome();
    void playClick();
  });

  eventBus.on('game:stateChange', ({ state }) => {
    isDetectionActive = state === 'playing';
    if (state === 'idle') {
      deactivateFaceMesh();
      stopBackgroundMusic();
    }
  });
}

function setGameplayControlsVisible(visible) {
  btnExit?.classList.toggle('hidden', !visible);
  btnExit?.setAttribute('aria-hidden', String(!visible));
}

function closeExitDialog(returnValue = '') {
  if (!exitConfirmDialog?.open) return;
  exitConfirmDialog.close(returnValue);
}

function pauseSession() {
  if (!isPipelineActive || sessionPaused || !gameEngine) return false;

  sessionPaused = true;
  isDetectionActive = false;
  gameEngine.pause();
  camera.pause();
  stopRenderLoop();
  void pauseAudio();
  eventBus.emit('session:pauseChange', { paused: true });
  return true;
}

function resumeSession() {
  if (!isPipelineActive || !sessionPaused || !gameEngine) return false;

  sessionPaused = false;
  const resumedAt = performance.now();
  const resumeResult = resumeSessionInSameTick({
    resumeAudio,
    resumeCamera: () => camera.resume(),
    resumeGame: () => gameEngine?.resume({ replayInstruction: true }) ?? false,
    resumeRender: startRenderLoop,
  });

  isDetectionActive = gameEngine.currentState === 'DETECTING';
  eventBus.emit('session:resumeSynchronized', {
    resumedAt,
    audioRequested: true,
    cameraResumed: resumeResult.cameraResumed,
    sameTask: true,
  });
  eventBus.emit('session:pauseChange', { paused: false });
  void resumeResult.audioResumePromise;
  return true;
}

function showExitConfirmation() {
  if (!pauseSession() || !exitConfirmDialog) return;

  helpTooltip?.classList.add('hidden');
  infoTooltip?.classList.add('hidden');
  if (typeof exitConfirmDialog.showModal === 'function') {
    exitConfirmDialog.showModal();
  } else {
    exitConfirmDialog.setAttribute('open', '');
  }
  btnExitCancel?.focus({ preventScroll: true });
}

function cancelExitConfirmation() {
  closeExitDialog('cancel');
  resumeSession();
  btnExit?.focus({ preventScroll: true });
}

function confirmExitToHome() {
  closeExitDialog('confirm');
  returnToHome();
  void playClick();
}

/**
 * The single destructive session teardown path. Locale and master mute remain
 * persisted; all per-session score, round, target, camera, and view state goes.
 */
function returnToHome() {
  if (returningHome) return;
  returningHome = true;

  try {
    factNarrationGeneration++;
    closeExitDialog('home');
    sessionPaused = false;
    isPipelineActive = false;
    isDetectionActive = false;
    pipelineStarting = false;

    gameEngine?.dispose();
    gameEngine = null;
    stopRenderLoop();
    camera.stop();
    deactivateFaceMesh();
    stopAllAudio();

    hudOverlay?.dispose();
    hudOverlay = null;
    disposeDebugControls?.();
    disposeDebugControls = null;
    sceneManager?.dispose();
    sceneManager = null;

    videoContainer.innerHTML = '';
    canvasContainer.innerHTML = '';
    hudContainer.innerHTML = '';

    latestLandmarks = null;
    latestPoseLandmarks = null;
    latestFaceLandmarks = null;
    latestFaceTargetId = null;
    latestFaceReceivedAt = 0;
    activeFaceTargetId = null;
    firstFrameReceived = false;
    lightingChecked = false;
    lightingAnalyzer = null;
    lightingThresholdMultiplier = DEFAULT_LIGHTING_THRESHOLD_MULTIPLIER;
    resetFilters();

    gameContainer.classList.remove('active');
    gameContainer.classList.add('hidden');
    splashScreen.classList.remove('fade-out');
    splashScreen.classList.add('active');
    floatingControls?.classList.remove('in-game');
    setGameplayControlsVisible(false);
    helpTooltip?.classList.add('hidden');
    infoTooltip?.classList.add('hidden');

    selectedLevel = DEFAULT_STARTING_LEVEL;
    if (defaultLevelButton) selectLevel(defaultLevelButton);
    setLevelSelectorDisabled(false);
    if (loadingSpinner) loadingSpinner.classList.add('hidden');
    const startLabel = btnStart.querySelector('.btn-text');
    if (startLabel) startLabel.textContent = i18n.t('ui.start_adventure');
    btnStart.classList.remove('hidden');
    btnStart.disabled = false;
    setStatusKey('ui.click_start');
    btnStart.focus({ preventScroll: true });
  } finally {
    returningHome = false;
  }
}

// ── Boot Sequence ──

async function startPipeline(startingLevel = DEFAULT_STARTING_LEVEL, audioReadyPromise = null) {
  if (pipelineStarting || isPipelineActive) return;
  pipelineStarting = true;
  isPipelineActive = true;
  sessionPaused = false;
  firstFrameReceived = false;
  btnStart.disabled = true;
  btnStart.classList.add('hidden');
  setLevelSelectorDisabled(true);
  if (loadingSpinner) loadingSpinner.classList.remove('hidden');

  lightingChecked = false;
  lightingThresholdMultiplier = DEFAULT_LIGHTING_THRESHOLD_MULTIPLIER;
  lightingAnalyzer = new LightingAnalyzer();

  setStatusKey('ui.loading_camera');

  try {
    await camera.start();

    setStatusKey('ui.loading_pose');
    if (!pose.isReady) await pose.init();

    setStatusKey('ui.loading_audio');
    try {
      const audioPreload = await (audioReadyPromise || preloadAudioAssets());
      if (audioPreload?.ok === false) {
        console.warn('[main] Audio assets incomplete; continuing with oscillator fallbacks.');
        setStatusKey('ui.audio_fallback');
      }
    } catch (audioErr) {
      console.warn('[main] Audio preload failed; continuing with oscillator fallbacks.', audioErr);
      setStatusKey('ui.audio_fallback');
    }

    // Start the transition only after camera, pose, and audio boot succeeded.
    await playGameStart();

    setStatusKey('ui.ready_waiting');

    // Wait for the first valid frame before transitioning
    if (!firstFrameReceived) {
      await new Promise(resolve => {
        eventBus.once('pipeline:ready', resolve);
      });
    }

    sceneManager = new SceneManager(canvasContainer);
    hudOverlay = new HUDOverlay(hudContainer);
    gameEngine = new GameEngine({
      environmentThresholdMultiplier: lightingThresholdMultiplier
    });

    setStatusKey(
      lightingThresholdMultiplier > DEFAULT_LIGHTING_THRESHOLD_MULTIPLIER
        ? 'ui.pipeline_lowlight'
        : 'ui.pipeline_active'
    );

    disposeDebugControls = setupDebugUI(gameEngine);

    const videoElement = camera.videoElement;
    if (videoElement) {
      videoContainer.innerHTML = '';
      videoContainer.appendChild(videoElement);
    }

    splashScreen.classList.remove('active');
    splashScreen.classList.add('fade-out');
    gameContainer.classList.remove('hidden');
    gameContainer.classList.add('active');
    if (floatingControls) {
      floatingControls.classList.add('in-game');
    }
    setGameplayControlsVisible(true);

    gameEngine.start(startingLevel);
    startRenderLoop();
  } catch (err) {
    isPipelineActive = false;
    sessionPaused = false;
    stopGameStart();
    stopAllAudio();
    gameEngine?.dispose();
    gameEngine = null;
    hudOverlay?.dispose();
    hudOverlay = null;
    disposeDebugControls?.();
    disposeDebugControls = null;
    sceneManager?.dispose();
    sceneManager = null;
    stopRenderLoop();
    if (loadingSpinner) loadingSpinner.classList.add('hidden');
    setStatusKey('ui.startup_error');
    const startLabel = btnStart.querySelector('.btn-text');
    if (startLabel) startLabel.textContent = i18n.t('ui.try_again');
    btnStart.classList.remove('hidden');
    btnStart.disabled = false;
    setLevelSelectorDisabled(false);
    camera.stop();
    console.error('[main] Boot failed:', err);
  } finally {
    pipelineStarting = false;
  }
}

setupEventBus();
setGameplayControlsVisible(false);

btnStart.addEventListener('click', () => {
  const startingLevel = selectedLevel;

  // AudioContext creation/resume happens immediately in this trusted click.
  // Fetching and decoding then runs alongside camera/model initialization.
  const unlockPromise = unlockAudio();
  playClick();
  const audioReadyPromise = unlockPromise.then(async (unlocked) => {
    if (!unlocked) {
      return { ok: false, failedKeys: ['audio-context'] };
    }
    return preloadAudioAssets();
  });

  void startPipeline(startingLevel, audioReadyPromise);
});

if (btnMute) {
  btnMute.addEventListener('click', () => {
    const muted = toggleMuted();
    renderMuteControl();
    if (!muted) void playClick();
  });
}

btnExit?.addEventListener('click', showExitConfirmation);
btnExitCancel?.addEventListener('click', () => {
  cancelExitConfirmation();
  void playClick();
});
btnExitConfirm?.addEventListener('click', confirmExitToHome);
exitConfirmDialog?.addEventListener('cancel', (event) => {
  event.preventDefault();
  cancelExitConfirmation();
});

if (langToggle) {
  langToggle.addEventListener('click', handleLanguageToggleClick);
}
eventBus.on('i18n:change', handleLocaleChange);
renderLanguageToggle(i18n.getLocale());

if (btnHelp && helpTooltip) {
  btnHelp.addEventListener('click', () => {
    void playClick();
    helpTooltip.classList.toggle('hidden');
    if (infoTooltip) infoTooltip.classList.add('hidden');
  });
}

if (btnCloseHelp && helpTooltip) {
  btnCloseHelp.addEventListener('click', () => {
    void playClick();
    helpTooltip.classList.add('hidden');
  });
}

if (btnInfo && infoTooltip) {
  btnInfo.addEventListener('click', () => {
    void playClick();
    infoTooltip.classList.toggle('hidden');
    if (helpTooltip) helpTooltip.classList.add('hidden');
  });
}

if (btnCloseInfo && infoTooltip) {
  btnCloseInfo.addEventListener('click', () => {
    void playClick();
    infoTooltip.classList.add('hidden');
  });
}

if (btnBadgesEntry && badgesDialog) {
  btnBadgesEntry.addEventListener('click', () => {
    void playClick();
    renderBadges();
    badgesDialog.showModal();
  });
}

if (btnCloseBadges && badgesDialog) {
  btnCloseBadges.addEventListener('click', () => {
    void playClick();
    badgesDialog.close();
  });
}

eventBus.on('badge:unlocked', ({ badge }) => {
  void playWellDone();

  const toast = document.createElement('div');
  toast.className = 'badge-toast';
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');

  toast.innerHTML = `
    <div class="badge-toast-card">
      <div class="badge-toast-icon-container">
        <img class="ui-icon badge-toast-icon" src="/badges/${badge.icon}.png" alt="${i18n.t(badge.nameKey)}" aria-hidden="true" draggable="false" />
      </div>
      <div class="badge-toast-text">
        <span class="badge-toast-alert">${i18n.t('ui.badge_unlocked')}</span>
        <strong class="badge-toast-name">${i18n.t(badge.nameKey)}</strong>
        <p class="badge-toast-desc">${i18n.t(badge.descKey)}</p>
      </div>
    </div>
  `;

  document.body.appendChild(toast);

  setTimeout(() => {
    toast.classList.add('fade-out');
    setTimeout(() => toast.remove(), 500);
  }, 4000);
});

// ── Cleanup on page unload ──
window.addEventListener('beforeunload', () => {
  if (langToggle) {
    langToggle.removeEventListener('click', handleLanguageToggleClick);
  }
  eventBus.off('i18n:change', handleLocaleChange);
  stopRenderLoop();
  isPipelineActive = false;
  gameEngine?.dispose();
  camera.stop();
  pose.destroy();
  faceMesh.destroy();
  disposeAudio();
  if (sceneManager) {
    sceneManager.dispose();
  }
  if (hudOverlay) {
    hudOverlay.dispose();
  }
  disposeDebugControls?.();
});

// ── Service Worker Registration ──
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(err => {
      console.error('[ServiceWorker] Registration failed:', err);
    });
  });
}
