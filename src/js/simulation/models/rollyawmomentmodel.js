import DataTable2D from "../math/datatable2D.js"
import SimulationConstants from "../simulationconstants.js"

export default class RollYawMomentModel {
  constructor() {
    this.dldaTable = new DataTable2D([
      [-0.041, -0.052, -0.053, -0.056, -0.05, -0.056, -0.082, -0.059, -0.042, -0.038, -0.027, -0.017],
      [-0.041, -0.053, -0.053, -0.053, -0.05, -0.051, -0.066, -0.043, -0.038, -0.027, -0.023, -0.016],
      [-0.042, -0.053, -0.052, -0.051, -0.049, -0.049, -0.043, -0.035, -0.026, -0.016, -0.018, -0.014],
      [-0.04, -0.052, -0.051, -0.052, -0.048, -0.048, -0.042, -0.037, -0.031, -0.026, -0.017, -0.012],
      [-0.043, -0.049, -0.048, -0.049, -0.043, -0.042, -0.042, -0.036, -0.025, -0.021, -0.016, -0.011],
      [-0.044, -0.048, -0.048, -0.047, -0.042, -0.041, -0.02, -0.028, -0.013, -0.014, -0.011, -0.01],
      [-0.043, -0.049, -0.047, -0.045, -0.042, -0.037, -0.003, -0.013, -0.01, -0.003, -0.007, -0.008]
    ])
    this.dldaTable.setXRange(SimulationConstants.ALPHA_MIN, SimulationConstants.ALPHA_MAX)
    this.dldaTable.setYRange(SimulationConstants.BETA_MIN, SimulationConstants.BETA_MAX)

    this.dldrTable = new DataTable2D([
      [0.005, 0.017, 0.014, 0.01, -0.005, 0.009, 0.019, 0.005, 0.0, -0.005, -0.011, 0.008],
      [0.007, 0.016, 0.014, 0.014, 0.013, 0.009, 0.012, 0.005, 0.0, 0.004, 0.009, 0.007],
      [0.013, 0.013, 0.011, 0.012, 0.011, 0.009, 0.008, 0.005, 0.0, 0.005, 0.003, 0.005],
      [0.018, 0.015, 0.015, 0.014, 0.014, 0.014, 0.014, 0.015, 0.013, 0.011, 0.006, 0.001],
      [0.015, 0.014, 0.013, 0.013, 0.012, 0.011, 0.011, 0.01, 0.008, 0.008, 0.007, 0.003],
      [0.021, 0.011, 0.01, 0.011, 0.01, 0.009, 0.008, 0.01, 0.006, 0.005, 0.0, 0.001],
      [0.023, 0.01, 0.011, 0.011, 0.011, 0.01, 0.008, 0.01, 0.006, 0.014, 0.02, 0.0]
    ])
    this.dldrTable.setXRange(SimulationConstants.ALPHA_MIN, SimulationConstants.ALPHA_MAX)
    this.dldrTable.setYRange(SimulationConstants.BETA_MIN, SimulationConstants.BETA_MAX)

    this.dndaTable = new DataTable2D([
      [0.001, -0.027, -0.017, -0.013, -0.012, -0.016, 0.001, 0.017, 0.011, 0.017, 0.008, 0.016],
      [0.002, -0.014, -0.016, -0.016, -0.014, -0.019, -0.021, 0.002, 0.012, 0.016, 0.015, 0.011],
      [-0.006, -0.008, -0.006, -0.006, -0.005, -0.008, -0.005, 0.007, 0.004, 0.007, 0.006, 0.006],
      [-0.011, -0.011, -0.01, -0.009, -0.008, -0.006, 0.0, 0.004, 0.007, 0.01, 0.004, 0.01],
      [-0.015, -0.015, -0.014, -0.012, -0.011, -0.008, -0.002, 0.002, 0.006, 0.012, 0.011, 0.011],
      [-0.024, -0.01, -0.004, -0.002, -0.001, 0.003, 0.014, 0.006, -0.001, 0.004, 0.004, 0.006],
      [-0.022, 0.002, -0.003, -0.005, -0.003, -0.001, -0.009, -0.009, -0.001, 0.003, -0.002, 0.001]
    ])
    this.dndaTable.setXRange(SimulationConstants.ALPHA_MIN, SimulationConstants.ALPHA_MAX)
    this.dndaTable.setYRange(SimulationConstants.BETA_MIN, SimulationConstants.BETA_MAX)

    this.dndrTable = new DataTable2D([
      [-0.018, -0.052, -0.052, -0.052, -0.054, -0.049, -0.059, -0.051, -0.03, -0.037, -0.026, -0.013],
      [-0.028, -0.051, -0.043, -0.046, -0.045, -0.049, -0.057, -0.052, -0.03, -0.033, -0.03, -0.008],
      [-0.037, -0.041, -0.038, -0.04, -0.04, -0.038, -0.037, -0.03, -0.027, -0.024, -0.019, -0.013],
      [-0.048, -0.045, -0.045, -0.045, -0.044, -0.045, -0.047, -0.048, -0.049, -0.045, -0.033, -0.016],
      [-0.043, -0.044, -0.041, -0.041, -0.04, -0.038, -0.034, -0.035, -0.035, -0.029, -0.022, -0.009],
      [-0.052, -0.034, -0.036, -0.036, -0.035, -0.028, -0.024, -0.023, -0.02, -0.016, -0.01, -0.014],
      [-0.062, -0.034, -0.027, -0.028, -0.027, -0.027, -0.023, -0.023, -0.019, -0.009, -0.025, -0.01]
    ])
    this.dndrTable.setXRange(SimulationConstants.ALPHA_MIN, SimulationConstants.ALPHA_MAX)
    this.dndrTable.setYRange(SimulationConstants.BETA_MIN, SimulationConstants.BETA_MAX)
  }

  /**
   * Computes the rolling moment due to aileron deflection for the
   * F-16 aerodynamic model.
   *
   * @param alpha Angle of attack, deg  ( -10 <= ALPHA <= 45 )
   * @param beta  Sideslip angle, deg   ( -30 <= BETA <= 30 )
   */
  dlda(alpha, beta) {
    return this.dldaTable.lookup(alpha, beta)
  }

  /**
   * Computes the rolling moment due to rudder deflection for the
   * F-16 aerodynamic model.
   *
   * @param alpha Angle of attack, deg  ( -10 <= ALPHA <= 45 )
   * @param beta  Sideslip angle, deg   ( -30 <= BETA <= 30 )
   */
  dldr(alpha, beta) {
    return this.dldrTable.lookup(alpha, beta)
  }

  /**
   * Computes the yawing moment due to aileron deflection for the
   * F-16 aerodynamic model.
   *
   * @param alpha Angle of attack, deg  ( -10 <= ALPHA <= 45 )
   * @param beta  Sideslip angle, deg   ( -30 <= BETA <= 30 )
   */
  dnda(alpha, beta) {
    return this.dndaTable.lookup(alpha, beta)
  }

  /**
   * Computes the yawing moment due to rudder deflection for the F-16
   * aerodynamic model.
   *
   * @param alpha Angle of attack, deg  ( -10 <= ALPHA <= 45 )
   * @param beta  Sideslip angle, deg  ( -30 <= BETA <= 30 )
   */

  dndr(alpha, beta) {
    return this.dndrTable.lookup(alpha, beta)
  }
}
