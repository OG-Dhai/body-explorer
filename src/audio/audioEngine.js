/**
 * Layer 4: Application: Audio Engine
 *
 * Provides audio playback using Web Audio API caching.
 *   1. Pre-recorded voice prompts
 *   2. Curated gameplay music, transition cues, and UI feedback
 *   3. Oscillator fallbacks for graceful degradation
 *
 * AudioContext is lazy-initialized on first user gesture.
 */

import { i18n, AUDIO_KEYS } from '../core/i18n.js';
import eventBus from '../core/eventBus.js';

/** @type {AudioContext|null} */
let audioCtx = null;
/** @type {GainNode|null} */
let masterGain = null;

export const AUDIO_MUTED_STORAGE_KEY = 'body-explorer.audio-muted';

function readStoredMutedPreference() {
  try {
    return globalThis.localStorage?.getItem(AUDIO_MUTED_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function persistMutedPreference(value) {
  try {
    globalThis.localStorage?.setItem(AUDIO_MUTED_STORAGE_KEY, String(value));
  } catch {
    // Storage can be unavailable in privacy modes. Audio still works in-memory.
  }
}

let muted = readStoredMutedPreference();
let pauseRequested = false;
let playbackGeneration = 0;

const audioCache = new Map();
const pendingAudioLoads = new Map();
let reverseMap = null;
let reverseMapLang = null;

const BACKGROUND_VOLUME = 0.14;
const BACKGROUND_DUCKED_VOLUME = 0.055;
const VOICE_VOLUME = 0.68;
const SFX_VOLUME = 0.34;
const UI_CLICK_VOLUME = 0.52;
const UI_MENU_SELECTION_VOLUME = 0.65;
const MUSIC_FADE_SECONDS = 0.35;
export const LOCALIZED_VOICE_LANGUAGES = Object.freeze(['fr', 'es', 'ru']);
const localizedVoiceLanguageSet = new Set(LOCALIZED_VOICE_LANGUAGES);

/**
 * Curated audio stays in its original folder with its original filenames.
 * Vite resolves these URLs in development and copies the files to the
 * production bundle without requiring duplicate public assets.
 */
export const GAME_AUDIO_ASSETS = Object.freeze({
  'cue:gameStart': Object.freeze({
    fileName: 'cartoon-good-vibes-intro-sunny-spark-497372.mp3',
    url: new URL('../../audio_downloads/cartoon-good-vibes-intro-sunny-spark-497372.mp3', import.meta.url).href,
    volume: 0.24,
  }),
  'cue:gameComplete': Object.freeze({
    fileName: 'cartoon-kids-endscreen-music-bright-button-bye-500891.mp3',
    url: new URL('../../audio_downloads/cartoon-kids-endscreen-music-bright-button-bye-500891.mp3', import.meta.url).href,
    volume: 0.28,
  }),
  'cue:levelComplete': Object.freeze({
    fileName: 'cartoon-transition-music-quick-color-hop-500898.mp3',
    url: new URL('../../audio_downloads/cartoon-transition-music-quick-color-hop-500898.mp3', import.meta.url).href,
    volume: 0.32,
  }),
  'cue:roundSuccess': Object.freeze({
    fileName: 'cartoon-transition-sting-fast-happy-turn-500910.mp3',
    url: new URL('../../audio_downloads/cartoon-transition-sting-fast-happy-turn-500910.mp3', import.meta.url).href,
    volume: 0.32,
  }),
  'bgm:soothing': Object.freeze({
    fileName: 'soothing-happy-strings-loop-294236.mp3',
    url: new URL('../../audio_downloads/soothing-happy-strings-loop-294236.mp3', import.meta.url).href,
    volume: BACKGROUND_VOLUME,
  }),
  'bgm:upbeat': Object.freeze({
    fileName: 'the-best-day-ever-loop-533304.mp3',
    url: new URL('../../audio_downloads/the-best-day-ever-loop-533304.mp3', import.meta.url).href,
    volume: BACKGROUND_VOLUME,
  }),
  'ui:click': Object.freeze({
    fileName: 'click.wav',
    url: new URL('../../audio_downloads/click.wav', import.meta.url).href,
    volume: UI_CLICK_VOLUME,
  }),
  'ui:menuSelection': Object.freeze({
    fileName: 'Menu Selection Click.wav',
    url: new URL('../../audio_downloads/Menu Selection Click.wav', import.meta.url).href,
    volume: UI_MENU_SELECTION_VOLUME,
  }),
});

const BACKGROUND_TRACKS = ['bgm:soothing', 'bgm:upbeat'];

/** @type {{ key: string, source: AudioBufferSourceNode, gain: GainNode }|null} */
let backgroundPlayback = null;
const cuePlaybacks = new Map();
let activeVoicePlayback = null;
let backgroundDuckCount = 0;
let backgroundPlaybackGeneration = 0;
const transientPlaybacks = new Set();
const scheduledToneTimers = new Set();

// ── AudioContext Management ──

/**
 * Get or create the shared AudioContext.
 * Resumes if suspended (browser autoplay policy).
 * @returns {Promise<AudioContext>}
 */
async function getAudioContext() {
  if (!audioCtx) {
    const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AudioContextClass) {
      throw new Error('Web Audio API is not supported in this browser.');
    }
    audioCtx = new AudioContextClass();
  }

  if (!masterGain) {
    masterGain = audioCtx.createGain();
    masterGain.gain.value = muted ? 0 : 1;
    masterGain.connect(audioCtx.destination);
  }

  if (audioCtx.state === 'suspended' && !pauseRequested) {
    await audioCtx.resume();
  }
  return audioCtx;
}

function canStartPlayback(generation, { allowMuted = false } = {}) {
  return generation === playbackGeneration
    && !pauseRequested
    && (allowMuted || !muted);
}

function setMasterGainValue(value) {
  if (!masterGain || !audioCtx) return;
  const now = audioCtx.currentTime;
  masterGain.gain.cancelScheduledValues?.(now);
  masterGain.gain.setValueAtTime?.(value, now);
  masterGain.gain.value = value;
}

/**
 * Explicitly unlock Web Audio from a trusted click/tap before any long boot
 * work. Returns false instead of blocking gameplay when audio is unavailable.
 */
export async function unlockAudio() {
  try {
    await getAudioContext();
    return true;
  } catch (error) {
    console.warn('[AudioEngine] Could not unlock audio; the game will continue silently.', error);
    return false;
  }
}

/** Return the persisted master-mute preference without creating AudioContext. */
export function isMuted() {
  return muted;
}

/**
 * Set the single master bus to silent/audible. Muting also cancels active
 * one-shots so no delayed narration or cue can surface after unmuting; the
 * looping background source remains alive and resumes at its current point.
 */
export function setMuted(shouldMute) {
  const nextMuted = Boolean(shouldMute);
  if (muted === nextMuted) {
    persistMutedPreference(muted);
    setMasterGainValue(muted ? 0 : 1);
    return muted;
  }

  muted = nextMuted;
  persistMutedPreference(muted);
  setMasterGainValue(muted ? 0 : 1);

  if (muted) {
    playbackGeneration++;
    stopVoicePlayback(0);
    stopAllCuePlaybacks(0);
    stopAllTransientPlaybacks(0);
    clearScheduledToneTimers();
  }

  eventBus.emit('audio:muteChange', { muted });
  return muted;
}

export function toggleMuted() {
  return setMuted(!muted);
}

/**
 * Temporarily freeze session audio without changing the persisted mute state.
 * Active narration/cues are ended so an interrupted question can be replayed;
 * the background loop stays positioned inside the suspended AudioContext.
 */
export async function pauseAudio() {
  if (pauseRequested) return true;
  pauseRequested = true;
  playbackGeneration++;
  stopVoicePlayback(0);
  stopAllCuePlaybacks(0);
  stopAllTransientPlaybacks(0);
  clearScheduledToneTimers();

  try {
    if (audioCtx?.state === 'running') {
      await audioCtx.suspend();
    }
    return true;
  } catch (error) {
    console.warn('[AudioEngine] Could not pause audio cleanly.', error);
    return false;
  }
}

/** Resume a paused session. Call this directly from the trusted cancel click. */
export async function resumeAudio() {
  pauseRequested = false;
  try {
    if (audioCtx?.state === 'suspended') {
      await audioCtx.resume();
    }
    return true;
  } catch (error) {
    console.warn('[AudioEngine] Could not resume audio cleanly.', error);
    return false;
  }
}

// ── Pre-recorded Audio Cache ──

function resolveLegacyAsset(key, lang) {
  if (key.startsWith('sfx:')) {
    const name = key.split(':')[1];
    return { key, cacheKey: key, url: `/audio/sfx/${name}.mp3` };
  }

  if (key.startsWith('bgm:')) {
    const name = key.split(':')[1];
    return { key, cacheKey: key, url: `/audio/music/${name}.mp3` };
  }

  const urlPath = key.replace('.', '/');
  return {
    key,
    cacheKey: `${lang}:${key}`,
    url: `/audio/${lang}/${urlPath}.mp3`,
  };
}

async function cacheAudioAsset(ctx, { cacheKey, url }) {
  if (audioCache.has(cacheKey)) return;
  if (pendingAudioLoads.has(cacheKey)) {
    await pendingAudioLoads.get(cacheKey);
    return;
  }

  const loadPromise = (async () => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    audioCache.set(cacheKey, audioBuffer);
  })();

  pendingAudioLoads.set(cacheKey, loadPromise);
  try {
    await loadPromise;
  } finally {
    pendingAudioLoads.delete(cacheKey);
  }
}

/**
 * Preload all localized audio clips into AudioBuffers for instant playback.
 */
export async function preloadAudioAssets(targetLang = null) {
  const failedKeys = [];
  const lang = targetLang || i18n.getLocale();
  const gameAssets = Object.entries(GAME_AUDIO_ASSETS).map(([key, asset]) => ({
    key,
    cacheKey: key,
    url: asset.url,
  }));
  const localizedAudioKeys = AUDIO_KEYS.filter(
    (key) => !key.startsWith('voice.') || localizedVoiceLanguageSet.has(lang),
  );
  const assets = [
    ...localizedAudioKeys.map((key) => resolveLegacyAsset(key, lang)),
    ...gameAssets,
  ];

  try {
    const ctx = await getAudioContext();

    const loadPromises = assets.map(async (asset) => {
      try {
        await cacheAudioAsset(ctx, asset);
      } catch (e) {
        failedKeys.push(asset.key);
        console.warn(`[AudioEngine] Failed to preload ${asset.key}: ${e.message}`);
      }
    });

    await Promise.all(loadPromises);
    if (failedKeys.length > 0) {
      console.warn(`[AudioEngine] Preload completed with ${failedKeys.length} missing asset(s); oscillator fallbacks remain enabled.`);
      return { ok: false, failedKeys };
    }

    console.info(`[AudioEngine] Preload pass completed for locale: ${lang}`);
    return { ok: true, failedKeys };
  } catch (e) {
    console.warn(`[AudioEngine] Audio preload unavailable for locale ${lang}; continuing with oscillator fallbacks.`, e);
    return {
      ok: false,
      failedKeys: failedKeys.length > 0 ? failedKeys : assets.map(({ key }) => key),
    };
  }
}

// A locale switch invalidates every pending/active spoken clip before the new
// language is preloaded. This prevents a slow fetch or decode from starting
// narration in the language that was just left.
eventBus.on('i18n:change', ({ lang }) => {
  playbackGeneration++;
  stopVoicePlayback(0);
  preloadAudioAssets(lang).catch(err => console.error('[AudioEngine] Background preload failed:', err));
});

function cleanUpVoicePlayback(playback) {
  if (!playback || playback.cleanedUp) return;
  playback.cleanedUp = true;
  if (activeVoicePlayback === playback) activeVoicePlayback = null;
  setBackgroundDucked(false);
  playback.resolve(true);
}

function stopVoicePlayback(fadeSeconds = 0.04) {
  const playback = activeVoicePlayback;
  if (!playback) return;
  cleanUpVoicePlayback(playback);
  stopPlayback(playback, fadeSeconds);
}

async function playFallbackVoiceTone(text) {
  const generation = playbackGeneration;
  if (!canStartPlayback(generation)) return false;
  const durationMs = Math.min(2000, text.length * 50);
  stopAllCuePlaybacks(0.08);
  stopVoicePlayback();
  setBackgroundDucked(true);
  try {
    await playTone(440, durationMs, 'triangle');
    await new Promise((resolve) => setTimeout(resolve, durationMs));
  } finally {
    setBackgroundDucked(false);
  }
  return false;
}

/**
 * Play localized narration by its canonical i18n key. Direct keys avoid the
 * duplicate-text collisions between ui.*, fb.*, and voice.* translations.
 *
 * @param {string} key: An edu.*, fact.*, or voice.* i18n key
 * @param {{ fallbackToTone?: boolean }} [options]
 * @returns {Promise<boolean>} true when a recorded clip was started
 */
export async function speakKey(key, { fallbackToTone = true } = {}) {
  const lang = i18n.getLocale();
  const text = i18n.t(key);
  const isLocalizedKey = key.startsWith('edu.')
    || key.startsWith('fact.')
    || key.startsWith('voice.');

  if (!isLocalizedKey || text === key) {
    console.warn(`[AudioEngine] Unknown localized audio key: ${key}`);
    return false;
  }

  // Recorded praise clips exist for these locales only; EN/DE use non-verbal
  // feedback while retaining their educational narration.
  if (key.startsWith('voice.') && !localizedVoiceLanguageSet.has(lang)) {
    return false;
  }

  const generation = playbackGeneration;
  if (!canStartPlayback(generation)) return false;

  try {
    const ctx = await getAudioContext();
    if (!canStartPlayback(generation)) return false;
    const asset = resolveLegacyAsset(key, lang);
    if (!audioCache.has(asset.cacheKey)) {
      await cacheAudioAsset(ctx, asset);
    }

    if (!canStartPlayback(generation)) return false;

    const buffer = audioCache.get(asset.cacheKey);
    if (!buffer) throw new Error('Decoded audio buffer is unavailable.');

    // Spoken instructions take priority over short transition/success stings.
    stopAllCuePlaybacks(0.08);
    stopVoicePlayback();
    setBackgroundDucked(true);

    return await new Promise((resolve, reject) => {
      const source = ctx.createBufferSource();
      const gain = ctx.createGain();
      const playback = {
        source,
        gain,
        resolve,
        cleanedUp: false,
      };

      source.buffer = buffer;
      gain.gain.value = VOICE_VOLUME;
      source.connect(gain);
      gain.connect(masterGain);
      source.onended = () => cleanUpVoicePlayback(playback);
      activeVoicePlayback = playback;

      try {
        source.start();
      } catch (error) {
        playback.cleanedUp = true;
        if (activeVoicePlayback === playback) activeVoicePlayback = null;
        setBackgroundDucked(false);
        reject(error);
      }
    });
  } catch (error) {
    if (!canStartPlayback(generation)) return false;
    console.warn(`[AudioEngine] Audio for ${lang}:${key} is unavailable.`, error);
    if (!fallbackToTone) return false;
    return playFallbackVoiceTone(text);
  }
}

/**
 * Backward-compatible text lookup. New gameplay code should call speakKey().
 * @param {string} text
 * @returns {Promise<boolean>}
 */
export async function speak(text) {
  if (!text) return false;
  const lang = i18n.getLocale();
  if (reverseMapLang !== lang) {
    // Only map phrases that can actually be played. The full dictionary has
    // intentional duplicate text (for example fb.great and voice.great), whose
    // first match may not be an audio key.
    reverseMap = new Map();
    for (const key of AUDIO_KEYS) {
      const translatedText = i18n.t(key);
      if (translatedText !== key) reverseMap.set(translatedText, key);
    }
    reverseMapLang = lang;
  }

  const key = reverseMap.get(text);
  if (key) return speakKey(key);

  console.warn(`[AudioEngine] No i18n key found for "${text}"; using tone fallback.`);
  return playFallbackVoiceTone(text);
}

// ── UI Sound Module (Oscillator) ──

/**
 * Play a simple tone for UI feedback (correct answer, error, etc.).
 * Uses Web Audio API oscillators: no external audio files needed.
 *
 * @param {number} frequency: Hz (e.g., 440 for A4)
 * @param {number} [duration=150]: milliseconds
 * @param {OscillatorType} [type='sine']: sine | square | triangle | sawtooth
 */
export async function playTone(frequency, duration = 150, type = 'sine') {
  const generation = playbackGeneration;
  if (!canStartPlayback(generation)) return false;

  try {
    const ctx = await getAudioContext();
    if (!canStartPlayback(generation)) return false;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, ctx.currentTime);

    // Envelope: quick attack, smooth decay to avoid click artifacts
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration / 1000);

    oscillator.connect(gain);
    gain.connect(masterGain);

    const playback = trackTransientPlayback(oscillator, gain);

    try {
      oscillator.start();
      oscillator.stop(ctx.currentTime + duration / 1000);
    } catch (error) {
      cleanUpTransientPlayback(playback);
      throw error;
    }
    return true;
  } catch (error) {
    console.warn('[AudioEngine] Tone playback unavailable.', error);
    return false;
  }
}

