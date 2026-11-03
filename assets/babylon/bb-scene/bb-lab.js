import {
  HemisphericLight, Light, RectAreaLight, ShadowGenerator, SpotLight, TransformNode, Vector3,
} from '../bb-vendor/babylon.module.js';
import { aimYaw, createArm } from './bb-arm.js';
import { createClutter } from './bb-clutter.js';
import { createCore } from './bb-core.js';
import { createEquipment } from './bb-equipment.js';
import { createMarkings } from './bb-markings.js';
import { createDust } from './bb-dust.js';
import { CEILING_K, SHEET, createMaterials, kelvin, linear } from './bb-materials.js';
import { add, at, block, group, mesh, useScene } from './bb-parts.js';
import { box, cylinder, extrude, plane } from './bb-geometry.js';

export const ROOM = { width: 11, height: 5.2, length: 46, near: 9 };
export const CELL = new Vector3(0, 1.65, -6);

const BAY = 6;
const far = ROOM.near - ROOM.length;
const midZ = (ROOM.near + far) / 2;
const still = { cast: false };

// three tiles the panel textures with texture.repeat; here the repeat is baked into each surface's UVs.
const tiled = (geo, x, y) => geo.scaleUV(x / SHEET, y / SHEET);

const shell = (m) => {
  const { width: w, height: h, length: l } = ROOM;
  return [
    at(mesh(tiled(plane(w, l), w / 1.2, l / 1.2), m.floor, still), 0, 0, midZ, -Math.PI / 2),
    at(mesh(tiled(plane(w, l), w / 2, l / 2), m.ceiling, still), 0, h, midZ, Math.PI / 2),
    ...[-1, 1].map((side) => at(mesh(tiled(plane(l, h), l / 1.6, h / 2.6), m.wall, still), side * w / 2, h / 2, midZ, 0, -side * Math.PI / 2)),
    at(mesh(plane(w, h), m.lightWall, still), 0, h / 2, far),
    // Recessed floor uplight under the orb.
    at(mesh(cylinder(0.42, 0.42, 0.012, 48), m.housing, still), CELL.x, 0.006, CELL.z),
    at(mesh(cylinder(0.32, 0.32, 0.016, 48), m.tube, still), CELL.x, 0.008, CELL.z),
  ];
};

// Portal frames, ceiling light panels and floor kick-lights, one set per bay.
const bays = (m) => {
  const { width: w, height: h } = ROOM;
  const column = [[-0.25, 0], [0.25, 0], [0.25, h - 0.4], [0.1, h], [-0.25, h]];
  const housing = box(2.8, 0.06, 1.6);
  const panel = box(2.6, 0.02, 1.4);
  const beamHousing = box(1.9, 0.08, 0.32);
  const beamPanel = box(1.8, 0.02, 0.24);
  const columnGeo = extrude(column, 0.7, 0.01);
  const objects = [];

  for (let z = ROOM.near - 3; z > far + 2; z -= BAY) {
    objects.push(
      at(mesh(columnGeo, m.frame), -w / 2 + 0.25, 0, z, 0, Math.PI),
      at(mesh(columnGeo, m.frame), w / 2 - 0.25, 0, z),
      at(block(w, 0.6, 0.7, m.frame), 0, h - 0.3, z),
    );
    [-2.4, 2.4].forEach((x) => objects.push(
      at(mesh(housing, m.housing, still), x, h - 0.03, z - BAY / 2),
      at(mesh(panel, m.tube, still), x, h - 0.07, z - BAY / 2),
    ));
    // Beam-mounted pairs beyond the orb, bright enough to read through the haze.
    if (z < CELL.z - 3) {
      [-2.4, 2.4].forEach((x) => objects.push(
        at(mesh(beamHousing, m.housing, still), x, h - 0.64, z),
        at(mesh(beamPanel, m.beamLight, still), x, h - 0.69, z),
      ));
    }
  }

  const kick = box(0.04, 0.03, ROOM.length);
  [-1, 1].forEach((side) => objects.push(at(mesh(kick, m.tube, still), side * (w / 2 - 0.02), 0.22, midZ)));
  return objects;
};

// Low-key: dim fill, bright tubes, pools of light rather than an evenly lit room.
// hemi is divided by π: three's hemisphere irradiance goes through the Lambert 1/π, Babylon's doesn't.
const LIGHTING = { hemi: 0.05, rect: 1.6, key: 22, uplight: 16 };

// three SpotLight(colour, intensity, distance, angle, penumbra, decay 2) → glTF falloff, full-cone angles.
const spot = (scene, name, position, target, { intensity, distance, angle, penumbra }) => {
  const light = new SpotLight(name, position, target.subtract(position).normalize(), angle * 2, 1, scene);
  light.innerAngle = angle * 2 * (1 - penumbra);
  light.diffuse = kelvin(CEILING_K);
  light.specular = light.diffuse;
  light.intensity = intensity;
  light.range = distance;
  light.falloffType = Light.FALLOFF_GLTF;
  return light;
};

