/*
 * 測ったフォルマント（その人の母音の共鳴）に合うように、物理モデルの声道の形を求め直す。
 * ブラウザ（録音画面）と Node（tools/make-pack.js）の両方で使う。
 *
 * 1. 声道の長さを推定する: F2・F3 は長さにほぼ反比例するので、基準（15 cm）との比から決める。
 * 2. その長さの管で、断面積（16 点）を少しずつ変えては共鳴を計算し、測った F1–F3 に近づける。
 *    共鳴の計算は歌うときと同じ声道モデルにインパルスを入れて求めるので、歌ったときの共鳴と一致する。
 * 3. 高い音で口を開く変種（F1 を上げた形）も、その人の母音から同じ決まりで作る。
 */
(function (root) {
  'use strict';
  // 基準の目標（声道 15 cm）と、F1 を持ち上げた変種の差分 [Hz]
  const BASE = { a: [900, 1400, 2900], i: [330, 2700, 3300], u: [400, 1500, 2700], e: [560, 2300, 3000], o: [560, 950, 2900], x: [620, 1750, 2900] };
  // 高い音で口を開いた変種: F1 を 100 Hz 上げるごとに F2・F3 をどれだけ動かすか。F1 が FMAX（15 cm の管で）に届くまで、125 Hz 以下の刻みで作る
  const SLOPE = { a: [0, 0], i: [-120, -45], u: [15, 15], e: [-90, 0], o: [280, 0] }, FMAX = 690, STEP = 125;
  const FIT_VERSION = 3; // 合わせ方を変えたら上げる（古い結果は録音画面で合わせ直しを促す）
  const ORDER = ['a', 'i', 'u', 'e', 'o', 'x'];

  function fft(re, im) { const n = re.length; for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
    for (let len = 2; len <= n; len <<= 1) { const a = -2 * Math.PI / len; for (let i = 0; i < n; i += len) for (let k = 0; k < len / 2; k++) { const c = Math.cos(a * k), s = Math.sin(a * k), x = re[i + k + len / 2], y = im[i + k + len / 2]; const tr = x * c - y * s, ti = x * s + y * c; re[i + k + len / 2] = re[i + k] - tr; im[i + k + len / 2] = im[i + k] - ti; re[i + k] += tr; im[i + k] += ti; } } }

  // 声道の長さ [m]: 測った F2・F3 と基準との比（対数の平均）から
  // 比は平均でなく中央値で取る（1 つの母音の測定が外れていても、長さが引きずられないように）
  function lenRatio(meas) { const a = []; for (const v in meas) if (BASE[v] && meas[v]) for (const k of [1, 2]) a.push(Math.log(meas[v][k] / BASE[v][k])); a.sort((x, y) => x - y); return a.length ? Math.exp((a[(a.length - 1) >> 1] + a[a.length >> 1]) / 2) : 1; }
  function estimateLength(meas) { return Math.max(0.115, Math.min(0.175, 0.150 / lenRatio(meas))); }
  // ほかの母音と合わない測定（F2 か F3 の比が全体の比から 4 割近く外れている）。合わせるときは使わず、長さからの推定に任せる
  function outliers(meas) { const r = lenRatio(meas), out = []; for (const v in meas) if (BASE[v] && meas[v] && [1, 2].some(k => Math.abs(Math.log(meas[v][k] / BASE[v][k] / r)) > 0.33)) out.push(v); return out; }

  function makeFitter(voiceEngineFactory) {
    const { Voice, VOWELS } = voiceEngineFactory(), fs = 48000, n = 2048;
    // meas: { a: [F1, F2, F3], i: …, … }（測れた母音だけでよい）  progress(0..1, 文字列)
    async function fit(meas, progress, opt) {
      opt = opt || {}; const dropped = outliers(meas); if (dropped.length) { meas = Object.assign({}, meas); for (const v of dropped) delete meas[v]; }
      const len = opt.len || estimateLength(meas), k = 0.150 / len;
      const v = new Voice(fs, { tractLength: len }); v.freeze = true; v.set('breath', 0); v.aspGain = 0; v.reverbMix = 0; v.flutter = 0;
      const L = new Float32Array(n), R = new Float32Array(n), re = new Float64Array(n), im = new Float64Array(n), m = new Float64Array(n / 2);
      function formants(pts) {
        v.R.fill(0); v.L.fill(0); v.lipLp = 0; v.Uprev = 0; v.hp[0] = v.hp[1] = 0; v.t1 = v.t2 = 0; v.env = 0; v.stepCount = 0;
        v.setShape(pts); v.inj = 1000; v.process(L, R, 0, n);
        let c = 0; for (let i = 0; i < n; i++) { c += L[i]; re[i] = c * (0.5 - 0.5 * Math.cos(Math.PI * (1 + i / n))); im[i] = 0; }
        fft(re, im); for (let i = 0; i < n / 2; i++) m[i] = Math.hypot(re[i], im[i]);
        const out = [];
        for (let i = 3; i < n / 2 - 1; i++) { if (i * fs / n > 5800) break;
          if (m[i] > m[i - 1] && m[i] >= m[i + 1]) {
            let lo = m[i], hi = m[i]; for (let j = i - 1; j > 0 && m[j] <= m[i]; j--) if (m[j] < lo) lo = m[j]; for (let j = i + 1; j < n / 2 && m[j] <= m[i]; j++) if (m[j] < hi) hi = m[j];
            if (m[i] / Math.max(lo, hi) < 1.25) continue;
            const a = Math.log(m[i - 1]), b = Math.log(m[i]), c2 = Math.log(m[i + 1]); out.push((i + 0.5 * (a - c2) / (a - 2 * b + c2)) * fs / n); } }
        return out;
      }
      function cost(pts, T, prior, lam) {
        const F = formants(pts); if (F.length < 3) return 1e9;
        let e = 0; const w = [1, 1, 0.25];
        for (let q = 0; q < 3; q++) { const d = 12 * Math.log2(F[q] / T[q]); e += w[q] * d * d; }
        for (let i = 0; i < pts.length; i++) { const d = Math.log(pts[i] / prior[i]); e += lam * d * d; }
        for (let i = 1; i < pts.length - 1; i++) { const d = Math.log(pts[i - 1]) - 2 * Math.log(pts[i]) + Math.log(pts[i + 1]); e += 0.15 * d * d; }
        return e;
      }
      let seed = 7; const rnd = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; };
      const SL = Object.assign({}, SLOPE, opt.slope || {}); const plan = []; for (const name of ORDER) { const T0 = meas[name] || BASE[name].map(f => f * k); plan.push({ name, q: 0, T: T0, measured: !!meas[name] }); if (SL[name] && T0[0] < FMAX * k) { const steps = Math.ceil((FMAX * k - T0[0]) / (STEP * k)), d = (FMAX * k - T0[0]) / steps; for (let q = 1; q <= steps; q++) plan.push({ name, q, T: [T0[0] + q * d, T0[1] + SL[name][0] * q * d / 100, T0[2] + SL[name][1] * q * d / 100] }); } }
      const total = plan.reduce((s, p) => s + (p.q === 0 ? (opt.iters || 1500) : (opt.itersVar || 700)), 0); let done = 0;
      const table = {}, report = []; let prev = null;
      for (const p of plan) {
        const iters = p.q === 0 ? (opt.iters || 1500) : (opt.itersVar || 700), lam = p.q === 0 ? 0.02 : 0.05;
        const init = p.q === 0 ? VOWELS[p.name][0].pts.slice() : prev;
        let best = init.slice(), bc = cost(best, p.T, init, lam);
        for (let it = 0; it < iters; it++) {
          const c = best.slice(), s = 0.25 * (1 - it / iters) + 0.03, j = 2 + Math.floor(rnd() * (c.length - 2)), w = 1 + Math.floor(rnd() * 3), d = (rnd() * 2 - 1) * s;
          for (let q = -w; q <= w; q++) { const i = j + q; if (i < 2 || i >= c.length) continue; c[i] = Math.min(7, Math.max(0.2, c[i] * Math.exp(d * (1 - Math.abs(q) / (w + 1))))); }
          const cc = cost(c, p.T, init, lam); if (cc < bc) { bc = cc; best = c; }
          if (++done % 40 === 0) { if (progress) progress(done / total, p.name); await new Promise(r => setTimeout(r, 0)); }
        }
        const pts = best.map(x => +x.toFixed(3)), F = formants(pts);
        (table[p.name] = table[p.name] || []).push({ f1: Math.round(F[0]), pts }); prev = pts;
        report.push({ name: p.name, q: p.q, measured: !!p.measured, target: p.T.map(Math.round), got: F.slice(0, 3).map(Math.round) });
      }
      if (progress) progress(1, '');
      return { len, table, report, dropped, ver: FIT_VERSION };
    }
    return { fit, estimateLength };
  }

  const api = { outliers, makeFitter, estimateLength, BASE, FIT_VERSION };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.FableVowelFit = api;
})(typeof self !== 'undefined' ? self : this);
