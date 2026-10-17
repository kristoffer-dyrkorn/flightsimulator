import {
  BackSide,
  BoxGeometry,
  Color,
  DataTexture,
  DataUtils,
  HalfFloatType,
  LinearFilter,
  Mesh,
  RGBAFormat,
  ShaderMaterial,
  Vector3,
} from "three"
import {
  SKY_AZIMUTHS,
  SKY_ELEVATIONS,
  MIE_G,
  cosineToSun,
  luminance,
  skyElevation,
  skyRadiance,
  sunTransmittance,
} from "./atmosphere.js"

// The sky is drawn on the inside of a box around the camera, this far out to
// each side - its corners still well inside the camera's far plane. Only the
// direction to each pixel matters, not the distance.
const SKY_DISTANCE = 20000 // m

// The sky is seen through an exposure that follows the daylight, the way the
// eye adapts: at REFERENCE_SUN_ELEVATION it puts the horizon at the colour
// the sky had before it was simulated, REFERENCE_HORIZON, and with less
// light it opens up - by the daylight's ratio to that to the power of
// ADAPTATION, so dusk still gets darker, just not as much darker as it
// really is, and never by more than MAX_ADAPTATION.
//
// The exposed light is then brought into the range a screen shows, up to
// SKY_CEILING - a little short of full white, which is kept for the sun's
// own disc, so it always stands out as the brightest thing in the sky. Its
// brightness (luminance) becomes SKY_CEILING * (1 - exp(-luminance)), so a
// brighter part of
// the sky is always shown brighter. Its colour is kept as far as the screen
// allows: scaled down by its strongest colour, 1 - exp(-strongest), and
// then, if that left it darker than its brightness should be, lightened
// towards white until it is not. So a bright saturated orange - the sky
// right round a low sun - turns yellow and white the way it does in a
// photograph, instead of being held at the dull brightness a pure orange can
// have on a screen. Held there, it came out darker than the paler sky
// further out, and the glow round the sun got a bright ring at its edge.
const REFERENCE_SUN_ELEVATION = 40 // degrees
const REFERENCE_HORIZON = new Color(0.74, 0.74, 0.82).convertSRGBToLinear()
const ADAPTATION = 0.3
const MAX_ADAPTATION = 1000
const SKY_CEILING = 0.88

// the sun's angular radius, degrees, and the width of its soft edge - and
// how bright it is shown, as luminance, above anything in the sky
const SUN_RADIUS = 0.2666
const SUN_EDGE = 0.02
const SUN_LUMINANCE = 0.97

