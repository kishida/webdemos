// file:// (opaque origin) で AudioWorklet のモジュール読み込みが失敗する環境用のフォールバック。
// fm-worklet.js と同じ 4 オペレータ FM DSP を ScriptProcessorNode でメインスレッドに置き、
// FM.init が worklet 読み込みに失敗した場合だけ有効化する。公開 API（FM.*）はそのまま使える。
'use strict';
(() => {
  const TWO_PI = Math.PI * 2;

  class Op { constructor() { this.phase = 0; this.env = 0; this.stage = 4; this.out = 0; } }
  class Voice {
    constructor() {
      this.ops = [new Op(), new Op(), new Op(), new Op()];
      this.active = false; this.patch = null; this.fb1 = 0; this.fb2 = 0;
      this.freq = 440; this.age = 0; this.offAt = 0; this.released = false;
    }
  }

  class FMDSP {
    constructor(voices, sampleRate) {
      this.voices = [];
      for (let i = 0; i < voices; i++) this.voices.push(new Voice());
      this.patches = {};
      this.queue = [];
      this.frame = 0;
      this.lfoPhase = 0;
      this.sampleRate = sampleRate;
    }
    onMessage(m) {
      if (m.type === 'patches') Object.assign(this.patches, m.patches);
      else if (m.type === 'note') this.insertEvent(m);
      else if (m.type === 'stop') { this.queue.length = 0; for (const v of this.voices) this.release(v); }
      else if (m.type === 'hush') { this.queue.length = 0; for (const v of this.voices) v.active = false; }
    }
    insertEvent(m) {
      m.f = Math.max(0, Math.round(m.t * this.sampleRate));
      const q = this.queue;
      let i = q.length;
      while (i > 0 && q[i - 1].f > m.f) i--;
      q.splice(i, 0, m);
    }
    allocVoice() {
      let best = null, bestScore = -1;
      for (const v of this.voices) {
        if (!v.active) return v;
        const score = (v.released ? 1e9 : 0) + v.age;
        if (score > bestScore) { bestScore = score; best = v; }
      }
      return best;
    }
    start(m) {
      const p = this.patches[m.patch];
      if (!p) return;
      const sr = this.sampleRate;
      const v = this.allocVoice();
      v.active = true; v.released = false; v.patch = p; v.age = 0;
      v.freq = m.freq; v.vel = m.vel == null ? 1 : m.vel;
      v.offAt = this.frame + Math.max(1, Math.round((m.dur || 0.1) * sr));
      v.pan = m.pan || 0;
      v.gl = v.pan <= 0 ? 1 : 1 - v.pan; v.gr = v.pan >= 0 ? 1 : 1 + v.pan;
      v.sweepMul = m.sweep ? Math.pow(m.sweep, 1 / Math.max(1, v.offAt - this.frame)) : 1;
      v.fb1 = v.fb2 = 0;
      for (let i = 0; i < 4; i++) {
        const o = v.ops[i], op = p.ops[i];
        o.stage = 0; o.phase = p.resetPhase === false ? o.phase : 0;
        o.ar = Math.max(1, op.ar * sr); o.dr = Math.max(1, op.dr * sr);
        o.rr = Math.max(1, op.rr * sr);
        o.decayK = Math.exp(Math.log(0.001) / o.dr);
        o.relK = Math.exp(Math.log(0.0005) / o.rr);
        o.out = 0;
      }
    }
    release(v) {
      if (!v.active || v.released) return;
      v.released = true;
      for (const o of v.ops) o.stage = 3;
    }
    process(outBuffer, playbackTime) {
      const L = outBuffer.getChannelData(0);
      const R = outBuffer.numberOfChannels > 1 ? outBuffer.getChannelData(1) : L;
      const len = L.length;
      const voices = this.voices;
      const sr = this.sampleRate;
      this.frame = Math.round(playbackTime * sr);
      for (let s = 0; s < len; s++) {
        while (this.queue.length && this.queue[0].f <= this.frame) this.start(this.queue.shift());
        this.lfoPhase += TWO_PI * 5.5 / sr;
        if (this.lfoPhase > TWO_PI) this.lfoPhase -= TWO_PI;
        const lfo = Math.sin(this.lfoPhase);
        let sl = 0, sr2 = 0;
        for (let vi = 0; vi < voices.length; vi++) {
          const v = voices[vi];
          if (!v.active) continue;
          if (!v.released && this.frame >= v.offAt) this.release(v);
          v.age++;
          const p = v.patch; const ops = v.ops; const pops = p.ops;
          v.freq *= v.sweepMul;
          const vib = p.vib ? 1 + lfo * p.vib * Math.min(1, v.age / (sr * 0.25)) : 1;
          const baseInc = TWO_PI * v.freq * vib / sr;
          let alive = false;
          for (let i = 0; i < 4; i++) {
            const o = ops[i], po = pops[i];
            switch (o.stage) {
              case 0: o.env += 1 / o.ar; if (o.env >= 1) { o.env = 1; o.stage = 1; } break;
              case 1: o.env = po.sl + (o.env - po.sl) * o.decayK; if (o.env - po.sl < 0.0005) { o.env = po.sl; o.stage = 2; } break;
              case 2: break;
              case 3: o.env *= o.relK; if (o.env < 0.0003) { o.env = 0; o.stage = 4; } break;
            }
            if (o.stage !== 4) alive = true;
            o.phase += baseInc * po.mul * (1 + (po.dt || 0));
            if (o.phase > 1e6) o.phase -= TWO_PI * Math.floor(o.phase / TWO_PI);
          }
          if (!alive) { v.active = false; continue; }
          const e0 = ops[0].env * pops[0].lvl * Math.PI, e1 = ops[1].env * pops[1].lvl * Math.PI,
                e2 = ops[2].env * pops[2].lvl * Math.PI, e3 = ops[3].env * pops[3].lvl;
          const fbAmt = p.fb ? Math.pow(2, p.fb - 8) * Math.PI * 2 : 0;
          const o1 = Math.sin(ops[0].phase + (v.fb1 + v.fb2) * 0.5 * fbAmt);
          v.fb2 = v.fb1; v.fb1 = o1;
          const m1 = o1 * e0;
          let o2, o3, o4, outv;
          const c1 = pops[1].lvl * ops[1].env, c2 = pops[2].lvl * ops[2].env;
          switch (p.alg) {
            case 0: o2 = Math.sin(ops[1].phase + m1) * e1; o3 = Math.sin(ops[2].phase + o2) * e2; outv = Math.sin(ops[3].phase + o3) * e3; break;
            case 1: o2 = Math.sin(ops[1].phase) * e1; o3 = Math.sin(ops[2].phase + m1 + o2) * e2; outv = Math.sin(ops[3].phase + o3) * e3; break;
            case 2: o2 = Math.sin(ops[1].phase) * e1; o3 = Math.sin(ops[2].phase + o2) * e2; outv = Math.sin(ops[3].phase + m1 + o3) * e3; break;
            case 3: o2 = Math.sin(ops[1].phase + m1) * e1; o3 = Math.sin(ops[2].phase) * e2; outv = Math.sin(ops[3].phase + o2 + o3) * e3; break;
            case 4: o2 = Math.sin(ops[1].phase + m1) * c1; o3 = Math.sin(ops[2].phase) * e2; outv = o2 + Math.sin(ops[3].phase + o3) * e3; break;
            case 5: o2 = Math.sin(ops[1].phase + m1) * c1; o3 = Math.sin(ops[2].phase + m1) * c2; outv = o2 + o3 + Math.sin(ops[3].phase + m1) * e3; break;
            case 6: o2 = Math.sin(ops[1].phase + m1) * c1; o3 = Math.sin(ops[2].phase) * c2; outv = o2 + o3 + Math.sin(ops[3].phase) * e3; break;
            default: o2 = Math.sin(ops[1].phase) * c1; o3 = Math.sin(ops[2].phase) * c2; outv = o1 * pops[0].lvl * ops[0].env + o2 + o3 + Math.sin(ops[3].phase) * e3; break;
          }
          const a = outv * v.vel * (p.vol || 0.3);
          sl += a * v.gl; sr2 += a * v.gr;
        }
        L[s] = sl / (1 + Math.abs(sl)); R[s] = sr2 / (1 + Math.abs(sr2));
        this.frame++;
      }
    }
  }

  class SPNode {
    constructor(ctx, voices) {
      this.dsp = new FMDSP(voices, ctx.sampleRate);
      this.node = ctx.createScriptProcessor(2048, 0, 2);
      this.port = { postMessage: (m) => this.dsp.onMessage(m) };
      this.node.onaudioprocess = (e) => this.dsp.process(e.outputBuffer, e.playbackTime);
    }
    connect(dest) { return this.node.connect(dest); }
    disconnect() { this.node.disconnect(); }
  }

  const realInit = FM.init;
  FM.init = async function (opts) {
    if (this.ready) {
      if (this.ctx && this.ctx.state !== 'running') await this.ctx.resume();
      return;
    }
    try {
      await realInit.call(this, opts);
      this.engine = 'worklet';
      return;
    } catch (e) {
      if (this.ctx) { try { await this.ctx.close(); } catch (e2) { /* noop */ } this.ctx = null; }
    }
    const o = opts || {};
    const ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'interactive' });
    this.ctx = ctx;
    this.music = new SPNode(ctx, o.musicVoices || 16);
    this.sfx = new SPNode(ctx, o.sfxVoices || 12);
    this.addPatches(FM.PATCHES);
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -10; comp.ratio.value = 4; comp.connect(ctx.destination);
    this.musicGain = ctx.createGain(); this.musicGain.gain.value = this.musicVol;
    this.sfxGain = ctx.createGain(); this.sfxGain.gain.value = this.sfxVol;
    this.music.connect(this.musicGain); this.musicGain.connect(comp);
    this.sfx.connect(this.sfxGain); this.sfxGain.connect(comp);
    if ((o.echo || 0) > 0) {
      const d = ctx.createDelay(2);
      d.delayTime.value = o.echoTime || 0.31;
      const fb = ctx.createGain(); fb.gain.value = 0.28;
      const wet = ctx.createGain(); wet.gain.value = o.echo;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 2500;
      this.musicGain.connect(d); d.connect(lp); lp.connect(fb); fb.connect(d); lp.connect(wet); wet.connect(comp);
      this.echoDelay = d;
    }
    this.ready = true;
    this.engine = 'script-processor';
    console.warn('FM: AudioWorklet could not be loaded, using ScriptProcessorNode fallback');
  };
})();
