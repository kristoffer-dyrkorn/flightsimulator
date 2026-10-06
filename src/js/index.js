import Tile from "./terrain/tile.js"
import Terrain from "./terrain/terrain.js"
import {
  WebGLRenderer,
  Scene,
  Color,
  FogExp2,
  DirectionalLight,
  HemisphereLight,
  PerspectiveCamera,
  Object3D,
  PlaneGeometry,
  MeshBasicMaterial,
  MeshPhongMaterial,
  CanvasTexture,
  Mesh,
  MathUtils,
  Ray,
  Vector3,
  Quaternion,
  Triangle,
  LoadingManager,
  PCFSoftShadowMap,
} from "three"
import { MTLLoader } from "three/addons/loaders/MTLLoader.js"
import { OBJLoader } from "three/addons/loaders/OBJLoader.js"
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js"
import StateVector from "./hifimodel/statevector.js"
import InputVector, { STICK_STEP, THROTTLE_STEP } from "./hifimodel/inputvector.js"
import F16Simulation from "./hifimodel/f16simulation.js"
import FlightControlSystem from "./hifimodel/models/flightcontrolsystem.js"
import RungeKutta4 from "./hifimodel/integrator.js"
import ActuatorModel from "./hifimodel/models/actuatormodel.js"
import SimulationConstants from "./hifimodel/simulationconstants.js"
import ChaseObject from "./graphics/ChaseObject.js"
import { splitOffTriangles } from "./graphics/splitMesh.js"
import GroundShadow from "./graphics/GroundShadow.js"
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
// every 200ms against criteria (sink rate, bank) that only mean something
// at the instant of touchdown - a taxiing aircraft bumping over an uneven
// surface shouldn't have to re-earn its landing every fifth of a second.
// Staying on the runway is still checked on every tick, though. Cleared the moment the
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
const aircraftPosition = new Vector3()

const canvas = document.getElementById("webgl")
const renderer = new WebGLRenderer({ canvas: canvas, antialias: true })
renderer.setPixelRatio(window.devicePixelRatio)
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.shadowMap.enabled = true
renderer.shadowMap.type = PCFSoftShadowMap
// the scene and the aircraft are drawn in two passes into the same buffers
// (see drawScene). The first pass still clears, since a color
// scene.background forces a clear regardless of autoClear.
renderer.autoClear = false

const hudCanvas = document.getElementById("hud")
const hud = new HUDObject(hudCanvas)

const scene = new Scene()

scene.background = new Color(0.74, 0.74, 0.82).convertSRGBToLinear()
scene.fog = new FogExp2(scene.background, 0.000042)

// the aircraft lives in its own scene, which is shifted so that the
// aircraft sits at the origin while it is being rendered. World coordinates
// here are UTM meters (north is ~7 000 000), and at that magnitude the
// GPU's 32-bit floats only resolve positions to ~0.5 m. That is invisible
// for regular rendering (three.js combines the model and view matrices on
// the CPU, in double precision) but the shadow lookup works on world
// positions inside the shader, so the self-shadows would jitter across the
// airframe. Keeping the aircraft near the origin during rendering avoids
// that. The terrain is unlit, so the lights only need to be here.
const aircraftScene = new Scene()
aircraftScene.fog = scene.fog

// the aircraft is drawn with a copy of the active camera, moved into the
// shifted aircraft scene's frame
const aircraftCamera = new PerspectiveCamera()

// Daylight for the f16 model: the sun, and the light from the sky above and
// the ground below. A sunlit surface is several times brighter than one
// facing the ground, which only gets the light the ground reflects - so
// rather than an ambient light, which lights the underside as brightly as
// the top, a hemisphere light: sky blue from above, a grey-brown ground
// bounce from below.
const SUN_COLOUR = 0xfff5ec
const SUN_INTENSITY = 1.3
const SKY_COLOUR = 0xc7d4ed
const GROUND_BOUNCE_COLOUR = 0x958d80
const SKY_INTENSITY = 0.9

const directionalLight = new DirectionalLight(SUN_COLOUR, SUN_INTENSITY)
aircraftScene.add(directionalLight)
aircraftScene.add(directionalLight.target)

// only the aircraft casts shadows - onto itself and onto the ground (see
// GroundShadow) - so the shadow camera is a small box that follows the
// aircraft around, see drawScene. The box's sides just need to enclose the
// whole airframe (~15 m long, ~9.5 m wingspan) in any orientation, since
// the ground shadow is the airframe's own outline seen along the light. Its
// depth is stretched down to the ground each frame, for the ground shadow.
const LIGHT_DIRECTION = new Vector3(0, -0.2, 0.8).normalize()
const SHADOW_LIGHT_DISTANCE = 50
const SHADOW_EXTENT = 10

// shadow.bias is in shadow camera depth units, which change with the
// camera's depth range, so the bias is set from this (in meters) each frame
const SHADOW_DEPTH_BIAS = 0.01
const SHADOW_NORMAL_BIAS = 0.02 // meters

