// 機体: 性能諸元と3Dモデル（機首 -Z, 右 +X, 上 +Y, 原点=重心）
import * as THREE from 'three';
import { GeoBuilder } from './geo.js';
import { glowTexture, airlinerLiveryTexture } from './textures.js';

const D2R = Math.PI / 180;

export const SPECS = {
  cessna: {
    id: 'cessna', name: '小型機', model: 'CS-172 スカイホーク', desc: '単発プロペラの練習機。低速で扱いやすく、短い距離で離着陸できる。',
    mass: 1050, wingArea: 16.2, span: 11, engine: 'prop', thrust: 3200, propVmax: 95,
    CL0: 0.25, CLa: 4.8, alphaStall: 15 * D2R, stallDrop: 0.86, CD0: 0.028, K: 0.05, sideCoef: 0.6,
    flaps: [0, 10, 20, 30], flapCL: [0, 0.25, 0.5, 0.75], flapCD: [0, 0.01, 0.025, 0.045], flapStall: [0, 0, -0.5 * D2R, -1 * D2R],
    gearCD: 0, retractGear: false, spoilerCD: 0,
    vRef: 45, pitchStab: 6, pitchDamp: 3.2, alphaRange: 0.26, pitchKeyRate: 1.3, rollRate: 1.25, rollResp: 4, yawAuth: 1.2, yawStab: 3, yawDamp: 2.2, dihedral: 0.8,
    fbw: false, gearH: 1.3, groundPitch: 0, tailStrike: 13 * D2R, crashVS: 4.0, brake: 4.5, steer: 0.9, spool: 0.8,
    takeoffFlaps: 1, landingFlaps: 3, vR: 28, vApp: 33, appAlt: 300, appDist: 4500, cockpit: [-0.3, 0.55, -0.4], camDist: 16,
    trimAlpha: 4 * D2R,
  },
  airliner: {
    id: 'airliner', name: '旅客機', model: 'SL-320 ナローボディ', desc: '双発ジェット旅客機。重く慣性が大きい。フラップと速度管理が着陸の鍵。',
    mass: 62000, wingArea: 122.6, span: 34, engine: 'jet', thrust: 220000, engines: 2,
    CL0: 0.2, CLa: 5.2, alphaStall: 14 * D2R, CD0: 0.022, K: 0.045, sideCoef: 0.5,
    flaps: ['0', '1', '2', '3', 'FULL'], flapCL: [0, 0.35, 0.65, 0.9, 1.15], flapCD: [0, 0.008, 0.02, 0.04, 0.07], flapStall: [0, 2 * D2R, 2 * D2R, 2 * D2R, 2 * D2R],
    gearCD: 0.018, retractGear: true, spoilerCD: 0.06,
    vRef: 85, pitchStab: 2.4, pitchDamp: 2.4, alphaRange: 0.28, pitchKeyRate: 1.6, rollRate: 0.45, rollResp: 1.6, yawAuth: 0.35, yawStab: 1.5, yawDamp: 1.6, dihedral: 0.5,
    fbw: true, alphaProt: 11.5 * D2R, nMax: 2.5, nMin: 1.0, qMax: 0.09, qResp: 2.5, qGearDown: 0.8, bankLimit: 67 * D2R,
    gearH: 3.6, groundPitch: 0, tailStrike: 11.5 * D2R, crashVS: 3.6, brake: 3.2, steer: 0.35, spool: 3.5,
    takeoffFlaps: 2, landingFlaps: 4, vR: 72, vApp: 69, appAlt: 600, appDist: 10000, cockpit: [-0.5, 0.95, -15.6], camDist: 62,
    trimAlpha: 4 * D2R,
  },
  fighter: {
    id: 'fighter', name: '戦闘機', model: 'FX-16 ファルコン', desc: '高推力の単発戦闘機。アフターバーナーと高いロール性能で曲技飛行も可能。',
    mass: 12000, wingArea: 27.9, span: 9.5, engine: 'fighter', thrust: 76000, abThrust: 127000,
    CL0: 0.05, CLa: 3.6, alphaStall: 25 * D2R, CD0: 0.021, K: 0.11, sideCoef: 0.5,
    flaps: ['UP', 'DN'], flapCL: [0, 0.2], flapCD: [0, 0.015], flapStall: [0, 2 * D2R],
    gearCD: 0.02, retractGear: true, spoilerCD: 0.05,
    vRef: 120, pitchStab: 8, pitchDamp: 4.5, alphaRange: 0.45, pitchKeyRate: 3.0, rollRate: 4.2, rollResp: 9, yawAuth: 0.8, yawStab: 3, yawDamp: 2.5, dihedral: 0.4,
    fbw: true, alphaProt: 25 * D2R, nMax: 9, nMin: 3.0, qMax: 0.6, qResp: 8, qGearDown: 0.3, bankLimit: 999,
    gearH: 1.75, groundPitch: 0, tailStrike: 17 * D2R, crashVS: 4.5, brake: 4.5, steer: 0.5, spool: 2.0,
    takeoffFlaps: 1, landingFlaps: 1, vR: 75, vApp: 78, appAlt: 450, appDist: 8000, cockpit: [0, 1.05, -4.4], camDist: 26,
    trimAlpha: 3 * D2R,
  },
};

