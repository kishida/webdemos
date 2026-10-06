// Audio: FM synth nodes, patches, step sequencer, songs and sound effects.
'use strict';

const op = (mul, lvl, ar, dr, sl, rr, dt = 0) => ({ mul, lvl, ar, dr, sl, rr, dt });
const OFF = op(1, 0, 0.01, 0.01, 0, 0.01);

// ---- FM patches ---------------------------------------------------------
const PATCHES = {
  // Lead: two 2-op brass pairs, slightly detuned
  brass: { alg: 4, fb: 5, vol: 0.22, vib: 0.006, ops: [
    op(1, 0.9, 0.04, 0.4, 0.55, 0.12), op(1, 0.75, 0.015, 0.5, 0.8, 0.12),
    op(1, 0.65, 0.05, 0.4, 0.5, 0.12, 0.004), op(1, 0.6, 0.02, 0.5, 0.8, 0.12, 0.004)] },
  // Steam calliope organ: additive, all carriers + wobbly vibrato
  calliope: { alg: 7, fb: 3, vol: 0.11, vib: 0.01, ops: [
    op(1, 0.25, 0.006, 0.3, 0.7, 0.08), op(2, 0.35, 0.006, 0.4, 0.8, 0.08),
    op(4, 0.12, 0.006, 0.2, 0.5, 0.06), op(1, 0.4, 0.006, 0.5, 0.85, 0.09, 0.003)] },
  // Bass: 4-op chain
  bass: { alg: 0, fb: 4, vol: 0.34, ops: [
    op(1, 0.25, 0.005, 0.2, 0.2, 0.05), op(1, 0.45, 0.003, 0.15, 0.15, 0.05),
    op(1, 0.8, 0.002, 0.25, 0.25, 0.05), op(1, 1.0, 0.002, 0.6, 0.6, 0.05)] },
  // Bell for arpeggios / pickups
  bell: { alg: 4, fb: 0, vol: 0.2, ops: [
    op(3.5, 0.9, 0.001, 0.6, 0, 0.3), op(1, 0.8, 0.001, 1.2, 0, 0.4),
    op(7, 0.3, 0.001, 0.3, 0, 0.2), op(2, 0.3, 0.001, 0.8, 0, 0.3)] },
  kick: { alg: 7, fb: 7, vol: 0.9, ops: [
    op(1, 0.15, 0.001, 0.012, 0, 0.01), OFF, OFF, op(1, 1, 0.001, 0.22, 0, 0.05)] },
  snare: { alg: 7, fb: 8.5, vol: 0.5, ops: [
    op(1, 0.7, 0.001, 0.14, 0, 0.06), OFF, OFF, op(1, 0.45, 0.001, 0.07, 0, 0.03)] },
  hat: { alg: 0, fb: 8, vol: 0.18, ops: [
    op(1, 1, 0.001, 0.2, 0.5, 0.1), op(3.17, 2, 0.001, 0.2, 0.5, 0.1),
    op(5.41, 2, 0.001, 0.2, 0.5, 0.1), op(1, 1, 0.001, 0.035, 0, 0.02)] },
  ohat: { alg: 0, fb: 8, vol: 0.14, ops: [
    op(1, 1, 0.001, 0.2, 0.5, 0.1), op(3.17, 2, 0.001, 0.2, 0.5, 0.1),
    op(5.41, 2, 0.001, 0.2, 0.5, 0.1), op(1, 1, 0.001, 0.25, 0, 0.1)] },
  // --- SFX ---
  shot: { alg: 4, fb: 3, vol: 0.18, ops: [
    op(2, 0.6, 0.001, 0.06, 0, 0.02), op(1, 0.8, 0.001, 0.08, 0, 0.02),
    op(3, 0.4, 0.001, 0.05, 0, 0.02), op(1, 0.4, 0.001, 0.07, 0, 0.02)] },
  eshot: { alg: 4, fb: 0, vol: 0.12, ops: [
    op(1.5, 1.2, 0.001, 0.1, 0, 0.03), op(1, 0.8, 0.001, 0.12, 0, 0.03), OFF, OFF] },
  boom: { alg: 0, fb: 9, vol: 0.85, ops: [
    op(1, 1.5, 0.001, 0.7, 0, 0.3), op(0.5, 1.5, 0.001, 0.7, 0, 0.3),
    op(1, 1.2, 0.001, 0.6, 0, 0.3), op(1, 1, 0.001, 0.6, 0, 0.3)] },
  bigboom: { alg: 0, fb: 9, vol: 1.0, ops: [
    op(1, 2, 0.001, 1.6, 0, 0.6), op(0.5, 2, 0.001, 1.5, 0, 0.6),
    op(1, 1.5, 0.001, 1.4, 0, 0.6), op(1, 1, 0.005, 1.8, 0, 0.8)] },
  clank: { alg: 2, fb: 4, vol: 0.3, ops: [
    op(1, 0.8, 0.001, 0.1, 0, 0.05), op(4.7, 1.4, 0.001, 0.12, 0, 0.05),
    op(2.3, 1.2, 0.001, 0.1, 0, 0.05), op(1, 0.9, 0.001, 0.12, 0, 0.05)] },
  whistle: { alg: 4, fb: 8, vol: 0.18, vib: 0.012, ops: [
    op(1, 0.08, 0.05, 0.5, 0.8, 0.2), op(1, 0.6, 0.06, 0.8, 0.9, 0.25),
    op(2, 0.1, 0.06, 0.5, 0.5, 0.2), op(1.5, 0.35, 0.06, 0.8, 0.9, 0.25)] },
  siren: { alg: 4, fb: 6, vol: 0.2, ops: [
    op(1, 1.1, 0.01, 0.3, 0.9, 0.05), op(1, 0.8, 0.01, 0.3, 0.9, 0.05),
    op(2, 0.5, 0.01, 0.3, 0.9, 0.05), op(1, 0.5, 0.01, 0.3, 0.9, 0.05, 0.01)] },
  steam: { alg: 7, fb: 9, vol: 0.3, ops: [
    op(1, 0.6, 0.02, 0.5, 0, 0.2), OFF, OFF, OFF] },
};

