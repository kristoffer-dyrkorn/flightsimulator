import SimulationConstants from "../simulationconstants.js"

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
 * What the wind is doing comes from the forecast for the surface, read at the
 * corners of the terrain tiles around the aircraft (see windfield.js), so it
 * changes from place to place. It also changes with height, because the ground
 * holds the air back: right at the surface the wind is nothing, and it picks up
 * logarithmically away from it, quickly at first and then more and more slowly.
 * The forecast is the wind at 10 m, so on the ground roll the wind across the
 * wing is a good deal less than the forecast says, and a few hundred feet up it
 * is a good deal more.
 *
 * That is wind shear, and it falls out of this for free: descending through it
 * on an approach takes away airspeed the aircraft had a moment ago, because the
 * headwind it was flying into is dying away underneath it. No special case,
 * just the same profile read at a different height.
 *
 * Higher up, the sample at a corner says less and less about the air the
 * aircraft is in. The forecast for the bottom of a sheltered fjord is calm, and
 * the air a few thousand feet above it is not, so away from the ground the wind
 * blends from the local one to the regional one, the average of the samples
 * around the aircraft. Above that there is no forecast, and the wind is held at
 * what it is at the top of the boundary layer.
 *
 * Only the horizontal wind is modelled. The forecast has nothing to say about
 * vertical motion of the air, and away from thunderstorms and mountain waves
 * there is not much of it to say anything about.
 */

/* The logarithmic profile, over terrain of middling roughness - mixed farmland
   and forest. It holds through the lowest hundred metres or so, the surface
   layer, and the wind is held at the value it reaches there above that. Below
   about a metre the profile is meaningless: the air is being held back by
   individual trees and buildings rather than by the terrain as a whole. */
const FORECAST_HEIGHT = 10 * SimulationConstants.METERS_TO_FEET
const ROUGHNESS = 0.15 * SimulationConstants.METERS_TO_FEET
const SURFACE_LAYER_TOP = 100 * SimulationConstants.METERS_TO_FEET
const LOWEST_HEIGHT = 1 * SimulationConstants.METERS_TO_FEET

/* Height above ground at which the wind starts to blend from the local wind to
   the regional one, and the height it is regional at, ft */
const LOCAL_TOP = 1000
const REGIONAL_BOTTOM = 3000

/**
 * The wind at a height above the ground, as a multiple of the forecast wind at
 * 10 m.
 *
 * @param height  height above the ground, ft
 */
export function boundaryLayerFactor(height) {
  const h = Math.min(Math.max(height, LOWEST_HEIGHT), SURFACE_LAYER_TOP)
  return Math.log(h / ROUGHNESS) / Math.log(FORECAST_HEIGHT / ROUGHNESS)
}

export default class WindModel {
  /**
   * @param field  the surface wind to read from - see windfield.js. Without one
   *               the air is still.
   */
  constructor(field = null) {
    this.enabled = true

    this.field = field

    /* wind velocity in earth axes, ft/s - the direction the air is moving
       towards, not the direction it comes from */
    this.east = 0
    this.north = 0
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
   * Reads the wind at a position.
   *
   * Unlike the turbulence this is evaluated at every stage of an integration
   * step rather than once per step, and correctly so: it is not a process
   * running in time that has to be held still to be integrated against, it is a
   * field the aircraft is moving through. Asking it where the aircraft is now is
   * always the right question.
   *
   * @param east, north  position, ft
   * @param altitude     altitude above sea level, ft
   * @param groundAlt    elevation of the terrain below, ft - far below the
   *                     aircraft while it is not yet known, which reads as
   *                     being high above the ground
   */
  update(east, north, altitude, groundAlt) {
    if (!this.enabled || !this.field?.ready) {
      this.east = 0
      this.north = 0
      return
    }

    const height = altitude - groundAlt

    const local = this.field.surfaceWind(
      east * SimulationConstants.FEET_TO_METERS,
      north * SimulationConstants.FEET_TO_METERS,
    )
    const regional = this.field.regional

    const blend = Math.min(Math.max((height - LOCAL_TOP) / (REGIONAL_BOTTOM - LOCAL_TOP), 0), 1)
    const factor = boundaryLayerFactor(height)

    this.east = factor * (local.east + blend * (regional.east - local.east))
    this.north = factor * (local.north + blend * (regional.north - local.north))
  }
}
