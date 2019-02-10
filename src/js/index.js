import { gl } from "./graphics/gl.js"
import Camera from "./graphics/camera.js"
import Vector from "./graphics/vector.js"
import Terrain from "./graphics/terrain/terrain.js"
import OBJLoader from "./graphics/aircraft/objloader.js"
import OBJRenderer from "./graphics/aircraft/objrenderer.js"
import StateVector from "./simulation/statevector.js"
import InputVector from "./simulation/inputvector.js"
import F16Simulation from "./simulation/f16simulation.js"
import GraphicsConstants from "./graphics/graphicsconstants.js"
import SimulationConstants from "./simulation/simulationconstants.js"
import EngineAudio from "./audio/enginesound.js"
import Gamepad from "./controller/gamepad.js"
import Keyboard from "./controller/keyboard.js"

let previousFrameTimestamp

const canvas = document.getElementById("webgl")

const minExtents = new Vector(GraphicsConstants.MIN_EAST, GraphicsConstants.MIN_NORTH, 0)
const maxExtents = new Vector(GraphicsConstants.MAX_EAST, GraphicsConstants.MAX_NORTH, 0)

const terrainCenter = new Vector(minExtents)
terrainCenter.add(maxExtents)
terrainCenter.scale(0.5)
let terrain = new Terrain(minExtents, maxExtents, terrainCenter)

// set start point: UTM EAST, UTM NORTH, altitude (meters)
const url = new URL(document.location)
const urlParams = url.searchParams
const north = urlParams.get("n") || 6947000
const east = urlParams.get("e") || 105000
const alt = urlParams.get("a") || 3000

const planePosition = new Vector(east, north, alt)
planePosition.sub(terrainCenter)

let airplaneObject
let objLoader = new OBJLoader("data/objects/")
let objRenderer

objLoader.load("f16.obj").then(obj => {
  objRenderer = new OBJRenderer(obj)
  obj.setPosition(planePosition)
  airplaneObject = obj
})

const externalCameraOrientation = new Vector(0, 0, 0)

let gamepad
const keyboard = new Keyboard()

const engineAudio = new EngineAudio()

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
airplaneControlInput.elevator = SimulationConstants.ELEVATOR_TRIM

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
  window.addEventListener("keydown", keyboardHandler)
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
    gamepad.read(airplaneControlInput)
  }

  airplaneControlInput.normalizeControls()

  const stateDerivative = f16simulation.getStateDerivative(airplaneControlInput, airplaneState)
  airplaneState.integrate(stateDerivative, frameTime * 0.001, false, 1)

  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT)

  const position = new Vector(
    airplaneState.xe * SimulationConstants.FEET_TO_METERS,
    airplaneState.xn * SimulationConstants.FEET_TO_METERS,
    airplaneState.h * SimulationConstants.FEET_TO_METERS
  )

  const orientation = new Vector(
    airplaneState.phi * GraphicsConstants.RADIANS_TO_DEGREES,
    airplaneState.theta * GraphicsConstants.RADIANS_TO_DEGREES,
    airplaneState.psi * GraphicsConstants.RADIANS_TO_DEGREES
  )

  if (airplaneControlInput.internalView) {
    camera.setPosition(position)
    camera.setOrientationFromEulerAngles(orientation)
  } else {
    camera.setOrientationFromEulerAngles(externalCameraOrientation)

    airplaneObject.setPosition(position)
    airplaneObject.setOrientationFromEulerAngles(orientation)

    position[1] -= 30
    camera.setPosition(position)

    if (objRenderer) {
      objRenderer.render(camera)
    }
  }

  terrain.render(camera)
  engineAudio.setOutput(airplaneState.pow)
}

function keyboardHandler(keyboardEvent) {
  // play audio on user (keyboard) interaction
  engineAudio.resume()
  keyboard.read(airplaneControlInput, keyboardEvent)
}

function resizeHandler() {
  canvas.width = window.innerWidth
  canvas.height = window.innerHeight
  gl.viewport(0, 0, window.innerWidth, window.innerHeight)
  camera.setProjectionMatrix(window.innerWidth / window.innerHeight)
}
