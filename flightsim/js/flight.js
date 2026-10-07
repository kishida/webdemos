// 飛行力学（簡易6自由度）: 揚力/抗力/推力/重力 + 迎角安定・舵の効き + 地上の拘束（脚・ブレーキ・前輪操向）
import * as THREE from 'three';
import { terrainHeight } from './layout.js';
import { WATER_Y, RWY } from './layout.js';
import { clamp, lerp } from './geo.js';

const G = 9.81;
const _v = new THREE.Vector3(), _fwd = new THREE.Vector3(), _up = new THREE.Vector3(), _right = new THREE.Vector3();
const _qi = new THREE.Quaternion(), _dq = new THREE.Quaternion(), _e = new THREE.Euler(), _F = new THREE.Vector3(), _ld = new THREE.Vector3();

function interp(arr, x) { const i = Math.floor(x), t = x - i; if (i >= arr.length - 1) return arr[arr.length - 1]; return arr[i] + (arr[i + 1] - arr[i]) * t; }

export function groundAt(x, z) {
  // 滑走路・空港は 0、それ以外は地形。水面より下なら水面
  const h = terrainHeight(x, z);
  if (h < WATER_Y) return { y: WATER_Y, water: true };
  return { y: h, water: false };
}
export function onRunway(x, z) { return Math.abs(x - RWY.x) < RWY.width / 2 + 1 && Math.abs(z) < RWY.length / 2 + 30; }

export function newState(spec) {
  return {
    pos: new THREE.Vector3(), vel: new THREE.Vector3(), q: new THREE.Quaternion(), w: new THREE.Vector3(),
    throttle: 0, engineN: 0, engineOn: true, ab: false, reverse: false,
    flapIdx: 0, flapPos: 0, gearDown: true, gearPos: 1, spoilerArmed: false, spoilerCmd: false, spoiler: 0,
    brake: 0, parkBrake: false,
    ctrl: { elev: 0, ail: 0, rudder: 0 }, trimAlpha: spec.trimAlpha, autoTrim: true, gammaHold: 0, pitchHold: null,
    onGround: true, crashed: null, alpha: 0, beta: 0, V: 0, ias: 0, gLoad: 1, stall: false, agl: 0,
    events: [], time: 0, wasAirborne: false, maxAgl: 0, touchdown: null, tailStrike: false, stallWarn: false,
    gust: new THREE.Vector3(),
  };
}

// 外部から状態を作る（開始位置）
export function placeOnRunway(st, spec, northbound = true) {
  st.pos.set(0, spec.gearH, northbound ? RWY.length / 2 - 40 - spec.gearH * 4 : -RWY.length / 2 + 40);
  st.q.setFromEuler(new THREE.Euler(spec.groundPitch, northbound ? 0 : Math.PI, 0, 'YXZ'));
  st.vel.set(0, 0, 0); st.w.set(0, 0, 0);
  st.throttle = 0; st.engineN = 0.25; st.flapIdx = spec.takeoffFlaps; st.flapPos = spec.takeoffFlaps;
  st.gearDown = true; st.gearPos = 1; st.onGround = true; st.parkBrake = true; st.trimAlpha = spec.trimAlpha;
}

