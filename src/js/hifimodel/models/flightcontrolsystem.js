import SimulationConstants from "../simulationconstants.js"
import AtmosphericModel from "./atmosphericmodel.js"
import CompressibilityModel from "./compressibilitymodel.js"

/**
 * F-16 flight control system.
 *
 * The F-16 is a fly-by-wire aircraft: the stick and the pedals are not
 * connected to anything that moves air. They feed a flight control computer,
 * and that computer decides what the surfaces do. The pilot therefore commands
 * a *response* - g and roll rate - rather than a deflection, and the FLCS works
 * out the deflections needed to produce it while keeping the aircraft inside
 * its structural and aerodynamic limits.
 *
 * That difference is what makes the aircraft feel like an F-16. Stick-free it
 * holds its flight path instead of wandering off, it needs no trimming, it
 * damps its own oscillations, and it will not let the pilot pull the wings off
 * or depart at high angle of attack.
 *
 * This is not the real (and classified) F-16 control law. It is the standard
 * command-augmentation structure from the literature this project already
 * builds on - Stevens & Lewis chapter 4, and NASA TP-1538 - with the gains
 * tuned against this aerodynamic model:
 *
 *   pitch   normal acceleration command, pitch rate damping, AoA limiter
 *   roll    roll rate command with roll rate damping, faded out at high AoA
 *   yaw     yaw damper on stability axis yaw rate, sideslip feedback, and an
 *           aileron-rudder interconnect that coordinates turns for the pilot
 *
 * Everything in here works in degrees and degrees/second. The state vector
 * holds angles and body rates in radians, so they are converted on the way in,
 * and the surface commands come out in degrees, which is what the aerodynamic
 * tables expect.
 */

/* Gain scheduling.
 *
 * The gains below are set at 300 knots and 5000 ft, where the dynamic pressure
 * is about 260 lb/ft^2 and the aircraft is comfortably subsonic. Away from
 * there, the stabilator deflection needed to pull a given g varies by a factor
 * of ten, so one fixed set of gains would be sluggish at one end of the envelope
 * and twitchy at the other.
 *
 * Two things drive that deflection. Dynamic pressure sets how much angle of
 * attack a given g costs, so the deflection needed falls as qbar rises. And the
 * static margin sets how hard that angle of attack has to be fought for, so the
 * deflection needed rises as the aerodynamic centre moves aft with Mach number -
 * which it does a long way, roughly tripling the margin between subsonic flight
 * and Mach 1.2. Scheduling on the product of the two tracks the deflection per g
 * measured off this model to within a factor of two across the envelope;
 * scheduling on dynamic pressure alone is out by a factor of ten, nearly all of
 * it transonic.
 *
 * The command paths take that product directly, so a given g error asks for a
 * deflection in proportion to what the g actually costs. The rate paths take its
 * square root, because damping only has to keep up with a short period frequency
 * that grows as the square root of the same quantity. The real FLCS schedules on
 * air data in much the same way. */
const QBAR_REF = 260
const STATIC_MARGIN_REF = SimulationConstants.XCGR - SimulationConstants.XCG
const GAIN_SCALE_MIN = 0.2
const GAIN_SCALE_MAX = 2.5

/* Pitch channel. The proportional and rate paths set how quickly the aircraft
   answers the stick; the integrator is what removes the need to trim, since it
   is the term that ends up holding whatever deflection level flight requires. */
const PITCH_NZ_P = 2.0 /* deg of elevator per g of error */
const PITCH_NZ_I = 2.0 /* deg/s of elevator per g of error */
const PITCH_Q_D = 0.2 /* deg of elevator per deg/s of pitch rate */

