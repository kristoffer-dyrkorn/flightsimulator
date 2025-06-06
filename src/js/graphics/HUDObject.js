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
    this.ctx.fillStyle = "#20ff40"
    this.ctx.strokeStyle = "#20ff40"
  }

  update(airplaneState) {
    this.heading = Math.round(THREE.MathUtils.RAD2DEG * airplaneState.psi)

    // compensate for unknown offset in compass direction
    this.heading -= 8

    while (this.heading < 0) {
      this.heading += 360
    }

    if (this.heading > 359) {
      this.heading -= 360
    }

    this.speed = Math.round(0.592484 * airplaneState.vt)
    this.altitude = Math.round(airplaneState.alt)

    this.altitude = this.altitude.toLocaleString(undefined, {
      maximumFractionDigits: 0,
    })

    this.thrust = Math.round(airplaneState.pow)
    this.pitch = airplaneState.theta
    this.roll = airplaneState.phi
    this.aoa = airplaneState.alpha

    this.g = airplaneState.nz
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

    const pitch = this.pitch * THREE.MathUtils.RAD2DEG

    this.ctx.beginPath()

    // draw normal lines above horizon
    for (let deg = 0; deg <= 90; deg += 5) {
      const offset = -(-pitch + deg) * 28

      // only draw pitch lines if they are within +-8 deg of current pitch
      // ie within borders of the HUD
      if (Math.abs(pitch - deg) < 8) {
        if (deg === 0) {
          // horizon lines are extra wide
          this.ctx.moveTo(-250, offset)
          this.ctx.lineTo(-50, offset)

          this.ctx.moveTo(50, offset)
          this.ctx.lineTo(250, offset)
        } else {
          this.ctx.moveTo(-150, offset)
          this.ctx.lineTo(-50, offset)
          this.ctx.lineTo(-50, offset + 10)

          this.ctx.moveTo(50, offset + 10)
          this.ctx.lineTo(50, offset)
          this.ctx.lineTo(150, offset)

          this.ctx.fillText(deg, -165, offset + 20)
          this.ctx.fillText(deg, 145, offset + 20)
        }
      }
    }

    this.ctx.stroke()

    this.ctx.beginPath()

    // draw stippled lines below horizon
    this.ctx.setLineDash([17, 7])

    for (let deg = -90; deg < 0; deg += 5) {
      const offset = -(-pitch + deg) * 28

      // only draw pitch lines if they are within +-8 deg of current pitch
      // ie within borders of the HUD
      if (Math.abs(pitch - deg) < 8) {
        this.ctx.moveTo(-150, offset)
        this.ctx.lineTo(-50, offset)
        this.ctx.lineTo(-50, offset - 10)

        this.ctx.moveTo(50, offset - 10)
        this.ctx.lineTo(50, offset)
        this.ctx.lineTo(150, offset)

        this.ctx.fillText(-deg, -165, offset + 20)
        this.ctx.fillText(-deg, 145, offset + 20)
      }
    }
    this.ctx.stroke()

    // reset line style and transform
    this.ctx.setLineDash([])
    this.ctx.setTransform(1, 0, 0, 1, 0, 0)
  }

  drawFlightPathMarker() {
    const offset = THREE.MathUtils.RAD2DEG * (-this.pitch + this.aoa) * 14

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

    const hText = ("" + this.heading).padStart(3, "0")

    this.drawText(hText, "center", 0.5 * this.width, 0.9 * this.height)
    this.drawText(this.speed, "right", 0.1 * this.width, 0.5 * this.height)
    this.drawText(this.altitude, "left", 0.85 * this.width, 0.5 * this.height)

    const aoaText = Math.round(this.aoa * THREE.MathUtils.RAD2DEG)

    this.ctx.fillText(`AOA ${aoaText}`, 30, 0.86 * this.height)
    this.ctx.fillText(`POW ${this.thrust}`, 30, 0.9 * this.height)

    const gText = "" + this.g.toFixed(1)

    this.ctx.fillText(`${gText}G`, 30, 0.2 * this.height)

    this.drawPitchLadder()
    this.drawFlightPathMarker()
  }
}
