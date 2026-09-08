import EngineModel from "./models/enginemodel.js"
import AtmosphericModel from "./models/atmosphericmodel.js"
import CompressibilityModel from "./models/compressibilitymodel.js"
import TurbulenceModel from "./models/turbulencemodel.js"
import WindModel from "./models/windmodel.js"
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
    this.turbulenceModel = new TurbulenceModel()
    this.windModel = new WindModel()
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

    let vt = x.vt /* total velocity over the ground */

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

    const U = vt * ca * cb /* body axis velocities, over the ground */
    const V = vt * sb
    const W = vt * sa * cb

    /* Wind, of both kinds: the steady flow of the airmass, read from the
       forecast at this altitude, and the gust on top of it. Neither is a force
       on the aircraft - both are changes in the air it is flying through - so the
       state stays the velocity over the ground and the aerodynamics are handed
       the velocity relative to the air, which is the thing they were always a
       function of. In still air the two are the same and everything below
       reduces to what it was.

       The steady wind arrives in earth axes and has to be turned into body axes
       to be subtracted, which is the body to earth matrix used backwards - its
       transpose, hence the columns being read down instead of along. The wind
       has no vertical component, so the "down" column of it drops out. */
    this.windModel.update(alt)

    const windNorth = this.windModel.north
    const windEast = this.windModel.east

    const windX = r00 * windNorth + r10 * windEast
    const windY = r01 * windNorth + r11 * windEast
    const windZ = r02 * windNorth + r12 * windEast

    const gust = this.turbulenceModel

    const Ua = U - windX - gust.u
    const Va = V - windY - gust.v
    const Wa = W - windZ - gust.w

    const vta = Math.max(Math.sqrt(Ua * Ua + Va * Va + Wa * Wa), 0.01) /* true airspeed */

    /* angle of attack and sideslip against the air, radians */
    const alphaAero = Math.atan2(Wa, Ua)
    const betaAero = Math.asin(this.limit(Va / vta, -1, 1))

    const saAero = Math.sin(alphaAero)
    const caAero = Math.cos(alphaAero)

    /* Body rates as the aerodynamics see them. A gust that varies across the
       aircraft rotates it, and from the inside that is indistinguishable from
       the aircraft turning: the rotational gust therefore adds to the rate in
       every aerodynamic term, and appears nowhere in the rigid body equations
       below, where the rates are the aircraft's own. */
    const Paero = P + gust.p
    const Qaero = Q + gust.q
    const Raero = R + gust.r

    // most calculations are valid for alpha (-20..90 deg)
    const alpha = this.limit(
      alphaAero * SimulationConstants.RTOD,
      SimulationConstants.ALPHA_MIN,
      SimulationConstants.ALPHA_MAX,
    )

    // lef calculations are only valid for a smaller alpha range (-20..45 deg)
    const alpha_lef = this.limit(alpha, SimulationConstants.ALPHA_MIN, SimulationConstants.ALPHA_MAX_LEF)

    const beta = this.limit(
      betaAero * SimulationConstants.RTOD,
      SimulationConstants.BETA_MIN,
      SimulationConstants.BETA_MAX,
    )

    this.atmosphericModel.update(vta, alt)
    this.engineModel.update(x.pow, alt, this.atmosphericModel.rmach, u.throttle)

    const T = this.engineModel.thrust
    const el = u.elevator
    const ail = u.aileron
    const stabDiff = u.stabilatorDiff
    const rud = u.rudder
    const spbr = u.speedbrake

    const lef = u.lef

    const dail = ail / SimulationConstants.AILERON_MAX
    const drud = rud / SimulationConstants.RUDDER_MAX /* rudder normalized against max angle */
    const dlef = 1 - lef / SimulationConstants.LEF_MAX /* leading edge flap normalized against max angle */
    const dspbr = spbr / SimulationConstants.SPEEDBRAKE_MAX /* speed brake normalized against max angle */

    /* The stabilator is two independent surfaces, not one - el is their
       average, and stabDiff is how far apart they are, so left and right
       each get their own deflection. Left gets less lift for a positive
       differential, right gets more: that is what rolls the aircraft left,
       matching the sign convention the ailerons already use. Each side is
       still limited to what a real panel can move, even when a symmetric
       command near its own limit leaves no room left for the differential
       on top of it. */
    const elLeft = this.limit(el - stabDiff, SimulationConstants.ELEVATOR_MIN, SimulationConstants.ELEVATOR_MAX)
    const elRight = this.limit(el + stabDiff, SimulationConstants.ELEVATOR_MIN, SimulationConstants.ELEVATOR_MAX)

    xd.pow = this.engineModel.dpow

    /* nposdot */
    xd.npos = r00 * U + r01 * V + r02 * W

    /* eposdot */
    xd.epos = r10 * U + r11 * V + r12 * W

    /* altdot - altitude is up, the matrix row is down, hence the sign flip */
    xd.alt = -(r20 * U + r21 * V + r22 * W)

    /* hifi_C is a function of one elevator deflection because the tunnel
       data behind it is - the tail was tested moving as a unit. Averaging
       its output for the two actual deflections is the natural way to
       extend that to a differential command: at stabDiff = 0 it collapses
       back to the single call this replaces, and asymmetric deflections
       pick up whatever elevator-dependent rolling and yawing moment the
       table already carries, on each side, rather than none at all. */
    const [CxL, CzL, CmL, CyL, CnL, ClL] = hifi_C(alpha, beta, elLeft)
    const [CxR, CzR, CmR, CyR, CnR, ClR] = hifi_C(alpha, beta, elRight)

    const Cx = 0.5 * (CxL + CxR)
    const Cz = 0.5 * (CzL + CzR)
    const Cm = 0.5 * (CmL + CmR)
    const Cy = 0.5 * (CyL + CyR)
    const Cn = 0.5 * (CnL + CnR)
    const Cl = 0.5 * (ClL + ClR)

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

    const [delta_CnbetaL, delta_ClbetaL, delta_CmL2, eta_elL, delta_Cm_dsL] = hifi_other_coeffs(alpha, elLeft)
    const [delta_CnbetaR, delta_ClbetaR, delta_CmR2, eta_elR, delta_Cm_dsR] = hifi_other_coeffs(alpha, elRight)

    const delta_Cnbeta = 0.5 * (delta_CnbetaL + delta_CnbetaR)
    const delta_Clbeta = 0.5 * (delta_ClbetaL + delta_ClbetaR)
    const delta_Cm = 0.5 * (delta_CmL2 + delta_CmR2)
    const eta_el = 0.5 * (eta_elL + eta_elR)
    const delta_Cm_ds = 0.5 * (delta_Cm_dsL + delta_Cm_dsR)

    const delta_Cx_spbr_alpha = _CXspbr(alpha)
    const delta_Cz_spbr_alpha = _CZspbr(alpha)
    const delta_Cm_spbr_alpha = _CMsbpr(alpha)

    /* XXXXXXXX Cx_tot XXXXXXXX */

    const dXdQ = (cbar / (2 * vta)) * (Cxq + delta_Cxq_lef * dlef)
    const Cx_tot = Cx + delta_Cx_lef * dlef + delta_Cx_spbr_alpha * dspbr + dXdQ * Qaero

    /* ZZZZZZZZ Cz_tot ZZZZZZZZ */

    const dZdQ = (cbar / (2 * vta)) * (Czq + delta_Czq_lef * dlef)
    const Cz_tot = Cz + delta_Cz_lef * dlef + delta_Cz_spbr_alpha * dspbr + dZdQ * Qaero

    /* MMMMMMMM Cm_tot MMMMMMMM */

    const dMdQ = (cbar / (2 * vta)) * (Cmq + delta_Cmq_lef * dlef)
    const Cm_tot =
      Cm * eta_el + delta_Cm_lef * dlef + delta_Cm_spbr_alpha * dspbr + dMdQ * Qaero + delta_Cm + delta_Cm_ds

    /* YYYYYYYY Cy_tot YYYYYYYY */

    const dYdail = delta_Cy_a20 + delta_Cy_a20_lef * dlef
    const dYdR = (B / (2 * vta)) * (Cyr + delta_Cyr_lef * dlef)
    const dYdP = (B / (2 * vta)) * (Cyp + delta_Cyp_lef * dlef)

    const Cy_tot = Cy + delta_Cy_lef * dlef + dYdail * dail + delta_Cy_r30 * drud + dYdR * Raero + dYdP * Paero

    /* NNNNNNNN Cn_tot NNNNNNNN */

    const dNdail = delta_Cn_a20 + delta_Cn_a20_lef * dlef
    const dNdR = (B / (2 * vta)) * (Cnr + delta_Cnr_lef * dlef)
    const dNdP = (B / (2 * vta)) * (Cnp + delta_Cnp_lef * dlef)

    const Cn_tot =
      Cn +
      delta_Cn_lef * dlef -
      Cy_tot * (xcgr - xcg) * (cbar / B) +
      dNdail * dail +
      delta_Cn_r30 * drud +
      dNdR * Raero +
      dNdP * Paero +
      delta_Cnbeta * beta

    /* LLLLLLLL Cl_tot LLLLLLLL */

    const dLdail = delta_Cl_a20 + delta_Cl_a20_lef * dlef
    const dLdR = (B / (2 * vta)) * (Clr + delta_Clr_lef * dlef)
    const dLdP = (B / (2 * vta)) * (Clp + delta_Clp_lef * dlef)

    const Cl_tot =
      Cl + delta_Cl_lef * dlef + dLdail * dail + delta_Cl_r30 * drud + dLdR * Raero + dLdP * Paero + delta_Clbeta * beta

    /* %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
        compressibility corrections
        %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%% */

    this.compressibilityModel.update(this.atmosphericModel.rmach)

    /* body axes to wind axes and back, so this is the rotation through the
       aerodynamic angle of attack rather than the one the flight path makes */
    const CD = -(Cx_tot * caAero + Cz_tot * saAero)
    const CL = Cx_tot * saAero - Cz_tot * caAero

    const CD_mach = CD + this.compressibilityModel.waveDrag
    const CL_mach = CL * this.compressibilityModel.liftFactor

    const Cx_mach = -CD_mach * caAero + CL_mach * saAero
    const Cz_mach = -CD_mach * saAero - CL_mach * caAero

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

    /* Not a derivative either, but the aircraft's own instruments read it and
       the control laws are scheduled on it, and neither of them can get at it
       any other way: in a wind the speed over the ground the state carries is
       not the speed through the air. */
    xd.airspeed = vta

    return xd
  }
}
