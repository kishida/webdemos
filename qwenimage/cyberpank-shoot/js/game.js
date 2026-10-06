// OSTEOMORPH -骨の聖堂- : a biomechanical side-scrolling shooter (H.R. Giger style)
'use strict';

// ---------- canvas ----------
const cv = document.getElementById('c'), ctx = cv.getContext('2d');
const W = 960, H = 540;
function fit() {
  const s = Math.min(innerWidth / W, innerHeight / H);
  cv.style.width = (W * s) + 'px'; cv.style.height = (H * s) + 'px';
}
addEventListener('resize', fit); fit();

const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => v < a ? a : v > b ? b : v;

// ---------- images ----------
const IMGS = { far: { ok: false }, mid: { ok: false }, near: { ok: false }, title: { ok: false } };
let imgsSettled = 0;
function loadImg(obj, k, src) {
  const o = obj[k] = { ok: false }; const im = new Image();
  im.onload = () => { o.im = im; o.ok = true; imgsSettled++; };
  im.onerror = () => { o.ok = false; imgsSettled++; };
  im.src = src;
}
loadImg(IMGS, 'far', 'assets/bg_far.png');
loadImg(IMGS, 'mid', 'assets/bg_mid.png');
loadImg(IMGS, 'near', 'assets/bg_near.png');
loadImg(IMGS, 'title', 'assets/title.png');

// biomechanical creature sprites (black bg keyed to alpha in assets/sprites/).
// cx/cy = creature center inside the image, h = creature height as fraction of image height
const SPRDEF = {
  drone:   { f: 'en_drone.png',   h: 0.70, cx: 0.50, cy: 0.57 },
  spitter: { f: 'en_spitter.png', h: 0.93, cx: 0.49, cy: 0.51 },
  egg:     { f: 'en_egg.png',     h: 0.77, cx: 0.50, cy: 0.49 },
  pod:     { f: 'en_pod.png',     h: 0.93, cx: 0.50, cy: 0.48 },
  turret:  { f: 'en_turret.png',  h: 0.94, cx: 0.50, cy: 0.50 },
  carrier: { f: 'en_carrier.png', h: 0.36, cx: 0.50, cy: 0.44 },
  boss:    { f: 'en_boss.png',    cx: 0.28, cy: 0.52 },
  player:  { f: 'player.png',     h: 0.46, cx: 0.50, cy: 0.50 },
};
const SPR = {};
for (const k in SPRDEF) loadImg(SPR, k, 'assets/sprites/' + SPRDEF[k].f);

// ---------- overlays (grain / scanlines / vignette) ----------
const noiseCv = document.createElement('canvas'); noiseCv.width = 160; noiseCv.height = 90;
{
  const g = noiseCv.getContext('2d'), id = g.createImageData(160, 90);
  for (let i = 0; i < id.data.length; i += 4) {
    const v = Math.random() * 255 | 0;
    id.data[i] = id.data[i + 1] = id.data[i + 2] = v; id.data[i + 3] = 255;
  }
  g.putImageData(id, 0, 0);
}
const scanCv = document.createElement('canvas'); scanCv.width = 1; scanCv.height = 4;
{ const g = scanCv.getContext('2d'); g.fillStyle = 'rgba(0,0,0,0.20)'; g.fillRect(0, 3, 1, 1); }
let scanPat = null;
const vigCv = document.createElement('canvas'); vigCv.width = W; vigCv.height = H;
{
  const g = vigCv.getContext('2d');
  const rg = g.createRadialGradient(W / 2, H / 2, H * 0.42, W / 2, H / 2, H * 0.92);
  rg.addColorStop(0, 'rgba(0,0,0,0)'); rg.addColorStop(1, 'rgba(0,0,0,0.62)');
  g.fillStyle = rg; g.fillRect(0, 0, W, H);
}

// ---------- audio ----------
let songs = null, audioReady = false, curSongId = null;
async function audioInit() {
  try { await FM.init({ musicVoices: 14, sfxVoices: 10, echo: 0.25, echoTime: 0.28 }); }
  catch (e) { console.warn('audio init failed', e); return; }
  if (!songs) {
    songs = MUSIC.build(FM);
    FM.addPatches(songs.patches);
    for (const n in songs.sfx) FM.defineSfx(n, songs.sfx[n]);
    FM.setVolume({ music: 0.8, sfx: 0.9 });
    audioReady = true;
    if (state === 'title') playSong('title');
    else if (curSongId) playSong(curSongId);
  }
}
function playSong(id, mute) {
  curSongId = id;
  if (audioReady) FM.play(songs[id], { mute: mute || {} });
}
function sfx(name, opt) { if (audioReady) FM.play_sfx(name, opt); }

// ---------- state ----------
let state = 'boot';
let paused = false;
let time = 0, rdt = 0, scrollX = 0;
let stage = 1, wave = 0, waves = [], spawnQ = [], waveClock = 0, waveDoneT = 0;
let bossWarnT = -1, clearT = 0, overT = 0;
let score = 0, hi = 0;
try { hi = +localStorage.getItem('osteomorph_hi') || 0; } catch (e) { }
let shake = 0, flash = 0, flashCol = '230,230,235', slowT = 0;
let lightningT = rand(5, 12), bgFlash = 0;
let banner = { txt: '', t: 9 };
let hitSfxT = 0;

const bullets = [], ebullets = [], enemies = [], drops = [], parts = [], spores = [];
let floaters = [], rings = [];
let boss = null;

const player = {
  x: 170, y: 270, t: 0, fireT: 0, invuln: 2, shield: 0, wpn: 0, spine: 0,
  bombs: 2, lives: 3, dead: false, deadT: 0, smokeT: 0,
};
const WPN = [
  [[0, 0]],
  [[-7, 0], [7, 0]],
  [[-9, 0], [9, 0], [0, 0]],
  [[0, 0], [-8, -0.1], [8, 0.1], [-15, -0.3], [15, 0.3]],
];

// ---------- input ----------
const keys = {};
addEventListener('keydown', (e) => {
  if ([' ', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) e.preventDefault();
  if (!e.repeat) onPress(e.code);
  keys[e.code] = true;
});
addEventListener('keyup', (e) => { keys[e.code] = false; });
cv.addEventListener('pointerdown', () => onPress('KeyZ'));

function onPress(code) {
  if (!FM.ctx) audioInit();
  if (state === 'boot') state = 'title';
  if (code === 'KeyM') { if (FM.ctx) FM.toggleMute(); return; }
  if (code === 'KeyP' && (state === 'playing' || state === 'stageclear')) {
    paused = !paused;
    if (paused) FM.stop(true);
    else if (curSongId) playSong(curSongId, state === 'title' ? { lead: true } : {});
    return;
  }
  if (paused) return;
  const confirm = (code === 'KeyZ' || code === 'Enter' || code === 'Space');
  if (state === 'title' && confirm) startGame();
  else if (state === 'gameover' && confirm && overT > 1) startGame();
  else if (state === 'playing' && (code === 'KeyX' || code === 'KeyB')) useBomb();
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden && state === 'playing') { paused = true; FM.stop(true); }
});

// ---------- flow ----------
function startGame() {
  score = 0; stage = 1; boss = null; bossWarnT = -1;
  bullets.length = ebullets.length = enemies.length = drops.length = parts.length = floaters.length = rings.length = 0;
  Object.assign(player, { x: 170, y: 270, t: 0, fireT: 0, invuln: 2.2, shield: 0, wpn: 0, spine: 0, bombs: 2, lives: 3, dead: false, deadT: 0 });
  state = 'playing';
  startStage();
}
function startStage() {
  waves = buildWaves();
  wave = -1;
  setBanner('STAGE ' + stage);
  nextWave(2);
  playSong('stage');
}
function nextStage() {
  stage++;
  if (state !== 'playing') state = 'playing';
  startStage();
}
function nextWave(delay) {
  wave++;
  waveClock = -(delay || 0.8);
  waveDoneT = 0;
  if (wave >= 0 && wave < waves.length) {
    spawnQ = waves[wave].slice().sort((a, b) => a.at - b.at);
    if (wave > 0) sfx('select');
  }
}
function startBossWarn() {
  bossWarnT = 2.6;
  setBanner('W A R N I N G');
  sfx('warning');
}
function buildWaves() {
  return [
    [
      { at: 0.5, g: () => formation('drone', 5, 'sine') },
      { at: 7, g: () => formation('drone', 4, 'line') },
    ],
    [
      { at: 0.5, g: () => spawnE('spitter', 1010, 150) },
      { at: 2, g: () => spawnE('spitter', 1080, 400) },
      { at: 5.5, g: () => formation('drone', 5, 'sine') },
    ],
    [
      { at: 0.5, g: () => spawnE('pod', 1000, 300) },
      { at: 3, g: () => spawnE('turret', 1010, 160) },
      { at: 4, g: () => spawnE('turret', 1010, 400) },
      { at: 9, g: () => formation('drone', 6, 'sine') },
    ],
    [
      { at: 0.5, g: () => spawnE('carrier', 1080, 190) },
      { at: 4, g: () => formation('drone', 4, 'line') },
      { at: 10, g: () => spawnE('spitter', 1020, 430) },
      { at: 11, g: () => formation('drone', 4, 'sine') },
    ],
  ];
}
function formation(kind, n, mode) {
  for (let i = 0; i < n; i++) {
    const y = mode === 'line' ? clamp(150 + i * 80, 60, 480) : clamp(120 + i * (380 / n), 60, 480);
    spawnE(kind, 1010 + i * 62, y, { ax: 520 + Math.random() * 200 });
  }
}
function setBanner(txt) { banner = { txt, t: 0 }; }

