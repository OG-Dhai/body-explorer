export const CONFIG = {
  detection: {
    confidenceSmoothing: 0.25,
    holdDuration: 1000, // Easy mode default (1.0s)
    proximityThreshold: 0.30,
    decayRate: 0.8,
  },
  game: {
    questionsPerRound: 5,
    baseScore: 100,
    timeBonusFactor: 0.5,
    instructionDelay: 1500, // Wait 1.5s after instruction before detecting
  },
  // MediaPipe Pose Landmarks
  landmarks: {
    NOSE: 0,
    LEFT_EYE_INNER: 1, LEFT_EYE: 2, LEFT_EYE_OUTER: 3,
    RIGHT_EYE_INNER: 4, RIGHT_EYE: 5, RIGHT_EYE_OUTER: 6,
    LEFT_EAR: 7, RIGHT_EAR: 8,
    MOUTH_LEFT: 9, MOUTH_RIGHT: 10,
    LEFT_SHOULDER: 11, RIGHT_SHOULDER: 12,
    LEFT_ELBOW: 13, RIGHT_ELBOW: 14,
    LEFT_WRIST: 15, RIGHT_WRIST: 16,
    LEFT_PINKY: 17, RIGHT_PINKY: 18,
    LEFT_INDEX: 19, RIGHT_INDEX: 20,
    LEFT_THUMB: 21, RIGHT_THUMB: 22,
    LEFT_HIP: 23, RIGHT_HIP: 24,
    LEFT_KNEE: 25, RIGHT_KNEE: 26,
    LEFT_ANKLE: 27, RIGHT_ANKLE: 28
  },
  targetMap: {
    head:           { indices: [0, 7, 8], difficulty: 'easy' },
    stomach:        { indices: [23, 24], difficulty: 'easy' }, // Roughly hips for torso area
    nose:           { indices: [0], difficulty: 'easy' },
    left_shoulder:  { indices: [11], difficulty: 'normal' },
    right_shoulder: { indices: [12], difficulty: 'normal' },
    left_elbow:     { indices: [13], difficulty: 'normal' },
    right_elbow:    { indices: [14], difficulty: 'normal' },
    left_knee:      { indices: [25], difficulty: 'normal' },
    right_knee:     { indices: [26], difficulty: 'normal' },
    left_ankle:     { indices: [27], difficulty: 'advanced' },
    right_ankle:    { indices: [28], difficulty: 'advanced' },
    left_ear:       { indices: [7], difficulty: 'advanced' },
    right_ear:      { indices: [8], difficulty: 'advanced' }
  }
};
