import * as THREE from 'three';
import { mulberry32, simplex2 } from './noise.js';

// ---------------------------------------------------------------------------
// Helpers: vertex-coloured, flat-shaded, mergeable parts
// ---------------------------------------------------------------------------
function ihash(a) {
  a = Math.imul(a ^ (a >>> 16), 0x7feb352d);
  a = Math.imul(a ^ (a >>> 15), 0x846ca68b);
  return (a ^ (a >>> 16)) >>> 0;
}

/** Deterministic per-position jitter: coincident vertices move together (no cracks). */
export function jitter(geo, amt, ampY = 0.5, seed = 0) {
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = ihash(Math.round(x * 997) * 31 + ihash(Math.round(y * 991) + ihash(Math.round(z * 983) + seed)));
    const r1 = (k & 1023) / 1023 - 0.5, r2 = ((k >>> 10) & 1023) / 1023 - 0.5, r3 = ((k >>> 20) & 1023) / 1023 - 0.5;
    p.setXYZ(i, x + r1 * amt, y + r2 * amt * ampY, z + r3 * amt);
  }
  return geo;
}

const _A = new THREE.Vector3(), _B = new THREE.Vector3(), _C = new THREE.Vector3();

/**
 * Convert to non-indexed, flat normals, vertex colours (+ aTint mask).
 * o.grad: [bottom, top] shade over the part height. o.top: colour for "top" faces.
 */
