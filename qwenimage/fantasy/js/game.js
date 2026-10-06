// ひかりの姫と黒き竜 — 本体
'use strict';

const TILE = 48, VW = 768, VH = 576;
const cv = document.getElementById('game');
const ctx = cv.getContext('2d');
const FONT = '"DotGothic16", "MS Gothic", monospace';
const SAVE_KEY = 'hikari-hime-save-v1';

// ============================================================ 画像
const IMG = {}, PAT = {};
const DIRS = { t: 'tex', o: 'obj', c: 'chr', m: 'mon', i: 'item', bg: 'scene', ev: 'scene' };
function loadImg(name) {
  if (!name || IMG[name]) return;
  const pre = name.split('_')[0];
  const im = new Image();
  im.src = `assets/${DIRS[pre]}/${name}.${DIRS[pre] === 'scene' ? 'jpg' : 'png'}`;
  IMG[name] = im;
}
const I = (name) => { const im = IMG[name]; return im && im.complete && im.naturalWidth ? im : null; };
const TEX_COLOR = { t_grass: '#4d8f3c', t_forest: '#2d5e2a', t_water: '#2f6fc0', t_path: '#b48a5a', t_sand: '#e3d29a', t_cobble: '#8a8a8a',
  t_castle_floor: '#b9b9c2', t_castle_wall: '#5d5d6b', t_carpet: '#a3202a', t_cave_floor: '#5a4636', t_cave_wall: '#2b2433', t_wood_floor: '#9a6b3e', t_lava: '#ff6a1a' };
function pattern(name) {
  if (PAT[name]) return PAT[name];
  const im = I(name);
  if (!im) return TEX_COLOR[name] || '#f0f';
  return (PAT[name] = ctx.createPattern(im, 'repeat'));
}
(function preload() {
  for (const t of Object.values(TILES)) { loadImg(t.base); loadImg(t.obj); loadImg(t.big); }
  for (const m of Object.values(MAPS)) for (const n of m.npcs || []) loadImg(n.img);
  for (const m of Object.values(MONSTERS)) loadImg(m.img);
  for (const it of Object.values(ITEMS)) loadImg(it.icon);
  for (const s of Object.values(SHOPS)) { loadImg(s.bg); loadImg(s.keeper); }
  ['c_hero', 'c_hero_back', 'c_hero_side', 'c_princess', 'c_innkeeper', 'o_chest', 'o_chest_open', 'i_gold',
    'bg_field', 'bg_forest', 'bg_cave', 'bg_lair', 'ev_title', 'ev_kidnap', 'ev_throne', 'ev_inn', 'ev_rescue', 'ev_ending', 'ev_gameover'].forEach(loadImg);
})();

// ============================================================ 入力
const KEYMAP = { ArrowUp: 'up', ArrowDown: 'down', ArrowLeft: 'left', ArrowRight: 'right', w: 'up', s: 'down', a: 'left', d: 'right',
  z: 'ok', Enter: 'ok', ' ': 'ok', x: 'cancel', Escape: 'cancel', Backspace: 'cancel', m: 'mute' };
const held = {}, pressed = new Set();
function keyDown(act, repeat) {
  ensureAudio();
  if (act === 'mute') { if (!repeat && FM.ready) FM.toggleMute(); return; }
  if (repeat && (act === 'ok' || act === 'cancel')) return;
  held[act] = true; pressed.add(act);
}
function keyUp(act) { held[act] = false; }
addEventListener('keydown', (e) => {
  const act = KEYMAP[e.key.length === 1 ? e.key.toLowerCase() : e.key];
  if (!act) return;
  e.preventDefault(); keyDown(act, e.repeat);
});
addEventListener('keyup', (e) => { const act = KEYMAP[e.key.length === 1 ? e.key.toLowerCase() : e.key]; if (act) keyUp(act); });
const hit = (a) => { if (pressed.has(a)) { pressed.delete(a); return true; } return false; };
// タッチ操作
document.querySelectorAll('[data-key]').forEach((b) => {
  const act = b.dataset.key;
  const down = (e) => { e.preventDefault(); keyDown(act, false); b.classList.add('on'); };
  const up = (e) => { e.preventDefault(); keyUp(act); b.classList.remove('on'); };
  b.addEventListener('pointerdown', down); b.addEventListener('pointerup', up); b.addEventListener('pointerleave', up); b.addEventListener('pointercancel', up);
});

// ============================================================ 音
let audioStarting = false;
function ensureAudio() {
  if (FM.ready || audioStarting) return;
  audioStarting = true;
  FM.init({ musicVoices: 20, sfxVoices: 12, echo: 0.18 }).then(() => {
    Music.init(); FM.setVolume({ music: 0.7, sfx: 0.85 });
    if (G.music) Music.play(G.music);
  }).catch((e) => console.warn('audio init failed', e));
}
function setMusic(name) { G.music = name; Music.play(name); }
const sfx = (n) => FM.ready && FM.play_sfx(n);
function jingle(name) { return new Promise((r) => { G.music = null; if (!FM.ready) return r(); Music.jingle(name, r); }); }

// ============================================================ 状態
const G = {
  mode: 'title', music: null, busy: 0, fade: 0, flash: 0, time: 0,
  hero: null, gold: 0, inv: [], equip: {}, flags: {},
  mapId: null, M: null, px: 0, py: 0, dir: 'down', move: null, follower: null,
  npcs: [], scene: null, battle: null, banner: null, idle: 0, safeSteps: 0, overlay: null, shake: 0,
};
function newGame() {
  G.hero = { name: HERO_NAME, lv: 1, hp: 28, mhp: 28, mp: 8, mmp: 8, atk: 8, def: 4, agi: 6, exp: 0 };
  G.gold = 50; G.inv = [{ id: 'herb', n: 2 }]; G.equip = { weapon: 'stick', shield: null, armor: 'cloth' }; G.flags = {};
}
const atkOf = () => G.hero.atk + (G.equip.weapon ? ITEMS[G.equip.weapon].atk : 0);
const defOf = () => G.hero.def + (G.equip.shield ? ITEMS[G.equip.shield].def : 0) + (G.equip.armor ? ITEMS[G.equip.armor].def : 0);
const spellsKnown = () => Object.entries(SPELLS).filter(([, s]) => G.hero.lv >= s.lv).map(([k]) => k);
function addItem(id, n = 1) { const e = G.inv.find((x) => x.id === id); if (e) e.n += n; else G.inv.push({ id, n }); }
function removeItem(id, n = 1) { const e = G.inv.find((x) => x.id === id); if (!e) return; e.n -= n; if (e.n <= 0) G.inv.splice(G.inv.indexOf(e), 1); }
const hasItem = (id) => G.inv.some((x) => x.id === id);
const rnd = (a, b) => a + Math.floor(Math.random() * (b - a + 1));

function saveGame() {
  try { localStorage.setItem(SAVE_KEY, JSON.stringify({ hero: G.hero, gold: G.gold, inv: G.inv, equip: G.equip, flags: G.flags, mapId: G.mapId, x: G.px, y: G.py, dir: G.dir })); return true; } catch { return false; }
}
function loadSave() { try { return JSON.parse(localStorage.getItem(SAVE_KEY)); } catch { return null; } }

// ============================================================ 非同期ユーティリティ
const timers = [];
const wait = (ms) => new Promise((r) => timers.push({ t: ms / 1000, r }));
function tween(obj, key, to, ms) {
  return new Promise((r) => timers.push({ t: ms / 1000, total: ms / 1000, obj, key, from: obj[key], to, r }));
}
const fadeOut = (ms = 300) => tween(G, 'fade', 1, ms);
const fadeIn = (ms = 300) => tween(G, 'fade', 0, ms);
async function runScript(fn) {
  G.busy++;
  try { await fn(); } catch (e) { console.error(e); } finally { MSG.open = false; MSG.lines = []; G.busy--; }
}

// ============================================================ メッセージウィンドウ
const MSG = { open: false, lines: [], queue: [], cur: null, pos: 0, waiting: false, auto: 0, res: null, x: 16, y: 412, w: 736, h: 152, max: 4 };
function wrapText(text, width) {
  ctx.font = `22px ${FONT}`;
  const out = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const ch of para) {
      if (ctx.measureText(line + ch).width > width && line) { out.push(line); line = ch.trim() ? ch : ''; }
      else line += ch;
    }
    out.push(line);
  }
  return out;
}
function say(text, { clear = true, auto = 0 } = {}) {
  return new Promise((res) => {
    if (clear) MSG.lines = [];
    MSG.open = true; MSG.queue = wrapText(text, MSG.w - 52); MSG.auto = auto; MSG.res = res; MSG.waiting = false;
    nextLine();
  });
}
const log = (text, ms = 380) => say(text, { clear: false, auto: ms });
function nextLine() {
  MSG.cur = MSG.queue.shift(); MSG.pos = 0; MSG.lines.push('');
  if (MSG.lines.length > MSG.max) MSG.lines.shift();
}
function updateMsg(dt) {
  if (!MSG.open || !MSG.res) return false;
  if (MSG.cur != null) {
    MSG.pos += dt * (held.ok ? 160 : 55);
    if (hit('ok')) MSG.pos = MSG.cur.length;
    MSG.lines[MSG.lines.length - 1] = MSG.cur.slice(0, Math.floor(MSG.pos));
    if (MSG.pos >= MSG.cur.length) {
      MSG.lines[MSG.lines.length - 1] = MSG.cur;
      if (MSG.queue.length) nextLine();
      else { MSG.cur = null; MSG.waiting = true; MSG.wt = 0; }
    }
    return true;
  }
  if (MSG.waiting) {
    MSG.wt += dt;
    const done = MSG.auto ? (MSG.wt * 1000 >= MSG.auto || (held.ok && MSG.wt > 0.08)) : hit('ok') || hit('cancel');
    if (done) { MSG.waiting = false; const r = MSG.res; MSG.res = null; pressed.delete('ok'); r(); }
    return true;
  }
  return false;
}
function drawMsg() {
  if (!MSG.open) return;
  drawWindow(MSG.x, MSG.y, MSG.w, MSG.h);
  ctx.font = `22px ${FONT}`; ctx.fillStyle = '#fff'; ctx.textBaseline = 'top';
  MSG.lines.forEach((l, i) => ctx.fillText(l, MSG.x + 26, MSG.y + 18 + i * 32));
  if (MSG.waiting && !MSG.auto && Math.floor(G.time * 3) % 2 === 0) {
    ctx.fillText('▼', MSG.x + MSG.w / 2 - 10, MSG.y + MSG.h - 30);
  }
}

