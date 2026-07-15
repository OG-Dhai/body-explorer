import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PoseService } from './poseService.js';

let now;

class WorkerMock {
  static instances = [];

  constructor() {
    this.messages = [];
    this.terminated = false;
    WorkerMock.instances.push(this);
  }

  postMessage(message, transfer = []) {
    this.messages.push({ message, transfer });
  }

  terminate() {
    this.terminated = true;
  }

  emit(data) {
    this.onmessage?.({ data });
  }

  fail(message = 'Worker crashed') {
    this.onerror?.({ message });
  }
}

function createBitmap() {
  return { close: vi.fn() };
}

async function initialize(service) {
  const initPromise = service.init();
  const worker = WorkerMock.instances.at(-1);
  worker.emit({ type: 'ready' });
  await initPromise;
  return worker;
}

describe('PoseService watchdog', () => {
  beforeEach(() => {
    now = 0;
    WorkerMock.instances = [];
    vi.stubGlobal('Worker', WorkerMock);
    vi.stubGlobal('performance', { now: () => now });
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(console, 'info').mockImplementation(() => {});
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('allows a slow first inference to finish without restarting the worker', async () => {
    const service = new PoseService();
    const onResult = vi.fn();
    service.onResult(onResult);
    const worker = await initialize(service);

    service.sendFrame(createBitmap(), 0);
    now = 3_101;
    const droppedFrame = createBitmap();
    service.sendFrame(droppedFrame, 33);

    expect(droppedFrame.close).toHaveBeenCalledOnce();
    expect(worker.terminated).toBe(false);
    expect(WorkerMock.instances).toHaveLength(1);

    worker.emit({ type: 'result', worldLandmarks: [] });

    expect(onResult).toHaveBeenCalledWith([]);
    service.destroy();
  });

  it('recovers if the first inference exceeds the cold-start deadline', async () => {
    const service = new PoseService();
    const worker = await initialize(service);

    service.sendFrame(createBitmap(), 0);
    now = 29_999;
    service.sendFrame(createBitmap(), 33);
    expect(worker.terminated).toBe(false);

    now = 30_001;
    service.sendFrame(createBitmap(), 66);

    expect(worker.terminated).toBe(true);
    expect(WorkerMock.instances).toHaveLength(2);
    service.destroy();
  });

  it('keeps the shorter watchdog after a worker has processed a frame', async () => {
    const service = new PoseService();
    const worker = await initialize(service);

    service.sendFrame(createBitmap(), 0);
    worker.emit({ type: 'result', worldLandmarks: [] });

    now = 100;
    service.sendFrame(createBitmap(), 33);
    now = 3_101;
    service.sendFrame(createBitmap(), 66);

    expect(worker.terminated).toBe(true);
    expect(WorkerMock.instances).toHaveLength(2);
    service.destroy();
  });

  it('recovers from a runtime worker error after initialization', async () => {
    const service = new PoseService();
    const errors = [];
    service.onError((message) => errors.push(message));
    const worker = await initialize(service);

    worker.fail('GPU context lost');

    expect(worker.terminated).toBe(true);
    expect(WorkerMock.instances).toHaveLength(2);
    expect(errors.at(-1)).toContain('attempt 1/3');
    service.destroy();
  });

  it('recovers from an error message posted by an initialized worker', async () => {
    const service = new PoseService();
    const errors = [];
    service.onError((message) => errors.push(message));
    const worker = await initialize(service);

    service.sendFrame(createBitmap(), 120_000);
    worker.emit({
      type: 'error',
      message: 'Packet timestamp mismatch on stream norm_rect',
    });

    expect(worker.terminated).toBe(true);
    expect(WorkerMock.instances).toHaveLength(2);
    expect(errors).toContain('Packet timestamp mismatch on stream norm_rect');
    expect(errors.at(-1)).toContain('attempt 1/3');
    service.destroy();
  });
});
