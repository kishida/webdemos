/*
 * ホスト: ピアノと歌声の 2 つの物理モデルを 1 本の時間軸で鳴らすシーケンサ兼ミキサー。
 * AudioWorklet の中でも Node（WAV 書き出し）でも同じコードが動く。自己完結（toString して送れる）。
 */
function hostFactory() {
  'use strict';
  class Host {
    constructor(Piano, Voice, fs, post) {
      this.fs = fs; this.post = post || (() => {});
      this.Voice = Voice; this.piano = new Piano(fs); this.voice = new Voice(fs);
      this.piano.setParam('reverbMix', 0.26);
      this.pianoVol = 1.5; this.voiceVol = 1.0; this.vibScale = 1; this.breathScale = 1;
      this.ev = []; this.ei = 0; this.t = 0; this.playing = false; this.dur = 0;
      this.pl = new Float32Array(128); this.pr = new Float32Array(128); this.vl = new Float32Array(128); this.vr = new Float32Array(128);
      this.sinceSnap = 0; this.snapEvery = Math.round(fs / 40);
      this.free = null;
    }
    msg(d) {
      const v = this.voice, p = this.piano;
      switch (d.type) {
        case 'voice': this.playing = false; p.allOff(true); this.voice = new this.Voice(this.fs, { type: d.kind }); break; // 歌い手を替える（体の寸法が変わる）
        case 'load': this.ev = d.events; this.dur = d.dur; break;
        case 'play': this.seek(d.t || 0); this.playing = true; break;
        case 'seek': if (!this.playing) this.seek(d.t || 0); break; // 停止中に再生位置だけ動かす（音は出さない）
        case 'stop': this.playing = false; p.allOff(false); v.ramp('ps', 0, 0.15); v.ramp('vib', 0, 0.1); for (const q of ['lab', 'alv', 'pal', 'vel']) v.release(q, 0.05); v.ramp('velum', 0, 0.05); v.ramp('abd', 0.05e-4, 0.05); break;
        case 'param': if (d.name in this) this[d.name] = d.value; else if (d.target === 'voice') v[d.name] = d.value; break;
        // 自由演奏: 母音と音高を直接指定
        case 'breath': v.ramp('breath', 0.01e-4 * d.value, 0.1); v.aspGain = 0.012 * (0.5 + 0.5 * d.value); break;
        case 'sing': v.setVowel(d.vowel, 0.08, d.midi); v.ramp('pitch', d.midi, 0.06); v.ramp('ps', d.ps || 950, 0.06); v.ramp('vib', 30 * this.vibScale, 0.6); break;
        case 'hush': v.ramp('ps', 0, 0.15); v.ramp('vib', 0, 0.1); break;
        case 'pianoOn': p.noteOn(d.m, d.v); break;
        case 'pianoOff': p.noteOff(d.m); break;
      }
    }
    seek(t) {
      this.piano.allOff(true); this.voice.reset(); this.t = t; this.ei = 0;
      while (this.ei < this.ev.length && this.ev[this.ei][0] < t) this.ei++;
    }
    fire(e) {
      const v = this.voice, p = this.piano;
      switch (e[1]) {
        case 0: p.noteOff(e[2]); break;
        case 1: p.noteOn(e[2], e[3]); break;
        case 2: p.pedal(false); break;
        case 3: p.pedal(true); break;
        case 10: v.ramp(e[2], e[2] === 'vib' ? e[3] * this.vibScale : e[2] === 'breath' ? e[3] * this.breathScale : e[3], e[4]); break;
        case 11: v.setVowel(e[2], e[3], e[4]); break;
        case 12: v.constrict(e[2], e[3], e[4]); break;
        case 13: v.release(e[2], e[3]); break;
      }
    }
    // L, R (Float32Array) の [0, n) を埋める。V があれば歌だけの信号も書く（スペクトル表示用）
    process(L, R, n, V) {
      let i = 0;
      while (i < n) {
        let c = Math.min(128, n - i);
        if (this.playing) {
          const ev = this.ev;
          while (this.ei < ev.length && ev[this.ei][0] <= this.t) this.fire(ev[this.ei++]);
          if (this.ei < ev.length) c = Math.max(1, Math.min(c, Math.ceil((ev[this.ei][0] - this.t) * this.fs)));
        }
        this.piano.process(this.pl, this.pr, 0, c); this.voice.process(this.vl, this.vr, 0, c);
        const pv = this.pianoVol, vv = this.voiceVol;
        for (let k = 0; k < c; k++) {
          let l = this.pl[k] * pv + this.vl[k] * vv, r = this.pr[k] * pv + this.vr[k] * vv;
          if (l > 0.8 || l < -0.8) l = (l < 0 ? -1 : 1) * (0.8 + 0.2 * Math.tanh((Math.abs(l) - 0.8) / 0.2));
          if (r > 0.8 || r < -0.8) r = (r < 0 ? -1 : 1) * (0.8 + 0.2 * Math.tanh((Math.abs(r) - 0.8) / 0.2));
          L[i + k] = l; R[i + k] = r; if (V) V[i + k] = this.vl[k];
        }
        i += c;
        if (this.playing) { this.t += c / this.fs; if (this.t > this.dur) { this.playing = false; this.post({ type: 'end' }); } }
        if ((this.sinceSnap += c) >= this.snapEvery) { this.sinceSnap = 0; const s = this.voice.snapshot(512); s.type = 'snap'; s.t = this.t; s.playing = this.playing; this.post(s); }
      }
    }
  }
  return Host;
}
if (typeof module !== 'undefined' && module.exports) module.exports = { hostFactory };
