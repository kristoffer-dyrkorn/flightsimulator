import Tile from "./terrain/tile.js"
import Terrain from "./terrain/terrain.js"
import {
  WebGLRenderer,
  Scene,
  Color,
  FogExp2,
  DirectionalLight,
  AmbientLight,
  PerspectiveCamera,
  Object3D,
  PlaneGeometry,
  MeshBasicMaterial,
  CanvasTexture,
  Mesh,
  MathUtils,
  LoadingManager,
  Ray,
  Vector3,
} from "three"
import { MTLLoader } from "three/addons/loaders/MTLLoader.js"
import { OBJLoader } from "three/addons/loaders/OBJLoader.js"
import StateVector from "./hifimodel/statevector.js"
import InputVector, { STICK_STEP, THROTTLE_STEP } from "./hifimodel/inputvector.js"
import F16Simulation from "./hifimodel/f16simulation.js"
import FlightControlSystem from "./hifimodel/models/flightcontrolsystem.js"
import RungeKutta4 from "./hifimodel/integrator.js"
import ActuatorModel from "./hifimodel/models/actuatormodel.js"
import SimulationConstants from "./hifimodel/simulationconstants.js"
import ChaseObject from "./graphics/ChaseObject.js"
import Gamepad from "./controller/gamepad.js"
import EngineSound from "./audio/enginesound.js"
import HUDObject from "./graphics/HUDObject.js"
import proj4 from "proj4"

// terrain boundaries, in UTM33 coordinates
const MINX = -100000
const MAXX = 1137000
const MINY = 6400000
const MAXY = 7970000

const UTM33N_PROJECTION = "+proj=utm +zone=33 +datum=WGS84 +units=m +no_defs"

// all terrain is projected in UTM zone 33, so the central meridian is always
// 15E no matter where the aircraft happens to be
const UTM33N_CENTRAL_MERIDIAN = 15

const TILE_EXTENTS = 50 * 255

let showWireFrame = false
let previousFrameTime = 0

const PHYSICS_STEP = 1 / 60 // seconds
const MAX_PHYSICS_STEPS = 15

// Heights to read the forecast at, m above sea level - the surface and then
// roughly 5000, 10000 and 20000 ft. One request each, which is enough to see the
// shape of the wind with height without leaning on a free service.
const WIND_PROFILE_ALTITUDES = [0, 1500, 3000, 6000]

// At the surface the forecast is the wind 10 m up. The turbulence model wants
// the wind at 20 ft, and the two differ by the shape of the boundary layer: the
// logarithmic profile, over terrain of middling roughness. It works out at about
// nine tenths of the reported speed.
const FORECAST_WIND_HEIGHT = 10 // m
const TURBULENCE_WIND_HEIGHT = 20 * SimulationConstants.FEET_TO_METERS
const TERRAIN_ROUGHNESS = 0.15 // m, mixed farmland and forest

const SURFACE_WIND_FACTOR =
  Math.log(TURBULENCE_WIND_HEIGHT / TERRAIN_ROUGHNESS) / Math.log(FORECAST_WIND_HEIGHT / TERRAIN_ROUGHNESS)

const KNOTS_PER_FOOT_PER_SECOND = 0.592484

let physicsTimeDebt = 0

let currentCamera = 0
let compassOffset = 0
let heightAboveGround = 0

let gamepad = null
let engineSound = null

// ray for intersection testing with ground, direction is in GLB coordinates (y up)
const interSectionRay = new Ray(new Vector3(0, 0, 0), new Vector3(0, -1, 0))

const canvas = document.getElementById("webgl")
const renderer = new WebGLRenderer({ canvas: canvas, antialias: true })
renderer.setPixelRatio(window.devicePixelRatio)
renderer.setSize(window.innerWidth, window.innerHeight)

const hudCanvas = document.getElementById("hud")
const hud = new HUDObject(hudCanvas)

const scene = new Scene()

scene.background = new Color(0.74, 0.74, 0.82).convertSRGBToLinear()
scene.fog = new FogExp2(scene.background, 0.000042)

