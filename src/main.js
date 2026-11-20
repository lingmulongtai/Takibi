import { QUALITY_PRESETS, MOOD_PRESETS, DEFAULT_STATE } from './config.js';
import { TakibiPipeline } from './graphics/pipeline.js';
import { SoundscapeController } from './audio/soundscape.js';
import { InteractionController } from './ui/interaction.js';
import { ControlsController } from './ui/controls.js';

function showFallbackError(message) {
  const fallback = document.getElementById('webgl-fallback');
  const msgEl = document.getElementById('fallback-message');
  const prompt = document.getElementById('sound-prompt');
  if (msgEl && message) msgEl.textContent = message;
  if (fallback) fallback.hidden = false;
  if (prompt) prompt.hidden = true;
}

/**
 * Multi-harmonic organic flame flicker envelope driving both
 * sand/wood lighting and low-frequency combustion roar.
 */
function evaluateFireFlicker(time) {
  const slow = Math.sin(time * 1.35) * 0.065 + Math.sin(time * 2.41 + 0.8) * 0.055;
  const mid = Math.sin(time * 5.73 + 1.9) * 0.05 + Math.sin(time * 9.17 + 0.3) * 0.038;
  const fast = Math.sin(time * 16.4 + 2.7) * 0.024 + Math.sin(time * 24.9) * 0.015;
  return 1.0 + slow + mid + fast;
}

function bootstrap() {
  const canvas = document.getElementById('takibi-canvas');
  if (!canvas) return;

  let quality = QUALITY_PRESETS[DEFAULT_STATE.quality];
  let mood = MOOD_PRESETS[DEFAULT_STATE.mood];

  let pipeline;
  try {
    pipeline = new TakibiPipeline(canvas, quality, mood);
  } catch (err) {
    console.error('[Takibi Init Error]', err);
    showFallbackError(err instanceof Error ? err.message : String(err));
    return;
  }

  const soundscape = new SoundscapeController(DEFAULT_STATE.volumes);

  let stokeEnergy = 0;

  const triggerStoke = () => {
    stokeEnergy = Math.min(1.0, stokeEnergy + 0.68);
    pipeline.triggerSparkBurst(34, true);
    soundscape.triggerStoke();
  };

  // Sync audible driftwood pops directly to rising 3D glowing spark showers
  soundscape.onCracklePop((popAmp) => {
    const count = 4 + Math.round(popAmp * 9);
    pipeline.triggerSparkBurst(count, popAmp > 0.78);
    stokeEnergy = Math.min(1.0, stokeEnergy + popAmp * 0.08);
  });

  const enableSound = async () => {
    try {
      await soundscape.unlock();
      controls.setSoundState({ unlocked: true, muted: soundscape.muted });
    } catch (err) {
      console.warn('[Takibi Audio Unlock Failed]', err);
    }
  };

  const toggleSound = async () => {
    if (!soundscape.unlocked) {
      await enableSound();
      return;
    }
    const muted = soundscape.toggleMute();
    controls.setSoundState({ unlocked: true, muted });
  };

  const controls = new ControlsController(DEFAULT_STATE, {
    onEnableSound: enableSound,
    onToggleSound: toggleSound,
    onStoke: triggerStoke,
    onVolumeChange: (channel, val) => soundscape.setVolume(channel, val),
    onMoodChange: (moodId) => {
      if (MOOD_PRESETS[moodId]) {
        mood = MOOD_PRESETS[moodId];
        pipeline.setMood(mood);
      }
    },
    onQualityChange: (qualityId) => {
      if (QUALITY_PRESETS[qualityId]) {
        quality = QUALITY_PRESETS[qualityId];
        pipeline.setQuality(quality);
        controls.setResolutionReadout(quality.label, pipeline.renderWidth, pipeline.renderHeight);
      }
    },
  });

  controls.setResolutionReadout(quality.label, pipeline.renderWidth, pipeline.renderHeight);

  const interaction = new InteractionController(canvas, {
    onUserActivity: () => controls.notifyActivity(),
    onCanvasTap: ({ nearFire }) => {
      if (!soundscape.unlocked) {
        enableSound();
        if (nearFire) triggerStoke();
        return;
      }
      if (nearFire) {
        triggerStoke();
      }
    },
    onStoke: triggerStoke,
    onToggleSound: toggleSound,
    onToggleFullscreen: () => controls.toggleFullscreen(),
    onToggleZen: () => controls.toggleZen(),
  });

  const handleResize = () => {
    const dims = pipeline.resize();
    controls.setResolutionReadout(quality.label, dims.renderW, dims.renderH);
  };

  window.addEventListener('resize', handleResize);
  if (typeof ResizeObserver !== 'undefined') {
    const ro = new ResizeObserver(handleResize);
    ro.observe(canvas);
  }

  let startTime = performance.now();
  let lastTime = startTime;
  let audioSyncAcc = 0;

  function frame(now) {
    const dt = Math.min(0.05, Math.max(0.001, (now - lastTime) * 0.001));
    lastTime = now;
    const elapsed = (now - startTime) * 0.001;

    // Smooth exponential decay of manual stoke boost
    stokeEnergy *= Math.exp(-dt * 0.72);
    if (stokeEnergy < 0.001) stokeEnergy = 0;

    const fireFlicker = evaluateFireFlicker(elapsed);
    const cameraOffset = interaction.update(dt);

    pipeline.render({
      time: elapsed,
      dt,
      cameraOffset,
      stoke: stokeEnergy,
      fireFlicker,
    });

    // Update audio combustion coupling at ~20Hz to keep Web Audio automation lightweight
    audioSyncAcc += dt;
    if (audioSyncAcc >= 0.05) {
      soundscape.updateVisualCoupling(fireFlicker, stokeEnergy);
      audioSyncAcc = 0;
    }

    window.requestAnimationFrame(frame);
  }

  window.requestAnimationFrame(frame);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrap, { once: true });
} else {
  bootstrap();
}
