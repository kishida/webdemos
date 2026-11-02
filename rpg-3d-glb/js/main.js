import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import {
  W, H, BLOCK, BUILDINGS, TOWN, CAMP, inRect, buildWorld, MONSTERS, ENEMY_POSTS,
  ITEMS, WEAPONS, ARMORS, SPELLS, expToNext, newHero, growth, VILLAGER_TALK, PRINCESS_TALK,
} from './data.js';
import { buildSongs, defineSfx } from './music.js';

const FM = window.FM;
const $ = (id) => document.getElementById(id);
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (a) => a[Math.floor(Math.random() * a.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// =====================================================================
// renderer / cameras / lights
// =====================================================================
const renderer = new THREE.WebGLRenderer({ antialias: true, stencil: true });   // stencil: character silhouettes
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.outputColorSpace = THREE.SRGBColorSpace;
$('app').appendChild(renderer.domElement);

const AZ = THREE.MathUtils.degToRad(35), EL = THREE.MathUtils.degToRad(40);
const CAM_OFF = new THREE.Vector3(Math.sin(AZ) * Math.cos(EL), Math.sin(EL), Math.cos(AZ) * Math.cos(EL)).multiplyScalar(40);
const RIGHT = new THREE.Vector3(Math.cos(AZ), 0, -Math.sin(AZ));      // screen right on the ground
const TOWARD = new THREE.Vector3(Math.sin(AZ), 0, Math.cos(AZ));      // toward the camera on the ground

function makeOrtho(half) {
  const c = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 200);
  c.userData.half = half;
  return c;
}
const cam = makeOrtho(5.4);
const bcam = makeOrtho(4.3);
function fitCam(c) {
  const a = innerWidth / innerHeight;
  let h = c.userData.half;
  if (a < 1) h /= Math.max(a, 0.55);
  c.left = -h * a; c.right = h * a; c.top = h; c.bottom = -h;
  c.updateProjectionMatrix();
}
fitCam(cam); fitCam(bcam);
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); fitCam(cam); fitCam(bcam); });

function addLights(scene, sky = 0xbfdcff, ground = 0x5a7040, sun = 0xfff0d8) {
  scene.add(new THREE.HemisphereLight(sky, ground, 1.25));
  const d = new THREE.DirectionalLight(sun, 2.3);
  d.castShadow = true;
  d.shadow.mapSize.set(2048, 2048);
  const s = d.shadow.camera; s.left = -16; s.right = 16; s.top = 16; s.bottom = -16; s.near = 1; s.far = 60;
  d.shadow.bias = -0.0006; d.shadow.normalBias = 0.02;
  scene.add(d, d.target);
  return d;
}

// =====================================================================
// models: GLB from the local generator, procedural fallbacks
// =====================================================================
// fit: h = height, w = largest horizontal size. yaw: extra rotation so the model faces +Z.
// procedural: built in code (makeFallback), no GLB to load
const SPEC = {
  hero: { h: 1.2 }, king: { h: 1.25 }, princess: { h: 1.1 }, villager: { h: 1.05 },
  slime: { h: 0.55 }, wolf: { h: 0.75 }, goblin: { h: 0.85 }, skeleton: { h: 1.05 }, orc_warrior: { h: 1.2 }, orc_leader: { h: 1.75 },
  castle: { w: 5.6, stripBelow: 1.0 }, inn: { w: 3.2 }, weapon_shop: { w: 3.2 }, item_shop: { w: 3.2 }, house: { w: 3.0 },
  tree: { h: 1.9 }, pine: { h: 2.3 }, rock: { h: 0.75, procedural: true }, well: { h: 1.4 }, chest: { w: 0.7 },
  tent: { w: 1.7 }, campfire: { w: 0.9 }, signpost: { h: 1.1 },
};
const models = {};   // name -> { obj: Group (normalized), animations, glb: bool }

const loader = new GLTFLoader();
async function loadModels(onProgress) {
  const names = Object.keys(SPEC);
  for (const name of names.filter((k) => SPEC[k].procedural)) models[name] = { obj: normalize(makeFallback(name), SPEC[name]), animations: [], glb: false };
  const glbs = names.filter((k) => !SPEC[k].procedural);
  let n = 0;
  await Promise.all(glbs.map(async (name) => {
    let gltf = null;
    try { gltf = await loader.loadAsync(`assets/glb/${name}.glb`); } catch { /* fallback below */ }
    const src = gltf ? gltf.scene : makeFallback(name);
    models[name] = { obj: normalize(src, SPEC[name]), animations: gltf ? gltf.animations : [], glb: !!gltf };
    onProgress(++n, glbs.length);
  }));
}

function normalize(src, spec) {
  // generated models occasionally contain a degenerate mesh with NaN vertices: drop it
  const broken = [];
  src.traverse((o) => { if (o.isMesh && o.geometry.attributes.position.array.some((v) => !Number.isFinite(v))) broken.push(o); });
  broken.forEach((o) => o.removeFromParent());
  src.updateMatrixWorld(true);
  if (spec.stripBelow != null) stripBase(src, spec.stripBelow);
  const box = new THREE.Box3().setFromObject(src);
  const size = box.getSize(new THREE.Vector3());
  const s = spec.h ? spec.h / Math.max(size.y, 1e-3) : spec.w / Math.max(size.x, size.z, 1e-3);
  const center = box.getCenter(new THREE.Vector3());
  const inner = new THREE.Group();
  inner.add(src);
  src.position.sub(new THREE.Vector3(center.x, box.min.y, center.z));
  const outer = new THREE.Group();
  outer.add(inner);
  inner.scale.setScalar(s);
  inner.rotation.y = spec.yaw || 0;
  src.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true; o.receiveShadow = true;
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach((m) => { if (m && m.map) m.map.colorSpace = THREE.SRGBColorSpace; });
    }
  });
  return outer;
}

// drop a generated "diorama" base: meshes whose top is below `limit` (model units, before scaling)
function stripBase(src, limit) {
  const drop = [];
  src.traverse((o) => { if (o.isMesh && new THREE.Box3().setFromObject(o).max.y < limit) drop.push(o); });
  drop.forEach((o) => o.removeFromParent());
}

function cloneModel(name) {
  const m = models[name];
  const obj = SkeletonUtils.clone(m.obj);
  let mixer = null, action = null;
  if (m.animations.length) {
    mixer = new THREE.AnimationMixer(obj);
    action = mixer.clipAction(m.animations[0]);
    action.play();
  }
  return { obj, mixer, action };
}

// static props become InstancedMeshes (one per sub-mesh) so forests stay cheap
function addInstanced(parent, name, list) {
  if (!list.length) return;
  const proto = models[name].obj;
  proto.updateMatrixWorld(true);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3();
  proto.traverse((o) => {
    if (!o.isMesh || o.isSkinnedMesh) return;
    const im = new THREE.InstancedMesh(o.geometry, o.material, list.length);
    list.forEach((t, i) => {
      p.set(t.x, t.y || 0, t.z); q.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, t.rot || 0); s.setScalar(t.s || 1);
      m.compose(p, q, s).multiply(o.matrixWorld);
      im.setMatrixAt(i, m);
    });
    im.castShadow = true; im.receiveShadow = true;
    im.computeBoundingSphere();
    parent.add(im);
  });
}

// low-poly boulder: a jittered, squashed icosphere with per-face grey shades (rocks are made here,
// not generated: the generated ones came out as odd sculptures)
function makeRock() {
  let geo = new THREE.IcosahedronGeometry(0.5, 1);
  const pos = geo.attributes.position, v = new THREE.Vector3();
  const seen = new Map();   // same jitter for vertices shared between faces, so the surface stays closed
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const key = v.toArray().map((n) => n.toFixed(3)).join();
    if (!seen.has(key)) seen.set(key, rand(0.82, 1.12));
    v.multiplyScalar(seen.get(key));
    v.y = v.y > 0 ? v.y * 0.72 : v.y * 0.35;   // flat bottom, rounded top
    v.x *= 1.15;
    pos.setXYZ(i, v.x, v.y, v.z);
  }
  geo = geo.toNonIndexed();
  geo.computeVertexNormals();
  const cols = [], c = new THREE.Color();
  for (let f = 0; f < geo.attributes.position.count / 3; f++) {
    c.setHex(0x8c8a84).offsetHSL(0, rand(-0.02, 0.02), rand(-0.07, 0.06));
    for (let k = 0; k < 3; k++) cols.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  const m = new THREE.Mesh(geo, mat(0xffffff, { vertexColors: true, roughness: 0.95 }));
  m.position.y = 0.17;
  return m;
}

