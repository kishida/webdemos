import * as THREE from 'three';
import { Hero } from './hero.js';
import { blobTex, glowTex, flashTex, splatTex, ringTex, aspect, mirrored, rand, Particles } from './util.js';

const VIEW_H = 22;                 // world units visible vertically
const CAM_OFF = new THREE.Vector3(18, 21, 18);
const BOUND = 46;
const SHIP_POS = new THREE.Vector3(0, 0, -20);
const SHIP_W = 36;                 // sprite width in world units
let ENTRANCE = new THREE.Vector3();   // computed from the ship image
const SHIP_CY = 0.32;              // sprite anchor (ground centre of the hull) in image space
// points measured on assets/ship_ext.png (998x690)
const SHIP_HATCH_PX = [425, 650];
const SHIP_AXIS_PX = [[110, 330], [880, 520]];   // hull ground centre line
const SHIP_EDGE_PX = [[60, 420], [880, 610]];    // near bottom edge of the hull
const START = new THREE.Vector3(4, 0, 32);
// which way the raw sprites face (true = right)
const PLAYER_FACES_RIGHT = false;
const HOUND_FACES_RIGHT = true;
const TINT = new THREE.Color(1.15, 1.2, 1.12);

export class Forest {
  constructor(G) {
    this.G = G;
    const A = G.assets;
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x06100a);
    const a = innerWidth / innerHeight;
    this.camera = new THREE.OrthographicCamera(-VIEW_H * a / 2, VIEW_H * a / 2, VIEW_H / 2, -VIEW_H / 2, 1, 200);
    this.colliders = [];
    this.hounds = [];
    this.bullets = [];
    this.crates = [];
    this.splats = [];
    this.ray = new THREE.Raycaster();
    this.aimPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -1.1);   // aim at body height, not the ground
    this.aim = new THREE.Vector3();
    this.time = 0;

    // lights: late dusk, cold sky + warm low sun
    this.scene.add(new THREE.HemisphereLight(0xb8c8d8, 0x3a4528, 2.2));
    const sun = new THREE.DirectionalLight(0xffd2a0, 2.6);
    sun.position.set(-30, 30, 12);
    this.scene.add(sun);

    // ground
    for (const t of [A.forest_ground, A.forest_ground_n]) {
      t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(22, 22);
    }
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(220, 220),
      new THREE.MeshStandardMaterial({ map: A.forest_ground, normalMap: A.forest_ground_n, normalScale: new THREE.Vector2(1.2, 1.2), roughness: 1, color: 0xd8e0c8 }));
    ground.rotation.x = -Math.PI / 2;
    this.scene.add(ground);

    // crashed ship
    const shipH = SHIP_W / aspect(A.ship_ext);
    this.ship = this.sprite(A.ship_ext, SHIP_POS, SHIP_W, shipH, SHIP_CY);
    const toGround = this.imageToGround(A.ship_ext, SHIP_POS, SHIP_W, shipH, SHIP_CY);
    ENTRANCE = toGround(...SHIP_HATCH_PX);
    this.blob(SHIP_POS.x, SHIP_POS.z, SHIP_W * 0.9, SHIP_W * 0.55, 0.9).rotation.z = -0.35;
    // footprint collider: circles along the hull centre line, radius reaching the near edge
    for (let i = 0; i <= 12; i++) {
      const t = i / 12, lerp = (a, b) => a + (b - a) * t;
      const c = toGround(lerp(SHIP_AXIS_PX[0][0], SHIP_AXIS_PX[1][0]), lerp(SHIP_AXIS_PX[0][1], SHIP_AXIS_PX[1][1]));
      const e = toGround(lerp(SHIP_EDGE_PX[0][0], SHIP_EDGE_PX[1][0]), lerp(SHIP_EDGE_PX[0][1], SHIP_EDGE_PX[1][1]));
      this.colliders.push({ x: c.x, z: c.z, r: Math.max(1.5, c.distanceTo(e) * 0.9), ship: true });
    }

    // entrance marker
    this.ring = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), new THREE.MeshBasicMaterial({ map: ringTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0x88ffaa }));
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.position.copy(ENTRANCE).setY(0.05);
    this.ring.renderOrder = 5;
    this.ring.material.depthTest = false;
    this.scene.add(this.ring);
    this.hatchLight = new THREE.PointLight(0x55ff88, 30, 16, 1.6);
    this.hatchLight.position.copy(ENTRANCE).setY(2.5);
    this.scene.add(this.hatchLight);

    // vegetation
    const trees = [[A.tree_pine, 9.5], [A.tree_pine, 8.5], [A.tree_oak, 8], [A.tree_dead, 7]];
    const placed = [];
    const ok = (x, z, minD) => {
      if (this.colliders.some(c => c.ship && Math.hypot(c.x - x, c.z - z) < c.r + 4)) return false;
      if (distSeg(x, z, START, ENTRANCE) < 4) return false;
      if (Math.hypot(x - START.x, z - START.z) < 6) return false;
      return placed.every(p => Math.hypot(p[0] - x, p[1] - z) > minD);
    };
    for (let n = 0, tries = 0; n < 230 && tries < 6000; tries++) {
      const edge = Math.random() < 0.45;
      let x = rand(-BOUND - 6, BOUND + 6), z = rand(-BOUND - 6, BOUND + 6);
      if (edge) { if (Math.random() < 0.5) x = Math.sign(x || 1) * rand(BOUND - 4, BOUND + 8); else z = Math.sign(z || 1) * rand(BOUND - 4, BOUND + 8); }
      if (!ok(x, z, edge ? 2.6 : 3.6)) continue;
      const [tex, h] = trees[Math.floor(Math.random() * trees.length)];
      const hh = h * rand(0.8, 1.25);
      const w = hh * aspect(tex);
      this.sprite(Math.random() < 0.5 ? tex : (tex._m ||= mirrored(tex)), new THREE.Vector3(x, 0, z), w, hh, 0.02);
      this.blob(x + w * 0.25, z + 0.3, w * 0.9, w * 0.45, 0.8);
      this.colliders.push({ x, z, r: 0.7 });
      placed.push([x, z]); n++;
    }
    for (let n = 0, tries = 0; n < 70 && tries < 3000; tries++) {
      const x = rand(-BOUND, BOUND), z = rand(-BOUND, BOUND);
      if (!ok(x, z, 1.8)) continue;
      const rock = Math.random() < 0.3;
      const tex = rock ? A.rock : A.bush;
      const h = rock ? rand(1.2, 2.2) : rand(1.2, 1.9);
      const w = h * aspect(tex);
      this.sprite(tex, new THREE.Vector3(x, 0, z), w, h, 0.05);
      this.blob(x + w * 0.15, z + 0.2, w * 1.0, w * 0.5, 0.6);
      if (rock) this.colliders.push({ x, z, r: w * 0.4 });
      placed.push([x, z]); n++;
    }

    // supply crates
    for (let n = 0, tries = 0; n < 6 && tries < 500; tries++) {
      const x = rand(-BOUND + 4, BOUND - 4), z = rand(-BOUND + 4, BOUND - 4);
      if (!ok(x, z, 3)) continue;
      const s = this.sprite(A.crate, new THREE.Vector3(x, 0, z), 1.3 * aspect(A.crate), 1.3, 0.05);
      this.blob(x, z, 1.8, 1.0, 0.7);
      this.crates.push({ x, z, mesh: s, kind: n % 3 === 2 ? 'med' : 'ammo' });
      placed.push([x, z]); n++;
    }

    // player
    this.pTex = PLAYER_FACES_RIGHT ? [A.player, mirrored(A.player)] : [mirrored(A.player), A.player];
    this.player = this.sprite(A.player, START.clone(), 2.7 * aspect(A.player), 2.7, 0.02);
    this.player.material = this.player.material.clone();
    this.pShadow = this.blob(0, 0, 1.6, 0.9, 0.7);
    this.pos = START.clone();
    this.facing = 1;
    this.walk = 0;
    this.hero = new Hero(G.renderer, CAM_OFF);   // animated 3D soldier; static sprite until it loads
    this.heroDir = new THREE.Vector3(-1, 0, -1);

    // muzzle flash + light
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({ map: flashTex, blending: THREE.AdditiveBlending, depthWrite: false, color: 0xffe0a0 }));
    this.flash.scale.set(1.4, 1.4, 1);
    this.flash.visible = false;
    this.flash.renderOrder = 10;
    this.flash.material.depthTest = false;
    this.scene.add(this.flash);
    this.flashLight = new THREE.PointLight(0xffb060, 0, 12, 1.5);
    this.scene.add(this.flashLight);
    // player lantern so the hero stands out at dusk
    this.lantern = new THREE.PointLight(0xffe6c0, 12, 9, 1.4);
    this.scene.add(this.lantern);

    // aim reticle
    this.reticle = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: ringTex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, color: 0xff9966 }));
    this.reticle.rotation.x = -Math.PI / 2;
    this.reticle.renderOrder = 10;
    this.reticle.material.depthTest = false;
    this.scene.add(this.reticle);

    this.particles = new Particles(this.scene, 500, 6, false);
    this.particles.points.renderOrder = 10;
    this.particles.mat.depthTest = false;

    // fireflies
    const ff = 140;
    this.ffPos = new Float32Array(ff * 3);
    this.ffPhase = new Float32Array(ff);
    for (let i = 0; i < ff; i++) {
      this.ffPos[i * 3] = rand(-BOUND, BOUND); this.ffPos[i * 3 + 1] = rand(0.4, 3); this.ffPos[i * 3 + 2] = rand(-BOUND, BOUND);
      this.ffPhase[i] = Math.random() * 10;
    }
    const fg = new THREE.BufferGeometry();
    fg.setAttribute('position', new THREE.BufferAttribute(this.ffPos, 3));
    this.fireflies = new THREE.Points(fg, new THREE.PointsMaterial({ size: 7, sizeAttenuation: false, map: glowTex, color: 0xd8ff70,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
    this.fireflies.frustumCulled = false;
    this.fireflies.renderOrder = 9;
    this.scene.add(this.fireflies);

    // drifting mist
    this.mist = [];
    for (let i = 0; i < 26; i++) {
      const m = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: 0x9fb8b0, opacity: 0.07, transparent: true, depthWrite: false }));
      m.scale.set(rand(14, 24), rand(5, 8), 1);
      m.position.set(rand(-BOUND, BOUND), 1.5, rand(-BOUND, BOUND));
      m.userData.v = rand(0.3, 0.8);
      m.renderOrder = 8; m.material.depthTest = false;
      this.mist.push(m); this.scene.add(m);
    }

    for (let i = 0; i < 9; i++) this.spawnHound(20);
  }

  // world ground point seen at pixel (px,py) of a sprite anchored at pos (ortho camera => exact)
  imageToGround(tex, pos, w, h, cy) {
    const cam = new THREE.OrthographicCamera();
    cam.position.copy(CAM_OFF); cam.lookAt(0, 0, 0); cam.updateMatrixWorld();
    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
    const fwd = CAM_OFF.clone().negate().normalize();
    const iw = tex.image.width, ih = tex.image.height;
    return (px, py) => {
      const p = pos.clone().addScaledVector(right, (px / iw - 0.5) * w).addScaledVector(up, (1 - py / ih - cy) * h);
      return p.addScaledVector(fwd, -p.y / fwd.y).setY(0);
    };
  }

  sprite(tex, pos, w, h, cy) {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false, color: TINT }));
    s.center.set(0.5, cy);
    s.scale.set(w, h, 1);
    s.position.copy(pos);
    this.scene.add(s);
    return s;
  }

  blob(x, z, w, d, opacity) {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false, opacity }));
    m.rotation.x = -Math.PI / 2;
    m.scale.set(w, d, 1);
    m.position.set(x, 0.02, z);
    m.renderOrder = -2;
    this.scene.add(m);
    return m;
  }

  spawnHound(minDist) {
    const A = this.G.assets;
    let x, z;
    for (let t = 0; t < 200; t++) {
      x = rand(-BOUND + 3, BOUND - 3); z = rand(-BOUND + 3, BOUND - 3);
      const pp = this.pos || START;
      if (Math.hypot(x - pp.x, z - pp.z) > minDist && !this.blocked(x, z, 1)) break;
    }
    const h = 2.0, w = h * aspect(A.hound);
    const s = this.sprite(A.hound, new THREE.Vector3(x, 0, z), w, h, 0.04);
    s.material = s.material.clone();
    const tex = HOUND_FACES_RIGHT ? [A.hound, mirrored(A.hound)] : [mirrored(A.hound), A.hound];
    this.hounds.push({ mesh: s, tex, shadow: this.blob(x, z, w * 0.8, 0.9, 0.7), x, z, hp: 40 + this.G.player.lv * 4, cd: 0,
      state: 'wander', dir: Math.random() * 6.28, t: rand(1, 3), hit: 0, dead: 0, alerted: false });
  }

  blocked(x, z, r) {
    return this.colliders.some(c => (c.x - x) ** 2 + (c.z - z) ** 2 < (c.r + r) ** 2);
  }

  // move with sliding against circular colliders
  move(o, dx, dz, r) {
    let nx = o.x + dx, nz = o.z + dz;
    for (const c of this.colliders) {
      const ddx = nx - c.x, ddz = nz - c.z, d = Math.hypot(ddx, ddz), m = c.r + r;
      if (d < m && d > 1e-4) { nx = c.x + ddx / d * m; nz = c.z + ddz / d * m; }
    }
    o.x = THREE.MathUtils.clamp(nx, -BOUND, BOUND);
    o.z = THREE.MathUtils.clamp(nz, -BOUND, BOUND);
  }

  enter(kind) {
    if (kind === 'return') {
      this.pos.copy(ENTRANCE).add(new THREE.Vector3(0, 0, 3));
      for (let i = 0; i < 3; i++) this.spawnHound(22);
      this.G.area('FOREST', '異星船の外へ脱出した');
    } else {
      this.G.area('THE FOREST', '墜落地点 — 北へ進め');
    }
  }
  exit() { this.G.input.down = false; }

  resize() {
    const a = innerWidth / innerHeight;
    Object.assign(this.camera, { left: -VIEW_H * a / 2, right: VIEW_H * a / 2, top: VIEW_H / 2, bottom: -VIEW_H / 2 });
    this.camera.updateProjectionMatrix();
  }

  interact() {
    const G = this.G, p = G.player;
    if (this.pos.distanceTo(ENTRANCE) < 3.2) { G.switchTo(G.ship); return; }
    for (const c of this.crates) {
      if (c.opened || Math.hypot(c.x - this.pos.x, c.z - this.pos.z) > 2.4) continue;
      c.opened = true;
      c.mesh.material = c.mesh.material.clone();
      c.mesh.material.color.setScalar(0.4);
      G.sfx.pickup();
      if (c.kind === 'med') { p.medkits++; G.log('補給箱：メディキットを入手', '#8f8'); }
      else { p.ammo += 45; G.log('補給箱：パルス弾 ×45 を入手', '#8f8'); }
      return;
    }
  }

  shoot() {
    const G = this.G;
    if (!G.tryFire()) return;
    const from = new THREE.Vector3(this.pos.x, 1.25, this.pos.z);
    const dir = this.aim.clone().sub(from).setY(0).normalize();
    dir.applyAxisAngle(new THREE.Vector3(0, 1, 0), (Math.random() - 0.5) * 0.06);
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.07, 1.1), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 2.6, 0.9), toneMapped: false, transparent: true, depthTest: false }));
    m.renderOrder = 10;
    m.position.copy(from);
    m.lookAt(from.clone().add(dir));
    this.scene.add(m);
    this.bullets.push({ m, dir, life: 0.6 });
    this.flash.position.copy(from).addScaledVector(dir, 0.9);
    this.flash.material.rotation = Math.random() * 6;
    this.flash.visible = true;
    this.flashT = 0.05;
    this.flashLight.position.copy(this.flash.position);
    this.flashLight.intensity = 40;
  }

  update(dt) {
    const G = this.G, keys = G.input.keys;
    this.time += dt;
    G.sfx.tickForest(dt);

    // --- player movement (screen relative)
    const fwd = new THREE.Vector3(-1, 0, -1).normalize(), right = new THREE.Vector3(1, 0, -1).normalize();
    const mv = new THREE.Vector3();
    if (keys.has('w') || keys.has('arrowup')) mv.add(fwd);
    if (keys.has('s') || keys.has('arrowdown')) mv.sub(fwd);
    if (keys.has('d') || keys.has('arrowright')) mv.add(right);
    if (keys.has('a') || keys.has('arrowleft')) mv.sub(right);
    const moving = mv.lengthSq() > 0;
    if (moving) {
      mv.normalize().multiplyScalar((keys.has('shift') ? 8.5 : 5.5) * dt);
      this.move(this.pos, mv.x, mv.z, 0.5);
      this.walk += dt * 10;
    }

    // --- camera
    this.camera.position.copy(this.pos).add(CAM_OFF);
    this.camera.lookAt(this.pos);
    this.camera.updateMatrixWorld();

    // --- aim
    this.ray.setFromCamera(G.input.mouse, this.camera);
    this.ray.ray.intersectPlane(this.aimPlane, this.aim);
    this.reticle.position.copy(this.aim);
    this.reticle.rotation.z += dt * 2;
    this.player.position.copy(this.pos);
    if (this.hero.ready) {
      // face the aim while shooting or standing, otherwise the walking direction
      const aimDir = this.aim.clone().sub(this.pos).setY(0);
      this.heroDir.copy(moving && !G.input.down ? mv : aimDir);
      this.hero.update(dt, this.heroDir, moving ? (keys.has('shift') ? 'run' : 'walk') : 'idle');
      const m = this.player.material;
      if (m.map !== this.hero.rt.texture) {
        m.map = this.hero.rt.texture; m.premultipliedAlpha = true; m.needsUpdate = true;
        this.player.center.copy(this.hero.center);
        this.player.scale.set(this.hero.size.x, this.hero.size.y, 1);
      }
    } else {
      const scr = this.aim.clone().project(this.camera).x - this.pos.clone().project(this.camera).x;
      if (Math.abs(scr) > 0.01) this.facing = scr > 0 ? 1 : -1;
      this.player.material.map = this.facing > 0 ? this.pTex[0] : this.pTex[1];
      const bob = moving ? Math.abs(Math.sin(this.walk)) * 0.06 : Math.sin(this.time * 2) * 0.01;
      this.player.scale.y = 2.7 * (1 + bob * 0.5);
      this.player.position.y = bob;
    }
    this.pShadow.position.set(this.pos.x + 0.3, 0.03, this.pos.z + 0.1);
    this.lantern.position.set(this.pos.x, 3, this.pos.z + 1);

    if (G.input.down && dt > 0) this.shoot();

    // --- bullets
    for (let i = this.bullets.length - 1; i >= 0; i--) {
      const b = this.bullets[i];
      const step = 55 * dt;
      const px = b.m.position.x, pz = b.m.position.z;   // swept test over this frame's segment
      b.m.position.addScaledVector(b.dir, step);
      b.life -= dt;
      let hit = b.life <= 0;
      let bx = b.m.position.x, bz = b.m.position.z;
      for (const h of this.hounds) {
        if (h.dead || hit) continue;
        const t = THREE.MathUtils.clamp((h.x - px) * b.dir.x + (h.z - pz) * b.dir.z, 0, step);
        if (Math.hypot(h.x - (px + b.dir.x * t), h.z - (pz + b.dir.z * t)) < 1.1) {
          bx = px + b.dir.x * t; bz = pz + b.dir.z * t;
          hit = true;
          const d = G.damage();
          h.hp -= d; h.hit = 0.12; h.alerted = true; h.state = 'chase';
          h.x += b.dir.x * 0.35; h.z += b.dir.z * 0.35;
          this.particles.burst(new THREE.Vector3(bx, 0.9, bz), 14, 0x7dff3a, 4, 0.5);
          G.sfx.hit();
          if (h.hp <= 0) this.killHound(h);
        }
      }
      if (!hit && this.colliders.some(c => (c.x - bx) ** 2 + (c.z - bz) ** 2 < c.r * c.r)) {
        hit = true;
        this.particles.burst(b.m.position, 8, 0xffb060, 3, 0.3);
      }
      if (hit) { this.scene.remove(b.m); b.m.geometry.dispose(); this.bullets.splice(i, 1); }
    }
    if (this.flashT > 0) { this.flashT -= dt; if (this.flashT <= 0) this.flash.visible = false; }
    this.flashLight.intensity *= Math.pow(0.001, dt);

    // --- hounds
    for (const h of this.hounds) this.updateHound(h, dt);
    this.hounds = this.hounds.filter(h => !(h.dead && h.dead > 1.2 && (this.scene.remove(h.mesh), this.scene.remove(h.shadow), true)));

    // --- interaction prompt
    let prompt = null;
    if (this.pos.distanceTo(ENTRANCE) < 3.2) prompt = '[E] 異星船に入る';
    else if (this.crates.some(c => !c.opened && Math.hypot(c.x - this.pos.x, c.z - this.pos.z) < 2.4)) prompt = '[E] 補給箱を開ける';
    G.prompt(prompt);

    // --- ambience
    this.ring.rotation.z += dt * 0.6;
    this.ring.material.opacity = 0.6 + Math.sin(this.time * 3) * 0.3;
    this.hatchLight.intensity = 26 + Math.sin(this.time * 2.3) * 6 + (Math.random() < 0.02 ? -15 : 0);
    for (let i = 0; i < this.ffPhase.length; i++) {
      const t = this.time + this.ffPhase[i];
      this.ffPos[i * 3] += Math.sin(t * 0.7) * dt * 0.6;
      this.ffPos[i * 3 + 1] = 1.2 + Math.sin(t * 0.9) * 0.9;
      this.ffPos[i * 3 + 2] += Math.cos(t * 0.5) * dt * 0.6;
    }
    this.fireflies.geometry.attributes.position.needsUpdate = true;
    this.fireflies.material.opacity = 0.6 + Math.sin(this.time * 4) * 0.25;
    for (const m of this.mist) {
      m.position.x += m.userData.v * dt;
      if (m.position.x > BOUND + 15) m.position.x = -BOUND - 15;
    }
    this.particles.update(dt);
  }

  updateHound(h, dt) {
    const G = this.G;
    if (h.dead) {
      h.dead += dt;
      h.mesh.material.opacity = Math.max(0, 1 - h.dead / 1.2);
      h.mesh.scale.y *= 0.985;
      return;
    }
    if (dt === 0) return;
    const dx = this.pos.x - h.x, dz = this.pos.z - h.z, dist = Math.hypot(dx, dz);
    if (!h.alerted && dist < 13) {
      h.alerted = true; h.state = 'chase';
      G.sfx.screech(1.1 + Math.random() * 0.2);
    }
    let vx = 0, vz = 0;
    if (h.state === 'chase') {
      if (dist > 1.4) { vx = dx / dist * 5.0; vz = dz / dist * 5.0; }
      h.cd -= dt;
      if (dist < 1.7 && h.cd <= 0) { h.cd = 1.0; G.hurt(6 + Math.floor(G.player.lv * 0.8)); }
      if (dist > 28) { h.state = 'wander'; h.alerted = false; }
    } else {
      h.t -= dt;
      if (h.t <= 0) { h.t = rand(1.5, 4); h.dir = Math.random() * 6.28; h.idle = Math.random() < 0.4; }
      if (!h.idle) { vx = Math.cos(h.dir) * 1.6; vz = Math.sin(h.dir) * 1.6; }
    }
    // separation
    for (const o of this.hounds) {
      if (o === h || o.dead) continue;
      const ox = h.x - o.x, oz = h.z - o.z, d = Math.hypot(ox, oz);
      if (d < 1.6 && d > 0.01) { vx += ox / d * 3; vz += oz / d * 3; }
    }
    this.move(h, vx * dt, vz * dt, 0.6);
    if (Math.abs(vx) + Math.abs(vz) > 0.1) {
      // screen-space x of the velocity direction: screen right is (1,0,-1)
      h.facing = (vx - vz) > 0 ? 0 : 1;
      h.mesh.material.map = h.tex[h.facing];
    }
    h.mesh.position.set(h.x, Math.abs(Math.sin(this.time * 12 + h.x)) * (h.state === 'chase' ? 0.12 : 0.03), h.z);
    h.shadow.position.set(h.x + 0.3, 0.03, h.z + 0.1);
    h.hit -= dt;
    h.mesh.material.color.copy(h.hit > 0 ? new THREE.Color(3, 0.6, 0.6) : TINT);
  }

  killHound(h) {
    const G = this.G;
    h.dead = 0.001;
    G.sfx.death();
    G.player.kills++;
    G.gainXp(15);
    this.particles.burst(new THREE.Vector3(h.x, 1, h.z), 40, 0x7dff3a, 6, 0.8);
    const s = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6), new THREE.MeshBasicMaterial({ map: splatTex, transparent: true, depthWrite: false, opacity: 0.8 }));
    s.rotation.x = -Math.PI / 2; s.rotation.z = Math.random() * 6;
    s.position.set(h.x, 0.04, h.z);
    s.renderOrder = -1;
    this.scene.add(s);
    if (Math.random() < 0.35) {
      G.player.ammo += 15;
      G.log('パルス弾 ×15 を回収', '#8f8');
    }
  }
}

function distSeg(x, z, a, b) {
  const abx = b.x - a.x, abz = b.z - a.z;
  const t = THREE.MathUtils.clamp(((x - a.x) * abx + (z - a.z) * abz) / (abx * abx + abz * abz), 0, 1);
  return Math.hypot(x - (a.x + abx * t), z - (a.z + abz * t));
}
