import { Group, Object3D, MathUtils, Vector3, Matrix4 } from "three"
import { extremeCorner, findHingeEdge } from "./gearGeometry.js"

/*
 * Landing gear legs (struts + wheels) are a hard visibility toggle again -
 * no rotation, no pivot rig - driven by the same continuous
 * controlActuators.gear position index.js passes in, just thresholded
 * back down to an on/off. The gear-bay doors are NOT part of that
 * reversion: they still hinge and rotate open/closed as before (see the
 * extended investigation this came out of - gear-debug.html and the rest
 * of the conversation this file's git history holds) - only the legs went
 * back to the original show/hide behavior.
 *
 * This is a deliberate simplification, not the first cut of this file.
 * Earlier versions here rigged each leg to actually fold - a single rigid
 * rotation per leg, then a two-trunnion model for the main legs (yoke and
 * strut pivoting separately), then a third joint at the strut's own
 * mid-knuckle requiring the strut mesh itself to be split into two rigid
 * pieces. That last step is where it was abandoned: after multiple rounds
 * of fixing the wrong hinge point, the wrong rotation sign, and the wrong
 * axis, the strut split still weren't confirmed to actually be rendering
 * a correct fold, and the fuselage has no wheel-well cavity modeled
 * anyway (see the doors' own history for the same problem) - so a
 * retracted leg was always going to rest on the outside of the belly, not
 * disappear into it, regardless of how correct the fold itself was. The
 * doors don't have that problem (a door's own authored shape already
 * looks right open or closed, whether the leg inside is real geometry or
 * just implied), so they kept their rig.
 */

// which meshes make up each leg (the moving struts/wheel, shown/hidden as
// a group) and door (still hinged - see the header comment above).
const LEG_CONFIGS = [
  {
    name: "nose",
    strutParts: ["F-16_chassesFront1_LOD0_4", "F-16_chassesFront2_LOD0_5", "F-16_chassesFront3_LOD0_6"],
    wheelName: "F-16_whel_LOD0_36",
    doorPart: "F-16_capFlont_LOD0_1",
    // forward (toward the nose) net 0.48m (0.2 + 0.2 + 0.08) - see mainL's
    // own doorPositionOffset comment below for the +Y-forward convention
    // and why this is applied to the door mesh before its hinge is computed
    doorPositionOffset: [0, 0.48, 0],
    // door hinge edge: the more-extreme side of the door's own (slightly
    // off-center) local bounding box, topmost point of that edge - see
    // the constructor's use of findHingeEdge, and its own comment, for why
    // this doesn't just rotate about a plain world axis. The nose door
    // sits on a curved part of the fuselage (unlike the main doors'
    // flatter belly), so a world-axis rotation left it visibly detached
    // from the body as it swung open - the fix uses the door's own actual
    // edge direction instead of assuming one.
    //
    // primarySign was -1 (opened to the wrong side, hinge on the wrong
    // edge - visually confirmed) and is now flipped to the opposite edge
    // of the door; doorSign flips along with it for the same reason it did
    // on the main gear doors below - moving the hinge to the other edge
    // swaps which way the panel's own mass sweeps for a given sign.
    doorHingePrimaryAxis: "x",
    doorHingePrimarySign: 1,
    doorHingeSecondaryAxis: "z",
    doorHingeSecondarySign: 1,
    doorAngleDeg: 95,
    doorSign: -1,
  },
  {
    name: "mainL",
    strutParts: ["F-16_chassesL1_LOD0_7", "F-16_chassesL2_LOD0_8", "F-16_chassesL3_LOD0_9", "F-16_chassesL4_LOD0_10"],
    wheelName: "F-16_whelL_LOD0_37",
    doorPart: "F-16_capL_LOD0_2",
    // aft (toward the tail) net 0.45m - world/object-frame Y is
    // longitudinal with +Y forward (toward the nose), confirmed repeatedly
    // throughout this rig's investigation, so aft is -Y. Started at -0.6,
    // moved forward 0.15 from there. Applied to the door mesh itself (see
    // the constructor), before its hinge is computed from its own
    // geometry, so the hinge point moves with it.
    doorPositionOffset: [0, -0.45, 0],
    // outboard = more negative X on the left side, topmost point of that
    // edge - see the nose leg's comment above on why this is an actual
    // edge direction (findHingeEdge) rather than a plain world axis
    doorHingePrimaryAxis: "x",
    doorHingePrimarySign: -1,
    doorHingeSecondaryAxis: "z",
    doorHingeSecondarySign: 1,
    doorAngleDeg: 95,
    // sign flipped from the inboard-hinge version: with the pivot on the
    // OUTBOARD edge, the door's own body sits inboard of it, so the same
    // sign that used to swing the door down now swings its inboard bulk
    // across past the centerline instead (the "doors swapped sides"
    // symptom) - moving the hinge changes which way the panel's mass
    // sweeps for a given rotation sign, even though the axis is unchanged
    doorSign: -1,
  },
  {
    name: "mainR",
    strutParts: ["F-16_chassesR1_LOD0_11", "F-16_chassesR2_LOD0_12", "F-16_chassesR3_LOD0_13", "F-16_chassesR4_LOD0_14"],
    wheelName: "F-16_whelR_LOD0_38",
    doorPart: "F-16_capR_LOD0_3",
    doorPositionOffset: [0, -0.45, 0], // see mainL's comment above
    doorHingePrimaryAxis: "x",
    doorHingePrimarySign: 1, // outboard = more positive X on the right side
    doorHingeSecondaryAxis: "z",
    doorHingeSecondarySign: 1,
    doorAngleDeg: 95,
    doorSign: 1, // see mainL's comment above on why this flipped along with the hinge point
  },
]

