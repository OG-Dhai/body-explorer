/**
 * Layer 2: Perception: FaceMesh Worker
 *
 * Runs MediaPipe FaceLandmarker off-main-thread only while facial targets are
 * active. Returns the full FaceMesh landmark set for target refinement.
 */

import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

const FACE_MODEL_URL = new URL('../wasm/mediapipe/face_landmarker.task', import.meta.url).href;

/** @type {FaceLandmarker|null} */
let landmarker = null;

const originalWarn = console.warn;
console.warn = function(...args) {
  if (args[0] && typeof args[0] === 'string' && args[0].includes('NORM_RECT')) return;
  originalWarn.apply(console, args);
};

async function initialize() {
  if (landmarker) {
    self.postMessage({ type: 'ready' });
    return;
  }

  const vision = await FilesetResolver.forVisionTasks('/wasm/mediapipe');

  landmarker = await FaceLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: FACE_MODEL_URL,
      delegate: 'GPU',
    },
    runningMode: 'VIDEO',
    numFaces: 1,
    minFaceDetectionConfidence: 0.5,
    minFacePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
    outputFaceBlendshapes: false,
    outputFacialTransformationMatrixes: false,
  });

  self.postMessage({ type: 'ready' });
}

function closeLandmarker() {
  if (landmarker) {
    landmarker.close();
    landmarker = null;
  }
  self.postMessage({ type: 'closed' });
}

function processFrame(bitmap, timestamp, targetId) {
  if (!landmarker) {
    bitmap.close();
    self.postMessage({ type: 'error', message: 'FaceLandmarker not initialized.' });
    return;
  }

  try {
    const result = landmarker.detectForVideo(bitmap, timestamp);
    self.postMessage({
      type: 'result',
      faceLandmarks: result.faceLandmarks ?? [],
      timestamp,
      targetId,
    });
  } catch (err) {
    self.postMessage({ type: 'error', message: err.message });
  } finally {
    bitmap.close();
  }
}

self.onmessage = async (event) => {
  const { type, bitmap, timestamp, targetId } = event.data;

  switch (type) {
    case 'init':
      try {
        await initialize();
      } catch (err) {
        self.postMessage({ type: 'error', message: `FaceMesh init failed: ${err.message}` });
      }
      break;

    case 'process':
      processFrame(bitmap, timestamp, targetId);
      break;

    case 'close':
      closeLandmarker();
      break;

    default:
      self.postMessage({ type: 'error', message: `Unknown FaceMesh message type: ${type}` });
  }
};
