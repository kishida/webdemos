/*
 * brass-engine.js — 金管楽器の物理モデリング音源
 *
 * モデルの構造（1奏者 = 1ボイス）
 *   息の圧力 ──► [唇: 質量-バネ系のバルブ] ──► すき間を通る流れ(ベルヌーイ) ──► 管へ
 *                     ▲                                                    │
 *                     │ マウスピース内の圧力が唇を押し戻す                 ▼
 *              ベルでの反射(低域) ◄──────── [管: ディレイライン(ウェーブガイド)]
 *                                                │
 *                                                └─► ベルからの放射(高域) ─► 音
 *
 * 唇は息に押されて開き、流れ込んだ空気が管内の圧力を上げ、その圧力が唇を押し戻す。
 * この綱引きが管の往復時間と噛み合ったところで自励振動が起き、それが金管の音になる。
 * サンプルは一切使わず、すべて毎サンプルの計算で音を作る。
 *
 * この関数は自己完結していて、AudioWorklet へは toString() して Blob で渡す。
 * Node からは require して同じコードをオフライン検証に使う。
 */
function BrassEngineFactory() {
  'use strict';
  const TWO_PI = 2 * Math.PI;

  // 楽器ごとの物理パラメータ
  //  bell  : ベルのカットオフ[Hz]。これより下は反射して管に戻り、上は外へ放射される
  //  lipQ  : 唇の共振の鋭さ / lipG : 唇の柔らかさ（圧力あたりの開き）
  //  kap   : 唇の固有振動数 ÷ 鳴らしたい音の周波数（外向きに開く唇は固有振動数より上で鳴る）
  //  refl  : 管の往復で残るエネルギー / body : 管内音圧の漏れ成分 / brass : 強奏時の波形の切り立ち
  const INSTR = {
    trumpet:   { lo: 52, hi: 86, bell: 1400, lipQ: 4.0, lipG: 1.0, kap: 0.80, refl: 0.95, body: 0.06, brass: 2.2, fmt: 1300, fmtQ: 1.0, fmtDb: 3, gain: 2.4, vib: 0.0035, vibHz: 5.4, noise: 0.03, atk: 0.008, rel: 0.030 },
    horn:      { lo: 41, hi: 77, bell: 700,  lipQ: 3.5, lipG: 1.0, kap: 0.80, refl: 0.95, body: 0.10, brass: 1.0, fmt: 480,  fmtQ: 1.0, fmtDb: 3, gain: 2.0, vib: 0.0015, vibHz: 5.0, noise: 0.03, atk: 0.012, rel: 0.040 },
    trombone:  { lo: 40, hi: 74, bell: 950,  lipQ: 4.0, lipG: 1.0, kap: 0.80, refl: 0.95, body: 0.08, brass: 2.0, fmt: 650,  fmtQ: 1.0, fmtDb: 3, gain: 2.2, vib: 0.0025, vibHz: 5.0, noise: 0.03, atk: 0.010, rel: 0.040 },
    euphonium: { lo: 38, hi: 74, bell: 600,  lipQ: 3.5, lipG: 1.0, kap: 0.80, refl: 0.95, body: 0.12, brass: 0.8, fmt: 380,  fmtQ: 0.9, fmtDb: 3, gain: 2.0, vib: 0.0030, vibHz: 5.2, noise: 0.03, atk: 0.012, rel: 0.045 },
    tuba:      { lo: 26, hi: 60, bell: 420,  lipQ: 3.5, lipG: 1.0, kap: 0.80, refl: 0.95, body: 0.18, brass: 0.6, fmt: 240,  fmtQ: 0.9, fmtDb: 3, gain: 2.4, vib: 0.0010, vibHz: 4.8, noise: 0.03, atk: 0.014, rel: 0.050 },
  };

  // 管の長さと倍音: 実際の金管と同じく、管は「指使い（バルブ/スライド）」で決まる長い管で、
  // 唇がその管の何番目の共鳴（倍音）に乗るかで音の高さが決まる。
  //  ped  : バルブを押さない状態の管の基音（ペダルトーン）
  //  maxV : バルブ/スライドで下げられる半音数
  const BORE = {
    trumpet:   { ped: 46, maxV: 6 },
    horn:      { ped: 34, maxV: 6 },
    trombone:  { ped: 34, maxV: 6 },
    euphonium: { ped: 34, maxV: 8 },
    // チューバだけは実物より短い管として扱う（低音域は第1倍音）。実物どおりの長い管だと、往復に時間がかかりすぎて
    // 行進曲の短い音符のうちに振動が育ちきらず、音が痩せるため
    tuba:      { ped: 46, maxV: 17 },
  };
  const PARTIALS = [[1, 0], [2, 12], [3, 19], [4, 24], [5, 28], [6, 31], [8, 36], [9, 38], [10, 40], [12, 43]];
  // 唇の構え: 固有振動数を狙う倍音のどれだけ下に置くか(kc/n)、高い倍音ほどどれだけ張りを鋭くするか(qn)
  const TUNE = { kc: 0.55, kmin: 0.8, qn: 0.6, hp: 1.1, st: 0.008, so: 0.12 };
  const FING = {};
  // 音 → { n: 何番目の倍音か, v: バルブ/スライドで何半音下げるか }。押すバルブが少ない運指を優先
  function fingerOf(name, midi) {
    const key = name + midi;
    if (FING[key]) return FING[key];
    const B = BORE[name];
    let r = null;
    for (let v = 0; v <= B.maxV && !r; v++) for (const [n, off] of PARTIALS) if (B.ped + off - v === midi) { r = { n, v }; break; }
    if (!r) r = { n: midi < B.ped + 12 ? 2 : 4, v: -1 };   // 音域外（試奏用の保険）
    return (FING[key] = r);
  }

  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);
  // 強弱(0..1) → 口の中の圧力。音量も音色もここから先は物理モデルが決める
  const pmOf = (vel) => 0.08 + 0.92 * vel * vel;
  const CAL_V = [0.4, 0.7, 1.0];
  const CAL_P = CAL_V.map(pmOf);

  function makeRng(seed) {
    let s = (seed >>> 0) || 1;
    return function () {
      s ^= s << 13; s >>>= 0;
      s ^= s >>> 17;
      s ^= s << 5; s >>>= 0;
      return s / 4294967296;
    };
  }

  // 音程補正テーブル: CAL[sr][楽器名][強弱3段階] = Float32Array(128) (管長)
  const CAL = {};

  class BrassVoice {
    constructor(sr, inst, seed) {
      this.sr = sr;
      this.N = 8192;
      this.mask = this.N - 1;
      this.buf = new Float32Array(this.N);
      this.rand = makeRng(seed || 1);
      this.detune = 1;
      this.pScale = 1;
      this.bright = 1;
      this.vibScale = 1;
      this.human = 1;
      this.kick = 0.15;
      this.lenOverride = 0;
      this.ctlStep = Math.max(1, Math.round(sr / 3000));
      this.stK = sr / (TWO_PI * 1000);
      this.reset();
      this.setInstrument(inst);
    }

    reset() {
      this.buf.fill(0);
      this.w = 0;
      this.y1 = 0; this.y2 = 0;       // 唇の変位（質量-バネ系の状態）
      this.lp1 = 0; this.lp2 = 0;     // ベル反射フィルタ
      this.dc = 0; this.pPrev = 0; this.radP = 0;
      this.fs1 = 0; this.fs2 = 0;     // フォルマントEQ
      this.env = 0; this.over = 0;
      this.gate = false;
      this.f0 = 220; this.len = 200; this.lenT = 200;
      this.n = 2; this.valve = 0; this.fLip = 0; this.fLipT = 176; this.lipK = 1; this.slurKind = 0; this.lipOver = 0;
      this.glide = 0.01;
      this.age = 0; this.vibPh = this.rand() * TWO_PI;
      this.ctl = 0;
      this.pT = 0; this.vel = 0; this.midi = 60; this.id = -1;
      this.b0 = 0; this.a1 = 0; this.a2 = 0; this.bellA = 0.1; this.dcK = 0.001;
      this.dPitch = 0; this.dPress = 0;   // 人間らしいゆらぎ
      this.lvK = 1;
      this.level = 0; this.bore = 0; this.g = 0; this.pm = 0;
    }

    setInstrument(name) {
      const I = INSTR[name];
      this.inst = name;
      this.I = I;
      const sr = this.sr;
      this.atkC = 1 - Math.exp(-1 / (I.atk * sr));
      this.relC = 1 - Math.exp(-1 / (I.rel * sr));
      // ベルとマウスピースの共鳴による軽い色付け（peaking EQ）
      const A = Math.pow(10, I.fmtDb / 40);
      const w0 = TWO_PI * I.fmt / sr;
      const al = Math.sin(w0) / (2 * I.fmtQ);
      const a0 = 1 + al / A;
      this.fb0 = (1 + al * A) / a0;
      this.fb1 = (-2 * Math.cos(w0)) / a0;
      this.fb2 = (1 - al * A) / a0;
      this.fa1 = (-2 * Math.cos(w0)) / a0;
      this.fa2 = (1 - al / A) / a0;
    }

    // いまの息の圧力に合った管長（強く吹くほど音が上ずるので、その分スライドを抜く）
    lenFor(midi, pm) {
      if (this.lenOverride) return this.lenOverride;
      const c = CAL[this.sr] && CAL[this.sr][this.inst];
      if (!c || !(c[1][midi] > 0)) return this.sr / mtof(midi) * (fingerOf(this.inst, midi).n + 0.04);
      const i = pm < CAL_P[1] ? 0 : 1;
      let u = (pm - CAL_P[i]) / (CAL_P[i + 1] - CAL_P[i]);
      if (u < -1.2) u = -1.2; else if (u > 1.3) u = 1.3;
      return c[i][midi] + (c[i + 1][midi] - c[i][midi]) * u;
    }

    noteOn(midi, vel, slur, id) {
      const legato = slur && this.gate;
      this.midi = midi; this.vel = vel; this.id = id;
      this.f0 = mtof(midi) * this.detune;
      this.gate = true;
      this.pT = pmOf(vel);
      const fg = fingerOf(this.inst, midi);
      const sameTube = fg.v === this.valve;
      this.n = fg.n; this.valve = fg.v;
      // 唇の固有振動数は、狙う倍音のすぐ下に構える
      this.fLipT = this.f0 * Math.max(TUNE.kmin, 1 - TUNE.kc / fg.n);
      if (legato) {
        // スラー: 息は切らない。
        //  同じ指使い → リップスラー。管はそのままで、唇の張りだけを変える。唇が次の共鳴の
        //               引き込み域に入った瞬間に、振動が隣の倍音へ「ぱたっ」と乗り移る。
        //  指使いが変わる → バルブ/スライドのスラー。管の長さが短時間で切り替わる。
        this.slurKind = sameTube ? 1 : 2;
        this.lipK = 1 - Math.exp(-this.ctlStep / ((sameTube ? TUNE.st : 0.008) * this.sr));
        // 唇は行き先を少し行き過ぎるくらいに切り替える（奏者が息と唇で「乗せにいく」動き）
        this.lipOver = sameTube ? TUNE.so * (this.fLipT > this.fLip ? 1 : -1) : 0;
        this.glide = 1 - Math.exp(-1 / ((sameTube ? 0.010 : 0.004) * this.sr));
        this.ctl = 0;
        return;
      }
      this.slurKind = 0;
      this.fLip = this.fLipT; this.lipK = 1;
      if (!legato) {
        // タンギング: 舌で息を一瞬止め、少し強めに吹き直す
        this.age = 0;
        this.env *= 0.25;
        this.over = 0.35;
        // 舌を離した瞬間、せき止めていた息が唇を弾く。これが振動の種になり立ち上がりを決める
        this.y1 += this.kick * this.pT;
        this.glide = 1 - Math.exp(-1 / (0.002 * this.sr));
      } else {
        this.glide = 1 - Math.exp(-1 / (0.012 * this.sr));
      }
      this.ctl = 0;
    }

    noteOff(id) {
      if (id < 0 || id === this.id) this.gate = false;
    }

    control() {
      const I = this.I, sr = this.sr, dt = this.ctlStep / sr;
      this.age += dt;
      this.over *= Math.exp(-dt / 0.045);
      // ゆっくりした音程と息のゆらぎ（奏者ごとに独立）
      if (this.human) {
        this.dPitch = this.dPitch * 0.9985 + (this.rand() * 2 - 1) * 0.00011 * this.human;
        this.dPress = this.dPress * 0.997 + (this.rand() * 2 - 1) * 0.0022 * this.human;
      }
      let d = (this.age - 0.18) / 0.35;
      d = d < 0 ? 0 : d > 1 ? 1 : d;
      this.vibPh += TWO_PI * I.vibHz * (1 + this.dPress) * dt;
      if (this.vibPh > TWO_PI) this.vibPh -= TWO_PI;
      const fm = (1 + I.vib * this.vibScale * d * d * (3 - 2 * d) * Math.sin(this.vibPh)) * (1 + this.dPitch);
      const f = this.f0 * fm;
      // 唇（質量-バネ-ダンパ）。固有振動数は鳴らす音より少し低く構える
      if (!(this.fLip > 0)) this.fLip = this.fLipT;
      this.lipOver *= Math.exp(-dt / 0.04);
      this.fLip += (this.fLipT * (1 + this.lipOver) - this.fLip) * this.lipK;
      const fl = this.fLip * fm;
      const th = TWO_PI * fl / sr;
      const r = Math.exp(-Math.PI * fl / (I.lipQ * (1 + TUNE.qn * (this.n - 1)) * sr));
      this.a1 = -2 * r * Math.cos(th);
      this.a2 = r * r;
      this.b0 = I.lipG * (1 + this.a1 + this.a2);
      const pNow = this.env * this.pT * this.pScale;
      this.lenT = this.lenFor(this.midi, pNow < 0.03 ? 0.03 : pNow) / (this.detune * fm);
      // 高い音では基音がベルを素通りして鳴らなくなるので、実際の楽器同様に共鳴が支えられる範囲を確保する
      let fc = Math.max(I.bell, f * 1.7) * this.bright;
      if (fc > sr * 0.35) fc = sr * 0.35;
      this.bellA = 1 - Math.exp(-TWO_PI * fc / sr);
      // 狙う倍音より下の共鳴（ペダルトーンなど）は弱める。実際の楽器でも低い共鳴は弱く、音程も合っていない
      this.dcK = 1 - Math.exp(-TWO_PI * f * Math.max(0.25, TUNE.hp * (this.n - 1) / this.n) / sr);
      // 高音ほど放射効率が上がりすぎるのを均す（音域内の音量バランス）
      this.lvK = Math.pow(mtof((I.lo + I.hi) / 2) / f, 0.75);
    }

    tick() {
      if (--this.ctl <= 0) { this.ctl = this.ctlStep; this.control(); }
      const I = this.I;
      if (this.gate) this.env += (1 + this.over - this.env) * this.atkC;
      else this.env -= this.env * this.relC;

      // 管（ウェーブガイド）を一往復して戻ってきた圧力波
      this.len += (this.lenT - this.len) * this.glide;
      const rp = this.w - this.len;
      const ip = Math.floor(rp);
      const fr = rp - ip;
      const s0 = this.buf[ip & this.mask];
      const bore = s0 + (this.buf[(ip + 1) & this.mask] - s0) * fr;

      // ベル: 低い成分は反射して戻り、高い成分は外へ出ていく
      this.lp1 += this.bellA * (bore - this.lp1);
      this.lp2 += this.bellA * (this.lp1 - this.lp2);
      let pin = I.refl * this.lp2;
      this.dc += this.dcK * (pin - this.dc);
      pin -= this.dc;

      // 口の中の圧力（息 + 乱流ノイズ + ゆらぎ）
      const pm = this.env * this.pT * this.pScale * (1 + this.dPress + I.noise * (this.rand() * 2 - 1));

      // 唇: 口の圧力に押し開けられ、マウスピース側の圧力に押し戻される
      const y = this.b0 * (pm - this.pPrev) - this.a1 * this.y1 - this.a2 * this.y2;
      this.y2 = this.y1; this.y1 = y;
      const h = y > 0 ? y : 0;          // 唇のすき間（閉じたら 0）

      // すき間を通る流れ（ベルヌーイ）: 流量 ∝ すき間 × √圧力差。管の特性インピーダンスと連立して解く
      const D = pm - 2 * pin;
      let zu;
      if (D >= 0) zu = h * (-h + Math.sqrt(h * h + 4 * D)) * 0.5;
      else zu = -h * (-h + Math.sqrt(h * h - 4 * D)) * 0.5;
      this.pPrev = 2 * pin + zu;        // マウスピース内の圧力
      this.buf[this.w] = pin + zu;      // 管へ出ていく波
      this.w = (this.w + 1) & this.mask;

      this.bore = bore; this.g = h; this.pm = pm;

      // 放射音 = ベルで反射しなかった成分。強奏時は波が進むうちに切り立つ（金管の輝き）
      let rad = (bore - this.lp2) + I.body * bore;
      const dr = (rad - this.radP) * this.stK;
      this.radP = rad;
      rad += I.brass * rad * dr;
      const fo = this.fb0 * rad + this.fs1;
      this.fs1 = this.fb1 * rad - this.fa1 * fo + this.fs2;
      this.fs2 = this.fb2 * rad - this.fa2 * fo;
      const out = fo * I.gain * this.lvK;
      const a = out < 0 ? -out : out;
      this.level += (a - this.level) * (a > this.level ? 0.01 : 0.0006);
      return out;
    }

    // 可視化用: 管内の圧力分布（唇側→ベル側）
    snapshot(dst) {
      const n = dst.length;
      const L = this.len;
      for (let i = 0; i < n; i++) {
        const ip = Math.floor(this.w - 1 - (i / (n - 1)) * (L - 1));
        dst[i] = this.buf[ip & this.mask];
      }
    }
  }

  // ---- 音程キャリブレーション -------------------------------------------
  // 唇は自分の固有振動数や管の共鳴からずれた高さで鳴り、吹く強さでもずれ方が変わる。
  // 実際に鳴らして周期を測り、スライドを抜き差しするように管長を合わせ込む。
  function measurePeriod(sr, inst, midi, len, vel) {
    const v = new BrassVoice(sr, inst, 12345);
    v.vibScale = 0; v.human = 0;
    v.lenOverride = len;
    v.noteOn(midi, vel, false, 0);
    const T0 = sr / mtof(midi);
    const M = Math.ceil(T0 * 14) + 8;
    const pre = Math.ceil(Math.max(sr * 0.25, T0 * 26));
    for (let i = 0; i < pre; i++) v.tick();
    const x = new Float32Array(M);
    for (let i = 0; i < M; i++) { v.tick(); x[i] = v.bore; }
    const W = Math.floor(T0 * 10);
    // 隣の倍音に乗ってしまった場合と区別できるよう、探す範囲は倍音の間隔より狭くする
    const wr = Math.min(0.14, 0.42 / fingerOf(inst, midi).n);
    const lo = Math.max(2, Math.floor(T0 * (1 - wr))), hi = Math.ceil(T0 * (1 + wr));
    let best = -1e9, bl = lo;
    const ac = new Float64Array(hi - lo + 3);
    let e0 = 0;
    for (let i = 0; i < W; i++) e0 += x[i] * x[i];
    for (let l = lo - 1; l <= hi + 1; l++) {
      let s = 0;
      for (let i = 0; i < W; i++) s += x[i] * x[i + l];
      ac[l - lo + 1] = s;
      if (l >= lo && l <= hi && s > best) { best = s; bl = l; }
    }
    const k = bl - lo + 1;
    const ym = ac[k - 1], y0 = ac[k], yp = ac[k + 1];
    const den = ym - 2 * y0 + yp;
    const off = den !== 0 ? 0.5 * (ym - yp) / den : 0;
    return { T: bl + off, corr: e0 > 1e-12 ? best / e0 : 0, rms: Math.sqrt(e0 / W) };
  }

  function calLen(sr, name, m, vel, guess) {
    const Tt = sr / mtof(m);
    const n = fingerOf(name, m).n;
    let len = guess || Tt * (n + 0.04);
    let pl = 0, pT = 0, best = len, bestErr = 1e9;
    for (let it = 0; it < 7; it++) {
      const r = measurePeriod(sr, name, m, len, vel);
      if (r.corr < 0.5) break;
      const err = Math.abs(r.T - Tt);
      if (err < bestErr) { bestErr = err; best = len; }
      if (err < Tt * 0.0003) break;
      // セカント法: 管長に対する周期の感度を実測しながら詰める（n 番目の倍音なら感度はおよそ 1/n）
      let slope = it > 0 && Math.abs(len - pl) > 1e-6 ? (r.T - pT) / (len - pl) : 1 / n;
      if (!(slope > 0.15 / n && slope < 3 / n)) slope = 1 / n;
      pl = len; pT = r.T;
      let step = (Tt - r.T) / slope;
      const mx = Tt * 0.2;
      if (step > mx) step = mx; else if (step < -mx) step = -mx;
      len += step;
    }
    return best;
  }

  function calibrate(sr) {
    if (CAL[sr]) return CAL[sr];
    const table = {};
    for (const name in INSTR) {
      const I = INSTR[name];
      const t = CAL_V.map(() => new Float32Array(128));
      for (let m = I.lo; m <= I.hi; m++) {
        let g = 0;
        for (let k = 0; k < CAL_V.length; k++) { g = calLen(sr, name, m, CAL_V[k], g); t[k][m] = g; }
      }
      table[name] = t;
    }
    CAL[sr] = table;
    return table;
  }

  // ---- 打楽器（こちらは簡易な合成） -------------------------------------
  class Percussion {
    constructor(sr) {
      this.sr = sr;
      this.rand = makeRng(777);
      this.snE = 0; this.snB = 0; this.snPh1 = 0; this.snPh2 = 0; this.snHp = 0; this.snLp = 0;
      this.bdE = 0; this.bdT = 1; this.bdPh = 0; this.bdC = 0;
      this.cyE = 0; this.cyE2 = 0; this.cyHp = 0; this.cyHp2 = 0;
      this.cyF = [2051, 2977, 3683, 4409, 5437, 6873, 8121];
      this.cyPh = this.cyF.map(() => 0);
      this.gl = [];
      for (let i = 0; i < 6; i++) this.gl.push({ e: 0, f: 0, p1: 0, p2: 0, p3: 0 });
      this.glI = 0;
      this.lv = [0, 0, 0, 0];
    }
    hit(kind, vel, midi) {
      if (kind === 'sn') { this.snE = Math.max(this.snE, vel); this.snB = Math.max(this.snB, vel); this.lv[0] = Math.max(this.lv[0], vel); }
      else if (kind === 'bd') { this.bdE = vel; this.bdT = 0; this.bdPh = 0; this.bdC = vel; this.lv[1] = vel; }
      else if (kind === 'cy') { this.cyE = Math.max(this.cyE, vel); this.cyE2 = Math.max(this.cyE2, vel); this.lv[2] = Math.max(this.lv[2], vel); }
      else if (kind === 'gl') {
        const g = this.gl[this.glI]; this.glI = (this.glI + 1) % this.gl.length;
        g.e = vel; g.f = mtof(midi); g.p1 = 0; g.p2 = 0; g.p3 = 0; g.t = 0;
        this.lv[3] = Math.max(this.lv[3], vel);
      }
    }
    // 戻り値は [snare, bassdrum, cymbal, glock] を out 配列に書く
    tick(out) {
      const sr = this.sr, dt = 1 / sr;
      // スネア
      let sn = 0;
      if (this.snE > 1e-4) {
        const n = this.rand() * 2 - 1;
        this.snLp += 0.25 * (n - this.snLp);
        const hp = n - this.snLp;
        this.snPh1 += TWO_PI * 190 * dt; this.snPh2 += TWO_PI * 335 * dt;
        sn = hp * this.snE * 0.8 + (Math.sin(this.snPh1) + 0.6 * Math.sin(this.snPh2)) * this.snB * 0.45;
        this.snE *= Math.exp(-dt / 0.075);
        this.snB *= Math.exp(-dt / 0.03);
      }
      // バスドラム
      let bd = 0;
      if (this.bdE > 1e-4) {
        const f = 46 + 70 * Math.exp(-this.bdT / 0.035);
        this.bdPh += TWO_PI * f * dt;
        bd = Math.sin(this.bdPh) * this.bdE + (this.rand() * 2 - 1) * this.bdC * 0.3;
        this.bdT += dt;
        this.bdE *= Math.exp(-dt / 0.16);
        this.bdC *= Math.exp(-dt / 0.006);
      }
      // 合わせシンバル
      let cy = 0;
      if (this.cyE > 1e-4) {
        let s = 0;
        for (let i = 0; i < this.cyF.length; i++) {
          this.cyPh[i] += this.cyF[i] * dt;
          if (this.cyPh[i] > 1) this.cyPh[i] -= 1;
          s += this.cyPh[i] < 0.5 ? 1 : -1;
        }
        const n = this.rand() * 2 - 1;
        const x = s * 0.12 + n * 0.7;
        this.cyHp += 0.45 * (x - this.cyHp);
        const h = x - this.cyHp;
        cy = h * (this.cyE * 0.6 + this.cyE2 * 0.6);
        this.cyE *= Math.exp(-dt / 0.75);
        this.cyE2 *= Math.exp(-dt / 0.09);
      }
      // グロッケンシュピール（モード合成）
      let gl = 0;
      for (let i = 0; i < this.gl.length; i++) {
        const g = this.gl[i];
        if (g.e < 1e-4) continue;
        g.p1 += TWO_PI * g.f * dt; g.p2 += TWO_PI * g.f * 2.756 * dt; g.p3 += TWO_PI * g.f * 5.404 * dt;
        g.t += dt;
        gl += g.e * (Math.sin(g.p1) * Math.exp(-g.t / 0.9) + 0.35 * Math.sin(g.p2) * Math.exp(-g.t / 0.25) + 0.15 * Math.sin(g.p3) * Math.exp(-g.t / 0.06));
        if (g.t > 4) g.e = 0;
      }
      out[0] = sn; out[1] = bd; out[2] = cy; out[3] = gl;
      const k = Math.exp(-dt / 0.12);
      this.lv[0] *= k; this.lv[1] *= k; this.lv[2] *= Math.exp(-dt / 0.5); this.lv[3] *= Math.exp(-dt / 0.4);
    }
  }

  // ---- エンジン: 奏者 + シーケンサ + ミキサ ------------------------------
  class Engine {
    constructor(sr, doCal) {
      this.sr = sr;
      if (doCal !== false) calibrate(sr);
      this.players = [];
      this.events = [];
      this.ei = 0;
      this.pos = 0;
      this.endS = 0;
      this.playing = false;
      this.ended = false;
      this.perc = new Percussion(sr);
      this.pt = [0, 0, 0, 0];
      this.percGain = [0.55, 0.9, 0.3, 0.22];
      this.percPanL = [0.62, 0.7, 0.8, 0.5];
      this.percPanR = [0.78, 0.7, 0.6, 0.86];
      this.master = 0.14;
      this.percOn = [1, 1, 1, 1];
      this.percG = [1, 1, 1, 1];
      this.manualId = 1e9;
    }
    setup(players) {
      this.players = players.map((p, i) => {
        const v = new BrassVoice(this.sr, p.inst, 1000 + i * 7919);
        v.detune = Math.pow(2, (p.detune || 0) / 1200);
        const a = ((p.pan || 0) + 1) * Math.PI / 4;
        return { v, gl: Math.cos(a), gr: Math.sin(a), gain: p.gain == null ? 1 : p.gain, on: 1, g: 1 };
      });
    }
    load(events, duration) {
      const sr = this.sr;
      this.events = events.map((e) => Object.assign({ s: Math.round(e.t * sr) }, e));
      this.events.sort((a, b) => a.s - b.s || a.k - b.k);
      this.endS = Math.round(duration * sr);
    }
    start(t) {
      this.allOff();
      this.pos = Math.round((t || 0) * this.sr);
      let i = 0;
      while (i < this.events.length && this.events[i].s < this.pos) i++;
      this.ei = i;
      this.playing = true;
      this.ended = false;
    }
    stop() { this.playing = false; this.allOff(); }
    // 奏者・打楽器のオン/オフ（クリックノイズが出ないよう滑らかに切り替える）
    setOn(kind, i, on) {
      if (kind === 'perc') this.percOn[i] = on ? 1 : 0;
      else if (this.players[i]) this.players[i].on = on ? 1 : 0;
    }
    allOff() { for (const p of this.players) p.v.noteOff(-1); }
    setParam(name, val) {
      for (const p of this.players) {
        if (name === 'breath') p.v.pScale = val;
        else if (name === 'bright') p.v.bright = val;
        else if (name === 'vib') p.v.vibScale = val;
      }
      if (name === 'master') this.master = val;
    }
    manual(pi, on, midi, vel, inst) {
      const p = this.players[pi];
      if (!p) return;
      if (on) {
        if (inst && inst !== p.v.inst) p.v.setInstrument(inst);
        const I = p.v.I;
        while (midi < I.lo) midi += 12;
        while (midi > I.hi) midi -= 12;
        p.v.noteOn(midi, vel, true, ++this.manualId);
      } else p.v.noteOff(-1);
    }
    apply(e) {
      // k: 0 = note off, 1 = note on, 2 = 打楽器
      if (e.k === 1) this.players[e.p].v.noteOn(e.m, e.v, !!e.sl, e.id);
      else if (e.k === 0) this.players[e.p].v.noteOff(e.id);
      else this.perc.hit(e.d, e.v, e.m);
    }
    render(L, R, n) {
      const ps = this.players, np = ps.length, ev = this.events;
      const pt = this.pt, pg = this.percGain, ppl = this.percPanL, ppr = this.percPanR;
      let i = 0;
      while (i < n) {
        let end = n;
        if (this.playing) {
          while (this.ei < ev.length && ev[this.ei].s <= this.pos) this.apply(ev[this.ei++]);
          if (this.ei < ev.length) {
            const d = ev[this.ei].s - this.pos;
            if (i + d < end) end = i + d;
          } else if (this.pos >= this.endS) {
            this.playing = false; this.ended = true;
          }
        }
        const start = i;
        for (; i < end; i++) {
          let l = 0, r = 0;
          for (let k = 0; k < np; k++) {
            const p = ps[k];
            p.g += (p.on - p.g) * 0.003;
            const s = p.v.tick() * p.gain * p.g;
            l += s * p.gl; r += s * p.gr;
          }
          this.perc.tick(pt);
          for (let k = 0; k < 4; k++) { this.percG[k] += (this.percOn[k] - this.percG[k]) * 0.003; const s = pt[k] * pg[k] * this.percG[k]; l += s * ppl[k]; r += s * ppr[k]; }
          L[i] = Math.tanh(l * this.master);
          R[i] = Math.tanh(r * this.master);
        }
        if (this.playing) this.pos += i - start;
      }
    }
  }

  // ---- AudioWorklet として読み込まれた場合 -------------------------------
  if (typeof AudioWorkletProcessor !== 'undefined' && typeof registerProcessor === 'function') {
    class BrassProcessor extends AudioWorkletProcessor {
      constructor() {
        super();
        // 調律（管長の合わせ込み）は時間がかかるので音声スレッドではやらない。結果を 'cal' で受け取る
        this.eng = new Engine(sampleRate, false);
        this.cnt = 0;
        this.focus = 0;
        this.snap = new Float32Array(96);
        this.port.onmessage = (ev) => {
          const m = ev.data, e = this.eng;
          if (m.type === 'cal') CAL[sampleRate] = m.table;
          else if (m.type === 'setup') { e.setup(m.players); e.load(m.events, m.duration); }
          else if (m.type === 'play') { this.seq = m.seq || 0; e.start(m.t); }
          else if (m.type === 'stop') e.stop();
          else if (m.type === 'param') e.setParam(m.name, m.value);
          else if (m.type === 'manual') e.manual(m.p, m.on, m.midi, m.vel, m.inst);
          else if (m.type === 'focus') this.focus = m.p;
          else if (m.type === 'on') e.setOn(m.kind, m.i, m.on);
        };
        this.port.postMessage({ type: 'ready', sr: sampleRate });
      }
      process(inputs, outputs) {
        const o = outputs[0];
        const e = this.eng;
        e.render(o[0], o[1] || o[0], o[0].length);
        this.cnt += o[0].length;
        if (this.cnt >= 1024) {
          this.cnt = 0;
          const lv = e.players.map((p) => p.v.level);
          const msg = { type: 'pos', seq: this.seq || 0, t: e.pos / e.sr, playing: e.playing, ended: e.ended, lv, plv: e.perc.lv.slice() };
          const f = e.players[this.focus];
          if (f) {
            f.v.snapshot(this.snap);
            msg.snap = this.snap.slice();
            msg.lip = f.v.y1; msg.g = f.v.g; msg.pm = f.v.pm; msg.fm = f.v.midi; msg.fenv = f.v.env;
            msg.fn = f.v.n; msg.fv = f.v.valve; msg.fsk = f.v.slurKind; msg.fid = f.v.id; msg.finst = f.v.inst;
          }
          this.port.postMessage(msg);
          if (e.ended) e.ended = false;
        }
        return true;
      }
    }
    registerProcessor('brass-processor', BrassProcessor);
  }

  // ---- Web Worker として読み込まれた場合: 調律だけを引き受ける ----------
  if (typeof WorkerGlobalScope !== 'undefined' && typeof self !== 'undefined' && self instanceof WorkerGlobalScope) {
    self.onmessage = (ev) => { if (ev.data && ev.data.type === 'calibrate') self.postMessage({ type: 'cal', table: calibrate(ev.data.sr) }); };
  }

  return { INSTR, BrassVoice, Engine, Percussion, calibrate, calLen, pmOf, fingerOf, BORE, TUNE, measurePeriod, mtof, CAL };
}

if (typeof module !== 'undefined' && module.exports) module.exports = BrassEngineFactory;
