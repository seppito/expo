import { NativeModulesProxy, UnavailabilityError, requireNativeModule, requireNativeViewManager, CodedError, } from 'expo-modules-core';
import * as React from 'react';
import { Platform, View, findNodeHandle } from 'react-native';
import { configureLogging } from './GLUtils';
import { createWorkletContextManager } from './GLWorkletContextManager';
const ExponentGLObjectManager = requireNativeModule('ExponentGLObjectManager');
const { ExponentGLViewManager } = NativeModulesProxy;
const NativeView = requireNativeViewManager('ExponentGLView');
const workletContextManager = createWorkletContextManager();
export function getWorkletContext(contextId) {
    'worklet';
    return workletContextManager.getContext(contextId);
}
// @needsAudit
/**
 * A View that acts as an OpenGL ES render target. On mounting, an OpenGL ES context is created.
 * Its drawing buffer is presented as the contents of the View every frame.
 */
export class GLView extends React.Component {
    static NativeView;
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
    static async createYuvProgramAsync(glCtxId) {
        const glCtx = getGl(glCtxId);
        const vertexShaderSourceYUV = `
    precision mediump float;
    attribute vec3 position;
    attribute vec2 texcoord;
    varying vec2 vTexCoord;

    void main() {
      gl_Position = vec4(position, 1.0);
      // Rotate texture coordinates 90 degrees counterclockwise
      vTexCoord = vec2(texcoord.y, texcoord.x);
    }
  `;
        const fragmentShaderSourceYUV = `
    precision mediump float;
    varying vec2 vTexCoord;
    uniform sampler2D yTexture;
    uniform sampler2D uTexture;
    uniform sampler2D vTexture;

    void main() {
      float y = (texture2D(yTexture, vTexCoord).r - 0.0625) * 1.164;
      float u = texture2D(uTexture, vTexCoord).r - 0.5;
      float v = texture2D(vTexture, vTexCoord).r - 0.5;

      // YUV -> RGB
      vec3 rgb = vec3(
        y + 1.596 * v,
        y - 0.391 * u - 0.813 * v,
        y + 2.018 * u
      );
      gl_FragColor = vec4(rgb, 1.0);
    }
  `;
        console.log("pre shader.");
        const vertYUV = glCtx.createShader(glCtx.VERTEX_SHADER);
        glCtx.shaderSource(vertYUV, vertexShaderSourceYUV);
        glCtx.compileShader(vertYUV);
        const fragYUV = glCtx.createShader(glCtx.FRAGMENT_SHADER);
        glCtx.shaderSource(fragYUV, fragmentShaderSourceYUV);
        glCtx.compileShader(fragYUV);
        console.log("post frag.");
        const progYUV = glCtx.createProgram();
        glCtx.attachShader(progYUV, vertYUV);
        glCtx.attachShader(progYUV, fragYUV);
        glCtx.linkProgram(progYUV);
        console.log("post prog");
        const vertices = new Float32Array([
            -1.0, -1.0, 0.0, 0.0, 0.0,
            1.0, -1.0, 0.0, 1.0, 0.0,
            -1.0, 1.0, 0.0, 0.0, 1.0,
            1.0, 1.0, 0.0, 1.0, 1.0,
        ]);
        // ------------------------------------------------
        // Create Vertex Buffer
        // ------------------------------------------------
        const vtxBuffer = glCtx.createBuffer();
        glCtx.bindBuffer(glCtx.ARRAY_BUFFER, vtxBuffer);
        glCtx.bufferData(glCtx.ARRAY_BUFFER, vertices, glCtx.STATIC_DRAW);
        return { progYUV, vtxBuffer };
    }
    static async prepareContextForNativeCamera(exglCtxId) {
        return await GLView.createYuvProgramAsync(exglCtxId);
    }
    static async createContextAsync() {
        const { exglCtxId } = await ExponentGLObjectManager.createContextAsync();
        return getGl(exglCtxId);
    }
    static async createTextureFromTexturePointer(exglCtxId, pointer) {
        const pointerBigInt = BigInt(pointer) & BigInt('0xFFFFFFFFFFFFFFFF'); // Mask lower 64 bits
        const pointerString = pointerBigInt.toString(16); // Convert to hex string
        return await ExponentGLObjectManager.uploadAHardwareBufferAsync(exglCtxId, pointerString);
    }
    static async createTestHardwareBuffer(option) {
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
    static async destroyContextAsync(exgl) {
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
    static async takeSnapshotAsync(exgl, options = {}) {
        const exglCtxId = getContextId(exgl);
        return ExponentGLObjectManager.takeSnapshotAsync(exglCtxId, options);
    }
    /**
     * This method doesn't work inside of the worklets with new reanimated versions.
     * @deprecated Use `getWorkletContext` from the global scope instead.
     */
    static getWorkletContext = workletContextManager.getContext;
    nativeRef = null;
    exglCtxId;
    render() {
        const { onContextCreate, msaaSamples, enableExperimentalWorkletSupport, ...viewProps } = this.props;
        return (<View {...viewProps}>
        <NativeView ref={this._setNativeRef} style={{
                flex: 1,
                ...(Platform.OS === 'ios'
                    ? {
                        backgroundColor: 'transparent',
                    }
                    : {}),
            }} onSurfaceCreate={this._onSurfaceCreate} enableExperimentalWorkletSupport={enableExperimentalWorkletSupport} msaaSamples={Platform.OS === 'ios' ? msaaSamples : undefined}/>
      </View>);
    }
    _setNativeRef = (nativeRef) => {
        if (this.props.nativeRef_EXPERIMENTAL) {
            this.props.nativeRef_EXPERIMENTAL(nativeRef);
        }
        this.nativeRef = nativeRef;
    };
    _onSurfaceCreate = ({ nativeEvent: { exglCtxId } }) => {
        const gl = getGl(exglCtxId);
        this.exglCtxId = exglCtxId;
        if (this.props.onContextCreate) {
            this.props.onContextCreate(gl);
        }
    };
    componentWillUnmount() {
        if (this.exglCtxId) {
            unregisterGLContext(this.exglCtxId);
        }
    }
    componentDidUpdate(prevProps) {
        if (this.props.enableExperimentalWorkletSupport !== prevProps.enableExperimentalWorkletSupport) {
            console.warn('Updating prop enableExperimentalWorkletSupport is not supported');
        }
    }
    // @docsMissing
    async startARSessionAsync() {
        if (!ExponentGLViewManager.startARSessionAsync) {
            throw new UnavailabilityError('expo-gl', 'startARSessionAsync');
        }
        return await ExponentGLViewManager.startARSessionAsync(findNodeHandle(this.nativeRef));
    }
    // @docsMissing
    async createCameraTextureAsync(cameraRefOrHandle) {
        if (!ExponentGLObjectManager.createCameraTextureAsync) {
            throw new UnavailabilityError('expo-gl', 'createCameraTextureAsync');
        }
        const { exglCtxId } = this;
        if (!exglCtxId) {
            throw new Error("GLView's surface is not created yet!");
        }
        const cameraTag = findNodeHandle(cameraRefOrHandle);
        const { exglObjId } = await ExponentGLObjectManager.createCameraTextureAsync(exglCtxId, cameraTag);
        return { id: exglObjId };
    }
    // @docsMissing
    async destroyObjectAsync(glObject) {
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
    async takeSnapshotAsync(options = {}) {
        if (!GLView.takeSnapshotAsync) {
            throw new UnavailabilityError('expo-gl', 'takeSnapshotAsync');
        }
        const { exglCtxId } = this;
        return await GLView.takeSnapshotAsync(exglCtxId, options);
    }
}
GLView.NativeView = NativeView;
function unregisterGLContext(exglCtxId) {
    if (global.__EXGLContexts) {
        delete global.__EXGLContexts[String(exglCtxId)];
    }
    workletContextManager.unregister?.(exglCtxId);
}
// Get the GL interface from an EXGLContextId
const getGl = (exglCtxId) => {
    if (!global.__EXGLContexts) {
        throw new CodedError('ERR_GL_NOT_AVAILABLE', 'GL is currently not available. (Have you enabled remote debugging? GL is not available while debugging remotely.)');
    }
    const gl = global.__EXGLContexts[String(exglCtxId)];
    configureLogging(gl);
    return gl;
};
const getContextId = (exgl) => {
    const exglCtxId = exgl && typeof exgl === 'object' ? exgl.contextId : exgl;
    if (!exglCtxId || typeof exglCtxId !== 'number') {
        throw new Error(`Invalid EXGLContext id: ${String(exglCtxId)}`);
    }
    return exglCtxId;
};
//# sourceMappingURL=GLView.js.map