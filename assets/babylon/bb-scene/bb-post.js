import {
  Constants, ImageProcessingPostProcess, PostProcess, PostProcessRenderEffect,
  PostProcessRenderPipeline, SSAO2RenderingPipeline, ShaderStore, Texture,
} from '../bb-vendor/babylon.module.js';
import { GLITCH, createGlitchPass } from './bb-glitch.js';

// Same chain as post.js: AO → bloom → depth of field → tone map → glitch → grade.
// Bloom, bokeh, glitch and grade are shader-for-shader ports; AO is Babylon's SSAO2 (three's GTAO has no Babylon equivalent).
//
// Babylon plumbing: a post process renders into the *next* one's input texture, and its `ratio` sizes its own input.
// So a pass that must write at size S is followed by one whose ratio is S.

const HALF = Constants.TEXTURETYPE_HALF_FLOAT;   // three's EffectComposer targets are HalfFloat too

// ---------- grade (post.js GradeShader) ----------
ShaderStore.ShadersStore.bbGradeFragmentShader = /* glsl */ `
  precision highp float;
  uniform sampler2D textureSampler;
  uniform vec3 uTint;
  uniform float uLift, uVignette, uAberration, uGrain, uTime;
  varying vec2 vUV;

  float hash(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  void main() {
    vec2 c = vUV - 0.5;
    float r2 = dot(c, c);
    vec2 offset = c * uAberration * r2 * 4.0;
    vec3 col = vec3(
      texture2D(textureSampler, vUV + offset).r,
      texture2D(textureSampler, vUV).g,
      texture2D(textureSampler, vUV - offset).b
    );
    col = mix(col, uTint, uLift);
    col *= 1.0 - uVignette * smoothstep(0.08, 0.5, r2);
    float luma = dot(col, vec3(0.2126, 0.7152, 0.0722));
    col += (hash(gl_FragCoord.xy + fract(uTime) * 917.0) - 0.5) * uGrain * mix(1.0, 0.35, luma);
    gl_FragColor = vec4(col, 1.0);
  }`;
const GRADE = { lift: 0.07, vignette: 0.38, aberration: 0.0065, grain: 0.045 };

// ---------- bokeh (three's BokehShader + post.js's sharp focus range) ----------
const TAPS = [
  [0.0, 0.4], [0.15, 0.37], [0.29, 0.29], [-0.37, 0.15], [0.40, 0.0], [0.37, -0.15], [0.29, -0.29], [-0.15, -0.37],
  [0.0, -0.4], [-0.15, 0.37], [-0.29, 0.29], [0.37, 0.15], [-0.4, 0.0], [-0.37, -0.15], [-0.29, -0.29], [0.15, -0.37],
].map(([x, y]) => [x, y, 1]).concat(
  [[0.15, 0.37], [-0.37, 0.15], [0.37, -0.15], [-0.15, -0.37], [-0.15, 0.37], [0.37, 0.15], [-0.37, -0.15], [0.15, -0.37]].map(([x, y]) => [x, y, 0.9]),
  [[0.29, 0.29], [0.40, 0.0], [0.29, -0.29], [0.0, -0.4], [-0.29, 0.29], [-0.4, 0.0], [-0.29, -0.29], [0.0, 0.4]].map(([x, y]) => [x, y, 0.7]),
  [[0.29, 0.29], [0.4, 0.0], [0.29, -0.29], [0.0, -0.4], [-0.29, 0.29], [-0.4, 0.0], [-0.29, -0.29], [0.0, 0.4]].map(([x, y]) => [x, y, 0.4]),
);
const glslFloat = (v) => (Number.isInteger(v) ? v.toFixed(1) : String(v));
ShaderStore.ShadersStore.bbBokehFragmentShader = /* glsl */ `
  precision highp float;
  uniform sampler2D textureSampler;
  uniform sampler2D depthSampler;
  uniform float maxblur, aperture, focus, focusRange, aspect, farClip;
  varying vec2 vUV;
  void main() {
    vec2 aspectcorrect = vec2(1.0, aspect);
    float depth = abs(texture2D(depthSampler, vUV).r);
    float viewZ = -(depth > 0.0 ? depth : farClip);
    float factor = focus + viewZ;
    factor = sign(factor) * max(abs(factor) - focusRange, 0.0);
    vec2 dofblur = vec2(clamp(factor * aperture, -maxblur, maxblur));
    vec4 col = texture2D(textureSampler, vUV);
    ${TAPS.map(([x, y, k]) => `col += texture2D(textureSampler, vUV + (vec2(${glslFloat(x)}, ${glslFloat(y)}) * aspectcorrect) * dofblur * ${glslFloat(k)});`).join('\n    ')}
    gl_FragColor = vec4(col.rgb / ${glslFloat(TAPS.length + 1)}, 1.0);
  }`;
