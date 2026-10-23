import {
  AdditiveBlending,
  AnimationMixer,
  Ray,
  BufferAttribute,
  Box3,
  Color,
  CylinderGeometry,
  DoubleSide,
  Matrix3,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  Quaternion,
  ShaderMaterial,
  Vector3,
  MathUtils,
} from "three"
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js"
import { mixFlaperons } from "../hifimodel/flaperons.js"

/*
 * The F-16 model in f16/f16.glb (converted from f16-2 - see its own
 * history), placed on the aircraft and rigged to the simulation.
 *
 * Its skeleton moves every movable part: the control surfaces and the
 * speedbrake have a bone each, hinged along the bone's own local y axis,
 * and the landing gear - legs, wheels and doors - is moved by the model's
 * own retraction animation, exactly as it was authored: down at its start,
 * up at its end, 3 seconds later.
 *
 * The model is authored with x to the left, y up and z forward, and is
 * placed so that the bottoms of its main tyres are where the landing gear
 * model's main contact points are (see VISUAL_MAIN_TIRE in
 * landinggearmodel.js): the main wheels carry the aircraft, and are what is
 * seen touching the ground.
 */

// model frame -> aircraft frame (x right, y forward, z up, meters from the
// centre of gravity): x flips, y and z swap, and the main tyre bottoms
// (model: 1.153 m aft of the origin, 2.240 m below it) land on the contact
// points (0.259 m aft of the centre of gravity, 1.850 m below it)
const PLACEMENT = new Matrix4().set(-1, 0, 0, 0, 0, 0, 1, 0.894, 0, 1, 0, 0.39, 0, 0, 0, 1)

// The pilot's eye point in this model, aircraft frame: 0.36 m behind the
// HUD combiner's frame and 0.13 m below the canopy, which gives a view of
// 15.2 degrees down over the glare shield - the real aircraft's 15.
export const EYE_POSITION = new Vector3(0, 4.8, 1.1)

// The landing gear model's nose contact point is 8 cm higher than this
// model's nose tyre, so with the gear down the nose wheel is raised that
// much, to stand on it rather than sink into the ground.
const NOSE_WHEEL_RAISE = 0.08 // m

// where the tyres' centres are with the gear down, aircraft frame - for
// the ground contact checks in index.js, which want where the wheels would
// be if extended, gear up or not
const WHEEL_CENTRES = {
  nose: [0, 3.614, -1.623 + NOSE_WHEEL_RAISE],
  left: [-1.289, -0.259, -1.526],
  right: [1.289, -0.259, -1.526],
}

// each control surface's bone, and which way a positive deflection turns
// it about the bone's y axis - measured, as the way a point on its trailing
// (or leading) edge moves: stabilators and flaperons trailing edge down,
// leading edge flaps down, rudder trailing edge left, and the speedbrake
// open. The differential stabilator command puts the right one further
// down, and the aileron command lowers the right flaperon (see
// mixFlaperons).
const SURFACES = [
  { bone: "Pitch_L", channel: "elevator", axis: [0, 1, 0], sign: -1, diff: -1 },
  { bone: "Pitch_R", channel: "elevator", axis: [0, 1, 0], sign: 1, diff: 1 },
  { bone: "Roll_L", channel: "flaperonLeft", axis: [0, 1, 0], sign: 1 },
  { bone: "Roll_R", channel: "flaperonRight", axis: [0, 1, 0], sign: -1 },
  { bone: "Front_Flaps_L", channel: "lef", axis: [0, 1, 0], sign: 1 },
  { bone: "Front_Flaps_R", channel: "lef", axis: [0, 1, 0], sign: -1 },
  { bone: "Yaw", channel: "rudder", axis: [0, 1, 0], sign: -1 },
  // the speedbrake: one bone for the upper panels and one for the lower,
  // hinged across the aircraft at their front edges, opening apart - each
  // by the whole of the speedbrake angle, 60 degrees fully open
  { bone: "Brake_Top", channel: "speedbrake", axis: [1, 0, 0], sign: 1 },
  { bone: "Brake_Bottom", channel: "speedbrake", axis: [1, 0, 0], sign: 1 },
]

// The paint textures are dark - the fuselage's grey shows at about 10%
// reflectance - while the F-16's greys reflect from around 10 to 35%. Lit
// to match the terrain (see sky.onUpdate in index.js) the aircraft came out
// nearly charcoal, so the painted parts are brightened by this, to the
// brightness the F-16's greys have in the same light.
const PAINT_BRIGHTNESS = 2.4
const PAINTED = ["Body", "Body_RightFin", "Canopy", "Accessories", "Fuel Tank"]

// The paint's roughness maps are around 0.35 - a satin finish that threw
// broad, bright highlights - while the F-16's paint is matte. three
// multiplies the map by the material's roughness, so this scales them up,
// keeping the paint's own variation, to around 0.8.
const PAINT_ROUGHNESS = 2.3

// The inside of the air intake, black, as it is seen in the real aircraft -
// the duct's inner walls and the engine face at its end: the body's
// triangles under the forward fuselage that face the duct's centreline.
// Aircraft frame, meters.
// The duct runs forward to maxY, just behind the mouth's lip, which keeps
// its paint - and its roof on to roofMaxY, under the lip's top edge;
// centreZ is the height of the duct's centreline.
const INTAKE = { minY: 0.3, maxY: 4.2, roofMaxY: 4.32, maxAbsX: 0.75, minZ: -0.95, maxZ: -0.15, centreZ: -0.635 }

// The inside of the engine nozzle, glowing orange from the hot exhaust: the
// nozzle's triangles that face its centreline, and everything near the
// centreline deep inside it - forward of coreAhead (aircraft y), meters.
// rimY is just forward of the exit's own rim, which faces aft and keeps its
// metal look.
const NOZZLE = { axisZ: 0.06, radius: 0.58, innerRadius: 0.52, wallRadius: 0.545, skinRadius: 0.572, frontY: -4.65, lipY: -4.6, coreRadius: 0.45, coreAhead: -4.5, rimY: -5.5 }
// - and sooty dark metal otherwise, glowing with the engine's heat (see
// setEngine): the core brighter, the wall evenly - split into zones along
// it, the sawtooth flaps came out zigzagged, each triangle in one zone or
// the other.
const NOZZLE_METAL = 0x1c1814

// The nozzle's exit opens and closes with engine power, as the F100's does:
// fully open at idle, closing to its smallest at full military power (power
// 50), and opening again through the afterburner to fully open at its
// maximum (100). The model has it fully open, a straight tube 1.13 m across;
// its flaps, from NOZZLE_HINGE_Y aft to NOZZLE_EXIT_Y, are drawn swung in
// towards the centreline, closed, by up to NOZZLE_CLOSING of the radius at
// the exit - an estimate, there being no published nozzle dimensions to go
// by. See nozzleMotion.
const NOZZLE_HINGE_Y = -4.9
const NOZZLE_EXIT_Y = -5.7
const NOZZLE_CLOSING = 0.25

// the round glow's radius on the turbine face - just inside the hexagon the
// model has there, 0.50 m to its corners - and the width of its soft edge,
// meters
const CORE_GLOW_RADIUS = 0.42
const CORE_GLOW_EDGE = 0.04

// The glow's colour and strength, per zone (core, wall), at
// full military power and in full afterburner: a dull red from hot metal,
// barely seen in daylight, turning to a bright orange as the afterburner
// lights. These are at the eye's daylight adaptation; with less light the
// eye opens up, and the same glow shows brighter - see setEngine - up to
// GLOW_MAX, short of where the screen would clip it to yellow and white.
const GLOW_MIL = { color: new Color(1.0, 0.22, 0.04), zones: [0.12, 0.04] }
const GLOW_AB = { color: new Color(1.0, 0.72, 0.38), zones: [0.9, 0.5] }
const GLOW_MAX = 0.9

