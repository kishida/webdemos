// FM audio engine: patch library, step sequencer, song helpers and SFX presets.
// Requires fm-worklet.js to be loaded first (defines fmWorkletMain).
// Exposes a single global: FM
'use strict';

(function () {
  const op = (mul, lvl, ar, dr, sl, rr, dt = 0) => ({ mul, lvl, ar, dr, sl, rr, dt });
  const OFF = op(1, 0, 0.01, 0.01, 0, 0.01);

  // ---- patch library ------------------------------------------------------
  // alg: YM2612 algorithm 0-7 / fb: op1 self-feedback (7 = buzzy, 8-9 = noise)
  // op(mul, lvl, ar, dr, sl, rr, dt): lvl = amplitude for carriers, mod index (x PI rad) for modulators
  const PATCHES = {
    brass: { alg: 4, fb: 5, vol: 0.22, vib: 0.006, ops: [
      op(1, 0.9, 0.04, 0.4, 0.55, 0.12), op(1, 0.75, 0.015, 0.5, 0.8, 0.12),
      op(1, 0.65, 0.05, 0.4, 0.5, 0.12, 0.004), op(1, 0.6, 0.02, 0.5, 0.8, 0.12, 0.004)] },
    organ: { alg: 7, fb: 3, vol: 0.11, vib: 0.01, ops: [
      op(1, 0.25, 0.006, 0.3, 0.7, 0.08), op(2, 0.35, 0.006, 0.4, 0.8, 0.08),
      op(4, 0.12, 0.006, 0.2, 0.5, 0.06), op(1, 0.4, 0.006, 0.5, 0.85, 0.09, 0.003)] },
    epiano: { alg: 4, fb: 0, vol: 0.2, ops: [
      op(14, 0.25, 0.001, 0.3, 0, 0.2), op(1, 0.8, 0.002, 1.5, 0.2, 0.3),
      op(1, 0.5, 0.001, 1.0, 0.1, 0.3, 0.002), op(1, 0.6, 0.002, 1.8, 0.25, 0.3, 0.002)] },
    strings: { alg: 5, fb: 2, vol: 0.12, vib: 0.008, ops: [
      op(1, 0.5, 0.3, 1, 0.8, 0.4), op(1, 0.6, 0.25, 1, 0.9, 0.5, 0.003),
      op(2, 0.3, 0.25, 1, 0.9, 0.5, -0.003), op(1, 0.6, 0.25, 1, 0.9, 0.5)] },
    lead: { alg: 0, fb: 6, vol: 0.18, vib: 0.008, ops: [
      op(1, 0.3, 0.005, 0.3, 0.6, 0.1), op(2, 0.4, 0.005, 0.3, 0.6, 0.1),
      op(1, 0.6, 0.005, 0.3, 0.7, 0.1), op(1, 1, 0.005, 0.5, 0.85, 0.12)] },
    bass: { alg: 0, fb: 4, vol: 0.34, ops: [
      op(1, 0.25, 0.005, 0.2, 0.2, 0.05), op(1, 0.45, 0.003, 0.15, 0.15, 0.05),
      op(1, 0.8, 0.002, 0.25, 0.25, 0.05), op(1, 1.0, 0.002, 0.6, 0.6, 0.05)] },
    slapbass: { alg: 4, fb: 5, vol: 0.32, ops: [
      op(1, 1.2, 0.001, 0.08, 0.1, 0.05), op(1, 1, 0.001, 0.4, 0.4, 0.05),
      op(3, 0.6, 0.001, 0.05, 0, 0.05), op(0.5, 0.6, 0.001, 0.5, 0.4, 0.05)] },
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
    tom: { alg: 7, fb: 5, vol: 0.6, ops: [
      op(1, 0.1, 0.001, 0.02, 0, 0.01), OFF, OFF, op(1, 1, 0.001, 0.3, 0, 0.08)] },
    // --- SFX building blocks ---
    zap: { alg: 4, fb: 3, vol: 0.18, ops: [
      op(2, 0.6, 0.001, 0.06, 0, 0.02), op(1, 0.8, 0.001, 0.08, 0, 0.02),
      op(3, 0.4, 0.001, 0.05, 0, 0.02), op(1, 0.4, 0.001, 0.07, 0, 0.02)] },
    blip: { alg: 4, fb: 0, vol: 0.12, ops: [
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
    noise: { alg: 7, fb: 9, vol: 0.3, ops: [op(1, 0.6, 0.02, 0.5, 0, 0.2), OFF, OFF, OFF] },
  };

  // ---- pitch / notation helpers --------------------------------------------
  const NOTE_IDX = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
  function noteToMidi(n) {
    if (typeof n === 'number') return n;
    const m = /^([a-gA-G])([#b]?)(-?\d)$/.exec(n);
    if (!m) throw new Error('bad note ' + n);
    let v = NOTE_IDX[m[1].toLowerCase()] + (Number(m[3]) * 12 + 12);
    if (m[2] === '#') v++; else if (m[2] === 'b') v--;
    return v;
  }
  const mtof = (m) => 440 * Math.pow(2, (noteToMidi(m) - 69) / 12);

  // "D5 - - . A4 -": one token per step; '-' extends the previous note, '.' is a rest
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
  // Array of bar strings -> events. Warns when a bar has the wrong number of steps.
  function parseBars(bars, stepsPerBar = 16, stepOffset = 0) {
    const ev = []; let step = stepOffset;
    bars.forEach((b, i) => {
      const r = parseLine(b, step);
      if (stepsPerBar && r.steps !== stepsPerBar) console.warn(`FM.parseBars: bar ${i + 1} has ${r.steps} steps (expected ${stepsPerBar}): ${b}`);
      ev.push(...r.ev); step += r.steps;
    });
    return ev;
  }

  // Chord symbols: C, Cm, C7, Cm7, Cmaj7, Cdim, Caug, Csus4, Cadd9, with # / b roots
  const QUALITY = { '': [0, 4, 7], m: [0, 3, 7], '7': [0, 4, 7, 10], m7: [0, 3, 7, 10], maj7: [0, 4, 7, 11],
    dim: [0, 3, 6], aug: [0, 4, 8], sus4: [0, 5, 7], sus2: [0, 2, 7], add9: [0, 4, 7, 14], m7b5: [0, 3, 6, 10] };
  function chord(sym, low = 60, high = 72) {
    const m = /^([A-G])([#b]?)(.*)$/.exec(sym);
    if (!m || !QUALITY[m[3]]) throw new Error('bad chord ' + sym);
    let root = NOTE_IDX[m[1].toLowerCase()] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
    root = ((root % 12) + 12) % 12;
    // close voicing folded into [low, high)
    return QUALITY[m[3]].map((iv) => { let n = 48 + root + iv; while (n < low) n += 12; while (n >= high + 12) n -= 12; return n; }).sort((a, b) => a - b);
  }
  const chordRoot = (sym, octave = 2) => noteToMidi(sym.match(/^[A-G][#b]?/)[0] + octave);

  // Bass + chord accompaniment from a list of chord symbols, one per `unit` steps.
  // opts: { unit=16, bassStep=2, bassOct=true, bassOctave=2, chordSteps=[4,12], chordLen=2, low=60, high=72 }
  function accomp(chords, opts = {}) {
    const o = { unit: 16, bassStep: 2, bassOct: true, bassOctave: 2, chordSteps: [4, 12], chordLen: 2, low: 60, high: 72, ...opts };
    const bass = [], pads = [];
    chords.forEach((sym, i) => {
      const base = i * o.unit; const r = chordRoot(sym, o.bassOctave); const ch = chord(sym, o.low, o.high);
      for (let s = 0; s < o.unit; s += o.bassStep) {
        const oct = o.bassOct && (s / o.bassStep) % 2 === 1 ? 12 : 0;
        bass.push({ step: base + s, len: Math.max(1, o.bassStep - 1), midi: r + oct });
      }
      for (const s of o.chordSteps) if (s < o.unit) ch.forEach((m) => pads.push({ step: base + s, len: o.chordLen, midi: m }));
    });
    return { bass, chords: pads };
  }
  // Arpeggio over chord symbols: pattern indexes chord tones (index >= tones wraps up an octave)
  function arpeggio(chords, { unit = 16, pattern = [0, 1, 2, 3, 2, 1], octave = 12, low = 60, high = 72, stepOffset = 0 } = {}) {
    const ev = [];
    chords.forEach((sym, i) => {
      const ch = chord(sym, low, high);
      for (let s = 0; s < unit; s++) {
        const k = pattern[s % pattern.length];
        ev.push({ step: stepOffset + i * unit + s, len: 1, midi: ch[k % ch.length] + 12 * Math.floor(k / ch.length) + octave });
      }
    });
    return ev;
  }

  // Drum pattern string per bar: "k . h . s . h ." (k kick, s snare, h hat, o open hat, t tom; combine like "kh")
  const DRUM_MAP = { k: ['kick', 150, 0.15, 0.2], s: ['snare', 220, 0.12, 0], h: ['hat', 7000, 0.04, 0],
    o: ['ohat', 7000, 0.25, 0], t: ['tom', 180, 0.3, 0.5] };
  function parseDrums(bar, nBars = 1, stepOffset = 0) {
    const ev = []; const toks = bar.trim().split(/\s+/);
    for (let b = 0; b < nBars; b++) toks.forEach((t, i) => { for (const c of t) if (DRUM_MAP[c]) ev.push({ step: stepOffset + b * toks.length + i, drum: c }); });
    return ev;
  }

  // ---- SFX presets: [patch, Hz|'A4', delay(s), dur(s), vel, sweep, panSign] --------
  const SFX = {
    shot: [['zap', 1900, 0, 0.07, 0.6, 0.35]],
    laser: [['zap', 2400, 0, 0.18, 0.6, 0.15]],
    eshot: [['blip', 700, 0, 0.12, 0.6, 1.8]],
    hit: [['clank', 1000, 0, 0.05, 0.4, 0]],
    explosion: [['boom', 200, 0, 0.5, 1, 0.25]],
    bigexplosion: [['bigboom', 120, 0, 1.4, 1, 0.2], ['boom', 300, 0.15, 0.6, 0.8, 0.2, -1], ['boom', 180, 0.35, 0.6, 0.8, 0.2]],
    damage: [['clank', 500, 0, 0.25, 1, 0.4], ['boom', 160, 0, 0.5, 0.9, 0.3]],
    powerup: [0, 4, 7, 12, 16].map((n, i) => ['bell', mtof(76 + n), i * 0.05, 0.25, 0.8, 0]),
    coin: [['bell', 'B5', 0, 0.06, 0.8, 0], ['bell', 'E6', 0.06, 0.35, 0.8, 0]],
    jump: [['blip', 300, 0, 0.18, 0.7, 2.5]],
    extend: [0, 7, 12, 19, 24].map((n, i) => ['bell', mtof(72 + n), i * 0.08, 0.4, 0.9, 0]),
    select: [['bell', 'C6', 0, 0.15, 0.7, 0]],
    cancel: [['blip', 500, 0, 0.12, 0.6, 0.5]],
    warning: [0, 1, 2, 3, 4, 5].map((i) => ['siren', i % 2 ? 660 : 880, i * 0.35, 0.33, 0.8, i % 2 ? 1.33 : 0.75]),
    whistle: [['whistle', 'A5', 0, 0.5, 1, 0], ['whistle', 'C#6', 0, 0.5, 0.8, 0], ['whistle', 'A5', 0.6, 0.9, 1, 0], ['whistle', 'C#6', 0.6, 0.9, 0.8, 0]],
    steam: [['noise', 2000, 0, 0.9, 1, 0.3]],
    bomb: [['noise', 2000, 0, 0.9, 1, 0.3], ['bigboom', 90, 0, 1.2, 0.8, 0.3]],
  };

  // ---- engine ---------------------------------------------------------------
  const FM = {
    op, OFF, PATCHES, SFX, DRUM_MAP,
    noteToMidi, mtof, parseLine, parseBars, chord, chordRoot, accomp, arpeggio, parseDrums,
    ctx: null, music: null, sfx: null, ready: false, musicVol: 0.8, sfxVol: 0.9, muted: false,
    song: null, mute: {}, timer: null, onSongEnd: null,

    // Call from a user gesture (keydown / pointerdown). Safe to call repeatedly.
    async init({ musicVoices = 16, sfxVoices = 12, echo = 0.22, echoTime = 0.31 } = {}) {
      if (this.ctx) { if (this.ctx.state !== 'running') await this.ctx.resume(); return; }
      if (typeof fmWorkletMain !== 'function') throw new Error('load fm-worklet.js before fm-audio.js');
      const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
      // Blob URL so this works from file:// too
      const url = URL.createObjectURL(new Blob([fmWorkletMain.toString() + '\nfmWorkletMain();'], { type: 'application/javascript' }));
      await ctx.audioWorklet.addModule(url);
      const mk = (voices) => new AudioWorkletNode(ctx, 'fm-synth', { numberOfInputs: 0, outputChannelCount: [2], processorOptions: { voices } });
      this.music = mk(musicVoices); this.sfx = mk(sfxVoices);
      this.addPatches(PATCHES);
      const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -10; comp.ratio.value = 4; comp.connect(ctx.destination);
      this.musicGain = ctx.createGain(); this.musicGain.gain.value = this.musicVol;
      this.sfxGain = ctx.createGain(); this.sfxGain.gain.value = this.sfxVol;
      this.music.connect(this.musicGain); this.musicGain.connect(comp);
      this.sfx.connect(this.sfxGain); this.sfxGain.connect(comp);
      if (echo > 0) {
        const d = ctx.createDelay(2); d.delayTime.value = echoTime;
        const fb = ctx.createGain(); fb.gain.value = 0.28; const wet = ctx.createGain(); wet.gain.value = echo;
        const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2500;
        this.musicGain.connect(d); d.connect(lp); lp.connect(fb); fb.connect(d); lp.connect(wet); wet.connect(comp);
        this.echoDelay = d;
      }
      this.ready = true;
    },

    addPatches(patches) {
      Object.assign(PATCHES, patches);
      for (const n of [this.music, this.sfx]) if (n) n.port.postMessage({ type: 'patches', patches });
    },

    // Low-level note. target: 'music' | 'sfx'. freq: Hz (number) or note name ('A4').
    note(target, patch, freq, { t, dur = 0.2, vel = 1, pan = 0, sweep = 0 } = {}) {
      if (!this.ready) return;
      const node = target === 'music' ? this.music : this.sfx;
      const f = typeof freq === 'number' ? freq : mtof(freq); // number = Hz, string = note name
      node.port.postMessage({ type: 'note', patch, freq: f, t: t == null ? this.ctx.currentTime + 0.005 : t, dur, vel, pan, sweep });
    },

    // Play an SFX preset (or an inline array of steps). x/width give stereo position.
    play_sfx(name, { x, width = 960, vel = 1 } = {}) {
      if (!this.ready) return;
      const steps = typeof name === 'string' ? SFX[name] : name;
      if (!steps) { console.warn('FM: unknown sfx ' + name); return; }
      const pan = x == null ? 0 : Math.max(-0.8, Math.min(0.8, (x / width) * 1.6 - 0.8));
      const t0 = this.ctx.currentTime + 0.005;
      for (const [patch, f, delay, dur, v, sweep, panSign = 1] of steps)
        this.note('sfx', patch, f, { t: t0 + delay, dur, vel: v * vel, pan: pan * panSign, sweep });
    },
    defineSfx(name, steps) { SFX[name] = steps; },

    // ---- sequencer ----
    // song: { bpm, steps, stepsPerBeat=4, once=false, tracks:[{ name, patch, ev, vel=1, pan=0 }] }
    play(song, { mute = {} } = {}) {
      if (!this.ready) return;
      this.stop(true);
      this.song = song; this.mute = mute;
      this.stepDur = 60 / song.bpm / (song.stepsPerBeat || 4);
      if (this.echoDelay) this.echoDelay.delayTime.value = Math.min(2, this.stepDur * 3);
      for (const tr of song.tracks) { tr.byStep = {}; for (const e of tr.ev) (tr.byStep[e.step] ||= []).push(e); }
      this.songStart = this.ctx.currentTime + 0.08; this.nextStep = 0;
      this.timer = setInterval(() => this._schedule(), 25);
      this._schedule();
    },
    stop(hard = false) {
      if (this.timer) clearInterval(this.timer);
      this.timer = null; this.song = null;
      if (this.music) this.music.port.postMessage({ type: hard ? 'hush' : 'stop' });
    },
    setMute(mute) { this.mute = mute; },
    _schedule() {
      const s = this.song; if (!s) return;
      const ahead = this.ctx.currentTime + 0.15;
      while (this.songStart + this.nextStep * this.stepDur < ahead) {
        const abs = this.nextStep;
        if (s.once && abs >= s.steps) { clearInterval(this.timer); this.timer = null; this.song = null; if (this.onSongEnd) this.onSongEnd(s); return; }
        const step = abs % s.steps; const t = this.songStart + abs * this.stepDur;
        for (const tr of s.tracks) {
          if (this.mute[tr.name]) continue;
          const evs = tr.byStep[step]; if (!evs) continue;
          for (const e of evs) {
            if (e.drum) {
              const [p, f, d, sw] = DRUM_MAP[e.drum];
              this.note('music', p, f, { t, dur: d, vel: (tr.vel ?? 1) * (e.vel ?? 1), pan: e.drum === 'h' ? 0.25 : 0, sweep: sw });
            } else {
              this.note('music', e.patch || tr.patch, mtof(e.midi), { t, dur: e.len * this.stepDur * 0.92, vel: (tr.vel ?? 1) * (e.vel ?? 1), pan: tr.pan || 0 });
            }
          }
        }
        this.nextStep++;
      }
    },

    // ---- mixer ----
    setVolume({ music, sfx } = {}) {
      if (music != null) this.musicVol = music; if (sfx != null) this.sfxVol = sfx;
      if (this.ready && !this.muted) { this.musicGain.gain.value = this.musicVol; this.sfxGain.gain.value = this.sfxVol; }
    },
    toggleMute() {
      this.muted = !this.muted; if (!this.ready) return this.muted;
      this.musicGain.gain.value = this.muted ? 0 : this.musicVol; this.sfxGain.gain.value = this.muted ? 0 : this.sfxVol;
      return this.muted;
    },
    // Release everything and close the AudioContext (e.g. when leaving the page / after tests)
    async shutdown() {
      this.stop(true); if (this.sfx) this.sfx.port.postMessage({ type: 'hush' });
      if (this.ctx) await this.ctx.close();
      this.ctx = null; this.ready = false;
    },

    // Measure output level for headless verification (cannot listen -> check numbers)
    async measure(target = 'music', ms = 1000) {
      const an = this.ctx.createAnalyser(); an.fftSize = 2048;
      (target === 'music' ? this.musicGain : this.sfxGain).connect(an);
      const buf = new Float32Array(2048); let peak = 0, sum = 0, n = 0, nonFinite = 0;
      for (let i = 0; i < ms / 50; i++) {
        await new Promise((r) => setTimeout(r, 50)); an.getFloatTimeDomainData(buf);
        for (const v of buf) { if (!Number.isFinite(v)) nonFinite++; else { peak = Math.max(peak, Math.abs(v)); sum += v * v; n++; } }
      }
      an.disconnect();
      return { peak: +peak.toFixed(3), rms: +Math.sqrt(sum / Math.max(1, n)).toFixed(3), nonFinite };
    },
  };

  window.FM = FM;
})();
