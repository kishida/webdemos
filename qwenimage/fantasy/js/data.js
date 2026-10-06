// ゲームデータ：アイテム・呪文・モンスター・マップ
'use strict';

const HERO_NAME = 'アレン';
const PRINCESS_NAME = 'リリア';

// ---------------------------------------------------------------- アイテム
const ITEMS = {
  herb:    { name: 'やくそう', icon: 'i_herb', price: 8, type: 'use', heal: 30, desc: 'HPを 30ほど かいふくする' },
  potion:  { name: 'ポーション', icon: 'i_potion', price: 30, type: 'use', heal: 80, desc: 'HPを 80ほど かいふくする' },
  ether:   { name: 'まほうのみず', icon: 'i_ether', price: 50, type: 'use', mp: 20, desc: 'MPを 20 かいふくする' },
  elixir:  { name: 'エリクサー', icon: 'i_elixir', price: 500, type: 'use', heal: 999, mp: 999, desc: 'HPと MPを ぜんかいふく' },
  wing:    { name: 'きかんのはね', icon: 'i_wing', price: 25, type: 'use', field: 'return', desc: 'しろの まえに もどる（フィールドで）' },
  key:     { name: 'ぎんのかぎ', icon: 'i_key', price: 0, type: 'key', desc: 'どうくつの ぎんのとびらを ひらく' },
  stick:   { name: 'こんぼう', icon: 'i_sword1', price: 10, type: 'weapon', atk: 3, desc: 'こうげき+3' },
  copper:  { name: 'どうのつるぎ', icon: 'i_sword1', price: 120, type: 'weapon', atk: 8, desc: 'こうげき+8' },
  steel:   { name: 'はがねのつるぎ', icon: 'i_sword2', price: 650, type: 'weapon', atk: 20, desc: 'こうげき+20' },
  holy:    { name: 'せいけんライト', icon: 'i_sword3', price: 0, type: 'weapon', atk: 36, desc: 'こうげき+36 りゅうを たつ せいけん' },
  wshield: { name: 'きのたて', icon: 'i_shield1', price: 70, type: 'shield', def: 4, desc: 'しゅび+4' },
  sshield: { name: 'はがねのたて', icon: 'i_shield2', price: 480, type: 'shield', def: 12, desc: 'しゅび+12' },
  cloth:   { name: 'ぬののふく', icon: 'i_armor1', price: 10, type: 'armor', def: 2, desc: 'しゅび+2' },
  leather: { name: 'かわのよろい', icon: 'i_armor1', price: 110, type: 'armor', def: 7, desc: 'しゅび+7' },
  chain:   { name: 'くさりかたびら', icon: 'i_armor2', price: 380, type: 'armor', def: 15, desc: 'しゅび+15' },
  silver:  { name: 'ぎんのよろい', icon: 'i_armor3', price: 1300, type: 'armor', def: 26, desc: 'しゅび+26' },
};

const SHOPS = {
  item: { title: 'どうぐや', bg: 'ev_shop', keeper: 'c_merchant', goods: ['herb', 'potion', 'ether', 'wing'],
    hello: 'いらっしゃいませ！ ここは どうぐやです。' },
  smith: { title: 'ぶきと ぼうぐの みせ', bg: 'ev_smith', keeper: 'c_smith', goods: ['copper', 'steel', 'wshield', 'sshield', 'leather', 'chain', 'silver'],
    hello: 'おう！ ぶきと ぼうぐの みせだ。 いいもの そろってるぜ。' },
};
const INN_PRICE = 10;

