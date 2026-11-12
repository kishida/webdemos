/*
 * ピアノソナタ ハ短調《寓話》 — Piano Sonata in C minor "Fable"
 *   I.   Allegro con brio   (ハ短調・ソナタ形式)
 *   II.  Adagio cantabile   (変イ長調・三部形式)
 *   III. Presto agitato     (ハ短調・ロンド)
 *
 * 記法:  c5:q.  = 音名+オクターブ : 音価(w h q e s x, 付点 ., 3連 t)  音価は次の音に引き継がれる
 *        [c4 eb4 g4] 和音 / r 休符 / ^ アクセント / ! スタッカート / ~ タイ / | 小節線チェック
 *        {p} {ff} 強弱 / {sf} 次の音だけ強く / {<f:8} 8拍かけて f へ / {t=120} テンポ / {t>90:4} 4拍かけて 90 へ
 *        P ペダル踏み替え / * ペダルを離す
 */
(function (root) {
  'use strict';
  const DYN = { ppp: 22, pp: 32, p: 46, mp: 58, mf: 70, f: 88, ff: 106, fff: 120 };
  const DUR = { w: 4, h: 2, q: 1, e: 0.5, s: 0.25, x: 0.125 };
  const PC = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 };

  function pitch(s) {
    const m = /^([a-g])(#|b)?(\d)$/.exec(s);
    if (!m) throw new Error('bad pitch: ' + s);
    return 12 * (parseInt(m[3]) + 1) + PC[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
  }

  class Movement {
    constructor(title, sub, barLen, bpm) {
      this.title = title; this.sub = sub; this.barLen = barLen;
      this.beat = 0; this.notes = []; this.ped = []; this.tempo = [{ b: 0, bpm }]; this.sections = [];
      this.st = { R: { vel: DYN.mf, ramp: null }, L: { vel: DYN.mf, ramp: null } };
    }
    add(name, rh, lh, o) {
      o = o || {};
      if (name) this.sections.push({ b: this.beat, name });
      const eR = this.parse('R', rh, o), eL = this.parse('L', lh, o);
      if (Math.abs(eR - eL) > 1e-6) throw new Error(`${this.title} / ${name}: 右手 ${eR - this.beat} 拍, 左手 ${eL - this.beat} 拍`);
      this.beat = eR;
      return this;
    }
    parse(hand, src, o) {
      const st = this.st[hand], toks = src.match(/\[[^\]]*\]\S*|\S+/g) || [];
      let b = this.beat, dur = 1, sf = 0, last = [];
      const tr = o.tr || 0, oct = hand === 'R' ? o.rhOct : o.lhOct;
      const velAt = (bb) => {
        const r = st.ramp;
        if (r) { if (bb >= r.b1) { st.vel = r.v1; st.ramp = null; } else return r.v0 + (r.v1 - r.v0) * (bb - r.b0) / (r.b1 - r.b0); }
        return st.vel;
      };
      for (const tk of toks) {
        if (tk === '|') {
          const rel = (b - this.beat) / this.barLen;
          if (Math.abs(rel - Math.round(rel)) > 1e-6) throw new Error(`${this.title}: 小節線がずれています (${hand}, ${(b - this.beat).toFixed(3)} 拍目付近) …${src.slice(0, 60)}`);
          continue;
        }
        if (tk === 'P') { this.ped.push({ b, type: 'P' }); continue; }
        if (tk === '*') { this.ped.push({ b, type: '*' }); continue; }
        if (tk[0] === '{') {
          const c = tk.slice(1, -1); let m;
          if (DYN[c] !== undefined) { st.vel = DYN[c]; st.ramp = null; }
          else if (c === 'sf') sf = 22;
          else if ((m = /^[<>](\w+):([\d.]+)$/.exec(c))) { st.ramp = { b0: b, b1: b + parseFloat(m[2]), v0: velAt(b), v1: DYN[m[1]] }; }
          else if ((m = /^t=([\d.]+)$/.exec(c))) this.tempo.push({ b, bpm: parseFloat(m[1]) });
          else if ((m = /^t>([\d.]+):([\d.]+)$/.exec(c))) this.tempo.push({ b, bpm: parseFloat(m[1]), ramp: parseFloat(m[2]) });
          else throw new Error('bad control: ' + tk);
          continue;
        }
        let m = /^~(?::([whqesx])(\.*)(t)?)?$/.exec(tk);
        if (m) {
          if (m[1]) { dur = DUR[m[1]] * (2 - Math.pow(0.5, m[2].length)) * (m[3] ? 2 / 3 : 1); }
          for (const n of last) n.d += dur; b += dur; continue;
        }
        m = /^(\^)?(\[[^\]]+\]|r|[a-g](?:#|b)?\d)(?::([whqesx])(\.*)(t)?)?(!)?$/.exec(tk);
        if (!m) throw new Error(`${this.title}: 解釈できないトークン "${tk}"`);
        if (m[3]) dur = DUR[m[3]] * (2 - Math.pow(0.5, m[4].length)) * (m[5] ? 2 / 3 : 1);
        if (m[2] !== 'r') {
          let ps = (m[2][0] === '[' ? m[2].slice(1, -1).trim().split(/\s+/) : [m[2]]).map(p => pitch(p) + tr);
          if (oct) ps = ps.concat(ps.map(p => p + oct));
          ps.sort((x, y) => x - y);
          const acc = !!m[1] || sf > 0; const v = velAt(b) + (m[1] ? 12 : 0) + sf; sf = 0;
          last = ps.map((p, i) => {
            let vv = v;
            if (ps.length > 1) vv += hand === 'R' ? (i === ps.length - 1 ? 4 : -7) : (i === 0 ? 2 : -7);
            const n = { b, d: dur, m: p, v: vv, h: hand, stac: !!m[6], acc };
            this.notes.push(n); return n;
          });
        } else last = [];
        b += dur;
      }
      return b;
    }

    // 拍 → 秒 に変換して演奏データにする
    compile(seed, expr, spread) {
      if (expr === undefined) expr = 1; if (spread === undefined) spread = 1;
      const tp = [];
      this.tempo.sort((a, b) => a.b - b.b);
      let cur = this.tempo[0].bpm;
      for (const t of this.tempo) {
        if (t.ramp) { const steps = Math.max(1, Math.round(t.ramp * 4)); for (let i = 1; i <= steps; i++) tp.push({ b: t.b + t.ramp * (i - 1) / steps, bpm: cur + (t.bpm - cur) * i / steps }); }
        else tp.push({ b: t.b, bpm: t.bpm });
        cur = t.bpm;
      }
      tp.sort((a, b) => a.b - b.b);
      const segs = []; let time = 0;
      for (let i = 0; i < tp.length; i++) {
        segs.push({ b: tp[i].b, t: time, spb: 60 / tp[i].bpm });
        if (i + 1 < tp.length) time += (tp[i + 1].b - tp[i].b) * 60 / tp[i].bpm;
      }
      const T0 = (b) => { let s = segs[0]; for (let i = 1; i < segs.length && segs[i].b <= b + 1e-9; i++) s = segs[i]; return s.t + (b - s.b) * s.spb; };
      let rs = seed || 1;
      const rnd = () => { rs = (rs * 1664525 + 1013904223) >>> 0; return rs / 4294967296 - 0.5; };
      let rs2 = ((seed || 1) * 7919 + 17) >>> 0; // タイミング用の乱数（強弱の乱数列とは別）
      const rndT = () => { rs2 = (rs2 * 1664525 + 1013904223) >>> 0; return rs2 / 4294967296 - 0.5; };
      const gauss = () => (rndT() + rndT() + rndT()) * 2; // ほぼ標準正規

      // =================================================================
      //  演奏解釈: 楽譜の内容を調べ、そこから時間の取り方を決める
      //   expr   … テンポの取り方（間・ため・ルバート）の量。0 で楽譜どおり
      //   spread … 声部どうしのずらし（旋律と伴奏、和音の崩し）の量。0 で完全に同時
      // =================================================================
      const slow = this.tempo[0].bpm < 80, barLen = this.barLen, G = 0.25, N = Math.max(1, Math.ceil(this.beat / G - 1e-9));
      const near = (x, y) => Math.abs(x - y) < 1e-6, marks = [];
      // --- 楽譜の分析: 同じ拍の音をまとめ、旋律（右手最高音）とバス（左手最低音）を取り出す ---
      const groups = new Map();
      for (const n of this.notes) { n._o = 0; const key = Math.round(n.b * 960); let g = groups.get(key); if (!g) groups.set(key, g = { b: n.b, R: [], L: [] }); g[n.h].push(n); }
      const gl = [...groups.values()].sort((x, y) => x.b - y.b);
      for (const g of gl) { g.R.sort((x, y) => x.m - y.m); g.L.sort((x, y) => x.m - y.m); g.all = g.L.concat(g.R).sort((x, y) => x.m - y.m); }
      const mel = gl.filter(g => g.R.length).map(g => g.R[g.R.length - 1]);
      const bnd = [...new Set([0, ...this.sections.map(s => s.b), this.beat])].sort((x, y) => x - y);
      const named = new Set(this.sections.filter(s => s.name).map(s => Math.round(s.b * 960)));
      const written = this.tempo.filter(t => t.ramp).map(t => [t.b, t.b + t.ramp]); // 楽譜に書いた rit. の区間
      const inWritten = (b) => written.some(w => b >= w[0] - 1e-6 && b < w[1] + barLen);
      const mult = new Float64Array(N).fill(1), pause = new Float64Array(N + 1);
      const addPause = (b, sec, text) => { const k = Math.round(b / G); if (k > 0 && k <= N && sec > pause[k]) { if (!pause[k] && text) marks.push({ b, text }); pause[k] = sec; } };
      const addMult = (b0, b1, fn) => { for (let k = Math.max(0, Math.round(b0 / G)); k < Math.min(N, Math.round(b1 / G)); k++) mult[k] += fn((k * G - b0) / (b1 - b0)); };

      // (1) 楽節の終わり: 最後を少し広げ、次の楽節の前で息をつく（楽譜に rit. がある所は二重にしない）
      for (let i = 1; i < bnd.length; i++) {
        const s = bnd[i], big = i === bnd.length - 1 || named.has(Math.round(s * 960));
        if (inWritten(s - 1e-3)) continue;
        const r = slow ? barLen : barLen / 2, amp = (slow ? 0.16 : 0.05) * (big ? 1 : 0.4) * expr;
        addMult(s - r, s, x => amp * x * x);
        if (i < bnd.length - 1) addPause(s, (slow ? 0.10 : 0.035) * (big ? 1 : 0.35) * expr, big ? '息' : '');
      }
      // (2) 強弱の急変（f のあとの p、p のあとの ff）: 休符や小節線をはさむなら、一瞬の間を置いて入り直す
      for (let i = 1; i < mel.length; i++) {
        const p = mel[i - 1], n = mel[i], gap = n.b - (p.b + p.d) > 1e-6, bar = near(n.b / barLen, Math.round(n.b / barLen));
        if ((gap || bar) && Math.abs(n.v - p.v) >= 22) addPause(n.b, (slow ? 0.06 : 0.03) * expr, '間');
      }
      // (3) アクセント / sf: 打つ前に一瞬ためる
      for (const g of gl) if (g.all.some(n => n.acc)) addPause(g.b, (slow ? 0.03 : 0.012) * expr, '');
      // (4) 緩徐楽章のルバート: 4 小節のフレーズごとに、旋律の頂点へ向かって少し進み、頂点の前でため、終わりへ向かって緩む
      const peaks = new Set(), starts = new Set();
      if (slow) for (let i = 0; i + 1 < bnd.length; i++) {
        const nPh = Math.max(1, Math.round((bnd[i + 1] - bnd[i]) / barLen / 4)), pl = (bnd[i + 1] - bnd[i]) / nPh;
        for (let j = 0; j < nPh; j++) {
          const p0 = bnd[i] + j * pl, p1 = p0 + pl, ms = mel.filter(n => n.b >= p0 - 1e-6 && n.b < p1 - 1e-6);
          starts.add(Math.round(p0 * 960));
          if (!ms.length || inWritten(p0)) continue;
          const top = ms.reduce((x, y) => (y.m > x.m ? y : x)), xp = Math.max(0.15, Math.min(0.85, (top.b - p0) / pl));
          addMult(p0, p1, x => 0.10 * expr * (x < xp ? -0.45 * Math.sin(Math.PI * x / xp) : Math.pow((x - xp) / (1 - xp), 2)));
          if (top.b > p0 + 1e-6) { addPause(top.b, 0.04 * expr, 'ため'); peaks.add(Math.round(top.b * 960)); }
        }
      }
      // (5) 緩徐楽章: 不協和な（短2度・三全音を含む）和声の小節は少し時間をかける
      if (slow) for (let b0 = 0; b0 < this.beat - 1e-6; b0 += barLen) {
        const pcs = [...new Set(this.notes.filter(n => n.b >= b0 - 1e-6 && n.b < b0 + barLen - 1e-6).map(n => n.m % 12))]; let ten = 0;
        for (let i = 0; i < pcs.length; i++) for (let j = i + 1; j < pcs.length; j++) { const ic = Math.min((pcs[i] - pcs[j] + 12) % 12, (pcs[j] - pcs[i] + 12) % 12); if (ic === 1 || ic === 6) ten++; }
        if (ten > 1) addMult(b0, b0 + barLen, () => 0.035 * expr * Math.min(1, (ten - 1) / 3));
      }
      const W = new Float64Array(N + 1);
      for (let k = 0; k < N; k++) { W[k] += pause[k]; W[k + 1] = W[k] + (T0(k * G + G) - T0(k * G)) * mult[k]; }
      const T = (b) => { const x = Math.min(N, Math.max(0, b / G)), k = Math.min(N - 1, Math.floor(x)); return W[k] + (W[k + 1] - W[k]) * (x - k); };

      // --- 声部どうしのずらし（秒）。和音の役割で扱いを変える ---
      const pedB = new Set(this.ped.filter(p => p.type === 'P').map(p => Math.round(p.b * 960)));
      const lastB = gl.length ? gl[gl.length - 1].b : 0;
      // =================================================================
      //  演奏者のシミュレーション（human = 0 で理想的な機械、1 で標準的な人間）
      //  ずれは「足す」のではなく、次の仕組みの結果として出てくる:
      //   ・鍵の下降時間: 指が鍵に触れてからハンマーが弦に当たるまでの時間は、弱い音ほど長い。
      //     片手の和音は指が同時に鍵へ降りるので、強く弾く声部（旋律）が先に鳴り、弱い声部が遅れる
      //   ・手の位置と移動: 手が届く範囲（9度）の外の音は手を運ぶ必要があり、移動には距離に応じた時間がかかる
      //     （Fitts の法則）。間に合うように前の音を早めに離し、それでも足りなければ遅れて着く
      //   ・手の大きさ: 10度を超える和音は同時に押さえられないので、崩して弾くしかない
      //   ・指: 薬指・小指は弱く、ばらつきも大きい
      //   ・体内の拍の時計: 両手で共有。間隔ごとに小さな誤差が出て積み重なる（Wing–Kristofferson モデル）
      // =================================================================
      const human = spread, KEYMM = 13.7, REACH = 7, MAXSPAN = 16;
      const travel = (v) => 0.0892 * Math.pow(0.25 * Math.exp(Math.max(1, Math.min(127, v)) / 127 * Math.log(18)), -0.57); // 秒
      const FG = [0, 1, 1, 1, 0.93, 0.95], FS = [0, 0.003, 0.0035, 0.0035, 0.005, 0.0045]; // 指ごとの強さ・運動のばらつき
      const hand = { R: { c: null, on: -9, prev: [] }, L: { c: null, on: -9, prev: [] } };
      const seq = { R: gl.filter(g => g.R.length), L: gl.filter(g => g.L.length) }, hIdx = { R: 0, L: 0 };
      let clock = 0, prevT = null;
      gl.forEach((g, gi) => {
        const key = Math.round(g.b * 960), n = g.all.length, both = g.R.length && g.L.length, tg0 = T(g.b);
        if (prevT !== null) clock += gauss() * 0.015 * Math.sqrt((tg0 - prevT) * 0.25) * human; // 拍の時計の誤差
        prevT = tg0; const tg = tg0 + clock;
        const room = gi + 1 < gl.length ? T(gl[gi + 1].b) - tg0 : 9, dmax = Math.max(...g.all.map(x => x.d));
        const down = near(g.b / barLen, Math.round(g.b / barLen));
        for (const x of g.all) { x._i = 0; x._p = 0; x._rel = Infinity; x._v = x.v * (x.h === 'L' ? 0.9 : 1) + (down ? 3 : 0); }
        // --- 意図して行う表現（解釈）---
        const final = near(g.b, lastB) && n >= 4, stac = g.all.every(x => x.stac);
        const roll = !stac && n >= 4 && ((slow && dmax >= 2 && g.all.filter(x => x.d >= 2).length >= 4) || (final && slow)); // 速い楽章の最終和音は崩さず、揃えて打つ
        if (roll) { // 長く響かせる大きな和音は下から上へ崩す
          const step = Math.min(slow ? 0.042 : 0.02, room * 0.5 / n);
          g.all.forEach((x, i) => { x._i = (i - 0.4 * (n - 1)) * step * expr; });
          if (expr > 0) marks.push({ b: g.b, text: 'アルペジオ' });
        } else if (slow && both && (starts.has(key) || peaks.has(key) || (pedB.has(key) && down))) {
          // 緩徐楽章のフレーズの頭・頂点・和声の変わり目: バスを先に置く
          g.L.forEach((x, i) => { x._i = (-0.030 + i * 0.012) * expr; });
          if (expr > 0) marks.push({ b: g.b, text: 'バス先行' });
        }
        // --- 体の動き ---
        const th = {};
        for (const h of ['R', 'L']) {
          const c = g[h]; if (!c.length) continue;
          const H = hand[h], hs = seq[h], hi = hIdx[h]++, lo = c[0].m, top = c[c.length - 1].m, span = top - lo;
          // 手の位置: いまの音と、続く数音をまとめて届く場所へ置く。届いているなら動かさない
          let wlo = lo, whi = top;
          for (let k = 1; k <= 3 && hs[hi + k]; k++) { const d = hs[hi + k][h], a = Math.min(wlo, d[0].m), b = Math.max(whi, d[d.length - 1].m); if (b - a > 2 * REACH) break; wlo = a; whi = b; }
          let ctr = H.c; if (ctr === null || wlo < ctr - REACH || whi > ctr + REACH) ctr = (wlo + whi) / 2;
          let late = 0;
          if (H.c !== null && ctr !== H.c) { // 手を運ぶ
            const mt = 0.02 + 0.04 * Math.log2(Math.abs(ctr - H.c) * KEYMM / 23.5 + 1), avail = tg - (H.on + 0.05);
            if (mt > avail) late = mt - avail;                      // 間に合わない分だけ遅れて着く
            for (const p of H.prev) p._rel = Math.min(p._rel, tg - mt); // 前の音は移動のために早めに離す
          }
          H.c = ctr;
          const tts = c.map((x, i) => {
            let f; if (c.length > 1) f = 1 + Math.round(4 * i / (c.length - 1)); else { const r = (x.m - ctr) / REACH; f = 3 + Math.sign(r) * Math.round(2 * Math.min(1, Math.abs(r) / 0.8)); }
            if (h === 'L') f = 6 - f; x._f = f; // 1 = 親指 … 5 = 小指
            x._v = x._v * (1 - (1 - FG[f]) * human) * (1 + gauss() * 0.04 * human);
            return travel(x._v);
          });
          th[h] = Math.min(...tts);
          const forced = span > MAXSPAN && !roll; // 手が届かない和音
          c.forEach((x, i) => { x._p = late + (tts[i] - th[h]) + gauss() * FS[x._f] + gauss() * 0.04 * tts[i] + (forced ? i * 0.05 : span > 14 ? i * 0.007 : 0); x._late = late; });
          if (forced && human > 0) marks.push({ b: g.b, text: '手が届かない' });
          H.on = tg + late; H.prev = c;
        }
        // 両手のあいだは、鳴る瞬間を合わせようとして下降時間の差を半分ほど補正する（完全には合わない）
        const tmin = Math.min(th.R === undefined ? 9 : th.R, th.L === undefined ? 9 : th.L);
        for (const x of g.all) { x._t = tg + x._i + (x._p + 0.5 * (th[x.h] - tmin)) * human; x._g = 1 + gauss() * 0.05 * Math.min(1, human); }
      });
      const notes = this.notes.map(n => {
        const t1 = T(n.b + n.d), len = t1 - T(n.b);
        let gate = (n.stac ? Math.min(len * 0.45, 0.16) : len > 0.35 ? len - 0.035 : len * 0.9) * n._g;
        if (human > 0 && n._rel < n._t + gate) gate = Math.max(0.04, n._rel - n._t);
        return { t: n._t, d: gate, m: n.m, v: Math.max(8, Math.min(127, Math.round(n._v))), h: n.h, f: n._f };
      }).sort((a, b) => a.t - b.t);
      // ずらした結果、同じ鍵の次の打鍵に前の音がかぶらないようにする
      const lastOf = new Map();
      for (const n of notes) { const q = lastOf.get(n.m); if (q && q.t + q.d > n.t - 0.01) q.d = Math.max(0.02, n.t - q.t - 0.01); lastOf.set(n.m, n); }
      const ped = []; let down = false;
      for (const p of this.ped.sort((a, b) => a.b - b.b)) {
        const t = T(p.b);
        if (p.type === 'P') { if (down) ped.push({ t: Math.max(0, t - 0.01), down: false }); ped.push({ t: t + (down ? 0.075 : 0.02), down: true }); down = true; }
        else if (down) { ped.push({ t, down: false }); down = false; }
      }
      const dur = T(this.beat);
      if (down) ped.push({ t: dur + 0.3, down: false });
      const bars = []; for (let b = 0; b < this.beat - 1e-6; b += this.barLen) bars.push(T(b));
      return { title: this.title, sub: this.sub, notes, ped, dur, bars, sections: this.sections.map(s => ({ t: T(s.b), name: s.name })), marks: marks.map(m => ({ t: T(m.b), text: m.text })).sort((x, y) => x.t - y.t) };
    }
  }

  // ---------- 伴奏音型のヘルパー ----------
  const trem = (a, b) => `${a}:e ${b} ${a} ${b} ${a} ${b} ${a} ${b} |`;
  const alb = (a, b, c, ped) => `${ped ? 'P ' : ''}${a}:e ${c} ${b} ${c} ${a} ${c} ${b} ${c} |`;
  const alb2 = (a, b, c, d, e, f, ped) => `${ped ? 'P ' : ''}${a}:e ${c} ${b} ${c} ${ped ? 'P ' : ''}${d}:e ${f} ${e} ${f} |`;
  const br = (a, b, c, d) => `P ${a}:e ${b} ${c} ${d} ${c} ${b} |`;
  const six = (a, b, c, d, e) => `P ${a}:s ${b} ${c} ${d} ${e} ${d} ${c} ${b} ${c} ${d} ${c} ${b} |`;
  const pulse = (bass, ch) => `P ${bass}:e ${ch} ${ch} ${ch} ${ch} ${ch} |`;
  const w6 = (bass, ch, ch2) => `${bass}:e! ${ch}! ${ch}! ${bass}! ${ch2 || ch}! ${ch2 || ch}! |`;
  const run6 = (a, b, c) => `P ${a}:e ${c} ${b} ${c} ${b} ${c} |`;

  // =====================================================================
  //  I. Allegro con brio
  // =====================================================================
  function movement1() {
    const M = new Movement('I. Allegro con brio', 'ハ短調 · ソナタ形式', 4, 156);

    const T1a_R = `{f} ^c5:q. g4:e eb4:q! c4:q! | b3:h r:h |
                   {p} d5:q f5 eb5 d5 | eb5:h r:h |
                   {f} ^ab5:q. f5:e d5:q! b4:q! | c5:h r:h |
                   {p} eb5:q g5 f5 eb5 | d5:h r:h |`;
    const T1a_L = `{f} ^c4:q. g3:e eb3:q! c3:q! | b2:h r:h |
                   {p} [b2 d3 g3]:h [b2 f3 g3]:h | [c3 eb3 g3]:h r:h |
                   {f} ^ab4:q. f4:e d4:q! b3:q! | c4:h r:h |
                   {p} [eb3 c4]:h [f3 ab3]:q [g3 c4]:q | [g2 g3 b3]:h r:h |`;
    const T1b_R = `{p} {<ff:18} g4:q. c5:e eb5:q d5:e c5 | b4:q. d5:e g5:h |
                   c5:q. eb5:e g5:q f5:e eb5 | db5:q. f5:e ab5:h |
                   {ff} g5:q. f5:e eb5:q d5:e c5 | d5:q! g5! b5! d6! |`;
    const T1b_L = `{p} {<ff:18} ${trem('c3', 'c4')} ${trem('b2', 'g3')} ${trem('c3', 'c4')} ${trem('f2', 'f3')}
                   {ff} ${trem('g2', 'g3')} ${trem('g2', 'g3')}`;

    const TRa_R = `{ff} ^c6:q. g5:e eb5:q! c5:q! | ab4:h r:h |
                   {p} ab4:e c5 eb5 c5 ab5 eb5 c5 eb5 | f4:e ab4 c5 ab4 f5 c5 ab4 c5 |`;
    const TRa_L = `{ff} ^c5:q. g4:e eb4:q! c4:q! | ab3:h r:h |
                   {p} [ab2 eb3 ab3]:w | [f2 c3 f3]:w |`;
    const TRb_R = `{p} {<f:8} bb4:e d5 f5 d5 ab5 f5 d5 f5 | bb5:e ab5 g5 f5 eb5 d5 c5 bb4 |
                   {f} [bb4 d5 f5 bb5]:q! r [bb4 d5 ab5]:q! r | {p} r:e g4 ab4 bb4 c5 d5 eb5 f5 |`;
    const TRb_L = `{p} {<f:8} [bb1 bb2]:w | [bb1 bb2]:h [d3 ab3 bb3]:h |
                   {f} [bb2 f3 bb3]:q! r [bb2 f3 bb3]:q! r | bb2:q! r r:h |`;

    const T2_R = `{p} g5:h ab5:q g5 | f5:h. d5:q | eb5:h f5:q eb5 | c5:q. d5:e bb4:h |
                  g5:h ab5:q g5 | bb5:h ab5:q f5 | {<mf:8} g5:q eb5 c5 ab5 | g5:h f5:q. d5:e |
                  {mf} eb5:q g5:e bb5 eb6 d6 c6 bb5 | ab5:e c6 f6 eb6 d6 c6 bb5 ab5 |
                  {<f:8} g5:e bb5 eb6 d6 c6 bb5 ab5 g5 | f5:e g5 f5 eb5 d5:q f5 |`;
    const T2_L = `{p} ${alb('eb3', 'g3', 'bb3', 1)} ${alb('d3', 'ab3', 'bb3', 1)} ${alb('c3', 'eb3', 'g3', 1)} ${alb2('ab2', 'c3', 'f3', 'bb2', 'd3', 'f3', 1)}
                  ${alb('eb3', 'g3', 'bb3', 1)} ${alb('d3', 'ab3', 'bb3', 1)} {<mf:8} ${alb2('eb3', 'g3', 'bb3', 'ab2', 'c3', 'eb3', 1)} ${alb2('bb2', 'eb3', 'g3', 'bb2', 'f3', 'ab3', 1)}
                  * {mf} ${alb('eb3', 'g3', 'bb3')} ${alb('ab2', 'c3', 'f3')} {<f:8} ${alb('bb2', 'eb3', 'g3')} ${alb('bb2', 'f3', 'ab3')}`;

    // ---- 提示部 ----
    M.add('提示部 — 第1主題', T1a_R, T1a_L);
    M.add('', T1b_R, T1b_L);
    M.add('推移', TRa_R, TRa_L);
    M.add('', TRb_R, TRb_L);
    M.add('第2主題（変ホ長調）', T2_R, T2_L);
    M.add('小結尾',
      `{ff} ^eb5:q. bb4:e g4:q! eb4:q! | [f4 ab4 c5]:h [f4 ab4 d5]:h |
       ^eb6:q. bb5:e g5:q! eb5:q! | [f5 ab5 c6]:h [f5 ab5 d6]:h |
       [g5 bb5 eb6]:q! r [g4 bb4 eb5]:q! r | [eb4 g4 bb4 eb5]:h r:h |`,
      `{ff} ^eb4:q. bb3:e g3:q! eb3:q! | [ab2 ab3]:h [bb2 bb3]:h |
       ^eb4:q. bb3:e g3:q! eb3:q! | [ab2 ab3]:h [bb2 bb3]:h |
       [eb2 eb3]:q! r [eb2 eb3]:q! r | [eb2 bb2 eb3]:h r:h |`);

    // ---- 展開部 ----
    const motR = T1a_R.split('{f} ^ab5')[0], motL = T1a_L.split('{f} ^ab4')[0];
    M.add('展開部', motR, motL, { tr: 5 });
    M.add('', motR, motL, { tr: 7 });
    M.add('',
      `{mf} {<ff:20} d5:q. g5:e bb5:q a5:e g5 | d5:q. f5:e b5:h |
       g5:q. c6:e eb6:q d6:e c6 | g5:q. bb5:e e6:h |
       c6:q. f6:e ab6:q g6:e f6 | {ff} ^eb6:q. c6:e a5:q f#5:q |`,
      `{mf} {<ff:20} ${trem('g2', 'g3')} ${trem('b2', 'g3')} ${trem('c3', 'c4')} ${trem('e3', 'c4')} ${trem('f2', 'f3')} {ff} ${trem('f#2', 'f#3')}`);
    M.add('属音ペダル',
      `{ff} [b4 d5 g5]:h [c5 eb5 g5]:h | [b4 d5 g5]:h [d5 f5 ab5]:h |
       {>pp:12} [d5 f5 g5 b5]:h g5:q r | f5:q r d5:q r | {t>112:4} b4:q r g4:h | r:w |`,
      `{ff} ${trem('g2', 'g3')} ${trem('g2', 'g3')} {>pp:12} ${trem('g2', 'g3')} g2:q r g2:q r | g2:q r [g1 g2]:h | r:w |`);

    // ---- 再現部 ----
    M.add('再現部 — 第1主題', '{t=156} ' + T1a_R, T1a_L);
    M.add('', T1b_R, T1b_L);
    M.add('推移', TRa_R, TRa_L);
    M.add('', TRb_R, TRb_L, { tr: -3 });
    M.add('第2主題（ハ長調）', T2_R, T2_L, { tr: -3 });
    M.add('小結尾',
      `{ff} ^c5:q. g4:e eb4:q! c4:q! | [f4 ab4 d5]:h [f4 g4 b4 d5]:h |
       ^c6:q. g5:e eb5:q! c5:q! | [f5 ab5 d6]:h [f5 g5 b5 d6]:h |`,
      `{ff} ^c4:q. g3:e eb3:q! c3:q! | [f2 f3]:h [g2 g3]:h |
       ^c4:q. g3:e eb3:q! c3:q! | [f2 f3]:h [g2 g3]:h |`);
    M.add('コーダ',
      `{ff} g5:q. c6:e eb6:q d6:e c6 | b5:q. d6:e g6:h |
       c6:q. eb6:e g6:q f6:e eb6 | db6:q. f6:e ab6:h |
       g6:q f6:e eb6 d6:q c6:e b5 | [d5 f5 g5 b5]:q! r [d5 f5 g5 b5]:q! r |
       [c5 eb5 g5 c6]:q! r [b4 d5 g5]:q! r | [c5 eb5 g5 c6]:q! r [b4 d5 g5 b5]:q! r |
       ^c6:q. g5:e eb5:q! c5:q! | g4:q! eb4:q! c4:q! r |
       {t=126} {fff} [c4 eb4 g4 c5]:h r:h | [c4 eb4 g4 c5]:w |`,
      `{ff} ${trem('c3', 'c4')} ${trem('b2', 'g3')} ${trem('c3', 'c4')} ${trem('f2', 'f3')} ${trem('g2', 'g3')} [g1 g2]:q! r [g1 g2]:q! r |
       [c2 c3]:q! r [g1 g2]:q! r | [c2 c3]:q! r [g1 g2]:q! r |
       ^c4:q. g3:e eb3:q! c3:q! | g2:q! eb2:q! c2:q! r |
       {fff} [c2 c3]:h r:h | P [c1 g1 c2]:w |`);
    return M;
  }

  // =====================================================================
  //  II. Adagio cantabile
  // =====================================================================
  function movement2() {
    const M = new Movement('II. Adagio cantabile', '変イ長調 · 三部形式', 3, 54);
    const I = br('ab2', 'eb3', 'ab3', 'c4');
    M.add('主題',
      `{p} c5:h eb5:q | db5:h bb4:q | c5:q. db5:e eb5:q | f5:q eb5:h |
       c5:h eb5:q | db5:h f5:q | eb5:q. c5:e bb4:q | ab4:h. |`,
      `{pp} ${I} ${br('bb2', 'eb3', 'g3', 'db4')} ${I} P db3:e bb3 P eb3:e bb3 g3 bb3 |
       ${I} ${br('db3', 'f3', 'bb3', 'db4')} P eb3:e ab3 c4 ab3 P [eb3 g3]:e db4 | P ab2:e eb3 ab3 c4 ab3:q |`);
    M.add('',
      `{mp} eb5:h g5:q | f5:h d5:q | eb5:q. f5:e g5:q | ab5:q g5:h |
       {<mf:6} bb5:h ab5:q | g5:q. f5:e eb5:q | {>p:6} db5:h bb4:q | c5:h. |`,
      `{p} ${br('eb3', 'bb3', 'eb4', 'g4')} ${br('bb2', 'f3', 'ab3', 'd4')} ${br('eb3', 'bb3', 'eb4', 'g4')} ${br('g2', 'eb3', 'bb3', 'eb4')}
       ${br('g2', 'eb3', 'bb3', 'db4')} ${br('eb3', 'g3', 'bb3', 'db4')} ${br('eb3', 'g3', 'bb3', 'db4')} ${I}`);
    M.add('中間部（ヘ短調）',
      `{p} ab4:h c5:q | bb4:h g4:q | ab4:q. bb4:e c5:q | db5:h c5:q |
       {<f:9} f5:h ab5:q | g5:h e5:q | {f} f5:q. eb5:e db5:q | {>p:3} {t>46:3} c5:q bb4:h |`,
      `{pp} ${pulse('f2', '[ab3 c4]')} ${pulse('c3', '[e3 bb3]')} ${pulse('f2', '[ab3 c4]')} P bb2:e [f3 bb3 db4] [f3 bb3 db4] [f3 bb3 db4] P c3:e [e3 g3 bb3] |
       {<mf:9} ${pulse('f2', '[ab3 c4 f4]')} ${pulse('c3', '[g3 bb3 e4]')} {mf} ${pulse('db3', '[f3 ab3 db4]')} {>pp:3} ${pulse('eb3', '[g3 db4]')}`);
    const I6 = six('ab2', 'eb3', 'ab3', 'c4', 'eb4');
    M.add('主題の回帰',
      `{t=54} {p} c5:h eb5:q | db5:h bb4:q | c5:q db5:e c5:s db5 eb5:q | f5:q eb5:h |
       {<mf:6} c5:h eb5:q | db5:q. eb5:e f5:q | {>p:6} eb5:q. c5:e bb4:q | ab4:h. |`,
      `{pp} ${I6} ${six('bb2', 'eb3', 'g3', 'bb3', 'db4')} ${I6} P db3:s f3 bb3 f3 P eb3:s g3 bb3 eb4 bb3 g3 bb3 g3 |
       ${I6} ${six('db3', 'f3', 'bb3', 'db4', 'f4')} P eb3:s ab3 c4 ab3 eb3 ab3 c4 ab3 P eb3:s g3 db4 g3 | P ab2:s eb3 ab3 c4 eb4 c4 ab3 eb3 ab3:q |`);
    M.add('コーダ',
      `{pp} c5:h eb5:q | db5:h bb4:q | {t>38:6} c5:h. | [ab3 c4 eb4 ab4]:h. |`,
      `{pp} ${I} ${br('ab2', 'eb3', 'g3', 'db4')} P ab2:e eb3 ab3 c4 ab3:q | P [ab1 ab2]:h. |`);
    return M;
  }

  // =====================================================================
  //  III. Presto agitato
  // =====================================================================
  function movement3() {
    const M = new Movement('III. Presto agitato', 'ハ短調 · ロンド', 3, 186);
    M.pulse = 1.5; // 6/8: 付点四分が 1 拍
    const A_R = `c5:e d5 eb5 g5 f5 eb5 | d5:e eb5 f5 ab5 g5 f5 | eb5:e f5 g5 c6 b5 c6 | d6:e b5 g5 d5 b4 g4 |
                 c5:e d5 eb5 g5 f5 eb5 | f5:e g5 ab5 c6 bb5 ab5 | g5:e ab5 g5 f5 eb5 d5 | c5:e! g4! eb4! c4:q. |`;
    const A_L = `${w6('c3', '[eb3 g3]')} ${w6('b2', '[d3 g3]', '[f3 g3]')} ${w6('c3', '[eb3 g3]')} ${w6('g2', '[b2 d3 g3]')}
                 ${w6('c3', '[eb3 g3]')} ${w6('f3', '[ab3 c4]')} g3:e! [c4 eb4]! [c4 eb4]! g3! [b3 f4]! [b3 f4]! | [c3 g3 c4]:e! r r c3:q. |`;
    M.add('ロンド主題', '{mf} ' + A_R, '{mf} ' + A_L);
    M.add('', '{f} ' + A_R, '{f} ' + A_L, { rhOct: 12 });
    M.add('副主題（変ホ長調）',
      `{p} bb5:q. g5 | ab5:q. f5 | g5:q. eb5 | f5:q. d5 |
       {<f:9} eb5:q. c6 | bb5:q. g5 | ab5:e f5 d5 bb4 ab4 f4 | {f} eb4:q. d5:e g4 b4 |`,
      `{p} ${run6('eb3', 'g3', 'bb3')} ${run6('d3', 'ab3', 'bb3')} ${run6('eb3', 'g3', 'bb3')} ${run6('bb2', 'd3', 'f3')}
       {<f:9} ${run6('ab2', 'c3', 'eb3')} ${run6('bb2', 'eb3', 'g3')} ${run6('bb2', 'f3', 'ab3')} {f} * [eb3 g3]:q. [g2 f3]:q. |`);
    M.add('ロンド主題', '{mf} ' + A_R, '{mf} ' + A_L);
    M.add('中間部（ハ長調）',
      `{p} e5:q g5:e c6:q. | b5:q a5:e g5:q. | a5:q f5:e d5:q b4:e | c5:q. r:q. |
       e5:q g5:e c6:q. | d6:q c6:e b5:q a5:e | {<mf:3} g5:q e5:e f5:q d5:e | c5:q. {f} g4:e ab4 b4 |`,
      `{p} P [c3 g3 e4]:q. [c3 g3 e4]:q. | P [g2 d3 g3]:q. [g2 d3 g3]:q. | P [f3 a3 d4]:q. P [g2 f3]:q. | P [c3 g3 e4]:q. r:q. |
       P [c3 g3 e4]:q. [c3 g3 e4]:q. | P [g2 d3 g3]:q. [g2 d3 g3]:q. | P [c3 g3 e4]:q. P [g2 f3 b3]:q. | * [c3 g3 c4]:q. {f} [g2 f3 g3]:q. |`);
    M.add('ロンド主題', '{ff} ' + A_R, '{ff} ' + A_L, { rhOct: 12 });
    M.add('コーダ',
      `{ff} c5:e eb5 g5 c6 eb6 g6 | ab6:e f6 c6 ab5 f5 c5 | d5:e f5 ab5 b5 d6 f6 | g6:e eb6 c6 g5 eb5 c5 |
       b4:e d5 f5 g5 b5 d6 | f6:e d6 b5 g5 f5 d5 | [c5 eb5 g5 c6]:q.! r:q. | [b4 d5 g5]:q.! r:q. |
       {t=140} {fff} [c5 eb5 g5 c6]:h. | [c4 eb4 g4 c5]:h. |`,
      `{ff} P [c2 c3]:q. [c3 eb3 g3]:q. | P [f2 f3]:q. [f3 ab3 c4]:q. | P [f2 f3]:q. [f3 ab3 b3]:q. | P [g2 g3]:q. [c3 eb3 g3]:q. |
       P [g1 g2]:q. [g2 b2 f3]:q. | P [g1 g2]:q. [g2 b2 f3]:q. | * [c2 c3]:q.! r:q. | [g1 g2]:q.! r:q. |
       {fff} [c2 c3]:h. | P [c1 c2]:h. |`);
    return M;
  }

  function buildSonata(opts) {
    const expr = opts && opts.expr !== undefined ? opts.expr : 1, spread = opts && opts.spread !== undefined ? opts.spread : 1;
    const mvs = [movement1().compile(11, expr, spread), movement2().compile(23, expr, spread), movement3().compile(37, expr, spread)];
    let off = 0.8;
    const notes = [], ped = [], sections = [], movements = [], bars = [], marks = [];
    mvs.forEach((mv, i) => {
      movements.push({ t: off, title: mv.title, sub: mv.sub, dur: mv.dur, index: i });
      for (const n of mv.notes) notes.push({ t: n.t + off, d: n.d, m: n.m, v: n.v, h: n.h, f: n.f });
      for (const p of mv.ped) ped.push({ t: p.t + off, down: p.down });
      for (const s of mv.sections) sections.push({ t: s.t + off, name: s.name, mv: i });
      for (const k of mv.marks) marks.push({ t: k.t + off, text: k.text });
      mv.bars.forEach((t, k) => bars.push({ t: t + off, bar: k + 1, mv: i }));
      off += mv.dur + 3.2;
    });
    return { title: 'ピアノソナタ ハ短調《寓話》', titleEn: 'Piano Sonata in C minor “Fable”', notes, ped, sections, movements, bars, marks, dur: off - 0.6 };
  }

  root.buildSonata = buildSonata;
  if (typeof module !== 'undefined' && module.exports) module.exports = { buildSonata };
})(typeof window !== 'undefined' ? window : globalThis);
