'use strict';
// 魔王の迷宮と囚われの姫 — 1 フロアだけの短いダンジョン RPG

const W = 960, H = 540;          // 画面
const VW = 640, VH = 360;        // 3D ビューの内部解像度
const FOV_K = 0.66;              // tan(視野角/2)
const FONT = "'Yu Mincho','Hiragino Mincho ProN','MS PMincho',serif";
const UIFONT = "'Yu Gothic UI','Hiragino Sans','Meiryo',sans-serif";

const cv = document.getElementById('screen');
const ctx = cv.getContext('2d');
const view = document.createElement('canvas');
view.width = VW; view.height = VH;
const vctx = view.getContext('2d');
const vimg = vctx.createImageData(VW, VH);
const vbuf = new Uint32Array(vimg.data.buffer);
const zbuf = new Float32Array(VW);

// ---------------------------------------------------------------- マップ
const MAP_SRC = [
  '################',
  '#S..#.....#....#',
  '#.#.#.###.#.##.#',
  '#.#...#...#..#.#',
  '#.#####.####.#.#',
  '#...#...#....#.#',
  '###.#.###.####.#',
  '#...#..........#',
  '#.#####.######.#',
  '#.......#......#',
  '######D#########',
  '#####...########',
  '#####...########',
  '#####...########',
  '################',
];
const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]]; // 東 南 西 北

const ENEMIES = {
  slime:    { name: 'スライム',       hp: 12, atk: 5,  def: 0, img: 'monster_slime',    scale: 0.65 },
  bat:      { name: '吸血コウモリ',   hp: 14, atk: 7,  def: 0, img: 'monster_bat',      scale: 0.55, lift: 0.3, evade: 0.25 },
  goblin:   { name: 'ゴブリン',       hp: 24, atk: 9,  def: 1, img: 'monster_goblin',   scale: 0.8 },
  skeleton: { name: '骸骨騎士',       hp: 34, atk: 11, def: 3, img: 'monster_skeleton', scale: 0.9 },
  boss:     { name: '魔王ザルガス',   hp: 80, atk: 15, def: 4, img: 'monster_boss',     scale: 1.0, boss: true },
};
const ITEMS = {
  potion: { name: '回復薬',   desc: 'HP を 35 回復できる', img: 'item_potion' },
  sword:  { name: '鋼の長剣', desc: '攻撃力 +6',           img: 'item_sword' },
  shield: { name: '騎士の盾', desc: '防御力 +3',           img: 'item_shield' },
  key:    { name: '金の鍵',   desc: '封印の扉を開けられる', img: 'item_key' },
};
const PLACEMENTS = [
  ['enemy', 'slime', 1, 4], ['enemy', 'bat', 7, 1], ['enemy', 'goblin', 9, 3],
  ['enemy', 'slime', 12, 7], ['enemy', 'skeleton', 13, 9], ['enemy', 'boss', 6, 12],
  ['item', 'sword', 3, 3], ['item', 'potion', 1, 9], ['item', 'potion', 12, 3],
  ['item', 'potion', 5, 7], ['item', 'shield', 14, 1], ['item', 'key', 9, 9],
  ['princess', 'princess', 6, 13],
];

// ---------------------------------------------------------------- 画像
const IMG = {};   // name -> HTMLImageElement / canvas（UI 描画用）
const PIX = {};   // name -> {w,h,data}（3D 描画用）

