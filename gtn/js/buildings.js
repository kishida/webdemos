// Procedural buildings with real carved interiors behind the windows.
// Geometry is generated analytically (no CSG): facade walls tessellated around a
// grid of holes, window tunnels (reveals), and partitioned rooms per floor.
// Room lighting is a small ray-traced field (direct + one bounce) per room shape.
import * as THREE from 'three';

export const SHELL = 0.45;   // facade thickness = reveal depth
export const PITCH = 2.0;    // floor pitch
export const RH = 1.7;       // room height
export const PART = 0.35;    // partition thickness
const COLSP = 1.7;
const MARGIN = SHELL + 0.4;
const ROOM_SPP = 128;

// ---------- deterministic RNG ----------
let seed = 1;
export function setSeed(s) { seed = (s >>> 0) || 1; seed2 = ((s * 2654435761) >>> 0) || 7; }
export function rnd() {
  seed ^= seed << 13; seed >>>= 0;
  seed ^= seed >>> 17;
  seed ^= seed << 5; seed >>>= 0;
  return seed / 4294967296;
}
const rr = (a, b) => a + (b - a) * rnd();
// Second stream for decoration that only one window mode draws (blinds, desks, flat-panel art).
// Keeping it off the main stream means layouts and lit/unlit decisions are identical in both modes.
let seed2 = 7;
export function rnd2() {
  seed2 ^= seed2 << 13; seed2 >>>= 0;
  seed2 ^= seed2 >>> 17;
  seed2 ^= seed2 << 5; seed2 >>>= 0;
  return seed2 / 4294967296;
}
const rr2 = (a, b) => a + (b - a) * rnd2();
const pick2 = a => a[Math.floor(rnd2() * a.length)];

// ---------- quad emission ----------
// axis 0 -> [fixed, v, u] natural normal -X
// axis 1 -> [u, fixed, v] natural normal -Y
// axis 2 -> [u, v, fixed] natural normal +Z
const NATURAL = [-1, -1, 1];
function pt(axis, f, u, v) {
  return axis === 0 ? [f, v, u] : axis === 1 ? [u, f, v] : [u, v, f];
}
class Buf {
  constructor() { this.p = []; this.n = []; this.uv = []; this.cN = []; this.cD = []; }
  get verts() { return this.p.length / 3; }
}
const WHITE = [[1, 1, 1], [1, 1, 1]];
function rect(buf, axis, f, u0, u1, v0, v1, sign, colFn) {
  const A = [u0, v0], B = [u1, v0], C = [u1, v1], D = [u0, v1];
  const order = sign === NATURAL[axis] ? [A, B, C, A, C, D] : [A, D, C, A, C, B];
  const nx = axis === 0 ? sign : 0, ny = axis === 1 ? sign : 0, nz = axis === 2 ? sign : 0;
  for (const [u, v] of order) {
    const P = pt(axis, f, u, v);
    buf.p.push(P[0], P[1], P[2]);
    buf.n.push(nx, ny, nz);
    buf.uv.push(u, v);
    const c = colFn ? colFn(P) : WHITE;
    buf.cN.push(c[0][0], c[0][1], c[0][2]);
    buf.cD.push(c[1][0], c[1][1], c[1][2]);
  }
}
// subdivided rect so per-vertex baked colours can follow the lighting field
function rectSub(buf, axis, f, u0, u1, v0, v1, sign, colFn, cell = 2.2) {
  const nu = Math.min(6, Math.max(1, Math.ceil((u1 - u0) / cell)));
  const nv = Math.min(6, Math.max(1, Math.ceil((v1 - v0) / cell)));
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    rect(buf, axis, f,
      u0 + (u1 - u0) * i / nu, u0 + (u1 - u0) * (i + 1) / nu,
      v0 + (v1 - v0) * j / nv, v0 + (v1 - v0) * (j + 1) / nv, sign, colFn);
  }
}

// Wall with holes on a grid: bands are [vb, vt, holes[[ua,ub]...]] sorted by v.
export function gridWall(u0, u1, v0, v1, bands) {
  const out = []; let v = v0;
  for (const [vb, vt, holes] of bands) {
    if (vb > v + 1e-6) out.push([u0, u1, v, vb]);
    let cur = u0;
    for (const [ua, ub] of holes) {
      if (ua > cur + 1e-6) out.push([cur, ua, vb, vt]);
      if (ub > cur) cur = ub;
    }
    if (cur < u1 - 1e-6) out.push([cur, u1, vb, vt]);
    v = vt;
  }
  if (v < v1 - 1e-6) out.push([u0, u1, v, v1]);
  return out;
}

