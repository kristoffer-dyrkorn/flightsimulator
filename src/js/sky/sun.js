/**
 * Where the sun is in the sky - see atmosphere.js for what its light is
 * like by the time it gets down through the air.
 *
 * The position follows NOAA's solar position calculations (the ones behind
 * their online solar calculator), good to well under the sun's own width for
 * any date this simulator will see. Near the horizon the atmosphere bends the
 * sun's light upwards, lifting it by about half a degree right at the horizon,
 * so the elevation returned is the apparent one, as the pilot sees it.
 *
 * https://gml.noaa.gov/grad/solcalc/calcdetails.html
 */

const DEG = Math.PI / 180

/**
 * @param date  the moment, as a Date
 * @param lat   latitude, degrees north
 * @param lon   longitude, degrees east
 * @returns { azimuth, elevation }, degrees: azimuth clockwise from true north,
 *          elevation above the horizon, refraction included
 */
export function sunPosition(date, lat, lon) {
  // Julian centuries since J2000.0
  const julianDay = date.getTime() / 86400000 + 2440587.5
  const t = (julianDay - 2451545) / 36525

  const meanLongitude = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360
  const meanAnomaly = 357.52911 + t * (35999.05029 - 0.0001537 * t)
  const eccentricity = 0.016708634 - t * (0.000042037 + 0.0000001267 * t)

  const m = meanAnomaly * DEG
  const centre =
    Math.sin(m) * (1.914602 - t * (0.004817 + 0.000014 * t)) +
    Math.sin(2 * m) * (0.019993 - 0.000101 * t) +
    Math.sin(3 * m) * 0.000289

  const omega = (125.04 - 1934.136 * t) * DEG
  const apparentLongitude = (meanLongitude + centre - 0.00569 - 0.00478 * Math.sin(omega)) * DEG

  const meanObliquity = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60
  const obliquity = (meanObliquity + 0.00256 * Math.cos(omega)) * DEG

  const declination = Math.asin(Math.sin(obliquity) * Math.sin(apparentLongitude))

  // equation of time, minutes - how far the sun runs ahead of or behind the
  // clock over the year
  const y = Math.tan(obliquity / 2) ** 2
  const l0 = meanLongitude * DEG
  const equationOfTime =
    (4 / DEG) *
    (y * Math.sin(2 * l0) -
      2 * eccentricity * Math.sin(m) +
      4 * eccentricity * y * Math.sin(m) * Math.cos(2 * l0) -
      0.5 * y * y * Math.sin(4 * l0) -
      1.25 * eccentricity * eccentricity * Math.sin(2 * m))

  const minutes = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60
  const trueSolarTime = (((minutes + equationOfTime + 4 * lon) % 1440) + 1440) % 1440
  const hourAngle = (trueSolarTime / 4 - 180) * DEG

  const phi = lat * DEG
  const cosZenith =
    Math.sin(phi) * Math.sin(declination) + Math.cos(phi) * Math.cos(declination) * Math.cos(hourAngle)
  const elevation = 90 - Math.acos(Math.min(1, Math.max(-1, cosZenith))) / DEG

  const azimuth =
    (Math.atan2(Math.sin(hourAngle), Math.cos(hourAngle) * Math.sin(phi) - Math.tan(declination) * Math.cos(phi)) /
      DEG +
      180) %
    360

  return { azimuth, elevation: elevation + refraction(elevation) }
}

// How much the atmosphere lifts the sun, degrees, at a true elevation in
// degrees - Saemundsson's formula (Bennett's better known one goes the other
// way, from the apparent elevation), about 0.57 degrees at the horizon and
// down to a minute of arc by 45 degrees. Below the horizon it is held at its
// value there, so the sun does not jump as it sets.
function refraction(elevation) {
  const h = Math.max(elevation, -1)
  return 1.02 / 60 / Math.tan((h + 10.3 / (h + 5.11)) * DEG)
}

// civil twilight: the sun's centre this far below the horizon, degrees
const CIVIL_TWILIGHT = -6

/**
 * Dawn and dusk - the start of morning civil twilight and the end of the
 * evening's, when the sun's centre is six degrees below the horizon - on the
 * day of the moment given. The day is the local solar one, from midnight to
 * midnight by the sun at that longitude, so the night it starts and ends in
 * is all on one side of noon. Found to the minute.
 *
 * @param date  a moment on that day, as a Date
 * @param lat   latitude, degrees north
 * @param lon   longitude, degrees east
 * @returns { dawn, dusk }, Dates - either null on a day the sun doesn't get
 *          that far down, as round midsummer this far north
 */
export function twilight(date, lat, lon) {
  const MINUTE = 60000
  const DAY = 1440 * MINUTE
  const solarOffset = (lon / 15) * 3600000
  const midnight = Math.floor((date.getTime() + solarOffset) / DAY) * DAY - solarOffset

  // sunPosition's elevation has refraction in it, which below the horizon
  // stays at its value there
  const threshold = CIVIL_TWILIGHT + refraction(CIVIL_TWILIGHT)
  const up = (minute) => sunPosition(new Date(midnight + minute * MINUTE), lat, lon).elevation >= threshold

  let dawn = null
  let dusk = null
  if (!up(0)) {
    for (let minute = 1; minute <= 1440; minute++) {
      if (up(minute)) {
        dawn = new Date(midnight + minute * MINUTE)
        break
      }
    }
  }
  if (!up(1440)) {
    for (let minute = 1439; minute >= 0; minute--) {
      if (up(minute)) {
        dusk = new Date(midnight + minute * MINUTE)
        break
      }
    }
  }
  return { dawn, dusk }
}
