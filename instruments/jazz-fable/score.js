/*
 * "Waveguide Blues" — リード（テナーサックス / トランペット / フルート）・ピアノ・ウッドベースのための F のブルース（オリジナル）
 *
 * buildSong('sax' | 'soprano' | 'trumpet' | 'flute') : リード楽器ごとに、音域と奏法に合わせた別の譜面を持つ。
 *   サックス   … 中音域のビバップ。裏拍を軽くタンギングして表拍へスラー、しゃくり・フォール・グロウル
 *   ソプラノ   … テナーの譜面を 1 オクターブ上で
 *   トランペット … 同音連打のリフ、倍音列をまたぐアルペジオ、ハイ C の山場。フレーズの中は息を切らず、裏拍を軽く突く
 *   フルート   … 1 オクターブ上。息継ぎのある短いフレーズ、走句はスラー、8 分は裏拍を突いて表拍へスラー、伸ばしてビブラート。フォールは使わない
 *
 * 構成: イントロ 4 | テーマ 12×2 | サックスソロ 12×2 | ピアノソロ 12×2 | 後テーマ 12 | タグ 4+2 | 終止 2
 *
 * 記法（1 小節 = 4 拍、小節は | で区切る。合わなければエラー）
 *   音名+オクターブ+音価   C4 = 中央ド。音価 w 全 h 2分 q 4分 e 8分 s 16分 t 3連8分 T 3連4分、"." 付点、"+" で連結
 *   r 休符   [C4 E4 G4]q 和音   !mf 強弱
 *   修飾: > アクセント  ' スタッカート  ? ゴースト  ~ ビブラート / (ピアノ)ゆっくり崩す
 *         / しゃくり上げ  _ フォール  * グロウル（フルートでは裏返り。わざとらしいので今は譜面で使っていない）  ^ はっきりタンギング  = (ベース)スライドでつなぐ
 * 8 分音符の裏拍はスウィングさせる（16 分と 3 連は楽譜どおり）。
 */