// ---------------------------------------------------------------- 呪文
const SPELLS = {
  heal:   { name: 'ヒール', mp: 3, lv: 1, kind: 'heal', power: [28, 36], field: true, desc: 'HPを かいふくする' },
  fire:   { name: 'ファイア', mp: 3, lv: 3, kind: 'attack', power: [12, 18], all: false, desc: 'てき1たいを ほのおで やく' },
  ret:    { name: 'リターン', mp: 6, lv: 5, kind: 'return', field: true, battle: false, desc: 'しろの まえに もどる' },
  blaze:  { name: 'ブレイズ', mp: 6, lv: 8, kind: 'attack', power: [22, 30], all: true, desc: 'てき ぜんたいを ほのおで やく' },
  hiheal: { name: 'ハイヒール', mp: 8, lv: 10, kind: 'heal', power: [85, 100], field: true, desc: 'HPを おおきく かいふく' },
  thunder:{ name: 'サンダー', mp: 10, lv: 13, kind: 'attack', power: [55, 70], all: false, desc: 'てき1たいに いかずちを おとす' },
};

// ---------------------------------------------------------------- 成長
// レベル n に必要な累計経験値
const EXP_TABLE = [0, 0, 7, 20, 42, 75, 120, 185, 270, 380, 520, 700, 920, 1200, 1550, 1950, 2450, 3050, 3750, 4600, 5600];
const GROWTH = { hp: [6, 9], mp: [2, 4], atk: [2, 3], def: [1, 3], agi: [1, 3] };

// ---------------------------------------------------------------- モンスター
// acts: [重み, 種類, 引数]
const MONSTERS = {
  slime:    { name: 'スライム', img: 'm_slime', hp: 7, atk: 6, def: 2, agi: 3, exp: 2, gold: 3, scale: 0.55 },
  bat:      { name: 'ドラキバット', img: 'm_bat', hp: 11, atk: 8, def: 3, agi: 12, exp: 3, gold: 4, scale: 0.6 },
  goblin:   { name: 'ゴブリン', img: 'm_goblin', hp: 15, atk: 11, def: 4, agi: 6, exp: 6, gold: 8, scale: 0.75 },
  wolf:     { name: 'ワイルドウルフ', img: 'm_wolf', hp: 24, atk: 15, def: 7, agi: 11, exp: 10, gold: 9, scale: 0.8 },
  snake:    { name: 'キングコブラ', img: 'm_snake', hp: 30, atk: 19, def: 9, agi: 9, exp: 14, gold: 14, scale: 0.8,
    acts: [[3, 'attack'], [1, 'strong', { name: 'どくのきば', mul: 1.4 }]] },
  skeleton: { name: 'ガイコツけんし', img: 'm_skeleton', hp: 40, atk: 25, def: 14, agi: 8, exp: 22, gold: 20, scale: 0.85 },
  ghost:    { name: 'さまようゴースト', img: 'm_ghost', hp: 32, atk: 21, def: 18, agi: 14, exp: 20, gold: 18, scale: 0.75,
    acts: [[3, 'attack'], [1, 'spell', { name: 'ファイア', power: [12, 18] }]] },
  orc:      { name: 'オークせんし', img: 'm_orc', hp: 60, atk: 34, def: 18, agi: 7, exp: 36, gold: 32, scale: 0.95,
    acts: [[4, 'attack'], [1, 'strong', { name: 'おのを ふりまわした', mul: 1.5 }]] },
  mage:     { name: 'やみのまどうし', img: 'm_mage', hp: 48, atk: 26, def: 15, agi: 13, exp: 40, gold: 40, scale: 0.85,
    acts: [[2, 'attack'], [2, 'spell', { name: 'ブレイズ', power: [22, 30] }], [1, 'healself', { name: 'ヒール', power: [30, 40] }]] },
  golem:    { name: 'ゴーレム', img: 'm_golem', hp: 150, atk: 40, def: 22, agi: 4, exp: 260, gold: 200, scale: 1, boss: true,
    acts: [[4, 'attack'], [2, 'strong', { name: 'いわを なげつけた', mul: 1.5 }], [1, 'idle', { text: 'は ようすを うかがっている' }]] },
  dragon:   { name: 'こくりゅうヴァルガ', img: 'm_dragon', hp: 360, atk: 66, def: 30, agi: 15, exp: 500, gold: 0, scale: 1, boss: true, twice: true,
    acts: [[4, 'attack'], [2, 'breath', { name: 'はげしい ほのおを はいた', power: [30, 42] }], [2, 'strong', { name: 'しっぽで なぎはらった', mul: 1.35 }], [1, 'idle', { text: 'は おぞましい ほうこうを あげた！' }]] },
};

