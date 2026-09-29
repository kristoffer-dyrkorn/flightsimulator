import SimulationConstants from "../simulationconstants.js"

/*
 * Ground reaction: a spring-damper per gear leg, enough to let the aircraft
 * settle onto its gear and sit still under gravity. This is phase 2 of the
 * landing plan - it exists to prove the numerics hold up (a discontinuous
 * contact force evaluated four times a step, at four different interpolated
 * states, inside an explicit RK4 integrator, is a classic source of
 * instability) before anything else - rollout dynamics, real touchdown
 * quality - gets layered on top of it. The spring itself is a real (if
 * approximate) progressive oleo curve, and the
 * damping alongside it is now direction- and gear-type-dependent too, for
 * the same reason a real oleo strut is: the orifice that meters oil on the
 * way in is not the same size as the one metering it on the way out.
 *
 * On top of the vertical spring-damper, each leg also carries tire friction
 * in the ground plane - a small rolling resistance along the wheel's
 * rolling direction, and a much stiffer side force resisting lateral slip -
 * this is phase 3 of the landing plan, enough rollout dynamics to keep a
 * straight-in landing tracking the runway instead of drifting sideways
 * under any crosswind or asymmetric touchdown. There's deliberately no
 * separate weight-transfer term: because each leg's vertical force already
 * comes from its own independently-tracked penetration and closure rate,
 * anything that pitches or rolls the aircraft (braking, a gust, an
 * asymmetric touchdown) already redistributes load between the legs on its
 * own, through the same rigid-body equations of motion everything else in
 * this simulation runs on - not something this model has to reproduce
 * separately.
 *
 * Tire friction here is resolved directly in the body X/Y plane rather than
 * the true earth-frame ground plane (which would need the full body->earth
 * rotation matrix, not just its "down" row) - a fair approximation for a
 * rollout that's meant to stay close to level, and not a claim that this
 * would hold up through a steep bank or pitch.
 *
 * Two pilot controls hang off this same per-leg friction: wheel brakes,
 * which raise the rolling-resistance coefficient at the main legs only (the
 * nosewheel is steered, not braked, on the real aircraft), and nosewheel
 * steering, which turns the nose leg's own rolling direction away from
 * straight-ahead so its friction - rolling and side both - comes off at an
 * angle instead of straight down the body X axis. Steering "engages" with
 * nothing more than the nose leg's own existing contact check: there's no
 * separate weight-on-wheels flag, because a leg that isn't being processed
 * in the loop below (penetration <= 0) has no friction to turn in the first
 * place, which is exactly what "no steering with the nose gear off the
 * ground" means. There's deliberately no friction-circle coupling between
 * braking and cornering grip (real tires give up lateral grip under heavy
 * braking) - that's a real effect this doesn't model, not an oversight.
 *
 * LEGS are body-frame positions relative to the CG, in feet (x forward, y
 * right, z down - the same convention x.p/x.q/x.r and the body velocities
 * already use everywhere else in this file), of each tire's contact point
 * with the strut fully extended. They're derived from where the visual
 * tires sit (see VISUAL_* below), so the physics and the rendered gear
 * agree on where the ground is.
 */

const N_PER_M_TO_LB_PER_FT = 0.0685218 // (lbf / N) / (ft / m)
// same conversion factor applies to N.s/m -> lb.s/ft (force per velocity),
// since it's the same (lbf/N)/(ft/m) ratio either way
const N_S_PER_M_TO_LB_S_PER_FT = N_PER_M_TO_LB_PER_FT
const M_TO_FT = SimulationConstants.METERS_TO_FEET

/* Progressive spring curves, converted from published N/m stiffnesses over
   named percent-of-stroke bands into piecewise lb/ft-of-penetration stages.
   Each stage's `upTo` is the penetration, in feet, where that stage ends -
   the last stage's rate carries on unchanged past 100% stroke rather than
   modeling a hard mechanical stop, since no stiffness was given for that
   case either.

   Main gear: ~30 cm (0.984 ft) stroke, short and needs to ramp up fast to
   protect the underbelly.
     0-25%  (0-0.246 ft):  140,000 N/m =  9,593 lb/ft - cushions small bumps
     25-75% (0.246-0.738): 245,000 N/m = 16,788 lb/ft - tightens for a heavy
                                                          sink rate
     75-100%+ (0.738+):    450,000 N/m = 30,835 lb/ft - hydraulic-wall spike
                                                          against a hard landing

   Nose gear: ~40 cm (1.312 ft) stroke, longer and lighter at first since it
   isn't what takes the initial impact of a flared landing.
     0-50%  (0-0.656 ft):   65,000 N/m =  4,454 lb/ft - soft, so heavy
                                                          wheel-braking pitch
                                                          doesn't jolt the
                                                          cockpit
     50-100%+ (0.656+):    160,000 N/m = 10,964 lb/ft - stiffens against the
                                                          nose slamming down
                                                          on a bad bounce */
