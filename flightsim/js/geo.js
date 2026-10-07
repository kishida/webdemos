// ジオメトリ構築ヘルパーとノイズ
import * as THREE from 'three';

// ---- 決定論的乱数・ノイズ ----
export function hash2(x, y, s = 0) {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263) + Math.imul(s | 0, 982451653)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
export function rng(seed) {
  let s = seed >>> 0 || 1;
  return () => { s = (Math.imul(s ^ (s >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0; s ^= s << 7; s >>>= 0; return (s >>> 0) / 4294967296; };
}
export function noise2(x, y, s = 0) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash2(xi, yi, s), b = hash2(xi + 1, yi, s), c = hash2(xi, yi + 1, s), d = hash2(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
export function fbm(x, y, oct = 5, s = 0) {
  let f = 0, amp = 0.5, n = 0;
  for (let i = 0; i < oct; i++) { f += amp * noise2(x, y, s + i * 17); n += amp; x = x * 2.03 + 11.7; y = y * 2.01 - 3.1; amp *= 0.5; }
  return f / n;
}
export function ridged(x, y, oct = 5, s = 0) {
  let f = 0, amp = 0.5, n = 0;
  for (let i = 0; i < oct; i++) { const r = 1 - Math.abs(noise2(x, y, s + i * 31) * 2 - 1); f += amp * r * r; n += amp; x = x * 2.1 + 5.3; y = y * 2.07 + 1.9; amp *= 0.5; }
  return f / n;
}
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export function smoothstep(e0, e1, x) { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); }

// ---- 頂点配列を積み上げて1つのジオメトリにする ----
export class GeoBuilder {
  constructor() { this.p = []; this.n = []; this.uv = []; this.c = []; this.idx = []; this.vc = 0; }
  // a,b,c,d: 外側から見て反時計回り
  quad(a, b, c, d, uvs = [[0, 0], [1, 0], [1, 1], [0, 1]], col = [1, 1, 1]) {
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
    let nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0];
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    const base = this.vc;
    for (const [v, t] of [[a, uvs[0]], [b, uvs[1]], [c, uvs[2]], [d, uvs[3]]]) {
      this.p.push(v[0], v[1], v[2]); this.n.push(nx, ny, nz); this.uv.push(t[0], t[1]); this.c.push(col[0], col[1], col[2]);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3); this.vc += 4;
  }
  tri(a, b, c, uvs = [[0, 0], [1, 0], [0.5, 1]], col = [1, 1, 1]) {
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    let nx = e1[1] * e2[2] - e1[2] * e2[1], ny = e1[2] * e2[0] - e1[0] * e2[2], nz = e1[0] * e2[1] - e1[1] * e2[0];
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    const base = this.vc;
    for (const [v, t] of [[a, uvs[0]], [b, uvs[1]], [c, uvs[2]]]) {
      this.p.push(v[0], v[1], v[2]); this.n.push(nx, ny, nz); this.uv.push(t[0], t[1]); this.c.push(col[0], col[1], col[2]);
    }
    this.idx.push(base, base + 1, base + 2); this.vc += 3;
  }
  // 壁4面（UV はメートル / tile）。roof: 上面を追加する builder（null なら自分）
  box(x0, y0, z0, x1, y1, z1, { tw = 16, th = 16, col = [1, 1, 1], roof = this, roofCol = col, bottom = false, uoff = 0, sides = true } = {}) {
    const w = x1 - x0, d = z1 - z0, v0 = y0 / th, v1 = y1 / th;
    if (sides) {
      this.quad([x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [[uoff, v0], [uoff + d / tw, v0], [uoff + d / tw, v1], [uoff, v1]], col);
      this.quad([x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0], [[uoff, v0], [uoff + d / tw, v0], [uoff + d / tw, v1], [uoff, v1]], col);
      this.quad([x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1], [[uoff, v0], [uoff + w / tw, v0], [uoff + w / tw, v1], [uoff, v1]], col);
      this.quad([x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0], [[uoff, v0], [uoff + w / tw, v0], [uoff + w / tw, v1], [uoff, v1]], col);
    }
    if (roof) roof.quad([x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0], [[x0 / 20, z1 / 20], [x1 / 20, z1 / 20], [x1 / 20, z0 / 20], [x0 / 20, z0 / 20]], roofCol);
    if (bottom) this.quad([x0, y0, z0], [x1, y0, z0], [x1, y0, z1], [x0, y0, z1], undefined, col);
  }
  // 任意方向の直方体（中心 c, 軸方向 ax 長さ len, 断面 w×h, up ベクトル）
  beam(a, b, w, h, col = [1, 1, 1], up = [0, 1, 0]) {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
    const f = B.clone().sub(A); const len = f.length(); f.normalize();
    let u = new THREE.Vector3(...up); if (Math.abs(u.dot(f)) > 0.95) u = new THREE.Vector3(1, 0, 0);
    const r = new THREE.Vector3().crossVectors(f, u).normalize(); u = new THREE.Vector3().crossVectors(r, f).normalize();
    const P = (base, sr, su) => base.clone().addScaledVector(r, sr * w / 2).addScaledVector(u, su * h / 2).toArray();
    const a1 = P(A, -1, -1), a2 = P(A, 1, -1), a3 = P(A, 1, 1), a4 = P(A, -1, 1);
    const b1 = P(B, -1, -1), b2 = P(B, 1, -1), b3 = P(B, 1, 1), b4 = P(B, -1, 1);
    const uv = [[0, 0], [1, 0], [1, len / 10], [0, len / 10]];
    this.quad(a1, a2, b2, b1, uv, col); this.quad(a2, a3, b3, b2, uv, col);
    this.quad(a3, a4, b4, b3, uv, col); this.quad(a4, a1, b1, b4, uv, col);
  }
  build() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    // 頂点カラーは sRGB で指定しているのでリニアに変換
    const lin = this.c.map((c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
    g.setAttribute('color', new THREE.Float32BufferAttribute(lin, 3));
    g.setIndex(this.vc > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.computeBoundingSphere();
    return g;
  }
}

// 既存ジオメトリを変換して builder に追加
export function addGeometry(gb, geo, matrix, col = [1, 1, 1]) {
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  g.applyMatrix4(matrix);
  const p = g.attributes.position, n = g.attributes.normal, uv = g.attributes.uv;
  for (let i = 0; i < p.count; i++) {
    gb.p.push(p.getX(i), p.getY(i), p.getZ(i)); gb.n.push(n.getX(i), n.getY(i), n.getZ(i));
    gb.uv.push(uv ? uv.getX(i) : 0, uv ? uv.getY(i) : 0); gb.c.push(col[0], col[1], col[2]);
    gb.idx.push(gb.vc + i);
  }
  gb.vc += p.count;
}
