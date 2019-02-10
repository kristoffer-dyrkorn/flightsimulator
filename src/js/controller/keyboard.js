export default class Keyboard {
  constructor() {}

  read(airplaneControlInput, keyboardEvent) {
    switch (keyboardEvent.key) {
      case "ArrowDown": // elevator up
        airplaneControlInput.elevator -= 0.3
        keyboardEvent.stopPropagation()
        keyboardEvent.preventDefault()
        break
      case "ArrowUp": // elevator down
        airplaneControlInput.elevator += 0.3
        keyboardEvent.stopPropagation()
        keyboardEvent.preventDefault()
        break
      case "ArrowLeft": // roll left
        airplaneControlInput.aileron += 0.3
        break
      case "ArrowRight": // roll right
        airplaneControlInput.aileron -= 0.3
        break
      case "q":
        airplaneControlInput.throttle += 0.1
        break
      case "a":
        airplaneControlInput.throttle -= 0.1
        break
      case "z": // rudder left
        airplaneControlInput.rudder += 0.3
        break
      case "x": // rudder right
        airplaneControlInput.rudder -= 0.3
        break
      case " ":
        airplaneControlInput.internalView = !airplaneControlInput.internalView
        break
    }
  }
}
