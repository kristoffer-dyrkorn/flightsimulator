import Matrix from "../matrix.js"

export default class OBJ {
  constructor(name) {
    this.name = name
    this.meshes = new Map()

    this.modelMatrix = new Matrix()
  }

  setPosition(v) {
    this.modelMatrix.setPosition(v)
  }

  setOrientationFromEulerAngles(v) {
    // save current position
    const pos = this.modelMatrix.getPosition()

    // Euler angles are absolute rotations, so start with identity matrix
    this.modelMatrix = new Matrix()
    // restore position
    this.modelMatrix.setPosition(pos)

    // Align with world axes
    this.modelMatrix.rotateX(90)
    // Custom rotation sequence, matching airplane state Euler angle sequence
    // and object coordinate system translated into world coordinate system
    this.modelMatrix.rotateY(-v[2] + 180)
    this.modelMatrix.rotateZ(v[0])
    this.modelMatrix.rotateX(-v[1])
  }
}
