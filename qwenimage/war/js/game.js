// ===== メインゲーム：マップ・入力・描画・ターン進行・AI =====
'use strict';

const SQ3 = Math.sqrt(3), HR = 40, PAD = 16;
const IMG = {};
const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const disp = (hp) => Math.ceil(hp / 10);

const G = {
  cols: 0, rows: 0, cells: [], units: [], players: [], turn: 0, day: 1, nextId: 1,
  phase: 'title', sel: null, reach: null, atkSet: null, targets: null, startIdx: -1,
  hover: -1, path: null, inspect: null, fx: [], texts: [], tweens: [],
  anim: true, over: false, time: 0, mode: 'cpu',
};

// ---------- 画像 ----------
function loadImages() {
  const list = [];
  for (const t of UNIT_ORDER) list.push(['u_' + t, 'png'], ['s_' + t, 'png']);
  for (const k in TERRAIN) list.push([TERRAIN[k].img, 'jpg']);
  for (const b of ['b_plains', 'b_forest', 'b_city', 'b_sky', 'b_desert', 'title']) list.push([b, 'jpg']);
  return Promise.all(list.map(([k, ext]) => new Promise((res) => {
    const im = new Image();
    im.onload = () => { IMG[k] = im; res(); };
    im.onerror = () => { IMG[k] = placeholder(k); res(); };
    im.src = `assets/${k}.${ext}`;
  })));
}
function placeholder(k) {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const x = c.getContext('2d'); x.fillStyle = '#777'; x.fillRect(0, 0, 128, 128);
  x.fillStyle = '#fff'; x.font = '16px sans-serif'; x.fillText(k, 6, 64);
  return c;
}

// ---------- 六角形の座標 ----------
const idxOf = (c, r) => r * G.cols + c;
const inMap = (c, r) => c >= 0 && r >= 0 && c < G.cols && r < G.rows;
function center(idx) {
  const c = idx % G.cols, r = Math.floor(idx / G.cols);
  return [PAD + SQ3 * HR * (c + 0.5 + 0.5 * (r & 1)), PAD + HR + 1.5 * HR * r];
}
const EVEN_N = [[1, 0], [0, -1], [-1, -1], [-1, 0], [-1, 1], [0, 1]];
const ODD_N = [[1, 0], [1, -1], [0, -1], [-1, 0], [0, 1], [1, 1]];
function neighbors(idx) {
  const c = idx % G.cols, r = Math.floor(idx / G.cols);
  const out = [];
  for (const [dc, dr] of (r & 1 ? ODD_N : EVEN_N)) if (inMap(c + dc, r + dr)) out.push(idxOf(c + dc, r + dr));
  return out;
}
function cube(idx) {
  const c = idx % G.cols, r = Math.floor(idx / G.cols);
  const x = c - (r - (r & 1)) / 2;
  return [x, r, -x - r];
}
function hexDist(a, b) {
  const p = cube(a), q = cube(b);
  return Math.max(Math.abs(p[0] - q[0]), Math.abs(p[1] - q[1]), Math.abs(p[2] - q[2]));
}
function hexPath(ctx, x, y, r) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 180 * (60 * i - 90);
    const px = x + r * Math.cos(a), py = y + r * Math.sin(a);
    i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
  }
  ctx.closePath();
}
const worldW = () => PAD * 2 + SQ3 * HR * (G.cols + 0.5);
const worldH = () => PAD * 2 + HR * 2 + 1.5 * HR * (G.rows - 1);

// ---------- 盤面 ----------
const unitIdx = (u) => idxOf(u.c, u.r);
const unitAtIdx = (idx) => G.units.find((u) => unitIdx(u) === idx);
const cellOf = (u) => G.cells[unitIdx(u)];
const isProp = (cell) => !!TERRAIN[cell.t].prop;

function newGame(mode) {
  G.mode = mode;
  G.rows = MAP_ROWS.length; G.cols = Math.max(...MAP_ROWS.map((s) => s.length));
  G.cells = [];
  for (let r = 0; r < G.rows; r++) for (let c = 0; c < G.cols; c++) {
    const ch = MAP_ROWS[r][c] || '~';
    G.cells.push({ c, r, t: MAP_CHARS[ch], owner: ch in MAP_OWNER ? MAP_OWNER[ch] : null, cap: CAPTURE_POINTS });
  }
  G.units = []; G.fx = []; G.texts = []; G.tweens = [];
  G.players = [
    { funds: START_FUNDS, ai: mode === 'watch' },
    { funds: START_FUNDS, ai: mode !== 'pvp' },
  ];
  for (const s of START_UNITS) addUnit(s.type, s.owner, idxOf(s.col, s.row), false);
  G.turn = 0; G.day = 1; G.over = false; G.capitalTaken = null; G.gen = (G.gen || 0) + 1;
  clearSel();
  buildTerrainLayer();
  resize();
  startTurn(0, true);
}

function addUnit(type, owner, idx, acted) {
  const [x, y] = center(idx);
  const u = { id: G.nextId++, type, owner, hp: 100, c: idx % G.cols, r: Math.floor(idx / G.cols), px: x, py: y,
    angle: owner === 0 ? Math.PI / 2 : -Math.PI / 2, acted };
  G.units.push(u);
  return u;
}

// ---------- 移動範囲 ----------
function dijkstra(u, from) {
  const def = UNITS[u.type], mc = MOVE_COST[def.mtype];
  const res = new Map([[from, { cost: 0, prev: -1 }]]);
  const open = [from];
  while (open.length) {
    open.sort((a, b) => res.get(a).cost - res.get(b).cost);
    const cur = open.shift(), cc = res.get(cur).cost;
    for (const n of neighbors(cur)) {
      const k = mc[G.cells[n].t];
      if (k >= 99) continue;
      const nc = cc + k;
      if (nc > def.move) continue;
      const o = unitAtIdx(n);
      if (o && o.owner !== u.owner) continue;
      const ex = res.get(n);
      if (ex && ex.cost <= nc) continue;
      res.set(n, { cost: nc, prev: cur });
      open.push(n);
    }
  }
  return res;
}
// 目標地点からの地形コスト距離（AI用、ユニットは無視）
function distField(goal, mtype) {
  const mc = MOVE_COST[mtype];
  const d = new Array(G.cells.length).fill(Infinity);
  d[goal] = 0;
  const open = [goal];
  while (open.length) {
    open.sort((a, b) => d[a] - d[b]);
    const cur = open.shift();
    for (const n of neighbors(cur)) {
      const k = mc[G.cells[cur].t] >= 99 ? 99 : mc[G.cells[n].t];
      if (k >= 99) continue;
      if (d[cur] + k < d[n]) { d[n] = d[cur] + k; open.push(n); }
    }
  }
  return d;
}
function pathTo(reach, idx) {
  const p = [];
  for (let i = idx; i !== -1; i = reach.get(i).prev) p.unshift(i);
  return p;
}
const canStop = (u, idx) => { const o = unitAtIdx(idx); return !o || o === u; };