const MAIN_GEAR_STROKE = 0.3 * M_TO_FT
const MAIN_GEAR_SPRING_STAGES = [
  { upTo: 0.25 * MAIN_GEAR_STROKE, rate: 140000 * N_PER_M_TO_LB_PER_FT },
  { upTo: 0.75 * MAIN_GEAR_STROKE, rate: 245000 * N_PER_M_TO_LB_PER_FT },
  { upTo: Infinity, rate: 450000 * N_PER_M_TO_LB_PER_FT },
]

const NOSE_GEAR_STROKE = 0.4 * M_TO_FT
const NOSE_GEAR_SPRING_STAGES = [
  { upTo: 0.5 * NOSE_GEAR_STROKE, rate: 65000 * N_PER_M_TO_LB_PER_FT },
  { upTo: Infinity, rate: 160000 * N_PER_M_TO_LB_PER_FT },
]

// force at the end of a piecewise-linear stiffness curve, walking the
// stages up to the current penetration and accumulating each one's own
// contribution - continuous in force across stage boundaries, even though
// the stiffness itself jumps there
function progressiveSpringForce(penetration, stages) {
  let force = 0
  let reached = 0

  for (const stage of stages) {
    if (penetration <= reached) break

    const stageSpan = Math.min(penetration, stage.upTo) - reached
    force += stage.rate * stageSpan
    reached = stage.upTo

    if (penetration <= stage.upTo) break
  }

  return force
}

/* Damping, split by direction of travel rather than one flat coefficient -
   a real oleo strut chokes the oil differently compressing vs. rebounding.
   Compression damping is the midpoint of a published 15,000-22,000 N.s/m
   (main) / 5,000-8,500 N.s/m (nose) range; extension/rebound damping is
   that same figure at the midpoint of a 2.0x-3.0x multiplier (2.5x) -
   deliberately higher, so the oil orifices choke the strut pushing back
   out after a hard compression instead of letting it spring back and
   unload the tires, which is what actually keeps a landing gear "glued"
   to the runway rather than bouncing. */
const MAIN_GEAR_DAMPING_COMPRESSION = ((15000 + 22000) / 2) * N_S_PER_M_TO_LB_S_PER_FT
const MAIN_GEAR_DAMPING_EXTENSION = MAIN_GEAR_DAMPING_COMPRESSION * 2.5

const NOSE_GEAR_DAMPING_COMPRESSION = ((5000 + 8500) / 2) * N_S_PER_M_TO_LB_S_PER_FT
const NOSE_GEAR_DAMPING_EXTENSION = NOSE_GEAR_DAMPING_COMPRESSION * 2.5

/* Tire friction coefficients, applied against each leg's own current
   vertical (normal) force rather than a fixed number - a heavily loaded
   main gear during a hard touchdown grips harder than a barely-loaded one,
   the same way a real tire does.

   ROLLING_FRICTION_COEFF is a typical unbraked rolling-resistance figure
   for a pneumatic tire on paved runway (literature range is roughly
   0.01-0.03) - the coefficient an unbraked wheel always rolls at, and the
   floor the brake pedal blends up from at the (braked) main legs; see
   BRAKE_FRICTION_COEFF_MAX in simulationconstants.js for the ceiling.

   TIRE_SIDE_FRICTION_COEFF is a typical dry-pavement rubber-on-asphalt
   lateral grip coefficient (~0.7-0.8), the same range JSBSim's generic
   ground-reaction defaults use for a gear's static/lateral friction limit -
   this is what keeps the aircraft tracking straight rather than sliding
   sideways.

   Both are applied through the same regularized-Coulomb shape: a friction
   force that ramps linearly from zero up to its full (coefficient x normal
   force) limit as the relevant slip velocity crosses
   FRICTION_VELOCITY_EPS, rather than snapping to +-max via Math.sign() at
   zero velocity. A hard sign() flip sampled four times a step at four
   different interpolated states - RK4's usual hazard for contact forces,
   the same one the header comment above flags for the spring-damper - would
   let a nearly-stopped wheel chatter instead of settling; the ramp trades a
   little precision very close to zero speed for a friction force that's
   continuous in velocity everywhere.

   A rolling tire's side force builds up with its slip angle - the angle
   between where the wheel points and where it's going - rather than with
   the sideways slip velocity itself, reaching its peak around
   TIRE_PEAK_SLIP_ANGLE. So the side force ramps over whichever is larger:
   FRICTION_VELOCITY_EPS, or the sideways velocity that peak slip angle
   works out to at the wheel's current rolling speed. Ramping over
   FRICTION_VELOCITY_EPS alone at every speed would make the tire far too
   stiff when rolling fast - at landing speeds a fraction of a degree of
   nosewheel steering would already get full side grip, enough to yank the
   aircraft around and roll it over. */
