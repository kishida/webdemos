/* world.js — 島の地形生成と自然要素のプロシージャルモデリング */
window.Isle = window.Isle || {};

/* ================= ノイズ ================= */
Isle.noise = (function () {
  function hash(ix, iz) {
    let h = (ix * 374761393 + iz * 668265263) | 0;
    h = ((h ^ (h >> 13)) * 1274126177) | 0;
    return ((h ^ (h >> 16)) >>> 0) / 4294967295;
  }
  function smooth(t) { return t * t * (3 - 2 * t); }
  function valueNoise(x, z) {
    const ix = Math.floor(x), iz = Math.floor(z);
    const fx = x - ix, fz = z - iz;
    const a = hash(ix, iz), b = hash(ix + 1, iz);
    const c = hash(ix, iz + 1), d = hash(ix + 1, iz + 1);
    const u = smooth(fx), v = smooth(fz);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }
  function fbm(x, z, octaves) {
    let amp = 0.5, sum = 0, norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += valueNoise(x, z) * amp;
      norm += amp;
      x *= 2.03; z *= 1.97;
      amp *= 0.5;
    }
    return sum / norm;
  }
  return { valueNoise: valueNoise, fbm: fbm };
})();

Isle.ISLAND_R = 80;

/* ================= 地形高（高さ関数） ================= */
Isle.terrainHeight = function (x, z) {
  const d = Math.hypot(x, z) / Isle.ISLAND_R;
  if (d > 1.45) return -18;
  let f = Math.max(0, 1 - d);
  f = f * f * (3 - 2 * f);
  f = Math.pow(f, 1.35);
  const large = Isle.noise.fbm(x * 0.018 + 3.1, z * 0.018 - 7.7, 4);
  const small = Isle.noise.fbm(x * 0.07 + 31.7, z * 0.07 - 17.3, 3);
  let h = f * (8 + 26 * large);
  h += (small - 0.5) * 2.4 * Math.min(1, f * 3);
  h -= Math.max(0, d - 0.96) * 16;
  return h;
};

Isle.slopeAt = function (x, z) {
  const e = 1, h = Isle.terrainHeight(x, z);
  return Math.max(
    Math.abs(Isle.terrainHeight(x + e, z) - h),
    Math.abs(Isle.terrainHeight(x - e, z) - h),
    Math.abs(Isle.terrainHeight(x, z + e) - h),
    Math.abs(Isle.terrainHeight(x, z - e) - h)
  );
};

/* 条件を満たす場所をランダムに散らす */
Isle.scatter = function (count, valid, minDist) {
  const pts = [];
  let tries = 0;
  while (pts.length < count && tries < count * 80) {
    tries++;
    const a = Math.random() * Math.PI * 2;
    const r = Math.sqrt(Math.random()) * Isle.ISLAND_R * 0.98;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (!valid(x, z)) continue;
    if (minDist && pts.some(function (p) { return (p.x - x) * (p.x - x) + (p.z - z) * (p.z - z) < minDist * minDist; })) continue;
    pts.push({ x: x, z: z });
  }
  return pts;
};

/* 島の頂上を探す */
Isle.findSummit = function () {
  let best = { x: 0, z: 0, h: -1e9 };
  for (let i = -60; i <= 60; i += 1.5) {
    for (let j = -60; j <= 60; j += 1.5) {
      const h = Isle.terrainHeight(i, j);
      if (h > best.h) best = { x: i, z: j, h: h };
    }
  }
  return best;
};

/* 浜辺のスポーンポイントを探す */
Isle.findSpawn = function () {
  for (let a = 0; a < Math.PI * 2; a += Math.PI / 90) {
    const radii = [62, 58, 66, 54, 64, 56];
    for (let k = 0; k < radii.length; k++) {
      const r = radii[k];
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      const h = Isle.terrainHeight(x, z);
      if (h > 0.5 && h < 2.6 && Isle.slopeAt(x, z) < 0.9) {
        return { x: x, z: z, h: h };
      }
    }
  }
  return { x: 0, z: 64, h: Isle.terrainHeight(0, 64) };
};

