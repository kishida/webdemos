/*
 * Fable Tenor — テナーサックスの物理モデル音源
 *
 * 管   : 円錐管を「長短 2 本の円筒を歌口で並列につないだもの」で置き換える
 *        （cylindrical saxophone 近似。先端を切った円錐の入力アドミタンスは
 *          長さ L の開管 + 欠けた頂点ぶんの長さ x1 の短い開管 の和にほぼ等しい）。
 *        2 本ともデジタル導波路（圧力波）で、歌口の 3 ポート接合で散乱させる。
 * リード: 息の圧力 γ と歌口内圧 p の差 Δ = γ − p でリードが閉じていく圧力制御弁。
 *        流量 u = ζ·h·sign(Δ)·√|Δ|（ベルヌーイ）、開口 h = 1 − y、
 *        y はリードの共振（質量・ばね・唇のダンピング）を通した Δ。
 *        接合の式 p = (a1 + a2) + (ζh/2)·sign(Δ)√|Δ| は √|Δ| の 2 次式なので毎サンプル厳密に解ける。
 *        h が 0 に張り付く「リードの叩き（beating）」が強奏の明るさを作る。
 * 開端  : 音孔列のカットオフより上は反射せず外へ抜ける。反射 = ローパス、放射 = その残り。
 * 息    : 流量に比例する乱流ノイズ（サブトーンの息の音）。
 * 奏法  : タンギング（強 / 弱 / スラー）、ビブラート、しゃくり（scoop）、フォール、グロウル。
 *
 * 自己完結した factory。toString() して AudioWorklet に送り込める。
 */
