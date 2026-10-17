/**
 * The atmosphere: how much of the sun's light gets through it, and how much
 * of it is scattered towards the viewer from every direction - the sky.
 *
 * The air is modelled as in Hillaire's "A Scalable and Production Ready Sky
 * and Atmosphere Rendering Technique" (2020): per meter scattering and
 * absorption at sea level for red, green and blue (about 680, 550 and 440
 * nm), and how they thin out with height. Air molecules (Rayleigh
 * scattering) scatter blue light many times more than red - which is what
 * makes the sky blue, and, taken out of the sunlight along a long path, what
 * reddens a low sun. Haze (Mie scattering) scatters all colours alike, mostly
 * forwards, and whitens the sky around the sun and near the horizon. Ozone,
 * high up, absorbs mostly orange and red, which keeps the sky overhead blue
 * at dusk.
 *
 * Light scattered once is followed exactly. Light scattered more than once
 * is approximated as in the same paper, as if it went equally in all
 * directions - small in daylight, but in twilight it is most of what lights
 * the sky, and the earth's shadow would be black without it.
 *
 * Distances are meters, angles radians, unless named otherwise. The sun's
 * own illuminance, outside the atmosphere, is 1.
 */

const DEG = Math.PI / 180

const EARTH_RADIUS = 6360e3
const ATMOSPHERE_RADIUS = 6460e3
const ATMOSPHERE_HEIGHT = ATMOSPHERE_RADIUS - EARTH_RADIUS

const RAYLEIGH = [5.802e-6, 13.558e-6, 33.1e-6]
const RAYLEIGH_HEIGHT = 8000
// Five times Hillaire's haze. His is very clean air - visibility of the
// order of a thousand kilometres - and with it the horizon comes out a dull
// green-blue instead of the pale whitish blue of a clear day. This is still a
// clear day, about a hundred kilometres' visibility near the ground.
const HAZE = 5
const MIE_SCATTERING = 3.996e-6 * HAZE
const MIE_EXTINCTION = 4.4e-6 * HAZE
const MIE_HEIGHT = 1200
const OZONE = [0.65e-6, 1.881e-6, 0.085e-6]
const OZONE_PEAK = 25000
const OZONE_HALF_WIDTH = 15000

// how much of the light reaching the ground it reflects - forest, rock and
// sea, seen from far away
export const GROUND_ALBEDO = 0.1

// how strongly haze scatters forwards, 0..1 - the bright glow round the sun
export const MIE_G = 0.8

// total extinction per meter at height h, per colour, into out
function extinction(h, out) {
  const rayleigh = Math.exp(-h / RAYLEIGH_HEIGHT)
  const mie = Math.exp(-h / MIE_HEIGHT)
  const ozone = Math.max(0, 1 - Math.abs(h - OZONE_PEAK) / OZONE_HALF_WIDTH)
  for (let c = 0; c < 3; c++) out[c] = RAYLEIGH[c] * rayleigh + MIE_EXTINCTION * mie + OZONE[c] * ozone
}

/**
 * How quickly the air at the given height, meters, dims light passing
 * through it, per meter - for green light, the middle of the three, and the
 * one brightness is mostly made of.
 */
export function haze(height) {
  const sigma = [0, 0, 0]
  extinction(Math.max(0, height), sigma)
  return sigma[1]
}

/**
 * The optical depth, per colour, from a point at the given height out to
 * space at the given elevation above its own horizontal - or null if the
 * earth is in the way. Over a round earth, so that the path at the horizon
 * is long but finite.
 */
function opticalDepth(elevation, height, steps = 64) {
  const r0 = EARTH_RADIUS + Math.max(0, height)
  const dx = Math.cos(elevation)
  const dy = Math.sin(elevation)

  // the ray starts at (0, r0); it hits the earth if it passes below the
  // surface on its way out
  const b = r0 * dy
  if (b < 0 && r0 * r0 - b * b < EARTH_RADIUS * EARTH_RADIUS) return null
  const length = -b + Math.sqrt(b * b - r0 * r0 + ATMOSPHERE_RADIUS * ATMOSPHERE_RADIUS)

  const depth = [0, 0, 0]
  const sigma = [0, 0, 0]
  const step = length / steps

  for (let i = 0; i < steps; i++) {
    const s = (i + 0.5) * step
    extinction(Math.hypot(dx * s, r0 + dy * s) - EARTH_RADIUS, sigma)
    for (let c = 0; c < 3; c++) depth[c] += sigma[c] * step
  }

  return depth
}

