import { CanvasTexture, LinearMipmapLinearFilter, Vector4 } from "three"

/*
 * Runways painted onto the terrain: asphalt, and the white markings of an
 * ICAO precision approach runway (Annex 14, 5.2) - threshold stripes, the
 * designator, centreline, aiming point, touchdown zone and side stripes,
 * and arrows ahead of a displaced threshold.
 *
 * The terrain's photos are around 3 m a pixel, which leaves a 45 m runway
 * a blurry grey band 15 pixels wide. So the runway is drawn in the
 * terrain's shader instead, from the runway's outline: each point of the
 * ground is placed in the runway's own frame - meters along it from a
 * threshold, and across it from its centreline - and the markings are
 * worked out there, pixel by pixel, as sharp up close as they are at a
 * distance. Each marking is a set of rectangles, box filtered over the
 * pixel's footprint so they don't flicker at the grazing angles of an
 * approach. The designators' digits come from a small atlas of glyphs,
 * drawn once into a canvas, in a font made to ICAO's forms for them.
 *
 * A tile holds up to MAX_RUNWAYS runways, those in its own runway file (see
 * RunwayRegistry.surfaces). A runway is placed by its threshold lights
 * where they are known: the outline is the paved area, and can reach past
 * the thresholds.
 */

const MAX_RUNWAYS = 4

// the designator's glyphs - 0 to 9, then the letters for parallel runways -
// in Open Runway Numbers (CC0 / SIL OFL, github.com/ryo-a/Open-Runway-Fonts),
// drawn to the forms and proportions of ICAO Annex 14, figure 5-3: 9 m tall,
// and spaced as the font spaces them
const GLYPHS = "0123456789LCR"
export const LETTER_GLYPH = { L: 10, C: 11, R: 12 }
const FONT = "Open Runway Numbers"
const FONT_URL = new URL("../../fonts/OpenRunwayNumbers.woff2", import.meta.url)
const GLYPH_HEIGHT = 9 // m
// each glyph's cell in the atlas, m - wider and longer than any of them, with
// room round them so the mipmaps don't bleed into the next one; the baseline
// is GLYPH_BASELINE up from its bottom, as some reach a little below it
const GLYPH_CELL = [5, 10]
const GLYPH_BASELINE = 0.5
const PX_PER_M = 32
// paved shoulder either side of a runway, beyond its edge stripes (m)
const SHOULDER_WIDTH = 9

// for each glyph, m: the middle of its ink from where it starts, and how far
// on the next glyph starts - once the font is in
const glyphMetrics = []

const atlasCanvas = document.createElement("canvas")
atlasCanvas.width = GLYPH_CELL[0] * PX_PER_M * GLYPHS.length
atlasCanvas.height = GLYPH_CELL[1] * PX_PER_M
const glyphAtlas = new CanvasTexture(atlasCanvas)
glyphAtlas.minFilter = LinearMipmapLinearFilter
glyphAtlas.anisotropy = 16

// the glyphs, each with its ink in the middle of its cell, drawn into the
// atlas once the font has loaded - blank until then
const fontReady = new FontFace(FONT, `url(${FONT_URL})`)
  .load()
  .then((font) => {
    document.fonts.add(font)
    const context = atlasCanvas.getContext("2d")
    context.fillStyle = "black"
    context.fillRect(0, 0, atlasCanvas.width, atlasCanvas.height)
    context.fillStyle = "white"
    context.textBaseline = "alphabetic"
    // sized for a "0" GLYPH_HEIGHT tall
    context.font = `100px '${FONT}'`
    const size = (100 * GLYPH_HEIGHT * PX_PER_M) / context.measureText("0").actualBoundingBoxAscent
    context.font = `${size}px '${FONT}'`
    for (let i = 0; i < GLYPHS.length; i++) {
      const m = context.measureText(GLYPHS[i])
      const inkMiddle = (m.actualBoundingBoxRight - m.actualBoundingBoxLeft) / 2
      glyphMetrics[i] = { middle: inkMiddle / PX_PER_M, advance: m.width / PX_PER_M }
      context.fillText(
        GLYPHS[i],
        (i + 0.5) * GLYPH_CELL[0] * PX_PER_M - inkMiddle,
        (GLYPH_CELL[1] - GLYPH_BASELINE) * PX_PER_M,
      )
    }
    glyphAtlas.needsUpdate = true
  })
  .catch((error) => console.log("Runway font not loaded:", error))

// where the middles of a runway number's two digits are, m across from the
// centreline - set as the font sets them, the two together centred
function digitMiddles(number) {
  const [tens, ones] = [Math.floor(number / 10), number % 10].map((digit) => glyphMetrics[digit])
  if (!tens || !ones) return [-2.6, 2.6]
  const left = tens.middle
  const right = tens.advance + ones.middle
  const centre = (left + right) / 2
  return [left - centre, right - centre]
}

