export const CONFIG = {
  detection: {
    holdDuration: 1000, // Easy mode default (1.0s)
    proximityThreshold: 0.30,
    decayRate: 0.8,
    visibilityAverageWindowFrames: 10,
    visibilityHistoryFrames: 60,
    visibilityColdStartFrames: 30,
    visibilityColdStartDelayMs: 500,
    visibilityExclusionThreshold: 0.6,
    poseWorkerWatchdog: {
      coldStartTimeoutMs: 30000,
      steadyStateTimeoutMs: 3000,
    },
    // Hit validation tunables. Distances are in normalized image space,
    // divided by shoulder width so they scale with the child's distance from
    // the camera. See src/engine/hitValidator.js.
    hit: {
      // How close the fingertip has to get (times shoulder width) before the
      // hold timer starts.
      baseRadius: 0.45,
      // Must dip at least this close once, so a fingertip just passing through
      // never counts. Only a real touch does.
      contactRadius: 0.30,
      // The asked part has to be the nearest one, within this slack. Stops
      // "touched the eye, won the nose".
      nearestMargin: 0.12,
      // How long a hand can sit on the wrong part before we gently correct.
      wrongPartHoldMs: 500,
      // Loosen the radius a bit in low light. Not enough to let false wins back.
      lowLightRadiusScale: 1.10,
    },
  },
  game: {
    baseScore: 100,
    timeBonusFactor: 0.5,
    streakBonusFactor: 0.1,
    instructionDelay: 1500, // Wait 1.5s after instruction before detecting
    timing: {
      levelIntroDurationMs: 2000,
      instructionSafetyTimeoutMs: 5000,
      factNarrationLeadInMs: 250,
      factSafetyTimeoutMs: 6000,
      feedbackReadDurationMs: 2000,
      levelEndReadDurationMs: 4000,
      fastReactionWindowMs: 5000,
      fallbackFrameDeltaMs: 16
    },
    passThreshold: 0.6,
    levels: {
      1: {
        name: 'easy',
        questionsPerRound: 4,
        holdDuration: 1200,
        // Same hit tolerance on every level. Only the timing gets tighter.
        hitRadiusScale: 1.0,
        instructionDelay: 2000,
        questionTimeout: 15000,
        comboRequirement: 0,
      },
      2: {
        name: 'medium',
        questionsPerRound: 6,
        holdDuration: 1000,
        hitRadiusScale: 1.0, // same tolerance as Easy
        instructionDelay: 1500,
        questionTimeout: 12000,
        comboRequirement: 0,
      },
      3: {
        name: 'hard',
        questionsPerRound: 7,
        holdDuration: 700,
        hitRadiusScale: 1.0, // same tolerance as Easy
        instructionDelay: 1000,
        questionTimeout: 8000,
        comboRequirement: 3,
      }
    }
  },
  // Targets are grouped into three tiers in the order kids learn body parts
  // (research PMC4505369): face and head first, then torso, then limbs and the
  // fine joints last. easy = level 1, normal = level 2, advanced = level 3.
  // Tolerance is the same everywhere; the nearest-part check keeps the clustered
  // face parts from validating each other. Keep tier sizes at 5/8/10 so the
  // QuestionBank fallback still works.
  targetMap: {
    // Level 1 (easy): face and head
    head:           { indices: [0, 7, 8], difficulty: 'easy' },
    nose:           { indices: [0], difficulty: 'easy' },
    mouth:          { indices: [9, 10], difficulty: 'easy' },
    left_eye:       { indices: [2], difficulty: 'easy' },
    right_eye:      { indices: [5], difficulty: 'easy' },

    // Level 2 (normal): ears, torso, shoulders
    left_ear:       { indices: [7], difficulty: 'normal' },
    right_ear:      { indices: [8], difficulty: 'normal' },
    chest:          { indices: [11, 12], difficulty: 'normal', centroid: true, centroidLowerBy: 0.3 }, // shoulder midpoint pulled 30% toward the hips
    hips:           { indices: [23, 24], difficulty: 'normal' },
    left_hip:       { indices: [23], difficulty: 'normal' },
    right_hip:      { indices: [24], difficulty: 'normal' },
    left_shoulder:  { indices: [11], difficulty: 'normal' },
    right_shoulder: { indices: [12], difficulty: 'normal' },

    // Level 3 (advanced): hands, feet, fine joints
    left_wrist:     { indices: [15], difficulty: 'advanced' },
    right_wrist:    { indices: [16], difficulty: 'advanced' },
    left_foot:      { indices: [29, 31], difficulty: 'advanced' },
    right_foot:     { indices: [30, 32], difficulty: 'advanced' },
    left_elbow:     { indices: [13], difficulty: 'advanced' },
    right_elbow:    { indices: [14], difficulty: 'advanced' },
    left_knee:      { indices: [25], difficulty: 'advanced' },
    right_knee:     { indices: [26], difficulty: 'advanced' },
    left_ankle:     { indices: [27], difficulty: 'advanced' },
    right_ankle:    { indices: [28], difficulty: 'advanced' }
  }
};

// Apply lightweight demo mode overrides when ?demo=true query param is active
if (typeof window !== 'undefined') {
  const urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('demo') === 'true') {
    Object.keys(CONFIG.game.levels).forEach(level => {
      CONFIG.game.levels[level].questionsPerRound = 2;
    });
  }
}
