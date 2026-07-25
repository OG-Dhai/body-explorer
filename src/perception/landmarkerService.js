// Base class shared by PoseService and HandService. Runs a MediaPipe worker on
// the main thread and handles the plumbing: backpressure (drops frames while
// the worker is busy), a stall watchdog, and limited crash recovery.
//
// Subclasses fill in two things: _createWorker() returns the worker, and
// _shapeResult(msg) turns a worker message into the value onResult receives.

import { CONFIG } from '../core/config.js';

/** Mirror the X axis of every landmark in every detected item (selfie view). */
export function mirrorX(groups) {
  if (!groups) return;
  for (const group of groups) {
    for (const landmark of group) {
      landmark.x = 1 - landmark.x;
    }
  }
}

export class LandmarkerService {
  /** @param {string} name - short label used in log messages */
  constructor(name) {
    this._name = name;
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

    this._resultCallback = null;
    this._errorCallback = null;
    this._initResolve = null;
    this._initReject = null;
  }

  /** @abstract @returns {Worker} */
  _createWorker() {
    throw new Error('_createWorker() must be implemented by a subclass');
  }

  /** @abstract @param {object} msg @returns {*} value handed to the onResult callback */
  _shapeResult(msg) {
    return msg;
  }

  /**
   * Spawn the worker and initialize the landmarker.
   * Resolves when the worker signals 'ready'.
   * @returns {Promise<void>}
   */
  init() {
    this._hasProcessedFrame = false;
    this._lastFrameTime = 0;

    return new Promise((resolve, reject) => {
      this._initResolve = resolve;
      this._initReject = reject;

      this._worker = this._createWorker();
      this._worker.onmessage = (event) => this._handleMessage(event.data);
      this._worker.onerror = (err) => {
        console.error(`[${this._name}] Worker error:`, err.message);
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

  /** @param {(result: *) => void} cb */
  onResult(cb) {
    this._resultCallback = cb;
  }

  /** @param {(message: string) => void} cb */
  onError(cb) {
    this._errorCallback = cb;
  }

  // Send a frame to the worker. If the worker is still busy, drop the frame and
  // close the bitmap so the queue never backs up. The bitmap is transferred
  // (zero-copy), so it's unusable after this call.
  sendFrame(bitmap, timestamp) {
    if (!this._ready || !this._worker) {
      bitmap.close();
      return;
    }

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
          `[${this._name}] Worker stalled during ${phase} after ${Math.round(elapsedMs)}ms ` +
          `(limit ${timeoutMs}ms). Triggering recovery...`
        );
        this._handleCrash();
      }
      return;
    }

    this._busy = true;
    this._lastFrameTime = performance.now();
    this._worker.postMessage({ type: 'process', bitmap, timestamp }, [bitmap]);
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

  /** Attempt to recover from a crashed or stalled worker. */
  _handleCrash() {
    if (this._isRecovering) return;

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
      `${this._name} worker terminated unexpectedly. Re-initializing (attempt ${this._restartCount}/${this._maxRecoveryAttempts})...`
    );

    this.init()
      .then(() => { this._isRecovering = false; })
      .catch((err) => {
        console.error(`[${this._name}] Recovery failed:`, err);
        this._isRecovering = false;
        this._errorCallback?.('Recovery failed: ' + err.message);
        this._handleCrash();
      });
  }

  /** @param {{ type: string, message?: string }} msg */
  _handleMessage(msg) {
    switch (msg.type) {
      case 'ready':
        this._ready = true;
        console.info(`[${this._name}] Worker ready.`);
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
        this._resultCallback?.(this._shapeResult(msg));
        break;

      case 'error':
        this._busy = false;
        console.error(`[${this._name}] Worker error:`, msg.message);
        this._errorCallback?.(msg.message);
        if (!this._ready) {
          const initReject = this._initReject;
          this._clearInitCallbacks();
          initReject?.(new Error(msg.message));
        } else {
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
