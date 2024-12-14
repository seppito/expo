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

int EXGLContext::uploadTextureToOpenGL(jsi::Runtime &runtime, AHardwareBuffer *hardwareBuffer) {
    EXGLSysLog("Reached Upload TExture to OpenGL");

    // Create a new EXGL object ID
    auto exglObjId = createObject();

    // Acquire the hardware buffer to increment its reference count
    AHardwareBuffer_acquire(hardwareBuffer);
    EXGLSysLog("After adquire ");

    AHardwareBuffer_Desc desc = {};
    AHardwareBuffer_describe(hardwareBuffer, &desc);
    EXGLSysLog("After desc ");

    if (desc.format != AHARDWAREBUFFER_FORMAT_R8G8B8A8_UNORM && desc.format != AHARDWAREBUFFER_FORMAT_Y8Cb8Cr8_420) {
        EXGLSysLog("Unsupported hardware buffer format %d" , desc.format);
        AHardwareBuffer_release(hardwareBuffer);
        return 0;
    }
    EXGLSysLog("After Desc if");

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
        return 0; // Return 0 to indicate an error
    }
    EXGLSysLog("Locked Hardware Buffer");

    if ( desc.format == AHARDWAREBUFFER_FORMAT_Y8Cb8Cr8_420){
        EXGLSysLog("AHARDWAREBUFFER_FORMAT_Y8Cb8Cr8_420");
        int yPlaneSize = width * height;
        int uvPlaneSize = (width / 2) * (height / 2); // U and V planes are subsample

        // Extract the Y, U, V data from the buffer
        uint8_t* yPlane = (uint8_t*)bufferData;
        uint8_t* uPlane = yPlane + yPlaneSize;
        uint8_t* vPlane = uPlane + uvPlaneSize;


        addToNextBatch([=] {
          assert(objects.find(exglObjId) == objects.end());
            const char *vertexShaderSource = R"(
                precision mediump float; // Required for OpenGL ES
                attribute vec4 a_position;
                attribute vec2 a_texCoord;
                varying vec2 vTexCoord;
                void main() {
                    gl_Position = a_position;
                    vTexCoord = a_texCoord;
                }
            )";

            // Fragment Shader source code (YUV to RGB)
            const char *fragmentShaderSource = R"(
                precision mediump float;
                uniform sampler2D s_texture_y;
                uniform sampler2D s_texture_u;
                uniform sampler2D s_texture_v;
                uniform float qt_Opacity;
                varying vec2 vTexCoord;

                void main() {
                    float Y = texture2D(s_texture_y, vTexCoord).r;
                    float U = texture2D(s_texture_u, vTexCoord * 0.5).r - 0.5;
                    float V = texture2D(s_texture_v, vTexCoord * 0.5).r - 0.5;
                    vec3 color = vec3(Y, U, V);
                    mat3 colorMatrix = mat3(
                        1,   0,      1.402,
                        1,  -0.344, -0.714,
                        1,   1.772,  0
                    );
                    vec3 rgb = color * colorMatrix;
                    gl_FragColor = vec4(rgb, 1.0) * qt_Opacity;
                }
            )";
        
           // Compile vertex shader
          GLuint vertexShader = glCreateShader(GL_VERTEX_SHADER);
          glShaderSource(vertexShader, 1, &vertexShaderSource, nullptr);
          glCompileShader(vertexShader);
          
          // Check for compile errors in vertex shader
          //GLint success;
          //glGetShaderiv(vertexShader, GL_COMPILE_STATUS, &success);

          /*
          if (!success) {
              char infoLog[512];
              glGetShaderInfoLog(vertexShader, 512, nullptr, infoLog);
              EXGLSysLog("Vertex shader compilation failed: %s", infoLog);
              return 0;
          }
          
          */
          // Compile fragment shader
          GLuint fragmentShader = glCreateShader(GL_FRAGMENT_SHADER);
          glShaderSource(fragmentShader, 1, &fragmentShaderSource, nullptr);
          glCompileShader(fragmentShader);
          
          // Link shaders into a shader program
          GLuint defaultProgram = glCreateProgram();
          glAttachShader(defaultProgram, vertexShader);
          glAttachShader(defaultProgram, fragmentShader);
          glLinkProgram(defaultProgram);

          // Delete shaders (they are no longer needed after linking)
          glDeleteShader(vertexShader);
          glDeleteShader(fragmentShader);
          EXGLSysLog("Defult program is done executing.");
          
          // Check for link errors in shader program
          // Delete shaders (they are no longer needed after linking)
          glDeleteShader(vertexShader);
          glDeleteShader(fragmentShader);

          GLuint textures[3];
          
          glGenTextures(3, textures);

          // Upload Y plane
          glBindTexture(GL_TEXTURE_2D, textures[0]);
          glTexImage2D(GL_TEXTURE_2D, 0, GL_LUMINANCE, width, height, 0, GL_LUMINANCE, GL_UNSIGNED_BYTE, yPlane);

          // Upload U plane
          glBindTexture(GL_TEXTURE_2D, textures[1]);
          glTexImage2D(GL_TEXTURE_2D, 0, GL_LUMINANCE, width / 2, height / 2, 0, GL_LUMINANCE, GL_UNSIGNED_BYTE, uPlane);

          // Upload V plane
          glBindTexture(GL_TEXTURE_2D, textures[2]);
          glTexImage2D(GL_TEXTURE_2D, 0, GL_LUMINANCE, width / 2, height / 2, 0, GL_LUMINANCE, GL_UNSIGNED_BYTE, vPlane);
          
          // Unlock the hardware buffer
          AHardwareBuffer_unlock(hardwareBuffer, nullptr);
          
          // Release the hardware buffer
          AHardwareBuffer_release(hardwareBuffer);

          // start of shader section :
          EXGLSysLog("Pre Frame Buffer");

          GLuint framebuffer, rgbTexture;
          glGenFramebuffers(1, &framebuffer);
          glBindFramebuffer(GL_FRAMEBUFFER, framebuffer);

          // Create the final RGB texture to store the output
          glGenTextures(1, &rgbTexture);
          glBindTexture(GL_TEXTURE_2D, rgbTexture);
          glTexImage2D(GL_TEXTURE_2D, 0, GL_RGBA, width, height, 0, GL_RGBA, GL_UNSIGNED_BYTE, nullptr);
          glFramebufferTexture2D(GL_FRAMEBUFFER, GL_COLOR_ATTACHMENT0, GL_TEXTURE_2D, rgbTexture, 0);

          // Use the shader program
          glUseProgram(defaultProgram);
// start of shader section :
          EXGLSysLog("use the default program.");
          // Set shader uniforms
          glActiveTexture(GL_TEXTURE0);
          glBindTexture(GL_TEXTURE_2D, textures[0]); // Y plane
          glUniform1i(glGetUniformLocation(defaultProgram, "s_texture_y"), 0);

          glActiveTexture(GL_TEXTURE1);
          glBindTexture(GL_TEXTURE_2D, textures[1]); // U plane
          glUniform1i(glGetUniformLocation(defaultProgram, "s_texture_u"), 1);

          glActiveTexture(GL_TEXTURE2);
          glBindTexture(GL_TEXTURE_2D, textures[2]); // V plane
          glUniform1i(glGetUniformLocation(defaultProgram, "s_texture_v"), 2);

          // Set opacity
          glUniform1f(glGetUniformLocation(defaultProgram, "qt_Opacity"), 1.0f);

          // Draw the quad
          glBindFramebuffer(GL_FRAMEBUFFER, framebuffer);
          glViewport(0, 0, width, height);

          // Draw a quad to trigger the shader for each pixel
          glDrawArrays(GL_TRIANGLE_STRIP, 0, 4);
          EXGLSysLog("Default Frame Buffer is %d",defaultFramebuffer);

          glBindFramebuffer(GL_FRAMEBUFFER, defaultFramebuffer);
          glDeleteFramebuffers(1, &framebuffer);

          // Clean up textures
          glDeleteTextures(3, textures);
          
          // Map the OpenGL texture to the EXGL object
          mapObject(exglObjId, rgbTexture);
          EXGLSysLog("Reached the end of the GL Call in the context " );

        });
        
    } else {
      addToNextBatch([=] {
        assert(objects.find(exglObjId) == objects.end());

        // Generate the OpenGL texture
        GLuint buffer;
        glGenTextures(1, &buffer);
        mapObject(exglObjId, buffer);

        glBindTexture(GL_TEXTURE_2D, buffer);

        // Set texture parameters
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
        // Unlock the hardware buffer
        AHardwareBuffer_unlock(hardwareBuffer, nullptr);

        // Release the hardware buffer
        AHardwareBuffer_release(hardwareBuffer);
    });
    }
   
    // Create WebGL object
    jsi::Value id = jsi::Value(static_cast<double>(exglObjId));

    // Create a new WebGLTexture object in JavaScript
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