/* Angle of attack limiter. It works by taking g away from the command, not by
   fighting the g loop at the stabilator. Doing it at the command keeps one loop
   in charge of the aircraft: the g loop still sees an honest error, and there is
   no second saturating path for the two to argue over.

   The integral term is what makes the limit hold exactly. Proportional alone
   would need a gain high enough to make the limiter an on-off switch, and an
   on-off limiter sets up a limit cycle - it slams the nose down, lets go the
   moment the angle of attack drops, and does it again.

   The lead has to come from the rate of change of angle of attack, which is why
   there is a filter for it below. Pitch rate is the obvious thing to lead on and
   it is the wrong thing: in a sustained turn the pitch rate is large while the
   angle of attack sits perfectly still, so leading on pitch rate makes the
   limiter engage several degrees early and quietly caps the turn short of what
   the aircraft can do. */
const ALPHA_LIMIT_P = 1.0 /* g taken off the command per deg past the limit */
const ALPHA_LIMIT_I = 3.0 /* g/s taken off the command per deg past the limit */
const ALPHA_LIMIT_LEAD = 0.25 /* seconds of angle of attack rate lead */
const ALPHA_LIMIT_NZ_FLOOR = 0.0 /* lowest g the limiter alone may command */
const ALPHA_RATE_TAU = 0.2 /* seconds, smoothing on the differentiated AoA */

/* Roll channel. The gain is high enough that full lateral stick puts the
   ailerons on their stops, so that a full roll command gets the roll rate the
   airframe actually has rather than the lower one the loop gain would settle
   for. Roll authority is given up as the angle of attack limit approaches -
   rolling hard at high AoA is what departs an aircraft, so the FLCS refuses.

   ROLL_P used to be 0.6, which sounds modest next to the pitch loop's 2.0,
   but the two are not on the same footing: pitch commands g, against a
   command range of several g, while roll commands deg/s against a range of
   hundreds of them, so the same-looking number was actually a far harder
   push on the actuator. At 0.6, the aileron actuator's own 80 deg/s rate
   limit was the binding constraint once the roll rate error passed a mere
   6.6 deg/s - about 2% of what full stick asks for - so from the first
   instant of essentially any stick input, aileron travel was set by the
   actuator's hardware limit, not by how far the stick had actually moved.
   Every tap looked and felt the same: a snap to full rate.

   The pitch loop does not have that problem - its own rate-limit threshold
   (worked out the same way, from PITCH_NZ_P and the elevator actuator's own
   rate and bandwidth in actuatormodel.js) is a bit under 1.5g, close to a
   fifth of the 8g of nose-up command range full aft stick can ask for - so
   small stick inputs mostly stay in smooth proportional territory and only
   the more aggressive ones reach the actuator's limit. Retuned to put the
   aileron loop on the same footing: small roll inputs now ease the surface
   in instead of always slamming it, while full stick still walks the
   aileron out to its stops exactly as before - lowering the gain does not
   lower the ceiling, it only softens how fast small commands get there. */
const ROLL_P = 0.071 /* deg of aileron per deg/s of roll rate error */
const ROLL_ALPHA_FADE_START = 15 /* deg, where roll authority starts to fade */
const ROLL_ALPHA_FADE = 0.7 /* fraction of authority given up at the AoA limit */

/* The real aircraft rolls on differential stabilator as well as the
   ailerons - NASA TP-1538 table I lists +-5.375 deg per surface for it,
   alongside the +-21.5 deg of the ailerons. Driven off the same roll rate
   error, with its gain set so both effectors reach their own stop together:
   ROLL_P is deg of aileron per deg/s of error, and this is that same
   deg/s of error scaled down by how much less travel the stabilator has to
   give. */
const STAB_DIFF_P = ROLL_P * (SimulationConstants.ELEVATOR_DIFF_MAX / SimulationConstants.AILERON_MAX)

/* Yaw channel. The washout is what stops the damper from fighting a steady
   turn: it only passes the changing part of the yaw rate, so a sustained turn
   eventually looks like no yaw rate at all to the damper. */
const YAW_R_D = 0.6 /* deg of rudder per deg/s of stability axis yaw rate */
const YAW_NY_P = 8.0 /* deg of rudder per g of lateral acceleration */
const YAW_WASHOUT_TAU = 1.5 /* seconds */
const YAW_ARI = 0.35 /* fraction of full rudder at full roll command and 90 deg AoA */