// add lights to the scene, to propely display the f16 model
const directionalLight = new DirectionalLight(0xcdb5ae, 1.5)
directionalLight.position.set(0, -0.2, 0.8)
scene.add(directionalLight)

const ambientLight = new AmbientLight(0xc7d4ed, 0.8)
scene.add(ambientLight)

// initialize cameras
const cameras = []

// main camera - internal view from cockpit
const camera = new PerspectiveCamera()
camera.up.set(0, 0, 1)
camera.fov = 45
camera.near = 1
camera.far = 50000

scene.add(camera)

cameras.push(camera)

// set up two secondary (external) cameras, derived from the main
cameras.push(camera.clone())
cameras.push(camera.clone())

const externalCameraPosition = {
  distance: 50,
  compass: 0,
  compassSpeed: 0,
  inclination: 90,
}

const EXTERNAL_CAMERA_SLEW_STEP = 4.8
const EXTERNAL_CAMERA_MIN_DISTANCE = 10

// set up container object for the 3D aircraft model
const f16 = new Object3D()
f16.visible = false
scene.add(f16)

const hudGeometry = new PlaneGeometry(1, 1)
const hudMaterial = new MeshBasicMaterial({ color: 0xffff00 })
const hudTexture = new CanvasTexture(hudCanvas)
hudMaterial.map = hudTexture
hudMaterial.transparent = true

const hudPlane = new Mesh(hudGeometry, hudMaterial)
hudPlane.position.set(0, 0, -2)
camera.add(hudPlane)

// load the actual aircraft model into the scene
loadAircraftModel(f16)

// register positions and orientations of aircraft object,
// to be sent to the "chase camera"
const chaseObject = new ChaseObject(f16)

// read out start position and direction
const url = new URL(document.location)
const urlParams = url.searchParams
const startPoint = await getStartpointFromParameters(urlParams)
let startDirection = +urlParams.get("c") || 0

camera.position.set(startPoint[0], startPoint[1], startPoint[2])

// convert requested compass direction to direction inside UTM grid
startDirection -= startPoint[3]

const terrain = new Terrain(scene, MINX, MINY, MAXX, MAXY, renderer)

// set up physics simulation
const f16simulation = new F16Simulation()
const airplaneState = new StateVector()
airplaneState.init(startPoint, startDirection)

// the ray cast that measures this has not run yet, so until it does, assume the
// terrain below the start point is at sea level. the turbulence model needs a
// height from the first step onwards, and it scales its eddies by it.
heightAboveGround = startPoint[2]

// Fly in the real weather: ask MET what the wind is doing over the start point
// at each of a few heights, and hand the profile to the turbulence model - the
// surface wind for the roughness down low, and how the wind changes with height
// for the turbulence aloft. Deliberately not awaited: the simulation starts on
// the default weather and picks the real one up a moment later, and carries on
// with the default if the service cannot be reached.
Promise.all(WIND_PROFILE_ALTITUDES.map((altitude) => downloadWindData(startPoint[4], altitude))).then((levels) => {
  const profile = levels.filter(Boolean).sort((a, b) => a.altitude - b.altitude)

  if (profile.length === 0) return

  // the lowest level is the surface wind, and the surface wind is the one the
  // boundary layer profile applies to
  f16simulation.turbulenceModel.setWind(profile[0].speed * SURFACE_WIND_FACTOR, profile)

  // the same profile is the steady wind the aircraft is carried along by
  f16simulation.windModel.setWind(profile)

  for (const level of profile) {
    console.log(
      "Wind at %d ft: %d knots from %d degrees, gusting %d",
      Math.round(level.altitude),
      Math.round(level.speed * KNOTS_PER_FOOT_PER_SECOND),
      Math.round(level.direction),
      Math.round(level.gust * KNOTS_PER_FOOT_PER_SECOND),
    )
  }
})

// keep two physics states in the physics loop, to allow for interpolation
const previousAirplaneState = new StateVector()
previousAirplaneState.copyFrom(airplaneState)