export function prep(geo, hex, o = {}) {
  const { tint = 1, grad = [1, 1], faceVar = 0.12, rng = Math.random, top = null, topAt = 0.6, topNormal = null,
    topRand = 0.15, smooth = false, sphere = null, sphereK = 0.7, ao = 0 } = o;
  let g = geo.index ? geo.toNonIndexed() : geo;
  for (const k of Object.keys(g.attributes)) if (k !== 'position' && k !== 'normal') g.deleteAttribute(k);
  if (!smooth) g.computeVertexNormals();
  else if (!g.attributes.normal) g.computeVertexNormals();
  if (sphere) {
    // soft "volumetric" foliage: bend normals towards the crown's radial direction
    const p = g.attributes.position, nn = g.attributes.normal;
    for (let i = 0; i < p.count; i++) {
      _A.set(p.getX(i) - sphere.x, (p.getY(i) - sphere.y) * 1.2, p.getZ(i) - sphere.z).normalize();
      _B.set(nn.getX(i), nn.getY(i), nn.getZ(i)).multiplyScalar(1 - sphereK).addScaledVector(_A, sphereK).normalize();
      nn.setXYZ(i, _B.x, _B.y, _B.z);
    }
  }
  const pos = g.attributes.position, nor = g.attributes.normal;
  const n = pos.count;
  g.computeBoundingBox();
  const minY = g.boundingBox.min.y, maxY = g.boundingBox.max.y, hY = maxY - minY || 1;
  const base = new THREE.Color(hex);
  const topC = top ? new THREE.Color(top) : null;
  const colors = new Float32Array(n * 3), tints = new Float32Array(n);
  for (let f = 0; f < n / 3; f++) {
    const fv = 1 + (rng() - 0.5) * faceVar;
    let isTop = false;
    if (topC) {
      _A.fromBufferAttribute(pos, f * 3); _B.fromBufferAttribute(pos, f * 3 + 1); _C.fromBufferAttribute(pos, f * 3 + 2);
      const cy = (_A.y + _B.y + _C.y) / 3;
      const fny = (nor.getY(f * 3) + nor.getY(f * 3 + 1) + nor.getY(f * 3 + 2)) / 3;
      if (topNormal !== null) isTop = fny > topNormal + (rng() - 0.5) * topRand;
      else isTop = (cy - minY) / hY > topAt + (rng() - 0.5) * topRand && fny > -0.2;
    }
    for (let k = 0; k < 3; k++) {
      const i = f * 3 + k;
      const t = (pos.getY(i) - minY) / hY;
      let gf = grad[0] + (grad[1] - grad[0]) * t;
      if (sphere && ao) {
        const r = Math.hypot(pos.getX(i) - sphere.x, pos.getY(i) - sphere.y, pos.getZ(i) - sphere.z);
        gf *= 1 - ao + ao * Math.min(1, r / (sphere.r || 1.5));
      }
      const c = isTop ? topC : base;
      const s = isTop ? fv : gf * fv;
      colors[i * 3] = c.r * s; colors[i * 3 + 1] = c.g * s; colors[i * 3 + 2] = c.b * s;
      tints[i] = isTop ? 0 : tint;
    }
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  g.setAttribute('aTint', new THREE.BufferAttribute(tints, 1));
  return g;
}

export function merge(list) {
  let n = 0;
  for (const g of list) n += g.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3), tin = new Float32Array(n);
  let o = 0;
  for (const g of list) {
    const c = g.attributes.position.count;
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    col.set(g.attributes.color.array, o * 3);
    tin.set(g.attributes.aTint.array, o);
    o += c;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setAttribute('aTint', new THREE.BufferAttribute(tin, 1));
  out.computeBoundingSphere();
  out.computeBoundingBox();
  return out;
}

// ---------------------------------------------------------------------------
// Vegetation & bank decor
// ---------------------------------------------------------------------------
const W = '#ffffff';

function pine(rng, snowy) {
  const parts = [];
  parts.push(prep(new THREE.CylinderGeometry(0.13, 0.22, 1.7, 6).translate(0, 0.85, 0), '#5b3c26', { tint: 0, grad: [0.6, 1], rng }));
  const layers = [[1.6, 2.5, 2.2], [1.22, 2.2, 3.25], [0.84, 1.9, 4.25]];
  layers.forEach(([r, h, y], i) => {
    const c = jitter(new THREE.ConeGeometry(r, h, 7, 1).translate(0, y, 0), 0.26, 0.4, i * 7 + 3);
    if (snowy) parts.push(prep(c, '#2d5a40', { tint: 0, grad: [0.55, 1.0], rng, top: '#f2f7fc', topAt: 0.42, topRand: 0.3, faceVar: 0.1 }));
    else parts.push(prep(c, W, { tint: 1, grad: [0.5, 1.0], rng, faceVar: 0.14 }));
  });
  return merge(parts);
}

function roundTree(rng, far) {
  const parts = [prep(new THREE.CylinderGeometry(0.12, 0.22, 2.4, far ? 4 : 6).translate(0, 1.2, 0), '#5e4330', { tint: 0, grad: [0.6, 1], rng })];
  // a few branches into the crown
  for (let i = 0; i < (far ? 0 : 3); i++) {
    const b = new THREE.CylinderGeometry(0.04, 0.08, 1.2, 5).translate(0, 0.6, 0).rotateZ(0.7).rotateY(i * 2.1).translate(0, 2.1, 0);
    parts.push(prep(b, '#5e4330', { tint: 0, rng }));
  }
  const C = new THREE.Vector3(0, 3.3, 0); C.r = 1.9;
  const blobs = [[0, 3.5, 0, 1.3], [0.85, 3.0, 0.35, 1.0], [-0.8, 3.1, -0.3, 1.05], [0.1, 2.8, -0.85, 0.9], [-0.2, 4.15, 0.3, 0.9],
    [0.55, 3.9, -0.55, 0.78], [-0.6, 3.6, 0.75, 0.8]];
  (far ? blobs.slice(0, 4) : blobs).forEach(([x, y, z, r], i) => {
    const g = jitter(new THREE.IcosahedronGeometry(r * (far ? 1.12 : 1), !far && i < 3 ? 1 : 0).translate(x, y, z), 0.2, 0.6, 11 + i);
    parts.push(prep(g, W, { tint: 1, grad: [0.55, 1.08], rng, faceVar: 0.1, sphere: C, sphereK: 0.78, ao: 0.4 }));
  });
  return merge(parts);
}

function bush(rng) {
  const parts = [];
  const C = new THREE.Vector3(0, 0.25, 0); C.r = 1.0;
  [[0, 0.45, 0, 0.75], [0.62, 0.32, 0.2, 0.55], [-0.55, 0.36, -0.25, 0.58], [0.15, 0.3, 0.6, 0.45]].forEach(([x, y, z, r], i) => {
    parts.push(prep(jitter(new THREE.IcosahedronGeometry(r, 0).translate(x, y, z), 0.1, 0.6, 31 + i), W, { tint: 1, grad: [0.55, 1.0], rng, faceVar: 0.08, sphere: C, sphereK: 0.8, ao: 0.3 }));
  });
  return merge(parts);
}

function grass(rng) {
  const parts = [];
  for (let i = 0; i < 9; i++) {
    const h = 0.35 + rng() * 0.45, w = 0.045 + rng() * 0.03;
    const a = rng() * Math.PI * 2, r = rng() * 0.32;
    const lean = (rng() - 0.5) * 0.7;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([-w, 0, 0, w, 0, 0, lean * 0.5 * h, h, 0.02, -w, 0, 0, lean * 0.5 * h, h, 0.02, w, 0, 0], 3));
    g.rotateY(rng() * Math.PI).translate(Math.cos(a) * r, 0, Math.sin(a) * r);
    parts.push(prep(g, W, { tint: 1, grad: [0.45, 1.15], rng, faceVar: 0.12 }));
  }
  return merge(parts);
}

