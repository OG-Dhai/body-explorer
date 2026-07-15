import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PALETTE } from './palette.js';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const APPROVED_COLORS = Object.freeze([
  '#EEF7FA',
  '#17324D',
  '#2C7A4B',
  '#B8DFC4',
  '#F2C486',
  '#E9A3A0',
]);

const TEXT_EXTENSIONS = new Set(['.css', '.html', '.js', '.json', '.svg']);
const HEX_COLOR_PATTERN = /(?<![\w-])#[\da-f]{3}(?:[\da-f]{3})?(?:[\da-f]{2})?(?![\da-f])/gi;
const FUNCTION_COLOR_PATTERN = /\b(?:rgba?|hsla?)\s*\(/gi;
const THREE_HEX_PATTERN = /\b0x[\da-f]{6}\b/gi;
const PLATFORM_EMOJI_PATTERN = /\p{Extended_Pictographic}/gu;

function channelToLinear(channel) {
  const normalized = channel / 255;
  return normalized <= 0.04045
    ? normalized / 12.92
    : ((normalized + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance(hexColor) {
  const channels = hexColor
    .slice(1)
    .match(/.{2}/g)
    .map(value => channelToLinear(Number.parseInt(value, 16)));

  return (0.2126 * channels[0]) + (0.7152 * channels[1]) + (0.0722 * channels[2]);
}

function contrastRatio(foreground, background) {
  const foregroundLuminance = relativeLuminance(foreground);
  const backgroundLuminance = relativeLuminance(background);
  const lighter = Math.max(foregroundLuminance, backgroundLuminance);
  const darker = Math.min(foregroundLuminance, backgroundLuminance);
  return (lighter + 0.05) / (darker + 0.05);
}

function collectTextFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'wasm') {
        return [];
      }
      return collectTextFiles(entryPath);
    }
    return TEXT_EXTENSIONS.has(path.extname(entry.name)) ? [entryPath] : [];
  });
}

describe('six-color design system', () => {
  it('exposes exactly the approved six colors', () => {
    expect(Object.values(PALETTE)).toEqual(APPROVED_COLORS);
  });

  it.each([
    ['Explorer Navy on Airy Sky', PALETTE.explorerNavy, PALETTE.airySky],
    ['Explorer Navy on Gentle Leaf', PALETTE.explorerNavy, PALETTE.gentleLeaf],
    ['Explorer Navy on Sunny Apricot', PALETTE.explorerNavy, PALETTE.sunnyApricot],
    ['Explorer Navy on Friendly Coral', PALETTE.explorerNavy, PALETTE.friendlyCoral],
    ['Airy Sky on Adventure Green', PALETTE.airySky, PALETTE.adventureGreen],
  ])('%s meets WCAG AA for normal text', (_label, foreground, background) => {
    expect(contrastRatio(foreground, background)).toBeGreaterThanOrEqual(4.5);
  });

  it('contains no off-palette literal colors in first-party text sources', () => {
    const files = [
      path.join(PROJECT_ROOT, 'index.html'),
      ...collectTextFiles(path.join(PROJECT_ROOT, 'src')),
      ...collectTextFiles(path.join(PROJECT_ROOT, 'public')),
    ];
    const violations = [];

    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8');
      const relativePath = path.relative(PROJECT_ROOT, file);
      const offPaletteHex = [...source.matchAll(HEX_COLOR_PATTERN)]
        .map(match => match[0].toUpperCase())
        .filter(color => !APPROVED_COLORS.includes(color));
      const functionalColors = [...source.matchAll(FUNCTION_COLOR_PATTERN)].map(match => match[0]);
      const threeHexColors = [...source.matchAll(THREE_HEX_PATTERN)].map(match => match[0]);

      if (offPaletteHex.length || functionalColors.length || threeHexColors.length) {
        violations.push({ relativePath, offPaletteHex, functionalColors, threeHexColors });
      }
    }

    expect(violations).toEqual([]);
  });

  it('uses palette-controlled SVGs instead of platform-colored emoji', () => {
    const files = [
      path.join(PROJECT_ROOT, 'index.html'),
      ...collectTextFiles(path.join(PROJECT_ROOT, 'src')),
    ];
    const violations = files.flatMap(file => {
      const matches = fs.readFileSync(file, 'utf8').match(PLATFORM_EMOJI_PATTERN) ?? [];
      return matches.length
        ? [{ relativePath: path.relative(PROJECT_ROOT, file), matches }]
        : [];
    });

    expect(violations).toEqual([]);
  });

  it('keeps the splash Airy-only, without ribbons, title underlays, or a DNA logo', () => {
    const html = fs.readFileSync(path.join(PROJECT_ROOT, 'index.html'), 'utf8');
    const css = fs.readFileSync(path.join(PROJECT_ROOT, 'src', 'style.css'), 'utf8');
    const splashRule = css.match(/#splash-screen\s*{([^}]+)}/s)?.[1] ?? '';
    const titleWordRule = css.match(/\.title-word\s*{([^}]+)}/s)?.[1] ?? '';
    const title3dRule = css.match(/\.title-3d\s*{([^}]+)}/s)?.[1] ?? '';

    expect(splashRule).toContain('background: var(--color-airy-sky);');
    expect(splashRule).not.toMatch(/gradient|color-mix/);
    expect(html).not.toContain('splash-bg-decoration');
    expect(css).not.toContain('.splash-bg-decoration');
    expect(html).not.toContain('logo-icon');
    expect(css).not.toContain('.logo-icon');
    expect(titleWordRule).not.toMatch(/background(?:-image|-color)?\s*:/);
    expect(title3dRule).not.toMatch(/background(?:-image|-color)?\s*:/);
    expect(css).not.toContain('.title-explorer');
    expect(css).not.toContain('.title-body');
  });
});