function loadImage(src) {
  return new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = src; });
}
function toPixels(img, w = img.width, h = img.height) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); g.drawImage(img, 0, 0, w, h);
  return { w, h, data: new Uint32Array(g.getImageData(0, 0, w, h).data.buffer) };
}
function fallbackTexture(kind) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  const base = { wall: '#55504a', floor: '#3a342c', ceiling: '#221e1a', door: '#5a3a1e' }[kind];
  g.fillStyle = base; g.fillRect(0, 0, 256, 256);
  g.strokeStyle = 'rgba(0,0,0,.6)'; g.lineWidth = 4;
  for (let y = 0; y < 256; y += 64) for (let x = (y / 64 % 2) * 32; x < 256 + 64; x += 64) g.strokeRect(x - 32, y, 64, 64);
  if (kind === 'door') { g.fillStyle = '#c9a43a'; g.fillRect(118, 120, 20, 30); }
  return c;
}
function fallbackSprite(label, color) {
  const c = document.createElement('canvas'); c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = color; g.beginPath(); g.ellipse(128, 150, 100, 100, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#fff'; g.font = `bold 40px ${UIFONT}`; g.textAlign = 'center'; g.fillText(label, 128, 165);
  return c;
}

async function loadAssets() {
  const A = window.ASSETS || {};
  await Promise.all(Object.entries(A).map(async ([k, src]) => { const i = await loadImage(src); if (i) IMG[k] = i; }));
  for (const t of ['wall', 'floor', 'ceiling', 'door']) {
    const k = 'tex_' + t;
    PIX[k] = toPixels(IMG[k] || fallbackTexture(t), 256, 256);
  }
  const sprites = {
    monster_slime: ['スライム', '#3a8a3a'], monster_bat: ['コウモリ', '#553355'], monster_goblin: ['ゴブリン', '#557722'],
    monster_skeleton: ['骸骨', '#999988'], monster_boss: ['魔王', '#882222'], monster_princess: ['姫', '#ddaacc'],
    item_chest_closed: ['宝箱', '#7a5a2a'], item_potion: ['薬', '#bb2233'], item_sword: ['剣', '#8899aa'], item_shield: ['盾', '#335599'], item_key: ['鍵', '#ccaa33'],
  };
  for (const [k, [label, color]] of Object.entries(sprites)) {
    if (!IMG[k]) IMG[k] = fallbackSprite(label, color);
    PIX[k] = toPixels(IMG[k]);
  }
}

// ---------------------------------------------------------------- 音（audio.js の FM 音源）
const SFX = Sound.sfx;
// 画面の状態に合わせて BGM を選ぶ（同じ曲なら鳴らし直さない）
function updateMusic() {
  if (!Sound.ready) return;
  let name = null;
  if (mode === 'title') name = 'title';
  else if (mode === 'explore') name = 'dungeon';
  else if (mode === 'battle' && S.battle) name = S.battle.lost ? 'gameover' : S.battle.won ? 'fanfare' : S.battle.def.boss ? 'boss' : 'battle';
  else if (mode === 'rescue' || mode === 'ending') name = 'ending';
  else if (mode === 'gameover') name = 'gameover';
  if (name) Sound.bgm(name);
}

// ---------------------------------------------------------------- 状態
let S;            // ゲーム状態
let mode = 'loading';
const toasts = [];

function newGame() {
  const grid = MAP_SRC.map(r => r.split(''));
  let start = null;
  grid.forEach((r, y) => r.forEach((c, x) => { if (c === 'S') { start = [x, y]; r[x] = '.'; } }));
  const entities = PLACEMENTS.map(([kind, type, x, y]) => {
    const def = kind === 'enemy' ? ENEMIES[type] : kind === 'item' ? ITEMS[type] : { img: 'monster_princess', scale: 0.8 };
    return {
      kind, type, x, y, alive: true,
      img: kind === 'item' ? 'item_chest_closed' : def.img,
      scale: kind === 'item' ? 0.42 : def.scale,
      opened: false,
      lift: def.lift || 0,
    };
  });
  S = {
    grid, entities,
    p: { x: start[0], y: start[1], dir: 0, hp: 50, maxHp: 50, atk: 6, def: 1, potions: 0, key: false, sword: false, shield: false },
    prev: null,
    cam: { x: start[0], y: start[1], a: 0 },
    anim: null,
    seen: new Set(),
    kills: 0,
    t0: performance.now(),
    battle: null,
  };
  markSeen();
}

const cellAt = (x, y) => (S.grid[y] && S.grid[y][x]) || '#';
const entityAt = (x, y) => S.entities.find(e => e.alive && e.x === x && e.y === y);
function markSeen() {
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) S.seen.add((S.p.x + dx) + ',' + (S.p.y + dy));
}
function toast(text, icon = null, ms = 2600) { toasts.push({ text, icon, until: performance.now() + ms }); if (toasts.length > 3) toasts.shift(); }

// ---------------------------------------------------------------- 移動
function startAnim(to, dur, done) {
  S.anim = { from: { ...S.cam }, to, t0: performance.now(), dur, done };
}
function turn(d) {
  if (S.anim) return;
  S.p.dir = (S.p.dir + d + 4) % 4;
  startAnim({ x: S.p.x, y: S.p.y, a: S.cam.a + d * Math.PI / 2 }, 170);
}
function move(rel) { // rel: 0 前 1 右 2 後 3 左
  if (S.anim) return;
  const d = (S.p.dir + rel) % 4;
  const nx = S.p.x + DIRS[d][0], ny = S.p.y + DIRS[d][1];
  const e = entityAt(nx, ny);
  if (e && e.kind === 'enemy') {
    if (rel !== 0) { S.p.dir = d; startAnim({ x: S.p.x, y: S.p.y, a: S.cam.a + (rel === 2 ? Math.PI : rel === 1 ? Math.PI / 2 : -Math.PI / 2) }, 170, () => startBattle(e)); }
    else startBattle(e);
    return;
  }
  if (e && e.kind === 'princess') {
    const boss = S.entities.find(o => o.type === 'boss' && o.alive);
    if (boss) { toast('魔王「姫に近づくことは許さぬ！」', null, 2500); startBattle(boss); }
    else rescuePrincess();
    return;
  }
  const c = cellAt(nx, ny);
  if (c === '#') { SFX.bump(); return; }
  if (c === 'D') {
    if (S.p.key) { S.grid[ny][nx] = '.'; SFX.door(); toast('金の鍵で封印の扉を開けた。奥から禍々しい気配がする…', 'item_key', 3500); }
    else { SFX.bump(); toast('重い扉には鍵がかかっている。どこかに鍵があるはずだ。', null, 3000); }
    return;
  }
  S.prev = [S.p.x, S.p.y];
  S.p.x = nx; S.p.y = ny;
  SFX.step();
  startAnim({ x: nx, y: ny, a: S.cam.a }, 200, arrive);
}
function arrive() {
  markSeen();
  const e = entityAt(S.p.x, S.p.y);
  if (e && e.kind === 'item' && !e.opened) openChest(e);
  if (S.p.x === 6 && S.p.y === 11 && !S.bossSeen) { S.bossSeen = true; toast('玉座の間だ。魔王が姫の前に立ちはだかっている！', null, 3500); }
}

