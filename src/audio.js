// Procedural WebAudio: river ambience, rain, wind + short effects. No asset files.
export class Sound {
  constructor() {
    this.ctx = null;
    this.muted = false;
    try { this.muted = localStorage.getItem('akinti_mute') === '1'; } catch (e) { /* storage unavailable */ }
  }

  init() {
    try {
      if (this.ctx) { if (this.ctx.state !== 'running') this.ctx.resume(); return; }
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = (this.ctx = new AC());
      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.85;
      const comp = ctx.createDynamicsCompressor();
      this.master.connect(comp).connect(ctx.destination);
      const len = ctx.sampleRate * 2;
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      let b0 = 0, b1 = 0, b2 = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        b0 = 0.99765 * b0 + w * 0.099046; b1 = 0.963 * b1 + w * 0.2965164; b2 = 0.57 * b2 + w * 1.0526913;
        d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.2;
      }
      this.noise = buf;
      this.river = this.loop('lowpass', 620, 0.8);
      this.rapids = this.loop('bandpass', 1600, 1.2);
      this.rain = this.loop('highpass', 1500, 0.4);
      this.wind = this.loop('bandpass', 420, 2.5);
    } catch (e) { this.ctx = null; }
  }

  loop(type, freq, q) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise; src.loop = true;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(); g.gain.value = 0;
    src.connect(f).connect(g).connect(this.master);
    src.start(0, Math.random() * 1.5);
    return { src, f, g };
  }

  setMuted(m) {
    this.muted = m;
    try { localStorage.setItem('akinti_mute', m ? '1' : '0'); } catch (e) { /* ignore */ }
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.85, this.ctx.currentTime, 0.05);
  }

  ambience(speed, rain, wind, active) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const k = active ? 1 : 0.55;
    this.river.g.gain.setTargetAtTime(0.16 * k, t, 0.3);
    this.river.f.frequency.setTargetAtTime(500 + speed * 18, t, 0.3);
    this.rapids.g.gain.setTargetAtTime(active ? Math.min(0.1, speed * 0.0028) : 0.015, t, 0.3);
    this.rain.g.gain.setTargetAtTime(rain * 0.2, t, 0.5);
    this.wind.g.gain.setTargetAtTime(wind * 0.12, t, 0.6);
    this.wind.f.frequency.setTargetAtTime(380 + Math.sin(t * 0.7) * 120, t, 0.5);
  }

  tone(freq, dur, type = 'sine', vol = 0.2, slide = null, delay = 0) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  hiss(dur, type, f0, f1, vol, delay = 0, q = 1) {
    if (!this.ctx || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime + delay;
    const src = ctx.createBufferSource(); src.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.03, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random()); src.stop(t + dur + 0.05);
  }

  coin(combo = 0) {
    const b = 988 * Math.pow(1.06, Math.min(combo, 12));
    this.tone(b, 0.09, 'triangle', 0.12);
    this.tone(b * 1.5, 0.14, 'triangle', 0.1, null, 0.055);
  }
  near(n) {
    this.hiss(0.32, 'bandpass', 600, 2800, 0.28, 0, 1.5);
    this.tone(523 * Math.pow(1.12, Math.min(n, 8)), 0.16, 'square', 0.05, null, 0.04);
  }
  wave(s) { this.hiss(0.28 + s * 0.2, 'bandpass', 1500 + s * 900, 420, 0.07 + s * 0.08, 0, 0.7); }
  erupt(k = 1) { this.hiss(0.9, 'bandpass', 700, 2200, 0.18 + 0.3 * k, 0, 0.6); this.hiss(1.2, 'lowpass', 400, 60, 0.25 * k, 0.05, 0.5); }
  splash() { this.hiss(0.35, 'bandpass', 2400, 700, 0.22, 0, 0.8); }
  /** each vessel sinks with its own sound (raft | rib | sail | yacht | ship | sub) */
  crash(kind = 'raft') {
    this.hiss(0.9, 'lowpass', 2600, 200, 0.7);
    this.tone(110, 0.55, 'sine', 0.55, 38);
    this.tone(70, 0.7, 'triangle', 0.3, 30, 0.05);
    if (kind === 'raft') { this.tone(330, 0.18, 'triangle', 0.12, 160, 0.1); this.hiss(0.5, 'bandpass', 1800, 600, 0.3, 0.35); }   // flip + slap
    else if (kind === 'rib') { this.tone(180, 0.6, 'sawtooth', 0.08, 60, 0.02); this.hiss(0.6, 'highpass', 2600, 1200, 0.2, 0.1); } // engine dies, skid
    else if (kind === 'sail') { this.hiss(1.2, 'bandpass', 900, 300, 0.25, 0.2, 0.6); this.tone(240, 0.4, 'triangle', 0.08, 180, 0.15); } // sail flaps into the water
    else if (kind === 'yacht') { this.hiss(0.5, 'highpass', 3400, 1500, 0.3); this.tone(520, 0.25, 'square', 0.05, 200, 0.05); this.hiss(0.6, 'lowpass', 1400, 200, 0.45, 0.45); } // crack + second splash
    else if (kind === 'ship') { this.tone(55, 1.6, 'sawtooth', 0.12, 32, 0.1); this.tone(82, 1.2, 'triangle', 0.1, 60, 0.4); this.hiss(1.6, 'lowpass', 600, 80, 0.4, 0.3, 0.5); } // hull groan
    else if (kind === 'sub') { for (let i = 0; i < 6; i++) this.tone(300 + i * 90, 0.08, 'sine', 0.08, 900 + i * 120, 0.15 + i * 0.09); this.tone(48, 1.3, 'sine', 0.25, 30, 0.1); } // bubbles + pressure
  }
  shieldBreak() { this.hiss(0.4, 'highpass', 3000, 900, 0.3); this.tone(880, 0.3, 'sine', 0.15, 220); }
  pickup() { [523, 659, 784, 1046].forEach((f, i) => this.tone(f, 0.16, 'triangle', 0.12, null, i * 0.06)); }
  biome() { [392, 523, 659, 784].forEach((f, i) => this.tone(f, 0.5, 'sine', 0.09, null, i * 0.11)); }
  thunder(delay) {
    this.hiss(2.6, 'lowpass', 900, 60, 0.75, delay, 0.5);
    this.hiss(1.4, 'lowpass', 300, 50, 0.5, delay + 0.25, 0.5);
  }
  click() { this.tone(660, 0.06, 'triangle', 0.08); }
  buy() { [784, 988, 1175, 1568, 1976].forEach((f, i) => this.tone(f, 0.14, 'square', 0.05, null, i * 0.05)); this.tone(1046, 0.5, 'sine', 0.1, null, 0.25); }
  deny() { this.tone(220, 0.12, 'square', 0.06); this.tone(180, 0.16, 'square', 0.06, null, 0.1); }
}
