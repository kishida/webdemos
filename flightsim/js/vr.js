// WebXR（VR）対応: カメラリグ、ヘッドセット前方の HUD パネル、コントローラー入力、視点のリセット
import * as THREE from 'three';

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const dz = (v, d = 0.15) => (Math.abs(v) < d ? 0 : (v - Math.sign(v) * d) / (1 - d));

// HUD パネル（キャンバスの解像度と、ヘッドセット前方での大きさ・位置 [m]）
const HUD_W = 1600, HUD_H = 1000;
const PANEL_W = 2.0, PANEL_DIST = 1.6, PANEL_Y = -0.12;

export class VR {
  constructor(renderer, scene, camera) {
    this.renderer = renderer; this.camera = camera;
    this.supported = false;
    this.session = null;
    renderer.xr.enabled = true;
    renderer.xr.setReferenceSpaceType('local');   // 着座: 開始時の頭の位置が原点
    // rig: 機体側が決める「目の位置と向き」 / origin: 視点リセット用の補正 / camera: ヘッドセット
    this.rig = new THREE.Group(); this.rig.name = 'vrRig';
    this.origin = new THREE.Group(); this.rig.add(this.origin);
    scene.add(this.rig); this.origin.add(camera);
    // HUD パネル
    this.hudCanvas = document.createElement('canvas');
    this.hudCanvas.width = HUD_W; this.hudCanvas.height = HUD_H;
    this.hudTex = new THREE.CanvasTexture(this.hudCanvas);
    this.hudTex.colorSpace = THREE.SRGBColorSpace;
    this.hudTex.minFilter = THREE.LinearFilter; this.hudTex.generateMipmaps = false;
    const mat = new THREE.MeshBasicMaterial({ map: this.hudTex, transparent: true, depthTest: false, depthWrite: false, toneMapped: false, fog: false });
    this.panel = new THREE.Mesh(new THREE.PlaneGeometry(PANEL_W, PANEL_W * HUD_H / HUD_W), mat);
    this.panel.position.set(0, PANEL_Y, -PANEL_DIST);
    this.panel.renderOrder = 999; this.panel.frustumCulled = false; this.panel.visible = false;
    // HUD はリグとは別の入れ物に置き、常に水平にする（機内視点で機体と一緒に傾かないように）
    this.hudAnchor = new THREE.Group(); this.hudAnchor.add(this.panel); scene.add(this.hudAnchor);
    // 視点リセットの補正（origin に入れるのは描画の直前だけ）
    this.offPos = new THREE.Vector3(); this.offQuat = new THREE.Quaternion();
    // 入力
    this.prev = {};           // ボタンの前回状態（エッジ検出）
    this.recenterReq = false;
    this.onStart = null; this.onEnd = null;
  }

  get hudSize() { return [HUD_W, HUD_H]; }
  get presenting() { return this.renderer.xr.isPresenting; }

  async check() {
    try { this.supported = !!(navigator.xr && await navigator.xr.isSessionSupported('immersive-vr')); } catch { this.supported = false; }
    return this.supported;
  }

  async enter() {
    if (this.session) return;
    const session = await navigator.xr.requestSession('immersive-vr', { optionalFeatures: ['local-floor'] });
    session.addEventListener('end', () => {
      this.session = null; this.panel.visible = false;
      this.offPos.set(0, 0, 0); this.offQuat.identity(); this.reset();
      if (this.onEnd) this.onEnd();
    });
    await this.renderer.xr.setSession(session);
    this.session = session; this.panel.visible = true; this.prev = {};
    this.recenterReq = true;  // 開始直後の頭の位置を操縦席に合わせる
    if (this.onStart) this.onStart();
  }

  exit() { if (this.session) this.session.end(); }

  // updateCamera() の前に呼ぶ: リグと補正を原点に戻して、通常のカメラ計算（lookAt など）をワールド座標で行えるようにする
  beginFrame() {
    if (this.recenterReq) this.doRecenter();
    this.reset();
  }
  reset() {
    this.rig.position.set(0, 0, 0); this.rig.quaternion.identity();
    this.origin.position.set(0, 0, 0); this.origin.quaternion.identity();
    this.rig.updateMatrixWorld(true);
  }

