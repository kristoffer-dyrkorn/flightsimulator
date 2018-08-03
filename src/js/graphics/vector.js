import GraphicsConstants from "./graphicsconstants.js"

export default class Vector extends Float32Array {
  constructor(x, y, z) {
    super(3)
    if (arguments.length === 3) {
      this[0] = x
      this[1] = y
      this[2] = z
    }
    if (arguments.length === 2) {
      // x is a matrix, y is start index
      this[0] = x[y++]
      this[1] = x[y++]
      this[2] = x[y]
    }
    if (arguments.length === 1) {
      // copy constructor
      this[0] = x[0]
      this[1] = x[1]
      this[2] = x[2]
    }
  }

  // "hacimos el rodrigues"
  rotate(to, perp, angle) {
    this.scale(Math.cos(angle * GraphicsConstants.DEGREES_TO_RADIANS))
    to.scale(Math.sin(angle * GraphicsConstants.DEGREES_TO_RADIANS))
    this.add(to)
    this.normalize()
    to.cross(perp, this)
  }

  cross(a, b) {
    this[0] = a[1] * b[2] - a[2] * b[1]
    this[1] = a[2] * b[0] - a[0] * b[2]
    this[2] = a[0] * b[1] - a[1] * b[0]
  }

  dot(v) {
    return this[0] * v[0] + this[1] * v[1] + this[2] * v[2]
  }

  add(v) {
    this[0] += v[0]
    this[1] += v[1]
    this[2] += v[2]
  }

  sub(v) {
    this[0] -= v[0]
    this[1] -= v[1]
    this[2] -= v[2]
  }

  scale(s) {
    this[0] *= s
    this[1] *= s
    this[2] *= s
  }

  getLength() {
    return Math.sqrt(this[0] * this[0] + this[1] * this[1] + this[2] * this[2])
  }

  normalize() {
    this.scale(1.0 / this.getLength())
  }
}
