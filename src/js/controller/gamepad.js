const DEADZONE = 0.04

const PITCH_CENTRE_OFFSET = 0.1

export default class Gamepad {
  constructor() {
    this.gamepads = navigator.getGamepads()
    this.axes = []
    this.buttons = []
  }

  read(airplaneControlInput) {
    this.getInput()

    airplaneControlInput.rollStick = this.centre(this.axes[0])
    airplaneControlInput.pitchStick = this.centre(this.axes[1] - PITCH_CENTRE_OFFSET)

    airplaneControlInput.throttle = 0.5 * (-this.axes[2] + 1)
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