// The afterburner's flame, out of the nozzle's exit (aircraft y) along the
// centreline: an outer plume and a hotter inner core, each a cone drawn
// additively - see afterburnerFlame. Lengths and radii in meters, at full
// afterburner; both grow out of the nozzle as the afterburner lights.
const FLAME_EXIT_Y = -5.68
const FLAMES = [
  { length: 3.6, radius: 0.46, endRadius: 0.12, hot: new Color(1.0, 0.5, 0.15), cool: new Color(0.75, 0.15, 0.02), strength: 0.45, diamonds: 4 },
  { length: 1.7, radius: 0.34, endRadius: 0.05, hot: new Color(0.7, 0.7, 1.0), cool: new Color(1.0, 0.5, 0.15), strength: 0.6, diamonds: 3 },
]
// engine power (0..100, afterburner above 50) where the metal starts to glow
const GLOW_FROM_POWER = 15

// the canopy glass's tint and opacity as seen from the cockpit - see
// cockpitInteriorParts
const GLASS_TINT = new Color(0xb4c2cc)
const GLASS_OPACITY = 0.12

// the nose wheel's steering bone - the fork and wheel - and the bones that
// carry each wheel, moved up with the strut's compression
const STEERING_BONE = "G"
const WHEEL_BONES = { nose: "G", mainL: "Wheel_L", mainR: "Wheel_R" }

// parts hidden in the cockpit view: the seat (the eye is just in front of
// its headrest) and the HUD's own frame and glass (the simulator draws its
// own HUD there)
const COCKPIT_HIDDEN = ["Seat", "Hud"]

// parts close enough to the eye that their self-shadows flicker in the
// cockpit view - see COCKPIT_UNSHADOWED_PARTS in index.js
const COCKPIT_UNSHADOWED = ["Cockpit002", "Control", "Canopy_mesh", "Canopy001"]

// The gear doors don't quite fill their openings in the skin: closed, up
// to 3 mm of slit shows along their edges, and the bay walls inside -
// lit by the sun, as the shadow map is far too coarse to shade a slit that
// narrow - showed through as thin bright lines, as if the doors weren't
// quite closed. So each door is made DOOR_OVERLAP larger all round, along
// its surface, to overlap the opening's edge - see growDoor.
const GEAR_DOORS = /^Cover_/
const DOOR_OVERLAP = 0.006 // m

// and nowhere further out of the skin than this - see fitDoorsToSkin
const DOOR_FIT_PROUD = 0.0005 // m
// the height of the fuselage's centreline, aircraft frame - what "out of
// the fuselage" is measured from
const FUSELAGE_AXIS_Z = -0.2 // m

// The gear legs and wheels, hidden while the gear is fully up: the closed
// bays hide them anyway, and a retracted main wheel pokes a few millimetres
// through its door in the model
const GEAR_PARTS = /^(Gear|Wheel)/

// The stores under the wings - the two fuel tanks, the two AIM-120s and
// the two AIM-9s on the outer pylons - aren't drawn: the flight model
// flies the aircraft clean, at its weight and drag without them. Only the
// AIM-9s on the wing tips stay. The pylons are left as they are.
const REMOVED_STORES = [
  "Fuel_L",
  "Fuel_L001",
  "AIM_120_AMHRAAM",
  "AIM_120_AMHRAAM001",
  "AIM_9_Sidewinder001",
  "AIM_9_Sidewinder002",
]

// the cockpit's own parts, shown unshaded from the cockpit - see
// paintCockpitInterior in index.js
const COCKPIT_INTERIOR = ["Cockpit002", "Control"]

// From the cockpit the airframe is drawn twice: first with the terrain's
// camera, whose near plane is 1 m out, then again close up (see drawScene
// in index.js). The second time, only the parts reaching closer than this
// to the eye - which the first pass clipped - need drawing in full; see
// setCockpitNearPass.
const COCKPIT_NEAR_REACH = 1.1 // m

// the model's cockpit tub, and how far ahead of the eye, in meters, its
// part hidden in the cockpit view starts - see COCKPIT_MODEL
const COCKPIT_TUB = ["Cockpit002"]
const TUB_PANEL_FROM = 0.2

// The model's cockpit is a plain black tub, with the top of the nose
// showing over it below the HUD - while in the real F-16 the HUD sits on the
// up-front controls, with the glare shield high on either side and the
// instrument panel below, and the nose doesn't show at all. So from the
// cockpit, a model of the real front panel stands in for it: "F16C Block
// 50/52 + Cockpit" by graphXDoses (sketchfab.com/3d-models/
// f16c-block-5052-cockpit-83fb3b74c97d46febda2813331de168d, CC BY 4.0) -
// the HUD, the up-front controls, the glare shield, the instrument panel
// and the centre pedestal, in one mesh with a baked texture.
//
// In its own frame, as loaded, x is forward, y up and z to the right, in
// units of about 0.42 m: SCALE makes its displays the real ones' 0.16 m
// across, and that puts the front of its glare shield right on the
// airframe's own. ANCHOR is the top of the up-front controls' face, on the
// centreline, which goes ANCHOR_DISTANCE ahead of the eye and OVER_NOSE
// degrees down - on the line over the nose, which the simulator's own HUD
// glass sits right on top of (see placeHudAboveAirframe in index.js). Its
// HUD - the glass, its frame and the top of its housing, with the AOA
// indexer and the refuelling status lights either side of it: all
// triangles reaching up into HUD (model frame) - is cut out: the simulator
// draws its own HUD there - and so are the remains of it all: the parts of
// the mesh, each in one piece, that lie wholly inside one of REMAINS.
// What is left is then raised or lowered until its top, straight ahead -
// NOSE_HALF_WIDTH degrees either side, where the nose is - is just on the
// line over the nose, OVER_NOSE degrees down - PANEL_OVER_NOSE above it - so
// it only just hides it.
const COCKPIT_MODEL = {
  url: "f16/cockpit.glb",
  scale: 2.4,
  anchor: new Vector3(1.035, 1.163, 0.857),
  hud: { min: new Vector3(-Infinity, 1.165, 0.79), max: new Vector3(1.17, Infinity, 0.925) },
  // the pieces left of the HUD's mounting and what stood beside it - the
  // AOA indexer's and status lights' bases and cables, and the feet of the
  // HUD frame's posts, either side of the up-front controls' buttons - each
  // a part of its own, lying wholly inside one of these
  remains: [
    new Box3(new Vector3(1.06, 1.12, 0.785), new Vector3(1.22, Infinity, 0.93)),
    new Box3(new Vector3(1.02, 1.12, 0.81), new Vector3(1.15, Infinity, 0.826)),
    new Box3(new Vector3(1.02, 1.12, 0.888), new Vector3(1.15, Infinity, 0.905)),
  ],
}
// the nose seen from the eye, half its width
const NOSE_HALF_WIDTH = 9 // degrees
// how far above the line over the nose the panel's top is, so none of the
// nose shows over it
const PANEL_OVER_NOSE = 0.2 // degrees
const OVER_NOSE = 15.2 // degrees
const ANCHOR_DISTANCE = 0.43 // m
// How the panel is lit - see cockpitPanelMaterial: always as the cockpit
// interior's daylight is at noon (on midsummer's day, in index.js's terms
// - luminance(sky.groundLight)), a fill from all round, and direct light,
// by how square on to it a surface is, from where the sun is at noon seen
// from an aircraft heading north: behind it, 50 degrees up (aircraft frame).
const COCKPIT_PANEL_BRIGHTNESS = 1.12
const COCKPIT_PANEL_FILL = 0.55
const COCKPIT_PANEL_SUN = 0.6
const COCKPIT_PANEL_LIGHT = new Vector3(0, -Math.cos(50 * MathUtils.DEG2RAD), Math.sin(50 * MathUtils.DEG2RAD))
// the model's frame to the aircraft's: its x, y and z go to y, z and x
const COCKPIT_MODEL_AXES = new Matrix4().set(0, 0, 1, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 1)

