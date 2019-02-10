import { gl } from "../gl.js"

export default class TileRenderer {
  constructor(tileExtents, tileVertices) {
    this.tileExtents = tileExtents
    this.numTriangles = 2 * tileVertices * tileVertices

    this.anisotropyExtension = gl.getExtension("EXT_texture_filter_anisotropic")
    this.maxAnisotropy = gl.getParameter(this.anisotropyExtension.MAX_TEXTURE_MAX_ANISOTROPY_EXT)

    const fragmentShader = this.compileShader(this.getFragmentShader(), gl.FRAGMENT_SHADER)
    const vertexShader = this.compileShader(this.getVertexShader(), gl.VERTEX_SHADER)

    this.shaderProgram = gl.createProgram()
    gl.attachShader(this.shaderProgram, vertexShader)
    gl.attachShader(this.shaderProgram, fragmentShader)
    gl.linkProgram(this.shaderProgram)

    if (!gl.getProgramParameter(this.shaderProgram, gl.LINK_STATUS)) {
      console.error("Unable to initialize the shader program.")
    }

    this.tileOffsetUniform = gl.getUniformLocation(this.shaderProgram, "tileOffset")
    this.transformMatrixUniform = gl.getUniformLocation(this.shaderProgram, "transformMatrix")

    this.topoTextureUniform = gl.getUniformLocation(this.shaderProgram, "topoTexture")
    this.photoTextureUniform = gl.getUniformLocation(this.shaderProgram, "photoTexture")

    const vertices = this.createVertices(tileVertices)
    const vertexIndices = this.createVertexIndices(tileVertices)

    this.vertexPositionAttribute = gl.getAttribLocation(this.shaderProgram, "vertexPosition")

    this.vertexBuffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer)
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW)

    this.vertexIndexBuffer = gl.createBuffer()
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.vertexIndexBuffer)
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, vertexIndices, gl.STATIC_DRAW)
  }

  createVertices(tileVertices) {
    let i = 0
    let vertices = new Float32Array(3 * (tileVertices + 1) * (tileVertices + 1))

    for (let y = 0; y <= tileVertices; y++) {
      for (let x = 0; x <= tileVertices; x++) {
        vertices[i++] = x / tileVertices
        vertices[i++] = y / tileVertices
        i++
      }
    }
    return vertices
  }

  createVertexIndices(tileVertices) {
    let i = 0
    let vertexIndices = new Uint32Array(2 * 3 * tileVertices * tileVertices)

    for (let y = 0; y < tileVertices; y++) {
      for (let x = 0; x < tileVertices; x++) {
        const pointer = y * (tileVertices + 1) + x
        vertexIndices[i++] = pointer
        vertexIndices[i++] = pointer + 1
        vertexIndices[i++] = pointer + tileVertices + 1
        vertexIndices[i++] = pointer + 1
        vertexIndices[i++] = pointer + tileVertices + 2
        vertexIndices[i++] = pointer + tileVertices + 1
      }
    }
    return vertexIndices
  }

  initializeTexture(tile, filename, image) {
    if (filename.includes("jpg")) {
      gl.bindTexture(gl.TEXTURE_2D, tile.photoTexture)
    } else {
      gl.bindTexture(gl.TEXTURE_2D, tile.topoTexture)
    }

    // For textures to be correct in Chrome, we need
    // 1) the texture to by y-flipped here
    // 2) the image to be y-fipped in the createImageBitmap method in the tile loader
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)

    // gl.texImage2D tar 18.2 ms!!
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, image)

    if (filename.includes("jpg")) {
      // jpg, ie photo texture
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR)
      gl.generateMipmap(gl.TEXTURE_2D)

      gl.texParameterf(gl.TEXTURE_2D, this.anisotropyExtension.TEXTURE_MAX_ANISOTROPY_EXT, this.maxAnisotropy)
    } else {
      // png, ie topo texture
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    }

    gl.bindTexture(gl.TEXTURE_2D, null)
    image = null
  }

  render(tile, camera) {
    gl.activeTexture(gl.TEXTURE0)
    gl.bindTexture(gl.TEXTURE_2D, tile.topoTexture)
    gl.uniform1i(this.topoTextureUniform, 0)

    gl.activeTexture(gl.TEXTURE1)
    gl.bindTexture(gl.TEXTURE_2D, tile.photoTexture)
    gl.uniform1i(this.photoTextureUniform, 1)

    // translate tile geometry to right position
    gl.uniform3fv(this.tileOffsetUniform, tile.modelMatrix.getPosition())
    gl.uniformMatrix4fv(this.transformMatrixUniform, false, camera.getTransformMatrix())

    gl.enableVertexAttribArray(this.vertexPositionAttribute)
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer)
    gl.vertexAttribPointer(this.vertexPositionAttribute, 3, gl.FLOAT, false, 0, 0)

    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.vertexIndexBuffer)
    gl.drawElements(gl.TRIANGLES, 3 * this.numTriangles, gl.UNSIGNED_INT, 0)
  }

  compileShader(shaderScript, shaderType) {
    const shader = gl.createShader(shaderType)
    gl.shaderSource(shader, shaderScript)
    gl.compileShader(shader)
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error("An error occurred compiling the shaders: " + gl.getShaderInfoLog(shader))
      return null
    }
    return shader
  }

  getVertexShader() {
    return `
    precision highp float;

    attribute vec3 vertexPosition;
    
    uniform sampler2D topoTexture;
    uniform vec3 tileOffset;
    uniform mat4 transformMatrix;
    
    varying vec2 textureCoordinates;
    
    void main(void) {
      textureCoordinates = vertexPosition.xy;
      vec4 texel = texture2D(topoTexture, textureCoordinates);
      vec4 vertexPos = vec4(vertexPosition.xy * ${this.tileExtents}.0 + tileOffset.xy, 2550.0 * texel.r, 1.0);
      gl_Position = transformMatrix * vertexPos;
    }
    `
  }

  getFragmentShader() {
    return `
    precision mediump float;

    uniform sampler2D photoTexture;
    
    varying vec2 textureCoordinates;
    
    const vec4 fogColor = vec4(0.8, 0.8, 0.8, 1.0);
    
    void main(void) {
      vec4 color = texture2D(photoTexture, textureCoordinates);
    
      float fogFactor = 1.0 - 0.00002 * gl_FragCoord.z / gl_FragCoord.w;
      fogFactor = clamp(fogFactor, 0.0, 1.0);

      gl_FragColor = mix(fogColor, color, fogFactor);
    }
    `
  }
}
