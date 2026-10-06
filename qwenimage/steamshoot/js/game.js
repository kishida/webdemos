// STEAM ARMADA - steampunk horizontal shoot'em up
'use strict';

const W = 960, H = 540;
const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');

// ---------------------------------------------------------------- assets
const IMG = {};
const IMG_LIST = { sky: 'assets/sky.jpg', city: 'assets/city.png', player: 'assets/player.png',
  enemy1: 'assets/enemy1.png', enemy2: 'assets/enemy2.png', boss: 'assets/boss.png', brass: 'assets/brass.jpg' };

function loadImages() {
  return Promise.all(Object.entries(IMG_LIST).map(([k, src]) => new Promise((res, rej) => {
    const im = new Image(); im.onload = () => { IMG[k] = im; res(); }; im.onerror = () => rej(new Error('load ' + src)); im.src = src;
  })));
}

function offscreen(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

// white silhouette for hit flashes (composite only, no pixel reads -> works on file://)
function makeFlash(img) {
  const c = offscreen(img.width, img.height), g = c.getContext('2d');
  g.drawImage(img, 0, 0); g.globalCompositeOperation = 'source-atop';
  g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); return c;
}
// hazy tinted copy for the far city layer
function makeTinted(img, color, alpha, scale) {
  const c = offscreen(Math.round(img.width * scale), Math.round(img.height * scale)), g = c.getContext('2d');
  g.drawImage(img, 0, 0, c.width, c.height); g.globalCompositeOperation = 'source-atop';
  g.globalAlpha = alpha; g.fillStyle = color; g.fillRect(0, 0, c.width, c.height); return c;
}
function makeGlow(r, inner, outer) {
  const c = offscreen(r * 2, r * 2), g = c.getContext('2d');
  const gr = g.createRadialGradient(r, r, 0, r, r, r);
  gr.addColorStop(0, '#fff'); gr.addColorStop(0.25, inner); gr.addColorStop(0.6, outer); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, r * 2, r * 2); return c;
}

const FX = {};
function prepareAssets() {
  FX.playerFlash = makeFlash(IMG.player);
  FX.e1Flash = makeFlash(IMG.enemy1);
  FX.e2Flash = makeFlash(IMG.enemy2);
  FX.bossFlash = makeFlash(IMG.boss);
  FX.cityFar = makeTinted(IMG.city, '#c98a4a', 0.55, 0.75);
  FX.cityNear = makeTinted(IMG.city, '#1a0e08', 0.35, 1);
  FX.orbRed = makeGlow(16, '#ff9a3c', 'rgba(255,40,10,0.6)');
  FX.orbBlue = makeGlow(16, '#9ef0ff', 'rgba(40,140,255,0.6)');
  FX.fire = makeGlow(32, '#ffd27a', 'rgba(255,90,20,0.7)');
  FX.shot = makeGlow(12, '#fff3b0', 'rgba(255,190,60,0.7)');
  FX.brassPat = ctx.createPattern(IMG.brass, 'repeat');
  // vignette
  const v = offscreen(W, H), g = v.getContext('2d');
  const gr = g.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 0.95);
  gr.addColorStop(0, 'rgba(40,20,5,0)'); gr.addColorStop(1, 'rgba(25,10,0,0.65)');
  g.fillStyle = gr; g.fillRect(0, 0, W, H); FX.vignette = v;
}

// ---------------------------------------------------------------- input
const keys = {}; const pressed = {};
addEventListener('keydown', (e) => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) e.preventDefault();
  if (!keys[e.code]) pressed[e.code] = true; keys[e.code] = true; onAnyInput();
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
canvas.addEventListener('pointerdown', () => onAnyInput());
let pad = { x: 0, y: 0, fire: false, bomb: false, start: false };
let padPrev = {};
function pollPad() {
  const gp = navigator.getGamepads ? [...navigator.getGamepads()].find((g) => g) : null;
  if (!gp) { pad = { x: 0, y: 0 }; return; }
  const ax = Math.abs(gp.axes[0]) > 0.25 ? gp.axes[0] : 0, ay = Math.abs(gp.axes[1]) > 0.25 ? gp.axes[1] : 0;
  const b = (i) => gp.buttons[i] && gp.buttons[i].pressed;
  pad = { x: ax + (b(15) ? 1 : 0) - (b(14) ? 1 : 0), y: ay + (b(13) ? 1 : 0) - (b(12) ? 1 : 0), fire: b(0) || b(7), bomb: b(1) || b(2), start: b(9) };
  for (const k of ['fire', 'bomb', 'start']) { if (pad[k] && !padPrev[k]) { pressed['pad_' + k] = true; onAnyInput(); } }
  padPrev = { ...pad };
}
const hit = (...codes) => codes.some((c) => pressed[c]);

let audioUnlocked = false, unlockFrame = false;
function onAnyInput() {
  if (audioUnlocked) return;
  audioUnlocked = true; unlockFrame = true; // the unlocking key must not also start the game
  Audio.init().then(() => { if (state === 'title') Audio.play(getSong('stage'), { lead: true, drums: true }); })
    .catch((err) => console.error('audio init failed', err));
}

// ---------------------------------------------------------------- utils
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const dist2 = (ax, ay, bx, by) => (ax - bx) ** 2 + (ay - by) ** 2;

// ---------------------------------------------------------------- state
let state = 'loading';
let player, pBullets = [], eBullets = [], enemies = [], items = [], particles = [], pending = [];
let score = 0, hiscore = 0, loop = 0, stageTime = 0, timelineIdx = 0;
let shake = 0, flashWhite = 0, boss = null, bannerText = '', bannerT = 0, stateT = 0;
let nextExtend = 50000, killCount = 0, paused = false;
let scrollX = 0;
try { hiscore = +localStorage.getItem('steamArmadaHi') || 0; } catch (e) { /* storage blocked */ }