function find(root, name, predicate = () => true) {
  let found = null
  root.traverse((o) => {
    if (!found && o.name === name && predicate(o)) found = o
  })
  return found
}

/**
 * Loads the model onto the aircraft object.
 *
 * @param f16         the aircraft's Object3D, in the aircraft frame
 * @param ktx2Loader  a KTX2Loader already set up for the renderer
 * @param decoder     the meshopt decoder
 * @param onLoad      called with the rig (see F16Rig)
 */
export function loadF16Model(f16, ktx2Loader, decoder, onLoad) {
  new GLTFLoader()
    .setKTX2Loader(ktx2Loader)
    .setMeshoptDecoder(decoder)
    .load(
      "f16/f16.glb",
      (gltf) => onLoad(new F16Rig(f16, gltf)),
      () => {},
      (error) => console.log("Could not load the F-16 model: " + error),
    )
}

// The cockpit panel model's material: its texture, in plain white light of
// a fixed strength from a fixed direction on the aircraft - so it looks the
// same at any time of day and on any heading, as it does at noon, without
// the sun's colour or shadows on it. toAircraft turns the mesh's normals
// into the aircraft frame.
function cockpitPanelMaterial(map, side, toAircraft) {
  const light = `vec3(${COCKPIT_PANEL_LIGHT.toArray().map((n) => n.toFixed(4)).join(", ")})`
  return new ShaderMaterial({
    side,
    uniforms: { map: { value: map }, toAircraft: { value: toAircraft } },
    vertexShader: `
      uniform mat3 toAircraft;
      varying vec2 vUv;
      varying vec3 vNormal;
      void main() {
        vUv = uv;
        vNormal = toAircraft * normal;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform sampler2D map;
      varying vec2 vUv;
      varying vec3 vNormal;
      void main() {
        vec3 n = normalize(vNormal) * (gl_FrontFacing ? 1.0 : -1.0);
        float direct = max(dot(n, ${light}), 0.0);
        float light = ${COCKPIT_PANEL_BRIGHTNESS.toFixed(4)} * (${COCKPIT_PANEL_FILL.toFixed(4)} + ${COCKPIT_PANEL_SUN.toFixed(4)} * direct);
        gl_FragColor = vec4(texture2D(map, vUv).rgb * light, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  })
}

// Makes a gear door larger by margin (m) on every side, along its surface:
// each vertex is moved margin away from the door's centre, along the
// surface - the direction from the centre less its part along the vertex's
// normal - so the outline grows without lifting off the skin, even where
// the door curves round the fuselage. In the door's own (bind pose) frame,
// whose units are found from two of its vertices as posed, since a skinned
// mesh's vertices are scaled by its bones, not by its own matrix.
function growDoor(mesh, margin) {
  // the positions come compressed to 16 bits, scaled to just fit the door -
  // with no room to grow in, so they are unpacked to plain floats first
  const packed = mesh.geometry.attributes.position
  const unpacked = new Float32Array(3 * packed.count)
  for (let i = 0; i < packed.count; i++) {
    unpacked[3 * i] = packed.getX(i)
    unpacked[3 * i + 1] = packed.getY(i)
    unpacked[3 * i + 2] = packed.getZ(i)
  }
  mesh.geometry.setAttribute("position", new BufferAttribute(unpacked, 3))
  const position = mesh.geometry.attributes.position
  const normal = mesh.geometry.attributes.normal
  const bind = (i) => new Vector3().fromBufferAttribute(position, i)
  const posed = (i) => {
    const v = bind(i)
    if (mesh.isSkinnedMesh) mesh.applyBoneTransform(i, v)
    return v.applyMatrix4(mesh.matrixWorld)
  }
  let far = 0
  for (let i = 1; i < position.count && far === 0; i++) if (bind(i).distanceTo(bind(0)) > 0) far = i
  if (far === 0) return
  const step = margin * (bind(far).distanceTo(bind(0)) / posed(far).distanceTo(posed(0)))

  const centre = new Vector3()
  for (let i = 0; i < position.count; i++) centre.add(bind(i))
  centre.divideScalar(position.count)

  // the way the door faces, either way: its normals, turned to agree with
  // the first and summed - the faces of its outside and inside dominate,
  // the narrow faces round its rim hardly count
  const facing = new Vector3()
  const first = new Vector3().fromBufferAttribute(normal, 0)
  for (let i = 0; i < position.count; i++) {
    const n = new Vector3().fromBufferAttribute(normal, i)
    facing.addScaledVector(n, Math.sign(n.dot(first)) || 1)
  }
  facing.normalize()

  // Vertices in the same place - at the door's edges and creases, one for
  // each face that meets there - move together, or the door would tear
  // apart along them. They move along the surface of the door's outside or
  // inside face there, whichever of their normals faces most the way the
  // door does: the rim's normal points sideways, and the surface it would
  // give would take out most of the move an edge needs.
  const key = (v) => `${v.x.toFixed(5)},${v.y.toFixed(5)},${v.z.toFixed(5)}`
  const normals = new Map()
  for (let i = 0; i < position.count; i++) {
    const k = key(bind(i))
    const n = new Vector3().fromBufferAttribute(normal, i).normalize()
    const best = normals.get(k)
    if (!best || Math.abs(n.dot(facing)) > Math.abs(best.dot(facing))) normals.set(k, n)
  }

  const moves = new Map()
  for (let i = 0; i < position.count; i++) {
    const v = bind(i)
    const k = key(v)
    if (!moves.has(k)) {
      const n = normals.get(k).normalize()
      const out = v.clone().sub(centre)
      out.addScaledVector(n, -out.dot(n))
      moves.set(k, out.lengthSq() > 0 ? out.normalize().multiplyScalar(step) : new Vector3())
    }
    v.add(moves.get(k))
    position.setXYZ(i, v.x, v.y, v.z)
  }
  position.needsUpdate = true
  mesh.geometry.computeBoundingBox()
  mesh.geometry.computeBoundingSphere()
}

// whether any of a mesh's vertices, as posed, is within reach of point
// (both in the world frame)
function reachesWithin(mesh, point, reach) {
  const position = mesh.geometry.attributes.position
  const v = new Vector3()
  const reachSquared = reach * reach
  for (let i = 0; i < position.count; i++) {
    v.fromBufferAttribute(position, i)
    if (mesh.isSkinnedMesh) mesh.applyBoneTransform(i, v)
    if (v.applyMatrix4(mesh.matrixWorld).distanceToSquared(point) < reachSquared) return true
  }
  return false
}

// a material that only writes depth, facing the same way as material -
// one for each way (see setCockpitNearPass)
const DEPTH_ONLY = new Map()
function depthOnly(material) {
  if (!DEPTH_ONLY.has(material.side)) DEPTH_ONLY.set(material.side, new MeshBasicMaterial({ colorWrite: false, side: material.side }))
  return DEPTH_ONLY.get(material.side)
}

// Drops the pieces of a mesh - its parts connected by shared corners - that
// lie wholly inside box, in the frame of the model's root (as cutOut)
function cutPieces(mesh, box) {
  const g = mesh.geometry
  const position = g.attributes.position
  const index = g.index.array
  // corners in the same place are one, whether or not they share a vertex
  const corners = new Map()
  const corner = new Int32Array(position.count)
  const v = new Vector3()
  for (let i = 0; i < position.count; i++) {
    v.fromBufferAttribute(position, i)
    const key = `${Math.round(v.x * 1e5)},${Math.round(v.y * 1e5)},${Math.round(v.z * 1e5)}`
    if (!corners.has(key)) corners.set(key, corners.size)
    corner[i] = corners.get(key)
  }
  const parent = Int32Array.from({ length: corners.size }, (_, i) => i)
  const root = (a) => {
    while (parent[a] !== a) a = parent[a] = parent[parent[a]]
    return a
  }
  for (let t = 0; t < index.length; t += 3) {
    const a = root(corner[index[t]])
    parent[root(corner[index[t + 1]])] = a
    parent[root(corner[index[t + 2]])] = a
  }
  // a piece is inside if all its corners are
  const outside = new Set()
  for (let i = 0; i < position.count; i++) {
    if (!box.containsPoint(v.fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld))) outside.add(root(corner[i]))
  }
  const kept = []
  for (let t = 0; t < index.length; t += 3) {
    if (outside.has(root(corner[index[t]]))) kept.push(index[t], index[t + 1], index[t + 2])
  }
  g.setIndex(kept)
}

// Moves the triangles of a mesh whose centre, in the aircraft frame, take
// says to take, to a copy of the mesh of their own, alongside it - and
// returns the copy, or nothing if there were none or the mesh's triangles
// are in groups (for more than one material).
function splitOff(mesh, toAircraft, take) {
  const g = mesh.geometry
  if (g.groups.length > 0) return null
  const position = g.attributes.position
  const index = g.index ? g.index.array : Array.from({ length: position.count }, (_, i) => i)
  const frame = new Matrix4().multiplyMatrices(toAircraft, mesh.matrixWorld)
  const corner = new Vector3()
  const centre = new Vector3()
  const [taken, kept] = [[], []]
  for (let t = 0; t < index.length; t += 3) {
    centre.set(0, 0, 0)
    for (let k = 0; k < 3; k++) {
      corner.fromBufferAttribute(position, index[t + k])
      if (mesh.isSkinnedMesh) mesh.applyBoneTransform(index[t + k], corner)
      centre.add(corner.applyMatrix4(frame))
    }
    ;(take(centre.divideScalar(3)) ? taken : kept).push(index[t], index[t + 1], index[t + 2])
  }
  if (taken.length === 0) return null

  const copy = mesh.clone()
  copy.geometry = g.clone()
  copy.geometry.setIndex(taken)
  copy.name = mesh.name + "_ahead"
  g.setIndex(kept)
  mesh.parent.add(copy)
  return copy
}

// Drops a mesh's triangles that cut says to, given their centre and their
// highest corner (most y) in the frame of the model's root (its
// matrixWorld, before the model is placed anywhere)
function cutOut(mesh, cut) {
  const g = mesh.geometry
  const position = g.attributes.position
  const index = g.index ? g.index.array : Array.from({ length: position.count }, (_, i) => i)
  const kept = []
  const centre = new Vector3()
  const corner = new Vector3()
  const top = new Vector3()
  for (let t = 0; t < index.length; t += 3) {
    centre.set(0, 0, 0)
    top.set(0, -Infinity, 0)
    for (let k = 0; k < 3; k++) {
      corner.fromBufferAttribute(position, index[t + k]).applyMatrix4(mesh.matrixWorld)
      centre.add(corner)
      if (corner.y > top.y) top.copy(corner)
    }
    if (!cut(centre.divideScalar(3), top)) kept.push(index[t], index[t + 1], index[t + 2])
  }
  g.setIndex(kept)
}

/*
 * Gives a mesh's triangles other materials: choose, given each triangle's
 * centre and facing in the aircraft frame, returns the material it gets, or
 * nothing to keep its own. Each material's triangles are moved together, to
 * a group of their own.
 */
function splitTriangles(mesh, toAircraft, choose) {
  const g = mesh.geometry
  const index = g.index
  const position = g.attributes.position
  const count = (index ? index.count : position.count) / 3
  const vertex = (t, k) => (index ? index.getX(3 * t + k) : 3 * t + k)

  const frame = new Matrix4().multiplyMatrices(toAircraft, mesh.matrixWorld)
  const corner = (i) => {
    const v = new Vector3().fromBufferAttribute(position, i)
    if (mesh.isSkinnedMesh) mesh.applyBoneTransform(i, v)
    return v.applyMatrix4(frame)
  }

  const own = [mesh.material].flat()[0]
  const groups = new Map([[own, []]])
  for (let t = 0; t < count; t++) {
    const [a, b, c] = [0, 1, 2].map((k) => corner(vertex(t, k)))
    const normal = new Vector3().subVectors(b, a).cross(new Vector3().subVectors(c, a)).normalize()
    const centre = a.add(b).add(c).divideScalar(3)
    const material = choose(centre, normal) || own
    if (!groups.has(material)) groups.set(material, [])
    groups.get(material).push(t)
  }
  if (groups.size === 1) return

  const order = [...groups.values()].flat()
  if (index) {
    const old = index.array.slice()
    order.forEach((t, j) => index.array.set(old.subarray(3 * t, 3 * t + 3), 3 * j))
    index.needsUpdate = true
  } else {
    // vertex by vertex - some attributes are interleaved, sharing an array
    for (const attribute of Object.values(g.attributes)) {
      const n = attribute.itemSize
      const old = []
      for (let i = 0; i < attribute.count; i++) for (let k = 0; k < n; k++) old.push(attribute.getComponent(i, k))
      order.forEach((t, j) => {
        for (let v = 0; v < 3; v++) for (let k = 0; k < n; k++) attribute.setComponent(3 * j + v, k, old[(3 * t + v) * n + k])
      })
      if (attribute.isInterleavedBufferAttribute) attribute.data.needsUpdate = true
      else attribute.needsUpdate = true
    }
  }
  g.clearGroups()
  let start = 0
  ;[...groups.values()].forEach((triangles, i) => {
    g.addGroup(start, triangles.length * 3, i)
    start += triangles.length * 3
  })
  mesh.material = [...groups.keys()]
}

/*
 * Has a material glow only within NOZZLE.skinRadius of the nozzle's
 * centreline, per pixel - inside the nozzle's outer skin. The body's end
 * ring, which closes the gap between the nozzle and the fuselage's skin,
 * reaches out past it: seen from outside, through that gap, it stays dark.
 * (Cut off any further in, at the nozzle's inner wall, the cut showed from
 * inside as a thin dark circle past the wall's front edge.)
 * frame takes the mesh's own coordinates, after skinning, to the aircraft
 * frame.
 */
function insideWall(material, frame) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.wallFrame = { value: frame }
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform mat4 wallFrame;\nvarying vec3 vWallAircraft;")
      .replace("#include <project_vertex>", "#include <project_vertex>\nvWallAircraft = (wallFrame * vec4(transformed, 1.0)).xyz;")
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vWallAircraft;")
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        float wallRadius = length(vec2(vWallAircraft.x, vWallAircraft.z - ${NOZZLE.axisZ.toFixed(3)}));
        totalEmissiveRadiance *= 1.0 - smoothstep(${(NOZZLE.skinRadius - 0.006).toFixed(3)}, ${NOZZLE.skinRadius.toFixed(3)}, wallRadius);`,
      )
  }
  material.customProgramCacheKey = () => "insideWall"
  return material
}

