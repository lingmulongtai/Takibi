import { COMMON_GLSL } from './common.js';
import { SKY_OCEAN_GLSL } from './sky-ocean.js';
import { SAND_GLSL } from './sand.js';
import { WOOD_GLSL } from './wood.js';
import { FIRE_GLSL } from './fire.js';

export const SCENE_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 vUv;
layout(location = 0) out vec4 fragColor;

uniform vec2 uResolution;
uniform float uTime;
uniform float uFrameIndex;
uniform vec2 uCameraOffset;
uniform float uFireFlicker;
uniform int uSceneSteps;
uniform int uShadowSteps;

uniform sampler2D uNoiseTex;
uniform sampler2D uBlueNoiseTex;

${COMMON_GLSL}
${SKY_OCEAN_GLSL}
${SAND_GLSL}
${WOOD_GLSL}
${FIRE_GLSL}

// Combined solid scene SDF: sculpted beach sand + driftwood teepee + glowing coal bed
vec2 mapSolid(vec3 p) {
  float dSand = (p.y - sandHeight(p.xz)) * 0.62;
  vec2 res = vec2(dSand, MAT_SAND);

  // Only evaluate detailed wood SDF when near the campfire bounding volume
  float wb = woodBoundDist(p);
  if (wb < 0.25) {
    vec2 wood = mapWood(p);
    if (wood.x < res.x) {
      res = wood;
    }
  } else if (wb + 0.08 < res.x) {
    res = vec2(wb + 0.08, MAT_WOOD);
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

// Soft raymarched shadows from both the 3D driftwood planks/branches and grazing sand relief!
float computeFireShadow(vec3 origin, vec3 lightPos, float softness, float jitter) {
  vec3 toLight = lightPos - origin;
  float maxDist = length(toLight);
  vec3 dir = toLight / max(maxDist, 0.0001);

  float res = 1.0;
  float t = 0.032 + jitter * 0.014;
  float limit = max(0.05, maxDist - 0.14);

  int steps = uShadowSteps;
  for (int i = 0; i < 36; i++) {
    if (i >= steps || t >= limit || res < 0.015) break;
    vec3 p = origin + dir * t;

    float dSand = p.y - sandHeight(p.xz);
    float d = dSand;
    if (woodBoundDist(p) < 0.18) {
      float dW = mapWood(p).x;
      d = min(d, dW);
    }

    if (d < 0.001) {
      return 0.0;
    }
    res = min(res, softness * d / t);
    t += clamp(d * 0.72, 0.018, 0.16);
  }
  return saturate(res);
}

// Local micro-AO for wood/sand contact crevices
float computeAmbientOcclusion(vec3 p, vec3 n) {
  float occ = 0.0;
  float weight = 1.0;
  for (int i = 1; i <= 4; i++) {
    float h = 0.022 + 0.048 * float(i);
    float d = mapSolid(p + n * h).x;
    occ += max(0.0, h - d) * weight;
    weight *= 0.65;
  }
  return saturate(1.0 - occ * 2.15);
}

// Compute camera orthonormal basis (shared with 3D spark renderer!)
void getCameraBasis(out vec3 ro, out vec3 right, out vec3 up, out vec3 fwd, out float focal) {
  // Subtle tranquil breathing motion + gentle mouse parallax
  float breathe = sin(uTime * 0.42) * 0.0045;
  ro = vec3(
    uCameraOffset.x * 0.14,
    0.72 + breathe + uCameraOffset.y * 0.055,
    -2.06
  );
  vec3 target = vec3(
    uCameraOffset.x * 0.035,
    0.345 + uCameraOffset.y * 0.025,
    0.35
  );
  fwd = normalize(target - ro);
  right = normalize(cross(vec3(0.0, 1.0, 0.0), fwd));
  up = cross(fwd, right);
  focal = 1.56;
}

void main() {
  vec2 fragCoord = vUv * uResolution;
  vec2 ndc = (fragCoord * 2.0 - uResolution) / uResolution.y;

  vec3 ro, camRight, camUp, camFwd;
  float focal;
  getCameraBasis(ro, camRight, camUp, camFwd, focal);
  vec3 rd = normalize(camRight * ndc.x + camUp * ndc.y + camFwd * focal);

  // Spatiotemporal blue-noise jitter for silky-smooth raymarching
  vec2 bnUv = fract((fragCoord + vec2(37.0, 73.0) * mod(uFrameIndex, 64.0)) / 128.0);
  vec4 bn = textureLod(uBlueNoiseTex, bnUv, 0.0);
  float jitter = fract(bn.r + 0.61803398875 * mod(uFrameIndex, 64.0));

  // Organic multi-frequency firelight animation (synced with audio rumble!)
  float flk = uFireFlicker * (1.0 + uStoke * 0.35);
  vec3 fireJiggle = vec3(
    sin(uTime * 6.3) * 0.024 + sin(uTime * 11.7) * 0.012,
    sin(uTime * 8.1 + 1.3) * 0.028 + uStoke * 0.04,
    cos(uTime * 5.7) * 0.020
  );

  // 3 virtual campfire light sources matching the volumetric flame distribution
  vec3 fireMainPos = vec3(0.01, 0.36, -0.02) + fireJiggle;
  vec3 fireGapPos = vec3(-0.02, 0.14, -0.10) + fireJiggle * 0.35;
  vec3 fireBranchPos = vec3(0.38, 0.18, -0.10) + fireJiggle * 0.55;

  // Rich, saturated tangerine-orange firelight raking dramatically across the beach sand!
  vec3 fireMainCol = vec3(1.0, 0.30, 0.038) * (8.2 * flk * uFireGain);
  vec3 fireGapCol = vec3(1.0, 0.24, 0.028) * (3.2 * flk * uFireGain);
  vec3 fireBranchCol = vec3(1.0, 0.32, 0.045) * (2.0 * flk * uFireGain);

  // Deep cool twilight sky hemisphere ambient (blue-indigo shadows contrasting against warm fire!)
  vec3 skyAmbLeft = vec3(0.095, 0.155, 0.34) * uSkyExposure * uAmbientBoost;
  vec3 skyAmbRight = mix(vec3(0.18, 0.24, 0.40), vec3(0.34, 0.27, 0.34), uSunsetStrength * 0.45) * uSkyExposure * uAmbientBoost;
  vec3 skyAmbAvg = 0.5 * (skyAmbLeft + skyAmbRight);

  // Subtle refractive heat haze for rays passing right above the hot rising flame column
  vec3 bgRd = rd;
  float plumeDist = length(vec2(ndc.x - 0.02, (ndc.y - 0.14) * 0.65));
  float hazeZone = exp(-plumeDist * plumeDist * 22.0) * smoothstep(-0.06, 0.08, ndc.y);
  if (hazeZone > 0.005) {
    float hz1 = noise2D(vec2(ndc.x * 26.0, ndc.y * 18.0 - uTime * 4.4)) - 0.5;
    float hz2 = noise2D(vec2(ndc.x * 48.0 + 7.1, ndc.y * 34.0 - uTime * 6.8)) - 0.5;
    bgRd = normalize(rd + vec3(hz1 * 0.0045 + hz2 * 0.0022, hz2 * 0.0032, 0.0) * hazeZone * (1.0 + uStoke * 0.4));
  }

  // Analytical ocean plane intersection (y = SEA_LEVEL)
  float tOcean = 1e5;
  if (bgRd.y < -0.0004) {
    float cand = (SEA_LEVEL - ro.y) / bgRd.y;
    if (cand > 0.0) {
      tOcean = cand;
    }
  }

  // Raymarch solid scene (sculpted beach sand + driftwood planks/branches + charcoal bed)
  float t = 0.08;
  float tMaxSolid = min(tOcean + 1.2, 26.0);
  float hitMat = MAT_NONE;
  float tHit = 1e5;

  int maxSteps = uSceneSteps;
  for (int i = 0; i < 128; i++) {
    if (i >= maxSteps || t > tMaxSolid) break;
    vec3 p = ro + rd * t;

    // Early escape once ray goes well above highest wood tip & keeps rising
    if (p.y > 0.95 && rd.y > 0.0) break;

    vec2 h = mapSolid(p);
    if (h.x < 0.0012 * max(1.0, t * 0.45)) {
      hitMat = h.y;
      tHit = t;
      break;
    }
    t += max(h.x, 0.004 * max(1.0, t * 0.25));
  }

  // 4-step bisection refinement for razor-sharp footprint ridges & wood bevels
  if (hitMat != MAT_NONE) {
    float tLo = max(0.05, tHit - 0.045);
    float tHi = tHit;
    for (int r = 0; r < 4; r++) {
      float tMid = 0.5 * (tLo + tHi);
      vec2 hm = mapSolid(ro + rd * tMid);
      if (hm.x < 0.0) {
        tHi = tMid;
        hitMat = hm.y;
      } else {
        tLo = tMid;
      }
    }
    tHit = 0.5 * (tLo + tHi);
  }

  // Resolve whether solid sand/wood or the ocean lies closer along this ray
  vec3 color = vec3(0.0);
  float sceneDepth = 100.0;

  bool hitOceanInstead = (hitMat == MAT_NONE || (hitMat == MAT_SAND && tOcean < tHit));

  if (!hitOceanInstead) {
    sceneDepth = tHit;
    vec3 p = ro + rd * tHit;
    vec3 v = -rd;

    if (hitMat == MAT_SAND) {
      float sandAO = 0.75;
      float sparkle = 0.0;
      vec3 n = computeSandNormal(p.xz, tHit, sandAO, sparkle);

      // Animated scalloped shoreline wave swash wetting the distant beach edge seamlessly
      float shoreCurve = 5.18 + sin(p.x * 0.36 + 0.6) * 0.30 + (noise2D(vec2(p.x * 0.55, 1.3)) - 0.5) * 0.34
        + sin(uTime * 0.68 + p.x * 0.24) * 0.22;
      float wetness = smoothstep(shoreCurve - 1.15, shoreCurve + 0.15, p.z);

      vec3 albedo;
      float specMask;
      evaluateSandAlbedo(p.xz, tHit, wetness, albedo, specMask);

      // Local contact AO from wood planks resting on the sand
      float woodAO = computeAmbientOcclusion(p, n);
      float combinedAO = saturate(sandAO * (0.42 + 0.58 * woodAO));

      // --- 1. Cool Twilight Sky Hemisphere Lighting (asymmetric left-blue / right-pale-peach) ---
      float skyHem = saturate(n.y * 0.5 + 0.5);
      float rightNormalBias = saturate(n.x * 0.5 + 0.5);
      vec3 skyLight = mix(skyAmbLeft, skyAmbRight, rightNormalBias * 0.65 + smoothstep(-2.0, 2.5, p.x) * 0.35);

      // Deep cool dusk indigo shadow fill inside footprint bowls (matching rich blue shadows in photo!)
      vec3 deepTwilightFill = vec3(0.022, 0.042, 0.115) * uSkyExposure * uAmbientBoost;
      vec3 ambTerm = albedo * mix(deepTwilightFill, skyLight * 1.12, skyHem * combinedAO);

      // Subtle directional sky key from upper-right horizon illuminating right-facing footprint walls
      vec3 skyKeyDir = normalize(vec3(0.55, 0.42, 0.72));
      float skyKeyDiff = orenNayarDiffuse(n, skyKeyDir, v, 0.92);
      ambTerm += albedo * skyAmbRight * skyKeyDiff * 0.45 * combinedAO;

      // --- 2. Grazing Multi-Emitter Warm Campfire Illumination + Real 3D Soft Shadows ---
      vec3 fireAccum = vec3(0.0);

      // Emitter A: Main incandescent fire core (casts dramatic plank & footprint self-shadows!)
      vec3 toMain = fireMainPos - p;
      float dMain = length(toMain);
      vec3 lMain = toMain / max(dMain, 0.001);
      float diffMain = orenNayarDiffuse(n, lMain, v, 0.94);
      float attenMain = 1.0 / (0.24 + dMain * dMain * 1.15 + dMain * dMain * dMain * 0.18);

      // Full shadow march across the visible firelight throw radius (< 5.5m)
      float shMain = 1.0;
      if (dMain < 5.5 && diffMain > 0.002) {
        shMain = computeFireShadow(p + n * 0.009, fireMainPos, 8.2, bn.g);
      }
      fireAccum += albedo * fireMainCol * diffMain * attenMain * shMain;

      // Subtle warm multiple-bounce scatter inside dry sand around the fire
      float wrapMain = saturate((dot(n, lMain) + 0.22) / 1.22);
      fireAccum += albedo * vec3(1.0, 0.22, 0.025) * wrapMain * attenMain * (0.09 + 0.26 * shMain) * flk * uFireGain;

      // Quartz sand-grain micro-sparkle catching grazing firelight in the foreground!
      vec3 hMain = normalize(lMain + v);
      float grainSpec = pow(max(dot(n, hMain), 0.0), 22.0) * sparkle * shMain * attenMain;
      fireAccum += fireMainCol * grainSpec * 0.36;

      // Emitter B: Low ember/plank-gap light spilling intensely between the front planks
      vec3 toGap = fireGapPos - p;
      float dGap = length(toGap);
      vec3 lGap = toGap / max(dGap, 0.001);
      float diffGap = orenNayarDiffuse(n, lGap, v, 0.95);
      float attenGap = 1.0 / (0.14 + dGap * dGap * 2.2);
      float shGap = 1.0;
      if (dGap < 3.0 && diffGap > 0.002) {
        shGap = computeFireShadow(p + n * 0.009, fireGapPos, 6.2, bn.b);
      }
      fireAccum += albedo * fireGapCol * diffGap * attenGap * shGap;

      // Emitter C: Right-leaning branch licking flame casting a warm glow across right-side sand
      vec3 toBr = fireBranchPos - p;
      float dBr = length(toBr);
      vec3 lBr = toBr / max(dBr, 0.001);
      float diffBr = orenNayarDiffuse(n, lBr, v, 0.94);
      float attenBr = 1.0 / (0.16 + dBr * dBr * 2.6);
      fireAccum += albedo * fireBranchCol * diffBr * attenBr * (0.42 + 0.58 * shMain);

      color = ambTerm + fireAccum;

      // Wet shoreline sand reflects twilight sky and blends seamlessly into scalloped frothy surf!
      if (wetness > 0.01) {
        vec3 refl = reflect(rd, mix(n, vec3(0.0, 1.0, 0.0), 0.72));
        refl.y = max(refl.y, 0.01);
        float wetFres = (0.04 + 0.96 * pow(1.0 - max(dot(n, v), 0.0), 4.5)) * wetness;
        color = mix(color, evaluateSky(normalize(refl), uTime) * 0.64, wetFres * 0.54);

        // Soft organic scalloped whitewater swash bridging the dark wet sand into the ocean surf
        float swashLace = fbm2D(vec2(p.x * 1.9, p.z * 2.4 + uTime * 0.28));
        float shoreEdge = smoothstep(shoreCurve - 0.35, shoreCurve + 0.42, p.z);
        float lipFoam = (exp(-pow((p.z - (shoreCurve + 0.05)) / 0.48, 2.0)) + shoreEdge * 0.65)
          * smoothstep(0.28, 0.78, swashLace);
        vec3 foamTint = mix(vec3(0.24, 0.34, 0.52), vec3(0.58, 0.64, 0.74), smoothstep(-2.2, 3.0, p.x)) * uSkyExposure;
        color = mix(color, foamTint, saturate(lipFoam * 0.92));

        // Feather exact shoreline transition smoothly into ocean radiance (zero ruler-straight cutoff!)
        if (tOcean < 1e4 && p.z > shoreCurve - 0.1) {
          float oceanBlend = smoothstep(shoreCurve - 0.05, shoreCurve + 0.55, p.z);
          vec3 oceanEdgeCol = shadeOcean(ro, bgRd, tOcean, uTime, fireMainPos, fireMainCol);
          color = mix(color, oceanEdgeCol, oceanBlend);
        }
      }

      // Gentle twilight coastal air perspective on distant sand
      float distFog = 1.0 - exp(-max(tHit - 3.6, 0.0) * 0.022);
      color = mix(color, skyAmbAvg * 0.72, saturate(distFog * 0.24));
    } else {
      // Driftwood planks, gnarled branches, or glowing charcoal bed
      vec3 n = calcWoodNormal(p);
      color = shadeWoodAndCharcoal(
        p,
        n,
        v,
        hitMat,
        uTime,
        flk,
        uStoke,
        fireMainPos,
        fireMainCol * 0.32,
        skyAmbAvg
      );
    }
  } else if (tOcean < 1e4) {
    sceneDepth = tOcean;
    color = shadeOcean(ro, bgRd, tOcean, uTime, fireMainPos, fireMainCol);
  } else {
    sceneDepth = 200.0;
    color = evaluateSky(bgRd, uTime);
  }

  // Integrate true 3D volumetric raymarched fire & subtle smoke, strictly depth-occluded by wood/sand!
  integrateVolumetricFire(ro, rd, sceneDepth, uTime, jitter, uStoke, skyAmbAvg, color);

  // Encode linear HDR radiance in RGB and linear depth in A (for 3D spark occlusion!)
  fragColor = vec4(max(color, vec3(0.0)), sceneDepth);
}
`;