// ---- procedural fallbacks (used until the GLB exists) ----
const mat = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, flatShading: true, roughness: 0.85, ...o });
function mesh(geo, material, x = 0, y = 0, z = 0) { const m = new THREE.Mesh(geo, material); m.position.set(x, y, z); return m; }
function makeFallback(name) {
  const g = new THREE.Group();
  const humanoid = (body, skin, extra) => {
    g.add(mesh(new THREE.CylinderGeometry(0.22, 0.28, 0.5, 6), mat(body), 0, 0.45, 0));
    g.add(mesh(new THREE.IcosahedronGeometry(0.2, 0), mat(skin), 0, 0.85, 0));
    g.add(mesh(new THREE.BoxGeometry(0.1, 0.25, 0.1), mat(0x3a2a1a), -0.1, 0.12, 0), mesh(new THREE.BoxGeometry(0.1, 0.25, 0.1), mat(0x3a2a1a), 0.1, 0.12, 0));
    g.add(mesh(new THREE.BoxGeometry(0.06, 0.06, 0.06), mat(0x111111), -0.07, 0.88, 0.18), mesh(new THREE.BoxGeometry(0.06, 0.06, 0.06), mat(0x111111), 0.07, 0.88, 0.18));
    extra && extra();
  };
  const house = (wall, roof, w = 2.6) => {
    g.add(mesh(new THREE.BoxGeometry(w, 1.4, w * 0.8), mat(wall), 0, 0.7, 0));
    const r = mesh(new THREE.ConeGeometry(w * 0.78, 1.1, 4), mat(roof), 0, 1.95, 0); r.rotation.y = Math.PI / 4; r.scale.z = 0.8; g.add(r);
    g.add(mesh(new THREE.BoxGeometry(0.5, 0.8, 0.1), mat(0x5a3a1a), 0, 0.4, w * 0.4));
  };
  switch (name) {
    case 'hero': humanoid(0x2c5fc9, 0xf2c8a0, () => g.add(mesh(new THREE.BoxGeometry(0.06, 0.6, 0.06), mat(0xdddddd, { metalness: 0.6 }), 0.32, 0.5, 0.1))); break;
    case 'king': humanoid(0xb02020, 0xf2c8a0, () => g.add(mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.12, 6), mat(0xffcc33, { metalness: 0.7 }), 0, 1.06, 0))); break;
    case 'princess': humanoid(0xf08ab8, 0xf6d2b4, () => g.add(mesh(new THREE.ConeGeometry(0.34, 0.5, 8), mat(0xf08ab8), 0, 0.25, 0), mesh(new THREE.CylinderGeometry(0.1, 0.12, 0.08, 6), mat(0xffd84a, { metalness: 0.7 }), 0, 1.04, 0))); break;
    case 'villager': humanoid(0x9a6a3a, 0xf2c8a0); break;
    case 'slime': { const b = mesh(new THREE.IcosahedronGeometry(0.4, 1), mat(0x3aa0ff, { roughness: 0.3 }), 0, 0.3, 0); b.scale.y = 0.75; g.add(b);
      g.add(mesh(new THREE.SphereGeometry(0.07, 6, 4), mat(0x111111), -0.13, 0.4, 0.32), mesh(new THREE.SphereGeometry(0.07, 6, 4), mat(0x111111), 0.13, 0.4, 0.32)); break; }
    case 'wolf': { g.add(mesh(new THREE.BoxGeometry(0.35, 0.35, 0.8), mat(0x777a80), 0, 0.45, 0), mesh(new THREE.BoxGeometry(0.3, 0.3, 0.35), mat(0x777a80), 0, 0.6, 0.5), mesh(new THREE.ConeGeometry(0.06, 0.2, 4), mat(0x555555), -0.1, 0.8, 0.45), mesh(new THREE.ConeGeometry(0.06, 0.2, 4), mat(0x555555), 0.1, 0.8, 0.45));
      for (const [x, z] of [[-0.12, -0.3], [0.12, -0.3], [-0.12, 0.3], [0.12, 0.3]]) g.add(mesh(new THREE.BoxGeometry(0.1, 0.3, 0.1), mat(0x555a60), x, 0.15, z)); break; }
    case 'goblin': humanoid(0x6b4a2a, 0x6fb54a); break;
    case 'skeleton': humanoid(0xd8d4c4, 0xeeeadc); break;
    case 'orc_warrior': humanoid(0x6a4a2a, 0x4f8a3a); break;
    case 'orc_leader': humanoid(0x3a2a20, 0xc83a2a); break;
    case 'castle': {
      g.add(mesh(new THREE.BoxGeometry(4, 2.2, 3), mat(0xb8b2a6), 0, 1.1, 0));
      for (const [x, z] of [[-2, -1.5], [2, -1.5], [-2, 1.5], [2, 1.5]]) {
        g.add(mesh(new THREE.CylinderGeometry(0.6, 0.65, 3.2, 8), mat(0xc4beb2), x, 1.6, z));
        g.add(mesh(new THREE.ConeGeometry(0.75, 1.3, 8), mat(0x3a5fb0), x, 3.85, z));
      }
      g.add(mesh(new THREE.BoxGeometry(1.8, 1.2, 1.6), mat(0xc4beb2), 0, 2.8, 0), mesh(new THREE.ConeGeometry(1.3, 1.4, 4), mat(0x3a5fb0), 0, 4.1, 0));
      g.add(mesh(new THREE.BoxGeometry(0.9, 1.2, 0.1), mat(0x5a3a1a), 0, 0.6, 1.52)); break;
    }
    case 'inn': house(0xeee0c0, 0xb03a2a); break;
    case 'weapon_shop': house(0xa8a098, 0x5a5a6a); break;
    case 'item_shop': house(0xe8e0d0, 0x3a8a4a); break;
    case 'house': house(0xf0ece0, 0x8a5a3a, 2.2); break;
    case 'tree': g.add(mesh(new THREE.CylinderGeometry(0.1, 0.14, 0.8, 6), mat(0x6a4a2a), 0, 0.4, 0), mesh(new THREE.IcosahedronGeometry(0.6, 0), mat(0x3f8f3a), 0, 1.25, 0)); break;
    case 'pine': g.add(mesh(new THREE.CylinderGeometry(0.08, 0.12, 0.6, 6), mat(0x5a3a1a), 0, 0.3, 0), mesh(new THREE.ConeGeometry(0.6, 0.9, 7), mat(0x2f6f3a), 0, 0.9, 0), mesh(new THREE.ConeGeometry(0.45, 0.8, 7), mat(0x347a40), 0, 1.4, 0), mesh(new THREE.ConeGeometry(0.3, 0.6, 7), mat(0x3a8545), 0, 1.85, 0)); break;
    case 'rock': g.add(makeRock()); break;
    case 'well': g.add(mesh(new THREE.CylinderGeometry(0.45, 0.5, 0.5, 8), mat(0x9a948a), 0, 0.25, 0), mesh(new THREE.ConeGeometry(0.6, 0.4, 4), mat(0x8a4a2a), 0, 1.2, 0), mesh(new THREE.BoxGeometry(0.06, 0.8, 0.06), mat(0x5a3a1a), -0.4, 0.7, 0), mesh(new THREE.BoxGeometry(0.06, 0.8, 0.06), mat(0x5a3a1a), 0.4, 0.7, 0)); break;
    case 'chest': g.add(mesh(new THREE.BoxGeometry(0.7, 0.4, 0.45), mat(0x8a5a2a), 0, 0.2, 0), mesh(new THREE.BoxGeometry(0.72, 0.12, 0.47), mat(0xd8b040, { metalness: 0.6 }), 0, 0.45, 0)); break;
    case 'tent': g.add(mesh(new THREE.ConeGeometry(0.85, 1.4, 6), mat(0x8a6a4a), 0, 0.7, 0)); break;
    case 'campfire': g.add(mesh(new THREE.ConeGeometry(0.25, 0.6, 5), mat(0xff8020, { emissive: 0xff5010, emissiveIntensity: 1.5 }), 0, 0.3, 0), mesh(new THREE.TorusGeometry(0.35, 0.08, 4, 8), mat(0x777777), 0, 0.05, 0)); g.children[1].rotation.x = Math.PI / 2; break;
    case 'signpost': g.add(mesh(new THREE.BoxGeometry(0.1, 1.1, 0.1), mat(0x6a4a2a), 0, 0.55, 0), mesh(new THREE.BoxGeometry(0.6, 0.2, 0.05), mat(0x9a7a4a), 0.15, 0.9, 0)); break;
    default: g.add(mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), mat(0xff00ff), 0, 0.25, 0));
  }
  return g;
}

// =====================================================================
// tweens / particles
// =====================================================================
const tweens = [];
function tween(ms, fn, ease = (t) => t) {
  return new Promise((res) => tweens.push({ t: 0, ms, fn, ease, res }));
}
const wait = (ms) => tween(ms, () => {});
function updateTweens(dt) {
  for (let i = tweens.length - 1; i >= 0; i--) {
    const tw = tweens[i];
    tw.t = Math.min(1, tw.t + (dt * 1000) / tw.ms);
    tw.fn(tw.ease(tw.t));
    if (tw.t >= 1) { tweens.splice(i, 1); tw.res(); }
  }
}
const easeOut = (t) => 1 - (1 - t) * (1 - t);

const particles = [];
const pGeo = new THREE.BoxGeometry(0.09, 0.09, 0.09);
function burst(scene, pos, color, n = 16, o = {}) {
  const m = new THREE.MeshBasicMaterial({ color, transparent: true });
  for (let i = 0; i < n; i++) {
    const p = new THREE.Mesh(pGeo, m);
    p.position.copy(pos);
    const a = Math.random() * Math.PI * 2, sp = rand(0.5, 1) * (o.speed || 2.5);
    p.userData = { v: new THREE.Vector3(Math.cos(a) * sp * (o.flat ? 1 : 0.6), rand(o.up?.[0] ?? 1, o.up?.[1] ?? 3), Math.sin(a) * sp * (o.flat ? 1 : 0.6)), life: rand(0.5, 0.9) * (o.life || 1), g: o.g ?? 6 };
    p.scale.setScalar(rand(0.6, 1.6) * (o.size || 1));
    scene.add(p);
    particles.push(p);
  }
}
function updateParticles(dt) {
  for (let i = particles.length - 1; i >= 0; i--) {
    const p = particles[i], u = p.userData;
    u.life -= dt;
    u.v.y -= u.g * dt;
    p.position.addScaledVector(u.v, dt);
    p.rotation.x += dt * 5; p.rotation.y += dt * 4;
    p.material.opacity = clamp(u.life * 2, 0, 1);
    if (u.life <= 0) { p.removeFromParent(); particles.splice(i, 1); }
  }
}

// =====================================================================
// audio helpers
// =====================================================================
let SONGS = null, curSong = null;
function music(name) {
  if (!FM.ctx || !SONGS) return;
  if (curSong === name) return;
  curSong = name;
  jingleBusy = false; FM.onSongEnd = null;   // a cut-off jingle never reports its end
  if (!name) { FM.stop(); return; }
  FM.play(SONGS[name]);
}
// jingles play to the end in the background; the field music waits for them (jingleBusy)
// but the game does not, so Enter always advances right away
let jingleBusy = false;
function jingle(name) {
  return new Promise((res) => {
    if (!FM.ctx) return res();
    curSong = name; jingleBusy = true;
    FM.play(SONGS[name]);
    FM.onSongEnd = () => { FM.onSongEnd = null; jingleBusy = false; res(); };
  });
}
function sfx(name, o) { if (FM.ctx) FM.play_sfx(name, o); }
function blip() { if (FM.ctx) FM.note('sfx', 'blip', 'A5', { dur: 0.035, vel: 0.25 }); }

// =====================================================================
// UI: message window, menus, panels (promise based)
// =====================================================================
const uiStack = [];
const msgEl = $('msg');
function say(text, o = {}) {
  return new Promise((res) => {
    msgEl.classList.remove('hidden');
    msgEl.innerHTML = '<span class="t"></span><span class="more hidden">▼</span>';
    const tEl = msgEl.firstChild, more = msgEl.lastChild;
    let i = 0, typing = true, autoT = null;
    const iv = setInterval(() => { i += 1; tEl.textContent = text.slice(0, i); if (i >= text.length) done(); }, 22);
    function done() {
      clearInterval(iv); typing = false; tEl.textContent = text;
      if (o.auto) autoT = setTimeout(finish, o.auto); else more.classList.remove('hidden');
    }
    const w = { onKey(k, rep) { if (rep) return; if (k === 'ok' || k === 'cancel') { if (typing) done(); else finish(); } } };
    function finish() { clearTimeout(autoT); const j = uiStack.indexOf(w); if (j >= 0) uiStack.splice(j, 1); res(); }
    uiStack.push(w);
  });
}
const closeMsg = () => msgEl.classList.add('hidden');
async function talk(lines) { for (const l of [].concat(lines)) await say(l); closeMsg(); }

function choose(items, o = {}) {
  return new Promise((res) => {
    items = items.map((it) => (typeof it === 'string' ? { label: it } : it));
    const el = document.createElement('div');
    el.className = 'win menu';
    Object.assign(el.style, o.style || { left: '50%', top: '50%', transform: 'translate(-50%,-50%)' });
    let sel = clamp(o.start || 0, 0, items.length - 1);
    const render = () => {
      el.innerHTML = (o.title ? `<div class="title">${o.title}</div>` : '') +
        items.map((it, i) => `<div class="it ${i === sel ? 'sel' : ''} ${it.disabled ? 'dis' : ''}"><span>${it.label}</span>${it.right != null ? `<span>${it.right}</span>` : ''}</div>`).join('') +
        ((items[sel] && items[sel].info) || o.info ? `<div class="info">${(items[sel] && items[sel].info) || o.info}</div>` : '');
      o.onMove && o.onMove(sel);
    };
    const close = (v) => { el.remove(); const j = uiStack.indexOf(w); if (j >= 0) uiStack.splice(j, 1); res(v); };
    const w = {
      onKey(k, rep) {
        if (k === 'up' || k === 'down') { sel = (sel + (k === 'up' ? -1 : 1) + items.length) % items.length; blip(); render(); }
        else if (k === 'ok' && !rep) { if (items[sel].disabled) { sfx('cancel'); return; } sfx('select'); close(sel); }
        else if (k === 'cancel' && !rep && o.cancel !== false) { sfx('cancel'); close(-1); }
      },
    };
    render();
    $('ui').appendChild(el);
    uiStack.push(w);
    sfx('menu');   // a cue that a choice is waiting
  });
}
function panel(html) {
  return new Promise((res) => {
    const el = document.createElement('div');
    el.className = 'win'; el.id = 'panel'; el.innerHTML = html;
    $('ui').appendChild(el);
    const w = { onKey(k, rep) { if (!rep && (k === 'ok' || k === 'cancel')) { el.remove(); uiStack.splice(uiStack.indexOf(w), 1); sfx('cancel'); res(); } } };
    uiStack.push(w);
  });
}
// menus sit right above the message window (its left or right corner) so they are hard to miss
function nearMsg(side = 'left') {
  const w = Math.min(760, innerWidth - 32);
  const left = (innerWidth - w) / 2;
  const h = msgEl.classList.contains('hidden') ? 158 : msgEl.offsetHeight;
  const bottom = `${16 + h + 6}px`;
  return side === 'right' ? { right: `${left}px`, bottom } : { left: `${left}px`, bottom };
}
async function yesno(q) { await say(q, { auto: 1 }); const r = await choose(['はい', 'いいえ'], { style: nearMsg('right') }); return r === 0; }
const fade = (v, ms = 400) => { const f = $('fade'); f.style.transition = `opacity ${ms}ms`; f.style.opacity = v; return wait(ms); };
async function flash(times = 3) {
  const f = $('flash');
  for (let i = 0; i < times; i++) { f.style.opacity = 0.85; await wait(60); f.style.opacity = 0; await wait(60); }
}

