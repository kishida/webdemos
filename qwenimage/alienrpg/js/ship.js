import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { glowTex, flashTex, splatTex, blobTex, aspect, rng, rand, Particles } from './util.js';

const C = 4;          // cell size
const WH = 4;         // wall height
const EYE = 1.65;
const N = 29;         // grid size

const DECKS = [
  { name: 'DECK 1', sub: '貨物区画', seed: 1207, rooms: 9, enemies: 8, mix: { drone: 0.5, hound: 0.5 }, hive: 0.1,
    lights: [0x9ec8ff, 0xff3a20, 0x9ec8ff], fog: 0x010203, artifact: 'crystal' },
  { name: 'DECK 2', sub: '研究区画', seed: 3311, rooms: 10, enemies: 11, mix: { drone: 0.4, hound: 0.3, spitter: 0.3 }, hive: 0.4,
    lights: [0xffa040, 0x60c0ff, 0xff3a20], fog: 0x020201, artifact: 'orb' },
  { name: 'DECK 3', sub: '巣窟', seed: 9001, rooms: 10, enemies: 13, mix: { drone: 0.4, hound: 0.25, spitter: 0.35 }, hive: 0.85,
    lights: [0x50ff70, 0x9050ff, 0x50ff70], fog: 0x010401, artifact: 'core' },
];

const TYPES = {
  drone:   { h: 2.5, r: 0.5, hp: 55, speed: 3.4, dmg: 11, xp: 25, cd: 1.1 },
  hound:   { h: 1.3, r: 0.55, hp: 35, speed: 5.4, dmg: 7, xp: 15, cd: 0.8 },
  spitter: { h: 1.9, r: 0.55, hp: 45, speed: 1.8, dmg: 6, xp: 25, cd: 1.2, ranged: 2.6 },
  queen:   { h: 3.8, r: 1.4, hp: 2400, speed: 2.4, dmg: 22, xp: 300, cd: 1.4, ranged: 3.2 },
};

const hash = (x, z, s) => { const v = Math.sin(x * 12.9898 + z * 78.233 + s * 37.719) * 43758.5453; return v - Math.floor(v); };

