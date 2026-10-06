// DIESEL STRIKE - ディーゼルパンク縦スクロールシューティング
'use strict';
(() => {
const W = 480, H = 720;
const cv = document.getElementById('game');
const ctx = cv.getContext('2d');

function fit() {
  const s = Math.min(innerWidth / W, innerHeight / H) * 0.98;
  cv.style.width = (W * s) + 'px';
  cv.style.height = (H * s) + 'px';
}
addEventListener('resize', fit); fit();

// ---------- 画像 ----------
const IMG = {};
const IMG_LIST = {
  bg: 'assets/bg_sky.png',
  player: 'assets/player.png',
  e1: 'assets/enemy1.png',
  e2: 'assets/enemy2.png',
  boss: 'assets/boss.png',
  gear: 'assets/powerup.png',
  titlebg: 'assets/title_bg.png',
};
let assetsReady = false;
function loadAssets() {
  return new Promise((res) => {
    let n = 0;
    const total = Object.keys(IMG_LIST).length;
    for (const k in IMG_LIST) {
      const im = new Image();
      im.onload = im.onerror = () => { if (++n >= total) { assetsReady = true; res(); } };
      im.src = IMG_LIST[k];
      IMG[k] = im;
    }
  });
}

// ---------- ユーティリティ ----------
const rand = (a, b) => a + Math.random() * (b - a);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const dist2 = (ax, ay, bx, by) => { const dx = ax - bx, dy = ay - by; return dx * dx + dy * dy; };
function drawImg(im, x, y, w, h, angle, alpha) {
  if (!im || !im.width) return;
  ctx.save();
  ctx.translate(x, y);
  if (angle) ctx.rotate(angle);
  if (alpha != null) ctx.globalAlpha = alpha;
  ctx.drawImage(im, -w / 2, -h / 2, w, h);
  ctx.restore();
}
function txt(str, x, y, size, color, align) {
  ctx.font = 'bold ' + size + 'px "Courier New", monospace';
  ctx.textAlign = align || 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = color;
  ctx.fillText(str, x, y);
}
function gearPip(x, y, r, col) {
  ctx.save();
  ctx.translate(x, y);
  ctx.fillStyle = col;
  for (let i = 0; i < 8; i++) {
    const a = i * Math.PI / 4 + 0.4;
    ctx.fillRect(Math.cos(a) * r - 1.5, Math.sin(a) * r - 1.5, 3, 3);
  }
  ctx.beginPath(); ctx.arc(0, 0, r * 0.72, 0, 7); ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.beginPath(); ctx.arc(0, 0, r * 0.3, 0, 7); ctx.fill();
  ctx.restore();
}

// 背景のビネット（一度だけオフスクリーンに描画）
// bg 画像の上端は空／地平線なので、街並みだけ（上から 560px 以降）をタイルにする
const BG_SRC_Y = 560, BG_SRC_H = 1344 - 560;
const BG_TILE = Math.round(BG_SRC_H * (W / 768));
const vignette = document.createElement('canvas');
vignette.width = W; vignette.height = H;
(() => {
  const c = vignette.getContext('2d');
  const g = c.createRadialGradient(W / 2, H / 2, H * 0.4, W / 2, H / 2, H * 0.78);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(10,6,3,0.55)');
  c.fillStyle = g; c.fillRect(0, 0, W, H);
  c.fillStyle = 'rgba(120,80,30,0.07)'; c.fillRect(0, 0, W, H);
})();

// ---------- 入力 ----------
const keys = Object.create(null);
const KEYMAP = {
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
  KeyZ: 'fire', Space: 'fire',
  KeyX: 'bomb',
  KeyP: 'pause',
  KeyM: 'mute',
  Enter: 'start',
};
let audioUnlocked = false;

function unlockAudio() {
  if (audioUnlocked) return;
  audioUnlocked = true;
  FM.init({ musicVoices: 16, sfxVoices: 12, echo: 0.2 }).then(() => {
    if (state === 'title') playMusic('title');
  });
}
function sfx(name, x) {
  if (!audioUnlocked || !FM.ready) return;
  if (x != null) FM.play_sfx(name, { x, width: W, vel: 0.9 });
  else FM.play_sfx(name, { vel: 0.9 });
}
function handleAction(act) {
  if (!audioUnlocked) { unlockAudio(); return; }
  if (act === 'mute') { FM.toggleMute(); return; }
  if (act === 'pause') {
    if (state === 'play' || state === 'boss') { paused = !paused; sfx('select'); }
    return;
  }
  if (state === 'title' && (act === 'start' || act === 'fire')) { startGame(); return; }
  if ((state === 'over' || state === 'win') && act === 'start') { toTitle(); return; }
  if ((state === 'play' || state === 'boss') && act === 'bomb') { tryBomb(); }
}
addEventListener('keydown', (e) => {
  const act = KEYMAP[e.code];
  if (act) e.preventDefault();
  if (e.repeat) return;
  if (!act) return;
  keys[act] = true;
  handleAction(act);
});
addEventListener('keyup', (e) => {
  const act = KEYMAP[e.code];
  if (act) keys[act] = false;
});
addEventListener('pointerdown', () => {
  if (!audioUnlocked) { unlockAudio(); return; }
  if (state === 'title') startGame();
  else if (state === 'over' || state === 'win') toTitle();
});

// ---------- 音楽 ----------
let curMusic = null;
function playMusic(name) {
  if (name === curMusic) return;
  curMusic = name;
  if (!FM.ready) return;
  if (name === 'none') { FM.stop(); return; }
  FM.play(SONGS[name]());
}
FM.onSongEnd = () => { curMusic = null; };

// ---------- 状態 ----------
let state = 'title';
let paused = false;
let score = 0;
let hiscore = 0;
try { hiscore = +(localStorage.getItem('ds_hi') || 0); } catch (e) { /* noop */ }
let t = 0, stageT = 0, shake = 0, bgY = 0, titleX = 0, bombFlash = 0;
let spawnT = 0, waveN = 0, bossWarn = 0;
let lastShotSfx = 0, lastHitSfx = 0;

const player = { x: W / 2, y: H - 110, hp: 3, power: 1, bombs: 3, inv: 0, cd: 0, alive: true, deathT: 0 };
let bullets = [], ebullets = [], enemies = [], parts = [], pows = [], floats = [];
let boss = null;

function startGame() {
  state = 'play'; paused = false;
  score = 0; stageT = 0; spawnT = 1.2; waveN = 0; bossWarn = 0; boss = null;
  bullets = []; ebullets = []; enemies = []; pows = []; floats = []; parts = [];
  player.x = W / 2; player.y = H - 110; player.hp = 3; player.power = 1;
  player.bombs = 3; player.inv = 0; player.cd = 0; player.alive = true;
  playMusic('stage');
  sfx('select');
}
function toTitle() {
  state = 'title'; paused = false;
  boss = null; enemies = []; ebullets = []; bullets = []; pows = [];
  playMusic('title');
  sfx('select');
}
function gameOver() {
  state = 'over';
  if (score > hiscore) { hiscore = score; try { localStorage.setItem('ds_hi', hiscore); } catch (e) { /* noop */ } }
  playMusic('gameover');
}

// ---------- スプライト生成 ----------
function spawnScout(x, y, o) {
  o = o || {};
  enemies.push({
    type: 'e1', x, y, hp: 2, r: 15, t: 0, flash: 0,
    vx: o.vx || 0, vy: o.vy != null ? o.vy : 140,
    sway: o.sway || 0, swayF: o.swayF || 2,
    fire: (o.fireDelay || 0) + rand(1.0, 2.2), score: 100,
  });
}
function spawnGun(x, y) {
  enemies.push({
    type: 'e2', x, y, hp: 10, r: 24, t: 0, flash: 0,
    vy: 60, targetY: rand(110, 200), hold: 0, exit: false,
    fire: 1.1, score: 400,
  });
}
const WAVES = [
  () => { for (let i = 0; i < 5; i++) spawnScout(64 + i * 88, -40 - i * 18, { vy: 150 }); },
  () => { for (let i = 0; i < 4; i++) spawnScout(-40 - i * 55, 90 + i * 66, { vx: 130, vy: 18 }); },
  () => { for (let i = 0; i < 4; i++) spawnScout(W + 40 + i * 55, 90 + i * 66, { vx: -130, vy: 18 }); },
  () => {
    spawnScout(W / 2, -40, { vy: 120 });
    for (let i = 1; i <= 3; i++) {
      spawnScout(W / 2 - i * 60, -40 - i * 30, { vy: 120 });
      spawnScout(W / 2 + i * 60, -40 - i * 30, { vy: 120 });
    }
  },
  () => {
    spawnGun(W / 2, -60);
    spawnScout(W / 2 - 130, -40, { vy: 140 });
    spawnScout(W / 2 + 130, -40, { vy: 140 });
  },
  () => { for (let i = 0; i < 5; i++) spawnScout(W / 2, -40 - i * 70, { vy: 160, sway: 90, swayF: 1.6, fireDelay: i * 0.25 }); },
];

// ---------- 弾・爆発 ----------
function ebullet(x, y, ang, sp) {
  ebullets.push({ x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, r: 5, dead: false });
}
function firePlayer() {
  const p = player;
  const mk = (dx, dy, off) => bullets.push({ x: p.x + (off || 0), y: p.y - 26, vx: dx * 560, vy: dy * 560, r: 4, dead: false });
  if (p.power === 1) mk(0, -1);
  else if (p.power === 2) { mk(0, -1, -12); mk(0, -1, 12); }
  else if (p.power === 3) { mk(0, -1, -12); mk(0, -1, 12); mk(-0.16, -1); mk(0.16, -1); }
  else { mk(0, -1, -12); mk(0, -1, 12); mk(-0.18, -1); mk(0.18, -1); mk(-0.38, -1); mk(0.38, -1); }
}
function explosion(x, y, n, big) {
  const cols = ['#ffd27a', '#ff9d3c', '#ff6a2a', '#ffe9b0'];
  for (let i = 0; i < n; i++) {
    const a = rand(0, Math.PI * 2), sp = rand(30, big ? 260 : 160);
    const life = rand(0.3, big ? 1.1 : 0.7);
    parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life, max: life, size: rand(2, big ? 7 : 4), col: cols[i & 3], drag: 2.5 });
  }
  const ringLife = big ? 0.45 : 0.25;
  parts.push({ x, y, vx: 0, vy: 0, life: ringLife, max: ringLife, size: big ? 60 : 30, col: 'ring', drag: 0 });
}
function spark(x, y, col) {
  for (let i = 0; i < 3; i++) {
    const a = rand(0, Math.PI * 2), sp = rand(40, 140);
    parts.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.25, max: 0.25, size: 2, col, drag: 3 });
  }
}
function addFloat(x, y, str, col) { floats.push({ x, y, str, col, life: 0.9 }); }

