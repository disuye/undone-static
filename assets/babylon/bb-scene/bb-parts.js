import {
  BoundingInfo, Geometry, Material, Matrix, Mesh, Quaternion, TransformNode, Vector3, VertexBuffer, VertexData,
} from '../bb-vendor/babylon.module.js';
import { box, catmullRom, curve, cylinder, extrude, tube } from './bb-geometry.js';

// Every node below is created in this scene (set once by buildLab; Babylon otherwise picks the last scene made).
let scene = null;
export const useScene = (s) => { scene = s; };

// Deterministic randomness so the clutter is the same on every load.
export const rng = (seed) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

// Babylon has no Group: a TransformNode is the empty parent.
export const group = (...children) => add(new TransformNode('group', scene), ...children);
export const add = (parent, ...children) => {
  children.forEach((c) => { c.parent = parent; });
  return parent;
};

// three's default Euler order (XYZ) as a quaternion, so ported rotations match exactly.
// Babylon's own .rotation vector is three's 'YXZ' order.
export const setEuler = (node, x = 0, y = 0, z = 0) => {
  const [c1, c2, c3] = [Math.cos(x / 2), Math.cos(y / 2), Math.cos(z / 2)];
  const [s1, s2, s3] = [Math.sin(x / 2), Math.sin(y / 2), Math.sin(z / 2)];
  node.rotationQuaternion ??= new Quaternion();
  node.rotationQuaternion.set(
    s1 * c2 * c3 + c1 * s2 * s3,
    c1 * s2 * c3 - s1 * c2 * s3,
    c1 * c2 * s3 + s1 * s2 * c3,
    c1 * c2 * c3 - s1 * s2 * s3,
  );
  return node;
};

export const at = (node, x = 0, y = 0, z = 0, rx = 0, ry = 0, rz = 0) => {
  node.position.set(x, y, z);
  return setEuler(node, rx, ry, rz);
};

// One GPU geometry per Geo, so meshes built from the same Geo share buffers (as three meshes share a BufferGeometry).
const geometries = new WeakMap();
let ids = 0;

/** cast/receive mirror three's castShadow/receiveShadow; lab.js hands casters to the shadow generators. */
export const mesh = (geo, material, { cast = true, receive = true, updatable = false } = {}) => {
  const m = new Mesh('mesh', scene);
  let geometry = geometries.get(geo);
  if (!geometry) {
    const data = Object.assign(new VertexData(), { positions: geo.positions, indices: geo.indices });
    if (geo.normals.length) data.normals = geo.normals;
    if (geo.uvs.length) data.uvs = geo.uvs;
    geometry = new Geometry(`geo${ids++}`, scene, data, updatable);
    geometries.set(geo, geometry);
  }
  geometry.applyToMesh(m);
  m.sideOrientation = Material.CounterClockWiseSideOrientation;   // three's winding (Babylon's RH default is CW)
  m.material = material;
  m.receiveShadows = receive;
  m.metadata = { cast, geo };
  return m;
};

// Babylon caches world matrices per render; rigs read them mid-update, so recompute the chain top-down.
export const syncWorld = (node) => {
  const chain = [];
  for (let n = node; n; n = n.parent) chain.push(n);
  for (let i = chain.length - 1; i >= 0; i -= 1) chain[i].computeWorldMatrix(true);
  return node.getWorldMatrix();
};

/**
 * Angular armour plate: a side profile [[x, y], …] extruded along z, with a single
 * chamfer so edges catch a crisp highlight. Centred on z.
 */
export const plate = (profile, depth, material, chamfer = 0.012) => mesh(extrude(profile, depth, chamfer), material);

export const block = (w, h, d, material) => mesh(box(w, h, d), material);

// Faceted cylinder: few sides read as machined housings rather than soft plastic.
// Axis is baked into the geometry so at() can still set the mesh rotation without undoing it.
export const prism = (radius, length, sides, material, axis = 'y') => {
  const geo = cylinder(radius, radius, length, sides);
  if (axis === 'z') geo.rotateX(Math.PI / 2);
  if (axis === 'x') geo.rotateZ(Math.PI / 2);
  return mesh(geo, material);
};

// Spline overshoot can push a tube through the floor; clamp every sample to rest on it.
const floorClamped = (points, radius) => {
  const spline = catmullRom(points);
  const floor = radius + 0.002;
  return curve((t) => { const p = spline(t); p[1] = Math.max(p[1], floor); return p; });
};

const tubeMesh = (points, segments, radius, material, cast, updatable) => mesh(tube(floorClamped(points, radius), segments, radius, 6), material, { cast, updatable });

export const hose = (points, radius, material, cast = false, { updatable = false } = {}) => tubeMesh(points, Math.max(24, points.length * 14), radius, material, cast, updatable);

/**
 * Secondary motion for a hose pinned at both ends to one moving link: its middle rides a damped
 * spring, so it lags each hard start, swings past on the stop and settles. Thicker hoses are stiffer.
 */