// Larger biases for the airframe drawn close up from the cockpit. There the
// nearest surfaces - the canopy frame, the cockpit walls, the fuselage just
// behind the canopy - are a meter or less from the eye, so one shadow map
// texel (about a centimeter) covers dozens of pixels, and many of them are
// lit at a grazing angle. With the biases tuned for normal viewing distances
// they show shadow acne that shifts with every small change in attitude, and
// flickers. Only used for that close-up pass (see drawScene).
const COCKPIT_SHADOW_DEPTH_BIAS = 0.03
const COCKPIT_SHADOW_NORMAL_BIAS = 0.1

// the ground shadow is only drawn below this height above ground, and
// the shadow camera reaches this far below the ground height measured under
// the aircraft, to allow for sloping terrain where the shadow lands
const MAX_GROUND_SHADOW_HEIGHT = 500
const GROUND_SHADOW_MARGIN = 100
const GROUND_SHADOW_OPACITY = 0.5

directionalLight.castShadow = true
directionalLight.shadow.mapSize.set(2048, 2048)
directionalLight.shadow.camera.left = -SHADOW_EXTENT
directionalLight.shadow.camera.right = SHADOW_EXTENT
directionalLight.shadow.camera.top = SHADOW_EXTENT
directionalLight.shadow.camera.bottom = -SHADOW_EXTENT
directionalLight.shadow.camera.near = SHADOW_LIGHT_DISTANCE - SHADOW_EXTENT
directionalLight.shadow.camera.far = SHADOW_LIGHT_DISTANCE + SHADOW_EXTENT
directionalLight.shadow.normalBias = SHADOW_NORMAL_BIAS

// A hemisphere light takes its "up" from its position, seen from the scene's
// origin - which, with the aircraft scene shifted to the aircraft while it is
// drawn (see aircraftScene), means placing it straight above the aircraft
// each frame, like the sun (see drawScene).
const hemisphereLight = new HemisphereLight(SKY_COLOUR, GROUND_BOUNCE_COLOUR, SKY_INTENSITY)
const UP = new Vector3(0, 0, 1)
aircraftScene.add(hemisphereLight)

const groundShadow = new GroundShadow(aircraftScene, GROUND_SHADOW_OPACITY)

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

// The pilot's eye point, meters, in the aircraft model's own frame (x right,
// y forward, z up, from the centre of gravity) - measured from f16.obj: the
// top of the pilot figure's head is 0.99 m up, between 5.04 and 5.95 m
// forward, and the HUD glass in front of it reaches 0.84 m up. The cockpit
// camera sits here, looking along the aircraft's nose axis.
const EYE_POSITION = new Vector3(0, 5.25, 0.85)

// Where the pilot is looking, from the cockpit: degrees of yaw from straight
// ahead, positive to the left. The look keys set the target, and the view
// glides there (see updateCockpitLook) - set by the j, l, i and k keys
// while the cockpit camera is selected (see lookFromCockpit), separate from
// the external camera's state, which the same keys drive in the other views.
// Neither is kept within +-180: turning keeps going round.
const cockpitLook = { yaw: 0, targetYaw: 0 }
const LOOK_STEP = 20 // degrees per press of j or l
const LOOK_BACK = 180
const LOOK_GLIDE_TIME = 0.1 // seconds, time constant of the glide
const LOOK_GLIDE_RATE_MAX = 360 // degrees per second

// an angle, degrees, wrapped into -180..180
const wrapDegrees = (angle) => angle - 360 * Math.round(angle / 360)
const EXTERNAL_CAMERA_MIN_DISTANCE = 10

// From the cockpit, the canopy frame and HUD glass are well inside the
// active camera's near plane, so the airframe is drawn a second time with a
// camera that clips much closer - see drawScene.
const COCKPIT_NEAR = 0.05
const COCKPIT_FAR = 100

// set up container object for the 3D aircraft model. Visible from the start,
// since the simulator starts in the cockpit and the airframe shows from there.
const f16 = new Object3D()
aircraftScene.add(f16)

// parts of the model hidden in the cockpit view: the pilot figure (the
// camera is inside its head), the model's HUD glass and the panels either
// side of it (the simulator draws its own HUD there), and the ejection seat
// (the camera sits between its side walls and in front of its headrest, so
// looking sideways or back they would fill much of the view)
const COCKPIT_HIDDEN_PARTS = ["Pilot", "Glass_HUD", "HUD_SidePanels", "Eject_Seat"]
let cockpitHiddenParts = []

// Parts of the model that don't receive the aircraft's own shadows in the
// cockpit view: the cockpit interior and the fuselage around the canopy
// (see separateCockpitSurroundings). They are so close to the eye there that
// one shadow map texel covers dozens of pixels, and the self-shadows on them
// flicker with every small change in attitude however the shadow biases are
// set. They still cast shadows, and the exterior views are unchanged.
const COCKPIT_UNSHADOWED_PARTS = ["Cockpit_Interior", "Canopy_Inside", "Cockpit_Surroundings"]
let cockpitUnshadowedParts = []