// エンカウントテーブル
const ENCOUNTERS = {
  near: [['slime'], ['slime', 'slime'], ['bat'], ['slime', 'bat']],
  south: [['slime', 'slime'], ['goblin'], ['bat', 'bat'], ['goblin', 'slime'], ['slime', 'slime', 'slime']],
  forest: [['wolf'], ['goblin', 'goblin'], ['wolf', 'bat'], ['goblin', 'bat']],
  north: [['wolf'], ['snake'], ['wolf', 'goblin'], ['snake', 'bat'], ['goblin', 'goblin', 'goblin']],
  cave1: [['skeleton'], ['ghost'], ['bat', 'bat', 'bat'], ['skeleton', 'bat'], ['ghost', 'ghost'], ['snake', 'snake']],
  cave2: [['orc'], ['mage'], ['skeleton', 'ghost'], ['orc', 'skeleton']],
};

// ---------------------------------------------------------------- マップ
// 各マップのタイル定義： base=テクスチャ, obj=重ねる画像, solid=通れない, enc=エンカウント率
const TILES = {
  '.': { base: 't_grass', enc: 1 / 22 },
  ',': { base: 't_grass', obj: 'o_flower', enc: 1 / 22 },
  'f': { base: 't_grass', obj: 'o_tree', enc: 1 / 11, zone: 'forest' },
  'q': { base: 't_grass', obj: 'o_pine', enc: 1 / 11, zone: 'forest' },
  'T': { base: 't_grass', obj: 'o_tree', solid: true },
  'P': { base: 't_grass', obj: 'o_pine', solid: true },
  'M': { base: 't_grass', obj: 'o_mountain', solid: true },
  'R': { base: 't_grass', obj: 'o_rock', solid: true },
  'w': { base: 't_water', solid: true, water: true },
  's': { base: 't_sand', enc: 1 / 30 },
  'p': { base: 't_path', enc: 1 / 60 },
  '=': { base: 't_water', obj: 'o_bridge', water: true },
  'C': { base: 't_grass', big: 'o_castle_icon' },
  'V': { base: 't_grass', big: 'o_town_icon' },
  'O': { base: 't_grass', big: 'o_cave_icon' },
  // 街
  'c': { base: 't_cobble' },
  'F': { base: 't_cobble', big: 'o_fountain', solid: true },
  'H': { base: 't_grass', big: 'o_house', solid: true },
  'N': { base: 't_grass', big: 'o_inn', solid: true, group: 'N' },
  'S': { base: 't_grass', big: 'o_shop', solid: true, group: 'S' },
  'W': { base: 't_grass', big: 'o_smith', solid: true, group: 'W' },
  '1': { base: 't_grass', group: 'N', door: 'inn' },
  '2': { base: 't_grass', group: 'S', door: 'item' },
  '3': { base: 't_grass', group: 'W', door: 'smith' },
  'b': { base: 't_grass', obj: 'o_barrel', solid: true },
  // 城
  '#': { base: 't_castle_wall', solid: true, wall: true },
  't': { base: 't_castle_wall', obj: 'o_torch', solid: true, wall: true, light: true },
  '_': { base: 't_castle_floor' },
  'r': { base: 't_carpet' },
  'K': { base: 't_carpet', obj: 'o_throne', solid: true },
  'I': { base: 't_castle_floor', obj: 'o_pillar', solid: true },
  // 洞窟
  'X': { base: 't_cave_wall', solid: true, wall: true },
  'g': { base: 't_cave_floor', enc: 1 / 14 },
  'h': { base: 't_cave_floor' },
  'L': { base: 't_lava', solid: true, light: true },
  'o': { base: 't_cave_floor', obj: 'o_rock', solid: true },
  'D': { base: 't_cave_floor', obj: 'o_stairs_down' },
  'U': { base: 't_cave_floor', obj: 'o_stairs_up' },
  'G': { base: 't_cave_floor', obj: 'o_door', solid: true, lockdoor: true },
};

