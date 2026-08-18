/* player.js — プレイヤーキャラクターの低ポリモデリングとアニメーション */
window.Isle = window.Isle || {};

Isle.createPlayer = function (scene) {
  const g = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: 0xF2C9A0, roughness: 0.8 });
  const shirt = new THREE.MeshStandardMaterial({ color: 0xE07A3F, roughness: 0.85 });
  const pants = new THREE.MeshStandardMaterial({ color: 0x5B6C8F, roughness: 0.9 });
  const hairM = new THREE.MeshStandardMaterial({ color: 0x4A2F1D, roughness: 0.9, flatShading: true });
  const capM = new THREE.MeshStandardMaterial({ color: 0x3E8E4E, roughness: 0.85 });
  const packM = new THREE.MeshStandardMaterial({ color: 0x8B5A2B, roughness: 0.95 });
  const bootM = new THREE.MeshStandardMaterial({ color: 0x6D4C41, roughness: 1 });

  function box(w, h, d, mat, x, y, z) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.castShadow = true;
    return m;
  }

  // 足（股関節を支点に振れる）
  function leg(px) {
    const pivot = new THREE.Group();
    pivot.position.set(px, 0.55, 0);
    pivot.add(box(0.24, 0.56, 0.26, pants, 0, -0.28, 0));
    pivot.add(box(0.26, 0.14, 0.34, bootM, 0, -0.53, 0.03));
    g.add(pivot);
    return pivot;
  }
  const legL = leg(-0.16), legR = leg(0.16);

  // 胴体・バックパック
  g.add(box(0.62, 0.68, 0.38, shirt, 0, 0.89, 0));
  g.add(box(0.46, 0.5, 0.2, packM, 0, 1.0, -0.29));

  // 腕（肩を支点に振れる）
  function arm(ax) {
    const pivot = new THREE.Group();
    pivot.position.set(ax, 1.16, 0);
    pivot.add(box(0.17, 0.55, 0.19, shirt, 0, -0.24, 0));
    pivot.add(box(0.15, 0.18, 0.17, skin, 0, -0.55, 0));
    g.add(pivot);
    return pivot;
  }
  const armL = arm(-0.42), armR = arm(0.42);

  // 頭・髪・帽子
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.27, 12, 10), skin);
  head.position.set(0, 1.52, 0);
  head.castShadow = true;
  const hair = new THREE.Mesh(
    new THREE.SphereGeometry(0.285, 12, 10, 0, Math.PI * 2, 0, Math.PI * 0.62), hairM
  );
  hair.position.set(0, 1.53, -0.02);
  hair.castShadow = true;
  g.add(head, hair);
  const capTop = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.14, 10), capM);
  capTop.position.set(0, 1.7, -0.02);
  capTop.castShadow = true;
  g.add(capTop, box(0.34, 0.05, 0.2, capM, 0, 1.65, 0.26));

  scene.add(g);
  return {
    group: g,
    legL: legL, legR: legR, armL: armL, armR: armR,
    height: 1.78, half: 0.35, animT: 0
  };
};

/*
  info: { moving, speed, onGround, vy }
*/
Isle.animatePlayer = function (player, dt, info) {
  const p = player;
  const k = Math.min(1, 16 * dt);
  if (!info.onGround) {
    // ジャンプ中：脚を折り、腕を上げる
    const tuck = info.vy > 0 ? -0.55 : 0.4;
    p.legL.rotation.x += (tuck - p.legL.rotation.x) * k;
    p.legR.rotation.x += (tuck - p.legR.rotation.x) * k;
    p.armL.rotation.x += (-2.7 - p.armL.rotation.x) * k;
    p.armR.rotation.x += (-2.7 - p.armR.rotation.x) * k;
  } else if (info.speed > 0.6) {
    // 走り：手足を逆位相で振る
    p.animT += dt * (6 + info.speed * 1.2);
    const swing = Math.sin(p.animT) * 0.75;
    p.legL.rotation.x += (swing - p.legL.rotation.x) * k;
    p.legR.rotation.x += (-swing - p.legR.rotation.x) * k;
    p.armL.rotation.x += (-swing * 0.7 - p.armL.rotation.x) * k;
    p.armR.rotation.x += (swing * 0.7 - p.armR.rotation.x) * k;
  } else {
    // 待機：ゆっくり元に戻る
    p.legL.rotation.x += (0 - p.legL.rotation.x) * k;
    p.legR.rotation.x += (0 - p.legR.rotation.x) * k;
    p.armL.rotation.x += (0 - p.armL.rotation.x) * k;
    p.armR.rotation.x += (0 - p.armR.rotation.x) * k;
  }
};
