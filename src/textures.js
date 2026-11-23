import * as THREE from 'three';
import { periodicNoise, mulberry32 } from './noise.js';

function dataTex(data, S, opts = {}) {
  const tex = new THREE.DataTexture(data, S, S, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = opts.aniso || 4;
  tex.colorSpace = opts.srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  tex.needsUpdate = true;
  return tex;
}

// RGB = ripple normal (tangent space), A = height noise (used for foam, clouds, mountains)
export function makeWaterTexture() {
  const S = 256;
  const h = periodicNoise(S, [4, 8, 16, 32, 64], [1, 0.6, 0.34, 0.18, 0.09], 4242);
  const data = new Uint8Array(S * S * 4);
  const k = 7.0;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const hx = h[((x + 1) % S) + y * S] - h[((x - 1 + S) % S) + y * S];
      const hy = h[x + ((y + 1) % S) * S] - h[x + ((y - 1 + S) % S) * S];
      let nx = -hx * k, ny = -hy * k, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      nx /= l; ny /= l; nz /= l;
      const i = (x + y * S) * 4;
      data[i] = (nx * 0.5 + 0.5) * 255;
      data[i + 1] = (ny * 0.5 + 0.5) * 255;
      data[i + 2] = (nz * 0.5 + 0.5) * 255;
      data[i + 3] = h[x + y * S] * 255;
    }
  }
  return dataTex(data, S);
}

/**
 * Small-scale river ripples: a tileable sum of directional, slightly sharpened waves
 * (mostly travelling along the flow) -> RG = slope (normal xy), B = crest mask, A = height.
 */
export function makeRippleTexture() {
  const S = 256;
  const rnd = mulberry32(9137);
  const waves = [];
  for (let i = 0; i < 46; i++) {
    const kmag = 3 + Math.pow(rnd(), 1.6) * 26;
    const ang = (rnd() - 0.5) * 2.2 + (rnd() < 0.2 ? Math.PI / 2 : 0);
    const kx = Math.round(Math.sin(ang) * kmag), ky = Math.round(Math.cos(ang) * kmag);
    if (kx === 0 && ky === 0) continue;
    const km = Math.hypot(kx, ky);
    waves.push({ kx, ky, a: Math.pow(km, -1.35), ph: rnd() * Math.PI * 2 });
  }
  const h = new Float32Array(S * S);
  let mn = Infinity, mx = -Infinity;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      let v = 0;
      for (const w of waves) {
        const t = ((w.kx * x + w.ky * y) / S) * Math.PI * 2 + w.ph;
        // trochoid-ish: sharper crests, wider troughs
        const s = Math.sin(t);
        v += w.a * (s - 0.12 * s * s);
      }
      h[x + y * S] = v;
      if (v < mn) mn = v; if (v > mx) mx = v;
    }
  }
  const kk = 1 / (mx - mn);
  for (let i = 0; i < h.length; i++) h[i] = (h[i] - mn) * kk;
  const data = new Uint8Array(S * S * 4);
  const str = 6.0;
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const hx = h[((x + 1) % S) + y * S] - h[((x - 1 + S) % S) + y * S];
      const hy = h[x + ((y + 1) % S) * S] - h[x + ((y - 1 + S) % S) * S];
      const lap = h[((x + 1) % S) + y * S] + h[((x - 1 + S) % S) + y * S] + h[x + ((y + 1) % S) * S] + h[x + ((y - 1 + S) % S) * S] - 4 * h[x + y * S];
      let nx = -hx * str, ny = -hy * str, nz = 1;
      const l = Math.hypot(nx, ny, nz);
      const i = (x + y * S) * 4;
      data[i] = (nx / l * 0.5 + 0.5) * 255;
      data[i + 1] = (ny / l * 0.5 + 0.5) * 255;
      data[i + 2] = Math.max(0, Math.min(255, (-lap * 40 + 0.15) * 255));
      data[i + 3] = h[x + y * S] * 255;
    }
  }
  return dataTex(data, S, { aniso: 8 });
}

