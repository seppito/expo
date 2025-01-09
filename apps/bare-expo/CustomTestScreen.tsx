import { GLView } from 'expo-gl';
import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Frame, PixelFormat } from 'react-native-vision-camera';
import { Worklets } from 'react-native-worklets-core';
import { CameraPage } from 'screens/CameraView';

const CustomTestScreen = () => {
  const [gl, setGl] = useState<ExpoWebGLRenderingContext | null>(null);
  const [programYUV, setProgramYUV] = useState<WebGLProgram | null>(null);
  const [programBlit, setProgramBlit] = useState<WebGLProgram | null>(null);
  const [vertexBuffer, setVertexBuffer] = useState<WebGLBuffer | null>(null);
  const [fbo, setFbo] = useState<WebGLFramebuffer | null>(null);
  const [rgbTexture, setRgbTexture] = useState<WebGLTexture | null>(null);
  const [pixelFormat, setPixelFormat] = useState<string | null>(null);

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

  function checkGLError(step: string, glCtx: ExpoWebGLRenderingContext) {
    const error = glCtx.getError();
    if (error !== glCtx.NO_ERROR) {
      console.error(`OpenGL error after ${step}:`, error);
    }
  }

  function renderYUVToRGB(
    gl: ExpoWebGLRenderingContext,
    programYUV: WebGLProgram,
    vertexBuffer: WebGLBuffer,
    fbo: WebGLFramebuffer,
    yPlaneTexId: number
  ) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);

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
  }

  function renderRGBToScreen(
    gl: ExpoWebGLRenderingContext,
    programBlit: WebGLProgram,
    vertexBuffer: WebGLBuffer,
    rgbTexture: WebGLTexture,
    textureWidth: number,
    textureHeight: number
  ) {
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

    // Calculate scale to preserve aspect ratio
    const viewportAspect = gl.drawingBufferWidth / gl.drawingBufferHeight;
    const textureAspect = textureWidth / textureHeight;

    const scaleLoc = gl.getUniformLocation(programBlit, 'scale');
    if (viewportAspect > textureAspect) {
      gl.uniform2f(scaleLoc, textureAspect / viewportAspect, 1.0); // Scale width
    } else {
      gl.uniform2f(scaleLoc, 1.0, viewportAspect / textureAspect); // Scale height
    }

    // Set border color (RGBA)
    const borderColorLoc = gl.getUniformLocation(programBlit, 'borderColor');
    gl.uniform4f(borderColorLoc, 0.0, 0.0, 0.0, 1.0);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  async function onContextCreate(glCtx: ExpoWebGLRenderingContext) {
    setGl(glCtx);
    console.log('Prepare Context.');
    try {
      const { progYUV, vtxBuffer } = await GLView.prepareContextForNativeCamera(glCtx.contextId);
      setProgramYUV(progYUV);
      setVertexBuffer(vtxBuffer);
    } catch (error) {
      console.error('Error preparing context for native camera:', error);
      throw error;
    }

    const vertBlit = glCtx.createShader(glCtx.VERTEX_SHADER);
    glCtx.shaderSource(vertBlit, vertexShaderSourceBlit);
    glCtx.compileShader(vertBlit);

    const fragBlit = glCtx.createShader(glCtx.FRAGMENT_SHADER);
    glCtx.shaderSource(fragBlit, fragmentShaderSourceBlit);
    glCtx.compileShader(fragBlit);

    const progBlit = glCtx.createProgram();
    glCtx.attachShader(progBlit, vertBlit);
    glCtx.attachShader(progBlit, fragBlit);
    glCtx.linkProgram(progBlit);

    setProgramBlit(progBlit);

    const fbo_ = glCtx.createFramebuffer();
    glCtx.bindFramebuffer(glCtx.FRAMEBUFFER, fbo_);

    const texRGB = glCtx.createTexture();
    glCtx.bindTexture(glCtx.TEXTURE_2D, texRGB);
    glCtx.texParameteri(glCtx.TEXTURE_2D, glCtx.TEXTURE_MIN_FILTER, glCtx.LINEAR);
    glCtx.texParameteri(glCtx.TEXTURE_2D, glCtx.TEXTURE_MAG_FILTER, glCtx.LINEAR);

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

    glCtx.framebufferTexture2D(
      glCtx.FRAMEBUFFER,
      glCtx.COLOR_ATTACHMENT0,
      glCtx.TEXTURE_2D,
      texRGB,
      0
    );

    const status = glCtx.checkFramebufferStatus(glCtx.FRAMEBUFFER);
    if (status !== glCtx.FRAMEBUFFER_COMPLETE) {
      console.error('FBO incomplete:', status);
    }

    glCtx.bindFramebuffer(glCtx.FRAMEBUFFER, null);

    setFbo(fbo_);
    setRgbTexture(texRGB);

    checkGLError('onContextCreate complete', glCtx);
  }

  const renderCallback = Worklets.createRunOnJS(async (frame: Frame) => {
    if (!gl || !programYUV || !programBlit || !vertexBuffer || !fbo || !rgbTexture) {
      return;
    }
    if (pixelFormat == null) {
      const fFormat = frame.pixelFormat;
      console.log(frame.pixelFormat);
      try {
        setPixelFormat(fFormat);
      } catch (error) {
        console.error('Error pixel format:', error);
        throw error;
      }
    }
    const nativeBuffer = frame.getNativeBuffer();
    const pointer = nativeBuffer.pointer;

    // Hardware Buffer width/height are inverted
    const textureWidth = frame.height;
    const textureHeight =  frame.width;
    const textureId = await GLView.createTextureFromTexturePointer(gl.contextId, pointer);

    if (pixelFormat === 'yuv') {
      renderYUVToRGB(gl, programYUV, vertexBuffer, fbo, textureId);
      renderRGBToScreen(gl, programBlit, vertexBuffer, rgbTexture, textureWidth, textureHeight);
      checkGLError('YUV->RGB pass', gl);
    } else {
      renderRGBToScreen(gl, programBlit, vertexBuffer, { id: textureId }, textureWidth, textureHeight);
    }

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
  glView: { flex: 1 },
});

export default CustomTestScreen;
