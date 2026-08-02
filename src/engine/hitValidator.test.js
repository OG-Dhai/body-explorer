import { describe, expect, it } from 'vitest';

import { CONFIG } from '../core/config.js';
import { evaluateHit } from './hitValidator.js';

const HIT = CONFIG.detection.hit;

// Pose image landmarks (normalized 0..1). Shoulders 0.20 apart set the scale.
// Unplaced joints sit in a corner so they can't interfere.
function makePose(overrides = {}) {
  const pose = Array.from({ length: 33 }, () => ({ x: 0.95, y: 0.95, visibility: 1, presence: 1 }));
  const base = {
    11: { x: 0.40, y: 0.40 }, 12: { x: 0.60, y: 0.40 }, // shoulders (scale = 0.20)
    0: { x: 0.50, y: 0.25 },                             // nose
    2: { x: 0.47, y: 0.23 }, 5: { x: 0.53, y: 0.23 },    // eyes
    7: { x: 0.44, y: 0.25 }, 8: { x: 0.56, y: 0.25 },    // ears
    15: { x: 0.30, y: 0.55 }, 16: { x: 0.70, y: 0.55 },  // wrists
    23: { x: 0.44, y: 0.65 }, 24: { x: 0.56, y: 0.65 },  // hips
    25: { x: 0.45, y: 0.80 }, 26: { x: 0.55, y: 0.80 },  // knees
  };
  for (const [i, p] of Object.entries({ ...base, ...overrides })) {
    pose[i] = { ...p, visibility: 1, presence: 1 };
  }
  return pose;
}

// A hand with its index/thumb/middle tips together at `tip` and wrist at `wrist`.
function makeHand(tip, wrist = { x: 0.5, y: 0.5 }) {
  const hand = Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  hand[0] = { ...wrist, z: 0 };
  for (const t of [4, 8, 12]) hand[t] = { ...tip, z: 0 };
  return hand;
}

// A face mesh with cheeks (which set face width) and each face part placed at an
// anatomical spot, so eyes/nose/mouth are distinguishable.
function makeFace() {
  const face = Array.from({ length: 478 }, () => ({ x: 0.95, y: 0.95 }));
  const place = (indices, pos) => { for (const i of indices) face[i] = { ...pos }; };
  place([234, 93, 127], { x: 0.42, y: 0.25 });                 // right cheek/ear
  place([454, 323, 356], { x: 0.58, y: 0.25 });                // left cheek/ear (face width = 0.16)
  place([1, 4], { x: 0.50, y: 0.27 });                         // nose
  place([61, 78, 191, 291, 308, 415], { x: 0.50, y: 0.32 });   // mouth
  place([362, 385, 387, 263, 373, 380], { x: 0.535, y: 0.23 }); // left eye
  place([33, 160, 158, 133, 153, 144], { x: 0.465, y: 0.23 });  // right eye
  return face;
}

const question = (id) => ({ id, indices: CONFIG.targetMap[id].indices });