// ============================================================ ウィンドウ・メニュー
const UI = [];
function drawWindow(x, y, w, h, alpha = 0.9) {
  ctx.save();
  ctx.fillStyle = `rgba(8,10,40,${alpha})`;
  roundRect(x, y, w, h, 10); ctx.fill();
  ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; roundRect(x + 4, y + 4, w - 8, h - 8, 7); ctx.stroke();
  ctx.strokeStyle = 'rgba(160,180,255,0.35)'; ctx.lineWidth = 1; roundRect(x + 9, y + 9, w - 18, h - 18, 4); ctx.stroke();
  ctx.restore();
}
function roundRect(x, y, w, h, r) {
  ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}
function text(s, x, y, { size = 22, color = '#fff', align = 'left', shadow = false } = {}) {
  ctx.font = `${size}px ${FONT}`; ctx.textAlign = align; ctx.textBaseline = 'top';
  if (shadow) { ctx.fillStyle = 'rgba(0,0,0,0.75)'; ctx.fillText(s, x + 2, y + 2); }
  ctx.fillStyle = color; ctx.fillText(s, x, y); ctx.textAlign = 'left';
}
// 選択メニュー。pick() で選択を待ち、close() で閉じる
function menu(o) {
  const w = { kind: 'menu', idx: 0, top: 0, rowH: 34, cols: 1, cancel: true, ...o, waiting: null };
  w.rows = w.rows || 8;
  w.h = w.h || 30 + Math.min(w.rows, Math.ceil(w.items.length / w.cols)) * w.rowH + (w.title ? 30 : 0);
  w.pick = () => new Promise((r) => { w.waiting = r; const i = UI.indexOf(w); if (i >= 0) UI.splice(i, 1); UI.push(w); if (w.onMove) w.onMove(w.idx); });
  w.close = () => { const i = UI.indexOf(w); if (i >= 0) UI.splice(i, 1); };
  UI.push(w);
  return w;
}
async function ask(items, o = {}) { const m = menu({ items, x: 560, y: 300, w: 180, ...o }); const r = await m.pick(); m.close(); return r; }
const yesno = (o = {}) => ask([{ label: 'はい' }, { label: 'いいえ' }], { x: 600, y: 300, w: 140, ...o }).then((i) => i === 0);
function panel(draw) { const w = { kind: 'panel', draw }; UI.push(w); w.close = () => { const i = UI.indexOf(w); if (i >= 0) UI.splice(i, 1); }; return w; }
function updateUI() {
  for (let k = UI.length - 1; k >= 0; k--) {
    const w = UI[k];
    if (w.kind !== 'menu' || !w.waiting) continue;
    const n = w.items.length, c = w.cols;
    let mv = 0;
    if (hit('down')) mv = c; if (hit('up')) mv = -c;
    if (c > 1) { if (hit('right')) mv = 1; if (hit('left')) mv = -1; }
    if (mv) {
      w.idx = (w.idx + mv + n) % n; sfx('cursor');
      const row = Math.floor(w.idx / c);
      if (row < w.top) w.top = row; if (row >= w.top + w.rows) w.top = row - w.rows + 1;
      if (w.onMove) w.onMove(w.idx);
    }
    if (hit('ok')) {
      if (w.items[w.idx].disabled) sfx('bump');
      else { sfx('select'); const r = w.waiting; w.waiting = null; r(w.idx); }
    } else if (hit('cancel') && w.cancel) { sfx('cancel'); const r = w.waiting; w.waiting = null; r(-1); }
    return true;
  }
  return false;
}
function drawMenu(w) {
  drawWindow(w.x, w.y, w.w, w.h);
  let y0 = w.y + 16;
  if (w.title) { text(w.title, w.x + w.w / 2, w.y + 12, { align: 'center', color: '#ffe08a', size: 20 }); y0 += 30; }
  const colW = (w.w - 30) / w.cols;
  const first = w.top * w.cols, last = Math.min(w.items.length, first + w.rows * w.cols);
  for (let i = first; i < last; i++) {
    const it = w.items[i], r = Math.floor(i / w.cols) - w.top, cx = w.x + 16 + (i % w.cols) * colW, cy = y0 + r * w.rowH;
    if (i === w.idx && (!w.waiting || Math.floor(G.time * 4) % 2 === 0)) text('▶', cx, cy + 2, { size: 18 });
    let tx = cx + 24;
    if (it.icon && I(it.icon)) { ctx.drawImage(I(it.icon), tx - 2, cy - 2, 30, 30); tx += 32; }
    text(it.label, tx, cy, { color: it.disabled ? '#777' : '#fff' });
    if (it.right != null) text(String(it.right), cx + colW - 12, cy, { align: 'right', color: it.disabled ? '#777' : '#fff' });
  }
  if (w.top > 0) text('▲', w.x + w.w - 30, w.y + 8, { size: 14 });
  if (last < w.items.length) text('▼', w.x + w.w - 30, w.y + w.h - 24, { size: 14 });
}

// ============================================================ マップ
const DIRV = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
function prepMap(M) {
  if (M.g) return;
  M.g = M.rows.map((r) => r.split(''));
  M.H = M.g.length; M.W = Math.max(...M.g.map((r) => r.length));
  M.g.forEach((r) => { while (r.length < M.W) r.push(M.fill); });
  // 大きなオブジェクト（建物・城アイコンなど）を連結成分ごとに
  M.bigs = [];
  const seen = new Set();
  for (let y = 0; y < M.H; y++) for (let x = 0; x < M.W; x++) {
    const t = TILES[M.g[y][x]];
    const key = t.group || (t.big ? M.g[y][x] : null);
    if (!key || seen.has(x + ',' + y)) continue;
    let x0 = x, y0 = y, x1 = x, y1 = y; const st = [[x, y]]; seen.add(x + ',' + y);
    while (st.length) {
      const [cx, cy] = st.pop();
      x0 = Math.min(x0, cx); y0 = Math.min(y0, cy); x1 = Math.max(x1, cx); y1 = Math.max(y1, cy);
      for (const [a, b] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = cx + a, ny = cy + b; if (nx < 0 || ny < 0 || nx >= M.W || ny >= M.H || seen.has(nx + ',' + ny)) continue;
        const nt = TILES[M.g[ny][nx]]; const nk = nt.group || (nt.big ? M.g[ny][nx] : null);
        if (nk === key) { seen.add(nx + ',' + ny); st.push([nx, ny]); }
      }
    }
    M.bigs.push({ img: TILES[key].big, x0, y0, x1, y1 });
  }
}
const tileAt = (x, y) => (x < 0 || y < 0 || x >= G.M.W || y >= G.M.H) ? G.M.fill : G.M.g[y][x];
const T = (x, y) => TILES[tileAt(x, y)];
function npcAt(x, y) {
  return G.npcs.find((n) => (n.x === x && n.y === y) || (n.blocks && n.blocks.some(([a, b]) => n.x + a === x && n.y + b === y)));
}
const chestAt = (x, y) => (G.M.chests || []).find((c) => c.x === x && c.y === y);
function blocked(x, y) {
  if (x < 0 || y < 0 || x >= G.M.W || y >= G.M.H) return !G.M.edgeExit;
  const t = T(x, y);
  if (t.solid) return true;
  if (npcAt(x, y) || chestAt(x, y)) return true;
  return false;
}
function enterMap(id, x, y, dir) {
  const M = MAPS[id]; prepMap(M);
  G.mapId = id; G.M = M; G.px = x; G.py = y; G.dir = dir || 'down'; G.move = null;
  if (id === 'cave1' && G.flags.doorOpen) { const [dx, dy] = M.doorSpot; M.g[dy][dx] = 'g'; }
  G.npcs = (M.npcs || []).filter((n) => !(n.hideIf && G.flags[n.hideIf])).map((d) => ({
    ...d, hx: d.x, hy: d.y, dir: 'down', mv: null, wt: 1 + Math.random() * 2,
    blocks: d.id === 'dragon' ? [[-1, 0], [1, 0], [-1, -1], [0, -1], [1, -1]] : d.id === 'golem' ? [] : null,
  }));
  G.follower = G.flags.rescued && !G.flags.ended ? { x, y, fx: x, fy: y } : null;
  G.safeSteps = 4;
  setMusic(M.music);
  G.banner = { text: M.name, t: 2.2 };
}
async function warpTo(id, x, y, dir, snd = 'stairs') {
  G.busy++;
  sfx(snd);
  await fadeOut(250);
  enterMap(id, x, y, dir);
  await fadeIn(250);
  G.busy--;
}