function lantern(rng) {
  const parts = [];
  parts.push(prep(new THREE.CylinderGeometry(0.05, 0.07, 1.7, 6).translate(0, 0.85, 0), '#1c1a18', { tint: 0, rng, faceVar: 0.05 }));
  parts.push(prep(new THREE.BoxGeometry(0.42, 0.05, 0.05).translate(0.15, 1.66, 0), '#1c1a18', { tint: 0, rng, faceVar: 0.05 }));
  parts.push(prep(new THREE.ConeGeometry(0.16, 0.12, 4).rotateY(Math.PI / 4).translate(0.32, 1.6, 0), '#24201c', { tint: 0, rng, faceVar: 0.05 }));
  parts.push(prep(new THREE.IcosahedronGeometry(0.1, 1).scale(1, 1.3, 1).translate(0.32, 1.44, 0), '#ffcf8a', { tint: 0, rng, faceVar: 0.0 }));
  return merge(parts);
}

function reeds(rng) {
  const parts = [];
  for (let i = 0; i < 9; i++) {
    const h = 1.0 + rng() * 0.9;
    const a = rng() * Math.PI * 2, r = rng() * 0.45;
    const c = new THREE.ConeGeometry(0.045, h, 4).translate(0, h / 2, 0);
    c.rotateX((rng() - 0.5) * 0.35).rotateZ((rng() - 0.5) * 0.35).translate(Math.cos(a) * r, 0, Math.sin(a) * r);
    parts.push(prep(c, W, { tint: 1, grad: [0.45, 1.0], rng, faceVar: 0.1 }));
    if (i % 3 === 0) {
      const head = new THREE.CylinderGeometry(0.06, 0.06, 0.28, 5).translate(Math.cos(a) * r, h * 0.82, Math.sin(a) * r);
      parts.push(prep(head, '#5a3a22', { tint: 0, rng }));
    }
  }
  return merge(parts);
}

function boulder(rng, snowy, seed) {
  const g = jitter(new THREE.IcosahedronGeometry(1, 1), 0.42, 0.8, seed);
  g.scale(1, 0.72, 1).translate(0, 0.32, 0);
  if (snowy) return merge([prep(g, W, { tint: 1, grad: [0.7, 1.0], rng, top: '#f4f8fc', topNormal: 0.45, topRand: 0.25, faceVar: 0.14 })]);
  return merge([prep(g, W, { tint: 1, grad: [0.62, 1.0], rng, faceVar: 0.18 })]);
}

function cactus(rng) {
  const parts = [];
  const C = (rt, rb, h, x, y, z, rz = 0) => {
    const g = new THREE.CylinderGeometry(rt, rb, h, 8).rotateZ(rz).translate(x, y, z);
    parts.push(prep(g, W, { tint: 1, grad: [0.75, 1.0], rng, faceVar: 0.08 }));
  };
  const cap = (r, x, y, z) => parts.push(prep(new THREE.SphereGeometry(r, 8, 3, 0, Math.PI * 2, 0, Math.PI / 2).translate(x, y, z), W, { tint: 1, grad: [0.9, 1.0], rng, faceVar: 0.08 }));
  C(0.3, 0.34, 3.0, 0, 1.5, 0); cap(0.3, 0, 3.0, 0);
  C(0.17, 0.17, 0.6, 0.5, 1.35, 0, Math.PI / 2); C(0.19, 0.19, 1.2, 0.82, 1.9, 0); cap(0.19, 0.82, 2.5, 0);
  C(0.15, 0.15, 0.5, -0.45, 1.0, 0, Math.PI / 2); C(0.16, 0.16, 0.9, -0.72, 1.4, 0); cap(0.16, -0.72, 1.85, 0);
  const flower = new THREE.IcosahedronGeometry(0.1, 0).translate(0.05, 3.25, 0.1);
  parts.push(prep(flower, '#ff6a9a', { tint: 0, rng }));
  return merge(parts);
}

