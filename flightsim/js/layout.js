// ワールドのレイアウト（純粋関数）: 地形高さ、川、海岸線、街区の種類、高速道路
// 座標: X=東, Z=南（北は -Z）, Y=上。単位はメートル。空港滑走路は原点を中心に南北方向。
import { fbm, ridged, smoothstep, lerp, hash2, clamp } from './geo.js';

export const WORLD_HALF = 20000;
export const WATER_Y = -1.0;
export const RIVER_W = 190;
export const RWY = { x: 0, zN: -1500, zS: 1500, width: 45, length: 3000, elev: 0 };
export const DOWNTOWN = { x: 3600, z: -1200 };
export const SUBCENTER = { x: -3400, z: 200 };
export const SKYTREE = { x: 5000, z: -2600 };
export const LATTICE_TOWER = { x: -2900, z: -2700 };
export const GRID = 160;

export function riverX(z) { return 1500 + 380 * Math.sin(z / 2100) + 160 * Math.sin(z / 750 + 1.3); }
export function coastZ(x) { return 8500 + 1200 * Math.sin(x / 2600) + 500 * Math.sin(x / 900 + 2); }

// 都市域（楕円）。値 <1 で市街地
function cityE(x, z) {
  const jitter = (fbm(x / 1800, z / 1800, 3, 7) - 0.5) * 0.35;
  const east = ((x - 3200) / 5600) ** 2 + ((z + 600) / 5600) ** 2;
  const west = ((x + 3700) / 3600) ** 2 + ((z - 200) / 4400) ** 2;
  return Math.min(east, west) + jitter;
}
function airportMask(x, z) {
  const dx = Math.max(0, Math.abs(x - 150) - 750), dz = Math.max(0, Math.abs(z) - 2700);
  return 1 - smoothstep(0, 600, Math.hypot(dx, dz));
}

export function terrainHeight(x, z) {
  const dc = Math.hypot(x - 1500, (z + 500) * 0.85);
  const coast = coastZ(x);
  const rd = Math.abs(x - riverX(z));
  let h = 0;
  // 郊外のなだらかな起伏
  const rural = smoothstep(3000, 8000, dc);
  h += rural * fbm(x / 1400, z / 1400, 4, 3) * 45;
  // 山地（北・西・東）。川沿いの谷と海岸平野を除く
  const mount = smoothstep(7500, 16000, dc) * smoothstep(250, 2600, rd) * smoothstep(coast - 400, coast - 3200, z);
  if (mount > 0) {
    const r = ridged(x / 5200, z / 5200, 5, 11);
    h += mount * (r * 1500 + fbm(x / 900, z / 900, 4, 5) * 220 - 80);
  }
  // 市街地・空港は平坦
  const flat = Math.max(airportMask(x, z), 1 - smoothstep(1.1, 1.6, cityE(x, z)));
  h = lerp(h, 0, flat);
  // 海
  const sea = smoothstep(coast - 150, coast + 500, z);
  h = lerp(h, -28, sea);
  // 川
  const bank = smoothstep(RIVER_W / 2 - 10, RIVER_W / 2 + 70, rd);
  h = lerp(Math.min(h, -6), h, bank);
  return h;
}

// 地形の法線用の勾配
export function terrainSlope(x, z) {
  const e = 20;
  const dx = terrainHeight(x + e, z) - terrainHeight(x - e, z), dz = terrainHeight(x, z + e) - terrainHeight(x, z - e);
  return Math.hypot(dx, dz) / (2 * e);
}

