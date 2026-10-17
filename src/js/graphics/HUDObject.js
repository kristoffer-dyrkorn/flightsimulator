import { MathUtils } from "three"

// on the ground, knots - see update()
const GROUND_SPEED_BELOW_KT = 40
const AIRSPEED_ABOVE_KT = 80
const AOA_SHOWN_ABOVE_KT = 40
const FLIGHT_PATH_SHOWN_ABOVE_KT = 10

// landing approach angle of attack bracket, degrees - see drawAoaBracket()
const APPROACH_AOA_MIN = 11
const APPROACH_AOA_MAX = 15
// time constant, seconds, of the low pass filter on the angle of attack
// that places the bracket - see update()
const BRACKET_AOA_TAU = 0.5

// the speed shown jitters with every bit of turbulence, and its number with
// it - see update. Time constant of its low pass filter, seconds, and how
// far, knots, it has to move from the number shown before that changes.
const SPEED_TAU = 0.5
const SPEED_HYSTERESIS = 0.75

// how far from the canvas centre, in pixels, pitch ladder lines are still
// drawn - short of the canvas edge at 400, so the labels fit too
const LADDER_EXTENT = 370

// how far out from the centre the speed and altitude boxes point, pixels -
// beyond the horizon line's ends, at 350
const SIDE_LABEL_OFFSET = 380

// how far the readouts down the left side start from the centre, pixels
const LEFT_COLUMN = 385

// The moving scales (VAH, in the real aircraft's terms) behind the speed,
// altitude and heading boxes: pixels per knot, foot and degree, how far
// each reaches either side of its box, pixels, and their labels' font
const SPEED_SCALE = 2
const ALTITUDE_SCALE = 0.2
const HEADING_SCALE = 10
const SCALE_REACH = 150
const SCALE_FONT = "1.5em Verdana"

// calibrated airspeed, from the static pressure and Mach number - see
// calibratedAirspeed
const SEA_LEVEL_PRESSURE = 2116.22 // lb/ft^2
const SEA_LEVEL_SOUND_SPEED = 661.47 // knots

// The airspeed an airspeed indicator shows - calibrated airspeed, knots -
// from the static pressure, lb/ft^2, and the Mach number. The indicator
// measures the impact pressure (the pitot's pressure less the static) and
// reads it as the speed that would give that pressure at sea level, so it
// reads less than the true speed through the air the higher the aircraft
// flies - some 7% less at 5000 ft. Above Mach 1 the pitot sits behind a
// shock wave, which the impact pressure is worked out through.
function calibratedAirspeed(staticPressure, mach) {
  const impactRatio =
    mach < 1
      ? (1 + 0.2 * mach * mach) ** 3.5 - 1
      : (166.92158 * mach ** 7) / (7 * mach * mach - 1) ** 2.5 - 1
  const impactPressure = staticPressure * impactRatio
  return SEA_LEVEL_SOUND_SPEED * Math.sqrt(5 * ((impactPressure / SEA_LEVEL_PRESSURE + 1) ** (2 / 7) - 1))
}

