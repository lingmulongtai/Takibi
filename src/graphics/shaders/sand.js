/**
 * Sculpted coastal beach sand heightfield, micro-grain / shell detail,
 * wet shoreline transition, and dual-source grazing twilight + campfire lighting.
 */

export const SAND_GLSL = /* glsl */ `
uniform sampler2D uSandMap;
uniform float uAmbientBoost;

const vec2 SAND_MIN = vec2(-5.5, -3.5);
const vec2 SAND_MAX = vec2(5.5, 7.5);
const vec2 SAND_INV_SPAN = 1.0 / (SAND_MAX - SAND_MIN);

const float SEA_LEVEL = -0.34;

// Sample the precomputed RGBA16F sculpted beach footprint terrain + seamless outer continuation
vec4 sampleSandField(vec2 xz) {
  vec2 uv = (xz - SAND_MIN) * SAND_INV_SPAN;
  vec2 clampedUv = clamp(uv, vec2(0.002), vec2(0.998));
  vec4 tex = textureLod(uSandMap, clampedUv, 0.0);

  vec2 edgeDist = max(vec2(0.0), max(SAND_MIN - xz, xz - SAND_MAX));
  float outFactor = saturate(length(edgeDist) * 0.65);

  float fallbackSlope = -0.028 * max(0.0, xz.y + 1.0) + (noise2D(xz * 0.55) - 0.5) * 0.05;
  // Slightly amplify sculpted footprint & sand-berm relief for dramatic raking firelight
  float reliefBoost = 1.42;
  float h = mix(tex.r * reliefBoost, fallbackSlope, outFactor);
  vec2 grad = mix(tex.gb * reliefBoost, vec2(0.0, -0.028), outFactor);
  float ao = mix(tex.a, 0.75, outFactor);

  // Natural undulating shoreline drop down to sea level
  float shoreLine = 5.15 + sin(xz.x * 0.34 + 0.6) * 0.32 + (noise2D(xz * 0.45) - 0.5) * 0.38;
  float shoreDrop = smoothstep(shoreLine - 0.65, shoreLine + 1.05, xz.y);
  h = mix(h, SEA_LEVEL - 0.06, shoreDrop);
  grad.y -= shoreDrop * (1.0 - shoreDrop) * 0.22;

  return vec4(h, grad.x, grad.y, ao);
}

float sandHeight(vec2 xz) {
  return sampleSandField(xz).r;
}

// High-resolution sand normal combining float16 footprint gradients + chunky disturbed sand + fine grit
vec3 computeSandNormal(vec2 xz, float distToCam, out float ao, out float grainSparkle) {
  vec4 field = sampleSandField(xz);
  ao = field.a;

  float mesoFade = smoothstep(9.5, 1.0, distToCam);
  float microFade = smoothstep(5.2, 0.5, distToCam);

  // Medium disturbed sand ripples & small irregular sand clods (eliminates smooth CG patches!)
  float epsM = 0.028;
  float hmX = fbm2D((xz + vec2(epsM, 0.0)) * 5.2) - fbm2D((xz - vec2(epsM, 0.0)) * 5.2);
  float hmZ = fbm2D((xz + vec2(0.0, epsM)) * 5.2) - fbm2D((xz - vec2(0.0, epsM)) * 5.2);

  // Fine granular sand texture
  float epsF = 0.008;
  float hfX = noise2D((xz + vec2(epsF, 0.0)) * 28.0) - noise2D((xz - vec2(epsF, 0.0)) * 28.0);
  float hfZ = noise2D((xz + vec2(0.0, epsF)) * 28.0) - noise2D((xz - vec2(0.0, epsF)) * 28.0);

  // Ultra-fine foreground sand grain grit & sparkle
  float nGritX = noise2D((xz + vec2(0.003, 0.0)) * 135.0) - 0.5;
  float nGritZ = noise2D((xz + vec2(0.0, 0.003)) * 135.0) - 0.5;
  float nSpark = noise2D(xz * 82.0 + vec2(11.3, 7.9)) * 0.45 + noise2D(xz * 175.0 + vec2(3.7, 23.1)) * 0.55;

  // Dampen micro-roughness smoothly on wet wave-smoothed shoreline sand
  float dryMask = smoothstep(5.4, 3.8, xz.y);

  vec2 grad = field.gb * 1.18;
  grad += vec2(hmX, hmZ) * 0.62 * mesoFade * dryMask;
  grad += vec2(hfX, hfZ) * 0.42 * mesoFade * dryMask;
  grad += vec2(nGritX, nGritZ) * 0.52 * microFade * dryMask;

  grainSparkle = smoothstep(0.66, 0.95, nSpark) * microFade;
  return normalize(vec3(-grad.x, 1.0, -grad.y));
}

// Oren-Nayar rough diffuse BRDF for granular beach sand
float orenNayarDiffuse(vec3 n, vec3 l, vec3 v, float roughness) {
  float ndl = max(dot(n, l), 0.0);
  if (ndl <= 0.0) return 0.0;
  float ndv = max(dot(n, v), 0.001);
  float r2 = roughness * roughness;
  float A = 1.0 - 0.5 * (r2 / (r2 + 0.33));
  float B = 0.45 * (r2 / (r2 + 0.09));

  vec3 lPerp = l - n * ndl;
  vec3 vPerp = v - n * ndv;
  float lLen = length(lPerp);
  float vLen = length(vPerp);
  float cosPhi = (lLen > 1e-4 && vLen > 1e-4) ? max(0.0, dot(lPerp, vPerp) / (lLen * vLen)) : 0.0;

  float sinAlpha = sqrt(1.0 - min(ndl, ndv) * min(ndl, ndv));
  float tanBeta = sqrt(1.0 - max(ndl, ndv) * max(ndl, ndv)) / max(max(ndl, ndv), 0.001);
  return ndl * (A + B * cosPhi * sinAlpha * tanBeta);
}

// Authentic quartz sand albedo with tiny shell flecks, pebbles, dark wrack line, and wet shore
void evaluateSandAlbedo(vec2 xz, float distToCam, float wetness, out vec3 albedo, out float specMask) {
  float macroVar = fbm2D(xz * 0.85 + vec2(4.2, 1.9));
  float mesoVar = noise2D(xz * 7.5);
  float grainVar = noise2D(xz * 48.0);

  // Neutral-cool coastal sand base (reads deep twilight slate-blue in shadow & rich tangerine under fire!)
  vec3 drySand = mix(vec3(0.18, 0.175, 0.185), vec3(0.27, 0.255, 0.245), macroVar * 0.55 + mesoVar * 0.30 + grainVar * 0.15);

  // Dark soot & ash darkened circle directly under the campfire logs
  float fireDist = length(xz);
  float sootMask = exp(-fireDist * fireDist * 4.8);
  drySand = mix(drySand, vec3(0.018, 0.015, 0.016), sootMask * 0.90);

  // Scattered tiny white shell fragments & dark mineral pebbles across foreground sand
  float microVis = smoothstep(5.8, 0.7, distToCam);
  vec2 cell = floor(xz * 30.0);
  vec2 fuv = fract(xz * 30.0);
  vec2 rnd = hash22(cell);
  float fleckDist = length(fuv - (0.2 + 0.6 * rnd));
  float shellDot = smoothstep(0.16, 0.03, fleckDist) * step(0.84, hash12(cell + 17.3));
  float pebbleDot = smoothstep(0.20, 0.04, fleckDist) * step(0.80, hash12(cell + 91.7));

  // Dark coastal seaweed/pebble wrack band just above the shoreline (distinct in reference photo!)
  float shoreWave = sin(xz.x * 0.34 + 0.6) * 0.32;
  float wrackBand = exp(-pow((xz.y - (3.85 + shoreWave)) / 0.85, 2.0));
  float wrackNoise = smoothstep(0.45, 0.82, fbm2D(xz * 4.2 + vec2(9.1, 2.4)));
  drySand = mix(drySand, vec3(0.042, 0.045, 0.056), wrackBand * wrackNoise * 0.72);

  drySand = mix(drySand, vec3(0.62, 0.60, 0.58), shellDot * 0.65 * microVis);
  drySand = mix(drySand, vec3(0.045, 0.046, 0.054), pebbleDot * 0.55 * microVis);

  // Wet sand near shoreline turns dramatically darker & reflective
  albedo = mix(drySand, drySand * 0.24, wetness);
  specMask = wetness;
}
`;
