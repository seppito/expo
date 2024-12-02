#include "EXGLNativeContext.h"
#include "EXPlatformUtils.h"
#include <GLES/gl.h> // OpenGL ES 1.0 headers
#include <cstring> // For memcpy
#include <android/bitmap.h> // For Android Bitmap API
#include <cstdint> // for uint32_t
#include "EXWebGLMethods.h"
#include "EXWebGLMethodsHelpers.h"
//#include "EXWebGLConstants.def"

namespace expo {
namespace gl_cpp {

constexpr const char *OnJSRuntimeDestroyPropertyName = "__EXGLOnJsRuntimeDestroy";

void EXGLContext::prepareContext(jsi::Runtime &runtime, std::function<void(void)> flushMethod) {
  this->flushOnGLThread = flushMethod;
  try {
    this->initialGlesContext = prepareOpenGLESContext();
    createWebGLRenderer(runtime, this, this->initialGlesContext, runtime.global());
    tryRegisterOnJSRuntimeDestroy(runtime);

    maybeResolveWorkletContext(runtime);
  } catch (const std::runtime_error &err) {
    EXGLSysLog("Failed to setup EXGLContext [%s]", err.what());
  }
}

/**
 * Fills an AHardwareBuffer with a checkerboard pattern.
 * 
 * @param nativeBuffer Pointer to the AHardwareBuffer to be filled.
 * @param color1 The first color in the checkerboard (RGBA format, e.g., 0xFF0000FF for solid red).
 * @param color2 The second color in the checkerboard (RGBA format, e.g., 0xFFFFFFFF for white).
 * @param checkerSize The size of each square in the checkerboard pattern (in pixels).
 * @return True if successful, false otherwise.
 */
bool EXGLContext::FillAHardwareBufferWithCheckerboard(
    AHardwareBuffer* nativeBuffer, 
    uint32_t color1, 
    uint32_t color2, 
    uint32_t checkerSize
) {
    if (!nativeBuffer) {
        EXGLSysLog("FillAHardwareBufferWithCheckerboard: Null buffer");
        return false;
    }

    // Describe the buffer
    AHardwareBuffer_Desc desc;
    AHardwareBuffer_describe(nativeBuffer, &desc);

    EXGLSysLog("Hardware buffer dimensions: width=%d, height=%d, stride=%d", desc.width, desc.height, desc.stride);

    // Ensure the buffer format is supported
    if (desc.format != AHARDWAREBUFFER_FORMAT_R8G8B8A8_UNORM) {
        EXGLSysLog("Unsupported hardware buffer format: %d", desc.format);
        return false;
    }

    // Lock the buffer for writing
    void* bufferData = nullptr;
    int lockResult = AHardwareBuffer_lock(
        nativeBuffer,
        AHARDWAREBUFFER_USAGE_CPU_WRITE_OFTEN,
        -1, // No fence
        nullptr, // Lock the entire buffer
        &bufferData
    );

    if (lockResult != 0 || !bufferData) {
        EXGLSysLog("Failed to lock hardware buffer for writing");
        return false;
    }

    // Fill the buffer with a checkerboard pattern
    uint32_t* pixels = static_cast<uint32_t*>(bufferData);
    for (uint32_t y = 0; y < desc.height; ++y) {
        for (uint32_t x = 0; x < desc.width; ++x) {
            uint32_t checkerX = x / checkerSize;
            uint32_t checkerY = y / checkerSize;
            bool isColor1 = (checkerX + checkerY) % 2 == 0;

            pixels[y * desc.stride + x] = isColor1 ? color1 : color2;
        }
    }

    // Unlock the buffer
    AHardwareBuffer_unlock(nativeBuffer, nullptr);
    EXGLSysLog("Checkerboard pattern written to hardware buffer");

    return true;
}


int EXGLContext::uploadTextureToOpenGL(jsi::Runtime &runtime, AHardwareBuffer *hardwareBuffer) {
    uint32_t red = 0xFF0000FF;   // Solid red (RGBA)
    uint32_t white = 0xFFFFFFFF; // Solid white (RGBA)
    uint32_t squareSize = 8;     // 8x8 pixels per square

    if(FillAHardwareBufferWithCheckerboard(hardwareBuffer, red, white, squareSize)){
        EXGLSysLog("Success, colored");
    } else{
        EXGLSysLog("Not Success");
    }
    // Call the native method and get the WebGL object
    jsi::Value result = exglGenObject(this, runtime, glGenTextures, EXWebGLClass::WebGLTexture);

    // This is to validate that we're currently clearing the color from the GL thread to the JS thread.
    addToNextBatch([=] {
      glClearColor(1, 0, 0, 1);
      glClearDepthf(1);
      glClearStencil(0);
      glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT | GL_STENCIL_BUFFER_BIT);

    });

