import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Sfx } from './audio.js';
import { Forest } from './forest.js';
import { Ship } from './ship.js';

const $ = id => document.getElementById(id);

// ---------------------------------------------------------------- renderer
const canvas = $('game');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const composer = new EffectComposer(renderer);
const renderPass = new RenderPass(new THREE.Scene(), new THREE.PerspectiveCamera());
composer.addPass(renderPass);
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.7, 0.5, 0.82);
composer.addPass(bloom);
composer.addPass(new OutputPass());

// ---------------------------------------------------------------- assets
const TEX = {
  forest_ground: 'jpg', forest_ground_n: 'jpg', wall: 'jpg', wall_n: 'jpg', floor: 'jpg', floor_n: 'jpg',
  ceiling: 'jpg', ceiling_n: 'jpg', hive: 'jpg', hive_n: 'jpg', door: 'jpg',
  ship_ext: 'png', tree_pine: 'png', tree_oak: 'png', tree_dead: 'png', bush: 'png', rock: 'png',
  player: 'png', hound: 'png', drone: 'png', spitter: 'png', queen: 'png',
  artifact_crystal: 'png', artifact_orb: 'png', artifact_core: 'png', crate: 'png',
};
const ASSET_VER = Date.now();   // cache-bust while assets are being regenerated
const assets = {};
const manager = new THREE.LoadingManager();
const loader = new THREE.TextureLoader(manager);
const maxAniso = renderer.capabilities.getMaxAnisotropy();
for (const [name, ext] of Object.entries(TEX)) {
  assets[name] = loader.load(`assets/${name}.${ext}?v=${ASSET_VER}`, t => {
    t.colorSpace = name.endsWith('_n') ? THREE.NoColorSpace : THREE.SRGBColorSpace;
    t.anisotropy = maxAniso;
  });
}
manager.onProgress = (_, done, total) => { $('start').textContent = `LOADING ${Math.round(done / total * 100)}%`; };
manager.onLoad = () => { $('start').textContent = 'START'; $('start').disabled = false; };
manager.onError = url => console.error('failed to load', url);

// ---------------------------------------------------------------- game state
export const ARTIFACTS = {
  crystal: { img: 'assets/artifact_crystal.png', name: '蒼晶の欠片', color: 0x55e0ff,
    text: '冷たい光を放つ結晶。握ると体の奥から力が湧き、傷がゆっくりと塞がっていく。\n最大HP +40 ／ HP自然回復' },
  orb: { img: 'assets/artifact_orb.png', name: '熾火のオーブ', color: 0xff8030,
    text: '回路のような紋様が脈打つ黒い球体。武器に近づけるとパルス弾が赤熱した。\n攻撃力 ×1.6' },
  core: { img: 'assets/artifact_core.png', name: '原初のコア', color: 0xb070ff,
    text: '異星船の心臓。黄金の檻の中で紫の光が鼓動している。\n全てのアーティファクトが揃った——' },
};

const player = {
  hp: 100, maxHp: 100, lv: 1, xp: 0, next: 60, mag: 30, magSize: 30, ammo: 90, medkits: 2,
  dmg: 14, dmgMul: 1, regen: 0, artifacts: [], kills: 0, reloading: 0, fireCd: 0, dead: false,
};

