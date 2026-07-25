import { CameraService } from './input/cameraService.js';
import { PoseService } from './perception/poseService.js';
import { HandService } from './perception/handService.js';
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
  playSoftNudge,
  playSuccess,
  playWellDone,
  playYourTurn,
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
import { i18n, DICTIONARY, LANGUAGE_NAMES } from './core/i18n.js';
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
const langMenu = document.getElementById('lang-menu');
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

const btnTutorialEntry = document.getElementById('btn-tutorial-entry');
const tutorialDialog = document.getElementById('tutorial-dialog');
const btnCloseTutorial = document.getElementById('btn-close-tutorial');
const badgesGrid = document.getElementById('rewards-grid');

const camera = new CameraService();
const pose = new PoseService();
const hand = new HandService();
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

// Which questions target a face part. The Face Landmarker only runs for these,
// since it gives the precise nose/eye/ear/mouth points. The index mapping lives
// in hitValidator.js.
const FACE_TARGET_IDS = new Set([
  'nose', 'left_eye', 'right_eye', 'left_ear', 'right_ear', 'mouth',
]);
const FACE_RESULT_TTL_MS = 250;

function resetFilters() {
  for (const f of filters) {
    f.x.reset();
    f.y.reset();
    f.z.reset();
  }
}

/** @type {Array|null} 33 normalized image landmarks, the recognition targets. */
let latestPoseImage = null;
/** @type {Array|null} 33 smoothed world landmarks, for the on-screen skeleton. */
let latestPoseWorld = null;
/** @type {Array} per-hand arrays of 21 image landmarks, the fingertips. */
let latestHands = [];
/** @type {Array|null} face-mesh landmarks (image space) while a face target is active. */
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
  renderLanguageMenuActive();
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

// Language picker
// Instead of blindly cycling through languages on each tap, the globe opens a
// small menu that shows every language by its native name. A child (or parent)
// can see all options at once and tap the one they want.

let languageMenuOpen = false;

// Inline SVG flags, drawn by hand so they look the same on every OS. Flag emoji
// don't (Windows just shows the letter pairs). Each value is only the coloured
// bands; languageFlagMarkup() adds the rounded clip and border.
const LANGUAGE_FLAG_BANDS = {
  en: `<rect width="24" height="16" fill="#012169"/>
       <path d="M0 0 24 16M24 0 0 16" stroke="#fff" stroke-width="3"/>
       <path d="M0 0 24 16M24 0 0 16" stroke="#C8102E" stroke-width="1.4"/>
       <rect x="9.5" width="5" height="16" fill="#fff"/><rect y="5.5" width="24" height="5" fill="#fff"/>
       <rect x="10.7" width="2.6" height="16" fill="#C8102E"/><rect y="6.7" width="24" height="2.6" fill="#C8102E"/>`,
  de: `<rect width="24" height="16" fill="#000"/>
       <rect y="5.33" width="24" height="5.34" fill="#D00"/>
       <rect y="10.67" width="24" height="5.33" fill="#FFCE00"/>`,
  fr: `<rect width="24" height="16" fill="#fff"/>
       <rect width="8" height="16" fill="#0055A4"/>
       <rect x="16" width="8" height="16" fill="#EF4135"/>`,
  es: `<rect width="24" height="16" fill="#F1BF00"/>
       <rect width="24" height="4" fill="#AA151B"/>
       <rect y="12" width="24" height="4" fill="#AA151B"/>`,
  ru: `<rect width="24" height="16" fill="#fff"/>
       <rect y="5.33" width="24" height="5.34" fill="#0039A6"/>
       <rect y="10.67" width="24" height="5.33" fill="#D52B1E"/>`,
};

function languageFlagMarkup(locale) {
  const bands = LANGUAGE_FLAG_BANDS[locale];
  if (!bands) return '';
  return `
    <svg class="lang-flag" viewBox="0 0 24 16" aria-hidden="true" focusable="false">
      <clipPath id="flag-${locale}"><rect width="24" height="16" rx="3"/></clipPath>
      <g clip-path="url(#flag-${locale})">${bands}</g>
      <rect x="0.5" y="0.5" width="23" height="15" rx="2.6" fill="none"
            stroke="#17324D" stroke-opacity="0.35" stroke-width="1"/>
    </svg>`;
}

function buildLanguageMenu() {
  if (!langMenu) return;
  langMenu.innerHTML = '';
  for (const locale of SUPPORTED_LOCALES) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'lang-menu-item';
    item.setAttribute('role', 'menuitemradio');
    item.dataset.locale = locale;
    item.innerHTML = `
      ${languageFlagMarkup(locale)}
      <span class="lang-menu-code" aria-hidden="true">${locale.toUpperCase()}</span>
      <span class="lang-menu-name">${LANGUAGE_NAMES[locale] || locale.toUpperCase()}</span>
      <svg class="ui-icon lang-menu-check" aria-hidden="true" focusable="false"><use href="#icon-check"></use></svg>
    `;
    item.addEventListener('click', () => selectLanguage(locale));
    langMenu.appendChild(item);
  }
  renderLanguageMenuActive();
}

