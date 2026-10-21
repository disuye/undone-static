import { Mesh, MeshStandardMaterial, PlaneGeometry } from '../vendor/three.module.js';
import { hazardTexture } from './materials.js';

const paint = (dashed) => new MeshStandardMaterial({
  map: hazardTexture({ dashed }), transparent: true, depthWrite: false, roughness: 0.55,
  polygonOffset: true, polygonOffsetFactor: -2,
});

// Floor-painted keep-out zones sized to each arm's reach, as on an automotive line.
export const createMarkings = (zones) => {
  const solid = paint(false);
  const dashed = paint(true);
  return zones.map(({ x, z, size, yaw, overhead }) => {
    const zone = new Mesh(new PlaneGeometry(size, size), overhead ? dashed : solid);
    zone.rotation.set(-Math.PI / 2, 0, yaw);
    zone.position.set(x, 0.004, z);
    zone.receiveShadow = true;
    return zone;
  });
};
