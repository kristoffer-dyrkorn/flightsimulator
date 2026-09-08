import SimulationConstants from "../simulationconstants.js"

/**
 * Von Karman atmospheric turbulence.
 *
 * Still air is the least realistic thing about a flight model. Real air is
 * never still: it is a turbulent fluid, and an aircraft flying through it is
 * continuously being handed small changes in the direction and speed of the air
 * it meets. That is what the aircraft feels as a bumpy ride, it is what makes a
 * low level run at high speed hard work, and it is the disturbance every control
 * law in the aircraft actually exists to reject. A model without it flies like
 * it is on rails.
 *
 * Turbulence is random, so it cannot be tabulated - what is known about it is
 * its statistics. Both of the standard descriptions are power spectra: they say
 * how much gust energy sits at each spatial frequency, which is the same as
 * saying how the gusts are distributed between long slow heaves and short sharp
 * jolts. The Dryden spectrum is the convenient one, being rational and therefore
 * exactly realizable by a small filter. The von Karman spectrum is the accurate
 * one - it is what measured atmospheric turbulence actually looks like, with
 * distinctly more energy in the short wavelengths, which is precisely the part
 * an aircraft responds to. Its exponents are fractional, so it has no exact
 * finite realization, and the filters below are the standard rational
 * approximations to it (MIL-HDBK-1797). They track the true spectra to within
 * about one percent out to ten times the break frequency and roll off a little
 * fast beyond that, which puts the error in wavelengths far shorter than the
 * aircraft.
 *
 * Each filter turns white noise into gust velocity along one axis:
 *
 *   longitudinal  a headwind/tailwind component, felt as changing airspeed
 *   lateral       felt as sideslip, so the aircraft is pushed and yawed
 *   vertical      felt as angle of attack, so it is the one that produces the
 *                 vertical jolts, and the one that dominates the ride
 *
 * Those three treat the aircraft as a point. It is not one, and the difference
 * matters: an eddy the size of the wing span does not arrive everywhere at once,
 * so what one wing gets is not what the other gets, and what the tail gets is
 * not what the nose got. A gust that varies across the aircraft is a gust that
 * rotates it, and that adds three more components:
 *
 *   rolling   from the vertical gust varying across the span, and this is the
 *             wing rocking that makes low level turbulence such hard work. It
 *             has its own spectrum and its own noise source, because a spanwise
 *             difference is not something the gust at the centreline knows about
 *
 *   pitching  from the vertical gust varying along the fuselage, so the tail
 *             flies into air the nose has already been through
 *
 *   yawing    the same thing for the lateral gust
 *
 * The last two are not independent processes: for a gust field frozen in space,
 * a gradient along the flight path is exactly the rate of change with time
 * divided by the airspeed, so they are differentiated from the vertical and
 * lateral gusts rather than generated. All three are lagged with a time constant
 * set by the span, which is what keeps eddies far smaller than the aircraft from
 * rotating it: those average out across the airframe instead.
 *
 * They enter the aerodynamics as additions to the body rates, because that is
 * exactly what they look like to the aircraft - a rolling gust and a roll rate
 * are indistinguishable from inside. They are not added to the rigid body
 * equations: the air is rotating, the aircraft is not.
 *
 * The gust magnitude and the wavelengths both depend on where the aircraft is.
 * Near the ground the eddies are small, because the ground is what is shedding
 * them and it will not let them grow larger than the height above it - so low
 * level turbulence is fast and sharp. Higher up the scale length settles at
 * 2500 ft, giving the long slow swells of turbulence at altitude, and the
 * magnitude tails off with the air density. The parameters here are the
 * MIL-F-8785C ones: below 1000 ft, driven by the wind speed at 20 ft, and above
 * 2000 ft isotropic with the RMS gust velocity read from the exceedance table,
 * blended across the gap between the two.
 *
 * How windy it is, then, is the one thing this model does not decide for itself.
 * It is handed the weather from outside, by whoever knows what it is doing -
 * which in this simulator is the real forecast for the place the flight starts,
 * read at several heights. The surface wind sets the roughness down low, and
 * what the wind does with height sets the turbulence aloft: air that is moving
 * at one speed at 3000 ft and another at 10000 ft has to shear somewhere in
 * between, and that shearing is what tears smooth flow into turbulence. It is
 * the reason clear air turbulence is forecast from wind fields at all, and ten
 * knots of change per thousand feet is the long standing criterion for expecting
 * a moderate amount of it.
 *
 * The components are taken to lie along the body axes. The specification defines
 * them relative to the mean wind, which this model does not have - there is no
 * steady wind here, only the turbulence about it, so the two frames differ by
 * the aircraft's drift angle and nothing else.
 */