function resetGame() {
  score = 0; loop = 0; nextExtend = 50000; killCount = 0;
  player = { x: 140, y: H / 2, vy: 0, power: 1, lives: 3, bombs: 3, invuln: 2.5, fireT: 0, dead: false, respawnT: 0, bombT: 0 };
  startStage();
}
function startStage() {
  pBullets = []; eBullets = []; enemies = []; items = []; particles = []; pending = [];
  stageTime = 0; timelineIdx = 0; boss = null;
  banner(loop === 0 ? 'STAGE 1 — 蒸気の空' : `LOOP ${loop + 1} — 黄銅の嵐`);
  Audio.play(getSong('stage'));
  Audio.sfxPlay('whistle');
}
function banner(t) { bannerText = t; bannerT = 3; }
const diff = () => 1 + loop * 0.35;

// ---------------------------------------------------------------- spawning
function later(dt, fn) { pending.push({ t: stageTime + dt, fn }); }

function spawnEnemy(type, x, y, opts = {}) {
  const base = {
    drone: { hp: 3, r: 26, img: 'enemy1', score: 100 },
    diver: { hp: 4, r: 26, img: 'enemy1', score: 150 },
    gunship: { hp: 45, r: 50, img: 'enemy2', score: 1500 },
    mine: { hp: 6, r: 20, img: null, score: 80 },
  }[type];
  const e = { type, x, y, y0: y, t: 0, flash: 0, fireT: rand(0.8, 2.2) / diff(), ...base, ...opts };
  e.hp = Math.ceil(e.hp * (1 + loop * 0.4));
  enemies.push(e); return e;
}
function waveDrones(n, y, amp = 60, spacing = 0.32) {
  for (let i = 0; i < n; i++) later(i * spacing, () => spawnEnemy('drone', W + 40, y, { amp, phase: i * 0.6 }));
}
function waveDivers(n, fromTop) {
  for (let i = 0; i < n; i++) later(i * 0.4, () => spawnEnemy('diver', W + 40, fromTop ? rand(60, 130) : rand(H - 130, H - 60)));
}
function waveMines(n) { for (let i = 0; i < n; i++) later(i * 0.45, () => spawnEnemy('mine', W + 30, rand(70, H - 50), { spin: rand(-3, 3) })); }
function gunship(y) { spawnEnemy('gunship', W + 90, y, { stopX: rand(640, 780) }); }

const TIMELINE = [
  [2, () => waveDrones(5, 150)], [4.5, () => waveDrones(5, 390)],
  [7, () => waveDivers(4, true)], [9, () => waveDivers(4, false)],
  [12, () => gunship(200)], [15, () => waveDrones(6, 430, 40)],
  [18, () => waveMines(6)], [21, () => { waveDrones(5, 120); waveDrones(5, 420); }],
  [24, () => { gunship(150); later(1.5, () => gunship(390)); }],
  [30, () => { waveDivers(4, true); waveDivers(4, false); }],
  [34, () => waveDrones(8, 270, 160, 0.25)], [37, () => { waveMines(8); waveDrones(5, 100); }],
  [41, () => { gunship(120); gunship(420); later(2, () => gunship(270)); }],
  [48, () => { waveDrones(6, 160, 80); waveDrones(6, 380, 80); }],
  [52, () => { waveDivers(6, true); waveMines(6); }],
  [57, () => { gunship(200); gunship(360); waveDrones(6, 470, 30); }],
  [64, () => { waveMines(10); waveDivers(4, false); }],
  [69, () => { waveDrones(8, 270, 180, 0.22); later(2, () => gunship(270)); }],
  [78, () => { banner('WARNING!! 巨大浮遊要塞 接近'); Audio.stopMusic(); Audio.sfxPlay('warning'); }],
  [82.5, () => spawnBoss()],
];

function spawnBoss() {
  const hp = Math.round(1400 * (1 + loop * 0.5));
  boss = { x: W + 260, y: H / 2, t: 0, hp, maxHp: hp, flash: 0, phase: 0, fireA: 0, fireB: 0, angle: 0, dying: 0, entered: false };
  Audio.play(getSong('boss'));
}

// ---------------------------------------------------------------- bullets
function fireAt(x, y, tx, ty, speed, spread = 0, n = 1, kind = 'red') {
  const base = Math.atan2(ty - y, tx - x);
  for (let i = 0; i < n; i++) {
    const a = base + (n > 1 ? (i - (n - 1) / 2) * spread : 0);
    eBullets.push({ x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, r: 6, kind });
  }
}
function fireAngle(x, y, a, speed, kind = 'red', r = 6) { eBullets.push({ x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, r, kind }); }

function playerShoot() {
  const p = player; const x = p.x + 40, y = p.y + 8;
  const add = (dy, a, dmg = 1) => pBullets.push({ x, y: y + dy, vx: Math.cos(a) * 900, vy: Math.sin(a) * 900, dmg });
  add(-5, 0); add(5, 0);
  if (p.power >= 2) { add(-10, -0.1); add(10, 0.1); }
  if (p.power >= 3) { add(-12, -0.22); add(12, 0.22); }
  if (p.power >= 4) { add(0, -0.04, 1.5); add(0, 0.04, 1.5); }
  Audio.sfxPlay('shot', p.x);
  particles.push({ x: x + 6, y, vx: 0, vy: 0, life: 0.05, max: 0.05, size: 18, type: 'fire' });
}

function useBomb() {
  const p = player; if (p.bombs <= 0 || p.dead) return;
  p.bombs--; p.invuln = Math.max(p.invuln, 2.5); p.bombT = 1.2; flashWhite = 0.6; shake = 12;
  Audio.sfxPlay('bomb');
  for (const b of eBullets) puff(b.x, b.y, 1, 'steam');
  eBullets.length = 0;
  for (const e of enemies) damageEnemy(e, 25);
  if (boss && boss.entered && !boss.dying) damageBoss(60);
  for (let i = 0; i < 80; i++) {
    const a = rand(0, Math.PI * 2), s = rand(100, 600);
    particles.push({ x: p.x, y: p.y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.6, 1.4), max: 1.4, size: rand(20, 50), type: 'steam' });
  }
}

