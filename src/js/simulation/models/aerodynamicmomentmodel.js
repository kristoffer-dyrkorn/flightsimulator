import DataTable2D from "../math/datatable2D.js"
import Interpolator from "../math/interpolator.js"
import SimulationConstants from "../simulationconstants.js"

export default class AerodynamicMomentModel {
  constructor() {
    this.clAeroTable = new DataTable2D([
      [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
      [-0.001, -0.004, -0.008, -0.012, -0.016, -0.022, -0.022, -0.021, -0.015, -0.008, -0.013, -0.015],
      [-0.003, -0.009, -0.017, -0.024, -0.03, -0.041, -0.045, -0.04, -0.016, -0.002, -0.01, -0.019],
      [-0.001, -0.01, -0.02, -0.03, -0.039, -0.054, -0.057, -0.054, -0.023, -0.006, -0.014, -0.027],
      [0.0, -0.01, -0.022, -0.034, -0.047, -0.06, -0.069, -0.067, -0.033, -0.036, -0.035, -0.035],
      [0.007, -0.01, -0.023, -0.034, -0.049, -0.063, -0.081, -0.079, -0.06, -0.058, -0.062, -0.059],
      [0.009, -0.011, -0.023, -0.037, -0.05, -0.068, -0.089, -0.088, -0.091, -0.076, -0.077, -0.076]
    ])
    this.clAeroTable.setXRange(SimulationConstants.ALPHA_MIN, SimulationConstants.ALPHA_MAX)
    this.clAeroTable.setYRange(0, SimulationConstants.BETA_MAX)

    this.cmAeroTable = new DataTable2D([
      [0.205, 0.168, 0.186, 0.196, 0.213, 0.251, 0.245, 0.238, 0.252, 0.231, 0.198, 0.192],
      [0.081, 0.077, 0.107, 0.11, 0.11, 0.141, 0.127, 0.119, 0.133, 0.108, 0.081, 0.093],
      [-0.046, -0.02, -0.009, -0.005, -0.006, 0.01, 0.006, -0.001, 0.014, 0.0, -0.013, 0.032],
      [-0.174, -0.145, -0.121, -0.127, -0.129, -0.102, -0.097, -0.113, -0.087, -0.084, -0.069, -0.006],
      [-0.259, -0.202, -0.184, -0.193, -0.199, -0.15, -0.16, -0.167, -0.104, -0.076, -0.041, -0.005]
    ])
    this.cmAeroTable.setXRange(SimulationConstants.ALPHA_MIN, SimulationConstants.ALPHA_MAX)
    this.cmAeroTable.setYRange(SimulationConstants.ELEVATOR_MIN, SimulationConstants.ELEVATOR_MAX)

    this.cnAeroTable = new DataTable2D([
      [0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
      [0.018, 0.019, 0.018, 0.019, 0.019, 0.018, 0.013, 0.007, 0.004, -0.014, -0.017, -0.033],
      [0.038, 0.042, 0.042, 0.042, 0.043, 0.039, 0.03, 0.017, 0.004, -0.035, -0.047, -0.057],
      [0.056, 0.057, 0.059, 0.058, 0.058, 0.053, 0.032, 0.012, 0.002, -0.046, -0.071, -0.073],
      [0.064, 0.077, 0.076, 0.074, 0.073, 0.057, 0.029, 0.007, 0.012, -0.034, -0.065, -0.041],
      [0.074, 0.086, 0.093, 0.089, 0.08, 0.062, 0.049, 0.022, 0.028, -0.012, -0.002, -0.013],
      [0.079, 0.09, 0.106, 0.106, 0.096, 0.08, 0.068, 0.03, 0.064, 0.015, 0.011, -0.001]
    ])
    this.cnAeroTable.setXRange(SimulationConstants.ALPHA_MIN, SimulationConstants.ALPHA_MAX)
    this.cnAeroTable.setYRange(0, SimulationConstants.BETA_MAX)
  }

  /**
   * Computes the X body axis aerodynamic moment coefficient for the
   * F-16 aerodynamic model.
   *
   * @param alpha Angle of attack, deg  ( -10 <= ALPHA <= 45 )
   * @param beta  Sideslip angle, deg   ( -30 <= BETA <= 30 )
   */
  clAero(alpha, beta) {
    return this.clAeroTable.lookup(alpha, Math.abs(beta)) * Interpolator.sign(beta)
  }

  /**
   * Computes the Y body axis aerodynamic moment coefficient for the
   * F-16 aerodynamic model.
   *
   * @param alpha Angle of attack, deg     ( -10 <= ALPHA <= 45 )
   * @param el    Elevator deflection, deg ( -25 <= EL <= 25 )
   */
  cmAero(alpha, el) {
    return this.cmAeroTable.lookup(alpha, el)
  }

  /**
   * Computes the Z body axis aerodynamic moment coefficient for the
   * F-16 aerodynamic model.
   *
   * @param alpha Angle of attack, deg  ( -10 <= ALPHA <= 45 )
   * @param beta  Sideslip angle, deg  ( -30 <= BETA <= 30 )
   */
  cnAero(alpha, beta) {
    return this.cnAeroTable.lookup(alpha, Math.abs(beta)) * Interpolator.sign(beta)
  }
}
