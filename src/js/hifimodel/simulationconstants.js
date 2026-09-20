export default class SimulationConstants {}

SimulationConstants.FEET_TO_METERS = 0.3048
SimulationConstants.METERS_TO_FEET = 3.28084

SimulationConstants.ALTITUDE_MIN = 0
SimulationConstants.ALTITUDE_MAX = 50000

SimulationConstants.MACH_MIN = 0.0

// throttle setting, fraction
SimulationConstants.THROTTLE_MIN = 0.0
SimulationConstants.THROTTLE_MAX = 1.0

// engine power state, percent
SimulationConstants.POWER_LEVEL_MIN = 0.0
SimulationConstants.POWER_LEVEL_MAX = 100.0

SimulationConstants.ALPHA_MIN = -20
SimulationConstants.ALPHA_MAX = 90
SimulationConstants.ALPHA_MAX_LEF = 45

SimulationConstants.BETA_MIN = -30
SimulationConstants.BETA_MAX = 30

SimulationConstants.ELEVATOR_MIN = -25
SimulationConstants.ELEVATOR_MAX = 25

SimulationConstants.ELEVATOR_TRIM = -1.5

// differential deflection between the two stabilators, on top of the
// symmetric elevator command - the real roll effector alongside the
// ailerons, per NASA TP-1538 table I ("Differential (delta_d), per surface")
SimulationConstants.ELEVATOR_DIFF_MAX = 5.375

SimulationConstants.RUDDER_MIN = -30
SimulationConstants.RUDDER_MAX = 30

SimulationConstants.AILERON_MIN = -21.5
SimulationConstants.AILERON_MAX = 21.5

SimulationConstants.AILERON_TRIM = -0.085

SimulationConstants.LEF_MIN = 0
SimulationConstants.LEF_MAX = 25

SimulationConstants.SPEEDBRAKE_MIN = 0
SimulationConstants.SPEEDBRAKE_MAX = 60

// JSBSim's F-16 model (aircraft/f16/f16.xml, fcs/speedbrake-scheduler) scales
// commanded speedbrake by a gain scheduled on gear position: 1.0 with the
// gear up, 0.71667 with it down - i.e. the same 60 degrees of travel is
// capped to about 43 with the gear extended. See flightcontrolsystem.js,
// where this interpolates by the pilot's own gear command the same way
// JSBSim's table does (gear/gear-cmd-norm, not the slower-moving actuator
// position).
SimulationConstants.SPEEDBRAKE_MAX_GEAR_DOWN = 43

// landing gear: 0 = up/retracted, 1 = down/extended. Neither number comes
// from tunnel data or a real transition-time spec - both are estimates for
// a fighter-sized aircraft's gear.
SimulationConstants.GEAR_TRANSITION_TIME = 6 // seconds for a full up/down cycle

/* GEAR_DRAG, added zero-lift drag coefficient at full extension. JSBSim's
   F-16 model (github.com/JSBSim-Team/jsbsim, aircraft/f16/f16.xml) carries
   an aero/coefficient/CDgear function of exactly this shape - a flat CD
   times qbar times wing area, scaled by gear position - with a coefficient
   of 0.0270, and its <metrics> block uses the same wing area, span, and
   chord this simulation does (300 sq ft, 30 ft, 11.32 ft - both ultimately
   from the same Stevens & Lewis / NASA TP-1538 data), so that number
   applies here with no unit conversion. Two earlier estimates - 0.02 from
   memory of textbook ranges, then 0.01 from a drag-area buildup off this
   aircraft's own gear geometry - both undershot a real F-16 model's own
   figure, the drag-area one by nearly 3x, which given how approximate a
   bluff-body Cd guess is for an unfaired strut+wheel is not a surprising
   miss. */
SimulationConstants.GEAR_DRAG = 0.027

/* Wheel brakes, main gear only - the F-16's nosewheel is steered, not
   braked. BRAKE_FRICTION_COEFF_MAX is a typical dry-pavement aircraft brake
   friction coefficient at the anti-skid limit (published ranges run
   roughly 0.3-0.5); full pedal application blends the main gear's rolling
   friction, in landinggearmodel.js, up from its unbraked coefficient to
   this one. */
SimulationConstants.BRAKE_FRICTION_COEFF_MAX = 0.4

/* Nosewheel steering authority available from the rudder pedals alone (the
   real system's "low gain"/pedal-steering mode). The real aircraft also has
   a much larger-throw, handle-operated "high gain" mode for tight ground
   manoeuvring, which isn't modeled here since there's no separate control
   for it - this is an estimate for pedal-only authority, not a published
   figure. */
SimulationConstants.NOSEWHEEL_STEER_MAX = 6 // degrees

/* Ground-contact detection (index.js's collision check) - how a gear-down
   touch is told apart from a crash. There's no structural gear model yet
   (see the landing plan this came out of), so these don't decide how the
   aircraft *behaves* on contact, only whether contact ends the flight.

   GEAR_CONTACT_CLEARANCE is in meters, not feet like the rest of this file -
   it's consumed directly by a raycast against the terrain mesh, which is
   built in meters, and converting it back and forth to match the rest of
   this file would just add a conversion for no benefit. A wheel's own
   raycast origin sits at its hub, roughly a wheel radius above where the
   tire would actually touch (the main wheels are about 0.65 m in diameter),
   so this needs to be at least that, with a little more for the tire's own
   compression and to trigger the check slightly before the wheel is
   already through the ground rather than after.

   MAX_SAFE_SINK_RATE and MAX_SAFE_BANK are both estimates, not specs pulled
   from anywhere - a fighter's gear is commonly designed for something on
   the order of 600 ft/min at touchdown, and any real bank at contact drags a
   wingtip or store before the far main gear even arrives, so both are set
   with real margin under where actual damage would plausibly start rather
   than tuned to a source. */
SimulationConstants.GEAR_CONTACT_CLEARANCE = 0.5 // m
SimulationConstants.MAX_SAFE_SINK_RATE = 600 // ft/min
SimulationConstants.MAX_SAFE_BANK = 7 // degrees

// FCS limits to G, alpha and roll
SimulationConstants.NZ_MAX = 9.0
SimulationConstants.NZ_MIN = -3.0
SimulationConstants.ALPHA_LIMIT = 25.0
SimulationConstants.ROLL_RATE_MAX = 300.0

SimulationConstants.RTOD = 180 / Math.PI
SimulationConstants.DTOR = Math.PI / 180

SimulationConstants.B = 30.0
SimulationConstants.CBAR = 11.32
SimulationConstants.G = 32.174 // gravitational constant, ft/sec^2
SimulationConstants.S = 300.0
SimulationConstants.XCGR = 0.35 // reference center of gravity along x axis
SimulationConstants.XCG = 0.3 // center of gravity along x axis

SimulationConstants.MASS = 20500.0 / SimulationConstants.G // mass of the aircraft, slugs
SimulationConstants.IXX = 9496.0 // inertial parameters
SimulationConstants.IYY = 55814.0
SimulationConstants.IZZ = 63100.0
SimulationConstants.IXZ = 982.0

SimulationConstants.HENG = 160.0 // engine angular momentum (slug-ft2/sec)
