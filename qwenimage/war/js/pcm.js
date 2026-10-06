// ===== PCMドラム＋リバーブ（FM音源の拡張） =====
// 起動時に OfflineAudioContext でドラムの波形を合成して AudioBuffer にし、
// FM.note を横取りしてドラム系パッチをサンプル再生に差し替える。音声ファイル不要。
'use strict';

const PCM = (() => {
  // gain: 再生音量 / base: この周波数を等倍として音程を変える（音程付きサンプル） / sfx: 効果音側でも差し替える
  const KITS = {
    kick:    { gain: 0.95 },
    snare:   { gain: 0.6 },
    hat:     { gain: 0.2 },
    ohat:    { gain: 0.18 },
    tom:     { gain: 0.8, base: 180 },
    crash:   { gain: 0.26, sfx: true },
    orchhit: { gain: 0.42, base: 261.63, sfx: true },
  };
  const buffers = {};
  const active = new Set();
  let ctx = null, musicOut = null, sfxOut = null, sends = null;
  let enabled = true;
  let origNote = null, origStop = null;

  // ---- オフライン合成のヘルパー ----
  function noise(oc, sec) {
    const b = oc.createBuffer(1, Math.ceil(oc.sampleRate * sec), oc.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const s = oc.createBufferSource(); s.buffer = b; s.start(0);
    return s;
  }
  function osc(oc, type, f, stop) {
    const o = oc.createOscillator(); o.type = type; o.frequency.value = f; o.start(0); o.stop(stop);
    return o;
  }
  function decay(oc, peak, tau, attack = 0.001) {
    const g = oc.createGain();
    g.gain.setValueAtTime(0, 0); g.gain.linearRampToValueAtTime(peak, attack); g.gain.setTargetAtTime(0, attack, tau);
    return g;
  }
  function filt(oc, type, f, q = 0.7, gain = 0) {
    const b = oc.createBiquadFilter(); b.type = type; b.frequency.value = f; b.Q.value = q; b.gain.value = gain;
    return b;
  }
  function shaper(oc, k) {
    const ws = oc.createWaveShaper(), c = new Float32Array(1024);
    for (let i = 0; i < c.length; i++) { const x = i / 511.5 - 1; c[i] = Math.tanh(k * x) / Math.tanh(k); }
    ws.curve = c; return ws;
  }
  function chain(...nodes) { for (let i = 0; i < nodes.length - 1; i++) nodes[i].connect(nodes[i + 1]); return nodes[nodes.length - 1]; }

  // 808系の金属音（6本の矩形波）
  function metal(oc, tau, len, mul = 1.7, bp = 10000) {
    const sum = oc.createGain(); sum.gain.value = 0.15;
    for (const f of [205.3, 304.4, 369.6, 522.7, 540, 800]) osc(oc, 'square', f * mul, len).connect(sum);
    chain(sum, filt(oc, 'bandpass', bp, 0.8), filt(oc, 'highpass', 6500), decay(oc, 1, tau), oc.destination);
    chain(noise(oc, len), filt(oc, 'highpass', 8000), decay(oc, 0.55, tau), oc.destination);
  }

  const RECIPES = {
    kick: [0.7, (oc) => {
      const o = osc(oc, 'sine', 170, 0.7);
      o.frequency.setValueAtTime(170, 0); o.frequency.exponentialRampToValueAtTime(55, 0.08); o.frequency.exponentialRampToValueAtTime(40, 0.5);
      chain(o, shaper(oc, 2.5), decay(oc, 1, 0.16, 0.002), oc.destination);
      chain(noise(oc, 0.03), filt(oc, 'highpass', 3000), decay(oc, 0.6, 0.004), oc.destination);
    }],
    // 軍楽隊風の乾いたスネア
    snare: [0.5, (oc) => {
      for (const [f, a] of [[185, 0.7], [330, 0.35]]) {
        const o = osc(oc, 'triangle', f, 0.3);
        o.frequency.setValueAtTime(f, 0); o.frequency.exponentialRampToValueAtTime(f * 0.85, 0.1);
        chain(o, decay(oc, a, 0.045), oc.destination);
      }
      chain(noise(oc, 0.5), filt(oc, 'highpass', 1800), filt(oc, 'peaking', 5500, 1, 5), decay(oc, 0.85, 0.08), oc.destination);
      chain(noise(oc, 0.2), filt(oc, 'bandpass', 900, 0.8), decay(oc, 0.4, 0.03), oc.destination);
    }],
    hat: [0.15, (oc) => metal(oc, 0.018, 0.15)],
    ohat: [0.7, (oc) => metal(oc, 0.16, 0.7)],
    crash: [2.6, (oc) => {
      metal(oc, 0.75, 2.6, 2.3, 8000);
      chain(noise(oc, 2.6), filt(oc, 'highpass', 4000), decay(oc, 0.7, 0.65, 0.003), oc.destination);
      chain(noise(oc, 2.6), filt(oc, 'bandpass', 3200, 0.6), decay(oc, 0.35, 0.45, 0.003), oc.destination);
    }],
    // ティンパニ風のタム
    tom: [1.6, (oc) => {
      for (const [m, a, tau] of [[1, 1, 0.4], [1.5, 0.35, 0.22], [1.98, 0.18, 0.15], [2.44, 0.1, 0.1]]) {
        const o = osc(oc, 'sine', 100 * m, 1.6);
        o.frequency.setValueAtTime(100 * m * 1.04, 0); o.frequency.exponentialRampToValueAtTime(100 * m, 0.15);
        chain(o, decay(oc, a, tau, 0.003), oc.destination);
      }
      chain(noise(oc, 0.1), filt(oc, 'lowpass', 900), decay(oc, 0.5, 0.015), oc.destination);
    }],
    // オーケストラヒット（ルート・5度・オクターブなので長調短調どちらにも合う）
    orchhit: [1.2, (oc) => {
      const base = 261.63, sum = oc.createGain();
      for (const [m, a] of [[0.5, 0.5], [1, 1], [1.5, 0.75], [2, 0.6], [3, 0.35], [4, 0.2]])
        for (const dt of [-0.007, 0.007]) { const g = oc.createGain(); g.gain.value = a * 0.18; osc(oc, 'sawtooth', base * m * (1 + dt), 1.2).connect(g); g.connect(sum); }
      const lp = filt(oc, 'lowpass', 7000, 1.2);
      lp.frequency.setValueAtTime(7000, 0); lp.frequency.exponentialRampToValueAtTime(900, 0.4);
      chain(sum, lp, decay(oc, 1, 0.22, 0.004), oc.destination);
      chain(noise(oc, 0.15), filt(oc, 'bandpass', 2500, 0.7), decay(oc, 0.5, 0.03), oc.destination);
      chain(osc(oc, 'sine', base / 4, 1.2), decay(oc, 0.6, 0.3, 0.003), oc.destination);
    }],
  };

  async function render(len, build) {
    const sr = ctx.sampleRate;
    const oc = new OfflineAudioContext(1, Math.ceil(sr * len), sr);
    build(oc);
    const buf = await oc.startRendering();
    // ピークを揃えておく（KITS の gain をそのまま音量として扱えるように）
    const d = buf.getChannelData(0);
    let peak = 0;
    for (let i = 0; i < d.length; i++) peak = Math.max(peak, Math.abs(d[i]));
    if (peak > 0) for (let i = 0; i < d.length; i++) d[i] *= 0.95 / peak;
    // 末尾のプチノイズ防止フェード
    const fade = Math.min(d.length, Math.floor(sr * 0.02));
    for (let i = 0; i < fade; i++) d[d.length - 1 - i] *= i / fade;
    return buf;
  }

  // ホール風のインパルス応答（時間とともに高域が減衰していくノイズ）
  function makeIR(sec, rt) {
    const sr = ctx.sampleRate, n = Math.floor(sr * sec), pre = Math.floor(sr * 0.02);
    const buf = ctx.createBuffer(2, n, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0;
      for (let i = pre; i < n; i++) {
        const t = (i - pre) / sr;
        const bright = 0.06 + 0.8 * Math.exp(-t * 3);
        lp += bright * ((Math.random() * 2 - 1) - lp);
        d[i] = lp * Math.exp(-6.9 * t / rt);
      }
      for (let k = 0; k < 10; k++) d[pre + Math.floor(sr * (0.004 + Math.random() * 0.07))] += (Math.random() * 2 - 1) * 0.5;
    }
    return buf;
  }

  function play(name, target, freq, { t, vel = 1, pan = 0 } = {}) {
    const k = KITS[name];
    const src = ctx.createBufferSource();
    src.buffer = buffers[name];
    const f = typeof freq === 'string' ? FM.mtof(freq) : freq;
    if (k.base && f) src.playbackRate.value = f / k.base;
    const g = ctx.createGain(); g.gain.value = k.gain * vel;
    const p = ctx.createStereoPanner(); p.pan.value = pan;
    chain(src, g, p, target === 'sfx' ? sfxOut : musicOut);
    src.start(Math.max(t ?? 0, ctx.currentTime));
    active.add(src);
    src.onended = () => { active.delete(src); p.disconnect(); };
  }

  return {
    // FM.init の後に呼ぶ
    async init({ reverbMusic = 0.3, reverbSfx = 0.16 } = {}) {
      if (ctx === FM.ctx) return;
      ctx = FM.ctx;
      active.clear();
      for (const [name, [len, build]] of Object.entries(RECIPES)) buffers[name] = await render(len, build);

      musicOut = ctx.createGain(); musicOut.connect(FM.musicGain);
      sfxOut = ctx.createGain(); sfxOut.connect(FM.sfxGain);

      // リバーブ：音楽と効果音の各ゲインからセンド → 低域カット → コンボリューション → リミッター → 出力
      const conv = ctx.createConvolver(); conv.buffer = makeIR(2.8, 2.3);
      const hp = filt(ctx, 'highpass', 220);
      const ret = ctx.createGain(); ret.gain.value = 1;
      const lim = ctx.createDynamicsCompressor(); lim.threshold.value = -8; lim.ratio.value = 6;
      const mSend = ctx.createGain(); mSend.gain.value = reverbMusic;
      const sSend = ctx.createGain(); sSend.gain.value = reverbSfx;
      FM.musicGain.connect(mSend); FM.sfxGain.connect(sSend);
      mSend.connect(hp); sSend.connect(hp);
      chain(hp, conv, ret, lim, ctx.destination);
      sends = { music: mSend, sfx: sSend };

      if (!origNote) {
        origNote = FM.note.bind(FM);
        FM.note = (target, patch, freq, opts = {}) => {
          const k = KITS[patch];
          if (enabled && ctx && buffers[patch] && k && (target === 'music' || k.sfx)) return play(patch, target, freq, opts);
          return origNote(target, patch, freq, opts);
        };
        origStop = FM.stop.bind(FM);
        FM.stop = (hard = false) => {
          origStop(hard);
          if (hard) for (const s of active) { try { s.stop(); } catch (e) { /* 未開始 */ } }
        };
      }
    },
    get enabled() { return enabled; },
    set enabled(v) { enabled = !!v; },
    setReverb({ music, sfx } = {}) {
      if (!sends) return;
      if (music != null) sends.music.gain.value = music;
      if (sfx != null) sends.sfx.gain.value = sfx;
    },
  };
})();
