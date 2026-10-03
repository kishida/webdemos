// ============================================================
//  FM音源シンセサイザー (Web Audio)
//  - オペレータ: キャリア1 + モジュレータ複数 (並列/直列)
//  - モジュレーションインデックスにエンベロープ → FMらしい音色変化
//  - MML風メロディ + コード進行からの伴奏自動生成シーケンサ
// ============================================================
const FM = (() => {
  let ctx = null, analyser, master, musicBus, seBus, reverb, reverbSend, noiseBuf;
  let musicVol = 0.55, seVol = 0.7;

  function init() {
    if (ctx) { if (ctx.state === 'suspended') ctx.resume(); return; }
    ctx = new (window.AudioContext || window.webkitAudioContext)();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    master = ctx.createGain(); master.gain.value = 0.9;
    // FM(1:1比)で生じる直流・超低域成分をカット (うなり/こもりの原因になる)
    const hpf = ctx.createBiquadFilter(); hpf.type = 'highpass'; hpf.frequency.value = 38; hpf.Q.value = 0.7;
    master.connect(hpf).connect(comp).connect(ctx.destination);
    // タブが非表示の間は音を止める (別タブで開きっぱなしでも鳴り続けないように)
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) ctx.suspend(); else ctx.resume();
    });
    analyser = ctx.createAnalyser(); analyser.fftSize = 2048; comp.connect(analyser);
    musicBus = ctx.createGain(); musicBus.gain.value = musicVol; musicBus.connect(master);
    seBus = ctx.createGain(); seBus.gain.value = seVol; seBus.connect(master);
    // 簡易リバーブ (ノイズ減衰インパルス)
    reverb = ctx.createConvolver();
    const len = ctx.sampleRate * 2.2, ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2);
    }
    reverb.buffer = ir;
    reverbSend = ctx.createGain(); reverbSend.gain.value = 0.28;
    reverbSend.connect(reverb).connect(master);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const nd = noiseBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  }

  const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

  // ---------------- 音色パッチ ----------------
  // cr: キャリア周波数比 / mods: {r:比, i:ピークindex, is:サステインindex, a:アタック, d:ディケイ, to:'c'|0(直列先)}
  // amp: [attack, decay, sustain, release]
  const PATCHES = {
    epiano: { cr: 1, mods: [{ r: 1, i: 1.6, is: 0.25, a: 0.002, d: 0.9 }, { r: 14, i: 0.5, is: 0, a: 0.001, d: 0.12 }], amp: [0.004, 1.6, 0.18, 0.35], gain: 0.20, rev: 0.3 },
    brass:  { cr: 1, mods: [{ r: 1, i: 0.4, ia: 3.2, is: 2.3, a: 0.07, d: 0.3 }], amp: [0.035, 0.25, 0.82, 0.14], gain: 0.15, vib: [5.5, 7, 0.25], rev: 0.25 },
    flute:  { cr: 1, mods: [{ r: 2, i: 1.4, is: 0.6, a: 0.01, d: 0.2 }], amp: [0.02, 0.2, 0.7, 0.1], gain: 0.15, vib: [5.8, 9, 0.18], rev: 0.25 },
    bass:   { cr: 1, mods: [{ r: 1, i: 4.5, is: 1.0, a: 0.002, d: 0.22 }, { r: 3, i: 0.6, is: 0, a: 0.001, d: 0.05 }], amp: [0.004, 0.5, 0.55, 0.06], gain: 0.30, rev: 0.05 },
    bell:   { cr: 1, mods: [{ r: 3.5, i: 3.2, is: 0, a: 0.001, d: 1.4 }], amp: [0.002, 2.8, 0.0, 1.2], gain: 0.16, rev: 0.5 },
    strings:{ cr: 1, mods: [{ r: 1, i: 0.2, ia: 0.9, is: 0.35, a: 0.4, d: 1.2 }], amp: [0.3, 2.2, 0.25, 0.7], gain: 0.05, detune: 7, vib: [5, 4, 0.4], rev: 0.5 },
    clav:   { cr: 1, mods: [{ r: 3, i: 2.5, is: 0.2, a: 0.001, d: 0.1 }], amp: [0.002, 0.25, 0.15, 0.06], gain: 0.11, rev: 0.15 },
    glock:  { cr: 2, mods: [{ r: 7, i: 2.0, is: 0, a: 0.001, d: 0.4 }], amp: [0.001, 1.0, 0.0, 0.5], gain: 0.07, rev: 0.45 },
  };

  // 1音を発音
  function playNote(patchName, midi, t, dur, vel = 1, dest) {
    const p = PATCHES[patchName];
    const f = mtof(midi);
    const [A, D, S, R] = p.amp;
    const end = t + dur;
    const stopAt = end + R + 0.05;
    const out = ctx.createGain();
    const peak = p.gain * vel;
    out.gain.setValueAtTime(0, t);
    out.gain.linearRampToValueAtTime(peak, t + A);
    out.gain.setTargetAtTime(peak * S, t + A, D / 3);
    out.gain.cancelScheduledValues(end);
    out.gain.setTargetAtTime(0, end, R / 4);
    out.connect(dest || musicBus);
    if (p.rev) { const s = ctx.createGain(); s.gain.value = p.rev; out.connect(s).connect(reverbSend); }

    const carriers = [];
    const dets = p.detune ? [-p.detune, p.detune] : [0];
    dets.forEach(dt => {
      const c = ctx.createOscillator();
      c.frequency.value = f * p.cr; c.detune.value = dt;
      const cg = ctx.createGain(); cg.gain.value = 1 / dets.length;
      c.connect(cg).connect(out);
      carriers.push(c);
    });
    // ビブラート
    let lfo;
    if (p.vib) {
      lfo = ctx.createOscillator(); lfo.frequency.value = p.vib[0];
      const lg = ctx.createGain();
      lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(p.vib[1], t + p.vib[2] + 0.2);
      lfo.connect(lg); carriers.forEach(c => lg.connect(c.detune));
      lfo.start(t); lfo.stop(stopAt);
    }
    // モジュレータ
    const modNodes = [];
    p.mods.forEach((m, idx) => {
      const mo = ctx.createOscillator();
      const mf = f * m.r;
      mo.frequency.value = mf;
      const mg = ctx.createGain();
      const i0 = (m.ia !== undefined ? m.i : m.i) * mf;
      const ipk = (m.ia !== undefined ? m.ia : m.i) * mf;
      const is = m.is * mf;
      const vscale = 0.6 + 0.4 * vel;
      mg.gain.setValueAtTime(i0 * vscale, t);
      mg.gain.linearRampToValueAtTime(ipk * vscale, t + m.a);
      mg.gain.setTargetAtTime(is * vscale, t + m.a, m.d / 3);
      mg.gain.setTargetAtTime(0, end + R * 0.5, R / 3);
      mo.connect(mg);
      modNodes.push({ mo, mg, to: m.to });
      mo.start(t); mo.stop(stopAt);
    });
    modNodes.forEach(n => {
      if (n.to === undefined || n.to === 'c') carriers.forEach(c => n.mg.connect(c.frequency));
      else n.mg.connect(modNodes[n.to].mo.frequency); // 直列接続
    });
    carriers.forEach(c => { c.start(t); c.stop(stopAt); });
  }

  // ---------------- ドラム (SSG/リズム音源風) ----------------
  function drum(type, t, vel = 1, dest) {
    const d = dest || musicBus;
    if (type === 'k') {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.frequency.setValueAtTime(160, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12);
      g.gain.setValueAtTime(0.55 * vel, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
      o.connect(g).connect(d); o.start(t); o.stop(t + 0.32);
    } else if (type === 's') {
      const n = ctx.createBufferSource(); n.buffer = noiseBuf;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1800; bp.Q.value = 0.7;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.32 * vel, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
      n.connect(bp).connect(g).connect(d);
      const rs = ctx.createGain(); rs.gain.value = 0.25; g.connect(rs).connect(reverbSend);
      n.start(t); n.stop(t + 0.2);
      const o = ctx.createOscillator(), og = ctx.createGain();
      o.frequency.setValueAtTime(240, t); o.frequency.exponentialRampToValueAtTime(150, t + 0.06);
      og.gain.setValueAtTime(0.2 * vel, t); og.gain.exponentialRampToValueAtTime(0.001, t + 0.08);
      o.connect(og).connect(d); o.start(t); o.stop(t + 0.1);
    } else if (type === 'h' || type === 'o') {
      const n = ctx.createBufferSource(); n.buffer = noiseBuf;
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 7500;
      const g = ctx.createGain(); const len = type === 'h' ? 0.045 : 0.22;
      g.gain.setValueAtTime(0.11 * vel, t); g.gain.exponentialRampToValueAtTime(0.001, t + len);
      n.connect(hp).connect(g).connect(d); n.start(t, Math.random() * 0.5); n.stop(t + len + 0.02);
    } else if (type === 'c') { // クラッシュ
      const n = ctx.createBufferSource(); n.buffer = noiseBuf;
      const hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 4000;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.13 * vel, t); g.gain.exponentialRampToValueAtTime(0.001, t + 1.4);
      n.connect(hp).connect(g).connect(d);
      const rs = ctx.createGain(); rs.gain.value = 0.4; g.connect(rs).connect(reverbSend);
      n.start(t); n.stop(t + 1.5);
    }
  }

  // ---------------- MMLパーサ ----------------
  // o<n> オクターブ, l<n> 既定音長, < > オクターブ上下, c-b (+#-) 音符, r 休符, & タイ, . 付点
  function parseMML(src) {
    const ev = []; let oct = 4, len = 4, t = 0, i = 0;
    const s = src.replace(/\s+/g, '');
    const semi = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };
    const readNum = () => { let n = ''; while (i < s.length && /[0-9]/.test(s[i])) n += s[i++]; return n ? parseInt(n) : null; };
    const readLen = () => {
      const n = readNum(); let b = 4 / (n || len); let add = b;
      while (s[i] === '.') { add /= 2; b += add; i++; }
      return b;
    };
    let tie = false;
    while (i < s.length) {
      const ch = s[i++];
      if (ch === 'o') oct = readNum();
      else if (ch === 'l') len = readNum();
      else if (ch === '<') oct--;
      else if (ch === '>') oct++;
      else if (ch === '&') tie = true;
      else if (ch === 'r') { t += readLen(); tie = false; }
      else if (semi[ch] !== undefined) {
        let m = semi[ch];
        while (s[i] === '+' || s[i] === '#' || s[i] === '-') { m += s[i] === '-' ? -1 : 1; i++; }
        const midi = (oct + 1) * 12 + m;
        const b = readLen();
        const last = ev[ev.length - 1];
        if (tie && last && last.m === midi) last.d += b;
        else ev.push({ t, d: b, m: midi });
        t += b; tie = false;
      }
    }
    return { ev, len: t };
  }

  // ---------------- コード解析 ----------------
  const QUAL = { '': [0, 4, 7], 'm': [0, 3, 7], '7': [0, 4, 7, 10], 'M7': [0, 4, 7, 11], 'm7': [0, 3, 7, 10],
    'sus4': [0, 5, 7], '7sus4': [0, 5, 7, 10], 'add9': [0, 4, 7, 14], 'm9': [0, 3, 7, 10, 14], 'dim': [0, 3, 6] };
  const ROOT = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  function parseChord(name) {
    const mt = name.match(/^([A-G])([b#]?)(.*)$/);
    let r = ROOT[mt[1]] + (mt[2] === 'b' ? -1 : mt[2] === '#' ? 1 : 0);
    r = (r + 12) % 12;
    return { root: r, iv: QUAL[mt[3]] || QUAL[''] };
  }
  // 指定音域へボイシング
  function voice(ch, lo) {
    return ch.iv.map(iv => { let n = ch.root + iv; while (n < lo) n += 12; while (n >= lo + 12) n -= 12; return n; }).sort((a, b) => a - b);
  }

  // ---------------- 曲データ → イベント列 ----------------
  function buildSong(song) {
    const events = []; // {t(beat), fn}
    const bars = song.bars;
    const total = bars.length * 4;
    const chordsAt = []; // 各2拍ごとのコード
    bars.forEach((b, bi) => {
      const parts = b.split('|').map(parseChord);
      if (parts.length === 1) { chordsAt.push({ t: bi * 4, d: 4, c: parts[0] }); }
      else { chordsAt.push({ t: bi * 4, d: 2, c: parts[0] }); chordsAt.push({ t: bi * 4 + 2, d: 2, c: parts[1] }); }
    });
    const N = (patch, m, t, d, v) => events.push({ t, k: 'n', patch, m, d, v });
    const Dr = (type, t, v) => events.push({ t, k: 'd', type, v });

    // メロディ
    (song.mel || []).forEach(trk => {
      const p = parseMML(trk.mml);
      p.ev.forEach(e => N(trk.patch, e.m + (trk.tr || 0), e.t, e.d * (trk.gate || 0.92), trk.v || 1));
    });

    const st = song.style;
    chordsAt.forEach(({ t, d, c }) => {
      const bassRoot = c.root + 36 + (c.root > 7 ? -12 : 0) + 12; // E2〜D#3あたり
      const chord = voice(c, 55);
      const chordHi = voice(c, 62);
      if (st === 'pop') {
        for (let b = 0; b < d; b += 0.5) {
          const pat = [0, 0, 12, 0, 0, 12, 7, 12];
          N('bass', bassRoot + pat[(b * 2) % 8], t + b, 0.4, b % 1 === 0 ? 1 : 0.75);
        }
        for (let b = 0; b < d; b += 1) chord.forEach(n => N('epiano', n, t + b + 0.5, 0.4, 0.75));
        chord.forEach(n => N('strings', n + 12, t, Math.min(d, 2) - 0.05, 0.7));
      } else if (st === 'bouncy') {
        for (let b = 0; b < d; b += 1) {
          N('bass', bassRoot + (b % 2 ? 7 : 0), t + b, 0.35, 1);
          chordHi.forEach(n => N('clav', n, t + b + 0.5, 0.2, 0.8));
        }
        chord.forEach(n => N('epiano', n, t, 0.3, 0.6));
      } else if (st === 'calm') {
        const arp = [chord[0], chord[1], chord[2], chord[0] + 12, chord[(3) % chord.length] + (chord.length > 3 ? 0 : 12), chord[2], chord[1], chord[2]];
        for (let b = 0; b < d; b += 0.5) N('epiano', arp[(b * 2) % 8], t + b, 0.9, 0.6);
        N('bass', bassRoot, t, 0.9, 0.6);
        if (d >= 4) N('bass', bassRoot + 7, t + 2, 0.9, 0.45);
        chord.forEach(n => N('strings', n, t, Math.min(d, 2) - 0.05, 0.6));
      } else if (st === 'ballad') {
        const arp = [chord[0], chord[1] + 12, chord[2], chord[0] + 12, chord[2] + 12, chord[1] + 12];
        for (let b = 0; b < d; b += 0.5) N('epiano', arp[(b * 2) % 6], t + b, 0.8, 0.5);
        N('bass', bassRoot, t, 0.95, 0.7); N('bass', bassRoot + 7, t + d * 0.5, 0.95, 0.5);
        chord.forEach(n => N('strings', n + 12, t, Math.min(d, 2) - 0.05, 0.9));
      }
    });
    // ドラム
    if (song.drums) {
      for (let bar = 0; bar < bars.length; bar++) {
        const t = bar * 4;
        if (song.drums === 'pop') {
          Dr('k', t); Dr('k', t + 1.5, 0.7); Dr('k', t + 2); Dr('s', t + 1); Dr('s', t + 3);
          for (let h = 0; h < 8; h++) Dr(h === 7 ? 'o' : 'h', t + h * 0.5, h % 2 ? 0.6 : 1);
          if (bar % 8 === 0) Dr('c', t);
          if (bar % 4 === 3) { Dr('s', t + 3.5, 0.6); Dr('s', t + 3.75, 0.8); }
        } else if (song.drums === 'bouncy') {
          Dr('k', t); Dr('k', t + 2); Dr('k', t + 2.5, 0.6); Dr('s', t + 1); Dr('s', t + 3);
          for (let h = 0; h < 8; h++) Dr('h', t + h * 0.5, h % 2 ? 0.5 : 0.9);
          if (bar % 8 === 0) Dr('c', t);
        } else if (song.drums === 'soft') {
          if (bar >= 4) { Dr('k', t, 0.6); Dr('s', t + 2, 0.4); for (let h = 0; h < 4; h++) Dr('h', t + h, 0.5); }
          if (bar % 8 === 4) Dr('c', t, 0.6);
        }
      }
    }
    events.sort((a, b) => a.t - b.t);
    return { events, total, bpm: song.bpm };
  }

  // ---------------- シーケンサ ----------------
  let current = null; // {name, built, startTime, idx, loop, bus, timer}
  const songCache = {};

  function play(name) {
    if (!ctx) return;
    if (current && current.name === name) return;
    stop(0.8);
    const song = SONGS[name]; if (!song) return;
    const built = songCache[name] || (songCache[name] = buildSong(song));
    const bus = ctx.createGain(); bus.gain.value = 0; bus.connect(musicBus);
    bus.gain.linearRampToValueAtTime(1, ctx.currentTime + 0.3);
    const spb = 60 / built.bpm;
    const st = { name, built, spb, start: ctx.currentTime + 0.15, idx: 0, loop: 0, bus };
    st.timer = setInterval(() => schedule(st), 25);
    current = st; schedule(st);
  }

  function schedule(st) {
    const ahead = ctx.currentTime + 0.15;
    const { events, total } = st.built;
    while (true) {
      if (st.idx >= events.length) { st.idx = 0; st.loop++; if (st.built.once) return; }
      const e = events[st.idx];
      const time = st.start + (e.t + st.loop * total) * st.spb;
      if (time > ahead) break;
      if (time >= ctx.currentTime - 0.05) {
        if (e.k === 'n') playNote(e.patch, e.m, time, e.d * st.spb, e.v, st.bus);
        else drum(e.type, time, e.v || 1, st.bus);
      }
      st.idx++;
    }
  }

  function stop(fade = 0.8) {
    if (!current) return;
    const c = current; current = null;
    clearInterval(c.timer);
    const now = ctx.currentTime;
    c.bus.gain.cancelScheduledValues(now);
    c.bus.gain.setValueAtTime(c.bus.gain.value, now);
    c.bus.gain.linearRampToValueAtTime(0, now + fade);
    setTimeout(() => c.bus.disconnect(), (fade + 4) * 1000);
  }

  // ---------------- 効果音 ----------------
  function se(name) {
    if (!ctx) return;
    const t = ctx.currentTime + 0.01;
    switch (name) {
      case 'blip': playNote('clav', 84 + Math.floor(Math.random() * 3), t, 0.02, 0.25, seBus); break;
      case 'click': playNote('glock', 88, t, 0.05, 0.8, seBus); break;
      case 'select': playNote('bell', 79, t, 0.1, 0.8, seBus); playNote('bell', 86, t + 0.07, 0.1, 0.7, seBus); break;
      case 'up': [76, 79, 83, 88].forEach((m, i) => playNote('bell', m, t + i * 0.07, 0.15, 0.8, seBus)); break;
      case 'down': [72, 68, 65].forEach((m, i) => playNote('epiano', m, t + i * 0.1, 0.2, 0.6, seBus)); break;
      case 'chime': [84, 79, 76, 72].forEach((m, i) => playNote('bell', m, t + i * 0.35, 0.5, 0.7, seBus)); break;
      case 'heart': [81, 85, 88, 93].forEach((m, i) => playNote('glock', m, t + i * 0.05, 0.1, 1, seBus)); break;
      case 'shock': playNote('brass', 50, t, 0.25, 1, seBus); playNote('brass', 51, t, 0.25, 1, seBus); break;
    }
  }

  function setMusicVol(v) { musicVol = v; if (musicBus) musicBus.gain.value = v; }
  function setSeVol(v) { seVol = v; if (seBus) seBus.gain.value = v; }

  return { init, play, stop, se, setMusicVol, setSeVol, get analyser() { return analyser; }, get current() { return current && current.name; }, PATCHES, playNote, parseMML };
})();

// ============================================================
//  BGMデータ (メロディはMML、伴奏はコード進行から自動生成)
// ============================================================
const SONGS = {
  // タイトル「桜色メモリアル」 F major 王道進行
  title: {
    bpm: 128, style: 'pop', drums: 'pop',
    bars: ['BbM7', 'C', 'Am7', 'Dm7', 'Gm7', 'C', 'FM7', 'F',
           'BbM7', 'C', 'Am7', 'Dm7', 'Gm7', 'C7sus4|C7', 'F', 'F'],
    mel: [{ patch: 'brass', tr: 0, mml:
      'o5 d4 f4 a4. g8 | g4 e4 c4 e8 g8 | a4. g8 e4 c4 | d2 r8 d8 e8 f8 |' +
      'g4. f8 d4 f8 g8 | a4 g4 e4 c4 | f2. e8 f8 | f2 r4 c8 d8 |' +
      'f4 b-4 a4 g8 f8 | g4. a8 g4 e4 | e4 a4 o6 c4 o5 b8 a8 | a2 f4 a4 |' +
      'b-4 a4 g4 f4 | g4 f4 e4 g4 | a4 g8 f8 f2 | r2 r8 c8 d8 e8'.replace(/\|/g, '') },
      { patch: 'glock', tr: 12, v: 0.5, mml:
      'r1 r1 r1 r1 r1 r1 r1 r1 o5 f4 b-4 a4 g8 f8 g4. a8 g4 e4 e4 a4 o6 c4 o5 b8 a8 a2 f4 a4 b-4 a4 g4 f4 g4 f4 e4 g4 a4 g8 f8 f2 r1' }],
  },
  // 日常「いつもの放課後」 C major 軽快
  daily: {
    bpm: 136, style: 'bouncy', drums: 'bouncy',
    bars: ['C', 'Am', 'F', 'G', 'C', 'Am', 'Dm7', 'G7', 'F', 'G', 'Em', 'Am', 'Dm7', 'G7', 'C', 'C'],
    mel: [{ patch: 'flute', gate: 0.8, mml:
      'o5 e8 g8 r8 g8 a8 g8 e8 c8  a4 e8 c8 e4 r4  f8 a8 r8 a8 o6 c8 o5 a8 f8 a8  g4. a8 b4 o6 d4 ' +
      'o5 e8 g8 r8 g8 a8 g8 e8 c8  e4 a8 g8 e4 c4  d8 f8 a8 o6 c8 o5 a4 f4  g2. r4 ' +
      'a4 a8 b8 o6 c4 o5 a4  b4 b8 o6 c8 d4 o5 b4  o6 e4 d8 c8 o5 b4 g4  a4. b8 o6 c4 o5 e4 ' +
      'f4 a4 o6 d4 c8 o5 b8  b4 a4 g4 f4  e4 g8 e8 c2  r1' }],
  },
  // 夜・自室「星降る夜に」 静か
  night: {
    bpm: 80, style: 'calm',
    bars: ['FM7', 'G', 'Em7', 'Am7', 'Dm7', 'Em7', 'FM7', 'E7sus4|E7'],
    mel: [{ patch: 'bell', tr: 0, v: 0.8, mml:
      'o5 e2 c4 o4 a4  b2. o5 d4  e2 g4 f8 e8  e2. r4  f2 a4 g8 f8  g2 e4 d4  c2 e4 a4  a2 g+2' }],
  },
  // 告白・エンディング「桜の木の下で」 D major バラード
  confession: {
    bpm: 72, style: 'ballad', drums: 'soft',
    bars: ['G', 'A', 'F#m', 'Bm', 'Em7', 'A7', 'D', 'D', 'G', 'A', 'F#m', 'Bm', 'Em7', 'A7sus4|A7', 'D', 'D'],
    mel: [{ patch: 'bell', v: 0.9, mml:
      'o5 b2 a4 b4  o6 c+2 o5 a2  a2 f+4 a4  b2. a4  g2 f+4 e4  e2 a4 g4  f+1  r2. a4 ' +
      'b2 o6 d4 o5 b4  o6 c+2 e4 c+4  c+2 o5 a4 f+4  b2 o6 d4 c+4  o5 b2 g4 e4  o6 d2 c+2  d1  r1' },
      { patch: 'flute', tr: -12, v: 0.5, mml:
      'r1 r1 r1 r1 r1 r1 r1 r1 o5 b2 o6 d4 o5 b4  o6 c+2 e4 c+4  c+2 o5 a4 f+4  b2 o6 d4 c+4  o5 b2 g4 e4  o6 d2 c+2  d1  r1' }],
  },
  // ちょっとコミカル「ドタバタ・ハプニング」
  comical: {
    bpm: 150, style: 'bouncy', drums: 'bouncy',
    bars: ['F', 'G', 'Em7', 'A7', 'Dm7', 'G7', 'C', 'C7'],
    mel: [{ patch: 'clav', v: 1.4, gate: 0.6, mml:
      'o5 c8 c8 f8 r8 a8 g8 f8 r8  d8 d8 g8 r8 b8 a8 g8 r8  e8 g8 b8 g8 e4 r8 e8  c+8 e8 a8 g8 c+4 r4 ' +
      'd8 f8 a8 f8 o6 d8 o5 a8 f8 d8  f4 d8 o4 b8 r8 b8 o5 d8 f8  e4 g4 c4 r8 c8  b-4 g4 e4 r4' }],
  },
};
