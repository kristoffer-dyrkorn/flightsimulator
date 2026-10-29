import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, Points, ShaderMaterial } from "three"

/*
 * The F-16's exterior lights, seen from outside at night:
 *
 * - position lights, red on the left and green on the right, at the wing
 *   tips and on the sides of the air intake - each shining over its own side,
 *   from straight ahead to POSITION_AFT_LIMIT aft, as navigation lights do
 * - a white tail light at the top of the fin's trailing edge, shining aft
 * - a white anti-collision strobe on top of the fin, flashing STROBE_RATE
 *   times a second
 * - a landing light on the nose gear, shining ahead, only with the gear down
 *
 * They come on as the scenery's lights do (see sceneryLights.js), at their
 * strength, and are drawn as glowing points, in the aircraft's own frame -
 * x right, y forward, z up, meters from the centre of gravity - placed on the
 * model's surface.
 */

const RED = new Color(1.0, 0.04, 0.02)
const GREEN = new Color(0.0, 1.0, 0.35)
const WHITE = new Color(1.0, 0.95, 0.88)
const STROBE_WHITE = new Color(0.9, 0.95, 1.0)

const POSITION_AFT_LIMIT = 110 // degrees from straight ahead
const TAIL_HALF_ANGLE = 70 // degrees either side of straight aft
const LANDING_HALF_ANGLE = 25 // degrees either side of straight ahead
const STROBE_RATE = 1 // flashes a second
const STROBE_ON = 0.06 // share of each cycle it is lit

// [position, colour, the way it shines (aircraft frame) and its beam's half
// angle (180 all round), strength, size on screen, kind]. The position
// lights' colours are already at full red and green, which a screen can't
// show any brighter - so they are made brighter with a larger glow and a
// hotter core, from a strength well over 1 (see HOT_CORE).
const LIGHTS = [
  [[-4.45, 0.25, 0.06], RED, [-1, 0, 0], POSITION_AFT_LIMIT, 2.5, 0.96, "position"],
  [[4.45, 0.25, 0.06], GREEN, [1, 0, 0], POSITION_AFT_LIMIT, 2.5, 0.96, "position"],
  [[-0.74, 2.9, -0.42], RED, [-1, 0, 0], POSITION_AFT_LIMIT, 2.0, 0.88, "position"],
  [[0.74, 2.9, -0.42], GREEN, [1, 0, 0], POSITION_AFT_LIMIT, 2.0, 0.88, "position"],
  [[0, -6.1, 3.3], WHITE, [0, -1, 0], TAIL_HALF_ANGLE, 0.9, 1.0, "tail"],
  [[0, -5.5, 3.47], STROBE_WHITE, [0, 0, 1], 180, 2.5, 0.72, "strobe"],
  [[-0.12, 3.62, -1.15], WHITE, [0, 1, -0.15], LANDING_HALF_ANGLE, 2.0, 1.0, "landing"],
]

// how far a very bright light's core turns towards white, at most - as a
// bright coloured light looks to the eye
const HOT_CORE = 0.35

// How bright, at full night, and how far off each stays at full strength
// before fading with the distance; on screen, pixels at a pixel ratio of 1
const BRIGHTNESS = 1.0
const FULL_STRENGTH_RANGE = 400 // m
const SIZE_AT_1M = 160
const MIN_SIZE = 2.5
const MAX_SIZE = 14
// drawn this far nearer the camera, so the skin they sit on doesn't hide them
const SURFACE_PULL = 0.25 // m