/**
 * The share of the sun's light, per colour, that gets through the atmosphere
 * to a point at the given height, with the sun at the given elevation - 0
 * when the earth is in the way.
 *
 * @param elevation  degrees
 * @param height     meters above sea level
 * @returns [red, green, blue], 0..1
 */
export function sunTransmittance(elevation, height = 0) {
  const depth = opticalDepth(elevation * DEG, height)
  return depth ? depth.map((d) => Math.exp(-d)) : [0, 0, 0]
}

/* Optical depths towards the sun from anywhere in the atmosphere, for the
   sky below, which needs one at every step along every ray. They depend only
   on the height and the sun's elevation there, so they are worked out once,
   on a grid of the two - closer together low down and near the horizon,
   where they change fastest. Elevations reach down to where a sun still
   shines on the top of the atmosphere, and behind the earth the depth is
   just very large, which also softens the edge of its shadow a little. */
const DEPTH_HEIGHTS = 32
const DEPTH_ELEVATIONS = 256
const DEPTH_MIN_ELEVATION = -12 * DEG
const DEPTH_BLOCKED = 50
let depthTable = null

function buildDepthTable() {
  depthTable = new Float32Array(DEPTH_HEIGHTS * DEPTH_ELEVATIONS * 3)
  for (let j = 0; j < DEPTH_HEIGHTS; j++) {
    const height = ATMOSPHERE_HEIGHT * (j / (DEPTH_HEIGHTS - 1)) ** 2
    for (let i = 0; i < DEPTH_ELEVATIONS; i++) {
      const elevation = DEPTH_MIN_ELEVATION + (90 * DEG - DEPTH_MIN_ELEVATION) * (i / (DEPTH_ELEVATIONS - 1)) ** 2
      const depth = opticalDepth(elevation, height, 48)
      for (let c = 0; c < 3; c++) {
        depthTable[(j * DEPTH_ELEVATIONS + i) * 3 + c] = depth ? Math.min(depth[c], DEPTH_BLOCKED) : DEPTH_BLOCKED
      }
    }
  }
}

// the optical depth towards a sun at elevation, from height, into out -
// interpolated in depthTable
function sunDepth(height, elevation, out) {
  const x = Math.sqrt(Math.min(1, Math.max(0, height / ATMOSPHERE_HEIGHT))) * (DEPTH_HEIGHTS - 1)
  const e = (elevation - DEPTH_MIN_ELEVATION) / (90 * DEG - DEPTH_MIN_ELEVATION)
  if (e < 0) {
    out[0] = out[1] = out[2] = DEPTH_BLOCKED
    return
  }
  const y = Math.sqrt(Math.min(1, e)) * (DEPTH_ELEVATIONS - 1)

  const j = Math.min(Math.floor(x), DEPTH_HEIGHTS - 2)
  const i = Math.min(Math.floor(y), DEPTH_ELEVATIONS - 2)
  const fx = x - j
  const fy = y - i
  const a = (j * DEPTH_ELEVATIONS + i) * 3
  const b = a + DEPTH_ELEVATIONS * 3

  for (let c = 0; c < 3; c++) {
    const low = depthTable[a + c] + (depthTable[a + 3 + c] - depthTable[a + c]) * fy
    const high = depthTable[b + c] + (depthTable[b + 3 + c] - depthTable[b + c]) * fy
    out[c] = low + (high - low) * fx
  }
}

/* Light scattered more than once, as Hillaire approximates it: at each
   point, the light arriving from all round after one scattering, as if
   scattered equally in all directions, and then the share of that which
   is scattered again, and again - a geometric series, summed. Like the depths
   above it depends only on the height and the sun's elevation, so it is
   worked out once, on a coarser grid of the two. In the sky below, each
   point then scatters it towards the viewer as it does the sunlight. */
const SCATTER_HEIGHTS = 16
const SCATTER_ELEVATIONS = 32
const SCATTER_DIRECTIONS = 64
const SCATTER_STEPS = 20
let scatterTable = null

// directions spread evenly over the sphere, z up
const sphereDirections = Array.from({ length: SCATTER_DIRECTIONS }, (_, k) => {
  const z = 1 - (2 * k + 1) / SCATTER_DIRECTIONS
  const r = Math.sqrt(1 - z * z)
  const phi = k * Math.PI * (3 - Math.sqrt(5))
  return [r * Math.cos(phi), r * Math.sin(phi), z]
})

function scatterHeight(j) {
  return ATMOSPHERE_HEIGHT * (j / (SCATTER_HEIGHTS - 1)) ** 2
}

