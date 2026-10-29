import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, Points, ShaderMaterial } from "three"
import { lightStreaks, streakFragmentPars, streakVertex, streakVertexPars } from "./lightStreaks.js"

/*
 * The runways' lights - approach, threshold, edge, centreline, touchdown
 * zone and end lights, with their wing bars - from the runway files (see
 * runways.js). Each file holds, besides a runway's outline, its lights as
 * GeoJSON MultiPoints: tile-local easting and northing, and the height above
 * sea level of the light itself - on the runway, the ground; out on the
 * approach, the structure it stands on. One group of lights per landing
 * direction, system, colour and segment, with the direction's bearing, and
 * an intensity class from the AIP.
 *
 * The slope indicators - PAPI, APAPI, PLASI - change colour with the angle
 * the pilot sees them from: see SLOPE_INDICATORS.
 *
 * Every tile's lights are one point cloud, placed at the tile's corner as
 * the terrain is, so their own coordinates stay small. They are drawn in the
 * terrain's pass, after it, adding their light to what is behind them.
 */

// the systems drawn here - see the comment at the top
const STATIC_SYSTEMS = new Set([
  "approach",
  "approach_crossbar",
  "approach_side_row",
  "threshold",
  "threshold_wingbar",
  "edge",
  "centreline",
  "touchdown_zone",
  "end",
  "end_wingbar",
])

const COLOURS = {
  white: new Color(1.0, 0.92, 0.78), // incandescent-ish, as most runway lights are
  // saturated, as the coloured lenses and LEDs make them - paler, they
  // read as white at a distance
  yellow: new Color(1.0, 0.62, 0.0),
  green: new Color(0.0, 1.0, 0.3),
  red: new Color(1.0, 0.03, 0.01),
}

// How bright each intensity class is, and how far off, in meters, a light
// of it still shows at full strength before it fades with the square of
// the distance. High intensity lights carry a good 10 km at night.
const INTENSITY = { LIH: 1.0, "LIL/LIH": 1.0, LIM: 0.7, LIL: 0.45 }
// the centreline lights' strength, whatever their own class
const CENTRELINE_INTENSITY = 0.7
const FULL_STRENGTH_RANGE = 1200 // m, for a light of intensity 1

// The lights shine back along the approach, towards aircraft landing in
// their group's direction: at full strength within BEAM_HALF_WIDTH of it,
// fading out by BEAM_EDGE, and outside that only OMNI of it - which is
// how one set of edge lights shows white from one end and yellow from the
// other, as two groups of lights in the same places
const BEAM_HALF_WIDTH = 30 // degrees, either side
const BEAM_EDGE = 75 // degrees
const OMNI = { edge: 0.25, centreline: 0.25 } // others: OMNI_DEFAULT
const OMNI_DEFAULT = 0.1

// On screen: how large a light is at 1 m, and the smallest and largest it
// gets drawn, in pixels at a pixel ratio of 1
const SIZE_AT_1M = 300
const MIN_SIZE = 2.0
const MAX_SIZE = 14

// Lit, a runway light is far brighter than anything round it. Seen through
// the sky's exposure (sky.adaptation), it is faint against noon's daylight
// and stands out at dusk and night, as the real ones do. BRIGHTNESS is
// what one shows as at the reference daylight, close by.
const BRIGHTNESS = 0.048

// Seen through the exposure alone, the lights only came up to their night
// look well after sunset. So they don't drop below NIGHT_BRIGHTNESS - the
// look they have once the exposure has opened up that far - from
// FULL_AT_ADAPTATION, about the sunset's exposure, easing down to nothing
// by DAY_ADAPTATION, the afternoon's, with the sun some 9 degrees up. In
// brighter daylight than that they are off. See brightnessFor.
const NIGHT_BRIGHTNESS = 3
// and at night they go no brighter than this: with the exposure fully open
// they came out 16 times the twilight's, a sudden step up an hour or so
// after sunset
const MAX_BRIGHTNESS = 5
const FULL_AT_ADAPTATION = 3.5
const DAY_ADAPTATION = 1.6

