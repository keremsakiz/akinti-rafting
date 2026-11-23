// Global tuning constants
export const RIVER_HALF = 6.0;        // river half width (m)
export const RAFT_LIMIT = RIVER_HALF - 1.15;
export const RAFT_R = 0.72;           // raft capsule radius (collision)
export const RAFT_HALF = 0.95;        // raft capsule half segment length
// river speed at a given distance: 13 m/s -> ~38 m/s
export const speedAt = (d) => 13 + 25 * (1 - Math.exp(-Math.max(0, d) / 1800));
export const CHUNK_LEN = 40;          // terrain chunk length (m)
export const NUM_CHUNKS = 9;
export const CHUNKS_BEHIND = 1;
// Arena (biome) lengths grow: 1st arena 800 m, every next one 300 m longer.
// Starts: 0, 800, 1900, 3300, 5000, 7000, 9300, 11900 ... Difficulty still depends only on distance.
export const BIOME_FIRST = 800;
export const BIOME_GROW = 300;
export function biomeStart(k) { return k <= 0 ? 0 : k * BIOME_FIRST + (BIOME_GROW * k * (k - 1)) / 2; }
export function biomeIndex(d) {
  const a = BIOME_GROW / 2, b = BIOME_FIRST - BIOME_GROW / 2;
  let k = Math.max(0, Math.floor((-b + Math.sqrt(b * b + 4 * a * Math.max(0, d))) / (2 * a)));
  while (biomeStart(k + 1) <= d) k++;
  while (k > 0 && biomeStart(k) > d) k--;
  return k;
}
export const BIOME_TRANS = 70;        // blend zone length (m)
export const SPAWN_AHEAD = 200;       // obstacles appear this far ahead
export const MAX_OBS = 32;            // foam slots in water shader
export const MAX_TRAIL = 14;          // wake points in water shader
export const SAFE_START = 90;         // obstacle-free meters at run start

export const TAU = Math.PI * 2;
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const smooth01 = (x) => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
