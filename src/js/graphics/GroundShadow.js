import { Mesh, BufferGeometry, BufferAttribute, ShadowMaterial, Box3, Matrix4, Vector3 } from "three"

// the shadow footprint is much smaller than a terrain tile, so it can
// overlap at most 4 tiles (at a tile corner)
const MAX_TILES = 4

// room for this many triangles under the shadow, to start with - the index
// grows if a footprint ever needs more
const INITIAL_TRIANGLES = 1024

const EMPTY_GEOMETRY = new BufferGeometry()

// Terrain tiles use an unlit material (their lighting is baked into the
// texture), so they can't receive shadows themselves. Instead, the part of
// each tile the aircraft's shadow falls on is drawn once more, in the
// aircraft's scene, with a material that only darkens where the shadow is.
// Only that part: the triangles under the shadow's footprint, found with the
// tile's BVH - the whole tile, redrawn at full resolution, cost more than
// all the rest of the aircraft's drawing low over the ground. The copies
// share the tiles' vertices, and are pulled slightly towards the camera so
// they win the depth test against the terrain drawn in the first pass.
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
      const geometry = new BufferGeometry()
      const index = new BufferAttribute(new Uint32Array(3 * INITIAL_TRIANGLES), 1)
      const mesh = new Mesh(EMPTY_GEOMETRY, this.material)
      mesh.userData = { geometry, index }
      mesh.receiveShadow = true
      mesh.visible = false
      scene.add(mesh)
      this.meshes.push(mesh)
    }

    this.footprint = new Box3()
    this.local = new Box3()
    this.toTile = new Matrix4()
    this.corner = new Vector3()
  }

  // hides the shadow until the next update() - see drawScene in index.js
  hide() {
    for (const mesh of this.meshes) mesh.visible = false
  }

  // tiles: the loaded tiles the shadow may fall on (empty to hide the
  // shadow); centre: where on the ground (scene x and y) the shadow is, and
  // reach: how far from there, in x and y, it can fall
  update(tiles, centre, reach) {
    this.footprint.min.set(centre.x - reach, centre.y - reach, -1e5)
    this.footprint.max.set(centre.x + reach, centre.y + reach, 1e5)

    for (let i = 0; i < MAX_TILES; i++) {
      const mesh = this.meshes[i]
      const tile = tiles[i]

      if (!tile) {
        // don't hold on to geometry from tiles that may since have been unloaded
        mesh.geometry = EMPTY_GEOMETRY
        mesh.visible = false
        continue
      }

      // the tiles are unlit and come without normals, but the shadow lookup
      // offsets each point along its normal (shadow.normalBias) - without
      // them no point on the ground would ever be in shadow
      const tileGeometry = tile.tileMesh.geometry
      if (!tileGeometry.attributes.normal) tileGeometry.computeVertexNormals()
      if (!tileGeometry.boundingSphere) tileGeometry.computeBoundingSphere()

      mesh.position.copy(tile.tileMesh.position)
      mesh.quaternion.copy(tile.tileMesh.quaternion)
      mesh.updateMatrixWorld()
      mesh.visible = true

      // until the tile's BVH is built, the whole tile
      if (!tileGeometry.boundsTree) {
        mesh.geometry = tileGeometry
        continue
      }

      const geometry = mesh.userData.geometry
      geometry.setAttribute("position", tileGeometry.attributes.position)
      geometry.setAttribute("normal", tileGeometry.attributes.normal)
      geometry.boundingSphere = tileGeometry.boundingSphere
      const count = this.trianglesUnder(mesh, tileGeometry)
      geometry.setIndex(mesh.userData.index)
      geometry.setDrawRange(0, 3 * count)
      mesh.geometry = geometry
      mesh.visible = count > 0
    }
  }

  // copies the tile's triangles under the footprint - in the BVH's leaves
  // that reach into it, each a run of triangles in the tile's index - into
  // the mesh's own index, and returns how many there are
  trianglesUnder(mesh, tileGeometry) {
    this.toTile.copy(mesh.matrixWorld).invert()
    this.local.makeEmpty()
    for (const x of [this.footprint.min.x, this.footprint.max.x]) {
      for (const y of [this.footprint.min.y, this.footprint.max.y]) {
        for (const z of [this.footprint.min.z, this.footprint.max.z]) {
          this.local.expandByPoint(this.corner.set(x, y, z).applyMatrix4(this.toTile))
        }
      }
    }

    const source = tileGeometry.index.array
    let count = 0
    tileGeometry.boundsTree.shapecast({
      intersectsBounds: (box) => box.intersectsBox(this.local),
      intersectsRange: (offset, triangles) => {
        let index = mesh.userData.index
        if (3 * (count + triangles) > index.array.length) {
          const grown = new Uint32Array(Math.max(2 * index.array.length, 3 * (count + triangles)))
          grown.set(index.array.subarray(0, 3 * count))
          index = mesh.userData.index = new BufferAttribute(grown, 1)
        }
        index.array.set(source.subarray(3 * offset, 3 * (offset + triangles)), 3 * count)
        count += triangles
        return false
      },
    })

    const index = mesh.userData.index
    index.clearUpdateRanges()
    index.addUpdateRange(0, 3 * count)
    index.needsUpdate = true
    return count
  }
}
