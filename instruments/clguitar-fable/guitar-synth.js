/*
 * クラシックギター物理モデル音源
 *
 *  弦   : デジタルウェーブガイド（単一遅延ループ）。弦1本につき垂直・水平の2偏波。
 *         撥弦は「指で三角形に引っ張って離す」初期変位をそのままループに載せる。
 *         出力はブリッジにかかる力（= ブリッジ端での弦の傾き = ループ信号の微分）。
 *  損失 : 周波数依存の減衰（基音と3kHzのT60を指定して1極フィルタを設計）。
 *  調律 : 1次オールパスによる分数遅延。
 *  共鳴 : ブリッジを介して全弦が結合（共鳴弦）。
 *  胴   : ボディ／空気モードの並列共振器バンク。
 *  部屋 : Schroeder/Freeverb 型の残響。
 */
// ブラウザでは関数のソースをそのまま AudioWorklet に渡すので、外部変数に依存しないこと
function GuitarPhysFactory(root) {
  'use strict';

  const TUNING = [40, 45, 50, 55, 59, 64]; // 6弦→1弦 (E2 A2 D3 G3 B3 E4)
  // 開放弦の基音T60[s] と 3kHz付近のT60[s]（6〜4弦は巻弦、3〜1弦はナイロン）
  const T60_F0 = [5.5, 5.0, 4.4, 3.6, 3.3, 3.0];
  const T60_HI = [1.7, 1.6, 1.5, 0.8, 0.75, 0.7];

  const DEFAULTS = {
    betaScale: 1.4,   // 撥弦位置の倍率（小=ブリッジ寄り）
    touchScale: 1.25, // タッチ（小=爪・硬い / 大=指頭・柔らかい）
    body: 1.0,        // ボディ共鳴の量
    symp: 1.0,        // 共鳴弦の結合量
    reverb: 0.08,     // 残響ミックス
  };

  function midiHz(m) { return 440 * Math.pow(2, (m - 69) / 12); }

  // 基音と高域のT60から、ループ損失フィルタ H(z)=b0/(1+a z^-1) を設計
  function designLoop(f0, T1, T2, fs) {
    const w1 = 2 * Math.PI * f0 / fs;
    const fh = Math.min(0.45 * fs, Math.max(3000, 3 * f0));
    const w2 = 2 * Math.PI * fh / fs;
    const G1 = Math.pow(10, -3 / (T1 * f0));
    const G2 = Math.pow(10, -3 / (T2 * f0));
    const target = (G2 / G1) * (G2 / G1);
    const c1 = Math.cos(w1), c2 = Math.cos(w2);
    const r = (a) => (1 + a * a + 2 * a * c1) / (1 + a * a + 2 * a * c2);
    let lo = -0.9995, hi = 0;
    if (r(lo) > target) { hi = lo; }
    else {
      for (let i = 0; i < 48; i++) {
        const mid = 0.5 * (lo + hi);
        if (r(mid) > target) hi = mid; else lo = mid;
      }
    }
    const a = hi;
    let g = G1 * Math.sqrt(1 + a * a + 2 * a * c1) / (1 + a);
    if (g > 0.99995) g = 0.99995;
    const pd = Math.atan2(-a * Math.sin(w1), 1 + a * c1) / w1; // 位相遅延[samples]
    const total = fs / f0;
    let M = Math.floor(total - pd - 0.5);
    if (M < 2) M = 2;
    const d = total - pd - M;
    return { a, b0: g * (1 + a), M, C: (1 - d) / (1 + d) };
  }

  // ボディモード (周波数Hz, Q, ゲイン)。低次は実測的な値、高次は擬似乱数で密に。
  function bodyModes() {
    const m = [
      [98, 16, 0.55],   // A0 空気（ヘルムホルツ）共鳴
      [204, 24, 0.75],  // T(1,1) 表板
      [282, 30, 0.45],
      [368, 30, 0.55],
      [431, 34, 0.5],
      [512, 34, 0.38],
      [588, 36, 0.42],
      [690, 36, 0.32],
    ];
    let seed = 12345;
    const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
    let f = 780;
    while (f < 5200) {
      m.push([f * (0.97 + 0.06 * rnd()), 30 + 25 * rnd(), 0.34 * Math.pow(780 / f, 0.55) * (0.6 + 0.8 * rnd())]);
      f *= 1.085 + 0.05 * rnd();
    }
    return m;
  }

  class GuitarSynth {
    constructor(fs, params) {
      this.fs = fs;
      this.p = Object.assign({}, DEFAULTS, params || {});
      this.events = [];
      this.evIdx = 0;
      this.pos = 0;
      this.fPrev = 0;
      this.running = true; // false の間は楽譜を進めない（弦・胴・残響は鳴り続ける）

      this.strings = [];
      for (let i = 0; i < 6; i++) {
        const maxLen = Math.ceil(fs / midiHz(TUNING[i] - 1)) + 8;
        const st = {
          idx: i, fret: 0, noteId: -1,
          bufV: new Float64Array(maxLen), bufH: new Float64Array(maxLen),
          MV: 2, MH: 2, rpV: 0, rpH: 0,
          CV: 0, CH: 0, b0V: 0, aV: 0, b0H: 0, aH: 0,
          axV: 0, ayV: 0, lpV: 0, axH: 0, ayH: 0, lpH: 0,
          kill: 1, killStep: 0, pending: 0, fOwn: 0, free: true,
        };
        this.configure(st, 0);
        this.strings.push(st);
      }

      // ボディ
      const modes = bodyModes();
      const n = modes.length;
      this.nModes = n;
      this.mb0 = new Float64Array(n); this.ma1 = new Float64Array(n); this.ma2 = new Float64Array(n);
      this.my1 = new Float64Array(n); this.my2 = new Float64Array(n);
      this.mgL = new Float64Array(n); this.mgR = new Float64Array(n);
      for (let k = 0; k < n; k++) {
        const [f, Q, g] = modes[k];
        const w0 = 2 * Math.PI * f / fs, al = Math.sin(w0) / (2 * Q);
        this.mb0[k] = al / (1 + al);
        this.ma1[k] = -2 * Math.cos(w0) / (1 + al);
        this.ma2[k] = (1 - al) / (1 + al);
      }
      this.modes = modes;
      this.setParams({});
      this.bx1 = 0; this.bx2 = 0;
      this.hpC = Math.exp(-2 * Math.PI * 120 / fs); this.hpS = 0;
      this.lpC = Math.exp(-2 * Math.PI * 9000 / fs); this.lpS = 0;

      // 残響 (Freeverb)
      const sc = fs / 44100;
      const combT = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
      const apT = [556, 441, 341, 225];
      const mk = (len) => ({ b: new Float64Array(Math.round(len * sc)), i: 0, s: 0 });
      this.combL = combT.map((t) => mk(t)); this.combR = combT.map((t) => mk(t + 23));
      this.apL = apT.map((t) => mk(t)); this.apR = apT.map((t) => mk(t + 23));
      this.pre = new Float64Array(Math.round(0.012 * fs)); this.preI = 0;
    }

    // 演奏中でも変更できる
    setParams(p) {
      Object.assign(this.p, p);
      for (let k = 0; k < this.nModes; k++) {
        const g = this.modes[k][2];
        const pan = k < 2 ? 0 : (((k * 7) % 5) / 4 - 0.5) * 0.9; // 低次モードは中央
        this.mgL[k] = g * this.p.body * Math.sqrt(0.5 * (1 - pan));
        this.mgR[k] = g * this.p.body * Math.sqrt(0.5 * (1 + pan));
      }
    }

    // 全弦を手で押さえて止める
    allOff() {
      for (const st of this.strings) { st.killStep = 1 / (0.03 * this.fs); st.pending = 1; st.noteId = -1; }
    }

    // 楽譜上の位置を変える
    seek(sec) {
      this.pos = Math.max(0, Math.round(sec * this.fs));
      let i = 0;
      while (i < this.events.length && this.events[i].smp < this.pos) i++;
      this.evIdx = i;
      this.allOff();
    }

    // 楽譜と無関係に、いますぐ1音弾く
    userPluck(s, fret, vel, beta, touch) {
      const st = this.strings[6 - s];
      this.pluck(st, fret, vel, beta, touch);
      st.noteId = -2;
    }

    configure(st, fret) {
      const i = st.idx, fs = this.fs;
      const f0 = midiHz(TUNING[i] + fret);
      const k = fret > 0 ? 0.85 : 1.0; // 押弦は指の肉で少し減衰が速い
      const v = designLoop(f0, T60_F0[i] * k * 0.9, T60_HI[i] * 0.9, fs);
      const h = designLoop(f0 * 1.00012, T60_F0[i] * k * 1.25, T60_HI[i] * 1.1, fs);
      st.fret = fret;
      st.MV = v.M; st.CV = v.C; st.b0V = v.b0; st.aV = v.a;
      st.MH = h.M; st.CH = h.C; st.b0H = h.b0; st.aH = h.a;
    }

    clear(st) {
      st.bufV.fill(0); st.bufH.fill(0);
      st.rpV = 0; st.rpH = 0;
      st.axV = st.ayV = st.lpV = st.axH = st.ayH = st.lpH = 0;
      st.fOwn = 0;
    }

    // 三角形の初期変位（奇関数拡張）をループへ。beta=ブリッジからの撥弦位置比
    pluck(st, fret, vel, beta, touch) {
      this.configure(st, fret);
      this.clear(st);
      const fs = this.fs;
      beta = Math.min(0.45, Math.max(0.03, beta * this.p.betaScale));
      const A = Math.pow(vel, 1.3);
      // 指が弦を離れるまでの時間＋指の幅 → 角の丸み
      const w = Math.max(1, Math.round(0.00010 * fs * touch * this.p.touchScale * (1.5 - 0.7 * vel)));
      const ang = 0.62; // 撥弦方向（表板に対する角度）
      const amp = [A * Math.cos(ang), A * Math.sin(ang)];
      const bufs = [st.bufV, st.bufH], Ms = [st.MV, st.MH];
      for (let p = 0; p < 2; p++) {
        const M = Ms[p], b = bufs[p];
        const h = amp[p] * beta * M / 2;
        const tmp = new Float64Array(M);
        for (let k2 = 0; k2 < M; k2++) {
          let u = 2 * k2 / M, sgn = 1;
          if (u > 1) { u = 2 - u; sgn = -1; }
          tmp[k2] = sgn * h * (u < beta ? u / beta : (1 - u) / (1 - beta));
        }
        // 円環ボックスブラー×2
        const ww = Math.min(w, Math.max(1, Math.floor(M / 4)));
        let src = tmp, dst = new Float64Array(M);
        for (let pass = 0; pass < 2; pass++) {
          let acc = 0;
          const half = Math.floor(ww / 2);
          for (let j = -half; j < ww - half; j++) acc += src[((j % M) + M) % M];
          for (let k2 = 0; k2 < M; k2++) {
            dst[k2] = acc / ww;
            acc += src[(k2 + ww - half) % M] - src[((k2 - half) % M + M) % M];
          }
          const t = src; src = dst; dst = t;
        }
        for (let k2 = 0; k2 < M; k2++) b[k2] = src[k2];
      }
      st.kill = 1; st.killStep = 0; st.pending = 0; st.free = true;
    }

    // notes: [{t, dur, s(1..6), fret, vel, beta, touch}]
    schedule(notes) {
      const fs = this.fs, ev = [];
      notes.forEach((n, id) => {
        const si = 6 - n.s, on = Math.max(0, Math.round(n.t * fs));
        ev.push({ smp: Math.max(0, on - Math.round(0.005 * fs)), type: 1, si, id });
        ev.push({ smp: on, type: 2, si, id, fret: n.fret, vel: n.vel, beta: n.beta || 0.14, touch: n.touch || 1 });
        ev.push({ smp: on + Math.max(1, Math.round(n.dur * fs)), type: 0, si, id });
      });
      ev.sort((a, b) => a.smp - b.smp || a.type - b.type);
      this.events = ev; this.evIdx = 0;
    }

    handle(e) {
      const st = this.strings[e.si], fs = this.fs;
      if (e.type === 2) { this.pluck(st, e.fret, e.vel, e.beta, e.touch); st.noteId = e.id; }
      else if (e.type === 1) { // 撥弦直前：指が弦に触れて止める
        st.killStep = 1 / (0.005 * fs); st.pending = 0;
      } else if (st.noteId === e.id) { // 指を置いて消音する
        st.killStep = 1 / (0.028 * fs); st.pending = 1; st.noteId = -1;
      }
    }

    process(L, R, off, n) {
      const strings = this.strings, ev = this.events;
      const cS = 0.015 * this.p.symp;
      const nM = this.nModes, mb0 = this.mb0, ma1 = this.ma1, ma2 = this.ma2;
      const my1 = this.my1, my2 = this.my2, mgL = this.mgL, mgR = this.mgR;
      const hpC = this.hpC, lpC = this.lpC, wet = this.p.reverb;
      const combL = this.combL, combR = this.combR, apL = this.apL, apR = this.apR;
      const pre = this.pre, preN = pre.length;
      const fbk = 0.84, damp = 0.3;
      let fPrev = this.fPrev;
      const running = this.running;

      for (let j = 0; j < n; j++) {
        const smp = this.pos + j;
        if (running) while (this.evIdx < ev.length && ev[this.evIdx].smp <= smp) this.handle(ev[this.evIdx++]);

        let F = 0;
        for (let s = 0; s < 6; s++) {
          const st = strings[s];
          if (st.killStep > 0) {
            st.kill -= st.killStep;
            if (st.kill <= 0) {
              st.kill = 0; st.killStep = 0;
              if (st.pending === 1) { this.configure(st, 0); this.clear(st); st.kill = 1; st.pending = 0; st.free = false; } // 右手で消音したまま
            }
          }
          const inj = st.free ? cS * (fPrev - st.fOwn) : 0;
          // 垂直偏波（ブリッジ・表板を強く駆動）
          let x = st.bufV[st.rpV];
          let ap = st.CV * x + st.axV - st.CV * st.ayV; st.axV = x; st.ayV = ap;
          let lp = st.b0V * ap - st.aV * st.lpV;
          const dV = lp - st.lpV; st.lpV = lp;
          st.bufV[st.rpV] = lp + inj + 1e-18; // デノーマル対策
          if (++st.rpV >= st.MV) st.rpV = 0;
          // 水平偏波（結合が弱く、長く残る）
          x = st.bufH[st.rpH];
          ap = st.CH * x + st.axH - st.CH * st.ayH; st.axH = x; st.ayH = ap;
          lp = st.b0H * ap - st.aH * st.lpH;
          const dH = lp - st.lpH; st.lpH = lp;
          st.bufH[st.rpH] = lp + 1e-18;
          if (++st.rpH >= st.MH) st.rpH = 0;

          const f = (dV + 0.35 * dH) * st.kill;
          st.fOwn = f; F += f;
        }
        fPrev = F;
        F += 1e-18;

        // ボディ
        let bl = 0, br = 0;
        const xd = F - this.bx2;
        for (let k = 0; k < nM; k++) {
          const y = mb0[k] * xd - ma1[k] * my1[k] - ma2[k] * my2[k];
          my2[k] = my1[k]; my1[k] = y;
          bl += mgL[k] * y; br += mgR[k] * y;
        }
        this.bx2 = this.bx1; this.bx1 = F;
        this.hpS = hpC * this.hpS + (1 - hpC) * F;
        this.lpS = lpC * this.lpS + (1 - lpC) * (F - this.hpS);
        const dl = bl * 2.2 + 0.8 * this.lpS, dr = br * 2.2 + 0.8 * this.lpS;

        // 残響
        const rin = pre[this.preI]; pre[this.preI] = (dl + dr) * 0.03;
        if (++this.preI >= preN) this.preI = 0;
        let wl = 0, wr = 0;
        for (let k = 0; k < 8; k++) {
          let c = combL[k], o = c.b[c.i];
          c.s = o * (1 - damp) + c.s * damp; c.b[c.i] = rin + c.s * fbk;
          if (++c.i >= c.b.length) c.i = 0; wl += o;
          c = combR[k]; o = c.b[c.i];
          c.s = o * (1 - damp) + c.s * damp; c.b[c.i] = rin + c.s * fbk;
          if (++c.i >= c.b.length) c.i = 0; wr += o;
        }
        for (let k = 0; k < 4; k++) {
          let a = apL[k], bo = a.b[a.i];
          a.b[a.i] = wl + bo * 0.5; wl = bo - wl; if (++a.i >= a.b.length) a.i = 0;
          a = apR[k]; bo = a.b[a.i];
          a.b[a.i] = wr + bo * 0.5; wr = bo - wr; if (++a.i >= a.b.length) a.i = 0;
        }
        L[off + j] = dl + wet * 6 * (wl * 0.85 + wr * 0.15);
        R[off + j] = dr + wet * 6 * (wr * 0.85 + wl * 0.15);
      }
      this.fPrev = fPrev;
      if (running) this.pos += n;
    }
  }

  // 同期レンダリング（Node / 短い単音用）
  function renderSync(notes, seconds, fs, params) {
    const syn = new GuitarSynth(fs, params);
    syn.schedule(notes);
    const N = Math.ceil(seconds * fs);
    const L = new Float32Array(N), R = new Float32Array(N);
    syn.process(L, R, 0, N);
    return { L, R };
  }

  // 非同期レンダリング（ブラウザ：UIを止めずに進捗表示）
  async function renderAsync(notes, seconds, fs, params, onProgress, isCancelled) {
    const syn = new GuitarSynth(fs, params);
    syn.schedule(notes);
    const N = Math.ceil(seconds * fs);
    const L = new Float32Array(N), R = new Float32Array(N);
    const chunk = Math.round(fs * 1.5);
    for (let o = 0; o < N; o += chunk) {
      syn.process(L, R, o, Math.min(chunk, N - o));
      if (onProgress) onProgress(Math.min(1, (o + chunk) / N));
      await new Promise((r) => setTimeout(r, 0));
      if (isCancelled && isCancelled()) return null;
    }
    return { L, R };
  }

  function peakOf(buf) {
    let p = 0;
    for (const ch of [buf.L, buf.R]) for (let i = 0; i < ch.length; i++) { const a = Math.abs(ch[i]); if (a > p) p = a; }
    return p;
  }
  function applyGain(buf, g) {
    for (const ch of [buf.L, buf.R]) for (let i = 0; i < ch.length; i++) ch[i] *= g;
  }

  const api = { GuitarSynth, renderSync, renderAsync, peakOf, applyGain, midiHz, TUNING, T60_F0, DEFAULTS };
  root.GuitarPhys = api;
  return api;
}
(function () {
  const api = GuitarPhysFactory(typeof self !== 'undefined' ? self : globalThis);
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
