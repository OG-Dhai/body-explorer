import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import puppeteer from 'puppeteer';

const root = process.cwd();
const port = 4186;
const url = `http://127.0.0.1:${port}/`;
const server = spawn(
  process.execPath,
  [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--host', '127.0.0.1', '--port', String(port)],
  { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
);

async function waitForServer() {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // Vite is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Timed out waiting for Vite.');
}

let browser;
try {
  await waitForServer();
  browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-gpu', '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto(url, { waitUntil: 'domcontentloaded' });
  const result = await page.evaluate(async () => {
    const [{ CONFIG }, { DICTIONARY, i18n }, { default: eventBus }, { HUDOverlay }] = await Promise.all([
      import('/src/core/config.js'),
      import('/src/core/i18n.js'),
      import('/src/core/eventBus.js'),
      import('/src/scene/hudOverlay.js'),
    ]);
    const locales = ['en', 'de', 'fr', 'es', 'ru'];
    const targetIds = Object.keys(CONFIG.targetMap);
    const host = document.createElement('div');
    document.body.appendChild(host);
    const hud = new HUDOverlay(host);
    eventBus.emit('game:stateChange', { state: 'playing' });
    const bubbleResults = [];

    for (const locale of locales) {
      i18n.setLocale(locale);
      eventBus.emit('game:hit', {
        points: 100,
        stats: { score: 100, streak: 1 },
        reactionTime: 4_000,
        voiceKey: 'voice.great',
        factKey: 'fact.nose',
      });
      const bubble = host.querySelector('#hud-feedback');
      const title = host.querySelector('#hud-feedback-title')?.textContent;
      const fact = host.querySelector('.feedback-sub')?.textContent;
      bubbleResults.push({
        locale,
        shown: bubble?.classList.contains('show') || false,
        title,
        expectedTitle: DICTIONARY[locale]['voice.great'],
        fact,
        expectedFact: DICTIONARY[locale]['fact.nose'],
      });
    }

    const audioContext = new AudioContext();
    const audioResults = [];
    for (const locale of locales) {
      for (const targetId of targetIds) {
        const key = `fact.${targetId}`;
        const response = await fetch(`/audio/${locale}/fact/${targetId}.mp3`);
        const bytes = await response.arrayBuffer();
        const decoded = await audioContext.decodeAudioData(bytes.slice(0));
        audioResults.push({
          locale,
          targetId,
          hasText: Boolean(DICTIONARY[locale][key]),
          ok: response.ok,
          contentType: response.headers.get('content-type') || '',
          byteLength: bytes.byteLength,
          channels: decoded.numberOfChannels,
          duration: decoded.duration,
          fitsSafetyWindow: (
            decoded.duration * 1_000 + CONFIG.game.timing.factNarrationLeadInMs
            < CONFIG.game.timing.factSafetyTimeoutMs
          ),
        });
      }
    }
    await audioContext.close();
    hud.dispose();
    host.remove();
    return { bubbleResults, audioResults };
  });

  for (const state of result.bubbleResults) {
    assert.equal(state.shown, true, `${state.locale} feedback bubble was not shown`);
    assert.equal(state.title, state.expectedTitle, `${state.locale} praise title mismatch`);
    assert.equal(state.fact, state.expectedFact, `${state.locale} fact text mismatch`);
  }
  assert.equal(result.audioResults.length, 115);
  for (const asset of result.audioResults) {
    const label = `${asset.locale}/fact/${asset.targetId}.mp3`;
    assert.equal(asset.hasText, true, `${label} has no matching dictionary text`);
    assert.equal(asset.ok, true, `${label} did not return HTTP success`);
    assert.match(asset.contentType, /audio|mpeg/i, `${label} has the wrong content type`);
    assert.ok(asset.byteLength > 1_000, `${label} is unexpectedly small`);
    assert.equal(asset.channels, 1, `${label} is not mono`);
    assert.ok(asset.duration > 0, `${label} has no playable duration`);
    assert.equal(asset.fitsSafetyWindow, true, `${label} plus its lead-in exceeds the safety window`);
  }
  assert.deepEqual(consoleErrors, []);
  assert.deepEqual(pageErrors, []);

  const durationSummary = Object.fromEntries(
    ['en', 'de', 'fr', 'es', 'ru'].map((locale) => {
      const durations = result.audioResults
        .filter((asset) => asset.locale === locale)
        .map((asset) => asset.duration);
      return [locale, {
        count: durations.length,
        minSeconds: Math.min(...durations),
        maxSeconds: Math.max(...durations),
      }];
    }),
  );
  console.log(JSON.stringify({
    feedbackLocales: result.bubbleResults.map(({ locale, shown }) => ({ locale, shown })),
    audioAssets: result.audioResults.length,
    durationSummary,
    consoleErrors,
    pageErrors,
  }, null, 2));
} finally {
  await browser?.close();
  server.kill();
}