// renderstate is the interpolated state for the exact time instance we need to render
const renderState = new StateVector()
renderState.copyFrom(airplaneState)
const airplaneControlInput = new InputVector()

// pilot input -> FCS -> actuators -> control surfaces -> physics model
const flightControlSystem = new FlightControlSystem()
const controlActuators = new ActuatorModel()
const integrator = new RungeKutta4()

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

// log scene stats, every 3 secs
setInterval(() => {
  //  console.log("Time offset: " + (new Date().getTime() - startTime))
  console.log("Tiles loaded: " + Tile.loadCount)
  console.log("Textures rendered: " + renderer.info.memory.textures)
  console.log("Geometries rendered: " + renderer.info.memory.geometries)
  console.log("Triangles rendered: " + renderer.info.render.triangles)
}, 3000)

// update grid convergence angle every 60 secs
setInterval(() => {
  compassOffset = getCompassOffset(
    airplaneState.epos * SimulationConstants.FEET_TO_METERS,
    airplaneState.npos * SimulationConstants.FEET_TO_METERS,
  )
}, 60000)

// check for ground collision every 200 ms
setInterval(() => {
  // get the coordinates of the tile surrounding the camera
  const tileXOffset = (camera.position.x - MINX) % TILE_EXTENTS
  const x = Math.round(camera.position.x - tileXOffset)

  const tileYOffset = (camera.position.y - MINY) % TILE_EXTENTS
  const y = Math.round(camera.position.y - tileYOffset)

  // get the tile
  const tile = terrain.tiles.get(`${x}-${y}`)
  if (tile.loaded) {
    const cameraElevation = camera.position.z * SimulationConstants.FEET_TO_METERS
    const tileGeometry = tile.tileMesh.geometry

    // in the GLB, y is up, so read max y to get max elevation
    const maxElevationInTile = tileGeometry.boundingBox.max.y

    // set ray origin to the camera position
    // use relative coordinates inside the tile to match the geometry's coordinates
    // and convert from z up to y up
    interSectionRay.origin.set(tileXOffset, camera.position.z, -tileYOffset)

    // cast a ray from the camera position and straight down towards the terrain
    const hit = tileGeometry.boundsTree.raycastFirst(interSectionRay)

    // flag collision if we were too low or there was no hit (we were under the surface)
    if (!hit || hit.distance < 4) {
      document.location.href = "collision.html"
    } else {
      // register height above ground, for general use
      heightAboveGround = hit.distance
    }
  }
}, 200)

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

  airplaneControlInput.normalizeControls(frameTime * 0.001)

  physicsTimeDebt += frameTime * 0.001

  let steps = 0
  while (physicsTimeDebt >= PHYSICS_STEP && steps < MAX_PHYSICS_STEPS) {
    // run physics simulation loop until it is ajour
    flightControlSystem.update(airplaneControlInput, airplaneState, PHYSICS_STEP)
    controlActuators.update(flightControlSystem.commands, PHYSICS_STEP)

    // step the gust field once per physics step - it belongs to the air, not to
    // the aircraft, so it is held fixed across the four stages of the integrator
    f16simulation.turbulenceModel.update(
      heightAboveGround * SimulationConstants.METERS_TO_FEET,
      airplaneState.alt,
      airplaneState.airspeed,
      PHYSICS_STEP,
    )

    // keep two newest states around, for interpolation
    previousAirplaneState.copyFrom(airplaneState)

    integrator.step(f16simulation, controlActuators, airplaneState, PHYSICS_STEP)
    physicsTimeDebt -= PHYSICS_STEP
    steps++
  }

  // reset lag if needed
  if (steps === MAX_PHYSICS_STEPS) {
    physicsTimeDebt = 0
  }

  renderState.interpolate(previousAirplaneState, airplaneState, physicsTimeDebt / PHYSICS_STEP)
  renderState.updateAircraftModel(f16)

  if (hudPlane.visible) {
    hud.update(renderState, airplaneControlInput, f16simulation.atmosphericModel, compassOffset)
    hud.draw()
    hudTexture.needsUpdate = true
  }

  // always update master camera
  cameras[0].position.copy(f16.position)
  cameras[0].quaternion.copy(f16.quaternion)
  cameras[0].rotateX(90 * MathUtils.DEG2RAD)

  chaseObject.update(f16, frameTime)

  switch (currentCamera) {
    case 1:
      cameras[1].position.copy(chaseObject.position)
      cameras[1].quaternion.copy(chaseObject.quaternion)
      cameras[1].rotateX(90 * MathUtils.DEG2RAD)
      break
    case 2:
      cameras[2].position.copy(f16.position)
      cameras[2].quaternion.identity()
      cameras[2].rotateZ((90 + externalCameraPosition.compass) * MathUtils.DEG2RAD)
      cameras[2].rotateX(externalCameraPosition.inclination * MathUtils.DEG2RAD)
      cameras[2].translateZ(externalCameraPosition.distance)

      externalCameraPosition.compass += externalCameraPosition.compassSpeed * frameTime * 0.001
      break
  }

  terrain.update(camera, showWireFrame)
  engineSound.update(cameras[currentCamera], f16, renderState.pow)

  renderer.render(scene, cameras[currentCamera])
}

