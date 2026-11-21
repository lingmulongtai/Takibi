import {
  createWebGL2Context,
  createProgram,
  createRenderTarget,
  createMRTRenderTarget,
  createEmptyVAO,
} from './gl-utils.js';
import {
  createNoiseTexture,
  createBlueNoiseTexture,
  createBeachTerrainTexture,
} from './procedural-textures.js';
import { FULLSCREEN_VERTEX_SHADER } from './shaders/common.js';
import { BAKE_STATIC_FRAGMENT_SHADER, SCENE_FRAGMENT_SHADER } from './shaders/scene.js';
import {
  BRIGHT_PASS_FRAGMENT_SHADER,
  BLOOM_DOWNSAMPLE_FRAGMENT_SHADER,
  BLOOM_UPSAMPLE_FRAGMENT_SHADER,
  COMPOSITE_FRAGMENT_SHADER,
} from './shaders/post.js';
import { SparkSystem } from './sparks.js';
import { FireFluidSim } from './fire-sim.js';

function normalize3(v) {
  const len = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / len, v[1] / len, v[2] / len];
}

function cross3(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

/**
 * Multi-pass HDR WebGL2 render pipeline:
 * 1. Main raymarched HDR scene + volumetric fire (RGBA16F, RGB radiance + A depth)
 * 2. Depth-occluded 3D instanced spark & ember streaks (RGBA16F)
 * 3. Soft-knee bright-pass with Karis weighting
 * 4. 5-level Jimenez downsample & tent upsample bloom + warm photographic halation
 * 5. Final AgX tonemap, lens dispersion, vignette, and fine sensor grain composite
 */
export class TakibiPipeline {
  constructor(canvas, qualityPreset, moodPreset) {
    this.canvas = canvas;
    this.quality = qualityPreset;
    this.mood = moodPreset;
    this.frameIndex = 0;

    const { gl, caps } = createWebGL2Context(canvas);
    this.gl = gl;
    this.caps = caps;

    this.vao = createEmptyVAO(gl);

    // Compile all pipeline shader programs
    this.programs = {
      bake: createProgram(gl, FULLSCREEN_VERTEX_SHADER, BAKE_STATIC_FRAGMENT_SHADER, 'bake'),
      scene: createProgram(gl, FULLSCREEN_VERTEX_SHADER, SCENE_FRAGMENT_SHADER, 'scene'),
      bright: createProgram(gl, FULLSCREEN_VERTEX_SHADER, BRIGHT_PASS_FRAGMENT_SHADER, 'bright'),
      downsample: createProgram(
        gl,
        FULLSCREEN_VERTEX_SHADER,
        BLOOM_DOWNSAMPLE_FRAGMENT_SHADER,
        'bloom-down',
      ),
      upsample: createProgram(
        gl,
        FULLSCREEN_VERTEX_SHADER,
        BLOOM_UPSAMPLE_FRAGMENT_SHADER,
        'bloom-up',
      ),
      composite: createProgram(gl, FULLSCREEN_VERTEX_SHADER, COMPOSITE_FRAGMENT_SHADER, 'composite'),
    };

    // Generate startup GPU procedural textures
    this.textures = {
      noise: createNoiseTexture(gl),
      blueNoise: createBlueNoiseTexture(gl),
      sandMap: createBeachTerrainTexture(gl, caps.supportsFloatLinear),
    };

    this.sparks = new SparkSystem(gl, 240);
    this.sparks.setActiveLimit(this.quality.sparkCount);

    // Real-time GPU Navier-Stokes buoyant fire fluid simulator (pre-warmed to roaring equilibrium!)
    this.fireSim = new FireFluidSim(gl, this.textures.noise, 192, 168);
    this.fireSim.warmUp(95);

    this.targets = {
      gBuffer: null,
      scene: null,
      sparks: null,
      bloomDown: [],
      bloomUp: [],
    };

    // Cached G-Buffer tracking (only re-baked on resize, mood change, or camera parallax move!)
    this.gBufferDirty = true;
    this.gBufferNeedsRefine = false;
    this.gBufferStillTime = 0;
    this.bakedCamX = 1e9;
    this.bakedCamY = 1e9;

    this.renderWidth = 0;
    this.renderHeight = 0;
    this.displayWidth = 0;
    this.displayHeight = 0;

    this.resize();
  }

  setQuality(qualityPreset) {
    this.quality = qualityPreset;
    this.sparks.setActiveLimit(qualityPreset.sparkCount);
    this.resize(true);
  }

  setMood(moodPreset) {
    this.mood = moodPreset;
    this.gBufferDirty = true;
  }

  triggerSparkBurst(count = 20, boosted = false) {
    this.sparks.burst(count, boosted);
  }

  resize(force = false) {
    const nativeDpr = Math.min(window.devicePixelRatio || 1, 2.0);
    const dpr = Math.min(nativeDpr, this.quality.dprCap);
    const cssW = Math.max(1, this.canvas.clientWidth || window.innerWidth);
    const cssH = Math.max(1, this.canvas.clientHeight || window.innerHeight);

    // Keep output canvas crisp at native display DPR while capping internal raymarch pixel budget!
    const displayW = Math.max(1, Math.round(cssW * nativeDpr));
    const displayH = Math.max(1, Math.round(cssH * nativeDpr));
    let renderW = Math.max(1, Math.round(cssW * dpr * this.quality.resolutionScale));
    let renderH = Math.max(1, Math.round(cssH * dpr * this.quality.resolutionScale));

    if (this.quality.maxPixels && renderW * renderH > this.quality.maxPixels) {
      const scale = Math.sqrt(this.quality.maxPixels / (renderW * renderH));
      renderW = Math.max(1, Math.round(renderW * scale));
      renderH = Math.max(1, Math.round(renderH * scale));
    }

    if (
      !force &&
      displayW === this.displayWidth &&
      displayH === this.displayHeight &&
      renderW === this.renderWidth &&
      renderH === this.renderHeight
    ) {
      return { renderW, renderH, displayW, displayH };
    }

    this.displayWidth = displayW;
    this.displayHeight = displayH;
    this.renderWidth = renderW;
    this.renderHeight = renderH;

    this.canvas.width = displayW;
    this.canvas.height = displayH;

    this._rebuildRenderTargets(renderW, renderH);
    return { renderW, renderH, displayW, displayH };
  }

  _destroyRenderTargets() {
    if (this.targets.gBuffer) this.targets.gBuffer.destroy();
    if (this.targets.scene) this.targets.scene.destroy();
    if (this.targets.sparks) this.targets.sparks.destroy();
    for (const rt of this.targets.bloomDown) rt.destroy();
    for (const rt of this.targets.bloomUp) rt.destroy();
    this.targets.gBuffer = null;
    this.targets.bloomDown = [];
    this.targets.bloomUp = [];
  }

  _rebuildRenderTargets(width, height) {
    this._destroyRenderTargets();
    const gl = this.gl;
    const hdr = this.caps.supportsHalfFloatFBO;

    // Static G-Buffer MRT: [0] twilight base + exact depth, [1] unit firelight response + ember/wetness meta
    this.targets.gBuffer = createMRTRenderTarget(gl, width, height, 2, { hdr, filter: gl.NEAREST });
    this.targets.scene = createRenderTarget(gl, width, height, { hdr });
    this.targets.sparks = createRenderTarget(gl, width, height, { hdr });
    this.gBufferDirty = true;

    const levels = this.quality.bloomPasses;
    let bw = Math.max(2, Math.floor(width / 2));
    let bh = Math.max(2, Math.floor(height / 2));

    for (let i = 0; i < levels; i++) {
      this.targets.bloomDown.push(createRenderTarget(gl, bw, bh, { hdr }));
      bw = Math.max(2, Math.floor(bw / 2));
      bh = Math.max(2, Math.floor(bh / 2));
    }

    // Upsample pyramid mirrors downsample levels from levels-2 back up to 0
    for (let i = 0; i < levels - 1; i++) {
      const ref = this.targets.bloomDown[i];
      this.targets.bloomUp.push(createRenderTarget(gl, ref.width, ref.height, { hdr }));
    }
  }

  _computeCamera(cameraOffset) {
    const pos = [
      cameraOffset.x * 0.14,
      0.72 + cameraOffset.y * 0.055,
      -2.06,
    ];
    const target = [
      cameraOffset.x * 0.035,
      0.345 + cameraOffset.y * 0.025,
      0.35,
    ];
    const fwd = normalize3([target[0] - pos[0], target[1] - pos[1], target[2] - pos[2]]);
    const right = normalize3(cross3([0, 1, 0], fwd));
    const up = cross3(fwd, right);
    return { pos, right, up, fwd, focal: 1.56 };
  }

  _bakeStaticGBuffer(cameraOffset, highQuality = true) {
    const gl = this.gl;
    const rw = this.renderWidth;
    const rh = this.renderHeight;
    const bakeProg = this.programs.bake;

    gl.bindFramebuffer(gl.FRAMEBUFFER, this.targets.gBuffer.framebuffer);
    gl.viewport(0, 0, rw, rh);
    gl.useProgram(bakeProg.program);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.textures.noise);
    gl.uniform1i(bakeProg.uniform('uNoiseTex'), 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.textures.blueNoise);
    gl.uniform1i(bakeProg.uniform('uBlueNoiseTex'), 1);

    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.textures.sandMap);
    gl.uniform1i(bakeProg.uniform('uSandMap'), 2);

    gl.uniform2f(bakeProg.uniform('uResolution'), rw, rh);
    gl.uniform2f(bakeProg.uniform('uCameraOffset'), cameraOffset.x, cameraOffset.y);
    gl.uniform1f(bakeProg.uniform('uSkyExposure'), this.mood.skyExposure);
    gl.uniform1f(bakeProg.uniform('uSunsetStrength'), this.mood.sunsetStrength);
    gl.uniform1f(bakeProg.uniform('uAmbientBoost'), this.mood.ambientBoost);
    gl.uniform1f(bakeProg.uniform('uFireGain'), this.mood.fireGain);
    gl.uniform1f(bakeProg.uniform('uStarVisibility'), this.mood.starVisibility);

    // Consistent wood-aware shadow step count eliminates shadow popping when moving vs stopping the mouse!
    gl.uniform1i(bakeProg.uniform('uSceneSteps'), highQuality ? 96 : Math.max(76, this.quality.sceneSteps));
    gl.uniform1i(bakeProg.uniform('uShadowSteps'), highQuality ? 26 : 22);

    this._drawFullscreen();

    this.bakedCamX = cameraOffset.x;
    this.bakedCamY = cameraOffset.y;
    this.gBufferDirty = false;
    this.gBufferNeedsRefine = !highQuality;
    this.gBufferStillTime = 0;
  }

  _drawFullscreen() {
    const gl = this.gl;
    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindVertexArray(null);
  }

  render({ time, dt, cameraOffset, stoke, fireFlicker }) {
    const gl = this.gl;
    const rw = this.renderWidth;
    const rh = this.renderHeight;

    // Re-bake static beach/wood G-Buffer ONLY when camera moves, mood switches, or resized!
    const camMoved = Math.hypot(cameraOffset.x - this.bakedCamX, cameraOffset.y - this.bakedCamY) > 0.0008;
    if (this.gBufferDirty) {
      this._bakeStaticGBuffer(cameraOffset, true);
    } else if (camMoved) {
      this._bakeStaticGBuffer(cameraOffset, false);
    } else if (this.gBufferNeedsRefine) {
      this.gBufferStillTime += dt;
      if (this.gBufferStillTime >= 0.14) {
        this._bakeStaticGBuffer(cameraOffset, true);
      }
    }

    // Step real-time Navier-Stokes buoyant fire fluid simulation & 3D spark physics
    this.fireSim.step(dt, stoke);
    this.sparks.update(dt, time, stoke);

    // --- PASS 1: Ultra-Fast Live Scene Pass (Cached G-Buffer + Live 3D Ocean + Live Navier-Stokes Fire!) ---
    const sceneProg = this.programs.scene;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.targets.scene.framebuffer);
    gl.viewport(0, 0, rw, rh);
    gl.useProgram(sceneProg.program);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.textures.noise);
    gl.uniform1i(sceneProg.uniform('uNoiseTex'), 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.textures.blueNoise);
    gl.uniform1i(sceneProg.uniform('uBlueNoiseTex'), 1);

    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.targets.gBuffer.textures[0]);
    gl.uniform1i(sceneProg.uniform('uGBaseTex'), 2);

    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.targets.gBuffer.textures[1]);
    gl.uniform1i(sceneProg.uniform('uGFireTex'), 3);

    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, this.fireSim.texture);
    gl.uniform1i(sceneProg.uniform('uFireSimTex'), 4);

    gl.uniform2f(sceneProg.uniform('uResolution'), rw, rh);
    gl.uniform1f(sceneProg.uniform('uTime'), time);
    gl.uniform1f(sceneProg.uniform('uFrameIndex'), this.frameIndex);
    gl.uniform2f(sceneProg.uniform('uCameraOffset'), cameraOffset.x, cameraOffset.y);
    gl.uniform1f(sceneProg.uniform('uFireFlicker'), fireFlicker);
    gl.uniform1f(sceneProg.uniform('uStoke'), stoke);
    gl.uniform1f(sceneProg.uniform('uSkyExposure'), this.mood.skyExposure);
    gl.uniform1f(sceneProg.uniform('uSunsetStrength'), this.mood.sunsetStrength);
    gl.uniform1f(sceneProg.uniform('uAmbientBoost'), this.mood.ambientBoost);
    gl.uniform1f(sceneProg.uniform('uFireGain'), this.mood.fireGain);
    gl.uniform1f(sceneProg.uniform('uStarVisibility'), this.mood.starVisibility);
    gl.uniform1i(sceneProg.uniform('uFireSteps'), this.quality.fireSteps);

    this._drawFullscreen();

    // --- PASS 2: Depth-Occluded 3D Rising Sparks & Embers ---
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.targets.sparks.framebuffer);
    gl.viewport(0, 0, rw, rh);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const cam = this._computeCamera(cameraOffset);
    this.sparks.render(cam, this.targets.scene.texture, rw, rh, this.mood.fireGain);

    // --- PASS 3: Soft-Knee HDR Bright Pass (into bloomDown[0]) ---
    const b0 = this.targets.bloomDown[0];
    const brightProg = this.programs.bright;
    gl.bindFramebuffer(gl.FRAMEBUFFER, b0.framebuffer);
    gl.viewport(0, 0, b0.width, b0.height);
    gl.useProgram(brightProg.program);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.targets.scene.texture);
    gl.uniform1i(brightProg.uniform('uSceneTex'), 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.targets.sparks.texture);
    gl.uniform1i(brightProg.uniform('uSparksTex'), 1);

    gl.uniform2f(brightProg.uniform('uTexelSize'), 1 / rw, 1 / rh);
    this._drawFullscreen();

    // --- PASS 4: Progressive 13-Tap Jimenez Downsample Pyramid ---
    const downProg = this.programs.downsample;
    gl.useProgram(downProg.program);
    for (let i = 1; i < this.targets.bloomDown.length; i++) {
      const src = this.targets.bloomDown[i - 1];
      const dst = this.targets.bloomDown[i];
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst.framebuffer);
      gl.viewport(0, 0, dst.width, dst.height);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, src.texture);
      gl.uniform1i(downProg.uniform('uSourceTex'), 0);
      gl.uniform2f(downProg.uniform('uTexelSize'), 1 / src.width, 1 / src.height);
      this._drawFullscreen();
    }

    // --- PASS 5: Progressive 9-Tap Tent Upsample Pyramid ---
    const upProg = this.programs.upsample;
    gl.useProgram(upProg.program);
    const lastIdx = this.targets.bloomDown.length - 1;
    let currentTex = this.targets.bloomDown[lastIdx].texture;
    let currentW = this.targets.bloomDown[lastIdx].width;
    let currentH = this.targets.bloomDown[lastIdx].height;

    for (let i = lastIdx - 1; i >= 0; i--) {
      const base = this.targets.bloomDown[i];
      const dst = this.targets.bloomUp[i];
      gl.bindFramebuffer(gl.FRAMEBUFFER, dst.framebuffer);
      gl.viewport(0, 0, dst.width, dst.height);

      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, currentTex);
      gl.uniform1i(upProg.uniform('uSourceTex'), 0);

      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, base.texture);
      gl.uniform1i(upProg.uniform('uBaseTex'), 1);

      gl.uniform2f(upProg.uniform('uTexelSize'), 1 / currentW, 1 / currentH);
      gl.uniform1f(upProg.uniform('uRadius'), 1.18);
      gl.uniform1f(upProg.uniform('uWeight'), 0.85);
      this._drawFullscreen();

      currentTex = dst.texture;
      currentW = dst.width;
      currentH = dst.height;
    }

    // --- PASS 6: Final Photographic AgX Composite to Screen ---
    const compProg = this.programs.composite;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.displayWidth, this.displayHeight);
    gl.useProgram(compProg.program);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.targets.scene.texture);
    gl.uniform1i(compProg.uniform('uSceneTex'), 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.targets.sparks.texture);
    gl.uniform1i(compProg.uniform('uSparksTex'), 1);

    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.targets.bloomUp[0].texture);
    gl.uniform1i(compProg.uniform('uBloomTex'), 2);

    // Mid-pyramid level serves as lush warm red-orange halation around the fire & dark sticks
    const halIdx = Math.min(2, this.targets.bloomUp.length - 1);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.targets.bloomUp[halIdx].texture);
    gl.uniform1i(compProg.uniform('uHalationTex'), 3);

    gl.uniform2f(compProg.uniform('uResolution'), this.displayWidth, this.displayHeight);
    gl.uniform2f(compProg.uniform('uSceneTexel'), 1 / rw, 1 / rh);
    const isUpscaling = rw < this.displayWidth * 0.96;
    gl.uniform1f(compProg.uniform('uSharpen'), isUpscaling ? (this.quality.sharpen ?? 0.45) : 0.0);
    gl.uniform1f(compProg.uniform('uTime'), time);

    this._drawFullscreen();
    this.frameIndex++;
  }

  destroy() {
    const gl = this.gl;
    this._destroyRenderTargets();
    this.sparks.destroy();
    this.fireSim.destroy();
    Object.values(this.programs).forEach((p) => p.destroy());
    Object.values(this.textures).forEach((t) => gl.deleteTexture(t));
    gl.deleteVertexArray(this.vao);
  }
}