// =====================================================================
// hero state
// =====================================================================
let hero = newHero();
const weapon = () => WEAPONS.find((w) => w.id === hero.weapon);
const armor = () => ARMORS.find((w) => w.id === hero.armor);
const atkOf = () => hero.str + weapon().atk;
const defOf = () => hero.vit + armor().def;
const spellsKnown = () => SPELLS.filter((s) => hero.lv >= s.lv);
function hud() {
  const el = $('hud');
  el.innerHTML = `<div class="row"><b>${hero.name}</b><span>Lv ${hero.lv}</span></div>
    <div class="row"><span>HP</span><span>${hero.hp} / ${hero.mhp}</span></div><div class="bar"><i style="width:${(hero.hp / hero.mhp) * 100}%"></i></div>
    <div class="row"><span>MP</span><span>${hero.mp} / ${hero.mmp}</span></div><div class="bar mp"><i style="width:${(hero.mp / hero.mmp) * 100}%"></i></div>
    <div class="row"><span>G</span><span style="color:var(--gold)">${hero.gold}</span></div>`;
}
const SAVE_KEY = 'astria-save-v1';
function save() { hero.x = player.x; hero.z = player.z; try { localStorage.setItem(SAVE_KEY, JSON.stringify(hero)); return true; } catch { return false; } }
function loadSave() { try { const s = localStorage.getItem(SAVE_KEY); return s ? JSON.parse(s) : null; } catch { return null; } }

// =====================================================================
// field world
// =====================================================================
const world = buildWorld();
const field = new THREE.Scene();
field.background = new THREE.Color(0x9fd0f0);
field.fog = new THREE.Fog(0x9fd0f0, 50, 90);
const sun = addLights(field);
let water = null;

function buildTerrain() {
  const t = world.tiles;
  const COL = { '.': 0x67a84e, f: 0x4f8f40, ',': 0xc9a66b, d: 0x6e4c3a, M: 0x5b7a45, '#': 0x67a84e, '|': 0x6e4c3a };
  const tiles = [];
  for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
    const c = t[z][x];
    if (c === '~' || c === '=') continue;
    let col = COL[c] ?? 0x67a84e;
    if (c === ',' && inRect(TOWN, x, z)) col = 0xb5aea0;
    tiles.push({ x, z, col });
  }
  const box = new THREE.BoxGeometry(1, 0.6, 1);
  const im = new THREE.InstancedMesh(box, mat(0xffffff), tiles.length);
  const m = new THREE.Matrix4(), c = new THREE.Color();
  tiles.forEach((ti, i) => {
    m.makeTranslation(ti.x, -0.3 + Math.random() * 0.025, ti.z);
    im.setMatrixAt(i, m);
    c.setHex(ti.col).offsetHSL(0, 0, rand(-0.025, 0.025));
    im.setColorAt(i, c);
  });
  im.receiveShadow = true;
  field.add(im);

  // water: one wavy plane under the ground
  const wg = new THREE.PlaneGeometry(W + 20, H + 20, (W + 20), (H + 20));
  wg.rotateX(-Math.PI / 2);
  water = new THREE.Mesh(wg, makeWaterMaterial());
  water.position.set(W / 2 - 0.5, -0.22, H / 2 - 0.5);
  field.add(water);

  const walls = [], stakes = [], peaks = [], snow = [], planks = [], rails = [];
  for (let z = 0; z < H; z++) for (let x = 0; x < W; x++) {
    const ch = t[z][x];
    if (ch === '#') walls.push({ x, z });
    if (ch === '|') for (let k = 0; k < 3; k++) stakes.push({ x: x + (k - 1) * 0.3, z: z + rand(-0.05, 0.05), h: rand(1.0, 1.35) });
    if (ch === 'M') {
      const n = Math.random() < 0.5 ? 1 : 2;
      for (let k = 0; k < n; k++) {
        const h = rand(1.2, 2.6), px = x + rand(-0.2, 0.2), pz = z + rand(-0.2, 0.2), r = rand(0.65, 0.9);
        peaks.push({ x: px, z: pz, h, r, rot: Math.random() * 6 });
        if (h > 2.0) snow.push({ x: px, z: pz, h, r });
      }
    }
    if (ch === '=') {
      const alongX = t[z][x - 1] !== '~' || t[z][x + 1] !== '~';
      planks.push({ x, z, alongX });
    }
  }
  const put = (geo, material, list, fn) => {
    const im = new THREE.InstancedMesh(geo, material, list.length);
    list.forEach((it, i) => { im.setMatrixAt(i, fn(it)); });
    im.castShadow = true; im.receiveShadow = true; field.add(im); return im;
  };
  const M4 = (x, y, z, sx = 1, sy = 1, sz = 1, ry = 0) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, ry), new THREE.Vector3(sx, sy, sz));
  put(new THREE.BoxGeometry(1, 1.1, 0.9), mat(0xaaa49a), walls, (w) => M4(w.x, 0.55, w.z));
  put(new THREE.BoxGeometry(0.32, 0.3, 0.32), mat(0x9a9488), walls, (w) => M4(w.x + ((w.x + w.z) % 2 ? 0.25 : -0.25), 1.25, w.z));
  put(new THREE.CylinderGeometry(0.11, 0.13, 1, 5), mat(0x6a4a2c), stakes, (s) => M4(s.x, s.h / 2, s.z, 1, s.h, 1));
  put(new THREE.ConeGeometry(0.12, 0.25, 5), mat(0x8a6a4c), stakes, (s) => M4(s.x, s.h + 0.12, s.z));
  put(new THREE.ConeGeometry(1, 1, 6), mat(0x7d7466), peaks, (p) => M4(p.x, p.h / 2, p.z, p.r, p.h, p.r, p.rot));
  put(new THREE.ConeGeometry(1, 1, 6), mat(0xf4f4f8), snow, (p) => M4(p.x, p.h * 0.85, p.z, p.r * 0.32, p.h * 0.31, p.r * 0.32));
  // bridges: planks across the river with rails
  const pl = [];
  for (const b of planks) for (let k = 0; k < 4; k++) pl.push({ ...b, k });
  put(new THREE.BoxGeometry(0.22, 0.1, 1.3), mat(0x9a6a3c), pl, (p) => (p.alongX ? M4(p.x - 0.375 + p.k * 0.25, 0.0, p.z) : M4(p.x, 0.0, p.z - 0.375 + p.k * 0.25, 1, 1, 1, Math.PI / 2)));
  const rl = planks.flatMap((b) => [-1, 1].map((sd) => ({ ...b, sd })));
  put(new THREE.BoxGeometry(1.02, 0.08, 0.08), mat(0x6a4a2c), rl, (r) => (r.alongX ? M4(r.x, 0.45, r.z + r.sd * 0.6) : M4(r.x + r.sd * 0.6, 0.45, r.z, 1, 1, 1, Math.PI / 2)));
  put(new THREE.BoxGeometry(0.08, 0.5, 0.08), mat(0x6a4a2c), rl, (r) => (r.alongX ? M4(r.x - 0.45, 0.2, r.z + r.sd * 0.6) : M4(r.x + r.sd * 0.6, 0.2, r.z - 0.45)));

  // buildings
  for (const b of world.buildings) {
    const m = BUILDINGS[b.kind];
    addInstanced(field, m.model, [{ x: b.x, z: b.z, rot: 0 }]);
  }
  // props (instanced by model)
  const byModel = {};
  for (const p of world.props) (byModel[p.model] ||= []).push(p);
  for (const [name, list] of Object.entries(byModel)) {
    if (models[name].animations.length) {   // animated props (campfire) get real clones
      for (const p of list) { const a = new Actor(name, p.x, p.z); a.root.rotation.y = p.rot; a.anim = true; field.add(a.root); ambient.push(a); }
    } else addInstanced(field, name, list);
  }
  // campfire glow
  for (const p of world.props.filter((q) => q.model === 'campfire')) {
    const l = new THREE.PointLight(0xff8a30, 6, 5, 1.5); l.position.set(p.x, 0.8, p.z); field.add(l); fireLights.push(l);
  }
}
const fireLights = [];

// river surface: three travelling waves on the GPU, ripple lines and sun glint
function makeWaterMaterial() {
  return new THREE.ShaderMaterial({
    transparent: true,
    fog: true,
    uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
      uTime: { value: 0 },
      uSun: { value: new THREE.Vector3(6, 14, 8).normalize() },
      uView: { value: CAM_OFF.clone().normalize() },
      uDeep: { value: new THREE.Color(0x1f6fb8) },
      uShallow: { value: new THREE.Color(0x4fb6e8) },
    }]),
    vertexShader: `
      uniform float uTime;
      varying vec3 vWorld;
      varying vec3 vNormal;
      #include <fog_pars_vertex>
      // sum of three directional waves: height and its slope
      vec3 wave(vec2 p, vec2 dir, float freq, float amp, float speed) {
        float ph = dot(p, dir) * freq + uTime * speed;
        return vec3(sin(ph) * amp, cos(ph) * amp * freq * dir);
      }
      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vec3 w = wave(wp.xz, normalize(vec2(1.0, 0.3)), 1.4, 0.045, 1.7)
               + wave(wp.xz, normalize(vec2(-0.4, 1.0)), 2.1, 0.03, 2.3)
               + wave(wp.xz, normalize(vec2(0.7, -0.8)), 3.3, 0.015, 3.1);
        wp.y += w.x;
        vNormal = normalize(vec3(-w.y, 1.0, -w.z));
        vWorld = wp.xyz;
        vec4 mvPosition = viewMatrix * wp;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }`,
    fragmentShader: `
      uniform float uTime;
      uniform vec3 uSun, uView, uDeep, uShallow;
      varying vec3 vWorld;
      varying vec3 vNormal;
      #include <fog_pars_fragment>
      void main() {
        vec3 n = normalize(vNormal);
        // colour: slow drifting light/dark patches
        float patchy = 0.5 + 0.5 * sin(vWorld.x * 0.7 + uTime * 0.4) * sin(vWorld.z * 0.9 - uTime * 0.3);
        vec3 col = mix(uDeep, uShallow, 0.35 + 0.4 * patchy);
        col *= 0.75 + 0.35 * max(dot(n, uSun), 0.0);
        // thin wavy ripple lines drifting downstream
        float line = sin(vWorld.z * 4.0 + sin(vWorld.x * 2.3 + uTime * 0.9) * 1.2 - uTime * 2.0);
        float streak = smoothstep(0.9, 1.0, line) * (0.5 + 0.5 * sin(vWorld.x * 1.1 - uTime * 0.6));
        col += vec3(0.32, 0.4, 0.45) * streak;
        // sun glint
        vec3 h = normalize(uSun + uView);
        col += vec3(1.0, 0.97, 0.9) * pow(max(dot(n, h), 0.0), 90.0) * 1.4;
        gl_FragColor = vec4(col, 0.9);
        #include <fog_fragment>
      }`,
  });
}
const ambient = []; // animated props

