import { createProgram } from './gl-utils.js';

/**
 * GPU-rendered 3D rising campfire sparks & floating embers.
 * Simulates buoyant turbulent thermal trajectories in world space and renders
 * camera-aligned velocity-stretched HDR streaks depth-occluded against the scene's
 * alpha depth channel so sparks weave cleanly in front of and behind the dark charred sticks.
 */

const SPARK_VERTEX_SHADER = `#version 300 es
precision highp float;

layout(location = 0) in vec2 aCorner;      // [-1, 1] quad corners
layout(location = 1) in vec3 aPos;         // World-space spark position
layout(location = 2) in vec3 aVel;         // World-space spark velocity
layout(location = 3) in vec4 aParams;      // x: size, y: life01, z: temp01, w: flicker

uniform vec2 uResolution;
uniform vec3 uCamPos;
uniform vec3 uCamRight;
uniform vec3 uCamUp;
uniform vec3 uCamFwd;
uniform float uFocal;

out vec2 vLocal;
out float vLife;
out float vTemp;
out float vFlicker;
out float vRayDist;

void main() {
  vec3 rel = aPos - uCamPos;
  float zCam = dot(rel, uCamFwd);
  if (zCam <= 0.15 || aParams.y <= 0.001) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }

  float xCam = dot(rel, uCamRight);
  float yCam = dot(rel, uCamUp);

  float aspect = uResolution.x / uResolution.y;
  vec2 centerNdc = vec2(
    (xCam / zCam) * uFocal / aspect,
    (yCam / zCam) * uFocal
  );

  // Project velocity tip for organic motion-blur streak stretching
  vec3 tipRel = (aPos + aVel * 0.026) - uCamPos;
  float tipZ = max(0.15, dot(tipRel, uCamFwd));
  vec2 tipNdc = vec2(
    (dot(tipRel, uCamRight) / tipZ) * uFocal / aspect,
    (dot(tipRel, uCamUp) / tipZ) * uFocal
  );

  vec2 deltaPx = (tipNdc - centerNdc) * 0.5 * uResolution;
  float streakLen = clamp(length(deltaPx), 1.5, 22.0);
  vec2 dirPx = length(deltaPx) > 0.001 ? normalize(deltaPx) : vec2(0.0, 1.0);
  vec2 perpPx = vec2(-dirPx.y, dirPx.x);

  // Perspective-scaled spark radius in pixels
  float pxRadius = clamp((aParams.x / zCam) * uResolution.y * 0.58, 1.25, 5.2);
  vec2 offsetPx = dirPx * (aCorner.y * max(pxRadius, streakLen * 0.55)) + perpPx * (aCorner.x * pxRadius);

  vec2 finalNdc = centerNdc + (offsetPx / uResolution) * 2.0;

  vLocal = aCorner;
  vLife = aParams.y;
  vTemp = aParams.z;
  vFlicker = aParams.w;
  vRayDist = length(rel);

  gl_Position = vec4(finalNdc, 0.0, 1.0);
}
`;

const SPARK_FRAGMENT_SHADER = `#version 300 es
precision highp float;

in vec2 vLocal;
in float vLife;
in float vTemp;
in float vFlicker;
in float vRayDist;

uniform sampler2D uSceneTex;
uniform vec2 uResolution;
uniform float uFireGain;

out vec4 fragColor;

void main() {
  // Exact 3D occlusion test against the scene raymarch hit distance stored in sceneTex.a!
  vec2 screenUv = gl_FragCoord.xy / uResolution;
  float sceneDepth = textureLod(uSceneTex, screenUv, 0.0).a;
  float occ = smoothstep(vRayDist - 0.04, vRayDist + 0.04, sceneDepth);
  if (occ <= 0.001) discard;

  // Smooth glowing capsule / ember falloff
  float r2 = dot(vLocal, vLocal);
  if (r2 > 1.0) discard;

  float core = exp(-r2 * 5.2);
  float halo = exp(-r2 * 2.1) * 0.35;

  // Cooling ember color: incandescent gold-white -> rich amber -> deep crimson
  vec3 hotCol = vec3(1.0, 0.88, 0.52);
  vec3 midCol = vec3(1.0, 0.42, 0.08);
  vec3 coolCol = vec3(0.95, 0.14, 0.015);
  vec3 col = mix(coolCol, midCol, smoothstep(0.0, 0.55, vTemp));
  col = mix(col, hotCol, smoothstep(0.55, 1.0, vTemp));

  float fade = smoothstep(0.0, 0.14, vLife) * smoothstep(1.0, 0.55, vLife);
  float energy = (core * 11.5 + halo * 3.0) * fade * vFlicker * occ * uFireGain;

  fragColor = vec4(col * energy, 0.0);
}
`;

