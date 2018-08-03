import Matrix from "./matrix.js"
import GraphicsConstants from "./graphicsconstants.js"

export default class Camera {
  constructor(fovy) {
    this.fovy = fovy // field of view, Y direction
    this.projectionMatrix = new Matrix() // perspective projection & screen aspect ratios
    this.viewMatrix = new Matrix() // camera location and direction
    this.cameraMatrix = new Matrix() // inverse view matrix, calculated as needed
    this.transformMatrix = new Matrix() // premultiplied projection matrix and camera matrix
  }

  setPosition(v) {
    this.viewMatrix.setPosition(v)
  }

  getPosition() {
    return this.viewMatrix.getPosition()
  }

  getDirection() {
    return this.viewMatrix.getDirection()
  }

  moveForward(dist) {
    this.viewMatrix.moveForward(dist)
  }

  setOrientationFromEulerAngles(v) {
    // save current position
    const pos = this.viewMatrix.getPosition()

    // Euler angles are absolute rotations, so start with identity matrix
    this.viewMatrix = new Matrix()
    // restore position
    this.viewMatrix.setPosition(pos)

    // Align with world axes
    this.viewMatrix.rotateX(90)
    // Custom rotation sequence, matching the airplane state Euler angle sequence
    this.viewMatrix.rotateY(-v[2])
    this.viewMatrix.rotateZ(-v[0])
    this.viewMatrix.rotateX(v[1])
  }

  recalcCameraMatrix() {
    this.cameraMatrix = new Matrix(this.viewMatrix)
    this.cameraMatrix.cameraInvert()
  }

  getCameraMatrix() {
    this.recalcCameraMatrix()
    return this.cameraMatrix
  }

  setProjectionMatrix(aspect) {
    const horizConeExtents = aspect * Math.tan(this.fovy / 2)
    this.viewConeAngle = Math.atan(Math.sqrt(horizConeExtents * horizConeExtents + 1))
    this.projectionMatrix.setProjection(this.fovy, aspect, GraphicsConstants.NEAR_CLIP, GraphicsConstants.FAR_CLIP)
  }

  getProjectionMatrix() {
    return this.projectionMatrix
  }

  // transform matrix = projection matrix * cam matrix
  // calculate once per frame, in JS,
  // instead of once per vertex per frame, on the GPU
  calculateTransformMatrix() {
    this.transformMatrix[0] = this.projectionMatrix[0] * this.cameraMatrix[0]
    this.transformMatrix[1] = this.projectionMatrix[5] * this.cameraMatrix[1]
    this.transformMatrix[2] = this.projectionMatrix[10] * this.cameraMatrix[2]
    this.transformMatrix[3] = this.projectionMatrix[11] * this.cameraMatrix[2]

    this.transformMatrix[4] = this.projectionMatrix[0] * this.cameraMatrix[4]
    this.transformMatrix[5] = this.projectionMatrix[5] * this.cameraMatrix[5]
    this.transformMatrix[6] = this.projectionMatrix[10] * this.cameraMatrix[6]
    this.transformMatrix[7] = this.projectionMatrix[11] * this.cameraMatrix[6]

    this.transformMatrix[8] = this.projectionMatrix[0] * this.cameraMatrix[8]
    this.transformMatrix[9] = this.projectionMatrix[5] * this.cameraMatrix[9]
    this.transformMatrix[10] = this.projectionMatrix[10] * this.cameraMatrix[10]
    this.transformMatrix[11] = this.projectionMatrix[11] * this.cameraMatrix[10]

    this.transformMatrix[12] = this.projectionMatrix[0] * this.cameraMatrix[12]
    this.transformMatrix[13] = this.projectionMatrix[5] * this.cameraMatrix[13]
    this.transformMatrix[14] = this.projectionMatrix[10] * this.cameraMatrix[14] + this.projectionMatrix[14]
    this.transformMatrix[15] = this.projectionMatrix[11] * this.cameraMatrix[14]
  }

  getTransformMatrix() {
    this.recalcCameraMatrix()
    this.calculateTransformMatrix()
    return this.transformMatrix
  }
}
