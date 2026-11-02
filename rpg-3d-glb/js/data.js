// World map, monsters, items and growth tables.

import { L } from './i18n.js';

export const W = 48, H = 40;

// tile codes
// . grass  , path  ~ water  = bridge  M mountain  # town wall  | palisade  d camp ground  f forest floor
export const BLOCK = new Set(['~', 'M', '#', '|']);

// buildings: footprint size (odd), model name, action
export const BUILDINGS = {
  castle: { size: 5, model: 'castle' },
  inn: { size: 3, model: 'inn' },
  weapon: { size: 3, model: 'weapon_shop' },
  item: { size: 3, model: 'item_shop' },
  house: { size: 3, model: 'house' },
};

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

export const TOWN = { x0: 2, x1: 18, z0: 22, z1: 37 };
export const CAMP = { x0: 33, x1: 46, z0: 1, z1: 14 };
export const inRect = (r, x, z) => x >= r.x0 && x <= r.x1 && z >= r.z0 && z <= r.z1;

export function buildWorld() {
  const r = rng(12345);
  const t = [];
  for (let z = 0; z < H; z++) t.push(new Array(W).fill('.'));
  const set = (x, z, c) => { if (x >= 0 && z >= 0 && x < W && z < H) t[z][x] = c; };
  const get = (x, z) => (x >= 0 && z >= 0 && x < W && z < H ? t[z][x] : 'M');

  // forest floor in the north-west
  for (let z = 1; z < 19; z++) for (let x = 1; x < 26; x++) set(x, z, 'f');

  // river with wiggle
  const riverX = (z) => 27 + Math.round(Math.sin(z * 0.28) * 1.5);
  for (let z = 0; z < H; z++) { const x = riverX(z); set(x, z, '~'); set(x + 1, z, '~'); }

  // border mountains
  for (let x = 0; x < W; x++) { set(x, 0, 'M'); set(x, H - 1, 'M'); }
  for (let z = 0; z < H; z++) { set(0, z, 'M'); set(W - 1, z, 'M'); }
  // mountain clusters
  const blob = (cx, cz, rad) => {
    for (let z = cz - rad; z <= cz + rad; z++) for (let x = cx - rad; x <= cx + rad; x++)
      if ((x - cx) ** 2 + (z - cz) ** 2 <= rad * rad + r() * 2) set(x, z, 'M');
  };
  blob(22, 36, 2); blob(43, 33, 3); blob(31, 20, 1); blob(3, 12, 2); blob(45, 24, 2);

  // town
  const T = TOWN;
  for (let z = T.z0; z <= T.z1; z++) for (let x = T.x0; x <= T.x1; x++) set(x, z, '.');
  for (let x = T.x0; x <= T.x1; x++) { set(x, T.z0, '#'); set(x, T.z1, '#'); }
  for (let z = T.z0; z <= T.z1; z++) { set(T.x0, z, '#'); set(T.x1, z, '#'); }
  for (let z = 29; z <= 31; z++) set(T.x1, z, ',');            // east gate
  for (let x = T.x0 + 1; x <= T.x1; x++) set(x, 30, ',');       // main street
  for (let z = 28; z <= 36; z++) set(10, z, ',');               // north-south street

  // road east to the bridge and then north to the camp
  const bz = 30;
  for (let x = T.x1 + 1; x < 40; x++) if (get(x, bz) !== '~') set(x, bz, ',');
  for (let x = 20; x < 36; x++) if (get(x, bz) === '~') set(x, bz, '=');
  for (let z = 15; z <= bz; z++) set(39, z, ',');
  // a second bridge to the forest (north)
  for (let x = 20; x < 36; x++) if (get(x, 9) === '~') set(x, 9, '=');
  for (let x = 18; x < 33; x++) if (get(x, 9) === 'f' || get(x, 9) === '.') set(x, 9, ',');
  for (let z = 10; z <= 21; z++) if (get(14, z) !== '#') set(14, z, ',');
  for (let x = 14; x <= 18; x++) set(x, 21, ',');
  for (let z = 21; z <= 29; z++) if (get(19, z) !== '#') set(19, z, ',');

  // orc camp
  const C = CAMP;
  for (let z = C.z0; z <= C.z1; z++) for (let x = C.x0; x <= C.x1; x++) set(x, z, 'd');
  for (let x = C.x0; x <= C.x1; x++) set(x, C.z1, '|');
  for (let z = C.z0; z <= C.z1; z++) { set(C.x0, z, '|'); }
  for (let x = 38; x <= 40; x++) set(x, C.z1, ',');            // camp gate
  for (let z = 6; z <= C.z1; z++) set(39, z, ',');

  // buildings (center coords)
  const buildings = [
    { kind: 'castle', x: 10, z: 25 },
    { kind: 'inn', x: 5, z: 33 },
    { kind: 'weapon', x: 15, z: 26 },
    { kind: 'item', x: 15, z: 34 },
    { kind: 'house', x: 5, z: 26 },
  ];
  const owner = {}; // "x,z" -> building
  for (const b of buildings) {
    const h = (BUILDINGS[b.kind].size - 1) / 2;
    for (let z = b.z - h; z <= b.z + h; z++) for (let x = b.x - h; x <= b.x + h; x++) owner[x + ',' + z] = b;
  }

  // props: single-tile blockers
  const props = [];
  const occupied = (x, z) => owner[x + ',' + z] || props.some((p) => p.x === x && p.z === z);
  const addProp = (model, x, z, opt = {}) => { props.push({ model, x, z, rot: opt.rot ?? r() * Math.PI * 2, s: opt.s ?? 1, block: opt.block ?? true }); };

  addProp('well', 12, 33, { rot: 0 });
  addProp('signpost', 21, 31, { rot: -0.4 });
  addProp('signpost', 38, 16, { rot: 0.3 });
  for (const [x, z] of [[36, 4], [44, 4], [35, 10], [44, 10], [42, 7]]) addProp('tent', x, z, { rot: (x > 40 ? -1 : 1) * 0.6 + Math.PI });
  for (const [x, z] of [[40, 9], [36, 7]]) addProp('campfire', x, z, { block: true });

  // trees
  for (let z = 1; z < H - 1; z++) for (let x = 1; x < W - 1; x++) {
    const c = get(x, z);
    if (c !== '.' && c !== 'f') continue;
    if (inRect(T, x, z) || occupied(x, z)) continue;
    const near = (dx, dz) => get(x + dx, z + dz) === ',' || get(x + dx, z + dz) === '=';
    if (near(0, 0) || near(1, 0) || near(-1, 0) || near(0, 1) || near(0, -1)) continue;
    const p = c === 'f' ? 0.42 : 0.07;
    const v = r();
    if (v < p) addProp(r() < (c === 'f' ? 0.6 : 0.3) ? 'pine' : 'tree', x, z, { s: 0.85 + r() * 0.35 });
    else if (v < p + 0.025) addProp('rock', x, z, { s: 0.7 + r() * 0.6 });
  }
  // a few trees inside town for decoration
  for (const [x, z] of [[3, 23], [17, 23], [3, 36], [17, 36], [7, 29], [13, 28], [8, 35]]) addProp('tree', x, z, { s: 0.8 });

  // chests
  const chests = [
    { id: 'c1', x: 4, z: 4, gold: 120 },
    { id: 'c2', x: 24, z: 2, item: 'ether', n: 2 },
    { id: 'c3', x: 45, z: 19, item: 'herb', n: 4 },
    { id: 'c4', x: 31, z: 37, gold: 200 },
    { id: 'c5', x: 45, z: 2, item: 'ether', n: 3 },
    { id: 'c6', x: 8, z: 16, item: 'herb', n: 3 },
  ];
  for (const c of chests) { t[c.z][c.x] = get(c.x, c.z) === 'M' ? '.' : get(c.x, c.z); for (let i = props.length - 1; i >= 0; i--) if (props[i].x === c.x && props[i].z === c.z) props.splice(i, 1); }

  const npcs = [
    { kind: 'king', x: 10, z: 28, rot: 0 },
    { kind: 'princess', x: 11, z: 28, rot: 0 },
    { kind: 'villager', x: 7, z: 31, wander: true, talk: 0 },
    { kind: 'villager', x: 13, z: 31, wander: true, talk: 1 },
    { kind: 'villager', x: 12, z: 35, wander: true, talk: 2 },
  ];
  const signs = {
    '21,31': L(['ひがし：はし をこえて きたへ → オークの とりで', 'にし：アストリアじょう'], ['East: cross the bridge, then north → Orc Fort', 'West: Astria Castle']),
    '38,16': L(['ここから きた　オークの とりで', 'きけん！　よわい ものは たちいるべからず'], ['North: the Orc Fort', 'DANGER! The weak shall not pass.']),
  };

  return { tiles: t, get, buildings, owner, props, chests, npcs, signs, boss: { x: 40, z: 4 }, start: { x: 12, z: 30 } };
}