// Metres either side of the focus plane kept fully sharp: covers the orb, all three arms and their floor zones.
const BOKEH = { aperture: 0.0016, maxblur: 0.0054, focusRange: 3 };

// ---------- bloom (three's UnrealBloomPass: high pass → 5 blurred mips → composite → add) ----------
ShaderStore.ShadersStore.bbBloomHighPassFragmentShader = /* glsl */ `
  precision highp float;
  uniform sampler2D textureSampler;
  uniform float threshold, smoothWidth;
  varying vec2 vUV;
  void main() {
    vec4 texel = texture2D(textureSampler, vUV);
    float v = dot(texel.rgb, vec3(0.2126729, 0.7151522, 0.0721750));
    gl_FragColor = mix(vec4(0.0), texel, smoothstep(threshold, threshold + smoothWidth, v));
  }`;
ShaderStore.ShadersStore.bbBloomBlurFragmentShader = /* glsl */ `
  precision highp float;
  uniform sampler2D textureSampler;
  uniform vec2 invSize, direction;
  uniform float centerWeight;
  uniform float gaussianOffsets[KERNEL_PAIRS];
  uniform float gaussianWeights[KERNEL_PAIRS];
  varying vec2 vUV;
  void main() {
    vec3 sum = texture2D(textureSampler, vUV).rgb * centerWeight;
    for (int i = 0; i < KERNEL_PAIRS; i++) {
      vec2 o = direction * invSize * gaussianOffsets[i];
      sum += (texture2D(textureSampler, vUV + o).rgb + texture2D(textureSampler, vUV - o).rgb) * gaussianWeights[i];
    }
    gl_FragColor = vec4(sum, 1.0);
  }`;
ShaderStore.ShadersStore.bbBloomCompositeFragmentShader = /* glsl */ `
  precision highp float;
  uniform sampler2D blur1, blur2, blur3, blur4, blur5;
  uniform float strength, radius;
  varying vec2 vUV;
  float factor(float f) { return mix(f, 1.2 - f, radius); }
  void main() {
    vec3 bloom = 3.0 * strength * (
      factor(1.0) * texture2D(blur1, vUV).rgb + factor(0.8) * texture2D(blur2, vUV).rgb + factor(0.6) * texture2D(blur3, vUV).rgb
      + factor(0.4) * texture2D(blur4, vUV).rgb + factor(0.2) * texture2D(blur5, vUV).rgb);
    gl_FragColor = vec4(bloom, 1.0);
  }`;
ShaderStore.ShadersStore.bbBloomMergeFragmentShader = /* glsl */ `
  precision highp float;
  uniform sampler2D textureSampler;
  uniform sampler2D baseSampler;
  varying vec2 vUV;
  void main() { gl_FragColor = vec4(texture2D(baseSampler, vUV).rgb + texture2D(textureSampler, vUV).rgb, 1.0); }`;

const BLOOM = { strength: 0.32, radius: 0.6, threshold: 0.95, kernels: [6, 10, 14, 18, 22] };