/* Height above ground at which the low altitude parameters stop being used, and
   the height at which the high altitude ones take over completely, ft. */
const LOW_ALTITUDE_TOP = 1000
const HIGH_ALTITUDE_BOTTOM = 2000

/* Scale length at and above HIGH_ALTITUDE_BOTTOM, ft. This is the von Karman
   value; the Dryden model uses 1750 ft for the same air. */
const HIGH_ALTITUDE_SCALE = 2500

/* RMS gust velocity against altitude, ft/s, for moderate turbulence - the
   1 in 100 exceedance curve of the specification, approximated. Turbulence
   thins out with the air: there is very little of it left in the stratosphere. */
const ALTITUDE = [2000, 5000, 10000, 20000, 30000, 40000, 50000, 60000, 80000]
const RMS_GUST = [9.0, 10.0, 10.0, 9.0, 8.0, 6.5, 5.0, 3.5, 1.5]

/* The vertical wind shear that an intensity of one means: ten knots of wind
   change per thousand feet of altitude, in ft/s per ft. */
const MODERATE_SHEAR = 16.878 / 1000

/* The RMS gust velocity that an intensity of one means, ft/s - moderate
   turbulence, which is what the table above is scaled to. A forecast gust is a
   peak rather than an RMS, and a peak sits about three standard deviations out
   from the mean wind. */
const MODERATE_GUST = 10.0
const GUST_PEAK_FACTOR = 3

/* Weather to fly in until the forecast arrives, or if it never does: a fifteen
   knot surface wind and light turbulence aloft, which is a quiet but not a dead
   day. The specification's light, moderate and severe cases are surface winds of
   15, 30 and 45 knots, so 25.3 ft/s here is the first of those. */
const DEFAULT_WIND_AT_20_FT = 25.3 /* ft/s */
const DEFAULT_INTENSITY = 0.5

/* Numerator and denominator of each filter, lowest order coefficient first, in
   the normalized frequency (L/V)s - so one set of numbers covers every scale
   length and airspeed. The gains are applied separately, being the part that
   carries the RMS gust velocity. */
const LONGITUDINAL_NUMERATOR = [1.0, 0.25]
const LONGITUDINAL_DENOMINATOR = [1.0, 1.357, 0.1987]

const TRANSVERSE_NUMERATOR = [1.0, 2.7478, 0.3398]
const TRANSVERSE_DENOMINATOR = [1.0, 2.9958, 1.9754, 0.1539]

/* The rolling gust is a first order lag on a noise source of its own. The
   pitching and yawing gusts are differentiators with the same lag, driven by the
   vertical and lateral gusts rather than by noise. */
const ROLL_NUMERATOR = [1.0]
const ROLL_DENOMINATOR = [1.0, 1.0]

const GRADIENT_NUMERATOR = [0.0, 1.0]
const GRADIENT_DENOMINATOR = [1.0, 1.0]

/* Wing span, ft, and the lag lengths built from it: the time constant of each
   rotational filter is the length below divided by the airspeed, so a gust is
   averaged out across the airframe over roughly the time it takes to fly a few
   spans. The four and the three are the specification's. */
const SPAN = SimulationConstants.B

const ROLL_LAG = (4 * SPAN) / Math.PI
const PITCH_LAG = (4 * SPAN) / Math.PI
const YAW_LAG = (3 * SPAN) / Math.PI

