// Ports of the three.js r186 geometry generators the Three scene uses (Box, Plane, Cylinder, Sphere,
// Torus, Tube, Extrude) and its centripetal Catmull-Rom curve. Same vertex order, UVs and normals,
// so both engines draw identical meshes. Right-handed, counter-clockwise front faces.

export class Geo {
  constructor(positions = [], normals = [], uvs = [], indices = null) {
    this.positions = positions;
    this.normals = normals;
    this.uvs = uvs;
    this.indices = indices ?? Array.from({ length: positions.length / 3 }, (_, i) => i);
  }

  // m: row-major 3×3. Normals use the cofactor matrix (inverse transpose up to scale), then renormalise.
  apply(m, t = [0, 0, 0]) {
    const [a, b, c, d, e, f, g, h, i] = m;
    const n = [e * i - f * h, f * g - d * i, d * h - e * g, c * h - b * i, a * i - c * g, b * g - a * h, b * f - c * e, c * d - a * f, a * e - b * d];
    const { positions: p, normals: q } = this;
    for (let k = 0; k < p.length; k += 3) {
      const [x, y, z] = [p[k], p[k + 1], p[k + 2]];
      p[k] = a * x + b * y + c * z + t[0];
      p[k + 1] = d * x + e * y + f * z + t[1];
      p[k + 2] = g * x + h * y + i * z + t[2];
      const [u, v, w] = [q[k], q[k + 1], q[k + 2]];
      const nx = n[0] * u + n[1] * v + n[2] * w;
      const ny = n[3] * u + n[4] * v + n[5] * w;
      const nz = n[6] * u + n[7] * v + n[8] * w;
      const len = Math.hypot(nx, ny, nz) || 1;
      q[k] = nx / len; q[k + 1] = ny / len; q[k + 2] = nz / len;
    }
    return this;
  }

  translate(x, y, z) { return this.apply([1, 0, 0, 0, 1, 0, 0, 0, 1], [x, y, z]); }

  rotateX(r) { const c = Math.cos(r); const s = Math.sin(r); return this.apply([1, 0, 0, 0, c, -s, 0, s, c]); }

  rotateY(r) { const c = Math.cos(r); const s = Math.sin(r); return this.apply([c, 0, s, 0, 1, 0, -s, 0, c]); }

  rotateZ(r) { const c = Math.cos(r); const s = Math.sin(r); return this.apply([c, -s, 0, s, c, 0, 0, 0, 1]); }

  scale(x, y, z) { return this.apply([x, 0, 0, 0, y, 0, 0, 0, z]); }

  // Bakes a texture repeat into the UVs (three's texture.repeat), so one GPU texture serves every surface.
  scaleUV(u, v) {
    for (let k = 0; k < this.uvs.length; k += 2) { this.uvs[k] *= u; this.uvs[k + 1] *= v; }
    return this;
  }

  // Inside-out: for surfaces seen from within (three's BackSide on a closed box).
  flip() {
    for (let k = 0; k < this.indices.length; k += 3) [this.indices[k + 1], this.indices[k + 2]] = [this.indices[k + 2], this.indices[k + 1]];
    for (let k = 0; k < this.normals.length; k += 1) this.normals[k] = -this.normals[k];
    return this;
  }
}

export const box = (width, height, depth) => {
  const geo = new Geo();
  const plane = (u, v, w, udir, vdir, pw, ph, pd) => {
    const base = geo.positions.length / 3;
    for (let iy = 0; iy < 2; iy += 1) {
      for (let ix = 0; ix < 2; ix += 1) {
        const vec = { x: 0, y: 0, z: 0 };
        vec[u] = (ix * pw - pw / 2) * udir;
        vec[v] = (iy * ph - ph / 2) * vdir;
        vec[w] = pd / 2;
        geo.positions.push(vec.x, vec.y, vec.z);
        const nrm = { x: 0, y: 0, z: 0 };
        nrm[w] = pd > 0 ? 1 : -1;
        geo.normals.push(nrm.x, nrm.y, nrm.z);
        geo.uvs.push(ix, 1 - iy);
      }
    }
    const [a, b, c, d] = [base, base + 2, base + 3, base + 1];
    geo.indices.push(a, b, d, b, c, d);
  };
  plane('z', 'y', 'x', -1, -1, depth, height, width);
  plane('z', 'y', 'x', 1, -1, depth, height, -width);
  plane('x', 'z', 'y', 1, 1, width, depth, height);
  plane('x', 'z', 'y', 1, -1, width, depth, -height);
  plane('x', 'y', 'z', 1, -1, width, height, depth);
  plane('x', 'y', 'z', -1, -1, width, height, -depth);
  return geo;
};

