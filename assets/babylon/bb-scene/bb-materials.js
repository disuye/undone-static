import {
  Color3, Constants, DynamicTexture, PBRMaterial, ShaderMaterial, ShaderStore, Texture,
} from '../bb-vendor/babylon.module.js';
import { rng } from './bb-parts.js';

// Same canvases as the Three scene (drawing code is engine-agnostic), same seeds, so textures match pixel for pixel.
// Colours: three converts hex/sRGB to linear on input, so every colour here goes through toLinearSpace(exact).

let scene = null;
let fog = { color: new Color3(), density: 0 };
// Lab lights: hemi, 4 rect, key spot, uplight, core point. Babylon's default per-material limit is 4.
const MAX_LIGHTS = 8;

export const linear = (hex) => Color3.FromHexString(`#${hex.toString(16).padStart(6, '0')}`).toLinearSpace(true);

// Procedural textures: no image downloads, no third-party assets.
const canvasTexture = (size, draw, srgb) => {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  draw(canvas.getContext('2d', { willReadFrequently: true }), size);
  const texture = new DynamicTexture('canvas', canvas, scene, true, Texture.TRILINEAR_SAMPLINGMODE);
  texture.update(true);   // flipped like three's flipY
  texture.wrapU = texture.wrapV = Texture.WRAP_ADDRESSMODE;
  texture.anisotropicFilteringLevel = 8;
  texture.gammaSpace = srgb;
  return texture;
};

