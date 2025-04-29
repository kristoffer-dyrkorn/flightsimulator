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
    this.ctx.fillStyle = "PaleGreen"
    this.ctx.strokeStyle = "PaleGreen"
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
    this.pitch = airplaneState.theta
    this.roll = airplaneState.phi
    this.aoa = airplaneState.alpha
  }

  getTextBoundingBox(text) {
    const textMetrics = this.ctx.measureText(text)
    return [textMetrics.width + 5, textMetrics.fontBoundingBoxAscent + textMetrics.fontBoundingBoxDescent]
  }

  drawText(text, align, x, y) {
    this.ctx.textAlign = align
    this.ctx.fillText(text, x, y)

    const box = this.getTextBoundingBox(text)

    this.ctx.beginPath()

    let adjust = 0
    switch (align) {
      case "right":
        adjust = box[0] - 1.5
        this.ctx.moveTo(x - adjust, y - box[1] / 2 - 2)
        this.ctx.lineTo(x - adjust + box[0], y - box[1] / 2 - 2)
        this.ctx.lineTo(x - adjust + box[0] + 7, y - box[1] / 2 - 1.5 + box[1] / 2)
        this.ctx.lineTo(x - adjust + box[0], y - box[1] / 2 - 1.5 + box[1])
        this.ctx.lineTo(x - adjust, y - box[1] / 2 - 1.5 + box[1])
        this.ctx.lineTo(x - adjust, y - box[1] / 2 - 1.5)
        break
      case "center":
        adjust = box[0] / 2
        this.ctx.rect(x - adjust, y - box[1] / 2 - 2, box[0], box[1])
        break
      case "left":
        adjust = 2.5
        this.ctx.moveTo(x - adjust, y - box[1] / 2 - 2)
        this.ctx.lineTo(x - adjust + box[0], y - box[1] / 2 - 2)
        this.ctx.lineTo(x - adjust + box[0], y - box[1] / 2 - 1.5 + box[1])
        this.ctx.lineTo(x - adjust, y - box[1] / 2 - 1.5 + box[1])
        this.ctx.lineTo(x - adjust - 7, y - box[1] / 2 - 1.5 + box[1] / 2)
        this.ctx.lineTo(x - adjust, y - box[1] / 2 - 1.5)
        break
    }

    this.ctx.stroke()
  }

  drawPitchLadder() {
    this.ctx.translate(this.width / 2, this.height / 2)
    this.ctx.rotate(-this.roll)

    this.ctx.beginPath()

    for (let deg = -20; deg < 20; deg += 5) {
      const offset = 5000 * Math.sin(this.pitch + THREE.MathUtils.DEG2RAD * deg)

      // negate value and add extra space before minus sign
      const degString = deg > 0 ? `- ${deg}` : Math.abs(deg)

      if (deg === 0) {
        this.ctx.moveTo(-200, offset)
        this.ctx.lineTo(-50, offset)

        this.ctx.moveTo(50, offset)
        this.ctx.lineTo(200, offset)
      } else {
        this.ctx.moveTo(-100, offset)
        this.ctx.lineTo(100, offset)
        this.ctx.fillText(degString, -130, offset)
        this.ctx.fillText(degString, 120, offset)
      }
    }

    this.ctx.stroke()
    this.ctx.setTransform(1, 0, 0, 1, 0, 0)
  }

  drawFlightPathMarker() {
    this.ctx.translate(this.width / 2, this.height / 2)
    const offset = 5000 * Math.sin(this.pitch - this.aoa)

    this.ctx.beginPath()

    this.ctx.beginPath()
    this.ctx.arc(0, offset, 5, 0, 2 * Math.PI)
    this.ctx.stroke()

    this.ctx.setTransform(1, 0, 0, 1, 0, 0)
  }

  draw() {
    this.ctx.clearRect(0, 0, this.width, this.height)

    this.drawText(this.heading, "center", this.width / 2, (3 * this.height) / 5)
    this.drawText(this.speed, "right", (2 * this.width) / 5, this.height / 2)
    this.drawText(this.altitude, "left", (3 * this.width) / 5, this.height / 2)

    this.drawPitchLadder()
    this.drawFlightPathMarker()
  }
}