// ---------------------------------------------------------------- particles
function puff(x, y, n, type) {
  for (let i = 0; i < n; i++) {
    const a = rand(0, Math.PI * 2), s = rand(10, 60);
    particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 20, life: rand(0.4, 0.9), max: 0.9, size: rand(8, 18), type });
  }
}
function explode(x, y, scale = 1) {
  shake = Math.max(shake, 4 * scale);
  particles.push({ x, y, vx: 0, vy: 0, life: 0.25, max: 0.25, size: 80 * scale, type: 'fire' });
  for (let i = 0; i < 18 * scale; i++) {
    const a = rand(0, Math.PI * 2), s = rand(60, 380) * Math.sqrt(scale);
    particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.3, 0.7), max: 0.7, size: rand(2, 4), type: 'spark' });
  }
  for (let i = 0; i < 8 * scale; i++) {
    const a = rand(0, Math.PI * 2), s = rand(20, 120) * Math.sqrt(scale);
    particles.push({ x: x + rand(-10, 10) * scale, y: y + rand(-10, 10) * scale, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: rand(0.25, 0.6), max: 0.6, size: rand(20, 40) * scale, type: 'fire' });
    particles.push({ x, y, vx: Math.cos(a) * s * 0.6, vy: Math.sin(a) * s * 0.6 - 30, life: rand(0.8, 1.6), max: 1.6, size: rand(15, 35) * scale, type: 'smoke' });
  }
  for (let i = 0; i < 6 * scale; i++) {
    const a = rand(0, Math.PI * 2), s = rand(80, 260);
    particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 80, life: rand(0.8, 1.5), max: 1.5, size: rand(3, 7), type: 'debris', rot: rand(0, 6), vr: rand(-12, 12), grav: 400 });
  }
}

// ---------------------------------------------------------------- damage
function addScore(v) {
  score += v;
  if (score >= nextExtend) { player.lives++; nextExtend += 100000; Audio.sfxPlay('extend'); banner('EXTEND!'); }
  if (score > hiscore) hiscore = score;
}
function damageEnemy(e, dmg) {
  if (e.hp <= 0) return;
  e.hp -= dmg; e.flash = 0.06;
  if (e.hp <= 0) {
    addScore(e.score); killCount++;
    if (e.type === 'gunship') {
      explode(e.x, e.y, 2.2); Audio.sfxPlay('bigboom', e.x);
      items.push({ x: e.x, y: e.y, type: 'power', t: 0 });
      if (Math.random() < 0.35) items.push({ x: e.x + 20, y: e.y + 20, type: 'bomb', t: 0 });
    } else {
      explode(e.x, e.y, 1); Audio.sfxPlay('boom', e.x);
      if (killCount % 18 === 0) items.push({ x: e.x, y: e.y, type: 'power', t: 0 });
    }
    if (e.type === 'mine' && loop > 0) for (let i = 0; i < 8; i++) fireAngle(e.x, e.y, (i / 8) * Math.PI * 2, 140, 'blue');
  } else Audio.sfxPlay('hit', e.x);
}
function damageBoss(dmg) {
  boss.hp -= dmg; boss.flash = 0.05;
  if (Math.random() < 0.3) Audio.sfxPlay('hit', boss.x);
  if (boss.hp <= 0 && !boss.dying) {
    boss.dying = 0.001; eBullets.length = 0; addScore(30000 * (loop + 1));
    Audio.stopMusic();
  }
}
function killPlayer() {
  const p = player;
  explode(p.x, p.y, 1.8); Audio.sfxPlay('damage', p.x); shake = 14;
  p.dead = true; p.respawnT = 1.6; p.lives--; p.power = Math.max(1, p.power - 1);
  items.push({ x: p.x + 30, y: p.y, type: 'power', t: 0 });
  eBullets.length = 0;
  if (p.lives < 0) { state = 'gameover'; stateT = 0; Audio.stopMusic(); setTimeout(() => { if (state === 'gameover') Audio.play(getSong('gameover')); }, 900); saveHi(); }
}
function saveHi() { try { localStorage.setItem('steamArmadaHi', hiscore); } catch (e) { /* ignore */ } }

// ---------------------------------------------------------------- update
function update(dt) {
  stateT += dt;
  scrollX += dt;
  if (state === 'title') {
    if (unlockFrame) { unlockFrame = false; updateParticles(dt); return; }
    if (audioUnlocked && hit('KeyZ', 'Enter', 'Space', 'pad_start', 'pad_fire')) { Audio.sfxPlay('select'); state = 'play'; resetGame(); }
    updateParticles(dt); return;
  }
  if (state === 'gameover') {
    updateParticles(dt);
    if (stateT > 2 && hit('KeyZ', 'Enter', 'Space', 'pad_start', 'pad_fire')) { state = 'title'; stateT = 0; Audio.play(getSong('stage'), { lead: true, drums: true }); }
    return;
  }
  if (state === 'clear') {
    updateParticles(dt); updatePlayer(dt, true);
    if (stateT > 6) { loop++; state = 'play'; startStage(); }
    return;
  }
  if (hit('KeyP', 'Escape', 'pad_start')) paused = !paused;
  if (paused) return;

  stageTime += dt;
  while (timelineIdx < TIMELINE.length && TIMELINE[timelineIdx][0] <= stageTime) TIMELINE[timelineIdx++][1]();
  for (let i = pending.length - 1; i >= 0; i--) if (pending[i].t <= stageTime) { const f = pending[i].fn; pending.splice(i, 1); f(); }

  updatePlayer(dt, false);
  updateEnemies(dt);
  if (boss) updateBoss(dt);
  updateBullets(dt);
  updateItems(dt);
  updateParticles(dt);
  if (bannerT > 0) bannerT -= dt;
}

