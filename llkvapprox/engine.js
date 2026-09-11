// WebGPU Qwen3 engine with CED (encoder half + projector + decoder for the last prompt position).
// Port of node/engine.ts (the CPU reference that was cross-checked against PyTorch).
import { BLOCK, openGGUF, readTensor, openSafetensors } from './gguf.js';

// ---------------- WGSL ----------------
const HDR = /* wgsl */`
@group(0) @binding(0) var<storage, read> W: array<u32>;
fn b8(off: u32) -> u32 { return (W[off >> 2u] >> ((off & 3u) * 8u)) & 0xffu; }
fn f16at(off: u32) -> f32 { return unpack2x16float(b8(off) | (b8(off + 1u) << 8u)).x; }
fn s8(v: u32) -> f32 { return f32(i32(v) - select(0, 256, v > 127u)); }
fn sm4(s: u32, is: u32) -> vec2<f32> {
  if (is < 4u) { return vec2<f32>(f32(b8(s + is) & 63u), f32(b8(s + is + 4u) & 63u)); }
  let sc = (b8(s + is + 4u) & 15u) | ((b8(s + is - 4u) >> 6u) << 4u);
  let m = (b8(s + is + 4u) >> 4u) | ((b8(s + is) >> 6u) << 4u);
  return vec2<f32>(f32(sc), f32(m));
}
fn sc3(s: u32, k: u32) -> f32 {
  let w = k / 4u; let b = k % 4u; let hi = b8(s + 8u + b);
  var lo: u32;
  if (w == 0u) { lo = b8(s + b) & 15u; } else if (w == 1u) { lo = b8(s + 4u + b) & 15u; }
  else if (w == 2u) { lo = b8(s + b) >> 4u; } else { lo = b8(s + 4u + b) >> 4u; }
  return f32(i32(lo | (((hi >> (2u * w)) & 3u) << 4u)) - 32);
}
`;
// deq(base, j): j-th value of the block starting at byte offset `base`
const DEQ = {
  0: `fn deq(base: u32, j: u32) -> f32 { return bitcast<f32>(W[base >> 2u]); }`,
  1: `fn deq(base: u32, j: u32) -> f32 { return f16at(base); }`,
  30: `fn deq(base: u32, j: u32) -> f32 { return bitcast<f32>((b8(base) | (b8(base + 1u) << 8u)) << 16u); }`,
  8: `fn deq(base: u32, j: u32) -> f32 { return f16at(base) * s8(b8(base + 2u + j)); }`,
  12: `fn deq(base: u32, j: u32) -> f32 {
    let d = f16at(base); let dmin = f16at(base + 2u);
    let g = j / 64u; let w = j % 64u; let hi = w / 32u; let l = w % 32u;
    let sm = sm4(base + 4u, 2u * g + hi);
    let q = b8(base + 16u + g * 32u + l);
    return d * sm.x * f32(select(q & 15u, q >> 4u, hi == 1u)) - dmin * sm.y; }`,
  13: `fn deq(base: u32, j: u32) -> f32 {
    let d = f16at(base); let dmin = f16at(base + 2u);
    let g = j / 64u; let w = j % 64u; let hi = w / 32u; let l = w % 32u;
    let sm = sm4(base + 4u, 2u * g + hi);
    let ql = b8(base + 48u + g * 32u + l);
    let lo = select(ql & 15u, ql >> 4u, hi == 1u);
    let hb = (b8(base + 16u + l) >> (2u * g + hi)) & 1u;
    return d * sm.x * f32(lo + 16u * hb) - dmin * sm.y; }`,
  14: `fn deq(base: u32, j: u32) -> f32 {
    let d = f16at(base + 208u);
    let n = j / 128u; let w = j % 128u; let part = w / 32u; let l = w % 32u;
    let qlb = b8(base + n * 64u + l + select(0u, 32u, part == 1u || part == 3u));
    let lo = select(qlb & 15u, qlb >> 4u, part >= 2u);
    let h = (b8(base + 128u + n * 32u + l) >> (2u * part)) & 3u;
    let sc = s8(b8(base + 192u + n * 8u + l / 16u + 2u * part));
    return d * sc * f32(i32(lo | (h << 4u)) - 32); }`,
  10: `fn deq(base: u32, j: u32) -> f32 {
    let d = f16at(base + 80u); let dmin = f16at(base + 82u);
    let n = j / 128u; let w = j % 128u; let sidx = w / 32u; let w32 = w % 32u; let half = w32 / 16u; let l = w32 % 16u;
    let sc = b8(base + n * 8u + sidx * 2u + half);
    let q = (b8(base + 16u + n * 32u + half * 16u + l) >> (2u * sidx)) & 3u;
    return d * f32(sc & 15u) * f32(q) - dmin * f32(sc >> 4u); }`,
  11: `fn deq(base: u32, j: u32) -> f32 {
    let d = f16at(base + 108u);
    let n = j / 128u; let w = j % 128u; let sidx = w / 32u; let w32 = w % 32u; let half = w32 / 16u; let l = w32 % 16u;
    let q = (b8(base + 32u + n * 32u + half * 16u + l) >> (2u * sidx)) & 3u;
    let m = 1u << (n * 4u + sidx);
    let v = i32(q) - select(4, 0, (b8(base + half * 16u + l) & m) != 0u);
    return d * sc3(base + 96u, n * 8u + sidx * 2u + half) * f32(v); }`,
};
const TT = 16;
const matmulWGSL = (type) => HDR + DEQ[type] + /* wgsl */`
struct P { rows: u32, cols: u32, T: u32, rowBytes: u32, nbx: u32, accum: u32, p0: u32, p1: u32 }
@group(0) @binding(1) var<storage, read> X: array<f32>;
@group(0) @binding(2) var<storage, read_write> Y: array<f32>;
@group(0) @binding(3) var<uniform> p: P;
const BE: u32 = ${BLOCK[type][0]}u; const BB: u32 = ${BLOCK[type][1]}u; const TT: u32 = ${TT}u;
var<workgroup> red: array<f32, ${64 * TT}>;
@compute @workgroup_size(64)
fn main(@builtin(workgroup_id) wg: vec3<u32>, @builtin(local_invocation_index) li: u32) {
  let r = wg.x + wg.y * p.nbx;
  let t0 = wg.z * TT;
  let nt = min(TT, p.T - t0);
  var acc: array<f32, ${TT}>;
  if (r < p.rows) {
    let nb = p.cols / BE;
    for (var b = li; b < nb; b += 64u) {
      let base = r * p.rowBytes + b * BB;
      for (var j = 0u; j < BE; j++) {
        let w = deq(base, j);
        let c = b * BE + j;
        for (var tt = 0u; tt < nt; tt++) { acc[tt] += w * X[(t0 + tt) * p.cols + c]; }
      }
    }
  }
  for (var tt = 0u; tt < TT; tt++) { red[li * TT + tt] = acc[tt]; }
  workgroupBarrier();
  for (var s = 32u; s > 0u; s >>= 1u) {
    if (li < s) { for (var tt = 0u; tt < TT; tt++) { red[li * TT + tt] += red[(li + s) * TT + tt]; } }
    workgroupBarrier();
  }
  if (li == 0u && r < p.rows) {
    for (var tt = 0u; tt < nt; tt++) {
      let o = (t0 + tt) * p.rows + r;
      if (p.accum == 1u) { Y[o] += red[tt]; } else { Y[o] = red[tt]; }
    }
  }
}`;
// Tiled matmul for prefill (T >= 16): each workgroup computes a 64-row x 64-token tile; weights are dequantized
// once per tile into shared memory and X is loaded once per 64 rows (the simple kernel above re-reads X for every row).
const tiledWGSL = (type) => HDR + DEQ[type] + /* wgsl */`
struct P { rows: u32, cols: u32, T: u32, rowBytes: u32, nbx: u32, accum: u32, p0: u32, p1: u32 }
@group(0) @binding(1) var<storage, read> X: array<f32>;
@group(0) @binding(2) var<storage, read_write> Y: array<f32>;
@group(0) @binding(3) var<uniform> p: P;
const BE: u32 = ${BLOCK[type][0]}u; const BB: u32 = ${BLOCK[type][1]}u;
const BM: u32 = 64u; const BN: u32 = 64u; const BK: u32 = 16u;
var<workgroup> Ws: array<f32, 1024>;
var<workgroup> Xs: array<f32, 1024>;
@compute @workgroup_size(16, 16)
fn main(@builtin(workgroup_id) wg: vec3<u32>, @builtin(local_invocation_id) lid: vec3<u32>,
        @builtin(local_invocation_index) li: u32) {
  let r0 = wg.x * BM; let t0 = wg.y * BN;
  var acc: array<f32, 16>;
  for (var k0 = 0u; k0 < p.cols; k0 += BK) {
    for (var e = li; e < BM * BK; e += 256u) {
      let a = e / BK; let kk = e % BK; let c = k0 + kk;
      var w = 0.0;
      if (r0 + a < p.rows) { w = deq((r0 + a) * p.rowBytes + (c / BE) * BB, c % BE); }
      Ws[e] = w;
      var xv = 0.0;
      if (t0 + a < p.T) { xv = X[(t0 + a) * p.cols + c]; }
      Xs[e] = xv;
    }
    workgroupBarrier();
    for (var kk = 0u; kk < BK; kk++) {
      var wv: array<f32, 4>; var xv: array<f32, 4>;
      for (var i = 0u; i < 4u; i++) { wv[i] = Ws[(lid.y * 4u + i) * BK + kk]; xv[i] = Xs[(lid.x * 4u + i) * BK + kk]; }
      for (var i = 0u; i < 4u; i++) { for (var j = 0u; j < 4u; j++) { acc[i * 4u + j] += wv[i] * xv[j]; } }
    }
    workgroupBarrier();
  }
  for (var i = 0u; i < 4u; i++) {
    for (var j = 0u; j < 4u; j++) {
      let r = r0 + lid.y * 4u + i; let t = t0 + lid.x * 4u + j;
      if (r < p.rows && t < p.T) {
        let o = t * p.rows + r;
        if (p.accum == 1u) { Y[o] += acc[i * 4u + j]; } else { Y[o] = acc[i * 4u + j]; }
      }
    }
  }
}`;
// ---- fused decode matvec: up to 3 weight matrices (e.g. q,k,v or gate,up) in ONE dispatch ----
// Rows of the segments are stacked: global row gr < rows0 -> segment 0, then segment 1, ... Each segment reads its own
// weight binding (types may differ, e.g. Q4_K q/k with Q6_K v) and writes Y[yOff + row]. Same lane layout as below.
// Lane layouts are chosen so that neighbouring lanes read neighbouring 16-byte chunks of the weights (coalesced).
const dotFn = (type, i) => {
  const W = `W${i}`;
  // Q4_K: 144-byte blocks = 9 x vec4<u32>: [d|dmin, scales x3] + 8 x 16 bytes of 4-bit quants.
  // 8 lanes per block, lane j reads quant chunk j (bytes 16j..16j+15 = group j/2, positions (j%2)*16..+15):
  // low nibbles -> sub-block 2g, high nibbles -> sub-block 2g+1.
  if (type === 12) return /* wgsl */`
fn dot${i}(r: u32, lane: u32, cols: u32, rowBytes: u32) -> f32 {
  var acc = 0.0;
  let nb = cols / 256u; let rowV = r * (rowBytes / 16u);
  let j = lane % 8u; let g = j / 2u; let l0 = (j % 2u) * 16u;
  for (var b = lane / 8u; b < nb; b += 4u) {
    let hv = ${W}[rowV + b * 9u];
    let q = ${W}[rowV + b * 9u + 1u + j];
    let dm = unpack2x16float(hv.x);
    let s0 = smk(hv.y, hv.z, hv.w, 2u * g); let s1 = smk(hv.y, hv.z, hv.w, 2u * g + 1u);
    let xl = (b * 256u + g * 64u + l0) / 4u; let xh = xl + 8u;
    var sl = 0.0; var sh = 0.0; var xsl = 0.0; var xsh = 0.0;
    for (var k = 0u; k < 4u; k++) {
      let w = q[k]; let a = X[xl + k]; let c = X[xh + k];
      sl += dot(vec4<f32>(f32(w & 15u), f32((w >> 8u) & 15u), f32((w >> 16u) & 15u), f32((w >> 24u) & 15u)), a);
      sh += dot(vec4<f32>(f32((w >> 4u) & 15u), f32((w >> 12u) & 15u), f32((w >> 20u) & 15u), f32(w >> 28u)), c);
      xsl += a.x + a.y + a.z + a.w; xsh += c.x + c.y + c.z + c.w;
    }
    acc += dm.x * (s0.x * sl + s1.x * sh) - dm.y * (s0.y * xsl + s1.y * xsh);
  }
  return acc;
}`;
  // Q6_K: 210-byte blocks (not aligned): ql[128] qh[64] scales[16] d. 16 lanes per block, lane j reads ql bytes
  // 8j..8j+7 (consecutive lanes -> consecutive bytes) and the matching 8 qh bytes; 16 values per lane.
  if (type === 14) return /* wgsl */`
fn rd${i}(off: u32) -> u32 { let w = off >> 2u; let s = (off & 3u) * 8u; if (s == 0u) { return ${W}[w]; } return (${W}[w] >> s) | (${W}[w + 1u] << (32u - s)); }
fn dot${i}(r: u32, lane: u32, cols: u32, rowBytes: u32) -> f32 {
  var acc = 0.0;
  let nb = cols / 256u;
  let j = lane % 16u; let i0 = j * 8u; let n = i0 / 64u; let l = i0 % 64u; let lq = l % 32u;
  let pl = select(0u, 1u, l >= 32u); let ph = pl + 2u;          // part of the low / high nibble
  let isc = lq / 16u;
  let xo = n * 128u + lq;
  for (var b = lane / 16u; b < nb; b += 2u) {
    let base = r * rowBytes + b * 210u;
    let d = unpack2x16float(rd${i}(base + 208u)).x;
    let scb = base + 192u + n * 8u + isc;                        // scale index = n*8 + isc + 2*part
    let scl = s8(byteOf(rd${i}(scb + 2u * pl), 0u)); let sch = s8(byteOf(rd${i}(scb + 2u * ph), 0u));
    let ql0 = rd${i}(base + i0); let ql1 = rd${i}(base + i0 + 4u);
    let qo = base + 128u + n * 32u + lq; let qh0 = rd${i}(qo); let qh1 = rd${i}(qo + 4u);
    let xl = (b * 256u + xo + pl * 32u) / 4u; let xh = (b * 256u + xo + ph * 32u) / 4u;
    let sl = dot(q6(ql0, qh0 >> (2u * pl)), X[xl]) + dot(q6(ql1, qh1 >> (2u * pl)), X[xl + 1u]);
    let sh = dot(q6(ql0 >> 4u, qh0 >> (2u * ph)), X[xh]) + dot(q6(ql1 >> 4u, qh1 >> (2u * ph)), X[xh + 1u]);
    acc += d * (scl * sl + sch * sh);
  }
  return acc;
}`;
  throw new Error('no decode kernel for type ' + type);
};
const mmDecWGSL = (types) => {
  const n = types.length;
  let code = /* wgsl */`
struct P { seg: array<vec4<u32>, 3>, nbx: u32, accum: u32, a: u32, b: u32 }  // seg = (rows, rowBytes, yOff, cols)
${types.map((t, i) => `@group(0) @binding(${i}) var<storage, read> W${i}: array<${t === 12 ? 'vec4<u32>' : 'u32'}>;`).join('\n')}
@group(0) @binding(${n}) var<storage, read> X: array<vec4<f32>>;
@group(0) @binding(${n + 1}) var<storage, read_write> Y: array<f32>;
@group(0) @binding(${n + 2}) var<uniform> p: P;
var<workgroup> red: array<f32, 256>;
fn byteOf(w: u32, i: u32) -> u32 { return (w >> (i * 8u)) & 0xffu; }
fn s8(v: u32) -> f32 { return f32(i32(v << 24u) >> 24u); }
// Q4_K 6-bit scale/min of sub-block s from the 12 scale bytes (given as 3 words)
fn smk(w1: u32, w2: u32, w3: u32, s: u32) -> vec2<f32> {
  if (s < 4u) { return vec2<f32>(f32(byteOf(w1, s) & 63u), f32(byteOf(w2, s) & 63u)); }
  let j = s - 4u;
  return vec2<f32>(f32((byteOf(w3, j) & 15u) | ((byteOf(w1, j) >> 6u) << 4u)), f32((byteOf(w3, j) >> 4u) | ((byteOf(w2, j) >> 6u) << 4u)));
}
// 4 Q6_K values from 4 low-nibble bytes (w) and their 2 high bits (h, already shifted)
fn q6(w: u32, h: u32) -> vec4<f32> {
  return vec4<f32>(f32(i32((w & 15u) | ((h & 3u) << 4u)) - 32), f32(i32(((w >> 8u) & 15u) | (((h >> 8u) & 3u) << 4u)) - 32),
                   f32(i32(((w >> 16u) & 15u) | (((h >> 16u) & 3u) << 4u)) - 32), f32(i32(((w >> 24u) & 15u) | (((h >> 24u) & 3u) << 4u)) - 32));
}
${types.map((t, i) => dotFn(t, i)).join('\n')}
@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wg: vec3<u32>, @builtin(local_invocation_index) li: u32) {
  let lane = li % 32u;
  var r = (wg.x + wg.y * p.nbx) * 8u + li / 32u;
  var acc = 0.0; var yo = 0u; var ok = false;
`;
  for (let i = 0; i < n; i++) {
    code += `  if (!ok) { if (r < p.seg[${i}].x) { acc = dot${i}(r, lane, p.seg[${i}].w, p.seg[${i}].y); yo = p.seg[${i}].z + r; ok = true; } else { r -= p.seg[${i}].x; } }\n`;
  }
  code += /* wgsl */`
  red[li] = acc;
  workgroupBarrier();
  for (var st = 16u; st > 0u; st >>= 1u) { if (lane < st) { red[li] += red[li + st]; } workgroupBarrier(); }
  if (lane == 0u && ok) { if (p.accum == 1u) { Y[yo] += red[li]; } else { Y[yo] = red[li]; } }
}`;
  return code;
};

