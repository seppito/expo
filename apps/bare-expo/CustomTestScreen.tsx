import React from 'react';
import { View, StyleSheet } from 'react-native';
import { GLView } from 'expo-gl';

const CustomTestScreen = () => {
  async function onContextCreate(gl) {
    console.log("GL Context ID:", gl.contextId);

    function checkGLError(step) {
      const error = gl.getError();
      if (error !== gl.NO_ERROR) {
        console.error(`OpenGL error after ${step}:`, error);
      }
    }
    const pointer : bigint = await GLView.createTestHardwareBuffer();

    console.log("Hardware Buffer Pointer Custom Screen Reached "+ pointer)

    const hbtextureId = await GLView.createTextureFromTexturePointer(gl.contextId,pointer);

    console.log("Texture ID is  "+ hbtextureId)
    // Create a texture and fill it with a color
    const texture = gl.createTexture();
    const hbTexture = { id: hbtextureId } as WebGLTexture
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

    const width = 256;
    const height = 256;
    const colorData = new Uint8Array(width * height * 4); // RGBA
    for (let i = 0; i < colorData.length; i += 4) {
      colorData[i] = 255;     // Red
      colorData[i + 1] = 255;   // Green
      colorData[i + 2] = 0;   // Blue
      colorData[i + 3] = 255; // Alpha
    }

    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      width,
      height,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      colorData
    );

    checkGLError("Texture Filled with Color");

    // Bind and render the hardware buffer texture
    gl.bindTexture(gl.TEXTURE_2D,texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

    checkGLError("Hardware Buffer Texture Setup");

    // Attach texture to framebuffer for rendering
    const framebuffer = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0,
      gl.TEXTURE_2D,
      texture,
      0
    );

    checkGLError("Framebuffer Attachment");

    // Render the texture
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D,hbTexture);

    const vertices = new Float32Array([
      -1.0, -1.0,
       1.0, -1.0,
      -1.0,  1.0,
       1.0,  1.0,
    ]);

    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

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
    gl.useProgram(program);

    const positionLocation = gl.getAttribLocation(program, "position");
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

    const textureLocation = gl.getUniformLocation(program, "uTexture");
    gl.uniform1i(textureLocation, 0);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

    checkGLError("Render Texture");

    gl.flush();
    gl.endFrameEXP();

    console.log("Texture rendering complete");
  }

  return (
    <View style={styles.container}>
      <GLView style={styles.glView} onContextCreate={onContextCreate} />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f0f0f0',
  },
  glView: {
    width: 300,
    height: 300,
    backgroundColor: '#000',
  },
});

export default CustomTestScreen;
