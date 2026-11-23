import * as THREE from 'three';
import { mulberry32 } from '../src/noise.js';
const seedArg = parseInt(process.argv[2] || '1', 10);
Math.random = mulberry32(seedArg);
const { Obstacles } = await import('../src/obstacles.js');
const { RAFT_LIMIT, speedAt, clamp } = await import('../src/config.js');
const damp = (a, b, l, dt) => a + (b - a) * (1 - Math.exp(-l * dt));
const ob = new Obstacles(new THREE.Scene());
ob.reset(); ob.pathLog = [];
let dist = 0, x = 0, vx = 0, tx = 0, speed = 13; const dt = 1 / 60; const hist = [];
let died = null;
while (dist < 3000 && !died) {
  speed = damp(speed, speedAt(dist), 1.6, dt);
  const next = ob.pathLog.find((p) => p[0] > dist - 1.0);
  if (next) tx = clamp(next[1], -RAFT_LIMIT, RAFT_LIMIT);
  const steps = Math.max(1, Math.ceil(speed * dt / 0.45)), h = dt / steps;
  for (let i = 0; i < steps; i++) {
    const want = clamp((tx - x) * 9, -17, 17);
    vx = damp(vx, want, 14, h); x = clamp(x + vx * h, -RAFT_LIMIT, RAFT_LIMIT);
    dist += speed * h;
    const ev = ob.update(h, 0, dist, x, { spawn: true, collide: true, magnet: false });
    if (ev.hit) { died = ev.hit; break; }
  }
  hist.push([dist.toFixed(1), x.toFixed(2), tx.toFixed(2), next ? next[0].toFixed(0) + ':' + next[2] : '-']);
}
if (died) {
  console.log('died', died.type, 'at', dist.toFixed(1), 'obs', died.x.toFixed(2), died.d.toFixed(1), 'r', died.r);
  console.log(hist.slice(-70).filter((_, i) => i % 5 === 0).map((h) => h.join(' ')).join('\n'));
  const rows = ob.pathLog.filter((p) => p[0] > dist - 80 && p[0] < dist + 30);
  console.log('rows', JSON.stringify(rows));
  console.log('nearby obstacles', ob.list.filter((o) => Math.abs(o.d - dist) < 30).map((o) => `${o.type} x=${o.x.toFixed(2)} d=${o.d.toFixed(1)} r=${o.r.toFixed(2)}`).join(' | '));
}