// ---------- 戦闘計算 ----------
function calcDamage(attType, attHp, def, defHp, luck) {
  const b = DMG[attType][def.type];
  if (b == null) return null;
  const ad = disp(attHp), dd = disp(defHp);
  const stars = UNITS[def.type].air ? 0 : TERRAIN[cellOf(def).t].def;
  return Math.max(0, Math.floor(b * ad / 10 * (100 - stars * dd) / 100 + luck * ad / 10));
}
function canCounter(att, def, defHpAfter, dist) {
  return defHpAfter > 0 && dist === 1 && !UNITS[def.type].indirect && DMG[def.type][att.type] != null;
}
function targetsFrom(u, pos, moved) {
  const d = UNITS[u.type];
  if (d.indirect && moved) return [];
  return G.units.filter((e) => e.owner !== u.owner && DMG[u.type][e.type] != null &&
    (() => { const k = hexDist(pos, unitIdx(e)); return k >= d.range[0] && k <= d.range[1]; })());
}

// ---------- 選択状態 ----------
function clearSel() {
  G.sel = null; G.reach = null; G.atkSet = null; G.targets = null; G.path = null; G.inspect = null;
  hideMenu();
}
function selectUnit(u) {
  G.sel = u; G.startIdx = unitIdx(u);
  G.reach = dijkstra(u, G.startIdx);
  G.atkSet = new Set();
  const d = UNITS[u.type];
  const origins = d.indirect ? [G.startIdx] : [...G.reach.keys()].filter((i) => canStop(u, i));
  for (const o of origins) for (const e of targetsFrom(u, o, false)) G.atkSet.add(unitIdx(e));
  G.phase = 'select';
}

// ---------- アニメーション ----------
function tween(dur, fn) {
  return new Promise((res) => G.tweens.push({ t: 0, dur, fn, res }));
}
function moveSfx(u) {
  const m = UNITS[u.type].mtype;
  Sound.sfx(m === 'foot' ? 'march' : m === 'air' ? 'jet' : 'tread', u.px / worldW());
}
async function moveAlong(u, path) {
  if (path.length < 2) return;
  moveSfx(u);
  const per = UNITS[u.type].air ? 0.07 : 0.11;
  for (let i = 1; i < path.length; i++) {
    const [x0, y0] = center(path[i - 1]), [x1, y1] = center(path[i]);
    const target = Math.atan2(y1 - y0, x1 - x0) + Math.PI / 2;
    const a0 = u.angle, da = ((target - a0 + Math.PI * 3) % (Math.PI * 2)) - Math.PI;
    await tween(per, (k) => {
      u.px = x0 + (x1 - x0) * k; u.py = y0 + (y1 - y0) * k;
      u.angle = a0 + da * Math.min(1, k * 2.5);
    });
  }
  const last = path[path.length - 1];
  const leftCell = G.cells[path[0]];
  if (leftCell.cap < CAPTURE_POINTS) leftCell.cap = CAPTURE_POINTS;
  u.c = last % G.cols; u.r = Math.floor(last / G.cols);
}
function placeAt(u, idx) {
  u.c = idx % G.cols; u.r = Math.floor(idx / G.cols);
  [u.px, u.py] = center(idx);
}
function faceTo(u, idx) {
  const [x, y] = center(idx);
  u.angle = Math.atan2(y - u.py, x - u.px) + Math.PI / 2;
}

function mapExplosion(x, y, s = 1) {
  for (let i = 0; i < 22 * s; i++) {
    const a = Math.random() * Math.PI * 2, v = (20 + Math.random() * 80) * s;
    G.fx.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.4 + Math.random() * 0.4, max: 0.8, size: (3 + Math.random() * 5) * s, kind: 'fire' });
  }
  for (let i = 0; i < 10 * s; i++) {
    const a = Math.random() * Math.PI * 2, v = Math.random() * 30;
    G.fx.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 15, life: 1 + Math.random(), max: 2, size: 6 + Math.random() * 6, kind: 'smoke' });
  }
}
function floatText(idx, text, color) {
  const [x, y] = center(idx);
  G.texts.push({ x, y: y - 10, text, color, life: 1.4 });
}