/*
 * Has a material draw the nozzle's flaps swung in towards its centreline,
 * by NOZZLE_CLOSING at the exit with the nozzle closed (open.value 0) and
 * not at all fully open (1). frame takes the mesh's own coordinates, after
 * skinning, to the aircraft frame. Keeps whatever the material already
 * changes in its shaders (see roundGlow).
 */
function nozzleMotion(material, frame, open) {
  const inverse = new Matrix4().copy(frame).invert()
  const before = material.onBeforeCompile
  material.onBeforeCompile = (shader, renderer) => {
    before?.call(material, shader, renderer)
    shader.uniforms.nozzleFrame = { value: frame }
    shader.uniforms.nozzleInverse = { value: inverse }
    shader.uniforms.nozzleOpen = open
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform mat4 nozzleFrame;\nuniform mat4 nozzleInverse;\nuniform float nozzleOpen;\nvarying float vNozzleY;")
      .replace(
        "#include <project_vertex>",
        `{
          vec3 p = (nozzleFrame * vec4(transformed, 1.0)).xyz;
          float along = clamp((${NOZZLE_HINGE_Y.toFixed(3)} - p.y) / ${(NOZZLE_HINGE_Y - NOZZLE_EXIT_Y).toFixed(3)}, 0.0, 1.0);
          float scale = 1.0 - (1.0 - nozzleOpen) * ${NOZZLE_CLOSING.toFixed(3)} * along;
          p.x *= scale;
          p.z = ${NOZZLE.axisZ.toFixed(3)} + (p.z - ${NOZZLE.axisZ.toFixed(3)}) * scale;
          transformed = (nozzleInverse * vec4(p, 1.0)).xyz;
          vNozzleY = p.y;
        }
        #include <project_vertex>`,
      )
  }
  const key = material.customProgramCacheKey?.() ?? ""
  material.customProgramCacheKey = () => key + "nozzleMotion"
  return material
}

