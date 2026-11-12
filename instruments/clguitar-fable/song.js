/*
 * 「Brisa de Novembro（十一月のそよ風）」 — ボサノヴァ・ソロギターのためのオリジナル曲
 *
 * 形式 : Intro(4) – A(8) – A'(8) – B(8) – A''(8) – Coda(4)   Am / 4分の4 / ♩=138
 * 奏法 : 親指=ベース(6・5弦)、人差し〜薬指=コード(4・3・2弦)のボサノヴァ・パターン、
 *        旋律は1弦。すべての音に弦とフレットを割り当ててある。
 */
(function (root) {
  'use strict';

  const BPM = 138;
  const OPEN = { 1: 64, 2: 59, 3: 55, 4: 50, 5: 45, 6: 40 };

  // コード: bass=[弦,フレット] alt=交互ベース comp=[[弦,フレット]...]（4・3・2弦）
  const CH = {
    'Am7':   { bass: [5, 0], alt: [6, 0], comp: [[4, 5], [3, 5], [2, 5]] },
    'D9':    { bass: [5, 5], alt: [6, 5], comp: [[4, 4], [3, 5], [2, 5]] },
    'Dm9':   { bass: [5, 5], alt: [6, 5], comp: [[4, 3], [3, 5], [2, 5]] },
    'G13':   { bass: [6, 3], alt: [5, 5], comp: [[4, 3], [3, 4], [2, 5]] },
    'Cmaj9': { bass: [5, 3], alt: [6, 3], comp: [[4, 2], [3, 4], [2, 3]] },
    'Fmaj7': { bass: [6, 1], alt: [5, 3], comp: [[4, 2], [3, 2], [2, 1]] },
    'Bm7♭5': { bass: [5, 2], alt: [6, 1], comp: [[4, 3], [3, 2], [2, 3]] },
    'E7♭9':  { bass: [6, 0], alt: [5, 2], comp: [[4, 6], [3, 7], [2, 6]] },
    'Gm7':   { bass: [6, 3], alt: [6, 3], comp: [[4, 3], [3, 3], [2, 3]] },
    'C9':    { bass: [5, 3], alt: [5, 3], comp: [[4, 2], [3, 3], [2, 3]] },
    'B♭7':   { bass: [6, 6], alt: [5, 8], comp: [[4, 6], [3, 7], [2, 6]] },
    'Em9':   { bass: [5, 7], alt: [6, 7], comp: [[4, 5], [3, 7], [2, 7]] },
    'A7♭9':  { bass: [5, 0], alt: [6, 0], comp: [[4, 5], [3, 3], [2, 2]] },
    'E7♯9':  { bass: [6, 0], alt: [6, 0], comp: [[4, 6], [3, 7], [2, 8]] },
    'Am6/9': { bass: [5, 0], alt: [6, 0], comp: [[4, 4], [3, 5], [2, 5]] },
  };

  // 旋律 [開始(8分), 長さ(8分), 音名]。小節線をまたぐ先取音（アンティシペーション）が多い。
  const m1 = [[3, 1, 'D5'], [4, 3, 'C5'], [7, 4, 'B4']];
  const m2 = [[4, 1, 'A4'], [5, 1, 'B4'], [6, 1, 'C5'], [7, 4, 'D5']];
  const m3 = [[3, 1, 'C5'], [4, 3, 'B4'], [7, 4, 'A4']];
  const m12 = [[4, 1, 'G4'], [5, 1, 'B4'], [6, 1, 'D5'], [7, 4, 'G5']];
  const m13 = [[3, 1, 'E5'], [4, 1, 'G5'], [5, 1, 'E5'], [6, 1, 'D5'], [7, 3, 'F5']];
  const m14 = [[2, 1, 'D5'], [3, 1, 'B4'], [4, 1, 'G#4'], [5, 1, 'B4'], [6, 1, 'D5'], [7, 4, 'C5']];
  const m15 = [[3, 1, 'B4'], [4, 4, 'A4']];
  const pick = [[4, 1, 'B4'], [5, 1, 'D5'], [6, 1, 'F5'], [7, 4, 'E5']];

  const BARS = [
    // Intro
    { sec: 'Intro', ch: ['Am7'], mel: [] },
    { ch: ['D9'], mel: [] },
    { ch: ['Am7'], mel: [] },
    { ch: ['E7♭9'], mel: pick },
    // A
    { sec: 'A', ch: ['Am7'], mel: m1 },
    { ch: ['D9'], mel: m2 },
    { ch: ['Dm9'], mel: m3 },
    { ch: ['G13'], mel: [[4, 1, 'G4'], [5, 1, 'A4'], [6, 1, 'D5'], [7, 4, 'B4']] },
    { ch: ['Cmaj9'], mel: [[3, 1, 'C5'], [4, 1, 'D5'], [5, 1, 'E5'], [6, 1, 'G5'], [7, 5, 'E5']] },
    { ch: ['Fmaj7'], mel: [[5, 1, 'D5'], [6, 1, 'C5'], [7, 4, 'D5']] },
    { ch: ['Bm7♭5'], mel: [[3, 1, 'F5'], [4, 1, 'E5'], [5, 1, 'D5'], [6, 1, 'B4'], [7, 4, 'G#4']] },
    { ch: ['E7♭9'], mel: pick },
    // A'
    { sec: "A'", ch: ['Am7'], mel: m1 },
    { ch: ['D9'], mel: m2 },
    { ch: ['Dm9'], mel: m3 },
    { ch: ['G13'], mel: m12 },
    { ch: ['Cmaj9'], mel: m13 },
    { ch: ['Bm7♭5', 'E7♭9'], mel: m14 },
    { ch: ['Am7'], mel: m15 },
    { ch: ['Gm7', 'C9'], mel: [[2, 1, 'G4'], [3, 1, 'Bb4'], [4, 2, 'D5'], [6, 1, 'Bb4'], [7, 4, 'A4']] },
    // B
    { sec: 'B', ch: ['Fmaj7'], mel: [[3, 1, 'C5'], [4, 3, 'E5'], [7, 4, 'D5']] },
    { ch: ['B♭7'], mel: [[3, 1, 'C5'], [4, 2, 'Ab4'], [6, 1, 'Bb4'], [7, 4, 'B4']] },
    { ch: ['Em9'], mel: [[3, 1, 'D5'], [4, 3, 'F#5'], [7, 4, 'E5']] },
    { ch: ['A7♭9'], mel: [[3, 1, 'C#5'], [4, 1, 'Bb4'], [5, 1, 'G4'], [6, 1, 'Bb4'], [7, 4, 'A4']] },
    { ch: ['Dm9'], mel: [[3, 1, 'D5'], [4, 3, 'F5'], [7, 4, 'E5']] },
    { ch: ['G13'], mel: [[3, 1, 'D5'], [4, 1, 'B4'], [5, 1, 'G4'], [6, 1, 'A4'], [7, 5, 'D5']] },
    { ch: ['Cmaj9'], mel: [[4, 1, 'B4'], [5, 1, 'C5'], [6, 1, 'D5'], [7, 3, 'F5']] },
    { ch: ['E7♭9'], mel: [[2, 1, 'E5'], [3, 1, 'D5'], [4, 1, 'B4'], [5, 1, 'G#4'], [6, 1, 'B4'], [7, 4, 'E5']] },
    // A''
    { sec: "A''", ch: ['Am7'], mel: m1 },
    { ch: ['D9'], mel: m2 },
    { ch: ['Dm9'], mel: m3 },
    { ch: ['G13'], mel: m12 },
    { ch: ['Cmaj9'], mel: m13 },
    { ch: ['Bm7♭5', 'E7♭9'], mel: m14 },
    { ch: ['Am7'], mel: m15 },
    { ch: ['Am7'], mel: [[4, 1, 'E4'], [5, 1, 'A4'], [6, 1, 'C5'], [7, 4, 'E5']] },
    // Coda
    { sec: 'Coda', ch: ['Fmaj7'], mel: [[3, 1, 'D5'], [4, 3, 'C5'], [7, 4, 'G5']] },
    { ch: ['E7♯9'], mel: [[3, 1, 'F5'], [4, 1, 'E5'], [5, 1, 'D5'], [6, 1, 'C5'], [7, 9, 'B4']] },
    { ch: ['Am6/9'], mel: [] },
    { ch: ['Am6/9'], mel: [], final: true },
  ];
  const DYN = { 'Intro': 0.9, 'A': 0.96, "A'": 1.0, 'B': 1.06, "A''": 1.0, 'Coda': 0.9 };

  function noteToMidi(n) {
    const m = /^([A-G])([#b]?)(\d)$/.exec(n);
    const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]];
    return 12 * (parseInt(m[3], 10) + 1) + base + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  }

  function buildSong() {
    let seed = 20261112;
    const rnd = () => { // mulberry32
      seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const jit = (a) => (rnd() - 0.5) * 2 * a;

    // テンポマップ（終わり2小節半でリタルダンド）
    const nBars = BARS.length, base = 60 / BPM / 2, lead = 0.6;
    const T = [lead];
    const ritFrom = (nBars - 3) * 8 + 4, ritTo = nBars * 8;
    for (let k = 0; k < nBars * 8 + 24; k++) {
      const x = Math.min(1, Math.max(0, (k - ritFrom) / (ritTo - ritFrom)));
      T.push(T[k] + base * (1 + 0.6 * x * x));
    }
    const tAt = (e) => { const i = Math.floor(e), f = e - i; return T[i] + (T[i + 1] - T[i]) * f; };

    const notes = [], bars = [], sections = [];
    let dyn = 0.9;
    const add = (role, e, durE, s, fret, vel, extra) => {
      const t = tAt(e) + (extra || 0) + jit(0.005);
      const d = Math.max(0.08, tAt(e + durE) - tAt(e));
      const o = { role, t, dur: d, s, fret, midi: OPEN[s] + fret, vel: Math.min(1, Math.max(0.15, vel * dyn + jit(0.04))) };
      if (role === 'mel') { o.beta = 0.11; o.touch = 0.65; }
      else if (role === 'comp') { o.beta = 0.14; o.touch = 0.9; }
      else { o.beta = 0.16; o.touch = 1.2; }
      notes.push(o);
    };

    BARS.forEach((bar, bi) => {
      const e0 = bi * 8;
      if (bar.sec) { dyn = DYN[bar.sec]; sections.push({ name: bar.sec, t: tAt(e0), bar: bi }); }
      const two = bar.ch.length === 2;
      const chA = CH[bar.ch[0]], chB = CH[bar.ch[two ? 1 : 0]];
      bars.push({
        index: bi, t0: tAt(e0), t1: tAt(e0 + 8),
        chords: two ? [{ name: bar.ch[0], t: tAt(e0) }, { name: bar.ch[1], t: tAt(e0 + 4) }] : [{ name: bar.ch[0], t: tAt(e0) }],
      });

      if (bar.final) {
        // 終止：Am6/9 をゆっくりロールして響かせる
        const roll = [[5, 0], [4, 4], [3, 5], [2, 5], [1, 7]];
        roll.forEach(([s, f], i) => add(i === 0 ? 'bass' : i === 4 ? 'mel' : 'comp', e0, 14, s, f, i === 4 ? 0.8 : 0.62, i * 0.075));
        return;
      }

      // 親指のベース（1拍目=ルート、3拍目=交互ベース）
      add('bass', e0, 2.7, chA.bass[0], chA.bass[1], 0.86);
      const b2 = two ? chB.bass : chA.alt;
      add('bass', e0 + 4, 2.7, b2[0], b2[1], 0.78);

      // 指のコード：2小節のボサノヴァ・パターン  |x..x..x.|..x..x..|
      const hits = bi % 2 === 0 ? [[0, 0.9, 0.62], [3, 1.5, 0.74], [6, 1.2, 0.66]] : [[2, 1.5, 0.72], [5, 1.4, 0.64]];
      hits.forEach(([h, d, v]) => {
        const c = h >= 4 ? chB : chA;
        c.comp.forEach(([s, f], i) => add('comp', e0 + h, d, s, f, v + (i === 2 ? 0.03 : 0), i * 0.004));
      });

      // 旋律（1弦）
      bar.mel.forEach(([st, d, name]) => {
        const midi = noteToMidi(name);
        const acc = st === 7 ? 1.0 : d >= 3 ? 0.95 : 0.86;
        add('mel', e0 + st, d - 0.08, 1, midi - OPEN[1], acc);
      });
    });

    notes.sort((a, b) => a.t - b.t);
    const end = notes.reduce((m, n) => Math.max(m, n.t + n.dur), 0);
    return {
      title: 'Brisa de Novembro', subtitle: '十一月のそよ風', bpm: BPM,
      notes, bars, sections, duration: end + 3.0,
    };
  }

  const api = { buildSong, CH, OPEN };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.GuitarSong = api;
})(typeof self !== 'undefined' ? self : globalThis);
