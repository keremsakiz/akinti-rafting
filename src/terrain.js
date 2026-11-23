import * as THREE from 'three';
import { RIVER_HALF, CHUNK_LEN, NUM_CHUNKS, CHUNKS_BEHIND, TAU, smooth01, lerp } from './config.js';
import { simplex2, fbm2, mulberry32 } from './noise.js';
import { BIOMES, biomeAt, terrainParamsAt, makeTerrainParams, pickWeighted } from './biomes.js';
import { patchMaterial } from './patch.js';
import { buildDecorGeometries } from './geom.js';
import { propGeometry } from './obstacles.js';

// Kenney watercraft placed along the banks (type -> [model, scale, y offset])
const PROPS = { kFish: ['boat-fishing-small', 1.5, -0.35], kSail: ['boat-sail-a', 1.45, -0.3], kHouse: ['boat-house-a', 1.45, -0.35], kRow: ['boat-row-small', 1.3, -0.12], kDock: ['ramp', 1.25, -0.75] };

const COLS = 30;
const ROWS = CHUNK_LEN / 2 + 1; // 2 m row spacing
const ROW_STEP = CHUNK_LEN / (ROWS - 1);
const S_MIN = -2.6, S_MAX = 92;
const S_COLS = Array.from({ length: COLS }, (_, i) => S_MIN + (S_MAX - S_MIN) * Math.pow(i / (COLS - 1), 1.9));
const MAX_PER = 150;

let SEED_OFF = 0;

export function terrainHeight(s, d, side, P) {
  const so = (side > 0 ? 0 : 517.3) + SEED_OFF;
  const wig = Math.max(0, simplex2(d * 0.022 + so, 3.7)) * P.wiggle;
  const ss = s - wig;
  if (ss <= 0) return ss * 0.6;
  const bankRise = P.bank * smooth01(ss / 4.5);
  const hn = fbm2(d * 0.0085 + so, ss * 0.011 + 11.3, 4) * 0.5 + 0.5;
  const hills = hn * hn * P.hill * smooth01((ss - 3) / 32);
  const rough = simplex2(d * 0.07 + so, ss * 0.07 + 2.1) * 0.4 * P.rough * smooth01(ss / 3);
  let h = bankRise + hills + rough;
  if (P.cliff > 0.001) {
    const ws = 0.7 + (simplex2(d * 0.035 + so, 7.1) * 0.5 + 0.5) * 2.6;
    const wall = smooth01((ss - ws) / 2.0);
    const top = P.cliffH * (0.72 + 0.38 * (simplex2(d * 0.013 + so, 2.2) * 0.5 + 0.5));
    let plateau = top + hills * 0.35;
    if (P.mesa > 0.001) {
      const m = smooth01((fbm2(d * 0.012 + so, ss * 0.012 + 40, 3) - 0.05) / 0.12);
      plateau += P.mesa * m * 14 * smooth01((ss - 14) / 10);
    }
    h = lerp(h, wall * plateau + rough * 1.4, P.cliff);
  }
  return h;
}

const _TPw = makeTerrainParams();
/** distance (m) the actual waterline sits outside the nominal bank, per side (-1 left / 1 right) */
export function shoreWiggle(d, side) {
  terrainParamsAt(d, _TPw);
  const so = (side > 0 ? 0 : 517.3) + SEED_OFF;
  return Math.max(0, simplex2(d * 0.022 + so, 3.7)) * _TPw.wiggle;
}

function lavaMask(s, d, side, P) {
  if (P.lava < 0.01) return 0;
  const so = (side > 0 ? 0 : 517.3) + SEED_OFF;
  const n = Math.abs(simplex2(d * 0.016 + so, s * 0.04 + 9.0));
  const pool = smooth01((simplex2(d * 0.05 + so, s * 0.06 + 3.0) - 0.45) / 0.15) * smooth01((s - 3) / 2);
  return P.lava * Math.max(smooth01((0.13 - n) / 0.06), pool) * smooth01((s - 0.4) / 1.2);
}