export class Ship {
  constructor(G) {
    this.G = G;
    const A = G.assets;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0);
    this.camera = new THREE.PerspectiveCamera(72, innerWidth / innerHeight, 0.05, 120);
    this.camera.rotation.order = 'YXZ';
    this.scene.add(this.camera);
    const pmrem = new THREE.PMREMGenerator(G.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.05;
    this.scene.add(new THREE.HemisphereLight(0x8090a0, 0x181818, 0.35));

    // materials
    const setup = (t, n) => { for (const x of [t, n]) { x.wrapS = x.wrapT = THREE.RepeatWrapping; } };
    setup(A.wall, A.wall_n); setup(A.hive, A.hive_n); setup(A.floor, A.floor_n); setup(A.ceiling, A.ceiling_n);
    this.mats = {
      wall: new THREE.MeshStandardMaterial({ map: A.wall, normalMap: A.wall_n, roughness: 0.55, metalness: 0.45 }),
      hive: new THREE.MeshStandardMaterial({ map: A.hive, normalMap: A.hive_n, roughness: 0.25, metalness: 0.2, normalScale: new THREE.Vector2(1.5, 1.5) }),
    };

    // flashlight
    this.spot = new THREE.SpotLight(0xfff2dd, 55, 45, 0.45, 0.55, 1.5);
    this.spot.position.set(0.2, -0.16, -0.95);       // weapon-mounted light at the muzzle (gun stays behind it)
    this.spot.target.position.set(0, -0.5, -10);
    this.camera.add(this.spot, this.spot.target);
    this.fill = new THREE.PointLight(0xc8d8ff, 0.8, 6, 2);   // faint bounce so walls near you are readable
    this.camera.add(this.fill);

    this.buildGun();
    this.particles = new Particles(this.scene, 600, 0.09, true);

    // dust motes floating in the beam
    const dn = 260;
    this.dust = new Float32Array(dn * 3);
    for (let i = 0; i < dn * 3; i++) this.dust[i] = rand(-6, 6);
    const dg = new THREE.BufferGeometry();
    dg.setAttribute('position', new THREE.BufferAttribute(this.dust, 3));
    this.dustPts = new THREE.Points(dg, new THREE.PointsMaterial({ size: 0.025, color: 0x505050, map: glowTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.dustPts.frustumCulled = false;
    this.scene.add(this.dustPts);

    this.tracer = new THREE.Mesh(new THREE.BoxGeometry(0.02, 0.02, 1), new THREE.MeshBasicMaterial({ color: new THREE.Color(5, 3, 1), toneMapped: false }));
    this.tracer.visible = false;
    this.scene.add(this.tracer);

    this.decals = [];
    this.decalMat = new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, opacity: 0.9 });
    this.decks = [];
    this.deckIdx = -1;
    this.maxDeck = 0;
    this.projectiles = [];
    this.yaw = 0; this.pitch = 0; this.bob = 0; this.recoil = 0; this.time = 0;
    this.pos = new THREE.Vector3();
    this.beepT = 0;
    this.mm = document.getElementById('minimap').getContext('2d');
  }

  // ------------------------------------------------------------ first-person gun
  buildGun() {
    const metal = new THREE.MeshStandardMaterial({ color: 0x3a3f44, roughness: 0.35, metalness: 0.8 });
    const dark = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.6, metalness: 0.5 });
    const olive = new THREE.MeshStandardMaterial({ color: 0x3b4230, roughness: 0.7, metalness: 0.2 });
    const g = new THREE.Group();
    const part = (geo, mat, x, y, z, order) => {
      const m = new THREE.Mesh(geo, mat.clone());
      m.material.depthTest = false; m.renderOrder = 100 + order;
      m.position.set(x, y, z); g.add(m); return m;
    };
    const barrel = part(new THREE.CylinderGeometry(0.022, 0.022, 0.4, 12), dark, 0, 0.015, -0.48, 0); barrel.rotation.x = Math.PI / 2;
    part(new THREE.BoxGeometry(0.05, 0.16, 0.08), dark, 0, -0.12, -0.12, 1);           // magazine
    part(new THREE.BoxGeometry(0.045, 0.13, 0.06), olive, 0, -0.1, 0.1, 2);            // grip
    part(new THREE.BoxGeometry(0.085, 0.1, 0.5), olive, 0, 0, -0.1, 3);                // body
    part(new THREE.BoxGeometry(0.07, 0.045, 0.42), metal, 0, 0.07, -0.16, 4);          // shroud
    part(new THREE.BoxGeometry(0.02, 0.035, 0.18), metal, 0, 0.11, -0.05, 5);          // sight rail
    // ammo counter screen
    this.ammoCanvas = document.createElement('canvas');
    this.ammoCanvas.width = 64; this.ammoCanvas.height = 32;
    this.ammoTex = new THREE.CanvasTexture(this.ammoCanvas);
    const scr = part(new THREE.PlaneGeometry(0.07, 0.035), new THREE.MeshBasicMaterial({ map: this.ammoTex, toneMapped: false, color: new THREE.Color(1.6, 1.6, 1.6) }), 0, 0.075, 0.07, 6);
    scr.rotation.x = -0.6;
    this.gun = g;
    g.scale.setScalar(0.8);
    this.gun.position.set(0.24, -0.24, -0.42);
    this.camera.add(g);
    this.gunLight = new THREE.PointLight(0xaabbcc, 0.35, 1.2, 2);
    this.gunLight.position.set(0.1, 0.1, -0.2);
    this.camera.add(this.gunLight);
    this.muzzle = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, blending: THREE.AdditiveBlending, depthTest: false, color: 0xffd090 }));
    this.muzzle.position.set(0.24, -0.2, -1.08);
    this.muzzle.scale.set(0.35, 0.35, 1);
    this.muzzle.renderOrder = 120;
    this.muzzle.visible = false;
    this.camera.add(this.muzzle);
    this.muzzleLight = new THREE.PointLight(0xffb060, 0, 14, 1.6);
    this.muzzleLight.position.set(0.2, -0.1, -1.2);
    this.camera.add(this.muzzleLight);
    this.lastAmmo = -1;
  }

  drawAmmoScreen() {
    const p = this.G.player, v = p.reloading > 0 ? '--' : String(p.mag).padStart(2, '0');
    if (v === this.lastAmmo) return;
    this.lastAmmo = v;
    const g = this.ammoCanvas.getContext('2d');
    g.fillStyle = '#021'; g.fillRect(0, 0, 64, 32);
    g.fillStyle = p.mag < 8 ? '#f53' : '#5f8'; g.font = 'bold 26px monospace'; g.textAlign = 'center';
    g.fillText(v, 32, 26);
    this.ammoTex.needsUpdate = true;
  }

  // ------------------------------------------------------------ deck generation
  genDeck(idx) {
    const D = DECKS[idx], R = rng(D.seed), G = this.G, A = G.assets;
    const grid = new Uint8Array(N * N);
    const rooms = [];
    for (let t = 0; t < 400 && rooms.length < D.rooms; t++) {
      const w = 3 + 2 * Math.floor(R() * 3), h = 3 + 2 * Math.floor(R() * 3);
      const x = 1 + Math.floor(R() * (N - w - 2)), y = 1 + Math.floor(R() * (N - h - 2));
      if (rooms.some(r => x < r.x + r.w + 2 && x + w + 2 > r.x && y < r.y + r.h + 2 && y + h + 2 > r.y)) continue;
      rooms.push({ x, y, w, h, cx: x + (w >> 1), cy: y + (h >> 1) });
      for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) grid[j * N + i] = 1;
    }
    const carve = (a, b) => {
      let x = a.cx, y = a.cy;
      const hFirst = R() < 0.5;
      const stepX = () => { while (x !== b.cx) { x += Math.sign(b.cx - x); grid[y * N + x] = 1; } };
      const stepY = () => { while (y !== b.cy) { y += Math.sign(b.cy - y); grid[y * N + x] = 1; } };
      if (hFirst) { stepX(); stepY(); } else { stepY(); stepX(); }
    };
    for (let i = 1; i < rooms.length; i++) {
      let best = 0, bd = 1e9;
      for (let j = 0; j < i; j++) { const d = Math.abs(rooms[i].cx - rooms[j].cx) + Math.abs(rooms[i].cy - rooms[j].cy); if (d < bd) { bd = d; best = j; } }
      carve(rooms[i], rooms[best]);
    }
    for (let k = 0; k < 2; k++) carve(rooms[Math.floor(R() * rooms.length)], rooms[Math.floor(R() * rooms.length)]);

    const deck = { idx, D, grid, rooms, group: new THREE.Group(), enemies: [], pickups: [], lights: [], explored: new Uint8Array(N * N) };
    this.grid = grid;
    const start = rooms[0];
    const dist = this.bfs(grid, start.cx, start.cy);
    const goal = rooms.slice(1).reduce((a, r) => dist[r.cy * N + r.cx] > dist[a.cy * N + a.cx] ? r : a, rooms[1]);
    deck.start = start; deck.goal = goal;

    // walls (only those touching floor)
    const walls = { wall: [], hive: [] };
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      if (grid[j * N + i]) continue;
      let touch = false;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const x = i + dx, z = j + dz; if (x >= 0 && z >= 0 && x < N && z < N && grid[z * N + x]) touch = true; }
      if (!touch) continue;
      const hv = hash(Math.floor(i / 3), Math.floor(j / 3), idx) < D.hive;
      walls[hv ? 'hive' : 'wall'].push([i, j]);
    }
    const box = new THREE.BoxGeometry(C, WH, C);
    const m4 = new THREE.Matrix4();
    for (const k of ['wall', 'hive']) {
      if (!walls[k].length) continue;
      const im = new THREE.InstancedMesh(box, this.mats[k], walls[k].length);
      walls[k].forEach(([i, j], n) => im.setMatrixAt(n, m4.makeTranslation((i + 0.5) * C, WH / 2, (j + 0.5) * C)));
      deck.group.add(im);
    }
    // floor & ceiling
    const fl = A.floor.clone(), fln = A.floor_n.clone();
    for (const t of [fl, fln]) { t.repeat.set(N, N); t.needsUpdate = true; }
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(N * C, N * C), new THREE.MeshStandardMaterial({ map: fl, normalMap: fln, roughness: 0.45, metalness: 0.55 }));
    floor.rotation.x = -Math.PI / 2; floor.position.set(N * C / 2, 0, N * C / 2);
    const cl = A.ceiling.clone(), cln = A.ceiling_n.clone();
    for (const t of [cl, cln]) { t.repeat.set(N, N); t.needsUpdate = true; }
    const ceil = new THREE.Mesh(new THREE.PlaneGeometry(N * C, N * C), new THREE.MeshStandardMaterial({ map: cl, normalMap: cln, roughness: 0.6, metalness: 0.4, color: 0x9a9a9a }));
    ceil.rotation.x = Math.PI / 2; ceil.position.set(N * C / 2, WH, N * C / 2);
    deck.group.add(floor, ceil);
    // hive floor slime patches
    for (let k = 0; k < D.hive * 30; k++) {
      const r = rooms[Math.floor(R() * rooms.length)];
      const s = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({ map: splatTex, transparent: true, depthWrite: false, roughness: 0.1, metalness: 0.3, color: 0x405030 }));
      s.rotation.x = -Math.PI / 2; s.rotation.z = R() * 6;
      s.scale.setScalar(1.5 + R() * 3);
      s.position.set((r.x + R() * r.w) * C, 0.02, (r.y + R() * r.h) * C);
      deck.group.add(s);
    }

    // room lights + fixtures
    const lit = [start, goal, ...rooms.filter(r => r !== start && r !== goal).sort(() => R() - 0.5).slice(0, 5)];
    lit.forEach((r, n) => {
      const col = r === goal && idx === 2 ? 0xa060ff : D.lights[n % D.lights.length];
      const L = new THREE.PointLight(col, 22, 15, 1.7);
      L.position.set((r.cx + 0.5) * C, WH - 0.4, (r.cy + 0.5) * C);
      L.userData = { base: 22, flicker: R() < 0.4 };
      const fix = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.08, 0.35), new THREE.MeshBasicMaterial({ color: new THREE.Color(col).multiplyScalar(3), toneMapped: false }));
      fix.position.set(L.position.x, WH - 0.04, L.position.z);
      L.userData.fix = fix;
      deck.group.add(L, fix);
      deck.lights.push(L);
    });

    // doors
    deck.evac = this.makeDoor(deck, start, 'evac', R);
    if (idx < 2) deck.lift = this.makeDoor(deck, goal, 'lift', R);

    // artifact
    const tex = A['artifact_' + D.artifact];
    const am = new THREE.Mesh(new THREE.PlaneGeometry(1.0 * aspect(tex), 1.0), new THREE.MeshBasicMaterial({ map: tex, alphaTest: 0.4, color: new THREE.Color(1.4, 1.4, 1.4), toneMapped: false, side: THREE.DoubleSide }));
    const ap = new THREE.Vector3((goal.cx + 0.5) * C, 1.3, (goal.cy + 0.5) * C);
    am.position.copy(ap);
    const aglow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: [0x55e0ff, 0xff8030, 0xb070ff][idx], blending: THREE.AdditiveBlending, depthWrite: false, opacity: 0.8 }));
    aglow.scale.set(2.6, 2.6, 1); aglow.position.copy(ap);
    const alight = new THREE.PointLight([0x55e0ff, 0xff8030, 0xb070ff][idx], 12, 8, 1.5);
    alight.position.copy(ap);
    deck.group.add(am, aglow, alight);
    deck.artifact = { mesh: am, glow: aglow, light: alight, pos: ap, id: D.artifact, taken: false };

    // pickups
    const freeCell = room => {
      for (let t = 0; t < 30; t++) {
        const i = room.x + Math.floor(R() * room.w), j = room.y + Math.floor(R() * room.h);
        if (!(i === room.cx && j === room.cy)) return [(i + 0.2 + R() * 0.6) * C, (j + 0.2 + R() * 0.6) * C];
      }
      return [(room.cx + 0.5) * C, (room.cy + 0.5) * C];
    };
    const others = rooms.filter(r => r !== start);
    for (let k = 0; k < 5; k++) {
      const [x, z] = freeCell(others[Math.floor(R() * others.length)]);
      const kind = k % 3 === 2 ? 'med' : 'ammo';
      const m = this.billboard(A.crate, 0.95);
      m.position.set(x, 0, z);
      deck.group.add(m);
      deck.pickups.push({ mesh: m, x, z, kind });
    }
    // starter crate in the first room
    { const [x, z] = freeCell(start); const m = this.billboard(A.crate, 0.95); m.position.set(x, 0, z); deck.group.add(m); deck.pickups.push({ mesh: m, x, z, kind: 'ammo' }); }

    // enemies
    const pick = mix => { let r = R(); for (const [k, v] of Object.entries(mix)) { if ((r -= v) <= 0) return k; } return 'drone'; };
    for (let k = 0; k < D.enemies; k++) {
      const room = others[Math.floor(R() * others.length)];
      const [x, z] = freeCell(room);
      this.spawn(deck, pick(D.mix), x, z);
    }
    if (idx === 2) this.spawn(deck, 'queen', ap.x, ap.z + 0.01 - C * 0.8);
    return deck;
  }

  makeDoor(deck, room, kind, R) {
    const g = deck.grid, A = this.G.assets;
    const sides = [];
    for (let i = room.x; i < room.x + room.w; i++) {
      if (!g[(room.y - 1) * N + i]) sides.push({ i, j: room.y - 1, nx: 0, nz: 1, px: (i + 0.5) * C, pz: room.y * C });
      if (!g[(room.y + room.h) * N + i]) sides.push({ i, j: room.y + room.h, nx: 0, nz: -1, px: (i + 0.5) * C, pz: (room.y + room.h) * C });
    }
    for (let j = room.y; j < room.y + room.h; j++) {
      if (!g[j * N + room.x - 1]) sides.push({ i: room.x - 1, j, nx: 1, nz: 0, px: room.x * C, pz: (j + 0.5) * C });
      if (!g[j * N + room.x + room.w]) sides.push({ i: room.x + room.w, j, nx: -1, nz: 0, px: (room.x + room.w) * C, pz: (j + 0.5) * C });
    }
    // prefer a slot whose neighbours along the wall are also wall (looks framed)
    const good = sides.filter(s => s.nx ? !g[(s.j - 1) * N + s.i] && !g[(s.j + 1) * N + s.i] : !g[s.j * N + s.i - 1] && !g[s.j * N + s.i + 1]);
    const s = (good.length ? good : sides)[Math.floor(R() * (good.length || sides.length))];
    const locked = kind === 'lift';
    const mat = new THREE.MeshStandardMaterial({ map: A.door, emissiveMap: A.door, emissive: new THREE.Color(locked ? 0x802010 : 0x208040), roughness: 0.4, metalness: 0.6 });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(C * 0.82, WH * 0.9), mat);
    m.position.set(s.px + s.nx * 0.03, WH * 0.45, s.pz + s.nz * 0.03);
    m.rotation.y = Math.atan2(s.nx, s.nz);
    // frame light strip above the door
    const strip = new THREE.Mesh(new THREE.BoxGeometry(C * 0.7, 0.06, 0.06), new THREE.MeshBasicMaterial({ color: new THREE.Color(locked ? 0xff3020 : 0x30ff70).multiplyScalar(3), toneMapped: false }));
    strip.position.set(s.px + s.nx * 0.06, WH * 0.93, s.pz + s.nz * 0.06);
    strip.rotation.y = m.rotation.y;
    deck.group.add(m, strip);
    return { mesh: m, strip, kind, locked, front: new THREE.Vector3(s.px + s.nx * 1.6, 0, s.pz + s.nz * 1.6), nx: s.nx, nz: s.nz };
  }

  billboard(tex, h) {
    const w = h * aspect(tex);
    const geo = new THREE.PlaneGeometry(w, h).translate(0, h / 2, 0);
    const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide, roughness: 0.85, metalness: 0, color: 0x6a6a6a, envMapIntensity: 0 }));
    m.userData.w = w;
    return m;
  }

  spawn(deck, type, x, z) {
    const T = TYPES[type], tex = this.G.assets[type];
    const scale = type === 'queen' ? 1 : 1 + deck.idx * 0.35;
    const m = this.billboard(tex, T.h * rand(0.95, 1.08));
    m.position.set(x, 0, z);
    deck.group.add(m);
    const e = { type, T, mesh: m, x, z, hp: T.hp * scale, max: T.hp * scale, cd: 0, hit: 0, dead: 0, awake: false, shootCd: rand(1, 3),
      r: Math.max(T.r, m.userData.w * 0.3), w: m.userData.w, summon: 8, lunge: 0, phase: Math.random() * 6 };
    deck.enemies.push(e);
    return e;
  }

  bfs(grid, sx, sz) {
    const d = new Int16Array(N * N).fill(-1);
    const q = [sz * N + sx]; d[q[0]] = 0;
    for (let h = 0; h < q.length; h++) {
      const c = q[h], x = c % N, z = (c / N) | 0;
      for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, nz = z + dz, n = nz * N + nx;
        if (nx < 0 || nz < 0 || nx >= N || nz >= N || !grid[n] || d[n] >= 0) continue;
        d[n] = d[c] + 1; q.push(n);
      }
    }
    return d;
  }

  wall(i, j) { return i < 0 || j < 0 || i >= N || j >= N || !this.grid[j * N + i]; }

  // 2D DDA against the wall grid. dir must be normalized (2D).
  rayWall(ox, oz, dx, dz, maxT) {
    let cx = Math.floor(ox / C), cz = Math.floor(oz / C);
    const sx = dx > 0 ? 1 : -1, sz = dz > 0 ? 1 : -1;
    const tdx = dx ? Math.abs(C / dx) : Infinity, tdz = dz ? Math.abs(C / dz) : Infinity;
    let tx = dx ? (dx > 0 ? ((cx + 1) * C - ox) / dx : (ox - cx * C) / -dx) : Infinity;
    let tz = dz ? (dz > 0 ? ((cz + 1) * C - oz) / dz : (oz - cz * C) / -dz) : Infinity;
    for (let k = 0; k < 64; k++) {
      let t, nx = 0, nz = 0;
      if (tx < tz) { cx += sx; t = tx; tx += tdx; nx = -sx; } else { cz += sz; t = tz; tz += tdz; nz = -sz; }
      if (t > maxT) return { t: maxT };
      if (this.wall(cx, cz)) return { t, nx, nz };
    }
    return { t: maxT };
  }

  los(ax, az, bx, bz) {
    const dx = bx - ax, dz = bz - az, d = Math.hypot(dx, dz);
    return this.rayWall(ax, az, dx / d, dz / d, d).t >= d - 0.01;
  }

  collide(o, r) {
    const cx = Math.floor(o.x / C), cz = Math.floor(o.z / C);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (!this.wall(cx + dx, cz + dz)) continue;
      const minX = (cx + dx) * C, minZ = (cz + dz) * C;
      const px = THREE.MathUtils.clamp(o.x, minX, minX + C), pz = THREE.MathUtils.clamp(o.z, minZ, minZ + C);
      const ddx = o.x - px, ddz = o.z - pz, d = Math.hypot(ddx, ddz);
      if (d < r && d > 1e-5) { o.x = px + ddx / d * r; o.z = pz + ddz / d * r; }
    }
  }

  // ------------------------------------------------------------ scene lifecycle
  enter() { this.loadDeck(this.maxDeck); }
  exit() { this.G.input.down = false; }

  loadDeck(idx) {
    if (this.deck) this.scene.remove(this.deck.group);
    if (!this.decks[idx]) this.decks[idx] = this.genDeck(idx);
    this.deck = this.decks[idx];
    this.grid = this.deck.grid;
    this.deckIdx = idx;
    this.maxDeck = Math.max(this.maxDeck, idx);
    this.scene.add(this.deck.group);
    this.scene.fog = new THREE.FogExp2(this.deck.D.fog, 0.055);
    const ev = this.deck.evac;
    this.pos.set(ev.front.x + ev.nx * 0.6, EYE, ev.front.z + ev.nz * 0.6);
    this.yaw = Math.atan2(-ev.nx, -ev.nz); this.pitch = 0;
    this.flow = null; this.flowCell = -1;
    this.G.area(this.deck.D.name, this.deck.D.sub);
    this.G.sfx.door();
  }

  resize() { this.camera.aspect = innerWidth / innerHeight; this.camera.updateProjectionMatrix(); }

  nearDoor() {
    for (const d of [this.deck.evac, this.deck.lift]) {
      if (d && Math.hypot(d.front.x - this.pos.x, d.front.z - this.pos.z) < 1.9) return d;
    }
    return null;
  }

  interact() {
    const G = this.G, deck = this.deck, a = deck.artifact;
    if (!a.taken && Math.hypot(a.pos.x - this.pos.x, a.pos.z - this.pos.z) < 2.2) {
      if (a.id === 'core' && deck.enemies.some(e => e.type === 'queen' && !e.dead)) { G.log('コアは女王の分泌物に封じられている……', '#f9a'); return; }
      a.taken = true;
      deck.group.remove(a.mesh, a.glow); a.light.intensity = 0;
      G.input.down = false;
      G.giveArtifact(a.id, () => {
        if (a.id === 'core') { G.gameOver(true); return; }
        if (deck.lift) {
          deck.lift.locked = false;
          deck.lift.mesh.material.emissive.set(0x208040);
          deck.lift.strip.material.color.set(0x30ff70).multiplyScalar(3);
          G.log('リフトのロックが解除された', '#8f8');
        }
      });
      return;
    }
    const d = this.nearDoor();
    if (!d) return;
    if (d.kind === 'evac') { G.sfx.door(); G.switchTo(G.forest, 'return'); return; }
    if (d.locked) { G.log('リフトはロックされている。この区画のアーティファクトが鍵だ', '#f9a'); return; }
    this.loadDeck(this.deckIdx + 1);
  }

  // ------------------------------------------------------------ combat
  shoot() {
    const G = this.G;
    if (!G.tryFire()) return;
    this.recoil = 1;
    this.pitch += 0.008; this.yaw += (Math.random() - 0.5) * 0.006;
    this.muzzle.visible = true; this.muzzle.material.rotation = Math.random() * 6; this.muzzleT = 0.045;
    this.muzzleLight.intensity = 60;
    // wake everything in earshot
    for (const e of this.deck.enemies) if (!e.dead && Math.hypot(e.x - this.pos.x, e.z - this.pos.z) < 14) this.wake(e);

    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    dir.x += (Math.random() - 0.5) * 0.015; dir.y += (Math.random() - 0.5) * 0.015; dir.normalize();
    const o = this.pos;
    const hl = Math.hypot(dir.x, dir.z) || 1e-6;
    const w = this.rayWall(o.x, o.z, dir.x / hl, dir.z / hl, 80);
    let tMax = w.t / hl, normal = new THREE.Vector3(w.nx || 0, 0, w.nz || 0);
    const tPlane = dir.y < 0 ? -o.y / dir.y : (WH - o.y) / dir.y;
    if (tPlane < tMax) { tMax = tPlane; normal.set(0, dir.y < 0 ? 1 : -1, 0); }
    let best = null, bt = tMax;
    for (const e of this.deck.enemies) {
      if (e.dead) continue;
      const vx = e.x - o.x, vz = e.z - o.z;
      const s = (vx * dir.x + vz * dir.z) / hl;
      if (s < 0) continue;
      const px = vx - dir.x / hl * s, pz = vz - dir.z / hl * s;
      if (Math.hypot(px, pz) > e.w * 0.32) continue;
      const t = s / hl, y = o.y + dir.y * t;
      if (y < 0 || y > e.mesh.scale.y * e.T.h * 1.05 || t > bt) continue;
      best = e; bt = t;
    }
    const hitP = o.clone().addScaledVector(dir, bt);
    // tracer from the muzzle
    const from = new THREE.Vector3(0.24, -0.2, -1.05).applyMatrix4(this.camera.matrixWorld);
    this.tracer.position.copy(from).lerp(hitP, 0.5);
    this.tracer.scale.z = from.distanceTo(hitP);
    this.tracer.lookAt(hitP);
    this.tracer.visible = true; this.tracerT = 0.03;
    if (best) {
      const crit = hitP.y > best.mesh.scale.y * best.T.h * 0.75;
      const d = Math.round(G.damage() * (crit ? 1.5 : 1));
      best.hp -= d; best.hit = 0.1;
      this.wake(best);
      const k = best.type === 'queen' ? 0.05 : 0.3;
      best.x += dir.x * k; best.z += dir.z * k;
      this.particles.burst(hitP, crit ? 26 : 14, 0x8dff3a, 3.5, 0.6);
      G.sfx.hit();
      document.getElementById('cross').classList.add('hit');
      clearTimeout(this._crossT);
      this._crossT = setTimeout(() => document.getElementById('cross').classList.remove('hit'), 90);
      if (best.hp <= 0) this.kill(best);
    } else {
      this.particles.burst(hitP.clone().addScaledVector(normal, 0.05), 10, 0xffb050, 3, 0.35);
      this.decal(hitP, normal);
    }
  }

  decal(p, n) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(0.22, 0.22), this.decalMat);
    m.position.copy(p).addScaledVector(n, 0.01);
    m.lookAt(p.clone().add(n));
    this.deck.group.add(m);
    this.decals.push([m, this.deck.group]);
    if (this.decals.length > 60) { const [d, g] = this.decals.shift(); g.remove(d); d.geometry.dispose(); }
  }

  wake(e) {
    if (e.awake) return;
    e.awake = true;
    if (e.type === 'queen') { this.G.sfx.setMusic('boss'); this.G.area('THE QUEEN', '船の主が目覚めた'); }
    this.G.sfx.screech(e.type === 'queen' ? 0.5 : e.type === 'hound' ? 1.25 : 0.9 + Math.random() * 0.2);
  }

  kill(e) {
    const G = this.G;
    e.dead = 0.001;
    e.mesh.material.transparent = true;
    G.sfx.death();
    G.player.kills++;
    G.gainXp(e.T.xp);
    const c = new THREE.Vector3(e.x, e.T.h * 0.5, e.z);
    this.particles.burst(c, e.type === 'queen' ? 220 : 50, 0x8dff3a, e.type === 'queen' ? 9 : 5, 1.0);
    const s = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({ map: splatTex, transparent: true, depthWrite: false, roughness: 0.1, color: 0x88aa66 }));
    s.rotation.x = -Math.PI / 2; s.rotation.z = Math.random() * 6;
    s.scale.setScalar(e.type === 'queen' ? 6 : 2.4);
    s.position.set(e.x, 0.025, e.z);
    this.deck.group.add(s);
    if (e.type === 'queen') {
      G.log('女王を撃破！コアの封印が解けた', '#cf8');
      G.sfx.setMusic('ship');
      G.area('QUEEN SLAIN', '原初のコアを回収せよ');
    } else if (Math.random() < 0.4) {
      G.player.ammo += 12; G.log('パルス弾 ×12 を回収', '#8f8');
    }
  }

  spit(e, angleOff = 0) {
    const from = new THREE.Vector3(e.x, e.T.h * 0.6, e.z);
    const to = this.pos.clone().setY(EYE - 0.3);
    const dir = to.sub(from).normalize().applyAxisAngle(new THREE.Vector3(0, 1, 0), angleOff);
    const m = new THREE.Mesh(new THREE.SphereGeometry(e.type === 'queen' ? 0.22 : 0.15, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.6, 3, 0.3), toneMapped: false }));
    m.position.copy(from);
    this.scene.add(m);
    this.projectiles.push({ m, v: dir.multiplyScalar(e.type === 'queen' ? 11 : 9), dmg: e.T.dmg + this.deckIdx * 2, life: 4 });
    this.G.sfx.spit();
  }

  updateEnemy(e, dt) {
    const G = this.G;
    const m = e.mesh;
    m.rotation.y = Math.atan2(this.pos.x - e.x, this.pos.z - e.z);
    if (e.dead) {
      e.dead += dt;
      m.material.opacity = Math.max(0, 1 - e.dead / 1.0);
      m.scale.y = Math.max(0.05, m.scale.y - dt * 0.8);
      if (e.dead > 1) { this.deck.group.remove(m); e.removed = true; }
      return;
    }
    const dx = this.pos.x - e.x, dz = this.pos.z - e.z, dist = Math.hypot(dx, dz);
    const see = dist < 20 && this.los(e.x, e.z, this.pos.x, this.pos.z);
    if (!e.awake && ((see && dist < 13) || dist < 3.5)) this.wake(e);
    e.hit -= dt;
    m.material.emissive.setRGB(e.hit > 0 ? 1.2 : 0, e.hit > 0 ? 0.15 : 0, 0);
    let vx = 0, vz = 0;
    const T = e.T;
    if (e.awake) {
      const reach = e.r + 0.9;
      let wantMove = dist > reach * 0.85;
      if (T.ranged) {
        e.shootCd -= dt;
        if (see && dist < 18 && e.shootCd <= 0) {
          e.shootCd = T.ranged * rand(0.8, 1.2);
          if (e.type === 'queen') [-0.18, 0, 0.18].forEach(a => this.spit(e, a)); else this.spit(e);
        }
        if (e.type === 'spitter' && see && dist < 8) wantMove = false;
      }
      if (wantMove) {
        let tx = this.pos.x, tz = this.pos.z;
        if (!see && this.flow) {
          const ci = Math.floor(e.x / C), cj = Math.floor(e.z / C);
          let bd = this.flow[cj * N + ci], bi = ci, bj = cj;
          for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            const d = this.flow[(cj + oz) * N + ci + ox];
            if (d >= 0 && (bd < 0 || d < bd)) { bd = d; bi = ci + ox; bj = cj + oz; }
          }
          tx = (bi + 0.5) * C; tz = (bj + 0.5) * C;
        }
        const ddx = tx - e.x, ddz = tz - e.z, dd = Math.hypot(ddx, ddz) || 1;
        const sp = T.speed * (e.type === 'hound' && dist < 6 ? 1.3 : 1);
        vx = ddx / dd * sp; vz = ddz / dd * sp;
      }
      e.cd -= dt;
      if (dist < reach && e.cd <= 0) {
        e.cd = T.cd; e.lunge = 0.25;
        G.hurt(T.dmg + this.deckIdx * 2);
        this.shake = 0.25;
      }
      if (e.type === 'queen') {
        e.summon -= dt;
        if (e.summon <= 0 && this.deck.enemies.filter(o => !o.dead && o.type === 'hound').length < 6) {
          e.summon = 9;
          const h = this.spawn(this.deck, 'hound', e.x + rand(-1, 1), e.z + rand(-1, 1));
          this.wake(h);
          G.log('女王が眷属を呼び出した！', '#f9a');
        }
      }
    }
    // separation
    for (const o of this.deck.enemies) {
      if (o === e || o.dead) continue;
      const ox = e.x - o.x, oz = e.z - o.z, d = Math.hypot(ox, oz), md = e.r + o.r;
      if (d < md && d > 0.01) { vx += ox / d * 2.5; vz += oz / d * 2.5; }
    }
    e.x += vx * dt; e.z += vz * dt;
    this.collide(e, e.r);
    e.lunge -= dt;
    const moving = Math.abs(vx) + Math.abs(vz) > 0.2;
    e.phase += dt * (moving ? 9 : 2);
    const lungeF = e.lunge > 0 ? Math.sin(e.lunge / 0.25 * Math.PI) : 0;
    m.position.set(e.x + dx / (dist || 1) * lungeF * 0.4, moving ? Math.abs(Math.sin(e.phase)) * 0.06 : 0, e.z + dz / (dist || 1) * lungeF * 0.4);
    const breathe = 1 + Math.sin(e.phase) * (moving ? 0.025 : 0.012);
    m.scale.set(1 + lungeF * 0.08, breathe + lungeF * 0.08, 1);
  }

  // ------------------------------------------------------------ main update
  update(dt) {
    const G = this.G, keys = G.input.keys, deck = this.deck;
    this.time += dt;
    // look
    this.yaw -= G.input.dx * 0.0022;
    this.pitch = THREE.MathUtils.clamp(this.pitch - G.input.dy * 0.0022, -1.3, 1.3);
    // move
    const f = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw)), r = new THREE.Vector3(-f.z, 0, f.x);
    const mv = new THREE.Vector3();
    if (keys.has('w') || keys.has('arrowup')) mv.add(f);
    if (keys.has('s') || keys.has('arrowdown')) mv.sub(f);
    if (keys.has('d') || keys.has('arrowright')) mv.add(r);
    if (keys.has('a') || keys.has('arrowleft')) mv.sub(r);
    const moving = mv.lengthSq() > 0 && dt > 0;
    const sprint = keys.has('shift');
    if (moving) {
      mv.normalize().multiplyScalar((sprint ? 6.8 : 4.0) * dt);
      const p = { x: this.pos.x + mv.x, z: this.pos.z + mv.z };
      this.collide(p, 0.45);
      this.pos.x = p.x; this.pos.z = p.z;
      this.bob += dt * (sprint ? 13 : 9);
    }
    // explored cells for the minimap
    const pc = Math.floor(this.pos.x / C), pz = Math.floor(this.pos.z / C);
    for (let j = pz - 2; j <= pz + 2; j++) for (let i = pc - 2; i <= pc + 2; i++) if (i >= 0 && j >= 0 && i < N && j < N) deck.explored[j * N + i] = 1;
    // flow field toward the player
    if (pz * N + pc !== this.flowCell) { this.flowCell = pz * N + pc; this.flow = this.bfs(this.grid, pc, pz); }

    // camera
    this.shake = Math.max(0, (this.shake || 0) - dt);
    const bobY = moving ? Math.sin(this.bob * 2) * 0.045 : 0;
    this.camera.position.set(this.pos.x, EYE + bobY, this.pos.z);
    this.camera.rotation.set(this.pitch + (Math.random() - 0.5) * this.shake * 0.08, this.yaw + (Math.random() - 0.5) * this.shake * 0.08, 0);
    this.camera.updateMatrixWorld();

    // gun sway / recoil
    this.recoil = Math.max(0, this.recoil - dt * 9);
    const rl = G.player.reloading > 0 ? Math.sin(Math.min(1, (1.4 - G.player.reloading) / 1.4) * Math.PI) : 0;
    this.gun.position.set(0.26 + (moving ? Math.sin(this.bob) * 0.012 : 0), -0.25 + bobY * 0.3 - rl * 0.18 + Math.sin(this.time * 1.5) * 0.003, -0.42 + this.recoil * 0.06);
    this.gun.rotation.set(this.recoil * 0.08 - rl * 0.5, 0, rl * 0.4);
    this.drawAmmoScreen();
    if (this.muzzleT > 0) { this.muzzleT -= dt; if (this.muzzleT <= 0) this.muzzle.visible = false; }
    this.muzzleLight.intensity *= Math.pow(0.0005, dt);
    if (this.tracerT > 0) { this.tracerT -= dt; if (this.tracerT <= 0) this.tracer.visible = false; }
    this.spot.intensity = G.flashlight ? 55 * (Math.random() < 0.004 ? 0.2 : 1) : 0;

    if (G.input.down && G.input.locked && dt > 0 && !sprint) this.shoot();

    // enemies
    for (const e of deck.enemies) this.updateEnemy(e, dt);
    deck.enemies = deck.enemies.filter(e => !e.removed);

    // projectiles
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.m.position.addScaledVector(p.v, dt);
      p.life -= dt;
      const q = p.m.position;
      let done = p.life <= 0;
      if (!done && Math.hypot(q.x - this.pos.x, q.z - this.pos.z) < 0.55 && q.y < EYE + 0.3) { G.hurt(p.dmg); this.shake = 0.2; done = true; }
      if (!done && (this.wall(Math.floor(q.x / C), Math.floor(q.z / C)) || q.y < 0)) done = true;
      if (done) {
        this.particles.burst(q, 16, 0x8dff3a, 2.5, 0.5);
        this.scene.remove(p.m); p.m.geometry.dispose();
        this.projectiles.splice(i, 1);
      }
    }

    // pickups
    for (const p of deck.pickups) {
      if (p.taken) continue;
      p.mesh.rotation.y = Math.atan2(this.pos.x - p.x, this.pos.z - p.z);
      if (Math.hypot(p.x - this.pos.x, p.z - this.pos.z) < 1.3) {
        p.taken = true; deck.group.remove(p.mesh); G.sfx.pickup();
        if (p.kind === 'med') { G.player.medkits++; G.log('メディキットを入手', '#8f8'); }
        else { G.player.ammo += 40; G.log('パルス弾 ×40 を入手', '#8f8'); }
      }
    }

    // artifact
    const a = deck.artifact;
    if (!a.taken) {
      a.mesh.position.y = 1.3 + Math.sin(this.time * 1.8) * 0.12;
      a.mesh.rotation.y = Math.atan2(this.pos.x - a.pos.x, this.pos.z - a.pos.z);
      a.glow.position.y = a.mesh.position.y + 0.5;
      a.glow.material.opacity = 0.6 + Math.sin(this.time * 3) * 0.2;
      a.light.intensity = 10 + Math.sin(this.time * 3) * 3;
    }

    // lights flicker
    for (const L of deck.lights) {
      if (!L.userData.flicker) continue;
      const on = Math.sin(this.time * 13 + L.position.x) > -0.85 && Math.random() > 0.03;
      L.intensity = on ? L.userData.base : L.userData.base * 0.05;
      L.userData.fix.visible = on;
    }

    // dust follows player
    for (let i = 0; i < this.dust.length; i += 3) {
      this.dust[i + 1] += Math.sin(this.time * 0.5 + i) * dt * 0.05;
      for (let k = 0; k < 3; k++) {
        const c = k === 1 ? EYE : (k === 0 ? this.pos.x : this.pos.z);
        if (this.dust[i + k] < c - 6) this.dust[i + k] += 12;
        if (this.dust[i + k] > c + 6) this.dust[i + k] -= 12;
      }
      // keep motes off the lens: point size explodes as distance -> 0
      const ex = this.dust[i] - this.pos.x, ey = this.dust[i + 1] - EYE, ez = this.dust[i + 2] - this.pos.z;
      const dl = Math.hypot(ex, ey, ez);
      if (dl < 1.5) { const k = 1.5 / (dl || 1e-3); this.dust[i] = this.pos.x + ex * k; this.dust[i + 1] = EYE + ey * k; this.dust[i + 2] = this.pos.z + ez * k; }
    }
    this.dustPts.geometry.attributes.position.needsUpdate = true;
    this.particles.update(dt);

    // prompts
    let prompt = null;
    if (!a.taken && Math.hypot(a.pos.x - this.pos.x, a.pos.z - this.pos.z) < 2.2) prompt = '[E] アーティファクトを回収する';
    else {
      const d = this.nearDoor();
      if (d) prompt = d.kind === 'evac' ? '[E] 緊急リフト：森へ戻る' : d.locked ? 'リフト（ロック中）' : `[E] リフト：${DECKS[this.deckIdx + 1].name}へ降りる`;
    }
    G.prompt(prompt);
    this.drawMinimap(dt);
  }

  drawMinimap(dt) {
    const g = this.mm, deck = this.deck, S = 200, ppu = 3.6;
    g.clearRect(0, 0, S, S);
    g.save();
    g.beginPath(); g.arc(S / 2, S / 2, S / 2 - 1, 0, Math.PI * 2); g.clip();
    g.translate(S / 2, S / 2);
    g.rotate(this.yaw);
    g.translate(-this.pos.x * ppu, -this.pos.z * ppu);
    g.fillStyle = 'rgba(90,255,140,0.22)';
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      if (deck.grid[j * N + i] && deck.explored[j * N + i]) g.fillRect(i * C * ppu, j * C * ppu, C * ppu + 0.5, C * ppu + 0.5);
    }
    const mark = (p, col, r) => { g.fillStyle = col; g.beginPath(); g.arc(p.x * ppu, p.z * ppu, r, 0, Math.PI * 2); g.fill(); };
    for (const d of [deck.evac, deck.lift]) if (d && deck.explored[Math.floor(d.front.z / C) * N + Math.floor(d.front.x / C)]) mark(d.front, d.locked ? '#f53' : '#5f8', 4);
    if (!deck.artifact.taken && deck.explored[Math.floor(deck.artifact.pos.z / C) * N + Math.floor(deck.artifact.pos.x / C)]) mark(deck.artifact.pos, '#cdf', 5);
    // motion tracker blips
    const pulse = (this.time % 1.2) / 1.2;
    let nearest = 99;
    for (const e of deck.enemies) {
      if (e.dead) continue;
      const d = Math.hypot(e.x - this.pos.x, e.z - this.pos.z);
      if (d > 26) continue;
      nearest = Math.min(nearest, d);
      g.globalAlpha = 1 - pulse * 0.7;
      mark(e, '#ff4a3a', e.type === 'queen' ? 6 : 3);
    }
    g.globalAlpha = 1;
    g.restore();
    // sweep ring + player
    g.strokeStyle = `rgba(120,255,160,${0.5 * (1 - pulse)})`;
    g.beginPath(); g.arc(S / 2, S / 2, pulse * S / 2, 0, Math.PI * 2); g.stroke();
    g.fillStyle = '#cfe';
    g.beginPath(); g.moveTo(S / 2, S / 2 - 7); g.lineTo(S / 2 - 5, S / 2 + 5); g.lineTo(S / 2 + 5, S / 2 + 5); g.fill();
    this.beepT -= dt;
    if (nearest < 26 && this.beepT <= 0) { this.G.sfx.beep(nearest < 8); this.beepT = THREE.MathUtils.clamp(nearest / 14, 0.25, 1.2); }
  }
}