// ---------- 戦闘処理 ----------
function killEnemy(e) {
  e.dead = true;
  score += e.score;
  addFloat(e.x, e.y, String(e.score), '#e8c07a');
  explosion(e.x, e.y, e.type === 'e2' ? 26 : 16, e.type === 'e2');
  sfx('explosion', e.x);
  if (Math.random() < (e.type === 'e2' ? 0.3 : 0.1)) {
    pows.push({ x: e.x, y: e.y, vy: 110, t: 0, kind: Math.random() < 0.75 ? 'power' : 'bomb', dead: false });
  }
}
function killBoss() {
  const b = boss;
  score += 3000;
  addFloat(b.x, b.y, '+3000', '#ffd75e');
  for (let i = 0; i < 6; i++) explosion(b.x + rand(-60, 60), b.y + rand(-50, 60), 24, true);
  for (const eb of ebullets) { eb.dead = true; spark(eb.x, eb.y, '#ffb347'); }
  boss = null;
  shake = 20;
  sfx('bigexplosion', b.x);
  state = 'win';
  if (score > hiscore) { hiscore = score; try { localStorage.setItem('ds_hi', hiscore); } catch (e) { /* noop */ } }
  playMusic('victory');
}
function hitPlayer() {
  const p = player;
  if (p.inv > 0 || !p.alive) return;
  p.hp--; p.inv = 2; shake = 10;
  explosion(p.x, p.y, 14, false);
  sfx('damage');
  if (p.hp <= 0) {
    p.alive = false; p.deathT = 1.4;
    explosion(p.x, p.y, 40, true);
    sfx('bigexplosion', p.x);
    shake = 18;
  }
}
function spawnBoss() {
  boss = { x: W / 2, y: -170, hp: 700, maxhp: 700, r: 56, t: 0, fireT: 1.6, spiral: 0, summonT: 4, phase: 0, flash: 0, entering: true };
  state = 'boss';
  playMusic('boss');
}
function tryBomb() {
  const p = player;
  if (!p.alive || p.bombs <= 0) return;
  if (state !== 'play' && state !== 'boss') return;
  p.bombs--; shake = 14; bombFlash = 0.4;
  sfx('bomb'); sfx('steam');
  for (const e of enemies) {
    e.hp -= 8; e.flash = 0.2;
    if (e.hp <= 0) killEnemy(e);
  }
  if (boss) { boss.hp -= 120; boss.flash = 0.25; if (boss.hp <= 0) killBoss(); }
  for (const b of ebullets) { b.dead = true; spark(b.x, b.y, '#ffd75e'); }
}

