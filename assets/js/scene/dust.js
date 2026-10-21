import {
  AdditiveBlending, BufferAttribute, BufferGeometry, Group, Points, PointsMaterial,
} from '../vendor/three.module.js';
import { dustSprite } from './materials.js';
import { rng } from './parts.js';

// Three depths of airborne dust, each drifting at its own rate, so the camera push reads as parallax.
// share: fraction of the total count; size in world units (attenuated by distance).
const LAYERS = [
  { share: 0.7, size: 0.018, opacity: 0.5, drift: [0.012, 0.03] },
  { share: 0.25, size: 0.035, opacity: 0.35, drift: [-0.02, 0.018] },
  { share: 0.05, size: 0.09, opacity: 0.16, drift: [0.008, -0.012] },
];

export const createDust = (count, { width, height, near, depth }) => {
  const r = rng(13);
  const sprite = dustSprite();
  const group = new Group();

  const layers = LAYERS.map(({ share, size, opacity, drift }) => {
    const n = Math.round(count * share);
    const positions = new Float32Array(n * 3);
    for (let i = 0; i < n; i += 1) {
      positions[i * 3] = (r() - 0.5) * (width - 1);
      positions[i * 3 + 1] = r() * height;
      positions[i * 3 + 2] = near - r() * depth;
    }
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    const points = new Points(geometry, new PointsMaterial({
      map: sprite, size, transparent: true, opacity, depthWrite: false, blending: AdditiveBlending,
    }));
    group.add(points);
    return { points, drift, phase: r() * 10 };
  });

  const update = (time) => layers.forEach(({ points, drift: [dx, dy], phase }) => {
    points.position.x = Math.sin(time * dx * 4 + phase) * 0.4;
    points.position.y = Math.sin(time * dy * 3 + phase) * 0.35;
    points.rotation.y = Math.sin(time * 0.02 + phase) * 0.015;
  });

  return { object: group, update };
};
