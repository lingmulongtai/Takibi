/**
 * Procedural GPU textures generated once on startup:
 * 1. Seamless dual-channel value noise texture for fast hardware-filtered 3D noise
 * 2. Low-discrepancy dither / blue-noise approximation texture for artifact-free raymarching
 * 3. High-resolution RGBA16F sculpted beach sand terrain map with ~300 realistic footprints,
 *    displaced sand berms, wind ripples, campfire basin, and precomputed analytical gradients.
 */

function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createSeamlessValueNoise2D(size, seed) {
  const rand = mulberry32(seed);
  const grid = new Float32Array(size * size);
  for (let i = 0; i < grid.length; i++) {
    grid[i] = rand();
  }

  return function sample(u, v, freq) {
    const x = ((u * freq) % size + size) % size;
    const y = ((v * freq) % size + size) % size;
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const x1 = (x0 + 1) % size;
    const y1 = (y0 + 1) % size;
    const fx = x - x0;
    const fy = y - y0;
    const sx = fx * fx * (3.0 - 2.0 * fx);
    const sy = fy * fy * (3.0 - 2.0 * fy);

    const v00 = grid[y0 * size + x0];
    const v10 = grid[y0 * size + x1];
    const v01 = grid[y1 * size + x0];
    const v11 = grid[y1 * size + x1];

    const ix0 = v00 + (v10 - v00) * sx;
    const ix1 = v01 + (v11 - v01) * sx;
    return ix0 + (ix1 - ix0) * sy;
  };
}

/**
 * 256x256 RGBA8 seamless noise texture.
 * R: primary random value
 * G: shifted by (-37, -17) so a single 2D lookup evaluates fast 3D interpolated noise
 * B: smooth secondary value channel
 * A: independent high-frequency hash
 */
export function createNoiseTexture(gl) {
  const size = 256;
  const rand = mulberry32(0x7a41b1);
  const baseR = new Uint8Array(size * size);
  const baseB = new Uint8Array(size * size);
  const baseA = new Uint8Array(size * size);

  for (let i = 0; i < size * size; i++) {
    baseR[i] = Math.floor(rand() * 256);
    baseB[i] = Math.floor(rand() * 256);
    baseA[i] = Math.floor(rand() * 256);
  }

  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = y * size + x;
      const sx = (x - 37 + size) % size;
      const sy = (y - 17 + size) % size;
      const sIdx = sy * size + sx;

      data[idx * 4 + 0] = baseR[idx];
      data[idx * 4 + 1] = baseR[sIdx];
      data[idx * 4 + 2] = baseB[idx];
      data[idx * 4 + 3] = baseA[idx];
    }
  }

  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  gl.bindTexture(gl.TEXTURE_2D, null);

  return texture;
}

/**
 * 128x128 RGBA8 tiled blue-noise-like dither texture via high-pass filtered white noise
 * ranked into uniform [0, 1] quantiles for smooth spatiotemporal volumetric jitter.
 */
export function createBlueNoiseTexture(gl) {
  const size = 128;
  const count = size * size;
  const rand = mulberry32(0x1337beef);
  const data = new Uint8Array(count * 4);

  for (let ch = 0; ch < 4; ch++) {
    const raw = new Float32Array(count);
    for (let i = 0; i < count; i++) raw[i] = rand();

    // Two-pass separable box blur subtracted from raw noise -> blue-spectrum high-pass
    const tmp = new Float32Array(count);
    const blur = new Float32Array(count);
    for (let y = 0; y < size; y++) {
      const row = y * size;
      for (let x = 0; x < size; x++) {
        let s = 0;
        for (let k = -2; k <= 2; k++) {
          s += raw[row + ((x + k + size) % size)];
        }
        tmp[row + x] = s * 0.2;
      }
    }
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        let s = 0;
        for (let k = -2; k <= 2; k++) {
          s += tmp[((y + k + size) % size) * size + x];
        }
        blur[y * size + x] = raw[y * size + x] - s * 0.2;
      }
    }

    // Rank-equalize back to uniform [0, 255] distribution
    const indices = new Uint32Array(count);
    for (let i = 0; i < count; i++) indices[i] = i;
    indices.sort((a, b) => blur[a] - blur[b]);

    for (let rank = 0; rank < count; rank++) {
      data[indices[rank] * 4 + ch] = Math.min(255, Math.floor((rank / count) * 256));
    }
  }

  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, size, size, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
  gl.bindTexture(gl.TEXTURE_2D, null);

  return texture;
}

