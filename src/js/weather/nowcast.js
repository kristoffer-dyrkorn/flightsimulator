import SimulationConstants from "../hifimodel/simulationconstants.js"

/**
 * Reads the surface wind from MET Norway's nowcast, and feeds it to a wind field
 * (see windfield.js).
 *
 * The wind field is a regular grid (see WIND_GRID in windfield.js), and the wind
 * at the aircraft is interpolated between the four grid points of the cell it
 * is in. The forecast is asked for the grid points of that cell, and of the
 * cell it is flying into next, once it is past its cell's mid axis towards it
 * and due there within LEAD seconds - so that cell has been read by the time
 * it gets there (see gridPointsNeeded in windfield.js). Flying straight, that
 * is two new grid points for each cell, read once the aircraft is halfway
 * through the one before; a slow drift sideways asks for the cells beside it
 * only as it closes in on them. Where the aircraft is, and how fast it is
 * moving, is looked at every CHECK_INTERVAL - which asks the forecast nothing
 * unless a grid point needed is missing. Every grid point read is kept for
 * good, so none is asked for twice. Each one read is logged, with where it
 * is.
 *
 * A grid point that cannot be read is asked for again a minute later. Until it
 * is there, the wind field makes do with the samples around it.
 *
 * https://api.met.no/weatherapi/nowcast/2.0/documentation
 */

const NOWCAST_API = "https://api.met.no/weatherapi/nowcast/2.0/complete"

/* how often to look at where the aircraft is, and where it is heading, ms */
const CHECK_INTERVAL = 250

/* how far ahead the next cell is read, s - see gridPointsNeeded */
const LEAD = 10

/* how long to wait before asking again about a grid point that could not be
   read, ms - it may be outside the area the forecast covers, and asking every
   second would not change that */
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
   * @param toLonLat     turns a position, UTM 33 in m, into [lon, lat]
   * @param getPosition  returns where the aircraft is now, as [x, y], UTM 33 in m
   */
  constructor(field, toLonLat, getPosition) {
    this.field = field
    this.toLonLat = toLonLat
    this.getPosition = getPosition

    /* grid points asked for and not answered yet, so they are not asked for
       twice */
    this.pending = new Set()

    /* grid points that could not be read, and when to try them again */
    this.retryAt = new Map()

    /* where the aircraft was at the last check, and when - for its velocity */
    this.last = null
  }

  /**
   * Reads the wind at the grid points the start point needs, and then keeps
   * reading those the aircraft needs for as long as the simulator runs.
   *
   * @returns the wind at the grid point nearest the start point, or null if
   *          it could not be read
   */
  async start(x, y) {
    // the cell it is in - it isn't known yet where it is heading
    const points = this.field.gridPointsAround(x, y)
    const winds = await Promise.all(points.map(([gx, gy]) => this.read(gx, gy)))
    setTimeout(() => this.next(), CHECK_INTERVAL)
    // the nearest comes first
    return winds[0] ?? null
  }

  // asks for the grid points the aircraft needs that are missing - see
  // gridPointsNeeded - with its velocity from where it was at the last check
  next() {
    const [x, y] = this.getPosition()
    const now = performance.now()
    let vx = 0
    let vy = 0
    if (this.last && now > this.last.time) {
      vx = ((x - this.last.x) * 1000) / (now - this.last.time)
      vy = ((y - this.last.y) * 1000) / (now - this.last.time)
    }
    this.last = { x, y, time: now }
    for (const [gx, gy] of this.field.gridPointsNeeded(x, y, vx, vy, LEAD)) this.read(gx, gy)
    setTimeout(() => this.next(), CHECK_INTERVAL)
  }

  /* Reads the wind at a grid point into the field, unless it is there
     already, being read, or failed lately - and logs it. Returns the wind, or
     null. */
  async read(x, y) {
    const key = `${x}-${y}`
    if (this.field.hasCorner(x, y) || this.pending.has(key) || Date.now() < (this.retryAt.get(key) ?? 0)) return null
    this.pending.add(key)

    const [lon, lat] = this.toLonLat(x, y)
    const wind = await downloadWindData(lon, lat)

    if (wind) {
      this.field.addSample(x, y, wind)
      this.retryAt.delete(key)
      console.log(
        "Wind data fetched at UTM 33N %d E, %d N: %s m/s from %d degrees, gusting %s m/s",
        x,
        y,
        (wind.speed * SimulationConstants.FEET_TO_METERS).toFixed(1),
        Math.round(wind.direction),
        (wind.gust * SimulationConstants.FEET_TO_METERS).toFixed(1),
      )
    } else {
      this.retryAt.set(key, Date.now() + RETRY_INTERVAL)
    }

    this.pending.delete(key)
    return wind
  }
}