function tryMove(dir) {
  G.dir = dir;
  const [dx, dy] = DIRV[dir], nx = G.px + dx, ny = G.py + dy;
  const M = G.M;
  if ((nx < 0 || ny < 0 || nx >= M.W || ny >= M.H) && M.edgeExit) {
    const [id, x, y, d] = M.edgeExit; warpTo(id, x, y, d, 'door'); return;
  }
  const n = npcAt(nx, ny);
  if (n && n.monster) { talkTo(n); return; }
  if (T(nx, ny).lockdoor) { runScript(lockedDoor); return; }
  if (blocked(nx, ny)) { if (!G.bumpT || G.bumpT <= 0) { sfx('bump'); G.bumpT = 0.3; } return; }
  if (G.follower) { G.follower.fx = G.follower.x; G.follower.fy = G.follower.y; G.follower.x = G.px; G.follower.y = G.py; }
  G.move = { fx: G.px, fy: G.py, t: 0 };
  G.px = nx; G.py = ny;
}
function onStep() {
  const ch = tileAt(G.px, G.py), t = TILES[ch];
  const warp = (G.M.warps || []).find((w) => w.ch === ch);
  if (warp) { const [id, x, y, d] = warp.to; warpTo(id, x, y, d, id === 'field' || G.mapId === 'field' ? 'door' : 'stairs'); return; }
  if (t.door) { runScript(() => (t.door === 'inn' ? innScript() : shopScript(t.door))); return; }
  if (G.safeSteps > 0) { G.safeSteps--; return; }
  if (t.enc && G.M.encZone && Math.random() < t.enc) {
    let zone = G.M.encZone(G.px, G.py);
    if (t.zone === 'forest' && zone !== 'north') zone = 'forest';
    const groups = ENCOUNTERS[zone];
    const bg = G.mapId === 'field' ? ('fq'.includes(ch) ? 'bg_forest' : 'bg_field') : G.mapId === 'cave2' ? 'bg_lair' : 'bg_cave';
    runScript(() => fight(groups[Math.floor(Math.random() * groups.length)], { bg }));
  }
}
function updateNpcs(dt) {
  for (const n of G.npcs) {
    if (n.mv) { n.mv.t += dt / 0.3; if (n.mv.t >= 1) n.mv = null; continue; }
    if (!n.wander || G.busy || UI.length) continue;
    n.wt -= dt;
    if (n.wt > 0) continue;
    n.wt = 1.2 + Math.random() * 2.5;
    const dir = ['up', 'down', 'left', 'right'][Math.floor(Math.random() * 4)];
    const [dx, dy] = DIRV[dir], nx = n.x + dx, ny = n.y + dy;
    n.dir = dir;
    if (Math.abs(nx - n.hx) > 3 || Math.abs(ny - n.hy) > 3) continue;
    if (blocked(nx, ny) || (nx === G.px && ny === G.py) || (G.follower && nx === G.follower.x && ny === G.follower.y) || T(nx, ny).door || T(nx, ny).big) continue;
    n.mv = { fx: n.x, fy: n.y, t: 0 }; n.x = nx; n.y = ny;
  }
}
function updateMap(dt) {
  if (G.bumpT > 0) G.bumpT -= dt;
  if (G.banner) { G.banner.t -= dt; if (G.banner.t <= 0) G.banner = null; }
  updateNpcs(dt);
  if (G.move) {
    G.move.t += dt / 0.17;
    if (G.move.t >= 1) { G.move = null; onStep(); }
    G.idle = 0;
    return;
  }
  if (G.busy || UI.length || MSG.open || G.fade > 0) return;
  G.idle += dt;
  if (hit('ok')) { const [dx, dy] = DIRV[G.dir]; interact(G.px + dx, G.py + dy); return; }
  if (hit('cancel')) { runScript(fieldMenu); return; }
  for (const d of ['up', 'down', 'left', 'right']) if (held[d]) { tryMove(d); break; }
}
function interact(x, y) {
  const n = npcAt(x, y);
  if (n) { talkTo(n); return; }
  const c = chestAt(x, y);
  if (c) { runScript(() => openChest(c)); return; }
  if (T(x, y).lockdoor) { runScript(lockedDoor); return; }
  // 机越し（建物のドア前など）は何もしない
}
function talkTo(n) {
  const opp = { up: 'down', down: 'up', left: 'right', right: 'left' };
  if (!n.monster) n.dir = opp[G.dir];
  runScript(() => TALK[n.talk](n));
}

// ---- 描画
const darkCv = document.createElement('canvas'); darkCv.width = VW; darkCv.height = VH;
const dctx = darkCv.getContext('2d');
function lerp(a, b, t) { return a + (b - a) * t; }
function entPos(e, mv) { return mv ? [lerp(mv.fx, e.x, Math.min(1, mv.t)), lerp(mv.fy, e.y, Math.min(1, mv.t))] : [e.x, e.y]; }
function heroPos() { return G.move ? [lerp(G.move.fx, G.px, G.move.t), lerp(G.move.fy, G.py, G.move.t)] : [G.px, G.py]; }
function drawShadow(cx, by, w) {
  ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.beginPath(); ctx.ellipse(cx, by - 3, w / 2, w / 6, 0, 0, Math.PI * 2); ctx.fill();
}
function drawChar(name, x, y, { flip = false, bob = 0, w = 48, alpha = 1 } = {}) {
  const im = I(name), cx = x + TILE / 2, by = y + TILE;
  drawShadow(cx, by, w * 0.7);
  ctx.save(); ctx.globalAlpha = alpha;
  if (!im) { ctx.fillStyle = '#e8c'; ctx.fillRect(x + 10, y + 4 - bob, 28, 40); ctx.restore(); return; }
  const h = im.height * (w / im.width);
  ctx.translate(cx, by - 2 - bob);
  if (flip) ctx.scale(-1, 1);
  ctx.drawImage(im, -w / 2, -h, w, h);
  ctx.restore();
}
function drawMap() {
  const M = G.M;
  const [hx, hy] = heroPos();
  let camX = hx * TILE + TILE / 2 - VW / 2, camY = hy * TILE + TILE / 2 - VH / 2;
  if (M.W * TILE > VW) camX = Math.max(0, Math.min(M.W * TILE - VW, camX)); else camX = (M.W * TILE - VW) / 2;
  if (M.H * TILE > VH) camY = Math.max(0, Math.min(M.H * TILE - VH, camY)); else camY = (M.H * TILE - VH) / 2;
  camX = Math.round(camX); camY = Math.round(camY);
  const x0 = Math.floor(camX / TILE) - 1, y0 = Math.floor(camY / TILE) - 1, x1 = x0 + VW / TILE + 3, y1 = y0 + VH / TILE + 4;
  ctx.save();
  ctx.translate(-camX, -camY);
  // 下地
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const t = T(x, y), px = x * TILE, py = y * TILE;
    const pat = pattern(t.base);
    if (t.water && typeof pat !== 'string') {
      pat.setTransform(new DOMMatrix().translate((G.time * 9) % 144, Math.sin(G.time * 0.8) * 6));
    } else if (t.base === 't_lava' && typeof pat !== 'string') {
      pat.setTransform(new DOMMatrix().translate(Math.sin(G.time * 0.6) * 10, (G.time * 5) % 144));
    }
    ctx.fillStyle = pat; ctx.fillRect(px, py, TILE, TILE);
    if (t.water) {
      ctx.fillStyle = 'rgba(255,255,255,0.45)';
      if (!T(x, y - 1).water) ctx.fillRect(px, py, TILE, 3);
      if (!T(x, y + 1).water) ctx.fillRect(px, py + TILE - 3, TILE, 3);
      if (!T(x - 1, y).water) ctx.fillRect(px, py, 3, TILE);
      if (!T(x + 1, y).water) ctx.fillRect(px + TILE - 3, py, 3, TILE);
    }
    if (t.wall) {
      if (!T(x, y + 1).wall) {
        const g = ctx.createLinearGradient(0, py + TILE - 18, 0, py + TILE);
        g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.55)');
        ctx.fillStyle = g; ctx.fillRect(px, py + TILE - 18, TILE, 18);
      }
      if (!T(x, y - 1).wall) { ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.fillRect(px, py, TILE, 4); }
    } else if (T(x, y - 1).wall) {
      const g = ctx.createLinearGradient(0, py, 0, py + 14);
      g.addColorStop(0, 'rgba(0,0,0,0.45)'); g.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fillRect(px, py, TILE, 14);
    }
  }
  // 行ごとにオブジェクト・キャラを描く（手前ほど後）
  const ents = [];
  for (const b of M.bigs) if (b.x1 >= x0 - 3 && b.x0 <= x1 + 3 && b.y1 >= y0 && b.y0 <= y1 + 3) ents.push({ y: b.y1 + 0.1, draw: () => {
    const im = I(b.img), w = (b.x1 - b.x0 + 1) * TILE, cx = b.x0 * TILE + w / 2, by = (b.y1 + 1) * TILE;
    if (im) ctx.drawImage(im, Math.round(cx - im.width / 2), by - im.height + 2);
    else { ctx.fillStyle = '#c96'; ctx.fillRect(b.x0 * TILE + 4, b.y0 * TILE + 4, w - 8, (b.y1 - b.y0 + 1) * TILE - 8); }
  } });
  for (let y = y0; y <= y1 + 1; y++) for (let x = x0; x <= x1; x++) {
    const t = T(x, y);
    if (!t.obj) continue;
    ents.push({ y, draw: () => {
      const im = I(t.obj);
      if (!im) { ctx.fillStyle = '#363'; ctx.fillRect(x * TILE + 8, y * TILE + 8, 32, 32); return; }
      if (t.obj === 'o_torch') {
        const fl = 0.8 + Math.sin(G.time * 13 + x) * 0.1 + Math.random() * 0.1;
        const g = ctx.createRadialGradient(x * TILE + 24, y * TILE + 18, 2, x * TILE + 24, y * TILE + 18, 40);
        g.addColorStop(0, `rgba(255,190,90,${0.55 * fl})`); g.addColorStop(1, 'rgba(255,150,50,0)');
        ctx.fillStyle = g; ctx.fillRect(x * TILE - 20, y * TILE - 20, 88, 88);
      }
      ctx.drawImage(im, x * TILE + (TILE - im.width) / 2, (y + 1) * TILE - im.height + (t.obj === 'o_torch' ? -4 : 0));
    } });
  }
  for (const c of M.chests || []) ents.push({ y: c.y, draw: () => {
    const im = I(G.flags[c.id] ? 'o_chest_open' : 'o_chest');
    drawShadow(c.x * TILE + 24, (c.y + 1) * TILE, 34);
    if (im) ctx.drawImage(im, c.x * TILE + 4, c.y * TILE + 6); else { ctx.fillStyle = '#a70'; ctx.fillRect(c.x * TILE + 8, c.y * TILE + 12, 32, 26); }
  } });
  for (const n of G.npcs) {
    const [nx, ny] = entPos(n, n.mv);
    ents.push({ y: ny + 0.2, draw: () => {
      if (n.monster) {
        const im = I(n.img), w = TILE * n.size, cx = nx * TILE + TILE / 2, by = (ny + 1) * TILE + 6;
        drawShadow(cx, by, w * 0.6);
        if (im) { const h = im.height * w / im.width; ctx.drawImage(im, cx - w / 2, by - h + Math.sin(G.time * 2) * 2, w, h); }
        return;
      }
      const bob = n.mv ? Math.abs(Math.sin(n.mv.t * Math.PI)) * 3 : Math.max(0, Math.sin(G.time * 2.4 + n.hx)) * 1.2;
      drawChar(n.img, nx * TILE, ny * TILE, { bob, flip: n.dir === 'right' });
    } });
  }
  if (G.follower) {
    const f = G.follower, t = G.move ? G.move.t : 1;
    const fx = lerp(f.fx, f.x, t), fy = lerp(f.fy, f.y, t);
    ents.push({ y: fy + 0.25, draw: () => drawChar('c_princess', fx * TILE, fy * TILE, { bob: G.move ? Math.abs(Math.sin(t * Math.PI)) * 3 : 0 }) });
  }
  ents.push({ y: hy + 0.3, draw: () => {
    const name = G.dir === 'up' ? 'c_hero_back' : G.dir === 'down' ? 'c_hero' : 'c_hero_side';
    const bob = G.move ? Math.abs(Math.sin(G.move.t * Math.PI)) * 4 : 0;
    drawChar(I(name) ? name : 'c_hero', hx * TILE, hy * TILE, { flip: G.dir === 'right', bob });
  } });
  ents.sort((a, b) => a.y - b.y).forEach((e) => e.draw());
  ctx.restore();
  // 暗闇（洞窟）
  if (M.dark) {
    dctx.globalCompositeOperation = 'source-over';
    dctx.clearRect(0, 0, VW, VH);
    dctx.fillStyle = 'rgba(4,2,12,0.86)'; dctx.fillRect(0, 0, VW, VH);
    dctx.globalCompositeOperation = 'destination-out';
    const hole = (x, y, r, a) => { const g = dctx.createRadialGradient(x, y, 0, x, y, r); g.addColorStop(0, `rgba(0,0,0,${a})`); g.addColorStop(1, 'rgba(0,0,0,0)'); dctx.fillStyle = g; dctx.fillRect(x - r, y - r, r * 2, r * 2); };
    hole(hx * TILE + 24 - camX, hy * TILE + 20 - camY, 190 + Math.sin(G.time * 3) * 4, 1);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (T(x, y).light) hole(x * TILE + 24 - camX, y * TILE + 24 - camY, 70, 0.7);
    for (const n of G.npcs) if (n.monster) hole(n.x * TILE + 24 - camX, n.y * TILE - camY, 120, 0.6);
    ctx.drawImage(darkCv, 0, 0);
  }
  // ステータス（立ち止まったとき）
  if (G.idle > 0.8 && !G.busy && !UI.length) drawMiniStatus(16, 16);
  if (G.banner) {
    const a = Math.min(1, G.banner.t);
    ctx.globalAlpha = a; drawWindow(VW / 2 - 150, 20, 300, 56); text(G.banner.text, VW / 2, 36, { align: 'center' }); ctx.globalAlpha = 1;
  }
}
function drawMiniStatus(x, y) {
  const h = G.hero;
  drawWindow(x, y, 172, 156);
  text(h.name, x + 22, y + 16, { color: '#ffe08a' });
  text(`Lv ${h.lv}`, x + 22, y + 46);
  text(`HP ${h.hp}`, x + 22, y + 72, { color: h.hp < h.mhp / 4 ? '#ff7a6a' : '#fff' });
  text(`MP ${h.mp}`, x + 22, y + 98);
  text(`G  ${G.gold}`, x + 22, y + 124, { size: 18, color: '#ffd76a' });
}

