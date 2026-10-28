// VHS / signal-interference glitch. Display-space post pass between OutputPass and the grade.
// Procedural, seeded and deterministic for a given time sequence (so ?debug&t renders repeat):
//   scheduler  random bursts (Poisson, min gap), stuttered at tape-frame rate, single flash per burst
//   displace   slanted tear bands, per-line jitter, wave, vertical hold slip, depth-sliced offset
//   overlay    bright bars with teal halo, tape dropouts, luma smear, blowout flash, aperture stripes, scanlines
// Depth: own half-res depth render (packed RGBA), only on frames where a burst is live.
import { Color, FullScreenQuad, Pass, ShaderMaterial, Vector2, Vector3, WebGLRenderTarget } from '../vendor/three.module.js';
import { rng } from './parts.js';

export const GLITCH = {
  enabled: false,           // false = pass skipped entirely: no draw, no depth render, nothing compiled. Read every frame
  // timing
  strength: 1,            // master 0–1, scales every burst (0 = off; idle layer stays)
  rate: 0.22,             // average bursts per second
  length: [0.12, 0.75],   // burst duration range, s
  gap: 0.6,               // min quiet time between bursts, s. Keeps flashes ≤ ~1.5/s (WCAG 2.3.1 limit is 3/s)
  intro: 0.55,            // "signal acquire" burst this long right after load (0 = none)
  fps: 24,                // pattern re-roll rate inside a burst (tape-frame cadence)
  stutter: 0.35,          // share of tape frames inside a burst that drop to a quarter
  idle: 0.1,              // always-on baseline for jitter, wave, smear, scanlines (0 = clean between bursts)
  scroll: 0.5,            // scroll speed → extra glitch (0 = ignore scroll)
  // displacement
  tear: 0.04,             // max horizontal band offset, fraction of width
  share: 0.3,             // share of bands torn at full amount
  skew: 0.14,             // tilt of tear edges (sync slant)
  jitter: 0.0025,         // per-line horizontal noise
  wave: 0.0012,           // slow wavy interference
  bleed: 0.003,           // chroma offset R/B
  smear: 0.07,            // horizontal luma trail behind bright edges, fraction of width
  roll: 0.3,              // chance per burst of a vertical hold slip (black blanking bar)
  // depth
  depth: 0.05,            // offset of the nearest slice, fraction of width
  layers: 5,              // depth slices (0 = smooth parallax warp instead of hard slices)
  range: [1, 70],         // metres mapped to near / far slice
  // overlay
  lines: 1,               // bright bar opacity
  count: 4,               // max bars per burst (≤ 6)
  dropout: 1,             // tape dropout dashes
  snow: 0.12,             // noise inside torn bands
  flash: 0.55,            // blowout pulse at burst start
  stripes: 0.35,          // aperture stripes in highlights
  scan: 1.0,              // scanline darkening
  lineTint: [0.93, 0.93, 1.0],
  haloTint: [0.04, 0.32, 0.55],
  flashTint: [1, 0.84, 0.95],
};

const BARS = 6;
const clearColor = new Color();
const SPEED_FLOOR = 1.5;    // camera m/s before scroll adds glitch
const SPEED_GAIN = 0.09;

const vertexShader = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

// Scene depth, packed like MeshDepthMaterial(RGBADepthPacking). Instancing comes from three's chunks.
const depthMaterial = new ShaderMaterial({
  vertexShader: /* glsl */ `
    #include <common>
    void main() {
      #include <begin_vertex>
      #include <project_vertex>
      gl_PointSize = 1.0;
    }`,
  fragmentShader: /* glsl */ `
    #include <packing>
    void main() { gl_FragColor = packDepthToRGBA(gl_FragCoord.z); }`,
});