export const plane = (width, height) => new Geo(
  [-width / 2, height / 2, 0, width / 2, height / 2, 0, -width / 2, -height / 2, 0, width / 2, -height / 2, 0],
  [0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1],
  [0, 1, 1, 1, 0, 0, 1, 0],
  [0, 2, 1, 2, 3, 1],
);

export const cylinder = (radiusTop, radiusBottom, height, radialSegments = 32, heightSegments = 1, openEnded = false, thetaStart = 0, thetaLength = Math.PI * 2) => {
  const geo = new Geo();
  const { positions, normals, uvs, indices } = geo;
  const half = height / 2;
  const slope = (radiusBottom - radiusTop) / height;
  const grid = [];
  let index = 0;

  for (let y = 0; y <= heightSegments; y += 1) {
    const row = [];
    const v = y / heightSegments;
    const radius = v * (radiusBottom - radiusTop) + radiusTop;
    for (let x = 0; x <= radialSegments; x += 1) {
      const u = x / radialSegments;
      const theta = u * thetaLength + thetaStart;
      const sin = Math.sin(theta);
      const cos = Math.cos(theta);
      positions.push(radius * sin, -v * height + half, radius * cos);
      const len = Math.hypot(sin, slope, cos);
      normals.push(sin / len, slope / len, cos / len);
      uvs.push(u, 1 - v);
      row.push(index++);
    }
    grid.push(row);
  }
  for (let x = 0; x < radialSegments; x += 1) {
    for (let y = 0; y < heightSegments; y += 1) {
      const [a, b, c, d] = [grid[y][x], grid[y + 1][x], grid[y + 1][x + 1], grid[y][x + 1]];
      if (radiusTop > 0 || y !== 0) indices.push(a, b, d);
      if (radiusBottom > 0 || y !== heightSegments - 1) indices.push(b, c, d);
    }
  }

  const cap = (top) => {
    const radius = top ? radiusTop : radiusBottom;
    const sign = top ? 1 : -1;
    const centreStart = index;
    for (let x = 1; x <= radialSegments; x += 1) {
      positions.push(0, half * sign, 0);
      normals.push(0, sign, 0);
      uvs.push(0.5, 0.5);
      index += 1;
    }
    const centreEnd = index;
    for (let x = 0; x <= radialSegments; x += 1) {
      const theta = (x / radialSegments) * thetaLength + thetaStart;
      const cos = Math.cos(theta);
      const sin = Math.sin(theta);
      positions.push(radius * sin, half * sign, radius * cos);
      normals.push(0, sign, 0);
      uvs.push(cos * 0.5 + 0.5, sin * 0.5 * sign + 0.5);
      index += 1;
    }
    for (let x = 0; x < radialSegments; x += 1) {
      const c = centreStart + x;
      const i = centreEnd + x;
      if (top) indices.push(i, i + 1, c);
      else indices.push(i + 1, i, c);
    }
  };
  if (!openEnded) {
    if (radiusTop > 0) cap(true);
    if (radiusBottom > 0) cap(false);
  }
  return geo;
};

