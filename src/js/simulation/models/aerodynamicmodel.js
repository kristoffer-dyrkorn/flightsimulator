import AerodynamicForceModel from "./aerodynamicforcemodel.js"
import AerodynamicMomentModel from "./aerodynamicmomentmodel.js"
import RollYawMomentModel from "./rollyawmomentmodel.js"
import DampingModel from "./dampingmodel.js"
import SimulationConstants from "../simulationconstants.js"

export default class AerodynamicModel {
  constructor() {
    this.afm = new AerodynamicForceModel()
    this.amm = new AerodynamicMomentModel()
    this.rymm = new RollYawMomentModel()
    this.dmp = new DampingModel()

    // Body axis nondimensional aerodynamic force coefficients
    this.cx = 0
    this.cy = 0
    this.cz = 0

    // Body axis nondimensional aerodynamic moment coefficients
    this.cl = 0
    this.cm = 0
    this.cn = 0
  }

  /**
   * Computes the body axis nondimensional aerodynamic coefficients
   * for the F-16 based on wind tunnel data from NASA TP 1538,
   * December 1979.
   *
   * @param vt    Airspeed, ft/sec.
   * @param alpha Angle of attack, deg. ( -10 <= alpha <= 45 )
   * @param beta  Sideslip angle, deg.  ( -30 <= BETA <= 30 )
   * @param p     Body axis angular velocity in roll, rad/sec.
   * @param q     Body axis angular velocity in pitch, rad/sec.
   * @param r     Body axis angular velocity in yaw, rad/sec.
   * @param el    Elevator deflection, deg.  ( -25 <= EL <= 25 )
   * @param ail   Aileron deflection, deg.  ( -21.5 <= AIL <= 21.5 )
   * @param rdr   Rudder deflection, deg.  ( -30 <= RDR <= 30 )
   * @param xcg   Longitudinal c.g. location, distance normalized by the m.a.c.
   */
  update(vt, alpha, beta, p, q, r, el, ail, rdr, xcg) {
    // Basic flow angle and control surface aerodynamics.
    this.cx = this.afm.cxAero(alpha, el)
    this.cy = this.afm.cyAero(beta, ail, rdr)
    this.cz = this.afm.czAero(alpha, beta, el)

    const dail = ail / SimulationConstants.AILERON_MAX // 20.0f;
    const drdr = rdr / SimulationConstants.RUDDER_MAX // 30.0f;

    this.cl = this.amm.clAero(alpha, beta)

    const dclda = this.rymm.dlda(alpha, beta)
    const dcldr = this.rymm.dldr(alpha, beta)

    this.cl = this.cl + dclda * dail + dcldr * drdr

    this.cm = this.amm.cmAero(alpha, el)
    this.cn = this.amm.cnAero(alpha, beta)

    const dcnda = this.rymm.dnda(alpha, beta)
    const dcndr = this.rymm.dndr(alpha, beta)

    this.cn = this.cn + dcnda * dail + dcndr * drdr

    // Add damping terms.
    this.dmp.update(alpha)

    const cq = (0.5 * q * SimulationConstants.CBAR) / vt
    const b2v = (0.5 * SimulationConstants.B) / vt

    this.cx += cq * this.dmp.d[0]
    this.cy += b2v * (this.dmp.d[1] * r + this.dmp.d[2] * p)
    this.cz += cq * this.dmp.d[3]
    this.cl += b2v * (this.dmp.d[4] * r + this.dmp.d[5] * p)
    this.cm += cq * this.dmp.d[6] + this.cz * (SimulationConstants.XCGR - xcg)
    this.cn +=
      b2v * (this.dmp.d[7] * r + this.dmp.d[8] * p) -
      (this.cy * (SimulationConstants.XCGR - xcg) * SimulationConstants.CBAR) / SimulationConstants.B
  }
}
