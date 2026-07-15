import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let contexts;
let storage;

class FakeAudioParam {
  constructor(value = 1) {
    this.value = value;
    this.cancelScheduledValues = vi.fn();
    this.setValueAtTime = vi.fn((nextValue) => {
      this.value = nextValue;
    });
    this.linearRampToValueAtTime = vi.fn((nextValue) => {
      this.value = nextValue;
    });
    this.exponentialRampToValueAtTime = vi.fn((nextValue) => {
      this.value = nextValue;
    });
  }
}

class FakeAudioContext {
  constructor() {
    this.state = 'suspended';
    this.currentTime = 0;
    this.destination = { kind: 'destination' };
    this.sources = [];
    this.gains = [];
    this.oscillators = [];
    this.resume = vi.fn(async () => {
      this.state = 'running';
    });
    this.suspend = vi.fn(async () => {
      this.state = 'suspended';
    });
    this.close = vi.fn(async () => {
      this.state = 'closed';
    });
    this.decodeAudioData = vi.fn(async (arrayBuffer) => ({
      decodedFrom: arrayBuffer.assetUrl,
    }));
    contexts.push(this);
  }

  createBufferSource() {
    const source = {
      buffer: null,
      loop: false,
      onended: null,
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    };
    this.sources.push(source);
    return source;
  }

  createGain() {
    const gain = {
      gain: new FakeAudioParam(),
      connect: vi.fn(),
    };
    this.gains.push(gain);
    return gain;
  }

  createOscillator() {
    const oscillator = {
      type: 'sine',
      frequency: new FakeAudioParam(),
      onended: null,
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
    };
    this.oscillators.push(oscillator);
    return oscillator;
  }
}

async function importAudioEngine() {
  vi.resetModules();
  return import('./audioEngine.js');
}

