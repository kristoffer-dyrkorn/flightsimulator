import { BufferGeometry, Float32BufferAttribute, Mesh, Vector3 } from "three"

/*
 * Moves the triangles of a mesh that pass a test into a mesh of their own,
 * with the same material, so that part of the model can be shown or hidden
 * on its own - for parts the model's author didn't keep separate.
 *
 * Only for non-indexed geometry without material groups, which is what
 * OBJLoader makes of a single-material object.
 *
 * @param mesh    the mesh to split, left with the triangles that fail the test
 * @param name    name of the new mesh
 * @param frame   Matrix4 taking the mesh's vertices into the frame the test
 *                works in
 * @param inside  test, given a triangle's three vertices (Vector3, in
 *                `frame`), true for the triangles to move
 * @returns the new mesh, added next to the original, or null if no triangle
 *          passed the test
 */
export function splitOffTriangles(mesh, name, frame, inside) {
  const geometry = mesh.geometry
  const position = geometry.attributes.position
  const attributeNames = Object.keys(geometry.attributes)

  const kept = Object.fromEntries(attributeNames.map((n) => [n, []]))
  const moved = Object.fromEntries(attributeNames.map((n) => [n, []]))
  const vertices = [new Vector3(), new Vector3(), new Vector3()]

  for (let i = 0; i < position.count; i += 3) {
    for (let k = 0; k < 3; k++) vertices[k].fromBufferAttribute(position, i + k).applyMatrix4(frame)

    const target = inside(vertices) ? moved : kept
    for (const n of attributeNames) {
      const attribute = geometry.attributes[n]
      const start = i * attribute.itemSize
      target[n].push(...attribute.array.subarray(start, start + 3 * attribute.itemSize))
    }
  }

  if (moved.position.length === 0) return null

  const build = (data) => {
    const result = new BufferGeometry()
    for (const n of attributeNames) {
      result.setAttribute(n, new Float32BufferAttribute(data[n], geometry.attributes[n].itemSize))
    }
    return result
  }

  mesh.geometry = build(kept)
  geometry.dispose()

  const part = new Mesh(build(moved), mesh.material)
  part.name = name
  part.position.copy(mesh.position)
  part.quaternion.copy(mesh.quaternion)
  part.scale.copy(mesh.scale)
  mesh.parent.add(part)

  return part
}
