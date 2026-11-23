import * as THREE from 'three';
import { G, BEND_PARS } from './patch.js';

const VS = /* glsl */`
${BEND_PARS}
uniform float uTime, uSway, uSize, uStretch, uOpacity;
uniform vec3 uCam, uBox, uVel, uCenterOff;
attribute vec3 aOffset;
attribute vec4 aRand;
varying vec2 vUv;
varying float vAlpha;
varying float vMix;
void main() {
  vec3 vel = uVel * (0.75 + 0.5 * aRand.x);
  vec3 p = aOffset * uBox + vel * uTime;
  p.x += sin(uTime * (0.7 + aRand.y) + aRand.z * 6.283) * uSway;
  p.z += cos(uTime * (0.6 + aRand.x) + aRand.w * 6.283) * uSway * 0.7;
  p.y += sin(uTime * (0.9 + aRand.w) + aRand.x * 6.283) * uSway * 0.25;
  vec3 c = uCam + uCenterOff;
  vec3 mn = c - uBox * 0.5;
  vec3 wp = mn + mod(p - mn, uBox);
  vec3 rel = (wp - mn) / uBox;
  float edge = smoothstep(0.0, 0.08, rel.x) * smoothstep(1.0, 0.92, rel.x)
             * smoothstep(0.0, 0.1, rel.y) * smoothstep(1.0, 0.9, rel.y)
             * smoothstep(0.0, 0.1, rel.z) * smoothstep(1.0, 0.9, rel.z);
  vec4 mvPosition = viewMatrix * bendWorld(vec4(wp, 1.0));
  vec2 corner = position.xy;
  float sz = uSize * (0.6 + 0.8 * aRand.w);
#ifdef STRETCH
  vec3 vdir = (viewMatrix * vec4(normalize(uVel), 0.0)).xyz;
  vec2 ax = normalize(vdir.xy + vec2(0.0001, 0.0));
  vec2 pr = vec2(-ax.y, ax.x);
  mvPosition.xy += ax * corner.y * sz * uStretch + pr * corner.x * sz;
#else
  #ifdef SPIN
    float ang = uTime * (1.0 + aRand.y * 2.0) + aRand.z * 6.283;
    float cs = cos(ang), sn = sin(ang);
    corner = vec2(corner.x * cs - corner.y * sn, corner.x * sn + corner.y * cs);
    corner.x *= 0.3 + 0.7 * abs(sin(uTime * (1.5 + aRand.x) + aRand.w * 6.0));
  #endif
  mvPosition.xy += corner * sz;
#endif
  gl_Position = projectionMatrix * mvPosition;
  vUv = uv;
  vAlpha = edge * uOpacity * smoothstep(3.0, 7.5, -mvPosition.z);
#ifdef BLINK
  vAlpha *= pow(0.5 + 0.5 * sin(uTime * (1.2 + aRand.x * 2.0) + aRand.z * 30.0), 3.0);
#endif
  vMix = aRand.y;
}`;

