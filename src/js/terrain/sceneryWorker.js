import { ShapeUtils, Vector2 } from "three"

/**
 * Reads a tile's scenery file off the main thread - see scenery.js. Asked
 * { tileName, url }, it fetches the file and answers { tileName, found,
 * lights, buildings }: whether there was a file, its light MultiPoints as
 * they are (see sceneryLights.js), and its buildings as one mesh's arrays -
 * { positions, normals, centers, indices, cells, cellSize, center, radius } -
 * or null if it has none - see buildingMesh. centers is each vertex's building's centre, east and north in
 * whole meters - for where the roofs sample the terrain's photo, see
 * buildings.js.
 *
 * A missing file is no scenery, not an error: a 404 or 403 (what S3
 * answers for a file that isn't there), or anything that isn't JSON (what a
 * development server answers with its index page).
 *
 * Each building is its outline raised to its height: a wall for every side,
 * with its own four corners so that it is shaded flat, facing out, and a flat
 * roof over the outline, holes and all. In the tile's own coordinates - east,
 * north and up, meters from its lower left corner.
 */

// twice the signed area of a ring, positive anticlockwise
function signedArea(ring) {
  let area = 0
  for (let k = 0; k < ring.length - 1; k++) area += ring[k][0] * ring[k + 1][1] - ring[k + 1][0] * ring[k][1]
  return area
}

async function read(url) {
  try {
    const response = await fetch(url)
    const json = (response.headers.get("content-type") ?? "").includes("json")
    if (!response.ok || !json) return null
    const geojson = await response.json()
    return Array.isArray(geojson?.features) ? geojson.features : null
  } catch {
    return null
  }
}

// The buildings are drawn by cell, CELLS x CELLS of them to a tile - each
// building in the cell its centre is in - and in each cell from the largest
// to the smallest, so that the smallest can be left out far off by drawing
// only the start of the cell's run: see buildings.js.
const CELLS = 4
const TILE_EXTENTS = 50 * 255

