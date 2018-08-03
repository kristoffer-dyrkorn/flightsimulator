import EngineModel from "./models/enginemodel.js"
import AtmosphericModel from "./models/atmosphericmodel.js"
import AerodynamicModel from "./models/aerodynamicmodel.js"
import StateVector from "./statevector.js"
import SimulationConstants from "./simulationconstants.js"

/**
 * Simplified 13-state model of F16 Flight dynamics. Originally
 * authored by <a href =
 * "http://www.cds.caltech.edu/~murray/">Prof. Richard M. Murray</a>;
 * available in the Caltech <a href =
 * "http://www.cds.caltech.edu/~vehicles/models/">Aerospace Models
 * Archive</a>. Translated from Fortran to Java by <a href =
 * "http://www.media.mit.edu/~kbrussel/">Kenneth Russell</a>.
 */
export default class F16Simulation {
  constructor() {
    this.atmosphericModel = new AtmosphericModel()
    this.engineModel = new EngineModel()
    this.aeroModel = new AerodynamicModel()
    this.simpleAero = false
  }

  /**
   * Allows disabling of angle of attack and sideslip angle in
   * aerodynamics computation to improve stability of the simulator.
   * Default is the full computation.
   */
  setSimplifiedAerodynamics(isSimplifiedOn) {
    this.simpleAero = isSimplifiedOn
  }

  /**
   * Computes state derivatives for the f-16 model.
   *
   * @param u Input vector - thtl,el,ail,rdr.+ vxTurb,vyTurb,vzTurb
   * @param x State vector - vt,alpha,beta,phi,theta,psi,p,q,r,xn(north),xe(east),h.
   *          Output: state vector time derivative.
   */

  getStateDerivative(u, x) {
    const vt1 = x.vt
    const alpha1 = x.alpha * SimulationConstants.RTOD
    const beta1 = x.beta * SimulationConstants.RTOD
    const phi = x.phi
    const the = x.theta
    const psi = x.psi
    const p = x.p
    const q = x.q
    const r = x.r
    const alt = x.h
    const pow = x.pow
    const thtl = u.throttle
    const el = u.elevator
    const ail = u.aileron
    const rdr = u.rudder
    const rm = 1.0 / SimulationConstants.c[9]
    const xcg = SimulationConstants.c[10]

    // Turbulence
    const vxturb = u.vxTurbulence
    const vyturb = u.vyTurbulence
    const vzturb = u.vzTurbulence

    // Incorporating gust into aero coefficients table look up
    const cbta = Math.cos(x.beta)
    const vx1 = vt1 * Math.cos(x.alpha) * cbta
    const vy1 = vt1 * Math.sin(x.beta)
    const vz1 = vt1 * Math.sin(x.alpha) * cbta

    const vx = vx1 + vxturb
    const vy = vy1 + vyturb
    const vz = vz1 + vzturb

    const vt = Math.sqrt(vx * vx + vy * vy + vz * vz)
    const alpha = this.simpleAero ? 0 : Math.atan(vz / vx) * SimulationConstants.RTOD
    const beta = this.simpleAero ? 0 : Math.asin(vy / vt) * SimulationConstants.RTOD

    this.atmosphericModel.update(vt, alt)
    this.engineModel.update(pow, alt, this.atmosphericModel.rmach, thtl)

    const xd = new StateVector()
    xd.pow = this.engineModel.dpow

    this.aeroModel.update(vt, alpha, beta, p, q, r, el, ail, rdr, xcg)

    const cx = this.aeroModel.cx
    const cy = this.aeroModel.cy
    const cz = this.aeroModel.cz
    const cl = this.aeroModel.cl
    const cm = this.aeroModel.cm
    const cn = this.aeroModel.cn
    const sth = Math.sin(the)
    const cth = Math.cos(the)
    const sph = Math.sin(phi)
    const cph = Math.cos(phi)
    const spsi = Math.sin(psi)
    const cpsi = Math.cos(psi)
    const qs = this.atmosphericModel.qbar * SimulationConstants.S
    const ay = rm * qs * cy
    const az = rm * qs * cz

    // Force equations.
    const vxDot = r * vy - q * vz - SimulationConstants.G * sth + rm * (qs * cx + this.engineModel.thrust)
    const vyDot = p * vz - r * vx + SimulationConstants.G * cth * sph + ay
    const vzDot = q * vx - p * vy + SimulationConstants.G * cth * cph + az
    const den = vx * vx + vz * vz

    xd.vt = (vx * vxDot + vy * vyDot + vz * vzDot) / vt
    xd.alpha = (vx * vzDot - vz * vxDot) / den
    xd.beta = (vt * vyDot - vy * xd.vt * cbta) / den

    // Kinematics.
    xd.psi = (q * sph + r * cph) / cth
    xd.phi = p + sth * xd.psi
    xd.theta = q * cph - r * sph

    // Moment equations.
    xd.p =
      (SimulationConstants.c[0] * r +
        SimulationConstants.c[1] * p +
        SimulationConstants.c[3] * SimulationConstants.HE) *
        q +
      qs * SimulationConstants.B * (SimulationConstants.c[2] * cl + SimulationConstants.c[3] * cn)
    xd.q =
      (SimulationConstants.c[4] * p - SimulationConstants.c[6] * SimulationConstants.HE) * r +
      SimulationConstants.c[5] * (r * r - p * p) +
      SimulationConstants.c[6] * qs * SimulationConstants.CBAR * cm
    xd.r =
      (SimulationConstants.c[7] * p -
        SimulationConstants.c[1] * r +
        SimulationConstants.c[8] * SimulationConstants.HE) *
        q +
      qs * SimulationConstants.B * (SimulationConstants.c[3] * cl + SimulationConstants.c[8] * cn)

    // Navigation equations.
    xd.xn = vx * cth * cpsi + vy * (sph * sth * cpsi - cph * spsi) + vz * (sph * spsi + cph * sth * cpsi)
    xd.xe = vx * cth * spsi + vy * (cph * cpsi + sph * sth * spsi) + vz * (cph * sth * spsi - sph * cpsi)
    xd.h = vx * sth - vy * sph * cth - vz * cph * cth

    return xd
  }
}
