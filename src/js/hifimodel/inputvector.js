import SimulationConstants from "./simulationconstants.js"

const CONTROL_CENTERING_PER_SECOND = Math.pow(0.98, 60)

// how far one keypress moves the stick, fraction of full travel
export const STICK_STEP = 0.05

export default class InputVector {
  constructor() {
    this.throttle = 0.3

    this.pitchStick = 0 // -1..1, positive is aft
    this.rollStick = 0 // -1..1, positive is right
    this.yawPedal = 0 // -1..1, positive is right

    this.speedbrake = 0 // degrees
    this.internalView = true
  }

  normalizeControls(dt) {
    this.throttle = this.limiter(this.throttle, SimulationConstants.POWER_MIN, SimulationConstants.POWER_MAX)

    this.pitchStick = this.limiter(this.pitchStick, -1, 1)
    this.rollStick = this.limiter(this.rollStick, -1, 1)
    this.yawPedal = this.limiter(this.yawPedal, -1, 1)

    this.speedbrake = this.limiter(
      this.speedbrake,
      SimulationConstants.SPEEDBRAKE_MIN,
      SimulationConstants.SPEEDBRAKE_MAX,
    )

    const centering = Math.pow(CONTROL_CENTERING_PER_SECOND, dt)

    this.pitchStick *= centering
    this.rollStick *= centering
    this.yawPedal *= centering
  }

  limiter(value, min, max) {
    if (value < min) return min
    if (value > max) return max
    return value
  }
}
