import BufferViewer from 'components/BufferViewer';
import { useGLBufferFrameManager } from 'components/GLBufferFrameManager';
import { renderYUVToRGB, checkGLError } from 'components/GLContextManager';
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
  const { initializeContext, addFrame, frames } = useGLBufferFrameManager();
  const [gl, setGL] = useState(null);
  const [currentFrameId, setCurrentFrameId] = useState(0);
  // State for managing camera visibility and frame processing
  const [isCameraActive, setIsCameraActive] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [progYUV, setProgYuv] = useState(null);
  const [vtxBuffer, setvtxBuffer] = useState(null);
  const [frameBuffer, setFrameBuffer] = useState(null);

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
      const fbo = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);

      checkGLError(gl, 'Creating Framebuffer');
      setFrameBuffer(fbo);
      const { progYUV, vtxBuffer } = await GLView.prepareContextForNativeCamera(gl.contextId);
      checkGLError(gl, 'Preparing Native Camera Context');
      setProgYuv(progYUV);
      setvtxBuffer(vtxBuffer);
    } catch (error) {
      console.error('Error during GL context preparation:', error);
    }
  };

  // Handle screen tap to start frame processing
  const handleScreenTap = useCallback(() => {
    if (!isProcessing && gl != null) {
      setIsProcessing(true);
      // Stop frame processing and remove the camera afrter 3 seconds
      setTimeout(() => {
        setIsProcessing(false);
        setTimeout(() => {
          console.log('removing camera...');
          setIsCameraActive(false); // Render an empty view
        }, 2000);
      }, 5000);
    }
  }, [isProcessing, gl]);

  const yuvToRGBCallback = Worklets.createRunOnJS(async (frame: Frame) => {
    const internal = frame as FrameInternal;
    internal.incrementRefCount();

    const nativeBuffer = frame.getNativeBuffer();
    const pointer = nativeBuffer.pointer;

    // Hardware Buffer width/height are inverted
    const textureWidth = frame.height;
    const textureHeight = frame.width;

    try {
      const textureId = await GLView.createTextureFromTexturePointer(gl.contextId, pointer);
      //nativeBuffer.delete();
      internal.decrementRefCount();
      checkGLError(gl, 'Creating Texture from Pointer');
      const rgbTexture = renderYUVToRGB(
        gl,
        progYUV,
        vtxBuffer,
        frameBuffer,
        textureId,
        textureWidth,
        textureHeight
      );
      checkGLError(gl, 'Rendering Yuv to RGB');
      addFrame(rgbTexture, { textureWidth, textureHeight });
    } catch (error) {
      console.error('Error in HB upload:', error);
      throw error;
    }
  });

  const renderCallback = async (frame: Frame) => {
    'worklet';
    if (isProcessing) {
      await yuvToRGBCallback(frame);
    }
  };

  return (
    <TouchableOpacity style={styles.container} onPress={handleScreenTap}>
      {isCameraActive ? (
        <CameraPage style={styles.cameraView} renderCallback={renderCallback} />
      ) : (
        <View style={styles.emptyView}>
          <BufferViewer
            frames={frames}
            glContext={gl} // Pass the actual GL context if available
            id={currentFrameId}
            onChangeFrame={setCurrentFrameId}
          />
        </View>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'white' },
  cameraView: { flex: 1 },
  emptyView: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#000' },
  emptyText: { color: '#fff', fontSize: 16 },
});

export default CustomTestScreen;
