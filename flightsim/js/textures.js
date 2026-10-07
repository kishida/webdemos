// テクスチャ管理: textures/*.png（画像生成AIで作成）を読み込み、無ければ Canvas で代替を作る
import * as THREE from 'three';

const loader = new THREE.TextureLoader();
let maxAniso = 8;
export function setAnisotropy(a) { maxAniso = a; }

// ---- 簡易ノイズ（Canvas 代替テクスチャ用） ----
function hash(x, y, s = 0) {
  let h = (x * 374761393 + y * 668265263 + s * 982451653) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function vnoise(x, y, period, s) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const m = (a) => ((a % period) + period) % period;
  const a = hash(m(xi), m(yi), s), b = hash(m(xi + 1), m(yi), s);
  const c = hash(m(xi), m(yi + 1), s), d = hash(m(xi + 1), m(yi + 1), s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
// タイル可能な fBm
function fbmTile(x, y, size, oct, s) {
  let f = 0, amp = 0.5, freq = 4;
  for (let i = 0; i < oct; i++) { f += amp * vnoise((x / size) * freq, (y / size) * freq, freq, s + i); amp *= 0.5; freq *= 2; }
  return f;
}

function canvasTex(size, draw) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'); draw(g, size);
  return c;
}
function noiseCanvas(size, base, varAmt, seed, oct = 5) {
  return canvasTex(size, (g, n) => {
    const img = g.createImageData(n, n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const f = fbmTile(x, y, n, oct, seed) - 0.5;
      const i = (y * n + x) * 4;
      img.data[i] = base[0] + f * varAmt[0]; img.data[i + 1] = base[1] + f * varAmt[1]; img.data[i + 2] = base[2] + f * varAmt[2]; img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  });
}

const FALLBACK = {
  grass: () => noiseCanvas(256, [88, 120, 58], [60, 70, 40], 1),
  farmland: () => canvasTex(256, (g, n) => {
    const cols = ['#7d8f45', '#a39a5c', '#5f7d3a', '#8a7a4a', '#9fb062', '#6e6a3c'];
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { g.fillStyle = cols[(x * 3 + y * 5) % cols.length]; g.fillRect(x * n / 4, y * n / 4, n / 4, n / 4); }
    g.strokeStyle = 'rgba(0,0,0,0.2)'; g.lineWidth = 2;
    for (let i = 0; i < 80; i++) { const y = (i / 80) * n; g.beginPath(); g.moveTo(0, y); g.lineTo(n, y); g.stroke(); }
  }),
  forest: () => noiseCanvas(256, [45, 75, 35], [40, 60, 30], 3, 6),
  rock: () => noiseCanvas(256, [120, 112, 100], [90, 85, 80], 4, 6),
  urban: () => noiseCanvas(256, [140, 138, 132], [40, 40, 40], 5),
  sand: () => noiseCanvas(256, [200, 185, 150], [40, 40, 40], 6),
  asphalt: () => noiseCanvas(256, [70, 70, 72], [50, 50, 50], 7, 6),
  concrete: () => noiseCanvas(256, [165, 162, 155], [40, 40, 40], 8),
  roof_tiles: () => canvasTex(256, (g, n) => {
    g.fillStyle = '#aaa'; g.fillRect(0, 0, n, n);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const l = 140 + hash(x, y, 9) * 70; g.fillStyle = `rgb(${l},${l},${l})`;
      g.fillRect(x * 16 + (y % 2) * 8, y * 16, 15, 14);
    }
  }),
  facade_office: () => canvasTex(256, (g, n) => {
    g.fillStyle = '#4a5866'; g.fillRect(0, 0, n, n);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) {
      const l = 60 + hash(x, y, 10) * 80; g.fillStyle = `rgb(${l * 0.7},${l * 0.85},${l})`;
      g.fillRect(x * 32 + 2, y * 32 + 3, 28, 24);
    }
  }),
  facade_apartment: () => canvasTex(256, (g, n) => {
    g.fillStyle = '#c8c2b5'; g.fillRect(0, 0, n, n);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 4; x++) {
      g.fillStyle = '#3b4652'; g.fillRect(x * 64 + 10, y * 32 + 6, 44, 18);
      g.fillStyle = '#9a958a'; g.fillRect(x * 64 + 4, y * 32 + 26, 56, 4);
    }
  }),
  facade_concrete: () => canvasTex(256, (g, n) => {
    g.fillStyle = '#b0aca2'; g.fillRect(0, 0, n, n);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 6; x++) { g.fillStyle = '#2e3a44'; g.fillRect(x * 42 + 8, y * 32 + 8, 26, 16); }
  }),
  water: () => noiseCanvas(256, [40, 80, 95], [30, 40, 40], 11, 6),
};