const lights = (scene) => {
  const { height: h } = ROOM;
  const hemi = new HemisphericLight('hemi', Vector3.Up(), scene);
  hemi.diffuse = linear(0xfffdfa);
  hemi.groundColor = linear(0x8f8c84);
  hemi.specular = hemi.diffuse;
  hemi.intensity = LIGHTING.hemi / Math.PI;

  // Emits along local −z; the parent turns that straight down, with the 1.4 m side along z.
  const rects = [CELL.z + BAY / 2, CELL.z - BAY / 2].flatMap((z) => [-2.4, 2.4].map((x) => {
    const mount = new TransformNode('rect', scene);
    mount.position.set(x, h - 0.1, z);
    mount.rotation.x = -Math.PI / 2;
    const rect = new RectAreaLight('rect', Vector3.Zero(), 2.6, 1.4, scene);
    rect.parent = mount;
    rect.diffuse = kelvin(CEILING_K);
    rect.specular = rect.diffuse;
    rect.intensity = LIGHTING.rect;
    return rect;
  }));

  const key = spot(scene, 'key', new Vector3(0.6, h - 0.15, CELL.z + 0.4), new Vector3(CELL.x, 0, CELL.z),
    { intensity: LIGHTING.key, distance: 12, angle: 0.55, penumbra: 0.85 });
  key.shadowMinZ = 0.5;   // three's spot shadow camera: near 0.5, far = distance
  key.shadowMaxZ = 12;

  // Uplight from the floor fixture: unshadowed, narrow enough to stay on the orb.
  const up = spot(scene, 'up', new Vector3(CELL.x, 0.05, CELL.z), new Vector3(CELL.x, CELL.y + 1, CELL.z),
    { intensity: LIGHTING.uplight, distance: 5, angle: 0.42, penumbra: 0.7 });

  return { hemi, rects, key, up };
};

// Arm placements relative to the work cell; poses lean in toward the core.
// The right arm also works under the orb, reaching up at 50°; its CLEAR via tucks the arm
// back so the swap between topside and underside work doesn't sweep through it.
const CLEAR = { via: [0, 0.25, -1.4, 1, 0] };
const UNDER_DIP = [0, 0.03, 0.14, -0.17, -0.9];

const ARMS = [
  {
    at: [-2.7, 0, -5.2], flip: false, timing: { hold: 0.95, strokes: 3, offset: 0 },
    poses: [
      [0.1, -0.5, -0.8, -0.6, 0], [-0.25, -0.35, -1.05, -0.4, 1.4],
      [0.3, -0.6, -0.6, -0.9, 0.4], [0, -0.2, -1.2, -0.2, -1],
    ],
  },
  {
    at: [2.8, 0, -6.9], flip: false, timing: { hold: 0.6, strokes: 4, offset: 2.1, dip: [0, -0.04, -0.06, -0.12, -1.1] },
    poses: [
      [-0.2, -0.45, -0.9, -0.5, 0.6], [0, -0.3, -1.1, -0.3, 1.8], [-0.35, -0.55, -0.7, -0.7, 0],
      CLEAR,
      { pose: [0.15, -1.06, -1.52, 1.88, 0], dip: UNDER_DIP },
      { pose: [-0.15, -1.06, -1.52, 1.88, 0], dip: UNDER_DIP },
      CLEAR,
    ],
  },
  {
    at: [0.4, ROOM.height - 0.6, -9], flip: true, timing: { hold: 0.8, strokes: 3, speed: 0.5, offset: 4.4 },
    poses: [
      [0, -0.35, -0.7, -0.5, 0], [0.4, -0.2, -0.9, -0.3, 1.2],
      [-0.3, -0.5, -0.5, -0.6, -0.8],
    ],
  },
];

const arms = (m) => ARMS.map(({ at: [x, y, z], flip, poses, timing }) => {
  const arm = createArm(m, poses, timing);
  const mount = group();
  mount.position.set(x, y, z);
  const yaw = aimYaw(CELL.x - x, flip ? -(CELL.z - z) : CELL.z - z);
  arm.object.rotation.y = yaw;
  if (flip) {
    mount.rotation.x = Math.PI;
    add(mount, at(block(0.9, 0.12, 0.9, m.armShellGrey), 0, -0.06, 0));
  }
  add(mount, arm.object);
  return {
    object: mount, update: arm.update,
    zone: flip
      ? { x, z, yaw: -yaw, size: 2.6, overhead: true }
      : { x, z, yaw, size: 2.9, overhead: false },
  };
});

// three: castShadow meshes go into every shadow-casting light's map; it renders back faces (shadowSide).
const shadows = (scene, lab, { shadowMap, coreShadows }) => {
  const casters = scene.meshes.filter((mm) => mm.metadata?.cast);
  const key = new ShadowGenerator(shadowMap, lab.key);
  key.usePercentageCloserFiltering = true;
  key.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;
  key.forceBackFacesOnly = true;
  key.bias = 0.0004;
  key.normalBias = 0.02;
  casters.forEach((c) => key.addShadowCaster(c, false));
  if (!coreShadows) return;
  const core = new ShadowGenerator(coreShadows, lab.core);
  core.usePoissonSampling = true;   // Babylon has no PCF for cube shadow maps
  core.forceBackFacesOnly = true;
  core.bias = 0.002;
  core.normalBias = 0.01;
  casters.forEach((c) => core.addShadowCaster(c, false));
};

export const buildLab = (scene, { dustCount, coreShadows, shadowMap, haze }) => {
  useScene(scene);
  const m = createMaterials(scene, haze);
  const core = createCore(m, scene);
  core.object.position.copyFrom(CELL);

  const rigs = arms(m);
  const motes = createDust(dustCount, { width: ROOM.width, height: ROOM.height, near: ROOM.near, depth: 22 }, { scene, fog: haze });
  const equipment = createEquipment(m, { room: ROOM, cell: CELL, bay: BAY, far });
  const light = lights(scene);

  const root = group(
    ...shell(m), ...bays(m), ...equipment.objects,
    ...createMarkings(rigs.map((r) => r.zone)),
    ...createClutter(m, { room: ROOM, cell: CELL, mounts: rigs.map((r) => r.object.position) }),
    core.object, motes.object, ...rigs.map((r) => r.object),
  );
  shadows(scene, { key: light.key, core: core.light }, { shadowMap, coreShadows });

  const update = (time) => {
    core.update(time);
    equipment.update(time);
    rigs.forEach((r) => r.update(time));
    motes.update(time);
  };

  return { root, update, motes };
};
