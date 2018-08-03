import DataTable1D from "../math/datatable1D.js"
import SimulationConstants from "../simulationconstants.js"

export default class DampingModel {
  constructor() {
    this.d = new Array(9)
    this.dampingTable = []

    this.dampingTable[0] = new DataTable1D([-0.267, -0.11, 0.308, 1.34, 2.08, 2.91, 2.76, 2.05, 1.5, 1.49, 1.83, 1.21])
    this.dampingTable[1] = new DataTable1D([
      0.882,
      0.852,
      0.876,
      0.958,
      0.962,
      0.974,
      0.819,
      0.483,
      0.59,
      1.21,
      -0.493,
      -1.04
    ])
    this.dampingTable[2] = new DataTable1D([
      -0.108,
      -0.108,
      -0.188,
      0.11,
      0.258,
      0.226,
      0.344,
      0.362,
      0.611,
      0.529,
      0.298,
      -0.227
    ])
    this.dampingTable[3] = new DataTable1D([
      -8.8,
      -25.8,
      -28.9,
      -31.4,
      -31.2,
      -30.7,
      -27.7,
      -28.2,
      -29.0,
      -29.8,
      -38.3,
      -35.3
    ])
    this.dampingTable[4] = new DataTable1D([
      -0.126,
      -0.026,
      0.063,
      0.113,
      0.208,
      0.23,
      0.319,
      0.437,
      0.68,
      0.1,
      0.447,
      -0.33
    ])
    this.dampingTable[5] = new DataTable1D([
      -0.36,
      -0.359,
      -0.443,
      -0.42,
      -0.383,
      -0.375,
      -0.329,
      -0.294,
      -0.23,
      -0.21,
      -0.12,
      -0.1
    ])
    this.dampingTable[6] = new DataTable1D([
      -7.21,
      -5.4,
      -5.23,
      -5.26,
      -6.11,
      -6.64,
      -5.69,
      -6.0,
      -6.2,
      -6.4,
      -6.6,
      -6.0
    ])
    this.dampingTable[7] = new DataTable1D([
      -0.38,
      -0.363,
      -0.378,
      -0.386,
      -0.37,
      -0.453,
      -0.55,
      -0.582,
      -0.595,
      -0.637,
      -1.02,
      -0.84
    ])
    this.dampingTable[8] = new DataTable1D([
      0.061,
      0.052,
      0.052,
      -0.012,
      -0.013,
      -0.024,
      0.05,
      0.15,
      0.13,
      0.158,
      0.24,
      0.15
    ])

    for (let i = 0; i <= 8; i++) {
      this.dampingTable[i].setRange(SimulationConstants.ALPHA_MIN, SimulationConstants.ALPHA_MAX)
    }
  }

  /**
   * Computes the damping coefficients for the F-16 aerodynamic
   * model.
   *
   * @param alpha Angle of attack, deg  ( -10 <= ALPHA <= 45 )
   *              Output: d = [CXq, CYr, CYp, CZq, Clr, Clp, Cmq, Cnr, Cnp]
   */
  update(alpha) {
    for (let i = 0; i <= 8; i++) {
      this.d[i] = this.dampingTable[i].lookup(alpha)
    }
  }
}
