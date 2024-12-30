import {
  NativeModulesProxy,
  UnavailabilityError,
  requireNativeModule,
  requireNativeViewManager,
  CodedError,
} from 'expo-modules-core';
import * as React from 'react';
import { Platform, View, findNodeHandle } from 'react-native';

import { configureLogging } from './GLUtils';
import {
  ComponentOrHandle,
  SurfaceCreateEvent,
  GLSnapshot,
  ExpoWebGLRenderingContext,
  SnapshotOptions,
  GLViewProps,
} from './GLView.types';
import { createWorkletContextManager } from './GLWorkletContextManager';

// @docsMissing
export type WebGLObject = {
  id: number;
};

declare let global: any;

const ExponentGLObjectManager = requireNativeModule('ExponentGLObjectManager');

const { ExponentGLViewManager } = NativeModulesProxy;

const NativeView = requireNativeViewManager('ExponentGLView');
const workletContextManager = createWorkletContextManager();

export function getWorkletContext(contextId: number): ExpoWebGLRenderingContext | undefined {
  'worklet';
  return workletContextManager.getContext(contextId);
}

// @needsAudit
/**
 * A View that acts as an OpenGL ES render target. On mounting, an OpenGL ES context is created.
 * Its drawing buffer is presented as the contents of the View every frame.
 */
export class GLView extends React.Component<GLViewProps> {
  static NativeView: any;

  static defaultProps = {
    msaaSamples: 4,
    enableExperimentalWorkletSupport: false,
  };

  /**
   * Imperative API that creates headless context which is devoid of underlying view.
   * It's useful for headless rendering or in case you want to keep just one context per application and share it between multiple components.
   * It is slightly faster than usual context as it doesn't swap framebuffers and doesn't present them on the canvas,
   * however it may require you to take a snapshot in order to present its results.
   * Also, keep in mind that you need to set up a viewport and create your own framebuffer and texture that you will be drawing to, before you take a snapshot.
   * @return A promise that resolves to WebGL context object. See [WebGL API](#webgl-api) for more details.
   */
  static async createContextAsync(): Promise<ExpoWebGLRenderingContext> {
    const { exglCtxId } = await ExponentGLObjectManager.createContextAsync();
    return getGl(exglCtxId);
  }


  static  vertexShaderYuvSource = `
  precision mediump float;
  attribute vec4 a_position;
  attribute vec2 a_texCoord;
  varying vec2 v_texCoord;

  void main() {
      gl_Position = a_position;
      v_texCoord = a_texCoord;
  }
   `

  static fragmentShaderYuvSource = `
  precision mediump float;

  varying vec2 v_texCoord;
  uniform sampler2D y_texture;
  uniform sampler2D u_texture;
  uniform sampler2D v_texture;

  void main() {
      float y = texture2D(y_texture, v_texCoord).r;
      float u = texture2D(u_texture, v_texCoord).r - 0.5;
      float v = texture2D(v_texture, v_texCoord).r - 0.5;

      float r = y + 1.402 * v;
      float g = y - 0.344 * u - 0.714 * v;
      float b = y + 1.772 * u;

      gl_FragColor = vec4(r, g, b, 1.0);
  }
 `
  static async setYuvShaderProgram(exglCtxId: number ,yuvProgramId: Number): Promise<any> {  
    return await ExponentGLObjectManager.setYuvShaderProgram(exglCtxId,yuvProgramId);
  }