// ── Preset Sounds ──

function setGainTarget(gainNode, value, fadeSeconds = 0.12) {
  if (!audioCtx) return;
  const now = audioCtx.currentTime;
  const gain = gainNode.gain;
  gain.cancelScheduledValues?.(now);
  gain.setValueAtTime?.(Math.max(gain.value || 0.0001, 0.0001), now);
  gain.linearRampToValueAtTime?.(Math.max(value, 0.0001), now + fadeSeconds);
  if (!gain.linearRampToValueAtTime) gain.value = value;
}

function stopPlayback(playback, fadeSeconds = 0.12) {
  if (!playback || playback.stopped || !audioCtx) return;
  playback.stopped = true;
  const now = audioCtx.currentTime;
  try {
    setGainTarget(playback.gain, 0.0001, fadeSeconds);
    playback.source.stop(now + fadeSeconds);
  } catch {
    // AudioBufferSourceNode.stop() throws if a source was already stopped.
  }
}

function cleanUpTransientPlayback(playback) {
  if (!playback || playback.cleanedUp) return;
  playback.cleanedUp = true;
  transientPlaybacks.delete(playback);
}

function trackTransientPlayback(source, gain) {
  const playback = {
    source,
    gain,
    stopped: false,
    cleanedUp: false,
  };
  const previousOnEnded = source.onended;
  source.onended = (...args) => {
    cleanUpTransientPlayback(playback);
    previousOnEnded?.(...args);
  };
  transientPlaybacks.add(playback);
  return playback;
}

