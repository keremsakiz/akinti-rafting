import * as THREE from 'three';
import { RIVER_HALF, TAU } from './config.js';
import { patchMaterial } from './patch.js';
import { birdGeometry, fishGeometry } from './geom.js';

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(), _e = new THREE.Euler();
const FORM = [[0, 0, 0], [-1.3, 0.1, 1.1], [1.3, -0.1, 1.1], [-2.6, 0.2, 2.2], [2.6, 0, 2.2], [-3.9, 0.3, 3.3], [3.9, 0.1, 3.3]];

/** Bird flocks crossing the sky + fish jumping out of the river */
export class Life {
  constructor(scene, particles) {
    this.particles = particles;
    const mat = patchMaterial(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide, flatShading: true }), { flap: true, tint: true });
    this.birds = new THREE.InstancedMesh(birdGeometry(), mat, 14);
    this.birds.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(14 * 3), 3);
    this.birds.count = 0;
    this.birds.frustumCulled = false;
    scene.add(this.birds);
    this.flocks = [];
    this.birdTimer = 3;

    const fmat = patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.35, metalness: 0.15, flatShading: true }), {});
    this.fish = [];
    for (let i = 0; i < 2; i++) {
      const f = new THREE.Mesh(fishGeometry(), fmat);
      f.visible = false;
      scene.add(f);
      this.fish.push({ mesh: f, t: 1, active: false });
    }
    this.fishTimer = 4;
    this.splashColor = new THREE.Color('#ffffff');
  }

  reset() { this.flocks.length = 0; this.birds.count = 0; for (const f of this.fish) { f.active = false; f.mesh.visible = false; } }

  update(dt, time, dist, speed, biome, waterFoam) {
    // ---- birds
    this.birdTimer -= dt;
    if (this.birdTimer <= 0 && biome.birds && this.flocks.length < 2) {
      this.birdTimer = 8 + Math.random() * 9;
      const side = Math.random() < 0.5 ? -1 : 1;
      const n = 3 + Math.floor(Math.random() * 5);
      this.flocks.push({
        x: side * (34 + Math.random() * 10), y: 12 + Math.random() * 9, d: dist + 70 + Math.random() * 60,
        vx: -side * (6 + Math.random() * 4), vd: speed * (0.75 + Math.random() * 0.3), n, color: biome.birds, life: 14,
      });
    } else if (this.birdTimer <= 0) this.birdTimer = 4;
    let bi = 0;
    for (let i = this.flocks.length - 1; i >= 0; i--) {
      const f = this.flocks[i];
      f.x += f.vx * dt; f.d += f.vd * dt; f.life -= dt;
      if (f.life <= 0 || Math.abs(f.x) > 60) { this.flocks.splice(i, 1); continue; }
      const yaw = Math.atan2(-f.vx, f.vd);
      _q.setFromEuler(_e.set(0, yaw, Math.sin(time * 0.8 + i) * 0.15));
      for (let k = 0; k < f.n && bi < 14; k++) {
        const o = FORM[k];
        // rotate formation offsets by yaw
        const cx = Math.cos(yaw), sx = Math.sin(yaw);
        const ox = o[0] * cx + o[2] * sx, oz = -o[0] * sx + o[2] * cx;
        _p.set(f.x + ox, f.y + o[1] + Math.sin(time * 1.3 + k) * 0.25, -f.d + oz);
        _m.compose(_p, _q, _s.set(1.4, 1.4, 1.4));
        this.birds.setMatrixAt(bi, _m);
        this.birds.instanceColor.setXYZ(bi, f.color.r, f.color.g, f.color.b);
        bi++;
      }
    }
    this.birds.count = bi;
    this.birds.instanceMatrix.needsUpdate = true;
    this.birds.instanceColor.needsUpdate = true;

    // ---- fish
    this.fishTimer -= dt;
    if (this.fishTimer <= 0) {
      this.fishTimer = 2.5 + Math.random() * 4;
      const f = this.fish.find((q) => !q.active);
      if (f && biome.fish) {
        f.active = true; f.t = 0;
        f.dur = 0.85 + Math.random() * 0.3;
        f.x0 = (Math.random() * 2 - 1) * (RIVER_HALF - 1.2);
        f.dx = (Math.random() < 0.5 ? -1 : 1) * (1.4 + Math.random() * 1.2);
        f.d0 = dist + 26 + Math.random() * 30;
        f.dd = (Math.random() - 0.5) * 1.5;
        f.h = 1.1 + Math.random() * 0.8;
        f.mesh.visible = true;
        this.splash(f.x0, f.d0, waterFoam);
      }
    }
    for (const f of this.fish) {
      if (!f.active) continue;
      f.t += dt / f.dur;
      if (f.t >= 1) {
        f.active = false; f.mesh.visible = false;
        this.splash(f.x0 + f.dx, f.d0 + f.dd, waterFoam);
        continue;
      }
      const t = f.t;
      const y = -0.25 + f.h * 4 * t * (1 - t);
      const vy = f.h * 4 * (1 - 2 * t);
      f.mesh.position.set(f.x0 + f.dx * t, y, -(f.d0 + f.dd * t));
      const yaw = Math.atan2(-f.dx, f.dd);
      const pitch = Math.atan2(vy, Math.hypot(f.dx, f.dd));
      f.mesh.rotation.set(0, 0, 0);
      f.mesh.rotateY(yaw);
      f.mesh.rotateX(pitch);
      f.mesh.rotateZ(Math.sin(time * 20) * 0.15);
    }
  }

  splash(x, d, color) {
    if (!this.particles) return;
    this.particles.burst(x, 0.05, -d, 14, 1.6, 3.2, 0.7, 0.32, color || this.splashColor, 0.6);
  }
}
