export default class AtmosphericModel {
  constructor() {
    this.rmach = 0
    this.qbar = 0
    this.ps = 0
  }

  /**
   * Computes properties of the standard atmosphere.
   */
  update(vt, alt) {
    let tfac = 1.0 - alt / 145442
    let t = 518.67 * tfac
    if (alt >= 36089) {
      t = 389.97
    }
    let rho = 0.002377 * Math.pow(tfac, 4.255876)

    this.rmach = vt / Math.sqrt(1.403 * 1716.56 * t)
    this.qbar = 0.5 * rho * vt * vt
    this.ps = 1716.56 * rho * t
  }
}
