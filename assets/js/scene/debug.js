// Debug + test hooks. Loaded only with ?debug (dynamic import from index.js), so production never fetches it.
// Ported from cfk (see its _specs/tooling-spec.md §3).
//
//   ?debug                 expose window.__scene3d, per-frame stats, bypass the low-spec skip
//   &tier=high|low         force a quality tier
//   &still                 stop the real-time loop; step frames with __scene3d.step(n, dt)
//   &t=12.5                start time for still frames (flicker / drift phase)
//   &cam=x,y,z&look=x,y,z  pin the camera (overrides the scroll rig)
//   &holes[=0.45]          green background, no fog, camera tilted down (radians, unless &cam pins it):
//                          the hall is closed, so any green is a missing or back-facing surface
//   &hud                   on-screen stats; &bench runs a timed benchmark after warm-up
//   &glitch[=0.8|off]      VHS glitch strength, or off. With &still it is off unless given, so QA renders stay clean;
//                          __scene3d.glitch(len, peak) fires a burst, __scene3d.hold() the long image hold, __scene3d.GLITCH tunes it live

// URL options
// ?debug: makes the scene's controls and per-frame stats available from the browser console as window.__scene3d.
// &tier=high|low: forces a quality level.
// &still with &t=12.5: stops the animation so frames only render when you call __scene3d.step(n, dt). Renders repeat exactly, which makes before/after comparisons possible.
// &cam=x,y,z&look=x,y,z: fixes the camera in place. If you give a camera position without &look, it aims at the orb (0, 1.65, −6), not cfk's default target.
// &holes[=0.45]: green background, no haze, camera tilted down. The hall is fully enclosed, so any green you see is a missing surface. I ran it at the opening shot and saw no green.
// &hud&bench: on-screen fps, draw calls and triangle count. After 3 seconds it times 120 frames and shows the average and slowest-5% frame times.
// &glitch[=0.8|off]: sets the glitch strength or turns it off. With &still the glitch is off unless you give this, so test renders stay clean. From the console, __scene3d.glitch(len, peak) fires a burst, __scene3d.hold() fires the long image hold, and __scene3d.GLITCH lets you tune values live.



import { Color } from '../vendor/three.module.js';
import { GLITCH, triggerGlitch, triggerHold } from './glitch.js';

const vec = (s) => (s ? s.split(',').map(Number) : null);

export const attach = ({ canvas, renderer, scene, camera, draw, hooks, setLoop, params, tier }) => {
  const api = { renderer, scene, camera, tier, frames: 0, stats: null, cam: null };

  // Stats across every pass of one frame (composer + GTAO + bokeh + glitch depth), not just the last render call.
  renderer.info.autoReset = false;
  hooks.beforeFrame = () => renderer.info.reset();
  hooks.afterFrame = () => {
    api.frames += 1;
    const { render, memory, programs } = renderer.info;
    api.stats = {
      calls: render.calls,
      triangles: render.triangles,
      geometries: memory.geometries,
      textures: memory.textures,
      programs: programs?.length ?? 0,
      camera: camera.position.toArray().map((v) => +v.toFixed(3)),
      size: [canvas.width, canvas.height],
      tier,
    };
  };

  // Camera pin: applied after the rig each frame.
  api.setCamera = (p, look = [0, 1.65, -6]) => { api.cam = p ? { p, look } : null; };
  if (params.get('cam')) api.setCamera(vec(params.get('cam')), vec(params.get('look')) ?? undefined);
  const tilt = params.has('holes') ? Number(params.get('holes') || 0.45) : 0;
  hooks.afterRig = () => {
    if (api.cam) {
      camera.position.set(...api.cam.p);
      camera.lookAt(...api.cam.look);
    } else if (tilt) {
      camera.rotateX(-tilt);
    }
  };

  // Hole check: anything that should be solid but shows green is a missing or back-facing surface.
  if (params.has('holes')) {
    scene.background = new Color(0, 1, 0);
    scene.fog = null;
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

  // Benchmark: n back-to-back frames, each forced to finish on the GPU.
  // A 1-px readPixels is the sync: gl.finish() returns early on Chrome/ANGLE-Metal and under-reports ~2×.
  api.bench = (n = 120) => {
    const gl = renderer.getContext();
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
    console.info('scene bench', api.benchResult, api.stats);
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
      hud.textContent = `tier ${tier}  dpr ${renderer.getPixelRatio()}  ${s.size?.join('×') ?? ''}\n`
        + `fps ${fps.toFixed(1)}  calls ${s.calls ?? '-'}  tris ${s.triangles ?? '-'}\n`
        + `bench ${b ? `${b.avg} ms avg · ${b.p95} ms p95` : (params.has('bench') ? 'running after warm-up…' : 'off (&bench)')}`;
    }, 500);
    if (params.has('bench')) setTimeout(() => api.bench(), 3000);
  }

  window.__scene3d = api;
  canvas.dataset.debug = '';
  return api;
};
