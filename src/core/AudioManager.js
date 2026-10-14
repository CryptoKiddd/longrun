/**
 * Tiny procedural sound engine on the Web Audio API. No audio files.
 * - Created/resumed only after a user gesture (autoplay policies).
 * - Every call is a no-op if audio is unavailable; the game never depends on it.
 */
export class AudioManager {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.noiseBuffer = null;
    this.engine = null;
    this.muted = false;
    this.volume = 0.7;
    this.orbCombo = 0;
    this.lastOrbTime = 0;
  }

  get available() {
    return !!this.ctx;
  }

  /** Call from a user-gesture handler. Safe to call repeatedly. */
  unlock() {
    try {
      if (!this.ctx) {
        const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
        if (!AC) return;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.connect(this.ctx.destination);
        this.applyVolume();
        this.noiseBuffer = this.makeNoise();
      }
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    } catch {
      this.ctx = null;
    }
  }

  suspend() {
    try {
      if (this.ctx && this.ctx.state === 'running') this.ctx.suspend().catch(() => {});
    } catch {
      /* ignore */
    }
  }

  resume() {
    try {
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
    } catch {
      /* ignore */
    }
  }

  setMuted(m) {
    this.muted = !!m;
    this.applyVolume();
  }

  setVolume(v) {
    this.volume = Math.max(0, Math.min(1, v));
    this.applyVolume();
  }

  applyVolume() {
    if (!this.master) return;
    const target = this.muted ? 0 : this.volume * 0.5;
    this.master.gain.setTargetAtTime(target, this.ctx.currentTime, 0.02);
  }

  makeNoise() {
    const len = Math.floor(this.ctx.sampleRate * 0.6);
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  /** One enveloped oscillator note. */
  tone(freq, dur, { type = 'sine', gain = 0.3, endFreq = 0, delay = 0, attack = 0.005 } = {}) {
    if (!this.ctx || this.muted) return;
    try {
      const t = this.ctx.currentTime + delay;
      const osc = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, t);
      if (endFreq) osc.frequency.exponentialRampToValueAtTime(endFreq, t + dur);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(gain, t + attack);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g).connect(this.master);
      osc.start(t);
      osc.stop(t + dur + 0.02);
    } catch {
      /* ignore */
    }
  }

  noise(dur, { gain = 0.3, filter = 1200, endFilter = 200 } = {}) {
    if (!this.ctx || this.muted || !this.noiseBuffer) return;
    try {
      const t = this.ctx.currentTime;
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      const f = this.ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.setValueAtTime(filter, t);
      f.frequency.exponentialRampToValueAtTime(endFilter, t + dur);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(gain, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      src.connect(f).connect(g).connect(this.master);
      src.start(t);
      src.stop(t + dur);
    } catch {
      /* ignore */
    }
  }

  // ---- game sounds --------------------------------------------------------

  orb() {
    const now = this.ctx ? this.ctx.currentTime : 0;
    this.orbCombo = now - this.lastOrbTime < 0.9 ? Math.min(this.orbCombo + 1, 8) : 0;
    this.lastOrbTime = now;
    const base = 660 * Math.pow(2, this.orbCombo / 12);
    this.tone(base, 0.12, { type: 'triangle', gain: 0.18 });
    this.tone(base * 1.5, 0.16, { type: 'sine', gain: 0.1, delay: 0.04 });
  }

  gate(tier) {
    if (tier === 'PERFECT') {
      this.tone(880, 0.18, { type: 'triangle', gain: 0.2 });
      this.tone(1318.5, 0.28, { type: 'sine', gain: 0.16, delay: 0.07 });
    } else if (tier === 'GOOD') {
      this.tone(740, 0.18, { type: 'triangle', gain: 0.16 });
    } else if (tier === 'OK') {
      this.tone(520, 0.14, { type: 'triangle', gain: 0.12 });
    } else {
      this.tone(220, 0.22, { type: 'square', gain: 0.07, endFreq: 140 });
    }
  }

  jump() {
    this.tone(300, 0.16, { type: 'sine', gain: 0.14, endFreq: 640 });
  }

  land(intensity) {
    this.noise(0.08, { gain: 0.05 + 0.08 * intensity, filter: 600, endFilter: 120 });
  }

  rail() {
    this.tone(180, 0.08, { type: 'square', gain: 0.05 });
  }

  crash() {
    this.noise(0.55, { gain: 0.45, filter: 2400, endFilter: 80 });
    this.tone(110, 0.5, { type: 'sawtooth', gain: 0.16, endFreq: 40 });
  }

  record() {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.tone(f, 0.3, { type: 'triangle', gain: 0.14, delay: 0.1 * i }));
  }

  challenge() {
    this.tone(784, 0.14, { type: 'triangle', gain: 0.14 });
    this.tone(1046.5, 0.22, { type: 'triangle', gain: 0.14, delay: 0.1 });
  }

  click() {
    this.tone(900, 0.05, { type: 'triangle', gain: 0.08 });
  }

  /** Subtle speed-following hum while playing (the game's only "music"). */
  setEngine(active, speed01) {
    if (!this.ctx) return;
    try {
      if (!this.engine) {
        const osc = this.ctx.createOscillator();
        const osc2 = this.ctx.createOscillator();
        const f = this.ctx.createBiquadFilter();
        const g = this.ctx.createGain();
        osc.type = 'sawtooth';
        osc2.type = 'sawtooth';
        f.type = 'lowpass';
        f.frequency.value = 300;
        g.gain.value = 0;
        osc.connect(f);
        osc2.connect(f);
        f.connect(g).connect(this.master);
        osc.start();
        osc2.start();
        this.engine = { osc, osc2, f, g };
      }
      const t = this.ctx.currentTime;
      const e = this.engine;
      const base = 48 + speed01 * 30;
      e.osc.frequency.setTargetAtTime(base, t, 0.2);
      e.osc2.frequency.setTargetAtTime(base * 1.505, t, 0.2);
      e.f.frequency.setTargetAtTime(220 + speed01 * 500, t, 0.2);
      e.g.gain.setTargetAtTime(active ? 0.035 : 0, t, active ? 0.3 : 0.08);
    } catch {
      /* ignore */
    }
  }
}
