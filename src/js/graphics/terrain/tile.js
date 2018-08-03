import { gl } from "../gl.js"
import Matrix from "../matrix.js"
import Vector from "../vector.js"
import BoundingSphere from "../boundingsphere.js"
import TileRenderer from "./tilerenderer.js"
import GraphicsConstants from "../graphicsconstants.js"

export default class Tile {
  constructor(position, terrainCenter, extents, height) {
    // put the terrain center at (0,0) to avoid numerical precision issues
    // if not, camera movements become wobbly due to
    // the large magnitude of the UTM y (north) coordinates.
    position.sub(terrainCenter)

    this.modelMatrix = new Matrix()
    this.modelMatrix.setPosition(position)
    this.tileIndex = Tile.tileIndex++
    this.isVisible = false

    this.terrainCenter = terrainCenter
    this.boundingSphere = new BoundingSphere(position, extents, height)

    this.topoTexture = gl.createTexture()
    this.photoTexture = gl.createTexture()

    this.status = GraphicsConstants.EMPTY
  }

  fetchTextures(worker) {
    this.status = GraphicsConstants.LOADING

    // convert back to normal UTM coordinates
    // to match the file names for the tiles
    const position = this.getPosition()
    position.add(this.terrainCenter)
    console.log("Fetching tile: " + position)
    const filename = `/data/textures/${position[0]}-${position[1]}`

    // we cannot send a tile through a worker, so send the index to this tile.
    // when the textures have been loaded, we call the render method on the tile object
    // since the Terrain object is the only object that knows the mapping from
    // index to tile object, the worker must be located on that object
    worker.postMessage({ filename: filename + ".png", size: GraphicsConstants.TOPO_SIZE, tileIndex: this.tileIndex })
    worker.postMessage({ filename: filename + ".jpg", size: GraphicsConstants.PHOTO_SIZE, tileIndex: this.tileIndex })
  }

  initializeTexture(filename, image) {
    this.status = GraphicsConstants.LOADED
    Tile.renderer.initializeTexture(this, filename, image)
  }

  freeTextures() {
    // convert back to normal UTM coordinates before logging
    const position = this.getPosition()
    position.add(this.terrainCenter)
    console.log("Freeing tile: " + position)

    gl.deleteTexture(this.topoTexture)
    gl.deleteTexture(this.photoTexture)

    this.topoTexture = gl.createTexture()
    this.photoTexture = gl.createTexture()
    this.status = GraphicsConstants.EMPTY
  }

  getModelMatrix() {
    return this.modelMatrix
  }

  getPosition() {
    return this.modelMatrix.getPosition()
  }

  calculateVisibility(camera) {
    const tileDirection = new Vector(this.boundingSphere.position)
    tileDirection.sub(camera.getPosition())

    if (tileDirection.getLength() - this.boundingSphere.radius > GraphicsConstants.FRUSTRUM_FAR) {
      this.isVisible = false
      return
    }

    const backVector = new Vector(camera.getDirection())
    const distance = this.boundingSphere.radius / Math.sin(camera.viewConeAngle)
    backVector.scale(-distance)

    tileDirection.sub(backVector)
    tileDirection.normalize()

    const cosTileAngle = tileDirection.dot(camera.getDirection())

    // cos a is decreasing as a is increasing, so reverse comparison
    if (Math.acos(cosTileAngle) < camera.viewConeAngle) {
      this.isVisible = true
    } else {
      this.isVisible = false
    }
  }

  render(camera, worker) {
    if (this.isVisible) {
      // only fetch if visible and not loading/loaded
      if (this.status === GraphicsConstants.EMPTY) {
        this.fetchTextures(worker)
      }
      // only render if visible and loaded
      if (this.status === GraphicsConstants.LOADED) {
        gl.useProgram(Tile.renderer.shaderProgram)
        Tile.renderer.render(this, camera)
      }
    } else {
      // only free if not visible and loaded
      if (this.status === GraphicsConstants.LOADED) {
        this.freeTextures()
      }
    }
  }
}

Tile.tileIndex = 0
Tile.renderer = new TileRenderer(GraphicsConstants.TILE_EXTENTS, GraphicsConstants.TOPO_SIZE)