// =====================================================================
// actors
// =====================================================================
class Actor {
  constructor(model, x, z, o = {}) {
    this.model = model;
    this.root = new THREE.Group();
    this.body = new THREE.Group();
    this.root.add(this.body);
    const c = cloneModel(model);
    this.inner = c.obj; this.mixer = c.mixer; this.action = c.action;
    this.body.add(this.inner);
    if (o.scale) this.body.scale.setScalar(o.scale);
    this.x = x; this.z = z; this.fx = x; this.fz = z; this.t = 1; this.speed = 5;
    this.dir = o.dir ?? 0; this.body.rotation.y = this.dir;
    this.phase = Math.random() * 10;
    this.root.position.set(x, 0, z);
    this.followers = [];
  }
  // a field enemy stands for a group: show one model per member so the group size is visible
  setGroup(n) {
    this.count = n;
    if (n < 2) return;
    this.inner.position.z = 0.18;
    this.inner.scale.setScalar(0.85);
    const spots = n === 2 ? [[-0.28, -0.22]] : [[-0.32, -0.24], [0.32, -0.24]];
    for (const [fx, fz] of spots) {
      const f = cloneModel(this.model).obj;
      f.position.set(fx, 0, fz);
      f.userData.phase = Math.random() * 10;
      this.body.add(f);
      this.followers.push(f);
    }
  }
  get moving() { return this.t < 1; }
  face(dx, dz) { this.dir = Math.atan2(dx, dz); }
  moveTo(nx, nz, speed = 5) { this.face(nx - this.x, nz - this.z); this.fx = this.x; this.fz = this.z; this.x = nx; this.z = nz; this.t = 0; this.speed = speed; }
  update(dt, time) {
    if (this.t < 1) {
      this.t = Math.min(1, this.t + dt * this.speed);
      this.root.position.x = THREE.MathUtils.lerp(this.fx, this.x, this.t);
      this.root.position.z = THREE.MathUtils.lerp(this.fz, this.z, this.t);
      this.body.position.y = Math.sin(this.t * Math.PI) * 0.09;
    } else this.body.position.y = 0;
    let d = this.dir - this.body.rotation.y;
    d = Math.atan2(Math.sin(d), Math.cos(d));
    this.body.rotation.y += d * Math.min(1, dt * 14);
    const breathe = this.model === 'slime' ? 0.08 : 0.025;
    const base = this.followers.length ? 0.85 : 1;
    const squash = (o, ph, b) => o.scale.set(b * (1 - Math.sin(time * 3 + ph) * breathe * 0.5), b * (1 + Math.sin(time * 3 + ph) * breathe), b * (1 - Math.sin(time * 3 + ph) * breathe * 0.5));
    squash(this.inner, this.phase, base);
    this.followers.forEach((f) => squash(f, f.userData.phase, 0.8));
    if (this.mixer) {
      if (this.walkAnim && !this.moving && !this.forceAnim) { this.action.time = 0; this.mixer.update(0); } else this.mixer.update(dt);
    }
  }
}

// faint silhouette so a character behind a tree or building stays visible: the character's own
// materials mark their visible pixels in the stencil, and the silhouette is drawn only where the
// character is hidden (depth behind something, stencil not marked)
const xrayMats = {};
function addXray(actor, color) {
  const m = (xrayMats[color] ||= new THREE.MeshBasicMaterial({
    color, transparent: true, opacity: 0.45, depthFunc: THREE.GreaterDepth, depthWrite: false,
    stencilWrite: true, stencilRef: 1, stencilFunc: THREE.NotEqualStencilFunc,
    stencilZPass: THREE.ReplaceStencilOp,   // draw each hidden pixel once
  }));
  const meshes = [];
  actor.body.traverse((o) => { if (o.isMesh && !o.userData.xray) meshes.push(o); });
  for (const o of meshes) {
    o.renderOrder = 10;   // after the scenery, so only truly visible pixels get marked
    for (const cm of [].concat(o.material)) {
      Object.assign(cm, { stencilWrite: true, stencilRef: 1, stencilFunc: THREE.AlwaysStencilFunc, stencilZPass: THREE.ReplaceStencilOp });
    }
    const x = new THREE.Mesh(o.geometry, m);
    x.userData.xray = true;
    x.renderOrder = 999;
    o.add(x);
  }
}

let player = null;
const npcs = [], enemies = [], chests = [];
let boss = null;

function spawnWorldActors() {
  player = new Actor('hero', world.start.x, world.start.z, { dir: Math.PI });
  player.walkAnim = true;
  addXray(player, 0x9fd4ff);
  field.add(player.root);
  for (const n of world.npcs) {
    const a = new Actor(n.kind, n.x, n.z, { dir: n.rot ?? 0 });
    Object.assign(a, { kind: n.kind, wander: n.wander, talk: n.talk, timer: rand(1, 3) });
    field.add(a.root); npcs.push(a);
  }
  for (const c of world.chests) {
    if (hero.flags['chest_' + c.id]) continue;
    const a = new Actor('chest', c.x, c.z, { dir: rand(-0.4, 0.4) });
    a.chest = c; field.add(a.root); chests.push(a);
  }
  if (!hero.flags.bossDown) {
    boss = new Actor('orc_leader', world.boss.x, world.boss.z, { dir: 0 });
    field.add(boss.root);
  }
}

const tileAt = (x, z) => world.get(x, z);
function blockedStatic(x, z) {
  const c = tileAt(x, z);
  if (BLOCK.has(c)) return true;
  if (world.owner[x + ',' + z]) return true;
  return world.props.some((p) => p.block && p.x === x && p.z === z);
}
const actorAt = (list, x, z) => list.find((a) => a.x === x && a.z === z);
function occupied(x, z, self) {
  if (player && player !== self && player.x === x && player.z === z) return true;
  for (const l of [npcs, enemies, chests]) { const a = actorAt(l, x, z); if (a && a !== self) return true; }
  if (boss && boss !== self && boss.x === x && boss.z === z) return true;
  return false;
}
const walkable = (x, z, self) => !blockedStatic(x, z) && !occupied(x, z, self);

// ---- enemies (fixed posts, see ENEMY_POSTS) ----
const LEASH = 3, CHASE_RANGE = 6, RESPAWN_MS = 90000;
function spawnPost(post) {
  // the post tile, or the nearest free tile around it
  for (let r = 0; r <= 3; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
    const x = post.x + dx, z = post.z + dz;
    if (Math.max(Math.abs(dx), Math.abs(dz)) !== r || inRect(TOWN, x, z) || tileAt(x, z) === '=' || !walkable(x, z)) continue;
    const a = new Actor(post.kind, x, z, { dir: Math.random() * 6 });
    Object.assign(a, { kind: post.kind, post, home: { x, z }, timer: rand(0.5, 2), speed: 3 });
    a.setGroup(post.n);
    addXray(a, 0xff7a6a);
    field.add(a.root); enemies.push(a);
    post.actor = a;
    a.root.scale.setScalar(0.01);
    tween(400, (t) => a.root.scale.setScalar(Math.max(0.01, easeOut(t))));
    return;
  }
}
function spawnAllPosts() { for (const p of ENEMY_POSTS) { p.actor = null; p.backAt = 0; spawnPost(p); } }
// a defeated group comes back after RESPAWN_MS, once the player is not right there
function removeEnemy(a) {
  a.root.removeFromParent(); enemies.splice(enemies.indexOf(a), 1);
  if (a.post) { a.post.actor = null; a.post.backAt = performance.now() + RESPAWN_MS; }
}

let encounterGrace = 0, respawnTimer = 0;
const DIRS = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };
const fromHome = (e, x, z) => Math.max(Math.abs(x - e.home.x), Math.abs(z - e.home.z));

function updateEnemies(dt) {
  respawnTimer -= dt;
  if (respawnTimer <= 0) {
    respawnTimer = 1;
    for (const p of ENEMY_POSTS) if (!p.actor && performance.now() > p.backAt && Math.hypot(p.x - player.x, p.z - player.z) > 10) spawnPost(p);
  }
  for (const e of [...enemies]) {
    if (e.moving) continue;
    e.timer -= dt;
    if (e.timer > 0) continue;
    const dx = player.x - e.x, dz = player.z - e.z, dist = Math.abs(dx) + Math.abs(dz);
    const near = dist <= 5 && e.kind !== 'slime' || dist <= 3;
    const chase = near && encounterGrace <= 0 && fromHome(e, player.x, player.z) <= CHASE_RANGE;
    let step = null;
    if (chase) {
      const opts = Math.abs(dx) > Math.abs(dz) ? [[Math.sign(dx), 0], [0, Math.sign(dz)]] : [[0, Math.sign(dz)], [Math.sign(dx), 0]];
      step = opts.find(([sx, sz]) => (sx || sz) && (e.x + sx === player.x && e.z + sz === player.z || walkable(e.x + sx, e.z + sz, e) && !inRect(TOWN, e.x + sx, e.z + sz)));
      e.timer = rand(0.25, 0.45);
    } else {
      e.timer = rand(0.8, 2.2);
      if (fromHome(e, e.x, e.z) > LEASH) {   // wandered off (after a chase): head back to the post
        const hx = e.home.x - e.x, hz = e.home.z - e.z;
        step = [[Math.sign(hx), 0], [0, Math.sign(hz)]].find(([sx, sz]) => (sx || sz) && walkable(e.x + sx, e.z + sz, e));
      } else if (Math.random() < 0.6) {
        const s = pick(Object.values(DIRS));
        const nx = e.x + s[0], nz = e.z + s[1];
        if (walkable(nx, nz, e) && !inRect(TOWN, nx, nz) && tileAt(nx, nz) !== '=' && fromHome(e, nx, nz) <= LEASH) step = s;
      }
    }
    if (!step) continue;
    const nx = e.x + step[0], nz = e.z + step[1];
    if (nx === player.x && nz === player.z) { if (encounterGrace <= 0 && !lock) { e.face(step[0], step[1]); startEncounter(e); } continue; }
    e.moveTo(nx, nz, chase ? 4 : 2.5);
  }
}

// ---- NPC wander ----
function updateNpcs(dt) {
  for (const n of npcs) {
    if (!n.wander || n.moving) continue;
    n.timer -= dt;
    if (n.timer > 0) continue;
    n.timer = rand(1.5, 3.5);
    const s = pick(Object.values(DIRS));
    const nx = n.x + s[0], nz = n.z + s[1];
    if (inRect(TOWN, nx, nz) && walkable(nx, nz, n) && tileAt(nx, nz) !== '#') n.moveTo(nx, nz, 2.5);
  }
}

