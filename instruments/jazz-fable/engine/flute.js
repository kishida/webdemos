/*
 * Fable Flute — フルートの物理モデル音源（このプロジェクトで作り直したもの）
 *
 * 管   : 両端が開いた管。歌口側と足部（開いた音孔）側の両方で圧力波が位相反転して戻るので、
 *        一往復 = 1 周期で元の符号に戻り、共鳴は f, 2f, 3f, … と全部の倍音に並ぶ。
 *        （以前使っていた音源は「1.5 周期ぶんの管 + 反転 1 回」で、共鳴が奇数倍音にしか無く、
 *          クラリネットやガラス管のような金属的な音になっていた）
 * ジェット: 唇から出た息の帯が歌口のエッジに当たる。管内の音がジェットを横に揺らし、その揺れが
 *        エッジまで運ばれる時間（ジェット遅延 ≒ 半周期）ののち、管の内と外へ交互に吹き込まれる。
 *        吹き込み量は tanh で飽和（ジェットの速度分布）。ジェットがエッジの中心から少しずれている（offset）ので
 *        波形が非対称になり、偶数倍音が生まれる。
 * 損失 : 管壁の粘性と開端からの放射（1 極ローパス）。高い倍音ほど戻らず、外へ出る。
 * 吹き始め: 舌を離すと、まず息の雑音（チフ）が管に入り、管の共鳴がそこから自分の高さの成分を拾って
 *        数十 ms かけて楽音に育つ。最初の一瞬は音程のない「フッ」という音がする。
 * 裏返り: 息を強めるとジェットが速くなり、増幅できる帯域が上へ動く。およそ 4 倍の息圧（ジェットの速さ 2 倍）で
 *        基音を支えられなくなり、オクターブ上の共鳴へ跳ぶ。息が落ち着くと基音に戻る。
 * 吹き終わり: 息が弱まると先に楽音が消え、残った息の雑音が短く尾を引く。音程は動かさない。
 * 奏者 : 息の圧力（音量と明るさ）、タンギング（息を舌で一瞬さえぎる + 息の雑音）、
 *        運指（管長を数 ms で切り替える。滑らせない）、息のビブラート、しゃくり。
 *
 * 自己完結した factory。toString() して AudioWorklet に送り込める。
 */