/**
 * World footprint domain for the sculpted beach map:
 * X in [-5.5, +5.5] meters (width 11m), Z in [-3.5, +7.5] meters (depth 11m).
 * Campfire sits at (0, 0, 0). Camera sits near (0, 0.72, -2.55). Shoreline near z = +5.8..+6.8.
 */
export const SAND_MAP_BOUNDS = {
  minX: -5.5,
  maxX: 5.5,
  minZ: -3.5,
  maxZ: 7.5,
};

/**
 * Sculpt a single anatomically believable beach footprint + pushed sand berm into the height grid.
 */
function stampFootprint(height, detail, size, wx, wz, angle, length, width, depth, leftFoot) {
  const spanX = SAND_MAP_BOUNDS.maxX - SAND_MAP_BOUNDS.minX;
  const spanZ = SAND_MAP_BOUNDS.maxZ - SAND_MAP_BOUNDS.minZ;

  const radius = length * 1.45;
  const minIx = Math.max(0, Math.floor(((wx - radius - SAND_MAP_BOUNDS.minX) / spanX) * size));
  const maxIx = Math.min(size - 1, Math.ceil(((wx + radius - SAND_MAP_BOUNDS.minX) / spanX) * size));
  const minIz = Math.max(0, Math.floor(((wz - radius - SAND_MAP_BOUNDS.minZ) / spanZ) * size));
  const maxIz = Math.min(size - 1, Math.ceil(((wz + radius - SAND_MAP_BOUNDS.minZ) / spanZ) * size));

  const cosA = Math.cos(-angle);
  const sinA = Math.sin(-angle);
  const sideSign = leftFoot ? -1.0 : 1.0;

  for (let iz = minIz; iz <= maxIz; iz++) {
    const z = SAND_MAP_BOUNDS.minZ + ((iz + 0.5) / size) * spanZ;
    const dz = z - wz;
    const row = iz * size;

    for (let ix = minIx; ix <= maxIx; ix++) {
      const x = SAND_MAP_BOUNDS.minX + ((ix + 0.5) / size) * spanX;
      const dx = x - wx;

      // Local foot coordinates: ly along foot length (-0.5 heel .. +0.5 toe), lx across width
      const lx = dx * cosA - dz * sinA;
      const ly = dx * sinA + dz * cosA;

      const u = lx / width;
      const v = ly / length;
      if (u * u + v * v > 2.6) continue;

      // Two-lobe silhouette: rounded heel + wider angled forefoot
      const heelU = (u - sideSign * 0.04) / 0.66;
      const heelV = (v + 0.44) / 0.44;
      const dHeel = Math.sqrt(heelU * heelU + heelV * heelV);

      const ballU = (u + sideSign * 0.06) / 0.88;
      const ballV = (v - 0.24) / 0.54;
      const dBall = Math.sqrt(ballU * ballU + ballV * ballV);

      // Smooth minimum of heel and ball creates realistic pinched arch
      const k = 0.28;
      const hBlend = Math.max(0.0, Math.min(1.0, 0.5 + (0.5 * (dBall - dHeel)) / k));
      const dFoot = dBall * (1.0 - hBlend) + dHeel * hBlend - k * hBlend * (1.0 - hBlend);

      // Depressed sole cavity (deeper at heel & ball)
      const soleMask = Math.exp(-Math.pow(Math.max(0.0, dFoot) / 0.72, 3.0));
      const heelDeep = 0.78 + 0.34 * Math.exp(-dHeel * dHeel * 1.4);
      const ballDeep = 0.76 + 0.28 * Math.exp(-dBall * dBall * 1.5);
      const depression = -depth * soleMask * Math.max(heelDeep, ballDeep);

      // Displaced raised sand rim/berm around the edge (stronger at heel kick-back and sides)
      const rimDist = (dFoot - 0.96) / 0.38;
      const rimBias = 0.85 + 0.38 * Math.max(0.0, -v) + 0.18 * Math.abs(u);
      const berm = depth * 0.46 * rimBias * Math.exp(-rimDist * rimDist);

      const idx = row + ix;
      height[idx] += depression + berm;
      // Record compacted bowl vs disturbed rim in detail channel
      detail[idx] = Math.max(-1.0, Math.min(1.0, detail[idx] + berm * 12.0 - soleMask * 0.45));
    }
  }
}

/**
 * Stamp broader irregular sand scoops / resting hollows typical around a beach bonfire.
 */