// ---------- モデル構築ヘルパー ----------
function lathe(profile, segs = 28, scaleX = 1, scaleY = 1) {
  // profile: [[前方距離, 半径], ...] 尾部から機首へ昇順
  const pts = profile.map(([y, r]) => new THREE.Vector2(Math.max(0.001, r), y));
  const g = new THREE.LatheGeometry(pts, segs);
  g.rotateX(-Math.PI / 2); // +Y(前) → -Z
  g.scale(scaleX, scaleY, 1);
  g.computeVertexNormals();
  return g;
}
function resample(profile, n) {
  const out = []; const y0 = profile[0][0], y1 = profile[profile.length - 1][0];
  for (let i = 0; i <= n; i++) {
    const y = y0 + ((y1 - y0) * i) / n; let k = 0; while (k < profile.length - 2 && profile[k + 1][0] < y) k++;
    const [ya, ra] = profile[k], [yb, rb] = profile[k + 1]; const t = (y - ya) / (yb - ya);
    out.push([y, ra + (rb - ra) * (t * t * (3 - 2 * t) * 0.5 + t * 0.5)]);
  }
  return out;
}
// 翼の片側（右 side=1 / 左 side=-1）。root/tip: {x, le, te, y, t}
function wing(gb, side, root, tip, col = [1, 1, 1]) {
  const P = (s, f, top) => { // s: 0=root 1=tip, f: 翼弦位置 0..1
    const x = root.x + (tip.x - root.x) * s, le = root.le + (tip.le - root.le) * s, te = root.te + (tip.te - root.te) * s;
    const y = root.y + (tip.y - root.y) * s, t = root.t + (tip.t - root.t) * s;
    const th = f === 0 || f === 1 ? 0 : top ? t * 0.6 : -t * 0.4;
    return [x * side, y + th, le + (te - le) * f];
  };
  const fs = [0, 0.3, 1];
  const q = (a, b, c, d) => (side > 0 ? gb.quad(a, b, c, d, undefined, col) : gb.quad(a, d, c, b, undefined, col));
  for (let i = 0; i < 2; i++) {
    q(P(0, fs[i], true), P(1, fs[i], true), P(1, fs[i + 1], true), P(0, fs[i + 1], true));
    q(P(0, fs[i + 1], false), P(1, fs[i + 1], false), P(1, fs[i], false), P(0, fs[i], false));
  }
  // 翼端
  q(P(1, 0, true), P(1, 0, false), P(1, 0.3, false), P(1, 0.3, true));
  q(P(1, 0.3, true), P(1, 0.3, false), P(1, 1, false), P(1, 1, true));
}
function mesh(geo, mat) { const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true; return m; }

// 舵面: hinge A→B、後方に chord。回転軸はヒンジ線
function surface(A, B, chordA, chordB, thick, mat, vertical = false) {
  const a = new THREE.Vector3(...A), b = new THREE.Vector3(...B);
  const dir = b.clone().sub(a); const L = dir.length(); dir.normalize();
  const piv = new THREE.Group(); piv.position.copy(a);
  // ローカル X をヒンジ方向に
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), dir); piv.quaternion.copy(q);
  const inner = new THREE.Group(); piv.add(inner);
  const gb = new GeoBuilder();
  // ローカル座標で後方方向を求める（ワールド +Z をローカルへ）
  const back = new THREE.Vector3(0, 0, 1).applyQuaternion(q.clone().invert());
  const up = new THREE.Vector3().crossVectors(back, new THREE.Vector3(1, 0, 0)).normalize().multiplyScalar(vertical ? 1 : -1);
  const P = (x, c, h) => [x + back.x * c + up.x * h, back.y * c + up.y * h, back.z * c + up.z * h];
  const ca = chordA, cb = chordB, t = thick / 2;
  gb.quad(P(0, 0, t), P(L, 0, t), P(L, cb, 0), P(0, ca, 0));
  gb.quad(P(0, ca, 0), P(L, cb, 0), P(L, 0, -t), P(0, 0, -t));
  gb.quad(P(0, 0, -t), P(L, 0, -t), P(L, 0, t), P(0, 0, t));
  const m = mesh(gb.build(), mat); m.material.side = THREE.DoubleSide; inner.add(m);
  piv.userData.inner = inner;
  return piv;
}
function wheel(r, w, mat) { const g = new THREE.CylinderGeometry(r, r, w, 16); g.rotateZ(Math.PI / 2); return mesh(g, mat); }

