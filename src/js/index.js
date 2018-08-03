import { gl } from "./graphics/gl.js"
import Camera from "./graphics/camera.js"
import Vector from "./graphics/vector.js"
import Terrain from "./graphics/terrain/terrain.js"
import StateVector from "./simulation/statevector.js"
import InputVector from "./simulation/inputvector.js"
import F16Simulation from "./simulation/f16simulation.js"
import GraphicsConstants from "./graphics/graphicsconstants.js"
import SimulationConstants from "./simulation/simulationconstants.js"
import EngineAudio from "./audio/enginesound.js"
import Gamepad from "./controller/gamepad.js"

let previousFrameTimestamp

const canvas = document.getElementById("webgl")

const minExtents = new Vector(GraphicsConstants.MIN_EAST, GraphicsConstants.MIN_NORTH, 0)
const maxExtents = new Vector(GraphicsConstants.MAX_EAST, GraphicsConstants.MAX_NORTH, 0)

const terrainCenter = new Vector(minExtents)
terrainCenter.add(maxExtents)
terrainCenter.scale(0.5)
let terrain = new Terrain(minExtents, maxExtents, terrainCenter)

// set start point: UTM EAST, UTM NORTH, altitude (meters)
const planePosition = new Vector(120300, 6959500, 1700)
planePosition.sub(terrainCenter)

let gamepad

const enginesound = new EngineAudio()

const camera = new Camera(45 * GraphicsConstants.DEGREES_TO_RADIANS)
camera.setPosition(planePosition)

const f16simulation = new F16Simulation()

const airplaneState = new StateVector()
airplaneState.xe = planePosition[0] * SimulationConstants.METERS_TO_FEET
airplaneState.xn = planePosition[1] * SimulationConstants.METERS_TO_FEET
airplaneState.h = planePosition[2] * SimulationConstants.METERS_TO_FEET

airplaneState.vt = 500 // feet/sec, ~ km/t
airplaneState.pow = 60 // % thrust

const airplaneControlInput = new InputVector()
airplaneControlInput.throttle = 0.6
airplaneControlInput.elevator = -2

if (!gl) {
  console.error("Unable to get WebGL context.")
} else {
  const uintExtension = gl.getExtension("OES_element_index_uint")
  if (!uintExtension) {
    console.warn("OES_element_index_uint not supported.")
  }

  const anisotropyExtension = gl.getExtension("EXT_texture_filter_anisotropic")
  if (!anisotropyExtension) {
    console.warn("EXT_texture_filter_anisotropic not supported.")
  }

  gl.clearColor(0.59, 0.75, 0.91, 1.0)
  gl.enable(gl.DEPTH_TEST)
  gl.depthFunc(gl.LEQUAL)
  gl.viewport(0, 0, window.innerWidth, window.innerHeight)

  window.addEventListener("resize", resizeHandler)
  window.addEventListener("keydown", keyHandler)
  window.addEventListener("gamepadconnected", event => {
    console.log("Gamepad %s connected", event.gamepad.id)
    gamepad = new Gamepad()
  })
  window.addEventListener("gamepaddisconnected", event => {
    console.log("Gamepad %s disconnected", event.gamepad.id)
    gamepad = null
  })

  resizeHandler()
  drawScene()
}

function drawScene(currentFrameTimestamp) {
  requestAnimationFrame(drawScene)

  let frameTime = currentFrameTimestamp - previousFrameTimestamp || 0
  previousFrameTimestamp = currentFrameTimestamp

  if (gamepad) {
    updateInputFromGamepad(airplaneControlInput, gamepad)
  }

  let stateDerivative = f16simulation.getStateDerivative(airplaneControlInput, airplaneState)
  airplaneState.integrate(stateDerivative, frameTime * 0.001, false, 1)

  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)

  let position = new Vector(
    airplaneState.xe * SimulationConstants.FEET_TO_METERS,
    airplaneState.xn * SimulationConstants.FEET_TO_METERS,
    airplaneState.h * SimulationConstants.FEET_TO_METERS
  )

  const orientation = new Vector(
    airplaneState.phi * GraphicsConstants.RADIANS_TO_DEGREES,
    airplaneState.theta * GraphicsConstants.RADIANS_TO_DEGREES,
    airplaneState.psi * GraphicsConstants.RADIANS_TO_DEGREES
  )

  camera.setPosition(position)
  camera.setOrientationFromEulerAngles(orientation)

  terrain.render(camera)

  enginesound.setOutput(airplaneState.pow)
}

