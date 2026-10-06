// ===== 戦闘シーン（左右分割の演出） =====
'use strict';

const Battle = (() => {
  const W = 960, H = 540;
  let cv, ctx, IMG, root;
  let S = null;        // 現在の戦闘状態
  let resolveFn = null;
  let last = 0;

  const GROUND_SLOTS = [[370, 505], [300, 445], [220, 510], [150, 450], [70, 505]];
  const AIR_SLOTS = [[360, 300], [280, 200], [200, 320], [130, 210], [60, 300]];
  const SCALE = { infantry: 0.45, tank: 0.58, artillery: 0.58, antiair: 0.58, fighter: 0.55, bomber: 0.66 };

  function setup(rootEl, canvas, images) {
    root = rootEl; cv = canvas; ctx = cv.getContext('2d'); IMG = images;
    root.addEventListener('pointerdown', () => { if (S && S.t > 0.3) finish(); });
  }

  const disp = (hp) => Math.ceil(hp / 10);
  const figCount = (hp) => Math.ceil(disp(hp) / 2);

  function makeSide(u, idx, terrainKey, hpBefore) {
    const air = !!UNITS[u.type].air;
    const slots = air ? AIR_SLOTS : GROUND_SLOTS;
    const n = figCount(hpBefore);
    const figs = [];
    for (let i = 0; i < n; i++) {
      const [sx, sy] = slots[i];
      figs.push({ x: idx === 0 ? sx : W - sx, y: sy, alive: true, alpha: 1, phase: Math.random() * 6, recoil: 0 });
    }
    return {
      idx, type: u.type, owner: u.owner, air, terrain: terrainKey,
      bg: air ? 'b_sky' : TERRAIN[terrainKey].bg,
      hp: hpBefore, hpShow: hpBefore, figs, shake: 0,
    };
  }

  function play(o) {
    return new Promise((resolve) => {
      resolveFn = resolve;
      S = {
        t: 0, events: [], projs: [], parts: [], flash: 0, shake: 0, lastBoom: -1, fade: 0, end: 99,
        sides: [makeSide(o.atk, 0, o.atkTerrain, o.atk.hp), makeSide(o.def, 1, o.defTerrain, o.def.hp)],
      };
      const [A, D] = S.sides;
      let t = 0.75;
      const T1 = volley(A, D, t);
      at(T1 + 0.1, () => applyDamage(D, o.defHpAfter));
      let end = T1 + 1.5;
      if (o.counter && o.defHpAfter > 0) {
        const T2 = volley(D, A, T1 + 1.0, o.defHpAfter);
        at(T2 + 0.1, () => applyDamage(A, o.atkHpAfter));
        end = T2 + 1.5;
      }
      S.end = end;
      root.classList.add('show');
      last = performance.now();
      requestAnimationFrame(loop);
    });
  }

  function finish() {
    if (!S) return;
    S = null;
    root.classList.remove('show');
    const r = resolveFn; resolveFn = null;
    if (r) r();
  }

  const at = (t, fn) => S.events.push({ t, fn });

  function muzzle(side, f) {
    const sc = SCALE[side.type], img = IMG['s_' + side.type];
    const w = img.width * sc, h = img.height * sc;
    const dir = side.idx === 0 ? 1 : -1;
    if (side.air) return [f.x + dir * w * 0.42, f.y + h * 0.05];
    if (side.type === 'infantry') return [f.x + dir * w * 0.45, f.y - h * 0.62];
    if (side.type === 'artillery') return [f.x + dir * w * 0.48, f.y - h * 0.85];
    if (side.type === 'antiair') return [f.x + dir * w * 0.45, f.y - h * 0.8];
    return [f.x + dir * w * 0.5, f.y - h * 0.62];
  }

  function targetPoint(side) {
    const alive = side.figs.filter((f) => f.alive);
    const f = alive.length ? alive[Math.floor(Math.random() * alive.length)] : side.figs[0] || { x: side.idx ? 720 : 240, y: 480 };
    const img = IMG['s_' + side.type], sc = SCALE[side.type];
    const h = img.height * sc;
    const yc = side.air ? f.y : f.y - h * 0.45;
    return [f.x + (Math.random() - 0.5) * img.width * sc * 0.5, yc + (Math.random() - 0.5) * h * 0.4];
  }

  // 発射側 from のフィギュア全員が射撃。着弾が終わる時刻を返す
  function volley(from, to, t0, fromHp) {
    const weapon = UNITS[from.type].weapon;
    const n = fromHp != null ? figCount(fromHp) : from.figs.filter((f) => f.alive).length;
    let tEnd = t0;
    const shooters = from.figs.slice(0, n);
    shooters.forEach((f, i) => {
      const ft = t0 + i * 0.16;
      const shot = (dt, opts) => {
        at(ft + dt, () => {
          if (!f.alive) return;
          const [mx, my] = muzzle(from, f);
          const [tx, ty] = targetPoint(to);
          f.recoil = 1;
          spawnFlash(mx, my, opts.flash || 1);
          S.projs.push({ x0: mx, y0: my, x1: tx, y1: ty, t0: S.t, dur: opts.dur, arc: opts.arc || 0, kind: opts.kind, to, big: opts.big || 1, lastTrail: 0 });
        });
        tEnd = Math.max(tEnd, ft + dt + opts.dur);
      };
      switch (weapon) {
        case 'mg':
          at(ft, () => Sound.sfx('mg', from.idx ? 0.7 : 0.3));
          for (let k = 0; k < 5; k++) shot(k * 0.075, { dur: 0.2, kind: 'tracer', flash: 0.5, big: 0.4 });
          break;
        case 'flak':
          at(ft, () => Sound.sfx('flak', from.idx ? 0.7 : 0.3));
          for (let k = 0; k < 8; k++) shot(k * 0.06, { dur: 0.22, kind: 'tracer', flash: 0.6, big: 0.5 });
          break;
        case 'cannon':
          at(ft, () => Sound.sfx('cannon', from.idx ? 0.7 : 0.3));
          shot(0, { dur: 0.28, kind: 'shell', flash: 2.2, big: 1.6 });
          break;
        case 'artillery':
          at(ft, () => Sound.sfx('artfire', from.idx ? 0.7 : 0.3));
          if (i === 0) at(ft + 0.45, () => Sound.sfx('incoming'));
          shot(0, { dur: 1.05, kind: 'shell', arc: 300, flash: 2.6, big: 1.9 });
          break;
        case 'missile':
          at(ft, () => Sound.sfx('missile', from.idx ? 0.7 : 0.3));
          shot(0, { dur: 0.6, kind: 'missile', arc: -40, flash: 0.8, big: 1.4 });
          shot(0.12, { dur: 0.6, kind: 'missile', arc: 40, flash: 0.8, big: 1.4 });
          break;
        case 'bomb':
          at(ft, () => Sound.sfx('bombdrop', from.idx ? 0.7 : 0.3));
          for (let k = 0; k < 3; k++) shot(k * 0.12, { dur: 0.85, kind: 'bomb', arc: 60, flash: 0.1, big: 2.0 });
          break;
      }
    });
    return tEnd;
  }

  function applyDamage(side, hpAfter) {
    side.hp = hpAfter;
    const keep = figCount(hpAfter);
    let k = 0;
    side.figs.forEach((f, i) => {
      if (i >= keep && f.alive) {
        const delay = 0.15 + k++ * 0.18;
        at(S.t + delay, () => {
          f.alive = false; f.dying = 1;
          const img = IMG['s_' + side.type], sc = SCALE[side.type];
          const cy = side.air ? f.y : f.y - img.height * sc * 0.4;
          spawnExplosion(f.x, cy, 2.6);
          Sound.sfx('destroy', side.idx ? 0.7 : 0.3);
          S.shake = Math.max(S.shake, 14);
          S.flash = 0.5;
        });
      }
    });
  }

  // ---- パーティクル ----
  function spawnFlash(x, y, s) {
    S.parts.push({ x, y, vx: 0, vy: 0, life: 0.08 + 0.04 * s, max: 0.08 + 0.04 * s, size: 10 * s, kind: 'flash' });
    for (let i = 0; i < 3 * s; i++) S.parts.push({ x, y, vx: (Math.random() - 0.5) * 60, vy: -Math.random() * 40, life: 0.6, max: 0.6, size: 6 * s, kind: 'smoke' });
  }
  function spawnExplosion(x, y, s) {
    S.parts.push({ x, y, vx: 0, vy: 0, life: 0.18, max: 0.18, size: 40 * s, kind: 'flash' });
    for (let i = 0; i < 14 * s; i++) {
      const a = Math.random() * Math.PI * 2, v = (40 + Math.random() * 160) * s;
      S.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 40, life: 0.35 + Math.random() * 0.4, max: 0.75, size: (6 + Math.random() * 10) * s, kind: 'fire' });
    }
    for (let i = 0; i < 8 * s; i++) {
      const a = Math.random() * Math.PI * 2, v = (10 + Math.random() * 60) * s;
      S.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 30, life: 1 + Math.random(), max: 2, size: (10 + Math.random() * 14) * s, kind: 'smoke' });
    }
    for (let i = 0; i < 6 * s; i++) {
      const a = -Math.PI * Math.random(), v = 150 + Math.random() * 250;
      S.parts.push({ x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.6, max: 0.6, size: 2, kind: 'spark', g: 500 });
    }
  }

  function impact(p) {
    spawnExplosion(p.x1, p.y1, p.big * 0.6);
    p.to.shake = Math.min(10, p.to.shake + 4 * p.big);
    S.shake = Math.max(S.shake, 3 * p.big);
    if (S.t - S.lastBoom > 0.11) { S.lastBoom = S.t; Sound.sfx(p.big > 1 ? 'explosion' : 'hit', p.to.idx ? 0.75 : 0.25); }
  }

  // ---- ループ ----
  function loop(now) {
    if (!S) return;
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    step(dt);
    if (!S) return;
    draw();
    requestAnimationFrame(loop);
  }

  function step(dt) {
    S.t += dt;
    S.events.sort((a, b) => a.t - b.t);
    while (S.events.length && S.events[0].t <= S.t) S.events.shift().fn();
    for (const p of S.projs) {
      const u = (S.t - p.t0) / p.dur;
      if (u >= 1) { p.done = true; impact(p); continue; }
      p.x = p.x0 + (p.x1 - p.x0) * u;
      p.y = p.y0 + (p.y1 - p.y0) * u - Math.sin(Math.PI * u) * p.arc;
      if (p.kind === 'missile' && S.t - p.lastTrail > 0.015) {
        p.lastTrail = S.t;
        S.parts.push({ x: p.x, y: p.y, vx: (Math.random() - 0.5) * 10, vy: -8, life: 0.7, max: 0.7, size: 6, kind: 'trail' });
      }
      if (p.kind === 'shell' && p.arc > 100 && S.t - p.lastTrail > 0.02) {
        p.lastTrail = S.t;
        S.parts.push({ x: p.x, y: p.y, vx: 0, vy: 0, life: 0.3, max: 0.3, size: 3, kind: 'trail' });
      }
    }
    S.projs = S.projs.filter((p) => !p.done);
    for (const q of S.parts) {
      q.life -= dt; q.x += q.vx * dt; q.y += q.vy * dt;
      if (q.g) q.vy += q.g * dt;
      if (q.kind === 'fire') { q.vx *= 0.92; q.vy *= 0.92; }
      if (q.kind === 'smoke' || q.kind === 'trail') { q.vx *= 0.97; q.vy -= 12 * dt; q.size += 14 * dt; }
    }
    S.parts = S.parts.filter((q) => q.life > 0);
    for (const s of S.sides) {
      s.shake = Math.max(0, s.shake - dt * 25);
      s.hpShow += (s.hp - s.hpShow) * Math.min(1, dt * 5);
      for (const f of s.figs) { f.recoil = Math.max(0, f.recoil - dt * 6); if (f.dying) f.dying = Math.max(0, f.dying - dt * 1.2); }
    }
    S.shake = Math.max(0, S.shake - dt * 30);
    S.flash = Math.max(0, S.flash - dt * 2);
    if (S.t > S.end) { S.fade += dt / 0.35; if (S.fade >= 1) finish(); }
  }

  function drawBg(side, slide) {
    const x0 = side.idx === 0 ? 0 : W / 2;
    ctx.save();
    ctx.beginPath(); ctx.rect(x0, 0, W / 2, H); ctx.clip();
    const img = IMG[side.bg];
    // 各陣営の半分に背景の該当部分を描く（少し視差をつける）
    ctx.drawImage(img, slide * 0.5 - 20 + (side.idx ? 0 : 20), 0, W + 20, H);
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, 'rgba(0,0,0,0.15)'); g.addColorStop(1, 'rgba(0,0,0,0.35)');
    ctx.fillStyle = g; ctx.fillRect(x0, 0, W / 2, H);
    // 陣営カラーのライン
    ctx.fillStyle = PLAYERS[side.owner].color;
    ctx.globalAlpha = 0.85; ctx.fillRect(x0, 0, W / 2, 6); ctx.globalAlpha = 1;
    ctx.restore();
  }

  function drawSide(side, slide) {
    const img = IMG['s_' + side.type], sc = SCALE[side.type];
    const w = img.width * sc, h = img.height * sc;
    const figs = [...side.figs].sort((a, b) => a.y - b.y);
    for (const f of figs) {
      if (!f.alive && !f.dying) continue;
      const jx = (Math.random() - 0.5) * side.shake, jy = (Math.random() - 0.5) * side.shake * 0.5;
      const bob = side.air ? Math.sin(S.t * 2.2 + f.phase) * 6 : (side.type === 'infantry' ? Math.abs(Math.sin(S.t * 6 + f.phase)) * -2 : 0);
      const dir = side.idx === 0 ? 1 : -1;
      const x = f.x + slide + jx - dir * f.recoil * 6, y = f.y + jy + bob;
      ctx.save();
      ctx.globalAlpha = f.alive ? 1 : f.dying;
      // 影
      if (!side.air) {
        ctx.fillStyle = 'rgba(0,0,0,0.35)';
        ctx.beginPath(); ctx.ellipse(x, f.y + 2, w * 0.45, 7, 0, 0, Math.PI * 2); ctx.fill();
      }
      ctx.translate(x, y);
      if (dir < 0) ctx.scale(-1, 1);
      if (!f.alive) { ctx.filter = 'brightness(0.3)'; ctx.rotate(0.15 * (1 - f.dying)); }
      if (side.air) ctx.drawImage(img, -w / 2, -h / 2, w, h);
      else ctx.drawImage(img, -w / 2, -h, w, h);
      ctx.restore();
    }
  }

  function drawPanel(side) {
    const x0 = side.idx === 0 ? 0 : W / 2;
    const P = PLAYERS[side.owner];
    ctx.save();
    ctx.fillStyle = 'rgba(8,12,20,0.78)';
    ctx.fillRect(x0 + 12, 14, W / 2 - 24, 58);
    ctx.fillStyle = P.color; ctx.fillRect(x0 + 12, 14, 6, 58);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 20px "Yu Gothic UI", "Meiryo", sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillText(`${P.name}  ${UNITS[side.type].name}`, x0 + 28, 22);
    ctx.font = '14px "Yu Gothic UI", "Meiryo", sans-serif'; ctx.fillStyle = '#cfd8e6';
    const stars = side.air ? '—' : '★'.repeat(TERRAIN[side.terrain].def) || '—';
    ctx.fillText(`地形: ${side.air ? '空中' : TERRAIN[side.terrain].name}  防御 ${stars}`, x0 + 28, 48);
    // HP
    const hpw = 170, bx = x0 + W / 2 - 24 - hpw;
    ctx.fillStyle = '#222'; ctx.fillRect(bx, 48, hpw, 14);
    const r = Math.max(0, side.hpShow) / 100;
    ctx.fillStyle = r > 0.5 ? '#4cd964' : r > 0.25 ? '#ffcc00' : '#ff3b30';
    ctx.fillRect(bx, 48, hpw * r, 14);
    ctx.strokeStyle = '#fff8'; ctx.strokeRect(bx, 48, hpw, 14);
    ctx.fillStyle = '#fff'; ctx.font = 'bold 22px "Consolas", monospace'; ctx.textAlign = 'right';
    ctx.fillText(`HP ${Math.max(0, Math.ceil(side.hpShow / 10 - 0.001))}`, bx + hpw, 18);
    ctx.restore();
  }

  function drawParts() {
    for (const q of S.parts) {
      const a = Math.max(0, q.life / q.max);
      if (q.kind === 'smoke' || q.kind === 'trail') {
        ctx.globalAlpha = a * (q.kind === 'trail' ? 0.5 : 0.55);
        ctx.fillStyle = q.kind === 'trail' ? '#ddd' : '#3a3530';
        ctx.beginPath(); ctx.arc(q.x, q.y, q.size, 0, Math.PI * 2); ctx.fill();
      }
    }
    ctx.globalCompositeOperation = 'lighter';
    for (const q of S.parts) {
      const a = Math.max(0, q.life / q.max);
      if (q.kind === 'fire') {
        ctx.globalAlpha = a;
        ctx.fillStyle = a > 0.6 ? '#fff2a0' : a > 0.3 ? '#ff9a2a' : '#c0301a';
        ctx.beginPath(); ctx.arc(q.x, q.y, q.size * (0.5 + a * 0.5), 0, Math.PI * 2); ctx.fill();
      } else if (q.kind === 'flash') {
        const g = ctx.createRadialGradient(q.x, q.y, 0, q.x, q.y, q.size);
        g.addColorStop(0, `rgba(255,255,220,${a})`); g.addColorStop(0.4, `rgba(255,190,60,${a * 0.7})`); g.addColorStop(1, 'rgba(255,120,0,0)');
        ctx.globalAlpha = 1; ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(q.x, q.y, q.size, 0, Math.PI * 2); ctx.fill();
      } else if (q.kind === 'spark') {
        ctx.globalAlpha = a; ctx.strokeStyle = '#ffd36a'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(q.x, q.y); ctx.lineTo(q.x - q.vx * 0.03, q.y - q.vy * 0.03); ctx.stroke();
      }
    }
    ctx.globalCompositeOperation = 'source-over';
    ctx.globalAlpha = 1;
  }

  function drawProjs() {
    for (const p of S.projs) {
      if (p.x == null) continue;
      const dx = p.x1 - p.x0, dy = p.y1 - p.y0, len = Math.hypot(dx, dy) || 1;
      if (p.kind === 'tracer') {
        ctx.strokeStyle = '#fff6a8'; ctx.lineWidth = 2.5; ctx.shadowColor = '#ffb000'; ctx.shadowBlur = 8;
        ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - dx / len * 26, p.y - dy / len * 26); ctx.stroke();
        ctx.shadowBlur = 0;
      } else if (p.kind === 'shell') {
        ctx.fillStyle = '#ffe9a0'; ctx.shadowColor = '#ff9000'; ctx.shadowBlur = 12;
        ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
      } else if (p.kind === 'missile') {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(Math.atan2(dy, dx));
        ctx.fillStyle = '#eee'; ctx.fillRect(-10, -2.5, 20, 5);
        ctx.fillStyle = '#ff8a00'; ctx.beginPath(); ctx.arc(-12, 0, 4, 0, Math.PI * 2); ctx.fill();
        ctx.restore();
      } else if (p.kind === 'bomb') {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(Math.atan2(dy, dx) * 0.6 + 0.6);
        ctx.fillStyle = '#2b2b2b'; ctx.beginPath(); ctx.ellipse(0, 0, 11, 5, 0, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#555'; ctx.fillRect(-15, -4, 5, 8);
        ctx.restore();
      }
    }
  }

  function draw() {
    const e = Math.min(1, S.t / 0.45), ease = 1 - Math.pow(1 - e, 3);
    const slideA = -480 * (1 - ease), slideD = 480 * (1 - ease);
    ctx.save();
    ctx.clearRect(0, 0, W, H);
    ctx.translate((Math.random() - 0.5) * S.shake, (Math.random() - 0.5) * S.shake);
    const [A, D] = S.sides;
    drawBg(A, slideA); drawBg(D, slideD);
    ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W / 2, H); ctx.clip(); drawSide(A, slideA); ctx.restore();
    ctx.save(); ctx.beginPath(); ctx.rect(W / 2, 0, W / 2, H); ctx.clip(); drawSide(D, slideD); ctx.restore();
    // 中央の仕切り
    const g = ctx.createLinearGradient(W / 2 - 6, 0, W / 2 + 6, 0);
    g.addColorStop(0, PLAYERS[A.owner].color); g.addColorStop(0.5, '#fff'); g.addColorStop(1, PLAYERS[D.owner].color);
    ctx.fillStyle = g; ctx.fillRect(W / 2 - 3, 0, 6, H);
    drawProjs();
    drawParts();
    drawPanel(A); drawPanel(D);
    ctx.restore();
    if (S.flash > 0) { ctx.fillStyle = `rgba(255,240,200,${S.flash * 0.6})`; ctx.fillRect(0, 0, W, H); }
    if (S.t < 0.25) { ctx.fillStyle = `rgba(0,0,0,${1 - S.t / 0.25})`; ctx.fillRect(0, 0, W, H); }
    if (S.fade > 0) { ctx.fillStyle = `rgba(0,0,0,${S.fade})`; ctx.fillRect(0, 0, W, H); }
    ctx.fillStyle = '#fff9'; ctx.font = '13px "Yu Gothic UI", sans-serif'; ctx.textAlign = 'right';
    ctx.fillText('クリックでスキップ', W - 14, H - 12); ctx.textAlign = 'left';
  }

  return { setup, play, get active() { return !!S; } };
})();