// 3° のグライドパス上に、着陸形態でトリムされた状態で置く
export function placeOnApproach(st, spec, dist, northbound = true) {
  const aim = RWY.length / 2 - 300; const gs = 3 * Math.PI / 180;
  const z = northbound ? aim + dist : -(aim + dist);
  const alt = dist * Math.tan(gs) + 2;
  st.pos.set(0, alt, z);
  st.flapIdx = spec.landingFlaps; st.flapPos = spec.landingFlaps; st.gearDown = true; st.gearPos = 1;
  const V = spec.vApp;
  const rho = 1.225 * Math.exp(-alt / 8500), q = 0.5 * rho * V * V;
  const CLn = (spec.mass * G * Math.cos(gs)) / (q * spec.wingArea);
  const fCL = spec.flapCL[spec.landingFlaps];
  const alpha = (CLn - spec.CL0 - fCL) / spec.CLa;
  const CD = spec.CD0 + spec.K * CLn * CLn + spec.flapCD[spec.landingFlaps] + spec.gearCD;
  const D = q * spec.wingArea * CD;
  const T = Math.max(0, D - spec.mass * G * Math.sin(gs));
  const Tmax = spec.engine === 'prop' ? spec.thrust * Math.max(0.05, 1 - V / spec.propVmax) : spec.thrust * (1 - 0.0012 * V) * Math.pow(rho / 1.225, 0.7);
  st.throttle = clamp(T / Tmax, 0, 1); st.engineN = 0.2 + 0.8 * st.throttle;
  const yaw = northbound ? 0 : Math.PI;
  st.q.setFromEuler(new THREE.Euler(alpha - gs, yaw, 0, 'YXZ'));
  st.vel.set(0, -Math.sin(gs) * V, (northbound ? -1 : 1) * Math.cos(gs) * V);
  st.w.set(0, 0, 0); st.onGround = false; st.parkBrake = false; st.trimAlpha = alpha; st.gammaHold = -gs;
  st.wasAirborne = true; st.maxAgl = alt;
}

export function placeInAir(st, spec, x, alt, z, headingDeg, speed) {
  st.pos.set(x, alt, z);
  const yaw = -headingDeg * Math.PI / 180;
  const rho = 1.225 * Math.exp(-alt / 8500), q = 0.5 * rho * speed * speed;
  const CL = (spec.mass * G) / (q * spec.wingArea);
  const alpha = (CL - spec.CL0) / spec.CLa;
  st.q.setFromEuler(new THREE.Euler(alpha, yaw, 0, 'YXZ'));
  st.vel.set(-Math.sin(yaw) * speed * -1, 0, -Math.cos(yaw) * speed);
  st.vel.set(Math.sin(-yaw) * speed, 0, -Math.cos(-yaw) * speed);
  st.flapIdx = 0; st.flapPos = 0; st.gearDown = !spec.retractGear; st.gearPos = st.gearDown ? 1 : 0;
  const CD = spec.CD0 + spec.K * CL * CL + (st.gearDown ? spec.gearCD : 0);
  const D = q * spec.wingArea * CD;
  const Tmax = spec.engine === 'prop' ? spec.thrust * Math.max(0.05, 1 - speed / spec.propVmax) : spec.thrust * (1 - 0.0012 * speed) * Math.pow(rho / 1.225, 0.7);
  st.throttle = clamp(D / Tmax, 0.1, 1); st.engineN = 0.2 + 0.8 * st.throttle;
  st.w.set(0, 0, 0); st.onGround = false; st.parkBrake = false; st.trimAlpha = alpha; st.gammaHold = 0;
  st.wasAirborne = true; st.maxAgl = alt;
}

function emit(st, type, data = {}) { st.events.push({ type, ...data }); }

