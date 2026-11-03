import { Light, PointLight, Quaternion, Vector3 } from '../bb-vendor/babylon.module.js';
import { smootherstep } from './bb-motion.js';
import { setBasicOpacity, linear } from './bb-materials.js';
import { add, group, mesh, setEuler } from './bb-parts.js';
import { sphere, torus } from './bb-geometry.js';

const RADIUS = 0.5;
const SPREAD = 0.3;
// Seconds: open, held open, close; then closed for the rest of the cycle.
const PHASE = { open: 4.2, held: 3.5, close: 4.2 };
const CYCLE = 24;
// open: peak intensity, kept just under the point where the floor hotspot clips to white.
// ease > 1 makes the light build slowly, so the floor texture reads through most of each ramp.
const LIGHT = { closed: 0.05, open: 16, ease: 2, reach: 12 };

// "Undone": a sphere of eight shells, floating unexplained, that slowly takes itself apart around a lit core.
// The core is a shadow-casting point light, so light escapes in blades through the gaps;
// a dark mechanical liner keeps the shells' insides from flaring under it.
// The light is returned so lab.js can give it a cube shadow map (tier coreShadows).
export const createCore = (m, scene) => {
  const root = group();

  const core = mesh(sphere(0.2, 32, 16), m.glow, { cast: false, receive: false });
  const light = new PointLight('core', Vector3.Zero(), scene);
  light.diffuse = linear(0xfff6ea);
  light.specular = light.diffuse;
  light.intensity = 0;
  light.range = LIGHT.reach;
  light.falloffType = Light.FALLOFF_GLTF;   // three's decay 2 + distance window
  light.shadowMinZ = 0.05;
  light.shadowMaxZ = LIGHT.reach;

  // Energy rings: additive, unshadowed and depth-transparent, so arms pass through them.
  const rings = [0, 1].map((i) => {
    const ring = group(
      mesh(torus(0.82 + i * 0.1, 0.006, 6, 160), m.energy, { cast: false, receive: false }),
      mesh(torus(0.82 + i * 0.1, 0.03, 8, 160), m.energyHalo, { cast: false, receive: false }),
    );
    ring.euler = [Math.PI / 2 + i * 0.5, 0, i * 0.3];
    setEuler(ring, ...ring.euler);
    return ring;
  });

  const shells = [];
  for (let i = 0; i < 4; i += 1) {
    for (let j = 0; j < 2; j += 1) {
      const phi = i * Math.PI / 2;
      const theta = j * Math.PI / 2;
      const mid = { phi: phi + Math.PI / 4, theta: theta + Math.PI / 4 };
      const segment = (r) => sphere(r, 32, 16, phi, Math.PI / 2, theta, Math.PI / 2);
      const shell = mesh(segment(RADIUS), m.shell);
      // three draws the liner BackSide; inside-out geometry is the same surface, front-facing.
      add(shell, mesh(segment(RADIUS - 0.025).flip(), m.liner));
      const dir = new Vector3(
        -Math.cos(mid.phi) * Math.sin(mid.theta),
        Math.cos(mid.theta),
        Math.sin(mid.phi) * Math.sin(mid.theta),
      );
      shell.rotationQuaternion = new Quaternion();
      shells.push({ shell, dir, axis: Vector3.Cross(Vector3.Up(), dir).normalize() });
    }
  }

  add(root, core, light, ...rings, ...shells.map((s) => s.shell));

  const openness = (time) => {
    let t = time % CYCLE;
    if (t < PHASE.open) return smootherstep(t / PHASE.open);
    t -= PHASE.open;
    if (t < PHASE.held) return 1;
    t -= PHASE.held;
    if (t < PHASE.close) return 1 - smootherstep(t / PHASE.close);
    return 0;
  };

  const update = (time) => {
    const a = openness(time);
    shells.forEach(({ shell, dir, axis }) => {
      dir.scaleToRef(a * SPREAD, shell.position);
      Quaternion.RotationAxisToRef(axis, a * 0.35, shell.rotationQuaternion);
    });
    setEuler(rings[0], rings[0].euler[0], rings[0].euler[1], time * 0.08);
    setEuler(rings[1], rings[1].euler[0], -time * 0.05, rings[1].euler[2]);
    light.intensity = LIGHT.closed + a ** LIGHT.ease * LIGHT.open;
    setBasicOpacity(m.energy, 0.45 + a * 0.3 + Math.sin(time * 23) * Math.sin(time * 3.1) * 0.08);
    setBasicOpacity(m.energyHalo, 0.08 + a * 0.08);
  };

  return { object: root, light, update };
};
