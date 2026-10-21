import Tile from "./terrain/tile.js"
import Terrain from "./terrain/terrain.js"
import {
  WebGLRenderer,
  Scene,
  Color,
  FogExp2,
  ShaderChunk,
  DirectionalLight,
  HemisphereLight,
  LinearFilter,
  PerspectiveCamera,
  Object3D,
  PlaneGeometry,
  MeshBasicMaterial,
  CanvasTexture,
  Mesh,
  MathUtils,
  Ray,
  Vector2,
  Vector3,
  PCFShadowMap,
} from "three"
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js"
import StateVector from "./hifimodel/statevector.js"
import InputVector, { STICK_STEP, THROTTLE_STEP } from "./hifimodel/inputvector.js"
import F16Simulation from "./hifimodel/f16simulation.js"
import WindField from "./hifimodel/models/windfield.js"
import { boundaryLayerFactor } from "./hifimodel/models/windmodel.js"
import NowcastWind from "./weather/nowcast.js"
import FlightControlSystem from "./hifimodel/models/flightcontrolsystem.js"
import RungeKutta4 from "./hifimodel/integrator.js"
import ActuatorModel from "./hifimodel/models/actuatormodel.js"
import SimulationConstants from "./hifimodel/simulationconstants.js"
import ChaseObject from "./graphics/ChaseObject.js"
import GroundShadow from "./graphics/GroundShadow.js"
import { loadF16Model, EYE_POSITION as F16_EYE_POSITION } from "./graphics/f16Model.js"
import { MeshoptDecoder } from "./externals/meshopt_decoder.module"
import Gamepad from "./controller/gamepad.js"
import EngineSound from "./audio/enginesound.js"
import HUDObject from "./graphics/HUDObject.js"
import { sunPosition, twilight } from "./sky/sun.js"
import { sunTransmittance, haze, luminance, GROUND_ALBEDO } from "./sky/atmosphere.js"
import SkyDome from "./sky/SkyDome.js"
import { updateHorizonFog } from "./sky/horizonFog.js"
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
// logarithmic profile the steady wind follows too. It works out at about nine
// tenths of the reported speed.
const SURFACE_WIND_FACTOR = boundaryLayerFactor(20)

const KNOTS_PER_FOOT_PER_SECOND = 0.592484

// how often the surface wind under the aircraft is looked up for the turbulence
// model, and the wind field moved on in time, ms
const WIND_UPDATE_INTERVAL = 200

let physicsTimeDebt = 0

let currentCamera = 0
let compassOffset = 0
let heightAboveGround = 0

let gamepad = null
let engineSound = null
// the aircraft model, rigged - see graphics/f16Model.js
let f16Rig = null

// the pilot's commanded gear position - up/down, instant, exactly like a
// real gear handle - not the actual gear position. That's
// controlActuators.gear, rate-limited to a real transition time (see
// ActuatorModel's own comment) and what both the aerodynamic model's gear
// drag and the model's gear animation actually ride on. This one is
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
const MAX_PIXEL_RATIO = 1.5
const renderer = new WebGLRenderer({ canvas: canvas, antialias: true })
// Rendering at a high-density display's full resolution (2 on most Macs)
// costs much more than it shows, with antialiasing on - so at most this
renderer.setPixelRatio(Math.min(window.devicePixelRatio, MAX_PIXEL_RATIO))
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.shadowMap.enabled = true
// soft-edged: several samples spread over shadow.radius (three.js r186 on -
// PCFSoftShadowMap was folded into this)
renderer.shadowMap.type = PCFShadowMap
// the scene and the aircraft are drawn in two passes into the same buffers
// (see drawScene), which clears them itself before the first
renderer.autoClear = false

const hudCanvas = document.getElementById("hud")
const hud = new HUDObject(hudCanvas)

const scene = new Scene()

// the sky, drawn behind everything else - see updateSun. The terrain fades
// into the fog with distance, and the fog takes the horizon's colour: the
// colour of the horizon behind it, for the terrain (see horizonFog.js), and
// the horizon's averaged all round, for the aircraft.
const sky = new SkyDome()
scene.add(sky)
scene.fog = new FogExp2(sky.fogColor, haze(0))
// the sky's own colour, kept up to date by it as it changes
scene.fog.color = sky.fogColor

