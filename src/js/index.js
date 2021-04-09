import Tile from "./terrain/tile.js"
import Terrain from "./terrain/terrain.js"
import * as THREE from "./graphics/three.module.js"
import { MTLLoader } from "./graphics/MTLLoader.js"
import { OBJLoader } from "./graphics/OBJLoader.js"
import StateVector from "./simulation/statevector.js"
import InputVector from "./simulation/inputvector.js"
import F16Simulation from "./simulation/f16simulation.js"
import SimulationConstants from "./simulation/simulationconstants.js"
import ObjectChaser from "./graphics/ObjectChaser.js"
import Gamepad from "./controller/gamepad.js"
import EngineAudio from "./audio/enginesound.js"

// terrain boundaries, in UTM33 coordinates
const MINX = -100000
const MAXX = 461750
const MINY = 6400000
const MAXY = 7200000

let frameTime = 0
let previousFrameTime = 0

// set start point: UTM EAST, UTM NORTH, altitude (meters) and compass direction
const url = new URL(document.location)
const urlParams = url.searchParams
let east = urlParams.get("e") || 105000
let north = urlParams.get("n") || 6958000
const alt = urlParams.get("a") || 3000
const startDirection = urlParams.get("c") || 0

// if input coordinates are GPS lat/lon, convert to utm33
if (north < 72 && east < 33) {
  const utm33NProjection = "+proj=utm +zone=33 +datum=WGS84 +units=m +no_defs"
  const utm = proj4(utm33NProjection, [Number(east), Number(north)])
  east = utm[0]
  north = utm[1]
}

const startPoint = [east, north, alt]

let updateResources = true
let showWireFrame = false

const canvas = document.getElementById("webgl")
const scene = new THREE.Scene()
// NOTE this makes all objects STATIC
// i.e. the matrix stack for ANY moving or rotating objects must manually be updated when needed
scene.autoUpdate = false
scene.background = new THREE.Color(0.78, 0.83, 0.93)
scene.fog = new THREE.FogExp2(scene.background, 0.000025)

const directionalLight = new THREE.DirectionalLight(0xcdb5ae, 0.5)
directionalLight.position.set(0, -0.2, 0.8)
directionalLight.updateMatrixWorld()
scene.add(directionalLight)

const ambientLight = new THREE.AmbientLight(0xc7d4ed, 0.05)
scene.add(ambientLight)

const cameras = []

// main camera - internal view from cockpit
const camera = new THREE.PerspectiveCamera()
camera.up.set(0, 0, 1)
camera.fov = 45
camera.near = 1
camera.far = 40000
cameras.push(camera)

// secondary (external) cameras, derived from the main
cameras.push(camera.clone())
cameras.push(camera.clone())

// initial position of the static external camera,
// relative to the aircraft
const externalCameraPosition = {
  distance: 50,
  compass: 0,
  inclination: 90,
}

let cameraIndex = 0

const f16 = new THREE.Object3D()
f16.visible = false
scene.add(f16)

const objectChaser = new ObjectChaser(f16)

const manager = new THREE.LoadingManager()
new MTLLoader(manager).setPath("f16/").load("f16.mtl", (materials) => {
  materials.preload()

  new OBJLoader(manager)
    .setMaterials(materials)
    .setPath("f16/")
    .load(
      "f16.obj",
      (object) => {
        // center the model at its center of gravity
        object.position.set(0, 2, -2.5)

        // align model with world axes
        object.rotateX(90 * THREE.MathUtils.DEG2RAD)
        object.rotateY(180 * THREE.MathUtils.DEG2RAD)
        object.updateMatrixWorld()

        f16.add(object)
      },
      (xhr) => {},
      (error) => {
        console.log("Could not load 3d model: " + error)
      }
    )
})

const renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true })
renderer.setPixelRatio(window.devicePixelRatio)
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.outputEncoding = THREE.sRGBEncoding

let gamepad = null
// const engineAudio = new EngineAudio()

window.addEventListener("resize", () => {
  resetViewport()
})
window.addEventListener("keydown", keyboardHandler)

window.addEventListener("gamepadconnected", (event) => {
  console.log("Gamepad %s connected", event.gamepad.id)
  gamepad = new Gamepad()
})
window.addEventListener("gamepaddisconnected", (event) => {
  console.log("Gamepad %s disconnected", event.gamepad.id)
  gamepad = null
})

const terrain = new Terrain(scene, MINX, MINY, MAXX, MAXY, renderer)

const f16simulation = new F16Simulation()