const blurKernel = (radius) => {
  const sigma = radius / 3;
  const c = Array.from({ length: radius }, (_, i) => 0.39894 * Math.exp(-0.5 * i * i / (sigma * sigma)) / sigma);
  const offsets = [];
  const weights = [];
  for (let i = 1; i < radius; i += 2) {
    const wa = c[i];
    const wb = i + 1 < radius ? c[i + 1] : 0;
    offsets.push((i * wa + (i + 1) * wb) / (wa + wb));
    weights.push(wa + wb);
  }
  return { centre: c[0], offsets, weights };
};

const createBloom = (pass) => {
  // Mip sizes as three rounds them: half resolution, then halving.
  const mips = BLOOM.kernels.map((_, i) => 0.5 / 2 ** i);
  const highPass = pass('bloomHigh', 'bbBloomHighPass', ['threshold', 'smoothWidth'], [], 1);
  highPass.onApply = (e) => { e.setFloat('threshold', BLOOM.threshold); e.setFloat('smoothWidth', 0.01); };

  const blurs = BLOOM.kernels.flatMap((radius, i) => {
    const k = blurKernel(radius);
    const blur = (dir, ratio) => {
      const p = pass(`bloomBlur${i}${dir}`, 'bbBloomBlur', ['invSize', 'direction', 'centerWeight', 'gaussianOffsets', 'gaussianWeights'], [], ratio, `#define KERNEL_PAIRS ${k.offsets.length}`);
      p.onApply = (e) => {
        // invSize is the mip this level renders at (three: 1 / level size, for both directions).
        e.setFloat2('invSize', 1 / Math.round(p.width * (dir === 'h' && i > 0 ? 0.5 : 1)), 1 / Math.round(p.height * (dir === 'h' && i > 0 ? 0.5 : 1)));
        e.setFloat2('direction', dir === 'h' ? 1 : 0, dir === 'h' ? 0 : 1);
        e.setFloat('centerWeight', k.centre);
        e.setFloatArray('gaussianOffsets', k.offsets);
        e.setFloatArray('gaussianWeights', k.weights);
      };
      return p;
    };
    // Horizontal pass i reads the previous level's vertical result (or the bright pass) at that level's size,
    // and writes at level i; vertical i reads and writes level i.
    return [blur('h', i === 0 ? mips[0] : mips[i - 1]), blur('v', mips[i])];
  });

  const composite = pass('bloomComposite', 'bbBloomComposite', ['strength', 'radius'], ['blur1', 'blur2', 'blur3', 'blur4', 'blur5'], mips[4]);
  const verticals = blurs.filter((_, k) => k % 2 === 1);
  composite.onApply = (e) => {
    verticals.forEach((v, i) => e.setTextureFromPostProcessOutput(`blur${i + 1}`, v));
    e.setFloat('strength', BLOOM.strength);
    e.setFloat('radius', BLOOM.radius);
  };
  const merge = pass('bloomMerge', 'bbBloomMerge', [], ['baseSampler'], mips[0]);
  merge.onApply = (e) => e.setTextureFromPostProcess('baseSampler', highPass);
  return [highPass, ...blurs, composite, merge];
};

// three's GTAOPass(radius 0.5, blend 0.85) has no Babylon equivalent; SSAO2 at full resolution stands in.
// SSAO2 occludes far more at the same settings (it darkens open floor), so its strength is matched by
// frame diff against the Three render, not copied: 0.25 lands within ~3/255 mean luma.
const createAO = (scene, camera) => {
  const ao = new SSAO2RenderingPipeline('bb-ao', scene, { ssaoRatio: 1, blurRatio: 1 }, [camera], true, HALF);
  ao.radius = 0.5;
  ao.totalStrength = 0.25;
  ao.base = 0;
  ao.samples = 16;
  ao.maxZ = camera.maxZ;
  ao.expensiveBlur = true;
  return ao;
};

/**
 * tier "high": AO + bloom + depth of field; "low": bloom only.
 * tint: page background as sRGB 0–1 (matches the CSS token exactly after grading).
 */
