import Tile from "./tile.js"
import * as THREE from "../graphics/three.module.js"

const TILE_EXTENTS = 50 * 255

export default class Terrain {
  constructor(scene, minx, miny, maxx, maxy, renderer) {
    this.scene = scene
    this.tiles = []

    // queue for fetching tiles, to rate limit image fetching and decoding
    this.fetchQueue = []

    Tile.basisLoader.detectSupport(renderer)

    for (let y = miny; y <= maxy; y += TILE_EXTENTS) {
      for (let x = minx; x <= maxx; x += TILE_EXTENTS) {
        const lowerLeft = new THREE.Vector3(x, y, 0)
        const tile = new Tile(scene, this, TILE_EXTENTS, lowerLeft)
        this.tiles.push(tile)
      }
    }
    console.log(`${this.tiles.length} tiles constructed`)

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
    this.tiles.forEach((tile) => {
      tile.update(camera, showWireFrame)
    })
  }
}
