import { Vector3 } from "three"

/*
 * Corner-finding helpers shared between landingGearRig.js (the real rig)
 * and gear-debug.js (the investigation tool that found where to put the
 * pivots in the first place - see the extended conversation this came out
 * of). Kept in one place so the rig can't quietly drift out of sync with
 * whatever the debug tool shows.
 */

// picks whichever corner of `part`'s own local bounding box ends up
// farthest from (pick === "farthest") or closest to (pick === "closest")
// `referenceWorldPos`, in world space. Used two ways: farthest-from-the-
// wheel finds a strut's fuselage-attach end (the wheel-attach end and the
// fuselage-attach end are the two extremes of a strut along its own long
// axis, whatever that axis actually is - no assumption needed about which
// local axis means "up" for a given part, which matters since several of
// these parts carry their own baked-in rotation); closest-to-the-trunnion
// finds a door's hinge edge, the edge nearest where its own leg mounts.
export function extremeCorner(part, referenceWorldPos, pick) {
  const geomBox = part.children[0]?.geometry?.boundingBox
  if (!geomBox) return null

  let best = null
  let bestDistSq = pick === "farthest" ? -Infinity : Infinity
  for (const x of [geomBox.min.x, geomBox.max.x]) {
    for (const y of [geomBox.min.y, geomBox.max.y]) {
      for (const z of [geomBox.min.z, geomBox.max.z]) {
        const worldCorner = part.localToWorld(new Vector3(x, y, z))
        const distSq = worldCorner.distanceToSquared(referenceWorldPos)
        const better = pick === "farthest" ? distSq > bestDistSq : distSq < bestDistSq
        if (better) {
          bestDistSq = distSq
          best = worldCorner
        }
      }
    }
  }
  return best
}

// finds a door's hinge EDGE: the edge extreme along `axis` ("x", "y", or
// "z" - the largest coordinate along it for sign === 1, smallest for
// sign === -1), tie-broken by `secondaryAxis`/`secondarySign`, running
// along `edgeAxis`. Returns the edge's two raw endpoints (endA, endB) plus
// the derived midpoint (a better pivot position than one arbitrary corner
// of the edge) and direction (to use as the rotation axis) - callers that
// snap the hinge onto another surface (see landingGearRig.js) should snap
// endA/endB independently and rederive position/axis from those, rather
// than snapping position alone: a door mesh's own edge direction doesn't
// necessarily match that surface's actual tangent, and rotating about an
// axis that doesn't lie along the real hinge line - even one that starts
// out touching it - lifts away from it as soon as the door opens.
//
// Used for the main gear doors' hinge edge: the real hinge is the
// OUTBOARD edge, and "closest corner to the trunnion" (extremeCorner
// above) actually finds the opposite one - the trunnion sits near the
// fuselage centerline, so its nearest door corner is the INBOARD edge,
// not the outboard one a real door hinges on. This instead picks the
// edge that's furthest out along the lateral (X) axis directly, which is
// what "outboard" actually means, rather than inferring it from
// proximity to an unrelated point.
//
// A box's extreme-X face has four corners, not one - they share the same
// X but differ in Y and Z, so "maximize X alone" leaves which of those
// four wins down to float tie-breaking, not anything meaningful. The
// secondary axis picks the right one deliberately instead: for a main
// gear door that means the outboard edge that's also the topmost one
// (secondaryAxis "z", secondarySign 1), matching how it actually sits
// against a curved fuselage cross-section, higher at the outboard side
// than at the belly centerline.
//
// The direction this returns also fixes a door hinge that looked visibly
// detached from the fuselage: a rotation about a plain world axis (x/y/z)
// assumes the hinge line runs dead straight along that axis, which only
// holds where the fuselage skin the door sits against is flat. Near the
// nose, the skin curves, so the real hinge line tilts with it - and the
// door's own mesh already carries that tilt (a small non-identity
// rotation baked into its node transform), so the edge's own actual
// direction in world space already IS the right tangent, without needing
// to measure the fuselage mesh itself.
export function findHingeEdge(part, axis, sign, secondaryAxis, secondarySign, edgeAxis) {
  const geomBox = part.children[0]?.geometry?.boundingBox
  if (!geomBox) return null

  // corners sharing the same nominal local-x face (say) don't land at
  // exactly the same world X once the part carries even a small rotation
  // of its own (several of these do - see the door parts' own near-
  // identity but not-quite-identity quaternions) - this has to be
  // comfortably bigger than that drift (a few cm for a ~1deg tilt over a
  // ~1m box) but well under the real gap between the outboard and inboard
  // faces (the door's own width), or the tie-break below never fires
  const FACE_TOLERANCE = 0.05 // meters

  let bestLocal = null
  let bestPrimary = -Infinity
  let bestSecondary = -Infinity
  for (const x of [geomBox.min.x, geomBox.max.x]) {
    for (const y of [geomBox.min.y, geomBox.max.y]) {
      for (const z of [geomBox.min.z, geomBox.max.z]) {
        const local = { x, y, z }
        const worldCorner = part.localToWorld(new Vector3(x, y, z))
        const primary = sign * worldCorner[axis]
        const secondary = secondarySign * worldCorner[secondaryAxis]
        const better = primary > bestPrimary + FACE_TOLERANCE || (primary > bestPrimary - FACE_TOLERANCE && secondary > bestSecondary)
        if (better) {
          bestPrimary = primary
          bestSecondary = secondary
          bestLocal = local
        }
      }
    }
  }
  if (!bestLocal) return null

  const endA = part.localToWorld(new Vector3(bestLocal.x, bestLocal.y, bestLocal.z))
  const otherEdgeValue = bestLocal[edgeAxis] === geomBox.min[edgeAxis] ? geomBox.max[edgeAxis] : geomBox.min[edgeAxis]
  const endB = part.localToWorld(new Vector3(...["x", "y", "z"].map((a) => (a === edgeAxis ? otherEdgeValue : bestLocal[a]))))

  return {
    position: endA.clone().add(endB).multiplyScalar(0.5),
    axis: endB.clone().sub(endA).normalize(),
    endA,
    endB,
  }
}

