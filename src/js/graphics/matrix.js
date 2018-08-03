import Vector from "./vector.js"

const X_AXIS = 0
const Y_AXIS = 4
const Z_AXIS = 8
const POSITION = 12

export default class Matrix extends Float32Array {
  constructor(m) {
    super(16)
    if (arguments.length === 1) {
      this.set(m)
    } else {
      this[0] = 1.0
      this[5] = 1.0
      this[10] = 1.0
      this[15] = 1.0
    }
  }

  getXAxis() {
    return new Vector(this, X_AXIS)
  }

  getYAxis() {
    return new Vector(this, Y_AXIS)
  }

  getZAxis() {
    return new Vector(this, Z_AXIS)
  }

  getPosition() {
    return new Vector(this, POSITION)
  }

  getDirection() {
    const d = new Vector(this.getZAxis())
    d.scale(-1)
    return d
  }

  moveForward(dist) {
    const d = new Vector(this, Z_AXIS)
    const p = new Vector(this, POSITION)
    d.scale(-dist)
    p.add(d)
    this.setValue(p, POSITION)
  }

  rotateZ(angle) {
    this.rotate(0, 0, angle)
  }

  rotateY(angle) {
    this.rotate(0, angle, 0)
  }

  rotateX(angle) {
    this.rotate(angle, 0, 0)
  }

  rotate(rx, ry, rz) {
    const x = new Vector(this, X_AXIS)
    const y = new Vector(this, Y_AXIS)
    const z = new Vector(this, Z_AXIS)

    if (rx !== 0.0) {
      y.rotate(z, x, rx)
    }

    if (ry !== 0.0) {
      z.rotate(x, y, ry)
    }

    if (rz !== 0.0) {
      x.rotate(y, z, rz)
    }

    this.setValue(x, X_AXIS)
    this.setValue(y, Y_AXIS)
    this.setValue(z, Z_AXIS)
  }

  setPosition(v) {
    this.setValue(v, POSITION)
  }

  setValue(v, offset) {
    this[offset++] = v[0]
    this[offset++] = v[1]
    this[offset] = v[2]
  }

  swap(a, b) {
    const tmp = this[a]
    this[a] = this[b]
    this[b] = tmp
  }

  cameraInvert() {
    const x = new Vector(this, X_AXIS)
    const y = new Vector(this, Y_AXIS)
    const z = new Vector(this, Z_AXIS)
    const p = new Vector(this, POSITION)

    const newp = new Vector(-x.dot(p), -y.dot(p), -z.dot(p))
    this.setValue(newp, POSITION)

    this.swap(1, 4)
    this.swap(2, 8)
    this.swap(6, 9)
  }

  setProjection(fovy, aspect, near, far) {
    const f = 1.0 / Math.tan(fovy / 2)
    const rangeInverted = 1 / (near - far)
    this[0] = f / aspect
    this[5] = f
    this[10] = (near + far) * rangeInverted
    this[11] = -1
    this[14] = near * far * rangeInverted * 2
    this[15] = 0
  }
}