// =====================================================================
// input
// =====================================================================
const KEYMAP = {
  ArrowUp: 'up', KeyW: 'up', ArrowDown: 'down', KeyS: 'down', ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right',
  Enter: 'ok', Space: 'ok', KeyZ: 'ok', Escape: 'cancel', KeyX: 'cancel', Backspace: 'cancel', KeyM: 'mute',
};
const held = [];
let lock = 0;
let mode = 'loading';
addEventListener('keydown', (e) => {
  const k = KEYMAP[e.code];
  if (!k) return;
  e.preventDefault();
  if (k === 'mute') { if (!e.repeat) toggleSound(); return; }
  if (DIRS[k] && !held.includes(k)) held.push(k);
  if (mode === 'title') { titleKey(k, e.repeat); return; }
  if (uiStack.length) { uiStack[uiStack.length - 1].onKey(k, e.repeat); return; }
  if (mode === 'field' && !lock && !e.repeat) fieldKey(k);
});
addEventListener('keyup', (e) => { const k = KEYMAP[e.code]; const i = held.indexOf(k); if (i >= 0) held.splice(i, 1); });
addEventListener('blur', () => { held.length = 0; });

async function script(fn) { lock++; try { await fn(); } finally { lock--; } }

function fieldKey(k) {
  if (player.moving) return;
  if (k === 'cancel') { script(fieldMenu); return; }
  if (k === 'ok') { const [dx, dz] = facingVec(); interact(player.x + dx, player.z + dz); return; }
  if (DIRS[k]) {   // a fresh press into something interactive triggers it (bump to talk / enter shop)
    const [dx, dz] = DIRS[k];
    player.face(dx, dz);
    const tx = player.x + dx, tz = player.z + dz;
    if (!walkable(tx, tz) && interactive(tx, tz)) interact(tx, tz);
  }
}
function facingVec() {
  const d = player.dir;
  const dx = Math.round(Math.sin(d)), dz = Math.round(Math.cos(d));
  return Math.abs(dx) > Math.abs(dz) ? [dx, 0] : [0, dz];
}
function interactive(x, z) {
  return world.owner[x + ',' + z] || actorAt(npcs, x, z) || actorAt(chests, x, z) || actorAt(enemies, x, z) ||
    (boss && boss.x === x && boss.z === z) || world.signs[x + ',' + z] || world.props.some((p) => p.x === x && p.z === z && p.model === 'well');
}

function updatePlayer() {
  if (player.moving || lock || uiStack.length || mode !== 'field') return;
  const k = held[held.length - 1];
  if (!k) return;
  const [dx, dz] = DIRS[k];
  const tx = player.x + dx, tz = player.z + dz;
  player.face(dx, dz);
  const e = actorAt(enemies, tx, tz);
  if (e) { if (encounterGrace <= 0) startEncounter(e); return; }
  if (walkable(tx, tz)) player.moveTo(tx, tz, 5.5);
}

// =====================================================================
// interactions
// =====================================================================
function interact(x, z) {
  const key = x + ',' + z;
  const b = world.owner[key];
  if (b) return script(() => building(b));
  const n = actorAt(npcs, x, z);
  if (n) return script(() => npcTalk(n));
  const c = actorAt(chests, x, z);
  if (c) return script(() => openChest(c));
  const e = actorAt(enemies, x, z);
  if (e) return startEncounter(e);
  if (boss && boss.x === x && boss.z === z) return script(bossEvent);
  if (world.signs[key]) return script(() => talk(world.signs[key]));
  if (world.props.some((p) => p.x === x && p.z === z && p.model === 'well')) return script(() => talk(['いどの なかを のぞきこんだ。', 'つめたい みずが ゆれている…。']));
}

async function building(b) {
  sfx('bump');
  if (b.kind === 'castle') return talk(['しろの もんは かたく とざされている。', 'おうさまは しろの まえに いるようだ。']);
  if (b.kind === 'house') return talk(['「いらっしゃい。ゆっくりしていってね」', '「オークの しょうは ほのおに よわいと きいたことが あるわ」']);
  if (b.kind === 'inn') return inn();
  if (b.kind === 'weapon') return weaponShop();
  if (b.kind === 'item') return itemShop();
}

async function npcTalk(n) {
  n.face(player.x - n.x, player.z - n.z);
  if (n.kind === 'king') return kingTalk();
  if (n.kind === 'princess') return talk(PRINCESS_TALK[hero.flags.bossDown ? 'after' : 'before']);
  await talk(VILLAGER_TALK[n.talk % VILLAGER_TALK.length]);
}

async function kingTalk() {
  if (!hero.flags.metKing) {
    await talk([
      'おうさま「おお、ゆうしゃ アレンよ。よくぞ まいった」',
      'おうさま「きたひがしの とりでに、あかき オークの しょうが すみつき\nまちを おびやかしておる」',
      'おうさま「どうか やつを うちたおし、アストリアに へいわを とりもどしてくれ」',
      'おうさま「わずかだが したくきんじゃ。うけとるがよい」',
    ]);
    hero.gold += 50; hero.items.herb = (hero.items.herb || 0) + 3; hero.flags.metKing = true;
    sfx('coin'); hud();
    await talk(['アレンは 50ゴールドと やくそう 3こを うけとった！']);
    return;
  }
  if (hero.flags.bossDown && !hero.flags.ending) return ending();
  const need = expToNext(hero.lv) - hero.exp;
  await say(`おうさま「アレンよ。つぎの レベルまで あと ${need} の けいけんが ひつようじゃ」`);
  if (await yesno('おうさま「ここまでの ぼうけんを きろく するかね？」')) {
    save(); sfx('powerup');
    await say('ぼうけんの きろくを つけた。');
  }
  await say('おうさま「では ゆくがよい、ゆうしゃよ！」');
  closeMsg();
}

async function inn() {
  const price = 6 + hero.lv * 2;
  await say(`やどや「たびびとの やどやへ ようこそ。ひとばん ${price}ゴールドです」`);
  if (!(await yesno('やどや「おとまりに なりますか？」'))) { await say('やどや「またの おこしを」'); closeMsg(); return; }
  if (hero.gold < price) { await say('やどや「おかねが たりない ようですね…」'); closeMsg(); return; }
  hero.gold -= price; closeMsg(); hud();
  await fade(1, 600);
  const prev = curSong;
  await jingle('inn');
  hero.hp = hero.mhp; hero.mp = hero.mmp; hud();
  save();
  curSong = null; music(prev === 'inn' ? 'town' : prev);
  await fade(0, 600);
  await talk(['やどや「おはようございます。ぼうけんの きろくも つけておきましたよ」']);
}

async function weaponShop() {
  await say('ぶきや「いらっしゃい！ ぶきと ぼうぐの みせだよ」');
  let start = 0;
  for (;;) {
    const goods = [...WEAPONS.filter((w) => w.price > 0).map((w) => ({ ...w, kind: 'weapon' })), ...ARMORS.filter((a) => a.price > 0).map((a) => ({ ...a, kind: 'armor' }))];
    const items = goods.map((g) => {
      const cur = g.kind === 'weapon' ? weapon() : armor();
      const val = g.kind === 'weapon' ? g.atk : g.def;
      const curVal = g.kind === 'weapon' ? cur.atk : cur.def;
      const owned = cur.id === g.id;
      return { label: g.name, right: owned ? 'そうびちゅう' : `${g.price}G`, disabled: owned || val <= curVal,
        info: `${g.kind === 'weapon' ? 'こうげき' : 'しゅび'} +${val}　(いま ${cur.name} +${curVal})\nもちきん ${hero.gold}G` };
    });
    const i = await choose(items, { title: 'なにを かう？', start, style: nearMsg('left') });
    if (i < 0) break;
    start = i;
    const g = goods[i];
    if (hero.gold < g.price) { await say('ぶきや「おかねが たりないよ！」'); continue; }
    if (!(await yesno(`ぶきや「${g.name}は ${g.price}ゴールドだ。かうかい？」`))) continue;
    hero.gold -= g.price; hero[g.kind] = g.id; sfx('coin'); hud();
    await say(`アレンは ${g.name}を そうびした！`);
  }
  await say('ぶきや「まいど！ きを つけてな」'); closeMsg();
}

async function itemShop() {
  await say('どうぐや「いらっしゃいませ。なにに いたしましょう？」');
  let start = 0;
  for (;;) {
    const keys = Object.keys(ITEMS);
    const i = await choose(keys.map((k) => ({ label: ITEMS[k].name, right: `${ITEMS[k].price}G`, info: `${ITEMS[k].desc}　もっている: ${hero.items[k] || 0}\nもちきん ${hero.gold}G` })), { title: 'なにを かう？', start, style: nearMsg('left') });
    if (i < 0) break;
    start = i;
    const it = ITEMS[keys[i]];
    if (hero.gold < it.price) { sfx('cancel'); await say('どうぐや「おかねが たりない ようです」'); continue; }
    hero.gold -= it.price; hero.items[keys[i]] = (hero.items[keys[i]] || 0) + 1; sfx('coin'); hud();
    await say(`${it.name}を かった！`, { auto: 500 });
  }
  await say('どうぐや「ありがとう ございました」'); closeMsg();
}

async function openChest(c) {
  sfx('chest');
  hero.flags['chest_' + c.chest.id] = true;
  await tween(300, (t) => { c.body.scale.y = 1 + t * 0.3; c.body.rotation.y += 0.2; });
  burst(field, new THREE.Vector3(c.x, 0.6, c.z), 0xffe070, 24, { speed: 1.5 });
  c.root.removeFromParent(); chests.splice(chests.indexOf(c), 1);
  const ch = c.chest;
  if (ch.gold) { hero.gold += ch.gold; hud(); await talk([`たからばこを あけた！`, `${ch.gold}ゴールドを てにいれた！`]); }
  else { hero.items[ch.item] = (hero.items[ch.item] || 0) + ch.n; await talk(['たからばこを あけた！', `${ITEMS[ch.item].name}を ${ch.n}こ てにいれた！`]); }
}

async function bossEvent() {
  boss.face(player.x - boss.x, player.z - boss.z);
  music(null);
  sfx('roar');
  await flash(2);
  await talk(['あかきオークの将「グォォォ…！ ニンゲンめ、ここまで きたか！」', 'あかきオークの将「このとりでは オレさまの ものだ。ひねりつぶして くれる！」']);
  const r = await battle(['orc_leader'], { boss: true });
  if (r === 'win') {
    hero.flags.bossDown = true;
    boss.root.removeFromParent(); boss = null;
    await talk(['あかきオークの将を うちたおした！', 'オークたちは ちりぢりに にげていった…', 'おうさまに ほうこく しよう！']);
    for (const e of [...enemies]) if (inRect(CAMP, e.x, e.z)) removeEnemy(e);
  }
}

async function ending() {
  hero.flags.ending = true;
  music(null);
  await talk(['おうさま「おお、アレン！ よくぞ あかき オークの しょうを たおしてくれた！」', 'おうさま「そなたこそ まことの ゆうしゃじゃ。アストリアは すくわれた！」']);
  await jingle('fanfare');
  await fade(1, 1200);
  const cr = $('credits');
  cr.classList.remove('hidden');
  music('title');
  const lines = ['アストリア戦記 〜赤きオークの将〜', '', '3D MODELS', 'Qwen3.5-4B-GLB-3D-Coder + Three.js', '', 'MUSIC & SOUND', '4-OP FM SYNTH', '', 'THANK YOU FOR PLAYING!'];
  cr.innerHTML = '';
  for (const l of lines) { const d = document.createElement('div'); d.textContent = l || '　'; d.style.opacity = 0; d.style.transition = 'opacity 1s'; cr.appendChild(d); await wait(500); d.style.opacity = 1; }
  await say('ゆうしゃの ぼうけんは つづく…（Enter で もどる）');
  closeMsg();
  cr.classList.add('hidden');
  save();
  curSong = null;
  await fade(0, 800);
}