// ---- decode helpers that read the token position from a small storage buffer (so their bind groups can be cached) ----
// per-head RMSNorm + RoPE for q (heads 0..nH-1) and k (heads nH..nH+nKV-1) of a packed [q | k | v] row, in place
const HEADROPE_DEC = /* wgsl */`
struct P { nH: u32, eps: f32, base: f32, a: u32 }
@group(0) @binding(0) var<storage, read_write> Q: array<f32>;
@group(0) @binding(1) var<storage, read> Wq: array<f32>;
@group(0) @binding(2) var<storage, read> Wk: array<f32>;
@group(0) @binding(3) var<storage, read> posB: array<u32>;
@group(0) @binding(4) var<uniform> p: P;
var<workgroup> red: array<f32, 64>;
@compute @workgroup_size(64)
fn main(@builtin(workgroup_id) wg: vec3<u32>, @builtin(local_invocation_index) li: u32) {
  let h = wg.x; let o = h * 128u;
  var a = Q[o + li]; var b = Q[o + li + 64u];
  red[li] = a * a + b * b; workgroupBarrier();
  for (var k = 32u; k > 0u; k >>= 1u) { if (li < k) { red[li] += red[li + k]; } workgroupBarrier(); }
  let inv = 1.0 / sqrt(red[0] / 128.0 + p.eps);
  let isQ = h < p.nH;
  a = a * inv * select(Wk[li], Wq[li], isQ); b = b * inv * select(Wk[li + 64u], Wq[li + 64u], isQ);
  let th = f32(posB[0]) * pow(p.base, -f32(2u * li) / 128.0);
  let c = cos(th); let s = sin(th);
  Q[o + li] = a * c - b * s; Q[o + li + 64u] = b * c + a * s;
}`;
// write k and v of the packed [q | k | v] row into the KV cache at the current position
const KVCOPY_DEC = /* wgsl */`
struct P { qDim: u32, kvDim: u32, a: u32, b: u32 }
@group(0) @binding(0) var<storage, read> QKV: array<f32>;
@group(0) @binding(1) var<storage, read_write> K: array<f32>;
@group(0) @binding(2) var<storage, read_write> V: array<f32>;
@group(0) @binding(3) var<storage, read> posB: array<u32>;
@group(0) @binding(4) var<uniform> p: P;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x; if (i >= p.kvDim) { return; }
  let o = posB[0] * p.kvDim + i;
  K[o] = QKV[p.qDim + i]; V[o] = QKV[p.qDim + p.kvDim + i];
}`;
// out[i] = silu(gu[i]) * gu[F + i]   (gate and up produced by one fused matvec)
const SILUMUL2 = /* wgsl */`
struct P { n: u32, a: u32, b: u32, c: u32 }
@group(0) @binding(0) var<storage, read> X: array<f32>;
@group(0) @binding(1) var<storage, read_write> Y: array<f32>;
@group(0) @binding(2) var<uniform> p: P;
@compute @workgroup_size(256)
fn main(@builtin(global_invocation_id) gid: vec3<u32>) {
  let i = gid.x; if (i >= p.n) { return; }
  let g = X[i]; Y[i] = g / (1.0 + exp(-g)) * X[p.n + i];
}`;

