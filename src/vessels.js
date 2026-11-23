// ---------------------------------------------------------------------------
// Vessels for the BOT tab: inflatable raft (built in raft.js), motor RIB, sailboat,
// racing yacht, ship and submarine. All fit the raft's footprint so the hitbox,
// and with it the difficulty, never changes. Each vessel has its own perk.
// Kenney Watercraft Kit models (CC0) for the sailboat, yacht and ship; the RIB and
// the submarine are procedural so the shop patterns (DESEN) can paint them.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { TAU } from './config.js';
import { patchMaterial } from './patch.js';

const std = (o) => patchMaterial(new THREE.MeshStandardMaterial(o), {});
const shadowy = (m) => { m.castShadow = true; m.receiveShadow = true; return m; };

// ---------------------------------------------------------------------------
// Generic tube along a path (used by the RIB). centres/outs: Vector3 arrays, radii: number[]
// u runs along the path, v around (0 bottom, .25 outside, .5 top, .75 inside)
// ---------------------------------------------------------------------------
export function tubeAlong(centres, outs, radii, M = 20) {
  const pos = [], nor = [], uv = [], idx = [];
  const N = centres.length - 1;
  for (let i = 0; i <= N; i++) {
    const p = centres[i], o = outs[i], r = radii[i];
    for (let j = 0; j <= M; j++) {
      const a = (j / M) * TAU - Math.PI / 2;
      const nx = Math.cos(a) * o.x, ny = Math.sin(a), nz = Math.cos(a) * o.z;
      pos.push(p.x + nx * r, p.y + ny * r, p.z + nz * r);
      nor.push(nx, ny, nz);
      uv.push(i / N, j / M);
    }
  }
  for (let i = 0; i < N; i++) for (let j = 0; j < M; j++) {
    const a = i * (M + 1) + j, b = a + M + 1;
    idx.push(a, a + 1, b, a + 1, b + 1, b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** sample a polyline path evenly; returns centres + outward (horizontal) normals */
function samplePath(fn, n) {
  // fn(t) -> Vector3 for t in [0,1]; even arc-length resampling
  const raw = [];
  for (let i = 0; i <= 400; i++) raw.push(fn(i / 400));
  const acc = [0];
  for (let i = 1; i < raw.length; i++) acc.push(acc[i - 1] + raw[i].distanceTo(raw[i - 1]));
  const L = acc[acc.length - 1];
  const cs = [], outs = [], us = [];
  let k = 0;
  for (let i = 0; i <= n; i++) {
    const d = (i / n) * L;
    while (k < acc.length - 2 && acc[k + 1] < d) k++;
    const f = (d - acc[k]) / Math.max(1e-6, acc[k + 1] - acc[k]);
    const p = raw[k].clone().lerp(raw[k + 1], f);
    const tg = raw[k + 1].clone().sub(raw[k]); tg.y = 0; tg.normalize();
    const o = new THREE.Vector3(tg.z, 0, -tg.x);
    if (o.x * p.x + o.z * Math.min(p.z, 0) * 0.3 < 0 && Math.abs(p.x) > 0.05) o.negate();
    cs.push(p); outs.push(o); us.push(d / L);
  }
  return { cs, outs, L };
}

// ---------------------------------------------------------------------------
// RIB: inflatable tube collar on a rigid V hull, console with wheel, outboard motor
// ---------------------------------------------------------------------------
const RIB = { A: 0.84, BB: 2.12, ZS: 2.02, R: 0.25, Y: 0.16 };
function ribPath(t) {
  const { A, BB, ZS, Y } = RIB;
  const Ls = ZS, La = Math.PI * Math.sqrt((A * A + BB * BB) / 2), tot = 2 * Ls + La;
  let d = t * tot, x, z;
  if (d < Ls) { x = -A; z = ZS - d; } else if (d < Ls + La) {
    const th = Math.PI - ((d - Ls) / La) * Math.PI; // left -> bow -> right
    x = A * Math.cos(th); z = -BB * Math.sin(th);
  } else { x = A; z = d - Ls - La; }
  const kick = 0.2 * Math.pow(Math.max(0, -z / BB), 3);
  return new THREE.Vector3(x, Y + kick, z);
}

function buildRIB(ctx) {
  const g = new THREE.Group();
  const { A, BB, ZS, R, Y } = RIB;
  const { cs, outs, L: PL } = samplePath(ribPath, 150);
  // the left-side normals must face -x, the bow +/-z: recompute from the path direction
  for (let i = 0; i < cs.length; i++) {
    const a = cs[Math.max(0, i - 1)], b = cs[Math.min(cs.length - 1, i + 1)];
    const tg = b.clone().sub(a); tg.y = 0; tg.normalize();
    outs[i].set(tg.z, 0, -tg.x); // up x travel direction = outward for this circulation
  }
  const n = cs.length - 1;
  const radii = cs.map((c, i) => {
    const e = (Math.min(i, n - i) / n) * PL; // metres from the nearest stern end
    const cap = e < 0.22 ? Math.sqrt(Math.max(0, 1 - Math.pow(1 - e / 0.22, 2))) : 1;
    return R * (0.84 + 0.16 * Math.min(1, e / 0.6)) * Math.max(0.03, cap);
  });
  const tube = shadowy(new THREE.Mesh(tubeAlong(cs, outs, radii, 20), ctx.tubeMat));
  g.add(tube);
  // grab line on the outside of the tube
  const rope = [];
  for (let i = 6; i <= n - 6; i += 2) {
    const sag = Math.sin(((i % 14) / 14) * Math.PI) * 0.04;
    const hy = 0.13 - sag, hr = Math.sqrt(R * R - hy * hy) + 0.012;
    rope.push(cs[i].clone().addScaledVector(outs[i], hr).add(new THREE.Vector3(0, hy, 0)));
  }
  g.add(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(rope), 220, 0.011, 5, false), ctx.ropeMat));

  // rigid hull: V sections from bow to transom, white topsides, dark bottom
  const hullMat = std({ color: '#eceff2', roughness: 0.45, envMapIntensity: 0.6 });
  const pos = [], idx = [];
  const ST = 26, zb = -BB + 0.18, zt = ZS - 0.12;
  for (let i = 0; i <= ST; i++) {
    const z = zb + (zt - zb) * (i / ST);
    const w = z < 0 ? (A - 0.08) * Math.sqrt(Math.max(0, 1 - Math.pow(z / (BB - 0.05), 2))) : A - 0.08;
    const yc = Y - 0.16 + 0.18 * Math.pow(Math.max(0, -z / BB), 2.5);
    const yk = Y - 0.48 + 0.34 * Math.pow(Math.max(0, -z / BB), 1.6);
    pos.push(-w, yc, z, 0, yk, z, w, yc, z);
  }
  for (let i = 0; i < ST; i++) {
    const a = i * 3, b = a + 3;
    idx.push(a, b, a + 1, a + 1, b, b + 1, a + 1, b + 1, a + 2, a + 2, b + 1, b + 2);
  }
  // transom: fan from the keel up to the deck edge
  const last = ST * 3, n0 = (ST + 1) * 3, n1 = n0 + 1;
  pos.push(-(A - 0.08), Y + 0.12, zt, A - 0.08, Y + 0.12, zt);
  idx.push(last + 1, n0, last, last + 1, n1, n0, last + 1, last + 2, n1);
  const hg = new THREE.BufferGeometry();
  hg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  hg.setIndex(idx);
  hg.computeVertexNormals();
  const hull = shadowy(new THREE.Mesh(hg, patchMaterial(new THREE.MeshStandardMaterial({ color: '#e9ecef', roughness: 0.45, envMapIntensity: 0.6, side: THREE.DoubleSide }), {})));
  g.add(hull);
  // deck
  const pts = [];
  for (let i = 0; i <= 40; i++) {
    const th = (i / 40) * Math.PI;
    pts.push(new THREE.Vector2((A - 0.12) * Math.cos(th), -(BB - 0.25) * Math.sin(th)));
  }
  pts.push(new THREE.Vector2(-(A - 0.12), ZS - 0.12), new THREE.Vector2(A - 0.12, ZS - 0.12));
  pts.reverse();
  const deck = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape(pts), 2).rotateX(Math.PI / 2), ctx.floorMat);
  deck.position.y = Y - 0.06; deck.receiveShadow = true;
  g.add(deck);

  // console + windscreen + wheel
  const white = hullMat, dark = std({ color: '#25282e', roughness: 0.55 });
  const cons = shadowy(new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.72, 0.5), white));
  cons.position.set(0, Y + 0.3, 0.42); g.add(cons);
  const dash = shadowy(new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.06, 0.34), dark));
  dash.position.set(0, Y + 0.68, 0.52); dash.rotation.x = 0.45; g.add(dash);
  const glass = new THREE.Mesh(new THREE.BoxGeometry(0.66, 0.34, 0.025), patchMaterial(new THREE.MeshStandardMaterial({ color: '#9fc4d6', roughness: 0.05, metalness: 0.2, transparent: true, opacity: 0.45, envMapIntensity: 1.4 }), {}));
  glass.position.set(0, Y + 0.84, 0.25); glass.rotation.x = -0.5; g.add(glass);
  const wheel = shadowy(new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.016, 6, 18), dark));
  wheel.position.set(0, Y + 0.78, 0.7); wheel.rotation.x = -0.5; g.add(wheel);
  g.userData.wheel = wheel;
  // jockey seat
  const seat = shadowy(new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.5, 0.38), white));
  seat.position.set(0, Y + 0.18, 1.32); g.add(seat);
  const cush = shadowy(new THREE.Mesh(new THREE.BoxGeometry(0.48, 0.1, 0.42), dark));
  cush.position.set(0, Y + 0.47, 1.32); g.add(cush);
  // outboard motor
  const motor = new THREE.Group();
  const cowl = shadowy(new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.42, 0.46), dark));
  cowl.position.set(0, 0.5, 0.05);
  const capm = shadowy(new THREE.Mesh(new THREE.SphereGeometry(0.21, 14, 8, 0, TAU, 0, Math.PI / 2), dark));
  capm.scale.set(0.82, 0.45, 1.1); capm.position.set(0, 0.7, 0.05);
  const stripe = new THREE.Mesh(new THREE.BoxGeometry(0.345, 0.05, 0.465), ctx.accentMat);
  stripe.position.set(0, 0.52, 0.05);
  const leg = shadowy(new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.8, 0.16), dark));
  leg.position.set(0, -0.05, 0.12);
  const skeg = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.12, 0.3), dark);
  skeg.position.set(0, -0.47, 0.16);
  motor.add(cowl, capm, stripe, leg, skeg);
  motor.position.set(0, Y - 0.04, ZS - 0.02);
  g.add(motor);
  g.userData.motor = motor;
  return g;
}

