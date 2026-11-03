import {
  Color3, Color4, Engine, ImageProcessingConfiguration, Scene, TargetCamera, Tools, Vector3,
} from '../bb-vendor/babylon.module.js';
import { applyParityPatches } from './bb-parity.js';
import { createEnvironment } from './bb-env.js';
import { buildLab, CELL } from './bb-lab.js';
import { createPost } from './bb-post.js';
import { damp } from './bb-motion.js';

// assets/js/scene/index.js on Babylon.js: same tiers, cadence, haze, rig and 3D switch.

// RectAreaLight's LTC table ships in bb-vendor/ instead of coming from Babylon's CDN.
Tools.AssetBaseUrl = new URL('../bb-vendor/', import.meta.url).href;
applyParityPatches();

// coreShadows: cube-map size for the orb's point light (0 = no shadows; it's 6 extra passes).
const TIERS = {
  high: { pixelRatio: 1.5, dust: 1600, shadowMap: 1024, coreShadows: 512 },
  low: { pixelRatio: 1, dust: 700, shadowMap: 512, coreShadows: 0 },
};

// Filmic cadence: 30fps divides 60/120Hz evenly (24 judders on 60Hz panels) and halves GPU work.
const FPS = 30;
const STEP = 1 / FPS;

// Haze is a darker shade of the page ground (same hue), so the hall can go low-key.
const HAZE = { shade: 0.32, density: 0.042 };
// Where the one-off reflection capture is taken: between the camera path and the orb.
const ENV_PROBE = new Vector3(0, 2.2, -2);

const canvas = document.querySelector('[data-is="scene"]');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const lowSpec = navigator.hardwareConcurrency <= 2 || navigator.deviceMemory <= 2;
const params = new URLSearchParams(location.search);
const DEBUG = params.has('debug');   // test hooks: bb-debug.js

// Single source of truth for the ground colour: the CSS token.
const pageTint = () => getComputedStyle(document.documentElement)
  .getPropertyValue('--warmgray-rgb').trim().split(/\s+/).map((v) => Number(v) / 255);

const pickTier = () => {
  if (DEBUG && TIERS[params.get('tier')]) return params.get('tier');
  const coarse = matchMedia('(pointer: coarse)').matches;
  return coarse || (navigator.hardwareConcurrency ?? 4) < 8 ? 'low' : 'high';
};

const scrollProgress = () => {
  const max = document.documentElement.scrollHeight - innerHeight;
  return max > 0 ? scrollY / max : 0;
};

// three: WebGLRenderer({ antialias: false, stencil: false }), NeutralToneMapping, exposure 0.85, sRGB out.
const createEngine = () => new Engine(canvas, false, {
  stencil: false, alpha: false, powerPreference: 'high-performance', useExactSrgbConversions: true, adaptToDeviceRatio: false,
}, false);

const createScene = (engine, tint) => {
  const scene = new Scene(engine);
  scene.useRightHandedSystem = true;   // three's coordinates, rotations and winding carry over unchanged
  scene.skipPointerMovePicking = true;
  const fog = Color3.FromArray(tint).toLinearSpace(true).scale(HAZE.shade);
  scene.clearColor = new Color4(fog.r, fog.g, fog.b, 1);
  scene.fogMode = Scene.FOGMODE_EXP2;
  scene.fogColor = fog.toGammaSpace(true);   // Babylon's PBR shader decodes the fog colour from sRGB
  scene.fogDensity = HAZE.density;
  const ip = scene.imageProcessingConfiguration;
  ip.applyByPostProcess = true;   // materials stay linear HDR; bb-post.js tone maps once at the end
  ip.toneMappingEnabled = true;
  ip.toneMappingType = ImageProcessingConfiguration.TONEMAPPING_KHR_PBR_NEUTRAL;
  ip.exposure = 0.85;
  return { scene, haze: { color: fog, density: HAZE.density } };
};

// Pointer parallax, metres either side: ±0.9 m sideways ≈ 1.5 floor tiles (1.2 m) edge to edge.
// Camera height spans 0.8–3 m; aiming at orb height keeps the view near level, so floor and ceiling share the frame.
const PARALLAX = { x: 0.9, y: 1.1, look: 0.35 };
const EYE_HEIGHT = 1.9;

