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
  Ray,
  Vector3,
  Quaternion,
  LoadingManager,
} from "three"
import { MTLLoader } from "three/addons/loaders/MTLLoader.js"
import { OBJLoader } from "three/addons/loaders/OBJLoader.js"
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js"
import StateVector from "./hifimodel/statevector.js"
import InputVector, { STICK_STEP, THROTTLE_STEP, BRAKE_STEP } from "./hifimodel/inputvector.js"
import F16Simulation from "./hifimodel/f16simulation.js"
import FlightControlSystem from "./hifimodel/models/flightcontrolsystem.js"
import RungeKutta4 from "./hifimodel/integrator.js"
import ActuatorModel from "./hifimodel/models/actuatormodel.js"
import SimulationConstants from "./hifimodel/simulationconstants.js"
import ChaseObject from "./graphics/ChaseObject.js"
import ControlSurfaceRig from "./graphics/controlSurfaceRig.js"
import LandingGearRig from "./graphics/landingGearRig.js"
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
let controlSurfaceRig = null
let landingGearRig = null

// the pilot's commanded gear position - up/down, instant, exactly like a
// real gear handle - not the actual gear position. That's
// controlActuators.gear, rate-limited to a real transition time (see
// ActuatorModel's own comment) and what both the aerodynamic model's gear
// drag and landingGearRig's visual animation actually ride on. This one is
// still what landing-legality checks below care about (a real pilot is
// judged on when they moved the handle, not on the hydraulics catching
// up), and it's what the "g" key toggles. Starts up, matching the sim's
// own starting state (airborne, not parked).
let gearDown = false

// true once the aircraft has been judged down safely and is rolling on the
// ground, rather than still flying - see the ground collision check below.
// Persists across ticks so a landing, once judged safe, isn't re-litigated
// every 200ms against criteria (sink rate, bank, being over a mapped
// runway polygon) that only mean something at the instant of touchdown -
// a taxiing aircraft bumping over an uneven surface shouldn't have to
// re-earn its landing every fifth of a second. Cleared the moment the
// wheels lift clear of the ground again, so a bounce, a go-around, or a
// subsequent takeoff all require a fresh safe touch of their own.
let onGround = false

// hard pause - freezes physics, camera motion, terrain streaming, and
// rendering entirely (drawScene below returns immediately once this is
// set, before touching any of them). previousFrameTime keeps advancing
// with the wall clock regardless, so the frame right after unpausing sees
// a normal small frameTime rather than the whole paused duration landing
// on the simulation in one burst.
let paused = false

// ray for intersection testing with ground, direction is in GLB coordinates (y up)
const interSectionRay = new Ray(new Vector3(0, 0, 0), new Vector3(0, -1, 0))
const wheelWorldPosition = new Vector3()
const closestWheelWorldPosition = new Vector3()

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
  distance: 30,
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

// how far straight down it is to the terrain surface below a world position
// (in the scene's own UTM33-meters coordinates), or null if the tile
// underneath it hasn't loaded yet
function terrainClearanceBelow(worldPosition) {
  const tileXOffset = (worldPosition.x - MINX) % TILE_EXTENTS
  const x = Math.round(worldPosition.x - tileXOffset)

  const tileYOffset = (worldPosition.y - MINY) % TILE_EXTENTS
  const y = Math.round(worldPosition.y - tileYOffset)

  const tile = terrain.tiles.get(`${x}-${y}`)
  if (!tile || !tile.loaded) return null

  // set ray origin to the query position, in the tile's own local
  // coordinates, and convert from z up to the GLB's y up
  interSectionRay.origin.set(tileXOffset, worldPosition.z, -tileYOffset)

  const hit = tile.tileMesh.geometry.boundsTree.raycastFirst(interSectionRay)
  return hit ? hit.distance : null
}