describe('evaluateHit (fingertip)', () => {
  it('confirms a fingertip on a body part', () => {
    const frame = { pose: makePose(), hands: [makeHand({ x: 0.45, y: 0.80 })], face: null };
    const r = evaluateHit(frame, question('left_knee'), CONFIG.targetMap, HIT);
    expect(r.handVisible).toBe(true);
    expect(r.isAskedNearest).toBe(true);
    expect(r.score).toBeLessThan(HIT.contactRadius);
  });

  it('rejects a fingertip far from the part', () => {
    const frame = { pose: makePose(), hands: [makeHand({ x: 0.90, y: 0.15 })], face: null };
    const r = evaluateHit(frame, question('left_knee'), CONFIG.targetMap, HIT);
    expect(r.score).toBeGreaterThan(HIT.baseRadius);
  });

  it('flags the actual part when the finger is on the wrong one', () => {
    // Finger on the right knee, asked for the left knee.
    const frame = { pose: makePose(), hands: [makeHand({ x: 0.55, y: 0.80 })], face: null };
    const r = evaluateHit(frame, question('left_knee'), CONFIG.targetMap, HIT);
    expect(r.isAskedNearest).toBe(false);
    expect(r.nearestPartId).toBe('right_knee');
  });

  it('returns no touch when there are no hands', () => {
    const frame = { pose: makePose(), hands: [], face: null };
    const r = evaluateHit(frame, question('left_knee'), CONFIG.targetMap, HIT);
    expect(r.handVisible).toBe(false);
    expect(r.score).toBeNull();
  });

  it('uses precise face points for a face target', () => {
    const face = Array.from({ length: 478 }, () => ({ x: 0.95, y: 0.95 }));
    face[1] = { x: 0.50, y: 0.25 };
    face[4] = { x: 0.50, y: 0.25 }; // nose face points
    const frame = { pose: makePose(), hands: [makeHand({ x: 0.50, y: 0.25 })], face };
    const r = evaluateHit(frame, question('nose'), CONFIG.targetMap, HIT);
    expect(r.isAskedNearest).toBe(true);
    expect(r.score).toBeLessThan(HIT.contactRadius);
  });

  it('does not let a wrist be completed by its own hand', () => {
    // The only hand's wrist sits on the left-wrist target → excluded.
    const frame = { pose: makePose(), hands: [makeHand({ x: 0.30, y: 0.55 }, { x: 0.30, y: 0.55 })], face: null };
    const r = evaluateHit(frame, question('left_wrist'), CONFIG.targetMap, HIT);
    expect(r.handVisible).toBe(false);
    expect(r.score).toBeNull();
  });

  it('accepts a wrist touched by the opposite hand', () => {
    // The hand's wrist is on the right; its fingertip reaches the left-wrist target.
    const frame = { pose: makePose(), hands: [makeHand({ x: 0.30, y: 0.55 }, { x: 0.70, y: 0.55 })], face: null };
    const r = evaluateHit(frame, question('left_wrist'), CONFIG.targetMap, HIT);
    expect(r.isAskedNearest).toBe(true);
    expect(r.score).toBeLessThan(HIT.contactRadius);
  });

  it('accepts a wrist touch when both hands are close together', () => {
    // The real case: the left (own) hand sits on the left wrist, and the right
    // hand reaches in to touch it, so the two hands are near each other. Only
    // the own hand is excluded; the touching hand still counts.
    const ownHand = makeHand({ x: 0.30, y: 0.55 }, { x: 0.30, y: 0.55 }); // on the wrist
    const touchingHand = makeHand({ x: 0.30, y: 0.55 }, { x: 0.45, y: 0.55 }); // fingertip on it, wrist nearby
    const frame = { pose: makePose(), hands: [ownHand, touchingHand], face: null };
    const r = evaluateHit(frame, question('left_wrist'), CONFIG.targetMap, HIT);
    expect(r.isAskedNearest).toBe(true);
    expect(r.score).toBeLessThan(HIT.contactRadius);
  });

});

describe('evaluateHit: face parts are distinguished (face-width scale)', () => {
  it('confirms the nose when the finger is on the nose', () => {
    const frame = { pose: makePose(), hands: [makeHand({ x: 0.50, y: 0.27 })], face: makeFace() };
    const r = evaluateHit(frame, question('nose'), CONFIG.targetMap, HIT);
    expect(r.isAskedNearest).toBe(true);
    expect(r.score).toBeLessThan(HIT.contactRadius);
  });

  it('does NOT confirm the mouth when the finger is on the nose', () => {
    const frame = { pose: makePose(), hands: [makeHand({ x: 0.50, y: 0.27 })], face: makeFace() };
    const r = evaluateHit(frame, question('mouth'), CONFIG.targetMap, HIT);
    expect(r.isAskedNearest).toBe(false);
    expect(r.nearestPartId).toBe('nose');
  });

  it('does NOT confirm the left eye when the finger is on the right eye', () => {
    const frame = { pose: makePose(), hands: [makeHand({ x: 0.465, y: 0.23 })], face: makeFace() };
    const r = evaluateHit(frame, question('left_eye'), CONFIG.targetMap, HIT);
    expect(r.isAskedNearest).toBe(false);
    expect(r.nearestPartId).toBe('right_eye');
  });
});

describe('evaluateHit: chest is the centre, not the shoulders', () => {
  it('confirms the chest at its centre (below the shoulder line)', () => {
    // Shoulders y=0.40, hips y=0.65 → chest centre pulled 30% down ≈ (0.50, 0.475).
    const frame = { pose: makePose(), hands: [makeHand({ x: 0.50, y: 0.475 })], face: null };
    const r = evaluateHit(frame, question('chest'), CONFIG.targetMap, HIT);
    expect(r.isAskedNearest).toBe(true);
    expect(r.score).toBeLessThan(HIT.contactRadius);
  });

  it('does NOT confirm the chest when the finger is on a shoulder', () => {
    const frame = { pose: makePose(), hands: [makeHand({ x: 0.40, y: 0.40 })], face: null };
    const r = evaluateHit(frame, question('chest'), CONFIG.targetMap, HIT);
    expect(r.isAskedNearest).toBe(false);
    expect(r.nearestPartId).toBe('left_shoulder');
  });

  it('confirms the shoulder when the finger is on the shoulder', () => {
    const frame = { pose: makePose(), hands: [makeHand({ x: 0.40, y: 0.40 })], face: null };
    const r = evaluateHit(frame, question('left_shoulder'), CONFIG.targetMap, HIT);
    expect(r.isAskedNearest).toBe(true);
    expect(r.score).toBeLessThan(HIT.contactRadius);
  });
});