export function step(st, spec, dt, env) {
  if (st.crashed) return;
  st.time += dt;
  const m = spec.mass;
  const nFlaps = spec.flaps.length;
  // 形態の遷移
  st.flapPos += clamp(st.flapIdx - st.flapPos, -dt / (spec.id === 'airliner' ? 6 : 3), dt / (spec.id === 'airliner' ? 6 : 3)) * (nFlaps - 1) / Math.max(1, nFlaps - 1);
  if (spec.retractGear) st.gearPos = clamp(st.gearPos + (st.gearDown ? 1 : -1) * dt / (spec.id === 'airliner' ? 8 : 5), 0, 1);
  const spTarget = st.spoilerCmd ? 1 : 0;
  st.spoiler += clamp(spTarget - st.spoiler, -dt * 1.5, dt * 1.5);

  // エンジン
  let thrTarget = Math.abs(st.throttle);
  st.reverse = st.throttle < -0.01;
  const spool = spec.spool * (st.engineN < 0.3 ? 1.5 : 1);
  st.engineN += (0.2 + 0.8 * thrTarget - st.engineN) * (1 - Math.exp(-dt / spool));
  if (!st.engineOn) st.engineN = Math.max(0, st.engineN - dt * 0.3);
  const n1 = st.engineOn ? clamp((st.engineN - 0.2) / 0.8, 0, 1) : 0;
  const prevAb = st.ab;
  st.ab = spec.abThrust && st.throttle > 0.97 && st.engineN > 0.9 && st.engineOn;
  if (st.ab && !prevAb) emit(st, 'ab');

  // 空気
  const alt = st.pos.y;
  const rho = 1.225 * Math.exp(-Math.max(0, alt) / 8500);
  _v.copy(st.vel).sub(env.wind).sub(st.gust);
  const V = _v.length();
  const qbar = 0.5 * rho * V * V;
  _qi.copy(st.q).invert();
  _fwd.set(0, 0, -1).applyQuaternion(st.q); _up.set(0, 1, 0).applyQuaternion(st.q); _right.set(1, 0, 0).applyQuaternion(st.q);
  const vb = _v.clone().applyQuaternion(_qi);
  const alpha = V > 3 ? Math.atan2(-vb.y, -vb.z) : 0;
  const beta = V > 3 ? Math.asin(clamp(vb.x / V, -1, 1)) : 0;
  st.alpha = alpha; st.beta = beta; st.V = V; st.ias = V * Math.sqrt(rho / 1.225);

  // 揚力係数
  const fCL = interp(spec.flapCL, st.flapPos), fCD = interp(spec.flapCD, st.flapPos), fSt = interp(spec.flapStall, st.flapPos);
  const aSt = spec.alphaStall + fSt, aStN = -spec.alphaStall * 0.8;
  let CL;
  if (alpha > aSt) {
    const ex = alpha - aSt; const peak = spec.CL0 + spec.CLa * aSt;
    const drop = spec.stallDrop ?? 0.72;
    CL = lerp(peak * drop, 1.05 * Math.sin(2 * alpha), smoothstep01(ex / 0.35));
    if (ex < 0.06) CL = lerp(peak, peak * drop, ex / 0.06);
  } else if (alpha < aStN) {
    const peak = spec.CL0 + spec.CLa * aStN; CL = lerp(peak * 0.7, 1.05 * Math.sin(2 * alpha), smoothstep01((aStN - alpha) / 0.35));
  } else CL = spec.CL0 + spec.CLa * alpha;
  const stalled = alpha > aSt || alpha < aStN;
  CL += fCL * (stalled ? 0.6 : 1);
  CL -= 0.45 * st.spoiler * (spec.id === 'airliner' ? 1 : 0.3);
  // 地面効果: 翼幅程度の高度以下で誘導抗力が減り揚力が少し増える
  const ge = Math.exp(-2.5 * Math.max(0, st.agl) / spec.span);
  CL *= 1 + 0.05 * ge;
  const mach = V / 340;
  let CD = spec.CD0 + spec.K * (1 - 0.35 * ge) * CL * CL + fCD + spec.gearCD * st.gearPos + spec.spoilerCD * st.spoiler + 1.1 * Math.sin(alpha) ** 2 * (stalled ? 1 : 0.25) + 0.6 * Math.max(0, mach - 0.8) ** 2;
  CD += Math.abs(beta) * 0.3;
  const S = spec.wingArea;
  st.stall = stalled && !st.onGround && V > 5;
  st.stallWarn = !st.onGround && V > 5 && alpha > aSt - (spec.fbw ? 1.5 : 3) * Math.PI / 180;

  _F.set(0, -m * G, 0);
  if (V > 0.5) {
    const vdir = _v.clone().divideScalar(V);
    _ld.copy(_up).addScaledVector(vdir, -_up.dot(vdir));
    if (_ld.lengthSq() > 1e-6) _ld.normalize();
    _F.addScaledVector(_ld, qbar * S * CL);
    _F.addScaledVector(vdir, -qbar * S * CD);
    _F.addScaledVector(_right, -qbar * S * spec.sideCoef * beta);
  }
  // 推力
  let T;
  const rr = rho / 1.225;
  if (spec.engine === 'prop') T = n1 * spec.thrust * Math.max(0, 1 - V / spec.propVmax) * rr + (st.engineOn ? 120 : 0);
  else T = n1 * (st.ab ? spec.abThrust : spec.thrust) * (1 - 0.0012 * V) * Math.pow(rr, 0.7) + (st.engineOn ? spec.thrust * 0.025 : 0);
  if (st.reverse) T = -0.45 * n1 * spec.thrust;
  st.thrust = T;
  _F.addScaledVector(_fwd, T);

  const liftUp = qbar * S * CL;
  st.gLoad = (_F.clone().addScaledVector(_up, 0).dot(_up) + m * G * _up.y) / (m * G);

  // ---- 回転 ----
  const eff = clamp(qbar / (0.5 * 1.225 * spec.vRef * spec.vRef), 0, 2.2);
  const re = Math.sqrt(eff);
  const c = st.ctrl;
  const _ee = new THREE.Euler().setFromQuaternion(st.q, 'YXZ');
  const bank = _ee.z, pitch = _ee.x;
  const gamma = V > 3 ? Math.asin(clamp(st.vel.y / Math.max(1, st.vel.length()), -1, 1)) : 0;
  let alphaCmd, wff = 0, dwx;
  if (spec.fbw && !st.onGround && V > 20) {
    const qS = Math.max(1, qbar * S);
    const cg = Math.cos(gamma) * Math.cos(bank);
    if (Math.abs(c.elev) > 0.04) {
      // スティック操作中: ピッチレート指令（荷重倍数・迎角の保護つき）
      // 脚下げ時は着陸用の穏やかなゲイン
      let qc = c.elev * spec.qMax * Math.min(1, V / spec.vRef) * (st.gearPos > 0.5 ? spec.qGearDown : 1);
      qc = clamp(qc, (1 - spec.nMin - cg) * G / V, (spec.nMax - cg) * G / V);
      const aMax = spec.alphaProt + fSt;
      if (alpha > aMax - 0.04) qc = Math.min(qc, (aMax - alpha) * 4);
      dwx = (qc - st.w.x) * spec.qResp * Math.min(1, eff + 0.3);
      st.gammaHold = gamma; st.flareHold = null;
    } else if (st.agl < 15 && st.gearPos > 0.5) {
      // フレアモード: 姿勢を保持しつつ、ゆっくり機首を下げる（接地を促す）
      if (st.flareHold == null) st.flareHold = pitch;
      st.flareHold -= (0.004 + Math.max(0, st.vel.y) * 0.025) * dt; // 浮き上がったら機首を少し下げる
      alphaCmd = Math.min(alpha + clamp(st.flareHold - pitch, -0.1, 0.1) * 1.6, spec.alphaProt + fSt);
      dwx = spec.pitchStab * eff * (alphaCmd - alpha) - spec.pitchDamp * (re + 0.15) * st.w.x;
      st.gammaHold = gamma;
    } else {
      st.flareHold = null;
      // スティック中立: 飛行経路角を保持（バンク33°まで自動で荷重補正）
      // フレア中（低高度・アイドル）は上昇経路を保持しない
      if (st.agl < 15 && st.gearPos > 0.5 && st.throttle < 0.15) st.gammaHold = Math.min(st.gammaHold, -0.005);
      const cb = Math.max(Math.cos(Math.min(Math.abs(bank), 33 * Math.PI / 180)), 0.3);
      const n = Math.cos(gamma) / cb + (V / G) * 0.9 * (st.gammaHold - gamma);
      const CLc = (n * m * G) / qS;
      alphaCmd = (CLc - spec.CL0 - fCL + 0.45 * st.spoiler * (spec.id === 'airliner' ? 1 : 0.3)) / spec.CLa;
      alphaCmd = clamp(alphaCmd, -0.2, spec.alphaProt + fSt);
      const nAch = (spec.CL0 + fCL + spec.CLa * alphaCmd) * qS / (m * G);
      wff = clamp((Math.min(n, nAch) - cg) * G / V, -0.6, 1.2);
      dwx = spec.pitchStab * eff * (alphaCmd - alpha) - spec.pitchDamp * (re + 0.15) * (st.w.x - wff);
    }
    st.trimAlpha = alpha;
  } else {
    const active = Math.abs(c.elev) >= 0.04;
    if (st.onGround) { alphaCmd = c.elev * spec.alphaRange * 1.3; st.pitchHold = null; }
    else if (st.autoTrim) {
      // オートトリム: 操作中は迎角指令、離すとその時のピッチ姿勢を保持
      if (active) { if (!st.prevElevActive) st.trimAlpha = clamp(alpha, -0.1, aSt); alphaCmd = st.trimAlpha + c.elev * spec.alphaRange; }
      else {
        if (st.prevElevActive || st.pitchHold == null) st.pitchHold = pitch;
        if (st.agl < 10 && st.throttle < 0.15 && st.vel.y > 0) st.pitchHold -= st.vel.y * 0.025 * dt; // フレア時の浮き上がり補正
        alphaCmd = Math.min(alpha + clamp(st.pitchHold - pitch, -0.12, 0.12) * 1.6, aSt + 0.03);
      }
    } else alphaCmd = st.trimAlpha + c.elev * spec.alphaRange;
    st.prevElevActive = active;
    dwx = spec.pitchStab * eff * (alphaCmd - alpha) - spec.pitchDamp * (re + 0.15) * st.w.x;
  }
  let rollCmd = -c.ail * spec.rollRate * Math.min(1, eff * 1.4 + 0.05);
  if (spec.bankLimit < 10 && !st.onGround) { // 旅客機のバンク角保護
    if (Math.abs(bank) > spec.bankLimit) rollCmd = -Math.sign(bank) * 0.3;
    else if (Math.abs(c.ail) < 0.05 && Math.abs(bank) > 33 * Math.PI / 180) rollCmd = -Math.sign(bank) * 0.08;
  }
  let dwz = (rollCmd - st.w.z) * spec.rollResp * Math.min(1, eff + 0.25) + spec.dihedral * eff * beta * 2;
  let dwy = -c.rudder * spec.yawAuth * eff - spec.yawStab * eff * beta - spec.yawDamp * (re + 0.1) * st.w.y;
  if (st.stall) { // 失速時の翼の落ち込み
    dwz += Math.sin(st.time * 1.7) * 1.5 * (spec.fbw ? 0.2 : 1); dwy += Math.sin(st.time * 1.1) * 0.3;
  }
  // 乱気流
  if (!st.onGround && env.turb > 0) { dwx += (Math.random() - 0.5) * env.turb * 0.5 * re; dwz += (Math.random() - 0.5) * env.turb * 1.2 * re; }
  st.w.x += dwx * dt; st.w.y += dwy * dt; st.w.z += dwz * dt;

  // 並進
  _F.divideScalar(m);
  st.vel.addScaledVector(_F, dt);
  st.pos.addScaledVector(st.vel, dt);
  // 姿勢
  const wl = st.w.length();
  if (wl > 1e-6) { _dq.setFromAxisAngle(_v.copy(st.w).divideScalar(wl), wl * dt); st.q.multiply(_dq).normalize(); }

  // ---- 地面 ----
  const gnd = groundAt(st.pos.x, st.pos.z);
  const contactH = st.gearPos > 0.9 ? spec.gearH : spec.gearH * 0.45;
  const h = st.pos.y - gnd.y;
  st.agl = h - spec.gearH;
  if (!st.onGround) st.maxAgl = Math.max(st.maxAgl, st.agl);
  if (st.agl > 15) { if (!st.wasAirborne) emit(st, 'liftoff'); st.wasAirborne = true; }

  if (h <= contactH) {
    _e.setFromQuaternion(st.q, 'YXZ');
    let p = _e.x, yaw = _e.y, roll = _e.z;
    const vs = st.vel.y;
    if (!st.onGround) {
      const reason = gnd.water ? '着水（水面に墜落）' : st.gearPos < 0.9 ? '胴体着陸（脚が出ていません）' : vs < -spec.crashVS * 1.8 ? '激しい接地による機体損傷' :
        Math.abs(roll) > 0.3 ? '翼端が地面に接触' : p < -0.12 ? '機首から地面に激突' : null;
      if (reason) { crash(st, reason); return; }
      st.touchdown = { vs, x: st.pos.x, z: st.pos.z, ias: st.ias, pitch: p, roll, runway: onRunway(st.pos.x, st.pos.z), hard: vs < -spec.crashVS, time: st.time };
      emit(st, 'touchdown', st.touchdown);
      if (spec.id === 'airliner' && st.spoilerArmed && st.throttle < 0.15) st.spoilerCmd = true;
    }
    st.onGround = true;
    st.pos.y = gnd.y + contactH;
    if (st.vel.y < 0) st.vel.y = 0;
    const W = m * G; const wow = clamp(1 - liftUp / W, 0, 1);
    roll *= Math.exp(-12 * dt); st.w.z = 0;
    if (p < spec.groundPitch) { p = spec.groundPitch; st.w.x = Math.max(0, st.w.x); }
    if (p > spec.tailStrike) { p = spec.tailStrike; st.w.x = Math.min(0, st.w.x); if (!st.tailStrike) { st.tailStrike = true; emit(st, 'tailstrike'); } }
    if (p > spec.groundPitch + 0.002) st.w.x -= 2.5 * wow * dt * (1 + 0.5 * (st.ctrl.elev < 0.1 ? 1 : 0));
    const gs = Math.hypot(st.vel.x, st.vel.z);
    const steer = -st.ctrl.rudder * spec.steer * Math.min(1, gs / 4) / (1 + gs / 25);
    st.w.y = lerp(st.w.y, steer, Math.min(1, wow * 1.2));
    _e.set(p, yaw, roll, 'YXZ'); st.q.setFromEuler(_e);
    // タイヤ摩擦・ブレーキ
    const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
    let vf = st.vel.x * fx + st.vel.z * fz;
    let lx = st.vel.x - fx * vf, lz = st.vel.z - fz * vf;
    const k = Math.exp(-7 * Math.max(wow, 0.15) * dt); lx *= k; lz *= k;
    const rough = onRunway(st.pos.x, st.pos.z) || (Math.abs(st.pos.x - 200) < 12 && Math.abs(st.pos.z) < 1500) ? 0.015 : 0.06;
    const br = Math.max(st.brake, st.parkBrake ? 1 : 0);
    const dec = (rough * G + br * spec.brake) * Math.max(wow, 0.1);
    if (Math.abs(vf) <= dec * dt) vf = st.parkBrake && Math.abs(T) < m * spec.brake * 0.9 ? 0 : vf - Math.sign(vf) * Math.min(Math.abs(vf), dec * dt);
    else vf -= Math.sign(vf) * dec * dt;
    st.vel.x = fx * vf + lx; st.vel.z = fz * vf + lz;
    if (!onRunway(st.pos.x, st.pos.z) && gnd.y > 0.5 && gs > 25 && Math.abs(st.pos.x) > 150) { crash(st, '滑走路を逸脱して地形に衝突'); return; }
  } else if (h > contactH + 0.4) {
    if (st.onGround) emit(st, 'airborne');
    st.onGround = false; st.tailStrike = false;
  }
  // 建物・塔
  if (env.world) {
    const r = spec.id === 'airliner' ? 8 : spec.id === 'fighter' ? 3.5 : 3;
    const hit = env.world.collide(st.pos.x, st.pos.y, st.pos.z, r);
    if (hit) { crash(st, '建造物に衝突'); return; }
  }
  if (st.pos.y - gnd.y < contactH - 1.5) { crash(st, gnd.water ? '着水（水面に墜落）' : '地面に激突'); return; }
}

function crash(st, reason) {
  st.crashed = reason; emit(st, 'crash', { reason });
}
function smoothstep01(t) { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); }