// ---------- 行動 ----------
async function doAttack(att, def) {
  const aIdx = unitIdx(att), dIdx = unitIdx(def);
  faceTo(att, dIdx); faceTo(def, aIdx);
  const dist = hexDist(aIdx, dIdx);
  const d1 = calcDamage(att.type, att.hp, def, def.hp, Math.floor(Math.random() * 10));
  const defAfter = Math.max(0, def.hp - d1);
  const counter = canCounter(att, def, defAfter, dist);
  let atkAfter = att.hp;
  if (counter) atkAfter = Math.max(0, att.hp - calcDamage(def.type, defAfter, att, att.hp, Math.floor(Math.random() * 10)));
  if (G.anim) {
    await Battle.play({ atk: att, def, atkTerrain: cellOf(att).t, defTerrain: cellOf(def).t, defHpAfter: defAfter, atkHpAfter: atkAfter, counter });
  } else {
    Sound.sfx(UNITS[att.type].weapon === 'mg' ? 'mg' : 'cannon');
    const [x, y] = center(dIdx); mapExplosion(x, y, 0.6);
    await sleep(350);
    if (counter) { const [ax, ay] = center(aIdx); mapExplosion(ax, ay, 0.5); Sound.sfx('hit'); await sleep(300); }
  }
  floatText(dIdx, `-${disp(def.hp) - disp(defAfter)}`, '#ffdd55');
  def.hp = defAfter;
  if (counter) { floatText(aIdx, `-${disp(att.hp) - disp(atkAfter)}`, '#ffdd55'); att.hp = atkAfter; }
  for (const u of [def, att]) if (u.hp <= 0) await destroyUnit(u);
  checkWin();
}
async function destroyUnit(u) {
  const idx = unitIdx(u);
  const [x, y] = center(idx);
  mapExplosion(x, y, 1.3);
  Sound.sfx('destroy', x / worldW());
  G.units = G.units.filter((v) => v !== u);
  const cell = G.cells[idx];
  if (cell.cap < CAPTURE_POINTS) cell.cap = CAPTURE_POINTS;
  await sleep(300);
}
async function doCapture(u) {
  const cell = cellOf(u), idx = unitIdx(u);
  cell.cap -= disp(u.hp);
  if (cell.cap <= 0) {
    cell.cap = CAPTURE_POINTS;
    const wasCapital = cell.t === 'capital';
    cell.owner = u.owner;
    Sound.sfx('capture');
    floatText(idx, '占領！', PLAYERS[u.owner].light);
    if (wasCapital) { G.capitalTaken = u.owner; }
  } else {
    Sound.sfx('select');
    floatText(idx, `占領 ${CAPTURE_POINTS - cell.cap}/${CAPTURE_POINTS}`, '#fff');
  }
  await sleep(400);
  checkWin();
}

// ---------- ターン ----------
function income(p) {
  return G.cells.reduce((s, c) => s + (c.owner === p && isProp(c) ? TERRAIN[c.t].income : 0), 0);
}
async function startTurn(p, first) {
  G.turn = p;
  if (p === 0 && !first) G.day++;
  clearSel();
  G.players[p].funds += income(p);
  for (const u of G.units) {
    u.acted = false;
    if (u.owner === p) {
      const c = cellOf(u);
      if (isProp(c) && c.owner === p && u.hp < 100) { u.hp = Math.min(100, u.hp + 20); floatText(unitIdx(u), '回復', '#7dff9a'); }
    }
  }
  G.phase = 'busy';
  Sound.bgm(p === 0 ? 'blue' : 'red');
  updateHud();
  const gen = G.gen;
  await showBanner(`DAY ${G.day}`, `${PLAYERS[p].name}のターン`, PLAYERS[p].color);
  if (G.over || G.gen !== gen) return;
  if (G.players[p].ai) await runAI(p);
  else G.phase = 'idle';
  updateHud();
}
async function endTurn() {
  if (G.over) return;
  clearSel();
  G.phase = 'busy';
  await startTurn(1 - G.turn, false);
}
function checkWin() {
  if (G.over) return;
  let loser = null, reason = '';
  if (G.capitalTaken != null) { loser = 1 - G.capitalTaken; reason = '首都陥落'; }
  else for (const p of [0, 1]) if (!G.units.some((u) => u.owner === p)) { loser = p; reason = '全部隊壊滅'; }
  if (loser == null) return;
  G.over = true; G.phase = 'over';
  const winner = 1 - loser;
  const humanWon = G.mode === 'pvp' || G.mode === 'watch' ? true : winner === 0;
  Sound.bgm(humanWon ? 'victory' : 'defeat');
  setTimeout(() => {
    $('resultTitle').textContent = G.mode === 'cpu' ? (winner === 0 ? '勝利！' : '敗北…') : `${PLAYERS[winner].name}の勝利！`;
    $('resultTitle').style.color = PLAYERS[winner].color;
    $('resultSub').textContent = `${PLAYERS[loser].name} ${reason}  —  DAY ${G.day}`;
    $('result').classList.add('show');
  }, 900);
}
function showBanner(big, small, color) {
  const b = $('banner');
  $('bannerBig').textContent = big; $('bannerSmall').textContent = small;
  b.style.setProperty('--team', color);
  b.classList.remove('show'); void b.offsetWidth; b.classList.add('show');
  Sound.sfx('turn');
  return sleep(1500);
}

// ---------- AI ----------
async function runAI(p) {
  G.phase = 'busy';
  const gen = G.gen, stale = () => G.over || G.gen !== gen;
  await sleep(300);
  const enemyCap = G.cells.findIndex((c) => c.t === 'capital' && c.owner !== p);
  const reserved = new Set();
  const order = G.units.filter((u) => u.owner === p).sort((a, b) => {
    const pa = UNITS[a.type].indirect ? 0 : 1, pb = UNITS[b.type].indirect ? 0 : 1;
    return pa - pb || hexDist(unitIdx(a), enemyCap) - hexDist(unitIdx(b), enemyCap);
  });
  for (const u of order) {
    if (stale()) return;
    if (!G.units.includes(u) || u.acted) continue;
    const plan = aiPlan(u, p, reserved);
    await aiExecute(u, plan);
  }
  if (stale()) return;
  await aiBuild(p);
  await sleep(400);
  if (!stale()) endTurn();
}

function aiGoal(u, p, reserved) {
  const here = unitIdx(u);
  const myCap = G.cells.findIndex((c) => c.t === 'capital' && c.owner === p);
  const enemies = G.units.filter((e) => e.owner !== p);
  // 首都防衛
  const threat = enemies.filter((e) => e.type === 'infantry' && myCap >= 0 && hexDist(unitIdx(e), myCap) <= 3)
    .sort((a, b) => hexDist(unitIdx(a), here) - hexDist(unitIdx(b), here))[0];
  if (threat && DMG[u.type][threat.type] != null && hexDist(here, unitIdx(threat)) <= 7) return unitIdx(threat);
  if (UNITS[u.type].capture) {
    const props = G.cells.map((c, i) => [c, i]).filter(([c, i]) => isProp(c) && c.owner !== p && !reserved.has(i) && !(unitAtIdx(i) && unitAtIdx(i).owner === p && unitAtIdx(i) !== u))
      .sort((a, b) => (hexDist(here, a[1]) - (a[0].t === 'capital' ? 2 : 0)) - (hexDist(here, b[1]) - (b[0].t === 'capital' ? 2 : 0)));
    if (props.length) { reserved.add(props[0][1]); return props[0][1]; }
  }
  const tgt = enemies.filter((e) => DMG[u.type][e.type] != null)
    .sort((a, b) => hexDist(here, unitIdx(a)) - hexDist(here, unitIdx(b)))[0];
  if (tgt) return unitIdx(tgt);
  return G.cells.findIndex((c) => c.t === 'capital' && c.owner !== p);
}

