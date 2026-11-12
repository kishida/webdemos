/*
 * Fable Voice — 人の歌声の物理モデル
 *
 * 肺     : 声門下圧 Ps [Pa]。これが唯一のエネルギー源。
 * 声帯   : 二質量モデル（Steinecke & Herzel 1995）。上下 2 つの質量がばねで結ばれ、
 *          ベルヌーイ流の圧力と衝突力で自励振動する。波形はどこにも書かれていない。
 *          張力係数 Q（質量 /Q, ばね ×Q）で音高が決まる。狙った音高との差を 1 周期ごとに測って
 *          Q を直す（人が耳で聞いて音程を合わせるのと同じ仕組み）。
 * 声門流 : 声門上下の圧力差と声道入口の特性インピーダンスから毎サンプル 2 次方程式を解く。
 *          声道の圧力が声帯を押し返す（音源と声道の相互作用）。
 * 声道   : 断面積関数 A(x) をもつ管を Kelly–Lochbaum 型の導波路で解く（圧力波）。
 *          舌・唇の動きは断面積の時間変化。子音は「どこを・どれだけ狭めるか」だけで指定する。
 * 鼻腔   : 軟口蓋の開きで声道に 3 分岐接続される固定管。
 * 乱流   : 狭めを通る流速からレイノルズ数を求め、臨界を超えた分だけ雑音源を置く（s, sh, h, 破裂）。
 * 放射   : 唇・鼻孔の体積流の時間微分が音圧になる。
 *
 * 2 倍オーバーサンプリング（fs×2）で計算。関数は自己完結で、toString() して AudioWorklet に送れる。
 */
