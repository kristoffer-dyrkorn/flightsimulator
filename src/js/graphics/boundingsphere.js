import Vector from "./vector.js"

export default class BoundingSphere {
  constructor(position, extents, height) {
    const midPoint = new Vector(extents, extents, height)
    midPoint.scale(0.5)
    position.add(midPoint)

    this.position = position
    this.radius = Math.sqrt(0.5 * (extents * extents + 0.5 * height * height))
  }
}