export default class HUDObject {
  constructor(canvas) {
    this.canvas = canvas

    // wider than it is tall, for the speed and altitude boxes either side,
    // well out from the centre - see SIDE_LABEL_OFFSET. The panel it is drawn
    // on has the same shape (see index.js).
    this.width = 1080
    this.height = 800

    this.canvas.width = this.width
    this.canvas.height = this.height

    this.ctx = this.canvas.getContext("2d")
    this.ctx.lineWidth = 3
    this.ctx.shadowBlur = 2
    this.ctx.shadowColor = "#10ee30c0"
    this.ctx.font = "2.2em Verdana"
    this.ctx.textBaseline = "middle"
    this.ctx.fillStyle = "#10ee30"
    this.ctx.strokeStyle = "#10ee30"

    // see setGeometry - until it is called, the angle the HUD has always
    // covered, centred on the line of sight
    this.setGeometry(2 * Math.atan(0.5 / 2.2), 0)

    // raw sink rate is a per-step derivative and jitters between frames -
    // smoothed for display by averaging over a trailing 1 second window,
    // { time, value } samples, oldest first
    this.sinkRateSamples = []

    // filtered angle of attack for the approach bracket, and when it was
    // last updated - see update()
    this.bracketAoa = null
    this.bracketAoaTime = 0

    // the filtered speed, and when it was last updated - see update
    this.speedExact = null
    this.speedTime = 0
    this.speed = 0
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
  update(
    airplaneState,
    airplaneControlInput,
    atmosphericModel,
    compassOffset,
    weightOnWheels = false,
    gearDown = false,
  ) {
    // the heading as it is, for the heading scale to move smoothly with, and
    // to the whole degree, for the number in its box
    this.headingExact = MathUtils.RAD2DEG * airplaneState.psi + compassOffset
    this.headingExact = ((this.headingExact % 360) + 360) % 360
    this.heading = Math.round(this.headingExact)

    // wrap into 0..359
    this.heading = ((this.heading % 360) + 360) % 360

    // airspeed, as an airspeed indicator reads: what the aircraft is doing
    // through the air, not over the ground - calibrated airspeed, see
    // calibratedAirspeed. On the ground at taxi speeds that is mostly the
    // wind, so there it shows ground speed instead - blended over to
    // airspeed between GROUND_SPEED_BELOW_KT and AIRSPEED_ABOVE_KT, so it
    // never jumps by the wind speed on a take off roll, and reads zero when
    // the aircraft is standing still. The letter by it says which it is, as
    // in the real aircraft: C for calibrated, G for ground speed.
    const airspeed = 0.592484 * airplaneState.airspeed
    const calibrated = calibratedAirspeed(atmosphericModel.ps, atmosphericModel.rmach)
    const groundSpeed = 0.592484 * airplaneState.vt
    const blend = weightOnWheels
      ? MathUtils.clamp((groundSpeed - GROUND_SPEED_BELOW_KT) / (AIRSPEED_ABOVE_KT - GROUND_SPEED_BELOW_KT), 0, 1)
      : 1
    // Smoothed, for the speed scale to move with: turbulence jiggles the
    // airspeed by fractions of a knot all the time. The number in the speed
    // box is that to the whole knot - changed only once the speed has
    // moved SPEED_HYSTERESIS from it, so that a speed sitting near a half
    // knot doesn't make it flicker between two values.
    const speed = groundSpeed + blend * (calibrated - groundSpeed)
    const now = performance.now()
    if (this.speedExact === null) {
      this.speedExact = speed
    } else {
      const dt = (now - this.speedTime) / 1000
      this.speedExact += (speed - this.speedExact) * (1 - Math.exp(-dt / SPEED_TAU))
    }
    this.speedTime = now
    if (Math.abs(this.speedExact - this.speed) >= SPEED_HYSTERESIS) this.speed = Math.round(this.speedExact)
    this.speedKind = blend < 0.5 ? "G" : "C"

    // on approach the flight path marker sits low in the HUD, where the
    // heading normally is - with the gear down the heading moves to the
    // top instead, as in the real aircraft's landing mode
    this.headingAtTop = gearDown

    // standing still or taxiing slowly, an angle of attack vane just swings
    // about in whatever wind there is, and the flight path is undefined
    this.showAoa = !weightOnWheels || airspeed >= AOA_SHOWN_ABOVE_KT
    this.showFlightPath = groundSpeed >= FLIGHT_PATH_SHOWN_ABOVE_KT
    this.showAoaBracket = gearDown && this.showAoa
    this.mach = atmosphericModel.rmach.toFixed(2)
    this.altitudeFeet = Math.round(airplaneState.alt)

    this.altitude = this.altitudeFeet.toLocaleString(undefined, {
      maximumFractionDigits: 0,
    })

    this.throttle = Math.round(100 * airplaneControlInput.throttle)
    this.pitch = airplaneState.theta
    this.roll = airplaneState.phi
    // angle of attack against the air, as the aircraft's vane reads it
    this.aoa = airplaneState.airAlpha

    // the approach bracket is placed by the difference between the angle of
    // attack and the flight path marker's angle. In gusty air the first
    // jumps with every gust while the second hardly moves, so unfiltered
    // the bracket would jump with every gust too - it gets a first order
    // low pass filtered angle of attack instead, the same smoothing the
    // real aircraft's air data gives its displays
    if (this.bracketAoa === null) {
      this.bracketAoa = this.aoa
    } else {
      const dt = (now - this.bracketAoaTime) / 1000
      this.bracketAoa += (this.aoa - this.bracketAoa) * (1 - Math.exp(-dt / BRACKET_AOA_TAU))
    }
    this.bracketAoaTime = now

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

  // a boxed label: the text, aligned at x, and a box round it - big enough
  // for boxText, which defaults to the text itself
  drawText(text, align, x, y, boxText = text) {
    this.ctx.textAlign = align

    // centred on the glyphs' own measured extent rather than the "middle"
    // baseline, which browsers place differently - Safari draws it a few
    // pixels lower than Chrome and Firefox do, so the text sat low in its
    // box there. The box below is centred 2 pixels above y. Measured on a
    // digit, not the text itself: the altitude's thousands separator
    // reaches below the digits, and would lift them higher in their box
    // than the speed's digits sit in theirs.
    this.ctx.textBaseline = "alphabetic"
    const glyphs = this.ctx.measureText("0")
    const baseline = y - 2 + (glyphs.actualBoundingBoxAscent - glyphs.actualBoundingBoxDescent) / 2
    this.ctx.fillText(text, x, baseline)
    this.ctx.textBaseline = "middle"

    const box = this.getTextBoundingBox(boxText)

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

          if (deg >= 10) {
            this.ctx.fillText(deg, -180, offset + 25)
            this.ctx.fillText(deg, 135, offset + 25)
          } else {
            this.ctx.fillText(deg, -165, offset + 25)
            this.ctx.fillText(deg, 140, offset + 25)
          }
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

        if (deg <= -10) {
          this.ctx.fillText(-deg, -180, offset + 25)
          this.ctx.fillText(-deg, 135, offset + 25)
        } else {
          this.ctx.fillText(-deg, -165, offset + 25)
          this.ctx.fillText(-deg, 140, offset + 25)
        }
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
  flightPathMarkerX() {
    const across = (this.pixelsPerTangent * Math.tan(this.flightPathSideslip)) / Math.cos(this.flightPathAngle)
    return this.width / 2 + across
  }

  drawFlightPathMarker() {
    const offset = this.angleToPixels(MathUtils.RAD2DEG * this.flightPathAngle)
    const x = this.flightPathMarkerX()

    this.ctx.beginPath()
    this.ctx.arc(x, offset + this.boresightY, 15, 0, 2 * Math.PI)
    this.ctx.stroke()

    this.ctx.beginPath()
    this.ctx.moveTo(x, offset + this.boresightY - 15)
    this.ctx.lineTo(x, offset + this.boresightY - 30)

    this.ctx.moveTo(x - 40, offset + this.boresightY)
    this.ctx.lineTo(x - 15, offset + this.boresightY)

    this.ctx.moveTo(x + 15, offset + this.boresightY)
    this.ctx.lineTo(x + 40, offset + this.boresightY)

    this.ctx.stroke()
  }

  // With the gear down, a bracket left of the flight path marker shows the
  // angle of attack to fly on a landing approach. As in the real aircraft
  // it is placed relative to the marker, not the boresight: the marker
  // lines up with the top of the bracket at APPROACH_AOA_MIN, with the
  // bottom at APPROACH_AOA_MAX, and is centred in it halfway between. So
  // the bracket stays next to the marker wherever that is on the HUD, and
  // since it is driven by the vane's angle of attack against the air
  // rather than the marker's angle against the velocity over the ground,
  // it still reads true in wind. It follows the marker sideways too.
  drawAoaBracket() {
    const x = this.flightPathMarkerX() - 50
    const marker = MathUtils.RAD2DEG * this.flightPathAngle
    const aoa = MathUtils.RAD2DEG * this.bracketAoa
    const top = this.boresightY + this.angleToPixels(marker + APPROACH_AOA_MIN - aoa)
    const bottom = this.boresightY + this.angleToPixels(marker + APPROACH_AOA_MAX - aoa)

    this.ctx.beginPath()
    this.ctx.moveTo(x + 18, top)
    this.ctx.lineTo(x, top)
    this.ctx.lineTo(x, bottom)
    this.ctx.lineTo(x + 18, bottom)
    this.ctx.stroke()
  }

  // A moving scale, up the HUD's side: ticks every step, longer and labelled
  // every major step, moving past the box's pointer at x, y as the value
  // changes. side is -1 with the ticks to the left of x and the labels to
  // its right, 1 the other way round. Labels next to the box are left out,
  // as it covers the value there.
  drawVerticalScale(x, y, value, pixelsPer, step, major, side, label) {
    const ctx = this.ctx
    const boxHalfHeight = this.getTextBoundingBox("0")[1] / 2
    const reach = SCALE_REACH / pixelsPer

    ctx.save()
    ctx.font = SCALE_FONT
    ctx.textAlign = side < 0 ? "left" : "right"
    ctx.beginPath()

    for (let v = Math.ceil((value - reach) / step) * step; v <= value + reach; v += step) {
      if (v < 0) continue
      const tickY = y - (v - value) * pixelsPer
      const isMajor = v % major === 0
      ctx.moveTo(x + side * 2, tickY)
      ctx.lineTo(x + side * (isMajor ? 20 : 12), tickY)
      if (isMajor && Math.abs(tickY - y) > boxHalfHeight + 14) ctx.fillText(label(v), x - side * 8, tickY)
    }

    ctx.stroke()
    ctx.restore()
  }

  // speed, every 10 knots, labelled every 50 in tens of knots, as in the
  // real aircraft ("45" for 450) - its ticks on the inside of the speed
  // box's pointer, the labels above and below the box
  drawSpeedScale() {
    const x = this.width / 2 - SIDE_LABEL_OFFSET
    this.drawVerticalScale(x, 0.5 * this.height, this.speedExact, SPEED_SCALE, 10, 50, 1, (knots) => String(knots / 10))
  }

  // altitude, every 100 ft, labelled every 500 in thousands of feet to one
  // decimal, as in the real aircraft ("16,5" for 16,500) - mirroring the
  // speed's, with an index line reaching in from it at the box, as the
  // speed's notch under the C does
  drawAltitudeScale() {
    const x = this.width / 2 + SIDE_LABEL_OFFSET
    const y = 0.5 * this.height
    const label = (feet) => `${Math.floor(feet / 1000)},${(feet % 1000) / 100}`
    this.drawVerticalScale(x, y, this.altitudeFeet, ALTITUDE_SCALE, 100, 500, -1, label)

    this.ctx.beginPath()
    this.ctx.moveTo(x - 2, y)
    this.ctx.lineTo(x - 34, y)
    this.ctx.stroke()
  }

  // heading, every 5 degrees, labelled every 10 in tens of degrees, as a
  // compass card is - on the side of the heading box towards the HUD's
  // centre, wherever the box is (see headingAtTop)
  drawHeadingScale(boxY) {
    const ctx = this.ctx
    const centre = this.width / 2
    const inwards = this.headingAtTop ? 1 : -1
    const edge = boxY + inwards * (this.getTextBoundingBox("0")[1] / 2 + 4)
    const reach = SCALE_REACH / HEADING_SCALE

    ctx.save()
    ctx.font = SCALE_FONT
    ctx.textAlign = "center"
    ctx.beginPath()

    for (let d = Math.ceil((this.headingExact - reach) / 5) * 5; d <= this.headingExact + reach; d += 5) {
      const x = centre + (d - this.headingExact) * HEADING_SCALE
      const isMajor = d % 10 === 0
      ctx.moveTo(x, edge)
      ctx.lineTo(x, edge + inwards * (isMajor ? 18 : 10))
      if (isMajor) {
        const heading = (((d % 360) + 360) % 360) / 10
        ctx.fillText(String(heading).padStart(2, "0"), x, edge + inwards * 34)
      }
    }

    ctx.stroke()
    ctx.restore()
  }

  draw() {
    this.ctx.clearRect(0, 0, this.width, this.height)

    const hText = ("" + this.heading).padStart(3, "0")

    const headingY = (this.headingAtTop ? 0.03 : 0.97) * this.height
    this.drawText(hText, "center", 0.5 * this.width, headingY)
    this.drawHeadingScale(headingY)
    // the speed's box with room for one more character left of its first
    // digit, and the altitude's for five digits, whatever the altitude -
    // with the thousands separator the browser's own number format uses
    const centre = this.width / 2
    const speed = String(this.speed)
    this.drawText(speed, "right", centre - SIDE_LABEL_OFFSET - 12, 0.5 * this.height, "0" + speed)
    const longest = (88888).toLocaleString(undefined, { maximumFractionDigits: 0 })
    const altitudeBox = this.altitude.length > longest.length ? this.altitude : longest
    this.drawText(this.altitude, "left", centre + SIDE_LABEL_OFFSET + 12, 0.5 * this.height, altitudeBox)

    // C or G (see update), as in the real aircraft: on the inside of the
    // speed scale, level with the box, standing on a short notch line that
    // reaches in from the scale and points out the speed on it. Placed by
    // its own measured height, not the "middle" baseline, which Safari
    // places lower than other browsers do - see drawText.
    const pointer = centre - SIDE_LABEL_OFFSET
    const speedY = 0.5 * this.height
    this.ctx.beginPath()
    this.ctx.moveTo(pointer + 2, speedY)
    this.ctx.lineTo(pointer + 46, speedY)
    this.ctx.stroke()
    this.ctx.save()
    this.ctx.font = "2em Verdana"
    this.ctx.textAlign = "center"
    this.ctx.textBaseline = "alphabetic"
    const letter = this.ctx.measureText(this.speedKind)
    this.ctx.fillText(this.speedKind, pointer + 32, speedY - 5 - letter.actualBoundingBoxDescent)
    this.ctx.restore()

    this.drawSpeedScale()
    this.drawAltitudeScale()

    const aoaText = this.showAoa ? Math.round(this.aoa * MathUtils.RAD2DEG) : "--"

    const left = centre - LEFT_COLUMN
    this.ctx.textAlign = "left"
    this.ctx.fillText(`AOA ${aoaText}`, left, 0.8 * this.height)
    this.ctx.fillText(`M ${this.mach}`, left, 0.85 * this.height)
    this.ctx.fillText(`THR ${this.throttle}`, left, 0.9 * this.height)

    if (this.throttle > 77) {
      this.ctx.fillText(`AB`, left + 160, 0.9 * this.height)
    }

    const gText = "" + this.g.toFixed(1)

    this.ctx.fillText(`${gText} G`, left, 0.2 * this.height)

    this.drawPitchLadder()
    if (this.showFlightPath) this.drawFlightPathMarker()
    if (this.showAoaBracket) this.drawAoaBracket()
  }
}