/* ================= 地形メッシュ（頂点カラー） ================= */
Isle.buildTerrain = function (scene) {
  const size = 220, seg = 128;
  const geo = new THREE.PlaneGeometry(size, size, seg, seg);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const colors = [];
  const cSand = new THREE.Color(0xE7D8A8);
  const cGrass = new THREE.Color(0x6FBF4E);
  const cGrassDark = new THREE.Color(0x4E9B3A);
  const cRock = new THREE.Color(0x9B9184);
  const tmp = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = Isle.terrainHeight(x, z);
    pos.setY(i, h);
    const n = Isle.noise.valueNoise(x * 0.15, z * 0.15);
    if (h < 0.7) tmp.copy(cSand);
    else if (h < 2.2) tmp.copy(cSand).lerp(cGrass, (h - 0.7) / 1.5);
    else if (h < 12) tmp.copy(cGrass).lerp(cGrassDark, (h - 2.2) / 9.8);
    else if (h < 19) tmp.copy(cGrassDark).lerp(cRock, (h - 12) / 7);
    else tmp.copy(cRock);
    tmp.offsetHSL(0, (n - 0.5) * 0.06, (n - 0.5) * 0.05);
    colors.push(tmp.r, tmp.g, tmp.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
};

/* ================= 水（波アニメーション） ================= */
Isle.buildWater = function (scene) {
  const geo = new THREE.PlaneGeometry(700, 700, 48, 48);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshPhongMaterial({
    color: 0x3FA0D8, transparent: true, opacity: 0.8,
    shininess: 90, specular: 0x99DDFF
  });
  const mesh = new THREE.Mesh(geo, mat);
  scene.add(mesh);
  Isle.water = { mesh: mesh, base: geo.attributes.position.array.slice() };
  return mesh;
};

Isle.updateWater = function (t) {
  const p = Isle.water.mesh.geometry.attributes.position;
  const b = Isle.water.base;
  for (let i = 0; i < p.count; i++) {
    const x = b[i * 3], z = b[i * 3 + 2];
    p.array[i * 3 + 1] = Math.sin(x * 0.12 + t * 1.2) * 0.28 + Math.cos(z * 0.1 + t * 0.9) * 0.28;
  }
  p.needsUpdate = true;
};

/* ================= 木（低ポリモデリング） ================= */
Isle.buildTrees = function (scene, spawn, summit) {
  const group = new THREE.Group();
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x8A5A33, roughness: 1 });
  const leafMats = [0x3E8E4E, 0x4CAF50, 0x5CB85C, 0x2F7A44].map(function (c) {
    return new THREE.MeshStandardMaterial({ color: c, roughness: 1, flatShading: true });
  });
  const pineMat = new THREE.MeshStandardMaterial({ color: 0x2E6B44, roughness: 1, flatShading: true });

  const spots = Isle.scatter(64, function (x, z) {
    const h = Isle.terrainHeight(x, z);
    const dSummit = Math.hypot(x - summit.x, z - summit.z);
    const dSpawn = Math.hypot(x - spawn.x, z - spawn.z);
    return h > 1.2 && h < 16.5 && Isle.slopeAt(x, z) < 1.7 && dSummit > 8 && dSpawn > 12;
  }, 3.4);

  spots.forEach(function (p, i) {
    const tree = new THREE.Group();
    const s = 0.7 + Math.random() * 1.1;
    if (i % 3 === 0) {
      // 針葉樹
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16 * s, 0.3 * s, 1.5 * s, 6), trunkMat);
      trunk.position.y = 0.75 * s;
      trunk.castShadow = true;
      tree.add(trunk);
      [[1.0, 0.9, 2.6], [0.8, 0.75, 2.0], [0.55, 0.6, 1.5]].forEach(function (c, k) {
        const cone = new THREE.Mesh(new THREE.ConeGeometry(c[0] * s, c[1] * s, 7), pineMat);
        cone.position.y = (1.4 + k * 0.85) * s;
        cone.castShadow = true;
        tree.add(cone);
      });
    } else {
      // 広葉樹
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.18 * s, 0.34 * s, 1.9 * s, 6), trunkMat);
      trunk.position.y = 0.95 * s;
      trunk.castShadow = true;
      tree.add(trunk);
      const mat = leafMats[i % leafMats.length];
      [[0, 2.6, 0, 1.35], [0.8, 2.15, 0.3, 1.0], [-0.7, 2.2, -0.35, 0.95], [0.15, 2.25, -0.75, 0.85]].forEach(function (b) {
        const blob = new THREE.Mesh(new THREE.IcosahedronGeometry(b[3] * s, 0), mat);
        blob.position.set(b[0] * s, b[1] * s, b[2] * s);
        blob.castShadow = true;
        tree.add(blob);
      });
    }
    tree.position.set(p.x, Isle.terrainHeight(p.x, p.z) - 0.2, p.z);
    tree.rotation.y = Math.random() * Math.PI * 2;
    group.add(tree);
  });
  scene.add(group);
  return group;
};