// 宝箱を開けて中身を受け取る（宝箱は消える）。表示を閉じるまで探索は止まる
function openChest(e) {
  e.opened = true; e.alive = false;
  if (e.type === 'potion') S.p.potions++;
  if (e.type === 'sword') { S.p.sword = true; S.p.atk += 6; }
  if (e.type === 'shield') { S.p.shield = true; S.p.def += 3; }
  if (e.type === 'key') S.p.key = true;
  SFX.chest();
  S.chest = { item: ITEMS[e.type], t0: performance.now() };
  mode = 'chest';
}
function drawChest(now) {
  const c = S.chest, t = (now - c.t0) / 1000;
  drawView(now, 0.45); drawHUD(now);
  const w = 460, h = 250, x = (W - w) / 2, y = (H - h) / 2 - 30;
  panel(x, y, w, h, 0.9);
  text('宝箱を開けた！', W / 2, y + 44, 22, '#f0d79a', 'center', FONT, 'bold');
  const pop = Math.min(1, t / 0.35), s = 110 * (0.4 + 0.6 * easeOutBack(pop));
  const glow = ctx.createRadialGradient(W / 2, y + 115, 5, W / 2, y + 115, 80);
  glow.addColorStop(0, `rgba(255,210,120,${0.45 * pop})`); glow.addColorStop(1, 'rgba(255,210,120,0)');
  ctx.fillStyle = glow; ctx.fillRect(W / 2 - 80, y + 35, 160, 160);
  icon(c.item.img, W / 2 - s / 2, y + 115 - s / 2, s);
  text(`${c.item.name}を手に入れた！`, W / 2, y + 200, 22, '#fff4dc', 'center', FONT, 'bold');
  text(c.item.desc, W / 2, y + 228, 15, '#cdbf9f', 'center');
  if (t > 0.5) { ctx.globalAlpha = 0.5 + 0.5 * Math.sin(now / 250); text('▼', x + w - 26, y + h - 14, 14, '#f0c060', 'center'); ctx.globalAlpha = 1; }
}

function updateAnim(now) {
  const a = S.anim; if (!a) return;
  let t = Math.min(1, (now - a.t0) / a.dur);
  const k = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
  S.cam.x = a.from.x + (a.to.x - a.from.x) * k;
  S.cam.y = a.from.y + (a.to.y - a.from.y) * k;
  S.cam.a = a.from.a + (a.to.a - a.from.a) * k;
  if (t >= 1) { S.anim = null; a.done && a.done(); }
}

// ---------------------------------------------------------------- 3D 描画
function render3D(now) {
  const T = PIX;
  const wall = T.tex_wall.data, door = T.tex_door.data, floor = T.tex_floor.data, ceil = T.tex_ceiling.data;
  const px = S.cam.x + 0.5, py = S.cam.y + 0.5;
  const dx = Math.cos(S.cam.a), dy = Math.sin(S.cam.a);
  const plx = -dy * FOV_K, ply = dx * FOV_K;
  const flick = 0.93 + 0.05 * Math.sin(now / 90) + 0.03 * Math.sin(now / 37);
  const light = d => Math.min(1, 1.7 / (1 + d * d * 0.32)) * flick;
  const half = VH / 2;

  // 床・天井
  const rdx0 = dx - plx, rdy0 = dy - ply, rdx1 = dx + plx, rdy1 = dy + ply;
  for (let y = half; y < VH; y++) {
    const rowDist = half / (y - half + 0.5);
    const sx = rowDist * (rdx1 - rdx0) / VW, sy = rowDist * (rdy1 - rdy0) / VW;
    let fx = px + rowDist * rdx0, fy = py + rowDist * rdy0;
    const L = light(rowDist), Lr = L, Lg = L * 0.86, Lb = L * 0.7;
    const fo = y * VW, co = (VH - 1 - y) * VW;
    for (let x = 0; x < VW; x++, fx += sx, fy += sy) {
      const ti = ((fy * 256) & 255) * 256 + ((fx * 256) & 255);
      let c = floor[ti];
      vbuf[fo + x] = 0xff000000 | (((c >> 16 & 255) * Lb) << 16) | (((c >> 8 & 255) * Lg) << 8) | ((c & 255) * Lr);
      c = ceil[ti];
      vbuf[co + x] = 0xff000000 | (((c >> 16 & 255) * Lb * 0.8) << 16) | (((c >> 8 & 255) * Lg * 0.8) << 8) | ((c & 255) * Lr * 0.8);
    }
  }

  // 壁
  for (let x = 0; x < VW; x++) {
    const cx = 2 * x / VW - 1;
    const rx = dx + plx * cx, ry = dy + ply * cx;
    let mx = Math.floor(px), my = Math.floor(py);
    const ddx = Math.abs(1 / rx), ddy = Math.abs(1 / ry);
    const stx = rx < 0 ? -1 : 1, sty = ry < 0 ? -1 : 1;
    let sdx = (rx < 0 ? px - mx : mx + 1 - px) * ddx;
    let sdy = (ry < 0 ? py - my : my + 1 - py) * ddy;
    let side = 0, c = '.';
    for (let i = 0; i < 64; i++) {
      if (sdx < sdy) { sdx += ddx; mx += stx; side = 0; } else { sdy += ddy; my += sty; side = 1; }
      c = cellAt(mx, my);
      if (c === '#' || c === 'D') break;
    }
    const dist = side === 0 ? sdx - ddx : sdy - ddy;
    zbuf[x] = dist;
    const lineH = VH / dist;
    let wx = side === 0 ? py + dist * ry : px + dist * rx;
    wx -= Math.floor(wx);
    let tx = (wx * 256) | 0;
    if ((side === 0 && rx < 0) || (side === 1 && ry > 0)) tx = 255 - tx;
    const tex = c === 'D' ? door : wall;
    const L = light(dist) * (side ? 0.82 : 1), Lr = L, Lg = L * 0.86, Lb = L * 0.7;
    const y0 = Math.max(0, Math.floor(half - lineH / 2)), y1 = Math.min(VH, Math.ceil(half + lineH / 2));
    const step = 256 / lineH;
    let tpos = (y0 - half + lineH / 2) * step;
    for (let y = y0; y < y1; y++, tpos += step) {
      const cc = tex[((tpos | 0) & 255) * 256 + tx];
      vbuf[y * VW + x] = 0xff000000 | (((cc >> 16 & 255) * Lb) << 16) | (((cc >> 8 & 255) * Lg) << 8) | ((cc & 255) * Lr);
    }
  }

  // スプライト
  const invDet = 1 / (plx * dy - dx * ply);
  const list = S.entities.filter(e => e.alive && !(S.battle && S.battle.entity === e)).map(e => {
    const sx = e.x + 0.5 - px, sy = e.y + 0.5 - py;
    return { e, tx: invDet * (dy * sx - dx * sy), ty: invDet * (-ply * sx + plx * sy) };
  }).filter(o => o.ty > 0.2).sort((a, b) => b.ty - a.ty);
  for (const { e, tx, ty } of list) {
    const P = PIX[e.img]; if (!P) continue;
    const scx = (VW / 2) * (1 + tx / ty);
    const unit = VH / ty;
    const bob = e.lift ? Math.sin(now / 200 + e.y) * 0.05 : 0;
    const breathe = e.kind === 'enemy' ? 1 + 0.03 * Math.sin(now / 260 + e.x * 3) : 1;
    const sh = unit * e.scale * breathe, sw = sh * P.w / P.h;
    const bottom = half + unit / 2 - (e.lift + bob) * unit;
    const top = bottom - sh;
    const x0 = Math.max(0, Math.floor(scx - sw / 2)), x1 = Math.min(VW, Math.ceil(scx + sw / 2));
    const y0 = Math.max(0, Math.floor(top)), y1 = Math.min(VH, Math.ceil(bottom));
    const L = light(ty), Lr = L, Lg = L * 0.88, Lb = L * 0.76;
    for (let x = x0; x < x1; x++) {
      if (ty >= zbuf[x]) continue;
      const u = Math.floor((x - (scx - sw / 2)) / sw * P.w);
      if (u < 0 || u >= P.w) continue;
      for (let y = y0; y < y1; y++) {
        const v = Math.floor((y - top) / sh * P.h);
        const cc = P.data[v * P.w + u];
        if ((cc >>> 24) < 128) continue;
        vbuf[y * VW + x] = 0xff000000 | (((cc >> 16 & 255) * Lb) << 16) | (((cc >> 8 & 255) * Lg) << 8) | ((cc & 255) * Lr);
      }
    }
  }
  vctx.putImageData(vimg, 0, 0);
}

