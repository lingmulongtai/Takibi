/**
 * Shared GLSL shaders and utility library for all rendering passes.
 */

export const FULLSCREEN_VERTEX_SHADER = `#version 300 es
precision highp float;

out vec2 vUv;

void main() {
  // Single clip-space triangle covering [-1, 1]^2
  vec2 pos = vec2(
    float((gl_VertexID & 1) << 2) - 1.0,
    float((gl_VertexID & 2) << 1) - 1.0
  );
  vUv = pos * 0.5 + 0.5;
  gl_Position = vec4(pos, 0.0, 1.0);
}
`;

export const COMMON_GLSL = /* glsl */ `
const float PI = 3.14159265359;
const float TAU = 6.28318530718;

const float MAT_NONE = 0.0;
const float MAT_SAND = 1.0;
const float MAT_WOOD = 2.0;
const float MAT_CHARCOAL = 3.0;
const float MAT_OCEAN = 4.0;

mat2 rot2(float a) {
  float c = cos(a);
  float s = sin(a);
  return mat2(c, -s, s, c);
}

float saturate(float x) {
  return clamp(x, 0.0, 1.0);
}

vec3 saturate3(vec3 v) {
  return clamp(v, 0.0, 1.0);
}

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}

float hash13(vec3 p3) {
  p3 = fract(p3 * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}

float interleavedGradientNoise(vec2 fragCoord) {
  vec3 magic = vec3(0.06711056, 0.00583715, 52.9829189);
  return fract(magic.z * fract(dot(fragCoord, magic.xy)));
}

// Hardware-accelerated smooth 3D value noise using dual-channel offset LUT (uNoiseTex)
float noise3D(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  vec2 uv = (i.xy + vec2(37.0, 17.0) * i.z) + f.xy;
  vec2 rg = textureLod(uNoiseTex, (uv + 0.5) / 256.0, 0.0).yx;
  return mix(rg.x, rg.y, f.z);
}

float noise2D(vec2 x) {
  vec2 i = floor(x);
  vec2 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return textureLod(uNoiseTex, (i + f + 0.5) / 256.0, 0.0).r;
}

float fbm2D(vec2 p) {
  float value = 0.0;
  float amp = 0.5;
  mat2 m = mat2(0.80, -0.60, 0.60, 0.80);
  for (int i = 0; i < 4; i++) {
    value += amp * noise2D(p);
    p = m * p * 2.03 + vec2(17.1, 31.7);
    amp *= 0.5;
  }
  return value;
}

float fbm3D(vec3 p) {
  float value = 0.0;
  float amp = 0.5;
  for (int i = 0; i < 4; i++) {
    value += amp * noise3D(p);
    p.xz = mat2(0.8, -0.6, 0.6, 0.8) * p.xz;
    p = p * 2.04 + vec3(13.7, 29.3, 7.1);
    amp *= 0.5;
  }
  return value;
}

float fbm3DFast(vec3 p) {
  float v = 0.53 * noise3D(p);
  p = p * 2.07 + vec3(11.3, 19.1, 5.7);
  v += 0.30 * noise3D(p);
  p = p * 2.11 + vec3(23.7, 7.3, 17.9);
  v += 0.17 * noise3D(p);
  return v;
}

float smin(float a, float b, float k) {
  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);
  return mix(b, a, h) - k * h * (1.0 - h);
}

float sdRoundBox(vec3 p, vec3 b, float r) {
  vec3 q = abs(p) - b;
  return length(max(q, 0.0)) + min(max(q.x, max(q.y, q.z)), 0.0) - r;
}

// Capsule with linearly tapered radius from a (ra) to b (rb)
float sdTaperedBranch(vec3 p, vec3 a, vec3 b, float ra, float rb, out float tAlong) {
  vec3 pa = p - a;
  vec3 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);
  tAlong = h;
  return length(pa - ba * h) - mix(ra, rb, h);
}

// Physically-motivated Planckian blackbody emission approximation for fire & embers
// Input tempK in Kelvin (roughly 700K .. 3600K)
vec3 blackbodyColor(float tempK) {
  float t = clamp(tempK, 650.0, 4200.0) * 0.001;
  // Smooth calibrated chromaticity curve tailored for AgX HDR fire rendering
  float r = 1.0;
  float g = saturate(0.39 * log(max(t, 0.1)) - 0.12 + 0.34 * pow(saturate((t - 0.8) / 2.2), 1.35));
  float b = saturate(pow(saturate((t - 1.65) / 1.95), 2.15));

  // Fine calibration: rich crimson-orange below 1300K, vivid gold around 1800-2300K, warm cream-white >2800K
  vec3 col = vec3(r, g, b);
  col = mix(vec3(1.0, 0.09, 0.005), col, smoothstep(0.68, 1.45, t));
  col = mix(col, vec3(1.0, 0.96, 0.88), smoothstep(2.6, 3.8, t));
  return col;
}
`;