const hudGeometry = new PlaneGeometry(1, 1)
const hudMaterial = new MeshBasicMaterial({ color: 0xffff00 })
const hudTexture = new CanvasTexture(hudCanvas)
hudMaterial.map = hudTexture
hudMaterial.transparent = true

// The HUD is drawn last, in a scene of its own, so the airframe seen from
// the cockpit never covers it. The HUD plane is fixed in that scene, straight
// ahead along the aircraft's nose, and the HUD camera borrows the cockpit
// camera's projection and turns with the pilot's look - so when the pilot
// looks sideways, the HUD stays over the nose and slides out of view, as the
// real one does, its symbology still lined up with the world outside.
const hudScene = new Scene()
const hudCamera = new PerspectiveCamera()
const HUD_LOOK_AXIS = new Vector3(0, 1, 0) // up, in the HUD camera's frame

// The HUD sits where the model's HUD combiner glass is, straight ahead of the
// pilot's eyes (see EYE_POSITION - the glass is 0.57 to 0.68 m in front of
// them). It covers the same angle as it always has: 1 m wide at 2.2 m, about
// 25.6 degrees - a flat panel seen from a camera at the eye looks exactly the
// same at any distance, as long as that angle stays the same.
const HUD_DISTANCE = 0.625 // m
const HUD_FIELD_OF_VIEW = 2 * Math.atan(0.5 / 2.2) // radians, across the panel
const HUD_SIZE = 2 * HUD_DISTANCE * Math.tan(HUD_FIELD_OF_VIEW / 2) // m

// the HUD draws its symbology to match the angle the panel covers
hud.setFieldOfView(HUD_FIELD_OF_VIEW)

const hudPlane = new Mesh(hudGeometry, hudMaterial)
hudPlane.position.set(0, 0, -HUD_DISTANCE)
hudPlane.scale.set(HUD_SIZE, HUD_SIZE, 1)
hudScene.add(hudPlane)

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