// ---------------------------------------------------------------------------
// Submarine: lathe hull, conning tower with an open hatch, planes, prop, portholes
// ---------------------------------------------------------------------------
const SUB = { R: 0.6, L0: -2.25, L1: 2.3, Y: 0.02 };
function buildSub(ctx) {
  const g = new THREE.Group();
  const { R, L0, L1, Y } = SUB;
  // profile (radius, axial position), bow at L0 (-z)
  const prof = [];
  const NB = 14, NS = 12;
  const zb = L0 + 1.0, zs = L1 - 1.3;
  for (let i = 0; i <= NB; i++) { const a = (i / NB) * Math.PI / 2; prof.push(new THREE.Vector2(Math.max(0.001, R * Math.sin(a)), zb - Math.cos(a) * (zb - L0))); }
  prof.push(new THREE.Vector2(R, zs));
  for (let i = 1; i <= NS; i++) { const f = i / NS; prof.push(new THREE.Vector2(Math.max(0.02, R * (1 - Math.pow(f, 1.6) * 0.93)), zs + f * (L1 - zs))); }
  // lathe around Y, then lay along Z (bow at -Z)
  const lg = new THREE.LatheGeometry(prof, 40);
  lg.rotateX(Math.PI / 2);
  lg.scale(1, 1.0, 1);
  lg.computeVertexNormals();
  const hullMat = ctx.subMat;
  const hull = shadowy(new THREE.Mesh(lg, hullMat));
  hull.position.y = Y;
  g.add(hull);
  // deck casing
  const casingMat = ctx.subDark;
  const casing = shadowy(new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.08, 3.1), casingMat));
  casing.position.set(0, Y + R - 0.03, -0.05); g.add(casing);
  // conning tower (stadium extrusion)
  const sh = new THREE.Shape();
  const tw = 0.24, tl = 0.62;
  sh.absarc(0, -tl + tw, tw, Math.PI, 0, true);
  sh.absarc(0, tl - tw * 1.6, tw * 0.9, 0, Math.PI, true);
  const tower = new THREE.ExtrudeGeometry(sh, { depth: 0.78, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 2, curveSegments: 10 });
  tower.rotateX(-Math.PI / 2);
  const towerM = shadowy(new THREE.Mesh(tower, hullMat));
  towerM.position.set(0, Y + R - 0.08, -0.35); g.add(towerM);
  const rimY = Y + R - 0.08 + 0.78 + 0.03;
  const rim = shadowy(new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.025, 6, 18).rotateX(Math.PI / 2), casingMat));
  rim.position.set(0, rimY, -0.52); g.add(rim);
  const hole = new THREE.Mesh(new THREE.CircleGeometry(0.16, 18).rotateX(-Math.PI / 2), std({ color: '#0b0c0e', roughness: 1 }));
  hole.position.set(0, rimY + 0.002, -0.52); g.add(hole);
  // periscope + mast
  const metal = std({ color: '#8d939b', roughness: 0.35, metalness: 0.7 });
  const scope = shadowy(new THREE.Mesh(new THREE.CylinderGeometry(0.028, 0.028, 0.62, 8), metal));
  scope.position.set(0.05, rimY + 0.28, -0.1); g.add(scope);
  const head = shadowy(new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.08, 0.14), metal));
  head.position.set(0.05, rimY + 0.6, -0.14); g.add(head);
  const mast = shadowy(new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.02, 0.5, 6), metal));
  mast.position.set(-0.07, rimY + 0.22, 0.06); g.add(mast);
  // tower planes
  const fin = (w, l, x, y, z, rz = 0) => { const m = shadowy(new THREE.Mesh(new THREE.BoxGeometry(w, 0.035, l), hullMat)); m.position.set(x, y, z); m.rotation.z = rz; g.add(m); return m; };
  fin(0.36, 0.2, 0.36, Y + R + 0.42, -0.35); fin(0.36, 0.2, -0.36, Y + R + 0.42, -0.35);
  // bow planes and stern cross
  fin(0.4, 0.22, 0.72, Y + 0.08, -1.45); fin(0.4, 0.22, -0.72, Y + 0.08, -1.45);
  fin(0.7, 0.3, 0.35, Y, L1 - 0.42); fin(0.7, 0.3, -0.35, Y, L1 - 0.42);
  const rud = shadowy(new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.75, 0.3), hullMat)); rud.position.set(0, Y + 0.05, L1 - 0.42); g.add(rud);
  // propeller
  const prop = new THREE.Group();
  const brass = std({ color: '#c79a3a', roughness: 0.3, metalness: 0.85 });
  const hub = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), brass); prop.add(hub);
  for (let i = 0; i < 5; i++) {
    const b = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.26, 0.015), brass);
    b.geometry.translate(0, 0.13, 0);
    b.rotation.z = (i / 5) * TAU; b.rotation.y = 0.5;
    prop.add(b);
  }
  prop.position.set(0, Y, L1 + 0.04);
  g.add(prop);
  g.userData.prop = prop;
  // portholes (glow at night)
  const glassM = ctx.portMat;
  const ringM = brass;
  for (const side of [-1, 1]) for (let i = 0; i < 6; i++) {
    const z = -1.2 + i * 0.46;
    const ang = 0.42; // up from the horizontal
    const nrm = new THREE.Vector3(side * Math.cos(ang), Math.sin(ang), 0);
    const p = new THREE.Vector3(side * R * Math.cos(ang), Y + R * Math.sin(ang), z).addScaledVector(nrm, 0.005);
    const c = new THREE.Mesh(new THREE.CircleGeometry(0.075, 14), glassM);
    c.position.copy(p); c.lookAt(p.clone().add(nrm)); g.add(c);
    const r = new THREE.Mesh(new THREE.TorusGeometry(0.08, 0.014, 5, 14), ringM);
    r.position.copy(p); r.lookAt(p.clone().add(nrm)); g.add(r);
  }
  g.userData.rimY = rimY;
  return g;
}

