#include <stdint.h>

#include <jni.h>
#include <thread>
#include <android/log.h>
#include <android/hardware_buffer_jni.h>
#include <jsi/jsi.h>
#include "EXGLNativeApi.h"
#include "EXPlatformUtils.h"
#include <stdio.h>

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
JNIEXPORT void JNICALL
Java_expo_modules_gl_cpp_EXGL_EXGLContextUploadTexture(
    JNIEnv *env,
    jclass clazz,
    jint exglCtxId,
    jobject hardwareBuffer) {

    if (hardwareBuffer == nullptr) {
        __android_log_print(ANDROID_LOG_ERROR, "EXGLJni", "HardwareBuffer is null");
        return;
    }

    // Convert jobject to AHardwareBuffer*
    AHardwareBuffer *nativeBuffer = AHardwareBuffer_fromHardwareBuffer(env, hardwareBuffer);
    if (nativeBuffer == nullptr) {
        __android_log_print(ANDROID_LOG_ERROR, "EXGLJni", "Failed to convert HardwareBuffer to native AHardwareBuffer");
        return;
    }

    // Describe the HardwareBuffer to get its dimensions
    AHardwareBuffer_Desc desc;
    AHardwareBuffer_describe(nativeBuffer, &desc);

    // Log the dimensions and other details of the HardwareBuffer
    __android_log_print(ANDROID_LOG_INFO, "EXGLJni",
                        "HardwareBuffer details: width=%u, height=%u, layers=%u, format=%u, usage=0x%llx",
                        desc.width, desc.height, desc.layers, desc.format, (unsigned long long)desc.usage);

    // Pass the native buffer to the EXGLContextUploadTexture function
    EXGLContextUploadTexture(exglCtxId, nativeBuffer);

    // Release the native buffer after use
    AHardwareBuffer_release(nativeBuffer);
    __android_log_print(ANDROID_LOG_INFO, "EXGLJni", "Uploaded texture and released HardwareBuffer.");
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

