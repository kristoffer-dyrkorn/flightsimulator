import { Matrix4, Vector2 } from "three"

/*
 * Motion streaks for the lights on the ground. A light is a few pixels
 * across, and with the camera turning it jumps many pixels from one frame
 * to the next - some 17 at 40 degrees a second. Held still for each frame, as
 * displays do, the eye following it smears each dot along its path, and the
 * lights looked far dimmer while the view moved than with it still. So each
 * light is drawn as a streak from where it was on the screen in the last
 * frame to where it is now, as bright along it as the light itself, the way
 * a camera with a slow shutter sees a moving point of light. With the camera
 * still the streak has no length, and the light is drawn as before.
 *
 * The streaks are capped at STREAK_MAX, so a jump - a new camera, or the
 * camera put somewhere else - doesn't draw one across the screen, and the
 * last frame's camera is only used if it is the same camera.
 */
const STREAK_MAX = 48 // px, at a pixel ratio of 1
// How much a streak dims for being longer than its light: it is drawn at
// (light / streak length) to this power of the light's brightness - 0 keeps
// it as bright as the light, 1 spreads the light's own over it, as the
// smear did. Overlapping streaks add up, so full brightness made towns
// bright smears while the view turned.
const STREAK_DIMMING = 2.15

class LightStreaks {
  constructor() {
    this.viewport = { value: new Vector2(1, 1) }
    this.previous = new Matrix4()
    this.current = new Matrix4()
    this.lastCamera = null
  }

  /**
   * Call once a frame, after the camera has been placed and before the
   * lights are updated.
   *
   * @param camera     the camera drawing the terrain
   * @param width      the drawing buffer's width, pixels
   * @param height     and height
   * @param streaking  false for plain points, with no streaks: from the
   *                   cockpit, where the view's quick look turns ran the
   *                   streaks to their full length, and dimmed for it the
   *                   lights went out while the view turned
   */
  update(camera, width, height, streaking = true) {
    camera.updateMatrixWorld()
    this.viewport.value.set(width, height)
    const now = new Matrix4().multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
    this.previous.copy(streaking && camera === this.lastCamera ? this.current : now)
    this.current.copy(now)
    this.lastCamera = camera
  }

  /**
   * Sets a light cloud's uniforms for the streaks: where it was drawn last
   * frame, worked out here in double precision - the scene's coordinates
   * are UTM meters, far too large for the GPU's floats to do it with.
   */
  updateCloud(cloud) {
    cloud.updateMatrixWorld()
    cloud.material.uniforms.previousModelViewProjection.value.multiplyMatrices(this.previous, cloud.matrixWorld)
  }

  // the uniforms a light material needs - see the shader chunks below
  uniforms() {
    return { previousModelViewProjection: { value: new Matrix4() }, viewport: this.viewport }
  }
}

export const lightStreaks = new LightStreaks()

// Vertex shader: declarations, and the streak - call after gl_Position and
// gl_PointSize are set. It moves the sprite to the middle of the streak and
// makes it large enough to hold it.
export const streakVertexPars = /* glsl */ `
  uniform mat4 previousModelViewProjection;
  uniform vec2 viewport;
  varying vec2 vStreak; // pixels, from the sprite's middle to one end
  varying float vCore; // the light's own size, pixels
  varying float vSprite; // the sprite's size, pixels
  varying float vStreakShare; // how bright the streak is - see STREAK_DIMMING
`
export const streakVertex = /* glsl */ `
  {
    vec4 before = previousModelViewProjection * vec4(position, 1.0);
    vec2 streak = vec2(0.0);
    if (before.w > 0.0 && gl_Position.w > 0.0) {
      streak = (before.xy / before.w - gl_Position.xy / gl_Position.w) * 0.5 * viewport;
      float most = ${STREAK_MAX.toFixed(1)} * pixelRatio;
      float streakLength = length(streak);
      if (streakLength > most) streak *= most / streakLength;
    }
    vCore = gl_PointSize;
    vStreak = streak * 0.5;
    gl_PointSize += length(streak);
    vSprite = gl_PointSize;
    vStreakShare = pow(vCore / max(vSprite, 1.0), ${STREAK_DIMMING.toFixed(2)});
    gl_Position.xy += (streak * 0.5) / (0.5 * viewport) * gl_Position.w;
  }
`

// Fragment shader: declarations, and r - the distance from the streak, as
// a share of the light's radius (0 on it, 1 at its edge)
export const streakFragmentPars = /* glsl */ `
  varying vec2 vStreak;
  varying float vCore;
  varying float vSprite;
  varying float vStreakShare;

  float streakDistance() {
    vec2 p = (gl_PointCoord - 0.5) * vSprite;
    p.y = -p.y;
    vec2 a = -vStreak, b = vStreak, ab = b - a;
    float t = clamp(dot(p - a, ab) / max(dot(ab, ab), 1e-6), 0.0, 1.0);
    return length(p - (a + ab * t)) / (0.5 * vCore);
  }
`