// the buildings of a tile, the MultiPolygons (and Polygons) of its file, {
// h } their height, as one mesh - or null if there are none. With it, for
// each cell, where its run of indices starts, how far it reaches after each
// of its buildings, and their sizes - the largest of a building's width,
// length and height - in the same order, largest first.
function buildingMesh(features) {
  // the buildings first, to be sorted
  const cells = Array.from({ length: CELLS * CELLS }, (_, k) => ({
    x: (k % CELLS) * (TILE_EXTENTS / CELLS),
    y: Math.floor(k / CELLS) * (TILE_EXTENTS / CELLS),
    buildings: [],
  }))
  for (const feature of features) {
    const { type, coordinates } = feature.geometry ?? {}
    const polygons = type === "MultiPolygon" ? coordinates : type === "Polygon" ? [coordinates] : []
    const height = feature.properties?.h ?? 3

    for (const polygon of polygons) {
      // outer ring anticlockwise, holes clockwise - so a wall's outside is
      // to the right of the way its ring runs
      const rings = polygon.map((ring, k) => {
        const anticlockwise = signedArea(ring) > 0
        return (k === 0) === anticlockwise ? ring : [...ring].reverse()
      })
      if (rings[0].length < 4) continue
      const corners = rings[0].slice(0, -1)
      const xs = corners.map(([x]) => x)
      const ys = corners.map(([, y]) => y)
      const centerX = Math.round(xs.reduce((sum, x) => sum + x, 0) / corners.length)
      const centerY = Math.round(ys.reduce((sum, y) => sum + y, 0) / corners.length)
      const size = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), height)
      const cell = (v) => Math.min(CELLS - 1, Math.max(0, Math.floor(v / (TILE_EXTENTS / CELLS))))
      cells[cell(centerY) * CELLS + cell(centerX)].buildings.push({ rings, height, centerX, centerY, size })
    }
  }

  const positions = []
  const normals = []
  const centers = []
  // the building's centre, for the vertices made now
  let centerX = 0
  let centerY = 0
  const indices = []
  const vertex = (x, y, z, nx, ny, nz) => {
    positions.push(x, y, z)
    normals.push(Math.round(nx * 127), Math.round(ny * 127), Math.round(nz * 127), 0)
    centers.push(centerX, centerY)
    return positions.length / 3 - 1
  }

  const runs = []
  for (const cell of cells) {
    if (cell.buildings.length === 0) continue
    cell.buildings.sort((a, b) => b.size - a.size)
    const run = { x: cell.x, y: cell.y, start: indices.length, ends: [], sizes: [] }

    for (const building of cell.buildings) {
      const { rings, height } = building
      centerX = building.centerX
      centerY = building.centerY
      const base = rings[0][0][2]
      const top = base + height

      for (const ring of rings) {
        for (let k = 0; k < ring.length - 1; k++) {
          const [x0, y0] = ring[k]
          const [x1, y1] = ring[k + 1]
          const length = Math.hypot(x1 - x0, y1 - y0)
          if (length < 1e-3) continue
          const nx = (y1 - y0) / length
          const ny = -(x1 - x0) / length
          const a = vertex(x0, y0, base, nx, ny, 0)
          const b = vertex(x1, y1, base, nx, ny, 0)
          const c = vertex(x1, y1, top, nx, ny, 0)
          const d = vertex(x0, y0, top, nx, ny, 0)
          indices.push(a, b, c, a, c, d)
        }
      }

      // the roof - the rings without their closing points
      const contour = rings[0].slice(0, -1).map(([x, y]) => new Vector2(x, y))
      const holes = rings.slice(1).map((ring) => ring.slice(0, -1).map(([x, y]) => new Vector2(x, y)))
      const points = [contour, ...holes].flat()
      const first = positions.length / 3
      for (const point of points) vertex(point.x, point.y, top, 0, 0, 1)
      for (const [i, j, k] of ShapeUtils.triangulateShape(contour, holes)) {
        // facing up, whichever way round the triangulation put it
        const up =
          (points[j].x - points[i].x) * (points[k].y - points[i].y) -
            (points[j].y - points[i].y) * (points[k].x - points[i].x) >
          0
        indices.push(first + i, first + (up ? j : k), first + (up ? k : j))
      }

      run.ends.push(indices.length)
      run.sizes.push(building.size)
    }
    runs.push({ ...run, ends: new Uint32Array(run.ends), sizes: new Float32Array(run.sizes) })
  }
  if (indices.length === 0) return null

  // a sphere round it all, so the tile can be left out when out of view
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (let p = 0; p < positions.length; p += 3) {
    for (let c = 0; c < 3; c++) {
      min[c] = Math.min(min[c], positions[p + c])
      max[c] = Math.max(max[c], positions[p + c])
    }
  }

  return {
    positions: new Float32Array(positions),
    normals: new Int8Array(normals),
    centers: new Int16Array(centers),
    indices: positions.length / 3 > 65535 ? new Uint32Array(indices) : new Uint16Array(indices),
    cells: runs,
    cellSize: TILE_EXTENTS / CELLS,
    center: min.map((m, c) => (m + max[c]) / 2),
    radius: Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) / 2,
  }
}

self.onmessage = async ({ data: { tileName, url } }) => {
  const features = await read(url)
  if (!features) {
    self.postMessage({ tileName, found: false, lights: [], buildings: null })
    return
  }

  const lights = features.filter((feature) => feature.geometry?.type === "MultiPoint")
  const buildings = buildingMesh(features.filter((feature) => /Polygon$/.test(feature.geometry?.type ?? "")))
  const transfer = buildings
    ? [buildings.positions.buffer, buildings.normals.buffer, buildings.centers.buffer, buildings.indices.buffer]
    : []
  self.postMessage({ tileName, found: true, lights, buildings }, transfer)
}
