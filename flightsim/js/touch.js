// スマホ/タブレット用のタッチ操作: 仮想スティック、スロットル、ラダー、各種ボタン、傾き操縦（任意）
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// 主な入力がタッチの端末（スマホ・タブレット）だけを対象にする。
// タッチ対応ノートPCなどマウスが主のPCは maxTouchPoints > 0 になるので、それでは判定しない。
export const isTouchDevice = (() => {
  try { return matchMedia('(pointer: coarse)').matches && matchMedia('(hover: none)').matches; } catch { return false; }
})();
export const isPortrait = () => matchMedia('(orientation: portrait)').matches;

export class TouchControls {
  // onKey: キーボードと同じ処理を呼ぶ（{code}）
  constructor(onKey) {
    this.onKey = onKey;
    this.stick = { x: 0, y: 0, active: false };
    this.rudder = 0; this.brake = false;
    this.throttleDrag = null;   // ドラッグ中のスロットル値
    this.tilt = { on: false, x: 0, y: 0, neutral: null, avail: false };
    this.visible = false;
    this.build();
  }

  build() {
    const root = this.root = document.createElement('div'); root.id = 'touch';
    root.innerHTML = `
      <div class="t-stick"><div class="t-knob"></div></div>
      <div class="t-rud"><button data-rud="-1">◀</button><span>ラダー</span><button data-rud="1">▶</button></div>
      <div class="t-btns">
        <button data-k="KeyG">脚</button><button data-hold="brake">ブレーキ</button>
        <button data-k="KeyV">フラップ<br>▼</button><button data-k="KeyB">フラップ<br>▲</button>
        <button data-k="KeyK">スポイラー</button><button data-k="KeyX">駐機<br>ブレーキ</button>
        <button data-k="KeyC">視点</button><button data-act="tilt" class="t-tilt">傾き<br>操縦</button>
      </div>
      <div class="t-thr"><div class="t-thr-fill"></div><div class="t-thr-thumb"></div><span class="t-thr-label">0%</span><span class="t-rev">REV</span></div>
      <button class="t-pause" data-k="Escape">❚❚</button>
      <button class="t-smoke" data-k="KeyZ">スモーク</button>`;
    document.body.appendChild(root);
    root.addEventListener('contextmenu', (e) => e.preventDefault());

    // 仮想スティック
    const stick = root.querySelector('.t-stick'), knob = root.querySelector('.t-knob');
    let sid = null;
    const moveStick = (e) => {
      const r = stick.getBoundingClientRect(), R = r.width / 2;
      let dx = (e.clientX - r.left - R) / R, dy = (e.clientY - r.top - R) / R;
      const l = Math.hypot(dx, dy); if (l > 1) { dx /= l; dy /= l; }
      this.stick.x = dx; this.stick.y = dy;
      knob.style.transform = `translate(${dx * R * 0.6}px, ${dy * R * 0.6}px)`;
    };
    stick.addEventListener('pointerdown', (e) => { sid = e.pointerId; stick.setPointerCapture(sid); this.stick.active = true; moveStick(e); e.stopPropagation(); });
    stick.addEventListener('pointermove', (e) => { if (e.pointerId === sid) moveStick(e); });
    const endStick = (e) => { if (e.pointerId !== sid) return; sid = null; this.stick.active = false; this.stick.x = this.stick.y = 0; knob.style.transform = ''; };
    stick.addEventListener('pointerup', endStick); stick.addEventListener('pointercancel', endStick);

    // スロットル
    const thr = this.thrEl = root.querySelector('.t-thr');
    let tid = null;
    const moveThr = (e) => {
      const r = thr.getBoundingClientRect();
      const f = clamp(1 - (e.clientY - r.top) / r.height, 0, 1);       // 0=下端 1=上端
      this.throttleDrag = this.revZone ? (f < 0.15 ? -(0.15 - f) / 0.15 : (f - 0.15) / 0.85) : f;
    };
    thr.addEventListener('pointerdown', (e) => { tid = e.pointerId; thr.setPointerCapture(tid); moveThr(e); e.stopPropagation(); });
    thr.addEventListener('pointermove', (e) => { if (e.pointerId === tid) moveThr(e); });
    const endThr = (e) => { if (e.pointerId === tid) { tid = null; this.throttleDrag = null; } };
    thr.addEventListener('pointerup', endThr); thr.addEventListener('pointercancel', endThr);

    // ボタン
    root.querySelectorAll('button').forEach((b) => {
      b.addEventListener('pointerdown', (e) => {
        e.stopPropagation(); e.preventDefault(); b.classList.add('on');
        if (b.dataset.k) this.onKey({ code: b.dataset.k });
        if (b.dataset.rud) this.rudder = +b.dataset.rud;
        if (b.dataset.hold === 'brake') this.brake = true;
        if (b.dataset.act === 'tilt') this.toggleTilt();
      });
      const up = () => {
        b.classList.remove('on');
        if (b.dataset.rud) this.rudder = 0;
        if (b.dataset.hold === 'brake') this.brake = false;
      };
      b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('pointerleave', up);
    });

    // 傾き操縦はセキュアコンテキスト（HTTPS / localhost）でのみ利用可能
    this.tilt.avail = window.isSecureContext && 'DeviceMotionEvent' in window;
    if (!this.tilt.avail) root.querySelector('.t-tilt').style.display = 'none';
    this.isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
    this.onMotion = (e) => this.motion(e);
  }

