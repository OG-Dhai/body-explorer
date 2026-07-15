/**
 * Layer 3: Interpretation
 * 3D Euclidean distance, EMA smoothing, and scalar helpers.
 */

export class EMAFilter {
  /** @param {number} alpha: smoothing factor (0-1) */
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

/**
 * Compute a dynamic hit threshold from real-time shoulder width.
 * Uses 80% of shoulder-to-shoulder 3D distance as the proximity zone,
 * clamped to a safe [0.15, 0.50] range.
 *
 * @param {Array} landmarks: full 33-landmark array
 * @returns {number} dynamic threshold in meters
 */
export function computeDynamicThreshold(landmarks) {
  const LEFT_SHOULDER = 11;
  const RIGHT_SHOULDER = 12;

  const ls = landmarks[LEFT_SHOULDER];
  const rs = landmarks[RIGHT_SHOULDER];

  if (!ls || !rs) return 0.30; // Fallback if shoulders are occluded

  const shoulderWidth = computeDistance(ls, rs);
  const raw = shoulderWidth * 0.8;
  return clamp(raw, 0.15, 0.50);
}

export function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function smoothValue(current, target, factor) {
  return current * (1 - factor) + target * factor;
}
