/**
 * Twilight coastal sky, sunset afterglow cloud deck, and animated multi-swell dusk ocean.
 * Calibrated in linear HDR radiance for AgX tonemapping to match the cool periwinkle-blue
 * upper-left sky, bright pale pearl-azure upper-right, rosy peach sunset strip on the right,
 * and deep textured indigo-blue rolling ocean swells with whitewater crests.
 */

export const SKY_OCEAN_GLSL = /* glsl */ `
uniform float uSkyExposure;
uniform float uSunsetStrength;
uniform float uStarVisibility;

vec3 evaluateSky(vec3 rd, float time) {
  float elev = max(rd.y, 0.0);
  // Azimuth across frame: negative left, positive right
  float az = clamp(rd.x * 1.18, -1.0, 1.0);
  float rightBright = smoothstep(-0.35, 0.85, az);
  float farRight = smoothstep(0.18, 0.98, az);

  // Deep saturated dusk cobalt-periwinkle upper-left -> brighter pale sky-blue upper-right
  vec3 zenithLeft = vec3(0.085, 0.165, 0.42);
  vec3 zenithRight = vec3(0.28, 0.41, 0.66);
  vec3 zenithCol = mix(zenithLeft, zenithRight, rightBright);

  // Mid-sky luminous cool periwinkle-blue -> clean airy pale azure
  vec3 midLeft = vec3(0.18, 0.27, 0.50);
  vec3 midRight = vec3(0.54, 0.66, 0.82);
  vec3 midCol = mix(midLeft, midRight, rightBright);

  // Horizon band: moody blue-lavender left -> luminous pale cream-pearl center -> peach-coral right
  vec3 horizLeft = vec3(0.19, 0.24, 0.42);
  vec3 horizCenter = vec3(0.66, 0.69, 0.78);
  vec3 horizPeach = vec3(1.08, 0.66, 0.52);
  vec3 horizCoral = vec3(1.22, 0.42, 0.40);

  vec3 horizCol = mix(horizLeft, horizCenter, smoothstep(-0.78, 0.16, az));
  vec3 warmGlow = mix(horizPeach, horizCoral, smoothstep(0.46, 0.96, az));
  horizCol = mix(horizCol, warmGlow, farRight * 0.92 * uSunsetStrength);

  // Vertical atmospheric transition
  vec3 sky = mix(horizCol, midCol, smoothstep(0.0, 0.16, elev));
  sky = mix(sky, zenithCol, smoothstep(0.10, 0.56, elev));

  // Warm post-sunset horizon radiance glowing off to the far right
  vec3 sunDir = normalize(vec3(0.84, 0.025, 0.54));
  float sunDot = max(dot(rd, sunDir), 0.0);
  vec3 afterglow = vec3(1.15, 0.56, 0.40) * pow(sunDot, 4.0) * 0.34 * uSunsetStrength;
  afterglow += vec3(1.20, 0.76, 0.56) * pow(sunDot, 14.0) * 0.24 * uSunsetStrength;
  sky += afterglow * exp(-elev * 5.8);

  // Stratified twilight clouds: dusty blue-lavender bank on left & rose-pink sunset wisps on right
  if (rd.y > 0.002) {
    float cloudT = 1.0 / (rd.y + 0.105);
    vec2 cloudUv = rd.xz * cloudT * 0.38 + vec2(time * 0.0026, -time * 0.0012);

    vec2 stretched = vec2(cloudUv.x * 0.55, cloudUv.y * 2.1);
    float c1 = fbm2D(stretched * 1.35 + vec2(3.1, 1.4));
    float c2 = fbm2D(stretched * 2.85 - vec2(c1 * 0.85, time * 0.0018));
    float cloudMask = smoothstep(0.43, 0.76, c1 * 0.68 + c2 * 0.38);

    // Distinct soft blue-lavender marine cloud bank on the left third + subtle mauve high wisps
    float leftBank = smoothstep(0.22, -0.62, az) * smoothstep(0.24, 0.015, elev);
    float highLeftWisp = smoothstep(0.15, -0.70, az) * smoothstep(0.08, 0.22, elev) * smoothstep(0.36, 0.18, elev);
    float rightPinkWisps = smoothstep(0.38, 0.94, az) * smoothstep(0.16, 0.012, elev) * smoothstep(0.52, 0.80, c2);
    float elevFade = smoothstep(0.002, 0.028, elev) * smoothstep(0.44, 0.05, elev);

    vec3 leftCloudCol = mix(vec3(0.14, 0.18, 0.34), vec3(0.31, 0.31, 0.48), c2);
    vec3 mauveWispCol = vec3(0.36, 0.33, 0.50);
    vec3 rightCloudCol = mix(vec3(0.95, 0.48, 0.48), vec3(1.28, 0.54, 0.50), c2);
    vec3 cloudCol = mix(leftCloudCol, rightCloudCol, smoothstep(0.05, 0.78, az) * uSunsetStrength);

    float bankAlpha = saturate(cloudMask * elevFade * (0.28 + leftBank * 0.82));
    sky = mix(sky, cloudCol, bankAlpha * 0.70);
    sky = mix(sky, mauveWispCol, saturate(cloudMask * highLeftWisp * 0.42));
    sky = mix(
      sky,
      mix(leftCloudCol, vec3(1.22, 0.46, 0.46), uSunsetStrength),
      rightPinkWisps * 0.68
    );
  }

  // Crisp subtle horizon airglow scatter
  float horizonBand = exp(-elev * 32.0);
  vec3 hBandCol = mix(vec3(0.24, 0.28, 0.46), vec3(0.88, 0.74, 0.72), smoothstep(-0.55, 0.85, az));
  sky = mix(sky, hBandCol, horizonBand * 0.22);

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

// Multi-directional rolling coastal swells + dramatic dark wave troughs & breaking foam crests
float oceanWaveHeight(vec2 p, float time, out float crestFoam, out float troughMask) {
  float h = 0.0;
  float foam = 0.0;

  // Primary bold shoreward rolling swells (creates distinct dark wave fronts facing the camera)
  float swell1Phase = p.y * 0.62 + time * 0.58 + sin(p.x * 0.16 + 0.4) * 1.05;
  float s1 = sin(swell1Phase);
  float c1 = pow(saturate(s1 * 0.5 + 0.5), 2.2);
  h += (s1 * 0.55 + c1 * 0.55) * 0.22;

  float swell2Phase = p.y * 1.15 - p.x * 0.11 + time * 0.86 + noise2D(p * 0.14) * 1.8;
  float s2 = sin(swell2Phase);
  float c2 = pow(saturate(s2 * 0.5 + 0.5), 2.8);
  h += (s2 * 0.42 + c2 * 0.52) * 0.12;

  // Shorter coastal wind chop giving rich rippled reflections across the ocean surface
  vec2 q = p;
  q.x += sin(p.y * 0.38 + time * 0.32) * 0.7;
  float chop1 = noise2D(vec2(q.x * 0.72, q.y * 1.55 + time * 0.72)) - 0.5;
  float chop2 = noise2D(vec2(q.x * 1.95 - time * 0.28, q.y * 3.4 + time * 1.15)) - 0.5;
  float chop3 = noise2D(vec2(q.x * 4.8 + time * 0.44, q.y * 8.2 + time * 1.55)) - 0.5;
  h += chop1 * 0.11 + chop2 * 0.048 + chop3 * 0.020;

  // Prominent breaking wave rollers (left-mid breaker, right-mid roller, shoreline wash)
  float breakNoise = fbm2D(vec2(p.x * 0.38, p.y * 0.34 + time * 0.14));
  float fineLace = fbm2D(vec2(p.x * 1.8, p.y * 2.2 + time * 0.22));

  // Mid-surf breaking swells (z ~ 8..22m)
  float surfZone = smoothstep(38.0, 10.0, p.y) * smoothstep(5.4, 7.4, p.y);
  float breakerCrest = smoothstep(0.54, 0.88, c1 * 0.72 + c2 * 0.44 + (breakNoise - 0.5) * 0.42) * surfZone;

  // Distinct foaming roller band on the right & left midground matching reference photo
  float leftRoller = exp(-pow((p.y - 13.8 - sin(p.x * 0.22) * 1.5) / 1.4, 2.0))
    * smoothstep(0.2, -3.5, p.x) * smoothstep(0.32, 0.72, c1 * 0.65 + fineLace * 0.55);
  float rightRoller = exp(-pow((p.y - 10.6 - cos(p.x * 0.26) * 1.2) / 1.15, 2.0))
    * smoothstep(1.2, 5.5, p.x) * smoothstep(0.30, 0.74, c2 * 0.65 + fineLace * 0.55);

  // Frothy shoreline surf line running along the beach edge
  float shoreCurve = 5.65 + sin(p.x * 0.34 + 0.6) * 0.32 + sin(time * 0.68 + p.x * 0.18) * 0.26;
  float shoreFoam = exp(-pow((p.y - shoreCurve) / 0.62, 2.0)) * (0.60 + 0.65 * fineLace);

  foam = saturate(breakerCrest * 0.78 + leftRoller * 0.85 + rightRoller * 0.90 + shoreFoam * 0.95);
  troughMask = saturate(1.0 - (s1 * 0.5 + 0.5));
  crestFoam = foam;
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

  float eps = clamp(dist * 0.0085, 0.045, 0.55);
  float foamC = 0.0, foamX = 0.0, foamZ = 0.0;
  float troughC = 0.0, troughX = 0.0, troughZ = 0.0;
  float hC = oceanWaveHeight(pos.xz, time, foamC, troughC);
  float hX = oceanWaveHeight(pos.xz + vec2(eps, 0.0), time, foamX, troughX);
  float hZ = oceanWaveHeight(pos.xz + vec2(0.0, eps), time, foamZ, troughZ);

  // Strong crisp wave normals in surf zone, gently softening toward distant horizon
  float normalScale = mix(1.35, 0.32, smoothstep(8.0, 95.0, dist));
  vec3 n = normalize(vec3((hC - hX) / eps * normalScale, 1.0, (hC - hZ) / eps * normalScale));

  vec3 v = -rd;
  float ndv = max(dot(n, v), 0.001);

  // Physically calibrated Fresnel: wave faces tilted toward camera stay rich deep indigo,
  // while wave backs & calm distant bands reflect the bright luminous sky!
  float fresnel = 0.02 + 0.98 * pow(1.0 - ndv, 4.4);
  fresnel = clamp(fresnel * 0.96, 0.02, 0.92);

  vec3 reflDir = reflect(rd, n);
  reflDir.y = abs(reflDir.y) * 0.82 + 0.012;
  vec3 skyRefl = evaluateSky(normalize(reflDir), time);

  // Deep saturated dusk navy-indigo ocean troughs (iconic rich contrast in the reference photo!)
  float rightTint = smoothstep(-0.25, 0.85, rd.x);
  vec3 deepWater = mix(vec3(0.009, 0.024, 0.068), vec3(0.018, 0.042, 0.088), rightTint) * uSkyExposure;
  // Steeper front faces of rolling swells read even darker marine indigo
  float frontFaceDarken = saturate(max(-n.z, 0.0) * 1.45);
  vec3 waterBody = mix(deepWater, deepWater * 0.42, frontFaceDarken * 0.72 + troughC * 0.25);

  vec3 col = mix(waterBody, skyRefl * 0.86, fresnel * (1.0 - frontFaceDarken * 0.48));

  // Silvery-warm reflection sheen across the right-hand ocean water
  vec3 sunDir = normalize(vec3(0.82, 0.07, 0.56));
  vec3 hSun = normalize(sunDir + v);
  float sunSpec = pow(max(dot(n, hSun), 0.0), 42.0) * 0.34 * uSunsetStrength * uSkyExposure;
  col += vec3(1.0, 0.82, 0.70) * sunSpec * smoothstep(7.0, 32.0, dist);

  // Subtle flickering amber reflection of campfire on closest surf water
  vec3 toFire = firePos - pos;
  float fireDist = length(toFire);
  vec3 lFire = toFire / max(fireDist, 0.001);
  vec3 hFire = normalize(lFire + v);
  float fireSpec = pow(max(dot(n, hFire), 0.0), 32.0);
  float fireAtten = 1.0 / (1.0 + fireDist * fireDist * 0.08);
  col += fireColor * fireSpec * fireAtten * 0.25;

  // Textured lacy whitewater foam crests & frothy surf edge
  float fineFoam = fbm2D(pos.xz * 2.9 + vec2(0.0, time * 0.24));
  float foamMask = saturate(foamC * (0.58 + 0.78 * fineFoam)) * smoothstep(95.0, 12.0, dist);
  vec3 foamColor = mix(vec3(0.24, 0.34, 0.52), vec3(0.58, 0.64, 0.74), rightTint * 0.7 + 0.3) * uSkyExposure;
  foamColor += fireColor * fireAtten * 0.04;
  col = mix(col, foamColor, foamMask * 0.82);

  // Crisp subtle horizon mist without washing out midground wave texture
  float fog = 1.0 - exp(-pow(max(dist - 22.0, 0.0) * 0.0085, 1.45));
  vec3 horizSky = evaluateSky(normalize(vec3(rd.x, 0.006, rd.z)), time);
  col = mix(col, horizSky, saturate(fog * 0.92));

  return col;
}
`;