// ---- helpers ------------------------------------------------------------
const NOTE_IDX = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
function noteToMidi(n) {
  const m = /^([a-gA-G])([#b]?)(-?\d)$/.exec(n);
  if (!m) throw new Error('bad note ' + n);
  let v = NOTE_IDX[m[1].toLowerCase()] + (m[3] * 12 + 12);
  if (m[2] === '#') v++; else if (m[2] === 'b') v--;
  return v;
}
const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

// Parse "D5 - - . A4 -" (one token per 16th; '-' extends, '.' rest)
function parseLine(str, stepOffset = 0) {
  const ev = []; let cur = null; let step = stepOffset;
  for (const tok of str.trim().split(/\s+/)) {
    if (tok === '-') { if (cur) cur.len++; }
    else if (tok === '.') cur = null;
    else { cur = { step, len: 1, midi: noteToMidi(tok) }; ev.push(cur); }
    step++;
  }
  return { ev, steps: step - stepOffset };
}
function parseBars(bars) {
  const ev = []; let step = 0;
  for (const b of bars) { const r = parseLine(b, step); ev.push(...r.ev); step += r.steps; }
  return ev;
}

const CHORDS = {
  Dm: [62, 65, 69], Bb: [62, 65, 70], C: [60, 64, 67], A: [61, 64, 69], Gm: [62, 67, 70],
  Em: [64, 67, 71], D: [62, 66, 69], B: [63, 66, 71], Am: [64, 69, 72], G: [62, 67, 71],
};
const ROOTS = { Dm: 38, Bb: 34, C: 36, A: 33, Gm: 31, Em: 40, D: 38, B: 35, Am: 33, G: 31 };

// Build accompaniment from half-bar chord list
function accomp(halves, opts) {
  const bass = [], chords = [];
  halves.forEach((name, h) => {
    const base = h * 8; const r = ROOTS[name]; const ch = CHORDS[name];
    for (let i = 0; i < 8; i += opts.bassStep) {
      const oct = opts.bassOct && (i / opts.bassStep) % 2 === 1 ? 12 : 0;
      bass.push({ step: base + i, len: opts.bassStep === 1 ? 1 : opts.bassStep - 1, midi: r + oct });
    }
    for (const s of opts.chordSteps) ch.forEach((m) => chords.push({ step: base + s, len: opts.chordLen, midi: m }));
  });
  return { bass, chords };
}

const DRUM_MAP = { k: ['kick', 150, 0.15, 0.2], s: ['snare', 220, 0.12, 1], h: ['hat', 7000, 0.04, 1], o: ['ohat', 7000, 0.25, 1] };
function parseDrums(bar, nBars) {
  const ev = []; const toks = bar.trim().split(/\s+/);
  for (let b = 0; b < nBars; b++) toks.forEach((t, i) => { for (const c of t) if (DRUM_MAP[c]) ev.push({ step: b * toks.length + i, drum: c }); });
  return ev;
}

// ---- songs --------------------------------------------------------------
function buildStageSong() {
  const halves = [];
  'Dm Bb C A Dm Bb C A Gm Dm Bb A Gm Dm'.split(' ').forEach((c) => halves.push(c, c));
  halves.push('Bb', 'C', 'A', 'A');
  const lead = parseBars([
    'D5 - - . A4 - D5 - F5 - E5 - D5 - C5 -',
    'D5 - - - - - Bb4 - C5 - D5 - F5 - - -',
    'G5 - - . F5 - E5 - C5 - - - E5 - G5 -',
    'A5 - - - - - G5 - F5 - E5 - C#5 - - -',
    'D5 - - . A4 - D5 - F5 - G5 - A5 - - -',
    'Bb5 - - - A5 - G5 - F5 - G5 - A5 - - -',
    'G5 - - . E5 - C5 - G5 - F5 - E5 - C5 -',
    'E5 - - - C#5 - - - A4 - - - - - . .',
    'G4 - Bb4 - D5 - G5 - - - F5 - D5 - Bb4 -',
    'A4 - - - F4 - A4 - D5 - - - C5 - A4 -',
    'Bb4 - D5 - F5 - Bb5 - - - A5 - F5 - D5 -',
    'E5 - - - C#5 - E5 - A5 - - - G5 - E5 -',
    'G5 - - - F5 - D5 - Bb5 - - - A5 - G5 -',
    'F5 - - - E5 - D5 - A5 - - - F5 - D5 -',
    'D5 - F5 - Bb5 - - - C6 - - - Bb5 - G5 -',
    'A5 - - - - - - - C#6 - - - E6 - - -',
  ]);
  const acc = accomp(halves, { bassStep: 2, bassOct: true, chordSteps: [2, 6], chordLen: 2 });
  const drums = parseDrums('k . h . s . h . k . k h s . h o', 16);
  return {
    bpm: 144, steps: 256, tracks: [
      { name: 'bass', patch: 'bass', ev: acc.bass, vel: 1, pan: 0 },
      { name: 'chords', patch: 'calliope', ev: acc.chords, vel: 1, pan: -0.3 },
      { name: 'lead', patch: 'brass', ev: lead, vel: 1, pan: 0.15 },
      { name: 'drums', ev: drums, vel: 1 },
    ],
  };
}

function buildBossSong() {
  const halves = [];
  'Em C D B Em C D B Am Em C B'.split(' ').forEach((c) => halves.push(c, c));
  const riff = [
    'E5 - B4 - E5 - G5 - F#5 - E5 - D5 - B4 -',
    'C5 - E5 - G5 - - - E5 - G5 - C6 - B5 -',
    'A5 - - - F#5 - D5 - A5 - - - B5 - A5 -',
    'B5 - - - - - A5 - G5 - F#5 - D#5 - - -',
  ];
  const lead = parseBars(riff);
  // 16th-note arpeggios for bars 5-12
  const arp = [];
  halves.slice(8).forEach((name, h) => {
    const ch = CHORDS[name]; const seq = [0, 1, 2, 3, 2, 1, 0, 1];
    seq.forEach((k, i) => arp.push({ step: 64 + h * 8 + i, len: 1, midi: (k === 3 ? ch[0] + 12 : ch[k]) + 12 }));
  });
  const lead2 = parseBars(riff.concat([
    'E6 - - - D6 - B5 - G5 - - - A5 - B5 -',
    'C6 - - - B5 - G5 - E5 - - - G5 - A5 -',
    'A5 - - - B5 - C6 - B5 - - - A5 - G5 -',
    'B5 - - - - - - - D#6 - - - F#6 - - -',
  ])).filter((e) => e.step >= 64 && e.step < 128);
  // Am Em C B section melody
  const lead3 = parseBars([
    'A5 - - - C6 - - - E6 - - - D6 - C6 -',
    'B5 - - - G5 - - - E5 - - - G5 - B5 -',
    'C6 - - - E6 - - - G6 - - - E6 - C6 -',
    'B5 - - - - - - - D#6 - - - F#6 - - -',
  ]).map((e) => ({ ...e, step: e.step + 128 }));
  const acc = accomp(halves, { bassStep: 1, bassOct: false, chordSteps: [0, 3, 6], chordLen: 1 });
  acc.bass.forEach((e, i) => { if (i % 4 === 2) e.midi += 12; });
  const drums = parseDrums('k h s h k k s h k h s h k k s s', 12);
  return {
    bpm: 168, steps: 192, tracks: [
      { name: 'bass', patch: 'bass', ev: acc.bass, vel: 0.9, pan: 0 },
      { name: 'chords', patch: 'calliope', ev: acc.chords, vel: 0.8, pan: -0.35 },
      { name: 'lead', patch: 'brass', ev: lead.concat(lead2, lead3), vel: 1, pan: 0.1 },
      { name: 'arp', patch: 'bell', ev: arp, vel: 0.5, pan: 0.4 },
      { name: 'drums', ev: drums, vel: 1 },
    ],
  };
}

function buildJingle(kind) {
  if (kind === 'clear') {
    const lead = parseBars(['D5 - F5 - A5 - D6 - - - C6 - D6 - - -', 'F6 - - - - - - - - - - - . . . .']);
    const ch = [[62, 65, 69, 0, 8], [65, 70, 74, 8, 4], [65, 69, 74, 16, 12]].flatMap(([a, b, c, s, l]) => [a, b, c].map((m) => ({ step: s, len: l, midi: m })));
    return { bpm: 150, steps: 32, once: true, tracks: [
      { patch: 'brass', ev: lead, vel: 1 }, { patch: 'calliope', ev: ch, vel: 1 },
      { patch: 'bass', ev: [{ step: 0, len: 8, midi: 38 }, { step: 8, len: 6, midi: 34 }, { step: 16, len: 12, midi: 38 }], vel: 1 }] };
  }
  // game over
  const lead = parseBars(['A4 - - - G4 - - - F4 - - - E4 - - -', 'D4 - - - - - - - - - - - . . . .']);
  return { bpm: 100, steps: 32, once: true, tracks: [
    { patch: 'calliope', ev: lead, vel: 1.4 },
    { patch: 'bass', ev: [{ step: 0, len: 14, midi: 34 }, { step: 16, len: 14, midi: 38 }], vel: 1 }] };
}

// ---- engine -------------------------------------------------------------
const Audio = {
  ctx: null, music: null, sfx: null, ready: false,
  song: null, songStart: 0, nextStep: 0, timer: null, mute: {},
  musicVol: 0.8, sfxVol: 0.9,

  async init() {
    if (this.ctx) { if (this.ctx.state !== 'running') await this.ctx.resume(); return; }
    const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    const src = fmWorkletMain.toString() + '\nfmWorkletMain();';
    const url = URL.createObjectURL(new Blob([src], { type: 'application/javascript' }));
    await ctx.audioWorklet.addModule(url);
    const mk = (voices) => new AudioWorkletNode(ctx, 'fm-synth', { numberOfInputs: 0, outputChannelCount: [2], processorOptions: { voices } });
    this.music = mk(16); this.sfx = mk(12);
    for (const n of [this.music, this.sfx]) n.port.postMessage({ type: 'patches', patches: PATCHES });

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10; comp.ratio.value = 4;
    comp.connect(ctx.destination);
    this.musicGain = ctx.createGain(); this.musicGain.gain.value = this.musicVol;
    this.sfxGain = ctx.createGain(); this.sfxGain.gain.value = this.sfxVol;
    // simple stereo echo for the music (cavernous factory hall)
    const delay = ctx.createDelay(1); delay.delayTime.value = 60 / 144 * 0.75;
    const fb = ctx.createGain(); fb.gain.value = 0.28;
    const wet = ctx.createGain(); wet.gain.value = 0.22;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2500;
    this.music.connect(this.musicGain);
    this.musicGain.connect(comp);
    this.musicGain.connect(delay); delay.connect(lp); lp.connect(fb); fb.connect(delay); lp.connect(wet); wet.connect(comp);
    this.sfx.connect(this.sfxGain); this.sfxGain.connect(comp);
    this.ready = true;
  },

  note(node, patch, freq, t, dur, vel = 1, pan = 0, sweep = 0) {
    if (!this.ready) return;
    node.port.postMessage({ type: 'note', patch, freq, t, dur, vel, pan, sweep });
  },

  // ---- sequencer ----
  play(song, mute = {}) {
    if (!this.ready) return;
    this.stopMusic(true);
    this.song = song; this.mute = mute;
    this.stepDur = 60 / song.bpm / 4;
    this.songStart = this.ctx.currentTime + 0.08; this.nextStep = 0;
    this.timer = setInterval(() => this.schedule(), 25);
    this.schedule();
  },
  stopMusic(hard) {
    if (this.timer) clearInterval(this.timer);
    this.timer = null; this.song = null;
    if (this.music) this.music.port.postMessage({ type: hard ? 'hush' : 'stop' });
  },
  schedule() {
    const s = this.song; if (!s) return;
    const ahead = this.ctx.currentTime + 0.15;
    while (this.songStart + this.nextStep * this.stepDur < ahead) {
      const abs = this.nextStep; const step = abs % s.steps;
      if (s.once && abs >= s.steps) { clearInterval(this.timer); this.timer = null; this.song = null; return; }
      const t = this.songStart + abs * this.stepDur;
      for (const tr of s.tracks) {
        if (this.mute[tr.name]) continue;
        if (!tr.byStep) { tr.byStep = {}; for (const e of tr.ev) (tr.byStep[e.step] ||= []).push(e); }
        const evs = tr.byStep[step]; if (!evs) continue;
        for (const e of evs) {
          if (e.drum) {
            const [p, f, d, sw] = DRUM_MAP[e.drum];
            this.note(this.music, p, f, t, d, tr.vel, e.drum === 'h' ? 0.25 : 0, sw === 1 ? 0 : sw);
          } else {
            this.note(this.music, tr.patch, mtof(e.midi), t, e.len * this.stepDur * 0.92, tr.vel, tr.pan || 0);
          }
        }
      }
      this.nextStep++;
    }
  },

  // ---- sound effects ----
  sfxPlay(name, x) {
    if (!this.ready) return;
    const t = this.ctx.currentTime + 0.005; const S = this.sfx;
    const pan = x == null ? 0 : Math.max(-0.8, Math.min(0.8, (x / 960) * 1.6 - 0.8));
    switch (name) {
      case 'shot': this.note(S, 'shot', 1800 + Math.random() * 200, t, 0.07, 0.6, pan, 0.35); break;
      case 'eshot': this.note(S, 'eshot', 700, t, 0.12, 0.6, pan, 1.8); break;
      case 'hit': this.note(S, 'clank', 900 + Math.random() * 300, t, 0.05, 0.4, pan); break;
      case 'boom': this.note(S, 'boom', 200, t, 0.5, 1, pan, 0.25); break;
      case 'bigboom':
        this.note(S, 'bigboom', 120, t, 1.4, 1, pan, 0.2);
        this.note(S, 'boom', 300, t + 0.15, 0.6, 0.8, -pan, 0.2);
        this.note(S, 'boom', 180, t + 0.35, 0.6, 0.8, pan, 0.2); break;
      case 'damage':
        this.note(S, 'clank', 500, t, 0.25, 1, pan, 0.4);
        this.note(S, 'boom', 160, t, 0.5, 0.9, pan, 0.3); break;
      case 'power':
        [0, 4, 7, 12, 16].forEach((n, i) => this.note(S, 'bell', mtof(76 + n), t + i * 0.05, 0.25, 0.8, pan)); break;
      case 'bomb':
        this.note(S, 'steam', 2000, t, 0.9, 1, 0, 0.3);
        this.note(S, 'bigboom', 90, t, 1.2, 0.8, 0, 0.3); break;
      case 'whistle':
        this.note(S, 'whistle', mtof(81), t, 0.5, 1, 0); this.note(S, 'whistle', mtof(85), t, 0.5, 0.8, 0);
        this.note(S, 'whistle', mtof(81), t + 0.6, 0.9, 1, 0); this.note(S, 'whistle', mtof(85), t + 0.6, 0.9, 0.8, 0); break;
      case 'warning':
        for (let i = 0; i < 6; i++) this.note(S, 'siren', i % 2 ? 660 : 880, t + i * 0.35, 0.33, 0.8, 0, i % 2 ? 1.33 : 0.75); break;
      case 'extend':
        [0, 7, 12, 19, 24].forEach((n, i) => this.note(S, 'bell', mtof(72 + n), t + i * 0.08, 0.4, 0.9, 0)); break;
      case 'select': this.note(S, 'bell', mtof(84), t, 0.15, 0.7, 0); break;
    }
  },
};

const SONGS = {};
function getSong(name) {
  if (!SONGS[name]) SONGS[name] = name === 'stage' ? buildStageSong() : name === 'boss' ? buildBossSong() : buildJingle(name);
  return SONGS[name];
}