const speckle = (ctx, size, amount) => {
  const img = ctx.getImageData(0, 0, size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (Math.random() - 0.5) * amount;
    img.data[i] += n;
    img.data[i + 1] += n;
    img.data[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
};

// Tangent-space normal map from a drawn canvas's luminance: darker reads as recessed.
const normalFrom = (texture, strength = 3) => {
  const { width: w, height: h } = texture.getSize();
  const src = texture.getContext().getImageData(0, 0, w, h).data;
  const lum = (x, y) => src[(((y + h) % h) * w + ((x + w) % w)) * 4] / 255;
  return canvasTexture(w, (ctx) => {
    const out = ctx.createImageData(w, h);
    for (let y = 0; y < h; y += 1) {
      for (let x = 0; x < w; x += 1) {
        const nx = (lum(x - 1, y) - lum(x + 1, y)) * strength;
        const ny = (lum(x, y + 1) - lum(x, y - 1)) * strength;
        const len = Math.hypot(nx, ny, 1);
        out.data.set([(nx / len + 1) * 127.5, (ny / len + 1) * 127.5, (1 / len + 1) * 127.5, 255], (y * w + x) * 4);
      }
    }
    ctx.putImageData(out, 0, 0);
  }, false);
};

// One tile/panel: flat fill, inset bevel line, dark seam on the edge.
const tile = (ctx, x, y, s, [base, seam, inset]) => {
  ctx.fillStyle = base;
  ctx.fillRect(x, y, s, s);
  ctx.strokeStyle = inset;
  ctx.lineWidth = s * 0.004;
  ctx.strokeRect(x + s * 0.06, y + s * 0.06, s * 0.88, s * 0.88);
  ctx.strokeStyle = seam;
  ctx.lineWidth = s * 0.012;
  ctx.strokeRect(x, y, s, s);
};

// A grid of tiles per texture, so large-scale wear (polished walkways, scuffs) doesn't repeat every tile.
export const SHEET = 4;
const panelSheet = (tones, wear) => (ctx, size) => {
  const s = size / SHEET;
  for (let i = 0; i < SHEET * SHEET; i += 1) tile(ctx, (i % SHEET) * s, Math.floor(i / SHEET) * s, s, tones);
  if (wear) {
    const r = rng(19);
    for (let i = 0; i < 40; i += 1) {
      const x = r() * size;
      const y = r() * size;
      const rad = size * (0.05 + r() * 0.2);
      const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
      g.addColorStop(0, wear(0.08 + r() * 0.22));
      g.addColorStop(1, wear(0));
      ctx.fillStyle = g;
      ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
  }
  speckle(ctx, size, 10);
};

// Drawn once and shared by floor, walls and ceiling; each surface's tiling is baked into its UVs (lab.js).
const panelSet = (tones) => {
  const map = canvasTexture(1024, panelSheet(tones.colour), true);
  return {
    map,
    normalMap: normalFrom(map),
    roughnessMap: canvasTexture(1024, panelSheet(tones.roughness), false),
    worn: canvasTexture(1024, panelSheet(tones.roughness, tones.wear), false),
  };
};

const SURFACE = {
  colour: ['#e4e1da', '#a29f97', '#d6d3cc'],
  roughness: ['#8a8a8a', '#ffffff', '#b0b0b0'],
  wear: (a) => `rgba(20,20,20,${a})`,
};

/**
 * Field-worn white: grime blotches, drip streaks, scratches, a few panel lines.
 * Drawn twice from the same seed so colour and roughness line up.
 */
const weathering = (tone) => (ctx, size) => {
  const r = rng(7);
  ctx.fillStyle = tone.base;
  ctx.fillRect(0, 0, size, size);

  for (let i = 0; i < 260; i += 1) {
    const x = r() * size;
    const y = r() * size;
    const rad = 10 + r() * 110;
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, tone.grime(0.02 + r() * 0.07));
    g.addColorStop(1, tone.grime(0));
    ctx.fillStyle = g;
    ctx.fillRect(x - rad, y - rad, rad * 2, rad * 2);
  }

  for (let i = 0; i < 70; i += 1) {
    const x = r() * size;
    const y = r() * size;
    const len = 40 + r() * 260;
    const g = ctx.createLinearGradient(x, y, x, y + len);
    g.addColorStop(0, tone.grime(0.08 + r() * 0.1));
    g.addColorStop(1, tone.grime(0));
    ctx.fillStyle = g;
    ctx.fillRect(x, y, 1 + r() * 3, len);
  }

  ctx.lineCap = 'round';
  for (let i = 0; i < 380; i += 1) {
    const x = r() * size;
    const y = r() * size;
    const a = r() * Math.PI;
    const len = 4 + r() * 36;
    ctx.strokeStyle = r() > 0.4 ? tone.scratchLight : tone.scratchDark;
    ctx.lineWidth = 0.5 + r() * 1.2;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    ctx.stroke();
  }

  ctx.strokeStyle = tone.seam;
  ctx.lineWidth = 2;
  for (let i = 0; i < 6; i += 1) {
    const x = r() * size;
    const y = r() * size;
    ctx.strokeRect(x, y, 80 + r() * 300, 60 + r() * 200);
  }
  speckle(ctx, size, tone.noise);
};

const ARMOUR = {
  colour: {
    base: '#efede7', grime: (a) => `rgba(74,66,54,${a})`, seam: 'rgba(60,56,50,0.35)',
    scratchLight: 'rgba(255,255,255,0.45)', scratchDark: 'rgba(70,64,56,0.3)', noise: 8,
  },
  roughness: {
    base: '#6e6e6e', grime: (a) => `rgba(255,255,255,${a * 3})`, seam: 'rgba(255,255,255,0.6)',
    scratchLight: 'rgba(30,30,30,0.5)', scratchDark: 'rgba(255,255,255,0.5)', noise: 14,
  },
};

// Arm finish: same wear pattern, but lightly worn and smoother; between the armour and the orb shell.
const ARM = {
  colour: {
    ...ARMOUR.colour, base: '#f2f0eb', grime: (a) => `rgba(74,66,54,${a * 0.4})`,
    scratchLight: 'rgba(255,255,255,0.3)', scratchDark: 'rgba(70,64,56,0.12)', seam: 'rgba(60,56,50,0.25)', noise: 5,
  },
  roughness: {
    ...ARMOUR.roughness, base: '#474747', grime: (a) => `rgba(255,255,255,${a * 1.2})`,
    scratchLight: 'rgba(30,30,30,0.3)', scratchDark: 'rgba(255,255,255,0.25)', noise: 8,
  },
};

const wornMaps = (tones, relief) => {
  const map = canvasTexture(1024, weathering(tones.colour), true);
  return {
    map,
    roughnessMap: canvasTexture(1024, weathering(tones.roughness), false),
    normalMap: normalFrom(map, 2),
    normalScale: relief,
  };
};

// Painted floor marking: hazard-striped border, inner line, scuffed paint.
export const hazardTexture = ({ dashed = false } = {}) => {
  const texture = canvasTexture(1024, (ctx, size) => {
    const r = rng(dashed ? 11 : 3);
    const band = size * 0.07;
    ctx.clearRect(0, 0, size, size);

    if (dashed) {
      ctx.strokeStyle = '#fdfd0d';
      ctx.lineWidth = size * 0.022;
      ctx.setLineDash([size * 0.06, size * 0.04]);
      ctx.beginPath();
      ctx.arc(size / 2, size / 2, size / 2 - ctx.lineWidth, 0, Math.PI * 2);
      ctx.stroke();
    } else {
      ctx.save();
      ctx.beginPath();
      ctx.rect(0, 0, size, size);
      ctx.rect(band, band, size - band * 2, size - band * 2);
      ctx.clip('evenodd');
      ctx.fillStyle = '#fdfd0d';
      ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = '#121211';
      for (let x = -size; x < size * 2; x += band * 1.4) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x + band * 0.7, 0);
        ctx.lineTo(x + band * 0.7 - size, size);
        ctx.lineTo(x - size, size);
        ctx.fill();
      }
      ctx.restore();
      ctx.strokeStyle = '#fdfd0d';
      ctx.lineWidth = size * 0.008;
      ctx.strokeRect(band * 1.6, band * 1.6, size - band * 3.2, size - band * 3.2);
    }

    // Worn paint: punch holes where feet and trolleys have scuffed it.
    ctx.globalCompositeOperation = 'destination-out';
    for (let i = 0; i < 900; i += 1) {
      ctx.fillStyle = `rgba(0,0,0,${0.2 + r() * 0.8})`;
      ctx.beginPath();
      ctx.arc(r() * size, r() * size, 0.5 + r() * 5, 0, Math.PI * 2);
      ctx.fill();
    }
  }, true);
  texture.hasAlpha = true;
  return texture;
};

