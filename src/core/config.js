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
        thresholdMultiplier: 1.3,
        instructionDelay: 2000,
        questionTimeout: 15000,
        comboRequirement: 0,
      },
      2: {
        name: 'medium',
        questionsPerRound: 6,
        holdDuration: 1000,
        thresholdMultiplier: 1.0,
        instructionDelay: 1500,
        questionTimeout: 12000,
        comboRequirement: 0,
      },
      3: {
        name: 'hard',
        questionsPerRound: 7,
        holdDuration: 700,
        thresholdMultiplier: 0.75,
        instructionDelay: 1000,
        questionTimeout: 8000,
        comboRequirement: 3,
      }
    }
  },
  targetMap: {
    head:           { indices: [0, 7, 8], difficulty: 'easy' },
    chest:          { indices: [11, 12], difficulty: 'easy' }, // Shoulder midpoint is more stable than hips
    nose:           { indices: [0], difficulty: 'easy', thresholdMultiplier: 1.8 },
    hips:           { indices: [23, 24], difficulty: 'easy' },
    left_shoulder:  { indices: [11], difficulty: 'advanced' },
    right_shoulder: { indices: [12], difficulty: 'advanced' },
    left_elbow:     { indices: [13], difficulty: 'advanced' },
    right_elbow:    { indices: [14], difficulty: 'advanced' },
    left_knee:      { indices: [25], difficulty: 'advanced' },
    right_knee:     { indices: [26], difficulty: 'advanced' },
    left_hip:       { indices: [23], difficulty: 'normal' },
    right_hip:      { indices: [24], difficulty: 'normal' },
    left_wrist:     { indices: [15], difficulty: 'advanced' },
    right_wrist:    { indices: [16], difficulty: 'advanced' },
    left_ankle:     { indices: [27], difficulty: 'advanced' },
    right_ankle:    { indices: [28], difficulty: 'advanced' },
    left_ear:       { indices: [7], difficulty: 'normal', thresholdMultiplier: 1.8 },
    right_ear:      { indices: [8], difficulty: 'normal', thresholdMultiplier: 1.8 },
    mouth:          { indices: [9, 10], difficulty: 'easy', thresholdMultiplier: 1.8 },
    left_eye:       { indices: [2], difficulty: 'normal', thresholdMultiplier: 1.8 },
    right_eye:      { indices: [5], difficulty: 'normal', thresholdMultiplier: 1.8 },
    left_foot:      { indices: [29, 31], difficulty: 'normal' },
    right_foot:     { indices: [30, 32], difficulty: 'normal' }
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
