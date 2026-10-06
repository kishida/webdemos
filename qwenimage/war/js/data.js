// ===== ゲームデータ（地形・ユニット・相性表・マップ） =====
'use strict';

const TERRAIN = {
  plains:   { name: '平地', def: 1, img: 't_plains',   bg: 'b_plains' },
  forest:   { name: '森',   def: 2, img: 't_forest',   bg: 'b_forest' },
  mountain: { name: '山岳', def: 4, img: 't_mountain', bg: 'b_desert' },
  sea:      { name: '海',   def: 0, img: 't_sea',      bg: 'b_sky' },
  desert:   { name: '砂漠', def: 1, img: 't_desert',   bg: 'b_desert' },
  city:     { name: '都市', def: 3, img: 't_city',     bg: 'b_city', income: 100, prop: true },
  capital:  { name: '首都', def: 4, img: 't_capital',  bg: 'b_city', income: 200, prop: true },
};

const MAP_CHARS = { '.': 'plains', f: 'forest', m: 'mountain', '~': 'sea', d: 'desert', c: 'city', B: 'city', R: 'city', H: 'capital', Q: 'capital' };
const MAP_OWNER = { B: 0, H: 0, R: 1, Q: 1 };

// odd-r オフセット座標（奇数行が右にずれる）。点対称に近い配置
const MAP_ROWS = [
  '~~~~~..ff.mm..c.~~',
  '~~~...c...mm...RQ~',
  '~~..f...dd...ff.R~',
  '~..ff..c.dd.c....~',
  '~...m..........f.~',
  '~.c.mm..~~~..c...~',
  '~...c..~~~..mm.c.~',
  '~.f..........m...~',
  '~....c.dd.c..ff..~',
  '~B.ff...dd...f..~~',
  '~HB...mm...c...~~~',
  '~~.c..mm.ff..~~~~~',
];

const START_UNITS = [
  { type: 'infantry', col: 2, row: 9, owner: 0 }, { type: 'infantry', col: 3, row: 10, owner: 0 },
  { type: 'tank', col: 2, row: 8, owner: 0 },
  { type: 'infantry', col: 15, row: 2, owner: 1 }, { type: 'infantry', col: 14, row: 1, owner: 1 },
  { type: 'tank', col: 15, row: 3, owner: 1 },
];

const MOVE_COST = {
  foot:  { plains: 1, forest: 1, mountain: 2, desert: 1, city: 1, capital: 1, sea: 99 },
  tread: { plains: 1, forest: 2, mountain: 99, desert: 2, city: 1, capital: 1, sea: 99 },
  air:   { plains: 1, forest: 1, mountain: 1, desert: 1, city: 1, capital: 1, sea: 1 },
};

const UNITS = {
  infantry:  { name: '歩兵',     cost: 100, move: 3, mtype: 'foot',  range: [1, 1], capture: true, weapon: 'mg',
               desc: '安価で山岳も越えられる。都市を占領できる唯一のユニット。' },
  tank:      { name: '戦車',     cost: 350, move: 5, mtype: 'tread', range: [1, 1], weapon: 'cannon',
               desc: '高い攻撃力と機動力を持つ主力。航空機は攻撃できない。' },
  artillery: { name: '自走砲',   cost: 300, move: 4, mtype: 'tread', range: [2, 3], indirect: true, weapon: 'artillery',
               desc: '射程2〜3の間接攻撃。移動後は攻撃できず、反撃も受けない。' },
  antiair:   { name: '対空戦車', cost: 250, move: 5, mtype: 'tread', range: [1, 1], weapon: 'flak',
               desc: '航空機に絶大な威力。歩兵にも強い。' },
  fighter:   { name: '戦闘機',   cost: 450, move: 8, mtype: 'air',   range: [1, 1], air: true, weapon: 'missile',
               desc: '制空戦闘の要。爆撃機を一撃で落とす。地上攻撃は苦手。' },
  bomber:    { name: '爆撃機',   cost: 550, move: 6, mtype: 'air',   range: [1, 1], air: true, weapon: 'bomb',
               desc: 'あらゆる地上目標を粉砕する。航空機は攻撃できない。' },
};
const UNIT_ORDER = ['infantry', 'tank', 'artillery', 'antiair', 'fighter', 'bomber'];

// 基本ダメージ（%）。未定義は攻撃不可
const DMG = {
  infantry:  { infantry: 55, tank: 8,  artillery: 15, antiair: 8 },
  tank:      { infantry: 75, tank: 55, artillery: 70, antiair: 65 },
  artillery: { infantry: 90, tank: 70, artillery: 75, antiair: 75 },
  antiair:   { infantry: 105, tank: 25, artillery: 50, antiair: 45, fighter: 70, bomber: 85 },
  fighter:   { infantry: 30, tank: 10, artillery: 25, antiair: 10, fighter: 55, bomber: 110 },
  bomber:    { infantry: 110, tank: 95, artillery: 105, antiair: 85 },
};

const PLAYERS = [
  { name: 'ブルー軍', color: '#2f7bff', dark: '#123a85', light: '#8fbaff' },
  { name: 'レッド軍', color: '#ff3b3b', dark: '#7d1414', light: '#ffa0a0' },
];
const NEUTRAL = { color: '#d8d8d8', dark: '#555' };
const START_FUNDS = 1000;
const CAPTURE_POINTS = 20;