function stopAllTransientPlaybacks(fadeSeconds = 0) {
  for (const playback of [...transientPlaybacks]) {
    cleanUpTransientPlayback(playback);
    stopPlayback(playback, fadeSeconds);
  }
}

function clearScheduledToneTimers() {
  for (const timerId of scheduledToneTimers) {
    clearTimeout(timerId);
  }
  scheduledToneTimers.clear();
}

function scheduleTone(callback, delayMs) {
  const generation = playbackGeneration;
  const timerId = setTimeout(() => {
    scheduledToneTimers.delete(timerId);
    if (canStartPlayback(generation)) callback();
  }, delayMs);
  scheduledToneTimers.add(timerId);
  return timerId;
}

function updateBackgroundGain(fadeSeconds = 0.12) {
  if (!backgroundPlayback) return;
  const asset = GAME_AUDIO_ASSETS[backgroundPlayback.key];
  const volume = backgroundDuckCount > 0
    ? BACKGROUND_DUCKED_VOLUME
    : asset.volume;
  setGainTarget(backgroundPlayback.gain, volume, fadeSeconds);
}

function setBackgroundDucked(shouldDuck) {
  backgroundDuckCount = shouldDuck
    ? backgroundDuckCount + 1
    : Math.max(0, backgroundDuckCount - 1);
  updateBackgroundGain();
}

