// Game feel ("juice"): trauma camera shake, real-time hit-stop, haptics and HUD pops,
// plus the player's comfort settings (shake strength, vibration). Visual only: nothing here
// moves the raft or touches collision.

const KEY = 'akinti_feel_v1';
const reducedMotion = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return false; } };

export const SHAKE_STEPS = [
  { v: 1, label: 'TAM' },
  { v: 0.5, label: 'AZ' },
  { v: 0, label: 'KAPALI' },
];

export const feel = {
  shake: reducedMotion() ? 0.5 : 1, // player setting 0..1
  haptics: true,
  trauma: 0,  // 0..1, shake = trauma^2 so light hits barely move and heavy hits punch
  stop: 0,    // hit-stop seconds left (real time)
  _t: 0,

  load() {
    try {
      const d = JSON.parse(localStorage.getItem(KEY) || '{}');
      if (typeof d.shake === 'number') this.shake = Math.min(1, Math.max(0, d.shake));
      if (typeof d.haptics === 'boolean') this.haptics = d.haptics;
    } catch (e) { /* storage unavailable: defaults */ }
  },
  commit() {
    try { localStorage.setItem(KEY, JSON.stringify({ shake: this.shake, haptics: this.haptics })); } catch (e) { /* ignore */ }
  },

  /** hits add trauma, they never reset it */
  addTrauma(a) { this.trauma = Math.min(1, this.trauma + a); },

  /** freeze game time for `sec` real seconds; overlapping calls keep the longest remaining stop */
  hitStop(sec) { this.stop = Math.max(this.stop, Math.min(0.15, sec)); },

  buzz(pattern) {
    if (!this.haptics) return;
    try { navigator.vibrate && navigator.vibrate(pattern); } catch (e) { /* ignore */ }
  },

  /** consume real time; returns the game-time multiplier for this frame (0 while frozen) */
  tick(rdt) {
    if (this.stop <= 0) return 1;
    this.stop = Math.max(0, this.stop - rdt);
    return 0;
  },

  /**
   * Camera offset for this frame. Decays with REAL time so the camera never sticks
   * off-centre during a hit-stop. Summed sines at unrelated rates: smooth, never a per-frame buzz.
   */
  offset(rdt, out) {
    if (this.trauma <= 0) { out.x = 0; out.y = 0; out.roll = 0; return out; }
    this.trauma = Math.max(0, this.trauma - rdt * 1.6);
    this._t += rdt * 30;
    const s = this.trauma * this.trauma * this.shake;
    const t = this._t;
    out.x = 0.42 * s * (Math.sin(t * 1.7) * 0.7 + Math.sin(t * 3.1 + 1.3) * 0.3);
    out.y = 0.30 * s * (Math.sin(t * 2.3 + 0.7) * 0.7 + Math.sin(t * 4.3) * 0.3);
    out.roll = 0.05 * s * Math.sin(t * 1.1 + 2.1);
    if (this.trauma === 0) { out.x = 0; out.y = 0; out.roll = 0; }
    return out;
  },

  reset() { this.trauma = 0; this.stop = 0; },
};

/** restartable overshoot pop on a HUD element (CSS class `bump`) */
export function bump(el, cls = 'bump') {
  if (!el) return;
  el.classList.remove(cls);
  void el.offsetWidth; // restart the animation
  el.classList.add(cls);
}
