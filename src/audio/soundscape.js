import { createBrownNoiseBuffer, createPinkNoiseBuffer } from './noise-buffers.js';
import { FireSynthesizer } from './fire-synth.js';
import { OceanSynthesizer } from './ocean-synth.js';

/**
 * Master procedural beach-campfire soundscape controller.
 * Handles Web Audio autoplay unlock, soft master compression & warm mastering EQ,
 * click-free fade-ins/mutes, and real-time audio-visual synchronization hooks.
 */
export class SoundscapeController {
  constructor(initialVolumes) {
    this.volumes = { ...initialVolumes };
    this.ctx = null;
    this.masterGain = null;
    this.fireSynth = null;
    this.oceanSynth = null;
    this.unlocked = false;
    this.muted = false;
    this.popHandler = null;
  }

  onCracklePop(handler) {
    this.popHandler = handler;
    if (this.fireSynth) {
      this.fireSynth.onPop(handler);
    }
  }

  async unlock() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) {
        throw new Error('Web Audio API is unavailable in this browser.');
      }
      this.ctx = new AudioCtx();
      this._initGraph();
    }

    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }

    if (!this.unlocked) {
      this.unlocked = true;
      this.fireSynth.start();
      this.oceanSynth.start();
      // Velvety 1.2s fade-in so sound blooms warmly rather than snapping on
      const now = this.ctx.currentTime;
      this.masterGain.gain.cancelScheduledValues(now);
      this.masterGain.gain.setValueAtTime(0.0001, now);
      this.masterGain.gain.linearRampToValueAtTime(this.muted ? 0.0001 : 0.92, now + 1.25);
    }

    return true;
  }

  _initGraph() {
    const ctx = this.ctx;
    const brown = createBrownNoiseBuffer(ctx, 10);
    const pink = createPinkNoiseBuffer(ctx, 12);

    // Subtle mastering chain: gentle warm tilt + transparent glue compressor
    const warmth = ctx.createBiquadFilter();
    warmth.type = 'lowshelf';
    warmth.frequency.value = 180;
    warmth.gain.value = 2.4;

    const airSoften = ctx.createBiquadFilter();
    airSoften.type = 'highshelf';
    airSoften.frequency.value = 6500;
    airSoften.gain.value = -2.2;

    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -14;
    compressor.knee.value = 18;
    compressor.ratio.value = 3.2;
    compressor.attack.value = 0.008;
    compressor.release.value = 0.22;

    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = 0.0001;

    warmth.connect(airSoften);
    airSoften.connect(compressor);
    compressor.connect(this.masterGain);
    this.masterGain.connect(ctx.destination);

    this.fireSynth = new FireSynthesizer(ctx, brown, pink, warmth);
    this.fireSynth.setFireVolume(this.volumes.fire);
    this.fireSynth.setCrackleVolume(this.volumes.crackle);
    if (this.popHandler) {
      this.fireSynth.onPop(this.popHandler);
    }

    this.oceanSynth = new OceanSynthesizer(ctx, pink, warmth);
    this.oceanSynth.setVolume(this.volumes.ocean);
  }

  setMuted(muted) {
    this.muted = Boolean(muted);
    if (!this.ctx || !this.masterGain || !this.unlocked) return;
    const now = this.ctx.currentTime;
    const target = this.muted ? 0.0001 : 0.92;
    this.masterGain.gain.setTargetAtTime(target, now, 0.14);
  }

  toggleMute() {
    this.setMuted(!this.muted);
    return this.muted;
  }

  setVolume(channel, value) {
    const clamped = Math.max(0, Math.min(1, Number(value)));
    this.volumes[channel] = clamped;
    if (!this.unlocked) return;

    if (channel === 'fire' && this.fireSynth) {
      this.fireSynth.setFireVolume(clamped);
    } else if (channel === 'crackle' && this.fireSynth) {
      this.fireSynth.setCrackleVolume(clamped);
    } else if (channel === 'ocean' && this.oceanSynth) {
      this.oceanSynth.setVolume(clamped);
    }
  }

  updateVisualCoupling(fireFlicker, stoke) {
    if (this.fireSynth && this.unlocked && !this.muted) {
      this.fireSynth.updateCoupling(fireFlicker, stoke);
    }
  }

  triggerStoke() {
    if (this.fireSynth && this.unlocked && !this.muted) {
      this.fireSynth.triggerStoke();
    }
  }

  destroy() {
    if (this.fireSynth) this.fireSynth.destroy();
    if (this.oceanSynth) this.oceanSynth.destroy();
    if (this.ctx) {
      this.ctx.close().catch(() => {});
    }
  }
}
