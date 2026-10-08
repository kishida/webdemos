// ワールド構築: 地形・水面・空港・市街地・道路・高速道路・橋・塔・港・木・雲
import * as THREE from 'three';
import { GeoBuilder, addGeometry, rng, hash2, fbm, smoothstep, clamp, lerp } from './geo.js';
import {
  terrainHeight, terrainSlope, riverX, coastZ, cellType, cellAt, GRID, RIVER_W, WATER_Y, RWY,
  HIGHWAYS, DOWNTOWN, SKYTREE, LATTICE_TOWER, heightLimit,
} from './layout.js';
import { tex, windowLightsTexture, waterNormalTexture, roadTexture, textTexture, cloudTexture } from './textures.js';
import { LightField, LC } from './lights.js';

const CHUNK = 3000;
// 生成した外壁テクスチャ1枚が表す大きさ（m）と窓の数
const FACADE = {
  facade_office: { tw: 40, th: 48, win: [9, 12] },
  facade_apartment: { tw: 26, th: 33, win: [5, 11] },
  facade_concrete: { tw: 28, th: 28, win: [6, 7] },
};
const FAC_OF = { office: 'facade_office', apart: 'facade_apartment', conc: 'facade_concrete' };
const chunkKey = (x, z) => `${Math.floor(x / CHUNK)},${Math.floor(z / CHUNK)}`;

export class World {
  constructor(scene) {
    this.scene = scene;
    this.root = new THREE.Group(); scene.add(this.root);
    this.colliders = new Map();       // 200m グリッド → AABB 配列
    this.nightMats = [];              // 夜に emissive を点ける材質
    this.lightFields = [];
    this.animated = [];
    this.night = 0;
  }

  build(progress = () => {}) {
    progress('地形を生成中…'); this.buildTerrain();
    progress('水面を生成中…'); this.buildWater();
    progress('空港を建設中…'); this.buildAirport();
    progress('市街地を建設中…'); this.buildCity();
    progress('高速道路を建設中…'); this.buildHighways();
    progress('橋を架けています…'); this.buildBridges();
    progress('塔を建設中…'); this.buildTowers();
    progress('森を植えています…'); this.buildForests();
    progress('雲を浮かべています…'); this.buildClouds();
    for (const lf of this.lightFields) this.root.add(lf.build());
  }

  // ---------- 衝突判定 ----------
  addCollider(x0, z0, x1, z1, y1, y0 = -100) {
    const b = { x0, z0, x1, z1, y0, y1 };
    for (let i = Math.floor(x0 / 200); i <= Math.floor(x1 / 200); i++)
      for (let j = Math.floor(z0 / 200); j <= Math.floor(z1 / 200); j++) {
        const k = i * 1000 + j; if (!this.colliders.has(k)) this.colliders.set(k, []); this.colliders.get(k).push(b);
      }
  }
  collide(x, y, z, r = 2) {
    const list = this.colliders.get(Math.floor(x / 200) * 1000 + Math.floor(z / 200));
    if (!list) return null;
    for (const b of list) if (x > b.x0 - r && x < b.x1 + r && z > b.z0 - r && z < b.z1 + r && y < b.y1 + r && y > b.y0 - r) return b;
    return null;
  }