const getrowsWGSL = (type) => HDR + DEQ[type] + /* wgsl */`
struct P { cols: u32, rowBytes: u32, p0: u32, p1: u32 }
@group(0) @binding(1) var<storage, read> ids: array<u32>;
@group(0) @binding(2) var<storage, read_write> Y: array<f32>;
@group(0) @binding(3) var<uniform> p: P;
const BE: u32 = ${BLOCK[type][0]}u; const BB: u32 = ${BLOCK[type][1]}u;
@compute @workgroup_size(64)
fn main(@builtin(workgroup_id) wg: vec3<u32>, @builtin(local_invocation_index) li: u32) {
  let t = wg.x; let r = ids[t];
  for (var c = li; c < p.cols; c += 64u) { Y[t * p.cols + c] = deq(r * p.rowBytes + (c / BE) * BB, c % BE); }
}`;
const RMSNORM = /* wgsl */`
struct P { n: u32, hasW: u32, eps: f32, rowOff: u32 }
@group(0) @binding(0) var<storage, read> X: array<f32>;
@group(0) @binding(1) var<storage, read_write> Y: array<f32>;
@group(0) @binding(2) var<storage, read> Wn: array<f32>;
@group(0) @binding(3) var<uniform> p: P;
var<workgroup> red: array<f32, 64>;
@compute @workgroup_size(64)
fn main(@builtin(workgroup_id) wg: vec3<u32>, @builtin(local_invocation_index) li: u32) {
  let xo = (wg.x + p.rowOff) * p.n; let yo = wg.x * p.n;
  var s = 0.0;
  for (var i = li; i < p.n; i += 64u) { let v = X[xo + i]; s += v * v; }
  red[li] = s; workgroupBarrier();
  for (var k = 32u; k > 0u; k >>= 1u) { if (li < k) { red[li] += red[li + k]; } workgroupBarrier(); }
  let inv = 1.0 / sqrt(red[0] / f32(p.n) + p.eps);
  for (var i = li; i < p.n; i += 64u) { Y[yo + i] = X[xo + i] * inv * select(1.0, Wn[i], p.hasW == 1u); }
}`;
// per (token, head): optional per-head RMSNorm (head_dim 128) + NEOX RoPE, in place. thread li owns pair (li, li+64)
const HEADROPE = /* wgsl */`
struct P { pos0: u32, hasNorm: u32, eps: f32, base: f32, rowStride: u32, colOff: u32, p0: u32, p1: u32 }
@group(0) @binding(0) var<storage, read_write> Q: array<f32>;
@group(0) @binding(1) var<storage, read> Wn: array<f32>;
@group(0) @binding(2) var<uniform> p: P;
var<workgroup> red: array<f32, 64>;
@compute @workgroup_size(64)
fn main(@builtin(workgroup_id) wg: vec3<u32>, @builtin(local_invocation_index) li: u32) {
  let t = wg.x; let h = wg.y;
  let o = t * p.rowStride + p.colOff + h * 128u;
  var a = Q[o + li]; var b = Q[o + li + 64u];
  red[li] = a * a + b * b; workgroupBarrier();
  for (var k = 32u; k > 0u; k >>= 1u) { if (li < k) { red[li] += red[li + k]; } workgroupBarrier(); }
  if (p.hasNorm == 1u) {
    let inv = 1.0 / sqrt(red[0] / 128.0 + p.eps);
    a = a * inv * Wn[li]; b = b * inv * Wn[li + 64u];
  }
  let th = f32(p.pos0 + t) * pow(p.base, -f32(2u * li) / 128.0);
  let c = cos(th); let s = sin(th);
  Q[o + li] = a * c - b * s; Q[o + li + 64u] = b * c + a * s;
}`;
// causal attention, flash-style (online softmax over chunks of 64 keys); head_dim 128
const ATTN = /* wgsl */`
struct P { qPos0: u32, grp: u32, qStride: u32, qOff: u32, kStride: u32, kOff: u32, vStride: u32, vOff: u32, oStride: u32, scale: f32, p0: u32, p1: u32 }
@group(0) @binding(0) var<storage, read> Q: array<f32>;
@group(0) @binding(1) var<storage, read> K: array<f32>;
@group(0) @binding(2) var<storage, read> V: array<f32>;
@group(0) @binding(3) var<storage, read_write> O: array<f32>;
@group(0) @binding(4) var<uniform> p: P;
var<workgroup> qs: array<f32, 128>;
var<workgroup> sc: array<f32, 64>;
@compute @workgroup_size(64)
fn main(@builtin(workgroup_id) wg: vec3<u32>, @builtin(local_invocation_index) li: u32) {
  let t = wg.x; let h = wg.y; let pos = p.qPos0 + t; let kvh = h / p.grp;
  let qo = t * p.qStride + p.qOff + h * 128u;
  qs[li] = Q[qo + li]; qs[li + 64u] = Q[qo + li + 64u];
  workgroupBarrier();
  var m = -1e30; var l = 0.0; var a0 = 0.0; var a1 = 0.0;
  let nch = pos / 64u + 1u;
  for (var c = 0u; c < nch; c++) {
    let j = c * 64u + li;
    var s = -1e30;
    if (j <= pos) {
      let ko = j * p.kStride + p.kOff + kvh * 128u;
      var d = 0.0;
      for (var i = 0u; i < 128u; i++) { d += qs[i] * K[ko + i]; }
      s = d * p.scale;
    }
    sc[li] = s;
    workgroupBarrier();
    var cm = -1e30;
    for (var jj = 0u; jj < 64u; jj++) { cm = max(cm, sc[jj]); }
    let mn = max(m, cm); let corr = exp(m - mn);
    a0 *= corr; a1 *= corr; l *= corr;
    for (var jj = 0u; jj < 64u; jj++) {
      let jg = c * 64u + jj;
      if (jg <= pos) {
        let e = exp(sc[jj] - mn);
        let vo = jg * p.vStride + p.vOff + kvh * 128u;
        l += e; a0 += e * V[vo + li]; a1 += e * V[vo + li + 64u];
      }
    }
    m = mn;
    workgroupBarrier();
  }
  let oo = t * p.oStride + h * 128u;
  O[oo + li] = a0 / l; O[oo + li + 64u] = a1 / l;
}`;
// attention for one query at the position stored in posB (decode)
const ATTN_DEC = ATTN.replace('@group(0) @binding(4) var<uniform> p: P;',
  '@group(0) @binding(4) var<uniform> p: P;\n@group(0) @binding(5) var<storage, read> posB: array<u32>;')
  .replace('let pos = p.qPos0 + t;', 'let pos = posB[0] + t;');