// The air dims what is seen through it exponentially with distance, by the
// same share for every kilometre, so three's FogExp2 - which thickens with
// the square of the distance - is made plain exponential here, for every
// material: density is then the share of light lost per meter. As FogExp2
// was, it hid the terrain thirty kilometres off almost completely, leaving
// distant mountains a flat white; through a clear day's air a quarter of
// their own colour still shows at fifty.
ShaderChunk.fog_fragment = ShaderChunk.fog_fragment.replace(
  "fogDensity * fogDensity * vFogDepth * vFogDepth",
  "fogDensity * vFogDepth",
)

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

// add lights to the scene, to propely display the f16 model. The sunlight
// has this colour with the sun SUNLIGHT_REFERENCE_ELEVATION degrees up, and
// is filtered from there by the atmosphere as the sun moves, and seen
// through the sky's exposure - see updateSun and sky.onUpdate, which also
// sets how strong it is. White, as the daylight the terrain's photos were
// taken in shows in them - a warm pinkish beige before, which tinted the
// sunlit side of the aircraft pink once it was lit as brightly as the
// terrain.
const SUNLIGHT_COLOR = new Color(0xffffff)
const directionalLight = new DirectionalLight(SUNLIGHT_COLOR, 1)
aircraftScene.add(directionalLight)
aircraftScene.add(directionalLight.target)

// only the aircraft casts shadows - onto itself and onto the ground (see
// GroundShadow) - so the shadow camera is a small box that follows the
// aircraft around, see drawScene. The box's sides just need to enclose the
// whole airframe (~15 m long, ~9.5 m wingspan) in any orientation, since
// the ground shadow is the airframe's own outline seen along the light. Its
// depth is stretched down to the ground each frame, for the ground shadow.
// The light comes from the sun, in sunDirection - towards it, in the
// scene's own frame (x east, y north, z up), kept up to date by updateSun.
const sunDirection = new Vector3(0, -0.2, 0.8).normalize()
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
// and only with the sun at least this high (sine of 5 degrees) - a lower
// sun casts the shadow kilometres away from the aircraft, and stretched out
// long and faint
const GROUND_SHADOW_MIN_SUN = Math.sin(5 * MathUtils.DEG2RAD)

directionalLight.castShadow = true
directionalLight.shadow.mapSize.set(2048, 2048)
directionalLight.shadow.camera.left = -SHADOW_EXTENT
directionalLight.shadow.camera.right = SHADOW_EXTENT
directionalLight.shadow.camera.top = SHADOW_EXTENT
directionalLight.shadow.camera.bottom = -SHADOW_EXTENT
directionalLight.shadow.camera.near = SHADOW_LIGHT_DISTANCE - SHADOW_EXTENT
directionalLight.shadow.camera.far = SHADOW_LIGHT_DISTANCE + SHADOW_EXTENT
directionalLight.shadow.normalBias = SHADOW_NORMAL_BIAS

// The light from all round that isn't the sun's: from the sky above, and
// from the sunlit ground below, in the hue of AMBIENT_COLOR. They follow the
// sky's own light and the ground's, so the underside of the aircraft darkens
// with the terrain at dusk, and the top takes on the sky's colour. See
// sky.onUpdate. Its "up" is the direction to it, so it is kept straight
// above the aircraft, as the sunlight is kept towards the sun - see
// drawScene.
const AMBIENT_COLOR = new Color(0xc7d4ed)
const ambientLight = new HemisphereLight(AMBIENT_COLOR, AMBIENT_COLOR, 1)
const UP = new Vector3(0, 0, 1)
aircraftScene.add(ambientLight)

const groundShadow = new GroundShadow(aircraftScene, GROUND_SHADOW_OPACITY)

// initialize cameras
const cameras = []

// main camera - internal view from cockpit
const camera = new PerspectiveCamera()
camera.up.set(0, 0, 1)
camera.fov = 65
camera.near = 1
camera.far = 50000

scene.add(camera)

cameras.push(camera)

// set up two secondary (external) cameras, derived from the main, with a
// narrower field of view
const EXTERNAL_CAMERA_FOV = 50
for (let i = 0; i < 2; i++) {
  const external = camera.clone()
  external.fov = EXTERNAL_CAMERA_FOV
  cameras.push(external)
}

const externalCameraPosition = {
  distance: 30,
  compass: 0,
  compassSpeed: 0,
  inclination: 90,
}

const EXTERNAL_CAMERA_SLEW_STEP = 4.8

