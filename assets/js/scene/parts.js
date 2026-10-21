import {
  BoxGeometry, CatmullRomCurve3, Curve, CylinderGeometry, ExtrudeGeometry, Mesh, Quaternion, Shape,
  TubeGeometry, Vector3,
} from '../vendor/three.module.js';

// Spline overshoot can push a tube through the floor; clamp every sample to rest on it.
class FloorClampedCurve extends Curve {
  constructor(curve, radius) {
    super();
    this.curve = curve;
    this.floor = radius + 0.002;
  }

  getPoint(t, target = new Vector3()) {
    this.curve.getPoint(t, target);
    target.y = Math.max(target.y, this.floor);
    return target;
  }
}

const tube = (curve, segments, radius) => new TubeGeometry(new FloorClampedCurve(curve, radius), segments, radius, 6);

// Deterministic randomness so the clutter is the same on every load.
export const rng = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

export const mesh = (geometry, material, { cast = true, receive = true } = {}) => {
  const m = new Mesh(geometry, material);
  m.castShadow = cast;
  m.receiveShadow = receive;
  return m;
};

export const at = (object, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
  object.position.set(x, y, z);
  object.rotation.set(rx, ry, rz);
  return object;
};

/**
 * Angular armour plate: a side profile [[x, y], …] extruded along z, with a single
 * chamfer so edges catch a crisp highlight. Centred on z.
 */
export const plate = (profile, depth, material, chamfer = 0.012) => {
  const shape = new Shape(profile.map(([x, y]) => ({ x, y })));
  const geometry = new ExtrudeGeometry(shape, {
    depth, steps: 1, bevelEnabled: true, bevelSegments: 1,
    bevelThickness: chamfer, bevelSize: chamfer,
  });
  geometry.translate(0, 0, -depth / 2);
  return mesh(geometry, material);
};

export const block = (w, h, d, material) => mesh(new BoxGeometry(w, h, d), material);

// Faceted cylinder: few sides read as machined housings rather than soft plastic.
export const prism = (radius, length, sides, material, axis = 'y') => {
  const m = mesh(new CylinderGeometry(radius, radius, length, sides), material);
  if (axis === 'z') m.rotation.x = Math.PI / 2;
  if (axis === 'x') m.rotation.z = Math.PI / 2;
  return m;
};

export const hose = (points, radius, material, cast = false) => {
  const curve = new CatmullRomCurve3(points.map(([x, y, z]) => new Vector3(x, y, z)));
  return mesh(tube(curve, Math.max(24, points.length * 14), radius), material, { cast });
};

// Sagging cable between two points; `sag` drops the middle, `sway` pushes it sideways.
export const droop = (a, b, sag, sway, radius, material, cast = false) => {
  const mid = a.clone().lerp(b, 0.5).add(sway);
  mid.y -= sag;
  const q1 = a.clone().lerp(mid, 0.5);
  const q3 = mid.clone().lerp(b, 0.5);
  q1.y -= sag * 0.35;
  q3.y -= sag * 0.35;
  const curve = new CatmullRomCurve3([a, q1, mid, q3, b]);
  return mesh(tube(curve, 40, radius), material, { cast });
};

/**
 * Hydraulic ram between two anchors in different joint groups: the barrel grows from `from`,
 * the rod from `to`, so it telescopes as the joint moves. Meshes live in `parent`.
 */
export const createPiston = (parent, from, to, barrelMat, rodMat) => {
  const unitCylinder = (r) => new CylinderGeometry(r, r, 1, 8).translate(0, 0.5, 0);
  const barrel = mesh(unitCylinder(0.045), barrelMat);
  const rod = mesh(unitCylinder(0.02), rodMat);
  parent.add(barrel, rod);

  const a = new Vector3();
  const b = new Vector3();
  const dir = new Vector3();
  const up = new Vector3(0, 1, 0);
  const q = new Quaternion();

  return () => {
    parent.worldToLocal(from.getWorldPosition(a));
    parent.worldToLocal(to.getWorldPosition(b));
    dir.subVectors(b, a);
    const length = dir.length();
    dir.normalize();
    barrel.position.copy(a);
    barrel.quaternion.copy(q.setFromUnitVectors(up, dir));
    barrel.scale.y = length * 0.62;
    rod.position.copy(b);
    rod.quaternion.copy(q.setFromUnitVectors(up, dir.negate()));
    rod.scale.y = length * 0.5;
  };
};
