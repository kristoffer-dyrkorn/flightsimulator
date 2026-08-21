import SimulationConstants from "./simulationconstants.js"

/**
 * State vector for F16 simulator.
 */

export default class StateVector {
  constructor() {
    this.npos = 0 // ft
    this.epos = 0 // ft
    this.alt = 0 // ft
    // euler angles, radians. these are *derived* from the attitude quaternion
    // below, for display purposes only - they are not integrated, because the
    // euler kinematic equations are singular when the aircraft points straight
    // up or down.
    this.phi = 0
    this.theta = 0
    this.psi = 0

    this.vt = 0 // ft/sec

    // attitude quaternion, rotation from earth (north/east/down) to body axes.
    // q0 is the scalar part. this is the actual integrated attitude state.
    this.q0 = 1
    this.q1 = 0
    this.q2 = 0
    this.q3 = 0
    this.alpha = 0 // radians
    this.beta = 0 // radians
    this.p = 0 // radians/sec
    this.q = 0 // radians/sec
    this.r = 0 // radians/sec
    this.nx = 0
    this.ny = 0
    this.nz = 0
    this.pow = 0 // percent, 0 <= pow <= 100
  }

  init(startPoint, startDirection) {
    this.epos = startPoint[0] * SimulationConstants.METERS_TO_FEET
    this.npos = startPoint[1] * SimulationConstants.METERS_TO_FEET
    this.alt = startPoint[2] * SimulationConstants.METERS_TO_FEET

    // start straight and level on the given heading. a yaw-only rotation is a
    // rotation about the body z (down) axis, so the whole vector part except q3
    // is zero. note the half angles - a quaternion covers twice the rotation.
    const halfPsi = 0.5 * startDirection * SimulationConstants.DTOR

    this.q0 = Math.cos(halfPsi)
    this.q1 = 0
    this.q2 = 0
    this.q3 = Math.sin(halfPsi)

    this.updateEulerAngles()

    this.vt = 506 // feet/sec, ~ km/t => 300 knots
    this.pow = 30 // % thrust
  }

  /**
   * Recomputes the euler angles from the attitude quaternion. Pitch is
   * inherently limited to +/- 90 degrees, and roll and yaw wrap at +/- 180,
   * so the aircraft flips through the vertical instead of accumulating a
   * pitch angle past straight up.
   */
  updateEulerAngles() {
    const q0 = this.q0
    const q1 = this.q1
    const q2 = this.q2
    const q3 = this.q3

    // "down" row of the body -> earth rotation matrix
    const r20 = 2 * (q1 * q3 - q0 * q2) /* = -sin(theta) */
    const r21 = 2 * (q2 * q3 + q0 * q1) /* =  sin(phi)cos(theta) */
    const r22 = q0 * q0 - q1 * q1 - q2 * q2 + q3 * q3 /* =  cos(phi)cos(theta) */

    // first column of the same matrix
    const r00 = q0 * q0 + q1 * q1 - q2 * q2 - q3 * q3 /* = cos(theta)cos(psi) */
    const r10 = 2 * (q1 * q2 + q0 * q3) /* = cos(theta)sin(psi) */

    this.phi = Math.atan2(r21, r22)
    // clamp guards against asin() of a value a hair outside [-1, 1]
    this.theta = Math.asin(Math.max(-1, Math.min(1, -r20)))
    this.psi = Math.atan2(r10, r00)
  }

  /**
   * Rescales the attitude quaternion back to unit length. The correction term
   * in the derivative keeps the drift small, but it never removes it entirely.
   */
  normalizeQuaternion() {
    const norm = Math.sqrt(this.q0 * this.q0 + this.q1 * this.q1 + this.q2 * this.q2 + this.q3 * this.q3)

    // a zero-length quaternion has no meaningful direction to preserve, so fall
    // back to the identity rather than dividing by zero
    if (!(norm > 1e-9)) {
      this.q0 = 1
      this.q1 = this.q2 = this.q3 = 0
      return
    }

    this.q0 /= norm
    this.q1 /= norm
    this.q2 /= norm
    this.q3 /= norm
  }

  updateAircraftModel(f16) {
    // The flight model works in aerospace axes: north/east/down for the world,
    // and nose/right-wing/belly for the body. The scene uses east/north/up for
    // the world, and right-wing/nose/canopy for the model. Both are the same
    // change of basis (a, b, c) -> (b, a, -c), which is a 180 degree turn about
    // (1, 1, 0). Conjugating the attitude quaternion by that rotation just
    // permutes its vector part the same way, so no matrix work is needed.
    // three.js orders components as (x, y, z, w) with w the scalar part.
    f16.quaternion.set(this.q2, this.q1, -this.q3, this.q0)

    f16.position.set(
      this.epos * SimulationConstants.FEET_TO_METERS,
      this.npos * SimulationConstants.FEET_TO_METERS,
      this.alt * SimulationConstants.FEET_TO_METERS
    )
    f16.updateMatrixWorld()
  }

  /**
   * Integration support. Integrates the derivative vector <b>v</b>
   * into this one, scaling the derivative by dt.
   *
   * @param v                 Derivative state vector
   * @param dt                delta-t scaling factor for derivative
   */
  integrate(v, dt) {
    this.npos += dt * v.npos
    this.epos += dt * v.epos
    this.alt += dt * v.alt

    this.q0 += dt * v.q0
    this.q1 += dt * v.q1
    this.q2 += dt * v.q2
    this.q3 += dt * v.q3

    this.normalizeQuaternion()

    // phi/theta/psi are not integrated - they follow from the quaternion
    this.updateEulerAngles()

    this.vt += dt * v.vt

    this.alpha += dt * v.alpha
    this.beta += dt * v.beta

    this.p += dt * v.p
    this.q += dt * v.q
    this.r += dt * v.r

    this.nx = v.nx
    this.ny = v.ny
    this.nz = v.nz

    this.pow += dt * v.pow
  }
}
