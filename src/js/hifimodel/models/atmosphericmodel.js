import SimulationConstants from "../simulationconstants.js"

const TROPOPAUSE = 36089 /* ft */
const TROPOPAUSE_TEMPERATURE = 389.97 /* Rankine */

const SEA_LEVEL_TEMPERATURE = 518.67 /* Rankine */
const SEA_LEVEL_DENSITY = 0.002377 /* slug/ft^3 */

const LAPSE_SCALE = 145442 /* ft */

const DENSITY_EXPONENT = 4.255876

const GAS_CONSTANT = 1716.56 /* ft lbf / slug R */
const GAMMA = 1.403 /* ratio of specific heats */

const TROPOPAUSE_DENSITY = SEA_LEVEL_DENSITY * Math.pow(1 - TROPOPAUSE / LAPSE_SCALE, DENSITY_EXPONENT)

const SCALE_HEIGHT = (GAS_CONSTANT * TROPOPAUSE_TEMPERATURE) / SimulationConstants.G

export default class AtmosphericModel {
  constructor() {
    this.rmach = 0
    this.qbar = 0
    this.ps = 0
  }

  update(vt, alt) {
    let t
    let rho

    if (alt < TROPOPAUSE) {
      const tfac = 1 - alt / LAPSE_SCALE
      t = SEA_LEVEL_TEMPERATURE * tfac
      rho = SEA_LEVEL_DENSITY * Math.pow(tfac, DENSITY_EXPONENT)
    } else {
      t = TROPOPAUSE_TEMPERATURE
      rho = TROPOPAUSE_DENSITY * Math.exp(-(alt - TROPOPAUSE) / SCALE_HEIGHT)
    }

    this.rmach = vt / Math.sqrt(GAMMA * GAS_CONSTANT * t)
    this.qbar = 0.5 * rho * vt * vt
    this.ps = GAS_CONSTANT * rho * t
  }
}