// ---------------------------------------------------------------------------
// Procedural displacement hull: stations bow->stern, round/V sections, sheer, transom,
// deck with an optional sunken cockpit. u runs bow->stern, v keel->gunwale (for the livery).
// ---------------------------------------------------------------------------
function hullGeometry(P) {
  const NS = 44, K = 7;
  const st = [];
  for (let i = 0; i <= NS; i++) {
    const t = i / NS;
    const z = -P.L / 2 + t * P.L;
    const b = P.B * (t < P.tb ? Math.pow(Math.sin((t / P.tb) * Math.PI / 2), P.bowP) : 1 - (1 - P.tw) * Math.pow((t - P.tb) / (1 - P.tb), 2));
    const yg = P.yG + P.sheer * Math.pow(1 - t, 2);
    const yk = P.yK + (P.yG - P.yK) * 0.55 * Math.pow(Math.max(0, 1 - t / 0.22), 2);
    st.push({ t, z, b: Math.max(b, 0.0005), yg, yk });
  }
  const V0 = P.yK, V1 = P.yG + P.sheer;
  const pos = [], uv = [], idx = [];
  const cols = 2 * K + 1;
  for (const S of st) {
    for (let j = 0; j < cols; j++) {
      const a = Math.abs(j - K) / K, sd = Math.sign(j - K);
      const x = sd * S.b * Math.sin(a * Math.PI / 2);
      const y = S.yk + (S.yg - S.yk) * (a * P.vee + (1 - P.vee) * (1 - Math.cos(a * Math.PI / 2)));
      pos.push(x, y, S.z);
      uv.push(S.t, (y - V0) / (V1 - V0));
    }
  }
  for (let i = 0; i < NS; i++) for (let j = 0; j < cols - 1; j++) {
    const a = i * cols + j, b = a + cols;
    idx.push(a, a + 1, b, a + 1, b + 1, b);
  }
  // transom
  const last = NS * cols, c0 = pos.length / 3;
  const Sl = st[NS];
  pos.push(0, (Sl.yg + Sl.yk) / 2, Sl.z); uv.push(1, 0.5);
  for (let j = 0; j < cols - 1; j++) idx.push(c0, last + j, last + j + 1);
  const hull = new THREE.BufferGeometry();
  hull.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  hull.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  hull.setIndex(idx);
  hull.computeVertexNormals();

  // deck: 7 points across; inside the cockpit the middle ones drop to the floor
  const dp = [], duv = [], di = [];
  const ck = P.cockpit;
  for (const S of st) {
    const inCk = ck && S.t > ck[0] && S.t < ck[1];
    const ins = ck ? Math.min(ck[3], S.b * 0.45) : 0;
    const cam = (x) => S.yg + P.camber * (1 - Math.pow(x / Math.max(S.b, 1e-3), 2));
    const xs = [-S.b, -S.b + ins, -S.b + ins, 0, S.b - ins, S.b - ins, S.b];
    xs.forEach((x, j) => {
      let y = cam(x);
      if (inCk && j >= 2 && j <= 4) y = ck[2];
      dp.push(x * 0.999, y + 0.002, S.z);
      duv.push(x * 0.8, S.z * 0.8);
    });
  }
  for (let i = 0; i < NS; i++) for (let j = 0; j < 6; j++) {
    const a = i * 7 + j, b = a + 7;
    di.push(a, b, a + 1, a + 1, b, b + 1);
  }
  const deck = new THREE.BufferGeometry();
  deck.setAttribute('position', new THREE.Float32BufferAttribute(dp, 3));
  deck.setAttribute('uv', new THREE.Float32BufferAttribute(duv, 2));
  deck.setIndex(di);
  deck.computeVertexNormals();
  return { hull, deck, st, at: (t) => st[Math.round(t * NS)] };
}

