import { ExpoWebGLRenderingContext } from 'expo-gl';
import { useState, useCallback, useEffect, useRef } from 'react';

import { getGLContext } from './GLContextManager';

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
      const id = nextId.current++;
      const newFrame: ProcessedFrame = { texture, metadata };
      setFrames((prev) => [...prev, newFrame]);
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