let vignette = null;
function drawView(now, dim = 0) {
  render3D(now);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(view, 0, 0, W, H);
  if (!vignette) {
    vignette = ctx.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.95);
    vignette.addColorStop(0, 'rgba(0,0,0,0)'); vignette.addColorStop(1, 'rgba(0,0,0,0.75)');
  }
  ctx.fillStyle = vignette; ctx.fillRect(0, 0, W, H);
  if (dim) { ctx.fillStyle = `rgba(0,0,0,${dim})`; ctx.fillRect(0, 0, W, H); }
}

// ---------------------------------------------------------------- UI 部品
function panel(x, y, w, h, alpha = 0.78) {
  ctx.fillStyle = `rgba(12,10,8,${alpha})`; ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = 'rgba(200,170,110,.85)'; ctx.lineWidth = 2; ctx.strokeRect(x + 1, y + 1, w - 2, h - 2);
  ctx.strokeStyle = 'rgba(200,170,110,.3)'; ctx.lineWidth = 1; ctx.strokeRect(x + 5, y + 5, w - 10, h - 10);
}
function text(s, x, y, size = 18, color = '#eadfc8', align = 'left', font = UIFONT, weight = '') {
  ctx.font = `${weight} ${size}px ${font}`; ctx.textAlign = align; ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = 'rgba(0,0,0,.8)'; ctx.fillText(s, x + 2, y + 2);
  ctx.fillStyle = color; ctx.fillText(s, x, y);
}
function bar(x, y, w, h, v, max, color) {
  ctx.fillStyle = '#1a1210'; ctx.fillRect(x, y, w, h);
  ctx.fillStyle = color; ctx.fillRect(x, y, w * Math.max(0, v) / max, h);
  ctx.strokeStyle = 'rgba(200,170,110,.7)'; ctx.lineWidth = 1; ctx.strokeRect(x + .5, y + .5, w - 1, h - 1);
}
function icon(name, x, y, size) {
  const im = IMG[name]; if (!im) return;
  const r = Math.min(size / im.width, size / im.height);
  ctx.drawImage(im, x + (size - im.width * r) / 2, y + (size - im.height * r) / 2, im.width * r, im.height * r);
}
const hpColor = p => p.hp / p.maxHp > 0.5 ? '#5bbf4a' : p.hp / p.maxHp > 0.25 ? '#d9b23a' : '#d4442f';

