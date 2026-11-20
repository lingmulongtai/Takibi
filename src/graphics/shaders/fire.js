/**
 * 3D Volumetric Raymarched Campfire Shader Module.
 * Full-bodied, roaring photographic campfire volume with:
 * - Wide incandescent teepee heart shining fiercely through the front plank gap
 * - Lush, billowing golden-amber & incandescent white-yellow flames enveloping the tall charred sticks
 * - Lively outer curling flame wings & detached licking tips
 * - Continuous golden-orange flame ribbon crawling up the right-leaning driftwood branch
 * - Translucent warm-lit smoke wisps dissolving gently into the twilight air
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

// Returns vec3(flameTemp01, flameDensity, smokeDensity)
vec3 sampleFireField(vec3 p, float time, float stoke) {
  // Subtle organic coastal sea breeze
  float gust = sin(time * 0.62) * 0.42 + sin(time * 1.38 + 1.1) * 0.24 + 0.26;
  float hNorm = saturate((p.y - 0.06) / 0.86);

  // Advect coordinates gently downwind as flame rises
  vec3 q = p;
  q.x -= gust * 0.075 * hNorm * hNorm;
  q.z -= gust * 0.020 * hNorm * hNorm;

  float riseSpeed = 1.72 + stoke * 0.45;
  vec3 flow = q * vec3(2.85, 2.15, 2.85) - vec3(gust * 0.30, time * riseSpeed, 0.0);

  // Domain-warped 3D curl-like turbulence creating organic billowing flame sheets
  vec3 warp = vec3(
    fbm3DFast(flow + vec3(1.7, 0.0, 3.1)) - 0.5,
    fbm3DFast(flow + vec3(5.2, 2.3, 1.4)) - 0.5,
    fbm3DFast(flow + vec3(2.9, 6.1, 7.8)) - 0.5
  );

  float turbAmp = mix(0.06, 0.24, pow(hNorm, 0.78)) * (1.0 + stoke * 0.15);
  vec3 wp = q + warp * turbAmp;

  // High-frequency licking flame flutter
  float detailTurb = fbm3DFast(wp * vec3(6.2, 4.8, 6.2) - vec3(0.0, time * (riseSpeed * 1.65), 0.0));
  float fineFlick = noise3D(wp * 12.5 - vec3(0.0, time * (riseSpeed * 2.5), 0.0));

  // --- PLUME 1: Full-bodied roaring central teepee inferno ---
  vec3 coreP = wp - vec3(0.0, 0.34, -0.01);
  float coreY = saturate((wp.y - 0.02) / (0.82 + stoke * 0.10));
  // Generous wide flame body rising straight above the split planks, tapering into sharp peaks
  float coreRad = mix(0.285, 0.065, pow(coreY, 0.86)) * (1.0 + stoke * 0.10);
  coreRad *= smoothstep(-0.02, 0.11, wp.y);
  float dCore = length(coreP.xz * vec2(0.92, 1.08)) / max(coreRad, 0.001);
  float mainPlume = saturate(1.0 - dCore) * smoothstep(1.02, 0.12, coreY);

  // --- PLUME 2: Tall blazing tongues climbing & curling around the forked vertical charred sticks ---
  float swayL = sin(time * 2.9 + wp.y * 4.8) * 0.042;
  float swayR = cos(time * 2.5 + wp.y * 4.4) * 0.048;

  // Left-center roaring sheet wrapping behind/around the tall main charred branch
  vec3 t1P = wp - vec3(-0.075 + swayL, 0.54, -0.005);
  float t1Y = saturate((wp.y - 0.22) / (0.68 + stoke * 0.12));
  float t1 = saturate(1.0 - length(t1P.xz) / mix(0.215, 0.032, pow(t1Y, 0.85)))
    * smoothstep(0.0, 0.16, t1Y) * smoothstep(1.0, 0.24, t1Y);

  // Right-center tall licking plume climbing past the right fork
  vec3 t2P = wp - vec3(0.082 + swayR, 0.52, 0.012);
  float t2Y = saturate((wp.y - 0.22) / (0.64 + stoke * 0.11));
  float t2 = saturate(1.0 - length(t2P.xz) / mix(0.195, 0.028, pow(t2Y, 0.86)))
    * smoothstep(0.0, 0.15, t2Y) * smoothstep(1.0, 0.22, t2Y);

  // --- PLUME 3: Iconic darting flame wings on left & right shoulders of the teepee ---
  vec3 leftWingP = wp - vec3(-0.205 + swayL * 0.8, 0.44, -0.02);
  float leftWing = saturate(1.0 - length(leftWingP * vec3(0.95, 1.25, 1.15)) / 0.155);

  vec3 rightWingP = wp - vec3(0.215 + swayR * 0.9, 0.46, -0.015);
  float rightWing = saturate(1.0 - length(rightWingP * vec3(0.95, 1.22, 1.15)) / 0.165);

  // --- PLUME 4: Continuous glowing flame ribbon & leaping tongue crawling up the right driftwood branch ---
  float branchT = 0.0;
  float dRightBranch = segDist3(
    wp - vec3(0.0, 0.062, 0.0),
    vec3(0.20, 0.28, -0.068),
    vec3(0.51, 0.035, -0.128),
    branchT
  );
  float branchEnv = sin(branchT * PI);
  float branchFlame = saturate(1.0 - dRightBranch / (0.088 * (0.55 + 0.60 * branchEnv)))
    * smoothstep(0.02, 0.18, branchT) * smoothstep(1.0, 0.62, branchT);
  vec3 branchTipP = wp - vec3(0.365 + swayL * 0.5, 0.25, -0.095);
  float branchLick = saturate(1.0 - length(branchTipP * vec3(1.1, 0.80, 1.25)) / 0.115);
  branchFlame = max(branchFlame * 0.94, branchLick * 0.96);

  // Combine plumes and carve ragged, dynamic curling edges with multi-scale turbulence
  float shape = max(
    max(mainPlume, max(t1 * 0.98, t2 * 0.96)),
    max(max(leftWing * 0.86, rightWing * 0.90), branchFlame)
  );
  float carveNoise = detailTurb * 0.68 + fineFlick * 0.32;
  float carved = shape - (0.36 - carveNoise * 0.48) * mix(0.24, 0.98, hNorm);

  // Crisp photographic flame silhouette with delicate wispy tips
  float flameDensity = smoothstep(0.015, 0.36, carved);

  // Rich color temperature gradient:
  // Deep fiery orange-red at outer curling wisps (0.0..0.38),
  // Vivid molten golden-amber mid-flame (0.38..0.72),
  // Incandescent creamy yellow-white blazing core (0.72..1.0)!
  float innerHeat = smoothstep(0.04, 0.78, carved) * (0.90 + 0.26 * detailTurb);
  float baseCoreBoost = exp(-pow((p.y - 0.38) / 0.26, 2.0)) * exp(-dot(p.xz, p.xz) * 14.0) * 0.38;
  float temp01 = saturate(innerHeat * 0.86 + baseCoreBoost + stoke * 0.12);

  // Translucent warm-lit smoke rising softly above the apex into twilight sky
  float smokeY = saturate((p.y - 0.62) / 0.92);
  float smokeRad = mix(0.15, 0.38, smokeY);
  float dSmoke = length((wp.xz - vec2(gust * 0.07 * smokeY, 0.0))) / smokeRad;
  float smokeMask = saturate(1.0 - dSmoke) * smoothstep(0.0, 0.24, smokeY) * smoothstep(1.0, 0.20, smokeY);
  float smokeDensity = smoothstep(0.36, 0.78, detailTurb) * smokeMask * 0.16;

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
  vec3 volCenter = vec3(0.08, 0.56, -0.02);
  float volRadius = 1.02;
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
    if (i >= steps || transmittance < 0.015) break;

    vec3 p = ro + rd * t;
    vec3 field = sampleFireField(p, time, stoke);
    float temp01 = field.x;
    float density = field.y;
    float smoke = field.z;

    if (density > 0.003) {
      // Calibrated fire color ramp: vivid ember-orange outer curls -> molten gold -> creamy white core
      vec3 deepOrange = vec3(1.0, 0.16, 0.012);
      vec3 moltenGold = vec3(1.0, 0.54, 0.065);
      vec3 whiteHot = vec3(1.0, 0.94, 0.74);

      vec3 emitCol = mix(deepOrange, moltenGold, smoothstep(0.08, 0.58, temp01));
      emitCol = mix(emitCol, whiteHot, smoothstep(0.58, 0.96, temp01));

      // Blend slightly with physical blackbody for organic chromatic variation
      float kelvin = mix(1050.0, 3250.0, pow(temp01, 1.2));
      emitCol = mix(emitCol, blackbodyColor(kelvin), 0.35);

      float intensity = mix(2.6, 20.5, pow(temp01, 2.05)) * uFireGain * (1.0 + stoke * 0.34);

      // Rich optical opacity so billowing orange flames look substantial & luminous against twilight sea
      float sigmaT = density * 7.2;
      float stepAlpha = 1.0 - exp(-sigmaT * dt);

      fireLight += transmittance * emitCol * intensity * density * dt * 4.2;
      transmittance *= (1.0 - stepAlpha * 0.80);
    }

    if (smoke > 0.002) {
      float warmUnder = exp(-max(p.y - 0.65, 0.0) * 2.5);
      vec3 smokeCol = skyAmb * 0.32 + vec3(0.95, 0.38, 0.10) * warmUnder * 0.16;
      float smokeAlpha = 1.0 - exp(-smoke * 2.0 * dt);
      fireLight += transmittance * smokeCol * smokeAlpha;
      transmittance *= (1.0 - smokeAlpha * 0.48);
    }

    t += dt;
  }

  accumColor = accumColor * transmittance + fireLight;
}
`;
