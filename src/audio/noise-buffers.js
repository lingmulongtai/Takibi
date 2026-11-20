/**
 * Procedural Web Audio buffer generators for seamless infinite noise beds
 * and physically-inspired wood crackle / pop micro-impulses.
 */

function crossfadeLoop(data, fadeSamples) {
  const len = data.length;
  for (let i = 0; i < fadeSamples; i++) {
    const t = i / fadeSamples;
    const wOut = Math.cos(t * Math.PI * 0.5);
    const wIn = Math.sin(t * Math.PI * 0.5);
    data[i] = data[i] * wIn + data[len - fadeSamples + i] * wOut;
  }
}

export function createBrownNoiseBuffer(ctx, durationSec = 10) {
  const sampleRate = ctx.sampleRate;
  const length = Math.floor(sampleRate * durationSec);
  const buffer = ctx.createBuffer(2, length, sampleRate);
  const fadeSamples = Math.floor(sampleRate * 0.35);

  for (let ch = 0; ch < 2; ch++) {
    const out = buffer.getChannelData(ch);
    let last = 0;
    let maxAbs = 0;

    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.022 * white) / 1.022;
      out[i] = last;
      const a = Math.abs(last);
      if (a > maxAbs) maxAbs = a;
    }

    const norm = maxAbs > 0 ? 0.85 / maxAbs : 1;
    for (let i = 0; i < length; i++) out[i] *= norm;
    crossfadeLoop(out, fadeSamples);
  }

  return buffer;
}

export function createPinkNoiseBuffer(ctx, durationSec = 12) {
  const sampleRate = ctx.sampleRate;
  const length = Math.floor(sampleRate * durationSec);
  const buffer = ctx.createBuffer(2, length, sampleRate);
  const fadeSamples = Math.floor(sampleRate * 0.4);

  for (let ch = 0; ch < 2; ch++) {
    const out = buffer.getChannelData(ch);
    let b0 = 0,
      b1 = 0,
      b2 = 0,
      b3 = 0,
      b4 = 0,
      b5 = 0,
      b6 = 0;
    let maxAbs = 0;

    for (let i = 0; i < length; i++) {
      const white = Math.random() * 2 - 1;
      b0 = 0.99886 * b0 + white * 0.0555179;
      b1 = 0.99332 * b1 + white * 0.0750759;
      b2 = 0.96900 * b2 + white * 0.1538520;
      b3 = 0.86650 * b3 + white * 0.3104856;
      b4 = 0.55000 * b4 + white * 0.5329522;
      b5 = -0.7616 * b5 - white * 0.0168980;
      const pink = b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
      b6 = white * 0.115926;
      out[i] = pink;
      const a = Math.abs(pink);
      if (a > maxAbs) maxAbs = a;
    }

    const norm = maxAbs > 0 ? 0.82 / maxAbs : 1;
    for (let i = 0; i < length; i++) out[i] *= norm;
    crossfadeLoop(out, fadeSamples);
  }

  return buffer;
}

/**
 * Synthesizes a curated library of unique acoustic wood-combustion micro-impulses:
 * - `tick`: tiny crystalline ember ticks ("チリッ / ピチッ")
 * - `crackle`: crisp bursting resin/moisture snaps ("パチッ")
 * - `pop`: deeper hollow driftwood fiber fractures ("バキッ / ポキッ")
 */
export function createCrackleImpulsePool(ctx) {
  const sr = ctx.sampleRate;
  const ticks = [];
  const crackles = [];
  const pops = [];

  // 10 delicate ember ticks (2ms .. 6ms)
  for (let k = 0; k < 10; k++) {
    const dur = 0.0025 + Math.random() * 0.004;
    const len = Math.max(32, Math.floor(sr * dur));
    const buf = ctx.createBuffer(1, len, sr);
    const d = buf.getChannelData(0);
    const f1 = 3600 + Math.random() * 4400;
    const f2 = 6200 + Math.random() * 4000;
    const decay = 480 + Math.random() * 620;

    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const env = Math.exp(-t * decay);
      const click = i < 4 ? (1 - i / 4) * (Math.random() * 1.4 - 0.7) : 0;
      const ring =
        Math.sin(2 * Math.PI * f1 * t) * 0.55 +
        Math.sin(2 * Math.PI * f2 * t + 1.2) * 0.3 +
        (Math.random() * 2 - 1) * 0.45;
      d[i] = (click + ring * env) * 0.85;
    }
    ticks.push(buf);
  }

  // 10 crisp campfire crackles ("パチッ", 8ms .. 22ms)
  for (let k = 0; k < 10; k++) {
    const dur = 0.009 + Math.random() * 0.015;
    const len = Math.floor(sr * dur);
    const buf = ctx.createBuffer(1, len, sr);
    const d = buf.getChannelData(0);
    const fBody = 1650 + Math.random() * 2400;
    const fHarm = fBody * (1.72 + Math.random() * 0.55);
    const decay = 180 + Math.random() * 210;
    const polarity = Math.random() < 0.5 ? 1 : -1;

    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const attack = Math.min(1, i / 5);
      const transient = Math.exp(-t * 1450) * polarity * 0.95;
      const bodyEnv = Math.exp(-t * decay);
      const woodRing =
        Math.sin(2 * Math.PI * fBody * t) * 0.48 +
        Math.sin(2 * Math.PI * fHarm * t + 0.7) * 0.28;
      const airBurst = (Math.random() * 2 - 1) * Math.exp(-t * 340) * 0.52;
      d[i] = attack * (transient + (woodRing + airBurst) * bodyEnv) * 0.75;
    }
    crackles.push(buf);
  }

  // 8 deeper woody snaps & splitting driftwood pops ("バキッ / ポキッ", 18ms .. 44ms)
  for (let k = 0; k < 8; k++) {
    const dur = 0.02 + Math.random() * 0.026;
    const len = Math.floor(sr * dur);
    const buf = ctx.createBuffer(1, len, sr);
    const d = buf.getChannelData(0);
    const fLow = 440 + Math.random() * 520;
    const fMid = 1150 + Math.random() * 1100;
    const fHigh = 2900 + Math.random() * 1800;
    const decay = 85 + Math.random() * 85;
    // Slight double-fracture micro-echo inside splitting grain
    const echoSample = Math.floor(sr * (0.002 + Math.random() * 0.0045));

    for (let i = 0; i < len; i++) {
      const t = i / sr;
      const snap1 = Math.exp(-t * 880) * (Math.random() * 0.6 + 0.6);
      const t2 = Math.max(0, (i - echoSample) / sr);
      const snap2 = i >= echoSample ? Math.exp(-t2 * 960) * 0.55 : 0;
      const bodyEnv = Math.exp(-t * decay);
      const modes =
        Math.sin(2 * Math.PI * fLow * t) * 0.55 +
        Math.sin(2 * Math.PI * fMid * t + 0.8) * 0.35 +
        Math.sin(2 * Math.PI * fHigh * t + 1.9) * 0.18;
      const splinter = (Math.random() * 2 - 1) * Math.exp(-t * 210) * 0.42;
      d[i] = (snap1 * 0.7 + snap2 * 0.45 + (modes + splinter) * bodyEnv) * 0.7;
    }
    pops.push(buf);
  }

  return { ticks, crackles, pops };
}