const vertexShader = /* glsl */ `
  uniform float pixelRatio;
  uniform float brightness;
  uniform float time;
  uniform float gearDown;

  attribute vec3 color;
  attribute vec3 facing;
  attribute float beamCosine; // the beam's edge - -1 for all round
  attribute float strength;
  attribute float size;
  attribute float kind; // 0 steady, 1 a strobe, 2 the landing light

  varying vec3 vColor;
  varying float vHot;

  void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    float distance = length(mvPosition.xyz);
    vec3 toEye = -mvPosition.xyz / distance;

    // within its beam - for a position light, the half of the sky over its
    // own side and no further aft than its limit: towards its side, and not
    // too far behind
    vec3 shines = normalize(normalMatrix * facing);
    float lit = 1.0;
    if (beamCosine > -1.0) {
      if (kind < 0.5 && facing.x != 0.0) {
        vec3 ahead = normalize(normalMatrix * vec3(0.0, 1.0, 0.0));
        float side = dot(toEye, shines);
        float aft = dot(toEye, ahead);
        // full from dead ahead, above and below too, out to its own side
        lit = smoothstep(-0.2, 0.0, side) * smoothstep(beamCosine - 0.1, beamCosine + 0.05, aft);
      } else {
        lit = smoothstep(beamCosine - 0.1, beamCosine + 0.05, dot(toEye, shines));
      }
    }
    if (kind > 0.5 && kind < 1.5) lit *= step(fract(time * ${STROBE_RATE.toFixed(1)}), ${STROBE_ON.toFixed(3)});
    if (kind > 1.5) lit *= gearDown;

    float falloff = min(1.0, ${FULL_STRENGTH_RANGE.toFixed(1)} * sqrt(strength) / distance);
    float energy = brightness * strength * lit * falloff;
    vColor = color * min(energy, 1.0);
    // see HOT_CORE - from a strength of 1 up to 2
    vHot = ${HOT_CORE.toFixed(2)} * clamp(energy - 1.0, 0.0, 1.0);

    mvPosition.xyz *= max(0.0, 1.0 - ${SURFACE_PULL.toFixed(2)} / distance);
    gl_Position = projectionMatrix * mvPosition;
    gl_PointSize = pixelRatio * clamp(${SIZE_AT_1M.toFixed(1)} / distance, ${MIN_SIZE.toFixed(1)}, ${MAX_SIZE.toFixed(1)});
    gl_PointSize *= size * (1.0 + 0.35 * log2(max(energy, 1.0)));
    if (energy < 0.01) gl_PointSize = 0.0;
  }
`

const fragmentShader = /* glsl */ `
  varying vec3 vColor;
  varying float vHot;

  void main() {
    float r = length(gl_PointCoord - 0.5) * 2.0;
    if (r > 1.0) discard;
    float core = 1.0 - smoothstep(0.0, 0.3, r);
    float glow = exp(-r * r * 5.0) + 0.6 * core;
    vec3 colour = mix(vColor, vec3(max(vColor.r, max(vColor.g, vColor.b))), vHot * core);
    gl_FragColor = vec4(colour * glow, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

const KINDS = { position: 0, tail: 0, strobe: 1, landing: 2 }

export default class F16Lights {
  /**
   * @param f16  the aircraft's object - its frame is the aircraft's
   */
  constructor(f16) {
    const geometry = new BufferGeometry()
    const attribute = (values, size) => new BufferAttribute(new Float32Array(values), size)
    geometry.setAttribute("position", attribute(LIGHTS.flatMap(([p]) => p), 3))
    geometry.setAttribute("color", attribute(LIGHTS.flatMap(([, c]) => [c.r, c.g, c.b]), 3))
    geometry.setAttribute("facing", attribute(LIGHTS.flatMap(([, , d]) => d), 3))
    geometry.setAttribute("beamCosine", attribute(LIGHTS.map(([, , , a]) => (a >= 180 ? -1 : Math.cos((a * Math.PI) / 180))), 1))
    geometry.setAttribute("strength", attribute(LIGHTS.map(([, , , , s]) => s), 1))
    geometry.setAttribute("size", attribute(LIGHTS.map(([, , , , , z]) => z), 1))
    geometry.setAttribute("kind", attribute(LIGHTS.map(([, , , , , , k]) => KINDS[k]), 1))

    this.uniforms = {
      pixelRatio: { value: 1 },
      brightness: { value: 0 },
      time: { value: 0 },
      gearDown: { value: 0 },
    }
    this.points = new Points(
      geometry,
      new ShaderMaterial({
        uniforms: this.uniforms,
        vertexShader,
        fragmentShader,
        transparent: true,
        depthWrite: false,
        blending: AdditiveBlending,
      }),
    )
    this.points.name = "f16Lights"
    this.points.frustumCulled = false
    this.points.renderOrder = 2
    this.points.visible = false
    f16.add(this.points)
  }

  /**
   * @param level       how far on the scenery's lights are, 0 to 1
   * @param outside     whether the aircraft is seen from outside
   * @param gearDown    the gear's position, 0 up to 1 down
   * @param time        seconds, for the strobe
   * @param pixelRatio  the renderer's
   */
  update(level, outside, gearDown, time, pixelRatio) {
    this.points.visible = outside && level > 0
    this.uniforms.brightness.value = BRIGHTNESS * level
    this.uniforms.gearDown.value = gearDown > 0.95 ? 1 : 0
    this.uniforms.time.value = time
    this.uniforms.pixelRatio.value = pixelRatio
  }
}