function scatterElevation(i) {
  return DEPTH_MIN_ELEVATION + (90 * DEG - DEPTH_MIN_ELEVATION) * (i / (SCATTER_ELEVATIONS - 1)) ** 2
}

function buildScatterTable() {
  scatterTable = new Float32Array(SCATTER_HEIGHTS * SCATTER_ELEVATIONS * 3)
  const sigma = [0, 0, 0]
  const toSun = [0, 0, 0]

  for (let j = 0; j < SCATTER_HEIGHTS; j++) {
    const r0 = EARTH_RADIUS + Math.max(1, scatterHeight(j))

    for (let i = 0; i < SCATTER_ELEVATIONS; i++) {
      const sunElevation = scatterElevation(i)
      const sunX = Math.cos(sunElevation)
      const sunZ = Math.sin(sunElevation)

      // the light arriving after one scattering, and the share of light
      // that is scattered again, both averaged over all directions
      const once = [0, 0, 0]
      const again = [0, 0, 0]

      for (const [dx, dy, dz] of sphereDirections) {
        const b = r0 * dz
        const groundDisc = b * b - r0 * r0 + EARTH_RADIUS * EARTH_RADIUS
        const hitsGround = b < 0 && groundDisc > 0
        const length = hitsGround
          ? -b - Math.sqrt(groundDisc)
          : -b + Math.sqrt(b * b - r0 * r0 + ATMOSPHERE_RADIUS * ATMOSPHERE_RADIUS)

        const depth = [0, 0, 0]
        for (let k = 0; k < SCATTER_STEPS; k++) {
          const t = length * ((k + 0.5) / SCATTER_STEPS) ** 2
          const dt = (length * (2 * k + 1)) / (SCATTER_STEPS * SCATTER_STEPS)
          const px = dx * t
          const py = dy * t
          const pz = r0 + dz * t
          const r = Math.sqrt(px * px + py * py + pz * pz)
          const h = r - EARTH_RADIUS

          sunDepth(h, Math.asin((px * sunX + pz * sunZ) / r), toSun)
          extinction(h, sigma)
          const rayleighDensity = Math.exp(-h / RAYLEIGH_HEIGHT)
          const mieDensity = Math.exp(-h / MIE_HEIGHT)

          for (let c = 0; c < 3; c++) {
            const scattering = RAYLEIGH[c] * rayleighDensity + MIE_SCATTERING * mieDensity
            const transmittance = Math.exp(-(depth[c] + 0.5 * sigma[c] * dt))
            once[c] += (scattering * transmittance * Math.exp(-toSun[c]) * dt) / (4 * Math.PI)
            again[c] += scattering * transmittance * dt
            depth[c] += sigma[c] * dt
          }
        }

        if (hitsGround) {
          const sunHeight = (dx * length * sunX + (r0 + dz * length) * sunZ) / EARTH_RADIUS
          if (sunHeight > 0) {
            sunDepth(0, Math.asin(Math.min(1, sunHeight)), toSun)
            for (let c = 0; c < 3; c++) {
              once[c] += (GROUND_ALBEDO / Math.PI) * sunHeight * Math.exp(-(depth[c] + toSun[c]))
            }
          }
        }
      }

      for (let c = 0; c < 3; c++) {
        const l = once[c] / SCATTER_DIRECTIONS
        const f = again[c] / (4 * Math.PI * SCATTER_DIRECTIONS)
        scatterTable[(j * SCATTER_ELEVATIONS + i) * 3 + c] = l / (1 - f)
      }
    }
  }
}

// the multiply scattered light at a point at height, with the sun at
// elevation there, into out - interpolated in scatterTable
function multipleScattering(height, elevation, out) {
  const e = (elevation - DEPTH_MIN_ELEVATION) / (90 * DEG - DEPTH_MIN_ELEVATION)
  if (e < 0) {
    out[0] = out[1] = out[2] = 0
    return
  }
  const x = Math.sqrt(Math.min(1, Math.max(0, height / ATMOSPHERE_HEIGHT))) * (SCATTER_HEIGHTS - 1)
  const y = Math.sqrt(Math.min(1, e)) * (SCATTER_ELEVATIONS - 1)

  const j = Math.min(Math.floor(x), SCATTER_HEIGHTS - 2)
  const i = Math.min(Math.floor(y), SCATTER_ELEVATIONS - 2)
  const fx = x - j
  const fy = y - i
  const a = (j * SCATTER_ELEVATIONS + i) * 3
  const b = a + SCATTER_ELEVATIONS * 3

  for (let c = 0; c < 3; c++) {
    const low = scatterTable[a + c] + (scatterTable[a + 3 + c] - scatterTable[a + c]) * fy
    const high = scatterTable[b + c] + (scatterTable[b + 3 + c] - scatterTable[b + c]) * fy
    out[c] = low + (high - low) * fx
  }
}