const vertexShader = /* glsl */ `
  varying vec3 vDirection;

  void main() {
    // the box is centred on the camera, so a corner's own position is the
    // direction to it - with no large world coordinates involved
    vDirection = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

const fragmentShader = /* glsl */ `
  uniform sampler2D rayleighMap;
  uniform sampler2D mieMap;
  uniform sampler2D isotropicMap;
  uniform vec3 sunDirection;
  uniform vec3 sunColor;
  uniform float horizonDip;
  uniform float sunVisible;

  varying vec3 vDirection;

  const float PI = 3.141592653589793;
  const vec3 LUMINANCE = vec3(0.2126, 0.7152, 0.0722);
  const float AZIMUTHS = ${SKY_AZIMUTHS}.0;
  const float ELEVATIONS = ${SKY_ELEVATIONS}.0;
  const float G = ${MIE_G};
  const float CEILING = ${SKY_CEILING};
  const float SUN_INNER = ${Math.cos(((SUN_RADIUS - SUN_EDGE) * Math.PI) / 180)};
  const float SUN_OUTER = ${Math.cos(((SUN_RADIUS + SUN_EDGE) * Math.PI) / 180)};

  // where a direction is in the sky grid (see atmosphere.js): azimuth from
  // the sun's across, elevation up, closer together near the horizon
  vec2 gridPosition(vec3 direction, float elevation) {
    float v = 0.5 + 0.5 * sign(elevation) * sqrt(abs(elevation) / (0.5 * PI));

    vec2 across = direction.xy;
    vec2 sunAcross = sunDirection.xy;
    float azimuth = length(across) > 1e-6 && length(sunAcross) > 1e-6
      ? acos(clamp(dot(normalize(across), normalize(sunAcross)), -1.0, 1.0))
      : 0.0;
    float u = azimuth / PI;

    return vec2((u * (AZIMUTHS - 1.0) + 0.5) / AZIMUTHS, (v * (ELEVATIONS - 1.0) + 0.5) / ELEVATIONS);
  }

  // see the exposure comment at the top of SkyDome.js
  vec3 toDisplay(vec3 light) {
    float strongest = max(light.r, max(light.g, light.b));
    if (strongest <= 0.0) return vec3(0.0);

    vec3 color = CEILING * light * (1.0 - exp(-strongest)) / strongest;
    float target = CEILING * (1.0 - exp(-dot(light, LUMINANCE)));
    float shown = dot(color, LUMINANCE);
    return mix(color, vec3(CEILING), max(0.0, (target - shown) / (CEILING - shown)));
  }

  void main() {
    vec3 direction = normalize(vDirection);
    float elevation = asin(clamp(direction.z, -1.0, 1.0));
    float mu = dot(direction, sunDirection);

    // Below the horizon the sky is only seen past the edge of the terrain,
    // which has faded into the horizon's haze by then (see the fog in
    // index.js) - so it shows the horizon's colour there too, rather than
    // the far-off ground. In twilight that ground is in the earth's shadow,
    // and came out as a dark band between the terrain and the sky.
    vec2 grid = gridPosition(direction, max(elevation, 0.0));

    float rayleighPhase = 3.0 / (16.0 * PI) * (1.0 + mu * mu);
    float miePhase = 3.0 / (8.0 * PI) * (1.0 - G * G) * (1.0 + mu * mu) /
      ((2.0 + G * G) * pow(1.0 + G * G - 2.0 * G * mu, 1.5));

    // the light from this direction, already exposed - see SkyDome.update
    vec3 light = texture2D(rayleighMap, grid).rgb * rayleighPhase +
      texture2D(mieMap, grid).rgb * miePhase +
      texture2D(isotropicMap, grid).rgb;
    vec3 color = toDisplay(light);

    // the sun's disc, unless the earth is in front of it
    float disc = sunVisible * smoothstep(SUN_OUTER, SUN_INNER, mu) * step(-horizonDip, elevation);
    color = mix(color, sunColor, disc);

    gl_FragColor = vec4(color, 1.0);

    #include <colorspace_fragment>
  }
