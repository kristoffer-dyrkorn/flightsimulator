import Tile from "./terrain/tile.js"
import Terrain from "./terrain/terrain.js"
import * as THREE from "./graphics/three.module.js"
import { MTLLoader } from "./graphics/MTLLoader.js"
import { OBJLoader } from "./graphics/OBJLoader.js"
import StateVector from "./simulation/statevector.js"
import InputVector from "./simulation/inputvector.js"
import F16Simulation from "./simulation/f16simulation.js"
import ChaseObject from "./graphics/ChaseObject.js"
import Gamepad from "./controller/gamepad.js"
import EngineSound from "./audio/enginesound.js"
import HUDObject from "./graphics/HUDObject.js"

// terrain boundaries, in UTM33 coordinates
const MINX = -100000
const MAXX = 1137000
const MINY = 6400000
const MAXY = 7970000

let showWireFrame = false
let previousFrameTime = 0

let currentCamera = 0

let gamepad = null
let engineSound = null

const canvas = document.getElementById("webgl")
const renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true })
renderer.setPixelRatio(window.devicePixelRatio)
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.outputEncoding = THREE.sRGBEncoding

const hudCanvas = document.getElementById("hud")
const hud = new HUDObject(hudCanvas)

const scene = new THREE.Scene()
// NOTE this makes all objects STATIC
// i.e. the matrix stack for ANY moving or rotating objects must manually be updated when needed
scene.autoUpdate = false
scene.background = new THREE.Color(0.78, 0.83, 0.93)
scene.fog = new THREE.FogExp2(scene.background, 0.000025)

// add lights to the scene, to propely display the f16 model
const directionalLight = new THREE.DirectionalLight(0xcdb5ae, 0.5)
directionalLight.position.set(0, -0.2, 0.8)
directionalLight.updateMatrixWorld()
scene.add(directionalLight)

const ambientLight = new THREE.AmbientLight(0xc7d4ed, 0.05)
scene.add(ambientLight)

// initialize cameras
const cameras = []

// main camera - internal view from cockpit
const camera = new THREE.PerspectiveCamera()
camera.up.set(0, 0, 1)
camera.fov = 45
camera.near = 1
camera.far = 60000
cameras.push(camera)

scene.add(camera)

// set up two secondary (external) cameras, derived from the main
cameras.push(camera.clone())
cameras.push(camera.clone())

// initial position of "wingman view" camera
const externalCameraPosition = {
  distance: 50,
  compass: 0,
  compassSpeed: 0,
  inclination: 90,
}

// set up container object for the 3D aircraft model
const f16 = new THREE.Object3D()
f16.visible = false
scene.add(f16)

const hudGeometry = new THREE.PlaneGeometry(1, 1)
const hudMaterial = new THREE.MeshBasicMaterial({ color: 0xffff00 })
const hudTexture = new THREE.CanvasTexture(hudCanvas)
hudMaterial.map = hudTexture
hudMaterial.transparent = true

const hudPlane = new THREE.Mesh(hudGeometry, hudMaterial)
hudPlane.position.set(0, 0, -2)
hudPlane.updateMatrixWorld()
camera.add(hudPlane)

// load the actual aircraft model into the scene
loadAircraftModel(f16)

// register positions and orientations of aircraft object,
// to be sent to the "chase camera"
const chaseObject = new ChaseObject(f16)

// read out start position and direction
const url = new URL(document.location)
const urlParams = url.searchParams
const startPoint = getStartpointFromParameters(urlParams)
const startDirection = urlParams.get("c") || 0

const terrain = new Terrain(scene, MINX, MINY, MAXX, MAXY, renderer)
terrain.initialize(camera, startPoint, startDirection)

// set up physics simulation
const f16simulation = new F16Simulation()
const airplaneState = new StateVector()
airplaneState.init(startPoint, startDirection)
const airplaneControlInput = new InputVector()

// set up various event handlers
const startButton = document.getElementById("start")
startButton.addEventListener("click", start)

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

// log scene stats
setInterval(() => {
  //  console.log("Time offset: " + (new Date().getTime() - startTime))
  console.log("Tiles loaded: " + Tile.loadCount)
  console.log("Textures rendered: " + renderer.info.memory.textures)
  console.log("Geometries rendered: " + renderer.info.memory.geometries)
  console.log("Triangles rendered: " + renderer.info.render.triangles)
}, 3000)

