const DEADZONE = 0.04

// Sticks don't all rest at exactly 0 - the NXT Gladiator's pitch axis rests
// at about 0.1, aft, while the VKBsim Gladiator EVO's rests at 0 - and a
// stick read as a little off centre at rest flies a little off 1 g for ever:
// the aircraft slowly noses over, or up. So each stick axis's centre is
// measured, as where it rests once it has been still for CENTRE_SETTLE_TIME
// after the stick is first seen - the browser may only report the stick once
// it has been moved, so its first reading may well not be at rest. A resting
// value further out than MAX_CENTRE_OFFSET is someone holding the stick, not
// its centre, and is not taken. Until it is measured, the centre is 0.
const CENTRE_SETTLE_TIME = 500 // ms
const CENTRE_STILL = 0.005 // how little the axis may move and still be at rest
const MAX_CENTRE_OFFSET = 0.15

// the stick axes whose centre is measured: roll and pitch
const STICK_AXES = [0, 1]

export default class Gamepad {
  constructor() {
    this.gamepads = navigator.getGamepads()
    this.axes = []
    this.buttons = []

    // per stick axis: its measured centre (null until it is), and the value
    // and time it has been resting at since it was last moved
    this.centres = STICK_AXES.map(() => ({ centre: null, value: null, since: 0 }))
  }

  read(airplaneControlInput) {
    this.getInput()
    if (this.axes.length < 3) return

    this.measureCentres()

    airplaneControlInput.rollStick = this.centre(this.axes[0] - (this.centres[0].centre ?? 0))
    airplaneControlInput.pitchStick = this.centre(this.axes[1] - (this.centres[1].centre ?? 0))

    // the lever position, applied directly - the ramp in normalizeControls() is
    // for keyboard taps only, an analog axis already reports where the lever is
    const throttle = 0.5 * (-this.axes[2] + 1)
    airplaneControlInput.throttle = throttle
    airplaneControlInput.targetThrottle = throttle
  }

  // see CENTRE_SETTLE_TIME
  measureCentres() {
    const now = performance.now()

    STICK_AXES.forEach((axis, i) => {
      const state = this.centres[i]
      if (state.centre !== null) return

      const value = this.axes[axis]
      if (state.value === null || Math.abs(value - state.value) > CENTRE_STILL) {
        state.value = value
        state.since = now
      } else if (now - state.since >= CENTRE_SETTLE_TIME && Math.abs(value) <= MAX_CENTRE_OFFSET) {
        state.centre = value
        console.log("Joystick axis %d centred at %s", axis, value.toFixed(3))
      }
    })
  }

  centre(value) {
    if (value > DEADZONE) return (value - DEADZONE) / (1 - DEADZONE)
    if (value < -DEADZONE) return (value + DEADZONE) / (1 - DEADZONE)
    return 0
  }

  getInput() {
    // per now, only Chrome is supported.
    // on that browser, we need to re-read gamepads each time
    this.gamepads = navigator.getGamepads()

    // try to read the most normal gamepad data locations
    if (this.gamepads[0]) {
      this.axes = this.gamepads[0].axes
      this.buttons = this.gamepads[0].buttons
    }

    if (this.gamepads[1]) {
      this.axes = this.gamepads[1].axes
      this.buttons = this.gamepads[1].buttons
    }
  }
}