const cache = {};
// name: textures/<name>.png  repeat: MirroredRepeat で継ぎ目を目立たなくする
export function tex(name, { mirror = true, srgb = true } = {}) {
  if (cache[name]) return cache[name];
  const t = new THREE.Texture();
  const wrap = mirror ? THREE.MirroredRepeatWrapping : THREE.RepeatWrapping;
  const setup = (tt) => {
    tt.wrapS = tt.wrapT = wrap; tt.anisotropy = maxAniso;
    tt.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    tt.generateMipmaps = true; tt.minFilter = THREE.LinearMipmapLinearFilter;
  };
  setup(t);
  if (FALLBACK[name]) { t.image = FALLBACK[name](); t.needsUpdate = true; }
  loader.load(`textures/${name}.png`, (img) => { t.image = img.image; t.needsUpdate = true; }, undefined, () => {});
  cache[name] = t;
  return t;
}

// ---- 手続き的テクスチャ（形状に依存するもの） ----

// 夜間の窓明かり（emissive）。1UV = 横4窓 × 縦4フロア
export function windowLightsTexture(nx = 8, ny = 8, seed = 1, warm = true) {
  const n = 512;
  const c = canvasTex(n, (g) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, n, n);
    const cw = n / nx, rh = n / ny;
    for (let y = 0; y < ny; y++) for (let x = 0; x < nx; x++) {
      const r = hash(x, y, seed);
      if (r < 0.42) continue;
      const k = hash(x, y, seed + 7);
      const col = warm ? (k < 0.6 ? [255, 210, 140] : [200, 225, 255]) : [210, 230, 255];
      const b = 0.45 + hash(x, y, seed + 3) * 0.55;
      g.fillStyle = `rgb(${col[0] * b | 0},${col[1] * b | 0},${col[2] * b | 0})`;
      g.fillRect(x * cw + cw * 0.12, y * rh + rh * 0.2, cw * 0.76, rh * 0.5);
    }
  });
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = maxAniso;
  return t;
}

// 光点（ライト用スプライト）
export function glowTexture() {
  const c = canvasTex(64, (g, n) => {
    const gr = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.2, 'rgba(255,255,255,0.85)');
    gr.addColorStop(0.5, 'rgba(255,255,255,0.18)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, n, n);
  });
  return new THREE.CanvasTexture(c);
}