const ELEM = (body, extra = '') => /* wgsl */`
struct P { n: u32, nbx: u32, a: u32, b: u32, c: u32, d: u32, e: u32, f: u32 }
@group(0) @binding(0) var<storage, read> X: array<f32>;
@group(0) @binding(1) var<storage, read_write> Y: array<f32>;
@group(0) @binding(2) var<uniform> p: P;
${extra}
@compute @workgroup_size(256)
fn main(@builtin(workgroup_id) wg: vec3<u32>, @builtin(local_invocation_index) li: u32) {
  let i = (wg.x + wg.y * p.nbx) * 256u + li;
  if (i >= p.n) { return; }
  ${body}
}`;
const ARGMAX = /* wgsl */`
struct P { n: u32, a: u32, b: u32, c: u32 }
@group(0) @binding(0) var<storage, read> X: array<f32>;
@group(0) @binding(1) var<storage, read_write> Y: array<u32>;
@group(0) @binding(2) var<uniform> p: P;
var<workgroup> bv: array<f32, 256>;
var<workgroup> bi: array<u32, 256>;
@compute @workgroup_size(256)
fn main(@builtin(local_invocation_index) li: u32) {
  var m = -3.4e38; var mi = 0u;
  for (var i = li; i < p.n; i += 256u) { let v = X[i]; if (v > m) { m = v; mi = i; } }
  bv[li] = m; bi[li] = mi;
  workgroupBarrier();
  for (var s = 128u; s > 0u; s >>= 1u) {
    if (li < s) { let o = li + s; if (bv[o] > bv[li] || (bv[o] == bv[li] && bi[o] < bi[li])) { bv[li] = bv[o]; bi[li] = bi[o]; } }
    workgroupBarrier();
  }
  if (li == 0u) { Y[0] = bi[0]; }
}`;
const SILUMUL = ELEM('let g = Y[i]; Y[i] = g / (1.0 + exp(-g)) * X[i];');           // Y=gate, X=up
const BIAS = ELEM('Y[i] += X[i % p.a];');                                            // a = row length
const COPY2D = ELEM('let t = i / p.a; let k = i % p.a; Y[p.d + t * p.c + k] = X[p.e + t * p.b + k];'); // a=n per row, b=src stride, c=dst stride, d=dst off, e=src off