function navLights(group, left, right, tail, extra = []) {
  const gt = glowTexture();
  const mk = (color, size) => { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: gt, color, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })); s.scale.set(size, size, 1); return s; };
  const L = mk(0xff2a1a, 1.2); L.position.set(...left); group.add(L);
  const R = mk(0x1aff4a, 1.2); R.position.set(...right); group.add(R);
  const T = mk(0xffffff, 1.0); T.position.set(...tail); group.add(T);
  const strobes = [mk(0xffffff, 4), mk(0xffffff, 4)]; strobes[0].position.set(...left); strobes[1].position.set(...right); strobes.forEach((s) => group.add(s));
  const beacon = mk(0xff2010, 2.2); beacon.position.set(...(extra[0] || [0, 0, 0])); group.add(beacon);
  return { L, R, T, strobes, beacon };
}

// ---------- 小型機 ----------
function buildCessna() {
  const g = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: 0xf4f4f0, roughness: 0.4, metalness: 0.1 });
  const red = new THREE.MeshStandardMaterial({ color: 0xb8202a, roughness: 0.45 });
  const blue = new THREE.MeshStandardMaterial({ color: 0x1e3a78, roughness: 0.45 });
  const glass = new THREE.MeshStandardMaterial({ color: 0x1a2430, roughness: 0.05, metalness: 0.9 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x202020, roughness: 0.7 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x9a9ea4, roughness: 0.35, metalness: 0.8 });
  const prof = resample([[-4.9, 0.08], [-4.0, 0.2], [-2.2, 0.4], [-0.6, 0.6], [1.0, 0.62], [2.0, 0.58], [2.8, 0.5], [3.05, 0.3], [3.2, 0.05]], 30);
  const fus = mesh(lathe(prof, 24, 1, 1.25), white); g.add(fus);
  // 胴体のストライプ
  const stripe = mesh(lathe(resample([[-4.3, 0.17], [-2.2, 0.41], [-0.6, 0.61], [1.0, 0.63], [2.6, 0.54]], 16), 24, 1.01, 0.25), blue); stripe.position.y = -0.1; g.add(stripe);
  const win = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12), glass); win.scale.set(0.6, 0.42, 1.25); win.position.set(0, 0.42, 0.1); g.add(win);
  const spin = mesh(new THREE.ConeGeometry(0.22, 0.45, 16).rotateX(-Math.PI / 2), red); spin.position.z = -3.35; g.add(spin);
  // 主翼（高翼）
  const gb = new GeoBuilder();
  for (const s of [1, -1]) wing(gb, s, { x: 0.5, le: -0.9, te: 0.62, y: 0.92, t: 0.18 }, { x: 5.5, le: -0.75, te: 0.4, y: 1.05, t: 0.12 });
  g.add(mesh(gb.build(), white));
  // 翼端（赤）
  for (const s of [1, -1]) { const tipm = mesh(new THREE.BoxGeometry(0.1, 0.12, 1.15), red); tipm.position.set(5.55 * s, 1.05, -0.17); g.add(tipm); }
  // 支柱
  const st = new GeoBuilder(); for (const s of [1, -1]) st.beam([0.55 * s, -0.55, 0.1], [2.6 * s, 0.95, -0.2], 0.08, 0.2); g.add(mesh(st.build(), white));
  // 尾翼
  const tb = new GeoBuilder();
  for (const s of [1, -1]) wing(tb, s, { x: 0.1, le: 3.9, te: 4.75, y: 0.15, t: 0.08 }, { x: 1.7, le: 4.3, te: 4.75, y: 0.15, t: 0.06 });
  g.add(mesh(tb.build(), white));
  const fin = new GeoBuilder();
  fin.quad([0, 0.4, 3.5], [0, 0.4, 4.95], [0, 1.95, 4.95], [0, 1.95, 4.45]); fin.quad([0, 0.4, 4.95], [0, 0.4, 3.5], [0, 1.95, 4.45], [0, 1.95, 4.95]);
  const finM = mesh(fin.build(), red); finM.material = red.clone(); finM.material.side = THREE.DoubleSide; g.add(finM);
  // 舵面
  const parts = {};
  parts.elevator = [surface([-1.7, 0.15, 4.75], [1.7, 0.15, 4.75], 0.55, 0.45, 0.05, white)];
  parts.rudder = surface([0, 0.35, 4.95], [0, 1.95, 4.95], 0.45, 0.35, 0.05, red, true);
  parts.aileronR = surface([3.2, 0.98, 0.5], [5.4, 1.05, 0.38], 0.35, 0.3, 0.05, white);
  parts.aileronL = surface([-3.2, 0.98, 0.5], [-5.4, 1.05, 0.38], 0.35, 0.3, 0.05, white);
  parts.flaps = [surface([0.6, 0.92, 0.62], [3.1, 0.98, 0.5], 0.42, 0.38, 0.05, white), surface([-0.6, 0.92, 0.62], [-3.1, 0.98, 0.5], 0.42, 0.38, 0.05, white)];
  [...parts.elevator, parts.rudder, parts.aileronL, parts.aileronR, ...parts.flaps].forEach((p) => g.add(p));
  // プロペラ
  const prop = new THREE.Group(); prop.position.z = -3.2; g.add(prop);
  for (let k = 0; k < 2; k++) { const b = mesh(new THREE.BoxGeometry(0.12, 0.95, 0.04), dark); b.position.y = 0.48; const h = new THREE.Group(); h.rotation.z = k * Math.PI; h.add(b); prop.add(h); }
  const disc = new THREE.Mesh(new THREE.CircleGeometry(0.98, 32), new THREE.MeshBasicMaterial({ color: 0x333333, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide }));
  disc.position.z = -3.21; g.add(disc);
  parts.prop = prop; parts.propDisc = disc;
  // 固定脚
  const gear = new THREE.Group(); g.add(gear);
  const legs = new GeoBuilder(); for (const s of [1, -1]) legs.beam([0.4 * s, -0.55, 0.35], [1.15 * s, -1.0, 0.45], 0.08, 0.06); legs.beam([0, -0.7, -2.3], [0, -1.0, -2.3], 0.08, 0.08);
  gear.add(mesh(legs.build(), metal));
  for (const s of [1, -1]) { const w = wheel(0.3, 0.18, dark); w.position.set(1.18 * s, -1.0, 0.45); gear.add(w); const fair = mesh(new THREE.SphereGeometry(0.34, 12, 8), white); fair.scale.set(0.5, 0.75, 1.4); fair.position.copy(w.position); gear.add(fair); }
  const nw = wheel(0.25, 0.14, dark); nw.position.set(0, -1.05, -2.3); gear.add(nw);
  parts.gear = gear; parts.gearList = [];
  parts.nav = navLights(g, [-5.6, 1.05, -0.4], [5.6, 1.05, -0.4], [0, 1.9, 4.95], [[0, 1.98, 4.6]]);
  parts.landingLight = [-0.2, 0.0, -2.9];
  return { group: g, parts };
}