// ---------- interior lighting field (ray traced) ----------
function rtExit(lo, hi, o, d) {
  let tMin = Infinity, face = -1, sgn = 0;
  for (let a = 0; a < 3; a++) {
    if (Math.abs(d[a]) < 1e-9) continue;
    const t = ((d[a] > 0 ? hi[a] : lo[a]) - o[a]) / d[a];
    if (t > 1e-6 && t < tMin) { tMin = t; face = a; sgn = d[a] > 0 ? 1 : -1; }
  }
  return { t: tMin, face, sgn };
}
// Ceiling lamps emit downward (cosine lobe), so the ceiling only gets bounce.
function rtDirect(lamps, p, n) {
  let s = 0;
  for (const L of lamps) {
    const dx = L[0] - p[0], dy = L[1] - p[1], dz = L[2] - p[2];
    const r2 = dx * dx + dy * dy + dz * dz, r = Math.sqrt(r2) + 1e-6;
    const recv = Math.max(0, (dx * n[0] + dy * n[1] + dz * n[2]) / r);
    if (dy <= 0) continue;                 // nothing above the lamp plane gets direct light
    s += recv * (0.3 + 0.7 * dy / r) / (r2 + 0.25);
  }
  return s;
}
function cosineDir(n, r1, r2) {
  const a = Math.abs(n[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1];
  let T = [a[1] * n[2] - a[2] * n[1], a[2] * n[0] - a[0] * n[2], a[0] * n[1] - a[1] * n[0]];
  const tl = Math.hypot(T[0], T[1], T[2]); T = T.map(x => x / tl);
  const B = [n[1] * T[2] - n[2] * T[1], n[2] * T[0] - n[0] * T[2], n[0] * T[1] - n[1] * T[0]];
  const phi = 2 * Math.PI * r2, st = Math.sqrt(r1), ct = Math.sqrt(1 - r1);
  const cp = Math.cos(phi) * st, sp = Math.sin(phi) * st;
  return [T[0] * cp + B[0] * sp + n[0] * ct, T[1] * cp + B[1] * sp + n[1] * ct, T[2] * cp + B[2] * sp + n[2] * ct];
}
function rtShade(lo, hi, lamps, p, n) {
  let ind = 0;
  for (let s = 0; s < ROOM_SPP; s++) {
    const d = cosineDir(n, (s + Math.random()) / ROOM_SPP, Math.random());
    const e = rtExit(lo, hi, p, d);
    if (e.face < 0) continue;
    const hp = [p[0] + d[0] * e.t, p[1] + d[1] * e.t, p[2] + d[2] * e.t];
    const hn = [0, 0, 0]; hn[e.face] = -e.sgn;
    ind += 0.5 * rtDirect(lamps, hp, hn);
  }
  return rtDirect(lamps, p, n) + ind / ROOM_SPP;
}
// face order: 0:+X 1:-X 2:+Y(ceiling) 3:-Y(floor) 4:+Z 5:-Z
// face (u,v): X walls -> (z,y); Y faces -> (x,z); Z walls -> (x,y)
const FACE_UV = [[2, 1], [2, 1], [0, 2], [0, 2], [0, 1], [0, 1]];
const fieldCache = new Map();
export const bakeStats = { keys: 0, ms: 0 };
function bakeField(W, H, D, lamps) {
  const t0 = performance.now();
  const lo = [0, 0, 0], hi = [W, H, D];
  const f = new Float32Array(54);
  for (let face = 0; face < 6; face++) {
    const a = face >> 1, top = face % 2 === 0;
    const [ua, va] = FACE_UV[face];
    for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) {
      const p = [0, 0, 0], n = [0, 0, 0];
      p[a] = top ? hi[a] : lo[a]; n[a] = top ? -1 : 1;
      p[ua] = lo[ua] + (hi[ua] - lo[ua]) * i / 2;
      p[va] = lo[va] + (hi[va] - lo[va]) * j / 2;
      for (let k = 0; k < 3; k++) p[k] = Math.min(hi[k] - 0.03, Math.max(lo[k] + 0.03, p[k]));
      f[face * 9 + j * 3 + i] = rtShade(lo, hi, lamps, p, n);
    }
  }
  let mean = 0; for (const v of f) mean += v; mean /= 54;
  for (let i = 0; i < 54; i++) f[i] *= 0.45 / mean;
  bakeStats.keys++; bakeStats.ms += performance.now() - t0;
  return f;
}
function getField(W, H, D, lampsRel, nx, nz) {
  // Height and lamp count shape the distribution and must be in the key; beyond ~4 lamps per row
  // the 3x3 field barely changes, so counts are capped to keep the number of bakes down.
  const key = Math.round(W / 2) + '|' + Math.round(D / 2) + '|' + Math.round(H * 4) + '|' + Math.min(nx, 4) + 'x' + Math.min(nz, 4);
  let f = fieldCache.get(key);
  if (!f) { f = bakeField(W, H, D, lampsRel); fieldCache.set(key, f); }
  return f;
}
// bilinear read of the 3x3 field by fractional position on a face
function sampleField(f, face, fu, fv) {
  fu = Math.min(2, Math.max(0, fu * 2)); fv = Math.min(2, Math.max(0, fv * 2));
  const i0 = Math.min(1, Math.floor(fu)), j0 = Math.min(1, Math.floor(fv));
  const tu = fu - i0, tv = fv - j0, b = face * 9;
  const a00 = f[b + j0 * 3 + i0], a10 = f[b + j0 * 3 + i0 + 1];
  const a01 = f[b + (j0 + 1) * 3 + i0], a11 = f[b + (j0 + 1) * 3 + i0 + 1];
  return (a00 * (1 - tu) + a10 * tu) * (1 - tv) + (a01 * (1 - tu) + a11 * tu) * tv;
}

