import { BoxGeometry, Group, InstancedMesh, Matrix4, Vector3 } from '../vendor/three.module.js';
import { at, block, droop, hose, plate, prism, rng } from './parts.js';

// Prototyping-lab mess: overhead cable trays, droops, floor runs, a bench, a cart, an LED panel stand.
export const createClutter = (m, { room, cell, mounts }) => {
  const r = rng(21);
  const pick = (list) => list[Math.floor(r() * list.length)];
  const cable = () => (r() < 0.1 ? m.cables[4] : pick(m.cables.slice(0, 4)));
  const jitter = (s) => (r() - 0.5) * s;
  const trayY = room.height - 0.55;
  const trayZ = [room.near - 1, room.near - 26];
  const trays = [-3.6, 3.3];
  const objects = [];

  // Ladder trays: two rails + instanced rungs.
  const span = trayZ[0] - trayZ[1];
  const rungs = Math.floor(span / 0.45);
  const rungMesh = new InstancedMesh(new BoxGeometry(0.42, 0.02, 0.03), m.mech, rungs * trays.length);
  const mtx = new Matrix4();
  trays.forEach((x, t) => {
    [-0.21, 0.21].forEach((dx) => objects.push(at(block(0.025, 0.07, span, m.mech), x + dx, trayY, trayZ[0] - span / 2)));
    for (let i = 0; i < rungs; i += 1) rungMesh.setMatrixAt(t * rungs + i, mtx.makeTranslation(x, trayY - 0.03, trayZ[0] - i * 0.45));
    for (let k = 0; k < 3; k += 1) {
      const pts = [];
      for (let z = trayZ[0]; z > trayZ[1]; z -= 2) pts.push([x + jitter(0.3), trayY + 0.02, z]);
      objects.push(hose(pts, 0.02 + r() * 0.015, cable()));
    }
  });
  objects.push(rungMesh);

  const trayPoint = (x, z) => new Vector3(x + jitter(0.3), trayY - 0.02, z);

  // Loops sagging out of the trays.
  for (let i = 0; i < 12; i += 1) {
    const x = pick(trays);
    const z = trayZ[0] - r() * (span - 4);
    const a = trayPoint(x, z);
    const b = trayPoint(x, z - 1 - r() * 3);
    objects.push(droop(a, b, 0.3 + r() * 1.1, new Vector3(jitter(0.5), 0, 0), 0.015 + r() * 0.02, cable()));
  }

  // Feeds dropping from a tray to the floor and snaking to a target. The vertical run falls behind
  // the target so it never hangs through the arm working there.
  const drop = (target, cast) => {
    const x = pick(trays);
    const top = trayPoint(x, target.z - 1.5 - r() * 1.5);
    const side = Math.sign(target.x - x) || 1;
    const pts = [
      top.toArray(),
      [top.x + side * 0.2, top.y - 1.4, top.z + jitter(0.4)],
      [top.x + side * 0.35, 0.4, top.z + jitter(0.6)],
      [top.x + side * 0.6, 0.03, top.z + jitter(0.8)],
      [(top.x + target.x) / 2 + jitter(0.8), 0.03, (top.z + target.z) / 2 + jitter(0.8)],
      [target.x, target.y, target.z],
    ];
    objects.push(hose(pts, 0.018 + r() * 0.02, cable(), cast));
  };

  const bases = mounts.filter((p) => p.y < 1);
  const nearestBase = (x) => bases.reduce((a, b) => (Math.abs(b.x - x) < Math.abs(a.x - x) ? b : a));
  const baseInlet = (p, side) => [p.x - side * 0.45 + jitter(0.2), 0.12, p.z + jitter(0.3)];
  bases.forEach((p) => { for (let i = 0; i < 2; i += 1) drop(new Vector3(p.x + jitter(0.6), 0.04, p.z + jitter(0.6)), false); });

  // Floor runs from wall outlets to each arm base, loosely bundled.
  [-1, 1].forEach((side) => {
    const wall = side * (room.width / 2 - 0.05);
    const base = nearestBase(wall);
    const z0 = base.z + 2.2 + jitter(1);
    for (let i = 0; i < 3; i += 1) {
      objects.push(hose([
        [wall, 0.35, z0 + i * 0.08], [wall - side * 0.2, 0.03, z0 + i * 0.1],
        [(wall + base.x) / 2 + jitter(0.4), 0.03, z0 - 0.6 + jitter(0.5)],
        [base.x - side * 0.2 + jitter(0.3), 0.03, base.z + 1.0 + jitter(0.4)],
        baseInlet(base, -side),
      ], 0.014 + r() * 0.012, cable()));
    }
  });

  // Foreground: cables slung across the ceiling and loose ends hanging plumb along the camera's path,
  // so the scroll push travels through them. The ones near centre stay above eye height.
  for (let i = 0; i < 10; i += 1) {
    const z = room.near - 1.5 - r() * 9;
    const a = new Vector3(-1 - r() * 3.5, room.height - 0.05, z);
    const b = new Vector3(0.5 + r() * 3.5, room.height - 0.05, z + jitter(2.5));
    objects.push(droop(a, b, 1.3 + r() * 1.2, new Vector3(0, 0, jitter(1)), 0.012 + r() * 0.025, cable()));
  }
  for (let i = 0; i < 9; i += 1) {
    const x = jitter(6);
    const z = room.near - 1 - r() * 9.5;
    const end = Math.abs(x) < 1 ? 3.1 + r() * 0.7 : 1.7 + r() * 1.6;
    const radius = 0.012 + r() * 0.02;
    objects.push(
      hose([[x, room.height, z], [x, (room.height + end) / 2, z], [x, end, z]], radius, cable()),
      at(block(radius * 3, 0.09, radius * 3, m.mech), x, end - 0.04, z),
    );
  }

  // Overhead arm: umbilicals drooping from the trays to its mount.
  mounts.filter((p) => p.y > 1).forEach((p) => {
    for (let i = 0; i < 3; i += 1) {
      objects.push(droop(trayPoint(pick(trays), p.z + jitter(2)), new Vector3(p.x + jitter(0.2), p.y + 0.2, p.z + jitter(0.2)), 0.5 + r() * 0.6, new Vector3(0, 0, jitter(0.6)), 0.02, cable(), true));
    }
  });

  // Bench along the left wall.
  const bench = { x: -4.35, z: -0.8 };
  objects.push(
    at(block(0.95, 0.05, 2.6, m.armourGrey), bench.x, 0.9, bench.z),
    ...[[-0.4, -1.2], [0.4, -1.2], [-0.4, 1.2], [0.4, 1.2]].map(([dx, dz]) => at(block(0.05, 0.88, 0.05, m.mech), bench.x + dx, 0.44, bench.z + dz)),
    at(block(0.04, 0.5, 0.8, m.mech), bench.x - 0.25, 1.22, bench.z - 0.4, 0, 0.25),
    at(block(0.01, 0.42, 0.72, m.screen), bench.x - 0.225, 1.22, bench.z - 0.4, 0, 0.25),
    at(block(0.4, 0.22, 0.5, m.armour), bench.x + 0.05, 1.04, bench.z + 0.6, 0, -0.2),
    at(block(0.02, 0.02, 0.12, m.neon), bench.x - 0.16, 1.1, bench.z + 0.6, 0, -0.2),
    at(block(0.3, 0.12, 0.3, m.mech), bench.x + 0.1, 0.99, bench.z + 0.05, 0, 0.6),
    at(plate([[0, 0], [0.3, 0], [0.24, 0.18], [0.04, 0.22]], 0.25, m.armourGrey), bench.x - 0.05, 0.93, bench.z + 1.05, 0, 1.1),
  );
  for (let i = 0; i < 3; i += 1) {
    objects.push(hose([[bench.x - 0.2, 0.93, bench.z + jitter(1.5)], [bench.x + 0.3, 0.6, bench.z + jitter(1)], [bench.x + 0.7, 0.03, bench.z + jitter(1.2)], [nearestBase(bench.x).x + 0.3 + jitter(0.5), 0.03, bench.z - 1.5 + jitter(1)], baseInlet(nearestBase(bench.x), -1)], 0.015, cable(), false));
  }

  // Rolling cart, right side.
  const cart = new Vector3(4.0, 0, -2.4);
  [[-0.3, -0.45], [0.3, -0.45], [-0.3, 0.45], [0.3, 0.45]].forEach(([dx, dz]) => objects.push(
    at(block(0.03, 1.0, 0.03, m.mech), cart.x + dx, 0.55, cart.z + dz),
    at(prism(0.05, 0.04, 10, m.cables[0], 'x'), cart.x + dx, 0.05, cart.z + dz),
  ));
  [0.35, 0.95].forEach((y) => objects.push(at(block(0.66, 0.03, 0.96, m.armourGrey), cart.x, y, cart.z)));
  objects.push(
    at(block(0.4, 0.3, 0.5, m.armour), cart.x, 1.12, cart.z - 0.1, 0, 0.15),
    at(block(0.3, 0.18, 0.3, m.mech), cart.x + 0.05, 0.46, cart.z + 0.2),
    at(block(0.02, 0.02, 0.1, m.neon), cart.x - 0.21, 1.2, cart.z - 0.1, 0, 0.15),
  );

  // LED panel on a tripod, aimed at the cell. Legs splay outward: tops meet at the hub, feet on the floor.
  const stand = new Vector3(1.9, 0, -2.6);
  for (let i = 0; i < 3; i += 1) {
    const a = i * Math.PI * 2 / 3 + 0.4;
    objects.push(at(prism(0.012, 0.75, 6, m.mech), stand.x + Math.cos(a) * 0.2, 0.33, stand.z + Math.sin(a) * 0.2, -Math.sin(a) * 0.55, 0, Math.cos(a) * 0.55));
  }
  const head = new Group();
  head.position.set(stand.x, 2.2, stand.z);
  head.rotation.order = 'YXZ';
  head.rotation.set(0.25, Math.atan2(cell.x - stand.x, cell.z - stand.z), 0);
  head.add(
    plate([[-0.3, -0.25], [0.32, -0.28], [0.36, 0.3], [-0.26, 0.24]], 0.08, m.armourGrey),
    at(block(0.54, 0.44, 0.01, m.panel), 0.02, 0.01, 0.055),
  );
  objects.push(
    at(prism(0.03, 0.06, 6, m.mech), stand.x, 0.68, stand.z),
    at(prism(0.018, 1.55, 6, m.mech), stand.x, 1.42, stand.z),
    head,
    hose([[stand.x, 2.1, stand.z], [stand.x + 0.1, 1.2, stand.z + 0.05], [stand.x + 0.4, 0.03, stand.z + 0.3], [-4.9, 0.03, stand.z + 1.5]], 0.012, m.cables[0]),
  );

  return objects;
};