// ============================================================ 宝箱・扉
async function openChest(c) {
  if (G.flags[c.id]) { await say('たからばこは からっぽだ。'); return; }
  G.flags[c.id] = true; sfx('door');
  await say(`${HERO_NAME}は たからばこを あけた！`);
  if (c.gold) { G.gold += c.gold; sfx('coin'); await say(`${c.gold}ゴールドを てにいれた！`, { clear: false }); return; }
  addItem(c.item); await jingleGet();
  await say(`${ITEMS[c.item].name}を てにいれた！`, { clear: false });
}
async function jingleGet() { const m = G.music; await Promise.race([jingle('itemget'), wait(1400)]); setMusic(m || G.M.music); }
async function lockedDoor() {
  if (G.flags.doorOpen) return;
  if (!hasItem('key')) { await say('ぎんいろの とびらだ。\nかたく かぎが かかっている。'); return; }
  await say(`${HERO_NAME}は ぎんのかぎで とびらを あけた！`);
  sfx('door'); G.flags.doorOpen = true;
  const [dx, dy] = G.M.doorSpot; G.M.g[dy][dx] = 'g';
}

// ============================================================ 会話
const TALK = {
  async king() {
    if (G.flags.rescued) { await endingScript(); return; }
    await say('おうさま「おお ゆうしゃ アレンよ。\nひめは きたの どうくつの おくに とらわれておる。 たのんだぞ。」');
    const need = (EXP_TABLE[G.hero.lv + 1] || 0) - G.hero.exp;
    if (G.hero.lv < 20) await say(`おうさま「そなたが つぎの レベルに なるには あと ${need}ポイントの けいけんが ひつようじゃ。」`);
    await say('おうさま「ぼうけんの きろくを つけておくかね？」');
    if (await yesno()) { saveGame(); sfx('heal'); await say('おうさま「たしかに きろくしたぞ。 むりは するでないぞ。」'); }
    else await say('おうさま「そうか。 きを つけて いくのじゃぞ。」');
  },
  async minister() {
    if (G.flags.rescued) return say('だいじん「ひめさまを おすくい くださるとは！ おうさまに ごほうこくを！」');
    if (!G.flags.gotKey) return say('だいじん「ひがしの ルミナのまちの ちょうろうが、 きたの どうくつの ひみつを しっておるそうです。」');
    return say('だいじん「はしを わたった きたの ちほうは まものが つよい。 じゅうぶん レベルを あげて いきなされ。」');
  },
  guard1: () => say(G.flags.rescued ? 'へいし「ひめさまが ぶじに おもどりに なられた！ ばんざい！」' : 'へいし「しろを でて ひがしへ すすむと ルミナのまちが あります。」'),
  guard2: () => say('へいし「フィールドで つかれたら、 X キーで メニューを ひらき、 やくそうを つかうと よいでしょう。」'),
  soldier: () => say('へいし「ひめさまは だれにでも やさしい おかただった…。 かならず おすくいしてくれ！」'),
  maid: () => say(G.flags.rescued ? 'メイド「ああ、 ひめさま！ よかった…！」' : 'メイド「りゅうが ひめさまを さらう まえの よる、 きたの そらが あかく そまっていたのです。」'),
  child: () => say('こども「ここは ルミナの まち だよ！ ふんすいの まわりで あそぶのが すきなんだ。」'),
  man1: () => say('おとこ「やどやに とまると HPと MPが ぜんかいふく するんだ。 ぼうけんの きろくも つけてくれるぞ。」'),
  woman1: () => say('おんな「ポーションは やくそうより ずっと よく きくのよ。 どうぐやで うってるわ。」'),
  man2: () => say(G.flags.golemDead ? 'おとこ「ゴーレムを たおしたって！？ たいしたもんだ！」' : 'おとこ「きたの どうくつには いしの きょじんが いるらしい。\nはがねの ぶきが ないと たちうち できないぞ。」'),
  woman2: () => say('おんな「あの よる… くろい りゅうが ひめさまを つかんで きたへ とんでいくのを みたの…。」'),
  guardT: () => say('へいし「まちの そとは まものが でる。 みなみの しろの ちかくは よわい まものばかりだ。」'),
  async elder() {
    if (G.flags.rescued) return say('ちょうろう「おお、 ひめさまを たすけだしたのか！ さすがは ゆうしゃどのじゃ。」');
    if (!G.flags.gotKey) {
      await say('ちょうろう「おお、 おうさまの つかいの ゆうしゃどのか。」');
      await say('ちょうろう「きたの どうくつは、 ぎんの とびらで ふうじられておる。\nこの かぎを もっていきなされ。」');
      addItem('key'); G.flags.gotKey = true; await jingleGet();
      await say(`${HERO_NAME}は ぎんのかぎを てにいれた！`, { clear: false });
      await say('ちょうろう「どうくつへは、 しろから きたへ のびる みちを すすみ、 はしを わたるのじゃ。」');
      return;
    }
    await say('ちょうろう「どうくつの おくには いしの まもりびと ゴーレムが おる。\nそして りゅうの すには でんせつの せいけんが ねむると いう…。」');
  },
  async golem(n) {
    await say('いしの まもりびと ゴーレムが みちを ふさいでいる！');
    await say('ゴーレム「…ココヨリ サキヘハ… トオサヌ…」');
    const r = await fight(['golem'], { bg: 'bg_cave', boss: true });
    if (r === 'win') { G.flags.golemDead = true; G.npcs.splice(G.npcs.indexOf(n), 1); await say('ゴーレムは くずれおちた。 おくへの みちが ひらけた！'); }
  },
  async dragon(n) {
    await say(`${PRINCESS_NAME}「アレンさま！ きて くださったのですね！ きを つけて！」`);
    await say('こくりゅう「…おろかな にんげんよ。 ひめを とりかえしに きたか。」');
    sfx('roar'); G.shake = 0.8;
    await say('こくりゅう「よかろう。 わが ほのおで はいと なるがよい！」');
    const r = await fight(['dragon'], { bg: 'bg_lair', boss: true });
    if (r !== 'win') return;
    G.flags.dragonDead = true; G.npcs.splice(G.npcs.indexOf(n), 1);
    await rescueScript();
  },
  princess: () => say(`${PRINCESS_NAME}「アレンさま… わたしは だいじょうぶ。 どうか、 りゅうを…！」`),
};