/* Time constant, seconds, on the height above ground the eddy sizes are worked
   out from.

   The filters below are discretized against the aircraft's own time scale, and
   they are only well behaved while that scale moves slowly compared to the
   turbulence itself. Move it in one step instead and every coefficient jumps at
   once, leaving the stored history of the filter meaningless against the new
   ones - and because these filters sit close to the unit circle, being driven
   far faster than they respond, what comes out of that is not a small error but
   a large and slowly decaying one.

   Height above ground is exactly the input that can do it: it is measured by a
   ray cast a few times a second, so it arrives as a staircase rather than a
   signal, and a cliff edge makes it a genuine step. Lagging it keeps the
   coefficients moving smoothly, and is not a fudge - the air the aircraft is
   flying through does not reorganize its eddies the instant the ground drops
   away either.

   Airspeed is not lagged. It comes out of the integrator, so it cannot jump. */
const HEIGHT_LAG = 3.0

/* The bilinear transform of x^i for a filter of degree n, as a polynomial in
   z^-1 after numerator and denominator have both been multiplied through by
   (1 + z^-1)^n: the entry is (1 - z^-1)^i (1 + z^-1)^(n-i), and the substitution
   itself contributes a factor (2/h)^i alongside it. Indexed by degree, so that
   nothing is padded out to a higher order than it has - padding would put a
   pole and a zero on top of each other at the Nyquist frequency, and leave the
   filter relying on them cancelling exactly. */
const BILINEAR = [
  [[1]],
  [
    [1, 1],
    [1, -1],
  ],
  [
    [1, 2, 1],
    [1, 0, -1],
    [1, -2, 1],
  ],
  [
    [1, 3, 3, 1],
    [1, 1, -1, -1],
    [1, -1, -1, 1],
    [1, -3, 3, -1],
  ],
]

/* Airspeed and height are both divisors below. Neither is ever legitimately
   zero in flight, but a paused or crashed simulation can present either. */
const MIN_AIRSPEED = 1.0 /* ft/s */
const MIN_HEIGHT = 10.0 /* ft */

function limit(value, min, max) {
  if (value < min) return min
  if (value > max) return max
  return value
}

function interpolate(breakpoints, table, value) {
  if (value <= breakpoints[0]) return table[0]
  if (value >= breakpoints[breakpoints.length - 1]) return table[table.length - 1]

  let i = 1
  while (breakpoints[i] < value) i++

  const span = (value - breakpoints[i - 1]) / (breakpoints[i] - breakpoints[i - 1])
  return table[i - 1] + span * (table[i] - table[i - 1])
}

/**
 * One gust component: a filter that colours its input into the right spectrum.
 *
 * The transfer function is held in a normalized frequency - the aircraft's own
 * time scale times s, whether that time scale is the one a scale length sets or
 * the one the span does - and is discretized by the bilinear transform on every
 * call, because whatever normalizes it keeps moving. That is legitimate as long
 * as it moves slowly compared to the filter itself, which it does: the aircraft
 * cannot change altitude or airspeed anywhere near as fast as the turbulence
 * changes.
 */
class GustFilter {
  constructor(numerator, denominator) {
    this.numerator = numerator
    this.denominator = denominator

    this.degree = Math.max(numerator.length, denominator.length) - 1
    this.bilinear = BILINEAR[this.degree]

    /* difference equation coefficients, rebuilt on every call */
    this.b = new Array(this.degree + 1).fill(0)
    this.a = new Array(this.degree + 1).fill(0)

    /* previous inputs and outputs, newest first */
    this.inputs = new Array(this.degree).fill(0)
    this.outputs = new Array(this.degree).fill(0)
  }