/** hull livery: antifouling, boot stripe, topsides in the pattern colour, sheer stripe; v=0 keel .. 1 gunwale */
const liveryCache = new Map();
function hullLivery(def, L, key) {
  const id = key + ':' + (def ? def.id : 'klasik');
  if (liveryCache.has(id)) return liveryCache.get(id);
  const klasik = !def || def.id === 'klasik';
  const base = klasik ? L.base : def.base;
  const accent = klasik ? L.accent : def.accent || def.thwart || L.accent;
  const W = 512, H = 128;
  const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  const yv = (v) => H * (1 - v);
  g.fillStyle = base; g.fillRect(0, 0, W, H);
  const pat = klasik ? 'solid' : def.pattern;
  const rnd = (() => { let a = 99; return () => { a = (a * 16807) % 2147483647; return a / 2147483647; }; })();
  let em = null;
  if (pat === 'camo') {
    const cs = ['#3d4a28', '#6b5a3a', '#2a3320', '#7d8a52'];
    for (let i = 0; i < 160; i++) { g.fillStyle = cs[i % 4]; g.beginPath(); g.ellipse(rnd() * W, rnd() * H, 10 + rnd() * 26, 6 + rnd() * 12, rnd() * 3, 0, TAU); g.fill(); }
  } else if (pat === 'flame') {
    for (let k = 0; k < 7; k++) {
      const x0 = 8 + k * 30, yb = yv(L.wl + 0.06), yt = yv(0.72 + rnd() * 0.12);
      const gr = g.createLinearGradient(0, yb, 0, yt);
      gr.addColorStop(0, '#ff3a0a'); gr.addColorStop(0.55, def.accent || '#ffb21a'); gr.addColorStop(1, '#fff3b0');
      g.fillStyle = gr; g.beginPath(); g.moveTo(x0, yb); g.quadraticCurveTo(x0 + 8, (yb + yt) / 2, x0 + 52, yt); g.quadraticCurveTo(x0 + 26, (yb + yt) / 2, x0 + 40, yb); g.closePath(); g.fill();
    }
  } else if (pat === 'stripe') {
    g.fillStyle = def.accent; g.fillRect(0, yv(0.7), W, H * 0.12);
    g.fillStyle = def.accent2 || def.accent; g.fillRect(0, yv(0.56), W, H * 0.04);
  } else if (pat === 'neon') {
    const ec = document.createElement('canvas'); ec.width = W; ec.height = H;
    const e = ec.getContext('2d'); e.fillStyle = '#000'; e.fillRect(0, 0, W, H);
    for (const v of [0.84, 0.62]) { g.fillStyle = def.accent; g.fillRect(0, yv(v), W, H * 0.035); e.fillStyle = def.accent; e.fillRect(0, yv(v), W, H * 0.035); }
    em = new THREE.CanvasTexture(ec); em.colorSpace = THREE.SRGBColorSpace;
  } else if (pat === 'gold') {
    const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, '#fff1a8'); gr.addColorStop(0.5, '#d4a017'); gr.addColorStop(1, '#a87800');
    g.fillStyle = gr; g.fillRect(0, 0, W, H);
  }
  // sheer stripe + boot stripe + antifouling
  if (pat !== 'neon' && pat !== 'stripe') { g.fillStyle = accent; g.fillRect(0, yv(0.95), W, H * 0.045); }
  g.fillStyle = accent; g.fillRect(0, yv(L.wl + 0.075), W, H * 0.035);
  g.fillStyle = L.bottom; g.fillRect(0, yv(L.wl), W, H * L.wl + 1);
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  const out = { map: t, em, metal: !klasik && !!def.metal };
  liveryCache.set(id, out);
  return out;
}

