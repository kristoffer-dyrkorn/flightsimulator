import { SERVER } from "./tile.js"

/*
 * The scenery on the terrain - buildings, and lights at night - from one
 * optional file per terrain tile, src/scenery/{tileName}.json, named like
 * the tile's own GLB/KTX2, made by scenery/buildScenery.mjs in
 * flightsimulator-scripts. GeoJSON, in the tile's own coordinates - east and
 * north from its lower left corner, and up - in whole meters: the lights as
 * MultiPoints (see sceneryLights.js), the buildings as MultiPolygons, one
 * for each height (see buildings.js).
 *
 * Every terrain tile's file is asked for when the tile loads - most of the
 * country has none, and a missing one is no scenery, not an error. It is
 * read, and the buildings made into a mesh, in a worker (see
 * sceneryWorker.js), so that doesn't hold up a frame. Each file is asked for
 * once while its tile stays loaded. That there is none is remembered for
 * good; a tile's scenery is let go with the tile, and asked for again -
 * usually from the browser's cache - if it loads again, so a long flight
 * across the country doesn't pile it up in memory.
 */
export default class Scenery {
  constructor(lights, buildings) {
    this.lights = lights
    this.buildings = buildings
    // the tiles loaded now, the ones asked for and not answered yet, and the
    // ones known to have no file
    this.active = new Set()
    this.pending = new Set()
    this.none = new Set()

    this.worker = new Worker(new URL("./sceneryWorker.js", import.meta.url), { type: "module" })
    this.worker.onmessage = ({ data }) => this.read(data)
  }

  /** Shows a tile's scenery, once its file is in - call when the tile loads. */
  load(tileName) {
    this.active.add(tileName)
    if (this.none.has(tileName) || this.pending.has(tileName)) return
    this.pending.add(tileName)
    this.worker.postMessage({ tileName, url: new URL(`${SERVER}/scenery/${tileName}.json`, document.baseURI).href })
  }

  /** Takes a tile's scenery away - call when the tile is unloaded. */
  unload(tileName) {
    this.active.delete(tileName)
    this.lights.unload(tileName)
    this.buildings.unload(tileName)
  }

  // a tile's file, read - shown, unless the tile has gone again meanwhile
  read({ tileName, found, lights, buildings }) {
    this.pending.delete(tileName)
    if (!found) this.none.add(tileName)
    if (!this.active.has(tileName)) return
    if (lights.length > 0) this.lights.add(tileName, lights)
    if (buildings) this.buildings.add(tileName, buildings)
  }
}