function leafStrip(L, Wd, droop) {
  const N = 6, verts = [];
  const sec = [];
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const x = t * L, y = 0.45 * t * L * 0.3 - droop * t * t;
    const w = Wd * Math.sin(Math.PI * Math.min(1, t * 1.08 + 0.02)) * 0.5 + 0.015;
    const fold = 0.07 * Math.sin(Math.PI * t);
    sec.push([[x, y, -w], [x, y + fold, 0], [x, y, w]]);
  }
  for (let i = 0; i < N; i++) {
    const [l0, m0, r0] = sec[i], [l1, m1, r1] = sec[i + 1];
    verts.push(...l0, ...m0, ...l1, ...m0, ...m1, ...l1, ...m0, ...r0, ...m1, ...r0, ...r1, ...m1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
  return g;
}

function palm(rng) {
  const parts = [];
  let topX = 0, topY = 0;
  for (let i = 0; i < 7; i++) {
    const x = 0.022 * i * i, y = i * 0.6 + 0.3;
    const g = new THREE.CylinderGeometry(0.14, 0.19, 0.64, 6).rotateZ(-0.05 * i).translate(x, y, 0);
    parts.push(prep(g, i % 2 ? '#7a5a3a' : '#8e6c46', { tint: 0, grad: [0.85, 1], rng, faceVar: 0.06 }));
    topX = 0.022 * 49 + 0.08; topY = y + 0.3;
  }
  const n = 8;
  for (let k = 0; k < n; k++) {
    const leaf = leafStrip(2.5 + rng() * 0.5, 0.62, 1.3 + rng() * 0.5);
    leaf.rotateZ(0.25 + rng() * 0.2).rotateY((k / n) * Math.PI * 2 + rng() * 0.3).translate(topX, topY, 0);
    parts.push(prep(leaf, W, { tint: 1, grad: [0.55, 1.0], rng, faceVar: 0.12 }));
  }
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2;
    parts.push(prep(new THREE.IcosahedronGeometry(0.13, 0).translate(topX + Math.cos(a) * 0.18, topY - 0.15, Math.sin(a) * 0.18), '#4a3020', { tint: 0, rng }));
  }
  return merge(parts);
}

function jungleTree(rng, far) {
  const parts = [prep(new THREE.CylinderGeometry(0.24, 0.45, 5.4, 7).translate(0, 2.7, 0), '#6a5a45', { tint: 0, grad: [0.55, 1], rng })];
  const C = new THREE.Vector3(0, 5.5, 0); C.r = 2.6;
  [[0, 5.7, 0, 2.2], [1.5, 5.1, 0.6, 1.6], [-1.4, 5.2, -0.5, 1.7], [0.1, 6.3, -0.2, 1.45], [0.4, 5.3, -1.4, 1.3], [-0.5, 5.0, 1.4, 1.3]].forEach(([x, y, z, r], i) => {
    if (far && i > 3) return;
    const g = jitter(new THREE.IcosahedronGeometry(r, far ? 0 : 1), 0.26, 0.6, 51 + i).scale(1, 0.52, 1).translate(x, y, z);
    parts.push(prep(g, W, { tint: 1, grad: [0.45, 1.0], rng, faceVar: 0.1, sphere: C, sphereK: 0.6, ao: 0.35 }));
  });
  for (let i = 0; i < 4; i++) {
    const a = rng() * Math.PI * 2, r = 0.8 + rng() * 1.2, h = 1.2 + rng() * 1.6;
    parts.push(prep(new THREE.CylinderGeometry(0.03, 0.03, h, 3).translate(Math.cos(a) * r, 5.1 - h / 2, Math.sin(a) * r), '#3a6a2a', { tint: 1, rng }));
  }
  return merge(parts);
}

function deadTree(rng) {
  const parts = [prep(new THREE.CylinderGeometry(0.07, 0.2, 3.6, 5).translate(0, 1.8, 0), W, { tint: 1, grad: [0.6, 1], rng })];
  const br = [[1.7, 0.9, 0], [2.3, -1.0, 1.6], [2.9, 0.8, 3.4], [3.3, -0.7, 4.6]];
  br.forEach(([y, rz, ry]) => {
    const g = new THREE.CylinderGeometry(0.025, 0.07, 1.5, 4).translate(0, 0.75, 0).rotateZ(rz).rotateY(ry).translate(0, y, 0);
    parts.push(prep(g, W, { tint: 1, grad: [0.7, 1], rng }));
  });
  return merge(parts);
}

