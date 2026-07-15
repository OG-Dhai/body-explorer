/**
 * Body Explorer 3D: canonical six-color system.
 *
 * Keep first-party UI and WebGL colors sourced from this object so browser,
 * canvas, PWA, and CSS visuals stay aligned.
 */
export const PALETTE = Object.freeze({
  airySky: '#EEF7FA',
  explorerNavy: '#17324D',
  adventureGreen: '#2C7A4B',
  gentleLeaf: '#B8DFC4',
  sunnyApricot: '#F2C486',
  friendlyCoral: '#E9A3A0',
});

export function toThreeColor(hexColor) {
  return Number.parseInt(hexColor.slice(1), 16);
}
