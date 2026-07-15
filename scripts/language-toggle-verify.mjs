import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import puppeteer from 'puppeteer';

const root = process.cwd();
const port = 4183;
const url = `http://127.0.0.1:${port}/`;
const expectedSequence = ['de', 'fr', 'es', 'ru', 'en'];
const server = spawn(
  process.execPath,
  [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), '--host', '127.0.0.1', '--port', String(port)],
  { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
);

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // Vite is still starting.
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Timed out waiting for Vite.');
}

let browser;
try {
  await waitForServer();
  browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-gpu'] });
  const page = await browser.newPage();
  const consoleErrors = [];
  const pageErrors = [];
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', error => pageErrors.push(error.message));

  await page.evaluateOnNewDocument(() => {
    window.__langListenerRegistrations = [];
    const originalAddEventListener = EventTarget.prototype.addEventListener;
    EventTarget.prototype.addEventListener = function auditedAddEventListener(type, listener, options) {
      if (this instanceof Element && this.id === 'lang-toggle') {
        window.__langListenerRegistrations.push({ type, listenerType: typeof listener });
      }
      return originalAddEventListener.call(this, type, listener, options);
    };
  });

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
  await new Promise(resolve => setTimeout(resolve, 1_000));

  await page.evaluate(async () => {
    const { DICTIONARY, i18n } = await import('/src/core/i18n.js');
    const eventBus = (await import('/src/core/eventBus.js')).default;
    window.__languageVerification = { DICTIONARY, i18n, events: [], setLocaleCalls: [] };
    const originalSetLocale = i18n.setLocale.bind(i18n);
    i18n.setLocale = lang => {
      window.__languageVerification.setLocaleCalls.push(lang);
      return originalSetLocale(lang);
    };
    eventBus.on('i18n:change', payload => window.__languageVerification.events.push(payload));
  });

  const client = await page.createCDPSession();
  const remoteObject = await client.send('Runtime.evaluate', {
    expression: 'document.getElementById("lang-toggle")',
  });
  const listenerAudit = await client.send('DOMDebugger.getEventListeners', {
    objectId: remoteObject.result.objectId,
  });
  const clickListeners = listenerAudit.listeners.filter(listener => listener.type === 'click');
  const toggle = await page.$('#lang-toggle');
  if (!toggle) throw new Error('Missing #lang-toggle.');

  const states = [];
  for (const expectedLocale of expectedSequence) {
    await toggle.click();
    await page.waitForFunction(
      locale => window.__languageVerification.i18n.getLocale() === locale,
      { timeout: 5_000 },
      expectedLocale,
    );
    states.push(await page.evaluate(expected => {
      const { DICTIONARY, events, i18n, setLocaleCalls } = window.__languageVerification;
      const mismatches = [...document.querySelectorAll('[data-i18n]')].flatMap(element => {
        const key = element.getAttribute('data-i18n');
        const translated = DICTIONARY[expected][key];
        return element.textContent === translated
          ? []
          : [{ key, actual: element.textContent, expected: translated }];
      });
      const ariaMismatches = [...document.querySelectorAll('[data-i18n-aria-label]')]
        .flatMap(element => {
          const key = element.getAttribute('data-i18n-aria-label');
          const translated = DICTIONARY[expected][key];
          return element.getAttribute('aria-label') === translated
            ? []
            : [{ key, actual: element.getAttribute('aria-label'), expected: translated }];
        });
      return {
        expected,
        locale: i18n.getLocale(),
        label: document.querySelector('#current-lang-btn')?.textContent,
        toggleCount: document.querySelectorAll('#lang-toggle').length,
        labelCount: document.querySelectorAll('#current-lang-btn').length,
        isConnected: document.querySelector('#lang-toggle')?.isConnected,
        eventCount: events.length,
        setLocaleCallCount: setLocaleCalls.length,
        documentTitle: document.title,
        expectedDocumentTitle: DICTIONARY[expected]['ui.document_title'],
        mismatches,
        ariaMismatches,
      };
    }, expectedLocale));
  }

  await page.evaluate(() => window.__languageVerification.i18n.setLocale('fr'));
  await page.waitForFunction(() => document.querySelector('#current-lang-btn')?.textContent.includes('FR'));
  const directSetState = await page.evaluate(() => {
    const { DICTIONARY, i18n } = window.__languageVerification;
    return {
      locale: i18n.getLocale(),
      label: document.querySelector('#current-lang-btn')?.textContent,
      subtitle: document.querySelector('#splash-subtitle')?.textContent,
      expectedSubtitle: DICTIONARY.fr['ui.game_subtitle'],
    };
  });

  const failures = [];
  if (clickListeners.length !== 1) failures.push(`Expected one click listener, found ${clickListeners.length}.`);
  if (states.some((state, index) => (
    state.locale !== state.expected
    || state.label !== state.expected.toUpperCase()
    || state.toggleCount !== 1
    || state.labelCount !== 1
    || !state.isConnected
    || state.eventCount !== index + 1
    || state.setLocaleCallCount !== index + 1
    || state.documentTitle !== state.expectedDocumentTitle
    || state.mismatches.length > 0
    || state.ariaMismatches.length > 0
  ))) failures.push(`Locale-cycle state mismatch: ${JSON.stringify(states)}`);
  if (directSetState.locale !== 'fr'
      || directSetState.label !== 'FR'
      || directSetState.subtitle !== directSetState.expectedSubtitle) {
    failures.push(`Direct setLocale did not render: ${JSON.stringify(directSetState)}`);
  }
  failures.push(...consoleErrors.map(error => `Console error: ${error}`));
  failures.push(...pageErrors.map(error => `Page error: ${error}`));

  console.log(JSON.stringify({
    clickListenerCount: clickListeners.length,
    recordedListenerRegistrations: await page.evaluate(() => window.__langListenerRegistrations),
    states,
    directSetState,
    consoleErrors,
    pageErrors,
    failures,
  }, null, 2));
  if (failures.length) process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill();
}
