#include "EXGLNativeApi.h"
#include "EXGLContextManager.h"
#include "EXGLNativeContext.h"

using namespace expo::gl_cpp;


EXGLContextId EXGLContextCreate() {
  return ContextCreate();
}

void EXGLContextPrepare(
    void *jsiPtr,
    EXGLContextId exglCtxId,
    std::function<void(void)> flushMethod) {
  auto [exglCtx, lock] = ContextGet(exglCtxId);
  if (exglCtx) {
    exglCtx->prepareContext(*reinterpret_cast<jsi::Runtime *>(jsiPtr), flushMethod);
  }
}
EXGLObjectId EXGLContextUploadTexture(void *jsiPtr, EXGLContextId exglCtxId, AHardwareBuffer *hardwareBuffer) {
  // Get the context and lock it
  EXGLObjectId textureId = 0;
  auto [exglCtx, lock] = ContextGet(exglCtxId);
  __android_log_print(ANDROID_LOG_INFO, "EXGLNativeApi", "Context Upload Texture was called.");

  if (exglCtx) {
    __android_log_print(ANDROID_LOG_INFO, "EXGLNativeApi", "Executing uploadTextureToOpenGL.");

    // Call uploadTextureToOpenGL and capture the texture ID
    textureId = exglCtx->uploadTextureToOpenGL(*reinterpret_cast<jsi::Runtime *>(jsiPtr), hardwareBuffer);

    // Log the texture ID
    __android_log_print(ANDROID_LOG_INFO, "EXGLNativeApi", "Texture ID created: %d", textureId);

  } else {
    __android_log_print(ANDROID_LOG_INFO, "EXGLNativeApi", "Context Upload Texture Failed.");
  }
  return textureId;
}


void EXGLContextPrepareWorklet(EXGLContextId exglCtxId) {
  auto [exglCtx, lock] = ContextGet(exglCtxId);
  if (exglCtx) {
    exglCtx->prepareWorkletContext();
  }
}

bool EXGLContextNeedsRedraw(EXGLContextId exglCtxId) {
  auto [exglCtx, lock] = ContextGet(exglCtxId);
  if (exglCtx) {
    return exglCtx->needsRedraw;
  }
  return false;
}

void EXGLContextDrawEnded(EXGLContextId exglCtxId) {
  auto [exglCtx, lock] = ContextGet(exglCtxId);
  if (exglCtx) {
    exglCtx->needsRedraw = false;
  }
}

void EXGLContextDestroy(EXGLContextId exglCtxId) {
  ContextDestroy(exglCtxId);
}

void EXGLContextFlush(EXGLContextId exglCtxId) {
  auto [exglCtx, lock] = ContextGet(exglCtxId);
  if (exglCtx) {
    exglCtx->flush();
  }
}

void EXGLContextSetDefaultFramebuffer(EXGLContextId exglCtxId, GLint framebuffer) {
  auto [exglCtx, lock] = ContextGet(exglCtxId);
  if (exglCtx) {
    exglCtx->defaultFramebuffer = framebuffer;
  }
}

EXGLObjectId EXGLContextCreateObject(EXGLContextId exglCtxId) {
  auto [exglCtx, lock] = ContextGet(exglCtxId);
  if (exglCtx) {
    return exglCtx->createObject();
  }
  return 0;
}

void EXGLContextDestroyObject(EXGLContextId exglCtxId, EXGLObjectId exglObjId) {
  auto [exglCtx, lock] = ContextGet(exglCtxId);
  if (exglCtx) {
    exglCtx->destroyObject(exglObjId);
  }
}

void EXGLContextMapObject(EXGLContextId exglCtxId, EXGLObjectId exglObjId, GLuint glObj) {
  auto [exglCtx, lock] = ContextGet(exglCtxId);
  if (exglCtx) {
    exglCtx->mapObject(exglObjId, glObj);
  }
}

GLuint EXGLContextGetObject(EXGLContextId exglCtxId, EXGLObjectId exglObjId) {
  auto [exglCtx, lock] = ContextGet(exglCtxId);
  if (exglCtx) {
    return exglCtx->lookupObject(exglObjId);
  }
  return 0;
}
