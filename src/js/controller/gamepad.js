import SimulationConstants from "../simulation/simulationconstants.js"

export default class Gamepad {
  constructor() {
    this.gamepads = navigator.getGamepads()
    this.axes = []
    this.buttons = []

    // map joystick deflection to rudder deflection
    this.sensitivity = 0.15
  }

  read(airplaneControlInput) {
    this.getInput()

    airplaneControlInput.aileron = -this.axes[0] * this.sensitivity * SimulationConstants.AILERON_MAX
    airplaneControlInput.elevator = -this.axes[1] * this.sensitivity * SimulationConstants.ELEVATOR_MAX

    airplaneControlInput.elevator += SimulationConstants.ELEVATOR_TRIM

    airplaneControlInput.throttle = 0.5 * (-this.axes[2] + 1)
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
