import * as THREE from 'three';
import { clone as skClone } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { patchMaterial } from './patch.js';
import { TAU } from './config.js';

// ---------------------------------------------------------------------------
// Rafters built from the rigged Quaternius base characters: procedural clothes
// (by skin weights), a fitted life vest (skinned to the same skeleton), a
// helmet on the head bone, and an IK-driven paddling animation.
// ---------------------------------------------------------------------------

const JACKET = /^(spine_0[123]|clavicle_[lr]|upperarm_[lr]|lowerarm_[lr])$/;
const PANTS = /^(pelvis|thigh_[lr])$/;
const CALF = /^calf_[lr]$/;
const SHOE = /^(foot_[lr]|ball_[lr]|ball_leaf_[lr])$/;
const TORSO = /^(spine_0[123]|pelvis)$/;
const ARM = /^(upperarm_|lowerarm_|hand_|index|middle|ring|pinky|thumb)/;
const FINGERS = ['index', 'middle', 'ring', 'pinky'];

const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3(), _v4 = new THREE.Vector3();
const _e = new THREE.Euler();
const _m = new THREE.Matrix4();
const _fA = new THREE.Vector3(), _fB = new THREE.Vector3(), _fC = new THREE.Vector3(), _fD = new THREE.Vector3(), _fE = new THREE.Vector3(), _fQ = new THREE.Quaternion();
let _ray = null;
const X = new THREE.Vector3(1, 0, 0), Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);

const qx = (a, out = new THREE.Quaternion()) => out.setFromAxisAngle(X, a);
const qy = (a, out = new THREE.Quaternion()) => out.setFromAxisAngle(Y, a);
const qz = (a, out = new THREE.Quaternion()) => out.setFromAxisAngle(Z, a);
/** char-space rotation from yaw/pitch/roll (applied pitch, then roll, then yaw) */
function ypr(yaw, pitch, roll, out) {
  _e.set(pitch, yaw, roll, 'YZX');
  return out.setFromEuler(_e);
}

// ---------------------------------------------------------------------------
// Base preparation (once per gender)
// ---------------------------------------------------------------------------
export function prepareBase(gltf) {
  const scene = gltf.scene;
  scene.position.set(0, 0, 0); scene.rotation.set(0, 0, 0); scene.scale.set(1, 1, 1);
  scene.updateMatrixWorld(true);
  let body = null;
  scene.traverse((o) => { if (o.isSkinnedMesh && /body/.test(o.name)) body = o; });
  const bones = body.skeleton.bones;
  const g = body.geometry;
  const n = g.attributes.position.count;
  const si = g.attributes.skinIndex, sw = g.attributes.skinWeight;
  const cat = bones.map((b) => (JACKET.test(b.name) ? 0 : PANTS.test(b.name) ? 1 : CALF.test(b.name) ? 2 : SHOE.test(b.name) ? 3 : -1));
  const isTorso = bones.map((b) => TORSO.test(b.name));
  const isArm = bones.map((b) => ARM.test(b.name));
  const headIdx = bones.findIndex((b) => b.name === 'Head');
  const cloth = new Float32Array(n * 4);
  const torsoW = new Float32Array(n), headW = new Float32Array(n), armW = new Float32Array(n);
  const sidx = new Uint16Array(n * 4), swt = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 4; k++) {
      const j = si.getComponent(i, k), w = sw.getComponent(i, k);
      sidx[i * 4 + k] = j; swt[i * 4 + k] = w;
      if (cat[j] >= 0) cloth[i * 4 + cat[j]] += w;
      if (isTorso[j]) torsoW[i] += w;
      if (isArm[j]) armW[i] += w;
      if (j === headIdx) headW[i] += w;
    }
  }
  g.setAttribute('aCloth', new THREE.BufferAttribute(cloth, 4));

  // bind pose positions in character space (meters)
  const P = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    body.getVertexPosition(i, _v);
    _v.applyMatrix4(body.matrixWorld);
    P[i * 3] = _v.x; P[i * 3 + 1] = _v.y; P[i * 3 + 2] = _v.z;
  }
  // joints
  const J = {};
  const bind = {};
  const cleanInv = [];
  for (const b of bones) {
    J[b.name] = b.getWorldPosition(new THREE.Vector3());
    const bw = b.getWorldQuaternion(new THREE.Quaternion());
    const pw = b.parent && b.parent.isBone ? b.parent.getWorldQuaternion(new THREE.Quaternion()) : new THREE.Quaternion();
    bind[b.name] = { bw, pwInv: pw.clone().invert(), local: b.quaternion.clone() };
    cleanInv.push(b.matrixWorld.clone().invert());
  }
  const base = { scene, bones, J, bind, cleanInv, P, sidx, swt, torsoW, headW, armW, n };
  base.vest = buildVest(base);
  base.helmet = buildHelmet(base);
  return base;
}

// nearest body vertex -> copy skin weights (for clothes skinned to the same skeleton)
function skinFromBody(base, geo, filter) {
  const pos = geo.attributes.position, m = pos.count;
  const si = new Uint16Array(m * 4), sw = new Float32Array(m * 4);
  const P = base.P;
  for (let i = 0; i < m; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    let best = -1, bd = 1e9;
    for (let k = 0; k < base.n; k++) {
      if (filter && !filter(k)) continue;
      const dx = P[k * 3] - x, dy = P[k * 3 + 1] - y, dz = P[k * 3 + 2] - z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bd) { bd = d; best = k; }
    }
    for (let c = 0; c < 4; c++) { si[i * 4 + c] = base.sidx[best * 4 + c]; sw[i * 4 + c] = base.swt[best * 4 + c]; }
  }
  geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(si, 4));
  geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(sw, 4));
}