function cleanUpCuePlayback(playback) {
  if (!playback || playback.cleanedUp) return;
  playback.cleanedUp = true;
  if (cuePlaybacks.get(playback.key) === playback) {
    cuePlaybacks.delete(playback.key);
  }
  if (playback.ducksBackground) {
    setBackgroundDucked(false);
  }
}

function stopCuePlayback(key, fadeSeconds = 0.12) {
  const playback = cuePlaybacks.get(key);
  if (!playback) return;
  cleanUpCuePlayback(playback);
  stopPlayback(playback, fadeSeconds);
}

function stopAllCuePlaybacks(fadeSeconds = 0.08) {
  for (const key of [...cuePlaybacks.keys()]) {
    stopCuePlayback(key, fadeSeconds);
  }
}

async function playCachedCue(key, fallbackFn = null, { duckBackground = true } = {}) {
  let playback = null;
  const generation = playbackGeneration;
  if (!canStartPlayback(generation)) return false;

  try {
    const ctx = await getAudioContext();
    if (!canStartPlayback(generation)) return false;
    const buffer = audioCache.get(key);
    const asset = GAME_AUDIO_ASSETS[key];

    if (!buffer || !asset) {
      if (fallbackFn && canStartPlayback(generation)) await fallbackFn();
      return false;
    }

    stopCuePlayback(key, 0.04);

    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    source.buffer = buffer;
    gain.gain.value = asset.volume;
    source.connect(gain);
    gain.connect(masterGain);

    playback = {
      key,
      source,
      gain,
      ducksBackground: duckBackground,
      cleanedUp: false,
    };
    cuePlaybacks.set(key, playback);
    if (duckBackground) setBackgroundDucked(true);
    source.onended = () => cleanUpCuePlayback(playback);
    source.start();

    return true;
  } catch (error) {
    if (playback) {
      cleanUpCuePlayback(playback);
      stopPlayback(playback, 0);
    }
    if (!canStartPlayback(generation)) return false;
    console.warn(`[AudioEngine] Could not play ${key}; using fallback when available.`, error);
    if (fallbackFn) await fallbackFn();
    return false;
  }
}

