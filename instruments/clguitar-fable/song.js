/*
 * 「Brisa de Novembro（十一月のそよ風）」 — ボサノヴァ・ソロギターのためのオリジナル曲
 *
 * 形式 : Intro(4) – A(8) – A'(8) – B(8) – A''(8) – Coda(4)   Am / 4分の4 / ♩=138
 * 奏法 : 親指=ベース(6・5弦)、人差し〜薬指=コード(4・3・2弦)のボサノヴァ・パターン、
 *        旋律は1・2弦。弦とフレットは運指ソルバーが決める：コードを押さえたまま
 *        旋律に指が届く（4フレット以内・指4本以内・セーハ可）形だけを使う。
 */
(function (root) {
  'use strict';

  const BPM = 138;
  const OPEN = { 1: 64, 2: 59, 3: 55, 4: 50, 5: 45, 6: 40 };

  // コード: root=根音 alt=交互ベース音 req=必須音(3度・7度) color=彩りの音（すべてピッチクラス）
  // 実際の押さえ方（弦・フレット）は下の運指ソルバーが、旋律と一緒に左手で押さえられる形を選ぶ。
  const CH = {
    'Am7':   { root: 9, alt: 4, req: [0, 7], color: [4, 11] },
    'D9':    { root: 2, alt: 9, req: [6, 0], color: [4, 9] },
    'Dm9':   { root: 2, alt: 9, req: [5, 0], color: [4, 9] },
    'G13':   { root: 7, alt: 2, req: [11, 5], color: [4, 9, 2] },
    'Cmaj9': { root: 0, alt: 7, req: [4, 11], color: [2, 7] },
    'Fmaj7': { root: 5, alt: 0, req: [9, 4], color: [0, 7] },
    'Bm7♭5': { root: 11, alt: 5, req: [2, 9], color: [5] },
    'E7♭9':  { root: 4, alt: 11, req: [8, 2], color: [5, 11] },
    'Gm7':   { root: 7, alt: 2, req: [10, 5], color: [2, 9] },
    'C9':    { root: 0, alt: 7, req: [4, 10], color: [2, 7] },
    'B♭7':   { root: 10, alt: 5, req: [2, 8], color: [5, 0] },
    'Em9':   { root: 4, alt: 11, req: [7, 2], color: [6, 11] },
    'A7♭9':  { root: 9, alt: 4, req: [1, 7], color: [10, 4] },
    'E7♯9':  { root: 4, alt: 11, req: [8, 2], color: [7, 11] },
    'Am6/9': { root: 9, alt: 4, req: [0, 6], color: [11, 4] },
  };

  // 旋律 [開始(8分), 長さ(8分), 音名]。小節線をまたぐ先取音（アンティシペーション）が多い。
  const m1 = [[3, 1, 'D5'], [4, 3, 'C5'], [7, 4, 'B4']];
  const m2 = [[4, 1, 'A4'], [5, 1, 'B4'], [6, 1, 'C5'], [7, 4, 'D5']];
  const m3 = [[3, 1, 'C5'], [4, 3, 'B4'], [7, 4, 'A4']];
  const m12 = [[4, 1, 'G4'], [5, 1, 'B4'], [6, 1, 'D5'], [7, 4, 'E5']];
  const m13 = [[3, 1, 'D5'], [4, 1, 'E5'], [5, 1, 'D5'], [6, 1, 'C5'], [7, 3, 'D5']];
  const m14 = [[3, 1, 'B4'], [4, 1, 'G#4'], [5, 1, 'B4'], [6, 1, 'D5'], [7, 4, 'C5']];
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
    { ch: ['Cmaj9'], mel: [[3, 1, 'C5'], [4, 1, 'D5'], [5, 1, 'E5'], [6, 1, 'D5'], [7, 5, 'E5']] },
    { ch: ['Fmaj7'], mel: [[5, 1, 'D5'], [6, 1, 'C5'], [7, 4, 'D5']] },
    { ch: ['Bm7♭5'], mel: [[3, 1, 'C5'], [4, 2, 'D5'], [6, 1, 'B4'], [7, 4, 'G#4']] },
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
    { ch: ['Em9'], mel: [[3, 1, 'A4'], [4, 3, 'D5'], [7, 4, 'E5']] },
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
    { sec: 'Coda', ch: ['Fmaj7'], mel: [[3, 1, 'D5'], [4, 3, 'C5'], [7, 4, 'E5']] },
    { ch: ['E7♯9'], mel: [[3, 1, 'F5'], [4, 1, 'E5'], [5, 1, 'D5'], [6, 1, 'C5'], [7, 9, 'B4']] },
    { ch: ['Am6/9'], mel: [] },
    { ch: ['Am6/9'], mel: [[0, 14, 'B4']], final: true },
  ];
  const DYN = { 'Intro': 0.9, 'A': 0.96, "A'": 1.0, 'B': 1.06, "A''": 1.0, 'Coda': 0.9 };

  function noteToMidi(n) {
    const m = /^([A-G])([#b]?)(\d)$/.exec(n);
    const base = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }[m[1]];
    return 12 * (parseInt(m[3], 10) + 1) + base + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  }

  // ---------------------------------------------------------------- 運指ソルバー
  const MAX_FRET = 13, SPAN = 3, MEL_STRINGS = [1, 2];
  const pitch = (n) => OPEN[n[0]] + n[1];
  // 人差し指が lo フレットのとき小指が届くフレット差。5フレット以上はフレット間隔が狭いので
  // 5フレット分（例 5〜9f ≒ 129mm）でも、ローポジションの4フレット分（1〜4f ≒ 134mm）より狭い
  const reach = (lo) => (lo >= 5 ? SPAN + 1 : SPAN);

  // 同時に押さえる音 [[弦,フレット]...] に必要な左手の指の本数。押さえられなければ 9 を返す。
  // 人差し指は最低フレット（複数弦ならセーハ）。残りは中指・薬指・小指の順にフレットが上がり、
  // 中指は人差し指の1つ上、薬指は2つ上、小指は3つ上まで（5フレット以上ではさらに1つ上まで）届く。
  function fingersNeeded(held) {
    const fr = held.filter((n) => n[1] > 0);
    if (!fr.length) return 0;
    const p = Math.min.apply(null, fr.map((n) => n[1]));
    const atP = fr.filter((n) => n[1] === p);
    let rest = fr.filter((n) => n[1] > p).map((n) => n[1]);
    if (atP.length > 1) {
      const low = Math.max.apply(null, atP.map((n) => n[0])); // セーハが届く最も低い弦
      const blocked = held.some((n) => n[1] === 0 && n[0] < low); // セーハの下で開放弦は鳴らせない
      if (blocked) rest = rest.concat(atP.slice(1).map((n) => n[1]));
    }
    rest.sort((a, b) => b - a);
    if (rest.length > 3) return 9;
    const slack = reach(p) - SPAN;
    for (let i = 0; i < rest.length; i++) if (rest[i] > p + 3 - i + slack) return 9;
    return 1 + rest.length;
  }

  // コードの押さえ方の候補を全部作る。bassPcs = [[ベース音のピッチクラス, コスト]...]
  function voicings(c, bassPcs) {
    const out = new Map(), allowed = c.req.concat(c.color);
    for (let p = 1; p <= MAX_FRET - SPAN; p++) {
      const on = (s, pcs) => [0, p, p + 1, p + 2, p + 3, p + 4].slice(0, 2 + reach(p)).filter((f) => f <= (s >= 4 ? 12 : MAX_FRET) && pcs.includes((OPEN[s] + f) % 12)).map((f) => [s, f]);
      for (const [bpc, bcost] of bassPcs) for (const bs of [6, 5, 4]) for (const b of on(bs, [bpc])) for (const set of [[4, 3, 2], [4, 3], [3, 2]]) {
        if (set.includes(bs)) continue;
        let combos = [[]];
        for (const s of set) { const nx = []; for (const pre of combos) for (const n of on(s, allowed)) nx.push(pre.concat([n])); combos = nx; }
        for (const comp of combos) {
          const pcs = comp.map((n) => pitch(n) % 12);
          if (new Set(pcs).size !== pcs.length || !c.req.every((q) => pcs.includes(q))) continue;
          if (comp.some((n, i) => i && pitch(n) <= pitch(comp[i - 1])) || pitch(comp[0]) <= pitch(b)) continue;
          const extra = pcs.find((q) => !c.req.includes(q));
          const cost = (comp.length === 2 ? 3 : extra === c.color[0] ? 0 : 0.5) + (bs === 4 ? 1.5 : 0) + bcost
            + (b[1] === 0 ? -0.3 : b[1] > 9 ? 0.8 * (b[1] - 9) : 0) // ベースは開放弦を優先、ハイポジションは避ける
            + 0.4 * comp.filter((n) => n[1] === 0 && p >= 5).length;
          const key = [b].concat(comp).join(';');
          if (!out.has(key) || out.get(key).cost > cost) out.set(key, { bass: b, comp, cost });
        }
      }
    }
    return Array.from(out.values());
  }

  // 1つの区間（半小節）で、押さえ方 v と旋律 mel を一緒に弾けるか。弾ける弦の割り当てをすべて返す
  function fits(v, mel) {
    const top = pitch(v.comp[v.comp.length - 1]);
    const shape = v.comp.concat([v.bass]);
    const strs = v.comp.some((n) => n[0] === 2) ? [1] : MEL_STRINGS;
    const res = [];
    const rec = (i, asg, cost) => {
      if (i === mel.length) {
        const fr = shape.concat(asg).map((n) => n[1]).filter((f) => f > 0);
        const lo = fr.length ? Math.min.apply(null, fr) : null, hi = fr.length ? Math.max.apply(null, fr) : null;
        if (fr.length && hi - lo > reach(lo)) return;
        let mx = fingersNeeded(shape);
        for (const m of asg) mx = Math.max(mx, fingersNeeded(shape.concat([m])));
        if (mx > 4) return;
        res.push({
          cost: cost + (mx === 4 ? 0.8 : 0) + (fr.length && hi - lo >= SPAN ? 0.5 + (hi - lo - SPAN) : 0) + (lo > 7 ? 0.7 * (lo - 7) : 0),
          mel: asg.slice(), pos: lo,
        });
        return;
      }
      for (const s of strs) {
        const f = mel[i].midi - OPEN[s];
        if (f < 0 || f > MAX_FRET || mel[i].midi <= top) continue;
        asg.push([s, f]);
        rec(i + 1, asg, cost + (s === 2 ? 0.6 : 0) + (mel[i].midi - top < 2 ? 1 : 0));
        asg.pop();
      }
    };
    rec(0, [], v.cost);
    return res;
  }

  // 曲全体：半小節ごとの押さえ方を、押さえ替えとポジション移動が少なくなるように選ぶ（ビタビ法）
  function solveFingering() {
    const regions = [], first = [];
    BARS.forEach((bar, bi) => {
      first[bi] = regions.length;
      const two = bar.ch.length === 2;
      for (let h = 0; h < (bar.final ? 1 : 2); h++) {
        const name = bar.ch[two ? h : 0], c = CH[name];
        regions.push({ bar: bi, half: h, chord: name, mel: [], tie: false, // ベース音の候補：1拍目は根音、3拍目は交互ベース（届かなければ根音か3度・7度）
          bassPcs: h === 0 || two ? [[c.root, 0]] : [[c.alt, 0], [c.root, 1]].concat(c.req.map((q) => [q, 2.5])) });
      }
    });
    BARS.forEach((bar, bi) => bar.mel.forEach(([st, d], ni) => {
      let r = first[bi] + (st >= 4 && !bar.final ? 1 : 0), e = st + d;
      if (st === 7 && bi + 1 < BARS.length) { r = first[bi + 1]; e -= 8; } // 先取音は次のコードの形で弾く
      else if (st >= 4) e -= 4;
      const m = { bar: bi, ni, midi: noteToMidi(bar.mel[ni][2]) };
      regions[r].mel.push(m);
      // 半小節をまたいで伸ばす音は、次の区間でも同じ指で押さえ続ける
      if (e > 4.5 && !bar.final && regions[r + 1] && !BARS[regions[r + 1].bar].final) { regions[r + 1].mel.unshift(m); regions[r + 1].tie = true; }
    }));
    const cache = {}, fails = [];
    regions.forEach((r) => {
      const key = r.chord + ':' + r.bassPcs[0][0];
      const vs = cache[key] || (cache[key] = voicings(CH[r.chord], r.bassPcs));
      r.cands = [];
      for (const v of vs) for (const f of fits(v, r.mel)) r.cands.push({ v, f, total: 0, prev: -1 });
      if (!r.cands.length) fails.push('小節' + (r.bar + 1) + (r.half ? '後半 ' : '前半 ') + r.chord);
    });
    if (fails.length) throw new Error('弾ける運指がありません: ' + fails.join(' / '));
    for (let i = 0; i < regions.length; i++) for (const c of regions[i].cands) {
      c.total = c.f.cost;
      if (!i) continue;
      let bt = Infinity;
      regions[i - 1].cands.forEach((q, qi) => {
        if (regions[i].tie && q.f.mel[q.f.mel.length - 1].join() !== c.f.mel[0].join()) return;
        const move = c.f.pos === null || q.f.pos === null ? 0 : Math.abs(c.f.pos - q.f.pos);
        const t = q.total + 1.0 * move + (q.v.comp.join() === c.v.comp.join() ? -1 : 0);
        if (t < bt) { bt = t; c.prev = qi; }
      });
      c.total += bt;
    }
    const last = regions[regions.length - 1].cands;
    let k = last.reduce((b, c, i) => (c.total < last[b].total ? i : b), 0);
    if (!isFinite(last[k].total)) throw new Error('弾ける運指のつながりがありません');
    const melMap = {};
    for (let i = regions.length - 1; i >= 0; i--) {
      const r = regions[i], c = r.cands[k];
      r.bass = c.v.bass; r.comp = c.v.comp; r.pos = c.f.pos; r.melFing = c.f.mel;
      r.mel.forEach((m, j) => { melMap[m.bar + ':' + m.ni] = c.f.mel[j]; });
      k = c.prev; delete r.cands;
    }
    return { regions, first, melMap };
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

    const fing = solveFingering();
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
      const chA = fing.regions[fing.first[bi]], chB = bar.final ? chA : fing.regions[fing.first[bi] + 1];
      bars.push({
        index: bi, t0: tAt(e0), t1: tAt(e0 + 8),
        chords: two ? [{ name: bar.ch[0], t: tAt(e0) }, { name: bar.ch[1], t: tAt(e0 + 4) }] : [{ name: bar.ch[0], t: tAt(e0) }],
      });

      if (bar.final) {
        // 終止：Am6/9 をゆっくりロールして響かせる
        const roll = [chA.bass].concat(chA.comp, [fing.melMap[bi + ':0']]);
        roll.forEach(([s, f], i) => add(i === 0 ? 'bass' : i === roll.length - 1 ? 'mel' : 'comp', e0, 14, s, f, i === roll.length - 1 ? 0.8 : 0.62, i * 0.075));
        return;
      }

      // 親指のベース（1拍目=ルート、3拍目=交互ベース）
      add('bass', e0, 2.7, chA.bass[0], chA.bass[1], 0.86);
      add('bass', e0 + 4, 2.7, chB.bass[0], chB.bass[1], 0.78);

      // 指のコード：2小節のボサノヴァ・パターン  |x..x..x.|..x..x..|
      const hits = bi % 2 === 0 ? [[0, 0.9, 0.62], [3, 1.5, 0.74], [6, 1.2, 0.66]] : [[2, 1.5, 0.72], [5, 1.4, 0.64]];
      hits.forEach(([h, d, v]) => {
        const c = h >= 4 ? chB : chA;
        if (h === 3 && chA.comp.join() !== chB.comp.join()) d = 1.0; // 後半で押さえ替えるので早めに離す
        c.comp.forEach(([s, f], i) => add('comp', e0 + h, d, s, f, v + (i === c.comp.length - 1 ? 0.03 : 0), i * 0.004));
      });

      // 旋律（1・2弦）
      bar.mel.forEach(([st, d, name], ni) => {
        const [s, f] = fing.melMap[bi + ':' + ni];
        const acc = st === 7 ? 1.0 : d >= 3 ? 0.95 : 0.86;
        add('mel', e0 + st, d - 0.08, s, f, acc);
      });
    });

    notes.sort((a, b) => a.t - b.t);
    const end = notes.reduce((m, n) => Math.max(m, n.t + n.dur), 0);
    return {
      title: 'Brisa de Novembro', subtitle: '十一月のそよ風', bpm: BPM,
      notes, bars, sections, duration: end + 3.0, fingering: fing.regions,
    };
  }

  const api = { buildSong, CH, OPEN, fingersNeeded, reach };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.GuitarSong = api;
})(typeof self !== 'undefined' ? self : globalThis);
