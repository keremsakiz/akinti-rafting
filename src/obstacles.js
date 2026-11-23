import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { RIVER_HALF, RAFT_LIMIT, RAFT_R, RAFT_HALF, SPAWN_AHEAD, SAFE_START, MAX_OBS, biomeStart, biomeIndex, TAU, clamp, lerp, smooth01, speedAt } from './config.js';
import { BIOMES, biomeAt } from './biomes.js';
import { patchMaterial, G, BEND_PARS, BEND_PROJECT } from './patch.js';
import { rockGeometry, logGeometry, iceGeometry, coinGeometry, shieldIconGeometry, magnetIconGeometry,
  barrelGeometry, fallenTreeGeometry, bridgeGeometry, slalomPoleGeometry, postGeometry } from './geom.js';
import { mulberry32 } from './noise.js';

const ROCK_VARIANTS = 4, ICE_VARIANTS = 3;
const CAP = 64;
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Euler();
const LAVA_TOP = new THREE.Color('#ff7a1c');
const CRUST_TOP = new THREE.Color('#b8320b'), CRUST_SIDE = new THREE.Color('#1a1413');

// ---- 2D geometry helpers in (x, d) track space -----------------------------
function distPointSeg(px, py, ax, ay, bx, by) {
  const abx = bx - ax, aby = by - ay;
  const t = clamp(((px - ax) * abx + (py - ay) * aby) / (abx * abx + aby * aby || 1), 0, 1);
  const dx = px - (ax + abx * t), dy = py - (ay + aby * t);
  return Math.hypot(dx, dy);
}
function segSegDist(ax, ay, bx, by, cx, cy, dx, dy) {
  const o = (px, py, qx, qy, rx, ry) => (qx - px) * (ry - py) - (qy - py) * (rx - px);
  const o1 = o(ax, ay, bx, by, cx, cy), o2 = o(ax, ay, bx, by, dx, dy), o3 = o(cx, cy, dx, dy, ax, ay), o4 = o(cx, cy, dx, dy, bx, by);
  if (o1 * o2 < 0 && o3 * o4 < 0) return 0;
  return Math.min(distPointSeg(ax, ay, cx, cy, dx, dy), distPointSeg(bx, by, cx, cy, dx, dy),
    distPointSeg(cx, cy, ax, ay, bx, by), distPointSeg(dx, dy, ax, ay, bx, by));
}

