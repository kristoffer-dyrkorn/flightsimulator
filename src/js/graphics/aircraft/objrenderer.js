import { gl } from "../gl.js"

export default class OBJRenderer {
  constructor(obj) {
    this.obj = obj

    this.vertexBuffer = new Map()
    this.normalBuffer = new Map()
    this.textureCoordinateBuffer = new Map()

    const fragmentShader = this.compileShader(this.getFragmentShader(), gl.FRAGMENT_SHADER)
    const vertexShader = this.compileShader(this.getVertexShader(), gl.VERTEX_SHADER)

    this.shaderProgram = gl.createProgram()
    gl.attachShader(this.shaderProgram, vertexShader)
    gl.attachShader(this.shaderProgram, fragmentShader)
    gl.linkProgram(this.shaderProgram)

    if (!gl.getProgramParameter(this.shaderProgram, gl.LINK_STATUS)) {
      console.error("Unable to initialize the shader program.")
    }

    this.modelMatrixUniform = gl.getUniformLocation(this.shaderProgram, "modelMatrix")
    this.viewMatrixUniform = gl.getUniformLocation(this.shaderProgram, "viewMatrix")
    this.projectionMatrixUniform = gl.getUniformLocation(this.shaderProgram, "projectionMatrix")

    this.textureUniform = gl.getUniformLocation(this.shaderProgram, "texture")

    this.vertexPositionAttribute = gl.getAttribLocation(this.shaderProgram, "vertexPosition")
    this.textureCoordinateAttribute = gl.getAttribLocation(this.shaderProgram, "textureCoordinate")
    this.vertexNormalAttribute = gl.getAttribLocation(this.shaderProgram, "vertexNormal")

    obj.meshes.forEach(mesh => {
      this.vertexBuffer.set(mesh.name, gl.createBuffer())
      gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer.get(mesh.name))
      gl.bufferData(gl.ARRAY_BUFFER, mesh.vertices, gl.STATIC_DRAW)

      this.normalBuffer.set(mesh.name, gl.createBuffer())
      gl.bindBuffer(gl.ARRAY_BUFFER, this.normalBuffer.get(mesh.name))
      gl.bufferData(gl.ARRAY_BUFFER, mesh.vertexNormals, gl.STATIC_DRAW)

      this.textureCoordinateBuffer.set(mesh.name, gl.createBuffer())
      gl.bindBuffer(gl.ARRAY_BUFFER, this.textureCoordinateBuffer.get(mesh.name))
      gl.bufferData(gl.ARRAY_BUFFER, mesh.textureCoordinates, gl.STATIC_DRAW)
    })
  }

  render(camera) {
    gl.useProgram(this.shaderProgram)
    let previousMaterial = ""

    this.obj.meshes
      .filter(mesh => mesh.material.isLoaded)
      .forEach(mesh => {
        gl.activeTexture(gl.TEXTURE0)

        // minimize state change - only bind texture when materials change
        if (mesh.material.name !== previousMaterial) {
          gl.bindTexture(gl.TEXTURE_2D, mesh.material.texture)
          previousMaterial = mesh.material.name
        }

        gl.uniform1i(this.textureUniform, 0)

        gl.uniformMatrix4fv(this.projectionMatrixUniform, false, camera.getProjectionMatrix())
        gl.uniformMatrix4fv(this.viewMatrixUniform, false, camera.getCameraMatrix())
        gl.uniformMatrix4fv(this.modelMatrixUniform, false, this.obj.modelMatrix)

        gl.enableVertexAttribArray(this.vertexPositionAttribute)
        gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer.get(mesh.name))
        gl.vertexAttribPointer(this.vertexPositionAttribute, 3, gl.FLOAT, false, 0, 0)

        gl.enableVertexAttribArray(this.vertexNormalAttribute)
        gl.bindBuffer(gl.ARRAY_BUFFER, this.normalBuffer.get(mesh.name))
        gl.vertexAttribPointer(this.vertexNormalAttribute, 3, gl.FLOAT, false, 0, 0)

        gl.enableVertexAttribArray(this.textureCoordinateAttribute)
        gl.bindBuffer(gl.ARRAY_BUFFER, this.textureCoordinateBuffer.get(mesh.name))
        gl.vertexAttribPointer(this.textureCoordinateAttribute, 3, gl.FLOAT, false, 0, 0)

        gl.drawArrays(gl.TRIANGLES, 0, mesh.vertices.length / 3)
      })
  }

  compileShader(shaderScript, shaderType) {
    let shader = gl.createShader(shaderType)
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
    attribute vec3 textureCoordinate;
    attribute vec3 vertexNormal;

    uniform sampler2D texture;

    uniform mat4 modelMatrix;
    uniform mat4 viewMatrix;
    uniform mat4 projectionMatrix;

    varying vec2 textureCoord;
    varying vec3 vertexNorm;

    void main(void) {
      textureCoord = textureCoordinate.xy;
      vertexNorm = vertexNormal;
      gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(vertexPosition, 1.0);
    }
    `
  }

  getFragmentShader() {
    return `
    precision mediump float;

    uniform sampler2D texture;
    varying vec2 textureCoord;
    varying vec3 vertexNorm;

    vec3 lightDirection = normalize(vec3(1.0, 1.0, 1.0));
    vec4 ambientColor = vec4(1.0, 1.0, 1.0, 1.0);

    float diffuseIntensity = 0.95;
    float ambientIntensity = 0.05;

    void main(void) {
      float diffuseFactor = dot(vertexNorm, lightDirection);
      vec4 textureColor = diffuseIntensity * diffuseFactor * texture2D(texture, textureCoord);
      gl_FragColor = ambientIntensity * ambientColor + vec4(textureColor.xyz, 1.0);
    }
    `
  }
}