  // 通常のカメラ計算の結果（camera の位置・向き）をリグに移す
  // full: 機体の姿勢ごと（コックピット）/ それ以外は水平の向きだけ（酔い防止）。yaw を渡すとその向きに固定
  place(full, yaw) {
    const cam = this.camera;
    this.rig.position.copy(cam.position);
    if (full) this.rig.quaternion.copy(cam.quaternion);
    else {
      const y = yaw ?? new THREE.Euler().setFromQuaternion(cam.quaternion, 'YXZ').y;
      this.rig.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), y);
    }
    this.origin.position.copy(this.offPos); this.origin.quaternion.copy(this.offQuat);
    this.rig.updateMatrixWorld(true);
    // HUD: 目の位置から機首の前方に置く。ピッチは機体に合わせ、ロール（左右の傾き）だけ外して常に水平にする
    const e = new THREE.Euler().setFromQuaternion(this.rig.quaternion, 'YXZ');
    this.hudAnchor.position.copy(this.rig.position);
    this.hudAnchor.quaternion.setFromEuler(new THREE.Euler(e.x, e.y, 0, 'YXZ'));
    this.hudAnchor.updateMatrixWorld(true);
  }

  // 今の頭の位置・水平の向きを、リグの原点（目の位置）に合わせる
  recenter() { this.recenterReq = true; }
  doRecenter() {
    const frame = this.renderer.xr.getFrame(), ref = this.renderer.xr.getReferenceSpace();
    if (!frame || !ref) return;
    const pose = frame.getViewerPose(ref); if (!pose) return;
    this.recenterReq = false;
    const p = pose.transform.position, o = pose.transform.orientation;
    const yaw = new THREE.Euler().setFromQuaternion(new THREE.Quaternion(o.x, o.y, o.z, o.w), 'YXZ').y;
    const m = new THREE.Matrix4().makeRotationY(yaw).setPosition(p.x, p.y, p.z).invert();
    m.decompose(this.offPos, this.offQuat, new THREE.Vector3());
  }

  // コントローラー入力。presses: 押された瞬間のボタン名（'R.a' など）
  poll() {
    const out = { pitch: 0, roll: 0, rudder: 0, thr: 0, brake: 0, presses: [], stick: false };
    if (!this.session) return out;
    const now = {};
    for (const src of this.session.inputSources) {
      const gp = src.gamepad; if (!gp) continue;
      const h = src.handedness === 'left' ? 'L' : 'R';
      const ax = gp.axes.length >= 4 ? [gp.axes[2], gp.axes[3]] : [gp.axes[0] || 0, gp.axes[1] || 0];
      const b = (i) => !!gp.buttons[i]?.pressed;
      if (h === 'R') {
        out.roll = dz(ax[0]); out.pitch = dz(ax[1]);    // 手前に倒すと機首上げ
        out.stick = out.roll !== 0 || out.pitch !== 0;
      } else {
        out.rudder = dz(ax[0], 0.25); out.thr = -dz(ax[1], 0.2);  // 奥に倒すとスロットル増
      }
      out.brake = Math.max(out.brake, gp.buttons[0]?.value || 0);
      const names = { 0: 'trigger', 1: 'squeeze', 3: 'stick', 4: h === 'R' ? 'a' : 'x', 5: h === 'R' ? 'b' : 'y' };
      for (const [i, n] of Object.entries(names)) {
        const k = `${h}.${n}`; now[k] = b(+i);
        if (now[k] && !this.prev[k]) out.presses.push(k);
      }
    }
    this.prev = now;
    out.brake = out.brake > 0.3 ? clamp(out.brake, 0, 1) : 0;
    return out;
  }

  // HUD の描画（draw(canvas) でキャンバスに描いてから GPU に転送）
  updateHud(draw) {
    draw(this.hudCanvas);
    this.hudTex.needsUpdate = true;
  }
}