function voiceEngineFactory() {
  'use strict';
  const PI = Math.PI, RHO = 1.14, C = 350, NU = 1.5e-5;

  // 母音の断面積 [cm²]。声門(0) → 唇(1) を等間隔 16 点。tools/fit-vowels.js でフォルマントに合わせて求めた。
  /*VOWELS-BEGIN*/
  const VOWELS = {
    a: [
      { f1: 900, pts: [0.45, 0.5, 0.474, 0.404, 0.382, 0.497, 0.738, 1.109, 1.755, 2.923, 4.613, 6.609, 6.865, 5.247, 3.195, 2.235] },
    ],
    i: [
      { f1: 330, pts: [0.45, 0.6, 1.136, 2.151, 3.35, 3.94, 3.173, 1.794, 0.893, 0.457, 0.287, 0.261, 0.354, 0.687, 0.907, 1.06] },
      { f1: 429, pts: [0.45, 0.6, 0.958, 1.94, 3.127, 3.716, 2.938, 1.694, 1.024, 0.603, 0.458, 0.51, 0.623, 1.146, 1.814, 2.623] },
      { f1: 539, pts: [0.45, 0.6, 0.903, 1.508, 1.889, 2.294, 2.204, 1.457, 1.017, 0.66, 0.554, 0.673, 0.837, 1.518, 2.794, 5.307] },
      { f1: 658, pts: [0.45, 0.6, 0.813, 1.24, 1.587, 1.781, 1.663, 1.349, 1.1, 0.911, 0.839, 0.999, 1.323, 2.421, 4.468, 7] },
    ],
    u: [
      { f1: 402, pts: [0.45, 0.6, 0.792, 1.056, 1.61, 2.906, 3.145, 1.594, 0.549, 0.389, 0.687, 1.426, 1.673, 0.839, 0.305, 0.2] },
      { f1: 521, pts: [0.45, 0.6, 0.724, 0.884, 0.994, 1.382, 1.385, 1.023, 0.631, 0.651, 1.01, 1.756, 1.826, 1.012, 0.4, 0.261] },
      { f1: 659, pts: [0.45, 0.6, 0.637, 0.693, 0.676, 0.793, 0.854, 0.85, 0.823, 0.966, 1.272, 1.735, 1.893, 1.482, 0.833, 0.511] },
    ],
    e: [
      { f1: 560, pts: [0.45, 0.6, 0.975, 1.677, 2.398, 2.98, 2.926, 2.238, 1.475, 1.001, 0.878, 1.041, 1.453, 2.009, 2.432, 2.649] },
      { f1: 669, pts: [0.45, 0.6, 0.844, 1.317, 1.883, 2.304, 2.305, 1.891, 1.566, 1.284, 1.245, 1.456, 1.928, 2.638, 3.799, 4.398] },
    ],
    o: [
      { f1: 560, pts: [0.45, 0.5, 0.928, 0.757, 0.277, 0.2, 0.228, 0.772, 1.993, 2.625, 2.747, 4.331, 7, 4.109, 0.696, 0.261] },
      { f1: 670, pts: [0.45, 0.5, 0.495, 0.318, 0.201, 0.2, 0.259, 0.555, 0.952, 1.36, 2.209, 3.985, 5.699, 3.312, 0.825, 0.343] },
    ],
    x: [
      { f1: 620, pts: [0.45, 0.55, 0.762, 1.037, 1.263, 1.559, 1.798, 1.988, 2.016, 2.177, 2.421, 2.559, 2.341, 1.638, 1.101, 0.812] },
    ],
  };
  /*VOWELS-END*/
  // 鼻腔の断面積 [cm²]（軟口蓋 → 鼻孔）
  const NOSE = [0.6, 1.4, 2.6, 3.6, 4.2, 4.0, 3.2, 2.2, 1.4, 0.9, 0.6];
  // 調音位置（声門からの距離の割合）
  const PLACES = { lab: 1.0, alv: 0.87, pal: 0.79, vel: 0.62 };
  const PLACE_NAMES = ['lab', 'alv', 'pal', 'vel'];
  const PARAMS = ['pitch', 'ps', 'abd', 'velum', 'vib', 'breath', 'gLab', 'gAlv', 'gPal', 'gVel', 'cLab', 'cAlv', 'cPal', 'cVel'];
  const PI_ = {}; PARAMS.forEach((n, i) => PI_[n] = i);

  // 声の種類: 体の寸法だけが違う（声道の長さ、声帯の長さ・質量）。式は同じ。
  const foldScale = (s) => ({ m1: 0.125e-3 * s * s * s, m2: 0.025e-3 * s * s * s, k1: 80 * s, k2: 8 * s, kc: 25 * s, r1: 0.02 * s * s, r2: 0.02 * s * s,
    d1: 0.25e-2 * s, d2: 0.05e-2 * s, lg: 1.4e-2 * s, fBase: 135 / s, aScale: s * s });
  const TYPES = {
    male: { tractLength: 0.150 },
    // 女声: 声帯を相似形のまま 0.72 倍（質量 ∝ s³, ばね ∝ s, 力 ∝ s² → 振動数 ∝ 1/s）、声道は 13 cm
    female: { tractLength: 0.130, fold: foldScale(0.72), gain: 0.17 },
  };

  function sampleShape(pts, N, out) { // 制御点 → 区間ごとの log 面積 [m²]
    const n = pts.length;
    for (let i = 0; i < N; i++) {
      const x = (i + 0.5) / N * (n - 1), j = Math.min(n - 2, Math.floor(x)), t = x - j;
      out[i] = Math.log(pts[j] * 1e-4) * (1 - t) + Math.log(pts[j + 1] * 1e-4) * t;
    }
    return out;
  }

  class Voice {
    constructor(fs, opts) {
      opts = Object.assign({}, TYPES[opts && opts.type] || {}, opts || {});
      this.type = opts.type || 'male';
      this.fs = fs; const fs2 = this.fs2 = fs * 2; this.dt = 1 / fs2;
      this.STEPS = 32;                     // 制御周期（fs2 のサンプル数）
      this.tick = this.STEPS / fs2;
      const len = this.tractLength = opts.tractLength || 0.150;
      const N = this.N = Math.round(len * fs2 / C);
      this.A = new Float64Array(N); this.R = new Float64Array(N); this.L = new Float64Array(N);
      this.jR = new Float64Array(N + 1); this.jL = new Float64Array(N + 1);
      this.k = new Float64Array(N); this.kT = new Float64Array(N); this.dk = new Float64Array(N);
      this.vA0 = new Float64Array(N); this.vA1 = new Float64Array(N); this.vCur = new Float64Array(N);
      this.shapes = {}; for (const v in VOWELS) this.shapes[v] = VOWELS[v].map(o => ({ f1: o.f1 * 0.150 / len, s: sampleShape(o.pts, N, new Float64Array(N)) }));
      this.f1Margin = opts.f1Margin || 1.3; this.freeze = false;
      this.vCur.set(this.shapes.x[0].s); this.vA0.set(this.vCur); this.vA1.set(this.vCur); this.vT = 1; this.vD = 1; this.vowel = 'x';
      this.fade = opts.fade || 0.9988;
      // 狭めの形（調音位置ごとの重み）
      const hw = 0.009 * fs2 / C;
      this.bump = PLACE_NAMES.map(pl => {
        const b = new Float64Array(N), ci = PLACES[pl] * N;
        if (pl === 'lab') { b[N - 1] = 1; b[N - 2] = 0.7; b[N - 3] = 0.2; return b; }
        let mx = 0;
        for (let i = 0; i < N; i++) { const d = (i + 0.5 - ci) / hw; if (d > -1 && d < 1) { b[i] = 0.5 * (1 + Math.cos(PI * d)); if (b[i] > mx) mx = b[i]; } }
        for (let i = 0; i < N; i++) b[i] /= mx;
        return b;
      });
      // 鼻腔
      const M = this.M = Math.round(0.11 * len / 0.150 * fs2 / C);
      this.nA = new Float64Array(M); this.nR = new Float64Array(M); this.nL = new Float64Array(M);
      this.njR = new Float64Array(M + 1); this.njL = new Float64Array(M + 1); this.nk = new Float64Array(M);
      const nl = sampleShape(NOSE, M, new Float64Array(M));
      for (let i = 0; i < M; i++) this.nA[i] = Math.exp(nl[i]);
      for (let i = 1; i < M; i++) this.nk[i] = (this.nA[i - 1] - this.nA[i]) / (this.nA[i - 1] + this.nA[i]);
      this.nFade = 0.997;
      this.J = Math.round(0.53 * N); this.tl = 1; this.tr = 1; this.tn = 0;
      this.lipLp = 0; this.noseLp = 0; this.lipA = 0.5; this.lipG = 0.995; this.Uprev = 0;
      const an = Math.sqrt(this.nA[M - 1] / PI); this.noseAl = 1 - Math.exp(-2 * PI * Math.min(0.3 * fs2, C / (2 * PI * an)) / fs2);
      this.yNose = this.nA[M - 1] / (RHO * C);

      // 声帯（Steinecke–Herzel, SI 単位）
      const f = opts.fold || {};
      this.m1 = f.m1 || 0.125e-3; this.m2 = f.m2 || 0.025e-3;
      this.k1 = f.k1 || 80; this.k2 = f.k2 || 8; this.kc = f.kc || 25;
      this.r1 = f.r1 || 0.02; this.r2 = f.r2 || 0.02;
      this.d1 = f.d1 || 0.25e-2; this.d2 = f.d2 || 0.05e-2; this.lg = f.lg || 1.4e-2;
      this.aScale = f.aScale || 1; this.fBase = f.fBase || 135; this.qa = f.qa === undefined ? 1.5 : f.qa;       // Q=1 のときのおよその基本周波数
      this.x1 = 0; this.x2 = 0; this.v1 = 0; this.v2 = 0;
      this.Q = 1; this.corr = 1; this.pitchFb = opts.pitchFb === undefined ? 0.25 : opts.pitchFb;
      this.xm = 0; this.xPrev = 0; this.cyc = 0; this.fMeas = 0; this.fTarget = 0; this.voiced = 0; this.lastCycAge = 0;
      this.Ug = 0; this.ga = 0; this.inj = 0;
      this.aspGain = 0.012; this.fricGain = opts.fricGain === undefined ? 0.045 : opts.fricGain;
      this.jc = -1; this.jZ1 = 0; this.jZ2 = 0; this.jq = 0; this.jUs = 0; this.nzHp = 0; this.fricAmp = 0; this.fricPos = N - 1; this.fricRe = 0; this.seed = 22222;

      // 制御パラメータ（すべて滑らかな補間つき）
      const P = PARAMS.length;
      this.cur = new Float64Array(P); this.from = new Float64Array(P); this.to = new Float64Array(P);
      this.rt = new Float64Array(P); this.rd = new Float64Array(P);
      this.set('pitch', 60); this.set('ps', 0); this.set('abd', 0.05e-4); this.set('velum', 0); this.set('vib', 0); this.set('breath', 0.01e-4);
      this.vibPh = 0; this.vibRate = 5.4; this.drift = 0; this.driftT = 0; this.flutter = 2.5; // cent
      this.stepCount = 0; this.dec = 0;
      this.gain = opts.gain || 0.11;
      this.t1 = 0; this.t2 = 0; this.tA1 = 1 - Math.exp(-2 * PI * 3000 / fs); this.tA2 = 1 - Math.exp(-2 * PI * 6000 / fs);
      this.hp = [0, 0]; this.env = 0; this.cAtk = 1 - Math.exp(-1 / (0.0006 * fs)); this.cRel = 1 - Math.exp(-1 / (0.15 * fs));

      // 残響（8 本の FDN）
      const lens = [1297, 1553, 1811, 2087, 2311, 2633, 2969, 3331].map(l => Math.round(l * fs / 48000));
      this.rvLen = lens; this.rvBuf = lens.map(l => new Float64Array(l)); this.rvIdx = new Int32Array(8); this.rvLp = new Float64Array(8); this.rvO = new Float64Array(8);
      this.rvG = lens.map(l => Math.pow(10, -3 * l / (fs * 1.9))); this.reverbMix = 0.2;
      // 可視化用のリングバッファ（fs で記録）
      this.ringN = 2048; this.ugRing = new Float32Array(this.ringN); this.gaRing = new Float32Array(this.ringN); this.x1Ring = new Float32Array(this.ringN); this.x2Ring = new Float32Array(this.ringN); this.ringI = 0;
      this.control(true);
      this.k.set(this.kT); this.dk.fill(0);
    }

    // ---- 制御 ----
    set(name, v) { const i = PI_[name]; this.cur[i] = this.from[i] = this.to[i] = v; this.rt[i] = this.rd[i] = 0; }
    ramp(name, v, d) {
      const i = PI_[name]; if (i === undefined) return;
      if (!(d > 0)) { this.set(name, v); return; }
      this.from[i] = this.cur[i]; this.to[i] = v; this.rt[i] = 0; this.rd[i] = d;
    }
    get(name) { return this.cur[PI_[name]]; }
    // 母音の形へ d 秒で移る。midi を渡すと、基本周波数が第 1 フォルマントを追い越さないように
    // 口を開いた変種へ寄せる（歌手のフォルマント同調。F1 < f0 では声帯が声道に負けて鳴らなくなる）
    setVowel(v, d, midi) {
      const vs = this.shapes[v]; if (!vs) return;
      this.vowel = v; this.vA0.set(this.vCur); this.vT = 0; this.vD = Math.max(1e-4, d || 0.06);
      const need = midi ? this.f1Margin * 440 * Math.pow(2, (midi - 69) / 12) : 0;
      let j = 0; while (j < vs.length - 2 && need > vs[j + 1].f1) j++;
      if (vs.length === 1 || need <= vs[0].f1) { this.vA1.set(vs[0].s); return; }
      let t = (need - vs[j].f1) / (vs[j + 1].f1 - vs[j].f1); if (t > 1) t = 1; if (t < 0) t = 0;
      const a = vs[j].s, b = vs[j + 1].s, o = this.vA1; for (let i = 0; i < this.N; i++) o[i] = a[i] + (b[i] - a[i]) * t;
    }
    setShape(pts) { sampleShape(pts, this.N, this.vCur); this.vA0.set(this.vCur); this.vA1.set(this.vCur); this.vT = 1; this.vD = 1; this.control(true); this.k.set(this.kT); this.dk.fill(0); }
    // 狭め: place ∈ lab/alv/pal/vel, 面積 area [m²] へ d 秒かけて閉じる / 開く
    constrict(place, area, d) { const n = place[0].toUpperCase() + place.slice(1); this.set('c' + n, area); this.ramp('g' + n, 1, d); }
    release(place, d) { const n = place[0].toUpperCase() + place.slice(1); this.ramp('g' + n, 0, d); }
    reset() {
      this.R.fill(0); this.L.fill(0); this.nR.fill(0); this.nL.fill(0); this.x1 = this.x2 = this.v1 = this.v2 = 0;
      this.lipLp = this.noseLp = this.Uprev = 0; this.corr = 1; this.voiced = 0;
      for (const n of ['gLab', 'gAlv', 'gPal', 'gVel', 'ps', 'velum', 'vib']) this.set(n, 0);
      this.set('abd', 0.05e-4); this.setVowel('x', 0.01);
    }
    rand() { let s = this.seed; s ^= s << 13; s ^= s >>> 17; s ^= s << 5; this.seed = s; return (s >>> 0) / 2147483648 - 1; }

    control(init) {
      const cur = this.cur, tick = this.tick, N = this.N, A = this.A;
      for (let p = 0; p < cur.length; p++) {
        if (this.rt[p] < this.rd[p]) {
          this.rt[p] += tick; let s = this.rt[p] / this.rd[p]; if (s > 1) s = 1; s = s * s * (3 - 2 * s);
          cur[p] = this.from[p] + (this.to[p] - this.from[p]) * s;
        }
      }
      if (this.vT < this.vD) {
        this.vT += tick; let s = this.vT / this.vD; if (s > 1) s = 1; s = s * s * (3 - 2 * s);
        const a0 = this.vA0, a1 = this.vA1, vc = this.vCur;
        for (let i = 0; i < N; i++) vc[i] = a0[i] + (a1[i] - a0[i]) * s;
      }
      const vc = this.vCur;
      for (let i = 0; i < N; i++) A[i] = Math.exp(vc[i]);
      let anyC = false;
      for (let q = 0; q < 4; q++) {
        const g = cur[6 + q]; if (g <= 0) continue; anyC = true;
        const c = cur[10 + q], b = this.bump[q];
        for (let i = 0; i < N; i++) if (b[i] > 0) { const s = b[i] * g; A[i] = A[i] * (1 - s) + c * s; }
      }
      for (let i = 0; i < N; i++) if (A[i] < 1e-9) A[i] = 1e-9;
      const kT = this.kT, k = this.k, dk = this.dk, inv = 1 / this.STEPS;
      for (let i = 1; i < N; i++) { kT[i] = (A[i - 1] - A[i]) / (A[i - 1] + A[i]); dk[i] = (kT[i] - k[i]) * inv; }
      this.Z0 = RHO * C / A[0];
      // 唇の放射
      const al = Math.sqrt(A[N - 1] / PI);
      this.lipA = 1 - Math.exp(-2 * PI * Math.min(0.3 * this.fs2, C / (2 * PI * al)) / this.fs2);
      this.yLip = A[N - 1] / (RHO * C);
      // 鼻腔の入口
      const An = Math.max(1e-9, cur[3]), J = this.J;
      this.nA[0] = An; this.nk[1] = (An - this.nA[1]) / (An + this.nA[1]);
      const sum = A[J - 1] + A[J] + An;
      this.tl = 2 * A[J - 1] / sum; this.tr = 2 * A[J] / sum; this.tn = cur[3] > 1e-8 ? 2 * An / sum : 0;
      if (init) return;

      // 狭め: いちばん狭い所ではジェットができ、動圧 (ρ/2)(U/A)² の分だけ圧力を失う（非線形の抵抗）。
      // その流速からレイノルズ数を求め、臨界を超えた分が乱流雑音になる。
      let im = 4, am = A[4];
      for (let i = 5; i < N; i++) if (A[i] < am) { am = A[i]; im = i; }
      let amp = 0;
      if (am < 0.3e-4) {
        const jc = im < N - 1 ? im + 1 : im;
        if (jc === this.J && this.tn > 0) this.jc = -1;
        else { this.jc = jc; this.jZ1 = RHO * C / A[jc - 1]; this.jZ2 = RHO * C / A[jc]; this.jq = RHO / (2 * am * am); }
        const U = this.jUs;
        const v = Math.min(U / am, 60), d = Math.sqrt(4 * am / PI), Re = v * d / NU;
        this.fricRe = Re;
        if (Re > 1700 && (anyC || am < 0.2e-4)) amp = this.fricGain * RHO * v * v * (1 - 1700 * 1700 / (Re * Re)) * Math.min(1, am / 0.05e-4);
        this.fricPos = Math.min(N - 1, im + 1);
      } else { this.fricRe = 0; this.jc = -1; }
      this.fricAmp += (amp - this.fricAmp) * 0.3;

      // 音高: 目標（ビブラート・ゆらぎ込み）→ 張力 Q
      this.vibPh += 2 * PI * this.vibRate * (1 + 0.04 * Math.sin(this.vibPh * 0.13)) * tick;
      if (this.vibPh > 2e4) this.vibPh -= 2 * PI * 1000;
      this.driftT += (this.rand() - this.driftT) * 0.004; this.drift += (this.driftT - this.drift) * 0.02;
      const cents = cur[4] * Math.sin(this.vibPh) + this.flutter * 40 * this.drift;
      const ft = this.fTarget = 440 * Math.pow(2, (cur[0] + cents / 100 - 69) / 12);
      this.Q = ft / this.fBase * this.corr;
      const Q = this.Q, dt = this.dt;
      // 張り方: 質量 ∝ Q^-qa, ばね ∝ Q^(2-qa), 減衰 ∝ Q^(1-qa)（qa=1 は張力のみ、qa=2 は伸びて軽くなるのみ）
      const qm = Math.pow(Q, this.qa), qk = Q * Q / qm, qr = Q / qm;
      this._m1 = dt * qm / this.m1; this._m2 = dt * qm / this.m2;
      this._k1 = this.k1 * qk; this._k2 = this.k2 * qk; this._kc = this.kc * qk;
      this._r1 = this.r1 * qr; this._r2 = this.r2 * qr;
      this.lastCycAge += tick; if (this.lastCycAge > 0.03) this.voiced = 0;
    }

    // outL/outR の [off, off+cnt) を埋める
    process(outL, outR, off, cnt) {
      const N = this.N, M = this.M, J = this.J, R = this.R, L = this.L, jR = this.jR, jL = this.jL, k = this.k, dk = this.dk;
      const nR = this.nR, nL = this.nL, njR = this.njR, njL = this.njL, nk = this.nk;
      const fade = this.fade, nFade = this.nFade, dt = this.dt, fs2 = this.fs2, cur = this.cur;
      const lg = this.lg, ld1 = lg * this.d1, ld2 = lg * this.d2, two_l = 2 * lg;
      let x1 = this.x1, x2 = this.x2, v1 = this.v1, v2 = this.v2;
      for (let n = 0; n < cnt; n++) {
        let acc = 0;
        for (let h = 0; h < 2; h++) {
          if (this.stepCount === 0) { this.x1 = x1; this.control(false); }
          if (++this.stepCount >= this.STEPS) this.stepCount = 0;
          const ps = cur[1], a0 = cur[2] * this.aScale, chink = cur[5] * this.aScale;
          // ---- 声門 ----
          const a1 = a0 + two_l * x1, a2 = a0 + two_l * x2;
          const amin = a1 < a2 ? a1 : a2;
          const Af = (amin > 0 ? amin : 0) + chink;
          const L0 = L[0], Z0 = this.Z0;
          const D = ps - 2 * L0, aD = D < 0 ? -D : D;
          let U = 0;
          if (Af > 1e-10 && !this.freeze) { const q = RHO / (2 * Af * Af); U = 2 * aD / (Z0 + Math.sqrt(Z0 * Z0 + 4 * q * aD)); if (D < 0) U = -U; }
          const psup = 2 * L0 + Z0 * U, dP = ps - psup;
          let P1 = 0, P2 = 0;
          if (a1 > 0) { if (amin > 0) { const r = amin / a1; P1 = ps - dP * r * r; } else P1 = ps; }
          if (a2 > 0) P2 = psup;
          let F1 = ld1 * P1 - this._k1 * x1 - this._r1 * v1 - this._kc * (x1 - x2);
          let F2 = ld2 * P2 - this._k2 * x2 - this._r2 * v2 - this._kc * (x2 - x1);
          if (a1 < 0) F1 -= 3 * this._k1 * (a1 / two_l);
          if (a2 < 0) F2 -= 3 * this._k2 * (a2 / two_l);
          v1 += this._m1 * F1; x1 += dt * v1;
          v2 += this._m2 * F2; x2 += dt * v2;
          // 周期の測定（x1 の上向きゼロ交差）
          this.xm += (x1 - this.xm) * 0.0004;
          const xc = x1 - this.xm; this.cyc++;
          if (xc > 0 && this.xPrev <= 0) {
            const T = this.cyc - xc / (xc - this.xPrev); this.cyc = xc / (xc - this.xPrev);
            const fm = fs2 / T, ft = this.fTarget;
            if (fm > ft * 0.6 && fm < ft * 1.6 && ps > 100) {
              this.fMeas = fm; this.voiced = 1; this.lastCycAge = 0;
              let c = this.corr * Math.exp(this.pitchFb * Math.log(ft / fm));
              this.corr = c < 0.5 ? 0.5 : c > 2.5 ? 2.5 : c;
            }
          }
          this.xPrev = xc;
          // 気息雑音（声門のジェット）
          const w = this.rand(); this.nzHp += (w - this.nzHp) * 0.05; const nz = w - this.nzHp;
          const jet = dP < 0 ? -dP : dP;
          const pn = nz * this.aspGain * jet * Math.sqrt(Af < 0.3e-4 ? Af / 0.1e-4 : 3);
          // ---- 声道 ----
          jR[0] = L0 + Z0 * U + pn + this.inj; this.inj = 0;
          for (let i = 1; i < N; i++) { const ki = k[i] += dk[i]; const w2 = ki * (R[i - 1] - L[i]); jR[i] = R[i - 1] + w2; jL[i] = L[i] + w2; }
          const pj = this.tl * R[J - 1] + this.tr * L[J] + this.tn * nL[0];
          if (this.tn > 0) { jR[J] = pj - L[J]; jL[J] = pj - R[J - 1]; njR[0] = pj - nL[0]; } else njR[0] = -nL[0];
          const jc = this.jc;
          if (jc > 0) { // ジェット抵抗つきの接合: q·U|U| + (Z1+Z2)·U = 2(R−L)
            const Rin = R[jc - 1], Lin = L[jc], D2 = 2 * (Rin - Lin), aD2 = D2 < 0 ? -D2 : D2, Zs = this.jZ1 + this.jZ2;
            let Uc = 2 * aD2 / (Zs + Math.sqrt(Zs * Zs + 4 * this.jq * aD2)); this.jUs += (Uc - this.jUs) * 0.01; if (D2 < 0) Uc = -Uc;
            jR[jc] = Lin + this.jZ2 * Uc; jL[jc] = Rin - this.jZ1 * Uc;
          }
          const lp = this.lipLp += (R[N - 1] - this.lipLp) * this.lipA;
          jL[N] = -this.lipG * lp;
          let Uo = (R[N - 1] - jL[N]) * this.yLip;
          for (let i = 0; i < N; i++) { R[i] = jR[i] * fade; L[i] = jL[i + 1] * fade; }
          if (this.fricAmp > 0) { const f = this.rand() * this.fricAmp; R[this.fricPos] += f; if (this.fricPos > 0) L[this.fricPos - 1] -= f; }
          // ---- 鼻腔 ----
          for (let i = 1; i < M; i++) { const w2 = nk[i] * (nR[i - 1] - nL[i]); njR[i] = nR[i - 1] + w2; njL[i] = nL[i] + w2; }
          const nlp = this.noseLp += (nR[M - 1] - this.noseLp) * this.noseAl;
          njL[M] = -0.95 * nlp;
          Uo += (nR[M - 1] - njL[M]) * this.yNose;
          for (let i = 0; i < M; i++) { nR[i] = njR[i] * nFade; nL[i] = njL[i + 1] * nFade; }
          // ---- 放射 ----
          acc += (Uo - this.Uprev) * fs2; this.Uprev = Uo;
          this.Ug = U; this.ga = Af;
        }
        const ri = this.ringI; this.ugRing[ri] = this.Ug; this.gaRing[ri] = this.ga; this.x1Ring[ri] = x1; this.x2Ring[ri] = x2; this.ringI = (ri + 1) & (this.ringN - 1);
        let s = acc * 0.5 * this.gain;
        // 高域の損失（管壁の粘性・熱伝導、やわらかい壁、声帯のやわらかい閉じ方）をまとめた 2 段の低域通過
        this.t1 += (s - this.t1) * this.tA1; this.t2 += (this.t1 - this.t2) * this.tA2; s = this.t2 * 1.5;
        const y = s - this.hp[0] + 0.997 * this.hp[1]; this.hp[0] = s; this.hp[1] = y; s = y;
        // マイクの後のコンプレッサ（母音による音量差をならす）
        const ab = s < 0 ? -s : s; this.env += (ab - this.env) * (ab > this.env ? this.cAtk : this.cRel);
        if (this.env > 0.06) s *= Math.pow(0.06 / this.env, 0.55);
        s *= 1.6;
        // 残響
        let sum = 0, vL = 0, vR = 0; const rb = this.rvBuf, ri2 = this.rvIdx, rl = this.rvLp, ro = this.rvO, rg = this.rvG;
        for (let q = 0; q < 8; q++) { const o = rb[q][ri2[q]]; const l = rl[q] = o + (rl[q] - o) * 0.3; const v = l * rg[q]; ro[q] = v; sum += v; if (q & 1) vR += (q & 2) ? -o : o; else vL += (q & 2) ? -o : o; }
        sum *= 0.25;
        for (let q = 0; q < 8; q++) { rb[q][ri2[q]] = ro[q] - sum + s * 0.5 + 1e-24; if (++ri2[q] >= this.rvLen[q]) ri2[q] = 0; }
        let oL = s + vL * this.reverbMix, oR = s + vR * this.reverbMix;
        const aL = oL < 0 ? -oL : oL, aR = oR < 0 ? -oR : oR;
        if (aL > 0.7) oL = (oL < 0 ? -1 : 1) * (0.7 + 0.3 * Math.tanh((aL - 0.7) / 0.3));
        if (aR > 0.7) oR = (oR < 0 ? -1 : 1) * (0.7 + 0.3 * Math.tanh((aR - 0.7) / 0.3));
        outL[off + n] = oL; outR[off + n] = oR;
      }
      this.x1 = x1; this.x2 = x2; this.v1 = v1; this.v2 = v2;
    }

    // 可視化用スナップショット
    snapshot(nRing) {
      const N = this.N, a = new Float32Array(N); for (let i = 0; i < N; i++) a[i] = this.A[i] * 1e4;
      const n = nRing || 512, ug = new Float32Array(n), ga = new Float32Array(n), x1 = new Float32Array(n), x2 = new Float32Array(n);
      for (let i = 0; i < n; i++) { const j = (this.ringI - n + i) & (this.ringN - 1); ug[i] = this.ugRing[j]; ga[i] = this.gaRing[j]; x1[i] = this.x1Ring[j]; x2[i] = this.x2Ring[j]; }
      return { area: a, ug, ga, x1, x2, velum: this.cur[3] * 1e4, f0: this.voiced ? this.fMeas : 0, ft: this.fTarget, ps: this.cur[1], abd: this.cur[2] * this.aScale * 1e4, Q: this.Q,
        fric: this.fricAmp, fricPos: this.fricPos / N, re: this.fricRe, vowel: this.vowel, J: this.J / N, lg: this.lg };
    }
  }

  return { Voice, VOWELS, PLACES, TYPES, sampleShape };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { voiceEngineFactory };