function updatePlayer(dt) {
  const p = player;
  if (!p.alive) return;
  const sp = 330;
  let dx = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
  let dy = (keys.down ? 1 : 0) - (keys.up ? 1 : 0);
  if (dx && dy) { dx *= 0.7071; dy *= 0.7071; }
  p.x = clamp(p.x + dx * sp * dt, 26, W - 26);
  p.y = clamp(p.y + dy * sp * dt, 60, H - 46);
  if (p.inv > 0) p.inv -= dt;
  p.cd -= dt;
  if (keys.fire && p.cd <= 0) {
    firePlayer();
    p.cd = 0.115;
    if (t - lastShotSfx > 0.09) { sfx('shot', p.x); lastShotSfx = t; }
  }
}

function updateBoss(dt) {
  const b = boss;
  if (!b) return;
  b.t += dt;
  if (b.flash > 0) b.flash -= dt;
  if (b.entering) {
    b.y += 55 * dt;
    if (b.y >= 130) { b.y = 130; b.entering = false; }
    return;
  }
  b.x = W / 2 + Math.sin(b.t * 0.55) * 110;
  const ratio = b.hp / b.maxhp;
  b.phase = ratio > 0.66 ? 0 : ratio > 0.33 ? 1 : 2;
  b.fireT -= dt;
  if (b.fireT <= 0) {
    const aim = Math.atan2(player.y - b.y, player.x - b.x);
    if (b.phase === 0) {
      for (let i = -2; i <= 2; i++) ebullet(b.x, b.y + 40, aim + i * 0.16, 235);
      b.fireT = 1.15;
    } else if (b.phase === 1) {
      for (let arm = 0; arm < 2; arm++) {
        const a = b.spiral + arm * Math.PI;
        ebullet(b.x, b.y + 30, a, 245);
        ebullet(b.x, b.y + 30, a + 0.25, 245);
      }
      b.spiral += 0.42;
      ebullet(b.x, b.y + 40, aim, 260);
      b.fireT = 0.95;
    } else {
      for (let arm = 0; arm < 3; arm++) {
        const a = b.spiral + arm * (Math.PI * 2 / 3);
        ebullet(b.x, b.y + 30, a, 255);
      }
      b.spiral += 0.33;
      for (let i = -1; i <= 1; i++) ebullet(b.x, b.y + 40, aim + i * 0.12, 265);
      b.fireT = 0.6;
    }
  }
  if (b.phase === 2) {
    b.summonT -= dt;
    if (b.summonT <= 0 && enemies.length < 6) {
      spawnScout(b.x - 120, -30, { vy: 150 });
      spawnScout(b.x + 120, -30, { vy: 150 });
      b.summonT = 4.5;
    }
  }
}