/*
 * One cone of the afterburner's flame, from the nozzle's exit aft along the
 * centreline, its length set by the mesh's y scale. Drawn as light added to
 * what is behind it: brightest along its middle, as seen from any side,
 * fading out towards its edges and its end, and from hot to cool colours
 * along it - with the bright bands of the shock diamonds a supersonic jet
 * has, and streaks along the flow that flicker.
 */
function afterburnerFlame({ radius, endRadius, hot, cool, diamonds }) {
  const geometry = new CylinderGeometry(radius, endRadius, 1, 40, 24, true)
  geometry.translate(0, -0.5, 0) // from the exit, y 0, aft to y -1
  const material = new ShaderMaterial({
    uniforms: {
      strength: { value: 0 },
      time: { value: 0 },
      hot: { value: hot },
      cool: { value: cool },
    },
    vertexShader: /* glsl */ `
      varying float vAlong;
      varying float vAround;
      varying vec3 vNormal;
      varying vec3 vView;
      varying vec3 vAxis;
      void main() {
        vAlong = -position.y;
        vAxis = normalize(normalMatrix * vec3(0.0, 1.0, 0.0));
        vAround = atan(position.z, position.x);
        vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
        vNormal = normalize(normalMatrix * normal);
        vView = normalize(-viewPosition.xyz);
        gl_Position = projectionMatrix * viewPosition;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float strength;
      uniform float time;
      uniform vec3 hot;
      uniform vec3 cool;
      varying float vAlong;
      varying float vAround;
      varying vec3 vNormal;
      varying vec3 vView;
      varying vec3 vAxis;
      void main() {
        // the middle of the cone as seen - the surface facing the eye - is
        // where the eye looks through the most flame; seen end on, from
        // behind or ahead, the eye looks down the whole length of it
        float body = pow(abs(dot(normalize(vNormal), normalize(vView))), 2.0);
        float endOn = pow(abs(dot(normalize(vAxis), normalize(vView))), 3.0);
        body = max(body, 0.6 * endOn);
        // in from the exit, out towards the end
        float shape = smoothstep(0.0, 0.06, vAlong) * pow(1.0 - vAlong, 1.6);
        // shock diamonds, a little unsteady
        float diamond = 0.7 + 0.5 * pow(0.5 + 0.5 * cos(6.2832 * ${diamonds.toFixed(1)} * vAlong - 1.2), 6.0);
        // streaks along the flow, moving and flickering
        float streak = 0.8 + 0.2 * sin(vAround * 13.0 + sin(time * 3.1 + vAlong * 9.0) * 2.0)
                         * sin(vAround * 7.0 - time * 11.0 + vAlong * 17.0);
        float flicker = 0.9 + 0.1 * sin(time * 41.0 + vAlong * 23.0) * sin(time * 29.0);
        vec3 colour = mix(hot, cool, smoothstep(0.0, 0.85, vAlong));
        gl_FragColor = vec4(colour * strength * body * shape * diamond * streak * flicker, 1.0);
      }
    `,
    transparent: true,
    blending: AdditiveBlending,
    depthWrite: false,
    side: DoubleSide,
    fog: false,
  })
  const mesh = new Mesh(geometry, material)
  mesh.frustumCulled = false
  mesh.renderOrder = 10
  return mesh
}

/*
 * A copy of the nozzle core's glow material that glows only within
 * CORE_GLOW_RADIUS of the nozzle's centreline, fading out to the wall's glow
 * beyond - a round glow on a hexagonal turbine face. frame takes the mesh's
 * own coordinates, after skinning, to the aircraft frame.
 */
function roundGlow(material, frame) {
  const round = material.clone()
  round.userData.wallEmissive = new Color()
  round.onBeforeCompile = (shader) => {
    shader.uniforms.coreFrame = { value: frame }
    shader.uniforms.wallEmissive = { value: round.userData.wallEmissive }
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform mat4 coreFrame;\nvarying vec3 vCoreAircraft;")
      .replace("#include <project_vertex>", "#include <project_vertex>\nvCoreAircraft = (coreFrame * vec4(transformed, 1.0)).xyz;")
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform vec3 wallEmissive;\nvarying vec3 vCoreAircraft;")
      .replace(
        "#include <emissivemap_fragment>",
        `#include <emissivemap_fragment>
        float coreRadius = length(vec2(vCoreAircraft.x, vCoreAircraft.z - ${NOZZLE.axisZ.toFixed(3)}));
        float core = 1.0 - smoothstep(${(CORE_GLOW_RADIUS - CORE_GLOW_EDGE).toFixed(3)}, ${CORE_GLOW_RADIUS.toFixed(3)}, coreRadius);
        totalEmissiveRadiance = mix(wallEmissive, totalEmissiveRadiance, core);`,
      )
  }
  round.customProgramCacheKey = () => "roundGlow"
  return round
}

