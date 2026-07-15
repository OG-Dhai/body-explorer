import { spawn } from 'node:child_process';
import path from 'node:path';
import process from 'node:process';
import puppeteer from 'puppeteer';

const root = process.cwd();
const port = 4177;
const url = `http://127.0.0.1:${port}/`;
const screenshotPath = path.join(root, 'artifacts', 'palette-background-fixed.png');
const approvedTokens = {
  '--color-airy-sky': '#EEF7FA',
  '--color-explorer-navy': '#17324D',
  '--color-adventure-green': '#2C7A4B',
  '--color-gentle-leaf': '#B8DFC4',
  '--color-sunny-apricot': '#F2C486',
  '--color-friendly-coral': '#E9A3A0',
};

function canonicalColor(value) {
  if (/^#[\da-f]{6}$/i.test(value)) return value.toUpperCase();
  const channels = value.match(/[\d.]+/g)?.slice(0, 3).map(Number);
  if (!channels || channels.length !== 3) return value;
  return `#${channels.map(channel => Math.round(channel).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

const server = spawn(
  process.execPath,
  [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js'), 'preview', '--host', '127.0.0.1', '--port', String(port)],
  { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true },
);

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Vite is still starting.
    }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Timed out waiting for the Vite preview server.');
}

let browser;
try {
  await waitForServer();
  browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-gpu'] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900, deviceScaleFactor: 1 });

  const pageErrors = [];
  const requestFailures = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('requestfailed', request => requestFailures.push(`${request.url()} — ${request.failure()?.errorText ?? 'unknown failure'}`));

  await page.goto(url, { waitUntil: 'networkidle0', timeout: 30_000 });
  await new Promise(resolve => setTimeout(resolve, 2_000));
  await page.addStyleTag({
    content: `
      *, *::before, *::after { animation: none !important; transition: none !important; }
      .game-subtitle, .level-selector, .loading-area, .btn-start { opacity: 1 !important; }
    `,
  });
  await new Promise(resolve => setTimeout(resolve, 250));
  await page.screenshot({ path: screenshotPath, fullPage: false });

  const audit = await page.evaluate(expectedTokens => {
    const parseColor = value => {
      if (/^#[\da-f]{6}$/i.test(value)) {
        return value.slice(1).match(/.{2}/g).map(channel => Number.parseInt(channel, 16));
      }
      const match = value.match(/[\d.]+/g);
      if (!match || match.length < 3) throw new Error(`Unsupported computed color: ${value}`);
      return match.slice(0, 3).map(Number);
    };
    const channelToLinear = channel => {
      const normalized = channel / 255;
      return normalized <= 0.04045
        ? normalized / 12.92
        : ((normalized + 0.055) / 1.055) ** 2.4;
    };
    const luminance = color => {
      const [red, green, blue] = parseColor(color).map(channelToLinear);
      return (0.2126 * red) + (0.7152 * green) + (0.0722 * blue);
    };
    const contrast = (foreground, background) => {
      const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
      return (values[0] + 0.05) / (values[1] + 0.05);
    };
    const pair = (label, selector, backgroundSelector = selector) => {
      const foregroundElement = document.querySelector(selector);
      const backgroundElement = document.querySelector(backgroundSelector);
      if (!foregroundElement || !backgroundElement) throw new Error(`Missing audit element: ${selector}`);
      const foreground = getComputedStyle(foregroundElement).color;
      const background = getComputedStyle(backgroundElement).backgroundColor;
      return { label, foreground, background, ratio: contrast(foreground, background) };
    };

    const rootStyle = getComputedStyle(document.documentElement);
    const tokens = Object.fromEntries(
      Object.entries(expectedTokens).map(([property, expected]) => [
        property,
        { expected, actual: rootStyle.getPropertyValue(property).trim().toUpperCase() },
      ]),
    );

    const airySky = rootStyle.getPropertyValue('--color-airy-sky').trim();
    const splashTextSelectors = ['#splash-title', '#splash-subtitle', '#level-selector-title', '#status'];
    const splashText = splashTextSelectors.map(selector => {
      const foreground = getComputedStyle(document.querySelector(selector)).color;
      return { label: selector, foreground, background: airySky, ratio: contrast(foreground, airySky) };
    });

    const pairs = [
      ...splashText,
      pair('Easy label', '.level-btn--easy .level-name', '.level-btn--easy'),
      pair('Medium label', '.level-btn--medium .level-name', '.level-btn--medium'),
      pair('Hard label', '.level-btn--hard .level-name', '.level-btn--hard'),
      pair('Start CTA', '#btn-start .btn-text', '#btn-start'),
    ];

    const navy = rootStyle.getPropertyValue('--color-explorer-navy').trim();
    const borderChecks = ['.level-btn--easy', '.level-btn--medium', '.level-btn--hard', '#btn-start']
      .map(selector => ({ selector, borderColor: getComputedStyle(document.querySelector(selector)).borderTopColor }));

    const mediumButton = document.querySelector('.level-btn--medium');
    mediumButton.focus();
    const focusOutline = getComputedStyle(mediumButton).outlineColor;
    mediumButton.blur();

    const iconReferences = [...document.querySelectorAll('.ui-icon use')]
      .map(use => use.getAttribute('href'));
    const missingIconSymbols = iconReferences.filter(reference => !document.querySelector(reference));
    const splashStyle = getComputedStyle(document.querySelector('#splash-screen'));
    const titleBackgrounds = [...document.querySelectorAll('#splash-title .title-word')]
      .map(element => {
        const style = getComputedStyle(element);
        return {
          text: element.textContent,
          backgroundColor: style.backgroundColor,
          backgroundImage: style.backgroundImage,
        };
      });

    return {
      tokens,
      pairs,
      borderChecks,
      expectedNavy: navy,
      focusOutline,
      defaultSelection: {
        easyActive: document.querySelector('.level-btn--easy').classList.contains('active'),
        easyChecked: document.querySelector('.level-btn--easy').getAttribute('aria-checked'),
        mediumChecked: document.querySelector('.level-btn--medium').getAttribute('aria-checked'),
        hardChecked: document.querySelector('.level-btn--hard').getAttribute('aria-checked'),
      },
      splashPresentation: {
        backgroundColor: splashStyle.backgroundColor,
        backgroundImage: splashStyle.backgroundImage,
        decorationPresent: Boolean(document.querySelector('.splash-bg-decoration')),
        dnaLogoPresent: Boolean(document.querySelector('.logo-icon')),
        titleBackgrounds,
      },
      iconSystem: {
        symbols: document.querySelectorAll('.icon-sprite symbol').length,
        references: iconReferences.length,
        hudIcons: document.querySelectorAll('#hud-overlay .ui-icon').length,
        missingIconSymbols,
        platformEmojiInRenderedText: document.body.innerText.match(/\p{Extended_Pictographic}/gu) ?? [],
      },
    };
  }, approvedTokens);

  const failures = [];
  for (const [property, { expected, actual }] of Object.entries(audit.tokens)) {
    if (actual !== expected) failures.push(`${property}: expected ${expected}, received ${actual}`);
  }
  for (const pair of audit.pairs) {
    if (pair.ratio < 4.5) failures.push(`${pair.label}: contrast ${pair.ratio.toFixed(3)}:1`);
  }
  for (const border of audit.borderChecks) {
    if (canonicalColor(border.borderColor) !== canonicalColor(audit.expectedNavy)) failures.push(`${border.selector}: border is ${border.borderColor}`);
  }
  if (canonicalColor(audit.focusOutline) !== canonicalColor(audit.expectedNavy)) failures.push(`Focus outline is ${audit.focusOutline}`);
  if (canonicalColor(audit.splashPresentation.backgroundColor) !== approvedTokens['--color-airy-sky']) {
    failures.push(`Splash background is ${audit.splashPresentation.backgroundColor}`);
  }
  if (audit.splashPresentation.backgroundImage !== 'none') failures.push(`Splash still has ${audit.splashPresentation.backgroundImage}`);
  if (audit.splashPresentation.decorationPresent) failures.push('Splash ribbon decoration is still present.');
  if (audit.splashPresentation.dnaLogoPresent) failures.push('Splash DNA logo is still present.');
  for (const title of audit.splashPresentation.titleBackgrounds) {
    if (title.backgroundImage !== 'none' || title.backgroundColor !== 'rgba(0, 0, 0, 0)') {
      failures.push(`${title.text} still has a background: ${title.backgroundColor} / ${title.backgroundImage}`);
    }
  }
  if (audit.iconSystem.symbols < 10 || audit.iconSystem.references < 5) failures.push(`Incomplete SVG icon system: ${JSON.stringify(audit.iconSystem)}`);
  if (audit.iconSystem.missingIconSymbols.length) failures.push(`Missing SVG symbols: ${audit.iconSystem.missingIconSymbols.join(', ')}`);
  if (audit.iconSystem.platformEmojiInRenderedText.length) failures.push(`Platform emoji remain: ${audit.iconSystem.platformEmojiInRenderedText.join(' ')}`);
  if (!audit.defaultSelection.easyActive || audit.defaultSelection.easyChecked !== 'true'
      || audit.defaultSelection.mediumChecked !== 'false' || audit.defaultSelection.hardChecked !== 'false') {
    failures.push(`Default difficulty state is incorrect: ${JSON.stringify(audit.defaultSelection)}`);
  }
  failures.push(...pageErrors.map(error => `Page error: ${error}`));
  failures.push(...requestFailures.map(error => `Request failed: ${error}`));

  console.log(JSON.stringify({ screenshotPath, audit, failures }, null, 2));
  if (failures.length) process.exitCode = 1;
} finally {
  await browser?.close();
  server.kill();
}
