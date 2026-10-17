import { Color, ShaderChunk, Vector2 } from "three"
import { SKY_AZIMUTHS } from "./atmosphere.js"

/**
 * Fog for the terrain that takes on the colour of the horizon behind it.
 *
 * Distant terrain fades into the haze in front of it, and the haze, looked
 * through far enough, is the colour of the sky at the horizon in that
 * direction. With the sun low that differs a lot round the compass - a
 * bright glow towards the sun, the dark blue and purple of the earth's
 * shadow away from it - and with one fog colour for all of it, the average,
 * the distant terrain came out too bright on one side and too dull on the
 * other, against the horizon right above it.
 *
 * So the fog colour is looked up for each pixel, by the azimuth of its
 * direction from the sun's, among the horizon colours the sky worked out (see
 * SkyDome). How thick the fog is stays as it is - see scene.fog in index.js.
 */

// shared by every material using the fog, so updating them updates all
const uniforms = {
  horizonColors: { value: Array.from({ length: SKY_AZIMUTHS }, () => new Color(0.5, 0.5, 0.5)) },
  sunAcross: { value: new Vector2(0, 1) },
}

/**
 * @param horizonColors  the horizon's colours, from the sun's azimuth (0) to
 *                       the opposite one - see SkyDome.horizonColors
 * @param sunDirection   towards the sun, in the scene's frame (z up)
 */
export function updateHorizonFog(horizonColors, sunDirection) {
  // three mixes the fog in after the colour has been made ready for the
  // screen, so the fog colours are made ready for it the same way
  horizonColors.forEach((color, i) => uniforms.horizonColors.value[i].copy(color).convertLinearToSRGB())

  if (sunDirection.x !== 0 || sunDirection.y !== 0) {
    uniforms.sunAcross.value.set(sunDirection.x, sunDirection.y).normalize()
  }
}

/**
 * Gives a material this fog in place of three's own one-colour fog.
 */
export function useHorizonFog(material) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)

    // the direction from the camera to the point, in the scene's frame -
    // turned back from the camera's frame, so without the large world
    // coordinates, which would cost the fragment shader its precision
    shader.vertexShader = shader.vertexShader
      .replace("#include <fog_pars_vertex>", "#include <fog_pars_vertex>\nvarying vec3 vHorizonDirection;")
      .replace(
        "#include <fog_vertex>",
        "#include <fog_vertex>\nvHorizonDirection = transpose(mat3(viewMatrix)) * mvPosition.xyz;",
      )

    shader.fragmentShader = shader.fragmentShader
      .replace(
        "#include <fog_pars_fragment>",
        /* glsl */ `#include <fog_pars_fragment>
        varying vec3 vHorizonDirection;
        uniform vec3 horizonColors[${SKY_AZIMUTHS}];
        uniform vec2 sunAcross;

        // the horizon's colour in the direction given, interpolated between
        // the azimuths it is known at
        vec3 horizonColor(vec3 direction) {
          vec2 across = direction.xy;
          float azimuth = length(across) > 1e-6
            ? acos(clamp(dot(normalize(across), sunAcross), -1.0, 1.0))
            : 0.0;
          float x = azimuth / 3.141592653589793 * ${SKY_AZIMUTHS - 1}.0;
          int i = int(min(floor(x), ${SKY_AZIMUTHS - 2}.0));
          return mix(horizonColors[i], horizonColors[i + 1], x - float(i));
        }`,
      )
      // three's own fog, as index.js has made it, with the horizon's colour
      // in place of the one fog colour
      .replace("#include <fog_fragment>", ShaderChunk.fog_fragment.replace("fogColor", "horizonColor(vHorizonDirection)"))
  }

  // the same shader for every material using it
  material.customProgramCacheKey = () => "horizonFog"
}
