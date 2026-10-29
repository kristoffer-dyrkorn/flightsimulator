import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, Points, ShaderMaterial } from "three"
import { SERVER } from "./tile.js"
import { lightStreaks, streakFragmentPars, streakVertex, streakVertexPars } from "./lightStreaks.js"

/*
 * Lights on the ground at night - from buildings, and street lights along
 * the larger roads - one optional file per terrain tile, src/scenery/
 * {tileName}.json, named like the tile's own GLB/KTX2. GeoJSON MultiPoints:
 * tile-local easting and northing, and the light's height above sea level.
 * A building's light is grouped by the building's category and size, a
 * street light by the road's class.
 *
 * Every terrain tile's file is asked for when the tile loads - most of the
 * country has none, and a missing one is no lights, not an error: a 404 or
 * 403 (what S3 answers for a file that isn't there), or anything that isn't
 * JSON (what a development server answers with its index page). Each file
 * is asked for once while its tile stays loaded. That there is none is
 * remembered for good; a tile's lights are let go with the tile, and asked
 * for again - usually from the browser's cache - if it loads again, so a
 * long flight across the country doesn't pile them up in memory.
 *
 * Each tile's lights are one point cloud, placed at the tile's corner as the
 * terrain is, so their own coordinates stay small, shown while the tile is
 * loaded. They shine the same way all round, and fade in as the sun sets -
 * see brightnessFor.
 */

// Colours: homes and cabins warm, as their windows are; workplaces and
// public buildings a cooler white, as their fluorescent and LED lighting;
// the street lights the orange of the sodium lamps still common along
// Norwegian roads
const COLOURS = {
  residential: new Color(1.0, 0.72, 0.42),
  cabin: new Color(1.0, 0.68, 0.38),
  farm: new Color(1.0, 0.75, 0.48),
  commercial: new Color(0.95, 0.95, 1.0),
  industrial: new Color(0.9, 0.95, 1.0),
  public: new Color(1.0, 0.92, 0.82),
  other: new Color(1.0, 0.82, 0.62),
  street: new Color(1.0, 0.6, 0.22),
}
const SIZES = { small: 0.6, medium: 1.0, large: 1.6 }
const STREET_STRENGTH = 0.9

// Not every building has its lights on: this share of them, in each
// category, are dark - picked by a hash of their position, so the same ones
// every time. And the lit ones vary in strength by up to VARIATION either way.
const DARK = { cabin: 0.6, farm: 0.3, industrial: 0.4, other: 0.5 } // others: DARK_DEFAULT
const DARK_DEFAULT = 0.2
const VARIATION = 0.35

// How bright the strongest is at night, close by - kept below the runway
// lights' - how far off it stays at full strength before fading with the
// distance, and how much less the haze dims it than the terrain. Each light
// is far smaller than a pixel from any distance, so it fades with the
// distance itself, not its square, as a point of light does to the eye -
// the lights of a town stay in sight from well beyond ten kilometres.
const BRIGHTNESS = 1.6
const FULL_STRENGTH_RANGE = 1500 // m
const HAZE_SHARE = 0.4

// They come on as the daylight goes: off with the sky's exposure below
// ON_FROM_ADAPTATION, the sun some 4 degrees up, fully on from
// FULL_AT_ADAPTATION, the sun some 6 degrees down
const ON_FROM_ADAPTATION = 2.2
const FULL_AT_ADAPTATION = 10

// On screen, pixels at a pixel ratio of 1
const SIZE_AT_1M = 120
const MIN_SIZE = 1.5
const MAX_SIZE = 6
// A wide view stretches its edges: a light there takes up more of the
// screen's area per degree of view, by 1/cos^3 of its angle off the view's
// axis - some three times at 45 degrees - so with every light drawn the
// same few pixels, the lights thinned out and dimmed towards the edges, and
// bunched up brighter in the middle. So each is made brighter by that much,
// up to EDGE_GAIN_MAX, which keeps the light per area of screen the same.
const EDGE_GAIN_MAX = 2.5

// drawn this share of their distance nearer the camera, so the terrain they
// stand on doesn't hide them far off - see runwayLights.js
const DEPTH_PULL = 0.003

// the lights' brightness for the sky's exposure - see ON_FROM_ADAPTATION
function brightnessFor(adaptation) {
  const t = Math.log(adaptation / ON_FROM_ADAPTATION) / Math.log(FULL_AT_ADAPTATION / ON_FROM_ADAPTATION)
  const s = Math.min(1, Math.max(0, t))
  return BRIGHTNESS * s * s * (3 - 2 * s)
}

// a number from 0 to 1, the same for the same place every time
function hash(x, y) {
  const h = Math.sin(x * 12.9898 + y * 78.233) * 43758.5453
  return h - Math.floor(h)
}

const vertexShader = /* glsl */ `
  uniform float pixelRatio;
  uniform float brightness;
  uniform float hazeDensity;
  uniform vec3 eye; // the camera, tile-local

  attribute vec3 color;
  attribute float strength;

  varying vec3 vColor;
  ${streakVertexPars}

  void main() {
    float distance = length(eye - position);
    float range = ${FULL_STRENGTH_RANGE.toFixed(1)} * sqrt(strength);
    float falloff = min(1.0, range / distance);
    float haze = exp(-hazeDensity * ${HAZE_SHARE.toFixed(3)} * distance);
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    // see EDGE_GAIN_MAX
    float offAxis = -mvPosition.z / length(mvPosition.xyz);
    float edgeGain = min(1.0 / max(offAxis * offAxis * offAxis, 0.001), ${EDGE_GAIN_MAX.toFixed(1)});

    float energy = brightness * strength * falloff * haze * edgeGain;
    // never brighter than its own colour, or it clips to white on screen
    vColor = color * min(energy, 1.0);

    mvPosition.xyz *= 1.0 - ${DEPTH_PULL.toFixed(4)};
    gl_Position = projectionMatrix * mvPosition;
    gl_PointSize = pixelRatio * clamp(${SIZE_AT_1M.toFixed(1)} / distance, ${MIN_SIZE.toFixed(1)}, ${MAX_SIZE.toFixed(1)});
    if (energy < 0.01) gl_PointSize = 0.0;
    ${streakVertex}
  }
`

