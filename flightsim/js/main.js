// SKY HARBOR — メイン: レンダラー、時間帯、入力、カメラ、ゲーム進行
import * as THREE from 'three';
import { Sky } from 'three/addons/Sky.js';
import { mergeGeometries } from 'three/addons/BufferGeometryUtils.js';
import { World } from './world.js';
import { SPECS, buildModel, animateModel } from './aircraft.js';
import { newState, step, placeOnRunway, placeOnApproach, placeInAir, groundAt, onRunway } from './flight.js';
import { HUD, GREEN, AMBER, RED, WHITE, CYAN } from './hud.js';
import { Audio } from './audio.js';
import { Particles } from './effects.js';
import { setAnisotropy } from './textures.js';
import { TouchControls, isTouchDevice, isPortrait } from './touch.js';
import { RWY, terrainHeight, DOWNTOWN } from './layout.js';
import { clamp, lerp } from './geo.js';

const D2R = Math.PI / 180;
const $ = (id) => document.getElementById(id);

// ---------- レンダラー ----------
const canvas = $('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, logarithmicDepthBuffer: true, powerPreference: 'high-performance' });
// スマホ・タブレットは負荷を下げる
const LOW = isTouchDevice;
renderer.setPixelRatio(Math.min(window.devicePixelRatio, LOW ? 1 : 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.outputColorSpace = THREE.SRGBColorSpace;
setAnisotropy(Math.min(8, renderer.capabilities.getMaxAnisotropy()));
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.25, 95000);
const hud = new HUD($('hud'));

const sky = new Sky(); sky.scale.setScalar(80000); scene.add(sky);
const sun = new THREE.DirectionalLight(0xffffff, 3); sun.castShadow = true;
sun.shadow.mapSize.set(LOW ? 1024 : 2048, LOW ? 1024 : 2048); sun.shadow.bias = -0.0003; sun.shadow.normalBias = 0.6;
scene.add(sun); scene.add(sun.target);
const hemi = new THREE.HemisphereLight(0xbcd4ff, 0x5a5040, 0.8); scene.add(hemi);
scene.fog = new THREE.FogExp2(0xb4c8de, 0.000035);
const pmrem = new THREE.PMREMGenerator(renderer);
const skyScene = new THREE.Scene(); const sky2 = new Sky(); sky2.scale.setScalar(1000); skyScene.add(sky2);
let envRT = null;

const TIMES = {
  morning: { el: 9, az: 100, col: 0xffd0a0, I: 2.4, hs: 0xc8d8f0, hg: 0x6a5a48, hI: 0.75, fog: 0xd6cabe, fd: 0.00004, exp: 0.55, night: 0.12, turb: 3.5, ray: 2.2, cloud: [1, 0.93, 0.86] },
  noon: { el: 58, az: 165, col: 0xfff4e6, I: 3.0, hs: 0xbcd4ff, hg: 0x5f5a48, hI: 0.85, fog: 0xb6cadf, fd: 0.000033, exp: 0.5, night: 0, turb: 4, ray: 1.3, cloud: [1, 1, 1] },
  evening: { el: 3.5, az: 258, col: 0xff9550, I: 1.9, hs: 0xd8a890, hg: 0x504038, hI: 0.55, fog: 0xd49c80, fd: 0.000042, exp: 0.62, night: 0.6, turb: 8, ray: 3, cloud: [1, 0.72, 0.58] },
  night: { el: -9, az: 250, moon: { el: 38, az: 200 }, col: 0x9fb4ff, I: 0.32, hs: 0x2a3a60, hg: 0x101010, hI: 0.4, fog: 0x0a0f1c, fd: 0.00004, exp: 0.85, night: 1, turb: 0.8, ray: 0.35, cloud: [0.12, 0.14, 0.2] },
};
let sunDir = new THREE.Vector3(0, 1, 0);
function dirFrom(el, az) { return new THREE.Vector3(Math.sin(az * D2R) * Math.cos(el * D2R), Math.sin(el * D2R), -Math.cos(az * D2R) * Math.cos(el * D2R)); }
function applyTime(name) {
  const P = TIMES[name];
  const sd = dirFrom(P.el, P.az);
  for (const s of [sky, sky2]) {
    const u = s.material.uniforms;
    u.turbidity.value = P.turb; u.rayleigh.value = P.ray; u.mieCoefficient.value = 0.005; u.mieDirectionalG.value = 0.82;
    u.sunPosition.value.copy(sd);
  }
  sunDir = P.moon ? dirFrom(P.moon.el, P.moon.az) : sd;
  sun.color.set(P.col); sun.intensity = P.I;
  hemi.color.set(P.hs); hemi.groundColor.set(P.hg); hemi.intensity = P.hI;
  scene.fog.color.set(P.fog); scene.fog.density = P.fd;
  renderer.toneMappingExposure = P.exp;
  if (envRT) envRT.dispose();
  envRT = pmrem.fromScene(skyScene, 0, 0.1, 5000); scene.environment = envRT.texture;
  scene.environmentIntensity = P.night ? 0.25 : 0.8;
  world.setNight(P.night, new THREE.Color(...P.cloud));
  nightLevel = P.night;
}
let nightLevel = 0;

// ---------- ワールド ----------
const world = new World(scene); world.low = LOW;
const particles = new Particles(scene);

// ---------- 状態 ----------
const cfg = { aircraft: 'cessna', start: 'runway', time: 'noon', wind: 'calm' };
let mode = 'loading';  // loading | menu | flight | paused | result | crash
let spec = null, st = null, model = null, modelCache = {};
const env = { wind: new THREE.Vector3(), turb: 0, world, gustAmp: 0 };
let camMode = 0; const CAMS = ['チェイス', 'コックピット', '管制塔', 'フライバイ'];
const cam = { yaw: 0, yawOff: 0, pitchOff: 12 * D2R, dist: 1, lookYaw: 0, lookPitch: 0, flyby: null, smoothYaw: 0 };
let smokeOn = false, callouts = [], lastCallAlt = 1e9, markers = {}, warnTimers = {}, landingLight = null, resultShown = false, crashTimer = 0;
const clock = new THREE.Clock();

// ---------- 入力 ----------
const keys = {};
window.addEventListener('keydown', (e) => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space', 'Tab'].includes(e.code)) e.preventDefault();
  if (keys[e.code]) return;
  keys[e.code] = true;
  onKey(e);
});
window.addEventListener('keyup', (e) => { keys[e.code] = false; });
window.addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
let drag = null; const ptrs = new Map(); let pinch = null;
canvas.addEventListener('pointerdown', (e) => {
  ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); canvas.setPointerCapture(e.pointerId);
  if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), dist: cam.dist }; drag = null; }
  else drag = { x: e.clientX, y: e.clientY };
});
const ptrUp = (e) => { ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch = null; if (ptrs.size === 0) drag = null; };
canvas.addEventListener('pointerup', ptrUp); canvas.addEventListener('pointercancel', ptrUp);
canvas.addEventListener('pointermove', (e) => {
  if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pinch && ptrs.size >= 2) { const [a, b] = [...ptrs.values()]; cam.dist = clamp(pinch.dist * pinch.d / Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)), 0.35, 6); return; }
  if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag = { x: e.clientX, y: e.clientY };
  if (camMode === 1) { cam.lookYaw = clamp(cam.lookYaw - dx * 0.004, -2.6, 2.6); cam.lookPitch = clamp(cam.lookPitch - dy * 0.004, -1.0, 1.2); }
  else { cam.yawOff -= dx * 0.006; cam.pitchOff = clamp(cam.pitchOff + dy * 0.004, -0.3, 1.45); }
});
canvas.addEventListener('dblclick', () => { cam.yawOff = 0; cam.pitchOff = 12 * D2R; cam.lookYaw = 0; cam.lookPitch = 0; });
canvas.addEventListener('wheel', (e) => { cam.dist = clamp(cam.dist * (e.deltaY > 0 ? 1.1 : 0.9), 0.35, 6); }, { passive: true });
document.addEventListener('pointerdown', () => { ensureAudio(); }, { once: false });