// --- 疑似乱数（マップ生成を毎回同じにする）
function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function valueNoise(seed, scale) {
  const h = (x, y) => { let n = (x * 374761393 + y * 668265263 + seed * 1442695041) | 0; n = Math.imul(n ^ (n >>> 13), 1274126177); return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
  const sm = (t) => t * t * (3 - 2 * t);
  return (x, y) => {
    const fx = x / scale, fy = y / scale, x0 = Math.floor(fx), y0 = Math.floor(fy), tx = sm(fx - x0), ty = sm(fy - y0);
    const a = h(x0, y0), b = h(x0 + 1, y0), c = h(x0, y0 + 1), d = h(x0 + 1, y0 + 1);
    return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
  };
}

// ---- フィールド（手続き生成＋固定ランドマーク）
function buildField() {
  const W = 60, H = 46, R = rng(7);
  const g = Array.from({ length: H }, () => Array(W).fill('w'));
  const n1 = valueNoise(11, 7), n2 = valueNoise(23, 5), n3 = valueNoise(37, 4), n4 = valueNoise(41, 3);
  const riverY = (x) => 21 + Math.round(1.6 * Math.sin(x * 0.23));
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const dx = (x - 30) / 27, dy = (y - 23) / 20.5;
    const d = Math.sqrt(dx * dx + dy * dy) + (n1(x, y) - 0.5) * 0.35;
    if (d < 1) g[y][x] = '.';
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (g[y][x] !== '.') continue;
    const north = y < riverY(x);
    const m = n2(x, y), f = n3(x, y), r = R();
    if (m > (north ? 0.66 : 0.78)) g[y][x] = 'M';
    else if (f > (north ? 0.56 : 0.62)) g[y][x] = north ? 'q' : 'f';
    else if (r < 0.025) g[y][x] = north ? 'P' : 'T';
    else if (r < 0.05) g[y][x] = ',';
    else if (n4(x, y) > 0.82 && r < 0.3) g[y][x] = 'R';
  }
  // 川
  for (let x = 0; x < W; x++) { const ry = riverY(x); for (const y of [ry, ry + 1]) if (g[y][x] !== 'w') g[y][x] = 'r'; }
  // 砂浜（海に隣接する陸）
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (g[y][x] === 'w' || g[y][x] === 'r') continue;
    const adj = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => (g[y + b] && g[y + b][x + a]) === 'w');
    if (adj && g[y][x] !== 'M') g[y][x] = 's';
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (g[y][x] === 'r') g[y][x] = 'w';
  // ランドマーク周辺を整地
  const clear = (x0, y0, x1, y1) => { for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (!'wC'.includes(g[y][x])) g[y][x] = '.'; };
  const LM = { castle: [27, 33], town: [43, 30], cave: [30, 7] };
  clear(24, 31, 33, 38); clear(41, 28, 47, 34); clear(28, 5, 33, 10);
  const put = (ch, [x, y]) => { g[y][x] = g[y][x + 1] = g[y + 1][x] = g[y + 1][x + 1] = ch; };
  put('C', LM.castle); put('V', LM.town); put('O', LM.cave);
  // 洞窟を山で囲む
  for (const [x, y] of [[28, 5], [29, 5], [32, 5], [33, 5], [28, 6], [33, 6], [28, 7], [33, 7], [28, 8], [33, 8], [29, 4], [30, 4], [31, 4], [32, 4]]) g[y][x] = 'M';
  // 道
  const path = (x, y) => { if (g[y][x] === 'w') g[y][x] = '='; else if (!'CVO'.includes(g[y][x])) g[y][x] = 'p'; };
  for (let x = 27; x <= 44; x++) path(x, 35);
  for (let y = 32; y <= 35; y++) path(44, y);
  for (let y = 9; y <= 35; y++) path(31, y);
  for (let x = 27; x <= 28; x++) path(x, 35);
  const rows = g.map((r) => r.join(''));
  return {
    rows, fill: 'w', music: 'field', name: 'フィールド', outdoor: true,
    warps: [
      { ch: 'C', to: ['castle', 10, 16, 'up'] },
      { ch: 'V', to: ['town', 12, 19, 'up'] },
      { ch: 'O', to: ['cave1', 11, 18, 'up'] },
    ],
    encZone(x, y) {
      const dc = Math.hypot(x - 28, y - 34);
      if (y < riverY(x)) return 'north';
      if (dc < 9) return 'near';
      return 'south';
    },
    LM,
  };
}