function renderLanguageMenuActive() {
  if (!langMenu) return;
  const current = i18n.getLocale();
  for (const item of langMenu.querySelectorAll('.lang-menu-item')) {
    const locale = item.dataset.locale;
    item.setAttribute('aria-checked', String(locale === current));
    item.setAttribute('aria-label', LANGUAGE_NAMES[locale] || locale.toUpperCase());
  }
}

function openLanguageMenu() {
  if (!langMenu || !langToggle || languageMenuOpen) return;
  languageMenuOpen = true;
  langMenu.classList.remove('hidden');
  langToggle.setAttribute('aria-expanded', 'true');
  // Dismiss when tapping elsewhere or pressing Escape.
  document.addEventListener('pointerdown', handleLanguageOutsidePointer, true);
  document.addEventListener('keydown', handleLanguageMenuKeydown, true);
  const activeItem = langMenu.querySelector('.lang-menu-item[aria-checked="true"]')
    || langMenu.querySelector('.lang-menu-item');
  activeItem?.focus({ preventScroll: true });
}

function closeLanguageMenu({ focusToggle = false } = {}) {
  if (!langMenu || !languageMenuOpen) return;
  languageMenuOpen = false;
  langMenu.classList.add('hidden');
  langToggle?.setAttribute('aria-expanded', 'false');
  document.removeEventListener('pointerdown', handleLanguageOutsidePointer, true);
  document.removeEventListener('keydown', handleLanguageMenuKeydown, true);
  if (focusToggle) langToggle?.focus({ preventScroll: true });
}

function handleLanguageToggleClick() {
  if (languageMenuOpen) {
    closeLanguageMenu();
    return;
  }
  void playClick();
  openLanguageMenu();
}

function selectLanguage(locale) {
  closeLanguageMenu({ focusToggle: true });
  if (locale === i18n.getLocale()) return;
  void playClick();
  i18n.setLocale(locale);
}

function handleLanguageOutsidePointer(event) {
  if (!langMenu?.contains(event.target) && !langToggle?.contains(event.target)) {
    closeLanguageMenu();
  }
}

function handleLanguageMenuKeydown(event) {
  if (event.key === 'Escape') {
    event.preventDefault();
    closeLanguageMenu({ focusToggle: true });
  }
}

// Pipeline wiring

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

// The original bitmap is transferred to the pose worker, so the hand worker
// (and the face worker, when a face target is active) each need their own copy,
// cloned from the video element or the source bitmap.
function routeFrameToPerception(bitmap, timestamp) {
  const video = camera.videoElement;
  const faceTargetId = shouldRunFaceMeshForTarget(activeFaceTargetId) ? activeFaceTargetId : null;
  const source = (video && video.readyState >= 2) ? video : bitmap;

  createImageBitmap(source)
    .then((handBitmap) => hand.sendFrame(handBitmap, timestamp))
    .catch(() => {});

  if (faceTargetId) {
    createImageBitmap(source)
      .then((faceBitmap) => sendFaceBitmap(faceBitmap, timestamp, faceTargetId))
      .catch(() => {});
  }

  // Pose gets the original bitmap (zero-copy transfer keeps backpressure honest).
  pose.sendFrame(bitmap, timestamp);
}

function sendFaceBitmap(faceBitmap, timestamp, targetId) {
  if (shouldRunFaceMeshForTarget(targetId)) {
    faceMesh.sendFrame(faceBitmap, timestamp, targetId);
  } else {
    faceBitmap.close();
  }
}

function clearPose() {
  latestPoseImage = null;
  latestPoseWorld = null;
  resetFilters();
  runRecognition(); // empty frame, so the hold detector decays
}

function updatePoseResult(imageLandmarks, worldLandmarks) {
  latestPoseImage = imageLandmarks;
  // Smooth the world landmarks so the on-screen skeleton stays steady. Only the
  // scene uses these; recognition uses the raw (already video-smoothed) image
  // landmarks and hand fingertips.
  latestPoseWorld = worldLandmarks.map((pt, idx) => ({
    x: filters[idx].x.update(pt.x),
    y: filters[idx].y.update(pt.y),
    z: filters[idx].z.update(pt.z),
    visibility: pt.visibility,
    presence: pt.presence,
  }));
  runRecognition();
}

function hasFreshFace() {
  return Boolean(
    activeFaceTargetId &&
    latestFaceTargetId === activeFaceTargetId &&
    latestFaceLandmarks &&
    performance.now() - latestFaceReceivedAt <= FACE_RESULT_TTL_MS
  );
}

