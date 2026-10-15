/**
 * Surface wind that varies with position.
 *
 * One forecast for the place the flight starts says nothing about the place it
 * goes next, and over Norwegian terrain the two can be very different things:
 * on the same morning the wind can be a steady fifteen knots out at sea, a
 * couple of knots from a quite different direction in the shelter of a fjord,
 * and twenty-five on the ridges either side of it. The forecast knows this - it
 * is run on a grid fine enough to have the fjords in it - so the wind here is
 * read from it at more than one place.
 *
 * Not everywhere, though. The forecast is asked about one point at a time, so
 * it is sampled at the corners of the terrain tiles - about thirteen kilometres
 * apart - and the wind between them is interpolated. That loses the detail
 * finer than a tile, but it keeps the variation from one valley to the next,
 * and it keeps the number of questions asked of the forecast down to a handful
 * per tile flown over.
 *
 * The samples arrive one at a time, some while after they are first needed, and
 * some not at all. Until a corner has been heard from it stands in with the
 * regional wind: the average of the samples around the aircraft, eased towards
 * slowly so that it does not jump when one more of them comes in. A new sample
 * is then faded in over that, rather than dropped in, because a wind that
 * changes from one moment to the next is a gust - and a gust of a size set by
 * how late the network was is not one the aircraft should be made to feel.
 *
 * The regional wind is also what the wind model blends to higher up, where the
 * shelter of a valley no longer reaches and one sample from the bottom of it
 * would only mislead.
 *
 * All winds here are the wind 10 m above the ground at the sample, in ft/s, as
 * east and north components of the direction the air moves towards. The gust
 * is carried as its spread - how far the gust stands above the mean wind -
 * which is the part that says something about turbulence.
 */

/* How far around the aircraft samples count towards the regional wind, m.
   A little over a tile and a half, so it takes in the corners of the tile the
   aircraft is over and those of the tiles around it. */
const REGION_RADIUS = 20000

/* How long the regional wind takes to follow a change in the samples around
   it, and how long a new sample takes to fade in, s */
const REGION_LAG = 30
const FADE_IN = 20

export default class WindField {
  /**
   * @param tileExtents  distance between sample points, m
   * @param minx, miny   the corner of the tile grid, m - samples are at
   *                     minx + i * tileExtents, miny + j * tileExtents
   */
  constructor(tileExtents, minx, miny) {
    this.tileExtents = tileExtents
    this.minx = minx
    this.miny = miny

    /* corner samples by "x-y", each with how far it has faded in, 0 to 1 */
    this.corners = new Map()

    /* samples that are not at a corner - the one for the start point - which
       count towards the regional wind but are not interpolated between */
    this.points = []

    this.regional = null

    /* the result of the last lookup, so that one is not allocated per call */
    this.wind = { east: 0, north: 0, gustSpread: 0 }
  }

  /** Whether any wind at all has arrived yet. */
  get ready() {
    return this.regional !== null
  }

  /**
   * Adds a sample of the forecast.
   *
   * @param x, y    where it was taken, m
   * @param sample  the wind there: { east, north, gustSpread }, ft/s
   */
  addSample(x, y, sample) {
    const point = { x, y, east: sample.east, north: sample.north, gustSpread: sample.gustSpread, weight: 0 }

    if (this.isCorner(x, y)) {
      this.corners.set(`${x}-${y}`, point)
    } else {
      this.points.push(point)
    }

    /* the first sample is all there is to go on, so it is the regional wind
       straight away rather than something to ease towards from still air */
    if (this.regional === null) {
      this.regional = { east: sample.east, north: sample.north, gustSpread: sample.gustSpread }
      point.weight = 1
    }
  }

  /** Whether a sample for this corner has arrived. */
  hasCorner(x, y) {
    return this.corners.has(`${x}-${y}`)
  }

  isCorner(x, y) {
    return (x - this.minx) % this.tileExtents === 0 && (y - this.miny) % this.tileExtents === 0
  }

  /**
   * Moves the field on in time: fades in new samples, and eases the regional
   * wind towards the average of the samples around the aircraft.
   *
   * @param x, y  where the aircraft is, m
   * @param dt    time since the last call, s
   */
  update(x, y, dt) {
    if (this.regional === null) return

    let east = 0
    let north = 0
    let gustSpread = 0
    let count = 0

    const add = (point) => {
      point.weight = Math.min(point.weight + dt / FADE_IN, 1)

      if (Math.hypot(point.x - x, point.y - y) > REGION_RADIUS) return

      east += point.east
      north += point.north
      gustSpread += point.gustSpread
      count++
    }

    this.corners.forEach(add)
    this.points.forEach(add)

    /* nothing nearby - flown out of range of everything heard so far - and the
       regional wind stays what it was */
    if (count === 0) return

    const ease = 1 - Math.exp(-dt / REGION_LAG)

    this.regional.east += (east / count - this.regional.east) * ease
    this.regional.north += (north / count - this.regional.north) * ease
    this.regional.gustSpread += (gustSpread / count - this.regional.gustSpread) * ease
  }

  /**
   * The surface wind at a position, interpolated between the corners of the
   * tile it is in. Returns the same object every time.
   *
   * @param x, y  position, m
   */
  surfaceWind(x, y) {
    const wind = this.wind
    wind.east = wind.north = wind.gustSpread = 0

    if (this.regional === null) return wind

    const size = this.tileExtents

    const fx = (x - this.minx) / size
    const fy = (y - this.miny) / size
    const i = Math.floor(fx)
    const j = Math.floor(fy)
    const sx = fx - i
    const sy = fy - j

    const x0 = this.minx + i * size
    const y0 = this.miny + j * size

    this.addCorner(x0, y0, (1 - sx) * (1 - sy))
    this.addCorner(x0 + size, y0, sx * (1 - sy))
    this.addCorner(x0, y0 + size, (1 - sx) * sy)
    this.addCorner(x0 + size, y0 + size, sx * sy)

    return wind
  }

  /* adds one corner's share to the wind being interpolated, standing in with
     the regional wind for as much of it as has not arrived */
  addCorner(x, y, share) {
    const corner = this.corners.get(`${x}-${y}`)
    const known = corner ? corner.weight : 0
    const regional = this.regional
    const wind = this.wind

    wind.east += share * (regional.east + known * ((corner?.east ?? 0) - regional.east))
    wind.north += share * (regional.north + known * ((corner?.north ?? 0) - regional.north))
    wind.gustSpread += share * (regional.gustSpread + known * ((corner?.gustSpread ?? 0) - regional.gustSpread))
  }
}
