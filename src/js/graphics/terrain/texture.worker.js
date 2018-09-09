self.onmessage = e => {
  const textureInfo = e.data

  if (navigator.userAgent.includes("Safari") && !navigator.userAgent.includes("Chrome")) {
    // Safari lacks createImageBitmap. Fallback: decode image in main thread instead
    self.postMessage([textureInfo.filename, null, textureInfo.tileIndex])
  } else {
    fetch(textureInfo.filename, { mode: "cors" })
      // TODO: Handle 404
      .then(response => response.blob())
      .then(blob => {
        /*
        createImageBitmap(blob)
          supported on Firefox
          gives flipped textures in Chrome, independent of 
            gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true) also is called or not!

        createImageBitmap(blob, { imageOrientation: 'flipY' })
          is supported on Chrome
          is not supported on Firefox, height and width parameteres must be provided.

        createImageBitmap(blob, 0, 0, textureInfo.size, textureInfo.size, { imageOrientation: "flipY" })
          is the only thing that works on chrome and firefox and gives right results

        all variants of createImageBitmap (as above)
          give typeerror in safari TP 64 (safari 12.1)

        */
        createImageBitmap(blob, 0, 0, textureInfo.size, textureInfo.size, { imageOrientation: "flipY" })
          .then(bitmap => self.postMessage([textureInfo.filename, bitmap, textureInfo.tileIndex]))
          .catch(err => {
            console.log("Error creating bitmap: " + textureInfo.filename + ", " + err)
          })
      })
      .catch(err => {
        console.log("Worker error: " + err)
      })
  }
}
