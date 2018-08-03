export default class Interpolator {
  constructor(minValue, maxValue, numItems) {
    this.step = (maxValue - minValue) / (numItems - 1)
    this.min = Math.trunc(minValue / this.step)
    this.max = Math.trunc(maxValue / this.step)
  }

  setInput(value) {
    const s = value / this.step
    this.start = Interpolator.clamp(Math.trunc(s), this.min, this.max)
    this.frac = s - this.start
    this.start = this.start - this.min
    this.end = this.start + Interpolator.sign(this.frac)
    this.frac = Math.abs(this.frac)
  }

  lookup(data) {
    return Interpolator.lerp(this.frac, data[this.start], data[this.end])
  }

  static sign(f) {
    if (f >= 0) return 1
    return -1
  }

  static clamp(input, min, max) {
    if (input <= min) return min + 1
    if (input >= max) return max - 1
    return input
  }

  static lerp(t, start, end) {
    return start + t * (end - start)
  }
}
