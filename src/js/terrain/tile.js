import * as THREE from "../graphics/three.module.js"
import { BasisTextureLoader } from "../graphics/BasisTextureLoader.js"

const url = new URL(document.location)
const urlParams = url.searchParams

let TEXTURE_PATH = "texture-v2"

if (urlParams.has("v3")) {
  TEXTURE_PATH = "texture-v3"
} else if (urlParams.has("v1")) {
  TEXTURE_PATH = "texture"
}

const SERVER = urlParams.has("local") ? "http://localhost:8000" : "https://s3-eu-west-1.amazonaws.com/kd-flightsim"

export default class Tile {
  constructor(scene, terrain, tileExtents, lowerLeft) {
    this.scene = scene
    this.terrain = terrain

    this.loading = false
    this.loaded = false

    this.tileName = `${lowerLeft.x}-${lowerLeft.y}`

    const sphereRadius = Math.sqrt(0.5 * tileExtents * tileExtents)
    const tileCenter = new THREE.Vector3(lowerLeft.x + tileExtents / 2, lowerLeft.y + tileExtents / 2, 0)
    this.boundingSphere = new THREE.Sphere(tileCenter, sphereRadius)

    this.tileMesh = new THREE.Mesh()
    this.tileMesh.position.set(lowerLeft.x, lowerLeft.y, 0)
    this.tileMesh.updateMatrixWorld()

    this.tileMesh.geometry = new THREE.BufferGeometry()
    // use a very simple material, all light and shading of terrain is baked into the texture
    this.tileMesh.material = new THREE.MeshBasicMaterial()
  }

  update(camera, showWireFrame) {
    // visibility test: consider all tiles within a certain radius to be visible.
    // frustum culling is not used here, since wide camera rotations (180 degrees) will
    // then require loading an entire frustum of tiles, ie risk of visible artifacts (missing tiles).
    // by using distance as a criterion (and not view angle), only tiles at long distances
    // need to be loaded, thus reducing risks of missing tiles.
    // the tradeoff is a larger triangle count in the scene, but as long we are still
    // within performance budgets that is no problem.
    let dist =
      (this.boundingSphere.center.x - camera.position.x) * (this.boundingSphere.center.x - camera.position.x) +
      (this.boundingSphere.center.y - camera.position.y) * (this.boundingSphere.center.y - camera.position.y)
    let visible = dist < camera.far * camera.far

    // only change rendering style for loaded tiles
    // TODO: only change wireframe setting when key is pressed
    if (this.loaded) {
      this.tileMesh.material.wireframe = showWireFrame
    }

    if (visible && !this.loading && !this.loaded) {
      // this tile needs to be loaded
      this.loading = true
      // add to fetch queue - loading is spread across frames to avoid stuttering
      this.terrain.fetchQueue.push(this)
    }

    if (!visible && !this.loading && this.loaded) {
      // this tile is to be removed
      this.scene.remove(this.tileMesh)

      // dispose, ie empty, the geometry and material data
      // but do not null the geometry and material objects
      this.tileMesh.material.map.dispose()
      this.tileMesh.material.map = null

      // when we load a tile we re-populate the existing objects
      // this way we reduce GC and re-allocation of memory
      this.tileMesh.material.dispose()
      this.tileMesh.geometry.dispose()

      this.loaded = false
      Tile.loadCount--
    }
  }

  load() {
    fetch(`${SERVER}/meshes/${this.tileName}.msh`, { mode: "cors" }).then((response) => {
      response.arrayBuffer().then((buffer) => {
        const [posAttribute, uvAttribute, indexAttribute] = this.getVertexData(buffer)
        this.tileMesh.geometry.setAttribute("position", posAttribute)
        this.tileMesh.geometry.setAttribute("uv", uvAttribute)
        this.tileMesh.geometry.index = indexAttribute

        Tile.basisLoader.load(
          `${SERVER}/${TEXTURE_PATH}/${this.tileName}.basis`,
          (texture) => {
            texture.encoding = THREE.sRGBEncoding
            texture.anisotropy = 4

            this.tileMesh.material.map = texture
            this.tileMesh.material.needsUpdate = true

            this.scene.add(this.tileMesh)

            this.loading = false
            this.loaded = true

            Tile.loadCount++
          },
          () => {},
          (error) => {
            console.log("Error: " + error)
          }
        )
      })
    })
  }

  getVertexData(buffer) {
    let offset = 0
    const stride = Uint16Array.BYTES_PER_ELEMENT

    const vertexCount = new Uint16Array(buffer, offset, 1)[0]
    offset += stride * 1 // read 1 uint16

    const vertices = new Uint16Array(buffer, offset, 3 * vertexCount)
    offset += stride * 3 * vertexCount // 1 vertex = 3 coordinates

    const uvs = new Uint16Array(buffer, offset, 2 * vertexCount)
    offset += stride * 2 * vertexCount // 1 vertex = 2 texture coordinates

    const triangleCount = new Uint16Array(buffer, offset, 1)[0]
    offset += stride * 1 // read 1 uint16

    const triangles = new Uint16Array(buffer, offset, 3 * triangleCount) // 1 triangle = 3 indices

    const posAttribute = new THREE.BufferAttribute(vertices, 3)
    const uvAttribute = new THREE.BufferAttribute(uvs, 2, true) // uv coordinates must be normalized, ie scaled to 0..1
    const indexAttribute = new THREE.BufferAttribute(triangles, 1)

    return [posAttribute, uvAttribute, indexAttribute]
  }
}

Tile.loadCount = 0
Tile.basisLoader = new BasisTextureLoader()
Tile.basisLoader.setTranscoderPath("js/graphics/basis/")
Tile.basisLoader.setCrossOrigin("anonymous")
