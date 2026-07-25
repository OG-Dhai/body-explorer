// Runs the HandLandmarker worker and returns the per-hand landmarks, mirrored
// for the selfie view. LandmarkerService handles the worker lifecycle,
// backpressure and recovery.

import { LandmarkerService, mirrorX } from './landmarkerService.js';

export class HandService extends LandmarkerService {
  constructor() {
    super('HandService');
  }

  _createWorker() {
    return new Worker(new URL('./handWorker.js', import.meta.url), { type: 'module' });
  }

  _shapeResult(msg) {
    mirrorX(msg.landmarks);
    return { landmarks: msg.landmarks ?? [] };
  }
}
