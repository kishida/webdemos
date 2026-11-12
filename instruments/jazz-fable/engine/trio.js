/*
 * トリオの演奏エンジン: 3 つの物理モデル音源（リード / ピアノ / ベース）を 1 本のタイムラインで鳴らしてミックスする。
 * リードはサックス / トランペット / フルートから選べ、演奏中でも差し替えられる（engine/lead.js）。
 * AudioWorklet とオフラインレンダラ（node）の両方から同じコードを使う。自己完結した factory。
 *
 * イベント: [t(秒), 楽器, 種別, ...]
 *   リード   0: [t,0,1,midi,vel,tongue,scoop,vib,vibDelay,growl] 発音 / [t,0,0,fall] 息を止める
 *   ピアノ   1: [t,1,1,midi,vel] 打鍵 / [t,1,0,midi] 離鍵 / [t,1,2,down] ペダル
 *   ベース   2: [t,2,1,midi,vel,flags(1 ゴースト, 2 スライド),slideFrom] / [t,2,0] 消音
 */
function trioFactory() {
  'use strict';
  class Trio {
    constructor(Piano, Leads, Bass, fs, leadName) {
      this.fs = fs;
      this.piano = new Piano(fs, { maxVoices: 32 });
      this.piano.setParam('reverbT60', 1.3); this.piano.reverbMix = 0.13; this.piano.master = 0.018; this.piano.brightness = 0.45;
      this.Leads = Leads; this.leads = {}; this.lead = null; this.old = null; this.oldN = 0; this.bass = new Bass(fs);
      this.ev = []; this.idx = 0; this.pos = 0; this.end = 0; this.playing = false; this.ended = false;
      this.pl = new Float32Array(128); this.pr = new Float32Array(128);
      this.gain = [1, 0.9, 2.3];              // リード（楽器ごとの補正は INFO.gain）/ ピアノ / ベース
      this.mute = [false, false, false];
      const pan = p => { const a = (p + 1) * Math.PI / 4; return [Math.cos(a) * 1.414, Math.sin(a) * 1.414]; };
      this.pan = pan; this.bPan = pan(0.2);
      this.send = [0.32, 0.07];
      this.setLead(leadName || 'sax');
      // 小さなクラブの残響（サックスとベース用。ピアノは自前の響板 + 残響を持つ）
      const lens = [1031, 1327, 1523, 1801, 2089, 2351, 2713, 3089].map(l => Math.max(8, Math.round(l * fs / 48000)));
      this.rvLen = lens; this.rvBuf = lens.map(l => new Float64Array(l)); this.rvIdx = new Int32Array(8); this.rvLp = new Float64Array(8); this.rvO = new Float64Array(8);
      this.rvG = lens.map(l => Math.pow(10, -3 * l / (fs * 1.25)));
      this.pdN = Math.round(0.011 * fs); this.pd = new Float64Array(this.pdN); this.pdI = 0;
      this.pLevel = 0; this.peak = 0;
    }
    // リードの差し替え。前の楽器は息を止めて、余韻だけ鳴らし切る
    // events を渡すと譜面も入れ替える（リードごとに譜面が違う）。再生位置はそのまま
    setLead(name, events) {
      if (!this.Leads.INFO[name]) name = 'sax';
      if (events) { this.ev = this.conv(events); let k = 0; while (k < this.ev.length && this.ev[k][0] < this.pos) k++; this.idx = k; }
      if (this.lead && this.leadName === name) return;
      if (this.lead) { this.lead.noteOff(); this.old = this.lead; this.oldInfo = this.info; this.oldN = Math.round(this.fs * 0.8); }
      if (!this.leads[name]) this.leads[name] = this.Leads.make(name, this.fs);
      this.lead = this.leads[name]; this.leadName = name; this.info = this.Leads.INFO[name];
      if (this.old === this.lead) this.oldN = 0;
      this.sPan = this.pan(this.info.pan); this.send[0] = this.info.send;
    }
    conv(events) { return events.map(e => { const c = e.slice(); c[0] = Math.round(c[0] * this.fs); return c; }); }
    load(events, duration) { this.ev = this.conv(events); this.end = Math.round(duration * this.fs); this.seek(0); }
    silence() { this.lead.noteOff(); this.bass.noteOff(); for (const v of this.bass.voices) if (v.active) v.damp(0.05); this.piano.allOff(false); }
    seek(t) {
      this.pos = Math.max(0, Math.round(t * this.fs)); this.ended = false; this.silence();
      let k = 0; while (k < this.ev.length && this.ev[k][0] < this.pos) k++; this.idx = k;
    }
    play() { if (this.ended) this.seek(0); this.playing = true; }
    pause() { this.playing = false; this.silence(); }
    dispatch(e) {
      const i = e[1], k = e[2];
      if (i === 0) { if (k === 1) this.lead.noteOn(e[3] + this.info.shift, e[4], { tongue: e[5], scoop: e[6], vib: e[7], vibDelay: e[8], growl: e[9], crack: e[10] || 0 }); else this.lead.noteOff(!!e[3]); }
      else if (i === 1) { if (k === 1) this.piano.noteOn(e[3], e[4]); else if (k === 0) this.piano.noteOff(e[3]); else this.piano.pedal(!!e[3]); }
      else { if (k === 1) this.bass.noteOn(e[3], e[4], { dead: !!(e[5] & 1), slide: !!(e[5] & 2), slideFrom: e[6] || 0, vib: e[7] || 0 }); else this.bass.noteOff(); }
    }
    // L/R: Float32Array を n サンプル埋める。イベントはサンプル精度で処理
    process(L, R, n) {
      let off = 0; const ev = this.ev;
      while (off < n) {
        let cnt = Math.min(128, n - off);
        if (this.playing) {
          while (this.idx < ev.length && ev[this.idx][0] <= this.pos) this.dispatch(ev[this.idx++]);
          if (this.idx < ev.length) cnt = Math.min(cnt, Math.max(1, ev[this.idx][0] - this.pos));
        }
        this.render(L, R, off, cnt);
        off += cnt;
        if (this.playing) { this.pos += cnt; if (this.pos >= this.end) { this.playing = false; this.ended = true; this.silence(); } }
      }
    }
    render(L, R, off, cnt) {
      const pl = this.pl, pr = this.pr, lead = this.lead, old = this.oldN > 0 ? this.old : null, bass = this.bass, g = this.gain, mute = this.mute;
      this.piano.process(pl, pr, 0, cnt);
      const gs = mute[0] ? 0 : g[0] * this.info.gain, go = old ? (mute[0] ? 0 : g[0] * this.oldInfo.gain) : 0, gp = mute[1] ? 0 : g[1], gb = mute[2] ? 0 : g[2];
      const sL = this.sPan[0], sR = this.sPan[1], bL = this.bPan[0], bR = this.bPan[1];
      const buf = this.rvBuf, idx = this.rvIdx, len = this.rvLen, lp = this.rvLp, o = this.rvO, rg = this.rvG, pd = this.pd, pdN = this.pdN;
      let pk = this.peak, plv = this.pLevel;
      for (let i = 0; i < cnt; i++) {
        const s = lead.tick() * gs + (old ? old.tick() * go : 0), b = bass.tick() * gb;
        const pL = pl[i] * gp, pR = pr[i] * gp;
        const a = pL < 0 ? -pL : pL; plv = a > plv ? a : plv * 0.9996;
        // 残響
        const pi = this.pdI, rin = pd[pi]; pd[pi] = s * this.send[0] + b * this.send[1]; this.pdI = pi + 1 >= pdN ? 0 : pi + 1;
        let sum = 0, vL = 0, vR = 0;
        for (let k = 0; k < 8; k++) {
          const x = buf[k][idx[k]]; const l = lp[k] = x + (lp[k] - x) * 0.38; const v = l * rg[k];
          o[k] = v; sum += v; if (k & 1) vR += (k & 2) ? -x : x; else vL += (k & 2) ? -x : x;
        }
        sum *= 0.25;
        for (let k = 0; k < 8; k++) { buf[k][idx[k]] = o[k] - sum + ((k & 1) ? rin : -rin) * 0.5 + 1e-24; if (++idx[k] >= len[k]) idx[k] = 0; }
        let l = s * sL * 0.5 + b * bL * 0.5 + pL + vL * 0.5, r = s * sR * 0.5 + b * bR * 0.5 + pR + vR * 0.5;
        // ソフトリミッタ
        const al = l < 0 ? -l : l, ar = r < 0 ? -r : r;
        if (al > 0.7) l = (l < 0 ? -1 : 1) * (0.7 + 0.3 * Math.tanh((al - 0.7) / 0.3));
        if (ar > 0.7) r = (r < 0 ? -1 : 1) * (0.7 + 0.3 * Math.tanh((ar - 0.7) / 0.3));
        if (al > pk) pk = al; if (ar > pk) pk = ar;
        L[off + i] = l; R[off + i] = r;
      }
      this.peak = pk; this.pLevel = plv; if (old) this.oldN -= cnt;
    }
    levels() { return [this.lead.level * this.gain[0] * this.info.gain, this.pLevel, this.bass.level * this.gain[2]]; }
  }
  return Trio;
}

if (typeof module !== 'undefined' && module.exports) module.exports = { trioFactory };
