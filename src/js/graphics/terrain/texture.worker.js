self.onmessage = e => {
  const textureInfo = e.data
  fetch(textureInfo.filename)
    // TODO: Handle 404
    .then(response => response.blob())
    .then(blob => {
      if (typeof createImageBitmap === "function") {
        /*
      createImageBitmap(blob, { imageOrientation: 'flipY' }) is not supported on Firefox: missing parameters.
      createImageBitmap(blob) is supported on Firefox, but then gives flipped textures
      Chrome needs two flips (here and in texture initialization) to show textures correctly,
      so we cannot remove the flip in texture initialization. Therefore we need a flip here as well.
        */
        createImageBitmap(blob, 0, 0, textureInfo.size, textureInfo.size, { imageOrientation: "flipY" })
          .then(bitmap => self.postMessage([textureInfo.filename, bitmap, textureInfo.tileIndex]))
          .catch(err => {
            console.log("Error creating bitmap: " + textureInfo.filename + ", " + err)
          })
      } else {
        // Safari lacks createImageBitmap. Fallback: decode image in main thread instead
        self.postMessage([textureInfo.src, null, textureInfo.tileIndex])
      }
    })
    .catch(err => {
      console.log("Worker error: " + err)
    })
}