class F16Rig {
  constructor(f16, gltf) {
    const model = gltf.scene
    model.matrixAutoUpdate = false
    model.matrix.copy(PLACEMENT)

    // a holder, so the placement matrix stays the model's own
    this.object = new Object3D()
    this.object.add(model)
    f16.add(this.object)

    // see DOOR_OVERLAP
    model.updateMatrixWorld(true)
    model.traverse((mesh) => {
      if (!mesh.isMesh || !GEAR_DOORS.test(mesh.name)) return
      growDoor(mesh, DOOR_OVERLAP)
    })

    // the gear legs and wheels, hidden while the gear is up - see GEAR_PARTS
    this.gearParts = []
    model.traverse((mesh) => mesh.isMesh && GEAR_PARTS.test(mesh.name) && this.gearParts.push(mesh))

    // see REMOVED_STORES
    for (const name of REMOVED_STORES) {
      const store = find(model, name, (o) => !o.isBone)
      if (store) store.removeFromParent()
      else console.log("F-16 model: no store " + name)
    }

    model.traverse((o) => {
      if (!o.isMesh) return
      // The metal parts - the engine nozzle, the gear - are authored fully
      // metallic, which only shows reflections of the surroundings, and
      // there are none here: they came out black. As paint they take the
      // same light as the rest of the aircraft.
      for (const material of [o.material].flat()) {
        material.metalness = 0
        if (PAINTED.includes(material.name)) {
          material.color.setScalar(PAINT_BRIGHTNESS)
          material.roughness = PAINT_ROUGHNESS
        }
      }
      // the bones move parts well outside their bind pose bounds
      o.frustumCulled = false
    })

    this.paintIntakeAndNozzle(model)

    // the gear animation, driven by the gear's position rather than by time
    this.mixer = new AnimationMixer(model)
    this.gearClip = gltf.animations.find((clip) => clip.name === "Gear")
    this.mixer.clipAction(this.gearClip).play()
    this.mixer.setTime(0)

    const bone = (name) => find(model, name, (o) => o.isBone)
    this.surfaces = SURFACES.map((s) => ({ ...s, bone: bone(s.bone), axis: new Vector3(...s.axis) })).filter((s) => {
      if (!s.bone) console.log("F-16 model: no bone for a control surface")
      return s.bone
    })
    this.steering = bone(STEERING_BONE)
    this.wheelBones = Object.fromEntries(Object.entries(WHEEL_BONES).map(([leg, name]) => [leg, bone(name)]))

    // The mixer only sets a bone when its animated value changes, so what
    // update() adds on top would stay, and add up frame after frame. So the
    // bones it moves are put back to their animated pose before the mixer
    // runs, and that pose is kept again after it.
    const adjusted = new Set([
      ...this.surfaces.map((s) => s.bone),
      this.steering,
      ...Object.values(this.wheelBones),
    ])
    this.animatedPose = [...adjusted].map((b) => ({ bone: b, quaternion: b.quaternion.clone(), position: b.position.clone() }))

    // the wheel centres for the ground checks, fixed on the aircraft
    this.wheels = {}
    for (const [wheel, position] of Object.entries(WHEEL_CENTRES)) {
      const marker = new Object3D()
      marker.position.set(...position)
      f16.add(marker)
      this.wheels[wheel] = marker
    }

    const parts = (names) => names.map((name) => find(model, name, (o) => !o.isBone)).filter(Boolean)
    this.cockpitHiddenParts = parts(COCKPIT_HIDDEN)

    const meshesOf = (objects) => {
      const meshes = []
      for (const object of objects) object.traverse((o) => o.isMesh && meshes.push(o))
      return meshes
    }

    // the cockpit tub ahead of the pilot, where the front panel model takes
    // its place - see COCKPIT_MODEL and TUB_PANEL_FROM
    model.parent.updateMatrixWorld(true)
    const toAircraft = new Matrix4().copy(model.parent.matrixWorld).invert()
    const tubAhead = meshesOf(parts(COCKPIT_TUB))
      .map((mesh) => splitOff(mesh, toAircraft, (centre) => centre.y > EYE_POSITION.y + TUB_PANEL_FROM))
      .filter(Boolean)
    this.cockpitHiddenParts.push(...tubAhead)

    this.cockpitUnshadowedParts = [...meshesOf(parts(COCKPIT_UNSHADOWED)), ...tubAhead]
    this.cockpitInteriorParts = [...meshesOf(parts(COCKPIT_INTERIOR)), ...tubAhead].map((mesh) => ({
      mesh,
      exteriorMaterial: mesh.material,
      cockpitMaterial: mesh.material,
      flatMaterial: new MeshBasicMaterial({ map: mesh.material.map }),
    }))

    // The canopy glass, seen from the cockpit, is its inner layer - two
    // halves meeting on the centreline straight ahead, one facing left and
    // one right. Lit, a sun low to one side lit one half and not the other,
    // splitting the view down the middle. From the cockpit it is a plain
    // tint instead, the same all over, dimmed with the daylight like the
    // cockpit interior (see sky.onUpdate in index.js).
    const cockpitGlass = new MeshBasicMaterial({ color: GLASS_TINT, transparent: true, opacity: GLASS_OPACITY, depthWrite: false })
    model.traverse((mesh) => {
      if (!mesh.isMesh || [mesh.material].flat()[0].name !== "Glass") return
      this.cockpitInteriorParts.push({
        mesh,
        exteriorMaterial: mesh.material,
        cockpitMaterial: cockpitGlass,
        flatMaterial: cockpitGlass,
        flatTint: GLASS_TINT,
      })
    })

    this.cockpitOnlyParts = []
    this.loadCockpitModel(f16)

    // the parts reaching within COCKPIT_NEAR_REACH of the eye, and the rest
    // - see setCockpitNearPass
    this.nearParts = []
    this.farParts = []
    f16.updateMatrixWorld(true)
    const eye = EYE_POSITION.clone().applyMatrix4(f16.matrixWorld)
    this.object.traverse((mesh) => {
      if (mesh.isMesh) (reachesWithin(mesh, eye, COCKPIT_NEAR_REACH) ? this.nearParts : this.farParts).push(mesh)
    })
    this.nearPass = null

    this.actuators = null
    this.rotation = new Quaternion()
    this.toLocal = new Matrix4()
    this.from = new Vector3()
    this.to = new Vector3()
  }

  // For the cockpit view's second, close-up pass over the airframe (see
  // drawScene in index.js): only the parts reaching within
  // COCKPIT_NEAR_REACH of the eye - which the first pass clipped - are drawn
  // in full. The rest were drawn whole in the first pass, so here they only
  // go into the depth buffer, to hide what is behind them, without being
  // shaded again; those that write no depth (glass, flames) are left out.
  // on: before the pass, off: after it, putting everything back.
  setCockpitNearPass(on) {
    if (on) {
      this.nearPass = this.farParts.map((mesh) => ({ mesh, material: mesh.material, visible: mesh.visible }))
      for (const { mesh, material } of this.nearPass) {
        const materials = [material].flat()
        if (materials.some((m) => m.transparent || !m.depthWrite || !m.depthTest)) mesh.visible = false
        else mesh.material = Array.isArray(material) ? materials.map(depthOnly) : depthOnly(material)
      }
    } else if (this.nearPass) {
      for (const { mesh, material, visible } of this.nearPass) {
        mesh.material = material
        mesh.visible = visible
      }
      this.nearPass = null
    }
  }

  // The gear doors, made larger to cover the slits round them (see
  // DOOR_OVERLAP), are grown straight out along their surface - while the
  // fuselage curves away under their edges, which then stood some 7 mm
  // proud of the skin, as if not quite shut. So once the doors are shut,
  // each part of a door standing proud of the skin is moved back in, along
  // the door's own normal, to DOOR_FIT_PROUD out of it. The skin is the
  // fuselage's triangles near the door, as posed.
  fitDoorsToSkin() {
    this.object.updateMatrixWorld(true)
    let body = null
    const doors = []
    this.object.traverse((o) => {
      if (!o.isMesh) return
      if (GEAR_DOORS.test(o.name)) doors.push(o)
      else if (o.name === "mesh_0") body = o
    })
    if (!body) return

    // a mesh's vertex, as posed, in the world
    const posed = (mesh, i, v) => {
      v.fromBufferAttribute(mesh.geometry.attributes.position, i)
      if (mesh.isSkinnedMesh) mesh.applyBoneTransform(i, v)
      return v.applyMatrix4(mesh.matrixWorld)
    }
    const bodyPosition = body.geometry.attributes.position
    const bodyCorners = Array.from({ length: bodyPosition.count }, (_, i) => posed(body, i, new Vector3()))
    const bodyIndex = body.geometry.index ? body.geometry.index.array : Array.from({ length: bodyPosition.count }, (_, i) => i)

    const ray = new Ray()
    const hit = new Vector3()
    for (const door of doors) {
      const position = door.geometry.attributes.position
      const normal = door.geometry.attributes.normal
      const corners = Array.from({ length: position.count }, (_, i) => posed(door, i, new Vector3()))
      const box = new Box3().setFromPoints(corners).expandByScalar(0.05)
      const skin = []
      for (let t = 0; t < bodyIndex.length; t += 3) {
        const a = bodyCorners[bodyIndex[t]]
        const b = bodyCorners[bodyIndex[t + 1]]
        const c = bodyCorners[bodyIndex[t + 2]]
        if (box.containsPoint(a) || box.containsPoint(b) || box.containsPoint(c)) skin.push([a, b, c])
      }

      // the door's frame as posed - it moves rigidly, with one bone - to
      // turn its normals into the world and the moves back into its frame
      const toWorld = new Matrix4().copy(door.matrixWorld)
      if (door.isSkinnedMesh) {
        const bone = door.geometry.attributes.skinIndex.getX(0)
        toWorld
          .multiply(door.bindMatrixInverse)
          .multiply(door.skeleton.bones[bone].matrixWorld)
          .multiply(door.skeleton.boneInverses[bone])
          .multiply(door.bindMatrix)
      }
      const normalToWorld = new Matrix3().getNormalMatrix(toWorld)
      const toDoor = new Matrix3().setFromMatrix4(toWorld).invert()

      // out of the fuselage: away from its centreline
      const outwards = (p, n) => (n.x * p.x + n.z * (p.z - FUSELAGE_AXIS_Z) < 0 ? n.negate() : n)

      const moves = new Map()
      for (let i = 0; i < position.count; i++) {
        const p = corners[i]
        const key = `${p.x.toFixed(5)},${p.y.toFixed(5)},${p.z.toFixed(5)}`
        if (!moves.has(key)) {
          const n = outwards(p, new Vector3().fromBufferAttribute(normal, i).applyMatrix3(normalToWorld).normalize())
          ray.set(p.clone().addScaledVector(n, 0.05), n.clone().negate())
          let nearest = Infinity
          for (const [a, b, c] of skin) if (ray.intersectTriangle(a, b, c, false, hit)) nearest = Math.min(nearest, hit.distanceTo(ray.origin))
          // the ray starts 5 cm out: skin further than that from it is
          // under the door, which stands proud of it by the difference
          const proud = nearest - 0.05
          moves.set(key, nearest < 0.1 && proud > DOOR_FIT_PROUD ? n.multiplyScalar(-(proud - DOOR_FIT_PROUD)) : null)
        }
        const move = moves.get(key)
        if (!move) continue
        const v = new Vector3().fromBufferAttribute(position, i).add(move.clone().applyMatrix3(toDoor))
        position.setXYZ(i, v.x, v.y, v.z)
      }
      position.needsUpdate = true
      door.geometry.computeBoundingBox()
      door.geometry.computeBoundingSphere()
    }
  }

