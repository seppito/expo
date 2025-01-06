#include "EXGLNativeContext.h"
#include "EXPlatformUtils.h"
#include <GLES/gl.h> // OpenGL ES 1.0 headers
#include <cstring> // For memcpy
#include <android/bitmap.h> // For Android Bitmap API
#include <cstdint> // for uint32_t
#include "EXWebGLMethods.h"
#include "EXWebGLMethodsHelpers.h"
#include "EXGLImageUtils.h"
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
void checkShaderCompilation(GLuint shader, const char *shaderName) {
  GLint success;
  GLchar infoLog[512];
  glGetShaderiv(shader, GL_COMPILE_STATUS, &success);
  if (!success) {
      glGetShaderInfoLog(shader, 512, NULL, infoLog);
      EXGLSysLog("%s compilation failed: %s", shaderName, infoLog);
  }
}

void checkProgramLinking(GLuint program, const char *programName) {
  GLint success;
  GLchar infoLog[512];
  glGetProgramiv(program, GL_LINK_STATUS, &success);
  if (!success) {
      glGetProgramInfoLog(program, 512, NULL, infoLog);
      EXGLSysLog("%s linking failed: %s", programName, infoLog);
  }
}
static GLuint compileShader(GLenum type, const char* source, const char* name) {
    GLuint shader = glCreateShader(type);
    glShaderSource(shader, 1, &source, nullptr);
    glCompileShader(shader);
    checkShaderCompilation(shader, name);
    return shader;
}

GLuint createProgram(GLuint vertexShader, GLuint fragmentShader) {
    GLuint program = glCreateProgram();
    glAttachShader(program, vertexShader);
    glAttachShader(program, fragmentShader);
    glLinkProgram(program);
    return program;
}