/* ================= 岩（変形アイコサヘドロン） ================= */
Isle.buildRocks = function (scene, spawn) {
  const group = new THREE.Group();
  const mats = [0x8D8D85, 0x7A7A72, 0x9C9484].map(function (c) {
    return new THREE.MeshStandardMaterial({ color: c, roughness: 1, flatShading: true });
  });
  const spots = Isle.scatter(38, function (x, z) {
    const h = Isle.terrainHeight(x, z);
    return h > -0.6 && h < 20 && Isle.slopeAt(x, z) < 3 && Math.hypot(x - spawn.x, z - spawn.z) > 8;
  }, 3);
  spots.forEach(function (p, i) {
    const geo = new THREE.IcosahedronGeometry(1, 0);
    const pos = geo.attributes.position;
    for (let v = 0; v < pos.count; v++) {
      const n = Isle.noise.valueNoise(pos.getX(v) * 3 + i * 7.3, pos.getZ(v) * 3 + i * 3.1);
      const k = 0.72 + n * 0.6;
      pos.setXYZ(v, pos.getX(v) * k, pos.getY(v) * k * 0.8, pos.getZ(v) * k);
    }
    geo.computeVertexNormals();
    const s = 0.35 + Math.random() * 1.5;
    const rock = new THREE.Mesh(geo, mats[i % mats.length]);
    rock.scale.set(s, s, s);
    rock.rotation.set(Math.random() * 0.6, Math.random() * Math.PI * 2, Math.random() * 0.6);
    rock.position.set(p.x, Isle.terrainHeight(p.x, p.z) + s * 0.15, p.z);
    rock.castShadow = true;
    rock.receiveShadow = true;
    group.add(rock);
  });
  scene.add(group);
  return group;
};

/* ================= 花（InstancedMesh） ================= */
Isle.buildFlowers = function (scene) {
  const N = 130;
  const stemGeo = new THREE.CylinderGeometry(0.025, 0.035, 0.35, 4);
  const stemMat = new THREE.MeshStandardMaterial({ color: 0x3E8E4E, roughness: 1 });
  const headGeo = new THREE.IcosahedronGeometry(0.13, 0);
  const headMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6 });
  const stems = new THREE.InstancedMesh(stemGeo, stemMat, N);
  const heads = new THREE.InstancedMesh(headGeo, headMat, N);
  const dummy = new THREE.Object3D();
  const palette = [0xE74C3C, 0xF1C40F, 0xFFFAF0, 0xF48FB1, 0xFF8A65, 0xBA68C8];
  const c = new THREE.Color();
  const spots = Isle.scatter(N, function (x, z) {
    const h = Isle.terrainHeight(x, z);
    return h > 1 && h < 11 && Isle.slopeAt(x, z) < 0.9;
  }, 0.9);
  for (let i = 0; i < spots.length; i++) {
    const h = Isle.terrainHeight(spots[i].x, spots[i].z);
    dummy.position.set(spots[i].x, h + 0.16, spots[i].z);
    dummy.rotation.set(0, Math.random() * Math.PI, 0);
    dummy.scale.setScalar(0.8 + Math.random() * 0.6);
    dummy.updateMatrix();
    stems.setMatrixAt(i, dummy.matrix);
    dummy.position.y = h + 0.4;
    dummy.updateMatrix();
    heads.setMatrixAt(i, dummy.matrix);
    heads.setColorAt(i, c.setHex(palette[i % palette.length]));
  }
  stems.count = heads.count = spots.length;
  stems.instanceMatrix.needsUpdate = true;
  heads.instanceMatrix.needsUpdate = true;
  if (heads.instanceColor) heads.instanceColor.needsUpdate = true;
  stems.castShadow = true;
  heads.castShadow = true;
  scene.add(stems, heads);
};

