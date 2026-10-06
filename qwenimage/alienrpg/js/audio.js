// FM synthesis sound engine: BGM sequencer + sound effects, all generated with
// sine operators (carrier <- modulator <- modulator2), DX-style.

const midiHz = m => 440 * Math.pow(2, (m - 69) / 12);

// ---------------------------------------------------------------- patches
// ratio/index: modulator frequency ratio and modulation index (depth = index * modFreq)
// iA/iD/iS: index envelope (attack, decay, sustain level 0..1)
// a/d/s/r: carrier amplitude envelope
const PATCH = {
  epiano: { ratio: 1, index: 1.6, iA: 0.002, iD: 0.5, iS: 0.15, ratio2: 14, index2: 0.25, a: 0.004, d: 1.4, s: 0.2, r: 0.7, vol: 0.16 },
  bell:   { ratio: 3.5, index: 2.6, iA: 0.001, iD: 1.8, iS: 0.05, a: 0.002, d: 2.6, s: 0, r: 1.5, vol: 0.08 },
  glass:  { ratio: 3.14, index: 3.2, iA: 0.001, iD: 2.5, iS: 0.1, a: 0.002, d: 3.5, s: 0, r: 2, vol: 0.06 },
  pad:    { ratio: 2, index: 0.9, iA: 1.5, iD: 2, iS: 0.6, a: 1.2, d: 2, s: 0.75, r: 2.2, vol: 0.05, detune: 7 },
  flute:  { ratio: 1, index: 0.7, iA: 0.08, iD: 0.4, iS: 0.4, a: 0.08, d: 0.3, s: 0.8, r: 0.35, vol: 0.09, vib: [5.2, 0.006] },
  bass:   { ratio: 1, index: 3.2, iA: 0.002, iD: 0.22, iS: 0.25, a: 0.003, d: 0.35, s: 0.55, r: 0.1, vol: 0.22 },
  drone:  { ratio: 1.005, index: 2.4, iA: 2.5, iD: 3, iS: 0.7, ratio2: 0.5, index2: 0.8, a: 1.5, d: 2, s: 0.85, r: 2.5, vol: 0.13 },
  brass:  { ratio: 1, index: 0.6, iA: 0.07, iD: 0.3, iS: 2.6, a: 0.03, d: 0.4, s: 0.7, r: 0.15, vol: 0.075, detune: 5 },
  lead:   { ratio: 2, index: 1.8, iA: 0.01, iD: 0.25, iS: 0.5, ratio2: 1, index2: 0.6, a: 0.01, d: 0.3, s: 0.7, r: 0.12, vol: 0.075, vib: [6, 0.008] },
  kick:   { ratio: 1, index: 1.5, iA: 0.001, iD: 0.04, iS: 0, a: 0.001, d: 0.28, s: 0, r: 0.05, vol: 0.5, pitch: [3.2, 0.06] },
  snare:  { ratio: 2.71, index: 40, iA: 0.001, iD: 0.12, iS: 0.05, ratio2: 4.13, index2: 18, a: 0.001, d: 0.14, s: 0, r: 0.05, vol: 0.11, pitch: [1.4, 0.03] },
  hat:    { ratio: 1.414, index: 60, iA: 0.001, iD: 0.04, iS: 0.2, ratio2: 2.83, index2: 30, a: 0.001, d: 0.045, s: 0, r: 0.02, vol: 0.03 },
};