  static async prepareContextForNativeCamera(exglCtxId: number): Promise<any> {
    "This will initialize the required shaders to validate it's compilation status faster on the JS thread.";
    function checkGLError(step,gl) {
      const error = gl.getError();
      if (error !== gl.NO_ERROR) {
        console.error(`OpenGL error after ${step}:`, error);
      }
    }
    const gl =  await getGl(exglCtxId);
    const vertexShaderYuv = gl.createShader(gl.VERTEX_SHADER);
    const fragmentShaderYuv = gl.createShader(gl.FRAGMENT_SHADER);

    if (vertexShaderYuv==null || fragmentShaderYuv ==null){
      console.log("One of the shaders pointers is null");
      return 0;
    }

    gl.shaderSource(vertexShaderYuv,GLView.vertexShaderYuvSource);
    gl.compileShader(vertexShaderYuv);
    checkGLError("post shader prepare context",gl)
    gl.shaderSource(vertexShaderYuv,GLView.vertexShaderYuvSource);
    gl.compileShader(vertexShaderYuv);
    checkGLError("post shader prepare context 2",gl);

    const yuvProgram = gl.createProgram()
    return new Promise<any>((resolve) => {
        resolve(yuvProgram);
    });
  
  }
  static async createTextureFromTexturePointer(exglCtxId: number, pointer: bigint): Promise<any> {

    const pointerBigInt = BigInt(pointer) & BigInt('0xFFFFFFFFFFFFFFFF'); // Mask lower 64 bits
    console.log('Create Texture : Pointer as BigInt:', pointerBigInt);
    console.log('Create Texture : Pointer as hexadecimal:', pointerBigInt.toString(16));

    const pointerString = pointerBigInt.toString(16); // Convert to hex string
    console.log('Pointer as hex string (to send to Kotlin):', pointerString);

    return await ExponentGLObjectManager.uploadAHardwareBufferAsync(exglCtxId, pointerString);
  }

  static async createTestHardwareBuffer(option:number): Promise<any> {
    const { pointer } = await ExponentGLObjectManager.createAHardwareBufferAsync(option);

    // Convert to BigInt and mask lower 64 bits (to avoid negative pointers), this to be compilant with react-native-camera return values.
    const pointerBigInt = BigInt(pointer) & BigInt('0xFFFFFFFFFFFFFFFF');
    console.log('Create HB : Pointer as BigInt:', pointerBigInt);
    console.log('Create HB : Pointer as hexadecimal:', pointerBigInt.toString(16));
    return pointerBigInt;
  }
  /**
   * Destroys given context.
   * @param exgl WebGL context to destroy.
   * @return A promise that resolves to boolean value that is `true` if given context existed and has been destroyed successfully.
   */
  static async destroyContextAsync(exgl?: ExpoWebGLRenderingContext | number): Promise<boolean> {
    const exglCtxId = getContextId(exgl);
    unregisterGLContext(exglCtxId);
    return ExponentGLObjectManager.destroyContextAsync(exglCtxId);
  }

  /**
   * Takes a snapshot of the framebuffer and saves it as a file to app's cache directory.
   * @param exgl WebGL context to take a snapshot from.
   * @param options
   * @return A promise that resolves to `GLSnapshot` object.
   */
  static async takeSnapshotAsync(
    exgl?: ExpoWebGLRenderingContext | number,
    options: SnapshotOptions = {}
  ): Promise<GLSnapshot> {
    const exglCtxId = getContextId(exgl);
    return ExponentGLObjectManager.takeSnapshotAsync(exglCtxId, options);
  }

  /**
   * This method doesn't work inside of the worklets with new reanimated versions.
   * @deprecated Use `getWorkletContext` from the global scope instead.
   */
  static getWorkletContext: (contextId: number) => ExpoWebGLRenderingContext | undefined =
    workletContextManager.getContext;

  nativeRef: ComponentOrHandle = null;
  exglCtxId?: number;

  render() {
    const { onContextCreate, msaaSamples, enableExperimentalWorkletSupport, ...viewProps } =
      this.props;

    return (
      <View {...viewProps}>
        <NativeView
          ref={this._setNativeRef}
          style={{
            flex: 1,
            ...(Platform.OS === 'ios'
              ? {
                  backgroundColor: 'transparent',
                }
              : {}),
          }}
          onSurfaceCreate={this._onSurfaceCreate}
          enableExperimentalWorkletSupport={enableExperimentalWorkletSupport}
          msaaSamples={Platform.OS === 'ios' ? msaaSamples : undefined}
        />
      </View>
    );
  }