// Camera dollies down the hall with page scroll; pointer adds parallax.
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
    camera.position.set(drift + now.x * PARALLAX.x, EYE_HEIGHT - now.y * PARALLAX.y, 8.5 - now.p * 9);
    look.set(now.x * PARALLAX.look, CELL.y - now.y * PARALLAX.look, CELL.z - 1 - now.p * 4);
    camera.setTarget(look);
    return Vector3.Distance(camera.position, CELL);
  };
};

const until = async (ready) => { while (!ready()) await new Promise((resolve) => setTimeout(resolve, 16)); };

const boot = async () => {
  let tier = pickTier();
  const tint = pageTint();
  const engine = createEngine();
  const { scene, haze } = createScene(engine, tint);
  const camera = new TargetCamera('camera', new Vector3(0, EYE_HEIGHT, 8.5), scene);
  camera.minZ = 0.1;
  camera.maxZ = 80;
  const lab = buildLab(scene, { dustCount: TIERS[tier].dust, coreShadows: TIERS[tier].coreShadows, shadowMap: TIERS[tier].shadowMap, haze });
  await createEnvironment(scene, {
    position: ENV_PROBE, intensity: 0.25,
    shadowMaps: scene.lights.map((l) => l.getShadowGenerator()?.getShadowMap()).filter(Boolean),
  });
  const rig = createRig(camera);
  let post = createPost(scene, camera, { tier, tint });

  const resize = () => {
    engine.setHardwareScalingLevel(1 / Math.min(devicePixelRatio, TIERS[tier].pixelRatio));
    engine.resize();
    camera.fov = (engine.getAspectRatio(camera) < 1 ? 52 : 38) * Math.PI / 180;
    lab.motes.setSize(engine.getRenderHeight());
  };

  const hooks = {};   // filled by bb-debug.js only
  let lastZ = null;
  const draw = (time, dt) => {
    hooks.beforeFrame?.();
    lab.update(time);
    const focus = rig(time, dt);
    hooks.afterRig?.();
    const speed = lastZ === null ? 0 : Math.abs(camera.position.z - lastZ) / dt;   // dolly m/s → scroll glitch
    lastZ = camera.position.z;
    post.update(time, focus, dt, speed);
    scene.render();
    hooks.afterFrame?.();
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
    post = createPost(scene, camera, { tier, tint });
    resize();
  };

  // The display still ticks at its own rate; render on every Nth vsync once STEP has elapsed
  // (60Hz → every 2nd, 120Hz → every 4th) so frames stay evenly paced.
  let last = performance.now();
  let pending = 0;
  const frame = () => {
    const ms = performance.now();
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
  engine.onContextLostObservable.add(() => {
    engine.stopRenderLoop();
    canvas.style.removeProperty('--scene-ready');
  });

  // Babylon compiles shaders asynchronously: wait, so the first frame shown is complete.
  await scene.whenReadyAsync();
  await until(() => post.isReady());
  draw(6, 1);
  canvas.style.setProperty('--scene-ready', 1);
  const setLoop = (on) => {
    engine.stopRenderLoop(frame);
    if (on) {
      last = performance.now();
      engine.runRenderLoop(frame);
    }
  };
  if (DEBUG) {
    import('./bb-debug.js')
      .then(({ attach }) => attach({ canvas, engine, scene, camera, draw, hooks, setLoop, params, tier, lab }))
      .catch((e) => console.warn('debug hooks:', e.message));
  }
  return setLoop;
};

// The [3D] switch: hidden in the markup, only offered where the scene can actually run.
const toggle = document.querySelector('[data-is="nav-actions"] > [role="switch"]');

// main.js keeps aria-checked in sync with the saved choice; boot is deferred until the scene is first switched on.
const motionOff = () => toggle?.getAttribute('aria-checked') === 'false';

if (canvas && (!lowSpec || DEBUG)) {
  if (toggle) toggle.hidden = false;
  let setLoop = null;
  let booting = null;
  const apply = () => {
    if (motionOff()) return setLoop?.(false);
    if (setLoop) return setLoop(!reducedMotion);
    booting ??= boot().then((fn) => { setLoop = fn; apply(); }, (error) => {
      setLoop = () => {};
      if (toggle) toggle.hidden = true;
      console.warn('scene disabled:', error.message);
    });
    return booting;
  };
  document.addEventListener('motionchange', apply);
  apply();
}
