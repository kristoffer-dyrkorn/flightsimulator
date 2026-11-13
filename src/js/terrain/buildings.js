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

// a neutral grey, as the walls and roofs are seen in full daylight
const BUILDING_COLOR = new Color(0.17, 0.17, 0.17)
// Lit like the terrain round them - by Tile.light, the daylight's colour and
// strength - and shaded by the sun: AMBIENT on the side away from it, and
// up to AMBIENT + DIRECT facing it. The sun is the one the sky shows - see
// setSunDirection.
const AMBIENT = 0.5
const DIRECT = 0.75

export default class Buildings {
  constructor(scene) {
    this.scene = scene
    // tileName -> its mesh, while the tile is loaded
    this.meshes = new Map()

    this.sunDirection = { value: new Vector3(0, 0, 1) }
    this.material = new MeshBasicMaterial()
    // tinted by the daylight, as the terrain is - see Tile
    this.material.color = Tile.light
    useHorizonFog(this.material)
    const previous = this.material.onBeforeCompile
    this.material.onBeforeCompile = (shader, renderer) => {
      previous?.call(this.material, shader, renderer)
      shader.uniforms.sunDirection = this.sunDirection
      shader.vertexShader = shader.vertexShader
        .replace("#include <common>", "#include <common>\nuniform vec3 sunDirection;\nvarying float vShade;")
        .replace(
          "#include <begin_vertex>",
          /* glsl */ `#include <begin_vertex>
          // the mesh is never turned, so its normals are the scene's - and
          // the sun gives no direct light once it is down
          float sunUp = smoothstep(-0.02, 0.05, sunDirection.z);
          vShade = ${AMBIENT.toFixed(2)} + ${DIRECT.toFixed(2)} * sunUp * max(dot(normal, sunDirection), 0.0);`,
        )
      shader.fragmentShader = shader.fragmentShader
        .replace("#include <common>", "#include <common>\nvarying float vShade;")
        .replace(
          "vec4 diffuseColor = vec4( diffuse, opacity );",
          `vec4 diffuseColor = vec4( diffuse * vec3(${BUILDING_COLOR.toArray().map((c) => c.toFixed(3)).join(", ")}) * vShade, opacity );`,
        )
    }
    const key = this.material.customProgramCacheKey
    this.material.customProgramCacheKey = () => key.call(this.material) + "+buildings"
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
    this.meshes.delete(tileName)
  }

  /**
   * Shows a tile's buildings - as sceneryWorker.js made them into a mesh.
   *
   * @param tileName  "{lowerLeftEasting}-{lowerLeftNorthing}"
   */
  add(tileName, { positions, normals, indices, center, radius }) {
    if (this.meshes.has(tileName)) return
    const [, x, y] = tileName.match(/^(-?\d+)-(-?\d+)$/).map(Number)

    const geometry = new BufferGeometry()
    geometry.setAttribute("position", new BufferAttribute(positions, 3))
    geometry.setAttribute("normal", new BufferAttribute(normals, 4, true))
    geometry.setIndex(new BufferAttribute(indices, 1))
    geometry.boundingSphere = new Sphere(new Vector3(...center), radius)

    const mesh = new Mesh(geometry, this.material)
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
    for (const mesh of this.meshes.values()) {
      const [x, y] = mesh.userData.corner
      const dx = Math.max(x - camera.position.x, 0, camera.position.x - (x + TILE_EXTENTS))
      const dy = Math.max(y - camera.position.y, 0, camera.position.y - (y + TILE_EXTENTS))
      mesh.visible = daylight && Math.hypot(dx, dy) < VISIBLE_DISTANCE
    }
  }
}
