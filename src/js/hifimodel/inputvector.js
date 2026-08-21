import SimulationConstants from "./simulationconstants.js"

/**
 * Fraction of a control deflection that remains one second after the user stops
 * pressing the key, ie how fast the stick springs back to trim.
 *
 * This used to be a flat 0.98 applied once per frame, which made the centering
 * speed depend on the frame rate - the controls came back five times faster at
 * 144 fps than at 30 fps, and holding a key gave a ninth of the available
 * deflection instead of half. 0.98 per frame at 60 fps works out to
 * 0.98^60 per second, which is the value below, so the feel at 60 fps is
 * unchanged and every other frame rate now matches it.
 */
const CONTROL_CENTERING_PER_SECOND = Math.pow(0.98, 60)

/**
 * Input vector for F16 simulator.
 */

export default class InputVector {
  constructor() {
    this.throttle = 0.3
    this.elevator = SimulationConstants.ELEVATOR_TRIM

    this.aileron = 0 // degrees
    this.rudder = 0 // degrees
    this.speedbrake = 0 // degrees
    this.internalView = true
  }

  /**
   * Clamps the raw key/gamepad input to what the aircraft can actually do, then
   * springs the surfaces back toward trim.
   *
   * @param dt  seconds elapsed since the last call. Governs how far the
   *            controls centre, so that the feel does not depend on frame rate.
   */
  normalizeControls(dt) {
    // clamp throttle and control surface deflections to aircraft limits
    this.throttle = this.limiter(this.throttle, SimulationConstants.POWER_MIN, SimulationConstants.POWER_MAX)
    this.elevator = this.limiter(this.elevator, SimulationConstants.ELEVATOR_MIN, SimulationConstants.ELEVATOR_MAX)
    this.aileron = this.limiter(this.aileron, SimulationConstants.AILERON_MIN, SimulationConstants.AILERON_MAX)
    this.rudder = this.limiter(this.rudder, SimulationConstants.RUDDER_MIN, SimulationConstants.RUDDER_MAX)
    this.speedbrake = this.limiter(
      this.speedbrake,
      SimulationConstants.SPEEDBRAKE_MIN,
      SimulationConstants.SPEEDBRAKE_MAX
    )

    const centering = Math.pow(CONTROL_CENTERING_PER_SECOND, dt)

    // center elevator and aileron around the trim value
    this.elevator = (this.elevator - SimulationConstants.ELEVATOR_TRIM) * centering + SimulationConstants.ELEVATOR_TRIM
    this.aileron = (this.aileron - SimulationConstants.AILERON_TRIM) * centering + SimulationConstants.AILERON_TRIM

    // auto-center rudders. in practice, this only applies to keyboard control
    this.rudder = this.rudder * centering
  }

  limiter(value, min, max) {
    if (value < min) return min
    if (value > max) return max
    return value
  }
}
