import {
  BokehPass, EffectComposer, GTAOPass, OutputPass, RenderPass, ShaderPass, UnrealBloomPass,
  Vector2, Vector3,
} from '../vendor/three.module.js';

// Final grade in display space: lift toward the page's warm grey, vignette, aberration, grain.
const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTint: { value: new Vector3() },
    uLift: { value: 0.16 },
    uVignette: { value: 0.38 },
    uAberration: { value: 0.0065 },
    uGrain: { value: 0.045 },
    uTime: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec3 uTint;
    uniform float uLift, uVignette, uAberration, uGrain, uTime;
    varying vec2 vUv;

    float hash(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }

    void main() {
      vec2 c = vUv - 0.5;
      float r2 = dot(c, c);
      vec2 offset = c * uAberration * r2 * 4.0;
      vec3 col = vec3(
        texture2D(tDiffuse, vUv + offset).r,
        texture2D(tDiffuse, vUv).g,
        texture2D(tDiffuse, vUv - offset).b
      );
      col = mix(col, uTint, uLift);
      col *= 1.0 - uVignette * smoothstep(0.08, 0.5, r2);
      col += (hash(gl_FragCoord.xy + fract(uTime) * 917.0) - 0.5) * uGrain;
      gl_FragColor = vec4(col, 1.0);
    }
  `,
};

/**
 * tier "high": AO + bloom + depth of field; "low": bloom only.
 * tint: page background as sRGB 0–1 (matches the CSS token exactly after grading).
 */
export const createPost = (renderer, scene, camera, { tier, tint }) => {
  const size = renderer.getDrawingBufferSize(new Vector2());
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  let bokeh = null;
  if (tier === 'high') {
    const ao = new GTAOPass(scene, camera, size.x, size.y);
    ao.updateGtaoMaterial({ radius: 0.5, distanceExponent: 1.5, thickness: 1, scale: 1 });
    ao.blendIntensity = 0.85;
    composer.addPass(ao);
  }

  composer.addPass(new UnrealBloomPass(size.clone(), 0.32, 0.6, 0.95));

  if (tier === 'high') {
    bokeh = new BokehPass(scene, camera, { focus: 12, aperture: 0.002, maxblur: 0.0068 });
    composer.addPass(bokeh);
  }

  composer.addPass(new OutputPass());
  const grade = new ShaderPass(GradeShader);
  grade.uniforms.uTint.value.set(...tint);
  composer.addPass(grade);

  return {
    render: (time, focus) => {
      grade.uniforms.uTime.value = time;
      if (bokeh) bokeh.uniforms.focus.value = focus;
      composer.render();
    },
    setSize: (w, h) => composer.setSize(w, h),
    setPixelRatio: (ratio) => composer.setPixelRatio(ratio),
    dispose: () => composer.dispose(),
  };
};
