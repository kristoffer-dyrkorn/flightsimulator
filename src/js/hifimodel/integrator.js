import StateVector from "./statevector.js"

/**
 * Classical fourth order Runge-Kutta integrator for the flight model.
 *
 * Forward Euler assumes the derivative it measured at the start of a step holds
 * for the whole of it. Nothing about an aircraft works that way: in a roll or a
 * hard pull the derivative is turning under you the entire time, so the error
 * per step goes as the step itself. Runge-Kutta samples the derivative four
 * times across the step - once at the start, twice at the middle, once at the
 * end - and the errors in those samples cancel to third order, leaving an error
 * per step that goes as the fourth power of the step. In practice that buys
 * either a far more accurate answer at the same step, or the same answer at a
 * much longer one.
 *
 * It also has a much larger stable region, which matters here because forward
 * Euler was the reason the step had to be as short as it was.
 *
 * The controls are deliberately not re-evaluated at the four stages. A real
 * flight control computer samples its sensors, works out a command and then
 * holds that command until its next cycle, so holding the surface positions
 * fixed across a step is not an approximation - it is what the hardware does.
 * It also keeps the cost down: a step is four aerodynamic evaluations, not four
 * of everything.
 */
export default class RungeKutta4 {
  constructor() {
    /* The four derivative evaluations, plus one scratch state to evaluate the
       middle and end ones at. These are allocated once and reused for the life
       of the simulation - a step used to allocate a state vector, which is a
       poor thing to be doing a few hundred times a second underneath a
       renderer trying to hold a frame rate. */
    this.k1 = new StateVector()
    this.k2 = new StateVector()
    this.k3 = new StateVector()
    this.k4 = new StateVector()
    this.stage = new StateVector()
  }

  /**
   * Advances the state by one step.
   *
   * @param simulation  the flight model, to get derivatives from
   * @param u           control positions, held fixed across the step
   * @param x           state to advance, modified in place
   * @param dt          length of the step, seconds
   */
  step(simulation, u, x, dt) {
    const half = 0.5 * dt

    simulation.getStateDerivative(u, x, this.k1)

    x.advanceInto(this.stage, this.k1, half)
    simulation.getStateDerivative(u, this.stage, this.k2)

    x.advanceInto(this.stage, this.k2, half)
    simulation.getStateDerivative(u, this.stage, this.k3)

    x.advanceInto(this.stage, this.k3, dt)
    simulation.getStateDerivative(u, this.stage, this.k4)

    x.integrateRungeKutta(this.k1, this.k2, this.k3, this.k4, dt)
  }
}
