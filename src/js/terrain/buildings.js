import { BufferAttribute, BufferGeometry, Color, Mesh, MeshBasicMaterial, Sphere, Vector3 } from "three"
import Tile from "./tile.js"
import { useHorizonFog } from "../sky/horizonFog.js"

/*
 * Buildings, from Overture Maps: each one its outline raised to its height,
 * standing on the terrain. They are in the tiles' scenery files (see
 * scenery.js), as MultiPolygons, one for each height, { h } meters - each
 * polygon a building's outline in the tile's own coordinates, east and north
 * from its lower left corner, with the ground height under the building as
 * the third coordinate.
 *
 * A tile's buildings are one mesh, built in a worker (see sceneryWorker.js),
 * so they are a single draw call, and building them doesn't hold up a
 * frame. They are left out beyond VISIBLE_DISTANCE, where they are too small
 * to see, and out of view - and in the dark, when the scenery's lights show
 * instead: see SHOWN_UNTIL_LIGHTS.
 */

// how far off a tile's buildings are still drawn, m - from its nearest edge
const VISIBLE_DISTANCE = 15000
const TILE_EXTENTS = 50 * 255

// The buildings are shown in daylight, and the lights at night: the
// buildings go once the lights are this far on, 0 to 1 - see
// SceneryLights.level. The lights are inside the buildings, so with both
// shown the walls would hide them.
const SHOWN_UNTIL_LIGHTS = 0.5

// Far off, the smaller buildings are left out, as they would only be a
// pixel or two: a building is drawn while its size - the largest of its
// width, length and height - is at least SIZE_PER_DISTANCE of its distance,
// and always within ALL_WITHIN. A 3 m shed goes beyond 2 km, an 8 m house
// beyond some 5 km, a 20 m block beyond 13 km. Gone, not just hidden: each
// cell of a tile has its buildings from the largest to the smallest (see
// sceneryWorker.js), and draws only the start of them, as far as the
// smallest still drawn at its nearest point.
const SIZE_PER_DISTANCE = 0.0015
const ALL_WITHIN = 1500 // m

// a neutral grey, as the walls and roofs are seen in full daylight
const BUILDING_COLOR = new Color(0.17, 0.17, 0.17)
// Lit like the terrain round them - by Tile.light, the daylight's colour and
// strength - and shaded by the sun: AMBIENT on the side away from it, and
// up to AMBIENT + DIRECT facing it. The sun is the one the sky shows - see
// setSunDirection.
const AMBIENT = 0.5
const DIRECT = 0.75

// The roofs take the colour of the terrain's photo where they are - the
// photo shows the roofs themselves, from above - tinted by the daylight as
// the terrain is. Until the photo is in, they are grey like the walls.
//
// The photo is sampled up to ROOF_INSET in from a roof's edge, towards the
// building's centre - so a small roof takes the colour of its middle - as
// at the edge the outline and the photo don't quite meet, and the roof
// took on the grass or the road beside it.
const ROOF_INSET = 2 // m
// And the photo's own light is in it already, so a roof is only shaded by
// the sun this much of what a wall is.
const ROOF_SHADING = 0.3

export default class Buildings {
  /**
   * @param terrainMap  the terrain texture of a tile, by its name - or null
   *                    while it isn't in
   */
  constructor(scene, terrainMap) {
    this.scene = scene
    this.terrainMap = terrainMap
    // tileName -> its mesh, while the tile is loaded
    this.meshes = new Map()

    this.sunDirection = { value: new Vector3(0, 0, 1) }
  }

