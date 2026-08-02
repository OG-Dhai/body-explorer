/**
 * Hit-validation regression suite (fingertip recognition).
 *
 * Drives the REAL GameEngine.update() path (hitValidator + holdDetector + config)
 * with synthetic recognition frames: pose image landmarks (targets) plus a hand
 * with a fingertip. Covers a correct touch, a hover, a wrong/adjacent part, no
 * hand, and a face target, plus a fairness guard (slightly-sloppy touch).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CONFIG } from '../core/config.js';
import eventBus from '../core/eventBus.js';
import { GameEngine } from './gameEngine.js';

const engines = [];

function createEngine() {
  const engine = new GameEngine();
  engines.push(engine);
  return engine;
}

// Pose image landmarks (normalized). Shoulders 0.20 apart set the body scale.
function makePose(overrides = {}) {
  const pose = Array.from({ length: 33 }, () => ({ x: 0.95, y: 0.95, visibility: 1, presence: 1 }));
  const base = {
    11: { x: 0.40, y: 0.40 }, 12: { x: 0.60, y: 0.40 },
    0: { x: 0.50, y: 0.25 },
    2: { x: 0.47, y: 0.23 }, 5: { x: 0.53, y: 0.23 },
    7: { x: 0.44, y: 0.25 }, 8: { x: 0.56, y: 0.25 },
    15: { x: 0.30, y: 0.55 }, 16: { x: 0.70, y: 0.55 },
    23: { x: 0.44, y: 0.65 }, 24: { x: 0.56, y: 0.65 },
    25: { x: 0.45, y: 0.80 }, 26: { x: 0.55, y: 0.80 },
  };
  for (const [i, p] of Object.entries({ ...base, ...overrides })) {
    pose[i] = { ...p, visibility: 1, presence: 1 };
  }
  return pose;
}

function makeHand(tip, wrist = { x: 0.5, y: 0.5 }) {
  const hand = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  hand[0] = { ...wrist, z: 0 };
  for (const t of [4, 8, 12]) hand[t] = { ...tip, z: 0 };
  return hand;
}

function frameWithFingerAt(tip, { face = null } = {}) {
  return { pose: makePose(), hands: [makeHand(tip)], face };
}

function enterDetecting(engine, targetId, level = 1) {
  const target = CONFIG.targetMap[targetId];
  engine._questionBank._questions = [{
    id: targetId,
    indices: target.indices,
    instKey: `inst.${targetId}`,
    eduKey: `edu.${targetId}`,
    factKey: `fact.${targetId}`,
  }];
  engine._questionBank._currentIndex = 1;
  engine._hitRadiusScale = CONFIG.game.levels[level].hitRadiusScale;
  engine._holdDetector.setHoldDuration(CONFIG.game.levels[level].holdDuration);
  engine._holdDetector.reset();
  engine._fsm._currentState = 'DETECTING';
  engine._scoring.startQuestion(performance.now());
  engine._lastTime = performance.now();
}

function feedStaticFrame(engine, frame, { ms = 1800, frameMs = 16 } = {}) {
  let hit = false;
  let wrongPart = null;
  const onHit = () => { hit = true; };
  const onWrong = (e) => { wrongPart = e; };
  eventBus.on('detection:success', onHit);
  eventBus.on('detection:wrongPart', onWrong);
  try {
    for (let elapsed = 0; elapsed <= ms; elapsed += frameMs) {
      engine.update(frame);
      if (hit) break;
      vi.advanceTimersByTime(frameMs);
    }
  } finally {
    eventBus.off('detection:success', onHit);
    eventBus.off('detection:wrongPart', onWrong);
  }
  return { hit, wrongPart };
}

function play(targetId, frame, level = 1) {
  vi.useFakeTimers();
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  const engine = createEngine();
  enterDetecting(engine, targetId, level);
  return feedStaticFrame(engine, frame);
}

const confirmsHit = (targetId, tip, opts, level) => play(targetId, frameWithFingerAt(tip, opts), level).hit;

afterEach(() => {
  for (const engine of engines.splice(0)) engine.dispose();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('fingertip recognition: correct vs. wrong / near', () => {
  it('confirms a correct fingertip touch on the knee', () => {
    expect(confirmsHit('left_knee', { x: 0.45, y: 0.80 })).toBe(true);
  });

  it('rejects a hover well away from the part', () => {
    expect(confirmsHit('left_knee', { x: 0.45, y: 0.98 })).toBe(false);
  });

  it('rejects a steady hover inside the outer zone that never makes contact', () => {
    // ~0.38 of a shoulder width away: inside the tracking radius, past contact.
    expect(confirmsHit('left_knee', { x: 0.45, y: 0.876 })).toBe(false);
  });

  it('rejects the adjacent part and offers a correction', () => {
    // Finger on the right knee, asked for the left knee.
    const { hit, wrongPart } = play('left_knee', frameWithFingerAt({ x: 0.55, y: 0.80 }));
    expect(hit).toBe(false);
    expect(wrongPart).toMatchObject({ askedId: 'left_knee', touchedId: 'right_knee' });
  });

  it('rejects when no hand is present', () => {
    expect(play('left_knee', { pose: makePose(), hands: [], face: null }).hit).toBe(false);
  });
});

describe('fingertip recognition: face targets and fairness', () => {
  it('confirms a touch on a face target using precise face points', () => {
    const face = Array.from({ length: 478 }, () => ({ x: 0.95, y: 0.95 }));
    face[1] = { x: 0.50, y: 0.25 };
    face[4] = { x: 0.50, y: 0.25 };
    expect(confirmsHit('nose', { x: 0.50, y: 0.25 }, { face })).toBe(true);
  });

  it('confirms a slightly-sloppy touch a little off the knee', () => {
    expect(confirmsHit('left_knee', { x: 0.47, y: 0.82 })).toBe(true);
  });

  it('still confirms a correct touch on the stricter hard level', () => {
    expect(confirmsHit('left_knee', { x: 0.45, y: 0.80 }, {}, 3)).toBe(true);
  });
});
