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
        int32_t lock_result = AHardwareBuffer_lockPlanes(hardwareBuffer, AHARDWAREBUFFER_USAGE_CPU_READ_OFTEN, -1, nullptr, &planes);

        if (lock_result != 0) {
            EXGLSysLog("Failed to lock AHardwareBuffer");
            AHardwareBuffer_release(hardwareBuffer);
            return 0;
        }

        void *yPlane = planes.planes[0].data;
        void *uPlane = planes.planes[1].data;
        void *vPlane = planes.planes[2].data;

        int yStride = planes.planes[0].rowStride;
        int uStride = planes.planes[1].rowStride;
        int vStride = planes.planes[2].rowStride;
        const char *vertexShaderSource = R"(
            precision mediump float;
            attribute vec4 a_position;
            attribute vec2 a_texCoord;
            varying vec2 v_texCoord;

            void main() {
                gl_Position = a_position;
                v_texCoord = a_texCoord;
            }
        )";

        const char *fragmentShaderSource = R"(
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
        )";
        
        addToNextBatch([=] {
            EXGLSysLog("Inside GL batch operation.");

            GLuint textureY, textureU, textureV;
            glGenTextures(1, &textureY);
            glGenTextures(1, &textureU);
            glGenTextures(1, &textureV);

            glActiveTexture(GL_TEXTURE0);
            glBindTexture(GL_TEXTURE_2D, textureY);
            glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
            glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
            glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
            glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
            glTexImage2D(GL_TEXTURE_2D, 0, GL_LUMINANCE, width, height, 0, GL_LUMINANCE, GL_UNSIGNED_BYTE, yPlane);

            glActiveTexture(GL_TEXTURE1);
            glBindTexture(GL_TEXTURE_2D, textureU);
            glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
            glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
            glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
            glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
            glTexImage2D(GL_TEXTURE_2D, 0, GL_LUMINANCE, width / 2, height / 2, 0, GL_LUMINANCE, GL_UNSIGNED_BYTE, uPlane);

            glActiveTexture(GL_TEXTURE2);
            glBindTexture(GL_TEXTURE_2D, textureV);
            glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MIN_FILTER, GL_LINEAR);
            glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_MAG_FILTER, GL_LINEAR);
            glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_S, GL_CLAMP_TO_EDGE);
            glTexParameteri(GL_TEXTURE_2D, GL_TEXTURE_WRAP_T, GL_CLAMP_TO_EDGE);
            glTexImage2D(GL_TEXTURE_2D, 0, GL_LUMINANCE, width / 2, height / 2, 0, GL_LUMINANCE, GL_UNSIGNED_BYTE, vPlane);

            // Compile shaders and create program
            GLuint vertexShader = compileShader(GL_VERTEX_SHADER, vertexShaderSource, "Vertex Shader");
            GLuint fragmentShader = compileShader(GL_FRAGMENT_SHADER, fragmentShaderSource, "Fragment Shader");
            GLuint defaultProgram = createProgram(vertexShader, fragmentShader);
            glDeleteShader(vertexShader);
            glDeleteShader(fragmentShader);

            checkGLError("Post Shader Compilation");
             // Bind textures to the shader program
            GLint locY = glGetUniformLocation(defaultProgram, "y_texture");
            glUniform1i(locY, 0);
            GLint locU = glGetUniformLocation(defaultProgram, "u_texture");
            glUniform1i(locU, 1);
            GLint locV = glGetUniformLocation(defaultProgram, "v_texture");
            glUniform1i(locV, 2);

            // Set up vertex attributes for position and texture coordinates
            GLint a_position = glGetAttribLocation(defaultProgram, "a_position");
            glEnableVertexAttribArray(a_position);
            glVertexAttribPointer(a_position, 2, GL_FLOAT, GL_FALSE, 4 * sizeof(float), (void *)0);

            GLint a_texCoord = glGetAttribLocation(defaultProgram, "a_texCoord");
            glEnableVertexAttribArray(a_texCoord);
            glVertexAttribPointer(a_texCoord, 2, GL_FLOAT, GL_FALSE, 4 * sizeof(float), (void *)(2 * sizeof(float)));
            checkGLError("Post Shader Compilation");

            GLuint framebuffer,rgbTexture;
            glGenFramebuffers(1, &framebuffer);
            glBindFramebuffer(GL_FRAMEBUFFER, framebuffer);

            glGenTextures(1, &rgbTexture);
            glBindTexture(GL_TEXTURE_2D, rgbTexture);
            glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, width, height, 0, GL_RGBA, GL_UNSIGNED_BYTE, nullptr);
            glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, rgbTexture, 0);
            checkFramebufferStatus();
            
            glViewport(0, 0, width, height);

            float vertices[] = {
                -1.0f, -1.0f, 0.0f, 0.0f,
                 1.0f, -1.0f, 1.0f, 0.0f,
                -1.0f,  1.0f, 0.0f, 1.0f,
                 1.0f,  1.0f, 1.0f, 1.0f
            };

            GLuint vbo;
            glGenBuffers(1, &vbo);
            glBindBuffer(GL_ARRAY_BUFFER, vbo);
            glBufferData(GL_ARRAY_BUFFER, sizeof(vertices), vertices, GL_STATIC_DRAW);

            glEnableVertexAttribArray(a_texCoord);
            glVertexAttribPointer(a_texCoord, 2, GL_FLOAT, GL_FALSE, 4 * sizeof(float), (void*)(2 * sizeof(float)));

            glDrawArrays(GL_TRIANGLE_STRIP, 0, 4);

            unsigned char pixel[4] = {0};
            glReadPixels(0, 0, 1, 1, GL_RGBA, GL_UNSIGNED_BYTE, pixel);
            EXGLSysLog("Pixel after draw: R=%d G=%d B=%d A=%d", pixel[0], pixel[1], pixel[2], pixel[3]);
            glBindFramebuffer(GL_FRAMEBUFFER, 0);
            glDeleteFramebuffers(1, &framebuffer);
            glDeleteBuffers(1, &vbo);

            mapObject(exglObjId, rgbTexture);
            AHardwareBuffer_unlock(hardwareBuffer, nullptr);
            AHardwareBuffer_release(hardwareBuffer);
        });

    } else {
        // RGBA fallback path (unchanged)
        int width = desc.width;
        int height = desc.height;
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
