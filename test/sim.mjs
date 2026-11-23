// Headless gameplay feasibility simulation: a bot follows the generated safe path
import * as THREE from 'three';
import { mulberry32 } from '../src/noise.js';
Math.random = mulberry32(parseInt(process.env.SEED || '7', 10));
import { Obstacles } from '../src/obstacles.js';
import { RAFT_LIMIT, speedAt, clamp } from '../src/config.js';

const damp = (a, b, l, dt) => a + (b - a) * (1 - Math.exp(-l * dt));
const runs = parseInt(process.argv[2] || '20', 10), maxD = parseInt(process.argv[3] || '4000', 10);
const deaths = {}; let total = 0;
for (let r = 0; r < runs; r++) {
  const ob = new Obstacles(new THREE.Scene());
  ob.reset(); ob.pathLog = [];
  const START = parseInt(process.env.START || '0', 10); // e.g. START=9300 to test ATEŞ DAĞI
  let dist = START, x = 0, vx = 0, tx = 0, speed = START ? speedAt(START) : 13, tsim = 0;
  if (START) ob.nextD = START + 90;
  const dt = 1 / 60;
  let died = null; const hist = [];
  while (dist < START + maxD) {
    speed = damp(speed, speedAt(dist), 1.6, dt);
    // steer: target the path of the next unpassed row
    const next = ob.pathLog.find((p) => p[0] > dist - 1.0);
    if (next) tx = clamp(next[1], -RAFT_LIMIT, RAFT_LIMIT);
    // dodge moving logs: predict where the log will be on arrival and take the roomier side
    const mls = ob.list.filter((o) => ((o.type === 'log' && o.vx) || o.type === 'boat') && o.d > dist - 2.5 && o.d < dist + 60 && (!next || o.d <= next[0] + 0.5)).sort((a, b) => a.d - b.d);
    const ml = mls[0];
    if (ml) {
      let lx = ml.x, lv = ml.vx;
      const ta = Math.max(0, (ml.d - dist) / speed);
      const ext = Math.abs(Math.cos(ml.rot)) * ml.len / 2 + (ml.type === 'boat' ? 0.75 : 0.4);
      const lim = ml.type === 'boat' ? 6.2 : 6.3;
      for (let t = 0; t < ta; t += 1 / 60) { lx += lv / 60; if (lx + ext > lim && lv > 0) lv = -lv; if (lx - ext < -lim && lv < 0) lv = -lv; }
      const left = (lx - ext) - (-6), right = 6 - (lx + ext);
      const cand = left > right ? clamp((lx - ext - 6) / 2, -RAFT_LIMIT, RAFT_LIMIT) : clamp((lx + ext + 6) / 2, -RAFT_LIMIT, RAFT_LIMIT);
      tx = cand;
    }
    const steps = Math.max(1, Math.ceil(speed * dt / 0.45)), h = dt / steps;
    for (let i = 0; i < steps; i++) {
      const want = clamp((tx - x) * 9, -17, 17);
      vx = damp(vx, want, 14, h); x = clamp(x + vx * h, -RAFT_LIMIT, RAFT_LIMIT);
      dist += speed * h; tsim += h;
      const ev = ob.update(h, tsim, dist, x, { spawn: true, collide: true, magnet: false });
      if (ev.pull) tx = clamp(tx + ev.pull * h * 0.55, -RAFT_LIMIT, RAFT_LIMIT);
      if (ev.hit) { died = ev.hit; break; }
    }
    hist.push([dist.toFixed(1), x.toFixed(2), tx.toFixed(2)]);
    if (died) break;
  }
  total += dist;
  if (died) {
    const row = ob.pathLog.filter((p) => p[0] <= died.d + 4).pop();
    const key = died.type + (died.vx ? '(moving)' : '') + ' @pattern=' + (row ? row[2] : '?');
    deaths[key] = (deaths[key] || 0) + 1;
    if (process.env.V) { console.log(hist.slice(-60).filter((_, i) => i % 4 === 0).map((h) => h.join(' ')).join('\n')); console.log('rows', JSON.stringify(ob.pathLog.filter((p) => p[0] > dist - 70 && p[0] < dist + 20))); console.log('near', ob.list.filter((o) => Math.abs(o.d - dist) < 25).map((o) => `${o.type} x=${o.x.toFixed(2)} d=${o.d.toFixed(1)} r=${o.r.toFixed(2)}`).join(' | ')); }
    console.log(`run ${r}: died at ${dist.toFixed(0)} m by ${key} x=${x.toFixed(2)} obsX=${died.x.toFixed(2)} path=${row ? row[1].toFixed(2) : '?'}`);
  } else console.log(`run ${r}: survived ${maxD} m`);
}
console.log('avg distance', (total / runs).toFixed(0), deaths);