export const G = {
  THREE, renderer, assets, player, sfx: new Sfx(), scene: null, forest: null, ship: null,
  input: { keys: new Set(), mouse: new THREE.Vector2(), down: false, dx: 0, dy: 0, locked: false },
  paused: false, startTime: 0, flashlight: true,

  log(msg, color = '#9dffb0') {
    const el = document.createElement('div');
    el.textContent = msg; el.style.color = color;
    $('log').prepend(el);
    setTimeout(() => { el.style.opacity = 0; }, 5000);
    setTimeout(() => el.remove(), 6000);
    while ($('log').children.length > 6) $('log').lastChild.remove();
  },
  area(title, sub) {
    $('area').querySelector('h2').textContent = title;
    $('area').querySelector('p').textContent = sub;
    $('area').style.opacity = 1;
    clearTimeout(this._areaT);
    this._areaT = setTimeout(() => { $('area').style.opacity = 0; }, 3000);
  },
  prompt(text) {
    $('prompt').classList.toggle('hidden', !text);
    if (text) $('prompt').textContent = text;
  },
  hurt(n) {
    if (player.dead) return;
    player.hp -= n;
    this.sfx.hurt();
    $('dmg').style.opacity = 1;
    setTimeout(() => { $('dmg').style.opacity = 0; }, 180);
    if (player.hp <= 0) { player.hp = 0; this.gameOver(false); }
  },
  gainXp(n) {
    player.xp += n;
    while (player.xp >= player.next) {
      player.xp -= player.next;
      player.lv++;
      player.next = Math.round(player.next * 1.45);
      player.maxHp += 15; player.hp = player.maxHp; player.dmg += 3;
      this.sfx.levelup();
      this.log(`LEVEL UP! LV ${player.lv} — 最大HP・攻撃力が上昇`, '#8cf');
    }
  },
  // returns true when the shot can be fired
  tryFire() {
    if (player.reloading > 0 || player.fireCd > 0) return false;
    if (player.mag <= 0) {
      player.fireCd = 0.25; this.sfx.empty();
      if (player.ammo > 0) this.reload(); else this.log('弾切れ！補給箱を探せ', '#f88');
      return false;
    }
    player.mag--; player.fireCd = 0.11; this.sfx.shot();
    return true;
  },
  damage() { return Math.round((player.dmg + Math.random() * 6) * player.dmgMul); },
  reload() {
    if (player.reloading > 0 || player.mag === player.magSize || player.ammo <= 0) return;
    player.reloading = 1.4; this.sfx.reload();
  },
  useMedkit() {
    if (player.medkits <= 0 || player.hp >= player.maxHp) return;
    player.medkits--; player.hp = Math.min(player.maxHp, player.hp + 50);
    this.sfx.pickup(); this.log('メディキット使用 HP +50', '#8f8');
  },
  giveArtifact(id, onClose) {
    const a = ARTIFACTS[id];
    player.artifacts.push(id);
    if (id === 'crystal') { player.maxHp += 40; player.hp = player.maxHp; player.regen = 1.2; }
    if (id === 'orb') player.dmgMul = 1.6;
    this.sfx.artifact();
    this.modal(a.img, a.name, a.text, onClose);
  },
  modal(img, title, text, onClose) {
    this.paused = true;
    document.exitPointerLock?.();
    $('modalImg').src = img; $('modalTitle').textContent = title; $('modalText').innerText = text;
    $('modal').classList.remove('hidden');
    $('modalOk').onclick = () => {
      $('modal').classList.add('hidden');
      this.paused = false;
      onClose?.();
      if (this.scene === this.ship) canvas.requestPointerLock();
    };
  },
  switchTo(sceneObj, ...args) {
    this.scene?.exit?.();
    this.scene = sceneObj;
    sceneObj.enter(...args);
    renderPass.scene = sceneObj.scene;
    renderPass.camera = sceneObj.camera;
    const fps = sceneObj === this.ship;
    $('cross').classList.toggle('hidden', !fps);
    $('minimap').classList.toggle('hidden', !fps);
    canvas.style.cursor = fps ? 'none' : 'crosshair';
    this.prompt(null);
    this.sfx.setMusic(fps ? 'ship' : 'forest');
    if (fps) canvas.requestPointerLock(); else document.exitPointerLock?.();
  },
  gameOver(win) {
    player.dead = true;
    document.exitPointerLock?.();
    this.sfx.setMusic(win ? 'victory' : 'gameover');
    const t = Math.round((performance.now() - this.startTime) / 1000);
    $('overTitle').textContent = win ? 'MISSION COMPLETE' : 'MISSION FAILED';
    $('overTitle').style.color = win ? '#9dffb0' : '#ff5a4a';
    $('overArts').innerHTML = player.artifacts.map(a => `<img src="${ARTIFACTS[a].img}">`).join('');
    $('overStats').innerHTML = (win ? '異星船の主は倒れ、3つのアーティファクトは君の手に。<br>' : '君の信号は森の奥で途絶えた……<br>') +
      `レベル ${player.lv} ／ 撃破数 ${player.kills} ／ アーティファクト ${player.artifacts.length}/3 ／ 時間 ${Math.floor(t / 60)}分${t % 60}秒`;
    setTimeout(() => $('over').classList.remove('hidden'), win ? 400 : 1200);
  },
};