/**
 * Lets a terrain tile's material paint runways - none, until
 * setRunwaySurfaces gives it some. Keeps any onBeforeCompile it has already.
 */
export function useRunwaySurface(material) {
  const uniforms = {
    runwayCount: { value: 0 },
    // the threshold the runway is measured from (x, y, tile-local m) and
    // the unit direction along it, towards the other threshold
    runwayFrame: { value: Array.from({ length: MAX_RUNWAYS }, () => new Vector4()) },
    // the paved area, from and to along it, and half its width; then the
    // distance between the thresholds
    runwayExtent: { value: Array.from({ length: MAX_RUNWAYS }, () => new Vector4()) },
    // the designator at each end: its number, and its letter's glyph (or -1)
    runwayDesignators: { value: Array.from({ length: MAX_RUNWAYS }, () => new Vector4()) },
    // where the number's digits are at each end, across: tens and ones at
    // the first, then at the other - see digitMiddles
    runwayDigits: { value: Array.from({ length: MAX_RUNWAYS }, () => new Vector4()) },
    runwayGlyphs: { value: glyphAtlas },
  }
  material.userData.runwaySurface = uniforms

  const previous = material.onBeforeCompile
  material.onBeforeCompile = (shader, renderer) => {
    previous?.call(material, shader, renderer)
    Object.assign(shader.uniforms, uniforms)

    // the tile's own coordinates - easting and northing from its lower left
    // corner - as the runway files have them: the mesh is turned up from them
    // (see Tile), with the northing along -z
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vRunwayGround;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvRunwayGround = vec2(position.x, -position.z);")

    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>\nvarying vec2 vRunwayGround;\n${RUNWAY_GLSL}`)
      .replace(
        "#include <map_fragment>",
        /* glsl */ `#include <map_fragment>
        #ifdef USE_MAP
        if (runwayCount > 0) {
          sampledDiffuseColor.rgb = paintRunways(vRunwayGround, sampledDiffuseColor.rgb);
          diffuseColor.rgb = diffuse * sampledDiffuseColor.rgb;
        }
        #endif`,
      )
  }
  const key = material.customProgramCacheKey
  material.customProgramCacheKey = () => key.call(material) + "+runwaySurface"
}

/**
 * The runways a tile's material paints.
 *
 * @param runways  each { origin: [x, y], direction: [x, y], from, to,
 *                 halfWidth, length, designators: [number, letter glyph,
 *                 number, letter glyph] } - see RunwayRegistry.surfaces
 */
export function setRunwaySurfaces(material, runways) {
  // the digits are placed by the font's metrics
  fontReady.then(() => {
    const uniforms = material.userData.runwaySurface
    const count = Math.min(runways.length, MAX_RUNWAYS)
    uniforms.runwayCount.value = count
    for (let i = 0; i < count; i++) {
      const r = runways[i]
      uniforms.runwayFrame.value[i].set(r.origin[0], r.origin[1], r.direction[0], r.direction[1])
      uniforms.runwayExtent.value[i].set(r.from, r.to, r.halfWidth, r.length)
      uniforms.runwayDesignators.value[i].set(...r.designators)
      uniforms.runwayDigits.value[i].set(...digitMiddles(r.designators[0]), ...digitMiddles(r.designators[2]))
    }
  })
}

