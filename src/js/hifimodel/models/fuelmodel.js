import SimulationConstants from "../simulationconstants.js"

/*
 * Internal fuel: how fast the engine burns it, and what that does to the
 * aircraft's weight, centre of gravity and moments of inertia.
 *
 * Fuel flow follows the engine's power level - the throttle, with the
 * engine's own spool up and down (see enginemodel.js) - and, as a jet
 * engine's does, the air it is working in: at altitude, in thin air, it
 * burns far less for the same throttle. Across the dry range it goes from
 * idle to military power in step with the thrust; in afterburner on from
 * there to full afterburner. Military and full afterburner fuel flow are
 * the engine's thrust there times its specific fuel consumption, typical
 * for the F100 the engine model's thrust tables are for: some 10,000 lb/h
 * at military power and 42,000 lb/h in full afterburner at sea level. The
 * idle flow falls off with the air the same way military power's does.
 *
 * Weight: the model's aerodynamic and inertia data are for a 20,500 lb
 * aircraft, which is an F-16 of OPERATING_WEIGHT - with pilot, gun
 * ammunition and wing tip missiles - with half its internal fuel, so it is
 * that plus the fuel aboard.
 *
 * Centre of gravity: the fuel flow proportioner drains the forward and aft
 * tanks evenly, but the CG still moves aft as the fuel goes - by some 3.5%
 * of the mean chord from full to near empty (from 33% to 36.5%, in Falcon
 * BMS's model of the aircraft). It is put at the model's own CG, XCG, with
 * half the fuel aboard, and moves linearly with the fuel either side.
 *
 * Moments of inertia: the fuel sits in the fuselage and wing roots, closer
 * to the CG than the airframe's mass on average, so they change by only
 * INERTIA_FUEL_SHARE as much as the weight does, relative to the model's.
 *
 * With the tanks dry the engine flames out: no fuel flow, and no thrust
 * beyond what the windmilling engine drags.
 */
export const FUEL_CAPACITY = 7000 // lb, internal
const OPERATING_WEIGHT = 17000 // lb
const REFERENCE_WEIGHT = 20500 // lb - see SimulationConstants.MASS
const FUEL_FLOW_IDLE = 1000 // lb/h, at sea level, standing still
const TSFC_MIL = 0.78 // lb of fuel an hour per lb of thrust
const TSFC_MAX = 2.1
const CG_TRAVEL = 0.035 // of the mean chord, aft from full to empty
const INERTIA_FUEL_SHARE = 0.5

export default class FuelModel {
  /**
   * @param fuel  lb aboard to start with
   */
  constructor(fuel = FUEL_CAPACITY) {
    this.flow = 0 // lb/h
    this.setFuel(fuel)
  }

  // sets the fuel aboard, lb, and what follows from it
  setFuel(fuel) {
    this.fuel = Math.min(Math.max(fuel, 0), FUEL_CAPACITY)
    const weight = OPERATING_WEIGHT + this.fuel
    this.mass = weight / SimulationConstants.G // slugs
    this.xcg = SimulationConstants.XCG + CG_TRAVEL * (0.5 - this.fuel / FUEL_CAPACITY)
    const inertia = 1 + INERTIA_FUEL_SHARE * (weight / REFERENCE_WEIGHT - 1)
    this.ixx = SimulationConstants.IXX * inertia
    this.iyy = SimulationConstants.IYY * inertia
    this.izz = SimulationConstants.IZZ * inertia
    this.ixz = SimulationConstants.IXZ * inertia
  }

  get empty() {
    return this.fuel <= 0
  }

  // the fuel left, as a share of a full load
  get fraction() {
    return this.fuel / FUEL_CAPACITY
  }

  /**
   * Burns fuel for a time step.
   *
   * @param engine  the engine model - for its thrust tables
   * @param pow     the engine's power level, 0 to 100 (50 is military power)
   * @param alt     altitude, ft
   * @param rmach   Mach number
   * @param dt      s
   */
  update(engine, pow, alt, rmach, dt) {
    if (this.empty) {
      this.flow = 0
      return
    }
    const mil = engine.engineThrust(50, alt, rmach)
    const idle = (FUEL_FLOW_IDLE * mil) / engine.engineThrust(50, 0, 0)
    const p = Math.min(Math.max(pow, 0), 100)
    if (p <= 50) {
      this.flow = idle + (TSFC_MIL * mil - idle) * (p / 50)
    } else {
      const max = engine.engineThrust(100, alt, rmach)
      this.flow = TSFC_MIL * mil + (TSFC_MAX * max - TSFC_MIL * mil) * ((p - 50) / 50)
    }
    this.setFuel(this.fuel - (this.flow * dt) / 3600)
  }
}
