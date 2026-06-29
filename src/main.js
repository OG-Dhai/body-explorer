/**
 * Body Explorer 3D — Entry Point
 *
 * Orchestrates the Sprint 1 pipeline boot sequence:
 *   Camera → PoseService (Worker) → Console Output
 *
 * The Start button provides the user gesture required for
 * camera permissions and AudioContext resume.
 */

import { CameraService } from './input/cameraService.js';
import { PoseService } from './perception/poseService.js';
import { playClick, playSuccess, dispose as disposeAudio } from './audio/audioEngine.js';

const statusEl = document.getElementById('status');
const btnStart = document.getElementById('btn-start');
const outputEl = document.getElementById('output');

const camera = new CameraService();
const pose = new PoseService();

/** @type {number} */
let frameCount = 0;

function setStatus(text) {
  statusEl.textContent = text;
}

function logOutput(text) {
  outputEl.textContent = text + '\n' + outputEl.textContent;
  // Keep the log buffer bounded
  if (outputEl.textContent.length > 4000) {
    outputEl.textContent = outputEl.textContent.slice(0, 4000);
  }
}

// ── Pipeline Wiring ──

camera.onFrame(({ bitmap, timestamp }) => {
  pose.sendFrame(bitmap, timestamp);
});

pose.onResult((worldLandmarks) => {
  frameCount++;
  if (worldLandmarks.length > 0) {
    const lm = worldLandmarks[0]; // First detected pose
    const summary = `#${frameCount} | ${lm.length} joints | `
      + `nose=(${lm[0].x.toFixed(3)}, ${lm[0].y.toFixed(3)}, ${lm[0].z.toFixed(3)})`;
    logOutput(summary);
  } else {
    logOutput(`#${frameCount} | No pose detected`);
  }
});

pose.onError((msg) => {
  logOutput(`[ERROR] ${msg}`);
});

// ── Boot Sequence ──

async function startPipeline() {
  btnStart.disabled = true;
  setStatus('Initializing pose model...');

  try {
    await pose.init();
    setStatus('Starting camera...');
    await camera.start();
    setStatus('Pipeline active — tracking pose.');
    playSuccess();
  } catch (err) {
    setStatus(`Error: ${err.message}`);
    btnStart.disabled = false;
    console.error('[main] Boot failed:', err);
  }
}

btnStart.addEventListener('click', () => {
  playClick();
  startPipeline();
});

// ── Cleanup on page unload ──
window.addEventListener('beforeunload', () => {
  camera.stop();
  pose.destroy();
  disposeAudio();
});