function drawHUD(now) {
  const p = S.p;
  panel(16, H - 104, 300, 88);
  text(`HP ${p.hp} / ${p.maxHp}`, 32, H - 74, 18);
  bar(32, H - 64, 268, 12, p.hp, p.maxHp, hpColor(p));
  text(`攻撃 ${p.atk}   防御 ${p.def}`, 32, H - 28, 16, '#cdbf9f');
  // 持ち物
  const inv = [['item_potion', p.potions > 0, `×${p.potions}`], ['item_sword', p.sword], ['item_shield', p.shield], ['item_key', p.key]];
  panel(328, H - 72, 4 * 52 + 12, 56);
  inv.forEach(([n, has, label], i) => {
    ctx.globalAlpha = has ? 1 : 0.18; icon(n, 336 + i * 52, H - 66, 44); ctx.globalAlpha = 1;
    if (label) text(label, 336 + i * 52 + 44, H - 24, 14, '#fff', 'right');
  });
  drawMinimap();
  // トースト
  const live = toasts.filter(t => t.until > now);
  live.forEach((t, i) => {
    const a = Math.min(1, (t.until - now) / 400);
    ctx.globalAlpha = a;
    ctx.font = `17px ${UIFONT}`;
    const tw = ctx.measureText(t.text).width + (t.icon ? 56 : 0) + 40;
    const x = (W - tw) / 2, y = 24 + i * 62;
    panel(x, y, tw, 52);
    if (t.icon) icon(t.icon, x + 14, y + 5, 42);
    text(t.text, x + 20 + (t.icon ? 50 : 0), y + 33, 17);
    ctx.globalAlpha = 1;
  });
  text('↑/W 前進  ↓/S 後退  ←→/AD 向き  Q/E 横移動  M 消音', W - 16, H - 16, 13, 'rgba(230,220,200,.55)', 'right');
}
function drawMinimap() {
  const cs = 9, ox = W - 16 - MAP_SRC[0].length * cs, oy = 16;
  ctx.fillStyle = 'rgba(0,0,0,.55)'; ctx.fillRect(ox - 6, oy - 6, MAP_SRC[0].length * cs + 12, MAP_SRC.length * cs + 12);
  for (let y = 0; y < MAP_SRC.length; y++) for (let x = 0; x < MAP_SRC[0].length; x++) {
    if (!S.seen.has(x + ',' + y)) continue;
    const c = cellAt(x, y);
    ctx.fillStyle = c === '#' ? '#5d554a' : c === 'D' ? '#c9a43a' : '#1f1b16';
    ctx.fillRect(ox + x * cs, oy + y * cs, cs - 1, cs - 1);
  }
  const cx = ox + (S.cam.x + 0.5) * cs, cy = oy + (S.cam.y + 0.5) * cs;
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(S.cam.a);
  ctx.fillStyle = '#ff5a3c'; ctx.beginPath(); ctx.moveTo(5, 0); ctx.lineTo(-4, -4); ctx.lineTo(-4, 4); ctx.fill();
  ctx.restore();
}

// ---------------------------------------------------------------- 戦闘
const COMMANDS = ['たたかう', 'ぼうぎょ', 'かいふく', 'にげる'];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const rnd = (a, b) => a + Math.random() * (b - a);

function startBattle(entity) {
  const def = ENEMIES[entity.type];
  S.battle = {
    entity, def, hp: def.hp, menu: 0, busy: true, log: [], guard: false, charging: false,
    t0: performance.now(), hitFx: 0, hurtFx: 0, dieFx: 0, lunge: 0, lungeBig: false, slash: 0, slashCrit: false, shake: 0, shakeAmp: 0,
  };
  mode = 'battle';
  SFX.encounter();
  (async () => {
    if (def.boss) {
      await say('魔王「よくぞここまで来た、小さき勇者よ」');
      await say('魔王「姫は渡さぬ。ここで朽ち果てるがよい！」');
    } else await say(`${def.name}が現れた！`);
    S.battle.busy = false;
  })();
}
async function say(msg, wait = 750) {
  const b = S.battle; b.log.push(msg); if (b.log.length > 3) b.log.shift();
  await sleep(wait);
}
function calcDamage(atk, def) { return Math.max(1, Math.round(atk * rnd(0.85, 1.15)) - def); }

async function command(i) {
  const b = S.battle, p = S.p;
  if (!b || b.busy) return;
  b.busy = true;
  b.guard = false;
  let acted = true;
  if (i === 0) {
    await say('あなたの攻撃！', 300);
    if (b.def.evade && Math.random() < b.def.evade) { SFX.miss(); await say(`${b.def.name}はひらりとかわした！`); }
    else {
      const crit = Math.random() < 0.12;
      let d = calcDamage(p.atk, b.def.def); if (crit) d = Math.round(d * 1.8);
      b.slash = performance.now(); b.slashCrit = crit;
      crit ? SFX.crit() : SFX.hit();
      await sleep(90);
      b.hp -= d; b.hitFx = performance.now();
      if (crit) { b.shake = b.hitFx; b.shakeAmp = 10; }
      await say(crit ? `会心の一撃！ ${b.def.name}に ${d} のダメージ！` : `${b.def.name}に ${d} のダメージ！`);
    }
  } else if (i === 1) {
    b.guard = true; await say('あなたは身を守っている。', 500);
  } else if (i === 2) {
    if (p.potions <= 0) { await say('回復薬を持っていない！', 600); acted = false; }
    else {
      p.potions--; const h = Math.min(35, p.maxHp - p.hp); p.hp += h; SFX.heal();
      await say(`回復薬を飲んだ。HP が ${h} 回復した。`);
    }
  } else if (i === 3) {
    if (b.def.boss) { await say('魔王からは逃げられない！', 600); acted = false; }
    else if (Math.random() < 0.6) {
      await say('うまく逃げ切った…', 600);
      if (S.prev) { S.p.x = S.prev[0]; S.p.y = S.prev[1]; S.cam.x = S.p.x; S.cam.y = S.p.y; S.prev = null; }
      S.battle = null; mode = 'explore'; return;
    } else await say('回り込まれてしまった！');
  }
  if (b.hp <= 0) { await victory(); return; }
  if (acted) await enemyTurn();
  if (p.hp <= 0) { await defeat(); return; }
  b.busy = false;
}