  /**
   * @param gain   filter gain, output units per unit input
   * @param step   time step, normalized by the filter's own time scale
   * @param input  white noise sample, or the gust being differentiated
   * @returns      this component of the gust
   */
  update(gain, step, input) {
    const k = 2.0 / step
    const n = this.degree

    /* bilinear transform, evaluated straight into the difference equation
       coefficients: b for the inputs, a for the outputs */
    for (let j = 0; j <= n; j++) {
      this.b[j] = 0
      this.a[j] = 0
    }

    let power = 1.0

    for (let i = 0; i <= n; i++) {
      const b = i < this.numerator.length ? gain * this.numerator[i] * power : 0
      const a = i < this.denominator.length ? this.denominator[i] * power : 0
      const bilinear = this.bilinear[i]

      for (let j = 0; j <= n; j++) {
        this.b[j] += b * bilinear[j]
        this.a[j] += a * bilinear[j]
      }

      power *= k
    }

    let output = this.b[0] * input

    for (let j = 1; j <= n; j++) {
      output += this.b[j] * this.inputs[j - 1] - this.a[j] * this.outputs[j - 1]
    }

    output /= this.a[0]

    for (let j = n - 1; j > 0; j--) {
      this.inputs[j] = this.inputs[j - 1]
      this.outputs[j] = this.outputs[j - 1]
    }

    this.inputs[0] = input
    this.outputs[0] = output

    return output
  }

  reset() {
    this.inputs.fill(0)
    this.outputs.fill(0)
  }
}

export default class TurbulenceModel {
  /**
   * @param seed  seed for the gust sequence. Fixed by default: turbulence that
   *              came out differently on every run would make it impossible to
   *              tell a change in the aircraft from a change in the weather.
   */
  constructor(seed = 0x1f16) {
    this.seed = seed >>> 0

    this.enabled = true

    /* the weather, until someone says otherwise */
    this.windAt20Ft = DEFAULT_WIND_AT_20_FT /* ft/s */
    this.intensity = DEFAULT_INTENSITY /* multiple of moderate turbulence */

    /* Turbulence aloft as read off a wind profile: a multiple of moderate
       against altitude, ft. Empty until a profile arrives, and until then the
       flat intensity above stands in for it. */
    this.profileAltitude = []
    this.profileIntensity = []

    /* gust velocity along the body axes, ft/s. Positive u is a gust blowing
       forwards along the fuselage, so a tailwind. */
    this.u = 0
    this.v = 0
    this.w = 0

    /* rotational gust, radians/s, about the same axes and with the same signs as
       the body rates it is added to */
    this.p = 0
    this.q = 0
    this.r = 0

    this.uFilter = new GustFilter(LONGITUDINAL_NUMERATOR, LONGITUDINAL_DENOMINATOR)
    this.vFilter = new GustFilter(TRANSVERSE_NUMERATOR, TRANSVERSE_DENOMINATOR)
    this.wFilter = new GustFilter(TRANSVERSE_NUMERATOR, TRANSVERSE_DENOMINATOR)

    this.pFilter = new GustFilter(ROLL_NUMERATOR, ROLL_DENOMINATOR)
    this.qFilter = new GustFilter(GRADIENT_NUMERATOR, GRADIENT_DENOMINATOR)
    this.rFilter = new GustFilter(GRADIENT_NUMERATOR, GRADIENT_DENOMINATOR)

    /* spare value from the last pair of gaussians drawn */
    this.spare = null

    /* lagged height above ground, ft. Null until the first step, which seeds it
       rather than easing towards it from nowhere. */
    this.smoothedHeight = null
  }

