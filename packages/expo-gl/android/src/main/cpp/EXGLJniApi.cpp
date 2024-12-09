#include <stdint.h>

#include <jni.h>
#include <thread>
#include <android/log.h>
#include <android/hardware_buffer_jni.h>
#include <jsi/jsi.h>
#include "EXGLNativeApi.h"
#include "EXPlatformUtils.h"
#include <stdio.h>
#include "EXGLImageUtils.h"
extern "C" {

// JNIEnv is valid only inside the same thread that it was passed from
// to support worklet we need register it from UI thread
thread_local JNIEnv* threadLocalEnv;

JNIEXPORT jint JNICALL
Java_expo_modules_gl_cpp_EXGL_EXGLContextCreate
(JNIEnv *env, jclass clazz) {
  return EXGLContextCreate();
}

JNIEXPORT void JNICALL
Java_expo_modules_gl_cpp_EXGL_EXGLContextPrepare
(JNIEnv *env, jclass clazz, jlong jsiPtr, jint exglCtxId, jobject glContext) {
  threadLocalEnv = env;
  jclass GLContextClass = env->GetObjectClass(glContext);
  jobject glContextRef = env->NewGlobalRef(glContext);
  jmethodID flushMethodRef = env->GetMethodID(GLContextClass, "flush", "()V");

  std::function<void(void)> flushMethod = [glContextRef, flushMethodRef] {
    threadLocalEnv->CallVoidMethod(glContextRef, flushMethodRef);
  };
  EXGLContextPrepare((void*) jsiPtr, exglCtxId, flushMethod);
}

JNIEXPORT void JNICALL
Java_expo_modules_gl_cpp_EXGL_EXGLContextPrepareWorklet
(JNIEnv *env, jclass clazz, jint exglCtxId) {
  threadLocalEnv = env;
  EXGLContextPrepareWorklet(exglCtxId);
}

JNIEXPORT void JNICALL
Java_expo_modules_gl_cpp_EXGL_EXGLContextDestroy
(JNIEnv *env, jclass clazz, jint exglCtxId) {
  EXGLContextDestroy(exglCtxId);
}

JNIEXPORT void JNICALL
Java_expo_modules_gl_cpp_EXGL_EXGLContextFlush
(JNIEnv *env, jclass clazz, jint exglCtxId) {
  EXGLContextFlush(exglCtxId);
}

JNIEXPORT jint JNICALL
Java_expo_modules_gl_cpp_EXGL_EXGLContextCreateObject
(JNIEnv *env, jclass clazz, jint exglCtxId) {
  return EXGLContextCreateObject(exglCtxId);
}

JNIEXPORT void JNICALL
Java_expo_modules_gl_cpp_EXGL_EXGLContextDestroyObject
(JNIEnv *env, jclass clazz, jint exglCtxId, jint exglObjId) {
  EXGLContextDestroyObject(exglCtxId, exglObjId);
}

JNIEXPORT void JNICALL
Java_expo_modules_gl_cpp_EXGL_EXGLContextMapObject
(JNIEnv *env, jclass clazz, jint exglCtxId, jint exglObjId, jint glObj) {
  EXGLContextMapObject(exglCtxId, exglObjId, glObj);
}

JNIEXPORT jint JNICALL
Java_expo_modules_gl_cpp_EXGL_EXGLContextGetObject
(JNIEnv *env, jclass clazz, jint exglCtxId, jint exglObjId) {
  return EXGLContextGetObject(exglCtxId, exglObjId);
}

JNIEXPORT bool JNICALL
Java_expo_modules_gl_cpp_EXGL_EXGLContextNeedsRedraw
(JNIEnv *env, jclass clazz, jint exglCtxId) {
  return EXGLContextNeedsRedraw(exglCtxId);
}

JNIEXPORT void JNICALL
Java_expo_modules_gl_cpp_EXGL_EXGLContextDrawEnded
(JNIEnv *env, jclass clazz, jint exglCtxId) {
  EXGLContextDrawEnded(exglCtxId);
}

#if __ANDROID_API__ >= 26
JNIEXPORT jint JNICALL
Java_expo_modules_gl_cpp_EXGL_EXGLContextUploadTexture(
    JNIEnv *env,
    jclass clazz,
    jlong jsiPtr,
    jint exglCtxId,
    jlong hardwareBuffer) 
{
    if (hardwareBuffer == 0) {
        __android_log_print(ANDROID_LOG_ERROR, "EXGLJni", "HardwareBuffer pointer is null");
        return 0;
    }

    __android_log_print(ANDROID_LOG_ERROR, "EXGLJni", "Jlong Pointer: %lld", hardwareBuffer);

    // Cast jlong to AHardwareBuffer*
    AHardwareBuffer *nativeBuffer = reinterpret_cast<AHardwareBuffer *>(hardwareBuffer);
    __android_log_print(ANDROID_LOG_ERROR, "EXGLJni", "Post cast pointer: %p", nativeBuffer);

    if (nativeBuffer == nullptr) {
        __android_log_print(ANDROID_LOG_ERROR, "EXGLJni", "Failed to cast jlong to AHardwareBuffer*");
        return 0;
    }

    AHardwareBuffer_Desc desc;
    AHardwareBuffer_describe(nativeBuffer, &desc);
    __android_log_print(ANDROID_LOG_INFO, "EXGLJni",
                        "HardwareBuffer details: width=%u, height=%u, layers=%u, format=%u",
                        desc.width, desc.height, desc.layers, desc.format);

    int exlObj = EXGLContextUploadTexture(reinterpret_cast<void *>(jsiPtr), exglCtxId, nativeBuffer);
    __android_log_print(ANDROID_LOG_INFO, "EXGLJni", "Uploaded texture %d", exlObj);
    return exlObj;
}

JNIEXPORT jlong JNICALL
Java_expo_modules_gl_cpp_EXGL_EXGLContextCreateTestHardwareBuffer(
    JNIEnv *env,
    jclass clazz) 
{
    // Create the AHardwareBuffer description
    AHardwareBuffer_Desc desc = {};
    desc.width = 256; 
    desc.height = 256; 
    desc.layers = 1; 
    desc.format = AHARDWAREBUFFER_FORMAT_R8G8B8A8_UNORM; 
    desc.usage = AHARDWAREBUFFER_USAGE_GPU_SAMPLED_IMAGE | AHARDWAREBUFFER_USAGE_CPU_WRITE_RARELY; 

    // Create the hardware buffer
    AHardwareBuffer *hardwareBuffer = nullptr;
    int result = AHardwareBuffer_allocate(&desc, &hardwareBuffer);
    
    if (result != 0 || hardwareBuffer == nullptr) {
        __android_log_print(ANDROID_LOG_ERROR, "EXGLJni", 
                            "Failed to create AHardwareBuffer: %d", result);
        return 0; // Return 0 to indicate failure
    }

    __android_log_print(ANDROID_LOG_INFO, "EXGLJni", "Successfully created AHardwareBuffer");
    uint32_t red = 0xFF0000FF;   // Solid red (RGBA)
    uint32_t white = 0xFFFFFFFF; // Solid white (RGBA)
    uint32_t squareSize = 32;     // 8x8 pixels per square
    
    //Todo: Check if this hb gets deleted at the end to avoid memory leaks.
    AHardwareBuffer_acquire(hardwareBuffer); // Add another reference (ref count +1)

    // Fill the hardware buffer with a checkerboard pattern
    if (expo::gl_cpp::FillAHardwareBufferWithCheckerboard(hardwareBuffer, red, white, squareSize)) {
        EXGLSysLog("Success, colored");
    } else {
        EXGLSysLog("Failed to fill hardware buffer");
    }
      uintptr_t pointer = reinterpret_cast<uintptr_t>(hardwareBuffer);
    __android_log_print(ANDROID_LOG_ERROR, "EXGLJni", "Pointer to be sent: %p", hardwareBuffer);
    __android_log_print(ANDROID_LOG_ERROR, "EXGLJni", "Pointer (64-bit unsigned): %llu", (unsigned long long) pointer);
    
    // Return the pointer as a jlong
    return (jlong) pointer; 
}

#else

JNIEXPORT void JNICALL
Java_expo_modules_gl_cpp_EXGL_EXGLContextUploadTexture(
    JNIEnv *env,
    jclass clazz,
    jint exglCtxId,
    jobject hardwareBuffer
    ) {
    __android_log_print(ANDROID_LOG_ERROR, "GLContext", "AHardwareBuffer not supported on this API level.");
}
#endif
}