async function enemyTurn() {
  const b = S.battle, p = S.p, def = b.def;
  if (def.boss && !b.charging && Math.random() < 0.3) {
    b.charging = true;
    SFX.charge();
    await say('魔王は大剣に灼熱の炎をまとわせた…！（次の攻撃に備えよ）', 1000);
    return;
  }
  let atk = def.atk, label = `${def.name}の攻撃！`, big = b.charging;
  if (b.charging) { atk = Math.round(def.atk * 1.8); label = '魔王の灼熱斬り！'; b.charging = false; }
  await say(label, 250);
  b.lunge = performance.now(); b.lungeBig = big;
  await sleep(LUNGE_MS * LUNGE_HIT);
  let d = calcDamage(atk, p.def);
  if (b.guard) d = Math.max(1, Math.round(d / 2.5));
  p.hp = Math.max(0, p.hp - d); b.hurtFx = performance.now();
  b.shake = b.hurtFx; b.shakeAmp = big ? 26 : b.guard ? 6 : 14;
  big ? SFX.bigHit() : SFX.hurt();
  await say(b.guard ? `守りで受け流した！ ${d} のダメージ。` : `あなたは ${d} のダメージを受けた！`);
}

async function victory() {
  const b = S.battle, p = S.p;
  b.dieFx = performance.now();
  b.won = true;
  S.kills++;
  if (b.def.boss) {
    await say('魔王ザルガスは断末魔とともに崩れ落ちた！', 1400);
    await say('…奥から姫の声が聞こえる。', 1200);
  } else {
    await say(`${b.def.name}を倒した！`, 900);
    p.maxHp += 5; p.hp = Math.min(p.maxHp, p.hp + 5);
    await say('戦いの経験で最大 HP が 5 上がった。', 1000);
  }
  b.entity.alive = false;
  S.battle = null; mode = 'explore';
}
async function defeat() {
  S.battle.lost = true;
  await say('あなたは力尽きた…', 1500);
  S.battle = null; mode = 'gameover'; fadeT = performance.now();
}

// 敵の描画。登場で奥から飛び込み、待機中は息づき、攻撃では身を引いてから画面手前へ突進する
const LUNGE_MS = 640, LUNGE_HIT = 0.5;
const easeOut = t => 1 - Math.pow(1 - t, 3);
const easeIn = t => t * t * t;
const easeOutBack = t => 1 + 2.7 * Math.pow(t - 1, 3) + 1.7 * Math.pow(t - 1, 2);
function drawEnemy(now, b) {
  const im = IMG[b.def.img]; if (!im) return;
  const maxH = b.def.boss ? 320 : 270, maxW = 540;
  const r = Math.min(maxH / im.height, maxW / im.width);
  const w = im.width * r, h = im.height * r;
  let sc = 1, ox = 0, oy = 0, alpha = 1, ghosts = 0;
  // 登場
  const ap = Math.min(1, (now - b.t0) / 450);
  sc *= 0.15 + 0.85 * easeOutBack(ap); alpha *= Math.min(1, ap * 2.5);
  if (ap < 1) ghosts = 2;
  // 待機
  const fly = b.def.lift ? 1 : 0;
  sc *= 1 + 0.025 * Math.sin(now / 260);
  ox += Math.sin(now / 640) * 10;
  oy += Math.sin(now / (fly ? 110 : 260)) * (fly ? 9 : 4);
  if (b.charging) { ox += (Math.random() - 0.5) * 6; oy += (Math.random() - 0.5) * 4; }
  // 攻撃
  const lt = (now - b.lunge) / LUNGE_MS;
  if (b.lunge && lt < 1) {
    const big = b.lungeBig ? 1.35 : 1;
    if (lt < 0.38) { const k = easeOut(lt / 0.38); sc *= 1 - 0.14 * k; oy -= 18 * k; ox -= 12 * k; }
    else if (lt < LUNGE_HIT) { const k = easeIn((lt - 0.38) / (LUNGE_HIT - 0.38)); sc *= 0.86 + 0.84 * big * k; oy += -18 + 110 * k; ghosts = 3; }
    else if (lt < 0.68) { sc *= 0.86 + 0.84 * big; oy += 92; ox += (Math.random() - 0.5) * 10; }
    else { const k = easeOut((lt - 0.68) / 0.32); sc *= (0.86 + 0.84 * big) * (1 - k) + k; oy += 92 * (1 - k); }
  }
  // 被弾
  const ht = (now - b.hitFx) / 300;
  if (ht < 1) { sc *= 1 - 0.07 * (1 - ht); ox += Math.sin(ht * 40) * 14 * (1 - ht); oy -= 8 * (1 - ht); }
  // 撃破
  if (b.dieFx) { const k = Math.min(1, (now - b.dieFx) / 900); alpha *= 1 - k; oy += 50 * k; sc *= 1 - 0.15 * k; }
  const cx = W / 2 + ox, cy = 385 - h / 2 + oy;
  const draw = (s, a) => {
    ctx.globalAlpha = a;
    ctx.drawImage(im, cx - w * s / 2, cy - h * s / 2, w * s, h * s);
  };
  for (let g = ghosts; g > 0; g--) draw(sc * (1 - g * 0.09), alpha * 0.18);
  draw(sc, alpha);
  ctx.globalCompositeOperation = 'lighter';
  if (ht < 0.55) draw(sc, 0.55 * alpha * (1 - ht / 0.55));
  if (b.charging) draw(sc, alpha * (0.2 + 0.14 * Math.sin(now / 70)));
  if (b.lunge && lt > 0.38 && lt < 0.68 && b.lungeBig) draw(sc, 0.3 * alpha);
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = 1;
}
// プレイヤーの斬撃エフェクト
function drawSlash(now, b) {
  const t = (now - b.slash) / 300;
  if (!b.slash || t >= 1) return;
  const lines = b.slashCrit ? [[-1, -0.8, 1, 0.8], [1, -0.8, -1, 0.8], [-1, -0.3, 1, 0.3]] : [[-0.9, -0.75, 0.9, 0.75]];
  const grow = Math.min(1, t / 0.3), fade = 1 - Math.max(0, (t - 0.3) / 0.7);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'round';
  lines.forEach(([x0, y0, x1, y1], i) => {
    const sx = W / 2 + x0 * 170, sy = 240 + y0 * 170;
    const ex = sx + (x1 - x0) * 170 * grow, ey = sy + (y1 - y0) * 170 * grow;
    for (const [lw, col] of [[22, `rgba(255,170,80,${0.25 * fade})`], [9, `rgba(255,230,180,${0.6 * fade})`], [3, `rgba(255,255,255,${fade})`]]) {
      ctx.strokeStyle = col; ctx.lineWidth = lw * (b.slashCrit ? 1.4 : 1);
      ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(ex, ey); ctx.stroke();
    }
  });
  ctx.restore();
}

