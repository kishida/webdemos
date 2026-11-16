/*
 * 鼻音（な・ま行）・ら行・半母音（や・わ）を、その人の録音に合わせる。
 * ブラウザ（録音画面）と Node（tools/make-pack.js）の両方で使う。
 *
 * これらの子音は声が鳴ったまま舌や唇が動く音なので、録音を重ねることはできない（歌の高さと合わない）。
 * 代わりに、録音「あな」から 子音の長さ と 沈みの深さ を測り（sampler.js の analyzeSon）、
 * 物理モデルに同じ「あな」を歌わせて同じ測り方で調べ、動きの時間や大きさを変えて録音に近づける。
 *
 *   鼻音 n・m : hold = 舌や唇で閉じている時間 → 長さ,   gain = 鼻から出る音の大きさ → 低い帯域の音量,  lp = 鼻から出る音のこもり具合 → 高い帯域の音量
 *   ら行 r    : hold = 舌先が触れている時間 → 長さ,     area = 触れるときに残るすき間 → 深さ
 *   半母音 y・w: out = 母音へ開く時間 → 長さ,           amt = 「い」「う」の形へどこまで寄るか → 深さ
 */
(function (root) {
  'use strict';
  // それぞれの子音で動かす量: [名前, 最小, 最大, 初期値, 合わせる測定値]。この順に 1 つずつ合わせ、2 回くり返す
  const NAS = [['lp', 300, 2500, 500, 'hi'], ['gain', 0.05, 2, 0.5, 'lo'], ['hold', 0.03, 0.16, 0.07, 'dur']];
  const GLD = [['amt', 0.1, 1, 1, 'depth'], ['out', 0.05, 0.4, 0.18, 'dur']];
  const CTRL = { n: NAS, m: NAS, r: [['hold', 0.012, 0.07, 0.025, 'dur'], ['area', 0.1e-4, 0.4e-4, 0.12e-4, 'depth']], y: GLD, w: GLD };
  const SON_VERSION = 2;

  // deps: { voiceEngineFactory, hostFactory, buildSong, analyzeSon, keyShift }
  function makeFitter(deps) {
    const fs = 48000, Voice = deps.voiceEngineFactory().Voice, Host = deps.hostFactory();
    class NoPiano { setParam() {} allOff() {} noteOn() {} noteOff() {} pedal() {} process(L, R, n) { for (let i = 0; i < n; i++) L[i] = R[i] = 0; } }
    const h = new Host(NoPiano, Voice, fs); h.pianoVol = 0;
    // モデルに「あ＋子音＋あ」を歌わせて測る。sn: その子音の動き。vowels: その人の母音（なければ基準）
    function measure(c, sn, vowels, kind) {
      const shift = deps.keyShift ? deps.keyShift(vowels) : 0;
      const song = deps.buildSong({ voice: kind || 'male', shift, son: { [c]: sn }, score: [['C', [['A3', 2, 'a', ''], ['A3', 3, c + 'a', ''], ['-', 3]]]] });
      h.msg({ type: 'voice', kind: kind || 'male', vowels: vowels || null }); h.msg({ type: 'breath', value: 6 }); h.voice.reverbMix = 0; h.voice.flutter = 0;
      h.msg({ type: 'load', events: song.events, dur: song.dur }); h.msg({ type: 'play', t: 0 });
      const t2 = song.voice[1].t, n = Math.round((t2 + 0.8) * fs), L = new Float32Array(n), R = new Float32Array(n);
      for (let i = 0; i < n; i += 480) { const k = Math.min(480, n - i); h.process(L.subarray(i, i + k), R.subarray(i, i + k), k); }
      const a = deps.analyzeSon(L, fs, Math.round((song.voice[0].t + 0.12) * fs), n); a.x = L; a.t2 = t2;
      return a;
    }
    // meas: { n: { dur, depth, lo, … }, … }（録音を analyzeSon で測ったもの。子音の字がキー）
    // meas: { n: { dur, depth, lo, … }, … }（録音を analyzeSon で測ったもの。子音の字がキー）
    // 動かす量を 1 つずつ、範囲の中の 6 点とその近くで試し、録音との差（長さは 10 ms、音量は 3 dB を同じ重みとした 2 乗和）が
    // いちばん小さい値を選ぶ。これを 2 回くり返す。
    async function fit(meas, opt, progress) {
      opt = opt || {}; const out = {}, report = [], cs = Object.keys(meas).filter(c => CTRL[c]); let done = 0; const total = cs.reduce((s, c) => s + CTRL[c].length * 20 + 2, 0);
      for (const c of cs) {
        const T = meas[c], C = CTRL[c], sn = {}; for (const q of C) sn[q[0]] = q[3];
        const keys = C.map(q => q[4]);
        const err = m => { if (!m.ok) return 1e9; let e = 0; for (const k of keys) { const d = (m[k] - T[k]) / (k === 'dur' ? 0.01 : 3); e += d * d; } return e; };
        const run = async () => { const m = measure(c, sn, opt.vowels, opt.kind); done++; if (progress) progress(Math.min(1, done / total), c); await new Promise(r => setTimeout(r, 0)); return err(m); };
        let best = await run();
        for (let pass = 0; pass < 2; pass++) for (const [name, lo, hi] of C) {
          const log = hi / lo > 20, at = t => log ? lo * Math.pow(hi / lo, t) : lo + (hi - lo) * t, cur = sn[name]; let bv = cur, bt = log ? Math.log(cur / lo) / Math.log(hi / lo) : (cur - lo) / (hi - lo);
          const tryV = async (v, t) => { sn[name] = v; const e = await run(); if (e < best) { best = e; bv = v; bt = t; } };
          for (let i = 0; i < 6; i++) await tryV(at(i / 5), i / 5);
          { const t0 = bt; for (const dt of [-0.1, 0.1]) { const t = t0 + dt; if (t > 0 && t < 1) await tryV(at(t), t); else done++; }
            const t1 = bt; for (const dt of [-0.05, 0.05]) { const t = t1 + dt; if (t > 0 && t < 1) await tryV(at(t), t); else done++; } }
          sn[name] = bv;
        }
        const m = measure(c, sn, opt.vowels, opt.kind);
        out[c] = {}; for (const [name] of C) out[c][name] = +sn[name].toPrecision(3);
        const pick = q => { const o = {}; for (const k of keys) o[k] = +q[k].toFixed(k === 'dur' ? 3 : 1); return o; };
        report.push({ c, target: pick(T), got: m.ok ? pick(m) : null });
      }
      if (progress) progress(1, '');
      return { table: out, report, ver: SON_VERSION };
    }
    return { fit, measure };
  }

  const api = { makeFitter, CTRL, SON_VERSION };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.FableSonFit = api;
})(typeof self !== 'undefined' ? self : this);
