export const QUALITY_PRESETS = {
  ultra: {
    id: 'ultra',
    label: 'Ultra',
    dprCap: 2.0,
    resolutionScale: 1.0,
    sceneSteps: 120,
    fireSteps: 84,
    shadowSteps: 28,
    sparkCount: 220,
    bloomPasses: 5,
  },
  high: {
    id: 'high',
    label: 'High',
    dprCap: 1.75,
    resolutionScale: 0.88,
    sceneSteps: 96,
    fireSteps: 64,
    shadowSteps: 22,
    sparkCount: 160,
    bloomPasses: 5,
  },
  balanced: {
    id: 'balanced',
    label: 'Balanced',
    dprCap: 1.5,
    resolutionScale: 0.72,
    sceneSteps: 72,
    fireSteps: 48,
    shadowSteps: 16,
    sparkCount: 110,
    bloomPasses: 4,
  },
};

/**
 * Twilight sky / atmosphere presets.
 * `twilight` matches the exact cool-blue + soft peach-pink coastal sunset reference.
 */
export const MOOD_PRESETS = {
  twilight: {
    id: 'twilight',
    label: '黄昏',
    skyExposure: 1.0,
    sunsetStrength: 1.0,
    ambientBoost: 1.0,
    fireGain: 1.0,
    starVisibility: 0.04,
  },
  bluehour: {
    id: 'bluehour',
    label: '藍時',
    skyExposure: 0.62,
    sunsetStrength: 0.42,
    ambientBoost: 0.66,
    fireGain: 1.12,
    starVisibility: 0.38,
  },
  night: {
    id: 'night',
    label: '夜更け',
    skyExposure: 0.24,
    sunsetStrength: 0.08,
    ambientBoost: 0.3,
    fireGain: 1.24,
    starVisibility: 1.0,
  },
};

export const DEFAULT_STATE = {
  quality: 'ultra',
  mood: 'twilight',
  soundEnabled: false,
  soundMuted: false,
  volumes: {
    fire: 0.82,
    crackle: 0.88,
    ocean: 0.38,
  },
  idleHideMs: 4200,
};
