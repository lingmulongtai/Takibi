import { COMMON_GLSL } from './common.js';
import { SKY_OCEAN_GLSL } from './sky-ocean.js';
import { SAND_GLSL } from './sand.js';
import { WOOD_GLSL } from './wood.js';
import { FIRE_GLSL } from './fire.js';

const CAMERA_SHARED_GLSL = /* glsl */ `
// Shared camera orthonormal basis (matches SparkSystem and both Bake & Live passes!)
void getCameraBasis(vec2 camOffset, out vec3 ro, out vec3 right, out vec3 up, out vec3 fwd, out float focal) {
  ro = vec3(
    camOffset.x * 0.14,
    0.72 + camOffset.y * 0.055,
    -2.06
  );
  vec3 target = vec3(
    camOffset.x * 0.035,
    0.345 + camOffset.y * 0.025,
    0.35
  );
  fwd = normalize(target - ro);
  right = normalize(cross(vec3(0.0, 1.0, 0.0), fwd));
  up = cross(fwd, right);
  focal = 1.56;
}
`;

/**
 * PASS 0 (ON-DEMAND STATIC G-BUFFER BAKE — MRT):
 * Runs ONLY on startup, resize, mood switch, or when camera parallax moves!
 * Raymarches the static beach sand footprints, weathered driftwood planks & charred branches,
 * full Oren-Nayar shading, shell grain, contact AO, and soft raymarched shadows at ultra quality,
 * writing two RGBA16F textures:
 *   - outBase (location 0): RGB = twilight ambient radiance, A = exact linear scene depth (200.0 if sky/ocean)
 *   - outFire (location 1): RGB = unit-flicker direct/bounce/sparkle firelight response,
 *                           A   = +emberHeat (wood/charcoal) or -wetness (wet shoreline sand)
 */
export const BAKE_STATIC_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 vUv;
layout(location = 0) out vec4 outBase;
layout(location = 1) out vec4 outFire;

uniform vec2 uResolution;
uniform vec2 uCameraOffset;
uniform int uSceneSteps;
uniform int uShadowSteps;

uniform sampler2D uNoiseTex;
uniform sampler2D uBlueNoiseTex;

${COMMON_GLSL}
${SKY_OCEAN_GLSL}
${SAND_GLSL}
${WOOD_GLSL}
${CAMERA_SHARED_GLSL}

uniform float uFireGain;

vec2 intersectSphere(vec3 ro, vec3 rd, vec3 center, float radius) {
  vec3 oc = ro - center;
  float b = dot(oc, rd);
  float c = dot(oc, oc) - radius * radius;
  float disc = b * b - c;
  if (disc < 0.0) return vec2(1e5, -1e5);
  float s = sqrt(disc);
  return vec2(-b - s, -b + s);
}

vec2 mapSolid(vec3 p) {
  float dSand = (p.y - sandHeight(p.xz)) * 0.56;
  vec2 res = vec2(dSand, MAT_SAND);

  float wb = woodBoundDist(p);
  if (wb < 0.20) {
    vec2 wood = mapWood(p);
    if (wood.x < res.x) res = wood;
  } else if (wb + 0.06 < res.x) {
    res = vec2(wb + 0.06, MAT_WOOD);
  }
  return res;
}

vec3 calcWoodNormal(vec3 p) {
  vec2 e = vec2(0.0022, -0.0022);
  return normalize(
    e.xyy * mapWood(p + e.xyy).x +
    e.yyx * mapWood(p + e.yyx).x +
    e.yxy * mapWood(p + e.yxy).x +
    e.xxx * mapWood(p + e.xxx).x
  );
}