export const sphere = (radius, widthSegments = 32, heightSegments = 16, phiStart = 0, phiLength = Math.PI * 2, thetaStart = 0, thetaLength = Math.PI) => {
  const geo = new Geo();
  const thetaEnd = Math.min(thetaStart + thetaLength, Math.PI);
  const grid = [];
  let index = 0;
  for (let iy = 0; iy <= heightSegments; iy += 1) {
    const row = [];
    const v = iy / heightSegments;
    const theta = thetaStart + v * thetaLength;
    const y = radius * Math.cos(theta);
    const ring = Math.sqrt(radius * radius - y * y);
    let uOffset = 0;
    if (iy === 0 && thetaStart === 0) uOffset = 0.5 / widthSegments;
    else if (iy === heightSegments && thetaEnd === Math.PI) uOffset = -0.5 / widthSegments;
    for (let ix = 0; ix <= widthSegments; ix += 1) {
      const u = ix / widthSegments;
      const phi = phiStart + u * phiLength;
      const x = -ring * Math.cos(phi);
      const z = ring * Math.sin(phi);
      geo.positions.push(x, y, z);
      const len = Math.hypot(x, y, z) || 1;
      geo.normals.push(x / len, y / len, z / len);
      geo.uvs.push(u + uOffset, 1 - v);
      row.push(index++);
    }
    grid.push(row);
  }
  for (let iy = 0; iy < heightSegments; iy += 1) {
    for (let ix = 0; ix < widthSegments; ix += 1) {
      const [a, b, c, d] = [grid[iy][ix + 1], grid[iy][ix], grid[iy + 1][ix], grid[iy + 1][ix + 1]];
      if (iy !== 0 || thetaStart > 0) geo.indices.push(a, b, d);
      if (iy !== heightSegments - 1 || thetaEnd < Math.PI) geo.indices.push(b, c, d);
    }
  }
  return geo;
};

export const torus = (radius, tube, radialSegments, tubularSegments, arc = Math.PI * 2) => {
  const geo = new Geo();
  for (let j = 0; j <= radialSegments; j += 1) {
    const v = (j / radialSegments) * Math.PI * 2;
    for (let i = 0; i <= tubularSegments; i += 1) {
      const u = (i / tubularSegments) * arc;
      const x = (radius + tube * Math.cos(v)) * Math.cos(u);
      const y = (radius + tube * Math.cos(v)) * Math.sin(u);
      const z = tube * Math.sin(v);
      geo.positions.push(x, y, z);
      const [nx, ny, nz] = [x - radius * Math.cos(u), y - radius * Math.sin(u), z];
      const len = Math.hypot(nx, ny, nz);
      geo.normals.push(nx / len, ny / len, nz / len);
      geo.uvs.push(i / tubularSegments, j / radialSegments);
    }
  }
  for (let j = 1; j <= radialSegments; j += 1) {
    for (let i = 1; i <= tubularSegments; i += 1) {
      const a = (tubularSegments + 1) * j + i - 1;
      const b = (tubularSegments + 1) * (j - 1) + i - 1;
      const c = (tubularSegments + 1) * (j - 1) + i;
      const d = (tubularSegments + 1) * j + i;
      geo.indices.push(a, b, d, b, c, d);
    }
  }
  return geo;
};

