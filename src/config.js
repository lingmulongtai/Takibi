export const QUALITY_PRESETS = {
  ultra: {
    id: 'ultra',
    label: 'Ultra',
    dprCap: 2.0,
    resolutionScale: 1.0,
    maxPixels: 2_600_000,
    sceneSteps: 64,
    fireSteps: 44,
    shadowSteps: 20,
    sparkCount: 200,
    bloomPasses: 4,
    sharpen: 0.35,
    targetFps: 60,
  },
  high: {
    id: 'high',
    label: 'High',
    dprCap: 1.5,
    resolutionScale: 0.9,
    maxPixels: 1_550_000,
    sceneSteps: 52,
    fireSteps: 36,
    shadowSteps: 16,
    sparkCount: 160,
    bloomPasses: 4,
    sharpen: 0.52,
    targetFps: 60,
  },
  balanced: {
    id: 'balanced',
    label: 'Balanced',
    dprCap: 1.25,
    resolutionScale: 0.78,
    maxPixels: 950_000,
    sceneSteps: 40,
    fireSteps: 28,
    shadowSteps: 12,
    sparkCount: 110,
    bloomPasses: 3,
    sharpen: 0.62,
    targetFps: 45,
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
  quality: 'high',
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