float computeFireShadow(vec3 origin, vec3 lightPos, float softness, float worldDither) {
  vec3 toLight = lightPos - origin;
  float maxDist = length(toLight);
  vec3 dir = toLight / max(maxDist, 0.0001);

  float limit = max(0.06, maxDist - 0.14);
  vec2 woodSpan = intersectSphere(origin, dir, WOOD_BOUND_CENTER, WOOD_BOUND_RADIUS);
  bool checkWood = (woodSpan.y > 0.02 && woodSpan.x < limit);

  float res = 1.0;
  // Subtle world-space (camera-invariant!) start offset removes any discrete step banding with zero crawl
  float t = 0.024 + worldDither * 0.014;

  int steps = uShadowSteps;
  for (int i = 0; i < 32; i++) {
    if (i >= steps || t >= limit || res < 0.012) break;
    vec3 p = origin + dir * t;

    // Exact vertical height above sand -> (dSand / t) is the true elevation angle above the terrain
    // (completely invariant to step quantization -> ZERO concentric ripple rings around the fire!)
    float dSandRaw = p.y - sandHeight(p.xz);
    float dSandStep = dSandRaw * 0.68;

    bool inWoodZone = (checkWood && t >= woodSpan.x - 0.06 && t <= woodSpan.y + 0.06);
    float dPen = dSandRaw;
    float dStep = dSandStep;

    if (inWoodZone) {
      float dWood = mapWoodShadow(p);
      if (dWood < 0.0008) return 0.0;
      dPen = min(dPen, dWood);
      dStep = min(dStep, dWood);
    }

    // Smooth near-origin ramp avoids grazing step-0 self-intersection on curved sand berms
    float nearGuard = smoothstep(0.022, 0.085, t);
    if (dSandRaw < 0.0004 && nearGuard > 0.45) return 0.0;

    float effDist = mix(max(dPen, 0.012), max(dPen, 0.0), nearGuard);
    res = min(res, softness * effDist / max(t, 0.01));

    // Wood-aware distance-adaptive stepping:
    // Tight steps inside wood bounding sphere (never skips thin planks!),
    // smoothly growing steps over open sand so 22-26 steps cleanly reaches 6.8m with ZERO popping!
    float stepLen;
    if (inWoodZone) {
      stepLen = clamp(dStep * 0.80, 0.012, 0.080);
    } else {
      stepLen = clamp(dStep * 0.85, 0.018 + t * 0.018, 0.24 + t * 0.11);
      if (checkWood && t < woodSpan.x - 0.04) {
        stepLen = min(stepLen, max(0.02, (woodSpan.x - 0.03) - t));
      }
    }
    t += stepLen;
  }

  res = saturate(res);
  return res * res * (3.0 - 2.0 * res);
}

float computeAmbientOcclusion(vec3 p, vec3 n) {
  float occ = 0.0;
  float weight = 1.0;
  for (int i = 1; i <= 3; i++) {
    float h = 0.025 + 0.055 * float(i);
    vec3 q = p + n * h;
    float d = min(q.y - sandHeight(q.xz), mapWoodShadow(q));
    occ += max(0.0, h - d) * weight;
    weight *= 0.62;
  }
  return saturate(1.0 - occ * 2.25);
}

