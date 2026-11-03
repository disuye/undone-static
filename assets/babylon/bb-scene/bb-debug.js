// Debug + test hooks: assets/js/scene/debug.js on Babylon, same URL options and window.__scene3d API,
// so A/B runs use identical switches. Loaded only with ?debug (dynamic import from bb-index.js).
//
//   ?debug                 expose window.__scene3d, per-frame stats, bypass the low-spec skip
//   &tier=high|low         force a quality tier
//   &still                 stop the real-time loop; step frames with __scene3d.step(n, dt)
//   &t=12.5                start time for still frames (flicker / drift phase)
//   &cam=x,y,z&look=x,y,z  pin the camera (overrides the scroll rig)
//   &holes[=0.45]          green background, no fog, camera tilted down (radians, unless &cam pins it)
//   &hud                   on-screen stats; &bench runs a timed benchmark after warm-up
//   &glitch[=0.8|off]      VHS glitch strength, or off. With &still it is off unless given
//   (engine is in the HUD and in __scene3d.engine, so screenshots and bench logs say which renderer ran)

import { Color3, Color4, SceneInstrumentation, Vector3 } from '../bb-vendor/babylon.module.js';
import { GLITCH, triggerGlitch, triggerHold } from './bb-glitch.js';
import { setBasicFog } from './bb-materials.js';

const vec = (s) => (s ? s.split(',').map(Number) : null);

export const attach = ({ canvas, engine, scene, camera, draw, hooks, setLoop, params, tier, lab }) => {
  const api = { engine: 'babylon', babylon: engine, scene, camera, tier, frames: 0, stats: null, cam: null };

  // Stats across every pass of one frame (shadow maps, depth, geometry buffer, post), as three's renderer.info.
  const instrumentation = new SceneInstrumentation(scene);
  hooks.afterFrame = () => {
    api.frames += 1;
    api.stats = {
      calls: instrumentation.drawCallsCounter.current,
      triangles: Math.round(scene.getActiveIndices() / 3),
      geometries: scene.geometries.length,
      textures: scene.textures.length,
      programs: Object.keys(engine._compiledEffects ?? {}).length,
      camera: camera.position.asArray().map((v) => +v.toFixed(3)),
      size: [canvas.width, canvas.height],
      tier,
    };
  };

  // Camera pin: applied after the rig each frame.
  api.setCamera = (p, look = [0, 1.65, -6]) => { api.cam = p ? { p, look } : null; };
  if (params.get('cam')) api.setCamera(vec(params.get('cam')), vec(params.get('look')) ?? undefined);
  const tilt = params.has('holes') ? Number(params.get('holes') || 0.45) : 0;
  const forward = new Vector3();
  hooks.afterRig = () => {
    if (api.cam) {
      camera.position.set(...api.cam.p);
      camera.setTarget(Vector3.FromArray(api.cam.look));
    } else if (tilt) {
      // three's camera.rotateX(−tilt): pitch the view about its own right axis.
      camera.getDirectionToRef(Vector3.Forward(scene.useRightHandedSystem), forward);
      const right = Vector3.Cross(forward, Vector3.Up()).normalize();
      const c = Math.cos(-tilt);
      const s = Math.sin(-tilt);
      const tilted = forward.scale(c).add(Vector3.Cross(right, forward).scale(s));
      camera.setTarget(camera.position.add(tilted));
    }
  };

  // Hole check: anything that should be solid but shows green is a missing or back-facing surface.
  if (params.has('holes')) {
    scene.clearColor = new Color4(0, 1, 0, 1);
    scene.fogMode = 0;
    setBasicFog(new Color3(), 0);
    lab.motes.setFog(new Color3(), 0);
  }

  // Deterministic stepping: no rAF, no frame-rate dependence. dt 1 s converges the scroll damping in ~3 steps.
  let t = Number(params.get('t') ?? 0);
  api.step = (n = 1, dt = 1) => {
    for (let i = 0; i < n; i += 1) { t += dt; draw(t, dt); }
    return api.stats;
  };
  if (params.has('still')) setLoop(false);

  if (params.get('glitch') === 'off') GLITCH.enabled = false;
  else if (params.has('glitch')) Object.assign(GLITCH, { enabled: true, strength: Number(params.get('glitch') || 1) });
  else if (params.has('still')) Object.assign(GLITCH, { strength: 0, idle: 0 });
  api.GLITCH = GLITCH;
  api.glitch = (len, peak) => triggerGlitch(len, peak);
  api.hold = () => triggerHold();

  // Benchmark: n back-to-back frames, each forced to finish on the GPU (1-px readPixels, as debug.js).
  api.bench = (n = 120) => {
    const gl = engine._gl;
    const px = new Uint8Array(4);
    const sync = () => gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
    setLoop(false);
    for (let i = 0; i < 10; i += 1) { draw(t, 1 / 30); sync(); }
    const ms = [];
    for (let i = 0; i < n; i += 1) {
      const t0 = performance.now();
      t += 1 / 30;
      draw(t, 1 / 30);
      sync();
      ms.push(performance.now() - t0);
    }
    if (!params.has('still')) setLoop(true);
    ms.sort((a, b) => a - b);
    const avg = ms.reduce((a, b) => a + b, 0) / n;
    api.benchResult = { avg: +avg.toFixed(2), p50: +ms[n >> 1].toFixed(2), p95: +ms[Math.floor(n * 0.95)].toFixed(2), frames: n };
    console.info('scene bench (babylon)', api.benchResult, api.stats);
    return api.benchResult;
  };

  if (params.has('hud')) {
    const style = document.createElement('style');
    style.textContent = '[data-is="debug-hud"]{position:fixed;inset:auto auto 0.5rem 0.5rem;z-index:1000;margin:0;padding:0.5rem 0.75rem;font:12px/1.4 ui-monospace,monospace;color:#0f0;background:rgb(0 0 0/0.7);white-space:pre;pointer-events:none}';
    const hud = document.createElement('p');
    hud.dataset.is = 'debug-hud';
    document.head.append(style);
    document.body.append(hud);
    let seen = 0; let last = performance.now();
    setInterval(() => {
      const now = performance.now();
      const fps = ((api.frames - seen) * 1000) / (now - last);
      seen = api.frames; last = now;
      const s = api.stats ?? {};
      const b = api.benchResult;
      hud.textContent = `babylon  tier ${tier}  dpr ${(1 / engine.getHardwareScalingLevel()).toFixed(2)}  ${s.size?.join('×') ?? ''}\n`
        + `fps ${fps.toFixed(1)}  calls ${s.calls ?? '-'}  tris ${s.triangles ?? '-'}\n`
        + `bench ${b ? `${b.avg} ms avg · ${b.p95} ms p95` : (params.has('bench') ? 'running after warm-up…' : 'off (&bench)')}`;
    }, 500);
    if (params.has('bench')) setTimeout(() => api.bench(), 3000);
  }

  window.__scene3d = api;
  return api;
};