// the lights' brightness for the sky's exposure - see NIGHT_BRIGHTNESS
function brightnessFor(adaptation) {
  const t = Math.log(adaptation / DAY_ADAPTATION) / Math.log(FULL_AT_ADAPTATION / DAY_ADAPTATION)
  const s = Math.min(1, Math.max(0, t))
  if (s === 0) return 0 // daylight: off
  const floor = NIGHT_BRIGHTNESS * s * s * (3 - 2 * s)
  return Math.min(MAX_BRIGHTNESS, Math.max(BRIGHTNESS * adaptation, floor))
}

// Sequenced flashing lights, on approach light systems that have them: a
// flasher at the middle of each centreline light bar, firing in turn from
// the outer end towards the threshold, SFL_RATE times a second, each for
// SFL_ON of the run. They are far brighter than the steady lights, and a
// little bluer, as the real strobes are.
const SFL_RATE = 2 // runs a second
const SFL_ON = 0.05 // share of a run each flasher is lit
const SFL_INTENSITY = 2.5
// and they show larger, the glare round a strobe - however bright, a light
// drawn the size of the steady ones round it is lost among them
const SFL_SIZE = 4
const SFL_COLOUR = new Color(0.85, 0.92, 1.0)
// the approach lights within this of each other along the approach are one
// light bar
const SFL_BAR_SPACING = 10 // m

// how much less the haze dims a light than it does the terrain - a light
// shows through far more haze than ground detail does
const HAZE_SHARE = 0.35

// The screen clips each colour channel at 1, so a light much brighter than
// that came out white whatever its colour - a green threshold light five
// times over is white. So a light's colour is never brighter than its own
// full colour, and what it has beyond that widens its glow instead, by
// GLOW_GROWTH for every doubling.
const GLOW_GROWTH = 0.35

// how much brighter a light is drawn towards the edges of the view, at most
// - see EDGE_GAIN_MAX in sceneryLights.js
const EDGE_GAIN_MAX = 2.5

// the lights are drawn this share of their distance nearer the camera, so
// the terrain they stand on never hides them where the depth buffer's
// resolution runs out, far off
const DEPTH_PULL = 0.003

const vertexShader = /* glsl */ `
  uniform float pixelRatio;
  uniform float brightness;
  uniform float hazeDensity;
  uniform vec3 eye; // the camera, tile-local
  uniform float time;

  attribute vec3 color;
  attribute vec2 beam; // the way the light shines, horizontally
  attribute float omni;
  attribute float intensity;
  attribute float flash; // a flasher's place in its run, 0 to 1 - or -1
  ${streakVertexPars}

  varying vec3 vColor;

  void main() {
    vec3 toEye = eye - position;
    float distance = length(toEye);

    // its beam, towards approaching aircraft
    float along = dot(normalize(toEye.xy), beam);
    float angle = degrees(acos(clamp(along, -1.0, 1.0)));
    float inBeam = 1.0 - smoothstep(${BEAM_HALF_WIDTH.toFixed(1)}, ${BEAM_EDGE.toFixed(1)}, angle);
    float directional = max(inBeam, omni);

    // full strength out to its range, then fading with distance squared,
    // and dimmed by the haze in between
    float range = ${FULL_STRENGTH_RANGE.toFixed(1)} * sqrt(intensity);
    float falloff = min(1.0, (range * range) / (distance * distance));
    float haze = exp(-hazeDensity * ${HAZE_SHARE.toFixed(3)} * distance);
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    float offAxis = -viewPosition.z / length(viewPosition.xyz);
    float edgeGain = min(1.0 / max(offAxis * offAxis * offAxis, 0.001), ${EDGE_GAIN_MAX.toFixed(1)});
    float energy = brightness * intensity * directional * falloff * haze * edgeGain;
    vColor = color * min(energy, 1.0);

    // a sequenced flasher, lit for its moment of the run - see SFL_RATE
    float lit = 1.0;
    if (flash >= 0.0) {
      float since = fract(time * ${SFL_RATE.toFixed(1)}) - flash;
      lit = step(0.0, since) * step(since, ${SFL_ON.toFixed(3)});
      vColor *= lit;
    }

    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    mvPosition.xyz *= 1.0 - ${DEPTH_PULL.toFixed(4)};
    gl_Position = projectionMatrix * mvPosition;
    gl_PointSize = pixelRatio * clamp(${SIZE_AT_1M.toFixed(1)} / distance, ${MIN_SIZE.toFixed(1)}, ${MAX_SIZE.toFixed(1)});
    gl_PointSize *= 1.0 + ${GLOW_GROWTH.toFixed(2)} * log2(max(energy * lit, 1.0));
    if (flash >= 0.0) gl_PointSize *= ${SFL_SIZE.toFixed(1)};
    if (directional * falloff * haze * lit < 0.002) gl_PointSize = 0.0;
    ${streakVertex}
  }
`