// Fly in the real weather: ask MET what the wind is doing over the start point,
// and hand it to the turbulence model - the surface wind sets the roughness down
// low - and to the steady wind the aircraft is carried along by. The nowcast
// only has the wind near the ground: its altitude parameter is the height of
// the location, used to correct the temperature, and the wind comes back the
// same whatever it is set to. So one request, and the wind is the same at all
// heights. Deliberately not awaited: the simulation starts on the default
// weather and picks the real one up a moment later, and carries on with the
// default if the service cannot be reached.
downloadWindData(startPoint[4]).then((surface) => {
  if (!surface) return

  const profile = [surface]

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
window.addEventListener("keyup", keyUpHandler)

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
  // the tile's BVH is built after it loads, so it can be shown before it
  // can be ray cast against
  if (!tile || !tile.loaded || !tile.tileMesh.geometry.boundsTree) return null

  // set ray origin to the query position, in the tile's own local
  // coordinates, and convert from z up to the GLB's y up
  interSectionRay.origin.set(tileXOffset, worldPosition.z, -tileYOffset)

  const hit = tile.tileMesh.geometry.boundsTree.raycastFirst(interSectionRay)
  return hit ? hit.distance : null
}

// stretch the shadow camera down to the ground below the aircraft, and
// pick the terrain tiles its shadow falls on
function updateGroundShadow() {
  const shadowCamera = directionalLight.shadow.camera
  const tiles = []

  shadowCamera.far = SHADOW_LIGHT_DISTANCE + SHADOW_EXTENT

  if (heightAboveGround < MAX_GROUND_SHADOW_HEIGHT) {
    // distance along the light from the aircraft down to the ground
    const groundDistance = heightAboveGround / LIGHT_DIRECTION.z
    shadowCamera.far += groundDistance + GROUND_SHADOW_MARGIN

    // the shadow's center on the ground, and the tiles under the corners
    // of the shadow box around it
    const centerX = f16.position.x - LIGHT_DIRECTION.x * groundDistance
    const centerY = f16.position.y - LIGHT_DIRECTION.y * groundDistance

    for (const dx of [-SHADOW_EXTENT, SHADOW_EXTENT]) {
      for (const dy of [-SHADOW_EXTENT, SHADOW_EXTENT]) {
        const x = centerX + dx
        const y = centerY + dy
        const tileX = Math.round(x - ((x - MINX) % TILE_EXTENTS))
        const tileY = Math.round(y - ((y - MINY) % TILE_EXTENTS))

        const tile = terrain.tiles.get(`${tileX}-${tileY}`)
        if (tile?.loaded && !tiles.includes(tile)) tiles.push(tile)
      }
    }
  }

  shadowCamera.updateProjectionMatrix()
  directionalLight.shadow.bias = -SHADOW_DEPTH_BIAS / (shadowCamera.far - shadowCamera.near)

  groundShadow.update(tiles)
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
//
// onRunway looks at every wheel that is touching the ground, not just the
// lowest one - a touchdown with one main wheel on the runway and the other
// in the grass beside it is not a landing on the runway.
function evaluateLandingConditions() {
  const wheels = landingGearRig?.wheels
  let closestWheelClearance = Infinity
  let touchingWheels = 0
  let touchingWheelsOnRunway = 0

  if (wheels) {
    for (const wheel of [wheels.nose, wheels.left, wheels.right]) {
      if (!wheel) continue

      const clearance = terrainClearanceBelow(wheel.getWorldPosition(wheelWorldPosition))
      if (clearance === null) continue

      closestWheelClearance = Math.min(closestWheelClearance, clearance)

      if (clearance < SimulationConstants.GEAR_CONTACT_CLEARANCE) {
        touchingWheels++
        if (isPositionOnRunway(wheelWorldPosition)) touchingWheelsOnRunway++
      }
    }
  }

  return {
    hasWheels: !!wheels,
    closestWheelClearance,
    wheelsNearGround: touchingWheels > 0,
    gearDown,
    sinkRate: airplaneState.sinkRate, // ft/min, positive = descending
    bank: Math.abs(airplaneState.phi * SimulationConstants.RTOD), // deg
    onRunway: touchingWheels > 0 && touchingWheelsOnRunway === touchingWheels,
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
    reasons.push(
      `sink rate too high (${status.sinkRate.toFixed(1)} ft/min, max ${SimulationConstants.MAX_SAFE_SINK_RATE})`,
    )
  }
  if (status.bank >= SimulationConstants.MAX_SAFE_BANK) {
    reasons.push(`bank too steep (${status.bank.toFixed(1)} deg, max ${SimulationConstants.MAX_SAFE_BANK})`)
  }
  if (!status.onRunway) reasons.push("a wheel is not on a mapped runway")

  return reasons
}

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
  } else if (onGround && !status.onRunway) {
    // Down and rolling, but a wheel has left the runway - off its end or
    // side, into the grass or the sea. The runway polygons are the only
    // ground that's mapped as safe to roll on, so this is a crash too.
    console.log("Crash: ran off the runway")
    document.location.href = "collision.html"
    return
  }

  // the aircraft's own position (its centre of gravity), meters - not the
  // cockpit camera's, which sits at the pilot's eyes, several meters ahead
  // of and above it
  aircraftPosition.set(
    airplaneState.epos * SimulationConstants.FEET_TO_METERS,
    airplaneState.npos * SimulationConstants.FEET_TO_METERS,
    airplaneState.alt * SimulationConstants.FEET_TO_METERS,
  )

  // get the coordinates of the tile surrounding the aircraft
  const tileXOffset = (aircraftPosition.x - MINX) % TILE_EXTENTS
  const x = Math.round(aircraftPosition.x - tileXOffset)

  const tileYOffset = (aircraftPosition.y - MINY) % TILE_EXTENTS
  const y = Math.round(aircraftPosition.y - tileYOffset)

  // get the tile
  const tile = terrain.tiles.get(`${x}-${y}`)
  if (tile?.loaded && tile.tileMesh.geometry.boundsTree) {
    const tileGeometry = tile.tileMesh.geometry

    // set ray origin to the aircraft position
    // use relative coordinates inside the tile to match the geometry's coordinates
    // and convert from z up to y up
    interSectionRay.origin.set(tileXOffset, aircraftPosition.z, -tileYOffset)

    // cast a ray from the aircraft position and straight down towards the terrain
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
      f16simulation.landingGearModel.groundAlt =
        (aircraftPosition.z - hit.distance) * SimulationConstants.METERS_TO_FEET
    }

    // No ground found at all directly below the aircraft - off the edge of
    // loaded terrain, or already under the mesh - is always a crash,
    // whatever state the landing gear is in.
    if (!hit) {
      console.log(
        "Crash: no terrain found directly below the aircraft (off the edge of loaded terrain, or already under the surface)",
      )
      document.location.href = "collision.html"
      return
    }

    // The distance-from-aircraft "too low" check below is a coarse backstop
    // for when there's no wheel telemetry yet (landingGearRig hasn't
    // loaded) - once there is, the wheel-based check above already covers
    // this, more precisely (GEAR_CONTACT_CLEARANCE, not an arbitrary 4 m)
    // and more completely (three sample points under nose and both main
    // gear, not one under the aircraft). Left as-is here, this threshold is
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

  airplaneControlInput.normalizeControls(frameTime * 0.001, isTaxiing())

  physicsTimeDebt += frameTime * 0.001

  let steps = 0
  while (physicsTimeDebt >= PHYSICS_STEP && steps < MAX_PHYSICS_STEPS) {
    // run physics simulation loop until it is ajour
    flightControlSystem.update(
      airplaneControlInput,
      airplaneState,
      PHYSICS_STEP,
      f16simulation.landingGearModel.weightOnWheels,
    )
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
  const strutTravel = f16simulation.landingGearModel.strutTravel(renderState)
  for (const leg in strutTravel) strutTravel[leg] *= SimulationConstants.FEET_TO_METERS
  landingGearRig?.update(controlActuators.gear, controlActuators.noseSteer, strutTravel)

  if (hudPlane.visible) {
    hud.update(
      renderState,
      airplaneControlInput,
      f16simulation.atmosphericModel,
      compassOffset,
      f16simulation.landingGearModel.weightOnWheels,
    )
    hud.draw()
    hudTexture.needsUpdate = true
  }

  // always update master camera - at the pilot's eyes, not at the aircraft's
  // own reference point (its centre of gravity)
  cameras[0].position.copy(EYE_POSITION).applyQuaternion(f16.quaternion).add(f16.position)
  cameras[0].quaternion.copy(f16.quaternion)
  cameras[0].rotateX(90 * MathUtils.DEG2RAD)
  updateCockpitLook(frameTime * 0.001)
  cameras[0].rotateY(cockpitLook.yaw * MathUtils.DEG2RAD)

  // keep the shadow camera centered on the aircraft
  directionalLight.target.position.copy(f16.position)
  directionalLight.position.copy(f16.position).addScaledVector(LIGHT_DIRECTION, SHADOW_LIGHT_DISTANCE)
  hemisphereLight.position.copy(f16.position).add(UP)
  updateGroundShadow()

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

  // render the aircraft relative to its own position (see aircraftScene).
  // The view from aircraftCamera is identical to the active camera's, so
  // the depth buffer from the first pass still lines up with it.
  aircraftScene.position.copy(f16.position).negate()
  aircraftCamera.copy(cameras[currentCamera], false)
  aircraftCamera.position.sub(f16.position)

  const inCockpit = currentCamera === 0
  for (const part of cockpitHiddenParts) part.visible = !inCockpit
  for (const part of cockpitUnshadowedParts) part.receiveShadow = !inCockpit
  paintCockpitInterior(inCockpit)

  renderer.render(aircraftScene, aircraftCamera)

  // From the cockpit, much of the airframe in view - the canopy frame, the
  // HUD glass - is closer than the near plane the pass above shares with
  // the terrain, and was clipped away. So it is drawn again on top, with
  // a camera that clips much closer. Its depth range doesn't match the
  // terrain's, so the depth buffer is cleared first - which is fine, as
  // nothing outside can be in front of the airframe seen from inside it.
  // The ground shadow is left out of this pass: it needs the terrain's
  // depth, and was already drawn in the pass above. The shadow map from
  // that pass is reused, so the self-shadowing stays the same.
  if (inCockpit) {
    renderer.clearDepth()

    aircraftCamera.near = COCKPIT_NEAR
    aircraftCamera.far = COCKPIT_FAR
    aircraftCamera.updateProjectionMatrix()

    groundShadow.hide()
    renderer.shadowMap.autoUpdate = false

    // larger shadow biases close up - see COCKPIT_SHADOW_NORMAL_BIAS
    const shadow = directionalLight.shadow
    const bias = shadow.bias
    shadow.bias = -COCKPIT_SHADOW_DEPTH_BIAS / (shadow.camera.far - shadow.camera.near)
    shadow.normalBias = COCKPIT_SHADOW_NORMAL_BIAS

    renderer.render(aircraftScene, aircraftCamera)

    shadow.bias = bias
    shadow.normalBias = SHADOW_NORMAL_BIAS
    renderer.shadowMap.autoUpdate = true
  }

  // put the aircraft back in world coordinates, for everything outside
  // rendering that reads its world transform (wheel ground contact etc.)
  aircraftScene.position.set(0, 0, 0)
  aircraftScene.updateMatrixWorld()

  if (hudPlane.visible) {
    renderer.clearDepth()
    // the cockpit camera's view, but clipping closer than its 1 m near plane,
    // which the HUD panel is well inside
    hudCamera.fov = cameras[0].fov
    hudCamera.aspect = cameras[0].aspect
    hudCamera.near = COCKPIT_NEAR
    hudCamera.far = COCKPIT_FAR
    hudCamera.updateProjectionMatrix()
    hudCamera.quaternion.setFromAxisAngle(HUD_LOOK_AXIS, cockpitLook.yaw * MathUtils.DEG2RAD)
    renderer.render(hudScene, hudCamera)
  }
}

function getCompassOffset(east, north) {
  // https://gis.stackexchange.com/questions/115531/calculating-grid-convergence-true-north-to-grid-north

  const lonlat = proj4(UTM33N_PROJECTION).inverse([east, north])
  const lonDelta = lonlat[0] - UTM33N_CENTRAL_MERIDIAN

  return Math.atan(Math.tan(lonDelta * MathUtils.DEG2RAD) * Math.sin(lonlat[1] * MathUtils.DEG2RAD)) * MathUtils.RAD2DEG
}

async function downloadWindData(lonlat) {
  // https://api.met.no/doc/

  const weatherAPI = "https://api.met.no/weatherapi/nowcast/2.0/complete"
  const weatherURL = `${weatherAPI}?lat=${lonlat[1].toFixed(3)}&lon=${lonlat[0].toFixed(3)}`

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

    // speeds are reported in m/s and the flight model works in ft/s
    const speed = wind_speed * SimulationConstants.METERS_TO_FEET
    const gust = (wind_speed_of_gust ?? wind_speed) * SimulationConstants.METERS_TO_FEET

    // a wind direction is the direction the wind comes from, so the direction it
    // blows towards - which is what a velocity needs - is the opposite one
    const heading = (wind_from_direction + 180) * MathUtils.DEG2RAD

    return {
      altitude: 0, // the surface wind
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
const NOSE_GEAR_NAMES = [
  "F-16_chassesFront1_LOD0_4",
  "F-16_chassesFront2_LOD0_5",
  "F-16_chassesFront3_LOD0_6",
  "F-16_whel_LOD0_36",
  "F-16_capFlont_LOD0_1",
]
const NOSE_GEAR_OFFSET = [0, 0, -0.02]

// The main gear is placed to match the real F-16's 4.00 m wheelbase and
// 2.36 m track, which puts the wheels just aft of the CG like on the real
// aircraft. The legs are moved out sideways to get that track; the doors
// only move aft, as they are already placed against the belly.
const MAIN_GEAR_LEFT_LEG_NAMES = [
  "F-16_chassesL1_LOD0_7",
  "F-16_chassesL2_LOD0_8",
  "F-16_chassesL3_LOD0_9",
  "F-16_chassesL4_LOD0_10",
  "F-16_whelL_LOD0_37",
]
const MAIN_GEAR_RIGHT_LEG_NAMES = [
  "F-16_chassesR1_LOD0_11",
  "F-16_chassesR2_LOD0_12",
  "F-16_chassesR3_LOD0_13",
  "F-16_chassesR4_LOD0_14",
  "F-16_whelR_LOD0_38",
]
const MAIN_GEAR_DOOR_NAMES = ["F-16_capL_LOD0_2", "F-16_capR_LOD0_3"]
const MAIN_GEAR_OFFSET = [0, -0.04, -0.02]
const MAIN_GEAR_TRACK_OFFSET = 0.07

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

          separateHudSidePanels(object)
          tonePaintSheen(object)
          colourCockpitInterior(object)
          separateCockpitSurroundings(object)
          enableShadows(object)
          f16.add(object)
          controlSurfaceRig = new ControlSurfaceRig(object)
          cockpitHiddenParts = COCKPIT_HIDDEN_PARTS.map((name) => object.getObjectByName(name)).filter(Boolean)
          cockpitUnshadowedParts = COCKPIT_UNSHADOWED_PARTS.map((name) => object.getObjectByName(name)).filter(Boolean)
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

      enableShadows(object)
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
      nudge(MAIN_GEAR_LEFT_LEG_NAMES, [-MAIN_GEAR_TRACK_OFFSET, MAIN_GEAR_OFFSET[1], MAIN_GEAR_OFFSET[2]])
      nudge(MAIN_GEAR_RIGHT_LEG_NAMES, [MAIN_GEAR_TRACK_OFFSET, MAIN_GEAR_OFFSET[1], MAIN_GEAR_OFFSET[2]])
      nudge(MAIN_GEAR_DOOR_NAMES, MAIN_GEAR_OFFSET)

      landingGearRig = new LandingGearRig(object)
      tintGearToMatchBody(object)
    },
    (xhr) => {},
    (error) => {
      console.log("Could not load landing gear model: " + error)
    },
  )
}

