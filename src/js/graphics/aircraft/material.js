import { gl } from "../gl.js"

export default class Material {
  constructor(path, name) {
    this.name = name
    this.path = path
    this.textureFile = null
    this.texture = gl.createTexture()
    this.isLoaded = false
  }

  loadTexture(textureFile) {
    console.log("Loading material texture " + this.name)
    this.textureFile = textureFile
    let img = new Image()
    img.onload = e => {
      this.isLoaded = true
      console.log("Loaded material texture " + this.name + ", now initializing")
      let alpha
      this.initializeTexture(img)
    }
    img.src = this.path + textureFile
  }

  initializeTexture(image) {
    gl.bindTexture(gl.TEXTURE_2D, this.texture)

    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, image)

    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
    gl.generateMipmap(gl.TEXTURE_2D)

    gl.bindTexture(gl.TEXTURE_2D, null)
    image = null
  }
}
