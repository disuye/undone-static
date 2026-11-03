import { PBRMaterial } from '../bb-vendor/babylon.module.js';
import { plane } from './bb-geometry.js';
import { hazardTexture, pbr } from './bb-materials.js';
import { mesh, setEuler } from './bb-parts.js';

// three: transparent, depthWrite false, polygonOffsetFactor −2. Alpha scales the whole result there,
// specular included, so Babylon's radiance/specular-over-alpha are off.
const paint = (dashed) => {
  const m = pbr({ map: hazardTexture({ dashed }), roughness: 0.55 });
  m.useAlphaFromAlbedoTexture = true;
  m.transparencyMode = PBRMaterial.PBRMATERIAL_ALPHABLEND;
  m.useRadianceOverAlpha = false;
  m.useSpecularOverAlpha = false;
  m.disableDepthWrite = true;
  m.zOffset = -2;
  return m;
};

// Floor-painted keep-out zones sized to each arm's reach, as on an automotive line.
export const createMarkings = (zones) => {
  const solid = paint(false);
  const dashed = paint(true);
  return zones.map(({ x, z, size, yaw, overhead }) => {
    const zone = mesh(plane(size, size), overhead ? dashed : solid, { cast: false, receive: true });
    setEuler(zone, -Math.PI / 2, 0, yaw);
    zone.position.set(x, 0.004, z);
    return zone;
  });
};
