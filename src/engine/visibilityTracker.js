import { CONFIG } from '../core/config.js';

export class VisibilityTracker {
  constructor() {
    this._history = [];
  }

  get history() {
    return this._history;
  }

  /**
   * Called once per frame with the latest landmarks array.
   * @param {Array} landmarks - Array of 33 landmark objects containing .visibility
   */
  update(landmarks) {
    if (!landmarks || landmarks.length < 33) return;
    
    // Extract only the visibility scores to minimize memory footprint
    const visibilities = new Float32Array(33);
    for (let i = 0; i < 33; i++) {
      visibilities[i] = landmarks[i].visibility !== undefined ? landmarks[i].visibility : 1.0;
    }
    
    this._history.push(visibilities);
    
    if (this._history.length > CONFIG.detection.visibilityHistoryFrames) {
      this._history.shift();
    }
  }

  /**
   * Returns the average visibility score (0-1) for a specific set of indices
   * over the last N frames.
   * @param {number[]} indices - Array of landmark indices (e.g., [27, 28] for ankles)
   * @param {number} windowSize - Number of recent frames to average
   * @returns {number} Average visibility score
   */
  getAverageVisibility(indices, windowSize = CONFIG.detection.visibilityAverageWindowFrames) {
    if (this._history.length === 0) return 1.0;
    
    const size = Math.min(windowSize, this._history.length);
    const windowStart = this._history.length - size;
    
    let totalScore = 0;
    let count = 0;
    
    for (let i = windowStart; i < this._history.length; i++) {
      const frameVis = this._history[i];
      for (const idx of indices) {
        totalScore += frameVis[idx];
        count++;
      }
    }
    
    return count > 0 ? totalScore / count : 1.0;
  }
}
