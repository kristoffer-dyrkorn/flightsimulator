import SimulationConstants from "../simulationconstants.js"

export default class EngineModel {
  constructor() {
    this.idleData = [
      [1060.0, 635.0, 60.0, -1020.0, -2700.0, -3600.0],
      [670.0, 425.0, 25.0, -710.0, -1900.0, -1400.0],
      [880.0, 690.0, 345.0, -300.0, -1300.0, -595.0],
      [1140.0, 1010.0, 755.0, 350.0, -247.0, -342.0],
      [1500.0, 1330.0, 1130.0, 910.0, 600.0, -200.0],
      [1860.0, 1700.0, 1525.0, 1360.0, 1100.0, 700.0],
    ]

    this.milData = [
      [12680.0, 12680.0, 12610.0, 12640.0, 12390.0, 11680.0],
      [9150.0, 9150.0, 9312.0, 9839.0, 10176.0, 9848.0],
      [6200.0, 6313.0, 6610.0, 7090.0, 7750.0, 8050.0],
      [3950.0, 4040.0, 4290.0, 4660.0, 5320.0, 6100.0],
      [2450.0, 2470.0, 2600.0, 2840.0, 3250.0, 3800.0],
      [1400.0, 1400.0, 1560.0, 1660.0, 1930.0, 2310.0],
    ]

    this.maxData = [
      [20000.0, 21420.0, 22700.0, 24240.0, 26070.0, 28886.0],
      [15000.0, 15700.0, 16860.0, 18910.0, 21075.0, 23319.0],
      [10800.0, 11225.0, 12250.0, 13760.0, 15975.0, 18300.0],
      [7000.0, 7323.0, 8154.0, 9285.0, 11115.0, 13484.0],
      [4000.0, 4435.0, 5000.0, 5700.0, 6860.0, 8642.0],
      [2500.0, 2600.0, 2835.0, 3215.0, 3950.0, 5057.0],
    ]

    /**
     * thrust = engine thrust, lbf; dpow = time
     * derivative of the engine power level, percent/sec.
     */
    this.thrust = 0
    this.dpow = 0
  }

  /**
   * Computes the engine thrust and the time derivative of the engine
   * power state for the F-16.
   *
   * @param pow   EngineModel power level, percent. ( 0 <= POW <= 100. )
   * @param alt   Altitude, ft.                ( 0 <= ALT <= 50000. )
   * @param rmach Mach number.                 ( 0 <= RMACH <= 1.0 )
   * @param thtl  Throttle setting.            ( 0 <= THTL <= 1.0 )
   */
  update(pow, alt, rmach, thtl) {
    // Compute engine thrust.
    this.thrust = this.engineThrust(pow, alt, rmach)

    // Compute commanded power level and power level time derivative.
    const cpow = this.tgear(thtl)
    this.dpow = this.pdot(pow, cpow)
  }

  tgear(thtl) {
    if (thtl <= 0.77) {
      return 64.94 * thtl
    } else {
      return 217.38 * thtl - 117.38
    }
  }

  rtau(dp) {
    if (dp <= 25.0) return 1.0
    if (dp >= 50.0) return 0.1
    return 1.9 - 0.036 * dp
  }

  pdot(pow, cpow) {
    let tpow = 0
    let t = 0

    if (cpow >= 50.0) {
      if (pow >= 50.0) {
        tpow = cpow
        t = 5.0
      } else {
        tpow = 60.0
        t = this.rtau(tpow - pow)
      }
    } else {
      if (pow >= 50.0) {
        tpow = 40.0
        t = 5.0
      } else {
        tpow = cpow
        t = this.rtau(tpow - pow)
      }
    }
    return t * (tpow - pow)
  }

  engineThrust(powr, alti, rmach) {
    const p = this.limit(powr, SimulationConstants.POWER_MIN, SimulationConstants.POWER_MAX)
    const a = this.limit(alti, SimulationConstants.ALTITUDE_MIN, SimulationConstants.ALTITUDE_MAX)
    const r = this.limit(rmach, SimulationConstants.MACH_MIN, SimulationConstants.MACH_MAX)

    const h = 0.0001 * a
    const i = this.limit(Math.floor(h), 0, 4)

    const dh = h - i
    const rm = 5.0 * r

    const m = this.limit(Math.floor(rm), 0, 4)

    const dm = rm - m
    const cdh = 1.0 - dh

    let s = this.milData[i][m] * cdh + this.milData[i + 1][m] * dh
    let t = this.milData[i][m + 1] * cdh + this.milData[i + 1][m + 1] * dh

    const tmil = s + (t - s) * dm

    if (p < 50.0) {
      s = this.idleData[i][m] * cdh + this.idleData[i + 1][m] * dh
      t = this.idleData[i][m + 1] * cdh + this.idleData[i + 1][m + 1] * dh
      const tidl = s + (t - s) * dm
      return tidl + (tmil - tidl) * p * 0.02
    } else {
      s = this.maxData[i][m] * cdh + this.maxData[i + 1][m] * dh
      t = this.maxData[i][m + 1] * cdh + this.maxData[i + 1][m + 1] * dh
      const tmax = s + (t - s) * dm
      return tmil + (tmax - tmil) * (p - 50.0) * 0.02
    }
  }

  limit(value, min, max) {
    if (value < min) return min
    if (value > max) return max
    return value
  }
}
