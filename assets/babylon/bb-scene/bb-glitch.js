// VHS / signal-interference glitch: assets/js/scene/glitch.js on Babylon. Display-space post process
// between tone mapping and the grade. Same parameters, scheduler and shader maths; only the plumbing differs:
//   scheduler  identical (seeded, frame-rate independent), so both engines glitch at the same moments
//   depth      Babylon's DepthRenderer (camera-space z) instead of a packed RGBA depth pass; bb-post.js
//              switches it on only while a burst is live (or always, when bokeh needs it anyway)
//   image      the subliminal still as a Babylon Texture (async; flashes are skipped until it lands)
import { Constants, PostProcess, ShaderStore, Texture } from '../bb-vendor/babylon.module.js';
import { rng } from './bb-parts.js';

export const GLITCH = {
  enabled: true,           // false = pass skipped entirely: no draw, no depth render, nothing compiled. Read every frame
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
  // subliminal image
  image: 0.45,            // chance per burst of flashing the still (0 = never, image not loaded)
  imageLength: [0.05, 0.2], // on-screen time, s (≈ 1–5 tape frames)
  imageOpacity: 1,
  afterglow: 0.3,         // opacity the still drops to once the flash ends (0 = hard cut)
  decay: 0.8,             // afterglow fade time constant, s (≈ gone after 3×)
  holdEvery: [70, 90],   // s between long holds (null = never)
  hold: [10, 15],           // how long the still stays up, s
  holdFade: 2.5,          // fade back to the scene, s
};

const IMAGE_URL = new URL('../../img/glitch.jpg', import.meta.url).href;

const BARS = 6;
const SPEED_FLOOR = 1.5;    // camera m/s before scroll adds glitch
const SPEED_GAIN = 0.09;

const UNIFORMS = [
  'uRes', 'uRange', 'uClip', 'uImageScale', 'uLineTint', 'uHaloTint', 'uFlashTint',
  'uTime', 'uSeed', 'uAmount', 'uIdle', 'uFlash', 'uRoll', 'uImage',
  'uTear', 'uShare', 'uSkew', 'uJitter', 'uWave', 'uBleed', 'uSmear',
  'uDepth', 'uLayers', 'uLines', 'uCount', 'uDropout', 'uSnow', 'uStripes', 'uScan',
];