function updateEnemies(dt) {
  for (const e of enemies) {
    if (e.dead) continue;
    e.t += dt;
    if (e.flash > 0) e.flash -= dt;
    if (e.type === 'e1') {
      e.x += (e.vx + (e.sway ? Math.sin(e.t * e.swayF * 2) * e.sway : 0)) * dt;
      e.y += e.vy * dt;
    } else {
      if (!e.exit) {
        if (e.y < e.targetY) e.y += e.vy * dt;
        else {
          e.hold += dt;
          e.x = W / 2 + Math.sin(e.t * 0.9) * 90;
          if (e.hold > 3.5) e.exit = true;
        }
      } else e.y += 90 * dt;
    }
    e.fire -= dt;
    const onscreen = e.y > 20 && e.y < H - 140 && e.x > 20 && e.x < W - 20;
    if (e.fire <= 0 && onscreen && player.alive) {
      if (e.type === 'e1') {
        ebullet(e.x, e.y + 14, Math.PI / 2, 225);
        e.fire = rand(1.5, 2.5);
      } else {
        const aim = Math.atan2(player.y - e.y, player.x - e.x);
        for (const off of [-0.28, 0, 0.28]) ebullet(e.x, e.y + 16, aim + off, 215);
        e.fire = 1.25;
      }
    }
  }
  enemies = enemies.filter((e) => !e.dead && e.y < H + 70 && e.x > -90 && e.x < W + 90);
}

