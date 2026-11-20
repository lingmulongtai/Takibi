/**
 * Campfire wood geometry & material shader module.
 * Reconstructs the iconic driftwood teepee from the reference photograph:
 * - Two broad flat split planks framing the front with a blazing V-gap between them
 * - Side & rear teepee planks enclosing the ember pit
 * - Far-left dark crooked stabilizing branch resting across the orange-lit sand
 * - Far-right thick leaning driftwood branch hosting a licking flame along its upper edge
 * - Tall dark charred forked vertical branches rising up through the incandescent core
 * - Glowing convective charcoal & ember bed inside the base
 */

export const WOOD_GLSL = /* glsl */ `
// Oriented split timber plank SDF with beveled edges and longitudinal split grain
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

  // Slight organic bow & split taper along length
  float t = clamp((loc.y + halfLen) / max(2.0 * halfLen, 0.001), 0.0, 1.0);
  float widthTaper = mix(1.04, 0.88, t);
  vec3 b = vec3(halfExtents.x * widthTaper, halfLen, halfExtents.z);

  // Rough sawn/split top edge
  float topChop = (noise2D(vec2(loc.x * 16.0 + seed * 7.1, seed * 3.3)) - 0.5) * 0.014 * smoothstep(0.65, 1.0, t);
  loc.y += topChop;

  float d = sdRoundBox(loc, b, bevel);

  // Subtle vertical wood grain furrows along the broad faces
  float grain = sin(loc.x * 95.0 + noise2D(vec2(loc.x * 14.0, loc.y * 5.0 + seed)) * 5.2);
  d += grain * 0.0018;
  grainCoord = loc.x * 26.0 + seed * 11.3;
  return d;
}

// Organic gnarled driftwood branch with mild sinusoidal crook & bark roughness
float sdGnarledBranch(vec3 p, vec3 a, vec3 b, float ra, float rb, float crookAmp, float seed) {
  vec3 pa = p - a;
  vec3 ba = b - a;
  float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0);

  // Smooth mid-branch organic bend
  vec3 bendOffset = vec3(
    sin(h * PI * 1.45 + seed * 3.1) * crookAmp,
    sin(h * PI * 2.1 + seed * 5.7) * crookAmp * 0.45,
    cos(h * PI * 1.3 + seed * 2.3) * crookAmp * 0.65
  ) * sin(h * PI);

  vec3 spine = a + ba * h + bendOffset;
  float r = mix(ra, rb, h);

  // Bark ridges & knots
  float bark = (noise3D(p * 26.0 + vec3(seed * 7.0)) - 0.5) * 0.0055;
  return length(p - spine) - (r + bark);
}

// Fast bounding sphere check around campfire wood assembly (radius ~0.98m around (0, 0.36, 0))
float woodBoundDist(vec3 p) {
  return length(p - vec3(0.0, 0.36, -0.02)) - 1.04;
}

// Evaluate SDF of all campfire logs, branches, and glowing charcoal bed.
// Returns vec2(distance, materialId): MAT_WOOD or MAT_CHARCOAL
vec2 mapWood(vec3 p) {
  float bound = woodBoundDist(p);
  if (bound > 0.25) {
    return vec2(bound + 0.08, MAT_WOOD);
  }

  float g = 0.0;
  float dWood = 1e5;

  // --- 1. HERO FRONT SPLIT PLANKS (iconic dark silhouette framing the blazing core) ---
  // Front-left broad weathered plank leaning inward
  float dFrontLeft = sdPlank(
    p,
    vec3(-0.195, -0.055, -0.225),
    vec3(-0.085, 0.345, -0.068),
    vec3(-0.28, 0.08, -0.96),
    vec3(0.082, 0.21, 0.020),
    0.006,
    1.1,
    g
  );
  dWood = min(dWood, dFrontLeft);

  // Front-right broad weathered plank leaning inward (leaving a dramatic glowing center V-gap)
  float dFrontRight = sdPlank(
    p,
    vec3(0.145, -0.055, -0.232),
    vec3(0.045, 0.352, -0.072),
    vec3(0.24, 0.08, -0.96),
    vec3(0.080, 0.215, 0.020),
    0.006,
    2.4,
    g
  );
  dWood = min(dWood, dFrontRight);

  // Far-left outer teepee plank angled sharply to camera-left
  float dSideLeft = sdPlank(
    p,
    vec3(-0.315, -0.05, -0.09),
    vec3(-0.115, 0.34, -0.015),
    vec3(-0.78, 0.10, -0.62),
    vec3(0.068, 0.20, 0.018),
    0.006,
    3.7,
    g
  );
  dWood = min(dWood, dSideLeft);

  // Inner recessed support plank peeking warmly through the center gap
  float dInnerCenter = sdPlank(
    p,
    vec3(-0.015, -0.04, -0.085),
    vec3(-0.02, 0.295, -0.015),
    vec3(0.12, 0.0, -0.99),
    vec3(0.048, 0.165, 0.017),
    0.005,
    4.5,
    g
  );
  dWood = min(dWood, dInnerCenter);

  // Back-left & back-right structural teepee planks (giving full 3D depth & radial shadows)
  float dBackLeft = sdPlank(
    p,
    vec3(-0.21, -0.05, 0.16),
    vec3(-0.05, 0.36, 0.04),
    vec3(-0.52, 0.1, 0.85),
    vec3(0.076, 0.21, 0.020),
    0.006,
    5.2,
    g
  );
  float dBackRight = sdPlank(
    p,
    vec3(0.24, -0.05, 0.14),
    vec3(0.08, 0.37, 0.03),
    vec3(0.56, 0.1, 0.82),
    vec3(0.076, 0.21, 0.020),
    0.006,
    6.8,
    g
  );
  dWood = min(dWood, min(dBackLeft, dBackRight));

  // --- 2. ICONIC EXTENDING SIDE DRIFTWOOD BRANCHES ---
  // Far-left dark crooked driftwood stick protruding out over the orange-lit sand
  float dExtLeft = sdGnarledBranch(
    p,
    vec3(-0.69, 0.012, -0.105),
    vec3(-0.22, 0.175, -0.075),
    0.014,
    0.028,
    0.022,
    1.7
  );
  dWood = min(dWood, dExtLeft);

  // Far-right thick leaning branch descending diagonally to the sand (carries licking flame!)
  float dExtRight = sdGnarledBranch(
    p,
    vec3(0.115, 0.365, -0.055),
    vec3(0.58, -0.038, -0.135),
    0.036,
    0.024,
    0.016,
    2.9
  );
  dWood = min(dWood, dExtRight);

  // --- 3. TALL CHARRED BRANCHES RISING THROUGH THE HEART OF THE FLAME ---
  // Primary tall crooked vertical charred stick slicing right through the incandescent flame
  float dVertMain = sdGnarledBranch(
    p,
    vec3(-0.095, 0.31, -0.035),
    vec3(0.015, 0.775, 0.005),
    0.024,
    0.010,
    0.032,
    4.1
  );
  // Secondary right vertical charred prong creating the unmistakable forked apex silhouette
  float dVertRight = sdGnarledBranch(
    p,
    vec3(0.02, 0.35, 0.015),
    vec3(0.098, 0.72, 0.038),
    0.021,
    0.009,
    0.024,
    5.6
  );
  // Mid-flame horizontal/diagonal charred cross-sticks catching fire silhouette & ember cracks
  float dCrossLow = sdGnarledBranch(
    p,
    vec3(-0.155, 0.385, -0.048),
    vec3(0.095, 0.455, -0.035),
    0.022,
    0.020,
    0.016,
    7.3
  );
  float dCrossMid = sdGnarledBranch(
    p,
    vec3(-0.13, 0.51, -0.02),
    vec3(0.035, 0.415, -0.055),
    0.018,
    0.022,
    0.018,
    8.9
  );
  float dBackSpire = sdGnarledBranch(
    p,
    vec3(-0.04, 0.34, 0.055),
    vec3(-0.095, 0.65, 0.065),
    0.019,
    0.009,
    0.022,
    9.4
  );

  dWood = min(dWood, dVertMain);
  dWood = min(dWood, dVertRight);
  dWood = min(dWood, dCrossLow);
  dWood = min(dWood, dCrossMid);
  dWood = min(dWood, dBackSpire);

  // --- 4. GLOWING CHARCOAL & EMBER BED NESTLED INSIDE THE TEEPEE BASE ---
  vec3 coalCenter = p - vec3(0.0, 0.02, -0.02);
  float coalR = length(coalCenter * vec3(1.0, 2.35, 1.0));
  float coalLumps = (fbm3DFast(p * 18.0 + vec3(2.1, 0.5, 4.7)) - 0.5) * 0.062;
  float dCoal = (coalR - 0.235) * 0.52 + coalLumps;

  if (dCoal < dWood) {
    return vec2(dCoal, MAT_CHARCOAL);
  }
  return vec2(dWood, MAT_WOOD);
}

// Detailed procedural wood / charred driftwood & glowing ember crack shading
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
  float radialFromCore = length((p - vec3(0.0, 0.24, -0.02)) * vec3(1.0, 0.72, 1.0));

  if (matId == MAT_CHARCOAL) {
    // Glowing lumpy coal bed with pulsing convective heat pockets
    float pulse = 0.78 + 0.22 * sin(time * 2.1 + noise3D(p * 9.0) * 6.0);
    float crack = fbm3DFast(p * 26.0 + vec3(0.0, -time * 0.12, 0.0));
    float emberHeat = smoothstep(0.32, 0.74, crack) * exp(-radialFromCore * 2.1);
    emberHeat = saturate(emberHeat * (1.05 + stoke * 0.55) * pulse);

    float tempK = mix(780.0, 2050.0, emberHeat);
    vec3 glow = blackbodyColor(tempK) * pow(emberHeat, 1.55) * (5.2 + stoke * 3.5);
    vec3 ashBase = vec3(0.014, 0.013, 0.015) * skyAmb;
    return ashBase + glow;
  }

  // --- WEATHERED SPLIT DRIFTWOOD & CHARRED BRANCH MATERIAL ---
  // Fibrous vertical wood grain + weathered cracks
  float grainNoise = fbm3DFast(vec3(p.x * 28.0, p.y * 6.5, p.z * 28.0));
  float fineGrain = noise3D(vec3(p.x * 75.0, p.y * 16.0, p.z * 75.0));

  // Unburned weathered coastal driftwood color (warm grey-brown)
  vec3 driftwoodAlbedo = mix(vec3(0.095, 0.072, 0.056), vec3(0.185, 0.142, 0.108), grainNoise * 0.75 + fineGrain * 0.25);

  // Charring increases near flame core, on upper central branches, and on inner faces looking at fire
  vec3 toCore = normalize(fireCorePos - p);
  float facingFire = saturate(dot(n, toCore) * 0.5 + 0.5);
  float upperZone = smoothstep(0.24, 0.52, p.y) * smoothstep(0.36, 0.08, length(p.xz));
  float charMask = saturate(
    smoothstep(0.46, 0.15, radialFromCore) * (0.45 + 0.65 * facingFire)
    + upperZone * 0.92
  );

  // Outer front plank faces stay recognizable weathered split wood; inner/upper wood chars deep matte black
  vec3 albedo = mix(driftwoodAlbedo, vec3(0.012, 0.011, 0.012), charMask * 0.92);

  // Cool twilight sky ambient (front planks subtly pick up dusk blue sheen on angled grain)
  float skyFacing = saturate(n.y * 0.55 + 0.45);
  float frontSkyCatch = saturate(dot(n, normalize(vec3(0.15, 0.55, -0.82))));
  vec3 col = albedo * skyAmb * (0.45 + 0.85 * skyFacing);
  col += albedo * skyAmb * frontSkyCatch * 0.55 * (1.0 - charMask * 0.7);

  // Direct fire illumination on inner plank walls & side edges
  vec3 lFire = fireCorePos - p;
  float dFire = length(lFire);
  vec3 lDir = lFire / max(dFire, 0.001);
  float ndl = max(dot(n, lDir), 0.0);
  float fireAtten = 1.0 / (0.14 + dFire * dFire * 2.4);
  col += albedo * fireColor * ndl * fireAtten * 2.4;

  // Warm orange bounce light reflected up from the brightly fire-lit foreground sand onto the bottom of front planks!
  float groundBounce = saturate(-n.y * 0.65 + 0.45) * smoothstep(0.38, -0.02, p.y) * smoothstep(0.65, 0.12, length(p.xz));
  col += albedo * vec3(1.0, 0.38, 0.09) * groundBounce * (0.48 * fireFlicker);

  // Fiery grazing rim-light wrapping around the dark silhouetted wood edges right against the flame
  float fres = pow(1.0 - max(dot(n, v), 0.0), 3.4);
  float rimProximity = smoothstep(0.62, 0.10, radialFromCore) + smoothstep(0.28, 0.04, length(p.xz - vec2(0.34, -0.09))) * smoothstep(0.35, 0.02, p.y);
  col += fireColor * fres * saturate(rimProximity) * (0.42 + 0.58 * facingFire) * 0.58;

  // Glowing red-orange alligator-skin charcoal ember cracks along inner charred wood & burning right branch
  float crackPattern = fbm3DFast(p * 34.0 + vec3(0.0, -time * 0.06, 0.0));
  float fineCrack = smoothstep(0.58, 0.84, crackPattern);
  float rightBranchBurn = smoothstep(0.075, 0.025, length(p - mix(vec3(0.15, 0.34, -0.06), vec3(0.52, 0.01, -0.12), saturate((p.x - 0.15) / 0.37)))) * saturate(n.y * 0.8 + 0.3);
  float burnHeat = saturate(
    charMask * smoothstep(0.36, 0.10, radialFromCore) * (0.42 + 0.58 * facingFire)
    + rightBranchBurn * 0.65
  );
  float emberPulse = 0.72 + 0.28 * sin(time * 2.7 + p.y * 9.0 + crackPattern * 5.0);
  float emberAmt = fineCrack * pow(burnHeat, 1.45) * emberPulse * (1.0 + stoke * 0.45);
  col += blackbodyColor(mix(860.0, 1750.0, emberAmt)) * emberAmt * 3.4;

  return col;
}
`;