  // see COCKPIT_MODEL - loaded on its own, added to the cockpit parts
  // once it is in
  loadCockpitModel(f16) {
    const { url, scale, anchor, hud, remains } = COCKPIT_MODEL
    new GLTFLoader().load(
      url,
      (gltf) => {
        const model = gltf.scene
        model.updateMatrixWorld(true)

        const target = new Vector3(0, ANCHOR_DISTANCE, -ANCHOR_DISTANCE * Math.tan(OVER_NOSE * MathUtils.DEG2RAD)).add(EYE_POSITION)
        const panel = new Object3D()
        panel.name = "CockpitPanel"
        panel.matrixAutoUpdate = false
        panel.matrix
          .makeTranslation(target)
          .multiply(COCKPIT_MODEL_AXES)
          .multiply(new Matrix4().makeScale(scale, scale, scale))
          .multiply(new Matrix4().makeTranslation(anchor.clone().negate()))

        const meshes = []
        model.traverse((mesh) => mesh.isMesh && meshes.push(mesh))
        for (const mesh of meshes) {
          cutOut(mesh, (centre, top) => centre.x < hud.max.x && top.y > hud.min.y && centre.z > hud.min.z && centre.z < hud.max.z)
          for (const box of remains) cutPieces(mesh, box)
        }

        // its top just on the line over the nose - see COCKPIT_MODEL
        const lowest = Math.tan((PANEL_OVER_NOSE - OVER_NOSE) * MathUtils.DEG2RAD)
        const sideways = Math.tan(NOSE_HALF_WIDTH * MathUtils.DEG2RAD)
        let drop = -Infinity
        const point = new Vector3()
        for (const mesh of meshes) {
          const frame = new Matrix4().multiplyMatrices(panel.matrix, mesh.matrixWorld)
          const position = mesh.geometry.attributes.position
          for (const i of mesh.geometry.index.array) {
            point.fromBufferAttribute(position, i).applyMatrix4(frame).sub(EYE_POSITION)
            if (point.y <= 0 || Math.abs(point.x) > point.y * sideways) continue
            drop = Math.max(drop, point.z - Math.hypot(point.x, point.y) * lowest)
          }
        }
        panel.matrix.premultiply(new Matrix4().makeTranslation(0, 0, -drop))

        for (const mesh of meshes) {
          // shaded in fixed, plain white light, without shadows - see
          // cockpitPanelMaterial
          const own = mesh.material
          const toAircraft = new Matrix3().setFromMatrix4(new Matrix4().multiplyMatrices(panel.matrix, mesh.matrixWorld))
          mesh.material = cockpitPanelMaterial(own.map, own.side, toAircraft)
          own.dispose()
        }

        panel.add(model)
        panel.visible = false
        f16.add(panel)
        this.cockpitOnlyParts.push(panel)
        this.nearParts.push(...meshes)
      },
      () => {},
      (error) => console.log("Could not load the cockpit model: " + error),
    )
  }

  // see INTAKE and NOZZLE
  paintIntakeAndNozzle(model) {
    model.parent.updateMatrixWorld(true)
    const toAircraft = new Matrix4().copy(model.parent.matrixWorld).invert()
    const meshes = []
    model.traverse((o) => o.isMesh && meshes.push(o))

    const black = new MeshStandardMaterial({ color: 0x000000, roughness: 1, metalness: 0 })
    black.name = "Intake"
    const [glow, wallGlow] = ["NozzleCore", "NozzleWall"].map((name) => {
      const material = new MeshStandardMaterial({ color: NOZZLE_METAL, emissive: 0x000000, roughness: 0.8, metalness: 0 })
      material.name = name
      return material
    })
    this.nozzleGlows = [glow, wallGlow]

    const body = meshes.filter((m) => [m.material].flat()[0].name === "Body").sort(
      (a, b) => b.geometry.attributes.position.count - a.geometry.attributes.position.count,
    )[0]
    const nozzle = meshes.find((m) => [m.material].flat()[0].name === "Thruster")

    const toAxis = new Vector3()
    // the hot core seen down the nozzle - the end of the fuselage behind the
    // turbine, part of the body, and the turbine face itself
    const inCore = (c) => c.y < NOZZLE.coreAhead && Math.hypot(c.x, c.z - NOZZLE.axisZ) < NOZZLE.coreRadius

    // the nozzle's throat, also part of the body: within the nozzle's radius,
    // behind the core's front - all but the fuselage's own skin round it,
    // which faces away from the centreline
    const inThroat = (c, n) => {
      const radius = Math.hypot(c.x, c.z - NOZZLE.axisZ)
      if (c.y > NOZZLE.coreAhead || radius > NOZZLE.radius) return false
      // the fuselage's aft-facing end, round the nozzle's front, stays dark
      if (radius >= NOZZLE.innerRadius && c.y > NOZZLE.frontY) return false
      toAxis.set(-c.x, 0, NOZZLE.axisZ - c.z)
      return toAxis.lengthSq() < 1e-6 || n.dot(toAxis.normalize()) > -0.2
    }

    splitTriangles(body, toAircraft, (c, n) =>
      inCore(c) ? glow : inThroat(c, n) ? wallGlow : intake(c, n) ? black : null,
    )
    function intake(c, n) {
      const i = INTAKE
      if (c.y < i.minY || Math.abs(c.x) > i.maxAbsX || c.z < i.minZ || c.z > i.maxZ) return false
      // the duct's roof, above its centreline and facing down into it, all the
      // way forward to the mouth - not the belly under the duct, also facing down
      if (c.y <= i.roofMaxY && c.z > i.centreZ && n.z < -0.8) return true
      if (c.y > i.maxY) return false
      // what faces inwards or forwards, out of the duct - not the duct's
      // outer shell, which faces away
      if (n.y > 0.7) return true
      toAxis.set(-c.x, 0, i.centreZ - c.z)
      return toAxis.lengthSq() < 1e-6 || n.dot(toAxis.normalize()) > -0.1
    }

    splitTriangles(nozzle, toAircraft, (c, n) => {
      if (inCore(c)) return glow
      toAxis.set(-c.x, 0, NOZZLE.axisZ - c.z)
      if (toAxis.lengthSq() < 1e-6) return null
      // the lip at the nozzle's very front, where it slides into the fuselage
      if (c.y > NOZZLE.lipY) return null
      const facing = n.dot(toAxis.normalize())
      // the outer shell, facing away from the centreline, keeps its look
      if (facing < -0.2) return null
      // inside: what faces the centreline, the flaps' flanks - facing round
      // it - and the aft-facing ring deep in, forward of the exit's own rim
      // - not the aft-facing edge at the nozzle's front, out at its outer
      // radius, which shows outside as a ring where it meets the fuselage
      const radius = Math.hypot(c.x, c.z - NOZZLE.axisZ)
      if (facing > 0.2 || Math.abs(n.y) < 0.5 || (n.y < -0.5 && c.y > NOZZLE.rimY && (radius < NOZZLE.innerRadius || c.y < NOZZLE.frontY))) {
        return wallGlow
      }
      return null
    })

    // the afterburner's flame, see FLAMES
    this.flames = FLAMES.map((flame) => {
      const mesh = afterburnerFlame(flame)
      mesh.position.set(0, FLAME_EXIT_Y, NOZZLE.axisZ)
      mesh.visible = false
      this.object.add(mesh)
      return { mesh, flame }
    })

    // The turbine face is a hexagon in the model. Its glow is made round: in
    // each mesh that has some of it, the core gets a copy of its material
    // that fades from the core's glow to the wall's outside CORE_GLOW_RADIUS
    // from the nozzle's centreline - see roundGlow.
    this.coreGlows = []
    for (const mesh of [body, nozzle]) {
      const materials = [mesh.material].flat()
      const i = materials.indexOf(glow)
      if (i < 0) continue
      const frame = new Matrix4().multiplyMatrices(toAircraft, mesh.matrixWorld)
      materials[i] = roundGlow(glow, frame)
      this.coreGlows.push(materials[i])
      mesh.material = materials
    }

    // The body's end inside the nozzle reaches out past the nozzle's wall to
    // the fuselage's skin, closing the gap between them - glowing only inside
    // the wall, see insideWall.
    const bodyMaterials = [body.material].flat()
    const wall = bodyMaterials.indexOf(wallGlow)
    if (wall >= 0) {
      bodyMaterials[wall] = insideWall(wallGlow.clone(), new Matrix4().multiplyMatrices(toAircraft, body.matrixWorld))
      this.bodyWall = bodyMaterials[wall]
      body.material = bodyMaterials
    }

    // The nozzle's own materials, moving its flaps (see nozzleMotion). The
    // wall's glow is shared with the body's throat, which doesn't move, so
    // the nozzle gets a copy of it.
    this.nozzleOpen = { value: 1 }
    const nozzleFrame = new Matrix4().multiplyMatrices(toAircraft, nozzle.matrixWorld)
    this.nozzleWall = wallGlow.clone()
    nozzle.material = [nozzle.material].flat().map((material) =>
      nozzleMotion(material === wallGlow ? this.nozzleWall : material, nozzleFrame, this.nozzleOpen),
    )
  }