/* ================= 草（InstancedMesh） ================= */
Isle.buildGrass = function (scene) {
  const N = 260;
  const geo = new THREE.ConeGeometry(0.09, 0.4, 4);
  const mat = new THREE.MeshStandardMaterial({ color: 0x4E9B3A, roughness: 1, flatShading: true });
  const mesh = new THREE.InstancedMesh(geo, mat, N);
  const dummy = new THREE.Object3D();
  const spots = Isle.scatter(N, function (x, z) {
    const h = Isle.terrainHeight(x, z);
    return h > 1.2 && h < 13 && Isle.slopeAt(x, z) < 1.1;
  }, 0.8);
  for (let i = 0; i < spots.length; i++) {
    const h = Isle.terrainHeight(spots[i].x, spots[i].z);
    dummy.position.set(spots[i].x, h + 0.16, spots[i].z);
    dummy.rotation.set((Math.random() - 0.5) * 0.4, Math.random() * Math.PI, (Math.random() - 0.5) * 0.4);
    dummy.scale.setScalar(0.7 + Math.random() * 0.8);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
  }
  mesh.count = spots.length;
  mesh.instanceMatrix.needsUpdate = true;
  scene.add(mesh);
};

/* ================= 雲 ================= */
Isle.buildClouds = function (scene) {
  Isle.clouds = [];
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, opacity: 0.92 });
  for (let i = 0; i < 6; i++) {
    const g = new THREE.Group();
    const n = 3 + Math.floor(Math.random() * 3);
    for (let k = 0; k < n; k++) {
      const r = 2.2 + Math.random() * 2.6;
      const s = new THREE.Mesh(new THREE.SphereGeometry(r, 8, 6), mat);
      s.position.set(k * 3.2 - n * 1.4 + Math.random(), Math.random() * 1.2, Math.random() * 2 - 1);
      s.scale.y = 0.55;
      g.add(s);
    }
    const a = Math.random() * Math.PI * 2, rad = 25 + Math.random() * 70;
    g.position.set(Math.cos(a) * rad, 44 + Math.random() * 16, Math.sin(a) * rad);
    g.scale.setScalar(1.2 + Math.random() * 1.3);
    scene.add(g);
    Isle.clouds.push({ group: g, speed: 0.4 + Math.random() * 0.8 });
  }
};

Isle.updateClouds = function (dt) {
  for (let i = 0; i < Isle.clouds.length; i++) {
    const c = Isle.clouds[i];
    c.group.position.x += c.speed * dt;
    if (c.group.position.x > 150) c.group.position.x = -150;
  }
};

/* ================= 鳥 ================= */
Isle.buildBirds = function (scene) {
  Isle.birds = [];
  const mat = new THREE.MeshBasicMaterial({ color: 0x37474F, side: THREE.DoubleSide });
  for (let i = 0; i < 5; i++) {
    const g = new THREE.Group();
    const wingL = new THREE.Mesh(new THREE.PlaneGeometry(1.2, 0.4), mat);
    wingL.position.x = -0.6;
    const wingR = wingL.clone();
    wingR.position.x = 0.6;
    const body = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.6, 4), mat);
    body.rotation.x = Math.PI / 2;
    g.add(wingL, wingR, body);
    scene.add(g);
    Isle.birds.push({
      group: g, wingL: wingL, wingR: wingR,
      r: 35 + Math.random() * 30, h: 26 + Math.random() * 16,
      a: Math.random() * Math.PI * 2, speed: 0.12 + Math.random() * 0.15,
      phase: Math.random() * 10
    });
  }
};

Isle.updateBirds = function (t, dt) {
  for (let i = 0; i < Isle.birds.length; i++) {
    const b = Isle.birds[i];
    b.a += b.speed * dt;
    const x = Math.cos(b.a) * b.r, z = Math.sin(b.a) * b.r;
    const y = b.h + Math.sin(t * 0.7 + b.phase) * 1.5;
    b.group.position.set(x, y, z);
    b.group.lookAt(Math.cos(b.a + 0.1) * b.r, y, Math.sin(b.a + 0.1) * b.r);
    const flap = Math.sin(t * 9 + b.phase) * 0.7;
    b.wingL.rotation.y = flap;
    b.wingR.rotation.y = -flap;
  }
};

