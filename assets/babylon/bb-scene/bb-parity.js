import { ShaderStore } from '../bb-vendor/babylon.module.js';

// Three-for-Babylon parity patches: three's lighting/fog formulas swapped into Babylon's GLSL includes,
// so differences in the A/B come from the engines, not from mismatched maths. Each patch is a single
// string replace on a pinned Babylon version; a miss logs a warning and leaves Babylon's own formula.
const PATCHES = [
  {
    // Spot cone: three is smoothstep(cos outer, cos inner, cosθ); Babylon's glTF falloff squares the linear ramp.
    include: 'pbrDirectLightingFalloffFunctions',
    from: 'float falloff=saturate(cd*lightAngleScale+lightAngleOffset);falloff*=falloff;return falloff;',
    to: 'float falloff=saturate(cd*lightAngleScale+lightAngleOffset);return falloff*falloff*(3.0-2.0*falloff);',
  },
  {
    // Fog: three uses planar view depth; Babylon uses radial distance (more haze toward the frame edges).
    include: 'fogFragmentDeclaration',
    from: 'float fogDistance=length(vFogDistance);',
    to: 'float fogDistance=abs(vFogDistance.z);',
  },
  {
    // Fog amount: Babylon's PBR shader runs the fog factor through sRGB→linear (thicker haze); three doesn't.
    include: 'fogFragment',
    from: 'fog=toLinearSpace(fog);',
    to: '',
  },
  {
    // Rect-light Fresnel: three's LTC term F0·t2.x + (F90 − F0)·t2.y (Babylon's OpenPBR path uses the same);
    // the standard PBR path weights it by the light colour instead.
    include: 'pbrDirectLightingFunctions',
    from: 'vec3 fresnel=specularColor*info.areaLightFresnel.x*reflectance0+( vec3( 1.0 )-specularColor )*info.areaLightFresnel.y*reflectance90;',
    to: 'vec3 fresnel=reflectance0*info.areaLightFresnel.x+(reflectance90-reflectance0)*info.areaLightFresnel.y;',
  },
  {
    // Reflection blur floor: three's PMREM capture is blurred by σ = 0.04 rad before prefiltering
    // (index.js: fromScene(scene, 0.04, …)), so even mirror-smooth surfaces reflect it soft. Added in quadrature.
    include: 'pbrIBLFunctions',
    from: 'float microsurfaceAverageSlopeTexels=cubeMapDimensionPixels*microsurfaceAverageSlope;',
    to: 'float microsurfaceAverageSlopeTexels=cubeMapDimensionPixels*sqrt(microsurfaceAverageSlope*microsurfaceAverageSlope+0.0016);',
  },
];

export const applyParityPatches = () => PATCHES.forEach(({ include, from, to }) => {
  const source = ShaderStore.IncludesShadersStore[include];
  if (!source?.includes(from)) {
    console.warn(`bb-parity: ${include} not patched (Babylon version changed?)`);
    return;
  }
  ShaderStore.IncludesShadersStore[include] = source.replace(from, to);
});
