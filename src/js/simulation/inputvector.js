import SimulationConstants from "./simulationconstants.js"

/**
 * Input vector for F16 simulator.
 */

export default class InputVector {
  constructor() {
    this.throttle = 0 // 0 <= throttle <= 1.0f
    this.elevator = 0 // degrees
    this.aileron = 0 // degrees
    this.rudder = 0 // degrees
    this.vxTurbulence = 0 // ft/sec
    this.vyTurbulence = 0 // ft/sec
    this.vzTurbulence = 0 // ft/sec
  }

  limitControls() {
    this.throttle = this.limiter(this.throttle, SimulationConstants.POWER_MIN, SimulationConstants.POWER_MAX)
    this.elevator = this.limiter(this.elevator, SimulationConstants.ELEVATOR_MIN, SimulationConstants.ELEVATOR_MAX)
    this.aileron = this.limiter(this.aileron, SimulationConstants.AILERON_MIN, SimulationConstants.AILERON_MAX)
    this.rudder = this.limiter(this.rudder, SimulationConstants.RUDDER_MIN, SimulationConstants.RUDDER_MAX)
  }

  limiter(value, min, max) {
    if (value < min) return min
    if (value > max) return max
    return value
  }
}