// register flight trail points every N ms
setInterval(() => {
  chaseObject.addPoint(f16)
}, ChaseObject.timeInterval)

// the actual program startup
async function start() {
  const audioContext = new window.AudioContext()
  await audioContext.audioWorklet.addModule("js/audio/brown-noise-processor.js")
  engineSound = new EngineSound()

  audioContext.resume()
  engineSound.start(audioContext)

  // remove start button
  document.getElementById("buttoncontainer").style.display = "none"
  canvas.style.display = "block"
  //hudCanvas.style.display = "block"

  resetViewport()
  drawScene()
}

function drawScene(currentFrametime) {
  requestAnimationFrame(drawScene)

  let frameTime = currentFrametime - previousFrameTime || 0
  previousFrameTime = currentFrametime

  if (gamepad) {
    gamepad.read(airplaneControlInput)
  }

  airplaneControlInput.normalizeControls()

  const stateDerivative = f16simulation.getStateDerivative(airplaneControlInput, airplaneState)
  airplaneState.integrate(stateDerivative, frameTime * 0.001, false, 1)
  airplaneState.updateAircraftModel(f16)

  hud.update(airplaneState)
  hud.draw()
  hudTexture.needsUpdate = true

  // always update master camera
  cameras[0].position.copy(f16.position)
  cameras[0].quaternion.copy(f16.quaternion)
  cameras[0].rotateX(90 * THREE.MathUtils.DEG2RAD)
  cameras[0].updateMatrixWorld()

  const cameraData = chaseObject.getPoint(frameTime)

  // update current camera - derived from the master camera
  switch (currentCamera) {
    case 1:
      cameras[currentCamera] = camera.clone()
      cameras[currentCamera].position.copy(cameraData.position)
      cameras[currentCamera].quaternion.copy(cameraData.quaternion)
      cameras[currentCamera].rotateX(90 * THREE.MathUtils.DEG2RAD)
      cameras[currentCamera].updateMatrixWorld()
      break
    case 2:
      cameras[currentCamera] = camera.clone()
      cameras[currentCamera].lookAt(f16.position)
      cameras[currentCamera].rotateZ(externalCameraPosition.compass * THREE.MathUtils.DEG2RAD) // compass
      cameras[currentCamera].rotateX(externalCameraPosition.inclination * THREE.MathUtils.DEG2RAD) // above / below horizon
      cameras[currentCamera].translateZ(externalCameraPosition.distance)
      cameras[currentCamera].updateMatrixWorld()

      externalCameraPosition.compass += externalCameraPosition.compassSpeed
      break
  }

  terrain.update(camera, showWireFrame)
  engineSound.setOutput(airplaneState.pow)

  renderer.render(scene, cameras[currentCamera])
}

function getStartpointFromParameters(urlParams) {
  // set start point: UTM EAST, UTM NORTH, altitude (meters) and compass direction
  let east = urlParams.get("e") || 105000
  let north = urlParams.get("n") || 6958000
  const alt = urlParams.get("a") || 1524 // 5000 ft

  // if input coordinates are GPS lat/lon, convert to utm33
  if (north < 72 && east < 33) {
    const utm33NProjection = "+proj=utm +zone=33 +datum=WGS84 +units=m +no_defs"
    const utm = proj4(utm33NProjection, [Number(east), Number(north)])
    east = utm[0]
    north = utm[1]
  }
  return [east, north, alt]
}

function loadAircraftModel(f16) {
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
}

function nextCamera() {
  currentCamera++
  currentCamera %= cameras.length
  if (currentCamera === 0) {
    f16.visible = false
    hudPlane.visible = true
  }
  if (currentCamera === 1) {
    f16.visible = true
    hudPlane.visible = false
  }
  if (currentCamera === 2) {
    f16.visible = true
    hudPlane.visible = false
  }
}

function keyboardHandler(keyboardEvent) {
  switch (keyboardEvent.key) {
    case "ArrowDown": // elevator surface up
      airplaneControlInput.elevator -= 0.3
      keyboardEvent.stopPropagation()
      keyboardEvent.preventDefault()
      break
    case "ArrowUp": // elevator surface down
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
      externalCameraPosition.compassSpeed -= 0.15
      break
    case "l": // external cam right
      externalCameraPosition.compassSpeed += 0.15
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
      nextCamera()
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
