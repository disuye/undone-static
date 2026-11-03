import {
  Color3, Color4, CubeMapToSphericalPolynomialTools, HDRFiltering, Light, Matrix, PointLight, Quaternion,
  ReflectionProbe, Scene, TargetCamera, Vector3,
} from '../bb-vendor/babylon.module.js';
import { box } from './bb-geometry.js';
import { basic, pbr } from './bb-materials.js';
import { mesh, useScene } from './bb-parts.js';

// Reflections, as three does them: a generic room (RoomEnvironment) lights a one-off cube capture of
// the lab, which then becomes the scene's environment. Both captures are GGX-prefiltered once.

// Timers, not rAF: rAF never fires in a hidden tab, timers still do (throttled), so boot keeps going.
const frame = () => new Promise((resolve) => setTimeout(resolve, 16));
const SIZE = 256;

/** Cube capture at `position` → prefiltered texture with its irradiance (spherical harmonics). */
const capture = async (scene, position, meshes, shadowMaps = []) => {
  const probe = new ReflectionProbe('env', SIZE, scene, true, true, true);
  probe.position.copyFrom(position);
  probe.renderList.push(...meshes);
  const target = probe.cubeTexture;
  while (!target.isReadyForRendering() || shadowMaps.some((s) => !s.isReadyForRendering())) await frame();
  shadowMaps.forEach((s) => s.render());
  target.render();
  // Frozen from here: Babylon re-renders any render-target environment every frame, and would overwrite the prefilter.
  scene.reflectionProbes.splice(scene.reflectionProbes.indexOf(probe), 1);
  target.isRenderTarget = false;
  // The probe flags invertZ for right-handed scenes, which mirrors the lookup front-to-back here
  // (a mirror sphere showed the far end where three shows the open end behind the camera).
  target.invertZ = false;
  await new HDRFiltering(scene.getEngine()).prefilter(target);
  target.sphericalPolynomial = await CubeMapToSphericalPolynomialTools.ConvertCubeMapTextureToSphericalPolynomial(target);
  return { texture: target, dispose: () => probe.dispose() };
};

// three's RoomEnvironment: a lit box room with six blocks and six emissive panels, origin 3.5 m above its floor.
const ROOM_BOXES = [
  [[-10.906, 2.009, 1.846], -0.195, [2.328, 7.905, 4.651]],
  [[-5.607, -0.754, -0.758], 0.994, [1.970, 1.534, 3.955]],
  [[6.167, 0.857, 7.803], 0.561, [3.927, 6.285, 3.687]],
  [[-2.017, 0.018, 6.124], 0.333, [2.002, 4.566, 2.064]],
  [[2.291, -0.756, -2.621], -0.286, [1.546, 1.552, 1.496]],
  [[-2.193, -0.369, -5.547], 0.516, [3.875, 3.487, 2.986]],
];
const ROOM_PANELS = [
  [[-16.116, 14.37, 8.208], [0.1, 2.428, 2.739], 50],
  [[-16.109, 18.021, -8.207], [0.1, 2.425, 2.751], 50],
  [[14.904, 12.198, -1.832], [0.15, 4.265, 6.331], 17],
  [[-0.462, 8.89, 14.520], [4.38, 5.441, 0.088], 43],
  [[3.235, 11.486, -12.541], [2.5, 2.0, 0.1], 20],
  [[0.0, 20.0, 0.0], [1.0, 0.1, 1.0], 100],
];

const roomEnvironment = async (engine) => {
  const scene = new Scene(engine);
  scene.useRightHandedSystem = true;
  scene.clearColor = new Color4(0, 0, 0, 1);
  scene.imageProcessingConfiguration.applyByPostProcess = true;
  const camera = new TargetCamera('room', Vector3.Zero(), scene);
  camera.minZ = 0.1;
  camera.maxZ = 100;
  useScene(scene);

  const y = -3.5;
  const light = new PointLight('room', new Vector3(0.418, 16.199 + y, 0.300), scene);
  light.intensity = 900;
  light.range = 28;
  light.falloffType = Light.FALLOFF_GLTF;

  const unit = box(1, 1, 1);
  const room = mesh(box(1, 1, 1).flip(), pbr({ scene }), { cast: false });
  room.position.set(-0.757, 13.219 + y, 0.717);
  room.scaling.set(31.713, 28.305, 28.591);

  const blocks = mesh(unit, pbr({ scene }), { cast: false });
  const matrices = new Float32Array(ROOM_BOXES.length * 16);
  ROOM_BOXES.forEach(([[px, py, pz], ry, [sx, sy, sz]], i) => Matrix.Compose(
    new Vector3(sx, sy, sz), Quaternion.RotationAxis(Vector3.Up(), ry), new Vector3(px, py + y, pz),
  ).copyToArray(matrices, i * 16));
  blocks.thinInstanceSetBuffer('matrix', matrices, 16, true);

  const panels = ROOM_PANELS.map(([[px, py, pz], [sx, sy, sz], intensity]) => {
    const panel = mesh(unit, basic({ scene, color: new Color3(intensity, intensity, intensity), fogged: false }), { cast: false });
    panel.position.set(px, py + y, pz);
    panel.scaling.set(sx, sy, sz);
    return panel;
  });

  const result = await capture(scene, Vector3.Zero(), [room, blocks, ...panels]);
  return { texture: result.texture, dispose: () => scene.dispose() };
};

/** Seeds the lab with the room, captures the lab from `position`, and leaves that as the environment. */
export const createEnvironment = async (scene, { position, intensity, shadowMaps }) => {
  const labMeshes = scene.meshes.slice();
  const seed = await roomEnvironment(scene.getEngine());
  useScene(scene);
  scene.environmentTexture = seed.texture;
  scene.environmentIntensity = 1;
  const lab = await capture(scene, position, labMeshes, shadowMaps);
  scene.environmentTexture = lab.texture;
  scene.environmentIntensity = intensity;
  seed.dispose();
};
