import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { GLView } from 'expo-gl';
import { CameraPage } from 'screens/CameraView';
import { Worklets } from 'react-native-worklets-core';
import { Frame } from 'react-native-vision-camera';

const CustomTestScreen = () => {
  const [gl, setGl] = useState(null);
  const [program, setProgram] = useState(null);
  const [vertexBuffer, setVertexBuffer] = useState(null);

  // Interleaved vertices with positions and texture coordinates
  const vertices = new Float32Array([
    -1.0, -1.0, 0.0, 0.0, 0.0, // Vertex 1: Position (x, y) and TexCoord (u, v)
     1.0, -1.0, 0.0, 1.0, 0.0, 
    -1.0,  1.0, 0.0, 0.0, 1.0, 
     1.0,  1.0, 0.0, 1.0, 1.0,
  ]);

  const vertexShaderSource = `
  precision mediump float;
  attribute vec3 position;
  attribute vec2 texcoord;
  varying vec2 vTexCoord;

  void main() {
      gl_Position = vec4(position, 1.0);
      vTexCoord = texcoord;
  }
  `;

  const fragmentShaderSource = `
  precision mediump float;
  varying vec2 vTexCoord;
  uniform sampler2D yTexture;
  uniform sampler2D uTexture;
  uniform sampler2D vTexture;

  void main() {

   float y = (texture2D(yTexture, vTexCoord).r - 0.0625) * 1.164;
   float u = texture2D(uTexture, vTexCoord).r - 0.5;
   float v = texture2D(vTexture, vTexCoord).r - 0.5;
   vec3 rgb = vec3(
       y + 1.596 * v,
       y - 0.391 * u - 0.813 * v,
       y + 2.018 * u
   );

      gl_FragColor = vec4(vec3(u,u,u), 1.0);
      gl_FragColor = vec4(rgb, 1.0);

  }
  `;

  function checkGLError(step, gl) {
    const error = gl.getError();
    if (error !== gl.NO_ERROR) {
      console.error(`OpenGL error after ${step}:`, error);
    }
  }

  async function onContextCreate(gl) {
    console.log("GL Contexts ID:", gl.contextId);
    setGl(gl);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);

    // Compile shaders and link program
    const vertexShader = gl.createShader(gl.VERTEX_SHADER);
    gl.shaderSource(vertexShader, vertexShaderSource);
    gl.compileShader(vertexShader);

    const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER);
    gl.shaderSource(fragmentShader, fragmentShaderSource);
    gl.compileShader(fragmentShader);

    const program = gl.createProgram();
    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);
    setProgram(program);

    // Create and upload vertex buffer
    const vertexBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
    setVertexBuffer(vertexBuffer);
  }

  const renderCallback = Worklets.createRunOnJS(async (frame: Frame) => {
    if (!gl || !program || !vertexBuffer) return;

    const nativeBuffer = frame.getNativeBuffer();
    const pointer = nativeBuffer.pointer;
    console.log("Hardware Buffer Pointer Custom Screen Reached", pointer);
    const yPlaneTexId = await GLView.createTextureFromTexturePointer(gl.contextId, pointer);

    // Bind vertex buffer
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);

    // Enable position attribute
    const positionLocation = gl.getAttribLocation(program, "position");
    gl.vertexAttribPointer(positionLocation, 3, gl.FLOAT, false, 5 * 4, 0);
    gl.enableVertexAttribArray(positionLocation);
    checkGLError("After position", gl);

    // Enable texture coordinate attribute
    const texcoordLocation = gl.getAttribLocation(program, "texcoord");
    gl.vertexAttribPointer(texcoordLocation, 2, gl.FLOAT, false, 5 * 4, 3 * 4);
    gl.enableVertexAttribArray(texcoordLocation);
    checkGLError("After texcoord", gl);

    // Bind textures
    for (let i = 0; i < 3; i++) {
      gl.activeTexture(gl.TEXTURE0 + i);
      const texture = { id: yPlaneTexId + i } as WebGLTexture;
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.uniform1i(gl.getUniformLocation(program, `${i === 0 ? 'y' : i === 1 ? 'u' : 'v'}Texture`), i);
    }
    checkGLError("After uniform", gl);

    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);

    gl.useProgram(program);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    checkGLError("After draw call", gl);

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
  container: {
    flex: 1,
    backgroundColor: '#f0f0f0',
  },
  cameraView: {
    flex: 1,
  },
  glView: {
    flex: 1,
  },
});

export default CustomTestScreen;