// ---------------------------------------------------------------------------
// Life vest fitted to the torso
// ---------------------------------------------------------------------------
function buildVest(base) {
  const { J, P, torsoW, n } = base;
  const y0 = J.spine_01.y - 0.07, y1 = J.upperarm_l.y - 0.1;
  const cz = J.spine_02.z + 0.005;
  const K = 9, N = 40;
  const R = new Float32Array(K * N);
  const dy = (y1 - y0) / (K - 1);
  for (let i = 0; i < n; i++) {
    if (torsoW[i] < 0.45) continue;
    const x = P[i * 3], y = P[i * 3 + 1], z = P[i * 3 + 2] - cz;
    const k = Math.round((y - y0) / dy);
    if (k < 0 || k >= K || Math.abs(y - (y0 + k * dy)) > dy * 0.75) continue;
    let a = Math.atan2(z, x); if (a < 0) a += TAU;
    const j = Math.floor((a / TAU) * N) % N;
    const r = Math.hypot(x, z);
    if (r > R[k * N + j]) R[k * N + j] = r;
  }
  // fill holes + smooth
  for (let k = 0; k < K; k++) {
    for (let pass = 0; pass < 3; pass++) {
      for (let j = 0; j < N; j++) {
        if (R[k * N + j] > 0) continue;
        let l = 1, r = 1;
        while (R[k * N + ((j - l + N) % N)] === 0 && l < N) l++;
        while (R[k * N + ((j + r) % N)] === 0 && r < N) r++;
        const a = R[k * N + ((j - l + N) % N)], b = R[k * N + ((j + r) % N)];
        R[k * N + j] = (a * r + b * l) / (l + r) || 0.15;
      }
    }
    for (let pass = 0; pass < 3; pass++) {
      const tmp = R.slice(k * N, k * N + N);
      for (let j = 0; j < N; j++) R[k * N + j] = Math.max(tmp[j], tmp[(j + N - 1) % N] * 0.25 + tmp[j] * 0.5 + tmp[(j + 1) % N] * 0.25);
    }
  }
  for (let pass = 0; pass < 2; pass++) {
    const tmp = R.slice();
    for (let k = 1; k < K - 1; k++) for (let j = 0; j < N; j++) R[k * N + j] = Math.max(tmp[k * N + j], (tmp[(k - 1) * N + j] + tmp[(k + 1) * N + j]) * 0.5);
  }
  const thick = (a) => 0.034 + 0.012 * Math.max(0, Math.sin(a)); // a little bulkier on the chest
  const pts = [], uvs = [], idxMain = [], idxWeb = [];
  const ring = (k, off, inset = 0) => {
    const start = pts.length / 3;
    const y = y0 + k * dy;
    for (let j = 0; j <= N; j++) {
      const a = ((j % N) + 0.5) / N * TAU;
      const r = R[k * N + (j % N)] + thick(a) + off - inset;
      pts.push(Math.cos(a) * r, y, Math.sin(a) * r + cz);
      uvs.push(j / N, k / (K - 1));
    }
    return start;
  };
  const strip = (s0, s1, out) => {
    for (let j = 0; j < N; j++) out.push(s0 + j, s1 + j, s0 + j + 1, s0 + j + 1, s1 + j, s1 + j + 1);
  };
  // outer shell
  const rows = [];
  for (let k = 0; k < K; k++) rows.push(ring(k, 0));
  for (let k = 0; k < K - 1; k++) strip(rows[k], rows[k + 1], idxMain);
  // rims (thickness) at top & bottom
  const topIn = ring(K - 1, 0, 0.03), botIn = ring(0, 0, 0.03);
  strip(rows[K - 1], topIn, idxMain);
  strip(botIn, rows[0], idxMain);
  // webbing bands (slightly proud of the shell)
  for (const kb of [2, 5]) {
    const lo = pts.length / 3;
    const y = y0 + kb * dy;
    for (const yy of [y - 0.017, y + 0.017]) {
      for (let j = 0; j <= N; j++) {
        const a = ((j % N) + 0.5) / N * TAU;
        const kk = kb;
        const r = R[kk * N + (j % N)] + thick(a) + 0.006;
        pts.push(Math.cos(a) * r, yy, Math.sin(a) * r + cz);
        uvs.push(0, 0);
      }
    }
    for (let j = 0; j < N; j++) idxWeb.push(lo + j, lo + N + 1 + j, lo + j + 1, lo + j + 1, lo + N + 1 + j, lo + N + 2 + j);
  }
  // zipper (front centre)
  {
    const lo = pts.length / 3;
    const a = TAU / 4;
    const jf = Math.round((a / TAU) * N - 0.5);
    for (let k = 0; k < K; k++) {
      const y = y0 + k * dy;
      const r = R[k * N + jf] + thick(a) + 0.004;
      for (const off of [-0.008, 0.008]) pts.push(off, y, Math.sin(a) * r + cz);
      uvs.push(0, 0, 0, 0);
    }
    for (let k = 0; k < K - 1; k++) { const s = lo + k * 2; idxWeb.push(s, s + 1, s + 2, s + 1, s + 3, s + 2); }
  }
  // shoulder straps: front top edge -> over the trapezius -> back top edge
  const topY = (sx) => {
    let best = 0;
    for (let i = 0; i < n; i++) {
      if (Math.abs(P[i * 3] - sx) < 0.025 && Math.abs(P[i * 3 + 2] - cz) < 0.05) best = Math.max(best, P[i * 3 + 1]);
    }
    return best;
  };
  const frontR = (x, k) => { // radius of the top ring near given x on the front/back
    let bf = null;
    for (let j = 0; j < N; j++) {
      const a = (j + 0.5) / N * TAU;
      const r = R[k * N + j] + thick(a);
      const px = Math.cos(a) * r;
      if (Math.abs(px - x) < 0.02) bf = bf || [];
      if (Math.abs(px - x) < 0.02) bf.push([Math.sin(a) * r, a]);
    }
    return bf;
  };
  for (const side of [-1, 1]) {
    const sx = side * 0.105;
    const ty = topY(side * 0.12) || J.neck_01.y - 0.02;
    const cands = frontR(sx, K - 1) || [[0.12, 1], [-0.12, -1]];
    const zf = Math.max(...cands.map((c) => c[0])), zb = Math.min(...cands.map((c) => c[0]));
    const F = new THREE.Vector3(sx, y1 - 0.01, zf + cz), B = new THREE.Vector3(sx, y1 - 0.01, zb + cz);
    const M = new THREE.Vector3(side * 0.118, ty + 0.03, cz - 0.01);
    const curve = new THREE.CatmullRomCurve3([F, new THREE.Vector3(sx * 1.05, (F.y + M.y) / 2 + 0.035, (F.z + M.z) / 2 + 0.04), M,
      new THREE.Vector3(sx * 1.05, (B.y + M.y) / 2 + 0.035, (B.z + M.z) / 2 - 0.04), B]);
    const NS = 16;
    const lo = pts.length / 3;
    for (let i = 0; i <= NS; i++) {
      const t = i / NS;
      const p = curve.getPoint(t), tg = curve.getTangent(t);
      const outw = _v.set(0, p.y - Math.min(p.y, J.neck_01.y - 0.12), p.z - cz).normalize();
      const wdir = _v2.crossVectors(tg, outw).normalize();
      const hw = 0.036, th = 0.024;
      for (const [a, b] of [[-1, 0], [1, 0], [1, 1], [-1, 1]]) {
        pts.push(p.x + wdir.x * hw * a + outw.x * th * b, p.y + wdir.y * hw * a + outw.y * th * b, p.z + wdir.z * hw * a + outw.z * th * b);
        uvs.push(t, b);
      }
    }
    for (let i = 0; i < NS; i++) {
      for (let f = 0; f < 4; f++) {
        const a = lo + i * 4 + f, b = lo + i * 4 + ((f + 1) % 4), c = a + 4, d = b + 4;
        idxMain.push(a, c, b, b, c, d);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geo.setIndex([...idxMain, ...idxWeb]);
  geo.addGroup(0, idxMain.length, 0);
  geo.addGroup(idxMain.length, idxWeb.length, 1);
  geo.computeVertexNormals();
  skinFromBody(base, geo, (k) => base.armW[k] < 0.02 && (base.torsoW[k] > 0.25 || P[k * 3 + 1] > y1 - 0.02));
  return geo;
}

// ---------------------------------------------------------------------------
// Whitewater helmet (rigid, on the head bone)
// ---------------------------------------------------------------------------
function buildHelmet(base) {
  const { P, headW, n, J } = base;
  const mn = new THREE.Vector3(1e9, 1e9, 1e9), mx = new THREE.Vector3(-1e9, -1e9, -1e9);
  for (let i = 0; i < n; i++) {
    if (headW[i] < 0.6 || P[i * 3 + 1] < J.Head.y + 0.02) continue;
    _v.set(P[i * 3], P[i * 3 + 1], P[i * 3 + 2]);
    mn.min(_v); mx.max(_v);
  }
  const c = mn.clone().add(mx).multiplyScalar(0.5);
  const ax = (mx.x - mn.x) / 2 + 0.024, az = (mx.z - mn.z) / 2 * 0.92 + 0.022, ay = 0.12;
  const cy = mx.y + 0.02 - ay;
  const shell = new THREE.SphereGeometry(1, 26, 14, 0, TAU, 0, Math.PI * 0.6);
  shell.scale(ax, ay * 1.08, az).rotateX(-0.2).translate(c.x, cy, c.z - 0.01);
  // brim
  const brim = new THREE.CylinderGeometry(1, 1.12, 0.05, 20, 1, true, -0.95, 1.9);
  brim.scale(ax * 1.0, 1, az * 1.0).rotateX(-0.2).translate(c.x, cy - 0.005, c.z - 0.01);
  // rim band + headlamp housing
  const rim = new THREE.TorusGeometry(1, 0.012, 5, 30);
  rim.rotateX(Math.PI / 2).scale(ax * 1.0, 1, az * 1.0).rotateX(-0.2).translate(c.x, cy - 0.022, c.z - 0.01);
  const lamp = new THREE.CylinderGeometry(0.018, 0.022, 0.035, 10).rotateX(Math.PI / 2).translate(c.x, cy + ay * 0.55, c.z + az * 0.9);
  const lens = new THREE.SphereGeometry(0.015, 10, 6).translate(c.x, cy + ay * 0.55, c.z + az * 0.9 + 0.018);
  const vents = [];
  const toHead = new THREE.Matrix4().copy(base.cleanInv[base.bones.findIndex((b) => b.name === 'Head')]);
  for (const g of [shell, brim, rim, lamp, lens, ...vents]) g.applyMatrix4(toHead);
  return { shell, brim, rim, lamp, lens, vents, lampLocal: new THREE.Vector3(c.x, cy + ay * 0.55, c.z + az * 0.9 + 0.03).applyMatrix4(toHead) };
}

// ---------------------------------------------------------------------------
// Paddle (origin at the T-grip, shaft along -Y, blade face +Z)
// ---------------------------------------------------------------------------
export const PADDLE_LEN = 1.3; // grip -> blade centre
function paddleGeometries() {
  const shaft = new THREE.CylinderGeometry(0.016, 0.017, PADDLE_LEN - 0.12, 8).translate(0, -(PADDLE_LEN - 0.12) / 2, 0);
  const grip = new THREE.CapsuleGeometry(0.02, 0.1, 3, 8).rotateZ(Math.PI / 2).translate(0, 0.012, 0);
  const s = new THREE.Shape();
  const w = 0.105, h = 0.25;
  s.moveTo(-0.03, h);
  s.quadraticCurveTo(-w, h - 0.06, -w, 0.05);
  s.lineTo(-w * 0.95, -h + 0.06);
  s.quadraticCurveTo(-w * 0.9, -h, 0, -h - 0.01);
  s.quadraticCurveTo(w * 0.9, -h, w * 0.95, -h + 0.06);
  s.lineTo(w, 0.05);
  s.quadraticCurveTo(w, h - 0.06, 0.03, h);
  s.closePath();
  const blade = new THREE.ExtrudeGeometry(s, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.006, bevelSegments: 2, curveSegments: 6 });
  blade.translate(0, 0, -0.006).translate(0, -PADDLE_LEN, 0);
  // gentle spoon curve
  const p = blade.attributes.position;
  for (let i = 0; i < p.count; i++) p.setZ(i, p.getZ(i) + p.getX(i) * p.getX(i) * 1.2);
  blade.computeVertexNormals();
  const throat = new THREE.CylinderGeometry(0.02, 0.028, 0.12, 8).translate(0, -PADDLE_LEN + h + 0.04, 0);
  return { shaft, grip, blade, throat };
}

// ---------------------------------------------------------------------------
// Rafter instance
// ---------------------------------------------------------------------------
let PG = null;
const MAT = {};
function sharedMats() {
  if (MAT.black) return MAT;
  MAT.black = patchMaterial(new THREE.MeshStandardMaterial({ color: '#16181c', roughness: 0.55, metalness: 0.1 }), {});
  MAT.web = patchMaterial(new THREE.MeshStandardMaterial({ color: '#1c1d22', roughness: 0.9 }), {});
  MAT.lens = new THREE.MeshBasicMaterial({ color: '#fff4d8' });
  MAT.lamp = patchMaterial(new THREE.MeshStandardMaterial({ color: '#2a2c30', roughness: 0.4, metalness: 0.5 }), {});
  return MAT;
}

export class Rafter {
  /**
   * o: { base, scale, side(-1 left / 1 right of raft), seat: Vector3 (hip joint in raft space), role: 'paddler'|'guide',
   *      colors: { jacket, pants, shoe, skin, vest, helmet, blade, longPants } }
   */
  constructor(o) {
    const M = sharedMats();
    if (!PG) PG = paddleGeometries();
    this.o = o;
    this.base = o.base;
    this.side = o.side;
    this.role = o.role || 'paddler';
    const root = skClone(o.base.scene);
    root.scale.setScalar(o.scale || 1);
    root.updateMatrixWorld(true);
    this.root = root;
    const bone = {};
    root.traverse((c) => { if (c.isBone) bone[c.name] = c; });
    this.bone = bone;
    const C = o.colors;
    this.cloth = {
      uJacket: { value: new THREE.Color(C.jacket) }, uPants: { value: new THREE.Color(C.pants) }, uShoe: { value: new THREE.Color(C.shoe || '#1d1f24') },
      uSkin: { value: new THREE.Color(C.skin || '#ffffff') }, uLongPants: { value: C.longPants ? 1 : 0 },
    };
    root.traverse((c) => {
      if (!c.isSkinnedMesh) return;
      c.frustumCulled = false;
      c.castShadow = true; c.receiveShadow = true;
      if (/body/.test(c.name)) {
        const m = c.material.clone();
        m.roughness = 0.62; m.envMapIntensity = 0.55;
        if (m.normalScale) m.normalScale.set(0.8, 0.8);
        c.material = patchMaterial(m, { cloth: this.cloth });
        this.body = c;
      } else {
        c.material = patchMaterial(c.material.clone(), {});
        c.castShadow = false;
      }
    });
    // life vest skinned to a clean-inverse skeleton
    const vestMat = this.vestMat = patchMaterial(new THREE.MeshStandardMaterial({ color: C.vest, roughness: 0.72, envMapIntensity: 0.5 }), {});
    const vest = new THREE.SkinnedMesh(o.base.vest, [vestMat, M.web]);
    vest.frustumCulled = false; vest.castShadow = true; vest.receiveShadow = true;
    root.add(vest);
    root.updateMatrixWorld(true);
    const bonesInOrder = o.base.bones.map((b) => bone[b.name]);
    vest.bind(new THREE.Skeleton(bonesInOrder, o.base.cleanInv), vest.matrixWorld.clone());
    this.vest = vest;
    // helmet
    const H = o.base.helmet;
    const helmMat = this.helmMat = patchMaterial(new THREE.MeshStandardMaterial({ color: C.helmet, roughness: 0.32, metalness: 0.05, envMapIntensity: 1.0 }), {});
    const head = bone.Head;
    for (const g of [H.shell]) { const m = new THREE.Mesh(g, helmMat); m.castShadow = true; head.add(m); }
    for (const g of [H.brim, H.rim, ...H.vents]) head.add(new THREE.Mesh(g, M.black));
    head.add(new THREE.Mesh(H.lamp, M.lamp));
    this.lens = new THREE.Mesh(H.lens, M.lens);
    head.add(this.lens);
    this.lampLocal = H.lampLocal;
    // paddle (lives in raft space, driven by the hands)
    const bladeMat = this.bladeMat = patchMaterial(new THREE.MeshStandardMaterial({ color: C.blade || '#f2c318', roughness: 0.45, envMapIntensity: 0.7 }), {});
    this.paddle = new THREE.Group();
    const pm = [new THREE.Mesh(PG.shaft, M.black), new THREE.Mesh(PG.grip, M.black), new THREE.Mesh(PG.throat, M.black), new THREE.Mesh(PG.blade, bladeMat)];
    for (const m of pm) { m.castShadow = true; this.paddle.add(m); }

    // which hand is outboard (lower on the shaft)
    // character faces +Z; it is rotated by PI in the raft, so char +X (left) == raft -X
    this.outHand = this.side < 0 ? 'l' : 'r';
    this.inHand = this.side < 0 ? 'r' : 'l';
    this.oc = this.side < 0 ? 1 : -1; // outboard direction sign in char X
    this.phase = Math.random();
    this.rate = 0.9 + Math.random() * 0.1;
    this.bladeY = 1;
    this.splash = 0;
    this.blade = new THREE.Vector3();
    this.bladeIn = 0;
    // scratch
    this.L = {};
    this.lastBladeY = 1;
  }

  /** shop skins: outfit colours (jacket, pants, vest, helmet, metal flags) */
  setOutfit(c) {
    this.cloth.uJacket.value.set(c.jacket);
    this.cloth.uPants.value.set(c.pants);
    this.cloth.uLongPants.value = c.longPants ? 1 : 0;
    const metal = (m, on, rough) => { m.metalness = on ? 0.85 : 0.05; m.roughness = on ? 0.3 : rough; m.envMapIntensity = on ? 1.2 : m === this.vestMat ? 0.5 : 1.0; };
    this.vestMat.color.set(c.vest); metal(this.vestMat, c.metalVest, 0.72);
    this.vestMat.emissive.set(c.glowVest ? c.vest : '#000000'); this.vestMat.emissiveIntensity = c.glowVest ? 0.35 : 1;
    this.helmMat.color.set(c.helmet); metal(this.helmMat, c.metalHelmet, 0.32);
  }

  setBlade(color, metal) {
    this.bladeMat.color.set(color);
    this.bladeMat.metalness = metal ? 0.85 : 0;
    this.bladeMat.roughness = metal ? 0.28 : 0.45;
    this.bladeMat.envMapIntensity = metal ? 1.2 : 0.7;
  }

  /** place in raft: root at seat (hip joint position) facing -Z */
  attach(parent) {
    const sc = this.root.scale.x;
    const hipY = this.base.J.thigh_l.y * sc;
    this.root.position.set(this.o.seat.x, this.o.seat.y - hipY, this.o.seat.z);
    this.root.rotation.set(0, Math.PI + (this.o.yaw || 0), 0);
    if (this.parent !== parent) { parent.add(this.root); parent.add(this.paddle); }
    this.parent = parent;
  }

  /**
   * re-seat on another vessel. s: { p: [x,y,z] hip joint, pose: 'paddle'|'guide'|'sit'|'tube'|'helm'|'stand',
   *   side, scale, yaw, hands: { l: [x,y,z], r: [x,y,z] } (vessel space) } ; null hides the member
   */
  place(s, parent) {
    if (!s) { this.root.visible = false; this.paddle.visible = false; this.hidden = true; return; }
    this.hidden = false;
    this.root.visible = true;
    this.pose = s.pose || 'paddle';
    this.role = this.pose === 'guide' ? 'guide' : 'paddler';
    this.side = s.side || (s.p[0] < 0 ? -1 : 1);
    this.outHand = this.side < 0 ? 'l' : 'r';
    this.inHand = this.side < 0 ? 'r' : 'l';
    this.oc = this.side < 0 ? 1 : -1;
    this.o.seat = new THREE.Vector3(...s.p);
    this.o.yaw = s.yaw || 0;
    this.hands = s.hands ? { l: new THREE.Vector3(...s.hands.l), r: new THREE.Vector3(...s.hands.r) } : null;
    this.root.scale.setScalar(s.scale || this.o.scale || 1);
    this.paddle.visible = this.pose === 'paddle' || this.pose === 'guide';
    this.paddle.scale.setScalar((s.scale || this.o.scale || 1) / (this.o.scale || 1));
    this.attach(parent);
    this.bladeIn = 0;
    this.floor = undefined; // re-measured on the next update
  }

  /** passengers / helmsman: seated or standing, hands on knees, a rope or a wheel */
  updateStill(dt, time, steer, crashT) {
    const L = this.L, pose = this.pose;
    const ph = this.phase = (this.phase + dt * 0.13) % 1;
    const sway = Math.sin(time * 1.1 + this.phase * 6.3) * 0.04;
    const stand = pose === 'stand' || pose === 'helm';
    const lean = (stand ? 0.04 : 0.1) + (pose === 'helm' ? 0.12 : 0) + crashT * 0.3;
    const look = Math.sin(time * 0.37 + ph * 9) * 0.5 + (pose === 'helm' ? -steer * 0.015 : 0);
    for (const sp of ['spine_01', 'spine_02', 'spine_03']) this.setBone(sp, ypr(sway / 3, lean / 3, -sway / 3 - crashT * 0.25, L.s || (L.s = new THREE.Quaternion())));
    this.setBone('neck_01', ypr(look * 0.35, -lean * 0.3, 0, L.n || (L.n = new THREE.Quaternion())));
    this.setBone('Head', ypr(look * 0.55, -lean * 0.4 - 0.04, 0, L.h || (L.h = new THREE.Quaternion())));
    for (const s of ['l', 'r']) {
      const cs = s === 'l' ? 1 : -1;
      if (stand) {
        this.setBone('thigh_' + s, ypr(0, -0.06, cs * 0.06, L['t' + s] || (L['t' + s] = new THREE.Quaternion())));
        this.setBone('calf_' + s, qx(0.1, L['c' + s] || (L['c' + s] = new THREE.Quaternion())));
        this.setBone('foot_' + s, qx(-0.05, L['f' + s] || (L['f' + s] = new THREE.Quaternion())));
      } else if (pose === 'tube') {
        // sitting on a tube, legs tucked inboard like the paddlers
        const inb = -this.oc, isIn = cs === inb;
        this.setBone('thigh_' + s, ypr(isIn ? inb * 1.05 : inb * 1.0, -(isIn ? 1.42 : 1.3), cs * 0.05, L['t' + s] || (L['t' + s] = new THREE.Quaternion())));
        this.setBone('calf_' + s, qx(isIn ? 1.28 : 1.24, L['c' + s] || (L['c' + s] = new THREE.Quaternion())));
        this.setBone('foot_' + s, qx(-0.25, L['f' + s] || (L['f' + s] = new THREE.Quaternion())));
      } else {
        this.setBone('thigh_' + s, ypr(cs * -0.12, -1.45, cs * 0.05, L['t' + s] || (L['t' + s] = new THREE.Quaternion())));
        this.setBone('calf_' + s, qx(1.5, L['c' + s] || (L['c' + s] = new THREE.Quaternion())));
        this.setBone('foot_' + s, qx(-0.2, L['f' + s] || (L['f' + s] = new THREE.Quaternion())));
      }
      this.setBone('clavicle_' + s, qz(-cs * 0.05, L['k' + s] || (L['k' + s] = new THREE.Quaternion())));
      this.setBone('upperarm_' + s, ypr(-cs * 0.6, 0, -cs * 1.15, L['u' + s] || (L['u' + s] = new THREE.Quaternion())));
      this.setBone('lowerarm_' + s, qy(-cs * 1.2, L['o' + s] || (L['o' + s] = new THREE.Quaternion())));
      this.setBone('hand_' + s, qx(0, L['a' + s] || (L['a' + s] = new THREE.Quaternion())));
      for (const f of FINGERS) for (let i = 1; i <= 3; i++) this.setBone(`${f}_0${i}_${s}`, qz(-cs * (i === 1 ? 0.8 : 0.9), L.fq || (L.fq = new THREE.Quaternion())));
      this.setBone(`thumb_02_${s}`, ypr(0, 0.4, -cs * 0.4, L.tq || (L.tq = new THREE.Quaternion())));
    }
    this.root.updateMatrixWorld(true);
    if (!stand) {
      if (this.floor === undefined) this.measureFloor();
      this.plantFeet();
    }
    const p = this.parent;
    const pq = p.getWorldQuaternion(_q3.identity());
    const sc = this.root.scale.x / 0.94;
    const z0 = this.o.seat, cy = Math.cos(this.o.yaw || 0), sy = Math.sin(this.o.yaw || 0);
    for (const s of ['l', 'r']) {
      const cs = s === 'l' ? -1 : 1; // vessel-space side of this hand (char faces -Z, char left = -X)
      let t;
      if (this.hands) t = this.hands[s].clone();
      else if (stand) t = new THREE.Vector3(cs * 0.24 * sc, -0.12 * sc, 0.02 * sc);
      else t = new THREE.Vector3(cs * 0.17 * sc, 0.06 * sc, -0.36 * sc); // on the knees
      if (!this.hands) { // relative to the seat, turned with the body
        t.set(t.x * cy + t.z * sy, t.y, -t.x * sy + t.z * cy).add(z0);
      }
      if (crashT > 0) t.y += crashT * 0.5;
      const w = p.localToWorld(t);
      const sh = this.bone['upperarm_' + s].getWorldPosition(_v2);
      w.addScaledVector(sh.clone().sub(w).normalize(), 0.06 * sc);
      const pole = new THREE.Vector3(cs * 0.8, -0.5, 0.45).applyQuaternion(pq);
      this.solveArm(s, w, pole);
    }
  }

  /**
   * Find the vessel floor under each foot (vessel space), once per seat: a short ray down the vessel's own
   * up axis from below the seat, nearest hull surface. null = nothing to stand on (leave the leg alone).
   */
  measureFloor() {
    const probe = this.floorProbe, p = this.parent;
    this.floor = null;
    if (!probe || !p) return;
    const metas = [];
    probe.traverse((o) => { if (o.isMesh) metas.push(o); });
    if (!metas.length) return;
    p.updateMatrixWorld(true);
    const rc = _ray || (_ray = new THREE.Raycaster());
    rc.layers.enableAll();
    rc.far = 1.4;
    const down = _fD.set(0, -1, 0).applyQuaternion(p.getWorldQuaternion(_fQ));
    const out = {};
    for (const s of ['l', 'r']) {
      let best = null;
      for (const bn of ['foot_' + s, 'ball_' + s]) {
        const b = this.bone[bn];
        if (!b) continue;
        const l = p.worldToLocal(b.getWorldPosition(_fA));
        l.y = this.o.seat.y - 0.18;
        rc.set(p.localToWorld(l), down);
        // nearest surface below (hull materials are mixed single/double sided, so face normals can't be trusted)
        const h = rc.intersectObjects(metas, false)[0];
        if (h) {
          const y = p.worldToLocal(_fC.copy(h.point)).y;
          if (best === null || y > best) best = y;
        }
      }
      out[s] = best;
    }
    this.floor = out;
  }

  /** seated legs: if a sole sinks through the floor, lift it onto the floor (knee rises), then level the foot */
  plantFeet() {
    const F = this.floor, p = this.parent;
    if (!F || !p) return;
    const sc = this.root.scale.x, J = this.base.J;
    const ankleH = J.foot_l.y * sc, ballDy = (J.ball_l.y - J.foot_l.y) * sc;
    for (const s of ['l', 'r']) {
      const fl = F[s];
      if (fl === null || fl === undefined) continue;
      const foot = this.bone['foot_' + s], ball = this.bone['ball_' + s], thigh = this.bone['thigh_' + s];
      const aL = p.worldToLocal(foot.getWorldPosition(_fA));
      const want = fl + ankleH + 0.005;
      if (aL.y >= want) continue;
      aL.y = want;
      const target = p.localToWorld(aL);
      // keep the knee bending the way the pose already bends it
      const hip = thigh.getWorldPosition(_fB);
      const pole = this.bone['calf_' + s].getWorldPosition(_fC).sub(hip);
      this.solve2(thigh, this.bone['calf_' + s], foot, target, pole);
      if (!ball) continue;
      // level the foot: ball joint back at its bind height above the sole
      const a2 = p.worldToLocal(foot.getWorldPosition(_fA));
      const bW = ball.getWorldPosition(_fB);
      const b2 = p.worldToLocal(_fC.copy(bW));
      const hx = b2.x - a2.x, hz = b2.z - a2.z, hl = Math.hypot(hx, hz) || 1;
      const len = a2.distanceTo(b2);
      const h = Math.sqrt(Math.max(0, len * len - ballDy * ballDy));
      _fE.set(a2.x + (hx / hl) * h, a2.y + ballDy, a2.z + (hz / hl) * h);
      this.aim(foot, bW, p.localToWorld(_fE));
    }
  }

  setBone(name, L) {
    const b = this.bone[name], bd = this.base.bind[name];
    if (!b) return;
    b.quaternion.copy(bd.pwInv).multiply(L).multiply(bd.bw);
  }

  /** IK for one arm: aim upper/lower arm so the wrist reaches target (world); pole = elbow hint (world dir) */
  solveArm(s, target, pole) { this.solve2(this.bone['upperarm_' + s], this.bone['lowerarm_' + s], this.bone['hand_' + s], target, pole); }

  /** two-bone IK (arm or leg): aim up/lo so the end joint reaches target (world); pole = bend hint (world dir) */
  solve2(up, lo, ha, target, pole) {
    const S = up.getWorldPosition(_v);
    const E0 = lo.getWorldPosition(_v2);
    const H0 = ha.getWorldPosition(_v3);
    const l1 = S.distanceTo(E0), l2 = E0.distanceTo(H0);
    const D = _v4.copy(target).sub(S);
    let d = D.length();
    const dir = D.clone().divideScalar(d || 1);
    d = Math.min(Math.max(d, Math.abs(l1 - l2) + 0.01), (l1 + l2) * 0.999);
    const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    const pv = pole.clone().addScaledVector(dir, -pole.dot(dir)).normalize();
    const E = S.clone().addScaledVector(dir, a).addScaledVector(pv, h);
    const T = S.clone().addScaledVector(dir, d);
    this.aim(up, E0, E);
    lo.getWorldPosition(E0);
    ha.getWorldPosition(H0);
    this.aim(lo, H0, T);
  }

  /** rotate bone so that its child (currently at childW) points at desiredW */
  aim(bone, childW, desiredW) {
    const P = bone.getWorldPosition(new THREE.Vector3());
    const a = childW.clone().sub(P).normalize(), b = desiredW.clone().sub(P).normalize();
    _q.setFromUnitVectors(a, b);
    bone.getWorldQuaternion(_q2);
    _q.multiply(_q2); // new world rotation
    bone.parent.getWorldQuaternion(_q3).invert();
    bone.quaternion.copy(_q3.multiply(_q));
    bone.updateMatrixWorld(true);
  }

  palm(s, out) {
    const ha = this.bone['hand_' + s], mid = this.bone['middle_01_' + s];
    ha.getWorldPosition(out);
    mid.getWorldPosition(_v4);
    return out.lerp(_v4, 0.62);
  }

  /**
   * t: time, dt, steer: lateral velocity of raft (for the guide), effort: 0..1, pose overrides for crash
   */
  update(dt, time, steer, speed, crash) {
    if (this.hidden) return;
    if (this.pose && this.pose !== 'paddle' && this.pose !== 'guide') { this.updateStill(dt, time, steer, crash || 0); this.bladeIn = 0; return; }
    const L = this.L;
    const oc = this.oc;
    const guide = this.role === 'guide';
    const rate = guide ? 0.35 : (0.62 + Math.min(speed, 40) * 0.006 + Math.max(0, -steer * this.side) * 0.03) * this.rate;
    this.phase = (this.phase + dt * rate) % 1;
    const ph = this.phase;
    const k = strokeAt(ph, guide);

    // ---- body (char space)
    const crashT = crash || 0;
    const lean = guide ? 0.12 + Math.sin(time * 1.3) * 0.03 : k.lean;
    const twist = guide ? -oc * (0.12 + steer * 0.01) : -oc * k.twist;
    const side = guide ? 0.04 : 0.16;
    for (const sp of ['spine_01', 'spine_02', 'spine_03']) {
      this.setBone(sp, ypr(twist / 3, lean / 3 + crashT * 0.2, -oc * side / 3 - crashT * 0.25, L.s || (L.s = new THREE.Quaternion())));
    }
    this.setBone('neck_01', ypr(-twist * 0.35, -lean * 0.3, oc * side * 0.3, L.n || (L.n = new THREE.Quaternion())));
    this.setBone('Head', ypr(-twist * 0.45 + Math.sin(time * 0.7 + this.side) * 0.08, -lean * 0.45 - 0.05, oc * side * 0.3, L.h || (L.h = new THREE.Quaternion())));
    // legs: seated, inboard foot tucked
    const inb = -oc;
    for (const s of ['l', 'r']) {
      const charSide = s === 'l' ? 1 : -1;
      const isIn = charSide === inb;
      const yaw = guide ? charSide * -0.12 : (isIn ? inb * 1.05 : inb * 1.0);
      const pitch = guide ? 1.45 : (isIn ? 1.42 : 1.3);
      const knee = guide ? 1.55 : (isIn ? 1.28 : 1.24);
      this.setBone('thigh_' + s, ypr(yaw, -pitch, charSide * 0.05, L['t' + s] || (L['t' + s] = new THREE.Quaternion())));
      this.setBone('calf_' + s, qx(knee, L['c' + s] || (L['c' + s] = new THREE.Quaternion())));
      this.setBone('foot_' + s, qx(-0.25, L['f' + s] || (L['f' + s] = new THREE.Quaternion())));
    }
    // arms start from a relaxed pose (helps the IK keep a natural twist)
    for (const s of ['l', 'r']) {
      const cs = s === 'l' ? 1 : -1;
      this.setBone('clavicle_' + s, qz(-cs * 0.05, L['k' + s] || (L['k' + s] = new THREE.Quaternion())));
      this.setBone('upperarm_' + s, ypr(-cs * 0.6, 0, -cs * 1.15, L['u' + s] || (L['u' + s] = new THREE.Quaternion())));
      this.setBone('lowerarm_' + s, qy(-cs * 1.2, L['o' + s] || (L['o' + s] = new THREE.Quaternion())));
      this.setBone('hand_' + s, qx(0, L['a' + s] || (L['a' + s] = new THREE.Quaternion())));
      // grip: curl fingers
      for (const f of FINGERS) for (let i = 1; i <= 3; i++) {
        this.setBone(`${f}_0${i}_${s}`, qz(-cs * (i === 1 ? 0.95 : 1.05), L.fq || (L.fq = new THREE.Quaternion())));
      }
      this.setBone(`thumb_02_${s}`, ypr(0, 0.4, -cs * 0.4, L.tq || (L.tq = new THREE.Quaternion())));
    }
    this.root.updateMatrixWorld(true);
    if (this.floor === undefined) this.measureFloor();
    this.plantFeet();

    // ---- hand targets in raft space -> world
    const p = this.parent;
    const z0 = this.o.seat.z, sd = this.side;
    const lowL = _tmpA.set(sd * k.lx, k.ly, z0 + k.lz);
    const topL = _tmpB.set(sd * k.tx, k.ty, z0 + k.tz);
    if (crashT > 0) { lowL.y += crashT * 0.6; topL.y += crashT * 0.4; lowL.x -= sd * crashT * 0.3; }
    const lowW = p.localToWorld(lowL.clone()), topW = p.localToWorld(topL.clone());
    const pq = p.getWorldQuaternion(new THREE.Quaternion());
    // wrist targets sit a little before the palm
    const sh = this.bone['upperarm_' + this.outHand].getWorldPosition(new THREE.Vector3());
    const shIn = this.bone['upperarm_' + this.inHand].getWorldPosition(new THREE.Vector3());
    const lowWr = lowW.clone().addScaledVector(sh.clone().sub(lowW).normalize(), 0.07);
    const topWr = topW.clone().addScaledVector(shIn.clone().sub(topW).normalize(), 0.07);
    const poleOut = new THREE.Vector3(sd * 0.9, -0.6, 0.55).applyQuaternion(pq);
    const poleIn = new THREE.Vector3(-sd * 0.5, -0.7, 0.4).applyQuaternion(pq);
    this.solveArm(this.outHand, lowWr, poleOut);
    this.solveArm(this.inHand, topWr, poleIn);

    // ---- paddle follows the hands
    const top = this.palm(this.inHand, new THREE.Vector3());
    const low = this.palm(this.outHand, new THREE.Vector3());
    p.worldToLocal(top); p.worldToLocal(low);
    const u = low.sub(top).normalize(); // grip -> blade
    const yAx = u.clone().negate();
    const zAx = new THREE.Vector3(0, 0, 1).addScaledVector(yAx, -yAx.z).normalize();
    // feather the blade on recovery
    if (!guide) zAx.applyAxisAngle(yAx, sd * k.feather);
    else zAx.applyAxisAngle(yAx, -0.6 + steer * 0.03);
    const xAx = new THREE.Vector3().crossVectors(yAx, zAx).normalize();
    _m.makeBasis(xAx, yAx, zAx);
    this.paddle.quaternion.setFromRotationMatrix(_m);
    this.paddle.position.copy(top);
    // blade centre (raft space) for splashes / foam
    this.blade.copy(top).addScaledVector(u, PADDLE_LEN);
    this.bladeIn = Math.max(0, Math.min(1, (0.08 - this.blade.y) / 0.25));
  }
}
const _tmpA = new THREE.Vector3(), _tmpB = new THREE.Vector3();

// Paddle stroke keyframes (raft space offsets from the seat line).
// l* = lower (outboard) hand, t* = top hand (T-grip); x = |x| from raft centre line, z relative to seat
const KF = [
  // ph,   lx,   ly,    lz,    tx,   ty,   tz,   lean, twist, feather
  [0.00, 1.13, 0.46, -0.66, 0.90, 1.10, -0.62, 0.62, 0.34, 0.0],
  [0.14, 1.17, 0.36, -0.46, 0.98, 1.00, -0.44, 0.55, 0.26, 0.0],
  [0.40, 1.17, 0.40, 0.02, 1.00, 0.98, -0.10, 0.22, -0.08, 0.0],
  [0.52, 1.10, 0.66, 0.10, 0.88, 1.12, -0.02, 0.18, -0.1, 0.5],
  [0.76, 1.04, 0.8, -0.36, 0.82, 1.26, -0.38, 0.42, 0.18, 0.9],
];
const GUIDE_KF = [
  [0.00, 0.98, 0.50, 0.36, 0.62, 1.05, 0.08, 0.15, 0.1, 0.0],
  [0.50, 1.02, 0.46, 0.26, 0.66, 1.02, 0.00, 0.2, 0.15, 0.0],
];
const _k = { lx: 0, ly: 0, lz: 0, tx: 0, ty: 0, tz: 0, lean: 0, twist: 0, feather: 0 };
const KEYS = ['lx', 'ly', 'lz', 'tx', 'ty', 'tz', 'lean', 'twist', 'feather'];
function strokeAt(ph, guide) {
  const F = guide ? GUIDE_KF : KF;
  const n = F.length;
  let i = n - 1;
  for (let j = 0; j < n; j++) if (F[j][0] <= ph) i = j;
  const a = F[i], b = F[(i + 1) % n];
  const p0 = F[(i - 1 + n) % n], p3 = F[(i + 2) % n];
  const t0 = a[0], t1 = i + 1 < n ? b[0] : 1;
  const t = (ph - t0) / (t1 - t0 || 1);
  // Catmull-Rom (uniform) for smooth motion
  const t2 = t * t, t3 = t2 * t;
  for (let k = 0; k < KEYS.length; k++) {
    const P0 = p0[k + 1], P1 = a[k + 1], P2 = b[k + 1], P3 = p3[k + 1];
    _k[KEYS[k]] = 0.5 * (2 * P1 + (-P0 + P2) * t + (2 * P0 - 5 * P1 + 4 * P2 - P3) * t2 + (-P0 + 3 * P1 - 3 * P2 + P3) * t3);
  }
  return _k;
}

export function setLampLens(on) {
  const M = sharedMats();
  M.lens.color.setRGB(1, 0.95, 0.85).multiplyScalar(on ? 6 : 0.6);
}