// The two side panels either side of the HUD glass are part of the fuselage
// mesh (LOD0) in the model, so they can't be hidden on their own - this moves
// them into a mesh of their own, HUD_SidePanels, which the cockpit view hides
// (see COCKPIT_HIDDEN_PARTS). They are the triangles that lie entirely inside
// this box, meters in the aircraft frame (x right, y forward, z up, from the
// centre of gravity) - two thin vertical plates, 0.10 to 0.14 m either side
// of the centreline. Nothing else on the fuselage falls inside it.
const HUD_SIDE_PANELS_BOX = { minAbsX: 0.09, maxAbsX: 0.15, minY: 5.79, maxY: 6.13, minZ: 0.58, maxZ: 0.88 }

function separateHudSidePanels(object) {
  const fuselage = object.getObjectByName("LOD0")
  if (!fuselage) return

  const box = HUD_SIDE_PANELS_BOX
  const inside = (vertices) =>
    vertices.every(
      (p) =>
        Math.abs(p.x) >= box.minAbsX &&
        Math.abs(p.x) <= box.maxAbsX &&
        p.y >= box.minY &&
        p.y <= box.maxY &&
        p.z >= box.minZ &&
        p.z <= box.maxZ,
    )

  // the model's own vertices, taken into the aircraft frame
  object.updateMatrix()
  fuselage.updateMatrix()
  const frame = object.matrix.clone().multiply(fuselage.matrix)

  splitOffTriangles(fuselage, "HUD_SidePanels", frame, inside)
}