function updatePlayer(dt, auto) {
  const p = player;
  if (p.dead) {
    p.respawnT -= dt;
    if (p.respawnT <= 0 && state === 'play') { p.dead = false; p.x = 120; p.y = H / 2; p.invuln = 3; p.bombs = Math.max(p.bombs, 2); }
    return;
  }
  let mx = 0, my = 0;
  if (auto) { mx = 1.4; my = (H / 2 - p.y) / 100; }
  else {
    if (keys.ArrowLeft || keys.KeyA) mx -= 1; if (keys.ArrowRight || keys.KeyD) mx += 1;
    if (keys.ArrowUp || keys.KeyW) my -= 1; if (keys.ArrowDown || keys.KeyS) my += 1;
    mx += pad.x || 0; my += pad.y || 0;
  }
  const len = Math.hypot(mx, my); if (len > 1) { mx /= len; my /= len; }
  const slow = keys.ShiftLeft || keys.ShiftRight ? 0.5 : 1;
  const sp = 300 * slow;
  p.x += mx * sp * dt; p.y += my * sp * dt; p.vy += (my - p.vy) * Math.min(1, dt * 8);
  if (!auto) { p.x = clamp(p.x, 40, W - 50); p.y = clamp(p.y, 50, H - 25); }
  p.invuln = Math.max(0, p.invuln - dt); p.bombT = Math.max(0, p.bombT - dt);
  // exhaust
  if (Math.random() < dt * 30) particles.push({ x: p.x - 44, y: p.y + rand(-4, 8), vx: rand(-90, -40), vy: rand(-15, 5), life: rand(0.4, 0.8), max: 0.8, size: rand(5, 10), type: 'steam' });
  if (auto) return;
  p.fireT -= dt;
  if ((keys.KeyZ || keys.Space || pad.fire) && p.fireT <= 0) { p.fireT = 0.085; playerShoot(); }
  if (hit('KeyX', 'pad_bomb')) useBomb();
}

function updateEnemies(dt) {
  const p = player; const d = diff();
  for (const e of enemies) {
    e.t += dt; e.flash = Math.max(0, e.flash - dt);
    switch (e.type) {
      case 'drone':
        e.x -= 190 * dt; e.y = e.y0 + Math.sin(e.t * 2.6 + e.phase) * e.amp; break;
      case 'diver':
        if (e.t < 0.9) e.x -= 260 * dt;
        else { if (!e.locked) { e.locked = true; e.dvy = clamp((p.y - e.y) / 1.2, -260, 260); } e.x -= 330 * dt; e.y += e.dvy * dt; }
        break;
      case 'mine':
        e.x -= 110 * dt; e.y += Math.sin(e.t * 1.7) * 30 * dt; break;
      case 'gunship':
        if (e.t < 12) e.x += (e.stopX - e.x) * Math.min(1, dt * 1.2); else e.x -= 120 * dt;
        e.y = e.y0 + Math.sin(e.t * 0.9) * 25;
        if (Math.random() < dt * 12) particles.push({ x: e.x + rand(-10, 40), y: e.y - 40, vx: rand(10, 40), vy: rand(-60, -30), life: 1, max: 1, size: rand(8, 16), type: 'smoke' });
        break;
    }
    // firing
    if (!p.dead && e.x < W - 20 && e.x > 80) {
      e.fireT -= dt;
      if (e.fireT <= 0) {
        if (e.type === 'gunship') { fireAt(e.x - 60, e.y + 10, p.x, p.y, 200 * (0.9 + d * 0.1), 0.2, 3 + Math.min(2, loop) * 2); Audio.sfxPlay('eshot', e.x); e.fireT = 1.4 / d; }
        else if (e.type === 'drone' || e.type === 'diver') { if (Math.random() < 0.35 * d) { fireAt(e.x - 20, e.y, p.x, p.y, 170 * (0.9 + d * 0.1)); Audio.sfxPlay('eshot', e.x); } e.fireT = rand(1.5, 3) / d; }
        else e.fireT = 99;
      }
    }
    // collide with player
    if (!p.dead && p.invuln <= 0 && dist2(e.x, e.y, p.x, p.y) < (e.r * 0.7 + 8) ** 2) { damageEnemy(e, 10); killPlayer(); }
  }
  enemies = enemies.filter((e) => e.hp > 0 && e.x > -200 && e.y > -150 && e.y < H + 150);
}