function fluteEngineFactory() {
  'use strict';
  const PI = Math.PI, N = 2048, M = N - 1;
  // 調律補正 [samples @48k]（tools/flute-test.js tune で実測） [midi, 弱, 中, 強]
  const TUNE = /*TUNE*/[[58,-2.616,-3.06,-3.544],[60,-1.608,-2.04,-2.493],[62,-0.844,-1.245,-1.654],[64,-0.325,-0.653,-0.998],[66,0.147,-0.156,-0.468],[68,0.512,0.232,-0.046],[70,0.763,0.526,0.283],[72,0.996,0.772,0.55],[74,1.157,0.96,0.762],[76,1.29,1.109,0.929],[78,1.396,1.228,1.061],[80,1.473,1.316,1.164],[82,1.51,1.373,1.237],[84,1.552,1.423,1.295],[86,1.564,1.447,1.328],[88,1.441,1.332,1.223],[90,1.248,1.15,1.052],[92,1.08,0.993,0.906],[94,0.922,0.847,0.771],[96,0.778,0.709,0.639],[98,0.65,0.588,0.525],[100,0.539,0.482,0.424]]/*END*/;
  const TV = [0.2, 0.6, 1.0];
  function tuneAt(midi, vel) {
    const v = Math.max(TV[0], Math.min(TV[2], vel)), j = v < TV[1] ? 1 : 2, tv = (v - TV[j - 1]) / (TV[j] - TV[j - 1]);
    const row = r => r[j] + tv * (r[j + 1] - r[j]);
    if (midi <= TUNE[0][0]) return row(TUNE[0]);
    for (let i = 1; i < TUNE.length; i++) if (midi <= TUNE[i][0]) { const t = (midi - TUNE[i - 1][0]) / (TUNE[i][0] - TUNE[i - 1][0]); return row(TUNE[i - 1]) * (1 - t) + row(TUNE[i]) * t; }
    return row(TUNE[TUNE.length - 1]);
  }

  class Flute {
    constructor(fs, opts) {
      opts = opts || {};
      this.fs = fs; this.o = opts;
      this.bore = new Float64Array(N); this.jet = new Float64Array(N); this.wi = 0;
      this.endRefl = opts.endRefl || 0.85;      // 一往復で管に残る割合（管そのものが強い共鳴体で、ジェットは弱い増幅器）
      this.rLo = opts.rLo || 1.5; this.rHi = opts.rHi || 0.6;   // 息の強さ → 発振の閾値に対するジェットの利得の倍率
      this.boost = opts.boost === undefined ? 0.8 : opts.boost;
      this.kick = opts.kick === undefined ? 0 : opts.kick;      // 舌を離した瞬間に管を直接揺らす量。0 = 息の雑音だけを種にして音が育つ（最初は雑音、そこから楽音になる）
      this.kickN = 0; this.kickI = 0; this.kickA = 0;   // 吹き始めの一瞬だけ息を速くして立ち上げる
      this.over = 0; this.overK = 0.999; this.kth = 0.2;
      this.offset = opts.offset === undefined ? 0.9 : opts.offset;   // ジェットのエッジからのずれ（偶数倍音の源）
      this.jetRatio = 0.289;                    // ジェット遅延 ÷ 周期（setPitch で決める。下のフィルタの遅れと合わせて半周期）
      this.jz = 0; this.jA = 0.02; this.jG = 4.1; this.hz = 0; this.hA = 0;
      this.hpK = opts.hpK === undefined ? 0.6 : opts.hpK;   // ジェットが増幅できる下限（ジェットの速さに対する比）
      this.blow = opts.blow || 1;               // 息の強さの倍率（1 = その音をふつうに鳴らす息）
      this.crack = 0; this.crackK = Math.exp(-1 / ((opts.crackT || 0.03) * fs)); this.crackAmt = opts.crackAmt === undefined ? 14 : opts.crackAmt;
      this.lossHz = opts.lossHz || 3200;        // 管の損失 + 放射のカットオフ
      this.calib = opts.calib !== undefined ? opts.calib : null;
      this.lp = 0; this.dcx = 0; this.dcy = 0;
      // 奏者
      this.p = 0; this.pT = 0; this.pUp = 1 - Math.exp(-1 / (0.012 * fs)); this.pDn = 1 - Math.exp(-1 / ((opts.relT || 0.075) * fs)); this.pC = this.pUp;
      this.tg = 1; this.tgC = 1 - Math.exp(-1 / (0.008 * fs));
      this.len = fs / 523; this.lenT = this.len; this.lenC = 1 - Math.exp(-1 / (0.0015 * fs));
      this.bend = 0; this.bendC = 1 - Math.exp(-1 / (0.04 * fs));
      this.vibPhase = 0; this.vibInc = 2 * PI * 5.3 / fs; this.vibAmt = 0; this.vibT = 0; this.vibWait = 0; this.vibC = 1 - Math.exp(-1 / (0.2 * fs));
      this.chiff = 0; this.chiffK = Math.exp(-1 / ((opts.chiffT || 0.04) * fs)); this.chiffAir = opts.chiffAir === undefined ? 0.6 : opts.chiffAir; this.chiffJet = opts.chiffJet === undefined ? 3 : opts.chiffJet; this.noise = 0.05;
      this.nz = 0; this.nz2 = 0; this.seed = 1357;
      this.gain = 0.5; this.gainT = 0.5; this.vel = 0.5; this.lpPole = 0.6;
      this.rx = 0; this.o1 = 0; this.o2 = 0; this.hpx = 0; this.hp = 0; this.outC = 1 - Math.exp(-2 * PI * (opts.outHz || 9000) / fs);
      this.lossK = opts.lossK || 2.6; this.hiAir = opts.hiAir === undefined ? 0.6 : opts.hiAir; this.hiDrift = opts.hiDrift === undefined ? 0.3 : opts.hiDrift; this.hi = 0;
      this.airC = opts.airC || 0.7;
      this.on = false; this.midi = 72; this.level = 0;
      // 息: 一定ではない。吹き始めの押し、伸ばす間のゆるみ、ゆっくりした揺らぎと細かい震え、息そのものの音
      this.push = 0; this.pushK = Math.exp(-1 / (0.06 * fs)); this.ts = 0;
      this.d1 = 0; this.d2 = 0; this.d1A = 2 * PI * 2.2 / fs; this.d2A = 2 * PI * 13 / fs;
      this.drift = opts.drift === undefined ? 1 : opts.drift; this.air = opts.air === undefined ? 1 : opts.air;
      this.pitchK = opts.pitchK === undefined ? 0.5 : opts.pitchK;   // 息の強さ → ジェットの速さ → 音程
      this.an1 = 0; this.an2 = 0; this.bn = 1; this.airBase = opts.airBase === undefined ? 0.04 : opts.airBase; this.airSoft = opts.airSoft === undefined ? 0.05 : opts.airSoft; this.jetNoise = opts.jetNoise === undefined ? 1.5 : opts.jetNoise;
      this.relAir = 0; this.relAirAmt = opts.relAir === undefined ? 0.16 : opts.relAir;
    }
    rnd() { this.seed = (this.seed * 1664525 + 1013904223) >>> 0; return this.seed / 2147483648 - 1; }
    setPitch(midi, vel) {
      const f = 440 * Math.pow(2, (midi - 69) / 12), fs = this.fs;
      // 低い音ほど管が長く、高い倍音まで響く。高い音は損失を上げすぎると鳴らなくなるので f に合わせて上げる
      const fc = Math.max(this.lossHz, f * this.lossK);
      this.hi = Math.max(0, (midi - 72) / 12);     // 高音域ほどジェットが細く速く、息の音と不安定さが増える
      this.lpPole = Math.exp(-2 * PI * fc / fs);
      // この音で発振が始まるジェットの利得（閾値）: 一往復の損失をちょうど埋める量
      const w = 2 * PI * f / fs, pl = this.lpPole, H = (1 - pl) / Math.sqrt(1 - 2 * pl * Math.cos(w) + pl * pl);
      this.kth = 1 / H - this.endRefl;
      // ジェットの横ずれは音の「速度」ではなく「変位」に従う = 速度の積分（漏れのある積分器、角周波数 f/4）。
      // 高い成分ほどジェットを動かせない（利得 ∝ 1/f）ので、2 倍音以上は管の共鳴だけで鳴る
      this.jA = 1 - Math.exp(-2 * PI * (f / 4) / fs);
      // ジェットは速さに見合った高さの揺れしか増幅できない。遅すぎる揺れ（ジェットが通り過ぎる間にほとんど動かない）は
      // 育たない = ハイパス。息を強めてジェットが速くなると、この帯域ごと上へ動き、基音を支えられなくなって
      // 上の倍音（オクターブ上）へ裏返る
      this.hA = 1 - Math.exp(-2 * PI * (this.hpK * f) / fs);
      const lag = Math.atan(4) - Math.atan(this.hpK);                 // 基音でのフィルタの位相遅れ
      this.jetRatio = (PI - lag) / (2 * PI);
      this.jG = Math.sqrt(17) * Math.sqrt(1 + this.hpK * this.hpK);
      this.overK = Math.exp(-1 / (Math.max(0.03, 10 / f) * fs));   // 低い音は立ち上がりに周期数が要るので長めに押す
      this.lenT = fs / f - (this.calib !== null ? this.calib : tuneAt(midi, vel) * fs / 48000);
    }
    // vel 0..1, o: { tongue 0 スラー / 1 軽く / 2 はっきり, scoop cent, vib cent, vibDelay s,
    //               crack 0..1: 強く吹き込みすぎて一瞬オクターブ上に裏返る（息が落ち着くと基音に戻る） }
    noteOn(midi, vel, o) {
      o = o || {};
      const sounding = this.on && this.p > 0.2;
      this.midi = midi; this.vel = vel; this.setPitch(midi, vel);
      if (!sounding) this.len = this.lenT;
      this.on = true; this.relAir = 0;
      this.pT = 1;
      this.gainT = 0.35 + 0.65 * vel;
      // 弱い音はふわっと、強い音はすばやく息が立ち上がる
      this.pC = sounding ? this.pUp : 1 - Math.exp(-1 / ((0.03 - 0.014 * vel) * this.fs));
      const tongue = sounding ? (o.tongue === undefined ? 1 : o.tongue) : 2;
      this.push = tongue === 2 ? 0.14 + 0.12 * vel : tongue === 1 ? 0.07 : 0; this.ts = 0;
      if (tongue === 2) { this.tg = sounding ? 0.25 : 0.6; this.chiff = 0.5 + 0.5 * vel; if (!sounding) { this.over = this.boost; this.kickN = Math.max(8, Math.round(this.lenT)); this.kickI = 0; this.kickA = this.kick * (0.5 + 0.5 * vel); } }
      else if (tongue === 1) { this.tg = 0.5; this.chiff = 0.25; }
      this.crack = o.crack || 0;
      this.bend = -(o.scoop || 0);
      this.vibT = o.vib || 0; this.vibWait = Math.round((o.vibDelay === undefined ? 0.2 : o.vibDelay) * this.fs);
      if (tongue > 0) this.vibAmt *= 0.3;
      this.noise = 0.035 + 0.05 * (1 - vel) + 0.03 * Math.max(0, (72 - midi) / 12);
    }
    // 吹き終わり: 息はすぐには止まらず、だんだん弱まる。発振を保てない強さまで落ちたところで楽音が先に消え、
    // 残りの息が雑音としてわずかに尾を引く（唇がゆるんでジェットが広がり、乱流が増える）
    noteOff() { this.on = false; this.pT = 0; this.vibT = 0; this.pC = this.pDn; this.relAir = 1; }

    tick() {
      // ---- 奏者 ----
      this.tg += (1 - this.tg) * this.tgC;
      this.push *= this.pushK; this.ts++;
      const relax = 1 - 0.05 * (1 - Math.exp(-this.ts / (0.7 * this.fs)));        // 伸ばすと息が少しゆるむ
      this.p += (this.pT * (1 + this.push) * relax * this.tg - this.p) * this.pC;
      const w1 = this.rnd(); this.d1 += (w1 - this.d1) * this.d1A; this.d2 += (w1 - this.d2) * this.d2A;
      this.gain += (this.gainT - this.gain) * 0.001;
      this.len += (this.lenT - this.len) * this.lenC;
      this.bend += (0 - this.bend) * this.bendC;
      if (this.vibWait > 0) this.vibWait--; else this.vibAmt += (this.vibT - this.vibAmt) * this.vibC;
      if (this.vibT === 0) this.vibAmt += (0 - this.vibAmt) * this.vibC;
      this.vibPhase += this.vibInc; if (this.vibPhase > 2 * PI) this.vibPhase -= 2 * PI;
      const vs = Math.sin(this.vibPhase);
      // フルートのビブラートは息の強弱が主で、音程の揺れは小さい
      this.crack *= this.crackK;
      // 裏返りは唇をすぼめてジェットを細く速くする動き。速さは大きく上がるが、吹き込む量はそれほど増えない
      const ck = this.crackAmt * this.crack, pj = 1 + ck, pd = 1 + (ck > 3 ? 0.8 : ck * 0.2667);
      const p = this.p * this.blow * pd * (1 + 0.004 * this.vibAmt * vs) * (1 + this.drift * (1 + this.hiDrift * this.hi) * (3.4 * this.d1 + 0.7 * this.d2));
      // 息が弱い間はジェットが遅く、音程がわずかに低い（吹き始めに下から入る）。吹き終わりは音程を動かさない
      const pjet = p * pj / pd;
      if (this.on) this.bn += ((pjet > 8 ? 8 : pjet < 0.5 ? 0.5 : pjet) - this.bn) * 0.01;
      const speed = Math.sqrt(this.bn);                               // ジェットの速さ ∝ √息の圧力
      const cents = this.bend + 0.45 * this.vibAmt * vs;
      const total = this.len * (1 - cents * 0.00057762);
      // 強く吹くとジェットが速くなり、エッジまでの時間が縮む
      const jd = total * this.jetRatio * (1.06 - 0.1 * this.vel) / speed;

      // ---- 管を一往復して戻ってきた波 ----
      const wi = this.wi, bore = this.bore, jet = this.jet;
      let q = wi - total, i0 = Math.floor(q), fr = q - i0;
      const x = bore[i0 & M] * (1 - fr) + bore[(i0 + 1) & M] * fr;
      this.lp = (1 - this.lpPole) * x + this.lpPole * this.lp;                 // 損失（高い倍音は戻らない）
      const y = this.lp - this.dcx + 0.995 * this.dcy; this.dcx = this.lp; this.dcy = y;   // 定常流は音にならない
      const temp = y;

      // ---- ジェット ----
      const wn = this.rnd(); this.nz += (wn - this.nz) * 0.4; this.nz2 += (this.nz - this.nz2) * 0.03;
      const turb = this.nz - this.nz2;
      this.chiff *= this.chiffK;
      const breathNoise = p * (this.jetNoise * this.noise + this.chiffJet * this.chiff) * turb;
      // 息そのものの音（歌口で管に入らず外へ出る乱流）。音が鳴り出す前から聞こえ、弱い音ほど目立つ
      this.an1 += (wn - this.an1) * this.airC; this.an2 += (this.an1 - this.an2) * 0.14;
      const air = (this.an1 - this.an2) * this.air * (1 + this.hiAir * this.hi) * p * (this.relAir ? 1 : Math.sqrt(p)) * (this.airBase + this.airSoft * (1 - this.vel) + this.chiffAir * this.chiff + this.relAirAmt * this.relAir);
      jet[wi & M] = -temp + breathNoise;
      q = wi - jd; i0 = Math.floor(q); fr = q - i0;
      const ja = this.jA * speed, ha = this.hA * speed;
      this.jz += (jet[i0 & M] * (1 - fr) + jet[(i0 + 1) & M] * fr - this.jz) * (ja > 0.9 ? 0.9 : ja);
      this.hz += (this.jz - this.hz) * (ha > 0.9 ? 0.9 : ha);
      const eta = (this.jz - this.hz) * this.jG;                               // エッジでのジェットの横ずれ
      // 吹き込み量。小さな揺れに対する利得を「閾値 × 倍率」に合わせる。倍率が大きいほど深く飽和して明るく大きくなる
      this.over *= this.overK;
      const y0 = this.offset, t0 = Math.tanh(y0), Rr = p * (this.rLo + this.rHi * this.vel + this.over), R = Rr > 2.6 ? 2.6 : Rr;
      const drive = R * this.kth / (1 - t0 * t0) * (Math.tanh(eta + y0) - t0);
      let kick = 0;
      if (this.kickI < this.kickN) { kick = this.kickA * Math.sin(2 * PI * this.kickI / this.kickN); this.kickI++; }
      bore[wi & M] = drive + this.endRefl * temp + kick;
      this.wi = wi + 1;

      // ---- 放射: 歌口と開いた音孔から。流量の時間変化が音になる（低域は弱く、高域は素通し）----
      const rad = x - this.rx * 0.82; this.rx = x;
      let o = rad;
      this.o1 += (o - this.o1) * this.outC; this.o2 += (this.o1 - this.o2) * this.outC; o = this.o2;
      const h = o - this.hpx + 0.996 * this.hp; this.hpx = o; this.hp = h;
      const out = (h * 0.5 + air) * this.gain;
      const a = out < 0 ? -out : out; this.level = a > this.level ? a : this.level * 0.9995;
      return out;
    }
  }
  return Flute;
}

if (typeof module !== 'undefined' && module.exports) module.exports = { fluteEngineFactory };