// whether a world position (in the scene's own UTM33-meters coordinates)
// falls inside a runway polygon for the tile underneath it - see runways.js.
// tileXOffset/tileYOffset are already the tile-local UTM33 coordinates the
// runway geojson itself is authored in, so no conversion is needed beyond
// the same tile-snap arithmetic terrainClearanceBelow above uses.
function isPositionOnRunway(worldPosition) {
  const tileXOffset = (worldPosition.x - MINX) % TILE_EXTENTS
  const x = Math.round(worldPosition.x - tileXOffset)

  const tileYOffset = (worldPosition.y - MINY) % TILE_EXTENTS
  const y = Math.round(worldPosition.y - tileYOffset)

  return terrain.runways.isInsideRunway(`${x}-${y}`, tileXOffset, tileYOffset)
}

// Every parameter that decides whether a touchdown right now would be
// judged a safe landing, read fresh each call - shared by the crash check
// below and the periodic landing-status log, so both are always looking at
// exactly the same numbers.
//
// The wheels themselves never move (the gear rig is a visibility toggle,
// not an animated one - see landingGearRig.js), so closestWheelClearance is
// always where they'd be if extended, whether gear is down or not; that's
// what lets a gear-up approach still read as "close to the ground" here
// without it being mistaken for a real touch anywhere this is used.
function evaluateLandingConditions() {
  const wheels = landingGearRig?.wheels
  let closestWheelClearance = Infinity

  if (wheels) {
    for (const wheel of [wheels.nose, wheels.left, wheels.right]) {
      if (!wheel) continue

      const clearance = terrainClearanceBelow(wheel.getWorldPosition(wheelWorldPosition))
      if (clearance !== null && clearance < closestWheelClearance) {
        closestWheelClearance = clearance
        closestWheelWorldPosition.copy(wheelWorldPosition)
      }
    }
  }

  return {
    hasWheels: !!wheels,
    closestWheelClearance,
    wheelsNearGround: closestWheelClearance < SimulationConstants.GEAR_CONTACT_CLEARANCE,
    gearDown,
    sinkRate: airplaneState.sinkRate, // ft/min, positive = descending
    bank: Math.abs(airplaneState.phi * SimulationConstants.RTOD), // deg
    onRunway: wheels ? isPositionOnRunway(closestWheelWorldPosition) : false,
  }
}

// Which of evaluateLandingConditions()'s parameters, if any, would turn a
// touch right now into a crash rather than a landing - the same conditions
// safeTouch below checks, just spelled out individually so a crash can say
// what was actually wrong instead of just that one happened.
function landingFailureReasons(status) {
  const reasons = []

  if (!status.gearDown) reasons.push("landing gear is up")
  if (status.sinkRate >= SimulationConstants.MAX_SAFE_SINK_RATE) {
    reasons.push(`sink rate too high (${status.sinkRate.toFixed(1)} ft/min, max ${SimulationConstants.MAX_SAFE_SINK_RATE})`)
  }
  if (status.bank >= SimulationConstants.MAX_SAFE_BANK) {
    reasons.push(`bank too steep (${status.bank.toFixed(1)} deg, max ${SimulationConstants.MAX_SAFE_BANK})`)
  }
  if (!status.onRunway) reasons.push("not over a mapped runway")

  return reasons
}

// Landing-readiness telemetry, printed every 0.5 s while the aircraft is
// airborne (once down and rolling, there's nothing left to preview) - the
// same parameters the crash check below judges a touchdown by, so the
// console shows exactly what would happen if the aircraft touched down
// right now, continuously, rather than only finding out after the fact.
setInterval(() => {
  if (paused || onGround) return

  const status = evaluateLandingConditions()
  const reasons = landingFailureReasons(status)

  console.log(
    "Landing check: gear %s | sink rate %s ft/min (max %s) | bank %s deg (max %s) | wheel clearance %s m (need < %s) | over runway: %s -> %s",
    status.gearDown ? "down" : "up",
    status.sinkRate.toFixed(1),
    SimulationConstants.MAX_SAFE_SINK_RATE,
    status.bank.toFixed(1),
    SimulationConstants.MAX_SAFE_BANK,
    Number.isFinite(status.closestWheelClearance) ? status.closestWheelClearance.toFixed(1) : "-",
    SimulationConstants.GEAR_CONTACT_CLEARANCE,
    status.onRunway ? "yes" : "no",
    reasons.length === 0 ? "would be a safe landing" : "would crash right now (" + reasons.join(", ") + ")",
  )
}, 500)