function collide() {
  for (const b of bullets) {
    if (b.dead) continue;
    for (const e of enemies) {
      if (e.dead) continue;
      const rr = e.r + b.r;
      if (dist2(b.x, b.y, e.x, e.y) < rr * rr) {
        b.dead = true;
        e.hp--; e.flash = 0.08;
        spark(b.x, b.y, '#ffe9b0');
        if (e.hp <= 0) killEnemy(e);
        else if (t - lastHitSfx > 0.06) { sfx('hit', e.x); lastHitSfx = t; }
        break;
      }
    }
    if (b.dead) continue;
    if (boss && !boss.entering) {
      const rr = boss.r + b.r;
      if (dist2(b.x, b.y, boss.x, boss.y) < rr * rr) {
        b.dead = true;
        boss.hp--; boss.flash = 0.06;
        spark(b.x, b.y, '#ffe9b0');
        if (boss.hp <= 0) killBoss();
      }
    }
  }
  if (player.alive && player.inv <= 0) {
    for (const b of ebullets) {
      if (b.dead) continue;
      const rr = 12 + b.r;
      if (dist2(b.x, b.y, player.x, player.y) < rr * rr) { b.dead = true; hitPlayer(); break; }
    }
    for (const e of enemies) {
      if (e.dead) continue;
      const rr = e.r + 12;
      if (dist2(e.x, e.y, player.x, player.y) < rr * rr) {
        e.hp -= 3; e.flash = 0.1;
        if (e.hp <= 0) killEnemy(e);
        hitPlayer();
      }
    }
    if (boss && !boss.entering) {
      const rr = boss.r + 14;
      if (dist2(boss.x, boss.y + 20, player.x, player.y) < rr * rr) hitPlayer();
    }
  }
  for (const g of pows) {
    if (g.dead) continue;
    if (dist2(g.x, g.y, player.x, player.y) < 30 * 30) {
      g.dead = true;
      if (g.kind === 'power') {
        if (player.power < 4) { player.power++; sfx('powerup'); addFloat(player.x, player.y - 30, 'POWER UP', '#ffd75e'); }
        else { score += 500; sfx('coin'); addFloat(player.x, player.y - 30, '+500', '#ffd75e'); }
      } else {
        if (player.bombs < 5) { player.bombs++; sfx('powerup'); addFloat(player.x, player.y - 30, 'BOMB +1', '#7ec8ff'); }
        else { score += 300; sfx('coin'); addFloat(player.x, player.y - 30, '+300', '#7ec8ff'); }
      }
    }
  }
}

// ---------- メイン更新 ----------
function update(dt) {
  t += dt;
  if (shake > 0) shake = Math.max(0, shake - 30 * dt);
  if (bombFlash > 0) bombFlash -= dt;
  bgY = (bgY + (state === 'boss' ? 30 : 55) * dt) % BG_TILE;
  if (state === 'title') { titleX = Math.sin(t * 0.1) * 24; updateParts(dt); return; }
  if (state === 'over' || state === 'win') { updateParts(dt); return; }
  if (paused) return;

  if (state === 'play') {
    stageT += dt;
    spawnT -= dt;
    if (spawnT <= 0 && stageT < 55) {
      WAVES[waveN % WAVES.length]();
      waveN++;
      spawnT = rand(2.6, 3.4);
    }
    if (stageT > 55 && bossWarn <= 0 && !boss) { bossWarn = 2.5; sfx('warning'); }
    if (bossWarn > 0) { bossWarn -= dt; if (bossWarn <= 0) spawnBoss(); }
  }
  if (state === 'play' || state === 'boss') updatePlayer(dt);
  if (!player.alive && (state === 'play' || state === 'boss')) {
    player.deathT -= dt;
    if (player.deathT <= 0) gameOver();
  }
  if (state === 'boss' && boss) updateBoss(dt);
  updateEnemies(dt);
  for (const b of bullets) {
    b.x += b.vx * dt; b.y += b.vy * dt;
    if (b.y < -20 || b.x < -20 || b.x > W + 20) b.dead = true;
  }
  bullets = bullets.filter((b) => !b.dead);
  for (const b of ebullets) {
    b.x += b.vx * dt; b.y += b.vy * dt;
    if (b.y < -30 || b.y > H + 30 || b.x < -30 || b.x > W + 30) b.dead = true;
  }
  ebullets = ebullets.filter((b) => !b.dead);
  for (const g of pows) {
    g.t += dt; g.y += g.vy * dt;
    if (g.y > H + 30) g.dead = true;
  }
  pows = pows.filter((g) => !g.dead);
  collide();
  updateParts(dt);
}
function updateParts(dt) {
  for (const p of parts) {
    p.life -= dt;
    if (p.drag) { const d = 1 - p.drag * dt; p.vx *= d; p.vy *= d; }
    p.x += p.vx * dt; p.y += p.vy * dt;
  }
  parts = parts.filter((p) => p.life > 0);
  for (const f of floats) { f.life -= dt; f.y -= 40 * dt; }
  floats = floats.filter((f) => f.life > 0);
}