    this->flush();

    // Ensure the result is an object
    if (!result.isObject()) {
        throw std::runtime_error("Error: exglGenObject did not return a valid WebGL object.");
    }


    // Extract the 'id' property from the WebGL object
    jsi::Object webglObject = result.asObject(runtime);
    jsi::Value idValue = webglObject.getProperty(runtime, "id");

    // Ensure the 'id' is a number
    if (!idValue.isNumber()) {
        throw std::runtime_error("Error: WebGL object 'id' property is not a valid number.");
    }

    // Convert the 'id' to EXGLObjectId
    EXGLObjectId texture = static_cast<EXGLObjectId>(idValue.asNumber());
    
    
    EXGLSysLog("TextureId is %d",texture);
    // Acquire the hardware buffer to increment its reference count
    AHardwareBuffer_acquire(hardwareBuffer);
    AHardwareBuffer_Desc desc = {};
    AHardwareBuffer_describe(hardwareBuffer, &desc);
    if (desc.format != AHARDWAREBUFFER_FORMAT_R8G8B8A8_UNORM) {
          EXGLSysLog("Unsupported hardware buffer format");
          AHardwareBuffer_release(hardwareBuffer);
          return 0u; // Return 0 to indicate an error
    }
    void *bufferData = nullptr;
    int32_t lock_result = AHardwareBuffer_lock(
        hardwareBuffer,
        AHARDWAREBUFFER_USAGE_CPU_READ_OFTEN,
        -1,
        nullptr,
        &bufferData
    );

    if (lock_result != 0 || !bufferData) {
        EXGLSysLog("Failed to lock AHardwareBuffer");
        AHardwareBuffer_release(hardwareBuffer);
        return 0u; // Return 0 to indicate an error
    }
    EXGLSysLog("Locked Hardware Buffer");

    // Example OpenGL operation using the texture ID
    //static int TEXTURE_2D_CONST = 3553; // GL_TEXTURE_2D constant
    addToNextBatch([=] {
        // Lock the hardware buffer
      glBindTexture(GL_TEXTURE_2D, lookupObject(texture));  
    });
    this->flush();

   if (desc.stride != desc.width) {
            // Handle non-tightly packed data
            size_t dataSize = desc.width * desc.height * 4; // 4 bytes per pixel (RGBA)
            std::vector<uint8_t> tightBuffer(dataSize);

            uint8_t* src = static_cast<uint8_t*>(bufferData);
            uint8_t* dst = tightBuffer.data();
            EXGLSysLog("Diff than width");

            for (uint32_t y = 0; y < desc.height; y++) {
                memcpy(dst, src, desc.width * 4);
                src += desc.stride * 4;
                dst += desc.width * 4;
            }

            addToNextBatch([=] {
                // Lock the hardware buffer
              glTexImage2D(
                        GL_TEXTURE_2D,
                        0,
                        GL_RGBA,
                        desc.width,
                        desc.height,
                        0,
                        GL_RGBA,
                        GL_UNSIGNED_BYTE,
                        tightBuffer.data()
                    );
              });
        } else {
            EXGLSysLog("Data is tightly packed");

            // Data is tightly packed, use bufferData directly
            addToNextBatch([=] {
                // Lock the hardware buffer
              glTexImage2D(
                GL_TEXTURE_2D,
                0,
                GL_RGBA,
                desc.width,
                desc.height,
                0,
                GL_RGBA,
                GL_UNSIGNED_BYTE,
                bufferData
            );
            //glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
            //glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);

          });
        }
    this->flush();

