/**
 * 3D Volumetric Raymarched Campfire Shader Module.
 * Features multi-plume buoyant flame sculpting (central core, tall dancing tongues wrapping
 * around the vertical charred sticks, front plank gap licks, and right-branch crawling flame),
 * advected 3D domain-warped turbulence, physical blackbody emission, optical absorption,
 * and subtle rising twilight smoke wisps.
 */

export const FIRE_GLSL = /* glsl */ `
uniform float uFireGain;
uniform float uStoke;
uniform int uFireSteps;

// Evaluate distance to a line segment in 3D (for flame ribbons anchored to logs/branches)
float segDist3(vec3 p, vec3 a, vec3 b, out float t) {
  vec3 pa = p - a;
  vec3 ba = b - a;
  t = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  return length(pa - ba * t);
}

// Sample the 3D volumetric fire density, temperature, and subtle smoke at world point p.
// Returns vec3(flameTemp01, flameOpacity, smokeDensity)
vec3 sampleFireField(vec3 p, float time, float stoke) {
  // Subtle coastal sea breeze drifting slightly rightward & slightly back with organic gusts
  float gust = sin(time * 0.65) * 0.45 + sin(time * 1.43 + 1.1) * 0.25 + 0.35;
  float hNorm = saturate((p.y - 0.05) / 0.85);

  // Advected coordinates for buoyant swirling flame motion
  vec3 q = p;
  q.x -= gust * 0.085 * hNorm * hNorm;
  q.z -= gust * 0.025 * hNorm * hNorm;

  // Height-accelerated upward fluid flow
  float riseSpeed = 1.62 + stoke * 0.42;
  vec3 flow = q * vec3(3.1, 2.25, 3.1) - vec3(gust * 0.35, time * riseSpeed, 0.0);

  // Domain-warped 3D FBM for curling Kelvin-Helmholtz flame eddies
  vec3 warp = vec3(
    fbm3DFast(flow + vec3(1.7, 0.0, 3.1)) - 0.5,
    fbm3DFast(flow + vec3(5.2, 2.3, 1.4)) - 0.5,
    fbm3DFast(flow + vec3(2.9, 6.1, 7.8)) - 0.5
  );

  // Higher turbulence amplitude in the flickering tips, steadier incandescent base
  float turbAmp = mix(0.055, 0.235, pow(hNorm, 0.82)) * (1.0 + stoke * 0.16);
  vec3 wp = q + warp * turbAmp;

  // Secondary fine-scale licking flutter
  float detailTurb = fbm3DFast(wp * vec3(6.8, 5.2, 6.8) - vec3(0.0, time * (riseSpeed * 1.75), 0.0));

  // --- PLUME 1: Blazing central teepee core (peeking through the front planks & rising up) ---
  vec3 coreP = wp - vec3(0.0, 0.33, -0.015);
  float coreY = saturate((wp.y - 0.04) / (0.76 + stoke * 0.10));
  // Teardrop / tapered flame envelope: wide glowing belly inside planks, tapering into dancing tongues
  float coreRad = mix(0.245, 0.055, pow(coreY, 0.88)) * (1.0 + stoke * 0.10);
  coreRad *= smoothstep(-0.02, 0.13, wp.y);
  float dCore = length(coreP.xz * vec2(0.95, 1.05)) / max(coreRad, 0.001);
  float mainPlume = saturate(1.0 - dCore) * smoothstep(1.02, 0.16, coreY);

  // --- PLUME 2: Tall flickering tongue climbing up around the vertical charred sticks ---
  float swayL = sin(time * 3.1 + wp.y * 5.2) * 0.04;
  float swayR = cos(time * 2.6 + wp.y * 4.6) * 0.045;
  vec3 tongue1P = wp - vec3(-0.045 + swayL, 0.52, -0.01);
  float t1Y = saturate((wp.y - 0.22) / (0.64 + stoke * 0.12));
  float t1 = saturate(1.0 - length(tongue1P.xz) / mix(0.16, 0.025, pow(t1Y, 0.9)))
    * smoothstep(0.0, 0.18, t1Y) * smoothstep(1.0, 0.32, t1Y);

  vec3 tongue2P = wp - vec3(0.068 + swayR, 0.49, 0.015);
  float t2Y = saturate((wp.y - 0.24) / (0.58 + stoke * 0.11));
  float t2 = saturate(1.0 - length(tongue2P.xz) / mix(0.145, 0.022, pow(t2Y, 0.9)))
    * smoothstep(0.0, 0.16, t2Y) * smoothstep(1.0, 0.30, t2Y);

  // --- PLUME 3: Lively outer right-mid darting flame curl (signature detail from photo!) ---
  vec3 sideLickP = wp - vec3(0.175 + swayR * 0.7, 0.43, -0.02);
  float sideLick = saturate(1.0 - length(sideLickP * vec3(1.0, 1.35, 1.15)) / 0.125);

  // --- PLUME 4: Crawling golden flame licking up the right-hand leaning driftwood branch ---
  float branchT = 0.0;
  float dRightBranch = segDist3(
    wp - vec3(0.0, 0.055, 0.0),
    vec3(0.24, 0.25, -0.075),
    vec3(0.49, 0.045, -0.125),
    branchT
  );
  float branchEnv = sin(branchT * PI);
  float branchFlame = saturate(1.0 - dRightBranch / (0.078 * (0.55 + 0.55 * branchEnv)))
    * smoothstep(0.02, 0.22, branchT) * smoothstep(1.0, 0.65, branchT);
  // Extra small leaping tongue at the upper-middle of the right branch (just like photo!)
  vec3 branchTipP = wp - vec3(0.35 + swayL * 0.5, 0.24, -0.095);
  float branchLick = saturate(1.0 - length(branchTipP * vec3(1.15, 0.85, 1.25)) / 0.095);
  branchFlame = max(branchFlame * 0.88, branchLick * 0.92);

  // Combine flame plumes and carve crisp turbulent tongues using fine detail turbulence
  float shape = max(max(mainPlume, max(t1 * 0.96, t2 * 0.92)), max(sideLick * 0.84, branchFlame));
  float carved = shape - (0.38 - detailTurb * 0.48) * mix(0.32, 1.05, hNorm);

  // Sharp yet feathery flame edge transition
  float flameDensity = smoothstep(0.02, 0.42, carved);

  // Temperature peaks in dense protected inner core and cools smoothly toward wispy tips
  float innerHeat = smoothstep(0.06, 0.72, carved) * (0.95 + 0.25 * detailTurb);
  float baseHeatBoost = exp(-pow((p.y - 0.34) / 0.24, 2.0)) * exp(-dot(p.xz, p.xz) * 18.0) * 0.42;
  float temp01 = saturate(innerHeat * 0.88 + baseHeatBoost + stoke * 0.14);

  // Subtle translucent smoke wisps rising above the flame tips into twilight sky
  float smokeY = saturate((p.y - 0.56) / 0.95);
  float smokeRad = mix(0.14, 0.36, smokeY);
  float dSmoke = length((wp.xz - vec2(gust * 0.06 * smokeY, 0.0))) / smokeRad;
  float smokeMask = saturate(1.0 - dSmoke) * smoothstep(0.0, 0.25, smokeY) * smoothstep(1.0, 0.22, smokeY);
  float smokeDensity = smoothstep(0.34, 0.76, detailTurb) * smokeMask * 0.22;

  return vec3(temp01, flameDensity, smokeDensity);
}

// Ray-sphere intersection for skipping empty air outside campfire bounding volume
vec2 intersectSphere(vec3 ro, vec3 rd, vec3 center, float radius) {
  vec3 oc = ro - center;
  float b = dot(oc, rd);
  float c = dot(oc, oc) - radius * radius;
  float disc = b * b - c;
  if (disc < 0.0) return vec2(1e5, -1e5);
  float s = sqrt(disc);
  return vec2(-b - s, -b + s);
}

// Integrate 3D volumetric fire & smoke along camera ray, strictly occluded by solid scene depth tMax!
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
  // Tight bounding sphere enclosing all flames, right-branch lick, and rising smoke wisps
  vec3 volCenter = vec3(0.08, 0.56, -0.02);
  float volRadius = 0.96;
  vec2 hit = intersectSphere(ro, rd, volCenter, volRadius);
  if (hit.y < 0.0 || hit.x > tMax) return;

  float tStart = max(0.05, hit.x);
  float tEnd = min(tMax, hit.y);
  float span = tEnd - tStart;
  if (span <= 0.005) return;

  int steps = uFireSteps;
  float dt = span / float(steps);

  // Jitter ray start by spatiotemporal blue noise to completely eliminate slice banding
  float t = tStart + dt * jitter;

  vec3 fireLight = vec3(0.0);
  float transmittance = 1.0;

  for (int i = 0; i < 96; i++) {
    if (i >= steps || transmittance < 0.018) break;

    vec3 p = ro + rd * t;
    vec3 field = sampleFireField(p, time, stoke);
    float temp01 = field.x;
    float density = field.y;
    float smoke = field.z;

    if (density > 0.003) {
      // Physical Kelvin temperature curve: 1050K outer orange-red -> 3350K incandescent white-gold core
      float kelvin = mix(1080.0, 3380.0, pow(temp01, 1.18));
      vec3 emitCol = blackbodyColor(kelvin);

      // Strong HDR emission power for natural photographic AgX core & bloom
      float intensity = mix(2.2, 22.0, pow(temp01, 2.35)) * uFireGain * (1.0 + stoke * 0.35);

      // Optical self-absorption gives thick orange flames realistic depth over hotter core
      float sigmaT = density * 5.8;
      float stepAlpha = 1.0 - exp(-sigmaT * dt);

      fireLight += transmittance * emitCol * intensity * density * dt * 3.1;
      transmittance *= (1.0 - stepAlpha * 0.72);
    }

    if (smoke > 0.002) {
      // Subtle warm-lit twilight smoke rising above the tips
      float warmUnder = exp(-max(p.y - 0.62, 0.0) * 2.6);
      vec3 smokeCol = skyAmb * 0.36 + vec3(0.85, 0.36, 0.12) * warmUnder * 0.14;
      float smokeAlpha = 1.0 - exp(-smoke * 2.2 * dt);
      fireLight += transmittance * smokeCol * smokeAlpha;
      transmittance *= (1.0 - smokeAlpha * 0.55);
    }

    t += dt;
  }

  // Blend volumetric fire over the occluded solid/sky background
  accumColor = accumColor * transmittance + fireLight;
}
`;
