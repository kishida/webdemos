'use strict';
// FM 音源 + ステップシーケンサ（BGM / 効果音）
//
// 音色（パッチ）はキャリア 1 基に、並列モジュレータ m[] と、m[0] をさらに揺らす m2 を足した構成。
// モジュレータは [周波数比, 初期インデックス, 減衰後インデックス, 減衰時定数]。
// 譜面は 1 トークン = 1 ステップの文字列で、'-' は直前の音を伸ばす、'.' は休符、'|' は小節線（無視）。
// 和音は 'c3+e3+g3'。ドラムチャンネルは k(キック) s(スネア) h(ハット) o(オープンハット) t(タム) を並べる。

const Sound = (() => {
  let ac = null, master, bus, revSend, noiseBuf;
  let muted = false;
  const MASTER_VOL = 0.68;

  function init() {
    if (ac) { if (ac.state === 'suspended') ac.resume(); return; }
    build(new (window.AudioContext || window.webkitAudioContext)());
  }
  function build(ctx) {
    ac = ctx;
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 4; comp.attack.value = 0.003; comp.release.value = 0.2;
    master = ac.createGain(); master.gain.value = MASTER_VOL;
    master.connect(comp).connect(ac.destination);
    // 石造りの迷宮らしい長めの残響
    const rev = ac.createConvolver(); rev.buffer = impulse(2.8, 2.6);
    revSend = ac.createGain(); revSend.gain.value = 0.32;
    revSend.connect(rev).connect(master);
    bus = ac.createGain(); bus.connect(master);
    noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  function impulse(sec, decay) {
    const len = ac.sampleRate * sec, b = ac.createBuffer(2, len, ac.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return b;
  }

  // ------------------------------------------------------------ 音色
  const P = {
    bass:    { m: [[1, 3.2, 0.9, 0.08]], a: 0.003, d: 0.25, s: 0.6, r: 0.08 },
    slap:    { m: [[1, 5, 1.2, 0.05]], m2: [3, 1.5, 0, 0.04], a: 0.002, d: 0.18, s: 0.45, r: 0.06 },
    brass:   { m: [[1, 3.6, 2.2, 0.25]], mAtk: 0.06, a: 0.03, d: 0.3, s: 0.8, r: 0.12, uni: 6 },
    strings: { m: [[1, 1.4, 1.0, 0.5]], mAtk: 0.3, a: 0.35, d: 1.0, s: 0.85, r: 0.7, uni: 9 },
    organ:   { m: [[2, 1.3, 1.0, 1]], a: 0.06, d: 0.5, s: 0.9, r: 0.3, uni: 5 },
    bell:    { m: [[3.5, 4, 0.2, 0.4]], a: 0.002, d: 1.4, s: 0, r: 0.9 },
    epiano:  { m: [[1, 1.8, 0.3, 0.35], [14, 0.6, 0, 0.03]], a: 0.002, d: 1.2, s: 0.15, r: 0.4 },
    flute:   { m: [[1, 0.9, 0.5, 0.3]], mAtk: 0.08, a: 0.06, d: 0.3, s: 0.85, r: 0.15, vib: 5 },
    timpani: { m: [[1.6, 2.5, 0, 0.25]], a: 0.002, d: 0.9, s: 0, r: 0.6, pitch: [1.15, 0.08] },
  };

  // 1 音を鳴らす
  function fm(p, freq, t, dur, vol, out, extra = {}) {
    const voices = p.uni ? [-p.uni, p.uni] : [0];
    for (const det of voices) {
      const car = ac.createOscillator();
      car.frequency.value = freq;
      if (det) car.detune.value = det;
      if (p.pitch) {
        car.frequency.setValueAtTime(freq * p.pitch[0], t);
        car.frequency.exponentialRampToValueAtTime(freq, t + p.pitch[1]);
      }
      if (p.vib) {
        const lfo = ac.createOscillator(), lg = ac.createGain();
        lfo.frequency.value = p.vib; lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(freq * 0.006, t + 0.4);
        lfo.connect(lg).connect(car.frequency); lfo.start(t); lfo.stop(t + dur + p.r + 0.1);
      }
      const oscs = [car];
      p.m.forEach(([ratio, idx, idxEnd, tc], k) => {
        const mo = ac.createOscillator(), g = ac.createGain();
        const mf = freq * ratio;
        mo.frequency.value = mf;
        const peak = idx * mf * (extra.bright || 1);
        if (p.mAtk) { g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(peak, t + p.mAtk); }
        else g.gain.setValueAtTime(peak, t);
        g.gain.setTargetAtTime(idxEnd * mf, t + (p.mAtk || 0), tc);
        mo.connect(g).connect(car.frequency);
        oscs.push(mo);
        if (k === 0 && p.m2) {
          const [r2, i2, e2, tc2] = p.m2;
          const m2 = ac.createOscillator(), g2 = ac.createGain();
          m2.frequency.value = freq * r2;
          g2.gain.setValueAtTime(i2 * freq * r2, t); g2.gain.setTargetAtTime(e2 * freq * r2, t, tc2);
          m2.connect(g2).connect(mo.frequency); oscs.push(m2);
        }
      });
      const amp = ac.createGain(), v = vol / voices.length;
      amp.gain.setValueAtTime(0, t);
      amp.gain.linearRampToValueAtTime(v, t + p.a);
      amp.gain.setTargetAtTime(v * p.s, t + p.a, p.d / 3);
      amp.gain.setTargetAtTime(0, t + Math.max(dur, p.a), p.r / 4);
      car.connect(amp).connect(out);
      const end = t + dur + p.r + 0.05;
      oscs.forEach(o => { o.start(t); o.stop(end); });
    }
  }

  function noise(t, dur, vol, out, { type = 'bandpass', f0 = 2000, f1 = f0, q = 1, a = 0.001 } = {}) {
    const src = ac.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
    const f = ac.createBiquadFilter(); f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t); f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(vol, t + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(out);
    src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.05);
  }

  const DRUM = {
    k: (t, v, o) => fm({ m: [[1, 2.5, 0, 0.02]], a: 0.001, d: 0.2, s: 0, r: 0.1, pitch: [3.5, 0.06] }, 48, t, 0.15, v, o),
    s: (t, v, o) => { noise(t, 0.18, v * 0.7, o, { f0: 3000, f1: 1500, q: 0.8 }); fm({ m: [[1.5, 2, 0, 0.03]], a: 0.001, d: 0.1, s: 0, r: 0.05, pitch: [1.6, 0.03] }, 180, t, 0.08, v * 0.5, o); },
    h: (t, v, o) => noise(t, 0.05, v * 0.35, o, { type: 'highpass', f0: 8000, q: 0.7 }),
    o: (t, v, o) => noise(t, 0.3, v * 0.3, o, { type: 'highpass', f0: 7000, q: 0.7 }),
    t: (t, v, o) => fm({ m: [[1, 1.5, 0, 0.05]], a: 0.001, d: 0.35, s: 0, r: 0.2, pitch: [1.8, 0.1] }, 90, t, 0.25, v * 0.8, o),
  };

  // ------------------------------------------------------------ 譜面
  const NOTE = { c: 0, 'c#': 1, d: 2, 'd#': 3, e: 4, f: 5, 'f#': 6, g: 7, 'g#': 8, a: 9, 'a#': 10, b: 11 };
  const freqOf = n => { const m = /^([a-g]#?)(\d)$/.exec(n); return 440 * Math.pow(2, (NOTE[m[1]] + (+m[2] + 1) * 12 - 69) / 12); };

  function parse(str, drum) {
    const toks = str.split(/\s+/).filter(s => s && s !== '|');
    const ev = [];
    toks.forEach((tk, i) => {
      if (tk === '-') { if (ev.length) ev[ev.length - 1].len++; }
      else if (tk === '.') ev.push(null);
      else ev.push({ step: i, len: 1, notes: drum ? tk.split('') : tk.split('+').map(freqOf) });
    });
    return { events: ev.filter(Boolean), steps: toks.length };
  }

  const bar = (...chords) => chords.map(c => c + ' -'.repeat(7)).join(' | ');
  const TRACKS = {
    title: { bpm: 76, ch: [
      { p: 'strings', vol: 0.11, rev: 0.6, n: bar('a2+c3+e3', 'f2+a2+c3', 'c3+e3+g3', 'g2+b2+d3', 'a2+c3+e3', 'f2+a2+c3', 'e2+g#2+b2', 'e2+g#2+b2+d3') },
      { p: 'bass', vol: 0.3, n: 'a1 - - - a1 - - - | f1 - - - f1 - - - | c2 - - - c2 - - - | g1 - - - g1 - - - | a1 - - - a1 - - - | f1 - - - f1 - - - | e1 - - - e1 - - - | e1 - - - e2 - e1 -' },
      { p: 'brass', vol: 0.2, rev: 0.5, n: 'a4 - - - - - c5 - | f5 - - - e5 - d5 - | e5 - - - - - g4 - | d5 - - - c5 - b4 - | c5 - - - - - a4 - | f5 - - - a5 - g5 f5 | e5 - - - g#4 - b4 - | e5 - - - - - . .' },
      { p: 'timpani', vol: 0.4, rev: 0.5, n: 'a1 . . . . . . . | f1 . . . . . . . | c2 . . . . . . . | g1 . . . . . . . | a1 . . . . . . . | f1 . . . . . . . | e1 . . . . . . . | e1 . . . e1 . e1 e1' },
    ] },
    dungeon: { bpm: 88, ch: [
      { p: 'bass', vol: 0.26, n: 'd2 . d2 a2 d3 . c3 a2 | a#1 . a#1 f2 a#2 . a2 f2 | g1 . g1 d2 g2 . f2 d2 | a1 . a1 e2 a2 . g2 e2 | d2 . d2 a2 d3 . c3 a2 | f1 . f1 c2 f2 . e2 c2 | g1 . g1 d2 g2 . f2 d2 | a1 . a1 e2 a2 c#3 e3 a2' },
      { p: 'strings', vol: 0.07, rev: 0.7, n: bar('d3+f3+a3', 'a#2+d3+f3', 'g2+a#2+d3', 'a2+c#3+e3', 'd3+f3+a3', 'f2+a2+c3', 'g2+a#2+d3', 'a2+c#3+e3+g3') },
      { p: 'bell', vol: 0.13, rev: 0.8, n: 'a4 - - - f4 - e4 - | d4 - - - - - . . | g4 - - - a#4 - a4 - | e4 - - - - - . . | a4 - - - d5 - c5 - | a4 - - - f4 - - . | g4 - a#4 - d5 - c5 a#4 | a4 - - - c#5 - - -' },
      { p: 'drum', div: 4, vol: 0.22, rev: 0.5, n: 'k . . . . . h . k . . . t . h .' },
    ] },
    battle: { bpm: 152, ch: [
      { p: 'slap', vol: 0.32, n: 'e2 e2 e3 e2 e2 e3 d3 b2 | c2 c2 c3 c2 c2 c3 b2 g2 | d2 d2 d3 d2 d2 d3 c3 a2 | b1 b1 b2 b1 b1 b2 d#3 f#2' },
      { p: 'brass', vol: 0.19, rev: 0.3, n: 'e4 - g4 - b4 - a4 g4 | g4 - - - c5 - b4 a4 | f#4 - a4 - d5 - c5 b4 | b4 - a4 - f#4 - d#4 - | e5 - - d5 b4 - g4 - | c5 - - b4 a4 - g4 - | a4 - - g4 f#4 - d4 - | b4 - - - - - . .' },
      { p: 'organ', vol: 0.08, n: 'e3+g3+b3 . . e3+g3+b3 . . e3+g3+b3 . | c3+e3+g3 . . c3+e3+g3 . . c3+e3+g3 . | d3+f#3+a3 . . d3+f#3+a3 . . d3+f#3+a3 . | b2+d#3+f#3 . . b2+d#3+f#3 . . b2+d#3+f#3 .' },
      { p: 'drum', div: 4, vol: 0.45, n: 'k . h . s . h k k . h . s . h h' },
    ] },
    boss: { bpm: 168, ch: [
      { p: 'slap', vol: 0.32, n: 'c2 c2 c3 c2 c2 c3 c2 a#1 | g#1 g#1 g#2 g#1 g#1 g#2 g#1 g1 | f1 f1 f2 f1 f1 f2 f1 g1 | g1 g1 g2 g1 g1 g2 b1 d2 | c2 c2 c3 c2 c2 c3 c2 a#1 | c#2 c#2 c#3 c#2 c#2 c#3 c#2 c2 | a#1 a#1 a#2 a#1 a#1 a#2 a#1 a1 | g1 g1 g2 g1 g1 g2 b1 d2' },
      { p: 'brass', vol: 0.2, rev: 0.35, n: 'c5 - - - g4 - c5 d#5 | d#5 - c5 - g#4 - - - | f4 - g#4 - c5 - d#5 - | d5 - - - b4 - g4 - | c5 - g5 - - - f5 d#5 | c#5 - - - f5 - g#5 - | a#4 - d5 - f5 - a#5 - | b4 - - - d5 - f5 -' },
      { p: 'organ', vol: 0.07, rev: 0.5, n: bar('c3+d#3+g3', 'g#2+c3+d#3', 'f2+g#2+c3', 'g2+b2+d3', 'c3+d#3+g3', 'c#3+f3+g#3', 'a#2+d3+f3', 'g2+b2+d3+f3') },
      { p: 'timpani', vol: 0.45, rev: 0.4, n: 'c2 . . . . . . . | g#1 . . . . . . . | f1 . . . . . . . | g1 . . . g1 . g1 g1 | c2 . . . . . . . | c#2 . . . . . . . | a#1 . . . . . . . | g1 . . . g1 . g1 g1' },
      { p: 'drum', div: 4, vol: 0.45, n: 'k . h k s . h . k . h k s . s s' },
    ] },
    ending: { bpm: 92, ch: [
      { p: 'epiano', vol: 0.1, rev: 0.6, n: 'd4 a4 f#4 a4 d5 a4 f#4 a4 | c#4 a4 e4 a4 c#5 a4 e4 a4 | b3 f#4 d4 f#4 b4 f#4 d4 f#4 | g3 d4 b3 d4 g4 d4 b3 d4 | d4 a4 f#4 a4 d5 a4 f#4 a4 | c#4 a4 e4 a4 c#5 a4 e4 a4 | g3 d4 b3 d4 g4 d4 b3 d4 | c#4 a4 e4 a4 c#5 a4 e4 a4' },
      { p: 'strings', vol: 0.07, rev: 0.7, n: bar('d3+f#3+a3', 'c#3+e3+a3', 'b2+d3+f#3', 'b2+d3+g3', 'd3+f#3+a3', 'c#3+e3+a3', 'b2+d3+g3', 'c#3+e3+g3+a3') },
      { p: 'bass', vol: 0.25, n: 'd2 - - - - - a1 - | a1 - - - - - c#2 - | b1 - - - - - f#1 - | g1 - - - - - b1 - | d2 - - - - - a1 - | a1 - - - - - c#2 - | g1 - - - - - b1 - | a1 - - - a2 - a1 -' },
      { p: 'flute', vol: 0.17, rev: 0.6, n: 'f#5 - - - e5 - d5 - | e5 - - - - - c#5 - | d5 - - - f#5 - b5 - | a5 - - - g5 - f#5 e5 | f#5 - - - a5 - f#5 - | e5 - - - c#5 - a4 - | b4 - d5 - g5 - f#5 e5 | e5 - - - - - . .' },
      { p: 'drum', div: 4, vol: 0.18, rev: 0.4, n: 'k . h . . . h . k . h . s . h .' },
    ] },
    fanfare: { bpm: 150, loop: false, ch: [
      { p: 'brass', div: 4, vol: 0.24, rev: 0.4, n: 'g4 c5 e5 g5 - - - - e5 - g5 - c6 - - - - - - - - - - -' },
      { p: 'strings', div: 4, vol: 0.1, rev: 0.5, n: '. . . c4+e4+g4 - - - - - - - - c4+e4+g4+c5 - - - - - - - - - - -' },
      { p: 'bass', div: 4, vol: 0.3, n: '. . . c2 - - - - - - - - c2 - - - - - - - - - - -' },
      { p: 'drum', div: 4, vol: 0.45, n: '. . . k . . . . s . s . k . . . o . . . . . . .' },
    ] },
    gameover: { bpm: 70, loop: false, ch: [
      { p: 'flute', vol: 0.18, rev: 0.7, n: 'a4 - g4 - f4 - e4 - - - d4 - c#4 - - - d4 - - - - - - -' },
      { p: 'strings', vol: 0.09, rev: 0.7, n: 'd3+f3+a3 - - - - - - - a#2+d3+f3 - - - a2+c#3+e3 - - - d3+f3+a3 - - - - - - -' },
      { p: 'bass', vol: 0.28, n: 'd2 - - - - - - - a#1 - - - a1 - - - d1 - - - - - - -' },
    ] },
  };
  for (const tr of Object.values(TRACKS)) for (const ch of tr.ch) Object.assign(ch, parse(ch.n, ch.p === 'drum'));

  // ------------------------------------------------------------ シーケンサ
  let cur = null; // {name, tr, out, start, iters, timer}
  function bgm(name, ahead = 0.25) {
    if (!ac || (cur && cur.name === name)) return;
    stopBgm();
    const tr = TRACKS[name]; if (!tr) return;
    const out = ac.createGain(); out.connect(bus);
    const rev = ac.createGain(); rev.connect(revSend); rev.gain.value = 1;
    const spb = 60 / tr.bpm;
    const start = ac.currentTime + 0.08;
    const iters = tr.ch.map(() => ({ i: 0, base: 0, done: false }));
    const me = { name, out, timer: 0 };
    const tick = () => {
      const horizon = ac.currentTime + ahead;
      tr.ch.forEach((ch, c) => {
        const it = iters[c], div = ch.div || 2, loopBeats = ch.steps / div;
        while (!it.done && ch.events.length) {
          const ev = ch.events[it.i];
          const t = start + (it.base + ev.step / div) * spb;
          if (t > horizon) break;
          const dur = ev.len / div * spb * 0.95;
          const dest = ac.createGain(); dest.connect(out);
          if (ch.rev) { const s = ac.createGain(); s.gain.value = ch.rev; dest.connect(s).connect(rev); }
          if (ch.p === 'drum') ev.notes.forEach(d => DRUM[d] && DRUM[d](t, ch.vol, dest));
          else ev.notes.forEach(f => fm(P[ch.p], f, t, dur, ch.vol, dest));
          if (++it.i >= ch.events.length) {
            it.i = 0; it.base += loopBeats;
            if (tr.loop === false) it.done = true;
          }
        }
      });
    };
    tick();
    me.timer = setInterval(tick, 40);
    me.rev = rev;
    cur = me;
  }
  function stopBgm() {
    if (!cur) return;
    const c = cur; cur = null;
    clearInterval(c.timer);
    const t = ac.currentTime;
    for (const g of [c.out, c.rev]) { g.gain.setValueAtTime(g.gain.value, t); g.gain.linearRampToValueAtTime(0, t + 0.6); }
    setTimeout(() => { c.out.disconnect(); c.rev.disconnect(); }, 3000);
  }

  // ------------------------------------------------------------ 効果音
  function sfxOut(rev = 0.3) {
    const g = ac.createGain(); g.connect(master);
    if (rev) { const s = ac.createGain(); s.gain.value = rev; g.connect(s).connect(revSend); }
    return g;
  }
  const play = fn => () => { if (!ac) return; fn(ac.currentTime + 0.005, sfxOut()); };
  const sfx = {
    step: play((t, o) => fm({ m: [[1, 1, 0, 0.02]], a: 0.002, d: 0.08, s: 0, r: 0.05, pitch: [2, 0.04] }, 70, t, 0.06, 0.22, o)),
    bump: play((t, o) => { fm({ m: [[1.41, 3, 0, 0.04]], a: 0.001, d: 0.15, s: 0, r: 0.1, pitch: [1.5, 0.05] }, 65, t, 0.1, 0.35, o); noise(t, 0.08, 0.15, o, { f0: 600, q: 1 }); }),
    cursor: play((t, o) => fm(P.bell, 1568, t, 0.03, 0.06, o)),
    pickup: play((t, o) => ['e6', 'b6', 'e7'].forEach((n, i) => fm(P.bell, freqOf(n), t + i * 0.07, 0.1, 0.12, o))),
    door: play((t, o) => {
      fm({ m: [[2.76, 7, 0.5, 0.15]], a: 0.002, d: 0.6, s: 0, r: 0.5 }, 82, t, 0.4, 0.4, o);
      noise(t + 0.05, 0.9, 0.25, o, { type: 'lowpass', f0: 400, f1: 80, q: 2 });
      fm({ m: [[1, 2, 0, 0.1]], a: 0.001, d: 0.3, s: 0, r: 0.3, pitch: [2, 0.1] }, 45, t + 0.45, 0.3, 0.5, o);
    }),
    encounter: play((t, o) => {
      fm({ m: [[2, 5, 1, 0.2]], a: 0.005, d: 0.5, s: 0.3, r: 0.2, pitch: [0.25, 0.35] }, 880, t, 0.4, 0.14, o);
      noise(t, 0.45, 0.2, o, { f0: 400, f1: 6000, q: 2, a: 0.3 });
      DRUM.k(t + 0.42, 0.6, o); DRUM.o(t + 0.42, 0.5, o);
    }),
    hit: play((t, o) => {
      noise(t, 0.12, 0.45, o, { f0: 2500, f1: 600, q: 1.2 });
      fm({ m: [[1.41, 8, 0, 0.04]], a: 0.001, d: 0.15, s: 0, r: 0.1, pitch: [2.5, 0.08] }, 160, t, 0.1, 0.4, o);
    }),
    crit: play((t, o) => {
      noise(t, 0.25, 0.55, o, { f0: 5000, f1: 300, q: 1 });
      fm({ m: [[1.41, 10, 0, 0.06]], a: 0.001, d: 0.3, s: 0, r: 0.2, pitch: [3, 0.15] }, 120, t, 0.2, 0.5, o);
      fm(P.bell, 2093, t + 0.02, 0.2, 0.12, o, { bright: 1.5 });
      DRUM.k(t, 0.7, o);
    }),
    hurt: play((t, o) => {
      fm({ m: [[0.5, 6, 1, 0.15]], a: 0.002, d: 0.3, s: 0, r: 0.15, pitch: [1.6, 0.25] }, 110, t, 0.25, 0.45, o);
      noise(t, 0.2, 0.35, o, { type: 'lowpass', f0: 2000, f1: 200, q: 1 });
      DRUM.k(t, 0.6, o);
    }),
    heal: play((t, o) => ['c6', 'e6', 'g6', 'c7', 'e7'].forEach((n, i) => fm(P.bell, freqOf(n), t + i * 0.06, 0.15, 0.1, o))),
    miss: play((t, o) => noise(t, 0.3, 0.25, o, { f0: 600, f1: 4000, q: 3, a: 0.12 })),
    charge: play((t, o) => {
      fm({ m: [[1.5, 6, 3, 0.4]], a: 0.4, d: 1, s: 0.8, r: 0.3, pitch: [0.5, 0.9] }, 110, t, 0.9, 0.3, o);
      fm({ m: [[1.5, 6, 3, 0.4]], a: 0.4, d: 1, s: 0.8, r: 0.3, pitch: [0.5, 0.9] }, 116.5, t, 0.9, 0.3, o);
      noise(t, 1.0, 0.25, o, { f0: 200, f1: 3000, q: 4, a: 0.8 });
    }),
    bigHit: play((t, o) => {
      noise(t, 0.6, 0.6, o, { type: 'lowpass', f0: 6000, f1: 100, q: 0.7 });
      fm({ m: [[0.5, 10, 1, 0.2]], a: 0.001, d: 0.6, s: 0, r: 0.3, pitch: [3, 0.3] }, 60, t, 0.5, 0.6, o);
      DRUM.k(t, 0.9, o);
    }),
    victory: () => bgm('fanfare'),
  };

  function toggleMute() {
    if (!ac) return muted;
    muted = !muted;
    master.gain.setTargetAtTime(muted ? 0 : MASTER_VOL, ac.currentTime, 0.05);
    return muted;
  }

  // デバッグ用: 曲をオフラインで書き出してピーク / RMS を返す
  async function analyze(name, sec = 8) {
    const saved = { ac, master, bus, revSend, noiseBuf, cur };
    const sr = 44100, off = new OfflineAudioContext(2, sr * sec, sr);
    build(off); cur = null;
    bgm(name, sec); clearInterval(cur.timer);
    const buf = await off.startRendering();
    ({ ac, master, bus, revSend, noiseBuf, cur } = saved);
    let peak = 0, sum = 0;
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > peak) peak = v; sum += v * v; }
    return { name, peak: +peak.toFixed(3), rms: +Math.sqrt(sum / d.length).toFixed(3) };
  }

  return { init, analyze, bgm, stopBgm, sfx, toggleMute, get ready() { return !!ac; }, get muted() { return muted; } };
})();
