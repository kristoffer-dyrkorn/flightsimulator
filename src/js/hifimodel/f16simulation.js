import EngineModel from "./models/enginemodel.js"
import AtmosphericModel from "./models/atmosphericmodel.js"
import CompressibilityModel from "./models/compressibilitymodel.js"
import StateVector from "./statevector.js"
import SimulationConstants from "./simulationconstants.js"
import {
  hifi_C,
  hifi_C_lef,
  hifi_ailerons,
  hifi_damping,
  hifi_damping_lef,
  hifi_rudder,
  hifi_other_coeffs,
  _CXspbr,
  _CZspbr,
  _CMsbpr,
} from "./models/aerodynamicFunctions.js"

export default class F16Simulation {
  constructor() {
    this.atmosphericModel = new AtmosphericModel()
    this.engineModel = new EngineModel()
    this.compressibilityModel = new CompressibilityModel()
  }

  limit(value, min, max) {
    if (value < min) return min
    if (value > max) return max
    return value
  }

  // x = state, ie integrated state derivative
  // u = actual control positions, output from the actuator model

  getStateDerivative(u, x, xd = new StateVector()) {
    const g = SimulationConstants.G /* gravity, ft/s^2 */
    const m = SimulationConstants.MASS /* mass, slugs */
    const B = SimulationConstants.B /* span, ft */
    const S = SimulationConstants.S /* planform area, ft^2 */
    const cbar = SimulationConstants.CBAR /* mean aero chord, ft */
    const xcgr = SimulationConstants.XCGR /* reference center of gravity as a fraction of cbar */
    const xcg = SimulationConstants.XCG /* center of gravity as a fraction of cbar. */

    const Heng = SimulationConstants.HENG /* turbine momentum along roll axis. */

    const Jy = SimulationConstants.IYY /* slug-ft^2 */
    const Jxz = SimulationConstants.IXZ /* slug-ft^2 */
    const Jz = SimulationConstants.IZZ /* slug-ft^2 */
    const Jx = SimulationConstants.IXX /* slug-ft^2 */

    const npos = x.npos /* north position */
    const epos = x.epos /* east position */
    const alt = x.alt /* altitude */

    const q0 = x.q0
    const q1 = x.q1
    const q2 = x.q2
    const q3 = x.q3

    let vt = x.vt /* total velocity */
    let alpha = x.alpha * SimulationConstants.RTOD /* angle of attack in degrees */
    let beta = x.beta * SimulationConstants.RTOD /* sideslip angle in degrees */

    // most calculations are valid for alpha (-20..90 deg)
    alpha = this.limit(alpha, SimulationConstants.ALPHA_MIN, SimulationConstants.ALPHA_MAX)

    // lef calculations are only valid for a smaller alpha range (-20..45 deg)
    const alpha_lef = this.limit(alpha, SimulationConstants.ALPHA_MIN, SimulationConstants.ALPHA_MAX_LEF)
    beta = this.limit(beta, SimulationConstants.BETA_MIN, SimulationConstants.BETA_MAX)

    const P = x.p /* Roll Rate --- rolling  moment is Lbar */
    const Q = x.q /* Pitch Rate--- pitching moment is M */
    const R = x.r /* Yaw Rate  --- yawing   moment is N */

    const sa = Math.sin(x.alpha) /* sin(alpha) */
    const ca = Math.cos(x.alpha) /* cos(alpha) */
    const sb = Math.sin(x.beta) /* sin(beta)  */
    const cb = Math.cos(x.beta) /* cos(beta)  */
    const tb = Math.tan(x.beta) /* tan(beta)  */

    const r00 = q0 * q0 + q1 * q1 - q2 * q2 - q3 * q3
    const r01 = 2 * (q1 * q2 - q0 * q3)
    const r02 = 2 * (q1 * q3 + q0 * q2)
    const r10 = 2 * (q1 * q2 + q0 * q3)
    const r11 = q0 * q0 - q1 * q1 + q2 * q2 - q3 * q3
    const r12 = 2 * (q2 * q3 - q0 * q1)
    const r20 = 2 * (q1 * q3 - q0 * q2) /* = -sin(theta) */
    const r21 = 2 * (q2 * q3 + q0 * q1) /* =  sin(phi)cos(theta) */
    const r22 = q0 * q0 - q1 * q1 - q2 * q2 + q3 * q3 /* =  cos(phi)cos(theta) */

    if (vt <= 0.01) {
      vt = 0.01
    }

    this.atmosphericModel.update(vt, alt)
    this.engineModel.update(x.pow, alt, this.atmosphericModel.rmach, u.throttle)

    const T = this.engineModel.thrust
    const el = u.elevator
    const ail = u.aileron
    const rud = u.rudder
    const spbr = u.speedbrake

    const lef = u.lef

    const dail = ail / SimulationConstants.AILERON_MAX
    const drud = rud / SimulationConstants.RUDDER_MAX /* rudder normalized against max angle */
    const dlef = 1 - lef / SimulationConstants.LEF_MAX /* leading edge flap normalized against max angle */
    const dspbr = spbr / SimulationConstants.SPEEDBRAKE_MAX /* speed brake normalized against max angle */

    const U = vt * ca * cb /* directional velocities. */
    const V = vt * sb
    const W = vt * sa * cb

    xd.pow = this.engineModel.dpow

    /* nposdot */
    xd.npos = r00 * U + r01 * V + r02 * W

    /* eposdot */
    xd.epos = r10 * U + r11 * V + r12 * W

    /* altdot - altitude is up, the matrix row is down, hence the sign flip */
    xd.alt = -(r20 * U + r21 * V + r22 * W)

    const [Cx, Cz, Cm, Cy, Cn, Cl] = hifi_C(alpha, beta, el)
    const [Cxq, Cyr, Cyp, Czq, Clr, Clp, Cmq, Cnr, Cnp] = hifi_damping(alpha)
    const [delta_Cx_lef, delta_Cz_lef, delta_Cm_lef, delta_Cy_lef, delta_Cn_lef, delta_Cl_lef] = hifi_C_lef(
      alpha_lef,
      beta,
    )
    const [
      delta_Cxq_lef,
      delta_Cyr_lef,
      delta_Cyp_lef,
      delta_Czq_lef,
      delta_Clr_lef,
      delta_Clp_lef,
      delta_Cmq_lef,
      delta_Cnr_lef,
      delta_Cnp_lef,
    ] = hifi_damping_lef(alpha_lef)
    const [delta_Cy_r30, delta_Cn_r30, delta_Cl_r30] = hifi_rudder(alpha, beta)
    const [delta_Cy_a20, delta_Cy_a20_lef, delta_Cn_a20, delta_Cn_a20_lef, delta_Cl_a20, delta_Cl_a20_lef] =
      hifi_ailerons(alpha, alpha_lef, beta)

    const [delta_Cnbeta, delta_Clbeta, delta_Cm, eta_el, delta_Cm_ds] = hifi_other_coeffs(alpha, el)

    const delta_Cx_spbr_alpha = _CXspbr(alpha)
    const delta_Cz_spbr_alpha = _CZspbr(alpha)
    const delta_Cm_spbr_alpha = _CMsbpr(alpha)

    /* XXXXXXXX Cx_tot XXXXXXXX */

    const dXdQ = (cbar / (2 * vt)) * (Cxq + delta_Cxq_lef * dlef)
    const Cx_tot = Cx + delta_Cx_lef * dlef + delta_Cx_spbr_alpha * dspbr + dXdQ * Q

    /* ZZZZZZZZ Cz_tot ZZZZZZZZ */

    const dZdQ = (cbar / (2 * vt)) * (Czq + delta_Czq_lef * dlef)
    const Cz_tot = Cz + delta_Cz_lef * dlef + delta_Cz_spbr_alpha * dspbr + dZdQ * Q

    /* MMMMMMMM Cm_tot MMMMMMMM */

    const dMdQ = (cbar / (2 * vt)) * (Cmq + delta_Cmq_lef * dlef)
    const Cm_tot = Cm * eta_el + delta_Cm_lef * dlef + delta_Cm_spbr_alpha * dspbr + dMdQ * Q + delta_Cm + delta_Cm_ds

    /* YYYYYYYY Cy_tot YYYYYYYY */

    const dYdail = delta_Cy_a20 + delta_Cy_a20_lef * dlef
    const dYdR = (B / (2 * vt)) * (Cyr + delta_Cyr_lef * dlef)
    const dYdP = (B / (2 * vt)) * (Cyp + delta_Cyp_lef * dlef)

    const Cy_tot = Cy + delta_Cy_lef * dlef + dYdail * dail + delta_Cy_r30 * drud + dYdR * R + dYdP * P

    /* NNNNNNNN Cn_tot NNNNNNNN */

    const dNdail = delta_Cn_a20 + delta_Cn_a20_lef * dlef
    const dNdR = (B / (2 * vt)) * (Cnr + delta_Cnr_lef * dlef)
    const dNdP = (B / (2 * vt)) * (Cnp + delta_Cnp_lef * dlef)

    const Cn_tot =
      Cn +
      delta_Cn_lef * dlef -
      Cy_tot * (xcgr - xcg) * (cbar / B) +
      dNdail * dail +
      delta_Cn_r30 * drud +
      dNdR * R +
      dNdP * P +
      delta_Cnbeta * beta

    /* LLLLLLLL Cl_tot LLLLLLLL */

    const dLdail = delta_Cl_a20 + delta_Cl_a20_lef * dlef
    const dLdR = (B / (2 * vt)) * (Clr + delta_Clr_lef * dlef)
    const dLdP = (B / (2 * vt)) * (Clp + delta_Clp_lef * dlef)

    const Cl_tot =
      Cl + delta_Cl_lef * dlef + dLdail * dail + delta_Cl_r30 * drud + dLdR * R + dLdP * P + delta_Clbeta * beta

    /* %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
        compressibility corrections
        %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%% */

    this.compressibilityModel.update(this.atmosphericModel.rmach)

    const CD = -(Cx_tot * ca + Cz_tot * sa)
    const CL = Cx_tot * sa - Cz_tot * ca

    const CD_mach = CD + this.compressibilityModel.waveDrag
    const CL_mach = CL * this.compressibilityModel.liftFactor

    const Cx_mach = -CD_mach * ca + CL_mach * sa
    const Cz_mach = -CD_mach * sa - CL_mach * ca

    const Cm_mach = Cm_tot + Cz_mach * (xcgr - xcg + this.compressibilityModel.acShift)

    /* %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
        compute Udot,Vdot, Wdot,(as on NASA report p36)
        %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%% */

    // total force in z direction
    const Xbar = this.atmosphericModel.qbar * S * Cx_mach
    const Ybar = this.atmosphericModel.qbar * S * Cy_tot
    const Zbar = this.atmosphericModel.qbar * S * Cz_mach

    /* gravity resolved into body axes is g times the "down" row of the
       body -> earth matrix, ie (r20, r21, r22). in euler terms that row is
       (-sin(theta), sin(phi)cos(theta), cos(phi)cos(theta)). */
    const Udot = R * V - Q * W + g * r20 + (Xbar + T) / m
    const Vdot = P * W - R * U + g * r21 + Ybar / m
    const Wdot = Q * U - P * V + g * r22 + Zbar / m

    /* %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
        vt_dot equation (from S&L, p82)
        %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%% */

    xd.vt = (U * Udot + V * Vdot + W * Wdot) / vt

    /* %%%%%%%%%%%%%%%%%%
        alpha_dot equation
        %%%%%%%%%%%%%%%%%% */

    xd.alpha = (U * Wdot - W * Udot) / (U * U + W * W)

    /* %%%%%%%%%%%%%%%%%
       beta_dot equation
       %%%%%%%%%%%%%%%%% */

    xd.beta = (Vdot * vt - V * xd.vt) / (vt * vt * cb)

    /* %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
       compute Pdot, Qdot, and Rdot (as in Stevens and Lewis p32)
       %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%% */

    const L_tot = Cl_tot * this.atmosphericModel.qbar * S * B /* get moments from coefficients */
    const M_tot = Cm_mach * this.atmosphericModel.qbar * S * cbar
    const N_tot = Cn_tot * this.atmosphericModel.qbar * S * B

    const denom = Jx * Jz - Jxz * Jxz

    /* %%%%%%%%%%%%%%%%%%%%%%%
       Pdot
       %%%%%%%%%%%%%%%%%%%%%%% */

    xd.p =
      (Jz * L_tot +
        Jxz * N_tot -
        (Jz * (Jz - Jy) + Jxz * Jxz) * Q * R +
        Jxz * (Jx - Jy + Jz) * P * Q +
        Jxz * Q * Heng) /
      denom

    /* %%%%%%%%%%%%%%%%%%%%%%%
       Qdot
       %%%%%%%%%%%%%%%%%%%%%%% */

    xd.q = (M_tot + (Jz - Jx) * P * R - Jxz * (P * P - R * R) - R * Heng) / Jy

    /* %%%%%%%%%%%%%%%%%%%%%%%
       Rdot
       %%%%%%%%%%%%%%%%%%%%%%% */

    xd.r =
      (Jx * N_tot + Jxz * L_tot + (Jx * (Jx - Jy) + Jxz * Jxz) * P * Q - Jxz * (Jx - Jy + Jz) * Q * R + Jx * Q * Heng) /
      denom

    xd.q0 = 0.5 * (-P * q1 - Q * q2 - R * q3)
    xd.q1 = 0.5 * (P * q0 + R * q2 - Q * q3)
    xd.q2 = 0.5 * (Q * q0 - R * q1 + P * q3)
    xd.q3 = 0.5 * (R * q0 + Q * q1 - P * q2)

    const dq = q0 * xd.q0 + q1 * xd.q1 + q2 * xd.q2 + q3 * xd.q3

    xd.q0 -= dq * q0
    xd.q1 -= dq * q1
    xd.q2 -= dq * q2
    xd.q3 -= dq * q3

    xd.nx = (Xbar + T) / m / g
    xd.ny = Ybar / m / g
    xd.nz = -Zbar / m / g

    return xd
  }
}
