/**
 * Layer 4 — Application: Audio Engine
 *
 * Two subsystems sharing a single AudioContext:
 *   1. TTS — kokoro-js (Kokoro-82M ONNX, 100% local inference)
 *   2. UI Sounds — Web Audio API oscillator tones
 *
 * Models expected at /models/kokoro/ (manually provisioned, no fetch).
 * AudioContext is lazy-initialized on first user gesture (autoplay policy).
 */

/** @type {AudioContext|null} */
let audioCtx = null;

/** @type {import('kokoro-js').KokoroTTS|null} */
let ttsInstance = null;

/** @type {boolean} */
let ttsLoading = false;

// ── AudioContext Management ──

/**
 * Get or create the shared AudioContext.
 * Resumes if suspended (browser autoplay policy).
 * @returns {Promise<AudioContext>}
 */
async function getAudioContext() {
  if (!audioCtx) {
    audioCtx = new AudioContext();
  }
  if (audioCtx.state === 'suspended') {
    await audioCtx.resume();
  }
  return audioCtx;
}

// ── TTS Module (kokoro-js) ──

/**
 * Lazy-initialize the Kokoro TTS engine.
 * The model is heavy (~80-330MB), so we only load on first speech request.
 * @returns {Promise<import('kokoro-js').KokoroTTS>}
 */
async function getTTSInstance() {
  if (ttsInstance) return ttsInstance;
  if (ttsLoading) {
    // Wait for the already-in-progress load
    return new Promise((resolve) => {
      const interval = setInterval(() => {
        if (ttsInstance) {
          clearInterval(interval);
          resolve(ttsInstance);
        }
      }, 100);
    });
  }

  ttsLoading = true;
  console.info('[AudioEngine] Loading Kokoro-82M TTS model...');

  try {
    // Dynamic import — tree-shaken out if TTS is never invoked
    const { KokoroTTS } = await import('kokoro-js');

    ttsInstance = await KokoroTTS.from_pretrained(
      'onnx-community/Kokoro-82M-ONNX',
      {
        dtype: 'q8',
        device: 'wasm',
      }
    );

    console.info('[AudioEngine] Kokoro TTS ready.');
    return ttsInstance;
  } catch (err) {
    ttsLoading = false;
    throw new Error(`[AudioEngine] TTS load failed: ${err.message}`);
  }
}

/**
 * Speak text using locally-inferred Kokoro-82M.
 * Audio is routed through the shared AudioContext.
 *
 * @param {string} text — Text to synthesize
 * @param {string} [voice='af_sky'] — Voice preset
 * @returns {Promise<void>}
 */
export async function speak(text, voice = 'af_sky') {
  if (!text) return;

  const [tts, ctx] = await Promise.all([
    getTTSInstance(),
    getAudioContext(),
  ]);

  const audio = await tts.generate(text, { voice });

  // Convert the generated audio to a playable AudioBuffer
  const rawBuffer = audio.toWav();
  const audioBuffer = await ctx.decodeAudioData(rawBuffer.buffer);

  const source = ctx.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(ctx.destination);
  source.start();

  return new Promise((resolve) => {
    source.onended = resolve;
  });
}

// ── UI Sound Module (Oscillator) ──

/**
 * Play a simple tone for UI feedback (correct answer, error, etc.).
 * Uses Web Audio API oscillators — no external audio files needed.
 *
 * @param {number} frequency — Hz (e.g., 440 for A4)
 * @param {number} [duration=150] — milliseconds
 * @param {OscillatorType} [type='sine'] — sine | square | triangle | sawtooth
 */
export async function playTone(frequency, duration = 150, type = 'sine') {
  const ctx = await getAudioContext();
  const oscillator = ctx.createOscillator();
  const gain = ctx.createGain();

  oscillator.type = type;
  oscillator.frequency.setValueAtTime(frequency, ctx.currentTime);

  // Envelope: quick attack, smooth decay to avoid click artifacts
  gain.gain.setValueAtTime(0.3, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration / 1000);

  oscillator.connect(gain);
  gain.connect(ctx.destination);

  oscillator.start();
  oscillator.stop(ctx.currentTime + duration / 1000);
}

// ── Preset Sounds ──

/** Positive feedback — ascending two-tone chirp */
export function playSuccess() {
  playTone(523.25, 100, 'sine');   // C5
  setTimeout(() => playTone(659.25, 150, 'sine'), 120); // E5
}

/** Negative feedback — low buzz */
export function playError() {
  playTone(200, 250, 'square');
}

/** Neutral UI click */
export function playClick() {
  playTone(880, 60, 'triangle');
}

// ── Cleanup ──

/** Close the AudioContext and release all resources. */
export async function dispose() {
  if (audioCtx) {
    await audioCtx.close();
    audioCtx = null;
  }
  ttsInstance = null;
  ttsLoading = false;
}