// The model's airframe material (Body in f16.mtl) has a strong and very
// broad specular highlight - Ks 0.75 with Ns 8 - which spreads a reflection
// of the sunlight over large parts of the airframe, tinting them with the
// sun's colour from the cameras looking towards it. The F-16's grey paint is
// matte, so it gets a faint, tighter sheen instead. Done before the cockpit interior is split off, which shares this
// material in the exterior views.
const PAINT_SPECULAR = 0x1a1a1a
const PAINT_SHININESS = 20

function tonePaintSheen(object) {
  object.traverse((child) => {
    if (!child.isMesh) return
    for (const material of [child.material].flat()) {
      if (material.name !== "Body") continue
      material.specular.set(PAINT_SPECULAR)
      material.shininess = PAINT_SHININESS
    }
  })
}

// Seen from the cockpit, the cockpit interior is painted grey - the
// exterior views keep the model's own look. The model has no cockpit of its
// own - the cockpit tub (floor, side walls, consoles, instrument panel, glare
// shield) is part of the fuselage mesh, with the same texture as the outside
// of the aircraft - so it is split off into a mesh of its own, together with
// the inside faces of the canopy frame, and those get the grey material only
// while the cockpit camera is drawing.
//
// The cockpit tub is the fuselage triangles lying entirely inside this box,
// meters in the aircraft frame (x right, y forward, z up, from the centre of
// gravity): under the canopy, and above the intake and nose gear structure
// below the cockpit floor. The cockpit rim the canopy rails sit on is left as
// it is, like the rails themselves.
const COCKPIT_TUB_BOX = { maxAbsX: 0.46, minY: 4.05, maxY: 6.65, minZ: -0.5, maxZ: 0.75 }
const COCKPIT_INTERIOR_COLOUR = 0x7a7a7a

