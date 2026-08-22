/**
 * Compressibility corrections to the aerodynamic coefficients.
 *
 * The aerodynamic tables this model is built on (NASA TN-D-8176) are indexed on
 * angle of attack, sideslip and control deflection, and on nothing else. There
 * is no Mach number in them anywhere: they describe an aircraft flying slowly
 * enough that the air can be treated as incompressible.
 *
 * Above about Mach 0.9 that stops being true, and what it leaves out is the
 * single largest force error in the model. Drag very nearly doubles between
 * Mach 0.9 and Mach 1.05 as the shock waves form, and without that the aircraft
 * has nothing to stop it: thrust simply keeps winning. Uncorrected, this model
 * would accelerate to Mach 1.8 in level flight at 1000 ft, where the real F-16
 * is held to about Mach 1.05 by exactly the drag that is missing.
 *
 * Three effects are corrected here, all as functions of Mach number:
 *
 *   wave drag    the drag rise through the transonic region, added to CD. It
 *                peaks just past Mach 1 and then eases off, because once the
 *                shocks are established and swept back they stop getting worse.
 *
 *   lift slope   lift per degree of angle of attack rises as Mach 1 is
 *                approached and then falls away above it, so the same stick
 *                buys progressively less g the faster the aircraft goes.
 *
 *   centre shift the aerodynamic centre moves aft going supersonic, which is a
 *                nose down moment proportional to the normal force. This is
 *                Mach tuck: the aircraft needs more and more nose up trim
 *                through Mach 1, and becomes markedly more stable beyond it.
 *
 * The numbers are the published drag and lift characteristics of a clean F-16,
 * expressed as corrections to what the tables in this model already give - the
 * tables put CD at 0.0202 and the lift curve slope at 3.79 per radian at low
 * speed, which is where the real aircraft is, so the corrections are what is
 * needed to track it from there. They are not a substitute for Mach dependent
 * tables; they are the leading order behaviour those tables would show.
 *
 * Not corrected: control surface effectiveness, which does fall off
 * supersonically, and the lateral coefficients, whose directional stability
 * falls off too. The trim change that dominates the feel of going supersonic
 * comes from the centre shift above, and that is here.
 */

/* Mach number breakpoints for all three tables below. Held flat outside the
   range - the F-16 has no business above Mach 2, and the corrections have all
   gone nearly constant by then anyway. */
const MACH = [0.0, 0.6, 0.8, 0.85, 0.9, 0.95, 1.0, 1.05, 1.2, 1.4, 1.6, 1.8, 2.0]

/* Drag added to CD. Nothing until the drag divergence Mach number a little
   below 0.9, then a steep rise to the peak just past Mach 1. */
const WAVE_DRAG = [0.0, 0.0, 0.0, 0.0005, 0.0015, 0.005, 0.014, 0.02, 0.0185, 0.016, 0.014, 0.0125, 0.0115]

/* Multiplier on the lift curve slope. */
const LIFT_FACTOR = [1.0, 1.02, 1.06, 1.09, 1.13, 1.17, 1.15, 1.1, 1.0, 0.88, 0.8, 0.74, 0.7]

/* Aft movement of the aerodynamic centre, as a fraction of the mean
   aerodynamic chord. Enters the pitching moment the same way the offset between
   the actual and reference centre of gravity does, because it is the same
   thing - a normal force acting at a different place along the chord. */
const AC_SHIFT = [0.0, 0.0, 0.004, 0.008, 0.016, 0.035, 0.06, 0.08, 0.105, 0.118, 0.124, 0.128, 0.13]

/**
 * Linear interpolation into one of the tables above. A plain scan is enough:
 * there are thirteen breakpoints, and the Mach number moves by a tiny fraction
 * of a breakpoint between one step and the next, so the search finishes almost
 * immediately in practice.
 */
function interpolate(table, mach) {
  if (mach <= MACH[0]) return table[0]
  if (mach >= MACH[MACH.length - 1]) return table[table.length - 1]

  let i = 1
  while (MACH[i] < mach) i++

  const span = (mach - MACH[i - 1]) / (MACH[i] - MACH[i - 1])
  return table[i - 1] + span * (table[i] - table[i - 1])
}

export default class CompressibilityModel {
  constructor() {
    this.waveDrag = 0
    this.liftFactor = 1
    this.acShift = 0
  }

  /**
   * @param mach  Mach number
   */
  update(mach) {
    this.waveDrag = interpolate(WAVE_DRAG, mach)
    this.liftFactor = interpolate(LIFT_FACTOR, mach)
    this.acShift = interpolate(AC_SHIFT, mach)
  }
}
