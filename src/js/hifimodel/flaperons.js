import SimulationConstants from "./simulationconstants.js"

/*
 * The F-16's trailing edge surfaces are flaperons: one surface per wing,
 * doing the job of both an aileron and a flap. The flap command lowers both
 * together; the aileron command moves them in opposite directions. Each
 * surface only has so much travel, though, so with the flaps down a roll
 * input can't lower the flaperon that is already down much further - it
 * stays near its lower limit while the other one comes up. That is how the
 * real aircraft behaves with the flaps down, and it means some of the roll
 * authority is lost while they are.
 *
 * Positive aileron rolls left, which lowers the right flaperon.
 *
 * @param aileron  aileron command, degrees
 * @param flap     trailing edge flap command, degrees, positive down
 * @returns {right, left, aileron, flap}  each flaperon's deflection, degrees
 *          trailing edge down, and the aileron and flap they add up to once
 *          the travel limits have been applied
 */
export function mixFlaperons(aileron, flap) {
  const right = limit(flap + aileron, SimulationConstants.AILERON_MIN, SimulationConstants.AILERON_MAX)
  const left = limit(flap - aileron, SimulationConstants.AILERON_MIN, SimulationConstants.AILERON_MAX)

  return {
    right,
    left,
    aileron: 0.5 * (right - left),
    flap: 0.5 * (right + left),
  }
}

function limit(value, min, max) {
  if (value < min) return min
  if (value > max) return max
  return value
}
