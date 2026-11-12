(() => {
  'use strict';
  const PP = window.PianoPhysics, SS = window.SonataScore;
  const score = SS.buildSonata();
  const $ = (s) => document.querySelector(s);
  const reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  const fmt = (t) => { t = Math.max(0, t); const m = Math.floor(t / 60), s = Math.floor(t % 60); return m + ':' + String(s).padStart(2, '0'); };
  $('#dur').textContent = '/ ' + fmt(score.duration);

  /* ================= audio ================= */
  const A = {
    ctx: null, input: null, wet: null, analyser: null, fs: 48000,
    renderer: null, jobId: 0, from: 0, ctxStart: null, sources: [], bufferedTo: 0,
    playing: false, started: false, voices: 0,
  };
  const params = Object.assign({}, PP.DEFAULT_PARAMS);

  function makeSoundboardIR(ctx) {
    const fs = ctx.sampleRate, len = Math.round(0.32 * fs);
    const buf = ctx.createBuffer(2, len, fs);
    let r = 7;
    const rnd = () => { r = (r * 16807) % 2147483647; return r / 2147483647; };
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      d[0] = 1;
      for (let k = 0; k < 160; k++) {
        const u = rnd();
        const f = 55 * Math.pow(90, u) * (1 + (rnd() - 0.5) * 0.02);
        const T = 0.025 + 0.22 * Math.pow(1 - u, 2) + rnd() * 0.03;
        let a = (0.5 + rnd()) * (f < 180 ? f / 180 : 1) * Math.exp(-f / 5200) * 0.055;
        const ph = rnd() * Math.PI * 2, w = 2 * Math.PI * f / fs, dec = -6.9 / (T * fs);
        const n = Math.min(len, Math.round(T * 1.2 * fs));
        for (let i = 1; i < n; i++) d[i] += a * Math.exp(dec * i) * Math.sin(w * i + ph);
      }
    }
    // The modes add up coherently, so measure the response and scale the mode part
    // to a gentle coloration (at most ≈ +3 dB over the direct sound), then normalize
    // the whole response so its loudest frequency has unity gain.
    const resp = (d, from) => {
      let mx = 0;
      for (let q = 0; q < 110; q++) {
        const f = 35 * Math.pow(250, q / 109), w = 2 * Math.PI * f / fs;
        const cw = Math.cos(w), sw = Math.sin(w);
        let c = 1, s = 0, re = 0, im = 0;
        for (let i = 0; i < len; i++) {
          if (i >= from) { re += d[i] * c; im -= d[i] * s; }
          const t = c * cw - s * sw; s = c * sw + s * cw; c = t;
        }
        mx = Math.max(mx, Math.hypot(re, im));
      }
      return mx;
    };
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      const gm = 0.4 / resp(d, 1);
      for (let i = 1; i < len; i++) d[i] *= gm;
      const gt = 1 / resp(d, 0);
      for (let i = 0; i < len; i++) d[i] *= gt;
    }
    return buf;
  }
  function makeHallIR(ctx) {
    const fs = ctx.sampleRate, T = 2.4, len = Math.round(T * 1.15 * fs), pre = Math.round(0.016 * fs);
    const buf = ctx.createBuffer(2, len, fs);
    let r = 99;
    const rnd = () => { r = (r * 48271) % 2147483647; return r / 2147483647 * 2 - 1; };
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let lp = 0, e = 0;
      for (let i = pre; i < len; i++) {
        const t = (i - pre) / fs;
        const fc = 9000 * Math.exp(-t / 0.9) + 1400;
        const c = Math.exp(-2 * Math.PI * fc / fs);
        lp = c * lp + (1 - c) * rnd();
        d[i] = lp * Math.exp(-6.9 * t / T) * Math.min(1, t / 0.012);
      }
      // early reflections
      for (let k = 0; k < 9; k++) {
        const at = pre + Math.round((0.006 + Math.abs(rnd()) * 0.06) * fs);
        d[at] += (0.5 - k * 0.04) * (rnd() > 0 ? 1 : -1) * 0.6;
      }
      for (let i = 0; i < len; i++) e += d[i] * d[i];
      const g = 1 / Math.sqrt(e);
      for (let i = 0; i < len; i++) d[i] *= g;
    }
    return buf;
  }

  function initAudio() {
    if (A.ctx) return;
    const ctx = new (window.AudioContext || window.webkitAudioContext)({ latencyHint: 'playback' });
    A.ctx = ctx; A.fs = ctx.sampleRate;
    A.input = ctx.createGain();
    const sb = ctx.createConvolver(); sb.normalize = false; sb.buffer = makeSoundboardIR(ctx);
    const dry = ctx.createGain(); dry.gain.value = 0.92;
    const hall = ctx.createConvolver(); hall.normalize = false; hall.buffer = makeHallIR(ctx);
    A.wet = ctx.createGain(); A.wet.gain.value = +$('#pRev').value * 0.55;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 6; comp.ratio.value = 6; comp.attack.value = 0.002; comp.release.value = 0.25;
    const master = ctx.createGain(); master.gain.value = 0.8;
    // safety soft clipper: linear below 0.75, smooth saturation above, never exceeds ±1
    const clip = ctx.createWaveShaper();
    const cv = new Float32Array(2049);
    for (let i = 0; i < cv.length; i++) {
      const x = (i / 1024) - 1, ax = Math.abs(x), k = 0.75;
      cv[i] = ax <= k ? x : Math.sign(x) * (k + (1 - k) * Math.tanh((ax - k) / (1 - k)));
    }
    clip.curve = cv; clip.oversample = '2x';
    A.analyser = ctx.createAnalyser(); A.analyser.fftSize = 2048;
    A.input.connect(sb); sb.connect(dry); sb.connect(hall); hall.connect(A.wet);
    dry.connect(comp); A.wet.connect(comp); comp.connect(master); master.connect(clip); clip.connect(A.analyser); A.analyser.connect(ctx.destination);
    A.renderer = makeRenderer();
  }

  /* ---------- renderers: Web Worker, or time-sliced main thread ---------- */
  function makeRenderer() {
    const onChunk = (c) => handleChunk(c);
    const local = {
      job: null, id: -1, pos: 0, waiting: false, kind: 'main thread',
      start(from, id) { this.job = new PP.Job(A.fs, score.events, from, params); this.id = id; this.pos = from; this.waiting = false; const me = id; setTimeout(() => this.loop(me), 0); },
      loop(id) {
        if (id !== this.id || !this.job) return;
        const t0 = performance.now();
        while (performance.now() - t0 < 7) {
          if (this.job.time >= score.duration) return;
          if (this.job.time - this.pos > 6) { this.waiting = true; return; }
          const c = this.job.renderChunk(Math.round(0.1 * A.fs));
          onChunk({ id, startSec: c.startSec, L: c.L, R: c.R, voices: c.activeVoices });
        }
        setTimeout(() => this.loop(id), 4);
      },
      setPos(t) { this.pos = t; if (this.waiting) { this.waiting = false; const me = this.id; setTimeout(() => this.loop(me), 0); } },
      setParams(p) { if (this.job) this.job.engine.setParams(p); },
      stop() { this.job = null; this.id = -1; },
    };
    let w = null;
    try { w = new Worker('worker.js'); } catch (e) { w = null; }
    if (!w) return local;
    const R = {
      kind: 'worker', ready: false, pending: null, fallback: null,
      start(from, id) {
        if (this.fallback) return this.fallback.start(from, id);
        if (!this.ready) { this.pending = [from, id]; return; }
        w.postMessage({ cmd: 'start', from, id, fs: A.fs, params });
      },
      setPos(t) { if (this.fallback) return this.fallback.setPos(t); if (this.ready) w.postMessage({ cmd: 'pos', t }); },
      setParams(p) { if (this.fallback) return this.fallback.setParams(p); if (this.ready) w.postMessage({ cmd: 'params', params: p }); },
      stop() { if (this.fallback) return this.fallback.stop(); if (this.ready) w.postMessage({ cmd: 'stop' }); },
    };
    const goLocal = () => {
      if (R.fallback || R.ready) return;
      R.fallback = local; R.kind = 'main thread';
      try { w.terminate(); } catch (e) { /* ignore */ }
      if (R.pending) local.start(...R.pending);
    };
    w.onmessage = (e) => {
      const d = e.data;
      if (d.ready) {
        R.ready = true;
        w.postMessage({ cmd: 'score', events: score.events, duration: score.duration });
        if (R.pending) { R.start(...R.pending); R.pending = null; }
        return;
      }
      onChunk(d);
    };
    w.onerror = goLocal;
    setTimeout(goLocal, 2500);
    return R;
  }

  function handleChunk(c) {
    if (c.id !== A.jobId || !A.ctx) return;
    const ctx = A.ctx, n = c.L.length;
    if (A.ctxStart === null) {
      A.ctxStart = Math.ceil((ctx.currentTime + 0.25) * A.fs) / A.fs;
      setStatus('');
    }
    const when = A.ctxStart + (c.startSec - A.from);
    const buf = ctx.createBuffer(2, n, A.fs);
    buf.copyToChannel(c.L, 0); buf.copyToChannel(c.R, 1);
    const src = ctx.createBufferSource();
    src.buffer = buf; src.connect(A.input);
    const now = ctx.currentTime;
    if (when + n / A.fs <= now) return;
    if (when < now) src.start(now, now - when); else src.start(when);
    A.sources.push(src);
    src.onended = () => { const i = A.sources.indexOf(src); if (i >= 0) A.sources.splice(i, 1); };
    A.bufferedTo = c.startSec + n / A.fs;
    A.voices = c.voices;
  }

  function scoreTime() {
    if (!A.started) return -1.4;
    if (!A.ctx || A.ctxStart === null) return A.from;
    return Math.max(A.from, A.from + (A.ctx.currentTime - A.ctxStart));
  }

  function startAt(t) {
    initAudio();
    for (const s of A.sources) { try { s.stop(); } catch (e) { /* ignore */ } }
    A.sources = [];
    A.jobId++;
    A.from = Math.max(0, Math.min(score.duration - 1, t));
    A.ctxStart = null; A.bufferedTo = A.from;
    A.started = true;
    setStatus('弦を張っています…');
    A.renderer.start(A.from, A.jobId);
  }

  function setPlaying(p) {
    A.playing = p;
    $('#ico-play').toggleAttribute('hidden', p); $('#ico-pause').toggleAttribute('hidden', !p);
    $('#play').setAttribute('aria-label', p ? '一時停止' : '再生');
  }
  function togglePlay() {
    initAudio();
    if (A.ctx.state === 'suspended') A.ctx.resume();
    if (!A.started) { startAt(0); setPlaying(true); return; }
    if (A.playing) { A.ctx.suspend(); setPlaying(false); setStatus('一時停止中'); }
    else { A.ctx.resume(); setPlaying(true); setStatus(''); }
  }
  function seek(t) {
    initAudio();
    startAt(t);
    if (!A.playing) { A.ctx.resume(); setPlaying(true); }
  }
  function setStatus(s) { $('#status').textContent = s; }
  $('#play').addEventListener('click', togglePlay);

  setInterval(() => {
    if (!A.renderer || !A.started) return;
    A.renderer.setPos(scoreTime());
  }, 200);

  /* ================= live playing ================= */
  const live = new Map();
  const liveNotes = [];
  function liveOn(m, vel) {
    initAudio();
    if (A.ctx.state === 'suspended' && !A.playing) A.ctx.resume();
    if (m < 21 || m > 108) return;
    liveOff(m);
    const np = PP.noteParams(m, A.fs, params);
    const secs = Math.min(8, Math.max(1.5, np.T60 * 0.55));
    const r = PP.renderNote(m, vel, secs, A.fs, params);
    const ctx = A.ctx, buf = ctx.createBuffer(2, r.L.length, A.fs);
    buf.copyToChannel(r.L, 0); buf.copyToChannel(r.R, 1);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const g = ctx.createGain(); g.gain.value = 1;
    src.connect(g); g.connect(A.input); src.start();
    const rec = { src, g, np, note: { tOn: ctx.currentTime, tOff: Infinity, dampT: Infinity, midi: m, vel, live: true } };
    live.set(m, rec); liveNotes.push(rec.note);
    if (liveNotes.length > 64) liveNotes.shift();
    showNoteInfo(m, vel, 'live');
  }
  function liveOff(m) {
    const rec = live.get(m);
    if (!rec) return;
    live.delete(m);
    const t = A.ctx.currentTime;
    rec.note.tOff = t;
    if (!rec.np.damperless) {
      rec.note.dampT = t;
      rec.g.gain.setTargetAtTime(0, t, rec.np.T60d / 6.9);
      rec.src.stop(t + rec.np.T60d * 1.5);
    }
  }

  /* ================= stage geometry ================= */
  const stage = $('#stage'), g2 = stage.getContext('2d');
  const isBlack = (m) => [1, 3, 6, 8, 10].includes(m % 12);
  const npVis = [];
  for (let m = 21; m <= 108; m++) npVis[m] = PP.noteParams(m, 48000);
  let W = 0, H = 0, dpr = 1, keys = [], ww = 0, kh = 0, hamY = 0, plateH = 0, bg = null;
  const bridgeY = (x) => plateH + 26 + Math.pow(x / W, 1.25) * (hamY - plateH - 70) * 0.62;

  function layout() {
    const r = stage.parentElement.getBoundingClientRect();
    W = Math.max(300, r.width);
    H = Math.round(Math.max(340, Math.min(660, W * 0.54)));
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    stage.width = Math.round(W * dpr); stage.height = Math.round(H * dpr); stage.style.height = H + 'px';
    let nW = 0; for (let m = 21; m <= 108; m++) if (!isBlack(m)) nW++;
    ww = W / nW;
    keys = [];
    let wi = 0;
    const OFF = { 1: -0.12, 3: 0.12, 6: -0.14, 8: 0, 10: 0.14 };
    for (let m = 21; m <= 108; m++) {
      if (!isBlack(m)) { keys[m] = { x: wi * ww, w: ww, black: false, cx: wi * ww + ww / 2 }; wi++; }
      else { const bw = ww * 0.6; const x = wi * ww - bw / 2 + OFF[m % 12] * bw; keys[m] = { x, w: bw, black: true, cx: x + bw / 2 }; }
    }
    kh = Math.min(ww * 6.2, H * 0.22);
    plateH = Math.max(62, H * 0.12);
    hamY = H - kh - 26;
    buildBackground();
  }

  function buildBackground() {
    bg = document.createElement('canvas');
    bg.width = stage.width; bg.height = stage.height;
    const c = bg.getContext('2d');
    c.scale(dpr, dpr);
    // case
    c.fillStyle = '#0d0c0b'; c.fillRect(0, 0, W, H);
    // spruce soundboard
    const gr = c.createLinearGradient(0, plateH, W, hamY);
    gr.addColorStop(0, '#3f2c1b'); gr.addColorStop(0.5, '#4a3421'); gr.addColorStop(1, '#2c1f13');
    c.fillStyle = gr; c.fillRect(0, plateH, W, hamY - plateH + 20);
    let s = 3;
    const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
    for (let i = 0; i < W / 3.2; i++) {
      const x0 = rnd() * W, amp = 2 + rnd() * 5, ph = rnd() * 6;
      c.strokeStyle = rnd() > 0.5 ? `rgba(120,86,50,${0.10 + rnd() * 0.16})` : `rgba(20,12,6,${0.10 + rnd() * 0.2})`;
      c.lineWidth = 0.4 + rnd() * 1.4;
      c.beginPath();
      for (let y = plateH; y <= hamY + 20; y += 12) {
        const x = x0 + Math.sin(y / 70 + ph) * amp + (y - plateH) * 0.08;
        if (y === plateH) c.moveTo(x, y); else c.lineTo(x, y);
      }
      c.stroke();
    }
    // vignette
    const vg = c.createRadialGradient(W * 0.5, (plateH + hamY) / 2, W * 0.1, W * 0.5, (plateH + hamY) / 2, W * 0.75);
    vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.55)');
    c.fillStyle = vg; c.fillRect(0, plateH, W, hamY - plateH + 20);
    // long bridge (hardwood, curved: bass strings are longest)
    c.strokeStyle = '#1e140c'; c.lineWidth = 9; c.lineCap = 'round';
    c.beginPath(); for (let x = 0; x <= W; x += 8) { const y = bridgeY(x); x === 0 ? c.moveTo(x, y) : c.lineTo(x, y); } c.stroke();
    c.strokeStyle = 'rgba(160,110,60,.35)'; c.lineWidth = 1.2;
    c.beginPath(); for (let x = 0; x <= W; x += 8) { const y = bridgeY(x) - 3; x === 0 ? c.moveTo(x, y) : c.lineTo(x, y); } c.stroke();
    // static strings: hitch pins → bridge → agraffe
    for (let m = 21; m <= 108; m++) {
      const k = keys[m], x = k.cx;
      const wound = m < 40;
      c.strokeStyle = wound ? 'rgba(196,118,62,.78)' : 'rgba(195,203,209,.42)';
      c.lineWidth = wound ? 1.3 + (40 - m) * 0.045 : 0.7;
      c.beginPath(); c.moveTo(x, plateH - 4); c.lineTo(x, hamY - 12); c.stroke();
      c.fillStyle = '#d9c38f';
      c.fillRect(x - 0.8, bridgeY(x) - 1, 1.6, 2);
    }
    // cast-iron plate (gilded) with hitch pins and round holes
    const pg = c.createLinearGradient(0, 0, 0, plateH);
    pg.addColorStop(0, '#d8b46c'); pg.addColorStop(0.55, '#c39b55'); pg.addColorStop(1, '#8e6c35');
    c.fillStyle = pg; c.fillRect(0, 0, W, plateH);
    c.fillStyle = 'rgba(255,240,200,.25)'; c.fillRect(0, plateH - 3, W, 1);
    c.fillStyle = 'rgba(40,25,10,.5)'; c.fillRect(0, plateH - 1, W, 1);
    for (let m = 21; m <= 108; m++) {
      c.fillStyle = '#5a4120'; c.beginPath(); c.arc(keys[m].cx, plateH - 9, 1.2, 0, 7); c.fill();
    }
    for (let i = 0; i < 3; i++) {
      const hx = W * (0.4 + i * 0.09), hy = plateH * 0.5, rr = Math.min(plateH * 0.24, 15);
      if (W < 700) break;
      c.fillStyle = '#2a1a0c'; c.beginPath(); c.arc(hx, hy, rr, 0, 7); c.fill();
      c.strokeStyle = 'rgba(255,235,190,.35)'; c.lineWidth = 1; c.beginPath(); c.arc(hx, hy, rr + 2, 0.6, 3.6); c.stroke();
    }
    // pin block plate near the keyboard (agraffes)
    const pb = c.createLinearGradient(0, hamY - 18, 0, hamY - 6);
    pb.addColorStop(0, '#b8914f'); pb.addColorStop(1, '#7b5b2b');
    c.fillStyle = pb; c.fillRect(0, hamY - 18, W, 10);
    for (let m = 21; m <= 108; m++) { c.fillStyle = '#efe0b8'; c.beginPath(); c.arc(keys[m].cx, hamY - 13, 1.1, 0, 7); c.fill(); }
    // key bed
    c.fillStyle = '#100e0c'; c.fillRect(0, hamY + 8, W, H - hamY - 8);
    c.fillStyle = '#2a2018'; c.fillRect(0, H - kh - 5, W, 5);
  }

  /* ================= score helpers ================= */
  const notes = score.notes;
  function lowerBound(t) { let lo = 0, hi = notes.length; while (lo < hi) { const mid = (lo + hi) >> 1; if (notes[mid].t < t) lo = mid + 1; else hi = mid; } return lo; }
  const pedals = score.pedals;
  function pedalAt(t) { let d = false; for (const p of pedals) { if (p.t > t) break; d = p.down; } return d; }
  function sectionAt(t) { let s = score.sections[0]; for (const x of score.sections) if (x.t0 <= t) s = x; return s; }
  function barAt(t) { let b = 1; for (let i = 0; i < score.bars.length; i++) if (score.bars[i] <= t) b = i + 1; return b; }
  function markAt(t) { let m = score.marks[0]; for (const x of score.marks) if (x.t <= t) m = x; return m; }
  function dynName(v) { return v < 0.25 ? 'pp' : v < 0.36 ? 'p' : v < 0.47 ? 'mp' : v < 0.6 ? 'mf' : v < 0.74 ? 'f' : v < 0.9 ? 'ff' : 'fff'; }

  function envelope(n, now, np) {
    const age = now - n.t;
    if (age < 0) return 0;
    let e = n.vel * Math.exp(-age / Math.max(0.35, Math.min(np.T60, 9) / 4.5));
    if (now > n.dampT) e *= Math.exp(-(now - n.dampT) / (np.T60d / 2.5));
    return e;
  }

  /* ================= draw ================= */
  const LOOK = 2.6;
  const colR = [242, 212, 143], colL = [228, 129, 79], colLive = [195, 203, 209];
  const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
  let lastNow = -1;

  function draw() {
    const now = scoreTime();
    const lnow = A.ctx ? A.ctx.currentTime : 0;
    g2.setTransform(dpr, 0, 0, dpr, 0, 0);
    g2.drawImage(bg, 0, 0, W, H);

    const keyState = new Array(109).fill(null);
    const strEnv = new Float32Array(109);
    const strCol = [];
    const hamBump = new Float32Array(109);

    // --- falling notes ---
    const topY = plateH + 2, fallH = hamY - 12 - topY;
    g2.save();
    g2.beginPath(); g2.rect(0, topY, W, fallH); g2.clip();
    g2.globalCompositeOperation = 'lighter';
    const i0 = Math.max(0, lowerBound(now - 10));
    const i1 = lowerBound(now + LOOK);
    for (let i = i0; i < i1; i++) {
      const n = notes[i];
      const k = keys[n.midi]; if (!k) continue;
      const col = n.hand === 'L' ? colL : colR;
      if (n.t > now) {
        const yb = hamY - 12 - (n.t - now) / LOOK * fallH;
        const yt = hamY - 12 - (n.off - now) / LOOK * fallH;
        const w = k.black ? k.w * 0.82 : k.w * 0.62, x = k.cx - w / 2;
        const h = Math.max(3, yb - yt);
        g2.fillStyle = rgba(col, 0.10 + n.vel * 0.12);
        g2.fillRect(x - 3, yb - h - 3, w + 6, h + 6);
        const gr = g2.createLinearGradient(0, yb - h, 0, yb);
        gr.addColorStop(0, rgba(col, 0.15)); gr.addColorStop(1, rgba(col, 0.55 + n.vel * 0.4));
        g2.fillStyle = gr;
        g2.fillRect(x, yb - h, w, h);
      } else {
        // sounding portion that has already reached the hammers
        if (n.off > now) {
          const yt = hamY - 12 - (n.off - now) / LOOK * fallH;
          const w = k.black ? k.w * 0.82 : k.w * 0.62, x = k.cx - w / 2;
          g2.fillStyle = rgba(col, 0.18);
          g2.fillRect(x, yt, w, hamY - 12 - yt);
          keyState[n.midi] = col;
        }
        const e = envelope(n, now, npVis[n.midi]);
        if (e > strEnv[n.midi]) { strEnv[n.midi] = e; strCol[n.midi] = col; }
        const age = now - n.t;
        if (age < 0.12) hamBump[n.midi] = Math.max(hamBump[n.midi], Math.sin(Math.PI * age / 0.12) * (0.5 + n.vel * 0.5));
      }
    }
    // live notes
    for (const n of liveNotes) {
      const e = envelope({ t: n.tOn, vel: n.vel, dampT: n.dampT }, lnow, npVis[n.midi]);
      if (e > strEnv[n.midi]) { strEnv[n.midi] = e; strCol[n.midi] = colLive; }
      if (lnow < n.tOff) keyState[n.midi] = colLive;
      const age = lnow - n.tOn;
      if (age < 0.12) hamBump[n.midi] = Math.max(hamBump[n.midi], Math.sin(Math.PI * age / 0.12) * (0.5 + n.vel * 0.5));
    }
    g2.restore();

    // --- vibrating strings ---
    g2.save();
    g2.globalCompositeOperation = 'lighter';
    g2.lineCap = 'round';
    const tv = reduceMotion ? 0 : performance.now() / 1000;
    for (let m = 21; m <= 108; m++) {
      const e = strEnv[m];
      if (e < 0.012) continue;
      const k = keys[m], np = npVis[m], col = strCol[m];
      const y0 = hamY - 12, y1 = bridgeY(k.cx), Ls = y0 - y1;
      const amp = Math.min(ww * 1.5, 10) * Math.min(1, e * 1.4);
      const base = 2 * Math.PI * (3.2 + 2.4 * Math.log2(np.f0 / 27.5));
      const beta = np.beta;
      g2.beginPath();
      const segs = 26;
      for (let j = 0; j <= segs; j++) {
        const u = j / segs;
        let d = 0;
        for (let q = 1; q <= 5; q++) {
          const wq = Math.abs(Math.sin(q * Math.PI * beta)) / q;
          d += wq * Math.sin(q * Math.PI * u) * Math.cos(base * q * Math.sqrt(1 + np.B * q * q * 400) * tv + q * 1.7 + m);
        }
        const x = k.cx + d * amp, y = y0 - u * Ls;
        if (j === 0) g2.moveTo(x, y); else g2.lineTo(x, y);
      }
      g2.strokeStyle = rgba(col, Math.min(0.35, e * 0.5));
      g2.lineWidth = 5 + e * 5; g2.stroke();
      g2.strokeStyle = rgba(col, Math.min(1, 0.3 + e * 1.2));
      g2.lineWidth = m < 40 ? 1.8 : 1.1; g2.stroke();
      // strike flash at the hammer line
      if (hamBump[m] > 0.01) {
        const rg = g2.createRadialGradient(k.cx, y0, 0, k.cx, y0, 26);
        rg.addColorStop(0, rgba(col, 0.55 * hamBump[m])); rg.addColorStop(1, rgba(col, 0));
        g2.fillStyle = rg; g2.fillRect(k.cx - 26, y0 - 26, 52, 52);
      }
    }
    g2.restore();

    // --- dampers ---
    const ped = A.started ? pedalAt(now) : false;
    const dy = hamY - 52;
    for (let m = 21; m < 89; m++) {
      const k = keys[m];
      const up = ped || keyState[m] || live.has(m);
      const w = Math.max(2, ww * 0.62);
      g2.fillStyle = up ? 'rgba(70,58,46,.55)' : '#1a1511';
      g2.fillRect(k.cx - w / 2, dy - (up ? 9 : 0), w, 13);
      g2.fillStyle = up ? 'rgba(210,190,150,.25)' : 'rgba(210,190,150,.12)';
      g2.fillRect(k.cx - w / 2, dy - (up ? 9 : 0), w, 2);
    }

    // --- hammers ---
    for (let m = 21; m <= 108; m++) {
      const k = keys[m];
      const lift = hamBump[m] * 9;
      const w = Math.max(2, ww * 0.7);
      g2.fillStyle = '#6b1f1f';
      g2.fillRect(k.cx - w / 2, hamY + 2 - lift, w, 8);
      g2.fillStyle = hamBump[m] > 0 ? '#f3ead6' : '#d4c7a8';
      g2.fillRect(k.cx - w / 2, hamY - 3 - lift, w, 6);
    }

    // --- keyboard ---
    const ky = H - kh;
    for (let m = 21; m <= 108; m++) {
      const k = keys[m]; if (k.black) continue;
      const on = keyState[m];
      const grd = g2.createLinearGradient(0, ky, 0, H);
      if (on) { grd.addColorStop(0, rgba(on, 0.95)); grd.addColorStop(1, rgba(on, 0.55)); }
      else { grd.addColorStop(0, '#e9e2d3'); grd.addColorStop(0.85, '#f6f1e6'); grd.addColorStop(1, '#cfc6b4'); }
      g2.fillStyle = grd;
      g2.fillRect(k.x + 0.5, ky + (on ? 2 : 0), k.w - 1, kh - (on ? 2 : 0));
    }
    for (let m = 21; m <= 108; m++) {
      const k = keys[m]; if (!k.black) continue;
      const on = keyState[m];
      const bh = kh * 0.62;
      g2.fillStyle = on ? rgba(on, 0.95) : '#15120f';
      g2.fillRect(k.x, ky, k.w, bh + (on ? 1 : 0));
      if (!on) { g2.fillStyle = 'rgba(255,255,255,.10)'; g2.fillRect(k.x + 1.5, ky, k.w - 3, bh * 0.82); g2.fillStyle = '#15120f'; g2.fillRect(k.x + 2, ky, k.w - 4, bh * 0.76); }
    }
    g2.fillStyle = 'rgba(0,0,0,.35)'; g2.fillRect(0, ky, W, 3);

    // --- HUD and panels ---
    updateHud(now);
    drawScope();
    // note info: the loudest strike since last frame
    if (A.started && lastNow >= 0 && now > lastNow) {
      let best = null;
      for (let i = lowerBound(lastNow); i < notes.length && notes[i].t <= now; i++) {
        const n = notes[i];
        const score_ = n.vel + (n.hand === 'R' ? 0.05 : 0);
        if (!best || score_ > best.s) best = { n, s: score_ };
      }
      if (best && now - lastNow < 0.5) showNoteInfo(best.n.midi, best.n.vel, best.n.hand);
    }
    lastNow = now;
    requestAnimationFrame(draw);
  }

  /* ================= HUD ================= */
  let hudCache = '';
  function updateHud(now) {
    const sec = sectionAt(now), mk = markAt(now), bar = barAt(now);
    const i1 = lowerBound(now), i0 = lowerBound(now - 1.2);
    let sum = 0, cnt = 0;
    for (let i = i0; i < i1; i++) { sum += notes[i].vel; cnt++; }
    const dyn = cnt ? dynName(sum / cnt) : (A.started ? '' : 'ff');
    const tempo = (mk.text.match(/♩ = \d+/) || [''])[0];
    const key = [sec.name, sec.sub, sec.key, dyn, bar, mk.text].join('|');
    if (key !== hudCache) {
      hudCache = key;
      $('#hudSec').textContent = sec.name;
      $('#hudSub').textContent = sec.sub + ' · ' + sec.key;
      $('#hudDyn').textContent = dyn;
      document.querySelectorAll('.seg').forEach((el, i) => el.classList.toggle('on', score.sections[i] === sec));
      document.querySelectorAll('#formTable tbody tr').forEach((el, i) => el.classList.toggle('on', score.sections[i] === sec));
    }
    $('#hudMeta').innerHTML = `Takt ${bar}<br>${mk.text.replace(/\s+/g, ' ')}<br>${A.voices} Tasten klingen`;
    $('#time').textContent = fmt(now);
    const f = Math.min(1, now / score.duration);
    $('#playhead').style.left = `calc(${(f * 100).toFixed(3)}% - 1px)`;
    $('#progress').style.width = (f * 100).toFixed(3) + '%';
    if (A.started && A.playing && now >= score.duration - 0.05) {
      A.started = false; setPlaying(false); A.from = 0; A.renderer.stop(); setStatus('終演 — もう一度再生できます');
    }
  }

  const scope = $('#scope'), sc = scope.getContext('2d');
  const scopeBuf = new Float32Array(2048);
  function drawScope() {
    const w = scope.width, h = scope.height;
    sc.clearRect(0, 0, w, h);
    sc.strokeStyle = 'rgba(242,212,143,.18)'; sc.lineWidth = 1;
    sc.beginPath(); sc.moveTo(0, h / 2); sc.lineTo(w, h / 2); sc.stroke();
    if (!A.analyser) return;
    A.analyser.getFloatTimeDomainData(scopeBuf);
    let st = 0;
    for (let i = 1; i < 1024; i++) if (scopeBuf[i - 1] < 0 && scopeBuf[i] >= 0) { st = i; break; }
    sc.strokeStyle = '#f2d48f'; sc.lineWidth = 2;
    sc.beginPath();
    for (let x = 0; x < w; x++) {
      const v = scopeBuf[st + Math.floor(x * 1000 / w)] || 0;
      const y = h / 2 - v * h * 0.9;
      x ? sc.lineTo(x, y) : sc.moveTo(x, y);
    }
    sc.stroke();
  }

  /* ================= note / hammer panel ================= */
  const forceCv = $('#force'), fc = forceCv.getContext('2d');
  const sup = (n) => String(n).replace(/[-0-9]/g, (d) => '⁻⁰¹²³⁴⁵⁶⁷⁸⁹'['-0123456789'.indexOf(d)]);
  let infoKey = '';
  function showNoteInfo(m, vel, hand) {
    const vb = Math.round(vel * 20) / 20;
    const key = m + '|' + vb + '|' + JSON.stringify(params);
    if (key === infoKey) return;
    infoKey = key;
    const fs = A.ctx ? A.fs : 48000;
    const np = PP.noteParams(m, fs, params);
    const h = PP.hammerForce(np, vb, fs);
    const nm = $('#nName');
    nm.textContent = np.name; nm.className = hand === 'L' ? 'L' : '';
    $('#nFreq').textContent = np.f0.toFixed(2) + ' Hz';
    const cents = PP.interp([[21, 0], [30, 0.5], [60, 0.95], [90, 1.25], [108, 1.6]], m) * params.detune;
    $('#nStr').textContent = np.nStr + ' 本 · ' + (np.nStr > 1 ? '±' + cents.toFixed(2) + ' ¢' : '—');
    const ex = Math.floor(Math.log10(np.B || 1e-9));
    $('#nB').textContent = np.B > 0 ? (np.B / Math.pow(10, ex)).toFixed(2) + ' × 10' + sup(ex) : '0（理想弦）';
    $('#nT60').textContent = np.T60.toFixed(1) + ' s';
    $('#nHam').textContent = (np.hm * 1000).toFixed(1) + ' g · ' + h.speed.toFixed(2) + ' m/s';
    $('#nCon').textContent = np.hp.toFixed(2) + ' · ' + h.contactMs.toFixed(2) + ' ms';
    $('#nPk').textContent = '1/' + (1 / np.beta).toFixed(1) + ' · ' + h.peak.toFixed(1) + ' N';
    drawForce(h, fs, hand);
  }
  function drawForce(h, fs, hand) {
    const w = forceCv.width, ht = forceCv.height, padL = 64, padB = 40, padT = 18, padR = 14;
    fc.clearRect(0, 0, w, ht);
    const F = h.F, tMax = Math.max(2, Math.ceil((F.length / fs) * 1000 + 0.3));
    const fMax = Math.max(1, h.peak) * 1.15;
    const X = (ms) => padL + (ms / tMax) * (w - padL - padR);
    const Y = (f) => ht - padB - (f / fMax) * (ht - padB - padT);
    fc.font = '20px JetBrains Mono, monospace'; fc.fillStyle = '#9b9285'; fc.strokeStyle = 'rgba(255,255,255,.07)'; fc.lineWidth = 1;
    const stepT = tMax <= 3 ? 0.5 : tMax <= 6 ? 1 : 2;
    for (let t = 0; t <= tMax + 1e-9; t += stepT) { fc.beginPath(); fc.moveTo(X(t), padT); fc.lineTo(X(t), ht - padB); fc.stroke(); fc.textAlign = 'center'; fc.fillText(t.toFixed(stepT < 1 ? 1 : 0), X(t), ht - padB + 26); }
    const nice = [1, 2, 5, 10, 20, 50, 100]; let stepF = nice.find((s) => fMax / s <= 4.5) || 200;
    for (let f = 0; f <= fMax; f += stepF) { fc.beginPath(); fc.moveTo(padL, Y(f)); fc.lineTo(w - padR, Y(f)); fc.stroke(); fc.textAlign = 'right'; fc.fillText(String(f), padL - 10, Y(f) + 7); }
    fc.textAlign = 'right'; fc.fillText('ms', w - padR, ht - 4);
    fc.textAlign = 'left'; fc.fillText('N', 8, padT + 6);
    const col = hand === 'L' ? '#e4814f' : hand === 'live' ? '#c3cbd1' : '#f2d48f';
    fc.beginPath(); fc.moveTo(X(0), Y(0));
    for (let i = 0; i < F.length; i++) fc.lineTo(X(i / fs * 1000), Y(F[i]));
    fc.lineTo(X(F.length / fs * 1000), Y(0)); fc.closePath();
    fc.fillStyle = hand === 'L' ? 'rgba(228,129,79,.18)' : 'rgba(242,212,143,.16)'; fc.fill();
    fc.beginPath();
    for (let i = 0; i < F.length; i++) { const x = X(i / fs * 1000), y = Y(F[i]); i ? fc.lineTo(x, y) : fc.moveTo(x, y); }
    fc.strokeStyle = col; fc.lineWidth = 3; fc.stroke();
  }

  /* ================= timeline & form table ================= */
  const tl = $('#tlbar');
  const tbody = $('#formTable tbody');
  score.sections.forEach((s, i) => {
    const el = document.createElement('button');
    el.type = 'button'; el.className = 'seg';
    el.style.flex = String(s.t1 - s.t0);
    const first = i === 0 || score.sections[i - 1].name !== s.name;
    el.innerHTML = `<span class="n">${first ? s.name : s.sub}</span><span class="k">${first ? s.sub : s.key}</span>`;
    el.title = `${s.name} — ${s.sub}（${fmt(s.t0)}〜）`;
    el.addEventListener('click', (ev) => {
      const r = el.getBoundingClientRect();
      const f = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
      seek(ev.detail === 0 ? s.t0 : s.t0 + f * (s.t1 - s.t0) * 0.98);
    });
    tl.appendChild(el);
    const lastBar = i + 1 < score.sections.length ? score.sections[i + 1].bar - 1 : 90;
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${first ? s.name : ''}</td><td>${s.sub}</td><td>${s.key}</td><td class="num">${s.bar}–${lastBar}</td>`;
    tbody.appendChild(tr);
  });

  /* ================= controls ================= */
  const ctl = [
    ['pHard', 'oHard', 'hardness'], ['pInh', 'oInh', 'inharm'], ['pDet', 'oDet', 'detune'], ['pDec', 'oDec', 'decay'],
  ];
  function pushParams() {
    for (const [id, out, key] of ctl) { params[key] = +$('#' + id).value; $('#' + out).textContent = params[key].toFixed(2); }
    if (A.renderer) A.renderer.setParams(Object.assign({}, params));
    infoKey = '';
  }
  for (const [id] of ctl) $('#' + id).addEventListener('input', pushParams);
  $('#pRev').addEventListener('input', () => {
    const v = +$('#pRev').value; $('#oRev').textContent = v.toFixed(2);
    if (A.wet) A.wet.gain.setTargetAtTime(v * 0.55, A.ctx.currentTime, 0.05);
  });
  function setCtl(vals) {
    const map = { hardness: 'pHard', inharm: 'pInh', detune: 'pDet', decay: 'pDec' };
    for (const k in vals) if (map[k]) $('#' + map[k]).value = vals[k];
    pushParams();
    if (vals.rev != null) { $('#pRev').value = vals.rev; $('#pRev').dispatchEvent(new Event('input')); }
  }
  $('#pReset').addEventListener('click', () => setCtl({ hardness: 1, inharm: 1, detune: 1, decay: 1, rev: 0.35 }));
  $('#pFortepiano').addEventListener('click', () => setCtl({ hardness: 1.32, inharm: 0.45, detune: 2.2, decay: 0.42, rev: 0.22 }));
  pushParams();

  /* ================= keyboard interaction ================= */
  function keyAt(x, y) {
    if (y < H - kh) return null;
    const inBlack = y < H - kh + kh * 0.62;
    if (inBlack) for (let m = 21; m <= 108; m++) { const k = keys[m]; if (k.black && x >= k.x && x <= k.x + k.w) return { m, v: (y - (H - kh)) / (kh * 0.62) }; }
    for (let m = 21; m <= 108; m++) { const k = keys[m]; if (!k.black && x >= k.x && x < k.x + k.w) return { m, v: (y - (H - kh)) / kh }; }
    return null;
  }
  const pointers = new Map();
  stage.addEventListener('pointerdown', (e) => {
    const r = stage.getBoundingClientRect();
    const k = keyAt(e.clientX - r.left, e.clientY - r.top);
    if (!k) return;
    e.preventDefault();
    stage.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, k.m);
    liveOn(k.m, 0.3 + 0.62 * Math.max(0, Math.min(1, k.v)));
  });
  const endPtr = (e) => { const m = pointers.get(e.pointerId); if (m != null) { liveOff(m); pointers.delete(e.pointerId); } };
  stage.addEventListener('pointerup', endPtr);
  stage.addEventListener('pointercancel', endPtr);
  stage.addEventListener('pointermove', (e) => {
    const r = stage.getBoundingClientRect();
    stage.style.cursor = keyAt(e.clientX - r.left, e.clientY - r.top) ? 'pointer' : 'default';
  });

  const KEYMAP = { a: 0, w: 1, s: 2, e: 3, d: 4, f: 5, t: 6, g: 7, y: 8, h: 9, u: 10, j: 11, k: 12, o: 13, l: 14, p: 15, ';': 16 };
  let octave = 60;
  const held = new Map();
  window.addEventListener('keydown', (e) => {
    const tg = e.target.tagName;
    if (tg === 'INPUT' || tg === 'TEXTAREA' || (tg === 'BUTTON' && (e.key === ' ' || e.key === 'Enter'))) return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key === ' ') { e.preventDefault(); togglePlay(); return; }
    const k = e.key.toLowerCase();
    if (k === 'z') { octave = Math.max(24, octave - 12); return; }
    if (k === 'x') { octave = Math.min(96, octave + 12); return; }
    if (KEYMAP[k] == null || e.repeat || held.has(k)) return;
    const m = octave + KEYMAP[k];
    held.set(k, m);
    liveOn(m, e.shiftKey ? 0.9 : 0.62);
  });
  window.addEventListener('keyup', (e) => {
    const k = e.key.toLowerCase();
    const m = held.get(k);
    if (m != null) { held.delete(k); liveOff(m); }
  });

  /* ================= boot ================= */
  layout();
  new ResizeObserver(() => { const r = stage.parentElement.getBoundingClientRect(); if (Math.abs(r.width - W) > 1) layout(); }).observe(stage.parentElement);
  showNoteInfo(60, 0.55, 'R');
  requestAnimationFrame(draw);
})();
