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

  initialize(camera, startPoint, startDirection) {
    // find a target point in front of the camera, 30% of the distance to far clip plane
    // the target point is meant to be somewhere near focus of attention for the user
    const targetPosition = new THREE.Vector3()
    targetPosition.x = startPoint[0] + camera.far * 0.3 * Math.cos((90 - startDirection) * THREE.MathUtils.DEG2RAD)
    targetPosition.y = startPoint[1] + camera.far * 0.3 * Math.sin((90 - startDirection) * THREE.MathUtils.DEG2RAD)

    // stort tiles according to distance to the start point, ie according to focus of attention
    // this makes the most prominent tiles load first so that loading appears to go much faster.
    // this is only important for first, initial loading.
    // later, incremental loading/unloading is not affected by the sequence of tiles in the array
    this.tiles.sort((tileA, tileB) => {
      if (
        tileA.boundingSphere.center.distanceTo(targetPosition) < tileB.boundingSphere.center.distanceTo(targetPosition)
      ) {
        return -1
      } else {
        return 1
      }
    })
  }
}
