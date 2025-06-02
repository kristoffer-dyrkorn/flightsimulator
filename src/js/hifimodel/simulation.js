import {
  hifi_C,
  hifi_C_lef,
  hifi_ailerons,
  hifi_damping,
  hifi_damping_lef,
  hifi_other_coeffs,
  hifi_rudder,
} from "./models/aerodynamicFunctions.js"

function atmos(alt, vt) {
  const rho0 = 2.377e-3
  const tfac = 1 - 0.703e-5 * alt

  let temp = 519.0 * tfac
  if (alt >= 35000.0) {
    temp = 390
  }

  const rho = rho0 * Math.pow(tfac, 4.14)

  const mach = vt / Math.sqrt(1.4 * 1716.3 * temp)
  const qbar = 0.5 * rho * vt * vt
  const ps = 1715.0 * rho * temp

  if (ps == 0) {
    ps = 1715
  }

  return [mach, qbar, ps]
}

// using model at:
// https://github.com/johnviljoen/f16_mpc_oop_py/blob/master/Nguyen_m/trimfun.m#L84
// dLEF = 1.38*UX0(3)*180/pi - 9.05*qbar/ps + 1.45;

// not using the model here as it seems incorrect
// https://github.com/johnviljoen/f16_mpc_oop_py/blob/master/utils.py#L289

// TODO: DEFLECTION LIMIT & RATE LIMIT
function setLeadingEdgeFlaps(qbar, ps) {
  return 1.38 * alpha * RAD2DEG - (9.05 * qbar) / ps + 1.45
}

function accels(state, xdot) {
  const g = 32.174

  const sina = Math.sin(state[7])
  const cosa = Math.cos(state[7])
  const sinb = Math.sin(state[8])
  const cosb = Math.cos(state[8])

  const vel_u = state[6] * cosb * cosa
  const vel_v = state[6] * sinb
  const vel_w = state[6] * cosb * sina

  const u_dot = cosb * cosa * xdot[6] - state[6] * sinb * cosa * xdot[8] - state[6] * cosb * sina * xdot[7]

  const v_dot = sinb * xdot[6] + state[6] * cosb * xdot[8]

  const w_dot = cosb * sina * xdot[6] - state[6] * sinb * sina * xdot[8] + state[6] * cosb * cosa * xdot[7]

  const nx_cg = (1.0 / g) * (u_dot + state[10] * vel_w - state[11] * vel_v) + sin(state[4])
  const ny_cg = (1.0 / g) * (v_dot + state[11] * vel_u - state[9] * vel_w) - cos(state[4]) * sin(state[3])
  const nz_cg = (-1.0 / g) * (w_dot + state[9] * vel_v - state[10] * vel_u) + cos(state[4]) * cos(state[3])

  return [nx_cg, ny_cg, nz_cg]
}

