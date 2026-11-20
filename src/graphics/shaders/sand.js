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

  // Smoothly blend outside the 11x11m sculpted hero patch into gentle natural beach slope
  vec2 edgeDist = max(vec2(0.0), max(SAND_MIN - xz, xz - SAND_MAX));
  float outFactor = saturate(length(edgeDist) * 0.65);

  float fallbackSlope = -0.028 * max(0.0, xz.y + 1.0) + (noise2D(xz * 0.55) - 0.5) * 0.05;
  float h = mix(tex.r, fallbackSlope, outFactor);
  vec2 grad = mix(tex.gb, vec2(0.0, -0.028), outFactor);
  float ao = mix(tex.a, 0.75, outFactor);

  // Gentle shoreline drop toward sea level around z = 5.0..6.6
  float shoreDrop = smoothstep(4.6, 6.7, xz.y);
  h = mix(h, SEA_LEVEL - 0.06, shoreDrop);
  grad.y -= smoothstep(4.6, 6.7, xz.y) * (1.0 - shoreDrop) * 0.14;

  return vec4(h, grad.x, grad.y, ao);
}

float sandHeight(vec2 xz) {
  return sampleSandField(xz).r;
}

// High-resolution sand normal combining precomputed float16 footprint gradients + micro sand grain
vec3 computeSandNormal(vec2 xz, float distToCam, out float ao, out float grainSparkle) {
  vec4 field = sampleSandField(xz);
  ao = field.a;

  // Fine wind ripples & micro-bumps (faded smoothly with distance to keep foreground crisp & far clean)
  float detailFade = smoothstep(9.5, 1.2, distToCam);
  float microFade = smoothstep(5.5, 0.6, distToCam);

  // Medium sand grain clumping
  float n1 = noise2D(xz * 19.0);
  float n2 = noise2D(xz * 47.0 + vec2(11.3, 7.9));
  float n3 = noise2D(xz * 135.0 + vec2(3.7, 23.1));

  // Analytical micro-gradient approximation
  float eps = 0.012;
  float gx = (noise2D((xz + vec2(eps, 0.0)) * 24.0) - noise2D((xz - vec2(eps, 0.0)) * 24.0)) * 0.22;
  float gz = (noise2D((xz + vec2(0.0, eps)) * 24.0) - noise2D((xz - vec2(0.0, eps)) * 24.0)) * 0.22;

  // Sharp fine granular sand grit close to camera
  float gritX = (noise2D((xz + vec2(0.005, 0.0)) * 115.0) - 0.5) * 0.34;
  float gritZ = (noise2D((xz + vec2(0.0, 0.005)) * 115.0) - 0.5) * 0.34;

  vec2 grad = field.gb;
  // Slightly accentuate footprint ridges so raking firelight sculpts crisp sand contours
  grad *= 1.32;
  grad += vec2(gx, gz) * detailFade;
  grad += vec2(gritX, gritZ) * microFade;

  grainSparkle = smoothstep(0.68, 0.96, n2 * 0.45 + n3 * 0.55) * microFade;
  return normalize(vec3(-grad.x, 1.0, -grad.y));
}

// Oren-Nayar diffuse term for dry granular beach sand
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

// Subtle scattered white shell fragments, dark pebbles, and high-tide organic flecks
void evaluateSandAlbedo(vec2 xz, float distToCam, float wetness, out vec3 albedo, out float specMask) {
  float macroVar = fbm2D(xz * 0.85 + vec2(4.2, 1.9));
  float mesoVar = noise2D(xz * 6.5);

  // Neutral coastal quartz sand (reads deep cool slate-blue in dusk shadow & warm amber under fire)
  vec3 drySand = mix(vec3(0.24, 0.225, 0.215), vec3(0.32, 0.295, 0.27), macroVar * 0.65 + mesoVar * 0.35);

  // Subtle dark soot & charred ash halo immediately inside the campfire ring
  float fireDist = length(xz);
  float sootMask = exp(-fireDist * fireDist * 5.2);
  drySand = mix(drySand, vec3(0.032, 0.028, 0.028), sootMask * 0.85);

  // Scattered tiny light shell flecks & dark coastal pebbles (crisp in foreground)
  float microVis = smoothstep(6.2, 0.9, distToCam);
  vec2 cell = floor(xz * 26.0);
  vec2 fuv = fract(xz * 26.0);
  vec2 rnd = hash22(cell);
  float fleckDist = length(fuv - (0.2 + 0.6 * rnd));
  float shellDot = smoothstep(0.14, 0.03, fleckDist) * step(0.86, hash12(cell + 17.3));
  float pebbleDot = smoothstep(0.18, 0.05, fleckDist) * step(0.83, hash12(cell + 91.7));

  // Slightly richer debris band near the upper shoreline (z ~ 3.2..4.9)
  float wrackBand = exp(-pow((xz.y - 4.0) / 0.85, 2.0));
  float wrackNoise = smoothstep(0.58, 0.86, fbm2D(xz * 5.2 + vec2(9.1, 2.4)));
  drySand = mix(drySand, vec3(0.09, 0.085, 0.085), wrackBand * wrackNoise * 0.55);

  drySand = mix(drySand, vec3(0.58, 0.56, 0.54), shellDot * 0.58 * microVis);
  drySand = mix(drySand, vec3(0.075, 0.075, 0.082), pebbleDot * 0.45 * microVis);

  // Wet sand near shoreline darkens significantly and gains specular sheen
  albedo = mix(drySand, drySand * 0.36, wetness);
  specMask = wetness;
}
`;
