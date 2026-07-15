/**
 * Layer 1: Input: Camera Service
 *
 * Acquires camera stream, captures frames as ImageBitmap using
 * requestVideoFrameCallback (Chromium) with requestAnimationFrame fallback.
 * All processing stays local: no frames leave the device.
 */

/** @typedef {{ bitmap: ImageBitmap, timestamp: number }} FrameData */

const CONSTRAINTS = {
  video: {
    width: { ideal: 640, max: 640 },
    height: { ideal: 480, max: 480 },
    facingMode: 'user',
    frameRate: { ideal: 30, max: 30 },
  },
  audio: false,
};

export class CameraService {
  constructor() {
    /** @type {MediaStream|null} */
    this._stream = null;
    /** @type {HTMLVideoElement|null} */
    this._video = null;
    /** @type {((frame: FrameData) => void)|null} */
    this._frameCallback = null;
    /** @type {number|null} */
    this._rafId = null;
    /** @type {number|null} */
    this._rvfcId = null;
    /** @type {number} */
    this._lastTime = -1;
    /**
     * MediaPipe VIDEO mode requires timestamps to increase for the lifetime of
     * its graph. Keep this document-clock value across camera stop/start cycles
     * because the PoseService worker is intentionally reused between sessions.
     * @type {number}
     */
    this._lastInferenceTimestamp = -Infinity;
    this._running = false;
    this._paused = false;
    this._loopGeneration = 0;
    this._supportsRVFC = typeof HTMLVideoElement !== 'undefined'
      && 'requestVideoFrameCallback' in HTMLVideoElement.prototype;
  }

  /** @returns {HTMLVideoElement|null} */
  get videoElement() {
    return this._video;
  }

  get isRunning() {
    return this._running;
  }

  get isPaused() {
    return this._paused;
  }

  /**
   * Register a callback that receives each new video frame as an ImageBitmap.
   * @param {(frame: FrameData) => void} cb
   */
  onFrame(cb) {
    this._frameCallback = cb;
  }

  /** Start camera capture and begin the frame loop. */
  async start() {
    if (this._running) {
      if (this._paused) this.resume();
      return;
    }

    try {
      this._stream = await navigator.mediaDevices.getUserMedia(CONSTRAINTS);
    } catch {
      throw new Error('Camera access denied or unavailable. Please check your browser permissions.');
    }

    this._video = document.createElement('video');
    this._video.srcObject = this._stream;
    this._video.setAttribute('playsinline', '');
    this._video.muted = true;

    await this._video.play();
    this._running = true;
    this._paused = false;
    this._loopGeneration++;

    if (this._supportsRVFC) {
      this._loopRVFC();
    } else {
      console.info('[CameraService] rVFC not supported. Using rAF fallback.');
      this._loopRAF();
    }
  }

  /**
   * Pause frame delivery without stopping MediaStream tracks. This keeps the
   * browser's camera permission and makes cancellation instant to resume.
   */
  pause() {
    if (!this._running || this._paused) return false;
    this._paused = true;
    this._loopGeneration++;
    this._cancelScheduledFrame();
    return true;
  }

  /** Resume frame delivery synchronously on the current interaction tick. */
  resume() {
    if (!this._running || !this._paused || !this._video) return false;
    this._paused = false;
    this._loopGeneration++;

    if (this._supportsRVFC) {
      this._loopRVFC();
    } else {
      this._loopRAF();
    }
    return true;
  }

  /** Stop camera and release all resources. */
  stop() {
    this._running = false;
    this._paused = false;
    this._loopGeneration++;
    this._cancelScheduledFrame();

    if (this._stream) {
      this._stream.getTracks().forEach((t) => t.stop());
      this._stream = null;
    }

    if (this._video) {
      this._video.srcObject = null;
      this._video = null;
    }

    this._lastTime = -1;
  }

  _cancelScheduledFrame() {
    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }

    if (this._rvfcId !== null) {
      this._video?.cancelVideoFrameCallback?.(this._rvfcId);
      this._rvfcId = null;
    }
  }

  /**
   * Primary path: fires only when a new video frame is decoded.
   * Chromium-only (Chrome, Edge, Opera).
   */
  _loopRVFC() {
    if (!this._running || this._paused || !this._video) return;
    const generation = this._loopGeneration;

    this._rvfcId = this._video.requestVideoFrameCallback(async (now) => {
      this._rvfcId = null;
      if (!this._running || this._paused || generation !== this._loopGeneration) return;

      try {
        const bitmap = await createImageBitmap(this._video);
        if (!this._running || this._paused || generation !== this._loopGeneration) {
          bitmap.close?.();
          return;
        }
        this._frameCallback?.({
          bitmap,
          timestamp: this._nextInferenceTimestamp(now),
        });
      } catch (err) {
        console.error('[CameraService] Frame capture failed:', err.message);
      }

      if (generation === this._loopGeneration) this._loopRVFC();
    });
  }

  /**
   * Fallback path: uses rAF with currentTime deduplication.
   * Prevents processing the same frame twice in Firefox/Safari.
   */
  _loopRAF() {
    if (!this._running || this._paused || !this._video) return;
    const generation = this._loopGeneration;

    this._rafId = requestAnimationFrame(async (now) => {
      this._rafId = null;
      if (!this._running || this._paused || !this._video
        || generation !== this._loopGeneration) return;

      const currentTime = this._video.currentTime;

      // Only capture if we have a genuinely new frame
      if (currentTime !== this._lastTime && this._video.readyState >= 2) {
        this._lastTime = currentTime;

        try {
          const bitmap = await createImageBitmap(this._video);
          if (!this._running || this._paused || generation !== this._loopGeneration) {
            bitmap.close?.();
            return;
          }
          this._frameCallback?.({
            bitmap,
            timestamp: this._nextInferenceTimestamp(now),
          });
        } catch (err) {
          console.error('[CameraService] Frame capture failed:', err.message);
        }
      }

      if (generation === this._loopGeneration) this._loopRAF();
    });
  }

  /**
   * Convert the animation callback's document-relative clock into a strictly
   * increasing MediaPipe timestamp. Unlike video.currentTime/mediaTime, this
   * clock does not reset when a new MediaStream is attached.
   */
  _nextInferenceTimestamp(candidate) {
    const clockTime = Number.isFinite(candidate) ? candidate : performance.now();
    this._lastInferenceTimestamp = Math.max(
      clockTime,
      this._lastInferenceTimestamp + 0.001
    );
    return this._lastInferenceTimestamp;
  }
}