  /**
   * Sets the nozzle's glow for the engine's power and the eye's adaptation.
   *
   * @param power       engine power, 0..100, afterburner above 50
   * @param adaptation  how far the eye has opened up from its daylight
   *                    adaptation (see SkyDome.adaptation) - the glow is a
   *                    fixed brightness, which shows brighter the darker it is
   */
  setEngine(power, adaptation = 1) {
    if (!this.nozzleGlows) return
    const heat = MathUtils.smoothstep(power, GLOW_FROM_POWER, 50)
    const burner = MathUtils.smoothstep(power, 50, 100)
    this.nozzleGlows.forEach((material, zone) => {
      const strength = heat * MathUtils.lerp(GLOW_MIL.zones[zone], GLOW_AB.zones[zone], burner) * adaptation
      material.emissive.copy(GLOW_MIL.color).lerp(GLOW_AB.color, burner).multiplyScalar(Math.min(strength, GLOW_MAX))
    })
    // the nozzle's opening: fully open at idle and full afterburner, closed
    // at full military power
    this.nozzleOpen.value = power <= 50 ? 1 - MathUtils.smoothstep(power, 0, 50) : MathUtils.smoothstep(power, 50, 100)
    this.nozzleWall.emissive.copy(this.nozzleGlows[1].emissive)
    this.bodyWall?.emissive.copy(this.nozzleGlows[1].emissive)

    // The flame: it grows out of the nozzle as the afterburner lights, and,
    // being light rather than lit, shows more the darker it is - though in
    // daylight it is still plain to see.
    const lit = MathUtils.smoothstep(power, 52, 70)
    const time = performance.now() / 1000
    for (const { mesh, flame } of this.flames) {
      mesh.visible = lit > 0
      if (!mesh.visible) continue
      const size = MathUtils.lerp(0.35, 1, burner)
      mesh.scale.set(1, flame.length * size, 1)
      const u = mesh.material.uniforms
      u.strength.value = flame.strength * lit * Math.min(1.6, 0.6 + 0.12 * adaptation)
      u.time.value = time
    }

    for (const core of this.coreGlows) {
      core.emissive.copy(this.nozzleGlows[0].emissive)
      core.userData.wallEmissive.copy(this.nozzleGlows[1].emissive)
    }
  }

  // the control surface positions for the next update - see update
  setControls(actuators) {
    this.actuators = actuators
  }

  /**
   * Poses the model: the gear from its animation, then the control surfaces
   * and the wheels on top of it.
   *
   * @param gearPosition  0 (up) .. 1 (down), the gear actuator's position
   * @param noseSteer     nosewheel steering angle, degrees, positive right
   * @param strutTravel   {nose, mainL, mainR}, meters each strut is compressed
   */
  update(gearPosition, noseSteer = 0, strutTravel = null) {
    for (const part of this.gearParts) part.visible = gearPosition > 0
    for (const p of this.animatedPose) {
      p.bone.quaternion.copy(p.quaternion)
      p.bone.position.copy(p.position)
    }
    // a millisecond short of the clip's end, the gear up - at the end itself
    // the clip starts over, with the gear down
    this.mixer.setTime((1 - gearPosition) * (this.gearClip.duration - 0.001))
    for (const p of this.animatedPose) {
      p.quaternion.copy(p.bone.quaternion)
      p.position.copy(p.bone.position)
    }
    // the doors are only known shut once the gear is up - see fitDoorsToSkin
    if (gearPosition === 0 && !this.doorsFitted) {
      this.doorsFitted = true
      this.fitDoorsToSkin()
    }

    const a = this.actuators
    if (a) {
      const flaperons = mixFlaperons(a.aileron, a.tef)
      const angle = {
        elevator: a.elevator,
        flaperonLeft: flaperons.left,
        flaperonRight: flaperons.right,
        lef: a.lef,
        rudder: a.rudder,
        speedbrake: a.speedbrake,
      }
      for (const s of this.surfaces) {
        let deg = angle[s.channel] + (s.diff ?? 0) * a.stabilatorDiff
        s.bone.quaternion.multiply(this.rotation.setFromAxisAngle(s.axis, s.sign * deg * MathUtils.DEG2RAD))
      }
    }

    // nosewheel steering, about the fork's own vertical (its local y)
    this.steering.quaternion.multiply(this.rotation.setFromAxisAngle(new Vector3(0, 1, 0), noseSteer * MathUtils.DEG2RAD))

    // each wheel raised by its strut's compression, and the nose wheel onto
    // the landing gear model's contact point with the gear down
    for (const [leg, wheel] of Object.entries(this.wheelBones)) {
      let up = strutTravel?.[leg] ?? 0
      if (leg === "nose") up += NOSE_WHEEL_RAISE * gearPosition
      if (up === 0) continue
      // through the parent's whole transform - it has the uneven scales
      // the model was authored with
      wheel.parent.updateWorldMatrix(true, false)
      this.toLocal.copy(wheel.parent.matrixWorld).invert()
      this.object.getWorldPosition(this.from)
      this.to.set(0, 0, 1).transformDirection(this.object.matrixWorld).multiplyScalar(up).add(this.from)
      this.from.applyMatrix4(this.toLocal)
      wheel.position.add(this.to.applyMatrix4(this.toLocal).sub(this.from))
    }
  }
}