const ROLLING_FRICTION_COEFF = 0.02
const TIRE_SIDE_FRICTION_COEFF = 0.8
const FRICTION_VELOCITY_EPS = 1.0 // ft/s

/* With the brakes on, the rolling friction ramps up over a shorter slip -
   a held brake has the wheel all but locked, so it should take little creep
   for it to hold the aircraft still. It can't be made much shorter than
   this: the flight model carries velocity as a speed and two angles, which
   can't pass cleanly through zero, and a friction force that stiff at a
   standstill pushes the speed through zero and breaks it. So a braked
   aircraft can still creep a centimetre or two a second against idle
   thrust and gusts - half what it did with the unbraked ramp. */
const BRAKED_FRICTION_VELOCITY_EPS = 0.5 // ft/s, at full brake
const TIRE_PEAK_SLIP_ANGLE = 8 * SimulationConstants.DTOR

// Coulomb friction opposing `velocity`, capped at `maxForce` and ramped
// linearly to that cap over the first `rampVelocity` ft/s of slip rather
// than snapping there discontinuously - see the comment above.
function regularizedFriction(velocity, maxForce, rampVelocity = FRICTION_VELOCITY_EPS) {
  const ratio = Math.max(-1, Math.min(1, velocity / rampVelocity))
  return -maxForce * ratio
}

/* Tire forces for one leg, in body X/Y. `steerAngle` (radians) rotates the
   wheel's rolling direction away from straight-ahead before the rolling and
   side friction are computed against it, then rotates the resulting force
   back - a wheel toed 10 degrees right rolls easily along its own new
   heading and grips hard across it, which the body-axis-only version of
   this (steerAngle always 0) can't represent, since it always treats
   "forward" as the body X axis. At steerAngle = 0 the rotations are the
   identity, cos=1/sin=0, so an unsteered leg (both main legs, always) comes
   out exactly as if this function were the simple axis-aligned version. */
function tireForce(pointU, pointV, upForce, rollingCoeff, rollRampVelocity, steerAngle) {
  const cosSteer = Math.cos(steerAngle)
  const sinSteer = Math.sin(steerAngle)

  const wheelForward = pointU * cosSteer + pointV * sinSteer
  const wheelLateral = -pointU * sinSteer + pointV * cosSteer

  const wheelRollForce = regularizedFriction(wheelForward, rollingCoeff * upForce, rollRampVelocity)
  const sideRampVelocity = Math.max(FRICTION_VELOCITY_EPS, Math.abs(wheelForward) * Math.tan(TIRE_PEAK_SLIP_ANGLE))
  const wheelSideForce = regularizedFriction(wheelLateral, TIRE_SIDE_FRICTION_COEFF * upForce, sideRampVelocity)

  return {
    x: wheelRollForce * cosSteer - wheelSideForce * sinSteer,
    y: wheelRollForce * sinSteer + wheelSideForce * cosSteer,
  }
}

/* Where the bottoms of the visual tires are, body frame, ft - measured from
   gear.glb as index.js places it on the aircraft, which matches the real
   F-16's 4.00 m wheelbase and 2.36 m track. The model shows the struts
   fully extended, which makes these the contact points; the struts'
   compression is animated on top of that (see strutTravel). */
const VISUAL_NOSE_TIRE = { x: 12.27, z: 5.78 }
const VISUAL_MAIN_TIRE = { x: -0.85, y: 3.87, z: 6.07 }