function stampSandScoop(height, detail, size, wx, wz, rx, rz, angle, depth) {
  const spanX = SAND_MAP_BOUNDS.maxX - SAND_MAP_BOUNDS.minX;
  const spanZ = SAND_MAP_BOUNDS.maxZ - SAND_MAP_BOUNDS.minZ;
  const rad = Math.max(rx, rz) * 2.1;

  const minIx = Math.max(0, Math.floor(((wx - rad - SAND_MAP_BOUNDS.minX) / spanX) * size));
  const maxIx = Math.min(size - 1, Math.ceil(((wx + rad - SAND_MAP_BOUNDS.minX) / spanX) * size));
  const minIz = Math.max(0, Math.floor(((wz - rad - SAND_MAP_BOUNDS.minZ) / spanZ) * size));
  const maxIz = Math.min(size - 1, Math.ceil(((wz + rad - SAND_MAP_BOUNDS.minZ) / spanZ) * size));

  const cosA = Math.cos(-angle);
  const sinA = Math.sin(-angle);

  for (let iz = minIz; iz <= maxIz; iz++) {
    const z = SAND_MAP_BOUNDS.minZ + ((iz + 0.5) / size) * spanZ;
    const dz = z - wz;
    const row = iz * size;
    for (let ix = minIx; ix <= maxIx; ix++) {
      const x = SAND_MAP_BOUNDS.minX + ((ix + 0.5) / size) * spanX;
      const dx = x - wx;
      const lx = (dx * cosA - dz * sinA) / rx;
      const ly = (dx * sinA + dz * cosA) / rz;
      const r2 = lx * lx + ly * ly;
      if (r2 > 4.2) continue;

      const r = Math.sqrt(r2);
      const bowl = -depth * Math.exp(-r2 * 1.45);
      const lip = depth * 0.34 * Math.exp(-Math.pow((r - 1.15) / 0.46, 2.0));
      const idx = row + ix;
      height[idx] += bowl + lip;
      detail[idx] += (lip - Math.abs(bowl) * 0.25) * 4.0;
    }
  }
}

/**
 * 768x768 RGBA16F sculpted beach terrain texture:
 * R: height (meters)
 * G: dh/dx analytical slope
 * B: dh/dz analytical slope
 * A: disturbance / micro-cavity AO & loose rim mask (0..1)
 */
