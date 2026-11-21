/**
 * Twilight coastal sky, sunset afterglow cloud deck, and TRUE 3D RAYMARCHED coastal ocean waves.
 * Unlike flat-plane bump-mapped water, the ocean heightfield is genuinely displaced in 3D space
 * with shoaling trochoidal wave swells, real 3D wave-crest self-occlusion, subsurface wave-face
 * scattering, and cellular lacy breaking surf foam tumbling onto the dark wet beach shoreline.
 */

export const SKY_OCEAN_GLSL = /* glsl */ `
uniform float uSkyExposure;
uniform float uSunsetStrength;
uniform float uStarVisibility;

const float OCEAN_BASE_Y = -0.24;
const float OCEAN_MAX_AMP = 0.46;

vec3 evaluateSky(vec3 rd, float time) {
  float elev = max(rd.y, 0.0);
  float az = clamp(rd.x * 1.18, -1.0, 1.0);
  float rightBright = smoothstep(-0.38, 0.85, az);
  float farRight = smoothstep(0.16, 0.98, az);

  // Rich cobalt-periwinkle upper-left -> bright airy dusk azure upper-right
  vec3 zenithLeft = vec3(0.072, 0.150, 0.415);
  vec3 zenithRight = vec3(0.27, 0.40, 0.66);
  vec3 zenithCol = mix(zenithLeft, zenithRight, rightBright);

  vec3 midLeft = vec3(0.165, 0.255, 0.495);
  vec3 midRight = vec3(0.54, 0.66, 0.82);
  vec3 midCol = mix(midLeft, midRight, rightBright);

  // Horizon: dusky slate-lavender left -> luminous pale cream-blue center -> warm apricot-coral right
  vec3 horizLeft = vec3(0.165, 0.215, 0.405);
  vec3 horizCenter = vec3(0.66, 0.69, 0.78);
  vec3 horizPeach = vec3(1.16, 0.62, 0.48);
  vec3 horizCoral = vec3(1.38, 0.38, 0.42);

  vec3 horizCol = mix(horizLeft, horizCenter, smoothstep(-0.78, 0.16, az));
  vec3 warmGlow = mix(horizPeach, horizCoral, smoothstep(0.42, 0.95, az));
  horizCol = mix(horizCol, warmGlow, farRight * 0.96 * uSunsetStrength);

  vec3 sky = mix(horizCol, midCol, smoothstep(0.0, 0.15, elev));
  sky = mix(sky, zenithCol, smoothstep(0.09, 0.54, elev));

  // Soft warm post-sunset horizon glow off to the right
  vec3 sunDir = normalize(vec3(0.84, 0.026, 0.54));
  float sunDot = max(dot(rd, sunDir), 0.0);
  vec3 afterglow = vec3(1.22, 0.50, 0.38) * pow(sunDot, 3.6) * 0.40 * uSunsetStrength;
  afterglow += vec3(1.32, 0.68, 0.52) * pow(sunDot, 12.0) * 0.32 * uSunsetStrength;
  sky += afterglow * exp(-elev * 5.2);

  // Soft stratified marine twilight clouds (cool lavender-blue bank left, glowing coral-pink wisps far right)
  if (rd.y > 0.002) {
    float cloudT = 1.0 / (rd.y + 0.115);
    vec2 cloudUv = rd.xz * cloudT * 0.34 + vec2(time * 0.0024, -time * 0.0010);

    vec2 stretched = vec2(cloudUv.x * 0.48, cloudUv.y * 2.25);
    float c1 = fbm2D(stretched * 1.4 + vec2(3.1, 1.7));
    float c2 = fbm2D(stretched * 3.0 - vec2(c1 * 0.85, time * 0.0016));
    float cloudMask = smoothstep(0.38, 0.74, c1 * 0.68 + c2 * 0.38);

    float leftBank = smoothstep(0.16, -0.58, az) * smoothstep(0.22, 0.012, elev);
    float highLeftStreak = smoothstep(0.02, -0.78, az) * smoothstep(0.08, 0.21, elev) * smoothstep(0.38, 0.16, elev);
    float rightPinkWisps = smoothstep(0.42, 0.94, az) * smoothstep(0.18, 0.014, elev) * smoothstep(0.45, 0.76, c2);
    float elevFade = smoothstep(0.002, 0.025, elev) * smoothstep(0.46, 0.04, elev);

    vec3 leftCloudCol = mix(vec3(0.125, 0.165, 0.345), vec3(0.30, 0.30, 0.49), c2);
    vec3 mauveStreakCol = vec3(0.45, 0.34, 0.52);
    vec3 rightCloudCol = mix(vec3(1.08, 0.46, 0.46), vec3(1.45, 0.50, 0.48), c2);
    vec3 cloudCol = mix(leftCloudCol, rightCloudCol, smoothstep(0.10, 0.80, az) * uSunsetStrength);

    float bankAlpha = saturate(cloudMask * elevFade * (0.24 + leftBank * 0.90));
    sky = mix(sky, cloudCol, bankAlpha * 0.76);
    sky = mix(sky, mauveStreakCol, saturate(cloudMask * highLeftStreak * 0.62));
    sky = mix(
      sky,
      mix(leftCloudCol, vec3(1.42, 0.44, 0.46), uSunsetStrength),
      rightPinkWisps * 0.82
    );
  }

  float horizonBand = exp(-elev * 36.0);
  vec3 hBandCol = mix(vec3(0.22, 0.27, 0.45), vec3(0.88, 0.74, 0.72), smoothstep(-0.55, 0.85, az));
  sky = mix(sky, hBandCol, horizonBand * 0.18);

  // Delicate evening stars (emerging in Blue Hour & Night presets)
  if (uStarVisibility > 0.01 && elev > 0.08) {
    vec2 starGrid = floor((rd.xz / (rd.y + 0.35)) * 185.0);
    float starHash = hash12(starGrid);
    if (starHash > 0.9942) {
      vec2 cellUv = fract((rd.xz / (rd.y + 0.35)) * 185.0) - 0.5;
      float d = length(cellUv);
      float twinkle = 0.75 + 0.25 * sin(time * 2.2 + starHash * 400.0);
      float starBright = smoothstep(0.16, 0.0, d) * twinkle * smoothstep(0.08, 0.28, elev);
      vec3 starCol = mix(vec3(0.82, 0.90, 1.0), vec3(1.0, 0.92, 0.80), fract(starHash * 73.1));
      sky += starCol * starBright * 1.1 * uStarVisibility;
    }
  }

  return sky * uSkyExposure;
}

// Asymmetric sharpened trochoidal wave profile: steep forward-leaning shore face + gentle back slope!
float trochoidWave(float phase, float steepness) {
  float s = sin(phase);
  // Shift phase forward so the wave face toward the beach (-z) is noticeably steeper than its back!
  float skewed = sin(phase + 0.38 * s);
  float crest = pow(saturate(skewed * 0.5 + 0.5), steepness);
  return crest - 0.32;
}

// True 3D displaced coastal ocean wave heightfield (used for real 3D raymarching & self-occlusion!)
// Returns height relative to OCEAN_BASE_Y; outputs crest breaking intensity in outBreak.
float oceanHeight3D(vec2 p, float time, float detailWeight, out float outBreak) {
  // Organic 2D domain warp prevents artificial parallel stripes across the water
  float w1 = noise2D(vec2(p.x * 0.11, p.y * 0.09 + time * 0.04)) - 0.5;
  float w2 = noise2D(vec2(p.x * 0.23 + 5.7, p.y * 0.18 - time * 0.05)) - 0.5;
  vec2 wp = p + vec2(w1 * 2.6 + w2 * 0.9, w2 * 1.4);

  // Shoaling envelope: swells build taller & steeper in the surf zone (z ~ 6.5..24m), calmer far out
  float surfShoal = smoothstep(55.0, 10.5, p.y) * smoothstep(5.6, 7.6, p.y);
  // Smoothly taper 3D wave displacement to 0 at z <= 5.45m so the ocean meets the beach slope seamlessly (ZERO cut wall!)
  float shoreAtten = smoothstep(5.45, 6.55, p.y);

  float h = 0.0;
  float breakVal = 0.0;

  // --- Wave Train 1: Primary heavy rolling twilight swells (tall 3D dark walls & crest self-occlusion!) ---
  float ph1 = wp.y * 0.48 + wp.x * 0.05 + time * 0.84 + w1 * 1.7;
  float wave1 = trochoidWave(ph1, 2.95);
  float setMod1 = 0.40 + 0.60 * noise2D(vec2(p.x * 0.14 + 1.3, p.y * 0.07 + time * 0.08));
  float amp1 = (0.17 + 0.16 * surfShoal) * setMod1;
  h += wave1 * amp1;
  breakVal += smoothstep(0.42, 0.66, wave1) * setMod1 * surfShoal * 0.85;

  // --- Wave Train 2: Oblique crossing swell creating heavy irregular 3D peaks & troughs ---
  float ph2 = wp.y * 0.86 - wp.x * 0.15 + time * 1.15;
  float wave2 = trochoidWave(ph2, 3.0);
  float setMod2 = 0.38 + 0.62 * noise2D(vec2(p.x * 0.20 + 8.4, p.y * 0.11 + time * 0.09));
  h += wave2 * (0.095 + 0.085 * surfShoal) * setMod2;
  breakVal += smoothstep(0.46, 0.68, wave2) * setMod2 * surfShoal * 0.65;

  // --- Wave Train 3: Dramatic plunging surf rollers (strictly spatially gated — zero wasted work!) ---
  if (p.x < 1.2 && abs(p.y - 13.4) < 6.0) {
    float leftRollerZ = 13.4 + sin(p.x * 0.20 + 0.8) * 1.3 + w1 * 1.5;
    float leftRollerEnv = exp(-pow((p.y - leftRollerZ) / 1.75, 2.0)) * smoothstep(1.0, -2.2, p.x);
    if (leftRollerEnv > 0.005) {
      float leftCurl = trochoidWave((p.y - leftRollerZ) * 1.38 + time * 0.92, 3.4);
      h += leftCurl * 0.20 * leftRollerEnv;
      breakVal += smoothstep(0.32, 0.62, leftCurl) * leftRollerEnv * 0.95;
    }
  }

  if (p.x > 1.0 && abs(p.y - 9.7) < 5.2) {
    float rightRollerZ = 9.7 + cos(p.x * 0.22 - 0.5) * 1.1 + w2 * 1.3;
    float rightRollerEnv = exp(-pow((p.y - rightRollerZ) / 1.55, 2.0)) * smoothstep(1.2, 4.0, p.x);
    if (rightRollerEnv > 0.005) {
      float rightCurl = trochoidWave((p.y - rightRollerZ) * 1.50 + time * 0.98, 3.5);
      h += rightCurl * 0.25 * rightRollerEnv;
      breakVal += smoothstep(0.22, 0.54, rightCurl) * rightRollerEnv * 1.35;
    }
  }

  // --- Wave Train 4 & 5: Heavy multi-directional choppy sea facets ---
  vec2 cUv1 = rot2(0.44) * wp * vec2(0.68, 1.15) + vec2(0.0, time * 0.78);
  vec2 cUv2 = rot2(-0.56) * wp * vec2(1.18, 1.85) + vec2(time * 0.20, time * 1.12);
  float chopA = (noise2D(cUv1) - 0.5) * 0.145;
  float chopB = (noise2D(cUv2) - 0.5) * 0.088;
  h += (chopA + chopB) * shoreAtten;

  // High-frequency turbulent wind ripples & churning surf grit right up to the beach edge!
  if (detailWeight > 0.01) {
    float r1 = (noise2D(vec2(wp.x * 2.4 + time * 0.25, wp.y * 3.8 + time * 1.45)) - 0.5) * 0.046;
    float r2 = (noise2D(vec2(wp.x * 5.8 - time * 0.38, wp.y * 8.6 + time * 1.95)) - 0.5) * 0.022;
    float r3 = (noise2D(vec2(wp.x * 13.0 + time * 0.65, wp.y * 19.0 + time * 2.6)) - 0.5) * 0.010;
    h += (r1 + r2 + r3) * detailWeight * (0.35 + 0.65 * shoreAtten);
  }

  // Broken, lacy frothy shoreline surf edge — strictly gated to near-shore z < 8.4m!
  if (p.y < 8.4) {
    float swashCycle = sin(time * 0.78 + sin(p.x * 0.26) * 1.3);
    float shoreZ = 5.85 + sin(p.x * 0.30 + 0.5) * 0.30 + w1 * 0.42 + swashCycle * 0.22;
    float swashBreakup = 0.42 + 0.78 * fbm2D(vec2(p.x * 0.85, p.y * 1.1 + time * 0.22));
    float swashRim = exp(-pow((p.y - (shoreZ + 0.20)) / 0.58, 2.0)) * swashBreakup;
    h += swashRim * 0.032;
    breakVal += swashRim * 0.90;
  }

  outBreak = saturate(breakVal);
  return h * shoreAtten;
}

// True 3D raymarch of the displaced ocean heightfield!
// Strictly bounded in WORLD Z (>= 5.15m) so ocean NEVER leaks into foreground footprints at screen edges!
bool marchOcean3D(vec3 ro, vec3 rd, float zShoreMin, float tMaxSearch, float time, out float tHit) {
  tHit = 1e5;
  if (rd.y >= -0.0002 || rd.z <= 0.01) return false;

  // Convert world-space shoreline Z bound into exact ray distance tShoreMin!
  float tShoreMin = max(0.2, (zShoreMin - ro.z) / rd.z);

  // Intersect upper & lower wave height bounds to focus ALL steps inside the actual 3D wave slab!
  float yTop = OCEAN_BASE_Y + OCEAN_MAX_AMP;
  float yBot = OCEAN_BASE_Y - 0.28;

  float tTop = (yTop - ro.y) / rd.y;
  float tBot = (yBot - ro.y) / rd.y;
  if (tBot < tShoreMin || tTop > tMaxSearch) return false;

  float tStart = max(tShoreMin, max(0.2, tTop));
  float tEnd = min(tMaxSearch, min(tBot, 240.0));
  if (tStart >= tEnd) return false;

  float prevT = tStart;
  float dummy = 0.0;
  vec3 prevP = ro + rd * prevT;
  float prevDiff = prevP.y - (OCEAN_BASE_Y + oceanHeight3D(prevP.xz, time, 0.0, dummy));

  if (prevDiff <= 0.0) {
    tHit = prevT;
    return true;
  }

  const int STEPS = 28;
  for (int i = 1; i <= STEPS; i++) {
    float frac = float(i) / float(STEPS);
    float t = mix(tStart, tEnd, pow(frac, 1.56));
    vec3 p = ro + rd * t;
    float h = OCEAN_BASE_Y + oceanHeight3D(p.xz, time, 0.0, dummy);
    float diff = p.y - h;

    if (diff <= 0.0) {
      float lo = prevT;
      float hi = t;
      for (int b = 0; b < 4; b++) {
        float mid = 0.5 * (lo + hi);
        vec3 pm = ro + rd * mid;
        float hm = OCEAN_BASE_Y + oceanHeight3D(pm.xz, time, 0.0, dummy);
        if (pm.y <= hm) {
          hi = mid;
        } else {
          lo = mid;
        }
      }
      tHit = 0.5 * (lo + hi);
      return true;
    }

    prevT = t;
    prevDiff = diff;
  }

  float tMean = (OCEAN_BASE_Y - ro.y) / rd.y;
  if (tMean >= tShoreMin && tMean <= tMaxSearch) {
    tHit = tMean;
    return true;
  }
  return false;
}

vec3 shadeOcean(
  vec3 ro,
  vec3 rd,
  float tOcean,
  float time,
  vec3 firePos,
  vec3 fireColor
) {
  vec3 pos = ro + rd * tOcean;
  float dist = tOcean;

  // High-frequency ripple fade with distance prevents horizon aliasing shimmer
  float detailWeight = smoothstep(75.0, 7.0, dist);
  float eps = clamp(dist * 0.0055, 0.025, 0.42);

  float breakC = 0.0, breakX = 0.0, breakZ = 0.0;
  float hC = oceanHeight3D(pos.xz, time, detailWeight, breakC);
  float hX = oceanHeight3D(pos.xz + vec2(eps, 0.0), time, detailWeight, breakX);
  float hZ = oceanHeight3D(pos.xz + vec2(0.0, eps), time, detailWeight, breakZ);

  // Strong geometric wave slope & crisp dramatic dark-wall vs silvery-trough contrast!
  float slopeGain = mix(1.55, 0.46, smoothstep(10.0, 120.0, dist));
  vec3 n = normalize(vec3((hC - hX) / eps * slopeGain, 1.0, (hC - hZ) / eps * slopeGain));

  vec3 v = -rd;
  float ndv = max(dot(n, v), 0.001);

  // Physically-based water Fresnel: steep camera-facing dark swells stay rich deep navy,
  // while gently tilted wave backs & near-shore choppy facets catch broken twilight sky sheen!
  float fresnel = 0.02 + 0.98 * pow(1.0 - ndv, 4.6);
  fresnel = clamp(fresnel, 0.02, 0.86);

  vec3 reflDir = reflect(rd, n);
  reflDir.y = max(reflDir.y, 0.008);
  vec3 skyRefl = evaluateSky(normalize(reflDir), time);

  // Deep cold dusk seawater body + dramatic shadowed wave walls facing camera!
  float rightTint = smoothstep(-0.25, 0.85, rd.x);
  vec3 deepWater = mix(vec3(0.006, 0.017, 0.052), vec3(0.012, 0.030, 0.070), rightTint) * uSkyExposure;
  float crestHeight = saturate((hC + 0.03) * 3.4);
  vec3 sssCol = mix(vec3(0.012, 0.045, 0.088), vec3(0.024, 0.062, 0.102), rightTint) * uSkyExposure;
  float facingCam = saturate(max(-n.z, 0.0) * 1.95);

  // Near-shore choppy water (z < 10m) has darker turbulent depth & lower sky mirror glaze than open sea
  float nearShoreDarken = smoothstep(11.5, 5.8, pos.z);
  vec3 waterBody = mix(deepWater, deepWater * 0.24, facingCam * 0.82);
  waterBody += sssCol * crestHeight * (0.20 + 0.42 * smoothstep(22.0, 6.0, pos.z));

  float reflWeight = fresnel * (1.0 - facingCam * 0.58) * mix(0.90, 0.52, nearShoreDarken);
  vec3 col = mix(waterBody, skyRefl, reflWeight);

  // Luminous soft sunset reflection path on the right half of the ocean
  vec3 sunDir = normalize(vec3(0.82, 0.08, 0.56));
  vec3 hSun = normalize(sunDir + v);
  float sunSpec = pow(max(dot(n, hSun), 0.0), 30.0) * 0.34 * uSunsetStrength * uSkyExposure;
  col += vec3(1.0, 0.82, 0.72) * sunSpec * smoothstep(6.5, 28.0, dist);

  // Subtle flickering amber reflection of campfire dancing on closest surf ripples
  vec3 toFire = firePos - pos;
  float fireDist = length(toFire);
  vec3 lFire = toFire / max(fireDist, 0.001);
  vec3 hFire = normalize(lFire + v);
  float fireSpec = pow(max(dot(n, hFire), 0.0), 28.0);
  float fireAtten = 1.0 / (1.0 + fireDist * fireDist * 0.085);
  col += fireColor * fireSpec * fireAtten * 0.24;

  // --- REALISTIC BROKEN LACY FOAM (gated strictly where waves actually break — skips 18-tap Voronoi on calm sea!) ---
  if (breakC > 0.08 && dist < 88.0) {
    vec2 foamUv = pos.xz * 1.45 + vec2(0.0, time * 0.25);
    float web1 = foamWebNoise(foamUv * 2.5);
    float web2 = foamWebNoise(foamUv * 5.8 + vec2(3.1, 7.4));
    float fbmBreak = fbm2D(pos.xz * 2.1 + vec2(0.0, time * 0.22));
    float sprayGrain = noise2D(pos.xz * 12.5 + vec2(time * 0.5, time * 1.2));

    float crestCore = smoothstep(0.54, 0.90, breakC * (0.68 + 0.58 * fbmBreak));
    float lacyTrail = smoothstep(0.22, 0.66, breakC) * (web1 * 0.58 + web2 * 0.52) * smoothstep(0.38, 0.76, fbmBreak);
    float foamMask = saturate(crestCore * (0.52 + 0.65 * sprayGrain) + lacyTrail * 0.85);
    foamMask *= smoothstep(88.0, 9.0, dist);

    float foamShade = saturate(0.42 + 0.58 * n.y - 0.28 * facingCam);
    vec3 foamLit = mix(vec3(0.28, 0.40, 0.60), vec3(0.72, 0.78, 0.88), rightTint * 0.62 + 0.38) * uSkyExposure;
    vec3 foamShadow = vec3(0.05, 0.10, 0.22) * uSkyExposure;
    vec3 foamCol = mix(foamShadow, foamLit, foamShade);
    foamCol += fireColor * fireAtten * 0.04;

    col = mix(col, foamCol, foamMask * 0.88);
  }

  // Clean atmospheric horizon mist blending distant swells smoothly into twilight sky
  float fog = 1.0 - exp(-pow(max(dist - 28.0, 0.0) * 0.0075, 1.45));
  vec3 horizSky = evaluateSky(normalize(vec3(rd.x, 0.005, rd.z)), time);
  col = mix(col, horizSky, saturate(fog * 0.90));

  return col;
}
`;