// Assemble the latest pose / hands / face into one snapshot and hand it to the
// game engine. Pose-clocked (called on each pose result), with a fast extra
// pass on fresh hand/face results while actively detecting.
function runRecognition() {
  if (!gameEngine) return;
  gameEngine.update({
    pose: latestPoseImage,
    hands: latestHands,
    face: hasFreshFace() ? latestFaceLandmarks : null,
  });
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

pose.onResult(({ landmarks, worldLandmarks }) => {
  if (!isPipelineActive || sessionPaused) return;
  const image = landmarks?.[0];
  const world = worldLandmarks?.[0];
  if (image && image.length >= 33 && world && world.length >= 33) {
    if (!firstFrameReceived) {
      firstFrameReceived = true;
      eventBus.emit('pipeline:ready');
    }
    updatePoseResult(image, world);
  } else {
    clearPose();
  }
});

pose.onError((msg) => {
  console.error(`[PoseService Error] ${msg}`);
});

hand.onResult(({ landmarks }) => {
  if (!isPipelineActive || sessionPaused) return;
  latestHands = landmarks ?? [];
  // A fresh fingertip mid-touch: re-run recognition immediately for responsiveness.
  if (isDetectionActive) runRecognition();
});

hand.onError((msg) => {
  console.error(`[HandService Error] ${msg}`);
});

faceMesh.onResult(({ faceLandmarks, targetId }) => {
  if (!isPipelineActive || sessionPaused) return;
  if (!shouldRunFaceMeshForTarget(targetId) || !faceLandmarks?.[0]) return;

  latestFaceLandmarks = faceLandmarks[0];
  latestFaceTargetId = targetId;
  latestFaceReceivedAt = performance.now();

  if (isDetectionActive) runRecognition();
});

faceMesh.onError((msg) => {
  console.error(`[FaceMeshService Error] ${msg}`);
});

// Render loop

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
    sceneManager.update(latestPoseWorld, distance, threshold);
  }

  frameCount++;
  const now = performance.now();
  if (now - lastFpsTime >= 1000) {
    if (fpsDisplay) {
      fpsDisplay.textContent = `FPS: ${frameCount} | Pose Drops: ${pose.droppedFrames} | Hand Drops: ${hand.droppedFrames} | Face Drops: ${faceMesh.droppedFrames}`;
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

// Event bus wiring
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
    if (state === 'playing') {
      // Signal that it is now the child's turn to point (distinct "go" cue).
      void playYourTurn();
    } else if (state === 'idle') {
      deactivateFaceMesh();
      stopBackgroundMusic();
    }
  });

  // Gentle correction when a child parks a hand on the wrong part. No score or
  // state change here, just a soft cue and the prompt spoken again for the right
  // part, throttled so it never nags.
  let lastWrongPartAt = 0;
  eventBus.on('detection:wrongPart', ({ askedId } = {}) => {
    const now = performance.now();
    if (now - lastWrongPartAt < 2000) return;
    lastWrongPartAt = now;
    void playSoftNudge();
    const question = gameEngine?.currentQuestion;
    if (question && question.id === askedId
      && gameEngine.currentState === 'DETECTING' && !isMuted()) {
      speakKey(question.eduKey).catch((err) => console.error('Wrong-part prompt error:', err));
    }
  });

  // Tap-to-hear-again: replay the current question's narration on demand.
  eventBus.on('ui:replayNarration', () => {
    const question = gameEngine?.currentQuestion;
    if (!question || gameEngine.isDisposed || sessionPaused) return;
    const state = gameEngine.currentState;
    if (state !== 'INSTRUCTION' && state !== 'DETECTING') return;

    void playClick();
    if (state === 'INSTRUCTION') {
      // Still in the narration phase: use the proper replay path so the
      // instruction-complete timing stays correct.
      eventBus.emit('game:replayQuestion', { question });
    } else {
      // Child is already pointing: just replay the prompt audio.
      speakKey(question.eduKey).catch((err) => console.error('Replay narration error:', err));
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

    latestPoseImage = null;
    latestPoseWorld = null;
    latestHands = [];
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

// Boot sequence

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
    // Pose (body targets) and Hand (fingertips) load in parallel.
    await Promise.all([
      pose.isReady ? Promise.resolve() : pose.init(),
      hand.isReady ? Promise.resolve() : hand.init(),
    ]);

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

buildLanguageMenu();
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

if (btnTutorialEntry && tutorialDialog) {
  btnTutorialEntry.addEventListener('click', () => {
    void playClick();
    tutorialDialog.showModal();
  });
}

if (btnCloseTutorial && tutorialDialog) {
  btnCloseTutorial.addEventListener('click', () => {
    void playClick();
    tutorialDialog.close();
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

// Cleanup on page unload
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
  hand.destroy();
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

// Service worker registration
if (import.meta.env.PROD && 'serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(err => {
      console.error('[ServiceWorker] Registration failed:', err);
    });
  });
}
