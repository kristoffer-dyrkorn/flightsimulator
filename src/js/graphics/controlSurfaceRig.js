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
 *                              location for an all-moving tail's pivot.
 *   aileron (AileronR/L01)     these are trailing-edge surfaces, so they
 *                              hinge on their own leading edge - the straight
 *                              swept line the mesh's front two corners at
 *                              root and tip define.
 *   lef (VoletR/L01)           a leading-edge surface, so it hinges on its
 *                              own trailing edge - same construction as the
 *                              aileron, front swapped for back.
 *   rudder (RudderL01)         hinges on its own leading edge, root to tip.
 *   speedbrake                 BrakeR01+BrakeR02 turned out (see prior
 *                              analysis) to be the top and bottom skin of one
 *                              closed door, not two separate panels - they
 *                              pivot together as a rigid pair, about the
 *                              front edge they share. Same for BrakeL01/L02.
 *
 * `sign` flips the actuator angle where the axis chosen here - always
 * "root/inner corner pointing to tip/outer corner" - happens to put a
 * positive rotation the wrong way for that particular surface. A mirrored
 * pair needing opposite signs is expected: the axis itself is mirrored, the
 * physical motion is not.
 */

const HINGES = {
  elevator: [
    { mesh: "ElevatorR01", point: [-1.0825, 1.657, -5.548], axis: [1, 0, 0], sign: -1 },
    { mesh: "ElevatorL01", point: [1.0825, 1.657, -5.548], axis: [1, 0, 0], sign: -1 },
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
    {
      meshes: ["BrakeR01", "BrakeR02"],
      point: [-0.8904, 1.6987, -5.8841],
      axis: [0.3674, 0.0697, -0.0013],
      sign: 1,
    },
    {
      meshes: ["BrakeL01", "BrakeL02"],
      point: [0.8904, 1.6987, -5.8841],
      axis: [-0.3674, 0.0697, -0.0013],
      sign: -1,
    },
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
        })
      }
    }
  }

  /**
   * @param actuators  the ActuatorModel - actual (lagged, rate-limited)
   *                    control surface positions, in degrees
   */
  update(actuators) {
    for (const { channel, pivot, axis, sign } of this.pivots) {
      pivot.setRotationFromAxisAngle(axis, sign * actuators[channel] * MathUtils.DEG2RAD)
    }
  }
}