/** Tileable Worley distances (F1, F2) for a jittered grid of n x n cells */
function worley(S, n, seed) {
  const rnd = mulberry32(seed);
  const pts = new Float32Array(n * n * 2);
  for (let i = 0; i < n * n; i++) { pts[i * 2] = rnd(); pts[i * 2 + 1] = rnd(); }
  const F1 = new Float32Array(S * S), F2 = new Float32Array(S * S);
  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const u = (x / S) * n, v = (y / S) * n;
      const cx = Math.floor(u), cy = Math.floor(v);
      let d1 = 9, d2 = 9;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        const gx = cx + ox, gy = cy + oy;
        const wx = ((gx % n) + n) % n, wy = ((gy % n) + n) % n;
        const px = gx + pts[(wx + wy * n) * 2], py = gy + pts[(wx + wy * n) * 2 + 1];
        const d = Math.hypot(px - u, py - v);
        if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
      }
      F1[x + y * S] = d1; F2[x + y * S] = d2;
    }
  }
  return { F1, F2 };
}

/**
 * Foam & riverbed texture.
 * R = foam lace (white network of bubbles), G = caustics web, B = pebbles (riverbed), A = bubbles
 */
export function makeFoamTexture() {
  const S = 256;
  const lace = worley(S, 9, 71), fine = worley(S, 22, 72), caus = worley(S, 7, 73), peb = worley(S, 14, 74);
  const n = periodicNoise(S, [8, 16, 32], [1, 0.5, 0.25], 75);
  const data = new Uint8Array(S * S * 4);
  const ss = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  for (let i = 0; i < S * S; i++) {
    // whitewater foam: soft patches with irregular dark holes (not a thin web)
    const edge = lace.F2[i] - lace.F1[i];
    const l = 1 - ss(0.0, 0.42, edge);
    const holes = ss(0.12, 0.42, fine.F1[i]);
    const b = 1 - ss(0.15, 0.42, fine.F1[i]);
    const foam = Math.min(1, (l * 0.55 + n[i] * 0.45) * (0.55 + 0.45 * holes) + b * 0.12);
    const c = Math.pow(1 - ss(0.0, 0.42, caus.F2[i] - caus.F1[i]), 2.2);
    const p = (1 - ss(0.0, 0.85, peb.F1[i])) * 0.75 + n[i] * 0.25;
    data[i * 4] = foam * 255;
    data[i * 4 + 1] = c * 255;
    data[i * 4 + 2] = p * 255;
    data[i * 4 + 3] = b * 255;
  }
  return dataTex(data, S);
}

// Grayscale detail map multiplied over terrain / bark vertex colors
export function makeDetailTexture() {
  const S = 256;
  const h = periodicNoise(S, [8, 16, 32, 64, 128], [1, 0.75, 0.5, 0.38, 0.25], 777);
  const g = worley(S, 40, 778);
  const data = new Uint8Array(S * S * 4);
  for (let i = 0; i < S * S; i++) {
    const pebble = Math.min(1, g.F1[i] * 1.6);
    const v = 170 + h[i] * 70 + pebble * 15;
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = Math.min(255, v);
    data[i * 4 + 3] = 255;
  }
  return dataTex(data, S);
}

/**
 * Canvas textures for the raft tube. v: 0 bottom, .25 outside, .5 top, .75 inside (canvas y = (1-v)*H).
 * skin: { base, pattern: solid|neon|camo|flame|stripe|gold, accent, logo } -> { map, emissive|null }
 */