function updateBoss(dt) {
  const b = boss; const p = player; const d = diff();
  b.t += dt; b.flash = Math.max(0, b.flash - dt);
  if (b.dying) {
    b.dying += dt; b.x += 20 * dt; b.y += 30 * dt;
    if (Math.random() < dt * 14) { explode(b.x + rand(-180, 180), b.y + rand(-90, 90), rand(1, 2)); Audio.sfxPlay('boom', b.x); }
    if (b.dying > 3.2) {
      for (let i = 0; i < 6; i++) explode(b.x + rand(-150, 150), b.y + rand(-80, 80), 3);
      Audio.sfxPlay('bigboom'); flashWhite = 1; shake = 25;
      boss = null; state = 'clear'; stateT = 0; saveHi();
      banner('STAGE CLEAR — 要塞撃沈!');
      setTimeout(() => { if (state === 'clear') Audio.play(getSong('clear')); }, 800);
    }
    return;
  }
  if (!b.entered) { b.x += (700 - b.x) * Math.min(1, dt * 0.8); if (b.x < 720) b.entered = true; return; }
  b.x = 700 + Math.sin(b.t * 0.37) * 40; b.y = H / 2 + 10 + Math.sin(b.t * 0.6) * 100;
  if (Math.random() < dt * 15) particles.push({ x: b.x + rand(0, 120), y: b.y - 110, vx: rand(20, 60), vy: rand(-80, -40), life: 1.5, max: 1.5, size: rand(15, 30), type: 'smoke' });
  if (p.dead) return;
  const ratio = b.hp / b.maxHp;
  const phase = ratio > 0.66 ? 0 : ratio > 0.33 ? 1 : 2;
  if (phase !== b.phase) { b.phase = phase; explode(b.x, b.y, 2); Audio.sfxPlay('bigboom'); eBullets.length = 0; }
  const fx = b.x - 170, fy = b.y + 20; // bow cannon
  b.fireA -= dt; b.fireB -= dt;
  if (phase === 0) {
    if (b.fireA <= 0) { fireAt(fx, fy, p.x, p.y, 230 * d ** 0.5, 0.18, 5); Audio.sfxPlay('eshot', fx); b.fireA = 1.1 / d; }
    if (b.fireB <= 0) {
      const t = b.t % 3; if (t < 1.2) { for (const s of [-1, 1]) fireAngle(b.x - 40, b.y + s * 70, Math.PI + s * (0.3 + t * 0.8), 180, 'blue'); }
      b.fireB = 0.12;
    }
  } else if (phase === 1) {
    if (b.fireA <= 0) { b.angle += 0.27; for (let k = 0; k < 3; k++) fireAngle(b.x + 19, b.y + 13, b.angle + (k * Math.PI * 2) / 3, 150 * d ** 0.4, 'blue'); b.fireA = 0.07 / Math.sqrt(d); }
    if (b.fireB <= 0) { fireAt(fx, fy, p.x, p.y, 280, 0.12, 3); Audio.sfxPlay('eshot', fx); b.fireB = 1.4; if (Math.random() < 0.5) { spawnEnemy('drone', W + 40, rand(80, 200), { amp: 40, phase: 0 }); spawnEnemy('drone', W + 40, rand(340, 460), { amp: 40, phase: 1 }); } }
  } else {
    if (b.fireA <= 0) { const n = 20 + loop * 4, off = rand(0, 1); for (let k = 0; k < n; k++) fireAngle(b.x + 19, b.y + 13, ((k + off) / n) * Math.PI * 2, 170 * d ** 0.4, k % 2 ? 'red' : 'blue'); Audio.sfxPlay('eshot', b.x); b.fireA = 0.75 / Math.sqrt(d); }
    if (b.fireB <= 0) { fireAt(fx, fy, p.x, p.y, 340, 0.08, 3); b.fireB = 0.5; }
  }
  if (!p.dead && p.invuln <= 0 && inBoss(p.x, p.y, 0.75)) killPlayer();
}
function inBoss(x, y, s = 1) { const b = boss; const dx = (x - b.x) / (190 * s), dy = (y - b.y) / (85 * s); return dx * dx + dy * dy < 1; }

function updateBullets(dt) {
  const p = player;
  for (const b of pBullets) {
    b.x += b.vx * dt; b.y += b.vy * dt;
    for (const e of enemies) {
      if (e.hp > 0 && dist2(b.x, b.y, e.x, e.y) < (e.r + 4) ** 2) { damageEnemy(e, b.dmg); b.dead = true; particles.push({ x: b.x, y: b.y, vx: 0, vy: 0, life: 0.08, max: 0.08, size: 14, type: 'fire' }); break; }
    }
    if (!b.dead && boss && boss.entered && !boss.dying && inBoss(b.x, b.y)) {
      damageBoss(b.dmg); b.dead = true;
      particles.push({ x: b.x, y: b.y, vx: rand(-60, 0), vy: rand(-60, 60), life: 0.1, max: 0.1, size: 16, type: 'fire' });
    }
  }
  pBullets = pBullets.filter((b) => !b.dead && b.x < W + 20 && b.y > -20 && b.y < H + 20);
  for (const b of eBullets) {
    b.x += b.vx * dt; b.y += b.vy * dt;
    if (!p.dead && p.invuln <= 0 && dist2(b.x, b.y, p.x, p.y + 6) < (b.r * 0.6 + 4) ** 2) { b.dead = true; killPlayer(); break; }
  }
  eBullets = eBullets.filter((b) => !b.dead && b.x > -20 && b.x < W + 20 && b.y > -20 && b.y < H + 20);
}

function updateItems(dt) {
  const p = player;
  for (const it of items) {
    it.t += dt; it.x -= 60 * dt; it.y += Math.sin(it.t * 3) * 20 * dt;
    if (!p.dead && dist2(it.x, it.y, p.x, p.y) < 40 ** 2) {
      it.dead = true; Audio.sfxPlay('power', it.x);
      if (it.type === 'power') { if (p.power < 4) p.power++; else addScore(5000); }
      else p.bombs = Math.min(6, p.bombs + 1);
    }
  }
  items = items.filter((it) => !it.dead && it.x > -30);
}

function updateParticles(dt) {
  for (const q of particles) {
    q.life -= dt; q.x += q.vx * dt; q.y += q.vy * dt;
    if (q.grav) q.vy += q.grav * dt;
    if (q.type === 'smoke' || q.type === 'steam') { q.vx *= 0.97; q.vy *= 0.97; q.x -= 30 * dt; }
    if (q.rot != null) q.rot += q.vr * dt;
  }
  particles = particles.filter((q) => q.life > 0);
  if (particles.length > 1500) particles.splice(0, particles.length - 1500);
}

// ---------------------------------------------------------------- render
function drawMirrorTiled(img, speed, y, h) {
  const w = img.width * (h / img.height);
  const off = (scrollX * speed) % (w * 2);
  for (let x = -off, i = 0; x < W; x += w, i++) {
    if (i % 2 === 0) ctx.drawImage(img, x, y, w + 1, h);
    else { ctx.save(); ctx.translate(x + w, y); ctx.scale(-1, 1); ctx.drawImage(img, 0, 0, w + 1, h); ctx.restore(); }
  }
}