ShaderStore.ShadersStore.bbGlitchFragmentShader = /* glsl */ `
    precision highp float;
    uniform sampler2D textureSampler;
    uniform sampler2D depthSampler;
    uniform sampler2D imageSampler;
    uniform vec2 uRes, uRange, uClip, uImageScale;
    uniform vec3 uLineTint, uHaloTint, uFlashTint;
    uniform float uTime, uSeed, uAmount, uIdle, uFlash, uRoll, uImage;
    uniform float uTear, uShare, uSkew, uJitter, uWave, uBleed, uSmear;
    uniform float uDepth, uLayers, uLines, uCount, uDropout, uSnow, uStripes, uScan;
    varying vec2 vUV;

    float hash11(float p) { p = fract(p * 0.1031); p *= p + 33.33; p *= p + p; return fract(p); }
    float hash12(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }
    float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

    // 0 at uRange.x metres, 1 at uRange.y and beyond (cleared = 0 = no geometry). Depth: Babylon camera-space z
    float nearness(vec2 uv) {
      float z = abs(texture2D(depthSampler, uv).r);
      if (z <= 0.0) return 0.0;
      return 1.0 - clamp((z - uRange.x) / (uRange.y - uRange.x), 0.0, 1.0);
    }

    void main() {
      float a = uAmount;
      float live = max(a, uIdle);
      vec2 px = 1.0 / uRes;
      float line = floor(vUV.y * uRes.y / 2.0);
      vec2 uv = vUV;

      // vertical hold slip: frame rolls, blanking bar at the wrap
      float rolled = vUV.y + uRoll;
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
      shift += sin(vUV.y * 38.0 + uTime * 2.7 + sin(vUV.y * 6.0 - uTime * 0.9) * 2.0) * uWave * live;

      // depth slices, inside coarse bands: near geometry jumps further, each slice/band its own direction
      if (uDepth > 0.0 && a > 0.0) {
        float zone = floor(vUV.y * mix(3.0, 8.0, hash11(uSeed * 1.7)) + hash11(uSeed * 2.3) * 4.0);
        if (hash12(vec2(zone, uSeed + 3.0)) < 0.65) {
          float n = nearness(vUV);
          float slice = uLayers > 0.0 ? floor(n * uLayers + 0.5) / uLayers : n;
          float lr = hash12(vec2(floor(slice * 16.0) + zone * 31.0, floor(uSeed)));
          float dir = lr < 0.5 ? -1.0 : 1.0;
          uv += vec2(dir * (0.35 + lr), (hash11(lr * 91.0) - 0.5) * 0.3) * uDepth * a * slice * slice;
        }
      }
      uv.x += shift;

      vec2 bleed = vec2(uBleed * (a + uIdle), 0.0);
      vec3 col = vec3(
        texture2D(textureSampler, uv + bleed).r,
        texture2D(textureSampler, uv).g,
        texture2D(textureSampler, uv - bleed).b
      );

      // subliminal still: same displaced uv, so it tears, rolls and bleeds with the frame
      if (uImage > 0.0) {
        vec2 iuv = (uv - 0.5) * uImageScale + 0.5;
        vec3 img = vec3(
          texture2D(imageSampler, iuv + bleed).r,
          texture2D(imageSampler, iuv).g,
          texture2D(imageSampler, iuv - bleed).b
        );
        col = mix(col, img, uImage);
      }

      // luma smear: bright edges trail to the right, ragged per line
      if (uSmear > 0.0 && live > 0.0) {
        float len = uSmear * (0.25 * uIdle + a) * (0.4 + hash12(vec2(line, uSeed)));
        vec3 trail = vec3(0.0);
        for (int i = 1; i <= 8; i++) {
          float k = float(i) / 8.0;
          vec3 s = texture2D(textureSampler, uv - vec2(k * len, 0.0)).rgb;
          trail = max(trail, s * (1.0 - k) * smoothstep(0.45, 0.95, luma(s)));
        }
        col = max(col, trail * vec3(0.85, 0.95, 1.0) * (1.0 - uImage));
      }

      col += (hash12(gl_FragCoord.xy + uSeed * 17.0) - 0.5) * uSnow * torn * a;

      // bright bars with a teal-blue halo; some only partway across, some aperture-striped green
      float stripe = 0.5 + 0.5 * sin(gl_FragCoord.x * 2.0944);
      for (int i = 0; i < ${BARS}; i++) {
        float fi = float(i);
        if (fi >= uCount) break;
        float r0 = hash12(vec2(fi, floor(uSeed / 3.0)));
        if (hash12(vec2(fi + 9.0, uSeed)) > a * 1.4) continue;
        float y = fract(r0 + uTime * (hash11(r0 * 13.0) - 0.5) * 0.4) + vUV.x * (hash11(r0 * 7.0) - 0.5) * 0.02;
        float h = mix(0.0015, 0.035, pow(hash11(r0 * 29.0), 3.0));
        float d = abs(vUV.y - y);
        float x0 = hash11(r0 * 41.0) < 0.6 ? 0.0 : hash11(r0 * 43.0) * 0.6;
        float span = smoothstep(x0, x0 + 0.04, vUV.x);
        float core = (1.0 - smoothstep(h * 0.5, h * 0.5 + px.y * 1.5, d)) * span;
        float halo = exp(-d / (h * 2.0 + 0.012)) * span;
        bool green = hash11(r0 * 53.0) < 0.25;
        vec3 tint = green ? vec3(0.15, 0.55, 0.35) * stripe : mix(uLineTint, uLineTint * vec3(0.8, 1.0, 0.85), vUV.x);
        col = mix(col, tint, core * uLines);
        col += uHaloTint * halo * uLines * 0.35 * a;
      }

      // tape dropouts: short white dashes
      float seg = floor(vUV.x * 9.0 + hash11(line) * 9.0);
      float drop = step(1.0 - 0.004 * uDropout * a, hash12(vec2(line * 0.5 + seg, uSeed)));
      col = mix(col, vec3(1.0), drop * (1.0 - fract(vUV.x * 9.0 + hash11(line) * 9.0)));

      // blowout flash, then aperture stripes in the highlights, then scanlines
      col = min(col * (1.0 + uFlash * 6.0) + uFlash * 0.35 * uFlashTint, vec3(1.0));
      col *= 1.0 - uStripes * live * (1.0 - stripe) * smoothstep(0.35, 1.0, luma(col)) * 0.6;
      col *= 1.0 - uScan * live * 0.5 * (1.0 + sin(gl_FragCoord.y * 3.14159265));

      col = mix(col, vec3(0.0), blank);
      col = mix(col, uLineTint, sync * 0.8);
      gl_FragColor = vec4(col, 1.0);
    }`;

