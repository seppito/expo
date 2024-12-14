
import * as React from 'react';
import { useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { 
  runAtTargetFps, 
  useCameraDevice, 
  useFrameProcessor 
} from 'react-native-vision-camera';

import { Camera } from 'react-native-vision-camera';

export function CameraPage({ renderCallback }: any): React.ReactElement {
  const camera = useRef<Camera>(null);
  const device = useCameraDevice('front');

  const frameProcessor = useFrameProcessor((frame) => {
    'worklet';

    runAtTargetFps(60, () => {
      'worklet';
      
      renderCallback(frame);

    });
  }, [renderCallback]);

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
        isActive={true}
        frameProcessor={frameProcessor}
        resizeMode={"contain"}
        />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    //...StyleSheet.absoluteFillObject,
    flex: 1,
  },
  camera:{flex:1},
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