/* The sky is worked out on a grid of view directions: azimuth from the sun's
   own, 0 (towards it) to 180 degrees (away), the two sides being alike - and
   elevation, from straight down to straight up, closer together near the
   horizon, where the sky changes fastest. */
export const SKY_AZIMUTHS = 32
export const SKY_ELEVATIONS = 64
const SKY_STEPS = 32

// the elevation of grid row v, 0..1 - the horizon is at 0.5
export function skyElevation(v) {
  const x = 2 * v - 1
  return Math.sign(x) * x * x * 90 * DEG
}

// the arrays computeSky fills - the same ones each time, rather than
// fresh ones every second for the garbage collector to stall on
const SKY_SIZE = SKY_AZIMUTHS * SKY_ELEVATIONS * 3
const skyArrays = {
  rayleigh: new Float32Array(SKY_SIZE),
  mie: new Float32Array(SKY_SIZE),
  isotropic: new Float32Array(SKY_SIZE),
}

/**
 * The light reaching a viewer at the given height from every direction in
 * the sky's grid, with the sun at the given elevation. Three parts, each an
 * RGB triple per grid point, row by row from straight down: rayleigh and
 * mie are the light scattered by air and by haze, still to be multiplied by
 * their phase functions for the angle from the sun (see rayleighPhase and
 * miePhase), and isotropic is the light that is the same whatever the angle:
 * light scattered more than once, and the sunlit ground seen through the
 * air, where the direction meets it.
 *
 * The arrays are reused by the next call, so they are only good until then.
 *
 * @param sunElevation  degrees
 * @param height        meters above sea level
 */
export function computeSky(sunElevation, height) {
  if (!depthTable) buildDepthTable()
  if (!scatterTable) buildScatterTable()

  const { rayleigh, mie, isotropic } = skyArrays
  rayleigh.fill(0)
  mie.fill(0)
  isotropic.fill(0)

  const sunX = Math.cos(sunElevation * DEG)
  const sunZ = Math.sin(sunElevation * DEG)
  const r0 = EARTH_RADIUS + Math.max(1, height)

  const sigma = [0, 0, 0]
  const viewDepth = [0, 0, 0]
  const toSun = [0, 0, 0]
  const scattered = [0, 0, 0]

  for (let j = 0; j < SKY_ELEVATIONS; j++) {
    const elevation = skyElevation(j / (SKY_ELEVATIONS - 1))
    const dz = Math.sin(elevation)

    // where the ray leaves the atmosphere, or meets the ground
    const b = r0 * dz
    const groundDisc = b * b - r0 * r0 + EARTH_RADIUS * EARTH_RADIUS
    const hitsGround = b < 0 && groundDisc > 0
    const length = hitsGround
      ? -b - Math.sqrt(groundDisc)
      : -b + Math.sqrt(b * b - r0 * r0 + ATMOSPHERE_RADIUS * ATMOSPHERE_RADIUS)

    for (let i = 0; i < SKY_AZIMUTHS; i++) {
      const azimuth = (Math.PI * i) / (SKY_AZIMUTHS - 1)
      const dx = Math.cos(elevation) * Math.cos(azimuth)
      const dy = Math.cos(elevation) * Math.sin(azimuth)
      const index = (j * SKY_AZIMUTHS + i) * 3

      viewDepth[0] = viewDepth[1] = viewDepth[2] = 0

      // samples closer together near the viewer, where the air is densest
      for (let k = 0; k < SKY_STEPS; k++) {
        const t = length * ((k + 0.5) / SKY_STEPS) ** 2
        const dt = (length * (2 * k + 1)) / (SKY_STEPS * SKY_STEPS)

        const px = dx * t
        const py = dy * t
        const pz = r0 + dz * t
        const r = Math.sqrt(px * px + py * py + pz * pz)
        const h = r - EARTH_RADIUS

        // the sun's elevation seen from the sample point
        const localSun = Math.asin((px * sunX + pz * sunZ) / r)
        sunDepth(h, localSun, toSun)
        multipleScattering(h, localSun, scattered)
        extinction(h, sigma)

        const rayleighDensity = Math.exp(-h / RAYLEIGH_HEIGHT)
        const mieDensity = Math.exp(-h / MIE_HEIGHT)

        for (let c = 0; c < 3; c++) {
          const toViewer = Math.exp(-(viewDepth[c] + 0.5 * sigma[c] * dt))
          const transmittance = toViewer * Math.exp(-toSun[c])
          rayleigh[index + c] += RAYLEIGH[c] * rayleighDensity * transmittance * dt
          mie[index + c] += MIE_SCATTERING * mieDensity * transmittance * dt
          isotropic[index + c] +=
            (RAYLEIGH[c] * rayleighDensity + MIE_SCATTERING * mieDensity) * scattered[c] * toViewer * dt
          viewDepth[c] += sigma[c] * dt
        }
      }

      if (hitsGround) {
        // the ground there, lit by the sun at its own elevation
        const px = dx * length
        const pz = r0 + dz * length
        const sunHeight = (px * sunX + pz * sunZ) / EARTH_RADIUS
        if (sunHeight > 0) {
          sunDepth(0, Math.asin(Math.min(1, sunHeight)), toSun)
          for (let c = 0; c < 3; c++) {
            isotropic[index + c] += (GROUND_ALBEDO / Math.PI) * sunHeight * Math.exp(-(viewDepth[c] + toSun[c]))
          }
        }
      }
    }
  }

  return skyArrays
}

