/**
 * WebGL2 context, shader compilation, framebuffer, and texture utilities.
 */

export function createWebGL2Context(canvas) {
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: false,
  });

  if (!gl) {
    throw new Error('お使いのブラウザまたはGPUで WebGL2 を初期化できませんでした。');
  }

  const extColorBufferFloat = gl.getExtension('EXT_color_buffer_float');
  const extColorBufferHalfFloat = gl.getExtension('EXT_color_buffer_half_float');
  const extTextureFloatLinear = gl.getExtension('OES_texture_float_linear');
  const extTextureHalfFloatLinear = gl.getExtension('OES_texture_half_float_linear');

  const supportsHalfFloatFBO = Boolean(extColorBufferFloat || extColorBufferHalfFloat);
  const supportsFloatLinear = Boolean(extTextureFloatLinear || extTextureHalfFloatLinear);

  return {
    gl,
    caps: {
      supportsHalfFloatFBO,
      supportsFloatLinear,
      maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
    },
  };
}

function formatShaderError(source, log) {
  const lines = source.split('\n');
  const numbered = lines
    .map((line, index) => `${String(index + 1).padStart(4, ' ')} | ${line}`)
    .join('\n');
  return `${log}\n\n${numbered}`;
}

export function compileShader(gl, type, source, label = 'shader') {
  const shader = gl.createShader(type);
  if (!shader) {
    throw new Error(`Failed to allocate WebGL shader (${label})`);
  }

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader) || 'Unknown shader compile error';
    gl.deleteShader(shader);
    console.error(`[Takibi GLSL Error: ${label}]\n${formatShaderError(source, info)}`);
    throw new Error(`GLSL compilation failed (${label}): ${info}`);
  }

  return shader;
}

export function createProgram(gl, vertexSource, fragmentSource, label = 'program') {
  const vert = compileShader(gl, gl.VERTEX_SHADER, vertexSource, `${label}:vert`);
  const frag = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSource, `${label}:frag`);

  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(vert);
    gl.deleteShader(frag);
    throw new Error(`Failed to allocate WebGL program (${label})`);
  }

  gl.attachShader(program, vert);
  gl.attachShader(program, frag);
  gl.linkProgram(program);

  gl.deleteShader(vert);
  gl.deleteShader(frag);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program) || 'Unknown program link error';
    gl.deleteProgram(program);
    console.error(`[Takibi Program Link Error: ${label}]\n${info}`);
    throw new Error(`GLSL link failed (${label}): ${info}`);
  }

  const uniformCache = new Map();
  return {
    program,
    label,
    uniform(name) {
      if (!uniformCache.has(name)) {
        uniformCache.set(name, gl.getUniformLocation(program, name));
      }
      return uniformCache.get(name);
    },
    destroy() {
      gl.deleteProgram(program);
    },
  };
}

export function createRenderTarget(gl, width, height, { hdr = true, filter = gl.LINEAR } = {}) {
  const w = Math.max(1, Math.floor(width));
  const h = Math.max(1, Math.floor(height));

  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);

  const internalFormat = hdr ? gl.RGBA16F : gl.RGBA8;
  const type = hdr ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;

  gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, gl.RGBA, type, null);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  const framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);

  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindTexture(gl.TEXTURE_2D, null);

  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    gl.deleteFramebuffer(framebuffer);
    gl.deleteTexture(texture);
    throw new Error(`Incomplete framebuffer (${w}x${h}, hdr=${hdr}): 0x${status.toString(16)}`);
  }

  return {
    width: w,
    height: h,
    hdr,
    texture,
    framebuffer,
    destroy() {
      gl.deleteFramebuffer(framebuffer);
      gl.deleteTexture(texture);
    },
  };
}

export function createMRTRenderTarget(gl, width, height, count = 2, { hdr = true, filter = gl.NEAREST } = {}) {
  const w = Math.max(1, Math.floor(width));
  const h = Math.max(1, Math.floor(height));

  const internalFormat = hdr ? gl.RGBA16F : gl.RGBA8;
  const type = hdr ? gl.HALF_FLOAT : gl.UNSIGNED_BYTE;

  const framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);

  const textures = [];
  const attachments = [];

  for (let i = 0; i < count; i++) {
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, gl.RGBA, type, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    const attach = gl.COLOR_ATTACHMENT0 + i;
    gl.framebufferTexture2D(gl.FRAMEBUFFER, attach, gl.TEXTURE_2D, tex, 0);
    textures.push(tex);
    attachments.push(attach);
  }

  gl.drawBuffers(attachments);
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindTexture(gl.TEXTURE_2D, null);

  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    gl.deleteFramebuffer(framebuffer);
    textures.forEach((t) => gl.deleteTexture(t));
    throw new Error(`Incomplete MRT framebuffer (${w}x${h}, count=${count}, hdr=${hdr}): 0x${status.toString(16)}`);
  }

  return {
    width: w,
    height: h,
    hdr,
    textures,
    framebuffer,
    destroy() {
      gl.deleteFramebuffer(framebuffer);
      textures.forEach((t) => gl.deleteTexture(t));
    },
  };
}

export function createEmptyVAO(gl) {
  const vao = gl.createVertexArray();
  return vao;
}
