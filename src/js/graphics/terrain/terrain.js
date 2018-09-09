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

    // see Tile::fetchTextures(worker) for an explanation of why the worker
    // is placed on the Terrain object
    this.worker = new Worker("./js/graphics/terrain/texture.worker.js")
    this.worker.onmessage = e => {
      const [filename, bitmap, tileIndex] = e.data
      if (!bitmap) {
        // if no createImageBitmap was available (ie we run on Safari),
        // decode image ourselves, on main thread
        let image = new Image()
        image.onload = () => {
          this.tiles[tileIndex].initializeTexture(filename, image)
        }
        image.crossOrigin = ""
        image.src = filename
      } else {
        this.tiles[tileIndex].initializeTexture(filename, bitmap)
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
