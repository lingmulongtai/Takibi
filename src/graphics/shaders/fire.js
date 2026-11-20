/**
 * 3D Volumetric Raymarched Campfire Shader Module coupled to the GPU Navier-Stokes Fluid Sim!
 * Places the roaring Navier-Stokes fluid curtain accurately INSIDE the driftwood teepee & BEHIND
 * the front dark planks and charred foreground sticks, so the dark wood silhouettes slice cleanly
 * across the blazing white-yellow core while licking orange-gold tongues wrap naturally around them!
 */

export const FIRE_GLSL = /* glsl */ `
uniform sampler2D uFireSimTex;
uniform float uFireGain;
uniform float uStoke;
uniform int uFireSteps;

const vec2 FIRE_SIM_MIN = vec2(-0.62, -0.04);
const vec2 FIRE_SIM_MAX = vec2(0.72, 1.08);
const vec2 FIRE_SIM_INV = 1.0 / (FIRE_SIM_MAX - FIRE_SIM_MIN);

// Sample the 3D volumetric fire driven directly by our real-time Navier-Stokes fluid simulation!
// Returns vec3(temp01, flameDensity, smokeDensity)
vec3 sampleFireField(vec3 p, float time, float stoke) {
  // Exact 3D Z spine:
  // Main Navier-Stokes flame sits at z ~ +0.038 (directly BEHIND the dark charred vertical branches
  // z = -0.072..-0.016 so those sticks stand in crisp black silhouette across the blazing fire!),
  // while transitioning cleanly onto the diagonal right driftwood branch for p.x > 0.16!
  float branchMix = smoothstep(0.16, 0.30, p.x);
  float brT = saturate((p.x - 0.16) / 0.36);
  float zCenter = mix(0.038, mix(-0.058, -0.138, brT), branchMix);

  float hNorm = saturate((p.y - 0.04) / 0.82);
  float zHalfThick = mix(mix(0.105, 0.076, hNorm), 0.042, branchMix);

  // Organic 3D depth undulation so local flame licks still weave subtly around the vertical branches
  float zWobble = (noise3D(vec3(p.x * 5.2, p.y * 3.0 - time * 2.6, p.z * 5.2)) - 0.5) * mix(0.025, 0.085, hNorm);
  float dz = (p.z - zCenter + zWobble) / max(zHalfThick, 0.01);
  float zMask = 1.0 - dz * dz;
  if (zMask <= 0.001) {
    return vec3(0.0);
  }
  float zEnv = pow(saturate(zMask), 0.72);

  // Keep front outer faces of the two dark front planks free of foreground haze,
  // while letting the blazing core shine brightly through the center V-gap & over the right branch!
  float plankShield = smoothstep(-0.085, -0.042, p.z)
    + smoothstep(0.27, 0.33, p.y)
    + smoothstep(0.085, 0.032, abs(p.x))
    + smoothstep(0.14, 0.24, p.x);
  zEnv *= saturate(plankShield);
  if (zEnv <= 0.002) return vec3(0.0);

  // Map 3D world point into Navier-Stokes fluid UV with subtle depth-slice parallax
  vec2 sliceParallax = vec2(
    (p.z - zCenter) * 0.18 + sin(p.z * 16.0 + time * 2.8) * 0.012,
    abs(p.z - zCenter) * 0.10
  );
  vec2 simUv = (p.xy + sliceParallax - FIRE_SIM_MIN) * FIRE_SIM_INV;
  if (simUv.x <= 0.005 || simUv.x >= 0.995 || simUv.y <= 0.005 || simUv.y >= 0.995) {
    return vec3(0.0);
  }

  vec4 sim = textureLod(uFireSimTex, simUv, 0.0);
  float fuel = sim.r;
  float simTemp = sim.g;
  float simSmoke = sim.b;
  float simReact = sim.a;

  // Fine 3D turbulent filament modulation gives crisp depth-layered flame strands & curling holes!
  float micro3D = noise3D(p * vec3(15.0, 6.8, 15.0) - vec3(0.0, time * 4.6, 0.0));
  float ridge3D = 1.0 - abs(noise3D(p * vec3(9.5, 4.2, 9.5) - vec3(0.0, time * 3.4, 0.0)) * 2.0 - 1.0);
  float depthMod = 0.68 + 0.34 * micro3D + 0.24 * ridge3D;

  // Local temperature modulated by 3D depth shell (hottest in protected interior, cooler orange on outside!)
  float localTemp = simTemp * (0.38 + 0.70 * zEnv) * depthMod + simReact * 0.10 * zEnv;

  // Razor-sharp photographic flame boundary driven directly by Navier-Stokes fluid curls!
  // Zero foggy orange mist around edges; crisp sharp licking curtains + subtle wispy tips only at very top!
  float crispEdge = smoothstep(0.21, 0.275, localTemp);
  float wispyTip = smoothstep(0.13, 0.23, localTemp) * smoothstep(0.56, 0.90, hNorm) * 0.22;
  float flameDensity = saturate(crispEdge + wispyTip) * zEnv;

  // Clean thermal ramp: crisp fiery orange rim -> vivid molten lemon-gold -> blinding white-yellow core!
  float temp01 = saturate((localTemp - 0.16) / 1.02);
  temp01 = saturate(temp01 + fuel * 0.22 * zEnv * smoothstep(0.55, 0.14, hNorm));

  // Very subtle dark/warm smoke wisps strictly above the apex
  float smokeDensity = simSmoke * zEnv * smoothstep(0.54, 0.80, p.y) * 0.09;

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
  vec3 volCenter = vec3(0.05, 0.46, -0.01);
  float volRadius = 0.90;
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
      // Calibrated DSLR campfire color ramp for AgX:
      // Outer wisps -> deep fiery vermilion-orange; curling tongues -> vivid molten gold-amber;
      // innermost protected heart -> blinding cream-white!
      vec3 crimsonTip = vec3(0.95, 0.09, 0.002);
      vec3 fieryOrange = vec3(1.0, 0.27, 0.006);
      vec3 moltenGold = vec3(1.0, 0.65, 0.055);
      vec3 whiteHot = vec3(1.0, 0.96, 0.78);

      vec3 emitCol = mix(crimsonTip, fieryOrange, smoothstep(0.02, 0.34, temp01));
      emitCol = mix(emitCol, moltenGold, smoothstep(0.34, 0.70, temp01));
      emitCol = mix(emitCol, whiteHot, smoothstep(0.72, 0.97, temp01));

      // Physical combustion optics (KEY TO REALISTIC FIRE, ZERO POWDERY ORANGE SMOKE!):
      // Cool dim orange tips (temp01 < 0.35) are OPTICALLY THIN & LUMINOUS (low absorption so dusk sky
      // glows delicately through translucent orange tips!), while bright yellow-white inner flames are
      // dense, blazing, opaque incandescent plasma curtains!
      float radiance = mix(1.85, 6.2, smoothstep(0.0, 0.58, temp01))
                     + pow(smoothstep(0.42, 1.0, temp01), 2.05) * 16.5;
      radiance *= uFireGain * (1.0 + stoke * 0.28);

      float opticalWeight = mix(0.28, 1.0, smoothstep(0.08, 0.52, temp01));
      float sigmaT = density * 22.0;
      float stepAlpha = 1.0 - exp(-sigmaT * dt);

      fireLight += transmittance * emitCol * radiance * stepAlpha * (0.55 + 0.45 * opticalWeight);
      transmittance *= (1.0 - stepAlpha * opticalWeight * 0.92);
    }

    if (smoke > 0.002) {
      float warmUnder = exp(-max(p.y - 0.62, 0.0) * 2.4);
      vec3 smokeCol = skyAmb * 0.24 + vec3(0.88, 0.28, 0.06) * warmUnder * 0.12;
      float smokeAlpha = 1.0 - exp(-smoke * 1.9 * dt);
      fireLight += transmittance * smokeCol * smokeAlpha;
      transmittance *= (1.0 - smokeAlpha * 0.45);
    }

    t += dt;
  }

  accumColor = accumColor * transmittance + fireLight;
}
`;
