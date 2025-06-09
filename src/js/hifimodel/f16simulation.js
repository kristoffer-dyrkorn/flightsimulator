import EngineModel from "./models/enginemodel.js"
import AtmosphericModel from "./models/atmosphericmodel.js"
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
  }

  limit(value, min, max) {
    if (value < min) return min
    if (value > max) return max
    return value
  }

  // using model at:
  // https://github.com/shield09/gjf16fcs/blob/master/trim_fun.m#L72
  // dLEF = 1.38*UX0(3)*180/pi - 9.05*qbar/ps + 1.45;

  setLef(alpha, qbar, ps) {
    const lef = 1.38 * alpha - (9.05 * qbar) / ps + 1.45
    return this.limit(lef, SimulationConstants.LEF_MIN, SimulationConstants.LEF_MAX)
  }

  // x = state, ie INTEGRATED state derivative
  // u = user input

  getStateDerivative(u, x) {
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

    const phi = x.phi /* orientation angles in rad. */
    const theta = x.theta
    const psi = x.psi

    const q0 = x.q0
    const q1 = x.q1
    const q2 = x.q2
    const q3 = x.q3

    const vt = x.vt /* total velocity */
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

    const st = Math.sin(theta)
    const ct = Math.cos(theta)
    const tt = Math.tan(theta)
    const sphi = Math.sin(phi)
    const cphi = Math.cos(phi)
    const spsi = Math.sin(psi)
    const cpsi = Math.cos(psi)

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

    /* Leading edge flap setting in degrees */
    const lef = this.setLef(alpha, this.atmosphericModel.qbar, this.atmosphericModel.ps)

    const dail = ail / SimulationConstants.AILERON_MAX
    const drud = rud / SimulationConstants.RUDDER_MAX /* rudder normalized against max angle */
    const dlef = 1 - lef / SimulationConstants.LEF_MAX /* leading edge flap normalized against max angle */
    const dspbr = spbr / SimulationConstants.SPEEDBRAKE_MAX /* speed brake normalized against max angle */

    const U = vt * ca * cb /* directional velocities. */
    const V = vt * sb
    const W = vt * sa * cb

    const xd = new StateVector()

    xd.pow = this.engineModel.dpow

    /* nposdot */
    xd.npos = U * (ct * cpsi) + V * (sphi * cpsi * st - cphi * spsi) + W * (cphi * st * cpsi + sphi * spsi)

    /* eposdot */
    xd.epos = U * (ct * spsi) + V * (sphi * spsi * st + cphi * cpsi) + W * (cphi * st * spsi - sphi * cpsi)

    /* altdot */
    xd.alt = U * st - V * (sphi * ct) - W * (cphi * ct)

    /* phidot */
    xd.phi = P + tt * (Q * sphi + R * cphi)

    /* theta dot */
    xd.theta = Q * cphi - R * sphi

    /* psidot */
    xd.psi = (Q * sphi + R * cphi) / ct

    const [Cx, Cz, Cm, Cy, Cn, Cl] = hifi_C(alpha, beta, el)
    const [Cxq, Cyr, Cyp, Czq, Clr, Clp, Cmq, Cnr, Cnp] = hifi_damping(alpha)
    const [delta_Cx_lef, delta_Cz_lef, delta_Cm_lef, delta_Cy_lef, delta_Cn_lef, delta_Cl_lef] = hifi_C_lef(
      alpha_lef,
      beta
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

    // REF https://github.com/jreed1701/f16simulator/blob/master/source/jprsim.h#L293
    //
    // Alternatives
    // https://github.com/marek-cel/mscsim/blob/master/data/fdm/f16/f16_fdm.xml#L184

    // https://ntrs.nasa.gov/api/citations/19760017178/downloads/19760017178.pdf,
    // PDF-page 34, ->
    /*
    SIMULATOR STUDY OF THE EFFECTIVENESS
    OF AN AUTOMATIC CONTROL SYSTEM
    DESIGNED TO IMPROVE THE HIGH-ANGLE-OF-ATTACK CHARACTERISTICS
    OF A FIGHTER AIRPLANE 
    */

    const delta_Cx_spbr_alpha = 0 // _CXspbr(alpha)
    const delta_Cz_spbr_alpha = 0 // _CZspbr(alpha)
    const delta_Cm_spbr_alpha = 0 // _CMsbpr(alpha)

    /* XXXXXXXX Cx_tot XXXXXXXX */

    const dXdQ = (cbar / (2 * vt)) * (Cxq + delta_Cxq_lef * dlef)
    const Cx_tot = Cx + delta_Cx_lef * dlef + delta_Cx_spbr_alpha * dspbr + dXdQ * Q

    /* ZZZZZZZZ Cz_tot ZZZZZZZZ */

    const dZdQ = (cbar / (2 * vt)) * (Czq + delta_Cz_lef * dlef)
    const Cz_tot = Cz + delta_Cz_lef * dlef + delta_Cz_spbr_alpha * dspbr + dZdQ * Q

    /* MMMMMMMM Cm_tot MMMMMMMM */

    const dMdQ = (cbar / (2 * vt)) * (Cmq + delta_Cmq_lef * dlef)
    const Cm_tot =
      Cm * eta_el +
      Cz_tot * (xcgr - xcg) +
      delta_Cm_lef * dlef +
      delta_Cm_spbr_alpha * dspbr +
      dMdQ * Q +
      delta_Cm +
      delta_Cm_ds

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
        compute Udot,Vdot, Wdot,(as on NASA report p36)
        %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%% */

    // total force in z direction
    const Xbar = this.atmosphericModel.qbar * S * Cx_tot
    const Ybar = this.atmosphericModel.qbar * S * Cy_tot
    const Zbar = this.atmosphericModel.qbar * S * Cz_tot

    const Udot = R * V - Q * W - g * st + (Xbar + T) / m
    const Vdot = P * W - R * U + g * ct * sphi + Ybar / m
    const Wdot = Q * U - P * V + g * ct * cphi + Zbar / m

    /*
    const Udot = R * V - Q * W + (Xbar + T) / m + 2 * (q1 * q3 - q0 * q2) * g
    const Vdot = P * W - R * U + Ybar / m + 2 * (q2 * q3 + q0 * q1) * g
    const Wdot = Q * U - P * V + Zbar / m + (q0 * q0 - q1 * q1 - q2 * q2 + q3 * q3) * g
    */

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
    const M_tot = Cm_tot * this.atmosphericModel.qbar * S * cbar
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

    // from https://github.com/shield09/gjf16fcs/blob/master/F16_dyn.c#L620

    xd.q0 = 0.5 * (-P * q1 - Q * q2 - R * q3)
    xd.q1 = 0.5 * (P * q0 + R * q2 - Q * q3)
    xd.q2 = 0.5 * (Q * q0 - R * q1 + P * q3)
    xd.q3 = 0.5 * (R * q0 + Q * q1 - P * q2)

    /* correction term from Moldy Users Manual by K. Refson */
    const dq = q0 * xd.q0 + q1 * xd.q0 + q2 * xd.q0 + q3 * xd.q0

    xd.q0 -= dq * q0
    xd.q1 -= dq * q1
    xd.q2 -= dq * q2
    xd.q3 -= dq * q3

    /*
    xd.epos = (q0 * q0 + q1 * q1 - q2 * q2 - q3 * q3) * U + 2 * (q1 * q2 - q0 * q3) * V + 2 * (q1 * q3 + q0 * q2) * W
    xd.npos = 2 * (q1 * q2 + q0 * q3) * U + (q0 * q0 - q1 * q1 + q2 * q2 - q3 * q3) * V + 2 * (q2 * q3 - q0 * q1) * W
    xd.alt = 2 * (q1 * q3 - q0 * q2) * U + 2 * (q2 * q3 + q0 * q1) * V + (q0 * q0 - q1 * q1 - q2 * q2 + q3 * q3) * W
    */

    // acceleration along z = pilot G
    xd.nz = -Zbar / m / g

    return xd
  }
}
