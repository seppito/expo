import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { GLView } from 'expo-gl';
import { CameraPage } from 'screens/CameraView';
import { Worklets } from 'react-native-worklets-core';
import { Frame } from 'react-native-vision-camera';

const CustomTestScreen = () => {
  const [gl, setGl] = useState<ExpoWebGLRenderingContext | null>(null);
  const [programYUV, setProgramYUV] = useState<WebGLProgram | null>(null);
  const [programBlit, setProgramBlit] = useState<WebGLProgram | null>(null);
  const [vertexBuffer, setVertexBuffer] = useState<WebGLBuffer | null>(null);

  // We'll store our offscreen FBO + its RGB texture here
  const [fbo, setFbo] = useState<WebGLFramebuffer | null>(null);
  const [rgbTexture, setRgbTexture] = useState<WebGLTexture | null>(null);

  // A simple quad with (x, y, z, u, v)
  const vertices = new Float32Array([
    -1.0, -1.0, 0.0,  0.0, 0.0, 
     1.0, -1.0, 0.0,  1.0, 0.0, 
    -1.0,  1.0, 0.0,  0.0, 1.0, 
     1.0,  1.0, 0.0,  1.0, 1.0,
  ]);


  const vertexShaderSourceYUV = `
    precision mediump float;
    attribute vec3 position;
    attribute vec2 texcoord;
    varying vec2 vTexCoord;

    void main() {
      gl_Position = vec4(position, 1.0);
      vTexCoord = texcoord;
    }
  `;

  const fragmentShaderSourceYUV = `
    precision mediump float;
    varying vec2 vTexCoord;
    uniform sampler2D yTexture;
    uniform sampler2D uTexture;
    uniform sampler2D vTexture;

    void main() {
      float y = (texture2D(yTexture, vTexCoord).r - 0.0625) * 1.164;
      float u = texture2D(uTexture, vTexCoord).r - 0.5;
      float v = texture2D(vTexture, vTexCoord).r - 0.5;

      // YUV -> RGB
      vec3 rgb = vec3(
        y + 1.596 * v,
        y - 0.391 * u - 0.813 * v,
        y + 2.018 * u
      );
      gl_FragColor = vec4(rgb, 1.0);
    }
  `;

  const vertexShaderSourceBlit = `
    precision mediump float;
    attribute vec3 position;
    attribute vec2 texcoord;
    varying vec2 vTexCoord;
    void main() {
      gl_Position = vec4(position, 1.0);
      vTexCoord = texcoord;
    }
  `;

  const fragmentShaderSourceBlit = `
    precision mediump float;
    varying vec2 vTexCoord;
    uniform sampler2D rgbTex;

    void main() {
      gl_FragColor = texture2D(rgbTex, vTexCoord);
    }
  `;

  function checkGLError(step: string, glCtx: ExpoWebGLRenderingContext) {
    const error = glCtx.getError();
    if (error !== glCtx.NO_ERROR) {
      console.error(`OpenGL error after ${step}:`, error);
    }
  }

  async function onContextCreate(glCtx: ExpoWebGLRenderingContext) {
    setGl(glCtx);

    const vertYUV = glCtx.createShader(glCtx.VERTEX_SHADER)!;
    glCtx.shaderSource(vertYUV, vertexShaderSourceYUV);
    glCtx.compileShader(vertYUV);

    const fragYUV = glCtx.createShader(glCtx.FRAGMENT_SHADER)!;
    glCtx.shaderSource(fragYUV, fragmentShaderSourceYUV);
    glCtx.compileShader(fragYUV);

    const progYUV = glCtx.createProgram()!;
    glCtx.attachShader(progYUV, vertYUV);
    glCtx.attachShader(progYUV, fragYUV);
    glCtx.linkProgram(progYUV);

    const vertBlit = glCtx.createShader(glCtx.VERTEX_SHADER)!;
    glCtx.shaderSource(vertBlit, vertexShaderSourceBlit);
    glCtx.compileShader(vertBlit);

    const fragBlit = glCtx.createShader(glCtx.FRAGMENT_SHADER)!;
    glCtx.shaderSource(fragBlit, fragmentShaderSourceBlit);
    glCtx.compileShader(fragBlit);

    const progBlit = glCtx.createProgram()!;
    glCtx.attachShader(progBlit, vertBlit);
    glCtx.attachShader(progBlit, fragBlit);
    glCtx.linkProgram(progBlit);

    setProgramYUV(progYUV);
    setProgramBlit(progBlit);

    // ------------------------------------------------
    // Create Vertex Buffer
    // ------------------------------------------------
    const vtxBuffer = glCtx.createBuffer()!;
    glCtx.bindBuffer(glCtx.ARRAY_BUFFER, vtxBuffer);
    glCtx.bufferData(glCtx.ARRAY_BUFFER, vertices, glCtx.STATIC_DRAW);
    setVertexBuffer(vtxBuffer);

    // ------------------------------------------------
    // Create FBO + an RGBA texture for the offscreen pass
    // ------------------------------------------------
    const fbo_ = glCtx.createFramebuffer()!;
    glCtx.bindFramebuffer(glCtx.FRAMEBUFFER, fbo_);

    const texRGB = glCtx.createTexture()!;
    glCtx.bindTexture(glCtx.TEXTURE_2D, texRGB);
    glCtx.texParameteri(glCtx.TEXTURE_2D, glCtx.TEXTURE_MIN_FILTER, glCtx.LINEAR);
    glCtx.texParameteri(glCtx.TEXTURE_2D, glCtx.TEXTURE_MAG_FILTER, glCtx.LINEAR);
    glCtx.texParameteri(glCtx.TEXTURE_2D, glCtx.TEXTURE_WRAP_S, glCtx.CLAMP_TO_EDGE);
    glCtx.texParameteri(glCtx.TEXTURE_2D, glCtx.TEXTURE_WRAP_T, glCtx.CLAMP_TO_EDGE);

    // Allocate the texture for the current drawing buffer size
    glCtx.texImage2D(
      glCtx.TEXTURE_2D,
      0,
      glCtx.RGBA,
      glCtx.drawingBufferWidth,
      glCtx.drawingBufferHeight,
      0,
      glCtx.RGBA,
      glCtx.UNSIGNED_BYTE,
      null
    );

    // Attach to FBO
    glCtx.framebufferTexture2D(
      glCtx.FRAMEBUFFER,
      glCtx.COLOR_ATTACHMENT0,
      glCtx.TEXTURE_2D,
      texRGB,
      0
    );

    const status = glCtx.checkFramebufferStatus(glCtx.FRAMEBUFFER);
    if (status !== glCtx.FRAMEBUFFER_COMPLETE) {
      console.error("FBO incomplete:", status);
    }

    // Unbind so we are back to default
    glCtx.bindFramebuffer(glCtx.FRAMEBUFFER, null);

    setFbo(fbo_);
    setRgbTexture(texRGB);

    // Just a final check for any GL errors
    checkGLError("onContextCreate complete", glCtx);
  }

  // This callback is invoked every time we get a new camera frame
  const renderCallback = Worklets.createRunOnJS(async (frame: Frame) => {
    if (!gl || !programYUV || !programBlit || !vertexBuffer || !fbo || !rgbTexture) {
      return;
    }

    // 1) Acquire the native pointer for the hardware buffer
    const nativeBuffer = frame.getNativeBuffer();
    const pointer = nativeBuffer.pointer;
    console.log("Hardware Buffer Pointer Reached", pointer);

    // 2) Create Y, U, V textures from pointer
    const yPlaneTexId = await GLView.createTextureFromTexturePointer(gl.contextId, pointer);

    // ---------------------------------------------
    // Pass #1: YUV -> offscreen RGBA texture
    // ---------------------------------------------
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);

    // Use the YUV->RGB program
    gl.useProgram(programYUV);

    // Bind vertex buffer + attributes
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);

    // position
    let posLoc = gl.getAttribLocation(programYUV, "position");
    gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 5 * 4, 0);
    gl.enableVertexAttribArray(posLoc);

    // texcoord
    let tcLoc = gl.getAttribLocation(programYUV, "texcoord");
    gl.vertexAttribPointer(tcLoc, 2, gl.FLOAT, false, 5 * 4, 3 * 4);
    gl.enableVertexAttribArray(tcLoc);

    // Bind the 3 planes (Y, U, V)
    for (let i = 0; i < 3; i++) {
      gl.activeTexture(gl.TEXTURE0 + i);
      const texture = { id: yPlaneTexId + i } as WebGLTexture;
      gl.bindTexture(gl.TEXTURE_2D, texture);

      const uniformName = i === 0 ? 'yTexture' : i === 1 ? 'uTexture' : 'vTexture';
      gl.uniform1i(gl.getUniformLocation(programYUV, uniformName), i);
    }

    // Render
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    checkGLError("YUV->RGB pass", gl);

    // ---------------------------------------------
    // Pass #2: Blit from offscreen 'rgbTexture' -> screen
    // ---------------------------------------------
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);

    // Use the blit program
    gl.useProgram(programBlit);

    // Rebind the same vertex buffer
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);

    // position
    posLoc = gl.getAttribLocation(programBlit, "position");
    gl.vertexAttribPointer(posLoc, 3, gl.FLOAT, false, 5 * 4, 0);
    gl.enableVertexAttribArray(posLoc);

    // texcoord
    tcLoc = gl.getAttribLocation(programBlit, "texcoord");
    gl.vertexAttribPointer(tcLoc, 2, gl.FLOAT, false, 5 * 4, 3 * 4);
    gl.enableVertexAttribArray(tcLoc);

    // Bind the offscreen RGB texture
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, rgbTexture);
    gl.uniform1i(gl.getUniformLocation(programBlit, "rgbTex"), 0);

    // Render to screen
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    checkGLError("Blit pass", gl);

    // ---------------------------------------------
    // Done!
    // ---------------------------------------------
    gl.flush();
    gl.endFrameEXP();
  });

  return (
    <View style={styles.container}>
      <GLView style={styles.glView} onContextCreate={onContextCreate} />
      <CameraPage style={styles.cameraView} renderCallback={renderCallback} />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0f0f0' },
  cameraView: { flex: 1 },
  glView:    { flex: 1 },
});

export default CustomTestScreen;