// ============================================================ 店・宿屋
async function innScript() {
  let moved = false;
  const back = () => { if (!moved) { G.py += 1; G.dir = 'down'; moved = true; } };
  G.scene = { img: 'ev_inn', keeper: 'c_innkeeper' };
  await say(`やどや「たびびとの やどへ ようこそ。\nひとばん ${INN_PRICE}ゴールドですが、 おとまりに なりますか？」`);
  const gw = panel(() => drawGold());
  if (await yesno()) {
    if (G.gold < INN_PRICE) await say('やどや「おや、 おかねが たりない ようですね…。」');
    else {
      G.gold -= INN_PRICE;
      await say('やどや「ごゆっくり どうぞ。」');
      MSG.open = false;
      await fadeOut(600);
      await Promise.race([jingle('inn'), wait(3500)]);
      G.hero.hp = G.hero.mhp; G.hero.mp = G.hero.mmp;
      back(); saveGame();
      await fadeIn(600);
      await say('やどや「おはようございます。 ぼうけんの きろくを つけておきました。\nいってらっしゃいませ！」');
    }
  } else await say('やどや「また どうぞ。」');
  gw.close();
  G.scene = null; back();
  setMusic(G.M.music);
}
function drawGold() { drawWindow(16, 16, 190, 60); text(`${G.gold} G`, 186, 34, { align: 'right', color: '#ffd76a' }); }
function equipDelta(id) {
  const it = ITEMS[id]; if (!['weapon', 'shield', 'armor'].includes(it.type)) return '';
  const cur = G.equip[it.type] ? ITEMS[G.equip[it.type]] : null;
  const k = it.type === 'weapon' ? 'atk' : 'def', label = k === 'atk' ? 'こうげき' : 'しゅび';
  const d = it[k] - (cur ? cur[k] : 0);
  return `${label} ${d >= 0 ? '+' : ''}${d}（いま: ${cur ? cur.name : 'なし'}）`;
}
async function shopScript(kind) {
  const S = SHOPS[kind];
  G.scene = { img: S.bg, keeper: S.keeper };
  const gw = panel(() => drawGold());
  await say(`${S.title}「${S.hello}」`);
  for (;;) {
    await say(`${S.title}「どういう ごようけんですか？」`);
    const c = await ask([{ label: 'かう' }, { label: 'うる' }, { label: 'やめる' }], { x: 560, y: 220, w: 180 });
    if (c === 0) {
      let info = null, idx = 0;
      for (;;) {
        const items = S.goods.map((id) => ({ label: ITEMS[id].name, right: `${ITEMS[id].price}G`, icon: ITEMS[id].icon }));
        const m = menu({ items, x: 380, y: 16, w: 372, rows: 7, idx, title: 'なにを かいますか？',
          onMove: (i) => { info = S.goods[i]; } });
        const ip = panel(() => { if (!info) return; drawWindow(380, 300, 372, 100); text(ITEMS[info].desc, 400, 318, { size: 18 }); text(equipDelta(info), 400, 350, { size: 18, color: '#9fe0ff' }); });
        MSG.open = false;
        const i = await m.pick(); idx = Math.max(0, i);
        if (i < 0) { m.close(); ip.close(); break; }
        const id = S.goods[i], it = ITEMS[id];
        await say(`${S.title}「${it.name}ですね。 ${it.price}ゴールドに なりますが よろしいですか？」`);
        const ok = await yesno({ y: 300, x: 230 });
        if (!ok) { m.close(); ip.close(); continue; }
        if (G.gold < it.price) { await say(`${S.title}「おかねが たりない ようですね。」`); m.close(); ip.close(); continue; }
        G.gold -= it.price; addItem(id); sfx('coin');
        if (['weapon', 'shield', 'armor'].includes(it.type)) {
          await say(`${S.title}「まいど！ いま ここで そうびして いきますか？」`);
          if (await yesno({ y: 300, x: 230 })) { equipItem(id); sfx('select'); await say(`${HERO_NAME}は ${it.name}を そうびした！`); }
        } else await say(`${S.title}「まいど ありがとうございます！」`);
        m.close(); ip.close();
      }
    } else if (c === 1) {
      for (;;) {
        const list = G.inv.filter((e) => ITEMS[e.id].price > 0);
        if (!list.length) { await say(`${S.title}「うれる ものは もって いないようですね。」`); break; }
        MSG.open = false;
        const i = await ask(list.map((e) => ({ label: ITEMS[e.id].name + (e.n > 1 ? ` x${e.n}` : ''), right: `${Math.floor(ITEMS[e.id].price / 2)}G`, icon: ITEMS[e.id].icon })),
          { x: 380, y: 16, w: 372, rows: 8, title: 'なにを うりますか？' });
        if (i < 0) break;
        const e = list[i], it = ITEMS[e.id], p = Math.floor(it.price / 2);
        await say(`${S.title}「${it.name}なら ${p}ゴールドで ひきとりましょう。」`);
        if (await yesno({ y: 300, x: 230 })) { removeItem(e.id); G.gold += p; sfx('coin'); }
      }
    } else break;
  }
  await say(`${S.title}「また きてくださいね！」`);
  gw.close(); G.scene = null; G.py += 1; G.dir = 'down';
}
function equipItem(id) {
  const it = ITEMS[id];
  const cur = G.equip[it.type];
  removeItem(id);
  if (cur) addItem(cur);
  G.equip[it.type] = id;
}

// ============================================================ フィールドメニュー
async function fieldMenu() {
  sfx('select');
  const st = panel(() => drawMiniStatus(16, 16));
  const m = menu({ items: ['どうぐ', 'じゅもん', 'そうび', 'つよさ', 'きろく'].map((l) => ({ label: l })), x: 200, y: 16, w: 170 });
  for (;;) {
    const c = await m.pick();
    if (c < 0) break;
    if (c === 0) await itemMenu();
    if (c === 1) await spellMenu();
    if (c === 2) await equipMenu();
    if (c === 3) await statusView();
    if (c === 4) { await say(saveGame() ? 'ぼうけんの きろくを つけました。' : 'きろくに しっぱいしました。'); MSG.open = false; }
    if (G.warped) { G.warped = false; break; }
  }
  m.close(); st.close();
}
async function itemMenu() {
  for (;;) {
    if (!G.inv.length) { await say('どうぐを なにも もっていない。'); MSG.open = false; return; }
    let info = null;
    const m = menu({ items: G.inv.map((e) => ({ label: ITEMS[e.id].name, right: e.n > 1 ? `x${e.n}` : '', icon: ITEMS[e.id].icon })), x: 380, y: 16, w: 372, rows: 9, title: 'どうぐ',
      onMove: (i) => { info = G.inv[i] && G.inv[i].id; } });
    const ip = panel(() => { if (info) { drawWindow(380, 352, 372, 56); text(ITEMS[info].desc, 400, 370, { size: 18 }); } });
    const i = await m.pick(); m.close(); ip.close();
    if (i < 0) return;
    const id = G.inv[i].id, it = ITEMS[id];
    if (['weapon', 'shield', 'armor'].includes(it.type)) {
      await say(`${it.name}を そうびしますか？\n${equipDelta(id)}`);
      if (await yesno()) { equipItem(id); sfx('select'); await say(`${HERO_NAME}は ${it.name}を そうびした！`); }
    } else if (it.type === 'key') await say(`${it.name}： ${it.desc}`);
    else if (it.field === 'return') {
      if (!['field', 'town'].includes(G.mapId)) await say(`${HERO_NAME}は ${it.name}を つかった！\nしかし ここでは つかえない。`);
      else { removeItem(id); await say(`${HERO_NAME}は ${it.name}を なげた！`); MSG.open = false; await returnHome(); return; }
    } else { removeItem(id); await useHeal(it); }
    MSG.open = false;
  }
}
async function useHeal(it, inBattle = false) {
  const h = G.hero;
  const out = inBattle ? log : say;
  await out(`${HERO_NAME}は ${it.name}を つかった！`);
  if (it.heal) { const v = Math.min(h.mhp - h.hp, it.heal === 999 ? h.mhp : rnd(Math.floor(it.heal * 0.9), Math.ceil(it.heal * 1.1))); h.hp += v; sfx('heal'); await (inBattle ? log : (t) => say(t, { clear: false }))(`HPが ${v} かいふくした！`); }
  if (it.mp) { const v = Math.min(h.mmp - h.mp, it.mp); h.mp += v; sfx('heal'); await (inBattle ? log : (t) => say(t, { clear: false }))(`MPが ${v} かいふくした！`); }
}
async function returnHome() {
  G.warped = true;
  await warpTo('field', 28, 35, 'down', 'magic');
}
async function spellMenu() {
  const known = spellsKnown().filter((k) => SPELLS[k].field);
  if (!known.length) { await say('つかえる じゅもんが ない。'); MSG.open = false; return; }
  const i = await ask(known.map((k) => ({ label: SPELLS[k].name, right: `${SPELLS[k].mp}`, disabled: G.hero.mp < SPELLS[k].mp })), { x: 380, y: 16, w: 300, title: 'じゅもん（MP）' });
  if (i < 0) return;
  const sp = SPELLS[known[i]];
  G.hero.mp -= sp.mp; sfx('magic');
  await say(`${HERO_NAME}は ${sp.name}の じゅもんを となえた！`);
  if (sp.kind === 'heal') { const v = Math.min(G.hero.mhp - G.hero.hp, rnd(...sp.power)); G.hero.hp += v; sfx('heal'); await say(`HPが ${v} かいふくした！`, { clear: false }); }
  else if (sp.kind === 'return') {
    if (!['field', 'town'].includes(G.mapId)) { G.hero.mp += sp.mp; await say('しかし ここでは つかえない！', { clear: false }); }
    else { MSG.open = false; await returnHome(); return; }
  }
  MSG.open = false;
}
async function equipMenu() {
  const slots = [['weapon', 'ぶき'], ['shield', 'たて'], ['armor', 'よろい']];
  for (;;) {
    const s = await ask(slots.map(([k, l]) => ({ label: `${l}：${G.equip[k] ? ITEMS[G.equip[k]].name : 'なし'}` })), { x: 380, y: 16, w: 372, title: 'そうび' });
    if (s < 0) return;
    const type = slots[s][0];
    const cands = G.inv.filter((e) => ITEMS[e.id].type === type);
    const items = cands.map((e) => ({ label: ITEMS[e.id].name, icon: ITEMS[e.id].icon })).concat([{ label: 'はずす' }]);
    let info = null;
    const m = menu({ items, x: 380, y: 170, w: 372, rows: 6, onMove: (i) => { info = cands[i] ? cands[i].id : null; } });
    const ip = panel(() => { if (info) { drawWindow(380, 420, 372, 56); text(equipDelta(info), 398, 438, { size: 18, color: '#9fe0ff' }); } });
    const i = await m.pick(); m.close(); ip.close();
    if (i < 0) continue;
    if (i === cands.length) { if (G.equip[type]) { addItem(G.equip[type]); G.equip[type] = null; } }
    else { equipItem(cands[i].id); sfx('select'); }
  }
}
async function statusView() {
  const h = G.hero;
  const p = panel(() => {
    drawWindow(200, 60, 520, 430);
    const im = I('c_hero'); if (im) ctx.drawImage(im, 230, 90, 96, 116);
    text(h.name, 350, 90, { size: 26, color: '#ffe08a' });
    text(`レベル ${h.lv}`, 350, 126);
    text(`けいけんち ${h.exp}`, 350, 156, { size: 18 });
    text(`つぎまで ${h.lv < 20 ? EXP_TABLE[h.lv + 1] - h.exp : '-'}`, 350, 180, { size: 18 });
    const rows = [['HP', `${h.hp}/${h.mhp}`], ['MP', `${h.mp}/${h.mmp}`], ['ちから', h.atk], ['すばやさ', h.agi], ['こうげき', atkOf()], ['しゅび', defOf()]];
    rows.forEach(([k, v], i) => { text(k, 236 + (i % 2) * 240, 226 + Math.floor(i / 2) * 32); text(String(v), 440 + (i % 2) * 240, 226 + Math.floor(i / 2) * 32, { align: 'right' }); });
    text(`ぶき ：${G.equip.weapon ? ITEMS[G.equip.weapon].name : 'なし'}`, 236, 336);
    text(`たて ：${G.equip.shield ? ITEMS[G.equip.shield].name : 'なし'}`, 236, 366);
    text(`よろい：${G.equip.armor ? ITEMS[G.equip.armor].name : 'なし'}`, 236, 396);
    text(`じゅもん：${spellsKnown().map((k) => SPELLS[k].name).join(' ')}`, 236, 436, { size: 18 });
  });
  const w = menu({ items: [{ label: '' }], hidden: true, x: 0, y: 0, w: 0 });
  await w.pick(); w.close(); p.close();
}

