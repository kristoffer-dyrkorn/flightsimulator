import Material from "./material.js"
import Mesh from "./mesh.js"
import OBJ from "./obj.js"

export default class OBJLoader {
  constructor(path) {
    this.path = path
  }

  async load(objectFile) {
    this.obj = new OBJ(objectFile)

    // buffers for actual coordinates/values
    // group (mesh) face data contain indices pointing to these values
    this.vertexData = []
    this.normalData = []
    this.textureData = []

    this.materials = new Map()
    this.currentMesh = null
    this.currentMaterial = null

    console.log("Loading OBJ file: " + objectFile)
    await fetch(this.path + objectFile)
      .then(response => response.text())
      .then(OBJData => this.parseOBJ(OBJData))

    console.log("Loaded OBJ file.")
    console.log("Object name: " + this.obj.name)

    // Move f-16 down and forward a bit so center of gravity is at y=0, z=0
    // TODO: Fix this in a better way
    this.obj.meshes.forEach(mesh => {
      for (let i = 0; i < mesh.vertices.length / 3; i++) {
        mesh.vertices[3 * i + 1] -= 1.5
        mesh.vertices[3 * i + 2] += 1.5
      }
    })

    this.obj.meshes.forEach(mesh => {
      console.log(
        "Mesh: " + mesh.name + ", triangles: " + mesh.vertices.length / 9 + ", material: " + mesh.material.name
      )
    })

    // convert arrays to typed arrays, as needed by WebGL
    this.obj.meshes.forEach(mesh => {
      mesh.vertices = new Float32Array(mesh.vertices)
      mesh.vertexNormals = new Float32Array(mesh.vertexNormals)
      mesh.textureCoordinates = new Float32Array(mesh.textureCoordinates)
    })

    // change map of meshes into array of meshes and
    // sort the array according to the mesh material (ie texture)
    // so we support reuse of materials (ie WebGL state)
    // from one mesh to the next in the object
    this.obj.meshes = [...this.obj.meshes.values()].sort(
      (m1, m2) => (m1.material.name > m2.material.name ? 1 : m1.material.name < m2.material.name ? -1 : 0)
    )

    this.vertexData = null
    this.normalData = null
    this.textureData = null

    return this.obj
  }

  async parseOBJ(data) {
    const lines = data.split("\n")
    for (const rawLine of lines) {
      const line = rawLine.trim()
      const firstChar = line.charAt(0)
      const tokens = line.split(/\s+/)
      if (line.includes("mtllib")) {
        await this.loadMaterials(tokens[1])
      } else if (line.includes("object")) {
        console.log("Parsing mesh: " + tokens[2])
        this.startMesh(tokens[2])
      } else if (firstChar === "v") {
        switch (tokens[0]) {
          case "v":
            this.pushVertexInfo(this.vertexData, tokens)
            break
          case "vn":
            this.pushVertexInfo(this.normalData, tokens)
            break
          case "vt":
            this.pushVertexInfo(this.textureData, tokens)
            break
        }
      } else if (firstChar === "g") {
        this.useMesh(tokens[1])
      } else if (line.includes("usemtl")) {
        this.useMaterial(tokens[1])
      } else if (firstChar === "f") {
        const ngons = tokens.slice(1)
        ngons.forEach(gon => {
          const i = gon.split("/")
          this.pushFaceInfo(this.vertexData, this.currentMesh.vertices, 3 * (i[0] - 1))
          this.pushFaceInfo(this.textureData, this.currentMesh.textureCoordinates, 3 * (i[1] - 1))
          this.pushFaceInfo(this.normalData, this.currentMesh.vertexNormals, 3 * (i[2] - 1))
        })
      }
    }
  }

  pushVertexInfo(target, data) {
    target.push(parseFloat(data[1]), parseFloat(data[2]), parseFloat(data[3]))
  }

  pushFaceInfo(source, target, index) {
    target.push(source[index++])
    target.push(source[index++])
    target.push(source[index])
  }

  startMesh(meshName) {
    this.obj.meshes.set(meshName, new Mesh(meshName))
    this.useMesh(meshName)
  }

  useMesh(meshName) {
    this.currentMesh = this.obj.meshes.get(meshName)
  }

  loadMaterials(materialsFile) {
    return fetch(this.path + materialsFile)
      .then(response => response.text())
      .then(materialsData => this.parseMTL(materialsData))
  }

  parseMTL(materialsData) {
    const lines = materialsData.split("\n")
    lines.forEach(rawLine => {
      const line = rawLine.trim()
      const tokens = line.split(/\s+/)
      if (line.includes("newmtl")) {
        this.startMaterial(tokens[1])
      } else if (line.includes("map_Kd")) {
        this.currentMaterial.loadTexture(tokens[1])
      }
    })
  }

  startMaterial(materialName) {
    const materialObject = new Material(this.path, materialName)
    this.materials.set(materialName, materialObject)
    this.currentMaterial = materialObject
  }

  useMaterial(materialName) {
    this.currentMesh.material = this.materials.get(materialName)
    console.log("Mesh " + this.currentMesh.name + " now has material " + this.currentMesh.material.name)
  }
}