function drawGear(x, y, r, teeth, rot, fill, holeColor) {
  ctx.save(); ctx.translate(x, y); ctx.rotate(rot);
  ctx.beginPath();
  for (let i = 0; i < teeth * 2; i++) {
    const a0 = (i / (teeth * 2)) * Math.PI * 2, a1 = ((i + 1) / (teeth * 2)) * Math.PI * 2;
    const rr = i % 2 === 0 ? r : r * 0.82;
    ctx.lineTo(Math.cos(a0) * rr, Math.sin(a0) * rr); ctx.lineTo(Math.cos(a1) * rr, Math.sin(a1) * rr);
  }
  ctx.closePath();
  ctx.moveTo(r * 0.35, 0); ctx.arc(0, 0, r * 0.35, 0, Math.PI * 2, true);
  ctx.fillStyle = fill; ctx.fill('evenodd');
  if (holeColor) { ctx.fillStyle = holeColor; for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; ctx.beginPath(); ctx.arc(Math.cos(a) * r * 0.58, Math.sin(a) * r * 0.58, r * 0.11, 0, Math.PI * 2); ctx.fill(); } }
  ctx.restore();
}

function drawBackground() {
  drawMirrorTiled(IMG.sky, 14, -30, 600);
  drawMirrorTiled(FX.cityFar, 32, H - 320, 210);
  // haze band
  const g = ctx.createLinearGradient(0, H - 260, 0, H);
  g.addColorStop(0, 'rgba(255,170,80,0)'); g.addColorStop(1, 'rgba(255,150,60,0.25)');
  ctx.fillStyle = g; ctx.fillRect(0, H - 260, W, 260);
  drawMirrorTiled(FX.cityNear, 70, H - 230, 230 * 1.0);
  // foreground gears & pipes (fast parallax)
  const fgOff = (scrollX * 170) % 700;
  for (let i = -1; i < 3; i++) {
    const bx = i * 700 - fgOff;
    drawGear(bx + 120, H + 30, 90, 14, scrollX * 0.8, '#1c110a', null);
    drawGear(bx + 250, H + 10, 55, 10, -scrollX * 1.3, '#24160c', null);
    ctx.fillStyle = '#160d07';
    ctx.fillRect(bx + 320, H - 40, 380, 40);
    ctx.fillRect(bx + 420, H - 120, 26, 120);
    ctx.fillRect(bx + 412, H - 124, 42, 12);
    ctx.fillRect(bx + 560, H - 70, 18, 70);
  }
}

function drawSprite(img, flashImg, x, y, w, flash, rot = 0, alpha = 1) {
  const h = img.height * (w / img.width);
  ctx.save(); ctx.translate(x, y); if (rot) ctx.rotate(rot); ctx.globalAlpha = alpha;
  ctx.drawImage(img, -w / 2, -h / 2, w, h);
  if (flash > 0 && flashImg) { ctx.globalAlpha = 0.5; ctx.drawImage(flashImg, -w / 2, -h / 2, w, h); }
  ctx.restore();
}

