import { Group, Vector3, MathUtils } from "three"

/*
 * Pivots the named meshes in the loaded f16.obj model about their real hinge
 * lines, and moves them from the actuator model's surface positions every
 * frame.
 *
 * The OBJ carries no joint data - it is one static pose - so every hinge below
 * is a point and an axis direction in the model's own local space (the space
 * its vertices are authored in, before loadAircraftModel's alignment
 * rotations), worked out once from the mesh geometry itself:
 *
 *   elevator (ElevatorR/L01)   the flat rib each stabilator was cut from at
 *                              its root is a single plane of constant local
 *                              X - that plane is the pivot, axis spanwise.
 *                              The chordwise station on it is not in the
 *                              geometry (nothing marks the real actuator
 *                              attachment) - it is estimated at 38% of the
 *                              root chord aft of the leading edge, a typical
 *                              location for an all-moving tail's pivot. The
 *                              two stabilators move independently - `diff`
 *                              adds the differential roll command on top of
 *                              the symmetric one, same as the physics model
 *                              (f16simulation.js) does when it evaluates the
 *                              tail's aerodynamics per side.
 *   aileron (AileronR/L01)     these are trailing-edge surfaces, so they
 *                              hinge on their own leading edge - the straight
 *                              swept line the mesh's front two corners at
 *                              root and tip define.
 *   lef (VoletR/L01)           a leading-edge surface, so it hinges on its
 *                              own trailing edge - same construction as the
 *                              aileron, front swapped for back.
 *   rudder (RudderL01)         hinges on its own leading edge, root to tip.
 *   speedbrake                 a real clamshell pair per side: BrakeR01 (the
 *                              top panel) and BrakeR02 (the bottom panel)
 *                              share a hinge line along the front edge of the
 *                              cutout, and meet flush along a knife edge at
 *                              the back when closed - which is why they share
 *                              so many vertices - but they open in opposite
 *                              senses about that same hinge, top swinging up
 *                              and bottom swinging down. Same for BrakeL01/L02.
 *
 * `sign` flips the actuator angle where the axis chosen here - always
 * "root/inner corner pointing to tip/outer corner" - happens to put a
 * positive rotation the wrong way for that particular surface. A mirrored
 * pair needing opposite signs is expected: the axis itself is mirrored, the
 * physical motion is not.
 */

const HINGES = {
  elevator: [
    // diff: right gets more (down-)deflection, left gets less - see the
    // comment above elLeft/elRight in f16simulation.js for why that is the
    // combination that rolls left for a positive differential
    { mesh: "ElevatorR01", point: [-1.0825, 1.657, -5.548], axis: [1, 0, 0], sign: -1, diff: 1 },
    { mesh: "ElevatorL01", point: [1.0825, 1.657, -5.548], axis: [1, 0, 0], sign: -1, diff: -1 },
  ],
  aileron: [
    { mesh: "AileronR01", point: [-1.0855, 1.629, -2.734], axis: [-2.5629, -0.02, -0.3885], sign: 1 },
    { mesh: "AileronL01", point: [1.0855, 1.629, -2.734], axis: [2.5629, -0.02, -0.3885], sign: 1 },
  ],
  lef: [
    { mesh: "VoletR01", point: [-1.3583, 1.5915, -0.4258], axis: [-3.2571, -0.0008, -2.1933], sign: -1 },
    { mesh: "VoletL01", point: [1.3583, 1.5915, -0.4258], axis: [3.2571, -0.0008, -2.1933], sign: 1 },
  ],
  rudder: [{ mesh: "RudderL01", point: [0, 2.7924, -5.6267], axis: [0, 1.9664, -1.2838], sign: 1 }],
  speedbrake: [
    // right side: top panel opens up, bottom panel opens down, both about
    // the same hinge line - not a rigid pair
    { mesh: "BrakeR01", point: [-0.8904, 1.6987, -5.8841], axis: [0.3674, 0.0697, -0.0013], sign: 1 },
    { mesh: "BrakeR02", point: [-0.8904, 1.6987, -5.8841], axis: [0.3674, 0.0697, -0.0013], sign: -1 },
    // left side, mirrored
    { mesh: "BrakeL01", point: [0.8904, 1.6987, -5.8841], axis: [-0.3674, 0.0697, -0.0013], sign: -1 },
    { mesh: "BrakeL02", point: [0.8904, 1.6987, -5.8841], axis: [-0.3674, 0.0697, -0.0013], sign: 1 },
  ],
}

export default class ControlSurfaceRig {
  /**
   * @param object  the root Group returned by OBJLoader for f16.obj - every
   *                named mesh below is a direct child of it.
   */
  constructor(object) {
    this.pivots = []

    for (const [channel, entries] of Object.entries(HINGES)) {
      for (const entry of entries) {
        const meshNames = entry.meshes ?? [entry.mesh]
        const meshes = meshNames.map((name) => object.getObjectByName(name))

        if (meshes.some((mesh) => !mesh)) {
          console.log("Control surface mesh not found: %s", meshNames.join(", "))
          continue
        }

        // the pivot sits at the hinge point; each mesh is offset by the
        // opposite of that point before joining it, which cancels out at
        // rest (rotation = 0) and leaves the mesh exactly where the OBJ put
        // it, while giving the pivot's rotation the hinge point to turn
        // around instead of the model's origin.
        const parent = meshes[0].parent
        const pivot = new Group()

        pivot.position.set(...entry.point)

        for (const mesh of meshes) {
          mesh.position.set(-entry.point[0], -entry.point[1], -entry.point[2])
          pivot.add(mesh)
        }

        parent.add(pivot)

        this.pivots.push({
          channel,
          pivot,
          axis: new Vector3(...entry.axis).normalize(),
          sign: entry.sign,
          diff: entry.diff ?? 0,
        })
      }
    }
  }

  /**
   * @param actuators  the ActuatorModel - actual (lagged, rate-limited)
   *                    control surface positions, in degrees
   */
  update(actuators) {
    for (const { channel, pivot, axis, sign, diff } of this.pivots) {
      const deg = actuators[channel] + diff * actuators.stabilatorDiff
      pivot.setRotationFromAxisAngle(axis, sign * deg * MathUtils.DEG2RAD)
    }
  }
}