function nlplant(xu, xdot) {
  const g = 32.174 /* gravity, ft/s^2 */
  const m = 636.94 /* mass, slugs */
  const B = 30.0 /* span, ft */
  const S = 300.0 /* planform area, ft^2 */
  const cbar = 11.32 /* mean aero chord, ft */
  const xcgr = 0.35 /* reference center of gravity as a fraction of cbar */
  const xcg = 0.3 /* center of gravity as a fraction of cbar. */

  const Heng = 0.0 /* turbine momentum along roll axis. */
  const pi = 3.1416

  const Jy = 55814.0 /* slug-ft^2 */
  const Jxz = 982.0 /* slug-ft^2 */
  const Jz = 63100.0 /* slug-ft^2 */
  const Jx = 9496.0 /* slug-ft^2 */

  const RAD2DEG = 180.0 / pi /* radians to degrees */

  const npos = xu[0] /* north position */
  const epos = xu[1] /* east position */
  const alt = xu[2] /* altitude */
  const phi = xu[3] /* orientation angles in rad. */
  const theta = xu[4]
  const psi = xu[5]

  const vt = xu[6] /* total velocity */
  const alpha = xu[7] * RAD2DEG /* angle of attack in degrees */
  const beta = xu[8] * RAD2DEG /* sideslip angle in degrees */
  const P = xu[9] /* Roll Rate --- rolling  moment is Lbar */
  const Q = xu[10] /* Pitch Rate--- pitching moment is M */
  const R = xu[11] /* Yaw Rate  --- yawing   moment is N */

  const sa = Math.sin(xu[7]) /* sin(alpha) */
  const ca = Math.cos(xu[7]) /* cos(alpha) */
  const sb = Math.sin(xu[8]) /* sin(beta)  */
  const cb = Math.cos(xu[8]) /* cos(beta)  */
  const tb = Math.tan(xu[8]) /* tan(beta)  */

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

  const T = xu[12] /* thrust */
  const el = xu[13] /* Elevator setting in degrees. */
  const ail = xu[14] /* Ailerons mex setting in degrees. */
  const rud = xu[15] /* Rudder setting in degrees. */
  const lef = xu[16] /* Leading edge flap setting in degrees */

  const dail = ail / 21.5
  const drud = rud / 30.0 /* rudder normalized against max angle */
  const dlef = 1 - lef / 25.0 /* leading edge flap normalized against max angle */

  const [mach, qbar, ps] = atmos(alt, vt)

  const U = vt * ca * cb /* directional velocities. */
  const V = vt * sb
  const W = vt * sa * cb

  /* nposdot */
  xdot[0] = U * (ct * cpsi) + V * (sphi * cpsi * st - cphi * spsi) + W * (cphi * st * cpsi + sphi * spsi)

  /* eposdot */
  xdot[1] = U * (ct * spsi) + V * (sphi * spsi * st + cphi * cpsi) + W * (cphi * st * spsi - sphi * cpsi)

  /* altdot */
  xdot[2] = U * st - V * (sphi * ct) - W * (cphi * ct)

  /* phidot */
  xdot[3] = P + tt * (Q * sphi + R * cphi)

  /* theta dot */
  xdot[4] = Q * cphi - R * sphi

  /* psidot */
  xdot[5] = (Q * sphi + R * cphi) / ct

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

  const Udot = R * V - Q * W - g * st + (qbar * S * Cx_tot) / m + T / m
  const Vdot = P * W - R * U + g * ct * sphi + (qbar * S * Cy_tot) / m
  const Wdot = Q * U - P * V + g * ct * cphi + (qbar * S * Cz_tot) / m

  /* %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
      vt_dot equation (from S&L, p82)
      %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%% */

  xdot[6] = (U * Udot + V * Vdot + W * Wdot) / vt

  /* %%%%%%%%%%%%%%%%%%
      alpha_dot equation
      %%%%%%%%%%%%%%%%%% */

  xdot[7] = (U * Wdot - W * Udot) / (U * U + W * W)

  /* %%%%%%%%%%%%%%%%%
     beta_dot equation
     %%%%%%%%%%%%%%%%% */

  xdot[8] = (Vdot * vt - V * xdot[6]) / (vt * vt * cb)

  /* %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
     compute Pdot, Qdot, and Rdot (as in Stevens and Lewis p32)
     %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%% */

  const L_tot = Cl_tot * qbar * S * B /* get moments from coefficients */
  const M_tot = Cm_tot * qbar * S * cbar
  const N_tot = Cn_tot * qbar * S * B

  const denom = Jx * Jz - Jxz * Jxz

  /* %%%%%%%%%%%%%%%%%%%%%%%
     Pdot
     %%%%%%%%%%%%%%%%%%%%%%% */

  xdot[9] =
    (Jz * L_tot + Jxz * N_tot - (Jz * (Jz - Jy) + Jxz * Jxz) * Q * R + Jxz * (Jx - Jy + Jz) * P * Q + Jxz * Q * Heng) /
    denom

  /* %%%%%%%%%%%%%%%%%%%%%%%
     Qdot
     %%%%%%%%%%%%%%%%%%%%%%% */

  xdot[10] = (M_tot + (Jz - Jx) * P * R - Jxz * (P * P - R * R) - R * Heng) / Jy

  /* %%%%%%%%%%%%%%%%%%%%%%%
     Rdot
     %%%%%%%%%%%%%%%%%%%%%%% */

  xdot[11] =
    (Jx * N_tot + Jxz * L_tot + (Jx * (Jx - Jy) + Jxz * Jxz) * P * Q - Jxz * (Jx - Jy + Jz) * Q * R + Jx * Q * Heng) /
    denom

  const [x_12, x_13, x_14] = accels(xu, xdot)

  xdot[12] = x_12
  xdot[13] = x_13
  xdot[14] = x_14
  xdot[15] = mach
  xdot[16] = qbar
  xdot[17] = ps
}