function aiPlan(u, p, reserved) {
  const d = UNITS[u.type];
  const start = unitIdx(u);
  const reach = dijkstra(u, start);
  const stops = [...reach.keys()].filter((i) => canStop(u, i));
  const goal = aiGoal(u, p, reserved);
  const field = distField(goal, d.mtype);
  const enemies = G.units.filter((e) => e.owner !== p);
  const terrBonus = (i) => d.air ? 0 : TERRAIN[G.cells[i].t].def * 1.5;

  let bestAtk = null, bestCap = null, bestMove = null;
  for (const pos of stops) {
    // 攻撃
    for (const e of targetsFrom(u, pos, pos !== start)) {
      const eIdx = unitIdx(e);
      const saved = [u.c, u.r];
      u.c = pos % G.cols; u.r = Math.floor(pos / G.cols); // 仮配置（反撃計算で地形を見るため）
      const dmg = calcDamage(u.type, u.hp, e, e.hp, 4.5);
      const after = Math.max(0, e.hp - dmg);
      let score = Math.min(dmg, e.hp) * UNITS[e.type].cost / 100;
      if (after <= 0) score += 25 + UNITS[e.type].cost / 20;
      if (canCounter(u, e, after, hexDist(pos, eIdx))) score -= calcDamage(e.type, after, u, u.hp, 4.5) * d.cost / 100 * 0.8;
      const ec = G.cells[eIdx];
      if (e.type === 'infantry' && isProp(ec) && ec.owner === p) score += 30 + (ec.t === 'capital' ? 80 : 0);
      score += terrBonus(pos);
      u.c = saved[0]; u.r = saved[1];
      if (!bestAtk || score > bestAtk.score) bestAtk = { score, pos, target: e, act: 'attack' };
    }
    // 占領
    const cell = G.cells[pos];
    if (d.capture && isProp(cell) && cell.owner !== p) {
      let score = 50 + (cell.t === 'capital' ? 300 : 0) + TERRAIN[cell.t].income / 10;
      if (pos === start && cell.cap < CAPTURE_POINTS) score += 60;
      if (!bestCap || score > bestCap.score) bestCap = { score, pos, act: 'capture' };
    }
    // 移動
    const fd = isFinite(field[pos]) ? field[pos] : hexDist(pos, goal) * 2;
    let ms = -fd * 3 + terrBonus(pos);
    if (d.indirect) {
      const near = Math.min(99, ...enemies.map((e) => hexDist(pos, unitIdx(e))));
      if (near <= 1) ms -= 20; else if (near <= 3) ms += 6;
    }
    if (!bestMove || ms > bestMove.score) bestMove = { score: ms, pos, act: 'wait' };
  }
  let plan = bestMove;
  if (bestCap && !(bestAtk && bestAtk.score > bestCap.score + 20)) plan = bestCap;
  else if (bestAtk && bestAtk.score > 0) plan = bestAtk;
  plan.path = pathTo(reach, plan.pos);
  return plan;
}

async function aiExecute(u, plan) {
  selectUnit(u);
  G.phase = 'busy';
  await sleep(220);
  G.reach = null; G.atkSet = null;
  await moveAlong(u, plan.path);
  if (plan.act === 'attack' && G.units.includes(plan.target)) {
    G.targets = new Set([unitIdx(plan.target)]);
    await sleep(250);
    G.targets = null;
    await doAttack(u, plan.target);
  } else if (plan.act === 'capture') {
    await doCapture(u);
  }
  u.acted = true;
  G.sel = null;
  await sleep(120);
}

async function aiBuild(p) {
  const enemyCap = G.cells.findIndex((c) => c.t === 'capital' && c.owner !== p);
  const sites = G.cells.map((c, i) => [c, i]).filter(([c, i]) => isProp(c) && c.owner === p && !unitAtIdx(i))
    .sort((a, b) => hexDist(a[1], enemyCap) - hexDist(b[1], enemyCap));
  const cnt = (owner, pred) => G.units.filter((u) => u.owner === owner && pred(u)).length;
  for (const [, idx] of sites) {
    const f = G.players[p].funds;
    if (f < 100) break;
    const myInf = cnt(p, (u) => u.type === 'infantry');
    const enemyAir = cnt(1 - p, (u) => UNITS[u.type].air);
    const myAA = cnt(p, (u) => u.type === 'antiair' || u.type === 'fighter');
    const enemyBomber = cnt(1 - p, (u) => u.type === 'bomber');
    let pick = null;
    if (enemyAir > myAA && f >= 250) pick = enemyBomber && f >= 450 && Math.random() < 0.5 ? 'fighter' : 'antiair';
    else if (myInf < 4) pick = 'infantry';
    else {
      const w = { infantry: 1, tank: 3, artillery: 2, antiair: enemyAir ? 1.5 : 0.3, fighter: enemyBomber ? 1.5 : 0.3, bomber: 1.6 };
      const opts = UNIT_ORDER.filter((t) => UNITS[t].cost <= f);
      let sum = opts.reduce((s, t) => s + w[t], 0), r = Math.random() * sum;
      for (const t of opts) { r -= w[t]; if (r <= 0) { pick = t; break; } }
    }
    if (!pick || UNITS[pick].cost > f) pick = 'infantry';
    if (UNITS[pick].cost > f) break;
    buildUnit(p, pick, idx);
    await sleep(300);
  }
}

function buildUnit(p, type, idx) {
  G.players[p].funds -= UNITS[type].cost;
  addUnit(type, p, idx, true);
  Sound.sfx('build', center(idx)[0] / worldW());
  floatText(idx, UNITS[type].name, PLAYERS[p].light);
  updateHud();
}

// ---------- プレイヤー入力 ----------
const humanTurn = () => !G.players[G.turn].ai && !G.over;