export const createFlop = (hoseMesh, { damping = 0.16, limit = 0.1 } = {}) => {
  const { geo } = hoseMesh.metadata;
  const { path, radius, tubularSegments, radialSegments } = geo.params;
  const stiffness = 100 + 3000 * radius;
  const friction = 2 * damping * Math.sqrt(stiffness);
  const rest = Float32Array.from(geo.positions);
  const out = new Float32Array(rest);
  const ring = radialSegments + 1;
  const weight = Float32Array.from({ length: rest.length / 3 }, (_, i) => Math.sin(Math.PI * Math.floor(i / ring) / tubularSegments));
  const { minimum, maximum } = hoseMesh.getBoundingInfo();
  const pad = new Vector3(limit, limit, limit);
  hoseMesh.setBoundingInfo(new BoundingInfo(minimum.subtract(pad), maximum.add(pad)));

  const mid = Vector3.FromArray(path.getPoint(0.5));
  const anchor = new Vector3();
  const anchorVel = new Vector3();
  const last = new Vector3();
  const p = new Vector3();
  const v = new Vector3();
  const pull = new Vector3();
  const offset = new Vector3();
  const inverse = new Matrix();
  let primed = false;

  return (dt) => {
    const world = syncWorld(hoseMesh);
    Vector3.TransformCoordinatesToRef(mid, world, anchor);
    if (!primed) {
      p.copyFrom(anchor);
      last.copyFrom(anchor);
      primed = true;
    }
    if (dt <= 0) return;

    anchor.subtractToRef(last, anchorVel).scaleInPlace(1 / dt);
    last.copyFrom(anchor);
    anchor.subtractToRef(p, pull).scaleInPlace(stiffness);
    v.scaleAndAddToRef(-friction, pull);
    anchorVel.scaleAndAddToRef(friction, pull);
    pull.scaleAndAddToRef(dt, v);
    v.scaleAndAddToRef(dt, p);
    p.subtractToRef(anchor, offset);
    const len = offset.length();
    if (len > limit) offset.scaleInPlace(limit / len);
    anchor.addToRef(offset, p);

    world.invertToRef(inverse);
    Vector3.TransformCoordinatesToRef(p, inverse, offset).subtractInPlace(mid);
    for (let i = 0; i < weight.length; i += 1) {
      out[i * 3] = rest[i * 3] + offset.x * weight[i];
      out[i * 3 + 1] = rest[i * 3 + 1] + offset.y * weight[i];
      out[i * 3 + 2] = rest[i * 3 + 2] + offset.z * weight[i];
    }
    hoseMesh.updateVerticesData(VertexBuffer.PositionKind, out, false, false);
  };
};

// Sagging cable between two points [x, y, z]; `sag` drops the middle, `sway` pushes it sideways.
export const droop = (a, b, sag, sway, radius, material, cast = false) => {
  const lerp = (p, q) => p.map((x, k) => x + (q[k] - x) * 0.5);
  const mid = lerp(a, b).map((x, k) => x + sway[k]);
  mid[1] -= sag;
  const q1 = lerp(a, mid);
  const q3 = lerp(mid, b);
  q1[1] -= sag * 0.35;
  q3[1] -= sag * 0.35;
  return tubeMesh([a, q1, mid, q3, b], 40, radius, material, cast, false);
};

/**
 * Hydraulic ram between two anchors in different joint groups: a fixed-length barrel from `from`,
 * a fixed-length rod from `to`, so the rod slides in and out as the joint moves. Meshes live in `parent`.
 * `lengths.barrel` must stay short of the shortest anchor span; barrel + rod must exceed the longest.
 */
export const createPiston = (parent, from, to, barrelMat, rodMat, lengths) => {
  const cylinderUp = (r, length) => cylinder(r, r, length, 8).translate(0, length / 2, 0);
  const barrel = mesh(cylinderUp(0.045, lengths.barrel), barrelMat);
  const rod = mesh(cylinderUp(0.02, lengths.rod), rodMat);
  add(parent, barrel, rod);
  barrel.rotationQuaternion = new Quaternion();
  rod.rotationQuaternion = new Quaternion();

  const inverse = new Matrix();
  const a = new Vector3();
  const b = new Vector3();
  const dir = new Vector3();
  const back = new Vector3();
  const world = new Vector3();
  const up = Vector3.Up();
  const local = (node, out) => Vector3.TransformCoordinatesToRef(syncWorld(node).getTranslationToRef(world), inverse, out);

  return () => {
    syncWorld(parent).invertToRef(inverse);
    local(from, a);
    local(to, b);
    b.subtractToRef(a, dir).normalize();
    barrel.position.copyFrom(a);
    Quaternion.FromUnitVectorsToRef(up, dir, barrel.rotationQuaternion);
    rod.position.copyFrom(b);
    Quaternion.FromUnitVectorsToRef(up, dir.scaleToRef(-1, back), rod.rotationQuaternion);
  };
};
