/**
 * Campfire wood geometry & material shader module.
 * Reconstructs the iconic driftwood teepee from the reference photograph:
 * - Two bold dark split planks framing the front with a narrow blazing center V-gap
 * - Angled side & rear teepee planks anchoring the fire and casting crisp radial shadows
 * - Thick dark gnarled branch extending far left across the firelit sand
 * - Heavy dark driftwood branch leaning far right down to the sand with flame licking along it
 * - Bold dark charred vertical forked sticks cutting straight up through the roaring flames
 * - Recessed glowing ember core tucked inside the teepee base
 */

export const WOOD_GLSL = /* glsl */ `
float sdPlank(
  vec3 p,
  vec3 base,
  vec3 tip,
  vec3 faceHint,
  vec3 halfExtents,
  float bevel,
  float seed,
  out float grainCoord
) {
  vec3 up = normalize(tip - base);
  vec3 right = normalize(cross(faceHint, up));
  vec3 fwd = cross(up, right);
  vec3 center = 0.5 * (base + tip);
  float halfLen = 0.5 * length(tip - base);

  vec3 q = p - center;
  vec3 loc = vec3(dot(q, right), dot(q, up), dot(q, fwd));

  float t = clamp((loc.y + halfLen) / max(2.0 * halfLen, 0.001), 0.0, 1.0);
  float widthTaper = mix(1.06, 0.90, t);
  vec3 b = vec3(halfExtents.x * widthTaper, halfLen, halfExtents.z);

  // Natural weathered split/sawn top edge
  float topChop = (noise2D(vec2(loc.x * 16.0 + seed * 7.1, seed * 3.3)) - 0.5) * 0.015 * smoothstep(0.65, 1.0, t);
  loc.y += topChop;

  float d = sdRoundBox(loc, b, bevel);

  // Longitudinal wood-split grain grooves
  float grain = sin(loc.x * 88.0 + noise2D(vec2(loc.x * 13.0, loc.y * 4.5 + seed)) * 5.0);
  d += grain * 0.0022;
  grainCoord = loc.x * 24.0 + seed * 11.3;
  return d;
}

float sdGnarledBranch(vec3 p, vec3 a, vec3 b, float ra, float rb, float crookAmp, float seed) {
  vec3 pa = p - a;
  vec3 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);

  vec3 bendOffset = vec3(
    sin(h * PI * 1.45 + seed * 3.1) * crookAmp,
    sin(h * PI * 2.1 + seed * 5.7) * crookAmp * 0.45,
    cos(h * PI * 1.3 + seed * 2.3) * crookAmp * 0.65
  ) * sin(h * PI);

  vec3 spine = a + ba * h + bendOffset;
  float r = mix(ra, rb, h);

  float bark = (noise3D(p * 24.0 + vec3(seed * 7.0)) - 0.5) * 0.0065;
  return length(p - spine) - (r + bark);
}

float woodBoundDist(vec3 p) {
  return length(p - vec3(0.0, 0.38, -0.02)) - 1.08;
}

vec2 mapWood(vec3 p) {
  float bound = woodBoundDist(p);
  if (bound > 0.25) {
    return vec2(bound + 0.08, MAT_WOOD);
  }

  float g = 0.0;
  float dWood = 1e5;

  // --- 1. HERO FRONT SPLIT PLANKS (broader, slightly lower squat teepee base matching photo proportions!) ---
  // Front-left broad weathered plank (dark silhouetted slab)
  float dFrontLeft = sdPlank(
    p,
    vec3(-0.20, -0.065, -0.225),
    vec3(-0.095, 0.305, -0.072),
    vec3(-0.22, 0.08, -0.97),
    vec3(0.090, 0.195, 0.022),
    0.005,
    1.1,
    g
  );
  dWood = min(dWood, dFrontLeft);

  // Front-right broad weathered plank (angled flatter toward camera showing crisp split wood grain)
  float dFrontRight = sdPlank(
    p,
    vec3(0.15, -0.065, -0.232),
    vec3(0.042, 0.312, -0.075),
    vec3(0.30, 0.08, -0.95),
    vec3(0.092, 0.200, 0.022),
    0.005,
    2.4,
    g
  );
  dWood = min(dWood, dFrontRight);

  // Left-flank teepee plank angled back-left
  float dSideLeft = sdPlank(
    p,
    vec3(-0.345, -0.06, -0.095),
    vec3(-0.140, 0.295, -0.015),
    vec3(-0.78, 0.10, -0.62),
    vec3(0.074, 0.185, 0.020),
    0.005,
    3.7,
    g
  );
  dWood = min(dWood, dSideLeft);

  // Inner recessed glowing plank visible deep through the center V-gap
  float dInnerCenter = sdPlank(
    p,
    vec3(-0.015, -0.05, -0.06),
    vec3(-0.018, 0.255, 0.01),
    vec3(0.10, 0.0, -0.99),
    vec3(0.046, 0.155, 0.018),
    0.005,
    4.5,
    g
  );
  dWood = min(dWood, dInnerCenter);

  // Rear structural teepee planks
  float dBackLeft = sdPlank(
    p,
    vec3(-0.22, -0.06, 0.16),
    vec3(-0.05, 0.32, 0.04),
    vec3(-0.52, 0.1, 0.85),
    vec3(0.078, 0.195, 0.020),
    0.005,
    5.2,
    g
  );
  float dBackRight = sdPlank(
    p,
    vec3(0.25, -0.06, 0.14),
    vec3(0.08, 0.325, 0.03),
    vec3(0.56, 0.1, 0.82),
    vec3(0.078, 0.195, 0.020),
    0.005,
    6.8,
    g
  );
  dWood = min(dWood, min(dBackLeft, dBackRight));

  // --- 2. ICONIC EXTENDING SIDE DRIFTWOOD BRANCHES ---
  // Far-left dark crooked driftwood branch resting continuously along the orange-lit sand
  float dExtLeft = sdGnarledBranch(
    p,
    vec3(-0.70, -0.024, -0.105),
    vec3(-0.21, 0.150, -0.068),
    0.020,
    0.030,
    0.013,
    1.7
  );
  dWood = min(dWood, dExtLeft);

  // Far-right heavy weathered driftwood limb descending diagonally onto the sand (with hugging flame!)
  float dExtRight = sdGnarledBranch(
    p,
    vec3(0.105, 0.325, -0.055),
    vec3(0.58, -0.058, -0.145),
    0.040,
    0.024,
    0.018,
    2.9
  );
  dWood = min(dWood, dExtRight);

  // --- 3. BOLD DARK CHARRED BRANCHES RISING IN RAZOR-SHARP SILHOUETTE ACROSS THE FLAME! ---
  // Positioned slightly forward of the main fire curtain (z ~ -0.075..-0.025) so they slice
  // starkly across the incandescent white-yellow core just like the reference photograph!
  float dVertMain = sdGnarledBranch(
    p,
    vec3(-0.105, 0.28, -0.068),
    vec3(-0.008, 0.795, -0.028),
    0.026,
    0.011,
    0.036,
    4.1
  );
  // Secondary vertical right-side charred prong creating the unmistakable forked silhouette
  float dVertRight = sdGnarledBranch(
    p,
    vec3(0.012, 0.31, -0.042),
    vec3(0.082, 0.725, -0.016),
    0.022,
    0.010,
    0.022,
    5.6
  );
  // Prominent dark horizontal/diagonal charred cross-sticks slicing across the blazing lower-mid flame
  float dCrossLow = sdGnarledBranch(
    p,
    vec3(-0.165, 0.345, -0.072),
    vec3(0.095, 0.420, -0.058),
    0.025,
    0.022,
    0.014,
    7.3
  );
  float dCrossMid = sdGnarledBranch(
    p,
    vec3(-0.140, 0.475, -0.056),
    vec3(0.038, 0.375, -0.072),
    0.019,
    0.023,
    0.016,
    8.9
  );
  float dBackSpire = sdGnarledBranch(
    p,
    vec3(-0.045, 0.31, 0.042),
    vec3(-0.095, 0.640, 0.050),
    0.020,
    0.010,
    0.020,
    9.4
  );

  dWood = min(dWood, dVertMain);
  dWood = min(dWood, dVertRight);
  dWood = min(dWood, dCrossLow);
  dWood = min(dWood, dCrossMid);
  dWood = min(dWood, dBackSpire);

  // --- 4. RECESSED GLOWING CHARCOAL BED NESTLED DEEP INSIDE THE TEEPEE BASE ---
  vec3 coalCenter = p - vec3(0.0, 0.005, 0.025);
  float coalR = length(coalCenter * vec3(1.15, 2.8, 1.15));
  float coalLumps = (fbm3DFast(p * 19.0 + vec3(2.1, 0.5, 4.7)) - 0.5) * 0.052;
  float dCoal = (coalR - 0.195) * 0.52 + coalLumps;

  if (dCoal < dWood) {
    return vec2(dCoal, MAT_CHARCOAL);
  }
  return vec2(dWood, MAT_WOOD);
}

vec3 shadeWoodAndCharcoal(
  vec3 p,
  vec3 n,
  vec3 v,
  float matId,
  float time,
  float fireFlicker,
  float stoke,
  vec3 fireCorePos,
  vec3 fireColor,
  vec3 skyAmb
) {
  float radialFromCore = length((p - vec3(0.0, 0.24, -0.01)) * vec3(1.0, 0.72, 1.0));

  if (matId == MAT_CHARCOAL) {
    float pulse = 0.80 + 0.20 * sin(time * 2.2 + noise3D(p * 9.0) * 6.0);
    float crack = fbm3DFast(p * 24.0 + vec3(0.0, -time * 0.10, 0.0));
    float emberHeat = smoothstep(0.24, 0.72, crack) * exp(-radialFromCore * 1.85);
    emberHeat = saturate(emberHeat * (1.12 + stoke * 0.55) * pulse);

    float tempK = mix(920.0, 2250.0, emberHeat);
    vec3 glow = blackbodyColor(tempK) * pow(emberHeat, 1.4) * (6.8 + stoke * 4.0);
    vec3 ashBase = vec3(0.008, 0.007, 0.008) * skyAmb;
    return ashBase + glow;
  }

  // --- WEATHERED SPLIT DRIFTWOOD & CHARRED BRANCH MATERIAL ---
  float grainNoise = fbm3DFast(vec3(p.x * 32.0, p.y * 5.5, p.z * 32.0));
  float fineGrain = noise3D(vec3(p.x * 84.0, p.y * 14.0, p.z * 84.0));

  // Rich weathered split driftwood: crisp vertical grain streaks visible on front-right plank!
  float grainStripes = 0.5 + 0.5 * sin(p.x * 165.0 + grainNoise * 7.5);
  vec3 driftwoodAlbedo = mix(
    vec3(0.028, 0.022, 0.020),
    vec3(0.118, 0.090, 0.068),
    grainNoise * 0.56 + fineGrain * 0.24 + grainStripes * 0.20
  );

  vec3 toCore = normalize(fireCorePos - p);
  float facingFire = saturate(dot(n, toCore));
  // Front-left plank is in deeper shadow; front-right plank angled slightly toward right skylight catches soft wood grain
  float upperZone = smoothstep(0.28, 0.52, p.y) * smoothstep(0.38, 0.06, length(p.xz));
  float charMask = saturate(
    smoothstep(0.42, 0.12, radialFromCore) * (0.25 + 0.85 * facingFire)
    + upperZone * 0.96
  );

  // Upper central sticks & inner plank surfaces char almost pitch-black so they silhouette dramatically!
  vec3 albedo = mix(driftwoodAlbedo, vec3(0.006, 0.0055, 0.006), charMask * 0.94);

  // Subtle cool dusk sky catch on weathered outer plank faces (stronger on right-angled faces)
  float skyFacing = saturate(n.y * 0.5 + 0.5);
  float rightSkyCatch = saturate(dot(n, normalize(vec3(0.48, 0.52, -0.70))));
  vec3 col = albedo * skyAmb * (0.24 + 0.58 * skyFacing);
  col += albedo * skyAmb * rightSkyCatch * 0.72 * (1.0 - charMask * 0.85);

  // Direct fiery illumination on inner walls, bevel edges, and side planks facing the flame
  vec3 lFire = fireCorePos - p;
  float dFire = length(lFire);
  vec3 lDir = lFire / max(dFire, 0.001);
  float ndl = max(dot(n, lDir), 0.0);
  float fireAtten = 1.0 / (0.12 + dFire * dFire * 2.1);
  col += albedo * fireColor * ndl * fireAtten * 3.8;

  // Warm orange bounce light from the blazing firelit sand onto the lower plank faces & right branch underside
  float groundBounce = saturate(-n.y * 0.65 + 0.40) * smoothstep(0.36, -0.03, p.y) * smoothstep(0.68, 0.14, length(p.xz));
  col += driftwoodAlbedo * vec3(1.0, 0.36, 0.07) * groundBounce * (0.55 * fireFlicker);

  // Grazing golden-amber rim wrap ONLY on edges proximate to & facing the flame (keeps outer faces clean!)
  float fres = pow(1.0 - max(dot(n, v), 0.0), 3.6);
  float rimProximity = smoothstep(0.48, 0.12, radialFromCore) * smoothstep(0.10, 0.55, facingFire + upperZone * 0.5);
  col += fireColor * fres * saturate(rimProximity) * 0.52;

  // Glowing charcoal ember veins ONLY on inner fire-facing charred wood & top edge of burning right branch!
  float crackPattern = fbm3DFast(p * 36.0 + vec3(0.0, -time * 0.05, 0.0));
  float fineCrack = smoothstep(0.60, 0.86, crackPattern);
  float rightBranchT = saturate((p.x - 0.14) / 0.42);
  vec3 rightBranchPt = mix(vec3(0.14, 0.35, -0.06), vec3(0.54, 0.0, -0.13), rightBranchT);
  float rightBranchBurn = smoothstep(0.068, 0.022, length(p - rightBranchPt)) * smoothstep(0.15, 0.72, n.y);

  // Strictly gate embers so front camera-facing plank bevels stay crisp weathered dark wood!
  float innerFireExposure = smoothstep(0.45, 0.85, facingFire) * smoothstep(0.28, 0.08, radialFromCore);
  float upperStickEdge = smoothstep(0.38, 0.56, p.y) * smoothstep(0.32, 0.06, length(p.xz)) * fres * 0.45;
  float burnHeat = saturate(innerFireExposure + upperStickEdge + rightBranchBurn * 0.62);

  float emberPulse = 0.74 + 0.26 * sin(time * 2.5 + p.y * 8.5 + crackPattern * 5.0);
  float emberAmt = fineCrack * pow(burnHeat, 1.55) * emberPulse * (1.0 + stoke * 0.45);
  col += blackbodyColor(mix(900.0, 1850.0, emberAmt)) * emberAmt * 4.2;

  return col;
}
`;