// ---- monsters ----
// h: height on the field, bh: height on the battle screen
export const MONSTERS = {
  slime: { name: L('スライム', 'Slime'), plural: 'Slimes', hp: 9, atk: 6, def: 2, agi: 3, exp: 3, gold: 4, h: 0.55, bh: 1.5 },
  wolf: { name: L('グレイウルフ', 'Gray Wolf'), plural: 'Gray Wolves', hp: 18, atk: 10, def: 4, agi: 9, exp: 7, gold: 6, h: 0.8, bh: 1.8 },
  goblin: { name: L('ゴブリン', 'Goblin'), plural: 'Goblins', hp: 26, atk: 14, def: 6, agi: 6, exp: 13, gold: 14, h: 0.85, bh: 2.0 },
  skeleton: { name: L('がいこつけんし', 'Skeleton Knight'), plural: 'Skeleton Knights', hp: 40, atk: 20, def: 11, agi: 7, exp: 24, gold: 22, h: 1.05, bh: 2.6 },
  orc_warrior: { name: L('オークせんし', 'Orc Warrior'), plural: 'Orc Warriors', hp: 62, atk: 27, def: 15, agi: 6, exp: 42, gold: 38, h: 1.2, bh: 2.7 },
  orc_leader: { name: L('あかきオークの将', 'Crimson Orc Warlord'), hp: 320, atk: 38, def: 20, agi: 10, exp: 400, gold: 600, h: 1.7, boss: true, bh: 3.9 },
};

