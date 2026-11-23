import * as THREE from 'three';
import { G, BEND_PARS, BEND_PROJECT } from './patch.js';

const VS = /* glsl */`
${BEND_PARS}
uniform float uScale;
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
varying float vAlpha;
varying vec3 vColor;
void main() {
  vec4 wpos = modelMatrix * vec4(position, 1.0);
  ${BEND_PROJECT}
  gl_PointSize = aSize * uScale / max(-mvPosition.z, 0.5);
  // fade sprites that get very close to the camera (no big blurry blobs)
  vAlpha = aAlpha * smoothstep(1.4, 4.2, -mvPosition.z);
  vColor = aColor;
}`;
const FS = /* glsl */`
varying float vAlpha;
varying vec3 vColor;
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = (smoothstep(0.5, 0.3, d) * 0.55 + smoothstep(0.3, 0.05, d) * 0.45) * vAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

/** CPU particle pool for spray, splashes, sparkles and debris */
export class Particles {
  constructor(scene, max = 900) {
    this.max = max;
    this.n = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.size0 = new Float32Array(max);
    this.a0 = new Float32Array(max);
    this.grow = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage);
    this.aAlpha = new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.aPos);
    g.setAttribute('aColor', this.aCol);
    g.setAttribute('aSize', this.aSize);
    g.setAttribute('aAlpha', this.aAlpha);
    g.setDrawRange(0, 0);
    this.uniforms = { uScale: { value: 400 }, uBend: G.uBend, uBendO: G.uBendO };
    this.points = new THREE.Points(g, new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: VS, fragmentShader: FS, transparent: true, depthWrite: false }));
    this.points.frustumCulled = false;
    this.points.renderOrder = 6;
    this.points.layers.set(1);
    scene.add(this.points);
  }

  emit(x, y, z, vx, vy, vz, life, size, color, grav = -9.8, drag = 0.8, a0 = 1, grow = 0.25) {
    let i = this.n;
    if (i >= this.max) {
      // overwrite the oldest-ish particle
      i = (Math.random() * this.max) | 0;
    } else this.n++;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.col[i * 3] = color.r; this.col[i * 3 + 1] = color.g; this.col[i * 3 + 2] = color.b;
    this.size0[i] = size; this.size[i] = size;
    this.life[i] = life; this.maxLife[i] = life;
    this.grav[i] = grav; this.drag[i] = drag;
    this.alpha[i] = a0; this.a0[i] = a0; this.grow[i] = grow;
  }

  burst(x, y, z, n, speed, up, life, size, color, spread = 1, grav = -9.8) {
    for (let k = 0; k < n; k++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.3 + Math.random() * 0.7);
      this.emit(x + (Math.random() - 0.5) * spread, y, z + (Math.random() - 0.5) * spread,
        Math.cos(a) * s, up * (0.5 + Math.random() * 0.8), Math.sin(a) * s, life * (0.6 + Math.random() * 0.6), size * (0.6 + Math.random() * 0.8), color, grav);
    }
  }

  update(dt) {
    let i = 0;
    while (i < this.n) {
      this.life[i] -= dt;
      if (this.life[i] <= 0 || this.pos[i * 3 + 1] < -0.6) {
        const j = --this.n;
        if (i !== j) {
          for (let k = 0; k < 3; k++) {
            this.pos[i * 3 + k] = this.pos[j * 3 + k];
            this.vel[i * 3 + k] = this.vel[j * 3 + k];
            this.col[i * 3 + k] = this.col[j * 3 + k];
          }
          this.size0[i] = this.size0[j]; this.life[i] = this.life[j]; this.maxLife[i] = this.maxLife[j];
          this.grav[i] = this.grav[j]; this.drag[i] = this.drag[j];
          this.a0[i] = this.a0[j]; this.grow[i] = this.grow[j];
        }
        continue;
      }
      const dr = Math.exp(-this.drag[i] * dt);
      this.vel[i * 3] *= dr; this.vel[i * 3 + 2] *= dr;
      this.vel[i * 3 + 1] = this.vel[i * 3 + 1] * dr + this.grav[i] * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const t = this.life[i] / this.maxLife[i];
      this.alpha[i] = Math.min(1, t * 2.2) * this.a0[i];
      this.size[i] = this.size0[i] * (1 + this.grow[i] * (1 - t));
      i++;
    }
    this.points.geometry.setDrawRange(0, this.n);
    this.aPos.needsUpdate = true; this.aCol.needsUpdate = true; this.aSize.needsUpdate = true; this.aAlpha.needsUpdate = true;
  }

  clear() { this.n = 0; this.points.geometry.setDrawRange(0, 0); }
}