// ---- 城
function buildCastle() {
  return {
    rows: [
      '#####################',
      '##t###t###t###t###t##',
      '##_______IKI_______##',
      '##________r________##',
      '##_I______r______I_##',
      '##_______rrr_______##',
      '##_I_____rrr_____I_##',
      '##_______rrr_______##',
      '#######__rrr__#######',
      '#t___#___rrr___#___t#',
      '#____#___rrr___#____#',
      '#____#___rrr___#____#',
      '#____##__rrr__##____#',
      '#________rrr________#',
      '#________rrr________#',
      '#_I______rrr______I_#',
      '#________rrr________#',
      '#########rrr#########',
    ],
    fill: '#', music: 'castle', name: 'アリアじょう',
    edgeExit: ['field', 28, 35, 'down'],
    npcs: [
      { id: 'king', img: 'c_king', x: 10, y: 2, talk: 'king' },
      { id: 'minister', img: 'c_minister', x: 8, y: 3, talk: 'minister' },
      { id: 'guard1', img: 'c_guard', x: 8, y: 16, talk: 'guard1' },
      { id: 'guard2', img: 'c_guard', x: 12, y: 16, talk: 'guard2' },
      { id: 'soldier', img: 'c_guard', x: 3, y: 11, talk: 'soldier', wander: true },
      { id: 'maid', img: 'c_woman', x: 17, y: 13, talk: 'maid', wander: true },
    ],
    chests: [
      { id: 'c_castle1', x: 2, y: 10, item: 'herb' },
      { id: 'c_castle2', x: 18, y: 10, gold: 120 },
    ],
  };
}

// ---- 街
function buildTown() {
  return {
    rows: [
      'TTTTTTTTTTTTTTTTTTTTTTTTTT',
      'T........................T',
      'T.NNN......cc.....SSS....T',
      'T.NNN......cc.....SSS..b.T',
      'T.N1N......cc.....S2S....T',
      'T...c......cc.......c....T',
      'T...cccccccccccccccccc...T',
      'T..........cc............T',
      'T.HHH....ccFFcc....WWW...T',
      'T.HHH....ccFFcc....WWW...T',
      'T.HHH....cccccc....W3W...T',
      'T..........cc.......c....T',
      'T...cccccccccccccccccc...T',
      'T..........cc............T',
      'T.,,.......cc.......HHH..T',
      'T.,,.......cc.......HHH..T',
      'T..........cc.......HHH..T',
      'T..ww......cc............T',
      'T..ww......cc.........b..T',
      'T..........cc............T',
      'TTTTTTTTTTTcccTTTTTTTTTTTT',
    ],
    fill: '.', music: 'town', name: 'ルミナのまち',
    edgeExit: ['field', 44, 32, 'down'],
    npcs: [
      { id: 'child', img: 'c_child', x: 13, y: 17, talk: 'child', wander: true },
      { id: 'man1', img: 'c_man', x: 6, y: 7, talk: 'man1', wander: true },
      { id: 'woman1', img: 'c_woman', x: 16, y: 13, talk: 'woman1', wander: true },
      { id: 'man2', img: 'c_man', x: 8, y: 13, talk: 'man2' },
      { id: 'elder', img: 'c_elder', x: 21, y: 17, talk: 'elder' },
      { id: 'woman2', img: 'c_innkeeper', x: 5, y: 18, talk: 'woman2' },
      { id: 'guardT', img: 'c_guard', x: 14, y: 19, talk: 'guardT' },
    ],
    chests: [{ id: 'c_town1', x: 24, y: 1, item: 'potion' }],
  };
}

