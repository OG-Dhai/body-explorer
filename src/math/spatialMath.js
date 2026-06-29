/**
 * Layer 3 — Interpretation
 * 3D Euclidean distance + EMA filter for Z-axis stabilization.
 * Stub for Sprint 2.
 */

export class EMAFilter {
  /** @param {number} alpha — smoothing factor (0–1) */
  constructor(alpha = 0.3) {
    this._alpha = alpha;
    this._value = null;
  }

  /** @param {number} raw */
  update(raw) {
    this._value = this._value === null
      ? raw
      : this._alpha * raw + (1 - this._alpha) * this._value;
    return this._value;
  }

  reset() {
    this._value = null;
  }
}

/**
 * Euclidean distance between two 3D world landmarks.
 * @param {{ x: number, y: number, z: number }} a
 * @param {{ x: number, y: number, z: number }} b
 * @returns {number} distance in meters
 */
export function computeDistance(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