// Black-body colour (Tanner Helland fit, 1000–40000 K), normalised to full brightness. Returned linear.
export const kelvin = (k) => {
  const t = k / 100;
  const r = t <= 66 ? 255 : 329.698727446 * (t - 60) ** -0.1332047592;
  const g = t <= 66 ? 99.4708025861 * Math.log(t) - 161.1195681661 : 288.1221695283 * (t - 60) ** -0.0755148492;
  const b = t >= 66 ? 255 : t <= 19 ? 0 : 138.5177312231 * Math.log(t - 10) - 305.0447927307;
  const rgb = [r, g, b].map((v) => Math.min(Math.max(v, 0), 255));
  const peak = Math.max(...rgb);
  return new Color3(...rgb.map((v) => v / peak)).toLinearSpace(true);
};

export const CEILING_K = 12000;

/** MeshStandardMaterial / MeshPhysicalMaterial → PBRMaterial, with three's defaults (roughness 1, metalness 0). */
export const pbr = ({
  color = 0xffffff, roughness = 1, metalness = 0, map, normalMap, normalScale = 1, roughnessMap,
  clearcoat = 0, clearcoatRoughness = 0, doubleSide = false, scene: target = scene,
} = {}) => {
  const m = new PBRMaterial('pbr', target);
  m.albedoColor = typeof color === 'number' ? linear(color) : color;
  m.roughness = roughness;
  m.metallic = metalness;
  m.maxSimultaneousLights = MAX_LIGHTS;
  m.brdf.baseDiffuseModel = Constants.MATERIAL_DIFFUSE_MODEL_LAMBERT;   // three: Lambert; Babylon 9 defaults to EON
  m.useHorizonOcclusion = false;
  m.useRadianceOcclusion = false;
  if (map) m.albedoTexture = map;
  if (normalMap) {
    m.bumpTexture = normalMap;
    m.bumpTexture.level = normalScale;
    m.invertNormalMapY = true;   // OpenGL-convention map in a right-handed scene (as Babylon's glTF loader does)
  }
  if (roughnessMap) {
    // three reads roughness from G (and metalness from B); the maps are grey, so both see the same value.
    m.metallicTexture = roughnessMap;
    m.useRoughnessFromMetallicTextureAlpha = false;
    m.useRoughnessFromMetallicTextureGreen = true;
    m.useMetallnessFromMetallicTextureBlue = true;
  }
  if (clearcoat > 0) {
    m.clearCoat.isEnabled = true;
    m.clearCoat.intensity = clearcoat;
    m.clearCoat.roughness = clearcoatRoughness;
    m.clearCoat.remapF0OnInterfaceChange = false;   // three keeps the base F0 under the coat
  }
  if (doubleSide) {
    m.backFaceCulling = false;
    m.twoSidedLighting = true;
  }
  return m;
};