// =====================================================================
// field menu
// =====================================================================
async function fieldMenu() {
  sfx('select');
  let start = 0;
  for (;;) {
    const i = await choose(['つよさ', 'どうぐ', 'まほう', 'きろく', 'とじる'], { start, style: nearMsg('left') });
    start = i;
    if (i < 0 || i === 4) return;
    if (i === 0) {
      await panel(`<b>${hero.name}</b>　Lv ${hero.lv}<br>HP ${hero.hp}/${hero.mhp}　MP ${hero.mp}/${hero.mmp}<br>
        ちから ${hero.str}　たいりょく ${hero.vit}<br>すばやさ ${hero.agi}　かしこさ ${hero.int}<br>
        こうげき ${atkOf()}　しゅび ${defOf()}<br>ぶき: ${weapon().name}<br>よろい: ${armor().name}<br>
        けいけん ${hero.exp}　つぎまで ${expToNext(hero.lv) - hero.exp}<br>ゴールド ${hero.gold}`);
    }
    if (i === 1) await useItemMenu(false);
    if (i === 2) {
      const sp = spellsKnown();
      const j = await choose(sp.map((s) => ({ label: s.name, right: `${s.mp}`, disabled: s.id !== 'heal' || hero.mp < s.mp, info: s.desc })), { title: 'まほう', style: nearMsg('left') });
      if (j >= 0) { hero.mp -= sp[j].mp; const v = healHero(60 + hero.int); sfx('heal'); hud(); await talk([`アレンは ヒールを となえた！ HPが ${v} かいふくした。`]); }
    }
    if (i === 3) { save(); sfx('powerup'); await talk(['ぼうけんの きろくを つけた。']); }
  }
}
function healHero(v) { const b = hero.hp; hero.hp = Math.min(hero.mhp, hero.hp + v); return hero.hp - b; }
function healMp(v) { const b = hero.mp; hero.mp = Math.min(hero.mmp, hero.mp + v); return hero.mp - b; }

// returns true if an item was used
async function useItemMenu(inBattle) {
  const keys = Object.keys(hero.items).filter((k) => hero.items[k] > 0);
  if (!keys.length) { await say('どうぐを なにも もっていない。', inBattle ? { auto: 700 } : {}); if (!inBattle) closeMsg(); return false; }
  const j = await choose(keys.map((k) => ({ label: ITEMS[k].name, right: `×${hero.items[k]}`, info: ITEMS[k].desc })), { title: 'どうぐ', style: nearMsg('left') });
  if (j < 0) return false;
  const k = keys[j];
  hero.items[k]--;
  let text;
  if (k === 'herb') text = `やくそうを つかった！ HPが ${healHero(35)} かいふくした。`;
  if (k === 'ether') text = `まほうのみずを のんだ！ MPが ${healMp(20)} かいふくした。`;
  if (k === 'elixir') text = `いのちのみを たべた！ HPが ${healHero(9999)} かいふくした。`;
  sfx('heal'); hud();
  if (inBattle) { await healFx(); await say(text, { auto: 900 }); } else await talk([text]);
  return true;
}

// =====================================================================
// battle
// =====================================================================
const bscene = new THREE.Scene();
addLights(bscene);
let arena = null, bHero = null, foes = [];
const labelsEl = $('labels');

function buildArena(theme) {
  if (arena) arena.removeFromParent();
  arena = new THREE.Group();
  const T = {
    field: { ground: [0x67a84e, 0x5f9e47, 0x72b257], path: 0xc9a66b, sky: 0x9fd0f0, props: ['tree', 'tree', 'pine', 'rock'], flowers: [0xfff07a, 0xffffff, 0xff9ac8] },
    forest: { ground: [0x4f8f40, 0x47843a, 0x5a9a48], path: 0x8a7048, sky: 0x7fb0c8, props: ['pine', 'pine', 'pine', 'tree'], flowers: [0xffffff, 0xc8a0ff] },
    east: { ground: [0x7a9a50, 0x86a65a, 0x6f8e48], path: 0xb8a070, sky: 0xb0c8e0, props: ['rock', 'rock', 'tree', 'pine'], flowers: [0xfff07a, 0xff8a5a] },
    camp: { ground: [0x6e4c3a, 0x654435, 0x7a5642], path: 0x4a3428, sky: 0x5a2a2a, props: ['tent', 'tent', 'rock', 'pine'], flowers: [] },
  }[theme];
  bscene.background = new THREE.Color(T.sky);
  bscene.fog = new THREE.Fog(bscene.background, 48, 75);
  const M4 = (x, y, z, sx = 1, sy = 1, sz = 1, ry = 0) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(THREE.Object3D.DEFAULT_UP, ry), new THREE.Vector3(sx, sy, sz));
  const put = (geo, material, mats, colors) => {
    const im = new THREE.InstancedMesh(geo, material, mats.length);
    mats.forEach((m, i) => { im.setMatrixAt(i, m); if (colors) im.setColorAt(i, new THREE.Color(colors[i])); });
    im.castShadow = true; im.receiveShadow = true; arena.add(im);
  };
  // fighters stand around the origin: keep tall props out of that area and out of the camera's side
  const nearFight = (x, z) => Math.hypot(x, z) < 4.5;
  const cameraSide = (x, z) => new THREE.Vector3(x, 0, z).dot(TOWARD) > 1.5;

  // ground tiles like the field map (colour noise + slight bumps), out to the horizon
  const tiles = [], tileCols = [];
  for (let z = -16; z <= 16; z++) for (let x = -16; x <= 16; x++) {
    if (Math.hypot(x, z) > 17) continue;
    const onPath = Math.abs(x * TOWARD.z - z * TOWARD.x) < 0.9 && Math.hypot(x, z) > 5;   // a trail running off into the distance
    tiles.push(M4(x, -0.3 + Math.random() * 0.05, z));
    const c = new THREE.Color(onPath ? T.path : pick(T.ground)).offsetHSL(0, 0, rand(-0.03, 0.03));
    tileCols.push(c.getHex());
  }
  put(new THREE.BoxGeometry(1, 0.6, 1), mat(0xffffff), tiles, tileCols);
  const far = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), mat(T.ground[1]));
  far.rotation.x = -Math.PI / 2; far.position.y = -0.32; far.receiveShadow = true; arena.add(far);

  // small things on the ground
  const tufts = [], flowers = [], flowerCols = [], pebbles = [], extras = [];
  for (let i = 0; i < 260; i++) {
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * 15;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const k = Math.random();
    if (theme !== 'camp' && k < 0.55) {
      for (let j = 0; j < 3; j++) tufts.push(M4(x + rand(-0.12, 0.12), 0.1, z + rand(-0.12, 0.12), 1, rand(0.7, 1.4), 1, Math.random() * 6));
    } else if (T.flowers.length && k < 0.72) {
      flowers.push(M4(x, 0.08, z, rand(0.8, 1.3), rand(0.8, 1.3), rand(0.8, 1.3))); flowerCols.push(pick(T.flowers));
    } else if (k < 0.9) {
      pebbles.push(M4(x, 0.02, z, rand(0.6, 1.6), rand(0.5, 1), rand(0.6, 1.6), Math.random() * 6));
    } else extras.push({ x, z });
  }
  const tuftCol = theme === 'forest' ? 0x3f7a34 : theme === 'east' ? 0x8aa058 : 0x5c9a42;
  if (tufts.length) put(new THREE.ConeGeometry(0.07, 0.36, 3), mat(tuftCol), tufts);
  if (flowers.length) put(new THREE.IcosahedronGeometry(0.06, 0), mat(0xffffff, { emissive: 0x222222 }), flowers, flowerCols);
  put(new THREE.DodecahedronGeometry(0.09, 0), mat(theme === 'camp' ? 0x5a4a40 : 0x9a9a94), pebbles);
  if (theme === 'camp') {   // scattered bones and scorched dirt
    put(new THREE.CylinderGeometry(0.035, 0.035, 0.45, 5), mat(0xe8e0c8), extras.map((p) => M4(p.x, 0.05, p.z, 1, 1, 1, Math.random() * 6).multiply(new THREE.Matrix4().makeRotationZ(Math.PI / 2))));
    put(new THREE.CylinderGeometry(0.6, 0.7, 0.04, 7), mat(0x2e221c), extras.slice(0, 8).map((p) => M4(p.x * 0.7, -0.0, p.z * 0.7, rand(0.8, 1.5), 1, rand(0.8, 1.5))));
  } else if (theme === 'forest') {   // mushrooms
    put(new THREE.CylinderGeometry(0.03, 0.04, 0.14, 5), mat(0xf0e8d8), extras.map((p) => M4(p.x, 0.07, p.z)));
    put(new THREE.SphereGeometry(0.09, 6, 3, 0, Math.PI * 2, 0, Math.PI / 2), mat(0xc8402a), extras.map((p) => M4(p.x, 0.13, p.z)));
  }

  // scenery all around, except the fighting area and the camera side
  const props = { tree: [], pine: [], rock: [], tent: [], campfire: [] };
  for (let i = 0; i < 90; i++) {
    const a = Math.random() * Math.PI * 2, r = i < 40 ? rand(4.8, 8.5) : rand(8.5, 15);
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (nearFight(x, z) || cameraSide(x, z)) continue;
    const kind = pick(T.props);
    props[kind].push({ x, z, rot: Math.random() * 6, s: kind === 'rock' ? rand(0.7, 1.8) : rand(0.85, 1.35) });
  }
  if (theme === 'camp') props.campfire.push({ x: -TOWARD.x * 6 + RIGHT.x * 2, z: -TOWARD.z * 6 + RIGHT.z * 2, rot: 0, s: 1.3 });
  for (const [k, l] of Object.entries(props)) addInstanced(arena, k, l);
  bscene.add(arena);
}

function battleTheme() {
  const x = player.x, z = player.z;
  if (inRect(CAMP, x, z) || (boss && Math.hypot(x - boss.x, z - boss.z) < 3)) return 'camp';
  if (x > 29) return 'east';
  if (tileAt(x, z) === 'f') return 'forest';
  return 'field';
}

function screenPos(v, camera) {
  const p = v.clone().project(camera);
  return { x: (p.x + 1) / 2 * innerWidth, y: (1 - p.y) / 2 * innerHeight };
}
function popNumber(pos3, text, cls = '') {
  const s = screenPos(pos3, bcam);
  const d = document.createElement('div');
  d.className = 'dmg ' + cls; d.textContent = text;
  d.style.left = s.x + 'px'; d.style.top = s.y + 'px';
  $('fx').appendChild(d);
  setTimeout(() => d.remove(), 1000);
}

