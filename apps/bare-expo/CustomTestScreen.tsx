import React from 'react';
import { View, StyleSheet } from 'react-native';
import { GLView } from 'expo-gl';

const CustomTestScreen = () => {
    async function onContextCreate(gl: any) {
        console.log("GL Context ID:", gl.contextId);
        try {
         // Testing that 2 textures have been created.
         await GLView.createTestHardwareBuffer(gl.contextId);
         await GLView.createTestHardwareBuffer(gl.contextId);

      } catch (error) {
          console.error("Error in uploadBuffer:", error);
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