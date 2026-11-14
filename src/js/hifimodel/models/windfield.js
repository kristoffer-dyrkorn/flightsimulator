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
 * It is sampled on a regular grid, WIND_GRID apart - near the forecast's own
 * resolution of a kilometre, and a whole number of times into a terrain tile,
 * so that the grid points also fall on the tiles' corners - and the wind
 * between the four grid points round a position is interpolated. Every sample
 * read is kept, so flying back over a place asks the forecast nothing again.
 *
 * The samples arrive some while after they are first needed, and some not at
 * all. Until a grid point has been heard from it stands in with the regional
 * wind: the average of the samples around the aircraft, eased towards slowly
 * so that it does not jump when one more of them comes in. A new sample is
 * then faded in over that, rather than dropped in, because a wind that
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

/* How far around the aircraft samples count towards the regional wind, m */
const REGION_RADIUS = 20000

/* How long the regional wind takes to follow a change in the samples around
   it, and how long a new sample takes to fade in, s - a few seconds, as fast
   flight crosses a cell of the grid in as many */
const REGION_LAG = 30
const FADE_IN = 5

/* the distance between the grid points, m - 10 to a terrain tile */
export const WIND_GRID = 1275

export default class WindField {
  /**
   * @param originX, originY  a grid point, UTM 33, m - the corner of the tile
   *                          grid, so that the wind grid shares its corners
   */
  constructor(originX, originY) {
    this.originX = originX
    this.originY = originY

    /* every grid sample read, by "x-y" in m, each with how far it has faded
       in, 0 to 1 - kept for good */
    this.corners = new Map()

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
   * @param x, y    the grid point it was taken at, UTM 33, m
   * @param sample  the wind there: { east, north, gustSpread }, ft/s
   */
  addSample(x, y, sample) {
    const point = { x, y, east: sample.east, north: sample.north, gustSpread: sample.gustSpread, weight: 0 }
    this.corners.set(`${x}-${y}`, point)

    /* the first sample is all there is to go on, so it is the regional wind
       straight away rather than something to ease towards from still air */
    if (this.regional === null) {
      this.regional = { east: sample.east, north: sample.north, gustSpread: sample.gustSpread }
      point.weight = 1
    }
  }

  /** Whether a sample for this grid point has arrived. */
  hasCorner(x, y) {
    return this.corners.has(`${x}-${y}`)
  }

  /**
   * The four grid points round a position, nearest first - those its wind is
   * interpolated between.
   *
   * @param x, y  position, UTM 33, m
   */
  gridPointsAround(x, y) {
    const x0 = this.originX + Math.floor((x - this.originX) / WIND_GRID) * WIND_GRID
    const y0 = this.originY + Math.floor((y - this.originY) / WIND_GRID) * WIND_GRID
    return [
      [x0, y0],
      [x0 + WIND_GRID, y0],
      [x0, y0 + WIND_GRID],
      [x0 + WIND_GRID, y0 + WIND_GRID],
    ].sort((a, b) => Math.hypot(a[0] - x, a[1] - y) - Math.hypot(b[0] - x, b[1] - y))
  }

  /**
   * The grid points the wind at a position needs now and next: those of the
   * cell it is in, and of the cell across an edge of it once it is past the
   * cell's mid axis on that side and heading for that edge, due there within
   * lead seconds - the cell it is flying into next. Across both, as it heads
   * for a corner, the cell beyond the corner too.
   *
   * @param x, y      position, UTM 33, m
   * @param vx, vy    velocity over the ground, m/s
   * @param lead      how long ahead to look, s
   */
  gridPointsNeeded(x, y, vx, vy, lead) {
    const x0 = this.originX + Math.floor((x - this.originX) / WIND_GRID) * WIND_GRID
    const y0 = this.originY + Math.floor((y - this.originY) / WIND_GRID) * WIND_GRID
    // which way to the edge it is heading for, on each axis - or 0
    const ahead = (p, p0, v) => {
      const toward = p - p0 >= WIND_GRID / 2 ? 1 : -1
      const distance = toward > 0 ? p0 + WIND_GRID - p : p - p0
      return v * toward > 0 && distance < Math.abs(v) * lead ? toward : 0
    }
    const ax = ahead(x, x0, vx)
    const ay = ahead(y, y0, vy)
    // the cells needed, by their lower left corners
    const cells = [[x0, y0]]
    if (ax) cells.push([x0 + ax * WIND_GRID, y0])
    if (ay) cells.push([x0, y0 + ay * WIND_GRID])
    if (ax && ay) cells.push([x0 + ax * WIND_GRID, y0 + ay * WIND_GRID])
    const points = new Map()
    for (const [cx, cy] of cells) {
      for (const [px, py] of [[cx, cy], [cx + WIND_GRID, cy], [cx, cy + WIND_GRID], [cx + WIND_GRID, cy + WIND_GRID]]) points.set(`${px}-${py}`, [px, py])
    }
    return [...points.values()]
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

    /* nothing nearby - flown out of range of everything heard so far - and the
       regional wind stays what it was */
    if (count === 0) return

    const ease = 1 - Math.exp(-dt / REGION_LAG)

    this.regional.east += (east / count - this.regional.east) * ease
    this.regional.north += (north / count - this.regional.north) * ease
    this.regional.gustSpread += (gustSpread / count - this.regional.gustSpread) * ease
  }

  /**
   * The surface wind at a position, interpolated between the four grid points
   * round it. Returns the same object every time.
   *
   * @param x, y  position, UTM 33, m
   */
  surfaceWind(x, y) {
    const wind = this.wind
    wind.east = wind.north = wind.gustSpread = 0

    if (this.regional === null) return wind

    const size = WIND_GRID

    const fx = (x - this.originX) / size
    const fy = (y - this.originY) / size
    const i = Math.floor(fx)
    const j = Math.floor(fy)
    const sx = fx - i
    const sy = fy - j

    const x0 = this.originX + i * size
    const y0 = this.originY + j * size

    this.addCorner(x0, y0, (1 - sx) * (1 - sy))
    this.addCorner(x0 + size, y0, sx * (1 - sy))
    this.addCorner(x0, y0 + size, (1 - sx) * sy)
    this.addCorner(x0 + size, y0 + size, sx * sy)

    return wind
  }

  /* adds one grid point's share to the wind being interpolated, standing in
     with the regional wind for as much of it as has not arrived */
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