async function onClick(idx) {
  if (!humanTurn() || idx < 0) return;
  const u = unitAtIdx(idx), cell = G.cells[idx];
  if (G.phase === 'idle') {
    G.inspect = null;
    if (u && u.owner === G.turn && !u.acted) { selectUnit(u); Sound.sfx('select'); }
    else if (u && u.owner !== G.turn) { G.inspect = dijkstra(u, idx); Sound.sfx('cursor'); }
    else if (!u && isProp(cell) && cell.owner === G.turn) openShop(idx);
  } else if (G.phase === 'select') {
    if (G.reach.has(idx) && canStop(G.sel, idx)) {
      const unit = G.sel;
      G.phase = 'busy';
      const path = pathTo(G.reach, idx);
      G.path = null;
      G.reach = null; G.atkSet = null;
      await moveAlong(unit, path);
      openActionMenu(unit);
    } else { Sound.sfx('cancel'); clearSel(); G.phase = 'idle'; }
  } else if (G.phase === 'target') {
    if (G.targets.has(idx)) {
      const unit = G.sel, target = unitAtIdx(idx);
      G.targets = null; G.phase = 'busy';
      await doAttack(unit, target);
      finishAction(unit);
    } else { Sound.sfx('cancel'); openActionMenu(G.sel); }
  }
}
function cancel() {
  if (!humanTurn()) return;
  if (G.phase === 'select') { Sound.sfx('cancel'); clearSel(); G.phase = 'idle'; }
  else if (G.phase === 'menu') { Sound.sfx('cancel'); undoMove(); }
  else if (G.phase === 'target') { Sound.sfx('cancel'); openActionMenu(G.sel); }
  else if (G.phase === 'shop') closeShop();
  else if (G.phase === 'idle') G.inspect = null;
}
function undoMove() {
  const u = G.sel;
  hideMenu();
  placeAt(u, G.startIdx);
  selectUnit(u);
}
function finishAction(u) {
  if (G.units.includes(u)) u.acted = true;
  clearSel();
  if (!G.over) G.phase = 'idle';
  updateHud();
}

function openActionMenu(u) {
  G.phase = 'menu'; G.targets = null;
  const pos = unitIdx(u), moved = pos !== G.startIdx;
  const tg = targetsFrom(u, pos, moved);
  const cell = G.cells[pos];
  const items = [];
  if (tg.length) items.push(['攻撃', () => { hideMenu(); G.phase = 'target'; G.targets = new Set(tg.map(unitIdx)); Sound.sfx('select'); }]);
  if (UNITS[u.type].capture && isProp(cell) && cell.owner !== u.owner)
    items.push(['占領', async () => { hideMenu(); G.phase = 'busy'; await doCapture(u); finishAction(u); }]);
  items.push(['待機', () => { Sound.sfx('select'); finishAction(u); }]);
  items.push(['キャンセル', () => { Sound.sfx('cancel'); undoMove(); }]);
  const m = $('menu');
  m.innerHTML = '';
  for (const [label, fn] of items) {
    const b = document.createElement('button');
    b.textContent = label;
    b.onclick = (e) => { e.stopPropagation(); fn(); };
    m.appendChild(b);
  }
  const [sx, sy] = toScreen(...center(pos));
  const host = $('mapWrap').getBoundingClientRect();
  m.style.left = Math.min(host.width - 130, sx + HR * view.s * 0.9) + 'px';
  m.style.top = Math.max(4, Math.min(host.height - items.length * 42 - 10, sy - 40)) + 'px';
  m.classList.add('show');
}
function hideMenu() { $('menu').classList.remove('show'); }

function openShop(idx) {
  G.phase = 'shop';
  const p = G.turn, f = G.players[p].funds;
  const list = $('shopList');
  list.innerHTML = '';
  for (const t of UNIT_ORDER) {
    const d = UNITS[t];
    const b = document.createElement('button');
    b.className = 'shopItem';
    b.disabled = d.cost > f;
    b.innerHTML = `<img src="assets/u_${t}.png"><div class="si"><b>${d.name}</b><span class="cost">${d.cost} G</span>
      <small>移動 ${d.move} / 射程 ${d.range[0] === d.range[1] ? d.range[0] : d.range.join('-')}${d.air ? ' / 航空' : ''}</small><small class="desc">${d.desc}</small></div>`;
    b.onclick = () => { buildUnit(p, t, idx); closeShop(); };
    list.appendChild(b);
  }
  $('shopFunds').textContent = `資金 ${f} G`;
  $('shop').classList.add('show');
  Sound.sfx('select');
}
function closeShop() { $('shop').classList.remove('show'); if (G.phase === 'shop') G.phase = 'idle'; }

// ---------- 描画 ----------
let cv, ctx, terrainLayer;
const view = { s: 1, ox: 0, oy: 0, dpr: 1 };
const toScreen = (x, y) => [x * view.s + view.ox, y * view.s + view.oy];

function hash(a, b) { let h = (a * 374761393 + b * 668265263) ^ 0x5bf03635; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }

function buildTerrainLayer() {
  const k = 2;
  terrainLayer = document.createElement('canvas');
  terrainLayer.width = Math.ceil(worldW() * k); terrainLayer.height = Math.ceil(worldH() * k);
  const t = terrainLayer.getContext('2d');
  t.scale(k, k);
  t.fillStyle = '#0d2a45'; t.fillRect(0, 0, worldW(), worldH());
  const draws = [];
  G.cells.forEach((cell, i) => draws.push([cell, i]));
  for (const [cell, i] of draws) {
    const [x, y] = center(i);
    const img = IMG[TERRAIN[cell.t].img];
    t.save();
    hexPath(t, x, y, HR + 0.6); t.clip();
    const size = cell.t === 'capital' ? HR * 2.2 : cell.t === 'city' ? HR * 2.6 : HR * 3.2;
    const jit = cell.t === 'capital' ? 0.5 : null;
    const ox = (jit ?? hash(cell.c, cell.r)) * (size - HR * 2), oy = (jit ?? hash(cell.r + 7, cell.c + 3)) * (size - HR * 2);
    t.drawImage(img, x - HR - ox, y - HR - oy, size, size);
    // 内側の陰影で立体感
    const g = t.createRadialGradient(x - HR * 0.3, y - HR * 0.4, HR * 0.2, x, y, HR * 1.1);
    g.addColorStop(0, 'rgba(255,255,255,0.10)'); g.addColorStop(1, 'rgba(0,0,0,0.28)');
    t.fillStyle = g; t.fillRect(x - HR, y - HR, HR * 2, HR * 2);
    t.restore();
  }
  // 海岸線
  t.strokeStyle = 'rgba(240,225,170,0.55)'; t.lineWidth = 2.5;
  for (const [cell, i] of draws) {
    if (cell.t === 'sea') continue;
    const [x, y] = center(i);
    const c = i % G.cols, r = Math.floor(i / G.cols);
    (r & 1 ? ODD_N : EVEN_N).forEach(([dc, dr], dirI) => {
      if (!inMap(c + dc, r + dr) || G.cells[idxOf(c + dc, r + dr)].t !== 'sea') return;
      // 方向 dirI の辺（0:右,1:右上,2:左上,3:左,4:左下,5:右下）
      const angs = [[-30, 30], [-90, -30], [-150, -90], [150, 210], [90, 150], [30, 90]][dirI];
      t.beginPath();
      angs.forEach((a, j) => { const rad = a * Math.PI / 180; const px = x + HR * Math.cos(rad), py = y + HR * Math.sin(rad); j ? t.lineTo(px, py) : t.moveTo(px, py); });
      t.stroke();
    });
  }
  // グリッド
  t.strokeStyle = 'rgba(0,0,0,0.35)'; t.lineWidth = 1;
  for (const [, i] of draws) { const [x, y] = center(i); hexPath(t, x, y, HR); t.stroke(); }
}

function resize() {
  const wrap = $('mapWrap');
  const w = wrap.clientWidth, h = wrap.clientHeight;
  view.dpr = window.devicePixelRatio || 1;
  cv.width = Math.round(w * view.dpr); cv.height = Math.round(h * view.dpr);
  cv.style.width = w + 'px'; cv.style.height = h + 'px';
  if (!G.cols) return;
  view.s = Math.min(w / worldW(), h / worldH());
  view.ox = (w - worldW() * view.s) / 2; view.oy = (h - worldH() * view.s) / 2;
}

function fillHex(idx, color, r = HR - 1) {
  const [x, y] = center(idx);
  hexPath(ctx, x, y, r); ctx.fillStyle = color; ctx.fill();
}
function strokeHex(idx, color, w, r = HR - 2) {
  const [x, y] = center(idx);
  hexPath(ctx, x, y, r); ctx.strokeStyle = color; ctx.lineWidth = w; ctx.stroke();
}

function drawProps() {
  G.cells.forEach((cell, i) => {
    if (!isProp(cell)) return;
    const P = cell.owner == null ? NEUTRAL : PLAYERS[cell.owner];
    strokeHex(i, P.color, 3.5, HR - 3);
    const [x, y] = center(i);
    // 旗
    const fx = x + HR * 0.38, fy = y - HR * 0.72;
    ctx.strokeStyle = '#222'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(fx, fy); ctx.lineTo(fx, fy + 22); ctx.stroke();
    const wave = Math.sin(G.time * 4 + i) * 2;
    ctx.fillStyle = P.color; ctx.strokeStyle = P.dark; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(fx, fy); ctx.quadraticCurveTo(fx + 8, fy + 2 + wave, fx + 16, fy + 4); ctx.lineTo(fx, fy + 10); ctx.closePath(); ctx.fill(); ctx.stroke();
    if (cell.t === 'capital') {
      ctx.fillStyle = '#ffd84a'; ctx.font = 'bold 13px sans-serif'; ctx.textAlign = 'center';
      ctx.strokeStyle = '#000'; ctx.lineWidth = 3; ctx.strokeText('★', x - HR * 0.45, y - HR * 0.4); ctx.fillText('★', x - HR * 0.45, y - HR * 0.4);
    }
    if (cell.cap < CAPTURE_POINTS) {
      const w = HR * 1.2, k = 1 - cell.cap / CAPTURE_POINTS;
      ctx.fillStyle = '#000a'; ctx.fillRect(x - w / 2, y + HR * 0.55, w, 6);
      ctx.fillStyle = '#ffd84a'; ctx.fillRect(x - w / 2, y + HR * 0.55, w * k, 6);
    }
  });
}