function limit(value, min, max) {
  if (value < min) return min
  if (value > max) return max
  return value
}

export default class FlightControlSystem {
  constructor() {
    /* The leading edge flap schedule and the gain scheduling both need air
       data, and the gain scheduling needs to know where the aerodynamic centre
       has got to as well. These are private copies rather than the simulation's
       - together they are a handful of floating point operations and three table
       lookups, which is cheaper than making the caller compute them in the right
       order and hand them over. */
    this.atmosphericModel = new AtmosphericModel()
    this.compressibilityModel = new CompressibilityModel()

    /* Commanded control positions, degrees, plus the throttle as a fraction.
       The same object is reused every step so that the control loop does not
       allocate. Throttle and speedbrake are passed straight through - neither
       is part of the FLCS on the real aircraft, and the engine model already
       has a lag of its own. */
    this.commands = {
      throttle: 0,
      elevator: SimulationConstants.ELEVATOR_TRIM,
      stabilatorDiff: 0,
      aileron: SimulationConstants.AILERON_TRIM,
      rudder: 0,
      lef: 0,
      speedbrake: 0,
      gear: 0,
      brake: 0,
      noseSteer: 0,
    }

    /* The pitch integrator ends up holding the stabilator deflection needed to
       trim, so it starts at the trim value rather than at zero. Starting from
       zero would make the aircraft sag for the first second while the
       integrator wound itself up to the value it was always going to reach. */
    this.pitchIntegrator = SimulationConstants.ELEVATOR_TRIM

    /* low pass half of the yaw damper washout filter, deg/s */
    this.yawRateLowPass = 0

    /* lagged angle of attack, degrees. differentiating against it is what gives
       the limiter its lead - see ALPHA_RATE_TAU. */
    this.alphaLowPass = 0

    /* g the angle of attack limiter is currently holding back from the pilot */
    this.alphaLimitIntegral = 0

    /* true while the angle of attack limiter is overriding the pilot */
    this.alphaLimiterActive = false
  }

