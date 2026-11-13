import { ShapeUtils, Vector2 } from "three"

/**
 * Reads a tile's scenery file off the main thread - see scenery.js. Asked
 * { tileName, url }, it fetches the file and answers { tileName, found,
 * lights, buildings }: whether there was a file, its light MultiPoints as
 * they are (see sceneryLights.js), and its buildings as one mesh's arrays -
 * { positions, normals, indices, center, radius } - or null if it has none.
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

// the buildings of a tile, the MultiPolygons (and Polygons) of its file, {
// h } their height, as one mesh - or null if there are none
function buildingMesh(features) {
  const positions = []
  const normals = []
  const indices = []
  const vertex = (x, y, z, nx, ny, nz) => {
    positions.push(x, y, z)
    normals.push(Math.round(nx * 127), Math.round(ny * 127), Math.round(nz * 127), 0)
    return positions.length / 3 - 1
  }

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
    }
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
    indices: positions.length / 3 > 65535 ? new Uint32Array(indices) : new Uint16Array(indices),
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
  const transfer = buildings ? [buildings.positions.buffer, buildings.normals.buffer, buildings.indices.buffer] : []
  self.postMessage({ tileName, found: true, lights, buildings }, transfer)
}
