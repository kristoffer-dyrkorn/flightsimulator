import * as THREE from "./three.module.js"

export default class ChaseObject {
  constructor(target) {
    // move chase camera 0.8s after target moves
    this.timeDelay = 800

    // initialise buffer with start point
    this.points = []
    this.addPoint(target)

    this.accumulatedTime = 0

    // holder objects for return values, to avoid constant object allocation
    this.position = new THREE.Vector3()
    this.quaternion = new THREE.Quaternion()
  }

  addPoint(target) {
    const position = target.position.clone()
    const quaternion = target.quaternion.clone()
    this.points.push({ position: position, quaternion: quaternion })
  }

  getPoint(frameTime) {
    // return first point until buffer is large enough to support the time delay
    if (this.points.length * ChaseObject.timeInterval < this.timeDelay) {
      return { position: this.points[0].position, quaternion: this.points[0].quaternion }
    }

    this.accumulatedTime += frameTime

    // if we cross the next data point in time
    if (this.accumulatedTime > ChaseObject.timeInterval) {
      // adjust time
      this.accumulatedTime -= ChaseObject.timeInterval
      // remove oldest point so we still can interpolate between point[0] and point[1]
      this.points.shift()
    }

    // find interpolator t
    const t = this.accumulatedTime / ChaseObject.timeInterval

    const currPosition = this.points[0].position
    const nextPosition = this.points[1].position
    this.position.lerpVectors(currPosition, nextPosition, t)

    const currQuaternion = this.points[0].quaternion
    const nextQuaternion = this.points[1].quaternion
    this.quaternion.slerpQuaternions(currQuaternion, nextQuaternion, t)

    return { position: this.position, quaternion: this.quaternion }
  }
}

// register points every 0.1 s
ChaseObject.timeInterval = 100
