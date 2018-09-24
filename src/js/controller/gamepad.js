import SimulationConstants from "../simulation/simulationconstants.js"

export default class Gamepad {
  constructor() {
    this.gamepads = navigator.getGamepads()
    this.axes = []
    this.buttons = []
  }

  read(airplaneControlInput) {
    this.getInput()

    // map joystick deflection to rudder deflection
    const sensitivity = 0.1

    airplaneControlInput.aileron = -this.axes[2] * sensitivity * SimulationConstants.AILERON_MAX
    airplaneControlInput.elevator = -this.axes[3] * sensitivity * SimulationConstants.ELEVATOR_MAX

    airplaneControlInput.elevator += SimulationConstants.ELEVATOR_TRIM

    if (this.buttons[6].pressed) {
      airplaneControlInput.throttle -= 0.01
    }

    if (this.buttons[7].pressed) {
      airplaneControlInput.throttle += 0.01
    }
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