// ---------------- engine ----------------
export class Engine {
  static async create(log = console.log) {
    if (!navigator.gpu) throw new Error('WebGPU is not available in this browser');
    const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
    const L = adapter.limits;
    const device = await adapter.requestDevice({
      requiredLimits: {
        maxStorageBufferBindingSize: L.maxStorageBufferBindingSize, maxBufferSize: L.maxBufferSize,
        maxStorageBuffersPerShaderStage: Math.min(8, L.maxStorageBuffersPerShaderStage),
      },
    });
    const e = new Engine(); e.device = device; e.log = log; e.lost = false;
    device.lost.then((info) => { e.lost = true; log(`GPU device lost: ${info.reason} ${info.message}`); });
    e.info = { adapter: adapter.info ? `${adapter.info.vendor} ${adapter.info.architecture} ${adapter.info.description}` : '?',
      maxBinding: L.maxStorageBufferBindingSize, maxBuffer: L.maxBufferSize };
    e.pipes = new Map(); e.tmp = [];
    // caches for per-dispatch objects that do not depend on the position (cuts JS overhead per decode step)
    e.ucache = new Map(); e.bgcache = new Map(); e.ids = new WeakMap(); e.nid = 1;
    e.dummy = e.buf(16);
    e.amBuf = e.buf(16);
    e.amRead = device.createBuffer({ size: 16, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    return e;
  }
  idOf(o) { let i = this.ids.get(o); if (!i) { i = this.nid++; this.ids.set(o, i); } return i; }
  buf(size, usage = GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC) {
    return this.device.createBuffer({ size: Math.max(16, Math.ceil(size / 4) * 4), usage });
  }
  upload(bytes) {
    const b = this.buf(bytes.byteLength);
    const pad = bytes.byteLength % 4 ? new Uint8Array(Math.ceil(bytes.byteLength / 4) * 4) : null;
    if (pad) pad.set(bytes);
    this.device.queue.writeBuffer(b, 0, pad ?? bytes);
    return b;
  }
  pipe(key, code) {
    let p = this.pipes.get(key);
    if (!p) {
      const m = this.device.createShaderModule({ code });
      p = this.device.createComputePipeline({ layout: 'auto', compute: { module: m, entryPoint: 'main' } });
      this.pipes.set(key, p);
    }
    return p;
  }
  uni(words, cache = false) { // words: array of [value, 'u'|'f']; cache=true for position-independent params
    const key = cache ? words.map(([v, t]) => (t === 'f' ? 'f' : '') + v).join(',') : null;
    if (key && this.ucache.has(key)) return this.ucache.get(key);
    // every WGSL param struct here is <= 12 words; allocate at least 64 bytes so the binding is never too small
    const ab = new ArrayBuffer(Math.max(64, Math.ceil(words.length / 4) * 16));
    const dv = new DataView(ab);
    words.forEach(([v, t], i) => (t === 'f' ? dv.setFloat32(i * 4, v, true) : dv.setUint32(i * 4, v >>> 0, true)));
    const b = this.device.createBuffer({ size: ab.byteLength, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    this.device.queue.writeBuffer(b, 0, ab);
    if (key) this.ucache.set(key, b); else { b.__transient = true; this.tmp.push(b); }
    return b;
  }
  begin() { this.enc = this.device.createCommandEncoder(); this.pass = this.enc.beginComputePass(); }
  async end() {
    this.pass.end();
    this.device.queue.submit([this.enc.finish()]);
    await this.device.queue.onSubmittedWorkDone();
    for (const b of this.tmp) b.destroy();
    this.tmp = [];
  }
  disp(pipeline, buffers, x, y = 1, z = 1) {
    const cacheable = !buffers.some((b) => b.__transient);
    const key = cacheable ? this.idOf(pipeline) + ':' + buffers.map((b) => this.idOf(b)).join(',') : null;
    let bg = key && this.bgcache.get(key);
    if (!bg) {
      bg = this.device.createBindGroup({ layout: pipeline.getBindGroupLayout(0),
        entries: buffers.map((b, i) => ({ binding: i, resource: { buffer: b } })) });
      if (key) this.bgcache.set(key, bg);
    }
    this.pass.setPipeline(pipeline); this.pass.setBindGroup(0, bg); this.pass.dispatchWorkgroups(x, y, z);
  }
  // y[T][rows] (=|+=) x[T][cols] · Wᵀ
  mm(w, x, y, T, accum = false) {
    const nbx = Math.min(w.rows, 65535);
    if (T === 1 && (w.type === 12 || w.type === 14) && this.fastDecode !== false && w.cols % 256 === 0) {
      this.mmMulti([[w, 0]], x, y, accum);
    } else {
      const u = this.uni([[w.rows], [w.cols], [T], [w.rowBytes], [nbx], [accum ? 1 : 0], [0], [0]], true);
      if (T >= 16 && this.tiled !== false && w.cols % 16 === 0) {
        this.disp(this.pipe('mmt' + w.type, tiledWGSL(w.type)), [w.buf, x, y, u], Math.ceil(w.rows / 64), Math.ceil(T / 64));
      } else {
        this.disp(this.pipe('mm' + w.type, matmulWGSL(w.type)), [w.buf, x, y, u], nbx, Math.ceil(w.rows / nbx), Math.ceil(T / TT));
      }
    }
  }
  elem(code, key, x, y, n, extra = [], cache = true) {
    const g = Math.ceil(n / 256), nbx = Math.min(g, 65535);
    const u = this.uni([[n], [nbx], ...extra.map((v) => [v])], cache);
    this.disp(this.pipe(key, code), [x, y, u], nbx, Math.ceil(g / nbx));
  }
  rms(x, y, rows, n, w, eps, rowOff = 0) {
    const u = this.uni([[n], [w ? 1 : 0], [eps, 'f'], [rowOff]], true);
    this.disp(this.pipe('rms', RMSNORM), [x, y, w ?? this.dummy, u], rows);
  }
  headRope(q, T, nH, w, pos0, rowStride, colOff = 0) {
    const u = this.uni([[pos0], [w ? 1 : 0], [this.cfg.eps, 'f'], [this.cfg.base, 'f'], [rowStride], [colOff], [0], [0]]);
    this.disp(this.pipe('hr', HEADROPE), [q, w ?? this.dummy, u], T, nH);
  }
  attn(q, k, v, o, Tq, qPos0, nH, grp, s) {
    const u = this.uni([[qPos0], [grp], [s.qStride], [s.qOff ?? 0], [s.kStride], [s.kOff ?? 0], [s.vStride], [s.vOff ?? 0],
      [s.oStride], [1 / Math.sqrt(128), 'f'], [0], [0]]);
    this.disp(this.pipe('attn', ATTN), [q, k, v, o, u], Tq, nH);
  }
  copy2d(src, dst, n, T, sStride, dStride, dOff = 0, sOff = 0) {
    this.elem(COPY2D, 'copy', src, dst, n * T, [n, sStride, dStride, dOff, sOff, 0], false); // offsets depend on position
  }

  // ---------- model ----------
  async loadModel(src, maxT = 4096, maxCtx = 4096, progress = () => {}) {
    const g = (this.g = await openGGUF(src));
    const a = g.meta['general.architecture'];
    const M = (k) => g.meta[`${a}.${k}`];
    const c = (this.cfg = { L: M('block_count'), D: M('embedding_length'), H: M('attention.head_count'), KV: M('attention.head_count_kv'),
      hd: M('attention.key_length') ?? M('embedding_length') / M('attention.head_count'), F: M('feed_forward_length'),
      eps: M('attention.layer_norm_rms_epsilon'), base: M('rope.freq_base') });
    if (c.hd !== 128) throw new Error('this engine assumes head_dim 128');
    c.qDim = c.H * c.hd; c.kvDim = c.KV * c.hd;
    this.W = new Map(); this.N = new Map();
    let done = 0; const total = [...g.tensors.values()].reduce((s, t) => s + t.nbytes, 0);
    for (const t of g.tensors.values()) {
      const bytes = await readTensor(g, t);
      if (t.dims.length === 1) this.N.set(t.name, this.upload(new Uint8Array(new Float32Array(dequantF32(t.type, bytes)).buffer)));
      else {
        const [be, bb] = BLOCK[t.type];
        this.W.set(t.name, { buf: this.upload(bytes), type: t.type, cols: t.dims[0], rows: t.dims[1], rowBytes: (t.dims[0] / be) * bb });
      }
      done += t.nbytes; progress(done / total);
    }
    if (!this.W.has('output.weight')) this.W.set('output.weight', this.W.get('token_embd.weight'));
    this.vocab = this.W.get('token_embd.weight').rows;
    this.maxT = maxT; this.maxCtx = maxCtx;
    const f = 4;
    this.A = { X: this.buf(maxT * c.D * f), XL: this.buf(c.D * f), H: this.buf(maxT * c.D * f), Q: this.buf(maxT * c.qDim * f),
      K: this.buf(maxT * c.kvDim * f), V: this.buf(maxT * c.kvDim * f), AT: this.buf(maxT * c.qDim * f),
      G: this.buf(maxT * c.F * f), U: this.buf(maxT * c.F * f), LG: this.buf(this.vocab * f), ids: this.buf(maxT * 4) };
    this.cache = { K: [], V: [] };
    for (let l = 0; l < c.L; l++) { this.cache.K.push(this.buf(maxCtx * c.kvDim * f)); this.cache.V.push(this.buf(maxCtx * c.kvDim * f)); }
    this.readBuf = this.device.createBuffer({ size: this.vocab * 4, usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST });
    // fused decode path: needs q/k/v/gate/up in a format with a decode kernel (Q4_K / Q6_K)
    const fusable = (n) => [12, 14].includes(this.W.get(n).type) && this.W.get(n).cols % 256 === 0;
    this.fusedOK = [...Array(c.L).keys()].every((l) =>
      ['attn_q', 'attn_k', 'attn_v', 'ffn_gate', 'ffn_up'].every((n) => fusable(`blk.${l}.${n}.weight`)));
    this.A.QKV = this.buf((c.qDim + 2 * c.kvDim) * f);
    this.A.GU = this.buf(2 * c.F * f);
    this.posBuf = this.buf(16);
  }

  // one fused matvec over several weights: segs = [[weight, yOffset], ...]
  mmMulti(segs, x, y, accum = false) {
    const types = segs.map(([w]) => w.type);
    const rows = segs.reduce((s, [w]) => s + w.rows, 0);
    const nwg = Math.ceil(rows / 8), nbx = Math.min(nwg, 65535);
    const words = [];
    for (let i = 0; i < 3; i++) { const s = segs[i]; words.push(...(s ? [[s[0].rows], [s[0].rowBytes], [s[1]], [s[0].cols]] : [[0], [0], [0], [0]])); }
    words.push([nbx], [accum ? 1 : 0], [0], [0]);
    this.disp(this.pipe('mmd' + types.join('_'), mmDecWGSL(types)), [...segs.map(([w]) => w.buf), x, y, this.uni(words, true)],
      nbx, Math.ceil(nwg / nbx));
  }

  // decode layer with fused dispatches (10 per layer); position comes from posBuf
  layerDec(l) {
    const c = this.cfg, A = this.A, p = `blk.${l}.`, W = (n) => this.W.get(p + n + '.weight');
    this.rms(A.XL, A.H, 1, c.D, this.N.get(p + 'attn_norm.weight'), c.eps);
    this.mmMulti([[W('attn_q'), 0], [W('attn_k'), c.qDim], [W('attn_v'), c.qDim + c.kvDim]], A.H, A.QKV);
    this.disp(this.pipe('hrd', HEADROPE_DEC), [A.QKV, this.N.get(p + 'attn_q_norm.weight'), this.N.get(p + 'attn_k_norm.weight'),
      this.posBuf, this.uni([[c.H], [c.eps, 'f'], [c.base, 'f'], [0]], true)], c.H + c.KV);
    this.disp(this.pipe('kvd', KVCOPY_DEC), [A.QKV, this.cache.K[l], this.cache.V[l], this.posBuf,
      this.uni([[c.qDim], [c.kvDim], [0], [0]], true)], Math.ceil(c.kvDim / 256));
    this.disp(this.pipe('attnd', ATTN_DEC), [A.QKV, this.cache.K[l], this.cache.V[l], A.AT,
      this.uni([[0], [c.H / c.KV], [c.qDim], [0], [c.kvDim], [0], [c.kvDim], [0], [c.qDim], [1 / Math.sqrt(128), 'f'], [0], [0]], true),
      this.posBuf], 1, c.H);
    this.mm(W('attn_output'), A.AT, A.XL, 1, true);
    this.rms(A.XL, A.H, 1, c.D, this.N.get(p + 'ffn_norm.weight'), c.eps);
    this.mmMulti([[W('ffn_gate'), 0], [W('ffn_up'), c.F]], A.H, A.GU);
    this.disp(this.pipe('silu2', SILUMUL2), [A.GU, A.G, this.uni([[c.F], [0], [0], [0]], true)], Math.ceil(c.F / 256));
    this.mm(W('ffn_down'), A.G, A.XL, 1, true);
  }

  async loadProjector(src) {
    const st = await openSafetensors(src);
    const P = { type: st.meta.type ?? 'linear', enc: Number(st.meta.enc_layers ?? 18), eps: Number(st.meta.eps ?? 1e-6), W: new Map(), N: new Map(), layers: [] };
    for (const t of st.tensors.values()) {
      const bytes = new Uint8Array(await st.src.read(t.offset, t.nbytes));
      if (t.shape.length === 1) P.N.set(t.name, this.upload(new Uint8Array(new Float32Array(dequantF32(t.type, bytes)).buffer)));
      else P.W.set(t.name, { buf: this.upload(bytes), type: t.type, rows: t.shape[0], cols: t.shape[1], rowBytes: t.shape[1] * BLOCK[t.type][1] });
      const m = /^layers\.(\d+)\.k\.weight$/.exec(t.name);
      if (m) P.layers.push(Number(m[1]));
    }
    P.layers.sort((a, b) => a - b);
    if (P.type === 'ctx') {
      Object.assign(P, { d: Number(st.meta.d), nb: Number(st.meta.n_blocks), nh: Number(st.meta.n_heads), ffn: Number(st.meta.ffn) });
      if (P.d / P.nh !== 128) throw new Error('ctx projector: head dim must be 128');
      const T = this.maxT, f = 4; // dedicated work buffers (ffn can be wider than the model's kv dim)
      P.B = { Z: this.buf(T * P.d * f), ZN: this.buf(T * P.d * f), H: this.buf(T * P.d * f), QKV: this.buf(T * 3 * P.d * f),
        AT: this.buf(T * P.d * f), G: this.buf(T * P.ffn * f), U: this.buf(T * P.ffn * f) };
    }
    this.P = P;
    return P;
  }

  layer(l, X, Tq, qPos0, kvGiven) {
    const c = this.cfg, A = this.A, p = `blk.${l}.`;
    this.rms(X, A.H, Tq, c.D, this.N.get(p + 'attn_norm.weight'), c.eps);
    this.mm(this.W.get(p + 'attn_q.weight'), A.H, A.Q, Tq);
    if (!kvGiven) {
      this.mm(this.W.get(p + 'attn_k.weight'), A.H, A.K, Tq);
      this.mm(this.W.get(p + 'attn_v.weight'), A.H, A.V, Tq);
      this.headRope(A.K, Tq, c.KV, this.N.get(p + 'attn_k_norm.weight'), qPos0, c.kvDim);
      this.copy2d(A.K, this.cache.K[l], c.kvDim, Tq, c.kvDim, c.kvDim, qPos0 * c.kvDim);
      this.copy2d(A.V, this.cache.V[l], c.kvDim, Tq, c.kvDim, c.kvDim, qPos0 * c.kvDim);
    }
    this.headRope(A.Q, Tq, c.H, this.N.get(p + 'attn_q_norm.weight'), qPos0, c.qDim);
    this.attn(A.Q, this.cache.K[l], this.cache.V[l], A.AT, Tq, qPos0, c.H, c.H / c.KV,
      { qStride: c.qDim, kStride: c.kvDim, vStride: c.kvDim, oStride: c.qDim });
    this.mm(this.W.get(p + 'attn_output.weight'), A.AT, X, Tq, true);
    this.rms(X, A.H, Tq, c.D, this.N.get(p + 'ffn_norm.weight'), c.eps);
    this.mm(this.W.get(p + 'ffn_gate.weight'), A.H, A.G, Tq);
    this.mm(this.W.get(p + 'ffn_up.weight'), A.H, A.U, Tq);
    this.elem(SILUMUL, 'silu', A.U, A.G, Tq * c.F);
    this.mm(this.W.get(p + 'ffn_down.weight'), A.G, X, Tq, true);
  }

  // projector: writes post-norm/RoPE K and V of every decoder layer into the cache for positions 0..T-1
  projector(T) {
    const c = this.cfg, A = this.A, P = this.P;
    let ZN = null;
    if (P.type === 'ctx') {
      const d = P.d, W = (n) => P.W.get(n), N = (n) => P.N.get(n), B = P.B;
      this.rms(A.X, A.H, T, c.D, null, P.eps);
      this.mm(W('ctx.inp.weight'), A.H, B.Z, T);
      for (let b = 0; b < P.nb; b++) {
        const q = `ctx.blocks.${b}.`;
        this.rms(B.Z, B.H, T, d, N(q + 'n1'), P.eps);
        this.mm(W(q + 'qkv.weight'), B.H, B.QKV, T);
        this.headRope(B.QKV, T, P.nh, null, 0, 3 * d, 0);
        this.headRope(B.QKV, T, P.nh, null, 0, 3 * d, d);
        this.attn(B.QKV, B.QKV, B.QKV, B.AT, T, 0, P.nh, 1, { qStride: 3 * d, qOff: 0, kStride: 3 * d, kOff: d, vStride: 3 * d, vOff: 2 * d, oStride: d });
        this.mm(W(q + 'o.weight'), B.AT, B.Z, T, true);
        this.rms(B.Z, B.H, T, d, N(q + 'n2'), P.eps);
        this.mm(W(q + 'gate.weight'), B.H, B.G, T);
        this.mm(W(q + 'up.weight'), B.H, B.U, T);
        this.elem(SILUMUL, 'silu', B.U, B.G, T * P.ffn);
        this.mm(W(q + 'down.weight'), B.G, B.Z, T, true);
      }
      ZN = B.ZN;
      this.rms(B.Z, ZN, T, d, N('ctx.out_norm.weight'), P.eps);
    }
    for (const l of P.layers) {
      this.rms(A.X, A.H, T, c.D, P.N.get(`layers.${l}.norm.weight`), P.eps);
      this.mm(P.W.get(`layers.${l}.k.weight`), A.H, A.K, T);
      this.mm(P.W.get(`layers.${l}.v.weight`), A.H, A.V, T);
      this.elem(BIAS, 'bias', P.N.get(`layers.${l}.k.bias`), A.K, T * c.kvDim, [c.kvDim]);
      this.elem(BIAS, 'bias', P.N.get(`layers.${l}.v.bias`), A.V, T * c.kvDim, [c.kvDim]);
      if (ZN) {
        this.mm(P.W.get(`ctx.k_out.${l}.weight`), ZN, A.K, T, true);
        this.mm(P.W.get(`ctx.v_out.${l}.weight`), ZN, A.V, T, true);
      }
      this.headRope(A.K, T, c.KV, this.N.get(`blk.${l}.attn_k_norm.weight`), 0, c.kvDim);
      this.copy2d(A.K, this.cache.K[l], c.kvDim, T, c.kvDim, c.kvDim, 0);
      this.copy2d(A.V, this.cache.V[l], c.kvDim, T, c.kvDim, c.kvDim, 0);
    }
  }

  async logits(X, rowOff, argmaxOnly = false) {
    const c = this.cfg, A = this.A;
    this.rms(X, A.H, 1, c.D, this.N.get('output_norm.weight'), c.eps, rowOff);
    this.mm(this.W.get('output.weight'), A.H, A.LG, 1);
    if (argmaxOnly) { // greedy decoding: pick the token on the GPU and read back 4 bytes instead of the whole vocab
      this.disp(this.pipe('argmax', ARGMAX), [A.LG, this.amBuf, this.uni([[this.vocab], [0], [0], [0]], true)], 1);
      this.pass.end();
      this.enc.copyBufferToBuffer(this.amBuf, 0, this.amRead, 0, 16);
      this.pass = this.enc.beginComputePass();
      await this.end();
      await this.amRead.mapAsync(GPUMapMode.READ);
      const id = new Uint32Array(this.amRead.getMappedRange())[0];
      this.amRead.unmap();
      return id;
    }
    this.pass.end();
    this.enc.copyBufferToBuffer(A.LG, 0, this.readBuf, 0, this.vocab * 4);
    this.pass = this.enc.beginComputePass();
    await this.end();
    await this.readBuf.mapAsync(GPUMapMode.READ);
    const out = new Float32Array(this.readBuf.getMappedRange().slice(0));
    this.readBuf.unmap();
    return out;
  }

  /** prefill: mode 'full' or 'ced'. Returns logits of the last prompt position (or the argmax token id). */
  async prefill(ids, mode = 'full', argmaxOnly = false) {
    const c = this.cfg, A = this.A, T = ids.length;
    if (T > this.maxT) throw new Error(`prompt longer than maxT=${this.maxT}`);
    this.device.queue.writeBuffer(A.ids, 0, new Uint32Array(ids));
    this.begin();
    const e = this.W.get('token_embd.weight');
    this.disp(this.pipe('gr' + e.type, getrowsWGSL(e.type)), [e.buf, A.ids, A.X, this.uni([[e.cols], [e.rowBytes], [0], [0]])], T);
    if (mode === 'full') {
      for (let l = 0; l < c.L; l++) { this.layer(l, A.X, T, 0, false); if (l % 6 === 5) { await this.end(); this.begin(); } }
      this.pos = T;
      return this.logits(A.X, T - 1, argmaxOnly);
    }
    const enc = this.P.enc;
    for (let l = 0; l < enc; l++) { this.layer(l, A.X, T, 0, false); if (l % 6 === 5) { await this.end(); this.begin(); } }
    this.projector(T);
    this.copy2d(A.X, A.XL, c.D, 1, c.D, c.D, 0, (T - 1) * c.D);
    for (let l = enc; l < c.L; l++) this.layer(l, A.XL, 1, T - 1, true); // decoder only for the last position
    this.pos = T;
    return this.logits(A.XL, 0, argmaxOnly);
  }

  /** one decode step through the whole network (real KV), appends to the cache */
  async step(id, argmaxOnly = false) {
    const c = this.cfg, A = this.A;
    this.device.queue.writeBuffer(A.ids, 0, new Uint32Array([id]));
    this.begin();
    const e = this.W.get('token_embd.weight');
    this.disp(this.pipe('gr' + e.type, getrowsWGSL(e.type)), [e.buf, A.ids, A.XL, this.uni([[e.cols], [e.rowBytes], [0], [0]], true)], 1);
    if (this.fusedOK && this.fused !== false) {
      this.device.queue.writeBuffer(this.posBuf, 0, new Uint32Array([this.pos, 0, 0, 0]));
      for (let l = 0; l < c.L; l++) this.layerDec(l);
    } else {
      for (let l = 0; l < c.L; l++) this.layer(l, A.XL, 1, this.pos, false);
    }
    this.pos++;
    return this.logits(A.XL, 0, argmaxOnly);
  }
}

// small helper for 1-D tensors (norm weights / biases): to float32 on the CPU
function dequantF32(type, bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (type === 0) return Array.from({ length: bytes.byteLength / 4 }, (_, i) => dv.getFloat32(i * 4, true));
  const f16 = (h) => { const s = h & 0x8000 ? -1 : 1, e = (h >> 10) & 31, m = h & 1023;
    return e === 0 ? s * m * 2 ** -24 : e === 31 ? (m ? NaN : s * Infinity) : s * (1 + m / 1024) * 2 ** (e - 15); };
  if (type === 1) return Array.from({ length: bytes.byteLength / 2 }, (_, i) => f16(dv.getUint16(i * 2, true)));
  if (type === 30) { const f = new Float32Array(1), u = new Uint32Array(f.buffer);
    return Array.from({ length: bytes.byteLength / 2 }, (_, i) => { u[0] = dv.getUint16(i * 2, true) << 16; return f[0]; }); }
  throw new Error('1-D tensor type ' + type);
}

export const argmax = (a) => { let bi = 0; for (let i = 1; i < a.length; i++) if (a[i] > a[bi]) bi = i; return bi; };
