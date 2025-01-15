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

  const fragBlit = glCtx.createShader(glCtx.FRAGMENT_SHADER)!;
  glCtx.shaderSource(fragBlit, fragmentShaderSourceBlit);
  glCtx.compileShader(fragBlit);

  const progBlit = glCtx.createProgram()!;
  glCtx.attachShader(progBlit, vertBlit);
  glCtx.attachShader(progBlit, fragBlit);
  glCtx.linkProgram(progBlit);
  return progBlit;
};

export const renderRGBToScreen = (
  gl: ExpoWebGLRenderingContext,
  programBlit: WebGLProgram,
  vertexBuffer: WebGLBuffer,
  rgbTexture: WebGLTexture,
  textureWidth: number,
  textureHeight: number
) => {
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);

  gl.useProgram(programBlit);
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);

  const posLoc = gl.getAttribLocation(programBlit, 'position');
  gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 5 * 4, 0);
  gl.enableVertexAttribArray(posLoc);

  const tcLoc = gl.getAttribLocation(programBlit, 'texcoord');
  gl.vertexAttribPointer(tcLoc, 2, gl.FLOAT, false, 5 * 4, 3 * 4);
  gl.enableVertexAttribArray(tcLoc);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, rgbTexture);
  gl.uniform1i(gl.getUniformLocation(programBlit, 'rgbTex'), 0);

  const viewportAspect = gl.drawingBufferWidth / gl.drawingBufferHeight;
  const textureAspect = textureWidth / textureHeight;

  const scaleLoc = gl.getUniformLocation(programBlit, 'scale');
  if (viewportAspect > textureAspect) {
    gl.uniform2f(scaleLoc, textureAspect / viewportAspect, 1.0);
  } else {
    gl.uniform2f(scaleLoc, 1.0, viewportAspect / textureAspect);
  }

  const borderColorLoc = gl.getUniformLocation(programBlit, 'borderColor');
  gl.uniform4f(borderColorLoc, 0.0, 0.0, 0.0, 1.0);

  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
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
  const texRGB = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texRGB);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    gl.drawingBufferWidth,
    gl.drawingBufferHeight,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    null
  );

  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.viewport(0, 0, textureWidth, textureHeight);

  gl.useProgram(programYUV);
  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);

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

  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  return texRGB;
};