// The pilot's eye point, meters, in the aircraft frame (x right, y forward,
// z up, from the centre of gravity) - the model's own, see F16_EYE_POSITION
// in graphics/f16Model.js. The cockpit camera sits here, looking along the
// aircraft's nose axis.
const EYE_POSITION = F16_EYE_POSITION.clone()

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

// Parts of the model hidden in the cockpit view, parts that don't receive
// the aircraft's own shadows there (so close to the eye that the shadows on
// them flicker), the cockpit interior's parts with the materials they are
// drawn with there and outside, and parts shown from the cockpit only - all
// from the model, see graphics/f16Model.js
let cockpitHiddenParts = []
let cockpitUnshadowedParts = []
let cockpitInteriorParts = []
let cockpitOnlyParts = []

const hudGeometry = new PlaneGeometry(1, 1)
const hudMaterial = new MeshBasicMaterial({ color: 0xffff00 })
const hudTexture = new CanvasTexture(hudCanvas)
// The HUD is seen at about its own size, so smaller versions of it would
// add nothing - and it is uploaded anew every frame, so they would all be
// made anew every frame too.
hudTexture.generateMipmaps = false
hudTexture.minFilter = LinearFilter
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
// them). It covers the same angle top to bottom as it always has: 1 m at
// 2.2 m, about 25.6 degrees - a flat panel seen from a camera at the eye
// looks exactly the same at any distance, as long as that angle stays the
// same. Across, it is as much wider as the HUD's canvas is, so the canvas's
// pixels cover the same angle both ways.
const HUD_DISTANCE = 0.625 // m
const HUD_FIELD_OF_VIEW = 2 * Math.atan(0.5 / 2.2) // radians, top to bottom
const HUD_SIZE = 2 * HUD_DISTANCE * Math.tan(HUD_FIELD_OF_VIEW / 2) // m, top to bottom
const HUD_ASPECT = hud.width / hud.height

// The HUD glass's bottom edge sits just above the airframe in front of the
// pilot - the glare shield and the nose - as seen from EYE_POSITION, so the
// HUD's contents never show on top of it. Where that is depends on the eye
// position and the model, so it is measured from the model once it has
// loaded (see placeHudAboveAirframe); until then, this. Degrees below the
// line of sight straight ahead.
const HUD_BOTTOM_ELEVATION_DEFAULT = -15
const HUD_CLEARANCE = 0.3 // degrees between the airframe and the glass

const hudPlane = new Mesh(hudGeometry, hudMaterial)
hudPlane.scale.set(HUD_SIZE * HUD_ASPECT, HUD_SIZE, 1)
hudScene.add(hudPlane)

// Moves the HUD glass up or down so its bottom edge is at bottomElevation
// (degrees from the line of sight), and has the HUD draw its symbology to
// match. The panel stays square on to the line of sight, so its contents
// stay lined up with the world outside wherever it is.
function placeHud(bottomElevation) {
  const centreHeight = HUD_DISTANCE * Math.tan(bottomElevation * MathUtils.DEG2RAD) + HUD_SIZE / 2 // m
  hudPlane.position.set(0, centreHeight, -HUD_DISTANCE)
  hud.setGeometry(HUD_FIELD_OF_VIEW, centreHeight / HUD_DISTANCE)
}

placeHud(HUD_BOTTOM_ELEVATION_DEFAULT)

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

// the grid convergence at the start point, until it is next updated below -
// without it the HUD heading is off by it for the first minute
compassOffset = startPoint[3]

const terrain = new Terrain(scene, MINX, MINY, MAXX, MAXY, renderer)

// set up physics simulation, flying in a surface wind read from the forecast at
// the corners of the terrain tiles
const windField = new WindField(TILE_EXTENTS, MINX, MINY)
const f16simulation = new F16Simulation(windField)
const airplaneState = new StateVector()
airplaneState.init(startPoint, startDirection)

// the ray cast that measures this has not run yet, so until it does, assume the
// terrain below the start point is at sea level. the turbulence model needs a
// height from the first step onwards, and it scales its eddies by it.
heightAboveGround = startPoint[2]