// ============================================================ 戦闘
let B = null;
function calcDmg(atk, def) {
  const base = (atk - def / 2) / 2;
  if (base < 1.5) return Math.random() < 0.5 ? 0 : 1;
  return Math.max(1, Math.round(base * (0.85 + Math.random() * 0.3)));
}
function layoutEnemies() {
  const alive = B.enemies;
  const sizes = alive.map((e) => { const im = I(e.def.img); const s = e.def.scale; return im ? [im.width * s, im.height * s] : [150 * s, 150 * s]; });
  const gap = 24, total = sizes.reduce((a, [w]) => a + w, 0) + gap * (alive.length - 1);
  let x = VW / 2 - total / 2;
  alive.forEach((e, i) => { e.w = sizes[i][0]; e.h = sizes[i][1]; e.x = x + e.w / 2; e.by = e.def.boss ? 372 : 350; x += e.w + gap; });
}
function fx(type, x, y, o = {}) { B.fx.push({ type, x, y, t: 0, dur: o.dur || 0.5, ...o }); }
async function fight(ids, { bg = 'bg_field', boss = false } = {}) {
  const prevMusic = G.M.music;
  sfx('encounter');
  for (let i = 0; i < 3; i++) { G.flash = 1; await wait(70); G.flash = 0; await wait(60); }
  await fadeOut(150);
  const counts = {};
  B = { bg, boss, fx: [], shake: 0, red: 0, enemies: ids.map((id) => { const d = MONSTERS[id]; counts[id] = (counts[id] || 0) + 1; return { id, def: d, hp: d.hp, mhp: d.hp, alpha: 1, flash: 0, dead: false, lunge: 0, name: d.name }; }) };
  const dupe = {};
  for (const e of B.enemies) if (counts[e.id] > 1) { dupe[e.id] = (dupe[e.id] || 0) + 1; e.name += 'ABC'[dupe[e.id] - 1]; }
  layoutEnemies();
  G.battle = B; G.mode = 'battle';
  setMusic(boss ? 'boss' : 'battle');
  await fadeIn(250);
  if (B.enemies.length === 1) await say(`${B.enemies[0].def.name}が あらわれた！`);
  else {
    const kinds = Object.keys(counts).map((id) => counts[id] > 1 ? `${MONSTERS[id].name}が ${counts[id]}ひき` : MONSTERS[id].name);
    await say(`${kinds.join('と ')}${kinds[kinds.length - 1].endsWith('ひき') ? '' : 'が'} あらわれた！`);
  }
  let result = null;
  while (!result) {
    MSG.open = false;
    const cmd = await battleCommand();
    MSG.lines = []; MSG.open = true;
    if (cmd.type === 'run') {
      await log(`${HERO_NAME}は にげだした！`);
      const maxAgi = Math.max(...B.enemies.filter((e) => !e.dead).map((e) => e.def.agi));
      if (boss) await log('しかし まわりこまれて しまった！', 600);
      else if (Math.random() < Math.max(0.25, Math.min(0.95, 0.6 + (G.hero.agi - maxAgi) * 0.04))) { sfx('run'); await log('うまく にげきれた！', 600); result = 'run'; break; }
      else await log('しかし まわりこまれて しまった！', 600);
      for (const e of B.enemies) if (!e.dead && !result) result = await enemyAct(e);
      continue;
    }
    const order = [{ hero: true, sp: G.hero.agi * (0.6 + Math.random() * 0.5) }].concat(
      B.enemies.filter((e) => !e.dead).map((e) => ({ e, sp: e.def.agi * (0.6 + Math.random() * 0.5) }))).sort((a, b) => b.sp - a.sp);
    for (const a of order) {
      if (result) break;
      if (a.hero) result = await heroAct(cmd);
      else if (!a.e.dead) {
        result = await enemyAct(a.e);
        if (!result && a.e.def.twice && !a.e.dead && Math.random() < 0.4) result = await enemyAct(a.e);
      }
      if (!result && B.enemies.every((e) => e.dead)) result = 'win';
    }
    if (!result && B.enemies.every((e) => e.dead)) result = 'win';
  }
  if (result === 'win') await victory();
  if (result === 'lose') { await gameOver(); return 'lose'; }
  await fadeOut(250);
  G.battle = null; B = null; G.mode = 'map'; MSG.open = false;
  setMusic(prevMusic); G.safeSteps = 2;
  await fadeIn(250);
  return result;
}
function enemyListPanel() {
  return panel(() => {
    drawWindow(232, 412, 520, 152);
    const groups = [];
    for (const e of B.enemies) if (!e.dead) { const g = groups.find((x) => x.id === e.id); if (g) g.n++; else groups.push({ id: e.id, n: 1 }); }
    groups.forEach((g, i) => text(`${MONSTERS[g.id].name}${g.n > 1 ? `  ー ${g.n}ひき` : ''}`, 260, 432 + i * 34));
  });
}
async function chooseTarget() {
  const alive = B.enemies.filter((e) => !e.dead);
  if (alive.length === 1) return alive[0];
  B.target = 0;
  const i = await ask(alive.map((e) => ({ label: e.name })), { x: 232, y: 412, w: 260, onMove: (k) => { B.target = alive[k]; } });
  B.target = null;
  return i < 0 ? null : alive[i];
}
async function battleCommand() {
  const ep = enemyListPanel();
  const m = menu({ items: ['たたかう', 'じゅもん', 'どうぐ', 'にげる'].map((l) => ({ label: l })), x: 16, y: 412, w: 200, cancel: false });
  for (;;) {
    const c = await m.pick();
    if (c === 0) { const t = await chooseTarget(); if (t) { m.close(); ep.close(); return { type: 'attack', target: t }; } }
    if (c === 1) {
      const known = spellsKnown().filter((k) => SPELLS[k].battle !== false);
      const i = await ask(known.map((k) => ({ label: SPELLS[k].name, right: SPELLS[k].mp, disabled: G.hero.mp < SPELLS[k].mp })), { x: 232, y: 250, w: 300, title: 'じゅもん（MP）' });
      if (i >= 0) {
        const sp = SPELLS[known[i]];
        let t = null;
        if (sp.kind === 'attack' && !sp.all) { t = await chooseTarget(); if (!t) continue; }
        m.close(); ep.close(); return { type: 'spell', spell: known[i], target: t };
      }
    }
    if (c === 2) {
      const usable = G.inv.filter((e) => ITEMS[e.id].type === 'use' && !ITEMS[e.id].field);
      if (!usable.length) continue;
      const i = await ask(usable.map((e) => ({ label: ITEMS[e.id].name, right: `x${e.n}`, icon: ITEMS[e.id].icon })), { x: 232, y: 180, w: 340, rows: 6, title: 'どうぐ' });
      if (i >= 0) { m.close(); ep.close(); return { type: 'item', item: usable[i].id }; }
    }
    if (c === 3) { m.close(); ep.close(); return { type: 'run' }; }
  }
}
async function damageEnemy(e, d, crit) {
  e.hp = Math.max(0, e.hp - d); e.flash = 0.45; e.shake = 0.3;
  fx('num', e.x, e.by - e.h * 0.55, { text: String(d), color: crit ? '#ffef5a' : '#fff', dur: 0.9 });
  sfx(crit ? 'crit' : 'enemyhit');
  await log(d > 0 ? `${e.name}に ${d}の ダメージ！` : `${e.name}に ダメージを あたえられない！`);
  if (e.hp <= 0) { e.dead = true; sfx('miss'); await tween(e, 'alpha', 0, 350); await log(`${e.name}を たおした！`); }
}
async function heroAct(cmd) {
  const h = G.hero;
  if (cmd.type === 'attack') {
    let t = cmd.target; if (t.dead) t = B.enemies.find((e) => !e.dead);
    await log(`${HERO_NAME}の こうげき！`, 150);
    sfx('attack'); fx('slash', t.x, t.by - t.h / 2, { dur: 0.3 });
    await wait(260);
    if (Math.random() < 1 / 28) { sfx('miss'); await log('ミス！ こうげきが はずれた！'); return null; }
    const crit = Math.random() < 1 / 18;
    if (crit) { await log('かいしんの いちげき！', 200); G.shake = 0.3; }
    await damageEnemy(t, crit ? Math.round(atkOf() * (0.95 + Math.random() * 0.15)) : calcDmg(atkOf(), t.def.def), crit);
  } else if (cmd.type === 'spell') {
    const sp = SPELLS[cmd.spell];
    h.mp -= sp.mp; sfx('magic');
    await log(`${HERO_NAME}は ${sp.name}の じゅもんを となえた！`, 250);
    if (sp.kind === 'heal') {
      fx('heal', 110, 70, { dur: 0.8 });
      const v = Math.min(h.mhp - h.hp, rnd(...sp.power)); h.hp += v; sfx('heal');
      await log(`HPが ${v} かいふくした！`);
    } else {
      const targets = sp.all ? B.enemies.filter((e) => !e.dead) : [cmd.target.dead ? B.enemies.find((e) => !e.dead) : cmd.target];
      sfx(cmd.spell === 'thunder' ? 'crit' : 'fire');
      for (const t of targets) fx(cmd.spell === 'thunder' ? 'bolt' : 'fire', t.x, t.by - t.h / 2, { dur: 0.7 });
      if (cmd.spell === 'thunder') { G.flash = 0.6; await wait(80); G.flash = 0; }
      await wait(500);
      for (const t of targets) await damageEnemy(t, rnd(...sp.power), false);
    }
  } else if (cmd.type === 'item') {
    removeItem(cmd.item); fx('heal', 110, 70, { dur: 0.8 });
    await useHeal(ITEMS[cmd.item], true);
  }
  return B.enemies.every((e) => e.dead) ? 'win' : null;
}
function pickAct(def) {
  const acts = def.acts || [[1, 'attack']];
  let r = Math.random() * acts.reduce((a, [w]) => a + w, 0);
  for (const a of acts) { r -= a[0]; if (r <= 0) return a; }
  return acts[0];
}
async function hurtHero(d) {
  const h = G.hero;
  h.hp = Math.max(0, h.hp - d);
  if (d > 0) { sfx('damage'); G.shake = 0.35; B.red = 0.5; fx('num', 110, 120, { text: String(d), color: '#ff8a7a', dur: 0.9 }); }
  await log(d > 0 ? `${HERO_NAME}は ${d}の ダメージを うけた！` : `${HERO_NAME}は ダメージを うけなかった！`);
  if (h.hp <= 0) { await log(`${HERO_NAME}は ちからつきた…`, 900); return 'lose'; }
  return null;
}
async function enemyAct(e) {
  const [, kind, p = {}] = pickAct(e.def);
  e.lunge = 0.35;
  if (kind === 'attack') {
    await log(`${e.name}の こうげき！`, 200);
    if (Math.random() < Math.min(0.12, G.hero.agi / 400)) { sfx('miss'); await log(`${HERO_NAME}は ひらりと みをかわした！`); return null; }
    return hurtHero(calcDmg(e.def.atk, defOf()));
  }
  if (kind === 'strong') { await log(`${e.name}は ${p.name}！`, 250); return hurtHero(calcDmg(e.def.atk * p.mul, defOf())); }
  if (kind === 'spell') { sfx('fire'); await log(`${e.name}は ${p.name}の じゅもんを となえた！`, 300); fx('fire', 110, 90, { dur: 0.6 }); return hurtHero(rnd(...p.power)); }
  if (kind === 'breath') { sfx('fire'); fx('breath', VW / 2, 200, { dur: 1 }); await log(`${e.name}は ${p.name}！`, 500); return hurtHero(rnd(...p.power)); }
  if (kind === 'healself') { sfx('heal'); const v = rnd(...p.power); e.hp = Math.min(e.mhp, e.hp + v); await log(`${e.name}は ${p.name}の じゅもんを となえた！\n${e.name}の きずが かいふくした！`); return null; }
  if (kind === 'idle') { if (e.id === 'dragon') { sfx('roar'); G.shake = 0.6; } await log(`${e.name}${p.text}`); return null; }
  return null;
}
async function victory() {
  const dead = B.enemies;
  const exp = dead.reduce((a, e) => a + e.def.exp, 0), gold = dead.reduce((a, e) => a + e.def.gold, 0);
  MSG.lines = [];
  Music.stop();
  const j = jingle('victory');
  const lines = [dead.length > 1 ? 'まものたちを やっつけた！' : `${dead[0].def.name}を やっつけた！`];
  if (exp) lines.push(`けいけんち ${exp}ポイントを かくとく！`);
  if (gold) lines.push(`${gold}ゴールドを てにいれた！`);
  G.gold += gold;
  for (let i = 0; i < lines.length; i++) await say(lines[i], { clear: false, auto: i < lines.length - 1 ? 450 : 0 });
  await j;
  G.hero.exp += exp;
  while (G.hero.lv < 20 && G.hero.exp >= EXP_TABLE[G.hero.lv + 1]) await levelUp();
}
async function levelUp() {
  const h = G.hero, before = spellsKnown();
  h.lv++;
  const g = {}; for (const k in GROWTH) g[k] = rnd(...GROWTH[k]);
  h.mhp += g.hp; h.mmp += g.mp; h.atk += g.atk; h.def += g.def; h.agi += g.agi;
  h.hp = Math.min(h.mhp, h.hp + g.hp); h.mp = Math.min(h.mmp, h.mp + g.mp);
  const j = jingle('levelup');
  fx('heal', 110, 70, { dur: 1 });
  await say(`${HERO_NAME}は レベル ${h.lv}に あがった！`);
  await j;
  await say(`さいだいHPが ${g.hp} あがった！ さいだいMPが ${g.mp} あがった！\nちからが ${g.atk}、 みのまもりが ${g.def}、 すばやさが ${g.agi} あがった！`, { clear: false });
  for (const k of spellsKnown()) if (!before.includes(k)) { sfx('magic'); await say(`${HERO_NAME}は ${SPELLS[k].name}の じゅもんを おぼえた！`); }
}
async function gameOver() {
  Music.stop();
  await fadeOut(800);
  G.battle = null; B = null; MSG.open = false;
  G.scene = { img: 'ev_gameover' };
  await fadeIn(800);
  jingle('gameover');
  await say(`${HERO_NAME}は しんで しまった…。`);
  await fadeOut(800);
  G.scene = null; G.mode = 'map';
  G.gold = Math.floor(G.gold / 2);
  G.hero.hp = G.hero.mhp; G.hero.mp = G.hero.mmp;
  enterMap('castle', 10, 3, 'up');
  await fadeIn(600);
  await say('おうさま「おお アレンよ、 よくぞ もどった。\nたましいだけは かみの ごかごで まもられたようじゃ。」');
  await say('おうさま「もちきんは はんぶんに なってしまったが、 くじけるでないぞ。」');
}
function updateBattle(dt) {
  for (const e of B.enemies) { e.flash = Math.max(0, e.flash - dt); e.lunge = Math.max(0, e.lunge - dt); e.shake = Math.max(0, (e.shake || 0) - dt); }
  B.red = Math.max(0, B.red - dt);
  B.fx = B.fx.filter((f) => (f.t += dt) < f.dur);
}
function drawBattle() {
  const bg = I(B.bg);
  if (bg) ctx.drawImage(bg, 0, 0, VW, 432); else { ctx.fillStyle = '#234'; ctx.fillRect(0, 0, VW, 432); }
  ctx.fillStyle = '#000'; ctx.fillRect(0, 432, VW, VH - 432);
  const g = ctx.createLinearGradient(0, 300, 0, 432); g.addColorStop(0, 'rgba(0,0,0,0)'); g.addColorStop(1, 'rgba(0,0,0,0.6)');
  ctx.fillStyle = g; ctx.fillRect(0, 300, VW, 132);
  B.enemies.forEach((e, i) => {
    if (e.alpha <= 0) return;
    const im = I(e.def.img);
    const bob = Math.sin(G.time * 2 + i * 1.3) * 3;
    const lunge = e.lunge > 0 ? Math.sin((e.lunge / 0.35) * Math.PI) * 0.08 : 0;
    const sx = e.shake > 0 ? Math.sin(e.shake * 80) * 6 : 0;
    ctx.save();
    ctx.globalAlpha = e.alpha;
    ctx.translate(e.x + sx, e.by + bob);
    ctx.scale(1 + lunge, 1 + lunge);
    ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.ellipse(0, 0, e.w * 0.38, 10, 0, 0, Math.PI * 2); ctx.fill();
    if (e.flash > 0 && Math.floor(e.flash * 20) % 2 === 0) ctx.globalAlpha = 0.25 * e.alpha;
    if (e.dead) ctx.filter = 'brightness(2.5) saturate(0)';
    if (im) ctx.drawImage(im, -e.w / 2, -e.h, e.w, e.h); else { ctx.fillStyle = '#a3c'; ctx.fillRect(-e.w / 2, -e.h, e.w, e.h); }
    ctx.restore();
    if (B.target === e) text('▼', e.x, e.by - e.h - 30 + Math.sin(G.time * 8) * 4, { align: 'center', color: '#ffe08a', shadow: true });
  });
  for (const f of B.fx) {
    const k = f.t / f.dur;
    if (f.type === 'slash') {
      ctx.save(); ctx.strokeStyle = `rgba(255,255,255,${1 - k})`; ctx.lineWidth = 6; ctx.lineCap = 'round';
      for (let j = -1; j <= 1; j++) { ctx.beginPath(); const L = 70 * Math.min(1, k * 3); ctx.moveTo(f.x - 50 + j * 18, f.y - 50); ctx.lineTo(f.x - 50 + j * 18 + L * 1.4, f.y - 50 + L * 1.4); ctx.stroke(); }
      ctx.restore();
    } else if (f.type === 'fire' || f.type === 'breath') {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      const n = f.type === 'breath' ? 40 : 18, spread = f.type === 'breath' ? 380 : 70;
      for (let j = 0; j < n; j++) {
        const a = j * 2.4 + f.t * 6, r = spread * k * (0.3 + ((j * 37) % 10) / 14);
        const x = f.x + Math.cos(a) * r, y = f.y + Math.sin(a) * r * 0.6 - k * 40;
        const gg = ctx.createRadialGradient(x, y, 0, x, y, 26);
        gg.addColorStop(0, `rgba(255,230,120,${1 - k})`); gg.addColorStop(1, 'rgba(255,60,0,0)');
        ctx.fillStyle = gg; ctx.fillRect(x - 26, y - 26, 52, 52);
      }
      ctx.restore();
    } else if (f.type === 'bolt') {
      ctx.save(); ctx.strokeStyle = `rgba(200,230,255,${1 - k})`; ctx.lineWidth = 5; ctx.beginPath();
      let x = f.x, y = 0; ctx.moveTo(x, y);
      for (let j = 0; j < 8; j++) { x = f.x + (((j * 53 + Math.floor(f.t * 30)) % 40) - 20); y += (f.y + 40) / 8; ctx.lineTo(x, y); }
      ctx.stroke(); ctx.restore();
    } else if (f.type === 'heal') {
      ctx.save(); ctx.globalCompositeOperation = 'lighter';
      for (let j = 0; j < 14; j++) {
        const x = f.x + Math.sin(j * 2.1) * 80, y = f.y + 60 - k * 90 - (j % 4) * 10;
        ctx.fillStyle = `rgba(140,255,170,${1 - k})`; ctx.fillRect(x, y, 5, 5);
      }
      ctx.restore();
    } else if (f.type === 'num') {
      const y = f.y - Math.min(1, k * 3) * 26 + (k > 0.33 ? 0 : 0);
      text(f.text, f.x, y, { size: 34, color: f.color, align: 'center', shadow: true });
    }
  }
  // ステータス
  const h = G.hero;
  drawWindow(16, 12, 200, 128, 0.85);
  if (B.red > 0) { ctx.fillStyle = `rgba(255,0,0,${B.red * 0.5})`; roundRect(16, 12, 200, 128, 10); ctx.fill(); }
  const col = h.hp <= h.mhp / 4 ? '#ff7a6a' : h.hp <= h.mhp / 2 ? '#ffe36a' : '#fff';
  text(h.name, 116, 26, { align: 'center', color: col });
  text(`HP ${String(h.hp).padStart(3)}`, 36, 56, { color: col });
  text(`MP ${String(h.mp).padStart(3)}`, 36, 82, { color: col });
  text(`Lv ${String(h.lv).padStart(3)}`, 36, 108, { color: col });
  ctx.fillStyle = '#333'; ctx.fillRect(140, 64, 60, 8); ctx.fillStyle = '#5f5'; ctx.fillRect(140, 64, 60 * h.hp / h.mhp, 8);
  ctx.fillStyle = '#333'; ctx.fillRect(140, 90, 60, 8); ctx.fillStyle = '#6af'; ctx.fillRect(140, 90, 60 * h.mp / Math.max(1, h.mmp), 8);
}