const cockpitInteriorMaterial = new MeshPhongMaterial({
  color: COCKPIT_INTERIOR_COLOUR,
  specular: 0x111111,
  shininess: 10,
})

// the cockpit interior parts, with the material each has in the exterior views
let cockpitInteriorParts = []

// gives the cockpit interior its grey for the cockpit view, or its own
// material back for the exterior views
function paintCockpitInterior(inCockpit) {
  for (const { mesh, exteriorMaterial } of cockpitInteriorParts) {
    mesh.material = inCockpit ? cockpitInteriorMaterial : exteriorMaterial
  }
}

function colourCockpitInterior(object) {
  object.updateMatrix()
  const frameOf = (mesh) => {
    mesh.updateMatrix()
    return object.matrix.clone().multiply(mesh.matrix)
  }

  const fuselage = object.getObjectByName("LOD0")
  if (fuselage) {
    const box = COCKPIT_TUB_BOX
    const inTub = (vertices) =>
      vertices.every(
        (p) =>
          Math.abs(p.x) <= box.maxAbsX && p.y >= box.minY && p.y <= box.maxY && p.z >= box.minZ && p.z <= box.maxZ,
      )

    const tub = splitOffTriangles(fuselage, "Cockpit_Interior", frameOf(fuselage), inTub)
    if (tub) cockpitInteriorParts.push({ mesh: tub, exteriorMaterial: tub.material })
  }

  // the canopy frame's inside faces are the ones facing the pilot's eyes
  const canopyFrame = object.getObjectByName("Canopy01")
  if (canopyFrame) {
    const triangle = new Triangle()
    const normal = new Vector3()
    const centre = new Vector3()
    const facingEye = (vertices) => {
      triangle.set(...vertices)
      triangle.getNormal(normal)
      triangle.getMidpoint(centre)
      return normal.dot(centre.sub(EYE_POSITION).negate()) > 0
    }

    const inside = splitOffTriangles(canopyFrame, "Canopy_Inside", frameOf(canopyFrame), facingEye)
    if (inside) cockpitInteriorParts.push({ mesh: inside, exteriorMaterial: inside.material })
  }
}

// The fuselage around the canopy - every triangle entirely within this
// distance of the pilot's eyes, meters - is moved into a mesh of its own,
// Cockpit_Surroundings, so the cockpit view can switch off its self-shadows
// (see COCKPIT_UNSHADOWED_PARTS). Beyond it, a shadow map texel only covers
// a few pixels, and the self-shadows hold still.
const COCKPIT_UNSHADOWED_RADIUS = 2.5

function separateCockpitSurroundings(object) {
  const fuselage = object.getObjectByName("LOD0")
  if (!fuselage) return

  object.updateMatrix()
  fuselage.updateMatrix()
  const frame = object.matrix.clone().multiply(fuselage.matrix)

  const nearEye = (vertices) => vertices.every((p) => p.distanceTo(EYE_POSITION) <= COCKPIT_UNSHADOWED_RADIUS)
  splitOffTriangles(fuselage, "Cockpit_Surroundings", frame, nearEye)
}

