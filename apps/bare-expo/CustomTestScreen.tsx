import React from 'react';
import { View, StyleSheet } from 'react-native';
import { GLView } from 'expo-gl';

const CustomTestScreen = () => {
  async function onContextCreate(gl: any) {
    console.log("GL Context ID:", gl.contextId);
    function checkGLError(step) {
      const error = gl.getError();
      if (error !== gl.NO_ERROR) {
        console.error(`OpenGL error after ${step}:`, error);
      }
    }
    let textureId;
    try {
      textureId = await GLView.createTestHardwareBuffer(gl.contextId);
      if (!textureId) {
        console.error("Failed to create texture: textureId is null or undefined");
        return;
      }
      console.log("Texture created successfully, ID:", textureId);
    } catch (error) {
      console.error("Error creating texture:", error);
      return;
    }
  
      gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
      gl.clearColor(0, 0, 1.0, 1.0); // Clear to white
      gl.clear(gl.COLOR_BUFFER_BIT);
      checkGLError("initial clear");
  
      // Bind and configure texture
      gl.bindTexture(gl.TEXTURE_2D, textureId);
      checkGLError("binding texture");
  
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      checkGLError("setting TEXTURE_MIN_FILTER");
  
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      checkGLError("setting TEXTURE_MAG_FILTER");
  
      // Clear with texture bound
      gl.clear(gl.COLOR_BUFFER_BIT);
      checkGLError("clearing after texture bind");
  
      gl.flush();
      gl.endFrameEXP();
    
  }
  
  
  

    return (
      <View style={styles.container}>
        <GLView
          style={styles.glView}
          onContextCreate={onContextCreate}
        />
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
    text: {
      fontSize: 18,
      color: '#333',
      marginBottom: 10,
    },
    glView: {
      width: 300,
      height: 300, // Explicit dimensions
      backgroundColor: '#000', // Ensure it’s visible
    },
  });
  
  export default CustomTestScreen;