// ---------- enemies ----------
const EDEF = {
  drone: { r: 15, hp: 3, score: 100, sp: 170 },
  egg: { r: 11, hp: 2, score: 60, sp: 240 },
  spitter: { r: 24, hp: 12, score: 250, sp: 130 },
  pod: { r: 26, hp: 20, score: 400, sp: 70 },
  turret: { r: 22, hp: 16, score: 300, sp: 90 },
  carrier: { r: 44, hp: 70, score: 1200, sp: 40 },
};
function spawnE(kind, x, y, opt = {}) {
  const d = EDEF[kind];
  enemies.push({
    kind, x, y, by: y, t: rand(0, 6), phase: rand(0, TAU), cd: rand(0.8, 1.8),
    blink: 0, dead: false, r: d.r, score: d.score, spawned: 0,
    hp: Math.ceil(d.hp * (1 + 0.3 * (stage - 1))),
    sp: d.sp * (1 + 0.08 * (stage - 1)),
    ax: opt.ax != null ? opt.ax : rand(620, 860),
  });
}
function eshot(x, y, ang, spd, kind) {
  ebullets.push({
    x, y, vx: Math.cos(ang) * spd, vy: Math.sin(ang) * spd, kind, t: 0, life: 9,
    r: kind === 'acid' ? 6 : kind === 'spore' ? 8 : 5,
  });
}
const aimAt = (x, y) => Math.atan2(player.y - y, player.x - x);

function updateEnemies(dt) {
  for (const e of enemies) {
    e.t += dt; e.blink = Math.max(0, e.blink - dt);
    switch (e.kind) {
      case 'drone':
        e.x -= e.sp * dt; e.y = e.by + Math.sin(e.t * 3 + e.phase) * 70; break;
      case 'egg':
        e.x -= e.sp * dt; e.y += clamp((player.y - e.y) * 2.2, -260, 260) * dt; break;
      case 'spitter':
        if (e.x > e.ax) e.x -= e.sp * dt; else e.y = e.by + Math.sin(e.t * 1.1 + e.phase) * 50;
        e.cd -= dt;
        if (e.x < 930 && e.cd <= 0 && !player.dead) {
          e.cd = rand(1.9, 2.7);
          eshot(e.x - 22, e.y, aimAt(e.x - 22, e.y), 210, 'acid');
          sfx('acid', { x: e.x });
        }
        break;
      case 'pod':
        if (e.x > e.ax) e.x -= e.sp * dt; else e.y = e.by + Math.sin(e.t) * 18;
        e.cd -= dt;
        if (e.cd <= 0) { e.cd = 2.6; spawnE('egg', e.x - 14, e.y + rand(-16, 16)); sfx('hatch', { x: e.x }); }
        break;
      case 'turret':
        if (e.x > e.ax) e.x -= e.sp * dt;
        e.cd -= dt;
        if (e.x < 930 && e.cd <= 0) {
          e.cd = 2.5;
          for (let i = 0; i < 8; i++) eshot(e.x - 8, e.y, (i / 8) * TAU + e.t * 0.5, 150, 'shard');
          sfx('spit', { x: e.x });
        }
        break;
      case 'carrier':
        e.x -= e.sp * dt; e.y = e.by + Math.sin(e.t * 0.6) * 40;
        e.cd -= dt;
        if (e.cd <= 0) { e.cd = 3.2; spawnE('drone', e.x - 10, e.y + rand(-30, 30)); sfx('hatch', { x: e.x }); }
        break;
    }
    if (e.x < -60 || e.y < -80 || e.y > H + 80) e.dead = true;
  }
}

function killEnemy(e, quiet) {
  e.dead = true;
  explode(e.x, e.y, e.r > 34 ? 'big' : 'small', quiet);
  addScore(e.score, e.x, e.y);
  maybeDrop(e);
}
function maybeDrop(e) {
  let n = 0;
  if (e.kind === 'spitter') n = Math.random() < 0.3 ? 1 : 0;
  else if (e.kind === 'pod' || e.kind === 'turret') n = Math.random() < 0.4 ? 1 : 0;
  else if (e.kind === 'carrier') n = 2;
  else n = Math.random() < 0.06 ? 1 : 0;
  for (let i = 0; i < n; i++) drops.push({ x: e.x, y: e.y + i * 18, t: 0, kind: pickDrop() });
}
function pickDrop() {
  const r = Math.random();
  if (r < 0.34) return 'gun';
  if (r < 0.46) return 'spine';
  if (r < 0.60) return 'shield';
  if (r < 0.74) return 'bomb';
  if (r < 0.78 && player.lives < 5) return 'life';
  return 'score';
}
function applyDrop(d) {
  if (d.kind === 'gun') { player.wpn = Math.min(3, player.wpn + 1); sfx('powerup'); }
  else if (d.kind === 'spine') { player.spine = Math.min(2, player.spine + 1); sfx('extend'); }
  else if (d.kind === 'shield') { player.shield = Math.min(2, player.shield + 1); sfx('coin'); }
  else if (d.kind === 'bomb') { player.bombs = Math.min(5, player.bombs + 1); sfx('coin'); }
  else if (d.kind === 'life') { player.lives++; sfx('extend'); }
  else { addScore(500, d.x, d.y); sfx('coin'); }
  rings.push({ x: d.x, y: d.y, r0: 6, r1: 46, t: 0, life: 0.4, col: '200,210,140' });
}