function getCompassOffset(east, north) {
  // https://gis.stackexchange.com/questions/115531/calculating-grid-convergence-true-north-to-grid-north

  const lonlat = proj4(UTM33N_PROJECTION).inverse([east, north])
  const lonDelta = lonlat[0] - UTM33N_CENTRAL_MERIDIAN

  return Math.atan(Math.tan(lonDelta * MathUtils.DEG2RAD) * Math.sin(lonlat[1] * MathUtils.DEG2RAD)) * MathUtils.RAD2DEG
}

async function downloadWindData(lonlat, alt) {
  // https://api.met.no/doc/

  const weatherAPI = "https://api.met.no/weatherapi/nowcast/2.0/complete"
  const weatherURL = `${weatherAPI}?lat=${lonlat[1].toFixed(3)}&lon=${lonlat[0].toFixed(3)}&altitude=${alt}`

  try {
    const weatherResponse = await fetch(`${weatherURL}`, {
      method: "GET",
      headers: {
        "User-Agent": "https://github.com/kristoffer-dyrkorn/flightsimulator - dyrkorn@gmail.com",
      },
    })

    if (!weatherResponse.ok) {
      throw new Error(`the weather service answered ${weatherResponse.status}`)
    }

    const weatherData = await weatherResponse.json()

    // only the first entry of the series carries the wind - the ones after it are
    // the precipitation forecast, and have nothing else in them
    const { wind_from_direction, wind_speed, wind_speed_of_gust } =
      weatherData.properties.timeseries[0].data.instant.details

    // the altitude asked for comes back as the third coordinate of the point
    const altitude = weatherData.geometry.coordinates[2] ?? alt

    // speeds are reported in m/s and the flight model works in ft/s
    const speed = wind_speed * SimulationConstants.METERS_TO_FEET
    const gust = (wind_speed_of_gust ?? wind_speed) * SimulationConstants.METERS_TO_FEET

    // a wind direction is the direction the wind comes from, so the direction it
    // blows towards - which is what a velocity needs - is the opposite one
    const heading = (wind_from_direction + 180) * MathUtils.DEG2RAD

    return {
      altitude: altitude * SimulationConstants.METERS_TO_FEET,
      east: speed * Math.sin(heading),
      north: speed * Math.cos(heading),
      speed,
      gust,
      direction: wind_from_direction,
    }
  } catch (error) {
    console.log("Could not read wind data: %s", error.message)
    return null
  }
}

