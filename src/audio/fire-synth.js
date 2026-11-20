import { createCrackleImpulsePool } from './noise-buffers.js';

/**
 * Infinite procedural campfire synthesizer:
 * 1. Deep warm flame combustion rumble / roar (coupled to real-time visual flame flicker)
 * 2. Soft resin/sap sizzle & ember hiss
 * 3. Lookahead clustered Poisson crackle, tick, and driftwood pop generator
 */
export class FireSynthesizer {
  constructor(ctx, brownBuffer, pinkBuffer, destination) {
    this.ctx = ctx;
    this.destination = destination;
    this.impulses = createCrackleImpulsePool(ctx);

    this.fireLevel = 0.82;
    this.crackleLevel = 0.88;
    this.running = false;
    this.timerId = null;
    this.nextEventTime = 0;
    this.onPopCallback = null;

    // Master sub-buses
    this.fireBus = ctx.createGain();
    this.fireBus.gain.value = this.fireLevel;
    this.fireBus.connect(destination);

    this.crackleBus = ctx.createGain();
    this.crackleBus.gain.value = this.crackleLevel;
    this.crackleBus.connect(destination);

    // Subtle warm room-air lowpass on crackles so they sit organically on the beach
    this.crackleTone = ctx.createBiquadFilter();
    this.crackleTone.type = 'lowpass';
    this.crackleTone.frequency.value = 8400;
    this.crackleTone.Q.value = 0.5;
    this.crackleTone.connect(this.crackleBus);

    // Subtle woody warmth shelf
    this.crackleBody = ctx.createBiquadFilter();
    this.crackleBody.type = 'highpass';
    this.crackleBody.frequency.value = 220;
    this.crackleBody.connect(this.crackleTone);

    this._buildContinuousLayers(brownBuffer, pinkBuffer);
  }

  _buildContinuousLayers(brownBuffer, pinkBuffer) {
    const ctx = this.ctx;

    // --- Layer 1A: Deep low-end flame rumble (65Hz .. 230Hz) ---
    this.rumbleSrc = ctx.createBufferSource();
    this.rumbleSrc.buffer = brownBuffer;
    this.rumbleSrc.loop = true;

    this.rumbleHP = ctx.createBiquadFilter();
    this.rumbleHP.type = 'highpass';
    this.rumbleHP.frequency.value = 42;

    this.rumbleLP = ctx.createBiquadFilter();
    this.rumbleLP.type = 'lowpass';
    this.rumbleLP.frequency.value = 185;
    this.rumbleLP.Q.value = 0.85;

    this.rumbleGain = ctx.createGain();
    this.rumbleGain.gain.value = 0.52;

    this.rumbleSrc.connect(this.rumbleHP);
    this.rumbleHP.connect(this.rumbleLP);
    this.rumbleLP.connect(this.rumbleGain);
    this.rumbleGain.connect(this.fireBus);

    // --- Layer 1B: Mid-warm licking flame air flutter (200Hz .. 620Hz) ---
    this.flameMidSrc = ctx.createBufferSource();
    this.flameMidSrc.buffer = pinkBuffer;
    this.flameMidSrc.loop = true;

    this.flameMidBP = ctx.createBiquadFilter();
    this.flameMidBP.type = 'bandpass';
    this.flameMidBP.frequency.value = 310;
    this.flameMidBP.Q.value = 0.95;

    this.flameMidGain = ctx.createGain();
    this.flameMidGain.gain.value = 0.14;

    this.flameMidSrc.connect(this.flameMidBP);
    this.flameMidBP.connect(this.flameMidGain);
    this.flameMidGain.connect(this.fireBus);

    // --- Layer 2: Delicate ember & sap hiss ("チリチリ… ジュワ…") ---
    this.hissSrc = ctx.createBufferSource();
    this.hissSrc.buffer = pinkBuffer;
    this.hissSrc.loop = true;
    this.hissSrc.playbackRate.value = 1.08;

    this.hissHP = ctx.createBiquadFilter();
    this.hissHP.type = 'highpass';
    this.hissHP.frequency.value = 2800;

    this.hissLP = ctx.createBiquadFilter();
    this.hissLP.type = 'lowpass';
    this.hissLP.frequency.value = 7600;

    this.hissGain = ctx.createGain();
    this.hissGain.gain.value = 0.032;

    this.hissSrc.connect(this.hissHP);
    this.hissHP.connect(this.hissLP);
    this.hissLP.connect(this.hissGain);
    this.hissGain.connect(this.crackleBus);

    // Organic slow LFOs breathing life into flame rumble & hiss
    this.lfo1 = ctx.createOscillator();
    this.lfo1.type = 'sine';
    this.lfo1.frequency.value = 0.29;
    this.lfo1Gain = ctx.createGain();
    this.lfo1Gain.gain.value = 42;
    this.lfo1.connect(this.lfo1Gain);
    this.lfo1Gain.connect(this.rumbleLP.frequency);

    this.lfo2 = ctx.createOscillator();
    this.lfo2.type = 'sine';
    this.lfo2.frequency.value = 0.17;
    this.lfo2Gain = ctx.createGain();
    this.lfo2Gain.gain.value = 0.012;
    this.lfo2.connect(this.lfo2Gain);
    this.lfo2Gain.connect(this.hissGain.gain);
  }

  start() {
    if (this.running) return;
    this.running = true;
    const now = this.ctx.currentTime;

    this.rumbleSrc.start(now, Math.random() * 5);
    this.flameMidSrc.start(now, Math.random() * 6);
    this.hissSrc.start(now, Math.random() * 7);
    this.lfo1.start(now);
    this.lfo2.start(now);

    this.nextEventTime = now + 0.08;
    this.timerId = window.setInterval(() => this._scheduleCrackles(), 80);
  }

