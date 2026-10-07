import { MathUtils } from "three"

// on the ground, knots - see update()
const GROUND_SPEED_BELOW_KT = 40
const AIRSPEED_ABOVE_KT = 80
const AOA_SHOWN_ABOVE_KT = 40
const FLIGHT_PATH_SHOWN_ABOVE_KT = 10

// how far from the canvas centre, in pixels, pitch ladder lines are still
// drawn - short of the canvas edge at 400, so the labels fit too
const LADDER_EXTENT = 370

export default class HUDObject {
  constructor(canvas) {
    this.canvas = canvas

    this.width = 800
    this.height = 800

    this.canvas.width = this.width
    this.canvas.height = this.height

    this.ctx = this.canvas.getContext("2d")
    this.ctx.lineWidth = 3
    this.ctx.font = "2.2em Tahoma"
    this.ctx.textBaseline = "middle"
    this.ctx.fillStyle = "#20ff40"
    this.ctx.strokeStyle = "#20ff40"

    // see setGeometry - until it is called, the angle the HUD has always
    // covered, centred on the line of sight
    this.setGeometry(2 * Math.atan(0.5 / 2.2), 0)

    // raw sink rate is a per-step derivative and jitters between frames -
    // smoothed for display by averaging over a trailing 1 second window,
    // { time, value } samples, oldest first
    this.sinkRateSamples = []
  }

  // trailing 1 second average of the raw sink rate, for a HUD readout that
  // does not jitter between frames the way the underlying derivative does
  smoothedSinkRate(sinkRate) {
    const now = performance.now()
    this.sinkRateSamples.push({ time: now, value: sinkRate })

    while (this.sinkRateSamples[0].time <= now - 1000) {
      this.sinkRateSamples.shift()
    }

    const total = this.sinkRateSamples.reduce((sum, sample) => sum + sample.value, 0)
    return total / this.sinkRateSamples.length
  }

  /**
   * @param airplaneState  current state of the aircraft
   * @param compassOffset  grid convergence at the aircraft's position, degrees.
   *                       psi is measured against grid north, so this converts
   *                       it to a true heading.
   */
  update(airplaneState, airplaneControlInput, atmosphericModel, compassOffset, weightOnWheels = false) {
    this.heading = Math.round(MathUtils.RAD2DEG * airplaneState.psi + compassOffset)

    // wrap into 0..359
    this.heading = ((this.heading % 360) + 360) % 360

    // airspeed, as an airspeed indicator reads: what the aircraft is doing
    // through the air, not over the ground. On the ground at taxi speeds
    // that is mostly the wind, so there it shows ground speed instead -
    // blended over to airspeed between GROUND_SPEED_BELOW_KT and
    // AIRSPEED_ABOVE_KT, so it never jumps by the wind speed on a take off
    // roll, and reads zero when the aircraft is standing still
    const airspeed = 0.592484 * airplaneState.airspeed
    const groundSpeed = 0.592484 * airplaneState.vt
    const blend = weightOnWheels
      ? MathUtils.clamp((groundSpeed - GROUND_SPEED_BELOW_KT) / (AIRSPEED_ABOVE_KT - GROUND_SPEED_BELOW_KT), 0, 1)
      : 1
    this.speed = Math.round(groundSpeed + blend * (airspeed - groundSpeed))

    // standing still or taxiing slowly, an angle of attack vane just swings
    // about in whatever wind there is, and the flight path is undefined
    this.showAoa = !weightOnWheels || airspeed >= AOA_SHOWN_ABOVE_KT
    this.showFlightPath = groundSpeed >= FLIGHT_PATH_SHOWN_ABOVE_KT
    this.mach = atmosphericModel.rmach.toFixed(2)
    this.altitude = Math.round(airplaneState.alt)

    this.altitude = this.altitude.toLocaleString(undefined, {
      maximumFractionDigits: 0,
    })

    this.throttle = Math.round(100 * airplaneControlInput.throttle)
    this.pitch = airplaneState.theta
    this.roll = airplaneState.phi
    // angle of attack against the air, as the aircraft's vane reads it
    this.aoa = airplaneState.airAlpha

    // the flight path marker shows where the aircraft is actually going, so
    // it sits at the angle between the nose and the velocity over the
    // ground - not the angle of attack, which in gusty air jumps around
    // with every gust while the flight path itself hardly changes
    this.flightPathAngle = airplaneState.alpha
    this.flightPathSideslip = airplaneState.beta

    this.g = airplaneState.nz

    this.sinkRateText = (100 * Math.round(this.smoothedSinkRate(airplaneState.sinkRate) / 100)).toLocaleString(
      undefined,
      { maximumFractionDigits: 0 },
    )
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

    switch (align) {
      case "right":
        this.ctx.moveTo(x - box[0], y - box[1] / 2 - 2)
        this.ctx.lineTo(x, y - box[1] / 2 - 2)
        this.ctx.lineTo(x + 12, y - box[1] / 2 - 1.5 + box[1] / 2)
        this.ctx.lineTo(x, y - box[1] / 2 - 1.5 + box[1])
        this.ctx.lineTo(x - box[0], y - box[1] / 2 - 1.5 + box[1])
        this.ctx.lineTo(x - box[0], y - box[1] / 2 - 1.5)
        break
      case "center":
        this.ctx.rect(x - box[0] / 2 - 5, y - box[1] / 2 - 2, box[0] + 10, box[1])
        break
      case "left":
        this.ctx.moveTo(x, y - box[1] / 2 - 2)
        this.ctx.lineTo(x + box[0], y - box[1] / 2 - 2)
        this.ctx.lineTo(x + box[0], y - box[1] / 2 - 1.5 + box[1])
        this.ctx.lineTo(x, y - box[1] / 2 - 1.5 + box[1])
        this.ctx.lineTo(x - 12, y - box[1] / 2 - 1.5 + box[1] / 2)
        this.ctx.lineTo(x, y - box[1] / 2 - 1.5)
        break
    }

    this.ctx.stroke()
  }