function drawUnit(u) {
  const d = UNITS[u.type], P = PLAYERS[u.owner];
  const lift = d.air ? -7 + Math.sin(G.time * 2 + u.id) * 2 : 0;
  const x = u.px, y = u.py + lift;
  if (d.air) {
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(u.px + 6, u.py + 10, HR * 0.55, HR * 0.3, 0, 0, Math.PI * 2); ctx.fill();
  }
  ctx.save();
  if (u.acted) ctx.filter = 'saturate(0.2) brightness(0.6)';
  const g = ctx.createRadialGradient(x - 6, y - 8, 2, x, y, HR * 0.72);
  g.addColorStop(0, P.light); g.addColorStop(0.55, P.color); g.addColorStop(1, P.dark);
  ctx.globalAlpha = d.air ? 0.8 : 1;
  ctx.beginPath(); ctx.arc(x, y, HR * 0.68, 0, Math.PI * 2);
  ctx.fillStyle = g; ctx.fill();
  ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.stroke();
  ctx.globalAlpha = 1;
  const img = IMG['u_' + u.type];
  const size = HR * (d.air ? 1.55 : u.type === 'infantry' ? 1.15 : 1.22);
  const sc = size / Math.max(img.width, img.height);
  ctx.translate(x, y); ctx.rotate(u.angle);
  ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 4; ctx.shadowOffsetY = 2;
  ctx.drawImage(img, -img.width * sc / 2, -img.height * sc / 2, img.width * sc, img.height * sc);
  ctx.restore();
  const hp = disp(u.hp);
  if (hp < 10) {
    const bx = x + HR * 0.42, by = y + HR * 0.4;
    ctx.fillStyle = '#000c'; ctx.beginPath(); ctx.arc(bx, by, 9, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff'; ctx.font = 'bold 13px Consolas, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(hp, bx, by + 1);
  }
  const cell = cellOf(u);
  if (u.type === 'infantry' && isProp(cell) && cell.owner !== u.owner && cell.cap < CAPTURE_POINTS) {
    ctx.fillStyle = '#ffd84a'; ctx.font = 'bold 11px sans-serif'; ctx.textAlign = 'center';
    ctx.strokeStyle = '#000'; ctx.lineWidth = 3; ctx.strokeText('占領中', x, y - HR * 0.75); ctx.fillText('占領中', x, y - HR * 0.75);
  }
}

function drawForecast() {
  if (G.phase !== 'target' || !G.targets || !G.targets.has(G.hover)) return;
  const a = G.sel, t = unitAtIdx(G.hover);
  const lo = calcDamage(a.type, a.hp, t, t.hp, 0), hi = calcDamage(a.type, a.hp, t, t.hp, 9);
  const after = Math.max(0, t.hp - lo);
  const ct = canCounter(a, t, after, hexDist(unitIdx(a), G.hover)) ? calcDamage(t.type, after, a, a.hp, 9) : null;
  const [x, y] = center(G.hover);
  const lines = [`与ダメージ ${Math.min(lo, t.hp)}〜${Math.min(hi, t.hp)}%`, ct == null ? '反撃なし' : `反撃 最大 ${Math.min(ct, a.hp)}%`];
  ctx.font = 'bold 13px "Yu Gothic UI", Meiryo, sans-serif';
  const w = Math.max(...lines.map((l) => ctx.measureText(l).width)) + 16;
  let bx = x + HR * 0.8, by = y - HR * 1.2;
  if (bx + w > worldW()) bx = x - HR * 0.8 - w;
  if (by < 2) by = y + HR * 0.6;
  ctx.fillStyle = 'rgba(10,14,24,0.88)'; ctx.fillRect(bx, by, w, 44);
  ctx.strokeStyle = '#ff6a5a'; ctx.lineWidth = 1.5; ctx.strokeRect(bx, by, w, 44);
  ctx.fillStyle = '#fff'; ctx.textAlign = 'left'; ctx.textBaseline = 'top';
  lines.forEach((l, i) => ctx.fillText(l, bx + 8, by + 6 + i * 18));
}

function render() {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.fillStyle = '#081521'; ctx.fillRect(0, 0, cv.width, cv.height);
  if (!G.cols) return;
  ctx.setTransform(view.s * view.dpr, 0, 0, view.s * view.dpr, view.ox * view.dpr, view.oy * view.dpr);
  ctx.drawImage(terrainLayer, 0, 0, worldW(), worldH());
  // 海のきらめき
  const pulse = 0.5 + 0.5 * Math.sin(G.time * 3);
  drawProps();
  if (G.inspect) for (const i of G.inspect.keys()) fillHex(i, 'rgba(255,120,60,0.28)');
  if (G.reach) {
    for (const i of G.reach.keys()) if (canStop(G.sel, i)) fillHex(i, `rgba(80,170,255,${0.28 + pulse * 0.1})`);
  }
  if (G.atkSet) for (const i of G.atkSet) { fillHex(i, 'rgba(255,60,50,0.3)'); }
  if (G.targets) for (const i of G.targets) { fillHex(i, `rgba(255,50,40,${0.3 + pulse * 0.25})`); strokeHex(i, '#ff4030', 3); }
  // 経路
  if (G.phase === 'select' && G.reach && G.reach.has(G.hover) && canStop(G.sel, G.hover)) {
    const p = pathTo(G.reach, G.hover).map(center);
    ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 6; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath(); p.forEach(([x, y], i) => i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)); ctx.stroke();
    ctx.strokeStyle = PLAYERS[G.turn].color; ctx.lineWidth = 3; ctx.stroke();
    const [ex, ey] = p[p.length - 1];
    ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(ex, ey, 6, 0, Math.PI * 2); ctx.fill();
  }
  // ユニット（空中ユニットは最後に）
  const sorted = [...G.units].sort((a, b) => (UNITS[a.type].air ? 1 : 0) - (UNITS[b.type].air ? 1 : 0) || a.py - b.py);
  for (const u of sorted) drawUnit(u);
  if (G.sel && G.units.includes(G.sel)) {
    ctx.strokeStyle = `rgba(255,255,255,${0.6 + pulse * 0.4})`; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(G.sel.px, G.sel.py, HR * 0.78 + pulse * 3, 0, Math.PI * 2); ctx.stroke();
  }
  // エフェクト
  for (const q of G.fx) {
    const a = Math.max(0, q.life / q.max);
    if (q.kind === 'smoke') { ctx.globalAlpha = a * 0.5; ctx.fillStyle = '#333'; }
    else { ctx.globalAlpha = a; ctx.fillStyle = a > 0.6 ? '#fff0a0' : a > 0.3 ? '#ff9a2a' : '#c0301a'; }
    ctx.beginPath(); ctx.arc(q.x, q.y, q.size, 0, Math.PI * 2); ctx.fill();
  }
  ctx.globalAlpha = 1;
  for (const t of G.texts) {
    ctx.globalAlpha = Math.min(1, t.life * 2);
    ctx.font = 'bold 18px "Yu Gothic UI", Meiryo, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.strokeStyle = '#000'; ctx.lineWidth = 4; ctx.strokeText(t.text, t.x, t.y);
    ctx.fillStyle = t.color; ctx.fillText(t.text, t.x, t.y);
  }
  ctx.globalAlpha = 1;
  if (G.hover >= 0 && humanTurn()) strokeHex(G.hover, `rgba(255,255,255,${0.7 + pulse * 0.3})`, 2.5, HR - 1.5);
  drawForecast();
}

let lastT = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - lastT) / 1000); lastT = now;
  tick(dt);
  render();
  requestAnimationFrame(frame);
}
function tick(dt) {
  G.time += dt;
  for (const tw of G.tweens) {
    tw.t += dt;
    const k = Math.min(1, tw.t / tw.dur);
    tw.fn(k);
    if (k >= 1) { tw.done = true; tw.res(); }
  }
  G.tweens = G.tweens.filter((t) => !t.done);
  for (const q of G.fx) {
    q.life -= dt; q.x += q.vx * dt; q.y += q.vy * dt;
    q.vx *= 0.94; q.vy *= 0.94;
    if (q.kind === 'smoke') { q.vy -= 10 * dt; q.size += 6 * dt; }
  }
  G.fx = G.fx.filter((q) => q.life > 0);
  for (const t of G.texts) { t.life -= dt; t.y -= 22 * dt; }
  G.texts = G.texts.filter((t) => t.life > 0);
}