function keyHandler(e) {
  switch (e.key) {
    case "l": // l for log
      console.log(airplaneState.toString())
      break
    case "ArrowDown": // elevator up
      airplaneControlInput.elevator -= 0.1
      if (airplaneControlInput.elevator < SimulationConstants.ELEVATOR_MIN) {
        airplaneControlInput.elevator = SimulationConstants.ELEVATOR_MIN
      }
      e.stopPropagation()
      e.preventDefault()
      break
    case "ArrowUp": // elevator down
      airplaneControlInput.elevator += 0.1
      if (airplaneControlInput.elevator > SimulationConstants.ELEVATOR_MAX) {
        airplaneControlInput.elevator = SimulationConstants.ELEVATOR_MAX
      }
      e.stopPropagation()
      e.preventDefault()
      break
    case "ArrowLeft": // roll left
      airplaneControlInput.aileron += 0.1
      if (airplaneControlInput.aileron > SimulationConstants.AILERON_MAX) {
        airplaneControlInput.aileron = SimulationConstants.AILERON_MAX
      }
      break
    case "ArrowRight": // roll left
      airplaneControlInput.aileron -= 0.1
      if (airplaneControlInput.aileron < SimulationConstants.AILERON_MIN) {
        airplaneControlInput.aileron = SimulationConstants.AILERON_MIN
      }
      break
    case "q":
      airplaneControlInput.throttle += 0.1
      if (airplaneControlInput.throttle > SimulationConstants.POWER_MAX) {
        airplaneControlInput.throttle = SimulationConstants.POWER_MAX
      }
      break
    case "a":
      airplaneControlInput.throttle -= 0.1
      if (airplaneControlInput.throttle < SimulationConstants.POWER_MIN) {
        airplaneControlInput.throttle = SimulationConstants.POWER_MIN
      }
      break
    case "z": // rudder left
      airplaneControlInput.rudder += 0.1
      if (airplaneControlInput.rudder > SimulationConstants.RUDDER_MAX) {
        airplaneControlInput.rudder = SimulationConstants.RUDDER_MAX
      }
      break
    case "x": // rudder right
      airplaneControlInput.rudder -= 0.1
      if (airplaneControlInput.rudder < SimulationConstants.RUDDER_MIN) {
        airplaneControlInput.rudder = SimulationConstants.RUDDER_MIN
      }
      break
    case "v":
      terrain.calculateVisiblity = !terrain.calculateVisiblity
      break
  }
}

function resizeHandler() {
  canvas.width = window.innerWidth
  canvas.height = window.innerHeight
  gl.viewport(0, 0, window.innerWidth, window.innerHeight)
  camera.setProjectionMatrix(window.innerWidth / window.innerHeight)
}

function updateInputFromGamepad(airplaneControlInput, gamepad) {
  gamepad.read()

  airplaneControlInput.aileron = (-gamepad.axes[2] / 10) * SimulationConstants.AILERON_MAX
  airplaneControlInput.elevator = (gamepad.axes[3] / 10) * SimulationConstants.ELEVATOR_MAX - 2

  if (gamepad.buttons[6].pressed) {
    airplaneControlInput.throttle -= 0.01
    if (airplaneControlInput.throttle < SimulationConstants.POWER_MIN) {
      airplaneControlInput.throttle = SimulationConstants.POWER_MIN
    }
  }

  if (gamepad.buttons[7].pressed) {
    airplaneControlInput.throttle += 0.01
    if (airplaneControlInput.throttle > SimulationConstants.POWER_MAX) {
      airplaneControlInput.throttle = SimulationConstants.POWER_MAX
    }
  }
}