export const createPost = (scene, camera, { tier, tint }) => {
  const engine = scene.getEngine();
  const pass = (name, shader, uniforms, samplers, ratio, defines = null) => new PostProcess(
    name, shader, uniforms, samplers, ratio, null, Texture.BILINEAR_SAMPLINGMODE, engine, false, defines, HALF,
  );
  const high = tier === 'high';
  // Camera-space z for bokeh (every frame) and the glitch's depth slices (only during bursts).
  const depth = scene.enableDepthRenderer(camera, false, true, Texture.NEAREST_SAMPLINGMODE, true);
  depth.forceDepthWriteTransparentMeshes = true;   // three's depth passes include the additive rings and dust

  const ao = high ? createAO(scene, camera) : null;
  const bloom = createBloom(pass);

  let bokeh = null;
  if (high) {
    bokeh = pass('bokeh', 'bbBokeh', ['maxblur', 'aperture', 'focus', 'focusRange', 'aspect', 'farClip'], ['depthSampler'], 1);
    bokeh.focus = 12;
    bokeh.onApply = (e) => {
      e.setTexture('depthSampler', depth.getDepthMap());
      e.setFloat('maxblur', BOKEH.maxblur);
      e.setFloat('aperture', BOKEH.aperture);
      e.setFloat('focus', bokeh.focus);
      e.setFloat('focusRange', BOKEH.focusRange);
      e.setFloat('aspect', bokeh.width / bokeh.height);
      e.setFloat('farClip', camera.maxZ);
    };
  }

  // three's OutputPass: exposure, Khronos PBR Neutral, exact sRGB encode (engine useExactSrgbConversions).
  const output = new ImageProcessingPostProcess('output', 1, null, Texture.BILINEAR_SAMPLINGMODE, engine, false, HALF, scene.imageProcessingConfiguration);
  const glitch = createGlitchPass(engine, scene, camera, depth.getDepthMap());
  const grade = pass('grade', 'bbGrade', ['uTint', 'uLift', 'uVignette', 'uAberration', 'uGrain', 'uTime'], [], 1);
  let time = 0;
  grade.onApply = (e) => {
    e.setFloat3('uTint', ...tint);
    e.setFloat('uLift', GRADE.lift);
    e.setFloat('uVignette', GRADE.vignette);
    e.setFloat('uAberration', GRADE.aberration);
    e.setFloat('uGrain', GRADE.grain);
    e.setFloat('uTime', time);
  };

  const name = `bb-post-${tier}`;
  const pipeline = new PostProcessRenderPipeline(engine, name);
  const effects = [['bloom', bloom], ['bokeh', bokeh && [bokeh]], ['output', [output]], ['glitch', [glitch.pass]], ['grade', [grade]]];
  effects.filter(([, list]) => list).forEach(([effect, list]) => pipeline.addEffect(new PostProcessRenderEffect(engine, effect, () => list)));
  const manager = scene.postProcessRenderPipelineManager;
  manager.addPipeline(pipeline);
  manager.attachCamerasToRenderPipeline(name, camera);

  let glitchOn = true;
  return {
    update: (t, focus, dt, speed) => {
      time = t;
      if (GLITCH.enabled !== glitchOn) {
        glitchOn = GLITCH.enabled;
        manager[glitchOn ? 'enableEffectInPipeline' : 'disableEffectInPipeline'](name, 'glitch', camera);
      }
      if (glitchOn) glitch.update(t, dt, speed);
      if (bokeh) bokeh.focus = focus;
      depth.enabled = high || glitch.needsDepth();
    },
    isReady: () => [...bloom, bokeh, output, glitch.pass, grade].every((p) => !p || p.isReady()),
    dispose: () => {
      manager.detachCamerasFromRenderPipeline(name, camera);
      manager.removePipeline(name);
      pipeline.dispose();
      [...bloom, bokeh, output, grade].forEach((p) => p?.dispose(camera));
      glitch.dispose();
      ao?.dispose(false);
      scene.disableDepthRenderer(camera);
    },
  };
};