const LEGS = {
  nose: {
    x: VISUAL_NOSE_TIRE.x,
    y: 0,
    z: VISUAL_NOSE_TIRE.z,
    springStages: NOSE_GEAR_SPRING_STAGES,
    dampingCompression: NOSE_GEAR_DAMPING_COMPRESSION,
    dampingExtension: NOSE_GEAR_DAMPING_EXTENSION,
    braked: false, // real F-16 nosewheel has no brake, only steering
    steerable: true,
  },
  mainL: {
    x: VISUAL_MAIN_TIRE.x,
    y: -VISUAL_MAIN_TIRE.y,
    z: VISUAL_MAIN_TIRE.z,
    springStages: MAIN_GEAR_SPRING_STAGES,
    dampingCompression: MAIN_GEAR_DAMPING_COMPRESSION,
    dampingExtension: MAIN_GEAR_DAMPING_EXTENSION,
    braked: true,
    steerable: false,
  },
  mainR: {
    x: VISUAL_MAIN_TIRE.x,
    y: VISUAL_MAIN_TIRE.y,
    z: VISUAL_MAIN_TIRE.z,
    springStages: MAIN_GEAR_SPRING_STAGES,
    dampingCompression: MAIN_GEAR_DAMPING_COMPRESSION,
    dampingExtension: MAIN_GEAR_DAMPING_EXTENSION,
    braked: true,
    steerable: false,
  },
}

/* Nosewheel steering authority, degrees, at a given ground speed (ft/s).
   Full NOSEWHEEL_STEER_MAX at taxi speeds, narrowing as speed builds so
   that a full pedal input never asks for a tighter turn than
   NOSEWHEEL_MAX_LATERAL_ACCEL - left unlimited, a nosewheel turn at landing
   speeds pulls far more sideways g than the narrow main gear track can
   take, and rolls the aircraft over. The turn a steered nosewheel makes is
   set by the wheelbase: radius = wheelbase / tan(steer angle). */
const WHEELBASE = VISUAL_NOSE_TIRE.x - VISUAL_MAIN_TIRE.x

export function noseSteerAuthority(groundSpeed) {
  const maxLateralAccel = SimulationConstants.NOSEWHEEL_MAX_LATERAL_ACCEL * SimulationConstants.G
  const speedLimited = Math.atan((maxLateralAccel * WHEELBASE) / Math.max(groundSpeed * groundSpeed, 1e-6))

  return Math.min(SimulationConstants.NOSEWHEEL_STEER_MAX, speedLimited * SimulationConstants.RTOD)
}

export default class LandingGearModel {
  constructor() {
    /* altitude of the ground directly below the aircraft, feet - set once
       per physics step from outside (index.js has the terrain query, this
       model doesn't and shouldn't). Starts low enough that nothing can be
       in contact with it before the caller has set a real value. */
    this.groundAlt = -1e6

    /* whether any leg was on the ground at the last update */
    this.weightOnWheels = false
  }

  /**
   * How far each leg's strut is compressed, for animating the visual gear,
   * which shows the struts fully extended - zero with the wheel off the
   * ground.
   *
   * @param x  aircraft state - only altitude and attitude are used
   * @returns {nose, mainL, mainR}  strut travel, ft
   */
  strutTravel(x) {
    const { q0, q1, q2, q3 } = x

    // the "down" row of the body -> earth rotation matrix, as in update()
    const r20 = 2 * (q1 * q3 - q0 * q2)
    const r21 = 2 * (q2 * q3 + q0 * q1)
    const r22 = q0 * q0 - q1 * q1 - q2 * q2 + q3 * q3

    const travel = {}

    for (const [name, leg] of Object.entries(LEGS)) {
      const legAlt = x.alt - (r20 * leg.x + r21 * leg.y + r22 * leg.z)
      travel[name] = Math.max(0, this.groundAlt - legAlt)
    }

    return travel
  }