// ---------- boss ----------
function spawnBoss() {
  boss = {
    x: 1150, y: 270, t: 0, blink: 0, state: 'enter',
    hp: 520 + 260 * stage, maxhp: 520 + 260 * stage,
    atkT: 2.4, cyc: 0, phase: 1, pend: [],
    dt2: 0, nextExpT: 0.2, dashT: 0, dashSt: 0,
  };
  playSong('boss');
}
function bossAttack(b) {
  b.cyc++;
  const p2 = b.phase === 2;
  const n = p2 ? 6 : 5;
  const k = b.cyc % n;
  const mx = b.x - 85, my = b.y + 38;
  if (k === 0) {
    const a0 = aimAt(mx, my);
    for (let i = -3; i <= 3; i++) eshot(mx, my, a0 + i * 0.16, 200, 'acid');
    sfx('acid');
  } else if (k === 1) {
    for (let i = 0; i < 3; i++) b.pend.push({
      t: 0.02 + i * 0.14, fn: () => { if (boss === b && b.state === 'fight') { eshot(mx, my, aimAt(mx, my), 330, 'acid'); sfx('spit'); } },
    });
  } else if (k === 2) {
    for (let i = 0; i < 14; i++) eshot(mx, my, (i / 14) * TAU + b.t, 160, 'shard');
    sfx('spit');
  } else if (k === 3) {
    const a0 = aimAt(mx, my);
    eshot(mx, my, a0 - 0.3, 115, 'spore'); eshot(mx, my, a0 + 0.3, 115, 'spore');
    sfx('acid');
  } else if (k === 4) {
    spawnE('drone', b.x - 40, b.y - 50); spawnE('drone', b.x - 40, b.y + 50);
    const a0 = aimAt(mx, my);
    for (let i = -1; i <= 1; i++) eshot(mx, my, a0 + i * 0.16, 210, 'acid');
    sfx('hatch');
  } else if (k === 5) {
    b.state = 'dash'; b.dashT = 0; b.dashSt = 0;
    sfx('jaw'); shake = Math.max(shake, 6);
  }
  b.atkT = (p2 ? 1.5 : 2.0) * rand(0.85, 1.15);
}
function updateBoss(dt) {
  const b = boss; if (!b) return;
  b.t += dt; b.blink = Math.max(0, b.blink - dt);
  for (const p of b.pend) { p.t -= dt; if (p.t <= 0 && !p.done) { p.done = true; p.fn(); } }
  b.pend = b.pend.filter((p) => !p.done);
  if (b.state === 'enter') {
    b.x -= 120 * dt;
    if (b.x <= 780) { b.x = 780; b.state = 'fight'; }
  } else if (b.state === 'fight') {
    b.y = 270 + Math.sin(b.t * 0.7) * 70;
    b.atkT -= dt;
    if (b.atkT <= 0) bossAttack(b);
    if (!player.dead && player.invuln <= 0 && Math.hypot(player.x - (b.x - 30), player.y - b.y) < 84) hitPlayer();
  } else if (b.state === 'dash') {
    b.dashT += dt;
    if (b.dashSt === 0) { b.x -= 950 * dt; if (b.x <= 260) { b.dashSt = 1; b.dashT = 0; } }
    else if (b.dashSt === 1) { if (b.dashT > 0.5) { b.dashSt = 2; } }
    else { b.x += 480 * dt; if (b.x >= 780) { b.x = 780; b.state = 'fight'; } }
    if (!player.dead && player.invuln <= 0 && Math.hypot(player.x - (b.x - 30), player.y - b.y) < 88) hitPlayer();
  } else if (b.state === 'dying') {
    b.dt2 += dt;
    if (b.dt2 > b.nextExpT) {
      b.nextExpT += 0.22;
      explode(b.x + rand(-80, 60), b.y + rand(-60, 60), Math.random() < 0.4 ? 'big' : 'small', true);
      sfx(Math.random() < 0.5 ? 'explosion' : 'bigexplosion', { x: b.x - 400 });
      shake = Math.max(shake, 7);
    }
    if (b.dt2 > 2.4) finishBoss();
  }
}
function damageBoss(n) {
  const b = boss; if (!b || b.state === 'dying') return;
  b.hp -= n; b.blink = 0.08;
  if (b.phase === 1 && b.hp < b.maxhp * 0.5) {
    b.phase = 2; sfx('roar'); shake = 9; flash = 0.3; flashCol = '190,120,70';
    const mx = b.x - 85, my = b.y + 38, a0 = aimAt(mx, my);
    for (let i = -4; i <= 4; i++) eshot(mx, my, a0 + i * 0.2, 220, 'acid');
  }
  if (b.hp <= 0) {
    b.hp = 0; b.state = 'dying'; b.dt2 = 0; b.nextExpT = 0.15;
    ebullets.length = 0;
    sfx('bigexplosion'); shake = 12; flash = 0.5;
    addScore(10000 * stage, b.x - 60, b.y - 80);
  }
}
function finishBoss() {
  boss = null;
  state = 'stageclear'; clearT = 0;
  setBanner('STAGE CLEAR');
  FM.stop();
  playSong('clear');
  saveHi();
}

// ---------- player ----------
function fire() {
  const p = player;
  for (const [dy, a] of WPN[p.wpn]) {
    bullets.push({ x: p.x + 34, y: p.y + dy, vx: Math.cos(a) * 780, vy: Math.sin(a) * 780 });
  }
  for (let i = 0; i < p.spine; i++) {
    const a = p.t * 5 + i * Math.PI;
    bullets.push({ x: p.x - 30 + Math.cos(a) * 36, y: p.y + Math.sin(a) * 36, vx: 760, vy: 0 });
  }
  parts.push({ type: 'goo', x: p.x + 34, y: p.y, vx: 120, vy: 0, r: 2, life: 0.15, t: 0, col: '220,215,190' });
  sfx('shot', { x: p.x + 40 });
}
function useBomb() {
  const p = player;
  if (p.bombs <= 0 || p.dead) return;
  p.bombs--;
  flash = 0.55; flashCol = '225,228,235'; shake = 11; slowT = 0.9;
  sfx('bomb');
  rings.push({ x: p.x, y: p.y, r0: 10, r1: 900, t: 0, life: 0.7, col: '225,228,235' });
  ebullets.length = 0;
  for (const e of enemies) if (!e.dead) killEnemy(e, true);
  if (boss && (boss.state === 'fight' || boss.state === 'dash')) damageBoss(90);
}
function hitPlayer() {
  const p = player;
  if (p.dead || p.invuln > 0 || state !== 'playing') return;
  if (p.shield > 0) {
    p.shield--; p.invuln = 1.2; shake = 5; flash = 0.25; flashCol = '200,190,150';
    sfx('damage');
    return;
  }
  p.dead = true; p.deadT = 1.8; p.lives--; p.wpn = 0; p.spine = 0;
  explode(p.x, p.y, 'big'); sfx('bigexplosion');
  shake = 12; flash = 0.45; flashCol = '190,110,90';
}
function updatePlayer(dt) {
  const p = player;
  p.t += dt;
  if (p.dead) {
    p.deadT -= dt;
    if (p.deadT <= 0) {
      if (p.lives < 0) gameOver();
      else {
        Object.assign(p, { x: 170, y: 270, dead: false, invuln: 2.2 });
        sfx('jump');
      }
    }
    return;
  }
  const focus = keys['ShiftLeft'] || keys['ShiftRight'];
  const spd = focus ? 150 : 330;
  let dx = (keys['ArrowRight'] || keys['KeyD'] ? 1 : 0) - (keys['ArrowLeft'] || keys['KeyA'] ? 1 : 0);
  let dy = (keys['ArrowDown'] || keys['KeyS'] ? 1 : 0) - (keys['ArrowUp'] || keys['KeyW'] ? 1 : 0);
  if (dx && dy) { dx *= 0.7071; dy *= 0.7071; }
  p.x = clamp(p.x + dx * spd * dt, 36, 700);
  p.y = clamp(p.y + dy * spd * dt, 26, 514);
  p.invuln -= dt;
  p.fireT -= dt;
  if ((keys['KeyZ'] || keys['Space'] || keys['Enter']) && p.fireT <= 0) { fire(); p.fireT = 0.115; }
  p.smokeT -= dt;
  if (p.smokeT <= 0) {
    p.smokeT = 0.05;
    parts.push({ type: 'smoke', x: p.x - 30, y: p.y + rand(-4, 4), vx: rand(-100, -60), vy: rand(-8, 8), r: rand(2, 4), life: 0.55, t: 0 });
  }
}
function gameOver() {
  state = 'gameover'; overT = 0;
  FM.stop(); playSong('over');
  saveHi();
}
function saveHi() {
  if (score > hi) { hi = score; try { localStorage.setItem('osteomorph_hi', String(hi)); } catch (e) { } }
}

// ---------- fx helpers ----------
function addScore(n, x, y) {
  score += n;
  if (x != null) floaters.push({ x, y, txt: '+' + n, t: 0, life: 0.9 });
}
function explode(x, y, size, quiet) {
  const big = size === 'big';
  shake = Math.max(shake, big ? 9 : 4);
  rings.push({ x, y, r0: 6, r1: big ? 110 : 55, t: 0, life: 0.45, col: '215,205,180' });
  if (!quiet) sfx(big ? 'bigexplosion' : 'explosion', { x });
  const n = big ? 22 : 12;
  for (let i = 0; i < n; i++) {
    const a = rand(0, TAU), s = rand(40, big ? 320 : 200);
    parts.push({ type: 'splint', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, ang: rand(0, TAU), va: rand(-8, 8), r: rand(3, big ? 9 : 6), life: rand(0.4, 0.8), t: 0 });
  }
  for (let i = 0; i < (big ? 14 : 8); i++) {
    const a = rand(0, TAU), s = rand(20, big ? 220 : 140);
    parts.push({ type: 'goo', x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, r: rand(2, 5), life: rand(0.5, 1), t: 0, col: '150,160,70' });
  }
}