// ============================================================ イベント
async function intro() {
  G.mode = 'map';
  G.scene = { img: 'ev_kidnap' };
  setMusic('cave');
  await fadeIn(900);
  await say('ここは アリア おうこく。\nみどり ゆたかな へいわな くにで あった。');
  await say('しかし ある あらしの よる、 きたの やまから くろき りゅう ヴァルガが あらわれ…');
  await say(`おうじょ ${PRINCESS_NAME}を さらって いって しまったのだ。`);
  await fadeOut(600);
  G.scene = { img: 'ev_throne' }; setMusic('castle');
  await fadeIn(600);
  await say('おうさま「おお、 ゆうしゃ アレンよ！ よくぞ きてくれた。」');
  await say(`おうさま「きのうの よる、 こくりゅう ヴァルガが ひめ ${PRINCESS_NAME}を さらって いったのじゃ。」`);
  await say('おうさま「りゅうは きたの どうくつに すんでおる。\nどうか ひめを たすけだして くれ！」');
  await say('おうさま「これは わずかだが たびの しきんじゃ。」');
  G.gold += 100; sfx('coin');
  await say(`${HERO_NAME}は 100ゴールドを うけとった！`, { clear: false });
  await say('おうさま「まずは ひがしの ルミナのまちで そうびを ととのえるがよい。\nまちの ちょうろうが どうくつに ついて しっておるはずじゃ。」');
  await say('（やじるしキーで いどう、 Z で はなす・しらべる、 X で メニュー、 M で おとの オン/オフ）');
  await fadeOut(500);
  G.scene = null;
  enterMap('castle', 10, 4, 'up');
  await fadeIn(500);
}
async function rescueScript() {
  await fadeOut(600);
  G.scene = { img: 'ev_rescue' }; setMusic('ending');
  await fadeIn(800);
  await say(`${PRINCESS_NAME}「アレンさま… たすけに きて くださったのですね！」`);
  await say(`${PRINCESS_NAME}「ほんとうに ありがとう ございます。\nいっしょに おとうさまの もとへ かえりましょう。」`);
  await jingleGet();
  await say(`${PRINCESS_NAME}が なかまに くわわった！`);
  G.flags.rescued = true;
  await fadeOut(600);
  G.scene = null;
  enterMap('cave2', G.px, G.py, G.dir);
  G.follower = { x: G.px, y: G.py, fx: G.px, fy: G.py };
  await fadeIn(600);
  await say('（ヒント： X キーの メニューの じゅもん「リターン」や きかんのはねで しろへ もどれる。 どうくつの そとで つかおう）');
}
async function endingScript() {
  await fadeOut(800);
  G.scene = { img: 'ev_ending' }; setMusic('ending');
  G.flags.ended = true; G.follower = null;
  await fadeIn(1000);
  await say(`おうさま「おお… ${PRINCESS_NAME}！ ぶじで あったか！」`);
  await say(`${PRINCESS_NAME}「おとうさま！ アレンさまが りゅうを たおし、 わたしを たすけて くださったのです。」`);
  await say('おうさま「ゆうしゃ アレンよ、 まことに ありがとう。\nそなたこそ この くにの まことの えいゆうじゃ！」');
  await say('こうして アリア おうこくに ふたたび へいわが おとずれた。');
  await say(`ゆうしゃ ${HERO_NAME}と ひめ ${PRINCESS_NAME}の ものがたりは、\nながく かたりつがれて いったという…。`);
  MSG.open = false;
  await fadeOut(1200);
  G.scene = null;
  G.overlay = 'end';
  await fadeIn(1200);
  await new Promise((r) => { G.endWait = r; });
  G.overlay = null;
  saveGame();
  await fadeOut(600);
  G.mode = 'title'; G.titleMenu = null; setMusic('title');
  await fadeIn(600);
}
function drawEnd() {
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, VW, VH);
  const im = I('ev_ending'); if (im) { ctx.globalAlpha = 0.35; ctx.drawImage(im, 0, 72, VW, 432); ctx.globalAlpha = 1; }
  text('THE END', VW / 2, 170, { size: 64, align: 'center', color: '#ffe08a', shadow: true });
  text('ひかりの姫と黒き竜', VW / 2, 260, { size: 28, align: 'center', shadow: true });
  text(`${HERO_NAME}  レベル ${G.hero.lv}   しょじきん ${G.gold}G`, VW / 2, 320, { size: 20, align: 'center', shadow: true });
  text('あそんで くれて ありがとう！', VW / 2, 380, { size: 22, align: 'center', shadow: true });
  if (Math.floor(G.time * 2) % 2) text('Z キーで タイトルへ', VW / 2, 480, { size: 18, align: 'center', color: '#aaa' });
}

