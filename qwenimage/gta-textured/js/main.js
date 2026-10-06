import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { buildBuilding, applyTimeColors, makeGlassFresnel, setSeed, rnd, bakeStats } from './buildings.js';

// ============================================================ constants
const S = 1.75;                      // building local units -> metres (floor pitch 3.5 m)
const NB = 6, ROAD = 16, BLOCK = 72, SW = 4.5;
const P = BLOCK + ROAD, HALF = NB * P / 2;
const LANE = 3.4, CURB = 0.15;
const EDGE = HALF + 70;              // playable boundary
const roadC = k => -HALF + k * P;
const blockC = k => roadC(k) + P / 2;
const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]];
const rightOf = d => [-DIRS[d][1], DIRS[d][0]];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrapA = a => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };
const R = (a, b) => a + (b - a) * Math.random();
const $ = id => document.getElementById(id);

// ============================================================ renderer / scene
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.domElement.id = 'gl';
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(65, innerWidth / innerHeight, 0.1, 2000);
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.6, 0.45, 0.92);
composer.addPass(bloom);
composer.addPass(new OutputPass());
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight); composer.setSize(innerWidth, innerHeight);
});

const cityGroup = new THREE.Group(); scene.add(cityGroup);
const dynGroup = new THREE.Group(); scene.add(dynGroup);
const glassMeshes = [];

// ============================================================ loading helpers
const loadBar = document.querySelector('#loadbar > div');
function progress(f, txt) { loadBar.style.width = (f * 100).toFixed(1) + '%'; if (txt) $('loadtxt').textContent = txt; }
// yield after the frame is painted; falls back to a timer when the tab is hidden (rAF paused)
const afterPaint = () => new Promise(r => {
  let done = false; const fin = () => { if (!done) { done = true; r(); } };
  requestAnimationFrame(() => { const ch = new MessageChannel(); ch.port1.onmessage = fin; ch.port2.postMessage(0); });
  setTimeout(fin, 120);
});
let lastYield = performance.now();
async function maybeYield() { if (performance.now() - lastYield > 140) { await afterPaint(); lastYield = performance.now(); } }