export function makeRaftTexture(skin = {}) {
  const base = skin.base || '#d9441a', accent = skin.accent || '#ffffff', pattern = skin.pattern || 'solid';
  const W = 1024, H = 128;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.fillStyle = base;
  g.fillRect(0, 0, W, H);
  const rnd = mulberry32(77);
  let em = null;
  if (pattern === 'camo') {
    const cols = ['#3d4a28', '#6b5a3a', '#2a3320', '#7d8a52'];
    for (let i = 0; i < 260; i++) {
      g.fillStyle = cols[i % cols.length];
      g.beginPath();
      g.ellipse(rnd() * W, rnd() * H, 14 + rnd() * 34, 8 + rnd() * 16, rnd() * Math.PI, 0, Math.PI * 2);
      g.fill();
    }
  } else if (pattern === 'flame') {
    // flame tongues licking up the outer side, from the bow backwards
    for (const side of [0, 1]) {
      for (let k = 0; k < 9; k++) {
        const x0 = side * W / 2 + 40 + k * 44, yb = H * 0.84, yt = H * (0.48 + rnd() * 0.08);
        const gr = g.createLinearGradient(0, yb, 0, yt);
        gr.addColorStop(0, '#ff3a0a'); gr.addColorStop(0.55, accent); gr.addColorStop(1, '#fff3b0');
        g.fillStyle = gr;
        g.beginPath();
        g.moveTo(x0, yb);
        g.quadraticCurveTo(x0 + 6, H * 0.66, x0 + 46, yt);
        g.quadraticCurveTo(x0 + 26, H * 0.66, x0 + 40, yb);
        g.closePath();
        g.fill();
      }
    }
  } else if (pattern === 'stripe') {
    g.fillStyle = accent; g.fillRect(0, H * 0.6, W, H * 0.12);
    g.fillStyle = skin.accent2 || '#1d3c6e'; g.fillRect(0, H * 0.74, W, H * 0.03);
  } else if (pattern === 'gold') {
    for (let y = 0; y < H; y++) { g.fillStyle = `rgba(255,255,255,${(rnd() * 0.08).toFixed(3)})`; g.fillRect(0, y, W, 1); }
  }
  if (pattern === 'neon') {
    // glowing piping along the tube (also written to an emissive map)
    const ecv = document.createElement('canvas');
    ecv.width = W; ecv.height = H;
    const e = ecv.getContext('2d');
    e.fillStyle = '#000'; e.fillRect(0, 0, W, H);
    for (const ctx of [g, e]) {
      ctx.fillStyle = accent;
      ctx.fillRect(0, H * 0.6, W, 3);
      ctx.fillRect(0, H * 0.79, W, 3);
      ctx.fillRect(0, H * 0.43, W, 2);
    }
    em = new THREE.CanvasTexture(ecv);
    em.wrapS = em.wrapT = THREE.RepeatWrapping; em.colorSpace = THREE.SRGBColorSpace;
  }
  // shading/wear: darker underside and inner side
  const gr = g.createLinearGradient(0, 0, 0, H);
  gr.addColorStop(0.0, 'rgba(0,0,0,0.35)'); gr.addColorStop(0.25, 'rgba(0,0,0,0.12)');
  gr.addColorStop(0.5, 'rgba(255,255,255,0.0)'); gr.addColorStop(0.72, 'rgba(0,0,0,0.0)');
  gr.addColorStop(0.92, 'rgba(0,0,0,0.25)'); gr.addColorStop(1.0, 'rgba(0,0,0,0.4)');
  g.fillStyle = gr; g.fillRect(0, 0, W, H);
  // rub strip on the outside near the waterline
  g.fillStyle = 'rgba(22,22,26,0.9)';
  g.fillRect(0, H * 0.83, W, H * 0.085);
  g.fillStyle = 'rgba(255,255,255,0.08)';
  g.fillRect(0, H * 0.83, W, 2);
  // chamber seams (glued overlaps)
  for (let i = 0; i < 6; i++) {
    const x = (i + 0.5) * (W / 6);
    g.fillStyle = 'rgba(40,10,0,0.3)'; g.fillRect(x - 3, 0, 6, H);
    g.fillStyle = 'rgba(255,255,255,0.10)'; g.fillRect(x + 3, 0, 1, H);
  }
  // valves on top
  for (let i = 0; i < 6; i++) {
    const x = (i + 0.2) * (W / 6), y = H * 0.5;
    g.fillStyle = '#d6d6d6'; g.beginPath(); g.ellipse(x, y, 8, 5, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#4a4a4a'; g.beginPath(); g.ellipse(x, y, 3.5, 2.2, 0, 0, Math.PI * 2); g.fill();
  }
  // printed logo on both long sides (mirrored: u runs right-to-left seen from outside)
  g.font = '800 38px "Baloo 2", system-ui, sans-serif';
  g.textAlign = 'center'; g.textBaseline = 'middle';
  for (const u of [0.25, 0.75]) {
    g.save();
    g.translate(u * W, H * 0.69);
    g.scale(-1, 0.6);
    g.fillStyle = skin.logo || 'rgba(255,255,255,0.93)';
    g.fillText('AKINTI', 0, 0);
    g.restore();
  }
  const tex = new THREE.CanvasTexture(cv);
  tex.wrapS = THREE.RepeatWrapping; tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return { map: tex, emissive: em };
}