// Time of day, for the sun. It follows the real clock, unless a moment is
// given in the `time` url parameter - anything Date understands, such as
// 2026-06-21T22:30 in the browser's own time zone, or 2026-06-21T22:30+02:00
// in another - and the n and m keys step it back and forth. Kept as an
// offset from the clock, so time still passes while flying.
//
// Started on the clock, it starts in daylight: no earlier than dawn, and no
// later than DAYLIGHT_LEFT before dusk, so there is light to fly in for a
// while - see daylightStart. A time given in the url is kept as it is.
const TIME_STEP = 15 * 60 * 1000 // ms, per press of n or m
const DAYLIGHT_LEFT = 60 * 60 * 1000 // ms
const startTime = new Date(urlParams.get("time"))
let timeOffset =
  urlParams.has("time") && !isNaN(startTime)
    ? startTime.getTime() - Date.now()
    : daylightStart(new Date(), startPoint[4][1], startPoint[4][0]).getTime() - Date.now()

// the moment given, moved forward to dawn if it is before it, or back to
// DAYLIGHT_LEFT before dusk if it is after that, on its day at lat, lon
function daylightStart(date, lat, lon) {
  const { dawn, dusk } = twilight(date, lat, lon)
  if (dawn && date < dawn) return dawn
  if (dusk && date.getTime() > dusk.getTime() - DAYLIGHT_LEFT) return new Date(dusk.getTime() - DAYLIGHT_LEFT)
  return date
}

// the atmosphere's filtering of the sunlight at the elevation where it has
// SUNLIGHT_COLOR as it is - see updateSun
const SUNLIGHT_REFERENCE_ELEVATION = 40
const SUNLIGHT_REFERENCE = sunTransmittance(SUNLIGHT_REFERENCE_ELEVATION)
const sunlightFilter = new Color()

// Points the sunlight at where the sun is in the sky above the aircraft right
// now, and gives it the colour of what gets through the atmosphere from
// there: reddened and dimmed with the sun low, and gone once it has set -
// and has the sky, and the fog, take on the colours of that time of day.
// The sun moves a quarter of a degree a minute, so this runs once a second
// rather than every frame.
function updateSun() {
  const east = airplaneState.epos * SimulationConstants.FEET_TO_METERS
  const north = airplaneState.npos * SimulationConstants.FEET_TO_METERS
  const altitude = airplaneState.alt * SimulationConstants.FEET_TO_METERS

  const [lon, lat] = proj4(UTM33N_PROJECTION).inverse([east, north])
  const sun = sunPosition(new Date(Date.now() + timeOffset), lat, lon)

  // the azimuth is from true north, while the scene's y axis points to
  // grid north - a few degrees apart away from the zone's central meridian
  const azimuth = (sun.azimuth - getCompassOffset(east, north)) * MathUtils.DEG2RAD
  const elevation = sun.elevation * MathUtils.DEG2RAD
  sunDirection.set(
    Math.sin(azimuth) * Math.cos(elevation),
    Math.cos(azimuth) * Math.cos(elevation),
    Math.sin(elevation),
  )

  // seen from the aircraft's own height, so the sun sets later up high
  const transmittance = sunTransmittance(sun.elevation, altitude)
  sunlightFilter.setRGB(...transmittance.map((t, i) => t / SUNLIGHT_REFERENCE[i]))
  directionalLight.color.copy(SUNLIGHT_COLOR).multiply(sunlightFilter)
  // the intensity follows the sky's exposure - see updateLight

  // a shadow is only as dark as the sunlight it holds back is strong
  groundShadow.material.opacity = GROUND_SHADOW_OPACITY * Math.min(1, sunlightFilter.g)

  sky.update(sunDirection, sun.elevation, altitude)

  // as thick as the air halfway down from the aircraft to sea level, a
  // rough middle of the air between it and the terrain it sees in the
  // distance - thinner the higher it flies, above most of the haze
  scene.fog.density = haze(altitude / 2)

  return sun
}

