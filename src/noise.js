// Seeded RNG + 2D simplex noise (Gustavson) + fbm helpers
export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const F2 = 0.5 * (Math.sqrt(3) - 1);
const G2 = (3 - Math.sqrt(3)) / 6;
const GX = [1, -1, 1, -1, 1, -1, 0, 0];
const GY = [1, 1, -1, -1, 0, 0, 1, -1];
const perm = new Uint8Array(512);
const pm8 = new Uint8Array(512);

export function seedNoise(seed) {
  const r = mulberry32(seed);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    const t = p[i]; p[i] = p[j]; p[j] = t;
  }
  for (let i = 0; i < 512; i++) { perm[i] = p[i & 255]; pm8[i] = perm[i] & 7; }
}
seedNoise(1337);

export function simplex2(xin, yin) {
  let n0 = 0, n1 = 0, n2 = 0;
  const s = (xin + yin) * F2;
  const i = Math.floor(xin + s), j = Math.floor(yin + s);
  const t = (i + j) * G2;
  const x0 = xin - (i - t), y0 = yin - (j - t);
  let i1, j1;
  if (x0 > y0) { i1 = 1; j1 = 0; } else { i1 = 0; j1 = 1; }
  const x1 = x0 - i1 + G2, y1 = y0 - j1 + G2;
  const x2 = x0 - 1 + 2 * G2, y2 = y0 - 1 + 2 * G2;
  const ii = i & 255, jj = j & 255;
  let t0 = 0.5 - x0 * x0 - y0 * y0;
  if (t0 >= 0) { const g = pm8[ii + perm[jj]]; t0 *= t0; n0 = t0 * t0 * (GX[g] * x0 + GY[g] * y0); }
  let t1 = 0.5 - x1 * x1 - y1 * y1;
  if (t1 >= 0) { const g = pm8[ii + i1 + perm[jj + j1]]; t1 *= t1; n1 = t1 * t1 * (GX[g] * x1 + GY[g] * y1); }
  let t2 = 0.5 - x2 * x2 - y2 * y2;
  if (t2 >= 0) { const g = pm8[ii + 1 + perm[jj + 1]]; t2 *= t2; n2 = t2 * t2 * (GX[g] * x2 + GY[g] * y2); }
  return 70 * (n0 + n1 + n2);
}

export function fbm2(x, y, oct = 4) {
  let a = 0.5, f = 1, s = 0, n = 0;
  for (let i = 0; i < oct; i++) { s += a * simplex2(x * f, y * f); n += a; a *= 0.5; f *= 2.03; }
  return s / n;
}

// Tileable value noise (for textures). Returns Float32Array normalized 0..1
export function periodicNoise(size, periods, amps, seed) {
  const rnd = mulberry32(seed);
  const out = new Float32Array(size * size);
  let total = 0;
  for (let o = 0; o < periods.length; o++) {
    const P = periods[o], A = amps[o];
    total += A;
    const lat = new Float32Array(P * P);
    for (let i = 0; i < P * P; i++) lat[i] = rnd();
    for (let y = 0; y < size; y++) {
      const v = (y / size) * P, j = Math.floor(v), fy = v - j;
      const sy = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
      const j0 = j % P, j1 = (j + 1) % P;
      for (let x = 0; x < size; x++) {
        const u = (x / size) * P, i = Math.floor(u), fx = u - i;
        const sx = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
        const i0 = i % P, i1 = (i + 1) % P;
        const a = lat[i0 + j0 * P], b = lat[i1 + j0 * P], c = lat[i0 + j1 * P], d = lat[i1 + j1 * P];
        const top = a + (b - a) * sx, bot = c + (d - c) * sx;
        out[x + y * size] += A * (top + (bot - top) * sy);
      }
    }
  }
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < out.length; i++) { out[i] /= total; if (out[i] < mn) mn = out[i]; if (out[i] > mx) mx = out[i]; }
  const k = 1 / (mx - mn || 1);
  for (let i = 0; i < out.length; i++) out[i] = (out[i] - mn) * k;
  return out;
}
