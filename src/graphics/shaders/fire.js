/**
 * 3D Volumetric Raymarched Campfire Shader Module.
 * High-contrast, sharp-edged photographic fire sculpted from a buoyant upward-streaming
 * turbulent combustion column with sinuous licking tongues wrapping around the vertical
 * charred branches, plus a ragged flickering flame climbing the right driftwood branch.
 */

export const FIRE_GLSL = /* glsl */ `
uniform float uFireGain;
uniform float uStoke;
uniform int uFireSteps;

float segDist3(vec3 p, vec3 a, vec3 b, out float t) {
  vec3 pa = p - a;
  vec3 ba = b - a;
  t = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * t);
}

// Sharp-edged turbulent flame density, temperature, and delicate rising smoke
// Returns vec3(flameTemp01, flameDensity, smokeDensity)
vec3 sampleFireField(vec3 p, float time, float stoke) {
  // Subtle coastal breeze leaning the upper tongues gently right & slightly back
  float gust = sin(time * 0.58) * 0.36 + sin(time * 1.41 + 0.9) * 0.22 + 0.22;
  float hNorm = saturate((p.y - 0.04) / 0.88);

  vec3 q = p;
  q.x -= gust * 0.082 * hNorm * hNorm;
  q.z -= gust * 0.022 * hNorm * hNorm;

  // Strongly vertically elongated advection gives genuine stretching flame tongues (never round blobs!)
  float rise = 1.95 + stoke * 0.50;
  vec3 flow1 = q * vec3(3.4, 1.45, 3.4) - vec3(gust * 0.28, time * rise, 0.0);
  vec3 flow2 = q * vec3(6.8, 2.75, 6.8) - vec3(gust * 0.45, time * (rise * 1.55), 0.0);

  // Two-octave domain warp creating crisp curling Kelvin-Helmholtz flame ribbons
  vec3 warp1 = vec3(
    fbm3DFast(flow1 + vec3(1.3, 0.0, 2.9)) - 0.5,
    fbm3DFast(flow1 + vec3(4.7, 1.9, 0.8)) - 0.5,
    fbm3DFast(flow1 + vec3(2.4, 5.6, 6.7)) - 0.5
  );
  vec3 warp2 = vec3(
    noise3D(flow2 + vec3(7.1, 2.2, 1.5)) - 0.5,
    noise3D(flow2 + vec3(3.3, 8.4, 4.1)) - 0.5,
    noise3D(flow2 + vec3(9.2, 1.1, 5.8)) - 0.5
  );

  // Narrow turbulence at core base -> sweeping fluidic curling flame folds & swirling licks up high!
  float turbAmp = mix(0.075, 0.315, pow(hNorm, 0.68)) * (1.0 + stoke * 0.15);
  vec3 wp = q + warp1 * turbAmp + warp2 * (turbAmp * 0.42);
  // Subtle helical swirl folds the straight vertical edges into organic curling fire ribbons!
  float swirlAng = (warp1.y * 1.85 + sin(time * 2.1 + q.y * 4.5) * 0.35) * hNorm;
  wp.xz = rot2(swirlAng) * wp.xz;

  // Vertically stretched sharp flame-tongue carving field (ridged billows!)
  float nBillow = fbm3DFast(wp * vec3(5.6, 2.5, 5.6) - vec3(0.0, time * (rise * 1.35), 0.0));
  float nLick = noise3D(wp * vec3(11.5, 4.8, 11.5) - vec3(0.0, time * (rise * 2.15), 0.0));
  float flameCurl = nBillow * 0.68 + nLick * 0.32;

  // --- 1. MAIN TEEPEE BUOYANT COMBUSTION COLUMN ---
  // Broad glowing belly inside the planks (y ~ 0.05..0.44) tapering into jagged licking spires (y -> 0.88)
  float colY = saturate((wp.y - 0.03) / (0.86 + stoke * 0.10));
  float baseRad = mix(0.245, 0.032, pow(colY, 0.76)) * (1.0 + stoke * 0.10);
  baseRad *= smoothstep(-0.02, 0.10, wp.y);

  // Asymmetric natural cross-section slightly wider horizontally along the driftwood gap
  vec2 radialP = (wp.xz - vec2(0.0, -0.015)) * vec2(0.88, 1.12);
  float dCol = length(radialP) / max(baseRad, 0.001);
  float mainShape = saturate(1.0 - dCol) * smoothstep(1.03, 0.18, colY);

  // --- 2. TWO ASYMMETRIC RISING TONGUES WRAPPING AROUND THE FORKED VERTICAL STICKS ---
  float swayA = sin(time * 3.1 + wp.y * 4.4) * 0.038;
  float swayB = cos(time * 2.6 + wp.y * 5.0) * 0.044;

  // Left-central tall flame ribbon licking up the left flank of the main charred branch
  float yA = saturate((wp.y - 0.24) / (0.64 + stoke * 0.11));
  float rA = mix(0.165, 0.020, pow(yA, 0.82));
  vec2 pA = wp.xz - vec2(-0.085 + swayA, -0.018);
  float tongueA = saturate(1.0 - length(pA * vec2(0.95, 1.15)) / max(rA, 0.001))
    * smoothstep(0.0, 0.16, yA) * smoothstep(1.0, 0.25, yA);

  // Right-central rising flame tongue curling past the right charred prong & darting outward-right
  float yB = saturate((wp.y - 0.26) / (0.60 + stoke * 0.10));
  float rB = mix(0.155, 0.022, pow(yB, 0.84));
  vec2 pB = wp.xz - vec2(0.072 + swayB + yB * 0.045, 0.008);
  float tongueB = saturate(1.0 - length(pB * vec2(0.92, 1.18)) / max(rB, 0.001))
    * smoothstep(0.0, 0.15, yB) * smoothstep(1.0, 0.22, yB);

  // --- 3. SHARP LICKING FLAMES CRAWLING UP THE RIGHT-LEANING DRIFTWOOD BRANCH ---
  // Anchored tightly above the branch spine with upward-stretched licking peaks
  float bt = 0.0;
  vec3 brStart = vec3(0.19, 0.305, -0.068);
  vec3 brEnd = vec3(0.50, 0.045, -0.130);
  // Shift sampling point slightly down so the flame rises UPWARD off the top bark surface
  float dBr = segDist3(wp - vec3(0.0, 0.042, 0.0), brStart, brEnd, bt);
  float brTap = smoothstep(0.02, 0.16, bt) * smoothstep(0.96, 0.56, bt);
  float brRibbon = saturate(1.0 - dBr / (0.046 * (0.65 + 0.55 * sin(bt * PI)))) * brTap;

  // One lively small upward flame lick dancing off the mid-right branch (signature detail from photo!)
  float yBL = saturate((wp.y - 0.12) / 0.26);
  vec2 pBL = wp.xz - vec2(0.375 + swayA * 0.45, -0.098);
  float brLick = saturate(1.0 - length(pBL * vec2(1.05, 1.3)) / mix(0.068, 0.012, pow(yBL, 0.85)))
    * smoothstep(0.0, 0.18, yBL) * smoothstep(1.0, 0.28, yBL);

  float branchShape = max(brRibbon * 0.90, brLick * 0.96);

  // Merge all buoyant combustion shapes
  float envelope = max(max(mainShape, max(tongueA * 0.98, tongueB * 0.96)), branchShape);

  // Carve sharp, dynamic turbulent edges & swirling cutouts!
  float carveStrength = mix(0.24, 0.86, pow(hNorm, 0.72));
  float carved = envelope - (0.48 - flameCurl * 0.62) * carveStrength;

  // CRISP photographic shutter-speed flame edge (sharp transition, ZERO milky fuzz!)
  float flameDensity = smoothstep(0.05, 0.18, carved);

  // High-contrast thermal core gradient:
  // Generous vivid tangerine-orange & molten gold outer ribbons + focused incandescent creamy-white heart!
  float coreHeat = smoothstep(0.10, 0.64, carved) * (0.82 + 0.26 * nBillow);
  float teepeeCoreBoost = exp(-pow((p.y - 0.38) / 0.21, 2.0)) * exp(-dot(p.xz, p.xz) * 20.0) * 0.42;
  float temp01 = saturate(coreHeat * 0.84 + teepeeCoreBoost + stoke * 0.11);

  // Subtle translucent smoke wisps drifting lazily above the flame tips
  float smokeY = saturate((p.y - 0.64) / 0.90);
  float smokeRad = mix(0.14, 0.36, smokeY);
  float dSmoke = length(wp.xz - vec2(gust * 0.08 * smokeY, 0.0)) / smokeRad;
  float smokeMask = saturate(1.0 - dSmoke) * smoothstep(0.0, 0.22, smokeY) * smoothstep(1.0, 0.18, smokeY);
  float smokeDensity = smoothstep(0.38, 0.78, nBillow) * smokeMask * 0.14;

  return vec3(temp01, flameDensity, smokeDensity);
}

vec2 intersectSphere(vec3 ro, vec3 rd, vec3 center, float radius) {
  vec3 oc = ro - center;
  float b = dot(oc, rd);
  float c = dot(oc, oc) - radius * radius;
  float disc = b * b - c;
  if (disc < 0.0) return vec2(1e5, -1e5);
  float s = sqrt(disc);
  return vec2(-b - s, -b + s);
}

void integrateVolumetricFire(
  vec3 ro,
  vec3 rd,
  float tMax,
  float time,
  float jitter,
  float stoke,
  vec3 skyAmb,
  inout vec3 accumColor
) {
  vec3 volCenter = vec3(0.06, 0.54, -0.02);
  float volRadius = 0.98;
  vec2 hit = intersectSphere(ro, rd, volCenter, volRadius);
  if (hit.y < 0.0 || hit.x > tMax) return;

  float tStart = max(0.05, hit.x);
  float tEnd = min(tMax, hit.y);
  float span = tEnd - tStart;
  if (span <= 0.005) return;

  int steps = uFireSteps;
  float dt = span / float(steps);
  float t = tStart + dt * jitter;

  vec3 fireLight = vec3(0.0);
  float transmittance = 1.0;

  for (int i = 0; i < 96; i++) {
    if (i >= steps || transmittance < 0.012) break;

    vec3 p = ro + rd * t;
    vec3 field = sampleFireField(p, time, stoke);
    float temp01 = field.x;
    float density = field.y;
    float smoke = field.z;

    if (density > 0.004) {
      // Rich photographic campfire palette:
      // Vivid crimson-tangerine curls -> saturated molten amber-gold -> blinding pale yellow-white core
      vec3 tipOrange = vec3(1.0, 0.14, 0.005);
      vec3 midGold = vec3(1.0, 0.50, 0.032);
      vec3 hotCore = vec3(1.0, 0.94, 0.68);

      vec3 emitCol = mix(tipOrange, midGold, smoothstep(0.06, 0.58, temp01));
      emitCol = mix(emitCol, hotCore, smoothstep(0.66, 0.96, temp01));

      float kelvin = mix(1020.0, 3250.0, pow(temp01, 1.32));
      emitCol = mix(emitCol, blackbodyColor(kelvin), 0.24);

      // Moderate HDR in orange outer skirts keeps rich fire color through AgX; inner core blazes white-gold!
      float intensity = mix(1.9, 17.5, pow(temp01, 2.65)) * uFireGain * (1.0 + stoke * 0.34);

      float sigmaT = density * 9.5;
      float stepAlpha = 1.0 - exp(-sigmaT * dt);

      fireLight += transmittance * emitCol * intensity * stepAlpha * 0.92;
      transmittance *= (1.0 - stepAlpha * 0.88);
    }

    if (smoke > 0.002) {
      float warmUnder = exp(-max(p.y - 0.65, 0.0) * 2.5);
      vec3 smokeCol = skyAmb * 0.30 + vec3(0.95, 0.36, 0.09) * warmUnder * 0.14;
      float smokeAlpha = 1.0 - exp(-smoke * 1.9 * dt);
      fireLight += transmittance * smokeCol * smokeAlpha;
      transmittance *= (1.0 - smokeAlpha * 0.44);
    }

    t += dt;
  }

  accumColor = accumColor * transmittance + fireLight;
}
`;