// closest pair of corners between two parts' local bounding boxes, in
// world space - same 8-corner idea as extremeCorner() above, just checked
// pairwise between two boxes (64 combinations) instead of one box against
// a fixed reference point. Originally just for finding joints BETWEEN
// separate parts for gear-debug.js's own STRUT_JOINT_GROUPS display; now
// also what landingGearRig.js uses to place a main leg's knee pivot -
// the axle bracket has to fold about the actual point it meets the strut,
// not a separately-chosen "this looks like a bend" point on the strut
// alone (an earlier version of the rig did that and the two visibly came
// apart as the knee rotated, since the two points were half a meter apart).
export function closestCornerPair(partA, partB) {
  const boxA = partA.children[0]?.geometry?.boundingBox
  const boxB = partB.children[0]?.geometry?.boundingBox
  if (!boxA || !boxB) return null

  let bestMidpoint = null
  let bestDistSq = Infinity
  for (const ax of [boxA.min.x, boxA.max.x]) {
    for (const ay of [boxA.min.y, boxA.max.y]) {
      for (const az of [boxA.min.z, boxA.max.z]) {
        const worldA = partA.localToWorld(new Vector3(ax, ay, az))
        for (const bx of [boxB.min.x, boxB.max.x]) {
          for (const by of [boxB.min.y, boxB.max.y]) {
            for (const bz of [boxB.min.z, boxB.max.z]) {
              const worldB = partB.localToWorld(new Vector3(bx, by, bz))
              const distSq = worldA.distanceToSquared(worldB)
              if (distSq < bestDistSq) {
                bestDistSq = distSq
                bestMidpoint = worldA.clone().lerp(worldB, 0.5)
              }
            }
          }
        }
      }
    }
  }
  return { midpoint: bestMidpoint, dist: Math.sqrt(bestDistSq) }
}
