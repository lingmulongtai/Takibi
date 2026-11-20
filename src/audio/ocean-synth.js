/**
 * Infinite procedural coastal twilight surf synthesizer.
 * Blends a soft distant ocean horizon bed with individually scheduled organic rolling
 * swells (gentle rise -> airy frothy crest break -> receding wet sand wash).
 */
export class OceanSynthesizer {
  constructor(ctx, pinkBuffer, destination) {
    this.ctx = ctx;
    this.pinkBuffer = pinkBuffer;
    this.destination = destination;
    this.level = 0.38;
    this.running = false;
    this.timerId = null;
    this.nextWaveTime = 0;

    this.bus = ctx.createGain();
    this.bus.gain.value = this.level;
    this.bus.connect(destination);

    // Keep surf warm, soft, and distant behind the campfire
    this.masterLP = ctx.createBiquadFilter();
    this.masterLP.type = 'lowpass';
    this.masterLP.frequency.value = 3400;
    this.masterLP.Q.value = 0.5;
    this.masterLP.connect(this.bus);

    this.masterHP = ctx.createBiquadFilter();
    this.masterHP.type = 'highpass';
    this.masterHP.frequency.value = 55;
    this.masterHP.connect(this.masterLP);

    // Continuous subtle far-sea ambient bed
    this.bedSrc = ctx.createBufferSource();
    this.bedSrc.buffer = pinkBuffer;
    this.bedSrc.loop = true;

    this.bedFilter = ctx.createBiquadFilter();
    this.bedFilter.type = 'lowpass';
    this.bedFilter.frequency.value = 260;

    this.bedGain = ctx.createGain();
    this.bedGain.gain.value = 0.24;

    this.bedSrc.connect(this.bedFilter);
    this.bedFilter.connect(this.bedGain);
    this.bedGain.connect(this.masterHP);
  }

  start() {
    if (this.running) return;
    this.running = true;
    const now = this.ctx.currentTime;
    this.bedSrc.start(now, Math.random() * 6);

    // Schedule first wave gently right away
    this._spawnWave(now + 0.35);
    this.nextWaveTime = now + 5.6 + Math.random() * 3.2;

    this.timerId = window.setInterval(() => this._scheduleWaves(), 650);
  }

  setVolume(v) {
    this.level = Math.max(0, Math.min(1, v));
    this.bus.gain.setTargetAtTime(this.level, this.ctx.currentTime, 0.12);
  }

  _scheduleWaves() {
    if (!this.running || this.ctx.state !== 'running') return;
    const horizon = this.ctx.currentTime + 1.8;

    while (this.nextWaveTime < horizon) {
      this._spawnWave(this.nextWaveTime);
      this.nextWaveTime += 6.2 + Math.random() * 5.2;
    }
  }

  _spawnWave(startTime) {
    const ctx = this.ctx;
    const swellDur = 2.3 + Math.random() * 1.4;
    const crestDur = 0.85 + Math.random() * 0.65;
    const washDur = 3.8 + Math.random() * 2.4;
    const totalDur = swellDur + crestDur + washDur;

    const src = ctx.createBufferSource();
    src.buffer = this.pinkBuffer;
    src.loop = true;
    src.playbackRate.value = 0.86 + Math.random() * 0.24;

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 0.65;

    const peakFreq = 920 + Math.random() * 720;
    filter.frequency.setValueAtTime(160, startTime);
    filter.frequency.exponentialRampToValueAtTime(420, startTime + swellDur);
    filter.frequency.exponentialRampToValueAtTime(peakFreq, startTime + swellDur + crestDur);
    filter.frequency.exponentialRampToValueAtTime(150, startTime + totalDur);

    const env = ctx.createGain();
    const peakGain = 0.22 + Math.random() * 0.16;
    env.gain.setValueAtTime(0.0001, startTime);
    env.gain.linearRampToValueAtTime(peakGain * 0.55, startTime + swellDur);
    env.gain.linearRampToValueAtTime(peakGain, startTime + swellDur + crestDur * 0.65);
    env.gain.exponentialRampToValueAtTime(0.0008, startTime + totalDur);

    // Gently pan the breaking wave slightly across the wide beach shoreline
    const panner = ctx.createStereoPanner();
    const startPan = (Math.random() - 0.5) * 0.68;
    const endPan = Math.max(-0.55, Math.min(0.55, startPan + (Math.random() - 0.5) * 0.5));
    panner.pan.setValueAtTime(startPan, startTime);
    panner.pan.linearRampToValueAtTime(endPan, startTime + totalDur);

    src.connect(filter);
    filter.connect(env);
    env.connect(panner);
    panner.connect(this.masterHP);

    src.start(startTime, Math.random() * 8);
    src.stop(startTime + totalDur + 0.15);
  }

  destroy() {
    this.running = false;
    if (this.timerId) {
      window.clearInterval(this.timerId);
      this.timerId = null;
    }
    try {
      this.bedSrc.stop();
    } catch {
      // Ignore already stopped source
    }
  }
}
