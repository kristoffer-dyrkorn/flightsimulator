/**
 * Steady wind.
 *
 * The turbulence model handles the part of the wind that fluctuates. This one
 * handles the part that does not: the mean flow the whole airmass is moving at,
 * which is a much larger number and does something quite different to the
 * aircraft.
 *
 * An aircraft has no way of knowing it is in a wind. It flies through air, and
 * the air is what it measures itself against, so a 40 knot wind changes nothing
 * about how the aircraft handles - and everything about where it ends up. The
 * whole airmass is sliding over the ground, carrying the aircraft with it: the
 * nose points one way and the track goes another, and closing that gap is what
 * the crab angle on every crosswind approach is for. Turned into a flight model,
 * that means the aerodynamics are given the velocity relative to the air while
 * the position is integrated from the velocity over the ground, and the wind is
 * simply the difference between the two.
 *
 * What the wind is doing comes from the same forecast profile the turbulence
 * intensity does, so the wind changes with altitude - which is the other half of
 * why it matters. Climbing through a layer where the wind changes puts the
 * aircraft into air moving at a different speed than the air it just left, and
 * for the moment before it settles, that lands entirely on the airspeed. That is
 * wind shear, and it falls out of this for free: no special case, just the same
 * profile read at a different height.
 *
 * Only the horizontal wind is modelled. The forecast has nothing to say about
 * vertical motion of the air, and away from thunderstorms and mountain waves
 * there is not much of it to say anything about.
 */

function interpolate(breakpoints, table, value) {
  if (value <= breakpoints[0]) return table[0]
  if (value >= breakpoints[breakpoints.length - 1]) return table[table.length - 1]

  let i = 1
  while (breakpoints[i] < value) i++

  const span = (value - breakpoints[i - 1]) / (breakpoints[i] - breakpoints[i - 1])
  return table[i - 1] + span * (table[i] - table[i - 1])
}

export default class WindModel {
  constructor() {
    this.enabled = true

    /* wind velocity in earth axes, ft/s - the direction the air is moving
       towards, not the direction it comes from */
    this.east = 0
    this.north = 0

    /* the profile it is read from: wind against altitude, ft */
    this.profileAltitude = []
    this.profileEast = []
    this.profileNorth = []
  }

  /**
   * Sets the wind profile.
   *
   * @param profile  the wind at altitude, from the ground up: for each level an
   *                 altitude in ft above sea level and the wind there resolved
   *                 into east and north components, ft/s. Held flat below the
   *                 lowest level and above the highest.
   */
  setWind(profile = []) {
    this.profileAltitude.length = 0
    this.profileEast.length = 0
    this.profileNorth.length = 0

    for (const level of profile) {
      this.profileAltitude.push(level.altitude)
      this.profileEast.push(level.east)
      this.profileNorth.push(level.north)
    }
  }

  /**
   * Switches the wind on or off, and returns whether it is now on. Turning it
   * off leaves still air.
   */
  setEnabled(enabled) {
    this.enabled = enabled

    this.east = 0
    this.north = 0

    return this.enabled
  }

  /**
   * Reads the wind at an altitude.
   *
   * Unlike the turbulence this is evaluated at every stage of an integration
   * step rather than once per step, and correctly so: it is not a process
   * running in time that has to be held still to be integrated against, it is a
   * fixed field the aircraft is moving through. Asking it where the aircraft is
   * now is always the right question.
   *
   * @param altitude  altitude above sea level, ft
   */
  update(altitude) {
    if (!this.enabled || this.profileAltitude.length === 0) {
      this.east = 0
      this.north = 0
      return
    }

    this.east = interpolate(this.profileAltitude, this.profileEast, altitude)
    this.north = interpolate(this.profileAltitude, this.profileNorth, altitude)
  }
}
