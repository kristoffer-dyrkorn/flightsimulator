import SimulationConstants from "../simulationconstants.js"

/**
 * Control surface actuators.
 *
 * A control surface cannot be where the flight control computer wants it
 * instantly. A hydraulic actuator has a maximum slew rate, and below that rate
 * it still lags its command. Both matter here. The rate limit is what stops a
 * step command - which is exactly what a keypress produces - from becoming a
 * step deflection, and it is also the reason a hard, fast stick input does not
 * get the full response the pilot asked for. The lag is small but it is inside
 * every feedback loop the FLCS closes, so it is part of what sets how much gain
 * the control laws can carry before they start to ring.
 *
 * The two combine naturally: for a large command the rate limit dominates and
 * the surface slews at full speed, and for a small one the lag dominates and
 * the surface eases into position.
 *
 * Position limits live here too rather than in the control laws, because that
 * is where they are in the aircraft - the control laws can ask for 40 degrees
 * of stabilator all they like, the surface stops at 25.
 *
 * The result is the set of actual control positions, which is what the
 * aerodynamic model is given. Throttle is carried along unchanged: it is a
 * lever, not an actuator, and the engine model has its own spool-up lag.
 */

/* Rates are deg/s and time constants are seconds. The 20.2 rad/s actuator
   bandwidth for the stabilator is the one used for the F-16 in Stevens &
   Lewis; the leading edge flaps are much slower at 7.25 rad/s, being large
   surfaces driven off a single drive shaft. The speedbrake is slower still and
   is rate limited rather than lagged - it is a pair of big doors that take
   about two seconds to open fully. */
const SURFACES = [
  {
    name: "elevator",
    rate: 60,
    tau: 1 / 20.2,
    min: SimulationConstants.ELEVATOR_MIN,
    max: SimulationConstants.ELEVATOR_MAX,
  },
  {
    // same physical stabilator actuators as elevator above, just commanded
    // to split rather than move together - same bandwidth, own travel limit
    name: "stabilatorDiff",
    rate: 60,
    tau: 1 / 20.2,
    min: -SimulationConstants.ELEVATOR_DIFF_MAX,
    max: SimulationConstants.ELEVATOR_DIFF_MAX,
  },
  {
    name: "aileron",
    rate: 80,
    tau: 1 / 20.2,
    min: SimulationConstants.AILERON_MIN,
    max: SimulationConstants.AILERON_MAX,
  },
  {
    name: "rudder",
    rate: 120,
    tau: 1 / 20.2,
    min: SimulationConstants.RUDDER_MIN,
    max: SimulationConstants.RUDDER_MAX,
  },
  {
    name: "lef",
    rate: 25,
    tau: 1 / 7.25,
    min: SimulationConstants.LEF_MIN,
    max: SimulationConstants.LEF_MAX,
  },
  {
    name: "speedbrake",
    rate: 30,
    tau: 1 / 20.2,
    min: SimulationConstants.SPEEDBRAKE_MIN,
    max: SimulationConstants.SPEEDBRAKE_MAX,
  },
  {
    // not a real control surface with a bandwidth behind it - this is the
    // aerodynamic gear position, 0..1, that f16simulation.js scales its
    // added gear drag by. It is deliberately decoupled from the visual gear
    // model, which shows/hides instantly on the pilot's command: real gear
    // takes time to travel, and that time should cost drag while it happens,
    // whether or not the mesh bothers to animate the same transition. Rate
    // limited rather than lagged, same reasoning as the speedbrake above -
    // a fixed travel time, not a bandwidth.
    name: "gear",
    rate: 1 / SimulationConstants.GEAR_TRANSITION_TIME,
    tau: 1 / 20.2,
    min: 0,
    max: 1,
  },
  {
    // wheel brake pedal position, 0..1 - a fast hydraulic response rather
    // than a bandwidth-limited surface, but not instant either
    name: "brake",
    rate: 4, // full travel in about 0.25s
    tau: 1 / 20.2,
    min: 0,
    max: 1,
  },
  {
    // nosewheel steering angle, driven by the rudder pedals once the nose
    // gear has weight on it (see landinggearmodel.js) - its own hydraulic
    // steering actuator, independent of the rudder's
    name: "noseSteer",
    rate: 60,
    tau: 1 / 20.2,
    min: -SimulationConstants.NOSEWHEEL_STEER_MAX,
    max: SimulationConstants.NOSEWHEEL_STEER_MAX,
  },
]

function limit(value, min, max) {
  if (value < min) return min
  if (value > max) return max
  return value
}

export default class ActuatorModel {
  constructor() {
    /* actual control positions, degrees */
    this.elevator = SimulationConstants.ELEVATOR_TRIM
    this.stabilatorDiff = 0
    this.aileron = SimulationConstants.AILERON_TRIM
    this.rudder = 0
    this.lef = 0
    this.speedbrake = 0
    this.gear = 0 // starts up, matching the sim's own starting state
    this.brake = 0
    this.noseSteer = 0

    /* throttle setting, fraction - passed through untouched */
    this.throttle = 0
  }

  /**
   * Moves every surface one step towards its command.
   *
   * @param commands  commanded control positions, from the flight control system
   * @param dt        seconds since the last call
   */
  update(commands, dt) {
    for (let i = 0; i < SURFACES.length; i++) {
      const surface = SURFACES[i]
      const target = limit(commands[surface.name], surface.min, surface.max)
      const position = this[surface.name]

      /* first order lag, slew rate limited */
      const travel = target - position
      const rate = limit(travel / surface.tau, -surface.rate, surface.rate)

      /* Never step past the command. Without this the lag would overshoot
         whenever dt exceeded the time constant, which turns a lag into an
         oscillation - and dt is set by the frame loop, not by this model. */
      const step = limit(rate * dt, -Math.abs(travel), Math.abs(travel))

      this[surface.name] = limit(position + step, surface.min, surface.max)
    }

    this.throttle = commands.throttle
  }
}