// check for ground collision every 200 ms
setInterval(() => {
  if (paused) return

  const status = evaluateLandingConditions()

  // Airborne again - a bounce, a go-around, or a subsequent takeoff. The
  // next touch has to earn its own safe landing rather than inheriting
  // this one's.
  if (onGround && !status.wheelsNearGround) {
    onGround = false
    console.log("Airborne - landing conditions will be re-checked on next touch")
  }

  // Not yet down: a gear-down touch with a sane sink rate and wings level,
  // over mapped runway ground, is a landing rather than a crash - judged
  // once, right here, at the instant the wheels reach the ground. See
  // runways.js for how "over mapped runway ground" is tracked.
  if (!onGround && status.wheelsNearGround) {
    const reasons = landingFailureReasons(status)

    if (reasons.length === 0) {
      onGround = true
      console.log("Landed - rolling on the ground")
    } else {
      // the wheels are already within GEAR_CONTACT_CLEARANCE of the
      // ground - effectively touching - without satisfying what makes a
      // touch safe. That's the crash: wrong attitude, too hard a sink,
      // gear still up, or simply not over mapped runway ground.
      console.log("Crash: unsafe touchdown - %s", reasons.join(", "))
      document.location.href = "collision.html"
      return
    }
  }

  // get the coordinates of the tile surrounding the camera
  const tileXOffset = (camera.position.x - MINX) % TILE_EXTENTS
  const x = Math.round(camera.position.x - tileXOffset)

  const tileYOffset = (camera.position.y - MINY) % TILE_EXTENTS
  const y = Math.round(camera.position.y - tileYOffset)

  // get the tile
  const tile = terrain.tiles.get(`${x}-${y}`)
  if (tile.loaded) {
    const tileGeometry = tile.tileMesh.geometry

    // set ray origin to the camera position
    // use relative coordinates inside the tile to match the geometry's coordinates
    // and convert from z up to y up
    interSectionRay.origin.set(tileXOffset, camera.position.z, -tileYOffset)

    // cast a ray from the camera position and straight down towards the terrain
    const hit = tileGeometry.boundsTree.raycastFirst(interSectionRay)

    // Ground height tracking runs unconditionally, on- or off-ground alike:
    // the aircraft keeps moving over (and needing an accurate reading of)
    // the terrain surface throughout a landing roll, not just up to the
    // moment of touchdown, so this can no longer live behind the crash
    // check below the way it used to when a safe touch just ended the tick
    // early.
    if (hit) {
      // register height above ground, for general use
      heightAboveGround = hit.distance

      // terrain elevation directly below the aircraft, for the landing gear
      // model's ground reaction - cached here rather than recomputed from
      // the aircraft's own (fast-changing, mid-descent) altitude each
      // physics step, since the ground's elevation doesn't move with the
      // aircraft and this 200ms-updated reading is the only terrain height
      // available anyway
      f16simulation.landingGearModel.groundAlt = (camera.position.z - hit.distance) * SimulationConstants.METERS_TO_FEET
    }

    // No ground found at all directly below the aircraft - off the edge of
    // loaded terrain, or already under the mesh - is always a crash,
    // whatever state the landing gear is in.
    if (!hit) {
      console.log("Crash: no terrain found directly below the aircraft (off the edge of loaded terrain, or already under the surface)")
      document.location.href = "collision.html"
      return
    }

    // The distance-from-camera "too low" check below is a coarse backstop
    // for when there's no wheel telemetry yet (landingGearRig hasn't
    // loaded) - once there is, the wheel-based check above already covers
    // this, more precisely (GEAR_CONTACT_CLEARANCE, not an arbitrary 4 m)
    // and more completely (three sample points under nose and both main
    // gear, not one under the camera). Left as-is here, this threshold is
    // measured from the CG, which sits a good 1.7-1.8 m above the wheels
    // (see landinggearmodel.js's LEGS) - it would fire on every ordinary
    // approach, well before the wheels themselves ever got close enough to
    // register a safe touchdown at all.
    if (!status.hasWheels && hit.distance < 4) {
      console.log("Crash: too close to terrain (%s m) with no landing gear telemetry yet", hit.distance.toFixed(1))
      document.location.href = "collision.html"
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

  if (paused) return

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
  controlSurfaceRig?.update(controlActuators)

  // controlActuators.gear is the same rate-limited 0..1 actuator position
  // the aerodynamic model's gear drag already rides on (see
  // ActuatorModel's own comment) - passing it straight through here is
  // what gives the visual gear a real transition instead of a snap toggle,
  // now that landingGearRig actually animates rather than just hiding/
  // showing parts
  landingGearRig?.update(controlActuators.gear)

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

// f16-5/f16.glb is authored in its own arbitrary units - this converts them
// to meters, calibrated against the real F-16's ~9.45 m clean wingspan versus
// the model's own wingspan measured in raw units. The OBJ, by contrast, was
// already authored directly in meters (its own hinge points and (0, 2, -1.6)
// offset are all meter-scale numbers), so this same factor - which turns the
// GLB's gear into real-world meters - is what makes the extracted gear a
// physically correct size to attach to the OBJ.
const GEAR_MODEL_SCALE = 0.557

// gear legs, wheels, and gear-bay doors - the only nodes kept visible out of
// f16-5/f16.glb once it's reduced to "a source of landing gear geometry" for
// the OBJ. See landingGearRig.js for what drives them.
//
// The GLB's nose-to-main-gear spacing doesn't scale onto the OBJ's own
// fuselage as a single rigid offset - fixing the main gear under the OBJ's
// wing root left the nose gear as far aft as the tail. The two models don't
// share proportions, so nose and main gear each get their own correction
// (added to that part's own existing position, in the GLB's local space)
// instead of one offset for the whole model. Both are tuned by eye against
// the OBJ's fuselage and need iterating further if they look off.
const NOSE_GEAR_NAMES = ["F-16_chassesFront1_LOD0_4", "F-16_chassesFront2_LOD0_5", "F-16_chassesFront3_LOD0_6", "F-16_whel_LOD0_36", "F-16_capFlont_LOD0_1"]
const NOSE_GEAR_OFFSET = [0, 0, -0.02]

const MAIN_GEAR_NAMES = [
  "F-16_chassesL1_LOD0_7",
  "F-16_chassesL2_LOD0_8",
  "F-16_chassesL3_LOD0_9",
  "F-16_chassesL4_LOD0_10",
  "F-16_whelL_LOD0_37",
  "F-16_capL_LOD0_2",
  "F-16_chassesR1_LOD0_11",
  "F-16_chassesR2_LOD0_12",
  "F-16_chassesR3_LOD0_13",
  "F-16_chassesR4_LOD0_14",
  "F-16_whelR_LOD0_38",
  "F-16_capR_LOD0_3",
]
const MAIN_GEAR_OFFSET = [0, 0.9, -0.02]

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
          controlSurfaceRig = new ControlSurfaceRig(object)
        },
        (xhr) => {},
        (error) => {
          console.log("Could not load 3d model: " + error)
        },
      )
  })

  loadLandingGear(f16)
}