beforeEach(() => {
  contexts = [];
  storage = new Map();
  vi.stubGlobal('AudioContext', FakeAudioContext);
  vi.stubGlobal('localStorage', {
    getItem: vi.fn((key) => storage.get(key) ?? null),
    setItem: vi.fn((key, value) => storage.set(key, String(value))),
  });
  vi.stubGlobal('fetch', vi.fn(async (url) => ({
    ok: true,
    arrayBuffer: async () => {
      const buffer = new ArrayBuffer(8);
      buffer.assetUrl = String(url);
      return buffer;
    },
  })));
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('curated game audio integration', () => {
  it('references all eight original audio_downloads filenames', async () => {
    const { GAME_AUDIO_ASSETS } = await importAudioEngine();
    const filenames = Object.values(GAME_AUDIO_ASSETS).map(({ fileName }) => fileName);

    expect(filenames).toEqual([
      'cartoon-good-vibes-intro-sunny-spark-497372.mp3',
      'cartoon-kids-endscreen-music-bright-button-bye-500891.mp3',
      'cartoon-transition-music-quick-color-hop-500898.mp3',
      'cartoon-transition-sting-fast-happy-turn-500910.mp3',
      'soothing-happy-strings-loop-294236.mp3',
      'the-best-day-ever-loop-533304.mp3',
      'click.wav',
      'Menu Selection Click.wav',
    ]);

    for (const asset of Object.values(GAME_AUDIO_ASSETS)) {
      expect(asset.url).toContain('/audio_downloads/');
      expect(decodeURIComponent(asset.url)).toContain(asset.fileName);
      expect(asset.volume).toBeLessThanOrEqual(0.65);
    }

    const nonUiAssets = Object.entries(GAME_AUDIO_ASSETS)
      .filter(([key]) => !key.startsWith('ui:'))
      .map(([, asset]) => asset);
    expect(nonUiAssets.every(({ volume }) => volume <= 0.32)).toBe(true);
  });

  it('unlocks from the user gesture and preloads every curated audio asset', async () => {
    const { GAME_AUDIO_ASSETS, preloadAudioAssets, unlockAudio } = await importAudioEngine();

    await expect(unlockAudio()).resolves.toBe(true);
    expect(contexts).toHaveLength(1);
    expect(contexts[0].resume).toHaveBeenCalledOnce();

    const result = await preloadAudioAssets();
    const requestedUrls = fetch.mock.calls.map(([url]) => String(url));

    expect(result.ok).toBe(true);
    for (const asset of Object.values(GAME_AUDIO_ASSETS)) {
      expect(requestedUrls).toContain(asset.url);
    }
    expect(requestedUrls.some((url) => url.includes('/audio/en/voice/'))).toBe(false);
  });

  it('plays feedback by its exact voice key without reverse-translation collisions', async () => {
    const { preloadAudioAssets, speakKey } = await importAudioEngine();
    const { i18n } = await import('../core/i18n.js');
    i18n.setLocale('fr');
    await preloadAudioAssets('fr');

    const ctx = contexts[0];
    const playbackPromise = speakKey('voice.great', { fallbackToTone: false });
    await vi.waitFor(() => expect(ctx.sources.length).toBeGreaterThan(0));

    const voiceSource = ctx.sources.at(-1);
    expect(voiceSource.buffer.decodedFrom).toContain('/audio/fr/voice/great.mp3');
    expect(voiceSource.buffer.decodedFrom).not.toContain('/fb/');
    voiceSource.onended?.();
    await expect(playbackPromise).resolves.toBe(true);
  });

  it('loads and plays a localized body-part fact by its canonical key', async () => {
    const { preloadAudioAssets, speakKey } = await importAudioEngine();
    const { i18n } = await import('../core/i18n.js');
    i18n.setLocale('de');
    await preloadAudioAssets('de');

    const ctx = contexts[0];
    const playbackPromise = speakKey('fact.nose', { fallbackToTone: false });
    await vi.waitFor(() => expect(ctx.sources.length).toBeGreaterThan(0));

    const factSource = ctx.sources.at(-1);
    expect(factSource.buffer.decodedFrom).toContain('/audio/de/fact/nose.mp3');
    factSource.onended?.();
    await expect(playbackPromise).resolves.toBe(true);
  });

  it('leaves EN/DE feedback unchanged when no localized voice files exist', async () => {
    const { speakKey } = await importAudioEngine();

    await expect(speakKey('voice.great', { fallbackToTone: false })).resolves.toBe(false);
    expect(fetch).not.toHaveBeenCalled();
    expect(contexts).toHaveLength(0);
  });

  it('stops active narration immediately when the locale changes', async () => {
    const { speakKey } = await importAudioEngine();
    const { i18n } = await import('../core/i18n.js');
    i18n.setLocale('fr');

    const playbackPromise = speakKey('edu.nose', { fallbackToTone: false });
    await vi.waitFor(() => expect(contexts[0]?.sources.length).toBeGreaterThan(0));
    const frenchSource = contexts[0].sources.at(-1);
    expect(frenchSource.buffer.decodedFrom).toContain('/audio/fr/edu/nose.mp3');

    i18n.setLocale('es');

    expect(frenchSource.stop).toHaveBeenCalledOnce();
    await expect(playbackPromise).resolves.toBe(true);
  });

  it('never starts an old-locale clip after a delayed fetch completes', async () => {
    vi.resetModules();
    const { i18n } = await import('../core/i18n.js');
    i18n.setLocale('fr');

    let releaseFrenchFetch;
    const frenchFetchGate = new Promise((resolve) => {
      releaseFrenchFetch = resolve;
    });
    fetch.mockImplementation(async (url) => {
      if (String(url).includes('/audio/fr/edu/nose.mp3')) {
        await frenchFetchGate;
      }
      return {
        ok: true,
        arrayBuffer: async () => {
          const buffer = new ArrayBuffer(8);
          buffer.assetUrl = String(url);
          return buffer;
        },
      };
    });

    const { speakKey } = await import('./audioEngine.js');
    const stalePlayback = speakKey('edu.nose', { fallbackToTone: false });
    await vi.waitFor(() => expect(
      fetch.mock.calls.some(([url]) => String(url).includes('/audio/fr/edu/nose.mp3'))
    ).toBe(true));

    i18n.setLocale('es');
    releaseFrenchFetch();

    await expect(stalePlayback).resolves.toBe(false);
    expect(contexts[0].sources).toHaveLength(0);
  });

  it('resolves duplicate translated text to a playable voice key', async () => {
    const { speak } = await importAudioEngine();
    const { i18n } = await import('../core/i18n.js');
    i18n.setLocale('ru');
    const duplicatedText = i18n.t('voice.great');
    expect(duplicatedText).toBe(i18n.t('fb.great'));

    const playbackPromise = speak(duplicatedText);
    await vi.waitFor(() => expect(contexts[0]?.sources.length).toBeGreaterThan(0));
    const voiceSource = contexts[0].sources.at(-1);
    expect(voiceSource.buffer.decodedFrom).toContain('/audio/ru/voice/great.mp3');
    voiceSource.onended?.();
    await expect(playbackPromise).resolves.toBe(true);
  });

  it('alternates non-stacking background loops by level at moderate volume', async () => {
    const {
      getBackgroundTrackKeyForLevel,
      playBackgroundMusic,
      preloadAudioAssets,
      stopBackgroundMusic,
    } = await importAudioEngine();

    await preloadAudioAssets();
    const ctx = contexts[0];

    expect(getBackgroundTrackKeyForLevel(1)).toBe('bgm:soothing');
    expect(getBackgroundTrackKeyForLevel(2)).toBe('bgm:upbeat');
    expect(getBackgroundTrackKeyForLevel(3)).toBe('bgm:soothing');

    await expect(playBackgroundMusic(1)).resolves.toBe(true);
    const levelOneSource = ctx.sources.at(-1);
    const levelOneGain = ctx.gains.at(-1);
    expect(levelOneSource.loop).toBe(true);
    expect(levelOneSource.start).toHaveBeenCalledOnce();
    expect(levelOneGain.gain.value).toBeCloseTo(0.14);

    await playBackgroundMusic(1);
    expect(ctx.sources).toHaveLength(1);

    await playBackgroundMusic(2);
    const levelTwoSource = ctx.sources.at(-1);
    expect(ctx.sources).toHaveLength(2);
    expect(levelTwoSource.loop).toBe(true);
    expect(levelTwoSource.buffer).not.toBe(levelOneSource.buffer);
    expect(levelOneSource.stop).toHaveBeenCalledOnce();

    stopBackgroundMusic(0);
    expect(levelTwoSource.stop).toHaveBeenCalledOnce();
  });

  it('maps the four one-shot cues to distinct non-looping buffers', async () => {
    const {
      playGameComplete,
      playGameStart,
      playSuccess,
      playWellDone,
      preloadAudioAssets,
    } = await importAudioEngine();

    await preloadAudioAssets();
    const ctx = contexts[0];

    await playGameStart();
    await playSuccess();
    await playWellDone();
    await playGameComplete();

    expect(ctx.sources).toHaveLength(4);
    expect(ctx.sources.every(({ loop }) => loop === false)).toBe(true);
    expect(new Set(ctx.sources.map(({ buffer }) => buffer)).size).toBe(4);
    expect(ctx.sources.every(({ start }) => start.mock.calls.length === 1)).toBe(true);
  });

  it('loads and plays both recorded UI sounds on demand at clearly audible, child-safe volume', async () => {
    const {
      GAME_AUDIO_ASSETS,
      playClick,
      playMenuSelection,
      unlockAudio,
    } = await importAudioEngine();

    await unlockAudio();
    const ctx = contexts[0];

    await expect(playClick()).resolves.toBe(true);
    await expect(playMenuSelection()).resolves.toBe(true);

    const requestedUrls = fetch.mock.calls.map(([url]) => String(url));
    expect(requestedUrls).toContain(GAME_AUDIO_ASSETS['ui:click'].url);
    expect(requestedUrls).toContain(GAME_AUDIO_ASSETS['ui:menuSelection'].url);
    expect(ctx.sources).toHaveLength(2);
    expect(ctx.sources.every(({ loop }) => loop === false)).toBe(true);
    expect(ctx.sources.every(({ start }) => start.mock.calls.length === 1)).toBe(true);
    expect(ctx.gains.at(-2).gain.value).toBeCloseTo(0.52);
    expect(ctx.gains.at(-1).gain.value).toBeCloseTo(0.65);
  });

  it('deduplicates the first Start click load against the full audio preload', async () => {
    const {
      GAME_AUDIO_ASSETS,
      playClick,
      preloadAudioAssets,
      unlockAudio,
    } = await importAudioEngine();

    const unlockPromise = unlockAudio();
    const clickPromise = playClick();
    const preloadPromise = unlockPromise.then(() => preloadAudioAssets());
    const [clickPlayed, preloadResult] = await Promise.all([clickPromise, preloadPromise]);

    const clickUrl = GAME_AUDIO_ASSETS['ui:click'].url;
    const clickRequests = fetch.mock.calls.filter(([url]) => String(url) === clickUrl);
    expect(clickPlayed).toBe(true);
    expect(preloadResult.ok).toBe(true);
    expect(clickRequests).toHaveLength(1);
  });

  it('keeps music ducked until the active cue ends without leaking nested duck state', async () => {
    const { playBackgroundMusic, playGameStart, preloadAudioAssets } = await importAudioEngine();

    await preloadAudioAssets();
    const ctx = contexts[0];
    await playBackgroundMusic(1);
    const backgroundGain = ctx.gains[1];

    await playGameStart();
    const firstCue = ctx.sources.at(-1);
    expect(backgroundGain.gain.value).toBeCloseTo(0.055);

    await playGameStart();
    const replacementCue = ctx.sources.at(-1);
    firstCue.onended?.();
    expect(backgroundGain.gain.value).toBeCloseTo(0.055);

    replacementCue.onended?.();
    expect(backgroundGain.gain.value).toBeCloseTo(0.14);
  });

  it('routes every sound through one master gain and persists exact mute state', async () => {
    storage.set('body-explorer.audio-muted', 'true');
    const {
      isMuted,
      playClick,
      setMuted,
      unlockAudio,
    } = await importAudioEngine();

    await unlockAudio();
    const ctx = contexts[0];
    const master = ctx.gains[0];

    expect(isMuted()).toBe(true);
    expect(master.gain.value).toBe(0);
    expect(master.connect).toHaveBeenCalledWith(ctx.destination);
    await expect(playClick()).resolves.toBe(false);
    expect(ctx.sources).toHaveLength(0);

    expect(setMuted(false)).toBe(false);
    await expect(playClick()).resolves.toBe(true);
    const soundGain = ctx.gains.at(-1);
    expect(soundGain.connect).toHaveBeenCalledWith(master);
    expect(master.gain.value).toBe(1);
    expect(localStorage.setItem).toHaveBeenLastCalledWith(
      'body-explorer.audio-muted',
      'false',
    );
  });

  it('mutes one-shots at the master while preserving the active background loop', async () => {
    const {
      playBackgroundMusic,
      playClick,
      preloadAudioAssets,
      setMuted,
    } = await importAudioEngine();

    await preloadAudioAssets();
    const ctx = contexts[0];
    await playBackgroundMusic(1);
    const backgroundSource = ctx.sources.at(-1);
    await playClick();
    const clickSource = ctx.sources.at(-1);

    setMuted(true);
    expect(ctx.gains[0].gain.value).toBe(0);
    expect(clickSource.stop).toHaveBeenCalledOnce();
    expect(backgroundSource.stop).not.toHaveBeenCalled();

    setMuted(false);
    expect(ctx.gains[0].gain.value).toBe(1);
    expect(backgroundSource.start).toHaveBeenCalledOnce();
  });

  it('pauses and resumes the shared context without restarting background music', async () => {
    const {
      pauseAudio,
      playBackgroundMusic,
      preloadAudioAssets,
      resumeAudio,
    } = await importAudioEngine();

    await preloadAudioAssets();
    const ctx = contexts[0];
    await playBackgroundMusic(1);
    const backgroundSource = ctx.sources.at(-1);

    await expect(pauseAudio()).resolves.toBe(true);
    expect(ctx.suspend).toHaveBeenCalledOnce();
    expect(backgroundSource.stop).not.toHaveBeenCalled();

    await expect(resumeAudio()).resolves.toBe(true);
    expect(ctx.resume).toHaveBeenCalledTimes(2);
    expect(backgroundSource.start).toHaveBeenCalledOnce();
  });

  it('stops all tracked sources idempotently', async () => {
    const {
      playBackgroundMusic,
      playClick,
      playGameStart,
      preloadAudioAssets,
      stopAllAudio,
    } = await importAudioEngine();

    await preloadAudioAssets();
    const ctx = contexts[0];
    await playBackgroundMusic(1);
    await playClick();
    await playGameStart();
    const activeSources = [...ctx.sources];

    stopAllAudio();
    stopAllAudio();
    expect(activeSources.every(({ stop }) => stop.mock.calls.length === 1)).toBe(true);
  });

  it('stops active playback and closes the shared context on disposal', async () => {
    const { dispose, playBackgroundMusic, playGameStart, preloadAudioAssets } = await importAudioEngine();

    await preloadAudioAssets();
    const ctx = contexts[0];
    await playGameStart();
    await playBackgroundMusic(1);

    const activeSources = [...ctx.sources];
    await dispose();

    expect(ctx.close).toHaveBeenCalledOnce();
    expect(activeSources.every(({ stop }) => stop.mock.calls.length === 1)).toBe(true);
  });
});
