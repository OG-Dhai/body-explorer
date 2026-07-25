// Decides whether a hand is really touching the asked-for body part. The touch
// point is the child's fingertip from the Hand Landmarker (21 points per hand),
// not the coarse wrist read off the body skeleton that used to cause misses.
//
// How a hit is decided (tunables in CONFIG.detection.hit):
//  - Everything is compared in normalized image space, divided by shoulder
//    width so tolerances scale with the child's distance from the camera.
//  - Targets come from the Face Landmarker for face parts and the Pose
//    Landmarker for body parts.
//  - Nearest-part: the asked part has to be the closest candidate, or the touch
//    is rejected instead of counted.
//  - A wrist target can't be completed by its own hand; only the other hand counts.
//
// Pure module: reads one frame and returns a summary. Hold timing lives in
// HoldDetector, the game flow in GameEngine.

// Fingers a child actually points/touches with. Any of them may register.
const FINGERTIPS = [8, 4, 12]; // index tip, thumb tip, middle tip
const HAND_WRIST = 0;

const LEFT_SHOULDER = 11;
const RIGHT_SHOULDER = 12;
const LEFT_WRIST = 15;
const RIGHT_WRIST = 16;

// Precise Face-Landmarker points for each face part (mirrored selfie space, so
// "left" matches the child's left as they see themselves).
const FACE_TARGET_POINTS = Object.freeze({
  nose: [1, 4],
  left_eye: [362, 385, 387, 263, 373, 380],
  right_eye: [33, 160, 158, 133, 153, 144],
  left_ear: [454, 323, 356],
  right_ear: [234, 93, 127],
  mouth: [61, 78, 191, 291, 308, 415],
});

const FALLBACK_SHOULDER_SCALE = 0.25; // normalized image units, if shoulders missing