const FS = /* glsl */`
uniform vec3 uColorA, uColorB;
uniform float uGain;
varying vec2 vUv;
varying float vAlpha;
varying float vMix;
void main() {
  vec2 c = vUv - 0.5;
  float a;
#if SHAPE == 0
  a = (1.0 - smoothstep(0.0, 0.5, abs(c.x))) * (1.0 - smoothstep(0.25, 0.5, abs(c.y)));
#elif SHAPE == 1
  a = smoothstep(0.5, 0.05, length(c));
#elif SHAPE == 2
  a = smoothstep(0.5, 0.4, length(c * vec2(2.3, 1.0)));
#else
  float d = length(c);
  a = smoothstep(0.5, 0.0, d);
  a = a * a + smoothstep(0.12, 0.0, d);
#endif
  if (a * vAlpha < 0.01) discard;
  gl_FragColor = vec4(mix(uColorA, uColorB, vMix) * uGain, a * vAlpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const SHAPES = { drop: 0, soft: 1, leaf: 2, glow: 3 };

export class WeatherField {
  constructor(scene, o) {
    this.o = o;
    const quad = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = quad.index;
    g.setAttribute('position', quad.attributes.position);
    g.setAttribute('uv', quad.attributes.uv);
    const off = new Float32Array(o.count * 3), rnd = new Float32Array(o.count * 4);
    for (let i = 0; i < o.count * 3; i++) off[i] = Math.random();
    for (let i = 0; i < o.count * 4; i++) rnd[i] = Math.random();
    g.setAttribute('aOffset', new THREE.InstancedBufferAttribute(off, 3));
    g.setAttribute('aRand', new THREE.InstancedBufferAttribute(rnd, 4));
    g.instanceCount = o.count;
    const defines = { SHAPE: SHAPES[o.shape] };
    if (o.stretch) defines.STRETCH = 1;
    if (o.spin) defines.SPIN = 1;
    if (o.blink) defines.BLINK = 1;
    this.u = {
      uTime: { value: 0 }, uSway: { value: o.sway || 0 }, uSize: { value: o.size }, uStretch: { value: o.stretch || 1 },
      uOpacity: { value: 0 }, uCam: { value: new THREE.Vector3() }, uBox: { value: new THREE.Vector3(...o.box) },
      uVel: { value: new THREE.Vector3(...o.vel) }, uCenterOff: { value: new THREE.Vector3(...o.center) },
      uColorA: { value: new THREE.Color(o.colors[0]) }, uColorB: { value: new THREE.Color(o.colors[1]) },
      uGain: { value: o.gain || 1 }, uBend: G.uBend, uBendO: G.uBendO,
    };
    this.mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({
      uniforms: this.u, vertexShader: VS, fragmentShader: FS, defines, transparent: true, depthWrite: false,
      blending: o.additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 8;
    this.mesh.layers.set(1);
    this.mesh.visible = false;
    this.level = 1;
    scene.add(this.mesh);
  }

  update(time, cam, intensity) {
    const v = intensity * (this.o.alpha ?? 1);
    this.mesh.visible = v > 0.01;
    if (!this.mesh.visible) return;
    this.u.uTime.value = time;
    this.u.uCam.value.copy(cam);
    this.u.uOpacity.value = Math.min(1, v);
    this.mesh.geometry.instanceCount = Math.max(1, Math.floor(this.o.count * Math.min(1, intensity * 1.15) * this.level));
  }
}

export function createWeather(scene) {
  return {
    rain: new WeatherField(scene, { count: 2200, box: [30, 22, 56], center: [0, 8, -18], vel: [-1.4, -27, 4], size: 0.075, stretch: 14, shape: 'drop', colors: ['#d6e2ec', '#b9cad9'], alpha: 0.75 }),
    snow: new WeatherField(scene, { count: 1500, box: [44, 26, 80], center: [0, 9, -30], vel: [0.5, -2.3, 1.4], sway: 0.8, size: 0.14, shape: 'soft', colors: ['#ffffff', '#e8f0ff'], alpha: 0.95 }),
    leaves: new WeatherField(scene, { count: 280, box: [44, 18, 80], center: [0, 6, -30], vel: [1.3, -1.3, 1.6], sway: 1.6, size: 0.24, shape: 'leaf', spin: true, colors: ['#e2701f', '#c23a1c'], alpha: 1 }),
    fireflies: new WeatherField(scene, { count: 240, box: [42, 5, 90], center: [0, 2.0, -35], vel: [0, 0.05, 0], sway: 1.3, size: 0.24, shape: 'glow', additive: true, blink: true, colors: ['#d8ff6a', '#ffe36a'], gain: 2.2 }),
    embers: new WeatherField(scene, { count: 320, box: [44, 22, 80], center: [0, 8, -30], vel: [0.4, 2.0, 0.7], sway: 0.9, size: 0.14, shape: 'glow', additive: true, blink: true, colors: ['#ff8a2a', '#ff3a1a'], gain: 2.4 }),
    ash: new WeatherField(scene, { count: 600, box: [44, 22, 80], center: [0, 8, -30], vel: [0.5, -1.0, 0.9], sway: 1.0, size: 0.09, shape: 'soft', colors: ['#3a3434', '#5a5050'], alpha: 0.8 }),
    dust: new WeatherField(scene, { count: 150, box: [44, 10, 80], center: [0, 3, -30], vel: [2.4, 0.1, 0.6], sway: 1.4, size: 1.0, shape: 'soft', colors: ['#e8b58a', '#d89a6a'], alpha: 0.16 }),
    pollen: new WeatherField(scene, { count: 170, box: [40, 7, 80], center: [0, 2.6, -30], vel: [0.4, 0.15, 0.3], sway: 1.1, size: 0.07, shape: 'glow', additive: true, colors: ['#fffbe0', '#fff0a0'], gain: 1.4, alpha: 0.7 }),
  };
}
