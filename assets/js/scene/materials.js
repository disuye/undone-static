import {
  AdditiveBlending, BackSide, CanvasTexture, Color, DoubleSide, MeshBasicMaterial, MeshPhysicalMaterial, MeshStandardMaterial,
  RepeatWrapping, SRGBColorSpace,
} from '../vendor/three.module.js';
import { rng } from './parts.js';

// Procedural textures: no image downloads, no third-party assets.
const canvasTexture = (size, draw, srgb) => {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  draw(canvas.getContext('2d'), size);
  const texture = new CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  texture.anisotropy = 8;
  if (srgb) texture.colorSpace = SRGBColorSpace;
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

// One tile/panel: flat fill, inset bevel line, dark seam on the edge.
const panel = (base, seam, inset) => (ctx, size) => {
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = inset;
  ctx.lineWidth = size * 0.004;
  ctx.strokeRect(size * 0.06, size * 0.06, size * 0.88, size * 0.88);
  ctx.strokeStyle = seam;
  ctx.lineWidth = size * 0.012;
  ctx.strokeRect(0, 0, size, size);
  speckle(ctx, size, 10);
};

const panelMaps = (repeatX, repeatY, tones) => {
  const map = canvasTexture(512, panel(...tones.colour), true);
  const roughnessMap = canvasTexture(512, panel(...tones.roughness), false);
  [map, roughnessMap].forEach((t) => t.repeat.set(repeatX, repeatY));
  return { map, roughnessMap };
};

const SURFACE = {
  colour: ['#e4e1da', '#a29f97', '#d6d3cc'],
  roughness: ['#8a8a8a', '#ffffff', '#b0b0b0'],
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

const armourMaps = () => ({
  map: canvasTexture(1024, weathering(ARMOUR.colour), true),
  roughnessMap: canvasTexture(1024, weathering(ARMOUR.roughness), false),
});

// Painted floor marking: hazard-striped border, inner line, scuffed paint.
export const hazardTexture = ({ dashed = false } = {}) => canvasTexture(1024, (ctx, size) => {
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

export const dustSprite = () => canvasTexture(64, (ctx, size) => {
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
}, true);

const emissive = (hex, intensity) => new MeshBasicMaterial({
  color: new Color(hex).multiplyScalar(intensity),
});

const energy = (intensity, opacity) => new MeshBasicMaterial({
  color: new Color(0xfff4e4).multiplyScalar(intensity),
  transparent: true, opacity, blending: AdditiveBlending, depthWrite: false,
});

const rubber = (color) => new MeshStandardMaterial({ color, roughness: 0.62 });

export const createMaterials = (room) => {
  const worn = armourMaps();
  return {
    floor: new MeshStandardMaterial({
      ...panelMaps(room.width / 1.2, room.length / 1.2, SURFACE),
      color: 0xb4b0a7, roughness: 0.32,
    }),
    wall: new MeshStandardMaterial({
      ...panelMaps(room.length / 1.6, room.height / 2.6, SURFACE),
      color: 0xb3afa7, roughness: 0.8,
    }),
    ceiling: new MeshStandardMaterial({
      ...panelMaps(room.width / 2, room.length / 2, SURFACE),
      color: 0x9d9a93, roughness: 0.9,
    }),
    frame: new MeshStandardMaterial({ color: 0x9f9c94, roughness: 0.55 }),
    armour: new MeshPhysicalMaterial({ ...worn, color: 0xffffff, clearcoat: 0.35, clearcoatRoughness: 0.35 }),
    armourGrey: new MeshPhysicalMaterial({ ...worn, color: 0xd2cfc8, clearcoat: 0.2, clearcoatRoughness: 0.4 }),
    mech: new MeshStandardMaterial({ color: 0x8b8880, roughness: 0.5, metalness: 0.55 }),
    shell: new MeshPhysicalMaterial({ color: 0xf4f2ed, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.08 }),
    liner: new MeshStandardMaterial({ color: 0x2f2d2a, roughness: 0.7, metalness: 0.3, side: BackSide }),
    horn: new MeshStandardMaterial({ color: 0x9c998f, roughness: 0.75, metalness: 0.1, side: DoubleSide }),
    energy: energy(2.2, 0.55),
    energyHalo: energy(1.2, 0.1),
    steel: new MeshStandardMaterial({ color: 0x9a978f, roughness: 0.28, metalness: 1 }),
    cables: [rubber(0x1e1e1d), rubber(0x2e2d2b), rubber(0x55534e), rubber(0xd9d6cf), rubber(0xff5a2c)],
    housing: new MeshStandardMaterial({ color: 0x8f8c85, roughness: 0.7 }),
    screen: emissive(0xcfe0e4, 0.9),
    panel: emissive(0xfff9f0, 1.6),
    light: emissive(0xfffcf8, 3.2),
    beamLight: emissive(0xfffcf8, 8),
    glow: emissive(0xfff8ef, 2.4),
    neon: emissive(0xfdfd0d, 1.4),
  };
};