// ---------- 旅客機 ----------
function buildAirliner() {
  const g = new THREE.Group();
  const livery = airlinerLiveryTexture();
  const body = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.15, map: makeFuselageTex() });
  const white = new THREE.MeshStandardMaterial({ color: 0xeef0f3, roughness: 0.35, metalness: 0.15 });
  const grey = new THREE.MeshStandardMaterial({ color: 0xb4b9c0, roughness: 0.4, metalness: 0.4 });
  const blue = new THREE.MeshStandardMaterial({ color: 0x1d4f9c, roughness: 0.4, side: THREE.DoubleSide });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1a1a1c, roughness: 0.6 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x8d9298, roughness: 0.3, metalness: 0.85 });
  void livery;
  const prof = resample([[-19.6, 0.25], [-18, 0.8], [-15, 1.45], [-11, 1.92], [-6, 2.0], [10, 2.0], [13.5, 1.92], [15.5, 1.65], [16.8, 1.25], [17.6, 0.75], [18.0, 0.1]], 80);
  g.add(mesh(lathe(prof, 32, 1, 1.05), body));
  // 主翼（低翼・後退翼）
  const gb = new GeoBuilder();
  for (const s of [1, -1]) wing(gb, s, { x: 1.6, le: -3.6, te: 3.8, y: -1.3, t: 0.65 }, { x: 17.0, le: 4.5, te: 6.0, y: 0.05, t: 0.18 });
  g.add(mesh(gb.build(), white));
  // ウイングレット
  for (const s of [1, -1]) { const wl = new GeoBuilder(); wl.quad([17 * s, 0.05, 4.4], [17 * s, 0.05, 6.0], [17.3 * s, 2.3, 6.2], [17.3 * s, 2.3, 5.4]); const m = mesh(wl.build(), blue); g.add(m); }
  // 胴体下フェアリング
  const fair = mesh(new THREE.SphereGeometry(1, 20, 10), white); fair.scale.set(2.0, 1.0, 6.5); fair.position.set(0, -1.6, 0.5); g.add(fair);
  // エンジン
  for (const s of [1, -1]) {
    const eng = new THREE.Group(); eng.position.set(5.8 * s, -2.1, -3.6); g.add(eng);
    const nac = mesh(lathe(resample([[-2.6, 0.6], [-1.5, 0.95], [0.5, 1.08], [1.6, 1.05], [2.0, 0.98]], 10), 24), white); eng.add(nac);
    const fan = mesh(new THREE.CircleGeometry(0.92, 24), dark); fan.position.z = -1.98; fan.rotation.y = Math.PI; eng.add(fan);
    const spinner = mesh(new THREE.ConeGeometry(0.3, 0.6, 12).rotateX(-Math.PI / 2), metal); spinner.position.z = -2.1; eng.add(spinner);
    const core = mesh(new THREE.ConeGeometry(0.55, 1.4, 16).rotateX(Math.PI / 2), metal); core.position.z = 3.1; eng.add(core);
    const pyl = new GeoBuilder(); pyl.box(-0.18, 0.9, -1.2, 0.18, 1.6, 2.8, { col: [0.93, 0.94, 0.95] }); eng.add(mesh(pyl.build(), white));
  }
  // 水平尾翼・垂直尾翼
  const tb = new GeoBuilder();
  for (const s of [1, -1]) wing(tb, s, { x: 0.8, le: 14.0, te: 17.6, y: 0.6, t: 0.3 }, { x: 6.2, le: 17.4, te: 19.0, y: 1.0, t: 0.1 });
  g.add(mesh(tb.build(), white));
  const fin = new GeoBuilder();
  const F = [[0, 1.7, 12.0], [0, 1.7, 18.6], [0, 8.4, 19.8], [0, 8.4, 17.5]];
  fin.quad(F[0], F[1], F[2], F[3]); fin.quad(F[1], F[0], F[3], F[2]);
  g.add(mesh(fin.build(), blue));
  const parts = {};
  parts.elevator = [surface([0.8, 0.62, 17.6], [6.2, 1.0, 19.0], 1.2, 0.6, 0.1, white), surface([-0.8, 0.62, 17.6], [-6.2, 1.0, 19.0], 1.2, 0.6, 0.1, white)];
  parts.rudder = surface([0, 1.8, 18.6], [0, 8.3, 19.8], 1.4, 0.9, 0.12, blue, true);
  parts.aileronR = surface([11.5, -0.4, 5.0], [15.8, -0.05, 5.95], 0.8, 0.6, 0.08, white);
  parts.aileronL = surface([-11.5, -0.4, 5.0], [-15.8, -0.05, 5.95], 0.8, 0.6, 0.08, white);
  parts.flaps = [surface([2.0, -1.28, 3.8], [11.2, -0.42, 4.95], 1.8, 1.0, 0.1, grey), surface([-2.0, -1.28, 3.8], [-11.2, -0.42, 4.95], 1.8, 1.0, 0.1, grey)];
  parts.spoilers = [surface([3, -0.95, 2.8], [10, -0.3, 4.0], 1.0, 0.8, 0.05, grey), surface([-3, -0.95, 2.8], [-10, -0.3, 4.0], 1.0, 0.8, 0.05, grey)];
  [...parts.elevator, parts.rudder, parts.aileronL, parts.aileronR, ...parts.flaps, ...parts.spoilers].forEach((p) => g.add(p));
  // 降着装置（引込み）
  const gearList = [];
  for (const s of [1, -1]) {
    const leg = new THREE.Group(); leg.position.set(3.6 * s, -1.4, 1.6); g.add(leg);
    const strut = mesh(new THREE.CylinderGeometry(0.16, 0.16, 1.9, 10), metal); strut.position.y = -0.95; leg.add(strut);
    for (const dz of [-0.55, 0.55]) for (const dx of [-0.3, 0.3]) { const w = wheel(0.58, 0.38, dark); w.position.set(dx, -1.62, dz); leg.add(w); }
    gearList.push({ g: leg, axis: 'z', sign: -s, angle: Math.PI / 2 * 0.98 });
  }
  const nleg = new THREE.Group(); nleg.position.set(0, -1.3, -13.2); g.add(nleg);
  const ns = mesh(new THREE.CylinderGeometry(0.12, 0.12, 1.9, 10), metal); ns.position.y = -0.95; nleg.add(ns);
  for (const dx of [-0.22, 0.22]) { const w = wheel(0.38, 0.25, dark); w.position.set(dx, -1.92, 0); nleg.add(w); }
  gearList.push({ g: nleg, axis: 'x', sign: 1, angle: Math.PI / 2 * 0.95 });
  parts.gearList = gearList;
  parts.nav = navLights(g, [-17.1, 0.1, 4.6], [17.1, 0.1, 4.6], [0, 1.2, 19.6], [[0, 2.15, 0]]);
  parts.landingLight = [0, -1.4, -12.5];
  parts.engines = [[5.8, -2.1, 0.8], [-5.8, -2.1, 0.8]];
  return { group: g, parts };
}
function makeFuselageTex() {
  const W = 512, H = 2048; const c = document.createElement('canvas'); c.width = W; c.height = H; const g = c.getContext('2d');
  g.fillStyle = '#f5f6f8'; g.fillRect(0, 0, W, H);
  // u: 0 上, 0.25 右, 0.5 下, 0.75 左。 v: 0 尾 → 1 機首（canvas は上が機首）
  const L0 = -19.6, L1 = 18.0; const yOf = (z) => (1 - (z - L0) / (L1 - L0)) * H;
  g.fillStyle = '#c9ccd2'; g.fillRect(W * 0.36, 0, W * 0.28, H);
  for (const u of [0.215, 0.785]) { g.fillStyle = '#1d4f9c'; g.fillRect(W * u - 8, 0, 16, H); g.fillStyle = '#e0a020'; g.fillRect(W * u + (u < 0.5 ? 8 : -12), 0, 4, H); }
  g.fillStyle = '#1b2026';
  for (const u of [0.175, 0.825]) for (let z = -13; z < 12.5; z += 0.85) { if (Math.abs(z - 3.4) < 0.6) continue; g.fillRect(W * u - 5, yOf(z) - 6, 10, 12); }
  // ドア
  g.strokeStyle = '#8c9098'; g.lineWidth = 2;
  for (const u of [0.18, 0.82]) for (const z of [13.0, -14.2]) g.strokeRect(W * u - 14, yOf(z) - 26, 28, 52);
  // コックピット窓
  g.fillStyle = '#141a20';
  for (const [u0, u1] of [[0.03, 0.12], [0.13, 0.21], [0.79, 0.87], [0.88, 0.97]]) { g.beginPath(); g.moveTo(W * u0, yOf(16.0)); g.lineTo(W * u1, yOf(16.0)); g.lineTo(W * (u1 - 0.01), yOf(16.6)); g.lineTo(W * (u0 + 0.01), yOf(16.6)); g.fill(); }
  g.fillStyle = '#1d4f9c'; g.font = 'bold 44px sans-serif'; g.save();
  for (const [u, rot] of [[0.13, Math.PI / 2], [0.87, -Math.PI / 2]]) { g.save(); g.translate(W * u, yOf(2)); g.rotate(rot); g.textAlign = 'center'; g.fillText('SKY LINES', 0, 0); g.restore(); }
  g.restore();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}

