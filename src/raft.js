import * as THREE from 'three';
import { TAU, clamp } from './config.js';
import { patchMaterial } from './patch.js';
import { makeOrbMaterial } from './obstacles.js';
import { makeRaftTexture } from './textures.js';
import { Rafter, prepareBase, setLampLens } from './crew.js';
import { VESSELS, resolveSeats, paintVessel } from './vessels.js';

const RA = 0.8, RB = 1.78, RN = 3.0, KICK = 0.17, TUBE_R = 0.27, TUBE_Y = 0.12;

export function waveHeight(x, z, time, flow, amp) {
  const zz = z + flow;
  return (Math.sin(x * 0.7 + zz * 0.32 + time * 1.1) * 0.5 + Math.sin(-x * 0.5 + zz * 0.51 + time * 1.6) * 0.3 +
    Math.sin(x * 1.3 + zz * 0.9 - time * 2.3) * 0.2) * amp;
}

/** raft outline point (centre line of the tube) for angle t; t=-PI/2 is the bow */
function outline(t, a = RA, b = RB) {
  const c = Math.cos(t), s = Math.sin(t);
  return new THREE.Vector3(a * Math.sign(c) * Math.pow(Math.abs(c), 2 / RN), TUBE_Y + KICK * Math.pow(Math.abs(s), 6), b * Math.sign(s) * Math.pow(Math.abs(s), 2 / RN));
}

/** Tube with a controlled frame: v=0 bottom, .25 outside, .5 top, .75 inside; u starts at the bow */
function raftTube(N = 160, M = 22) {
  const pos = [], nor = [], uv = [], idx = [];
  const centres = [], outs = [];
  for (let i = 0; i <= N; i++) {
    const t = -Math.PI / 2 + (i / N) * TAU;
    const p = outline(t);
    const p1 = outline(t + 0.001), p0 = outline(t - 0.001);
    const tg = p1.sub(p0); tg.y = 0; tg.normalize();
    const o = new THREE.Vector3(tg.z, 0, -tg.x);
    if (o.x * p.x + o.z * p.z < 0) o.negate();
    centres.push(p); outs.push(o);
  }
  for (let i = 0; i <= N; i++) {
    const p = centres[i], o = outs[i];
    // slightly slimmer at bow/stern kick
    const t = -Math.PI / 2 + (i / N) * TAU;
    const r = TUBE_R * (1 - 0.06 * Math.pow(Math.abs(Math.sin(t)), 8));
    for (let j = 0; j <= M; j++) {
      const a = (j / M) * TAU - Math.PI / 2;
      const nx = Math.cos(a) * o.x, ny = Math.sin(a), nz = Math.cos(a) * o.z;
      pos.push(p.x + nx * r, p.y + ny * r, p.z + nz * r);
      nor.push(nx, ny, nz);
      uv.push(i / N, j / M);
    }
  }
  for (let i = 0; i < N; i++) for (let j = 0; j < M; j++) {
    // CCW seen from outside: (u, v) runs bow->stern and bottom->outside->top, so u x v points inward; swap
    const a = i * (M + 1) + j, b = a + M + 1;
    idx.push(a, a + 1, b, a + 1, b + 1, b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return { geo: g, centres, outs };
}

function floorGeometry() {
  const pts = [];
  for (let i = 0; i < 64; i++) {
    const p = outline((i / 64) * TAU, RA - 0.16, RB - 0.16);
    pts.push(new THREE.Vector2(p.x, p.z));
  }
  const g = new THREE.ShapeGeometry(new THREE.Shape(pts), 1).rotateX(Math.PI / 2);
  // shallow dish so the floor meets the tubes
  const p = g.attributes.position;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i) / (RA - 0.16), z = p.getZ(i) / (RB - 0.16);
    p.setY(i, -0.02 + 0.07 * Math.pow(Math.max(Math.abs(x), Math.abs(z)), 4));
  }
  g.computeVertexNormals();
  return g;
}

