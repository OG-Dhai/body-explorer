/**
 * Layer 4 — Application
 * Game logic engine. Receives processed landmarks and drives game state.
 * Stub for Sprint 2.
 */

export class GameEngine {
  constructor() {
    this._state = 'idle';
  }

  /** @param {Array} worldLandmarks */
  update(worldLandmarks) {
    // Sprint 2: proximity checks, scoring, level progression
  }

  getState() {
    return this._state;
  }
}
