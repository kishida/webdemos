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
  // ソプラノ用（kind: 'soprano'）の調律補正
  const TUNE_S = /*TUNES*/[[52,3.971,3.739,3.537],[54,3.975,3.666,3.521],[56,4.004,3.115,3.529],[58,4.062,3.774,3.575],[60,4.021,3.756,3.561],[62,3.995,3.722,3.539],[64,3.983,3.705,3.512],[66,3.983,3.694,3.507],[68,4.056,3.806,3.573],[70,4.414,4.011,3.756],[72,4.702,4.259,4.001],[74,4.959,4.52,4.23],[76,5.152,4.694,4.42],[78,5.218,4.785,4.525],[80,5.234,4.805,4.549],[82,5.312,4.852,4.564],[84,5.523,5.001,4.674],[86,5.933,5.303,4.948],[88,6.433,5.789,5.437],[90,6.668,6.341,6.013],[92,0,0,6.45],[94,0,0,0],[96,0,0,0]]/*ENDS*/;
  const TV = [0.2, 0.6, 1.0];
  // 楽器の種類。ソプラノはテナーの 1 オクターブ上: 管が半分の長さで、音孔列の遮断周波数・リードの共振・
  // 胴のフォルマントがそれぞれ高い。リードと管の仕組みは同じ
  const KIND = {
    tenor: {},
    soprano: { ref: 12, refLen: 19, radF: 1000, reedF: 3100, buzzF1: 3600, buzzF2: 5300, eqScale: 1.5, shortHz: 7500, os: 2, buzz: 40 },
  };
  function tuneAt(TUNE, midi, vel) {
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
      opts = Object.assign({}, KIND[(opts && opts.kind) || 'tenor'], opts || {});
      if (opts.os > 1 && !opts._inner) return new Oversampled(fs, opts);
      this.ref = opts.ref || 0; this.tune = opts.kind === 'soprano' ? TUNE_S : TUNE;
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
      this.shortC = 1 - Math.exp(-2 * PI * (opts.shortHz || 5200) / fs); this.shortG = 0.985;
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
        new Biquad().peak(fs, 520 * (opts.eqScale || 1), 1.3, 3.5), new Biquad().peak(fs, 1350 * (opts.eqScale || 1), 1.6, 3.0),
        new Biquad().peak(fs, 2900 * (opts.eqScale || 1), 2.0, 2.0), new Biquad().lowpass(fs, Math.min(9500, 6500 * (opts.eqScale || 1)), 0.6),
      ];
      this.hp = 0; this.hpx = 0; this.br = 0.5; this.brT = 0.5; this.bl1 = 0; this.bl2 = 0;
      this.calib = opts.calib !== undefined ? opts.calib : null; // 調律補正の上書き（校正時は 0）
      // ---- 嗄れた濁り ----
      //  air  : 息そのものの音（リードの隙間を抜ける乱流が、管を通らずベルと歌口から聞こえる）
      //  rasp : リードのざらつき。隙間が狭いほど流れが乱れ、リードが閉じる瞬間が周期ごとに揺れる → 倍音の周りに濁りがつく
      //  edge : 高い音を強く吹いたときの割れ。リードが叩きつけられて波形の頭がつぶれる
      //  drift: 息の圧力のゆっくりした揺らぎ
      this.airAmt = opts.air === undefined ? 0.55 : opts.air; this.raspAmt = opts.rasp === undefined ? 0.3 : opts.rasp;
      this.edgeAmt = opts.edge === undefined ? 0.6 : opts.edge; this.driftAmt = opts.drift === undefined ? 1 : opts.drift;
      this.rz1 = 0; this.rz2 = 0; this.rasp = 0; this.edge = 0; this.hi = 0; this.vel = 0.5;
      this.an1 = 0; this.an2 = 0; this.d1 = 0; this.d2 = 0; this.d1A = 2 * PI * 2.0 / fs; this.d2A = 2 * PI * 11 / fs;
      // ざらつきの帯域は 350 Hz〜2.5 kHz。これより低い揺れを入れると音がうねって蛙のような声になる
      this.rzA = 1 - Math.exp(-2 * PI * 2500 / fs); this.rzB = 1 - Math.exp(-2 * PI * 350 / fs);
      // 息の形: 1 音の中でも息は一定ではない。吹き始めに押し、伸ばすうちに少しゆるむ
      this.push = 0; this.pushK = Math.exp(-1 / (0.07 * fs)); this.ts = 0; this.shape = 1;
      this.brBase = opts.brBase || 1100;
      this.buzzAmt = opts.buzz === undefined ? 12 : opts.buzz; this.yPrev = 0;
      const reso = (f, q) => { const b = new Biquad(), w = 2 * PI * f / fs, al = Math.sin(w) / (2 * q), a0 = 1 + al; b.b0 = al / a0; b.b1 = 0; b.b2 = -al / a0; b.a1 = -2 * Math.cos(w) / a0; b.a2 = (1 - al) / a0; return b; };
      this.bq1 = reso(opts.buzzF1 || 2700, 3); this.bq2 = reso(opts.buzzF2 || 4100, 4);
      this.fsr = fs; this.reedF0 = opts.reedF || 2300; this.reedQ0 = opts.reedQ || 0.9;
      this.reedQHi = opts.reedQHi === undefined ? 0 : opts.reedQHi; this.reedFHi = opts.reedFHi === undefined ? 0 : opts.reedFHi;
      this.lay = opts.lay === undefined ? 1e9 : opts.lay; this.layK = opts.layK === undefined ? 0.15 : opts.layK; this.layHi = opts.layHi || 0;
      this.pIn = 0;
    }
    rnd() { this.seed = (this.seed * 1664525 + 1013904223) >>> 0; return this.seed / 2147483648 - 1; }

    lenFor(midi, vel) {
      const f = 440 * Math.pow(2, (midi - 69) / 12);
      return this.fs / f - (this.calib !== null ? this.calib : tuneAt(this.tune, midi, vel)) * this.fs / 48000;
    }
    betaFor(midi) { return Math.max(0.08, Math.min(this.bmax, this.b0 * Math.pow(2, (midi - 44) / 12 * this.bexp))); }

    // vel 0..1, o: { tongue: 0 スラー / 1 軽く / 2 はっきり, scoop: cent, vib: cent, vibDelay: s, growl: 0..1 }
    noteOn(midi, vel, o) {
      o = o || {};
      const tongue = this.on && this.pm > 0.05 ? (o.tongue === undefined ? 2 : o.tongue) : 2;
      this.midi = midi; this.lenT = this.lenFor(midi, vel); this.betaT = this.betaFor(midi - this.ref);
      if (!this.on || this.pm < 0.05) { this.len = this.lenT; this.beta = this.betaT; }
      this.on = true;
      this.pmT = 0.42 + 0.33 * vel;                    // 息の圧力（リードが閉じ切る圧力を 1 として）
      this.gainT = 0.22 + 0.78 * vel * vel;
      this.brT = vel; this.vel = vel;
      const mm = midi - this.ref;                      // その楽器の音域の中での高さ（テナー換算）
      this.hi = Math.max(0, (mm - 62) / 14);       // 上の音域ほど（実音 D4 より上）リードが暴れやすい
      this.rasp = 0.10 + 0.10 * vel + 0.22 * this.hi * vel + 0.08 * Math.max(0, (52 - mm) / 8);
      this.edge = this.hi * vel * vel;
      // 高い音は唇を締めて吹く: リードの共振が鋭くなり（唇のダンピングが減る）、振れ幅も面に抑えられる
      if (this.reedQHi || this.reedFHi) { const z1 = this.reed.z1, z2 = this.reed.z2; this.reed.lowpass(this.fsr, this.reedF0 + this.reedFHi * this.hi, this.reedQ0 + this.reedQHi * this.hi * (0.4 + 0.6 * vel)); this.reed.z1 = z1; this.reed.z2 = z2; }
      this.pmC = this.pmUp;
      if (tongue === 2) { this.tg = this.pm > 0.05 ? 0.12 : 0.5; this.puff = 0.5 + 0.8 * vel; this.push = 0.10 + 0.08 * vel; }
      else if (tongue === 1) { this.tg = 0.62; this.puff = 0.25; this.push = 0.06; }
      else this.push = 0.025;
      this.ts = 0;
      this.bend = -(o.scoop || 0); this.bendT = 0; this.bendC = 1 - Math.exp(-1 / (0.045 * this.fs));
      this.vibT = o.vib || 0; this.vibWait = Math.round((o.vibDelay === undefined ? 0.2 : o.vibDelay) * this.fs);
      if (tongue === 2) this.vibAmt *= 0.3;
      this.growlT = o.growl || 0;
      this.noise = 0.07 + 0.16 * (1 - vel) * (1 - vel) + 0.05 * Math.max(0, (52 - (midi - this.ref)) / 8);
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
      const wd = this.rnd(); this.d1 += (wd - this.d1) * this.d1A; this.d2 += (wd - this.d2) * this.d2A;
      this.push *= this.pushK; this.ts++;
      this.shape = (1 + this.push) * (1 - 0.07 * (1 - Math.exp(-this.ts / (0.5 * this.fs)))) * (1 + 0.0015 * this.vibAmt);
      let pm = this.pm * this.shape * (1 + this.driftAmt * (2.2 * this.d1 + 0.5 * this.d2));
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
      // ざらつき: 数百 Hz 帯の乱れが、隙間が狭いときほど強く流れを揺する
      this.rz1 += (wn - this.rz1) * this.rzA; this.rz2 += (this.rz1 - this.rz2) * this.rzB;
      const rough = (this.rz1 - this.rz2) * this.raspAmt * this.rasp * (h < 1 ? 1.6 - 0.6 * h : 1) * 3.2;
      const kk = 0.5 * emb * h * (1 + (this.noise + this.puff) * 2.2 * turb + rough);
      const d = pm - ph;
      let dl;
      if (d >= 0) { const s = 0.5 * (-kk + Math.sqrt(kk * kk + 4 * d)); dl = s * s; }
      else { const s = 0.5 * (-kk + Math.sqrt(kk * kk - 4 * d)); dl = -s * s; }
      const pin = pm - dl;
      // リードはマウスピースの面（フェイシング）に当たると、それ以上は動けない
      this.y = this.reed.tick(dl > this.lay ? this.lay + (dl - this.lay) * this.layK : dl);
      this.pIn = pin;
      t1[wi & M] = pin - a1; t2[wi & M] = pin - a2; this.wi = wi + 1;
      // リードがマウスピースの面に当たる瞬間（と離れる瞬間）の衝撃。リードの高次の振動と歌口の空洞が鳴って、
      // 2.5〜4 kHz あたりに金属的な芯が立つ。管の遮断周波数より上なので管へは戻らず、そのまま外へ出る。
      // 1 周期に 1 回ずつ起きるので、高い音ほど密になって目立つ
      const yp = this.yPrev; this.yPrev = this.y; let hit = 0;
      if (yp < 1 && this.y >= 1) hit = this.y - yp; else if (yp >= 1 && this.y < 1) hit = -0.5 * (yp - this.y);
      const bz1 = this.bq1.tick(hit), bz2 = this.bq2.tick(hit);
      const buzz = (bz1 + 0.7 * bz2 + 0.3 * hit) * this.buzzAmt * (0.35 + 0.65 * this.vel) * (0.5 + this.hi);

      // ---- 放射 ----
      // 息の音: 流れの速さ（√圧力差）に比例する乱流。弱く吹くサブトーンほど目立つ
      this.an1 += (wn - this.an1) * 0.6; this.an2 += (this.an1 - this.an2) * 0.1;
      const flow = Math.sqrt(dl > 0 ? dl : -dl);
      const air = (this.an1 - this.an2) * this.airAmt * pm * (0.05 + 0.10 * (1 - this.vel) + 0.25 * this.puff) * (0.35 + flow);
      let o = rad + air;
      // 息の強さで変わる明るさ。弱奏ではリードが叩かず波形の角が丸く、強奏では叩いて角が立つ。
      // ヘルムホルツ運動の理想化ではこの差が出ないので、口元で 2 次のローパスとして与える。
      // 明るさは息の強さについていく（押せば明るく、ゆるめば暗く）
      this.br += (this.brT * this.tg * (1 + 2.5 * (this.shape - 1)) - this.br) * 0.0012;
      const bc = Math.min(0.9, (this.brBase * Math.pow(10, this.br < 0 ? 0 : this.br > 1.1 ? 1.1 : this.br)) * 6.2832 / this.fs);
      this.bl1 += (o - this.bl1) * bc; this.bl2 += (this.bl1 - this.bl2) * bc;
      o = this.bl2 + 0.25 * this.br * (o - this.bl2);
      // 割れ: 高い音を強く吹くと波形の頭が片側だけつぶれる（偶数次も増えて、鼻にかかった荒い音になる）
      if (this.edge > 0.01) { const g = 1 + 5 * this.edgeAmt * this.edge, u = o * g; o = (u > 0 ? Math.tanh(u * 1.6) / 1.6 : Math.tanh(u * 0.7) / 0.7) / g * (1 + 0.5 * this.edgeAmt * this.edge); }
      o += buzz;
      for (let k = 0; k < this.eq.length; k++) o = this.eq[k].tick(o);
      const y = o - this.hpx + 0.997 * this.hp; this.hpx = o; this.hp = y;
      const out = y * this.gain * this.shape * this.shape * (this.shape > 1 ? this.shape : 1);   // 音量も息の形についていく
      const a = out < 0 ? -out : out; this.level = a > this.level ? a : this.level * 0.9995;
      return out;
    }
  }
  // 管が短い楽器（ソプラノ）は、1 周期が 40 サンプルを切る最高音域で、リードとフィルタの 1 サンプル単位の遅れが
  // 周期に対して大きくなり、発振が乱れる。内部を 2 倍のサンプルレートで回して、時間の刻みを細かくする
  class Oversampled {
    constructor(fs, opts) { this.os = opts.os; this.s = new Sax(fs * opts.os, Object.assign({}, opts, { _inner: true })); this.level = 0; }
    noteOn(midi, vel, o) { this.s.noteOn(midi, vel, o); }
    noteOff(fall) { this.s.noteOff(fall); }
    tick() { let a = 0; for (let k = 0; k < this.os; k++) a += this.s.tick(); this.level = this.s.level; return a / this.os; }
    get pm() { return this.s.pm; }
  }
  return Sax;
}

if (typeof module !== 'undefined' && module.exports) module.exports = { saxEngineFactory };
