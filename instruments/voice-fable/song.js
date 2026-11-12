/*
 * 曲「なみのかたち」 — 歌（物理モデルの声）とピアノ伴奏（物理モデルのピアノ）
 *
 * 歌は「音符 + かな」で書き、歌い手（compileVoice）がそれを
 * 肺の圧力・声帯の張り・舌や唇の狭め・軟口蓋の開きといった体の動きの予定表に直す。
 */
(function (root) {
  'use strict';
  const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const nn = (s) => { const m = /^([A-G])([#b]?)(-?\d)$/.exec(s); return 12 * (+m[3] + 1) + NOTE[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0); };

  const BPM = 76, E8 = 60 / BPM / 2, LEAD = 0.8;
  // 小節ごと: [コード, [[音名, 8 分音符の数, ローマ字, かな], ...]]   音名 '-' は休み、ローマ字 '-' は母音を伸ばして音高だけ変える
  const SCORE = [
    ['C', []], ['G/B', []],
    // A
    ['C',    [['-', 2], ['E4', 1, 'so', 'そ'], ['G4', 1, 'ra', 'ら'], ['E4', 2, 'ni', 'に'], ['D4', 1, 'u', 'う'], ['C4', 1, 'ma', 'ま']]],
    ['G/B',  [['D4', 1, 're', 'れ'], ['D4', 2, 'ta', 'た'], ['B3', 1, 'i', 'い'], ['D4', 1, 'ki', 'き'], ['D4', 3, 'ga', 'が']]],
    ['Am',   [['-', 2], ['C4', 1, 'fu', 'ふ'], ['E4', 1, 'ru', 'る'], ['C4', 2, 'e', 'え'], ['B3', 1, 'te', 'て'], ['A3', 1, 'u', 'う']]],
    ['Em/G', [['B3', 1, 'ta', 'た'], ['B3', 2, 'ni', 'に'], ['G3', 1, 'na', 'な'], ['B3', 4, 'ru', 'る']]],
    ['F',    [['-', 2], ['A3', 1, 'da', 'だ'], ['C4', 1, 're', 'れ'], ['F4', 2, 'mo', 'も'], ['E4', 1, 'i', 'い'], ['D4', 1, 'na', 'な']]],
    ['C/E',  [['E4', 2, 'i', 'い'], ['C4', 1, 'he', 'へ'], ['D4', 1, 'ya', 'や'], ['E4', 4, 'de', 'で']]],
    ['Dm7',  [['-', 2], ['D4', 1, 'wa', 'わ'], ['F4', 1, 'ta', 'た'], ['E4', 1, 'shi', 'し'], ['D4', 2, 'wa', 'は'], ['-', 1]]],
    ['G',    [['D4', 1, 'u', 'う'], ['E4', 1, 'ta', 'た'], ['D4', 4, 'u', 'う'], ['-', 2]]],
    // B
    ['F',    [['E4', 2, 'hi', 'ひ'], ['F4', 1, 'bi', 'び'], ['G4', 3, 'ke', 'け'], ['-', 2]]],
    ['G',    [['G4', 1, 'to', 'と'], ['F4', 1, 'o', 'お'], ['E4', 1, 'ku', 'く'], ['D4', 2, 'ma', 'ま'], ['D4', 3, 'de', 'で']]],
    ['Em',   [['E4', 1, 'na', 'な'], ['E4', 1, 'mi', 'み'], ['G4', 2, 'no', 'の'], ['E4', 1, 'ka', 'か'], ['D4', 1, 'ta', 'た'], ['E4', 1, 'chi', 'ち'], ['D4', 1, 'no', 'の']]],
    ['Am',   [['C4', 2, 'ko', 'こ'], ['B3', 1, 'to', 'と'], ['C4', 4, 'ba', 'ば'], ['-', 1]]],
    ['F',    [['C4', 2, 'a', 'あ'], ['F4', 4, 'a', 'あ'], ['-', 2]]],
    ['G',    [['D4', 1, 'ki', 'き'], ['D4', 1, 'ko', 'こ'], ['G4', 2, 'e', 'え'], ['F4', 1, 'ma', 'ま'], ['E4', 1, 'su', 'す'], ['D4', 2, 'ka', 'か']]],
    ['Am',   [['E4', 1, 'ko', 'こ'], ['E4', 1, 're', 'れ'], ['E4', 2, 'ga', 'が'], ['C4', 1, 'wa', 'わ'], ['D4', 1, 'ta', 'た'], ['E4', 1, 'shi', 'し'], ['D4', 1, 'no', 'の']]],
    ['Dm7|G', [['-', 1], ['F4', 3, 'ko', 'こ'], ['E4', 2, 'e', 'え'], ['D4', 2, '-', '']]],
    ['C',    [['C4', 8, '-', '']]],
    ['C',    []],
    ['Cend', []],
  ];
  const LINES = ['そらに うまれた いきが', 'ふるえて うたに なる', 'だれも いない へやで', 'わたしは うたう', 'ひびけ とおくまで', 'なみの かたちの ことば', 'ああ きこえますか', 'これが わたしの こえ'];

  const PCN = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
  const trName = (sym, tr) => sym.replace(/[A-G][#b]?/g, s => PCN[(nn(s + '0') + tr) % 12]);
  function chordTones(sym) {
    const [main, bassS] = sym.split('/');
    const m = /^([A-G][#b]?)(m7|maj7|m|7)?$/.exec(main);
    const r = nn(m[1] + '0') % 12, q = m[2] || '';
    const iv = q === 'm' ? [0, 3, 7] : q === 'm7' ? [0, 3, 7, 10] : q === '7' ? [0, 4, 7, 10] : q === 'maj7' ? [0, 4, 7, 11] : [0, 4, 7];
    return { root: r, bass: bassS ? nn(bassS + '0') % 12 : r, pcs: iv.map(i => (r + i) % 12) };
  }
  const up = (pc, from) => { let m = from - (from % 12) + pc; if (m < from) m += 12; return m; }; // from 以上で最も低い pc

  // ---- 子音: どこを・どれだけ・いつ ----
  const CONS = {
    k: { pl: 'vel', k: 'stop', vl: 1 }, g: { pl: 'vel', k: 'stop' }, t: { pl: 'alv', k: 'stop', vl: 1 }, d: { pl: 'alv', k: 'stop' },
    p: { pl: 'lab', k: 'stop', vl: 1 }, b: { pl: 'lab', k: 'stop' },
    s: { pl: 'alv', k: 'fric', a: 0.10e-4, vl: 1 }, z: { pl: 'alv', k: 'fric', a: 0.12e-4 }, sh: { pl: 'pal', k: 'fric', a: 0.13e-4, vl: 1 },
    f: { pl: 'lab', k: 'fric', a: 0.16e-4, vl: 1 }, h: { k: 'h' },
    ch: { pl: 'pal', k: 'aff', a: 0.13e-4, vl: 1 }, ts: { pl: 'alv', k: 'aff', a: 0.10e-4, vl: 1 }, j: { pl: 'pal', k: 'aff', a: 0.14e-4 },
    m: { pl: 'lab', k: 'nas' }, n: { pl: 'alv', k: 'nas' }, r: { pl: 'alv', k: 'tap' }, y: { k: 'gl', v: 'i' }, w: { k: 'gl', v: 'u' },
  };
  const ADD = 0.05e-4, OPEN = 0.30e-4;

  function compileVoice(notes, ev, tr) {
    const R = (t, name, v, d) => ev.push([t, 10, name, v, d]);
    const VPS = { a: 0.8, o: 0.9, e: 0.92, i: 1.08, u: 1.08 }; // 母音ごとの息の強さ（開いた母音は軽く）
    const psFor = (m, dyn, v) => (880 + 30 * (m - tr - 55)) * dyn * (VPS[v] || 1);
    for (let i = 0; i < notes.length; i++) {
      const n = notes[i], prev = notes[i - 1], next = notes[i + 1], t0 = n.t;
      const gapBefore = prev ? t0 - (prev.t + prev.d) : 9, gapAfter = next ? next.t - (t0 + n.d) : 9;
      const phraseStart = gapBefore > 0.12, phraseEnd = gapAfter > 0.12;
      const vowel = n.syl === '-' ? null : n.syl.slice(-1), c = n.syl === '-' ? null : CONS[n.syl.slice(0, -1)];
      let lead = 0.03; // 子音が始まるのは拍の何秒前か
      if (c) {
        const pl = c.pl;
        if (c.k === 'stop') {
          lead = 0.085; ev.push([t0 - 0.085, 12, pl, 0, 0.03]); ev.push([t0 - 0.014, 13, pl, 0.022]);
          if (c.vl) { R(t0 - 0.09, 'abd', 0.22e-4, 0.035); R(t0 - 0.002, 'abd', ADD, 0.04); }
        } else if (c.k === 'fric') {
          lead = 0.14; ev.push([t0 - 0.14, 12, pl, c.a, 0.04]); ev.push([t0 - 0.022, 13, pl, 0.035]);
          if (c.vl) { R(t0 - 0.15, 'abd', OPEN, 0.045); R(t0 - 0.04, 'abd', ADD, 0.045); } else { R(t0 - 0.14, 'abd', 0.09e-4, 0.04); R(t0 - 0.03, 'abd', ADD, 0.04); }
        } else if (c.k === 'aff') {
          lead = 0.14; ev.push([t0 - 0.14, 12, pl, 0, 0.03]); R(t0 - 0.075, 'c' + pl[0].toUpperCase() + pl.slice(1), c.a, 0.012); ev.push([t0 - 0.018, 13, pl, 0.03]);
          if (c.vl) { R(t0 - 0.145, 'abd', OPEN, 0.04); R(t0 - 0.035, 'abd', ADD, 0.045); }
        } else if (c.k === 'h') {
          lead = 0.11; R(t0 - 0.11, 'abd', 0.34e-4, 0.045); R(t0 - 0.025, 'abd', ADD, 0.05);
        } else if (c.k === 'nas') {
          lead = 0.10; R(t0 - 0.105, 'velum', 0.7e-4, 0.035); ev.push([t0 - 0.095, 12, pl, 0, 0.03]); ev.push([t0 - 0.012, 13, pl, 0.025]); R(t0 - 0.005, 'velum', 0, 0.045);
        } else if (c.k === 'tap') {
          lead = 0.045; ev.push([t0 - 0.045, 12, pl, 0.02e-4, 0.018]); ev.push([t0 - 0.02, 13, pl, 0.022]);
        } else if (c.k === 'gl') {
          lead = 0.12; ev.push([t0 - 0.12, 11, c.v, 0.05, n.m]);
        }
      }
      // 母音: 子音の間に舌は次の母音へ向かう（調音結合）
      if (vowel) { if (c && c.k === 'gl') ev.push([t0 - 0.035, 11, vowel, 0.1, n.m]); else ev.push([t0 - Math.min(lead, 0.07), 11, vowel, 0.09, n.m]); }
      else ev.push([t0 - 0.03, 11, n.vowel, 0.08, n.m]); // 伸ばし: 音高に合わせて口の開きを直す
      // 音高
      if (phraseStart) R(t0 - lead - 0.12, 'pitch', n.m - 0.6, 0); // 下からすくい上げて入る
      R(t0 - 0.045, 'pitch', n.m, phraseStart ? 0.10 : 0.085);
      // 息
      const dyn = n.dyn || 1;
      if (phraseStart) {
        if (gapBefore > 0.7) { // 息を吸う（声門を開いて負圧）
          const tb = t0 - lead - 0.52;
          R(tb, 'abd', 0.5e-4, 0.08); R(tb + 0.02, 'ps', -260, 0.1); R(tb + 0.27, 'ps', 0, 0.1); R(tb + 0.33, 'abd', c && c.vl ? OPEN : ADD, 0.09);
          ev.push([tb, 11, vowel || 'a', 0.25, n.m]);
        }
        // 破裂音で始まるときは、閉じ切ってから息を押す（閉じる途中で流れを止めると「水撃」でクリックが出る）
        const stopStart = c && (c.k === 'stop' || c.k === 'aff');
        R(stopStart ? t0 - lead + 0.035 : t0 - lead - 0.035, 'ps', psFor(n.m, dyn, vowel || n.vowel), stopStart ? 0.04 : 0.07);
      } else R(t0 - 0.03, 'ps', psFor(n.m, dyn, vowel || n.vowel), 0.09);
      // ビブラート
      R(t0 - 0.03, 'vib', 0, 0.07);
      if (n.d > 0.5) R(t0 + 0.2, 'vib', n.d > 1.2 ? 38 : 26, 0.35);
      if (phraseEnd) {
        const te = t0 + n.d, rel = Math.min(0.5, Math.max(0.12, n.d * 0.25));
        R(te - rel * 0.6, 'ps', 0, rel); R(te - rel * 0.3, 'vib', 0, rel * 0.6);
        R(te + rel * 0.2, 'abd', 0.12e-4, 0.12); R(te + rel + 0.1, 'abd', ADD, 0.1);
        ev.push([te + rel * 0.5, 11, 'x', 0.25, 0]);
      }
    }
  }

  // opt.voice: 'male'（ハ長調, G3–G4）/ 'female'（ト長調へ 7 半音上げ, D4–D5）
  function buildSong(opt) {
    opt = opt || {}; const voiceType = opt.voice || 'male', tr = opt.transpose !== undefined ? opt.transpose : voiceType === 'female' ? 7 : 0;
    const voice = [], piano = [], ped = [], bars = [];
    // テンポ（終わりで少しゆるめる）
    const nb = SCORE.length, e8 = [];
    for (let b = 0; b < nb; b++) for (let k = 0; k < 8; k++) { let f = 1; if (b >= nb - 5) f = 1 + 0.035 * ((b - (nb - 5)) * 8 + k) / 8; if (b >= nb - 2) f = 1.25; e8.push(E8 * f); }
    const T = [LEAD]; for (let i = 0; i < e8.length; i++) T.push(T[i] + e8[i]);
    const at = (bar, k) => { const i = bar * 8 + k, j = Math.floor(i); return j >= T.length - 1 ? T[T.length - 1] : T[j] + (T[j + 1] - T[j]) * (i - j); };
    let lastVowel = 'a';
    SCORE.forEach(([ch, mel], b) => {
      bars.push({ t: at(b, 0), chord: trName(ch.replace('|', ' ').replace('Cend', 'C'), tr) });
      // ---- 歌 ----
      let k = 0;
      for (const [p, len, syl, kana] of mel) {
        if (p !== '-') {
          const n = { t: at(b, k), d: at(b, k + len) - at(b, k), m: nn(p) + tr, syl, kana, bar: b };
          if (syl === '-') n.vowel = lastVowel; else lastVowel = syl.slice(-1);
          voice.push(n);
        }
        k += len;
      }
      // ---- ピアノ ----
      const add = (k2, len, m, v) => piano.push({ t: at(b, k2) + (m > 59 ? 0.012 : 0), d: at(b, k2 + len) - at(b, k2), m, v });
      const B = b < 2 ? 'intro' : b >= nb - 2 ? 'end' : b >= 10 ? 'B' : 'A';
      if (ch === 'Cend') {
        ped.push({ t: at(b, 0) + 0.03, down: false }, { t: at(b, 0) + 0.12, down: true });
        [36, 43, 48, 52, 55, 60, 64, 72].forEach((m, i) => piano.push({ t: at(b, 0) + i * 0.055, d: 5, m: m + tr, v: 40 + (i === 7 ? 8 : 0) }));
        return;
      }
      const halves = ch.split('|');
      halves.forEach((sym, h) => {
        const c = chordTones(trName(sym, tr)), k0 = h * 8 / halves.length, len = 8 / halves.length;
        ped.push({ t: at(b, k0) + 0.03, down: false }, { t: at(b, k0) + 0.11, down: true });
        const bass = up(c.bass, 36), r3 = up(c.root, 48), third = up(c.pcs[1], r3), fifth = up(c.pcs[2], r3), sev = c.pcs[3] !== undefined ? up(c.pcs[3], r3) : r3 + 12;
        const loud = B === 'B' ? 8 : B === 'intro' ? -2 : 0;
        add(k0, len, bass, 54 + loud);
        if (B === 'B') add(k0, len, bass - 12 < 28 ? bass : bass - 12, 44);
        const pat = len === 8 ? [null, fifth - 12, r3, third, fifth, third, sev > fifth ? sev : r3, third] : [null, r3, third, fifth];
        pat.forEach((m, i) => { if (m !== null) add(k0 + i, 1.6, m, 40 + loud + (i % 2 === 0 ? 5 : 0) + (i === 4 ? 3 : 0)); });
        // 右手: 高い所で和音を鳴らす（歌の音域を空ける）
        if (B === 'B' || B === 'end') { add(k0, len, up(c.pcs[1], 72), 38 + loud / 2); add(k0, len, up(c.pcs[2], 72), 36 + loud / 2); if (len === 8) add(4, 4, up(c.pcs[0], 76), 34); }
        else if (B === 'A' && len === 8) { add(2, 6, up(c.pcs[2], 67), 33); add(6, 2, up(c.pcs[1], 72), 31); }
      });
      if (B === 'intro') { // 前奏: サビの旋律の断片を高音で
        const frag = b === 0 ? [['E5', 0, 2], ['F5', 2, 1], ['G5', 3, 5]] : [['G5', 0, 1], ['F5', 1, 1], ['E5', 2, 1], ['D5', 3, 5]];
        for (const [p, k2, len] of frag) add(k2, len, nn(p) + tr, 52);
      }
      if (b === nb - 2) { for (const [p, k2, len] of [['E5', 0, 2], ['D5', 2, 2], ['C5', 4, 4]]) add(k2, len, nn(p) + tr, 44); }
    });
    // 強弱: サビを強く
    for (const n of voice) n.dyn = n.bar >= 10 ? 1.12 : 1.0;
    const ev = [];
    for (const n of piano) { ev.push([n.t, 1, n.m, n.v]); ev.push([n.t + n.d, 0, n.m]); }
    for (const p of ped) ev.push([p.t, p.down ? 3 : 2]);
    compileVoice(voice, ev, tr);
    ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const dur = T[T.length - 1] + 4.5;
    return { title: 'なみのかたち', voiceType, transpose: tr, key: PCN[tr % 12], bpm: BPM, dur, voice, piano, ped, bars, lines: LINES, events: ev };
  }

  const api = { buildSong, CONS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.FableSong = api;
})(typeof self !== 'undefined' ? self : this);