function paintLivery(group, def) {
  const u = group.userData;
  if (!u.hullMat) return;
  const lv = hullLivery(def, u.livery, u.key);
  const m = u.hullMat, had = !!m.emissiveMap;
  m.map = lv.map; m.emissiveMap = lv.em;
  m.emissive.set(lv.em ? '#ffffff' : '#000000'); m.emissiveIntensity = lv.em ? 2.2 : 1;
  m.metalness = lv.metal ? 0.82 : 0.05; m.roughness = lv.metal ? 0.3 : 0.38; m.envMapIntensity = lv.metal ? 1.1 : 0.75;
  if (had !== !!lv.em) m.needsUpdate = true;
  if (u.trimMat) u.trimMat.color.set(!def || def.id === 'klasik' ? u.livery.accent : def.accent || def.base);
}

function sailMesh(pts, camber, segs = 10) {
  // pts: tack, head, clew (Vector3); cambered triangle, both sides lit
  const [A, Bp, C] = pts;
  const pos = [], idx = [];
  const n = segs;
  for (let i = 0; i <= n; i++) for (let j = 0; j <= n - i; j++) {
    const u = i / n, v = j / n, w = 1 - u - v;
    const p = A.clone().multiplyScalar(w).addScaledVector(Bp, u).addScaledVector(C, v);
    p.x += camber * Math.sin(Math.PI * Math.min(1, (v + 0.0001) / (1 - u + 0.0001))) * (1 - u) * 1.4 * w * 2;
    pos.push(p.x, p.y, p.z);
  }
  const row = (i) => { let o = 0; for (let k = 0; k < i; k++) o += n - k + 1; return o; };
  for (let i = 0; i < n; i++) for (let j = 0; j < n - i; j++) {
    const a = row(i) + j, b = row(i + 1) + j;
    idx.push(a, b, a + 1);
    if (j < n - i - 1) idx.push(a + 1, b, b + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const railTube = (pts, r, mat, closed = false) => shadowy(new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, closed), pts.length * 8, r, 5, closed), mat));

// ---------------------------------------------------------------------------
// Sailboat (Yelkenli): sloop with a cabin trunk, cockpit, mainsail + jib
// ---------------------------------------------------------------------------
const SAIL = { L: 4.5, B: 0.9, yK: -0.36, yG: 0.34, sheer: 0.16, bowP: 0.85, tb: 0.55, tw: 0.62, vee: 0.28, camber: 0.03, cockpit: [0.64, 0.93, 0.1, 0.2] };
function buildSail(ctx) {
  const g = new THREE.Group();
  const H = hullGeometry(SAIL);
  const hullMat = std({ roughness: 0.38, envMapIntensity: 0.75 });
  const deckMat = std({ map: ctx.teakTex, roughness: 0.75 });
  g.add(shadowy(new THREE.Mesh(H.hull, hullMat)), shadowy(new THREE.Mesh(H.deck, deckMat)));
  g.userData.hullMat = hullMat; g.userData.key = 'sail';
  g.userData.livery = { base: '#f4f5f2', accent: '#1d3c6e', bottom: '#7a2a24', wl: 0.42 };
  const white = std({ color: '#f1f2ee', roughness: 0.45, envMapIntensity: 0.6 });
  const dark = std({ color: '#2a2e35', roughness: 0.5 });
  const steel = std({ color: '#c3c8cf', roughness: 0.25, metalness: 0.85 });
  // cabin trunk
  const sh = new THREE.Shape();
  sh.moveTo(-0.5, 0.55); sh.lineTo(-0.52, -0.55); sh.quadraticCurveTo(-0.45, -1.15, 0, -1.25); sh.quadraticCurveTo(0.45, -1.15, 0.52, -0.55); sh.lineTo(0.5, 0.55); sh.closePath();
  const cab = new THREE.ExtrudeGeometry(sh, { depth: 0.32, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: 2, curveSegments: 8 });
  cab.rotateX(Math.PI / 2); cab.translate(0, SAIL.yG + 0.33, 0);
  const cabM = shadowy(new THREE.Mesh(cab, white)); g.add(cabM);
  for (const sd of [-1, 1]) { const w = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.09, 0.75), dark); w.position.set(sd * 0.535, SAIL.yG + 0.17, -0.25); g.add(w); }
  const hatch = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.04, 0.4), dark); hatch.position.set(0, SAIL.yG + 0.38, -0.65); g.add(hatch);
  // cockpit benches
  for (const sd of [-1, 1]) { const b = shadowy(new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.26, 1.2), white)); b.position.set(sd * 0.5, 0.23, 1.25); g.add(b); }
  // mast, boom, rigging
  const mastZ = -0.55, mastTop = 4.1;
  const mast = shadowy(new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.045, mastTop - SAIL.yG, 8), steel));
  mast.position.set(0, (mastTop + SAIL.yG) / 2 + 0.3, mastZ); g.add(mast);
  const rig = new THREE.Group(); rig.position.set(0, 0, mastZ); g.add(rig);
  const boomY = 1.08, boomL = 2.25;
  const boom = shadowy(new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, boomL, 6).rotateX(Math.PI / 2), steel));
  boom.position.set(0, boomY, boomL / 2); rig.add(boom);
  const sailMat = patchMaterial(new THREE.MeshStandardMaterial({ color: '#fbfaf5', roughness: 0.85, side: THREE.DoubleSide, envMapIntensity: 0.5 }), {});
  const main = shadowy(new THREE.Mesh(sailMesh([new THREE.Vector3(0, boomY + 0.04, 0.05), new THREE.Vector3(0, mastTop + 0.2, 0.04), new THREE.Vector3(0, boomY + 0.04, boomL - 0.05)], 0.16), sailMat));
  rig.add(main);
  const jibRig = new THREE.Group(); jibRig.position.set(0, 0, -2.18); g.add(jibRig);
  const jib = shadowy(new THREE.Mesh(sailMesh([new THREE.Vector3(0, SAIL.yG + 0.28, 0), new THREE.Vector3(0, mastTop - 0.45, 2.18 + mastZ - 0.02), new THREE.Vector3(0, SAIL.yG + 0.42, 1.7)], 0.12), sailMat));
  jibRig.add(jib);
  const stay = (a, b) => { const d = b.clone().sub(a); const m = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.006, d.length(), 4), steel); m.position.copy(a).addScaledVector(d, 0.5); m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()); g.add(m); };
  stay(new THREE.Vector3(0, SAIL.yG + 0.3, -2.2), new THREE.Vector3(0, mastTop - 0.4, mastZ));
  stay(new THREE.Vector3(0, SAIL.yG + 0.1, 2.2), new THREE.Vector3(0, mastTop + 0.25, mastZ));
  for (const sd of [-1, 1]) stay(new THREE.Vector3(sd * 0.82, SAIL.yG + 0.06, mastZ + 0.1), new THREE.Vector3(0, mastTop - 0.2, mastZ));
  // bow pulpit + stern rail
  const S0 = H.at(0.06), S1 = H.at(0.16);
  railTube([new THREE.Vector3(-S1.b * 0.92, S1.yg + 0.02, S1.z), new THREE.Vector3(-S0.b * 0.7, S0.yg + 0.3, S0.z), new THREE.Vector3(0, S0.yg + 0.34, S0.z - 0.12), new THREE.Vector3(S0.b * 0.7, S0.yg + 0.3, S0.z), new THREE.Vector3(S1.b * 0.92, S1.yg + 0.02, S1.z)], 0.012, steel);
  // tiller
  const till = shadowy(new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.04, 0.8), std({ color: '#8a5a30', roughness: 0.6 })));
  till.position.set(0, 0.42, 1.85); till.rotation.x = -0.15; g.add(till);
  g.userData.rig = rig; g.userData.jib = jibRig;
  return g;
}