  /**
   * Steps the gust field forwards.
   *
   * Called once per physics step and not once per integration stage: the
   * turbulence is a property of the air the aircraft is flying through, not of
   * the aircraft, so it is held fixed across a step exactly as the control
   * surface positions are.
   *
   * Height above the ground and altitude are both wanted, and they are not the
   * same thing: the eddies down low are sized by how far it is to the ground
   * that is shedding them, while the weather aloft - the forecast profile, and
   * how much turbulence the air can hold at all - goes by height above sea
   * level. Over Norwegian terrain the two are a long way apart.
   *
   * @param height    height above the ground, ft
   * @param altitude  altitude above sea level, ft
   * @param airspeed  true airspeed, ft/s
   * @param dt        length of the step, seconds
   */
  update(height, altitude, airspeed, dt) {
    if (!this.enabled) {
      this.u = this.v = this.w = 0
      this.p = this.q = this.r = 0
      return
    }

    const v = Math.max(airspeed, MIN_AIRSPEED)

    const measured = Math.max(height, MIN_HEIGHT)

    if (this.smoothedHeight === null) {
      this.smoothedHeight = measured
    } else {
      this.smoothedHeight += (measured - this.smoothedHeight) * (1 - Math.exp(-dt / HEIGHT_LAG))
    }

    const h = this.smoothedHeight

    /* Low altitude parameters, held at their 1000 ft values above that height
       so they can be blended out across the gap. The vertical eddies are the
       size of the height above ground, the horizontal ones are larger, and the
       horizontal gusts are correspondingly stronger: close to the ground the
       turbulence is flattened out by the ground being in the way. */
    const low = Math.min(h, LOW_ALTITUDE_TOP)
    const shape = 0.177 + 0.000823 * low

    const lowVerticalSigma = 0.1 * this.windAt20Ft
    const lowHorizontalSigma = lowVerticalSigma / Math.pow(shape, 0.4)
    const lowVerticalScale = low
    const lowHorizontalScale = low / Math.pow(shape, 1.2)

    /* High altitude: no ground to flatten anything, so the turbulence is
       isotropic and both the magnitude and the scale length are the same on all
       three axes. How much of it there is comes from the forecast profile where
       there is one, and the table says how much the air can hold up there at
       all - a shear layer in the stratosphere has thin air to work with. */
    const intensity = this.profileAltitude.length
      ? interpolate(this.profileAltitude, this.profileIntensity, altitude)
      : this.intensity

    const highSigma = intensity * interpolate(ALTITUDE, RMS_GUST, altitude)

    const blend = limit((h - LOW_ALTITUDE_TOP) / (HIGH_ALTITUDE_BOTTOM - LOW_ALTITUDE_TOP), 0, 1)

    const horizontalSigma = lowHorizontalSigma + blend * (highSigma - lowHorizontalSigma)
    const verticalSigma = lowVerticalSigma + blend * (highSigma - lowVerticalSigma)

    const horizontalScale = lowHorizontalScale + blend * (HIGH_ALTITUDE_SCALE - lowHorizontalScale)
    const verticalScale = lowVerticalScale + blend * (HIGH_ALTITUDE_SCALE - lowVerticalScale)

    /* White noise of unit one sided spectral density, per radian per second.
       The filter gains below are written against that, so this factor is what
       makes the gust come out at the RMS velocity asked for regardless of the
       step length. */
    const noise = Math.sqrt(Math.PI / dt)

    /* The gains are the square roots of the spectra at zero frequency, which is
       what carries the RMS gust velocity into an otherwise unit filter. The
       longitudinal spectrum has twice the energy of a transverse one at long
       wavelengths, hence the two. */
    this.u = this.uFilter.update(
      horizontalSigma * Math.sqrt((2 * horizontalScale) / (Math.PI * v)),
      (dt * v) / horizontalScale,
      noise * this.gaussian(),
    )

    this.v = this.vFilter.update(
      horizontalSigma * Math.sqrt(horizontalScale / (Math.PI * v)),
      (dt * v) / horizontalScale,
      noise * this.gaussian(),
    )

    this.w = this.wFilter.update(
      verticalSigma * Math.sqrt(verticalScale / (Math.PI * v)),
      (dt * v) / verticalScale,
      noise * this.gaussian(),
    )

    /* The rolling gust comes from the vertical gust varying across the span, so
       its magnitude is set by the vertical one - but it is a difference across
       the aircraft rather than a value at a point, and it has its own spectrum
       and its own noise. The shorter the eddies the more of a difference there
       is between one wing and the other, which is why the scale length divides:
       low down, where the eddies are small, this is the component that dominates
       the ride. */
    const rollGain =
      (verticalSigma * Math.sqrt(0.8 / v) * Math.pow(Math.PI / (4 * SPAN), 1 / 6)) / Math.pow(verticalScale, 1 / 3)

    this.p = this.pFilter.update(rollGain, (dt * v) / ROLL_LAG, noise * this.gaussian())

    /* The pitching and yawing gusts are the gradients of the vertical and
       lateral gusts along the fuselage. The field is frozen in space and the
       aircraft flies through it, so a gradient along the flight path is the time
       derivative divided by the airspeed - hence the differentiators, and hence
       no noise source of their own. A gust arriving at the nose before the tail
       looks exactly like the aircraft pitching; the same gradient in the lateral
       gust looks like it yawing, and with the opposite sign, because the tail is
       behind the nose in both cases but z is down while y is right. */
    this.q = this.qFilter.update(1 / PITCH_LAG, (dt * v) / PITCH_LAG, this.w)
    this.r = -this.rFilter.update(1 / YAW_LAG, (dt * v) / YAW_LAG, this.v)
  }