// ---------- curves: points are [x, y, z] ----------

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const normalize = (a) => { const l = Math.hypot(...a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const dist2 = (a, b) => dot(sub(a, b), sub(a, b));

// Rodrigues rotation of v about unit axis k (three's Matrix4.makeRotationAxis applied to a vector).
const rotateAbout = (v, k, theta) => {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const kv = cross(k, v);
  const kd = dot(k, v) * (1 - c);
  return [v[0] * c + kv[0] * s + k[0] * kd, v[1] * c + kv[1] * s + k[1] * kd, v[2] * c + kv[2] * s + k[2] * kd];
};

/** three's Curve base: arc-length parametrised getPointAt/getTangentAt over a getPoint(t). */
export const curve = (getPoint, divisions = 200) => {
  let lengths = null;
  const getLengths = () => {
    if (lengths) return lengths;
    lengths = [0];
    let last = getPoint(0);
    for (let p = 1; p <= divisions; p += 1) {
      const current = getPoint(p / divisions);
      lengths.push(lengths[p - 1] + Math.sqrt(dist2(current, last)));
      last = current;
    }
    return lengths;
  };
  const uToT = (u) => {
    const arc = getLengths();
    const il = arc.length;
    const target = u * arc[il - 1];
    let low = 0;
    let high = il - 1;
    while (low <= high) {
      const i = Math.floor(low + (high - low) / 2);
      const cmp = arc[i] - target;
      if (cmp < 0) low = i + 1;
      else if (cmp > 0) high = i - 1;
      else { high = i; break; }
    }
    const i = high;
    if (arc[i] === target) return i / (il - 1);
    return (i + (target - arc[i]) / (arc[i + 1] - arc[i])) / (il - 1);
  };
  const tangent = (t) => normalize(sub(getPoint(Math.min(t + 0.0001, 1)), getPoint(Math.max(t - 0.0001, 0))));
  return { getPoint, getPointAt: (u) => getPoint(uToT(u)), getTangentAt: (u) => tangent(uToT(u)) };
};

// three's CatmullRomCurve3, open, centripetal.
const cubic = (x0, x1, x2, x3, dt0, dt1, dt2, w) => {
  const t1 = ((x1 - x0) / dt0 - (x2 - x0) / (dt0 + dt1) + (x2 - x1) / dt1) * dt1;
  const t2 = ((x2 - x1) / dt1 - (x3 - x1) / (dt1 + dt2) + (x3 - x2) / dt2) * dt1;
  const c2 = -3 * x1 + 3 * x2 - 2 * t1 - t2;
  const c3 = 2 * x1 - 2 * x2 + t1 + t2;
  return x1 + t1 * w + c2 * w * w + c3 * w * w * w;
};

export const catmullRom = (points) => (t) => {
  const l = points.length;
  const p = (l - 1) * t;
  let int = Math.floor(p);
  let w = p - int;
  if (w === 0 && int === l - 1) { int = l - 2; w = 1; }
  const p0 = int > 0 ? points[int - 1] : sub(points[0], sub(points[1], points[0]));
  const p1 = points[int];
  const p2 = points[int + 1];
  const p3 = int + 2 < l ? points[int + 2] : sub(points[l - 1], sub(points[l - 2], points[l - 1]));
  let dt0 = dist2(p0, p1) ** 0.25;
  let dt1 = dist2(p1, p2) ** 0.25;
  let dt2 = dist2(p2, p3) ** 0.25;
  if (dt1 < 1e-4) dt1 = 1;
  if (dt0 < 1e-4) dt0 = dt1;
  if (dt2 < 1e-4) dt2 = dt1;
  return [0, 1, 2].map((k) => cubic(p0[k], p1[k], p2[k], p3[k], dt0, dt1, dt2, w));
};

// three's TubeGeometry (open): parallel-transport Frenet frames, rings of radialSegments + 1 vertices.
export const tube = (path, tubularSegments, radius, radialSegments) => {
  const tangents = Array.from({ length: tubularSegments + 1 }, (_, i) => path.getTangentAt(i / tubularSegments));
  // Seed axis: the tangent's smallest component; ties go to the later axis, as in three.
  let min = Number.MAX_VALUE;
  let seed;
  tangents[0].forEach((c, k) => { if (Math.abs(c) <= min) { min = Math.abs(c); seed = [0, 0, 0].with(k, 1); } });
  const normals = [cross(tangents[0], normalize(cross(tangents[0], seed)))];
  const binormals = [cross(tangents[0], normals[0])];
  for (let i = 1; i <= tubularSegments; i += 1) {
    let n = normals[i - 1];
    const axis = cross(tangents[i - 1], tangents[i]);
    if (Math.hypot(...axis) > Number.EPSILON) {
      const theta = Math.acos(Math.min(1, Math.max(-1, dot(tangents[i - 1], tangents[i]))));
      n = rotateAbout(n, normalize(axis), theta);
    }
    normals.push(n);
    binormals.push(cross(tangents[i], n));
  }

  const geo = new Geo();
  for (let i = 0; i <= tubularSegments; i += 1) {
    const P = path.getPointAt(i / tubularSegments);
    const N = normals[i];
    const B = binormals[i];
    for (let j = 0; j <= radialSegments; j += 1) {
      const v = (j / radialSegments) * Math.PI * 2;
      const sin = Math.sin(v);
      const cos = -Math.cos(v);
      const n = normalize([cos * N[0] + sin * B[0], cos * N[1] + sin * B[1], cos * N[2] + sin * B[2]]);
      geo.normals.push(...n);
      geo.positions.push(P[0] + radius * n[0], P[1] + radius * n[1], P[2] + radius * n[2]);
      geo.uvs.push(i / tubularSegments, j / radialSegments);
    }
  }
  for (let j = 1; j <= tubularSegments; j += 1) {
    for (let i = 1; i <= radialSegments; i += 1) {
      const a = (radialSegments + 1) * (j - 1) + (i - 1);
      const b = (radialSegments + 1) * j + (i - 1);
      const c = (radialSegments + 1) * j + i;
      const d = (radialSegments + 1) * (j - 1) + i;
      geo.indices.push(a, b, d, b, c, d);
    }
  }
  geo.params = { path, radius, tubularSegments, radialSegments };
  return geo;
};

// ---------- extrude: three's ExtrudeGeometry, one bevel segment, one step, no holes ----------

const area = (pts) => {
  let a = 0;
  for (let p = pts.length - 1, q = 0; q < pts.length; p = q++) a += pts[p][0] * pts[q][1] - pts[q][0] * pts[p][1];
  return a / 2;
};

// three's getBevelVec: per-corner offset that moves both adjoining edges outward by one unit.
const bevelVec = (pt, prev, next) => {
  const [vpx, vpy] = [pt[0] - prev[0], pt[1] - prev[1]];
  const [vnx, vny] = [next[0] - pt[0], next[1] - pt[1]];
  const prevLenSq = vpx * vpx + vpy * vpy;
  const collinear = vpx * vny - vpy * vnx;
  let tx; let ty; let shrink;
  if (Math.abs(collinear) > Number.EPSILON) {
    const prevLen = Math.sqrt(prevLenSq);
    const nextLen = Math.hypot(vnx, vny);
    const psx = prev[0] - vpy / prevLen;
    const psy = prev[1] + vpx / prevLen;
    const nsx = next[0] - vny / nextLen;
    const nsy = next[1] + vnx / nextLen;
    const sf = ((nsx - psx) * vny - (nsy - psy) * vnx) / (vpx * vny - vpy * vnx);
    tx = psx + vpx * sf - pt[0];
    ty = psy + vpy * sf - pt[1];
    const lenSq = tx * tx + ty * ty;
    if (lenSq <= 2) return [tx, ty];
    shrink = Math.sqrt(lenSq / 2);
  } else {
    const same = vpx > Number.EPSILON ? vnx > Number.EPSILON
      : vpx < -Number.EPSILON ? vnx < -Number.EPSILON
        : Math.sign(vpy) === Math.sign(vny);
    if (same) { tx = -vpy; ty = vpx; shrink = Math.sqrt(prevLenSq); } else { tx = vpx; ty = vpy; shrink = Math.sqrt(prevLenSq / 2); }
  }
  return [tx / shrink, ty / shrink];
};

// Ear clipping on a simple polygon; triangles come back in the polygon's own winding.
const triangulate = (pts) => {
  const ccw = area(pts) > 0;
  const idx = pts.map((_, i) => i);
  const tris = [];
  const isConvex = (a, b, c) => {
    const z = (pts[b][0] - pts[a][0]) * (pts[c][1] - pts[a][1]) - (pts[b][1] - pts[a][1]) * (pts[c][0] - pts[a][0]);
    return ccw ? z > 0 : z < 0;
  };
  const inside = (p, a, b, c) => {
    const s = (u, v, w) => (v[0] - u[0]) * (w[1] - u[1]) - (v[1] - u[1]) * (w[0] - u[0]);
    const [d1, d2, d3] = [s(p, a, b), s(p, b, c), s(p, c, a)];
    return !((d1 < 0 || d2 < 0 || d3 < 0) && (d1 > 0 || d2 > 0 || d3 > 0));
  };
  let guard = idx.length * idx.length;
  while (idx.length > 3 && guard-- > 0) {
    for (let i = 0; i < idx.length; i += 1) {
      const [a, b, c] = [idx[(i + idx.length - 1) % idx.length], idx[i], idx[(i + 1) % idx.length]];
      if (!isConvex(a, b, c)) continue;
      if (idx.some((k) => k !== a && k !== b && k !== c && inside(pts[k], pts[a], pts[b], pts[c]))) continue;
      tris.push([a, b, c]);
      idx.splice(i, 1);
      break;
    }
  }
  tris.push(idx);
  return tris;
};

/**
 * Flat-shaded (non-indexed) like three's output. Layers: contour at −chamfer, expanded contour at 0
 * and at depth, contour at depth + chamfer. World UVs, as three's WorldUVGenerator. Centred on z.
 */
export const extrude = (profile, depth, chamfer) => {
  let contour = profile.filter((p, i) => {
    const q = profile[(i + 1) % profile.length];
    return Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-10;
  });
  if (area(contour) >= 0) contour = contour.slice().reverse();   // three works on a clockwise contour
  const n = contour.length;
  const moves = contour.map((p, i) => bevelVec(p, contour[(i + n - 1) % n], contour[(i + 1) % n]));
  const grow = (s) => contour.map((p, i) => [p[0] + moves[i][0] * s, p[1] + moves[i][1] * s]);
  const layers = [[contour, -chamfer], [grow(chamfer), 0], [grow(chamfer), depth], [contour, depth + chamfer]]
    .map(([pts, z]) => pts.map(([x, y]) => [x, y, z]));
  const vert = (layer, i) => layers[layer][i];

  const positions = [];
  const uvs = [];
  const tri = (a, b, c, uv) => { positions.push(...a, ...b, ...c); uvs.push(...uv); };
  // Lids: bottom faces −z, top faces +z.
  triangulate(contour).forEach(([i, j, k]) => {
    const up = area([contour[i], contour[j], contour[k]]) > 0;
    const [a, b, c] = up ? [i, j, k] : [i, k, j];
    const [p, q, r] = [vert(0, c), vert(0, b), vert(0, a)];
    tri(p, q, r, [p[0], p[1], q[0], q[1], r[0], r[1]]);
    const [s, t, u] = [vert(3, a), vert(3, b), vert(3, c)];
    tri(s, t, u, [s[0], s[1], t[0], t[1], u[0], u[1]]);
  });
  // Side walls, three's order: contour walked backwards, one quad per layer band.
  for (let i = n - 1; i >= 0; i -= 1) {
    const j = i;
    const k = i - 1 < 0 ? n - 1 : i - 1;
    for (let s = 0; s < 3; s += 1) {
      const [a, b, c, d] = [vert(s, j), vert(s, k), vert(s + 1, k), vert(s + 1, j)];
      const axis = Math.abs(a[1] - b[1]) < Math.abs(a[0] - b[0]) ? 0 : 1;
      const uv = (p) => [p[axis], 1 - p[2]];
      tri(a, b, d, [...uv(a), ...uv(b), ...uv(d)]);
      tri(b, c, d, [...uv(b), ...uv(c), ...uv(d)]);
    }
  }

  const normals = [];
  for (let k = 0; k < positions.length; k += 9) {
    const [a, b, c] = [positions.slice(k, k + 3), positions.slice(k + 3, k + 6), positions.slice(k + 6, k + 9)];
    const nrm = normalize(cross(sub(c, b), sub(a, b)));
    normals.push(...nrm, ...nrm, ...nrm);
  }
  return new Geo(positions, normals, uvs).translate(0, 0, -depth / 2);
};
