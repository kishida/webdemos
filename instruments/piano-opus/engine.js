/*
 * PianoPhysics — a physical-modeling piano.
 *
 *   Hammer : nonlinear felt  F = K·c^p·(1 + α·ċ), simulated against the string's
 *            wave impedance with reflections from both string terminations.
 *   String : digital waveguide (single delay loop) per unison string —
 *            delay line + one-pole loss filter + M first-order dispersion
 *            allpasses (stiffness / inharmonicity B) + Thiran fine tuning.
 *   Damper : per-key loss switch, smoothed; top octave+ has no dampers.
 *   Bridge : summed string velocity × impedance → stereo, DC-blocked.
 *   (Soundboard + hall are applied afterwards by convolution in the page.)
 *
 * Works in a window, a Worker and Node (no DOM use).
 */
(function (root) {
  'use strict';

  const LN1000 = Math.log(1000);
  const TAU = Math.PI * 2;
  const OUT_GAIN = 0.0105;

  /* ---------- tables over MIDI number (A0 = 21 … C8 = 108) ---------- */
  const B_TAB = [[21, 4.0e-4], [33, 2.2e-4], [45, 1.4e-4], [57, 2.4e-4], [69, 6.5e-4], [81, 1.9e-3], [93, 5.5e-3], [108, 1.7e-2]];
  const T60_TAB = [[21, 24], [36, 17], [48, 13], [60, 10], [72, 6], [84, 3.1], [96, 1.5], [108, 0.6]];
  const T60HI_TAB = [[21, 1.1], [48, 1.0], [72, 0.9], [96, 0.6], [108, 0.25]];
  const T60D_TAB = [[21, 0.55], [48, 0.32], [72, 0.17], [88, 0.11]];
  const DET_TAB = [[21, 0.0], [30, 0.5], [60, 0.95], [90, 1.25], [108, 1.6]];
  const HM_TAB = [[21, 0.0090], [36, 0.0052], [60, 0.0031], [84, 0.0024], [108, 0.0019]];
  const HP_TAB = [[21, 2.2], [36, 2.3], [60, 2.5], [84, 2.8], [108, 3.1]];
  const HK_TAB = [[21, 1.4e8], [36, 6.0e8], [60, 4.5e9], [84, 6.0e10], [108, 9.0e11]];
  const Z_TAB = [[21, 9.0], [36, 5.0], [48, 2.9], [60, 2.3], [108, 1.8]];
  const BETA_TAB = [[21, 0.122], [72, 0.118], [90, 0.095], [108, 0.06]];
  const LEVEL_TAB = [[21, 0.85], [36, 0.95], [60, 1.15], [84, 1.45], [108, 1.5]];

  function interp(tab, m, log) {
    if (m <= tab[0][0]) return tab[0][1];
    for (let i = 1; i < tab.length; i++) {
      if (m <= tab[i][0]) {
        const m0 = tab[i - 1][0], v0 = tab[i - 1][1], m1 = tab[i][0], v1 = tab[i][1];
        const u = (m - m0) / (m1 - m0);
        return log ? v0 * Math.pow(v1 / v0, u) : v0 + (v1 - v0) * u;
      }
    }
    return tab[tab.length - 1][1];
  }

  const NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
  function noteName(m) { return NAMES[m % 12] + (Math.floor(m / 12) - 1); }

  const DEFAULT_PARAMS = { hardness: 1, inharm: 1, detune: 1, decay: 1 };

  /* Railsback-like stretch: about −32 ¢ at A0, +32 ¢ at C8 */
  function stretchCents(m) { const d = (m - 69) / 12; return d > 0 ? 3.0 * d * d : -2.0 * d * d; }

  /* phase delay (samples) of first-order allpass (a + z^-1)/(1 + a z^-1) */
  function apDelay(w, a) { return (w - 2 * Math.atan2(a * Math.sin(w), 1 + a * Math.cos(w))) / w; }
  /* one-pole lowpass (1-p)/(1 - p z^-1): magnitude and phase delay */
  function lpMag(p, w) { return (1 - p) / Math.sqrt(1 - 2 * p * Math.cos(w) + p * p); }
  function lpDelay(p, w) { return Math.atan2(p * Math.sin(w), 1 - p * Math.cos(w)) / w; }

  function bisect(f, lo, hi, it) {
    let flo = f(lo);
    for (let i = 0; i < (it || 60); i++) {
      const mid = 0.5 * (lo + hi), fm = f(mid);
      if ((fm > 0) === (flo > 0)) { lo = mid; flo = fm; } else hi = mid;
    }
    return 0.5 * (lo + hi);
  }

  /* Design one waveguide string tuned to f with inharmonicity B. */
  function designString(f, fs, B, M, T60, T60hi, fhi) {
    const w0 = TAU * f / fs, L = fs / f;
    const g0 = Math.exp(-LN1000 / (T60 * f));
    const gh = Math.exp(-LN1000 / (T60hi * f));
    const wh = TAU * Math.min(fhi, 0.45 * fs) / fs;
    let p = 0;
    if (wh > w0 * 1.05) {
      const R = gh / g0;
      p = bisect(pp => lpMag(pp, wh) / lpMag(pp, w0) - R, 0, 0.95);
    }
    const g = Math.min(0.99995, g0 / lpMag(p, w0));

    let a = 0;
    if (M > 0 && B > 0) {
      const nref = Math.floor(Math.min(4200, 0.33 * fs) / f);
      if (nref >= 2) {
        const nr = Math.min(nref, 32);
        const fn = nr * f * Math.sqrt(1 + B * nr * nr);
        const wn = TAU * fn / fs;
        if (wn < 0.95 * Math.PI) {
          const target = L * (1 - 1 / Math.sqrt(1 + B * nr * nr));
          const h = aa => M * (apDelay(w0, aa) - apDelay(wn, aa)) - target;
          a = h(-0.95) < 0 ? -0.95 : bisect(h, -0.95, 0);
        }
      }
    }
    let rest = L - lpDelay(p, w0) - (M > 0 ? M * apDelay(w0, a) : 0);
    while (rest < 2.0 && M > 0) { M--; rest = L - lpDelay(p, w0) - (M > 0 ? M * apDelay(w0, a) : 0); }
    if (M === 0) a = 0;
    let N = Math.floor(rest - 0.5);
    if (N < 1) N = 1;
    const d = rest - N;
    const eta = bisect(e => apDelay(w0, e) - d, -0.95, 0.95);
    return { f, N, g, p, a, M, eta, T60 };
  }

  const npCache = new Map();
  function noteParams(m, fs, params) {
    params = params || DEFAULT_PARAMS;
    const key = m + '|' + fs + '|' + params.hardness + '|' + params.inharm + '|' + params.detune + '|' + params.decay;
    let np = npCache.get(key);
    if (np) return np;
    const f0 = 440 * Math.pow(2, (m - 69) / 12) * Math.pow(2, stretchCents(m) / 1200);
    const nStr = m < 28 ? 1 : m < 40 ? 2 : 3;
    const B = interp(B_TAB, m, true) * params.inharm;
    let M = m < 33 ? 6 : m < 45 ? 4 : m < 57 ? 3 : m < 69 ? 2 : m < 96 ? 1 : 0;
    if (B <= 0) M = 0;
    const T60 = interp(T60_TAB, m, true) * params.decay;
    const T60hi = Math.min(interp(T60HI_TAB, m, true) * params.decay, T60 * 0.8);
    const fhi = Math.max(3000, 2.2 * f0);
    const cents = interp(DET_TAB, m, false) * params.detune;
    const offs = nStr === 1 ? [0] : nStr === 2 ? [-0.5, 0.5] : [-1, 0.12, 0.88];
    const decMul = nStr === 1 ? [1] : nStr === 2 ? [1, 0.82] : [1, 0.78, 1.18];
    const T60d = interp(T60D_TAB, m, false);
    const strings = offs.map((o, i) => {
      const fs_ = f0 * Math.pow(2, o * cents / 1200);
      const s = designString(fs_, fs, B, M, T60 * decMul[i], T60hi * decMul[i], fhi);
      s.gDamp = s.g * Math.exp(-LN1000 * (1 / T60d - 1 / s.T60) / s.f);
      return s;
    });
    np = {
      midi: m, name: noteName(m), f0, nStr, B, M, T60, T60d, strings,
      hm: interp(HM_TAB, m, true),
      hp: interp(HP_TAB, m, false),
      hK: interp(HK_TAB, m, true) * Math.pow(10, (params.hardness - 1) * 1.2),
      hAlpha: 0.06,
      Z: interp(Z_TAB, m, true),
      beta: interp(BETA_TAB, m, false),
      level: interp(LEVEL_TAB, m, false),
      pan: Math.max(-0.55, Math.min(0.55, (m - 64) / 40)),
      damperless: m >= 89,
    };
    if (npCache.size > 2000) npCache.clear();
    npCache.set(key, np);
    return np;
  }

  /* velocity 0..1 → hammer speed (m/s), ~0.35 … 5.6 */
  function hammerSpeed(vel) { return 0.35 * Math.pow(16, Math.max(0, Math.min(1, vel))); }

  /*
   * Hammer–string interaction. The string seen from the contact point is a
   * resistance 2Z per string (waves leave in both directions); the waves come
   * back inverted from the agraffe (after β/f0) and the bridge (after (1-β)/f0).
   */
  function hammerForce(np, vel, fs) {
    const OS = 4, dt = 1 / (fs * OS);
    const m = np.hm, K = np.hK, pe = np.hp, alpha = np.hAlpha;
    const Z2 = 2 * np.Z * np.nStr;
    const T1 = Math.max(1, Math.round(np.beta / np.f0 / dt));
    const T2 = Math.max(1, Math.round((1 - np.beta) / np.f0 / dt));
    const T12 = T1 + T2;
    const maxN = Math.ceil(0.03 / dt);
    const F = new Float64Array(maxN);
    const r = 0.96, r2 = 2 * r * r;
    let xh = 0, vh = hammerSpeed(vel), ys = 0, vs = 0;
    let contact = false, lastF = 0, n = 0, peak = 0, firstOff = -1;
    for (n = 0; n < maxN; n++) {
      let past = 0;
      if (n >= T1) past -= r * F[n - T1];
      if (n >= T2) past -= r * F[n - T2];
      if (n >= T12) past += r2 * F[n - T12];
      const c = xh - ys;
      let f = 0;
      if (c > 0) {
        f = K * Math.pow(c, pe) * (1 + alpha * (vh - vs));
        if (f < 0) f = 0;
      }
      F[n] = f;
      vs = (f + past) / Z2;
      ys += vs * dt;
      vh -= f / m * dt;
      xh += vh * dt;
      if (f > 0) { contact = true; lastF = n; if (f > peak) peak = f; }
      else if (contact && firstOff < 0) firstOff = n;
      if (contact && f === 0 && vh < 0 && n - lastF > T12 + 0.002 / dt) break;
    }
    const len = Math.ceil((lastF + 1) / OS) + 1;
    const out = new Float32Array(len);
    for (let i = 0; i < len; i++) {
      let s = 0;
      for (let k = 0; k < OS; k++) { const j = i * OS + k; if (j < maxN) s += F[j]; }
      out[i] = s / OS;
    }
    return { F: out, peak, contactMs: (firstOff > 0 ? firstOff : lastF) * dt * 1000, speed: hammerSpeed(vel) };
  }

  /* waveguide input from hammer force: direct wave + inverted agraffe reflection */
  function makeExcitation(np, vel, fs) {
    const h = hammerForce(np, vel, fs);
    const dB = Math.max(1, Math.round(np.beta * fs / np.f0));
    const len = h.F.length + dB;
    const exc = new Float32Array(len);
    const sc = 1 / (2 * np.Z * np.nStr);
    for (let i = 0; i < len; i++) {
      const a = i < h.F.length ? h.F[i] : 0;
      const b = i - dB >= 0 && i - dB < h.F.length ? h.F[i - dB] : 0;
      exc[i] = (a - b) * sc;
    }
    return { exc, h };
  }

  let seed = 12345;
  function rnd() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }

  /* ---------------------------------------------------------------- */
  class Voice {
    constructor(np) {
      this.np = np;
      this.strings = np.strings.map(s => ({
        N: s.N, buf: new Float32Array(s.N), idx: 0,
        g: s.g, gNat: s.g, gDamp: s.gDamp, gT: s.g,
        p: s.p, b: 1 - s.p, a: s.a, M: s.M,
        ax: new Float64Array(Math.max(1, s.M)), ay: new Float64Array(Math.max(1, s.M)),
        eta: s.eta, fx: 0, fy: 0, ls: 0,
      }));
      const ang = (np.pan + 1) * Math.PI / 4;
      this.gl = Math.cos(ang); this.gr = Math.sin(ang);
      this.scale = np.Z * np.level * OUT_GAIN;
      this.exc = null; this.excPos = 0;
      this.knock = null; this.knockPos = 0;
      this.active = false;
      this.keyDown = false;
      this.quiet = 0;
    }
    reset() {
      for (const s of this.strings) {
        s.buf.fill(0); s.idx = 0; s.ax.fill(0); s.ay.fill(0); s.fx = s.fy = s.ls = 0;
        s.g = s.gNat;
      }
    }
  }

  class Engine {
    constructor(fs, params) {
      this.fs = fs;
      this.params = Object.assign({}, DEFAULT_PARAMS, params || {});
      this.voices = new Array(128).fill(null);
      this.active = [];
      this.pedal = false;
      this.tmp = new Float32Array(128);
      this.eb = new Float32Array(128);
      // DC blocker / gentle highpass (2nd-order, ~32 Hz) per channel
      const w = TAU * 32 / fs, q = 0.707, al = Math.sin(w) / (2 * q), cw = Math.cos(w);
      const a0 = 1 + al;
      this.hp = { b0: (1 + cw) / 2 / a0, b1: -(1 + cw) / a0, b2: (1 + cw) / 2 / a0, a1: -2 * cw / a0, a2: (1 - al) / a0 };
      this.hs = [new Float64Array(4), new Float64Array(4)];
    }
    setParams(p) { Object.assign(this.params, p); }
    voiceFor(m) {
      let v = this.voices[m];
      const np = noteParams(m, this.fs, this.params);
      if (!v || (!v.active && v.np !== np)) { v = new Voice(np); this.voices[m] = v; }
      return v;
    }
    noteOn(m, vel) {
      if (m < 21 || m > 108) return;
      const v = this.voiceFor(m);
      const { exc, h } = makeExcitation(v.np, vel, this.fs);
      // re-strike of a ringing string: superpose (linear string)
      if (v.active && v.exc && v.excPos < v.exc.length) {
        const rem = v.exc.length - v.excPos, len = Math.max(rem, exc.length);
        const mix = new Float32Array(len);
        for (let i = 0; i < len; i++) mix[i] = (i < rem ? v.exc[v.excPos + i] : 0) + (i < exc.length ? exc[i] : 0);
        v.exc = mix;
      } else v.exc = exc;
      v.excPos = 0;
      // hammer/key knock: short low-passed noise burst into the bridge
      const kl = Math.round(0.014 * this.fs), kn = new Float32Array(kl);
      const amp = h.peak * 0.0009 * (m < 60 ? 1 : 1 + (m - 60) / 30);
      let lp = 0; const c = Math.exp(-TAU * 1400 / this.fs), tau = 0.0032 * this.fs;
      for (let i = 0; i < kl; i++) { lp = c * lp + (1 - c) * (rnd() * 2 - 1); kn[i] = lp * amp * Math.exp(-i / tau) * 4; }
      v.knock = kn; v.knockPos = 0;
      if (!v.active) { v.reset(); v.active = true; this.active.push(v); }
      v.keyDown = true;
      v.quiet = 0;
      this.updateDamper(v);
      return h;
    }
    noteOff(m) {
      const v = this.voices[m];
      if (!v) return;
      v.keyDown = false;
      this.updateDamper(v);
    }
    setPedal(down) {
      this.pedal = !!down;
      for (const v of this.active) this.updateDamper(v);
    }
    updateDamper(v) {
      const free = v.keyDown || this.pedal || v.np.damperless;
      for (const s of v.strings) s.gT = free ? s.gNat : s.gDamp;
    }
    /* add n frames into L/R starting at off */
    render(L, R, off, n) {
      while (n > 0) {
        const k = Math.min(n, 128);
        this.renderBlock(L, R, off, k);
        off += k; n -= k;
      }
    }
    renderBlock(L, R, off, n) {
      const tmp = this.tmp, eb = this.eb;
      const act = this.active;
      for (let vi = act.length - 1; vi >= 0; vi--) {
        const v = act[vi];
        for (let i = 0; i < n; i++) tmp[i] = 0;
        let hasExc = false;
        if (v.exc && v.excPos < v.exc.length) {
          hasExc = true;
          const ex = v.exc, ep = v.excPos, el = ex.length;
          for (let i = 0; i < n; i++) eb[i] = ep + i < el ? ex[ep + i] : 0;
          v.excPos += n;
        }
        const strs = v.strings;
        for (let si = 0; si < strs.length; si++) {
          const s = strs[si];
          s.g += (s.gT - s.g) * 0.12;
          const buf = s.buf, N = s.N, p = s.p, gb = s.g * s.b, a = s.a, M = s.M, ax = s.ax, ay = s.ay, eta = s.eta;
          let idx = s.idx, ls = s.ls, fx = s.fx, fy = s.fy;
          for (let i = 0; i < n; i++) {
            const o = buf[idx];
            let y = gb * o + p * ls; ls = y;
            for (let k = 0; k < M; k++) { const yk = a * (y - ay[k]) + ax[k]; ax[k] = y; ay[k] = yk; y = yk; }
            const yf = eta * (y - fy) + fx; fx = y; fy = yf;
            buf[idx] = hasExc ? yf + eb[i] : yf;
            if (++idx === N) idx = 0;
            tmp[i] += o;
          }
          s.idx = idx; s.ls = ls; s.fx = fx; s.fy = fy;
        }
        const sc = v.scale;
        let peak = 0;
        const kn = v.knock;
        for (let i = 0; i < n; i++) {
          let x = tmp[i] * sc;
          if (kn && v.knockPos < kn.length) x += kn[v.knockPos++];
          tmp[i] = x;
          const ax_ = x < 0 ? -x : x; if (ax_ > peak) peak = ax_;
        }
        const gl = v.gl, gr = v.gr;
        for (let i = 0; i < n; i++) { L[off + i] += tmp[i] * gl; R[off + i] += tmp[i] * gr; }
        if (!hasExc && peak < 2e-5) {
          if (++v.quiet > 24) { v.active = false; act.splice(vi, 1); }
        } else v.quiet = 0;
        if (!Number.isFinite(peak)) { v.active = false; act.splice(vi, 1); }
      }
      // highpass both channels
      const h = this.hp;
      for (let ch = 0; ch < 2; ch++) {
        const X = ch ? R : L, st = this.hs[ch];
        let x1 = st[0], x2 = st[1], y1 = st[2], y2 = st[3];
        for (let i = off; i < off + n; i++) {
          const x = X[i];
          const y = h.b0 * x + h.b1 * x1 + h.b2 * x2 - h.a1 * y1 - h.a2 * y2;
          x2 = x1; x1 = x; y2 = y1; y1 = y; X[i] = y;
        }
        st[0] = x1; st[1] = x2; st[2] = y1; st[3] = y2;
      }
    }
  }

  /*
   * Job: renders a time-ordered event list from startTime onward, chunk by chunk.
   * events: [{t, type:'on'|'off'|'ped', midi, vel, down}] sorted by t (seconds).
   */
  class Job {
    constructor(fs, events, startTime, params) {
      this.fs = fs;
      this.engine = new Engine(fs, params);
      this.events = events;
      this.startTime = startTime;
      this.frame = 0;
      let i = 0, ped = false;
      while (i < events.length && events[i].t < startTime) { if (events[i].type === 'ped') ped = events[i].down; i++; }
      this.ptr = i;
      this.engine.setPedal(ped);
    }
    get time() { return this.startTime + this.frame / this.fs; }
    renderChunk(n) {
      const L = new Float32Array(n), R = new Float32Array(n);
      const fs = this.fs, ev = this.events, e = this.engine;
      let pos = 0;
      while (pos < n) {
        let next = n;
        if (this.ptr < ev.length) {
          const ef = Math.round((ev[this.ptr].t - this.startTime) * fs) - this.frame;
          if (ef <= pos) {
            const x = ev[this.ptr++];
            if (x.type === 'on') e.noteOn(x.midi, x.vel);
            else if (x.type === 'off') e.noteOff(x.midi);
            else e.setPedal(x.down);
            continue;
          }
          if (ef < n) next = ef;
        }
        e.render(L, R, pos, next - pos);
        pos = next;
      }
      const startSec = this.time;
      this.frame += n;
      return { L, R, startSec, activeVoices: e.active.length };
    }
  }

  /* render one isolated note (for live playing) */
  function renderNote(m, vel, seconds, fs, params) {
    const e = new Engine(fs, params);
    const n = Math.round(seconds * fs);
    const L = new Float32Array(n), R = new Float32Array(n);
    e.setPedal(true);
    const h = e.noteOn(m, vel);
    e.render(L, R, 0, n);
    return { L, R, h };
  }

  root.PianoPhysics = {
    Engine, Job, noteParams, hammerForce, hammerSpeed, renderNote, noteName,
    DEFAULT_PARAMS, interp, stretchCents,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = root.PianoPhysics;
})(typeof self !== 'undefined' ? self : (typeof window !== 'undefined' ? window : globalThis));