/* ================= 花粉・光の粒子 ================= */
Isle.buildPollen = function (scene) {
  const N = 100;
  Isle.pollenBase = [];
  const spots = Isle.scatter(N, function (x, z) {
    const h = Isle.terrainHeight(x, z);
    return h > 1 && h < 14;
  }, 0.5);
  for (let i = 0; i < N; i++) {
    const p = spots[i % spots.length];
    const h = Isle.terrainHeight(p.x, p.z);
    Isle.pollenBase.push({
      x: p.x, y: h + 0.6 + Math.random() * 2.2, z: p.z,
      ph: Math.random() * Math.PI * 2
    });
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3));
  const cv = document.createElement('canvas');
  cv.width = cv.height = 32;
  const ctx = cv.getContext('2d');
  const grad = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  grad.addColorStop(0, 'rgba(255,255,230,1)');
  grad.addColorStop(1, 'rgba(255,255,230,0)');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 32, 32);
  const tex = new THREE.CanvasTexture(cv);
  const mat = new THREE.PointsMaterial({
    color: 0xFFF6C8, size: 0.35, map: tex, transparent: true, opacity: 0.75,
    depthWrite: false, blending: THREE.AdditiveBlending, sizeAttenuation: true
  });
  const points = new THREE.Points(geo, mat);
  scene.add(points);
  Isle.pollen = { points: points, geo: geo };
};

Isle.updatePollen = function (t) {
  const arr = Isle.pollen.geo.attributes.position.array;
  for (let i = 0; i < Isle.pollenBase.length; i++) {
    const b = Isle.pollenBase[i];
    arr[i * 3] = b.x + Math.sin(t * 0.4 + b.ph) * 1.4;
    arr[i * 3 + 1] = b.y + Math.sin(t * 0.9 + b.ph * 2) * 0.5;
    arr[i * 3 + 2] = b.z + Math.cos(t * 0.35 + b.ph) * 1.4;
  }
  Isle.pollen.geo.attributes.position.needsUpdate = true;
};

/* ================= フルーツ（収集アイテム） ================= */
Isle.buildFruits = function (scene, list) {
  Isle.fruits = list.map(function (f, i) {
    const g = new THREE.Group();
    const col = i % 3 === 0 ? 0xFB8C00 : 0xE53935;
    const body = new THREE.Mesh(
      new THREE.SphereGeometry(0.2, 10, 8),
      new THREE.MeshStandardMaterial({ color: col, roughness: 0.35, emissive: col, emissiveIntensity: 0.25 })
    );
    const stem = new THREE.Mesh(
      new THREE.CylinderGeometry(0.02, 0.03, 0.14, 5),
      new THREE.MeshStandardMaterial({ color: 0x6D4C41, roughness: 1 })
    );
    stem.position.y = 0.22;
    const leaf = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.07, 0),
      new THREE.MeshStandardMaterial({ color: 0x4CAF50, roughness: 0.8, flatShading: true })
    );
    leaf.position.set(0.06, 0.3, 0);
    g.add(body, stem, leaf);
    g.position.set(f.x, f.y, f.z);
    scene.add(g);
    return { group: g, baseY: f.y, taken: false, phase: i * 1.7 };
  });
};

Isle.updateFruits = function (t, playerPos) {
  let collected = -1;
  for (let i = 0; i < Isle.fruits.length; i++) {
    const f = Isle.fruits[i];
    if (f.taken) continue;
    f.group.rotation.y = t * 1.8 + f.phase;
    f.group.position.y = f.baseY + Math.sin(t * 2.2 + f.phase) * 0.09;
    if (playerPos) {
      const d = Math.hypot(
        playerPos.x - f.group.position.x,
        playerPos.y + 0.9 - f.group.position.y,
        playerPos.z - f.group.position.z
      );
      if (d < 1.2) collected = i;
    }
  }
  return collected;
};