async function ensureAudio() {
  if (Audio.ready) return;
  try { await Audio.init(); if (mode === 'menu') Audio.playTitle(); } catch (err) { console.warn(err); }
}

function onKey(e) {
  if (e.code === 'KeyM') { const m = Audio.toggleMute(); if (st) hud.message(m ? 'ミュート' : 'サウンド ON'); return; }
  if (e.code === 'KeyH') { $('help').classList.toggle('show'); return; }
  if (mode === 'flight' && (e.code === 'Escape' || e.code === 'KeyP')) { setMode('paused'); return; }
  if (mode === 'paused' && (e.code === 'Escape' || e.code === 'KeyP')) { setMode('flight'); return; }
  if (mode !== 'flight' || !st || st.crashed) return;
  const sfx = (n) => Audio.sfx(n);
  switch (e.code) {
    case 'KeyG':
      if (!spec.retractGear) { hud.message('この機体は固定脚です'); break; }
      if (st.onGround && st.gearDown) { hud.message('地上では脚を上げられません', AMBER); break; }
      st.gearDown = !st.gearDown; sfx('gear'); hud.message(st.gearDown ? '脚 下げ' : '脚 上げ'); break;
    case 'KeyV': if (st.flapIdx < spec.flaps.length - 1) { st.flapIdx++; sfx('flap'); hud.message(`フラップ ${spec.flaps[st.flapIdx]}`, CYAN); } break;
    case 'KeyB': if (st.flapIdx > 0) { st.flapIdx--; sfx('flap'); hud.message(`フラップ ${spec.flaps[st.flapIdx]}`, CYAN); } break;
    case 'KeyK':
      if (!spec.spoilerCD) break;
      if (spec.id === 'airliner') {
        if (st.spoilerCmd) { st.spoilerCmd = false; st.spoilerArmed = false; hud.message('スポイラー 格納'); }
        else if (!st.spoilerArmed) { st.spoilerArmed = true; hud.message('グラウンドスポイラー アーム', CYAN); }
        else { st.spoilerCmd = true; hud.message('スピードブレーキ 展開', AMBER); }
      } else { st.spoilerCmd = !st.spoilerCmd; hud.message(st.spoilerCmd ? 'スピードブレーキ 展開' : 'スピードブレーキ 格納'); }
      sfx('click'); break;
    case 'KeyX': st.parkBrake = !st.parkBrake; sfx('click'); hud.message(st.parkBrake ? 'パーキングブレーキ ON' : 'パーキングブレーキ 解除'); break;
    case 'KeyC': setCam((camMode + 1) % CAMS.length); break;
    case 'KeyT': st.autoTrim = !st.autoTrim; hud.message(`オートトリム ${st.autoTrim ? 'ON' : 'OFF'}`); break;
    case 'KeyZ': smokeOn = !smokeOn; hud.message(`スモーク ${smokeOn ? 'ON' : 'OFF'}`); break;
    case 'KeyL': lightsOn = !lightsOn; hud.message(`着陸灯 ${lightsOn ? 'ON' : 'OFF'}`); sfx('click'); break;
    case 'KeyN': restart(); break;
    default:
      if (/^Digit[0-9]$/.test(e.code)) { const n = +e.code.slice(5); st.throttle = n === 0 ? 1 : n / 10; if (n === 1) st.throttle = 0; }
  }
}
let lightsOn = true;
const touch = new TouchControls((e) => onKey(e));
let touchOn = isTouchDevice, rotatePaused = false;
function applyTouchSetting() { touchOn = $('optTouch').checked; document.body.classList.toggle('touch', touchOn); hud.compact = touchOn || window.innerHeight < 500; }
// 縦向きになったら一時停止して横向きを促す
function checkOrientation() {
  // 横向き要求はスマホ/タブレットのみ（PCで縦長ウィンドウにしても止めない）
  const need = isTouchDevice && touchOn && isPortrait() && (mode === 'flight' || mode === 'paused');
  $('rotate').classList.toggle('show', need);
  if (need && mode === 'flight') { rotatePaused = true; setMode('paused'); }
  else if (!need && rotatePaused && mode === 'paused') { rotatePaused = false; setMode('flight'); }
}
matchMedia('(orientation: portrait)').addEventListener('change', () => setTimeout(checkOrientation, 50));
async function goFullscreenLandscape() {
  try { if (!document.fullscreenElement && document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen({ navigationUI: 'hide' }); } catch {}
  try { if (screen.orientation && screen.orientation.lock) await screen.orientation.lock('landscape'); } catch {}
}

function readInput(dt) {
  const k = keys;
  const pitchT = ((k.KeyS || k.ArrowDown) ? 1 : 0) - ((k.KeyW || k.ArrowUp) ? 1 : 0);
  const rollT = ((k.KeyD || k.ArrowRight) ? 1 : 0) - ((k.KeyA || k.ArrowLeft) ? 1 : 0);
  const yawT = (k.KeyE ? 1 : 0) - (k.KeyQ ? 1 : 0);
  let pad = null;
  for (const gp of navigator.getGamepads ? navigator.getGamepads() : []) if (gp && gp.connected) { pad = gp; break; }
  const c = st.ctrl;
  const rate = spec.id === 'fighter' ? 3.5 : 2.2;
  const app = (cur, tgt, r) => cur + clamp(tgt - cur, -r * dt, r * dt);
  const dz = (v) => (Math.abs(v) < 0.12 ? 0 : (v - Math.sign(v) * 0.12) / 0.88);
  const ta = touchOn ? touch.axes() : { active: false };
  if (ta.active && !pitchT && !rollT) {
    // タッチ/傾き: 中心付近を細かく（2乗カーブ）
    const curve = (v) => Math.sign(v) * (0.35 * Math.abs(v) + 0.65 * v * v);
    c.elev = app(c.elev, curve(ta.pitch), 6); c.ail = app(c.ail, curve(ta.roll), 8);
    c.rudder = app(c.rudder, touch.rudder || yawT, 2.5);
  } else if (pad && (Math.abs(dz(pad.axes[0])) > 0 || Math.abs(dz(pad.axes[1])) > 0 || Math.abs(dz(pad.axes[2] || 0)) > 0) && !pitchT && !rollT) {
    c.elev = dz(pad.axes[1]); c.ail = dz(pad.axes[0]); c.rudder = dz(pad.axes[2] || 0);
  } else {
    c.elev = app(c.elev, pitchT, pitchT ? spec.pitchKeyRate : spec.pitchKeyRate * 2);
    c.ail = app(c.ail, rollT, rollT ? rate * 1.4 : rate * 2);
    c.rudder = app(c.rudder, yawT || (touchOn ? touch.rudder : 0), 2.5);
  }
  if (touchOn && touch.throttleDrag != null) {
    const canRev = spec.id === 'airliner' && st.onGround;
    st.throttle = canRev ? touch.throttleDrag : Math.max(0, touch.throttleDrag);
  }
  // スロットル
  const thrUp = k.KeyR || k.PageUp || k.ShiftLeft, thrDn = k.KeyF || k.PageDown;
  if (thrUp) st.throttle = Math.min(1, st.throttle + dt * 0.5);
  if (thrDn) {
    const canRev = spec.engine !== 'prop' && st.onGround && spec.id === 'airliner';
    st.throttle = Math.max(canRev && st.throttle <= 0 ? -1 : 0, st.throttle - dt * 0.5);
  }
  if (pad) {
    const rt = pad.buttons[7]?.value || 0, lt = pad.buttons[6]?.value || 0;
    if (rt > 0.05) st.throttle = Math.min(1, st.throttle + dt * 0.6 * rt);
    if (lt > 0.05) st.throttle = Math.max(0, st.throttle - dt * 0.6 * lt);
    padButtons(pad);
  }
  if (st.reverse && !st.onGround) st.throttle = 0;
  st.brake = k.Space || (pad && pad.buttons[0]?.pressed) || (touchOn && touch.brake) ? 1 : 0;
  if (st.brake && st.parkBrake) st.parkBrake = false;
  // トリム
  const tr = (k.BracketLeft || k.Home ? 1 : 0) - (k.BracketRight || k.End ? 1 : 0);
  if (tr) {
    if (spec.fbw) st.gammaHold = clamp(st.gammaHold + tr * dt * 0.03, -0.3, 0.3);
    else if (st.autoTrim && st.pitchHold != null) st.pitchHold = clamp(st.pitchHold + tr * dt * 0.04, -0.4, 0.4);
    else st.trimAlpha = clamp(st.trimAlpha + tr * dt * 0.03, -0.1, spec.alphaStall);
  }
}
const padPrev = {};
function padButtons(pad) {
  const map = { 3: 'KeyG', 2: 'KeyV', 1: 'KeyB', 4: 'KeyC', 5: 'KeyK', 9: 'Escape' };
  for (const [i, code] of Object.entries(map)) {
    const p = !!pad.buttons[i]?.pressed;
    if (p && !padPrev[i]) onKey({ code });
    padPrev[i] = p;
  }
}

// ---------- カメラ ----------
function setCam(m) {
  camMode = m; cam.flyby = null;
  $('camlabel').textContent = `視点: ${CAMS[m]}（C で切替 / ドラッグで回転 / ホイールでズーム）`;
  if (model) model.group.visible = m !== 1;
}
const _t = new THREE.Vector3(), _o = new THREE.Vector3(), _q = new THREE.Quaternion();
function updateCamera(dt) {
  const p = st.pos; const fwd = _t.set(0, 0, -1).applyQuaternion(st.q);
  const hdgYaw = Math.atan2(-fwd.x, -fwd.z);
  let view = { cockpit: false, distGain: 1, doppler: 1 };
  camera.fov = 60; camera.near = 0.3;
  if (camMode === 0) {
    // ヘディングに追従（なめらかに）
    let d = hdgYaw - cam.smoothYaw; d = Math.atan2(Math.sin(d), Math.cos(d));
    cam.smoothYaw += d * (1 - Math.exp(-dt * 3));
    const R = spec.camDist * cam.dist;
    const yaw = cam.smoothYaw + cam.yawOff, pit = cam.pitchOff;
    _o.set(Math.sin(yaw) * Math.cos(pit), Math.sin(pit), Math.cos(yaw) * Math.cos(pit)).multiplyScalar(R);
    camera.position.copy(p).add(_o);
    const gy = Math.max(groundAt(camera.position.x, camera.position.z).y, -1) + 1.2;
    if (camera.position.y < gy) camera.position.y = gy;
    camera.up.set(0, 1, 0); camera.lookAt(p.x, p.y + spec.gearH * 0.4, p.z);
  } else if (camMode === 1) {
    const cp = new THREE.Vector3(...spec.cockpit).applyQuaternion(st.q).add(p);
    camera.position.copy(cp);
    _q.setFromEuler(new THREE.Euler(cam.lookPitch, cam.lookYaw, 0, 'YXZ'));
    camera.quaternion.copy(st.q).multiply(_q);
    camera.near = 0.1; camera.fov = 65;
    view.cockpit = true;
  } else if (camMode === 2) {
    camera.position.copy(world.towerCamPos);
    camera.up.set(0, 1, 0); camera.lookAt(p);
    const dist = camera.position.distanceTo(p);
    camera.fov = clamp(2 * Math.atan((spec.id === 'airliner' ? 60 : 25) / dist) / D2R, 2, 60);
    view.distGain = clamp(60 / dist, 0.05, 1);
  } else {
    if (!cam.flyby || cam.flyby.distanceTo(p) > 1200 || (cam.flyby.clone().sub(p).dot(st.vel) < 0 && cam.flyby.distanceTo(p) > 400)) {
      const v = st.vel.lengthSq() > 4 ? st.vel.clone().normalize() : fwd.clone();
      const right = new THREE.Vector3().crossVectors(v, new THREE.Vector3(0, 1, 0)).normalize();
      cam.flyby = p.clone().addScaledVector(v, Math.max(200, st.vel.length() * 7)).addScaledVector(right, 25 + spec.camDist).add(new THREE.Vector3(0, 6, 0));
      cam.flyby.y = Math.max(cam.flyby.y, groundAt(cam.flyby.x, cam.flyby.z).y + 2);
    }
    camera.position.copy(cam.flyby); camera.up.set(0, 1, 0); camera.lookAt(p);
    const dist = camera.position.distanceTo(p);
    camera.fov = clamp(2 * Math.atan(spec.camDist * 1.2 / dist) / D2R, 8, 60);
    view.distGain = clamp(80 / dist, 0.08, 1);
  }
  if (camMode >= 2) {
    const toCam = camera.position.clone().sub(p).normalize();
    const vr = st.vel.dot(toCam);
    view.doppler = clamp(340 / (340 - vr), 0.6, 1.6);
  }
  camera.updateProjectionMatrix();
  return view;
}

// ---------- 開始・終了 ----------
function windVector(name) {
  const v = new THREE.Vector3(); let turb = 0, gust = 0, txt = '0 kt';
  const fromDeg = (deg, spd) => { const to = (deg + 180) * D2R; v.set(Math.sin(to) * spd, 0, -Math.cos(to) * spd); txt = `${String(deg).padStart(3, '0')}° / ${Math.round(spd * 1.944)} kt`; };
  if (name === 'light') { fromDeg(350, 4); turb = 0.5; }
  if (name === 'cross') { fromDeg(270, 5.2); turb = 1; }
  if (name === 'gusty') { fromDeg(320, 7); turb = 3; gust = 4; }
  return { v, turb, gust, txt };
}

function startFlight() {
  spec = SPECS[cfg.aircraft]; st = newState(spec);
  const northbound = true;
  if (cfg.start === 'runway') placeOnRunway(st, spec, northbound);
  else if (cfg.start === 'final') placeOnApproach(st, spec, spec.appDist * 0.45, northbound);
  else if (cfg.start === 'long') placeOnApproach(st, spec, spec.appDist * 1.6, northbound);
  else placeInAir(st, spec, 2600, spec.id === 'cessna' ? 700 : 1200, 4500, 0, spec.id === 'cessna' ? 50 : spec.id === 'airliner' ? 120 : 170);
  st.autoTrim = $('optTrim').checked;
  st.spoilerArmed = spec.id === 'airliner' && cfg.start !== 'runway';
  const W = windVector(cfg.wind); env.wind.copy(W.v); env.turb = W.turb; env.gustAmp = W.gust; env.windTxt = W.txt;
  if (model) scene.remove(model.group);
  model = modelCache[spec.id] ||= buildModel(spec.id);
  model.group.visible = true; scene.add(model.group);
  if (!landingLight) { landingLight = new THREE.SpotLight(0xfff4e0, 0, 900, 0.32, 0.5, 1.6); scene.add(landingLight); scene.add(landingLight.target); }
  applyTime(cfg.time);
  particles.clear();
  cam.smoothYaw = Math.atan2(0, 1); cam.yawOff = 0; cam.pitchOff = (cfg.start === 'runway' ? 8 : 10) * D2R; cam.dist = 1; cam.lookYaw = 0; cam.lookPitch = 0;
  setCam(camMode);
  resultShown = false; crashTimer = 0; lastCallAlt = st.agl * 3.281; markers = {}; warnTimers = {}; smokeOn = false;
  Audio.stopMusic();
  if (spec.id === 'airliner') setTimeout(() => Audio.sfx('cabin'), 600);
  setMode('flight');
  const tips = {
    runway: `${spec.name}: パーキングブレーキ解除（X）→ スロットル全開（R / 9 / 0）→ ${Math.round(spec.vR * 1.944)} kt で機首上げ（S / ↓）`,
    final: `最終進入中。PAPI（左側の4灯）が 白2・赤2 になるように降下し、滑走路に接地してください`,
    long: `滑走路 36 へ進入中。ILS（左下の菱形）とPAPIを頼りに降下してください`,
    air: `上空からスタート。自由に飛び回り、空港（ミニマップの白い線）に戻って着陸してみましょう`,
  };
  hud.message(tips[cfg.start], WHITE, 7);
  if (cfg.start !== 'runway') hud.message(`推奨進入速度 ${Math.round(spec.vApp * 1.944)} kt / 脚とフラップは着陸形態です`, CYAN, 7);
}
function restart() { startFlight(); }

function setMode(m) {
  mode = m;
  $('menu').classList.toggle('show', m === 'menu');
  $('pause').classList.toggle('show', m === 'paused');
  $('result').classList.toggle('show', m === 'result');
  $('crash').classList.toggle('show', m === 'crash');
  $('camlabel').style.display = m === 'flight' ? '' : 'none';
  touch.show(touchOn && m === 'flight');
  if (m !== 'paused') rotatePaused = false;
  setTimeout(checkOrientation, 0);
  if (m === 'menu') { Audio.silence(); if (Audio.ready) Audio.playTitle(); if (model) scene.remove(model.group); st = null; menuDemo(); }
  if (m === 'paused' || m === 'result' || m === 'crash') Audio.silence();
}
document.querySelectorAll('[data-act]').forEach((b) => b.addEventListener('click', () => {
  Audio.sfx('select');
  const a = b.dataset.act;
  if (a === 'resume') setMode('flight');
  if (a === 'restart') restart();
  if (a === 'menu') setMode('menu');
  if (a === 'continue') { resultShown = true; setMode('flight'); }
}));

// ---------- メニュー ----------
function buildMenu() {
  const cards = $('cards');
  for (const id of ['cessna', 'airliner', 'fighter']) {
    const s = SPECS[id]; const el = document.createElement('div'); el.className = 'card'; el.dataset.v = id;
    el.innerHTML = `<b>${s.name}</b><small>${s.model}</small><p>${s.desc}</p><small style="margin-top:6px">進入速度 ${Math.round(s.vApp * 1.944)} kt ・ 重量 ${(s.mass / 1000).toFixed(1)} t</small>`;
    el.addEventListener('click', () => { cfg.aircraft = id; syncMenu(); Audio.sfx('select'); menuDemo(); });
    cards.appendChild(el);
  }
  document.querySelectorAll('.seg').forEach((seg) => seg.querySelectorAll('button').forEach((b) => b.addEventListener('click', () => {
    cfg[seg.dataset.key] = b.dataset.v; syncMenu(); Audio.sfx('select');
    if (seg.dataset.key === 'time') applyTime(cfg.time);
  })));
  const keysHtml = [
    ['W S / ↑ ↓', 'ピッチ（S・↓で機首上げ）'], ['A D / ← →', 'ロール'], ['Q E', 'ラダー・前輪操向'], ['R F / 1〜0', 'スロットル（旅客機は地上でF長押しで逆噴射）'],
    ['G', '脚の上げ下げ'], ['V / B', 'フラップ 下げ / 上げ'], ['Space', 'ブレーキ'], ['X', 'パーキングブレーキ'],
    ['K', 'スポイラー（アーム/展開）'], ['[ ]', 'トリム（T: オートトリム）'], ['C', '視点切替'], ['Z', 'スモーク'],
    ['L', '着陸灯'], ['M', 'ミュート'], ['Esc / P', '一時停止'], ['N', 'やり直し'], ['H', '操作ヘルプ'], ['パッド', '左スティック/トリガー/ABXY'],
  ].map(([k, v]) => `<kbd>${k}</kbd><span>${v}</span>`).join('');
  $('keys1').innerHTML = keysHtml; $('keys2').innerHTML = keysHtml;
  $('optTouch').checked = isTouchDevice; applyTouchSetting();
  $('optTouch').addEventListener('change', applyTouchSetting);
  $('go').addEventListener('click', async () => {
    if (isTouchDevice && touchOn) goFullscreenLandscape();
    await ensureAudio(); Audio.sfx('select'); startFlight();
  });
  syncMenu();
}
function syncMenu() {
  document.querySelectorAll('.card').forEach((c) => c.classList.toggle('sel', c.dataset.v === cfg.aircraft));
  document.querySelectorAll('.seg').forEach((seg) => seg.querySelectorAll('button').forEach((b) => b.classList.toggle('sel', cfg[seg.dataset.key] === b.dataset.v)));
}
let demo = null;
function menuDemo() {
  if (demo) scene.remove(demo.group);
  demo = modelCache[cfg.aircraft] ||= buildModel(cfg.aircraft);
  demo.group.visible = true; scene.add(demo.group);
}
function updateMenu(t) {
  if (!demo) return;
  const s = SPECS[cfg.aircraft];
  const R = 2400, w = (s.id === 'cessna' ? 45 : s.id === 'airliner' ? 110 : 160) / R * 0.6;
  const a = t * w; const c = new THREE.Vector3(2600, s.id === 'cessna' ? 350 : 480, -900);
  const p = new THREE.Vector3(c.x + Math.cos(a) * R, c.y + Math.sin(t * 0.3) * 20, c.z + Math.sin(a) * R);
  const tang = new THREE.Vector3(-Math.sin(a), 0, Math.cos(a));
  const yaw = Math.atan2(-tang.x, -tang.z);
  demo.group.position.copy(p); demo.group.quaternion.setFromEuler(new THREE.Euler(0.04, yaw, -0.32, 'YXZ'));
  const fake = { ctrl: { elev: 0.1, ail: 0, rudder: 0 }, flapPos: 0, spoiler: 0, engineN: 0.8, engineOn: true, gearPos: s.retractGear ? 0 : 1, ab: false };
  animateModel(demo, fake, s, 1 / 60, t);
  const side = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
  camera.position.copy(p).addScaledVector(side, s.camDist * 1.6).addScaledVector(tang, -s.camDist * 1.1).add(new THREE.Vector3(0, s.camDist * 0.25, 0));
  camera.fov = 50; camera.near = 0.3; camera.updateProjectionMatrix();
  camera.up.set(0, 1, 0); camera.lookAt(p.clone().addScaledVector(tang, s.camDist * 0.5).add(new THREE.Vector3(0, -s.camDist * 0.6, 0)));
  sun.target.position.copy(p); sun.position.copy(p).addScaledVector(sunDir, 3000);
  sun.shadow.camera.left = sun.shadow.camera.bottom = -80; sun.shadow.camera.right = sun.shadow.camera.top = 80; sun.shadow.camera.near = 100; sun.shadow.camera.far = 6000; sun.shadow.camera.updateProjectionMatrix();
}

// ---------- ゲーム進行 ----------
function ilsInfo() {
  const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(st.q);
  const north = fwd.z < -0.5, south = fwd.z > 0.5;
  if (!north && !south) return null;
  const s = north ? 1 : -1;               // 1: RWY36（南から北へ着陸）
  const thr = s * RWY.length / 2;
  const along = (st.pos.z - thr) * s;      // 進入側が正
  if (along < -2500 || along > 25000) return null;
  const locAnt = -s * (RWY.length / 2 + 300);
  const loc = Math.atan2(st.pos.x, (st.pos.z - locAnt) * s) / D2R;
  const gsAnt = thr - s * 300;
  const gsDist = (st.pos.z - gsAnt) * s;
  if (gsDist < 50) return { rwy: north ? '36' : '18', loc: -loc / 1.25, gs: 0, dme: Math.max(0, along) / 1852, along };
  const gs = Math.atan2(st.pos.y, gsDist) / D2R - 3;
  return { rwy: north ? '36' : '18', loc: -loc / 1.25, gs: -gs / 0.35, dme: Math.max(0, along) / 1852, along };
}

function warnings(ils) {
  const e = new THREE.Euler().setFromQuaternion(st.q, 'YXZ');
  const info = {};
  const ias = st.ias * 1.944;
  info.overspeed = ias > (spec.id === 'cessna' ? 165 : spec.id === 'airliner' ? 350 : 800);
  info.bankWarn = spec.id !== 'fighter' && Math.abs(e.z) > 40 * D2R && !st.onGround;
  const landingCfg = st.gearPos >= 1 && st.flapIdx >= spec.landingFlaps - (spec.id === 'airliner' ? 1 : 0);
  const nearRunway = ils && ils.along < 9000 && Math.abs(st.pos.x) < 600;
  const tti = st.vel.y < -3 ? st.agl / -st.vel.y : 99;
  const ahead = st.pos.clone().addScaledVector(st.vel, 7);
  const terrAhead = terrainHeight(ahead.x, ahead.z) > ahead.y - 20 && st.vel.length() > 20;
  info.pullUp = !st.onGround && st.agl > 3 && ((tti < 7 && st.agl < 450 && !(landingCfg && nearRunway)) || (terrAhead && !(landingCfg && nearRunway)));
  info.gearWarn = spec.retractGear && st.gearPos < 1 && !st.onGround && st.agl < 230 && st.throttle < 0.35;
  return info;
}

function soundWarnings(info, dt) {
  const T = warnTimers; const tick = (k, period, fn) => { T[k] = (T[k] || 0) - dt; if (T[k] <= 0) { fn(); T[k] = period; } };
  if (st.stallWarn) {
    if (spec.id === 'cessna') tick('stall', 0.32, () => Audio.note('horn', 1650, { dur: 0.3, vel: 0.7 }));
    else { tick('shaker', 0.06, () => Audio.note('shaker', 90, { dur: 0.05, vel: 0.8 })); tick('stallv', 2.2, () => Audio.say('stall, stall')); }
  }
  if (info.pullUp) tick('pull', 1.6, () => { Audio.sfx('pullup'); if (spec.id !== 'cessna') Audio.say('pull up'); });
  if (info.gearWarn) tick('gear', 1.0, () => Audio.note('horn', 900, { dur: 0.5, vel: 0.6 }));
  if (info.overspeed) tick('ovs', 0.5, () => Audio.note('beep', 1800, { dur: 0.25, vel: 0.5 }));
  if (info.bankWarn && spec.id === 'airliner') tick('bank', 2.5, () => Audio.say('bank angle'));
}

function callout(ils) {
  if (!$('optCall').checked || spec.id === 'cessna' || st.onGround) { lastCallAlt = st.agl * 3.281; return; }
  const ft = st.agl * 3.281;
  if (st.gearPos >= 1 && st.vel.y < 0) {
    for (const c of [1000, 500, 100, 50, 40, 30, 20, 10]) if (lastCallAlt > c && ft <= c) {
      Audio.say(c === 1000 ? 'one thousand' : c === 500 ? 'five hundred' : c === 100 ? 'one hundred' : String(c));
      if (c === 20 && st.throttle > 0.1 && spec.id === 'airliner') setTimeout(() => Audio.say('retard, retard'), 500);
    }
  }
  lastCallAlt = ft;
  // マーカービーコン
  if (ils && ft < 3500) for (const [k, d] of [['outer', 7200], ['middle', 1050], ['inner', 300]]) if (!markers[k] && ils.along < d && ils.along > d - 400) { markers[k] = true; Audio.sfx(k); hud.message(k === 'outer' ? 'アウターマーカー' : k === 'middle' ? 'ミドルマーカー' : 'インナーマーカー', CYAN, 1.8); }
}

function handleEvents() {
  for (const ev of st.events) {
    if (ev.type === 'liftoff') { Audio.sfx('liftoff'); hud.message(spec.retractGear ? '離陸！ 上昇を確認したら脚を上げましょう（G）' : '離陸！', GREEN, 4); }
    if (ev.type === 'touchdown') {
      const fpm = Math.round(ev.vs * 196.85);
      Audio.sfx(ev.hard ? 'hardlanding' : 'touchdown', clamp(-ev.vs / 3, 0.4, 1));
      hud.message(`接地 ${fpm} fpm${ev.runway ? '' : '（滑走路外）'}`, fpm > -240 ? GREEN : fpm > -500 ? AMBER : RED, 4);
      const back = new THREE.Vector3(0, 0, 1).applyQuaternion(st.q);
      for (let i = 0; i < 10; i++) for (const s of [-1, 1]) {
        const p = st.pos.clone().addScaledVector(back, spec.id === 'airliner' ? 1.6 : 0.5).add(new THREE.Vector3(s * (spec.id === 'airliner' ? 3.8 : 1.2), -spec.gearH + 0.3, 0));
        particles.spawn({ pos: p, vel: st.vel.clone().multiplyScalar(0.25).add(new THREE.Vector3((Math.random() - 0.5) * 3, Math.random() * 2, (Math.random() - 0.5) * 3)), size: 1.5, grow: 4, life: 2.5, opacity: 0.6, color: 0xe8e8e8, drag: 1.5 });
      }
      st.landing = { ...ev, start: st.time };
    }
    if (ev.type === 'tailstrike') hud.message('テールストライク！ 機首を上げすぎています', RED, 3);
    if (ev.type === 'ab') Audio.sfx('ab');
    if (ev.type === 'crash') {
      Audio.sfx('crash'); particles.explosion(st.pos.clone()); model.group.visible = false; crashTimer = 2.8;
      $('crashReason').textContent = ev.reason;
    }
  }
  st.events.length = 0;
}

function checkLandingResult() {
  if (resultShown || !st.landing || !st.onGround) return;
  const gs = Math.hypot(st.vel.x, st.vel.z);
  if (gs > 2.5 && st.time - st.landing.start < 90) return;
  resultShown = true;
  const L = st.landing; const fpm = Math.round(L.vs * 196.85);
  // 接地位置（着陸方向の滑走路端から）
  const northbound = L.z > 0 ? (st.pos.z < L.z) : !(st.pos.z > L.z);
  const thr = northbound ? RWY.length / 2 : -RWY.length / 2;
  const tdDist = Math.round((thr - L.z) * (northbound ? 1 : -1));
  const cl = Math.abs(L.x).toFixed(1);
  let score = 100;
  score -= clamp((-fpm - 100) / 6, 0, 45);
  score -= L.runway ? 0 : 40;
  score -= clamp((Math.abs(L.x) - 2) * 2.5, 0, 20);
  score -= tdDist < 150 || tdDist > 900 ? 15 : tdDist < 250 || tdDist > 650 ? 6 : 0;
  score -= clamp((Math.abs(L.roll) / D2R - 2) * 2, 0, 10);
  score = Math.round(clamp(score, 0, 100));
  const grade = score >= 92 ? 'S' : score >= 80 ? 'A' : score >= 65 ? 'B' : score >= 45 ? 'C' : 'D';
  const comment = fpm > -120 ? 'バターのようなソフトランディング！' : fpm > -240 ? 'きれいな接地です' : fpm > -400 ? 'やや硬めの接地' : fpm > -600 ? 'ハードランディング' : '非常に激しい接地 — 機体点検が必要';
  $('resTitle').textContent = L.runway ? '着陸成功' : '着陸（滑走路外）';
  $('resGrade').textContent = grade;
  const rows = [['スコア', `${score} / 100`], ['接地率', `${fpm} fpm（${comment}）`], ['接地位置', `滑走路端から ${tdDist} m（目標 300〜600 m）`], ['センターライン偏差', `${cl} m`],
    ['接地速度', `${Math.round(L.ias * 1.944)} kt`], ['接地時バンク角', `${(Math.abs(L.roll) / D2R).toFixed(1)}°`]];
  $('resRows').innerHTML = rows.map(([a, b]) => `<div class="row"><span>${a}</span><span>${b}</span></div>`).join('');
  if (score >= 65) Audio.sfx('success');
  if (spec.id === 'airliner') setTimeout(() => Audio.sfx('cabin'), 900);
  setTimeout(() => { if (mode === 'flight') setMode('result'); }, 600);
}

function updateModel(t, dt) {
  model.group.position.copy(st.pos); model.group.quaternion.copy(st.q);
  animateModel(model, st, spec, dt, t);
  // 着陸灯
  const on = lightsOn && nightLevel > 0.3;
  landingLight.intensity = on ? 60000 : 0;
  const lp = new THREE.Vector3(...model.parts.landingLight).applyQuaternion(st.q).add(st.pos);
  landingLight.position.copy(lp);
  landingLight.target.position.copy(lp).add(new THREE.Vector3(0, -0.12, -1).applyQuaternion(st.q).multiplyScalar(100));
  // 影
  const R = spec.id === 'airliner' ? 70 : 35;
  sun.target.position.copy(st.pos); sun.position.copy(st.pos).addScaledVector(sunDir, 3000);
  const sc = sun.shadow.camera; if (sc.right !== R) { sc.left = sc.bottom = -R; sc.right = sc.top = R; sc.near = 100; sc.far = 6000; sc.updateProjectionMatrix(); }
  // スモーク・排気
  if (smokeOn && !st.crashed) {
    const tail = new THREE.Vector3(0, 0, spec.id === 'airliner' ? 20 : spec.id === 'fighter' ? 7.5 : 5).applyQuaternion(st.q).add(st.pos);
    particles.spawn({ pos: tail, vel: st.vel.clone().multiplyScalar(0.05), size: spec.id === 'airliner' ? 4 : 2, grow: 3.5, life: 9, opacity: 0.75, color: 0xffffff, drag: 0.3 });
  }
  if (spec.id === 'fighter' && st.ab && Math.random() < 0.3) {
    const tail = new THREE.Vector3(0, 0, 9).applyQuaternion(st.q).add(st.pos);
    particles.spawn({ pos: tail, vel: st.vel.clone().multiplyScalar(0.6), size: 1.2, grow: 1, life: 0.3, opacity: 0.6, color: 0xff9040, additive: true, drag: 3 });
  }
}

// ---------- メインループ ----------
const SUB = 1 / 240;
let acc = 0;
function frame() {
  requestAnimationFrame(frame);
  tick(Math.min(0.05, clock.getDelta()));
}
function tick(dt) {
  const t = clock.elapsedTime;
  if (mode === 'loading') return;
  if (window.__camOverride) { // デバッグ用の固定カメラ
    const o = window.__camOverride; camera.fov = o.fov || 60; camera.near = 0.5; camera.position.set(...o.p); camera.up.set(0, 1, 0); camera.lookAt(...o.t); camera.updateProjectionMatrix();
    world.update(dt, t, camera, renderer.domElement.height, env.wind); hud.draw(null); renderer.render(scene, camera); return;
  }
  if (mode === 'menu') { updateMenu(t); world.update(dt, t, camera, renderer.domElement.height, env.wind); hud.draw(null); renderer.render(scene, camera); return; }
  if (!st) return;
  if (mode === 'flight') {
    if (!st.crashed) {
      readInput(dt);
      // 突風
      if (env.gustAmp > 0) { const gtime = st.time; st.gust.set(Math.sin(gtime * 0.7) * Math.sin(gtime * 0.23), Math.sin(gtime * 1.3) * 0.3, Math.cos(gtime * 0.53) * Math.sin(gtime * 0.31)).multiplyScalar(env.gustAmp); }
      acc += dt;
      while (acc >= SUB) { step(st, spec, SUB, env); acc -= SUB; if (st.crashed) break; }
      handleEvents();
    } else if (crashTimer > 0) { crashTimer -= dt; if (crashTimer <= 0) setMode('crash'); }
    if (st.crashed) Audio.silence();
  }
  if (!st.crashed) updateModel(t, dt);
  particles.update(dt);
  const view = updateCamera(dt);
  world.update(dt, t, camera, renderer.domElement.height, env.wind);
  const ils = ilsInfo();
  const info = mode === 'flight' && !st.crashed ? warnings(ils) : {};
  if (mode === 'flight') touch.update(st, spec);
  if (mode === 'flight' && !st.crashed) { soundWarnings(info, dt); callout(ils); checkLandingResult(); Audio.update(st, spec, view); }
  info.ils = ils && ils.along > -200 ? ils : null; info.cockpit = view.cockpit; info.camera = camera; info.dt = dt; info.showMap = $('optMap').checked; info.wind = env.windTxt;
  if (window.__noRender) return;
  hud.draw(st.crashed ? null : st, spec, info);
  renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight; camera.updateProjectionMatrix(); hud.resize();
  hud.compact = touchOn || window.innerHeight < 500;
});