function mushrooms(rng) {
  const parts = [];
  [[0, 0, 0.55, 0.33], [0.36, 0.2, 0.36, 0.22], [-0.3, -0.18, 0.42, 0.26]].forEach(([x, z, h, r]) => {
    parts.push(prep(new THREE.CylinderGeometry(0.05, 0.08, h, 6).translate(x, h / 2, z), '#2c3038', { tint: 0, rng }));
    parts.push(prep(new THREE.SphereGeometry(r, 9, 4, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.75, 1).translate(x, h, z), W, { tint: 1, grad: [0.75, 1.0], rng, faceVar: 0.05 }));
  });
  return merge(parts);
}

/** All bank decor geometries keyed by type */
export function buildDecorGeometries() {
  const rng = mulberry32(99);
  return {
    pine: pine(rng, false),
    snowPine: pine(rng, true),
    round: roundTree(rng),
    round_far: roundTree(rng, true),
    jungle_far: jungleTree(rng, true),
    bush: bush(rng),
    reeds: reeds(rng),
    boulder: boulder(rng, false, 5),
    snowBoulder: boulder(rng, true, 9),
    cactus: cactus(rng),
    palm: palm(rng),
    jungle: jungleTree(rng),
    deadTree: deadTree(rng),
    mushroom: mushrooms(rng),
    grass: grass(rng),
    lantern: lantern(rng),
  };
}

// ---------------------------------------------------------------------------
// Obstacles & pickups
// ---------------------------------------------------------------------------
function noise3(x, y, z) {
  return simplex2(x + z * 0.7, y) * 0.5 + simplex2(z - x * 0.3 + 17.1, y * 1.3 + 5.3) * 0.5;
}

/** River rock: colour.r = top mask, colour.g = shade (used by rock patch) */
export function rockGeometry(seed) {
  const rng = mulberry32(seed);
  const g = new THREE.IcosahedronGeometry(1, 2);
  const p = g.attributes.position;
  const ox = rng() * 50, oy = rng() * 50;
  // Displace along normal with coherent noise (positions are shared per vertex value)
  const cache = new Map();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const key = `${Math.round(x * 1e4)},${Math.round(y * 1e4)},${Math.round(z * 1e4)}`;
    let f = cache.get(key);
    if (f === undefined) {
      f = 1 + 0.26 * noise3(x * 1.3 + ox, y * 1.3 + oy, z * 1.3) + 0.1 * noise3(x * 3.1 + oy, y * 3.1, z * 3.1 + ox);
      cache.set(key, f);
    }
    let ny = y * f;
    if (ny < -0.2) ny = -0.2 + (ny + 0.2) * 0.4; // flatter base
    p.setXYZ(i, x * f, ny * 0.85, z * f);
  }
  g.computeVertexNormals();
  const n = p.count;
  const col = new Float32Array(n * 3);
  const nor = g.attributes.normal;
  for (let fI = 0; fI < n / 3; fI++) {
    const ny = (nor.getY(fI * 3) + nor.getY(fI * 3 + 1) + nor.getY(fI * 3 + 2)) / 3;
    const top = ny > 0.62 + (rng() - 0.5) * 0.2 ? 1 : 0;
    const shade = 0.78 + rng() * 0.22;
    for (let k = 0; k < 3; k++) { const i = fI * 3 + k; col[i * 3] = top; col[i * 3 + 1] = shade; col[i * 3 + 2] = 0; }
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  g.deleteAttribute('uv');
  return g;
}

export function logGeometry() {
  const rng = mulberry32(7);
  const g = jitter(new THREE.CylinderGeometry(0.4, 0.4, 1, 11, 5), 0.05, 0.0, 3).rotateZ(Math.PI / 2);
  // knots
  const out = prep(g, '#6b4a2f', { tint: 1, grad: [0.85, 1.0], rng, faceVar: 0.32 });
  const pos = out.attributes.position, nor = out.attributes.normal, colA = out.attributes.color, tA = out.attributes.aTint;
  const cap = new THREE.Color('#c99c66'), ring = new THREE.Color('#a77a48');
  for (let f = 0; f < pos.count / 3; f++) {
    if (Math.abs(nor.getX(f * 3)) > 0.9) {
      for (let k = 0; k < 3; k++) {
        const i = f * 3 + k;
        const r = Math.hypot(pos.getY(i), pos.getZ(i));
        const c = r > 0.3 ? ring : cap;
        colA.setXYZ(i, c.r, c.g, c.b); tA.setX(i, 0);
      }
    }
  }
  return out;
}