function loadLandingGear(f16) {
  new GLTFLoader().load(
    "f16/gear.glb",
    (gltf) => {
      const object = gltf.scene

      object.scale.setScalar(GEAR_MODEL_SCALE)

      // same axis alignment f16-5 needed when it was the whole visible model
      // (see git history) - this file was cut down from f16-5/f16.glb to
      // just the 17 gear/door parts actually used (see
      // scripts/extract-landing-gear.js), carrying over the rotation its old
      // parent node had, so it still needs the same single +90 correction to
      // match the body frame f16's own quaternion expects.
      object.rotateX(90 * MathUtils.DEG2RAD)

      // the whole model's own origin needs no extra offset - the per-group
      // corrections below handle placing the gear against the OBJ's
      // fuselage, since a single offset for the whole model can't fit both
      // the nose and main gear at once (see the comment above their names).
      object.position.set(0, 0, 0)

      f16.add(object)

      // NOSE_GEAR_OFFSET/MAIN_GEAR_OFFSET are meters, in f16's own local
      // (body) frame - the same frame the OBJ's (0, 2, -1.6) offset is in.
      // Each part sits several rotated, scaled levels down inside this GLB's
      // own node hierarchy though, so the offset can't just be added to a
      // part's .position directly (an earlier attempt to hand-convert it by
      // un-rotating and un-scaling landed nowhere close - this GLB's root
      // node bakes in its own extra rotation that a single object.quaternion
      // inverse doesn't account for). Going through world space sidesteps
      // that entirely: rotate the offset by f16's actual world orientation,
      // add it to the part's actual current world position, then let
      // three.js's own worldToLocal convert that back for us.
      f16.updateWorldMatrix(true, true)
      const f16WorldQuaternion = f16.getWorldQuaternion(new Quaternion())

      function nudge(names, finalFrameOffset) {
        const deltaWorld = new Vector3(...finalFrameOffset).applyQuaternion(f16WorldQuaternion)
        for (const name of names) {
          const part = object.getObjectByName(name)
          if (!part) continue
          const worldPos = part.getWorldPosition(new Vector3()).add(deltaWorld)
          part.position.copy(part.parent.worldToLocal(worldPos))
        }
      }

      nudge(NOSE_GEAR_NAMES, NOSE_GEAR_OFFSET)
      nudge(MAIN_GEAR_NAMES, MAIN_GEAR_OFFSET)

      landingGearRig = new LandingGearRig(object)
      tintGearToMatchBody(object)
    },
    (xhr) => {},
    (error) => {
      console.log("Could not load landing gear model: " + error)
    },
  )
}

