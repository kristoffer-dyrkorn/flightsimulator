import SimulationConstants from "./simulationconstants.js"

/**
 * Input vector for F16 simulator.
 */

export default class InputVector {
  constructor() {
    this.throttle = 0.6
    this.elevator = SimulationConstants.ELEVATOR_TRIM

    this.aileron = 0 // degrees
    this.rudder = 0 // degrees
    this.internalView = true
  }

  normalizeControls() {
    // clamp throttle and control surface deflections to aircraft limits
    this.throttle = this.limiter(this.throttle, SimulationConstants.POWER_MIN, SimulationConstants.POWER_MAX)
    this.elevator = this.limiter(this.elevator, SimulationConstants.ELEVATOR_MIN, SimulationConstants.ELEVATOR_MAX)
    this.aileron = this.limiter(this.aileron, SimulationConstants.AILERON_MIN, SimulationConstants.AILERON_MAX)
    this.rudder = this.limiter(this.rudder, SimulationConstants.RUDDER_MIN, SimulationConstants.RUDDER_MAX)

    // center elevator around the trim value
    this.elevator = (this.elevator - SimulationConstants.ELEVATOR_TRIM) * 0.98 + SimulationConstants.ELEVATOR_TRIM

    // auto-center rudders. in practice, this only applies to keyboard control
    // since control inputs from gamepads are re-read every frame
    this.aileron = this.aileron * 0.98
    this.rudder = this.rudder * 0.98
  }

  limiter(value, min, max) {
    if (value < min) return min
    if (value > max) return max
    return value
  }
}
