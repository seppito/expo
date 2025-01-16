import { ExpoWebGLRenderingContext, GLView } from 'expo-gl';

let glContext: ExpoWebGLRenderingContext | null = null;

const vertexShaderSourceBlit = `
precision mediump float;
attribute vec3 position;
attribute vec2 texcoord;
varying vec2 vTexCoord;

uniform vec2 scale;

void main() {
  gl_Position = vec4(position.xy * scale, position.z, 1.0);
  vTexCoord = texcoord;
}
`;

const fragmentShaderSourceBlit = `
precision mediump float;
varying vec2 vTexCoord;
uniform sampler2D rgbTex;
uniform vec4 borderColor; // Define the border color

void main() {
  if (vTexCoord.x < 0.0 || vTexCoord.x > 1.0 || vTexCoord.y < 0.0 || vTexCoord.y > 1.0) {
    // Use border color for out-of-bounds texture coordinates
    gl_FragColor = borderColor;
  } else {
    // Sample the texture for in-bounds coordinates
    gl_FragColor = texture2D(rgbTex, vTexCoord);
  }
}
`;
export const checkGLError = (gl: ExpoWebGLRenderingContext, message: string) => {
  const error = gl.getError();
  if (error !== gl.NO_ERROR) {
    console.error(`[GL ERROR] ${message}: ${error}`);
  }
};

export const getGLContext = async (): Promise<ExpoWebGLRenderingContext> => {
  if (!glContext) {
    console.log('Creating a new GL context...');
    glContext = await GLView.createContextAsync();
  } else {
    console.log('Reusing existing GL context...');
  }
  return glContext;
};

export const clearGLContext = () => {
  console.log('Clearing GL context...');
  glContext = null;
};

export const prepareForRgbToScreen = (glCtx: ExpoWebGLRenderingContext) => {
  const vertBlit = glCtx.createShader(glCtx.VERTEX_SHADER);
  glCtx.shaderSource(vertBlit, vertexShaderSourceBlit);
  glCtx.compileShader(vertBlit);
  checkGLError(glCtx, 'Compiling Vertex Shader');

  const fragBlit = glCtx.createShader(glCtx.FRAGMENT_SHADER)!;
  glCtx.shaderSource(fragBlit, fragmentShaderSourceBlit);
  glCtx.compileShader(fragBlit);
  checkGLError(glCtx, 'Compiling Fragment Shader');

  const progBlit = glCtx.createProgram()!;
  glCtx.attachShader(progBlit, vertBlit);
  glCtx.attachShader(progBlit, fragBlit);
  glCtx.linkProgram(progBlit);
  checkGLError(glCtx, 'Linking Program');

  return progBlit;
};

export const renderRGBToFramebuffer = (
  gl: ExpoWebGLRenderingContext,
  programBlit: WebGLProgram,
  vertexBuffer: WebGLBuffer,
  rgbTexture: WebGLTexture,
  textureWidth: number,
  textureHeight: number,
  framebuffer: WebGLFramebuffer
) => {
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  checkGLError(gl, 'Binding Framebuffer');

  // Attach the texture to the framebuffer
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, rgbTexture, 0);
  checkGLError(gl, 'Attaching Texture to Framebuffer');

  // Check framebuffer status
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    console.error('Framebuffer is incomplete!');
  }

  gl.viewport(0, 0, textureWidth, textureHeight);
  checkGLError(gl, 'Setting Viewport');

  gl.useProgram(programBlit);
  checkGLError(gl, 'Using Program');

  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  checkGLError(gl, 'Binding Vertex Buffer');

  const posLoc = gl.getAttribLocation(programBlit, 'position');
  if (posLoc >= 0) {
    gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 5 * 4, 0);
    gl.enableVertexAttribArray(posLoc);
  } else {
    console.error('Invalid position attribute location:', posLoc);
  }
  checkGLError(gl, 'Setting Vertex Attribute');

  const tcLoc = gl.getAttribLocation(programBlit, 'texcoord');
  if (tcLoc >= 0) {
    gl.vertexAttribPointer(tcLoc, 2, gl.FLOAT, false, 5 * 4, 3 * 4);
    gl.enableVertexAttribArray(tcLoc);
  } else {
    console.error('Invalid texture coordinate attribute location:', tcLoc);
  }
  checkGLError(gl, 'Setting Texture Coordinates Attribute');

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, rgbTexture);
  checkGLError(gl, 'Binding Texture');

  const scaleLoc = gl.getUniformLocation(programBlit, 'scale');
  if (scaleLoc !== null) {
    gl.uniform2f(scaleLoc, 1.0, 1.0); // Example value
  } else {
    console.error('Scale uniform location is null.');
  }
  checkGLError(gl, 'Setting Uniform - scale');

  const fbStatus = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (fbStatus !== gl.FRAMEBUFFER_COMPLETE) {
    console.error('Framebuffer is incomplete:', fbStatus);
    return;
  }

  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  checkGLError(gl, 'Drawing Arrays');
};

export const renderYUVToRGB = (
  gl: ExpoWebGLRenderingContext,
  programYUV: WebGLProgram,
  vertexBuffer: WebGLBuffer,
  fbo: WebGLFramebuffer,
  yPlaneTexId: number,
  textureWidth: number,
  textureHeight: number
) => {
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.viewport(0, 0, textureWidth, textureHeight);
  checkGLError(gl, 'PostBind');

  const texRGB = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texRGB);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    textureWidth,
    textureHeight,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    null
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  // Attach texture to framebuffer
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    texRGB, // Texture created earlier
    0
  );
  // Check for completeness
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    console.error(`Framebuffer incomplete: ${status}`);
  }
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    textureWidth,
    textureHeight,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    null
  );
  checkGLError(gl, 'TexImage2D');

  gl.useProgram(programYUV);
  checkGLError(gl, 'UseProgram');

  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);

  checkGLError(gl, 'Bind of Vertex Buffer');

  const posLoc = gl.getAttribLocation(programYUV, 'position');
  gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 5 * 4, 0);
  gl.enableVertexAttribArray(posLoc);

  const tcLoc = gl.getAttribLocation(programYUV, 'texcoord');
  gl.vertexAttribPointer(tcLoc, 2, gl.FLOAT, false, 5 * 4, 3 * 4);
  gl.enableVertexAttribArray(tcLoc);

  for (let i = 0; i < 3; i++) {
    gl.activeTexture(gl.TEXTURE0 + i);
    const texture = { id: yPlaneTexId + i } as WebGLTexture;
    gl.bindTexture(gl.TEXTURE_2D, texture);

    const uniformName = i === 0 ? 'yTexture' : i === 1 ? 'uTexture' : 'vTexture';
    gl.uniform1i(gl.getUniformLocation(programYUV, uniformName), i);
  }
  checkGLError(gl, 'Post YUV Binding');

  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  checkGLError(gl, 'Post Draw in YUV ');

  return texRGB;
};

export const createVertexBuffer = (gl: ExpoWebGLRenderingContext) => {
  const vertices = new Float32Array([
    -1.0, -1.0, 0.0, 0.0, 0.0, 1.0, -1.0, 0.0, 1.0, 0.0, -1.0, 1.0, 0.0, 0.0, 1.0, 1.0, 1.0, 0.0,
    1.0, 1.0,
  ]);

  const vtxBuffer = gl.createBuffer()!;
  gl.bindBuffer(gl.ARRAY_BUFFER, vtxBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
  return vtxBuffer;
};
