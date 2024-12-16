import React, { useState, useEffect,useCallback  } from 'react';
import { View, StyleSheet } from 'react-native';
import { GLView } from 'expo-gl';
import { CameraPage } from 'screens/CameraView';
import { Worklets } from 'react-native-worklets-core';
import { Frame } from 'react-native-vision-camera';



const CustomTestScreen = () => {
  const [gl, setGl] = useState(null); // Store the GL context
  const [program, setProgram] = useState(null); // Store the GL context

  const vertices = new Float32Array([
    -1.0, -1.0,
    1.0, -1.0,
    -1.0,  1.0,
    1.0,  1.0,
  ]);

  const vertexShaderSource = `
  attribute vec2 position;
  varying vec2 vTexCoord;
  void main() {
    vTexCoord = (position + 1.0) * 0.5;
    gl_Position = vec4(position, 0.0, 1.0);
  }
`;

const fragmentShaderSource = `
  precision mediump float;
  varying vec2 vTexCoord;
  uniform sampler2D uTexture;
  void main() {
    gl_FragColor = texture2D(uTexture, vTexCoord);
  }
`;

  function checkGLError(step,gl) {
    const error = gl.getError();
    if (error !== gl.NO_ERROR) {
      console.error(`OpenGL error after ${step}:`, error);
    }
  }

  async function onContextCreate(gl) {
    console.log("GL Contexts ID:", gl.contextId);
    setGl(gl); // Store the GL context

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
  /*
    const pointer = await GLView.createTestHardwareBuffer(0);
    if (!pointer) {
      console.error("Failed to create hardware buffer");
      return;
    }
    
    const hbtextureId = await GLView.createTextureFromTexturePointer(gl.contextId, pointer);
    if (!hbtextureId) {
      console.error("Failed to create hardware buffer texture");
      return;
    }
    console.log("Texture Id is  = " + hbtextureId)

    const hbTexture = { id: hbtextureId } as WebGLTexture
    gl.flush();
    gl.endFrameEXP();
    */
  }
  
  /**
   * This function is called on every frame received from the camera
   * and updates the texture with the current frame.
   */

  function checkShaderCompilation(gl, shader, shaderType) {
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const infoLog = gl.getShaderInfoLog(shader);
      console.error(`Error compiling ${shaderType} shader: `, infoLog);
    }
  }
  
  const renderCallback =  Worklets.createRunOnJS(async (frame : Frame) => {
    if (!gl) return;
    const nativeBuffer = frame.getNativeBuffer();
    const pointer = nativeBuffer.pointer;
  
    console.log("Hardware Buffer Pointer Custom Screen Reached", pointer);
  
    const hbtextureId = await GLView.createTextureFromTexturePointer(gl.contextId, pointer);
    if (!hbtextureId) {
      console.error("Failed to create texture from pointer");
      return;
    }
  
    console.log("Texture ID is", hbtextureId);

    const hbTexture = { id: hbtextureId } as WebGLTexture
    // Validated up until here.
    checkGLError("Create Texture from pointer status check.",gl)
    
     // Attach texture to framebuffer for rendering
     const framebuffer = gl.createFramebuffer();
     gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);

    // Render the texture
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D,hbTexture);


    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);


    gl.useProgram(program);

    const positionLocation = gl.getAttribLocation(program, "position");
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

    const textureLocation = gl.getUniformLocation(program, "uTexture");
    gl.uniform1i(textureLocation, 0);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    // Validated up until here.
    checkGLError("Final State check",gl)
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
    flex:1
  },
  glView: {
    flex:1
  },
});

export default CustomTestScreen;