// ---------- 戦闘機 ----------
function buildFighter() {
  const g = new THREE.Group();
  const grey = new THREE.MeshStandardMaterial({ color: 0x8b949c, roughness: 0.55, metalness: 0.25 });
  const dgrey = new THREE.MeshStandardMaterial({ color: 0x5f676f, roughness: 0.6, metalness: 0.25 });
  const canopyM = new THREE.MeshStandardMaterial({ color: 0x8a6a20, roughness: 0.05, metalness: 0.95, transparent: true, opacity: 0.85 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1c1c1e, roughness: 0.6 });
  const metal = new THREE.MeshStandardMaterial({ color: 0x6d7076, roughness: 0.3, metalness: 0.9 });
  const prof = resample([[-6.6, 0.5], [-5.5, 0.72], [-2, 0.9], [2.5, 0.92], [5.0, 0.72], [6.6, 0.55], [7.6, 0.35], [8.6, 0.05]], 40);
  g.add(mesh(lathe(prof, 24, 1.05, 0.95), grey));
  const can = mesh(new THREE.SphereGeometry(1, 20, 12), canopyM); can.scale.set(0.48, 0.5, 1.7); can.position.set(0, 0.68, -4.0); g.add(can);
  const spine = mesh(new THREE.SphereGeometry(1, 16, 8), grey); spine.scale.set(0.5, 0.55, 4.0); spine.position.set(0, 0.45, -0.8); g.add(spine);
  const intake = new GeoBuilder(); intake.box(-0.55, -1.3, -3.6, 0.55, -0.45, 2.0, { col: [0.55, 0.58, 0.62] }); g.add(mesh(intake.build(), dgrey));
  const imouth = mesh(new THREE.PlaneGeometry(1.0, 0.75), dark); imouth.position.set(0, -0.88, -3.61); imouth.rotation.y = Math.PI; g.add(imouth);
  const gb = new GeoBuilder();
  for (const s of [1, -1]) {
    wing(gb, s, { x: 0.8, le: -2.2, te: 3.6, y: -0.05, t: 0.25 }, { x: 4.75, le: 2.1, te: 3.4, y: -0.05, t: 0.06 });
    wing(gb, s, { x: 0.7, le: -5.6, te: -1.8, y: 0.0, t: 0.12 }, { x: 1.0, le: -2.3, te: -1.6, y: -0.03, t: 0.08 }); // LEX
  }
  g.add(mesh(gb.build(), grey));
  const tb = new GeoBuilder();
  for (const s of [1, -1]) wing(tb, s, { x: 0.8, le: 4.3, te: 6.6, y: -0.1, t: 0.1 }, { x: 2.9, le: 5.9, te: 6.8, y: -0.3, t: 0.05 });
  const htail = mesh(tb.build(), grey);
  const fin = new GeoBuilder(); const F = [[0, 0.75, 2.4], [0, 0.75, 6.2], [0, 4.6, 6.6], [0, 4.6, 5.6]];
  fin.quad(F[0], F[1], F[2], F[3]); fin.quad(F[1], F[0], F[3], F[2]);
  const finM = mesh(fin.build(), grey.clone()); finM.material.side = THREE.DoubleSide; g.add(finM);
  const parts = {};
  // 全遊動式水平尾翼（ヒンジは前縁）
  parts.elevator = [];
  for (const s of [1, -1]) { const p = new THREE.Group(); p.position.set(0, -0.1, 5.2); const inner = new THREE.Group(); p.add(inner); const m = mesh(tb.build(), grey); m.position.set(0, 0.1, -5.2); m.scale.x = 1; inner.add(m); p.userData.inner = inner; if (s === 1) parts.elevator.push(p); }
  g.add(parts.elevator[0]); void htail;
  parts.rudder = surface([0, 1.0, 6.2], [0, 4.4, 6.6], 0.8, 0.7, 0.08, grey, true);
  parts.aileronR = surface([1.2, -0.05, 3.6], [4.2, -0.05, 3.45], 0.7, 0.55, 0.05, grey);
  parts.aileronL = surface([-1.2, -0.05, 3.6], [-4.2, -0.05, 3.45], 0.7, 0.55, 0.05, grey);
  parts.flaps = [];
  [parts.rudder, parts.aileronL, parts.aileronR].forEach((p) => g.add(p));
  // ノズルとアフターバーナー
  const noz = mesh(new THREE.CylinderGeometry(0.62, 0.5, 1.3, 20, 1, true).rotateX(Math.PI / 2), metal); noz.position.z = 7.2; noz.material.side = THREE.DoubleSide; g.add(noz);
  const flameMat = new THREE.MeshBasicMaterial({ color: 0xffa040, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false });
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.5, 5, 16, 1, true).rotateX(-Math.PI / 2).translate(0, 0, 2.5), flameMat); flame.position.z = 7.8; g.add(flame);
  const flame2 = new THREE.Mesh(new THREE.ConeGeometry(0.32, 3, 16, 1, true).rotateX(-Math.PI / 2).translate(0, 0, 1.5), new THREE.MeshBasicMaterial({ color: 0x80a0ff, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
  flame2.position.z = 7.8; g.add(flame2);
  parts.flame = [flame, flame2];
  // 翼端ミサイル
  for (const s of [1, -1]) { const m = mesh(new THREE.CylinderGeometry(0.07, 0.07, 3, 8).rotateX(Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0xe8e8e8 })); m.position.set(4.85 * s, -0.05, 2.0); g.add(m); }
  // 降着装置
  const gearList = [];
  for (const s of [1, -1]) {
    const leg = new THREE.Group(); leg.position.set(1.0 * s, -0.8, 0.8); g.add(leg);
    const strut = mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.85, 8), metal); strut.position.y = -0.42; leg.add(strut);
    const w = wheel(0.36, 0.22, dark); w.position.set(0.12 * s, -0.95, 0); leg.add(w);
    gearList.push({ g: leg, axis: 'x', sign: 1, angle: Math.PI / 2 * 0.95 });
  }
  const nleg = new THREE.Group(); nleg.position.set(0, -1.25, -2.6); g.add(nleg);
  const ns = mesh(new THREE.CylinderGeometry(0.07, 0.07, 0.4, 8), metal); ns.position.y = -0.2; nleg.add(ns);
  const nw = wheel(0.25, 0.14, dark); nw.position.y = -0.5; nleg.add(nw);
  gearList.push({ g: nleg, axis: 'x', sign: -1, angle: Math.PI / 2 * 0.95 });
  parts.gearList = gearList;
  parts.nav = navLights(g, [-4.75, 0, 2.6], [4.75, 0, 2.6], [0, 4.6, 6.6], [[0, 4.65, 6.0]]);
  parts.landingLight = [0, -1.1, -2.7];
  return { group: g, parts };
}

