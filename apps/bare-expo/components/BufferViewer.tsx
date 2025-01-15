import * as GL from 'expo-gl';
import React, { useEffect, useState } from 'react';
import { View, Text, Image, StyleSheet, TouchableOpacity } from 'react-native';

import { useGLBufferFrameManager } from './GLBufferFrameManager';
import { prepareForRgbToScreen } from './GLContextManager';

interface BufferViewerProps {
  frames: any[];
  glContext: GL.ExpoWebGLRenderingContext | null;
  id: number;
  onChangeFrame: (newId: number) => void;
}

const BufferViewer: React.FC<BufferViewerProps> = ({ frames, glContext, id, onChangeFrame }) => {
  const [snapshot, setSnapshot] = useState<GL.GLSnapshot | null>(null);
  const [rgbToScreenProgram, setRgbToScreenProgram] = useState<WebGLProgram | null>(null);

  // Update snapshot whenever the frame changes
  useEffect(() => {
    if (glContext) {
      const program = prepareForRgbToScreen(glContext);
      setRgbToScreenProgram(program);
      console.log('program :', program);
    }
  }, [glContext]);

  // Update snapshot whenever the frame changes
  useEffect(() => {
    if (glContext && frames[id]) {
      const frame = frames[id];

      //renderRGBToScreen(glContext,)
      /*
      // we need to use flip option because framebuffer contents are flipped vertically
      const snapshot = await GLView.takeSnapshotAsync(gl, {
        flip: true,
      });

      // delete previous snapshot
      if (snapshot) { 
        FileSystem.deleteAsync(this.state.snapshot.uri as string, { idempotent: true });
      }

      this.setState({ snapshot });
      this.isDrawing = false;

*/
    }
  }, [glContext, frames, id]);

  return (
    <View style={styles.container}>
      <Text style={styles.frameCountText}>
        Stored Frames: {frames.length} | Current Frame ID: {id}
      </Text>
      <View style={styles.flex}>
        {snapshot && (
          <Image
            style={styles.flex}
            fadeDuration={0}
            source={{ uri: snapshot.uri as string }}
            resizeMode="contain"
          />
        )}
      </View>
      <View style={styles.navigationContainer}>
        <TouchableOpacity
          style={[styles.navButton, styles.leftButton]}
          onPress={() => onChangeFrame(Math.max(0, id - 1))}>
          <Text style={styles.navText}>←</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.navButton, styles.rightButton]}
          onPress={() => onChangeFrame(Math.min(frames.length - 1, id + 1))}>
          <Text style={styles.navText}>→</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

export default BufferViewer;

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 10,
  },
  flex: {
    flex: 1,
    width: '100%',
  },
  frameCountText: {
    fontSize: 16,
    marginBottom: 10,
    fontWeight: 'bold',
  },
  navigationContainer: {
    position: 'absolute',
    width: '100%',
    height: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  navButton: {
    width: '50%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
  },
  leftButton: {
    backgroundColor: 'rgba(0, 0, 0, 0.2)',
    justifyContent: 'center',
    alignItems: 'flex-start',
  },
  rightButton: {
    backgroundColor: 'rgba(0, 0, 0, 0.2)',
  },
  navText: {
    fontSize: 48,
    color: 'white',
    opacity: 0.8,
  },
});