const glitchMaterial = new ShaderMaterial({
  uniforms: {
    tDiffuse: { value: null }, tDepth: { value: null }, uRes: { value: new Vector2(1, 1) },
    uTime: { value: 0 }, uSeed: { value: 0 }, uAmount: { value: 0 }, uIdle: { value: 0 }, uFlash: { value: 0 }, uRoll: { value: 0 },
    uTear: { value: 0 }, uShare: { value: 0 }, uSkew: { value: 0 }, uJitter: { value: 0 }, uWave: { value: 0 }, uBleed: { value: 0 }, uSmear: { value: 0 },
    uDepth: { value: 0 }, uLayers: { value: 0 }, uRange: { value: new Vector2() }, uClip: { value: new Vector2() },
    uLines: { value: 0 }, uCount: { value: 0 }, uDropout: { value: 0 }, uSnow: { value: 0 }, uStripes: { value: 0 }, uScan: { value: 0 },
    uLineTint: { value: new Vector3() }, uHaloTint: { value: new Vector3() }, uFlashTint: { value: new Vector3() },
  },
  vertexShader,
  fragmentShader: /* glsl */ `
    #include <packing>
    uniform sampler2D tDiffuse, tDepth;
    uniform vec2 uRes, uRange, uClip;
    uniform vec3 uLineTint, uHaloTint, uFlashTint;
    uniform float uTime, uSeed, uAmount, uIdle, uFlash, uRoll;
    uniform float uTear, uShare, uSkew, uJitter, uWave, uBleed, uSmear;
    uniform float uDepth, uLayers, uLines, uCount, uDropout, uSnow, uStripes, uScan;
    varying vec2 vUv;

    float hash11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
    float hash12(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }
    float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

    // 0 at uRange.x metres, 1 at uRange.y and beyond (sky = cleared = 1)
    float nearness(vec2 uv) {
      float d = unpackRGBAToDepth(texture2D(tDepth, uv));
      if (d > 0.9999) return 0.0;
      float z = -perspectiveDepthToViewZ(d, uClip.x, uClip.y);
      return 1.0 - clamp((z - uRange.x) / (uRange.y - uRange.x), 0.0, 1.0);
    }

    void main() {
      float a = uAmount;
      float live = max(a, uIdle);
      vec2 px = 1.0 / uRes;
      float line = floor(vUv.y * uRes.y / 2.0);
      vec2 uv = vUv;

      // vertical hold slip: frame rolls, blanking bar at the wrap
      float rolled = vUv.y + uRoll;
      uv.y = fract(rolled);
      float seam = abs(fract(rolled + 0.5) - 0.5);
      float blank = step(0.0001, abs(uRoll)) * (1.0 - smoothstep(0.012, 0.016, seam));
      float sync = step(0.0001, abs(uRoll)) * (1.0 - smoothstep(0.0, 0.0025, abs(seam - 0.016)));

      // tear bands with slanted edges; offset ramps across each band (sync drift)
      float by = uv.y + uv.x * (hash11(uSeed * 3.1) - 0.5) * uSkew;
      float bands = mix(3.0, 14.0, hash11(uSeed + 0.7));
      float bandPos = by * bands + hash11(uSeed) * 7.0;
      float id = floor(bandPos);
      float torn = step(1.0 - uShare * a, hash12(vec2(id + 17.0, uSeed)));
      float shift = (hash12(vec2(id, uSeed)) - 0.5) * 2.0 * uTear * torn * (0.5 + fract(bandPos));

      shift += (hash12(vec2(line, floor(uTime * 30.0))) - 0.5) * uJitter * live;
      shift += sin(vUv.y * 38.0 + uTime * 2.7 + sin(vUv.y * 6.0 - uTime * 0.9) * 2.0) * uWave * live;

      // depth slices, inside coarse bands: near geometry jumps further, each slice/band its own direction
      if (uDepth > 0.0 && a > 0.0) {
        float zone = floor(vUv.y * mix(3.0, 8.0, hash11(uSeed * 1.7)) + hash11(uSeed * 2.3) * 4.0);
        if (hash12(vec2(zone, uSeed + 3.0)) < 0.65) {
          float n = nearness(vUv);
          float slice = uLayers > 0.0 ? floor(n * uLayers + 0.5) / uLayers : n;
          float lr = hash12(vec2(floor(slice * 16.0) + zone * 31.0, floor(uSeed)));
          float dir = lr < 0.5 ? -1.0 : 1.0;
          uv += vec2(dir * (0.35 + lr), (hash11(lr * 91.0) - 0.5) * 0.3) * uDepth * a * slice * slice;
        }
      }
      uv.x += shift;

      vec2 bleed = vec2(uBleed * (a + uIdle), 0.0);
      vec3 col = vec3(
        texture2D(tDiffuse, uv + bleed).r,
        texture2D(tDiffuse, uv).g,
        texture2D(tDiffuse, uv - bleed).b
      );

      // luma smear: bright edges trail to the right, ragged per line
      if (uSmear > 0.0 && live > 0.0) {
        float len = uSmear * (0.25 * uIdle + a) * (0.4 + hash12(vec2(line, uSeed)));
        vec3 trail = vec3(0.0);
        for (int i = 1; i <= 8; i++) {
          float k = float(i) / 8.0;
          vec3 s = texture2D(tDiffuse, uv - vec2(k * len, 0.0)).rgb;
          trail = max(trail, s * (1.0 - k) * smoothstep(0.45, 0.95, luma(s)));
        }
        col = max(col, trail * vec3(0.85, 0.95, 1.0));
      }

      col += (hash12(gl_FragCoord.xy + uSeed * 17.0) - 0.5) * uSnow * torn * a;

      // bright bars with a teal-blue halo; some only partway across, some aperture-striped green
      float stripe = 0.5 + 0.5 * sin(gl_FragCoord.x * 2.0944);
      for (int i = 0; i < ${BARS}; i++) {
        float fi = float(i);
        if (fi >= uCount) break;
        float r0 = hash12(vec2(fi, floor(uSeed / 3.0)));
        if (hash12(vec2(fi + 9.0, uSeed)) > a * 1.4) continue;
        float y = fract(r0 + uTime * (hash11(r0 * 13.0) - 0.5) * 0.4) + vUv.x * (hash11(r0 * 7.0) - 0.5) * 0.02;
        float h = mix(0.0015, 0.035, pow(hash11(r0 * 29.0), 3.0));
        float d = abs(vUv.y - y);
        float x0 = hash11(r0 * 41.0) < 0.6 ? 0.0 : hash11(r0 * 43.0) * 0.6;
        float span = smoothstep(x0, x0 + 0.04, vUv.x);
        float core = (1.0 - smoothstep(h * 0.5, h * 0.5 + px.y * 1.5, d)) * span;
        float halo = exp(-d / (h * 2.0 + 0.012)) * span;
        bool green = hash11(r0 * 53.0) < 0.25;
        vec3 tint = green ? vec3(0.15, 0.55, 0.35) * stripe : mix(uLineTint, uLineTint * vec3(0.8, 1.0, 0.85), vUv.x);
        col = mix(col, tint, core * uLines);
        col += uHaloTint * halo * uLines * 0.35 * a;
      }

      // tape dropouts: short white dashes
      float seg = floor(vUv.x * 9.0 + hash11(line) * 9.0);
      float drop = step(1.0 - 0.004 * uDropout * a, hash12(vec2(line * 0.5 + seg, uSeed)));
      col = mix(col, vec3(1.0), drop * (1.0 - fract(vUv.x * 9.0 + hash11(line) * 9.0)));

      // blowout flash, then aperture stripes in the highlights, then scanlines
      col = min(col * (1.0 + uFlash * 6.0) + uFlash * 0.35 * uFlashTint, vec3(1.0));
      col *= 1.0 - uStripes * live * (1.0 - stripe) * smoothstep(0.35, 1.0, luma(col)) * 0.6;
      col *= 1.0 - uScan * live * 0.5 * (1.0 + sin(gl_FragCoord.y * 3.14159265));

      col = mix(col, vec3(0.0), blank);
      col = mix(col, uLineTint, sync * 0.8);
      gl_FragColor = vec4(col, 1.0);
    }`,
  depthTest: false,
  depthWrite: false,
});

