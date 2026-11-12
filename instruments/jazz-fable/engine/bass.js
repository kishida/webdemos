/*
 * Fable Bass — ウッドベース（コントラバスのピチカート）の物理モデル音源
 *
 * mozart-fable の擦弦モデル（弓の接点で二分した双方向デジタル・ウェーブガイド + 駒の損失 + 胴の共鳴モード）を
 * コントラバスの寸法に置き換え、指で弾く奏法に絞ったもの。
 *   弦   … 撥弦点で二分した 2 本の遅延線（ナット側 / 駒側）、速度波
 *   指   … 指の腹が弦を引いて放す = 幅のある力のパルス。強く弾くほど鋭い
 *   駒   … 周波数依存の損失（1 極ローパス）。高い倍音ほど早く消える
 *   左手 … 音を止めるときは指を浮かせて弦を消音。スライド / ハンマリングは弦長だけを変える
 *   胴   … 空気共鳴 A0 と表板のモードの並列共振器
 */
function bassEngineFactory() {
  'use strict';
  const PI = Math.PI, N = 4096, M = N - 1;
  const MODES = [[61, 7, 1.0], [98, 10, 1.1], [112, 9, 0.6], [152, 9, 0.8], [196, 8, 0.6], [262, 7, 0.55], [390, 5, 0.45], [640, 3.5, 0.4], [1050, 2.5, 0.32], [1900, 2, 0.2]];
  const TUNE_C = -0.18;

  class StringVoice {
    constructor(fs) {
      this.fs = fs; this.nb = new Float64Array(N); this.bb = new Float64Array(N); this.wi = 0;
      this.active = false; this.y1 = 0; this.pole = 0.7; this.g = 0.999; this.gT = 0.999;
      this.base = 400; this.baseT = 400; this.slide = 0.004; this.beta = 0.2;
      this.pluckN = 0; this.pluckI = 0; this.pluckAmp = 0; this.quiet = 0; this.midi = 0; this.age = 0;
      this.vibPhase = 0; this.vibAmt = 0; this.vibT = 0;
    }
    lenFor(f) { return this.fs / f - this.pole / (1 - this.pole) - TUNE_C; }
    gFor(f, t60) { return Math.exp(-6.91 / (f * t60)); }
    pluck(midi, vel, o) {
      const f = 440 * Math.pow(2, (midi - 69) / 12), fs = this.fs;
      this.nb.fill(0); this.bb.fill(0); this.y1 = 0;
      this.midi = midi; this.active = true; this.quiet = 0; this.age = 0;
      this.pole = Math.max(0.3, 0.70 - 0.14 * vel - 0.2 * (midi - 28) / 30);
      // 低い開放寄りの音は長く、ハイポジションは短く
      const t60 = o.dead ? 0.12 : 7 * Math.pow(0.5, (midi - 28) / 22);
      this.f = f; this.g = this.gT = this.gFor(f, t60);
      this.base = this.baseT = this.lenFor(f);
      if (o.slideFrom) this.base = this.lenFor(440 * Math.pow(2, (o.slideFrom - 69) / 12));
      this.slide = 1 - Math.exp(-1 / (0.03 * fs));
      this.beta = 0.19 + 0.05 * vel;                 // 指板の端あたり。強く弾くときほど駒寄り
      const w = (0.0032 - 0.0019 * vel) * fs * Math.pow(0.5, (midi - 28) / 40);        // 指が弦を放すまでの時間
      this.pluckN = Math.max(24, Math.round(w)); this.pluckI = 0;
      this.pluckAmp = (0.15 + 0.85 * vel * vel) * (o.dead ? 0.7 : 1) * 60 / this.pluckN * Math.pow(f / 55, 0.3);
      this.vibT = o.vib || 0; this.vibAmt = 0;
    }
    // スライド / ハンマリング: 弾き直さずに音高だけ変える
    retune(midi, glide) {
      const f = 440 * Math.pow(2, (midi - 69) / 12);
      this.midi = midi; this.f = f; this.baseT = this.lenFor(f);
      this.slide = 1 - Math.exp(-1 / ((glide || 0.02) * this.fs));
      this.g = Math.min(this.g, this.gFor(f, 1.6)); this.gT = this.g;
    }
    damp(t60) { this.gT = this.gFor(this.f, t60 || 0.07); }
    tick() {
      this.g += (this.gT - this.g) * 0.003;
      this.base += (this.baseT - this.base) * this.slide;
      let total = this.base;
      if (this.vibT) { this.vibAmt += (this.vibT - this.vibAmt) * 0.00008; this.vibPhase += 2 * PI * 5.2 / this.fs; total *= 1 + this.vibAmt * Math.sin(this.vibPhase); }
      const bL = Math.max(1.5, total * this.beta), nL = total - bL;
      const wi = this.wi, nb = this.nb, bb = this.bb;
      let p = wi - nL, i0 = Math.floor(p), fr = p - i0;
      const readN = nb[i0 & M] * (1 - fr) + nb[(i0 + 1) & M] * fr;
      p = wi - bL; i0 = Math.floor(p); fr = p - i0;
      const readB = bb[i0 & M] * (1 - fr) + bb[(i0 + 1) & M] * fr;
      this.y1 = this.g * (1 - this.pole) * readB + this.pole * this.y1;   // 駒での損失
      const bridgeRefl = -this.y1, nutRefl = -readN;
      let v = 0;
      if (this.pluckI < this.pluckN) { v = this.pluckAmp * 0.5 * (1 - Math.cos(2 * PI * this.pluckI / this.pluckN)); this.pluckI++; }
      nb[wi & M] = bridgeRefl + v; bb[wi & M] = nutRefl + v; this.wi = wi + 1;
      const a = this.y1 < 0 ? -this.y1 : this.y1;
      if (a < 1e-6 && this.pluckI >= this.pluckN) { if (++this.quiet > 4000) this.active = false; } else this.quiet = 0;
      this.age++;
      return this.y1;
    }
  }

  class Bass {
    constructor(fs) {
      this.fs = fs; this.voices = [new StringVoice(fs), new StringVoice(fs), new StringVoice(fs)]; this.cur = null;
      const n = MODES.length; this.n = n;
      this.b0 = new Float64Array(n); this.a1 = new Float64Array(n); this.a2 = new Float64Array(n);
      this.z1 = new Float64Array(n); this.z2 = new Float64Array(n); this.mg = new Float64Array(n);
      MODES.forEach(([f, q, g], k) => {
        const w = 2 * PI * f / fs, al = Math.sin(w) / (2 * q), a0 = 1 + al;
        this.b0[k] = al / a0; this.a1[k] = -2 * Math.cos(w) / a0; this.a2[k] = (1 - al) / a0; this.mg[k] = g;
      });
      this.lp = 0; this.lpa = 1 - Math.exp(-2 * PI * 3200 / fs); this.dcx = 0; this.dcy = 0; this.level = 0;
      this.int = 0; this.gain = 0.5; this.dry = 0.75;
    }
    // vel 0..1, o: { dead: ゴーストノート, slide: 前の音から弾き直さずつなぐ, slideFrom: 下からずり上げる, vib }
    noteOn(midi, vel, o) {
      o = o || {};
      if (o.slide && this.cur && this.cur.active) { this.cur.retune(midi, o.glide); return; }
      for (const v of this.voices) if (v.active) v.damp(0.06);         // 前の音は指を浮かせて止める
      let v = null;
      for (const c of this.voices) if (!c.active) { v = c; break; }
      if (!v) { for (const c of this.voices) if (!v || c.age > v.age) v = c; }
      v.pluck(midi, vel, o); this.cur = v;
    }
    noteOff() { if (this.cur) this.cur.damp(0.09); }
    tick() {
      let x = 1e-20; const vs = this.voices;
      for (let i = 0; i < vs.length; i++) if (vs[i].active) x += vs[i].tick();
      // 駒にかかる力は速度波を積分したもの（漏れのある積分）。撥弦の 1/n スペクトルになる
      this.int = this.int * 0.9985 + x; const f = this.int * 0.02;
      let y = this.dry * f;
      const b0 = this.b0, a1 = this.a1, a2 = this.a2, z1 = this.z1, z2 = this.z2, mg = this.mg;
      for (let k = 0; k < this.n; k++) { const o = b0[k] * f + z1[k]; z1[k] = z2[k] - a1[k] * o; z2[k] = -b0[k] * f - a2[k] * o; y += mg[k] * o; }
      this.lp += this.lpa * (y - this.lp);
      const o = this.lp - this.dcx + 0.9985 * this.dcy; this.dcx = this.lp; this.dcy = o;
      const out = o * this.gain, a = out < 0 ? -out : out; this.level = a > this.level ? a : this.level * 0.9996;
      return out;
    }
  }
  return Bass;
}

if (typeof module !== 'undefined' && module.exports) module.exports = { bassEngineFactory };
