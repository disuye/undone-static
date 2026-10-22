import {
  FogExp2, NeutralToneMapping, PCFShadowMap, PerspectiveCamera, PMREMGenerator,
  RectAreaLightUniformsLib, RoomEnvironment, Scene, SRGBColorSpace, Color, Vector3, WebGLRenderer,
} from '../vendor/three.module.js';
import { buildLab, CELL } from './lab.js';
import { createPost } from './post.js';
import { damp } from './motion.js';

// coreShadows: cube-map size for the orb's point light (0 = no shadows; it's 6 extra passes).
const TIERS = {
  high: { pixelRatio: 1.5, dust: 1600, shadowMap: 1024, coreShadows: 512 },
  low: { pixelRatio: 1, dust: 700, shadowMap: 512, coreShadows: 0 },
};

// Filmic cadence: 30fps divides 60/120Hz evenly (24 judders on 60Hz panels) and halves GPU work.
const FPS = 30;
const ENV_PROBE = new Vector3(0, 2.2, -2);
// Haze is a darker shade of the page ground (same hue), so the hall can go low-key.
const HAZE = { shade: 0.32, density: 0.042 };
const STEP = 1 / FPS;

const canvas = document.querySelector('[data-is="scene"]');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const lowSpec = navigator.hardwareConcurrency <= 2 || navigator.deviceMemory <= 2;

// Single source of truth for the ground colour: the CSS token.
const pageTint = () => getComputedStyle(document.documentElement)
  .getPropertyValue('--warmgray-rgb').trim().split(/\s+/).map((v) => Number(v) / 255);

const pickTier = () => {
  const coarse = matchMedia('(pointer: coarse)').matches;
  return coarse || (navigator.hardwareConcurrency ?? 4) < 8 ? 'low' : 'high';
};

const scrollProgress = () => {
  const max = document.documentElement.scrollHeight - innerHeight;
  return max > 0 ? scrollY / max : 0;
};

const createRenderer = () => {
  const renderer = new WebGLRenderer({ canvas, antialias: false, stencil: false, powerPreference: 'high-performance' });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = NeutralToneMapping;
  renderer.toneMappingExposure = 0.85;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  return renderer;
};

const createScene = (renderer, tint, tier) => {
  const scene = new Scene();
  const fog = new Color().setRGB(...tint, SRGBColorSpace).multiplyScalar(HAZE.shade);
  scene.background = fog;
  scene.fog = new FogExp2(fog, HAZE.density);

  // Generic room first (one bounce), then a one-off capture of the lab itself so reflections match it.
  const pmrem = new PMREMGenerator(renderer);
  const seed = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = seed;

  RectAreaLightUniformsLib.init();
  const lab = buildLab({ dustCount: TIERS[tier].dust, coreShadows: TIERS[tier].coreShadows });
  lab.group.traverse((o) => { if (o.isSpotLight) o.shadow.mapSize.setScalar(TIERS[tier].shadowMap); });
  scene.add(lab.group);

  scene.environment = pmrem.fromScene(scene, 0.04, 0.1, 60, { position: ENV_PROBE }).texture;
  scene.environmentIntensity = 0.25;
  seed.dispose();
  pmrem.dispose();
  return { scene, lab };
};

// Camera dollies down the hall with page scroll; pointer adds a little parallax.
// Pointer parallax, metres either side: ±0.9 m sideways ≈ 1.5 floor tiles (1.2 m) edge to edge.
const PARALLAX = { x: 0.9, y: 0.12, lookX: 0.35 };

const createRig = (camera) => {
  const goal = { p: scrollProgress(), x: 0, y: 0 };
  const now = { ...goal };
  const look = new Vector3();

  addEventListener('scroll', () => { goal.p = scrollProgress(); }, { passive: true });
  addEventListener('pointermove', (e) => {
    goal.x = e.clientX / innerWidth * 2 - 1;
    goal.y = e.clientY / innerHeight * 2 - 1;
  }, { passive: true });

  return (time, dt) => {
    now.p = damp(now.p, goal.p, 3, dt);
    now.x = damp(now.x, goal.x, 2, dt);
    now.y = damp(now.y, goal.y, 2, dt);
    const drift = Math.sin(time * 0.05) * 0.25;
    camera.position.set(drift + now.x * PARALLAX.x, 2.6 - now.p * 0.5 - now.y * PARALLAX.y, 8.5 - now.p * 9);
    look.set(now.x * PARALLAX.lookX, 0.85 + now.p * 0.4, CELL.z - 1 - now.p * 4);
    camera.lookAt(look);
    return camera.position.distanceTo(CELL);
  };
};

const boot = () => {
  let tier = pickTier();
  const tint = pageTint();
  const renderer = createRenderer();
  const { scene, lab } = createScene(renderer, tint, tier);
  const camera = new PerspectiveCamera(38, 1, 0.1, 80);
  const rig = createRig(camera);
  let post = createPost(renderer, scene, camera, { tier, tint });

  const resize = () => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    renderer.setPixelRatio(Math.min(devicePixelRatio, TIERS[tier].pixelRatio));
    renderer.setSize(w, h, false);
    post.setPixelRatio(renderer.getPixelRatio());
    post.setSize(w, h);
    camera.aspect = w / h;
    camera.fov = camera.aspect < 1 ? 52 : 38;
    camera.updateProjectionMatrix();
  };

  const draw = (time, dt) => {
    lab.update(time);
    post.render(time, rig(time, dt));
  };

  // Drop post-processing to the cheaper tier once if rendered frames can't keep the cadence.
  let frames = 0;
  let spent = 0;
  const watchFrameRate = (dt) => {
    if (tier === 'low' || frames++ < 15 || frames > 75) return;
    spent += dt;
    if (frames < 75 || spent / 60 < STEP * 1.35) return;
    tier = 'low';
    post.dispose();
    post = createPost(renderer, scene, camera, { tier, tint });
    resize();
  };

  // The display still ticks at its own rate; render on every Nth vsync once STEP has elapsed
  // (60Hz → every 2nd, 120Hz → every 4th) so frames stay evenly paced.
  let last = performance.now();
  let pending = 0;
  const frame = (ms) => {
    pending += Math.min((ms - last) / 1000, 0.25);
    last = ms;
    if (pending < STEP * 0.95) return;
    const dt = pending;
    pending = 0;
    draw(ms / 1000, Math.min(dt, 0.1));
    watchFrameRate(dt);
  };

  resize();
  addEventListener('resize', reducedMotion ? () => { resize(); draw(6, 1); } : resize);
  canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    renderer.setAnimationLoop(null);
    delete canvas.dataset.ready;
  });

  draw(6, 1);
  canvas.dataset.ready = '';
  if (!reducedMotion) renderer.setAnimationLoop(frame);
};

if (canvas && !lowSpec) {
  try { boot(); } catch (error) { console.warn('scene disabled:', error.message); }
}