  // ---------- 地形 ----------
  buildTerrain() {
    const N = this.low ? 360 : 480, S = 21500, A = 0.33, CX = 1500, CZ = 0;
    const map = (u) => S * (A * u + (1 - A) * u * u * u);
    const xs = [], zs = [];
    for (let i = 0; i <= N; i++) { const u = (i / N) * 2 - 1; xs.push(CX + map(u)); zs.push(CZ + map(u)); }
    const cnt = (N + 1) * (N + 1);
    const pos = new Float32Array(cnt * 3), splA = new Float32Array(cnt * 4), splB = new Float32Array(cnt * 2), col = new Float32Array(cnt * 3);
    const hs = new Float32Array(cnt);
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) { const k = j * (N + 1) + i; hs[k] = terrainHeight(xs[i], zs[j]); }
    for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) {
      const k = j * (N + 1) + i, x = xs[i], z = zs[j], h = hs[k];
      pos[k * 3] = x; pos[k * 3 + 1] = h; pos[k * 3 + 2] = z;
      const hx = hs[j * (N + 1) + Math.min(N, i + 1)] - hs[j * (N + 1) + Math.max(0, i - 1)];
      const hz = hs[Math.min(N, j + 1) * (N + 1) + i] - hs[Math.max(0, j - 1) * (N + 1) + i];
      const dx = xs[Math.min(N, i + 1)] - xs[Math.max(0, i - 1)], dz = zs[Math.min(N, j + 1)] - zs[Math.max(0, j - 1)];
      const slope = Math.hypot(hx / dx, hz / dz);
      // 重み
      const cell = cellAt(x, z);
      const urban = !cell || cell === 'park' ? 0 : cell === 'residential' ? 0.55 : 1;
      const coast = coastZ(x);
      const sand = (1 - smoothstep(80, 260, Math.abs(z - coast + 60))) * (1 - smoothstep(4, 10, h));
      const rock = smoothstep(0.45, 0.85, slope) + smoothstep(700, 1100, h + fbm(x / 600, z / 600, 3, 2) * 300);
      const fn = fbm(x / 2200, z / 2200, 4, 9);
      const forest = smoothstep(0.45, 0.6, fn) * smoothstep(8, 40, h) + smoothstep(60, 300, h) * 0.8;
      const dc = Math.hypot(x - 1500, z + 500);
      const farm = smoothstep(2500, 5000, dc) * (1 - smoothstep(30, 110, h)) * smoothstep(0.3, 0.42, 1 - fn);
      let w = [1, farm, forest, rock];
      // 空港は芝生
      if (Math.abs(x) < 900 && Math.abs(z) < 2700) w = [1, 0, 0, 0];
      let ur = urban, sa = sand;
      const sum = w[0] + w[1] + w[2] + w[3];
      const rest = Math.max(0, 1 - ur - sa);
      splA.set([w[0] / sum * rest, w[1] / sum * rest, w[2] / sum * rest, w[3] / sum * rest], k * 4);
      splB.set([ur, Math.min(sa, 1 - ur)], k * 2);
      const tint = 0.88 + 0.24 * fbm(x / 500, z / 500, 3, 4);
      col.set([tint, tint, tint * 0.97], k * 3);
    }
    const idx = new Uint32Array(N * N * 6); let p = 0;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const a = j * (N + 1) + i, b = a + 1, c = a + N + 1, d = c + 1;
      idx[p++] = a; idx[p++] = c; idx[p++] = b; idx[p++] = b; idx[p++] = c; idx[p++] = d;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('splatA', new THREE.BufferAttribute(splA, 4));
    g.setAttribute('splatB', new THREE.BufferAttribute(splB, 2));
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0, vertexColors: true });
    const T = { tGrass: tex('grass'), tFarm: tex('farmland'), tForest: tex('forest'), tRock: tex('rock'), tUrban: tex('urban'), tSand: tex('sand') };
    mat.onBeforeCompile = (sh) => {
      for (const k in T) sh.uniforms[k] = { value: T[k] };
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute vec4 splatA; attribute vec2 splatB; varying vec4 vSplA; varying vec2 vSplB; varying vec3 vWPos;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSplA = splatA; vSplB = splatB; vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', `#include <common>
          uniform sampler2D tGrass, tFarm, tForest, tRock, tUrban, tSand;
          varying vec4 vSplA; varying vec2 vSplB; varying vec3 vWPos;
          vec3 smp(sampler2D t, vec2 p, float s){ return mix(texture2D(t, p / s).rgb, texture2D(t, p / (s * 3.7) + 0.37).rgb, 0.45); }`)
        .replace('#include <map_fragment>', `
          vec2 wp = vWPos.xz;
          vec3 c = vec3(0.0);
          if (vSplA.x > 0.01) { vec3 gr = smp(tGrass, wp, 26.0); gr = mix(vec3(dot(gr, vec3(0.3, 0.59, 0.11))), gr, 0.5) * vec3(0.72, 0.78, 0.55); c += gr * vSplA.x; }
          if (vSplA.y > 0.01) c += texture2D(tFarm, wp / 700.0).rgb * vSplA.y;
          if (vSplA.z > 0.01) c += smp(tForest, wp, 90.0) * vec3(0.8, 0.85, 0.8) * vSplA.z;
          if (vSplA.w > 0.01) c += smp(tRock, wp, 160.0) * vSplA.w;
          if (vSplB.x > 0.01) c += smp(tUrban, wp, 24.0) * vec3(0.42, 0.42, 0.41) * vSplB.x;
          if (vSplB.y > 0.01) c += smp(tSand, wp, 30.0) * vSplB.y;
          float macro = texture2D(tGrass, wp / 3100.0).g;
          c *= 0.8 + 0.5 * macro;
          diffuseColor.rgb *= c;`);
    };
    const mesh = new THREE.Mesh(g, mat); mesh.receiveShadow = true;
    this.root.add(mesh); this.terrain = mesh;
  }

  buildWater() {
    const nt = waterNormalTexture(); nt.repeat.set(900, 900);
    const mat = new THREE.MeshStandardMaterial({ color: 0x1e4a5c, roughness: 0.06, metalness: 0.15, normalMap: nt, normalScale: new THREE.Vector2(0.35, 0.35) });
    const g = new THREE.PlaneGeometry(90000, 90000); g.rotateX(-Math.PI / 2);
    const w = new THREE.Mesh(g, mat); w.position.set(1500, WATER_Y, 0); w.receiveShadow = true;
    this.root.add(w); this.water = w; this.waterNormal = nt;
    this.animated.push((dt, t) => { nt.offset.set(t * 0.004, t * 0.0025); });
  }

  // ---------- 空港 ----------
  buildAirport() {
    const g = new THREE.Group(); this.root.add(g); this.airport = g;
    const asph = tex('asphalt'), conc = tex('concrete');
    const rwyMat = new THREE.MeshStandardMaterial({ map: asph.clone(), roughness: 0.9, color: 0x9a9a9a });
    rwyMat.map.repeat.set(2, 150); rwyMat.map.needsUpdate = true;
    const flat = (w, l, mat, x, y, z, rot = 0) => {
      const geo = new THREE.PlaneGeometry(w, l); geo.rotateX(-Math.PI / 2); if (rot) geo.rotateY(rot);
      const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.receiveShadow = true; g.add(m); return m;
    };
    // 滑走路・ショルダー
    const shMat = new THREE.MeshStandardMaterial({ map: asph, color: 0xb8b4a8, roughness: 0.95 });
    flat(RWY.width + 16, RWY.length + 120, shMat, 0, 0.1, 0);
    flat(RWY.width, RWY.length, rwyMat, 0, 0.16, 0);
    // 誘導路・エプロン
    const twMat = new THREE.MeshStandardMaterial({ map: asph, color: 0xaaaaaa, roughness: 0.9 });
    const conMat = new THREE.MeshStandardMaterial({ map: conc, color: 0x8e8d88, roughness: 0.85 });
    flat(23, 3000, twMat, 200, 0.13, 0);
    for (const z of [-1490, -520, 480, 1490]) flat(200, 23, twMat, 100, 0.14, z);
    const apron = flat(380, 1350, conMat, 450, 0.12, -250);
    apron.material.map = conc.clone(); apron.material.map.repeat.set(19, 67);
    // 白・黄色のマーキング
    const white = new GeoBuilder(), yellow = new GeoBuilder();
    const rect = (gb, cx, cz, w, l, y = 0.2) => gb.quad([cx - w / 2, y, cz + l / 2], [cx + w / 2, y, cz + l / 2], [cx + w / 2, y, cz - l / 2], [cx - w / 2, y, cz - l / 2]);
    for (const s of [1, -1]) {              // s=1: 南端（RWY36 進入）、s=-1: 北端（RWY18）
      const zT = s * RWY.length / 2, d = -s;   // d: 着陸方向
      const at = (dist) => zT + d * dist;
      for (let k = 0; k < 8; k++) for (const side of [-1, 1]) rect(white, side * (3.5 + k * 2.4), at(6 + 15), 1.8, 30);
      for (const [dist, n] of [[150, 3], [300, 3], [600, 2], [750, 2], [900, 1]]) for (let k = 0; k < n; k++) for (const side of [-1, 1]) rect(white, side * (5 + k * 3), at(dist + 11), 1.8, 22.5);
      for (const side of [-1, 1]) rect(white, side * 13, at(400 + 30), 10, 60);
      // 滑走路番号
      const num = s === 1 ? '36' : '18';
      const nm = new THREE.Mesh(new THREE.PlaneGeometry(16, 24), new THREE.MeshStandardMaterial({ map: textTexture(num, { w: 256, h: 384, font: 'bold 300px Arial Narrow, sans-serif' }), transparent: true, roughness: 0.8 }));
      nm.rotation.x = -Math.PI / 2; if (s === -1) nm.rotation.z = Math.PI; nm.position.set(0, 0.21, at(65)); g.add(nm);
    }
    for (let z = -RWY.length / 2 + 90; z < RWY.length / 2 - 90; z += 50) rect(white, 0, z + 15, 0.9, 30);
    for (const side of [-1, 1]) rect(white, side * (RWY.width / 2 - 0.6), 0, 0.9, RWY.length);
    // 誘導路センターライン
    rect(yellow, 200, 0, 0.5, 3000, 0.18);
    for (const z of [-1490, -520, 480, 1490]) rect(yellow, 110, z, 180, 0.5, 0.19);
    rect(yellow, 300, -250, 0.5, 1300, 0.19);
    for (let i = 0; i < 6; i++) { const z = -800 + i * 200; rect(yellow, 450, z, 300, 0.45, 0.19); rect(yellow, 548, z, 0.45, 10, 0.19); }
    for (const z of [760, 920]) rect(yellow, 330, z, 160, 0.45, 0.19);
    const wm = new THREE.Mesh(white.build(), new THREE.MeshStandardMaterial({ color: 0xf2f2ec, roughness: 0.7 })); wm.receiveShadow = true; g.add(wm);
    const ym = new THREE.Mesh(yellow.build(), new THREE.MeshStandardMaterial({ color: 0xe8c030, roughness: 0.7 })); g.add(ym);

    // ターミナルビル
    const fac = new GeoBuilder(), roof = new GeoBuilder();
    fac.box(650, 0, -900, 740, 24, 380, { tw: 40, th: 48, roof });
    fac.box(600, 0, -880, 650, 10, 360, { tw: 40, th: 48, roof });
    for (let i = 0; i < 6; i++) { const z = -800 + i * 200; fac.box(560, 3, z - 3, 600, 8, z + 3, { tw: 40, th: 48, roof }); }
    fac.box(560, 0, 520, 600, 18, 580, { tw: 40, th: 48, roof }); // 管制塔の基部
    this.addCollider(600, -900, 740, 380, 24);
    const officeMat = this.facadeMaterial('facade_office', 0xc8d4e0, 21);
    g.add(this.meshShadow(fac.build(), officeMat));
    g.add(this.meshShadow(roof.build(), this.roofMaterial()));
    // 管制塔
    const tw = new THREE.Group(); tw.position.set(580, 0, 550); g.add(tw);
    const concM = new THREE.MeshStandardMaterial({ color: 0xd6d3cc, roughness: 0.8 });
    const shaft = new THREE.Mesh(new THREE.CylinderGeometry(4, 5.5, 62, 16), concM); shaft.position.y = 31; tw.add(shaft);
    const cab = new THREE.Mesh(new THREE.CylinderGeometry(10, 8, 7, 8), new THREE.MeshStandardMaterial({ color: 0x223040, roughness: 0.1, metalness: 0.6, emissive: 0x334455, emissiveIntensity: 0 }));
    cab.position.y = 66; tw.add(cab); this.nightMats.push({ m: cab.material, i: 0.8 });
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(11, 11, 1.5, 8), concM); cap.position.y = 70.2; tw.add(cap);
    const deck = new THREE.Mesh(new THREE.CylinderGeometry(9, 9, 2, 8), concM); deck.position.y = 61.5; tw.add(deck);
    const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.3, 12, 6), concM); ant.position.y = 77; tw.add(ant);
    tw.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    this.addCollider(570, 540, 590, 560, 83);
    this.towerCamPos = new THREE.Vector3(580, 67, 550);
    // 格納庫（かまぼこ屋根）
    const hangMat = new THREE.MeshStandardMaterial({ color: 0xc0c6cc, roughness: 0.6, metalness: 0.4 });
    for (const z of [760, 920]) {
      const hg = new THREE.Group(); hg.position.set(470, 0, z); g.add(hg);
      const body = new THREE.Mesh(new THREE.CylinderGeometry(40, 40, 110, 24, 1, false, 0, Math.PI), hangMat);
      body.rotation.z = Math.PI / 2; body.rotation.y = Math.PI / 2; body.scale.set(1, 1, 0.45); body.position.y = 8; hg.add(body);
      const wall = new THREE.Mesh(new THREE.BoxGeometry(110, 8, 80), hangMat); wall.position.y = 4; hg.add(wall);
      const door = new THREE.Mesh(new THREE.PlaneGeometry(76, 22), new THREE.MeshStandardMaterial({ color: 0x3a4048 })); door.rotation.y = -Math.PI / 2; door.position.set(-55.2, 11, 0); hg.add(door);
      hg.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
      this.addCollider(415, z - 40, 525, z + 40, 26);
    }
    // 燃料タンク
    const tankMat = new THREE.MeshStandardMaterial({ color: 0xeeeeee, roughness: 0.4, metalness: 0.3 });
    for (let i = 0; i < 4; i++) {
      const t = new THREE.Mesh(new THREE.CylinderGeometry(14, 14, 16, 24), tankMat); t.position.set(800 + (i % 2) * 40, 8, 1250 + Math.floor(i / 2) * 40);
      t.castShadow = true; g.add(t); this.addCollider(786 + (i % 2) * 40, 1236 + Math.floor(i / 2) * 40, 814 + (i % 2) * 40, 1264 + Math.floor(i / 2) * 40, 16);
    }
    // 吹き流し
    this.windsocks = [];
    for (const [x, z] of [[-60, 1150], [60, -1150]]) {
      const ws = new THREE.Group(); ws.position.set(x, 0, z); g.add(ws);
      const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.15, 7, 6), concM); pole.position.y = 3.5; ws.add(pole);
      const sock = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.35, 4, 12, 1, true), new THREE.MeshStandardMaterial({ color: 0xff6a1a, side: THREE.DoubleSide }));
      sock.geometry.rotateX(Math.PI / 2); sock.geometry.translate(0, 0, -2); sock.position.y = 6.8;
      const piv = new THREE.Group(); piv.position.y = 0; piv.add(sock); ws.add(piv); this.windsocks.push(piv);
    }
    this.buildAirportLights();
  }

  buildAirportLights() {
    const L = new LightField({ minPx: 1.6, intensityDay: 0.35, intensityNight: 1.2 }); this.lightFields.push(L);
    const half = RWY.length / 2, hw = RWY.width / 2 + 1.5;
    for (let z = -half; z <= half; z += 60) for (const s of [-1, 1]) L.add(s * hw, 0.6, z, Math.abs(z) > half - 600 ? LC.yellow : LC.white, 1.4);
    for (let z = -half + 15; z < half; z += 15) {
      const de = half - Math.abs(z);
      L.add(0, 0.3, z, de < 300 ? LC.red : de < 900 && Math.floor(z / 15) % 2 ? LC.red : LC.white, 0.9);
    }
    for (let x = -hw; x <= hw; x += 3) { L.add(x, 0.5, half + 2, LC.green, 1.3); L.add(x, 0.5, -half - 2, LC.green, 1.3); L.add(x, 0.5, half - 2, LC.red, 1.1); L.add(x, 0.5, -half + 2, LC.red, 1.1); }
    // 進入灯（両端）とシーケンスフラッシャー
    for (const s of [1, -1]) {
      for (let d = 30; d <= 900; d += 30) {
        const z = s * (half + d), y = d * 0.004 + 0.8;
        for (let k = -2; k <= 2; k++) L.add(k * 1.2, y, z, LC.white, 1.4);
        if (d === 300) for (let k = -12; k <= 12; k++) if (Math.abs(k) > 2) L.add(k * 1.5, y, z, LC.white, 1.4);
        if (d >= 300) L.add(0, y + 0.6, z, [2.5, 2.5, 2.8], 2.4, 3, (900 - d) / 900 * 0.5);
      }
    }
    // 誘導路の青灯
    for (let z = -1500; z <= 1500; z += 50) for (const x of [187, 213]) L.add(x, 0.4, z, LC.blue, 1.0);
    // エプロン照明
    for (let z = -880; z <= 380; z += 120) L.add(630, 25, z, LC.sodium, 6);
    // PAPI
    const P = new LightField({ minPx: 2.2, intensityDay: 1.0, intensityNight: 1.3 }); this.lightFields.push(P);
    this.papi = [];
    for (const s of [1, -1]) {
      const zT = s * half, z = zT - s * 330, xs = -s * (RWY.width / 2 + 15);
      const unit = { x: xs, z, y: 0.8, idx: [] };
      for (let k = 0; k < 4; k++) unit.idx.push(P.add(xs - s * k * 9, 0.8, z, LC.white, 2.6));
      this.papi.push(unit);
    }
    this.papiField = P;
  }

  updatePAPI(eye) {
    const th = [3.5, 3.17, 2.83, 2.5];
    for (const u of this.papi) {
      const ang = Math.atan2(eye.y - u.y, Math.hypot(eye.x - u.x, eye.z - u.z)) * 180 / Math.PI;
      u.idx.forEach((i, k) => this.papiField.setColor(i, ang > th[k] ? [2.2, 2.1, 2.0] : [2.4, 0.25, 0.15]));
    }
  }

  // ---------- 材質 ----------
  facadeMaterial(name, color, seed) {
    const [nx, ny] = FACADE[name].win;
    const em = windowLightsTexture(nx, ny, seed, true);
    const m = new THREE.MeshStandardMaterial({ map: tex(name), color, roughness: name === 'facade_office' ? 0.25 : 0.75, metalness: name === 'facade_office' ? 0.35 : 0.05, vertexColors: true, emissiveMap: em, emissive: 0xffffff, emissiveIntensity: 0 });
    this.nightMats.push({ m, i: 1.4 });
    return m;
  }
  roofMaterial() { return this._roof ||= new THREE.MeshStandardMaterial({ map: tex('concrete'), color: 0x9a9a98, roughness: 0.9, vertexColors: true }); }
  meshShadow(geo, mat, cast = true) { const m = new THREE.Mesh(geo, mat); m.castShadow = cast; m.receiveShadow = true; return m; }

  // ---------- 市街地 ----------
  buildCity() {
    const chunks = new Map();
    const C = (x, z) => { const k = chunkKey(x, z); if (!chunks.has(k)) chunks.set(k, { office: new GeoBuilder(), apart: new GeoBuilder(), conc: new GeoBuilder(), roof: new GeoBuilder(), wall: new GeoBuilder(), house: new GeoBuilder(), ind: new GeoBuilder(), road: new GeoBuilder(), ave: new GeoBuilder(), trees: [], conifers: [] }); return chunks.get(k); };
    const city = new LightField({ minPx: 1.2, intensityDay: 0, intensityNight: 1.0 }); this.lightFields.push(city);
    const obst = new LightField({ minPx: 1.8, intensityDay: 0.5, intensityNight: 1.2 }); this.lightFields.push(obst);
    this.containers = [];
    const roadSeg = new Set();
    const R = rng(12345);
    const roofCols = [[0.32, 0.33, 0.36], [0.25, 0.3, 0.42], [0.45, 0.28, 0.2], [0.55, 0.32, 0.22], [0.3, 0.38, 0.3], [0.5, 0.5, 0.5], [0.22, 0.22, 0.24]];
    const wallCols = [[0.95, 0.93, 0.88], [0.88, 0.84, 0.76], [0.8, 0.8, 0.8], [0.92, 0.88, 0.8], [0.75, 0.72, 0.68], [0.9, 0.9, 0.92]];
    const indCols = [[0.75, 0.8, 0.85], [0.85, 0.82, 0.75], [0.6, 0.68, 0.75], [0.8, 0.8, 0.8], [0.7, 0.75, 0.68]];
    let craneCount = 0;
    const portCells = [];

    for (let i = -52; i <= 62; i++) for (let j = -46; j <= 50; j++) {
      const type = cellType(i, j); if (!type) continue;
      const x0 = i * GRID, z0 = j * GRID, cx = x0 + GRID / 2, cz = z0 + GRID / 2;
      const ch = C(cx, cz);
      // 道路（区画の4辺）
      for (const [k, gb, horiz, a, b] of [[`h${i},${j}`, 0, true, x0, z0], [`h${i},${j + 1}`, 0, true, x0, z0 + GRID], [`v${i},${j}`, 0, false, x0, z0], [`v${i + 1},${j}`, 0, false, x0 + GRID, z0]]) {
        if (roadSeg.has(k)) continue; roadSeg.add(k);
        const line = horiz ? Math.round(b / GRID) : Math.round(a / GRID);
        const avenue = line % 4 === 0, w = avenue ? 24 : 13;
        const target = avenue ? ch.ave : ch.road, y = horiz ? 0.32 : 0.36;
        if (horiz) target.quad([a - w / 2, y, b + w / 2], [a + GRID + w / 2, y, b + w / 2], [a + GRID + w / 2, y, b - w / 2], [a - w / 2, y, b - w / 2], [[0, 0], [0, (GRID + w) / 20], [1, (GRID + w) / 20], [1, 0]]);
        else target.quad([a - w / 2, y, b + GRID + w / 2], [a + w / 2, y, b + GRID + w / 2], [a + w / 2, y, b - w / 2], [a - w / 2, y, b - w / 2], [[0, 0], [1, 0], [1, (GRID + w) / 20], [0, (GRID + w) / 20]]);
        for (let t = 20; t < GRID; t += 40) {
          if (horiz) { city.add(a + t, 8, b + w / 2 + 1, LC.sodium, 4); city.add(a + t + 20, 8, b - w / 2 - 1, LC.sodium, 4); }
          else { city.add(a + w / 2 + 1, 8, b + t, LC.sodium, 4); city.add(a - w / 2 - 1, 8, b + t + 20, LC.sodium, 4); }
        }
        if (avenue && R() < 0.5) for (let t = 10; t < GRID; t += 22) (horiz ? ch.trees.push([a + t, b + w / 2 + 3, 0.7]) : ch.trees.push([a + w / 2 + 3, b + t, 0.7]));
      }
      const bx0 = x0 + 13, bz0 = z0 + 13, bs = GRID - 26;     // 区画の建築可能範囲
      const lim = heightLimit(cx, cz);
      const fac = (r) => (r < 0.4 ? 'office' : r < 0.7 ? 'conc' : 'apart');
      const TINTS = [[1, 1, 1], [0.95, 0.9, 0.82], [0.88, 0.86, 0.84], [0.92, 0.84, 0.74], [0.8, 0.82, 0.86], [0.78, 0.72, 0.66], [1, 0.97, 0.9]];
      const tint = () => { const b = TINTS[Math.floor(R() * TINTS.length)], v = 0.85 + R() * 0.18; return [b[0] * v, b[1] * v, b[2] * v]; };
      const addBld = (gbName, x0_, z0_, x1_, z1_, h, y0 = 0) => {
        const gb = ch[gbName]; const F = FACADE[FAC_OF[gbName]];
        gb.box(x0_, y0, z0_, x1_, y0 + h, z1_, { tw: F.tw, th: F.th, roof: ch.roof, col: tint(), roofCol: [0.8, 0.8, 0.8], uoff: Math.floor(R() * 4) * 0.25 });
        this.addCollider(x0_, z0_, x1_, z1_, y0 + h);
        if (y0 + h > 70) for (const [px, pz] of [[x0_, z0_], [x1_, z1_]]) obst.add(px, y0 + h + 1, pz, LC.red, 3, 2, R());
        // 屋上設備
        if (h > 12 && R() < 0.7) { const ex = x0_ + (x1_ - x0_) * (0.2 + R() * 0.4), ez = z0_ + (z1_ - z0_) * (0.2 + R() * 0.4); ch.roof.box(ex, y0 + h, ez, ex + 4 + R() * 6, y0 + h + 2 + R() * 3, ez + 4 + R() * 6, { roof: ch.roof, col: [0.7, 0.7, 0.7], roofCol: [0.7, 0.7, 0.7] }); }
      };

      if (type === 'downtown') {
        const d = Math.hypot(cx - DOWNTOWN.x, cz - DOWNTOWN.z);
        const hmax = Math.min(lim, 70 + 230 * Math.pow(1 - d / 1000, 0.8));
        const n = R() < 0.4 ? 1 : 2, m = R() < 0.5 ? 1 : 2;
        const lw = bs / n, ld = bs / m;
        for (let a = 0; a < n; a++) for (let b = 0; b < m; b++) {
          const lx0 = bx0 + a * lw + 4, lz0 = bz0 + b * ld + 4, lx1 = lx0 + lw - 8, lz1 = lz0 + ld - 8;
          const h = hmax * (0.35 + R() * 0.65);
          const kind = R() < 0.6 ? 'office' : fac(R());
          if (h > 60 && R() < 0.6) {
            // 低層部 + 高層タワー + セットバック
            addBld('conc', lx0, lz0, lx1, lz1, 12 + Math.floor(R() * 3) * 4);
            const sx = (lx1 - lx0) * (0.15 + R() * 0.12), sz = (lz1 - lz0) * (0.15 + R() * 0.12);
            const h1 = h * (0.7 + R() * 0.15);
            addBld(kind, lx0 + sx, lz0 + sz, lx1 - sx, lz1 - sz, h1 - 16, 16);
            const s2 = 0.18 * (lx1 - lx0);
            addBld(kind, lx0 + sx + s2, lz0 + sz + s2, lx1 - sx - s2, lz1 - sz - s2, h - h1, h1);
          } else addBld(kind, lx0, lz0, lx1, lz1, Math.max(14, h));
        }
      } else if (type === 'midrise') {
        const n = 3, lw = bs / n;
        for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
          if (R() < 0.12) continue;
          const lx0 = bx0 + a * lw + 2 + R() * 4, lz0 = bz0 + b * lw + 2 + R() * 4;
          const w = lw - 6 - R() * 10, dd = lw - 6 - R() * 10;
          addBld(fac(R()), lx0, lz0, lx0 + w, lz0 + dd, Math.min(lim, 12 + Math.floor(R() * R() * 14) * 4));
        }
        if (R() < 0.5) ch.trees.push([cx + (R() - 0.5) * 60, cz + (R() - 0.5) * 60, 0.8]);
      } else if (type === 'residential') {
        const n = 5, lw = bs / n;
        if (R() < 0.12) { // 団地・マンション
          for (let b = 0; b < 2; b++) addBld('apart', bx0 + 8, bz0 + 10 + b * 65, bx0 + bs - 8, bz0 + 10 + b * 65 + 16, Math.min(lim, 15 + Math.floor(R() * 4) * 3));
        } else for (let a = 0; a < n; a++) for (let b = 0; b < n; b++) {
          if (R() < 0.06) continue;
          const w = 9 + R() * 5, dd = 8 + R() * 5;
          const hx = bx0 + a * lw + (lw - w) / 2 + (R() - 0.5) * 4, hz = bz0 + b * lw + (lw - dd) / 2 + (R() - 0.5) * 4;
          this.house(ch.wall, ch.house, hx, hz, w, dd, R() < 0.25 ? 3 : 6, wallCols[Math.floor(R() * wallCols.length)], roofCols[Math.floor(R() * roofCols.length)], R() < 0.5);
          if (R() < 0.3) ch.trees.push([hx + w + 1.5 + R() * 2, hz + R() * dd, 0.45 + R() * 0.3]);
        }
      } else if (type === 'industrial' || type === 'port') {
        const nW = R() < 0.5 ? 1 : 2;
        for (let k = 0; k < nW; k++) {
          const w = 50 + R() * 70, dd = nW === 1 ? 50 + R() * 60 : 45 + R() * 10;
          const wx = bx0 + R() * (bs - w), wz = bz0 + (nW === 1 ? R() * (bs - dd) : k * 70);
          const h = type === 'port' ? 10 + R() * 8 : 8 + R() * 10;
          ch.ind.box(wx, 0, wz, wx + w, h, wz + dd, { tw: 8, th: 8, roof: ch.roof, col: indCols[Math.floor(R() * indCols.length)], roofCol: [0.85, 0.87, 0.9] });
          this.addCollider(wx, wz, wx + w, wz + dd, h);
        }
        if (type === 'port') portCells.push([cx, cz]);
        if (type === 'industrial' && R() < 0.3) { // タンク
          const tx = bx0 + 20 + R() * 100, tz = bz0 + 20 + R() * 100;
          addGeometry(ch.ind, new THREE.CylinderGeometry(10, 10, 14, 16), new THREE.Matrix4().makeTranslation(tx, 7, tz), [0.9, 0.9, 0.88]);
        }
      } else if (type === 'park') {
        for (let k = 0; k < 40; k++) (R() < 0.3 ? ch.conifers : ch.trees).push([bx0 + R() * bs, bz0 + R() * bs, 0.7 + R() * 0.6]);
      }
    }

    // 港: コンテナとガントリークレーン
    const contCols = [0xc0392b, 0x2e86c1, 0x27ae60, 0xd68910, 0x7d3c98, 0x839192, 0xa04000, 0x1b4f72];
    const contList = [];
    for (const [cx, cz] of portCells) {
      if (R() < 0.5) continue;
      for (let r = 0; r < 5; r++) for (let c = 0; c < 6; c++) {
        const stack = 1 + Math.floor(R() * 4);
        for (let s = 0; s < stack; s++) contList.push([cx - 60 + c * 14, 1.3 + s * 2.6, cz - 50 + r * 6, contCols[Math.floor(R() * contCols.length)]]);
      }
      if (craneCount < 8 && R() < 0.5) {
        const cr = new GeoBuilder(); const col = [0.85, 0.2, 0.15]; const x = cx, z = coastZ(cx) - 290;
        for (const dx of [-8, 8]) for (const dz of [-8, 8]) cr.beam([x + dx, 0, z + dz], [x + dx, 45, z + dz], 1.6, 1.6, col);
        cr.beam([x - 9, 45, z - 9], [x - 9, 45, z + 60], 2, 3, col); cr.beam([x + 9, 45, z - 9], [x + 9, 45, z + 60], 2, 3, col);
        cr.beam([x - 9, 45, z - 9], [x + 9, 45, z - 9], 2, 2, col); cr.beam([x - 9, 45, z + 9], [x + 9, 45, z + 9], 2, 2, col);
        cr.beam([x - 9, 36, z - 30], [x - 9, 36, z + 60], 1.5, 1.5, [0.95, 0.95, 0.95]); cr.beam([x + 9, 36, z - 30], [x + 9, 36, z + 60], 1.5, 1.5, [0.95, 0.95, 0.95]);
        const m = this.meshShadow(cr.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.3 })); this.root.add(m);
        this.addCollider(x - 10, z - 10, x + 10, z + 60, 47);
        obst.add(x, 47, z, LC.red, 3, 2, R());
        craneCount++;
      }
    }
    if (contList.length) {
      const im = new THREE.InstancedMesh(new THREE.BoxGeometry(12, 2.6, 2.5), new THREE.MeshStandardMaterial({ roughness: 0.7, metalness: 0.2 }), contList.length);
      const mtx = new THREE.Matrix4(), cl = new THREE.Color();
      contList.forEach(([x, y, z, c], k) => { mtx.makeTranslation(x, y, z); im.setMatrixAt(k, mtx); im.setColorAt(k, cl.set(c)); });
      im.castShadow = true; im.receiveShadow = true; this.root.add(im);
    }

    // 観覧車（港）
    this.buildFerrisWheel(6300, coastZ(6300) - 420);
    // 船
    this.buildShips();

    // チャンクごとにメッシュ化
    const mats = {
      office: this.facadeMaterial('facade_office', 0xd0dae6, 31),
      apart: this.facadeMaterial('facade_apartment', 0xffffff, 41),
      conc: this.facadeMaterial('facade_concrete', 0xffffff, 51),
      roof: this.roofMaterial(),
      wall: this.houseWallMaterial(),
      house: new THREE.MeshStandardMaterial({ map: tex('roof_tiles'), vertexColors: true, roughness: 0.75 }),
      ind: new THREE.MeshStandardMaterial({ map: tex('concrete'), vertexColors: true, roughness: 0.6, metalness: 0.2 }),
      road: new THREE.MeshStandardMaterial({ map: roadTexture(2, false), roughness: 0.92 }),
      ave: new THREE.MeshStandardMaterial({ map: roadTexture(4, true), roughness: 0.92 }),
    };
    this.treeInstances = { broad: [], conifer: [] };
    for (const ch of chunks.values()) {
      for (const k of ['office', 'apart', 'conc', 'roof', 'wall', 'house', 'ind', 'road', 'ave']) {
        if (ch[k].vc === 0) continue;
        const isRoad = k === 'road' || k === 'ave';
        this.root.add(this.meshShadow(ch[k].build(), mats[k], !isRoad));
      }
      this.treeInstances.broad.push(...ch.trees); this.treeInstances.conifer.push(...ch.conifers);
    }
  }

  houseWallMaterial() {
    const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, 128, 128);
    g.fillStyle = '#e4e2dc'; for (let y = 0; y < 128; y += 8) g.fillRect(0, y, 128, 1);
    g.fillStyle = '#3c4650'; g.fillRect(20, 30, 30, 34); g.fillRect(78, 30, 30, 34); g.fillRect(20, 90, 30, 26); g.fillRect(78, 90, 30, 26);
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
    const e = document.createElement('canvas'); e.width = e.height = 128; const ge = e.getContext('2d');
    ge.fillStyle = '#000'; ge.fillRect(0, 0, 128, 128); ge.fillStyle = '#ffcf8a'; ge.fillRect(20, 30, 30, 34); ge.fillStyle = '#ffd9a0'; ge.fillRect(78, 90, 30, 26);
    const et = new THREE.CanvasTexture(e); et.wrapS = et.wrapT = THREE.RepeatWrapping; et.colorSpace = THREE.SRGBColorSpace;
    const m = new THREE.MeshStandardMaterial({ map: t, vertexColors: true, roughness: 0.9, emissiveMap: et, emissive: 0xffffff, emissiveIntensity: 0 });
    this.nightMats.push({ m, i: 0.9 });
    return m;
  }

  // 切妻屋根の家
  house(wall, roof, x, z, w, d, h, wc, rc, alongX) {
    const rh = 2.6, o = 0.5;
    wall.box(x, 0, z, x + w, h, z + d, { tw: 6, th: 6, roof: null, col: wc });
    if (alongX) { // 棟が X 方向
      const zm = z + d / 2;
      roof.quad([x - o, h - 0.3, z + d + o], [x + w + o, h - 0.3, z + d + o], [x + w + o, h + rh, zm], [x - o, h + rh, zm], [[0, 0], [w / 4, 0], [w / 4, d / 6], [0, d / 6]], rc);
      roof.quad([x + w + o, h - 0.3, z - o], [x - o, h - 0.3, z - o], [x - o, h + rh, zm], [x + w + o, h + rh, zm], [[0, 0], [w / 4, 0], [w / 4, d / 6], [0, d / 6]], rc);
      wall.tri([x, h, z + d], [x, h, z], [x, h + rh, zm], [[0, 0.95], [d / 6, 0.95], [d / 12, 1]], wc);
      wall.tri([x + w, h, z], [x + w, h, z + d], [x + w, h + rh, zm], [[0, 0.95], [d / 6, 0.95], [d / 12, 1]], wc);
    } else {
      const xm = x + w / 2;
      roof.quad([x + w + o, h - 0.3, z + d + o], [x + w + o, h - 0.3, z - o], [xm, h + rh, z - o], [xm, h + rh, z + d + o], [[0, 0], [d / 4, 0], [d / 4, w / 6], [0, w / 6]], rc);
      roof.quad([x - o, h - 0.3, z - o], [x - o, h - 0.3, z + d + o], [xm, h + rh, z + d + o], [xm, h + rh, z - o], [[0, 0], [d / 4, 0], [d / 4, w / 6], [0, w / 6]], rc);
      wall.tri([x, h, z + d], [x + w, h, z + d], [xm, h + rh, z + d], [[0, 0.95], [w / 6, 0.95], [w / 12, 1]], wc);
      wall.tri([x + w, h, z], [x, h, z], [xm, h + rh, z], [[0, 0.95], [w / 6, 0.95], [w / 12, 1]], wc);
    }
    this.addCollider(x, z, x + w, z + d, h + rh);
  }

  buildFerrisWheel(x, z) {
    const g = new THREE.Group(); g.position.set(x, 0, z); this.root.add(g);
    const mat = new THREE.MeshStandardMaterial({ color: 0xf2f2f2, roughness: 0.5, metalness: 0.4 });
    const wheel = new THREE.Group(); wheel.position.y = 62; g.add(wheel);
    for (const dz of [-3, 3]) { const t = new THREE.Mesh(new THREE.TorusGeometry(55, 0.9, 6, 64), mat); t.position.z = dz; wheel.add(t); }
    const sp = new GeoBuilder();
    for (let k = 0; k < 24; k++) { const a = (k / 24) * Math.PI * 2; for (const dz of [-3, 3]) sp.beam([0, 0, dz], [Math.cos(a) * 55, Math.sin(a) * 55, dz], 0.4, 0.4); }
    wheel.add(new THREE.Mesh(sp.build(), mat));
    const gond = new THREE.InstancedMesh(new THREE.BoxGeometry(3, 3.5, 3), new THREE.MeshStandardMaterial({ roughness: 0.5 }), 24);
    const cols = [0xe74c3c, 0x3498db, 0xf1c40f, 0x2ecc71];
    for (let k = 0; k < 24; k++) gond.setColorAt(k, new THREE.Color(cols[k % 4]));
    g.add(gond);
    const legs = new GeoBuilder();
    for (const dz of [-8, 8]) { legs.beam([-25, 0, dz], [0, 62, dz * 0.4], 1.5, 1.5); legs.beam([25, 0, dz], [0, 62, dz * 0.4], 1.5, 1.5); }
    g.add(this.meshShadow(legs.build(), mat));
    this.addCollider(x - 58, z - 8, x + 58, z + 8, 120);
    const fl = new LightField({ minPx: 1.2, intensityDay: 0, intensityNight: 1.0 }); this.lightFields.push(fl);
    for (let k = 0; k < 48; k++) { const a = (k / 48) * Math.PI * 2; fl.add(x + Math.cos(a) * 55, 62 + Math.sin(a) * 55, z + 4, [[1.6, 0.4, 0.8], [0.4, 1.0, 1.8], [1.6, 1.4, 0.4]][k % 3], 4, 0); }
    const m = new THREE.Matrix4();
    this.animated.push((dt, t) => {
      wheel.rotation.z = t * 0.02;
      for (let k = 0; k < 24; k++) { const a = (k / 24) * Math.PI * 2 + t * 0.02; m.makeTranslation(Math.cos(a) * 55, 62 + Math.sin(a) * 55 - 3, 0); gond.setMatrixAt(k, m); }
      gond.instanceMatrix.needsUpdate = true;
    });
  }

  buildShips() {
    const R = rng(77); const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 });
    const ships = [];
    for (let k = 0; k < 9; k++) {
      const gb = new GeoBuilder(); const L = 80 + R() * 160, W = L * 0.15;
      const hull = [[0.6, 0.1, 0.1], [0.15, 0.2, 0.35], [0.2, 0.2, 0.22]][k % 3];
      gb.box(-W / 2, -2, -L / 2, W / 2, 7, L / 2, { col: hull, roof: gb, roofCol: [0.5, 0.45, 0.4] });
      gb.box(-W / 2 + 1, 7, L / 2 - L * 0.18, W / 2 - 1, 7 + L * 0.12, L / 2 - 4, { col: [0.95, 0.95, 0.95], roof: gb, roofCol: [0.9, 0.9, 0.9] });
      if (k % 2 === 0) for (let c = 0; c < 6; c++) gb.box(-W / 2 + 1.5, 7, -L / 2 + 8 + c * (L * 0.1), W / 2 - 1.5, 7 + 2.6 * (1 + (c % 3)), -L / 2 + 8 + c * (L * 0.1) + L * 0.09, { col: [[0.7, 0.2, 0.15], [0.2, 0.4, 0.7], [0.3, 0.6, 0.3]][c % 3] });
      const m = new THREE.Mesh(gb.build(), mat); m.castShadow = true;
      const x = -12000 + R() * 26000; const z = coastZ(x) + 1800 + R() * 6000;
      m.position.set(x, WATER_Y, z); m.rotation.y = R() * Math.PI * 2; this.root.add(m);
      ships.push({ m, v: 3 + R() * 4 });
    }
    this.animated.push((dt) => { for (const s of ships) { s.m.translateZ(-s.v * dt); } });
  }

  // ---------- 高速道路 ----------
  buildHighways() {
    const deckMat = new THREE.MeshStandardMaterial({ map: roadTexture(4, true), roughness: 0.9 });
    const concMat = new THREE.MeshStandardMaterial({ map: tex('concrete'), color: 0xbdbab2, roughness: 0.85 });
    const L = new LightField({ minPx: 1.2, intensityDay: 0, intensityNight: 1.0 }); this.lightFields.push(L);
    this.hwPaths = [];
    for (const hw of HIGHWAYS) {
      const curve = new THREE.CatmullRomCurve3(hw.pts.map(([x, z]) => new THREE.Vector3(x, 0, z)), !!hw.loop, 'centripetal');
      const len = curve.getLength(); const n = Math.ceil(len / 20);
      const pts = curve.getSpacedPoints(n);
      const elev = pts.map((p) => {
        const rd = Math.abs(p.x - riverX(p.z));
        const t = Math.max(0, terrainHeight(p.x, p.z));
        const urban = cellAt(p.x, p.z) || (Math.abs(p.x) < 1200 && Math.abs(p.z) < 3200);
        return (rd < RIVER_W / 2 + 260 ? 32 : urban ? 14 : 0.8) + t * (rd < 600 ? 0 : 1);
      });
      const ys = elev.map((_, k) => { let s = 0, c = 0; for (let q = -10; q <= 10; q++) { const kk = hw.loop ? (k + q + n + 1) % (n + 1) : clamp(k + q, 0, n); s += elev[kk]; c++; } return s / c; });
      pts.forEach((p, k) => { p.y = Math.max(ys[k], Math.max(terrainHeight(p.x, p.z), WATER_Y) + 0.7); });
      const deck = new GeoBuilder(), side = new GeoBuilder();
      const W = 12; const right = [];
      for (let k = 0; k <= n; k++) {
        const a = pts[Math.max(0, k - 1)], b = pts[Math.min(n, k + 1)];
        const t = new THREE.Vector3(b.x - a.x, 0, b.z - a.z).normalize();
        right.push(new THREE.Vector3(-t.z, 0, t.x));
      }
      let v = 0;
      for (let k = 0; k < n; k++) {
        const p = pts[k], q = pts[k + 1], rp = right[k], rq = right[k + 1];
        const seg = p.distanceTo(q);
        const A = (P, R, s, dy = 0) => [P.x + R.x * s, P.y + dy, P.z + R.z * s];
        deck.quad(A(p, rp, -W), A(p, rp, W), A(q, rq, W), A(q, rq, -W), [[0, v], [1, v], [1, v + seg / 24], [0, v + seg / 24]]);
        v += seg / 24;
        // 防護壁と桁の側面
        side.quad(A(p, rp, W), A(p, rp, W, -2.2), A(q, rq, W, -2.2), A(q, rq, W), [[0, 0], [0, 0.2], [seg / 20, 0.2], [seg / 20, 0]]);
        side.quad(A(q, rq, -W), A(q, rq, -W, -2.2), A(p, rp, -W, -2.2), A(p, rp, -W), [[0, 0], [0, 0.2], [seg / 20, 0.2], [seg / 20, 0]]);
        side.quad(A(p, rp, W, 1.1), A(p, rp, W), A(q, rq, W), A(q, rq, W, 1.1), [[0, 0], [0, 0.1], [seg / 20, 0.1], [seg / 20, 0]]);
        side.quad(A(q, rq, -W, 1.1), A(q, rq, -W), A(p, rp, -W), A(p, rp, -W, 1.1), [[0, 0], [0, 0.1], [seg / 20, 0.1], [seg / 20, 0]]);
        side.quad(A(q, rq, W - 0.4, 1.1), A(q, rq, W - 0.4), A(p, rp, W - 0.4), A(p, rp, W - 0.4, 1.1));
        side.quad(A(p, rp, -W + 0.4, 1.1), A(p, rp, -W + 0.4), A(q, rq, -W + 0.4), A(q, rq, -W + 0.4, 1.1));
        side.quad(A(q, rq, W, -2.2), A(q, rq, -W, -2.2), A(p, rp, -W, -2.2), A(p, rp, W, -2.2));
        // 橋脚
        const gy = Math.max(terrainHeight(p.x, p.z), WATER_Y - 3);
        if (k % 2 === 0 && p.y - gy > 5) {
          side.box(p.x - 1.6, gy, p.z - 1.6, p.x + 1.6, p.y - 2.2, p.z + 1.6, { tw: 4, th: 4, roof: null });
          side.beam(A(p, rp, -W + 1, -3), A(p, rp, W - 1, -3), 2, 1.6);
        }
        if (k % 3 === 0) { L.add(...A(p, rp, W - 0.5, 9), LC.cool, 5); L.add(...A(p, rp, -W + 0.5, 9), LC.cool, 5); }
      }
      this.root.add(this.meshShadow(deck.build(), deckMat));
      this.root.add(this.meshShadow(side.build(), concMat));
      this.hwPaths.push({ pts, right, n, len: n * (len / n), loop: !!hw.loop, name: hw.name });
    }
    // 斜張橋（西ルートの川渡り）
    const west = this.hwPaths.find((h) => h.name === 'west');
    let best = 0, bd = 1e9;
    west.pts.forEach((p, k) => { const d = Math.abs(p.x - riverX(p.z)); if (d < bd) { bd = d; best = k; } });
    this.cableStayed(west, best);
    this.buildTraffic();
  }

  cableStayed(path, center) {
    const gb = new GeoBuilder(); const cables = [];
    const white = [0.95, 0.95, 0.95];
    for (const off of [-7, 7]) {
      const k = center + off; const p = path.pts[k], r = path.right[k];
      const H = 115, base = WATER_Y - 2;
      const L = [p.x - r.x * 14, base, p.z - r.z * 14], Rr = [p.x + r.x * 14, base, p.z + r.z * 14], top = [p.x, p.y + H - p.y + 40, p.z];
      top[1] = p.y + 75;
      gb.beam(L, [top[0] - r.x * 1.5, top[1], top[2] - r.z * 1.5], 3.2, 4, white);
      gb.beam(Rr, [top[0] + r.x * 1.5, top[1], top[2] + r.z * 1.5], 3.2, 4, white);
      gb.beam([p.x - r.x * 13, p.y - 3, p.z - r.z * 13], [p.x + r.x * 13, p.y - 3, p.z + r.z * 13], 3, 2.5, white);
      gb.beam([p.x - r.x * 6, p.y + 50, p.z - r.z * 6], [p.x + r.x * 6, p.y + 50, p.z + r.z * 6], 2.5, 2.5, white);
      this.addCollider(p.x - 16, p.z - 16, p.x + 16, p.z + 16, top[1]);
      const obst = this.lightFields[this.lightFields.length - 1];
      obst.add(top[0], top[1] + 2, top[2], LC.red, 4, 2, 0);
      for (let c = 1; c <= 12; c++) for (const dir of [-1, 1]) {
        const q = path.pts[clamp(k + dir * c, 0, path.n)], rq = path.right[clamp(k + dir * c, 0, path.n)];
        for (const s of [-1, 1]) cables.push(top[0] + s * r.x * 1.2, top[1] - c * 2.2, top[2] + s * r.z * 1.2, q.x + s * rq.x * 11, q.y + 0.5, q.z + s * rq.z * 11);
      }
    }
    this.root.add(this.meshShadow(gb.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 })));
    const cg = new THREE.BufferGeometry(); cg.setAttribute('position', new THREE.Float32BufferAttribute(cables, 3));
    const cm = new THREE.LineBasicMaterial({ color: 0xdddddd }); this.cableMat = cm;
    this.root.add(new THREE.LineSegments(cg, cm));
  }

  buildTraffic() {
    const R = rng(4242);
    const cars = [];
    for (let h = 0; h < this.hwPaths.length; h++) {
      const P = this.hwPaths[h]; const count = Math.floor(P.n * 20 / 90);
      for (let i = 0; i < count; i++) {
        const lane = [-8.5, -4, 4, 8.5][Math.floor(R() * 4)];
        cars.push({ h, s: R() * P.n * 20, v: (lane < 0 ? -1 : 1) * (22 + R() * 10) * (Math.abs(lane) > 6 ? 0.85 : 1), lane, truck: R() < 0.18 });
      }
    }
    const geo = new THREE.BoxGeometry(2, 1.6, 4.6); geo.translate(0, 0.8, 0);
    const im = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ roughness: 0.35, metalness: 0.5 }), cars.length);
    const cols = [0xffffff, 0x222222, 0xb0b4b8, 0xa01818, 0x1a3c80, 0xe0e0e0, 0x5a5a5a, 0xd8c040];
    cars.forEach((c, k) => im.setColorAt(k, new THREE.Color(c.truck ? 0xeeeeee : cols[Math.floor(R() * cols.length)])));
    im.frustumCulled = false; im.castShadow = true; this.root.add(im);
    // 夜のヘッドライト/テールランプ
    const LF = new LightField({ minPx: 1.0, intensityDay: 0, intensityNight: 1.0 }); this.lightFields.push(LF);
    for (const c of cars) c.li = LF.add(0, 0, 0, c.v > 0 ? [1.6, 1.5, 1.2] : [1.6, 0.15, 0.1], 2.2);
    this.traffic = { cars, im, LF };
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pos = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    let frame = 0;
    this.animated.push((dt) => {
      const posAttr = LF.points.geometry.attributes.position;
      frame++;
      cars.forEach((c, k) => {
        const P = this.hwPaths[c.h]; const total = P.n * 20;
        c.s += c.v * dt; if (c.s < 0) c.s += total; if (c.s >= total) c.s -= total;
        const f = c.s / 20; const i0 = Math.min(P.n - 1, Math.floor(f)), t = f - i0;
        const a = P.pts[i0], b = P.pts[i0 + 1], r = P.right[i0];
        pos.set(lerp(a.x, b.x, t) + r.x * c.lane, lerp(a.y, b.y, t), lerp(a.z, b.z, t) + r.z * c.lane);
        const yaw = Math.atan2(-(b.x - a.x), -(b.z - a.z)) + (c.v < 0 ? Math.PI : 0);
        q.setFromAxisAngle(up, yaw); sc.set(1, c.truck ? 2 : 1, c.truck ? 2.4 : 1);
        m.compose(pos, q, sc); im.setMatrixAt(k, m);
        if (frame % 2 === 0) posAttr.setXYZ(c.li, pos.x - Math.sin(yaw) * 2.4 * (c.truck ? 2.4 : 1), pos.y + 0.8, pos.z - Math.cos(yaw) * 2.4 * (c.truck ? 2.4 : 1));
      });
      im.instanceMatrix.needsUpdate = true; if (frame % 2 === 0) posAttr.needsUpdate = true;
    });
  }

  // ---------- 橋（一般道） ----------
  buildBridges() {
    const deck = new GeoBuilder(), steel = new GeoBuilder(), conc = new GeoBuilder();
    const roadMat = new THREE.MeshStandardMaterial({ map: roadTexture(2, false), roughness: 0.9 });
    const L = new LightField({ minPx: 1.2, intensityDay: 0, intensityNight: 1.0 }); this.lightFields.push(L);
    let n = 0; const types = ['arch', 'girder', 'truss', 'girder', 'arch', 'truss'];
    for (let j = -44; j <= 52; j++) {
      if (j % 4 !== 0) continue;
      const z = j * GRID, xr = riverX(z);
      const xa = xr - RIVER_W / 2 - 110, xb = xr + RIVER_W / 2 + 110;
      const okW = cellAt(xa - 80, z + 5) || cellAt(xa - 80, z - 5), okE = cellAt(xb + 80, z + 5) || cellAt(xb + 80, z - 5);
      if (!okW || !okE) continue;
      const type = types[n++ % types.length];
      const H = 10, W = 9, ramp = 70;
      const yAt = (x) => x < xa + ramp ? lerp(0.4, H, smoothstep(xa, xa + ramp, x)) : x > xb - ramp ? lerp(H, 0.4, smoothstep(xb - ramp, xb, x)) : H;
      const step = 10;
      for (let x = xa - 80; x < xb + 80; x += step) {
        const y0 = x < xa ? 0.4 : yAt(x), y1 = x + step > xb ? 0.4 : yAt(Math.min(xb, x + step));
        const ya = x < xa || x > xb ? 0.4 : y0, yb = x + step < xa || x + step > xb ? 0.4 : y1;
        deck.quad([x, ya, z + W], [x + step, yb, z + W], [x + step, yb, z - W], [x, ya, z - W], [[0, x / 20], [0, (x + step) / 20], [1, (x + step) / 20], [1, x / 20]]);
        if (x >= xa && x + step <= xb) {
          conc.quad([x, ya - 1.8, z + W], [x + step, yb - 1.8, z + W], [x + step, yb, z + W], [x, ya, z + W]);
          conc.quad([x + step, yb - 1.8, z - W], [x, ya - 1.8, z - W], [x, ya, z - W], [x + step, yb, z - W]);
          conc.quad([x + step, yb - 1.8, z + W], [x, ya - 1.8, z + W], [x, ya - 1.8, z - W], [x + step, yb - 1.8, z - W]);
          if (Math.floor(x / step) % 4 === 0) { L.add(x, ya + 8, z + W, LC.sodium, 4); L.add(x, ya + 8, z - W, LC.sodium, 4); }
        }
      }
      // 欄干
      for (const s of [-1, 1]) steel.beam([xa + ramp, H + 1, z + s * W], [xb - ramp, H + 1, z + s * W], 0.3, 0.2, [0.85, 0.85, 0.85]);
      // 橋脚
      const spanL = xb - xa - 2 * ramp;
      const piers = type === 'girder' ? 4 : 1;
      for (let k = 0; k <= piers; k++) { const x = xa + ramp + (spanL * k) / piers; conc.box(x - 2, WATER_Y - 4, z - W + 1, x + 2, H - 1.8, z + W - 1, { roof: null, tw: 4, th: 4 }); }
      const x0 = xa + ramp, x1 = xb - ramp, mid = (x0 + x1) / 2, span = x1 - x0;
      if (type === 'arch') {
        const col = [0.75, 0.12, 0.1];
        for (const s of [-1, 1]) {
          let prev = null;
          for (let k = 0; k <= 24; k++) {
            const t = k / 24, x = x0 + span * t, y = H + Math.sin(Math.PI * t) * 38;
            const pnt = [x, y, z + s * (W - 0.5)];
            if (prev) steel.beam(prev, pnt, 1.6, 2.2, col);
            if (k > 0 && k < 24 && k % 2 === 0) steel.beam([x, H, z + s * (W - 0.5)], pnt, 0.25, 0.25, [0.9, 0.9, 0.9]);
            if (k % 4 === 2 && s === 1) steel.beam([x, y, z - W + 0.5], [x, y, z + W - 0.5], 0.8, 0.8, col);
            prev = pnt;
          }
        }
        this.addCollider(x0, z - W, x1, z + W, H + 40);
      } else if (type === 'truss') {
        const col = [0.25, 0.45, 0.35], th = 12, panels = 14;
        for (const s of [-1, 1]) {
          const zz = z + s * (W - 0.3);
          steel.beam([x0, H, zz], [x1, H, zz], 0.8, 1, col); steel.beam([x0 + span / panels, H + th, zz], [x1 - span / panels, H + th, zz], 0.8, 1, col);
          for (let k = 0; k < panels; k++) {
            const xa_ = x0 + (span * k) / panels, xb_ = x0 + (span * (k + 1)) / panels;
            const yTa = k === 0 ? H : H + th, yTb = k === panels - 1 ? H : H + th;
            steel.beam([xa_, yTa, zz], [xb_, H, zz], 0.5, 0.5, col);
            steel.beam([xb_, H, zz], [xb_, yTb, zz], 0.5, 0.5, col);
            if (s === 1 && k > 0 && k < panels - 1) steel.beam([xa_, H + th, z - W + 0.3], [xa_, H + th, z + W - 0.3], 0.5, 0.5, col);
          }
        }
        this.addCollider(x0, z - W, x1, z + W, H + th);
      } else this.addCollider(x0, z - W, x1, z + W, H);
    }
    this.root.add(this.meshShadow(deck.build(), roadMat));
    this.root.add(this.meshShadow(steel.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.4 })));
    this.root.add(this.meshShadow(conc.build(), new THREE.MeshStandardMaterial({ map: tex('concrete'), color: 0xc0bcb4, roughness: 0.85 })));
  }

  // ---------- 塔 ----------
  latticeTexture(color = '#ffffff') {
    const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
    g.clearRect(0, 0, 128, 128); g.strokeStyle = color; g.lineWidth = 9;
    g.beginPath(); g.moveTo(0, 0); g.lineTo(128, 128); g.moveTo(128, 0); g.lineTo(0, 128); g.stroke();
    g.lineWidth = 12; g.beginPath(); g.moveTo(0, 2); g.lineTo(128, 2); g.moveTo(2, 0); g.lineTo(2, 128); g.stroke();
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; return t;
  }

  buildTowers() {
    const obst = new LightField({ minPx: 2.0, intensityDay: 0.6, intensityNight: 1.3 }); this.lightFields.push(obst);
    // --- 電波塔（スカイツリー風 634m） ---
    {
      const g = new THREE.Group(); g.position.set(SKYTREE.x, 0, SKYTREE.z); this.root.add(g);
      const lt = this.latticeTexture('#f4f8ff');
      const latMat = (rep) => { const t = lt.clone(); t.needsUpdate = true; t.repeat.set(rep[0], rep[1]); return new THREE.MeshStandardMaterial({ map: t, alphaTest: 0.5, side: THREE.DoubleSide, color: 0xeef2f8, roughness: 0.5, metalness: 0.3 }); };
      const white = new THREE.MeshStandardMaterial({ color: 0xe6ebf2, roughness: 0.5, metalness: 0.3 });
      const glass = new THREE.MeshStandardMaterial({ color: 0x202a36, roughness: 0.1, metalness: 0.8, emissive: 0x99bbff, emissiveIntensity: 0 });
      this.nightMats.push({ m: glass, i: 0.9 });
      const segs = [[0, 340, 34, 11], [340, 445, 11, 8], [445, 500, 8, 5.5]];
      for (const [y0, y1, rb, rt] of segs) {
        const h = y1 - y0;
        const outer = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, 24, 1, true), latMat([24, h / 8])); outer.position.y = y0 + h / 2; g.add(outer);
        const core = new THREE.Mesh(new THREE.CylinderGeometry(rt * 0.55, rb * 0.55, h, 16), white); core.position.y = y0 + h / 2; core.castShadow = true; g.add(core);
      }
      for (const [y, r, h] of [[350, 20, 14], [450, 13, 9]]) {
        const d = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.92, h, 32), glass); d.position.y = y; g.add(d);
        const cap = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.95, r, 2, 32), white); cap.position.y = y + h / 2 + 1; g.add(cap);
        for (let k = 0; k < 16; k++) { const a = (k / 16) * Math.PI * 2; obst.add(SKYTREE.x + Math.cos(a) * r, y + 3, SKYTREE.z + Math.sin(a) * r, [1.2, 1.4, 1.8], 3, 0); }
      }
      const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.8, 4, 134, 12), white); ant.position.y = 567; g.add(ant);
      // 三本脚の基部
      const legs = new GeoBuilder();
      for (let k = 0; k < 3; k++) { const a = (k / 3) * Math.PI * 2; legs.beam([Math.cos(a) * 40, 0, Math.sin(a) * 40], [Math.cos(a) * 14, 120, Math.sin(a) * 14], 5, 5); }
      g.add(this.meshShadow(legs.build(), white));
      for (const y of [120, 250, 380, 500, 634]) obst.add(SKYTREE.x, y + 1, SKYTREE.z, LC.red, 5, 2, y / 300);
      this.addCollider(SKYTREE.x - 38, SKYTREE.z - 38, SKYTREE.x + 38, SKYTREE.z + 38, 160);
      this.addCollider(SKYTREE.x - 21, SKYTREE.z - 21, SKYTREE.x + 21, SKYTREE.z + 21, 500);
      this.addCollider(SKYTREE.x - 4, SKYTREE.z - 4, SKYTREE.x + 4, SKYTREE.z + 4, 634);
    }
    // --- 赤白の鉄塔（東京タワー風 333m） ---
    {
      const g = new THREE.Group(); g.position.set(LATTICE_TOWER.x, 0, LATTICE_TOWER.z); this.root.add(g);
      const ltR = this.latticeTexture('#ffffff');
      const red = 0xe2471f, wht = 0xf2f2f2;
      const prof = [[0, 45], [40, 33], [80, 24], [120, 17], [150, 13], [190, 9], [230, 6.5], [270, 4], [300, 2.6], [333, 1.0]];
      const solid = new GeoBuilder();
      for (let k = 0; k < prof.length - 1; k++) {
        const [y0, r0] = prof[k], [y1, r1] = prof[k + 1];
        const col = k % 2 === 0 ? red : wht;
        const t = ltR.clone(); t.needsUpdate = true; t.repeat.set(4 * Math.max(1, Math.round(r0 / 8)), (y1 - y0) / Math.max(4, r0 / 2));
        const m = new THREE.Mesh(new THREE.CylinderGeometry(r1 * Math.SQRT2, r0 * Math.SQRT2, y1 - y0, 4, 1, true), new THREE.MeshStandardMaterial({ map: t, alphaTest: 0.45, side: THREE.DoubleSide, color: col, roughness: 0.6 }));
        m.rotation.y = Math.PI / 4; m.position.y = (y0 + y1) / 2; m.castShadow = true; g.add(m);
        const c = new THREE.Color(col);
        for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) solid.beam([sx * r0, y0, sz * r0], [sx * r1, y1, sz * r1], Math.max(0.6, r0 * 0.07), Math.max(0.6, r0 * 0.07), [c.r, c.g, c.b]);
      }
      g.add(this.meshShadow(solid.build(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 })));
      const deckM = new THREE.MeshStandardMaterial({ color: 0xf0f0f0, roughness: 0.4, emissive: 0xffe0b0, emissiveIntensity: 0 }); this.nightMats.push({ m: deckM, i: 0.5 });
      const d1 = new THREE.Mesh(new THREE.BoxGeometry(30, 12, 30), deckM); d1.position.y = 150; g.add(d1);
      const d2 = new THREE.Mesh(new THREE.BoxGeometry(12, 7, 12), deckM); d2.position.y = 250; g.add(d2);
      // 夜のライトアップ（オレンジ）
      const up = new LightField({ minPx: 1.0, intensityDay: 0, intensityNight: 1.0 }); this.lightFields.push(up);
      for (let k = 0; k < prof.length - 1; k++) {
        const [y0, r0] = prof[k], [y1, r1] = prof[k + 1];
        for (let s = 0; s < 6; s++) { const t = s / 6, y = lerp(y0, y1, t), r = lerp(r0, r1, t); for (const [sx, sz] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) up.add(LATTICE_TOWER.x + sx * r, y, LATTICE_TOWER.z + sz * r, [1.8, 0.8, 0.25], 6); }
      }
      obst.add(LATTICE_TOWER.x, 334, LATTICE_TOWER.z, LC.red, 5, 2, 0.3);
      this.addCollider(LATTICE_TOWER.x - 40, LATTICE_TOWER.z - 40, LATTICE_TOWER.x + 40, LATTICE_TOWER.z + 40, 60);
      this.addCollider(LATTICE_TOWER.x - 16, LATTICE_TOWER.z - 16, LATTICE_TOWER.x + 16, LATTICE_TOWER.z + 16, 200);
      this.addCollider(LATTICE_TOWER.x - 5, LATTICE_TOWER.z - 5, LATTICE_TOWER.x + 5, LATTICE_TOWER.z + 5, 333);
    }
  }

  // ---------- 木 ----------
  buildForests() {
    const R = rng(999);
    const broad = this.treeInstances.broad, conif = this.treeInstances.conifer;
    // 川沿いの並木
    for (let z = -9000; z < 8000; z += 28) for (const s of [-1, 1]) {
      const x = riverX(z) + s * (RIVER_W / 2 + 40 + R() * 15);
      if (Math.abs(terrainHeight(x, z)) < 2 && !cellAt(x, z)) broad.push([x, z, 0.8 + R() * 0.4]);
    }
    // 郊外・山の森
    let tries = 0;
    const maxTrees = this.low ? 12000 : 26000;
    while (conif.length + broad.length < maxTrees && tries++ < 300000) {
      const a = R() * Math.PI * 2, r = 1500 + Math.sqrt(R()) * 15000;
      const x = 1500 + Math.cos(a) * r, z = Math.sin(a) * r;
      if (Math.abs(x) < 900 && Math.abs(z) < 3500) continue;
      if (cellAt(x, z)) continue;
      const h = terrainHeight(x, z); if (h < 1.5 || h > 1300) continue;
      const fn = fbm(x / 2200, z / 2200, 4, 9);
      const dens = smoothstep(0.47, 0.6, fn) * smoothstep(5, 40, h) + smoothstep(60, 300, h) * 0.7 + 0.04;
      if (R() > dens) continue;
      if (terrainSlope(x, z) > 0.9) continue;
      (h > 250 || R() < 0.35 ? conif : broad).push([x, z, 0.8 + R() * 0.8]);
    }
    const mk = (crown, crownCol, list) => {
      const gb = new GeoBuilder();
      addGeometry(gb, new THREE.CylinderGeometry(0.25, 0.35, 3, 5), new THREE.Matrix4().makeTranslation(0, 1.5, 0), [0.35, 0.25, 0.18]);
      addGeometry(gb, crown, new THREE.Matrix4(), crownCol);
      const geo = gb.build();
      const byChunk = new Map();
      for (const t of list) { const k = chunkKey(t[0], t[1]); if (!byChunk.has(k)) byChunk.set(k, []); byChunk.get(k).push(t); }
      const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true });
      const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), c = new THREE.Color(), up = new THREE.Vector3(0, 1, 0);
      for (const arr of byChunk.values()) {
        const im = new THREE.InstancedMesh(geo, mat, arr.length);
        arr.forEach(([x, z, sc], k) => {
          p.set(x, terrainHeight(x, z) - 0.3, z); q.setFromAxisAngle(up, hash2(x | 0, z | 0) * 6.28); s.set(sc, sc * (0.85 + hash2(z | 0, x | 0) * 0.4), sc);
          m.compose(p, q, s); im.setMatrixAt(k, m);
          const v = 0.75 + hash2(x | 0, z | 0, 3) * 0.45; im.setColorAt(k, c.setRGB(v, v * (0.95 + hash2(x | 0, 1, 4) * 0.1), v * 0.9));
        });
        im.computeBoundingSphere(); im.castShadow = true; im.receiveShadow = true;
        this.root.add(im);
      }
    };
    const crownB = new THREE.IcosahedronGeometry(3.2, 0); crownB.translate(0, 5.2, 0);
    const crownC = new THREE.ConeGeometry(2.8, 9, 6); crownC.translate(0, 6.5, 0);
    mk(crownB, [0.3, 0.45, 0.2], broad);
    mk(crownC, [0.18, 0.32, 0.18], conif);
  }

  // ---------- 雲・星 ----------
  buildClouds() {
    const R = rng(31337);
    const texs = [cloudTexture(1), cloudTexture(2), cloudTexture(3)];
    this.cloudMats = texs.map((t) => new THREE.SpriteMaterial({ map: t, transparent: true, depthWrite: false, fog: true, opacity: 0.92 }));
    const g = new THREE.Group(); this.root.add(g); this.clouds = g;
    for (let k = 0; k < 70; k++) {
      const cx = -16000 + R() * 34000, cz = -18000 + R() * 34000, cy = 1700 + R() * 900;
      if (Math.abs(cx) < 2500 && cz > -2000 && cz < 12000 && cy < 2000) continue;
      const n = 4 + Math.floor(R() * 6);
      for (let i = 0; i < n; i++) {
        const s = new THREE.Sprite(this.cloudMats[Math.floor(R() * 3)]);
        const sz = 300 + R() * 450; s.scale.set(sz, sz * 0.6, 1);
        s.position.set(cx + (R() - 0.5) * 700, cy + (R() - 0.3) * 120, cz + (R() - 0.5) * 500);
        g.add(s);
      }
    }
    // 星
    const sp = [];
    for (let k = 0; k < 2500; k++) {
      const u = R() * 2 - 1, a = R() * Math.PI * 2; const y = Math.abs(u) * 0.95 + 0.05, r = Math.sqrt(1 - y * y);
      sp.push(Math.cos(a) * r * 60000, y * 60000, Math.sin(a) * r * 60000);
    }
    const sg = new THREE.BufferGeometry(); sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, fog: false, depthWrite: false }));
    this.stars.frustumCulled = false; this.scene.add(this.stars);
  }

  // ---------- 毎フレーム ----------
  update(dt, t, camera, viewportH, wind) {
    for (const f of this.animated) f(dt, t);
    const scale = viewportH / (2 * Math.tan((camera.fov * Math.PI) / 360));
    for (const lf of this.lightFields) lf.update(t, scale, this.night);
    this.updatePAPI(camera.position);
    this.stars.position.copy(camera.position);
    if (this.windsocks && wind) {
      const sp = Math.hypot(wind.x, wind.z);
      for (const ws of this.windsocks) {
        ws.rotation.y = Math.atan2(-wind.x, -wind.z) + Math.PI + Math.sin(t * 3) * 0.05;
        ws.children[0].rotation.x = -(Math.PI / 2) * (1 - Math.min(1, sp / 8)) * 0.9 + Math.sin(t * 5) * 0.03;
      }
    }
  }

  setNight(n, cloudTint) {
    this.night = n;
    for (const { m, i } of this.nightMats) m.emissiveIntensity = n * i;
    this.stars.material.opacity = n;
    for (const m of this.cloudMats) m.color.copy(cloudTint);
    if (this.cableMat) this.cableMat.color.setScalar(0.87 * (1 - n * 0.85));
  }
}
