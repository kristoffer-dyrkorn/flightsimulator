import SimulationConstants from "./simulationconstants.js"

const CONTROL_CENTERING_PER_SECOND = Math.pow(0.98, 60)

// how far one keypress moves the stick, fraction of full travel
export const STICK_STEP = 0.05

// how far one keypress moves the throttle, fraction of full travel
export const THROTTLE_STEP = 0.1

// time to ramp the throttle to a newly commanded setting, seconds - a keypress
// does not snap the lever, it moves it there smoothly, like a real hand would
const THROTTLE_RAMP_TIME = 0.5
const THROTTLE_RATE_PER_SECOND = THROTTLE_STEP / THROTTLE_RAMP_TIME

export default class InputVector {
  constructor() {
    this.throttle = 0.3
    this.targetThrottle = 0.3

    this.pitchStick = 0 // -1..1, positive is aft
    this.rollStick = 0 // -1..1, positive is right
    this.yawPedal = 0 // -1..1, positive is right

    this.speedbrake = 0 // degrees
    this.internalView = true
  }

  normalizeControls(dt) {
    this.targetThrottle = this.limiter(
      this.targetThrottle,
      SimulationConstants.THROTTLE_MIN,
      SimulationConstants.THROTTLE_MAX,
    )

    const throttleDelta = this.targetThrottle - this.throttle
    const maxStep = THROTTLE_RATE_PER_SECOND * dt

    if (Math.abs(throttleDelta) <= maxStep) {
      this.throttle = this.targetThrottle
    } else {
      this.throttle += Math.sign(throttleDelta) * maxStep
    }

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