// ---------------------------------------------------------------- songs
// Each song is generated bar by bar. emit(patch, midi, step, lengthInSteps, velocity)
const SONGS = {
  forest: {
    bpm: 78, swing: 0.08,
    chords: [[57, 60, 64, 67], [53, 57, 60, 64], [50, 53, 57, 64], [52, 56, 59, 62]],
    bar(e, ch, bar, R) {
      ch.forEach(n => e('pad', n, 0, 16, 0.8));
      e('bass', ch[0] - 24, 0, 6, 1); e('bass', ch[0] - 24, 10, 2, 0.7); e('bass', ch[0] - 12, 12, 3, 0.6);
      const arp = [0, 2, 1, 3, 2, 1];
      for (let s = 0; s < 16; s++) {
        if (R() < (s % 2 ? 0.25 : 0.7)) e('bell', ch[arp[s % arp.length]] + 12 + (R() < 0.2 ? 12 : 0), s, 3, 0.6 + R() * 0.4);
      }
      if (bar % 8 >= 4) {
        const pent = [69, 72, 74, 76, 79, 81];
        for (let s = 0; s < 16; s += 4) if (R() < 0.75) e('flute', pent[Math.floor(R() * pent.length)], s + (R() < 0.3 ? 2 : 0), 3 + Math.floor(R() * 4), 0.9);
      }
    },
  },
  ship: {
    bpm: 58,
    chords: [[48, 51, 55], [49, 53, 56], [48, 51, 55], [47, 50, 53]],
    bar(e, ch, bar, R) {
      e('drone', ch[0] - 24, 0, 16, 1);
      e('pad', ch[1], 0, 16, 0.6); e('pad', ch[2] + 12, 0, 16, 0.4);
      e('kick', 33, 0, 1, 0.55); e('kick', 33, 1.5, 1, 0.35);           // heartbeat
      e('kick', 33, 8, 1, 0.5); e('kick', 33, 9.5, 1, 0.3);
      for (let k = 0; k < 2; k++) if (R() < 0.7) e('glass', ch[Math.floor(R() * 3)] + 25 + (R() < 0.5 ? 12 : 0), Math.floor(R() * 16), 6, 0.7);
      if (bar % 4 === 3) e('epiano', ch[2] + 13, 12, 4, 0.5);
    },
  },
  boss: {
    bpm: 148,
    chords: [[40, 43, 47], [40, 43, 47], [41, 45, 48], [40, 43, 47], [40, 43, 47], [40, 43, 47], [38, 42, 45], [39, 43, 46]],
    bar(e, ch, bar) {
      const r = ch[0];
      const bl = [0, 0, 12, 0, 0, 10, 0, 12];
      for (let s = 0; s < 16; s += 2) e('bass', r - 12 + bl[s / 2], s, 1.6, s % 4 ? 0.75 : 1);
      for (let s = 0; s < 16; s += 4) e('kick', 28, s, 1, 1);
      e('kick', 28, 14, 1, 0.6);
      e('snare', 50, 4, 1, 1); e('snare', 50, 12, 1, 1);
      if (bar % 2) e('snare', 50, 15, 1, 0.5);
      for (let s = 0; s < 16; s += 2) e('hat', 90, s + 1, 1, s % 4 === 2 ? 1 : 0.6);
      ch.forEach(n => { e('brass', n + 12, 0, 3, 1); e('brass', n + 12, 6, 2, 0.8); });
      if (bar % 4 >= 2) {
        const riff = [[0, 76], [3, 77], [6, 76], [8, 74], [10, 71], [12, 72], [14, 71]];
        riff.forEach(([s, n]) => e('lead', n + (r - 40), s, 2, 1));
      }
    },
  },
};

const JINGLES = {
  victory: { bpm: 120, notes: [['brass', [60, 64, 67], 0, 3], ['brass', [62, 65, 69], 3, 3], ['brass', [64, 67, 72], 6, 10],
    ['bell', [84], 6, 8], ['bell', [88], 8, 8], ['bell', [91], 10, 10], ['kick', [36], 6, 1], ['pad', [48, 55, 64], 6, 24]] },
  gameover: { bpm: 70, notes: [['epiano', [64, 67], 0, 4], ['epiano', [63, 66], 4, 4], ['epiano', [62, 65], 8, 4], ['epiano', [57, 60, 64], 12, 16],
    ['drone', [33], 12, 24], ['glass', [88], 13, 8]] },
};

export class Sfx {
  constructor() { this.ctx = null; this.song = null; }

  init() {
    if (this.ctx) return;
    const c = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = c.createGain(); this.master.gain.value = 0.8;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp).connect(c.destination);
    // reverb (decaying noise impulse)
    const len = c.sampleRate * 2.6, ir = c.createBuffer(2, len, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    this.verb = c.createConvolver(); this.verb.buffer = ir;
    this.verbGain = c.createGain(); this.verbGain.gain.value = 0.35;
    this.verb.connect(this.verbGain).connect(this.master);
    this.musicBus = c.createGain(); this.musicBus.gain.value = 0.85;
    this.musicBus.connect(this.master);
    this.musicSend = c.createGain(); this.musicSend.gain.value = 0.6;
    this.musicBus.connect(this.musicSend).connect(this.verb);
    this.sfxBus = c.createGain(); this.sfxBus.gain.value = 0.9;
    this.sfxBus.connect(this.master);
    this.sfxSend = c.createGain(); this.sfxSend.gain.value = 0.25;
    this.sfxBus.connect(this.sfxSend).connect(this.verb);
    setInterval(() => this._schedule(), 50);
  }