// ---------- unlit (three's MeshBasicMaterial): colour × optional sRGB map, exp² fog on view depth ----------

ShaderStore.ShadersStore.bbBasicVertexShader = /* glsl */ `
  precision highp float;
  attribute vec3 position;
  #ifdef MAP
    attribute vec2 uv;
    varying vec2 vUV;
  #endif
  uniform mat4 world, view, viewProjection;
  varying float vFogDepth;
  void main() {
    vec4 p = world * vec4(position, 1.0);
    #ifdef MAP
      vUV = uv;
    #endif
    vFogDepth = abs((view * p).z);
    gl_Position = viewProjection * p;
  }`;

ShaderStore.ShadersStore.bbBasicFragmentShader = /* glsl */ `
  precision highp float;
  uniform vec3 color;
  uniform float opacity;
  uniform vec3 fogColor;
  uniform float fogDensity;
  varying float vFogDepth;
  #ifdef MAP
    uniform sampler2D map;
    varying vec2 vUV;
    vec3 srgbToLinear(vec3 c) { return mix(c * 0.0773993808, pow(c * 0.9478672986 + 0.0521327014, vec3(2.4)), step(0.04045, c)); }
  #endif
  void main() {
    vec3 c = color;
    #ifdef MAP
      c *= srgbToLinear(texture2D(map, vUV).rgb);
    #endif
    #ifdef BB_FOG
      c = mix(c, fogColor, 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth));
    #endif
    gl_FragColor = vec4(c, opacity);
  }`;

const basicMaterials = [];

/** Unlit; colour is linear HDR (bloom reads > 1). additive: three's AdditiveBlending + depthWrite false. */
export const basic = ({ color, map = null, opacity = 1, additive = false, fogged = true, scene: target = scene }) => {
  // BB_FOG, not FOG: Babylon's ShaderMaterial defines FOG itself whenever the scene has fog.
  const defines = [map && 'MAP', fogged && 'BB_FOG'].filter(Boolean).map((d) => `#define ${d}`);
  const m = new ShaderMaterial('basic', target, 'bbBasic', {
    attributes: map ? ['position', 'uv'] : ['position'],
    uniforms: ['world', 'view', 'viewProjection', 'color', 'opacity', 'fogColor', 'fogDensity'],
    samplers: map ? ['map'] : [],
    defines,
    needAlphaBlending: additive,
  });
  m.settings = { color: color.clone(), map, opacity, additive, fogged, scene: target };
  if (map) m.setTexture('map', map);
  if (additive) {
    m.alphaMode = Constants.ALPHA_ADD;
    m.disableDepthWrite = true;
  }
  m.setColor3('color', color);
  m.setFloat('opacity', opacity);
  m.setColor3('fogColor', fog.color);
  m.setFloat('fogDensity', fog.density);
  if (fogged) basicMaterials.push(m);
  return m;
};

export const setBasicColor = (m, color) => m.setColor3('color', color);
export const setBasicOpacity = (m, opacity) => m.setFloat('opacity', opacity);
export const cloneBasic = (m) => basic(m.settings);

// Debug &holes switches the haze off for every unlit material too.
export const setBasicFog = (color, density) => {
  fog = { color, density };
  basicMaterials.forEach((m) => { m.setColor3('fogColor', color); m.setFloat('fogDensity', density); });
};

