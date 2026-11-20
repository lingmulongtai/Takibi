/**
 * Twilight coastal sky, sunset afterglow cloud deck, and animated multi-swell dusk ocean.
 * Tuned to match the cool periwinkle-slate left sky, luminous pearl center horizon,
 * warm coral-peach right afterglow, and rolling white-crested twilight waves.
 */

export const SKY_OCEAN_GLSL = /* glsl */ `
uniform float uSkyExposure;
uniform float uSunsetStrength;
uniform float uStarVisibility;

vec3 evaluateSky(vec3 rd, float time) {
  float elev = max(rd.y, 0.0);
  // Azimuth across screen: negative left, positive right
  float az = clamp(rd.x * 1.15, -1.0, 1.0);
  float rightWarmth = smoothstep(-0.25, 0.95, az);
  float farRight = smoothstep(0.28, 1.0, az);

  // Base vertical twilight gradient: cool slate-periwinkle left -> brighter azure right
  vec3 zenithLeft = vec3(0.11, 0.175, 0.36);
  vec3 zenithRight = vec3(0.22, 0.32, 0.50);
  vec3 zenithCol = mix(zenithLeft, zenithRight, rightWarmth);

  // Mid-sky luminous cool blue-lavender band
  vec3 midLeft = vec3(0.26, 0.33, 0.50);
  vec3 midRight = vec3(0.56, 0.62, 0.72);
  vec3 midCol = mix(midLeft, midRight, rightWarmth);

  // Horizon haze: misty violet-slate on left -> pearlescent cream center -> warm peach-rose right
  vec3 horizLeft = vec3(0.24, 0.27, 0.40);
  vec3 horizCenter = vec3(0.68, 0.66, 0.72);
  vec3 horizPeach = vec3(0.96, 0.58, 0.49);
  vec3 horizCoral = vec3(1.06, 0.44, 0.42);

  vec3 horizCol = mix(horizLeft, horizCenter, smoothstep(-0.75, 0.22, az));
  vec3 warmGlow = mix(horizPeach, horizCoral, smoothstep(0.52, 0.98, az));
  horizCol = mix(horizCol, warmGlow, farRight * 0.85 * uSunsetStrength);

  // Vertical blending with smooth atmospheric scale height
  vec3 sky = mix(horizCol, midCol, smoothstep(0.0, 0.22, elev));
  sky = mix(sky, zenithCol, smoothstep(0.14, 0.62, elev));

  // Soft low-elevation solar afterglow bloom off to the right horizon
  vec3 sunDir = normalize(vec3(0.86, 0.025, 0.51));
  float sunDot = max(dot(rd, sunDir), 0.0);
  vec3 afterglow = vec3(1.0, 0.52, 0.38) * pow(sunDot, 5.0) * 0.28 * uSunsetStrength;
  afterglow += vec3(1.0, 0.72, 0.56) * pow(sunDot, 16.0) * 0.18 * uSunsetStrength;
  sky += afterglow * exp(-elev * 5.2);

  // Delicate stratified dusk clouds projected onto a curved marine cloud deck
  if (rd.y > 0.002) {
    float cloudT = 1.0 / (rd.y + 0.115);
    vec2 cloudUv = rd.xz * cloudT * 0.42 + vec2(time * 0.0032, -time * 0.0014);

    // Stretched horizontal marine stratus bands
    vec2 stretched = vec2(cloudUv.x * 0.62, cloudUv.y * 1.85);
    float c1 = fbm2D(stretched * 1.45 + vec2(2.3, 1.1));
    float c2 = fbm2D(stretched * 3.1 - vec2(c1 * 0.75, time * 0.002));
    float cloudMask = smoothstep(0.46, 0.78, c1 * 0.7 + c2 * 0.35);

    // Stronger soft bank on the left twilight horizon + delicate wispy pink clouds on right
    float leftBank = smoothstep(0.28, -0.65, az) * smoothstep(0.26, 0.02, elev) * 0.75;
    float rightWisps = smoothstep(0.32, 0.92, az) * smoothstep(0.18, 0.015, elev) * smoothstep(0.54, 0.80, c2);
    float elevFade = smoothstep(0.002, 0.038, elev) * smoothstep(0.46, 0.07, elev);

    vec3 leftCloudCol = mix(vec3(0.21, 0.24, 0.38), vec3(0.36, 0.34, 0.48), c2);
    vec3 rightCloudCol = mix(vec3(0.86, 0.48, 0.46), vec3(1.06, 0.62, 0.50), c2);
    vec3 cloudCol = mix(leftCloudCol, rightCloudCol, smoothstep(-0.1, 0.75, az) * uSunsetStrength);

    float totalCloud = saturate(cloudMask * elevFade * (0.42 + leftBank * 0.65));
    sky = mix(sky, cloudCol, totalCloud * 0.62);
    sky = mix(sky, vec3(1.05, 0.50, 0.48) * uSunsetStrength + leftCloudCol * (1.0 - uSunsetStrength), rightWisps * 0.48);
  }

  // Subtle horizon marine mist band
  float horizonMist = exp(-elev * 24.0);
  vec3 mistCol = mix(vec3(0.32, 0.35, 0.48), vec3(0.74, 0.66, 0.68), smoothstep(-0.5, 0.8, az));
  sky = mix(sky, mistCol, horizonMist * 0.28);

  // Subtle evening stars (barely visible in twilight, crisp in blue hour & night)
  if (uStarVisibility > 0.01 && elev > 0.08) {
    vec2 starGrid = floor((rd.xz / (rd.y + 0.35)) * 185.0);
    float starHash = hash12(starGrid);
    if (starHash > 0.9945) {
      vec2 cellUv = fract((rd.xz / (rd.y + 0.35)) * 185.0) - 0.5;
      float d = length(cellUv);
      float twinkle = 0.75 + 0.25 * sin(time * 2.2 + starHash * 400.0);
      float starBright = smoothstep(0.16, 0.0, d) * twinkle * smoothstep(0.08, 0.28, elev);
      vec3 starCol = mix(vec3(0.82, 0.90, 1.0), vec3(1.0, 0.92, 0.80), fract(starHash * 73.1));
      sky += starCol * starBright * 0.9 * uStarVisibility;
    }
  }

  return sky * uSkyExposure;
}

// Multi-directional rolling coastal swells + fine capillary wind ripples
float oceanWaveHeight(vec2 p, float time, out float crestFoam) {
  float h = 0.0;
  float foam = 0.0;

  // Primary shoreward rolling swells (moving toward negative Z = toward camera/beach)
  float swell1Phase = p.y * 0.68 + time * 0.62 + sin(p.x * 0.19 + 0.5) * 0.9;
  float s1 = sin(swell1Phase);
  float c1 = pow(saturate(s1 * 0.5 + 0.5), 2.4);
  h += (s1 * 0.5 + c1 * 0.45) * 0.12;

  float swell2Phase = p.y * 1.18 + p.x * 0.14 + time * 0.92 + noise2D(p * 0.12) * 1.6;
  float s2 = sin(swell2Phase);
  float c2 = pow(saturate(s2 * 0.5 + 0.5), 3.0);
  h += (s2 * 0.4 + c2 * 0.5) * 0.068;

  // Breaking wave crests at realistic surf distances (z ~ 8..26m)
  float surfZone = smoothstep(42.0, 9.5, p.y) * smoothstep(5.4, 7.6, p.y);
  float breakNoise = fbm2D(vec2(p.x * 0.42, p.y * 0.35 + time * 0.18));
  foam += smoothstep(0.56, 0.92, c1 * 0.75 + c2 * 0.45 + (breakNoise - 0.5) * 0.38) * surfZone;

  // Cross-sea chop & wind waves
  vec2 q = p;
  q.x += sin(p.y * 0.45 + time * 0.35) * 0.6;
  h += (noise2D(vec2(q.x * 0.85, q.y * 1.45 + time * 0.75)) - 0.5) * 0.065;
  h += (noise2D(vec2(q.x * 2.1 - time * 0.3, q.y * 3.2 + time * 1.15)) - 0.5) * 0.028;
  h += (noise2D(vec2(q.x * 5.2 + time * 0.5, q.y * 7.8 + time * 1.65)) - 0.5) * 0.011;

  // Frothy shoreline swash / breaking whitewater along beach edge (z ~ 5.6..7.4)
  float shoreWave = sin(time * 0.72 + sin(p.x * 0.38) * 1.2) * 0.35;
  float shoreDist = p.y - (5.85 + shoreWave);
  float shoreFoam = exp(-pow(shoreDist / 0.78, 2.0)) * (0.65 + 0.55 * breakNoise);
  float secondaryBreaker = exp(-pow((p.y - 11.5 - sin(p.x * 0.15 + 1.2) * 1.8) / 1.45, 2.0))
    * smoothstep(0.32, 0.78, c1 * 0.7 + breakNoise * 0.55);
  foam = saturate(foam + shoreFoam * 0.88 + secondaryBreaker * 0.62);

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

  // Distance-scaled finite difference step to avoid horizon shimmer aliasing
  float eps = clamp(dist * 0.0085, 0.045, 0.65);
  float foamC = 0.0, foamX = 0.0, foamZ = 0.0;
  float hC = oceanWaveHeight(pos.xz, time, foamC);
  float hX = oceanWaveHeight(pos.xz + vec2(eps, 0.0), time, foamX);
  float hZ = oceanWaveHeight(pos.xz + vec2(0.0, eps), time, foamZ);

  // Dampen high-frequency normal slope toward distant horizon
  float normalScale = mix(1.0, 0.24, smoothstep(8.0, 110.0, dist));
  vec3 n = normalize(vec3((hC - hX) / eps * normalScale, 1.0, (hC - hZ) / eps * normalScale));

  vec3 v = -rd;
  float ndv = max(dot(n, v), 0.001);

  // Schlick Fresnel for seawater (F0 = 0.02)
  float fresnel = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
  fresnel = clamp(fresnel * 1.12, 0.03, 0.96);

  vec3 reflDir = reflect(rd, n);
  reflDir.y = abs(reflDir.y) * 0.88 + 0.015;
  vec3 skyRefl = evaluateSky(normalize(reflDir), time);

  // Deep dusk seawater body color (darker cool indigo on steeper camera-facing troughs)
  float rightTint = smoothstep(-0.2, 0.85, rd.x);
  vec3 deepWater = mix(vec3(0.012, 0.024, 0.056), vec3(0.022, 0.042, 0.072), rightTint) * uSkyExposure;
  vec3 shallowScatter = vec3(0.03, 0.068, 0.115) * uSkyExposure * smoothstep(22.0, 6.0, pos.z);
  vec3 waterBody = deepWater + shallowScatter * (0.4 + 0.6 * max(n.z, 0.0));

  vec3 col = mix(waterBody, skyRefl * 0.92, fresnel);

  // Subtle silvery-peach grazing sheen across calm right-side ocean swells
  vec3 sunDir = normalize(vec3(0.84, 0.06, 0.54));
  vec3 hSun = normalize(sunDir + v);
  float sunSpec = pow(max(dot(n, hSun), 0.0), 48.0) * 0.24 * uSunsetStrength * uSkyExposure;
  col += vec3(1.0, 0.78, 0.66) * sunSpec * smoothstep(7.0, 35.0, dist);

  // Subtle warm flickering campfire reflection glinting on near shoreline waves
  vec3 toFire = firePos - pos;
  float fireDist = length(toFire);
  vec3 lFire = toFire / max(fireDist, 0.001);
  vec3 hFire = normalize(lFire + v);
  float fireSpec = pow(max(dot(n, hFire), 0.0), 36.0);
  float fireAtten = 1.0 / (1.0 + fireDist * fireDist * 0.09);
  col += fireColor * fireSpec * fireAtten * 0.35;

  // Textured twilight whitewater / foam crests (cool dusky white, never over-bright)
  float fineFoam = fbm2D(pos.xz * 2.8 + vec2(0.0, time * 0.25));
  float foamMask = saturate(foamC * (0.55 + 0.75 * fineFoam)) * smoothstep(85.0, 12.0, dist);
  vec3 foamColor = mix(vec3(0.24, 0.31, 0.44), vec3(0.56, 0.60, 0.69), rightTint * 0.75 + 0.25) * uSkyExposure;
  foamColor += fireColor * fireAtten * 0.06;
  col = mix(col, foamColor, foamMask * 0.76);

  // Atmospheric sea haze blending ocean cleanly into horizon sky
  float fog = 1.0 - exp(-pow(max(dist - 14.0, 0.0) * 0.0095, 1.35));
  vec3 horizSky = evaluateSky(normalize(vec3(rd.x, 0.008, rd.z)), time);
  col = mix(col, horizSky, saturate(fog));

  return col;
}
`;