/* ================= 浮遊プラットフォーム（浮島） ================= */
Isle.makePlatform = function (x, y, z, size, move) {
  const g = new THREE.Group();
  const stone = new THREE.Mesh(
    new THREE.BoxGeometry(size * 0.94, 0.55, size * 0.94),
    new THREE.MeshStandardMaterial({ color: 0x8D6E63, roughness: 1 })
  );
  stone.position.y = -0.375;
  const grass = new THREE.Mesh(
    new THREE.BoxGeometry(size, 0.25, size),
    new THREE.MeshStandardMaterial({ color: 0x69B04D, roughness: 1 })
  );
  grass.position.y = -0.125;
  const tip = new THREE.Mesh(
    new THREE.ConeGeometry(size * 0.6, size * 0.9, 5),
    new THREE.MeshStandardMaterial({ color: 0x7A5C44, roughness: 1, flatShading: true })
  );
  tip.rotation.x = Math.PI;
  tip.position.y = -0.65 - size * 0.45;
  stone.castShadow = grass.castShadow = tip.castShadow = true;
  stone.receiveShadow = grass.receiveShadow = true;
  g.add(stone, grass, tip);
  g.position.set(x, y, z);
  return {
    group: g, half: size / 2, move: move || null,
    base: new THREE.Vector3(x, y, z),
    prev: new THREE.Vector3(x, y, z),
    delta: new THREE.Vector3()
  };
};

Isle.updatePlatforms = function (t) {
  for (let i = 0; i < Isle.platforms.length; i++) {
    const p = Isle.platforms[i];
    p.prev.copy(p.group.position);
    if (p.move) {
      const off = Math.sin(t * p.move.speed + p.move.phase) * p.move.amp;
      if (p.move.axis === 'x') p.group.position.x = p.base.x + off;
      else p.group.position.z = p.base.z + off;
    }
    p.delta.subVectors(p.group.position, p.prev);
  }
};

/* ================= ゴール（クリスタル） ================= */
Isle.buildGoal = function (scene, x, y, z) {
  const g = new THREE.Group();
  Isle.crystal = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.85, 0),
    new THREE.MeshStandardMaterial({
      color: 0x9AA0A6, emissive: 0x222222, emissiveIntensity: 0.2,
      roughness: 0.2, metalness: 0.2, transparent: true, opacity: 0.95
    })
  );
  Isle.crystal.position.y = 1.5;
  Isle.crystal.castShadow = true;
  Isle.beacon = new THREE.Mesh(
    new THREE.CylinderGeometry(0.55, 0.85, 46, 14, 1, true),
    new THREE.MeshBasicMaterial({
      color: 0x7DEBFF, transparent: true, opacity: 0.06,
      side: THREE.DoubleSide, depthWrite: false
    })
  );
  Isle.beacon.position.y = 24.5;
  g.add(Isle.crystal, Isle.beacon);
  g.position.set(x, y, z);
  scene.add(g);
  Isle.goal = g;
};

Isle.setGoalActive = function (active) {
  Isle.crystal.material.color.setHex(active ? 0x67E8F9 : 0x9AA0A6);
  Isle.crystal.material.emissive.setHex(active ? 0x22D3EE : 0x222222);
  Isle.crystal.material.emissiveIntensity = active ? 0.9 : 0.2;
  Isle.beacon.material.opacity = active ? 0.16 : 0.05;
};

Isle.updateGoal = function (t) {
  Isle.crystal.rotation.y = t * 0.9;
  Isle.crystal.position.y = 1.5 + Math.sin(t * 1.4) * 0.18;
};

/* ================= 道しるべ ================= */
Isle.buildSign = function (scene, x, z, rotY) {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x8A5A33, roughness: 1 });
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.08, 1.1, 6), mat);
  post.position.y = 0.55;
  const board = new THREE.Mesh(
    new THREE.BoxGeometry(0.9, 0.45, 0.08),
    new THREE.MeshStandardMaterial({ color: 0xA9745B, roughness: 1 })
  );
  board.position.y = 0.95;
  post.castShadow = board.castShadow = true;
  g.add(post, board);
  g.position.set(x, Isle.terrainHeight(x, z), z);
  g.rotation.y = rotY;
  scene.add(g);
};