// ---------------------------------------------------------------------------
// Racing yacht (Yarış Yatı): deep-V powerboat, wraparound screen, twin outboards
// ---------------------------------------------------------------------------
const YACHT = { L: 4.75, B: 0.96, yK: -0.3, yG: 0.38, sheer: 0.2, bowP: 0.72, tb: 0.62, tw: 0.88, vee: 0.6, camber: 0.05, cockpit: [0.43, 0.83, 0.08, 0.15] };
function buildYacht(ctx) {
  const g = new THREE.Group();
  const H = hullGeometry(YACHT);
  const hullMat = std({ roughness: 0.32, envMapIntensity: 0.85 });
  const deckMat = std({ color: '#f3f4f2', roughness: 0.4, envMapIntensity: 0.7 });
  g.add(shadowy(new THREE.Mesh(H.hull, hullMat)), shadowy(new THREE.Mesh(H.deck, deckMat)));
  g.userData.hullMat = hullMat; g.userData.key = 'yacht';
  g.userData.livery = { base: '#f5f6f4', accent: '#e0451c', bottom: '#1b2433', wl: 0.4 };
  const trim = g.userData.trimMat = std({ color: '#e0451c', roughness: 0.35 });
  const dark = std({ color: '#22262d', roughness: 0.45 });
  const seatM = std({ color: '#ecebe4', roughness: 0.6 });
  const chrome = std({ color: '#d9dde2', roughness: 0.15, metalness: 0.95 });
  // wraparound windscreen
  const zc = -YACHT.L / 2 + YACHT.cockpit[0] * YACHT.L;
  const wp = [], wi = [];
  const NW = 16;
  for (let i = 0; i <= NW; i++) {
    const f = i / NW * 2 - 1, x = f * 0.78, z = zc - 0.02 + (1 - f * f) * -0.22;
    wp.push(x, YACHT.yG + 0.08, z, x * 0.96, YACHT.yG + 0.42, z + 0.24);
  }
  for (let i = 0; i < NW; i++) { const a = i * 2; wi.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
  const wg = new THREE.BufferGeometry(); wg.setAttribute('position', new THREE.Float32BufferAttribute(wp, 3)); wg.setIndex(wi); wg.computeVertexNormals();
  g.add(new THREE.Mesh(wg, patchMaterial(new THREE.MeshStandardMaterial({ color: '#7fa6bb', roughness: 0.05, metalness: 0.3, transparent: true, opacity: 0.5, side: THREE.DoubleSide, envMapIntensity: 1.5 }), {})));
  const top = []; for (let i = 0; i <= NW; i++) top.push(new THREE.Vector3(wp[i * 6 + 3], wp[i * 6 + 4], wp[i * 6 + 5]));
  g.add(railTube(top, 0.014, chrome));
  // dash + wheel, bucket seats, rear bench, sun pad
  const dash = shadowy(new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.3, 0.3), dark)); dash.position.set(0, 0.3, zc + 0.22); g.add(dash);
  const wheel = shadowy(new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.016, 6, 18), dark)); wheel.position.set(-0.34, 0.55, zc + 0.55); wheel.rotation.x = -0.55; g.add(wheel);
  g.userData.wheel = wheel;
  const bucket = (x, z) => {
    const s1 = shadowy(new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.16, 0.42), seatM)); s1.position.set(x, 0.28, z);
    const s2 = shadowy(new THREE.Mesh(new THREE.BoxGeometry(0.42, 0.42, 0.12), seatM)); s2.position.set(x, 0.55, z + 0.24); s2.rotation.x = -0.15;
    g.add(s1, s2);
  };
  bucket(-0.34, zc + 0.95); bucket(0.34, zc + 0.95);
  const bench = shadowy(new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.2, 0.42), seatM)); bench.position.set(0, 0.28, 1.28); g.add(bench);
  const back = shadowy(new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.32, 0.12), seatM)); back.position.set(0, 0.5, 1.52); g.add(back);
  const pad = shadowy(new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.08, 0.5), std({ color: '#3a3f48', roughness: 0.7 }))); pad.position.set(0, YACHT.yG + 0.06, 1.95); g.add(pad);
  // racing stripes on the foredeck
  for (const sd of [-0.14, 0.14]) { const st = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.012, 1.5), trim); st.position.set(sd, YACHT.yG + YACHT.camber + 0.11, -1.25); st.rotation.x = -0.075; g.add(st); }
  // bow rail
  const S0 = H.at(0.05), S1 = H.at(0.2);
  for (const sd of [-1, 1]) g.add(railTube([new THREE.Vector3(sd * S1.b * 0.85, S1.yg + 0.03, S1.z), new THREE.Vector3(sd * S1.b * 0.85, S1.yg + 0.2, S1.z - 0.1), new THREE.Vector3(sd * S0.b * 0.6, S0.yg + 0.2, S0.z)], 0.01, chrome));
  // twin outboards
  const motors = new THREE.Group();
  for (const sd of [-0.32, 0.32]) {
    const m = new THREE.Group();
    const cowl = shadowy(new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.4, 0.42), dark)); cowl.position.set(0, 0.55, 0.06);
    const capm = shadowy(new THREE.Mesh(new THREE.SphereGeometry(0.19, 12, 8, 0, TAU, 0, Math.PI / 2), dark)); capm.scale.set(0.82, 0.45, 1.12); capm.position.set(0, 0.74, 0.06);
    const s = new THREE.Mesh(new THREE.BoxGeometry(0.305, 0.05, 0.425), trim); s.position.set(0, 0.56, 0.06);
    const leg = shadowy(new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.8, 0.15), dark)); leg.position.set(0, -0.02, 0.1);
    m.add(cowl, capm, s, leg); m.position.set(sd, 0, YACHT.L / 2 + 0.02);
    motors.add(m);
  }
  g.add(motors);
  g.userData.motor = motors;
  return g;
}

