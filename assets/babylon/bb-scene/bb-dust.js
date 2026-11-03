import { Constants, ShaderMaterial, ShaderStore } from '../bb-vendor/babylon.module.js';
import { group, mesh, rng, setEuler } from './bb-parts.js';
import { Geo } from './bb-geometry.js';

// Three depths of airborne dust, each drifting at its own rate, so the camera push reads as parallax.
// share: fraction of the total count; size in world units (attenuated by distance).
const LAYERS = [
  { share: 0.7, size: 0.018, opacity: 0.5, drift: [0.012, 0.03] },
  { share: 0.25, size: 0.035, opacity: 0.35, drift: [-0.02, 0.018] },
  { share: 0.05, size: 0.09, opacity: 0.16, drift: [0.008, -0.012] },
];

// three's PointsMaterial: size × (half drawing-buffer height / view depth), round soft sprite, additive, fogged.
// The sprite is three's 64 px radial gradient, evaluated in the shader instead of sampled.
ShaderStore.ShadersStore.bbDustVertexShader = /* glsl */ `
  precision highp float;
  attribute vec3 position;
  uniform mat4 world, view, projection;
  uniform float size, scale;
  varying float vFogDepth;
  void main() {
    vec4 mv = view * world * vec4(position, 1.0);
    vFogDepth = abs(mv.z);
    gl_Position = projection * mv;
    gl_PointSize = size * (scale / vFogDepth);
  }`;

ShaderStore.ShadersStore.bbDustFragmentShader = /* glsl */ `
  precision highp float;
  uniform float opacity;
  uniform vec3 fogColor;
  uniform float fogDensity;
  varying float vFogDepth;
  void main() {
    float a = max(0.0, 1.0 - 2.0 * length(gl_PointCoord - 0.5));
    vec3 c = mix(vec3(1.0), fogColor, 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth));
    gl_FragColor = vec4(c, a * opacity);
  }`;

export const createDust = (count, { width, height, near, depth }, { scene, fog }) => {
  const r = rng(13);
  const root = group();

  const layers = LAYERS.map(({ share, size, opacity, drift }) => {
    const n = Math.round(count * share);
    const positions = new Float32Array(n * 3);
    for (let i = 0; i < n; i += 1) {
      positions[i * 3] = (r() - 0.5) * (width - 1);
      positions[i * 3 + 1] = r() * height;
      positions[i * 3 + 2] = near - r() * depth;
    }
    const material = new ShaderMaterial('dust', scene, 'bbDust', {
      attributes: ['position'],
      uniforms: ['world', 'view', 'projection', 'size', 'scale', 'opacity', 'fogColor', 'fogDensity'],
      needAlphaBlending: true,
    });
    material.pointsCloud = true;
    material.alphaMode = Constants.ALPHA_ADD;
    material.disableDepthWrite = true;
    material.setFloat('size', size);
    material.setFloat('opacity', opacity);
    material.setColor3('fogColor', fog.color);
    material.setFloat('fogDensity', fog.density);
    const points = mesh(new Geo(Array.from(positions)), material, { cast: false, receive: false });
    points.parent = root;
    return { points, material, drift, phase: r() * 10 };
  });

  const update = (time) => layers.forEach(({ points, drift: [dx, dy], phase }) => {
    points.position.x = Math.sin(time * dx * 4 + phase) * 0.4;
    points.position.y = Math.sin(time * dy * 3 + phase) * 0.35;
    setEuler(points, 0, Math.sin(time * 0.02 + phase) * 0.015, 0);
  });

  // Point size is in pixels, so it tracks the drawing-buffer height (three's `scale` uniform).
  const setSize = (bufferHeight) => layers.forEach(({ material }) => material.setFloat('scale', bufferHeight / 2));
  const setFog = (color, density) => layers.forEach(({ material }) => {
    material.setColor3('fogColor', color);
    material.setFloat('fogDensity', density);
  });

  return { object: root, update, setSize, setFog };
};