// ---------- palettes ----------
const LIGHT_TINTS = [[1.0, 0.82, 0.58], [1.0, 0.9, 0.72], [0.86, 0.93, 1.0], [1.0, 0.95, 0.88], [0.95, 0.78, 0.55]];
const WALL_ALB = [[1, 1, 1], [1.0, 0.94, 0.85], [0.88, 0.95, 1.0], [0.95, 1.0, 0.9], [1.0, 0.88, 0.86], [0.9, 0.9, 0.9]];
const FLOOR_ALB = [[0.55, 0.45, 0.35], [0.45, 0.47, 0.5], [0.6, 0.52, 0.4], [0.4, 0.38, 0.42]];
// Reveal outer-edge radiance per unit albedo, measured in the browser by rendering a white
// MeshStandardMaterial wall (linear, before tone mapping) under the game's lights:
//   night: 0.017-0.069 (mean ~0.035, bluish moonlight) -> x0.8 because the recess sees less sky
//   day:   sunlit 0.49-0.60, shaded 0.14-0.18 -> sides/soffit are mostly shaded, the sill faces the sun
const REVEAL_NIGHT = [0.022, 0.025, 0.04];
const REVEAL_DAY = [0.15, 0.16, 0.18];
const REVEAL_DAY_SILL = [0.38, 0.37, 0.35];
const SHOP_TINTS = [[1.0, 0.98, 0.95], [0.9, 0.96, 1.0], [1.0, 0.88, 0.7], [1.0, 0.93, 0.82]];
const SHOP_FLOOR = [[0.8, 0.8, 0.78], [0.55, 0.42, 0.3], [0.35, 0.35, 0.36], [0.7, 0.66, 0.6]];
const pick = a => a[Math.floor(rnd() * a.length)];
const mul = (a, b, s = 1) => [a[0] * b[0] * s, a[1] * b[1] * s, a[2] * b[2] * s];
const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