function drawEntities() {
  // items
  for (const it of items) {
    if (it.type === 'power') {
      ctx.drawImage(FX.fire, it.x - 26, it.y - 26, 52, 52);
      drawGear(it.x, it.y, 15, 10, it.t * 3, FX.brassPat, '#3a2210');
      ctx.fillStyle = '#fff'; ctx.font = 'bold 12px Cinzel, serif'; ctx.textAlign = 'center'; ctx.fillText('P', it.x, it.y + 4);
    } else {
      ctx.drawImage(FX.orbBlue, it.x - 22, it.y - 22, 44, 44);
      ctx.fillStyle = '#3b2412'; ctx.beginPath(); ctx.arc(it.x, it.y, 11, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#d9a441'; ctx.lineWidth = 2; ctx.stroke();
      ctx.fillStyle = '#ffe9a8'; ctx.font = 'bold 12px Cinzel, serif'; ctx.textAlign = 'center'; ctx.fillText('B', it.x, it.y + 4);
    }
  }
  // enemies
  for (const e of enemies) {
    if (e.type === 'gunship') drawSprite(IMG.enemy2, FX.e2Flash, e.x, e.y, 150, e.flash);
    else if (e.type === 'mine') {
      drawGear(e.x, e.y, 20, 9, e.t * e.spin, FX.brassPat, '#2a160a');
      ctx.fillStyle = e.flash > 0 ? '#fff' : (Math.sin(e.t * 10) > 0 ? '#ff4020' : '#7a1a0a');
      ctx.beginPath(); ctx.arc(e.x, e.y, 5, 0, Math.PI * 2); ctx.fill();
    } else drawSprite(IMG.enemy1, FX.e1Flash, e.x, e.y, 72, e.flash, e.type === 'diver' && e.locked ? Math.atan2(e.dvy, 330) * -0.6 : Math.sin(e.t * 8) * 0.05);
  }
  // boss
  if (boss) {
    const b = boss; const shakeX = b.dying ? rand(-4, 4) : 0;
    const bossFlash = (b.flash > 0 && Math.floor(b.t * 20) % 3 === 0) || (b.dying && Math.random() < 0.3);
    drawSprite(IMG.boss, FX.bossFlash, b.x + shakeX, b.y, 430, bossFlash ? 0.6 : 0);
    // furnace core glow
    const pulse = 0.6 + Math.sin(b.t * 6) * 0.25;
    ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = pulse;
    ctx.drawImage(FX.fire, b.x + 19 - 45, b.y + 13 - 45, 90, 90); ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  }
  // player
  const p = player;
  if (p && !p.dead && state !== 'title' && state !== 'gameover') {
    const blink = p.invuln > 0 && Math.floor(p.invuln * 15) % 2 === 0;
    drawSprite(IMG.player, FX.playerFlash, p.x, p.y, 96, blink ? 1 : 0, p.vy * 0.12, blink ? 0.6 : 1);
    ctx.fillStyle = '#fff'; ctx.strokeStyle = '#ff3010'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(p.x, p.y + 6, 4, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
  // bullets (additive glow)
  ctx.globalCompositeOperation = 'lighter';
  for (const b of pBullets || []) { ctx.drawImage(FX.shot, b.x - 16, b.y - 6, 32, 12); }
  for (const b of eBullets || []) { const im = b.kind === 'blue' ? FX.orbBlue : FX.orbRed; const s = b.r * 2.6; ctx.drawImage(im, b.x - s, b.y - s, s * 2, s * 2); }
  ctx.globalCompositeOperation = 'source-over';
}

function drawParticles() {
  for (const q of particles) {
    const k = q.life / q.max;
    if (q.type === 'smoke') { ctx.globalAlpha = k * 0.5; ctx.fillStyle = '#2d241e'; ctx.beginPath(); ctx.arc(q.x, q.y, q.size * (1.6 - k * 0.6), 0, Math.PI * 2); ctx.fill(); }
    else if (q.type === 'steam') { ctx.globalAlpha = k * 0.35; ctx.fillStyle = '#f4e8d8'; ctx.beginPath(); ctx.arc(q.x, q.y, q.size * (1.8 - k * 0.8), 0, Math.PI * 2); ctx.fill(); }
    else if (q.type === 'debris') { ctx.globalAlpha = Math.min(1, k * 2); ctx.save(); ctx.translate(q.x, q.y); ctx.rotate(q.rot); ctx.fillStyle = '#6b4520'; ctx.fillRect(-q.size, -q.size / 2, q.size * 2, q.size); ctx.restore(); }
  }
  ctx.globalCompositeOperation = 'lighter';
  for (const q of particles) {
    const k = q.life / q.max;
    if (q.type === 'fire') { ctx.globalAlpha = k; const s = q.size * (1.3 - k * 0.3); ctx.drawImage(FX.fire, q.x - s / 2, q.y - s / 2, s, s); }
    else if (q.type === 'spark') { ctx.globalAlpha = k; ctx.fillStyle = '#ffcf6a'; ctx.fillRect(q.x - q.size / 2, q.y - q.size / 2, q.size, q.size); }
  }
  ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
}

function brassText(text, x, y, size, align = 'center') {
  ctx.font = `700 ${size}px "Cinzel Decorative", Cinzel, serif`; ctx.textAlign = align;
  ctx.lineJoin = 'round'; ctx.lineWidth = Math.max(3, size / 9); ctx.strokeStyle = '#1a0d05'; ctx.strokeText(text, x, y);
  ctx.save(); ctx.translate(x, y); ctx.fillStyle = FX.brassPat; ctx.fillText(text, 0, 0); ctx.restore();
  ctx.fillStyle = 'rgba(255,220,140,0.25)'; ctx.fillText(text, x, y);
}
function plainText(text, x, y, size, color = '#f6dca0', align = 'center') {
  ctx.font = `700 ${size}px Cinzel, "Yu Mincho", serif`; ctx.textAlign = align;
  ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(20,10,4,0.9)'; ctx.strokeText(text, x, y);
  ctx.fillStyle = color; ctx.fillText(text, x, y);
}

function drawGauge(x, y, r, value, label) {
  ctx.save();
  ctx.fillStyle = FX.brassPat; ctx.beginPath(); ctx.arc(x, y, r + 3, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#f1e3c2'; ctx.beginPath(); ctx.arc(x, y, r - 1, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = '#3a2210'; ctx.lineWidth = 1.5;
  for (let i = 0; i <= 4; i++) { const a = Math.PI * 0.75 + (i / 4) * Math.PI * 1.5; ctx.beginPath(); ctx.moveTo(x + Math.cos(a) * r * 0.6, y + Math.sin(a) * r * 0.6); ctx.lineTo(x + Math.cos(a) * r * 0.9, y + Math.sin(a) * r * 0.9); ctx.stroke(); }
  ctx.strokeStyle = '#c4231a'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, r * 0.75, Math.PI * 1.95, Math.PI * 2.25); ctx.stroke();
  const a = Math.PI * 0.75 + value * Math.PI * 1.5 + Math.sin(scrollX * 30) * 0.02;
  ctx.strokeStyle = '#1a0d05'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(a) * r * 0.85, y + Math.sin(a) * r * 0.85); ctx.stroke();
  ctx.fillStyle = '#1a0d05'; ctx.beginPath(); ctx.arc(x, y, 2.5, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
  plainText(label, x, y + r + 13, 10);
}

function drawHUD() {
  // brass top bar
  ctx.save(); ctx.fillStyle = FX.brassPat; ctx.fillRect(0, 0, W, 34);
  ctx.fillStyle = 'rgba(30,15,5,0.45)'; ctx.fillRect(0, 0, W, 34);
  ctx.fillStyle = '#e8b85a'; ctx.fillRect(0, 33, W, 2); ctx.fillStyle = '#2a1608'; ctx.fillRect(0, 35, W, 2);
  for (let x = 10; x < W; x += 60) { ctx.fillStyle = '#f3d48a'; ctx.beginPath(); ctx.arc(x, 6, 2, 0, Math.PI * 2); ctx.arc(x, 28, 2, 0, Math.PI * 2); ctx.fill(); }
  ctx.restore();
  plainText('SCORE ' + String(score).padStart(8, '0'), 24, 23, 16, '#ffe9b0', 'left');
  plainText('HI ' + String(hiscore).padStart(8, '0'), 300, 23, 16, '#ffe9b0', 'left');
  // lives
  const lifeW = 34, lifeH = IMG.player.height * (lifeW / IMG.player.width);
  for (let i = 0; i < Math.min(player.lives, 6); i++) ctx.drawImage(IMG.player, 540 + i * 36, 17 - lifeH / 2, lifeW, lifeH);
  // bombs
  for (let i = 0; i < player.bombs; i++) { ctx.fillStyle = '#3b2412'; ctx.beginPath(); ctx.arc(780 + i * 18, 17, 7, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = '#ffd36b'; ctx.lineWidth = 1.5; ctx.stroke(); }
  // power gauge (bottom-left)
  drawGauge(36, H - 48, 22, (player.power - 1) / 3, 'PRESSURE');
  // boss bar: brass pipe with red fluid
  if (boss && boss.entered) {
    const bw = 420, bx = W / 2 - bw / 2, by = 46;
    ctx.fillStyle = FX.brassPat; ctx.fillRect(bx - 6, by - 4, bw + 12, 18);
    ctx.fillStyle = '#1a0d05'; ctx.fillRect(bx, by, bw, 10);
    const g = ctx.createLinearGradient(0, by, 0, by + 10); g.addColorStop(0, '#ff7a3a'); g.addColorStop(1, '#8c1306');
    ctx.fillStyle = g; ctx.fillRect(bx, by, bw * Math.max(0, boss.hp / boss.maxHp), 10);
    plainText('IRON LEVIATHAN', W / 2, by + 30, 12);
  }
  if (bannerT > 0) {
    const a = Math.min(1, bannerT, (3 - bannerT) * 3);
    ctx.globalAlpha = a; ctx.fillStyle = 'rgba(20,10,4,0.55)'; ctx.fillRect(0, H / 2 - 40, W, 64); ctx.globalAlpha = a;
    plainText(bannerText, W / 2, H / 2 + 2, 28, bannerText.startsWith('WARNING') ? (Math.floor(bannerT * 6) % 2 ? '#ff5533' : '#ffd36b') : '#ffe2a0');
    ctx.globalAlpha = 1;
  }
  if (paused) { ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(0, 0, W, H); brassText('PAUSE', W / 2, H / 2, 56); }
}

function drawTitle() {
  ctx.fillStyle = 'rgba(25,12,4,0.35)'; ctx.fillRect(0, 0, W, H);
  drawGear(W / 2 - 300, 170, 70, 16, scrollX * 0.4, 'rgba(40,22,10,0.6)', null);
  drawGear(W / 2 + 310, 150, 50, 12, -scrollX * 0.6, 'rgba(40,22,10,0.6)', null);
  brassText('STEAM ARMADA', W / 2, 180, 78);
  plainText('— 蒸 気 艦 隊 —', W / 2, 228, 24, '#ffd896');
  const bob = Math.sin(scrollX * 2) * 6;
  drawSprite(IMG.player, null, W / 2, 310 + bob, 170, 0, Math.sin(scrollX * 1.3) * 0.05);
  if (Math.random() < 0.5) particles.push({ x: W / 2 - 80, y: 315 + bob, vx: rand(-120, -60), vy: rand(-10, 10), life: 0.8, max: 0.8, size: rand(8, 14), type: 'steam' });
  const blink = Math.floor(scrollX * 2) % 2 === 0;
  if (!audioUnlocked) { if (blink) plainText('PRESS ANY KEY', W / 2, 410, 24); }
  else if (blink) plainText('PRESS Z TO START', W / 2, 410, 24);
  plainText('移動: 矢印 / WASD   ショット: Z / Space   蒸気ボム: X   低速: Shift   ポーズ: P   消音: M', W / 2, 460, 14, '#f0d8a8');
  plainText('HI-SCORE ' + String(hiscore).padStart(8, '0'), W / 2, 500, 16, '#ffe9b0');
}

function drawGameOver() {
  ctx.fillStyle = `rgba(15,5,0,${Math.min(0.6, stateT * 0.4)})`; ctx.fillRect(0, 0, W, H);
  brassText('GAME OVER', W / 2, H / 2 - 10, 72);
  plainText('SCORE ' + score, W / 2, H / 2 + 40, 22);
  if (stateT > 2 && Math.floor(stateT * 2) % 2 === 0) plainText('PRESS Z', W / 2, H / 2 + 90, 20);
}

function render() {
  ctx.save();
  if (shake > 0) ctx.translate(rand(-shake, shake), rand(-shake, shake));
  drawBackground();
  if (state !== 'title') drawEntities();
  drawParticles();
  ctx.restore();
  // warm grade + vignette
  ctx.fillStyle = 'rgba(255,140,40,0.06)'; ctx.fillRect(0, 0, W, H);
  ctx.drawImage(FX.vignette, 0, 0);
  if (flashWhite > 0) { ctx.fillStyle = `rgba(255,245,225,${Math.min(1, flashWhite)})`; ctx.fillRect(0, 0, W, H); }
  if (state === 'title') drawTitle();
  else { drawHUD(); if (state === 'gameover') drawGameOver(); }
}

// ---------------------------------------------------------------- main loop
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.033, (now - last) / 1000); last = now;
  pollPad();
  if (pressed.KeyM && Audio.ready) { Audio.musicGain.gain.value = Audio.musicGain.gain.value > 0 ? 0 : Audio.musicVol; Audio.sfxGain.gain.value = Audio.sfxGain.gain.value > 0 ? 0 : Audio.sfxVol; }
  update(dt);
  shake = Math.max(0, shake - dt * 30); flashWhite = Math.max(0, flashWhite - dt * 1.5);
  render();
  for (const k in pressed) delete pressed[k];
  requestAnimationFrame(frame);
}

function fit() {
  const s = Math.min(innerWidth / W, innerHeight / H);
  canvas.style.width = W * s + 'px'; canvas.style.height = H * s + 'px';
}
addEventListener('resize', fit); fit();

ctx.fillStyle = '#1a0d05'; ctx.fillRect(0, 0, W, H);
ctx.fillStyle = '#f6dca0'; ctx.font = '24px serif'; ctx.textAlign = 'center'; ctx.fillText('Loading...', W / 2, H / 2);
loadImages().then(() => { prepareAssets(); state = 'title'; player = { lives: 3, bombs: 3, power: 1 }; requestAnimationFrame(frame); })
  .catch((e) => { ctx.fillText('画像の読み込みに失敗: ' + e.message, W / 2, H / 2 + 40); });
