import DataTable1D from "../math/datatable1D.js"
import DataTable2D from "../math/datatable2D.js"
import SimulationConstants from "../simulationconstants.js"

export default class AerodynamicForceModel {
  constructor() {
    this.cxAeroTable = new DataTable2D([
      [-0.099, -0.081, -0.081, -0.063, -0.025, 0.044, 0.097, 0.113, 0.145, 0.167, 0.174, 0.166],
      [-0.048, -0.038, -0.04, -0.021, 0.016, 0.083, 0.127, 0.137, 0.162, 0.177, 0.179, 0.167],
      [-0.022, -0.02, -0.021, -0.004, 0.032, 0.094, 0.128, 0.13, 0.154, 0.161, 0.155, 0.138],
      [-0.04, -0.038, -0.039, -0.025, 0.006, 0.062, 0.087, 0.085, 0.1, 0.11, 0.104, 0.091],
      [-0.083, -0.073, -0.076, -0.072, -0.046, 0.012, 0.024, 0.025, 0.043, 0.053, 0.047, 0.04]
    ])
    this.cxAeroTable.setXRange(SimulationConstants.ALPHA_MIN, SimulationConstants.ALPHA_MAX)
    this.cxAeroTable.setYRange(SimulationConstants.ELEVATOR_MIN, SimulationConstants.ELEVATOR_MAX)

    this.czAeroTable = new DataTable1D([
      0.77,
      0.241,
      -0.1,
      -0.416,
      -0.731,
      -1.053,
      -1.366,
      -1.646,
      -1.917,
      -2.12,
      -2.248,
      -2.229
    ])
    this.czAeroTable.setRange(SimulationConstants.ALPHA_MIN, SimulationConstants.ALPHA_MAX)
  }

  /**
   * Computes the X body axis aerodynamic force coefficient for the
   * F-16 aerodynamic model.
   *
   * @param alpha Angle of attack, deg      ( -10 <= ALPHA <= 45 )
   * @param el    Elevator deflection, deg  ( -25 <= EL <= 25 )
   */
  cxAero(alpha, el) {
    return this.cxAeroTable.lookup(alpha, el)
  }

  /**
   * This function computes the Y body axis aerodynamic force coefficient
   * for the F-16 aerodynamic model.
   *
   * @param beta Sideslip angle, deg     ( -30 <= BETA <= 30 )
   * @param ail  Aileron deflection, deg ( -21.5 <= AIL <= 21.5 )
   * @param rdr  Rudder deflection, deg  ( -30 <= RDR <= 30 )
   */
  cyAero(beta, ail, rdr) {
    return (
      -0.02 * beta + 0.021 * (ail / SimulationConstants.AILERON_MAX) + 0.086 * (rdr / SimulationConstants.RUDDER_MAX)
    )
  }

  /**
   * Computes the Z body axis aerodynamic force coefficient for the
   * F-16 aerodynamic model.
   *
   * @param alpha Angle of attack, deg     ( -10 <= ALPHA <= 45 )
   * @param beta  Sideslip angle, deg      ( -30 <= BETA <= 30 )
   * @param el    Elevator deflection, deg ( -25 <= EL <= 25 )
   */
  czAero(alpha, beta, el) {
    return (
      this.czAeroTable.lookup(alpha) * (1.0 - Math.pow(beta / 57.3, 2)) - 0.19 * (el / SimulationConstants.ELEVATOR_MAX)
    )
  }
}
