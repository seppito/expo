import { getGLContext } from './GLContextManager';
import { useState, useCallback, useEffect, useRef } from 'react';
import { ExpoWebGLRenderingContext, WebGLTexture } from 'expo-gl';

export interface ProcessedFrame {
  texture: WebGLTexture;
  metadata: Record<string, any>;
}

export const useGLBufferFrameManager = () => {
  const [frames, setFrames] = useState<ProcessedFrame[]>([]);
  const nextId = useRef<number>(0);

  // Add a new frame to the buffer
  const addFrame = useCallback(
    (texture: WebGLTexture, metadata = {}) => {
      console.log('Adding frame to buffer');
      const id = nextId.current++;
      const newFrame: ProcessedFrame = { texture, metadata };
      setFrames((prev) => [...prev, newFrame]);
      console.log('Updated frame count:', frames.length + 1);
      return id;
    },
    [frames.length]
  );

  // Delete a frame from the buffer
  const deleteFrame = useCallback((id: number) => {
    setFrames((prev) => prev.filter((_, index) => index !== id));
  }, []);

  // Get the number of stored frames
  const getFrameCount = useCallback(() => {
    return frames.length;
  }, [frames.length]);

  // Initialize GL context
  const initializeContext = useCallback(async () => {
    const gl = await getGLContext();
    console.log('GL context initialized or reused:', gl);
    return gl;
  }, []);
  

  return {
    initializeContext,
    addFrame,
    deleteFrame,
    getFrameCount,
    frames,
  };
};