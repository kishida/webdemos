/*
 * Fable Piano — physically modelled piano engine
 *
 * 弦     : 双方向デジタル導波路（速度波）。ハンマー打弦点で 2 本の遅延線に分割。
 * ハンマー: 質量 + 非線形フェルトばね  F = K·x^p  を弦と連成させて毎サンプル陰解法で解く。
 * 剛性   : 1 次オールパス縦続による分散フィルタ（インハーモニシティ）。鍵ごとに最小二乗フィット。
 * 損失   : 周波数依存の 1 極ループフィルタ（σ(f) = b1 + b3·(2πf)²）。
 * 複弦   : 1〜3 本の弦を微妙にデチューンし、抵抗性の駒で結合（二段減衰・うなり）。
 * 共鳴   : 全鍵の弦が同じ駒を共有。ダンパーの上がった弦は他の弦の振動で鳴り出す。
 * 響板   : 短い FDN（モード密度の高い共鳴体）+ ハンマーの打撃ノイズ。
 * ペダル : ダンパー解放 + 低音弦バンクの共鳴。
 *
 * この関数は自己完結しており、toString() して AudioWorklet にそのまま送り込める。
 */
function pianoEngineFactory() {
  'use strict';
  const PI = Math.PI;

  function interp(tab, x) {
    if (x <= tab[0][0]) return tab[0][1];
    for (let i = 1; i < tab.length; i++) {
      if (x <= tab[i][0]) {
        const t = (x - tab[i - 1][0]) / (tab[i][0] - tab[i - 1][0]);
        return tab[i - 1][1] + t * (tab[i][1] - tab[i - 1][1]);
      }
    }
    return tab[tab.length - 1][1];
  }
  function hash(n) { // 決定的な擬似乱数 0..1
    let x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
  }

  // ---- 鍵ごとの物理パラメータ（Chaigne & Askenfelt の実測値を補間） ----
  const T_Z = [[21, 6.0], [36, 3.7], [60, 1.6], [84, 1.7], [108, 2.0]];           // 弦の特性インピーダンス [kg/s]
  const T_MH = [[21, 0.012], [36, 0.010], [60, 0.0089], [96, 0.0066], [108, 0.006]]; // ハンマー質量 [kg]
  const T_LOGK = [[21, Math.log(1.5e8)], [36, Math.log(4e8)], [60, Math.log(4.5e9)], [96, Math.log(1e12)], [108, Math.log(4e12)]];
  const T_P = [[21, 2.2], [36, 2.3], [60, 2.5], [96, 3.0], [108, 3.0]];            // フェルトの非線形指数
  const T_BETA = [[21, 0.12], [60, 0.12], [84, 0.10], [108, 0.07]];                // 打弦位置 (弦長比)
  const T_LOGB = [[21, Math.log(2.0e-4)], [36, Math.log(8e-5)], [48, Math.log(1.2e-4)], [60, Math.log(3.5e-4)],
                  [72, Math.log(9e-4)], [84, Math.log(2.5e-3)], [96, Math.log(7e-3)], [108, Math.log(1.5e-2)]];
  const T_LOGB3 = [[21, Math.log(3e-9)], [48, Math.log(5e-9)], [60, Math.log(6.25e-9)], [96, Math.log(2.6e-10)], [108, Math.log(1.5e-10)]];
  const T_DAMP = [[21, 0.60], [60, 0.22], [89, 0.10]];                             // ダンパーの T60 [s]
  const LAST_DAMPER = 89;                                                          // これより上はダンパー無し

  // 1 次オールパス (a + z^-1)/(1 + a z^-1) の位相遅延 [samples]
  function apDelay(a, w) { return 1 - 2 * Math.atan2(a * Math.sin(w), 1 + a * Math.cos(w)) / w; }
  // 1 極ローパス 1/(1 - p z^-1) の位相遅延
  function lpDelay(p, w) { return Math.atan2(p * Math.sin(w), 1 - p * Math.cos(w)) / w; }

  class KeyVoice {
    constructor(midi, fs, eng) {
      this.midi = midi; this.fs = fs; this.eng = eng;
      const f0 = 440 * Math.pow(2, (midi - 69) / 12);
      this.f0 = f0;
      this.n = midi <= 31 ? 1 : midi <= 43 ? 2 : 3;
      this.Z = interp(T_Z, midi);
      this.mh = interp(T_MH, midi);
      this.K0 = Math.exp(interp(T_LOGK, midi)) * this.n;
      this.p = interp(T_P, midi);
      this.beta = interp(T_BETA, midi);
      this.B = Math.exp(interp(T_LOGB, midi));
      this.hasDamper = midi <= LAST_DAMPER;

      // 損失設計
      const b1 = 0.25 + 0.25 * Math.pow(2, (midi - 60) / 11);
      const b3 = Math.exp(interp(T_LOGB3, midi));
      let sigA, sigI;
      if (this.n === 1) { sigA = 0.6 * b1; sigI = b1; } else { sigA = 0.5 * b1; sigI = 1.8 * b1; }
      this.sigA = sigA; this.sigI = sigI;
      const g = Math.exp(-sigA / f0);
      const q = 2 * b3 * fs * fs / f0;
      const pl = ((2 * q + 1) - Math.sqrt(4 * q + 1)) / (2 * q);
      this.lp = pl; this.lg = g * (1 - pl);
      this.eps = (1 - Math.exp(-(sigI - sigA) / f0)) / this.n; // 駒への結合（弦 1 本あたり）

      // ダンパー（1 周あたりのゲイン）
      this.dampG = Math.pow(10, -3 / (f0 * interp(T_DAMP, midi)));
      this.killG = Math.pow(10, -3 / (f0 * 0.05));
      this.dampSamples = Math.round(fs * 2.5 * interp(T_DAMP, midi)); this.dAge = 0;

      // 分散フィルタのフィット（鍵の公称 f0 に対して）
      this.fitDispersion();

      // 弦の状態
      const n = this.n, M = this.M;
      this.maxLen = Math.ceil(fs / f0 * 1.02) + 4;
      this.dA = []; this.dB = []; this.ap = [];
      for (let j = 0; j < n; j++) {
        this.dA.push(new Float64Array(this.maxLen));
        this.dB.push(new Float64Array(this.maxLen));
        this.ap.push(new Float64Array(Math.max(1, M)));
      }
      this.LA = new Int32Array(n); this.LB = new Int32Array(n);
      this.iA = new Int32Array(n); this.iB = new Int32Array(n);
      this.tc = new Float64Array(n); this.ts = new Float64Array(n); this.ls = new Float64Array(n);
      this.xs = new Float64Array(n); this.aLs = new Float64Array(n);
      this.tune(eng.detune);

      // 演奏状態
      this.active = false; this.held = false; this.sustained = false; this.killing = false;
      this.damp = 1; this.dampT = 1;
      this.hOn = false; this.hc = 0; this.hv = 0; this.ht = 0;
      this.level = 0; this.quiet = 0; this.age = 0;

      // 出力
      const pan = Math.max(-1, Math.min(1, (midi - 64) / 60));
      const th = (pan * 0.5 + 0.5) * PI / 2;
      this.panL = Math.cos(th) * 1.414; this.panR = Math.sin(th) * 1.414;
      this.outGain = this.Z * eng.keyGain(midi); this.pL = this.outGain * this.panL; this.pR = this.outGain * this.panR;
      this.hf = null; this.hfN = 0; // ハンマー力の記録（可視化用）
    }

    fitDispersion() {
      const fs = this.fs, f0 = this.f0, B = this.B, pl = this.lp;
      const need = (n) => fs / (f0 * Math.sqrt((1 + B * n * n) / (1 + B))); // n 次倍音に必要なループ遅延
      const w = (n) => 2 * PI * n * f0 * Math.sqrt((1 + B * n * n) / (1 + B)) / fs;
      let K = 1;
      while (K < 64 && (K + 1) * f0 * Math.sqrt(1 + B * (K + 1) * (K + 1)) < Math.min(0.42 * fs, 11000)) K++;
      const minLoop = Math.max(2, Math.round(this.beta * fs / f0)) + 1 + 1.45;
      const Mmax = this.midi < 40 ? 16 : this.midi < 55 ? 12 : this.midi < 70 ? 8 : this.midi < 84 ? 4 : this.midi < 96 ? 2 : 1;
      let best = { M: 0, a: 0, err: Infinity };
      const w1 = w(1), d1 = need(1);
      const errFor = (M, a) => {
        const base = d1 - M * apDelay(a, w1) - lpDelay(pl, w1);
        if (base < minLoop) return Infinity;
        let e = 0;
        for (let n = 2; n <= K; n++) {
          const wn = w(n);
          const r = need(n) - M * apDelay(a, wn) - lpDelay(pl, wn) - base;
          const wt = 1 / (n * n);
          const rel = r / need(n); // ≒ 周波数の相対誤差
          e += wt * rel * rel;
        }
        return e;
      };
      if (K >= 2) {
        for (let M = Mmax; M >= 1; M--) {
          let ba = 0, be = Infinity;
          for (let i = 0; i <= 240; i++) {
            const a = -0.985 * i / 240;
            const e = errFor(M, a);
            if (e < be) { be = e; ba = a; }
          }
          if (be === Infinity) continue;
          // 局所的に細分
          let lo = Math.max(-0.99, ba - 0.985 / 240), hi = Math.min(0, ba + 0.985 / 240);
          for (let it = 0; it < 30; it++) {
            const m1 = lo + (hi - lo) * 0.382, m2 = lo + (hi - lo) * 0.618;
            if (errFor(M, m1) < errFor(M, m2)) hi = m2; else lo = m1;
          }
          const a = (lo + hi) / 2, e = errFor(M, a);
          if (e < best.err) best = { M, a, err: e };
          break; // 入る最大の M を採用
        }
        const e0 = errFor(0, 0);
        if (e0 < best.err) best = { M: 0, a: 0, err: e0 };
      }
      this.M = best.M; this.apA = best.a; this.fitErr = Math.sqrt(best.err / Math.max(1, K - 1)); this.K = K;
    }

    // 各弦の基音を正確に合わせる（デチューン量 [倍率] を反映）
    tune(detuneAmt) {
      const fs = this.fs, n = this.n, M = this.M, a = this.apA;
      const d = (0.5 + 0.9 * hash(this.midi)) * detuneAmt; // cent
      const cents = n === 1 ? [0] : n === 2 ? [-0.5 * d, 0.5 * d] : [-d, 0.13 * d, d * 0.9];
      for (let j = 0; j < n; j++) {
        const f = this.f0 * Math.pow(2, cents[j] / 1200);
        const w1 = 2 * PI * f / fs;
        const base = fs / f - M * apDelay(a, w1) - lpDelay(this.lp, w1);
        let Ni = Math.floor(base - 0.45);
        const frac = base - Ni; // 0.45..1.45
        this.tc[j] = Math.sin((1 - frac) * w1 / 2) / Math.sin((1 + frac) * w1 / 2);
        let LA = Math.max(1, Math.round(this.beta * fs / f));
        if (LA > Ni - 1) LA = Math.max(1, Ni - 1);
        this.LA[j] = LA; this.LB[j] = Math.max(1, Ni - LA);
        if (this.iA[j] >= this.LA[j]) this.iA[j] = 0;
        if (this.iB[j] >= this.LB[j]) this.iB[j] = 0;
      }
    }

    clear() {
      for (let j = 0; j < this.n; j++) {
        this.dA[j].fill(0); this.dB[j].fill(0); this.ap[j].fill(0);
        this.ts[j] = 0; this.ls[j] = 0; this.iA[j] = 0; this.iB[j] = 0;
      }
      this.hOn = false; this.level = 0; this.quiet = 0; this.damp = 1; this.dampT = 1; this.killing = false;
    }

    strike(vel) {
      const v0 = 0.25 * Math.exp(vel / 127 * Math.log(18)); // ハンマー速度 [m/s]
      this.hOn = true; this.hc = 0; this.hv = v0; this.ht = 0; this.v0 = v0; this.vel = vel;
      this.held = true; this.sustained = false; this.killing = false;
      this.dampT = 1; this.damp = 1;
      this.active = true; this.quiet = 0; this.age = 0;
      if (this.eng.recordHammer) { this.hf = new Float32Array(Math.ceil(this.fs * 0.012)); this.hfN = 0; }
    }

    release(pedal) {
      this.held = false;
      if (pedal) this.sustained = true; else this.setDamped();
    }
    setDamped() { this.sustained = false; if (this.hasDamper) this.dampT = this.dampG; }

    // 無音で鍵を押さえる（ダンパーだけ上げる）
    hold() {
      this.held = true; this.sustained = false; this.killing = false; this.dampT = 1;
      this.active = true; this.quiet = 0;
    }

    // --- 1 ブロックの処理は begin → (pre, post)×サンプル数 → end ---
    // 全鍵の弦は 1 つの駒を共有する。pre() が駒へ伝える速度を返し、
    // post() が全弦の合計（駒の速度 vb）を受け取って反射波を作る。
    // 反射行列 R = -I + 1·eᵀ は eps 重み付きノルムで受動的（Σeps ≤ 2）なので発散しない。
    begin() {
      const eng = this.eng, T = 1 / this.fs;
      this._K = this.K0 * eng.hardness;
      this._BK = T * (T / this.mh + 1 / (2 * this.Z * this.n)) * this._K;
      this._dT = this.killing ? this.killG : this.dampT;
      this._kn = eng.knockGain * eng.keyGain(this.midi);
      this._peak = 0;
    }
    pre() {
      const n = this.n, M = this.M, a = this.apA, lg = this.lg, lp = this.lp;
      const xs = this.xs, aLs = this.aLs, tc = this.tc, ts = this.ts, ls = this.ls, iA = this.iA, iB = this.iB;
      let sum = 0;
      for (let j = 0; j < n; j++) {
        aLs[j] = -this.dA[j][iA[j]];
        let x = this.dB[j][iB[j]];
        const ap = this.ap[j];
        for (let k = 0; k < M; k++) { const y = a * x + ap[k]; ap[k] = x - a * y; x = y; }
        const y = tc[j] * x + ts[j]; ts[j] = x - tc[j] * y;
        x = lg * y + lp * ls[j]; ls[j] = x;
        xs[j] = x; sum += x;
      }
      this._sum = sum;
      return this.eps * sum;
    }
    post(vb, i, busL, busR, knock) {
      const n = this.n, xs = this.xs, aLs = this.aLs, iA = this.iA, iB = this.iB, LA = this.LA, LB = this.LB;
      const damp = this.damp += (this._dT - this.damp) * 0.004;
      let vfree = 0;
      for (let j = 0; j < n; j++) { const aR = (vb - xs[j]) * damp; xs[j] = aR; vfree += aR + aLs[j]; }
      let fz = 0;
      if (this.hOn) {
        // 陰解法: c + B·K·c^p = A を Newton 法で解く
        const T = 1 / this.fs, p = this.p, BK = this._BK;
        const A = this.hc + T * (this.hv - vfree / n);
        let F = 0;
        if (A <= 0) { this.hc = A; }
        else {
          let c = Math.min(A, Math.pow(A / BK, 1 / p));
          for (let it = 0; it < 8; it++) {
            const cp1 = Math.pow(c, p - 1);
            const dc = (c + BK * cp1 * c - A) / (1 + BK * p * cp1);
            c -= dc;
            if (dc < 1e-13 && dc > -1e-13) break;
          }
          if (c < 0) c = 0;
          this.hc = c; F = this._K * Math.pow(c, p);
        }
        this.hv -= F * T / this.mh;
        fz = F / (2 * this.Z * n);
        knock[i] += F * this._kn;
        if (this.hf && this.hfN < this.hf.length) this.hf[this.hfN++] = F;
        this.ht++;
        if ((F === 0 && this.hv < 0 && this.ht > 8) || this.ht > this.fs * 0.06) {
          this.hOn = false;
          if (this.hf) { this.eng.lastHammer = { midi: this.midi, vel: this.vel, v0: this.v0, force: this.hf.subarray(0, this.hfN) }; this.hf = null; }
        }
      }
      for (let j = 0; j < n; j++) {
        this.dA[j][iA[j]] = xs[j] + fz; if (++iA[j] >= LA[j]) iA[j] = 0;
        this.dB[j][iB[j]] = aLs[j] + fz; if (++iB[j] >= LB[j]) iB[j] = 0;
      }
      const sum = this._sum;
      busL[i] += sum * this.pL; busR[i] += sum * this.pR;
      const as = sum < 0 ? -sum : sum; if (as > this._peak) this._peak = as;
    }
    end(cnt) {
      this.level = this._peak; this.age += cnt;
      // ダンパーが下りた弦は、自分の振動が消えたら計算をやめる（駒から揺すられ続けても鳴らないため）
      if (this._dT < 1 && !this.hOn) { this.dAge += cnt; if (this.dAge > (this.killing ? this.fs * 0.2 : this.dampSamples)) { this.active = false; this.clear(); return; } } else this.dAge = 0;
      if (!this.hOn && !this.held && this._peak < 2e-5) { if ((this.quiet += cnt) > 1024) { this.active = false; this.clear(); } } else this.quiet = 0;
    }
  }

  // ---- FDN（響板 / ホール残響 共用） ----
  class FDN {
    constructor(fs, lens, t60, hfDamp) {
      this.N = lens.length;
      this.len = lens.map(l => Math.max(8, Math.round(l * fs / 48000)));
      this.buf = this.len.map(l => new Float64Array(l));
      this.idx = new Int32Array(this.N);
      this.lp = new Float64Array(this.N);
      this.g = new Float64Array(this.N);
      this.o = new Float64Array(this.N);
      this.fs = fs; this.d = hfDamp;
      this.setT60(t60);
    }
    setT60(t60) { for (let i = 0; i < this.N; i++) this.g[i] = Math.pow(10, -3 * this.len[i] / (this.fs * t60)); }
  }

  class Piano {
    constructor(fs, opts) {
      opts = opts || {};
      this.fs = fs;
      this.hardness = 1; this.detune = 1; this.knockGain = 0.05;
      this.reverbMix = 0.22; this.sympAmt = 1; this.stringSymp = 1; this.master = 0.018; this.brightness = 0.6;
      this.bypassFx = !!opts.bypassFx; this.recordHammer = false; this.lastHammer = null;
      this.pedalDown = false; this.maxVoices = opts.maxVoices || 44;
      this.voices = [];
      for (let m = 21; m <= 108; m++) this.voices[m] = new KeyVoice(m, fs, this);
      this.activeList = [];
      const B = 128;
      this.busL = new Float64Array(B); this.busR = new Float64Array(B); this.knock = new Float64Array(B);

      // 響板
      this.sb = new FDN(fs, [149, 211, 263, 293, 347, 401, 433, 487], 0.45, 0.35);
      this.sbSL = [1, -1, 1, 1, -1, 1, -1, -1]; this.sbSR = [1, 1, -1, 1, 1, -1, -1, 1];
      this.sbIn = [1, -1, 1, -1, 1, -1, 1, -1];
      this.knLp = 0;
      // ホール
      this.rv = new FDN(fs, [1423, 1637, 1877, 2143, 2383, 2713, 3041, 3413], 2.1, 0.28);
      this.pdLen = Math.round(0.014 * fs); this.pdL = new Float64Array(this.pdLen); this.pdR = new Float64Array(this.pdLen); this.pdI = 0;
      // 共鳴弦バンク（ペダル）
      this.sy = [];
      const symNotes = [28, 29, 31, 33, 34, 36, 38, 40, 41, 43, 45, 46, 48, 50];
      for (const m of symNotes) {
        const f = 440 * Math.pow(2, (m - 69) / 12);
        const L = Math.round(fs / f - 0.5);
        this.sy.push({ buf: new Float64Array(L), L, i: 0, z: 0, gOpen: Math.pow(10, -3 / (f * 5)), gShut: Math.pow(10, -3 / (f * 0.25)) });
      }
      this.pedalAmt = 0;
      this.hpL = [0, 0]; this.hpR = [0, 0];
      this.peakOut = 0;
      this.shC = 1 - Math.exp(-2 * PI * 2500 / fs); this.shL = 0; this.shR = 0;
    }

    // 鍵盤全体の音量バランス（解析で求めた補正）
    keyGain(m) { return interp([[21, 1.2], [31, 1.2], [33, 0.85], [45, 0.8], [60, 1.0], [72, 1.2], [84, 1.5], [96, 1.9], [108, 2.3]], m); }

    setParam(name, v) {
      if (name === 'detune') { this.detune = v; for (let m = 21; m <= 108; m++) this.voices[m].tune(v); }
      else if (name === 'reverbT60') this.rv.setT60(v);
      else this[name] = v;
    }

    noteOn(midi, vel) {
      if (midi < 21 || midi > 108) return;
      const v = this.voices[midi];
      if (!v.active) {
        this.activeList.push(v);
        if (this.activeList.length > this.maxVoices) this.steal();
      }
      v.strike(Math.max(1, Math.min(127, vel)));
    }
    // 音を出さずに鍵を押さえる
    hold(midi) {
      if (midi < 21 || midi > 108) return;
      const v = this.voices[midi];
      if (!v.active) this.activeList.push(v);
      v.hold();
    }
    noteOff(midi) {
      if (midi < 21 || midi > 108) return;
      const v = this.voices[midi];
      if (v.held) v.release(this.pedalDown);
    }
    pedal(down) {
      this.pedalDown = down;
      if (!down) for (const v of this.activeList) if (v.sustained) v.setDamped();
    }
    steal() {
      let best = null, bl = Infinity;
      for (const v of this.activeList) {
        if (v.held || v.hOn || v.killing) continue;
        if (v.level < bl) { bl = v.level; best = v; }
      }
      if (best) best.killing = true;
    }
    allOff(hard) {
      for (const v of this.activeList) { v.held = false; v.sustained = false; v.killing = true; if (hard) { v.active = false; v.clear(); } }
      if (hard) this.activeList.length = 0;
      this.pedalDown = false;
    }
    get voiceCount() { return this.activeList.length; }

    // outL/outR: Float32Array, [off, off+cnt) を埋める。cnt <= 128
    process(outL, outR, off, cnt) {
      const busL = this.busL, busR = this.busR, knock = this.knock;
      for (let i = 0; i < cnt; i++) { busL[i] = 0; busR[i] = 0; knock[i] = 0; }
      const al = this.activeList;
      const nv = al.length;
      for (let k = 0; k < nv; k++) al[k].begin();
      for (let i = 0; i < cnt; i++) {
        if (this.stringSymp) {
          let vb = 0; // 駒の速度 = 全弦からの寄与の和
          for (let k = 0; k < nv; k++) vb += al[k].pre();
          for (let k = 0; k < nv; k++) al[k].post(vb, i, busL, busR, knock);
        } else { // 鍵どうしの共鳴なし: 駒を鍵ごとに分ける（同じ鍵の 1〜3 本だけが連成）
          for (let k = 0; k < nv; k++) { const v = al[k]; v.post(v.pre(), i, busL, busR, knock); }
        }
      }
      for (let k = 0; k < nv; k++) al[k].end(cnt);
      for (let k = al.length - 1; k >= 0; k--) if (!al[k].active) { al[k] = al[al.length - 1]; al.pop(); }

      const master = this.master;
      if (this.bypassFx) {
        for (let i = 0; i < cnt; i++) { outL[off + i] = busL[i] * master; outR[off + i] = busR[i] * master; }
        return;
      }
      const sb = this.sb, rv = this.rv, sy = this.sy;
      const sbN = sb.N, rvN = rv.N, sbSL = this.sbSL, sbSR = this.sbSR, sbIn = this.sbIn;
      const pedT = this.pedalDown ? 1 : 0, sympAmt = this.sympAmt * 0.012;
      const rmix = this.reverbMix;
      let pedalAmt = this.pedalAmt, knLp = this.knLp, pk = this.peakOut;
      for (let i = 0; i < cnt; i++) {
        const dL = busL[i], dR = busR[i], mono = (dL + dR) * 0.5;
        // 共鳴弦
        pedalAmt += (pedT - pedalAmt) * 0.0006;
        let syOut = 0;
        if (pedalAmt > 1e-4 || this.syAlive) {
          const inp = mono * pedalAmt;
          let en = 0;
          for (let k = 0; k < sy.length; k++) {
            const s = sy[k];
            const o = s.buf[s.i];
            const f = (o + s.z) * 0.5; s.z = o;
            const g = s.gShut + (s.gOpen - s.gShut) * pedalAmt;
            s.buf[s.i] = inp + f * g + 1e-24;
            if (++s.i >= s.L) s.i = 0;
            syOut += (k & 1) ? -o : o;
            en += o < 0 ? -o : o;
          }
          this.syAlive = en > 1e-7;
          syOut *= sympAmt;
        }
        // 響板
        knLp += (knock[i] - knLp) * 0.25;
        const sIn = (mono + knLp + syOut) * 0.5;
        let sum = 0, wL = 0, wR = 0;
        for (let k = 0; k < sbN; k++) {
          const o = sb.buf[k][sb.idx[k]];
          const l = sb.lp[k] = o + (sb.lp[k] - o) * sb.d;
          const v = l * sb.g[k];
          sb.o[k] = v; sum += v;
          wL += o * sbSL[k]; wR += o * sbSR[k];
        }
        sum *= 2 / sbN;
        for (let k = 0; k < sbN; k++) {
          sb.buf[k][sb.idx[k]] = sb.o[k] - sum + sIn * sbIn[k] + 1e-24;
          if (++sb.idx[k] >= sb.len[k]) sb.idx[k] = 0;
        }
        let L = dL * 0.55 + syOut * 0.5 + wL * 0.42;
        let R = dR * 0.55 + syOut * 0.5 + wR * 0.42;
        // ホール残響
        const pi = this.pdI;
        const rL = this.pdL[pi], rR = this.pdR[pi];
        this.pdL[pi] = L; this.pdR[pi] = R; this.pdI = pi + 1 >= this.pdLen ? 0 : pi + 1;
        sum = 0; let vL = 0, vR = 0;
        for (let k = 0; k < rvN; k++) {
          const o = rv.buf[k][rv.idx[k]];
          const l = rv.lp[k] = o + (rv.lp[k] - o) * rv.d;
          const v = l * rv.g[k];
          rv.o[k] = v; sum += v;
          if (k & 1) vR += (k & 2) ? -o : o; else vL += (k & 2) ? -o : o;
        }
        sum *= 2 / rvN;
        for (let k = 0; k < rvN; k++) {
          rv.buf[k][rv.idx[k]] = rv.o[k] - sum + ((k & 1) ? rR : rL) * 0.5 + 1e-24;
          if (++rv.idx[k] >= rv.len[k]) rv.idx[k] = 0;
        }
        L = (L + vL * rmix) * master; R = (R + vR * rmix) * master;
        // 高域シェルフ（明るさ）
        this.shL += (L - this.shL) * this.shC; L += this.brightness * (L - this.shL);
        this.shR += (R - this.shR) * this.shC; R += this.brightness * (R - this.shR);
        // DC カット
        let y = L - this.hpL[0] + 0.9975 * this.hpL[1]; this.hpL[0] = L; this.hpL[1] = y; L = y;
        y = R - this.hpR[0] + 0.9975 * this.hpR[1]; this.hpR[0] = R; this.hpR[1] = y; R = y;
        // ソフトリミッタ
        const aL = L < 0 ? -L : L, aR = R < 0 ? -R : R;
        if (aL > 0.7) L = (L < 0 ? -1 : 1) * (0.7 + 0.3 * Math.tanh((aL - 0.7) / 0.3));
        if (aR > 0.7) R = (R < 0 ? -1 : 1) * (0.7 + 0.3 * Math.tanh((aR - 0.7) / 0.3));
        if (aL > pk) pk = aL; if (aR > pk) pk = aR;
        outL[off + i] = L; outR[off + i] = R;
      }
      this.pedalAmt = pedalAmt; this.knLp = knLp; this.peakOut = pk;
    }
  }

  return Piano;
}

if (typeof module !== 'undefined' && module.exports) module.exports = { pianoEngineFactory };
