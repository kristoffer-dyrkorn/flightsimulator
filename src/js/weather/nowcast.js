import SimulationConstants from "../hifimodel/simulationconstants.js"

/**
 * Reads the surface wind from MET Norway's nowcast, and feeds it to a wind field
 * (see windfield.js) a little at a time.
 *
 * The forecast is asked about one point at a time, and the wind field wants it
 * at the corners of the terrain tiles. Asking about all the corners in sight at
 * once would be dozens of requests the moment the simulator starts, so they are
 * spread out instead: one for the start point, which is the weather until
 * anything better comes in, then one corner at a time, a few seconds apart, and
 * only for the corners the aircraft is about to need - those of the tile it is
 * over, and those of a neighbouring tile once it gets close to it. The nearest
 * corner still missing is always the next one asked for, so a change of course
 * is followed straight away.
 *
 * A corner that cannot be read is asked for again a minute later. Until it is
 * there, the wind field makes do with the samples around it.
 *
 * https://api.met.no/weatherapi/nowcast/2.0/documentation
 */

const NOWCAST_API = "https://api.met.no/weatherapi/nowcast/2.0/complete"

/* time between requests, ms */
const REQUEST_INTERVAL = 3000

/* how close to a neighbouring tile the aircraft has to be for its corners to be
   read, as a fraction of a tile - about three kilometres, which is a dozen
   seconds at 500 knots, and time enough to read the two or three corners it
   does not share with the tile the aircraft is over */
const CLOSE_IN = 0.25

/* how long to wait before asking again about a corner that could not be read,
   ms - it may be outside the area the forecast covers, and asking every few
   seconds would not change that */
const RETRY_INTERVAL = 60000

/**
 * Downloads the surface wind at a point.
 *
 * @param lon, lat  degrees
 * @returns the wind there, or null if it could not be read: { east, north,
 *          gustSpread, speed, gust } in ft/s, with east and north being the
 *          direction the air moves towards, and the direction it comes from,
 *          degrees
 */
export async function downloadWindData(lon, lat) {
  // MET asks for no more than four decimals - more only defeats their caching
  const url = `${NOWCAST_API}?lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}`

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: {
        "User-Agent": "https://github.com/kristoffer-dyrkorn/flightsimulator - dyrkorn@gmail.com",
      },
    })

    if (!response.ok) {
      throw new Error(`the weather service answered ${response.status}`)
    }

    const weatherData = await response.json()

    // only the first entry of the series carries the wind - the ones after it are
    // the precipitation forecast, and have nothing else in them
    const { wind_from_direction, wind_speed, wind_speed_of_gust } =
      weatherData.properties.timeseries[0].data.instant.details

    // speeds are reported in m/s and the flight model works in ft/s
    const speed = wind_speed * SimulationConstants.METERS_TO_FEET
    const gust = (wind_speed_of_gust ?? wind_speed) * SimulationConstants.METERS_TO_FEET

    // a wind direction is the direction the wind comes from, so the direction it
    // blows towards - which is what a velocity needs - is the opposite one
    const heading = ((wind_from_direction + 180) * Math.PI) / 180

    return {
      east: speed * Math.sin(heading),
      north: speed * Math.cos(heading),
      gustSpread: Math.max(gust - speed, 0),
      speed,
      gust,
      direction: wind_from_direction,
    }
  } catch (error) {
    console.log("Could not read wind data at %s, %s: %s", lat.toFixed(4), lon.toFixed(4), error.message)
    return null
  }
}

export default class NowcastWind {
  /**
   * @param field        the wind field to fill in
   * @param toLonLat     turns a position in the tile grid, m, into [lon, lat]
   * @param getPosition  returns where the aircraft is now, as [x, y] in m
   */
  constructor(field, toLonLat, getPosition) {
    this.field = field
    this.toLonLat = toLonLat
    this.getPosition = getPosition

    /* corners asked for and not answered yet, so they are not asked for twice */
    this.pending = new Set()

    /* corners that could not be read, and when to try them again */
    this.retryAt = new Map()
  }

  /**
   * Reads the wind at the start point, and then keeps reading the corners
   * around the aircraft for as long as the simulator runs.
   *
   * @returns the wind at the start point, or null if it could not be read
   */
  async start(x, y) {
    const [lon, lat] = this.toLonLat(x, y)
    const wind = await downloadWindData(lon, lat)

    if (wind) this.field.addSample(x, y, wind)

    setTimeout(() => this.next(), REQUEST_INTERVAL)

    return wind
  }

  async next() {
    const corner = this.nearestMissingCorner()

    if (corner) {
      const key = `${corner[0]}-${corner[1]}`
      this.pending.add(key)

      const [lon, lat] = this.toLonLat(corner[0], corner[1])
      const wind = await downloadWindData(lon, lat)

      if (wind) {
        this.field.addSample(corner[0], corner[1], wind)
        this.retryAt.delete(key)
      } else {
        this.retryAt.set(key, Date.now() + RETRY_INTERVAL)
      }

      this.pending.delete(key)
    }

    setTimeout(() => this.next(), REQUEST_INTERVAL)
  }

  /* The corner the aircraft needs that is nearest to it and has not been read:
     the corners of the tile it is over, and of any neighbouring tile it is
     closing in on. Null when it has everything it needs. */
  nearestMissingCorner() {
    const field = this.field
    const size = field.tileExtents
    const [x, y] = this.getPosition()

    // the tile the aircraft is over, and how far into it it is, 0 to 1
    const fx = (x - field.minx) / size
    const fy = (y - field.miny) / size
    const i = Math.floor(fx)
    const j = Math.floor(fy)
    const sx = fx - i
    const sy = fy - j

    // the tiles it needs: its own, and whichever neighbours it is close to
    const columns = [i]
    if (sx < CLOSE_IN) columns.push(i - 1)
    if (sx > 1 - CLOSE_IN) columns.push(i + 1)

    const rows = [j]
    if (sy < CLOSE_IN) rows.push(j - 1)
    if (sy > 1 - CLOSE_IN) rows.push(j + 1)

    const now = Date.now()

    let nearest = null
    let nearestDistance = Infinity

    for (const tileJ of rows) {
      for (const tileI of columns) {
        for (const [ci, cj] of [
          [tileI, tileJ],
          [tileI + 1, tileJ],
          [tileI, tileJ + 1],
          [tileI + 1, tileJ + 1],
        ]) {
          const cx = field.minx + ci * size
          const cy = field.miny + cj * size

          const key = `${cx}-${cy}`
          if (field.hasCorner(cx, cy) || this.pending.has(key) || now < (this.retryAt.get(key) ?? 0)) continue

          const distance = Math.hypot(cx - x, cy - y)
          if (distance < nearestDistance) {
            nearest = [cx, cy]
            nearestDistance = distance
          }
        }
      }
    }

    return nearest
  }
}