const hash = (n) => { const s = Math.sin(n * 12.9898) * 43758.5453; return s - Math.floor(s); };
const lerp = ([lo, hi], t) => lo + (hi - lo) * t;
const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

// Burst timeline. Times are absolute (drawn from a seeded rng), so the sequence doesn't depend on frame rate.
const createScheduler = (p, seed = 1984) => {
  const rand = rng(seed);
  let next = null; let burst = null; let id = 0; let lastFlash = -Infinity; let kick = 0;
  const gap = () => p.gap + -Math.log(1 - rand()) / Math.max(p.rate, 1e-3);
  const start = (t, len, peak) => {
    const flash = t - lastFlash > p.gap && rand() < 0.65;
    if (flash) lastFlash = t;
    burst = { t0: t, len, peak, flash, roll: rand() < p.roll ? (rand() - 0.5) * 0.7 : 0, id: ++id };
  };

  const update = (t, dt, speed) => {
    if (next === null) next = p.intro > 0 ? t + 0.3 : t + gap();
    if (!burst && t - next > 1) next = t + gap();                        // tab was hidden: don't replay missed bursts
    if (!burst && t >= next) {
      start(next, id === 0 && p.intro > 0 ? p.intro : lerp(p.length, rand()), id === 0 && p.intro > 0 ? 1 : 0.45 + 0.55 * rand());
    }
    if (burst && t > burst.t0 + burst.len) { next = burst.t0 + burst.len + gap(); burst = null; }

    const target = Math.min(0.6, Math.max(0, (speed - SPEED_FLOOR) * SPEED_GAIN)) * p.scroll;
    kick += (target - kick) * Math.min(1, dt * (target > kick ? 8 : 2));

    const frame = Math.floor(t * p.fps);
    let amount = 0; let flash = 0; let roll = 0;
    if (burst) {
      const u = (t - burst.t0) / burst.len;
      const shape = smooth(0, 0.08, u) * (1 - smooth(0.75, 1, u));
      amount = burst.peak * shape * (hash(frame + burst.id * 7.13) < p.stutter ? 0.25 : 1);
      flash = burst.flash ? burst.peak * Math.exp(-(t - burst.t0) / 0.07) : 0;
      roll = burst.roll && shape > 0.5 ? burst.roll + (hash(frame) - 0.5) * 0.02 : 0;
    }
    return {
      amount: Math.min(1, Math.max(amount, kick)) * p.strength,
      flash: flash * p.flash * p.strength,
      roll: roll * p.strength,
      seed: frame + (burst?.id ?? 0) * 131,
    };
  };

  const trigger = (t, len = 0.4, peak = 1) => { if (!burst) start(t, len, peak); };
  return { update, trigger };
};