export function iceGeometry(seed) {
  const rng = mulberry32(seed);
  const shape = new THREE.Shape();
  const N = 7 + Math.floor(rng() * 3);
  for (let i = 0; i < N; i++) {
    const a = (i / N) * Math.PI * 2;
    const r = 0.75 + rng() * 0.35;
    const x = Math.cos(a) * r, y = Math.sin(a) * r;
    if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
  }
  shape.closePath();
  const g = new THREE.ExtrudeGeometry(shape, { depth: 0.3, bevelEnabled: true, bevelThickness: 0.12, bevelSize: 0.12, bevelSegments: 1 });
  g.rotateX(-Math.PI / 2).translate(0, -0.12, 0);
  return prep(g, '#a9dcef', { tint: 0, rng, top: '#f4fbff', topNormal: 0.7, topRand: 0.05, faceVar: 0.06 });
}

export function coinGeometry() {
  const rng = mulberry32(3);
  const rim = prep(new THREE.CylinderGeometry(0.44, 0.44, 0.1, 22).rotateX(Math.PI / 2), '#d99a14', { tint: 0, rng, faceVar: 0.02 });
  const face = prep(new THREE.CylinderGeometry(0.33, 0.33, 0.13, 22).rotateX(Math.PI / 2), '#ffd84a', { tint: 0, rng, faceVar: 0.0 });
  const star = new THREE.Shape();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + Math.PI / 2, r = i % 2 ? 0.09 : 0.2;
    if (i === 0) star.moveTo(Math.cos(a) * r, Math.sin(a) * r); else star.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  const sg = new THREE.ExtrudeGeometry(star, { depth: 0.16, bevelEnabled: false }).translate(0, 0, -0.08);
  const st = prep(sg, '#fff3b0', { tint: 0, rng, faceVar: 0 });
  return merge([rim, face, st]);
}

export function birdGeometry() {
  const body = new THREE.ConeGeometry(0.11, 0.62, 4).rotateX(-Math.PI / 2).toNonIndexed();
  const wing = new THREE.BufferGeometry();
  const v = [
    0, 0, -0.12, -0.95, 0.04, 0.08, 0, 0, 0.2,
    0, 0, -0.12, 0, 0, 0.2, 0.95, 0.04, 0.08,
  ];
  wing.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
  const tail = new THREE.BufferGeometry();
  tail.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0.2, -0.16, 0, 0.48, 0.16, 0, 0.48], 3));
  const parts = [body, wing, tail].map((g) => prep(g, W, { tint: 1, faceVar: 0.05 }));
  const out = merge(parts);
  const n = out.attributes.position.count;
  const wingA = new Float32Array(n);
  const bodyN = parts[0].attributes.position.count;
  for (let i = bodyN; i < bodyN + 6; i++) wingA[i] = 1;
  out.setAttribute('aWing', new THREE.BufferAttribute(wingA, 1));
  return out;
}

export function fishGeometry() {
  const rng = mulberry32(17);
  const body = prep(new THREE.SphereGeometry(0.25, 10, 7).scale(0.55, 0.75, 1.45), '#ff8a3a', { tint: 0, rng, top: '#d0572a', topNormal: 0.4, faceVar: 0.05, grad: [1.1, 0.8] });
  const tail = prep(new THREE.ConeGeometry(0.22, 0.32, 4).rotateX(Math.PI / 2).scale(0.25, 1, 1).translate(0, 0, 0.48), '#ffb36a', { tint: 0, rng });
  return merge([body, tail]);
}

export function shieldIconGeometry() {
  const s = new THREE.Shape();
  s.moveTo(0, 0.42);
  s.quadraticCurveTo(0.2, 0.32, 0.36, 0.34);
  s.quadraticCurveTo(0.38, -0.1, 0, -0.42);
  s.quadraticCurveTo(-0.38, -0.1, -0.36, 0.34);
  s.quadraticCurveTo(-0.2, 0.32, 0, 0.42);
  const g = new THREE.ExtrudeGeometry(s, { depth: 0.1, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 2 }).translate(0, 0, -0.05);
  return prep(g, '#7fe8ff', { tint: 0, faceVar: 0.02, smooth: false });
}

export function magnetIconGeometry() {
  const arc = prep(new THREE.TorusGeometry(0.28, 0.1, 8, 18, Math.PI).rotateZ(Math.PI), '#ff3b3b', { tint: 0, faceVar: 0.02 });
  const t1 = prep(new THREE.CylinderGeometry(0.1, 0.1, 0.16, 10).translate(0.28, 0.08, 0), '#eef2f5', { tint: 0, faceVar: 0.02 });
  const t2 = prep(new THREE.CylinderGeometry(0.1, 0.1, 0.16, 10).translate(-0.28, 0.08, 0), '#eef2f5', { tint: 0, faceVar: 0.02 });
  return merge([arc, t1, t2]);
}