`

// exposed light to screen colour - the same as toDisplay in the shader
export function toDisplay(light) {
  const strongest = Math.max(...light)
  if (strongest <= 0) return [0, 0, 0]

  const color = light.map((l) => (SKY_CEILING * l * (1 - Math.exp(-strongest))) / strongest)
  const target = SKY_CEILING * (1 - Math.exp(-luminance(light)))
  const shown = luminance(color)
  const whiten = Math.max(0, (target - shown) / (SKY_CEILING - shown))
  return color.map((c) => c + (SKY_CEILING - c) * whiten)
}

function skyTexture() {
  const texture = new DataTexture(
    new Uint16Array(SKY_AZIMUTHS * SKY_ELEVATIONS * 4),
    SKY_AZIMUTHS,
    SKY_ELEVATIONS,
    RGBAFormat,
    HalfFloatType,
  )
  texture.magFilter = LinearFilter
  texture.minFilter = LinearFilter
  return texture
}

/**
 * The sky, as the atmosphere scatters the sun's light towards the viewer -
 * blue overhead, paler towards the horizon and round the sun, and red and
 * orange with the sun low - with the sun's own disc. Worked out on the CPU
 * on a coarse grid of directions (see atmosphere.js) whenever update is
 * called, and looked up from there for each pixel. The working out is done
 * in a worker (see skyWorker.js), so the sky changes a moment after update
 * is called, and is black until the first answer is in, just after start.
 *
 * Also gives the colour of the horizon, for the fog the terrain fades into,
 * and how the light the sky gives compares with REFERENCE_SUN_ELEVATION's,
 * for what it lights - see show.
 */
export default class SkyDome extends Mesh {
  constructor() {
    const material = new ShaderMaterial({
      uniforms: {
        rayleighMap: { value: skyTexture() },
        mieMap: { value: skyTexture() },
        isotropicMap: { value: skyTexture() },
        sunDirection: { value: new Vector3(0, 0, 1) },
        sunColor: { value: new Color() },
        horizonDip: { value: 0 },
        sunVisible: { value: 1 },
      },
      vertexShader,
      fragmentShader,
      side: BackSide,
      depthTest: false,
      depthWrite: false,
      fog: false,
    })

    super(new BoxGeometry(2 * SKY_DISTANCE, 2 * SKY_DISTANCE, 2 * SKY_DISTANCE), material)

    // drawn first, behind everything, wherever the camera looks
    this.frustumCulled = false
    this.renderOrder = -1

    // the horizon's colour, as shown, at each azimuth from the sun's in the
    // sky grid - for the haze the terrain fades into with distance, which
    // takes on the colour of the horizon behind it (see horizonFog.js) -
    // and averaged all round, for the aircraft's own fog. See show.
    this.horizonColors = Array.from({ length: SKY_AZIMUTHS }, () => REFERENCE_HORIZON.clone())

    // towards the sun the sky is shown for, in the scene's frame (z up)
    this.sunDirection = material.uniforms.sunDirection.value
    this.fogColor = REFERENCE_HORIZON.clone()

    // The worker answers one request at a time. While it works on one, only
    // the latest update asked for is kept, to be sent when it is done - the
    // ones before it are out of date by then anyway.
    this.worker = new Worker(new URL("./skyWorker.js", import.meta.url), { type: "module" })
    this.worker.onmessage = ({ data }) => this.answered(data)
    this.waiting = null

    // called after each update of the sky, and of what is below
    this.onUpdate = () => {}

    // The light now, as a share of the light with the sun at
    // REFERENCE_SUN_ELEVATION, per colour, and seen through the sky's
    // exposure - so 1 is that light, seen as the sky shows it then. groundLight
    // is the light falling on the ground at sea level, sun and sky together,
    // and skyLight the sky's own at the viewer. adaptation is how far the
    // exposure has opened up from the reference's.
    this.adaptation = 1
    this.sunElevation = REFERENCE_SUN_ELEVATION
    this.groundLight = [1, 1, 1]
    this.skyLight = [1, 1, 1]

    // first, the sky with the sun at REFERENCE_SUN_ELEVATION, to set the
    // exposure from - see answered
    this.busy = true
    this.worker.postMessage({ reference: true, sunElevation: REFERENCE_SUN_ELEVATION, height: 0 })
  }

  // keeps the box centred on whichever camera is drawing it
  onBeforeRender(renderer, scene, camera) {
    this.position.copy(camera.position)
    this.updateMatrixWorld()
  }

  radianceAt(sky, sunElevation, j, i) {
    const elevation = skyElevation(j / (SKY_ELEVATIONS - 1))
    const azimuth = (Math.PI * i) / (SKY_AZIMUTHS - 1)
    const mu = cosineToSun(elevation, azimuth, sunElevation)
    return skyRadiance(sky, (j * SKY_AZIMUTHS + i) * 3, mu, [0, 0, 0])
  }

  /**
   * Has the sky worked out for the sun and viewer given - and shown once
   * it is ready.
   *
   * @param sunDirection  towards the sun, in the scene's frame (z up)
   * @param sunElevation  degrees
   * @param height        the viewer's, meters above sea level
   */
  update(sunDirection, sunElevation, height) {
    const request = { sunDirection: sunDirection.toArray(), sunElevation, height }
    if (this.busy) {
      this.waiting = request
    } else {
      this.busy = true
      this.worker.postMessage(request)
    }
  }

  answered(sky) {
    if (sky.reference) {
      // the exposure that gives the horizon REFERENCE_HORIZON's brightness,
      // with the sun at REFERENCE_SUN_ELEVATION, and the daylight then
      const horizon = this.radianceAt(sky, REFERENCE_SUN_ELEVATION, SKY_ELEVATIONS / 2, SKY_AZIMUTHS / 2)
      this.referenceExposure = -Math.log(1 - luminance(REFERENCE_HORIZON.toArray()) / SKY_CEILING) / luminance(horizon)
      this.referenceDaylight = sky.daylight
      this.referenceGroundLight = sky.groundLight
      this.referenceSkyLight = sky.skyLight
    } else {
      this.show(sky)
    }

    if (this.waiting) {
      this.worker.postMessage(this.waiting)
      this.waiting = null
    } else {
      this.busy = false
    }
  }

  // puts a sky from the worker on screen
  show(sky) {
    const { sunElevation, height } = sky

    const adaptation = Math.min(MAX_ADAPTATION, (this.referenceDaylight / sky.daylight) ** ADAPTATION)
    const exposure = this.referenceExposure * adaptation
    this.exposure = exposure

    this.adaptation = adaptation
    this.sunElevation = sunElevation
    this.groundLight = sky.groundLight.map((light, c) => (adaptation * light) / this.referenceGroundLight[c])
    this.skyLight = sky.skyLight.map((light, c) => (adaptation * light) / this.referenceSkyLight[c])

    // exposed before they are stored, which keeps them well inside what
    // half floats hold, however dark the sky gets
    const uniforms = this.material.uniforms
    const parts = [
      [sky.rayleigh, uniforms.rayleighMap.value],
      [sky.mie, uniforms.mieMap.value],
      [sky.isotropic, uniforms.isotropicMap.value],
    ]
    for (const [values, texture] of parts) {
      const data = texture.image.data
      for (let p = 0; p < SKY_AZIMUTHS * SKY_ELEVATIONS; p++) {
        for (let c = 0; c < 3; c++) {
          data[p * 4 + c] = DataUtils.toHalfFloat(Math.min(60000, values[p * 3 + c] * exposure))
        }
      }
      texture.needsUpdate = true
    }

    uniforms.sunDirection.value.fromArray(sky.sunDirection)

    // the earth hides what is below this angle under the horizontal
    const earthRadius = 6360e3
    uniforms.horizonDip.value = Math.acos(earthRadius / (earthRadius + Math.max(0, height)))

    // The sun's disc is far too bright for any exposure that shows the sky,
    // so it is shown at SUN_LUMINANCE, brighter than any of the sky, in the
    // colour of the sunlight - lightened towards white as far as it takes to
    // get there, so near white with the sun high, and still tinted yellow
    // and orange with it low. Gone once the earth is in the way.
    const transmittance = sunTransmittance(sunElevation, height)
    const brightest = Math.max(...transmittance)
    uniforms.sunVisible.value = brightest > 1e-4 ? 1 : 0
    if (brightest > 1e-4) {
      const hue = transmittance.map((t) => t / brightest)
      const whiten = Math.max(0, (SUN_LUMINANCE - luminance(hue)) / (1 - luminance(hue)))
      uniforms.sunColor.value.setRGB(...hue.map((c) => c + (1 - c) * whiten))
    }

    // the horizon's colour, as shown - halfway between the two grid rows
    // either side of it, as the shader shows it - at each azimuth, and
    // averaged all the way round
    const average = [0, 0, 0]
    for (let i = 0; i < SKY_AZIMUTHS; i++) {
      const weight = (i === 0 || i === SKY_AZIMUTHS - 1 ? 1 : 2) / (2 * (SKY_AZIMUTHS - 1))
      const below = this.radianceAt(sky, sunElevation, SKY_ELEVATIONS / 2 - 1, i)
      const above = this.radianceAt(sky, sunElevation, SKY_ELEVATIONS / 2, i)
      const color = toDisplay(below.map((r, c) => ((r + above[c]) / 2) * exposure))
      this.horizonColors[i].setRGB(...color)
      for (let c = 0; c < 3; c++) average[c] += weight * color[c]
    }
    this.fogColor.setRGB(...average)

    this.onUpdate()
  }
}
