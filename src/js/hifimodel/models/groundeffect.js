import SimulationConstants from "../simulationconstants.js"

/*
 * Ground effect: close to the ground, the ground stops the wing's downwash
 * from developing fully, and the wing makes more lift at the same angle of
 * attack - the "float" an aircraft has in the flare. It fades out by about a
 * wingspan's height.
 *
 * The NASA wind tunnel data behind the rest of the aerodynamics was measured
 * well away from the ground, so it has nothing for this. The factor below is
 * the one the JSBSim F-16 model applies to its lift (aero/function/kCLge),
 * against the wing's height above the ground divided by the wingspan. That
 * file's references for it are NASA flight tests of ground effect on an F-15
 * and on the cranked arrow wing F-16XL, so it is an approximation from
 * related aircraft rather than measured F-16 data. Like JSBSim, only the lift
 * is changed - not the drag, or the pitching moment.
 */

// height above ground / wingspan, and the factor on lift there
const HEIGHT_OVER_SPAN = [0.0, 0.1, 0.15, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0]
const LIFT_FACTOR = [1.229, 1.124, 1.116, 1.124, 1.105, 1.041, 1.034, 1.019, 1.008, 1.003, 1.001, 1.0]

/**
 * @param height  height of the wing above the ground, ft - the aircraft's
 *                own reference point stands in for it, as the F-16's wing is
 *                mid-fuselage, close to the centre of gravity
 * @returns the factor on lift, 1 at a wingspan or more above the ground
 */
export function groundEffectLiftFactor(height) {
  const ratio = Math.max(0, height) / SimulationConstants.B

  const last = HEIGHT_OVER_SPAN.length - 1
  if (ratio >= HEIGHT_OVER_SPAN[last]) return LIFT_FACTOR[last]

  let i = 0
  while (ratio > HEIGHT_OVER_SPAN[i + 1]) i++

  const t = (ratio - HEIGHT_OVER_SPAN[i]) / (HEIGHT_OVER_SPAN[i + 1] - HEIGHT_OVER_SPAN[i])
  return LIFT_FACTOR[i] + t * (LIFT_FACTOR[i + 1] - LIFT_FACTOR[i])
}
