/**
 * HDR Photographic Post-Processing Shaders:
 * 1. Soft-knee bright pass with Karis firefly suppression
 * 2. 13-tap energy-conserving Jimenez downsample bloom pyramid
 * 3. 9-tap progressive tent upsample with warm photographic halation
 * 4. Final composite with Troy Sobotka's AgX Tone Mapping, subtle lens dispersion,
 *    natural twilight vignette, and organic high-ISO film grain.
 */

export const BRIGHT_PASS_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uSceneTex;
uniform sampler2D uSparksTex;
uniform vec2 uTexelSize;

float luminance(vec3 c) {
  return dot(c, vec3(0.2126, 0.7152, 0.0722));
}

vec3 sampleCombined(vec2 uv) {
  return texture(uSceneTex, uv).rgb + texture(uSparksTex, uv).rgb;
}

void main() {
  // Karis-weighted 4-tap box filter suppresses sub-pixel bloom flickering
  vec2 o = uTexelSize * 0.5;
  vec3 c0 = sampleCombined(vUv + vec2(-o.x, -o.y));
  vec3 c1 = sampleCombined(vUv + vec2( o.x, -o.y));
  vec3 c2 = sampleCombined(vUv + vec2(-o.x,  o.y));
  vec3 c3 = sampleCombined(vUv + vec2( o.x,  o.y));

  float w0 = 1.0 / (1.0 + luminance(c0));
  float w1 = 1.0 / (1.0 + luminance(c1));
  float w2 = 1.0 / (1.0 + luminance(c2));
  float w3 = 1.0 / (1.0 + luminance(c3));

  vec3 col = (c0 * w0 + c1 * w1 + c2 * w2 + c3 * w3) / max(w0 + w1 + w2 + w3, 1e-4);

  // Soft-knee HDR threshold keeps sky & outer flame edges crisp while blooming incandescent cores
  float br = max(col.r, max(col.g, col.b));
  float threshold = 1.62;
  float knee = 0.82;
  float soft = clamp(br - threshold + knee, 0.0, 2.0 * knee);
  soft = (soft * soft) / (4.0 * knee + 1e-5);
  float contrib = max(soft, br - threshold) / max(br, 1e-5);

  fragColor = vec4(col * contrib, 1.0);
}
`;

export const BLOOM_DOWNSAMPLE_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uSourceTex;
uniform vec2 uTexelSize;

// 13-tap Jimenez energy-preserving downsample filter
void main() {
  vec2 x = uTexelSize;

  vec3 a = texture(uSourceTex, vUv + vec2(-2.0 * x.x,  2.0 * x.y)).rgb;
  vec3 b = texture(uSourceTex, vUv + vec2( 0.0,        2.0 * x.y)).rgb;
  vec3 c = texture(uSourceTex, vUv + vec2( 2.0 * x.x,  2.0 * x.y)).rgb;

  vec3 d = texture(uSourceTex, vUv + vec2(-2.0 * x.x,  0.0)).rgb;
  vec3 e = texture(uSourceTex, vUv).rgb;
  vec3 f = texture(uSourceTex, vUv + vec2( 2.0 * x.x,  0.0)).rgb;

  vec3 g = texture(uSourceTex, vUv + vec2(-2.0 * x.x, -2.0 * x.y)).rgb;
  vec3 h = texture(uSourceTex, vUv + vec2( 0.0,       -2.0 * x.y)).rgb;
  vec3 i = texture(uSourceTex, vUv + vec2( 2.0 * x.x, -2.0 * x.y)).rgb;

  vec3 j = texture(uSourceTex, vUv + vec2(-x.x,  x.y)).rgb;
  vec3 k = texture(uSourceTex, vUv + vec2( x.x,  x.y)).rgb;
  vec3 l = texture(uSourceTex, vUv + vec2(-x.x, -x.y)).rgb;
  vec3 m = texture(uSourceTex, vUv + vec2( x.x, -x.y)).rgb;

  vec3 outCol = e * 0.125;
  outCol += (a + c + g + i) * 0.03125;
  outCol += (b + d + f + h) * 0.0625;
  outCol += (j + k + l + m) * 0.125;

  fragColor = vec4(max(outCol, vec3(0.0)), 1.0);
}
`;

export const BLOOM_UPSAMPLE_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uSourceTex;
uniform sampler2D uBaseTex;
uniform vec2 uTexelSize;
uniform float uRadius;
uniform float uWeight;

