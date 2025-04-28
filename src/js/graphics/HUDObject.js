import * as THREE from "./three.module.js"

export default class HUDObject {
  constructor(canvas) {
    this.canvas = canvas

    this.width = 1600
    this.height = 1600

    this.canvas.width = this.width
    this.canvas.height = this.height

    this.ctx = this.canvas.getContext("2d")
    this.ctx.lineWidth = 1.7
    this.ctx.font = "1em Arial"
    this.ctx.textBaseline = "middle"
    this.ctx.fillStyle = "green"
    this.ctx.strokeStyle = "green"
  }

  update(airplaneState) {
    this.heading = Math.round(THREE.MathUtils.RAD2DEG * airplaneState.psi)
    if (this.heading < 0) this.heading += 360
    if (this.heading > 359) this.heading -= 360

    this.heading = ("" + this.heading).padStart(3, "0")

    this.speed = Math.round(0.592484 * airplaneState.vt)
    this.altitude = Math.round(airplaneState.h)

    this.altitude = this.altitude.toLocaleString(undefined, {
      maximumFractionDigits: 0,
    })

    this.thrust = airplaneState.pow
    this.pitch = THREE.MathUtils.RAD2DEG * airplaneState.theta
    this.aoa = THREE.MathUtils.RAD2DEG * airplaneState.alpha
  }

  getTextBoundingBox(text) {
    const textMetrics = this.ctx.measureText(text)
    return [textMetrics.width + 5, textMetrics.fontBoundingBoxAscent + textMetrics.fontBoundingBoxDescent]
  }

  drawText(text, align, x, y) {
    this.ctx.textAlign = align
    this.ctx.fillText(text, x, y)

    const box = this.getTextBoundingBox(text)

    let adjust = 0
    switch (align) {
      case "right":
        adjust = box[0] - 1.5
        break
      case "center":
        adjust = box[0] / 2
        break
      case "left":
        adjust = 2.5
        break
    }

    this.ctx.beginPath()
    this.ctx.rect(x - adjust, y - box[1] / 2 - 1.5, box[0], box[1])
    this.ctx.stroke()
  }

  draw() {
    this.ctx.clearRect(0, 0, this.width, this.height)

    this.drawText(this.heading, "center", this.width / 2, (3 * this.height) / 5)
    this.drawText(this.speed, "left", (2 * this.width) / 5, this.height / 2)
    this.drawText(this.altitude, "right", (3 * this.width) / 5, this.height / 2)

    /*
    flight path marker angle = (pitch - aoa)
    this.ctx.beginPath()
    this.ctx.arc(this.width / 2, this.height / 2, 5, 0, 2 * Math.PI)
    this.ctx.stroke()
    */
  }
}