  // A material for a tile's buildings, with the tile's photo for the roofs -
  // one each, as the photos differ, but all the same program
  material() {
    const material = new MeshBasicMaterial()
    // tinted by the daylight, as the terrain is - see Tile
    material.color = Tile.light
    useHorizonFog(material)
    const roofs = { terrainMap: { value: null }, hasTerrainMap: { value: false } }
    material.userData.roofs = roofs
    const previous = material.onBeforeCompile
    material.onBeforeCompile = (shader, renderer) => {
      previous?.call(material, shader, renderer)
      shader.uniforms.sunDirection = this.sunDirection
      Object.assign(shader.uniforms, roofs)
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          "#include <common>\nuniform vec3 sunDirection;\nattribute vec2 roofCenter;\nvarying float vShade;\nvarying float vRoof;\nvarying vec2 vGround;\nvarying vec2 vRoofCenter;",
        )
        .replace(
          "#include <begin_vertex>",
          /* glsl */ `#include <begin_vertex>
          // the mesh is never turned, so its normals are the scene's - and
          // the sun gives no direct light once it is down
          float sunUp = smoothstep(-0.02, 0.05, sunDirection.z);
          vShade = ${AMBIENT.toFixed(2)} + ${DIRECT.toFixed(2)} * sunUp * max(dot(normal, sunDirection), 0.0);
          vRoof = step(0.5, normal.z);
          vGround = position.xy;
          vRoofCenter = roofCenter;`,
        )
      shader.fragmentShader = shader.fragmentShader
        .replace(
          "#include <common>",
          "#include <common>\nuniform sampler2D terrainMap;\nuniform bool hasTerrainMap;\nvarying float vShade;\nvarying float vRoof;\nvarying vec2 vGround;\nvarying vec2 vRoofCenter;",
        )
        .replace(
          "vec4 diffuseColor = vec4( diffuse, opacity );",
          /* glsl */ `vec3 wall = vec3(${BUILDING_COLOR.toArray().map((c) => c.toFixed(3)).join(", ")}) * vShade;
          // see ROOF_INSET - and where the terrain's photo has that point: as
          // the terrain tiles have it, east across and north up, over the tile
          vec2 inward = vRoofCenter - vGround;
          vec2 sampled = vGround + inward * min(1.0, ${ROOF_INSET.toFixed(1)} / max(length(inward), 0.001));
          vec2 terrainUv = vec2(sampled.x / ${TILE_EXTENTS.toFixed(1)}, 1.0 - sampled.y / ${TILE_EXTENTS.toFixed(1)});
          // see ROOF_SHADING - the shade as a share of the most a wall gets
          float roofShade = mix(1.0, vShade / ${(AMBIENT + DIRECT).toFixed(2)}, ${ROOF_SHADING.toFixed(2)});
          vec3 roof = hasTerrainMap ? texture2D(terrainMap, terrainUv).rgb * roofShade : wall;
          vec4 diffuseColor = vec4( diffuse * mix(wall, roof, vRoof), opacity );`,
        )
    }
    const key = material.customProgramCacheKey
    material.customProgramCacheKey = () => key.call(material) + "+buildings"
    return material
  }

  /**
   * Which way the sun is, in the scene's frame (z up) - kept, not copied, so
   * pass the vector the sun is kept in.
   */
  setSunDirection(direction) {
    this.sunDirection.value = direction
  }

  /** Takes a tile's buildings away - call when the tile is unloaded. */
  unload(tileName) {
    const mesh = this.meshes.get(tileName)
    if (!mesh) return
    this.scene.remove(mesh)
    mesh.geometry.dispose()
    mesh.userData.material.dispose()
    this.meshes.delete(tileName)
  }

  /**
   * Shows a tile's buildings - as sceneryWorker.js made them into a mesh.
   *
   * @param tileName  "{lowerLeftEasting}-{lowerLeftNorthing}"
   */
  add(tileName, { positions, normals, centers, indices, cells, cellSize, center, radius }) {
    if (this.meshes.has(tileName)) return
    const [, x, y] = tileName.match(/^(-?\d+)-(-?\d+)$/).map(Number)

    const geometry = new BufferGeometry()
    geometry.setAttribute("position", new BufferAttribute(positions, 3))
    geometry.setAttribute("normal", new BufferAttribute(normals, 4, true))
    geometry.setAttribute("roofCenter", new BufferAttribute(centers, 2))
    geometry.setIndex(new BufferAttribute(indices, 1))
    geometry.boundingSphere = new Sphere(new Vector3(...center), radius)
    // a draw for each cell, all with the tile's one material - see
    // SIZE_PER_DISTANCE
    for (const cell of cells) geometry.addGroup(cell.start, cell.ends[cell.ends.length - 1] - cell.start, 0)

    const material = this.material()
    const mesh = new Mesh(geometry, [material])
    mesh.userData.material = material
    mesh.userData.cells = cells
    mesh.userData.cellSize = cellSize
    mesh.name = `buildings ${tileName}`
    mesh.position.set(x, y, 0)
    mesh.updateMatrix()
    mesh.matrixAutoUpdate = false
    mesh.userData.corner = [x, y]
    this.scene.add(mesh)
    this.meshes.set(tileName, mesh)
    console.log(`${tileName}: ${indices.length / 3} building triangles`)
  }

  /**
   * Leaves out the tiles too far off to see, and all of them in the dark -
   * call every frame.
   *
   * @param lightsLevel  how far on the scenery's lights are - see
   *                     SHOWN_UNTIL_LIGHTS
   */
  update(camera, lightsLevel) {
    const daylight = lightsLevel < SHOWN_UNTIL_LIGHTS
    for (const [tileName, mesh] of this.meshes) {
      // the roofs' photo - the tile's, once it is in
      const roofs = mesh.userData.material.userData.roofs
      roofs.terrainMap.value = this.terrainMap(tileName)
      roofs.hasTerrainMap.value = roofs.terrainMap.value !== null

      const [x, y] = mesh.userData.corner
      const dx = Math.max(x - camera.position.x, 0, camera.position.x - (x + TILE_EXTENTS))
      const dy = Math.max(y - camera.position.y, 0, camera.position.y - (y + TILE_EXTENTS))
      mesh.visible = daylight && Math.hypot(dx, dy) < VISIBLE_DISTANCE
      if (!mesh.visible) continue

      // see SIZE_PER_DISTANCE - from each cell's nearest point
      const { cells, cellSize } = mesh.userData
      cells.forEach((cell, k) => {
        const cx = Math.max(x + cell.x - camera.position.x, 0, camera.position.x - (x + cell.x + cellSize))
        const cy = Math.max(y + cell.y - camera.position.y, 0, camera.position.y - (y + cell.y + cellSize))
        const distance = Math.hypot(cx, cy)
        const smallest = distance < ALL_WITHIN ? 0 : distance * SIZE_PER_DISTANCE
        // the buildings drawn: those at least that size, at the start
        let low = 0
        let high = cell.sizes.length
        while (low < high) {
          const middle = (low + high) >> 1
          if (cell.sizes[middle] >= smallest) low = middle + 1
          else high = middle
        }
        mesh.geometry.groups[k].count = low === 0 ? 0 : cell.ends[low - 1] - cell.start
      })
    }
  }
}