// Once the sky has caught up with the sun (see updateSun), lights the rest
// to match, all seen through the sky's own exposure: the terrain by the
// light falling on the ground - which also takes it from the daylight its
// photos were taken in to the light of the time of day - and the aircraft by
// the sunlight, the sky above and the ground below.
//
// The aircraft's lights are as strong as it takes for it to match the
// terrain: a surface of it lit as the ground was when the photos were taken
// shows its own colours as brightly as the photos show theirs. three's
// lighting divides by pi (a white surface facing a light of intensity 1
// shows 1 / pi of it), and the photos' daylight is mostly the sun's - so
// the sunlight comes out around 4, and the sky's and the ground's light
// below 0.5, each over the luminance of its colour. Set by hand, at 1.5 and
// 0.8, the aircraft came out several times darker than the terrain around
// it, though its grey paint is lighter than the forest and rock below.
//
// The terrain is lit as level ground, which a low sun only grazes, so it
// dims with the sun's height - while a side of the aircraft facing a low sun
// takes it almost head on, and came out several times brighter than the
// terrain below. So the sunlight on the aircraft dims with the sun's height
// the same way: by how much less of it level ground gets than with the sun
// at SUNLIGHT_REFERENCE_ELEVATION.
sky.onUpdate = () => {
  Tile.light.setRGB(...sky.groundLight)
  for (const part of cockpitInteriorParts) {
    if (!part.flatMaterial) continue
    if (part.flatTint) part.flatMaterial.color.copy(part.flatTint).multiplyScalar(luminance(sky.groundLight))
    else part.flatMaterial.color.setScalar(luminance(sky.groundLight))
  }
  updateHorizonFog(sky.horizonColors, sky.sunDirection)

  const daylight = luminance(sky.referenceGroundLight)
  const sunlight = (Math.PI * luminance(SUNLIGHT_REFERENCE)) / daylight
  const skylight = (Math.PI * luminance(sky.referenceSkyLight)) / daylight
  const groundLight = Math.PI * GROUND_ALBEDO

  const sunHeight =
    Math.max(0, Math.sin(sky.sunElevation * MathUtils.DEG2RAD)) /
    Math.sin(SUNLIGHT_REFERENCE_ELEVATION * MathUtils.DEG2RAD)

  directionalLight.intensity = (sunlight / luminance(SUNLIGHT_COLOR.toArray())) * sky.adaptation * sunHeight
  ambientLight.color
    .copy(AMBIENT_COLOR)
    .multiply(lightShare.setRGB(...sky.skyLight))
    .multiplyScalar(skylight / luminance(AMBIENT_COLOR.toArray()))
  ambientLight.groundColor
    .copy(AMBIENT_COLOR)
    .multiply(lightShare.setRGB(...sky.groundLight))
    .multiplyScalar(groundLight / luminance(AMBIENT_COLOR.toArray()))
}
const lightShare = new Color()

function logSun() {
  const sun = updateSun()
  console.log(
    "Time: %s - sun at azimuth %d, elevation %s degrees",
    new Date(Date.now() + timeOffset).toString(),
    Math.round(sun.azimuth),
    sun.elevation.toFixed(1),
  )
}

logSun()
setInterval(updateSun, 1000)

// Fly in the real weather: ask MET what the wind is doing over the start point,
// and then, a corner at a time and a few seconds apart, at the corners of the
// terrain tiles around the aircraft - see nowcast.js. The forecast only has the
// wind near the ground, so that is the surface wind, and the wind model works
// out the wind higher up from it. Deliberately not awaited: the simulation
// starts on the default weather and picks the real one up a moment later, and
// carries on with the default if the service cannot be reached.
const nowcastWind = new NowcastWind(
  windField,
  (x, y) => proj4(UTM33N_PROJECTION).inverse([x, y]),
  () => [
    airplaneState.epos * SimulationConstants.FEET_TO_METERS,
    airplaneState.npos * SimulationConstants.FEET_TO_METERS,
  ],
)

nowcastWind.start(startPoint[0], startPoint[1]).then((wind) => {
  if (!wind) return

  console.log(
    "Surface wind: %d knots from %d degrees, gusting %d",
    Math.round(wind.speed * KNOTS_PER_FOOT_PER_SECOND),
    Math.round(wind.direction),
    Math.round(wind.gust * KNOTS_PER_FOOT_PER_SECOND),
  )
})

// The surface wind changes as the aircraft moves, and as more of it is read, so
// the turbulence down low is kept following the wind under the aircraft. Five
// times a second is plenty: across a tile the wind changes over kilometres.
setInterval(() => {
  if (paused || !windField.ready) return

  const x = airplaneState.epos * SimulationConstants.FEET_TO_METERS
  const y = airplaneState.npos * SimulationConstants.FEET_TO_METERS

  windField.update(x, y, WIND_UPDATE_INTERVAL * 0.001)

  const surface = windField.surfaceWind(x, y)
  f16simulation.turbulenceModel.setSurfaceWind(
    Math.hypot(surface.east, surface.north) * SURFACE_WIND_FACTOR,
    surface.gustSpread,
  )
}, WIND_UPDATE_INTERVAL)

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

