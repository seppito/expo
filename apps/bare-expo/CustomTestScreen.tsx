import { useGLBufferFrameManager } from 'components/GLBufferFrameManager';
import { ExpoWebGLRenderingContext, GLView } from 'expo-gl';
import React, { useEffect, useState, useCallback, useRef } from 'react';
import { View, StyleSheet, TouchableOpacity, Text } from 'react-native';
import { Frame, FrameInternal, runAsync } from 'react-native-vision-camera';
import {
  Face,
  useFaceDetector,
  FaceDetectionOptions,
} from 'react-native-vision-camera-face-detector';
import { Worklets } from 'react-native-worklets-core';
import { CameraPage } from 'screens/CameraView';

const CustomTestScreen = () => {
  const { initializeContext, addFrame, deleteFrame, renderYUVToRGB } = useGLBufferFrameManager();
  const [gl, setGL] = useState(null);
  // State for managing camera visibility and frame processing
  const [isCameraActive, setIsCameraActive] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progYUV, setProgYuv] = useState(null);
  const [vtxBuffer, setvtxBuffer] = useState(null);

  // Initialize GL context when the component mounts
  useEffect(() => {
    const setupGL = async () => {
      const glCtx = await initializeContext();
      if (glCtx) {
        setGL(glCtx);
        await onContextCreate(glCtx);
      }
    };

    setupGL();
  }, [initializeContext]);

  // Function to prepare the GL context
  const onContextCreate = async (gl: ExpoWebGLRenderingContext) => {
    console.log('Preparing GL Context.');
    try {
      const { progYUV, vtxBuffer } = await GLView.prepareContextForNativeCamera(gl.contextId);
      setProgYuv(progYUV);
      setvtxBuffer(vtxBuffer);

      // Further GL setup (e.g., shaders, buffers) goes here...
    } catch (error) {
      console.error('Error preparing context for native camera:', error);
      throw error;
    }
  };

  const faceDetectionOptions = useRef<FaceDetectionOptions>({
    // detection optionsa
  }).current;

  const { detectFaces } = useFaceDetector(faceDetectionOptions);

  const handleDetectedFaces = Worklets.createRunOnJS( (
    faces: Face[]
  ) => { 
    console.log( 'faces detected', faces )
  })

  // Handle screen tap to start frame processing
  const handleScreenTap = useCallback(() => {
    if (!isProcessing && gl != null) {
      console.log('Starting frame processing...');
      setIsProcessing(true);

      // Stop frame processing and remove the camera afrter 3 seconds
      setTimeout(() => {
        console.log('Stopping frame processing...');
        setIsProcessing(false);
        setTimeout(() => {
          console.log('removing camera...');
          setIsCameraActive(false); // Render an empty view
        }, 2000);
      }, 4000);
    }
  }, [isProcessing, gl]);

  const renderCallback = Worklets.createRunOnJS(async (frame: Frame) => {
    if (isProcessing) {
      const internal = frame as FrameInternal;
      internal.incrementRefCount();
      const nativeBuffer = frame.getNativeBuffer();
      const pointer = nativeBuffer.pointer;

      // Hardware Buffer width/height are inverted
      const textureWidth = frame.height;
      const textureHeight = frame.width;

      try {
        const textureId = await GLView.createTextureFromTexturePointer(gl.contextId, pointer);
        const fbo = gl.createFramebuffer();
        const rgbTexture = renderYUVToRGB(
          gl,
          progYUV,
          vtxBuffer,
          fbo,
          textureId,
          textureWidth,
          textureHeight
        );
        console.log('Rgb texture was created : ', rgbTexture);
      } catch (error) {
        console.error('Error in HB upload:', error);
        throw error;
      } finally {
        internal.decrementRefCount();
      }
      console.log('completed.');
    }
  });

  return (
    <TouchableOpacity style={styles.container} onPress={handleScreenTap}>
      {isCameraActive ? (
        <CameraPage style={styles.cameraView} renderCallback={renderCallback} />
      ) : (
        <View style={styles.emptyView}>
          <Text style={styles.emptyText}>Camera is off</Text>
        </View>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f0f0f0' },
  cameraView: { flex: 1 },
  emptyView: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#000' },
  emptyText: { color: '#fff', fontSize: 16 },
});

export default CustomTestScreen;