export function createBeachTerrainTexture(gl, supportsFloatLinear) {
  const size = 768;
  const count = size * size;
  const height = new Float32Array(count);
  const detail = new Float32Array(count);

  const noise = createSeamlessValueNoise2D(128, 0x5a9d001);
  const rand = mulberry32(0xbeac471);

  const spanX = SAND_MAP_BOUNDS.maxX - SAND_MAP_BOUNDS.minX;
  const spanZ = SAND_MAP_BOUNDS.maxZ - SAND_MAP_BOUNDS.minZ;

  // 1. Base beach contour: gentle slope down toward ocean, subtle natural dunes & wind ripples
  for (let iz = 0; iz < size; iz++) {
    const v = (iz + 0.5) / size;
    const z = SAND_MAP_BOUNDS.minZ + v * spanZ;
    const row = iz * size;

    // Beach flattens near shoreline (z > 4.2) where waves wash smooth
    const dryFactor = Math.max(0.0, Math.min(1.0, (5.4 - z) / 2.2));
    const drySmooth = dryFactor * dryFactor * (3.0 - 2.0 * dryFactor);

    for (let ix = 0; ix < size; ix++) {
      const u = (ix + 0.5) / size;
      const x = SAND_MAP_BOUNDS.minX + u * spanX;

      // Macro beach undulations + slight foreground rise
      const slopeTowardSea = -0.028 * Math.max(0.0, z + 1.0);
      const n1 = (noise(u, v, 3.0) - 0.5) * 0.085;
      const n2 = (noise(u + 0.31, v + 0.17, 7.0) - 0.5) * 0.042;
      const n3 = (noise(u + 0.73, v + 0.41, 16.0) - 0.5) * 0.018;
      const n4 = (noise(u + 0.13, v + 0.89, 34.0) - 0.5) * 0.007;

      // Subtle cross-beach wind ripples
      const warp = noise(u, v, 8.0) * 1.4;
      const ripple = Math.sin(z * 11.5 + x * 2.2 + warp * 3.1) * 0.0045;

      // Shallow hand-dug campfire ring basin at (0, 0) with gently piled perimeter
      const fireR = Math.hypot(x, z);
      const fireBasin = -0.042 * Math.exp(-fireR * fireR * 2.6);
      const fireRing = 0.026 * Math.exp(-Math.pow((fireR - 0.82) / 0.42, 2.0));

      height[row + ix] =
        slopeTowardSea + (n1 + n2 + n3 + n4 + ripple) * drySmooth + fireBasin + fireRing;
      detail[row + ix] = (n3 * 16.0 + n4 * 24.0) * drySmooth;
    }
  }

  // 2. Broader irregular sand scoops & uneven depressions across foreground & midground
  for (let i = 0; i < 65; i++) {
    const x = (rand() - 0.5) * 8.2;
    const z = -2.6 + rand() * 6.8;
    if (Math.hypot(x, z) < 0.62) continue;
    const rx = 0.16 + rand() * 0.28;
    const rz = 0.14 + rand() * 0.24;
    const depth = (0.016 + rand() * 0.028) * Math.max(0.25, Math.min(1.0, (4.8 - z) / 2.2));
    stampSandScoop(height, detail, size, x, z, rx, rz, rand() * Math.PI * 2, depth);
  }

  // 3. Natural walking trails of footprints curving through the foreground and around the fire
  for (let trail = 0; trail < 14; trail++) {
    let x = -4.2 + rand() * 8.4;
    let z = -2.4 + rand() * 5.8;
    let heading = (rand() - 0.5) * Math.PI * 2.0;
    const steps = 8 + Math.floor(rand() * 11);
    const stride = 0.34 + rand() * 0.14;

    for (let s = 0; s < steps; s++) {
      heading += (rand() - 0.5) * 0.34;
      const leftFoot = s % 2 === 0;
      const lat = (leftFoot ? -1 : 1) * 0.085;
      const fx = x + Math.cos(heading + Math.PI * 0.5) * lat;
      const fz = z + Math.sin(heading + Math.PI * 0.5) * lat;

      if (
        fx > SAND_MAP_BOUNDS.minX + 0.4 &&
        fx < SAND_MAP_BOUNDS.maxX - 0.4 &&
        fz > SAND_MAP_BOUNDS.minZ + 0.3 &&
        fz < 4.4 &&
        Math.hypot(fx, fz) > 0.68
      ) {
        const footLen = 0.24 + rand() * 0.06;
        const footWid = 0.105 + rand() * 0.025;
        const shoreFade = Math.max(0.2, Math.min(1.0, (4.6 - fz) / 1.8));
        const depth = (0.022 + rand() * 0.024) * shoreFade;
        stampFootprint(
          height,
          detail,
          size,
          fx,
          fz,
          heading + (rand() - 0.5) * 0.22,
          footLen,
          footWid,
          depth,
          leftFoot,
        );
      }

      x += Math.cos(heading) * stride;
      z += Math.sin(heading) * stride;
    }
  }

  // 4. Dense foreground hero footprints (directly matching the richly trampled foreground sand)
  for (let i = 0; i < 155; i++) {
    const x = (rand() - 0.5) * 6.4;
    const z = -2.5 + rand() * 5.8;
    const distFire = Math.hypot(x, z);
    if (distFire < 0.64) continue;

    // Slightly deeper, crispier tracks in the foreground & firelight zone
    const nearBonus = z < 1.6 ? 1.15 : 0.85;
    const shoreFade = Math.max(0.18, Math.min(1.0, (4.7 - z) / 2.0));
    const footLen = 0.21 + rand() * 0.09;
    const footWid = 0.095 + rand() * 0.032;
    const depth = (0.02 + rand() * 0.028) * nearBonus * shoreFade;
    stampFootprint(
      height,
      detail,
      size,
      x,
      z,
      rand() * Math.PI * 2,
      footLen,
      footWid,
      depth,
      rand() < 0.5,
    );
  }

  // 5. Light Gaussian-like 3x3 relaxation pass to mimic natural angle-of-repose of dry sand
  const smoothed = new Float32Array(count);
  for (let iz = 0; iz < size; iz++) {
    const zPrev = Math.max(0, iz - 1) * size;
    const zCurr = iz * size;
    const zNext = Math.min(size - 1, iz + 1) * size;
    for (let ix = 0; ix < size; ix++) {
      const xPrev = Math.max(0, ix - 1);
      const xNext = Math.min(size - 1, ix + 1);
      const center = height[zCurr + ix];
      const cross =
        height[zCurr + xPrev] +
        height[zCurr + xNext] +
        height[zPrev + ix] +
        height[zNext + ix];
      const diag =
        height[zPrev + xPrev] +
        height[zPrev + xNext] +
        height[zNext + xPrev] +
        height[zNext + xNext];
      smoothed[zCurr + ix] = center * 0.36 + cross * 0.11 + diag * 0.05;
    }
  }

  // 6. Bake shoreline slope, relief boost & dry-to-wet smoothing directly into RGBA16F
  //    so runtime sandHeight() is a SINGLE texture fetch with zero per-step noise math!
  const SEA_LEVEL = -0.24;
  const RELIEF_BOOST = 1.44;
  const finalHeight = new Float32Array(count);

  const smoothstepJS = (e0, e1, x) => {
    const t = Math.max(0.0, Math.min(1.0, (x - e0) / (e1 - e0)));
    return t * t * (3.0 - 2.0 * t);
  };

  for (let iz = 0; iz < size; iz++) {
    const v = (iz + 0.5) / size;
    const z = SAND_MAP_BOUNDS.minZ + v * spanZ;
    const row = iz * size;
    const baseSlope = -0.028 * Math.max(0.0, z + 1.0);
    const dryRelief = smoothstepJS(5.1, 3.6, z);

    for (let ix = 0; ix < size; ix++) {
      const u = (ix + 0.5) / size;
      const x = SAND_MAP_BOUNDS.minX + u * spanX;

      const hFoot = baseSlope + (smoothed[row + ix] * RELIEF_BOOST - baseSlope) * dryRelief;
      const shoreNoise =
        (noise(u, 0.25, 4.0) - 0.5) * 0.36 + (noise(u + 0.37, 0.61, 9.0) - 0.5) * 0.14;
      const shoreLine = 5.25 + Math.sin(x * 0.3 + 0.5) * 0.30 + shoreNoise;
      // Gentle natural beach slope crossing SEA_LEVEL (-0.24) right around z = 5.6m (no early cliff drop!)
      const shoreT = smoothstepJS(shoreLine - 0.85, shoreLine + 1.35, z);

      finalHeight[row + ix] = hFoot + (SEA_LEVEL - 0.12 - hFoot) * shoreT;
    }
  }

  // 7. Compute exact world-space gradients (dh/dx, dh/dz) and pack into RGBA32F -> RGBA16F
  const dxWorld = spanX / size;
  const dzWorld = spanZ / size;
  const rgba = new Float32Array(count * 4);

  for (let iz = 0; iz < size; iz++) {
    const zPrev = Math.max(0, iz - 1) * size;
    const zCurr = iz * size;
    const zNext = Math.min(size - 1, iz + 1) * size;
    const z = SAND_MAP_BOUNDS.minZ + ((iz + 0.5) / size) * spanZ;
    const dryRelief = smoothstepJS(5.1, 3.6, z);

    for (let ix = 0; ix < size; ix++) {
      const xPrev = Math.max(0, ix - 1);
      const xNext = Math.min(size - 1, ix + 1);

      const h = finalHeight[zCurr + ix];
      const dhdx = (finalHeight[zCurr + xNext] - finalHeight[zCurr + xPrev]) / (2.0 * dxWorld);
      const dhdz = (finalHeight[zNext + ix] - finalHeight[zPrev + ix]) / (2.0 * dzWorld);

      // Compute local curvature / cavity ambient occlusion proxy from Laplacian
      const avgNeighbors =
        0.25 *
        (finalHeight[zCurr + xPrev] +
          finalHeight[zCurr + xNext] +
          finalHeight[zPrev + ix] +
          finalHeight[zNext + ix]);
      const concavity = Math.max(-1.0, Math.min(1.0, (h - avgNeighbors) * 200.0));
      const rawAo = Math.max(
        0.15,
        Math.min(1.0, 0.72 + concavity * 0.28 + detail[zCurr + ix] * 0.08),
      );
      const ao = 0.85 + (rawAo - 0.85) * dryRelief;

      const out = (zCurr + ix) * 4;
      rgba[out + 0] = h;
      rgba[out + 1] = dhdx;
      rgba[out + 2] = dhdz;
      rgba[out + 3] = ao;
    }
  }

  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, size, size, 0, gl.RGBA, gl.FLOAT, rgba);
  const filter = supportsFloatLinear ? gl.LINEAR : gl.NEAREST;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindTexture(gl.TEXTURE_2D, null);

  return texture;
}
