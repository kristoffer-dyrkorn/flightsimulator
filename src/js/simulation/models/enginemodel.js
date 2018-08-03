import DataTable2D from "../math/datatable2D.js"
import Interpolator from "../math/interpolator.js"
import SimulationConstants from "../simulationconstants.js"

export default class EngineModel {
  constructor() {
    this.idlePowerData = new DataTable2D([
      [1060, 670, 880, 1140, 1500, 1860],
      [6350, 425, 690, 1010, 1330, 1700],
      [60, 25, 345, 755, 1130, 1525],
      [-1020, -710, -300, 350, 910, 1360],
      [-2700, -1900, -1300, -247, 600, 1100],
      [-3600, -1400, -595, -342, -200, 700]
    ])
    this.idlePowerData.setXRange(SimulationConstants.ALTITUDE_MIN, SimulationConstants.ALTITUDE_MAX)
    this.idlePowerData.setYRange(SimulationConstants.POWER_MIN, SimulationConstants.POWER_MAX)

    this.milPowerData = new DataTable2D([
      [12680, 9150, 6200, 3950, 2450, 1400],
      [12680, 9150, 6313, 4040, 2470, 1400],
      [12610, 9312, 6610, 4290, 2600, 1560],
      [12640, 9839, 7090, 4660, 2840, 1660],
      [12390, 10176, 7750, 5320, 3250, 1930],
      [11680, 9848, 8050, 6100, 3800, 2310]
    ])
    this.milPowerData.setXRange(SimulationConstants.ALTITUDE_MIN, SimulationConstants.ALTITUDE_MAX)
    this.milPowerData.setYRange(SimulationConstants.POWER_MIN, SimulationConstants.POWER_MAX)

    this.maxPowerData = new DataTable2D([
      [20000, 15000, 10800, 7000, 4000, 2500],
      [21420, 15700, 11225, 7323, 4435, 2600],
      [22700, 16860, 12250, 8154, 5000, 2835],
      [24240, 18910, 13760, 9285, 5700, 3215],
      [26070, 21075, 15975, 11115, 6860, 3950],
      [28886, 23319, 18300, 13484, 8642, 5057]
    ])
    this.maxPowerData.setXRange(SimulationConstants.ALTITUDE_MIN, SimulationConstants.ALTITUDE_MAX)
    this.maxPowerData.setYRange(SimulationConstants.POWER_MIN, SimulationConstants.POWER_MAX)

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

  /**
   * Computes the thrust for the F-16 model.
   *
   * @param pow   EngineModel power level, percent. ( 0 <= POW <= 100. )
   * @param alt   Altitude, ft.                ( 0 <= ALT <= 50000. )
   * @param rmach Mach number.                 ( 0 <= RMACH <= 1.0 )
   */
  engineThrust(pow, alt, rmach) {
    const tmil = this.milPowerData.lookup(alt, rmach)
    // Interpolate with idle or max thrust, depending on power level command.
    if (pow < 50.0) {
      const tidl = this.idlePowerData.lookup(alt, rmach)
      return Interpolator.lerp(pow * 0.02, tidl, tmil)
    } else {
      const tmax = this.maxPowerData.lookup(alt, rmach)
      return Interpolator.lerp((pow - 50.0) * 0.02, tmil, tmax)
    }
  }

  /**
   * Computes the engine power level command, POW, for an input
   * throttle setting, THTL, for the F-16 engine model.
   *
   * @param thtl Throttle setting.  ( 0 <= THTL <= 1.0 )
   */
  tgear(thtl) {
    if (thtl <= 0.77) {
      return 64.94 * thtl
    } else {
      return 217.38 * thtl - 117.38
    }
  }

  /**
   * Computes the rate of change in engine power level using a first
   * order lag as a function of actual power, POW, and commanded
   * power, CPOW, for the F-16 engine model.
   *
   * @param pow  EngineModel power level, percent.  ( 0 <= POW <= 100. )
   * @param cpow Commanded engine power level, percent.  ( 0 <= CPOW <= 100. )
   */
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

  /**
   * Computes the thrust lag reciprocal time constant for the F-16
   * engine model.
   *
   * @param dp Change in power level, percent  ( 0 <= DP <= 100. )
   */
  rtau(dp) {
    if (dp <= 25.0) return 1.0
    if (dp >= 50.0) return 0.1
    return 1.9 - 0.036 * dp
  }
}
