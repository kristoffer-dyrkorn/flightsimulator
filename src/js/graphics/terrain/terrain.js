import Tile from "./tile.js"
import Vector from "../vector.js"
import GraphicsConstants from "../graphicsconstants.js"

export default class Terrain {
  constructor(minExtents, maxExtents, terrainCenter) {
    this.tiles = []
    this.fetchedTiles = 0
    this.renderedTiles = 0
    this.discardedTiles = 0
    this.maxVisibleTiles = 0
    this.calculateVisiblity = true

    for (let y = minExtents[1]; y <= maxExtents[1]; y += GraphicsConstants.TILE_EXTENTS) {
      for (let x = minExtents[0]; x <= maxExtents[0]; x += GraphicsConstants.TILE_EXTENTS) {
        const position = new Vector(x, y, 0)
        const tile = new Tile(position, terrainCenter, GraphicsConstants.TILE_EXTENTS, GraphicsConstants.MAX_HEIGHT)
        this.tiles.push(tile)
      }
    }
  }

  render(camera) {
    // split tile visibility calculation and tile rendering (for now)
    // so we can render tiles using outdated visibility information
    // and visually inspect frustrum culling
    if (this.calculateVisiblity) {
      this.tiles.forEach(tile => {
        tile.calculateVisibility(camera)
      })
    }

    // render the tiles according to the calculated visibility state
    this.tiles.forEach(tile => {
      tile.render(camera, this.worker)
    })
  }
}