// smoothstep, 0 below edge0, 1 above edge1, eased in between - used for
// the door "hump" below
function smoothstep(edge0, edge1, x) {
  const t = MathUtils.clamp((x - edge0) / (edge1 - edge0), 0, 1)
  return t * t * (3 - 2 * t)
}

// doors open early and STAY open once the gear is down - real F-16 main
// gear doors hang open in the down-and-locked position, they don't cycle
// shut again over the extended leg (an earlier version of this used a
// closed-open-closed "hump" for all doors, which was wrong for exactly
// this reason). A plain one-way ramp: closed at g=0, fully open by
// g=0.25, held open the rest of the way to g=1. Retracting reverses it
// the same way any function of g does - closes again as g drops back
// through 0.25-0.05.
function doorOpenness(g) {
  return smoothstep(0.05, 0.25, g)
}

// legs are visible once the gear is more than half extended, hidden
// otherwise - a plain threshold on the same continuous actuator value the
// doors animate from, standing in for the instant boolean toggle the very
// first version of this file used directly
const LEG_VISIBLE_ABOVE = 0.5

export default class LandingGearRig {
  /**
   * @param object  the root Group the gear glTF scene was loaded into -
   *                every named node in LEG_CONFIGS is a child of it,
   *                already scaled/rotated/nudged into place against the
   *                OBJ fuselage by the time this runs (see index.js's
   *                loadLandingGear).
   */
  constructor(object) {
    this.legs = []
    this.wheels = {}

    for (const config of LEG_CONFIGS) {
      const wheel = object.getObjectByName(config.wheelName)
      if (!wheel) {
        console.log("Landing gear rig: part not found for leg %s", config.name)
        continue
      }

      // the wheels never move now (no rig, just show/hide - see this
      // file's header), so a direct reference to the wheel mesh itself
      // already IS "where they'd be if extended", which is what
      // index.js's ground-contact/crash check wants (see
      // evaluateLandingConditions's own comment) regardless of whether
      // the gear is currently showing
      this.wheels[{ nose: "nose", mainL: "left", mainR: "right" }[config.name]] = wheel

      const strutMeshes = [wheel]
      for (const partName of config.strutParts) {
        const part = object.getObjectByName(partName)
        if (part) strutMeshes.push(part)
      }

      let doorPivot = null
      let doorHingeAxisLocal = null
      const door = object.getObjectByName(config.doorPart)
      if (door) {
        // move the door mesh itself first, if this leg wants that (main
        // gear doors only - see doorPositionOffset above), so the hinge
        // computed below reflects the door's real, shifted geometry
        // rather than its original authored position. Same "go through
        // world space" approach index.js's own nudge() uses for the gear
        // legs as a whole, for the same reason: door.position alone is in
        // whatever local frame its current parent happens to use, which
        // isn't necessarily aligned with object's own (world-aligned) axes.
        if (config.doorPositionOffset) {
          const worldPos = door.getWorldPosition(new Vector3())
          worldPos.add(new Vector3(...config.doorPositionOffset))
          door.position.copy(door.parent.worldToLocal(worldPos))
        }

        // the door's actual hinge EDGE (position + tangent direction), not
        // just a single corner picked by proximity to something else - see
        // findHingeEdge's own comment for why a plain world axis isn't
        // enough once the fuselage surface the door sits against curves
        // (the nose in particular). Deliberately NOT snapped onto the
        // fuselage mesh - that was tried and reverted: snapping each end
        // independently onto whichever fuselage vertex happened to be
        // nearest pulled the hinge line off the door's own actual edge,
        // since gear.glb and the fuselage OBJ are two independently-
        // authored meshes with no guarantee their nearest vertices line up
        // with each other at all, let alone along a line parallel to the
        // door's edge.
        const edge = findHingeEdge(
          door,
          config.doorHingePrimaryAxis,
          config.doorHingePrimarySign,
          config.doorHingeSecondaryAxis,
          config.doorHingeSecondarySign,
          "y", // the door's own local "length" axis - see gearGeometry.js's findHingeEdge
        )

        doorPivot = new Group()
        doorPivot.position.copy(object.worldToLocal(edge.position.clone()))
        object.add(doorPivot)
        doorPivot.attach(door) // re-parents, preserving the door's current world transform

        // the pivot itself carries no rotation of its own (only .position
        // was set above), so its local axes match `object`'s local axes -
        // the world-space hinge direction has to go through the same
        // transform to be usable as a rotation axis in that local space.
        // transformDirection (rotation only, no translation) is what a
        // direction needs, unlike the worldToLocal used for the position
        // above (which includes translation, correct for a point but not
        // a direction)
        const worldToLocalRotation = new Matrix4().copy(object.matrixWorld).invert()
        doorHingeAxisLocal = edge.axis.clone().transformDirection(worldToLocalRotation)
      }

      this.legs.push({ config, doorPivot, doorHingeAxisLocal, strutMeshes })
    }
  }

  /**
   * @param gearPosition  0 (fully retracted) .. 1 (fully extended) - the
   *                      same rate-limited actuator value the aerodynamic
   *                      model already uses for gear drag (ActuatorModel's
   *                      "gear" surface), not the pilot's raw instant
   *                      gear-handle command
   */
  update(gearPosition) {
    const doorOpen = doorOpenness(gearPosition)
    const legsVisible = gearPosition > LEG_VISIBLE_ABOVE

    for (const leg of this.legs) {
      const { config, doorPivot, doorHingeAxisLocal, strutMeshes } = leg

      for (const mesh of strutMeshes) mesh.visible = legsVisible

      if (doorPivot) {
        // an arbitrary axis (the door's own real hinge-edge direction, not
        // one of the three named world axes - see findHingeEdge) needs
        // quaternion.setFromAxisAngle rather than a plain rotation.x/y/z;
        // this SETS the absolute rotation each call rather than
        // accumulating, so calling update() repeatedly with the same
        // gearPosition stays stable
        const angle = config.doorSign * MathUtils.degToRad(config.doorAngleDeg) * doorOpen
        doorPivot.quaternion.setFromAxisAngle(doorHingeAxisLocal, angle)
      }
    }
  }
}
