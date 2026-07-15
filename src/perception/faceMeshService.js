/**
 * Layer 2: Perception: FaceMesh Service
 *
 * Main-thread controller for lazy FaceLandmarker execution. No worker is
 * created until a facial target is active, and deactivation terminates it.
 */

export class FaceMeshService {
  constructor() {
    /** @type {Worker|null} */
    this._worker = null;
    this._ready = false;
    this._busy = false;
    this._active = false;
    this._currentTargetId = null;
    this._droppedFrames = 0;

    /** @type {((result: { faceLandmarks: Array, timestamp: number, targetId: string }) => void)|null} */
    this._resultCallback = null;

    /** @type {((err: string) => void)|null} */
    this._errorCallback = null;

    this._initPromise = null;
    this._initResolve = null;
    this._initReject = null;
  }

  activate(targetId) {
    this._active = true;
    this._currentTargetId = targetId;
    return this.ensureInitialized();
  }

  ensureInitialized() {
    if (this._ready) return Promise.resolve();
    if (this._initPromise) return this._initPromise;

    this._worker = new Worker(
      new URL('./faceMeshWorker.js', import.meta.url),
      { type: 'module' }
    );

    this._worker.onmessage = (event) => this._handleMessage(event.data);
    this._worker.onerror = (err) => {
      this._errorCallback?.(err.message);
      this._rejectInit(err);
      this._resetWorker();
    };

    this._initPromise = new Promise((resolve, reject) => {
      this._initResolve = resolve;
      this._initReject = reject;
    });

    this._worker.postMessage({ type: 'init' });
    return this._initPromise;
  }

  deactivate() {
    this._active = false;
    this._currentTargetId = null;
    this._rejectInit(new Error('FaceMesh deactivated.'));
    this._resetWorker();
  }

  destroy() {
    this.deactivate();
    this._resultCallback = null;
    this._errorCallback = null;
  }

  onResult(cb) {
    this._resultCallback = cb;
  }

  onError(cb) {
    this._errorCallback = cb;
  }

  sendFrame(bitmap, timestamp, targetId) {
    if (!this._active || targetId !== this._currentTargetId || !this._ready || !this._worker) {
      bitmap.close();
      return false;
    }

    if (this._busy) {
      bitmap.close();
      this._droppedFrames++;
      return false;
    }

    this._busy = true;
    this._worker.postMessage(
      { type: 'process', bitmap, timestamp, targetId },
      [bitmap]
    );
    return true;
  }

  get isReady() {
    return this._ready;
  }

  get isActive() {
    return this._active;
  }

  get droppedFrames() {
    return this._droppedFrames;
  }

  _handleMessage(msg) {
    switch (msg.type) {
      case 'ready':
        this._ready = true;
        this._initResolve?.();
        this._clearInitPromise();
        break;

      case 'result':
        this._busy = false;
        this._resultCallback?.({
          faceLandmarks: this._mirrorFaceLandmarks(msg.faceLandmarks),
          timestamp: msg.timestamp,
          targetId: msg.targetId,
        });
        break;

      case 'error':
        this._busy = false;
        this._errorCallback?.(msg.message);
        if (!this._ready) {
          this._rejectInit(new Error(msg.message));
          this._resetWorker();
        }
        break;

      case 'closed':
        this._resetWorker();
        break;
    }
  }

  _mirrorFaceLandmarks(faceLandmarks) {
    return faceLandmarks.map(face => (
      face.map(landmark => ({
        ...landmark,
        x: 1 - landmark.x,
      }))
    ));
  }

  _rejectInit(err) {
    this._initReject?.(err);
    this._clearInitPromise();
  }

  _clearInitPromise() {
    this._initPromise = null;
    this._initResolve = null;
    this._initReject = null;
  }

  _resetWorker() {
    this._ready = false;
    this._busy = false;

    if (this._worker) {
      this._worker.terminate();
      this._worker = null;
    }
  }
}
