// The six brand colours. Pull UI, WebGL, PWA and CSS colours from here so
// everything stays in sync. Cool blue base for a calm feel, warm amber and
// coral kept for rewards and buttons. Navy on each accent passes WCAG contrast.
export const PALETTE = Object.freeze({
  airySky: '#E1F1FF',        // light-blue base
  explorerNavy: '#17324D',   // text and outlines
  adventureGreen: '#2C7A4B', // success accent
  gentleLeaf: '#86DDA9',     // mint accent
  sunnyApricot: '#FFB23E',   // amber, for rewards and buttons
  friendlyCoral: '#FA6E5A',  // coral, for rewards and alerts
});

export function toThreeColor(hexColor) {
  return Number.parseInt(hexColor.slice(1), 16);
}