const texLoader = new THREE.TextureLoader();
function loadTex(name, srgb = true) {
  return new Promise(res => texLoader.load('assets/' + name, t => {
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    res(t);
  }, undefined, () => { console.warn('missing texture', name); res(null); }));
}
function avgLinear(tex) {
  if (!tex) return [0.35, 0.33, 0.3];
  const c = document.createElement('canvas'); c.width = c.height = 1;
  const g = c.getContext('2d'); g.drawImage(tex.image, 0, 0, 1, 1);
  const d = g.getImageData(0, 0, 1, 1).data;
  const lin = v => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
  return [lin(d[0]), lin(d[1]), lin(d[2])];
}
function radialTex(inner = 'rgba(255,255,255,1)', size = 128) {
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gr.addColorStop(0, inner); gr.addColorStop(0.35, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// ============================================================ sky
const skyMat = new THREE.ShaderMaterial({
  side: THREE.BackSide, depthWrite: false, fog: false,
  uniforms: {
    top: { value: new THREE.Color() }, horizon: { value: new THREE.Color() }, ground: { value: new THREE.Color() },
    sunDir: { value: new THREE.Vector3(0.4, 0.6, 0.3).normalize() }, night: { value: 1 }
  },
  vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }`,
  fragmentShader: `
    uniform vec3 top, horizon, ground, sunDir; uniform float night; varying vec3 vDir;
    float hash(vec3 p){ p = fract(p*0.3183099+0.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
    void main(){
      vec3 d = normalize(vDir); float h = d.y;
      vec3 col = h > 0.0 ? mix(horizon, top, pow(clamp(h,0.0,1.0), 0.55)) : mix(horizon, ground, clamp(-h*6.0,0.0,1.0));
      float s = max(dot(d, normalize(sunDir)), 0.0);
      if (night < 0.5) { col += vec3(1.0,0.85,0.6)*pow(s, 600.0)*30.0 + vec3(1.0,0.7,0.4)*pow(s,8.0)*0.25; }
      else {
        col += vec3(0.8,0.85,1.0)*smoothstep(0.9993,0.9996,s)*3.0 + vec3(0.25,0.3,0.45)*pow(s,40.0)*0.3;
        vec3 q = floor(d*420.0); float st = hash(q);
        if (st > 0.9975 && h > 0.05) col += vec3(0.9,0.92,1.0) * (st-0.9975)*400.0 * smoothstep(0.05,0.3,h);
        col += vec3(0.25,0.12,0.08) * pow(1.0-abs(h),18.0) * step(0.0,h); // city glow at horizon
      }
      gl_FragColor = vec4(col, 1.0);
    }`
});
const sky = new THREE.Mesh(new THREE.SphereGeometry(1500, 48, 24), skyMat);
scene.add(sky);

const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xffffff, 1);
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -95, right: 95, top: 95, bottom: -95, near: 1, far: 500 });
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.06;
scene.add(sun, sun.target);
const STREET_PL = 6;
const streetPLs = Array.from({ length: STREET_PL }, () => { const l = new THREE.PointLight(0xffb070, 0, 26, 1.6); scene.add(l); return l; });
const headSpot = new THREE.SpotLight(0xfff2dd, 0, 70, 0.55, 0.45, 1.3); scene.add(headSpot, headSpot.target);

// ============================================================ state
const state = {
  night: true, money: 250, heat: 0, stars: 0, evade: 0, health: 100, dead: false, msgT: 0,
  helpOn: true, locked: false, time: 0
};

// ============================================================ materials
let TX = {};
const facadeTypes = {};
let roofMat, sidewalkMat, asphaltMat, grassMat, interiorMat, fixtureMat, markYellow, markWhite;
const glassFresnel = makeGlassFresnel(0.14, 0.88);
const smokedFresnel = makeGlassFresnel(0.45, 0.95);

async function initMaterials() {
  const names = ['asphalt', 'sidewalk', 'brick', 'concrete', 'stone', 'metal', 'grass', 'roof'];
  const ts = await Promise.all(names.map(n => loadTex(n + '.png')));
  names.forEach((n, i) => TX[n] = ts[i]);
  for (const ad of ['ad1', 'ad2', 'ad3']) TX[ad] = await loadTex(ad + '.png');
  TX.signs = (await Promise.all(Array.from({ length: 10 }, (_, i) => loadTex(`signs/s${i + 1}.png`)))).filter(Boolean);
  TX.trucks = (await Promise.all(Array.from({ length: 5 }, (_, i) => loadTex(`trucks/t${i + 1}.png`)))).filter(Boolean);
  for (const t of [...TX.signs, ...TX.trucks]) { t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; }
  TX.title = null;

  const rep = (t, r) => { if (t) t.repeat.set(r, r); return t; };
  // facade UVs are in local building units; repeat = 1 / tile size (local)
  const mkType = (key, tileM, rough, metal, tints) => {
    const t = TX[key]; rep(t, S / tileM);
    const avg = avgLinear(t);
    facadeTypes[key] = tints.map(tc => ({
      mat: new THREE.MeshStandardMaterial({ map: t, color: new THREE.Color(...tc), roughness: rough, metalness: metal }),
      avg: [avg[0] * tc[0], avg[1] * tc[1], avg[2] * tc[2]]
    }));
  };
  mkType('brick', 2.9, 0.92, 0, [[1, 1, 1], [0.78, 0.66, 0.6], [0.62, 0.62, 0.66], [1, 0.9, 0.8]]);
  mkType('concrete', 4.5, 0.88, 0, [[1, 1, 1], [0.85, 0.82, 0.78], [0.7, 0.74, 0.8]]);
  mkType('stone', 4.0, 0.85, 0, [[1, 1, 1], [0.9, 0.84, 0.76], [1, 0.95, 0.9]]);
  mkType('metal', 5.0, 0.42, 0.35, [[1, 1, 1], [0.75, 0.82, 0.9], [0.6, 0.6, 0.62]]);
  roofMat = new THREE.MeshStandardMaterial({ map: rep(TX.roof, S / 6), roughness: 0.95 });
  sidewalkMat = new THREE.MeshStandardMaterial({ map: rep(TX.sidewalk, BLOCK / 3.2), roughness: 0.9 });
  asphaltMat = new THREE.MeshStandardMaterial({ map: TX.asphalt, roughness: 0.82, color: 0xbfbfbf });
  if (TX.asphalt) TX.asphalt.repeat.set((2 * HALF + ROAD) / 7, (2 * HALF + ROAD) / 7);
  grassMat = new THREE.MeshStandardMaterial({ map: TX.grass, roughness: 1, color: 0xcfe0c0 });
  interiorMat = new THREE.MeshBasicMaterial({ vertexColors: true });
  fixtureMat = new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
  markYellow = new THREE.MeshStandardMaterial({ color: 0xd8a920, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  markWhite = new THREE.MeshStandardMaterial({ color: 0xdedede, roughness: 0.7, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
}

// ============================================================ city layout
const buildings = [];             // {x0,x1,z0,z1,h, mesh, glass, fix, probe}
const byBlock = [];               // [i][j] -> buildings
const parks = new Set(['1,4', '4,1', '5,5']);
const isPark = (i, j) => parks.has(i + ',' + j);
function blockIndex(v) { return Math.floor((v + HALF) / P); }
function onBlock(x, z) {
  const i = blockIndex(x), j = blockIndex(z);
  if (i < 0 || j < 0 || i >= NB || j >= NB) return false;
  return Math.abs(x - blockC(i)) < BLOCK / 2 && Math.abs(z - blockC(j)) < BLOCK / 2;
}
const groundH = (x, z) => onBlock(x, z) ? CURB : 0;
function nearBuildings(x, z) {
  const i = blockIndex(x), j = blockIndex(z);
  if (i < 0 || j < 0 || i >= NB || j >= NB) return [];
  return byBlock[i][j];
}

function planLots() {
  setSeed(1337);
  const lots = [];
  const inner = BLOCK - 2 * SW;
  for (let i = 0; i < NB; i++) for (let j = 0; j < NB; j++) {
    if (isPark(i, j)) continue;
    const cx = blockC(i), cz = blockC(j);
    const dc = Math.hypot(cx, cz) / (HALF * 1.2);
    const down = Math.max(0, 1 - dc);                     // 1 at downtown
    const r = rnd();
    const type = down > 0.55 ? (r < 0.6 ? 'tower' : 'pair') : (r < 0.2 ? 'tower' : r < 0.55 ? 'pair' : 'quad');
    const tall = (lo, hi) => lo + (hi - lo) * (0.35 * rnd() + 0.65 * down) + rnd() * 10;
    const tower = () => ['metal', 'concrete', 'stone', 'metal'][Math.floor(rnd() * 4)];
    const low = () => ['brick', 'brick', 'stone', 'concrete'][Math.floor(rnd() * 4)];
    if (type === 'tower') {
      const w = 30 + rnd() * 14, d = 30 + rnd() * 14;
      lots.push({ cx: cx + (rnd() - 0.5) * (inner - w) * 0.6, cz: cz + (rnd() - 0.5) * (inner - d) * 0.6, w, d, h: tall(45, 135), kind: tower() });
    } else if (type === 'pair') {
      const gap = 5;
      const horiz = rnd() < 0.5;
      for (const s of [-1, 1]) {
        const a = inner, b = (inner - gap) / 2;
        const w0 = horiz ? a - rnd() * 6 : b - rnd() * 3, d0 = horiz ? b - rnd() * 3 : a - rnd() * 6;
        const ox = horiz ? 0 : s * (b + gap) / 2, oz = horiz ? s * (b + gap) / 2 : 0;
        lots.push({ cx: cx + ox, cz: cz + oz, w: w0, d: d0, h: tall(18, 80), kind: rnd() < down ? tower() : low() });
      }
    } else {
      const gap = 5, b = (inner - gap) / 2;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        if (rnd() < 0.12) continue;                         // empty lot / plaza
        const w0 = b - rnd() * 5, d0 = b - rnd() * 5;
        lots.push({ cx: cx + sx * (b + gap) / 2 + sx * (b - w0) / 2, cz: cz + sz * (b + gap) / 2 + sz * (b - d0) / 2, w: w0, d: d0, h: tall(12, 42), kind: low() });
      }
    }
  }
  return lots;
}

function makeGround() {
  const g = new THREE.Mesh(new THREE.PlaneGeometry(2 * HALF + ROAD, 2 * HALF + ROAD), asphaltMat);
  g.rotation.x = -Math.PI / 2; g.receiveShadow = true; cityGroup.add(g);
  if (TX.grass) { const t2 = TX.grass.clone(); t2.needsUpdate = true; t2.repeat.set(400, 400);
    const outer = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), new THREE.MeshStandardMaterial({ map: t2, color: 0x8a9a80, roughness: 1 }));
    outer.rotation.x = -Math.PI / 2; outer.position.y = -0.03; outer.receiveShadow = true; scene.add(outer);
  }
  // sidewalks (instanced raised slabs) and park lawns
  const sw = new THREE.InstancedMesh(new THREE.BoxGeometry(BLOCK, CURB, BLOCK), sidewalkMat, NB * NB);
  const lawnGeo = new THREE.BoxGeometry(BLOCK - 2 * SW, 0.04, BLOCK - 2 * SW);
  if (TX.grass) { const t3 = TX.grass.clone(); t3.needsUpdate = true; t3.repeat.set(12, 12); grassMat.map = t3; }
  const lawn = new THREE.InstancedMesh(lawnGeo, grassMat, parks.size);
  const m = new THREE.Matrix4(); let k = 0, pk = 0;
  for (let i = 0; i < NB; i++) for (let j = 0; j < NB; j++) {
    m.makeTranslation(blockC(i), CURB / 2, blockC(j)); sw.setMatrixAt(k++, m);
    if (isPark(i, j)) { m.makeTranslation(blockC(i), CURB + 0.02, blockC(j)); lawn.setMatrixAt(pk++, m); }
  }
  sw.receiveShadow = true; lawn.receiveShadow = true;
  cityGroup.add(sw, lawn);

  // road markings: double yellow centre lines, crosswalks, stop lines
  const ys = [], ws = [];
  const quad = (arr, x0, x1, z0, z1) => { const y = 0.012; arr.push(new THREE.PlaneGeometry(x1 - x0, z1 - z0).rotateX(-Math.PI / 2).translate((x0 + x1) / 2, y, (z0 + z1) / 2)); };
  for (let k2 = 0; k2 <= NB; k2++) for (let s = 0; s < NB; s++) {
    const c = roadC(k2), a = roadC(s) + ROAD / 2, b = roadC(s + 1) - ROAD / 2;
    for (const o of [-0.18, 0.18]) { quad(ys, a + 3.5, b - 3.5, c + o - 0.06, c + o + 0.06); quad(ys, c + o - 0.06, c + o + 0.06, a + 3.5, b - 3.5); }
    for (const [e, sg] of [[a, 1], [b, -1]]) {
      for (let t = -ROAD / 2 + 0.8; t < ROAD / 2 - 0.5; t += 1.1) {
        quad(ws, Math.min(e + sg * 0.4, e + sg * 3.0), Math.max(e + sg * 0.4, e + sg * 3.0), c + t, c + t + 0.55);
        quad(ws, c + t, c + t + 0.55, Math.min(e + sg * 0.4, e + sg * 3.0), Math.max(e + sg * 0.4, e + sg * 3.0));
      }
      // stop line on the approaching lane (right-hand traffic)
      quad(ws, Math.min(e + sg * 3.3, e + sg * 3.7), Math.max(e + sg * 3.3, e + sg * 3.7), sg > 0 ? c - ROAD / 2 + 0.3 : c + 0.3, sg > 0 ? c - 0.3 : c + ROAD / 2 - 0.3);
      quad(ws, sg > 0 ? c + 0.3 : c - ROAD / 2 + 0.3, sg > 0 ? c + ROAD / 2 - 0.3 : c - 0.3, Math.min(e + sg * 3.3, e + sg * 3.7), Math.max(e + sg * 3.3, e + sg * 3.7));
    }
  }
  const my = new THREE.Mesh(mergeGeometries(ys), markYellow), mw = new THREE.Mesh(mergeGeometries(ws), markWhite);
  my.receiveShadow = mw.receiveShadow = true;
  cityGroup.add(my, mw);
}

// ---------- street lights (instanced) + light pools
const streetLamps = [];   // world positions of lamp heads
let lampHeadMat, poolMesh;
function makeStreetLights() {
  const poles = [], arms = [], heads = [];
  const pts = [];
  for (let i = 0; i < NB; i++) for (let j = 0; j < NB; j++) {
    const cx = blockC(i), cz = blockC(j), e = BLOCK / 2 - 0.7;
    for (const t of [-24, 0, 24]) {
      pts.push([cx + t, cz + e, 0, 1], [cx + t, cz - e, 0, -1], [cx + e, cz + t, 1, 0], [cx - e, cz + t, -1, 0]);
    }
  }
  const poleGeo = new THREE.CylinderGeometry(0.09, 0.13, 7.5, 8).translate(0, 3.75, 0);
  const armGeo = new THREE.BoxGeometry(0.1, 0.1, 2.2).translate(0, 7.4, 1.0);
  const headGeo = new THREE.BoxGeometry(0.45, 0.14, 0.8).translate(0, 7.3, 2.0);
  const metal = new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.5, metalness: 0.6 });
  lampHeadMat = new THREE.MeshStandardMaterial({ color: 0x222222, emissive: 0xffc27a, emissiveIntensity: 2.2 });
  const n = pts.length;
  const pole = new THREE.InstancedMesh(poleGeo, metal, n), arm = new THREE.InstancedMesh(armGeo, metal, n), head = new THREE.InstancedMesh(headGeo, lampHeadMat, n);
  const poolTex = radialTex('rgba(255,255,255,1)', 128);
  poolMesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
    new THREE.MeshBasicMaterial({ map: poolTex, color: new THREE.Color(1.0, 0.62, 0.32).multiplyScalar(0.55), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 }), n);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(1, 1, 1), up = new THREE.Vector3(0, 1, 0);
  pts.forEach(([x, z, dx, dz], k) => {
    const ang = Math.atan2(dx, dz);
    q.setFromAxisAngle(up, ang);
    m.compose(new THREE.Vector3(x, CURB, z), q, sc);
    pole.setMatrixAt(k, m); arm.setMatrixAt(k, m); head.setMatrixAt(k, m);
    const hx = x + dx * 2.0, hz = z + dz * 2.0;
    streetLamps.push(new THREE.Vector3(hx, 7.1, hz));
    m.compose(new THREE.Vector3(hx, 0.16, hz), q, new THREE.Vector3(15, 1, 15));
    poolMesh.setMatrixAt(k, m);
  });
  pole.castShadow = true;
  cityGroup.add(pole, arm, head, poolMesh);
}

function makeTrees() {
  const trunks = [], crowns = [];
  for (const key of parks) {
    const [i, j] = key.split(',').map(Number);
    for (let k = 0; k < 26; k++) {
      const x = blockC(i) + R(-28, 28), z = blockC(j) + R(-28, 28);
      const s = R(0.8, 1.4);
      trunks.push([x, z, s]); crowns.push([x, z, s]);
      parkTrees.push({ x, z });
    }
  }
  const tg = new THREE.CylinderGeometry(0.18, 0.28, 3, 6).translate(0, 1.5, 0);
  const cg = new THREE.IcosahedronGeometry(2.2, 1).translate(0, 4.4, 0);
  const tm = new THREE.InstancedMesh(tg, new THREE.MeshStandardMaterial({ color: 0x4a3626, roughness: 1 }), trunks.length);
  const cm = new THREE.InstancedMesh(cg, new THREE.MeshStandardMaterial({ color: 0x2f5a2a, roughness: 0.9, flatShading: true }), crowns.length);
  const m = new THREE.Matrix4();
  trunks.forEach(([x, z, s], k) => {
    m.makeScale(s, s, s).setPosition(x, CURB, z); tm.setMatrixAt(k, m);
    const c = new THREE.Color().setHSL(0.27 + R(-0.04, 0.04), 0.45, R(0.2, 0.3)); cm.setColorAt(k, c);
    m.makeScale(s, s * R(0.9, 1.2), s).setPosition(x, CURB, z); cm.setMatrixAt(k, m);
  });
  tm.castShadow = cm.castShadow = true;
  cityGroup.add(tm, cm);
}
const parkTrees = [];

function makeBillboard(b, tex) {
  if (!tex) return;
  const W = Math.min(14, (b.x1 - b.x0) * 0.7), H = W * 0.55;
  const mat = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: 0.6, roughness: 0.6 });
  const g = new THREE.Group();
  const board = new THREE.Mesh(new THREE.PlaneGeometry(W, H), mat);
  board.position.y = 2.2 + H / 2;
  const back = new THREE.Mesh(new THREE.BoxGeometry(W + 0.4, H + 0.4, 0.2), new THREE.MeshStandardMaterial({ color: 0x222428, metalness: 0.5, roughness: 0.6 }));
  back.position.set(0, 2.2 + H / 2, -0.15);
  const legGeo = new THREE.BoxGeometry(0.25, 2.4, 0.25);
  for (const lx of [-W / 3, W / 3]) { const l = new THREE.Mesh(legGeo, back.material); l.position.set(lx, 1.2, -0.15); g.add(l); }
  g.add(board, back);
  // face toward the nearest road (out of the block)
  const i = blockIndex((b.x0 + b.x1) / 2), j = blockIndex((b.z0 + b.z1) / 2);
  const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2, dx = cx - blockC(i), dz = cz - blockC(j);
  let ang, ox = 0, oz = 0;
  if (Math.abs(dx) > Math.abs(dz)) { ang = dx > 0 ? Math.PI / 2 : -Math.PI / 2; ox = Math.sign(dx) * ((b.x1 - b.x0) / 2 - 1.5); }
  else { ang = dz > 0 ? 0 : Math.PI; oz = Math.sign(dz) * ((b.z1 - b.z0) / 2 - 1.5); }
  g.rotation.y = ang; g.position.set(cx + ox, b.h + CURB + 0.6, cz + oz);
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  billboards.push(mat);
  cityGroup.add(g);
}
const billboards = [];

// ---------- storefront signs (lit boxes over the shop windows) and striped awnings
const signParts = [], awningParts = [];
const AWNING_COLORS = [[0.75, 0.12, 0.1], [0.1, 0.35, 0.2], [0.12, 0.25, 0.6], [0.8, 0.55, 0.1], [0.25, 0.25, 0.27], [0.6, 0.15, 0.45]];
function placeSigns(list, L) {
  // local building units -> world: rotate a front-facing (+z) part onto the facade it belongs to
  const toWorld = (geo, sg, uc, vc) => {
    const rot = sg.axis === 2 ? (sg.s > 0 ? 0 : Math.PI) : (sg.s > 0 ? Math.PI / 2 : -Math.PI / 2);
    const lx = sg.axis === 2 ? uc : sg.fixed, lz = sg.axis === 2 ? sg.fixed : uc;
    return geo.rotateY(rot).translate(L.cx + lx * S, CURB + vc * S, L.cz + lz * S);
  };
  for (const sg of list) {
    if (!TX.signs.length) break;
    const hL = sg.v1 - sg.v0, span = sg.u1 - sg.u0;
    const len = Math.min(span, hL * 4.2);                 // keep the 4:1 artwork from stretching
    const uc = (sg.u0 + sg.u1) / 2 + (span - len) * (rnd() - 0.5) * 0.6;
    const box = new THREE.BoxGeometry(len * S, hL * S, 0.14);
    signParts.push({ k: Math.floor(rnd() * TX.signs.length), geo: toWorld(box, sg, uc, (sg.v0 + sg.v1) / 2) });
    if (rnd() < 0.45) {
      // awning just under the sign band: slopes out over the sidewalk
      const aw = span * S, top = sg.v0 - 0.02, drop = 0.55, out = 1.3;
      const g = new THREE.BufferGeometry();
      const y0 = 0, y1 = -drop;
      g.setAttribute('position', new THREE.Float32BufferAttribute([-aw / 2, y0, 0, aw / 2, y0, 0, aw / 2, y1, out, -aw / 2, y0, 0, aw / 2, y1, out, -aw / 2, y1, out], 3));
      const n = aw / 1.2;
      g.setAttribute('uv', new THREE.Float32BufferAttribute([0, 1, n, 1, n, 0, 0, 1, n, 0, 0, 0], 2));
      const c = AWNING_COLORS[Math.floor(rnd() * AWNING_COLORS.length)];
      g.setAttribute('color', new THREE.Float32BufferAttribute(Array(6).fill(c).flat(), 3));
      g.computeVertexNormals();
      awningParts.push(toWorld(g, sg, (sg.u0 + sg.u1) / 2, top));
    }
  }
}
function finishSigns() {
  TX.signs.forEach((t, k) => {
    const geos = signParts.filter(p => p.k === k).map(p => p.geo);
    if (!geos.length) return;
    const mat = new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 0.75, roughness: 0.5 });
    billboards.push(mat);
    const m = new THREE.Mesh(mergeGeometries(geos), mat); m.castShadow = true; cityGroup.add(m);
  });
  if (awningParts.length) {
    const c = document.createElement('canvas'); c.width = 64; c.height = 8;
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 64, 8); g.fillStyle = '#9a9a9a'; g.fillRect(32, 0, 32, 8);
    const t = new THREE.CanvasTexture(c); t.wrapS = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.Mesh(mergeGeometries(awningParts), new THREE.MeshStandardMaterial({ map: t, vertexColors: true, side: THREE.DoubleSide, roughness: 0.85 }));
    m.castShadow = true; m.receiveShadow = true; cityGroup.add(m);
  }
}

async function buildCity() {
  for (let i = 0; i < NB; i++) { byBlock[i] = []; for (let j = 0; j < NB; j++) byBlock[i][j] = []; }
  const lots = planLots();
  const t0 = performance.now(); let tris = 0;
  for (let k = 0; k < lots.length; k++) {
    const L = lots[k];
    const kinds = facadeTypes[L.kind];
    setSeed(9001 + k * 7919);
    const ft = kinds[Math.floor(rnd() * kinds.length)];
    const h = Math.max(10, L.h);
    const b = buildBuilding({ w: L.w / S, d: L.d / S, h: h / S, facadeAvg: ft.avg, occupancy: 0.35 + rnd() * 0.5 });
    const mesh = new THREE.Mesh(b.geo, [ft.mat, interiorMat, roofMat]);
    mesh.position.set(L.cx, CURB, L.cz); mesh.scale.setScalar(S);
    mesh.castShadow = true; mesh.receiveShadow = true;
    cityGroup.add(mesh);
    let glass = null, fix = null;
    if (b.glassGeo) { glass = new THREE.Mesh(b.glassGeo, null); glass.position.copy(mesh.position); glass.scale.copy(mesh.scale); glass.castShadow = false; cityGroup.add(glass); glassMeshes.push(glass); }
    if (b.fixGeo) { fix = new THREE.Mesh(b.fixGeo, fixtureMat); fix.position.copy(mesh.position); fix.scale.copy(mesh.scale); cityGroup.add(fix); }
    if (b.signs.length) placeSigns(b.signs, L);
    const rec = { x0: L.cx - L.w / 2, x1: L.cx + L.w / 2, z0: L.cz - L.d / 2, z1: L.cz + L.d / 2, h: h + CURB, mesh, glass, fix };
    buildings.push(rec);
    byBlock[blockIndex(L.cx)][blockIndex(L.cz)].push(rec);
    tris += b.geo.attributes.position.count / 3;
    progress(0.08 + 0.6 * (k + 1) / lots.length, `building city… ${k + 1}/${lots.length}`);
    await maybeYield();
  }
  window.__cityStats = `${buildings.length} buildings, ${(tris / 1e6).toFixed(2)}M tris, ${(performance.now() - t0).toFixed(0)} ms, fields ${bakeStats.keys} keys / ${bakeStats.ms.toFixed(0)} ms`;
  finishSigns();
  console.log(`[city] ${buildings.length} buildings, ${(tris / 1e6).toFixed(2)}M tris, ${(performance.now() - t0).toFixed(0)} ms; interior fields: ${bakeStats.keys} keys in ${bakeStats.ms.toFixed(0)} ms`);
  // billboards on a few mid-rise roofs
  const ads = ['ad1', 'ad2', 'ad3'].map(a => TX[a]).filter(Boolean);
  if (ads.length) {
    const cands = buildings.filter(b => b.h < 60 && (b.x1 - b.x0) > 18).sort(() => Math.random() - 0.5).slice(0, 9);
    cands.forEach((b, k) => makeBillboard(b, ads[k % ads.length]));
  }
}

// ============================================================ reflection probes
const pmrem = new THREE.PMREMGenerator(renderer);
pmrem.compileCubemapShader();
function bakeProbe(x, y, z, size = 128) {
  const rt = new THREE.WebGLCubeRenderTarget(size, { type: THREE.HalfFloatType });
  const cam = new THREE.CubeCamera(1, 1600, rt);
  cam.position.set(x, y, z);
  cam.update(renderer, scene);
  const env = pmrem.fromCubemap(rt.texture).texture;
  rt.dispose();
  return env;
}
const probes = [];          // {pos, env, mat}
let skyEnv = null;
const carGlassMat = new THREE.MeshStandardMaterial({ color: 0x9aa6b0, metalness: 1, roughness: 0.06, transparent: true, depthWrite: false, side: THREE.DoubleSide });
carGlassMat.onBeforeCompile = smokedFresnel;
const carPaintMats = new Map();
function setupProbes() {
  for (let i = 0; i <= NB; i++) for (let j = 0; j <= NB; j++) {
    const mat = new THREE.MeshStandardMaterial({ color: 0xb4c0cb, metalness: 1.0, roughness: 0.05, transparent: true, opacity: 1, depthWrite: false, envMapIntensity: 1.05 });
    mat.onBeforeCompile = glassFresnel;
    probes.push({ pos: new THREE.Vector3(roadC(i), 16, roadC(j)), env: null, mat });
  }
  for (const b of buildings) {
    if (!b.glass) continue;
    const cx = (b.x0 + b.x1) / 2, cz = (b.z0 + b.z1) / 2;
    let best = null, bd = Infinity;
    for (const p of probes) { const d = (p.pos.x - cx) ** 2 + (p.pos.z - cz) ** 2; if (d < bd) { bd = d; best = p; } }
    b.glass.material = best.mat;
  }
}
async function bakeAllProbes(onProg) {
  const t0 = performance.now();
  // sky-only probe for moving objects (cars): city and dynamic stuff hidden
  cityGroup.visible = false; dynGroup.visible = false;
  const newSky = bakeProbe(0, 3, 0, 64);
  cityGroup.visible = true;
  for (const g of glassMeshes) g.visible = false;
  for (let k = 0; k < probes.length; k++) {
    const p = probes[k];
    const env = bakeProbe(p.pos.x, p.pos.y, p.pos.z, 128);
    if (p.env) p.env.dispose();
    p.env = env; p.mat.envMap = env; p.mat.needsUpdate = true;
    onProg && onProg((k + 1) / probes.length);
    await maybeYield();
  }
  for (const g of glassMeshes) g.visible = true;
  dynGroup.visible = true;
  if (skyEnv) skyEnv.dispose();
  skyEnv = newSky;
  carGlassMat.envMap = skyEnv; carGlassMat.needsUpdate = true;
  for (const m of carPaintMats.values()) { m.envMap = skyEnv; m.needsUpdate = true; }
  window.__probeStats = `${probes.length} probes in ${(performance.now() - t0).toFixed(0)} ms`;
  console.log(`[probes] ${probes.length} probes baked in ${(performance.now() - t0).toFixed(0)} ms`);
}

// ============================================================ time of day
function applyTime() {
  const n = state.night;
  if (n) {
    skyMat.uniforms.top.value.setRGB(0.004, 0.007, 0.02); skyMat.uniforms.horizon.value.setRGB(0.03, 0.035, 0.06);
    skyMat.uniforms.ground.value.setRGB(0.01, 0.012, 0.02); skyMat.uniforms.night.value = 1;
    skyMat.uniforms.sunDir.value.set(-0.3, 0.55, -0.6).normalize();
    hemi.color.setRGB(0.25, 0.3, 0.5); hemi.groundColor.setRGB(0.06, 0.05, 0.05); hemi.intensity = 0.35;
    sun.color.setRGB(0.55, 0.65, 1.0); sun.intensity = 0.18; sun.castShadow = false;
    scene.fog = new THREE.FogExp2(0x070a14, 0.0026);
    renderer.toneMappingExposure = 1.2; bloom.strength = 0.75;
    lampHeadMat.emissiveIntensity = 2.4; poolMesh.visible = true;
    billboards.forEach(m => m.emissiveIntensity = 0.75);
  } else {
    skyMat.uniforms.top.value.setRGB(0.12, 0.3, 0.75); skyMat.uniforms.horizon.value.setRGB(0.62, 0.72, 0.85);
    skyMat.uniforms.ground.value.setRGB(0.3, 0.3, 0.3); skyMat.uniforms.night.value = 0;
    skyMat.uniforms.sunDir.value.set(0.45, 0.62, 0.35).normalize();
    hemi.color.setRGB(0.65, 0.78, 1.0); hemi.groundColor.setRGB(0.35, 0.3, 0.25); hemi.intensity = 0.9;
    sun.color.setRGB(1.0, 0.93, 0.82); sun.intensity = 2.6; sun.castShadow = true;
    scene.fog = new THREE.FogExp2(0xa8bccf, 0.0016);
    renderer.toneMappingExposure = 0.85; bloom.strength = 0.22;
    lampHeadMat.emissiveIntensity = 0.0; poolMesh.visible = false;
    billboards.forEach(m => m.emissiveIntensity = 0.12);
  }
  for (const b of buildings) { applyTimeColors(b.mesh.geometry, n); applyTimeColors(b.fix && b.fix.geometry, n); }
  for (const c of cars) setCarLights(c);
}
async function toggleTime() {
  state.night = !state.night;
  applyTime();
  $('overlay').style.display = 'flex';
  await afterPaint();
  await bakeAllProbes(f => { $('overlay').textContent = `Re-baking reflections… ${(f * 100) | 0}%`; });
  $('overlay').style.display = 'none';
}

// ============================================================ shared geometry for people / cars
const G = {
  torso: new THREE.BoxGeometry(0.46, 0.6, 0.26),
  head: new THREE.SphereGeometry(0.135, 12, 10),
  hair: new THREE.SphereGeometry(0.142, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.55),
  leg: new THREE.BoxGeometry(0.17, 0.86, 0.2).translate(0, -0.43, 0),
  arm: new THREE.BoxGeometry(0.12, 0.62, 0.14).translate(0, -0.3, 0),
  gun: new THREE.BoxGeometry(0.06, 0.12, 0.26).translate(0, -0.62, 0.1)
};
const matCache = new Map();
function stdMat(hex, rough = 0.8, metal = 0) {
  const k = hex + '|' + rough + '|' + metal;
  if (!matCache.has(k)) matCache.set(k, new THREE.MeshStandardMaterial({ color: hex, roughness: rough, metalness: metal }));
  return matCache.get(k);
}
const SHIRTS = [0xb03030, 0x2a5aa0, 0xe0e0e0, 0x2f2f2f, 0x4f8f4f, 0xc08a30, 0x7a4aa0, 0x30a0a0, 0xd06080];
const PANTS = [0x222a3a, 0x3a3a3a, 0x5a4a3a, 0x1a1a1a, 0x2a3f5f];
const SKINS = [0xf1c8a6, 0xd9a47e, 0xa9714d, 0x6b4430, 0xe8b897];
const HAIRS = [0x1a1410, 0x3b2a1a, 0x6b4a2a, 0xc8a060, 0x111111, 0x888888];
const pickA = a => a[Math.floor(Math.random() * a.length)];

function makeHuman(shirt = pickA(SHIRTS), pants = pickA(PANTS), skin = pickA(SKINS), hair = pickA(HAIRS)) {
  const g = new THREE.Group();
  const body = new THREE.Group(); g.add(body);
  const torso = new THREE.Mesh(G.torso, stdMat(shirt)); torso.position.y = 1.16;
  const head = new THREE.Mesh(G.head, stdMat(skin, 0.6)); head.position.y = 1.62;
  const hr = new THREE.Mesh(G.hair, stdMat(hair, 0.9)); hr.position.y = 1.635;
  const mkLimb = (geo, mat, x, y) => { const p = new THREE.Group(); p.position.set(x, y, 0); p.add(new THREE.Mesh(geo, mat)); body.add(p); return p; };
  const legL = mkLimb(G.leg, stdMat(pants), -0.12, 0.86), legR = mkLimb(G.leg, stdMat(pants), 0.12, 0.86);
  const armL = mkLimb(G.arm, stdMat(shirt), -0.31, 1.42), armR = mkLimb(G.arm, stdMat(shirt), 0.31, 1.42);
  body.add(torso, head, hr);
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return { g, body, legL, legR, armL, armR, phase: Math.random() * 10 };
}
function animHuman(h, speed, dt) {
  h.phase += dt * speed * 2.6;
  const a = Math.sin(h.phase) * Math.min(1, speed / 3) * 0.7;
  h.legL.rotation.x = a; h.legR.rotation.x = -a;
  h.armL.rotation.x = -a * 0.8; if (!h.aiming) h.armR.rotation.x = a * 0.8;
}

// cars
const CAR_COLORS = [0xb01818, 0x1d3f8a, 0xe8e8e8, 0x151515, 0x7a7a80, 0xc9a227, 0x1f6b3a, 0x8a1f5a, 0xd96a1a, 0x2a8ab0];
const CAR_NAMES = ['VORTEX GT', 'METRO', 'CRUISER', 'BLAZE', 'NIGHTHAWK', 'VAPOR', 'SULTAN-X', 'COUPE 88', 'RAPTOR', 'ALPINE'];
const carGeo = (() => {
  const body = mergeGeometries([
    new THREE.BoxGeometry(1.9, 0.55, 4.5).translate(0, 0.62, 0),
    new THREE.BoxGeometry(1.84, 0.18, 1.3).translate(0, 0.98, 1.55),   // hood bump
    new THREE.BoxGeometry(1.84, 0.16, 0.9).translate(0, 0.97, -1.75)   // trunk
  ]);
  const cabin = new THREE.BoxGeometry(1.72, 0.56, 2.15).translate(0, 1.18, -0.2);
  const g = [];
  const pane = (w, h) => new THREE.PlaneGeometry(w, h);
  g.push(pane(1.9, 0.42).rotateY(Math.PI / 2).translate(0.872, 1.2, -0.2));
  g.push(pane(1.9, 0.42).rotateY(-Math.PI / 2).translate(-0.872, 1.2, -0.2));
  g.push(pane(1.55, 0.44).translate(0, 1.2, 0.888));
  g.push(pane(1.55, 0.44).rotateY(Math.PI).translate(0, 1.2, -1.288));
  const glass = mergeGeometries(g);
  const wheel = new THREE.CylinderGeometry(0.37, 0.37, 0.28, 14).rotateZ(Math.PI / 2);
  const wheels = mergeGeometries([[0.86, 1.4], [-0.86, 1.4], [0.86, -1.4], [-0.86, -1.4]].map(([x, z]) => wheel.clone().translate(x, 0.37, z)));
  const heads = mergeGeometries([-0.62, 0.62].map(x => new THREE.BoxGeometry(0.42, 0.14, 0.06).translate(x, 0.74, 2.25)));
  const tails = mergeGeometries([-0.66, 0.66].map(x => new THREE.BoxGeometry(0.38, 0.12, 0.06).translate(x, 0.76, -2.25)));
  const bar = new THREE.BoxGeometry(0.55, 0.12, 0.28);
  const beam = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  const doors = new THREE.BoxGeometry(1.94, 0.4, 1.9).translate(0, 0.66, -0.1);
  return { body, cabin, glass, wheels, heads, tails, bar, beam, doors };
})();
// box truck: cab + cargo box carrying a brand livery on both sides and the rear doors
const truckGeo = (() => {
  const cab = mergeGeometries([
    new THREE.BoxGeometry(2.3, 1.2, 2.1).translate(0, 1.1, 2.65),
    new THREE.BoxGeometry(2.24, 1.0, 1.6).translate(0, 2.2, 2.45),
    new THREE.BoxGeometry(2.0, 0.3, 7.4).translate(0, 0.72, -0.1)       // chassis rail
  ]);
  const box = new THREE.BoxGeometry(2.45, 2.7, 5.4).translate(0, 2.25, -1.15);
  const glass = mergeGeometries([
    new THREE.PlaneGeometry(2.0, 0.78).translate(0, 2.25, 3.262),
    new THREE.PlaneGeometry(1.0, 0.65).rotateY(Math.PI / 2).translate(1.122, 2.25, 2.7),
    new THREE.PlaneGeometry(1.0, 0.65).rotateY(-Math.PI / 2).translate(-1.122, 2.25, 2.7)
  ]);
  const wheel = new THREE.CylinderGeometry(0.5, 0.5, 0.36, 16).rotateZ(Math.PI / 2);
  const wheels = mergeGeometries([[1.02, 2.7], [-1.02, 2.7], [1.02, -1.9], [-1.02, -1.9], [1.02, -3.0], [-1.02, -3.0]].map(([x, z]) => wheel.clone().translate(x, 0.5, z)));
  const heads = mergeGeometries([-0.85, 0.85].map(x => new THREE.BoxGeometry(0.4, 0.2, 0.06).translate(x, 1.0, 3.72)));
  const tails = mergeGeometries([-1.0, 1.0].map(x => new THREE.BoxGeometry(0.25, 0.3, 0.06).translate(x, 1.1, -3.87)));
  const livery = mergeGeometries([
    new THREE.PlaneGeometry(5.3, 2.55).rotateY(Math.PI / 2).translate(1.232, 2.25, -1.15),
    new THREE.PlaneGeometry(5.3, 2.55).rotateY(-Math.PI / 2).translate(-1.232, 2.25, -1.15),
    new THREE.PlaneGeometry(2.3, 2.55).rotateY(Math.PI).translate(0, 2.25, -3.857)
  ]);
  return { cab, box, glass, wheels, heads, tails, livery };
})();
const liveryMats = new Map();
function liveryMat(k) {
  if (!liveryMats.has(k)) liveryMats.set(k, new THREE.MeshStandardMaterial({ map: TX.trucks[k], roughness: 0.45, metalness: 0.1, polygonOffset: true, polygonOffsetFactor: -1 }));
  return liveryMats.get(k);
}
const cabinMat = new THREE.MeshStandardMaterial({ color: 0x0b0c0e, roughness: 0.5, metalness: 0.2 });
const tireMat = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9 });
// headlight light pool on the road: bright near the bumper, fading out ahead and to the sides
const beamTex = (() => {
  const w = 128, h = 256, c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(w / 2, h * 0.08, 0, w / 2, h * 0.08, h * 0.9);
  gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.3, 'rgba(255,255,255,0.45)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  // soften the near edge and the sides so no rectangle outline shows
  g.globalCompositeOperation = 'destination-in';
  const ge = g.createLinearGradient(0, 0, 0, h * 0.12); ge.addColorStop(0, 'rgba(0,0,0,0)'); ge.addColorStop(1, 'rgba(0,0,0,1)');
  g.fillStyle = ge; g.fillRect(0, 0, w, h);
  const gs = g.createLinearGradient(0, 0, w, 0); gs.addColorStop(0, 'rgba(0,0,0,0)'); gs.addColorStop(0.3, 'rgba(0,0,0,1)'); gs.addColorStop(0.7, 'rgba(0,0,0,1)'); gs.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gs; g.fillRect(0, 0, w, h);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
})();
const beamMat = new THREE.MeshBasicMaterial({ map: beamTex, color: new THREE.Color(1, 0.95, 0.8).multiplyScalar(0.35), transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
const sirenRed = new THREE.MeshBasicMaterial({ color: 0xff2020, toneMapped: false });
const sirenBlue = new THREE.MeshBasicMaterial({ color: 0x2050ff, toneMapped: false });
function paintMat(hex) {
  if (!carPaintMats.has(hex)) carPaintMats.set(hex, new THREE.MeshStandardMaterial({ color: hex, roughness: 0.28, metalness: 0.55, envMap: skyEnv, envMapIntensity: 1.0 }));
  return carPaintMats.get(hex);
}

const cars = [];
function makeCar(type = 'ai', color = pickA(CAR_COLORS), model = 'car') {
  if (model === 'truck' && TX.trucks && TX.trucks.length) return makeTruck(type);
  const police = type === 'police';
  const g = new THREE.Group();
  const body = new THREE.Mesh(carGeo.body, paintMat(police ? 0x101216 : color));
  const cabin = new THREE.Mesh(carGeo.cabin, cabinMat);
  const glass = new THREE.Mesh(carGeo.glass, carGlassMat); glass.castShadow = false;
  const wheels = new THREE.Mesh(carGeo.wheels, tireMat);
  const headMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, emissive: 0xfff4dd, emissiveIntensity: 0 });
  const tailMat = new THREE.MeshStandardMaterial({ color: 0x440000, emissive: 0xff1010, emissiveIntensity: 0 });
  const heads = new THREE.Mesh(carGeo.heads, headMat), tails = new THREE.Mesh(carGeo.tails, tailMat);
  const beam = new THREE.Mesh(carGeo.beam, beamMat); beam.scale.set(7, 1, 16); beam.position.set(0, 0.05, 10);
  g.add(body, cabin, glass, wheels, heads, tails, beam);
  let barR = null, barB = null;
  if (police) {
    const doors = new THREE.Mesh(carGeo.doors, paintMat(0xf2f2f2)); g.add(doors);
    barR = new THREE.Mesh(carGeo.bar, sirenRed); barR.position.set(-0.3, 1.52, -0.2);
    barB = new THREE.Mesh(carGeo.bar, sirenBlue); barB.position.set(0.3, 1.52, -0.2);
    g.add(barR, barB);
  }
  [body, cabin, wheels].forEach(m => { m.castShadow = true; m.receiveShadow = true; });
  dynGroup.add(g);
  const c = {
    g, type, police, headMat, tailMat, beam, barR, barB, body,
    pos: new THREE.Vector3(), heading: 0, vel: new THREE.Vector3(), speed: 0, steer: 0,
    health: 100, name: police ? 'POLICE CRUISER' : pickA(CAR_NAMES), driver: type !== 'parked',
    path: [], pathIdx: 0, node: null, dir: 0, wrecked: false, burnT: 0, stuck: 0, reverseT: 0, wp: null, hornT: 0,
    hw: 0.95, hl: 2.25, circ: [1.2, -1.2], cr: 1.05, truck: false
  };
  cars.push(c);
  setCarLights(c);
  return c;
}
function makeTruck(type) {
  const g = new THREE.Group();
  const k = Math.floor(Math.random() * TX.trucks.length);
  const body = new THREE.Mesh(truckGeo.cab, paintMat(pickA([0xf0f0f0, 0x2a2d33, 0xb01818, 0x1d3f8a, 0xe8e8e8])));
  const box = new THREE.Mesh(truckGeo.box, stdMat(0xe6e6e6, 0.6));
  const livery = new THREE.Mesh(truckGeo.livery, liveryMat(k));
  const glass = new THREE.Mesh(truckGeo.glass, carGlassMat); glass.castShadow = false;
  const wheels = new THREE.Mesh(truckGeo.wheels, tireMat);
  const headMat = new THREE.MeshStandardMaterial({ color: 0xdddddd, emissive: 0xfff4dd, emissiveIntensity: 0 });
  const tailMat = new THREE.MeshStandardMaterial({ color: 0x440000, emissive: 0xff1010, emissiveIntensity: 0 });
  const heads = new THREE.Mesh(truckGeo.heads, headMat), tails = new THREE.Mesh(truckGeo.tails, tailMat);
  const beam = new THREE.Mesh(carGeo.beam, beamMat); beam.scale.set(8, 1, 17); beam.position.set(0, 0.05, 11.5);
  g.add(body, box, livery, glass, wheels, heads, tails, beam);
  [body, box, wheels].forEach(m => { m.castShadow = true; m.receiveShadow = true; });
  dynGroup.add(g);
  const c = {
    g, type, police: false, headMat, tailMat, beam, barR: null, barB: null, body,
    pos: new THREE.Vector3(), heading: 0, vel: new THREE.Vector3(), speed: 0, steer: 0,
    health: 170, name: ['SWIFTSHIP', 'FRESHCO', 'BIG CLUCK', 'NEON RUSH', 'ACME MOVERS'][k] + ' TRUCK', driver: type !== 'parked',
    path: [], pathIdx: 0, node: null, dir: 0, wrecked: false, burnT: 0, stuck: 0, reverseT: 0, wp: null, hornT: 0,
    hw: 1.25, hl: 3.9, circ: [2.6, 0, -2.6], cr: 1.3, truck: true
  };
  cars.push(c);
  setCarLights(c);
  return c;
}
function setCarLights(c) {
  const on = state.night && !c.wrecked && (c.driver || c === player.car);
  c.headMat.emissiveIntensity = on ? 3 : 0;
  c.tailMat.emissiveIntensity = on ? 1.6 : 0;
  c.beam.visible = on;
}
function removeCar(c) {
  dynGroup.remove(c.g);
  c.headMat.dispose(); c.tailMat.dispose();
  cars.splice(cars.indexOf(c), 1);
}

// ============================================================ traffic AI (lane graph)
const nodePos = (i, j) => [roadC(i), roadC(j)];
function validDirs(i, j) { return [0, 1, 2, 3].filter(d => { const ni = i + DIRS[d][0], nj = j + DIRS[d][1]; return ni >= 0 && nj >= 0 && ni <= NB && nj <= NB; }); }
function entryPt(i, j, d) { const [cx, cz] = nodePos(i, j), r = rightOf(d); return [cx - DIRS[d][0] * ROAD / 2 + r[0] * LANE, cz - DIRS[d][1] * ROAD / 2 + r[1] * LANE]; }
function exitPt(i, j, d) { const [cx, cz] = nodePos(i, j), r = rightOf(d); return [cx + DIRS[d][0] * ROAD / 2 + r[0] * LANE, cz + DIRS[d][1] * ROAD / 2 + r[1] * LANE]; }
function planNext(c) {
  // c.node = [i,j] intersection we are entering, c.dir = travel direction
  const [i, j] = c.node, d = c.dir;
  let opts = validDirs(i, j).filter(x => x !== (d + 2) % 4);
  if (!opts.length) opts = [(d + 2) % 4];
  // prefer straight a bit
  let nd = opts.includes(d) && Math.random() < 0.5 ? d : pickA(opts);
  const e = entryPt(i, j, d), x = exitPt(i, j, nd);
  const pts = [];
  if (nd === (d + 2) % 4) { // u-turn at map edge
    const [cx, cz] = nodePos(i, j);
    for (let t = 0; t <= 1.0001; t += 0.125) { const a = Math.PI * t; const r = rightOf(d); pts.push([cx + DIRS[d][0] * Math.sin(a) * 4 + r[0] * LANE * Math.cos(a) - DIRS[d][0] * 2, cz + DIRS[d][1] * Math.sin(a) * 4 + r[1] * LANE * Math.cos(a) - DIRS[d][1] * 2]); }
  } else {
    const k = nd === d ? ROAD / 3 : 5;
    const c1 = [e[0] + DIRS[d][0] * k, e[1] + DIRS[d][1] * k], c2 = [x[0] - DIRS[nd][0] * k, x[1] - DIRS[nd][1] * k];
    for (let t = 0; t <= 1.0001; t += 0.125) {
      const u = 1 - t;
      pts.push([u * u * u * e[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t * t * t * x[0], u * u * u * e[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t * t * t * x[1]]);
    }
  }
  const ni = i + DIRS[nd][0], nj = j + DIRS[nd][1];
  pts.push(entryPt(ni, nj, nd));
  c.path = pts; c.pathIdx = 0; c.node = [ni, nj]; c.dir = nd;
}
function spawnTrafficCar(i, j, d, type = 'ai') {
  const c = makeCar(type, undefined, type === 'ai' && Math.random() < 0.22 ? 'truck' : 'car');
  // start mid-road between node (i,j) and next, travelling d
  const ni = i + DIRS[d][0], nj = j + DIRS[d][1];
  const a = exitPt(i, j, d), b = entryPt(ni, nj, d);
  const t = R(0.1, 0.8);
  c.pos.set(a[0] + (b[0] - a[0]) * t, 0, a[1] + (b[1] - a[1]) * t);
  c.heading = Math.atan2(DIRS[d][0], DIRS[d][1]);
  c.node = [ni, nj]; c.dir = d; c.path = [b]; c.pathIdx = 0; c.speed = 8;
  c.cruise = c.truck ? R(8, 11) : R(9, 14);
  return c;
}
function randomEdge(minD = 0, maxD = 1e9, from = null) {
  for (let tries = 0; tries < 60; tries++) {
    const i = Math.floor(Math.random() * (NB + 1)), j = Math.floor(Math.random() * (NB + 1));
    const ds = validDirs(i, j); const d = pickA(ds);
    if (from) { const [x, z] = nodePos(i, j); const dd = Math.hypot(x - from.x, z - from.z); if (dd < minD || dd > maxD) continue; }
    return [i, j, d];
  }
  return [0, 0, 0];
}
function aiDrive(c, dt) {
  const tgt = c.path[c.pathIdx];
  const dx = tgt[0] - c.pos.x, dz = tgt[1] - c.pos.z, dist = Math.hypot(dx, dz);
  // look ahead for obstacles
  const fx = Math.sin(c.heading), fz = Math.cos(c.heading);
  let limit = c.cruise;
  const check = (px, pz, rad, hl) => {
    const rx = px - c.pos.x, rz = pz - c.pos.z;
    const ahead = rx * fx + rz * fz, lat = Math.abs(rx * fz - rz * fx);
    if (ahead > 0 && ahead < 16 + c.hl && lat < rad) limit = Math.min(limit, Math.max(0, (ahead - 4.2 - c.hl - (hl || 0)) * 1.3));
  };
  for (const o of cars) {
    if (o === c) continue;
    // cross traffic only matters when it is right in front of us (avoids intersection gridlock)
    const same = Math.cos(o.heading - c.heading) > 0.4;
    const near = Math.abs(o.pos.x - c.pos.x) + Math.abs(o.pos.z - c.pos.z) < 9;
    if (same || near) check(o.pos.x, o.pos.z, 1.35 + o.hw + c.hw * 0.5, o.hl - 2.25);
  }
  if (!player.car) check(player.pos.x, player.pos.z, 1.8);
  for (const p of peds) if (p.state !== 'dead' && !onBlock(p.pos.x, p.pos.z)) check(p.pos.x, p.pos.z, 1.6);
  if (dist > 1e-3 && c.pathIdx < c.path.length) {
    const want = Math.atan2(dx, dz);
    const turn = Math.abs(wrapA(want - c.heading));
    if (turn > 0.35) limit = Math.min(limit, 7);
  }
  c.speed += clamp(limit - c.speed, -14 * dt, 5 * dt);
  let move = c.speed * dt;
  while (move > 0) {
    const t = c.path[c.pathIdx];
    const ex = t[0] - c.pos.x, ez = t[1] - c.pos.z, d = Math.hypot(ex, ez);
    if (d > 1e-4) c.heading += clamp(wrapA(Math.atan2(ex, ez) - c.heading), -3.5 * dt, 3.5 * dt);
    if (d <= move) { c.pos.x = t[0]; c.pos.z = t[1]; move -= d; c.pathIdx++; if (c.pathIdx >= c.path.length) planNext(c); }
    else { c.pos.x += ex / d * move; c.pos.z += ez / d * move; move = 0; }
  }
  c.vel.set(Math.sin(c.heading) * c.speed, 0, Math.cos(c.heading) * c.speed);
}

// ============================================================ car physics (player / police / loose cars)
function carPhysics(c, throttle, steerIn, handbrake, dt) {
  const fx = Math.sin(c.heading), fz = Math.cos(c.heading);
  const rx = -fz, rz = fx;
  let vF = c.vel.x * fx + c.vel.z * fz, vR = c.vel.x * rx + c.vel.z * rz;
  const maxF = c.truck ? 26 : c.police ? 34 : 40, acc = c.truck ? 9 : 17;
  if (throttle > 0) vF += (vF < -0.5 ? 30 : acc * (1 - Math.max(0, vF) / maxF)) * throttle * dt;
  else if (throttle < 0) vF += (vF > 0.5 ? -30 : -10 * (1 + Math.min(0, vF) / 12)) * -throttle * dt;
  vF *= Math.exp(-(throttle === 0 ? 0.35 : 0.08) * dt);
  if (handbrake) vF *= Math.exp(-1.6 * dt);
  vR *= Math.exp(-(handbrake ? 1.2 : 9) * dt);
  c.steer += (steerIn - c.steer) * Math.min(1, dt * 7);
  const sp = Math.abs(vF);
  const yaw = c.steer * clamp(vF / 5, -1, 1) * (2.1 - Math.min(1.25, sp / 28)) * (handbrake ? 1.35 : 1);
  c.heading = wrapA(c.heading + yaw * dt);
  const nfx = Math.sin(c.heading), nfz = Math.cos(c.heading);
  c.vel.set(nfx * vF + -nfz * vR, 0, nfz * vF + nfx * vR);
  c.pos.x += c.vel.x * dt; c.pos.z += c.vel.z * dt;
  c.speed = vF;
}
// two circles per car for collision
const carCircles = c => {
  const fx = Math.sin(c.heading), fz = Math.cos(c.heading);
  return c.circ.map(o => [c.pos.x + fx * o, c.pos.z + fz * o]);
};
function pushOutAABB(px, pz, r, b) {
  const qx = clamp(px, b.x0, b.x1), qz = clamp(pz, b.z0, b.z1);
  let dx = px - qx, dz = pz - qz, d = Math.hypot(dx, dz);
  if (d >= r) return null;
  if (d < 1e-6) { // centre inside: push along shortest axis
    const l = px - b.x0, rr = b.x1 - px, t = pz - b.z0, bb = b.z1 - pz, m = Math.min(l, rr, t, bb);
    if (m === l) return [-(l + r), 0]; if (m === rr) return [rr + r, 0]; if (m === t) return [0, -(t + r)]; return [0, bb + r];
  }
  return [dx / d * (r - d), dz / d * (r - d)];
}
function collideCarWorld(c) {
  let hit = 0;
  for (const [cx, cz] of carCircles(c)) {
    const list = nearBuildings(cx, cz);
    for (const b of list) {
      const p = pushOutAABB(cx, cz, c.cr, b); if (!p) continue;
      c.pos.x += p[0]; c.pos.z += p[1];
      const l = Math.hypot(p[0], p[1]), nx = p[0] / l, nz = p[1] / l;
      const vn = c.vel.x * nx + c.vel.z * nz;
      if (vn < 0) { c.vel.x -= 1.35 * vn * nx; c.vel.z -= 1.35 * vn * nz; hit = Math.max(hit, -vn); }
    }
    for (const t of parkTrees) {
      const dx = cx - t.x, dz = cz - t.z, d = Math.hypot(dx, dz);
      if (d < 1.4 && d > 1e-4) { c.pos.x += dx / d * (1.4 - d); c.pos.z += dz / d * (1.4 - d); const vn = (c.vel.x * dx + c.vel.z * dz) / d; if (vn < 0) { c.vel.x -= 1.3 * vn * dx / d; c.vel.z -= 1.3 * vn * dz / d; hit = Math.max(hit, -vn); } }
    }
  }
  const lim = EDGE;
  if (Math.abs(c.pos.x) > lim) { c.pos.x = Math.sign(c.pos.x) * lim; hit = Math.max(hit, Math.abs(c.vel.x)); c.vel.x *= -0.4; }
  if (Math.abs(c.pos.z) > lim) { c.pos.z = Math.sign(c.pos.z) * lim; hit = Math.max(hit, Math.abs(c.vel.z)); c.vel.z *= -0.4; }
  if (hit > 4) { damageCar(c, (hit - 4) * 2.2); sfx.crash(Math.min(1, hit / 20)); }
  // sync scalar speed with the bounced velocity
  c.speed = c.vel.x * Math.sin(c.heading) + c.vel.z * Math.cos(c.heading);
}
function collideCars() {
  for (let a = 0; a < cars.length; a++) for (let b = a + 1; b < cars.length; b++) {
    const A = cars[a], B = cars[b];
    const reach = A.hl + B.hl + 1;
    if (Math.abs(A.pos.x - B.pos.x) > reach || Math.abs(A.pos.z - B.pos.z) > reach) continue;
    const rs = A.cr + B.cr;
    for (const ca of carCircles(A)) for (const cb of carCircles(B)) {
      const dx = cb[0] - ca[0], dz = cb[1] - ca[1], d = Math.hypot(dx, dz);
      if (d >= rs || d < 1e-5) continue;
      const nx = dx / d, nz = dz / d, pen = rs - d;
      const rv = (B.vel.x - A.vel.x) * nx + (B.vel.z - A.vel.z) * nz;
      const impact = Math.max(0, -rv);
      // big hits knock AI cars out of their lane: they become loose physics cars
      if (impact > 5) { for (const C of [A, B]) if (C.type === 'ai') { C.type = 'loose'; C.loose = 6; } }
      const aK = A.type === 'ai', bK = B.type === 'ai';
      const wa = aK ? 0 : bK ? 1 : 0.5, wb = bK ? 0 : aK ? 1 : 0.5;
      A.pos.x -= nx * pen * wa; A.pos.z -= nz * pen * wa;
      B.pos.x += nx * pen * wb; B.pos.z += nz * pen * wb;
      if (rv < 0) {
        const j = -1.3 * rv;
        if (!aK) { A.vel.x -= nx * j * (bK ? 1 : 0.5); A.vel.z -= nz * j * (bK ? 1 : 0.5); }
        if (!bK) { B.vel.x += nx * j * (aK ? 1 : 0.5); B.vel.z += nz * j * (aK ? 1 : 0.5); }
      }
      if (impact > 3) {
        damageCar(A, impact * 1.6); damageCar(B, impact * 1.6); sfx.crash(Math.min(1, impact / 18));
        if (A === player.car || B === player.car) { const o = A === player.car ? B : A; if (o.police) addHeat(3); }
      }
    }
  }
}
function damageCar(c, amt) {
  if (c.wrecked) return;
  c.health -= amt;
  if (c.health <= 0) explodeCar(c);
}
function explodeCar(c) {
  c.wrecked = true; c.health = 0; c.driver = false;
  c.body.material = paintMat(0x1a1a1a);
  setCarLights(c);
  fx.explosion(c.pos.clone().setY(1.2));
  sfx.boom();
  if (c.type === 'ai') c.type = 'loose';
  c.vel.y = 0;
  if (c.lastHitByPlayer) addHeat(1.5);
  for (const p of peds) if (p.state !== 'dead' && p.pos.distanceTo(c.pos) < 7) knockPed(p, p.pos.clone().sub(c.pos).setY(0).normalize().multiplyScalar(10).setY(7));
  if (player.car === c) { killPlayer(); }
  else if (!player.car && player.pos.distanceTo(c.pos) < 6) hurtPlayer(70);
  for (const o of cars) if (o !== c && !o.wrecked && o.pos.distanceTo(c.pos) < 6) damageCar(o, 30);
  if (c.police) addHeat(4);
}

// ============================================================ pedestrians
const peds = [];
function rectPos(cx, cz, hs, s) {
  const L = hs * 2; s = ((s % (4 * L)) + 4 * L) % (4 * L);
  if (s < L) return [cx - hs + s, cz - hs, 0];
  if (s < 2 * L) return [cx + hs, cz - hs + (s - L), 1];
  if (s < 3 * L) return [cx + hs - (s - 2 * L), cz + hs, 2];
  return [cx - hs, cz + hs - (s - 3 * L), 3];
}
function spawnPed(i, j, s) {
  const h = makeHuman();
  dynGroup.add(h.g);
  const p = { h, i, j, hs: BLOCK / 2 - R(1.6, 3.4), s, dir: Math.random() < 0.5 ? 1 : -1, speed: R(1.1, 1.6), state: 'walk',
    pos: new THREE.Vector3(), vel: new THREE.Vector3(), heading: 0, timer: 0, pause: 0, spin: new THREE.Vector3() };
  const [x, z] = rectPos(blockC(i), blockC(j), p.hs, s); p.pos.set(x, CURB, z);
  peds.push(p);
  return p;
}
function spawnPedNear(from, minD, maxD) {
  for (let t = 0; t < 30; t++) {
    const i = Math.floor(Math.random() * NB), j = Math.floor(Math.random() * NB);
    const d = Math.hypot(blockC(i) - from.x, blockC(j) - from.z);
    if (d >= minD && d <= maxD) return spawnPed(i, j, Math.random() * 1000);
  }
  return spawnPed(Math.floor(Math.random() * NB), Math.floor(Math.random() * NB), Math.random() * 1000);
}
function knockPed(p, v) {
  if (p.state === 'dead' || p.state === 'fly') return;
  p.state = 'fly'; p.vel.copy(v); p.timer = 0;
  p.spin.set(R(-6, 6), R(-6, 6), R(-6, 6));
}
function scarePeds(at, radius) {
  for (const p of peds) if (p.state === 'walk' || p.state === 'flee') {
    if (p.pos.distanceTo(at) < radius) { p.state = 'flee'; p.timer = R(5, 9); p.fleeFrom = at.clone(); }
  }
}
function updatePed(p, dt) {
  const h = p.h;
  if (p.state === 'walk') {
    if (p.pause > 0) { p.pause -= dt; animHuman(h, 0, dt); }
    else {
      p.s += p.dir * p.speed * dt;
      const [x, z] = rectPos(blockC(p.i), blockC(p.j), p.hs, p.s);
      const [x2, z2] = rectPos(blockC(p.i), blockC(p.j), p.hs, p.s + p.dir * 0.6);
      p.pos.set(x, CURB, z);
      const want = Math.atan2(x2 - x, z2 - z);
      p.heading += wrapA(want - p.heading) * Math.min(1, dt * 8);
      animHuman(h, p.speed, dt);
      if (Math.random() < dt * 0.02) p.pause = R(1, 4);
      if (Math.random() < dt * 0.01) p.dir *= -1;
    }
  } else if (p.state === 'flee') {
    const away = p.pos.clone().sub(p.fleeFrom).setY(0);
    if (away.lengthSq() < 0.01) away.set(1, 0, 0);
    away.normalize();
    const sp = 5.5;
    p.pos.x += away.x * sp * dt; p.pos.z += away.z * sp * dt;
    p.heading += wrapA(Math.atan2(away.x, away.z) - p.heading) * Math.min(1, dt * 10);
    for (const b of nearBuildings(p.pos.x, p.pos.z)) { const q = pushOutAABB(p.pos.x, p.pos.z, 0.4, b); if (q) { p.pos.x += q[0]; p.pos.z += q[1]; } }
    p.pos.x = clamp(p.pos.x, -EDGE, EDGE); p.pos.z = clamp(p.pos.z, -EDGE, EDGE);
    p.pos.y = groundH(p.pos.x, p.pos.z);
    animHuman(h, sp, dt);
    p.timer -= dt;
    if (p.timer <= 0) { // rejoin the nearest block's sidewalk loop
      const i = clamp(blockIndex(p.pos.x), 0, NB - 1), j = clamp(blockIndex(p.pos.z), 0, NB - 1);
      p.i = i; p.j = j; p.state = 'walk';
      // project onto rectangle perimeter parameter
      const lx = p.pos.x - blockC(i), lz = p.pos.z - blockC(j), hs = p.hs, L = 2 * hs;
      const ax = Math.abs(lx), az = Math.abs(lz);
      if (az > ax) p.s = lz < 0 ? clamp(lx + hs, 0, L) : 2 * L + clamp(hs - lx, 0, L);
      else p.s = lx > 0 ? L + clamp(lz + hs, 0, L) : 3 * L + clamp(hs - lz, 0, L);
    }
  } else if (p.state === 'fly') {
    p.vel.y -= 22 * dt;
    p.pos.addScaledVector(p.vel, dt);
    h.g.rotation.x += p.spin.x * dt; h.g.rotation.z += p.spin.z * dt;
    const gh = groundH(p.pos.x, p.pos.z);
    if (p.pos.y <= gh) { p.pos.y = gh; p.state = 'dead'; p.timer = 25; h.g.rotation.set(-Math.PI / 2, p.heading, 0, 'YXZ'); p.pos.y = gh + 0.15; }
    h.g.position.copy(p.pos);
    return;
  } else if (p.state === 'dead') {
    p.timer -= dt;
    if (p.timer <= 0 && p.pos.distanceTo(camera.position) > 60) { dynGroup.remove(h.g); peds.splice(peds.indexOf(p), 1); spawnPedNear(player.pos, 60, 260); }
    return;
  }
  // knocked by moving cars
  for (const c of cars) {
    const sp = Math.hypot(c.vel.x, c.vel.z);
    if (sp < 3.5) continue;
    if (Math.abs(c.pos.x - p.pos.x) > c.hl + 1 || Math.abs(c.pos.z - p.pos.z) > c.hl + 1) continue;
    if (insideCar(p.pos.x, p.pos.z, c, 0.35)) {
      knockPed(p, new THREE.Vector3(c.vel.x * 0.9, Math.min(9, 3 + sp * 0.35), c.vel.z * 0.9));
      sfx.thud();
      if (c === player.car) { addHeat(2); state.money += 0; }
      scarePeds(p.pos, 25);
      return;
    }
  }
  h.g.position.copy(p.pos);
  h.g.rotation.set(0, p.heading, 0);
}
function insideCar(px, pz, c, r) {
  const fx = Math.sin(c.heading), fz = Math.cos(c.heading);
  const dx = px - c.pos.x, dz = pz - c.pos.z;
  const lz = dx * fx + dz * fz, lx = dx * -fz + dz * fx;
  return Math.abs(lx) < c.hw + r && Math.abs(lz) < c.hl + r;
}
function pushOutCar(pos, r, c) {
  const fx = Math.sin(c.heading), fz = Math.cos(c.heading);
  const dx = pos.x - c.pos.x, dz = pos.z - c.pos.z;
  const lz = dx * fx + dz * fz, lx = dx * -fz + dz * fx;
  const ex = c.hw + r, ez = c.hl + r;
  if (Math.abs(lx) >= ex || Math.abs(lz) >= ez) return false;
  const px = ex - Math.abs(lx), pz = ez - Math.abs(lz);
  if (px < pz) { const s = Math.sign(lx) || 1; pos.x += -fz * s * px; pos.z += fx * s * px; }
  else { const s = Math.sign(lz) || 1; pos.x += fx * s * pz; pos.z += fz * s * pz; }
  return true;
}

// ============================================================ player
const player = {
  h: null, pos: new THREE.Vector3(), vy: 0, heading: 0, car: null, onGround: true, moveSpeed: 0,
  camYaw: 0, camPitch: -0.2, lastMouse: -10, shootCD: 0, aimT: 0, bustT: 0
};
function initPlayer() {
  player.h = makeHuman(0xf0f0f0, 0x2a3550, 0xd9a47e, 0x1a1410);
  const gun = new THREE.Mesh(G.gun, stdMat(0x222222, 0.4, 0.8)); player.h.armR.add(gun);
  dynGroup.add(player.h.g);
  respawnPlayer(true);
}
function respawnPlayer(first) {
  const [x, z] = [roadC(3) + ROAD / 2 + 3, roadC(3) + 10];
  player.pos.set(x, CURB, z); player.vy = 0; player.heading = Math.PI; player.camYaw = Math.PI;
  state.health = 100; state.dead = false; state.heat = 0; state.stars = 0;
  player.h.g.visible = true; player.h.g.rotation.set(0, 0, 0);
  if (player.car) { player.car.type = 'loose'; player.car = null; }
  if (first) {
    const c = makeCar('parked', 0xc9a227); c.name = 'VORTEX GT'; c.driver = false;
    c.pos.set(roadC(3) + LANE, 0, roadC(3) + 22); c.heading = 0; setCarLights(c);
  }
}
function enterExit() {
  if (state.dead) return;
  if (player.car) {
    const c = player.car;
    if (Math.abs(c.speed) > 6) return;
    const fx = Math.sin(c.heading), fz = Math.cos(c.heading);
    // exit on the driver's (left) side
    const off = c.hw + 0.7, fwd = c.truck ? 2.6 : 0;
    player.pos.set(c.pos.x + fz * off + fx * fwd, 0, c.pos.z - fx * off + fz * fwd);
    player.pos.y = groundH(player.pos.x, player.pos.z);
    player.car = null; c.type = 'loose'; c.driver = false; setCarLights(c);
    player.h.g.visible = true; player.heading = c.heading; headSpot.intensity = 0;
    $('carhp').style.display = 'none';
    return;
  }
  let best = null, bd = 4.2;
  for (const c of cars) { if (c.wrecked) continue; const d = Math.hypot(c.pos.x - player.pos.x, c.pos.z - player.pos.z) - (c.truck ? 1.8 : 0); if (d < bd) { bd = d; best = c; } }
  if (!best) return;
  if (best.driver) { // carjack: the driver is thrown out and runs
    const fx = Math.sin(best.heading), fz = Math.cos(best.heading);
    const p = spawnPed(clamp(blockIndex(best.pos.x), 0, NB - 1), clamp(blockIndex(best.pos.z), 0, NB - 1), 0);
    p.pos.set(best.pos.x + fz * 1.8, groundH(best.pos.x, best.pos.z), best.pos.z - fx * 1.8);
    p.state = 'flee'; p.timer = 8; p.fleeFrom = best.pos.clone();
    addHeat(best.police ? 6 : 1);
    toast(best.police ? 'パトカーを奪った！' : '車を奪った！');
  }
  best.type = 'player'; best.driver = true; best.path = [];
  player.car = best; player.h.g.visible = false;
  setCarLights(best);
  $('carhp').style.display = '';
  sfx.door();
}

function updatePlayerFoot(dt) {
  const k = keys;
  let ix = 0, iz = 0;
  if (k.has('KeyW')) iz += 1; if (k.has('KeyS')) iz -= 1; if (k.has('KeyA')) ix += 1; if (k.has('KeyD')) ix -= 1;
  const sprint = k.has('ShiftLeft') || k.has('ShiftRight');
  const fy = player.camYaw;
  const fx = Math.sin(fy), fz = Math.cos(fy), rx = -fz, rz = fx;
  let mx = fx * iz - rx * ix, mz = fz * iz - rz * ix;
  const ml = Math.hypot(mx, mz);
  const target = ml > 0 ? (sprint ? 7.2 : 4.0) : 0;
  if (ml > 0) { mx /= ml; mz /= ml; player.heading += wrapA(Math.atan2(mx, mz) - player.heading) * Math.min(1, dt * 12); }
  player.moveSpeed += (target - player.moveSpeed) * Math.min(1, dt * 10);
  if (player.aimT > 0) { player.aimT -= dt; player.heading += wrapA(player.camYaw - player.heading) * Math.min(1, dt * 20); }
  const hx = ml > 0 ? mx : 0, hz = ml > 0 ? mz : 0;
  player.pos.x += hx * player.moveSpeed * dt; player.pos.z += hz * player.moveSpeed * dt;
  if (k.has('Space') && player.onGround) { player.vy = 5.5; player.onGround = false; }
  player.vy -= 18 * dt; player.pos.y += player.vy * dt;
  const gh = groundH(player.pos.x, player.pos.z);
  if (player.pos.y <= gh) { player.pos.y = gh; player.vy = 0; player.onGround = true; }
  else if (player.pos.y - gh < 0.2 && player.vy <= 0) { player.pos.y = gh; player.vy = 0; player.onGround = true; }
  for (const b of nearBuildings(player.pos.x, player.pos.z)) { const q = pushOutAABB(player.pos.x, player.pos.z, 0.35, b); if (q) { player.pos.x += q[0]; player.pos.z += q[1]; } }
  for (const t of parkTrees) { const dx = player.pos.x - t.x, dz = player.pos.z - t.z, d = Math.hypot(dx, dz); if (d < 0.6 && d > 1e-4) { player.pos.x += dx / d * (0.6 - d); player.pos.z += dz / d * (0.6 - d); } }
  for (const c of cars) {
    if (Math.abs(c.pos.x - player.pos.x) > c.hl + 1 || Math.abs(c.pos.z - player.pos.z) > c.hl + 1) continue;
    if (player.pos.y > (c.truck ? 3.6 : 1.5)) continue;
    const sp = Math.hypot(c.vel.x, c.vel.z);
    if (sp > 5 && insideCar(player.pos.x, player.pos.z, c, 0.3)) {
      hurtPlayer(sp * 2.2);
      player.vy = 4; player.onGround = false;
      player.pos.x += c.vel.x * 0.12; player.pos.z += c.vel.z * 0.12;
      sfx.thud();
    }
    pushOutCar(player.pos, 0.35, c);
  }
  player.pos.x = clamp(player.pos.x, -EDGE, EDGE); player.pos.z = clamp(player.pos.z, -EDGE, EDGE);
  const h = player.h;
  h.g.position.copy(player.pos); h.g.rotation.set(0, player.heading, 0);
  h.aiming = player.aimT > 0;
  if (h.aiming) h.armR.rotation.x = -Math.PI / 2 + clamp(player.camPitch, -0.8, 0.8) * -1;
  animHuman(h, player.onGround ? player.moveSpeed : 0, dt);
  if (!player.onGround) { h.legL.rotation.x = 0.5; h.legR.rotation.x = -0.3; }
}
function updatePlayerCar(dt) {
  const c = player.car, k = keys;
  if (c.wrecked) return;
  const thr = (k.has('KeyW') ? 1 : 0) - (k.has('KeyS') ? 1 : 0);
  const st = (k.has('KeyA') ? 1 : 0) - (k.has('KeyD') ? 1 : 0);
  carPhysics(c, thr, st, k.has('Space'), dt);
  player.pos.copy(c.pos);
  if (c.burnT === 0 && c.health < 30) c.burnT = 0.01;
}

function hurtPlayer(n) {
  if (state.dead) return;
  state.health -= n;
  flashRed();
  if (state.health <= 0) killPlayer();
}
function killPlayer() {
  if (state.dead) return;
  state.dead = true; state.health = 0;
  if (!player.car) { player.h.g.rotation.set(-Math.PI / 2, player.heading, 0, 'YXZ'); player.h.g.position.y = player.pos.y + 0.15; }
  showMsg('WASTED', '#c62828');
  setTimeout(() => {
    state.money = Math.max(0, state.money - 100);
    if (player.car) { player.car = null; player.h.g.visible = true; $('carhp').style.display = 'none'; }
    respawnPlayer(false);
  }, 4000);
}
function bustPlayer() {
  if (state.dead) return;
  state.dead = true;
  showMsg('BUSTED', '#2b6cd6');
  setTimeout(() => {
    state.money = Math.max(0, Math.floor(state.money * 0.8) - 50);
    if (player.car) { player.car.type = 'loose'; player.car.driver = false; setCarLights(player.car); player.car = null; $('carhp').style.display = 'none'; }
    respawnPlayer(false);
  }, 4000);
}

// ============================================================ shooting
const tracerMat = new THREE.LineBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: 0.9, toneMapped: false });
const tracers = [];
function rayAABB(o, d, b) {
  let t0 = 0, t1 = 400;
  const lo = [b.x0, 0, b.z0], hi = [b.x1, b.h, b.z1], oo = [o.x, o.y, o.z], dd = [d.x, d.y, d.z];
  for (let a = 0; a < 3; a++) {
    if (Math.abs(dd[a]) < 1e-9) { if (oo[a] < lo[a] || oo[a] > hi[a]) return Infinity; continue; }
    let ta = (lo[a] - oo[a]) / dd[a], tb = (hi[a] - oo[a]) / dd[a];
    if (ta > tb) [ta, tb] = [tb, ta];
    t0 = Math.max(t0, ta); t1 = Math.min(t1, tb);
    if (t0 > t1) return Infinity;
  }
  return t0;
}
// ray vs sphere whose radius grows with distance (aim-assist cone, ~1.7 deg)
function raySphere(o, d, c, r) {
  const along = (c.x - o.x) * d.x + (c.y - o.y) * d.y + (c.z - o.z) * d.z;
  if (along > 0) r += along * 0.03;
  const ox = o.x - c.x, oy = o.y - c.y, oz = o.z - c.z;
  const b = ox * d.x + oy * d.y + oz * d.z, cc = ox * ox + oy * oy + oz * oz - r * r;
  const h = b * b - cc; if (h < 0) return Infinity;
  const t = -b - Math.sqrt(h); return t > 0 ? t : Infinity;
}
function shoot() {
  if (player.car || state.dead || player.shootCD > 0) return;
  player.shootCD = 0.22; player.aimT = 1.2;
  const o = camera.position.clone(), d = new THREE.Vector3(); camera.getWorldDirection(d);
  let best = 300, hit = null;
  for (const b of buildings) { const t = rayAABB(o, d, b); if (t < best) { best = t; hit = null; } }
  { const t = o.y > 0 && d.y < 0 ? -o.y / d.y : Infinity; if (t < best) { best = t; hit = null; } }
  for (const p of peds) {
    if (p.state === 'dead' || p.state === 'fly') continue;
    const t = Math.min(raySphere(o, d, p.pos.clone().setY(p.pos.y + 1.15), 0.42), raySphere(o, d, p.pos.clone().setY(p.pos.y + 1.6), 0.2));
    if (t < best) { best = t; hit = { ped: p }; }
  }
  for (const c of cars) {
    if (c === player.car) continue;
    const t = raySphere(o, d, c.pos.clone().setY(c.truck ? 1.8 : 0.9), c.truck ? 2.4 : 1.6);
    if (t < best) { best = t; hit = { car: c }; }
  }
  const end = o.clone().addScaledVector(d, best);
  const start = player.pos.clone().add(new THREE.Vector3(Math.sin(player.heading) * 0.5 - Math.cos(player.heading) * 0.3, 1.42, Math.cos(player.heading) * 0.5 + Math.sin(player.heading) * 0.3));
  const lg = new THREE.BufferGeometry().setFromPoints([start, end]);
  const line = new THREE.Line(lg, tracerMat); scene.add(line); tracers.push({ line, t: 0.06 });
  fx.flash(start); fx.spark(end);
  sfx.gun();
  scarePeds(player.pos, 45);
  if (hit && hit.ped) {
    knockPed(hit.ped, d.clone().multiplyScalar(4).setY(2));
    addHeat(2);
  } else if (hit && hit.car) {
    hit.car.lastHitByPlayer = true;
    damageCar(hit.car, 12);
    if (hit.car.police) addHeat(1.5);
    if (hit.car.type === 'ai' && Math.random() < 0.4) { hit.car.type = 'loose'; hit.car.loose = 3; }
  }
}

// ============================================================ wanted level & police
const STAR_T = [1, 4, 9, 15, 23];
function addHeat(v) {
  state.heat += v;
  let s = 0; for (const t of STAR_T) if (state.heat >= t) s++;
  if (s > state.stars) { state.stars = s; state.evade = 0; }
}
function updateWanted(dt) {
  if (state.stars === 0) return;
  let nearCop = Infinity;
  for (const c of cars) if (c.police && c.driver && !c.wrecked) nearCop = Math.min(nearCop, c.pos.distanceTo(player.pos));
  if (nearCop < 75) state.evade = 0; else state.evade += dt;
  if (state.evade > 10 + state.stars * 2) {
    state.stars--; state.heat = state.stars ? STAR_T[state.stars - 1] : 0; state.evade = 0;
    if (state.stars === 0) toast('手配解除');
  }
  // busted check
  const ps = player.car ? Math.abs(player.car.speed) : player.moveSpeed;
  if (!state.dead && nearCop < (player.car ? 7 : 5.5) && ps < 2.2) { player.bustT += dt; if (player.bustT > (player.car ? 2.5 : 1.5)) bustPlayer(); }
  else player.bustT = Math.max(0, player.bustT - dt);
}
function managePolice() {
  const want = [0, 1, 3, 4, 6, 8][state.stars];
  const cops = cars.filter(c => c.police && c.driver && !c.wrecked && c !== player.car);
  if (cops.length < want && Math.random() < 0.12) {
    const [i, j, d] = randomEdge(110, 220, player.pos);
    const c = spawnTrafficCar(i, j, d, 'police');
    c.type = 'police'; c.vel.set(Math.sin(c.heading) * 10, 0, Math.cos(c.heading) * 10);
  }
  if (state.stars === 0) for (const c of cops) if (c.pos.distanceTo(player.pos) > 140) removeCar(c);
}
function nearestNodeOnRoad(c, tgt) {
  const fi = (c.pos.x + HALF) / P, fj = (c.pos.z + HALF) / P;
  let i = Math.round(fi), j = Math.round(fj);
  const onV = Math.abs(c.pos.x - roadC(i)) < ROAD / 2 + 1, onH = Math.abs(c.pos.z - roadC(j)) < ROAD / 2 + 1;
  if (onV && !onH) j = clamp(tgt.z > c.pos.z ? Math.ceil(fj) : Math.floor(fj), 0, NB);
  if (onH && !onV) i = clamp(tgt.x > c.pos.x ? Math.ceil(fi) : Math.floor(fi), 0, NB);
  return [clamp(i, 0, NB), clamp(j, 0, NB)];
}
function policeAI(c, dt) {
  const tgt = player.car ? player.car.pos : player.pos;
  const dist = Math.hypot(tgt.x - c.pos.x, tgt.z - c.pos.z);
  let aim;
  if (state.stars === 0) { // cruise back to normal traffic behaviour
    if (!c.wp || Math.hypot(c.wp[0] - c.pos.x, c.wp[1] - c.pos.z) < 8) { const n = nearestNodeOnRoad(c, { x: c.pos.x + Math.sin(c.heading) * 50, z: c.pos.z + Math.cos(c.heading) * 50 }); c.wp = nodePos(...n); }
    aim = { x: c.wp[0], z: c.wp[1] };
  } else if (dist < 45) aim = tgt;
  else {
    if (!c.wp || Math.hypot(c.wp[0] - c.pos.x, c.wp[1] - c.pos.z) < 9) {
      const [i, j] = nearestNodeOnRoad(c, tgt);
      const [nx, nz] = nodePos(i, j);
      if (Math.hypot(nx - c.pos.x, nz - c.pos.z) > 10) c.wp = [nx, nz];
      else {
        let best = null, bd = Infinity;
        for (const d of validDirs(i, j)) { const [px, pz] = nodePos(i + DIRS[d][0], j + DIRS[d][1]); const dd = Math.hypot(px - tgt.x, pz - tgt.z) + Math.random() * 10; if (dd < bd) { bd = dd; best = [px, pz]; } }
        c.wp = best;
      }
    }
    aim = { x: c.wp[0], z: c.wp[1] };
  }
  const want = Math.atan2(aim.x - c.pos.x, aim.z - c.pos.z);
  const diff = wrapA(want - c.heading);
  let thr = 1, steer = clamp(diff * 2.2, -1, 1);
  if (Math.abs(diff) > 1.2 && c.speed > 9) thr = -0.6;
  if (state.stars > 0 && dist < 9) thr = Math.abs(player.car ? player.car.speed : 0) < 3 ? -0.5 : 0.6;
  if (state.stars === 0) thr = c.speed < 11 ? 0.6 : 0;
  if (c.reverseT > 0) { c.reverseT -= dt; thr = -1; steer = -steer; }
  else if (thr > 0 && Math.abs(c.speed) < 1.2) { c.stuck += dt; if (c.stuck > 1.0) { c.reverseT = 1.1; c.stuck = 0; } }
  else c.stuck = 0;
  carPhysics(c, thr, steer, false, dt);
}

// ============================================================ effects
const fxTex = radialTex('rgba(255,255,255,1)', 64);
const fx = (() => {
  const pool = [];
  for (let k = 0; k < 120; k++) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: fxTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xffffff }));
    s.visible = false; scene.add(s); pool.push({ s, life: 0, max: 1, vel: new THREE.Vector3(), grow: 0, col0: new THREE.Color(), col1: new THREE.Color(), additive: true });
  }
  const flashLight = new THREE.PointLight(0xffa040, 0, 40, 1.5); scene.add(flashLight);
  let flashT = 0;
  function emit(pos, vel, life, size, grow, c0, c1, additive = true) {
    const p = pool.find(q => q.life <= 0); if (!p) return;
    p.s.position.copy(pos); p.vel.copy(vel); p.life = p.max = life; p.s.scale.setScalar(size); p.grow = grow;
    p.col0.set(c0); p.col1.set(c1);
    p.s.material.blending = additive ? THREE.AdditiveBlending : THREE.NormalBlending; p.s.visible = true;
  }
  return {
    explosion(pos) {
      for (let k = 0; k < 30; k++) emit(pos, new THREE.Vector3(R(-6, 6), R(2, 10), R(-6, 6)), R(0.5, 1.1), R(1.5, 3), 5, 0xffd080, 0x401000);
      for (let k = 0; k < 14; k++) emit(pos, new THREE.Vector3(R(-2, 2), R(2, 5), R(-2, 2)), R(1.5, 2.6), 2, 3, 0x333333, 0x111111, false);
      flashLight.position.copy(pos); flashLight.intensity = 200; flashT = 0.5;
    },
    flash(pos) { emit(pos, new THREE.Vector3(), 0.05, 0.5, 0, 0xffe0a0, 0xff8000); },
    spark(pos) { for (let k = 0; k < 4; k++) emit(pos, new THREE.Vector3(R(-3, 3), R(0, 4), R(-3, 3)), 0.25, 0.15, 0, 0xffd080, 0xff4000); },
    smoke(pos, fire) { emit(pos, new THREE.Vector3(R(-0.5, 0.5), R(1.5, 3), R(-0.5, 0.5)), 1.6, 0.8, 2, fire ? 0xff7020 : 0x444444, 0x222222, !!fire); },
    update(dt) {
      for (const p of pool) {
        if (p.life <= 0) continue;
        p.life -= dt;
        if (p.life <= 0) { p.s.visible = false; continue; }
        const t = 1 - p.life / p.max;
        p.s.position.addScaledVector(p.vel, dt); p.vel.multiplyScalar(Math.exp(-2 * dt));
        p.s.scale.addScalar(p.grow * dt);
        p.s.material.color.copy(p.col0).lerp(p.col1, t);
        p.s.material.opacity = 1 - t;
      }
      if (flashT > 0) { flashT -= dt; flashLight.intensity = Math.max(0, flashT) * 400; }
    }
  };
})();

// ============================================================ audio (synthesized)
const sfx = (() => {
  let ac = null, master, engOsc, engGain, engFilter, sirenOsc, sirenGain, noiseBuf;
  function init() {
    if (ac) return;
    ac = new (window.AudioContext || window.webkitAudioContext)();
    master = ac.createGain(); master.gain.value = 0.5; master.connect(ac.destination);
    noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate);
    const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    engOsc = ac.createOscillator(); engOsc.type = 'sawtooth'; engOsc.frequency.value = 40;
    engFilter = ac.createBiquadFilter(); engFilter.type = 'lowpass'; engFilter.frequency.value = 400;
    engGain = ac.createGain(); engGain.gain.value = 0;
    engOsc.connect(engFilter).connect(engGain).connect(master); engOsc.start();
    sirenOsc = ac.createOscillator(); sirenOsc.type = 'square'; sirenOsc.frequency.value = 700;
    const sf = ac.createBiquadFilter(); sf.type = 'lowpass'; sf.frequency.value = 1800;
    sirenGain = ac.createGain(); sirenGain.gain.value = 0;
    sirenOsc.connect(sf).connect(sirenGain).connect(master); sirenOsc.start();
  }
  function noise(dur, vol, freq, q = 0.7) {
    if (!ac) return;
    const s = ac.createBufferSource(); s.buffer = noiseBuf;
    const f = ac.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = freq; f.Q.value = q;
    const g = ac.createGain(); g.gain.setValueAtTime(vol, ac.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + dur);
    s.connect(f).connect(g).connect(master); s.start(); s.stop(ac.currentTime + dur);
  }
  let lastCrash = 0;
  return {
    init,
    gun() { noise(0.18, 0.9, 3000); noise(0.35, 0.5, 300); },
    crash(v) { if (!ac || ac.currentTime - lastCrash < 0.15) return; lastCrash = ac.currentTime; noise(0.4, 0.3 + v * 0.6, 900); },
    thud() { noise(0.2, 0.5, 400); },
    boom() { noise(1.6, 1.0, 500); noise(0.4, 0.8, 4000); },
    door() { noise(0.08, 0.4, 1500); },
    beep(freq = 880, dur = 0.15, vol = 0.14) {
      if (!ac) return;
      const o = ac.createOscillator(), g = ac.createGain(); o.type = 'triangle'; o.frequency.value = freq;
      g.gain.setValueAtTime(vol, ac.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + dur);
      o.connect(g).connect(master); o.start(); o.stop(ac.currentTime + dur);
    },
    fanfare() { [523, 659, 784, 1047].forEach((f, i) => setTimeout(() => this.beep(f, i === 3 ? 0.6 : 0.16, 0.16), i * 140)); },
    horn(on) { if (!ac) return; if (on && !this._h) { const o = ac.createOscillator(), o2 = ac.createOscillator(), g = ac.createGain(); o.type = o2.type = 'square'; o.frequency.value = 415; o2.frequency.value = 523; g.gain.value = 0.06; o.connect(g); o2.connect(g); g.connect(master); o.start(); o2.start(); this._h = [o, o2]; } else if (!on && this._h) { this._h.forEach(o => o.stop()); this._h = null; } },
    update(t) {
      if (!ac) return;
      const c = player.car;
      const sp = c ? Math.abs(c.speed) : 0;
      engGain.gain.setTargetAtTime(c && !c.wrecked ? 0.07 : 0, ac.currentTime, 0.1);
      const gear = sp % 9; engOsc.frequency.setTargetAtTime(38 + sp * 2.2 + gear * 6, ac.currentTime, 0.05);
      engFilter.frequency.setTargetAtTime(300 + sp * 30, ac.currentTime, 0.1);
      let nd = Infinity; for (const k of cars) if (k.police && k.driver && !k.wrecked && state.stars > 0) nd = Math.min(nd, k.pos.distanceTo(player.pos));
      sirenGain.gain.setTargetAtTime(nd < 200 ? 0.05 * (1 - nd / 200) : 0, ac.currentTime, 0.1);
      sirenOsc.frequency.setTargetAtTime(Math.sin(t * 5) > 0 ? 960 : 720, ac.currentTime, 0.02);
    }
  };
})();

// ============================================================ pickups
const pickups = [];
function makePickups() {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'); g.fillStyle = '#1d7a2a'; g.fillRect(0, 0, 64, 64); g.fillStyle = '#b9ffb0'; g.font = 'bold 50px sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('$', 32, 35);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshStandardMaterial({ map: t, emissiveMap: t, emissive: 0xffffff, emissiveIntensity: 0.9 });
  const geo = new THREE.BoxGeometry(0.7, 0.7, 0.7);
  for (let k = 0; k < 24; k++) {
    const i = Math.floor(Math.random() * NB), j = Math.floor(Math.random() * NB);
    const [x, z] = rectPos(blockC(i), blockC(j), BLOCK / 2 - 2.5, Math.random() * 1000);
    const m = new THREE.Mesh(geo, mat); m.position.set(x, CURB + 1, z);
    dynGroup.add(m);
    pickups.push({ m, t: 0, value: 50 * (1 + Math.floor(Math.random() * 10)) });
  }
}
function updatePickups(dt, time) {
  for (const p of pickups) {
    if (p.t > 0) { p.t -= dt; p.m.visible = p.t <= 0; continue; }
    p.m.rotation.y = time * 2; p.m.position.y = CURB + 1 + Math.sin(time * 3) * 0.15;
    const d = Math.hypot(p.m.position.x - player.pos.x, p.m.position.z - player.pos.z);
    if (!state.dead && d < (player.car ? 3 : 1.4)) { state.money += p.value; toast('+$' + p.value); p.t = 60; p.m.visible = false; }
  }
}

// ============================================================ missions (checkpoint runs)
// Walk / drive into a start marker, then hit checkpoints in order before the timer runs out.
const MISSIONS = [
  { id: 'race', name: 'ストリートレース', desc: '車で交差点のチェックポイントを順に通過せよ', need: 'car', node: [3, 2], count: 10, reward: 1500, color: 0xffc928 },
  { id: 'delivery', name: '配送ラン', desc: 'トラックで配達先に停車して荷物を降ろせ', need: 'truck', node: [2, 4], count: 5, reward: 2500, color: 0x3fb8ff },
  { id: 'foot', name: 'パルクール・ラッシュ', desc: '徒歩で歩道のチェックポイントを駆け抜けろ', need: 'foot', node: [4, 4], count: 8, reward: 800, color: 0x5dff7a }
];
const mission = { active: null, cps: [], idx: 0, time: 0, countdown: 0, unload: 0, lockout: null, vehicle: null };

// glowing beam texture: opaque at the bottom, fading to nothing at the top
const cpBeamTex = (() => {
  const c = document.createElement('canvas'); c.width = 4; c.height = 128;
  const g = c.getContext('2d'); const gr = g.createLinearGradient(0, 0, 0, 128);
  gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.7, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0.9)');
  g.fillStyle = gr; g.fillRect(0, 0, 4, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
})();
const cpCyl = new THREE.CylinderGeometry(1, 1, 1, 40, 1, true).translate(0, 0.5, 0);
const cpRing = new THREE.RingGeometry(0.86, 1, 48).rotateX(-Math.PI / 2);
function makeBeacon(color, radius, height) {
  const g = new THREE.Group();
  const col = new THREE.Color(color);
  const beam = new THREE.Mesh(cpCyl, new THREE.MeshBasicMaterial({ map: cpBeamTex, color: col, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false }));
  beam.scale.set(radius, height, radius);
  const ring = new THREE.Mesh(cpRing, new THREE.MeshBasicMaterial({ color: col.clone().multiplyScalar(0.9), transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, toneMapped: false }));
  ring.scale.setScalar(radius); ring.position.y = 0.06;
  g.add(beam, ring);
  g.userData = { beam, ring };
  dynGroup.add(g);
  return g;
}
function labelSprite(text, sub, color) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 160;
  const g = c.getContext('2d');
  g.font = '900 64px "Arial Black", sans-serif'; g.textAlign = 'center'; g.lineWidth = 10; g.strokeStyle = '#000';
  g.fillStyle = '#' + new THREE.Color(color).getHexString();
  g.strokeText(text, 256, 72); g.fillText(text, 256, 72);
  g.font = '700 30px sans-serif'; g.lineWidth = 6; g.fillStyle = '#fff';
  g.strokeText(sub, 256, 128); g.fillText(sub, 256, 128);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthWrite: false, toneMapped: false }));
  s.scale.set(9, 2.8, 1);
  return s;
}
// start marker sits on the sidewalk corner of the block south-east of the node; vehicle spawns at the curb
function missionSpots(m) {
  const [cx, cz] = nodePos(...m.node);
  return { marker: new THREE.Vector3(cx + ROAD / 2 + 3.5, CURB, cz + ROAD / 2 + 3.5), park: [cx + ROAD / 2 + 14, cz + ROAD / 2 - 1.6] };
}
function initMissions() {
  for (const m of MISSIONS) {
    const sp = missionSpots(m);
    m.markerPos = sp.marker; m.parkPos = sp.park;
    m.beacon = makeBeacon(m.color, 1.6, 4);
    m.beacon.position.copy(sp.marker);
    const needTxt = m.need === 'car' ? '車で進入' : m.need === 'truck' ? 'トラックで進入' : '徒歩で進入';
    m.label = labelSprite(m.name, needTxt, m.color);
    m.label.position.copy(sp.marker).setY(5.6);
    dynGroup.add(m.label);
  }
  // flat extruded arrow (points +z); tilted toward the chase camera so it reads from behind
  const sh = new THREE.Shape();
  sh.moveTo(0, 1.0); sh.lineTo(0.75, 0.1); sh.lineTo(0.3, 0.1); sh.lineTo(0.3, -0.8); sh.lineTo(-0.3, -0.8); sh.lineTo(-0.3, 0.1); sh.lineTo(-0.75, 0.1); sh.closePath();
  const ag = new THREE.ExtrudeGeometry(sh, { depth: 0.12, bevelEnabled: false }).translate(0, 0, -0.06).rotateX(-Math.PI / 2);
  const arrowRoot = new THREE.Group();
  const arrowMesh = new THREE.Mesh(ag.rotateX(Math.PI), new THREE.MeshBasicMaterial({ color: 0xffd030, toneMapped: false }));
  arrowMesh.rotation.x = 0.55;             // tip dips toward the target, tail rises toward the camera
  arrowRoot.add(arrowMesh); arrowRoot.scale.setScalar(1.4);
  mission.arrow = arrowRoot; mission.arrow.material = arrowMesh.material;
  mission.arrow.visible = false; dynGroup.add(mission.arrow);
  mission.cpBeacon = makeBeacon(0xffd030, 6, 14); mission.cpBeacon.visible = false;
  mission.nextBeacon = makeBeacon(0xffd030, 6, 6); mission.nextBeacon.visible = false;
}
const manhattan = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]);
function genCheckpoints(m) {
  const pts = [];
  if (m.id === 'race') {
    // random walk over the road grid; checkpoints in intersection centres (always reachable)
    let [i, j] = m.node, prev = -1;
    while (pts.length < m.count) {
      let opts = validDirs(i, j).filter(d => d !== (prev + 2) % 4);
      const d = pickA(opts);
      let steps = 1 + (Math.random() < 0.5 ? 1 : 0);
      while (steps > 1 && (i + DIRS[d][0] * steps < 0 || i + DIRS[d][0] * steps > NB || j + DIRS[d][1] * steps < 0 || j + DIRS[d][1] * steps > NB)) steps--;
      i += DIRS[d][0] * steps; j += DIRS[d][1] * steps; prev = d;
      pts.push({ p: nodePos(i, j), r: 7.5 });
    }
  } else if (m.id === 'delivery') {
    // drop-offs on the kerb lane of road segments, 90-260 m apart
    let last = m.parkPos;
    while (pts.length < m.count) {
      const horiz = Math.random() < 0.5, k = Math.floor(Math.random() * (NB + 1)), s = Math.floor(Math.random() * NB);
      const along = blockC(s) + R(-20, 20), side = Math.random() < 0.5 ? 1 : -1;
      const p = horiz ? [along, roadC(k) + side * (LANE + 1.5)] : [roadC(k) + side * (LANE + 1.5), along];
      const dd = manhattan(p, last);
      if (dd < 90 || dd > 260) continue;
      pts.push({ p, r: 5.5, stop: true }); last = p;
    }
  } else {
    // sidewalk loop around nearby blocks
    let last = [m.markerPos.x, m.markerPos.z];
    const bi = clamp(blockIndex(m.markerPos.x), 0, NB - 1), bj = clamp(blockIndex(m.markerPos.z), 0, NB - 1);
    while (pts.length < m.count) {
      const i = clamp(bi + Math.floor(R(-1, 2)), 0, NB - 1), j = clamp(bj + Math.floor(R(-1, 2)), 0, NB - 1);
      const [x, z] = rectPos(blockC(i), blockC(j), BLOCK / 2 - 2.2, Math.random() * 1000);
      const dd = manhattan([x, z], last);
      if (dd < 30 || dd > 85) continue;
      pts.push({ p: [x, z], r: 2.6 }); last = [x, z];
    }
  }
  return pts;
}
function legTime(m, a, b) {
  const d = manhattan(a, b);
  return m.id === 'race' ? d / 17 + 3 : m.id === 'delivery' ? d / 11 + 8 : d / 5.6 + 3;
}
function vehicleOk(m) {
  if (m.need === 'foot') return !player.car;
  if (m.need === 'truck') return player.car && player.car.truck && !player.car.wrecked;
  return player.car && !player.car.truck && !player.car.wrecked;
}
function startMission(m) {
  mission.active = m; mission.idx = 0; mission.unload = 0;
  mission.cps = genCheckpoints(m);
  mission.time = legTime(m, [m.markerPos.x, m.markerPos.z], mission.cps[0].p) + 4;
  mission.vehicle = player.car || null;
  mission.countdown = 3.2;
  const col = new THREE.Color(m.color);
  for (const b of [mission.cpBeacon, mission.nextBeacon]) { b.userData.beam.material.color.copy(col); b.userData.ring.material.color.copy(col); }
  mission.nextBeacon.userData.beam.material.color.multiplyScalar(0.35); mission.nextBeacon.userData.ring.material.color.multiplyScalar(0.35);
  mission.arrow.material.color.copy(col);
  for (const mm2 of MISSIONS) { mm2.beacon.visible = false; mm2.label.visible = false; }
  $('mission').style.display = 'block';
  $('mtitle').textContent = m.name; $('mdesc').textContent = m.desc;
  showMsg(m.name, '#' + col.getHexString());
  sfx.beep(660, 0.25);
}
function endMission(passed, why) {
  const m = mission.active; if (!m) return;
  mission.active = null; mission.lockout = m;
  mission.cpBeacon.visible = mission.nextBeacon.visible = mission.arrow.visible = false;
  for (const mm2 of MISSIONS) { mm2.beacon.visible = true; mm2.label.visible = true; }
  $('mission').style.display = 'none';
  if (passed) {
    state.money += m.reward;
    showMsg('MISSION PASSED', '#f6c544'); toast(`報酬 +$${m.reward}`);
    sfx.fanfare();
  } else if (!state.dead) {
    showMsg('MISSION FAILED', '#c62828'); if (why) toast(why);
    sfx.beep(220, 0.6);
  }
}
function placeBeacon(b, cp, h) {
  b.visible = true; b.position.set(cp.p[0], groundH(cp.p[0], cp.p[1]) + 0.02, cp.p[1]);
  const s = cp.r; b.userData.beam.scale.set(s, h, s); b.userData.ring.scale.setScalar(s);
}
function ensureMissionVehicle(m) {
  // keep a suitable parked vehicle next to car/truck mission markers
  if (m.need === 'foot' || mission.active) return;
  if (player.pos.distanceTo(m.markerPos) > 120) return;
  const want = m.need === 'truck';
  const near = cars.some(c => !c.wrecked && !!c.truck === want && Math.hypot(c.pos.x - m.parkPos[0], c.pos.z - m.parkPos[1]) < 30);
  if (near) return;
  const c = makeCar('parked', want ? undefined : 0xc9a227, want ? 'truck' : 'car');
  c.driver = false; c.pos.set(m.parkPos[0], 0, m.parkPos[1]); c.heading = Math.PI / 2; setCarLights(c);
  if (!want) c.name = 'VORTEX GT';
}
function updateMissions(dt, t) {
  for (const m of MISSIONS) {
    m.beacon.userData.ring.rotation.y = t;
    m.beacon.userData.beam.material.opacity = 0.75 + Math.sin(t * 3) * 0.25;
    m.label.position.y = 5.6 + Math.sin(t * 2) * 0.15;
    ensureMissionVehicle(m);
  }
  const pos = player.car ? player.car.pos : player.pos;
  const m = mission.active;
  if (!m) {
    if (state.dead) return;
    if (mission.lockout && pos.distanceTo(mission.lockout.markerPos) > 9) mission.lockout = null;
    for (const mk of MISSIONS) {
      if (mk === mission.lockout) continue;
      const d = Math.hypot(pos.x - mk.markerPos.x, pos.z - mk.markerPos.z);
      if (d < (player.car ? 4.5 : 1.8)) {
        if (vehicleOk(mk) && (!player.car || Math.abs(player.car.speed) < 9)) startMission(mk);
        else { toast(mk.need === 'truck' ? 'トラックが必要（近くに停めてある）' : mk.need === 'car' ? '乗用車が必要（近くに停めてある）' : '車から降りて進入'); mission.lockout = mk; }
        break;
      }
    }
    return;
  }
  // ---- active mission ----
  if (state.dead) { endMission(false); return; }
  if (m.need !== 'foot' && mission.vehicle && mission.vehicle.wrecked) { endMission(false, '車両が大破した'); return; }
  const cp = mission.cps[mission.idx], nx = mission.cps[mission.idx + 1];
  placeBeacon(mission.cpBeacon, cp, m.id === 'foot' ? 7 : 14);
  mission.cpBeacon.userData.ring.rotation.y = t * 1.5;
  if (nx) placeBeacon(mission.nextBeacon, nx, 5); else mission.nextBeacon.visible = false;
  // guidance arrow over the player's head
  const dx = cp.p[0] - pos.x, dz = cp.p[1] - pos.z, dist = Math.hypot(dx, dz);
  mission.arrow.visible = true;
  mission.arrow.position.set(pos.x, pos.y + (player.car ? (player.car.truck ? 5.0 : 3.2) : 2.45) + Math.sin(t * 4) * 0.08, pos.z);
  mission.arrow.rotation.set(0, Math.atan2(dx, dz), 0);
  if (mission.countdown > 0) {
    const before = Math.ceil(mission.countdown);
    mission.countdown -= dt;
    const after = Math.ceil(mission.countdown);
    if (after !== before) { if (after > 0) { showMsg(String(after), '#fff'); sfx.beep(520, 0.15); } else { showMsg('GO!', '#5dff7a'); sfx.beep(1040, 0.3); } }
  } else {
    mission.time -= dt;
    if (mission.time <= 0) { endMission(false, '時間切れ'); return; }
  }
  // checkpoint hit (must be in the right vehicle / on foot)
  const okV = vehicleOk(m);
  if (dist < cp.r && okV) {
    if (cp.stop) {
      const sp = player.car ? Math.abs(player.car.speed) : 0;
      if (sp < 2.5) mission.unload += dt; else mission.unload = 0;
      $('mstatus').textContent = sp < 2.5 ? `荷降ろし中… ${Math.min(100, Math.round(mission.unload / 1.5 * 100))}%` : '停車して荷物を降ろせ';
      if (mission.unload < 1.5) { updateMissionHUD(dist, okV); return; }
    }
    mission.unload = 0;
    mission.idx++;
    if (mission.idx >= mission.cps.length) { endMission(true); return; }
    mission.time += legTime(m, cp.p, mission.cps[mission.idx].p);
    sfx.beep(880 + mission.idx * 40, 0.18);
    toast(`CHECKPOINT ${mission.idx}/${mission.cps.length}`);
  } else mission.unload = 0;
  updateMissionHUD(dist, okV);
}
function updateMissionHUD(dist, okV) {
  const m = mission.active; if (!m) return;
  const tt = Math.max(0, mission.time);
  $('mtimer').textContent = `${Math.floor(tt / 60)}:${String(Math.floor(tt % 60)).padStart(2, '0')}.${Math.floor((tt % 1) * 10)}`;
  $('mtimer').style.color = tt < 10 && mission.countdown <= 0 ? '#ff5050' : '#fff';
  $('mcount').textContent = `CHECKPOINT ${mission.idx + 1} / ${mission.cps.length}`;
  if (!mission.cps[mission.idx].stop || dist >= mission.cps[mission.idx].r) {
    $('mstatus').textContent = !okV ? (m.need === 'foot' ? '車から降りろ！' : m.need === 'truck' ? 'トラックに戻れ！' : '車に戻れ！') : `${Math.round(dist)} m`;
  }
}
// screen position of a world point on the minimap (clamped to the rim)
function minimapPt(x, z) {
  const W = 230, sc = 0.62, y = player.camYaw;
  const dx = x - player.pos.x, dz = z - player.pos.z;
  let sx = sc * (-Math.cos(y) * dx + Math.sin(y) * dz), sy = sc * (-Math.sin(y) * dx - Math.cos(y) * dz);
  const r = Math.hypot(sx, sy), lim = 100, edge = r > lim;
  if (edge) { sx *= lim / r; sy *= lim / r; }
  return [W / 2 + sx, W / 2 + sy, edge];
}
function drawMissionBlips(time) {
  if (mission.active) {
    const cp = mission.cps[mission.idx];
    const [x, y, edge] = minimapPt(cp.p[0], cp.p[1]);
    mm.fillStyle = '#' + new THREE.Color(mission.active.color).getHexString(); mm.strokeStyle = '#000'; mm.lineWidth = 2;
    mm.beginPath(); mm.arc(x, y, edge ? 5 : 7 + Math.sin(time * 6) * 1.5, 0, 7); mm.fill(); mm.stroke();
    const nx = mission.cps[mission.idx + 1];
    if (nx) { const [x2, y2, e2] = minimapPt(nx.p[0], nx.p[1]); if (!e2) { mm.globalAlpha = 0.45; mm.beginPath(); mm.arc(x2, y2, 5, 0, 7); mm.fill(); mm.globalAlpha = 1; } }
  } else {
    for (const m of MISSIONS) {
      const [x, y] = minimapPt(m.markerPos.x, m.markerPos.z);
      mm.fillStyle = '#' + new THREE.Color(m.color).getHexString(); mm.strokeStyle = '#000'; mm.lineWidth = 2;
      mm.beginPath(); mm.arc(x, y, 8, 0, 7); mm.fill(); mm.stroke();
      mm.fillStyle = '#000'; mm.font = 'bold 11px sans-serif'; mm.textAlign = 'center';
      mm.fillText(m.id === 'race' ? 'R' : m.id === 'delivery' ? 'D' : 'P', x, y + 4);
    }
  }
}

// ============================================================ HUD
function showMsg(text, color) { const m = $('msg'); m.textContent = text; m.style.color = color; m.style.opacity = 1; setTimeout(() => m.style.opacity = 0, 3500); }
let toastTimer = 0;
function toast(t) { const m = $('toast'); m.textContent = t; m.style.opacity = 1; clearTimeout(toastTimer); toastTimer = setTimeout(() => m.style.opacity = 0, 1800); }
function flashRed() { $('hud').animate([{ boxShadow: 'inset 0 0 120px rgba(255,0,0,.7)' }, { boxShadow: 'inset 0 0 0 rgba(255,0,0,0)' }], 400); }
const starEls = [...document.querySelectorAll('#stars span')];
function updateHUD() {
  $('money').textContent = '$' + String(Math.floor(state.money)).padStart(8, '0');
  starEls.forEach((e, k) => e.classList.toggle('on', k < state.stars));
  $('stars').classList.toggle('flash', state.stars > 0 && state.evade > 2);
  $('hp').firstElementChild.style.width = clamp(state.health, 0, 100) + '%';
  const c = player.car;
  if (c) {
    $('carhp').firstElementChild.style.width = clamp(c.health, 0, 100) + '%';
    document.querySelector('#vehicle .name').textContent = c.name;
    document.querySelector('#vehicle .speed').textContent = Math.round(Math.abs(c.speed) * 3.6) + ' km/h';
  } else { document.querySelector('#vehicle .name').textContent = ''; document.querySelector('#vehicle .speed').textContent = ''; }
  $('crosshair').style.display = !c && state.locked && !state.dead ? 'block' : 'none';
  $('weapon').style.visibility = c ? 'hidden' : 'visible';
}
const mm = $('minimap').getContext('2d');
function drawMinimap(time) {
  const W = 230, sc = 0.62;
  mm.save();
  mm.fillStyle = '#3c4a3a'; mm.fillRect(0, 0, W, W);
  mm.translate(W / 2, W / 2);
  mm.rotate(player.camYaw + Math.PI);
  mm.scale(sc, sc);
  mm.translate(-player.pos.x, -player.pos.z);
  mm.fillStyle = '#55585e';
  mm.fillRect(-HALF - ROAD / 2, -HALF - ROAD / 2, 2 * HALF + ROAD, 2 * HALF + ROAD);
  for (let i = 0; i < NB; i++) for (let j = 0; j < NB; j++) {
    mm.fillStyle = isPark(i, j) ? '#4f7a45' : '#8d8f94';
    mm.fillRect(blockC(i) - BLOCK / 2, blockC(j) - BLOCK / 2, BLOCK, BLOCK);
  }
  mm.fillStyle = '#5d6270';
  for (const b of buildings) mm.fillRect(b.x0, b.z0, b.x1 - b.x0, b.z1 - b.z0);
  mm.fillStyle = '#5cff6a';
  for (const p of pickups) if (p.t <= 0) mm.fillRect(p.m.position.x - 2, p.m.position.z - 2, 4, 4);
  for (const c of cars) {
    if (c === player.car) continue;
    if (c.police && c.driver && !c.wrecked) mm.fillStyle = Math.sin(time * 12) > 0 ? '#ff3030' : '#3060ff';
    else continue;
    mm.beginPath(); mm.arc(c.pos.x, c.pos.z, 4, 0, 7); mm.fill();
  }
  mm.restore();
  drawMissionBlips(time);
  // player arrow
  mm.save(); mm.translate(W / 2, W / 2);
  const hd = player.car ? player.car.heading : player.heading;
  mm.rotate(-(hd - player.camYaw));
  mm.fillStyle = '#fff'; mm.strokeStyle = '#000'; mm.lineWidth = 2;
  mm.beginPath(); mm.moveTo(0, -9); mm.lineTo(6, 7); mm.lineTo(0, 3); mm.lineTo(-6, 7); mm.closePath(); mm.stroke(); mm.fill();
  mm.restore();
  // north marker
  mm.fillStyle = '#fff'; mm.font = 'bold 13px sans-serif'; mm.textAlign = 'center';
  mm.fillText('N', W / 2 - Math.sin(player.camYaw) * 100, W / 2 + Math.cos(player.camYaw) * 100 + 4);
}

// ============================================================ input
const keys = new Set();
addEventListener('keydown', e => {
  if (e.repeat) return;
  keys.add(e.code);
  if (e.code === 'KeyF') enterExit();
  if (e.code === 'KeyN') toggleTime();
  if (e.code === 'KeyH') { state.helpOn = !state.helpOn; $('help').style.display = state.helpOn ? '' : 'none'; }
  if (e.code === 'KeyE') sfx.horn(true);
  if (e.code === 'Space') e.preventDefault();
});
addEventListener('keyup', e => { keys.delete(e.code); if (e.code === 'KeyE') sfx.horn(false); });
renderer.domElement.addEventListener('mousedown', e => {
  sfx.init();
  if (!state.locked) { renderer.domElement.requestPointerLock(); return; }
  if (e.button === 0) shoot();
});
document.addEventListener('pointerlockchange', () => {
  state.locked = document.pointerLockElement === renderer.domElement;
  $('clickToPlay').style.display = state.locked ? 'none' : '';
});
document.addEventListener('mousemove', e => {
  if (!state.locked) return;
  player.camYaw -= e.movementX * 0.0024;
  player.camPitch = clamp(player.camPitch - e.movementY * 0.0022, -1.1, 0.55);
  player.lastMouse = state.time;
});

// ============================================================ camera
const camTarget = new THREE.Vector3();
function updateCamera(dt) {
  const c = player.car;
  let dist, th;
  if (c) {
    dist = c.truck ? 13 : 9.5; th = c.truck ? 3.2 : 1.9;
    camTarget.lerp(new THREE.Vector3(c.pos.x, th, c.pos.z), 1 - Math.exp(-dt * 14));
    if (state.time - player.lastMouse > 1.4 && Math.abs(c.speed) > 1) {
      const want = c.speed >= 0 ? c.heading : c.heading + Math.PI;
      player.camYaw += wrapA(want - player.camYaw) * Math.min(1, dt * 2.6);
      player.camPitch += (-0.2 - player.camPitch) * Math.min(1, dt * 2);
    }
  } else {
    dist = 4.6; th = 1.55;
    camTarget.lerp(new THREE.Vector3(player.pos.x, player.pos.y + th, player.pos.z), 1 - Math.exp(-dt * 18));
  }
  const cp = Math.cos(player.camPitch), sp = Math.sin(player.camPitch);
  const dir = new THREE.Vector3(Math.sin(player.camYaw) * cp, sp, Math.cos(player.camYaw) * cp);
  // over-the-shoulder offset on foot
  const side = c ? 0 : 0.55;
  const base = camTarget.clone().add(new THREE.Vector3(-Math.cos(player.camYaw) * side, 0, Math.sin(player.camYaw) * side));
  // pull the camera in front of walls
  let d = dist;
  for (let t = 0.4; t <= dist; t += 0.3) {
    const q = base.clone().addScaledVector(dir, -t);
    let blocked = q.y < 0.3;
    for (const b of nearBuildings(q.x, q.z)) if (q.x > b.x0 - 0.3 && q.x < b.x1 + 0.3 && q.z > b.z0 - 0.3 && q.z < b.z1 + 0.3 && q.y < b.h + 0.5) { blocked = true; break; }
    if (blocked) { d = Math.max(0.6, t - 0.3); break; }
  }
  camera.position.copy(base).addScaledVector(dir, -d);
  camera.position.y = Math.max(camera.position.y, 0.4);
  camera.lookAt(base.clone().addScaledVector(dir, 10));
  const fovT = c ? 65 + Math.min(14, Math.abs(c.speed) * 0.35) : 65;
  camera.fov += (fovT - camera.fov) * Math.min(1, dt * 3); camera.updateProjectionMatrix();
}

// ============================================================ lights following the player
const tmpV = new THREE.Vector3();
function updateLights() {
  const p = player.pos;
  sun.position.set(p.x + 120, 160, p.z + 90); sun.target.position.set(p.x, 0, p.z);
  if (state.night) {
    sun.position.set(p.x - 60, 120, p.z - 120);
    // nearest street lamps get real point lights (constant light count: no shader recompiles)
    const near = streetLamps.map(l => [l, (l.x - p.x) ** 2 + (l.z - p.z) ** 2]).sort((a, b) => a[1] - b[1]).slice(0, STREET_PL);
    near.forEach(([l], k) => { streetPLs[k].position.copy(l).setY(6.8); streetPLs[k].intensity = 22; });
  } else streetPLs.forEach(l => l.intensity = 0);
  const c = player.car;
  if (c && state.night && !c.wrecked) {
    const fx = Math.sin(c.heading), fz = Math.cos(c.heading);
    headSpot.position.set(c.pos.x + fx * (c.hl + 0.1), c.truck ? 1.1 : 0.9, c.pos.z + fz * (c.hl + 0.1));
    headSpot.target.position.set(c.pos.x + fx * 25, 0, c.pos.z + fz * 25);
    headSpot.intensity = 260;
  } else headSpot.intensity = 0;
}

// ============================================================ traffic management
const TRAFFIC = 34, PEDS = 70;
function manageTraffic() {
  const ai = cars.filter(c => c.type === 'ai');
  for (const c of cars.slice()) {
    if (c === player.car) continue;
    const d = c.pos.distanceTo(player.pos);
    if ((c.type === 'ai' || c.type === 'loose') && !c.police && d > 330) removeCar(c);
    else if (c.wrecked && d > 160) removeCar(c);
  }
  if (ai.length < TRAFFIC && Math.random() < 0.15) { const [i, j, d] = randomEdge(90, 300, player.pos); spawnTrafficCar(i, j, d); }
}

// ============================================================ main loop
let lastT = performance.now(), frame = 0, fpsAcc = 0, fpsN = 0;
function loop() {
  requestAnimationFrame(loop);
  const now = performance.now();
  const dt = Math.min(0.05, (now - lastT) / 1000); lastT = now;
  update(dt);
  composer.render();
}
function update(dt) {
  const now = performance.now();
  state.time += dt; frame++;
  fpsAcc += now - (window.__lastNow || now); window.__lastNow = now; if (++fpsN === 60) { window.__game.fps = Math.round(60000 / fpsAcc); fpsAcc = 0; fpsN = 0; }
  const t = state.time;

  if (!state.dead) { if (player.car) updatePlayerCar(dt); else updatePlayerFoot(dt); }
  player.shootCD -= dt;

  for (const c of cars) {
    if (c === player.car) continue;
    if (c.type === 'ai') aiDrive(c, dt);
    else if (c.type === 'police' && c.driver && !c.wrecked) policeAI(c, dt);
    else carPhysics(c, 0, 0, true, dt);
  }
  for (const c of cars) if (c.type !== 'ai') collideCarWorld(c);
  collideCars();
  for (const c of cars) {
    c.g.position.set(c.pos.x, groundH(c.pos.x, c.pos.z) * 0.6, c.pos.z);
    c.g.rotation.y = c.heading;
    if (c.barR) { const on = state.stars > 0 && c.driver && !c.wrecked; const ph = Math.sin(t * 14) > 0; c.barR.visible = on ? ph : true; c.barB.visible = on ? !ph : true; c.barR.material = on ? sirenRed : stdMat(0x551111); c.barB.material = on ? sirenBlue : stdMat(0x111155); }
    if (c.wrecked || c.health < 35) { if (frame % 3 === 0) fx.smoke(c.pos.clone().setY(1.4).add(new THREE.Vector3(Math.sin(c.heading) * 1.6, 0, Math.cos(c.heading) * 1.6)), c.wrecked || c.health < 15); }
    if (!c.wrecked && c.health < 15 && c.health > 0) { c.burnT += dt; if (c.burnT > 6) explodeCar(c); }
  }
  if (player.car) player.pos.copy(player.car.pos);

  for (const p of peds.slice()) updatePed(p, dt);
  if (peds.length < PEDS) spawnPedNear(player.pos, 50, 250);

  updateWanted(dt);
  if (frame % 10 === 0) { manageTraffic(); managePolice(); }
  updatePickups(dt, t);
  updateMissions(dt, t);
  for (const tr of tracers.slice()) { tr.t -= dt; if (tr.t <= 0) { scene.remove(tr.line); tr.line.geometry.dispose(); tracers.splice(tracers.indexOf(tr), 1); } }
  fx.update(dt);
  sfx.update(t);

  updateCamera(dt);
  updateLights();
  updateHUD();
  if (frame % 2 === 0) drawMinimap(t);
}

// ============================================================ boot
async function boot() {
  progress(0.02, 'loading textures…');
  await initMaterials();
  state.night = true;
  progress(0.06, 'laying roads…');
  makeGround();
  await afterPaint();
  await buildCity();
  makeStreetLights();
  makeTrees();
  applyTime();
  setupProbes();
  progress(0.7, 'baking reflection probes…');
  await afterPaint();
  await bakeAllProbes(f => progress(0.7 + 0.25 * f, `baking reflection probes… ${(f * 100) | 0}%`));
  progress(0.97, 'spawning people…');
  initPlayer();
  for (let k = 0; k < TRAFFIC; k++) { const [i, j, d] = randomEdge(); spawnTrafficCar(i, j, d); }
  for (let k = 0; k < PEDS; k++) spawnPed(Math.floor(Math.random() * NB), Math.floor(Math.random() * NB), Math.random() * 1000);
  makePickups();
  initMissions();
  applyTime();
  progress(1, 'ready');
  await afterPaint();
  lastT = performance.now();
  loop();
  // keep the title screen up until the player clicks
  $('loadbar').style.display = 'none'; $('loadtxt').style.display = 'none';
  $('start').style.display = 'block';
  $('loading').style.cursor = 'pointer';
  $('loading').addEventListener('click', () => {
    sfx.init();
    renderer.domElement.requestPointerLock();
    $('loading').style.opacity = 0; $('loading').style.pointerEvents = 'none';
    setTimeout(() => $('loading').remove(), 700);
  }, { once: true });
}
// title art behind the loading bar if present
fetch('assets/title.png', { method: 'HEAD' }).then(r => { if (r.ok) $('loading').style.backgroundImage = 'url(assets/title.png)'; }).catch(() => {});
boot();
window.__game = { state, player, cars, peds, buildings, camera, scene, renderer, update, keys, shoot, enterExit, MISSIONS, mission };