function drawBattle(now) {
  const b = S.battle;
  const sk = Math.max(0, 1 - (now - b.shake) / 380) * b.shakeAmp;
  ctx.save();
  if (sk) ctx.translate((Math.random() - 0.5) * 2 * sk, (Math.random() - 0.5) * 2 * sk);
  drawView(now, 0.5);
  // 突進中は UI より手前に描いて、画面に飛び出してくるように見せる
  const lt = (now - b.lunge) / LUNGE_MS, front = b.lunge && lt > 0.42 && lt < 0.85;
  if (!front) drawEnemy(now, b);
  drawSlash(now, b);
  // 敵の名前と HP
  text(b.def.name, W / 2, 40, b.def.boss ? 28 : 22, b.def.boss ? '#ff8a6a' : '#eadfc8', 'center', FONT, 'bold');
  bar(W / 2 - 140, 52, 280, 10, b.hp, b.def.hp, '#c23a2a');
  // 被ダメージ演出
  if (now - b.hurtFx < 250) { ctx.fillStyle = `rgba(200,20,10,${0.35 * (1 - (now - b.hurtFx) / 250)})`; ctx.fillRect(0, 0, W, H); }
  // メッセージ
  panel(16, H - 150, 640, 134);
  b.log.forEach((m, i) => text(m, 36, H - 110 + i * 34, 19));
  // コマンド
  panel(672, H - 150, 272, 134);
  COMMANDS.forEach((c, i) => {
    const label = i === 2 ? `${c} (${S.p.potions})` : c;
    const sel = i === b.menu && !b.busy;
    const cx = 700 + (i % 2) * 124, cy = H - 102 + Math.floor(i / 2) * 50;
    if (sel) text('▶', cx - 20, cy, 18, '#f0c060');
    text(label, cx, cy, 19, b.busy ? '#7a705e' : sel ? '#f8e6b0' : '#eadfc8');
  });
  // 自分の HP
  panel(16, 16, 260, 56);
  text(`HP ${S.p.hp} / ${S.p.maxHp}`, 32, 40, 17);
  bar(32, 48, 228, 10, S.p.hp, S.p.maxHp, hpColor(S.p));
  if (front) drawEnemy(now, b);
  ctx.restore();
}
function battleHit(mx, my) {
  for (let i = 0; i < 4; i++) {
    const cx = 700 + (i % 2) * 124, cy = H - 102 + Math.floor(i / 2) * 50;
    if (mx > cx - 24 && mx < cx + 116 && my > cy - 30 && my < cy + 14) return i;
  }
  return -1;
}

// ---------------------------------------------------------------- タイトル・エンディング
let fadeT = 0;
function drawScene(name, overlay = 0.35) {
  const im = IMG[name];
  if (im) {
    const r = Math.max(W / im.width, H / im.height);
    ctx.drawImage(im, (W - im.width * r) / 2, (H - im.height * r) / 2, im.width * r, im.height * r);
  } else { ctx.fillStyle = '#0b0906'; ctx.fillRect(0, 0, W, H); }
  ctx.fillStyle = `rgba(0,0,0,${overlay})`; ctx.fillRect(0, 0, W, H);
}
function drawTitle(now) {
  drawScene('scene_title', 0.3);
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, 'rgba(0,0,0,.6)'); g.addColorStop(0.45, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.75)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  text('魔王の迷宮と', W / 2, 110, 34, '#e8d8b0', 'center', FONT, 'bold');
  text('囚われの姫', W / 2, 180, 64, '#ffd27a', 'center', FONT, 'bold');
  text('迷宮の最奥、封印の扉の向こうで姫が助けを待っている。', W / 2, 400, 18, '#eadfc8', 'center');
  ctx.globalAlpha = 0.55 + 0.45 * Math.sin(now / 400);
  text('Enter / クリック で冒険をはじめる', W / 2, 460, 22, '#fff', 'center', FONT);
  ctx.globalAlpha = 1;
  text('移動: ↑↓ / W S    向き: ← → / A D    横移動: Q E    戦闘: ↑↓←→ + Enter またはクリック', W / 2, H - 20, 13, 'rgba(230,220,200,.7)', 'center');
}
function drawEnding(now) {
  const t = (now - fadeT) / 1000;
  drawScene('scene_ending', 0.15);
  const g = ctx.createLinearGradient(0, H * 0.45, 0, H);
  g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,.85)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  const lines = [
    '魔王ザルガスは倒れ、姫は無事に救い出された。',
    '迷宮を抜けたふたりを、黄金の朝日が迎える。',
    '王国に、ふたたび平和が訪れた——',
  ];
  lines.forEach((l, i) => {
    ctx.globalAlpha = Math.max(0, Math.min(1, t - 1 - i * 1.6));
    text(l, W / 2, 360 + i * 36, 22, '#fff4dc', 'center', FONT);
  });
  ctx.globalAlpha = Math.max(0, Math.min(1, t - 6.5));
  text('THE END', W / 2, 80, 52, '#ffd27a', 'center', FONT, 'bold');
  const sec = Math.round((S.clearTime || 0) / 1000);
  text(`クリアタイム ${Math.floor(sec / 60)}分${String(sec % 60).padStart(2, '0')}秒　倒した敵 ${S.kills}体`, W / 2, 120, 18, '#eadfc8', 'center');
  text('Enter / クリック でタイトルへ', W / 2, H - 22, 16, 'rgba(255,255,255,.7)', 'center');
  ctx.globalAlpha = 1;
  if (t < 1.5) { ctx.fillStyle = `rgba(255,255,255,${1 - t / 1.5})`; ctx.fillRect(0, 0, W, H); }
}
function drawGameOver(now) {
  drawView(now, 0.4);
  const t = (now - fadeT) / 1000;
  ctx.fillStyle = `rgba(60,0,0,${Math.min(0.75, t * 0.5)})`; ctx.fillRect(0, 0, W, H);
  ctx.globalAlpha = Math.min(1, t);
  text('あなたは力尽きた…', W / 2, H / 2 - 20, 44, '#ff9a8a', 'center', FONT, 'bold');
  text('Enter / クリック で最初からやり直す', W / 2, H / 2 + 40, 20, '#eadfc8', 'center');
  ctx.globalAlpha = 1;
}
function rescuePrincess() {
  mode = 'rescue'; fadeT = performance.now();
  S.clearTime = performance.now() - S.t0;
}
function drawRescue(now) {
  drawView(now);
  const t = (now - fadeT) / 1000;
  panel(W / 2 - 300, H - 170, 600, 110);
  text('姫「勇者さま……来てくださったのですね！」', W / 2, H - 120, 21, '#fff4dc', 'center', FONT);
  if (t > 1.6) text('あなたは姫の手を取り、迷宮をあとにした。', W / 2, H - 82, 18, '#eadfc8', 'center');
  if (t > 3.2) { ctx.fillStyle = `rgba(255,255,255,${Math.min(1, (t - 3.2) / 1.2)})`; ctx.fillRect(0, 0, W, H); }
  if (t > 4.4) { mode = 'ending'; fadeT = now; }
}

