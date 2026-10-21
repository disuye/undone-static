import { CylinderGeometry, Group, SphereGeometry, TorusGeometry } from '../vendor/three.module.js';
import { at, block, hose, mesh, rng } from './parts.js';

// Square/rectangular horn: a 4-sided open cone, mouth facing local +x.
const horn = (mouth, throat, length, material, widen = 1) => {
  const geometry = new CylinderGeometry(mouth, throat, length, 4, 1, true)
    .rotateY(Math.PI / 4)
    .rotateZ(-Math.PI / 2)
    .scale(1, 1, widen);
  return mesh(geometry, material);
};

/**
 * Club-style horn-loaded stack, front facing local +x: bass driver, square mid horn,
 * wide HF horn. Generic touring-rig vocabulary, weathered like everything else.
 */
const speaker = (m) => {
  const g = new Group();
  const front = 0.4;
  const cone = mesh(new CylinderGeometry(0.36, 0.1, 0.16, 28, 1, true).rotateZ(-Math.PI / 2), m.horn);
  const cap = mesh(new SphereGeometry(0.09, 16, 8).scale(0.4, 1, 1), m.mech);
  const surround = mesh(new TorusGeometry(0.37, 0.022, 6, 32).rotateY(Math.PI / 2), m.mech);
  g.add(
    at(block(0.8, 2.5, 1.0, m.armour), -0.02, 1.25),
    ...[-1, 1].map((s) => at(block(0.86, 2.56, 0.06, m.armourGrey), 0, 1.28, s * 0.53)),
    at(block(0.86, 0.06, 1.12, m.armourGrey), 0, 1.07),
    at(block(0.86, 0.06, 1.12, m.armourGrey), 0, 1.95),
    at(block(0.9, 0.1, 1.14, m.mech), 0, 0.05),
    at(cone, front - 0.08, 0.6), at(cap, front - 0.15, 0.6), at(surround, front, 0.6),
    at(horn(0.48, 0.08, 0.45, m.horn), front - 0.225, 1.51),
    at(horn(0.2, 0.04, 0.22, m.horn, 1.7), front - 0.11, 2.22),
  );
  return g;
};

// Unsynchronised status lights: slow breathing, sharp periodic pulses, or a failing flicker.
const blinker = (r) => {
  const kind = r();
  const period = 2 + r() * 6;
  const phase = r() * 20;
  const rate = 0.3 + r() * 1.2;
  if (kind < 0.45) return (t) => 0.2 + 0.8 * (0.5 + 0.5 * Math.sin((t + phase) * rate));
  if (kind < 0.85) return (t) => 0.12 + 0.88 * Math.exp(-((t + phase) % period) * 4);
  return (t) => {
    const n = Math.sin(Math.floor((t + phase) * 9) * 12.9898) * 43758.5453;
    return n - Math.floor(n) > 0.82 ? 0.15 : 1;
  };
};

// Cabinets along the walls; roughly half are PA stacks, the rest equipment with status lights.
export const createEquipment = (m, { room, cell, bay, far }) => {
  const r = rng(5);
  const objects = [];
  const lights = [];

  [-1, 1].forEach((side) => {
    for (let z = room.near - 6; z > far + 3; z -= 3.1) {
      const nearFrame = Math.abs(((z - (room.near - 3)) % bay + bay) % bay) < 0.9;
      if (Math.abs(z - cell.z) < 3 || nearFrame) continue;

      if (r() < 0.5) {
        const stack = speaker(m);
        stack.position.set(side * (room.width / 2 - 0.5), 0, z);
        stack.rotation.y = side > 0 ? Math.PI : 0;
        objects.push(stack);
        continue;
      }

      const tall = 1.6 + r() * 0.9;
      const x = side * (room.width / 2 - 0.55);
      const neon = r() > 0.8;
      const led = neon ? m.neon : m.light.clone();
      const base = led.color.clone();
      objects.push(
        at(block(0.9, tall, 1.3, m.armour), x, tall / 2, z),
        at(block(0.02, 0.04, 0.7, led), x - side * 0.46, tall - 0.25, z),
        at(block(0.02, 0.04, 0.2, led), x - side * 0.46, tall - 0.4, z + 0.25),
        hose([[x, tall, z + 0.3], [x - side * 0.2, tall + 0.6, z + 0.5], [x - side * 0.1, room.height - 0.6, z + 0.2]], 0.02, m.cables[Math.floor(r() * 3)]),
      );
      if (!neon) lights.push({ material: led, base, level: blinker(r) });
    }
  });

  const update = (time) => lights.forEach(({ material, base, level }) => {
    material.color.copy(base).multiplyScalar(level(time));
  });

  return { objects, update };
};
