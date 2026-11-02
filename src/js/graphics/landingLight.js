import { Matrix4, Vector3 } from "three"

/*
 * The landing light on the nose gear, lighting the ground ahead at night.
 *
 * The terrain has no lighting of its own - the light of the time of day is
 * baked into its colours (see Tile.light) - so the light is added in the
 * terrain's shader: the ground's colour, lit by a spot light at the nose
 * gear. It falls off with the square of the distance, and fades out across
 * the edge of its beam. The ground mostly sees it at a grazing angle, at
 * which a strictly lit surface would look nearly black, while seen from
 * right behind the light it doesn't - so the angle only takes some of it.
 * No shadows: the light reaches through hills.
 *
 * Its glow, seen from outside, is in f16Lights.js. It is on as the scenery
 * lights are (see sceneryLights.js), with the gear down.
 */

// in the aircraft's frame - x right, y forward, z up, meters from the centre
// of gravity - at the nose gear, as in f16Lights.js; aimed down from the
// fuselage line, to where the ground is at the approach's angle of attack
const POSITION = new Vector3(-0.12, 3.62, -1.15)
const AIM_DOWN = 11 // degrees
const DIRECTION = new Vector3(0, Math.cos((AIM_DOWN * Math.PI) / 180), -Math.sin((AIM_DOWN * Math.PI) / 180))
const BEAM_INNER = 6 // degrees from its centre, full strength within
const BEAM_OUTER = 14 // and none beyond
// what the ground's colour is multiplied by, a meter away - at 100 m, 3
const STRENGTH = 30000 // m²
// the share of the light that doesn't depend on the angle it strikes at
const WRAP = 0.4

const uniforms = {
  landingLightPosition: { value: new Vector3() }, // view space
  landingLightDirection: { value: new Vector3(0, 0, -1) }, // view space
  landingLightStrength: { value: 0 },
}

const toView = new Matrix4()

/**
 * Places the light for the camera drawing the terrain, and switches it.
 *
 * @param aircraft  the aircraft's object - its frame is the aircraft's
 * @param camera    the camera about to draw the terrain
 * @param level     how far on the scenery's lights are, 0 to 1
 * @param gear      the gear's position, 0 up to 1 down
 */
export function updateLandingLight(aircraft, camera, level, gear) {
  aircraft.updateMatrixWorld()
  camera.updateMatrixWorld()
  // from the aircraft's frame to the camera's - worked out here, in double
  // precision, so the shader never sees the world's large coordinates
  toView.multiplyMatrices(camera.matrixWorldInverse, aircraft.matrixWorld)
  uniforms.landingLightPosition.value.copy(POSITION).applyMatrix4(toView)
  uniforms.landingLightDirection.value.copy(DIRECTION).transformDirection(toView)
  uniforms.landingLightStrength.value = gear > 0.95 ? STRENGTH * level : 0
}

/**
 * Lets a material - a terrain tile's MeshBasicMaterial, with a map - be lit
 * by the landing light. Keeps any onBeforeCompile it has already.
 */
export function useLandingLight(material) {
  const previous = material.onBeforeCompile
  material.onBeforeCompile = (shader, renderer) => {
    previous?.call(material, shader, renderer)
    Object.assign(shader.uniforms, uniforms)

    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vLandingView;")
      .replace("#include <project_vertex>", "#include <project_vertex>\nvLandingView = mvPosition.xyz;")

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <common>",
        /* glsl */ `#include <common>
        varying vec3 vLandingView;
        uniform vec3 landingLightPosition;
        uniform vec3 landingLightDirection;
        uniform float landingLightStrength;`,
      )
      .replace(
        "#include <opaque_fragment>",
        /* glsl */ `
        #ifdef USE_MAP
        if (landingLightStrength > 0.0) {
          vec3 toPoint = vLandingView - landingLightPosition;
          float distanceSquared = max(dot(toPoint, toPoint), 1.0);
          vec3 along = toPoint * inversesqrt(distanceSquared);
          float beam = smoothstep(${Math.cos((BEAM_OUTER * Math.PI) / 180).toFixed(5)}, ${Math.cos((BEAM_INNER * Math.PI) / 180).toFixed(5)}, dot(along, landingLightDirection));
          // the ground's own normal, from how the point moves across the screen
          vec3 normal = normalize(cross(dFdx(vLandingView), dFdy(vLandingView)));
          float facing = ${WRAP.toFixed(2)} + ${(1 - WRAP).toFixed(2)} * abs(dot(normal, along));
          outgoingLight += sampledDiffuseColor.rgb * landingLightStrength * beam * facing / distanceSquared;
        }
        #endif
        #include <opaque_fragment>`,
      )
  }
  const key = material.customProgramCacheKey
  material.customProgramCacheKey = () => key.call(material) + "+landingLight"
}
