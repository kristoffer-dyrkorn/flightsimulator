import * as THREE from "../graphics/three.module.js"

import SimulationConstants from "./simulationconstants.js"

/**
 * State vector for F16 simulator.
 */

export default class StateVector {
  constructor() {
    this.npos = 0 // ft
    this.epos = 0 // ft
    this.alt = 0 // ft
    this.phi = 0 // radians
    this.theta = 0 // radians
    this.psi = 0 // radians
    this.vt = 0 // ft/sec
    this.q0 = 0
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

    this.psi = startDirection * SimulationConstants.DTOR

    const q = new THREE.Quaternion()

    this.q0 = q.x
    this.q1 = q.y
    this.q2 = q.z
    this.q3 = q.w

    this.vt = 506 // feet/sec, ~ km/t => 300 knots
    this.pow = 30 // % thrust
  }

  updateAircraftModel(f16) {
    f16.quaternion.identity()

    f16.rotateZ(-this.psi)
    f16.rotateY(this.phi)
    f16.rotateX(this.theta)

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

    this.phi += dt * v.phi
    this.theta += dt * v.theta
    this.psi += dt * v.psi

    this.q0 += dt * v.q0
    this.q1 += dt * v.q1
    this.q2 += dt * v.q2
    this.q3 += dt * v.q3

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