  onPop(callback) {
    this.onPopCallback = callback;
  }

  setFireVolume(v) {
    this.fireLevel = Math.max(0, Math.min(1, v));
    this.fireBus.gain.setTargetAtTime(this.fireLevel, this.ctx.currentTime, 0.08);
  }

  setCrackleVolume(v) {
    this.crackleLevel = Math.max(0, Math.min(1, v));
    this.crackleBus.gain.setTargetAtTime(this.crackleLevel, this.ctx.currentTime, 0.08);
  }

  updateCoupling(fireFlicker, stoke) {
    if (!this.running) return;
    const now = this.ctx.currentTime;
    const flare = Math.max(0.65, Math.min(1.6, fireFlicker + stoke * 0.45));
    this.rumbleGain.gain.setTargetAtTime(0.46 * flare, now, 0.09);
    this.flameMidGain.gain.setTargetAtTime(0.11 * flare + stoke * 0.09, now, 0.09);
    this.flameMidBP.frequency.setTargetAtTime(280 + flare * 95 + stoke * 140, now, 0.12);
  }

  triggerStoke() {
    if (!this.running) return;
    const now = this.ctx.currentTime;

    // Warm flame whoosh & fresh flurry of lively driftwood crackles
    this.rumbleLP.frequency.setTargetAtTime(340, now, 0.08);
    this.rumbleLP.frequency.setTargetAtTime(185, now + 0.55, 0.45);

    const flurryCount = 7 + Math.floor(Math.random() * 5);
    let t = now + 0.03;
    for (let i = 0; i < flurryCount; i++) {
      const kind = i === 0 || Math.random() < 0.35 ? 'pop' : 'crackle';
      this._playImpulse(kind, t, 0.72 + Math.random() * 0.42);
      t += 0.032 + Math.random() * 0.095;
    }
  }

  _scheduleCrackles() {
    if (!this.running || this.ctx.state !== 'running') return;
    const horizon = this.ctx.currentTime + 0.24;

    while (this.nextEventTime < horizon) {
      const roll = Math.random();

      if (roll < 0.56) {
        // Delicate ember tick ("チリッ / ピチッ")
        this._playImpulse('tick', this.nextEventTime, 0.25 + Math.random() * 0.48);
        this.nextEventTime += 0.045 + Math.random() * 0.17;
      } else if (roll < 0.89) {
        // Crisp campfire crackle ("パチッ"), often arriving in natural 2..4 burst clusters!
        const cluster = Math.random() < 0.48 ? 2 + Math.floor(Math.random() * 3) : 1;
        let t = this.nextEventTime;
        for (let c = 0; c < cluster; c++) {
          const amp = (0.38 + Math.random() * 0.55) * (c === 0 ? 1.0 : 0.78);
          this._playImpulse(c > 0 && Math.random() < 0.4 ? 'tick' : 'crackle', t, amp);
          t += 0.022 + Math.random() * 0.072;
        }
        this.nextEventTime = t + 0.08 + Math.random() * 0.34;
      } else {
        // Satisfying deeper dry driftwood pop/snap ("バキッ / ポキッ")
        const popAmp = 0.58 + Math.random() * 0.42;
        this._playImpulse('pop', this.nextEventTime, popAmp);

        // Trigger visual spark burst synchronized to audible wood pop
        if (this.onPopCallback) {
          const delayMs = Math.max(0, (this.nextEventTime - this.ctx.currentTime) * 1000);
          window.setTimeout(() => {
            if (this.running && this.onPopCallback) {
              this.onPopCallback(popAmp);
            }
          }, delayMs);
        }

        // Occasional tiny trailing crackle right after a wood split
        if (Math.random() < 0.65) {
          this._playImpulse('crackle', this.nextEventTime + 0.038 + Math.random() * 0.05, 0.45);
        }
        this.nextEventTime += 0.22 + Math.random() * 0.68;
      }
    }
  }

  _playImpulse(kind, when, gainAmount) {
    const ctx = this.ctx;
    const bank =
      kind === 'pop'
        ? this.impulses.pops
        : kind === 'crackle'
          ? this.impulses.crackles
          : this.impulses.ticks;
    const buffer = bank[Math.floor(Math.random() * bank.length)];

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = 0.78 + Math.random() * 0.52;

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    if (kind === 'pop') {
      filter.frequency.value = 820 + Math.random() * 1450;
      filter.Q.value = 0.85 + Math.random() * 1.1;
    } else if (kind === 'crackle') {
      filter.frequency.value = 1900 + Math.random() * 3400;
      filter.Q.value = 0.7 + Math.random() * 1.3;
    } else {
      filter.frequency.value = 3400 + Math.random() * 4200;
      filter.Q.value = 0.9 + Math.random() * 1.4;
    }

    const gain = ctx.createGain();
    gain.gain.value = gainAmount * (kind === 'pop' ? 0.82 : kind === 'crackle' ? 0.68 : 0.44);

    // Subtle spatial positioning inside the campfire footprint (slightly wider for pops)
    const panner = ctx.createStereoPanner();
    const spread = kind === 'pop' ? 0.44 : 0.34;
    panner.pan.value = (Math.random() * 2 - 1) * spread;

    src.connect(filter);
    filter.connect(gain);
    gain.connect(panner);
    panner.connect(this.crackleBody);

    src.start(when);
  }

  destroy() {
    this.running = false;
    if (this.timerId) {
      window.clearInterval(this.timerId);
      this.timerId = null;
    }
    try {
      this.rumbleSrc.stop();
      this.flameMidSrc.stop();
      this.hissSrc.stop();
      this.lfo1.stop();
      this.lfo2.stop();
    } catch {
      // Ignore already stopped sources
    }
  }
}