// f16-5's own metal/strut material comes in noticeably lighter than the
// OBJ's body skin - average sampled color (123, 126, 125) against the OBJ's
// (70, 70, 74) - so it reads as mismatched silver against the OBJ's darker
// gray. Tinting is a plain multiply of MeshStandardMaterial's color against
// its base color texture, so this ratio pulls the gear texture towards that
// darker shade without touching the texture itself - pulling it all the way
// to the OBJ's own average came out too dark in practice (a dark surface
// with the glTF's default roughness still throws a bright specular
// highlight, which reads worse than just being lighter), so this only goes
// about a third of the way there. Roughness is also pushed towards fully
// matte, to kill that shine on the struts and wheels - real gear legs are
// unpolished metal, not chrome. Only the textured material is touched - the
// glass material (used nowhere on the visible gear/door parts) has no map
// and is left alone.
const GEAR_TINT = [0.85, 0.84, 0.86]
const GEAR_ROUGHNESS = 0.95

function tintGearToMatchBody(object) {
  const tint = new Color(...GEAR_TINT).convertSRGBToLinear()
  const tinted = new Set()

  object.traverse((child) => {
    if (child.isMesh && child.material?.map && !tinted.has(child.material)) {
      child.material.color.copy(tint)
      child.material.roughness = GEAR_ROUGHNESS
      child.material.metalness = 0
      tinted.add(child.material)
    }
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
    case "p": // pause/resume the entire simulation
      paused = !paused
      console.log("Simulation: %s", paused ? "paused" : "running")
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
      break
    case "g": // landing gear up/down
      gearDown = !gearDown
      airplaneControlInput.gear = gearDown ? 1 : 0
      console.log("Landing gear: %s", gearDown ? "down" : "up")
      break
    case "b": // wheel brakes - spring-centering, hold/tap to keep pressure on
      airplaneControlInput.brake += BRAKE_STEP
      break
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