// ---------------------------------------------------------------- 入力
const keyMap = {
  ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
  KeyQ: 'sl', KeyE: 'sr', Enter: 'ok', Space: 'ok', NumpadEnter: 'ok', KeyZ: 'ok', KeyM: 'mute',
  Digit1: 'c0', Digit2: 'c1', Digit3: 'c2', Digit4: 'c3',
};
const held = new Set();
addEventListener('keydown', ev => {
  const k = keyMap[ev.code]; if (!k) return;
  ev.preventDefault();
  if (ev.repeat && mode !== 'explore') return;
  held.add(k);
  press(k);
});
addEventListener('keyup', ev => held.delete(keyMap[ev.code]));
cv.addEventListener('click', ev => {
  const r = cv.getBoundingClientRect();
  const mx = (ev.clientX - r.left) * W / r.width, my = (ev.clientY - r.top) * H / r.height;
  if (mode === 'battle') { const i = battleHit(mx, my); if (i >= 0) { S.battle.menu = i; command(i); } }
  else press('ok');
});

function press(k) {
  if (k === 'mute') { toast(Sound.toggleMute() ? '音を消しました（M で戻す）' : '音を出しました', null, 1500); return; }
  if (mode === 'splash') { Sound.init(); mode = 'title'; return; }
  if (mode === 'chest' && k === 'ok' && performance.now() - S.chest.t0 > 400) { S.chest = null; mode = 'explore'; return; }
  if (mode === 'title' && k === 'ok') { newGame(); mode = 'explore'; toast('魔王に囚われた姫を救い出せ！', null, 3500); return; }
  if ((mode === 'ending' && performance.now() - fadeT > 3000 || mode === 'gameover') && k === 'ok') { mode = 'title'; return; }
  if (mode === 'explore') {
    if (k === 'up') move(0); else if (k === 'down') move(2);
    else if (k === 'left') turn(-1); else if (k === 'right') turn(1);
    else if (k === 'sl') move(3); else if (k === 'sr') move(1);
  } else if (mode === 'battle' && S.battle && !S.battle.busy) {
    const b = S.battle;
    if (k === 'up' || k === 'down') { b.menu = (b.menu + 2) % 4; SFX.cursor(); }
    else if (k === 'left' || k === 'right') { b.menu = b.menu ^ 1; SFX.cursor(); }
    else if (k === 'ok') command(b.menu);
    else if (k[0] === 'c') { b.menu = +k[1]; command(b.menu); }
  }
}

// ---------------------------------------------------------------- メインループ
function frame(now) {
  updateMusic();
  if (mode === 'splash') {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    ctx.globalAlpha = 0.55 + 0.45 * Math.sin(now / 400);
    text('Enter / クリック でスタート（音が鳴ります）', W / 2, H / 2, 22, '#e8d8b0', 'center', FONT);
    ctx.globalAlpha = 1;
  } else if (mode === 'loading') {
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, W, H);
    text('読み込み中…', W / 2, H / 2, 20, '#ccc', 'center');
  } else if (mode === 'title') drawTitle(now);
  else if (mode === 'explore') {
    updateAnim(now);
    // キー押しっぱなしで連続移動
    if (!S.anim) { if (held.has('up')) move(0); else if (held.has('down')) move(2); }
    if (mode === 'explore') { drawView(now); drawHUD(now); }
  } else if (mode === 'battle') { updateAnim(now); if (S.battle) drawBattle(now); else { drawView(now); drawHUD(now); } }
  else if (mode === 'chest') drawChest(now);
  else if (mode === 'rescue') drawRescue(now);
  else if (mode === 'ending') drawEnding(now);
  else if (mode === 'gameover') drawGameOver(now);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
loadAssets().then(() => { mode = 'splash'; });
