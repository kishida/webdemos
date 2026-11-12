/*
 * song.js — 行進曲「真鍮の夜明け」(Brass Daybreak March)
 *
 * 旋律・コード進行・対旋律を手書きし、伴奏（チューバのベース、ホルンの後打ち、
 * 2ndトランペットのハモリ、打楽器）は編曲ルールで自動生成する。
 * 記法: "音名オクターブ/長さ(16分音符単位)"  例: bb4/2 = B♭4 を8分音符, r/4 = 4分休符
 *       末尾の . はスタッカート, > はアクセント, _ は次の音へスラー
 */
(function (root) {
  'use strict';

  const BPM = 116;            // 2/4拍子、4分音符 = 116
  const S16 = 60 / BPM / 4;   // 16分音符の秒数

  // 奏者（ステージ上の並び順）
  const PLAYERS = [
    // 金管は各パート1人ずつの5人。音を重ねすぎず、役割がはっきり聞こえる編成にする
    { id: 'tp',   name: 'Trumpet',   jp: 'トランペット',   inst: 'trumpet',   pan: -0.40, detune: 0,  gain: 1.00 },
    { id: 'hn',   name: 'Horn',      jp: 'ホルン',         inst: 'horn',      pan: -0.15, detune: -2, gain: 0.85 },
    { id: 'tb',   name: 'Trombone',  jp: 'トロンボーン',   inst: 'trombone',  pan: 0.60,  detune: -2, gain: 0.90 },
    { id: 'eu',   name: 'Euphonium', jp: 'ユーフォニアム', inst: 'euphonium', pan: 0.40,  detune: 2,  gain: 1.15 },
    { id: 'tu',   name: 'Tuba',      jp: 'チューバ',       inst: 'tuba',      pan: 0.0,   detune: 0,  gain: 1.00 },
    { id: 'solo', name: 'Solo',      jp: '試奏',           inst: 'trumpet',   pan: 0.0,   detune: 0,  gain: 1.10 },
  ];
  const P = {}; PLAYERS.forEach((p, i) => (P[p.id] = i));

  // ---- 記法のパーサ ------------------------------------------------------
  const NOTE = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
  function pitch(s) {
    const m = /^([a-g])([#b]?)(\d)$/.exec(s);
    if (!m) throw new Error('bad pitch: ' + s);
    return 12 * (+m[3] + 1) + NOTE[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  }
  function parseBar(str) {
    const out = []; let pos = 0;
    if (!str) return out;
    for (const tok of str.trim().split(/\s+/)) {
      const m = /^([a-g][#b]?\d|r)\/(\d+)([.>_]*)$/.exec(tok);
      if (!m) throw new Error('bad token: ' + tok);
      const len = +m[2];
      if (m[1] !== 'r') out.push({ pos, len, m: pitch(m[1]), stac: m[3].includes('.'), acc: m[3].includes('>'), slur: m[3].includes('_') });
      pos += len;
    }
    if (pos !== 8) throw new Error('bar length ' + pos + ': ' + str);
    return out;
  }
  const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  function parseChord(s) {
    const m = /^([A-G])([#b]?)(m|7|dim|)(?:\/([A-G])([#b]?))?$/.exec(s);
    if (!m) throw new Error('bad chord: ' + s);
    const acc = (a) => (a === '#' ? 1 : a === 'b' ? -1 : 0);
    const rootPc = (PC[m[1]] + acc(m[2]) + 12) % 12;
    const iv = m[3] === 'm' ? [0, 3, 7] : m[3] === '7' ? [0, 4, 7, 10] : m[3] === 'dim' ? [0, 3, 6, 9] : [0, 4, 7];
    return { root: rootPc, q: m[3], pcs: iv.map((i) => (rootPc + i) % 12), bass: m[4] ? (PC[m[4]] + acc(m[5]) + 12) % 12 : rootPc, slash: !!m[4] };
  }
  // 1小節のコード（"C7,F" のように , で半小節ずつ）
  function parseChords(s) { const a = s.split(',').map(parseChord); return a.length === 1 ? [a[0], a[0]] : a; }
  const place = (pc, lo) => { let m = lo; while (m % 12 !== pc) m++; return m; };

  // ---- 楽譜 --------------------------------------------------------------
  const INTRO = {
    name: '序奏', en: 'Introduction', key: 'Bb', dyn: 0.84, mode: 'tutti',
    chords: ['Bb', 'Bb', 'Eb,Bb/F', 'F'],
    mel: [
      'bb4/2> bb4/1 bb4/1 d5/2 f5/2',
      'bb5/4> a5/1 g5/1 f5/2',
      'g5/2> eb5/1 g5/1 f5/2 d5/2',
      'c5/2> c5/1 c5/1 f5/4>',
    ],
    // 序奏は全員が同じ動きをしないよう、役割を分けて書く:
    //  トランペット … ファンファーレ
    //  トロンボーン … 1小節遅れでファンファーレを追いかける（カノン）。4小節目で合流
    //  ユーフォニアム … 低い音を伸ばして支える
    //  ホルン … 和音の3度を伸ばして支える
    //  チューバ … 拍ごとのベース
    parts: {
      hn:  ['d4/8>', 'd4/8', 'eb4/4 d4/4', 'c4/4 f4/4>'],
      tb:  ['f3/8>', 'bb3/2> bb3/1 bb3/1 d4/2 f4/2', 'bb4/4> a4/1 g4/1 f4/2', 'eb4/2> eb4/1 eb4/1 c4/4>'],
      eu:  ['bb2/8>', 'bb2/8', 'eb3/4 f3/4', 'f3/2> f3/1 f3/1 f3/4>'],
      tu:  ['bb1/4> bb1/4', 'bb1/4 d2/4', 'eb2/4 f2/4', 'f2/2> f2/1 f2/1 f2/4>'],
    },
    partVel: { hn: 0.8, tb: 0.9, eu: 0.85, tu: 0.95 },
  };

  const A_MEL = [
    'd5/3 c5/1 d5/2 f5/2', 'f5/2 d5/2 bb4/4', 'eb5/3 d5/1 eb5/2 g5/2', 'g5/2 f5/2 d5/4',
    'c5/3 b4/1 c5/2 eb5/2', 'eb5/2 c5/2 a4/4', 'bb4/2 d5/2 f5/2 d5/2', 'e5/2 g5/2 f5/4',
    'd5/3 c5/1 d5/2 f5/2', 'ab5/4> f5/2 d5/2', 'g5/3 f5/1 g5/2 bb5/2', 'bb5/2> g5/2 e5/4',
    'f5/2 d5/1 f5/1 bb5/2 f5/2', 'g5/2 eb5/1 g5/1 f5/2 a4/2', 'bb4/2 bb4/1 bb4/1 d5/2 f5/2', 'bb5/2> r/2 bb4/2> r/2',
  ];
  const A_CH = ['Bb', 'Bb', 'Eb', 'Bb', 'Cm', 'F7', 'Bb', 'C7,F', 'Bb', 'Bb7', 'Eb', 'Edim', 'Bb/F', 'F7', 'Bb', 'Bb'];
  const A1 = { name: '第1マーチ', en: 'First Strain', key: 'Bb', dyn: 0.81, chords: A_CH, mel: A_MEL, tutti: [15], tb: 'off', eu: 'tacet' };
  const A2 = Object.assign({}, A1, { name: '第1マーチ（反復）', en: 'First Strain (repeat)', dyn: 0.87, tb: 'mel8', eu: 'pad', cym: true });

  const B = {
    name: '第2マーチ', en: 'Second Strain', key: 'Bb', dyn: 0.88, cym: true, tb: 'mel8', eu: 'off', tutti: [15],
    chords: ['Gm', 'D7', 'D7', 'Gm', 'Eb', 'Bb', 'C7', 'F', 'Bb', 'Eb', 'Bb', 'F7', 'Bb', 'Eb,Edim', 'Bb/F,F7', 'Bb'],
    mel: [
      'r/8', 'r/2 d5/1 d5/1 f#5/2 a5/2', 'r/8', 'r/2 d5/1 d5/1 g5/2 bb5/2',
      'r/8', 'r/2 bb4/1 bb4/1 d5/2 f5/2', 'r/8', 'r/2 a4/1 a4/1 c5/2 f5/2',
      'bb5/3> a5/1 g5/2 f5/2', 'g5/3 f5/1 eb5/2 d5/2', 'f5/3 eb5/1 d5/2 c5/2', 'eb5/2 c5/2 a4/2 f4/2',
      'd5/2 bb4/1 d5/1 f5/2 d5/2', 'g5/2 eb5/1 g5/1 bb5/2 g5/2', 'bb5/2> f5/2 eb5/2 c5/2', 'bb4/2> r/2 bb5/2> r/2',
    ],
    low: [
      'g3/2> a3/2 bb3/2 d4/2', 'f#4/4> d4/4', 'a3/2> c4/2 d4/2 f#4/2', 'g4/4> d4/4',
      'eb3/2> f3/2 g3/2 bb3/2', 'd4/4> bb3/4', 'c4/2> d4/2 e4/2 g4/2', 'f4/4> f3/2 r/2',
    ],
  };

  const TRIO_MEL = [
    'g5/6_ f5/2', 'eb5/4_ bb4/4', 'c5/6_ d5/2', 'eb5/8',
    'f5/6_ eb5/2', 'd5/4_ bb4/4', 'g5/4_ f5/2_ eb5/2', 'f5/8',
    'g5/6_ f5/2', 'eb5/4_ db5/4', 'c5/4_ eb5/2_ ab5/2', 'gb5/6_ eb5/2',
    'g5/6_ eb5/2', 'f5/4_ ab5/2 d5/2', 'eb5/8', 'eb5/4 r/4',
  ];
  const TRIO_CH = ['Eb', 'Eb', 'Ab', 'Eb', 'Fm', 'Bb7', 'Eb', 'Bb7', 'Eb', 'Eb7', 'Ab', 'Adim', 'Eb/Bb', 'Bb7', 'Eb', 'Eb'];
  const COUNTER = [
    'r/2 bb3/2 eb4/2 bb4/2', 'bb4/2 g4/2 eb4/2 bb3/2', 'c4/2 eb4/2 ab4/4', 'bb4/2 g4/2 eb4/2 bb3/2',
    'r/2 c4/2 f4/2 ab4/2', 'ab4/2 f4/2 d4/2 bb3/2', 'eb4/2 g4/2 bb4/2 g4/2', 'f4/2 d4/2 bb3/2 d4/2',
    'r/2 bb3/2 eb4/2 bb4/2', 'bb4/2 g4/2 bb4/2 g4/2', 'c4/2 eb4/2 ab4/2 c5/2', 'c5/2 a4/2 gb4/2 eb4/2',
    'bb3/2 eb4/2 g4/2 bb4/2', 'ab4/2 f4/2 d4/2 f4/2', 'eb4/2 bb3/2 g3/2 bb3/2', 'eb4/4 r/4',
  ];
  // トリオの旋律はユーフォニアムがオクターブ下で歌う（トランペットは休み）。
  // 2回目はトランペットがその上で対旋律を吹く。グランディオーソではトランペットが旋律に戻り、
  // ユーフォニアムが対旋律、トロンボーンはホルンと裏打ちに回る
  const TRIO1 = { name: 'トリオ', en: 'Trio', key: 'Eb', dyn: 0.88, chords: TRIO_CH, mel: TRIO_MEL, legato: true, tp: 'tacet', tb: 'tacet', eu: 'mel8', soft: true };
  const TRIO2 = Object.assign({}, TRIO1, { name: 'トリオ（対旋律）', en: 'Trio with countermelody', dyn: 0.92, tp: 'counter', counter: COUNTER, glock: true });

  const BREAK = {
    name: 'ブレイク', en: 'Break Strain', key: 'Eb', dyn: 0.97, mode: 'tutti', cym: true, rollEnd: true,
    chords: ['Bb7', 'Bb7', 'Bb7', 'Eb', 'Bb7', 'Bb7', 'Bb7', 'Bb7'],
    mel: [
      'r/8', 'r/2 f5/1 f5/1 ab5/2> f5/2', 'r/8', 'r/2 g5/1 g5/1 bb5/2> g5/2',
      'bb5/2> a5/2 ab5/2 g5/2', 'gb5/2 f5/2 e5/2 eb5/2', 'd5/2> d5/1 d5/1 f5/2 ab5/2', 'bb5/4> r/4',
    ],
    low: [
      'bb3/2> bb3/1 bb3/1 b3/2 c4/2', 'd4/2> r/6', 'c4/2> c4/1 c4/1 db4/2 d4/2', 'eb4/2> r/6',
      'bb4/2> a4/2 ab4/2 g4/2', 'gb4/2 f4/2 e4/2 eb4/2', 'd4/2> d4/1 d4/1 f4/2 ab4/2', 'bb3/4> r/4',
    ],
  };

  const GRAND_MEL = TRIO_MEL.slice(0, 14).concat(['eb5/2> bb4/1 bb4/1 eb5/2 g5/2', 'bb5/2> r/2 eb5/4>']);
  const GRAND = {
    name: 'グランディオーソ', en: 'Grandioso', key: 'Eb', dyn: 0.98, chords: TRIO_CH, mel: GRAND_MEL,
    cym: true, tb: 'off', eu: 'counter', counter: COUNTER.slice(0, 14).concat(['eb4/2 bb3/1 bb3/1 eb4/2 g4/2', 'bb4/2 r/2 eb4/4']), glock: true, tutti: [15], final: true,
  };

  const FORM = [INTRO, A1, A2, B, TRIO1, TRIO2, BREAK, GRAND];

  // ---- 編曲 --------------------------------------------------------------
  function build() {
    const events = [];   // エンジンへ渡すイベント
    const notes = [];    // 可視化用 {p, t, d, m, v}
    const hits = [];     // 可視化用の打楽器
    const sections = [];
    let id = 1, seed = 20261110;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };

    function note(p, t16, len16, m, vel, o) {
      o = o || {};
      const inst = PLAYERS[p].inst;
      const range = { trumpet: [52, 86], horn: [41, 77], trombone: [40, 74], euphonium: [38, 74], tuba: [28, 60] }[inst];
      while (m < range[0]) m += 12;
      while (m > range[1]) m -= 12;
      const t = t16 * S16 + (rnd() - 0.5) * 0.010 + (o.late || 0);
      let art = o.stac ? 0.5 : o.slur ? 1.02 : o.legato ? 0.96 : (len16 <= 1 ? 0.8 : 0.86);
      let d = len16 * S16 * art;
      if (!o.stac && !o.slur && !o.legato) d = Math.min(d, len16 * S16 - 0.03);
      const v = Math.max(0.3, Math.min(1, vel * (o.acc ? 1.12 : 1) * (0.96 + rnd() * 0.08)));
      const nid = id++;
      events.push({ k: 1, t: Math.max(0, t), p, m, v, sl: o.prevSlur ? 1 : 0, id: nid });
      events.push({ k: 0, t: Math.max(0, t) + d, p, id: nid });
      notes.push({ p, t: Math.max(0, t), d, m, v });
    }
    function perc(kind, t16, vel, m) {
      const t = Math.max(0, t16 * S16 + (rnd() - 0.5) * 0.004);
      events.push({ k: 2, t, d: kind, v: Math.min(1, vel), m: m || 0 });
      hits.push({ kind, t, v: vel, m: m || 0 });
    }
    function line(p, bar16, parsed, vel, o, tr) {
      let prevSlur = false;
      for (const n of parsed) {
        note(p, bar16 + n.pos, n.len, n.m + (tr || 0), vel, Object.assign({}, o, { stac: n.stac, acc: n.acc, slur: n.slur, prevSlur }));
        prevSlur = n.slur;
      }
    }
    // ユーフォニアムの伸ばし（第1マーチの反復で使う）: 和音が変わるごとに1音、長い音で支える。
    // 和音の中でほかの音と2度でぶつかる音は選ばない。
    //  例: C7 で根音の C を伸ばすと、ホルンが後打ちで鳴らす7度の B♭ と濁る → 5度の G を取る
    const euState = { prev: 53 };
    function sustained(chords, mel) {
      const out = [];
      for (let h = 0; h < 2; h++) {
        const ch = chords[h];
        let best = null, bs = 1e9;
        for (let q = 46; q <= 56; q++) {   // 旋律をオクターブ下でなぞるトロンボーン(A3〜)より下に置く
          if (!ch.pcs.includes(q % 12)) continue;
          let c = Math.abs(q - euState.prev);
          // 和音のほかの音（ホルンの後打ち、チューバの根音）と2度になる音は避ける。7thコードなら根音と7度が外れ、5度か3度が残る
          for (const hp of ch.pcs) { const d = ((q - hp) % 12 + 12) % 12; if (d === 1 || d === 2 || d === 10 || d === 11) c += 20; }
          // 旋律がその半小節で通る音（刺繍音・経過音を含む）とも2度にしない
          for (const n of mel) if (n.pos >= h * 4 && n.pos < h * 4 + 4) { const d = ((q - n.m) % 12 + 12) % 12; if (d === 1 || d === 2 || d === 10 || d === 11) c += 8; }
          if (c < bs) { bs = c; best = q; }
        }
        euState.prev = best;
        if (h === 1 && out[0].m === best) out[0].len = 8;
        else out.push({ pos: h * 4, len: 4, m: best, stac: false, acc: false, slur: false });
      }
      return out;
    }

    const offState = { hn: { prev: 0 }, lo: { prev: 0 } };

    let bar0 = 0;
    for (const sec of FORM) {
      const nb = sec.mel.length;
      sections.push({ name: sec.name, en: sec.en, t: bar0 * 8 * S16, bars: nb, bar0 });
      const dyn = sec.dyn;
      for (let b = 0; b < nb; b++) {
        const t0 = (bar0 + b) * 8;
        const chords = parseChords(sec.chords[b]);
        const mel = parseBar(sec.mel[b]);
        const low = sec.low && sec.low[b] ? parseBar(sec.low[b]) : null;
        const counter = sec.counter && sec.counter[b] ? parseBar(sec.counter[b]) : null;
        const tutti = sec.mode === 'tutti' || (sec.tutti && sec.tutti.includes(b));
        const lg = { legato: !!sec.legato };
        const pad = sec.eu === 'pad' && !tutti && !low ? sustained(chords, mel) : [];
        const mel8 = mel.map((n) => Object.assign({}, n, { m: n.m - 12 }));
        // 対旋律は2音ずつスラーでつなぐ。
        //  トリオ2回目: トランペットが、ユーフォニアムの旋律の上で吹く（オクターブ上げて旋律とかぶらない音域に）
        //  グランディオーソ: ユーフォニアムが、トランペットの旋律の下で吹く（書いたままの高さ）
        const cntAt = (tr) => (counter ? counter.map((n, i) => Object.assign({}, n, { m: n.m + tr, slur: i % 2 === 0 && i < counter.length - 1 })) : []);
        const cnt = sec.tp === 'counter' ? cntAt(12) : sec.eu === 'counter' ? cntAt(0) : [];
        const lastBar = b === nb - 1;
        // クレッシェンド気味に: フレーズ後半を少し強く
        const dv = dyn * (1 + 0.04 * Math.sin((b % 8) / 8 * Math.PI));

        // --- 旋律（トリオではトランペットは休み、ユーフォニアムが歌う）
        if (sec.tp === 'counter') { if (!tutti) line(P.tp, t0, cnt, dv * 0.72, { legato: true }); }
        else if (sec.tp !== 'tacet') line(P.tp, t0, mel, dv, lg);

        if (tutti) {
          if (sec.parts) {
            // --- パートごとに書き分けた小節（序奏）
            for (const id in sec.parts) line(P[id], t0, parseBar(sec.parts[id][b]), dv * (sec.partVel[id] || 0.85), id === 'hn' ? { legato: true } : lg);
          } else {
            // --- 全員で同じリズム（各区間の決めの小節、ブレイク）
            line(P.hn, t0, mel8, dv * 0.78, lg);
            const lowLine = low || mel8;
            line(P.tb, t0, lowLine, dv * 0.86, lg);
            line(P.eu, t0, lowLine, dv * 0.82, lg);
            if (low) line(P.tu, t0, low, dv, lg, -12);
            else for (const n of mel) note(P.tu, t0 + n.pos, n.len, place(chords[n.pos < 4 ? 0 : 1].bass, 34), dv, { acc: n.acc });
          }
          // 打楽器はリズムの頭を全部叩く
          const on = new Set(); mel.forEach((n) => on.add(n.pos)); if (low) low.forEach((n) => on.add(n.pos));
          for (const pos of on) {
            perc('sn', t0 + pos, 0.55 + (pos % 4 === 0 ? 0.3 : 0));
            if (pos % 4 === 0) perc('bd', t0 + pos, 0.9);
          }
          if (on.has(0) && (b === 0 || lastBar || sec.cym)) perc('cy', t0, b === 0 || lastBar ? 0.9 : 0.5);
          if (lastBar && on.has(4)) perc('cy', t0 + 4, sec.final ? 1 : 0.8);
          if ((lastBar && !sec.tutti) || (sec.rollEnd && lastBar)) for (let i = 0; i < 16; i++) perc('sn', t0 + 4 + i * 0.25, 0.25 + i * 0.035);
        } else {
          // --- 低音・中音
          if (low) {
            // 低音の旋律はトロンボーンとチューバ（オクターブ下）。ユーフォニアムは重ねない
            line(P.tb, t0, low, dv, lg);
            line(P.tu, t0, low, dv, lg, -12);
          } else {
            // チューバ: 拍の頭で根音と5度を交互に
            for (let beat = 0; beat < 2; beat++) {
              const ch = chords[beat];
              let m = place(ch.bass, 34);
              const same = chords[0] === chords[1];
              if (beat === 1 && same && !ch.slash && ch.q !== 'dim') { m = place((ch.root + 7) % 12, 34); if (m > place(ch.root, 34) && m - 12 >= 34) m -= 12; }   // 5度は根音の下に取るが、B♭1 より下には行かない
              note(P.tu, t0 + beat * 4, 2, m, dv * (beat === 0 ? 1 : 0.92), { stac: sec.soft ? false : false });
            }
            if (sec.tb === 'mel8') line(P.tb, t0, mel8, dv * 0.92, lg);
            if (sec.eu === 'counter') line(P.eu, t0, cnt, Math.min(1, dv * 1.02), { legato: true });
            if (sec.eu === 'pad') line(P.eu, t0, pad, dv * 0.74, { legato: true });
            if (sec.eu === 'mel8') line(P.eu, t0, mel8, sec.tp === 'tacet' ? dv : dv * 0.9, lg);
          }
          // 後打ち: ホルンが和音の3度、もう1人（トロンボーンかユーフォニアム）が7度または5度
          for (let beat = 0; beat < 2; beat++) {
            const ch = chords[beat];
            const third = ch.pcs[1], top = ch.q === '7' ? ch.pcs[3] : ch.pcs[2];
            const pos = t0 + beat * 4 + 2;
            // その拍でほかのパートが鳴らしている音は避け、後打ち同士も別の音にする
            const used = new Set(), h0 = beat * 4;
            const sounding = [sec.tp !== 'tacet' && sec.tp !== 'counter' ? mel : [], sec.tb === 'mel8' || sec.eu === 'mel8' ? mel8 : [], pad, cnt, low || []];
            for (const part of sounding) for (const n of part) if (n.pos < h0 + 4 && n.pos + n.len > h0) used.add(n.m);
            const near = (target, lo, hi, prefer, st) => {
              let best = null, bs = 1e9;
              for (let q = lo; q <= hi; q++) {
                if (!ch.pcs.includes(q % 12) || used.has(q)) continue;
                let near2 = 0; for (const u of used) if (Math.abs(q - u) <= 2) near2 = 6;   // 鳴っている音のすぐ隣（2度）も避ける
                const c = Math.abs(q - target) * 0.5 + (prefer.includes(q % 12) ? 0 : 1.5) + (st && st.prev ? Math.abs(q - st.prev) * 0.6 : 0) + near2;   // 前の拍から跳びすぎない
                if (c < bs) { bs = c; best = q; }
              }
              if (best == null) best = place(prefer[0], lo);
              used.add(best);
              if (st) st.prev = best;
              return best;
            };
            const hp = near(62, 55, 67, [third], offState.hn);
            note(P.hn, pos, 2, hp, dv * 0.84, { stac: true });
            // もう1人は、ホルンが取らなかった方（3度か7度/5度）を取る
            const rest = [third, top].filter((pc) => pc !== hp % 12);
            if (sec.tb === 'off' && !low) note(P.tb, pos, 2, near(55, 48, 60, rest, offState.lo), dv * 0.82, { stac: true });
            if (sec.eu === 'off' && !low) note(P.eu, pos, 2, near(55, 48, 60, rest, offState.lo), dv * 0.8, { stac: true });
          }
          // --- 打楽器
          const s = sec.soft ? 0.45 : 1;
          perc('bd', t0, 0.85 * s); perc('bd', t0 + 4, 0.7 * s);
          if (sec.cym) { perc('cy', t0, b % 8 === 0 ? 0.85 : 0.4); }
          else if (b === 0 && !sec.soft) perc('cy', t0, 0.7);
          const fill = b % 4 === 3;
          const pat = fill ? [[0, 0.8], [2, 0.6], [3, 0.5], [4, 0.8]] : [[0, 0.75], [2, 0.5], [3, 0.4], [4, 0.7], [6, 0.5], [7, 0.4]];
          for (const [pos, v] of pat) perc('sn', t0 + pos, v * s * dyn);
          if (fill) for (let i = 0; i < 12; i++) perc('sn', t0 + 5 + i * 0.25, (0.22 + i * 0.04) * s * dyn);
        }
        // --- グロッケン（旋律をオクターブ上で）
        if (sec.glock) for (const n of mel) perc('gl', t0 + n.pos, 0.55 * dyn, n.m + 12);
      }
      bar0 += nb;
    }

    // 最後の音は少し長く伸ばす
    const endT = bar0 * 8 * S16;
    events.sort((a, b) => a.t - b.t || a.k - b.k);
    return { title: '行進曲「真鍮の夜明け」', en: 'Brass Daybreak March', bpm: BPM, s16: S16, players: PLAYERS, events, notes, hits, sections, bars: bar0, duration: endT + 2.5 };
  }

  const song = build();
  if (typeof module !== 'undefined' && module.exports) module.exports = song;
  else root.MarchSong = song;
})(typeof self !== 'undefined' ? self : this);