// where on the ground (scene x and y) the aircraft's shadow is
const groundShadowCenter = new Vector2()

// stretch the shadow camera down to the ground below the aircraft, and
// pick the terrain tiles its shadow falls on
function updateGroundShadow() {
  const shadowCamera = directionalLight.shadow.camera
  const tiles = []
  let reach = 0

  shadowCamera.far = SHADOW_LIGHT_DISTANCE + SHADOW_EXTENT

  if (heightAboveGround < MAX_GROUND_SHADOW_HEIGHT && sunDirection.z > GROUND_SHADOW_MIN_SUN) {
    // distance along the light from the aircraft down to the ground
    const groundDistance = heightAboveGround / sunDirection.z
    shadowCamera.far += groundDistance + GROUND_SHADOW_MARGIN

    // the shadow's center on the ground, and how far from there it can
    // fall: the shadow box's footprint, stretched out along the sun's
    // direction the lower the sun is, and moved along it by ground up to
    // GROUND_SHADOW_MARGIN higher or lower than the ground under the
    // aircraft. Then the tiles under the corners of that.
    groundShadowCenter.set(f16.position.x - sunDirection.x * groundDistance, f16.position.y - sunDirection.y * groundDistance)
    const centerX = groundShadowCenter.x
    const centerY = groundShadowCenter.y
    const across = Math.hypot(sunDirection.x, sunDirection.y)
    reach = SHADOW_EXTENT * (1 + 1 / sunDirection.z) + (GROUND_SHADOW_MARGIN * across) / sunDirection.z

    for (const dx of [-reach, reach]) {
      for (const dy of [-reach, reach]) {
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

  groundShadow.update(tiles, groundShadowCenter, reach)
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
// The wheels checked are where they are with the gear extended, whether it
// is down or not (see WHEEL_CENTRES in graphics/f16Model.js); that's what
// lets a gear-up approach still read as "close to the ground" here without
// it being mistaken for a real touch anywhere this is used.
//
// onRunway looks at every wheel that is touching the ground, not just the
// lowest one - a touchdown with one main wheel on the runway and the other
// in the grass beside it is not a landing on the runway.
function evaluateLandingConditions() {
  const wheels = f16Rig?.wheels
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
    // for when there's no wheel telemetry yet (the model hasn't
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
      f16simulation.landingGearModel.weightOnAllWheels,
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
  f16Rig?.setControls(controlActuators)

  // controlActuators.gear is the same rate-limited 0..1 actuator position
  // the aerodynamic model's gear drag already rides on (see
  // ActuatorModel's own comment) - passing it straight through here is
  // what gives the visual gear a real transition instead of a snap toggle
  const strutTravel = f16simulation.landingGearModel.strutTravel(renderState)
  for (const leg in strutTravel) strutTravel[leg] *= SimulationConstants.FEET_TO_METERS
  f16Rig?.update(controlActuators.gear, controlActuators.noseSteer, strutTravel)

  if (hudPlane.visible) {
    hud.update(
      renderState,
      airplaneControlInput,
      f16simulation.atmosphericModel,
      compassOffset,
      f16simulation.landingGearModel.weightOnWheels,
      gearDown,
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
  directionalLight.position.copy(f16.position).addScaledVector(sunDirection, SHADOW_LIGHT_DISTANCE)
  ambientLight.position.copy(f16.position).add(UP)
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
  f16Rig?.setEngine(renderState.pow, sky.adaptation)

  renderer.clear()
  renderer.render(scene, cameras[currentCamera])

  // render the aircraft relative to its own position (see aircraftScene).
  // The view from aircraftCamera is identical to the active camera's, so
  // the depth buffer from the first pass still lines up with it.
  aircraftScene.position.copy(f16.position).negate()
  aircraftCamera.copy(cameras[currentCamera], false)
  aircraftCamera.position.sub(f16.position)

  const inCockpit = currentCamera === 0
  for (const part of cockpitHiddenParts) part.visible = !inCockpit
  for (const part of cockpitOnlyParts) part.visible = inCockpit
  for (const part of cockpitUnshadowedParts) part.receiveShadow = !inCockpit
  paintCockpitInterior(inCockpit, inCockpit && Math.abs(wrapDegrees(cockpitLook.yaw)) < COCKPIT_INTERIOR_FLAT_YAW)

  renderer.render(aircraftScene, aircraftCamera)

  // From the cockpit, much of the airframe in view - the canopy frame, the
  // HUD glass - is closer than the near plane the pass above shares with
  // the terrain, and was clipped away. So it is drawn again on top, with
  // a camera that clips much closer - in full only the parts that reach
  // that close, the rest only into the depth buffer (see
  // setCockpitNearPass in graphics/f16Model.js). Its depth range doesn't match the
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

    f16Rig?.setCockpitNearPass(true)
    renderer.render(aircraftScene, aircraftCamera)
    f16Rig?.setCockpitNearPass(false)

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
  // the transcoder needs to know the renderer before any texture arrives
  Tile.ktx2Loader.detectSupport(renderer)
  loadF16Model(f16, Tile.ktx2Loader, MeshoptDecoder, (rig) => {
    enableShadows(rig.object)
    f16Rig = rig
    cockpitHiddenParts = rig.cockpitHiddenParts
    cockpitUnshadowedParts = rig.cockpitUnshadowedParts
    cockpitInteriorParts = rig.cockpitInteriorParts
    cockpitOnlyParts = rig.cockpitOnlyParts
    placeHudAboveAirframe(rig.object)
  })
}

// Looking ahead from the cockpit, the interior in view - the glare shield
// and the cockpit rim below the HUD - is shown in an even grey, without the
// sun's shading and shadows moving over it as the aircraft turns. It still
// dims with the daylight, as the terrain does (see sky.onUpdate), so it
// doesn't glow at night. That is for as long as it stays in view as the
// pilot looks round - up to COCKPIT_INTERIOR_FLAT_YAW degrees either side,
// where it has gone out of sight, so the change back to the shaded grey
// isn't seen.
const COCKPIT_INTERIOR_FLAT_YAW = 90

// gives the cockpit interior its grey for the cockpit view - unshaded with
// the pilot looking ahead - or its own material back for the exterior views
function paintCockpitInterior(inCockpit, lookingAhead) {
  for (const part of cockpitInteriorParts) {
    part.mesh.material = !inCockpit
      ? part.exteriorMaterial
      : lookingAhead
        ? part.flatMaterial
        : part.cockpitMaterial
  }
}

// Puts the HUD glass just above the highest point of the airframe the pilot
// sees ahead of them, within the HUD's width - the glare shield and the nose
// - leaving out the parts hidden in the cockpit view and the canopy glass,
// which the pilot looks through. Only what is at least LOOK_AHEAD_MIN
// meters in front of the eye counts: closer than that is the HUD's own
// mounting, beside and below the glass.
const LOOK_AHEAD_MIN = 0.3 // m

function placeHudAboveAirframe(object) {
  f16.updateMatrixWorld(true)
  const toAircraft = f16.matrixWorld.clone().invert()
  const halfWidth = Math.atan(Math.tan(HUD_FIELD_OF_VIEW / 2) * HUD_ASPECT)
  const point = new Vector3()
  let highest = -Infinity

  object.traverse((mesh) => {
    // not the parts hidden in the cockpit view, nor anything inside them
    if (!mesh.isMesh) return
    for (let parent = mesh; parent; parent = parent.parent) if (cockpitHiddenParts.includes(parent)) return
    if ([mesh.material].flat().some((material) => material.name === "Glass")) return

    const frame = toAircraft.clone().multiply(mesh.matrixWorld)
    const position = mesh.geometry.attributes.position
    for (let i = 0; i < position.count; i++) {
      // a skinned mesh's vertices are where its bones put them
      point.fromBufferAttribute(position, i)
      if (mesh.isSkinnedMesh) mesh.applyBoneTransform(i, point)
      point.applyMatrix4(frame).sub(EYE_POSITION)
      if (point.y < LOOK_AHEAD_MIN || Math.abs(Math.atan2(point.x, point.y)) > halfWidth) continue
      highest = Math.max(highest, Math.atan2(point.z, Math.hypot(point.x, point.y)))
    }
  })

  if (highest === -Infinity) return
  placeHud(highest * MathUtils.RAD2DEG + HUD_CLEARANCE)
  console.log("HUD glass bottom edge at %s degrees", (highest * MathUtils.RAD2DEG + HUD_CLEARANCE).toFixed(1))
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
    case "n": // time of day back
      timeOffset -= TIME_STEP
      logSun()
      break
    case "m": // time of day forward
      timeOffset += TIME_STEP
      logSun()
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
