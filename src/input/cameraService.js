/**
 * Layer 1 — Input: Camera Service
 *
 * Acquires camera stream, captures frames as ImageBitmap using
 * requestVideoFrameCallback (Chromium) with requestAnimationFrame fallback.
 * All processing stays local — no frames leave the device.
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
    /** @type {number} */
    this._lastTime = -1;
    this._running = false;
    this._supportsRVFC = 'requestVideoFrameCallback' in HTMLVideoElement.prototype;
  }

  /** @returns {HTMLVideoElement|null} */
  get videoElement() {
    return this._video;
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
    if (this._running) return;

    this._stream = await navigator.mediaDevices.getUserMedia(CONSTRAINTS);

    this._video = document.createElement('video');
    this._video.srcObject = this._stream;
    this._video.setAttribute('playsinline', '');
    this._video.muted = true;

    await this._video.play();
    this._running = true;

    if (this._supportsRVFC) {
      this._loopRVFC();
    } else {
      console.info('[CameraService] rVFC not supported — using rAF fallback.');
      this._loopRAF();
    }
  }

  /** Stop camera and release all resources. */
  stop() {
    this._running = false;

    if (this._rafId !== null) {
      cancelAnimationFrame(this._rafId);
      this._rafId = null;
    }

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

  /**
   * Primary path — fires only when a new video frame is decoded.
   * Chromium-only (Chrome, Edge, Opera).
   */
  _loopRVFC() {
    if (!this._running || !this._video) return;

    this._video.requestVideoFrameCallback(async (_now, metadata) => {
      if (!this._running) return;

      try {
        const bitmap = await createImageBitmap(this._video);
        this._frameCallback?.({ bitmap, timestamp: metadata.mediaTime * 1000 });
      } catch (err) {
        console.error('[CameraService] Frame capture failed:', err.message);
      }

      this._loopRVFC();
    });
  }

  /**
   * Fallback path — uses rAF with currentTime deduplication.
   * Prevents processing the same frame twice in Firefox/Safari.
   */
  _loopRAF() {
    if (!this._running || !this._video) return;

    this._rafId = requestAnimationFrame(async () => {
      if (!this._running || !this._video) return;

      const currentTime = this._video.currentTime;

      // Only capture if we have a genuinely new frame
      if (currentTime !== this._lastTime && this._video.readyState >= 2) {
        this._lastTime = currentTime;

        try {
          const bitmap = await createImageBitmap(this._video);
          this._frameCallback?.({ bitmap, timestamp: currentTime * 1000 });
        } catch (err) {
          console.error('[CameraService] Frame capture failed:', err.message);
        }
      }

      this._loopRAF();
    });
  }
}