// ---------------------------------------------------------------------------
// Kenney models: clone, turn the bow to -Z, scale; recolourable atlas regions
// ---------------------------------------------------------------------------
function buildKenney(ctx, name, scale, sink, keepNodes = []) {
  const src = ctx.props && ctx.props[name];
  if (!src) return null;
  const node = src.clone(true);
  node.rotation.set(0, Math.PI, 0);
  node.scale.setScalar(scale);
  node.position.y = -sink;
  const g = new THREE.Group();
  g.add(node);
  let base = null;
  const paintMat = [], keepMat = [];
  node.traverse((c) => {
    if (!c.isMesh) return;
    base = base || c.material;
    let keep = false;
    for (let p = c; p && p !== node; p = p.parent) if (keepNodes.some((k) => p.name.startsWith(k))) keep = true;
    const m = c.material.clone();
    m.roughness = 0.62; m.metalness = 0; m.envMapIntensity = 0.55;
    if (keep) { m.transparent = true; m.side = THREE.DoubleSide; }
    c.material = patchMaterial(m, {});
    (keep ? keepMat : paintMat).push(c.material);
    c.castShadow = true; c.receiveShadow = true;
  });
  // one shared material per group keeps the draw state small
  const pm = paintMat[0];
  node.traverse((c) => { if (c.isMesh && paintMat.includes(c.material)) c.material = pm; });
  g.userData.paint = pm;
  g.userData.origMap = pm.map;
  g.userData.sails = keepMat; // ghosted while racing so they never hide the river ahead
  return g;
}

/** recolour atlas regions [x0,y0,x1,y1] (512 px PNG space) of a Kenney colormap with the pattern colours */
const atlasCache = new Map();
function recolourAtlas(map, key, regions) {
  if (atlasCache.has(key)) return atlasCache.get(key);
  const img = map.image;
  const W = img.width, H = img.height;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  g.drawImage(img, 0, 0);
  const d = g.getImageData(0, 0, W, H);
  // top rows of the PNG are black: if the bottom is black instead, the bitmap is stored flipped
  const px = (x, y) => { const i = (y * W + x) * 4; return d.data[i] + d.data[i + 1] + d.data[i + 2]; };
  const flipped = px(4, 4) > 30 && px(4, H - 5) < 30;
  const sx = W / 512, sy = H / 512;
  for (const r of regions) {
    const [x0, y0, x1, y1] = r.rect;
    const col = new THREE.Color(r.color);
    const Y0 = flipped ? 512 - y1 : y0, Y1 = flipped ? 512 - y0 : y1;
    let lsum = 0, ln = 0;
    for (let y = Math.floor(Y0 * sy); y < Math.floor(Y1 * sy); y++) for (let x = Math.floor(x0 * sx); x < Math.floor(x1 * sx); x++) {
      const i = (y * W + x) * 4; lsum += d.data[i] * 0.3 + d.data[i + 1] * 0.59 + d.data[i + 2] * 0.11; ln++;
    }
    const l0 = lsum / Math.max(1, ln);
    // colour is given in sRGB hex -> THREE.Color holds linear; convert back to sRGB bytes
    const c8 = col.clone().convertLinearToSRGB();
    const R8 = c8.r * 255, G8 = c8.g * 255, B8 = c8.b * 255;
    for (let y = Math.floor(Y0 * sy); y < Math.floor(Y1 * sy); y++) for (let x = Math.floor(x0 * sx); x < Math.floor(x1 * sx); x++) {
      const i = (y * W + x) * 4;
      const l = d.data[i] * 0.3 + d.data[i + 1] * 0.59 + d.data[i + 2] * 0.11;
      const k = Math.min(1.35, Math.max(0.55, l / Math.max(1, l0)));
      d.data[i] = Math.min(255, R8 * k); d.data[i + 1] = Math.min(255, G8 * k); d.data[i + 2] = Math.min(255, B8 * k);
    }
  }
  g.putImageData(d, 0, 0);
  const t = new THREE.CanvasTexture(cv);
  t.flipY = map.flipY; t.colorSpace = map.colorSpace; t.magFilter = map.magFilter; t.minFilter = map.minFilter;
  t.generateMipmaps = map.generateMipmaps; t.wrapS = map.wrapS; t.wrapT = map.wrapT;
  atlasCache.set(key, t);
  return t;
}