async function getStartpointFromParameters(urlParams) {
  // set start point: UTM EAST, UTM NORTH, altitude (meters), compass direction,
  // and the same position as lon/lat, for whoever needs it in degrees
  let east = +urlParams.get("e") || 105000
  let north = +urlParams.get("n") || 6970000
  const alt = +urlParams.get("a") || 1524 // 5000 ft

  let lonlat = []
  // if input coordinates are GPS lat/lon, convert to utm33
  if (north < 72 && east < 33) {
    lonlat = [east, north]
    const utm = proj4(UTM33N_PROJECTION, [east, north])
    east = utm[0]
    north = utm[1]
  } else {
    lonlat = proj4(UTM33N_PROJECTION).inverse([east, north])
  }

  const rotation = getCompassOffset(east, north)

  return [east, north, alt, rotation, lonlat]
}

function loadAircraftModel(f16) {
  const manager = new LoadingManager()
  new MTLLoader(manager).setPath("f16/").load("f16.mtl", (materials) => {
    materials.preload()

    new OBJLoader(manager)
      .setMaterials(materials)
      .setPath("f16/")
      .load(
        "f16.obj",
        (object) => {
          object.position.set(0, 2, -1.6)

          // align model with world axes
          object.rotateX(90 * MathUtils.DEG2RAD)
          object.rotateY(180 * MathUtils.DEG2RAD)

          f16.add(object)
        },
        (xhr) => {},
        (error) => {
          console.log("Could not load 3d model: " + error)
        },
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
    case "ArrowDown": // stick aft, pull g
      airplaneControlInput.pitchStick += STICK_STEP
      keyboardEvent.stopPropagation()
      keyboardEvent.preventDefault()
      break
    case "ArrowUp": // stick forward, push
      airplaneControlInput.pitchStick -= STICK_STEP
      keyboardEvent.stopPropagation()
      keyboardEvent.preventDefault()
      break
    case "ArrowLeft": // roll left
      airplaneControlInput.rollStick -= STICK_STEP
      break
    case "ArrowRight": // roll right
      airplaneControlInput.rollStick += STICK_STEP
      break
    case "q":
      airplaneControlInput.targetThrottle += THROTTLE_STEP
      break
    case "a":
      airplaneControlInput.targetThrottle -= THROTTLE_STEP
      break
    case "h": // hud toggle
      hudPlane.visible = !hudPlane.visible
      break
    case "t": {
      // weather on/off - the steady wind and the turbulence in it, together
      const weather = !f16simulation.windModel.enabled

      f16simulation.windModel.setEnabled(weather)
      f16simulation.turbulenceModel.setEnabled(weather)

      console.log("Wind and turbulence: %s", weather ? "on" : "off")
      break
    }
    case "z": // left pedal, yaw left
      airplaneControlInput.yawPedal -= STICK_STEP
      break
    case "x": // right pedal, yaw right
      airplaneControlInput.yawPedal += STICK_STEP
      break
    case "j": // external cam left
      externalCameraPosition.compassSpeed -= EXTERNAL_CAMERA_SLEW_STEP
      break
    case "l": // external cam right
      externalCameraPosition.compassSpeed += EXTERNAL_CAMERA_SLEW_STEP
      break
    case "i": // external cam up
      externalCameraPosition.inclination -= 2
      break
    case "k": // external cam down
      externalCameraPosition.inclination += 2
      break
    case ",": // external cam nearer
      externalCameraPosition.distance = Math.max(EXTERNAL_CAMERA_MIN_DISTANCE, externalCameraPosition.distance - 10)
      break
    case ".": // external cam farer
      externalCameraPosition.distance += 10
      break
    case "1": // speed brake -10 degrees
      airplaneControlInput.speedbrake -= 10
      break
    case "2": // speed brake +10 degrees
      airplaneControlInput.speedbrake += 10
      break
    case " ":
      nextCamera()
      break
    case "w":
      showWireFrame = !showWireFrame
  }
}

function resetViewport() {
  const aspect = window.innerWidth / window.innerHeight

  for (const view of cameras) {
    view.aspect = aspect
    view.updateProjectionMatrix()
  }

  renderer.setSize(window.innerWidth, window.innerHeight)
}
