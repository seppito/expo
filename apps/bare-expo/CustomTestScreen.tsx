import React from 'react';
import { View, StyleSheet } from 'react-native';
import { GLView } from 'expo-gl';

const CustomTestScreen = () => {
    async function onContextCreate(gl: any) {
        try {
            console.log("GL Context ID:", gl.contextId);
            gl.clearColor(0.0, 1.0, 0.0, 1.0);
            gl.clear(gl.COLOR_BUFFER_BIT);
            gl.flush();
            gl.endFrameEXP();
        } catch (error) {
            console.error("Error in onContextCreate:", error);
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