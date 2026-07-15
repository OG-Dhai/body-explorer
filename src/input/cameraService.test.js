import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CameraService } from './cameraService.js';

describe('CameraService session pause lifecycle', () => {
  let track;
  let video;
  let rafCallbacks;
  let nextRafId;

  beforeEach(() => {
    track = { stop: vi.fn() };
    video = {
      srcObject: null,
      muted: false,
      currentTime: 0,
      readyState: 2,
      setAttribute: vi.fn(),
      play: vi.fn(async () => {}),
    };
    rafCallbacks = new Map();
    nextRafId = 1;

    vi.stubGlobal('HTMLVideoElement', class HTMLVideoElement {});
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: vi.fn(async () => ({
          getTracks: () => [track],
        })),
      },
    });
    vi.stubGlobal('document', {
      createElement: vi.fn(() => video),
    });
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback) => {
      const id = nextRafId++;
      rafCallbacks.set(id, callback);
      return id;
    }));
    vi.stubGlobal('cancelAnimationFrame', vi.fn((id) => {
      rafCallbacks.delete(id);
    }));
    vi.stubGlobal('createImageBitmap', vi.fn(async () => ({ close: vi.fn() })));
    vi.spyOn(console, 'info').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  async function runNextAnimationFrame(timestamp) {
    const next = rafCallbacks.entries().next().value;
    expect(next).toBeDefined();
    const [id, callback] = next;
    rafCallbacks.delete(id);
    await callback(timestamp);
  }

  it('pauses frame delivery without releasing the webcam and resumes immediately', async () => {
    const camera = new CameraService();
    await camera.start();

    expect(camera.isRunning).toBe(true);
    expect(camera.isPaused).toBe(false);
    expect(requestAnimationFrame).toHaveBeenCalledOnce();

    expect(camera.pause()).toBe(true);
    expect(camera.isPaused).toBe(true);
    expect(cancelAnimationFrame).toHaveBeenCalledOnce();
    expect(track.stop).not.toHaveBeenCalled();
    expect(video.srcObject).not.toBeNull();

    const callsBeforeResume = requestAnimationFrame.mock.calls.length;
    expect(camera.resume()).toBe(true);
    expect(camera.isPaused).toBe(false);
    expect(requestAnimationFrame.mock.calls.length).toBe(callsBeforeResume + 1);
    expect(track.stop).not.toHaveBeenCalled();
    expect(video.play).toHaveBeenCalledOnce();

    camera.stop();
    expect(track.stop).toHaveBeenCalledOnce();
    expect(video.srcObject).toBeNull();
    expect(camera.isRunning).toBe(false);
  });

  it('does not create duplicate loops across repeated pause/resume calls', async () => {
    const camera = new CameraService();
    await camera.start();

    expect(camera.pause()).toBe(true);
    expect(camera.pause()).toBe(false);
    expect(camera.resume()).toBe(true);
    expect(camera.resume()).toBe(false);

    expect(rafCallbacks.size).toBe(1);
    camera.stop();
    expect(rafCallbacks.size).toBe(0);
  });

  it('keeps inference timestamps increasing when the video clock resets', async () => {
    const camera = new CameraService();
    const frames = [];
    camera.onFrame((frame) => frames.push(frame));

    await camera.start();
    video.currentTime = 167.760008;
    await runNextAnimationFrame(200_000);

    camera.stop();
    await camera.start();
    video.currentTime = 1.112432;
    await runNextAnimationFrame(200_033);

    expect(frames.map(({ timestamp }) => timestamp)).toEqual([200_000, 200_033]);
    expect(frames[1].timestamp).toBeGreaterThan(frames[0].timestamp);
    expect(frames[1].timestamp).not.toBe(video.currentTime * 1000);

    frames.forEach(({ bitmap }) => bitmap.close());
    camera.stop();
  });

  it('uses the document clock on the Chromium video-frame path', async () => {
    const rvfcCallbacks = new Map();
    let nextRvfcId = 1;
    HTMLVideoElement.prototype.requestVideoFrameCallback = vi.fn();
    video.requestVideoFrameCallback = vi.fn((callback) => {
      const id = nextRvfcId++;
      rvfcCallbacks.set(id, callback);
      return id;
    });
    video.cancelVideoFrameCallback = vi.fn((id) => rvfcCallbacks.delete(id));

    const camera = new CameraService();
    const timestamps = [];
    camera.onFrame(({ bitmap, timestamp }) => {
      timestamps.push(timestamp);
      bitmap.close();
    });

    await camera.start();
    const [firstId, firstCallback] = rvfcCallbacks.entries().next().value;
    rvfcCallbacks.delete(firstId);
    await firstCallback(200_000, { mediaTime: 167.760008 });

    camera.stop();
    await camera.start();
    const [secondId, secondCallback] = rvfcCallbacks.entries().next().value;
    rvfcCallbacks.delete(secondId);
    await secondCallback(200_033, { mediaTime: 1.112432 });

    expect(timestamps).toEqual([200_000, 200_033]);
    camera.stop();
  });

  it('makes equal callback clock values strictly increasing', async () => {
    const camera = new CameraService();
    const timestamps = [];
    camera.onFrame(({ bitmap, timestamp }) => {
      timestamps.push(timestamp);
      bitmap.close();
    });

    await camera.start();
    video.currentTime = 1;
    await runNextAnimationFrame(1_000);
    video.currentTime = 2;
    await runNextAnimationFrame(1_000);

    expect(timestamps[0]).toBe(1_000);
    expect(timestamps[1]).toBeGreaterThan(timestamps[0]);
    camera.stop();
  });
});