function buildSong(lead) {
  'use strict';
  lead = lead || 'sax';
  const BPM = 132, SW = 0.635;
  const DYN = { pp: 0.28, p: 0.38, mp: 0.48, mf: 0.6, f: 0.74, ff: 0.88 };
  const BLUES = [['F7'], ['Bb7'], ['F7'], ['Cm7', 'F7'], ['Bb7'], ['Bdim7'], ['F7'], ['Am7', 'D7'], ['Gm7'], ['C7'], ['F7', 'D7'], ['Gm7', 'C7']];
  const TURN = [['Gm7'], ['C7'], ['F7', 'D7'], ['Gm7', 'C7']];

  // ---------------------------------------------------------------- 譜面
  const HEAD = `
    F4e A4e C5q' re D5e C5e A4e | Ab4e F4q.~ rh |
    F4e A4e C5q' re D5e C5e A4e | C5e Eb5q> C5e A4e F4e Eb4q |
    D4e F4e Ab4q' re Bb4e Ab4e F4e | D4e F4q.~ rh |
    F4e A4e C5q' re D5e C5e A4e | C5e A4e re F#4e A4e C5e Eb5q> |
    D5q./ Bb4e G4e Bb4e D5e C5e | Bb4e G4e E4e G4e Bb4q A4e G4e |`;
  const TAIL = `D5q./ Bb4e G4e Bb4e D5e C5e | Bb4e G4e E4e G4e Bb4q A4e G4e |`;
  const FILL = `rw | rh re [Ab4 D5]e re [Ab4 D5]e' | rw | rw | rw | rh re [Ab4 D5 F5]e re [Ab4 D5 F5]e' | rw | rw | rw | rw |`;

  const up8 = t => t.replace(/([A-G][#b]?)(\d)/g, (m, n, o) => n + (+o + 1));   // 1 オクターブ上へ
  const plain = t => t.replace(/[\/_*]/g, '');                                       // しゃくり・フォール・グロウルを外す
  const SAX = {
    intro: `rw | rw | rw | rh rq re C4e`,
    head1: `!mf ${HEAD} F4q.~ re rh | rh rq re C4e`,
    head2: `!f ${HEAD} F4q. re re A4e C5e D5e | Eb5q._ re rh`,
    sax1: `!mf
      rq C4e D4e F4q A4e G4e | Ab4q./ F4e D4q rq |
      re C4e D4e F4e A4e C5e D5e C5e | Eb5q> D5e C5e Bb4e A4e G4e Eb4e |
      D4q F4e Ab4e C5q.~ Bb4e | Ab4e F4e D4e B3e D4q' rq |
      re C4e F4e A4e C5q> A4e F4e | E4e G4e C5e E5e Eb5e C5e A4e F#4e |
      G4q. Bb4e D5q.~ C5e | rq E4e C4e Db4e E4e G4e Bb4e |
      A4q.~ F4e re A4e F#4e Eb4e | D4e F4e A4e C5e Bb4e G4e E4e C4e`,
    sax2: `!f
      F4q' re A4e C5e Eb5e D5e C5e | D5e Bb4e Ab4e F4e D4e F4e Ab4e Bb4e |
      C5q' re C5e Eb5e C5e A4e C5e | G4s Bb4s D5s Eb5s D5s C5s Bb4s G4s A4s C5s Eb5s D5s C5s A4s G4s Eb4s |
      D4e F4e Ab4e C5e D5q.~ re | re B4e D5e B4e Ab4e F4e D4e B3e |
      !ff C4e F4e A4e C5e Eb5q.>/* D5e | C5e A4e G4e E4e F#4e A4e C5e Eb5e |
      D5h~* Bb4e G4e F4e D4e | !f rq G4e Bb4e Db5e C5e Bb4e Ab4e |
      A4q F4e D4e C4q.~ re | !mf Bb4e G4e F4e D4e E4e G4q.~`,
    out: `!f ${HEAD} F4q.~ re rh | rw`,
    tagA: `!f ${TAIL} F4q.~ re rh | rw`,
    tagB: `!mf ${TAIL}`,
    fin: `!mf F4q' re C4e Eb4e F4e Ab4e/ A4e | C5w~`,
  };
  // トランペット: 中音域で歯切れよく始め、2 コーラス目は上の倍音へ。同じ指で吹けるアルペジオ（B♭ D F B♭ / F A C F）はリップスラーになる
  const TRUMPET = Object.assign({}, SAX, {
    head2: `!f ${HEAD} F4q. re re C5e F5e A5e | C6q._ re rh`,
    sax1: `!mf
      rq F4e' F4e' rq Ab4e A4e | C5q' Ab4e F4e D4q rq |
      rq F4e' F4e' re A4e C5e D5e | Eb5q> C5e Bb4e A4e F4e Eb4e C4e |
      D4e F4e Bb4e D5e F5q.> D5e | F5e D5e B4e Ab4e F4q' rq |
      re C5e A4e C5e F5q> Eb5e C5e | A4e C5e E5e G5e F#5e Eb5e C5e A4e |
      Bb4q. D5e G5q.~ F5e | rq Bb4e G4e E4e G4e Bb4e Db5e |
      C5q' re A4e C5e A4e F#4e D4e | G4e Bb4e D5e F5e E5q' rq`,
    sax2: `!f
      A5q> F5e C5e rq A5e' A5e' | Ab5q> F5e D5e Bb4q rq |
      re A4e C5e F5e A5q> G5e F5e | Eb5e G5e Bb5e G5e F5q rq |
      !ff Bb4e D5e F5e Ab5e Bb5q.>* Ab5e | F5e D5e B4e D5e F5e Ab5e B5q> |
      C6h>~* A5e F5e Eb5e C5e | !f rq A4e C5e Eb5e C5e A4e F#4e |
      G4e Bb4e D5e F5e A5q. G5e | rq Bb5e G5e E5e Db5e Bb4e G4e |
      A4q' F4e A4e C5q.~ re | !mf re D5e Bb4e G4e E4e G4e C5q'`,
    fin: `!mf F4q' re C4e Eb4e F4e Ab4e A4e | F5w~`,
  });
  // フルート: テーマは 1 オクターブ上。ソロは長いレガートと走句で、C5〜B♭6 を広く使う
  const FLUTE = {
    intro: up8(SAX.intro),
    head1: plain(up8(SAX.head1)),
    head2: `!f ${plain(up8(HEAD))} F5q. re re A5e C6e D6e | Eb6q.~ re rh`,
    // 息継ぎ: 1〜2 小節吹いたら休む。フレーズの終わりは伸ばしてビブラート
    sax1: `!mf
      re C6q.~ A5e F5e A5q | D6h.~ rq |
      re F5e A5e C6e Eb6q.~ D6e | C6q Bb5e G5e A5h~ |
      rq D6e F6e Ab6q.~ F6e | D6e B5e Ab5e F5e D5h~ |
      rq re C6e A5e C6e F6q~ | E6q. C6e Eb6q. C6e |
      D6h.~ rq | re E6e D6e Bb5e G5e E5e G5q |
      A5h~ re C6e Eb6e F#6e | G6q.~ E6e C6q rq`,
    sax2: `!f
      A5s C6s F6s A6s G6s F6s Eb6s C6s A5q' rq | re D6e F6e Ab6e F6h~ |
      C6s D6s Eb6s F6s G6s F6s Eb6s D6s C6q.~ re | G5t Bb5t D6t Eb6t D6t Bb5t A5q C6q |
      D6q> re F6e Ab6q.~ G6e | F6e D6e B5e Ab5e F5q rq |
      !ff A6h>~ F6e Eb6e C6q | !f rq re E6e Eb6e C6e A5e F#5e |
      G5s A5s Bb5s C6s D6s F6s G6s A6s Bb6h~ | rq G6e E6e Db6e Bb5e G5e re |
      F6q. C6e A5q rq | !mf re D6e Bb5e G5e E5q G5q~`,
    out: plain(up8(SAX.out)), tagA: plain(up8(SAX.tagA)), tagB: plain(up8(SAX.tagB)), fin: plain(up8(SAX.fin)),
  };
  // ソプラノサックス: テナーの譜面をそのまま 1 オクターブ上で（しゃくり・フォール・グロウルも同じ）
  const SOPRANO = {}; for (const k in SAX) SOPRANO[k] = up8(SAX[k]);
  const LEAD = { sax: SAX, soprano: SOPRANO, trumpet: TRUMPET, flute: FLUTE }[lead];
  const LEADNAME = { sax: 'Tenor Sax', soprano: 'Soprano Sax', trumpet: 'Trumpet', flute: 'Flute' }[lead];
  const PIANO = {
    intro: `!mf rq [Bb4 D5]q. [A4 C5]e [Bb4 D5]q | rq [Bb4 E5]q. [A4 Eb5]e [Bb4 E5]q |
            [A4 C5 F5]q. [A4 C5 F5]e re [F#4 C5 Eb5]e rq | [F4 Bb4 D5]q' re [E4 Bb4 Db5]e rh`,
    head1: `!mp ${FILL} rh re Eb5e D5e C5e | Bb4e D5e F5e A5e G5e E5e C5q`,
    head2: `!mp ${FILL} rw | rw`,
    pno1: `!mf
      re C5e Eb5e F5e Ab5s A5e. C6q | Bb5e Ab5e F5e D5e F5q' rq |
      rq A5e C6e D6e C6e A5e F5e | G5e Eb5e C5e Bb4e A4e C5e Eb5e G5e |
      F5q. D5e Bb4e D5e F5e Ab5e | Ab5e F5e D5e B4e D5e F5e Ab5q |
      C6e Ab5s A5s F5e D5e C5e A4e C5q' | re E5e G5e A5e F#5e Eb5e C5e A4e |
      Bb4e D5e F5e A5e G5q. F5e | E5e G5e Bb5e D6e Db6e Bb5e Ab5e E5e |
      F5q' re C5e Eb5e D5e C5e A4e | Bb4e D5e F5e A5e G5e E5e C5e Bb4e`,
    pno2: `!f
      [F5 A5]e [F5 A5]e' re [Eb5 G5]e re [F5 A5]e' rq | [D5 F5]e [D5 F5]e' re [D5 Ab5]e re [D5 F5]e' rq |
      [F5 A5]e [F5 A5]e' re [Eb5 G5]e re [F5 A5]e' rq | C5e Eb5e G5e Bb5e A5e G5e F5e Eb5e |
      [D5 Ab5]q' re [D5 Ab5]e re [D5 G5]e [D5 F5]q | [D5 Ab5]q' re [D5 Ab5]e re [F5 B5]e [D5 Ab5]q |
      !ff C6t Ab5t F5t Eb5t C5t Ab4t A4e C5e F5q' | E5e C5e A4e G4e F#4e A4e C5e Eb5e |
      !f [Bb4 D5]q. [Bb4 D5]e re [C5 F5]e [Bb4 D5]q | [Bb4 E5]q. [Bb4 E5]e re [Bb4 Eb5]e [A4 D5]q |
      [A4 C5 F5]q' rq re F#5e A5e C6e | !mf D6e Bb5e G5e F5e E5e C5e Bb4e G4e`,
    out: `!mp ${FILL} rh re Eb5e D5e C5e | rw`,
    fin: `!mf rw | [F2 C3 Eb3 A3 D4 G4 B4]w~`,
  };
  const BASS = {
    fin: `!f F2h C2h | F1w~`,
  };
  // 楽曲の進行: [id, 表示名, 小節ごとのコード, ピアノ左手の伴奏, ベース, ソリスト]
  const SECTIONS = [
    ['intro', 'Intro', TURN, 'head', '2feel', 'piano'],
    ['head1', 'Theme', BLUES, 'head', '2feel', 'sax'],
    ['head2', 'Theme', BLUES, 'head', 'walk', 'sax'],
    ['sax1', LEADNAME + ' Solo', BLUES, 'comp', 'walk', 'sax'],
    ['sax2', LEADNAME + ' Solo', BLUES, 'comp', 'walk', 'sax'],
    ['pno1', 'Piano Solo', BLUES, 'solo', 'walk', 'piano'],
    ['pno2', 'Piano Solo', BLUES, 'solo', 'walk', 'piano'],
    ['out', 'Theme', BLUES, 'head', 'walk', 'sax'],
    ['tagA', 'Tag', TURN, 'head', 'walk', 'sax'],
    ['tagB', 'Tag', TURN.slice(0, 2), 'head', 'walk', 'sax'],
    ['fin', 'Ending', [['F7'], ['F7']], 'none', 'written', 'sax'],
  ];

  // ---------------------------------------------------------------- 時間
  const bars = []; const sections = [];
  for (const [id, label, chords, comp, bass, solo] of SECTIONS) {
    sections.push({ id, label, bar: bars.length, nbars: chords.length, comp, bass, solo });
    chords.forEach((c, k) => bars.push({ chords: c, sec: sections.length - 1, k, bpm: BPM }));
  }
  const NB = bars.length;
  bars[NB - 3].bpm = 120; bars[NB - 2].bpm = 100; bars[NB - 1].bpm = 58;   // 最後はリタルダンドしてフェルマータ
  let tt = 0; for (const b of bars) { b.t = tt; tt += 240 / b.bpm; }
  const songEnd = tt;
  const sec = beat => { const bi = Math.max(0, Math.min(NB - 1, Math.floor(beat / 4 + 1e-9))); return bars[bi].t + (beat - 4 * bi) * 60 / bars[bi].bpm; };
  const swing = b => { const i = Math.floor(b + 1e-9), f = b - i; return Math.abs(f - 0.5) < 1e-6 ? i + SW : b; };
  const T = beat => sec(swing(beat));
  let seed = 20261111;
  const rnd = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  const pick = a => a[Math.floor(rnd() * a.length)];

  // ---------------------------------------------------------------- 記法の解釈
  const DUR = { w: 4, h: 2, q: 1, e: 0.5, s: 0.25, t: 1 / 3, T: 2 / 3 };
  const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const midiOf = n => { const m = /^([A-G])([#b]?)(-?\d)$/.exec(n); if (!m) throw new Error('音名: ' + n); return 12 * (+m[3] + 1) + PC[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0); };
  function parse(str, name, nbars) {
    const out = []; let pos = 0, dyn = DYN.mf;
    const bs = str.split('|').map(s => s.trim()).filter(s => s.length);
    if (bs.length !== nbars) throw new Error(`${name}: ${bs.length} 小節（${nbars} 小節のはず）`);
    bs.forEach((bar, bi) => {
      let sum = 0;
      for (const tk of bar.match(/\[[^\]]+\]\S*|\S+/g) || []) {
        if (tk[0] === '!') { dyn = DYN[tk.slice(1)]; continue; }
        const m = /^(\[[^\]]+\]|[A-G][#b]?-?\d|r)([whqestT]\.?(?:\+[whqestT]\.?)*)([>'?~\/_*^=]*)$/.exec(tk);
        if (!m) throw new Error(`${name} ${bi + 1} 小節: "${tk}"`);
        const d = m[2].split('+').reduce((a, p) => a + DUR[p[0]] * (p[1] === '.' ? 1.5 : 1), 0);
        if (m[1] !== 'r') out.push({ pos: pos + sum, dur: d, notes: m[1][0] === '[' ? m[1].slice(1, -1).trim().split(/\s+/).map(midiOf) : [midiOf(m[1])], mods: m[3], dyn });
        sum += d;
      }
      if (Math.abs(sum - 4) > 1e-6) throw new Error(`${name} ${bi + 1} 小節: ${sum} 拍`);
      pos += 4;
    });
    return out;
  }
  const adjacent = (a, b) => a && b && Math.abs(a.pos + a.dur - b.pos) < 1e-6;
  const offbeat = p => Math.abs(p - Math.floor(p + 1e-9) - 0.5) < 1e-6;

  const events = [];
  // ---------------------------------------------------------------- リード
  // リード専用の乱数（伴奏はどのリードでも同じになる）
  let lseed = 777; const lrnd = () => { lseed = lseed + 0x6D2B79F5 | 0; let t = Math.imul(lseed ^ lseed >>> 15, 1 | lseed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  function leadPart(notes, off) {
    const LAY = lead === 'sax' || lead === 'soprano' ? 0.016 : lead === 'trumpet' ? 0.008 : 0.006;   // 少し後ろに乗る
    // フレーズ（息継ぎから息継ぎまで）ごとに息の山を作る: 入りは控えめ、中ほどで膨らみ、終わりは抜く
    let ps = 0;
    notes.forEach((n, i) => { if (i === 0 || !adjacent(notes[i - 1], n)) ps = i; n.ps = ps; });
    notes.forEach((n, i) => { let e = i; while (e + 1 < notes.length && notes[e + 1].ps === n.ps) e++; n.pn = e - n.ps + 1; n.pk = i - n.ps; });
    notes.forEach((n, i) => {
      const prev = notes[i - 1], next = notes[i + 1], m = n.notes[0], has = c => n.mods.includes(c);
      const stac = has("'"), prevStac = prev && prev.mods.includes("'");
      const gapBefore = !adjacent(prev, n) || prevStac, gapAfter = !adjacent(n, next);
      const arc = n.pn >= 3 ? 0.07 * Math.sin(Math.PI * (n.pk + 0.5) / n.pn) - 0.035 - (n.pk === n.pn - 1 ? 0.03 : 0) : 0;
      const ob = offbeat(n.pos), fast = n.dur < 0.4, same = prev && prev.notes[0] === m;
      let vel = n.dyn + arc + (has('>') ? 0.14 : 0) + (ob && n.dur <= 0.5 ? 0.04 : 0) + (m - (lead === 'flute' ? 80 : lead === 'soprano' ? 74 : lead === 'trumpet' ? 67 : 62)) * 0.004 + (lrnd() - 0.5) * 0.05;
      if (prev && next && !gapBefore && m > prev.notes[0] && m > next.notes[0]) vel += 0.05;
      if (fast) vel -= 0.04;
      if (has('?')) vel *= 0.5;
      vel = Math.max(0.08, Math.min(1, vel));
      let t0 = T(off + n.pos) + LAY + (lrnd() - 0.5) * (gapBefore ? 0.012 : 0.006);
      const len = T(off + n.pos + n.dur) - T(off + n.pos);
      let tongue, sound, vib, scoop = 0, crack = 0; const growl = has('*') && lead !== 'flute' ? 0.7 : 0;
      if (lead === 'trumpet') {
        // フレーズの中は息を切らない。裏拍は舌で軽く突くだけ（レガート・タンギング）、表拍へはスラー。
        // 息を止めて吹き直すのは、同じ音の連打とアクセントだけ。1 音ごとに止めると旋律がぶつ切りになる
        tongue = gapBefore || has('^') || has('>') || same ? 2 : (!fast && ob) ? 1 : 0;
        if (tongue === 2 && !gapBefore) events.push([t0 - 0.025, 0, 0, 0]);   // 舌を付けて一瞬止める
        sound = (gapAfter || stac) ? Math.max(0.09, len * (stac ? 0.62 : has('_') ? 0.6 : 0.92)) : len;
        vib = (sound > 0.45 || has('~')) ? 12 + 10 * Math.min(1, sound / 1.2) : 0;
        scoop = has('/') ? 60 : 0;
      } else if (lead === 'flute') {
        // フルートのタンギング（息は切らず、舌で軽く突く）:
        //   16 分・3 連の走句 … 頭の 1 音だけ突いて、あとはスラー
        //   8 分音符の流れ   … 裏拍を突いて、次の表拍へスラー（2 音ずつ組にする）。走句を抜けた最初の音もスラーで受ける
        //   同じ音の繰り返し・アクセント・長い音のあと … 突く
        // 無音からの吹き始めは鳴り出しが遅いぶん早めに息を入れる
        const prevFast = prev && prev.dur < 0.4, prevShort = prev && prev.dur <= 0.5;
        //   大きな跳躍（5 度以上）… スラーでつながず突く
        const leap = prev && Math.abs(m - prev.notes[0]) >= 7;
        tongue = gapBefore ? 2 : (same || leap || has('^') || has('>')) ? 1 : fast ? (prevFast ? 0 : 1) : ob ? 1 : prevShort ? 0 : 1;
        if (gapBefore) t0 -= 0.045;
        sound = (gapAfter || stac) ? len * (stac ? 0.55 : 0.95) : len;
        vib = (sound > 0.4 || has('~')) ? 20 : 0;
        crack = has('*') ? 1 : 0;   // 強く吹き込みすぎて一瞬オクターブ上に裏返る
      } else {
        tongue = gapBefore || has('^') ? 2 : (ob || same || has('>')) ? 1 : 0;
        sound = (gapAfter || stac) ? len * (stac ? 0.5 : has('_') ? 0.62 : n.dur <= 0.5 ? 0.8 : 0.93) : len;
        vib = (sound > 0.4 || has('~')) ? 13 + 11 * Math.min(1, sound / 1.2) : 0;
        scoop = has('/') ? 75 : (has('>') && n.dur >= 1 ? 28 : 0);
      }
      events.push([t0, 0, 1, m, vel, tongue, scoop, vib, Math.min(lead === 'flute' ? 0.18 : 0.3, sound * 0.34), growl, crack]);
      if (gapAfter || stac) events.push([t0 + sound, 0, 0, has('_') ? 1 : 0]);
    });
  }
  // ---------------------------------------------------------------- ピアノ
  function pianoNote(t, m, vel, dur) { events.push([t, 1, 1, m, Math.max(1, Math.min(127, Math.round(vel)))]); events.push([t + Math.max(0.04, dur), 1, 0, m]); }
  function pianoPart(notes, off) {
    notes.forEach((n, i) => {
      const prev = notes[i - 1], next = notes[i + 1], has = c => n.mods.includes(c), top = Math.max(...n.notes);
      let vel = (n.dyn + (has('>') ? 0.12 : 0) + (offbeat(n.pos) ? 0.025 : 0) + (rnd() - 0.5) * 0.06) * 132;
      if (prev && next && adjacent(prev, n) && top > Math.max(...prev.notes) && top > Math.max(...next.notes)) vel += 6;
      if (n.dur < 0.3) vel -= 5;
      const t0 = T(off + n.pos) + (rnd() - 0.5) * 0.008, len = T(off + n.pos + n.dur) - T(off + n.pos);
      const d = len * (has("'") ? 0.45 : adjacent(n, next) ? 0.97 : 0.85);
      const roll = has('~') ? 0.045 : 0.004, srt = n.notes.slice().sort((a, b) => a - b);
      srt.forEach((m, k) => pianoNote(t0 + k * roll, m, vel + (m === top && srt.length > 1 ? 7 : srt.length > 1 ? -4 : 0) - (srt.length > 4 ? 6 : 0), d - k * roll));
    });
  }
  // 左手のルートレス・ボイシング（A / B フォーム）
  const VOICE = {
    F7: [[51, 55, 57, 62], [57, 62, 63, 67]], Bb7: [[56, 60, 62, 67], [50, 55, 56, 60]], Cm7: [[51, 55, 58, 62], [58, 62, 63, 67]],
    Bdim7: [[56, 59, 62, 65], [53, 56, 59, 62]], Am7: [[55, 60, 64], [52, 55, 60, 62]], D7: [[54, 58, 60, 63], [54, 60, 63, 65]],
    Gm7: [[53, 57, 58, 62], [58, 62, 65, 69]], C7: [[52, 57, 58, 62], [58, 62, 64, 69]],
  };
  const COMP = {
    head: { one: [[[0, 1.3], [2.5, 0.45]], [[1.5, 0.5], [3.5, 1.4]], [[0, 0.45], [1.5, 1.2]], [[1, 0.4], [2.5, 0.5]], [[3.5, 1.4]], [[0, 0.4], [1, 0.4], [2.5, 1]], [[1.5, 1.4]]],
            two: [[[0, 0.45], [1.5, 1.3]], [[0, 1.2], [2, 1.1]], [[0, 1], [2.5, 0.5]], [[1.5, 1.2], [3.5, 1.2]]], vel: 56, b: 0.25 },
    comp: { one: [[[0, 1.3], [2.5, 0.45]], [[1.5, 0.5], [3.5, 1.4]], [[0, 0.45], [1.5, 1.2]], [[1, 0.4], [2.5, 0.5]], [[3.5, 1.4]], [[0, 0.4], [1, 0.4], [2.5, 1]], [[1.5, 1.4]], [[0, 0.4], [1.5, 0.4], [3, 0.5]], [[2, 0.45], [3.5, 1.2]]],
            two: [[[0, 0.45], [1.5, 1.3]], [[0, 1.2], [2, 1.1]], [[0, 1], [2.5, 0.5]], [[1.5, 1.2], [3.5, 1.2]]], vel: 60, b: 0.4 },
    solo: { one: [[[0, 1.2]], [[1.5, 0.6]], [[0, 0.4], [2.5, 0.6]], [[3.5, 1.2]], [[0, 0.45], [1.5, 0.9]], []],
            two: [[[0, 0.9], [2, 0.9]], [[0, 0.45], [1.5, 1.2]], [[1.5, 1.0]]], vel: 50, b: 0.15, thin: true },
  };
  function chordAt(bi, beat) {   // 小節 bi の拍 beat で鳴るコード（裏拍の食いは次のコードを先取り）
    const b = bars[bi], two = b.chords.length === 2;
    const ant = offbeat(beat);
    if (two) { if (beat < 1.5 - 1e-6) return b.chords[0]; if (beat < 3.5 - 1e-6) return b.chords[1]; }
    else if (beat < 3.5 - 1e-6) return b.chords[0];
    return ant && bars[bi + 1] ? bars[bi + 1].chords[0] : b.chords[b.chords.length - 1];
  }
  function compPart(s) {
    const C = COMP[s.comp]; let tied = false;
    for (let k = 0; k < s.nbars; k++) {
      const bi = s.bar + k, b = bars[bi];
      let pats = b.chords.length === 2 ? C.two : C.one;
      if (tied) pats = pats.filter(p => !p.length || p[0][0] >= 1);
      if (s.id === 'fin') pats = [[[0, 0.4]]];
      const pat = pick(pats); tied = pat.length > 0 && pat[pat.length - 1][0] >= 3.5;
      for (const [beat, dur] of pat) {
        const ch = chordAt(bi, beat); let v = VOICE[ch][rnd() < C.b ? 1 : 0];
        if (C.thin) v = v.slice(0, 3);
        const t0 = T(bi * 4 + beat) + (rnd() - 0.5) * 0.008, d = (T(bi * 4 + beat + dur) - T(bi * 4 + beat)) * 0.9;
        const vel = C.vel + (rnd() - 0.5) * 12 + (offbeat(beat) ? 4 : 0);
        v.forEach((m, j) => pianoNote(t0 + j * 0.003, m, vel + (j === v.length - 1 ? 5 : 0), d));
      }
    }
  }
  // ---------------------------------------------------------------- ベース
  const CH = { F7: [5, [0, 4, 7, 10]], Bb7: [10, [0, 4, 7, 10]], C7: [0, [0, 4, 7, 10]], D7: [2, [0, 4, 7, 10]], Cm7: [0, [0, 3, 7, 10]], Gm7: [7, [0, 3, 7, 10]], Am7: [9, [0, 3, 7, 10]], Bdim7: [11, [0, 3, 6, 9]] };
  const LO = 28, HI = 50;
  const rootNear = (ch, ref) => { let best = 0, bd = 99; for (let m = LO; m <= HI; m++) if (m % 12 === CH[ch][0] && Math.abs(m - ref) < bd) { bd = Math.abs(m - ref); best = m; } return best; };
  const toneStep = (ch, from, dir) => { for (let m = from + dir; m >= LO - 2 && m <= HI + 6; m += dir) if (CH[ch][1].includes(((m - CH[ch][0]) % 12 + 12) % 12)) return m; return from; };
  function bassNote(beat, m, vel, durBeats, flags, extra) {
    const t0 = T(beat) - 0.007 + (rnd() - 0.5) * 0.008;
    events.push([t0, 2, 1, m, Math.max(0.1, Math.min(1, vel)), flags || 0, 0, extra || 0]);
    return t0;
  }
  // コード進行をセグメント列にして、ウォーキング / 2 ビートのラインを作る
  function bassLine() {
    const segs = [];
    bars.forEach((b, bi) => { const mode = sections[b.sec].bass; if (b.chords.length === 2) { segs.push({ beat: bi * 4, n: 2, ch: b.chords[0], mode, bi }); segs.push({ beat: bi * 4 + 2, n: 2, ch: b.chords[1], mode, bi }); } else segs.push({ beat: bi * 4, n: 4, ch: b.chords[0], mode, bi }); });
    let cur = 41;
    segs.forEach((s, si) => {
      const nx = segs[si + 1];
      if (s.mode === 'written') { cur = 41; return; }
      const r = rootNear(s.ch, si === 0 ? 31 : cur);
      const approach = (from, nr) => { let a = from < nr ? nr - 1 : from > nr ? nr + 1 : (rnd() < 0.5 ? nr + 7 > HI ? nr - 5 : nr + 7 : nr - 1); if (a === from) a = from < nr ? nr - 2 : nr + 2; return a; };
      if (s.mode === '2feel') {
        const v = 0.62 + rnd() * 0.08;
        if (s.n === 4) {
          let fifth = r + CH[s.ch][1][2]; if (fifth > 45) fifth -= 12;
          bassNote(s.beat, r, v + 0.04, 2); bassNote(s.beat + 2, fifth, v, 1.5);
          const nr = nx ? rootNear(nx.ch, fifth) : r;
          if (nx && rnd() < 0.55) { bassNote(s.beat + 3.5, approach(fifth, nr), v - 0.12, 0.5); cur = nr; } else cur = fifth;
        } else { bassNote(s.beat, r, v + 0.04, 2); cur = r; }
        return;
      }
      // ウォーキング
      const line = [r];
      if (s.n === 4) {
        const dir = r < 34 ? (rnd() < 0.85 ? 1 : -1) : r > 42 ? (rnd() < 0.85 ? -1 : 1) : (rnd() < 0.5 ? 1 : -1);
        const style = rnd();
        let b2, b3;
        if (style < 0.5) { b2 = toneStep(s.ch, r, dir); b3 = toneStep(s.ch, b2, dir); }
        else if (style < 0.78) { b2 = r + dir * 2; b3 = toneStep(s.ch, b2, dir); }
        else if (style < 0.9) { b2 = toneStep(s.ch, toneStep(s.ch, r, dir), dir); b3 = toneStep(s.ch, b2, -dir); }
        else { b2 = r; b3 = toneStep(s.ch, r, dir); }
        line.push(b2, b3);
        const nr = nx ? rootNear(nx.ch, b3) : r;
        line.push(nx ? approach(b3, nr) : toneStep(s.ch, b3, -dir));
      } else {
        const nr = nx ? rootNear(nx.ch, r) : r;
        line.push(nx ? (rnd() < 0.25 ? toneStep(s.ch, r, nr > r ? 1 : -1) : approach(r, nr)) : r);
      }
      line.forEach((m, k) => {
        while (m < LO) m += 12; while (m > 55) m -= 12;
        const v = 0.66 + (k % 2 ? 0.07 : 0) + (rnd() - 0.5) * 0.1;
        bassNote(s.beat + k, m, v, 1);
        // ときどき裏拍にゴーストノートを引っかける
        if (rnd() < 0.13 && !(s.bi === NB - 3 && k === s.n - 1)) bassNote(s.beat + k + 0.5, m, 0.3, 0.5, 1);
        cur = m;
      });
    });
  }
  function bassWritten(notes, off) {
    notes.forEach((n, i) => {
      const prev = notes[i - 1], next = notes[i + 1], has = c => n.mods.includes(c);
      const slide = prev && prev.mods.includes('=') && adjacent(prev, n);
      const vel = n.dyn + (has('>') ? 0.12 : 0) + (offbeat(n.pos) ? 0.03 : 0) + (rnd() - 0.5) * 0.08 - (n.dur < 0.3 ? 0.08 : 0);
      const t0 = bassNote(off + n.pos, n.notes[0], vel, n.dur, (has('?') ? 1 : 0) | (slide ? 2 : 0), has('~') ? 0.006 : 0);
      if (!adjacent(n, next)) events.push([t0 + (T(off + n.pos + n.dur) - T(off + n.pos)) * 0.92, 2, 0]);
    });
  }

  // ---------------------------------------------------------------- 組み立て
  // リードは曲全体を 1 本の旋律として扱う（セクションの境目でも、続いている音は続けて吹く）
  const leadNotes = [];
  for (const s of sections) if (LEAD[s.id]) for (const n of parse(LEAD[s.id], lead + '/' + s.id, s.nbars)) { n.pos += s.bar * 4; leadNotes.push(n); }
  leadPart(leadNotes, 0);
  for (const s of sections) {
    const off = s.bar * 4;
    if (PIANO[s.id]) pianoPart(parse(PIANO[s.id], 'piano/' + s.id, s.nbars), off);
    if (s.comp !== 'none') compPart(s);
    if (s.bass === 'written') bassWritten(parse(BASS[s.id], 'bass/' + s.id, s.nbars), off);
  }
  bassLine();
  // 最後の和音はペダルで伸ばす
  events.push([bars[NB - 1].t - 0.05, 1, 2, 1]);
  const duration = songEnd + 3.2;
  events.push([songEnd + 0.6, 1, 2, 0]); events.push([songEnd + 0.3, 2, 0]);
  events.sort((a, b) => a[0] - b[0] || a[2] - b[2]);
  return {
    title: 'Waveguide Blues', lead, leadName: LEADNAME, bpm: BPM, key: 'F', duration, events,
    bars: bars.map(b => ({ t: b.t, dur: 240 / b.bpm, chords: b.chords, sec: b.sec, k: b.k })),
    sections: sections.map(s => ({ id: s.id, label: s.label, bar: s.bar, nbars: s.nbars, solo: s.solo, t: bars[s.bar].t })),
  };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { buildSong };