  async toggleTilt() {
    const t = this.tilt;
    if (t.on) { t.on = false; window.removeEventListener('devicemotion', this.onMotion); this.markTilt(); return 'off'; }
    try {
      if (typeof DeviceMotionEvent.requestPermission === 'function') {
        const p = await DeviceMotionEvent.requestPermission();
        if (p !== 'granted') return 'denied';
      }
    } catch { return 'denied'; }
    t.on = true; t.neutral = null; t.x = t.y = 0;
    window.addEventListener('devicemotion', this.onMotion);
    this.markTilt();
    return 'on';
  }
  markTilt() { this.root.querySelector('.t-tilt').classList.toggle('active', this.tilt.on); }
  recalibrate() { this.tilt.neutral = null; }

  // 重力ベクトルを画面座標に変換して、ハンドルのような左右の傾き（ロール）と前後の傾き（ピッチ）を求める
  motion(e) {
    const g = e.accelerationIncludingGravity; if (!g || g.x == null) return;
    let ax = g.x, ay = g.y, az = g.z;
    if (this.isIOS) { ax = -ax; ay = -ay; az = -az; }   // iOS は符号が逆
    const a = ((screen.orientation && screen.orientation.angle) ?? window.orientation ?? 0) * Math.PI / 180;
    const sx = ax * Math.cos(a) - ay * Math.sin(a), sy = ax * Math.sin(a) + ay * Math.cos(a);
    const gl = Math.hypot(sx, sy, az) || 9.8;
    const roll = Math.asin(clamp(-sx / gl, -1, 1));
    const pitch = Math.atan2(az, sy);
    const t = this.tilt;
    if (t.neutral == null) t.neutral = pitch;
    const D = Math.PI / 180;
    const dz = (v, d) => (Math.abs(v) < d ? 0 : v - Math.sign(v) * d);
    const tx = clamp(dz(roll, 3 * D) / (30 * D), -1, 1);
    const ty = clamp(-dz(pitch - t.neutral, 3 * D) / (22 * D), -1, 1);
    t.x += (tx - t.x) * 0.35; t.y += (ty - t.y) * 0.35;
  }

  // 操縦入力: スティック優先、触っていなければ傾き
  axes() {
    if (this.stick.active) return { roll: this.stick.x, pitch: this.stick.y, active: true };
    if (this.tilt.on) return { roll: this.tilt.x, pitch: this.tilt.y, active: true };
    return { roll: 0, pitch: 0, active: false };
  }

  show(v) { if (v !== this.visible) { this.visible = v; this.root.style.display = v ? 'block' : 'none'; } }

  // 毎フレーム: スロットル表示と、機体に応じたボタン表示
  update(st, spec) {
    if (!this.visible || !st) return;
    this.revZone = spec.id === 'airliner';
    const v = st.throttle;
    const f = this.revZone ? (v < 0 ? 0.15 + v * 0.15 : 0.15 + v * 0.85) : clamp(v, 0, 1);
    this.root.querySelector('.t-thr-fill').style.height = `${f * 100}%`;
    this.root.querySelector('.t-thr-thumb').style.bottom = `calc(${f * 100}% - 4px)`;
    this.root.querySelector('.t-thr-label').textContent = v < 0 ? `REV` : `${Math.round(v * 100)}%`;
    this.root.querySelector('.t-rev').style.display = this.revZone ? '' : 'none';
    this.root.querySelector('[data-k="KeyK"]').style.visibility = spec.spoilerCD ? '' : 'hidden';
    this.root.querySelector('[data-k="KeyG"]').style.visibility = spec.retractGear ? '' : 'hidden';
    this.root.querySelector('.t-smoke').style.display = spec.id === 'fighter' ? '' : 'none';
  }
}
