import GraphicsConstants from "../graphics/graphicsconstants.js"

/**
 * State vector for F16 simulator.
 */

export default class StateVector {
  constructor() {
    this.vt = 0 // ft/sec
    this.alpha = 0 // radians
    this.beta = 0 // radians
    this.phi = 0 // radians
    this.theta = 0 // radians
    this.psi = 0 // radians
    this.p = 0 // radians/sec
    this.q = 0 // radians/sec
    this.r = 0 // radians/sec
    this.xn = 0 // ft
    this.xe = 0 // ft
    this.h = 0 // ft
    this.pow = 0 // percent, 0 <= pow <= 100
  }

  /**
   * Integration support. Integrates the derivative vector <b>v</b>
   * into this one, scaling the derivative by dt.
   *
   * @param v                 Derivative state vector
   * @param dt                delta-t scaling factor for derivative
   * @param simplifiedAero    If true, disables angle-of-attack and
   *                          sideslip forces for better stability
   * @param afterburnerFactor Scale factor for velocity (usually 1.0f)
   */
  integrate(v, dt, simplifiedAero, afterburnerFactor) {
    this.vt += dt * v.vt
    if (simplifiedAero) {
      // Disables angle-of-attack and sideslip forces for better stability
      this.alpha = 0
      this.beta = 0
    } else {
      this.alpha += dt * v.alpha
      this.beta += dt * v.beta
    }
    this.phi += dt * v.phi
    this.theta += dt * v.theta
    this.psi += dt * v.psi
    this.p += dt * v.p
    this.q += dt * v.q
    this.r += dt * v.r
    this.xn += dt * afterburnerFactor * v.xn
    this.xe += dt * afterburnerFactor * v.xe
    this.h += dt * afterburnerFactor * v.h
    this.pow += dt * v.pow
  }

  toString() {
    return `Speed: ${this.vt} feet/sec, altitude: ${this.h}, orientation: ${this.phi *
      GraphicsConstants.RADIANS_TO_DEGREES} ${this.theta * GraphicsConstants.RADIANS_TO_DEGREES} ${this.psi *
      GraphicsConstants.RADIANS_TO_DEGREES}, alpha: ${this.alpha * GraphicsConstants.RADIANS_TO_DEGREES}`
  }
}
