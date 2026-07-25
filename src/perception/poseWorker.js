// Runs MediaPipe PoseLandmarker off the main thread. Takes an ImageBitmap and
// returns both image and world landmarks. WASM is self-hosted from
// /wasm/mediapipe/, no CDN.
//
// Messages in: { type:'init' } and { type:'process', bitmap, timestamp }.
// Messages out: { type:'ready' }, { type:'result', landmarks, worldLandmarks }
// or { type:'error', message }.

import { FilesetResolver, PoseLandmarker } from '@mediapipe/tasks-vision';

// The "full" model tracks joints more steadily than "lite", which matters
// because these points are the recognition targets. Loaded via new URL(...) so
// Vite bundles it as a hashed asset.
const POSE_MODEL_URL = new URL('../wasm/mediapipe/pose_landmarker_full.task', import.meta.url).href;

/** @type {PoseLandmarker|null} */
let landmarker = null;

// Suppress MediaPipe's per-frame NORM_RECT warnings to avoid IPC spam tanking FPS
const originalWarn = console.warn;
console.warn = function(...args) {
  if (args[0] && typeof args[0] === 'string' && args[0].includes('NORM_RECT')) return;
  originalWarn.apply(console, args);
};

// Set up the PoseLandmarker from the local WASM and model. Runs once on 'init'.
async function initialize() {
  const basePath = '/wasm/mediapipe';
  const vision = await FilesetResolver.forVisionTasks(basePath);

  landmarker = await PoseLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: POSE_MODEL_URL,
      delegate: 'GPU',
    },
    runningMode: 'VIDEO',
    numPoses: 1,
  });

  self.postMessage({ type: 'ready' });
}

// Process one video frame. Always closes the bitmap afterwards, otherwise the
// GPU/CPU memory leaks frame by frame.
function processFrame(bitmap, timestamp) {
  if (!landmarker) {
    bitmap.close();
    self.postMessage({ type: 'error', message: 'Landmarker not initialized.' });
    return;
  }

  try {
    const result = landmarker.detectForVideo(bitmap, timestamp);

    // `landmarks` are normalized image coordinates (stable x/y, used for the
    // recognition math); `worldLandmarks` are metric 3D (used to draw the
    // on-screen skeleton). We forward both.
    self.postMessage({
      type: 'result',
      landmarks: result.landmarks ?? [],
      worldLandmarks: result.worldLandmarks ?? [],
    });
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