// Far end of the hall: a wall of backlit frosted panels between dark mullions, read through the haze.
// Unfogged so it stays a light source at 40 m; bloom supplies the glow.
const LIGHT_WALL = { cols: 5, rows: 2, intensity: 2.2 };
const lightWall = () => basic({
  map: canvasTexture(512, (ctx, size) => {
    const { cols, rows } = LIGHT_WALL;
    const pw = size / cols;
    const ph = size / rows;
    ctx.fillStyle = '#1b1c1e';
    ctx.fillRect(0, 0, size, size);
    for (let c = 0; c < cols; c += 1) {
      for (let r = 0; r < rows; r += 1) {
        const x = c * pw + pw / 2;
        const y = r * ph + ph / 2;
        const g = ctx.createRadialGradient(x, y, 0, x, y, Math.max(pw, ph) * 0.7);
        g.addColorStop(0, '#ffffff');
        g.addColorStop(1, '#b9bcc2');
        ctx.fillStyle = g;
        ctx.fillRect(c * pw + size * 0.012, r * ph + size * 0.012, pw - size * 0.024, ph - size * 0.024);
      }
    }
  }, true),
  color: kelvin(CEILING_K).scale(LIGHT_WALL.intensity),
  fogged: false,
});

const emissive = (hex, intensity) => basic({ color: (typeof hex === 'number' ? linear(hex) : hex).scale(intensity) });

const energy = (intensity, opacity) => basic({ color: linear(0xfff4e4).scale(intensity), opacity, additive: true });

const rubber = (color) => pbr({ color, roughness: 0.62 });

/** haze: { color (linear), density } shared by the PBR fog and the unlit materials. */
export const createMaterials = (s, haze) => {
  scene = s;
  fog = haze;
  const worn = wornMaps(ARMOUR, 0.4);
  const arm = wornMaps(ARM, 0.25);
  const panels = panelSet(SURFACE);
  const panel = (worn) => ({ map: panels.map, normalMap: panels.normalMap, normalScale: 0.5, roughnessMap: worn ? panels.worn : panels.roughnessMap });
  return {
    floor: pbr({ ...panel(true), color: 0xb4b0a7, roughness: 0.32 }),
    wall: pbr({ ...panel(false), color: 0xb3afa7, roughness: 0.8 }),
    ceiling: pbr({ ...panel(false), color: 0x9d9a93, roughness: 0.9 }),
    frame: pbr({ color: 0x9f9c94, roughness: 0.55 }),
    armour: pbr({ ...worn, color: 0xffffff, clearcoat: 0.15, clearcoatRoughness: 0.4 }),
    armourGrey: pbr({ ...worn, color: 0xd2cfc8, clearcoat: 0.1, clearcoatRoughness: 0.45 }),
    armShell: pbr({ ...arm, color: 0xffffff, clearcoat: 0.6, clearcoatRoughness: 0.18 }),
    armShellGrey: pbr({ ...arm, color: 0xdcd9d2, clearcoat: 0.45, clearcoatRoughness: 0.22 }),
    mech: pbr({ color: 0x8b8880, roughness: 0.5, metalness: 0.55 }),
    shell: pbr({ color: 0xf4f2ed, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.08 }),
    liner: pbr({ color: 0x2f2d2a, roughness: 0.7, metalness: 0.3 }),   // three BackSide: core.js flips the liner geometry instead
    horn: pbr({ color: 0x9c998f, roughness: 0.75, metalness: 0.1, doubleSide: true }),
    energy: energy(2.2, 0.55),
    energyHalo: energy(1.2, 0.1),
    steel: pbr({ color: 0x9a978f, roughness: 0.28, metalness: 1 }),
    cables: [rubber(0x1e1e1d), rubber(0x2e2d2b), rubber(0x55534e), rubber(0xd9d6cf), rubber(0xff5a2c)],
    housing: pbr({ color: 0x8f8c85, roughness: 0.7 }),
    screen: emissive(0xcfe0e4, 0.9),
    panel: emissive(0xfff9f0, 1.6),
    light: emissive(0xfffcf8, 3.2),
    tube: emissive(kelvin(CEILING_K), 3.2),
    lightWall: lightWall(),
    beamLight: emissive(kelvin(CEILING_K), 8),
    glow: emissive(0xfff8ef, 2.4),
    neon: emissive(0xfdfd0d, 1.4),
  };
};
