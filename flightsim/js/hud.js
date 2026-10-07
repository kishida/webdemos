// HUD: 速度/高度テープ、方位、姿勢指示器、ILS、機体状態、警告、ミニマップ、コックピット時の HUD
import * as THREE from 'three';
import { RWY, riverX, coastZ, HIGHWAYS, cellType, GRID, SKYTREE, LATTICE_TOWER } from './layout.js';

const D = 180 / Math.PI;
const GREEN = '#8dffa0', AMBER = '#ffbf3c', RED = '#ff4a3c', WHITE = '#f2f5f8', CYAN = '#6fe3ff', MAG = '#ff6cf0';

export class HUD {
  constructor(canvas) {
    this.c = canvas; this.g = canvas.getContext('2d');
    this.msgs = []; this.map = null;
    this.resize();
  }
  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.dpr = dpr; this.w = window.innerWidth; this.h = window.innerHeight;
    this.c.width = this.w * dpr; this.c.height = this.h * dpr;
    this.c.style.width = this.w + 'px'; this.c.style.height = this.h + 'px';
  }
  message(text, color = WHITE, dur = 3) { this.msgs.push({ text, color, t: dur, dur }); if (this.msgs.length > 4) this.msgs.shift(); }

  buildMap() {
    // 静的なミニマップ（±12km）
    const S = 360, R = 12000; const c = document.createElement('canvas'); c.width = c.height = S; const g = c.getContext('2d');
    const P = (x, z) => [(x - 1500 + R) / (2 * R) * S, (z + R) / (2 * R) * S];
    g.fillStyle = '#4d6b45'; g.fillRect(0, 0, S, S);
    g.fillStyle = '#2b5a78'; g.beginPath(); g.moveTo(0, S);
    for (let x = 1500 - R; x <= 1500 + R; x += 200) g.lineTo(...P(x, coastZ(x)));
    g.lineTo(S, S); g.fill();
    // 街区
    const col = { downtown: '#c9c4bd', midrise: '#a9a49c', residential: '#8c8a78', industrial: '#8a8f96', port: '#8a8f96', park: '#4f7a45', road: '#77756f', plaza: '#b0aaa0' };
    for (let i = -52; i <= 62; i++) for (let j = -46; j <= 50; j++) { const t = cellType(i, j); if (!t) continue; g.fillStyle = col[t]; const [a, b] = P(i * GRID, j * GRID); g.fillRect(a, b, GRID / (2 * R) * S + 0.5, GRID / (2 * R) * S + 0.5); }
    g.strokeStyle = '#2b5a78'; g.lineWidth = 3; g.beginPath();
    for (let z = -R; z <= R; z += 100) { const [a, b] = P(riverX(z), z); z === -R ? g.moveTo(a, b) : g.lineTo(a, b); }
    g.stroke();
    g.strokeStyle = '#e8a040'; g.lineWidth = 2;
    for (const h of HIGHWAYS) { g.beginPath(); h.pts.forEach(([x, z], k) => { const [a, b] = P(x, z); k ? g.lineTo(a, b) : g.moveTo(a, b); }); if (h.loop) g.closePath(); g.stroke(); }
    g.fillStyle = '#9aa0a8'; { const [a, b] = P(150, -950); g.fillRect(a, b, 600 / (2 * R) * S, 1900 / (2 * R) * S); }
    g.strokeStyle = '#ffffff'; g.lineWidth = 3; g.beginPath(); g.moveTo(...P(0, -1500)); g.lineTo(...P(0, 1500)); g.stroke();
    g.fillStyle = '#ff5050'; for (const T of [SKYTREE, LATTICE_TOWER]) { const [a, b] = P(T.x, T.z); g.beginPath(); g.arc(a, b, 3, 0, 7); g.fill(); }
    this.map = { c, S, R, P };
  }

  draw(st, spec, info) {
    const g = this.g, w = this.w, h = this.h;
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    if (!st) return;
    g.font = '600 14px "Segoe UI", "Yu Gothic UI", sans-serif'; g.textBaseline = 'middle';
    const e = new THREE.Euler().setFromQuaternion(st.q, 'YXZ');
    const pitch = e.x, roll = e.z;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(st.q);
    const hdg = (Math.atan2(fwd.x, -fwd.z) * D + 360) % 360;
    const ias = st.ias * 1.944, alt = st.pos.y * 3.281, vs = st.vel.y * 196.85;
    const scale = Math.min(1, w / 1300);

    if (info.cockpit) this.drawConformal(st, info, hdg);

    // 速度テープ・高度テープ
    const cx = w / 2, cy = h / 2;
    const tapeH = Math.min(360, h * 0.45);
    this.tape(g, cx - Math.min(360, w * 0.3), cy, tapeH, ias, 10, 20, 'kt', true, spec);
    this.tape(g, cx + Math.min(360, w * 0.3), cy, tapeH, alt, 100, 500, 'ft', false, null, vs);
    this.heading(g, cx, 34, hdg);
    // 姿勢指示器（PFD 風）
    const ar = 70 * Math.max(0.75, scale);
    this.attitude(g, 20 + ar + 10, h - ar - 30, ar, pitch, roll, st, info.ils);
    // 状態パネル
    this.status(g, w - 230, h - 200, st, spec, info);
    // ミニマップ
    if (info.showMap) this.minimap(g, w - 196, 70, 180, st, hdg);
    // 警告
    const warn = [];
    if (st.stallWarn) warn.push(['STALL', RED]);
    if (info.pullUp) warn.push(['PULL UP', RED]);
    if (info.overspeed) warn.push(['OVERSPEED', RED]);
    if (info.gearWarn) warn.push(['GEAR', AMBER]);
    if (info.bankWarn) warn.push(['BANK ANGLE', AMBER]);
    if (st.tailStrike) warn.push(['TAIL STRIKE', AMBER]);
    if (st.parkBrake) warn.push(['PARKING BRAKE', AMBER]);
    warn.forEach(([t, c], i) => {
      const y = 78 + i * 34; g.font = '700 20px "Segoe UI", sans-serif';
      const tw = g.measureText(t).width + 30; const blink = c === RED && (performance.now() % 600) < 300;
      g.fillStyle = blink ? c : 'rgba(0,0,0,0.6)'; g.fillRect(cx - tw / 2, y - 14, tw, 28);
      g.strokeStyle = c; g.lineWidth = 2; g.strokeRect(cx - tw / 2, y - 14, tw, 28);
      g.fillStyle = blink ? '#000' : c; g.textAlign = 'center'; g.fillText(t, cx, y + 1);
    });
    // メッセージ
    g.font = '600 20px "Segoe UI", "Yu Gothic UI", sans-serif'; g.textAlign = 'center';
    this.msgs = this.msgs.filter((m) => (m.t -= info.dt) > 0);
    this.msgs.forEach((m, i) => {
      const a = Math.min(1, m.t / 0.5, (m.dur - m.t) / 0.2 + 0.2);
      g.globalAlpha = a; const y = h * 0.68 + i * 32;
      const tw = g.measureText(m.text).width + 36;
      g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(cx - tw / 2, y - 15, tw, 30);
      g.fillStyle = m.color; g.fillText(m.text, cx, y + 1); g.globalAlpha = 1;
    });
    // 電波高度
    if (st.agl < 750 && !st.onGround) {
      g.font = '700 22px "Segoe UI", sans-serif'; g.textAlign = 'center'; g.fillStyle = st.agl < 60 ? AMBER : GREEN;
      g.fillText(`RA ${Math.max(0, Math.round(st.agl * 3.281))}`, cx, cy + tapeH / 2 + 24);
    }
    g.textAlign = 'left';
  }

  tape(g, x, y, H, val, minor, major, unit, left, spec, vs) {
    const W = 74, pxPer = H / (left ? 120 : 1200);
    g.save();
    g.fillStyle = 'rgba(10,16,24,0.45)'; g.fillRect(x - W / 2, y - H / 2, W, H);
    g.beginPath(); g.rect(x - W / 2, y - H / 2, W, H); g.clip();
    // 速度帯（失速域/最大速度）
    if (left && spec) {
      const vs0 = Math.sqrt((2 * spec.mass * 9.81) / (1.225 * spec.wingArea * (spec.CL0 + spec.CLa * spec.alphaStall + spec.flapCL[spec.landingFlaps]))) * 1.944;
      const ytop = y - (vs0 - val) * pxPer;
      g.fillStyle = 'rgba(255,60,60,0.55)'; g.fillRect(x + W / 2 - 8, ytop, 8, H);
    }
    g.strokeStyle = WHITE; g.fillStyle = WHITE; g.lineWidth = 1.5; g.font = '600 13px "Segoe UI", sans-serif';
    g.textAlign = left ? 'right' : 'left';
    const range = H / 2 / pxPer;
    for (let v = Math.ceil((val - range) / minor) * minor; v <= val + range; v += minor) {
      if (left && v < 0) continue;
      const yy = y - (v - val) * pxPer; const isMaj = Math.round(v) % major === 0;
      g.beginPath();
      if (left) { g.moveTo(x + W / 2, yy); g.lineTo(x + W / 2 - (isMaj ? 12 : 6), yy); } else { g.moveTo(x - W / 2, yy); g.lineTo(x - W / 2 + (isMaj ? 12 : 6), yy); }
      g.stroke();
      if (isMaj) g.fillText(String(Math.round(v)), left ? x + W / 2 - 16 : x - W / 2 + 16, yy);
    }
    g.restore();
    // 現在値ボックス
    g.fillStyle = '#000'; g.strokeStyle = GREEN; g.lineWidth = 2;
    g.fillRect(x - W / 2 - 4, y - 16, W + 8, 32); g.strokeRect(x - W / 2 - 4, y - 16, W + 8, 32);
    g.fillStyle = GREEN; g.font = '700 19px "Segoe UI", sans-serif'; g.textAlign = 'center';
    g.fillText(String(Math.round(val)), x, y + 1);
    g.font = '600 12px "Segoe UI", sans-serif'; g.fillStyle = WHITE;
    g.fillText(unit, x, y - H / 2 - 12);
    if (vs != null) {
      const vy = y + H / 2 + 0; const vx = x + W / 2 + 18;
      g.fillStyle = 'rgba(10,16,24,0.45)'; g.fillRect(vx - 8, y - H / 2, 16, H);
      const k = Math.max(-1, Math.min(1, vs / 3000));
      g.strokeStyle = Math.abs(vs) > 2000 ? AMBER : GREEN; g.lineWidth = 4; g.beginPath(); g.moveTo(vx, y); g.lineTo(vx, y - k * H / 2); g.stroke();
      g.fillStyle = WHITE; g.font = '600 12px "Segoe UI", sans-serif'; g.textAlign = 'left';
      g.fillText(`${vs > 0 ? '+' : ''}${Math.round(vs / 10) * 10}`, vx - 18, vy + 14);
    }
  }

  heading(g, cx, y, hdg) {
    const W = 360, px = W / 60;
    g.save(); g.fillStyle = 'rgba(10,16,24,0.45)'; g.fillRect(cx - W / 2, y - 16, W, 34);
    g.beginPath(); g.rect(cx - W / 2, y - 16, W, 34); g.clip();
    g.strokeStyle = WHITE; g.fillStyle = WHITE; g.textAlign = 'center'; g.font = '600 13px "Segoe UI", sans-serif'; g.lineWidth = 1.5;
    for (let d = Math.floor(hdg - 32); d <= hdg + 32; d++) {
      if (d % 5) continue; const xx = cx + (d - hdg) * px; const dd = ((d % 360) + 360) % 360;
      g.beginPath(); g.moveTo(xx, y + 18); g.lineTo(xx, y + (dd % 10 ? 12 : 8)); g.stroke();
      if (dd % 10 === 0) g.fillText(dd === 0 ? 'N' : dd === 90 ? 'E' : dd === 180 ? 'S' : dd === 270 ? 'W' : String(dd / 10).padStart(2, '0'), xx, y - 3);
    }
    g.restore();
    g.fillStyle = GREEN; g.font = '700 15px "Segoe UI", sans-serif'; g.textAlign = 'center';
    g.fillStyle = '#000'; g.fillRect(cx - 24, y + 20, 48, 20); g.fillStyle = GREEN; g.fillText(String(Math.round(hdg) % 360).padStart(3, '0'), cx, y + 31);
  }

  attitude(g, x, y, r, pitch, roll, st, ils) {
    g.save(); g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.clip();
    g.translate(x, y); g.rotate(roll);
    const pp = r / (25 / D);
    g.fillStyle = '#2f7fd0'; g.fillRect(-r * 2, -r * 3 + pitch * pp, r * 4, r * 3);
    g.fillStyle = '#8a5a2b'; g.fillRect(-r * 2, pitch * pp, r * 4, r * 3);
    g.strokeStyle = WHITE; g.lineWidth = 2; g.beginPath(); g.moveTo(-r * 2, pitch * pp); g.lineTo(r * 2, pitch * pp); g.stroke();
    g.lineWidth = 1.2; g.fillStyle = WHITE; g.font = '600 10px sans-serif'; g.textAlign = 'right';
    for (let a = -30; a <= 30; a += 5) { if (!a) continue; const yy = pitch * pp - (a / D) * pp; const len = a % 10 ? 10 : 22; g.beginPath(); g.moveTo(-len, yy); g.lineTo(len, yy); g.stroke(); if (a % 10 === 0) g.fillText(String(Math.abs(a)), -len - 3, yy); }
    g.restore();
    g.save(); g.translate(x, y);
    g.strokeStyle = WHITE; g.lineWidth = 2; g.beginPath(); g.arc(0, 0, r, 0, Math.PI * 2); g.stroke();
    for (const a of [-60, -45, -30, -20, -10, 0, 10, 20, 30, 45, 60]) { const t = (a - 90) / D; const l = a % 30 === 0 ? 10 : 6; g.beginPath(); g.moveTo(Math.cos(t) * r, Math.sin(t) * r); g.lineTo(Math.cos(t) * (r - l), Math.sin(t) * (r - l)); g.stroke(); }
    g.rotate(roll); g.fillStyle = WHITE; g.beginPath(); g.moveTo(0, -r + 2); g.lineTo(-6, -r + 12); g.lineTo(6, -r + 12); g.fill();
    g.restore();
    g.save(); g.translate(x, y);
    g.strokeStyle = '#ffd040'; g.lineWidth = 4; g.beginPath(); g.moveTo(-r * 0.55, 0); g.lineTo(-r * 0.2, 0); g.lineTo(-r * 0.2, 8); g.moveTo(r * 0.55, 0); g.lineTo(r * 0.2, 0); g.lineTo(r * 0.2, 8); g.stroke();
    g.fillStyle = '#ffd040'; g.fillRect(-3, -3, 6, 6);
    // ILS
    if (ils) {
      const dl = Math.max(-2.5, Math.min(2.5, ils.loc)), dg = Math.max(-2.5, Math.min(2.5, ils.gs));
      g.fillStyle = WHITE; for (const k of [-2, -1, 1, 2]) { g.beginPath(); g.arc(k * r * 0.32, r + 14, 2.5, 0, 7); g.fill(); g.beginPath(); g.arc(r + 14, k * r * 0.32, 2.5, 0, 7); g.fill(); }
      g.fillStyle = MAG; const dia = (px, py) => { g.beginPath(); g.moveTo(px, py - 6); g.lineTo(px + 6, py); g.lineTo(px, py + 6); g.lineTo(px - 6, py); g.fill(); };
      dia(dl * r * 0.32, r + 14); dia(r + 14, -dg * r * 0.32);
      g.font = '700 12px sans-serif'; g.textAlign = 'left'; g.fillStyle = MAG;
      g.fillText(`ILS ${ils.rwy}  ${ils.dme.toFixed(1)} NM`, -r, -r - 12);
    }
    g.restore();
  }

  status(g, x, y, st, spec, info) {
    const rows = [];
    const thr = st.throttle;
    rows.push(['THR', st.reverse ? `REV ${Math.round(-thr * 100)}%` : `${Math.round(thr * 100)}%`, st.reverse ? AMBER : thr > 0.97 && spec.abThrust ? '#ff9a3c' : GREEN]);
    rows.push([spec.engine === 'prop' ? 'RPM' : 'N1', spec.engine === 'prop' ? String(Math.round(700 + st.engineN * 2000)) : `${(st.engineN * 100).toFixed(1)}%`, WHITE]);
    if (spec.abThrust) rows.push(['A/B', st.ab ? 'ON' : 'OFF', st.ab ? '#ff9a3c' : '#889']);
    const fl = spec.flaps[st.flapIdx]; const moving = Math.abs(st.flapPos - st.flapIdx) > 0.02;
    rows.push(['FLAPS', String(fl) + (moving ? ' …' : ''), moving ? AMBER : CYAN]);
    if (spec.retractGear) rows.push(['GEAR', st.gearPos >= 1 ? 'DOWN' : st.gearPos <= 0 ? 'UP' : 'TRANSIT', st.gearPos >= 1 ? GREEN : st.gearPos <= 0 ? WHITE : RED]);
    else rows.push(['GEAR', 'FIXED', GREEN]);
    if (spec.spoilerCD) rows.push([spec.id === 'airliner' ? 'SPLR' : 'S/BRK', st.spoilerCmd ? 'EXT' : st.spoilerArmed ? 'ARM' : 'RET', st.spoilerCmd ? AMBER : st.spoilerArmed ? CYAN : '#889']);
    rows.push(['BRAKE', st.parkBrake ? 'PARK' : st.brake > 0 ? 'ON' : 'OFF', st.parkBrake || st.brake > 0 ? AMBER : '#889']);
    rows.push(['AoA', `${(st.alpha * D).toFixed(1)}°`, st.stallWarn ? RED : WHITE]);
    rows.push(['G', st.gLoad.toFixed(1), Math.abs(st.gLoad) > (spec.id === 'fighter' ? 7 : 2.5) ? AMBER : WHITE]);
    rows.push(['GS', `${Math.round(Math.hypot(st.vel.x, st.vel.z) * 1.944)} kt`, WHITE]);
    if (!spec.fbw) rows.push(['TRIM', `${(st.trimAlpha * D).toFixed(1)}°${st.autoTrim ? ' A' : ''}`, CYAN]);
    if (info.wind) rows.push(['WIND', info.wind, WHITE]);
    const H = rows.length * 20 + 16;
    y = this.h - H - 16;
    g.fillStyle = 'rgba(10,16,24,0.55)'; g.fillRect(x, y, 214, H);
    g.font = '600 13px "Segoe UI", sans-serif';
    rows.forEach(([k, v, c], i) => {
      const yy = y + 18 + i * 20; g.textAlign = 'left'; g.fillStyle = '#9fb0c0'; g.fillText(k, x + 12, yy);
      g.textAlign = 'right'; g.fillStyle = c; g.fillText(v, x + 202, yy);
    });
    g.textAlign = 'left';
  }

  minimap(g, x, y, S, st, hdg) {
    if (!this.map) this.buildMap();
    const M = this.map; const k = M.S / (2 * M.R);
    const [px, pz] = M.P(st.pos.x, st.pos.z);
    g.save(); g.beginPath(); g.rect(x, y, S, S); g.clip();
    g.globalAlpha = 0.9;
    // 機体中心・4倍ズーム
    const zoom = 2.2;
    g.translate(x + S / 2, y + S / 2); g.scale(zoom, zoom); g.translate(-px, -pz);
    g.drawImage(M.c, 0, 0);
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.globalAlpha = 1;
    g.translate(x + S / 2, y + S / 2); g.rotate(hdg / D);
    g.fillStyle = '#ffe14a'; g.strokeStyle = '#000'; g.lineWidth = 1;
    g.beginPath(); g.moveTo(0, -8); g.lineTo(5, 6); g.lineTo(0, 3); g.lineTo(-5, 6); g.closePath(); g.fill(); g.stroke();
    g.restore();
    g.strokeStyle = 'rgba(255,255,255,0.6)'; g.lineWidth = 1.5; g.strokeRect(x, y, S, S);
    g.fillStyle = WHITE; g.font = '600 11px sans-serif'; g.textAlign = 'center'; g.fillText('N', x + S / 2, y + 10);
    void k;
  }

  // コックピット視点: 実景に重ねる HUD（地平線・ピッチラダー・飛行経路マーカー）
  drawConformal(st, info, hdg) {
    const g = this.g, cam = info.camera;
    const proj = (dir) => { const p = cam.position.clone().add(dir.clone().multiplyScalar(1000)).project(cam); if (p.z > 1) return null; return [(p.x + 1) / 2 * this.w, (1 - p.y) / 2 * this.h]; };
    g.save(); g.strokeStyle = GREEN; g.fillStyle = GREEN; g.lineWidth = 1.6; g.font = '600 12px sans-serif';
    g.shadowColor = 'rgba(0,0,0,0.7)'; g.shadowBlur = 3;
    const hr = (hdg) / D;
    const right = new THREE.Vector3(Math.cos(hr), 0, Math.sin(hr));
    for (let a = -30; a <= 30; a += 5) {
      const el = a / D;
      const fwd = new THREE.Vector3(Math.sin(hr) * Math.cos(el), Math.sin(el), -Math.cos(hr) * Math.cos(el));
      const c = proj(fwd); if (!c) continue;
      const r2 = proj(fwd.clone().add(right.clone().multiplyScalar(0.08)));
      if (!r2) continue;
      const dx = r2[0] - c[0], dy = r2[1] - c[1]; const L = Math.hypot(dx, dy) || 1; const ux = dx / L, uy = dy / L;
      const half = a === 0 ? 400 : 70, gap = a === 0 ? 0 : 30;
      g.setLineDash(a < 0 ? [8, 6] : []);
      g.beginPath(); g.moveTo(c[0] - ux * half, c[1] - uy * half); g.lineTo(c[0] - ux * gap, c[1] - uy * gap);
      g.moveTo(c[0] + ux * gap, c[1] + uy * gap); g.lineTo(c[0] + ux * half, c[1] + uy * half); g.stroke();
      if (a !== 0) { g.setLineDash([]); g.fillText(String(a), c[0] + ux * (half + 14), c[1] + uy * (half + 14)); }
    }
    g.setLineDash([]);
    // 飛行経路マーカー
    if (st.vel.lengthSq() > 4) {
      const p = proj(st.vel.clone().normalize());
      if (p) { g.beginPath(); g.arc(p[0], p[1], 8, 0, Math.PI * 2); g.moveTo(p[0] - 20, p[1]); g.lineTo(p[0] - 8, p[1]); g.moveTo(p[0] + 8, p[1]); g.lineTo(p[0] + 20, p[1]); g.moveTo(p[0], p[1] - 8); g.lineTo(p[0], p[1] - 16); g.stroke(); }
    }
    // ボアサイト
    const b = proj(new THREE.Vector3(0, 0, -1).applyQuaternion(st.q));
    if (b) { g.beginPath(); g.moveTo(b[0] - 14, b[1]); g.lineTo(b[0] - 5, b[1]); g.lineTo(b[0], b[1] + 5); g.lineTo(b[0] + 5, b[1]); g.lineTo(b[0] + 14, b[1]); g.stroke(); }
    // 3° のグライドパス参照線
    if (info.ils) {
      const el = -3 / D; const d = new THREE.Vector3(Math.sin(hr) * Math.cos(el), Math.sin(el), -Math.cos(hr) * Math.cos(el));
      const c = proj(d); if (c) { g.setLineDash([4, 6]); g.beginPath(); g.moveTo(c[0] - 50, c[1]); g.lineTo(c[0] + 50, c[1]); g.stroke(); g.setLineDash([]); }
    }
    g.restore();
  }
}
export { GREEN, AMBER, RED, WHITE, CYAN };
