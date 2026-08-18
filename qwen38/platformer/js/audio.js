/* audio.js — WebAudio による効果音（外部ファイル不要） */
window.Isle = window.Isle || {};

Isle.Sfx = (function () {
  let ctx = null;

  function ensure() {
    if (!ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      ctx = new AC();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function blip(freq, dur, type, vol, when, slideTo) {
    if (!ensure()) return;
    const t0 = ctx.currentTime + (when || 0);
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(Math.max(30, slideTo), t0 + dur);
    g.gain.setValueAtTime(vol, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g);
    g.connect(ctx.destination);
    o.start(t0);
    o.stop(t0 + dur + 0.02);
  }

  function noise(dur, vol, cutoff) {
    if (!ensure()) return;
    const n = Math.floor(ctx.sampleRate * dur);
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = cutoff;
    const g = ctx.createGain();
    g.gain.value = vol;
    src.connect(f);
    f.connect(g);
    g.connect(ctx.destination);
    src.start();
  }

  return {
    init: ensure,
    jump: function () { blip(320, 0.14, 'square', 0.045, 0, 560); },
    land: function () { blip(140, 0.07, 'sine', 0.05); },
    collect: function () {
      blip(660, 0.09, 'sine', 0.07);
      blip(880, 0.12, 'sine', 0.07, 0.07);
      blip(1320, 0.16, 'sine', 0.06, 0.14);
    },
    splash: function () { noise(0.5, 0.25, 900); },
    win: function () {
      [523, 659, 784, 1047].forEach(function (f, i) {
        blip(f, 0.25, 'triangle', 0.08, i * 0.13);
      });
    }
  };
})();