let current = null;
// Fire a burst from anywhere (section change, click): triggerGlitch(0.3, 0.8). No-op without a live pass.
export const triggerGlitch = (len, peak) => current?.trigger(len, peak);

export class GlitchPass extends Pass {
  constructor(scene, camera, params = GLITCH) {
    super();
    this.scene = scene;
    this.camera = camera;
    this.params = params;
    this.depth = new WebGLRenderTarget(1, 1, { depthBuffer: true });
    this.quad = new FullScreenQuad(glitchMaterial);
    this.schedule = createScheduler(params);
    this.time = 0;
    this.state = { amount: 0, flash: 0, roll: 0, seed: 0 };
    current = this;
  }

  // Called once per frame before composer.render(). speed: camera travel, m/s.
  update(time, dt, speed = 0) {
    this.time = time;
    this.state = this.schedule.update(time, dt, speed);
  }

  trigger(len, peak) { this.schedule.trigger(this.time, len, peak); }

  setSize(width, height) {
    glitchMaterial.uniforms.uRes.value.set(width, height);
    this.depth.setSize(Math.max(1, width >> 1), Math.max(1, height >> 1));
  }

  renderDepth(renderer) {
    const { scene } = this;
    const background = scene.background;
    scene.background = null;
    scene.overrideMaterial = depthMaterial;
    renderer.setRenderTarget(this.depth);
    renderer.setClearColor(0xffffff, 1);
    renderer.clear();
    renderer.render(scene, this.camera);
    scene.overrideMaterial = null;
    scene.background = background;
  }

  render(renderer, writeBuffer, readBuffer) {
    const p = this.params;
    const s = this.state;
    const u = glitchMaterial.uniforms;
    const useDepth = p.depth > 0 && s.amount > 0.001;

    if (useDepth) {
      const alpha = renderer.getClearAlpha();
      renderer.getClearColor(clearColor);
      this.renderDepth(renderer);
      renderer.setClearColor(clearColor, alpha);
    }

    u.tDiffuse.value = readBuffer.texture;
    u.tDepth.value = this.depth.texture;
    u.uTime.value = this.time;
    u.uSeed.value = s.seed;
    u.uAmount.value = s.amount;
    u.uFlash.value = s.flash;
    u.uRoll.value = s.roll;
    u.uIdle.value = p.idle;
    u.uTear.value = p.tear;
    u.uShare.value = p.share;
    u.uSkew.value = p.skew;
    u.uJitter.value = p.jitter;
    u.uWave.value = p.wave;
    u.uBleed.value = p.bleed;
    u.uSmear.value = p.smear;
    u.uDepth.value = useDepth ? p.depth : 0;
    u.uLayers.value = p.layers;
    u.uRange.value.set(...p.range);
    u.uClip.value.set(this.camera.near, this.camera.far);
    u.uLines.value = p.lines;
    u.uCount.value = Math.min(p.count, BARS);
    u.uDropout.value = p.dropout;
    u.uSnow.value = p.snow;
    u.uStripes.value = p.stripes;
    u.uScan.value = p.scan;
    u.uLineTint.value.set(...p.lineTint);
    u.uHaloTint.value.set(...p.haloTint);
    u.uFlashTint.value.set(...p.flashTint);

    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    this.quad.render(renderer);
  }

  dispose() {
    this.depth.dispose();
    this.quad.dispose();
    if (current === this) current = null;
  }
}