export function buildModel(id) {
  const m = id === 'cessna' ? buildCessna() : id === 'airliner' ? buildAirliner() : buildFighter();
  m.group.traverse((o) => { if (o.isMesh) { o.castShadow = true; } });
  return m;
}

// 舵面・脚・プロペラなどのアニメーション
export function animateModel(model, st, spec, dt, t) {
  const p = model.parts, c = st.ctrl;
  const setRot = (piv, a) => { if (piv && piv.userData.inner) piv.userData.inner.rotation.x = a; };
  for (const e of p.elevator) setRot(e, -c.elev * 0.35);
  if (spec.id === 'fighter' && p.elevator[0]) p.elevator[0].userData.inner.rotation.x = -c.elev * 0.25;
  setRot(p.rudder, c.rudder * 0.4);
  setRot(p.aileronR, c.ail * 0.35); setRot(p.aileronL, -c.ail * 0.35);
  const fl = spec.flaps.length > 1 ? st.flapPos / (spec.flaps.length - 1) : 0;
  p.flaps.forEach((f) => setRot(f, fl * 0.6));
  if (p.spoilers) p.spoilers.forEach((s) => setRot(s, -st.spoiler * 0.8));
  if (p.prop) {
    const rpm = 600 + st.engineN * 2100; p.prop.rotation.z += (rpm / 60) * Math.PI * 2 * dt * (st.engineOn ? 1 : 0);
    p.propDisc.material.opacity = Math.min(0.25, st.engineN * 0.4) * (st.engineOn ? 1 : 0);
    p.prop.visible = st.engineN < 0.15 || Math.sin(t * 40) > 0;
  }
  for (const gl of p.gearList) {
    const a = (1 - st.gearPos) * gl.angle * gl.sign;
    if (gl.axis === 'z') gl.g.rotation.z = a; else gl.g.rotation.x = a;
    gl.g.visible = st.gearPos > 0.02;
  }
  if (p.flame) {
    const ab = st.ab ? 1 : 0, n = st.engineN;
    p.flame[0].material.opacity = ab * (0.55 + Math.random() * 0.2); p.flame[0].scale.set(1, 1, 0.6 + ab * (0.7 + Math.random() * 0.2));
    p.flame[1].material.opacity = 0.15 + n * 0.25 + ab * 0.4; p.flame[1].scale.set(1, 1, 0.3 + n * 0.5 + ab * 0.6);
  }
  const nv = p.nav; const strobe = (t % 1.2) < 0.06;
  nv.strobes.forEach((s) => (s.visible = strobe)); nv.beacon.visible = (t % 1.0) < 0.15;
}