const airplaneState = new StateVector()
airplaneState.xe = startPoint[0] * SimulationConstants.METERS_TO_FEET
airplaneState.xn = startPoint[1] * SimulationConstants.METERS_TO_FEET
airplaneState.h = startPoint[2] * SimulationConstants.METERS_TO_FEET

airplaneState.psi = startDirection * THREE.MathUtils.DEG2RAD

airplaneState.vt = 500 // feet/sec, ~ km/t
airplaneState.pow = 60 // % thrust

const airplaneControlInput = new InputVector()
airplaneControlInput.throttle = 0.6
airplaneControlInput.elevator = SimulationConstants.ELEVATOR_TRIM

resetViewport()
drawScene()

// Log scene stats
setInterval(() => {
  //  console.log("Time offset: " + (new Date().getTime() - startTime))
  console.log("Tiles loaded: " + Tile.loadCount)
  console.log("Textures rendered: " + renderer.info.memory.textures)
  console.log("Geometries rendered: " + renderer.info.memory.geometries)
  console.log("Triangles rendered: " + renderer.info.render.triangles)
}, 3000)

// register points every N ms
setInterval(() => {
  objectChaser.addPoint(f16)
}, ObjectChaser.timeInterval)

function drawScene(currentFrametime) {
  requestAnimationFrame(drawScene)

  frameTime = currentFrametime - previousFrameTime || 0
  previousFrameTime = currentFrametime

  if (gamepad) {
    gamepad.read(airplaneControlInput)
  }

  airplaneControlInput.normalizeControls()

  const stateDerivative = f16simulation.getStateDerivative(airplaneControlInput, airplaneState)
  airplaneState.integrate(stateDerivative, frameTime * 0.001, false, 1)

  f16.quaternion.identity()
  f16.rotateZ(-airplaneState.psi)
  f16.rotateY(airplaneState.phi)
  f16.rotateX(airplaneState.theta)

  f16.position.set(
    airplaneState.xe * SimulationConstants.FEET_TO_METERS,
    airplaneState.xn * SimulationConstants.FEET_TO_METERS,
    airplaneState.h * SimulationConstants.FEET_TO_METERS
  )
  f16.updateMatrixWorld()

  // always update master camera
  cameras[0].position.copy(f16.position)
  cameras[0].quaternion.copy(f16.quaternion)
  cameras[0].rotateX(90 * THREE.MathUtils.DEG2RAD)
  cameras[0].updateMatrixWorld()

  const cameraData = objectChaser.getPoint(frameTime)

  // update other cameras - derived from the master camera
  switch (cameraIndex) {
    case 1:
      cameras[cameraIndex] = camera.clone()
      cameras[cameraIndex].position.copy(cameraData.position)
      cameras[cameraIndex].quaternion.copy(cameraData.quaternion)
      cameras[cameraIndex].rotateX(90 * THREE.MathUtils.DEG2RAD)
      cameras[cameraIndex].updateMatrixWorld()
      break
    case 2:
      cameras[cameraIndex] = camera.clone()
      cameras[cameraIndex].lookAt(f16.position)
      cameras[cameraIndex].rotateZ(externalCameraPosition.compass * THREE.MathUtils.DEG2RAD) // compass
      cameras[cameraIndex].rotateX(externalCameraPosition.inclination * THREE.MathUtils.DEG2RAD) // above / below horizon
      cameras[cameraIndex].translateZ(externalCameraPosition.distance)
      cameras[cameraIndex].updateMatrixWorld()
      break
  }

  if (updateResources) terrain.update(camera, showWireFrame)
  //  engineAudio.setOutput(airplaneState.pow)

  renderer.render(scene, cameras[cameraIndex])
}

function keyboardHandler(keyboardEvent) {
  //  engineAudio.resume()

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
    case "j": // external cam left
      externalCameraPosition.compass -= 3
      break
    case "l": // external cam right
      externalCameraPosition.compass += 3
      break
    case "i": // external cam up
      externalCameraPosition.inclination -= 2
      break
    case "k": // external cam down
      externalCameraPosition.inclination += 2
      break
    case ",": // external cam nearer
      externalCameraPosition.distance -= 10
      break
    case ".": // external cam farer
      externalCameraPosition.distance += 10
      break
    case " ":
      cameraIndex++
      cameraIndex %= cameras.length
      if (cameraIndex === 0) f16.visible = false
      if (cameraIndex === 1) f16.visible = true
      if (cameraIndex === 2) f16.visible = true
      break
    case "w":
      showWireFrame = !showWireFrame
  }
}

function resetViewport() {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
}
