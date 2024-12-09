#include "EXGLImageUtils.h"
#include "EXPlatformUtils.h"
#define STB_IMAGE_IMPLEMENTATION
#include "stb_image.h"

#ifdef __ANDROID__
#include <android/hardware_buffer_jni.h>
#include <android/log.h>

#endif

namespace jsi = facebook::jsi;

namespace expo {
namespace gl_cpp {

GLuint bytesPerPixel(GLenum type, GLenum format) {
  int bytesPerComponent = 0;
  switch (type) {
    case GL_UNSIGNED_BYTE:
      bytesPerComponent = 1;
      break;
    case GL_FLOAT:
      bytesPerComponent = 4;
      break;
    case GL_HALF_FLOAT:
      bytesPerComponent = 2;
      break;
    case GL_UNSIGNED_SHORT_5_6_5:
    case GL_UNSIGNED_SHORT_4_4_4_4:
    case GL_UNSIGNED_SHORT_5_5_5_1:
      return 2;
  }

  switch (format) {
    case GL_LUMINANCE:
    case GL_ALPHA:
      return 1 * bytesPerComponent;
    case GL_LUMINANCE_ALPHA:
      return 2 * bytesPerComponent;
    case GL_RGB:
      return 3 * bytesPerComponent;
    case GL_RGBA:
      return 4 * bytesPerComponent;
  }
  return 0;
}

void flipPixels(GLubyte *pixels, size_t bytesPerRow, size_t rows) {
  if (!pixels) {
    return;
  }

  GLuint middle = (GLuint)rows / 2;
  GLuint intsPerRow = (GLuint)bytesPerRow / sizeof(GLuint);
  GLuint remainingBytes = (GLuint)bytesPerRow - intsPerRow * sizeof(GLuint);

  for (GLuint rowTop = 0, rowBottom = (GLuint)rows - 1; rowTop < middle; ++rowTop, --rowBottom) {
    // Swap in packs of sizeof(GLuint) bytes
    GLuint *iTop = (GLuint *)(pixels + rowTop * bytesPerRow);
    GLuint *iBottom = (GLuint *)(pixels + rowBottom * bytesPerRow);
    GLuint iTmp;
    GLuint n = intsPerRow;
    do {
      iTmp = *iTop;
      *iTop++ = *iBottom;
      *iBottom++ = iTmp;
    } while (--n > 0);

    // Swap remainder bytes
    GLubyte *bTop = (GLubyte *)iTop;
    GLubyte *bBottom = (GLubyte *)iBottom;
    GLubyte bTmp;
    switch (remainingBytes) {
      case 3:
        bTmp = *bTop;
        *bTop++ = *bBottom;
        *bBottom++ = bTmp;
      case 2:
        bTmp = *bTop;
        *bTop++ = *bBottom;
        *bBottom++ = bTmp;
      case 1:
        bTmp = *bTop;
        *bTop = *bBottom;
        *bBottom = bTmp;
    }
  }
}

void decodeURI(char *dst, const char *src) {
  char a, b;
  while (*src) {
    if ((*src == '%') && ((a = src[1]) && (b = src[2])) && (isxdigit(a) && isxdigit(b))) {
      if (a >= 'a') {
        a -= 'a' - 'A';
      }
      if (a >= 'A') {
        a -= ('A' - 10);
      } else {
        a -= '0';
      }
      if (b >= 'a') {
        b -= 'a' - 'A';
      }
      if (b >= 'A') {
        b -= ('A' - 10);
      } else {
        b -= '0';
      }
      *dst++ = 16 * a + b;
      src += 3;
    } else if (*src == '+') {
      *dst++ = ' ';
      src++;
    } else {
      *dst++ = *src++;
    }
  }
  *dst++ = '\0';
}

std::shared_ptr<uint8_t> loadImage(
    jsi::Runtime &runtime,
    const jsi::Object &jsPixels,
    int *fileWidth,
    int *fileHeight,
    int *fileComp) {
  auto localUriProp = jsPixels.getProperty(runtime, "localUri");
  if (localUriProp.isString()) {
    auto localUri = localUriProp.asString(runtime).utf8(runtime);
    if (strncmp(localUri.c_str(), "file://", 7) != 0) {
      return std::shared_ptr<uint8_t>(nullptr);
    }
    char localPath[localUri.size()];
    decodeURI(localPath, localUri.c_str() + 7);

    return std::shared_ptr<uint8_t>(
        stbi_load(localPath, fileWidth, fileHeight, fileComp, STBI_rgb_alpha),
        [](void *data) { stbi_image_free(data); });
  }
  return std::shared_ptr<uint8_t>(nullptr);
}

bool FillAHardwareBufferWithCheckerboard(
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

    AHardwareBuffer_unlock(nativeBuffer, nullptr);
    EXGLSysLog("Checkerboard pattern written to hardware buffer");

    return true;
}
} // namespace gl_cpp
} // namespace expo