const HERO_BH = 2.0;   // hero height on the battle screen (monsters use MONSTERS[k].bh)
function setupBattle(kinds, theme) {
  buildArena(theme);
  foes.forEach((f) => f.actor.root.removeFromParent());
  if (bHero) bHero.root.removeFromParent();
  labelsEl.innerHTML = '';
  bHero = new Actor('hero', 0, 0, { scale: HERO_BH / SPEC.hero.h });
  bHero.walkAnim = true;
  bHero.home = RIGHT.clone().multiplyScalar(-2.4).addScaledVector(TOWARD, 1.8);
  bHero.root.position.copy(bHero.home);
  bscene.add(bHero.root);
  const n = kinds.length;
  // monsters get their own (larger) battle height; bigger foes stand further back and spread wider
  const maxBh = Math.max(...kinds.map((k) => MONSTERS[k].bh));
  const center = RIGHT.clone().multiplyScalar(1.3 + maxBh * 0.3).addScaledVector(TOWARD, -1.0 - maxBh * 0.2);
  const spread = RIGHT.clone().multiplyScalar(0.6).addScaledVector(TOWARD, 0.8).normalize();
  const gap = Math.max(2.0, maxBh * 0.95);
  const faceAt = bHero.home.clone().addScaledVector(TOWARD, 3);   // enemies look at the hero and a bit toward the camera
  const hd = center.clone().sub(bHero.home);
  bHero.dir = bHero.body.rotation.y = Math.atan2(hd.x, hd.z);
  foes = kinds.map((k, i) => {
    const m = MONSTERS[k];
    const a = new Actor(k, 0, 0, { scale: m.bh / SPEC[k].h });
    const off = (i - (n - 1) / 2) * gap;
    a.home = center.clone().addScaledVector(spread, off);
    a.root.position.copy(a.home);
    const d = faceAt.clone().sub(a.home);
    a.dir = a.body.rotation.y = Math.atan2(d.x, d.z);
    bscene.add(a.root);
    const label = document.createElement('div');
    label.className = 'elabel';
    labelsEl.appendChild(label);
    const letter = n > 1 && kinds.filter((x) => x === k).length > 1 ? 'ABC'[kinds.slice(0, i + 1).filter((x) => x === k).length - 1] : '';
    return { kind: k, m, name: m.name + letter, hp: m.hp, mhp: m.hp, atk: m.atk, def: m.def, actor: a, label, alive: true, buff: 0 };
  });
  // zoom out just enough for big monsters or a wide group
  bcam.userData.half = 4.3 + Math.max(0, maxBh - 2) * 0.55 + (n - 1) * Math.max(0, maxBh - 1.8) * 0.35;
  fitCam(bcam);
  const look = new THREE.Vector3(0.3, 0.9 + maxBh * 0.15, 0);
  bcam.position.copy(CAM_OFF).add(look);
  bcam.lookAt(look);
  bscene.children.filter((o) => o.isDirectionalLight).forEach((d) => { d.position.set(6, 14, 8); d.target.position.set(0, 0, 0); });
}
function updateLabels() {
  for (const f of foes) {
    if (!f.alive) { f.label.style.display = 'none'; continue; }
    const top = f.actor.root.position.clone(); top.y = f.m.bh + 0.25;
    const s = screenPos(top, bcam);
    f.label.style.left = s.x + 'px'; f.label.style.top = s.y - 40 + 'px';
    f.label.innerHTML = `${f.name}<div class="bar"><i style="width:${(f.hp / f.mhp) * 100}%"></i></div>`;
  }
}

async function lunge(actor, target, dist = 1.2) {
  const from = actor.root.position.clone();
  const dir = target.clone().sub(from).setY(0).normalize();
  actor.forceAnim = true;
  await tween(170, (t) => actor.root.position.copy(from).addScaledVector(dir, dist * easeOut(t)));
  await tween(220, (t) => actor.root.position.copy(from).addScaledVector(dir, dist * (1 - t)));
  actor.forceAnim = false;
}
async function hitFx(actor) {
  const base = actor.root.position.clone();
  await tween(300, (t) => {
    actor.root.position.x = base.x + Math.sin(t * 40) * 0.12 * (1 - t);
    actor.body.visible = Math.floor(t * 10) % 2 === 0;
  });
  actor.body.visible = true; actor.root.position.copy(base);
}
async function dieFx(f) {
  const a = f.actor;
  sfx('explosion', { x: 600, width: 960 });
  burst(bscene, a.root.position.clone().setY(0.6), f.m.boss ? 0xff5030 : 0xffffff, f.m.boss ? 60 : 24);
  await tween(f.m.boss ? 1200 : 450, (t) => { a.root.scale.setScalar(1 - t); a.body.rotation.z = t * 0.8; });
  a.root.visible = false;
}
async function magicFx(kind, targets) {
  if (kind === 'fire' || kind === 'blaze') {
    for (const f of targets) {
      const p = f.actor.root.position.clone().setY(0.5);
      burst(bscene, p, 0xff7020, kind === 'blaze' ? 70 : 30, { speed: 1.4, up: [2, 5], g: 2, size: kind === 'blaze' ? 2 : 1.3 });
      burst(bscene, p, 0xffd040, kind === 'blaze' ? 40 : 14, { speed: 1, up: [2, 4], g: 1, size: 1 });
    }
    await wait(400);
  } else if (kind === 'thunder') {
    flash(2);
    for (const f of targets) {
      const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.15, 12, 5), new THREE.MeshBasicMaterial({ color: 0xfff6a0 }));
      bolt.position.copy(f.actor.root.position).setY(6);
      bscene.add(bolt);
      burst(bscene, f.actor.root.position.clone().setY(0.3), 0xfff6a0, 20, { flat: true, up: [0.5, 2] });
      setTimeout(() => bolt.removeFromParent(), 260);
    }
    await wait(350);
  }
}
async function healFx() {
  burst(bscene, bHero.root.position.clone().setY(0.2), 0x70ff90, 26, { speed: 0.6, up: [1.5, 3], g: -1, size: 0.9 });
  popNumber(bHero.root.position.clone().setY(1.6), '✚', 'heal');
  await wait(300);
}

const variance = () => rand(0.85, 1.15);
function physDamage(atk, def) { return Math.max(1, Math.round((atk - def / 2) * variance())); }

let battleBusy = false;
async function battle(kinds, o = {}) {
  battleBusy = true;
  const theme = o.theme || battleTheme();
  const prevMode = mode;
  setupBattle(kinds, theme);
  mode = 'battle';
  $('zone').classList.add('hidden');
  music(o.boss ? 'boss' : 'battle');
  await fade(0, 250);
  const names = [...new Set(foes.map((f) => f.m.name))];
  await say(foes.length > 1 ? `${names.join('と ')}たちが あらわれた！` : `${foes[0].m.name}が あらわれた！`, { auto: 900 });
  let result = null;
  while (!result) {
    // ---- player turn ----
    const act = await playerTurn(o);
    if (act === 'run') {
      if (o.boss) { await say('しかし まわりこまれて しまった！', { auto: 900 }); }
      else if (Math.random() < 0.65) { sfx('jump'); await say('アレンは にげだした！', { auto: 700 }); result = 'run'; break; }
      else await say('しかし にげられなかった！', { auto: 900 });
    }
    if (foes.every((f) => !f.alive)) { result = 'win'; break; }
    // ---- enemy turn ----
    for (const f of foes) {
      if (!f.alive) continue;
      await enemyAct(f, o);
      if (hero.hp <= 0) { result = 'lose'; break; }
      if (f.m.boss && f.hp < f.mhp / 2 && Math.random() < 0.35 && hero.hp > 0) {
        await say(`${f.name}の いかりの れんぞくこうげき！`, { auto: 700 });
        await enemyAct(f, o);
        if (hero.hp <= 0) { result = 'lose'; break; }
      }
    }
  }
  labelsEl.innerHTML = '';
  if (result === 'win') await victory();
  if (result === 'lose') await defeat();
  closeMsg();
  await fade(1, 300);
  mode = prevMode === 'battle' ? 'field' : prevMode;
  curSong = null;
  $('zone').classList.remove('hidden');
  await fade(0, 300);
  battleBusy = false;
  return result;
}

async function playerTurn(o) {
  for (;;) {
    await say(`アレンは どうする？`, { auto: 1 });
    const cmd = await choose(['たたかう', 'まほう', 'どうぐ', 'にげる'], { cancel: false, style: nearMsg('left') });
    if (cmd === 0) {
      const f = await pickTarget();
      if (!f) continue;
      await heroAttack(f);
      return 'attack';
    }
    if (cmd === 1) {
      const sp = spellsKnown();
      const j = await choose(sp.map((s) => ({ label: s.name, right: `MP ${s.mp}`, disabled: hero.mp < s.mp, info: s.desc })), { title: 'まほう', style: nearMsg('left') });
      if (j < 0) continue;
      const s = sp[j];
      let targets;
      if (s.id === 'fire' || s.id === 'blaze') { const f = await pickTarget(); if (!f) continue; targets = [f]; }
      else if (s.id === 'thunder') targets = foes.filter((f) => f.alive);
      hero.mp -= s.mp; hud();
      await castSpell(s, targets);
      return 'magic';
    }
    if (cmd === 2) { if (await useItemMenu(true)) return 'item'; continue; }
    if (cmd === 3) return 'run';
  }
}

async function pickTarget() {
  const alive = foes.filter((f) => f.alive);
  if (alive.length === 1) return alive[0];
  const j = await choose(alive.map((f) => ({ label: f.name, right: '' })), {
    title: 'だれを？', style: nearMsg('left'),
    onMove: (i) => alive.forEach((f, k) => f.label.classList.toggle('target', k === i)),
  });
  alive.forEach((f) => f.label.classList.remove('target'));
  return j < 0 ? null : alive[j];
}

async function heroAttack(f) {
  await say(`アレンの こうげき！`, { auto: 350 });
  const lung = lunge(bHero, f.actor.root.position, 1.6);
  await wait(170);
  sfx('slash');
  if (Math.random() < 0.05) { sfx('miss'); popNumber(f.actor.root.position.clone().setY(1.2), 'MISS'); await lung; await say(`ミス！ ${f.name}は ひらりと かわした。`, { auto: 700 }); return; }
  const crit = Math.random() < 0.07;
  const dmg = crit ? Math.round(atkOf() * 1.6 * variance()) : physDamage(atkOf(), f.def);
  if (crit) { sfx('crit'); flash(1); }
  else sfx('hit');
  await damageFoe(f, dmg, crit);
  await lung;
  await say(crit ? `かいしんの いちげき！ ${f.name}に ${dmg}の ダメージ！` : `${f.name}に ${dmg}の ダメージ！`, { auto: 650 });
  if (f.hp <= 0) await killFoe(f);
}

async function damageFoe(f, dmg, crit) {
  f.hp = Math.max(0, f.hp - dmg);
  popNumber(f.actor.root.position.clone().setY(f.m.bh * 0.7), String(dmg), crit ? 'crit' : '');
  burst(bscene, f.actor.root.position.clone().setY(0.6), 0xffffff, 8, { speed: 1.5 });
  await hitFx(f.actor);
}
async function killFoe(f) {
  f.alive = false;
  await dieFx(f);
  await say(`${f.name}を たおした！`, { auto: 600 });
}

async function castSpell(s, targets) {
  await say(`アレンは ${s.name}を となえた！`, { auto: 450 });
  await tween(300, (t) => { bHero.root.position.y = Math.sin(t * Math.PI) * 0.4; });
  if (s.id === 'heal') {
    sfx('heal'); await healFx();
    const v = healHero(60 + hero.int); hud();
    await say(`HPが ${v} かいふくした！`, { auto: 700 });
    return;
  }
  sfx(s.id === 'thunder' ? 'thunder' : s.id === 'blaze' ? 'blaze' : 'fire');
  await magicFx(s.id, targets);
  for (const f of targets) {
    const base = { fire: 14 + hero.int * 1.3, thunder: 12 + hero.int * 1.1, blaze: 45 + hero.int * 2.2 }[s.id];
    const weak = f.kind === 'orc_leader' && (s.id === 'fire' || s.id === 'blaze') ? 1.35 : 1;
    const dmg = Math.max(1, Math.round((base - f.def / 4) * variance() * weak));
    await damageFoe(f, dmg, false);
    await say(`${f.name}に ${dmg}の ダメージ！`, { auto: 550 });
    if (f.hp <= 0) await killFoe(f);
  }
}