// ---------------------------------------------------------------- input
addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  G.input.keys.add(k);
  if (G.paused || player.dead || !G.scene) return;
  if (k === 'r') G.reload();
  if (k === 'h') G.useMedkit();
  if (k === 'f') G.flashlight = !G.flashlight;
  if (k === 'e') G.scene.interact?.();
});
addEventListener('keyup', e => G.input.keys.delete(e.key.toLowerCase()));
addEventListener('blur', () => { G.input.keys.clear(); G.input.down = false; });
canvas.addEventListener('mousedown', e => {
  if (e.button !== 0) return;
  if (G.scene === G.ship && !G.input.locked && !G.paused && !player.dead) { canvas.requestPointerLock(); return; }
  G.input.down = true;
});
addEventListener('mouseup', e => { if (e.button === 0) G.input.down = false; });
addEventListener('mousemove', e => {
  G.input.mouse.set(e.clientX / innerWidth * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  if (G.input.locked) { G.input.dx += e.movementX; G.input.dy += e.movementY; }
});
document.addEventListener('pointerlockchange', () => {
  G.input.locked = document.pointerLockElement === canvas;
});
$('pause').addEventListener('click', () => { canvas.requestPointerLock(); });
addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  composer.setSize(innerWidth, innerHeight);
  G.forest?.resize(); G.ship?.resize();
});

// ---------------------------------------------------------------- HUD
function updateHud() {
  $('lv').textContent = `LV ${player.lv}`;
  $('hptxt').textContent = `${Math.ceil(player.hp)} / ${player.maxHp}`;
  $('hpbar').firstElementChild.style.width = `${player.hp / player.maxHp * 100}%`;
  $('hpbar').classList.toggle('low', player.hp < player.maxHp * 0.3);
  $('xpbar').firstElementChild.style.width = `${player.xp / player.next * 100}%`;
  $('med').textContent = player.medkits;
  $('mag').textContent = player.reloading > 0 ? '--' : player.mag;
  $('reserve').textContent = player.reloading > 0 ? 'RELOADING…' : `/ ${player.ammo} PULSE ROUNDS`;
  const arts = $('arts');
  if (!arts.children.length) {
    for (const id of Object.keys(ARTIFACTS)) {
      const d = document.createElement('div');
      d.className = 'slot'; d.dataset.id = id; d.style.backgroundImage = `url(${ARTIFACTS[id].img})`;
      arts.appendChild(d);
    }
  }
  for (const d of arts.children) d.classList.toggle('got', player.artifacts.includes(d.dataset.id));
}

// ---------------------------------------------------------------- start
$('start').addEventListener('click', () => {
  if (!new URLSearchParams(location.search).has('mute')) G.sfx.init();   // ?mute keeps the game silent (testing)
  $('title').classList.add('hidden');
  $('hud').classList.remove('hidden');
  G.forest = new Forest(G);
  G.ship = new Ship(G);
  G.startTime = performance.now();
  G.switchTo(G.forest, 'start');
  G.log('墜落した異星船を発見。周囲に生命反応あり。', '#cfe');
});
$('title').style.backgroundImage = 'url(assets/title.jpg)';

const clock = new THREE.Clock();
function loop() {
  requestAnimationFrame(loop);
  frame(Math.min(clock.getDelta(), 0.05));
}
function frame(dt) {
  if (G.scene) {
    if (!G.paused && !player.dead && !(G.scene === G.ship && !G.input.locked && !G.debug)) {
      if (player.fireCd > 0) player.fireCd -= dt;
      if (player.reloading > 0) {
        player.reloading -= dt;
        if (player.reloading <= 0) {
          const n = Math.min(player.magSize - player.mag, player.ammo);
          player.mag += n; player.ammo -= n;
        }
      }
      if (player.regen) player.hp = Math.min(player.maxHp, player.hp + player.regen * dt);
      G.scene.update(dt);
    } else if (player.dead) {
      G.scene.update(0);
    }
    G.input.dx = G.input.dy = 0;
    $('pause').classList.toggle('hidden', !(G.scene === G.ship && !G.input.locked && !G.paused && !player.dead && !G.debug));
    composer.render();
    updateHud();
  }
}
loop();

// debug handles (G.step drives frames manually when rAF is throttled, e.g. in a hidden tab)
window.G = G;
G.step = (n = 1, dt = 1 / 60) => { for (let i = 0; i < n; i++) frame(dt); };