const fragmentShader = /* glsl */ `
  varying vec3 vColor;
  ${streakFragmentPars}

  void main() {
    // a small bright core with a soft glow round it, drawn along its streak
    float r = streakDistance();
    if (r > 1.0) discard;
    float glow = exp(-r * r * 6.0);
    gl_FragColor = vec4(vColor * glow * vStreakShare, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

export default class SceneryLights {
  constructor(scene) {
    this.scene = scene
    // tileName -> the tile's point cloud, while it is loaded
    this.clouds = new Map()
    // tileName -> its file's fetch, once started
    this.fetches = new Map()
    this.active = new Set()
    this.level = 0
    this.uniforms = {
      pixelRatio: { value: 1 },
      brightness: { value: 0 },
      hazeDensity: { value: 0 },
    }
  }

  /**
   * Shows a tile's lights, once its file is in - call when the tile loads.
   *
   * @param tileName  "{lowerLeftEasting}-{lowerLeftNorthing}"
   */
  load(tileName) {
    this.active.add(tileName)
    if (!this.fetches.has(tileName)) {
      this.fetches.set(
        tileName,
        fetch(`${SERVER}/scenery/${tileName}.json`)
          .then((response) => {
            // see the comment at the top: anything but a JSON file is no lights
            const json = (response.headers.get("content-type") ?? "").includes("json")
            return response.ok && json ? response.json() : null
          })
          .then((geojson) => (Array.isArray(geojson?.features) && geojson.features.length > 0 ? geojson.features : null))
          .catch(() => null),
      )
    }
    this.fetches.get(tileName).then((features) => {
      if (features && this.active.has(tileName) && !this.clouds.has(tileName)) this.add(tileName, features)
    })
  }

  /** Hides a tile's lights - call when the tile is unloaded. */
  unload(tileName) {
    this.active.delete(tileName)
    // forget its lights, keeping only that a tile has none - see the top
    const fetched = this.fetches.get(tileName)
    fetched?.then((features) => {
      if (features && !this.active.has(tileName) && this.fetches.get(tileName) === fetched) this.fetches.delete(tileName)
    })
    const cloud = this.clouds.get(tileName)
    if (!cloud) return
    this.scene.remove(cloud)
    cloud.geometry.dispose()
    cloud.material.dispose()
    this.clouds.delete(tileName)
  }

  add(tileName, features) {
    const [, x, y] = tileName.match(/^(-?\d+)-(-?\d+)$/).map(Number)

    const positions = []
    const colours = []
    const strengths = []
    for (const feature of features) {
      const p = feature.properties
      if (feature.geometry?.type !== "MultiPoint") continue
      const street = p.kind === "street_light"
      const colour = street ? COLOURS.street : (COLOURS[p.category] ?? COLOURS.other)
      const base = street ? STREET_STRENGTH : (SIZES[p.size] ?? SIZES.medium)
      const dark = street ? 0 : (DARK[p.category] ?? DARK_DEFAULT)

      for (const [px, py, pz] of feature.geometry.coordinates) {
        const h = hash(x + px, y + py)
        if (h < dark) continue
        const variation = 1 + VARIATION * (2 * hash(y + py, x + px) - 1)
        positions.push(px, py, pz)
        colours.push(colour.r, colour.g, colour.b)
        strengths.push(base * variation)
      }
    }
    if (positions.length === 0) return

    const geometry = new BufferGeometry()
    geometry.setAttribute("position", new BufferAttribute(new Float32Array(positions), 3))
    geometry.setAttribute("color", new BufferAttribute(new Float32Array(colours), 3))
    geometry.setAttribute("strength", new BufferAttribute(new Float32Array(strengths), 1))

    const material = new ShaderMaterial({
      uniforms: { ...this.uniforms, ...lightStreaks.uniforms(), eye: { value: new Float32Array(3) } },
      vertexShader,
      fragmentShader,
      transparent: true,
      depthWrite: false,
      blending: AdditiveBlending,
    })
    const cloud = new Points(geometry, material)
    cloud.name = `sceneryLights ${tileName}`
    cloud.position.set(x, y, 0)
    cloud.frustumCulled = false
    cloud.renderOrder = 1
    cloud.userData.corner = [x, y]
    this.scene.add(cloud)
    this.clouds.set(tileName, cloud)
  }

  /**
   * @param camera      the camera drawing the terrain
   * @param adaptation  the sky's exposure, against the reference daylight's
   * @param hazeDensity the haze's, share of light lost per meter
   * @param pixelRatio  the renderer's
   */
  update(camera, adaptation, hazeDensity, pixelRatio) {
    const brightness = brightnessFor(adaptation)
    this.uniforms.brightness.value = brightness
    // how far on they are, 0 to 1 - for the aircraft's own lights too
    this.level = brightness / BRIGHTNESS
    this.uniforms.hazeDensity.value = hazeDensity
    this.uniforms.pixelRatio.value = pixelRatio
    for (const cloud of this.clouds.values()) {
      cloud.visible = brightness > 0
      lightStreaks.updateCloud(cloud)
      const [x, y] = cloud.userData.corner
      cloud.material.uniforms.eye.value.set([camera.position.x - x, camera.position.y - y, camera.position.z])
    }
  }
}