const _rowP = Array.from({ length: ROWS + 2 }, () => makeTerrainParams());

function groundColor(out, h, slope, s, n, n2, P) {
  const g = P.g;
  if (s < 0.1 + n * 0.35) {
    out.copy(g.wet).lerp(g.shore, smooth01((s + 0.9) / 1.1));
  } else {
    out.copy(g.grass1).lerp(g.grass2, smooth01(n2 * 0.6 + 0.5));
    out.lerp(g.shore, 1 - smooth01((s - 0.9 - n * 0.6) / 1.6));
    if (P.strata > 0.01) {
      const band = Math.floor(h / 1.7 + n * 0.8);
      out.lerp(g.strata[((band % 4) + 4) % 4], P.strata * smooth01((slope - 0.16) / 0.2));
    }
    out.lerp(g.rock, smooth01((slope - 0.52) / 0.25) * (1 - P.strata * 0.7));
    if (P.snowLine < 150) out.lerp(g.snow, smooth01((h - P.snowLine + n * 2.0) / 3.0) * (1 - smooth01((slope - 0.62) / 0.2)));
  }
  return out;
}

const _c = new THREE.Color();
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);
const _bb = {};
const _TP = makeTerrainParams();

class Chunk {
  constructor(material, index) {
    const vc = COLS * ROWS * 2;
    const geo = new THREE.BufferGeometry();
    this.pos = new THREE.BufferAttribute(new Float32Array(vc * 3), 3);
    this.nor = new THREE.BufferAttribute(new Float32Array(vc * 3), 3);
    this.col = new THREE.BufferAttribute(new Float32Array(vc * 3), 3);
    this.glow = new THREE.BufferAttribute(new Float32Array(vc), 1);
    this.uv = new THREE.BufferAttribute(new Float32Array(vc * 2), 2);
    geo.setAttribute('position', this.pos);
    geo.setAttribute('normal', this.nor);
    geo.setAttribute('color', this.col);
    geo.setAttribute('aGlow', this.glow);
    geo.setAttribute('uv', this.uv);
    geo.setIndex(index);
    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.receiveShadow = true;
    this.mesh.frustumCulled = false;
    this.k = -9999;
    this.decor = {};
    this.h = new Float32Array(COLS * (ROWS + 2));
  }
}