function dist2D(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

function shoulderScale(pose) {
  const ls = pose?.[LEFT_SHOULDER];
  const rs = pose?.[RIGHT_SHOULDER];
  if (!ls || !rs) return FALLBACK_SHOULDER_SCALE;
  const w = dist2D(ls, rs);
  return w > 1e-3 ? w : FALLBACK_SHOULDER_SCALE;
}

/** Head width, cheek to cheek, from the face mesh. The scale for face-part hits. */
function faceWidth(face) {
  if (!face) return null;
  const right = face[234];
  const left = face[454];
  if (!right || !left) return null;
  const w = dist2D(right, left);
  return w > 1e-3 ? w : null;
}

function isFacePart(partId) {
  return Boolean(FACE_TARGET_POINTS[partId]);
}

/** Image-space target points for a part: precise face points when available, else pose. */
function targetPointsFor(partId, pose, face, targetMap) {
  const faceIndices = face ? FACE_TARGET_POINTS[partId] : null;
  if (faceIndices) {
    const points = faceIndices.map((i) => face[i]).filter(Boolean);
    if (points.length) return points;
  }
  const spec = targetMap[partId];
  const points = (spec?.indices ?? []).map((i) => pose?.[i]).filter(Boolean);
  if (spec?.centroid && points.length) {
    // One centre point (chest = midpoint of the shoulders), so the child has to
    // touch the middle, not just one of the joints.
    let cx = points.reduce((sum, p) => sum + p.x, 0) / points.length;
    let cy = points.reduce((sum, p) => sum + p.y, 0) / points.length;
    // Pull the centre down toward the hips a bit, since the chest sits below the
    // shoulders where kids actually touch.
    const lowerBy = spec.centroidLowerBy ?? 0;
    const leftHip = pose?.[23];
    const rightHip = pose?.[24];
    if (lowerBy && leftHip && rightHip) {
      cx += ((leftHip.x + rightHip.x) / 2 - cx) * lowerBy;
      cy += ((leftHip.y + rightHip.y) / 2 - cy) * lowerBy;
    }
    return [{ x: cx, y: cy }];
  }
  return points;
}

// Smallest normalized distance from a point to any of a part's target points.
// Face parts are close together, so they use face width instead of shoulder
// width. Otherwise the eyes, nose and mouth all land in one radius and can't be
// told apart.
function pointToPart(point, partId, pose, face, targetMap, bodyScale, headWidth) {
  const scale = (headWidth && isFacePart(partId)) ? headWidth : bodyScale;
  const targets = targetPointsFor(partId, pose, face, targetMap);
  let min = Infinity;
  for (const t of targets) {
    const d = dist2D(point, t) / scale;
    if (d < min) min = d;
  }
  return min;
}

/** Is this part a single-wrist target? Returns its pose wrist index, or null. */
function wristTargetIndex(partId, targetMap) {
  const indices = targetMap[partId]?.indices ?? [];
  if (indices.length !== 1) return null;
  return indices[0] === LEFT_WRIST || indices[0] === RIGHT_WRIST ? indices[0] : null;
}

/** Collect candidate fingertips from all hands (respecting wrist self-exclusion). */
function collectFingertips(hands, pose, ownWristIndex, scale) {
  const ownWrist = ownWristIndex != null ? pose?.[ownWristIndex] : null;

  // For a wrist target, exclude only the hand attached to that wrist (the one
  // whose own wrist sits on the target). Just that one hand, not every hand
  // nearby, so the other hand can do the touching even when the two hands are
  // close together during a wrist touch.
  let excludedHand = null;
  if (ownWrist) {
    let nearest = Infinity;
    for (const hand of hands) {
      const handWrist = hand?.[HAND_WRIST];
      if (!handWrist) continue;
      const d = dist2D(handWrist, ownWrist) / scale;
      if (d < nearest) {
        nearest = d;
        excludedHand = hand;
      }
    }
    // Only treat it as the "own" hand if its wrist is genuinely on the target.
    if (nearest > 0.45) excludedHand = null;
  }

  const candidates = [];
  for (const hand of hands) {
    if (!hand || hand.length < 21 || hand === excludedHand) continue;
    for (const tip of FINGERTIPS) {
      if (hand[tip]) candidates.push({ point: hand[tip], hand });
    }
  }
  return candidates;
}

/**
 * @param {{ pose: Array|null, hands: Array, face: Array|null }} frame
 * @param {{ id: string, indices: number[] }} question
 * @param {Object} targetMap  CONFIG.targetMap
 * @param {Object} cfg        CONFIG.detection.hit
 * @returns {{ score: number|null, nearestScore: number|null, isAskedNearest: boolean,
 *            nearestPartId: string|null, handVisible: boolean }}
 */
export function evaluateHit(frame, question, targetMap, cfg) {
  const { nearestMargin } = cfg;
  const pose = frame.pose;
  const face = frame.face ?? null;
  const hands = frame.hands ?? [];
  const askedId = question.id;

  const noHand = { score: null, nearestScore: null, isAskedNearest: false, nearestPartId: null, handVisible: false };
  if (!pose || hands.length === 0) return noHand;

  const scale = shoulderScale(pose);
  const headWidth = faceWidth(face); // null when no face is tracked
  const ownWristIndex = wristTargetIndex(askedId, targetMap);
  const candidates = collectFingertips(hands, pose, ownWristIndex, scale);
  if (candidates.length === 0) return noHand;

  // Acting fingertip = the candidate closest to the asked part.
  let acting = null;
  let askedScore = Infinity;
  for (const candidate of candidates) {
    const d = pointToPart(candidate.point, askedId, pose, face, targetMap, scale, headWidth);
    if (d < askedScore) {
      askedScore = d;
      acting = candidate;
    }
  }
  if (!acting || !Number.isFinite(askedScore)) return { ...noHand, handVisible: true };

  // Which candidate part is that fingertip actually nearest to?
  let nearestPartId = askedId;
  let nearestScore = askedScore;
  for (const id of Object.keys(targetMap)) {
    if (id === askedId) continue;
    const d = pointToPart(acting.point, id, pose, face, targetMap, scale, headWidth);
    if (d < nearestScore) {
      nearestScore = d;
      nearestPartId = id;
    }
  }

  const isAskedNearest = askedScore <= nearestScore + nearestMargin;

  return { score: askedScore, nearestScore, isAskedNearest, nearestPartId, handVisible: true };
}