export function rayleighPhase(mu) {
  return (3 / (16 * Math.PI)) * (1 + mu * mu)
}

// Cornette-Shanks
export function miePhase(mu) {
  const g2 = MIE_G * MIE_G
  return ((3 / (8 * Math.PI)) * ((1 - g2) * (1 + mu * mu))) / ((2 + g2) * (1 + g2 - 2 * MIE_G * mu) ** 1.5)
}

/**
 * The light of a sky grid point, per colour, into out - mu being the cosine
 * of the angle from that direction to the sun.
 */
export function skyRadiance(sky, index, mu, out) {
  const pr = rayleighPhase(mu)
  const pm = miePhase(mu)
  for (let c = 0; c < 3; c++) {
    out[c] = sky.rayleigh[index + c] * pr + sky.mie[index + c] * pm + sky.isotropic[index + c]
  }
  return out
}

/**
 * The cosine of the angle between the sun and the sky grid's direction at
 * elevation and azimuth from the sun.
 */
export function cosineToSun(elevation, azimuth, sunElevation) {
  const s = sunElevation * DEG
  return Math.cos(elevation) * Math.cos(azimuth) * Math.cos(s) + Math.sin(elevation) * Math.sin(s)
}

export function luminance(rgb) {
  return 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2]
}

/**
 * The light falling on level ground at the viewer from the sky, all over its
 * upper half, per colour - not counting the sun's own.
 */
export function skyIrradiance(sky, sunElevation) {
  const radiance = [0, 0, 0]
  const light = [0, 0, 0]

  for (let j = SKY_ELEVATIONS / 2; j < SKY_ELEVATIONS; j++) {
    const elevation = skyElevation(j / (SKY_ELEVATIONS - 1))
    const below = skyElevation(Math.max(j - 0.5, SKY_ELEVATIONS / 2 - 0.5) / (SKY_ELEVATIONS - 1))
    const above = skyElevation(Math.min(j + 0.5, SKY_ELEVATIONS - 1) / (SKY_ELEVATIONS - 1))
    const band = Math.max(0, above - Math.max(0, below))

    for (let i = 0; i < SKY_AZIMUTHS; i++) {
      // the grid covers one side, so each column stands for twice its width
      const width = ((i === 0 || i === SKY_AZIMUTHS - 1 ? 1 : 2) * Math.PI) / (SKY_AZIMUTHS - 1)
      const azimuth = (Math.PI * i) / (SKY_AZIMUTHS - 1)
      const mu = cosineToSun(elevation, azimuth, sunElevation)
      skyRadiance(sky, (j * SKY_AZIMUTHS + i) * 3, mu, radiance)
      const weight = Math.sin(elevation) * Math.cos(elevation) * band * width
      for (let c = 0; c < 3; c++) light[c] += radiance[c] * weight
    }
  }

  return light
}

/**
 * All the light falling on level ground at the viewer, per colour: the sun's
 * own through the atmosphere, and the sky's.
 */
export function groundIrradiance(sky, sunElevation, height) {
  const sun = sunTransmittance(sunElevation, height)
  const sunHeight = Math.max(0, Math.sin(sunElevation * DEG))
  return skyIrradiance(sky, sunElevation).map((light, c) => light + sun[c] * sunHeight)
}

/**
 * How much light falls on level ground at the viewer, as luminance. This is
 * what the eye adapts to as the day fades - see SkyDome.
 */
export function daylight(sky, sunElevation, height) {
  return luminance(groundIrradiance(sky, sunElevation, height))
}
