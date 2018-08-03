export default class AtmosphericModel {
  constructor() {
    this.rmach = 0
    this.qbar = 0
  }

  /**
   * Computes properties of the standard atmosphere.
   */
  update(vt, alt) {
    let tfac = 1.0 - alt * 0.703e-5
    let t = 519.0 * tfac
    if (alt >= 35000.0) {
      t = 390.0
    }
    let rho = 0.002377 * Math.pow(tfac, 4.14)
    this.rmach = vt / Math.sqrt(1.4 * 1716.3 * t)
    this.qbar = 0.5 * rho * vt * vt
  }
}