// the canopy glass is see-through, so it receives shadows but doesn't cast
// any - otherwise the whole cockpit would sit in the canopy's shadow
function enableShadows(object) {
  object.traverse((child) => {
    if (child.isMesh) {
      const materials = Array.isArray(child.material) ? child.material : [child.material]
      child.castShadow = !materials.some((material) => material.transparent || material.name === "Glass")
      child.receiveShadow = true
    }
  })
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
  // the HUD only belongs in the cockpit - the airframe shows from every view
  hudPlane.visible = currentCamera === 0
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
    case "s": // throttle straight to idle, like pulling the lever back in one go
      airplaneControlInput.targetThrottle = SimulationConstants.THROTTLE_MIN
      airplaneControlInput.throttle = SimulationConstants.THROTTLE_MIN
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
    case "z": // left pedal, yaw left - and nosewheel steering on the ground
      movePedal(-1)
      break
    case "x": // right pedal, yaw right
      movePedal(1)
      break
    case "j": // cockpit: turn the view left - external cam: left
      if (lookFromCockpit("j")) break
      externalCameraPosition.compassSpeed -= EXTERNAL_CAMERA_SLEW_STEP
      break
    case "l": // cockpit: turn the view right - external cam: right
      if (lookFromCockpit("l")) break
      externalCameraPosition.compassSpeed += EXTERNAL_CAMERA_SLEW_STEP
      break
    case "i": // cockpit: look straight ahead - external cam: up
      if (lookFromCockpit("i")) break
      externalCameraPosition.inclination -= 2
      break
    case "k": // cockpit: look back - external cam: down
      if (lookFromCockpit("k")) break
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
    case "b": // wheel brakes - full pressure while the key is held, see keyUpHandler
      airplaneControlInput.brake = 1
      break
  }
}

// Taxiing, the pedals steer the nosewheel, and a tap there should turn it
// noticeably - the fine steps that suit rudder in the air would move it
// only a fraction of a degree at taxi speed. The pedals don't centre by
// themselves while taxiing (see InputVector.normalizeControls), so the taxi
// steps snap to whole steps: tapping the other way always gets back to
// exactly straight ahead, whatever the pedals were left at before.
//
// Above taxi speed - on a take off or landing roll - the pedals behave as
// they do in the air: fine steps, centring by themselves. There the rudder
// is doing the steering, and a pedal that stays wherever a string of
// corrections left it soon ends up at full rudder, which at take off speeds
// slews the aircraft off the runway and can roll it over.
const GROUND_PEDAL_STEP = 0.1
const TAXI_SPEED_MAX_KT = 30

function isTaxiing() {
  return (
    f16simulation.landingGearModel.weightOnWheels &&
    airplaneState.vt * SimulationConstants.FEET_PER_SECOND_TO_KNOTS < TAXI_SPEED_MAX_KT
  )
}

function movePedal(direction) {
  if (isTaxiing()) {
    const steps = Math.round(airplaneControlInput.yawPedal / GROUND_PEDAL_STEP) + direction
    airplaneControlInput.yawPedal = steps * GROUND_PEDAL_STEP
  } else {
    airplaneControlInput.yawPedal += direction * STICK_STEP
  }
}

// Points the pilot's view for a look key, if the cockpit camera is selected:
// each press of j or l turns it 20 degrees further left or right, i turns it
// back to straight ahead, and k to straight back. Returns whether the key was
// used for that - in the other views the same keys move the external camera
// instead.
function lookFromCockpit(key) {
  if (currentCamera !== 0) return false

  // straight ahead and straight back are reached the shorter way round
  const yaw = cockpitLook.targetYaw
  switch (key) {
    case "j":
      cockpitLook.targetYaw = yaw + LOOK_STEP
      break
    case "l":
      cockpitLook.targetYaw = yaw - LOOK_STEP
      break
    case "i":
      cockpitLook.targetYaw = yaw - wrapDegrees(yaw)
      break
    case "k":
      cockpitLook.targetYaw = yaw + wrapDegrees(LOOK_BACK - yaw)
      break
  }
  return true
}

// glides the view towards where the pilot wants to look - easing in over
// LOOK_GLIDE_TIME, but never faster than LOOK_GLIDE_RATE_MAX
function updateCockpitLook(dt) {
  const remaining = cockpitLook.targetYaw - cockpitLook.yaw
  const step = remaining * (1 - Math.exp(-dt / LOOK_GLIDE_TIME))
  const maxStep = LOOK_GLIDE_RATE_MAX * dt

  cockpitLook.yaw += Math.max(-maxStep, Math.min(maxStep, step))
  if (Math.abs(cockpitLook.targetYaw - cockpitLook.yaw) < 0.01) cockpitLook.yaw = cockpitLook.targetYaw
}

function keyUpHandler(keyboardEvent) {
  switch (keyboardEvent.key) {
    case "b": // wheel brakes released
      airplaneControlInput.brake = 0
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
