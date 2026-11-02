import StateVector from "../hifimodel/statevector.js"

/*
 * The last DURATION seconds of a flight, for replaying - each frame as it
 * was drawn: the aircraft's state, and everything else the view shows that
 * the state alone doesn't give - the control surfaces, the gear and how far
 * its struts were pushed in, the HUD's readings, and the height above the
 * ground the shadow is cast on. Times are seconds of flight, so time spent
 * paused doesn't count.
 *
 * The frames are kept in a ring that grows to hold DURATION seconds at
 * whatever frame rate the display runs at, and is then reused, so recording
 * allocates nothing once it is full.
 */

const DURATION = 120 // s

class Frame {
  constructor() {
    this.time = 0
    this.state = new StateVector()
    this.actuators = {
      elevator: 0,
      aileron: 0,
      rudder: 0,
      lef: 0,
      tef: 0,
      speedbrake: 0,
      stabilatorDiff: 0,
      gear: 0,
      noseSteer: 0,
    }
    this.strutTravel = { nose: 0, mainL: 0, mainR: 0 } // m
    this.throttle = 0
    this.gearDown = false
    this.landingMode = false
    this.weightOnWheels = false
    this.fraction = 0 // of a full load of fuel - as FuelModel's, for the HUD
    this.ps = 0 // static pressure, for the HUD's calibrated airspeed
    this.rmach = 0
    this.heightAboveGround = 0 // m
  }

  copyFrom(other) {
    this.time = other.time
    this.state.copyFrom(other.state)
    Object.assign(this.actuators, other.actuators)
    Object.assign(this.strutTravel, other.strutTravel)
    this.throttle = other.throttle
    this.gearDown = other.gearDown
    this.landingMode = other.landingMode
    this.weightOnWheels = other.weightOnWheels
    this.fraction = other.fraction
    this.ps = other.ps
    this.rmach = other.rmach
    this.heightAboveGround = other.heightAboveGround
  }

  // this, the way along from one frame to the next - the switches as they
  // were in the nearer of the two
  interpolate(from, to, along) {
    const mix = (a, b) => a + (b - a) * along
    this.time = mix(from.time, to.time)
    this.state.interpolate(from.state, to.state, along)
    for (const key in this.actuators) this.actuators[key] = mix(from.actuators[key], to.actuators[key])
    for (const key in this.strutTravel) this.strutTravel[key] = mix(from.strutTravel[key], to.strutTravel[key])
    this.throttle = mix(from.throttle, to.throttle)
    const nearer = along < 0.5 ? from : to
    this.gearDown = nearer.gearDown
    this.landingMode = nearer.landingMode
    this.weightOnWheels = nearer.weightOnWheels
    this.fraction = mix(from.fraction, to.fraction)
    this.ps = mix(from.ps, to.ps)
    this.rmach = mix(from.rmach, to.rmach)
    this.heightAboveGround = mix(from.heightAboveGround, to.heightAboveGround)
  }
}

export default class FlightRecorder {
  constructor(duration = DURATION) {
    this.duration = duration
    this.frames = []
    this.first = 0
    this.count = 0
    // what record takes, and sample gives - filled in by the caller, and
    // by sample
    this.live = new Frame()
    this.sampled = new Frame()
  }

  frame(i) {
    return this.frames[(this.first + i) % this.frames.length]
  }

  get empty() {
    return this.count === 0
  }

  get oldestTime() {
    return this.frame(0).time
  }

  get newestTime() {
    return this.frame(this.count - 1).time
  }

  /**
   * Keeps the frame filled in in this.live, at its time, and lets go of
   * those older than the duration.
   */
  record() {
    const time = this.live.time
    while (this.count > 0 && this.frame(0).time < time - this.duration) {
      this.first = (this.first + 1) % this.frames.length
      this.count--
    }
    if (this.count === this.frames.length) {
      // full - grow, in order from the oldest
      const frames = Array.from({ length: this.count }, (_, i) => this.frame(i))
      const grown = Math.max(64, 2 * this.count)
      while (frames.length < grown) frames.push(new Frame())
      this.frames = frames
      this.first = 0
    }
    this.frame(this.count).copyFrom(this.live)
    this.count++
  }

  /**
   * The flight as it was at the time given, between the frames either side
   * of it - in this.sampled.
   */
  sample(time) {
    if (time <= this.oldestTime) {
      this.sampled.copyFrom(this.frame(0))
      return this.sampled
    }
    if (time >= this.newestTime) {
      this.sampled.copyFrom(this.frame(this.count - 1))
      return this.sampled
    }
    // the last frame at or before the time
    let low = 0
    let high = this.count - 1
    while (high - low > 1) {
      const middle = (low + high) >> 1
      if (this.frame(middle).time <= time) low = middle
      else high = middle
    }
    const from = this.frame(low)
    const to = this.frame(high)
    this.sampled.interpolate(from, to, (time - from.time) / Math.max(to.time - from.time, 1e-6))
    return this.sampled
  }

  // forgets everything recorded - for a fresh start
  clear() {
    this.first = 0
    this.count = 0
  }
}
