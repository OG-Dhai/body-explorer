/**
 * Layer 2 — Perception: Pose Worker
 *
 * Runs MediaPipe PoseLandmarker entirely off-main-thread.
 * Receives ImageBitmap via transferable, returns worldLandmarks.
 * WASM files served from /wasm/mediapipe/ (self-hosted, zero CDN).
 *
 * Message Protocol:
 *   Main → Worker:  { type: 'init' }
 *   Worker → Main:  { type: 'ready' }
 *   Main → Worker:  { type: 'process', bitmap: ImageBitmap, timestamp: number }
 *   Worker → Main:  { type: 'result', worldLandmarks: Array }
 *   Worker → Main:  { type: 'error', message: string }
 */

import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';

/** @type {PoseLandmarker|null} */
let landmarker = null;

/**
 * Initialize the PoseLandmarker with locally served WASM + model.
 * Called once on 'init' message from main thread.
 */
async function initialize() {
  const basePath = '/wasm/mediapipe';
  const vision = await FilesetResolver.forVisionTasks(basePath);

  landmarker = await PoseLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: '/wasm/mediapipe/pose_landmarker_lite.task',
      delegate: 'GPU',
    },
    runningMode: 'VIDEO',
    numPoses: 1,
  });

  self.postMessage({ type: 'ready' });
}

/**
 * Process a single video frame.
 * CRITICAL: bitmap.close() is called after detection to prevent GPU/CPU memory leaks.
 *
 * @param {ImageBitmap} bitmap
 * @param {number} timestamp — milliseconds
 */
function processFrame(bitmap, timestamp) {
  if (!landmarker) {
    bitmap.close();
    self.postMessage({ type: 'error', message: 'Landmarker not initialized.' });
    return;
  }

  try {
    const result = landmarker.detectForVideo(bitmap, timestamp);

    // Extract ONLY worldLandmarks (metric 3D coordinates, not screen-space)
    const worldLandmarks = result.worldLandmarks ?? [];

    self.postMessage({ type: 'result', worldLandmarks });
  } catch (err) {
    self.postMessage({ type: 'error', message: err.message });
  } finally {
    // Always release the bitmap, even on error
    bitmap.close();
  }
}

// ── Message Dispatcher ──
self.onmessage = async (event) => {
  const { type, bitmap, timestamp } = event.data;

  switch (type) {
    case 'init':
      try {
        await initialize();
      } catch (err) {
        self.postMessage({ type: 'error', message: `Init failed: ${err.message}` });
      }
      break;

    case 'process':
      processFrame(bitmap, timestamp);
      break;

    default:
      self.postMessage({ type: 'error', message: `Unknown message type: ${type}` });
  }
};