// ---------- HUD / サイドパネル ----------
function updateHud() {
  if (!G.cols) return;
  const p = G.turn, P = PLAYERS[p];
  $('hudDay').textContent = `DAY ${G.day}`;
  const chip = $('hudTurn');
  chip.textContent = P.name + (G.players[p].ai ? '（CPU）' : '');
  chip.style.background = P.color;
  $('hudFunds').textContent = `${G.players[p].funds} G`;
  $('btnEnd').disabled = !humanTurn() || G.phase !== 'idle';
  const stats = [0, 1].map((q) => {
    const props = G.cells.filter((c) => c.owner === q && isProp(c)).length;
    const units = G.units.filter((u) => u.owner === q).length;
    return `<div class="stat" style="--team:${PLAYERS[q].color}"><b>${PLAYERS[q].name}${G.players[q].ai ? ' CPU' : ''}</b>
      <span>資金 ${G.players[q].funds}G</span><span>拠点 ${props}（収入 ${income(q)}G）</span><span>部隊 ${units}</span></div>`;
  }).join('');
  $('stats').innerHTML = stats;
  updateInfo();
}
let lastInfoKey = '';
function updateInfo() {
  const idx = G.hover;
  const key = idx + ':' + G.phase + ':' + G.units.length + ':' + (unitAtIdx(idx) ? unitAtIdx(idx).hp : '');
  if (key === lastInfoKey) return;
  lastInfoKey = key;
  const el = $('info');
  if (idx < 0) { el.innerHTML = '<p class="hint">マスにカーソルを合わせると情報を表示します。</p>'; return; }
  const cell = G.cells[idx], T = TERRAIN[cell.t];
  const costs = (m) => MOVE_COST[m][cell.t] >= 99 ? '×' : MOVE_COST[m][cell.t];
  let h = `<div class="tile"><img src="assets/${T.img}.jpg"><div><b>${T.name}</b>${isProp(cell) ? `<span class="own" style="color:${cell.owner == null ? '#ccc' : PLAYERS[cell.owner].color}">${cell.owner == null ? '中立' : PLAYERS[cell.owner].name}</span>` : ''}
    <small>防御 ${'★'.repeat(T.def) || '—'}</small><small>移動コスト 歩${costs('foot')} 車${costs('tread')} 空1</small>
    ${T.income ? `<small>収入 ${T.income}G / 生産・回復可</small>` : ''}</div></div>`;
  const u = unitAtIdx(idx);
  if (u) {
    const d = UNITS[u.type];
    h += `<div class="unitInfo" style="--team:${PLAYERS[u.owner].color}"><img src="assets/u_${u.type}.png"><div><b>${d.name}</b>
      <span>${PLAYERS[u.owner].name}</span><small>HP ${disp(u.hp)}/10　移動 ${d.move}　射程 ${d.range[0] === d.range[1] ? d.range[0] : d.range.join('-')}</small>
      <small class="desc">${d.desc}</small></div></div>`;
  }
  el.innerHTML = h;
}

// ---------- 初期化 ----------
function pickIdx(e) {
  const r = cv.getBoundingClientRect();
  const x = (e.clientX - r.left - view.ox) / view.s, y = (e.clientY - r.top - view.oy) / view.s;
  let best = -1, bd = HR * HR;
  for (let i = 0; i < G.cells.length; i++) {
    const [cx, cy] = center(i);
    const d = (cx - x) ** 2 + (cy - y) ** 2;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

async function startFromTitle(mode) {
  await Sound.init();
  $('title').classList.remove('show');
  $('result').classList.remove('show');
  newGame(mode);
}

window.addEventListener('load', async () => {
  cv = $('map'); ctx = cv.getContext('2d');
  await loadImages();
  Battle.setup($('battle'), $('bcv'), IMG);
  $('loading').remove();
  resize();
  window.addEventListener('resize', resize);
  cv.addEventListener('mousemove', (e) => {
    const i = pickIdx(e);
    if (i !== G.hover) { G.hover = i; updateInfo(); }
  });
  cv.addEventListener('mouseleave', () => { G.hover = -1; updateInfo(); });
  cv.addEventListener('click', (e) => { onClick(pickIdx(e)).then(updateHud); });
  cv.addEventListener('contextmenu', (e) => { e.preventDefault(); cancel(); updateHud(); });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { cancel(); updateHud(); }
    if (e.key === 'm' || e.key === 'M') toggleMute();
    if ((e.key === 'p' || e.key === 'P') && Sound.ready) floatTextScreen(Sound.togglePcm() ? 'PCMドラム ON' : 'PCMドラム OFF（FM）');
  });
  $('btnEnd').onclick = () => { if (humanTurn() && G.phase === 'idle') endTurn(); };
  $('btnAnim').onclick = () => { G.anim = !G.anim; $('btnAnim').textContent = `戦闘アニメ ${G.anim ? 'ON' : 'OFF'}`; };
  $('btnMute').onclick = toggleMute;
  $('btnTitle').onclick = () => { if (Battle.active) return; G.over = true; G.phase = 'title'; Sound.bgm('blue', { mute: { lead: true } }); $('title').classList.add('show'); };
  $('shopClose').onclick = closeShop;
  $('shop').addEventListener('click', (e) => { if (e.target === $('shop')) closeShop(); });
  document.querySelectorAll('[data-mode]').forEach((b) => b.onclick = () => startFromTitle(b.dataset.mode));
  $('btnHelp').onclick = () => $('help').classList.add('show');
  $('helpClose').onclick = () => $('help').classList.remove('show');
  $('resultBack').onclick = () => { $('result').classList.remove('show'); $('title').classList.add('show'); Sound.bgm('blue', { mute: { lead: true } }); };
  requestAnimationFrame(frame);
});
function floatTextScreen(text) {
  const t = $('toast'); t.textContent = text;
  t.classList.remove('show'); void t.offsetWidth; t.classList.add('show');
}
function toggleMute() {
  const m = Sound.toggleMute();
  $('btnMute').textContent = m ? '音 OFF' : '音 ON';
}
