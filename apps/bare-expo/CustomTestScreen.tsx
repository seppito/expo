import React from 'react';
import { View, StyleSheet } from 'react-native';
import { GLView } from 'expo-gl';

const CustomTestScreen = () => {
  async function onContextCreate(gl: any) {
    console.log("GL Context ID:", gl.contextId);
    //gl.activeTexture(gl.TEXTURE0);

    function checkGLError(step) {
      const error = gl.getError();
      if (error !== gl.NO_ERROR) {
        console.error(`OpenGL error after ${step}:`, error);
      }
    }
    //gl.createTexture();
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
    checkGLError("Texture Creation");
    gl.bindTexture(gl.TEXTURE_2D, textureId)
    checkGLError("Bind Texture");
      // attach texture to framebuffer
    //gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, textureId, 0);
    //checkGLError("Bind Frame Buffer");

    // set texture parameters
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    
    // attach texture to framebuffer
    //gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, textureId, 0);
    //gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, textureId, 0);
    checkGLError("After Clamp.");

    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0, // Attachment point
      gl.TEXTURE_2D,
      textureId,
      0 // Level of detail
    );

    gl.flush();
    gl.endFrameEXP();


    // Check framebuffer completeness
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      console.error("Framebuffer is not complete:", status);
    } else {
      console.log("Framebuffer is complete");
    }

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