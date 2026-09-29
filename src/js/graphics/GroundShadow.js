import { Mesh, BufferGeometry, ShadowMaterial } from "three"

// the shadow footprint is much smaller than a terrain tile, so it can
// overlap at most 4 tiles (at a tile corner)
const MAX_TILES = 4

const EMPTY_GEOMETRY = new BufferGeometry()

// Terrain tiles use an unlit material (their lighting is baked into the
// texture), so they can't receive shadows themselves. Instead, the tiles the
// aircraft's shadow falls on are drawn once more, in the aircraft's scene,
// with a material that only darkens where the shadow is. The copies share
// the tiles' geometry, and are pulled slightly towards the camera so they
// win the depth test against the terrain drawn in the first pass.
export default class GroundShadow {
  constructor(scene, opacity) {
    this.material = new ShadowMaterial({
      opacity,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -4,
    })

    this.meshes = []
    for (let i = 0; i < MAX_TILES; i++) {
      const mesh = new Mesh(EMPTY_GEOMETRY, this.material)
      mesh.receiveShadow = true
      mesh.visible = false
      scene.add(mesh)
      this.meshes.push(mesh)
    }
  }

  // tiles: the loaded tiles the shadow may fall on (empty to hide the shadow)
  update(tiles) {
    for (let i = 0; i < MAX_TILES; i++) {
      const mesh = this.meshes[i]
      const tile = tiles[i]

      if (tile) {
        // the tiles are unlit and come without normals, but the shadow
        // lookup offsets each point along its normal (shadow.normalBias) -
        // without them no point on the ground would ever be in shadow
        const geometry = tile.tileMesh.geometry
        if (!geometry.attributes.normal) geometry.computeVertexNormals()

        mesh.geometry = geometry
        mesh.position.copy(tile.tileMesh.position)
        mesh.quaternion.copy(tile.tileMesh.quaternion)
        mesh.visible = true
      } else {
        // don't hold on to geometry from tiles that may since have been unloaded
        mesh.geometry = EMPTY_GEOMETRY
        mesh.visible = false
      }
    }
  }
}