// fixed enemy posts: kind, group size (shown on the map), home tile. Each group wanders near
// its post and comes back a while after being defeated. Weak singles by the town, stronger
// and larger groups deeper in.
export const ENEMY_POSTS = [
  // plains around the town
  { kind: 'slime', n: 1, x: 21, z: 26 }, { kind: 'slime', n: 1, x: 23, z: 33 },
  { kind: 'slime', n: 1, x: 20, z: 37 }, { kind: 'slime', n: 1, x: 24, z: 22 },
  { kind: 'slime', n: 1, x: 7, z: 20 }, { kind: 'wolf', n: 1, x: 12, z: 20 },
  { kind: 'wolf', n: 1, x: 24, z: 29 },
  // forest
  { kind: 'wolf', n: 1, x: 8, z: 15 }, { kind: 'goblin', n: 1, x: 12, z: 8 },
  { kind: 'wolf', n: 2, x: 18, z: 15 }, { kind: 'goblin', n: 2, x: 5, z: 6 },
  { kind: 'wolf', n: 1, x: 20, z: 5 }, { kind: 'goblin', n: 1, x: 22, z: 12 },
  // east bank, south
  { kind: 'goblin', n: 1, x: 33, z: 26 }, { kind: 'wolf', n: 2, x: 36, z: 35 },
  { kind: 'goblin', n: 2, x: 44, z: 28 }, { kind: 'skeleton', n: 1, x: 33, z: 36 },
  // east bank, north (before the fort)
  { kind: 'skeleton', n: 1, x: 31, z: 16 }, { kind: 'skeleton', n: 2, x: 44, z: 17 },
  { kind: 'orc_warrior', n: 1, x: 42, z: 21 }, { kind: 'goblin', n: 2, x: 31, z: 5 },
  // orc fort
  { kind: 'orc_warrior', n: 1, x: 37, z: 12 }, { kind: 'orc_warrior', n: 2, x: 42, z: 12 },
  { kind: 'skeleton', n: 2, x: 38, z: 2 }, { kind: 'orc_warrior', n: 2, x: 45, z: 7 },
  { kind: 'skeleton', n: 1, x: 34, z: 7 },
];