// ---- 高速道路（ポリライン） ----
function ringPts() {
  const pts = []; const cx = 3700, cz = -1000;
  for (let i = 0; i <= 28; i++) { const a = (i / 28) * Math.PI * 2 + Math.PI * 0.75; pts.push([cx + 1350 * Math.cos(a), cz + 2050 * Math.sin(a)]); }
  return pts;
}
export const HIGHWAYS = [
  // 西の海岸 → 空港南側 → 川を渡る（斜張橋）→ 環状線
  { name: 'west', pts: [[-19500, 7300], [-15000, 7000], [-11000, 5200], [-8000, 3200], [-5000, 2750], [-2000, 2780], [0, 2800], [1000, 2760], [1700, 2700], [2400, 2550], [2850, 1900], [2800, 900], [2700, 300]] },
  { name: 'ring', pts: ringPts(), loop: true },
  // 環状線 → 東 → 海岸沿い
  { name: 'east', pts: [[5050, -1000], [6500, -950], [8200, -500], [9600, 600], [10600, 3200], [12000, 6200], [15000, 7300], [19500, 7600]] },
];

function distSeg(px, pz, ax, az, bx, bz) {
  const vx = bx - ax, vz = bz - az; const t = clamp(((px - ax) * vx + (pz - az) * vz) / (vx * vx + vz * vz), 0, 1);
  return Math.hypot(px - ax - vx * t, pz - az - vz * t);
}
export function distToHighway(x, z) {
  let d = 1e9;
  for (const h of HIGHWAYS) for (let i = 0; i < h.pts.length - 1; i++) d = Math.min(d, distSeg(x, z, ...h.pts[i], ...h.pts[i + 1]));
  return d;
}

// ---- 街区 ----
const cellCache = new Map();
export function cellType(i, j) {
  const key = i * 100000 + j;
  if (cellCache.has(key)) return cellCache.get(key);
  const t = computeCell(i, j); cellCache.set(key, t); return t;
}
export function cellAt(x, z) { return cellType(Math.floor(x / GRID), Math.floor(z / GRID)); }

function computeCell(i, j) {
  const x0 = i * GRID, z0 = j * GRID, cx = x0 + GRID / 2, cz = z0 + GRID / 2;
  if (Math.abs(cx - 150) < 900 && Math.abs(cz) < 2650) return null;       // 空港
  if (cityE(cx, cz) > 1) return null;
  const coast = coastZ(cx);
  if (cz > coast - 260) return null;
  let rmin = 1e9;
  for (const [x, z] of [[x0, z0], [x0 + GRID, z0], [x0, z0 + GRID], [x0 + GRID, z0 + GRID], [cx, cz]]) rmin = Math.min(rmin, Math.abs(x - riverX(z)));
  if (rmin < RIVER_W / 2 + 70) return null;
  for (const [x, z] of [[x0, z0], [x0 + GRID, z0 + GRID], [cx, cz]]) if (Math.abs(terrainHeight(x, z)) > 0.5) return null;
  for (const T of [SKYTREE, LATTICE_TOWER]) if (Math.abs(cx - T.x) < GRID * 0.9 && Math.abs(cz - T.z) < GRID * 0.9) return 'plaza';
  if (distToHighway(cx, cz) < GRID * 0.55) return 'road';
  const r = hash2(i, j, 99);
  const east = cx > riverX(cz);
  if (cz > coast - 700 && east) return r < 0.15 ? 'park' : 'port';
  if (east) {
    const d = Math.hypot(cx - DOWNTOWN.x, cz - DOWNTOWN.z);
    if (d < 1000) return r < 0.06 ? 'park' : 'downtown';
    if (d < 2200) return r < 0.12 ? 'park' : 'midrise';
    if (Math.abs(cz) < 2700 && cx < 4200 && cx < riverX(cz) + 700 && cz > 0) return 'industrial';
    return r < 0.07 ? 'park' : r < 0.17 ? 'midrise' : 'residential';
  }
  if (cx > 750) return r < 0.2 ? 'park' : 'industrial';
  if (Math.hypot(cx - SUBCENTER.x, cz - SUBCENTER.z) < 650) return r < 0.1 ? 'park' : 'midrise';
  return r < 0.08 ? 'park' : 'residential';
}

// 建物の高さ制限（進入経路の下は低く）
export function heightLimit(x, z) {
  if (Math.abs(x) < 900 && Math.abs(z) > 2000) return 25;
  return 1e9;
}