function floorTexture() {
  const cv = document.createElement('canvas');
  cv.width = cv.height = 128;
  const g = cv.getContext('2d');
  g.fillStyle = '#2b2e33'; g.fillRect(0, 0, 128, 128);
  g.strokeStyle = 'rgba(0,0,0,0.5)'; g.lineWidth = 2;
  for (let i = 0; i <= 128; i += 32) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, 128); g.stroke(); }
  g.fillStyle = 'rgba(255,255,255,0.06)';
  for (let y = 4; y < 128; y += 8) for (let x = 4; x < 128; x += 8) g.fillRect(x, y, 2, 2);
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(2, 4); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function teakTexture() {
  const cv = document.createElement('canvas');
  cv.width = 64; cv.height = 256;
  const g = cv.getContext('2d');
  g.fillStyle = '#b07a48'; g.fillRect(0, 0, 64, 256);
  for (let x = 0; x < 64; x += 8) {
    g.fillStyle = `hsl(28, 45%, ${38 + ((x * 7) % 9)}%)`; g.fillRect(x, 0, 7, 256);
    g.fillStyle = '#2a1d12'; g.fillRect(x + 7, 0, 1, 256);
  }
  const t = new THREE.CanvasTexture(cv);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(1.6, 1); t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const CREW = [
  { seat: [-RA + 0.15, 0.5, -0.78], side: -1, g: 'male', colors: { jacket: '#2f5ea8', pants: '#1c1f26', vest: '#d8241c', helmet: '#f2f2ee', skin: '#ffffff', blade: '#f6c21a', longPants: 1 } },
  { seat: [RA - 0.15, 0.5, -0.74], side: 1, g: 'female', colors: { jacket: '#1d2026', pants: '#2b3140', vest: '#f2c313', helmet: '#d8241c', skin: '#a8765a', blade: '#1f6fd6', longPants: 1 } },
  { seat: [-RA + 0.15, 0.5, 0.42], side: -1, g: 'female', colors: { jacket: '#1b8a8f', pants: '#20242c', vest: '#e24a17', helmet: '#f3c218', skin: '#e9c3a0', blade: '#f6c21a', longPants: 0 } },
  { seat: [RA - 0.15, 0.5, 0.46], side: 1, g: 'male', colors: { jacket: '#e8eaee', pants: '#1c1f26', vest: '#1f62c9', helmet: '#f2f2ee', skin: '#7a5038', blade: '#f6c21a', longPants: 1 } },
  { seat: [0.3, 0.64, 1.6], side: 1, g: 'male', role: 'guide', colors: { jacket: '#2e4b3a', pants: '#1c1f26', vest: '#b51e1a', helmet: '#191b1f', skin: '#d6a07a', blade: '#16181c', longPants: 1 } },
];

// how each vessel goes down when the run ends (see Raft.sinkPose)
const SINK = { raft: 'flip', rib: 'spin', sail: 'heel', yacht: 'pitch', ship: 'stern', sub: 'dive' };

export class Raft {
  constructor(scene, assets) {
    this.group = new THREE.Group();
    this.body = new THREE.Group();
    this.group.add(this.body);
    scene.add(this.group);

    // tube
    const tube = raftTube();
    this.texCache = {};
    this.tubeMat = patchMaterial(new THREE.MeshStandardMaterial({ map: makeRaftTexture({}).map, roughness: 0.62, metalness: 0, envMapIntensity: 0.25 }), {});
    const tubeMesh = new THREE.Mesh(tube.geo, this.tubeMat);
    tubeMesh.castShadow = true; tubeMesh.receiveShadow = true;
    // floor
    this.floorMat = patchMaterial(new THREE.MeshStandardMaterial({ map: floorTexture(), roughness: 0.85, side: THREE.DoubleSide }), {});
    const floor = new THREE.Mesh(floorGeometry(), this.floorMat);
    floor.receiveShadow = true;
    // thwarts
    const thMat = this.thMat = patchMaterial(new THREE.MeshStandardMaterial({ color: '#d4441a', roughness: 0.62, envMapIntensity: 0.25 }), {});
    const thG = new THREE.CapsuleGeometry(0.115, 1.38, 6, 14).rotateZ(Math.PI / 2);
    const th1 = new THREE.Mesh(thG, thMat); th1.position.set(0, 0.12, -0.12);
    const th2 = new THREE.Mesh(thG, thMat); th2.position.set(0, 0.12, 1.02);
    th1.castShadow = th2.castShadow = true;
    // grab line with D-rings (sags between attachment points)
    const ropePts = [], rings = [];
    const NA = 14;
    for (let k = 0; k < NA; k++) {
      const i0 = Math.round((k / NA) * 160), i1 = Math.round(((k + 1) / NA) * 160);
      for (let s = 0; s < 8; s++) {
        const f = s / 8;
        const i = Math.round(i0 + (i1 - i0) * f) % 160;
        const c = tube.centres[i], o = tube.outs[i];
        const sag = Math.sin(f * Math.PI) * 0.06;
        const hy = 0.16 - sag, hr = Math.sqrt(TUBE_R * TUBE_R - hy * hy) + 0.013;
        ropePts.push(new THREE.Vector3(c.x + o.x * hr, c.y + hy, c.z + o.z * hr));
        if (s === 0) rings.push([c, o]);
      }
    }
    this.ropeMat = patchMaterial(new THREE.MeshStandardMaterial({ color: '#d9dde4', roughness: 0.8 }), {});
    const rope = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(ropePts, true), 260, 0.011, 5, true), this.ropeMat);
    const ringMat = patchMaterial(new THREE.MeshStandardMaterial({ color: '#9aa0a8', roughness: 0.3, metalness: 0.8 }), {});
    const ringG = new THREE.TorusGeometry(0.03, 0.006, 4, 10);
    const patchG = new THREE.CircleGeometry(0.045, 10);
    const patchMat = patchMaterial(new THREE.MeshStandardMaterial({ color: '#2a2a2e', roughness: 0.7 }), {});
    const ringsM = new THREE.InstancedMesh(ringG, ringMat, rings.length);
    const patchesM = new THREE.InstancedMesh(patchG, patchMat, rings.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion();
    rings.forEach(([c, o], i) => {
      const hy = 0.16, hr = Math.sqrt(TUBE_R * TUBE_R - hy * hy) + 0.003;
      const nrm = new THREE.Vector3(o.x * hr, hy, o.z * hr).normalize();
      const p = new THREE.Vector3(c.x + o.x * hr, c.y + hy, c.z + o.z * hr);
      q.setFromUnitVectors(new THREE.Vector3(0, 0, 1), nrm);
      m4.compose(p, q, new THREE.Vector3(1, 1, 1));
      patchesM.setMatrixAt(i, m4);
      m4.compose(p.clone().addScaledVector(nrm, 0.01), q, new THREE.Vector3(1, 1, 1));
      ringsM.setMatrixAt(i, m4);
    });
    const raftHull = new THREE.Group();
    [tubeMesh, floor, th1, th2, rope, ringsM, patchesM].forEach((m) => raftHull.add(m));
    this.body.add(raftHull);
    this.hulls = { raft: raftHull };
    this.vid = 'raft';
    this.cfg = VESSELS.raft;
    this.dive = 0;
    this.skinDef = null;
    // materials the other vessels share with the raft (patterns paint them too)
    this.ctx = {
      props: assets ? assets.props : null,
      tubeMat: this.tubeMat, floorMat: this.floorMat, ropeMat: this.ropeMat,
      accentMat: patchMaterial(new THREE.MeshStandardMaterial({ color: '#d9441a', roughness: 0.5 }), {}),
      subMat: patchMaterial(new THREE.MeshStandardMaterial({ color: '#f2c313', roughness: 0.42, envMapIntensity: 0.7 }), {}),
      subDark: patchMaterial(new THREE.MeshStandardMaterial({ color: '#2c2f36', roughness: 0.6 }), {}),
      portMat: patchMaterial(new THREE.MeshStandardMaterial({ color: '#1a2a33', roughness: 0.1, metalness: 0.3, emissive: '#ffb35a', emissiveIntensity: 0 }), {}),
      teakTex: teakTexture(),
    };

    // crew
    this.crew = [];
    if (assets) {
      const bases = { male: prepareBase(assets.male), female: prepareBase(assets.female) };
      for (const c of CREW) {
        const r = new Rafter({ base: bases[c.g], scale: c.g === 'male' ? 0.94 : 0.95, side: c.side, role: c.role, seat: new THREE.Vector3(...c.seat), colors: c.colors });
        r.attach(this.body);
        r.pose = c.role === 'guide' ? 'guide' : 'paddle';
        this.crew.push(r);
      }
    }

    // warm light inside the raft for night biomes
    this.light = new THREE.PointLight('#ffb35a', 0, 9, 1.6);
    this.light.position.set(0, 1.6, 0.6);
    this.body.add(this.light);

    // shield bubble
    this.shield = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), makeOrbMaterial('#4fe3ff'));
    this.shield.scale.set(1.75, 1.4, 2.5);
    this.shield.position.y = 0.55;
    this.shield.visible = false;
    this.shield.renderOrder = 5;
    this.group.add(this.shield);

    this.group.traverse((o) => { if (o.isMesh || o.isSkinnedMesh) o.layers.set(1); });
    this.vx = 0;
    this.crash = 0;
    // wave hits: damped springs on pitch (bow up) and heave
    this.pitch = 0; this.pitchV = 0; this.heave = 0; this.heaveV = 0;
    this.blades = this.crew.map(() => ({ x: 0, z: 0, s: 0 }));
    this._w = new THREE.Vector3();
    this.onSplash = null;
  }

  /** switch vessel (BOT tab); builds it on first use */
  setVessel(id) {
    const v = VESSELS[id] ? id : 'raft';
    const cfg = VESSELS[v];
    if (!this.hulls[v]) {
      const g = cfg.build ? cfg.build(this.ctx) : null;
      if (!g) return this.setVessel('raft');
      const hip = this.crew.length ? this.crew[0].base.J.thigh_l.y : 0.9;
      resolveSeats(v, g, (sc) => hip * sc);
      g.traverse((o) => { if (o.isMesh || o.isSkinnedMesh) o.layers.set(1); });
      this.body.add(g);
      this.hulls[v] = g;
    }
    for (const k of Object.keys(this.hulls)) this.hulls[k].visible = k === v;
    this.vid = v;
    this.cfg = cfg;
    this.crew.forEach((c, i) => {
      if (v === 'raft') {
        const d = CREW[i];
        c.place({ p: d.seat, pose: d.role === 'guide' ? 'guide' : 'paddle', side: d.side, scale: c.o.scale }, this.body);
      } else c.place(cfg.seats[i] ? { scale: c.o.scale, ...cfg.seats[i] } : null, this.body);
      c.hatch = !!(cfg.seats && cfg.seats[i] && cfg.seats[i].hatch);
      c.floorProbe = this.hulls[v]; // feet rest on this hull's floor
      c.floor = undefined;
    });
    if (this.skinDef) this.setSkin(this.skinDef);
  }

  /** shop skin for the boat: { id, base, pattern, accent, metal, thwart } */
  setSkin(def) {
    this.skinDef = def;
    paintVessel(this.vid, this.hulls[this.vid], def);
    const C = this.ctx;
    C.accentMat.color.set(def.accent || def.base);
    const sub = def.id === 'klasik' ? '#f2c313' : def.base;
    C.subMat.color.set(sub);
    C.subMat.metalness = def.metal ? 0.8 : 0.05;
    C.subMat.roughness = def.metal ? 0.3 : 0.42;
    C.subMat.envMapIntensity = def.metal ? 1.1 : 0.7;
    C.subMat.emissive.set(def.pattern === 'neon' ? def.accent : '#000000');
    C.subMat.emissiveIntensity = def.pattern === 'neon' ? 0.12 : 1;
    if (!this.texCache[def.id]) this.texCache[def.id] = makeRaftTexture(def);
    const t = this.texCache[def.id], m = this.tubeMat;
    const hadEm = !!m.emissiveMap;
    m.map = t.map;
    m.emissiveMap = t.emissive;
    m.emissive.set(t.emissive ? '#ffffff' : '#000000');
    m.emissiveIntensity = t.emissive ? 2.4 : 1;
    m.metalness = def.metal ? 0.85 : 0;
    m.roughness = def.metal ? 0.3 : 0.62;
    m.envMapIntensity = def.metal ? 1.1 : 0.25;
    if (hadEm !== !!t.emissive) m.needsUpdate = true;
    const th = this.thMat;
    th.color.set(def.thwart || def.base);
    th.metalness = m.metalness; th.roughness = m.roughness; th.envMapIntensity = m.envMapIntensity;
  }

  /** outfit for the whole crew; def.members === null keeps the default mixed look */
  setCrewSkin(def) {
    this.crew.forEach((c, i) => {
      const d = CREW[i].colors;
      const pick = (arr, fb) => (arr ? arr[i % arr.length] : fb);
      c.setOutfit(def.members ? {
        jacket: pick(def.members.jacket), pants: pick(def.members.pants), vest: pick(def.members.vest), helmet: pick(def.members.helmet),
        longPants: def.members.longPants ?? 1, metalVest: def.members.metalVest, metalHelmet: def.members.metalHelmet, glowVest: def.members.glowVest,
      } : { jacket: d.jacket, pants: d.pants, vest: d.vest, helmet: d.helmet, longPants: d.longPants });
    });
  }

  setPaddleSkin(def) {
    this.crew.forEach((c, i) => c.setBlade(def.colors ? def.colors[i % def.colors.length] : CREW[i].colors.blade, def.metal));
  }

  /** a wave slaps the bow: it rises, then drops back into the trough */
  waveHit(s) {
    const k = this.cfg.mass ? 1 / this.cfg.mass : 1;
    this.pitchV += s * 1.75 * Math.min(1.2, k * 0.8 + 0.2);
    this.heaveV += s * 0.55;
  }

  /**
   * Each vessel goes down its own way (t: 0..1 impact phase, a: seconds since impact).
   * Visual only: the run is already over when this plays.
   */
  sinkPose(b, h, t, a, dir) {
    const e = 1 - Math.pow(1 - t, 3);           // ease-out
    const pop = Math.sin(Math.min(1, t) * Math.PI); // up-and-down arc of the impact
    const ry = b.rotation.y;
    switch (SINK[this.vid] || 'flip') {
      case 'flip': // inflatable raft: thrown up and flipped upside down, then bobs keel-up
        b.position.y = h + pop * 0.75 - t * 0.12 + Math.sin(a * 3.2) * 0.04 * t;
        b.rotation.set(-0.22 * pop, ry + dir * e * 0.5, dir * e * Math.PI);
        break;
      case 'spin': // motor RIB: spins out on the water and rolls onto its side
        b.position.y = h + pop * 0.35 - t * 0.22;
        b.rotation.set(0.35 * pop, ry + dir * e * 5.4, dir * e * 1.25);
        break;
      case 'heel': // sailboat: knocked flat, mast in the water, slowly fills
        b.position.y = h - e * 0.2 - Math.max(0, a - 0.5) * 0.3;
        b.rotation.set(-0.12 * e, ry, dir * (e * 1.5 + Math.sin(a * 2.6) * 0.05 * (1 - e * 0.6)));
        break;
      case 'pitch': // racing yacht: digs the bow in and pitch-poles end over end
        b.position.y = h + pop * 1.1 - t * 0.35;
        b.rotation.set(-e * 2.7, ry, dir * 0.4 * e);
        break;
      case 'stern': // ship: the bow floods, the stern lifts high, then it slides under
        b.position.y = h - e * 0.5 - Math.max(0, a - 0.45) * 1.1;
        b.rotation.set(-0.85 * e - Math.max(0, a - 0.45) * 0.15, ry, dir * 0.18 * e);
        break;
      case 'dive': // submarine: hull breach, noses down and sinks straight with a wobble
        b.position.y = h - e * 1.1 - Math.max(0, a - 0.3) * 1.6;
        b.rotation.set(-0.55 * e, ry, dir * 0.12 * Math.sin(a * 6) * (1 - e * 0.5));
        break;
    }
  }

  setLantern(v) {
    this.light.intensity = v * 6;
    this.ctx.portMat.emissiveIntensity = v * 2.5;
    setLampLens(v > 0.3);
  }

  update(dt, time, x, dist, vx, flow, amp, speed) {
    this.group.position.set(x, 0, -dist);
    const z = -dist;
    const hb = waveHeight(x, z - 1.5, time, flow, amp), hs = waveHeight(x, z + 1.5, time, flow, amp);
    const hl = waveHeight(x - 0.8, z, time, flow, amp), hr = waveHeight(x + 0.8, z, time, flow, amp);
    const h = (hb + hs + hl + hr) * 0.25;
    const b = this.body;
    const sdt = Math.min(dt, 1 / 30);
    this.pitchV += (-38 * this.pitch - 5.5 * this.pitchV) * sdt; this.pitch += this.pitchV * sdt;
    this.heaveV += (-30 * this.heave - 6 * this.heaveV) * sdt; this.heave += this.heaveV * sdt;
    if (this.crash > 0) {
      this.crashAge = (this.crashAge || 0) + dt;
      this.sinkPose(b, h, Math.min(1, this.crash), this.crashAge, this.crashDir || 1);
    } else {
      this.crashAge = 0;
      b.position.y = h + 0.035 + Math.sin(time * 2.2) * 0.02 + this.heave;
      b.rotation.x = Math.atan2(hb - hs, 3.0) * 0.9 + Math.sin(time * 1.7) * 0.01 + clamp(speed * 0.001, 0, 0.035) + this.pitch;
      b.rotation.z = Math.atan2(hl - hr, 1.6) * 0.8 - vx * 0.02;
      b.rotation.y = clamp(-vx * 0.045, -0.5, 0.5);
    }
    // vessel details: sub dives to periscope depth, props spin, the RIB's wheel follows the steering
    const hv = this.hulls[this.vid];
    if (hv) {
      hv.position.y = -this.dive * 0.95;
      const u = hv.userData;
      if (u.prop) u.prop.rotation.z += dt * (4 + speed * 0.6);
      if (u.wheel) u.wheel.rotation.z = clamp(vx * 0.12, -1.6, 1.6);
      if (u.motor) u.motor.rotation.y = clamp(vx * 0.03, -0.35, 0.35);
      if (u.rig) { u.rig.rotation.y = 0.22 + clamp(vx * 0.012, -0.15, 0.15); u.jib.rotation.y = 0.12 + clamp(vx * 0.008, -0.1, 0.1); }
      if (u.sails) { const o = this.racing ? 0.5 : 1; for (const m of u.sails) m.opacity = o; }
    }
    this.group.updateMatrixWorld(true);
    for (let i = 0; i < this.crew.length; i++) {
      const c = this.crew[i];
      if (c.hidden) { this.blades[i].s = 0; continue; }
      // the sub's crew ducks below before it dives
      c.root.visible = !(this.vid === 'sub' && this.dive > 0.25);
      if (hv && this.vid !== 'raft') c.root.position.y = c.o.seat.y - c.base.J.thigh_l.y * c.root.scale.x - this.dive * 0.95;
      c.update(dt, time, vx, speed, this.crash > 0 ? Math.min(1, this.crash) : 0);
      // blade in world (for foam + splashes)
      const w = this._w.copy(c.blade);
      this.body.localToWorld(w);
      const bl = this.blades[i];
      bl.x = w.x; bl.z = w.z;
      const wasIn = bl.s > 0.2;
      bl.s = this.crash > 0 ? 0 : c.bladeIn;
      if (!wasIn && bl.s > 0.2 && this.onSplash) this.onSplash(w.x, w.z, c.role === 'guide' ? 0.4 : 1);
    }
  }
}
