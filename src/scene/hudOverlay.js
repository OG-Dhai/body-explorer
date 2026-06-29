/**
 * Layer 5 — Presentation
 * 2D HUD overlay for score, distance readouts, and prompts.
 * Uses self-hosted .woff2 fonts (no CDN).
 * Stub for Sprint 2.
 */

export class HUDOverlay {
  /** @param {HTMLElement} container */
  constructor(container) {
    this._container = container;
  }

  /** @param {{ score: number, distance: number }} data */
  update(data) {
    // Sprint 2: render score, distance, prompts
  }

  dispose() {
    this._container.innerHTML = '';
  }
}
