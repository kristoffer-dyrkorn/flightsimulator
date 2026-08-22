import { Vector3, Quaternion } from "three"

// how far behind the aircraft the camera flies, in ms
const TRAIL_DELAY = 500

const SAMPLE_INTERVAL = 100

// keep CAPACITY positions & orientations along the trail
const CAPACITY = Math.ceil(TRAIL_DELAY / SAMPLE_INTERVAL) + 1

export default class ChaseObject {
  constructor(target) {
    // ting buffer of positions & orientations
    this.samples = []
    for (let i = 0; i < CAPACITY; i++) {
      this.samples.push({ position: new Vector3(), quaternion: new Quaternion() })
    }

    // index to newest value
    this.head = 0

    // time since the last position was read
    this.phase = 0

    // newest value
    this.previousPosition = new Vector3()
    this.previousQuaternion = new Quaternion()

    // (interpolated) output
    this.position = new Vector3()
    this.quaternion = new Quaternion()

    this.initialized = false

    this.reset(target)
  }

  reset(target) {
    for (const sample of this.samples) {
      sample.position.copy(target.position)
      sample.quaternion.copy(target.quaternion)
    }
    this.head = 0
    this.phase = 0
    this.previousPosition.copy(target.position)
    this.previousQuaternion.copy(target.quaternion)
    this.position.copy(target.position)
    this.quaternion.copy(target.quaternion)
  }

  update(target, frameTime) {
    if (!this.initialized || !(frameTime >= 0) || frameTime >= TRAIL_DELAY + SAMPLE_INTERVAL) {
      this.initialized = true
      this.reset(target)
      return
    }

    this.phase += frameTime

    const due = Math.floor(this.phase / SAMPLE_INTERVAL)

    if (due > 0) {
      this.phase -= due * SAMPLE_INTERVAL

      for (let i = 1; i <= due; i++) {
        const msIntoFrame = frameTime - this.phase - (due - i) * SAMPLE_INTERVAL
        const alongFrame = frameTime > 0 ? Math.min(1, Math.max(0, msIntoFrame / frameTime)) : 1

        this.head = (this.head + 1) % CAPACITY

        const sample = this.samples[this.head]

        sample.position.lerpVectors(this.previousPosition, target.position, alongFrame)
        sample.quaternion.slerpQuaternions(this.previousQuaternion, target.quaternion, alongFrame)
      }
    }

    this.previousPosition.copy(target.position)
    this.previousQuaternion.copy(target.quaternion)

    // interpolate
    const back = (TRAIL_DELAY - this.phase) / SAMPLE_INTERVAL

    const older = Math.ceil(back)
    const newer = older - 1
    const fraction = older - back

    const from = this.samples[(this.head - older + CAPACITY) % CAPACITY]
    const to = this.samples[(this.head - newer + CAPACITY) % CAPACITY]

    this.position.lerpVectors(from.position, to.position, fraction)
    this.quaternion.slerpQuaternions(from.quaternion, to.quaternion, fraction)
  }
}