// ---- 洞窟 B1（迷路を生成）
function buildCave1() {
  const CW = 11, CH = 8, R = rng(1234);
  const W = CW * 2 + 1, MH = CH * 2 + 1;
  const g = Array.from({ length: MH }, () => Array(W).fill('X'));
  const seen = Array.from({ length: CH }, () => Array(CW).fill(false));
  const start = [5, CH - 1];
  const stack = [start]; seen[start[1]][start[0]] = true; g[start[1] * 2 + 1][start[0] * 2 + 1] = 'g';
  const dist = { [start]: 0 };
  while (stack.length) {
    const [cx, cy] = stack[stack.length - 1];
    const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([a, b]) => [cx + a, cy + b]).filter(([x, y]) => x >= 0 && y >= 0 && x < CW && y < CH && !seen[y][x]);
    if (!nb.length) { stack.pop(); continue; }
    const [nx, ny] = nb[Math.floor(R() * nb.length)];
    seen[ny][nx] = true; dist[[nx, ny]] = dist[[cx, cy]] + 1;
    g[cy + ny + 1][cx + nx + 1] = 'g'; g[ny * 2 + 1][nx * 2 + 1] = 'g';
    stack.push([nx, ny]);
  }
  const open = (x, y) => g[y] && g[y][x] && g[y][x] !== 'X';
  const deadEnds = () => {
    const out = [];
    for (let cy = 0; cy < CH; cy++) for (let cx = 0; cx < CW; cx++) {
      const x = cx * 2 + 1, y = cy * 2 + 1;
      const n = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([a, b]) => open(x + a, y + b));
      if (n.length === 1) out.push({ cx, cy, x, y, d: dist[[cx, cy]], via: n[0] });
    }
    return out;
  };
  // 最も遠い行き止まりを階段に
  const ends = deadEnds().sort((a, b) => b.d - a.d);
  const stair = ends.find((e) => !(e.cx === start[0] && e.cy === start[1]));
  const golem = [stair.x + stair.via[0], stair.y + stair.via[1]];
  // 宝箱を置く行き止まり（遠い順）
  const chestSpots = ends.filter((e) => e !== stair && Math.abs(e.x - golem[0]) + Math.abs(e.y - golem[1]) > 2).slice(0, 3);
  // 残りの行き止まりを一部つなげて迷いにくくする
  for (const e of deadEnds()) {
    if ((e.cx === start[0] && e.cy === start[1]) || e === stair || chestSpots.some((c) => c.x === e.x && c.y === e.y) || (e.x === stair.x && e.y === stair.y)) continue;
    if (R() < 0.6) {
      const opts = [[1, 0], [-1, 0], [0, 1], [0, -1]].filter(([a, b]) => {
        const wx = e.x + a, wy = e.y + b, tx = e.x + 2 * a, ty = e.y + 2 * b;
        return g[wy] && g[wy][wx] === 'X' && tx > 0 && ty > 0 && tx < W - 1 && ty < MH - 1 && !(tx === stair.x && ty === stair.y)
          && !(wx === golem[0] && wy === golem[1]) && Math.abs(tx - stair.x) + Math.abs(ty - stair.y) > 2;
      });
      if (opts.length) { const [a, b] = opts[Math.floor(R() * opts.length)]; g[e.y + b][e.x + a] = 'g'; }
    } else if (R() < 0.5) g[e.y][e.x] = 'o';
  }
  g[stair.y][stair.x] = 'D';
  // 入口エリア
  const doorX = start[0] * 2 + 1;
  g[MH - 1][doorX] = 'G';
  const rows = g.map((r) => r.join(''));
  rows.push('XXXXXXXXhhhhhhhXXXXXXXX'.padEnd(W, 'X'));
  rows.push('XXXXXXXXhhhhhhhXXXXXXXX'.padEnd(W, 'X'));
  rows.push('XXXXXXXXLhhUhhLXXXXXXXX'.padEnd(W, 'X'));
  rows.push('X'.repeat(W));
  return {
    rows, fill: 'X', music: 'cave', name: 'きたのどうくつ B1', dark: true,
    warps: [{ ch: 'U', to: ['field', 31, 9, 'down'] }, { ch: 'D', to: ['cave2', 10, 12, 'up'] }],
    encZone: () => 'cave1',
    npcs: [{ id: 'golem', img: 'm_golem', x: golem[0], y: golem[1], talk: 'golem', monster: true, size: 1.6, hideIf: 'golemDead' }],
    chests: [
      { id: 'c_cave1', x: chestSpots[0].x, y: chestSpots[0].y, item: 'chain' },
      { id: 'c_cave2', x: chestSpots[1].x, y: chestSpots[1].y, gold: 300 },
      { id: 'c_cave3', x: chestSpots[2].x, y: chestSpots[2].y, item: 'ether' },
    ],
    golemSpot: golem,
    doorSpot: [doorX, MH - 1],
  };
}