void checkFramebufferStatus() {
    GLenum status = glCheckFramebufferStatus(GL_FRAMEBUFFER);
    if (status != GL_FRAMEBUFFER_COMPLETE) {
        EXGLSysLog("Framebuffer error: %d", status);
    }
}
void drawQuad() {
    float vertices[] = { -1, -1, 1, -1, -1, 1, 1, 1 };
    GLuint vao, vbo;
    glGenVertexArrays(1, &vao);
    glBindVertexArray(vao);
    glGenBuffers(1, &vbo);
    glBindBuffer(GL_ARRAY_BUFFER, vbo);
    glBufferData(GL_ARRAY_BUFFER, sizeof(vertices), vertices, GL_STATIC_DRAW);
    glVertexAttribPointer(0, 2, GL_FLOAT, GL_FALSE, 0, 0);
    glEnableVertexAttribArray(0);
    glDrawArrays(GL_TRIANGLE_STRIP, 0, 4);
}
static void checkGLError(const char* msg) {
    GLenum err = glGetError();
    if (err != GL_NO_ERROR) {
        EXGLSysLog("OpenGL Error %d after %s", err, msg);
    }
}
int EXGLContext::uploadTextureToOpenGL(jsi::Runtime &runtime, AHardwareBuffer *hardwareBuffer) {
    EXGLSysLog("Reached Upload Texture to OpenGL");

    auto exglObjId = createObject();

    // Acquire hardware buffer
    AHardwareBuffer_acquire(hardwareBuffer);
    AHardwareBuffer_Desc desc = {};
    AHardwareBuffer_describe(hardwareBuffer, &desc);

    if (desc.format != AHARDWAREBUFFER_FORMAT_R8G8B8A8_UNORM && desc.format != AHARDWAREBUFFER_FORMAT_Y8Cb8Cr8_420) {
        EXGLSysLog("Unsupported hardware buffer format %d", desc.format);
        AHardwareBuffer_release(hardwareBuffer);
        return 0;
    }

    int width = desc.width;
    int height = desc.height;

   if (desc.format == AHARDWAREBUFFER_FORMAT_Y8Cb8Cr8_420) {
      EXGLSysLog("AHARDWAREBUFFER_FORMAT_Y8Cb8Cr8_420");
      AHardwareBuffer_Planes planes = {};
      int32_t lock_result = AHardwareBuffer_lockPlanes(
          hardwareBuffer,
          AHARDWAREBUFFER_USAGE_CPU_READ_OFTEN,
          -1,
          nullptr,
          &planes
      );

      if (lock_result != 0) {
          EXGLSysLog("Failed to lock AHardwareBuffer");
          AHardwareBuffer_release(hardwareBuffer);
          return 0;
      }

      void* yPlane = planes.planes[0].data;
      void* uPlane = planes.planes[1].data;
      void* vPlane = planes.planes[2].data;

      int yStride     = planes.planes[0].rowStride;
      int uStride     = planes.planes[1].rowStride;
      int vStride     = planes.planes[2].rowStride;
      int pixelStride = planes.planes[1].pixelStride; 

      auto uPlaneObjId = createObject();
      auto vPlaneObjId = createObject();

      std::vector<uint8_t> yVec(height * width);
      for (int row = 0; row < height; ++row) {
          std::memcpy(
              yVec.data() + (row * width),
              static_cast<uint8_t*>(yPlane) + (row * yStride),
              width
          );
      }
      gl_cpp::flipPixels(yVec.data(), width, height);

      std::vector<uint8_t> uVec((height / 2) * (width / 2));
      std::vector<uint8_t> vVec((height / 2) * (width / 2));

      auto* srcU = static_cast<uint8_t*>(uPlane);
      auto* srcV = static_cast<uint8_t*>(vPlane);

      for (int row = 0; row < (height / 2); ++row) {
          for (int col = 0; col < (width / 2); ++col) {
              int dstIndex = row * (width / 2) + col;
              uVec[dstIndex] = srcU[row * uStride + col * pixelStride];
              vVec[dstIndex] = srcV[row * vStride + col * pixelStride];
          }
      }
      // Flip U and V
      gl_cpp::flipPixels(uVec.data(), width / 2, height / 2);
      gl_cpp::flipPixels(vVec.data(), width / 2, height / 2);

      // Done reading from CPU memory
      AHardwareBuffer_unlock(hardwareBuffer, nullptr);
      AHardwareBuffer_release(hardwareBuffer);

      // 3. Queue the OpenGL upload
      addToNextBatch([=, yVec{std::move(yVec)}, uVec{std::move(uVec)}, vVec{std::move(vVec)}] {
          EXGLSysLog("Inside GL batch operation.");
          glPixelStorei(GL_UNPACK_ALIGNMENT, 1);

          GLuint textureY, textureU, textureV;
          glGenTextures(1, &textureY);
          glGenTextures(1, &textureU);
          glGenTextures(1, &textureV);

          // -- Upload Y-plane
          glActiveTexture(GL_TEXTURE0);
          glBindTexture(GL_TEXTURE_2D, textureY);
          glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
          glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
          glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
          glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
          glTexImage2D(
              GL_TEXTURE_2D,
              0,
              GL_LUMINANCE,
              width,
              height,
              0,
              GL_LUMINANCE,
              GL_UNSIGNED_BYTE,
              yVec.data()
          );

          // -- Upload U-plane
          glActiveTexture(GL_TEXTURE1);
          glBindTexture(GL_TEXTURE_2D, textureU);
          glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
          glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
          glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
          glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
          glTexImage2D(
              GL_TEXTURE_2D,
              0,
              GL_LUMINANCE,
              width / 2,
              height / 2,
              0,
              GL_LUMINANCE,
              GL_UNSIGNED_BYTE,
              uVec.data()
          );

          // -- Upload V-plane
          glActiveTexture(GL_TEXTURE2);
          glBindTexture(GL_TEXTURE_2D, textureV);
          glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
          glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
          glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
          glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
          glTexImage2D(
              GL_TEXTURE_2D,
              0,
              GL_LUMINANCE,
              width / 2,
              height / 2,
              0,
              GL_LUMINANCE,
              GL_UNSIGNED_BYTE,
              vVec.data()
          );

          // Map object IDs
          mapObject(exglObjId, textureY);
          mapObject(uPlaneObjId, textureU);
          mapObject(vPlaneObjId, textureV);
    });
}
 else {
        // RGBA fallback path (unchanged)
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
            return 0;
        }
        EXGLSysLog("Locked Hardware Buffer");
        addToNextBatch([=] {
            assert(objects.find(exglObjId) == objects.end());

            GLuint buffer;
            glGenTextures(1, &buffer);
            mapObject(exglObjId, buffer);

            glBindTexture(GL_TEXTURE_2D, buffer);
            glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
            glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
            glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_NEAREST);
            glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_NEAREST);

            glTexImage2D(
                GL_TEXTURE_2D,
                0,
                GL_RGBA,
                width,
                height,
                0,
                GL_RGBA,
                GL_UNSIGNED_BYTE,
                bufferData
            );

            AHardwareBuffer_unlock(hardwareBuffer, nullptr);
            AHardwareBuffer_release(hardwareBuffer);
        });
    }

    jsi::Value id = jsi::Value(static_cast<double>(exglObjId));
    jsi::Object webglObject = runtime.global()
        .getProperty(runtime, jsi::PropNameID::forUtf8(runtime, getConstructorName(EXWebGLClass::WebGLTexture)))
        .asObject(runtime)
        .asFunction(runtime)
        .callAsConstructor(runtime, {})
        .asObject(runtime);

    webglObject.setProperty(runtime, "id", id);

    EXGLSysLog("Done Upload Texture Func.");
    return static_cast<int>(exglObjId);
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
  EXGLSysLog("Map OBJ is called for obj id %d",exglObjId);
  objects[exglObjId] = glObj;
}

GLuint EXGLContext::lookupObject(EXGLObjectId exglObjId) noexcept {
  auto iter = objects.find(exglObjId);
  if(iter == objects.end()){
      EXGLSysLog("lookup for exglObjId %d failed.", exglObjId);
  }
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