// ---------- update ----------
function update(rdt_) {
  rdt = rdt_; time += rdt_;
  scrollX += 46 * rdt_;
  lightningT -= rdt_;
  if (lightningT <= 0) { lightningT = rand(6, 14); bgFlash = 0.8; }
  bgFlash = Math.max(0, bgFlash - rdt_ * 2.2);

  if (state === 'boot' && (imgsSettled >= Object.keys(IMGS).length + Object.keys(SPRDEF).length || time > 2.5)) state = 'title';
  if (state === 'title' && !paused) return;
  if (paused) return;

  slowT -= rdt_;
  const dt = rdt_ * (slowT > 0 ? 0.35 : 1);

  updateBGParticles(dt);
  updateParts(dt);
  floaters = floaters.filter((f) => (f.t += dt) < f.life);
  rings = rings.filter((r) => (r.t += dt) < r.life);
  banner.t += rdt_;
  flash = Math.max(0, flash - rdt_ * 2.2);
  shake = Math.max(0, shake - rdt_ * 22);

  if (state === 'stageclear') {
    updateEnemies(dt); updateEbullets(dt);
    clearT += rdt_;
    if (clearT > 3.6) nextStage();
    return;
  }
  if (state === 'gameover') { overT += rdt_; return; }
  if (state !== 'playing') return;

  updatePlayer(dt);
  updateEnemies(dt);
  updateBoss(dt);

  // wave director
  if (!boss && bossWarnT < 0) {
    waveClock += dt;
    while (spawnQ.length && spawnQ[0].at <= waveClock) { spawnQ.shift().g(); }
    if (!spawnQ.length && !enemies.length && waveClock > 2) {
      waveDoneT += dt;
      if (waveDoneT > 1.4) {
        waveDoneT = 0;
        addScore(500 * stage, 480, 200);
        if (Math.random() < 0.8) drops.push({ x: 980, y: rand(120, 420), t: 0, kind: pickDrop() });
        if (wave >= waves.length - 1) startBossWarn();
        else nextWave();
      }
    }
  }
  if (bossWarnT > 0) {
    bossWarnT -= rdt_;
    if (bossWarnT <= 0) { bossWarnT = -1; spawnBoss(); }
  }

  // bullets
  for (const b of bullets) { b.x += b.vx * dt; b.y += b.vy * dt; }
  for (const b of bullets) {
    if (b.dead) continue;
    if (boss && (boss.state === 'fight' || boss.state === 'dash')) {
      if (Math.hypot(b.x - (boss.x - 26), b.y - boss.y + 8) < 74) { b.dead = true; damageBoss(1); gooHit(b.x, b.y); continue; }
    }
    for (const e of enemies) {
      if (e.dead) continue;
      if (Math.hypot(b.x - e.x, b.y - e.y) < e.r + 5) {
        b.dead = true; e.hp--; e.blink = 0.08; gooHit(b.x, b.y);
        if (time - hitSfxT > 0.06) { sfx('hit', { x: e.x }); hitSfxT = time; }
        if (e.hp <= 0) killEnemy(e);
        break;
      }
    }
  }
  for (let i = bullets.length - 1; i >= 0; i--) if (bullets[i].dead || bullets[i].x > W + 40) bullets.splice(i, 1);

  updateEbullets(dt);

  // enemy bodies vs player / drops
  const p = player;
  for (const e of enemies) {
    if (e.dead || p.dead || p.invuln > 0) continue;
    if (Math.hypot(p.x - e.x, p.y - e.y) < e.r + 9) {
      hitPlayer();
      if (e.kind !== 'carrier') { e.dead = true; explode(e.x, e.y, 'small', true); }
    }
  }
  for (const d of drops) {
    d.t += dt; d.x -= 70 * dt; d.y += Math.sin(d.t * 2) * 24 * dt;
    if (!p.dead && Math.hypot(p.x - d.x, p.y - d.y) < 22) { d.dead = true; applyDrop(d); }
  }
  for (let i = drops.length - 1; i >= 0; i--) if (drops[i].dead || drops[i].x < -30) drops.splice(i, 1);
  for (let i = enemies.length - 1; i >= 0; i--) if (enemies[i].dead) enemies.splice(i, 1);
}
function gooHit(x, y) {
  if (parts.length > 420) return;
  for (let i = 0; i < 2; i++) {
    const a = rand(0, TAU);
    parts.push({ type: 'goo', x, y, vx: Math.cos(a) * 60, vy: Math.sin(a) * 60 - 30, r: rand(1.5, 3), life: 0.3, t: 0, col: '190,195,150' });
  }
}
function updateEbullets(dt) {
  const p = player;
  for (const b of ebullets) {
    b.t += dt;
    if (b.kind === 'spore') {
      const a = Math.atan2(b.vy, b.vx);
      const ta = aimAt(b.x, b.y);
      let d = ta - a;
      while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU;
      const na = a + clamp(d, -1.4 * dt, 1.4 * dt);
      b.vx = Math.cos(na) * 115; b.vy = Math.sin(na) * 115;
    }
    b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
    if (b.x < -60 || b.x > W + 60 || b.y < -60 || b.y > H + 60 || b.life <= 0) b.dead = true;
    if (!b.dead && !p.dead && p.invuln <= 0 && state === 'playing' &&
      Math.hypot(p.x - b.x, p.y - b.y) < b.r + 5) { b.dead = true; hitPlayer(); }
  }
  for (let i = ebullets.length - 1; i >= 0; i--) if (ebullets[i].dead) ebullets.splice(i, 1);
}

// bg spores
for (let i = 0; i < 70; i++) spores.push({ x: Math.random() * W, y: Math.random() * H, z: rand(0.2, 1), r: rand(0.6, 2.2), ph: rand(0, TAU) });
function updateBGParticles(dt) {
  for (const s of spores) {
    s.x -= (12 + 60 * s.z) * dt * (state === 'playing' ? 1 : 0.4);
    s.y += Math.sin(time * 0.6 + s.ph) * 6 * dt;
    if (s.x < -4) { s.x = W + 4; s.y = Math.random() * H; }
  }
}
function updateParts(dt) {
  for (const q of parts) {
    q.t += dt; q.x += q.vx * dt; q.y += q.vy * dt;
    if (q.type === 'smoke') { q.vx *= (1 - dt); }
    else { q.vx *= (1 - dt * 1.5); q.vy = q.vy * (1 - dt * 1.5) + 60 * dt; }
    if (q.va) q.ang += q.va * dt;
  }
  for (let i = parts.length - 1; i >= 0; i--) if (parts[i].t >= parts[i].life) parts.splice(i, 1);
}