    // Unlock the hardware buffer
    AHardwareBuffer_unlock(hardwareBuffer, nullptr);

    // Release the hardware buffer
    AHardwareBuffer_release(hardwareBuffer);
   
    // Return the texture ID or any other relevant result
    return static_cast<int>(texture);
}

void EXGLContext::maybeResolveWorkletContext(jsi::Runtime &runtime) {
  jsi::Value workletRuntimeValue = runtime.global().getProperty(runtime, "_WORKLET_RUNTIME");
  if (!workletRuntimeValue.isObject()) {
    return;
  }
  jsi::Object workletRuntimeObject = workletRuntimeValue.getObject(runtime);
  if (!workletRuntimeObject.isArrayBuffer(runtime)) {
    return;
  }
  size_t pointerSize = sizeof(void *);
  jsi::ArrayBuffer workletRuntimeArrayBuffer = workletRuntimeObject.getArrayBuffer(runtime);
  if (workletRuntimeArrayBuffer.size(runtime) != pointerSize) {
    return;
  }
  uintptr_t rawWorkletRuntimePointer =
      *reinterpret_cast<uintptr_t *>(workletRuntimeArrayBuffer.data(runtime));
  jsi::Runtime *workletRuntime = reinterpret_cast<jsi::Runtime *>(rawWorkletRuntimePointer);
  this->maybeWorkletRuntime = workletRuntime;
}

void EXGLContext::prepareWorkletContext() {
  if (maybeWorkletRuntime == nullptr) {
    return;
  }
  jsi::Runtime &runtime = *this->maybeWorkletRuntime;
  createWebGLRenderer(
      runtime, this, initialGlesContext, runtime.global().getPropertyAsObject(runtime, "global"));
  tryRegisterOnJSRuntimeDestroy(runtime);
}

void EXGLContext::endNextBatch() noexcept {
  std::lock_guard<std::mutex> lock(backlogMutex);
  backlog.push_back(std::move(nextBatch));
  nextBatch = std::vector<Op>();
  nextBatch.reserve(16); // default batch size
}

// [JS thread] Add an Op to the 'next' batch -- the arguments are any form of
// constructor arguments for Op
void EXGLContext::addToNextBatch(Op &&op) noexcept {
  nextBatch.push_back(std::move(op));
}

// [JS thread] Add a blocking operation to the 'next' batch -- waits for the
// queued function to run before returning
void EXGLContext::addBlockingToNextBatch(Op &&op) {
  std::packaged_task<void(void)> task(std::move(op));
  auto future = task.get_future();
  addToNextBatch([&] { task(); });
  endNextBatch();
  flushOnGLThread();
  future.wait();
}

// [JS thread] Enqueue a function and return an EXGL object that will get mapped
// to the function's return value when it is called on the GL thread.
jsi::Value EXGLContext::addFutureToNextBatch(
    jsi::Runtime &runtime,
    std::function<unsigned int(void)> &&op) noexcept {
  auto exglObjId = createObject();
  addToNextBatch([=] {
    assert(objects.find(exglObjId) == objects.end());
    mapObject(exglObjId, op());
  });
  return static_cast<double>(exglObjId);
}

// [GL thread] Do all the remaining work we can do on the GL thread
void EXGLContext::flush(void) {
  // Keep a copy and clear backlog to minimize lock time
  std::vector<Batch> copy;
  {
    std::lock_guard<std::mutex> lock(backlogMutex);
    std::swap(backlog, copy);
  }
  for (const auto &batch : copy) {
    for (const auto &op : batch) {
      op();
    }
  }
}

EXGLObjectId EXGLContext::createObject(void) noexcept {
  return nextObjectId++;
}

void EXGLContext::destroyObject(EXGLObjectId exglObjId) noexcept {
  objects.erase(exglObjId);
}

void EXGLContext::mapObject(EXGLObjectId exglObjId, GLuint glObj) noexcept {
  objects[exglObjId] = glObj;
}

GLuint EXGLContext::lookupObject(EXGLObjectId exglObjId) noexcept {
  auto iter = objects.find(exglObjId);
  return iter == objects.end() ? 0 : iter->second;
}

void EXGLContext::tryRegisterOnJSRuntimeDestroy(jsi::Runtime &runtime) {
  auto global = runtime.global();

  if (global.getProperty(runtime, OnJSRuntimeDestroyPropertyName).isObject()) {
    return;
  }
  // Property `__EXGLOnJsRuntimeDestroy` of the global object will be released when entire
  // `jsi::Runtime` is being destroyed and that will trigger destructor of
  // `InvalidateCacheOnDestroy` class which will invalidate JSI PropNameID cache.
  global.setProperty(
      runtime,
      OnJSRuntimeDestroyPropertyName,
      jsi::Object::createFromHostObject(
          runtime, std::make_shared<InvalidateCacheOnDestroy>(runtime)));
}

glesContext EXGLContext::prepareOpenGLESContext() {
  glesContext result;
  // Clear everything to initial values
  addBlockingToNextBatch([&] {
    std::string version = reinterpret_cast<const char *>(glGetString(GL_VERSION));
    double glesVersion = strtod(version.substr(10).c_str(), 0);
    this->supportsWebGL2 = glesVersion >= 3.0;

    glBindFramebuffer(GL_FRAMEBUFFER, defaultFramebuffer);
    GLenum status = glCheckFramebufferStatus(GL_FRAMEBUFFER);

    // This should not be called on headless contexts as they don't have default framebuffer.
    // On headless context, status is undefined.
    if (status != GL_FRAMEBUFFER_UNDEFINED) {
      glClearColor(0, 0, 0, 0);
      glClearDepthf(1);
      glClearStencil(0);
      glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT | GL_STENCIL_BUFFER_BIT);
      int32_t viewport[4];
      glGetIntegerv(GL_VIEWPORT, viewport);
      result.viewportWidth = viewport[2];
      result.viewportHeight = viewport[3];
    } else {
      // Set up an initial viewport for headless context.
      // These values are the same as newly created WebGL context has,
      // however they should be changed by the user anyway.
      glViewport(0, 0, 300, 150);
      result.viewportWidth = 300;
      result.viewportHeight = 150;
    }
  });
  return result;
}