void main() {
  vec2 fragCoord = vUv * uResolution;
  vec2 ndc = (fragCoord * 2.0 - uResolution) / uResolution.y;

  vec3 ro, camRight, camUp, camFwd;
  float focal;
  getCameraBasis(uCameraOffset, ro, camRight, camUp, camFwd, focal);
  vec3 rd = normalize(camRight * ndc.x + camUp * ndc.y + camFwd * focal);

  vec2 woodSpan = intersectSphere(ro, rd, WOOD_BOUND_CENTER, WOOD_BOUND_RADIUS);
  bool rayHitsWoodBound = (woodSpan.y > 0.08);
  bool rayCanHitSand = (rd.y < -0.0005);

  float hitMat = MAT_NONE;
  float tHit = 1e5;

  if (rayHitsWoodBound || rayCanHitSand) {
    float tMaxSolid = 14.5;
    float tSandEnter = rayCanHitSand ? max(0.08, (SAND_MAX_HEIGHT - ro.y) / rd.y) : 1e5;
    float t = rayHitsWoodBound ? min(max(0.08, woodSpan.x), tSandEnter) : tSandEnter;
    float tPrev = t;
    float lastD = 0.0;

    int maxSteps = uSceneSteps;
    for (int i = 0; i < 120; i++) {
      if (i >= maxSteps || t > tMaxSolid) break;
      vec3 p = ro + rd * t;

      float d;
      float mat = MAT_SAND;
      if (rayHitsWoodBound && t >= woodSpan.x - 0.06 && t <= woodSpan.y + 0.06) {
        vec2 h = mapSolid(p);
        d = h.x;
        mat = h.y;
      } else {
        if (!rayCanHitSand) break;
        if (t < tSandEnter) {
          tPrev = t;
          t = tSandEnter;
          continue;
        }
        // Conservative 0.54 Lipschitz factor prevents grazing footprint ridge overstepping!
        d = (p.y - sandHeight(p.xz)) * 0.54;
      }

      if (d < 0.0018 * max(1.0, t * 0.55)) {
        hitMat = mat;
        tHit = t;
        lastD = d;
        break;
      }
      tPrev = t;
      t += max(d, 0.007 * max(1.0, t * 0.35));
    }

    // Exact heightfield continuation if a grazing sand ray exhausted steps before touching:
    // marches strictly onto the real sand surface so p is NEVER underground or floating in midair!
    if (hitMat == MAT_NONE && rayCanHitSand) {
      float tEndSand = min(tMaxSolid, (SEA_LEVEL - 0.14 - ro.y) / rd.y);
      if (t < tEndSand) {
        float tWalk = t;
        for (int k = 0; k < 14; k++) {
          vec3 pw = ro + rd * tWalk;
          float dw = pw.y - sandHeight(pw.xz);
          if (dw <= 0.004) {
            hitMat = MAT_SAND;
            tHit = tWalk;
            lastD = dw;
            break;
          }
          tPrev = tWalk;
          tWalk += max(dw * 0.72, (tEndSand - t) * 0.085);
          if (tWalk > tEndSand) break;
        }
      }
    }

    if (hitMat != MAT_NONE) {
      // Exact zero-crossing bracket: if ray stopped slightly above surface (lastD > 0), extend tHi!
      float tLo = max(0.05, min(tPrev, tHit - 0.025));
      float tHi = (lastD > 0.0) ? (tHit + max(lastD * 2.4, 0.028)) : tHit;
      for (int r = 0; r < 5; r++) {
        float tMid = 0.5 * (tLo + tHi);
        vec3 pm = ro + rd * tMid;
        float dm;
        if (hitMat == MAT_SAND) {
          dm = pm.y - sandHeight(pm.xz);
        } else {
          vec2 hm = mapWood(pm);
          dm = hm.x;
          if (dm < 0.0) hitMat = hm.y;
        }
        if (dm < 0.0) tHi = tMid;
        else tLo = tMid;
      }
      tHit = 0.5 * (tLo + tHi);
    }
  }

  // Sky or pure open ocean pixel (no solid sand/wood closer than shoreline)
  if (hitMat == MAT_NONE) {
    outBase = vec4(0.0, 0.0, 0.0, 200.0);
    outFire = vec4(0.0);
    return;
  }

  vec3 p = ro + rd * tHit;
  // Hand off smoothly to live 3D ocean once the gently sloping sand submerges below SEA_LEVEL!
  if (hitMat == MAT_SAND && p.y < SEA_LEVEL - 0.004 && p.z > 5.05) {
    outBase = vec4(0.0, 0.0, 0.0, 200.0);
    outFire = vec4(0.0);
    return;
  }

  vec3 v = -rd;
  vec3 fireMainPos = vec3(0.01, 0.36, -0.02);
  vec3 fireGapPos = vec3(-0.02, 0.14, -0.10);
  vec3 fireBranchPos = vec3(0.38, 0.18, -0.10);

  vec3 fireMainCol = vec3(1.0, 0.30, 0.038) * (8.2 * uFireGain);
  vec3 fireGapCol = vec3(1.0, 0.24, 0.028) * (3.2 * uFireGain);
  vec3 fireBranchCol = vec3(1.0, 0.32, 0.045) * (2.0 * uFireGain);

  vec3 skyAmbLeft = vec3(0.095, 0.155, 0.34) * uSkyExposure * uAmbientBoost;
  vec3 skyAmbRight = mix(vec3(0.18, 0.24, 0.40), vec3(0.34, 0.27, 0.34), uSunsetStrength * 0.45) * uSkyExposure * uAmbientBoost;
  vec3 skyAmbAvg = 0.5 * (skyAmbLeft + skyAmbRight);

  if (hitMat == MAT_SAND) {
    // Guarantee p sits strictly on the geometric heightfield so shadow rays never launch underground!
    float exactSandY = sandHeight(p.xz);
    p.y = max(p.y, exactSandY);

    vec4 macroField = sampleSandField(p.xz);
    vec3 macroN = normalize(vec3(-macroField.g * 1.18, 1.0, -macroField.b * 1.18));

    float sandAO = 0.75;
    float sparkle = 0.0;
    vec3 n = computeSandNormal(p.xz, tHit, sandAO, sparkle);

    float shoreCurve = 5.32 + sin(p.x * 0.30 + 0.5) * 0.32 + (noise2D(vec2(p.x * 0.45, 1.3)) - 0.5) * 0.40;
    float wetness = smoothstep(shoreCurve - 1.45, shoreCurve + 0.05, p.z);

    vec3 albedo;
    float specMask;
    evaluateSandAlbedo(p.xz, tHit, wetness, albedo, specMask);

    float woodAO = (dot(p.xz, p.xz) < 1.32) ? computeAmbientOcclusion(p, macroN) : 1.0;
    float combinedAO = saturate(sandAO * (0.42 + 0.58 * woodAO));

    // 1. Static Twilight Sky Hemisphere Lighting
    float skyHem = saturate(n.y * 0.5 + 0.5);
    float rightNormalBias = saturate(n.x * 0.5 + 0.5);
    vec3 skyLight = mix(skyAmbLeft, skyAmbRight, rightNormalBias * 0.65 + smoothstep(-2.0, 2.5, p.x) * 0.35);
    vec3 deepTwilightFill = vec3(0.022, 0.042, 0.115) * uSkyExposure * uAmbientBoost;
    vec3 ambTerm = albedo * mix(deepTwilightFill, skyLight * 1.12, skyHem * combinedAO);

    vec3 skyKeyDir = normalize(vec3(0.55, 0.42, 0.72));
    float skyKeyDiff = orenNayarDiffuse(n, skyKeyDir, v, 0.92);
    ambTerm += albedo * skyAmbRight * skyKeyDiff * 0.45 * combinedAO;

    // Wet shoreline sky sheen baked smoothly into base
    if (wetness > 0.01) {
      vec3 refl = reflect(rd, mix(n, vec3(0.0, 1.0, 0.0), 0.78));
      refl.y = max(refl.y, 0.01);
      float wetFres = (0.04 + 0.96 * pow(1.0 - max(dot(n, v), 0.0), 4.2)) * wetness;
      ambTerm = mix(ambTerm, evaluateSky(normalize(refl), 0.0) * 0.55, wetFres * 0.48);
    }

    // 2. Static Unit-Flicker Firelight Response (multiplied by dynamic live flicker every frame!)
    vec3 fireAccum = vec3(0.0);

    vec3 toMain = fireMainPos - p;
    float dMain = length(toMain);
    vec3 lMain = toMain / max(dMain, 0.001);
    float diffMain = orenNayarDiffuse(n, lMain, v, 0.94);
    float attenMain = 1.0 / (0.24 + dMain * dMain * 1.15 + dMain * dMain * dMain * 0.18);

    // Smooth geometric normal shadow origin prevents micro-grain self-shadowing AND eliminates
    // the backfacing wrap-light jump glitch where diffMain <= 0.002 previously left shMain = 1.0!
    vec3 shadowOrigin = p + macroN * 0.015 + vec3(0.0, 0.008, 0.0);
    // Camera-invariant smooth world-space dither breaks up any step aliasing without crawling on mouse move
    float worldDither = noise2D(p.xz * 26.0 + vec2(3.7, 9.1));
    float macroFacing = dot(macroN, lMain);
    float shMain = 0.0;
    if (dMain < 6.8 && macroFacing > -0.24) {
      shMain = computeFireShadow(shadowOrigin + lMain * 0.014, fireMainPos, 8.0, worldDither);
    } else if (dMain >= 6.8) {
      shMain = 1.0;
    }
    fireAccum += albedo * fireMainCol * diffMain * attenMain * shMain;

    float wrapMain = saturate((dot(n, lMain) + 0.22) / 1.22);
    fireAccum += albedo * vec3(1.0, 0.22, 0.025) * wrapMain * attenMain * (0.09 + 0.26 * shMain) * uFireGain;

    vec3 hMain = normalize(lMain + v);
    float grainSpec = pow(max(dot(n, hMain), 0.0), 22.0) * sparkle * shMain * attenMain;
    fireAccum += fireMainCol * grainSpec * 0.36;

    vec3 toGap = fireGapPos - p;
    float dGap = length(toGap);
    if (dGap < 3.2) {
      vec3 lGap = toGap / max(dGap, 0.001);
      float diffGap = orenNayarDiffuse(n, lGap, v, 0.95);
      float attenGap = 1.0 / (0.14 + dGap * dGap * 2.2);
      float shGap = (p.z < 0.12 && dGap < 2.2 && dot(macroN, lGap) > -0.18)
        ? computeFireShadow(shadowOrigin + lGap * 0.012, fireGapPos, 6.2, fract(worldDither + 0.5))
        : shMain * 0.55;
      fireAccum += albedo * fireGapCol * diffGap * attenGap * shGap;
    }

    vec3 toBr = fireBranchPos - p;
    float dBr = length(toBr);
    vec3 lBr = toBr / max(dBr, 0.001);
    float diffBr = orenNayarDiffuse(n, lBr, v, 0.94);
    float attenBr = 1.0 / (0.16 + dBr * dBr * 2.6);
    fireAccum += albedo * fireBranchCol * diffBr * attenBr * (0.42 + 0.58 * shMain);

    float distFog = saturate((1.0 - exp(-max(tHit - 3.6, 0.0) * 0.022)) * 0.24);
    ambTerm = mix(ambTerm, skyAmbAvg * 0.72, distFog);
    fireAccum *= (1.0 - distFog);

    outBase = vec4(max(ambTerm, vec3(0.0)), tHit);
    // Negative alpha encodes wetness so live pass animates frothy shoreline surf cleanly!
    outFire = vec4(max(fireAccum, vec3(0.0)), -wetness);
    return;
  }

  // --- WOOD PLANKS, GNARLED BRANCHES & CHARCOAL BED ---
  vec3 n = calcWoodNormal(p);
  float radialFromCore = length((p - vec3(0.0, 0.24, -0.01)) * vec3(1.0, 0.72, 1.0));

  if (hitMat == MAT_CHARCOAL) {
    float crack = fbm3DFast(p * 24.0);
    float emberHeat = saturate(smoothstep(0.24, 0.72, crack) * exp(-radialFromCore * 1.85) * 1.15);
    vec3 ashBase = vec3(0.008, 0.007, 0.008) * skyAmbAvg;
    outBase = vec4(ashBase, tHit);
    // Positive alpha encodes live pulsing coal heat (pulsed dynamically every frame!)
    outFire = vec4(0.0, 0.0, 0.0, max(0.02, emberHeat));
    return;
  }

  float grainNoise = fbm3DFast(vec3(p.x * 32.0, p.y * 5.5, p.z * 32.0));
  float fineGrain = noise3D(vec3(p.x * 84.0, p.y * 14.0, p.z * 84.0));
  float grainStripes = 0.5 + 0.5 * sin(p.x * 165.0 + grainNoise * 7.5);
  vec3 driftwoodAlbedo = mix(
    vec3(0.028, 0.022, 0.020),
    vec3(0.118, 0.090, 0.068),
    grainNoise * 0.56 + fineGrain * 0.24 + grainStripes * 0.20
  );

  vec3 toCore = normalize(fireMainPos - p);
  float facingFire = saturate(dot(n, toCore));
  float upperZone = smoothstep(0.28, 0.52, p.y) * smoothstep(0.38, 0.06, length(p.xz));
  float charMask = saturate(
    smoothstep(0.42, 0.12, radialFromCore) * (0.25 + 0.85 * facingFire)
    + upperZone * 0.96
  );

  vec3 albedo = mix(driftwoodAlbedo, vec3(0.006, 0.0055, 0.006), charMask * 0.94);

  // Static dusk ambient on outer driftwood faces
  float skyFacing = saturate(n.y * 0.5 + 0.5);
  float rightSkyCatch = saturate(dot(n, normalize(vec3(0.48, 0.52, -0.70))));
  vec3 woodAmb = albedo * skyAmbAvg * (0.24 + 0.58 * skyFacing);
  woodAmb += albedo * skyAmbAvg * rightSkyCatch * 0.72 * (1.0 - charMask * 0.85);

  // Dynamic fire illumination + ground bounce + sculpted 3D flame-wrap rim (scales with live flicker!)
  vec3 woodFireColor = fireMainCol * 0.36;
  vec3 lFire = fireMainPos - p;
  float dFire = length(lFire);
  vec3 lDir = lFire / max(dFire, 0.001);
  float ndl = max(dot(n, lDir), 0.0);
  float fireAtten = 1.0 / (0.10 + dFire * dFire * 1.9);
  vec3 woodFire = albedo * woodFireColor * ndl * fireAtten * 4.4;

  // Inner V-gap plank bevels & throat faces glow warm blazing amber from the recessed 3D heart
  float innerThroat = smoothstep(0.24, 0.06, length(p.xz)) * smoothstep(0.38, 0.02, p.y) * saturate(facingFire * 1.2 + 0.15);
  woodFire += mix(driftwoodAlbedo, vec3(0.18, 0.08, 0.03), 0.55) * vec3(1.0, 0.34, 0.04) * innerThroat * (2.6 * uFireGain);

  float groundBounce = saturate(-n.y * 0.65 + 0.40) * smoothstep(0.36, -0.03, p.y) * smoothstep(0.68, 0.14, length(p.xz));
  woodFire += driftwoodAlbedo * vec3(1.0, 0.36, 0.07) * groundBounce * 0.62;

  // Crisp 3D cylindrical molten-gold Fresnel wrap around charred sticks immersed INSIDE the 3D fire!
  // Tight grazing exponent (4.4) keeps camera-facing bark pitch-black charcoal while lighting ONLY the
  // razor-sharp flame-kissed silhouette edges — dramatic 3D contrast matching the reference photo!
  float ndv = max(dot(n, v), 0.0);
  float fres = pow(1.0 - ndv, 3.8);
  float tightRim = pow(1.0 - ndv, 4.6);
  float stickInFire = smoothstep(0.28, 0.44, p.y) * smoothstep(0.80, 0.40, p.y) * smoothstep(0.24, 0.05, length(p.xz));
  float rimProximity = smoothstep(0.46, 0.12, radialFromCore) * smoothstep(0.12, 0.56, facingFire + upperZone * 0.55);
  woodFire += vec3(1.0, 0.38, 0.04) * fres * saturate(rimProximity) * (0.92 * uFireGain);
  woodFire += vec3(1.0, 0.56, 0.09) * tightRim * stickInFire * (2.6 * uFireGain);
  // Crisp underside fire bounce ONLY on downward-facing edges overhanging the core (keeps fronts dark!)
  float undersideGlow = pow(saturate(-n.y), 1.7) * smoothstep(0.27, 0.46, p.y) * smoothstep(0.24, 0.05, length(p.xz));
  woodFire += vec3(1.0, 0.42, 0.05) * undersideGlow * (1.55 * uFireGain);

  // Inner charred wood ember cracks (stored in positive alpha for live pulsing!)
  float crackPattern = fbm3DFast(p * 36.0);
  float fineCrack = smoothstep(0.58, 0.85, crackPattern);
  float rightBranchT = saturate((p.x - 0.14) / 0.42);
  vec3 rightBranchPt = mix(vec3(0.14, 0.35, -0.06), vec3(0.54, 0.0, -0.13), rightBranchT);
  float rightBranchBurn = smoothstep(0.072, 0.022, length(p - rightBranchPt)) * smoothstep(0.12, 0.70, n.y);
  float innerFireExposure = smoothstep(0.42, 0.82, facingFire) * smoothstep(0.30, 0.08, radialFromCore);
  float upperStickEdge = stickInFire * fres * 0.72;
  float burnHeat = saturate(innerFireExposure + upperStickEdge + rightBranchBurn * 0.68);
  float woodEmber = fineCrack * pow(burnHeat, 1.45) * 0.82;

  outBase = vec4(max(woodAmb, vec3(0.0)), tHit);
  outFire = vec4(max(woodFire, vec3(0.0)), woodEmber);
}
`;

/**
 * PASS 1 (ULTRA-FAST LIVE PER-FRAME SCENE SHADER):
 * Reads the cached static G-Buffer (gBase + gFire -> 0 solid raymarch & 0 shadow steps per frame!)
 * and computes ONLY live animated elements every frame:
 * - Spatialized flickering campfire illumination dancing across all sand footprints & planks
 * - Live pulsing charcoal bed & glowing ember cracks
 * - Live frothy shoreline surf swash & true 3D raymarched breaking twilight ocean waves (~13% of screen)
 * - Live twilight sky clouds, stars & subtle convective heat haze
 * - Live 3D depth-occluded Navier-Stokes volumetric fire (~8% of screen via tight AABB!)
 */
export const SCENE_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 vUv;
layout(location = 0) out vec4 fragColor;

uniform vec2 uResolution;
uniform float uTime;
uniform float uFrameIndex;
uniform vec2 uCameraOffset;
uniform float uFireFlicker;

uniform sampler2D uNoiseTex;
uniform sampler2D uBlueNoiseTex;
uniform sampler2D uGBaseTex;
uniform sampler2D uGFireTex;

${COMMON_GLSL}
${SKY_OCEAN_GLSL}
${FIRE_GLSL}
${CAMERA_SHARED_GLSL}

uniform float uAmbientBoost;

void main() {
  vec2 fragCoord = vUv * uResolution;
  vec2 ndc = (fragCoord * 2.0 - uResolution) / uResolution.y;

  vec3 ro, camRight, camUp, camFwd;
  float focal;
  getCameraBasis(uCameraOffset, ro, camRight, camUp, camFwd, focal);
  vec3 rd = normalize(camRight * ndc.x + camUp * ndc.y + camFwd * focal);

  vec4 gBase = textureLod(uGBaseTex, vUv, 0.0);
  vec4 gFire = textureLod(uGFireTex, vUv, 0.0);
  float sceneDepth = gBase.a;

  // Spatiotemporal blue-noise jitter for silky-smooth volumetric fire
  vec2 bnUv = fract((fragCoord + vec2(37.0, 73.0) * mod(uFrameIndex, 64.0)) / 128.0);
  float jitter = fract(textureLod(uBlueNoiseTex, bnUv, 0.0).r + 0.61803398875 * mod(uFrameIndex, 64.0));

  float flk = uFireFlicker * (1.0 + uStoke * 0.35);
  vec3 fireMainPos = vec3(
    0.01 + sin(uTime * 6.3) * 0.022,
    0.36 + sin(uTime * 8.1 + 1.3) * 0.024 + uStoke * 0.04,
    -0.02 + cos(uTime * 5.7) * 0.018
  );
  vec3 fireMainCol = vec3(1.0, 0.30, 0.038) * (8.2 * flk * uFireGain);

  vec3 skyAmbLeft = vec3(0.095, 0.155, 0.34) * uSkyExposure * uAmbientBoost;
  vec3 skyAmbRight = mix(vec3(0.18, 0.24, 0.40), vec3(0.34, 0.27, 0.34), uSunsetStrength * 0.45) * uSkyExposure * uAmbientBoost;
  vec3 skyAmbAvg = 0.5 * (skyAmbLeft + skyAmbRight);

  vec3 color = vec3(0.0);

  if (sceneDepth < 50.0) {
    // --- SOLID SAND / WOOD / CHARCOAL PIXEL (0 raymarch steps, 0 shadow steps!) ---
    // Spatial wave modulation makes the flickering firelight visibly dance across sand ridges!
    float spatialWave = 1.0
      + 0.045 * sin(uTime * 7.4 + ndc.x * 5.2 - ndc.y * 3.8)
      + 0.030 * cos(uTime * 11.8 - ndc.x * 8.1 + ndc.y * 4.5);
    color = gBase.rgb + gFire.rgb * (flk * spatialWave);

    float meta = gFire.a;
    if (meta > 0.002) {
      // Live pulsing glowing charcoal bed & charred wood ember cracks!
      float pulse = 0.78 + 0.22 * sin(uTime * 2.4 + ndc.x * 32.0 + ndc.y * 24.0);
      float heat = saturate(meta * (1.0 + uStoke * 0.52) * pulse);
      float tempK = mix(900.0, 2220.0, heat);
      color += blackbodyColor(tempK) * pow(heat, 1.42) * (6.2 + uStoke * 3.8);
    } else if (meta < -0.008) {
      // Live frothy lacy shoreline surf swash washing over wet beach edge (~3% of screen!)
      vec3 p = ro + rd * sceneDepth;
      float shoreCurve = 5.38 + sin(p.x * 0.30 + 0.5) * 0.34 + (noise2D(vec2(p.x * 0.45, 1.3)) - 0.5) * 0.42
        + sin(uTime * 0.78 + sin(p.x * 0.26) * 1.3) * 0.22;

      float webFoam = foamWebNoise(vec2(p.x * 2.4, p.z * 2.8 + uTime * 0.25));
      float swashLace = fbm2D(vec2(p.x * 1.35, p.z * 1.9 + uTime * 0.24));
      float foamEdge = shoreCurve + (swashLace - 0.5) * 0.72;
      float lipFoam = exp(-pow((p.z - foamEdge) / 0.46, 2.0))
        * smoothstep(0.24, 0.78, swashLace * 0.60 + webFoam * 0.55);
      vec3 foamTint = mix(vec3(0.24, 0.34, 0.54), vec3(0.60, 0.66, 0.78), smoothstep(-2.4, 3.0, p.x)) * uSkyExposure;
      color = mix(color, foamTint, saturate(lipFoam * 0.90));

      // Smoothly feather wet shoreline contact into live 3D raymarched ocean waves!
      if (p.z > shoreCurve - 0.22 && rd.y < -0.0002) {
        float tOcean = 1e5;
        if (marchOcean3D(ro, rd, 5.45, sceneDepth + 0.35, uTime, tOcean)) {
          float oceanBlend = smoothstep(shoreCurve - 0.18, shoreCurve + 0.50, p.z);
          vec3 oceanEdgeCol = shadeOcean(ro, rd, tOcean, uTime, fireMainPos, fireMainCol);
          color = mix(color, oceanEdgeCol, oceanBlend);
        }
      }
    }
  } else {
    // --- LIVE SKY & 3D RAYMARCHED OCEAN PIXEL ---
    // Subtle smooth horizontal convective heat shimmer strictly above the flame
    vec3 bgRd = rd;
    float plumeDist = length(vec2(ndc.x - 0.01, (ndc.y - 0.16) * 0.62));
    float hazeZone = exp(-plumeDist * plumeDist * 26.0) * smoothstep(-0.04, 0.10, ndc.y);
    if (hazeZone > 0.005) {
      float hz1 = noise2D(vec2(ndc.x * 11.0, ndc.y * 8.5 - uTime * 3.8)) - 0.5;
      float hz2 = noise2D(vec2(ndc.x * 21.0 + 7.1, ndc.y * 15.0 - uTime * 5.6)) - 0.5;
      bgRd = normalize(rd + vec3((hz1 * 0.0038 + hz2 * 0.0016), hz1 * 0.00055, 0.0) * hazeZone * (1.0 + uStoke * 0.35));
    }

    float tOcean = 1e5;
    if (bgRd.y < -0.0002 && marchOcean3D(ro, bgRd, 5.10, 240.0, uTime, tOcean)) {
      sceneDepth = tOcean;
      color = shadeOcean(ro, bgRd, tOcean, uTime, fireMainPos, fireMainCol);
    } else {
      sceneDepth = 200.0;
      color = evaluateSky(bgRd, uTime);
    }
  }

  // Integrate live 3D Navier-Stokes volumetric fire strictly inside tight AABB (~8% of pixels!)
  integrateVolumetricFire(ro, rd, sceneDepth, uTime, jitter, uStoke, skyAmbAvg, color);

  fragColor = vec4(max(color, vec3(0.0)), sceneDepth);
}
`;
