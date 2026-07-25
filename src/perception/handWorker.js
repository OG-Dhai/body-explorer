// Runs MediaPipe HandLandmarker off the main thread. Returns 21 normalized
// landmarks per hand (up to two), which give a precise fingertip: the point a
// child actually touches with. WASM is served from /wasm/mediapipe/.
//
// Messages in: { type:'init' } and { type:'process', bitmap, timestamp }.
// Messages out: { type:'ready' }, { type:'result', landmarks } or
// { type:'error', message }.

import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';

// Loaded via new URL(...) so Vite bundles it as a hashed asset for production.
const HAND_MODEL_URL = new URL('../wasm/mediapipe/hand_landmarker.task', import.meta.url).href;

/** @type {HandLandmarker|null} */
let landmarker = null;

// Suppress MediaPipe's per-frame NORM_RECT warnings to avoid IPC spam.
const originalWarn = console.warn;
console.warn = function (...args) {
  if (args[0] && typeof args[0] === 'string' && args[0].includes('NORM_RECT')) return;
  originalWarn.apply(console, args);
};

async function initialize() {
  const vision = await FilesetResolver.forVisionTasks('/wasm/mediapipe');

  landmarker = await HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: HAND_MODEL_URL,
      delegate: 'GPU',
    },
    runningMode: 'VIDEO',
    numHands: 2,
    minHandDetectionConfidence: 0.5,
    minHandPresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });

  self.postMessage({ type: 'ready' });
}

function processFrame(bitmap, timestamp) {
  if (!landmarker) {
    bitmap.close();
    self.postMessage({ type: 'error', message: 'HandLandmarker not initialized.' });
    return;
  }

  try {
    const result = landmarker.detectForVideo(bitmap, timestamp);
    // `landmarks`: normalized image coordinates, 21 points per detected hand.
    self.postMessage({ type: 'result', landmarks: result.landmarks ?? [] });
  } catch (err) {
    self.postMessage({ type: 'error', message: err.message });
  } finally {
    bitmap.close();
  }
}

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
