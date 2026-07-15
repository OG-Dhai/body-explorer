import assert from 'node:assert/strict';
import puppeteer from 'puppeteer';

const baseUrl = process.env.BODY_EXPLORER_TEST_URL || 'http://127.0.0.1:5173/';
const browser = await puppeteer.launch({
  headless: true,
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
    '--enable-webgl',
    '--enable-unsafe-swiftshader',
    '--use-angle=swiftshader',
    '--use-gl=swiftshader',
  ],
});

const page = await browser.newPage();
const pageErrors = [];
const consoleMessages = [];
const factAudioResponses = new Map();
page.on('pageerror', (error) => pageErrors.push(error.message));
page.on('console', (message) => {
  consoleMessages.push(`[${message.type()}] ${message.text()}`);
});
page.on('response', (response) => {
  const pathname = new URL(response.url()).pathname;
  if (/^\/audio\/[a-z]{2}\/fact\/[^/]+\.mp3$/.test(pathname)) {
    if (!factAudioResponses.has(pathname)) {
      factAudioResponses.set(pathname, response.status());
    }
  }
});

// Headless Chromium in this environment has no usable WebGL service. Replace
// only the MediaPipe Worker boundary so the browser test can exercise the real
// camera, app lifecycle, DOM, audio controls, timers, and event wiring.
await page.evaluateOnNewDocument(() => {
  globalThis.__workerTimestamps = [];
  globalThis.__workerTimestampErrors = [];

  class SessionTestWorker {
    constructor(url) {
      this.url = String(url);
      this.onmessage = null;
      this.onerror = null;
      this.terminated = false;
      this.lastTimestamp = -Infinity;
    }

    postMessage(message) {
      if (this.terminated) return;
      if (message.type === 'init') {
        setTimeout(() => this.onmessage?.({ data: { type: 'ready' } }), 0);
        return;
      }

      if (message.type !== 'process') return;
      message.bitmap?.close?.();

      if (!Number.isFinite(message.timestamp) || message.timestamp <= this.lastTimestamp) {
        const error = `Packet timestamp mismatch: expected > ${this.lastTimestamp}, received ${message.timestamp}`;
        globalThis.__workerTimestampErrors.push(error);
        setTimeout(() => this.onmessage?.({ data: { type: 'error', message: error } }), 0);
        return;
      }
      this.lastTimestamp = message.timestamp;
      globalThis.__workerTimestamps.push({ worker: this.url, timestamp: message.timestamp });

      if (this.url.includes('faceMeshWorker')) {
        const face = Array.from({ length: 478 }, (_, index) => ({
          x: (index % 22) / 22,
          y: Math.floor(index / 22) / 22,
          z: 0,
        }));
        setTimeout(() => this.onmessage?.({
          data: {
            type: 'result',
            faceLandmarks: [face],
            timestamp: message.timestamp,
            targetId: message.targetId,
          },
        }), 0);
        return;
      }

      const pose = Array.from({ length: 33 }, (_, index) => ({
        x: (index % 6) / 6,
        y: Math.floor(index / 6) / 6,
        z: 0,
        visibility: 1,
        presence: 1,
      }));
      setTimeout(() => this.onmessage?.({
        data: {
          type: 'result',
          worldLandmarks: [pose],
          timestamp: message.timestamp,
        },
      }), 0);
    }

    terminate() {
      this.terminated = true;
    }
  }

  Object.defineProperty(globalThis, 'Worker', {
    configurable: true,
    writable: true,
    value: SessionTestWorker,
  });
});

async function waitForGame() {
  await page.evaluate(async () => {
    const eventBus = (await import('/src/core/eventBus.js')).default;
    clearInterval(window.__pipelineReadyPulse);
    window.__pipelineReadyPulse = setInterval(() => eventBus.emit('pipeline:ready'), 100);
  });
  try {
    await page.waitForFunction(() => {
      const game = document.getElementById('game-container');
      return game?.classList.contains('active') && !game.classList.contains('hidden');
    }, { timeout: 45_000 });
  } catch (error) {
    const state = await page.evaluate(() => ({
      status: document.getElementById('status')?.textContent,
      startDisabled: document.getElementById('btn-start')?.disabled,
      startHidden: document.getElementById('btn-start')?.classList.contains('hidden'),
      gameClass: document.getElementById('game-container')?.className,
      videoCount: document.querySelectorAll('video').length,
    }));
    throw new Error(`Game did not start: ${JSON.stringify(state)}\n${consoleMessages.join('\n')}`, { cause: error });
  }
  await page.evaluate(() => clearInterval(window.__pipelineReadyPulse));
}

