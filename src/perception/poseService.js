// Runs the PoseLandmarker worker. Returns the normalized image landmarks (for
// the recognition math) and the world landmarks (for the on-screen skeleton).
// LandmarkerService handles the worker lifecycle, backpressure and recovery.

import { LandmarkerService, mirrorX } from './landmarkerService.js';

export class PoseService extends LandmarkerService {
  constructor() {
    super('PoseService');
  }

  _createWorker() {
    // Vite resolves this URL at build time and bundles the worker as ESM.
    return new Worker(new URL('./poseWorker.js', import.meta.url), { type: 'module' });
  }

  _shapeResult(msg) {
    // Mirror X for the selfie view on both landmark sets before use.
    mirrorX(msg.landmarks);
    mirrorX(msg.worldLandmarks);
    return {
      landmarks: msg.landmarks ?? [],
      worldLandmarks: msg.worldLandmarks ?? [],
    };
  }
}