// ---- items / equipment ----
export const ITEMS = {
  herb: { name: L('やくそう', 'Herb'), price: 8, desc: L('HPを 35 かいふく', 'Restores 35 HP') },
  ether: { name: L('まほうのみず', 'Magic Water'), price: 25, desc: L('MPを 20 かいふく', 'Restores 20 MP') },
  elixir: { name: L('いのちのみ', 'Life Fruit'), price: 90, desc: L('HPを ぜんかいふく', 'Fully restores HP') },
};
export const WEAPONS = [
  { id: 'stick', name: L('こんぼう', 'Club'), atk: 2, price: 0 },
  { id: 'copper', name: L('どうのつるぎ', 'Copper Sword'), atk: 6, price: 40 },
  { id: 'iron', name: L('てつのつるぎ', 'Iron Sword'), atk: 13, price: 160 },
  { id: 'steel', name: L('はがねのつるぎ', 'Steel Sword'), atk: 21, price: 420 },
  { id: 'mithril', name: L('ミスリルソード', 'Mithril Sword'), atk: 30, price: 900 },
];
export const ARMORS = [
  { id: 'cloth', name: L('ぬののふく', 'Cloth Tunic'), def: 1, price: 0 },
  { id: 'leather', name: L('かわのよろい', 'Leather Armor'), def: 5, price: 50 },
  { id: 'chain', name: L('くさりかたびら', 'Chain Mail'), def: 11, price: 180 },
  { id: 'plate', name: L('はがねのよろい', 'Steel Armor'), def: 18, price: 480 },
  { id: 'dragon', name: L('ドラゴンメイル', 'Dragon Mail'), def: 26, price: 1000 },
];
export const SPELLS = [
  { id: 'fire', name: L('ファイア', 'Fire'), mp: 3, lv: 1, desc: L('てき1たいに ほのおの ダメージ', 'Fire damage to one enemy') },
  { id: 'heal', name: L('ヒール', 'Heal'), mp: 4, lv: 3, desc: L('HPを 60 かいふく', 'Restores 60 HP') },
  { id: 'thunder', name: L('サンダー', 'Thunder'), mp: 7, lv: 6, desc: L('てき ぜんたいに いかずち', 'Lightning on all enemies') },
  { id: 'blaze', name: L('フレア', 'Flare'), mp: 12, lv: 10, desc: L('てき1たいに おおきな ほのお', 'Huge flames on one enemy') },
];

export const expToNext = (lv) => Math.floor(8 * Math.pow(lv, 1.75));

export function newHero() {
  return {
    name: 'アレン', lv: 1, exp: 0, gold: 30,
    hp: 30, mhp: 30, mp: 8, mmp: 8, str: 8, vit: 5, agi: 6, int: 6,
    weapon: 'stick', armor: 'cloth',
    items: { herb: 2 },
    flags: {}, x: 12, z: 30,
  };
}

export function growth(h) {
  const r = Math.random;
  const g = { mhp: 6 + Math.floor(r() * 5), mmp: 2 + Math.floor(r() * 3), str: 2 + Math.floor(r() * 2), vit: 1 + Math.floor(r() * 2), agi: 1 + Math.floor(r() * 2), int: 1 + Math.floor(r() * 2) };
  for (const k in g) h[k] += g[k];
  return g;
}

export const PRINCESS_TALK = {
  before: L(['ひめ「アレンさま…。どうか ごぶじで おかえりくださいね」'], ['Princess: "Sir Allen... please come back safely."']),
  after: L(['ひめ「アレンさま！ ほんとうに ありがとうございました」'], ['Princess: "Sir Allen! Thank you, truly."']),
};

export const VILLAGER_TALK = [
  L(['ここは アストリアの まち。', 'まちの そとには まものが うろついているわ。', 'まずは みなみの くさはらで きたえると いいわよ。'],
    ['This is the town of Astria.', 'Monsters roam outside the walls.', 'Train on the grassland near town first.']),
  L(['きたひがしの とりでに あかい オークが すみついたんだ。', 'あいつは とても つよい。', 'はがねの ぶきと よろいくらいは ほしいところだね。'],
    ['A red orc has taken over the fort to the northeast.', 'He is very strong.', 'You will want steel weapons and armor at least.']),
  L(['やどやで やすめば HPも MPも ぜんかいふく！', 'ぼうけんの きろくも つけておいて くれるのよ。'],
    ['Rest at the inn to fully restore HP and MP!', 'They will record your adventure, too.']),
];
