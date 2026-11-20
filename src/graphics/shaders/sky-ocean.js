/**
 * Twilight coastal sky, sunset afterglow cloud deck, and animated short-crested dusk ocean.
 * Matches the cool cobalt-periwinkle upper-left sky, luminous pearl-azure upper-right,
 * delicate coral-pink sunset wisps on the far right horizon, and organically broken
 * dark indigo rolling waves with frothy whitewater surf crests.
 */

export const SKY_OCEAN_GLSL = /* glsl */ `
uniform float uSkyExposure;
uniform float uSunsetStrength;
uniform float uStarVisibility;

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

  // Horizon: dusky slate-lavender left -> luminous pale cream-blue center -> apricot-coral right
  vec3 horizLeft = vec3(0.175, 0.225, 0.41);
  vec3 horizCenter = vec3(0.68, 0.70, 0.78);
  vec3 horizPeach = vec3(1.12, 0.64, 0.50);
  vec3 horizCoral = vec3(1.28, 0.40, 0.42);

  vec3 horizCol = mix(horizLeft, horizCenter, smoothstep(-0.78, 0.18, az));
  vec3 warmGlow = mix(horizPeach, horizCoral, smoothstep(0.44, 0.96, az));
  horizCol = mix(horizCol, warmGlow, farRight * 0.94 * uSunsetStrength);

  vec3 sky = mix(horizCol, midCol, smoothstep(0.0, 0.15, elev));
  sky = mix(sky, zenithCol, smoothstep(0.09, 0.54, elev));

  // Soft warm post-sunset horizon glow off to the right
  vec3 sunDir = normalize(vec3(0.84, 0.024, 0.54));
  float sunDot = max(dot(rd, sunDir), 0.0);
  vec3 afterglow = vec3(1.15, 0.54, 0.39) * pow(sunDot, 4.0) * 0.34 * uSunsetStrength;
  afterglow += vec3(1.22, 0.74, 0.54) * pow(sunDot, 14.0) * 0.26 * uSunsetStrength;
  sky += afterglow * exp(-elev * 5.6);

  // Soft stratified marine twilight clouds (cool lavender-blue bank left, rose-coral wisps far right)
  if (rd.y > 0.002) {
    float cloudT = 1.0 / (rd.y + 0.115);
    vec2 cloudUv = rd.xz * cloudT * 0.34 + vec2(time * 0.0024, -time * 0.0010);

    vec2 stretched = vec2(cloudUv.x * 0.48, cloudUv.y * 2.25);
    float c1 = fbm2D(stretched * 1.4 + vec2(3.1, 1.7));
    float c2 = fbm2D(stretched * 3.0 - vec2(c1 * 0.85, time * 0.0016));
    float cloudMask = smoothstep(0.40, 0.75, c1 * 0.68 + c2 * 0.38);

    // Distinct dusky slate-lavender marine cloud bank hugging the left third of the horizon
    float leftBank = smoothstep(0.18, -0.58, az) * smoothstep(0.22, 0.012, elev);
    float highLeftStreak = smoothstep(0.05, -0.78, az) * smoothstep(0.09, 0.21, elev) * smoothstep(0.35, 0.17, elev);
    float rightPinkWisps = smoothstep(0.45, 0.96, az) * smoothstep(0.15, 0.014, elev) * smoothstep(0.48, 0.78, c2);
    float elevFade = smoothstep(0.002, 0.025, elev) * smoothstep(0.44, 0.04, elev);

    vec3 leftCloudCol = mix(vec3(0.13, 0.17, 0.34), vec3(0.29, 0.30, 0.48), c2);
    vec3 mauveStreakCol = vec3(0.40, 0.34, 0.50);
    vec3 rightCloudCol = mix(vec3(0.98, 0.46, 0.46), vec3(1.32, 0.52, 0.48), c2);
    vec3 cloudCol = mix(leftCloudCol, rightCloudCol, smoothstep(0.10, 0.82, az) * uSunsetStrength);

    float bankAlpha = saturate(cloudMask * elevFade * (0.24 + leftBank * 0.88));
    sky = mix(sky, cloudCol, bankAlpha * 0.74);
    sky = mix(sky, mauveStreakCol, saturate(cloudMask * highLeftStreak * 0.52));
    sky = mix(
      sky,
      mix(leftCloudCol, vec3(1.26, 0.44, 0.46), uSunsetStrength),
      rightPinkWisps * 0.74
    );
  }

  // Crisp subtle horizon airglow scatter
  float horizonBand = exp(-elev * 36.0);
  vec3 hBandCol = mix(vec3(0.22, 0.27, 0.45), vec3(0.88, 0.74, 0.72), smoothstep(-0.55, 0.85, az));
  sky = mix(sky, hBandCol, horizonBand * 0.20);

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

// Short-crested choppy coastal waves (domain-warped oblique wave trains — zero parallel stripes!)
float oceanWaveHeight(vec2 p, float time, out float crestFoam, out float troughMask) {
  // Organic domain warp breaks up repetitive horizontal parallel lines into realistic coastal swells
  float wx = fbm2D(vec2(p.x * 0.12, p.y * 0.14 + time * 0.05)) - 0.5;
  float wz = fbm2D(vec2(p.x * 0.15 + 4.3, p.y * 0.11 - time * 0.04)) - 0.5;
  vec2 wp = p + vec2(wx * 2.2, wz * 1.8);

  float h = 0.0;

  // Oblique wave train 1 (angled slightly from upper-left toward shore)
  float ph1 = wp.y * 0.56 + wp.x * 0.16 + time * 0.62;
  float s1 = sin(ph1);
  float c1 = pow(saturate(s1 * 0.5 + 0.5), 2.4);
  h += (s1 * 0.50 + c1 * 0.55) * 0.20;

  // Oblique wave train 2 (crossing gently from upper-right, creating natural 3D choppy peaks!)
  float ph2 = wp.y * 0.94 - wp.x * 0.24 + time * 0.88;
  float s2 = sin(ph2);
  float c2 = pow(saturate(s2 * 0.5 + 0.5), 2.8);
  h += (s2 * 0.42 + c2 * 0.50) * 0.13;

  // Shorter patchy wind-driven coastal chop & cross ripples
  float chop1 = fbm2D(vec2(wp.x * 0.48 + time * 0.12, wp.y * 1.12 + time * 0.68)) - 0.5;
  float chop2 = noise2D(vec2(wp.x * 1.55 - time * 0.25, wp.y * 2.85 + time * 1.12)) - 0.5;
  float chop3 = noise2D(vec2(wp.x * 3.8 + time * 0.42, wp.y * 6.4 + time * 1.50)) - 0.5;
  h += chop1 * 0.22 + chop2 * 0.072 + chop3 * 0.028;

  // Organic patchy breaking surf crests (matching the left-mid & right-mid curling breakers in photo!)
  float patchNoise = fbm2D(vec2(p.x * 0.22, p.y * 0.28 + time * 0.12));
  float fineLace = fbm2D(vec2(p.x * 1.35 + wx * 1.2, p.y * 1.85 + time * 0.24));

  float surfZone = smoothstep(32.0, 9.5, p.y) * smoothstep(5.0, 6.8, p.y);
  float breakerCrest = smoothstep(0.56, 0.88, c1 * 0.55 + c2 * 0.45 + chop1 * 0.65 + (patchNoise - 0.5) * 0.5) * surfZone;

  // Distinct localized dark-trough + white-lip breaking swells on left & right midground
  float leftWaveZ = 12.6 + sin(p.x * 0.28 + 0.8) * 1.2;
  float leftRoller = exp(-pow((p.y - leftWaveZ) / 1.05, 2.0))
    * smoothstep(0.6, -2.8, p.x) * smoothstep(0.32, 0.72, fineLace * 0.75 + c1 * 0.45);

  float rightWaveZ = 10.2 + cos(p.x * 0.30 - 0.4) * 1.0;
  float rightRoller = exp(-pow((p.y - rightWaveZ) / 0.95, 2.0))
    * smoothstep(1.8, 5.2, p.x) * smoothstep(0.30, 0.72, fineLace * 0.75 + c2 * 0.45);

  // Scalloped frothy shoreline whitewater wash right where waves kiss the beach sand
  float shoreCurve = 5.18 + sin(p.x * 0.36 + 0.6) * 0.30 + (noise2D(vec2(p.x * 0.55, 1.3)) - 0.5) * 0.34
    + sin(time * 0.68 + p.x * 0.24) * 0.22;
  float shoreFoam = exp(-pow((p.y - (shoreCurve + 0.45)) / 0.62, 2.0)) * (0.48 + 0.82 * fineLace);

  crestFoam = saturate(breakerCrest * 0.72 + leftRoller * 0.85 + rightRoller * 0.92 + shoreFoam * 0.96);
  troughMask = saturate(0.5 - chop1 * 0.8 - s1 * 0.35);
  return h;
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

  float eps = clamp(dist * 0.0085, 0.042, 0.52);
  float foamC = 0.0, foamX = 0.0, foamZ = 0.0;
  float troughC = 0.0, troughX = 0.0, troughZ = 0.0;
  float hC = oceanWaveHeight(pos.xz, time, foamC, troughC);
  float hX = oceanWaveHeight(pos.xz + vec2(eps, 0.0), time, foamX, troughX);
  float hZ = oceanWaveHeight(pos.xz + vec2(0.0, eps), time, foamZ, troughZ);

  float normalScale = mix(1.48, 0.36, smoothstep(8.0, 90.0, dist));
  vec3 n = normalize(vec3((hC - hX) / eps * normalScale, 1.0, (hC - hZ) / eps * normalScale));

  vec3 v = -rd;
  float ndv = max(dot(n, v), 0.001);

  float fresnel = 0.02 + 0.98 * pow(1.0 - ndv, 4.2);
  fresnel = clamp(fresnel * 0.95, 0.02, 0.92);

  vec3 reflDir = reflect(rd, n);
  reflDir.y = abs(reflDir.y) * 0.80 + 0.012;
  vec3 skyRefl = evaluateSky(normalize(reflDir), time);

  // Rich deep navy-indigo wave faces contrasting sharply against silvery-sky wave backs!
  float rightTint = smoothstep(-0.25, 0.85, rd.x);
  vec3 deepWater = mix(vec3(0.008, 0.022, 0.064), vec3(0.016, 0.040, 0.084), rightTint) * uSkyExposure;
  float frontFaceDarken = saturate(max(-n.z, 0.0) * 1.55);
  vec3 waterBody = mix(deepWater, deepWater * 0.36, frontFaceDarken * 0.78 + troughC * 0.25);

  vec3 col = mix(waterBody, skyRefl * 0.85, fresnel * (1.0 - frontFaceDarken * 0.52));

  // Soft silvery-peach reflection sheen across right-side ocean ripples
  vec3 sunDir = normalize(vec3(0.82, 0.07, 0.56));
  vec3 hSun = normalize(sunDir + v);
  float sunSpec = pow(max(dot(n, hSun), 0.0), 40.0) * 0.34 * uSunsetStrength * uSkyExposure;
  col += vec3(1.0, 0.82, 0.70) * sunSpec * smoothstep(7.0, 32.0, dist);

  // Subtle flickering warm campfire glint on closest surf waves
  vec3 toFire = firePos - pos;
  float fireDist = length(toFire);
  vec3 lFire = toFire / max(fireDist, 0.001);
  vec3 hFire = normalize(lFire + v);
  float fireSpec = pow(max(dot(n, hFire), 0.0), 30.0);
  float fireAtten = 1.0 / (1.0 + fireDist * fireDist * 0.08);
  col += fireColor * fireSpec * fireAtten * 0.22;

  // Textured lacy whitewater foam crests & organic shoreline wash
  float fineFoam = fbm2D(pos.xz * 2.6 + vec2(0.0, time * 0.22));
  float foamMask = saturate(foamC * (0.55 + 0.82 * fineFoam)) * smoothstep(95.0, 10.0, dist);
  vec3 foamColor = mix(vec3(0.24, 0.34, 0.54), vec3(0.58, 0.64, 0.74), rightTint * 0.72 + 0.28) * uSkyExposure;
  foamColor += fireColor * fireAtten * 0.035;
  col = mix(col, foamColor, foamMask * 0.86);

  // Crisp subtle horizon mist
  float fog = 1.0 - exp(-pow(max(dist - 24.0, 0.0) * 0.0082, 1.45));
  vec3 horizSky = evaluateSky(normalize(vec3(rd.x, 0.006, rd.z)), time);
  col = mix(col, horizSky, saturate(fog * 0.90));

  return col;
}
`;