export class Terrain {
  constructor(scene, detailTex) {
    this.scene = scene;
    this.seed = 1;
    // shared index buffer
    const idx = [];
    for (let side = 0; side < 2; side++) {
      const base = side * COLS * ROWS;
      for (let r = 0; r < ROWS - 1; r++) for (let c = 0; c < COLS - 1; c++) {
        const a = base + r * COLS + c, b = a + 1, cc = a + COLS, dd = cc + 1;
        if (side === 1) idx.push(a, b, cc, b, dd, cc);
        else idx.push(a, cc, b, b, cc, dd);
      }
    }
    const index = new THREE.BufferAttribute(new Uint16Array(idx), 1);
    this.material = patchMaterial(new THREE.MeshLambertMaterial({ vertexColors: true, map: detailTex }), { glow: true });
    this.chunks = [];
    for (let i = 0; i < NUM_CHUNKS; i++) {
      const ch = new Chunk(this.material, index);
      scene.add(ch.mesh);
      this.chunks.push(ch);
    }
    // decor instancing
    const geos = buildDecorGeometries();
    this.types = [...Object.keys(geos).filter((t) => !t.endsWith('_far')), ...Object.keys(PROPS)];
    const veg = patchMaterial(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), { sway: true, tint: true });
    const glowMat = patchMaterial(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), { tint: true, vcEmissive: true });
    const rockMat = patchMaterial(new THREE.MeshLambertMaterial({ vertexColors: true }), { tint: true });
    // two buckets per type: near the river (casts shadows) and far (no shadow pass)
    this.meshes = {};
    this.keys = [];
    const CAP = NUM_CHUNKS * MAX_PER;
    for (const t of this.types) {
      for (const b of ['n', 'f']) {
        const key = t + b;
        this.keys.push(key);
        if (!geos[t]) continue; // Kenney props: meshes are created in setProps()
        const mat = t === 'mushroom' || t === 'lantern' ? glowMat : t.includes('oulder') ? rockMat : veg;
        const m = new THREE.InstancedMesh(b === 'f' && geos[t + '_far'] ? geos[t + '_far'] : geos[t], mat, CAP);
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 3), 3);
        m.instanceColor.setUsage(THREE.DynamicDrawUsage);
        m.count = 0;
        m.visible = false;
        m.frustumCulled = false;
        m.castShadow = b === 'n' && !(t === 'reeds' || t === 'mushroom' || t === 'bush' || t === 'grass' || t === 'lantern');
        m.receiveShadow = true;
        // far and small decor is skipped in the water reflection pass
        if (b === 'f' || t === 'reeds' || t === 'bush' || t === 'grass' || t.includes('oulder')) m.layers.set(1);
        m.name = key;
        scene.add(m);
        this.meshes[key] = m;
      }
    }
    for (const ch of this.chunks) for (const k of this.keys) ch.decor[k] = { m: new Float32Array(MAX_PER * 16), c: new Float32Array(MAX_PER * 3), n: 0 };
  }

  setProps(props) {
    const CAP = NUM_CHUNKS * MAX_PER;
    for (const t of Object.keys(PROPS)) {
      const node = props[PROPS[t][0]];
      if (!node) continue;
      const { geo, mat } = propGeometry(node);
      const mm = mat.clone();
      mm.roughness = 0.7; mm.metalness = 0; mm.envMapIntensity = 0.5;
      const pm = patchMaterial(mm, {});
      for (const b of ['n', 'f']) {
        const m = new THREE.InstancedMesh(geo, pm, CAP);
        m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
        m.count = 0; m.visible = false; m.frustumCulled = false;
        m.castShadow = b === 'n'; m.receiveShadow = true;
        this.scene.add(m);
        this.meshes[t + b] = m;
      }
    }
    this.rebuildDecor();
  }

  setSeed(seed) {
    this.seed = seed;
    SEED_OFF = (seed % 997) * 3.71;
  }

  reset(dist) {
    const first = Math.floor(dist / CHUNK_LEN) - CHUNKS_BEHIND;
    this.chunks.forEach((ch, i) => this.generate(ch, first + i));
    this.rebuildDecor();
  }

  update(dist) {
    const first = Math.floor(dist / CHUNK_LEN) - CHUNKS_BEHIND;
    let changed = false;
    // regenerate at most 2 chunks per frame
    let budget = 2;
    for (const ch of this.chunks) {
      if (ch.k < first && budget > 0) {
        let maxK = -Infinity;
        for (const c2 of this.chunks) maxK = Math.max(maxK, c2.k);
        this.generate(ch, maxK + 1);
        changed = true;
        budget--;
      }
    }
    if (changed) this.rebuildDecor();
  }

  generate(ch, k) {
    ch.k = k;
    const d0 = k * CHUNK_LEN;
    // params per row (rows -1 .. ROWS)
    for (let r = -1; r <= ROWS; r++) terrainParamsAt(d0 + r * ROW_STEP, _rowP[r + 1]);
    const P = ch.pos.array, N = ch.nor.array, C = ch.col.array, GL = ch.glow.array, UV = ch.uv.array;
    const H = ch.h;
    for (let side = 0; side < 2; side++) {
      const sg = side === 0 ? -1 : 1;
      // heights incl. one extra row on each end for seamless normals
      for (let r = -1; r <= ROWS; r++) {
        const d = d0 + r * ROW_STEP, TPr = _rowP[r + 1];
        for (let c = 0; c < COLS; c++) H[(r + 1) * COLS + c] = terrainHeight(S_COLS[c], d, sg, TPr);
      }
      const base = side * COLS * ROWS;
      for (let r = 0; r < ROWS; r++) {
        const d = d0 + r * ROW_STEP, TPr = _rowP[r + 1];
        for (let c = 0; c < COLS; c++) {
          const s = S_COLS[c];
          const h = H[(r + 1) * COLS + c];
          const cl = c > 0 ? c - 1 : c, cr = c < COLS - 1 ? c + 1 : c;
          const dhds = (H[(r + 1) * COLS + cr] - H[(r + 1) * COLS + cl]) / (S_COLS[cr] - S_COLS[cl]);
          const dhdd = (H[(r + 2) * COLS + c] - H[r * COLS + c]) / (2 * ROW_STEP);
          const dhdx = sg * dhds, dhdz = -dhdd;
          let nx = -dhdx, ny = 1, nz = -dhdz;
          const l = Math.hypot(nx, ny, nz);
          nx /= l; ny /= l; nz /= l;
          const vi = base + r * COLS + c;
          const x = sg * (RIVER_HALF + s);
          P[vi * 3] = x; P[vi * 3 + 1] = h; P[vi * 3 + 2] = -d;
          N[vi * 3] = nx; N[vi * 3 + 1] = ny; N[vi * 3 + 2] = nz;
          UV[vi * 2] = x * 0.13; UV[vi * 2 + 1] = d * 0.13;
          const slope = 1 - ny;
          const n = simplex2(d * 0.13 + sg * 31.7, s * 0.13);
          const n2 = simplex2(d * 0.03 + sg * 11.1, s * 0.04 + 5.5);
          groundColor(_c, h, slope, s, n, n2, TPr);
          let gl = lavaMask(s, d, sg, TPr);
          if (gl > 0.01) _c.lerp(TPr.g.lava, Math.min(1, gl * 1.2));
          C[vi * 3] = _c.r; C[vi * 3 + 1] = _c.g; C[vi * 3 + 2] = _c.b;
          GL[vi] = gl;
        }
      }
    }
    ch.pos.needsUpdate = true; ch.nor.needsUpdate = true; ch.col.needsUpdate = true; ch.glow.needsUpdate = true; ch.uv.needsUpdate = true;
    this.genDecor(ch, k);
  }

  genDecor(ch, k) {
    for (const k of this.keys) ch.decor[k].n = 0;
    const rng = mulberry32((k * 9973 + this.seed * 7919) | 0);
    for (let side = -1; side <= 1; side += 2) {
      // first 64 tries: every biome (unchanged layout); extra tries only for dense biomes (rain forest)
      for (let i = 0; i < 128; i++) {
        const d = (k + rng()) * CHUNK_LEN;
        biomeAt(d, _bb);
        const B = BIOMES[rng() < _bb.t ? _bb.cur : _bb.prev];
        const r0 = rng(), r1 = rng(), r2 = rng(), r3 = rng(), r4 = rng(), r5 = rng(), r6 = rng();
        if (r0 * 64 > (i < 64 ? B.decorCount : B.extraDecor || 0)) continue;
        const e = pickWeighted(B.decor, B.decorTotal, r1);
        const sc = e.sc[0] + r4 * (e.sc[1] - e.sc[0]);
        let s = e.s[0] + Math.pow(r2, 1.35) * (e.s[1] - e.s[0]);
        if (e.type === 'boulder' || e.type === 'snowBoulder') s = Math.max(s, -0.35) + 0.85 * sc;
        if (e.type === 'reeds') s = Math.max(s, -0.25) + 0.3;
        terrainParamsAt(d, _TP);
        const h = terrainHeight(s, d, side, _TP);
        if (h < (e.minH ?? 0.08)) continue;
        if (e.maxH !== undefined && h > e.maxH) continue;
        const h2 = terrainHeight(s + 0.7, d, side, _TP), h3 = terrainHeight(s, d + 0.7, side, _TP);
        const slope = Math.max(Math.abs(h2 - h), Math.abs(h3 - h)) / 0.7;
        if (slope > (e.maxSlope ?? 0.75)) continue;
        if (lavaMask(s, d, side, _TP) > 0.2) continue;
        const dd = ch.decor[e.type + (s < 26 ? 'n' : 'f')];
        if (dd.n >= MAX_PER) continue;
        const pr = PROPS[e.type];
        if (pr) {
          // boats float parallel to the river, the jetty sits in the shallows
          _q.setFromAxisAngle(UP, (side > 0 ? 0 : Math.PI) + (r3 - 0.5) * 0.5);
          _s.setScalar(pr[1]);
          _m.compose(_p.set(side * (RIVER_HALF + s), Math.max(h, 0) * (e.type === 'kRow' ? 1 : 0) + pr[2], -d), _q, _s);
        } else {
          _q.setFromAxisAngle(UP, r3 * TAU);
          _s.set(sc, sc * (0.88 + r5 * 0.24), sc);
          _m.compose(_p.set(side * (RIVER_HALF + s), h - 0.1 * sc, -d), _q, _s);
        }
        _m.toArray(dd.m, dd.n * 16);
        const tint = e.tints[Math.floor(r6 * e.tints.length) % e.tints.length];
        const br = 0.86 + rng() * 0.26;
        dd.c[dd.n * 3] = tint.r * br; dd.c[dd.n * 3 + 1] = tint.g * br; dd.c[dd.n * 3 + 2] = tint.b * br;
        dd.n++;
      }
      // grass tufts: their own scatter pass so they don't thin out the trees
      const gB = BIOMES[biomeAt(k * CHUNK_LEN + CHUNK_LEN / 2, _bb).cur];
      const gr = gB.grass;
      if (!gr) continue;
      const dd = ch.decor['grassn'];
      for (let i = 0; i < gr.n && dd.n < MAX_PER; i++) {
        const d = (k + rng()) * CHUNK_LEN;
        const s = gr.s[0] + Math.pow(rng(), 1.6) * (gr.s[1] - gr.s[0]);
        terrainParamsAt(d, _TP);
        const h = terrainHeight(s, d, side, _TP);
        if (h < 0.03) continue;
        const sc = 0.8 + rng() * 0.7;
        _q.setFromAxisAngle(UP, rng() * TAU);
        _s.set(sc, sc * (0.8 + rng() * 0.5), sc);
        _m.compose(_p.set(side * (RIVER_HALF + s), h - 0.02, -d), _q, _s);
        _m.toArray(dd.m, dd.n * 16);
        const tint = gr.tints[Math.floor(rng() * gr.tints.length) % gr.tints.length];
        const br = 0.85 + rng() * 0.3;
        dd.c[dd.n * 3] = tint.r * br; dd.c[dd.n * 3 + 1] = tint.g * br; dd.c[dd.n * 3 + 2] = tint.b * br;
        dd.n++;
      }
    }
  }

  rebuildDecor() {
    for (const t of this.keys) {
      const mesh = this.meshes[t];
      if (!mesh) continue;
      const M = mesh.instanceMatrix.array, Cc = mesh.instanceColor ? mesh.instanceColor.array : null;
      let n = 0;
      for (const ch of this.chunks) {
        const dd = ch.decor[t];
        if (!dd.n) continue;
        M.set(dd.m.subarray(0, dd.n * 16), n * 16);
        if (Cc) Cc.set(dd.c.subarray(0, dd.n * 3), n * 3);
        n += dd.n;
      }
      mesh.count = n;
      mesh.visible = n > 0;
      if (n > 0) {
        mesh.instanceMatrix.clearUpdateRanges(); mesh.instanceMatrix.addUpdateRange(0, n * 16); mesh.instanceMatrix.needsUpdate = true;
        if (Cc) { mesh.instanceColor.clearUpdateRanges(); mesh.instanceColor.addUpdateRange(0, n * 3); mesh.instanceColor.needsUpdate = true; }
      }
    }
  }
}