  _setNativeRef = (nativeRef: ComponentOrHandle): void => {
    if (this.props.nativeRef_EXPERIMENTAL) {
      this.props.nativeRef_EXPERIMENTAL(nativeRef);
    }
    this.nativeRef = nativeRef;
  };

  _onSurfaceCreate = ({ nativeEvent: { exglCtxId } }: SurfaceCreateEvent): void => {
    const gl = getGl(exglCtxId);

    this.exglCtxId = exglCtxId;

    if (this.props.onContextCreate) {
      this.props.onContextCreate(gl);
    }
  };

  componentWillUnmount(): void {
    if (this.exglCtxId) {
      unregisterGLContext(this.exglCtxId);
    }
  }

  componentDidUpdate(prevProps: GLViewProps): void {
    if (
      this.props.enableExperimentalWorkletSupport !== prevProps.enableExperimentalWorkletSupport
    ) {
      console.warn('Updating prop enableExperimentalWorkletSupport is not supported');
    }
  }

  // @docsMissing
  async startARSessionAsync(): Promise<any> {
    if (!ExponentGLViewManager.startARSessionAsync) {
      throw new UnavailabilityError('expo-gl', 'startARSessionAsync');
    }
    return await ExponentGLViewManager.startARSessionAsync(findNodeHandle(this.nativeRef));
  }

  // @docsMissing
  async createCameraTextureAsync(cameraRefOrHandle: ComponentOrHandle): Promise<WebGLTexture> {
    if (!ExponentGLObjectManager.createCameraTextureAsync) {
      throw new UnavailabilityError('expo-gl', 'createCameraTextureAsync');
    }

    const { exglCtxId } = this;

    if (!exglCtxId) {
      throw new Error("GLView's surface is not created yet!");
    }

    const cameraTag = findNodeHandle(cameraRefOrHandle);
    const { exglObjId } = await ExponentGLObjectManager.createCameraTextureAsync(
      exglCtxId,
      cameraTag
    );
    return { id: exglObjId } as WebGLTexture;
  }

  // @docsMissing
  async destroyObjectAsync(glObject: WebGLObject): Promise<boolean> {
    if (!ExponentGLObjectManager.destroyObjectAsync) {
      throw new UnavailabilityError('expo-gl', 'destroyObjectAsync');
    }
    return await ExponentGLObjectManager.destroyObjectAsync(glObject.id);
  }

  /**
   * Same as static [`takeSnapshotAsync()`](#takesnapshotasyncoptions),
   * but uses WebGL context that is associated with the view on which the method is called.
   * @param options
   */
  async takeSnapshotAsync(options: SnapshotOptions = {}): Promise<GLSnapshot> {
    if (!GLView.takeSnapshotAsync) {
      throw new UnavailabilityError('expo-gl', 'takeSnapshotAsync');
    }
    const { exglCtxId } = this;
    return await GLView.takeSnapshotAsync(exglCtxId, options);
  }
}

GLView.NativeView = NativeView;

function unregisterGLContext(exglCtxId: number) {
  if (global.__EXGLContexts) {
    delete global.__EXGLContexts[String(exglCtxId)];
  }
  workletContextManager.unregister?.(exglCtxId);
}

// Get the GL interface from an EXGLContextId
const getGl = (exglCtxId: number): ExpoWebGLRenderingContext => {
  if (!global.__EXGLContexts) {
    throw new CodedError(
      'ERR_GL_NOT_AVAILABLE',
      'GL is currently not available. (Have you enabled remote debugging? GL is not available while debugging remotely.)'
    );
  }
  const gl = global.__EXGLContexts[String(exglCtxId)];

  configureLogging(gl);

  return gl;
};

const getContextId = (exgl?: ExpoWebGLRenderingContext | number): number => {
  const exglCtxId = exgl && typeof exgl === 'object' ? exgl.contextId : exgl;

  if (!exglCtxId || typeof exglCtxId !== 'number') {
    throw new Error(`Invalid EXGLContext id: ${String(exglCtxId)}`);
  }
  return exglCtxId;
};
