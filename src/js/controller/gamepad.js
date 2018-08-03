export default class Gamepad {
  constructor() {
    this.isChrome68_0 = navigator.userAgent.includes("Chrome/68.0")
    this.isChrome = navigator.userAgent.includes("Chrome/")
    this.isFirefox = navigator.userAgent.includes("Firefox/")
    this.gamepads = navigator.getGamepads()
    this.axes = []
    this.buttons = []
  }

  read() {
    if (this.isChrome) {
      // Chrome needs to re-read gamepads each time
      this.gamepads = navigator.getGamepads()
    }

    if (this.isChrome68_0) {
      // Chrome 68 bugs:
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