  // ------------------------------------------------------------ FM voice
  // p: patch, f: carrier Hz, t: start time, dur: gate length, v: velocity, out: destination
  fm(p, f, t, dur, v = 1, out = this.sfxBus, extra = {}) {
    const c = this.ctx;
    const voices = p.detune ? [-p.detune, p.detune] : [0];
    const end = t + dur + p.r * 1.5 + 0.05;
    for (const cents of voices) {
      const freq = f * Math.pow(2, cents / 1200);
      const car = c.createOscillator(), mod = c.createOscillator(), mg = c.createGain(), amp = c.createGain();
      car.frequency.value = freq;
      mod.frequency.value = freq * p.ratio;
      // pitch envelope (drums / sweeps)
      const sweep = extra.sweep || (p.pitch ? [p.pitch[0], p.pitch[1]] : null);
      if (sweep) {
        car.frequency.setValueAtTime(freq * sweep[0], t);
        car.frequency.exponentialRampToValueAtTime(freq, t + sweep[1]);
        mod.frequency.setValueAtTime(freq * p.ratio * sweep[0], t);
        mod.frequency.exponentialRampToValueAtTime(freq * p.ratio, t + sweep[1]);
      }
      if (extra.glide) {
        car.frequency.exponentialRampToValueAtTime(extra.glide, t + dur);
        mod.frequency.exponentialRampToValueAtTime(extra.glide * p.ratio, t + dur);
      }
      // modulation index envelope
      const depth = (extra.index ?? p.index) * freq * p.ratio;
      mg.gain.setValueAtTime(0, t);
      mg.gain.linearRampToValueAtTime(depth, t + p.iA);
      mg.gain.setTargetAtTime(depth * p.iS, t + p.iA, p.iD / 3);
      mod.connect(mg).connect(car.frequency);
      const nodes = [car, mod];
      if (p.ratio2) {
        const m2 = c.createOscillator(), g2 = c.createGain();
        m2.frequency.value = freq * p.ratio2;
        g2.gain.setValueAtTime(p.index2 * freq * p.ratio2, t);
        g2.gain.setTargetAtTime(0, t, p.iD / 2);
        m2.connect(g2).connect(mod.frequency);
        nodes.push(m2);
      }
      if (p.vib) {
        const lfo = c.createOscillator(), lg = c.createGain();
        lfo.frequency.value = p.vib[0];
        lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(freq * p.vib[1], t + 0.4);
        lfo.connect(lg).connect(car.frequency);
        nodes.push(lfo);
      }
      // amplitude envelope
      const vol = p.vol * v / voices.length;
      amp.gain.setValueAtTime(0, t);
      amp.gain.linearRampToValueAtTime(vol, t + p.a);
      if (p.s > 0) amp.gain.setTargetAtTime(vol * p.s, t + p.a, p.d / 3);
      else amp.gain.setTargetAtTime(0.0001, t + p.a, p.d / 4);
      amp.gain.setTargetAtTime(0, t + Math.max(dur, p.a), p.r / 4);
      car.connect(amp).connect(out);
      for (const n of nodes) { n.start(t); n.stop(end); }
    }
  }

