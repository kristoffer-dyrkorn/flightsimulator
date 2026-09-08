import { Quaternion } from "three"
import SimulationConstants from "./simulationconstants.js"

const attitudeFrom = new Quaternion()
const attitudeTo = new Quaternion()

/**
 * State vector for F16 simulator.
 */

export default class StateVector {
  constructor() {
    this.npos = 0 // ft
    this.epos = 0 // ft
    this.alt = 0 // ft
    // euler angles, radians. derived from the attitude quaternion.
    // only used for rendering/display
    this.phi = 0
    this.theta = 0
    this.psi = 0

    this.vt = 0 // ft/sec

    // attitude quaternion
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
    // speed through the air, ft/sec. vt above is the speed over the ground, and
    // in a wind the two are not the same thing. Not integrated - the flight
    // model works it out from the wind it is flying through, and puts it here
    // for the instruments and the control laws to read.
    this.airspeed = 0
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
    this.airspeed = this.vt
    this.pow = 30 // % thrust

    // set initial G to constant, level flight
    this.nz = 1
  }

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
    // guard against asin() of a value outside [-1, 1]
    this.theta = Math.asin(Math.max(-1, Math.min(1, -r20)))
    this.psi = Math.atan2(r10, r00)
  }

  normalizeQuaternion() {
    const norm = Math.sqrt(this.q0 * this.q0 + this.q1 * this.q1 + this.q2 * this.q2 + this.q3 * this.q3)

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

  copyFrom(other) {
    this.npos = other.npos
    this.epos = other.epos
    this.alt = other.alt

    this.phi = other.phi
    this.theta = other.theta
    this.psi = other.psi

    this.vt = other.vt

    this.q0 = other.q0
    this.q1 = other.q1
    this.q2 = other.q2
    this.q3 = other.q3

    this.alpha = other.alpha
    this.beta = other.beta

    this.p = other.p
    this.q = other.q
    this.r = other.r

    this.nx = other.nx
    this.ny = other.ny
    this.nz = other.nz

    this.airspeed = other.airspeed

    this.pow = other.pow
  }

  interpolate(from, to, alongStep) {
    this.npos = from.npos + (to.npos - from.npos) * alongStep
    this.epos = from.epos + (to.epos - from.epos) * alongStep
    this.alt = from.alt + (to.alt - from.alt) * alongStep

    this.vt = from.vt + (to.vt - from.vt) * alongStep

    this.alpha = from.alpha + (to.alpha - from.alpha) * alongStep
    this.beta = from.beta + (to.beta - from.beta) * alongStep

    this.p = from.p + (to.p - from.p) * alongStep
    this.q = from.q + (to.q - from.q) * alongStep
    this.r = from.r + (to.r - from.r) * alongStep

    this.nx = from.nx + (to.nx - from.nx) * alongStep
    this.ny = from.ny + (to.ny - from.ny) * alongStep
    this.nz = from.nz + (to.nz - from.nz) * alongStep

    this.airspeed = from.airspeed + (to.airspeed - from.airspeed) * alongStep

    this.pow = from.pow + (to.pow - from.pow) * alongStep

    // attitude is a rotation, so it is interpolated as one
    attitudeFrom.set(from.q1, from.q2, from.q3, from.q0)
    attitudeTo.set(to.q1, to.q2, to.q3, to.q0)
    attitudeFrom.slerp(attitudeTo, alongStep)

    this.q0 = attitudeFrom.w
    this.q1 = attitudeFrom.x
    this.q2 = attitudeFrom.y
    this.q3 = attitudeFrom.z

    this.updateEulerAngles()
  }

  updateAircraftModel(f16) {
    // convert from physics model axes to world axes
    f16.quaternion.set(this.q2, this.q1, -this.q3, this.q0)

    f16.position.set(
      this.epos * SimulationConstants.FEET_TO_METERS,
      this.npos * SimulationConstants.FEET_TO_METERS,
      this.alt * SimulationConstants.FEET_TO_METERS,
    )
  }

  advanceInto(target, v, dt) {
    target.npos = this.npos + dt * v.npos
    target.epos = this.epos + dt * v.epos
    target.alt = this.alt + dt * v.alt

    target.q0 = this.q0 + dt * v.q0
    target.q1 = this.q1 + dt * v.q1
    target.q2 = this.q2 + dt * v.q2
    target.q3 = this.q3 + dt * v.q3

    target.vt = this.vt + dt * v.vt

    target.alpha = this.alpha + dt * v.alpha
    target.beta = this.beta + dt * v.beta

    target.p = this.p + dt * v.p
    target.q = this.q + dt * v.q
    target.r = this.r + dt * v.r

    target.pow = this.pow + dt * v.pow
  }

  integrateRungeKutta(k1, k2, k3, k4, dt) {
    const h = dt / 6

    this.npos += h * (k1.npos + 2 * k2.npos + 2 * k3.npos + k4.npos)
    this.epos += h * (k1.epos + 2 * k2.epos + 2 * k3.epos + k4.epos)
    this.alt += h * (k1.alt + 2 * k2.alt + 2 * k3.alt + k4.alt)

    this.q0 += h * (k1.q0 + 2 * k2.q0 + 2 * k3.q0 + k4.q0)
    this.q1 += h * (k1.q1 + 2 * k2.q1 + 2 * k3.q1 + k4.q1)
    this.q2 += h * (k1.q2 + 2 * k2.q2 + 2 * k3.q2 + k4.q2)
    this.q3 += h * (k1.q3 + 2 * k2.q3 + 2 * k3.q3 + k4.q3)

    this.normalizeQuaternion()

    // phi/theta/psi are not integrated - they follow from the quaternion
    this.updateEulerAngles()

    this.vt += h * (k1.vt + 2 * k2.vt + 2 * k3.vt + k4.vt)

    this.alpha += h * (k1.alpha + 2 * k2.alpha + 2 * k3.alpha + k4.alpha)
    this.beta += h * (k1.beta + 2 * k2.beta + 2 * k3.beta + k4.beta)

    this.p += h * (k1.p + 2 * k2.p + 2 * k3.p + k4.p)
    this.q += h * (k1.q + 2 * k2.q + 2 * k3.q + k4.q)
    this.r += h * (k1.r + 2 * k2.r + 2 * k3.r + k4.r)

    this.pow += h * (k1.pow + 2 * k2.pow + 2 * k3.pow + k4.pow)
    this.pow = Math.max(SimulationConstants.POWER_LEVEL_MIN, Math.min(SimulationConstants.POWER_LEVEL_MAX, this.pow))

    this.nx = (k1.nx + 2 * k2.nx + 2 * k3.nx + k4.nx) / 6
    this.ny = (k1.ny + 2 * k2.ny + 2 * k3.ny + k4.ny) / 6
    this.nz = (k1.nz + 2 * k2.nz + 2 * k3.nz + k4.nz) / 6

    this.airspeed = (k1.airspeed + 2 * k2.airspeed + 2 * k3.airspeed + k4.airspeed) / 6
  }
}