async function enemyAct(f, o) {
  const m = f.m;
  let mult = 1, verb = `${f.name}の こうげき！`;
  if (m.boss) {
    const r = Math.random();
    if (r < 0.15 && f.buff < 2) {
      f.buff++; f.atk = Math.round(f.atk * 1.2);
      sfx('roar');
      await tween(500, (t) => f.actor.body.scale.setScalar(1 + Math.sin(t * Math.PI) * 0.15));
      await say(`${f.name}は おたけびを あげた！ こうげきりょくが あがった！`, { auto: 900 });
      return;
    }
    if (r < 0.45) { mult = 1.6; verb = `${f.name}の ちからため なぎはらい！`; }
  } else if (f.kind === 'wolf' && Math.random() < 0.25) { mult = 1.3; verb = `${f.name}は するどく かみついた！`; }
  else if (f.kind === 'skeleton' && Math.random() < 0.2) { mult = 1.4; verb = `${f.name}の きりさき こうげき！`; }
  await say(verb, { auto: 400 });
  const lung = lunge(f.actor, bHero.root.position, m.boss ? 1.8 : 1.4);
  await wait(170);
  if (Math.random() < 0.06 + hero.agi * 0.002) { sfx('miss'); popNumber(bHero.root.position.clone().setY(1.2), 'MISS'); await lung; await say('アレンは ひらりと みを かわした！', { auto: 600 }); return; }
  const dmg = Math.max(1, Math.round(physDamage(f.atk, defOf()) * mult));
  sfx('damage');
  hero.hp = Math.max(0, hero.hp - dmg); hud();
  popNumber(bHero.root.position.clone().setY(1.3), String(dmg), 'player');
  if (mult > 1.2) { flash(1); }
  shakeScreen(mult > 1.2 ? 12 : 6);
  await Promise.all([hitFx(bHero), lung]);
  await say(`アレンは ${dmg}の ダメージを うけた！`, { auto: 600 });
}

function shakeScreen(px) {
  const el = renderer.domElement;
  tween(300, (t) => { el.style.transform = `translate(${Math.sin(t * 50) * px * (1 - t)}px, ${Math.cos(t * 43) * px * 0.5 * (1 - t)}px)`; }).then(() => (el.style.transform = ''));
}

async function victory() {
  let exp = 0, gold = 0;
  for (const f of foes) { exp += f.m.exp; gold += f.m.gold; }
  hero.exp += exp; hero.gold += gold; hud();
  music(null);
  jingle('victory');
  bHero.forceAnim = false;
  tween(500, (t) => { bHero.root.position.y = Math.sin(t * Math.PI) * 0.5; });
  await say(`まものたちを やっつけた！\n${exp}ポイントの けいけんちを かくとく。${gold}ゴールドを てにいれた！`);
  while (hero.exp >= expToNext(hero.lv)) {
    hero.exp -= expToNext(hero.lv);
    hero.lv++;
    const before = spellsKnown().length;
    const g = growth(hero);
    hero.hp = Math.min(hero.mhp, hero.hp + g.mhp); hero.mp = Math.min(hero.mmp, hero.mp + g.mmp);
    hud();
    burst(bscene, bHero.root.position.clone().setY(0.2), 0xffe070, 30, { speed: 0.8, up: [2, 4], g: 1 });
    jingle('levelup');
    await say(`アレンは レベル ${hero.lv} に あがった！\nHP+${g.mhp} MP+${g.mmp} ちから+${g.str} たいりょく+${g.vit} すばやさ+${g.agi} かしこさ+${g.int}`);
    const sp = spellsKnown();
    if (sp.length > before) await say(`アレンは ${sp[sp.length - 1].name}の まほうを おぼえた！`);
  }
}

async function defeat() {
  music(null);
  await tween(700, (t) => { bHero.body.rotation.z = -t * Math.PI / 2; bHero.body.position.y = -t * 0.2; });
  jingle('gameover');
  await say('アレンは ちからつきた…');
  await fade(1, 800);
  hero.gold = Math.floor(hero.gold / 2);
  hero.hp = hero.mhp; hero.mp = hero.mmp;
  placePlayer(5, 35);
  hud();
  await say('…きがつくと やどやの まえに いた。\nもちきんが はんぶんに なってしまった。');
}

function placePlayer(x, z) {
  player.x = player.fx = x; player.z = player.fz = z; player.t = 1;
  player.root.position.set(x, 0, z);
  player.dir = Math.PI; player.body.rotation.y = Math.PI;
  for (const e of [...enemies]) if (Math.hypot(e.x - x, e.z - z) < 8) removeEnemy(e);
}

function startEncounter(e) {
  if (lock || battleBusy || mode !== 'field') return;
  script(async () => {
    e.face(player.x - e.x, player.z - e.z);
    player.face(e.x - player.x, e.z - player.z);
    sfx('encounter');
    music(null);
    await flash(3);
    await fade(1, 250);
    const r = await battle(new Array(e.count || 1).fill(e.kind));   // exactly the group shown on the map
    if (r === 'win') removeEnemy(e);
    else if (r === 'run') { e.timer = 3; }
    else removeEnemy(e);
    encounterGrace = 2.0;
  });
}

// =====================================================================
// zones / music
// =====================================================================
let zoneName = '';
function zoneOf(x, z) {
  if (inRect(TOWN, x, z)) return ['アストリアの まち', 'town'];
  if (inRect(CAMP, x, z) || (z < 16 && x > 33)) return ['オークの とりで', 'camp'];
  if (z < 19 && x < 26) return ['まよいの もり', 'field'];
  return ['アストリア へいげん', 'field'];
}
function updateZone() {
  const [name, song] = zoneOf(player.x, player.z);
  if (name !== zoneName) { zoneName = name; const z = $('zone'); z.textContent = name; }
  if (mode === 'field' && !battleBusy && !lock && !jingleBusy && curSong !== song) music(song);
}

// =====================================================================
// title
// =====================================================================
let titleReady = false, titleBusy = false;
async function titleKey(k, rep) {
  if (!titleReady || rep) return;
  if (uiStack.length) { uiStack[uiStack.length - 1].onKey(k, rep); return; }
  if (k !== 'ok' || titleBusy) return;
  titleBusy = true;
  await initAudio();
  music('title');
  document.querySelector('#title .press').classList.add('hidden');
  const saved = loadSave();
  const i = await choose([{ label: 'はじめから' }, { label: 'つづきから', disabled: !saved }], { cancel: false, start: saved ? 1 : 0, style: { left: '50%', bottom: '18%', transform: 'translateX(-50%)' } });
  await fade(1, 600);
  $('title').classList.add('hidden');
  if (i === 1 && saved) hero = Object.assign(newHero(), saved);
  startGame(i === 0);
}

async function initAudio() {
  if (FM.ctx) return;
  await FM.init({ musicVoices: 20, sfxVoices: 14, echo: 0.2 });
  defineSfx();
  SONGS = buildSongs();
  FM.setVolume({ music: 0.75, sfx: 0.9 });
  if (!soundOn) { FM.muted = false; FM.toggleMute(); }   // init ignores FM.muted, so apply it now
}

// sound is on by default; index.html?mute starts silent (used for testing); M toggles it
let soundOn = !new URLSearchParams(location.search).has('mute');
function toggleSound() {
  soundOn = !soundOn;
  if (FM.ctx && FM.muted === soundOn) FM.toggleMute();
  showSound();
}
function showSound() { document.querySelectorAll('.snd').forEach((el) => (el.textContent = soundOn ? '♪ ON' : '♪ OFF')); }
showSound();

async function startGame(fresh) {
  // rebuild dynamic actors for the loaded state
  [...npcs, ...chests, ...enemies].forEach((a) => a.root.removeFromParent());
  npcs.length = chests.length = enemies.length = 0;
  if (boss) boss.root.removeFromParent(), (boss = null);
  if (player) player.root.removeFromParent();
  spawnWorldActors();
  if (fresh) placePlayer(10, 29); else placePlayer(hero.x, hero.z);
  player.dir = player.body.rotation.y = Math.PI;
  spawnAllPosts();
  mode = 'field'; curSong = null;
  hud();
  ['hud', 'zone', 'help'].forEach((id) => $(id).classList.remove('hidden'));
  snapCamera();
  await fade(0, 800);
  music(zoneOf(player.x, player.z)[1]);
  if (fresh) script(kingTalk);
}

// =====================================================================
// main loop
// =====================================================================
const clock = new THREE.Clock();
const camTarget = new THREE.Vector3();
function snapCamera() { camTarget.set(player.x, 0, player.z); }
let titleAngle = 0;

let lastFrame = 0;
function frame() {
  requestAnimationFrame(frame);
  lastFrame = performance.now();
  step(Math.min(clock.getDelta(), 0.05));
}
// keep timers/tweens running when rAF is paused (hidden pane / background tab)
setInterval(() => { if (mode !== 'loading' && performance.now() - lastFrame > 250) step(Math.min(clock.getDelta(), 0.05)); }, 50);
function step(dt) {
  const time = clock.elapsedTime;
  updateTweens(dt);
  updateParticles(dt);
  if (water) water.material.uniforms.uTime.value = time;
  fireLights.forEach((l, i) => (l.intensity = 5 + Math.sin(time * 13 + i) * 1.2 + Math.sin(time * 7.3 + i * 2) * 0.8));
  ambient.forEach((a) => a.update(dt, time));

  if (mode === 'battle') {
    bHero.update(dt, time);
    foes.forEach((f) => f.actor.update(dt, time));
    updateLabels();
    renderer.render(bscene, bcam);
    return;
  }
  if (mode === 'title' || mode === 'loading') {
    titleAngle += dt * 0.08;
    const c = new THREE.Vector3(10, 0, 28);
    cam.position.set(c.x + Math.sin(AZ + titleAngle) * 30, 26, c.z + Math.cos(AZ + titleAngle) * 30);
    cam.lookAt(c);
    sun.position.set(c.x + 6, 14, c.z + 8); sun.target.position.copy(c);
    npcs.forEach((n) => n.update(dt, time));
    renderer.render(field, cam);
    return;
  }
  // field
  if (encounterGrace > 0) encounterGrace -= dt;
  updatePlayer();
  if (!lock && !uiStack.length) { updateEnemies(dt); updateNpcs(dt); }
  player.update(dt, time);
  npcs.forEach((n) => n.update(dt, time));
  enemies.forEach((e) => e.update(dt, time));
  chests.forEach((c) => c.update(dt, time));
  if (boss) boss.update(dt, time);
  updateZone();
  camTarget.lerp(player.root.position, Math.min(1, dt * 6));
  cam.position.copy(camTarget).add(CAM_OFF);
  cam.lookAt(camTarget);
  sun.position.copy(camTarget).add(new THREE.Vector3(6, 14, 8));
  sun.target.position.copy(camTarget);
  renderer.render(field, cam);
}
window.__game = {
  async quickStart() { await initAudio(); hero.flags.metKing = true; $('title').classList.add('hidden'); await startGame(false); },
  step, tp: (x, z) => { placePlayer(x, z); snapCamera(); }, get mode() { return mode; }, hero: () => hero, player: () => player, battle, FM, startEncounter, enemies, models };

// =====================================================================
// boot
// =====================================================================
(async () => {
  await loadModels((n, total) => { $('loading').textContent = `3Dモデルを よみこみちゅう… ${n} / ${total}`; });
  buildTerrain();
  spawnWorldActors();
  mode = 'title';
  $('loading').textContent = '';
  titleReady = true;
  frame();
})();