const RUNWAY_GLSL = /* glsl */ `
#define MAX_RUNWAYS ${MAX_RUNWAYS}
uniform int runwayCount;
uniform vec4 runwayFrame[MAX_RUNWAYS];
uniform vec4 runwayExtent[MAX_RUNWAYS];
uniform vec4 runwayDesignators[MAX_RUNWAYS];
uniform vec4 runwayDigits[MAX_RUNWAYS];
uniform sampler2D runwayGlyphs;

// linear, as the photos' colours are once read: aged asphalt shows as
// about 30% grey, the rubber on it nearly black, and the paint off-white
const vec3 ASPHALT = vec3(0.075, 0.075, 0.08);
const vec3 RUBBER = vec3(0.03, 0.03, 0.032);
const vec3 PAINT = vec3(0.62, 0.62, 0.6);
// the shoulders: paved, unmarked, a little greyer than the runway, either
// side of it - out to 63 m across in all on a 45 m runway - and fading
// into the ground round them over their outer metres
const vec3 SHOULDER = vec3(0.1, 0.1, 0.1);
const float SHOULDER_WIDTH = ${SHOULDER_WIDTH.toFixed(1)};
const float SHOULDER_FADE = 2.0;

// how much of [a, b] a pixel's footprint covers - width w, centred on x
float band(float x, float w, float a, float b) {
  return clamp((min(b, x + 0.5 * w) - max(a, x - 0.5 * w)) / w, 0.0, 1.0);
}

// the area under stripes d long, one every p, the first starting at 0, up
// to x
float stripesUpTo(float x, float p, float d) {
  return floor(x / p) * d + min(mod(x, p), d);
}

// how much a pixel's footprint covers of those stripes, between a and b
float stripes(float x, float w, float a, float b, float p, float d) {
  float lo = clamp(x - 0.5 * w, a, b) - a;
  float hi = clamp(x + 0.5 * w, a, b) - a;
  return (stripesUpTo(hi, p, d) - stripesUpTo(lo, p, d)) / w;
}

float rect(vec2 sc, vec2 w, float s0, float s1, float c0, float c1) {
  return band(sc.x, w.x, s0, s1) * band(sc.y, w.y, c0, c1);
}

// one glyph, standing on s0 - the end nearest the threshold, as it is read -
// with the middle of its ink at c
float glyph(vec2 sc, vec2 dsdx, vec2 dsdy, float index, float s0, float c) {
  const vec2 size = vec2(${GLYPH_CELL[0].toFixed(1)}, ${GLYPH_CELL[1].toFixed(1)});
  vec2 cell = vec2((sc.y - c) / size.x + 0.5, (sc.x - s0 + ${GLYPH_BASELINE.toFixed(2)}) / size.y);
  if (index < 0.0 || any(lessThan(cell, vec2(0.0))) || any(greaterThan(cell, vec2(1.0)))) return 0.0;
  const float n = ${GLYPHS.length}.0;
  vec2 uv = vec2((index + cell.x) / n, cell.y);
  return textureGrad(runwayGlyphs, uv, vec2(dsdx.y / (size.x * n), dsdx.x / size.y), vec2(dsdy.y / (size.x * n), dsdy.x / size.y)).r;
}

// the markings at one end: s meters past its threshold, c from the
// centreline, right positive as seen landing - lda the landing distance
// available from it, number and letter its designator, digits where the
// number's two digits are across
float endMarkings(vec2 sc, vec2 w, vec2 dsdx, vec2 dsdy, float halfWidth, float lda, float number, float letter, vec2 digits) {
  float s = sc.x;
  float c = sc.y;
  float ac = abs(c);
  float paint = 0.0;

  // threshold stripes, 30 m long from 6 m in - 1.8 m wide, 1.8 m apart,
  // either side of a gap of 3.6 m in the middle: 4 of them on an 18 m wide
  // runway, 6 on 23 m, 8 on 30 m, 12 on 45 m and 16 on 60 m
  float perSide = floor(halfWidth / 3.75);
  paint = max(paint, band(s, w.x, 6.0, 36.0) * stripes(ac, w.y, 1.8, perSide * 3.6, 3.6, 1.8));

  // the designator, 12 m on from those: a letter first, then the number
  float numberFrom = 48.0;
  if (letter >= 0.0) {
    paint = max(paint, glyph(sc, dsdx, dsdy, letter, 48.0, 0.0));
    numberFrom = 63.0;
  }
  paint = max(paint, glyph(sc, dsdx, dsdy, floor(number / 10.0), numberFrom, digits.x));
  paint = max(paint, glyph(sc, dsdx, dsdy, mod(number, 10.0), numberFrom, digits.y));

  // the aiming point - 400 m in on a long runway, 300 m on a shorter one -
  // and the touchdown zone, pairs of bars every 150 m, fewer of them the
  // shorter the runway
  float aim = lda >= 2400.0 ? 400.0 : 300.0;
  paint = max(paint, band(s, w.x, aim, aim + 45.0) * band(ac, w.y, 9.0, 15.0));
  float zones = lda < 900.0 ? 1.0 : lda < 1200.0 ? 2.0 : lda < 1500.0 ? 3.0 : lda < 2400.0 ? 4.0 : 6.0;
  float zone = 0.0;
  for (int k = 1; k <= 7; k++) {
    float at = float(k) * 150.0;
    if (abs(at - aim) < 100.0) {
      zone += 1.0; // the aiming point counts as one
      continue;
    }
    zone += 1.0;
    if (zone > zones) break;
    // 3 bars, then 2, then 1 - 22.5 m long, 1.8 m wide, 1.5 m apart
    float bars = zone <= 1.0 ? 3.0 : zone <= 4.0 ? 2.0 : 1.0;
    paint = max(paint, band(s, w.x, at, at + 22.5) * stripes(ac, w.y, 9.0, 9.0 + bars * 3.3 - 1.5, 3.3, 1.8));
  }

  // ahead of a displaced threshold: a stripe across, and arrows towards it
  paint = max(paint, band(s, w.x, -1.8, 0.0) * band(ac, w.y, 0.0, halfWidth - 0.9));
  if (s < -10.0) {
    float along = mod(s, 60.0); // each arrow 30 m long, its tip at 30
    // the shaft runs up into the tip, where the head's arms meet over it
    float shaft = band(along, w.x, 0.0, 28.5) * band(ac, w.y, 0.0, 0.45);
    // the head an open V: two arms 0.9 m wide, from the tip back 10 m, to
    // 3 m either side
    float arm = ac - 0.3 * (30.0 - along);
    float head = band(along, w.x, 20.0, 30.0) * band(arm, w.y + 0.3 * w.x, -0.94, 0.0);
    paint = max(paint, max(shaft, head));
  }
  return paint;
}

float runwayHash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float runwayNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(runwayHash(i), runwayHash(i + vec2(1.0, 0.0)), f.x),
             mix(runwayHash(i + vec2(0.0, 1.0)), runwayHash(i + vec2(1.0, 1.0)), f.x), f.y);
}

vec3 paintRunways(vec2 ground, vec3 photo) {
  vec3 colour = photo;
  for (int i = 0; i < MAX_RUNWAYS; i++) {
    if (i >= runwayCount) break;
    vec4 frame = runwayFrame[i];
    vec4 extent = runwayExtent[i];
    vec2 d = ground - frame.xy;
    // along from the first threshold, and across - right positive, landing
    // from it
    vec2 sc = vec2(dot(d, frame.zw), dot(d, vec2(frame.w, -frame.z)));
    vec2 dsdx = dFdx(sc);
    vec2 dsdy = dFdy(sc);
    vec2 w = max(abs(dsdx) + abs(dsdy), vec2(1e-3));
    float halfWidth = extent.z;
    float along = band(sc.x, w.x, extent.x, extent.y);
    float outer = halfWidth + SHOULDER_WIDTH;
    float shoulder = along * (1.0 - smoothstep(outer - SHOULDER_FADE, outer, abs(sc.y)));
    if (shoulder <= 0.0) continue;
    float paved = along * band(sc.y, w.y, -halfWidth, halfWidth);

    float detail = 1.0 - smoothstep(0.5, 4.0, max(w.x, w.y));
    float patches = runwayNoise(sc * vec2(0.08, 0.25)) * 0.6 + runwayNoise(sc * vec2(0.5, 1.5)) * 0.4 * detail;
    colour = mix(colour, SHOULDER * (0.8 + 0.4 * patches), shoulder);
    if (paved <= 0.0) continue;

    // the other end's frame: from its threshold, back the other way
    vec2 scB = vec2(extent.w - sc.x, -sc.y);
    bool nearA = sc.x < 0.5 * extent.w;
    vec2 end = nearA ? sc : scB;

    // asphalt, patchy, with rubber laid down along the middle where wheels
    // touch down - faded out where it's finer than a pixel
    vec3 surface = ASPHALT * (0.85 + 0.3 * patches);
    float streaks = runwayNoise(vec2(end.x * 0.02, end.y * 1.2)) * mix(0.5, runwayNoise(vec2(end.x * 0.3, end.y * 3.0)), detail);
    float rubber = smoothstep(150.0, 300.0, end.x) * (1.0 - smoothstep(700.0, 1000.0, end.x)) * (1.0 - smoothstep(4.0, 10.0, abs(end.y)));
    surface = mix(surface, RUBBER, rubber * (0.4 + 0.6 * streaks));

    float ldaA = extent.y;
    float ldaB = extent.w - extent.x;
    float paint = nearA
      ? endMarkings(sc, w, dsdx, dsdy, halfWidth, ldaA, runwayDesignators[i].x, runwayDesignators[i].y, runwayDigits[i].xy)
      : endMarkings(scB, w, -dsdx, -dsdy, halfWidth, ldaB, runwayDesignators[i].z, runwayDesignators[i].w, runwayDigits[i].zw);

    // the centreline, 30 m stripes 20 m apart, from 12 m past the
    // designators at either end; and the side stripes, at the edges
    float startA = runwayDesignators[i].y >= 0.0 ? 84.0 : 69.0;
    float startB = runwayDesignators[i].w >= 0.0 ? 84.0 : 69.0;
    paint = max(paint, stripes(sc.x, w.x, startA, extent.w - startB, 50.0, 30.0) * band(sc.y, w.y, -0.45, 0.45));
    paint = max(paint, band(sc.x, w.x, extent.x, extent.y) * band(abs(sc.y), w.y, halfWidth - 0.9, halfWidth));

    // worn where it's run over
    float wear = 0.85 + 0.15 * runwayNoise(sc * vec2(0.4, 2.0));
    surface = mix(surface, PAINT * wear, clamp(paint, 0.0, 1.0));
    colour = mix(colour, surface, paved);
  }
  return colour;
}
`
