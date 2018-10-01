self.onmessage = e => {
  const textureInfo = e.data

  const isEdge = navigator.userAgent.includes("Edge")
  const isSafari = navigator.userAgent.includes("Safari") && !navigator.userAgent.includes("Chrome")
  if (isEdge || isSafari) {
    // Edge lacks createImageBitmap.
    // On Safari, if implemented, the implementation is buggy.
    // For these two, use fallback: Decode image in main thread instead
    // We cannot use feature detection since on Safari the implementation might exist but if so, is buggy.
    // Thus we would have gotten a false positive.
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
          is the only thing that works on Chrome and Firefox and gives right results

        all variants of createImageBitmap (as above) give typeerror in safari TP 64 (safari 12.1)

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