// ---------------------------------------------------------------------------
// New obstacles: barrels, fallen trees, bridges, slalom gates
// ---------------------------------------------------------------------------
export function barrelGeometry() {
  const rng = mulberry32(41);
  const body = prep(new THREE.CylinderGeometry(0.4, 0.4, 1.05, 14, 6), W, { tint: 1, grad: [0.85, 1.0], rng, faceVar: 0.05 });
  const p = body.attributes.position;
  for (let i = 0; i < p.count; i++) { // bulge
    const y = p.getY(i), k = 1 + 0.07 * Math.cos((y / 0.525) * Math.PI * 0.5);
    p.setX(i, p.getX(i) * k); p.setZ(i, p.getZ(i) * k);
  }
  const bands = [];
  for (const y of [-0.36, 0.0, 0.36]) bands.push(prep(new THREE.CylinderGeometry(0.432, 0.432, 0.05, 14).translate(0, y, 0), '#2a2b2e', { tint: 0, rng, faceVar: 0.02 }));
  const lids = [prep(new THREE.CylinderGeometry(0.37, 0.37, 1.07, 14, 1, false).scale(1, 1, 1), '#3a3c40', { tint: 0, rng, top: '#55585e', topNormal: 0.5 })];
  const g = merge([body, ...bands, ...lids]);
  g.rotateZ(Math.PI / 2);
  return g;
}

export function fallenTreeGeometry(leafy) {
  const rng = mulberry32(leafy ? 61 : 62);
  const parts = [];
  // trunk lies along +X from the root (x=0) to the crown (x=L)
  const L = 7.2;
  const trunk = jitter(new THREE.CylinderGeometry(0.22, 0.42, L, 9, 6), 0.05, 0.0, 9).rotateZ(-Math.PI / 2).translate(L / 2, 0, 0);
  parts.push(prep(trunk, '#6a4a30', { tint: 0, grad: [0.75, 1.0], rng, faceVar: 0.2 }));
  // root plate
  const root = jitter(new THREE.CylinderGeometry(1.1, 0.8, 0.35, 10, 1), 0.25, 0.6, 5).rotateZ(Math.PI / 2).translate(-0.1, 0.25, 0);
  parts.push(prep(root, '#4a3424', { tint: 0, rng, faceVar: 0.3 }));
  // branches
  for (let i = 0; i < 7; i++) {
    const x = 2.2 + rng() * (L - 2.4), a = (rng() - 0.5) * 2.4, len = 1.0 + rng() * 1.4;
    const b = new THREE.CylinderGeometry(0.035, 0.09, len, 5).translate(0, len / 2, 0).rotateZ(-0.6 - rng() * 0.6).rotateX(a).translate(x, 0.05, 0);
    parts.push(prep(b, '#5e4330', { tint: 0, rng, faceVar: 0.2 }));
  }
  if (leafy) {
    const blobs = [[L - 0.6, 0.7, 0.2, 1.3], [L - 1.6, 0.9, -0.7, 1.05], [L - 1.4, 0.6, 0.9, 1.0], [L - 2.8, 0.7, 0.3, 0.9], [L + 0.3, 0.5, -0.4, 0.9], [L - 3.8, 0.5, -0.6, 0.7]];
    blobs.forEach(([x, y, z, r], i) => {
      const g = jitter(new THREE.IcosahedronGeometry(r, 1).scale(1, 0.75, 1).translate(x, y, z), 0.24, 0.6, 70 + i);
      parts.push(prep(g, W, { tint: 1, grad: [0.55, 1.05], rng, faceVar: 0.16 }));
    });
  }
  return merge(parts);
}