async function playCachedSfx(key, fallbackFn) {
  const generation = playbackGeneration;
  if (!canStartPlayback(generation)) return false;

  try {
    const ctx = await getAudioContext();
    if (!canStartPlayback(generation)) return false;
    const asset = GAME_AUDIO_ASSETS[key];

    // UI feedback can be the gesture that unlocks audio, before the main Start
    // preload. Load these tiny files on demand so the first interaction uses
    // the recorded sound instead of waiting for the full game asset pass.
    if (!audioCache.has(key) && asset) {
      await cacheAudioAsset(ctx, {
        cacheKey: key,
        url: asset.url,
      });
    }

    if (!canStartPlayback(generation)) return false;

    const buffer = audioCache.get(key);
    if (buffer) {
      const source = ctx.createBufferSource();
      const gain = ctx.createGain();
      source.buffer = buffer;
      gain.gain.value = asset?.volume ?? SFX_VOLUME;
      source.connect(gain);
      gain.connect(masterGain);
      const playback = trackTransientPlayback(source, gain);
      try {
        source.start();
      } catch (error) {
        cleanUpTransientPlayback(playback);
        throw error;
      }
      return true;
    }
  } catch (error) {
    console.warn(`[AudioEngine] Could not play ${key}; using oscillator fallback.`, error);
  }

  if (fallbackFn && canStartPlayback(generation)) await fallbackFn();
  return false;
}

