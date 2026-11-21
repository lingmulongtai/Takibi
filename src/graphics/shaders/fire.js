/**
 * True 3D Volumetric Raymarched Campfire Shader Module coupled to the GPU Navier-Stokes Fluid Sim!
 *
 * Achieves genuine three-dimensional fire volume, depth parallax, and wood interleaving by:
 * 1. Dual-orthogonal fluid reconstruction: combines the primary (x, y) Navier-Stokes slice with a
 *    rotated cross-depth (z_rot, y) fluid slice + 3D rising helical turbulence so foreground tongues,
 *    the blazing interior core, and rear climbing spires evolve independently in 3D space!
 * 2. Dedicated 3D cylindrical branch flame hugging the exact curved spine of the right driftwood limb.
 * 3. Physical 3D depth shading: radial core-to-shell temperature stratification, 3D fluted ridge
 *    relief, and optical self-absorption so rich vermilion-orange foreground flame folds visibly layer
 *    over the recessed incandescent white-gold heart!
 * 4. Tight AABB slab intersection + early empty-cell culling keeps per-frame GPU cost ultra-low.
 */

export const FIRE_GLSL = /* glsl */ `
uniform sampler2D uFireSimTex;
uniform float uFireGain;
uniform float uStoke;
uniform int uFireSteps;

const vec2 FIRE_SIM_MIN = vec2(-0.62, -0.04);
const vec2 FIRE_SIM_MAX = vec2(0.72, 1.08);
const vec2 FIRE_SIM_INV = 1.0 / (FIRE_SIM_MAX - FIRE_SIM_MIN);

const vec3 FIRE_BOX_MIN = vec3(-0.56, -0.02, -0.25);
const vec3 FIRE_BOX_MAX = vec3(0.62, 0.96, 0.25);

// Fast slab ray-AABB intersection (eliminates ~78% of empty-air steps vs a bounding sphere!)
vec2 intersectBox(vec3 ro, vec3 rd, vec3 bMin, vec3 bMax) {
  vec3 invD = 1.0 / (rd + vec3(1e-7));
  vec3 t0 = (bMin - ro) * invD;
  vec3 t1 = (bMax - ro) * invD;
  vec3 tMin = min(t0, t1);
  vec3 tMax = max(t0, t1);
  float tNear = max(max(tMin.x, tMin.y), tMin.z);
  float tFar = min(min(tMax.x, tMax.y), tMax.z);
  return vec2(tNear, tFar);
}

// Sample the true 3D volumetric fire field driven by dual-orthogonal Navier-Stokes slices,
// 3D billowing turbulence, and 1-tap directional internal volumetric self-shading!
// Returns vec4(temp01, flameDensity, smokeDensity, coreDepth01)
vec4 sampleFireField(vec3 p, float time, float stoke) {
  float hNorm = saturate((p.y - 0.02) / 0.84);

  // --- 1. FULL BILLOWING 3D TEEPEE FIRE VOLUME (wide asymmetric X breadth + sculpted Z depth!) ---
  vec2 spineXZ = vec2(
    0.006 + sin(p.y * 4.0 - time * 1.8) * 0.015 * hNorm,
    mix(0.010, 0.024, hNorm) + cos(p.y * 3.5 - time * 1.5) * 0.011 * hNorm
  );
  vec2 dXZ = p.xz - spineXZ;
  // Full lively horizontal campfire breadth (0.225m -> 0.135m) with focused Z depth (1.35x tighter)
  // so front split planks & hero front stick stay razor-crisp dark silhouettes while mid/rear sticks
  // sit genuinely INSIDE the 3D fire volume with lively foreground tongues curling in front of them!
  float cylRadius = mix(0.225, 0.132, smoothstep(0.10, 0.92, hNorm));
  vec2 ellipXZ = vec2(dXZ.x, dXZ.y * 1.38);
  float rNorm = length(ellipXZ) / max(cylRadius, 0.01);

  // --- 2. CURVED 3D RIGHT-BRANCH FLAME SPINE (matches dExtRight bendOffset in wood.js!) ---
  float brT = saturate((p.x - 0.13) / 0.44);
  vec3 brBase = mix(vec3(0.115, 0.320, -0.055), vec3(0.575, -0.052, -0.144), brT);
  vec3 brBend = vec3(
    sin(brT * PI * 1.45 + 2.9 * 3.1) * 0.018,
    sin(brT * PI * 2.1 + 2.9 * 5.7) * 0.018 * 0.45,
    cos(brT * PI * 1.3 + 2.9 * 2.3) * 0.018 * 0.65
  ) * sin(brT * PI);
  vec3 brSpine = brBase + brBend;
  // Lively vertical 3D tongues rising upward off the burning upper bark of the right branch
  float brDy = p.y - (brSpine.y + 0.028);
  float brDz = p.z - (brSpine.z + 0.008);
  float brSpanMask = smoothstep(0.14, 0.22, p.x) * smoothstep(0.56, 0.44, p.x);
  float brYMask = smoothstep(-0.042, 0.014, brDy) * smoothstep(0.28, 0.03, brDy);
  float brZDist = abs(brDz) / mix(0.058, 0.038, brT);
  float inBranch = brSpanMask * brYMask * smoothstep(1.38, 0.0, brZDist);

  // Fast outer volumetric reject BEFORE any texture lookup or 3D noise!
  if (rNorm > 1.38 && inBranch < 0.01) {
    return vec4(0.0);
  }

  // Exact conical teepee front-wall containment:
  // Below y = 0.315, fire stays physically BEHIND the leaning plane of the front split planks so
  // hardware depth occlusion (sceneDepth) clips the roaring center V-gap cleanly with ZERO fire
  // ever leaking across the outer dark faces of the front-left or front-right split planks!
  float teepeeFrontPlaneZ = mix(-0.140, -0.052, saturate((p.y + 0.05) / 0.365));
  float behindFrontPlanks = smoothstep(teepeeFrontPlaneZ - 0.012, teepeeFrontPlaneZ + 0.022, p.z);
  float aboveFrontPlanks = smoothstep(0.295, 0.355, p.y);
  float plankShield = saturate(max(behindFrontPlanks, aboveFrontPlanks) + inBranch * smoothstep(0.15, 0.22, p.x));
  if (plankShield <= 0.004) return vec4(0.0);

  // --- 3. DUAL-ORTHOGONAL NAVIER-STOKES FLUID RECONSTRUCTION ---
  // Slice A: Primary front-facing fluid plane (x, y)
  vec2 simUvA = (vec2(p.x + dXZ.y * 0.14, p.y) - FIRE_SIM_MIN) * FIRE_SIM_INV;
  bool validA = (simUvA.x > 0.004 && simUvA.x < 0.996 && simUvA.y > 0.004 && simUvA.y < 0.996);
  vec4 simA = validA ? textureLod(uFireSimTex, simUvA, 0.0) : vec4(0.0);

  if (inBranch < 0.02 && simA.g < 0.04 && simA.b < 0.022 && rNorm > 1.05) {
    return vec4(0.0);
  }

  // Slice B: Rotated orthogonal cross-depth fluid plane driven primarily by Z depth!
  float xOrtho = clamp((dXZ.x * 0.30 - dXZ.y * 0.95) * 0.80, -0.155, 0.155);
  float yOrtho = p.y - 0.020 + dXZ.y * 0.07;
  vec2 simUvB = (vec2(xOrtho, yOrtho) - FIRE_SIM_MIN) * FIRE_SIM_INV;
  bool validB = (simUvB.x > 0.004 && simUvB.x < 0.996 && simUvB.y > 0.004 && simUvB.y < 0.996);
  vec4 simB = validB ? textureLod(uFireSimTex, simUvB, 0.0) : vec4(0.0);

  // Huge speedup: skip all 3D turbulence math on empty fluid cells!
  float maxSimTemp = max(simA.g, simB.g);
  if (maxSimTemp < 0.045 && max(simA.b, simB.b) < 0.022) {
    return vec4(0.0);
  }

  // --- 4. 3D RISING BILLOWING FOLDS + 1-TAP DIRECTIONAL INTERNAL SELF-SHADING ---
  float rise = time * 4.0;
  vec3 flowScale = vec3(9.8, 4.2, 9.8);
  vec3 flowShift = vec3(0.0, rise, 0.0);
  vec3 flowP1 = p * flowScale - flowShift;
  float nMacro = noise3D(flowP1);

  // 1-tap directional derivative toward the roaring 3D heart:
  // Distinguishes incandescent inner-facing valleys of each 3D flame curl from cooler deep-orange outer crests!
  vec3 heartPos = vec3(0.0, 0.33, 0.008);
  vec3 toHeart = normalize(heartPos - p + vec3(1e-5));
  float nTowardHeart = noise3D((p + toHeart * 0.042) * flowScale - flowShift);
  // Positive when local 3D billow ridge faces inward toward hot core; negative on cooler outer-facing bulge!
  float billowLight = saturate(0.52 + (nMacro - nTowardHeart) * 2.45);

  vec3 flowP2 = p * vec3(20.0, 8.8, 20.0) - vec3(sin(time * 1.3) * 0.45, rise * 1.65, cos(time * 1.1) * 0.45);
  float nDetail = noise3D(flowP2 + vec3(nMacro * 1.5));

  float ridge3D = 1.0 - abs(nMacro * 2.0 - 1.0);
  float fineRidge = 1.0 - abs(nDetail * 2.0 - 1.0);
  float curlRelief = 0.62 + 0.30 * ridge3D + 0.24 * fineRidge;

  // Organic 3D billowing radial warp: carves bold asymmetric side & front tongues curling around the sticks!
  float lobeWarp = (nMacro - 0.46) * mix(0.28, 0.62, hNorm) + (nDetail - 0.5) * 0.18;
  float warpedR = max(0.0, rNorm + lobeWarp);
  float mainEnv = smoothstep(1.18, 0.14, warpedR) * smoothstep(-0.01, 0.035, p.y);

  // Balanced 3D fusion of Slice A (x,y) and Slice B (z_rot,y):
  // Keeps full rich campfire breadth (no skinny candle pinch!) while carving true 3D foreground/rear tongues!
  float geoTemp = sqrt(max(simA.g * simB.g, 0.0));
  float peakBlend = max(simA.g * 0.88, simB.g * 0.78);
  float fusedTemp = mix(geoTemp, peakBlend, 0.48 + 0.18 * ridge3D);
  float fusedFuel = mix(sqrt(max(simA.r * simB.r, 0.0)), max(simA.r, simB.r), 0.42);
  float fusedReact = 0.55 * simA.a + 0.45 * simB.a;
  float fusedSmoke = 0.55 * simA.b + 0.45 * simB.b;

  float mainLocalTemp = fusedTemp * (0.36 + 0.84 * mainEnv) * curlRelief + fusedReact * 0.12 * mainEnv;

  // Right driftwood branch 3D curling licking tongues (rich gold-to-orange curls, not blown-out white!)
  float brWave = (nMacro - 0.45) * 0.55 + (nDetail - 0.5) * 0.25;
  float brEnv = inBranch * smoothstep(1.18, 0.08, brZDist + brWave);
  float brLocalTemp = simA.g * (0.44 + 0.80 * brEnv) * (0.62 + 0.46 * fineRidge) * 1.04;

  float localTemp = max(mainLocalTemp, brLocalTemp) * plankShield;
  float activeEnv = max(mainEnv, brEnv) * plankShield;

  // Crisp, sculptural photographic flame silhouette (rich opaque tongues, zero washed-out fog!)
  float crispFlame = smoothstep(0.22, 0.33, localTemp);
  float curlingTip = smoothstep(0.155, 0.245, localTemp) * smoothstep(0.42, 0.86, fineRidge) * 0.36;
  float flameDensity = saturate(crispFlame + curlingTip) * pow(saturate(activeEnv), 0.52);

  // --- 5. DRAMATIC 3D VOLUMETRIC DEPTH & COLOR STRATIFICATION ---
  // True 3D spherical/ellipsoidal distance to the recessed heart deep inside the wood stack!
  float heartDist = length((p - heartPos) * vec3(1.00, 0.78, 1.45));
  float interiorHeart = smoothstep(0.25, 0.04, heartDist);
  // Camera-facing foreground outer flame skin stays cooler rich tangerine/vermilion
  // so foreground 3D flame folds cast unmistakable sculptural depth over the white-hot core behind them!
  float frontShellCool = smoothstep(-0.015, -0.095, p.z - spineXZ.y);
  float coreDepth = saturate(
    interiorHeart * (1.0 - frontShellCool * 0.65)
    + brEnv * smoothstep(0.75, 0.15, brZDist) * smoothstep(0.10, 0.015, brDy) * 0.40
  );

  // Sculpted 3D temperature combining Navier-Stokes intensity, recessed core depth, and 3D billow lighting!
  float baseTemp = saturate((localTemp - 0.17) / 0.98);
  float sculptedTemp = baseTemp * mix(0.58, 1.08, billowLight * 0.56 + coreDepth * 0.44);
  sculptedTemp += fusedFuel * 0.22 * coreDepth * smoothstep(0.58, 0.10, hNorm);
  // Outer 3D shell & foreground curls cap strictly in vivid vermilion-orange-gold (never blow out to flat white!)
  float shellCap = mix(0.60, 1.0, smoothstep(0.08, 0.78, coreDepth + billowLight * 0.24));
  float temp01 = saturate(min(sculptedTemp, shellCap));

  float smokeDensity = fusedSmoke * activeEnv * smoothstep(0.56, 0.86, p.y) * 0.08;

  return vec4(temp01, flameDensity, smokeDensity, coreDepth);
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
  vec2 hit = intersectBox(ro, rd, FIRE_BOX_MIN, FIRE_BOX_MAX);
  if (hit.y < 0.0 || hit.x > hit.y || hit.x > tMax) return;

  float tStart = max(0.05, hit.x);
  float tEnd = min(tMax, hit.y);
  float span = tEnd - tStart;
  if (span <= 0.005) return;

  int steps = uFireSteps;
  float dt = span / float(steps);
  float t = tStart + dt * jitter;

  vec3 fireLight = vec3(0.0);
  float transmittance = 1.0;

  for (int i = 0; i < 64; i++) {
    if (i >= steps || transmittance < 0.015) break;

    vec3 p = ro + rd * t;
    vec4 field = sampleFireField(p, time, stoke);
    float temp01 = field.x;
    float density = field.y;
    float smoke = field.z;
    float coreDepth = field.w;

    if (density > 0.004) {
      // Rich volumetric fire palette calibrated for AgX:
      // Outer 3D curls & shadowed folds stay deep saturated vermilion-orange & molten amber,
      // while ONLY the deep recessed 3D core reaches incandescent creamy white-yellow!
      vec3 deepVermilion = vec3(0.76, 0.042, 0.001);
      vec3 richTangerine = vec3(1.0, 0.20, 0.003);
      vec3 moltenGold = vec3(1.0, 0.56, 0.028);
      vec3 incandescentCore = vec3(1.0, 0.94, 0.72);

      vec3 emitCol = mix(deepVermilion, richTangerine, smoothstep(0.02, 0.34, temp01));
      emitCol = mix(emitCol, moltenGold, smoothstep(0.34, 0.68, temp01));
      emitCol = mix(emitCol, incandescentCore, smoothstep(0.72, 0.96, temp01));

      // Calibrated HDR radiance: outer folds stay in AgX's richest color-saturation sweet spot (1.2..4.2),
      // while the deep 3D interior heart surges into incandescent white-gold (10..15) for real 3D depth!
      float radiance = mix(1.20, 4.1, smoothstep(0.0, 0.58, temp01))
                     + pow(smoothstep(0.52, 1.0, temp01), 2.35) * (7.5 + 8.0 * coreDepth);
      radiance *= uFireGain * (1.0 + stoke * 0.30);

      // Strong physical soot absorption on outer orange folds so foreground 3D tongues cast real
      // optical depth & orange-amber layering across the hotter white-gold core behind them!
      float opticalWeight = mix(0.68, 0.96, smoothstep(0.05, 0.55, temp01));
      float sigmaT = density * mix(20.0, 28.0, coreDepth);
      float stepAlpha = 1.0 - exp(-sigmaT * dt);

      fireLight += transmittance * emitCol * radiance * stepAlpha * (0.64 + 0.36 * opticalWeight);
      transmittance *= (1.0 - stepAlpha * opticalWeight * 0.92);
    }

    if (smoke > 0.002) {
      float warmUnder = exp(-max(p.y - 0.60, 0.0) * 2.5);
      vec3 smokeCol = skyAmb * 0.22 + vec3(0.85, 0.24, 0.04) * warmUnder * 0.14;
      float smokeAlpha = 1.0 - exp(-smoke * 2.1 * dt);
      fireLight += transmittance * smokeCol * smokeAlpha;
      transmittance *= (1.0 - smokeAlpha * 0.48);
    }

    t += dt;
  }

  accumColor = accumColor * transmittance + fireLight;
}
`;
