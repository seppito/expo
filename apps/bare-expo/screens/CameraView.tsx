import * as React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { useCameraDevice, useFrameProcessor, Camera, Frame } from 'react-native-vision-camera';

export function CameraPage({ renderCallback, isProcessing }: any): React.ReactElement {
  const device = useCameraDevice('front');

  const frameProcessor = useFrameProcessor(
    async (frame: Frame) => {
      'worklet';
      if (isProcessing) {
        await renderCallback(frame);
      }
    },
    [isProcessing]
  );

  if (!device) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={styles.text}>Loading Camera...</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Camera
        style={styles.camera}
        device={device}
        isActive
        frameProcessor={frameProcessor}
        resizeMode="contain"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  camera: { flex: 1 },
  text: {
    color: 'white',
    fontSize: 11,
    fontWeight: 'bold',
    textAlign: 'center',
  },
  emptyContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
});