  // ------------------------------------------------------------ BGM sequencer
  setMusic(name) {
    if (!this.ctx || (this.song && this.song.name === name)) return;
    const c = this.ctx;
    if (this.song) {
      const g = this.song.gain;
      g.gain.setTargetAtTime(0, c.currentTime, 0.4);
      setTimeout(() => g.disconnect(), 3000);
    }
    const gain = c.createGain();
    gain.connect(this.musicBus);
    gain.gain.value = 0;
    gain.gain.setTargetAtTime(1, c.currentTime, 0.3);
    if (JINGLES[name]) {
      const J = JINGLES[name], st = 60 / J.bpm / 4, t0 = c.currentTime + 0.1;
      for (const [p, notes, s, l] of J.notes) for (const n of notes) this.fm(PATCH[p], midiHz(n), t0 + s * st, l * st, 1, gain);
      this.song = { name, gain, jingle: true };
      return;
    }
    let seed = 1;
    this.song = { name, gain, def: SONGS[name], bar: 0, next: c.currentTime + 0.15,
      R: () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; } };
  }
  setAmbient(kind) { this.setMusic(kind); }

  _schedule() {
    const s = this.song;
    if (!s || s.jingle) return;
    const c = this.ctx, D = s.def, step = 60 / D.bpm / 4;
    while (s.next < c.currentTime + 0.4) {
      const t0 = s.next, ch = D.chords[s.bar % D.chords.length];
      D.bar((p, n, st, len, v) => {
        const sw = D.swing && Math.floor(st) % 2 ? D.swing * step : 0;
        this.fm(PATCH[p], midiHz(n), t0 + st * step + sw, len * step, v, s.gain);
      }, ch, s.bar, s.R);
      s.bar++;
      s.next += step * 16;
    }
  }

  // ------------------------------------------------------------ sound effects
  _p(base, over) { return Object.assign({}, PATCH[base], over); }
  get now() { return this.ctx.currentTime; }

  shot() {
    if (!this.ctx) return;
    const t = this.now;
    this.fm(this._p('snare', { vol: 0.32, d: 0.16, index: 55 }), 140, t, 0.02, 1);
    this.fm(this._p('kick', { vol: 0.45, d: 0.14, pitch: [4, 0.05] }), 55, t, 0.02, 1);
    this.fm(this._p('hat', { vol: 0.08, d: 0.08 }), 2400, t, 0.01, 1);
  }
  empty() { if (this.ctx) this.fm(this._p('hat', { vol: 0.12, ratio: 3.5, index: 3 }), 1800, this.now, 0.01); }
  reload() {
    if (!this.ctx) return;
    const t = this.now, metal = this._p('hat', { vol: 0.14, ratio: 1.41, index: 8, d: 0.08 });
    this.fm(metal, 900, t, 0.02);
    this.fm(metal, 650, t + 0.35, 0.02);
    this.fm(this._p('snare', { vol: 0.14, index: 6 }), 300, t + 0.4, 0.02);
    this.fm(metal, 1300, t + 0.75, 0.02);
  }
  hit() {
    if (!this.ctx) return;
    this.fm(this._p('snare', { vol: 0.18, ratio: 0.71, index: 12, d: 0.12 }), 180, this.now, 0.03);
  }
  hurt() {
    if (!this.ctx) return;
    const t = this.now;
    this.fm(this._p('kick', { vol: 0.6, d: 0.35, pitch: [2.5, 0.2] }), 50, t, 0.05);
    this.fm(this._p('bass', { vol: 0.2, index: 6, iD: 0.2 }), 70, t, 0.15);
  }
  screech(pitch = 1) {
    if (!this.ctx) return;
    const p = this._p('lead', { ratio: 1.5, index: 5, iD: 0.8, iS: 0.6, ratio2: 2.37, index2: 3, a: 0.04, d: 0.6, s: 0.4, r: 0.25, vol: 0.12, vib: [28, 0.05] });
    this.fm(p, 1100 * pitch, this.now, 0.5, 1, this.sfxBus, { glide: 320 * pitch });
    this.fm(p, 1480 * pitch, this.now + 0.03, 0.45, 0.6, this.sfxBus, { glide: 410 * pitch });
  }
  death() {
    if (!this.ctx) return;
    const p = this._p('lead', { ratio: 0.5, index: 8, iD: 1, iS: 0.4, ratio2: 1.73, index2: 4, a: 0.01, d: 0.8, s: 0.3, r: 0.3, vol: 0.12, vib: [18, 0.04] });
    this.fm(p, 600, this.now, 0.7, 1, this.sfxBus, { glide: 70 });
  }
  pickup() {
    if (!this.ctx) return;
    this.fm(PATCH.bell, midiHz(84), this.now, 0.1, 1.6);
    this.fm(PATCH.bell, midiHz(91), this.now + 0.08, 0.2, 1.6);
  }
  artifact() {
    if (!this.ctx) return;
    [72, 76, 79, 84, 88, 91].forEach((n, i) => this.fm(PATCH.glass, midiHz(n), this.now + i * 0.11, 0.6, 2));
    this.fm(PATCH.pad, midiHz(60), this.now, 2.5, 3);
    this.fm(PATCH.pad, midiHz(67), this.now, 2.5, 3);
  }
  levelup() {
    if (!this.ctx) return;
    [67, 71, 74, 79].forEach((n, i) => this.fm(PATCH.brass, midiHz(n), this.now + i * 0.09, 0.12, 2));
  }
  beep(near) {
    if (!this.ctx) return;
    this.fm(this._p('flute', { vol: 0.05, a: 0.003, d: 0.05, s: 0, r: 0.03, vib: null, index: 0.3 }), near ? 1480 : 1046, this.now, 0.05);
  }
  door() {
    if (!this.ctx) return;
    const p = this._p('drone', { a: 0.15, d: 1, s: 0, r: 0.4, vol: 0.3, iA: 0.1, index: 6 });
    this.fm(p, 55, this.now, 1.0, 1, this.sfxBus, { glide: 41 });
    this.fm(this._p('hat', { vol: 0.1, d: 0.6, index: 20 }), 300, this.now, 0.6);
  }
  spit() {
    if (!this.ctx) return;
    this.fm(this._p('snare', { vol: 0.18, ratio: 1.1, index: 15, d: 0.25 }), 260, this.now, 0.05, 1, this.sfxBus, { sweep: [0.5, 0.2] });
  }
  tickForest(dt) {
    if (!this.ctx || !this.song || this.song.name !== 'forest') return;
    if (Math.random() < dt * 0.35) {
      const f = 3600 + Math.random() * 1400, p = this._p('flute', { vol: 0.018, a: 0.003, d: 0.04, s: 0, r: 0.02, vib: null, index: 1.2, ratio: 2 });
      for (let i = 0; i < 3; i++) this.fm(p, f, this.now + i * 0.07, 0.03);
    }
  }
}