// ---- 洞窟 B2（竜の巣）
function buildCave2() {
  return {
    rows: [
      'XXXXXXXXXXXXXXXXXXXXX',
      'XXXLLXXXXXXXXXXXLLXXX',
      'XXLLhhhhhhhhhhhhhLLXX',
      'XXLhhhhhhhhhhhhhhhLXX',
      'XXLhhhhhhhhhhhhhhhLXX',
      'XXLhhhhhhhhhhhhhhhLXX',
      'XXLLhhhhhhhhhhhhhLLXX',
      'XXXLLggggLLLggggLLXXX',
      'XXXXLggggLLLggggLXXXX',
      'XXXXLgggggggggggLXXXX',
      'XXXXXLLgggggggLLXXXXX',
      'XXXXXXXgggggggXXXXXXX',
      'XXXXXXXXgggggXXXXXXXX',
      'XXXXXXXXggUggXXXXXXXX',
      'XXXXXXXXXXXXXXXXXXXXX',
    ],
    fill: 'X', music: 'cave', name: 'りゅうのす B2', dark: true,
    warps: [{ ch: 'U', to: ['cave1', null, null, 'down'] }],
    encZone: () => 'cave2',
    npcs: [
      { id: 'dragon', img: 'm_dragon', x: 10, y: 5, talk: 'dragon', monster: true, size: 4, hideIf: 'dragonDead' },
      { id: 'princess', img: 'c_princess', x: 10, y: 3, talk: 'princess', hideIf: 'rescued' },
    ],
    chests: [
      { id: 'c_lair1', x: 4, y: 3, item: 'holy' },
      { id: 'c_lair2', x: 16, y: 3, item: 'elixir' },
    ],
  };
}

const MAPS = { field: buildField(), castle: buildCastle(), town: buildTown(), cave1: buildCave1(), cave2: buildCave2() };
MAPS.cave2.warps[0].to = ['cave1', MAPS.cave1.golemSpot[0], MAPS.cave1.golemSpot[1], 'down'];
