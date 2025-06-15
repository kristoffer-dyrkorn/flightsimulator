export default class SimulationConstants {}

SimulationConstants.FEET_TO_METERS = 0.3048
SimulationConstants.METERS_TO_FEET = 3.28084

SimulationConstants.ALTITUDE_MIN = 0
SimulationConstants.ALTITUDE_MAX = 50000

SimulationConstants.MACH_MIN = 0.0
SimulationConstants.MACH_MAX = 1.0

SimulationConstants.POWER_MIN = 0.0
SimulationConstants.POWER_MAX = 1.0

SimulationConstants.ALPHA_MIN = -20
SimulationConstants.ALPHA_MAX = 90
SimulationConstants.ALPHA_MAX_LEF = 45

SimulationConstants.BETA_MIN = -30
SimulationConstants.BETA_MAX = 30

SimulationConstants.ELEVATOR_MIN = -25
SimulationConstants.ELEVATOR_MAX = 25

SimulationConstants.ELEVATOR_TRIM = -1.5

SimulationConstants.RUDDER_MIN = -30
SimulationConstants.RUDDER_MAX = 30

SimulationConstants.AILERON_MIN = -21.5
SimulationConstants.AILERON_MAX = 21.5

SimulationConstants.AILERON_TRIM = -0.085

SimulationConstants.LEF_MIN = 0
SimulationConstants.LEF_MAX = 25

SimulationConstants.SPEEDBRAKE_MIN = 0
SimulationConstants.SPEEDBRAKE_MAX = 60

SimulationConstants.PI = 3.14159
SimulationConstants.RTOD = 180 / SimulationConstants.PI
SimulationConstants.DTOR = SimulationConstants.PI / 180

SimulationConstants.B = 30.0
SimulationConstants.CBAR = 11.32
SimulationConstants.G = 32.174 // gravitational constant, ft/sec^2
SimulationConstants.HE = 160.0
SimulationConstants.S = 300.0
SimulationConstants.XCGR = 0.35 // reference center of gravity along x axis
SimulationConstants.XCG = 0.3 // center of gravity along x axis

SimulationConstants.MASS = 20500.0 / SimulationConstants.G // mass of the aircraft, slugs
SimulationConstants.IXX = 9496.0 // inertial parameters
SimulationConstants.IYY = 55814.0
SimulationConstants.IZZ = 63100.0
SimulationConstants.IXZ = 982.0

SimulationConstants.HENG = 160.0 // engine angular momentum (slug-ft2/sec)