// ---------- render ----------
function txt(s, x, y, size, col, alpha = 1, ls = '2px', align = 'left') {
  ctx.save();
  ctx.globalAlpha = alpha; ctx.fillStyle = col;
  ctx.font = size + 'px "Yu Mincho","MS PMincho",Georgia,serif';
  if ('letterSpacing' in ctx) ctx.letterSpacing = ls;
  ctx.textAlign = align;
  ctx.fillText(s, x, y);
  ctx.restore();
}
function drawLayer(k, speed, y, alpha) {
  const o = IMGS[k];
  if (!o.ok) return false;
  const dw = 1408, dh = 768;
  const off = -((scrollX * speed) % dw) - dw;
  ctx.save();
  if (k !== 'far') ctx.globalCompositeOperation = 'screen';
  ctx.globalAlpha = alpha;
  for (let x = off; x < W; x += dw) ctx.drawImage(o.im, x, y, dw, dh);
  ctx.restore();
  return true;
}
function render() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#04050a'; ctx.fillRect(0, 0, W, H);
  if (state === 'title') { renderTitle(); postFX(); return; }

  const sh = shake > 0 ? shake : 0;
  ctx.save();
  if (sh > 0) ctx.translate(rand(-sh, sh) * 0.5, rand(-sh, sh) * 0.5);

  if (!drawLayer('far', 0.18, -170, 1)) {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#0b0d14'); g.addColorStop(1, '#05060a');
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  }
  if (bgFlash > 0) { ctx.fillStyle = 'rgba(200,205,220,' + (bgFlash * 0.10) + ')'; ctx.fillRect(0, 0, W, H); }
  drawLayer('mid', 0.45, -190, 0.95);
  // bg spores
  ctx.save();
  for (const s of spores) {
    ctx.fillStyle = 'rgba(180,175,160,' + (0.10 + 0.14 * s.z) + ')';
    ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, TAU); ctx.fill();
  }
  ctx.restore();
  drawDrops();
  drawEnemies();
  if (boss) drawBoss();
  drawEbullets();
  drawBullets();
  drawParts();
  drawRings();
  if (!(player.dead) && state !== 'stageclear' || state === 'stageclear') drawPlayer();
  drawNear();
  ctx.restore();

  // bottom fog
  const fg = ctx.createLinearGradient(0, H - 130, 0, H);
  fg.addColorStop(0, 'rgba(4,5,10,0)'); fg.addColorStop(1, 'rgba(4,5,10,0.6)');
  ctx.fillStyle = fg; ctx.fillRect(0, H - 130, W, 130);

  drawHUD();
  if (flash > 0) { ctx.fillStyle = 'rgba(' + flashCol + ',' + (flash * 0.65) + ')'; ctx.fillRect(0, 0, W, H); }
  if (banner.t < 2.2 && state === 'playing') {
    const a = banner.t < 0.25 ? banner.t / 0.25 : banner.t > 1.6 ? (2.2 - banner.t) / 0.6 : 1;
    txt(banner.txt, W / 2, 210, 40, '#d8d2c2', Math.max(0, a), '14px', 'center');
  }
  if (state === 'stageclear') {
    ctx.fillStyle = 'rgba(2,3,6,0.35)'; ctx.fillRect(0, 0, W, H);
    txt('STAGE CLEAR', W / 2, 250, 44, '#d8d2c2', 1, '16px', 'center');
    txt('NEXT STAGE APPROACHING', W / 2, 292, 15, '#8f8a7c', 0.8, '6px', 'center');
  }
  if (state === 'gameover') renderGameOver();
  if (paused) {
    ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(0, 0, W, H);
    txt('P A U S E D', W / 2, 265, 36, '#d8d2c2', 1, '10px', 'center');
    txt('P で再開', W / 2, 300, 15, '#8f8a7c', 0.8, '3px', 'center');
  }
  postFX();
}
function drawHUD() {
  txt('SCORE ' + String(score).padStart(7, '0'), 16, 26, 16, '#ddd7c6', 0.95, '3px');
  txt('HI ' + String(Math.max(hi, score)).padStart(7, '0'), 16, 44, 11, '#8f8a7c', 0.75, '3px');
  // lives
  for (let i = 0; i < Math.min(6, Math.max(0, player.lives)); i++) {
    const x = 22 + i * 20, y = 62;
    ctx.save(); ctx.translate(x, y);
    ctx.fillStyle = '#cfc9b8';
    ctx.beginPath(); ctx.arc(0, -1, 6, 0, TAU); ctx.fill();
    ctx.fillRect(-3, 3, 6, 4);
    ctx.fillStyle = '#14151a';
    ctx.beginPath(); ctx.arc(-2.2, -1.5, 1.6, 0, TAU); ctx.arc(2.2, -1.5, 1.6, 0, TAU); ctx.fill();
    ctx.restore();
  }
  // bombs
  for (let i = 0; i < player.bombs; i++) {
    ctx.fillStyle = '#c9a15a';
    ctx.beginPath(); ctx.ellipse(150 + i * 14, 62, 4.5, 6.5, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#14151a';
    ctx.fillRect(150 + i * 14 - 4.5, 60.5, 9, 1.4);
  }
  // shield
  if (player.shield > 0) txt('SHIELD ' + '▮'.repeat(player.shield), 240, 66, 12, '#bcd2e8', 0.9, '2px');
  // weapon
  txt('GUN ' + '▮'.repeat(player.wpn + 1) + '▯'.repeat(3 - player.wpn) + (player.spine ? '  SPINE x' + player.spine : ''), W - 16, 26, 12, '#a89f8b', 0.85, '2px', 'right');
  txt('STAGE ' + stage + '  WAVE ' + (boss ? 'BOSS' : Math.min(wave + 1, waves.length || 4) + '/' + (waves.length || 4)), W - 16, 46, 12, '#8f8a7c', 0.85, '2px', 'right');
}
function postFX() {
  if (!scanPat) scanPat = ctx.createPattern(scanCv, 'repeat');
  ctx.save();
  ctx.globalAlpha = 0.06;
  ctx.drawImage(noiseCv, -rand(0, 80) | 0, -rand(0, 45) | 0, W + 160, H + 90);
  ctx.globalAlpha = 1;
  ctx.fillStyle = scanPat; ctx.fillRect(0, 0, W, H);
  ctx.drawImage(vigCv, 0, 0);
  ctx.restore();
}
function renderTitle() {
  const o = IMGS.title;
  if (o.ok) {
    const z = 1.06 + 0.02 * Math.sin(time * 0.12);
    const dw = W * z * 1.12, dh = dw * (o.im.height / o.im.width);
    ctx.drawImage(o.im, (W - dw) / 2 + Math.sin(time * 0.1) * 12, (H - dh) / 2 + 26, dw, dh);
  }
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, 'rgba(2,3,6,0.72)'); g.addColorStop(0.45, 'rgba(2,3,6,0.18)'); g.addColorStop(1, 'rgba(2,3,6,0.86)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

  ctx.save();
  ctx.shadowColor = 'rgba(210,170,110,0.35)'; ctx.shadowBlur = 22;
  txt('OSTEOMORPH', W / 2, 128, 58, '#ddd7c6', 1, '20px', 'center');
  ctx.restore();
  txt('— 骨 の 聖 堂 —', W / 2, 166, 17, '#a89f8b', 0.9, '10px', 'center');
  txt('BIOMECHANICAL SIDE-SCROLLING SHOOTER', W / 2, 192, 11, '#6e695e', 0.8, '4px', 'center');

  if (((time * 1.6) | 0) % 2 === 0) txt('PRESS  Z / ENTER', W / 2, 428, 20, '#d8d2c2', 1, '8px', 'center');
  txt('←↑→↓ 移動　Z/SPACE 射撃　X ボム　SHIFT 集中　P ポーズ　M ミュート', W / 2, 472, 13, '#8f8a7c', 0.85, '2px', 'center');
  txt('HI-SCORE ' + String(hi).padStart(7, '0'), W / 2, 500, 13, '#8f8a7c', 0.85, '3px', 'center');
}
function renderGameOver() {
  ctx.fillStyle = 'rgba(2,2,5,0.66)'; ctx.fillRect(0, 0, W, H);
  txt('GAME OVER', W / 2, 220, 46, '#c9b8a8', 1, '14px', 'center');
  txt('REACHED STAGE ' + stage, W / 2, 258, 15, '#8f8a7c', 0.9, '4px', 'center');
  txt('SCORE ' + String(score).padStart(7, '0'), W / 2, 290, 17, '#d8d2c2', 1, '4px', 'center');
  txt('HI-SCORE ' + String(hi).padStart(7, '0'), W / 2, 314, 14, '#8f8a7c', 0.9, '3px', 'center');
  if (overT > 1 && ((time * 1.6) | 0) % 2 === 0) txt('PRESS Z - REBIRTH', W / 2, 380, 17, '#d8d2c2', 1, '6px', 'center');
}

// ---------- draw entities ----------
function drawBullets() {
  for (const b of bullets) {
    const a = Math.atan2(b.vy, b.vx);
    ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(a);
    ctx.fillStyle = 'rgba(235,228,205,0.25)';
    ctx.beginPath(); ctx.moveTo(16, 0); ctx.quadraticCurveTo(0, -5, -10, 0); ctx.quadraticCurveTo(0, 5, 16, 0); ctx.fill();
    ctx.fillStyle = '#efe9d8';
    ctx.beginPath(); ctx.moveTo(10, 0); ctx.quadraticCurveTo(0, -2.4, -6, 0); ctx.quadraticCurveTo(0, 2.4, 10, 0); ctx.fill();
    ctx.restore();
  }
}
function drawEbullets() {
  for (const b of ebullets) {
    ctx.save(); ctx.translate(b.x, b.y);
    if (b.kind === 'acid') {
      ctx.fillStyle = 'rgba(170,182,70,0.25)'; ctx.beginPath(); ctx.arc(0, 0, 9, 0, TAU); ctx.fill();
      ctx.fillStyle = '#aeb84a'; ctx.beginPath(); ctx.arc(0, 0, 5, 0, TAU); ctx.fill();
      ctx.fillStyle = '#4d521c'; ctx.beginPath(); ctx.arc(-1, -1, 2.2, 0, TAU); ctx.fill();
    } else if (b.kind === 'shard') {
      ctx.rotate(Math.atan2(b.vy, b.vx));
      ctx.fillStyle = '#cfc9b8';
      ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(0, -3); ctx.lineTo(-6, 0); ctx.lineTo(0, 3); ctx.closePath(); ctx.fill();
    } else {
      const pu = 1 + 0.15 * Math.sin(b.t * 12);
      ctx.fillStyle = 'rgba(160,175,80,0.22)'; ctx.beginPath(); ctx.arc(0, 0, 12 * pu, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#8d9640'; ctx.lineWidth = 1;
      for (let i = 0; i < 6; i++) {
        const a = b.t * 3 + i * TAU / 6;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * 10 * pu, Math.sin(a) * 10 * pu); ctx.stroke();
      }
      ctx.fillStyle = '#c3cd63'; ctx.beginPath(); ctx.arc(0, 0, 5, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }
}
function drawDrops() {
  const GLYPH = { gun: 'G', spine: 'S', shield: 'D', bomb: 'B', life: 'L', score: '+' };
  for (const d of drops) {
    const pu = 1 + 0.1 * Math.sin(d.t * 6);
    ctx.save(); ctx.translate(d.x, d.y);
    ctx.fillStyle = 'rgba(190,200,120,0.16)'; ctx.beginPath(); ctx.arc(0, 0, 15 * pu, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(16,18,14,0.85)';
    ctx.beginPath(); ctx.arc(0, 0, 11, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#b7b19d'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(0, 0, 11, 0, TAU); ctx.stroke();
    ctx.fillStyle = '#d8d2c2'; ctx.font = 'bold 11px Georgia,serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(GLYPH[d.kind], 0, 1);
    ctx.restore();
  }
}
function drawParts() {
  for (const q of parts) {
    const a = 1 - q.t / q.life;
    if (q.type === 'smoke') ctx.fillStyle = 'rgba(110,106,96,' + (a * 0.22) + ')';
    else if (q.type === 'goo') { const c = q.col || '150,160,70'; ctx.fillStyle = 'rgba(' + c + ',' + a + ')'; }
    else continue;
    ctx.beginPath(); ctx.arc(q.x, q.y, q.r * (q.type === 'smoke' ? 1 + q.t * 2 : a + 0.3), 0, TAU); ctx.fill();
  }
  ctx.strokeStyle = 'rgba(210,203,182,0.9)'; ctx.lineWidth = 1.5;
  for (const q of parts) {
    if (q.type !== 'splint') continue;
    const a = 1 - q.t / q.life;
    ctx.save(); ctx.globalAlpha = a; ctx.translate(q.x, q.y); ctx.rotate(q.ang);
    ctx.beginPath(); ctx.moveTo(-q.r, 0); ctx.lineTo(q.r, 0); ctx.stroke();
    ctx.restore();
  }
}
function drawRings() {
  for (const r of rings) {
    const k = r.t / r.life;
    ctx.strokeStyle = 'rgba(' + r.col + ',' + (0.7 * (1 - k)) + ')';
    ctx.lineWidth = 3 * (1 - k) + 0.5;
    ctx.beginPath(); ctx.arc(r.x, r.y, r.r0 + (r.r1 - r.r0) * k, 0, TAU); ctx.stroke();
  }
}
function drawPlayer() {
  const p = player;
  if (p.dead) return;
  if (p.invuln > 0 && ((p.invuln * 14) | 0) % 2 === 0) return;
  const pulse = 1 + 0.04 * Math.sin(p.t * 9);
  ctx.save(); ctx.translate(p.x, p.y); ctx.scale(1, pulse);
  // tail flame
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = 'rgba(215,180,120,' + (0.25 + 0.15 * Math.sin(p.t * 30)) + ')';
  ctx.beginPath(); ctx.moveTo(-24, -4); ctx.lineTo(-46 - rand(0, 8), 0); ctx.lineTo(-24, 4); ctx.closePath(); ctx.fill();
  ctx.restore();
  const sp = SPR.player;
  if (sp && sp.ok) {
    const im = sp.im, sh = 30 / SPRDEF.player.h, sw = sh * (im.width / im.height);
    addGlow(0, 0, Math.max(sw, sh) * 0.6, '0,0,0', 0.42);
    ctx.drawImage(im, -SPRDEF.player.cx * sw, -SPRDEF.player.cy * sh, sw, sh);
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.14;
    ctx.drawImage(im, -SPRDEF.player.cx * sw, -SPRDEF.player.cy * sh, sw, sh);
    ctx.restore();
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    addGlow(6, -2, 9, '240,190,110', 0.5 + 0.12 * Math.sin(p.t * 7));
    ctx.restore();
  } else {
    // wings
    ctx.fillStyle = '#55524a';
    ctx.beginPath(); ctx.moveTo(-8, -8); ctx.lineTo(4, -21); ctx.lineTo(11, -7); ctx.closePath(); ctx.fill();
    ctx.beginPath(); ctx.moveTo(-8, 8); ctx.lineTo(4, 21); ctx.lineTo(11, 7); ctx.closePath(); ctx.fill();
    // body
    const g = ctx.createLinearGradient(0, -12, 0, 12);
    g.addColorStop(0, '#dcd6c6'); g.addColorStop(0.5, '#948f80'); g.addColorStop(1, '#4c4a43');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(34, 0);
    ctx.bezierCurveTo(12, -12, -12, -14, -30, -8);
    ctx.lineTo(-34, 0); ctx.lineTo(-30, 8);
    ctx.bezierCurveTo(-12, 14, 12, 12, 34, 0);
    ctx.fill();
    ctx.strokeStyle = '#0b0c0f'; ctx.lineWidth = 1.4; ctx.stroke();
    // ribs
    ctx.strokeStyle = 'rgba(30,31,36,0.75)'; ctx.lineWidth = 1;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath(); ctx.arc(6 - i * 11, 0, 7, -Math.PI / 2, Math.PI / 2); ctx.stroke();
    }
    // cockpit
    ctx.fillStyle = 'rgba(235,190,110,0.9)';
    ctx.beginPath(); ctx.ellipse(8, 0, 5.5, 3.2, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(235,190,110,0.25)';
    ctx.beginPath(); ctx.ellipse(8, 0, 9, 5.5, 0, 0, TAU); ctx.fill();
  }
  ctx.restore();
  // spines (options)
  for (let i = 0; i < p.spine; i++) {
    const a = p.t * 5 + i * Math.PI;
    const sx = p.x - 30 + Math.cos(a) * 36, sy = p.y + Math.sin(a) * 36;
    ctx.save(); ctx.translate(sx, sy); ctx.rotate(a);
    ctx.fillStyle = '#cfc9b8';
    ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(0, -4); ctx.lineTo(-7, 0); ctx.lineTo(0, 4); ctx.closePath(); ctx.fill();
    ctx.restore();
  }
  // shield
  if (p.shield > 0) {
    ctx.strokeStyle = 'rgba(190,210,235,' + (0.25 + 0.1 * Math.sin(time * 7)) + ')';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(p.x, p.y, 24 + p.shield * 3, 0, TAU); ctx.stroke();
  }
  // focus hitbox
  if (keys['ShiftLeft'] || keys['ShiftRight']) {
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(p.x, p.y, 2.4, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(p.x, p.y, 7, 0, TAU); ctx.stroke();
  }
}
// per-kind creature height on screen (px), idle sway, ambient glow, eye glint
const SPRTH = { drone: 34, spitter: 64, egg: 26, pod: 70, turret: 58, carrier: 72 };
const SPROT = {
  drone: (e) => Math.sin(e.t * 6) * 0.05,
  spitter: (e) => Math.sin(e.t * 1.5 + e.phase) * 0.05,
  egg: (e) => Math.sin(e.t * 8 + e.phase) * 0.18,
  pod: (e) => Math.sin(e.t * 2 + e.phase) * 0.04,
  turret: (e) => Math.sin(e.t * 2 + e.phase) * 0.03,
  carrier: (e) => Math.sin(e.t * 1.2) * 0.03,
};
const SPRGLOW = {
  drone:   [0, -6, 26, '185,195,205', 0.10],
  spitter: [4, 6, 34, '165,175,75', 0.12],
  egg:     [0, 2, 20, '165,175,75', 0.10],
  pod:     [0, -8, 30, '215,170,100', 0.12],
  turret:  [0, 2, 24, '230,175,90', 0.16],
  carrier: [-0.38, 0, 40, '215,185,120', 0.13],
};
const SPREYE = {
  turret: [0, 0.03, 4, '235,185,100'],
  carrier: [-0.385, 0, 3, '235,185,100'],
};
function addGlow(x, y, r, rgb, a) {
  const g = ctx.createRadialGradient(x, y, 1, x, y, r);
  g.addColorStop(0, 'rgba(' + rgb + ',' + a + ')'); g.addColorStop(1, 'rgba(' + rgb + ',0)');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
}
function drawSpriteEnemy(e, def) {
  const im = SPR[e.kind].im;
  const sh = SPRTH[e.kind] / def.h;
  const sw = sh * (im.width / im.height);
  const gl = SPRGLOW[e.kind];
  // contrast cushion: darken whatever is directly behind, then backlight glow
  addGlow(0, 0, Math.max(sw, sh) * 0.72, '0,0,0', 0.40);
  ctx.save(); ctx.globalCompositeOperation = 'lighter';
  if (gl) addGlow(gl[0] * (Math.abs(gl[0]) < 1 ? sw : 1), gl[1], gl[2], gl[3], gl[4]);
  ctx.restore();
  ctx.save();
  ctx.rotate(SPROT[e.kind] ? SPROT[e.kind](e) : 0);
  if (e.kind === 'spitter') ctx.scale(1, 1 + 0.04 * Math.sin(e.t * 5));
  ctx.drawImage(im, -def.cx * sw, -def.cy * sh, sw, sh);
  ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.13;
  ctx.drawImage(im, -def.cx * sw, -def.cy * sh, sw, sh);
  ctx.restore();
  const ey = SPREYE[e.kind];
  if (ey) {
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    addGlow(ey[0] * sw, ey[1] * sh, ey[2] * 2.2, ey[3], 0.45 + 0.35 * Math.sin(e.t * 6));
    ctx.restore();
  }
  if (e.blink > 0) {
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    addGlow(0, 0, e.r * 2, '255,250,235', 0.55);
    ctx.restore();
  }
}
function drawEnemies() {
  for (const e of enemies) {
    const def = SPRDEF[e.kind];
    ctx.save(); ctx.translate(e.x, e.y);
    if (def && SPR[e.kind] && SPR[e.kind].ok) {
      drawSpriteEnemy(e, def);
    } else {
      if (e.kind === 'drone') drawDrone(e);
      else if (e.kind === 'egg') drawEgg(e);
      else if (e.kind === 'spitter') drawSpitter(e);
      else if (e.kind === 'pod') drawPod(e);
      else if (e.kind === 'turret') drawTurret(e);
      else if (e.kind === 'carrier') drawCarrier(e);
      if (e.blink > 0) {
        ctx.globalAlpha = 0.7; ctx.fillStyle = '#fff';
        ctx.beginPath(); ctx.arc(0, 0, e.r, 0, TAU); ctx.fill();
      }
    }
    ctx.restore();
  }
}
function boneFill(c) {
  const g = c.createLinearGradient(0, -14, 0, 14);
  g.addColorStop(0, '#b5af9f'); g.addColorStop(0.6, '#726d60'); g.addColorStop(1, '#33322c');
  c.fillStyle = g;
}
function drawDrone(e) {
  ctx.rotate(Math.sin(e.t * 6) * 0.08);
  ctx.strokeStyle = '#8f8a7c'; ctx.lineWidth = 1.5;
  for (let i = 0; i < 4; i++) {
    const lx = -9 + i * 6.5;
    ctx.beginPath(); ctx.moveTo(lx, 3);
    ctx.lineTo(lx - 5 + Math.sin(e.t * 12 + i * 2) * 3, 13); ctx.stroke();
  }
  ctx.beginPath(); ctx.moveTo(10, 0); ctx.quadraticCurveTo(20, 2, 24, 7); ctx.stroke();
  boneFill(ctx);
  ctx.beginPath(); ctx.ellipse(0, -1, 13, 9, 0, Math.PI, 0); ctx.closePath(); ctx.fill();
  ctx.fillStyle = '#1a1b20';
  ctx.beginPath(); ctx.ellipse(0, -1, 13, 3.5, 0, 0, Math.PI); ctx.fill();
  ctx.fillStyle = 'rgba(230,180,100,0.85)';
  ctx.beginPath(); ctx.arc(-6, -4, 1.3, 0, TAU); ctx.fill();
}
function drawEgg(e) {
  ctx.rotate(Math.sin(e.t * 8 + e.phase) * 0.2);
  boneFill(ctx);
  ctx.beginPath();
  ctx.moveTo(0, -12);
  ctx.bezierCurveTo(9, -6, 10, 4, 0, 10);
  ctx.bezierCurveTo(-10, 4, -9, -6, 0, -12);
  ctx.fill();
  ctx.strokeStyle = 'rgba(25,26,30,0.6)'; ctx.lineWidth = 1;
  ctx.beginPath(); ctx.arc(0, 1, 6, 0.3, Math.PI - 0.3); ctx.stroke();
}
function drawSpitter(e) {
  const w = 1 + 0.06 * Math.sin(e.t * 5);
  ctx.fillStyle = '#181a20';
  ctx.beginPath(); ctx.ellipse(7, 0, 19 * w, 14 * w, 0, 0, TAU); ctx.fill();
  ctx.strokeStyle = '#5f5b50'; ctx.lineWidth = 1.4; ctx.stroke();
  ctx.strokeStyle = 'rgba(140,135,120,0.55)'; ctx.lineWidth = 1;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath(); ctx.ellipse(7, 0, 13 - i * 3.5, 10 - i * 2.5, 0, 0, TAU); ctx.stroke();
  }
  boneFill(ctx);
  ctx.beginPath();
  ctx.moveTo(-24, -2);
  ctx.bezierCurveTo(-20, -10, -4, -12, 2, -4);
  ctx.bezierCurveTo(4, 2, -6, 8, -24, 4);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#0b0c0f'; ctx.lineWidth = 1.2; ctx.stroke();
  const glow = e.cd < 0.5 ? 0.9 : 0.35;
  ctx.fillStyle = 'rgba(230,180,100,' + glow + ')';
  ctx.beginPath(); ctx.arc(-21, 1, 2, 0, TAU); ctx.fill();
}
function drawPod(e) {
  ctx.strokeStyle = '#4c4a43'; ctx.lineWidth = 2;
  for (let i = 0; i < 4; i++) {
    const a = i * 0.5 + 0.5 + Math.sin(e.t * 2 + i) * 0.2;
    ctx.beginPath(); ctx.moveTo(-10 + i * 7, 14);
    ctx.quadraticCurveTo(-12 + i * 7 + Math.sin(e.t * 3 + i) * 5, 26, -14 + i * 7, 34); ctx.stroke();
  }
  ctx.fillStyle = '#15171c';
  ctx.beginPath(); ctx.ellipse(0, 0, 24, 20, 0, 0, TAU); ctx.fill();
  ctx.strokeStyle = '#6b675c'; ctx.lineWidth = 1.6; ctx.stroke();
  boneFill(ctx);
  ctx.beginPath(); ctx.ellipse(-7, -6, 7, 10, 0.35, 0, TAU); ctx.fill();
  ctx.beginPath(); ctx.ellipse(8, -3, 6, 9, -0.3, 0, TAU); ctx.fill();
  ctx.strokeStyle = 'rgba(20,21,25,0.7)'; ctx.lineWidth = 1;
  for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.arc(0, 0, 16, 0.4 + i * 1.4, 0.7 + i * 1.4); ctx.stroke(); }
}
function drawTurret(e) {
  ctx.fillStyle = '#1b1d22';
  for (let i = 0; i < 3; i++) {
    ctx.beginPath(); ctx.ellipse(6 + i * 8, 4 + i * 3, 7 - i, 10 - 2 * i, 0.2, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#5f5b50'; ctx.lineWidth = 1; ctx.stroke();
  }
  boneFill(ctx);
  ctx.beginPath();
  ctx.moveTo(-22, -4);
  ctx.bezierCurveTo(-16, -16, 4, -18, 12, -8);
  ctx.bezierCurveTo(16, -2, 8, 8, -22, 6);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#0b0c0f'; ctx.lineWidth = 1.3; ctx.stroke();
  ctx.fillStyle = 'rgba(235,185,100,' + (0.6 + 0.4 * Math.sin(e.t * 6)) + ')';
  ctx.beginPath(); ctx.arc(-6, -7, 2.2, 0, TAU); ctx.fill();
}
function drawCarrier(e) {
  ctx.strokeStyle = '#2c2e33'; ctx.lineWidth = 3;
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    ctx.moveTo(30, -16 + i * 11);
    ctx.quadraticCurveTo(58 + Math.sin(e.t * 2 + i) * 8, -12 + i * 10, 76, -18 + i * 13);
    ctx.stroke();
  }
  ctx.fillStyle = '#13151a';
  ctx.beginPath(); ctx.ellipse(0, 0, 44, 30, 0, 0, TAU); ctx.fill();
  ctx.strokeStyle = '#6b675c'; ctx.lineWidth = 2;
  for (let i = 0; i < 5; i++) {
    ctx.beginPath(); ctx.ellipse(-14 + i * 8, 0, 30 - Math.abs(i - 2) * 4, 26 - Math.abs(i - 2) * 4, 0, 0, TAU); ctx.stroke();
  }
  for (let i = 0; i < 3; i++) {
    ctx.fillStyle = 'rgba(210,203,182,' + (0.5 + 0.3 * Math.sin(e.t * 3 + i * 2)) + ')';
    ctx.beginPath(); ctx.ellipse(-16 + i * 16, 4, 5, 7, 0, 0, TAU); ctx.fill();
  }
  ctx.fillStyle = 'rgba(230,170,90,0.8)';
  ctx.beginPath(); ctx.arc(-34, -6, 2.6, 0, TAU); ctx.fill();
}
function drawBoss() {
  const b = boss;
  const sp = SPR.boss;
  if (sp && sp.ok) {
    const im = sp.im;
    const sh = 180, sw = sh * (im.width / im.height);
    const hx = b.x - 20, hy = b.y + Math.sin(b.t * 3) * 4;
    ctx.save();
    if (b.state === 'dying') ctx.globalAlpha = 0.35 + 0.4 * Math.sin(b.dt2 * 40);
    ctx.translate(hx, hy);
    if (b.state === 'dash') ctx.rotate(-0.05 * Math.sin(b.t * 18));
    addGlow(-0.15 * sw, -0.05 * sh, 0.62 * sh, '0,0,0', 0.45);
    ctx.save(); ctx.globalCompositeOperation = 'lighter';
    addGlow(-0.15 * sw, -0.05 * sh, 0.52 * sh, b.phase === 2 ? '200,95,55' : '195,160,105', 0.12);
    ctx.restore();
    ctx.drawImage(im, -SPRDEF.boss.cx * sw, -SPRDEF.boss.cy * sh, sw, sh);
    ctx.save(); ctx.globalCompositeOperation = 'lighter'; ctx.globalAlpha = 0.12;
    ctx.drawImage(im, -SPRDEF.boss.cx * sw, -SPRDEF.boss.cy * sh, sw, sh);
    ctx.restore();
    if (b.blink > 0) { ctx.save(); ctx.globalCompositeOperation = 'lighter'; addGlow(-0.15 * sw, 0, 0.5 * sh, '255,250,235', 0.5); ctx.restore(); }
    ctx.restore();
    // eye glow + inner jaw overlay
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.translate(hx, hy);
    const ec = b.phase === 2 ? '220,105,60' : '235,180,100';
    addGlow(-0.125 * sw, 0.005 * sh, 13, ec, 0.55 + 0.35 * Math.sin(b.t * 5));
    if (b.state === 'dash' && b.state !== 'dying') {
      const ext = 46 + 26 * Math.sin(b.t * 20);
      const mx = -0.21 * sw, my = 0.22 * sh;
      ctx.strokeStyle = 'rgba(18,19,24,0.95)'; ctx.lineWidth = 9;
      ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(mx - ext, my - 4); ctx.stroke();
      ctx.strokeStyle = '#d4cebd'; ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(mx - ext + 7, my - 13); ctx.lineTo(mx - ext - 8, my - 4); ctx.lineTo(mx - ext + 7, my + 5);
      ctx.closePath(); ctx.stroke();
    }
    ctx.restore();
  } else {
    drawBossProcedural(b);
  }
  // boss bar
  const bw = 420, bx = (W - bw) / 2;
  ctx.fillStyle = 'rgba(6,7,10,0.7)'; ctx.fillRect(bx - 2, 12, bw + 4, 10);
  const g2 = ctx.createLinearGradient(bx, 0, bx + bw, 0);
  g2.addColorStop(0, '#6e695e'); g2.addColorStop(1, b.phase === 2 ? '#b0603a' : '#c9a15a');
  ctx.fillStyle = g2;
  ctx.fillRect(bx, 14, bw * clamp(b.hp / b.maxhp, 0, 1), 6);
  txt('THE ARCHITECT', W / 2, 36, 12, '#a89f8b', 0.9, '6px', 'center');
}
function drawBossProcedural(b) {
  if (b.state === 'dying') {
    ctx.save(); ctx.translate(b.x, b.y); ctx.globalAlpha = 0.4 + 0.4 * Math.sin(b.dt2 * 40);
    drawSkull(b, true);
    ctx.restore();
    return;
  }
  ctx.save(); ctx.translate(b.x, b.y + Math.sin(b.t * 3) * 4);
  // neck / column to right edge
  const ng = ctx.createLinearGradient(40, 0, 260, 0);
  ng.addColorStop(0, '#3a3830'); ng.addColorStop(1, '#101115');
  ctx.fillStyle = ng;
  ctx.beginPath();
  ctx.moveTo(30, -46);
  ctx.bezierCurveTo(160, -70, 260, -50, 220, 0);
  ctx.bezierCurveTo(260, 50, 160, 70, 30, 46);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = 'rgba(140,133,118,0.5)'; ctx.lineWidth = 1.5;
  for (let i = 0; i < 5; i++) {
    ctx.beginPath();
    ctx.moveTo(60 + i * 34, -52 - i * 2);
    ctx.quadraticCurveTo(70 + i * 34, 0, 60 + i * 34, 52 + i * 2);
    ctx.stroke();
  }
  ctx.strokeStyle = '#1a1c21'; ctx.lineWidth = 5;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath(); ctx.moveTo(90, 40 + i * 10);
    ctx.quadraticCurveTo(160, 60 + i * 14 + Math.sin(b.t * 2 + i) * 8, 250, 44 + i * 12);
    ctx.stroke();
  }
  drawSkull(b, false);
  if (b.blink > 0) { ctx.globalAlpha = 0.5; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(-10, 0, 62, 0, TAU); ctx.fill(); }
  ctx.restore();
}
function drawSkull(b, dying) {
  const p2 = b.phase === 2;
  // cranium
  const g = ctx.createLinearGradient(0, -60, 0, 40);
  g.addColorStop(0, '#d4cebd'); g.addColorStop(0.55, '#8b8676'); g.addColorStop(1, '#3f3d37');
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(-82, 8);
  ctx.bezierCurveTo(-72, -30, -22, -64, 30, -60);
  ctx.bezierCurveTo(72, -56, 82, -22, 62, 8);
  ctx.bezierCurveTo(42, 38, -12, 34, -40, 28);
  ctx.closePath(); ctx.fill();
  ctx.strokeStyle = '#0b0c0f'; ctx.lineWidth = 2; ctx.stroke();
  // cranium ridges
  ctx.strokeStyle = 'rgba(22,23,27,0.5)'; ctx.lineWidth = 1.5;
  ctx.beginPath(); ctx.moveTo(-58, -8); ctx.bezierCurveTo(-30, -46, 14, -52, 44, -40); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(-40, 2); ctx.bezierCurveTo(-14, -34, 20, -40, 52, -28); ctx.stroke();
  if (p2) {
    ctx.strokeStyle = 'rgba(190,90,55,0.55)'; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(-46, -14); ctx.lineTo(-30, 4); ctx.lineTo(-22, -6); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(10, -46); ctx.lineTo(18, -24); ctx.lineTo(30, -34); ctx.stroke();
  }
  // eye
  const ec = p2 ? '220,110,70' : '235,185,100';
  ctx.fillStyle = 'rgba(' + ec + ',0.25)';
  ctx.beginPath(); ctx.ellipse(16, -14, 12, 7, 0.2, 0, TAU); ctx.fill();
  ctx.fillStyle = 'rgba(' + ec + ',' + (0.7 + 0.3 * Math.sin(b.t * 5)) + ')';
  ctx.beginPath(); ctx.ellipse(16, -14, 5, 2.6, 0.2, 0, TAU); ctx.fill();
  // mouth + teeth
  ctx.strokeStyle = '#111216'; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(-80, 10); ctx.quadraticCurveTo(-48, 18, -30, 16); ctx.stroke();
  ctx.fillStyle = '#cfc9b8';
  for (let i = 0; i < 5; i++) {
    const tx = -76 + i * 9;
    ctx.beginPath(); ctx.moveTo(tx, 12); ctx.lineTo(tx + 3, 18 + (i % 2)); ctx.lineTo(tx + 6, 12); ctx.closePath(); ctx.fill();
  }
  // inner jaw during dash
  if (b.state === 'dash' && !dying) {
    const ext = 40 + 30 * Math.sin(b.t * 20);
    ctx.strokeStyle = '#26272c'; ctx.lineWidth = 7;
    ctx.beginPath(); ctx.moveTo(-78, 12); ctx.lineTo(-78 - ext, 12); ctx.stroke();
    ctx.strokeStyle = '#8b8676'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(-78 - ext + 4, 5); ctx.lineTo(-84 - ext, 12); ctx.lineTo(-78 - ext + 4, 19); ctx.stroke();
  }
}
function drawNear() {
  drawLayer('near', 1.0, -205, 0.92);
}

// ---------- main loop ----------
let last = performance.now();
function loop(now) {
  requestAnimationFrame(loop);
  const r = Math.min(0.033, (now - last) / 1000);
  last = now;
  update(r);
  render();
}
requestAnimationFrame(loop);
