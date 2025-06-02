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
} from "./models/aerodynamicFunctions.js"

export default class F16Simulation {
  constructor() {
    this.atmosphericModel = new AtmosphericModel()
    this.engineModel = new EngineModel()
  }

  // x = INTEGRATED state derivative
  // xd = "normal" state, ie state derivatives

  getAccelerations(x, xd) {
    const g = SimulationConstants.G

    const sina = Math.sin(x.alpha)
    const cosa = Math.cos(x.alpha)
    const sinb = Math.sin(x.beta)
    const cosb = Math.cos(x.beta)

    const vel_u = x.vt * cosb * cosa
    const vel_v = x.vt * sinb
    const vel_w = x.vt * cosb * sina

    const u_dot = cosb * cosa * xd.vt - x.vt * sinb * cosa * xd.beta - x.vt * cosb * sina * xd.alpha
    const v_dot = sinb * xd.vt + x.vt * cosb * xd.beta
    const w_dot = cosb * sina * xd.vt - x.vt * sinb * sina * xd.beta + x.vt * cosb * cosa * xd.alpha

    const nx_cg = (1.0 / g) * (u_dot + x.q * vel_w - x.r * vel_v) + Math.sin(x.theta)
    const ny_cg = (1.0 / g) * (v_dot + x.r * vel_u - x.p * vel_w) - Math.cos(x.theta) * Math.sin(x.phi)
    const nz_cg = (-1.0 / g) * (w_dot + x.p * vel_v - x.q * vel_u) + Math.cos(x.theta) * Math.cos(x.phi)

    return [nx_cg, ny_cg, nz_cg]
  }

  // using model at:
  // https://github.com/johnviljoen/f16_mpc_oop_py/blob/master/Nguyen_m/trimfun.m#L84
  // dLEF = 1.38*UX0(3)*180/pi - 9.05*qbar/ps + 1.45;

  // this model seems incorrect
  // https://github.com/johnviljoen/f16_mpc_oop_py/blob/master/utils.py#L289

  // TODO: DEFLECTION LIMIT & RATE LIMIT
  setLef(alpha, qbar, ps) {
    return 1.38 * alpha - (9.05 * qbar) / ps + 1.45
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

    /*
    Presented in table VI are thrust values for idle, military, and maximum thrust levels. 
    Engine gyroscopic effects were simulated by represent- ing the engine angular momentum at a fixed value of 216.9 kg-m2/sec
    (160 slug-ft2/sec).
    */

    const Heng = 160.0 /* turbine momentum along roll axis. */

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

    const vt = x.vt /* total velocity */
    const alpha = x.alpha * SimulationConstants.RTOD /* angle of attack in degrees */
    const beta = x.beta * SimulationConstants.RTOD /* sideslip angle in degrees */
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

    const T = this.engineModel.thrust /* thrust */
    const el = u.elevator /* Elevator setting in degrees. */
    const ail = u.aileron /* Ailerons mex setting in degrees. */
    const rud = u.rudder /* Rudder setting in degrees. */

    /* Leading edge flap setting in degrees */
    const lef = this.setLef(alpha, this.atmosphericModel.qbar, this.atmosphericModel.ps)

    // TODO: Limit LEF values

    const dail = ail / SimulationConstants.AILERON_MAX
    const drud = rud / SimulationConstants.RUDDER_MAX /* rudder normalized against max angle */
    const dlef = 1 - lef / SimulationConstants.LEF_MAX /* leading edge flap normalized against max angle */

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
    const [delta_Cx_lef, delta_Cz_lef, delta_Cm_lef, delta_Cy_lef, delta_Cn_lef, delta_Cl_lef] = hifi_C_lef(alpha, beta)
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
    ] = hifi_damping_lef(alpha)
    const [delta_Cy_r30, delta_Cn_r30, delta_Cl_r30] = hifi_rudder(alpha, beta)
    const [delta_Cy_a20, delta_Cy_a20_lef, delta_Cn_a20, delta_Cn_a20_lef, delta_Cl_a20, delta_Cl_a20_lef] =
      hifi_ailerons(alpha, beta)

    // delta_Cm_ds will be 0, deep-stall effect is ignored
    const [delta_Cnbeta, delta_Clbeta, delta_Cm, eta_el, delta_Cm_ds] = hifi_other_coeffs(alpha, el)

    /* XXXXXXXX Cx_tot XXXXXXXX */

    const dXdQ = (cbar / (2 * vt)) * (Cxq + delta_Cxq_lef * dlef)
    const Cx_tot = Cx + delta_Cx_lef * dlef + dXdQ * Q

    /* ZZZZZZZZ Cz_tot ZZZZZZZZ */

    const dZdQ = (cbar / (2 * vt)) * (Czq + delta_Cz_lef * dlef)
    const Cz_tot = Cz + delta_Cz_lef * dlef + dZdQ * Q

    /* MMMMMMMM Cm_tot MMMMMMMM */

    const dMdQ = (cbar / (2 * vt)) * (Cmq + delta_Cmq_lef * dlef)
    const Cm_tot = Cm * eta_el + Cz_tot * (xcgr - xcg) + delta_Cm_lef * dlef + dMdQ * Q + delta_Cm + delta_Cm_ds

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

    const Udot = R * V - Q * W - g * st + (x.qbar * S * Cx_tot) / m + T / m
    const Vdot = P * W - R * U + g * ct * sphi + (x.qbar * S * Cy_tot) / m
    const Wdot = Q * U - P * V + g * ct * cphi + (x.qbar * S * Cz_tot) / m

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

    const L_tot = Cl_tot * x.qbar * S * B /* get moments from coefficients */
    const M_tot = Cm_tot * x.qbar * S * cbar
    const N_tot = Cn_tot * x.qbar * S * B

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

    const [nx, ny, nz] = this.getAccelerations(x, xd)

    xd.nx = nx
    xd.ny = ny
    xd.nz = nz

    return xd
  }
}