const fragmentShader = /* glsl */ `
  varying vec3 vColor;
  ${streakFragmentPars}

  void main() {
    // a bright core with a soft glow round it, drawn along its streak
    float r = streakDistance();
    if (r > 1.0) discard;
    float glow = exp(-r * r * 5.0) + 0.6 * (1.0 - smoothstep(0.0, 0.35, r));
    gl_FragColor = vec4(vColor * glow * vStreakShare, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

/*
 * Slope indicators: PAPI (four units a side, or one side only), APAPI (two)
 * and PLASI (one). Each unit shows white above the angle it is set to, and
 * red below - so from the runway outwards, a PAPI's units are set to the
 * approach angle plus 30', plus 10', less 10' and less 30', and on the
 * approach slope the pilot sees the two nearest the runway red and the two
 * outer ones white. An APAPI's two are set 15' either side of it. Between
 * red and white each unit turns pink over TRANSITION. The colours are seen
 * from the pilot's eye whatever the view, so the indication stays a pilot's
 * one in the external views too.
 *
 * A PLASI is one unit, its colour and pulsing showing how far off the slope
 * the eye is: pulsing white above PLASI_ON_SLOPE, steady white within it,
 * steady red down to PLASI_SLIGHTLY_BELOW, and pulsing red under that - the
 * bands vary between makes, so these are typical values.
 *
 * Where they stand: the files' positions are estimates. The AIP's MEHT -
 * the eye height over the threshold at the lowest on-slope signal - fixes
 * how far along the runway the units are: MEHT over the tangent of the
 * lower edge of the on-slope band. So the units are moved along the runway
 * to that, keeping their distance from its centreline, and set to the
 * runway's height there - a couple of meters off in height, at 300 m, is
 * more than the 20' between two units.
 */
const SLOPE_INDICATORS = {
  papi: { settings: [30, 10, -10, -30], onSlopeLow: -10 },
  apapi: { settings: [15, -15], onSlopeLow: -15 },
  plasi: { settings: [0], onSlopeLow: -15 },
}
const TRANSITION = 1.5 / 60 // degrees, half the width of the pink band
const PLASI_ON_SLOPE = 0.25 // degrees, either side
const PLASI_SLIGHTLY_BELOW = 0.5 // degrees
const PLASI_PULSE_HZ = 2
const SLOPE_INTENSITY = 1.3
const SLOPE_OMNI = 0.03
// They are on by day too, as the real ones are - at least this bright
const SLOPE_DAY_BRIGHTNESS = 0.5
// the fitting's height over the runway
const FITTING_HEIGHT = 0.3 // m
// The units stand at the runway's height, which their angles are measured
// from - but the terrain beside a runway can lie a couple of meters higher
// than the runway itself: 5.0-5.6 m beside Molde's runway 07 on its north
// side, against 3.0 m on it. Drawn there, they were inside the terrain, and
// the rising ground hid them on short final. So once the terrain's height
// there is known, each unit is drawn on the terrain where that is higher -
// its colours still worked out from where it stands. See groundSlopeIndicators.

const slopeVertexShader = /* glsl */ `
  uniform float pixelRatio;
  uniform float brightness;
  uniform float hazeDensity;
  uniform float time;
  uniform vec3 eye; // the camera, tile-local
  uniform vec3 pilot; // the pilot's eye, tile-local

  attribute vec2 beam;
  attribute float setting; // degrees above the horizontal
  attribute float plasi; // 1 for a PLASI, 0 for a PAPI or APAPI unit
  attribute vec3 standing; // where it stands, which its angles are from
  ${streakVertexPars}

  varying vec3 vColor;

  const vec3 white = vec3(${COLOURS.white.toArray().map((v) => v.toFixed(3)).join(", ")});
  const vec3 red = vec3(${COLOURS.red.toArray().map((v) => v.toFixed(3)).join(", ")});

  void main() {
    vec3 toPilot = pilot - standing;
    float seenAt = degrees(atan(toPilot.z, length(toPilot.xy)));
    float off = seenAt - setting;

    vec3 colour;
    float strength = 1.0;
    float pulse = step(0.5, fract(time * ${PLASI_PULSE_HZ.toFixed(1)}));
    if (plasi > 0.5) {
      bool above = off > ${PLASI_ON_SLOPE.toFixed(3)};
      bool onSlope = abs(off) <= ${PLASI_ON_SLOPE.toFixed(3)};
      bool slightlyBelow = off < -${PLASI_ON_SLOPE.toFixed(3)} && off >= -${PLASI_SLIGHTLY_BELOW.toFixed(3)};
      colour = above || onSlope ? white : red;
      if (!(onSlope || slightlyBelow)) strength = 0.1 + 0.9 * pulse;
    } else {
      colour = mix(red, white, smoothstep(-${TRANSITION.toFixed(4)}, ${TRANSITION.toFixed(4)}, off));
    }

    vec3 toEye = eye - position;
    float distance = length(toEye);
    float along = dot(normalize(toEye.xy), beam);
    float angle = degrees(acos(clamp(along, -1.0, 1.0)));
    float directional = max(1.0 - smoothstep(${BEAM_HALF_WIDTH.toFixed(1)}, ${BEAM_EDGE.toFixed(1)}, angle), ${SLOPE_OMNI.toFixed(3)});
    float range = ${FULL_STRENGTH_RANGE.toFixed(1)} * sqrt(${SLOPE_INTENSITY.toFixed(2)});
    float falloff = min(1.0, (range * range) / (distance * distance));
    float haze = exp(-hazeDensity * ${HAZE_SHARE.toFixed(3)} * distance);
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    float offAxis = -viewPosition.z / length(viewPosition.xyz);
    float edgeGain = min(1.0 / max(offAxis * offAxis * offAxis, 0.001), ${EDGE_GAIN_MAX.toFixed(1)});
    float energy = brightness * ${SLOPE_INTENSITY.toFixed(2)} * strength * directional * falloff * haze * edgeGain;
    vColor = colour * min(energy, 1.0);

    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    mvPosition.xyz *= 1.0 - ${DEPTH_PULL.toFixed(4)};
    gl_Position = projectionMatrix * mvPosition;
    gl_PointSize = pixelRatio * clamp(${SIZE_AT_1M.toFixed(1)} / distance, ${MIN_SIZE.toFixed(1)}, ${MAX_SIZE.toFixed(1)});
    gl_PointSize *= 1.0 + ${GLOW_GROWTH.toFixed(2)} * log2(max(energy, 1.0));
    if (directional * falloff * haze < 0.002) gl_PointSize = 0.0;
    ${streakVertex}
  }