export class SparkSystem {
  constructor(gl, maxSparks = 240) {
    this.gl = gl;
    this.maxSparks = maxSparks;
    this.activeLimit = maxSparks;
    this.program = createProgram(gl, SPARK_VERTEX_SHADER, SPARK_FRAGMENT_SHADER, 'sparks');

    // Particle pool
    this.sparks = Array.from({ length: maxSparks }, () => ({
      active: false,
      age: 0,
      maxAge: 1,
      x: 0,
      y: 0,
      z: 0,
      vx: 0,
      vy: 0,
      vz: 0,
      size: 0.004,
      seed: Math.random() * 100,
      swirl: 1.0,
    }));

    this.spawnAccumulator = 0;
    this.instanceData = new Float32Array(maxSparks * 10); // pos(3) + vel(3) + params(4)

    this._initGeometry();

    // Seed an initial warm cloud of rising embers immediately on frame 0
    for (let i = 0; i < 42; i++) {
      this._spawnOne(false, Math.random() * 0.85);
    }
  }

  _initGeometry() {
    const gl = this.gl;
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);

    // Quad vertices (triangle strip)
    const quad = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);
    this.quadBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    // Dynamic interleaved instance buffer
    this.instanceBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.instanceData.byteLength, gl.DYNAMIC_DRAW);

    const stride = 10 * 4;
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, stride, 0);
    gl.vertexAttribDivisor(1, 1);

    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, stride, 3 * 4);
    gl.vertexAttribDivisor(2, 1);

    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 4, gl.FLOAT, false, stride, 6 * 4);
    gl.vertexAttribDivisor(3, 1);

    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  setActiveLimit(count) {
    this.activeLimit = Math.min(this.maxSparks, Math.max(24, count));
  }

  burst(count = 18, boosted = false) {
    let spawned = 0;
    for (let i = 0; i < this.activeLimit && spawned < count; i++) {
      if (!this.sparks[i].active) {
        this._spawnInto(this.sparks[i], boosted, 0);
        spawned++;
      }
    }
  }

  _spawnOne(boosted = false, preAgeFrac = 0) {
    for (let i = 0; i < this.activeLimit; i++) {
      if (!this.sparks[i].active) {
        this._spawnInto(this.sparks[i], boosted, preAgeFrac);
        return;
      }
    }
  }

  _spawnInto(s, boosted, preAgeFrac) {
    const angle = Math.random() * Math.PI * 2;
    const rad = Math.pow(Math.random(), 0.7) * 0.16;

    // Occasionally spawn along the burning right-hand driftwood branch too
    const fromRightBranch = Math.random() < 0.14;
    if (fromRightBranch) {
      const t = Math.random();
      s.x = 0.22 + t * 0.26;
      s.y = 0.28 - t * 0.20;
      s.z = -0.07 - t * 0.05;
    } else {
      s.x = Math.cos(angle) * rad;
      s.y = 0.14 + Math.random() * 0.34;
      s.z = Math.sin(angle) * rad * 0.85 - 0.02;
    }

    const boostScale = boosted ? 1.45 : 1.0;
    s.vx = (Math.random() - 0.44) * 0.32 * boostScale;
    s.vy = (0.48 + Math.random() * 0.78) * boostScale;
    s.vz = (Math.random() - 0.5) * 0.24 * boostScale;

    s.maxAge = 1.15 + Math.random() * 2.4;
    s.age = preAgeFrac * s.maxAge;
    s.size = 0.0022 + Math.pow(Math.random(), 2.2) * 0.0044;
    s.seed = Math.random() * 200;
    s.swirl = (Math.random() < 0.5 ? -1 : 1) * (0.45 + Math.random() * 1.1);
    s.active = true;

    if (preAgeFrac > 0) {
      s.x += s.vx * s.age + 0.09 * s.age;
      s.y += s.vy * s.age;
      s.z += s.vz * s.age;
    }
  }

  update(dt, time, stoke = 0) {
    const clampedDt = Math.min(dt, 0.05);
    const spawnRate = 24.0 + stoke * 55.0;
    this.spawnAccumulator += clampedDt * spawnRate;

    while (this.spawnAccumulator >= 1.0) {
      this._spawnOne(stoke > 0.25, 0);
      this.spawnAccumulator -= 1.0;
    }

    // Gentle rightward coastal breeze matching the volumetric flame gust
    const windX = 0.14 + Math.sin(time * 0.65) * 0.09 + Math.sin(time * 1.43 + 1.1) * 0.05;
    const windZ = 0.03 + Math.cos(time * 0.52) * 0.03;

    let liveCount = 0;
    const buf = this.instanceData;

    for (let i = 0; i < this.activeLimit; i++) {
      const s = this.sparks[i];
      if (!s.active) continue;

      s.age += clampedDt;
      if (s.age >= s.maxAge) {
        s.active = false;
        continue;
      }

      const life01 = s.age / s.maxAge;

      // Helical thermal curl + coastal breeze + buoyancy decay
      const phase = time * 3.4 + s.seed + s.y * 5.2;
      const turbX = Math.sin(phase) * 0.55 * s.swirl + Math.cos(phase * 1.7 + 1.1) * 0.28;
      const turbZ = Math.cos(phase * 1.13) * 0.45 * s.swirl;
      const buoyancy = (0.38 * (1.0 - life01 * 0.72)) - 0.18 * life01;

      s.vx += (windX + turbX - s.vx * 1.45) * clampedDt;
      s.vy += (buoyancy - s.vy * 0.55) * clampedDt;
      s.vz += (windZ + turbZ - s.vz * 1.45) * clampedDt;

      s.x += s.vx * clampedDt;
      s.y += s.vy * clampedDt;
      s.z += s.vz * clampedDt;

      const temp01 = Math.max(0.0, 1.0 - Math.pow(life01, 0.85));
      const flicker =
        0.62 +
        0.38 * Math.sin(time * 19.0 + s.seed * 3.7) * Math.sin(time * 11.3 + s.seed);

      const off = liveCount * 10;
      buf[off + 0] = s.x;
      buf[off + 1] = s.y;
      buf[off + 2] = s.z;
      buf[off + 3] = s.vx;
      buf[off + 4] = s.vy;
      buf[off + 5] = s.vz;
      buf[off + 6] = s.size;
      buf[off + 7] = life01;
      buf[off + 8] = temp01;
      buf[off + 9] = Math.max(0.15, flicker);

      liveCount++;
    }

    this.liveCount = liveCount;
    if (liveCount > 0) {
      const gl = this.gl;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.instanceBuffer);
      gl.bufferSubData(gl.ARRAY_BUFFER, 0, buf.subarray(0, liveCount * 10));
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
    }
  }

  render(camera, sceneTex, width, height, fireGain) {
    if (!this.liveCount) return;

    const gl = this.gl;
    gl.useProgram(this.program.program);
    gl.bindVertexArray(this.vao);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, sceneTex);
    gl.uniform1i(this.program.uniform('uSceneTex'), 0);

    gl.uniform2f(this.program.uniform('uResolution'), width, height);
    gl.uniform3fv(this.program.uniform('uCamPos'), camera.pos);
    gl.uniform3fv(this.program.uniform('uCamRight'), camera.right);
    gl.uniform3fv(this.program.uniform('uCamUp'), camera.up);
    gl.uniform3fv(this.program.uniform('uCamFwd'), camera.fwd);
    gl.uniform1f(this.program.uniform('uFocal'), camera.focal);
    gl.uniform1f(this.program.uniform('uFireGain'), fireGain);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.liveCount);
    gl.disable(gl.BLEND);

    gl.bindVertexArray(null);
  }

  destroy() {
    const gl = this.gl;
    this.program.destroy();
    gl.deleteBuffer(this.quadBuffer);
    gl.deleteBuffer(this.instanceBuffer);
    gl.deleteVertexArray(this.vao);
  }
}
