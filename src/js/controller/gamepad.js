import SimulationConstants from "../simulation/simulationconstants.js"

export default class Gamepad {
  constructor() {
    this.isBuggyChrome = navigator.userAgent.includes("Chrome/68.0") || navigator.userAgent.includes("Chrome/69.0")
    this.isChrome = navigator.userAgent.includes("Chrome/")
    this.isFirefox = navigator.userAgent.includes("Firefox/")
    this.gamepads = navigator.getGamepads()
    this.axes = []
    this.buttons = []
  }

  read(airplaneControlInput) {
    this.getInput()

    // map joystick deflection to rudder deflection
    const sensitivity = 0.1

    airplaneControlInput.aileron = -this.axes[2] * sensitivity * SimulationConstants.AILERON_MAX
    airplaneControlInput.elevator = this.axes[3] * sensitivity * SimulationConstants.ELEVATOR_MAX

    airplaneControlInput.elevator += SimulationConstants.ELEVATOR_TRIM

    if (this.buttons[6].pressed) {
      airplaneControlInput.throttle -= 0.01
    }

    if (this.buttons[7].pressed) {
      airplaneControlInput.throttle += 0.01
    }
  }

  getInput() {
    if (this.isChrome) {
      // Chrome needs to re-read gamepads each time
      this.gamepads = navigator.getGamepads()
    }

    if (this.isBuggyChrome) {
      // Chrome 68 and 69 bugs:
      // Axes must be read from Gamepad 0, indices 0, 1, 2, and 5 (!)
      // Buttons must be read from Gamepad 1
      this.axes = []
      this.axes.push(this.gamepads[0].axes[0])
      this.axes.push(this.gamepads[0].axes[1])
      this.axes.push(this.gamepads[0].axes[2])
      this.axes.push(this.gamepads[0].axes[5])
      this.buttons = this.gamepads[1].buttons
    } else if (this.isChrome) {
      // Chrome "bug" (< 68.0):
      // Gamepad 0 is a dummy device
      // Gamepad 1 is the actual device - read axes and buttons from there
      this.axes = this.gamepads[1].axes
      this.buttons = this.gamepads[1].buttons
    } else if (this.isFirefox) {
      this.axes = this.gamepads[0].axes
      // Firefox thinks the Gamepad has an extra button, remove it
      this.buttons = this.gamepads[0].buttons.slice(1)
    }
  }
}
