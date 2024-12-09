// Copyright 2017-present 650 Industries. All rights reserved.
package expo.modules.gl

import android.os.Bundle
import android.util.SparseArray
import android.view.View
import expo.modules.interfaces.camera.CameraViewInterface
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import android.graphics.*
import android.hardware.HardwareBuffer
import android.util.Log
import java.nio.ByteBuffer
import expo.modules.gl.cpp.EXGL.*

private class InvalidCameraViewException :
  CodedException("Provided view tag doesn't point to a valid instance of the camera view")

private class InvalidGLContextException :
  CodedException("GLContext not found for the given context ID")

class GLObjectManagerModule : Module() {
  private val mGLObjects = SparseArray<GLObject>()
  private val mGLContextMap = SparseArray<GLContext>()

  override fun definition() = ModuleDefinition {
    Name("ExponentGLObjectManager")

    AsyncFunction("destroyObjectAsync") { exglObjId: Int ->
      val glObject = mGLObjects[exglObjId]
        ?: return@AsyncFunction false

      mGLObjects.remove(exglObjId)
      glObject.destroy()
      true
    }

    AsyncFunction("createCameraTextureAsync") { exglCtxId: Int, cameraViewTag: Int, promise: Promise ->
      val cameraView = appContext.findView<View>(cameraViewTag) as? CameraViewInterface
        ?: throw InvalidCameraViewException()

      val glContext = getContextWithId(exglCtxId)
        ?: throw InvalidGLContextException()

      glContext.runAsync {
        val cameraTexture = GLCameraObject(glContext, cameraView)
        val exglObjId = cameraTexture.getEXGLObjId()
        mGLObjects.put(exglObjId, cameraTexture)
        val response = Bundle()
        response.putInt("exglObjId", exglObjId)
        promise.resolve(response)
      }
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("takeSnapshotAsync") { exglCtxId: Int, options: Map<String, Any?>, promise: Promise ->
      val context = appContext.reactContext
        ?: throw Exceptions.ReactContextLost()

      val glContext = getContextWithId(exglCtxId)
        ?: throw InvalidGLContextException()

      glContext.takeSnapshot(options, context, promise)
    }

    AsyncFunction("createContextAsync") { promise: Promise ->
      val glContext = GLContext(this@GLObjectManagerModule)
      glContext.initialize(null, false) {
        val results = Bundle()
        results.putInt("exglCtxId", glContext.contextId)
        promise.resolve(results)
        Log.i("GLObjectManagerModule", "GL context created with ID: ${glContext.contextId}")
        saveContext(glContext)
      }
    }

    AsyncFunction("destroyContextAsync") { exglCtxId: Int ->
      val glContext = getContextWithId(exglCtxId)
        ?: return@AsyncFunction false

      Log.i("GLObjectManagerModule", "Destroying GL context with ID: $exglCtxId")
      glContext.destroy()
      deleteContextWithId(exglCtxId)
      true
    }

    AsyncFunction("uploadAHardwareBufferAsync") { exglCtxId: Int, pointerString: String, promise: Promise ->
      val context = mGLContextMap[exglCtxId]
        ?: throw InvalidGLContextException()
      Log.i("GLObjectManagerModule","Calling push texture from native buffer")
      // Convert the hex string back to a ULong, then to a signed jlong
      val pointer = pointerString.toULong(16).toLong()
      
      Log.i("GLObjectManagerModule", "Reconstructed Pointer from string: $pointer (hex: 0x" + pointer.toULong().toString(16) + ")")
      val exglObjId = context.push_texture_from_native_buffer(pointer)
      promise.resolve(exglObjId)
    }

    AsyncFunction("createAHardwareBufferAsync") {promise: Promise ->
      // Call the JNI method to create a hardware buffer
      val pointer = EXGLContextCreateTestHardwareBuffer()
      
      // Cast to unsigned to avoid negative numbers
      val unsignedPointer = pointer.toULong() // Cast to unsigned 64-bit long
      val pointerHex = unsignedPointer.toString(16) // Convert to hex string

      Log.i("GLObjectManagerModule","Pointer as unsigned (ULong): $unsignedPointer .")
      Log.i("GLObjectManagerModule","Pointer in hexadecimal: 0x$pointerHex")

      val response = Bundle()
      response.putLong("pointer", pointer)
      promise.resolve(response)
    }
  }

  private fun getContextWithId(exglCtxId: Int): GLContext? {
    return mGLContextMap[exglCtxId]
  }

  fun saveContext(glContext: GLContext) {
    Log.i("GLObjectManagerModule", "Saving GL context with ID: ${glContext.contextId}")
    mGLContextMap.put(glContext.contextId, glContext)
  }

  fun deleteContextWithId(exglCtxId: Int) {
    Log.i("GLObjectManagerModule", "Deleting GL context with ID: $exglCtxId")
    mGLContextMap.delete(exglCtxId)
  }
}