// ---------- the building ----------
// opts: { w, d, h (local units), facadeAvg:[r,g,b] linear }
export function buildBuilding(opts) {
  const { w, d, h } = opts;
  const facadeAvg = opts.facadeAvg || [0.35, 0.33, 0.3];
  const occupancy = opts.occupancy ?? 0.65;
  // flat: comparison mode - no openings, no rooms; each window is a flat textured light panel
  const flat = !!opts.flat;
  const F = new Buf(), I = new Buf(), R = new Buf(), G = new Buf(), L = new Buf(), FW = new Buf();
  const ix0 = -w / 2 + SHELL, ix1 = w / 2 - SHELL, iz0 = -d / 2 + SHELL, iz1 = d / 2 - SHELL;

  function columns(span) {
    const usable = span - 2 * MARGIN;
    if (usable < 1.0) return { cols: [], ow: 0, sp: 0 };
    const n = Math.max(1, Math.floor(usable / COLSP));
    const sp = usable / n;
    const ow = Math.min(1.25, sp * 0.62);
    return { cols: Array.from({ length: n }, (_, c) => -usable / 2 + (c + 0.5) * sp), ow, sp };
  }
  const zc = columns(w);   // ±Z faces, columns along x
  const xc = columns(d);   // ±X faces, columns along z

  // ground storey: a taller shop level (storefront glass + sign band) when the building is big enough
  const SHOP = opts.shop !== false && h > 6 && (zc.cols.length || xc.cols.length);
  const SB = 0.06, SRH = 2.2;                       // shop floor level and height (local)
  const firstBase = SHOP ? SB + SRH + 0.44 : 1.14;
  const floors = [];
  for (let r = 0; ; r++) { const base = firstBase + r * PITCH; if (base + RH > h - 0.3) break; floors.push(base); }

  // Partitions sit in gaps between window columns, so the facade grid never changes while the
  // rooms behind it do. Count per axis is drawn from a weighted distribution (bounded by what
  // fits), and the walls go into randomly chosen gaps, so splits are uneven: a big corner office
  // can sit next to two small rooms.
  const MIN_ROOM = 1.4;                        // local units (~2.5 m)
  function partitions(cols, lo, hi, n) {
    if (n <= 1 || cols.length < 2) return [];
    const gaps = [];
    for (let i = 0; i < cols.length - 1; i++) {
      const g = (cols[i] + cols[i + 1]) / 2;
      if (g - lo >= MIN_ROOM && hi - g >= MIN_ROOM) gaps.push(g);
    }
    const out = [];
    for (let tries = 0; out.length < n - 1 && tries < 40; tries++) {
      const g = gaps[Math.floor(rnd() * gaps.length)];
      if (g === undefined) break;
      if (out.every(p => Math.abs(p - g) >= MIN_ROOM + PART)) out.push(g);
    }
    return out.sort((a, b) => a - b);
  }
  // wider floor plates lean toward more rooms
  const ROOM_N_SMALL = [[1, 0.1], [2, 0.45], [3, 0.3], [4, 0.15]];
  const ROOM_N_LARGE = [[1, 0.03], [2, 0.2], [3, 0.38], [4, 0.39]];
  function pickRoomCount(extent) {
    const nMax = Math.max(1, Math.min(4, Math.floor(extent / 2.6)));   // rooms of at least ~4.5 m
    const opts = (extent > 15 ? ROOM_N_LARGE : ROOM_N_SMALL).filter(([n]) => n <= nMax);
    let r = rnd() * opts.reduce((a, [, w]) => a + w, 0);
    for (const [n, w] of opts) { if ((r -= w) <= 0) return n; }
    return opts[opts.length - 1][0];
  }
  const intervals = (lo, hi, parts) => {
    const out = []; let a = lo;
    for (const p of parts) { out.push([a, p - PART / 2]); a = p + PART / 2; }
    out.push([a, hi]);
    return out;
  };
  // assign windows to room intervals. A window that touches a partition is trimmed back to it
  // (shop glass is wide); if too little remains it is dropped.
  function assign(cols, ow, ints) {
    const out = [];
    for (const a of cols) {
      const k = ints.findIndex(([lo, hi]) => a >= lo && a <= hi);
      if (k < 0) continue;
      const ua = Math.max(a - ow / 2, ints[k][0] + 0.06), ub = Math.min(a + ow / 2, ints[k][1] - 0.06);
      if (ub - ua < 0.5) continue;
      out.push({ a: (ua + ub) / 2, k, ua, ub });
    }
    return out;
  }
  // a tenant's floor plan; open-plan offices have no partitions at all
  function makePlan(shop) {
    const open = !shop && rnd() < 0.08;
    const nx = open ? 1 : pickRoomCount(ix1 - ix0), nz = open ? 1 : pickRoomCount(iz1 - iz0);
    const xI = intervals(ix0, ix1, partitions(zc.cols, ix0, ix1, shop ? Math.max(nx, 2) : nx));
    const zI = intervals(iz0, iz1, partitions(xc.cols, iz0, iz1, shop ? Math.max(nz, 2) : nz));
    return { xI, zI, open, okX: xI.map(([a, b]) => b - a >= 0.7), okZ: zI.map(([a, b]) => b - a >= 0.7) };
  }
  function makeLevel(base, rh, yb, yt, shop, plan, occ) {
    const { xI, zI, okX, okZ } = plan;
    const sow = c => Math.min(c.sp * 0.86, 1.7);
    const zW = assign(zc.cols, shop ? sow(zc) : zc.ow, xI).filter(wn => okX[wn.k]);
    const xW = assign(xc.cols, shop ? sow(xc) : xc.ow, zI).filter(wn => okZ[wn.k]);
    return { base, rh, yb, yt, shop, xI, zI, okX, okZ, zW, xW, occ };
  }

  // levels: optional shop storey + regular floors. Floors come in tenant runs of 1-4 floors that
  // share a plan and an occupancy (one company working late lights a whole band of floors).
  const levels = [];
  if (SHOP) levels.push(makeLevel(SB, SRH, 0.3, 1.74, true, makePlan(true), 0.82));
  let plan = null, occ = occupancy, left = 0;
  for (const base of floors) {
    if (left <= 0) {
      plan = makePlan(false);
      left = 1 + Math.floor(rnd() * (plan.open ? 2 : 4));
      // tenant occupancy spreads around the building's average: some floors dark, some all lit
      occ = Math.min(0.97, Math.max(0.12, occupancy + rr(-0.3, 0.3)));
    }
    left--;
    levels.push(makeLevel(base, RH, base + RH * 0.25, base + RH - 0.08, false, plan, occ));
  }
  // ±Z windows also require the touching z-interval to be valid, likewise ±X
  const zFace = (Lv, s) => Lv.okZ[s > 0 ? Lv.zI.length - 1 : 0] ? Lv.zW : [];
  const xFace = (Lv, s) => Lv.okX[s > 0 ? Lv.xI.length - 1 : 0] ? Lv.xW : [];

  // ---- facade ----
  for (const s of [1, -1]) {
    const zb = flat ? [] : levels.map(Lv => [Lv.yb, Lv.yt, zFace(Lv, s).map(wn => [wn.ua, wn.ub])]);
    const xb = flat ? [] : levels.map(Lv => [Lv.yb, Lv.yt, xFace(Lv, s).map(wn => [wn.ua, wn.ub])]);
    for (const [u0, u1, v0, v1] of gridWall(-w / 2, w / 2, 0, h, zb)) rect(F, 2, s * d / 2, u0, u1, v0, v1, s);
    for (const [u0, u1, v0, v1] of gridWall(-d / 2, d / 2, 0, h, xb)) rect(F, 0, s * w / 2, u0, u1, v0, v1, s);
  }
  rect(R, 1, h, -w / 2, w / 2, -d / 2, d / 2, 1);
  rect(F, 1, 0, -w / 2, w / 2, -d / 2, d / 2, -1);
  // parapet lip on the roof (thin, part of roof group)
  const PH = 0.35, PT = 0.18;
  for (const s of [1, -1]) {
    rect(F, 2, s * d / 2, -w / 2, w / 2, h, h + PH, s);
    rect(R, 2, s * (d / 2 - PT), -w / 2 + PT, w / 2 - PT, h, h + PH, -s);
    rect(F, 0, s * w / 2, -d / 2, d / 2, h, h + PH, s);
    rect(R, 0, s * (w / 2 - PT), -d / 2 + PT, d / 2 - PT, h, h + PH, -s);
    rect(R, 1, h + PH, -w / 2, w / 2, s > 0 ? d / 2 - PT : -d / 2, s > 0 ? d / 2 : -d / 2 + PT, 1);
    rect(R, 1, h + PH, s > 0 ? w / 2 - PT : -w / 2, s > 0 ? w / 2 : -w / 2 + PT, -d / 2 + PT, d / 2 - PT, 1);
  }

  // ---- rooms ----
  let roomCount = 0, lampCount = 0;
  const signs = [];   // storefront sign placements (local coords), consumed by the game
  for (const Lv of levels) {
    const { base, rh, yb, yt, shop, xI, zI, okX, okZ } = Lv;
    const lampXs = xi => { const v = Lv.zW.filter(wn => wn.k === xi).map(wn => wn.a); return v.length ? v : [(xI[xi][0] + xI[xi][1]) / 2]; };
    const lampZs = zi => { const v = Lv.xW.filter(wn => wn.k === zi).map(wn => wn.a); return v.length ? v : [(zI[zi][0] + zI[zi][1]) / 2]; };
    for (let xi = 0; xi < xI.length; xi++) for (let zi = 0; zi < zI.length; zi++) {
      if (!okX[xi] || !okZ[zi]) continue;
      const [x0, x1] = xI[xi], [z0, z1] = zI[zi];
      const lo = [x0, base, z0], hi = [x1, base + rh, z1];
      const W = x1 - x0, D = z1 - z0;
      roomCount++;

      // lamps on the window grid
      const xs = lampXs(xi), zs = lampZs(zi);
      const lamps = xs.flatMap(x => zs.map(z => [x, base + rh - 0.08, z]));
      // whole rooms go dark at the occupancy rate; lamps switch independently within lit rooms.
      // Shops are mostly open and brightly lit; closed ones get a roller shutter.
      const occupied = rnd() < Lv.occ;
      const lit = lamps.map(() => occupied && rnd() < (shop ? 0.95 : 0.8));
      const litFrac = lit.filter(Boolean).length / lamps.length;
      const pow = litFrac > 0 ? (shop ? rr(0.8, 1.0) : rr(0.55, 0.95)) * (0.45 + 0.55 * litFrac) : 0;
      const tint = shop ? pick(SHOP_TINTS) : pick(LIGHT_TINTS), wallA = pick(WALL_ALB), floorA = shop ? pick(SHOP_FLOOR) : pick(FLOOR_ALB);
      const dayPow = rr(0.7, 1.25);
      if (flat) {
        // one quad per window, a hair in front of the facade, textured from a 2x2 atlas:
        // 0 lit room, 1 blinds, 2 warm room, 3 dark room
        const panel = () => {
          if (pow <= 0) return { cell: 3, c: [[0.05, 0.055, 0.07], [0.12, 0.13, 0.15]] };
          const k = rnd2(), cell = shop ? (k < 0.7 ? 0 : 2) : (k < 0.55 ? 0 : k < 0.8 ? 1 : 2);
          const lit = mul(tint, [1, 1, 1], pow * (shop ? 1.0 : 0.85));
          return { cell, c: [lit, shop ? lerp3([0.16, 0.17, 0.19], lit, 0.5) : mul([0.16, 0.17, 0.19], [1, 1, 1], dayPow)] };
        };
        const flatQuad = (axis, f, ua, ub, sgn) => {
          const { cell, c } = panel();
          const n0 = FW.uv.length;
          rect(FW, axis, f, ua, ub, yb, yt, sgn, () => c);
          // remap this quad's uvs into its atlas cell
          const cu = (cell % 2) * 0.5, cv = Math.floor(cell / 2) * 0.5;
          for (let q = n0; q < FW.uv.length; q += 2) {
            FW.uv[q] = cu + 0.5 * (FW.uv[q] - ua) / (ub - ua);
            FW.uv[q + 1] = cv + 0.5 * (FW.uv[q + 1] - yb) / (yt - yb);
          }
        };
        for (const sg of [1, -1]) {
          if (sg > 0 ? xi === xI.length - 1 : xi === 0) for (const wn of xFace(Lv, sg).filter(wn => wn.k === zi)) {
            flatQuad(0, sg * w / 2 + sg * 0.006, wn.ua, wn.ub, sg);
            rect(G, 0, sg * w / 2 + sg * 0.012, wn.ua, wn.ub, yb, yt, sg);
          }
          if (sg > 0 ? zi === zI.length - 1 : zi === 0) for (const wn of zFace(Lv, sg).filter(wn => wn.k === xi)) {
            flatQuad(2, sg * d / 2 + sg * 0.006, wn.ua, wn.ub, sg);
            rect(G, 2, sg * d / 2 + sg * 0.012, wn.ua, wn.ub, yb, yt, sg);
          }
        }
        if (shop) {
          const xw = sg => (sg > 0 ? xi === xI.length - 1 : xi === 0) ? xFace(Lv, sg).filter(wn => wn.k === zi) : [];
          const zw = sg => (sg > 0 ? zi === zI.length - 1 : zi === 0) ? zFace(Lv, sg).filter(wn => wn.k === xi) : [];
          for (const sg of [1, -1]) {
            const a = xw(sg), b2 = zw(sg);
            if (a.length) signs.push({ axis: 0, s: sg, fixed: sg * w / 2 + sg * 0.06, u0: a[0].ua - 0.15, u1: a[a.length - 1].ub + 0.15, v0: SB + 1.76, v1: SB + 2.56, open: occupied });
            if (b2.length) signs.push({ axis: 2, s: sg, fixed: sg * d / 2 + sg * 0.06, u0: b2[0].ua - 0.15, u1: b2[b2.length - 1].ub + 0.15, v0: SB + 1.76, v1: SB + 2.56, open: occupied });
          }
        }
        continue;
      }
      const field = getField(W, rh, D, lamps.map(L0 => [L0[0] - x0, L0[1] - base, L0[2] - z0]), xs.length, zs.length);

      const surfCol = (face, P) => {
        const [ua, va] = FACE_UV[face];
        const fv = sampleField(field, face, (P[ua] - lo[ua]) / (hi[ua] - lo[ua]), (P[va] - lo[va]) / (hi[va] - lo[va]));
        const alb = face === 3 ? floorA : face === 2 ? [0.95, 0.95, 0.95] : wallA;
        const night = pow > 0 ? mul(tint, alb, pow * fv) : mul(alb, [0.02, 0.022, 0.03]);
        // daylight: soft, brighter toward the windows, much darker than the sunlit facade.
        // Open shops keep their lights on during the day.
        let day = mul(alb, [0.95, 0.97, 1.0], dayPow * (0.07 + 0.1 * fv));
        if (shop && pow > 0) day = lerp3(day, night, 0.45);
        return [night, day];
      };
      const meanN = pow > 0 ? mul(tint, wallA, pow * 0.45) : mul(wallA, [0.02, 0.022, 0.03]);
      let meanD = mul(wallA, [0.95, 0.97, 1.0], dayPow * (0.07 + 0.1 * 0.45));
      if (shop && pow > 0) meanD = lerp3(meanD, meanN, 0.45);
      // The reveal is unlit (baked) while the wall around it is lit, so its outer edge must match what
      // the wall actually renders to - not a fixed fraction of the albedo. REVEAL_* are measured
      // white-wall radiances under the game's night / day lights (see the note at their definition).
      const revOuter = [mul(facadeAvg, REVEAL_NIGHT), mul(facadeAvg, REVEAL_DAY)];
      const revSill = [mul(facadeAvg, REVEAL_NIGHT), mul(facadeAvg, REVEAL_DAY_SILL)];
      // blinds: backlit fabric glows softly at night, flat beige by day
      const blindTint = pick2([[1, 0.95, 0.85], [0.9, 0.92, 0.95], [1, 0.85, 0.7]]);
      const blindCol = () => [pow > 0 ? mul(tint, blindTint, pow * 0.55) : [0.015, 0.015, 0.018], mul(blindTint, [0.45, 0.42, 0.38], 1)];
      const shutterCol = [[0.03, 0.032, 0.035], [0.26, 0.27, 0.28]];
      const revCol = (t, sill) => { const o = sill ? revSill : revOuter; return [lerp3(o[0], meanN, t), lerp3(o[1], meanD, t)]; };
      // what sits behind each opening: shutter (closed shop), blind (some offices) or nothing.
      // emit(fraction covered from the top, colour fn, depth from facade or -1 = just inside the room)
      const cover = emit => {
        if (shop) { if (!occupied) emit(1, () => shutterCol, 0.08); }
        else if (rnd2() < 0.3) { const f = rr2(0.15, 1); const bc = blindCol(); emit(f, () => bc, -1); }
      };

      rectSub(I, 1, base, x0, x1, z0, z1, 1, P => surfCol(3, P));
      rectSub(I, 1, base + rh, x0, x1, z0, z1, -1, P => surfCol(2, P));

      // X walls (u=z, v=y)
      for (const s of [1, -1]) {
        const xf = s > 0 ? x1 : x0, face = s > 0 ? 0 : 1;
        const perim = s > 0 ? xi === xI.length - 1 : xi === 0;
        const wins = perim ? xFace(Lv, s).filter(wn => wn.k === zi) : [];
        const bands = wins.length ? [[yb, yt, wins.map(wn => [wn.ua, wn.ub])]] : [];
        for (const [u0, u1, v0, v1] of gridWall(z0, z1, base, base + rh, bands)) rectSub(I, 0, xf, u0, u1, v0, v1, -s, P => surfCol(face, P));
        const xo = s * w / 2;
        for (const wn of wins) {
          const tf = P => revCol(Math.abs(xo - P[0]) / SHELL), tfs = P => revCol(Math.abs(xo - P[0]) / SHELL, true);
          rect(I, 1, yb, Math.min(xf, xo), Math.max(xf, xo), wn.ua, wn.ub, 1, tfs);
          rect(I, 1, yt, Math.min(xf, xo), Math.max(xf, xo), wn.ua, wn.ub, -1, tf);
          rect(I, 2, wn.ua, Math.min(xf, xo), Math.max(xf, xo), yb, yt, 1, tf);
          rect(I, 2, wn.ub, Math.min(xf, xo), Math.max(xf, xo), yb, yt, -1, tf);
          rect(G, 0, xo + s * 0.012, wn.ua, wn.ub, yb, yt, s);
          cover((f, cf, depth) => rect(I, 0, depth >= 0 ? xo - s * depth : xf - s * 0.03, wn.ua, wn.ub, yt - f * (yt - yb), yt, s, cf));
        }
        if (shop && wins.length) signs.push({ axis: 0, s, fixed: xo + s * 0.06, u0: wins[0].ua - 0.15, u1: wins[wins.length - 1].ub + 0.15, v0: SB + 1.76, v1: SB + 2.56, open: occupied });
      }
      // Z walls (u=x, v=y)
      for (const s of [1, -1]) {
        const zf = s > 0 ? z1 : z0, face = s > 0 ? 4 : 5;
        const perim = s > 0 ? zi === zI.length - 1 : zi === 0;
        const wins = perim ? zFace(Lv, s).filter(wn => wn.k === xi) : [];
        const bands = wins.length ? [[yb, yt, wins.map(wn => [wn.ua, wn.ub])]] : [];
        for (const [u0, u1, v0, v1] of gridWall(x0, x1, base, base + rh, bands)) rectSub(I, 2, zf, u0, u1, v0, v1, -s, P => surfCol(face, P));
        const zo = s * d / 2;
        for (const wn of wins) {
          const tf = P => revCol(Math.abs(zo - P[2]) / SHELL), tfs = P => revCol(Math.abs(zo - P[2]) / SHELL, true);
          rect(I, 1, yb, wn.ua, wn.ub, Math.min(zf, zo), Math.max(zf, zo), 1, tfs);
          rect(I, 1, yt, wn.ua, wn.ub, Math.min(zf, zo), Math.max(zf, zo), -1, tf);
          rect(I, 0, wn.ua, Math.min(zf, zo), Math.max(zf, zo), yb, yt, 1, tf);
          rect(I, 0, wn.ub, Math.min(zf, zo), Math.max(zf, zo), yb, yt, -1, tf);
          rect(G, 2, zo + s * 0.012, wn.ua, wn.ub, yb, yt, s);
          cover((f, cf, depth) => rect(I, 2, depth >= 0 ? zo - s * depth : zf - s * 0.03, wn.ua, wn.ub, yt - f * (yt - yb), yt, s, cf));
        }
        if (shop && wins.length) signs.push({ axis: 2, s, fixed: zo + s * 0.06, u0: wins[0].ua - 0.15, u1: wins[wins.length - 1].ub + 0.15, v0: SB + 1.76, v1: SB + 2.56, open: occupied });
      }
      // fixtures (0.42 m, facing down), colour scaled to 0.7
      lamps.forEach((Lp, k) => {
        const on = lit[k];
        const c = on ? [mul(tint, [1, 1, 1], 0.7), mul(tint, [1, 1, 1], 0.6)] : [[0.04, 0.04, 0.045], [0.12, 0.12, 0.12]];
        rect(L, 1, Lp[1], Lp[0] - 0.21, Lp[0] + 0.21, Lp[2] - 0.21, Lp[2] + 0.21, -1, () => c);
        lampCount++;
      });
      // furniture: desks in offices, shelving and counters in shops
      const deskA = shop ? pick2([[0.75, 0.75, 0.78], [0.55, 0.4, 0.28], [0.85, 0.3, 0.25], [0.3, 0.5, 0.8]]) : pick2([[0.45, 0.32, 0.22], [0.35, 0.35, 0.37], [0.6, 0.58, 0.55]]);
      for (const Lp of lamps) {
        if (rnd2() < (shop ? 0.25 : 0.45)) continue;
        const dw = rr2(0.35, 0.45), dd = rr2(0.2, 0.28);
        const dh = shop ? rr2(0.55, 1.05) : (rnd2() < 0.8 ? 0.42 : rr2(0.7, 1.0));
        const cx = Lp[0] + rr2(-0.15, 0.15), cz = Lp[2] + rr2(-0.15, 0.15);
        const xa = Math.max(x0 + 0.05, cx - dw), xb = Math.min(x1 - 0.05, cx + dw);
        const za = Math.max(z0 + 0.05, cz - dd), zb = Math.min(z1 - 0.05, cz + dd);
        const top = base + dh;
        const shade = k => P => { const c = surfCol(3, P); return [mul(c[0], deskA, k / Math.max(0.3, floorA[0])), mul(c[1], deskA, k / Math.max(0.3, floorA[0]))]; };
        rect(I, 1, top, xa, xb, za, zb, 1, shade(1.25));
        rect(I, 0, xb, za, zb, base, top, 1, shade(0.55));
        rect(I, 0, xa, za, zb, base, top, -1, shade(0.55));
        rect(I, 2, zb, xa, xb, base, top, 1, shade(0.55));
        rect(I, 2, za, xa, xb, base, top, -1, shade(0.55));
      }
    }
  }

  // ---- assemble: groups 0 facade, 1 interior, 2 roof ----
  const geo = new THREE.BufferGeometry();
  const nF = F.verts, nI = I.verts, nR = R.verts, n = nF + nI + nR;
  const cat = k => { const a = new Float32Array((k === 'uv' ? 2 : 3) * n); a.set(F[k], 0); a.set(I[k], F[k].length); a.set(R[k], F[k].length + I[k].length); return a; };
  geo.setAttribute('position', new THREE.BufferAttribute(cat('p'), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(cat('n'), 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(cat('uv'), 2));
  const colN = cat('cN'), colD = cat('cD');
  geo.setAttribute('color', new THREE.BufferAttribute(colN.slice(), 3));
  geo.userData = { colN, colD };
  geo.addGroup(0, nF, 0); geo.addGroup(nF, nI, 1); geo.addGroup(nF + nI, nR, 2);
  geo.computeBoundingSphere(); geo.computeBoundingBox();

  const mk = (B, withColor) => {
    if (!B.verts) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(B.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(B.n, 3));
    if (withColor) {
      const cN = new Float32Array(B.cN), cD = new Float32Array(B.cD);
      g.setAttribute('color', new THREE.BufferAttribute(cN.slice(), 3));
      g.userData = { colN: cN, colD: cD };
    }
    g.computeBoundingSphere();
    return g;
  };
  const winGeo = FW.verts ? mk(FW, true) : null;
  if (winGeo) winGeo.setAttribute('uv', new THREE.Float32BufferAttribute(FW.uv, 2));
  return { geo, glassGeo: mk(G, false), fixGeo: mk(L, true), winGeo, roomCount, lampCount, floors: floors.length, signs };
}

// swap baked interior colours between night and day sets
export function applyTimeColors(geo, night) {
  if (!geo || !geo.userData.colN) return;
  const attr = geo.getAttribute('color');
  attr.array.set(night ? geo.userData.colN : geo.userData.colD);
  attr.needsUpdate = true;
}

// Fresnel alpha for glass: share ONE function object per curve -> one program
export function makeGlassFresnel(minA, maxA) {
  return function (shader) {
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <dithering_fragment>',
      `#include <dithering_fragment>
       float fres = pow(1.0 - abs(dot(normalize(vNormal), normalize(vViewPosition))), 4.0);
       gl_FragColor.a = mix(${minA.toFixed(2)}, ${maxA.toFixed(2)}, fres);`
    );
  };
}
