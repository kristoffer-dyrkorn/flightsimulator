export default class Mesh {
  constructor (name) {
    this.name = name
    this.vertices = []
    this.vertexNormals = []
    this.textureCoordinates = []

    this.material = null
  }
}
