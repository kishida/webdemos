'use strict';
// ====================================================================
//  標準 MIDI ファイル (SMF format 0/1) → 曲データ
//  返り値は buildSonata() と同じ形: {title, titleEn, notes[{t,d,m,v,h}], ped[{t,down}], sections, movements, bars, dur}
// ====================================================================
function parseMidi(buf, fileName) {
  const b = new Uint8Array(buf);
  let p = 0;
  const u32 = () => { const v = (b[p] << 24 | b[p + 1] << 16 | b[p + 2] << 8 | b[p + 3]) >>> 0; p += 4; return v; };
  const u16 = () => { const v = b[p] << 8 | b[p + 1]; p += 2; return v; };
  const str = n => { let s = ''; for (let i = 0; i < n; i++) s += String.fromCharCode(b[p + i]); p += n; return s; };
  const vlq = () => { let v = 0, c; do { c = b[p++]; v = v * 128 + (c & 127); } while (c & 128 && p < b.length); return v; };

  if (str(4) !== 'MThd') throw new Error('MIDI ファイルではありません');
  const hl = u32(), hs = p;
  u16(); const ntr = u16(), div = u16(); p = hs + hl;
  if (div & 0x8000) throw new Error('SMPTE タイムコードの MIDI には未対応です');

  // 全トラックのイベントを tick 付きで集める
  const raw = []; // [tick, order, kind, ch, a, b, track]
  const tempo = [], tsig = []; let title = '';
  let ord = 0;
  for (let tr = 0; tr < ntr && p < b.length; tr++) {
    const id = str(4), len = u32(), end = p + len;
    if (id !== 'MTrk') { p = end; tr--; continue; }
    let tick = 0, run = 0;
    while (p < end) {
      tick += vlq();
      let st = b[p];
      if (st & 0x80) p++; else st = run; // ランニングステータス
      if (st === 0xff) {
        const ty = b[p++], ln = vlq(), d = p; p += ln;
        if (ty === 0x51) tempo.push([tick, (b[d] << 16 | b[d + 1] << 8 | b[d + 2])]);
        else if (ty === 0x58) tsig.push([tick, b[d], 1 << b[d + 1]]);
        else if (ty === 0x03 && !title && tr <= 1) title = new TextDecoder('shift_jis').decode(b.subarray(d, d + ln)).trim();
        else if (ty === 0x2f) break;
      } else if (st === 0xf0 || st === 0xf7) { const ln = vlq(); p += ln; } // p += vlq() だと vlq が進めた分が失われる
      else {
        run = st; const k = st >> 4, ch = st & 15;
        const a1 = b[p++], a2 = (k === 0xc || k === 0xd) ? 0 : b[p++];
        raw.push([tick, ord++, k, ch, a1, a2, tr]);
      }
    }
    p = end;
  }
  raw.sort((x, y) => x[0] - y[0] || x[1] - y[1]);

  // tick → 秒（テンポマップ）
  tempo.sort((x, y) => x[0] - y[0]);
  if (!tempo.length || tempo[0][0] > 0) tempo.unshift([0, 500000]);
  const seg = []; let sec = 0;
  for (let i = 0; i < tempo.length; i++) {
    if (i > 0) sec += (tempo[i][0] - tempo[i - 1][0]) * tempo[i - 1][1] / 1e6 / div;
    seg.push([tempo[i][0], sec, tempo[i][1]]);
  }
  const toSec = t => { let i = seg.length - 1; while (i > 0 && seg[i][0] > t) i--; return seg[i][1] + (t - seg[i][0]) * seg[i][2] / 1e6 / div; };

  // ノートとペダル
  const notes = [], ped = [], open = new Map(); // key: ch*128+m → [startTick, vel, track]
  let pedDown = false;
  const close = (key, tick) => {
    const o = open.get(key); if (!o) return; open.delete(key);
    const m = key & 127, t = toSec(o[0]), d = Math.max(0.02, toSec(tick) - t);
    if (m >= 21 && m <= 108) notes.push({ t, d, m, v: o[1], tr: o[2] });
  };
  for (const [tick, , k, ch, a1, a2, tr] of raw) {
    if (ch === 9) continue; // ドラム
    if (k === 0x9 && a2 > 0) { const key = ch * 128 + a1; close(key, tick); open.set(key, [tick, a2, tr]); }
    else if (k === 0x8 || k === 0x9) close(ch * 128 + a1, tick);
    else if (k === 0xb && a1 === 64) { const d = a2 >= 64; if (d !== pedDown) { pedDown = d; ped.push({ t: toSec(tick), down: d }); } }
  }
  const lastTick = raw.length ? raw[raw.length - 1][0] : 0;
  for (const key of [...open.keys()]) close(key, lastTick);
  notes.sort((x, y) => x.t - y.t || x.m - y.m);

  // 同じ鍵が重なったら前の音を次の打鍵で切る（エンジンは 1 鍵 1 ボイス）
  const lastOf = new Map();
  for (const n of notes) { const q = lastOf.get(n.m); if (q && q.t + q.d > n.t - 0.005) q.d = Math.max(0.01, n.t - q.t - 0.005); lastOf.set(n.m, n); }

  // 手の色分け: ノートのあるトラックが 2 つ以上なら 1 つ目を右手、それ以外を左手。1 つなら音高で分ける
  const trs = [...new Set(notes.map(n => n.tr))].sort((x, y) => x - y);
  for (const n of notes) {
    n.h = trs.length >= 2 ? (n.tr === trs[0] ? 'R' : 'L') : (n.m >= 60 ? 'R' : 'L');
    delete n.tr;
  }

  // 小節線（拍子記号から）
  tsig.sort((x, y) => x[0] - y[0]);
  if (!tsig.length || tsig[0][0] > 0) tsig.unshift([0, 4, 4]);
  const bars = []; let bar = 1;
  for (let i = 0; i < tsig.length; i++) {
    const len = div * 4 * tsig[i][1] / tsig[i][2], stop = i + 1 < tsig.length ? tsig[i + 1][0] : lastTick;
    for (let t = tsig[i][0]; t < stop || (i + 1 === tsig.length && t <= stop); t += len) bars.push({ t: toSec(t), bar: bar++, mv: 0 });
  }

  const dur = notes.reduce((a, n) => Math.max(a, n.t + n.d), 0);
  const name = title || fileName.replace(/\.midi?$/i, '');
  return {
    title: name, titleEn: fileName, notes, ped, bars, dur,
    sections: [],
    movements: [{ index: 0, t: 0, dur, title: name, sub: `MIDI · ${notes.length} 音` }],
  };
}
if (typeof module !== 'undefined') module.exports = { parseMidi };