// ============================================================ タイトル
function updateTitle() {
  if (G.busy) return;
  if (!G.titleMenu) {
    if (hit('ok')) {
      sfx('select');
      setMusic('title');
      const save = loadSave();
      G.titleMenu = menu({ items: [{ label: 'はじめから' }, { label: 'つづきから', disabled: !save }], x: VW / 2 - 110, y: 380, w: 220, cancel: false, idx: save ? 1 : 0 });
      G.titleMenu.pick().then((i) => runScript(async () => {
        G.titleMenu.close();
        await fadeOut(600);
        if (i === 0) { newGame(); G.titleMenu = null; await intro(); }
        else {
          const s = loadSave(); newGame(); Object.assign(G, { hero: s.hero, gold: s.gold, inv: s.inv, equip: s.equip, flags: s.flags });
          G.titleMenu = null; G.mode = 'map'; enterMap(s.mapId, s.x, s.y, s.dir);
          await fadeIn(500);
        }
      }));
    }
  }
}
function drawTitle() {
  const im = I('ev_title');
  ctx.fillStyle = '#000'; ctx.fillRect(0, 0, VW, VH);
  if (im) { const s = VH / 432, w = VW * s; ctx.drawImage(im, (VW - w) / 2 - Math.sin(G.time * 0.1) * 20, 0, w, VH); }
  const g = ctx.createLinearGradient(0, 0, 0, 260); g.addColorStop(0, 'rgba(0,0,30,0.7)'); g.addColorStop(1, 'rgba(0,0,30,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, VW, 260);
  text('ひかりの姫と黒き竜', VW / 2, 70, { size: 54, align: 'center', color: '#fff3c0', shadow: true });
  text('～ Princess of Light and the Black Dragon ～', VW / 2, 146, { size: 18, align: 'center', color: '#dfe8ff', shadow: true });
  if (!G.titleMenu && Math.floor(G.time * 2) % 2 === 0) text('Z / Enter キーを おしてください', VW / 2, 430, { size: 22, align: 'center', shadow: true });
  text('© 2026  BGM: FM音源 / 画像: AI生成', VW - 16, VH - 26, { size: 14, align: 'right', color: '#ccc', shadow: true });
}

// ============================================================ メインループ
function updateTimers(dt) {
  for (let i = timers.length - 1; i >= 0; i--) {
    const t = timers[i]; t.t -= dt;
    if (t.obj) t.obj[t.key] = lerp(t.to, t.from, Math.max(0, t.t / t.total));
    if (t.t <= 0) { timers.splice(i, 1); if (t.obj) t.obj[t.key] = t.to; t.r(); }
  }
}
function update(dt) {
  G.time += dt;
  if (G.shake > 0) G.shake = Math.max(0, G.shake - dt);
  updateTimers(dt);
  if (G.overlay === 'end' && G.endWait && G.fade === 0 && hit('ok')) { const r = G.endWait; G.endWait = null; r(); }
  if (!updateMsg(dt)) updateUI();
  if (G.mode === 'title') updateTitle();
  else if (G.battle) updateBattle(dt);
  else if (G.mode === 'map' && G.M && !G.scene) updateMap(dt);
  pressed.clear();
}
function draw() {
  ctx.save();
  if (G.shake > 0) ctx.translate((Math.random() - 0.5) * 14 * G.shake * 2, (Math.random() - 0.5) * 10 * G.shake * 2);
  ctx.fillStyle = '#000'; ctx.fillRect(-20, -20, VW + 40, VH + 40);
  if (G.mode === 'title') drawTitle();
  else if (G.overlay === 'end') drawEnd();
  else if (G.battle) drawBattle();
  else if (G.scene) {
    const im = I(G.scene.img);
    if (im) ctx.drawImage(im, 0, 0, VW, 432);
    if (G.scene.keeper && I(G.scene.keeper)) { const k = I(G.scene.keeper); drawShadowAt(150, 404, 120); ctx.drawImage(k, 150 - 72, 404 - 174, 144, 174); }
  } else if (G.M) drawMap();
  ctx.restore();
  drawMsg();
  for (const w of UI) { if (w.kind === 'panel') w.draw(); else if (!w.hidden) drawMenu(w); }
  if (G.flash > 0) { ctx.fillStyle = `rgba(255,255,255,${G.flash})`; ctx.fillRect(0, 0, VW, VH); }
  if (G.fade > 0) { ctx.fillStyle = `rgba(0,0,0,${G.fade})`; ctx.fillRect(0, 0, VW, VH); }
}
function drawShadowAt(cx, by, w) { ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.beginPath(); ctx.ellipse(cx, by - 4, w / 2, w / 7, 0, 0, Math.PI * 2); ctx.fill(); }
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  update(dt); draw();
  requestAnimationFrame(frame);
}
function fit() {
  const s = Math.min(innerWidth / VW, innerHeight / VH);
  cv.style.width = `${Math.floor(VW * s)}px`; cv.style.height = `${Math.floor(VH * s)}px`;
}
addEventListener('resize', fit); fit();
document.fonts && document.fonts.load(`22px "DotGothic16"`).catch(() => {});
requestAnimationFrame(frame);
// デバッグ用
window.__G = G; window.__step = (n = 1, dt = 1 / 60) => { for (let i = 0; i < n; i++) { update(dt); } draw(); };