// 雲のパフ
export function cloudTexture(seed = 1) {
  const n = 256;
  const c = canvasTex(n, (g) => {
    const img = g.createImageData(n, n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const dx = (x - n / 2) / (n / 2), dy = (y - n / 2) / (n / 2);
      const r = Math.sqrt(dx * dx + dy * dy * 1.6);
      const f = fbmTile(x, y, n, 5, seed);
      let a = Math.max(0, 1 - r) * 1.6 * (0.45 + f) - 0.25;
      a = Math.max(0, Math.min(1, a));
      const shade = 225 + 30 * (1 - Math.max(0, dy)) * f;
      const i = (y * n + x) * 4;
      img.data[i] = shade; img.data[i + 1] = shade; img.data[i + 2] = Math.min(255, shade + 8); img.data[i + 3] = a * 255;
    }
    g.putImageData(img, 0, 0);
  });
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// 水面の法線マップ
export function waterNormalTexture() {
  const n = 256;
  const h = new Float32Array(n * n);
  for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) h[y * n + x] = fbmTile(x, y, n, 5, 21);
  const c = canvasTex(n, (g) => {
    const img = g.createImageData(n, n);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const dx = h[y * n + ((x + 1) % n)] - h[y * n + ((x - 1 + n) % n)];
      const dy = h[((y + 1) % n) * n + x] - h[((y - 1 + n) % n) * n + x];
      const nx = -dx * 6, ny = -dy * 6, nz = 1; const l = Math.hypot(nx, ny, nz);
      const i = (y * n + x) * 4;
      img.data[i] = (nx / l * 0.5 + 0.5) * 255; img.data[i + 1] = (ny / l * 0.5 + 0.5) * 255; img.data[i + 2] = (nz / l * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
    }
    g.putImageData(img, 0, 0);
  });
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; return t;
}

// 道路（車線マーキング付き）。V方向が道路の進行方向
export function roadTexture(lanes = 2, highway = false) {
  const w = 128, hgt = 256;
  const c = document.createElement('canvas'); c.width = w; c.height = hgt;
  const g = c.getContext('2d');
  const base = tex('asphalt');
  const draw = () => {
    g.fillStyle = '#4a4a4c'; g.fillRect(0, 0, w, hgt);
    if (base.image && base.image.width) { g.globalAlpha = 0.9; g.drawImage(base.image, 0, 0, w, hgt); g.globalAlpha = 1; }
    g.fillStyle = 'rgba(30,30,32,0.35)'; g.fillRect(0, 0, w, hgt);
    g.fillStyle = '#e8e8e0'; g.fillRect(3, 0, 3, hgt); g.fillRect(w - 6, 0, 3, hgt);
    if (highway) {
      g.fillStyle = '#d8b030'; g.fillRect(w / 2 - 3, 0, 2, hgt); g.fillRect(w / 2 + 1, 0, 2, hgt);
      g.fillStyle = '#e8e8e0';
      for (const xx of [w / 4, (3 * w) / 4]) for (let y = 0; y < hgt; y += 64) g.fillRect(xx - 1.5, y, 3, 32);
    } else {
      g.fillStyle = '#e8e8e0'; for (let y = 0; y < hgt; y += 64) g.fillRect(w / 2 - 1.5, y, 3, 32);
    }
  };
  draw();
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = maxAniso;
  // 生成アスファルト画像が後から読み込まれたら描き直す
  const iv = setInterval(() => { if (base.image && base.image.width && !(base.image instanceof HTMLCanvasElement)) { draw(); t.needsUpdate = true; clearInterval(iv); } }, 500);
  setTimeout(() => clearInterval(iv), 20000);
  return t;
}

// 文字テクスチャ（滑走路番号など）
export function textTexture(text, { w = 256, h = 256, font = 'bold 200px sans-serif', color = '#f0f0ea', bg = null } = {}) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  if (bg) { g.fillStyle = bg; g.fillRect(0, 0, w, h); }
  g.fillStyle = color; g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, w / 2, h / 2);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = maxAniso;
  return t;
}

// 旅客機の客室窓
export function airlinerLiveryTexture() {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#f4f5f7'; g.fillRect(0, 0, 1024, 256);
  g.fillStyle = '#1d4f9c'; g.fillRect(0, 150, 1024, 22);
  g.fillStyle = '#e0a020'; g.fillRect(0, 172, 1024, 6);
  g.fillStyle = '#c9ccd2'; g.fillRect(0, 200, 1024, 56);
  g.fillStyle = '#20262e';
  for (let x = 70; x < 960; x += 18) { if (x > 300 && x < 330) continue; g.beginPath(); g.ellipse(x, 112, 4, 6, 0, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = '#1d4f9c'; g.font = 'bold 34px sans-serif'; g.fillText('SKY LINES', 420, 80);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = maxAniso;
  return t;
}
