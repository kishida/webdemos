/* game.js — メインゲーム（入力・物理・カメラ・HUD・ゲームループ） */
(function () {
  'use strict';

  /* ================= レンダラー・シーン ================= */
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputEncoding = THREE.sRGBEncoding;
  document.body.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x8FD3F4);
  scene.fog = new THREE.Fog(0xA9DCF2, 120, 460);

  const camera = new THREE.PerspectiveCamera(58, window.innerWidth / window.innerHeight, 0.1, 1000);
  camera.position.set(0, 12, 24);

  /* ================= ライト・太陽 ================= */
  scene.add(new THREE.HemisphereLight(0xBFE8FF, 0x77A05C, 0.85));
  const sun = new THREE.DirectionalLight(0xFFF2D0, 1.25);
  sun.position.set(110, 160, 70);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -110;
  sun.shadow.camera.right = 110;
  sun.shadow.camera.top = 110;
  sun.shadow.camera.bottom = -110;
  sun.shadow.camera.near = 30;
  sun.shadow.camera.far = 480;
  sun.shadow.bias = -0.0006;
  scene.add(sun);
  const sunBall = new THREE.Mesh(
    new THREE.SphereGeometry(13, 12, 10),
    new THREE.MeshBasicMaterial({ color: 0xFFE9A0, fog: false })
  );
  sunBall.position.set(240, 330, 150);
  scene.add(sunBall);

  /* ================= 世界構築 ================= */
  const spawn = Isle.findSpawn();
  const summit = Isle.findSummit();
  Isle.spawn = spawn;
  Isle.summit = summit;

  Isle.buildTerrain(scene);
  Isle.buildWater(scene);
  Isle.buildTrees(scene, spawn, summit);
  Isle.buildRocks(scene, spawn);
  Isle.buildFlowers(scene);
  Isle.buildGrass(scene);
  Isle.buildClouds(scene);
  Isle.buildBirds(scene);
  Isle.buildPollen(scene);

  // スポーン地点の道しるべ（島の中心を指す）
  const toCenter = new THREE.Vector3(-spawn.x, 0, -spawn.z).normalize();
  Isle.buildSign(
    scene,
    spawn.x - toCenter.x * 2.2,
    spawn.z - toCenter.z * 2.2,
    Math.atan2(toCenter.x, toCenter.z)
  );

  /* ---- 浮島プラットフォーム ---- */
  Isle.platforms = [];
  const sidePlatforms = [];
  let guard = 0;
  while (sidePlatforms.length < 3 && guard++ < 500) {
    const a = Math.random() * Math.PI * 2;
    const r = 30 + Math.random() * 28;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    const h = Isle.terrainHeight(x, z);
    if (h < 3 || h > 12) continue;
    if (Math.hypot(x - spawn.x, z - spawn.z) < 18) continue;
    if (Math.hypot(x - summit.x, z - summit.z) < 14) continue;
    if (sidePlatforms.some(function (p) { return Math.hypot(p.x - x, p.z - z) < 16; })) continue;
    sidePlatforms.push({ x: x, z: z, h: h });
  }
  sidePlatforms.forEach(function (sp, i) {
    const p = Isle.makePlatform(sp.x, sp.h + 3.4, sp.z, 3.2, null);
    p.group.rotation.y = Math.random() * Math.PI * 2;
    Isle.platforms.push(p);
    scene.add(p.group);
  });

  /* ---- ゴールへの階段（頂上からの浮島チェーン） ---- */
  const chain = [
    { x: 0, z: -5.5, dy: 2, size: 3.4, move: null },
    { x: -4, z: -9, dy: 4, size: 3.2, move: { axis: 'x', amp: 2.0, speed: 0.7, phase: 0 } },
    { x: 0.5, z: -12.5, dy: 6, size: 3.0, move: null },
    { x: -3.5, z: -16.5, dy: 8, size: 3.0, move: { axis: 'z', amp: 2.2, speed: 0.6, phase: 2 } },
    { x: 1, z: -20.5, dy: 10, size: 3.6, move: null }
  ];
  chain.forEach(function (c) {
    const p = Isle.makePlatform(summit.x + c.x, summit.h + c.dy, summit.z + c.z, c.size, c.move);
    Isle.platforms.push(p);
    scene.add(p.group);
  });
  const goalPos = new THREE.Vector3(summit.x + chain[4].x, summit.h + chain[4].dy, summit.z + chain[4].z);
  Isle.buildGoal(scene, goalPos.x, goalPos.y, goalPos.z);
  Isle.setGoalActive(false);

  /* ---- フルーツ配置（地面 9 + 浮島 3 = 12） ---- */
  const fruitSpots = [];
  const groundSpots = Isle.scatter(9, function (x, z) {
    const h = Isle.terrainHeight(x, z);
    const dSpawn = Math.hypot(x - spawn.x, z - spawn.z);
    const dSummit = Math.hypot(x - summit.x, z - summit.z);
    return h > 1.6 && h < 13.5 && Isle.slopeAt(x, z) < 0.9 && dSpawn > 16 && dSummit > 10;
  }, 14);
  groundSpots.forEach(function (p) {
    fruitSpots.push({ x: p.x, y: Isle.terrainHeight(p.x, p.z) + 0.55, z: p.z });
  });
  sidePlatforms.forEach(function (sp) {
    fruitSpots.push({ x: sp.x, y: sp.h + 3.4 + 0.45, z: sp.z });
  });
  Isle.buildFruits(scene, fruitSpots);
  const totalFruits = Isle.fruits.length;
  document.getElementById('fruitCount').textContent = '0 / ' + totalFruits;

  /* ================= プレイヤー ================= */
  const player = Isle.createPlayer(scene);
  const P = {
    pos: new THREE.Vector3(spawn.x, spawn.h + 0.05, spawn.z),
    vel: new THREE.Vector3(),
    onGround: false,
    coyote: 0,
    jumpBuf: 0,
    standing: null
  };
  player.group.position.copy(P.pos);

  const PHYS = {
    gravity: -28, jump: 12.8, maxFall: -25,
    accel: 70, airAccel: 30, maxSpeed: 9.5, dashSpeed: 15, friction: 8, step: 0.62
  };

  /* ================= 入力 ================= */
  const keys = { f: false, b: false, l: false, r: false, jump: false, dash: false };
  const KEYMAP = {
    KeyW: 'f', ArrowUp: 'f',
    KeyS: 'b', ArrowDown: 'b',
    KeyA: 'l', ArrowLeft: 'l',
    KeyD: 'r', ArrowRight: 'r',
    Space: 'jump', ShiftLeft: 'dash', ShiftRight: 'dash'
  };
  window.addEventListener('keydown', function (e) {
    const k = KEYMAP[e.code];
    if (!k) return;
    if (e.code === 'Space') e.preventDefault();
    if (k === 'jump' && !keys.jump) P.jumpBuf = 0.12;
    keys[k] = true;
  });
  window.addEventListener('keyup', function (e) {
    const k = KEYMAP[e.code];
    if (k) keys[k] = false;
  });

  let camYaw = Math.atan2(spawn.x, spawn.z); // 島内を向く
  let camPitch = 0.35;
  let camDist = 11;
  let dragging = false, lastX = 0, lastY = 0;
  const canvas = renderer.domElement;
  canvas.addEventListener('mousedown', function (e) {
    dragging = true; lastX = e.clientX; lastY = e.clientY;
  });
  window.addEventListener('mousemove', function (e) {
    if (!dragging) return;
    camYaw -= (e.clientX - lastX) * 0.005;
    camPitch = Math.max(0.05, Math.min(1.25, camPitch + (e.clientY - lastY) * 0.005));
    lastX = e.clientX; lastY = e.clientY;
  });
  window.addEventListener('mouseup', function () { dragging = false; });
  canvas.addEventListener('wheel', function (e) {
    e.preventDefault();
    camDist = Math.max(5, Math.min(22, camDist + e.deltaY * 0.01));
  }, { passive: false });
  canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });

  window.addEventListener('resize', function () {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  /* ================= 物理 ================= */
  function physics(dt) {
    // カメラ相対の移動入力
    const fx = -Math.sin(camYaw), fz = -Math.cos(camYaw);
    const rx = Math.cos(camYaw), rz = -Math.sin(camYaw);
    let ix = (keys.r ? 1 : 0) - (keys.l ? 1 : 0);
    let iz = (keys.f ? 1 : 0) - (keys.b ? 1 : 0);
    let dx = fx * iz + rx * ix, dz = fz * iz + rz * ix;
    const len = Math.hypot(dx, dz);
    if (len > 0) { dx /= len; dz /= len; }

    const maxSpd = keys.dash ? PHYS.dashSpeed : PHYS.maxSpeed;
    const accel = P.onGround ? PHYS.accel : PHYS.airAccel;
    if (len > 0) {
      P.vel.x += dx * accel * dt;
      P.vel.z += dz * accel * dt;
      const h = Math.hypot(P.vel.x, P.vel.z);
      if (h > maxSpd) { P.vel.x *= maxSpd / h; P.vel.z *= maxSpd / h; }
    } else {
      const f = Math.max(0, 1 - PHYS.friction * dt);
      P.vel.x *= f; P.vel.z *= f;
    }

    // 重力
    P.vel.y = Math.max(PHYS.maxFall, P.vel.y + PHYS.gravity * dt);

    // ジャンプ（コヨーテタイム + バッファ）
    P.coyote = P.onGround ? 0.1 : P.coyote - dt;
    P.jumpBuf -= dt;
    if (P.jumpBuf > 0 && P.coyote > 0) {
      P.vel.y = PHYS.jump;
      P.onGround = false;
      P.coyote = 0;
      P.jumpBuf = 0;
      Isle.Sfx.jump();
    }

    // 移動中の浮島に乗ったら一緒に運ばれる
    if (P.standing) P.pos.add(P.standing.delta);

    // 水平移動（急斜面・崖はブロック）
    const stepBlock = function (nx, nz) {
      const h = Isle.terrainHeight(nx, nz);
      const dh = h - P.pos.y;
      return dh > PHYS.step && dh < 4;
    };
    if (P.vel.x !== 0 && !stepBlock(P.pos.x + P.vel.x * dt, P.pos.z)) P.pos.x += P.vel.x * dt;
    if (P.vel.z !== 0 && !stepBlock(P.pos.x, P.pos.z + P.vel.z * dt)) P.pos.z += P.vel.z * dt;

    // 垂直移動
    const prevVy = P.vel.y;
    P.pos.y += P.vel.y * dt;

    // プラットフォーム判定
    P.onGround = false;
    P.standing = null;
    for (let i = 0; i < Isle.platforms.length; i++) {
      const p = Isle.platforms[i];
      const top = p.group.position.y;
      const dxp = P.pos.x - p.group.position.x;
      const dzp = P.pos.z - p.group.position.z;
      const ox = p.half + player.half - Math.abs(dxp);
      const oz = p.half + player.half - Math.abs(dzp);
      if (ox > 0 && oz > 0) {
        const bottom = P.pos.y;
        if (P.vel.y <= 0.01 && bottom < top + 0.2 && bottom > top - 1.1) {
          P.pos.y = top;
          P.vel.y = 0;
          P.onGround = true;
          P.standing = p;
        } else if (bottom + player.height > top && bottom < top - 0.02) {
          if (P.vel.y > 0) {
            P.vel.y = 0; // 頭突き
          } else if (ox < oz) {
            P.pos.x += dxp > 0 ? ox : -ox;
          } else {
            P.pos.z += dzp > 0 ? oz : -oz;
          }
        }
      }
    }

    // 地形判定
    const gh = Isle.terrainHeight(P.pos.x, P.pos.z);
    if (P.vel.y <= 0.01 && P.pos.y <= gh + 0.08 && P.pos.y > gh - 1.4) {
      if (prevVy < -9) Isle.Sfx.land();
      P.pos.y = gh;
      P.vel.y = 0;
      P.onGround = true;
    } else if (P.pos.y < gh - 0.4) {
      P.pos.y = gh;
      P.vel.y = 0;
      P.onGround = true;
    }

    // 水に落ちた
    if (P.pos.y < -0.6) {
      Isle.Sfx.splash();
      respawn('水に落ちてしまった！');
    }

    player.group.position.copy(P.pos);
  }

  /* ================= HUD・状態 ================= */
  const el = {
    hud: document.getElementById('hud'),
    fruit: document.getElementById('fruitCount'),
    timer: document.getElementById('timer'),
    hint: document.getElementById('hint'),
    toast: document.getElementById('toast'),
    start: document.getElementById('start'),
    win: document.getElementById('win'),
    winTime: document.getElementById('winTime')
  };
  let state = 'start';
  let fruitCount = 0;
  let startTime = 0;
  let toastTimer = null;

  function toast(msg, dur) {
    el.toast.textContent = msg;
    el.toast.classList.remove('hidden');
    el.toast.style.opacity = '1';
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      el.toast.style.opacity = '0';
      setTimeout(function () { el.toast.classList.add('hidden'); }, 400);
    }, dur || 2200);
  }

  function fmtTime(sec) {
    const m = Math.floor(sec / 60);
    const s = Math.floor(sec % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function respawn(msg) {
    P.pos.set(spawn.x, spawn.h + 0.05, spawn.z);
    P.vel.set(0, 0, 0);
    toast(msg, 1600);
  }

  function winGame() {
    state = 'win';
    Isle.Sfx.win();
    const t = fmtTime((performance.now() - startTime) / 1000);
    el.winTime.textContent = 'クリアタイム ' + t;
    setTimeout(function () { el.win.classList.remove('hidden'); }, 600);
  }

  document.getElementById('startBtn').addEventListener('click', function () {
    Isle.Sfx.init();
    el.start.classList.add('hidden');
    el.hud.classList.remove('hidden');
    state = 'play';
    startTime = performance.now();
    toast('島のフルーツを集めよう！全部集めると頂のクリスタルが光る', 3200);
  });
  document.getElementById('retryBtn').addEventListener('click', function () {
    window.location.reload();
  });

  /* ================= ゲームループ ================= */
  const clock = new THREE.Clock();
  const camTarget = new THREE.Vector3(spawn.x, spawn.h + 1.7, spawn.z);

  function loop() {
    requestAnimationFrame(loop);
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;

    // 常時更新（環境）
    Isle.updateWater(t);
    Isle.updateClouds(dt);
    Isle.updateBirds(t, dt);
    Isle.updatePollen(t);
    Isle.updatePlatforms(t);
    Isle.updateGoal(t);

    if (state === 'play') {
      physics(dt);

      // プレイヤーアニメ
      const hSpd = Math.hypot(P.vel.x, P.vel.z);
      Isle.animatePlayer(player, dt, {
        moving: hSpd > 0.5, speed: hSpd, onGround: P.onGround, vy: P.vel.y
      });
      if (hSpd > 0.5) {
        const targetYaw = Math.atan2(P.vel.x, P.vel.z);
        let dy = targetYaw - player.group.rotation.y;
        dy = Math.atan2(Math.sin(dy), Math.cos(dy));
        player.group.rotation.y += dy * Math.min(1, 10 * dt);
      }

      // 進行方向へカメラを自動追従（ドラッグ中は手動優先）
      if (!dragging && hSpd > 0.5) {
        const camTargetYaw = Math.atan2(-P.vel.x, -P.vel.z);
        let cdy = camTargetYaw - camYaw;
        cdy = Math.atan2(Math.sin(cdy), Math.cos(cdy));
        camYaw += cdy * Math.min(1, 3.0 * dt);
      }

      // フルーツ収集
      const got = Isle.updateFruits(t, P.pos);
      if (got >= 0) {
        Isle.fruits[got].taken = true;
        Isle.fruits[got].group.visible = false;
        fruitCount++;
        Isle.Sfx.collect();
        el.fruit.textContent = fruitCount + ' / ' + totalFruits;
        if (fruitCount === totalFruits) {
          Isle.setGoalActive(true);
          toast('クリスタルが光り始めた！頂を目指せ！', 3000);
        } else {
          toast('フルーツ ' + fruitCount + ' / ' + totalFruits);
        }
      }

      // ゴール判定
      if (fruitCount === totalFruits) {
        const cy = Isle.goal.position.y + 1.5;
        const d = Math.hypot(
          P.pos.x - Isle.goal.position.x,
          P.pos.y + 0.9 - cy,
          P.pos.z - Isle.goal.position.z
        );
        if (d < 2.2) winGame();
      }

      // HUD
      if (fruitCount < totalFruits) {
        el.hint.textContent = 'フルーツを集めよう（頂上のクリスタルがゴール）';
      } else {
        el.hint.textContent = '頂上のクリスタルへ！';
      }
      el.timer.textContent = fmtTime((performance.now() - startTime) / 1000);
    }

    // カメラ（プレイヤー追尾 + 地形回避）
    const ideal = new THREE.Vector3(
      P.pos.x + Math.sin(camYaw) * Math.cos(camPitch) * camDist,
      P.pos.y + 1.7 + Math.sin(camPitch) * camDist,
      P.pos.z + Math.cos(camYaw) * Math.cos(camPitch) * camDist
    );
    const groundY = Isle.terrainHeight(ideal.x, ideal.z) + 0.8;
    if (ideal.y < groundY) ideal.y = groundY;
    camera.position.lerp(ideal, 1 - Math.exp(-12 * dt));
    camTarget.lerp(new THREE.Vector3(P.pos.x, P.pos.y + 1.7, P.pos.z), 1 - Math.exp(-16 * dt));
    camera.lookAt(camTarget);

    renderer.render(scene, camera);
  }

  loop();
})();