export function getBackgroundTrackKeyForLevel(level = 1) {
  const numericLevel = Number(level);
  const safeLevel = Number.isInteger(numericLevel) && numericLevel > 0 ? numericLevel : 1;
  return BACKGROUND_TRACKS[(safeLevel - 1) % BACKGROUND_TRACKS.length];
}

/** Start one non-stacking, seamlessly looping gameplay track for this level. */
export async function playBackgroundMusic(level = 1) {
  const backgroundGeneration = ++backgroundPlaybackGeneration;
  const requestGeneration = playbackGeneration;
  try {
    const ctx = await getAudioContext();
    if (backgroundGeneration !== backgroundPlaybackGeneration
      || !canStartPlayback(requestGeneration, { allowMuted: true })) return false;

    const key = getBackgroundTrackKeyForLevel(level);
    const asset = GAME_AUDIO_ASSETS[key];
    const buffer = audioCache.get(key);

    // Result-screen cues have done their job once gameplay begins.
    stopCuePlayback('cue:gameComplete', 0.12);
    stopCuePlayback('cue:levelComplete', 0.12);

    if (!buffer) {
      console.warn(`[AudioEngine] Background track ${asset.fileName} is not cached; continuing without music.`);
      return false;
    }
    if (backgroundPlayback?.key === key) return true;

    const previousPlayback = backgroundPlayback;
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    const targetVolume = backgroundDuckCount > 0
      ? BACKGROUND_DUCKED_VOLUME
      : asset.volume;

    source.buffer = buffer;
    source.loop = true;
    gain.gain.value = 0.0001;
    source.connect(gain);
    gain.connect(masterGain);

    const playback = { key, source, gain };
    backgroundPlayback = playback;
    source.onended = () => {
      if (backgroundPlayback === playback) backgroundPlayback = null;
    };
    source.start();
    setGainTarget(gain, targetVolume, MUSIC_FADE_SECONDS);

    if (previousPlayback) stopPlayback(previousPlayback, MUSIC_FADE_SECONDS);
    return true;
  } catch (error) {
    console.warn('[AudioEngine] Background music unavailable; gameplay will continue.', error);
    return false;
  }
}

