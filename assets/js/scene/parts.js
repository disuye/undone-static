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
// Axis is baked into the geometry so at() can still set the mesh rotation without undoing it.
export const prism = (radius, length, sides, material, axis = 'y') => {
  const geometry = new CylinderGeometry(radius, radius, length, sides);
  if (axis === 'z') geometry.rotateX(Math.PI / 2);
  if (axis === 'x') geometry.rotateZ(Math.PI / 2);
  return mesh(geometry, material);
};

export const hose = (points, radius, material, cast = false) => {
  const curve = new CatmullRomCurve3(points.map(([x, y, z]) => new Vector3(x, y, z)));
  return mesh(tube(curve, Math.max(24, points.length * 14), radius), material, { cast });
};

/**
 * Secondary motion for a hose pinned at both ends to one moving link: its middle rides a damped
 * spring, so it lags each hard start, swings past on the stop and settles. Thicker hoses are stiffer.
 */
export const createFlop = (hoseMesh, { damping = 0.16, limit = 0.1 } = {}) => {
  const { geometry } = hoseMesh;
  const { path, radius, tubularSegments, radialSegments } = geometry.parameters;
  const stiffness = 100 + 3000 * radius;
  const friction = 2 * damping * Math.sqrt(stiffness);
  const position = geometry.attributes.position;
  const rest = position.array.slice();
  const ring = radialSegments + 1;
  const weight = Array.from({ length: position.count }, (_, i) => Math.sin(Math.PI * Math.floor(i / ring) / tubularSegments));
  geometry.computeBoundingSphere();
  geometry.boundingSphere.radius += limit;

  const mid = path.getPoint(0.5);
  const anchor = new Vector3();
  const anchorVel = new Vector3();
  const last = new Vector3();
  const p = new Vector3();
  const v = new Vector3();
  const pull = new Vector3();
  const offset = new Vector3();
  let primed = false;

  return (dt) => {
    hoseMesh.localToWorld(anchor.copy(mid));
    if (!primed) {
      p.copy(anchor);
      last.copy(anchor);
      primed = true;
    }
    if (dt <= 0) return;

    anchorVel.subVectors(anchor, last).divideScalar(dt);
    last.copy(anchor);
    pull.subVectors(anchor, p).multiplyScalar(stiffness)
      .addScaledVector(v, -friction).addScaledVector(anchorVel, friction);
    v.addScaledVector(pull, dt);
    p.addScaledVector(v, dt);
    offset.subVectors(p, anchor).clampLength(0, limit);
    p.addVectors(anchor, offset);

    hoseMesh.worldToLocal(offset.copy(p)).sub(mid);
    const a = position.array;
    for (let i = 0; i < position.count; i += 1) {
      a[i * 3] = rest[i * 3] + offset.x * weight[i];
      a[i * 3 + 1] = rest[i * 3 + 1] + offset.y * weight[i];
      a[i * 3 + 2] = rest[i * 3 + 2] + offset.z * weight[i];
    }
    position.needsUpdate = true;
  };
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
 * Hydraulic ram between two anchors in different joint groups: a fixed-length barrel from `from`,
 * a fixed-length rod from `to`, so the rod slides in and out as the joint moves. Meshes live in `parent`.
 * `lengths.barrel` must stay short of the shortest anchor span; barrel + rod must exceed the longest.
 */
export const createPiston = (parent, from, to, barrelMat, rodMat, lengths) => {
  const cylinder = (r, length) => new CylinderGeometry(r, r, length, 8).translate(0, length / 2, 0);
  const barrel = mesh(cylinder(0.045, lengths.barrel), barrelMat);
  const rod = mesh(cylinder(0.02, lengths.rod), rodMat);
  parent.add(barrel, rod);

  const a = new Vector3();
  const b = new Vector3();
  const dir = new Vector3();
  const up = new Vector3(0, 1, 0);
  const q = new Quaternion();

  return () => {
    parent.worldToLocal(from.getWorldPosition(a));
    parent.worldToLocal(to.getWorldPosition(b));
    dir.subVectors(b, a).normalize();
    barrel.position.copy(a);
    barrel.quaternion.copy(q.setFromUnitVectors(up, dir));
    rod.position.copy(b);
    rod.quaternion.copy(q.setFromUnitVectors(up, dir.negate()));
  };
};