  /**
   * Sets the weather.
   *
   * @param windAt20Ft  wind speed at 20 ft above the ground, ft/s. Sets how
   *                    rough it is below 1000 ft, and nothing else.
   * @param profile     the wind at altitude, from the ground up: for each level
   *                    an altitude in ft above sea level, the wind resolved into
   *                    east and north components in ft/s, and the gust speed
   *                    there in ft/s. Two levels or more give the turbulence
   *                    aloft; with fewer, the flat default is kept.
   */
  setWind(windAt20Ft, profile = []) {
    this.windAt20Ft = Math.max(windAt20Ft, 0)

    this.profileAltitude.length = 0
    this.profileIntensity.length = 0

    /* Two ways of reading turbulence out of a forecast, and the rougher of the
       two wins, which is how turbulence is forecast in practice - several
       indices, none of them sufficient alone, and the worst one is the one to
       plan around.

       The shear between two levels says how hard the air is being pulled apart
       between them, and belongs at the middle of the layer. The gust says what
       the forecast itself thinks is happening at a level: the gap between the
       gust and the mean wind is the size of the fluctuation about it, and a peak
       is about three standard deviations out. */
    for (let i = 1; i < profile.length; i++) {
      const below = profile[i - 1]
      const above = profile[i]

      const depth = above.altitude - below.altitude

      if (!(depth > 0)) continue

      const shear = Math.hypot(above.east - below.east, above.north - below.north) / depth

      const gust = Math.max(this.gustSpread(below), this.gustSpread(above)) / (GUST_PEAK_FACTOR * MODERATE_GUST)

      this.profileAltitude.push(0.5 * (below.altitude + above.altitude))
      this.profileIntensity.push(Math.max(shear / MODERATE_SHEAR, gust))
    }
  }

  /* How much of a level's gust is fluctuation rather than mean wind, ft/s */
  gustSpread(level) {
    return Math.max(level.gust - Math.hypot(level.east, level.north), 0)
  }

  /**
   * Switches the whole model on or off. Turning it off leaves calm air, and
   * turning it back on starts from calm air rather than from whatever the
   * filters were holding when they stopped.
   *
   * @returns whether turbulence is now on
   */
  setEnabled(enabled) {
    this.enabled = enabled

    this.u = this.v = this.w = 0
    this.p = this.q = this.r = 0

    /* seed the height again on the way back in, rather than easing over from
       wherever the aircraft was when it was switched off */
    this.smoothedHeight = null

    this.uFilter.reset()
    this.vFilter.reset()
    this.wFilter.reset()

    this.pFilter.reset()
    this.qFilter.reset()
    this.rFilter.reset()

    return this.enabled
  }

  /* Uniform random numbers, from a small deterministic generator (mulberry32).
     The point of carrying one here rather than using Math.random is that the
     sequence is repeatable, and that it is repeatable independently of anything
     else in the simulation that might want random numbers. */
  random() {
    this.seed = (this.seed + 0x6d2b79f5) >>> 0

    let t = this.seed
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }

  /* Normally distributed random numbers, zero mean and unit variance, by the
     polar form of the Box-Muller transform. It produces them in pairs, so every
     other call is free. */
  gaussian() {
    if (this.spare !== null) {
      const value = this.spare
      this.spare = null
      return value
    }

    let x
    let y
    let squared

    do {
      x = 2 * this.random() - 1
      y = 2 * this.random() - 1
      squared = x * x + y * y
    } while (squared >= 1 || squared === 0)

    const scale = Math.sqrt((-2 * Math.log(squared)) / squared)

    this.spare = y * scale
    return x * scale
  }
}