/** Fade out the active gameplay loop, if any. */
export function stopBackgroundMusic(fadeSeconds = MUSIC_FADE_SECONDS) {
  backgroundPlaybackGeneration++;
  const playback = backgroundPlayback;
  backgroundPlayback = null;
  stopPlayback(playback, fadeSeconds);
}

/** Start/loading transition cue. It is faded when gameplay music starts. */
export function playGameStart() {
  stopCuePlayback('cue:gameComplete', 0.08);
  stopCuePlayback('cue:levelComplete', 0.08);
  return playCachedCue('cue:gameStart', null, { duckBackground: true });
}

/** Cancel the start/loading transition if boot cannot continue. */
export function stopGameStart(fadeSeconds = 0.12) {
  stopCuePlayback('cue:gameStart', fadeSeconds);
}

/** Correct-answer success sting. */
export function playSuccess() {
  return playCachedCue('cue:roundSuccess', () => {
    playTone(523.25, 100, 'sine');   // C5
    scheduleTone(() => playTone(659.25, 150, 'sine'), 120); // E5
  });
}

/** Passed-level transition cue. */
export function playWellDone() {
  stopCuePlayback('cue:roundSuccess', 0.08);
  return playCachedCue('cue:levelComplete', () => {
    playTone(523.25, 120, 'triangle');
    scheduleTone(() => playTone(659.25, 120, 'triangle'), 130);
    scheduleTone(() => playTone(783.99, 180, 'triangle'), 260);
  }, { duckBackground: false });
}

/** End-screen transition cue. */
export function playGameComplete() {
  stopAllCuePlaybacks(0.08);
  return playCachedCue('cue:gameComplete', () => {
    playTone(659.25, 90, 'sine');
    scheduleTone(() => playTone(783.99, 90, 'sine'), 110);
    scheduleTone(() => playTone(1046.5, 220, 'triangle'), 220);
  }, { duckBackground: false });
}

/** Backward-compatible alias retained for any existing callers. */
export function playFireworks() {
  return playGameComplete();
}

/** Negative feedback: low buzz */
export function playError() {
  // Uses oscillator by default if sfx:error fails to load, per UX decision
  return playCachedSfx('sfx:error', () => {
    playTone(200, 250, 'square');
  });
}

/** Neutral UI click */
export function playClick() {
  return playCachedSfx('ui:click', () => {
    playTone(880, 60, 'triangle');
  });
}

/** Difficulty/menu selection confirmation. */
export function playMenuSelection() {
  return playCachedSfx('ui:menuSelection', () => {
    playTone(659.25, 90, 'sine');
  });
}

// ── Cleanup ──

/** Stop every active or pending sound without changing the mute preference. */
export function stopAllAudio() {
  playbackGeneration++;
  pauseRequested = false;
  stopVoicePlayback(0);
  stopBackgroundMusic(0);
  stopAllCuePlaybacks(0);
  stopAllTransientPlaybacks(0);
  clearScheduledToneTimers();
  backgroundDuckCount = 0;
}

/** Close the AudioContext and release all resources. */
export async function dispose() {
  stopAllAudio();
  if (audioCtx) {
    await audioCtx.close();
    audioCtx = null;
  }
  masterGain = null;
  audioCache.clear();
  pendingAudioLoads.clear();
  reverseMap = null;
  reverseMapLang = null;
  backgroundDuckCount = 0;
}
