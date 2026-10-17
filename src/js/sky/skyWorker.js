import { computeSky, daylight, groundIrradiance, skyIrradiance } from "./atmosphere.js"

/**
 * Works out the sky off the main thread - see SkyDome. It takes several
 * milliseconds, which on the main thread would hold up the frame it fell in,
 * once every update, as a small stutter.
 *
 * Asked { sunElevation, height, ... }, it answers with the same, plus:
 *
 * - the sky seen from that height (rayleigh, mie, isotropic - see computeSky)
 * - daylight, the light falling on level ground there, as luminance (see
 *   daylight), which the exposure follows
 * - skyLight, the sky's own light falling on level ground at sea level, per
 *   colour (see skyIrradiance) - what lights the aircraft besides the sun.
 *   Taken at sea level, like the reference it is compared with: up high
 *   there is less of it, with less air above to scatter it down, but taken
 *   there and compared with the reference at sea level, the aircraft was
 *   lit noticeably less in broad daylight than it had been before the sky
 *   was simulated.
 * - groundLight, all the light falling on level ground at sea level, per
 *   colour (see groundIrradiance) - what lights the terrain below
 *
 * The tables the sky is worked out from are built here too, on the first
 * request.
 */
self.onmessage = ({ data }) => {
  const { sunElevation, height } = data
  const sky = computeSky(sunElevation, height)

  // copies, since computeSky reuses its arrays - handed over, not copied again
  const rayleigh = sky.rayleigh.slice()
  const mie = sky.mie.slice()
  const isotropic = sky.isotropic.slice()

  const answer = {
    ...data,
    rayleigh,
    mie,
    isotropic,
    daylight: daylight(sky, sunElevation, height),
  }

  // the terrain is lit by the sky as it is down at sea level, which with
  // the viewer high up is another sky - worked out after the copies above,
  // as it reuses the same arrays
  const ground = height > 100 ? computeSky(sunElevation, 0) : sky
  answer.groundLight = groundIrradiance(ground, sunElevation, 0)
  answer.skyLight = skyIrradiance(ground, sunElevation)

  self.postMessage(answer, [rayleigh.buffer, mie.buffer, isotropic.buffer])
}
