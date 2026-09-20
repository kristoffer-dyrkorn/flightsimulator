import { SERVER } from "./tile.js"

// tileName + ".json" for every tile that actually has a runway geojson
// sidecar file. Only these are ever fetched - the rest are open terrain,
// water, or forest and don't need a request attempt at all.
const RUNWAY_TILES = new Set([
  "-36250-6859000.json",
  "-49000-6655000.json",
  "-49000-6667750.json",
  "-61750-6616750.json",
  "1009250-7917250.json",
  "1034750-7891750.json",
  "104000-6973750.json",
  "1047500-7840750.json",
  "1060250-7802500.json",
  "1060250-7840750.json",
  "1085750-7879000.json",
  "129500-7012000.json",
  "2000-6833500.json",
  "269750-6667750.json",
  "27500-6884500.json",
  "27500-6922750.json",
  "282500-6667750.json",
  "282500-6680500.json",
  "282500-7037500.json",
  "295250-7037500.json",
  "308000-6935500.json",
  "308000-7190500.json",
  "333500-7152250.json",
  "359000-7254250.json",
  "371750-7483750.json",
  "384500-7305250.json",
  "384500-7318000.json",
  "40250-6961000.json",
  "410000-7292500.json",
  "435500-7547500.json",
  "435500-7560250.json",
  "461000-7356250.json",
  "461000-7458250.json",
  "473750-7458250.json",
  "473750-7560250.json",
  "499250-7598500.json",
  "499250-8682250.json",
  "537500-7675000.json",
  "537500-7687750.json",
  "563000-7585750.json",
  "563000-7598500.json",
  "639500-7662250.json",
  "639500-7726000.json",
  "65750-6795250.json",
  "728750-7751500.json",
  "754250-7828000.json",
  "805250-7777000.json",
  "818000-7777000.json",
  "818000-7853500.json",
  "869000-7802500.json",
  "894500-7904500.json",
  "91250-6463750.json",
  "958250-7917250.json",
  "958250-7930000.json",
  "996500-7917250.json",
])

/*
 * Runway legality data, one optional GeoJSON sidecar file per terrain tile -
 * src/runways/{tileName}.json, named exactly like the tile's own GLB/KTX2
 * (see tile.js's tileName). Most tiles have no such file at all; that's the
 * overwhelmingly common case (open terrain, water, forest), not an error.
 *
 * Coordinates inside each file are plain tile-local UTM33 meters - (easting
 * offset, northing offset) from the tile's own lower-left corner, the exact
 * same (x, y) pair index.js already computes as tileXOffset/tileYOffset when
 * it snaps a world position to its tile. No axis swap or sign flip is
 * needed to compare a position against these polygons, unlike the
 * Y-up-GLB-local conversion the terrain raycast needs.
 *
 * This registry's job is to track, for whichever tiles are actually loaded
 * right now, the set of polygons marking ground the aircraft is allowed to
 * land on - kept in step with tile.js's own load/unload lifecycle rather
 * than recomputed from scratch, so a `load` call here is expected once per
 * tile load, and an `unload` call once per tile unload.
 *
 * The parsed geojson itself is cached forever, separately from which tiles
 * are currently active - a tile a few kilometres from the flight path can
 * unload and reload many times as the aircraft manoeuvres near its edge,
 * and re-fetching + re-parsing the same never-changing file every single
 * time would be pure waste; only which tiles count towards `isInsideRunway`
 * needs to track load/unload.
 */

export default class RunwayRegistry {
  constructor() {
    // tileName -> array of polygons (each an array of [x, y] tile-local
    // points, outer ring only - a runway outline has no holes worth
    // modeling), or null for a tile with no runway file at all. Never
    // cleared once a tile has been fetched, however many times it later
    // loads/unloads - the file itself doesn't change.
    this.cache = new Map()

    // tileNames currently loaded - isInsideRunway only ever considers
    // these, regardless of what's sitting in the cache above
    this.active = new Set()
  }

  /**
   * Marks one tile active and, the first time this tile is ever seen,
   * kicks off a fetch for its runway geojson - most tiles have no such
   * file, and a 404 is treated as "no runways here," not an error worth
   * logging. Safe to call unconditionally from a tile's own load().
   *
   * @param tileName  "{lowerLeftEasting}-{lowerLeftNorthing}", same as the
   *                  tile's own GLB/KTX2 basename
   */
  load(tileName) {
    this.active.add(tileName)

    if (this.cache.has(tileName)) return
    if (!RUNWAY_TILES.has(`${tileName}.json`)) return

    // claim this tileName immediately (with a still-loading placeholder),
    // so a second load() before the fetch resolves can't start a second
    // request for the same file
    this.cache.set(tileName, null)

    fetch(`${SERVER}/runways/${tileName}.json`)
      .then((response) => (response.ok ? response.json() : null))
      .then((geojson) => {
        if (!geojson) return

        const polygons = geojson.features.flatMap((feature) => extractPolygons(feature.geometry))
        if (polygons.length > 0) {
          this.cache.set(tileName, polygons)
        }
      })
      .catch(() => {})
  }

  /**
   * Marks one tile inactive - call once a tile itself has been unloaded,
   * so the dynamic list of "runways currently in play" tracks which tiles
   * are actually resident, the same as the terrain mesh does. The parsed
   * polygons stay cached in case this tile loads again later.
   *
   * @param tileName  "{lowerLeftEasting}-{lowerLeftNorthing}"
   */
  unload(tileName) {
    this.active.delete(tileName)
  }

  /**
   * @param tileName  the tile the point falls in, "{easting}-{northing}"
   * @param x, y      the point, tile-local UTM33 meters (easting offset,
   *                  northing offset from that tile's lower-left corner)
   * @returns true if (x, y) is inside any runway polygon known for that
   *          tile - always false for a tile that isn't currently active,
   *          one with no runway file, or one whose geojson hasn't finished
   *          loading yet
   */
  isInsideRunway(tileName, x, y) {
    if (!this.active.has(tileName)) return false

    const polygons = this.cache.get(tileName)
    if (!polygons) return false

    return polygons.some((polygon) => pointInPolygon(x, y, polygon))
  }
}

// a GeoJSON Polygon's coordinates are [ring, ...holes] - only the outer ring
// (index 0) is used. A MultiPolygon's coordinates are one of those per part,
// which a runway clipped across a tile boundary could plausibly produce.
function extractPolygons(geometry) {
  if (!geometry) return []
  if (geometry.type === "Polygon") return [geometry.coordinates[0]]
  if (geometry.type === "MultiPolygon") return geometry.coordinates.map((polygon) => polygon[0])
  return []
}

// standard even-odd ray-casting point-in-polygon test: count how many times
// a ray from (x, y) out towards +x crosses an edge of the polygon: an odd
// number of crossings means the point is inside
function pointInPolygon(x, y, polygon) {
  let inside = false

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const [xi, yi] = polygon[i]
    const [xj, yj] = polygon[j]

    const crosses = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi
    if (crosses) inside = !inside
  }

  return inside
}
