export default class SimulationConstants {}

SimulationConstants.FEET_TO_METERS = 0.3048
SimulationConstants.METERS_TO_FEET = 3.28084

SimulationConstants.ALTITUDE_MIN = 0
SimulationConstants.ALTITUDE_MAX = 50000

SimulationConstants.POWER_MIN = 0
SimulationConstants.POWER_MAX = 1

SimulationConstants.ALPHA_MIN = -10
SimulationConstants.ALPHA_MAX = 45

SimulationConstants.BETA_MIN = -30
SimulationConstants.BETA_MAX = 30

SimulationConstants.ELEVATOR_MIN = -25
SimulationConstants.ELEVATOR_MAX = 25

SimulationConstants.ELEVATOR_TRIM = -1.8

SimulationConstants.RUDDER_MIN = -30
SimulationConstants.RUDDER_MAX = 30

SimulationConstants.AILERON_MIN = -21.5
SimulationConstants.AILERON_MAX = 21.5

SimulationConstants.B = 30.0
SimulationConstants.CBAR = 11.32
SimulationConstants.G = 32.174 // gravitational constant, ft/sec^2
SimulationConstants.HE = 160.0
SimulationConstants.RTOD = 57.29578
SimulationConstants.S = 300.0
SimulationConstants.XCGR = 0.35 // reference center of gravity along x axis
SimulationConstants.XCG = 0.3 // center of gravity along x axis

SimulationConstants.MASS = 20500.0 / SimulationConstants.G // mass of the aircraft, slugs
SimulationConstants.IXX = 9496.0 // inertial parameters
SimulationConstants.IYY = 55814.0
SimulationConstants.IZZ = 63100.0
SimulationConstants.IXZ = 982.0

SimulationConstants.GAMMA =
  SimulationConstants.IXX * SimulationConstants.IZZ - SimulationConstants.IXZ * SimulationConstants.IXZ

// Computes mass properties for the F16 nonlinear model.
// c[0] through c[8]  = inertia tensor elements.
//              c[9] = aircraft mass, slugs.
//              c[10] = xcg, longitudinal c.g. location,
//                      distance normalized by the m.a.c.

SimulationConstants.c = [
  ((SimulationConstants.IYY - SimulationConstants.IZZ) * SimulationConstants.IZZ -
    SimulationConstants.IXZ * SimulationConstants.IXZ) /
    SimulationConstants.GAMMA,
  ((SimulationConstants.IXX - SimulationConstants.IYY + SimulationConstants.IZZ) * SimulationConstants.IXZ) /
    SimulationConstants.GAMMA,
  SimulationConstants.IZZ / SimulationConstants.GAMMA,
  SimulationConstants.IXZ / SimulationConstants.GAMMA,
  (SimulationConstants.IZZ - SimulationConstants.IXX) / SimulationConstants.IYY,
  SimulationConstants.IXZ / SimulationConstants.IYY,
  1.0 / SimulationConstants.IYY,
  (SimulationConstants.IXX * (SimulationConstants.IXX - SimulationConstants.IYY) +
    SimulationConstants.IXZ * SimulationConstants.IXZ) /
    SimulationConstants.GAMMA,
  SimulationConstants.IXX / SimulationConstants.GAMMA,
  SimulationConstants.MASS,
  SimulationConstants.XCG
]
