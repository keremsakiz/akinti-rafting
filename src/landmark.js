// ATEŞ DAĞI landmark: a smoking stratovolcano on the horizon that erupts every few seconds.
// It rides along with the raft (always ~170 m ahead, off to one side) like a skybox element,
// rises over the horizon as the biome blends in, and sinks away when it ends.
import * as THREE from 'three';
import { patchMaterial } from './patch.js';
import { mulberry32 } from './noise.js';

const H = 66, R0 = 86, RC = 11;
const radiusAt = (u) => RC + (R0 - RC) * Math.pow(1 - u, 2.1);

export class VolcanoLandmark {
  constructor(scene) {
    const rng = mulberry32(77);
    this.group = new THREE.Group();
    this.group.visible = false;

    // cone (lathe) with rough silhouette and ash/basalt bands
    const pts = [];
    for (let i = 0; i <= 26; i++) { const u = i / 26; pts.push(new THREE.Vector2(radiusAt(u), u * H)); }
    pts.push(new THREE.Vector2(RC * 0.72, H - 2.5), new THREE.Vector2(RC * 0.2, H - 4.5));
    const geo = new THREE.LatheGeometry(pts, 56).toNonIndexed();
    const pos = geo.attributes.position;
    const col = new Float32Array(pos.count * 3);
    const cBase = new THREE.Color('#2c211f'), cAsh = new THREE.Color('#4a3a35'), cTop = new THREE.Color('#171110'), c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
      const a = Math.atan2(z, x), u = y / H;
      const rough = 1 + 0.07 * Math.sin(a * 7 + u * 9) + 0.05 * Math.sin(a * 17 - u * 23) + 0.03 * Math.sin(a * 31 + u * 40);
      const ridge = 1 + 0.06 * Math.pow(Math.abs(Math.sin(a * 5 + u * 3)), 6);
      pos.setX(i, x * rough * ridge); pos.setZ(i, z * rough * ridge);
      const band = 0.5 + 0.5 * Math.sin(u * 30 + Math.sin(a * 3) * 2);
      c.copy(cBase).lerp(cAsh, band * 0.45 * (1 - u)).lerp(cTop, Math.max(0, u - 0.7) * 2.5);
      col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.computeVertexNormals();
    const coneMat = patchMaterial(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), {});
    this.cone = new THREE.Mesh(geo, coneMat);
    this.group.add(this.cone);

    // glowing crater (unfogged so it reads through the haze) + a hot halo
    this.glowMat = patchMaterial(new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff7a2a').multiplyScalar(3), fog: false }), {});
    const crater = new THREE.Mesh(new THREE.CircleGeometry(RC * 0.8, 28).rotateX(-Math.PI / 2), this.glowMat);
    crater.position.y = H - 2.3;
    this.group.add(crater);

    // lava streams running down the flanks
    const streams = [];
    for (let k = 0; k < 6; k++) {
      let a = (k / 6) * Math.PI * 2 + rng() * 0.6 - Math.PI * 0.5; // mostly on the side facing the river
      const v = [], idx = [];
      const steps = 22, uEnd = 0.25 + rng() * 0.3;
      for (let j = 0; j <= steps; j++) {
        const u = 0.985 - (0.985 - uEnd) * (j / steps);
        a += (rng() - 0.5) * 0.08;
        const r = radiusAt(u) * 1.03 + 0.4;
        const w = (1.8 - 1.2 * (j / steps)) * (0.7 + rng() * 0.6);
        const tx = -Math.sin(a), tz = Math.cos(a);
        const cx = Math.cos(a) * r, cz = Math.sin(a) * r, cy = u * H;
        v.push(cx - tx * w, cy, cz - tz * w, cx + tx * w, cy, cz + tz * w);
        if (j > 0) { const b = (j - 1) * 2; idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2); }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
      g.setIndex(idx);
      streams.push(g);
    }
    this.lavaMat = patchMaterial(new THREE.MeshBasicMaterial({ color: new THREE.Color('#ff5a14').multiplyScalar(2.2), fog: false, side: THREE.DoubleSide }), {});
    for (const g of streams) this.group.add(new THREE.Mesh(g, this.lavaMat));

    this.group.traverse((o) => { if (o.isMesh) { o.frustumCulled = false; o.layers.set(1); } });
    scene.add(this.group);

    this.smokeT = 0;
    this.eruptT = 6;
    this.heat = 0;
    this._smoke = [new THREE.Color('#2a2220'), new THREE.Color('#3a302c'), new THREE.Color('#1c1716')];
    this._fire = [new THREE.Color('#ffb24a').multiplyScalar(2.4), new THREE.Color('#ff5a14').multiplyScalar(2.0)];
  }

  /**
   * w: how much of the volcano biome is showing (0..1); speed: raft speed (m/s) so smoke and
   * lava keep pace with the landmark; onErupt(strength) fires for the rumble/flash.
   */
  update(dt, dist, w, speed, particles, onErupt) {
    const g = this.group;
    g.visible = w > 0.01;
    if (!g.visible) return;
    const x = 46, z = -dist - 172;
    g.position.set(x, -8 - (1 - w) * 80, z);
    // crater glow breathes, flares after an eruption
    this.heat = Math.max(0, this.heat - dt * 0.6);
    const k = 1 + 0.25 * Math.sin(performance.now() * 0.003) + this.heat * 2.5;
    this.glowMat.color.set('#ff7a2a').multiplyScalar(3 * k);
    this.lavaMat.color.set('#ff5a14').multiplyScalar(2.0 + this.heat * 1.5);
    if (w < 0.6) return;
    const cy = g.position.y + H - 1;
    // steady smoke plume (moves with the landmark)
    this.smokeT -= dt;
    while (this.smokeT <= 0) {
      this.smokeT += 0.16;
      const c = this._smoke[(Math.random() * 3) | 0];
      particles.emit(x + (Math.random() - 0.5) * 6, cy, z + (Math.random() - 0.5) * 6,
        1.5 + Math.random() * 1.5, 5 + Math.random() * 3, -speed, 6.5, 9 + Math.random() * 7, c, 0.15, 0, 0.75, 1.4);
    }
    // eruption
    this.eruptT -= dt;
    if (this.eruptT <= 0) {
      this.eruptT = 9 + Math.random() * 6;
      this.heat = 1;
      for (let i = 0; i < 70; i++) {
        const a = Math.random() * Math.PI * 2, s = 3 + Math.random() * 9;
        particles.emit(x + (Math.random() - 0.5) * 4, cy, z + (Math.random() - 0.5) * 4,
          Math.cos(a) * s, 14 + Math.random() * 16, Math.sin(a) * s - speed, 3.2, 2.2 + Math.random() * 2.2, this._fire[i % 2], -9.8, 0, 1, 0.2);
      }
      for (let i = 0; i < 14; i++) {
        particles.emit(x + (Math.random() - 0.5) * 8, cy + 4, z + (Math.random() - 0.5) * 8,
          (Math.random() - 0.5) * 4, 9 + Math.random() * 6, -speed, 5, 16 + Math.random() * 10, this._smoke[i % 3], 0.4, 0, 0.85, 1.6);
      }
      if (onErupt) onErupt(1);
    }
  }
}