const hash = (n) => { const s = Math.sin(n * 12.9898) * 43758.5453; return s - Math.floor(s); };
const lerp = ([lo, hi], t) => lo + (hi - lo) * t;
const smooth = (e0, e1, x) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

// Burst timeline. Times are absolute (drawn from a seeded rng), so the sequence doesn't depend on frame rate.
const createScheduler = (p, seed = 1984) => {
  const rand = rng(seed);
  const randHold = rng(seed + 1);                                       // own stream: holds don't reshuffle burst timing
  let next = null; let burst = null; let id = 0; let lastFlash = -Infinity; let kick = 0;
  let still = null;                                                     // last image window; outlives its burst for the afterglow
  let nextHold = null;
  const holdGap = () => (p.holdEvery ? lerp(p.holdEvery, randHold()) : Infinity);
  const gap = () => p.gap + -Math.log(1 - rand()) / Math.max(p.rate, 1e-3);
  const start = (t, len, peak) => {
    const flash = t - lastFlash > p.gap && rand() < 0.65;
    if (flash) lastFlash = t;
    const roll = rand() < p.roll ? (rand() - 0.5) * 0.7 : 0;
    id += 1;
    burst = { t0: t, len, peak, flash, roll, id };
    if (!still?.hold) still = imageWindow(t, len) ?? still;            // bursts during a hold glitch over it, never replace it
  };
  // a full burst tears in, the still lands a few tape frames later and stays
  const startHold = (t) => {
    start(t, 0.6, 1);
    still = { t0: t + 0.12, dur: lerp(p.hold, randHold()), hold: true };
    nextHold = t + holdGap();
  };
  // hash, not rand(): adding the image doesn't shift the seeded burst sequence
  const imageWindow = (t, len) => {
    if (hash(id * 5.17) >= p.image) return null;
    const dur = lerp(p.imageLength, hash(id * 3.73));
    return { t0: t + hash(id * 9.41) * Math.max(0, len - dur), dur };
  };

  // full on for the window. Flashes then drop to the afterglow level and decay exponentially, like phosphor
  // persistence; holds ease out over holdFade
  const stillLevel = (t) => {
    if (!still || t < still.t0) return 0;
    const since = t - (still.t0 + still.dur);
    if (since < 0) return p.imageOpacity;
    const glow = still.hold
      ? 1 - smooth(0, p.holdFade, since)
      : p.afterglow * Math.exp(-since / Math.max(p.decay, 1e-3));
    if (glow < 0.004) still = null;
    return glow < 0.004 ? 0 : glow * p.imageOpacity;
  };

  const update = (t, dt, speed) => {
    if (next === null) next = p.intro > 0 ? t + 0.3 : t + gap();
    if (nextHold === null) nextHold = t + holdGap();
    if (!burst && t - nextHold > 1) nextHold = t + holdGap();            // tab was hidden
    if (!burst && t >= nextHold) startHold(t);
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
    const image = stillLevel(t);
    return {
      amount: Math.min(1, Math.max(amount, kick)) * p.strength,
      flash: flash * p.flash * p.strength,
      roll: roll * p.strength,
      image: image * p.strength,
      seed: frame + (burst?.id ?? 0) * 131,
    };
  };

  const trigger = (t, len = 0.4, peak = 1) => { if (!burst) start(t, len, peak); };
  const hold = (t) => startHold(t);                                     // manual: cuts any running burst
  return { update, trigger, hold };
};


