import {
  AdditiveBlending,
  AnimationMixer,
  Color,
  CylinderGeometry,
  DoubleSide,
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
 * The F-16 model in f16-3/f16.glb (converted from f16-2 - see its own
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
// nearly charcoal, so the painted parts are brightened by this - the same
// treatment the earlier model's paint got (PAINT_BRIGHTNESS in index.js),
// and bringing them to the same brightness in the same light.
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

// the cockpit's own parts, shown unshaded from the cockpit - see
// paintCockpitInterior in index.js
const COCKPIT_INTERIOR = ["Cockpit002", "Control"]

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
      "f16-3/f16.glb",
      (gltf) => onLoad(new F16Rig(f16, gltf)),
      () => {},
      (error) => console.log("Could not load the F-16 model: " + error),
    )
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
    this.cockpitUnshadowedParts = meshesOf(parts(COCKPIT_UNSHADOWED))
    this.cockpitInteriorParts = meshesOf(parts(COCKPIT_INTERIOR)).map((mesh) => ({
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

    this.actuators = null
    this.rotation = new Quaternion()
    this.toLocal = new Matrix4()
    this.from = new Vector3()
    this.to = new Vector3()
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