/** Bridge across the river. style: 'wood' | 'stone' | 'snow'. piers: x positions in the river. deck height h. */
export function bridgeGeometry(style, piers, halfSpan, h, rng) {
  const parts = [];
  const stone = style === 'stone';
  const wood = stone ? '#8a7a68' : '#7a5636';
  const dark = stone ? '#6e6152' : '#5a3e26';
  const snow = style === 'snow';
  const P = (g, c, o = {}) => parts.push(prep(g, c, { tint: 0, rng, faceVar: 0.12, ...(snow ? { top: '#f2f6fb', topNormal: 0.7, topRand: 0.05 } : {}), ...o }));
  const deckW = 2.8;
  // deck
  if (stone) {
    P(new THREE.BoxGeometry(halfSpan * 2, 0.7, deckW).translate(0, h, 0), wood);
    for (const s of [-1, 1]) P(new THREE.BoxGeometry(halfSpan * 2, 0.55, 0.3).translate(0, h + 0.62, s * (deckW / 2 - 0.15)), dark);
    // arches between piers
    const xs = [-halfSpan, ...piers, halfSpan].sort((a, b) => a - b);
    for (let i = 0; i < xs.length - 1; i++) {
      const a = xs[i], b = xs[i + 1], span = b - a;
      if (span < 1.5) continue;
      const arch = new THREE.CylinderGeometry(span / 2, span / 2, deckW * 0.96, 16, 1, true, -Math.PI / 2, Math.PI);
      arch.rotateX(Math.PI / 2).rotateZ(0).scale(1, Math.min(1, (h - 0.6) / (span / 2)), 1).translate((a + b) / 2, h - 0.35, 0);
      P(arch, dark, { faceVar: 0.2 });
    }
    for (const x of piers) {
      P(new THREE.BoxGeometry(1.5, h + 1.6, deckW * 0.95).translate(x, (h - 1.6) / 2, 0), wood, { faceVar: 0.18, grad: [0.7, 1] });
      P(new THREE.ConeGeometry(0.95, 1.4, 4).rotateY(Math.PI / 4).scale(1, 1, 1.25).translate(x, 0.3, -deckW * 0.55), wood); // cutwater
    }
  } else {
    P(new THREE.BoxGeometry(halfSpan * 2, 0.22, deckW).translate(0, h, 0), wood, { faceVar: 0.25 });
    // planks hint
    for (let x = -halfSpan; x < halfSpan; x += 0.9) P(new THREE.BoxGeometry(0.08, 0.05, deckW + 0.05).translate(x, h + 0.12, 0), dark);
    // railings
    for (const s of [-1, 1]) {
      for (let x = -halfSpan; x <= halfSpan; x += 1.6) P(new THREE.BoxGeometry(0.1, 1.0, 0.1).translate(x, h + 0.6, s * (deckW / 2 - 0.05)), dark);
      P(new THREE.BoxGeometry(halfSpan * 2, 0.08, 0.1).translate(0, h + 1.08, s * (deckW / 2 - 0.05)), wood);
      P(new THREE.BoxGeometry(halfSpan * 2, 0.06, 0.08).translate(0, h + 0.62, s * (deckW / 2 - 0.05)), wood);
    }
    // stringers
    for (const s of [-1, 1]) P(new THREE.BoxGeometry(halfSpan * 2, 0.35, 0.22).translate(0, h - 0.25, s * (deckW / 2 - 0.25)), dark);
    for (const x of [...piers, -halfSpan + 0.6, halfSpan - 0.6]) {
      for (const s of [-1, 1]) {
        const post = new THREE.CylinderGeometry(0.2, 0.26, h + 1.5, 7).translate(x, (h - 1.5) / 2, s * (deckW / 2 - 0.3));
        P(post, dark, { faceVar: 0.2, grad: [0.6, 1] });
      }
      // cross bracing
      const br = new THREE.BoxGeometry(0.1, Math.hypot(h, deckW) * 0.95, 0.1).rotateX(Math.atan2(deckW - 0.6, h)).translate(x, h / 2, 0);
      P(br, wood);
      P(new THREE.BoxGeometry(0.3, 0.25, deckW).translate(x, h - 0.45, 0), dark);
    }
  }
  return merge(parts);
}

/** striped slalom pole (hangs from y=0 down to -1.9) */
export function slalomPoleGeometry(colorA) {
  const parts = [];
  const rng = mulberry32(5);
  const n = 8, len = 1.9;
  for (let i = 0; i < n; i++) {
    const g = new THREE.CylinderGeometry(0.045, 0.045, len / n, 8).translate(0, -(i + 0.5) * (len / n), 0);
    parts.push(prep(g, i % 2 ? '#ffffff' : colorA, { tint: 0, rng, faceVar: 0.02 }));
  }
  const cord = new THREE.CylinderGeometry(0.008, 0.008, 1.0, 4).translate(0, 0.5, 0);
  parts.push(prep(cord, '#222222', { tint: 0, rng }));
  return merge(parts);
}

export function postGeometry(h) {
  const rng = mulberry32(6);
  return merge([prep(new THREE.CylinderGeometry(0.09, 0.12, h, 7).translate(0, h / 2, 0), '#5a5f66', { tint: 0, rng, grad: [0.7, 1] })]);
}