`

// a group of lights' key, the same in every tile's file - "ENML/07-25/07"
const runwayKey = (feature) => `${feature.id.split("/")[0]}/${feature.properties.runway}/${feature.properties.direction}`

/**
 * The thresholds in a tile's file - the middle of each landing direction's
 * threshold lights, in the scene's own coordinates. Many smaller runways
 * have no threshold lights in the files, only wing bars - rows either side
 * of the threshold - and the middle of those is where it is too.
 *
 * @param corner    the tile's lower left corner, [easting, northing]
 * @param features  the file's features
 * @returns [runwayKey, [x, y, z], fromWingBars] - fromWingBars true for a
 *          threshold found from its wing bars, which the lights themselves,
 *          where there are any, take precedence over
 */
export function thresholdsIn(corner, features) {
  return features
    .filter((f) => f.properties.aeroway === "light" && ["threshold", "threshold_wingbar"].includes(f.properties.system))
    .map((f) => {
      const c = f.geometry.coordinates
      const mean = (i) => c.reduce((sum, p) => sum + p[i], 0) / c.length
      return [runwayKey(f), [corner[0] + mean(0), corner[1] + mean(1), mean(2)], f.properties.system === "threshold_wingbar"]
    })
}

/**
 * An approach light system's sequenced flashers - see SFL_RATE: one at the
 * middle of each of its centreline light bars, with its place in the run,
 * from 0 at the outer end to under 1 at the threshold's.
 */
function flashers(feature) {
  const bearing = (feature.properties.landingBearingGrid * Math.PI) / 180
  const ux = Math.sin(bearing)
  const uy = Math.cos(bearing)
  const lights = feature.geometry.coordinates
    .map(([x, y, z]) => ({ x, y, z, along: x * ux + y * uy }))
    .sort((a, b) => a.along - b.along)

  const bars = []
  for (const light of lights) {
    const bar = bars.at(-1)
    if (bar && light.along - bar.at(-1).along < SFL_BAR_SPACING) bar.push(light)
    else bars.push([light])
  }
  const mean = (bar, key) => bar.reduce((sum, light) => sum + light[key], 0) / bar.length
  return bars.map((bar, i) => ({
    x: mean(bar, "x"),
    y: mean(bar, "y"),
    z: mean(bar, "z"),
    beam: [-ux, -uy],
    order: i / bars.length,
  }))
}

export default class RunwayLights {
  /**
   * @param scene         the terrain's scene
   * @param groundHeight  (tileName, x, y) -> the terrain's height there, tile-
   *                      local, or null while that tile's terrain isn't ready
   */
  constructor(scene, groundHeight = () => null) {
    this.scene = scene
    this.groundHeight = groundHeight
    // tileName -> the tile's point cloud, while it is loaded
    this.clouds = new Map()
    this.uniforms = {
      pixelRatio: { value: 1 },
      brightness: { value: BRIGHTNESS },
      hazeDensity: { value: 0 },
      eye: { value: null },
    }
    this.slopeBrightness = { value: SLOPE_DAY_BRIGHTNESS }
    this.time = { value: 0 }
    this.uniforms.time = this.time
    // tileName -> the tile's slope indicators, while it is loaded
    this.slopeClouds = new Map()
  }

  /**
   * Shows a tile's lights.
   *
   * @param tileName    "{lowerLeftEasting}-{lowerLeftNorthing}"
   * @param features    the tile's runway file's features
   * @param thresholds  runwayKey -> threshold, in the scene's coordinates,
   *                    from every runway file read so far - see thresholdsIn
   */
  add(tileName, features, thresholds = new Map()) {
    if (this.clouds.has(tileName) || this.slopeClouds.has(tileName)) return
    const [, x, y] = tileName.match(/^(-?\d+)-(-?\d+)$/).map(Number)
    this.addSlopeIndicators(tileName, [x, y], features, thresholds)

    const positions = []
    const colours = []
    const beams = []
    const omnis = []
    const intensities = []
    const flashes = []
    for (const feature of features) {
      const p = feature.properties
      if (p.aeroway !== "light" || !STATIC_SYSTEMS.has(p.system)) continue
      if (p.system === "approach" && p.sequencedFlashing) {
        for (const flasher of flashers(feature)) {
          positions.push(flasher.x, flasher.y, flasher.z + 0.3)
          colours.push(SFL_COLOUR.r, SFL_COLOUR.g, SFL_COLOUR.b)
          beams.push(flasher.beam[0], flasher.beam[1])
          omnis.push(0) // only towards their own approach, as the real ones
          intensities.push(SFL_INTENSITY)
          flashes.push(flasher.order)
        }
      }
      if (feature.geometry?.type !== "MultiPoint") continue

      // towards aircraft landing this way: back along the landing bearing
      const bearing = (p.landingBearingGrid * Math.PI) / 180
      const beam = [-Math.sin(bearing), -Math.cos(bearing)]
      const intensity = p.system === "centreline" ? CENTRELINE_INTENSITY : (INTENSITY[p.intensity] ?? INTENSITY.LIH)
      const omni = OMNI[p.system] ?? OMNI_DEFAULT

      feature.geometry.coordinates.forEach(([px, py, pz], i) => {
        // "red/white" alternates, light by light
        const name = p.colour === "red/white" ? (i % 2 ? "red" : "white") : p.colour
        const colour = COLOURS[name] ?? COLOURS.white
        positions.push(px, py, pz + 0.3)
        colours.push(colour.r, colour.g, colour.b)
        beams.push(...beam)
        omnis.push(omni)
        intensities.push(intensity)
        flashes.push(-1)
      })
    }
    if (positions.length === 0) return

    const geometry = new BufferGeometry()
    geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3))
    geometry.setAttribute("color", new BufferAttribute(new Float32Array(colours), 3))
    geometry.setAttribute("beam", new BufferAttribute(new Float32Array(beams), 2))
    geometry.setAttribute("omni", new BufferAttribute(new Float32Array(omnis), 1))
    geometry.setAttribute("intensity", new BufferAttribute(new Float32Array(intensities), 1))
    geometry.setAttribute("flash", new BufferAttribute(new Float32Array(flashes), 1))

    // each cloud has its own camera position, tile-local
    const uniforms = { ...this.uniforms, ...lightStreaks.uniforms(), eye: { value: new Float32Array(3) } }
    const material = new ShaderMaterial({
      uniforms,
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    })

    const cloud = new Points(geometry, material)
    cloud.name = `runwayLights ${tileName}`
    cloud.position.set(x, y, 0)
    cloud.frustumCulled = false
    cloud.renderOrder = 1
    cloud.userData.corner = [x, y]
    this.scene.add(cloud)
    this.clouds.set(tileName, cloud)
  }

  /** Hides a tile's lights, once the tile itself is unloaded. */
  remove(tileName) {
    for (const clouds of [this.clouds, this.slopeClouds]) {
      const cloud = clouds.get(tileName)
      if (!cloud) continue
      this.scene.remove(cloud)
      cloud.geometry.dispose()
      cloud.material.dispose()
      clouds.delete(tileName)
    }
  }

  // Sets a tile's slope indicators on the terrain where that lies higher than
  // where they stand - once its terrain is ready. See FITTING_HEIGHT.
  groundSlopeIndicators(cloud) {
    const standing = cloud.geometry.attributes.standing
    const heights = []
    for (let i = 0; i < standing.count; i++) {
      const height = this.groundHeight(cloud.userData.tileName, standing.getX(i), standing.getY(i))
      if (height === null) return
      heights.push(height)
    }
    const position = cloud.geometry.attributes.position
    heights.forEach((height, i) => position.setZ(i, Math.max(standing.getZ(i), height + FITTING_HEIGHT)))
    position.needsUpdate = true
    cloud.userData.grounded = true
  }

  // see SLOPE_INDICATORS
  addSlopeIndicators(tileName, [x, y], features, thresholds) {
    // the runway's lights in this file, to take its height from
    const runwayLights = features.filter(
      (f) => f.properties.aeroway === "light" && (f.properties.system === "edge" || f.properties.system === "centreline"),
    )

    const positions = []
    const beams = []
    const settings = []
    const plasis = []
    for (const feature of features) {
      const p = feature.properties
      const kind = SLOPE_INDICATORS[p.system]
      if (p.aeroway !== "light" || !kind || feature.geometry?.type !== "MultiPoint") continue

      const bearing = (p.landingBearingGrid * Math.PI) / 180
      const ux = Math.sin(bearing)
      const uy = Math.cos(bearing)
      const units = feature.geometry.coordinates.map(([px, py, pz]) => ({ x: px, y: py, z: pz }))

      // along the runway from the threshold, and across from its centreline
      const threshold = thresholds.get(runwayKey(feature))
      const t = threshold ? { x: threshold[0] - x, y: threshold[1] - y } : null
      if (t) {
        const meht = p.mehtFt * 0.3048
        const distance = meht / Math.tan(((p.approachAngleDeg + kind.onSlopeLow / 60) * Math.PI) / 180)
        const along = units.reduce((sum, u) => sum + (u.x - t.x) * ux + (u.y - t.y) * uy, 0) / units.length
        for (const u of units) {
          u.x += (distance - along) * ux
          u.y += (distance - along) * uy
        }
      }

      // the runway's height there, from its lights nearest along it
      const along = (px, py) => px * ux + py * uy
      for (const u of units) {
        let nearest = Infinity
        for (const f of runwayLights) {
          for (const [lx, ly, lz] of f.geometry.coordinates) {
            const gap = Math.abs(along(lx, ly) - along(u.x, u.y))
            const across = Math.abs((lx - u.x) * uy - (ly - u.y) * ux)
            if (across < 120 && gap < nearest) {
              nearest = gap
              u.z = lz
            }
          }
        }
      }

      // each side's units, from the runway outwards
      const centre = t ?? { x: units[0].x, y: units[0].y }
      const across = (u) => (u.x - centre.x) * uy - (u.y - centre.y) * ux
      const sides = [units.filter((u) => across(u) < 0), units.filter((u) => across(u) >= 0)]
      for (const side of sides) {
        side.sort((a, b) => Math.abs(across(a)) - Math.abs(across(b)))
        side.forEach((u, i) => {
          // a side with an unexpected number of units gets settings spread
          // evenly over the usual range
          const offset =
            side.length === kind.settings.length
              ? kind.settings[i]
              : kind.settings[0] + ((kind.settings.at(-1) - kind.settings[0]) * i) / Math.max(1, side.length - 1)
          positions.push(u.x, u.y, u.z + FITTING_HEIGHT)
          beams.push(-ux, -uy)
          settings.push(p.approachAngleDeg + offset / 60)
          plasis.push(p.system === "plasi" ? 1 : 0)
        })
      }
    }
    if (positions.length === 0) return

    const geometry = new BufferGeometry()
    geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3))
    geometry.setAttribute("beam", new BufferAttribute(new Float32Array(beams), 2))
    geometry.setAttribute("setting", new BufferAttribute(new Float32Array(settings), 1))
    geometry.setAttribute("plasi", new BufferAttribute(new Float32Array(plasis), 1))
    geometry.setAttribute("standing", new BufferAttribute(new Float32Array(positions), 3))

    const material = new ShaderMaterial({
      uniforms: {
        pixelRatio: this.uniforms.pixelRatio,
        hazeDensity: this.uniforms.hazeDensity,
        brightness: this.slopeBrightness,
        time: this.time,
        eye: { value: new Float32Array(3) },
        pilot: { value: new Float32Array(3) },
        ...lightStreaks.uniforms(),
      },
      vertexShader: slopeVertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    })
    const cloud = new Points(geometry, material)
    cloud.name = `slopeIndicators ${tileName}`
    cloud.position.set(x, y, 0)
    cloud.frustumCulled = false
    cloud.renderOrder = 1
    cloud.userData.corner = [x, y]
    this.scene.add(cloud)
    cloud.userData.tileName = tileName
    cloud.userData.grounded = false
    this.slopeClouds.set(tileName, cloud)
  }

  /**
   * @param camera      the camera drawing the terrain
   * @param adaptation  the sky's exposure, against the reference daylight's
   * @param hazeDensity the haze's, share of light lost per meter
   * @param pixelRatio  the renderer's
   * @param pilotEye    where the pilot's eyes are, in the scene - what the
   *                    slope indicators' colours are seen from
   * @param time        seconds, for pulsing lights
   */
  update(camera, adaptation, hazeDensity, pixelRatio, pilotEye, time) {
    this.uniforms.brightness.value = brightnessFor(adaptation)
    this.slopeBrightness.value = Math.max(SLOPE_DAY_BRIGHTNESS, this.uniforms.brightness.value)
    this.time.value = time
    for (const cloud of this.slopeClouds.values()) {
      if (!cloud.userData.grounded) this.groundSlopeIndicators(cloud)
      lightStreaks.updateCloud(cloud)
      const [x, y] = cloud.userData.corner
      cloud.material.uniforms.eye.value.set([camera.position.x - x, camera.position.y - y, camera.position.z])
      cloud.material.uniforms.pilot.value.set([pilotEye.x - x, pilotEye.y - y, pilotEye.z])
    }
    this.uniforms.hazeDensity.value = hazeDensity
    this.uniforms.pixelRatio.value = pixelRatio
    for (const cloud of this.clouds.values()) {
      lightStreaks.updateCloud(cloud)
      const [x, y] = cloud.userData.corner
      cloud.material.uniforms.eye.value.set([camera.position.x - x, camera.position.y - y, camera.position.z])
    }
  }
}
