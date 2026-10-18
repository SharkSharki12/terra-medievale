// Petits effets sonores synthétisés (aucun fichier audio nécessaire)
export class Sfx {
  constructor() { this.ctx = null; this.on = true; }
  ensure() {
    if (!this.ctx) {
      try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch { this.on = false; }
    }
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    return this.ctx;
  }
  tone(freq, dur, type = 'sine', vol = 0.15, when = 0, slide = 0) {
    const c = this.ctx;
    const t = c.currentTime + when;
    const o = c.createOscillator(), g = c.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(c.destination);
    o.start(t); o.stop(t + dur + 0.05);
  }
  noise(dur, vol = 0.2, when = 0, freq = 900) {
    const c = this.ctx;
    const t = c.currentTime + when;
    const len = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const s = c.createBufferSource(); s.buffer = buf;
    const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq;
    const g = c.createGain(); g.gain.value = vol;
    s.connect(f).connect(g).connect(c.destination);
    s.start(t);
  }
  play(name) {
    if (!this.on || !this.ensure()) return;
    switch (name) {
      case 'click': this.tone(660, 0.06, 'triangle', 0.08); break;
      case 'tick': this.tone(420, 0.04, 'square', 0.03); break;
      case 'build': this.noise(0.18, 0.35, 0, 500); this.tone(140, 0.15, 'triangle', 0.2, 0, -60); this.noise(0.12, 0.2, 0.12, 1200); break;
      case 'demolish': this.noise(0.35, 0.35, 0, 400); this.tone(90, 0.3, 'sawtooth', 0.08, 0, -40); break;
      case 'error': this.tone(180, 0.15, 'square', 0.06); this.tone(140, 0.2, 'square', 0.06, 0.1); break;
      case 'coin': this.tone(988, 0.08, 'square', 0.05); this.tone(1319, 0.25, 'square', 0.05, 0.08); break;
      case 'reward': [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.25, 'triangle', 0.12, i * 0.09)); break;
      case 'bad': this.tone(300, 0.3, 'sawtooth', 0.05, 0, -120); break;
      case 'rankup': {
        const seq = [392, 523, 659, 784, 659, 784, 1047];
        seq.forEach((f, i) => { this.tone(f, 0.32, 'triangle', 0.13, i * 0.14); this.tone(f / 2, 0.32, 'sine', 0.08, i * 0.14); });
        break;
      }
      case 'found': [262, 330, 392, 523].forEach((f, i) => this.tone(f, 0.6, 'triangle', 0.12, i * 0.16)); break;
    }
  }
}
