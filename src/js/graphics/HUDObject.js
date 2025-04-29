import * as THREE from "./three.module.js"

export default class HUDObject {
  constructor(canvas) {
    this.canvas = canvas

    this.width = 800
    this.height = 800

    this.canvas.width = this.width
    this.canvas.height = this.height

    this.ctx = this.canvas.getContext("2d")
    this.ctx.lineWidth = 1.7
    this.ctx.font = "1.5em Monaco"
    this.ctx.textBaseline = "middle"
    this.ctx.fillStyle = "green"
    this.ctx.strokeStyle = "green"
  }

  update(airplaneState) {
    this.heading = Math.round(THREE.MathUtils.RAD2DEG * airplaneState.psi)
    while (this.heading < 0) {
      this.heading += 360
    }

    if (this.heading > 359) {
      this.heading -= 360
    }

    this.heading = ("" + this.heading).padStart(3, "0")

    this.speed = Math.round(0.592484 * airplaneState.vt)
    this.altitude = Math.round(airplaneState.h)

    this.altitude = this.altitude.toLocaleString(undefined, {
      maximumFractionDigits: 0,
    })

    this.thrust = Math.round(airplaneState.pow)
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
        this.ctx.lineTo(x - adjust + box[0] + 12, y - box[1] / 2 - 1.5 + box[1] / 2)
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
        this.ctx.lineTo(x - adjust - 12, y - box[1] / 2 - 1.5 + box[1] / 2)
        this.ctx.lineTo(x - adjust, y - box[1] / 2 - 1.5)
        break
    }

    this.ctx.stroke()
  }

  drawPitchLadder() {
    this.ctx.translate(this.width / 2, this.height / 2)
    this.ctx.rotate(-this.roll)

    this.ctx.beginPath()

    for (let deg = -90; deg <= 90; deg += 5) {
      const offset = (this.height / 2) * (this.pitch * THREE.MathUtils.RAD2DEG + deg) * 0.15

      if (deg > 0) {
        this.ctx.moveTo(-150, offset)
        this.ctx.lineTo(150, offset)
        this.ctx.fillText(-deg, -180, offset + 20)
        this.ctx.fillText(-deg, 135, offset + 20)
      } else if (deg === 0) {
        this.ctx.moveTo(-300, offset)
        this.ctx.lineTo(-50, offset)

        this.ctx.moveTo(50, offset)
        this.ctx.lineTo(300, offset)
      } else {
        this.ctx.moveTo(-150, offset)
        this.ctx.lineTo(150, offset)
        this.ctx.fillText(-deg, -165, offset + 20)
        this.ctx.fillText(-deg, 145, offset + 20)
      }
    }

    this.ctx.stroke()
    this.ctx.setTransform(1, 0, 0, 1, 0, 0)
  }

  drawFlightPathMarker() {
    const offset = (this.height / 2) * (THREE.MathUtils.RAD2DEG * (-this.pitch + this.aoa)) * 0.07

    this.ctx.beginPath()
    this.ctx.arc(this.width / 2, offset + this.height / 2, 10, 0, 2 * Math.PI)
    this.ctx.stroke()

    this.ctx.beginPath()
    this.ctx.moveTo(this.width / 2, offset + this.height / 2 - 10)
    this.ctx.lineTo(this.width / 2, offset + this.height / 2 - 22)

    this.ctx.moveTo(this.width / 2 - 35, offset + this.height / 2)
    this.ctx.lineTo(this.width / 2 - 10, offset + this.height / 2)

    this.ctx.moveTo(this.width / 2 + 10, offset + this.height / 2)
    this.ctx.lineTo(this.width / 2 + 35, offset + this.height / 2)

    this.ctx.stroke()
  }

  draw() {
    this.ctx.clearRect(0, 0, this.width, this.height)

    this.drawText(this.heading, "center", 0.5 * this.width, 0.9 * this.height)
    this.drawText(this.speed, "right", 0.1 * this.width, 0.5 * this.height)
    this.drawText(this.altitude, "left", 0.85 * this.width, 0.5 * this.height)

    const aoaText = Math.round(this.aoa * THREE.MathUtils.RAD2DEG)

    this.ctx.fillText(`AOA ${aoaText}`, 30, 0.86 * this.height)
    this.ctx.fillText(`POW ${this.thrust}`, 30, 0.9 * this.height)

    this.drawPitchLadder()
    this.drawFlightPathMarker()
  }
}
