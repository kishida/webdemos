/*
 * リード楽器の差し替え口。サックス / トランペット / フルートを同じ操作で鳴らせるようにする。
 *
 *   noteOn(midi, vel 0..1, { tongue 0 スラー / 1 軽く / 2 はっきり, scoop cent, vib cent, vibDelay s, growl 0..1 })
 *   noteOff(fall)   tick() → 1 サンプル   level
 *
 * 各音源の中身（物理モデル）には手を入れず、奏法の指示をそれぞれの音源の言葉に訳すだけ。
 *   sax     … engine/sax.js（このプロジェクト）
 *   trumpet … trumpet-fable の BrassVoice（唇バルブ + 管 + ベル）
 *   flute   … engine/flute.js（このプロジェクトで作り直した、両端が開いた管 + ジェット）
 * 楽譜は score.js が楽器ごとに別のものを用意する（音域・奏法が違うため）。
 */
function leadsFactory(Sax, Brass, Flute, cal) {
  'use strict';
  const PI = Math.PI;
  const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

  const INFO = {
    sax:     { label: 'Tenor Sax', desc: 'リード弁 + 円錐管の導波路', shift: 0,  gain: 0.72, pan: -0.22, send: 0.32 },
    trumpet: { label: 'Trumpet',   desc: '唇バルブ + 管 + ベル（trumpet-fable）', shift: 0, gain: 2.4, pan: -0.22, send: 0.3 },
    flute:   { label: 'Flute',     desc: 'ジェット + 両端が開いた管の導波路', shift: 0, gain: 0.66, pan: -0.22, send: 0.36 },
  };

  // ---------------------------------------------------------------- トランペット
  class TrumpetLead {
    constructor(fs) {
      if (!Brass.CAL[fs]) {
        if (cal && cal.sr === fs) {   // 事前計算した管長表を使う
          const t = cal.t.map(row => { const a = new Float32Array(128); row.forEach((v, k) => { a[cal.lo + k] = v; }); return a; });
          Brass.CAL[fs] = { trumpet: t };
        } else {                      // サンプルレートが違えばその場で合わせ込む（トランペットだけ）
          const I = Brass.INSTR.trumpet, t = [0, 1, 2].map(() => new Float32Array(128));
          for (let m = I.lo; m <= I.hi; m++) { let g = 0; [0.4, 0.7, 1.0].forEach((v, k) => { g = Brass.calLen(fs, 'trumpet', m, v, g); t[k][m] = g; }); }
          Brass.CAL[fs] = { trumpet: t };
        }
      }
      this.fs = fs; this.v = new Brass.BrassVoice(fs, 'trumpet', 4242); this.id = 0;
      this.bend = 0; this.bendT = 0; this.bendC = 0; this.growl = 0; this.growlT = 0; this.gp = 0; this.level = 0;
      // スラーの吹き方: 唇を次の音の構えへすばやく切り替え（2 ms）、息を一瞬押して吹き抜く。
      // 音源の既定（唇を 8 ms かけて動かす）だと、上行のスラーで発振が 40 ms ほど途切れて「息を止めた」ように聞こえる
      this.slurGlide = 0; this.slurLip = 0.002; this.slurOver = null; this.slurPush = 0.3; this.spush = 0; this.spushK = Math.exp(-1 / (0.05 * fs));
      this.dip = 0; this.dipK = Math.exp(-1 / (0.008 * fs)); this.lp = 0; this.lpA = 1 - Math.exp(-2 * PI * 11000 / fs);
      this.lo = Brass.INSTR.trumpet.lo; this.hi = Brass.INSTR.trumpet.hi;
    }
    noteOn(midi, vel, o) {
      o = o || {};
      while (midi < this.lo) midi += 12; while (midi > this.hi) midi -= 12;
      const v = this.v;
      v.detune = 1; this.bend = 0; this.bendT = 0;
      v.vibScale = (o.vib || 0) / 6;                        // 音源のビブラートは ±6 セント相当
      // 軽いタンギングは息を切らずに舌で一瞬だけ流れを弱める（音源のタンギングは唇を弾く種を入れるので、
      // 鳴っている最中に使うと戻ってきた波が尖ってクリックになる）
      const soft = o.tongue === 1 && v.gate, wasOn = v.gate;
      v.noteOn(midi, 0.3 + 0.62 * vel, o.tongue === 0 || soft, ++this.id);
      if (soft) this.dip = 1;
      if ((o.tongue === 0 || soft) && wasOn) {   // スラー: 音源の切り替え方を奏者側から調整する
        if (this.slurGlide) v.glide = 1 - Math.exp(-1 / (this.slurGlide * this.fs));
        if (this.slurLip) v.lipK = 1 - Math.exp(-v.ctlStep / (this.slurLip * this.fs));
        if (this.slurOver !== undefined && this.slurOver !== null) v.lipOver = this.slurOver * (v.fLipT > v.fLip ? 1 : -1);
        this.spush = this.slurPush || 0;
      }
      if (o.scoop) { this.bend = -o.scoop * 0.8; this.bendT = 0; this.bendC = 1 - Math.exp(-1 / (0.05 * this.fs)); }
      this.growlT = o.growl || 0;
    }
    noteOff(fall) {
      this.v.noteOff(-1); this.growlT = 0;
      if (fall) { this.bendT = -260; this.bendC = 1 - Math.exp(-1 / (0.12 * this.fs)); }
    }
    tick() {
      const v = this.v;
      if (this.bend !== this.bendT) { this.bend += (this.bendT - this.bend) * this.bendC; if (Math.abs(this.bend - this.bendT) < 0.05) this.bend = this.bendT; v.detune = Math.pow(2, this.bend / 1200); }
      this.growl += (this.growlT - this.growl) * 0.001;
      let ps = 1;
      if (this.growl > 0.001) { this.gp += 2 * PI * 71 / this.fs; ps = 1 + 0.22 * this.growl * Math.sin(this.gp + 1.3 * Math.sin(this.gp * 0.37)); }
      if (this.dip > 1e-3) { this.dip *= this.dipK; ps *= 1 - 0.3 * this.dip; }
      if (this.spush > 1e-3) { this.spush *= this.spushK; ps *= 1 + this.spush; }
      v.pScale = ps;
      // 音源単体では最後に tanh で丸めていた。タンギングの瞬間に 1 サンプルだけ尖る波が出るので、
      // ここでも高域を少し丸めてから柔らかく頭を抑える（ふだんの音量には効かない）
      this.lp += (v.tick() * 0.10 - this.lp) * this.lpA;
      let out = this.lp; const ab = out < 0 ? -out : out;
      if (ab > 0.6) out = (out < 0 ? -1 : 1) * (0.6 + 0.4 * Math.tanh((ab - 0.6) / 0.4));
      const a = out < 0 ? -out : out; this.level = a > this.level ? a : this.level * 0.9995;
      return out;
    }
  }

  return {
    INFO,
    names: Object.keys(INFO),
    make(name, fs) {
      if (name === 'trumpet') return new TrumpetLead(fs);
      if (name === 'flute') return new Flute(fs);
      return new Sax(fs);
    },
  };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { leadsFactory };
