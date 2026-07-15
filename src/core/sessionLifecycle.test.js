import { describe, expect, it, vi } from 'vitest';

import { resumeSessionInSameTick } from './sessionLifecycle.js';

describe('resumeSessionInSameTick', () => {
  it('requests audio and camera synchronously without awaiting audio first', async () => {
    const order = [];
    let resolveAudio;
    const audioPromise = new Promise((resolve) => {
      resolveAudio = resolve;
    });

    const result = resumeSessionInSameTick({
      resumeAudio: vi.fn(() => {
        order.push('audio');
        return audioPromise;
      }),
      resumeCamera: vi.fn(() => {
        order.push('camera');
        return true;
      }),
      resumeGame: vi.fn(() => {
        order.push('game');
        return true;
      }),
      resumeRender: vi.fn(() => {
        order.push('render');
      }),
    });

    expect(order).toEqual(['audio', 'camera', 'game', 'render']);
    expect(result.cameraResumed).toBe(true);
    expect(result.gameResumed).toBe(true);

    resolveAudio(true);
    await expect(result.audioResumePromise).resolves.toBe(true);
  });
});
