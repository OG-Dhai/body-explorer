/**
 * Layer 2: Perception: Pose Service
 *
 * Main-thread controller that spawns the PoseLandmarker Web Worker.
 * Implements backpressure: drops frames when the worker is busy
 * to prevent message queue buildup and unbounded memory growth.
 */

import { CONFIG } from '../core/config.js';

export class PoseService {
  constructor() {
    /** @type {Worker|null} */
    this._worker = null;
    this._ready = false;
    this._busy = false;
    this._droppedFrames = 0;
    this._lastFrameTime = 0;
    this._hasProcessedFrame = false;
    this._restartCount = 0;
    this._isRecovering = false;
    this._maxRecoveryAttempts = 3;

    /** @type {((landmarks: Array) => void)|null} */
    this._resultCallback = null;

    /** @type {((err: string) => void)|null} */
    this._errorCallback = null;

    /** @private Resolve for the init promise */
    this._initResolve = null;
    this._initReject = null;
  }

  /**
   * Spawn the worker and initialize the PoseLandmarker.
   * Resolves when the worker signals 'ready'.
   * @returns {Promise<void>}
   */
  init() {
    this._hasProcessedFrame = false;
    this._lastFrameTime = 0;

    return new Promise((resolve, reject) => {
      this._initResolve = resolve;
      this._initReject = reject;

      // Vite resolves this URL at build time and bundles the worker as ESM
      this._worker = new Worker(
        new URL('./poseWorker.js', import.meta.url),
        { type: 'module' }
      );

      this._worker.onmessage = (event) => this._handleMessage(event.data);

      this._worker.onerror = (err) => {
        console.error('[PoseService] Worker error:', err.message);
        if (this._initReject) {
          const initReject = this._initReject;
          this._clearInitCallbacks();
          initReject(err);
        } else if (this._ready) {
          this._handleCrash();
        }
      };

      this._worker.postMessage({ type: 'init' });
    });
  }

  /**
   * Register a callback for processed worldLandmarks.
   * @param {(landmarks: Array) => void} cb
   */
  onResult(cb) {
    this._resultCallback = cb;
  }

  /**
   * Register a callback for worker errors.
   * @param {(message: string) => void} cb
   */
  onError(cb) {
    this._errorCallback = cb;
  }

  /**
   * Send a video frame to the worker for pose detection.
   * Implements backpressure: silently drops the frame if the worker is busy.
   *
   * CRITICAL: The bitmap is transferred (zero-copy), not cloned.
   * After this call, the bitmap is neutered on the main thread.
   *
   * @param {ImageBitmap} bitmap
   * @param {number} timestamp: milliseconds
   */
  sendFrame(bitmap, timestamp) {
    if (!this._ready || !this._worker) {
      bitmap.close();
      return;
    }

    // Backpressure gate: drop frame if worker is still processing
    if (this._busy) {
      bitmap.close();
      this._droppedFrames++;

      const watchdog = CONFIG.detection.poseWorkerWatchdog;
      const timeoutMs = this._hasProcessedFrame
        ? watchdog.steadyStateTimeoutMs
        : watchdog.coldStartTimeoutMs;
      const elapsedMs = performance.now() - this._lastFrameTime;

      if (elapsedMs > timeoutMs) {
        const phase = this._hasProcessedFrame ? 'frame processing' : 'first-frame warm-up';
        console.warn(
          `[PoseService] Worker stalled during ${phase} after ${Math.round(elapsedMs)}ms ` +
          `(limit ${timeoutMs}ms). Triggering recovery...`
        );
        this._handleCrash();
      }
      return;
    }

    this._busy = true;
    this._lastFrameTime = performance.now();

    // Transfer the bitmap: zero-copy, ownership moves to the worker
    this._worker.postMessage(
      { type: 'process', bitmap, timestamp },
      [bitmap]
    );
  }

  /** @returns {number} Total frames dropped due to backpressure */
  get droppedFrames() {
    return this._droppedFrames;
  }

  /** @returns {boolean} Whether the worker is initialized and ready */
  get isReady() {
    return this._ready;
  }

  /** Terminate the worker and clean up. */
  destroy() {
    this._ready = false;
    this._busy = false;
    this._hasProcessedFrame = false;
    this._lastFrameTime = 0;
    this._isRecovering = false;

    if (this._worker) {
      this._worker.terminate();
      this._worker = null;
    }

    this._resultCallback = null;
    this._errorCallback = null;
    this._clearInitCallbacks();
  }

  /**
   * Attempt to recover from a crashed or stalled worker.
   */
  _handleCrash() {
    if (this._isRecovering) {
      return;
    }

    if (this._restartCount >= this._maxRecoveryAttempts) {
      this._ready = false;
      this._busy = false;
      this._hasProcessedFrame = false;

      if (this._worker) {
        this._worker.terminate();
        this._worker = null;
      }

      this._errorCallback?.('Fatal worker failure: recovery limit reached. Please reload the app.');
      return;
    }

    this._isRecovering = true;
    this._restartCount++;
    this._ready = false;
    this._busy = false;
    this._hasProcessedFrame = false;

    if (this._worker) {
      this._worker.terminate();
      this._worker = null;
    }

    this._errorCallback?.(
      `PoseWorker terminated unexpectedly. Re-initializing (attempt ${this._restartCount}/${this._maxRecoveryAttempts})...`
    );

    this.init()
      .then(() => {
        this._isRecovering = false;
      })
      .catch(err => {
        console.error('[PoseService] Recovery failed:', err);
        this._isRecovering = false;
        this._errorCallback?.('Recovery failed: ' + err.message);
        this._handleCrash();
      });
  }

  /**
   * Route incoming worker messages.
   * @param {{ type: string, worldLandmarks?: Array, message?: string }} msg
   */
  _handleMessage(msg) {
    switch (msg.type) {
      case 'ready':
        this._ready = true;
        console.info('[PoseService] Worker ready.');
        {
          const initResolve = this._initResolve;
          this._clearInitCallbacks();
          initResolve?.();
        }
        break;

      case 'result':
        this._busy = false;
        this._hasProcessedFrame = true;
        this._restartCount = 0;
        if (msg.worldLandmarks) {
          msg.worldLandmarks.forEach(person => {
            person.forEach(landmark => {
              landmark.x = 1 - landmark.x; // Mirror X-axis for selfie view
            });
          });
        }
        this._resultCallback?.(msg.worldLandmarks);
        break;

      case 'error':
        this._busy = false;
        console.error('[PoseService] Worker error:', msg.message);
        this._errorCallback?.(msg.message);

        // If this error arrived during init, reject the init promise.
        if (!this._ready) {
          const initReject = this._initReject;
          this._clearInitCallbacks();
          initReject?.(new Error(msg.message));
        } else {
          // Processing errors can leave MediaPipe's graph permanently unable
          // to accept later frames. Recreate it instead of logging the same
          // graph error on every camera frame.
          this._handleCrash();
        }
        break;
    }
  }

  _clearInitCallbacks() {
    this._initResolve = null;
    this._initReject = null;
  }
}