try {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.setViewport({ width: 320, height: 568, deviceScaleFactor: 1 });

  assert.equal(await page.$eval('#btn-exit', (el) => el.classList.contains('hidden')), true);
  assert.equal(await page.$eval('#btn-mute', (el) => el.getAttribute('aria-pressed')), 'false');

  const localeResults = [];
  for (const expectedLocale of ['en', 'de', 'fr', 'es', 'ru']) {
    const current = await page.$eval('#current-lang-btn', (el) => el.textContent.toLowerCase());
    assert.equal(current, expectedLocale);

    const measurements = await page.evaluate(() => {
      const dialog = document.getElementById('exit-confirm-dialog');
      dialog.showModal();
      const title = document.getElementById('exit-dialog-title');
      const buttons = [...dialog.querySelectorAll('.exit-dialog-btn')];
      const rects = [title, ...buttons].map((el) => {
        const rect = el.getBoundingClientRect();
        return {
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth,
        };
      });
      const result = {
        title: title.textContent.trim(),
        labels: buttons.map((button) => button.textContent.trim()),
        rects,
        viewport: { width: innerWidth, height: innerHeight },
      };
      dialog.close();
      return result;
    });

    for (const rect of measurements.rects) {
      assert.ok(rect.left >= 0 && rect.right <= measurements.viewport.width + 1);
      assert.ok(rect.top >= 0 && rect.bottom <= measurements.viewport.height + 1);
      assert.ok(rect.scrollWidth <= rect.clientWidth + 1);
    }
    localeResults.push({ locale: expectedLocale, ...measurements });
    await page.click('#lang-toggle');
  }

  assert.equal(await page.$eval('#current-lang-btn', (el) => el.textContent), 'EN');

  await page.click('#btn-mute');
  assert.equal(await page.$eval('#btn-mute', (el) => el.getAttribute('aria-pressed')), 'true');
  assert.equal(await page.$eval('#mute-icon-use', (el) => el.getAttribute('href')), '#icon-speaker-off');
  await page.reload({ waitUntil: 'domcontentloaded' });
  assert.equal(await page.$eval('#btn-mute', (el) => el.getAttribute('aria-pressed')), 'true');
  await page.click('#btn-mute');
  assert.equal(await page.$eval('#btn-mute', (el) => el.getAttribute('aria-pressed')), 'false');

  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
  await page.click('#btn-start');
  await waitForGame();
  assert.equal(await page.$eval('#btn-exit', (el) => el.classList.contains('hidden')), false);

  await page.waitForFunction(() => {
    const playing = document.querySelector('.playing-section');
    const timer = document.getElementById('hud-timer');
    return playing && getComputedStyle(playing).display !== 'none' && /^\d+s$/.test(timer?.textContent || '');
  }, { timeout: 30_000 });

  await page.evaluate(async () => {
    const eventBus = (await import('/src/core/eventBus.js')).default;
    window.__factFlow = {
      hit: null,
      complete: null,
      nextQuestion: null,
      voiceKeys: [],
    };
    const onHit = ({ question, factKey, voiceKey }) => {
      clearInterval(window.__factFlowPulse);
      window.__factFlow.hit = {
        questionId: question?.id,
        factKey,
        voiceKey,
        at: performance.now(),
      };
    };
    const onComplete = ({ question }) => {
      window.__factFlow.complete = {
        questionId: question?.id,
        at: performance.now(),
      };
    };
    const onQuestion = ({ question }) => {
      window.__factFlow.nextQuestion = {
        questionId: question?.id,
        at: performance.now(),
      };
    };
    const onVoice = ({ key }) => window.__factFlow.voiceKeys.push(key);
    eventBus.on('game:hit', onHit);
    eventBus.on('audio:factComplete', onComplete);
    eventBus.on('game:newQuestion', onQuestion);
    eventBus.on('game:voiceFeedback', onVoice);
    window.__factFlowCleanup = () => {
      clearInterval(window.__factFlowPulse);
      eventBus.off('game:hit', onHit);
      eventBus.off('audio:factComplete', onComplete);
      eventBus.off('game:newQuestion', onQuestion);
      eventBus.off('game:voiceFeedback', onVoice);
    };
    window.__factFlowPulse = setInterval(() => {
      eventBus.emit('audio:ttsComplete');
      eventBus.emit('detection:success', {});
    }, 100);
  });
  await page.waitForFunction(() => window.__factFlow?.hit !== null, { timeout: 12_000 });
  const visibleFact = await page.evaluate(async () => {
    const { DICTIONARY } = await import('/src/core/i18n.js');
    const flow = window.__factFlow;
    return {
      shown: document.getElementById('hud-feedback')?.classList.contains('show'),
      text: document.querySelector('#hud-feedback .feedback-sub')?.textContent,
      expectedText: DICTIONARY.en[flow.hit.factKey],
      ariaLabel: document.getElementById('hud-feedback')?.getAttribute('aria-label'),
    };
  });
  assert.equal(visibleFact.shown, true);
  assert.equal(visibleFact.text, visibleFact.expectedText);
  assert.ok(visibleFact.ariaLabel?.includes(visibleFact.expectedText));

  await page.waitForFunction(
    () => window.__factFlow?.complete !== null && window.__factFlow?.nextQuestion !== null,
    { timeout: 8_000 }
  );
  const factFlow = await page.evaluate(async () => {
    const { CONFIG } = await import('/src/core/config.js');
    window.__factFlowCleanup?.();
    return {
      ...window.__factFlow,
      leadInMs: CONFIG.game.timing.factNarrationLeadInMs,
      safetyMs: CONFIG.game.timing.factSafetyTimeoutMs,
    };
  });
  assert.equal(factFlow.complete.questionId, factFlow.hit.questionId);
  assert.notEqual(factFlow.nextQuestion.questionId, factFlow.hit.questionId);
  const narrationElapsedMs = factFlow.complete.at - factFlow.hit.at;
  assert.ok(narrationElapsedMs >= factFlow.leadInMs);
  assert.ok(narrationElapsedMs < factFlow.safetyMs);
  assert.equal(factFlow.voiceKeys.includes(factFlow.hit.voiceKey), false);
  const factPath = `/audio/en/fact/${factFlow.hit.questionId}.mp3`;
  assert.equal(factAudioResponses.get(factPath), 200);
  assert.equal(
    consoleMessages.some((message) => message.includes('Fact narration timed out')),
    false
  );

  await page.click('#btn-mute');
  assert.equal(await page.$eval('#btn-mute', (el) => el.getAttribute('aria-pressed')), 'true');
  await page.evaluate(async () => {
    const eventBus = (await import('/src/core/eventBus.js')).default;
    window.__factFallback = {
      hit: null,
      completeCount: 0,
      nextQuestion: null,
    };
    const onHit = ({ question, factKey }) => {
      clearInterval(window.__factFallbackPulse);
      window.__factFallback.hit = {
        questionId: question?.id,
        factKey,
        at: performance.now(),
      };
    };
    const onComplete = () => {
      window.__factFallback.completeCount += 1;
    };
    const onQuestion = ({ question }) => {
      window.__factFallback.nextQuestion = {
        questionId: question?.id,
        at: performance.now(),
      };
    };
    eventBus.on('game:hit', onHit);
    eventBus.on('audio:factComplete', onComplete);
    eventBus.on('game:newQuestion', onQuestion);
    window.__factFallbackCleanup = () => {
      clearInterval(window.__factFallbackPulse);
      eventBus.off('game:hit', onHit);
      eventBus.off('audio:factComplete', onComplete);
      eventBus.off('game:newQuestion', onQuestion);
    };
    window.__factFallbackPulse = setInterval(() => {
      eventBus.emit('audio:ttsComplete');
      eventBus.emit('detection:success', {});
    }, 100);
  });
  await page.waitForFunction(() => window.__factFallback?.hit !== null, { timeout: 12_000 });
  const mutedFact = await page.evaluate(async () => {
    const { DICTIONARY } = await import('/src/core/i18n.js');
    return {
      shown: document.getElementById('hud-feedback')?.classList.contains('show'),
      text: document.querySelector('#hud-feedback .feedback-sub')?.textContent,
      expectedText: DICTIONARY.en[window.__factFallback.hit.factKey],
    };
  });
  assert.equal(mutedFact.shown, true);
  assert.equal(mutedFact.text, mutedFact.expectedText);
  await page.waitForFunction(
    () => window.__factFallback?.nextQuestion !== null,
    { timeout: 8_000 }
  );
  const factFallback = await page.evaluate(async () => {
    const { CONFIG } = await import('/src/core/config.js');
    window.__factFallbackCleanup?.();
    return {
      ...window.__factFallback,
      safetyMs: CONFIG.game.timing.factSafetyTimeoutMs,
    };
  });
  const fallbackElapsedMs = factFallback.nextQuestion.at - factFallback.hit.at;
  assert.equal(factFallback.completeCount, 0);
  assert.ok(fallbackElapsedMs >= factFallback.safetyMs - 100);
  assert.ok(fallbackElapsedMs < factFallback.safetyMs + 500);
  assert.equal(
    consoleMessages.some((message) => message.includes('Fact narration timed out')),
    true
  );
  await page.click('#btn-mute');
  assert.equal(await page.$eval('#btn-mute', (el) => el.getAttribute('aria-pressed')), 'false');

  const gameplayLocaleResults = [];
  for (const expectedLocale of ['de', 'fr', 'es', 'ru', 'en']) {
    await page.click('#lang-toggle');
    await page.waitForFunction(
      locale => document.documentElement.lang === locale,
      { timeout: 5_000 },
      expectedLocale
    );
    await page.waitForFunction(
      () => Boolean(document.getElementById('hud-timer')?.getAttribute('aria-label')),
      { timeout: 5_000 }
    );
    const localeState = await page.evaluate(async locale => {
      const { DICTIONARY } = await import('/src/core/i18n.js');
      const dict = DICTIONARY[locale];
      const timerLabel = document.getElementById('hud-timer')?.getAttribute('aria-label') || '';
      return {
        locale,
        documentTitle: document.title,
        scoreLabel: document.getElementById('label-hud-score')?.textContent,
        timeLabel: document.getElementById('label-hud-time')?.textContent,
        hudLabel: document.querySelector('.playing-section')?.getAttribute('aria-label'),
        timerLabel,
        expected: {
          documentTitle: dict['ui.document_title'],
          scoreLabel: dict['ui.label_score'],
          timeLabel: dict['ui.label_time'],
          hudLabel: dict['ui.aria_hud'],
          timerPrefix: dict['ui.time_remaining'].split('{0}')[0],
        },
      };
    }, expectedLocale);
    assert.equal(localeState.documentTitle, localeState.expected.documentTitle);
    assert.equal(localeState.scoreLabel, localeState.expected.scoreLabel);
    assert.equal(localeState.timeLabel, localeState.expected.timeLabel);
    assert.equal(localeState.hudLabel, localeState.expected.hudLabel);
    assert.ok(
      localeState.timerLabel.startsWith(localeState.expected.timerPrefix),
      `Timer localization mismatch: ${JSON.stringify(localeState)}`
    );
    gameplayLocaleResults.push(localeState);
  }

  const listenerCountsFirstSession = await page.evaluate(async () => {
    const eventBus = (await import('/src/core/eventBus.js')).default;
    return {
      levelStart: eventBus._listeners.get('level:start')?.size || 0,
      newQuestion: eventBus._listeners.get('game:newQuestion')?.size || 0,
    };
  });

  await page.evaluate(async () => {
    const eventBus = (await import('/src/core/eventBus.js')).default;
    window.__resumeSynchronized = null;
    eventBus.on('session:resumeSynchronized', (detail) => {
      window.__resumeSynchronized = detail;
    });
    window.__cameraTrackBeforeExit = document.querySelector('#video-container video')
      ?.srcObject?.getVideoTracks?.()[0] || null;
  });

  await page.click('#btn-exit');
  await page.waitForFunction(() => document.getElementById('exit-confirm-dialog')?.open);
  assert.equal(await page.evaluate(() => document.activeElement?.id), 'btn-exit-cancel');
  const timerWhilePaused = await page.$eval('#hud-timer', (el) => el.textContent);
  await new Promise((resolve) => setTimeout(resolve, 1_300));
  assert.equal(await page.$eval('#hud-timer', (el) => el.textContent), timerWhilePaused);
  assert.equal(await page.evaluate(() => window.__cameraTrackBeforeExit?.readyState), 'live');

  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.getElementById('exit-confirm-dialog')?.open);
  await page.waitForFunction(() => window.__resumeSynchronized !== null);
  const synchronizedResume = await page.evaluate(() => window.__resumeSynchronized);
  assert.equal(synchronizedResume.sameTask, true);
  assert.equal(synchronizedResume.audioRequested, true);
  assert.equal(synchronizedResume.cameraResumed, true);
  assert.equal(await page.evaluate(() => window.__cameraTrackBeforeExit?.readyState), 'live');

  await page.click('#btn-exit');
  await page.waitForFunction(() => document.getElementById('exit-confirm-dialog')?.open);
  await page.click('#btn-exit-cancel');
  await page.waitForFunction(() => !document.getElementById('exit-confirm-dialog')?.open);

  await page.click('#btn-exit');
  await page.waitForFunction(() => document.getElementById('exit-confirm-dialog')?.open);
  await page.click('#btn-exit-confirm');
  await page.waitForFunction(() => document.getElementById('splash-screen')?.classList.contains('active'));

  assert.equal(await page.$eval('#game-container', (el) => el.classList.contains('hidden')), true);
  assert.equal(await page.$eval('#btn-exit', (el) => el.classList.contains('hidden')), true);
  assert.equal(await page.$eval('.level-btn--easy', (el) => el.getAttribute('aria-checked')), 'true');
  assert.equal(await page.$eval('#btn-start', (el) => el.disabled), false);
  assert.equal(await page.evaluate(() => window.__cameraTrackBeforeExit?.readyState), 'ended');
  assert.equal(await page.$eval('#current-lang-btn', (el) => el.textContent), 'EN');

  const listenerCountsHome = await page.evaluate(async () => {
    const eventBus = (await import('/src/core/eventBus.js')).default;
    return {
      levelStart: eventBus._listeners.get('level:start')?.size || 0,
      newQuestion: eventBus._listeners.get('game:newQuestion')?.size || 0,
    };
  });
  assert.equal(listenerCountsHome.levelStart, 1);
  assert.equal(listenerCountsHome.newQuestion, 1);

  const timestampCountBeforeSecondSession = await page.evaluate(
    () => globalThis.__workerTimestamps.length
  );
  await page.click('#btn-start');
  await waitForGame();
  await page.waitForFunction(
    count => globalThis.__workerTimestamps.length > count,
    { timeout: 10_000 },
    timestampCountBeforeSecondSession
  );
  const listenerCountsSecondSession = await page.evaluate(async () => {
    const eventBus = (await import('/src/core/eventBus.js')).default;
    return {
      levelStart: eventBus._listeners.get('level:start')?.size || 0,
      newQuestion: eventBus._listeners.get('game:newQuestion')?.size || 0,
    };
  });
  assert.deepEqual(listenerCountsSecondSession, listenerCountsFirstSession);

  await page.evaluate(async () => {
    const eventBus = (await import('/src/core/eventBus.js')).default;
    eventBus.emit('ui:restartClick');
  });
  await page.waitForFunction(() => document.getElementById('splash-screen')?.classList.contains('active'));

  const timestampErrors = await page.evaluate(() => globalThis.__workerTimestampErrors);
  const fatalConsoleMessages = consoleMessages.filter(message => (
    /Packet timestamp mismatch|INVALID_ARGUMENT|WaitUntilIdle failed|\[PoseService\] Worker error/i
      .test(message)
  ));
  assert.deepEqual(timestampErrors, []);
  assert.deepEqual(fatalConsoleMessages, []);
  assert.deepEqual(pageErrors, []);
  console.log(JSON.stringify({
    locales: localeResults.map(({ locale, title, labels }) => ({ locale, title, labels })),
    gameplayLocales: gameplayLocaleResults,
    factFlow: {
      questionId: factFlow.hit.questionId,
      factKey: factFlow.hit.factKey,
      narrationElapsedMs,
      nextQuestionId: factFlow.nextQuestion.questionId,
      audioStatus: factAudioResponses.get(factPath),
    },
    factFallback: {
      questionId: factFallback.hit.questionId,
      factKey: factFallback.hit.factKey,
      fallbackElapsedMs,
      nextQuestionId: factFallback.nextQuestion.questionId,
      completionEvents: factFallback.completeCount,
    },
    synchronizedResume,
    listenerCountsFirstSession,
    listenerCountsHome,
    listenerCountsSecondSession,
    timestampErrors,
    fatalConsoleMessages,
    pageErrors,
  }, null, 2));
} finally {
  await browser.close();
}
