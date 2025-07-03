import Tile from "./tile.js"
import { Vector3 } from "three"
import { GenerateMeshBVHWorker } from "../externals/workers/GenerateMeshBVHWorker.js"

const TILE_EXTENTS = 50 * 255

export default class Terrain {
  constructor(scene, minx, miny, maxx, maxy, renderer) {
    this.scene = scene
    this.tiles = new Map()
    this.minx = minx
    this.miny = miny

    // queue for fetching tiles, to rate limit image fetching and decoding
    this.fetchQueue = []

    Tile.ktx2Loader.detectSupport(renderer)
    Tile.bvhWorker = new GenerateMeshBVHWorker()

    for (let y = miny; y <= maxy; y += TILE_EXTENTS) {
      for (let x = minx; x <= maxx; x += TILE_EXTENTS) {
        const lowerLeft = new Vector3(x, y, 0)
        const tile = new Tile(scene, this, TILE_EXTENTS, lowerLeft)
        this.tiles.set(`${x}-${y}`, tile)
      }
    }
    console.log(`${this.tiles.size} tiles constructed`)

    // periodically consider loading 1 tile from the fetch queue.
    // this way we avoid burst-loading tiles, something which *will* lead to stuttering
    // symptoms: major GCs and unspecified "tasks"
    setInterval(() => {
      const tile = this.fetchQueue.shift()
      if (tile) {
        tile.load()
      }
    }, 100)
  }

  update(camera, showWireFrame) {
    // get the coordinates of the tile surrounding the camera
    const tileXOffset = (camera.position.x - this.minx) % TILE_EXTENTS
    const tileX = Math.round(camera.position.x - tileXOffset)

    const tileYOffset = (camera.position.y - this.miny) % TILE_EXTENTS
    const tileY = Math.round(camera.position.y - tileYOffset)

    // find which tiles to update
    // only consider those within camera far plane distance
    const DISTANCE = TILE_EXTENTS * Math.ceil(camera.far / TILE_EXTENTS)

    for (let y = tileY - DISTANCE; y <= tileY + DISTANCE; y += TILE_EXTENTS) {
      for (let x = tileX - DISTANCE; x <= tileX + DISTANCE; x += TILE_EXTENTS) {
        const tile = this.tiles.get(`${x}-${y}`)
        tile.update(camera, showWireFrame)
      }
    }
  }
}
