/*
 * Grande Sonate in c-Moll — Allegro con brio (one movement in sonata form)
 * written for the PianoPhysics engine.
 *
 * Notation helpers:
 *   seq(beat, "G4:1' C5+Eb5:0.5> r:0.5 ...")
 *     pitch[+pitch]:durationInBeats[flags]   flags: ' staccato  > accent  ! sforzando  _ tenuto
 *   One bar = 4 quarter-note beats; bar n starts at beat (n-1)*4.
 */
(function (root) {
  'use strict';

  const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  function N(s) {
    const m = /^([A-G])(##|#|bb|b)?(-?\d)$/.exec(s);
    if (!m) throw new Error('bad pitch ' + s);
    const acc = { '#': 1, '##': 2, b: -1, bb: -2 }[m[2]] || 0;
    return 12 * (parseInt(m[3], 10) + 1) + PC[m[1]] + acc;
  }
  const B = n => (n - 1) * 4;

  function mulberry(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  class Score {
    constructor() {
      this.notes = []; this.peds = []; this.dyns = []; this.tempos = [];
      this.pauses = []; this.sections = []; this.marks = []; this.warnings = [];
    }
    pitch(p, o) {
      let m = typeof p === 'number' ? p : N(p);
      m += (o && o.tr) || 0;
      if (o && o.map) { const d = o.map[((m % 12) + 12) % 12]; if (d) m += d; }
      return m;
    }
    note(b, d, p, o) {
      o = o || {};
      this.notes.push({
        b, d, m: this.pitch(p, o), hand: o.hand || 'R', voice: o.voice || 'mel',
        acc: o.acc || 0, art: o.art || o.defArt || '',
      });
    }
    /* parse a token string; returns end beat. o.bar → verify the length is 4 beats */
    seq(b, str, o) {
      o = o || {};
      const start = b;
      for (const tok of str.trim().split(/\s+/)) {
        const mm = /^([^:]+):([\d.]+)(['>!_]*)$/.exec(tok);
        if (!mm) throw new Error('bad token ' + tok);
        const d = parseFloat(mm[2]), fl = mm[3];
        if (mm[1] !== 'r') {
          const acc = (fl.includes('!') ? 0.2 : 0) + (fl.includes('>') ? 0.1 : 0);
          const art = fl.includes("'") ? 'st' : fl.includes('_') ? 'ten' : '';
          const ps = mm[1].split('+');
          ps.forEach((p, i) => this.note(b, d, p, Object.assign({}, o, {
            acc: (o.acc || 0) + acc, art: art || o.art,
            voice: ps.length > 1 && i < ps.length - 1 && o.voice === 'mel' ? 'inner' : o.voice,
          })));
        }
        b += d;
      }
      if (o.bars && Math.abs(b - start - o.bars * 4) > 1e-6) this.warnings.push(`seq at beat ${start} lasts ${b - start}, expected ${o.bars * 4}`);
      return b;
    }
    /* repeated chord in equal steps; accents: indices that get '>' */
    rep(b, pitches, count, step, o, accents) {
      for (let i = 0; i < count; i++) {
        const acc = accents && accents.includes(i) ? 0.12 : 0;
        for (const p of pitches) this.note(b + i * step, step, p, Object.assign({ voice: 'acc', art: 'st' }, o, { acc: ((o && o.acc) || 0) + acc }));
      }
      return b + count * step;
    }
    /* Beethoven's murmuring bass: broken octaves in eighths */
    oct8(b, low, count, o) {
      const m = this.pitch(low, o);
      for (let i = 0; i < count; i++) {
        this.note(b + i * 0.5, 0.5, m + (i % 2 ? 12 : 0), Object.assign({ hand: 'L', voice: 'bass' }, o, { tr: 0, map: null, acc: i % 2 ? -0.05 : 0.02 }));
      }
      return b + count * 0.5;
    }
    /* Alberti bass: low – top – mid – top in eighths */
    alb(b, lo, mid, top, reps, o) {
      const seq = [lo, top, mid, top];
      for (let r = 0; r < reps; r++) {
        seq.forEach((p, i) => this.note(b + r * 2 + i * 0.5, 0.5, p, Object.assign({ hand: 'L', voice: 'acc', art: 'ten' }, o, { acc: i === 0 ? 0.05 : 0 })));
      }
      return b + reps * 2;
    }
    line(b, list, step, o) {
      list.forEach((p, i) => this.note(b + i * step, step, p, o));
      return b + list.length * step;
    }
    trill(b, d, main, upper, step, o) {
      const n = Math.round(d / step);
      for (let i = 0; i < n; i++) this.note(b + i * step, step, i % 2 ? main : upper, Object.assign({ voice: 'mel' }, o, { acc: i === 0 ? 0.05 : -0.06 }));
    }
    ped(b0, b1) { this.peds.push([b0, b1]); }
    dyn(b, v) { this.dyns.push([b, v]); }
    tempo(b, bpm, ramp) { this.tempos.push({ b, bpm, ramp: !!ramp }); }
    pause(b, sec) { this.pauses.push([b, sec]); }
    section(b, name, sub, key) { this.sections.push({ b, name, sub, key }); }
    mark(b, text) { this.marks.push({ b, text }); }

    build(seed) {
      const rnd = mulberry(seed || 1770);
      const gauss = () => { let s = 0; for (let i = 0; i < 4; i++) s += rnd(); return (s - 2) / 0.577; };
      const tempos = this.tempos.slice().sort((a, b) => a.b - b.b);
      const pauses = this.pauses.slice().sort((a, b) => a[0] - b[0]);
      const endBeat = Math.max(...this.notes.map(n => n.b + n.d)) + 1;
      // beat → seconds table (1/64 beat resolution)
      const RES = 64, nT = Math.ceil(endBeat * RES) + 2, tab = new Float64Array(nT);
      const bpmAt = b => {
        let i = 0; while (i + 1 < tempos.length && tempos[i + 1].b <= b) i++;
        const cur = tempos[i], nx = tempos[i + 1];
        if (nx && nx.ramp) return cur.bpm + (nx.bpm - cur.bpm) * (b - cur.b) / (nx.b - cur.b);
        return cur.bpm;
      };
      for (let i = 1; i < nT; i++) tab[i] = tab[i - 1] + 60 / bpmAt((i - 0.5) / RES) / RES;
      const sec = b => {
        const x = b * RES, i = Math.max(0, Math.min(nT - 2, Math.floor(x))), f = x - i;
        let t = tab[i] + (tab[i + 1] - tab[i]) * f;
        for (const [pb, ps] of pauses) if (b >= pb - 1e-9) t += ps;
        return t;
      };
      const dyns = this.dyns.slice().sort((a, b) => a[0] - b[0]);
      const dynAt = b => {
        if (b <= dyns[0][0]) return dyns[0][1];
        for (let i = 1; i < dyns.length; i++) if (b < dyns[i][0]) {
          const [b0, v0] = dyns[i - 1], [b1, v1] = dyns[i];
          // a point at the same beat as the previous = step; otherwise linear (hairpin)
          return v0 + (v1 - v0) * (b - b0) / (b1 - b0);
        }
        return dyns[dyns.length - 1][1];
      };
      const VOFF = { mel: 0.07, inner: -0.04, acc: -0.13, bass: -0.04, chord: 0 };
      const ART = { st: 0.42, ten: 0.97, '': 0.9 };
      const LEAD = 0.04; // seconds of silence before the first note
      let notes = this.notes.map(n => {
        const t0 = sec(n.b) + LEAD;
        let vel = dynAt(n.b) + (VOFF[n.voice] || 0) + n.acc;
        if (Math.abs(n.b % 4) < 1e-6) vel += 0.03; else if (Math.abs(n.b % 1) > 1e-6) vel -= 0.02;
        vel += gauss() * 0.018;
        let jit = gauss() * 0.004 + (n.hand === 'L' && n.voice === 'bass' ? -0.006 : 0);
        const t = Math.max(LEAD * 0.5, t0 + jit);
        const off = sec(n.b + n.d * (ART[n.art] != null ? ART[n.art] : 0.9)) + LEAD + jit;
        return { t, off: Math.max(t + 0.03, off), midi: n.m, vel: Math.max(0.04, Math.min(1, vel)), hand: n.hand, b: n.b };
      });
      // same key: release before the next strike
      notes.sort((a, b) => a.midi - b.midi || a.t - b.t);
      for (let i = 0; i + 1 < notes.length; i++) {
        const a = notes[i], c = notes[i + 1];
        if (a.midi === c.midi && a.off > c.t - 0.008) a.off = Math.max(a.t + 0.02, c.t - 0.008);
      }
      notes.sort((a, b) => a.t - b.t || a.midi - b.midi);
      // pedal
      const pedEv = [];
      for (const [b0, b1] of this.peds) {
        pedEv.push({ t: sec(b0) + LEAD + 0.07, down: true });
        pedEv.push({ t: sec(b1) + LEAD - 0.025, down: false });
      }
      pedEv.sort((a, b) => a.t - b.t || (a.down ? 1 : -1));
      const pedUpAfter = t => {
        let down = false;
        for (const p of pedEv) { if (p.t > t) { if (!p.down && down) return p.t; if (!p.down && !down) return t; } down = p.down; }
        return down ? Infinity : t;
      };
      const pedDownAt = t => { let d = false; for (const p of pedEv) { if (p.t > t) break; d = p.down; } return d; };
      for (const n of notes) {
        n.dampT = n.midi >= 89 ? Infinity : (pedDownAt(n.off) ? pedUpAfter(n.off) : n.off);
      }
      const events = [];
      for (const n of notes) {
        events.push({ t: n.t, type: 'on', midi: n.midi, vel: n.vel });
        events.push({ t: n.off, type: 'off', midi: n.midi });
      }
      for (const p of pedEv) events.push({ t: p.t, type: 'ped', down: p.down });
      const ORD = { off: 0, ped: 1, on: 2 };
      events.sort((a, b) => a.t - b.t || ORD[a.type] - ORD[b.type]);
      const lastOff = Math.max(...notes.map(n => n.off));
      const duration = lastOff + 4.5;
      const sections = this.sections.slice().sort((a, b) => a.b - b.b).map((s, i, arr) => ({
        name: s.name, sub: s.sub, key: s.key, t0: sec(s.b) + LEAD,
        t1: i + 1 < arr.length ? sec(arr[i + 1].b) + LEAD : duration, bar: s.b / 4 + 1,
      }));
      const marks = this.marks.slice().sort((a, b) => a.b - b.b).map(m => ({ t: sec(m.b) + LEAD, text: m.text }));
      // bar starts for the bar counter
      const bars = [];
      for (let b = 0; b < endBeat; b += 4) bars.push(sec(b) + LEAD);
      return { notes, events, pedals: pedEv, sections, marks, bars, duration, warnings: this.warnings };
    }
  }

  /* ================================================================== */
  function compose() {
    const S = new Score();
    const R = (o) => Object.assign({ hand: 'R', voice: 'mel' }, o);
    const L = (o) => Object.assign({ hand: 'L', voice: 'bass' }, o);
    const C = (o) => Object.assign({ hand: 'R', voice: 'chord' }, o);

    /* ---------------- Introduzione: Grave (bars 1–5) ---------------- */
    S.section(B(1), 'Introduzione', 'Grave', 'c-Moll');
    S.tempo(B(1), 46);
    S.mark(B(1), 'Grave  ♩ = 46');
    S.dyn(B(1), 0.9);
    // bar 1: the motto in octaves — C, E♭, G
    S.seq(B(1), 'C4+C5:1.5> Eb4+Eb5:0.5 G4+G5:2>', R({ bars: 1 }));
    S.seq(B(1), 'C2+C3:1.5> Eb2+Eb3:0.5 G2+G3:2>', L({ bars: 1 }));
    S.ped(B(1), B(1) + 1.5); S.ped(B(1) + 2, B(2));
    // bar 2: A♭ in octaves, then the diminished seventh
    S.dyn(B(2), 0.92);
    S.seq(B(2), 'Ab4+Ab5:2! D4+F4+Ab4+B4:2!', R({ bars: 1 }));
    S.seq(B(2), 'Ab2+Ab3:2! B1+B2:2!', L({ bars: 1 }));
    S.ped(B(2), B(2) + 2); S.ped(B(2) + 2, B(3));
    S.pause(B(3), 0.55);
    // bar 3: chorale, piano
    S.dyn(B(3), 0.3); S.dyn(B(3) + 2.5, 0.4); S.dyn(B(4), 0.34);
    S.seq(B(3), 'Eb4+G4+C5:1 F4+Ab4+C5:1 Eb4+A4+C5:1 D4+G4+B4:1', C({ bars: 1, art: 'ten' }));
    S.seq(B(3), 'C3:1 Ab2:1 F#2:1 G2:1', L({ bars: 1, art: 'ten' }));
    for (let i = 0; i < 4; i++) S.ped(B(3) + i, B(3) + i + 1);
    // bar 4: rising top voice, Neapolitan sixth, cadential 6/4, dominant seventh (fermata)
    S.dyn(B(4), 0.36); S.dyn(B(4) + 1, 0.48); S.dyn(B(4) + 3, 0.3);
    S.seq(B(4), 'Ab4+C5+Eb5:1 Ab4+Db5+F5:1 G4+C5+Eb5:1 F4+B4+D5:1', C({ bars: 1, art: 'ten' }));
    S.seq(B(4), 'Ab2:1 F2:1 G2:1 G2:1', L({ bars: 1, art: 'ten' }));
    for (let i = 0; i < 3; i++) S.ped(B(4) + i, B(4) + i + 1);
    S.ped(B(4) + 3, B(5));
    S.tempo(B(4) + 2, 46); S.tempo(B(4) + 3.5, 30, true); S.tempo(B(5), 46);
    S.pause(B(5) - 0.1, 0.5);
    // bar 5: chromatic descent from F6, accelerating into the Allegro
    S.dyn(B(5), 0.28); S.dyn(B(5) + 3.9, 0.42);
    S.seq(B(5), 'G1+G2:4_', L({ voice: 'bass' }));
    S.seq(B(5), 'B2+F3:4_', L({ voice: 'acc' }));
    S.ped(B(5), B(5) + 2);
    S.line(B(5), Array.from({ length: 24 }, (_, i) => 89 - i), 4 / 24, R({ voice: 'mel' }));
    S.tempo(B(5) + 0.01, 46); S.tempo(B(6) - 0.01, 96, true);

    /* ---------------- Esposizione (bars 6–35) ---------------- */
    S.section(B(6), 'Esposizione', 'Allegro con brio', 'c-Moll → Es-Dur');
    S.tempo(B(6), 144);
    S.mark(B(6), 'Allegro con brio  ♩ = 144');

    function theme1(bar, loud) {
      const o = loud ? 0.18 : 0;
      S.dyn(B(bar), 0.4 + o); S.dyn(B(bar + 1) + 1.5, 0.55 + o); S.dyn(B(bar + 2), 0.48 + o); S.dyn(B(bar + 3) + 3.9, 0.42 + o);
      // antecedent: rocket on the tonic, answered on the dominant
      S.seq(B(bar), "G4:1' C5:1' Eb5:1' G5:1'", R({ bars: 1 }));
      S.seq(B(bar + 1), 'C6:2! Bb5:0.5 Ab5:0.5 G5:0.5 F5:0.5', R({ bars: 1 }));
      S.seq(B(bar + 2), 'Eb5:1.5 F5:0.5 D5:2', R({ bars: 1 }));
      S.seq(B(bar + 3), "B4:1 C5:0.5 D5:0.5 G4:1.5 r:0.5", R({ bars: 1 }));
      S.oct8(B(bar), 'C2', 16); S.oct8(B(bar + 2), 'Ab1', 4); S.oct8(B(bar + 2) + 2, 'G1', 4); S.oct8(B(bar + 3), 'G1', 8);
      // consequent, forte: rocket on V7, sforzando b9, cadence
      S.dyn(B(bar + 4), 0.68 + o * 0.5); S.dyn(B(bar + 5), 0.78 + o * 0.5); S.dyn(B(bar + 7), 0.86);
      S.seq(B(bar + 4), "B4:1> D5:1> F5:1> Ab5:1>", R({ bars: 1 }));
      S.seq(B(bar + 4), "G4:1' B4:1' D5:1' F5:1'", R({ voice: 'inner' }));
      S.seq(B(bar + 5), 'F5+B5+D6:2! C6:0.5 B5:0.5 Ab5:0.5 G5:0.5', R({ bars: 1 }));
      S.seq(B(bar + 6), 'F5:1.5 Eb5:0.5 D5:1 G5:1', R({ bars: 1 }));
      S.seq(B(bar + 6), 'Ab4+C5:1.5 G4:0.5 B4:1 B4+D5:1', R({ voice: 'inner' }));
      S.seq(B(bar + 7), "C5+Eb5+G5+C6:1! r:1 C5+Eb5+G5+C6:1! r:1", C({ bars: 1 }));
      S.oct8(B(bar + 4), 'G1', 16); S.oct8(B(bar + 6), 'F1', 4); S.oct8(B(bar + 6) + 2, 'G1', 4);
      S.seq(B(bar + 7), "C2+C3:1! r:1 C2+C3:1! r:1", L({ bars: 1 }));
      S.ped(B(bar + 7), B(bar + 7) + 0.9); S.ped(B(bar + 7) + 2, B(bar + 7) + 2.9);
    }
    theme1(6, false);

    // transition (bars 14–19): c → A♭ → f → B♭7, the dominant of E♭
    S.dyn(B(14), 0.62); S.dyn(B(16) + 3.9, 0.82);
    S.rep(B(14), ['G4', 'C5', 'Eb5'], 8, 0.5, C(), [2, 6]);
    S.seq(B(14), 'C2+C3:2 Bb1+Bb2:2', L({ bars: 1, art: 'ten' }));
    S.rep(B(15), ['Ab4', 'C5', 'Eb5'], 4, 0.5, C(), [2]);
    S.rep(B(15) + 2, ['Ab4', 'C5', 'F5'], 4, 0.5, C(), [0, 2]);
    S.seq(B(15), 'Ab1+Ab2:2 F1+F2:2', L({ bars: 1, art: 'ten' }));
    S.rep(B(16), ['Ab4', 'D5', 'F5'], 8, 0.5, C(), [0, 2, 4, 6]);
    S.seq(B(16), 'Bb1+Bb2:4', L({ bars: 1, art: 'ten' }));
    S.dyn(B(17), 0.88);
    S.line(B(17), ['F4', 'Bb4', 'D5', 'F5', 'Ab5', 'Bb5', 'D6', 'F6'], 0.5, R());
    S.seq(B(17), "Bb1+Bb2:1! r:1 Bb1+Bb2:1> r:1", L({ bars: 1 }));
    S.ped(B(17), B(18));
    S.dyn(B(18), 0.78); S.dyn(B(19) + 3.9, 0.3);
    S.line(B(18), ['Eb6', 'D6', 'C6', 'Bb5', 'Ab5', 'G5', 'F5', 'Eb5'], 0.5, R());
    S.oct8(B(18), 'Bb1', 8);
    S.seq(B(19), 'D5:1 C5:1 Bb4:1 Ab4:1', R({ bars: 1, art: 'ten' }));
    S.seq(B(19), 'Bb1+Bb2:4_', L({ bars: 1 }));
    S.seq(B(19), 'D3+Ab3:4_', L({ voice: 'acc' }));
    S.ped(B(19), B(20));
    S.tempo(B(19), 144); S.tempo(B(20) - 0.01, 112, true);

    /* second theme, E♭ major, dolce */
    function theme2(bar, o) {
      o = o || {};
      const tr = o.tr || 0;
      const r = x => Object.assign({ tr }, x);
      S.tempo(B(bar), 132);
      S.dyn(B(bar), 0.38); S.dyn(B(bar + 1), 0.44); S.dyn(B(bar + 2) + 2, 0.4); S.dyn(B(bar + 4), 0.4);
      S.dyn(B(bar + 5), 0.52); S.dyn(B(bar + 6), 0.46); S.dyn(B(bar + 7), 0.36);
      S.seq(B(bar), 'Bb4:1 Eb5:1.5 F5:0.5 G5:1', R(r({ bars: 1 })));
      S.seq(B(bar + 1), 'Ab5:3 G5:0.5 F5:0.5', R(r({ bars: 1 })));
      S.seq(B(bar + 2), 'G5:1 C6:1 Ab5:1 F5:1', R(r({ bars: 1 })));
      S.seq(B(bar + 3), 'Eb5:1 D5:1 F5:0.5 Eb5:0.5 D5:0.5 C5:0.5', R(r({ bars: 1 })));
      S.seq(B(bar + 4), 'Bb4:1 Eb5:1.5 F5:0.5 G5:1', R(r({ bars: 1 })));
      S.seq(B(bar + 4), 'r:1 G4:1.5 Ab4:0.5 Bb4:1', R(r({ voice: 'inner' })));
      S.seq(B(bar + 5), 'C6:2 Bb5:0.5 Ab5:0.5 G5:1', R(r({ bars: 1 })));
      S.seq(B(bar + 5), 'Eb5:2 r:2', R(r({ voice: 'inner' })));
      S.seq(B(bar + 6), 'G5:2', R(r({})));
      S.seq(B(bar + 6), 'Eb5:2', R(r({ voice: 'inner' })));
      S.trill(B(bar + 6) + 2, 1.75, N('F5') + tr, N('G5') + tr, 0.125, R({}));
      S.seq(B(bar + 6) + 3.75, 'Eb5:0.125 F5:0.125', R(r({})));
      S.seq(B(bar + 7), 'Eb5:2_ r:2', R(r({ bars: 1 })));
      S.seq(B(bar + 7), 'G4+Bb4:2', R(r({ voice: 'inner' })));
      // Alberti bass
      const A = x => Object.assign({ tr }, x);
      S.alb(B(bar), 'Eb3', 'G3', 'Bb3', 2, A());
      S.alb(B(bar + 1), 'Ab2', 'C3', 'Eb3', 2, A());
      S.alb(B(bar + 2), 'C3', 'Eb3', 'G3', 1, A()); S.alb(B(bar + 2) + 2, 'Ab2', 'C3', 'F3', 1, A());
      S.alb(B(bar + 3), 'Bb2', 'D3', 'F3', 1, A()); S.alb(B(bar + 3) + 2, 'Bb2', 'D3', 'Ab3', 1, A());
      S.alb(B(bar + 4), 'Eb3', 'G3', 'Bb3', 2, A());
      S.alb(B(bar + 5), 'Ab2', 'C3', 'Eb3', 2, A());
      S.alb(B(bar + 6), 'Bb2', 'Eb3', 'G3', 1, A()); S.alb(B(bar + 6) + 2, 'Bb2', 'D3', 'Ab3', 1, A());
      S.seq(B(bar + 7), 'Eb2+Eb3:2 r:2', L(r({})));
      S.ped(B(bar), B(bar + 1)); S.ped(B(bar + 1), B(bar + 2));
      S.ped(B(bar + 2), B(bar + 2) + 2); S.ped(B(bar + 2) + 2, B(bar + 3));
      S.ped(B(bar + 3), B(bar + 3) + 2); S.ped(B(bar + 3) + 2, B(bar + 4));
      S.ped(B(bar + 4), B(bar + 5)); S.ped(B(bar + 5), B(bar + 6));
      S.ped(B(bar + 6), B(bar + 6) + 2); S.ped(B(bar + 6) + 2, B(bar + 7)); S.ped(B(bar + 7), B(bar + 7) + 2);
      S.tempo(B(bar + 6), 132); S.tempo(B(bar + 7), 120, true);
    }
    S.section(B(20), 'Esposizione', 'Secondo tema · dolce', 'Es-Dur');
    S.mark(B(20), 'dolce');
    theme2(20);

    /* closing group: scale, syncopated sforzandi, hammer-blow cadence */
    function closing(bar, o, last) {
      o = o || {};
      const x = y => Object.assign({ tr: o.tr || 0, map: o.map }, y);
      S.tempo(B(bar), 144);
      S.dyn(B(bar), 0.55); S.dyn(B(bar) + 3.9, 0.8);
      S.line(B(bar), ['Eb5', 'F5', 'G5', 'Ab5', 'Bb5', 'C6', 'D6', 'Eb6'], 0.5, R(x({})));
      S.line(B(bar), ['Eb4', 'F4', 'G4', 'Ab4', 'Bb4', 'C5', 'D5', 'Eb5'], 0.5, R(x({ voice: 'inner' })));
      S.seq(B(bar), "Eb2+Eb3:1' G3+Bb3:1' Eb2+Eb3:1' G3+Bb3:1'", L(x({ bars: 1 })));
      S.dyn(B(bar + 1), 0.84);
      S.seq(B(bar + 1), "G5+Bb5+Eb6:1! r:1 D6:0.5 C6:0.5 Bb5:0.5 Ab5:0.5", R(x({ bars: 1 })));
      S.seq(B(bar + 1), "Eb2+Eb3:1! r:1 Bb1+Bb2:2", L(x({ bars: 1 })));
      S.dyn(B(bar + 2), 0.72);
      S.seq(B(bar + 2), "r:0.5 F5+Ab5+C6:1! F5+Ab5+C6:1! F5+Ab5+C6:1! F5+Ab5+C6:0.5'", C(x({ bars: 1 })));
      S.seq(B(bar + 2), "Ab1+Ab2:1' Ab1+Ab2:1' Ab1+Ab2:1' Ab1+Ab2:1'", L(x({ bars: 1 })));
      S.seq(B(bar + 3), "r:0.5 F5+Ab5+D6:1! F5+Ab5+D6:1! F5+Ab5+D6:1! F5+Ab5+D6:0.5'", C(x({ bars: 1 })));
      S.seq(B(bar + 3), "Bb1+Bb2:1' Bb1+Bb2:1' Bb1+Bb2:1' Bb1+Bb2:1'", L(x({ bars: 1 })));
      S.dyn(B(bar + 4), 0.8);
      S.line(B(bar + 4), ['Bb5', 'G5', 'Eb5', 'G5', 'Ab5', 'F5', 'D5', 'F5'], 0.5, R(x({})));
      S.seq(B(bar + 4), 'Bb1+Bb2:2 Bb1+Bb2:2', L(x({ bars: 1, art: 'ten' })));
      S.dyn(B(bar + 5), 0.9);
      S.seq(B(bar + 5), "Eb5+G5+Bb5+Eb6:1! Bb4+D5+F5+Ab5:1! Eb5+G5+Bb5+Eb6:1! Bb4+D5+F5+Ab5:1!", C(x({ bars: 1 })));
      S.seq(B(bar + 5), "Eb2+Eb3:1 Bb1+Bb2:1 Eb2+Eb3:1 Bb1+Bb2:1", L(x({ bars: 1 })));
      S.seq(B(bar + 6), "Eb5+G5+Bb5+Eb6:2! r:2", C(x({ bars: 1 })));
      S.seq(B(bar + 6), "Eb1+Eb2:2! r:2", L(x({ bars: 1 })));
      S.ped(B(bar + 5), B(bar + 5) + 1); S.ped(B(bar + 5) + 1, B(bar + 5) + 2);
      S.ped(B(bar + 5) + 2, B(bar + 5) + 3); S.ped(B(bar + 5) + 3, B(bar + 6));
      S.ped(B(bar + 6), B(bar + 6) + 1.8);
    }
    S.section(B(28), 'Esposizione', 'Gruppo conclusivo', 'Es-Dur');
    closing(28);
    // bar 35: unison descent, E♭ major turning to G minor
    S.dyn(B(35), 0.66); S.dyn(B(35) + 3.9, 0.34);
    S.line(B(35), ['Eb5', 'D5', 'C5', 'Bb4', 'A4', 'G4', 'F#4', 'G4'], 0.5, R());
    S.line(B(35), ['Eb3', 'D3', 'C3', 'Bb2', 'A2', 'G2', 'F#2', 'G2'], 0.5, L());
    S.tempo(B(35), 144); S.tempo(B(36) - 0.01, 128, true);
    S.pause(B(36), 0.25);

    /* ---------------- Sviluppo (bars 36–51) ---------------- */
    S.section(B(36), 'Sviluppo', 'Development', 'g → f → Des → G');
    S.tempo(B(36), 144);
    S.dyn(B(36), 0.36); S.dyn(B(37) + 1, 0.55); S.dyn(B(38), 0.42); S.dyn(B(39) + 1, 0.62);
    S.seq(B(36), "D4:1' G4:1' Bb4:1' D5:1'", R({ bars: 1 }));
    S.seq(B(37), 'G5:2! F5:0.5 Eb5:0.5 D5:0.5 C5:0.5', R({ bars: 1 }));
    S.oct8(B(36), 'G1', 16);
    S.seq(B(38), "C4:1' F4:1' Ab4:1' C5:1'", R({ bars: 1 }));
    S.seq(B(39), 'F5:2! Eb5:0.5 Db5:0.5 C5:0.5 Bb4:0.5', R({ bars: 1 }));
    S.oct8(B(38), 'F1', 16);
    // E♭ – A♭ – D♭ (Neapolitan) – B°7: rising arpeggios under syncopated sforzandi
    S.dyn(B(40), 0.7); S.dyn(B(42), 0.84); S.dyn(B(43), 0.95);
    const sync = (bar, ch) => S.seq(B(bar), `r:0.5 ${ch}:1! ${ch}:1! ${ch}:1! ${ch}:0.5'`, C({ bars: 1 }));
    S.line(B(40), ['Eb2', 'G2', 'Bb2', 'Eb3', 'G3', 'Bb3', 'Eb4', 'Bb3'], 0.5, L());
    sync(40, 'G4+Bb4+Eb5');
    S.line(B(41), ['Ab1', 'C2', 'Eb2', 'Ab2', 'C3', 'Eb3', 'Ab3', 'Eb3'], 0.5, L());
    sync(41, 'Ab4+C5+Eb5');
    S.line(B(42), ['Db2', 'F2', 'Ab2', 'Db3', 'F3', 'Ab3', 'Db4', 'Ab3'], 0.5, L());
    sync(42, 'F4+Ab4+Db5');
    S.line(B(43), ['B1', 'D2', 'F2', 'Ab2', 'B2', 'D3', 'F3', 'Ab3'], 0.5, L());
    S.seq(B(43), 'D5+F5+Ab5+B5:2! F5+Ab5+B5+D6:2!', C({ bars: 1 }));
    S.ped(B(40), B(41)); S.ped(B(41), B(42)); S.ped(B(42), B(43)); S.ped(B(43), B(44));
    // dominant pedal on G, six bars, pianissimo to fortissimo
    S.dyn(B(44), 0.26); S.dyn(B(49) + 3.9, 0.9);
    for (let bar = 44; bar <= 49; bar++) S.oct8(B(bar), 'G1', 8);
    S.seq(B(44), 'Ab4:2 G4:0.5 F4:0.5 Eb4:0.5 D4:0.5', R({ bars: 1 }));
    S.seq(B(45), 'Ab5:2 G5:0.5 F5:0.5 Eb5:0.5 D5:0.5', R({ bars: 1 }));
    S.rep(B(46), ['B4', 'D5', 'F5'], 4, 0.5, C(), [0]); S.rep(B(46) + 2, ['B4', 'D5', 'Ab5'], 4, 0.5, C(), [0]);
    S.rep(B(47), ['D5', 'F5', 'B5'], 4, 0.5, C(), [0]); S.rep(B(47) + 2, ['D5', 'Ab5', 'B5'], 4, 0.5, C(), [0]);
    S.line(B(48), ['G4', 'Ab4', 'A4', 'Bb4', 'B4', 'C5', 'Db5', 'D5'], 0.5, R());
    S.line(B(49), ['Eb5', 'E5', 'F5', 'F#5', 'G5', 'Ab5', 'A5', 'B5'], 0.5, R());
    S.line(B(48), ['G3', 'Ab3', 'A3', 'Bb3', 'B3', 'C4', 'Db4', 'D4'], 0.5, R({ voice: 'inner', hand: 'R' }));
    S.line(B(49), ['Eb4', 'E4', 'F4', 'F#4', 'G4', 'Ab4', 'A4', 'B4'], 0.5, R({ voice: 'inner', hand: 'R' }));
    S.dyn(B(50), 0.95); S.dyn(B(50) + 2, 0.8); S.dyn(B(51) + 3, 0.24);
    S.seq(B(50), 'G5+B5+D6+F6:2!', C({}));
    S.line(B(50) + 2, ['F6', 'D6', 'B5', 'G5'], 0.5, R());
    S.seq(B(50), 'G1+G2:2! r:2', L({ bars: 1 }));
    S.line(B(51), ['F5', 'D5', 'B4', 'G4'], 0.5, R());
    S.seq(B(51) + 2, 'F4+B4+D5:2_', C({}));
    S.seq(B(51), 'r:2 G2+G3:2_', L({ bars: 1 }));
    S.ped(B(50), B(51)); S.ped(B(51) + 2, B(52));
    S.tempo(B(50), 144); S.tempo(B(52) - 0.01, 92, true);
    S.pause(B(52) - 0.2, 0.9);

    /* ---------------- Ripresa (bars 52–81) ---------------- */
    S.section(B(52), 'Ripresa', 'Recapitulation', 'c-Moll');
    S.tempo(B(52), 144);
    S.mark(B(52), 'Tempo I');
    theme1(52, true);
    // transition, now to G7 (dominant of C)
    S.dyn(B(60), 0.64); S.dyn(B(62) + 3.9, 0.84);
    S.rep(B(60), ['G4', 'C5', 'Eb5'], 8, 0.5, C(), [2, 6]);
    S.seq(B(60), 'C2+C3:2 Bb1+Bb2:2', L({ bars: 1, art: 'ten' }));
    S.rep(B(61), ['Ab4', 'C5', 'Eb5'], 4, 0.5, C(), [2]);
    S.rep(B(61) + 2, ['Ab4', 'C5', 'F5'], 4, 0.5, C(), [0, 2]);
    S.seq(B(61), 'Ab1+Ab2:2 F1+F2:2', L({ bars: 1, art: 'ten' }));
    S.rep(B(62), ['G4', 'B4', 'D5'], 4, 0.5, C(), [0, 2]); S.rep(B(62) + 2, ['F4', 'B4', 'D5'], 4, 0.5, C(), [0, 2]);
    S.seq(B(62), 'G1+G2:4', L({ bars: 1, art: 'ten' }));
    S.dyn(B(63), 0.88);
    S.line(B(63), ['D4', 'G4', 'B4', 'D5', 'F5', 'G5', 'B5', 'D6'], 0.5, R());
    S.seq(B(63), "G1+G2:1! r:1 G1+G2:1> r:1", L({ bars: 1 }));
    S.ped(B(63), B(64));
    S.dyn(B(64), 0.76); S.dyn(B(65) + 3.9, 0.3);
    S.line(B(64), ['C6', 'B5', 'A5', 'G5', 'F5', 'E5', 'D5', 'C5'], 0.5, R());
    S.oct8(B(64), 'G1', 8);
    S.seq(B(65), 'B4:1 A4:1 G4:1 F4:1', R({ bars: 1, art: 'ten' }));
    S.seq(B(65), 'G1+G2:4_', L({ bars: 1 }));
    S.seq(B(65), 'B2+F3:4_', L({ voice: 'acc' }));
    S.ped(B(65), B(66));
    S.tempo(B(65), 144); S.tempo(B(66) - 0.01, 112, true);
    S.section(B(66), 'Ripresa', 'Secondo tema · C-Dur', 'C-Dur');
    theme2(66, { tr: -3 });
    S.section(B(74), 'Ripresa', 'Gruppo conclusivo · c-Moll', 'c-Moll');
    closing(74, { tr: -3, map: { 4: -1, 9: -1 } });
    // bar 81: unison descent in C minor, into the Grave
    S.dyn(B(81), 0.8); S.dyn(B(81) + 3.9, 0.9);
    S.line(B(81), ['C6', 'B5', 'Ab5', 'G5', 'F5', 'Eb5', 'D5', 'C5'], 0.5, R());
    S.line(B(81), ['C4', 'B3', 'Ab3', 'G3', 'F3', 'Eb3', 'D3', 'C3'], 0.5, L());
    S.tempo(B(81), 144); S.tempo(B(82) - 0.01, 110, true);

    /* ---------------- Coda (bars 82–90) ---------------- */
    S.section(B(82), 'Coda', 'Grave — Allegro', 'c-Moll');
    S.tempo(B(82), 46);
    S.mark(B(82), 'Grave');
    S.dyn(B(82), 0.94);
    S.seq(B(82), 'Ab4+Ab5:2! D4+F4+Ab4+B4:2!', R({ bars: 1 }));
    S.seq(B(82), 'Ab2+Ab3:2! B1+B2:2!', L({ bars: 1 }));
    S.ped(B(82), B(82) + 2); S.ped(B(82) + 2, B(83));
    S.pause(B(83), 0.7);
    S.dyn(B(83), 0.26); S.dyn(B(83) + 1, 0.38); S.dyn(B(83) + 3, 0.22);
    S.seq(B(83), 'Ab4+C5+Eb5:1 Ab4+Db5+F5:1 G4+C5+Eb5:1 F4+B4+D5:1', C({ bars: 1, art: 'ten' }));
    S.seq(B(83), 'Ab2:1 F2:1 G2:1 G2:1', L({ bars: 1, art: 'ten' }));
    for (let i = 0; i < 4; i++) S.ped(B(83) + i, B(83) + i + 1);
    S.tempo(B(83) + 2, 46); S.tempo(B(83) + 3.6, 28, true);
    S.pause(B(84) - 0.1, 1.1);
    S.tempo(B(84), 152);
    S.mark(B(84), 'Allegro molto');
    S.dyn(B(84), 0.6); S.dyn(B(85) + 1, 0.86);
    S.seq(B(84), "G4:1' C5:1' Eb5:1' G5:1'", R({ bars: 1 }));
    S.seq(B(85), 'Eb5+G5+C6:2! Bb5:0.5 Ab5:0.5 G5:0.5 F5:0.5', R({ bars: 1 }));
    S.oct8(B(84), 'C2', 16);
    S.dyn(B(86), 0.9);
    S.seq(B(86), 'Ab4+C5+F5+Ab5:2! G4+B4+D5+G5:2!', C({ bars: 1 }));
    S.seq(B(86), 'F1+F2:2! G1+G2:2!', L({ bars: 1 }));
    S.ped(B(86), B(86) + 2); S.ped(B(86) + 2, B(87));
    S.seq(B(87), 'C5+Eb5+G5+C6:1! C5+F5+Ab5+C6:1! C5+Eb5+G5+C6:1! B4+D5+F5+G5:1!', C({ bars: 1 }));
    S.seq(B(87), 'C2+C3:1 C2+C3:1 C2+C3:1 G1+G2:1', L({ bars: 1 }));
    for (let i = 0; i < 4; i++) S.ped(B(87) + i, B(87) + i + 1);
    S.line(B(88), ['C7', 'G6', 'Eb6', 'C6', 'G5', 'Eb5', 'C5', 'G4'], 0.5, R());
    S.seq(B(88), 'C2+C3:4', L({ bars: 1 }));
    S.seq(B(88), 'G2+Eb3:4', L({ voice: 'acc' }));
    S.ped(B(88), B(89));
    S.dyn(B(89), 0.92);
    S.seq(B(89), "C5+Eb5+G5+C6:1! r:1 G4+B4+D5+G5:1! r:1", C({ bars: 1 }));
    S.seq(B(89), "C2+C3:1! r:1 G1+G2:1! r:1", L({ bars: 1 }));
    S.ped(B(89), B(89) + 0.9); S.ped(B(89) + 2, B(89) + 2.9);
    S.dyn(B(90), 1.0);
    S.seq(B(90), 'C5+Eb5+G5+C6:4!', C({ bars: 1, art: 'ten' }));
    S.seq(B(90), 'G3+C4:4_', R({ voice: 'inner' }));
    S.seq(B(90), 'C1+C2:4!', L({ bars: 1, art: 'ten' }));
    S.ped(B(90), B(91) + 3);
    S.tempo(B(88), 152); S.tempo(B(89) + 3.9, 116, true);
    S.pause(B(90), 0.35);
    return S;
  }

  function buildSonata() {
    const S = compose();
    const r = S.build(1770);
    r.title = 'Grande Sonate in c-Moll';
    return r;
  }

  root.SonataScore = { buildSonata, N };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.SonataScore;
})(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : globalThis));
