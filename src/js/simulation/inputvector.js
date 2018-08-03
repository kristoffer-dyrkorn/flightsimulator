/**
 * Input vector for F16 simulator.
 */

export default class InputVector {
  constructor() {
    this.throttle = 0 // 0 <= throttle <= 1.0f
    this.elevator = 0 // degrees
    this.aileron = 0 // degrees
    this.rudder = 0 // degrees
    this.vxTurbulence = 0 // ft/sec
    this.vyTurbulence = 0 // ft/sec
    this.vzTurbulence = 0 // ft/sec
  }
}