// ---------- 描画 ----------
function drawGameWorld() {
  if (IMG.bg && IMG.bg.width) {
    for (let i = -1; i <= 1; i++) {
      ctx.drawImage(IMG.bg, 0, BG_SRC_Y, 768, BG_SRC_H, 0, bgY + i * BG_TILE, W, BG_TILE);
    }
  }
  ctx.drawImage(vignette, 0, 0);
  for (const g of pows) {
    const pulse = 1 + Math.sin(g.t * 6) * 0.08;
    drawImg(IMG.gear, g.x, g.y, 34 * pulse, 34 * pulse, g.t * 1.5);
    if (g.kind === 'bomb') {
      ctx.fillStyle = 'rgba(90,170,255,0.28)';
      ctx.beginPath(); ctx.arc(g.x, g.y, 20, 0, 7); ctx.fill();
    }
  }
  for (const e of enemies) {
    const im = e.type === 'e1' ? IMG.e1 : IMG.e2;
    const s = e.type === 'e1' ? 46 : 76;
    drawImg(im, e.x, e.y, s, s);
    if (e.flash > 0) {
      ctx.globalAlpha = Math.min(1, e.flash * 7);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(e.x, e.y, s * 0.42, 0, 7); ctx.fill();
      ctx.globalAlpha = 1;
    }
  }
  if (boss) {
    drawImg(IMG.boss, boss.x, boss.y, 215, 215);
    if (boss.flash > 0) {
      ctx.globalAlpha = Math.min(1, boss.flash * 6);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(boss.x, boss.y, 80, 0, 7); ctx.fill();
      ctx.globalAlpha = 1;
    }
    if (!boss.entering) {
      const bw = 380, bx = (W - bw) / 2, by = 46;
      ctx.fillStyle = 'rgba(12,8,5,0.82)';
      ctx.fillRect(bx - 3, by - 3, bw + 6, 12);
      ctx.strokeStyle = '#8a5a20';
      ctx.lineWidth = 1;
      ctx.strokeRect(bx - 3, by - 3, bw + 6, 12);
      ctx.fillStyle = '#5a2318';
      ctx.fillRect(bx, by, bw, 6);
      ctx.fillStyle = '#ff7a3c';
      ctx.fillRect(bx, by, bw * clamp(boss.hp / boss.maxhp, 0, 1), 6);
      txt('IRONSIDE DREADNOUGHT', W / 2, by + 18, 11, '#ffd75e');
    }
  }
  if (player.alive) {
    const blink = player.inv > 0 && Math.floor(t * 12) % 2 === 0;
    if (!blink) {
      const tilt = keys.left ? 0.07 : keys.right ? -0.07 : 0;
      drawImg(IMG.player, player.x, player.y, 64, 64, tilt);
      ctx.globalAlpha = 0.45 + Math.sin(t * 30) * 0.2;
      ctx.fillStyle = '#ffb347';
      ctx.beginPath(); ctx.arc(player.x, player.y + 30, 5, 0, 7); ctx.fill();
      ctx.globalAlpha = 1;
    }
  }
  ctx.globalCompositeOperation = 'lighter';
  for (const b of bullets) {
    ctx.fillStyle = '#ffe9a8';
    ctx.beginPath(); ctx.arc(b.x, b.y, 3.5, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(255,170,60,0.5)';
    ctx.beginPath(); ctx.arc(b.x, b.y, 7, 0, 7); ctx.fill();
  }
  for (const b of ebullets) {
    ctx.fillStyle = '#ff8a5e';
    ctx.beginPath(); ctx.arc(b.x, b.y, 4.5, 0, 7); ctx.fill();
    ctx.fillStyle = 'rgba(255,80,40,0.4)';
    ctx.beginPath(); ctx.arc(b.x, b.y, 8, 0, 7); ctx.fill();
  }
  for (const p of parts) {
    if (p.col === 'ring') {
      const k = 1 - p.life / p.max;
      ctx.strokeStyle = 'rgba(255,190,90,' + ((1 - k) * 0.8).toFixed(3) + ')';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(p.x, p.y, 10 + k * p.size, 0, 7); ctx.stroke();
    } else {
      ctx.globalAlpha = clamp(p.life / p.max, 0, 1);
      ctx.fillStyle = p.col;
      ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(0.5, p.size * (0.4 + 0.6 * (p.life / p.max))), 0, 7); ctx.fill();
      ctx.globalAlpha = 1;
    }
  }
  ctx.globalCompositeOperation = 'source-over';
  for (const f of floats) txt(f.str, f.x, f.y, 13, f.col);
  if (bombFlash > 0) {
    ctx.fillStyle = 'rgba(255,230,170,' + (bombFlash * 1.6).toFixed(3) + ')';
    ctx.fillRect(-20, -20, W + 40, H + 40);
  }
  if (bossWarn > 0 && Math.floor(t * 4) % 2 === 0) txt('!! WARNING !!', W / 2, H / 2 - 40, 28, '#ff5a3c');
  drawHUD();
}
function drawHUD() {
  ctx.fillStyle = 'rgba(16,11,8,0.55)';
  ctx.fillRect(0, 0, W, 36);
  txt('SCORE ' + String(score).padStart(7, '0'), 10, 12, 14, '#f1e2c6', 'left');
  txt('HI ' + String(hiscore).padStart(7, '0'), W - 10, 12, 12, '#b9a585', 'right');
  for (let i = 0; i < player.hp; i++) gearPip(14 + i * 15, 27, 5, '#ff5a3c');
  for (let i = 0; i < player.bombs; i++) gearPip(70 + i * 15, 27, 5, '#7ec8ff');
  txt('PWR ' + player.power, 160, 27, 11, '#ffd75e', 'left');
  txt(state === 'boss' ? 'BOSS' : 'SECTOR 01', W - 10, 27, 11, '#d8a848', 'right');
}
function drawTitle() {
  if (IMG.titlebg && IMG.titlebg.width) {
    const s = Math.max(W / IMG.titlebg.width, H / IMG.titlebg.height);
    const dw = IMG.titlebg.width * s, dh = IMG.titlebg.height * s;
    ctx.drawImage(IMG.titlebg, (W - dw) / 2 + titleX, (H - dh) / 2, dw, dh);
  } else {
    ctx.fillStyle = '#1a120c';
    ctx.fillRect(0, 0, W, H);
  }
  ctx.fillStyle = 'rgba(12,8,5,0.4)';
  ctx.fillRect(0, 0, W, H);
  ctx.drawImage(vignette, 0, 0);
  drawImg(IMG.gear, W / 2, 235, 170, 170, t * 0.4, 0.85);
  const grad = ctx.createLinearGradient(0, 150, 0, 300);
  grad.addColorStop(0, '#ffe9a8');
  grad.addColorStop(0.5, '#e0a64a');
  grad.addColorStop(1, '#8a5a20');
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.font = 'bold 64px "Courier New", monospace';
  ctx.lineWidth = 8;
  ctx.strokeStyle = 'rgba(20,12,6,0.9)';
  ctx.strokeText('DIESEL', W / 2, 205);
  ctx.strokeText('STRIKE', W / 2, 275);
  ctx.fillStyle = grad;
  ctx.fillText('DIESEL', W / 2, 205);
  ctx.fillText('STRIKE', W / 2, 275);
  txt('- A DIESEL PUNK SHOOTER -', W / 2, 340, 14, '#d8c090');
  if (!audioUnlocked) txt('PRESS ANY KEY', W / 2, 430, 20, '#ffe9a8');
  else if (Math.floor(t * 2) % 2 === 0) txt('PRESS ENTER TO START', W / 2, 430, 20, '#ffe9a8');
  txt('ARROWS / WASD : MOVE    Z / SPACE : FIRE', W / 2, 490, 13, '#b9a585');
  txt('X : BOMB    P : PAUSE    M : SOUND', W / 2, 512, 13, '#b9a585');
  txt('HI SCORE  ' + String(hiscore).padStart(7, '0'), W / 2, 566, 15, '#ffd75e');
  txt('EST. 1928', W / 2, H - 22, 11, '#8a7a5e');
}
function drawOver() {
  ctx.fillStyle = 'rgba(10,6,4,0.72)';
  ctx.fillRect(0, 0, W, H);
  txt('GAME OVER', W / 2, 250, 52, '#ff5a3c');
  txt('SCORE  ' + String(score).padStart(7, '0'), W / 2, 330, 20, '#f1e2c6');
  txt('HI     ' + String(hiscore).padStart(7, '0'), W / 2, 360, 16, '#ffd75e');
  if (Math.floor(t * 2) % 2 === 0) txt('PRESS ENTER', W / 2, 440, 18, '#ffe9a8');
}
function drawWin() {
  ctx.fillStyle = 'rgba(10,6,4,0.6)';
  ctx.fillRect(0, 0, W, H);
  txt('VICTORY', W / 2, 250, 52, '#ffd75e');
  txt('THE SKIES ARE CLEAR', W / 2, 305, 15, '#d8c090');
  txt('SCORE  ' + String(score).padStart(7, '0'), W / 2, 350, 20, '#f1e2c6');
  txt('HI     ' + String(hiscore).padStart(7, '0'), W / 2, 380, 16, '#ffd75e');
  if (Math.floor(t * 2) % 2 === 0) txt('PRESS ENTER', W / 2, 460, 18, '#ffe9a8');
}
function draw() {
  ctx.clearRect(0, 0, W, H);
  ctx.save();
  if (shake > 0) ctx.translate(rand(-shake, shake) * 0.5, rand(-shake, shake) * 0.5);
  if (state === 'title') drawTitle();
  else drawGameWorld();
  ctx.restore();
  if (state === 'over') drawOver();
  if (state === 'win') drawWin();
  if (paused && (state === 'play' || state === 'boss')) {
    ctx.fillStyle = 'rgba(10,6,4,0.55)';
    ctx.fillRect(0, 0, W, H);
    txt('PAUSED', W / 2, H / 2, 40, '#f1e2c6');
  }
  if (FM.muted && audioUnlocked) txt('MUTED', W - 12, H - 14, 12, '#8a7a5e', 'right');
}