void EXGLContext::maybeReadAndCacheSupportedExtensions() {
  if (supportedExtensions.size() == 0) {
    addBlockingToNextBatch([&] {
      GLint numExtensions = 0;
      glGetIntegerv(GL_NUM_EXTENSIONS, &numExtensions);

      for (auto i = 0; i < numExtensions; i++) {
        std::string extensionName(reinterpret_cast<const char *>(glGetStringi(GL_EXTENSIONS, i)));

        // OpenGL ES prefixes extension names with `GL_`, need to trim this.
        if (extensionName.substr(0, 3) == "GL_") {
          extensionName.erase(0, 3);
        }
        if (extensionName != "OES_vertex_array_object") {
          supportedExtensions.insert(extensionName);
        }
      }
    });

    supportedExtensions.insert("OES_texture_float_linear");
    supportedExtensions.insert("OES_texture_half_float_linear");

    // OpenGL ES 3.0 supports these out of the box.
    if (supportsWebGL2) {
      supportedExtensions.insert("WEBGL_compressed_texture_astc");
      supportedExtensions.insert("WEBGL_compressed_texture_etc");
    }

#ifdef __APPLE__
    // All iOS devices support PVRTC compression format.
    supportedExtensions.insert("WEBGL_compressed_texture_pvrtc");
#endif
  }
}

} // namespace gl_cpp
} // namespace expo
