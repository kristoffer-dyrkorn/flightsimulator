import SimulationConstants from "./simulationconstants.js"

const CONTROL_CENTERING_PER_SECOND = Math.pow(0.98, 60)

// how far one keypress moves the stick, fraction of full travel
export const STICK_STEP = 0.05

// how far one keypress moves the throttle, fraction of full travel
export const THROTTLE_STEP = 0.01

// how fast the throttle lever itself can move, fraction of full travel per
// second - independent of THROTTLE_STEP (how far one keypress asks it to go)
// so that making the step finer doesn't also slow the lever down: this is
// the same rate a single old 10%-per-press keypress used to ramp at over
// half a second, kept as its own constant now that a keypress and the
// lever's physical speed are no longer the same number.
const THROTTLE_RATE_PER_SECOND = 0.2

export default class InputVector {
  constructor() {
    this.throttle = 0.3
    this.targetThrottle = 0.3

    this.pitchStick = 0 // -1..1, positive is aft
    this.rollStick = 0 // -1..1, positive is right
    this.yawPedal = 0 // -1..1, positive is right

    this.speedbrake = 0 // degrees
    this.gear = 0 // 0 = up, 1 = down - a switch, not an axis, so no centering below
    this.brake = 0 // 0..1, wheel brake pedal - held down by the pilot, so no centering below
    this.internalView = true
  }

  /**
   * @param dt          seconds since the last call
   * @param taxiing     true while taxiing - the pedals then steer the
   *                    nosewheel, and stay where they were put rather than
   *                    centring, so a taxi turn holds until the pilot takes
   *                    it out again
   */
  normalizeControls(dt, taxiing = false) {
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
    this.brake = this.limiter(this.brake, 0, 1)

    this.speedbrake = this.limiter(
      this.speedbrake,
      SimulationConstants.SPEEDBRAKE_MIN,
      SimulationConstants.SPEEDBRAKE_MAX,
    )

    const centering = Math.pow(CONTROL_CENTERING_PER_SECOND, dt)

    this.pitchStick *= centering
    this.rollStick *= centering
    if (!taxiing) this.yawPedal *= centering
  }

  limiter(value, min, max) {
    if (value < min) return min
    if (value > max) return max
    return value
  }
}