// ---------- 起動 ----------
loadAssets();

// ---------- ループ ----------
let last = performance.now() / 1000;
function frame() {
  requestAnimationFrame(frame);
  const now = performance.now() / 1000;
  let dt = now - last;
  last = now;
  if (dt > 0.1) dt = 0.1;
  if (dt <= 0) return;
  update(dt);
  draw();
}
requestAnimationFrame(frame);

window.__game = {
  update, draw,
  get state() { return state; },
  startGame,
  assets: () => assetsReady,
  debug: {
    setInv: (s) => { player.inv = s; },
    setStageT: (v) => { stageT = v; },
    player: () => player,
    bullets: () => bullets.length,
    killPlayer: () => { player.hp = 1; player.inv = 0; if (player.alive) hitPlayer(); },
    bossDmg: (n) => { if (boss) { boss.hp -= n; if (boss.hp <= 0) killBoss(); } },
    enemies: () => enemies,
    ebullets: () => ebullets,
  },
};

// ---------- 自己診断（?selftest） ----------
const SELFTEST = /[?&]selftest/.test(location.search);
if (SELFTEST) {
  const st = window.__selftest = { phase: 'boot', warnings: [], errors: [] };
  const owarn = console.warn, oerr = console.error;
  console.warn = (...a) => { st.warnings.push(a.map(String).join(' ')); owarn(...a); };
  console.error = (...a) => { st.errors.push(a.map(String).join(' ')); oerr(...a); };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  (async () => {
    try {
      await loadAssets();
      st.assets = assetsReady;
      for (const k of Object.keys(window.SONGS)) window.SONGS[k]();
      await FM.init({ musicVoices: 16, sfxVoices: 12, echo: 0.2 });
      audioUnlocked = true;
      st.engine = FM.engine;
      playMusic('title');
      sfx('select');
      await sleep(1500);
      st.title = await FM.measure('music', 800);
      st.step = 'title';
      await sleep(1200);
      startGame();
      window.__game.debug.setInv(1e9);
      sfx('shot'); sfx('powerup'); sfx('explosion', W * 0.3); sfx('bigexplosion');
      spawnScout(120, -20, { vy: 160 });
      spawnScout(300, -20, { vy: 160 });
      spawnGun(240, -40);
      keys.fire = true;
      for (let i = 0; i < 360; i++) { update(1 / 60); draw(); }
      st.playEnemies = window.__game.debug.enemies().length;
      st.step = 'play';
      await sleep(1200);
      spawnBoss();
      for (let i = 0; i < 240; i++) { update(1 / 60); draw(); }
      st.step = 'boss';
      await sleep(1200);
      sfx('damage'); sfx('warning'); sfx('bomb');
      const mPlay = await FM.measure('music', 800);
      const mSfx = await FM.measure('sfx', 800);
      st.play = mPlay;
      st.sfx = mSfx;
      window.__game.debug.bossDmg(1e9);
      for (let i = 0; i < 60; i++) { update(1 / 60); draw(); }
      st.winState = window.__game.state;
      st.step = 'win';
      const mWin = await FM.measure('music', 1200);
      st.win = mWin;
      startGame();
      window.__game.debug.killPlayer();
      await sleep(2600);
      st.overState = window.__game.state;
      st.step = 'over';
      await sleep(1000);
      st.jingle = await FM.measure('music', 1000);
      await FM.shutdown();
      st.phase = 'done';
    } catch (e) {
      st.phase = 'error';
      st.errors.push(String((e && e.stack) || e));
    }
  })();
}
})();