const WHIRL_VS = /* glsl */`
${BEND_PARS}
varying vec2 vUv;
#include <fog_pars_vertex>
void main() {
  vUv = uv;
  vec4 wpos = modelMatrix * vec4(position, 1.0);
  ${BEND_PROJECT}
  #include <fog_vertex>
}`;
const WHIRL_FS = /* glsl */`
uniform float uTime;
uniform vec3 uDeep, uFoam;
varying vec2 vUv;
#include <fog_pars_fragment>
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;
  float a = atan(p.y, p.x);
  float sp = sin(a * 3.0 + log(r + 0.02) * 7.0 + uTime * 5.0);
  float arms = smoothstep(0.05, 0.95, sp * 0.5 + 0.5);
  vec3 col = mix(uDeep * 0.55, uFoam, arms * smoothstep(0.1, 0.55, r) * 0.9);
  col = mix(vec3(0.0, 0.015, 0.03), col, smoothstep(0.0, 0.34, r));
  float alpha = smoothstep(1.0, 0.72, r) * (0.4 + 0.5 * arms);
  alpha = max(alpha, (1.0 - smoothstep(0.0, 0.42, r)) * 0.96);
  gl_FragColor = vec4(col, alpha);
  #include <fog_fragment>
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const MARK_VS = /* glsl */`
${BEND_PARS}
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 wpos = modelMatrix * vec4(position, 1.0);
  ${BEND_PROJECT}
}`;
// danger marker for falling rocks / lava bombs
const MARK_FS = /* glsl */`
uniform float uTime, uK;
uniform vec3 uColor;
varying vec2 vUv;
void main() {
  vec2 p = vUv * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;
  float ring = smoothstep(0.08, 0.0, abs(r - 0.82)) + smoothstep(0.06, 0.0, abs(r - (0.2 + 0.6 * fract(uTime * 1.5))));
  float fill = smoothstep(1.0, 0.0, r) * 0.25;
  float pulse = 0.65 + 0.35 * sin(uTime * 12.0);
  gl_FragColor = vec4(uColor * 3.0, (ring * 0.9 + fill) * uK * pulse);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// lava geyser column (volcano): additive, flowing upward, hot core
const GEYSER_VS = /* glsl */`
${BEND_PARS}
uniform float uTime, uK;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec3 p = position;
  float w = 1.0 + 0.16 * sin(uTime * 11.0 + p.y * 3.1) + 0.1 * sin(uTime * 7.0 + p.y * 5.3 + 1.7);
  p.xz *= w * (1.0 + p.y * 0.35 * (1.0 - uK * 0.4));
  vec4 wpos = modelMatrix * vec4(p, 1.0);
  ${BEND_PROJECT}
}`;
const GEYSER_FS = /* glsl */`
uniform float uTime, uK, uSeed;
varying vec2 vUv;
void main() {
  float v = vUv.y;
  float a = vUv.x * 6.2831;
  float n1 = sin(a * 3.0 + v * 9.0 - uTime * 16.0 + uSeed) * 0.5 + 0.5;
  float n2 = sin(a * 5.0 - v * 13.0 - uTime * 21.0 + uSeed * 1.7) * 0.5 + 0.5;
  float n = n1 * 0.6 + n2 * 0.4;
  vec3 hot = vec3(1.0, 0.86, 0.45), mid = vec3(1.0, 0.36, 0.05), dark = vec3(0.35, 0.06, 0.02);
  vec3 col = mix(mid, hot, n * (1.0 - v) * 1.2);
  col = mix(col, dark, smoothstep(0.55, 1.0, v) * (1.0 - n * 0.5));
  float alpha = (1.0 - smoothstep(0.62, 1.0, v)) * (0.45 + 0.55 * n) * uK;
  gl_FragColor = vec4(col * 3.2, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const ORB_FS = /* glsl */`
uniform vec3 uColor;
uniform float uTime;
varying vec3 vN;
varying vec3 vV;
void main() {
  float f = pow(1.0 - abs(dot(normalize(vN), normalize(vV))), 2.2);
  float pulse = 0.85 + 0.15 * sin(uTime * 5.0);
  gl_FragColor = vec4(uColor * (0.35 + f * 1.8) * pulse, (0.12 + f * 0.75) * pulse);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
const ORB_VS = /* glsl */`
${BEND_PARS}
varying vec3 vN;
varying vec3 vV;
void main() {
  vec4 wpos = modelMatrix * vec4(position, 1.0);
  vN = normalMatrix * normal;
  vV = -(modelViewMatrix * vec4(position, 1.0)).xyz;
  ${BEND_PROJECT}
}`;

export function makeOrbMaterial(hex) {
  return new THREE.ShaderMaterial({
    uniforms: { uColor: { value: new THREE.Color(hex) }, uTime: G.uTime, uBend: G.uBend, uBendO: G.uBendO },
    vertexShader: ORB_VS, fragmentShader: ORB_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
}

/** float copy of an attribute (dequantises meshopt/quantised data) */
function floatAttr(a) {
  const f = new Float32Array(a.count * a.itemSize);
  for (let i = 0; i < a.count; i++) for (let j = 0; j < a.itemSize; j++) f[i * a.itemSize + j] = a.getComponent(i, j);
  return new THREE.BufferAttribute(f, a.itemSize);
}

/** merge all meshes below a (Kenney) prop node into one geometry in the node's space */
export function propGeometry(node) {
  node.updateMatrixWorld(true);
  const inv = node.matrixWorld.clone().invert();
  const geos = [];
  let mat = null;
  node.traverse((c) => {
    if (!c.isMesh) return;
    let g = new THREE.BufferGeometry();
    for (const k of ['position', 'normal', 'uv']) if (c.geometry.attributes[k]) g.setAttribute(k, floatAttr(c.geometry.attributes[k]));
    if (c.geometry.index) g.setIndex(c.geometry.index.clone());
    g = g.index ? g.toNonIndexed() : g;
    g.applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, c.matrixWorld));
    geos.push(g);
    mat = mat || c.material;
  });
  return { geo: mergeGeometries(geos, false), mat };
}

export class Obstacles {
  constructor(scene) {
    this.scene = scene;
    this.list = [];
    this.coins = [];
    this.powerups = [];
    this.gates = [];
    this.bridges = [];
    this.rng = mulberry32(5);
    this.fx = null;

    // rocks
    const rockMat = patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0, flatShading: true, envMapIntensity: 0.35 }), { rock: true });
    this.rockMeshes = [];
    for (let v = 0; v < ROCK_VARIANTS; v++) {
      const g = rockGeometry(100 + v * 17);
      g.setAttribute('aTop', new THREE.InstancedBufferAttribute(new Float32Array(CAP * 3), 3));
      g.setAttribute('aRockGlow', new THREE.InstancedBufferAttribute(new Float32Array(CAP), 1));
      const m = new THREE.InstancedMesh(g, rockMat, CAP);
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 3), 3);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.count = 0; m.frustumCulled = false; m.castShadow = true;
      scene.add(m);
      this.rockMeshes.push(m);
    }
    // logs
    const logMat = patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92, flatShading: true, envMapIntensity: 0.3 }), { tint: true });
    this.logMesh = new THREE.InstancedMesh(logGeometry(), logMat, CAP);
    this.logMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(CAP * 3), 3);
    this.logMesh.count = 0; this.logMesh.frustumCulled = false; this.logMesh.castShadow = true;
    scene.add(this.logMesh);
    // fallen trees (leafy / bare)
    const vegMat = patchMaterial(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), { tint: true });
    this.treeMeshes = [true, false].map((leafy) => {
      const m = new THREE.InstancedMesh(fallenTreeGeometry(leafy), vegMat, 12);
      m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(12 * 3), 3);
      m.count = 0; m.frustumCulled = false; m.castShadow = true;
      scene.add(m);
      return m;
    });
    // ice floes
    const iceMat = patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.2, metalness: 0.0, flatShading: true, envMapIntensity: 1.0 }), {});
    this.iceMeshes = [];
    for (let v = 0; v < ICE_VARIANTS; v++) {
      const m = new THREE.InstancedMesh(iceGeometry(300 + v * 11), iceMat, CAP);
      m.count = 0; m.frustumCulled = false;
      scene.add(m);
      this.iceMeshes.push(m);
    }
    // barrels
    const barrelMat = patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.35, envMapIntensity: 0.7 }), { tint: true });
    this.barrelMesh = new THREE.InstancedMesh(barrelGeometry(), barrelMat, 40);
    this.barrelMesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(40 * 3), 3);
    this.barrelMesh.count = 0; this.barrelMesh.frustumCulled = false; this.barrelMesh.castShadow = true;
    scene.add(this.barrelMesh);
    // rope segments (buoy lines) + floats
    const ropeMat = patchMaterial(new THREE.MeshStandardMaterial({ color: '#e8d24a', roughness: 0.7 }), {});
    this.ropeMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.035, 0.035, 1, 5).rotateZ(Math.PI / 2), ropeMat, 64);
    this.ropeMesh.count = 0; this.ropeMesh.frustumCulled = false;
    scene.add(this.ropeMesh);
    const floatMat = patchMaterial(new THREE.MeshStandardMaterial({ color: '#ff5a1f', roughness: 0.45, envMapIntensity: 0.6, emissive: new THREE.Color('#000000') }), {});
    this.floatMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.11, 8, 6).scale(1.5, 1, 1), floatMat, 320);
    this.floatMesh.count = 0; this.floatMesh.frustumCulled = false;
    this.floatMat = floatMat;
    scene.add(this.floatMesh);
    // slalom gates: hanging striped poles, wire, bank posts
    this.poleMeshes = ['#1fa34a', '#d8241c'].map((c) => {
      const m = new THREE.InstancedMesh(slalomPoleGeometry(c), patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, envMapIntensity: 0.6 }), {}), 16);
      m.count = 0; m.frustumCulled = false; m.castShadow = true;
      scene.add(m);
      return m;
    });
    const wireMat = patchMaterial(new THREE.MeshStandardMaterial({ color: '#2a2c30', roughness: 0.5, metalness: 0.6 }), {});
    this.wireMesh = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.014, 0.014, 1, 4).rotateZ(Math.PI / 2), wireMat, 8);
    this.wireMesh.count = 0; this.wireMesh.frustumCulled = false;
    scene.add(this.wireMesh);
    this.postMesh = new THREE.InstancedMesh(postGeometry(4.6), patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }), {}), 16);
    this.postMesh.count = 0; this.postMesh.frustumCulled = false; this.postMesh.castShadow = true;
    scene.add(this.postMesh);
    // whirlpools
    this.whirlPool = [];
    for (let i = 0; i < 3; i++) {
      const mat = new THREE.ShaderMaterial({
        uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uDeep: { value: new THREE.Color() }, uFoam: { value: new THREE.Color() } }]),
        vertexShader: WHIRL_VS, fragmentShader: WHIRL_FS, transparent: true, depthWrite: false, fog: true,
      });
      mat.uniforms.uTime = G.uTime;
      mat.uniforms.uBend = G.uBend;
      mat.uniforms.uBendO = G.uBendO;
      const m = new THREE.Mesh(new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2), mat);
      m.visible = false; m.frustumCulled = false; m.renderOrder = 2; m.layers.set(1);
      scene.add(m);
      this.whirlPool.push(m);
    }
    // danger markers
    this.markers = [];
    for (let i = 0; i < 6; i++) {
      const mat = new THREE.ShaderMaterial({
        uniforms: { uTime: G.uTime, uK: { value: 0 }, uColor: { value: new THREE.Color('#ff3a1a') }, uBend: G.uBend, uBendO: G.uBendO },
        vertexShader: MARK_VS, fragmentShader: MARK_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      });
      const m = new THREE.Mesh(new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2), mat);
      m.visible = false; m.frustumCulled = false; m.renderOrder = 3; m.layers.set(1);
      scene.add(m);
      this.markers.push(m);
    }
    // lava geysers (volcano): eruption columns
    this.geyserPool = [];
    const gGeo = new THREE.CylinderGeometry(0.55, 0.95, 1, 18, 10, true).translate(0, 0.5, 0);
    for (let i = 0; i < 8; i++) {
      const mat = new THREE.ShaderMaterial({
        uniforms: { uTime: G.uTime, uK: { value: 0 }, uSeed: { value: i * 2.3 }, uBend: G.uBend, uBendO: G.uBendO },
        vertexShader: GEYSER_VS, fragmentShader: GEYSER_FS, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      });
      const m = new THREE.Mesh(gGeo, mat);
      m.visible = false; m.frustumCulled = false; m.renderOrder = 4; m.layers.set(1);
      scene.add(m);
      this.geyserPool.push(m);
    }
    this.erupting = [];
    // bridges (geometry rebuilt per spawn)
    this.bridgeMat = patchMaterial(new THREE.MeshLambertMaterial({ vertexColors: true }), {});
    this.bridgeMeshes = [0, 1].map(() => {
      const m = new THREE.Mesh(new THREE.BufferGeometry(), this.bridgeMat);
      m.visible = false; m.frustumCulled = false; m.castShadow = true; m.receiveShadow = true;
      scene.add(m);
      return m;
    });
    // lanterns on night bridges / flag buoys
    this.glowMat = new THREE.MeshBasicMaterial({ color: new THREE.Color('#ffc46a').multiplyScalar(5) });
    this.lanternMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.12, 8, 6), this.glowMat, 24);
    this.lanternMesh.count = 0; this.lanternMesh.frustumCulled = false;
    scene.add(this.lanternMesh);
    // coins
    const coinMat = patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, metalness: 0.7, roughness: 0.25, emissive: new THREE.Color('#6a4200'), flatShading: true, envMapIntensity: 1.2 }), {});
    this.coinMesh = new THREE.InstancedMesh(coinGeometry(), coinMat, 160);
    this.coinMesh.count = 0; this.coinMesh.frustumCulled = false;
    scene.add(this.coinMesh);
    // power-ups
    const iconMat = patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.2, emissive: new THREE.Color('#222222') }), {});
    this.puMeshes = {};
    const orbGeo = new THREE.SphereGeometry(0.85, 24, 16);
    for (const [type, geo, colr] of [['shield', shieldIconGeometry(), '#4fe3ff'], ['magnet', magnetIconGeometry(), '#ff5a6a']]) {
      const grp = new THREE.Group();
      const icon = new THREE.Mesh(geo, iconMat);
      const orb = new THREE.Mesh(orbGeo, makeOrbMaterial(colr));
      orb.renderOrder = 3; orb.layers.set(1);
      grp.add(icon, orb);
      grp.visible = false;
      grp.userData.icon = icon;
      scene.add(grp);
      this.puMeshes[type] = grp;
    }
    this.propMeshes = {};
    this.reset();
  }

  /** Kenney props arrive asynchronously */
  setProps(props) {
    this.props = props;
    const mk = (name, cap) => {
      if (!props[name]) return null;
      const { geo, mat } = propGeometry(props[name]);
      const m2 = mat.clone();
      m2.roughness = 0.62; m2.metalness = 0; m2.envMapIntensity = 0.6;
      const m = new THREE.InstancedMesh(geo, patchMaterial(m2, {}), cap);
      m.count = 0; m.frustumCulled = false; m.castShadow = true; m.receiveShadow = true;
      this.scene.add(m);
      return m;
    };
    this.propMeshes = {
      boatS: mk('boat-row-small', 8), boatL: mk('boat-row-large', 8),
      buoy: mk('buoy', 48), buoyFlag: mk('buoy-flag', 16),
    };
    // biome checkpoint arch
    if (props['gate-finish']) {
      const arch = props['gate-finish'].clone(true);
      arch.traverse((c) => { if (c.isMesh) { const mm = c.material.clone(); mm.envMapIntensity = 0.6; c.material = patchMaterial(mm, {}); c.castShadow = true; } });
      arch.scale.set(2.35, 2.0, 2.0);
      arch.visible = false;
      this.scene.add(arch);
      this.arch = arch;
    }
  }

  setFx(fx) { this.fx = fx; }

  reset() {
    this.list.length = 0;
    this.coins.length = 0;
    this.powerups.length = 0;
    this.gates.length = 0;
    for (const b of this.bridges) if (b.mesh) { b.mesh.visible = false; b.mesh.userData.busy = false; }
    this.bridges.length = 0;
    this.nextD = SAFE_START;
    this.lastRowD = undefined;
    this.lastPat = '';
    this.relax = false;
    this.pathX = 0;
    this.rowCount = 0;
    this.lastPU = 0;
    this.lastBridge = 0;
    this.rapid = 0;
    this.lastDist = 0;
    this.rng = mulberry32((Math.random() * 1e9) | 0);
    for (const w of this.whirlPool) w.visible = false;
    for (const m of this.markers) m.visible = false;
    for (const g of this.geyserPool) g.visible = false;
    this.erupting = [];
    for (const b of this.bridgeMeshes) { b.visible = false; b.userData.busy = false; }
  }

  biomeFor(D) {
    const b = biomeAt(D);
    return BIOMES[this.rng() < b.t ? b.cur : b.prev];
  }

  addRock(x, D, r, B, fall) {
    const o = { type: 'rock', x, d: D, r, v: Math.floor(this.rng() * ROCK_VARIANTS), rot: this.rng() * TAU,
      side: B.rock.side.clone().multiplyScalar(0.85 + this.rng() * 0.3), top: B.rock.top, glow: B.rock.glow,
      minClear: 9, passed: false, bob: this.rng() * TAU };
    if (fall) o.fall = { lava: fall === 'lava', h: 26, landed: false, mark: 0, splash: 0 };
    this.list.push(o);
    return o;
  }
  addLog(x, D, len, rot, vx, B, tree = 0, side = 1) {
    this.list.push({ type: 'log', x, d: D, r: 0.38, len, rot, vx, vr: 0, tint: B.log, tree, side, foliage: B.treeTint || B.log, minClear: 9, passed: false, bob: this.rng() * TAU });
  }
  addIce(x, D, R, vx) {
    this.list.push({ type: 'ice', x, d: D, r: R, v: Math.floor(this.rng() * ICE_VARIANTS), rot: this.rng() * TAU, vx, vr: (this.rng() - 0.5) * 0.4, minClear: 9, passed: false, bob: this.rng() * TAU });
  }
  addWhirl(x, D, B) {
    this.list.push({ type: 'whirl', x, d: D, r: 3.4, core: 1.0, deep: B.water.deep, foam: B.water.foam, minClear: 9, passed: true });
  }
  /** volcano: a vent in the riverbed that bubbles (warning) and then shoots a lava column */
  addGeyser(x, D, ph) {
    this.list.push({ type: 'geyser', x, d: D, r: 0.95, ph, warn: 0, erupt: 0, minClear: 9, passed: false });
  }
  /** volcano: a slab of cooling lava crust drifting on the river, glowing through its cracks */
  addCrust(x, D, R, vx) {
    this.list.push({ type: 'crust', x, d: D, r: R, v: Math.floor(this.rng() * ROCK_VARIANTS), rot: this.rng() * TAU, vx, vr: (this.rng() - 0.5) * 0.3, minClear: 9, passed: false, bob: this.rng() * TAU });
  }
  addBoat(x, D, vx, kind) {
    const len = (kind ? 2.85 : 2.37) * 1.25;
    this.list.push({ type: 'boat', x, d: D, r: 0.55, len: len * 0.76, rot: (this.rng() - 0.5) * 0.7 + (this.rng() < 0.5 ? 0 : Math.PI), vx, vr: (this.rng() - 0.5) * 0.16, kind, minClear: 9, passed: false, bob: this.rng() * TAU });
  }
  addBarrel(x, D, vx) {
    const tints = ['#2f6fb5', '#c43a22', '#d9a21a', '#3e8a4a'];
    this.list.push({ type: 'barrel', x, d: D, r: 0.48, rot: this.rng() * TAU, vx, vr: (this.rng() - 0.5) * 0.8, tint: new THREE.Color(tints[Math.floor(this.rng() * tints.length)]), minClear: 9, passed: false, bob: this.rng() * TAU });
  }
  addCoinLine(x0, d0, x1, d1, n) {
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0.5 : i / (n - 1);
      const st = smooth01(t);
      this.coins.push({ x: lerp(x0, x1, st), d: lerp(d0, d1, t), ph: this.rng() * TAU, taken: false, fly: 0 });
    }
  }

  spawn(dist) {
    let guard = 0;
    while (this.nextD < dist + SPAWN_AHEAD && guard++ < 10) this.makeRow(this.nextD);
  }

  makeRow(D) {
    const rng = this.rng;
    const lvl = clamp(D / 3200, 0, 1);
    const speed = speedAt(D);
    const T = 0.55 + 1.05 * Math.exp(-D / 1300);
    const spacing = T * speed;
    const maxShift = Math.max(2.5, 10.5 * T * 0.72);
    const B = this.biomeFor(D);
    const ob = B.obstacles;
    const gap = lerp(4.8, 2.95, lvl);
    const prevPath = this.pathX;
    const prevD = this.lastRowD ?? D - spacing;
    this.lastRowD = D;
    const L = RAFT_LIMIT;
    const pickPath = () => clamp(prevPath + (rng() * 2 - 1) * maxShift, -L + 0.3, L - 0.3);
    // keep the checkpoint arch (biome boundary) clear of heavy patterns
    const kD = biomeIndex(D);
    const nearArch = D > 100 && Math.min(Math.abs(D - biomeStart(kD)), Math.abs(biomeStart(kD + 1) - D)) < 14;

    // pattern weights
    const W = [
      ['single', 2.4 - 1.4 * lvl], ['pair', 2.0], ['gate', 0.8 + 3.2 * lvl],
      ['log', ob.log ? 1.4 * ob.log : 0], ['movingLog', ob.log && D > 250 ? (0.3 + 1.6 * lvl) * ob.log * 0.6 : 0],
      ['zigzag', D > 600 ? 0.4 + 1.6 * lvl : 0], ['ice', ob.ice ? ob.ice : 0], ['whirl', ob.whirl && D > 400 ? ob.whirl * (0.6 + lvl) : 0],
      ['boat', ob.boat && D > 300 ? ob.boat * (0.5 + lvl) : 0],
      ['buoys', ob.buoys && D > 200 ? ob.buoys * (0.6 + lvl * 0.8) : 0],
      ['bridge', ob.bridge && D - this.lastBridge > 240 && !nearArch ? ob.bridge * 1.3 : 0],
      ['fall', ob.fall && D > 220 ? ob.fall * (0.6 + lvl) : 0],
      ['geyser', ob.geyser && D > 220 ? ob.geyser * (0.6 + lvl) : 0],
      ['crust', ob.crust ? ob.crust : 0],
      ['barrels', ob.barrels ? ob.barrels * (0.7 + lvl * 0.5) : 0],
      ['slalom', ob.slalom ? ob.slalom : 0],
      ['breather', 0.45],
    ];
    let tot = 0;
    for (const w of W) tot += Math.max(0, w[1]);
    let x = rng() * tot, pat = 'single';
    for (const w of W) { x -= Math.max(0, w[1]); if (x <= 0) { pat = w[0]; break; } }
    if (pat === this.lastPat && ['whirl', 'zigzag', 'bridge', 'buoys', 'boat'].includes(pat)) pat = 'gate';
    if (nearArch && !['single', 'pair', 'breather', 'slalom'].includes(pat)) pat = 'single';
    // after a moving hazard the player may be anywhere: keep the next row forgiving
    if (this.relax && !['single', 'pair', 'breather', 'slalom'].includes(pat)) pat = rng() < 0.6 ? 'single' : 'pair';
    if (this.forcePat) pat = this.forcePat;
    this.relax = ['movingLog', 'whirl', 'ice', 'boat', 'barrels', 'crust'].includes(pat);
    this.lastPat = pat;

    let newPath = pickPath();
    let advance = this.relax ? spacing * 1.2 : spacing;

    const gateRow = (Dg, gx, g) => {
      const step = 2.3;
      for (let rx = -RIVER_HALF + 0.55; rx <= RIVER_HALF - 0.5; rx += step) {
        const xx = rx + (rng() - 0.5) * 0.5;
        const r = 0.82 + rng() * 0.3;
        if (Math.abs(xx - gx) < g / 2 + r) continue;
        this.addRock(xx, Dg + (rng() - 0.5) * 1.2, r, B);
      }
    };
    const offPath = (r, g, fall) => {
      let ox = (rng() * 2 - 1) * (RIVER_HALF - 0.6);
      if (Math.abs(ox - newPath) < r + g / 2) ox = newPath + (ox < newPath ? -1 : 1) * (r + g / 2 + 0.2);
      if (Math.abs(ox) < RIVER_HALF + 0.5) this.addRock(clamp(ox, -RIVER_HALF + 0.3, RIVER_HALF - 0.3), D + (rng() - 0.5) * 3, r, B, fall);
    };

    switch (pat) {
      case 'single': {
        const r = 1.1 + rng() * 0.5;
        let ox = (rng() * 2 - 1) * (L - 0.5);
        if (Math.abs(ox - newPath) < r + 1.6) ox = newPath + (ox < newPath ? -1 : 1) * (r + 1.8);
        if (Math.abs(ox) > RIVER_HALF - 0.3) ox = newPath - Math.sign(ox) * (r + 1.8);
        this.addRock(clamp(ox, -RIVER_HALF + 0.4, RIVER_HALF - 0.4), D, r, B);
        break;
      }
      case 'pair': {
        for (let k = 0; k < 2; k++) offPath(0.9 + rng() * 0.45, gap);
        break;
      }
      case 'fall': {
        // rocks (or lava bombs) drop from the cliffs: a marker shows where they will land
        const n = 2 + (rng() < 0.35 + lvl * 0.4 ? 1 : 0);
        for (let k = 0; k < n; k++) offPath(0.85 + rng() * 0.4, gap + 0.3, ob.lava ? 'lava' : 'rock');
        break;
      }
      case 'geyser': {
        // 2-3 vents beside the safe line, out of phase: you can slip past a sleeping one
        const n = 2 + (rng() < 0.4 + lvl * 0.4 ? 1 : 0);
        const ph0 = rng() * 3;
        for (let k = 0; k < n; k++) {
          const g = gap + 0.4, r = 0.95;
          let ox = (rng() * 2 - 1) * (RIVER_HALF - 0.9);
          if (Math.abs(ox - newPath) < r + g / 2) ox = newPath + (ox < newPath ? -1 : 1) * (r + g / 2 + 0.25);
          if (Math.abs(ox) < RIVER_HALF - 0.6) this.addGeyser(ox, D + (rng() - 0.5) * 6, ph0 + k * (0.8 + rng() * 0.5));
        }
        break;
      }
      case 'crust': {
        const n = 3 + Math.floor(rng() * 2 + lvl * 2);
        for (let k = 0; k < n; k++) {
          const R = 0.9 + rng() * 0.7;
          const ox = (rng() * 2 - 1) * (RIVER_HALF - 0.5);
          if (Math.abs(ox - newPath) < R + gap / 2) continue;
          this.addCrust(ox, D + (rng() - 0.5) * spacing * 0.5, R, (rng() - 0.5) * 0.3);
        }
        break;
      }
      case 'gate': gateRow(D, newPath, gap); break;
      case 'buoys': {
        // a buoy line across the river with one opening marked by flag buoys
        const g = gap + 0.5;
        const xs = [];
        for (let bx = -RIVER_HALF - 0.6; bx <= RIVER_HALF + 0.6; bx += 1.85) xs.push(bx + (rng() - 0.5) * 0.2);
        const flagL = newPath - g / 2 - 0.45, flagR = newPath + g / 2 + 0.45;
        const left = xs.filter((bx) => bx < flagL - 0.9);
        const right = xs.filter((bx) => bx > flagR + 0.9);
        for (const bx of [...left, flagL, flagR, ...right]) {
          if (Math.abs(bx) > RIVER_HALF + 0.9) continue;
          this.list.push({ type: 'buoy', x: bx, d: D, r: 0.44, flag: bx === flagL || bx === flagR, minClear: 9, passed: false, bob: rng() * TAU });
        }
        const chain = (arr) => { for (let i = 0; i < arr.length - 1; i++) this.list.push({ type: 'rope', x: (arr[i] + arr[i + 1]) / 2, x0: arr[i], x1: arr[i + 1], d: D, r: 0.12, minClear: 9, passed: false }); };
        chain([...left.filter((bx) => Math.abs(bx) <= RIVER_HALF + 0.9), flagL]);
        chain([flagR, ...right.filter((bx) => Math.abs(bx) <= RIVER_HALF + 0.9)]);
        break;
      }
      case 'bridge': {
        const g = gap + 0.4;
        const piers = [];
        const n = 3 + Math.floor(rng() * 2);
        const span = (RIVER_HALF * 2 - 1.6) / (n - 1);
        for (let k = 0; k < n; k++) {
          const px = -RIVER_HALF + 0.8 + k * span + (rng() - 0.5) * 0.6;
          if (Math.abs(px - newPath) < g / 2 + 0.75) continue;
          piers.push(px);
        }
        for (const px of piers) this.list.push({ type: 'pier', x: px, d: D, r: 0.72, minClear: 9, passed: false });
        this.bridges.push({ d: D, piers, style: B.bridge || 'wood', mesh: null, lanterns: B.lantern > 0.5 });
        this.lastBridge = D;
        break;
      }
      case 'log': {
        // log (or a whole fallen tree) anchored at one bank, free corridor on the other side
        const side = prevPath > 1 ? -1 : prevPath < -1 ? 1 : (rng() < 0.5 ? -1 : 1);
        const corridor = gap + 0.65;
        const lenL = clamp(2 * RIVER_HALF - corridor, 3.5, 9);
        const tip = side * (RIVER_HALF - lenL);
        const pc = clamp((tip - side * RIVER_HALF) / 2, -L, L);
        if (Math.abs(pc - prevPath) > maxShift * 1.1) { gateRow(D, newPath, gap); break; }
        newPath = pc;
        const tree = B.trees ? (rng() < 0.7 ? (B.trees === 'bare' ? 2 : 1) : 0) : 0;
        this.addLog(side * (RIVER_HALF - lenL / 2 + 0.1), D, lenL, (rng() - 0.5) * (tree ? 0.25 : 0.3), 0, B, tree, side);
        break;
      }
      case 'movingLog': {
        const lenL = 3.2 + rng() * 1.6;
        const vx = (rng() < 0.5 ? -1 : 1) * (1.6 + rng() * 2.2) * (0.6 + lvl * 0.8);
        this.addLog((rng() * 2 - 1) * (RIVER_HALF - lenL / 2 - 0.3), D, lenL, (rng() - 0.5) * 0.4, vx, B);
        newPath = prevPath;
        break;
      }
      case 'boat': {
        // an abandoned rowboat drifting across the current
        const vx = (rng() < 0.5 ? -1 : 1) * (0.8 + rng() * 1.0) * (0.6 + lvl * 0.45);
        this.addBoat((rng() * 2 - 1) * (RIVER_HALF - 2.0), D, vx, rng() < 0.5 ? 1 : 0);
        if (lvl > 0.75 && rng() < 0.3) { this.addBoat(-Math.sign(vx) * (RIVER_HALF - 1.5), D + spacing * 0.7, -vx * 0.8, rng() < 0.5 ? 1 : 0); advance += spacing * 0.5; }
        newPath = prevPath;
        break;
      }
      case 'zigzag': {
        const sub = spacing * 0.62;
        const shiftZ = Math.max(2.5, 10.5 * (sub / speed) * 0.72);
        let px = prevPath;
        for (let k = 0; k < 3; k++) {
          const target = -(px >= 0 ? 1 : -1) * (L * 0.55);
          px = clamp(px + clamp(target - px, -shiftZ, shiftZ), -L + 0.4, L - 0.4);
          gateRow(D + k * sub, px, gap + 0.3);
          if (this.pathLog && k < 2) this.pathLog.push([D + k * sub, px, 'zigzag']);
          if (rng() < 0.7) this.addCoinLine(px, D + k * sub - 2, px, D + k * sub + 2, 2);
        }
        newPath = px;
        advance = sub * 2 + spacing;
        this.lastRowD = D + sub * 2;
        break;
      }
      case 'ice': {
        const n = 3 + Math.floor(rng() * 2 + lvl * 2);
        for (let k = 0; k < n; k++) {
          const R = 0.95 + rng() * 0.75;
          const ox = (rng() * 2 - 1) * (RIVER_HALF - 0.5);
          if (Math.abs(ox - newPath) < R + gap / 2) continue;
          this.addIce(ox, D + (rng() - 0.5) * spacing * 0.5, R, (rng() - 0.5) * 0.5);
        }
        break;
      }
      case 'barrels': {
        const n = 3 + Math.floor(rng() * 2 + lvl * 3);
        for (let k = 0; k < n; k++) {
          const ox = (rng() * 2 - 1) * (RIVER_HALF - 0.5);
          if (Math.abs(ox - newPath) < 0.5 + gap / 2 + 0.5) continue;
          this.addBarrel(ox, D + (rng() - 0.5) * spacing * 0.4, (rng() - 0.5) * 0.3);
        }
        break;
      }
      case 'whirl': {
        const side = prevPath > 0.5 ? -1 : prevPath < -0.5 ? 1 : (rng() < 0.5 ? -1 : 1);
        const wx = side * (RIVER_HALF - 2.0 - rng() * 0.8);
        newPath = clamp(prevPath, -L, L);
        if (Math.abs(newPath - wx) < 5.2) newPath = clamp(wx - side * 5.2, -L, L);
        this.addWhirl(wx, D, B);
        break;
      }
      case 'slalom': {
        // whitewater slalom gate on the line: pass between the poles for a bonus (not deadly)
        const r = 0.95 + rng() * 0.35;
        let ox = newPath + (rng() < 0.5 ? -1 : 1) * (r + 2.6 + rng() * 1.5);
        if (Math.abs(ox) > RIVER_HALF - 0.3) ox = newPath - Math.sign(ox - newPath) * (r + 2.6);
        if (Math.abs(ox) < RIVER_HALF - 0.3) this.addRock(ox, D, r, B);
        this.gates.push({ x: newPath, d: D - 3, w: 3.3, passed: false, red: rng() < 0.3 });
        break;
      }
      default: {
        // breather: a long coin snake
        this.addCoinLine(prevPath, prevD + 4, newPath, D + spacing * 0.6, 9);
        break;
      }
    }
    // coins along the safe path
    if (pat !== 'breather' && pat !== 'zigzag' && rng() < 0.62) {
      this.addCoinLine(prevPath, prevD + spacing * 0.25, newPath, D - 3.5, 4 + Math.floor(rng() * 3));
    }
    // power-ups
    if (D > 320 && D - this.lastPU > 380 && rng() < 0.12) {
      this.lastPU = D;
      this.powerups.push({ type: rng() < 0.55 ? 'shield' : 'magnet', x: lerp(prevPath, newPath, 0.5), d: D - spacing * 0.5, taken: false, ph: 0 });
    }
    this.pathX = newPath;
    if (this.pathLog) this.pathLog.push([pat === 'zigzag' ? D + advance - spacing : D, newPath, pat]);
    this.nextD = D + advance;
    this.rowCount++;
  }

  /** returns events */
  update(dt, time, dist, raftX, opts) {
    const ev = this.ev || (this.ev = { hit: null, near: [], gates: [], impacts: [], erupts: [], coins: 0, pickup: null, pull: 0 });
    ev.hit = null; ev.near.length = 0; ev.gates.length = 0; ev.impacts.length = 0; ev.erupts.length = 0; ev.coins = 0; ev.pickup = null; ev.pull = 0;
    this.erupting.length = 0;
    if (opts.spawn) this.spawn(dist);
    const rd = dist;
    const ax = raftX, ay = rd - RAFT_HALF, bx = raftX, by = rd + RAFT_HALF;
    const speed = Math.max(8, speedAt(dist));
    let rocksNear = 0;

    for (let i = this.list.length - 1; i >= 0; i--) {
      const o = this.list[i];
      if (o.d < dist - 18) { this.list.splice(i, 1); continue; }
      // motion
      if (o.type === 'log' && o.vx) {
        o.x += o.vx * dt;
        const ext = Math.abs(Math.cos(o.rot)) * o.len / 2 + 0.4;
        if (o.x + ext > RIVER_HALF + 0.3 && o.vx > 0) o.vx = -o.vx;
        if (o.x - ext < -RIVER_HALF - 0.3 && o.vx < 0) o.vx = -o.vx;
      } else if (o.type === 'boat') {
        if (o.d - dist < 70) { o.x += o.vx * dt; o.rot += o.vr * dt; }
        const ext = Math.abs(Math.cos(o.rot)) * o.len / 2 + 0.5;
        if (o.x + ext > RIVER_HALF + 0.2 && o.vx > 0) o.vx = -o.vx;
        if (o.x - ext < -RIVER_HALF - 0.2 && o.vx < 0) o.vx = -o.vx;
      } else if (o.type === 'geyser') {
        // cycle: bubbling warning 1.3 s -> eruption 1.2 s -> rest 0.5 s (game time, so slow-mo slows it too)
        const ahead = o.d - dist;
        if (ahead < 170) {
          const c = ((time + o.ph) % 3.0 + 3.0) % 3.0;
          const was = o.erupt;
          o.warn = c < 1.3 ? 0.25 + 0.75 * (c / 1.3) : 0;
          o.erupt = c >= 1.3 && c < 2.5 ? Math.min(1, (c - 1.3) / 0.15) * Math.min(1, (2.5 - c) / 0.3) : 0;
          if (was === 0 && o.erupt > 0) ev.erupts.push(o);
          if (o.erupt > 0) this.erupting.push(o);
        } else { o.warn = 0; o.erupt = 0; }
      } else if (o.type === 'ice' || o.type === 'barrel' || o.type === 'crust') {
        o.rot += o.vr * dt;
        if (o.d - dist < 35) o.x += o.vx * dt; // drift only when close, so the planned corridor stays honest
        if (Math.abs(o.x) > RIVER_HALF - o.r * 0.6) o.vx = -Math.sign(o.x) * Math.abs(o.vx);
      } else if (o.type === 'rock' && o.fall && !o.fall.landed) {
        // start falling so it lands ~52 m ahead of the raft; the marker warns ~2.6 s before
        const ahead = o.d - dist;
        const tLand = (ahead - 52) / speed;
        o.fall.mark = clamp(1 - tLand / 2.6, 0, 1);
        const fallDur = 1.1;
        if (tLand < fallDur) {
          const k = clamp(1 - tLand / fallDur, 0, 1);
          o.fall.h = (1 - k * k) * 26;
          if (k >= 1 || ahead < 40) {
            o.fall.landed = true; o.fall.h = 0; o.fall.splash = 1;
            ev.impacts.push(o);
            if (this.fx) this.fx(o);
          }
        } else o.fall.h = 26;
      }
      if (o.fall && o.fall.splash > 0) o.fall.splash = Math.max(0, o.fall.splash - dt * 0.8);
      if (o.type === 'rock' && Math.abs(o.d - dist - 20) < 30) rocksNear++;
      if (!opts.collide) continue;
      const dd = o.d - rd;
      if (Math.abs(dd) > 8) {
        if (dd < -3 && !o.passed) { o.passed = true; if (o.type !== 'rope' && o.minClear < 0.55 && o.minClear >= 0) ev.near.push(o); }
        continue;
      }
      if (o.fall && !o.fall.landed) continue;
      let clear;
      if (o.type === 'rock') clear = distPointSeg(o.x, o.d, ax, ay, bx, by) - (o.r * 0.82 + RAFT_R);
      else if (o.type === 'ice' || o.type === 'crust') clear = distPointSeg(o.x, o.d, ax, ay, bx, by) - (o.r * 0.86 + RAFT_R);
      else if (o.type === 'geyser') clear = o.erupt > 0.3 ? distPointSeg(o.x, o.d, ax, ay, bx, by) - (o.r * 0.85 + RAFT_R) : 9;
      else if (o.type === 'buoy' || o.type === 'pier' || o.type === 'barrel') clear = distPointSeg(o.x, o.d, ax, ay, bx, by) - (o.r + RAFT_R * 0.95);
      else if (o.type === 'rope') clear = segSegDist(ax, ay, bx, by, o.x0, o.d, o.x1, o.d) - (o.r + RAFT_R * 0.9);
      else if (o.type === 'log' || o.type === 'boat') {
        const hx = Math.cos(o.rot) * o.len * 0.5, hy = Math.sin(o.rot) * o.len * 0.5;
        clear = segSegDist(ax, ay, bx, by, o.x - hx, o.d - hy, o.x + hx, o.d + hy) - (o.r * 0.9 + RAFT_R);
      } else if (o.type === 'whirl') {
        const dx = o.x - raftX, dz = o.d - rd;
        const dist2 = Math.hypot(dx, dz);
        if (dist2 < o.r + 0.8) ev.pull += Math.sign(dx) * (1 - dist2 / (o.r + 0.8)) * 9;
        clear = dist2 - (o.core + 0.45);
      }
      if (clear < 0 && !o.dead) { ev.hit = o; }
      if (o.type !== 'whirl' && Math.abs(dd) < 3.2) o.minClear = Math.min(o.minClear, clear);
      if (dd < -3 && !o.passed) { o.passed = true; if (o.type !== 'whirl' && o.type !== 'rope' && !o.dead && o.minClear < 0.55 && o.minClear >= 0) ev.near.push(o); }
    }
    this.rapid += (clamp((rocksNear - 3) / 7, 0, 1) - this.rapid) * Math.min(1, dt * 0.8);

    // slalom gates
    for (let i = this.gates.length - 1; i >= 0; i--) {
      const g = this.gates[i];
      if (g.d < dist - 20) { this.gates.splice(i, 1); continue; }
      if (!g.passed && opts.collide && g.d < rd) {
        g.passed = true;
        if (Math.abs(raftX - g.x) < g.w / 2 - 0.25) ev.gates.push({ bonus: 50, label: 'KAPI!' });
      }
    }

    // coins
    for (let i = this.coins.length - 1; i >= 0; i--) {
      const c = this.coins[i];
      if (c.d < dist - 10) { this.coins.splice(i, 1); continue; }
      if (c.taken) { this.coins.splice(i, 1); continue; }
      if (!opts.collide) continue;
      const dx = c.x - raftX, dz = c.d - rd;
      const mg = opts.magnet === true ? 1 : opts.magnet || 0;
      if (mg && Math.abs(dz) < 16 * mg && Math.abs(dx) < 9 * mg) {
        c.fly = Math.min(1, c.fly + dt * 3.5);
        const k = 1 - Math.exp(-dt * (6 + c.fly * 14));
        c.x += (raftX - c.x) * k;
        c.d += (rd - c.d) * k;
      }
      if (distPointSeg(c.x, c.d, ax, ay, bx, by) < 0.62 + RAFT_R) { c.taken = true; ev.coins++; }
    }
    // power-ups
    for (let i = this.powerups.length - 1; i >= 0; i--) {
      const p = this.powerups[i];
      if (p.d < dist - 10 || p.taken) { this.powerups.splice(i, 1); continue; }
      if (!opts.collide) continue;
      if (distPointSeg(p.x, p.d, ax, ay, bx, by) < 0.9 + RAFT_R) { p.taken = true; ev.pickup = p.type; }
    }
    // bridges
    for (let i = this.bridges.length - 1; i >= 0; i--) if (this.bridges[i].d < dist - 30) {
      const b = this.bridges[i];
      if (b.mesh) { b.mesh.visible = false; b.mesh.userData.busy = false; }
      this.bridges.splice(i, 1);
    }
    return ev;
  }

  rapidAt() { return this.rapid; }

  /** remove an obstacle (shield smash) */
  smash(o) { o.dead = true; const i = this.list.indexOf(o); if (i >= 0) this.list.splice(i, 1); }

  render(time, atm) {
    const night = atm ? atm.night : 0;
    const rc = new Array(ROCK_VARIANTS).fill(0);
    let lc = 0, bc = 0, rpc = 0, fc = 0, mi = 0;
    const tc = [0, 0];
    const ic = new Array(ICE_VARIANTS).fill(0);
    const pc = { boatS: 0, boatL: 0, buoy: 0, buoyFlag: 0 };
    const PM = this.propMeshes;
    let wi = 0, lan = 0, gi = 0;
    for (const o of this.list) {
      if (o.type === 'crust') {
        // flattened rock: near-black basalt with a glowing, breathing magma top
        const m = this.rockMeshes[o.v];
        const k = rc[o.v]++;
        if (k >= CAP) continue;
        const bob = Math.sin(time * 1.4 + o.bob) * 0.04;
        _q.setFromEuler(_e.set(Math.sin(time + o.bob) * 0.04, o.rot, Math.cos(time * 1.2 + o.bob) * 0.04));
        _m.compose(_p.set(o.x, -0.12 + bob, -o.d), _q, _s.set(o.r, o.r * 0.48, o.r));
        m.setMatrixAt(k, _m);
        m.instanceColor.setXYZ(k, CRUST_SIDE.r, CRUST_SIDE.g, CRUST_SIDE.b);
        m.geometry.attributes.aTop.setXYZ(k, CRUST_TOP.r, CRUST_TOP.g, CRUST_TOP.b);
        m.geometry.attributes.aRockGlow.setX(k, 0.5 + 0.3 * Math.sin(time * 2.3 + o.bob * 3));
        continue;
      }
      if (o.type === 'geyser') {
        // bubbling warning ring, then the column
        if (o.warn > 0 && mi < this.markers.length) {
          const mk = this.markers[mi++];
          mk.visible = true;
          mk.position.set(o.x, 0.08, -o.d);
          mk.scale.setScalar(o.r * 1.5);
          mk.material.uniforms.uK.value = o.warn;
          mk.material.uniforms.uColor.value.set('#ff6a12');
        }
        if (o.erupt > 0 && gi < this.geyserPool.length) {
          const g = this.geyserPool[gi++];
          g.visible = true;
          g.position.set(o.x, -0.1, -o.d);
          g.scale.set(o.r * (0.75 + 0.35 * o.erupt), 0.5 + 7.5 * o.erupt, o.r * (0.75 + 0.35 * o.erupt));
          g.material.uniforms.uK.value = o.erupt;
        }
        continue;
      }
      if (o.type === 'rock') {
        const m = this.rockMeshes[o.v];
        const k = rc[o.v]++;
        if (k >= CAP) continue;
        let y = -0.18 * o.r, sc = 1;
        const falling = o.fall && !o.fall.landed;
        if (falling) {
          y += o.fall.h;
          if (o.fall.h > 25.5) sc = 0.0001;
          if (mi < this.markers.length && o.fall.mark > 0) {
            const mk = this.markers[mi++];
            mk.visible = true;
            mk.position.set(o.x, 0.08, -o.d);
            mk.scale.setScalar(o.r * 1.6);
            mk.material.uniforms.uK.value = o.fall.mark;
            mk.material.uniforms.uColor.value.set(o.fall.lava ? '#ff4a12' : '#ff2a1a');
          }
        }
        _q.setFromEuler(_e.set(falling ? time * 3 : 0, o.rot + (falling ? time * 2 : 0), 0));
        _m.compose(_p.set(o.x, y, -o.d), _q, _s.set(o.r * sc, o.r * 0.95 * sc, o.r * sc));
        m.setMatrixAt(k, _m);
        m.instanceColor.setXYZ(k, o.side.r, o.side.g, o.side.b);
        const lava = o.fall && o.fall.lava;
        const top = lava ? LAVA_TOP : o.top;
        m.geometry.attributes.aTop.setXYZ(k, top.r, top.g, top.b);
        m.geometry.attributes.aRockGlow.setX(k, lava ? 2.2 : o.glow);
      } else if (o.type === 'log') {
        const bob = Math.sin(time * 1.8 + o.bob) * 0.05;
        if (o.tree) {
          const tm = this.treeMeshes[o.tree - 1];
          const k = tc[o.tree - 1]++;
          if (k >= 12) continue;
          // geometry runs along +X from the root; the root sits on the bank
          const ca = Math.cos(o.rot), sa = Math.sin(o.rot);
          const rx = o.x + o.side * ca * (o.len * 0.5 + 0.5), rd = o.d + o.side * sa * (o.len * 0.5 + 0.5);
          // direction from root to the tip
          const dx = -o.side * ca, dd = -o.side * sa;
          _q.setFromEuler(_e.set(0, Math.atan2(dd, dx), 0.04));
          _m.compose(_p.set(rx, 0.15 + bob * 0.5, -rd), _q, _s.set((o.len + 1.0) / 7.2, 1, 1));
          tm.setMatrixAt(k, _m);
          tm.instanceColor.setXYZ(k, o.foliage.r, o.foliage.g, o.foliage.b);
          continue;
        }
        const k = lc++;
        if (k >= CAP) continue;
        _q.setFromEuler(_e.set(Math.sin(time * 1.3 + o.bob) * 0.05, o.rot, Math.sin(time * 1.1 + o.bob) * 0.04));
        _m.compose(_p.set(o.x, 0.04 + bob, -o.d), _q, _s.set(o.len, 1, 1));
        this.logMesh.setMatrixAt(k, _m);
        this.logMesh.instanceColor.setXYZ(k, o.tint.r, o.tint.g, o.tint.b);
      } else if (o.type === 'ice') {
        const m = this.iceMeshes[o.v];
        const k = ic[o.v]++;
        if (k >= CAP) continue;
        const bob = Math.sin(time * 1.5 + o.bob) * 0.05;
        _q.setFromEuler(_e.set(Math.sin(time + o.bob) * 0.04, o.rot, Math.cos(time * 1.2 + o.bob) * 0.04));
        _m.compose(_p.set(o.x, bob, -o.d), _q, _s.set(o.r, 1, o.r));
        m.setMatrixAt(k, _m);
      } else if (o.type === 'barrel') {
        const k = bc++;
        if (k >= 40) continue;
        const bob = Math.sin(time * 2.1 + o.bob) * 0.06;
        _q.setFromEuler(_e.set(time * 0.6 + o.bob, o.rot, Math.sin(time * 1.4 + o.bob) * 0.1));
        _m.compose(_p.set(o.x, 0.08 + bob, -o.d), _q, _s.set(1.05, 1.05, 1.05));
        this.barrelMesh.setMatrixAt(k, _m);
        this.barrelMesh.instanceColor.setXYZ(k, o.tint.r, o.tint.g, o.tint.b);
      } else if (o.type === 'boat') {
        const key = o.kind ? 'boatL' : 'boatS';
        const m = PM[key];
        if (!m) continue;
        const k = pc[key]++;
        if (k >= 8) continue;
        const bob = Math.sin(time * 1.6 + o.bob) * 0.06;
        // model's long axis is Z; o.rot is the angle of the long axis from X
        _q.setFromEuler(_e.set(Math.sin(time * 1.2 + o.bob) * 0.06, -o.rot + Math.PI / 2, Math.sin(time * 1.5 + o.bob) * 0.08));
        _m.compose(_p.set(o.x, -0.12 + bob, -o.d), _q, _s.set(1.25, 1.25, 1.25));
        m.setMatrixAt(k, _m);
      } else if (o.type === 'buoy') {
        const key = o.flag ? 'buoyFlag' : 'buoy';
        const m = PM[key];
        if (!m) continue;
        const k = pc[key]++;
        if (k >= (o.flag ? 16 : 48)) continue;
        const bob = Math.sin(time * 2.0 + o.bob) * 0.07;
        _q.setFromEuler(_e.set(Math.sin(time * 1.7 + o.bob) * 0.1, o.bob, Math.cos(time * 1.3 + o.bob) * 0.1));
        _m.compose(_p.set(o.x, -0.05 + bob, -o.d), _q, _s.set(1.05, 1.05, 1.05));
        m.setMatrixAt(k, _m);
        if (night > 0.3 && o.flag && lan < 24) {
          _m.compose(_p.set(o.x, 2.35 + bob, -o.d), _q.identity(), _s.set(1, 1, 1));
          this.lanternMesh.setMatrixAt(lan++, _m);
        }
      } else if (o.type === 'rope') {
        const k = rpc++;
        if (k >= 64) continue;
        const len = Math.abs(o.x1 - o.x0);
        _m.compose(_p.set(o.x, 0.05, -o.d), _q.identity(), _s.set(len, 1, 1));
        this.ropeMesh.setMatrixAt(k, _m);
        const nf = Math.floor(len / 0.6);
        for (let f = 1; f < nf && fc < 320; f++) {
          _m.compose(_p.set(o.x0 + (o.x1 - o.x0) * (f / nf), 0.06 + Math.sin(time * 2.4 + f + o.x0) * 0.025, -o.d), _q.identity(), _s.set(1, 1, 1));
          this.floatMesh.setMatrixAt(fc++, _m);
        }
      } else if (o.type === 'whirl' && wi < this.whirlPool.length) {
        const w = this.whirlPool[wi++];
        w.visible = true;
        w.position.set(o.x, 0.06, -o.d);
        w.scale.setScalar(o.r);
        w.material.uniforms.uDeep.value.copy(o.deep);
        w.material.uniforms.uFoam.value.copy(o.foam);
      }
    }
    for (let v = 0; v < ROCK_VARIANTS; v++) {
      const m = this.rockMeshes[v];
      m.count = Math.min(rc[v], CAP);
      m.instanceMatrix.needsUpdate = true; m.instanceColor.needsUpdate = true;
      m.geometry.attributes.aTop.needsUpdate = true; m.geometry.attributes.aRockGlow.needsUpdate = true;
    }
    const fin = (m, n, cap) => { if (!m) return; m.count = Math.min(n, cap); m.instanceMatrix.needsUpdate = true; if (m.instanceColor) m.instanceColor.needsUpdate = true; };
    fin(this.logMesh, lc, CAP);
    fin(this.treeMeshes[0], tc[0], 12); fin(this.treeMeshes[1], tc[1], 12);
    fin(this.barrelMesh, bc, 40);
    fin(this.ropeMesh, rpc, 64); fin(this.floatMesh, fc, 320);
    for (const k in pc) fin(PM[k], pc[k], k === 'buoy' ? 48 : k === 'buoyFlag' ? 16 : 8);
    for (let v = 0; v < ICE_VARIANTS; v++) { this.iceMeshes[v].count = Math.min(ic[v], CAP); this.iceMeshes[v].instanceMatrix.needsUpdate = true; }
    for (; wi < this.whirlPool.length; wi++) this.whirlPool[wi].visible = false;
    for (; gi < this.geyserPool.length; gi++) this.geyserPool[gi].visible = false;
    for (; mi < this.markers.length; mi++) this.markers[mi].visible = false;
    this.floatMat.emissive.setRGB(night * 1.6, night * 0.5, night * 0.15);

    // bridges
    for (const b of this.bridges) {
      if (!b.mesh) {
        const m = this.bridgeMeshes.find((x) => !x.userData.busy);
        if (!m) continue;
        m.userData.busy = true;
        m.geometry.dispose();
        m.geometry = bridgeGeometry(b.style, b.piers, RIVER_HALF + 9, 7.8, mulberry32((b.d * 13) | 0));
        m.position.set(0, 0, -b.d);
        m.visible = true;
        b.mesh = m;
      }
      if (b.lanterns && night > 0.3) {
        for (const x of [-RIVER_HALF - 1, -2.5, 2.5, RIVER_HALF + 1]) {
          for (const s of [-1, 1]) {
            if (lan >= 24) break;
            _m.compose(_p.set(x, 8.95, -b.d + s * 1.35), _q.identity(), _s.set(1, 1, 1));
            this.lanternMesh.setMatrixAt(lan++, _m);
          }
        }
      }
    }
    this.lanternMesh.count = lan;
    this.lanternMesh.instanceMatrix.needsUpdate = true;

    // slalom gates
    const pcount = [0, 0];
    let wc = 0, poc = 0;
    for (const g of this.gates) {
      const mesh = this.poleMeshes[g.red ? 1 : 0];
      const swing = Math.sin(time * 1.3 + g.d) * 0.05;
      for (const s of [-1, 1]) {
        const k = pcount[g.red ? 1 : 0]++;
        if (k >= 16) continue;
        _q.setFromEuler(_e.set(swing, 0, swing * 0.5 * s));
        _m.compose(_p.set(g.x + s * g.w / 2, 2.45, -g.d), _q, _s.set(1, 1, 1));
        mesh.setMatrixAt(k, _m);
      }
      if (wc < 8) {
        _m.compose(_p.set(0, 3.45, -g.d), _q.identity(), _s.set(RIVER_HALF * 2 + 7, 1, 1));
        this.wireMesh.setMatrixAt(wc++, _m);
      }
      for (const s of [-1, 1]) if (poc < 16) {
        _m.compose(_p.set(s * (RIVER_HALF + 3.5), -1.0, -g.d), _q.identity(), _s.set(1, 1, 1));
        this.postMesh.setMatrixAt(poc++, _m);
      }
    }
    fin(this.poleMeshes[0], pcount[0], 16); fin(this.poleMeshes[1], pcount[1], 16);
    fin(this.wireMesh, wc, 8); fin(this.postMesh, poc, 16);

    // checkpoint arch at the next biome boundary
    if (this.arch) {
      const dist = this.lastDist || 0;
      const kb = biomeIndex(Math.max(0, dist - 15)) + 1;
      const db = biomeStart(kb);
      this.arch.visible = kb > 0 && db - dist < 420;
      this.arch.position.set(0, -0.3, -db);
    }

    // coins
    let cc = 0;
    for (const c of this.coins) {
      if (cc >= 160) break;
      _q.setFromEuler(_e.set(0, time * 3.2 + c.ph, 0));
      const y = 0.75 + Math.sin(time * 3 + c.ph) * 0.12 + c.fly * 0.4;
      _m.compose(_p.set(c.x, y, -c.d), _q, _s.set(1, 1, 1));
      this.coinMesh.setMatrixAt(cc++, _m);
    }
    this.coinMesh.count = cc;
    this.coinMesh.instanceMatrix.needsUpdate = true;
    // power-ups
    for (const t in this.puMeshes) this.puMeshes[t].visible = false;
    for (const p of this.powerups) {
      const g = this.puMeshes[p.type];
      g.visible = true;
      g.position.set(p.x, 1.1 + Math.sin(time * 2.5) * 0.15, -p.d);
      g.userData.icon.rotation.y = time * 2.2;
    }
  }

  /** foam slots for the water shader (filled after the raft/paddle slots) */
  fillFoam(slots, n0, dist) {
    let n = n0;
    this.lastDist = dist;
    for (const o of this.list) {
      if (n >= MAX_OBS) break;
      if (o.d > dist + 130 || o.d < dist - 14) continue;
      if (o.type === 'rock') {
        if (o.fall && !o.fall.landed) continue;
        const sp = o.fall ? o.fall.splash || 0 : 0;
        slots[n++].set(o.x, -o.d, o.r * 0.92 + sp * 1.6, 1.0);
      } else if (o.type === 'ice') slots[n++].set(o.x, -o.d, o.r * 0.95, 0.8);
      else if (o.type === 'crust') slots[n++].set(o.x, -o.d, o.r * 0.95, 0.22);
      else if (o.type === 'geyser') { if (o.warn > 0 || o.erupt > 0) slots[n++].set(o.x, -o.d, 0.9 + o.warn * 0.6 + o.erupt * 1.4, 1.0); }
      else if (o.type === 'pier') slots[n++].set(o.x, -o.d, 0.75, 1.0);
      else if (o.type === 'buoy' || o.type === 'barrel') slots[n++].set(o.x, -o.d, 0.4, 0.6);
      else if (o.type === 'log' || o.type === 'boat') {
        const hx = Math.cos(o.rot) * o.len * 0.5, hy = Math.sin(o.rot) * o.len * 0.5;
        for (const t of [-0.75, 0, 0.75]) { if (n < MAX_OBS) slots[n++].set(o.x + hx * t, -(o.d + hy * t), o.type === 'boat' ? 0.6 : 0.5, 0.75); }
      }
    }
    return n;
  }
}
