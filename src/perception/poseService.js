/**
 * Layer 2 — Perception: Pose Service
 *
 * Main-thread controller that spawns the PoseLandmarker Web Worker.
 * Implements backpressure: drops frames when the worker is busy
 * to prevent message queue buildup and unbounded memory growth.
 */

export class PoseService {
  constructor() {
    /** @type {Worker|null} */
    this._worker = null;
    this._ready = false;
    this._busy = false;
    this._droppedFrames = 0;

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
        this._initReject?.(err);
        this._initReject = null;
      };

      // Tell the worker to load MediaPipe
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
   * Implements backpressure — silently drops the frame if the worker is busy.
   *
   * CRITICAL: The bitmap is transferred (zero-copy), not cloned.
   * After this call, the bitmap is neutered on the main thread.
   *
   * @param {ImageBitmap} bitmap
   * @param {number} timestamp — milliseconds
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
      return;
    }

    this._busy = true;

    // Transfer the bitmap — zero-copy, ownership moves to the worker
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

    if (this._worker) {
      this._worker.terminate();
      this._worker = null;
    }

    this._resultCallback = null;
    this._errorCallback = null;
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
        this._initResolve?.();
        this._initResolve = null;
        break;

      case 'result':
        this._busy = false;
        this._resultCallback?.(msg.worldLandmarks);
        break;

      case 'error':
        this._busy = false;
        console.error('[PoseService] Worker error:', msg.message);
        this._errorCallback?.(msg.message);

        // If this error arrived during init, reject the init promise
        if (!this._ready) {
          this._initReject?.(new Error(msg.message));
          this._initReject = null;
        }
        break;
    }
  }
}