  /**
   * @param alt          aircraft CG altitude, ft
   * @param U, V, W      body-axis velocity, ft/s
   * @param P, Q, R      body-axis rates, rad/s
   * @param r20, r21, r22  "down" row of the body -> earth rotation matrix
   * @param gear         actuator gear position, 0 (up) .. 1 (down) - scales
   *                     the whole reaction, so retracted gear gets none
   * @param brake        actuator brake pedal position, 0..1 - raises rolling
   *                     resistance at the (braked) main legs only
   * @param noseSteerRad actuator nosewheel steering angle, radians - only
   *                     applied at the (steerable) nose leg, and only while
   *                     it is actually in contact with the ground
   * @returns {X, Y, Z, L, M, N}  body-axis force (lbf) and moment (lbf-ft)
   */
  update(alt, U, V, W, P, Q, R, r20, r21, r22, gear, brake, noseSteerRad) {
    let X = 0
    let Y = 0
    let Z = 0
    let L = 0
    let M = 0
    let N = 0

    this.weightOnWheels = false

    if (gear <= 0) return { X, Y, Z, L, M, N }

    for (const leg of Object.values(LEGS)) {
      // earth-frame "down" component of this leg's fixed body-frame offset
      // from the CG, at the aircraft's current attitude - the same
      // body->earth projection getStateDerivative already uses for xd.alt,
      // just applied to a fixed point instead of a velocity
      const downOffset = r20 * leg.x + r21 * leg.y + r22 * leg.z
      const legAlt = alt - downOffset

      const penetration = this.groundAlt - legAlt
      if (penetration <= 0) continue

      this.weightOnWheels = true

      // velocity of this point on the rigid body = CG velocity + (angular
      // rate) x (offset) - the standard rigid-body point-velocity relation,
      // needed because a leg well away from the CG can be closing on the
      // ground much faster or slower than the CG itself while the aircraft
      // is pitching or rolling into contact
      const pointU = U + (Q * leg.z - R * leg.y)
      const pointV = V + (R * leg.x - P * leg.z)
      const pointW = W + (P * leg.y - Q * leg.x)

      // earth-frame closing rate, positive = still descending
      const closureRate = r20 * pointU + r21 * pointV + r22 * pointW

      // spring pushes back on penetration, following that leg's own
      // progressive curve; damper resists motion along the strut, using a
      // higher rate while it's extending (closureRate < 0, oil choked
      // through the rebound orifice) than while it's compressing
      // (closureRate >= 0) - both increase the upward push, which is why
      // both are added rather than opposed. Clamped so a leg that's
      // rebounding fast while barely still penetrating can't go negative
      // and start pulling the aircraft back down - a spring-damper should
      // never be able to suck the aircraft into the ground.
      const damping = closureRate >= 0 ? leg.dampingCompression : leg.dampingExtension
      const upForce = Math.max(0, progressiveSpringForce(penetration, leg.springStages) + damping * closureRate) * gear

      // earth-frame force is (0, 0, -upForce) in (north, east, down) - "up"
      // being the negative-down direction - rotated into body axes by the
      // transpose of the body->earth matrix (its inverse, since it's
      // orthogonal), which is why the row/column pattern below is the
      // r*0/r1*/r2* columns rather than the rows getStateDerivative uses
      // for velocities
      const legX = -r20 * upForce
      const legY = -r21 * upForce
      const legZ = -r22 * upForce

      // tire friction, resolved directly in body X/Y (see the header
      // comment on why) and scaled by this leg's own normal force -
      // rolling resistance opposing the wheel's forward roll, side force
      // opposing lateral slip. Braking raises the rolling coefficient only
      // at legs that actually carry a brake; steering only turns the
      // rolling direction away from straight-ahead at the leg that
      // actually has a steerable wheel - both no-ops at the other legs.
      const rollingCoeff = leg.braked
        ? ROLLING_FRICTION_COEFF + brake * (SimulationConstants.BRAKE_FRICTION_COEFF_MAX - ROLLING_FRICTION_COEFF)
        : ROLLING_FRICTION_COEFF
      const rollRampVelocity = leg.braked
        ? FRICTION_VELOCITY_EPS + brake * (BRAKED_FRICTION_VELOCITY_EPS - FRICTION_VELOCITY_EPS)
        : FRICTION_VELOCITY_EPS
      const steerAngle = leg.steerable ? noseSteerRad : 0

      const tire = tireForce(pointU, pointV, upForce, rollingCoeff, rollRampVelocity, steerAngle)

      X += legX + tire.x
      Y += legY + tire.y
      Z += legZ

      // moment about the CG from a force applied at this leg's offset -
      // the standard r x F, now including the tire friction forces
      // alongside the vertical one
      const totalLegX = legX + tire.x
      const totalLegY = legY + tire.y
      L += leg.y * legZ - leg.z * totalLegY
      M += leg.z * totalLegX - leg.x * legZ
      N += leg.x * totalLegY - leg.y * totalLegX
    }

    return { X, Y, Z, L, M, N }
  }
}