  /**
   * Turns pilot input into commanded control positions.
   *
   * @param input  pilot input - stick and pedal in -1..1, throttle in 0..1
   * @param x      current aircraft state
   * @param dt     seconds since the last call
   */
  update(input, x, dt) {
    const alpha = x.alpha * SimulationConstants.RTOD
    const p = x.p * SimulationConstants.RTOD
    const q = x.q * SimulationConstants.RTOD
    const r = x.r * SimulationConstants.RTOD

    /* Scheduled on airspeed, not on speed over the ground: the gains stand in
       for how much authority the surfaces have, and that is a question about the
       air going past them. In still air the two are the same number. */
    this.atmosphericModel.update(x.airspeed, x.alt)
    this.compressibilityModel.update(this.atmosphericModel.rmach)

    /* qbar is floored before the division: at a standstill it is zero, and the
       scales are clamped anyway, but the intermediate must stay finite */
    const staticMargin = STATIC_MARGIN_REF + this.compressibilityModel.acShift

    const commandScale = limit(
      (staticMargin / STATIC_MARGIN_REF) * (QBAR_REF / Math.max(this.atmosphericModel.qbar, 1)),
      GAIN_SCALE_MIN,
      GAIN_SCALE_MAX,
    )
    const rateScale = Math.sqrt(commandScale)

    /* The roll and yaw loops are rate loops and have no static margin in them,
       so they stay on dynamic pressure alone. */
    const lateralScale = limit(
      Math.sqrt(QBAR_REF / Math.max(this.atmosphericModel.qbar, 1)),
      GAIN_SCALE_MIN,
      GAIN_SCALE_MAX,
    )

    /* %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
       pitch: normal acceleration command
       %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%% */

    /* A centred stick commands 1 g, so the aircraft holds its flight path and
       never needs trimming. The same property means a level turn has to be
       flown with aft stick, exactly as in the real aircraft - 1 g in a 60
       degree bank is a descending spiral, not a level turn.

       Full travel maps to the structural g limits, and that is the whole of the
       g limiter: because the loop below tracks the command, bounding what can be
       asked for bounds what the aircraft does, and pulling harder on a stick
       that is already on its stop achieves nothing. */
    const nzStickCommand =
      input.pitchStick >= 0
        ? 1 + input.pitchStick * (SimulationConstants.NZ_MAX - 1)
        : 1 + input.pitchStick * (1 - SimulationConstants.NZ_MIN)

    /* Rate of change of angle of attack, by washout filter: the lag trails a
       ramp by exactly one time constant, so the difference divided by the time
       constant is the slope - and it is zero when the angle of attack is
       steady, however fast the aircraft happens to be pitching. */
    this.alphaLowPass += ((alpha - this.alphaLowPass) * dt) / ALPHA_RATE_TAU
    const alphaRate = (alpha - this.alphaLowPass) / ALPHA_RATE_TAU

    const alphaExcess = alpha + ALPHA_LIMIT_LEAD * alphaRate - SimulationConstants.ALPHA_LIMIT

    /* The integral only builds while the aircraft is past the limit, and bleeds
       back down to nothing once it is not, so the limiter releases the aircraft
       by itself. */
    this.alphaLimitIntegral = limit(
      this.alphaLimitIntegral + ALPHA_LIMIT_I * alphaExcess * dt,
      0,
      SimulationConstants.NZ_MAX - ALPHA_LIMIT_NZ_FLOOR,
    )

    this.alphaLimiterActive = alphaExcess > 0 || this.alphaLimitIntegral > 0

    /* The limiter's job is to stop the pull, not to bunt the aircraft, so it may
       take the g command down to nothing but no further. Without that floor it
       asks for the full negative limit as soon as it saturates, which at low
       dynamic pressure the aircraft cannot deliver either - it just pitches on
       through and trades an overshoot in one direction for a worse one in the
       other. The pilot's own authority is untouched: forward stick still
       commands negative g, and the floor never rises above what is being asked
       for. */
    const nzCommand = limit(
      nzStickCommand - this.alphaLimitIntegral - Math.max(0, ALPHA_LIMIT_P * alphaExcess),
      Math.min(nzStickCommand, ALPHA_LIMIT_NZ_FLOOR),
      SimulationConstants.NZ_MAX,
    )

    const nzError = nzCommand - x.nz

    /* Positive elevator is trailing edge down, which pitches the nose down, so
       more g means a more negative deflection. Positive pitch rate is nose up,
       and damping it means pushing the nose back down, so that term is added. */
    this.commands.elevator = this.pitchIntegrator - PITCH_NZ_P * nzError * commandScale + PITCH_Q_D * q * rateScale

    /* The integrator is what carries the trim, so clamping it to the travel of
       the stabilator is both the physical bound and the anti-windup: it cannot
       bank up error against a stop that it has no way of moving. */
    this.pitchIntegrator = limit(
      this.pitchIntegrator - PITCH_NZ_I * nzError * commandScale * dt,
      SimulationConstants.ELEVATOR_MIN,
      SimulationConstants.ELEVATOR_MAX,
    )

    /* %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
       roll: roll rate command
       %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%% */

    const alphaFade = limit(
      (alpha - ROLL_ALPHA_FADE_START) / (SimulationConstants.ALPHA_LIMIT - ROLL_ALPHA_FADE_START),
      0,
      1,
    )
    const rollAuthority = 1 - ROLL_ALPHA_FADE * alphaFade

    const pCommand = input.rollStick * SimulationConstants.ROLL_RATE_MAX * rollAuthority

    /* Positive aileron rolls left, so a roll to the right needs a negative
       deflection. No integrator here - a rate command does not need one, and
       the small standing deflection the airframe asymmetry calls for is what
       the aileron trim constant is for. */
    this.commands.aileron = SimulationConstants.AILERON_TRIM - ROLL_P * (pCommand - p) * lateralScale

    /* Same rate error, same sign convention - positive is a differential
       deflection that rolls left, matching the aileron above so the two
       effectors add rather than fight. No trim term: unlike the ailerons,
       an asymmetric stabilator has nothing to trim out, since it is the
       symmetric elevator command that carries any standing pitch trim. Left
       unclamped here, same as the aileron above - the actuator model is
       where travel limits are enforced. */
    this.commands.stabilatorDiff = -STAB_DIFF_P * (pCommand - p) * lateralScale

    /* %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
       yaw: damper, turn coordination, interconnect
       %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%% */

    /* What needs damping is rotation about the velocity vector, not about the
       body z axis. At low angle of attack the two are nearly the same; at high
       angle of attack they are far apart, and feeding back body yaw rate there
       is how a damper ends up driving a departure instead of preventing one. */
    const rStability = r * Math.cos(x.alpha) - p * Math.sin(x.alpha)

    this.yawRateLowPass += ((rStability - this.yawRateLowPass) * dt) / YAW_WASHOUT_TAU
    const rWashedOut = rStability - this.yawRateLowPass

    /* Positive rudder yaws the nose left. Damping a nose-right rate therefore
       takes positive rudder, and so does a sideslip that reads as negative
       lateral acceleration. Rolling right needs the nose pulled right, hence
       the sign on the interconnect - and it is scaled by sin(alpha) because
       adverse yaw is what it exists to cancel, and adverse yaw is an
       angle-of-attack effect. */
    this.commands.rudder =
      -input.yawPedal * SimulationConstants.RUDDER_MAX +
      YAW_R_D * rWashedOut * lateralScale +
      YAW_NY_P * x.ny * lateralScale -
      YAW_ARI * input.rollStick * Math.sin(x.alpha) * SimulationConstants.RUDDER_MAX

    /* %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%
       leading edge flaps, and the pass-through controls
       %%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%%% */

    /* The leading edge flaps are scheduled by the flap control system, not
       flown by the pilot. Same schedule as before, from
       https://github.com/shield09/gjf16fcs/blob/master/trim_fun.m#L72 -
       what is new is that this is now a command that an actuator has to chase,
       rather than a position the flaps are assumed to already be in. */
    this.commands.lef = limit(
      1.38 * alpha - (9.05 * this.atmosphericModel.qbar) / this.atmosphericModel.ps + 1.45,
      SimulationConstants.LEF_MIN,
      SimulationConstants.LEF_MAX,
    )

    this.commands.throttle = input.throttle

    /* Interlocked with the gear the same way JSBSim's F-16 model schedules
       it (fcs/speedbrake-scheduler, gear/gear-cmd-norm): full 60 degrees of
       travel with the gear up, capped to SPEEDBRAKE_MAX_GEAR_DOWN with it
       down, interpolated the same way over anything in between. The pilot's
       own lever position (input.speedbrake) is left alone - only what gets
       commanded to the actuator is capped, so nothing has to happen when
       the gear moves except this limit sliding, exactly as if the pilot
       were still holding the board wherever they put it. */
    const speedbrakeMax =
      SimulationConstants.SPEEDBRAKE_MAX +
      (SimulationConstants.SPEEDBRAKE_MAX_GEAR_DOWN - SimulationConstants.SPEEDBRAKE_MAX) * input.gear
    this.commands.speedbrake = limit(input.speedbrake, SimulationConstants.SPEEDBRAKE_MIN, speedbrakeMax)
    this.commands.gear = input.gear

    /* Wheel brakes are a pass-through lever like the speedbrake and
       throttle above - there's no computer between the pedal and the
       brake, just the actuator's own hydraulic lag (see actuatormodel.js). */
    this.commands.brake = input.brake

    /* Nosewheel steering, driven off the same rudder pedals as the rudder
       command above - the real aircraft's pedal-steering mode works exactly
       this way, one input feeding both the rudder in the air and the
       nosewheel on the ground, rather than a separate control. Left
       unconditional here: landinggearmodel.js only turns this into an
       actual force while the nose leg is in contact with the ground, which
       is the same thing as "weight on the nose gear" - there's no need to
       gate it a second time here. */
    this.commands.noseSteer = input.yawPedal * SimulationConstants.NOSEWHEEL_STEER_MAX
  }
}
