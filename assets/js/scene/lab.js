import {
  BoxGeometry, Group, HemisphereLight,
  PlaneGeometry, RectAreaLight, SpotLight, Vector3,
} from '../vendor/three.module.js';
import { aimYaw, createArm } from './arm.js';
import { createClutter } from './clutter.js';
import { createCore } from './core.js';
import { createEquipment } from './equipment.js';
import { createMarkings } from './markings.js';
import { createDust } from './dust.js';
import { createMaterials } from './materials.js';
import { at, block, hose, mesh, plate } from './parts.js';

export const ROOM = { width: 11, height: 5.2, length: 46, near: 9 };
export const CELL = new Vector3(0, 1.65, -6);

const BAY = 6;
const far = ROOM.near - ROOM.length;
const midZ = (ROOM.near + far) / 2;
const still = { cast: false };

const shell = (m) => {
  const { width: w, height: h, length: l } = ROOM;
  return [
    at(mesh(new PlaneGeometry(w, l), m.floor, still), 0, 0, midZ, -Math.PI / 2),
    at(mesh(new PlaneGeometry(w, l), m.ceiling, still), 0, h, midZ, Math.PI / 2),
    ...[-1, 1].map((side) => at(mesh(new PlaneGeometry(l, h), m.wall, still), side * w / 2, h / 2, midZ, 0, -side * Math.PI / 2)),
    at(mesh(new PlaneGeometry(w, h), m.wall, still), 0, h / 2, far),
  ];
};

// Portal frames, ceiling light panels and floor kick-lights, one set per bay.
const bays = (m) => {
  const { width: w, height: h } = ROOM;
  const column = [[-0.25, 0], [0.25, 0], [0.25, h - 0.4], [0.1, h], [-0.25, h]];
  const housing = new BoxGeometry(2.8, 0.06, 1.6);
  const panel = new BoxGeometry(2.6, 0.02, 1.4);
  const beamHousing = new BoxGeometry(1.9, 0.08, 0.32);
  const beamPanel = new BoxGeometry(1.8, 0.02, 0.24);
  const objects = [];

  for (let z = ROOM.near - 3; z > far + 2; z -= BAY) {
    objects.push(
      at(plate(column, 0.7, m.frame, 0.01), -w / 2 + 0.25, 0, z, 0, Math.PI),
      at(plate(column, 0.7, m.frame, 0.01), w / 2 - 0.25, 0, z),
      at(block(w, 0.6, 0.7, m.frame), 0, h - 0.3, z),
    );
    [-2.4, 2.4].forEach((x) => objects.push(
      at(mesh(housing, m.housing, still), x, h - 0.03, z - BAY / 2),
      at(mesh(panel, m.light, still), x, h - 0.07, z - BAY / 2),
    ));
    // Beam-mounted pairs beyond the orb, bright enough to read through the haze.
    if (z < CELL.z - 3) {
      [-2.4, 2.4].forEach((x) => objects.push(
        at(mesh(beamHousing, m.housing, still), x, h - 0.64, z),
        at(mesh(beamPanel, m.beamLight, still), x, h - 0.69, z),
      ));
    }
  }

  const kick = new BoxGeometry(0.04, 0.03, ROOM.length);
  [-1, 1].forEach((side) => objects.push(at(mesh(kick, m.light, still), side * (w / 2 - 0.02), 0.22, midZ)));
  return objects;
};

const lights = () => {
  const { height: h } = ROOM;
  const hemi = new HemisphereLight(0xfffdfa, 0x8f8c84, 0.38);

  const rects = [CELL.z + BAY / 2, CELL.z - BAY / 2].flatMap((z) => [-2.4, 2.4].map((x) => {
    const rect = new RectAreaLight(0xfffcf7, 3, 2.6, 1.4);
    rect.position.set(x, h - 0.1, z);
    rect.lookAt(x, 0, z);
    return rect;
  }));

  const key = new SpotLight(0xfffaf2, 34, 12, 0.62, 0.85, 2);
  key.position.set(0.6, h - 0.15, CELL.z + 0.4);
  key.target.position.copy(CELL).setY(0);
  key.castShadow = true;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;

  return [hemi, ...rects, key, key.target];
};

// Arm placements relative to the work cell; poses lean in toward the core.
const ARMS = [
  {
    at: [-2.7, 0, -5.2], flip: false, timing: { hold: 1.1, offset: 0 },
    poses: [
      [0.1, -0.5, -0.8, -0.6, 0], [-0.25, -0.35, -1.05, -0.4, 1.4],
      [0.3, -0.6, -0.6, -0.9, 0.4], [0, -0.2, -1.2, -0.2, -1],
    ],
  },
  {
    at: [2.8, 0, -6.9], flip: false, timing: { hold: 0.8, offset: 2.1, dip: [0, -0.06, -0.1, -0.12, -1.1] },
    poses: [
      [-0.2, -0.45, -0.9, -0.5, 0.6], [0.2, -0.65, -0.5, -0.8, -0.6],
      [0, -0.3, -1.1, -0.3, 1.8], [-0.35, -0.55, -0.7, -0.7, 0],
    ],
  },
  {
    at: [0.4, ROOM.height - 0.6, -9], flip: true, timing: { hold: 1.4, speed: 0.8, offset: 4.4 },
    poses: [
      [0, -0.35, -0.7, -0.5, 0], [0.4, -0.2, -0.9, -0.3, 1.2],
      [-0.3, -0.5, -0.5, -0.6, -0.8],
    ],
  },
];

const arms = (m) => ARMS.map(({ at: [x, y, z], flip, poses, timing }) => {
  const arm = createArm(m, poses, timing);
  const mount = new Group();
  mount.position.set(x, y, z);
  const dx = CELL.x - x;
  const dz = CELL.z - z;
  const yaw = aimYaw(dx, flip ? -dz : dz);
  arm.object.rotation.y = yaw;
  if (flip) {
    mount.rotation.x = Math.PI;
    mount.add(at(block(0.9, 0.12, 0.9, m.armourGrey), 0, -0.06, 0));
  }
  mount.add(arm.object);
  return {
    object: mount, update: arm.update,
    zone: flip
      ? { x, z, yaw: -yaw, size: 2.6, overhead: true }
      : { x, z, yaw, size: 2.9, overhead: false },
  };
});

export const buildLab = ({ dustCount, coreShadows }) => {
  const m = createMaterials(ROOM);
  const group = new Group();
  const core = createCore(m, { shadows: coreShadows });
  core.object.position.copy(CELL);

  const rigs = arms(m);
  const motes = createDust(dustCount, { width: ROOM.width, height: ROOM.height, near: ROOM.near, depth: 22 });
  const equipment = createEquipment(m, { room: ROOM, cell: CELL, bay: BAY, far });

  group.add(
    ...shell(m), ...bays(m), ...equipment.objects, ...lights(),
    ...createMarkings(rigs.map((r) => r.zone)),
    ...createClutter(m, { room: ROOM, cell: CELL, mounts: rigs.map((r) => r.object.position) }),
    core.object, motes.object, ...rigs.map((r) => r.object),
  );

  const update = (time) => {
    core.update(time);
    equipment.update(time);
    rigs.forEach((r) => r.update(time));
    motes.update(time);
  };

  return { group, update };
};