// 9-tap tent filter progressive upsample
void main() {
  vec2 o = uTexelSize * uRadius;

  vec3 s = vec3(0.0);
  s += texture(uSourceTex, vUv + vec2(-o.x,  o.y)).rgb * 1.0;
  s += texture(uSourceTex, vUv + vec2( 0.0,  o.y)).rgb * 2.0;
  s += texture(uSourceTex, vUv + vec2( o.x,  o.y)).rgb * 1.0;

  s += texture(uSourceTex, vUv + vec2(-o.x,  0.0)).rgb * 2.0;
  s += texture(uSourceTex, vUv).rgb                    * 4.0;
  s += texture(uSourceTex, vUv + vec2( o.x,  0.0)).rgb * 2.0;

  s += texture(uSourceTex, vUv + vec2(-o.x, -o.y)).rgb * 1.0;
  s += texture(uSourceTex, vUv + vec2( 0.0, -o.y)).rgb * 2.0;
  s += texture(uSourceTex, vUv + vec2( o.x, -o.y)).rgb * 1.0;
  s *= (1.0 / 16.0);

  vec3 base = texture(uBaseTex, vUv).rgb;
  fragColor = vec4(base + s * uWeight, 1.0);
}
`;

export const COMPOSITE_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 vUv;
out vec4 fragColor;

uniform sampler2D uSceneTex;
uniform sampler2D uSparksTex;
uniform sampler2D uBloomTex;
uniform sampler2D uHalationTex;
uniform vec2 uResolution;
uniform float uTime;

// Troy Sobotka's AgX Tone Mapping (Blender 4.0+ standard) — ideal for high-intensity fire!
// Naturally rolls bright flames to creamy incandescent white while preserving rich amber-orange halos.
vec3 agxDefaultContrastApprox(vec3 x) {
  vec3 x2 = x * x;
  vec3 x4 = x2 * x2;
  return + 15.5     * x4 * x2
         - 40.14    * x4 * x
         + 31.96    * x4
         - 6.868    * x2 * x
         + 0.4298   * x2
         + 0.1191   * x
         - 0.00232;
}

vec3 agxTonemap(vec3 val) {
  const mat3 agxInset = mat3(
    0.842479062253094,  0.0423282422610123, 0.0423756549057051,
    0.0784335999999992, 0.878468636469772,  0.0784336,
    0.0792237451477643, 0.0791661274605434, 0.879142973793104
  );
  const mat3 agxOutset = mat3(
     1.19687900512017,  -0.0528968517574562, -0.0529716355144438,
    -0.0980208811401368, 1.15190312990417,   -0.0980434501171241,
    -0.0990297440797205,-0.0989611768448433,  1.15107367264116
  );

  const float minEv = -12.47393;
  const float maxEv = 4.026069;

  val = max(val, vec3(1e-6));
  val = agxInset * val;
  val = clamp(log2(val), minEv, maxEv);
  val = (val - minEv) / (maxEv - minEv);
  val = agxDefaultContrastApprox(val);
  val = agxOutset * val;

  // Subtle AgX punchy look for photographic twilight contrast & rich fire chroma
  vec3 lumaWeights = vec3(0.2126, 0.7152, 0.0722);
  float luma = dot(val, lumaWeights);
  val = pow(max(val, vec3(0.0)), vec3(1.06));
  val = mix(vec3(luma), val, 1.12);
  return clamp(val, 0.0, 1.0);
}

float hashGrain(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  vec2 centered = vUv - 0.5;
  float r2 = dot(centered, centered);

  // Subtle corner lens dispersion (barely visible, adds DSLR optical authenticity)
  vec2 caOffset = centered * r2 * 0.0042;
  vec3 sceneCol;
  sceneCol.r = texture(uSceneTex, vUv + caOffset).r;
  sceneCol.g = texture(uSceneTex, vUv).g;
  sceneCol.b = texture(uSceneTex, vUv - caOffset).b;

  vec3 sparksCol = texture(uSparksTex, vUv).rgb;
  vec3 bloomCol = texture(uBloomTex, vUv).rgb;
  vec3 halationCol = texture(uHalationTex, vUv).rgb;

  // Combine linear HDR radiance + tight photographic bloom + subtle warm amber film halation
  vec3 hdr = sceneCol + sparksCol;
  hdr += bloomCol * 0.15;
  hdr += halationCol * vec3(1.0, 0.32, 0.06) * 0.11;

  // Photographic exposure calibrated for rich dusk twilight + blazing HDR campfire
  hdr *= 1.18;

  // Apply AgX tone mapping (outputs display-referred sRGB-encoded values directly!)
  vec3 col = agxTonemap(hdr);

  // Preserve deep cool dusk blue-indigo shadows & rich warm orange fire saturation
  float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
  float shadowMask = smoothstep(0.42, 0.02, luma);
  col += vec3(-0.006, 0.000, 0.016) * shadowMask;

  // Gentle natural wide-angle lens vignette
  float vig = 1.0 - smoothstep(0.22, 1.08, r2 * 1.48) * 0.34;
  col *= vig;

  // Fine high-ISO photographic sensor grain (prevents smooth dusk sky banding)
  vec2 px = vUv * uResolution;
  float g1 = hashGrain(px + fract(uTime * 17.3) * 100.0);
  float g2 = hashGrain(px * 1.01 + fract(uTime * 29.1) * 100.0);
  float grain = (g1 + g2 - 1.0) * 0.014;
  col = clamp(col + grain, 0.0, 1.0);

  fragColor = vec4(col, 1.0);
}
`;