  /**
   * Where the canvas sits, seen from the pilot's eyes, once it is drawn on
   * the HUD panel: the angle it covers across its width (and height - it is
   * square), and how far the panel's centre is above the line of sight
   * straight ahead. The pitch ladder and the flight path marker are placed
   * from these, relative to where the line of sight crosses the canvas
   * (boresightY), so they line up with the world outside.
   *
   * @param fieldOfView     radians
   * @param centreTangent   height of the panel's centre above the line of
   *                        sight, divided by its distance from the eyes
   */
  setGeometry(fieldOfView, centreTangent) {
    this.pixelsPerTangent = this.height / 2 / Math.tan(fieldOfView / 2)
    this.boresightY = this.height / 2 + this.pixelsPerTangent * centreTangent
  }

  // How far from the centre of the HUD, in pixels, something an angle away
  // from straight ahead is drawn. The HUD is a flat panel, so that goes with
  // the tangent of the angle, not with the angle itself.
  angleToPixels(degrees) {
    return this.pixelsPerTangent * Math.tan(degrees * MathUtils.DEG2RAD)
  }

  drawPitchLadder() {
    this.ctx.translate(this.width / 2, this.boresightY)
    this.ctx.rotate(-this.roll)

    const pitch = this.pitch * MathUtils.RAD2DEG

    this.ctx.beginPath()

    // draw normal lines above horizon
    for (let deg = 0; deg <= 90; deg += 5) {
      const offset = -this.angleToPixels(deg - pitch)

      // only draw pitch lines that fit on the HUD
      if (Math.abs(offset + this.boresightY - this.height / 2) < LADDER_EXTENT) {
        if (deg === 0) {
          // horizon lines are extra wide
          this.ctx.moveTo(-350, offset)
          this.ctx.lineTo(-50, offset)

          this.ctx.moveTo(50, offset)
          this.ctx.lineTo(350, offset)
        } else {
          this.ctx.moveTo(-150, offset)
          this.ctx.lineTo(-50, offset)
          this.ctx.lineTo(-50, offset + 15)

          this.ctx.moveTo(50, offset + 15)
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
      const offset = -this.angleToPixels(deg - pitch)

      // only draw pitch lines that fit on the HUD
      if (Math.abs(offset + this.boresightY - this.height / 2) < LADDER_EXTENT) {
        this.ctx.moveTo(-150, offset)
        this.ctx.lineTo(-50, offset)
        this.ctx.lineTo(-50, offset - 15)

        this.ctx.moveTo(50, offset - 15)
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

  // The flight path marker is where the velocity over the ground points, as
  // seen through the HUD: below the nose by the angle of attack, and to the
  // side by the sideslip - which in a crosswind is the drift, so the marker
  // shows where the aircraft is actually tracking. On the HUD panel a
  // velocity (u, v, w) in body axes lands at (v / u, w / u) in tangent
  // units, which in angles is tan(sideslip) / cos(angle of attack) across,
  // and tan(angle of attack) down.
  drawFlightPathMarker() {
    const across = (this.pixelsPerTangent * Math.tan(this.flightPathSideslip)) / Math.cos(this.flightPathAngle)
    const offset = this.angleToPixels(MathUtils.RAD2DEG * this.flightPathAngle)
    const x = this.width / 2 + across

    this.ctx.beginPath()
    this.ctx.arc(x, offset + this.boresightY, 10, 0, 2 * Math.PI)
    this.ctx.stroke()

    this.ctx.beginPath()
    this.ctx.moveTo(x, offset + this.boresightY - 10)
    this.ctx.lineTo(x, offset + this.boresightY - 22)

    this.ctx.moveTo(x - 35, offset + this.boresightY)
    this.ctx.lineTo(x - 10, offset + this.boresightY)

    this.ctx.moveTo(x + 10, offset + this.boresightY)
    this.ctx.lineTo(x + 35, offset + this.boresightY)

    this.ctx.stroke()
  }

  draw() {
    this.ctx.clearRect(0, 0, this.width, this.height)

    const hText = ("" + this.heading).padStart(3, "0")

    this.drawText(hText, "center", 0.5 * this.width, 0.89 * this.height)
    this.drawText(this.speed, "right", 0.1 * this.width, 0.5 * this.height)
    this.drawText(this.altitude, "left", 0.85 * this.width, 0.5 * this.height)

    const aoaText = this.showAoa ? Math.round(this.aoa * MathUtils.RAD2DEG) : "--"

    this.ctx.fillText(`AOA ${aoaText}`, 15, 0.8 * this.height)
    this.ctx.fillText(`M ${this.mach}`, 15, 0.85 * this.height)
    this.ctx.fillText(`THR ${this.throttle}`, 15, 0.9 * this.height)

    if (this.throttle > 77) {
      this.ctx.fillText(`AB`, 155, 0.9 * this.height)
    }

    const gText = "" + this.g.toFixed(1)

    this.ctx.fillText(`${gText} G`, 15, 0.2 * this.height)

    this.drawPitchLadder()
    if (this.showFlightPath) this.drawFlightPathMarker()
  }
}