// ---------- 起動 ----------
async function boot() {
  buildMenu();
  const steps = []; const prog = (txt) => { steps.push(txt); $('loadtxt').textContent = txt; $('loadbar').style.width = `${Math.min(95, steps.length * 10)}%`; };
  await new Promise((r) => setTimeout(r, 50));
  // 構築は同期処理なので、各段階の間に描画の機会を与える
  const stages = ['buildTerrain', 'buildWater', 'buildAirport', 'buildCity', 'buildHighways', 'buildBridges', 'buildTowers', 'buildForests', 'buildClouds'];
  const labels = ['地形を生成中…', '水面を生成中…', '空港を建設中…', '市街地を建設中…', '高速道路を建設中…', '橋を架けています…', '塔を建設中…', '森を植えています…', '雲を浮かべています…'];
  for (let i = 0; i < stages.length; i++) { prog(labels[i]); await new Promise((r) => setTimeout(r, 16)); world[stages[i]](); }
  for (const lf of world.lightFields) world.root.add(lf.build());
  hud.buildMap();
  // 駐機中の機体
  const parked = new Map();
  const park = (id, x, z, yaw) => {
    const m = buildModel(id); m.group.position.set(x, SPECS[id].gearH, z); m.group.rotation.y = yaw; m.group.updateMatrixWorld(true);
    m.group.traverse((o) => {
      if (!o.isMesh || !o.visible) return;
      let g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
      g.applyMatrix4(o.matrixWorld);
      for (const a of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(a)) g.deleteAttribute(a);
      if (!g.attributes.uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
      const mat = o.material.vertexColors ? o.material.clone() : o.material; mat.vertexColors = false;
      const k = mat.uuid; if (!parked.has(k)) parked.set(k, { mat, geos: [] }); parked.get(k).geos.push(g);
    });
  };
  for (let i = 0; i < 6; i++) if (i !== 2) park('airliner', 528, -800 + i * 200, -Math.PI / 2);
  for (let i = 0; i < 4; i++) park('cessna', 395, 735 + i * 16 + (i > 1 ? 120 : 0), Math.PI / 2);
  park('fighter', 380, 905, Math.PI / 2); park('fighter', 380, 935, Math.PI / 2);
  for (const { mat, geos } of parked.values()) { const mm = new THREE.Mesh(mergeGeometries(geos), mat); mm.castShadow = true; mm.receiveShadow = true; scene.add(mm); }
  applyTime(cfg.time);
  prog('シェーダーを準備中…'); await new Promise((r) => setTimeout(r, 16));
  menuDemo(); updateMenu(0);
  renderer.compile(scene, camera);
  $('loadbar').style.width = '100%';
  $('loading').classList.remove('show');
  $('go').disabled = false; $('go').textContent = 'フライト開始';
  setMode('menu');
}
window.__sim = { touch, particles, get st() { return st; }, get spec() { return spec; }, world, tick, startFlight, cfg, setMode, keys, get mode() { return mode; }, camera, renderer, scene, setCam, applyTime, FM: window.FM };
boot().then(() => frame());
void lerp; void onRunway; void DOWNTOWN; void RED;