function paintKenney(group, def, regions, vid) {
  const m = group.userData.paint;
  if (!m) return;
  if (!def || def.id === 'klasik') m.map = group.userData.origMap;
  else {
    const reg = [];
    if (regions.hull) for (const r of regions.hull) reg.push({ rect: r, color: def.base });
    if (regions.trim && (def.accent || def.thwart)) for (const r of regions.trim) reg.push({ rect: r, color: def.accent || def.thwart });
    m.map = recolourAtlas(group.userData.origMap, vid + ':' + def.id, reg);
  }
  m.metalness = def && def.metal ? 0.8 : 0;
  m.roughness = def && def.metal ? 0.32 : 0.62;
  m.envMapIntensity = def && def.metal ? 1.1 : 0.55;
  m.needsUpdate = true;
}

// ---------------------------------------------------------------------------
// Vessel table. seats: hip-joint positions in vessel space (bow at -Z).
// hull: waterline half-width/half-length for the foam ring; dry: inner outline where the water is cut away.
// ---------------------------------------------------------------------------
const tubeSeat = (x, z, side, y = 0.5) => ({ p: [x, y, z], pose: 'tube', side, hands: { l: side < 0 ? [x - 0.24, 0.36, z + 0.05] : [x - 0.42, 0.52, z - 0.3], r: side < 0 ? [x + 0.42, 0.52, z - 0.3] : [x + 0.24, 0.36, z + 0.05] } });

export const VESSELS = {
  raft: {
    hull: [1.05, 2.02], dry: [0.7, 1.68], bowZ: -2.0, halfW: 0.9, mass: 1, camLift: 0, crewScale: null,
    seats: null, // raft.js keeps its own paddling crew
  },
  rib: {
    hull: [1.08, 2.3], dry: [0.66, 1.9], bowZ: -2.3, halfW: 0.9, mass: 0.85, camLift: 0.1, motor: true,
    seats: [
      { p: [0, 0.98, 1.08], pose: 'helm', hands: { l: [-0.1, 0.8, 0.72], r: [0.1, 0.8, 0.72] } },
      tubeSeat(-0.74, -0.95, -1, 0.52),
      tubeSeat(0.74, -0.85, 1, 0.52),
      tubeSeat(-0.74, 0.2, -1, 0.5),
      null,
    ],
    build: buildRIB,
  },
  sail: {
    hull: [0.98, 2.3], dry: [0.6, 1.9], bowZ: -2.3, halfW: 0.85, mass: 1.1, camLift: 0.7,
    seats: [
      { p: [-0.5, 0.49, 1.0], pose: 'sit', yaw: -Math.PI / 2 + 0.25, scale: 0.88 },
      { p: [0.5, 0.49, 1.45], pose: 'sit', yaw: Math.PI / 2 - 0.25, scale: 0.88 },
      { p: [0.18, 0.48, 2.02], pose: 'sit', yaw: Math.PI / 2 - 1.0, scale: 0.88, hands: { l: [0.0, 0.46, 1.62], r: [0.3, 0.5, 1.9] } },
      null, null,
    ],
    build: buildSail,
  },
  yacht: {
    hull: [1.04, 2.4], dry: [0.62, 1.9], bowZ: -2.4, halfW: 0.95, mass: 0.8, camLift: 0.2, motor: true,
    seats: [
      { p: [-0.34, 0.47, 0.62], pose: 'sit', scale: 0.88, hands: { l: [-0.45, 0.57, 0.26], r: [-0.23, 0.57, 0.26] } },
      { p: [0.34, 0.47, 0.62], pose: 'sit', scale: 0.88 },
      { p: [-0.32, 0.49, 1.25], pose: 'sit', scale: 0.88 },
      { p: [0.32, 0.49, 1.25], pose: 'sit', scale: 0.88 },
      null,
    ],
    build: buildYacht,
  },
  ship: {
    hull: [1.08, 2.3], dry: [0.66, 1.9], bowZ: -2.4, halfW: 0.95, mass: 0.55, camLift: 1.2, kenney: 'ship-small', scale: 0.44, sink: 0.38, keep: ['sail', 'flag'],
    regions: { hull: [[384, 384, 512, 512]] },
    seats: [
      { p: [0.0, 1.12, 1.55], pose: 'stand', scale: 0.5 },
      { p: [-0.42, 0.98, 0.25], pose: 'stand', scale: 0.5, yaw: 0.6 },
      { p: [0.4, 0.98, -0.9], pose: 'stand', scale: 0.5, yaw: -0.3 },
      null, null,
    ],
    build: (ctx) => buildKenney(ctx, 'ship-small', 0.44, 0.38, ['sail', 'flag']),
  },
  sub: {
    hull: [0.66, 2.3], dry: null, bowZ: -2.3, halfW: 0.6, mass: 0.6, camLift: 0, dive: true,
    seats: [
      { p: [0, 0, -0.52], pose: 'stand', scale: 0.62, hatch: true },
      { p: [0, 0, 0.95], pose: 'stand', scale: 0.62, yaw: Math.PI },
      null, null, null,
    ],
    build: buildSub,
  },
};

/** finish a vessel's seat table once it is built (positions that depend on geometry) */
export function resolveSeats(id, group, hipOf) {
  const v = VESSELS[id];
  if (id === 'sub') {
    const rimY = group.userData.rimY;
    const sc = 0.62;
    v.seats[0].p[1] = rimY - 0.12;
    v.seats[0].hands = { l: [-0.15, rimY + 0.02, -0.62], r: [0.15, rimY + 0.02, -0.62] };
    v.seats[1].p[1] = SUB.Y + SUB.R + 0.01 + hipOf(sc);
  }
}

export function paintVessel(id, group, def) {
  const v = VESSELS[id];
  if (!group) return;
  if (v.kenney) paintKenney(group, def, v.regions || {}, id);
  else if (group.userData.hullMat) paintLivery(group, def);
}

export { buildRIB, buildSub, SUB, RIB };
