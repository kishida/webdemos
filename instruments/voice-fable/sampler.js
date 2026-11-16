/*
 * 録音した声から子音を切り出して、物理モデルの歌に重ねるための道具。
 * ブラウザ（録音画面・デモ）と Node（tools/make-pack.js）の両方で使う。
 *
 * 考え方: 子音のうち「息の雑音」でできている部分（s・sh の摩擦、k・t の破裂と気息、h）は、
 * 管と乱流の単純なモデルではいちばん本物らしさが出にくい。そこだけを録音に置き換える。
 * 声帯が鳴り出す瞬間（有声の開始）を見つけ、その手前を子音として切り出し、
 * 歌の中では「有声の開始」が音符の頭に来るように置く。母音は物理モデルが歌う。
 */
(function (root) {
  'use strict';

  // 録音の段階。syl: ローマ字（song.js と同じ）, kana: 画面に出す字
  const row = (r, k) => r.split(' ').map((s, i) => ({ syl: s, kana: k[i] }));
  const STAGES = [
    { id: 's', title: '段階 1　さ行', kind: 'cons', note: '摩擦の音（s・sh）。モデルの音との差がいちばん大きい所です。', items: row('sa shi su se so', 'さしすせそ') },
    { id: 'kt', title: '段階 2　か行・た行', kind: 'cons', note: '破裂の音（k・t・ch・ts）。', items: row('ka ki ku ke ko ta chi tsu te to', 'かきくけこたちつてと') },
    { id: 'h', title: '段階 3　は行', kind: 'cons', note: '息の音（h・f）。', items: row('ha hi fu he ho', 'はひふへほ') },
    { id: 'v', title: '段階 4　母音', kind: 'vowel', note: '共鳴を測って、声道の形と長さを合わせます。', items: row('a i u e o', 'あいうえお') },
    { id: 'gz', title: '段階 5　濁音', kind: 'vcons', note: '声と一緒に鳴る雑音（破裂・摩擦）だけを取り出して重ねます。', items: row('ga gi gu ge go za ji zu ze zo da de do ba bi bu be bo', 'がぎぐげござじずぜぞだでどばびぶべぼ') },
    { id: 'son', title: '段階 6　な・ま・ら・や・わ行', kind: 'son', note: '声のまま舌や唇が動く音。録音から長さと深さを測り、モデルの動きを合わせます。', items: row('ana ama ara aya awa', 'なまらやわ').map((it, i) => ({ syl: it.syl, kana: ['あな', 'あま', 'あら', 'あや', 'あわ'][i], cons: 'nmryw'[i] })) },
  ];
  const STAGE_OF = {}; for (const st of STAGES) for (const it of st.items) STAGE_OF[it.syl] = st.id;

  const dB = v => 20 * Math.log10(v + 1e-9);

  // 1 音節の録音 x（Float32Array, モノラル）を調べる。
  // 返り値: { ok, reason, start, on, end, vrms, crms, floorDb, peakDb, clip, env[], voiced[], hop }
  //   start: 子音の始まり, on: 声帯が鳴り出す位置（どちらもサンプル番号）
  function analyze(x, fs) {
    const n = x.length, hop = Math.round(fs * 0.005), win = Math.round(fs * 0.02), nf = Math.max(0, Math.floor((n - win) / hop));
    const res = { ok: false, reason: '', start: 0, on: 0, end: 0, vrms: 0, crms: 0, floorDb: -90, peakDb: -90, clip: false, env: [], voiced: [], hop, fs };
    if (nf < 20) { res.reason = '録音が短すぎます'; return res; }
    // 200 Hz 以上（部屋の低い雑音やハムを除いた、子音を見るための信号）
    const hpA = Math.exp(-2 * Math.PI * 200 / fs), hi = new Float32Array(n);
    { let px = 0, py = 0; for (let i = 0; i < n; i++) { const y = hpA * (py + x[i] - px); px = x[i]; py = y; hi[i] = y; if (Math.abs(x[i]) > 0.985) res.clip = true; } }
    const env = new Float32Array(nf);
    for (let f = 0; f < nf; f++) { let e = 0; const a = f * hop; for (let i = a; i < a + win; i++) e += hi[i] * hi[i]; env[f] = dB(Math.sqrt(e / win)); }
    const sorted = Array.from(env).sort((a, b) => a - b);
    const floorDb = res.floorDb = Math.max(-90, sorted[Math.floor(nf * 0.1)]), peakDb = res.peakDb = sorted[nf - 1];
    if (peakDb < -45) { res.reason = '声が小さすぎます'; res.env = env; return res; }
    if (peakDb - floorDb < 25) { res.reason = 'まわりの音が大きすぎます'; res.env = env; return res; }

    // 有声かどうか: 1 kHz 以下に絞って 8 kHz 前後へ間引き、自己相関の山を見る（70–500 Hz）
    const dec = Math.max(1, Math.round(fs / 8000)), fd = fs / dec, m = Math.floor(n / dec), lo = new Float32Array(m);
    { const a = 1 - Math.exp(-2 * Math.PI * 900 / fs); let s1 = 0, s2 = 0; for (let i = 0; i < n; i++) { s1 += (x[i] - s1) * a; s2 += (s1 - s2) * a; if (i % dec === 0 && i / dec < m) lo[i / dec] = s2; } }
    const hopD = hop / dec, wD = Math.round(fd * 0.03), lagLo = Math.floor(fd / 500), lagHi = Math.ceil(fd / 70);
    const voiced = new Uint8Array(nf), loE = new Float32Array(nf); let loPeak = -200;
    for (let f = 0; f < nf; f++) { const a = Math.round(f * hopD); let e = 0; for (let i = a; i < a + wD && i < m; i++) e += lo[i] * lo[i]; loE[f] = dB(Math.sqrt(e / wD)); if (loE[f] > loPeak) loPeak = loE[f]; }
    for (let f = 0; f < nf; f++) {
      if (loE[f] < loPeak - 28) continue;
      const a = Math.round(f * hopD); if (a + wD + lagHi >= m) break;
      let e0 = 0; for (let i = a; i < a + wD; i++) e0 += lo[i] * lo[i];
      let best = 0;
      for (let lag = lagLo; lag <= lagHi; lag++) { let c = 0, e1 = 0; for (let i = a; i < a + wD; i++) { c += lo[i] * lo[i + lag]; e1 += lo[i + lag] * lo[i + lag]; } const r = c / Math.sqrt(e0 * e1 + 1e-20); if (r > best) best = r; }
      voiced[f] = best > 0.6 ? 1 : 0;
    }
    // 声の始まり: 有声が 40 ms 以上続く最初の所
    let onF = -1; for (let f = 0, run = 0; f < nf; f++) { run = voiced[f] ? run + 1 : 0; if (run >= 8) { onF = f - 7; break; } }
    res.env = env; res.voiced = voiced;
    if (onF < 0) { res.reason = '母音が見つかりません（声を出して言ってください）'; return res; }
    // 子音の始まり: 声の始まりから前へたどり、音がある所の先頭（60 ms までの切れ目は子音の内とみなす）
    const thr = Math.max(floorDb + 10, peakDb - 45);
    let startF = onF, gap = 0;
    for (let f = onF - 1; f >= 0 && onF - f < 70; f--) { if (env[f] > thr) { startF = f; gap = 0; } else if (++gap > 12) break; }
    // 細かい位置合わせ: 始まりは 1 フレーム手前、声の始まりは低域の振幅が立ち上がる所
    const on = res.on = Math.min(n - 1, onF * hop + Math.round(win * 0.25)), start = res.start = Math.max(0, startF * hop - Math.round(hop * 0.5));
    res.end = Math.min(n, on + Math.round(fs * 0.025));
    if (on - start < fs * 0.012) { res.reason = '子音が見つかりません（子音をはっきり、少し長めに）'; return res; }
    let ce = 0; for (let i = start; i < on; i++) ce += hi[i] * hi[i]; res.crms = Math.sqrt(ce / (on - start));
    // 母音の大きさ（子音との比を保つための基準）
    const va = on + Math.round(fs * 0.05), vb = Math.min(n, on + Math.round(fs * 0.25)); let ve = 0, vn = 0;
    for (let i = va; i < vb; i++) { ve += x[i] * x[i]; vn++; }
    res.vrms = vn > fs * 0.05 ? Math.sqrt(ve / vn) : 0;
    if (res.vrms < 1e-4) { res.reason = '母音が短すぎます（「さー」のように少し伸ばして）'; return res; }
    if (res.clip) { res.reason = '音が割れています（マイクから少し離れて）'; return res; }
    res.ok = true; return res;
  }

  // 濁音（が・ざ・だ・ば行）の録音を調べる。声帯の音と雑音が同時に鳴っているので、
  // 高い周波数（2.5 kHz 以上）だけを見て破裂・摩擦の雑音を探す。重ねるのもその高い成分だけ（声はモデルが歌の高さで出す）。
  // 返り値は analyze と同じ形。on = 母音の始まり, start = 雑音の始まり, hpf = 取り出す下限の周波数
  function analyzeVoiced(x, fs) {
    const base = analyze(x, fs), n = x.length, hop = base.hop, win = Math.round(fs * 0.01);
    const res = { ok: false, reason: '', start: 0, on: 0, end: 0, vrms: 0, crms: 0, floorDb: base.floorDb, peakDb: base.peakDb, clip: base.clip, env: base.env, voiced: base.voiced, hop, fs, hpf: 2500 };
    if (!base.voiced || !base.voiced.length) { res.reason = base.reason || '声が見つかりません'; return res; }
    if (base.clip) { res.reason = '音が割れています（マイクから少し離れて）'; return res; }
    const hb = new Float32Array(n), lo = new Float32Array(n);
    { const a = Math.exp(-2 * Math.PI * 2500 / fs), b = 1 - Math.exp(-2 * Math.PI * 1200 / fs); let p1 = 0, y1 = 0, p2 = 0, y2 = 0, l1 = 0, l2 = 0;
      for (let i = 0; i < n; i++) { y1 = a * (y1 + x[i] - p1); p1 = x[i]; y2 = a * (y2 + y1 - p2); p2 = y1; hb[i] = y2; l1 += (x[i] - l1) * b; l2 += (l1 - l2) * b; lo[i] = l2; } }
    const nf = Math.max(0, Math.floor((n - win) / hop)), eh = new Float32Array(nf), el = new Float32Array(nf);
    for (let f = 0; f < nf; f++) { let a = 0, b = 0; for (let i = f * hop; i < f * hop + win; i++) { a += hb[i] * hb[i]; b += lo[i] * lo[i]; } eh[f] = dB(Math.sqrt(a / win)); el[f] = dB(Math.sqrt(b / win)); }
    const lp = Math.max(...el), hs = Array.from(eh).sort((a, b) => a - b), hFloor = Math.max(-95, hs[Math.floor(nf * 0.1)]);
    // 母音の始まり: 低い帯域が最大の −6 dB に 30 ms 続けて届く最初の所
    let vF = -1; for (let f = 0, run = 0; f < nf; f++) { run = el[f] > lp - 6 ? run + 1 : 0; if (run >= 6) { vF = f - 5; break; } }
    if (vF < 0) { res.reason = '母音が見つかりません（声を出して言ってください）'; return res; }
    // 雑音の始まり: 母音の始まり（の少し後）から前へたどり、高い帯域に音がある所の先頭
    const thr = hFloor + 12; let sF = -1, gap = 0;
    for (let f = Math.min(nf - 1, vF + 2); f >= 0 && vF - f < 40; f--) { if (eh[f] > thr) { sF = f; gap = 0; } else if (sF >= 0 && ++gap > 4) break; else if (sF < 0 && vF - f > 8) break; }
    if (sF < 0) { res.reason = '子音の雑音が見つかりません（子音をはっきり）'; return res; }
    const on = res.on = Math.min(n - 1, vF * hop), start = res.start = Math.max(0, Math.min(on - Math.round(fs * 0.008), sF * hop - Math.round(hop * 0.5)));
    res.end = Math.min(n, on + Math.round(fs * 0.025));
    let ce = 0; for (let i = start; i < on; i++) ce += hb[i] * hb[i]; res.crms = Math.sqrt(ce / (on - start));
    const va = on + Math.round(fs * 0.05), vb = Math.min(n, on + Math.round(fs * 0.25)); let ve = 0, vn = 0; for (let i = va; i < vb; i++) { ve += x[i] * x[i]; vn++; }
    res.vrms = vn > fs * 0.05 ? Math.sqrt(ve / vn) : 0;
    if (res.vrms < 1e-4) { res.reason = '母音が短すぎます（「がー」のように少し伸ばして）'; return res; }
    res.ok = true; return res;
  }
  // 音節に合った調べ方を選ぶ（清音 / 濁音）
  function analyzeCons(syl, x, fs) { const st = STAGES.find(s => s.id === STAGE_OF[syl]); return st && st.kind === 'vcons' ? analyzeVoiced(x, fs) : analyze(x, fs); }

  function fftR(re, im) { const n = re.length; for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
    for (let len = 2; len <= n; len <<= 1) { const a = -2 * Math.PI / len; for (let i = 0; i < n; i += len) for (let k = 0; k < len / 2; k++) { const c = Math.cos(a * k), s = Math.sin(a * k), x = re[i + k + len / 2], y = im[i + k + len / 2]; const tr = x * c - y * s, ti = x * s + y * c; re[i + k + len / 2] = re[i + k] - tr; im[i + k + len / 2] = im[i + k] - ti; re[i + k] += tr; im[i + k] += ti; } } }
  // 鼻音・ら行・半母音（声のまま舌や唇が動く子音）を「あな」のように母音にはさんで言った録音から測る。
  // 5 ms ごとに 3 つの帯域（低 100–500 / 中 500–2000 / 高 2000–5000 Hz）の音量を出し、母音の音量からいちばん沈む所を子音とみなす。
  // 返り値: dur = 沈みが 8 dB（浅い子音はその深さの半分）より深い時間 [秒], depth = 沈みの深さ [dB], lo/mid/hi = 子音の間の各帯域の音量（母音を 0 dB として）
  function analyzeSon(x, fs, from, to) {
    const N = 1024, hop = Math.round(fs * 0.005), a0 = from || 0, b0 = to || x.length, nf = Math.max(0, Math.floor((b0 - a0 - N) / hop));
    const res = { ok: false, reason: '', start: 0, on: 0, end: 0, dur: 0, lo: 0, mid: 0, hi: 0, depth: 0, clip: false, voiced: [], hop, fs, peakDb: -90, floorDb: -90 };
    if (nf < 40) { res.reason = '録音が短すぎます'; return res; }
    const re = new Float64Array(N), im = new Float64Array(N), B = [[100, 500], [500, 2000], [2000, 5000]], fr = [], tot = new Float64Array(nf);
    for (let f = 0; f < nf; f++) { const o = a0 + f * hop; for (let i = 0; i < N; i++) { const v = x[o + i]; if (Math.abs(v) > 0.985) res.clip = true; re[i] = v * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / N)); im[i] = 0; } fftR(re, im);
      const q = B.map(([f0, f1]) => { let e = 0; for (let k = Math.round(f0 * N / fs); k <= Math.round(f1 * N / fs); k++) e += re[k] * re[k] + im[k] * im[k]; return 10 * Math.log10(e / (N * N) + 1e-14); }); fr.push(q); tot[f] = 10 * Math.log10(q.reduce((s, v) => s + Math.pow(10, v / 10), 0)); }
    const srt = Array.from(tot).sort((a, b) => a - b), mx = srt[nf - 1]; res.peakDb = mx; res.floorDb = srt[Math.floor(nf * 0.1)];
    if (mx < -50) { res.reason = '声が小さすぎます'; return res; }
    if (res.clip) { res.reason = '音が割れています（マイクから少し離れて）'; return res; }
    let s0 = 0, s1 = nf - 1; while (s0 < nf && tot[s0] < mx - 20) s0++; while (s1 > 0 && tot[s1] < mx - 20) s1--;
    res.voiced = new Uint8Array(nf); for (let f = s0; f <= s1; f++) res.voiced[f] = 1;
    if ((s1 - s0) * hop < fs * 0.25) { res.reason = '短すぎます（「あなー」のように、後ろを少し伸ばして）'; return res; }
    //SON1
    const sm = (f, k) => (fr[Math.max(s0, f - 1)][k] + fr[f][k] + fr[Math.min(s1, f + 1)][k]) / 3;
    const LM = [], RM = []; for (let f = s0; f <= s1; f++) LM[f] = [0, 1, 2].map(k => Math.max(sm(f, k), f > s0 ? LM[f - 1][k] : -1e9));
    for (let f = s1; f >= s0; f--) RM[f] = [0, 1, 2].map(k => Math.max(sm(f, k), f < s1 ? RM[f + 1][k] : -1e9));
    const dip = (f, k) => Math.min(LM[f][k], RM[f][k]) - fr[f][k], dev = f => Math.max(dip(f, 1), dip(f, 2));
    let pf = -1, pd = 0; for (let f = s0 + 12; f <= s1 - 16; f++) { if (dip(f, 0) > 18) continue; const d = dev(f); if (d > pd) { pd = d; pf = f; } }
    if (pf < 0 || pd < 5) { res.reason = '子音が見つかりません（子音をはっきり、少し長めに）'; return res; }
    //SON2
    const thr = Math.min(8, pd * 0.5), dv = (f, M) => Math.max(M[1] - fr[f][1], M[2] - fr[f][2]); let c0 = pf, c1 = pf;
    while (c0 > s0 && dv(c0 - 1, LM[pf]) > thr) c0--; while (c1 < s1 && dv(c1 + 1, RM[pf]) > thr) c1++;
    const ref = [0, 1, 2].map(k => (LM[pf][k] + RM[pf][k]) / 2);
    if (c0 <= s0 + 4) { res.reason = 'はじめの「あ」が短すぎます（「あーなー」のように）'; return res; }
    if (c1 >= s1 - 6) { res.reason = '後ろの母音が短すぎます（「あなー」と伸ばして）'; return res; }
    res.start = a0 + c0 * hop + (N >> 1); res.on = a0 + (c1 + 1) * hop + (N >> 1); res.end = res.on; res.dur = (c1 - c0 + 1) * hop / fs; res.depth = pd;
    let lo = 0, n = 0; for (let f = c0; f <= c1; f++) { lo += fr[f][0] - ref[0]; n++; } res.lo = lo / n; res.mid = fr[pf][1] - ref[1]; res.hi = fr[pf][2] - ref[2];
    res.ok = true; return res;
  }

  // analyzeSon の結果から、パックに残す数値だけを取り出す
  function sonMeas(a) { return { dur: +a.dur.toFixed(3), depth: +a.depth.toFixed(1), lo: +a.lo.toFixed(1), mid: +a.mid.toFixed(1), hi: +a.hi.toFixed(1) }; }

  /*TRIMNOTE*/
  function trimVoice(it, thr) {
    const d = it.data, fs = it.fs, n = d.length, w = Math.round(fs * 0.005), nf = Math.floor(n / w); if (nf < 4) return it;
    const b = 1 - Math.exp(-2 * Math.PI * 300 / fs), E = new Float32Array(nf); let l1 = 0, l2 = 0;
    for (let f = 0; f < nf; f++) { let e = 0; for (let i = f * w; i < f * w + w; i++) { l1 += (d[i] - l1) * b; l2 += (l1 - l2) * b; e += l2 * l2; } E[f] = Math.sqrt(e / w); }
    thr = thr || 0.14; let pk = 0, pf = -1; for (let f = 0; f < nf; f++) if (E[f] > pk) { pk = E[f]; pf = f; }
    if (pk < thr) return it;
    let f0 = pf; while (f0 > 0 && E[f0 - 1] > thr * 0.5) f0--;
    const tv = Math.max(Math.round(fs * 0.012), f0 * w - Math.round(w * 0.5)); if (tv >= it.on + Math.round(fs * 0.02)) return it;
    const fo = Math.round(fs * 0.006), end = Math.min(n, tv + fo), a = Math.max(0, tv - fo), out = d.slice(0, end);
    for (let i = a; i < end; i++) out[i] *= 0.5 + 0.5 * Math.cos(Math.PI * (i - a) / (end - a));
    const on = Math.min(it.on, tv);
    return Object.assign({}, it, { data: out, on, lead: on / fs, trimmed: (n - end) / fs });
  }
  /*CUTNOTE*/
  function cutLow(it) {
    const d = it.data, a = Math.exp(-2 * Math.PI * 200 / it.fs); let p1 = 0, y1 = 0, p2 = 0, y2 = 0;
    for (let i = 0; i < d.length; i++) { y1 = a * (y1 + d[i] - p1); p1 = d[i]; y2 = a * (y2 + y1 - p2); p2 = y1; d[i] = y2; }
    it.hp = 1; return it;
  }
  // 解析結果から、歌に重ねる 1 個の素材を作る。data は「その人の母音の大きさ = 1」にそろえてある。
  function makeItem(x, fs, a) {
    const pre = Math.round(fs * 0.005), post = Math.round(fs * 0.025), s0 = Math.max(0, a.start - pre), s1 = Math.min(x.length, a.on + post);
    const d = new Float32Array(s1 - s0), on = a.on - s0, fin = Math.round(fs * 0.004), fo0 = Math.max(0, on - Math.round(fs * 0.006));
    // 60 Hz 以下を落とす（息がマイクに当たる音）。濁音は a.hpf 以上だけを残す（声の成分を捨てて雑音だけにする）
    const hpA = Math.exp(-2 * Math.PI * (a.hpf || 60) / fs); let px = 0, py = 0, px2 = 0, py2 = 0;
    for (let i = 0; i < d.length; i++) {
      const v = x[s0 + i]; let y = hpA * (py + v - px); px = v; py = y;
      if (a.hpf) { const y2 = hpA * (py2 + y - px2); px2 = y; py2 = y2; y = y2; }
      let g = 1; if (i < fin) g = 0.5 - 0.5 * Math.cos(Math.PI * i / fin);
      if (i > fo0) g *= 0.5 + 0.5 * Math.cos(Math.PI * (i - fo0) / (d.length - fo0)); // 声が鳴り出したら消していく（その先は物理モデルが歌う）
      d[i] = y * g / a.vrms;
    }
    return cutLow(trimVoice({ data: d, on, fs, lead: on / fs, ratioDb: dB(a.crms / a.vrms) }));
  }

  // 伸ばした母音の録音から、フォルマント（声道の共鳴の周波数）F1–F3 を測る。
  // 12 kHz に落として線形予測（LPC）で声道の共鳴の形を求め、その山を読む。
  // 返り値: { ok, reason, F: [F1, F2, F3], f0, v0, v1（使った区間）, grid: { f0, df, db[] }（共鳴の形、表示用） }
  // 多項式 A(z) = 1 + A[1] z^-1 + … の根（Durand–Kerner 法）。虚部が正のものだけ返す
  function lpcRoots(A, P) {
    const zr = new Float64Array(P), zi = new Float64Array(P); for (let i = 0; i < P; i++) { const a = 2 * Math.PI * (i + 0.37) / P; zr[i] = 0.9 * Math.cos(a); zi[i] = 0.9 * Math.sin(a); }
    for (let it = 0; it < 400; it++) { let mv = 0;
      for (let i = 0; i < P; i++) {
        let pr = 1, pi = 0; for (let k = 1; k <= P; k++) { const t = pr * zr[i] - pi * zi[i]; pi = pr * zi[i] + pi * zr[i]; pr = t + A[k]; } // z^P + A1 z^(P-1) + … + AP
        let dr = 1, di = 0; for (let j = 0; j < P; j++) if (j !== i) { const ar = zr[i] - zr[j], ai = zi[i] - zi[j], t = dr * ar - di * ai; di = dr * ai + di * ar; dr = t; }
        const dn = dr * dr + di * di + 1e-300, qr = (pr * dr + pi * di) / dn, qi = (pi * dr - pr * di) / dn; zr[i] -= qr; zi[i] -= qi; mv = Math.max(mv, Math.abs(qr) + Math.abs(qi));
      }
      if (mv < 1e-12) break; }
    const out = []; for (let i = 0; i < P; i++) if (zi[i] > 1e-6) out.push([zr[i], zi[i]]); return out;
  }
  const BW_MAX = 700;
  function analyzeVowel(x, fs) {
    const a = analyze(x, fs), res = { ok: false, reason: '', F: [], f0: 0, v0: 0, v1: 0, voiced: a.voiced, hop: a.hop, clip: a.clip, peakDb: a.peakDb, floorDb: a.floorDb, grid: null };
    if (!a.voiced || !a.voiced.length) { res.reason = a.reason || '声が見つかりません'; return res; }
    if (a.clip) { res.reason = '音が割れています（マイクから少し離れて）'; return res; }
    let bs = 0, bl = 0; for (let f = 0, s = -1; f <= a.voiced.length; f++) { if (f < a.voiced.length && a.voiced[f]) { if (s < 0) s = f; } else if (s >= 0) { if (f - s > bl) { bl = f - s; bs = s; } s = -1; } }
    if (bl * a.hop < fs * 0.15) { res.reason = '母音が短すぎます（「あー」と 1 秒ほど伸ばして）'; return res; }
    const v0 = res.v0 = Math.round((bs + bl * 0.2) * a.hop), v1 = res.v1 = Math.round((bs + bl * 0.8) * a.hop);
    // 12 kHz 前後へ間引く（窓つき sinc の低域通過）
    const dec = Math.max(1, Math.round(fs / 12000)), fd = fs / dec, T = 24 * dec + 1, h = new Float64Array(T);
    { let s = 0; for (let i = 0; i < T; i++) { const t = i - (T - 1) / 2, c = 0.45 / dec; h[i] = (t === 0 ? 2 * c : Math.sin(2 * Math.PI * c * t) / (Math.PI * t)) * (0.54 - 0.46 * Math.cos(2 * Math.PI * i / (T - 1))); s += h[i]; } for (let i = 0; i < T; i++) h[i] /= s; }
    const m = Math.floor((v1 - v0) / dec), y = new Float64Array(m);
    for (let j = 0; j < m; j++) { let s = 0; const c = v0 + j * dec - (T - 1) / 2; for (let i = 0; i < T; i++) { const q = c + i; if (q >= 0 && q < x.length) s += h[i] * x[q]; } y[j] = s; }
    // 基本周波数（参考）
    { const W = Math.min(m - Math.ceil(fd / 70) - 1, Math.round(fd * 0.06)); let best = 0, bLag = 0, e0 = 0; for (let i = 0; i < W; i++) e0 += y[i] * y[i];
      for (let lag = Math.floor(fd / 500); lag <= Math.ceil(fd / 70); lag++) { let c = 0, e1 = 0; for (let i = 0; i < W; i++) { c += y[i] * y[i + lag]; e1 += y[i + lag] * y[i + lag]; } const r = c / Math.sqrt(e0 * e1 + 1e-20); if (r > best * 1.03) { best = r; bLag = lag; } }
      res.f0 = bLag ? fd / bLag : 0; }
    // 高域強調 → 30 ms ごとの自己相関を平均 → LPC（レビンソン・ダービン）
    for (let j = m - 1; j > 0; j--) y[j] -= 0.97 * y[j - 1];
    const P = 14, W = Math.round(fd * 0.03), H = Math.round(fd * 0.01), r = new Float64Array(P + 1); let nfr = 0;
    for (let o = 0; o + W <= m; o += H) {
      const w = new Float64Array(W); for (let i = 0; i < W; i++) w[i] = y[o + i] * (0.54 - 0.46 * Math.cos(2 * Math.PI * i / (W - 1)));
      let r0 = 0; for (let i = 0; i < W; i++) r0 += w[i] * w[i]; if (r0 < 1e-12) continue;
      for (let k = 0; k <= P; k++) { let s = 0; for (let i = k; i < W; i++) s += w[i] * w[i - k]; r[k] += s / r0; } nfr++;
    }
    if (!nfr) { res.reason = '声が小さすぎます'; return res; }
    const A = new Float64Array(P + 1), tmp = new Float64Array(P + 1); A[0] = 1; let E = r[0] * 1.0001;
    for (let i = 1; i <= P; i++) { let acc = r[i]; for (let j = 1; j < i; j++) acc += A[j] * r[i - j]; const k = -acc / E; for (let j = 1; j < i; j++) tmp[j] = A[j] + k * A[i - j]; for (let j = 1; j < i; j++) A[j] = tmp[j]; A[i] = k; E *= 1 - k * k; }
    // 共鳴の形 1/|A(e^jω)| を 10 Hz 刻みで求め、山を読む
    const f0g = 100, df = 10, ng = Math.floor((Math.min(5500, fd / 2 - 200) - f0g) / df), db = new Float32Array(ng);
    for (let q = 0; q < ng; q++) { const w = 2 * Math.PI * (f0g + q * df) / fd; let re = 0, im = 0; for (let k = 0; k <= P; k++) { re += A[k] * Math.cos(w * k); im -= A[k] * Math.sin(w * k); } db[q] = -10 * Math.log10(re * re + im * im + 1e-20); }
    res.grid = { f0: f0g, df, db };
    const pk = [];
    for (let q = 1; q < ng - 1; q++) if (db[q] > db[q - 1] && db[q] >= db[q + 1]) {
      let lo = db[q], hi = db[q]; for (let j = q - 1; j >= 0 && db[j] <= db[q]; j--) if (db[j] < lo) lo = db[j]; for (let j = q + 1; j < ng && db[j] <= db[q]; j++) if (db[j] < hi) hi = db[j];
      if (db[q] - Math.max(lo, hi) < 1.0) continue; // 浅い肩は山と数えない
      const p = 0.5 * (db[q - 1] - db[q + 1]) / (db[q - 1] - 2 * db[q] + db[q + 1]); pk.push(f0g + (q + p) * df);
    }
    // 共鳴は山を読み、山に隠れたものを LPC の極（A(z) の根）で補う。山を読むだけだと、「あ」「お」のように F1 と F2 が近い母音で 2 つが 1 つの山にくっつき、
    // F2 を取りこぼして F3 を F2 と読んでしまう（声道が実際より短く見積もられる）。極なら、くっついていても 2 つに分かれて出る。ただし極だけに頼ると声ではない余計な極も拾うので、足すのは「山のすぐ上（1.85 倍まで）にあって、どの山とも重ならない極」だけ。
    const rt = lpcRoots(A, P).map(([re, im]) => ({ f: Math.atan2(im, re) * fd / (2 * Math.PI), bw: -Math.log(Math.hypot(re, im)) * fd / Math.PI })).filter(q => q.f > 180 && q.f < 5000 && q.bw < BW_MAX).sort((a, b) => a.f - b.f);
    const pks = pk.filter(f => f > 180), hid = rt.filter(q => { let lo = 0; for (const p of pks) { if (Math.abs(q.f / p - 1) < 0.12) return false; if (p < q.f && p > lo) lo = p; } return lo > 0 && q.f < lo * 1.85; }).map(q => q.f);
    res.peaks = pks.slice(0, 4).map(f => Math.round(f)); res.hidden = hid.map(f => Math.round(f));
    const F = pks.concat(hid).sort((a, b) => a - b).slice(0, 3); res.F = F.map(f => Math.round(f));
    if (F.length < 3) { res.reason = '共鳴をうまく測れませんでした（少し低めの声で、はっきり伸ばして）'; return res; }
    if (F[0] > 1250 || F[1] > 3400 || F[2] > 4400 || F[1] - F[0] < 120) { res.reason = '測った値が母音らしくありません（もう一度）'; return res; }
    res.ok = true; return res;
  }

  // ---- パック（素材の集まり）: { version, fs, name, items: { so: { on, peak, pcm(base64 の 16 bit) } } } ----
  const b64 = {
    enc(u8) { if (typeof Buffer !== 'undefined') return Buffer.from(u8.buffer, u8.byteOffset, u8.byteLength).toString('base64'); let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); },
    dec(str) { if (typeof Buffer !== 'undefined') { const b = Buffer.from(str, 'base64'); return new Uint8Array(b.buffer, b.byteOffset, b.byteLength); } const s = atob(str), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; },
  };
  // son: { table: 子音ごとの動き, measured: 測った値, report }（段階 6 を合わせたときだけ）
  // vowels: { len: 声道の長さ [m], table: 母音の形, measured: 測ったフォルマント, report }（母音を合わせたときだけ）
  function encodePack(name, fs, items, vowels, son, meas) {
    const out = { version: 1, name, fs, items: {} }; if (vowels) out.vowels = vowels; if (son) out.son = son; if (meas) out.meas = meas;
    for (const k in items) {
      const it = items[k], d = it.data; let pk = 1e-9; for (let i = 0; i < d.length; i++) { const v = Math.abs(d[i]); if (v > pk) pk = v; }
      const q = new Int16Array(d.length); for (let i = 0; i < d.length; i++) q[i] = Math.round(d[i] / pk * 32767);
      out.items[k] = { on: it.on, peak: pk, ratioDb: +it.ratioDb.toFixed(1), hp: it.hp ? 1 : 0, pcm: b64.enc(new Uint8Array(q.buffer)) };
    }
    return out;
  }
  function decodePack(p) {
    const items = {};
    for (const k in p.items) {
      const it = p.items[k], u = b64.dec(it.pcm), q = new Int16Array(u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength)), d = new Float32Array(q.length);
      for (let i = 0; i < q.length; i++) d[i] = q[i] / 32767 * it.peak;
      items[k] = trimVoice({ data: d, on: it.on, fs: p.fs, lead: it.on / p.fs, ratioDb: it.ratioDb }); if (it.hp) items[k].hp = 1; else cutLow(items[k]);
    }
    return { name: p.name, fs: p.fs, items, vowels: p.vowels || null, son: p.son || null, meas: p.meas || null };
  }
  // 使う段階だけを選び、曲の組み立てに渡す表（音節 → 子音の長さ [秒]）を作る
  function leads(pack, stageIds) { const o = {}; if (pack) for (const k in pack.items) if (!stageIds || stageIds.includes(STAGE_OF[k])) o[k] = pack.items[k].lead; return o; }

  // 母音を合わせたとき、声道が基準（15 cm）より長い人は声が低い: 共鳴が下がる分だけ、歌える高さも下がる。
  // その分だけ曲を下げる半音数（0 以下）を返す。短い人は上げない（声帯の側が先に限界になるため）。
  function keyShift(vowels) { return vowels && vowels.len > 0.150 ? Math.round(12 * Math.log2(0.150 / vowels.len)) : 0; }

  // ---- 録音画面とデモの間で声を受け渡す ----
  // このタブの中だけ（sessionStorage）に置く。タブを閉じると消える。残したいときは録音画面でファイルに保存する。
  // 入りきらないとき（容量の上限）は例外になる。
  const SS = 'fable-voice:';
  async function savePack(key, json) { if (json == null) sessionStorage.removeItem(SS + key); else sessionStorage.setItem(SS + key, JSON.stringify(json)); }
  async function loadPack(key) { const s = sessionStorage.getItem(SS + key); return s ? JSON.parse(s) : null; }

  // ---- 以前の版がブラウザに残したもの（IndexedDB と localStorage）。今は書き込まない。読み出しと削除だけ ----
  const DB = 'fable-voice', STORE = 'packs', OLD_LS = ['fable-pack', 'fable-stages', 'fable-reg'];
  async function oldExists() { try { return !!indexedDB.databases && (await indexedDB.databases()).some(d => d.name === DB); } catch (e) { return false; } }
  // 残っている録音を読む: { pack, raw }。なければ null（データベースを新しく作らないよう、あるときだけ開く）
  async function oldLoad() {
    if (!await oldExists()) return null;
    const d = await new Promise((res, rej) => { const r = indexedDB.open(DB); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    try {
      if (!d.objectStoreNames.contains(STORE)) return null;
      const get = key => new Promise((res, rej) => { const r = d.transaction(STORE).objectStore(STORE).get(key); r.onsuccess = () => res(r.result || null); r.onerror = () => rej(r.error); });
      const pack = await get('mine'), raw = await get('mine-raw');
      return pack || raw ? { pack, raw } : null;
    } finally { d.close(); }
  }
  async function oldDrop() {
    try { for (const k of OLD_LS) localStorage.removeItem(k); } catch (e) {}
    return new Promise(res => { const r = indexedDB.deleteDatabase(DB); r.onsuccess = r.onerror = r.onblocked = () => res(); });
  }

  const api = { trimVoice, STAGES, STAGE_OF, keyShift, analyze, analyzeVoiced, analyzeCons, analyzeVowel, analyzeSon, sonMeas, makeItem, encodePack, decodePack, leads, savePack, loadPack, oldExists, oldLoad, oldDrop };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.FableSampler = api;
})(typeof self !== 'undefined' ? self : this);