let current = null;
// Fire a burst from anywhere (section change, click): triggerGlitch(0.3, 0.8). No-op without a live pass.
export const triggerGlitch = (len, peak) => current?.trigger(len, peak);
// Fire a long hold now (also resets the hold timer).
export const triggerHold = () => current?.hold();

/** depthTexture: camera-space z from bb-post.js's DepthRenderer. */
export const createGlitchPass = (engine, scene, camera, depthTexture, params = GLITCH) => {
  const pass = new PostProcess('glitch', 'bbGlitch', UNIFORMS, ['depthSampler', 'imageSampler'], 1, null,
    Texture.BILINEAR_SAMPLINGMODE, engine, false, null, Constants.TEXTURETYPE_HALF_FLOAT);
  const schedule = createScheduler(params);
  let time = 0;
  let state = { amount: 0, flash: 0, roll: 0, image: 0, seed: 0 };
  let image = null;
  if (params.image > 0 || params.holdEvery) {
    const texture = new Texture(IMAGE_URL, scene, { noMipmap: false, invertY: true });
    texture.onLoadObservable.addOnce(() => { image = texture; });
  }

  // cover-fit: fill the screen, crop the overflow axis
  const imageScale = () => {
    const { width, height } = image.getSize();
    const ratio = (pass.width / pass.height) / (width / height);
    return ratio > 1 ? [1, 1 / ratio] : [ratio, 1];
  };

  pass.onApply = (effect) => {
    const p = params;
    const s = state;
    effect.setTexture('depthSampler', depthTexture);
    effect.setTexture('imageSampler', image ?? depthTexture);
    effect.setFloat('uImage', image ? s.image : 0);
    effect.setFloat2('uImageScale', ...(image ? imageScale() : [1, 1]));
    effect.setFloat2('uRes', pass.width, pass.height);
    effect.setFloat('uTime', time);
    effect.setFloat('uSeed', s.seed);
    effect.setFloat('uAmount', s.amount);
    effect.setFloat('uFlash', s.flash);
    effect.setFloat('uRoll', s.roll);
    effect.setFloat('uIdle', p.idle);
    effect.setFloat('uTear', p.tear);
    effect.setFloat('uShare', p.share);
    effect.setFloat('uSkew', p.skew);
    effect.setFloat('uJitter', p.jitter);
    effect.setFloat('uWave', p.wave);
    effect.setFloat('uBleed', p.bleed);
    effect.setFloat('uSmear', p.smear);
    effect.setFloat('uDepth', api.needsDepth() ? p.depth : 0);
    effect.setFloat('uLayers', p.layers);
    effect.setFloat2('uRange', ...p.range);
    effect.setFloat2('uClip', camera.minZ, camera.maxZ);
    effect.setFloat('uLines', p.lines);
    effect.setFloat('uCount', Math.min(p.count, BARS));
    effect.setFloat('uDropout', p.dropout);
    effect.setFloat('uSnow', p.snow);
    effect.setFloat('uStripes', p.stripes);
    effect.setFloat('uScan', p.scan);
    effect.setFloat3('uLineTint', ...p.lineTint);
    effect.setFloat3('uHaloTint', ...p.haloTint);
    effect.setFloat3('uFlashTint', ...p.flashTint);
  };

  const api = {
    pass,
    // Called once per frame before scene.render(). speed: camera travel, m/s.
    update(t, dt, speed = 0) {
      time = t;
      state = schedule.update(t, dt, speed);
    },
    needsDepth: () => params.enabled && params.depth > 0 && state.amount > 0.001,
    trigger: (len, peak) => schedule.trigger(time, len, peak),
    hold: () => schedule.hold(time),
    dispose() {
      pass.dispose();
      image?.dispose();
      if (current === api) current = null;
    },
  };
  current = api;
  return api;
};
