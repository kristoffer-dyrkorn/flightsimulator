import SimulationConstants from "./hifimodel/simulationconstants.js"

/*
 * Why the aircraft crashed, in words - from the values measured, each under
 * its own name (see crash in index.js). Which of them are there says what
 * happened:
 *
 *   a touchdown:  gear (percent extended), sink (ft/min), bank (deg),
 *                 speed (kt, over the ground), off (the legs off the
 *                 runway) - those that failed
 *   strike        the part that hit the ground, with pitch, bank,
 *                 speedbrake, stabilator (deg)
 *   runoff        the legs that ran off the runway
 *   terrain       the altitude, ft, with no terrain below
 *
 * Returns the reasons, each a sentence, and the details, the values behind
 * them.
 */

const WHEELS = { nose: "nose wheel", mainL: "left main wheel", mainR: "right main wheel" }
const wheels = (legs) =>
  legs
    .split(",")
    .map((leg) => WHEELS[leg] ?? leg)
    .join(", ")

export function describeCrash(values) {
  const has = (name) => values[name] !== undefined
  const reasons = []
  const details = []

  if (has("strike")) {
    // the airframe hit the ground - see HARD_POINTS in landinggearmodel.js
    const part = values.strike.replaceAll("-", " ")
    reasons.push(`${part.includes("wing tip") ? "Wing tip" : "Tail"} strike: the ${part} hit the ground.`)
    if (has("pitch")) details.push(`Pitch: ${values.pitch}°`)
    if (has("bank")) details.push(`Bank: ${values.bank}°`)
    if (has("speedbrake")) details.push(`Speedbrake: ${values.speedbrake}°`)
    if (has("stabilator")) {
      details.push(`Stabilator: ${values.stabilator}° (trailing edge ${+values.stabilator >= 0 ? "down" : "up"})`)
    }
  } else if (has("runoff")) {
    reasons.push("The aircraft ran off the runway.")
    details.push(`Off the runway: ${wheels(values.runoff)}`)
  } else if (has("terrain")) {
    reasons.push("The aircraft flew off the edge of the terrain, or into it.")
    details.push(`Altitude: ${values.terrain} ft`)
  } else {
    // a touchdown - one or more of its conditions not met
    if (has("gear")) {
      const extended = +values.gear // percent
      reasons.push("The landing gear was not down.")
      details.push(`Landing gear: ${extended <= 0 ? "up" : extended >= 100 ? "handle up" : `${extended}% extended`}`)
    }
    if (has("sink")) {
      reasons.push("The touchdown was too hard.")
      details.push(`Sink rate: ${values.sink} ft/min (max ${SimulationConstants.MAX_SAFE_SINK_RATE} ft/min)`)
    }
    if (has("bank")) {
      reasons.push("The wings were not level at touchdown.")
      details.push(`Bank: ${values.bank}° (max ${SimulationConstants.MAX_SAFE_BANK}°)`)
    }
    if (has("speed")) {
      reasons.push("The touchdown was too fast - the tyres burst.")
      details.push(`Ground speed: ${values.speed} kt (max ${SimulationConstants.MAX_TYRE_SPEED} kt)`)
    }
    if (has("off")) {
      reasons.push("The aircraft touched down outside the runway.")
      details.push(`Off the runway: ${wheels(values.off)}`)
    }
  }

  return { reasons, details }
}