function saxEngineFactory() {
  'use strict';
  const PI = Math.PI, N = 4096, M = N - 1;

  // 調律補正 [samples]（tools/sax-test.js tune で実測して求めた、ループ内フィルタとリードによる遅れ）
  const TUNE = /*TUNE*/[[40,5.696,5.151,4.843],[42,5.688,5.271,4.978],[44,5.579,5.197,4.916],[46,4.055,5.189,3.922],[48,5.586,5.183,3.879],[50,5.544,5.184,4.885],[52,5.57,5.166,4.875],[54,5.587,5.131,4.883],[56,5.57,5.107,4.837],[58,5.628,5.202,4.893],[60,5.964,5.387,5.057],[62,6.337,5.699,5.334],[64,6.628,6.011,5.623],[66,6.987,6.278,5.887],[68,7.161,6.511,6.117],[70,7.291,6.667,6.282],[72,7.336,6.727,6.318],[74,7.42,6.795,6.387],[76,7.64,6.94,6.496],[78,8.091,7.282,6.813],[80,8.666,7.792,7.317],[82,9.331,8.374,7.903],[84,9.437,8.926,8.41]]/*END*/;   // [midi, vel 0.2, 0.6, 1.0]
  const TV = [0.2, 0.6, 1.0];
  function tuneAt(midi, vel) {
    const v = Math.max(TV[0], Math.min(TV[2], vel)), j = v < TV[1] ? 1 : 2, tv = (v - TV[j - 1]) / (TV[j] - TV[j - 1]);
    const row = r => r[j] + tv * (r[j + 1] - r[j]);
    if (midi <= TUNE[0][0]) return row(TUNE[0]);
    for (let i = 1; i < TUNE.length; i++) if (midi <= TUNE[i][0]) { const t = (midi - TUNE[i - 1][0]) / (TUNE[i][0] - TUNE[i - 1][0]); return row(TUNE[i - 1]) * (1 - t) + row(TUNE[i]) * t; }
    return row(TUNE[TUNE.length - 1]);
  }

  class Biquad {
    constructor() { this.b0 = 1; this.b1 = 0; this.b2 = 0; this.a1 = 0; this.a2 = 0; this.z1 = 0; this.z2 = 0; }
    lowpass(fs, f, q) { const w = 2 * PI * f / fs, al = Math.sin(w) / (2 * q), c = Math.cos(w), a0 = 1 + al; this.b0 = (1 - c) / 2 / a0; this.b1 = (1 - c) / a0; this.b2 = this.b0; this.a1 = -2 * c / a0; this.a2 = (1 - al) / a0; return this; }
    peak(fs, f, q, dB) { const A = Math.pow(10, dB / 40), w = 2 * PI * f / fs, al = Math.sin(w) / (2 * q), c = Math.cos(w), a0 = 1 + al / A; this.b0 = (1 + al * A) / a0; this.b1 = -2 * c / a0; this.b2 = (1 - al * A) / a0; this.a1 = -2 * c / a0; this.a2 = (1 - al / A) / a0; return this; }
    tick(x) { const y = this.b0 * x + this.z1; this.z1 = this.b1 * x - this.a1 * y + this.z2; this.z2 = this.b2 * x - this.a2 * y; return y; }
  }

  class Sax {
    constructor(fs, opts) {
      opts = opts || {};
      this.fs = fs;
      this.t1 = new Float64Array(N); this.t2 = new Float64Array(N); this.wi = 0;
      // 管
      // 開端の反射関数: 直線位相のなめらかなパルス（Hann 窓）。位相がまっすぐなので管の共鳴が倍音列からずれず、
      // 基音の発振を全部の共鳴が支える。カットオフ（音孔列の遮断周波数）より上は反射せず放射される。
      const RL = (Math.round((opts.refLen || 33) * fs / 48000) | 1); this.RL = RL; this.RH = (RL - 1) / 2;
      this.fir = new Float64Array(this.RH + 1); let fsum = 0;
      for (let k = 0; k < RL; k++) { const w = 0.5 - 0.5 * Math.cos(2 * PI * (k + 1) / (RL + 1)); fsum += w; if (k <= this.RH) this.fir[k] = w; }
      for (let k = 0; k <= this.RH; k++) this.fir[k] /= fsum;
      this.f1 = new Float64Array(N);
      this.refG = opts.refG || 0.985;                  // 壁面損失を含む反射率
      this.r2 = 0; this.radLp = 0; this.radC = 1 - Math.exp(-2 * PI * (opts.radF || 650) / fs);
      this.b0 = opts.b0 || 0.262; this.bexp = opts.bexp === undefined ? 0.08 : opts.bexp; this.bmax = opts.bmax || 0.3;
      this.shortC = 1 - Math.exp(-2 * PI * 5200 / fs); this.shortG = 0.985;
      // リード
      this.zeta = opts.zeta || 1.4;
      this.reed = new Biquad().lowpass(fs, opts.reedF || 2300, opts.reedQ || 0.9);
      this.y = 0;
      // 状態
      this.pm = 0; this.pmT = 0; this.pmUp = 1 - Math.exp(-1 / (0.009 * fs)); this.pmDn = 1 - Math.exp(-1 / (0.022 * fs)); this.pmC = this.pmUp;
      this.tg = 1; this.tgC = 1 - Math.exp(-1 / (0.007 * fs));
      this.len = fs / 220; this.lenT = this.len; this.lenC = 1 - Math.exp(-1 / (0.0025 * fs));
      this.beta = 0.2; this.betaT = 0.2;
      this.bend = 0; this.bendT = 0; this.bendC = 1 - Math.exp(-1 / (0.045 * fs));
      this.vibPhase = 0; this.vibInc = 2 * PI * 5.1 / fs; this.vibAmt = 0; this.vibT = 0; this.vibWait = 0; this.vibC = 1 - Math.exp(-1 / (0.18 * fs));
      this.growl = 0; this.growlT = 0; this.grPhase = 0;
      this.nz = 0; this.nz2 = 0; this.noise = 0.1; this.puff = 0; this.puffC = Math.exp(-1 / (0.012 * fs));
      this.gain = 0; this.gainT = 0;
      this.midi = 0; this.on = false; this.level = 0; this.seed = 22222;
      // 放射後の音色（ベルと胴のフォルマント、口元の高域の減衰）
      this.eq = opts.noEq ? [] : [
        new Biquad().peak(fs, 520, 1.3, 3.5), new Biquad().peak(fs, 1350, 1.6, 3.0),
        new Biquad().peak(fs, 2900, 2.0, 2.0), new Biquad().lowpass(fs, 6500, 0.6),
      ];
      this.hp = 0; this.hpx = 0; this.br = 0.5; this.brT = 0.5; this.bl1 = 0; this.bl2 = 0;
      this.calib = opts.calib !== undefined ? opts.calib : null; // 調律補正の上書き（校正時は 0）
      this.pIn = 0;
    }
    rnd() { this.seed = (this.seed * 1664525 + 1013904223) >>> 0; return this.seed / 2147483648 - 1; }

    lenFor(midi, vel) {
      const f = 440 * Math.pow(2, (midi - 69) / 12);
      return this.fs / f - (this.calib !== null ? this.calib : tuneAt(midi, vel) * this.fs / 48000);
    }
    betaFor(midi) { return Math.max(0.08, Math.min(this.bmax, this.b0 * Math.pow(2, (midi - 44) / 12 * this.bexp))); }

    // vel 0..1, o: { tongue: 0 スラー / 1 軽く / 2 はっきり, scoop: cent, vib: cent, vibDelay: s, growl: 0..1 }
    noteOn(midi, vel, o) {
      o = o || {};
      const tongue = this.on && this.pm > 0.05 ? (o.tongue === undefined ? 2 : o.tongue) : 2;
      this.midi = midi; this.lenT = this.lenFor(midi, vel); this.betaT = this.betaFor(midi);
      if (!this.on || this.pm < 0.05) { this.len = this.lenT; this.beta = this.betaT; }
      this.on = true;
      this.pmT = 0.42 + 0.33 * vel;                    // 息の圧力（リードが閉じ切る圧力を 1 として）
      this.gainT = 0.22 + 0.78 * vel * vel;
      this.brT = vel;
      this.pmC = this.pmUp;
      if (tongue === 2) { this.tg = this.pm > 0.05 ? 0.12 : 0.5; this.puff = 0.5 + 0.8 * vel; }
      else if (tongue === 1) { this.tg = 0.62; this.puff = 0.25; }
      this.bend = -(o.scoop || 0); this.bendT = 0; this.bendC = 1 - Math.exp(-1 / (0.045 * this.fs));
      this.vibT = o.vib || 0; this.vibWait = Math.round((o.vibDelay === undefined ? 0.2 : o.vibDelay) * this.fs);
      if (tongue === 2) this.vibAmt *= 0.3;
      this.growlT = o.growl || 0;
      this.noise = 0.07 + 0.16 * (1 - vel) * (1 - vel) + 0.05 * Math.max(0, (52 - midi) / 8);
    }
    // fall: 音の切り際にピッチを落とす
    noteOff(fall) {
      this.on = false; this.pmT = 0; this.vibT = 0; this.gainT *= 0.6;
      if (fall) { this.bendT = -500; this.bendC = 1 - Math.exp(-1 / (0.16 * this.fs)); this.pmC = 1 - Math.exp(-1 / (0.07 * this.fs)); }
      else this.pmC = this.pmDn;
    }

    tick() {
      // ---- 奏者 ----
      this.tg += (1 - this.tg) * this.tgC;
      this.pm += (this.pmT * this.tg - this.pm) * this.pmC;
      this.gain += (this.gainT - this.gain) * 0.0008;
      this.len += (this.lenT - this.len) * this.lenC;
      this.beta += (this.betaT - this.beta) * this.lenC;
      this.bend += (this.bendT - this.bend) * this.bendC;
      if (this.vibWait > 0) this.vibWait--; else this.vibAmt += (this.vibT - this.vibAmt) * this.vibC;
      if (this.vibT === 0) this.vibAmt += (0 - this.vibAmt) * this.vibC;
      this.vibPhase += this.vibInc; if (this.vibPhase > 2 * PI) this.vibPhase -= 2 * PI;
      const vs = Math.sin(this.vibPhase);
      this.growl += (this.growlT - this.growl) * 0.001;
      let pm = this.pm;
      if (this.growl > 0.001) { this.grPhase += 2 * PI * 73 / this.fs; pm *= 1 + 0.32 * this.growl * Math.sin(this.grPhase + 1.3 * Math.sin(this.grPhase * 0.37)); }
      const cents = this.bend + this.vibAmt * vs;
      const total = this.len * (1 - cents * 0.00057762);   // 2^(-c/1200) ≒ 1 − c·ln2/1200
      const d2 = Math.max(2, total * this.beta), d1 = Math.max(1, total - d2 - this.RH);

      // ---- 管から戻ってくる波 ----
      const wi = this.wi, t1 = this.t1, t2 = this.t2, f1 = this.f1, fir = this.fir, RH = this.RH;
      // 直前までに管へ送り出した波に反射関数を畳み込む（中心は RH サンプル前）
      const c0 = wi - 1 - RH; let acc = fir[RH] * t1[c0 & M];
      for (let k = 0; k < RH; k++) acc += fir[k] * (t1[(c0 - RH + k) & M] + t1[(c0 + RH - k) & M]);
      f1[(wi - 1) & M] = acc;
      // 放射: 開いた音孔からの放射は流量の時間微分に比例（低域は 6 dB/oct で弱く、カットオフより上は素通し）
      const xr = t1[c0 & M]; this.radLp += (xr - this.radLp) * this.radC; const rad = xr - this.radLp;
      let p = wi - d1, i0 = Math.floor(p), fr = p - i0;
      const x1 = f1[i0 & M] * (1 - fr) + f1[(i0 + 1) & M] * fr;
      p = wi - d2; i0 = Math.floor(p); fr = p - i0;
      const x2 = t2[i0 & M] * (1 - fr) + t2[(i0 + 1) & M] * fr;
      const a1 = -this.refG * x1;                      // 開端: 低域だけが位相反転して戻る
      this.r2 += (x2 - this.r2) * this.shortC;
      const a2 = -this.shortG * this.r2;
      const ph = a1 + a2;

      // ---- リード ----
      let h = 1 - this.y; if (h < 0) h = 0;
      const wn = this.rnd();
      this.nz += (wn - this.nz) * 0.35; this.nz2 += (this.nz - this.nz2) * 0.02;
      const turb = this.nz - this.nz2;                 // 帯域制限した乱流
      this.puff *= this.puffC;
      const emb = this.zeta * (1 + 0.6 * this.brT) * (1 - 0.0016 * this.vibAmt * vs);   // 強く吹くほど唇も締める
      const kk = 0.5 * emb * h * (1 + (this.noise + this.puff) * 2.2 * turb);
      const d = pm - ph;
      let dl;
      if (d >= 0) { const s = 0.5 * (-kk + Math.sqrt(kk * kk + 4 * d)); dl = s * s; }
      else { const s = 0.5 * (-kk + Math.sqrt(kk * kk - 4 * d)); dl = -s * s; }
      const pin = pm - dl;
      this.y = this.reed.tick(dl);
      this.pIn = pin;
      t1[wi & M] = pin - a1; t2[wi & M] = pin - a2; this.wi = wi + 1;

      // ---- 放射 ----
      let o = rad + 0.02 * (pin - ph) * turb;          // 歌口から直接漏れる息
      // 息の強さで変わる明るさ。弱奏ではリードが叩かず波形の角が丸く、強奏では叩いて角が立つ。
      // ヘルムホルツ運動の理想化ではこの差が出ないので、口元で 2 次のローパスとして与える。
      this.br += (this.brT * this.tg - this.br) * 0.0012;
      const bc = Math.min(0.9, (800 * Math.pow(10, this.br < 0 ? 0 : this.br)) * 6.2832 / this.fs);
      this.bl1 += (o - this.bl1) * bc; this.bl2 += (this.bl1 - this.bl2) * bc;
      o = this.bl2 + 0.25 * this.br * (o - this.bl2);
      for (let k = 0; k < this.eq.length; k++) o = this.eq[k].tick(o);
      const y = o - this.hpx + 0.997 * this.hp; this.hpx = o; this.hp = y;
      const out = y * this.gain;
      const a = out < 0 ? -out : out; this.level = a > this.level ? a : this.level * 0.9995;
      return out;
    }
  }
  return Sax;
}

if (typeof module !== 'undefined' && module.exports) module.exports = { saxEngineFactory };
