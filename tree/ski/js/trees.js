/*
 * Procedural low-poly trees for three.js (r128 – latest).
 * Usage:  const Trees = createTrees(THREE);   const tree = Trees.create('sugi', { x: 0, z: 0 });   scene.add(tree);
 * Generated as one file from the procedural-lowpoly-trees skill. No dependencies besides three.js.
 */
function createTrees(THREE) {
'use strict';
  // ===== Core: skeleton, leaf cards, LOD meshes, OBJ/ZIP export =====
  const V3 = THREE.Vector3, UP = new V3(0, 1, 0), XA = new V3(1, 0, 0);
  const DEG = Math.PI / 180, GOLD = 137.508 * DEG, BARK_W = 0.7, BARK_H = 1.4;
  const clamp = (x, a, b) => Math.min(b, Math.max(a, x));
  const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  function mulberry32(a) { return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function randUnit(r) { const z = r() * 2 - 1, a = r() * Math.PI * 2, s = Math.sqrt(1 - z * z); return new V3(s * Math.cos(a), z, s * Math.sin(a)); }
  function perpOf(t) { return new V3().crossVectors(t, Math.abs(t.y) < 0.9 ? UP : XA).normalize(); }

  const PRESETS = {
    oak:    { name: 'オーク', height: 9, radius: 0.34, shape: '2', baseSize: 0.28, bark: 'oak', levels: 3, branches: 9, children2: 6, children3: 4, length1: 0.62, lengthRatio: 0.55, downAngle: 55, gnarl: 0.4, droop: 0.1, upAttr: 0.14, leafType: 'broad', cardMode: 'cross', leafDensity: 4, leafSize: 1.5, leafWidth: 0.42, leafHue: 92, normalBend: 0.75, radialTrunk: 8, radialBranch: 5, lenSegTrunk: 6, lenSegBranch: 4, skipTwigs: false, budget: 6000 },
    fir:    { name: 'モミ', height: 13, radius: 0.26, shape: '0', baseSize: 0.1, bark: 'fir', levels: 2, branches: 34, children2: 6, children3: 0, length1: 0.34, lengthRatio: 0.42, downAngle: 82, gnarl: 0.12, droop: 0.3, upAttr: 0.02, leafType: 'needle', cardMode: 'single', leafDensity: 3.5, leafSize: 1.4, leafWidth: 0.3, leafHue: 128, normalBend: 0.6, radialTrunk: 7, radialBranch: 3, lenSegTrunk: 8, lenSegBranch: 2, skipTwigs: true, budget: 4000 },
    birch:  { name: 'シラカバ', height: 11, radius: 0.17, shape: '4', baseSize: 0.35, bark: 'birch', levels: 3, branches: 13, children2: 5, children3: 3, length1: 0.42, lengthRatio: 0.55, downAngle: 38, gnarl: 0.3, droop: 0.22, upAttr: 0.18, leafType: 'broad', cardMode: 'cross', leafDensity: 4.5, leafSize: 1.1, leafWidth: 0.38, leafHue: 80, normalBend: 0.75, radialTrunk: 7, radialBranch: 4, lenSegTrunk: 7, lenSegBranch: 3, skipTwigs: true, budget: 5000 },
    willow: { name: 'シダレヤナギ', height: 8, radius: 0.3, shape: '1', baseSize: 0.3, bark: 'willow', levels: 3, branches: 8, children2: 6, children3: 4, length1: 0.6, lengthRatio: 0.75, downAngle: 45, gnarl: 0.25, droop: 0.85, upAttr: 0.15, leafType: 'broad', cardMode: 'cross', leafDensity: 3.5, leafSize: 0.9, leafWidth: 0.15, leafHue: 72, normalBend: 0.7, radialTrunk: 8, radialBranch: 4, lenSegTrunk: 6, lenSegBranch: 5, skipTwigs: false, budget: 7000 },
    dead:   { name: '枯れ木', height: 8, radius: 0.3, shape: '1', baseSize: 0.25, bark: 'dead', levels: 3, branches: 8, children2: 5, children3: 3, length1: 0.6, lengthRatio: 0.55, downAngle: 50, gnarl: 0.7, droop: 0.05, upAttr: 0.1, leafType: 'broad', cardMode: 'cross', leafDensity: 0, leafSize: 1.2, leafWidth: 0.4, leafHue: 60, normalBend: 0.7, radialTrunk: 8, radialBranch: 5, lenSegTrunk: 7, lenSegBranch: 4, skipTwigs: false, budget: 3000 }
  };

  // Weber–Penn crown shape: r = 1 at the lowest branch, 0 at the top
  function shapeRatio(s, r) {
    switch (+s) {
      case 0: return 0.2 + 0.8 * r;
      case 1: return 0.2 + 0.8 * Math.sin(Math.PI * r);
      case 2: return 0.2 + 0.8 * Math.sin(0.5 * Math.PI * r);
      case 3: return 1;
      case 4: return 0.5 + 0.5 * r;
      case 5: return r <= 0.7 ? Math.max(r / 0.7, 0.05) : (1 - r) / 0.3;
      case 6: return 1 - 0.8 * r;
    }
    return 1;
  }
  function sampleB(b, t) {
    const n = b.pts.length - 1, f = clamp(t, 0, 1) * n, i = Math.min(Math.floor(f), n - 1), k = f - i;
    const a = b.pts[i], c = b.pts[i + 1];
    return { pos: new V3().lerpVectors(a, c, k), tan: new V3().subVectors(c, a).normalize() };
  }
  function rAt(b, t) {
    let r = b.r0 * (1 - 0.86 * t);
    if (b.level === 0) r *= 1 + 0.5 * Math.pow(Math.max(0, 1 - t / 0.1), 2); // root flare
    return r;
  }

  const SKEL = [14, 8, 6, 5];
  function genSkeleton(P) {
    const rng = mulberry32((P.seed | 0) * 9301 + 49297);
    const list = [];
    const grow = (level, origin, dir, len, r0, parent) => {
      const n = SKEL[level], d = dir.clone(), step = len / n, pts = [origin.clone()];
      let p = origin.clone();
      const g = level === 0 ? P.gnarl * 0.12 : P.gnarl * 0.9 / Math.sqrt(n);
      const lf = level === 1 ? 0.5 : 1;
      for (let i = 1; i <= n; i++) {
        d.x += (rng() * 2 - 1) * g; d.y += (rng() * 2 - 1) * g * 0.6; d.z += (rng() * 2 - 1) * g;
        if (level === 0) d.lerp(UP, 0.12);
        else { d.y -= P.droop * 2.2 * lf / n; d.y += P.upAttr * 1.2 / n; }
        d.normalize();
        p = p.clone().addScaledVector(d, step); pts.push(p);
      }
      const b = { level, pts, len, r0, parent };
      list.push(b);
      if (level < P.levels) spawn(b);
    };
    const spawn = (b) => {
      const L = b.level; let n, t0;
      if (L === 0) { n = Math.round(P.branches); t0 = P.baseSize; }
      else {
        const ref = L === 1 ? P.length1 * P.height : b.parent.len * P.lengthRatio;
        const c = L === 1 ? P.children2 : P.children3;
        n = Math.round(c * clamp(b.len / Math.max(ref, 1e-3), 0.35, 1)); t0 = 0.12;
      }
      if (n <= 0) return;
      let az = rng() * Math.PI * 2;
      for (let i = 0; i < n; i++) {
        const t = clamp(t0 + (0.97 - t0) * ((i + 0.5 + (rng() - 0.5) * 0.7) / n), 0, 0.98);
        az += GOLD + (rng() - 0.5) * 0.6; // phyllotaxis
        const s = sampleB(b, t);
        let len;
        if (L === 0) len = P.length1 * P.height * shapeRatio(P.shape, clamp((1 - t) / Math.max(1 - P.baseSize, 1e-3), 0, 1)) * (0.85 + 0.3 * rng());
        else len = b.len * P.lengthRatio * (1 - 0.5 * t) * (0.8 + 0.4 * rng());
        if (len < 0.06) continue;
        const down = (P.downAngle * (L === 0 ? 1 : 0.85) + (rng() - 0.5) * (L === 0 ? 16 : 30)) * DEG;
        const p1 = perpOf(s.tan), p2 = new V3().crossVectors(s.tan, p1);
        const side = p1.multiplyScalar(Math.cos(az)).addScaledVector(p2, Math.sin(az));
        const dir = s.tan.clone().multiplyScalar(Math.cos(down)).addScaledVector(side, Math.sin(down));
        dir.y += P.upAttr * 0.4; dir.normalize();
        const rp = rAt(b, t);
        const cr = clamp(rp * Math.pow(len / b.len, 1.15), 0.006, rp * 0.72); // pipe model
        grow(L + 1, s.pos, dir, len, cr, b);
      }
    };
    const d0 = new V3((rng() - 0.5) * 0.25 * P.gnarl, 1, (rng() - 0.5) * 0.25 * P.gnarl).normalize();
    grow(0, new V3(0, -0.15, 0), d0, P.height, P.radius, null);
    return list;
  }

  function genCards(P, skel) {
    const cards = [];
    if (P.leafDensity <= 0) return cards;
    const rng = mulberry32((P.seed | 0) * 7919 + 104729);
    const needle = P.leafType === 'needle';
    const lv = needle ? [P.levels - 1, P.levels] : [P.levels];
    for (const b of skel) {
      if (b.level < 1 || !lv.includes(b.level)) continue;
      const dens = needle && b.level < P.levels ? P.leafDensity * 0.6 : P.leafDensity;
      const f = dens * b.len, cnt = Math.floor(f) + (rng() < f - Math.floor(f) ? 1 : 0);
      for (let k = 0; k < cnt; k++) {
        const key = rng(), phase = rng() * 6.283, variant = rng() < 0.5 ? 0 : 1;
        if (needle) {
          const t = 0.08 + 0.9 * ((k + rng()) / cnt), s = sampleB(b, t), side = k % 2 ? 1 : -1;
          const U = s.tan.clone().addScaledVector(perpOf(s.tan), side * 0.6).normalize();
          const V = new V3().crossVectors(UP, U); if (V.lengthSq() < 1e-4) V.copy(XA); V.normalize();
          const tw = (rng() - 0.5) * 0.8, N0 = new V3().crossVectors(U, V);
          V.multiplyScalar(Math.cos(tw)).addScaledVector(N0, Math.sin(tw)).normalize();
          const sz = Math.min(P.leafSize * (0.7 + 0.5 * rng()), b.len * 1.3 + 0.3);
          cards.push({ c: s.pos, U, V, w: sz, h: sz, base: true, key, phase, variant });
        } else {
          const t = 0.3 + 0.7 * ((k + rng()) / cnt), s = sampleB(b, t);
          const out = new V3(s.pos.x, 0, s.pos.z);
          if (out.lengthSq() < 1e-4) out.set(rng() - 0.5, 0, rng() - 0.5);
          out.normalize();
          const V = out.multiplyScalar(0.55).add(new V3(0, 0.6 * (1 - P.droop), 0)).addScaledVector(s.tan, 0.5 + P.droop * 1.5).add(randUnit(rng).multiplyScalar(0.75)).normalize();
          let U = new V3().crossVectors(V, randUnit(rng));
          if (U.lengthSq() < 1e-4) U = perpOf(V);
          U.normalize();
          const sz = P.leafSize * (0.75 + 0.5 * rng());
          const c = s.pos.clone().addScaledVector(V, sz * 0.3).add(randUnit(rng).multiplyScalar(sz * 0.12));
          cards.push({ c, U, V, w: sz, h: sz, base: false, key, phase, variant });
        }
      }
    }
    return cards;
  }

  function crownOf(cards, P) {
    if (!cards.length) return null;
    const mn = new V3(1e9, 1e9, 1e9), mx = new V3(-1e9, -1e9, -1e9);
    for (const c of cards) { mn.min(c.c); mx.max(c.c); }
    const pad = P.leafSize * 0.4;
    const e = new V3().subVectors(mx, mn).multiplyScalar(0.5).addScalar(pad);
    e.x = Math.max(e.x, 0.6); e.y = Math.max(e.y, 0.6); e.z = Math.max(e.z, 0.6);
    return { c: new V3().addVectors(mn, mx).multiplyScalar(0.5), e };
  }

  const LODQ = [
    { rad: 1, seg: 1, drop: 0, frac: 1, scale: 1 },
    { rad: 0.6, seg: 0.55, drop: 1, frac: 0.45, scale: 1.45 },
    { rad: 0.4, seg: 0.35, drop: 2, frac: 0.18, scale: 2.2 }
  ];
  function newB() { return { pos: [], nor: [], uv: [], ao: [], sway: [], ph: [], idx: [] }; }

  function buildLOD(P, skel, cards, crown, l) {
    const Q = LODQ[l];
    let Htop = 0.5, R = 0.5;
    for (const b of skel) for (const p of b.pts) { Htop = Math.max(Htop, p.y); R = Math.max(R, Math.hypot(p.x, p.z)); }
    const aoAt = (p, leaf) => {
      let a = 1;
      if (crown) {
        const c = crown.c, e = crown.e;
        const d = Math.hypot((p.x - c.x) / e.x, (p.y - c.y) / e.y, (p.z - c.z) / e.z);
        a = leaf ? 0.35 + 0.65 * smooth(0.15, 1.0, d) : 0.5 + 0.5 * smooth(0.3, 1.1, d);
        if (leaf) a *= 0.8 + 0.2 * smooth(-1, 1, (p.y - c.y) / e.y);
      }
      return a * (0.72 + 0.28 * smooth(0, 1.2, p.y));
    };
    const swayAt = (p) => Math.pow(clamp(p.y / Htop, 0, 1.3), 2) * (0.6 + 0.4 * clamp(Math.hypot(p.x, p.z) / R, 0, 1.5));

    // --- bark ---
    const B = newB();
    const baseMax = P.skipTwigs && P.levels > 1 ? P.levels - 1 : P.levels;
    const maxLv = Math.max(1, baseMax - Q.drop);
    for (const b of skel) {
      if (b.level > maxLv) continue;
      const rad0 = b.level === 0 ? P.radialTrunk : b.level === 1 ? P.radialBranch : Math.max(3, P.radialBranch - 2);
      const radial = Math.max(b.level === 0 ? 4 : 3, Math.round(rad0 * Q.rad));
      const seg0 = b.level === 0 ? P.lenSegTrunk : b.level === 1 ? P.lenSegBranch : Math.max(1, Math.round(P.lenSegBranch * 0.6));
      const segs = Math.max(b.level === 0 ? 2 : 1, Math.round(seg0 * Q.seg));
      addTube(B, b, radial, segs, aoAt, swayAt);
    }
    // --- leaves ---
    const Lb = newB();
    for (const cd of cards) {
      if (cd.key >= Q.frac) continue;
      const w = cd.w * Q.scale, h = cd.h * Q.scale;
      const N = new V3().crossVectors(cd.U, cd.V).normalize();
      const quads = [[cd.U, cd.V]];
      if (P.cardMode === 'cross') quads.push(cd.base ? [cd.U, N] : [N, cd.V]);
      for (const [A, Bv] of quads) addCard(Lb, cd, A, Bv, w, h, crown, P.normalBend, aoAt, swayAt);
    }
    const barkTris = B.idx.length / 3, leafTris = Lb.idx.length / 3;
    return { bark: B, leaf: Lb, Htop, R, stats: { barkTris, leafTris, tris: barkTris + leafTris, verts: (B.pos.length + Lb.pos.length) / 3 } };
  }

  function pushV(B, p, n, u, v, ao, sw, ph) {
    B.pos.push(p.x, p.y, p.z); B.nor.push(n.x, n.y, n.z); B.uv.push(u, v); B.ao.push(ao); B.sway.push(sw); B.ph.push(ph);
  }

  // Generalised cylinder with parallel-transport frames, tip closed to a single vertex
  function addTube(B, b, radial, segs, aoAt, swayAt) {
    const base = B.pos.length / 3, pts = [], rs = [];
    for (let i = 0; i <= segs; i++) { const t = i / segs; pts.push(sampleB(b, t).pos); rs.push(rAt(b, t)); }
    const T = pts.map((p, i) => new V3().subVectors(pts[Math.min(i + 1, segs)], pts[Math.max(i - 1, 0)]).normalize());
    const N = perpOf(T[0]);
    const uRep = Math.max(1, Math.round(2 * Math.PI * b.r0 / BARK_W));
    const q = new THREE.Quaternion(), n = new V3(), p = new V3(), Bv = new V3();
    let vAcc = 0;
    for (let i = 0; i < segs; i++) {
      if (i > 0) {
        q.setFromUnitVectors(T[i - 1], T[i]); N.applyQuaternion(q);
        N.addScaledVector(T[i], -N.dot(T[i])).normalize();
        vAcc += pts[i].distanceTo(pts[i - 1]);
      }
      Bv.crossVectors(T[i], N).normalize();
      for (let j = 0; j <= radial; j++) {
        const a = j / radial * Math.PI * 2;
        n.copy(N).multiplyScalar(Math.cos(a)).addScaledVector(Bv, Math.sin(a));
        p.copy(pts[i]).addScaledVector(n, rs[i]);
        pushV(B, p, n, j / radial * uRep, vAcc / BARK_H, aoAt(p, false), swayAt(p), 0);
      }
    }
    vAcc += pts[segs].distanceTo(pts[segs - 1]);
    const tip = base + segs * (radial + 1);
    pushV(B, pts[segs], T[segs], 0.5 * uRep, vAcc / BARK_H, aoAt(pts[segs], false), swayAt(pts[segs]), 0);
    const W = radial + 1;
    for (let i = 0; i < segs - 1; i++) for (let j = 0; j < radial; j++) {
      const a = base + i * W + j, d = a + 1, bb = a + W, c = bb + 1;
      B.idx.push(a, d, c, a, c, bb);
    }
    const last = base + (segs - 1) * W;
    for (let j = 0; j < radial; j++) B.idx.push(last + j, last + j + 1, tip);
  }

  // Alpha-tested leaf card; normals bent toward the crown ellipsoid
  function addCard(B, cd, A, Bv, w, h, crown, bend, aoAt, swayAt) {
    const base = B.pos.length / 3, c = cd.c;
    const corners = cd.base
      ? [[0, -0.5, 0, 1], [1, -0.5, 1, 1], [1, 0.5, 1, 0], [0, 0.5, 0, 0]]
      : [[-0.5, -0.5, 0, 1], [0.5, -0.5, 1, 1], [0.5, 0.5, 1, 0], [-0.5, 0.5, 0, 0]];
    const cn = new V3().crossVectors(A, Bv).normalize();
    const cc = cd.base ? c.clone().addScaledVector(A, w * 0.5) : c;
    if (crown && cn.dot(new V3().subVectors(cc, crown.c)) < 0) cn.negate();
    const p = new V3(), n = new V3(), s = new V3();
    for (const [a, b2, u, v] of corners) {
      p.copy(c).addScaledVector(A, a * w).addScaledVector(Bv, b2 * h);
      if (crown) {
        s.set((p.x - crown.c.x) / (crown.e.x * crown.e.x), (p.y - crown.c.y) / (crown.e.y * crown.e.y), (p.z - crown.c.z) / (crown.e.z * crown.e.z)).normalize();
        n.copy(cn).multiplyScalar(1 - bend).addScaledVector(s, bend).normalize();
      } else n.copy(cn);
      pushV(B, p, n, (cd.variant + u) * 0.5, v, aoAt(p, true), swayAt(p) * 1.15, cd.phase);
    }
    B.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  // ---- OBJ / ZIP ----
  function objText(lod, l, seed) {
    const out = [`# Procedural tree LOD${l}  seed ${seed}`, `# triangles ${lod.stats.tris}`, 'mtllib tree.mtl'];
    let off = 1;
    for (const [name, B] of [['bark', lod.bark], ['leaves', lod.leaf]]) {
      if (!B.idx.length) continue;
      const nv = B.pos.length / 3;
      out.push('o ' + name);
      for (let i = 0; i < nv; i++) out.push(`v ${B.pos[i * 3].toFixed(4)} ${B.pos[i * 3 + 1].toFixed(4)} ${B.pos[i * 3 + 2].toFixed(4)}`);
      for (let i = 0; i < nv; i++) out.push(`vt ${B.uv[i * 2].toFixed(4)} ${(1 - B.uv[i * 2 + 1]).toFixed(4)}`);
      for (let i = 0; i < nv; i++) out.push(`vn ${B.nor[i * 3].toFixed(4)} ${B.nor[i * 3 + 1].toFixed(4)} ${B.nor[i * 3 + 2].toFixed(4)}`);
      out.push('usemtl ' + name, 's 1');
      for (let i = 0; i < B.idx.length; i += 3) {
        const a = B.idx[i] + off, b = B.idx[i + 1] + off, c = B.idx[i + 2] + off;
        out.push(`f ${a}/${a}/${a} ${b}/${b}/${b} ${c}/${c}/${c}`);
      }
      off += nv;
    }
    return out.join('\n') + '\n';
  }
  const MTL = 'newmtl bark\nKd 1 1 1\nmap_Kd bark.png\n\nnewmtl leaves\nKd 1 1 1\nmap_Kd leaves.png\nmap_d leaves.png\n';
  const CRC_T = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(u8) { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = CRC_T[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
  function makeZip(files) {
    const enc = new TextEncoder(), parts = [], central = []; let offset = 0;
    for (const [name, data] of files) {
      const nb = enc.encode(name), d = typeof data === 'string' ? enc.encode(data) : data, crc = crc32(d);
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(12, 0x21, true);
      h.setUint32(14, crc, true); h.setUint32(18, d.length, true); h.setUint32(22, d.length, true); h.setUint16(26, nb.length, true);
      parts.push(new Uint8Array(h.buffer), nb, d);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(14, 0x21, true);
      c.setUint32(16, crc, true); c.setUint32(20, d.length, true); c.setUint32(24, d.length, true); c.setUint16(28, nb.length, true); c.setUint32(42, offset, true);
      central.push(new Uint8Array(c.buffer), nb);
      offset += 30 + nb.length + d.length;
    }
    const cd = central.reduce((s, a) => s + a.length, 0);
    const e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true); e.setUint32(12, cd, true); e.setUint32(16, offset, true);
    return [...parts, ...central, new Uint8Array(e.buffer)];
  }

  function tileNoise(rng, gx, gy) {
    const g = new Float32Array(gx * gy); for (let i = 0; i < g.length; i++) g[i] = rng();
    return (x, y) => {
      x = ((x % gx) + gx) % gx; y = ((y % gy) + gy) % gy;
      const x0 = Math.floor(x), y0 = Math.floor(y), x1 = (x0 + 1) % gx, y1 = (y0 + 1) % gy;
      let fx = x - x0, fy = y - y0; fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
      const a = g[y0 * gx + x0], b = g[y0 * gx + x1], c = g[y1 * gx + x0], d = g[y1 * gx + x1];
      const top = a + (b - a) * fx, bot = c + (d - c) * fx;
      return top + (bot - top) * fy;
    };
  }
  function fbm(rng, gx, gy, oct) {
    const ns = []; for (let o = 0; o < oct; o++) ns.push(tileNoise(rng, gx << o, gy << o));
    return (u, v) => { let s = 0, a = 0.5, t = 0; ns.forEach((n, o) => { s += n(u * (gx << o), v * (gy << o)) * a; t += a; a *= 0.5; }); return s / t; };
  }
  const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

  const BARKS = {
    oak: { dark: [0.13, 0.10, 0.08], light: [0.46, 0.38, 0.29], gx: 7, gy: 2, pw: 1.6 },
    willow: { dark: [0.11, 0.10, 0.09], light: [0.40, 0.36, 0.30], gx: 9, gy: 3, pw: 2.2 },
    dead: { dark: [0.25, 0.24, 0.22], light: [0.66, 0.63, 0.58], gx: 8, gy: 2, pw: 1.3 },
    fir: { dark: [0.16, 0.09, 0.07], light: [0.48, 0.30, 0.22], gx: 6, gy: 9, pw: 1 },
    birch: { dark: [0.12, 0.11, 0.10], light: [0.90, 0.88, 0.83], gx: 4, gy: 40, pw: 1 }
  };
  function makeBarkData(type) {
    const W = 256, H = 512, data = new Uint8Array(W * H * 4), rng = mulberry32(77), cfg = BARKS[type];
    const big = fbm(rng, cfg.gx, cfg.gy, 4), fine = fbm(rng, 16, 32, 3), blot = fbm(rng, 3, 6, 3);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const u = x / W, v = y / H; let col;
      if (type === 'birch') {
        const f = fine(u, v); col = mix3([0.72, 0.70, 0.66], cfg.light, f);
        const l = big(u, v); col = mix3(col, cfg.dark, smooth(0.6, 0.72, l) * 0.9);
        col = mix3(col, cfg.dark, smooth(0.68, 0.76, blot(u, v)) * 0.95);
      } else if (type === 'fir') {
        const n = big(u, v), crack = smooth(0.07, 0.0, Math.abs(n - 0.5));
        col = mix3(cfg.dark, cfg.light, n * (0.8 + 0.4 * fine(u, v)));
        col = mix3(col, [0.07, 0.05, 0.04], crack);
      } else {
        const n = big(u, v); let r = 1 - Math.abs(2 * n - 1); r = Math.pow(r, cfg.pw);
        col = mix3(cfg.dark, cfg.light, r); const f = 0.8 + 0.4 * fine(u, v);
        col = [col[0] * f, col[1] * f, col[2] * f];
      }
      const i = (y * W + x) * 4;
      data[i] = clamp(col[0] * 255, 0, 255); data[i + 1] = clamp(col[1] * 255, 0, 255); data[i + 2] = clamp(col[2] * 255, 0, 255); data[i + 3] = 255;
    }
    return { data, W, H };
  }

  function drawBroad(ctx, ox, S, rng, hue, wid) {
    ctx.save(); ctx.beginPath(); ctx.rect(ox, 0, S, S); ctx.clip();
    const stems = [];
    const stem = (x, y, a, len, d) => {
      const pts = [[x, y, a]], n = 7;
      for (let i = 0; i < n; i++) { a += (rng() - 0.5) * 0.3; x += Math.cos(a) * len / n; y += Math.sin(a) * len / n; pts.push([x, y, a]); }
      stems.push({ pts, d });
      if (d < 2) { const m = d === 0 ? 4 : 2; for (let k = 0; k < m; k++) { const j = 1 + Math.floor(rng() * (n - 2)), sd = k % 2 ? 1 : -1; stem(pts[j][0], pts[j][1], pts[j][2] + sd * (0.5 + rng() * 0.5), len * (0.42 + rng() * 0.2), d + 1); } }
    };
    stem(ox + S / 2, S * 0.99, -Math.PI / 2 + (rng() - 0.5) * 0.3, S * 0.72, 0);
    ctx.lineCap = 'round';
    for (const s of stems) {
      ctx.strokeStyle = `hsl(${hue - 55},28%,${20 + s.d * 4}%)`; ctx.lineWidth = [6, 3.5, 2][s.d];
      ctx.beginPath(); s.pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.stroke();
    }
    const leaves = [];
    for (const s of stems) {
      for (let i = 1; i < s.pts.length; i++) { const p = s.pts[i]; for (const sd of [-1, 1]) { if (rng() < 0.2) continue; leaves.push({ x: p[0], y: p[1], a: p[2] + sd * (0.55 + rng() * 0.6), len: S * (0.085 + rng() * 0.06) * (1 - s.d * 0.12) }); } }
      const e = s.pts[s.pts.length - 1]; leaves.push({ x: e[0], y: e[1], a: e[2], len: S * 0.11 });
    }
    for (let i = leaves.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [leaves[i], leaves[j]] = [leaves[j], leaves[i]]; }
    leaves.forEach((lf, i) => {
      const tx = lf.x + Math.cos(lf.a) * lf.len, ty = lf.y + Math.sin(lf.a) * lf.len;
      if (tx < ox + 6 || tx > ox + S - 6 || ty < 6 || ty > S - 6) return;
      const light = 20 + 30 * (i / leaves.length) + rng() * 8, w = lf.len * wid;
      ctx.save(); ctx.translate(lf.x, lf.y); ctx.rotate(lf.a);
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(lf.len * 0.45, -w * 1.25, lf.len, 0); ctx.quadraticCurveTo(lf.len * 0.45, w * 1.25, 0, 0);
      ctx.fillStyle = `hsl(${hue + (rng() - 0.5) * 18},${36 + rng() * 22}%,${light}%)`; ctx.fill();
      ctx.strokeStyle = `hsla(${hue + 10},40%,${light + 14}%,0.7)`; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(lf.len * 0.05, 0); ctx.lineTo(lf.len * 0.9, 0); ctx.stroke();
      ctx.restore();
    });
    ctx.restore();
  }
  function drawNeedle(ctx, ox, S, rng, hue) {
    ctx.save(); ctx.beginPath(); ctx.rect(ox, 0, S, S); ctx.clip();
    const stems = [];
    const stem = (x, y, a, len, d) => {
      const pts = [[x, y, a]], n = 10;
      for (let i = 0; i < n; i++) { a += (rng() - 0.5) * 0.12; x += Math.cos(a) * len / n; y += Math.sin(a) * len / n; pts.push([x, y, a]); }
      stems.push({ pts, d });
      if (d < 1) for (let j = 1; j < n - 1; j++) for (const sd of [-1, 1]) if (rng() < 0.7) stem(pts[j][0], pts[j][1], pts[j][2] + sd * (0.55 + rng() * 0.3), S * (0.36 * (1 - j / n) + 0.1), d + 1);
    };
    stem(ox + S * 0.02, S * 0.5, (rng() - 0.5) * 0.1, S * 0.94, 0);
    ctx.lineCap = 'round';
    for (const s of stems) { ctx.strokeStyle = `hsl(20,35%,${18 + s.d * 5}%)`; ctx.lineWidth = s.d ? 2.5 : 5; ctx.beginPath(); s.pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.stroke(); }
    ctx.lineWidth = 2.6;
    for (const s of stems) for (let i = 0; i < s.pts.length - 1; i++) {
      const [x0, y0, a] = s.pts[i], [x1, y1] = s.pts[i + 1], L = Math.hypot(x1 - x0, y1 - y0), steps = Math.ceil(L / 4);
      for (let k = 0; k < steps; k++) {
        const t = k / steps, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
        for (const sd of [-1, 1]) {
          const ang = a + sd * (0.7 + rng() * 0.4), nl = S * (0.04 + rng() * 0.018) * (s.d ? 0.85 : 1);
          ctx.strokeStyle = `hsl(${hue + (rng() - 0.5) * 14},${30 + rng() * 20}%,${14 + rng() * 20}%)`;
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(ang) * nl, y + Math.sin(ang) * nl); ctx.stroke();
        }
      }
    }
    ctx.restore();
  }
  function makeLeafCanvas(P) {
    const S = 512, cv = document.createElement('canvas'); cv.width = S * 2; cv.height = S;
    const ctx = cv.getContext('2d'), rng = mulberry32(31 + Math.round(P.leafHue));
    for (let v = 0; v < 2; v++) P.leafType === 'needle' ? drawNeedle(ctx, v * S, S, rng, P.leafHue) : drawBroad(ctx, v * S, S, rng, P.leafHue, P.leafWidth);
    const img = ctx.getImageData(0, 0, cv.width, cv.height), d = new Uint8Array(img.data);
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
    if (n) { r /= n; g /= n; b /= n; }
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] < 10) { d[i] = r; d[i + 1] = g; d[i + 2] = b; } // bleed colour into transparent texels
    return { cv, data: d, W: cv.width, H: cv.height };
  }
  function toTex({ data, W, H }, repeat) {
    const t = new THREE.DataTexture(data, W, H, THREE.RGBAFormat);
    t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
    if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = 4; t.needsUpdate = true; return t;
  }

  // ===================== Japanese / shrine species =====================
  const JP = {
    sugi:      { name: 'スギ', height: 30, radius: 0.55, shape: '0', baseSize: 0.3, bark: 'sugi', levels: 2, branches: 60, children2: 6, children3: 0, length1: 0.24, lengthRatio: 0.45, downAngle: 82, gnarl: 0.06, droop: 0.12, upAttr: 0.06, leafType: 'needle', leafTex: 'sugi', cardMode: 'cross', leafDensity: 2.4, leafSize: 1.5, leafWidth: 0.3, leafHue: 105, normalBend: 0.7, radialTrunk: 10, radialBranch: 4, lenSegTrunk: 10, lenSegBranch: 2, skipTwigs: true },
    hinoki:    { name: 'ヒノキ', height: 22, radius: 0.4, shape: '0', baseSize: 0.25, bark: 'hinoki', levels: 2, branches: 38, children2: 7, children3: 0, length1: 0.27, lengthRatio: 0.5, downAngle: 68, gnarl: 0.1, droop: 0.28, upAttr: 0.08, leafType: 'needle', leafTex: 'hinoki', cardMode: 'cross', leafDensity: 2.4, leafSize: 1.7, leafWidth: 0.3, leafHue: 110, normalBend: 0.7, radialTrunk: 9, radialBranch: 4, lenSegTrunk: 9, lenSegBranch: 2, skipTwigs: true },
    kusunoki:  { name: 'クスノキ', height: 20, radius: 0.95, shape: '2', baseSize: 0.16, bark: 'kusunoki', levels: 3, branches: 11, children2: 7, children3: 4, length1: 0.68, lengthRatio: 0.55, downAngle: 52, gnarl: 0.55, droop: 0.05, upAttr: 0.12, leafType: 'broad', leafTex: 'broad', cardMode: 'cross', leafDensity: 3.6, leafSize: 1.9, leafWidth: 0.36, leafHue: 98, normalBend: 0.75, radialTrunk: 12, radialBranch: 6, lenSegTrunk: 7, lenSegBranch: 4, skipTwigs: false },
    ichou:     { name: 'イチョウ', height: 18, radius: 0.45, shape: '5', baseSize: 0.18, bark: 'ichou', levels: 3, branches: 15, children2: 6, children3: 4, length1: 0.42, lengthRatio: 0.5, downAngle: 48, gnarl: 0.22, droop: 0.05, upAttr: 0.22, leafType: 'broad', leafTex: 'ginkgo', cardMode: 'cross', leafDensity: 7, leafSize: 1.6, leafWidth: 0.4, leafHue: 78, normalBend: 0.75, radialTrunk: 9, radialBranch: 5, lenSegTrunk: 7, lenSegBranch: 3, skipTwigs: true },
    kuromatsu: { name: 'クロマツ', height: 12, radius: 0.42, shape: '2', baseSize: 0.38, bark: 'pine', levels: 3, branches: 9, children2: 5, children3: 4, length1: 0.58, lengthRatio: 0.5, downAngle: 72, gnarl: 0.85, droop: 0.02, upAttr: 0.3, leafType: 'broad', leafTex: 'pine', cardMode: 'cross', leafDensity: 6, leafSize: 1.7, leafWidth: 0.4, leafHue: 118, normalBend: 0.7, radialTrunk: 9, radialBranch: 5, lenSegTrunk: 8, lenSegBranch: 4, skipTwigs: false },
    sakura:    { name: 'サクラ', height: 9, radius: 0.4, shape: '2', baseSize: 0.16, bark: 'sakura', levels: 3, branches: 7, children2: 6, children3: 4, length1: 0.78, lengthRatio: 0.55, downAngle: 62, gnarl: 0.5, droop: 0.14, upAttr: 0.08, leafType: 'broad', leafTex: 'sakura', cardMode: 'cross', leafDensity: 5, leafSize: 1.3, leafWidth: 0.4, leafHue: 345, normalBend: 0.8, radialTrunk: 9, radialBranch: 5, lenSegTrunk: 6, lenSegBranch: 4, skipTwigs: false },
    momiji:    { name: 'イロハモミジ', height: 7, radius: 0.2, shape: '1', baseSize: 0.2, bark: 'momiji', levels: 3, branches: 9, children2: 6, children3: 4, length1: 0.62, lengthRatio: 0.55, downAngle: 56, gnarl: 0.4, droop: 0.22, upAttr: 0.1, leafType: 'broad', leafTex: 'maple', cardMode: 'cross', leafDensity: 4.5, leafSize: 1.1, leafWidth: 0.4, leafHue: 6, normalBend: 0.8, radialTrunk: 7, radialBranch: 4, lenSegTrunk: 6, lenSegBranch: 4, skipTwigs: false }
  };
  for (const k in PRESETS) delete PRESETS[k].budget;
  Object.assign(PRESETS, JP);

  // ---- extra bark textures ----
  function barkData(type) {
    const ext = {
      sugi: { dark: [0.24, 0.13, 0.09], light: [0.62, 0.40, 0.28], gx: 22, gy: 1, pw: 0.9, streak: 1 },
      hinoki: { dark: [0.30, 0.16, 0.10], light: [0.70, 0.45, 0.31], gx: 15, gy: 2, pw: 1.1, streak: 0.7 },
      kusunoki: { dark: [0.10, 0.08, 0.06], light: [0.40, 0.34, 0.27], gx: 9, gy: 5, pw: 1.8, crack: 1 },
      ichou: { dark: [0.18, 0.16, 0.13], light: [0.52, 0.48, 0.41], gx: 8, gy: 2, pw: 1.5 },
      pine: { dark: [0.10, 0.09, 0.08], light: [0.38, 0.33, 0.29], gx: 5, gy: 6, plates: 1 },
      sakura: { dark: [0.16, 0.10, 0.09], light: [0.36, 0.25, 0.22], lenticel: 1 },
      momiji: { dark: [0.30, 0.31, 0.26], light: [0.52, 0.52, 0.45], smooth: 1 }
    }[type];
    if (!ext) return makeBarkData(type);
    const W = 256, H = 512, data = new Uint8Array(W * H * 4), rng = mulberry32(91);
    const big = fbm(rng, ext.gx || 4, ext.gy || 8, 4), fine = fbm(rng, 16, 32, 3), streak = fbm(rng, 48, 2, 2), lent = fbm(rng, 6, 70, 2), soft = fbm(rng, 3, 6, 3);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const u = x / W, v = y / H; let col;
      if (ext.plates) {
        const n = big(u, v), crack = smooth(0.06, 0.0, Math.abs(n - 0.5));
        col = mix3(ext.dark, ext.light, (0.4 + 0.6 * n) * (0.8 + 0.4 * fine(u, v))); col = mix3(col, [0.05, 0.04, 0.04], crack);
      } else if (ext.lenticel) {
        col = mix3(ext.dark, ext.light, 0.35 + 0.5 * soft(u, v) * (0.8 + 0.4 * fine(u, v)));
        col = mix3(col, [0.55, 0.45, 0.38], smooth(0.66, 0.74, lent(u, v)) * 0.8);
      } else if (ext.smooth) {
        col = mix3(ext.dark, ext.light, 0.3 + 0.6 * soft(u, v)); col = mix3(col, ext.dark, smooth(0.6, 0.8, streak(u, v)) * 0.5);
        const f = 0.9 + 0.2 * fine(u, v); col = col.map((c) => c * f);
      } else {
        const n = big(u, v); let r = 1 - Math.abs(2 * n - 1); r = Math.pow(r, ext.pw);
        col = mix3(ext.dark, ext.light, r);
        if (ext.streak) col = mix3(col, ext.dark, smooth(0.5, 0.75, streak(u, v)) * 0.45 * ext.streak);
        if (ext.crack) col = mix3(col, [0.05, 0.04, 0.03], smooth(0.08, 0.0, Math.abs(fbm2s(u, v) - 0.5)) * 0.8);
        const f = 0.8 + 0.4 * fine(u, v); col = col.map((c) => c * f);
      }
      const i = (y * W + x) * 4;
      data[i] = clamp(col[0] * 255, 0, 255); data[i + 1] = clamp(col[1] * 255, 0, 255); data[i + 2] = clamp(col[2] * 255, 0, 255); data[i + 3] = 255;
    }
    return { data, W, H };
  }
  const fbm2s = fbm(mulberry32(5), 6, 14, 3);

  // ---- extra leaf textures ----
  // generic branching spray; leafFn draws one leaf at the origin pointing along +x
  function spray(ctx, ox, S, rng, o, leafFn) {
    ctx.save(); ctx.beginPath(); ctx.rect(ox, 0, S, S); ctx.clip();
    const stems = [];
    const stem = (x, y, a, len, d) => {
      const pts = [[x, y, a]], n = 7;
      for (let i = 0; i < n; i++) { a += (rng() - 0.5) * (o.wiggle || 0.3); x += Math.cos(a) * len / n; y += Math.sin(a) * len / n; pts.push([x, y, a]); }
      stems.push({ pts, d });
      if (d < o.depth) { const m = d === 0 ? o.b0 : o.b1; for (let k = 0; k < m; k++) { const j = 1 + Math.floor(rng() * (n - 2)), sd = k % 2 ? 1 : -1; stem(pts[j][0], pts[j][1], pts[j][2] + sd * (0.5 + rng() * 0.5), len * (0.42 + rng() * 0.2), d + 1); } }
    };
    stem(ox + S / 2, S * 0.99, -Math.PI / 2 + (rng() - 0.5) * 0.3, S * (o.len || 0.72), 0);
    ctx.lineCap = 'round';
    for (const s of stems) {
      ctx.strokeStyle = o.stem; ctx.lineWidth = [6, 3.5, 2, 1.3][s.d];
      ctx.beginPath(); s.pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.stroke();
    }
    const leaves = [];
    for (const s of stems) {
      for (let i = 1; i < s.pts.length; i++) {
        const p = s.pts[i], q = s.pts[i - 1];
        for (let k = 0; k < (o.per || 1); k++) {
          const t = (k + 0.5) / (o.per || 1), x = q[0] + (p[0] - q[0]) * t, y = q[1] + (p[1] - q[1]) * t;
          for (const sd of [-1, 1]) { if (rng() < (o.skip || 0.2)) continue; leaves.push({ x, y, a: p[2] + sd * (o.angle || 0.55) * (1 + rng() * 0.8), len: S * o.leaf * (0.8 + rng() * 0.45) * (1 - s.d * 0.1) }); }
        }
      }
      const e = s.pts[s.pts.length - 1]; leaves.push({ x: e[0], y: e[1], a: e[2], len: S * o.leaf * 1.2 });
    }
    if (!o.ordered) for (let i = leaves.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [leaves[i], leaves[j]] = [leaves[j], leaves[i]]; }
    leaves.forEach((lf, i) => {
      const tx = lf.x + Math.cos(lf.a) * lf.len, ty = lf.y + Math.sin(lf.a) * lf.len, m = 4;
      if (tx < ox + m || tx > ox + S - m || ty < m || ty > S - m) return;
      ctx.save(); ctx.translate(lf.x, lf.y); ctx.rotate(lf.a); leafFn(ctx, lf.len, i / leaves.length, rng); ctx.restore();
    });
    ctx.restore();
  }
  function drawGinkgo(ctx, ox, S, rng, hue) {
    spray(ctx, ox, S, rng, { depth: 2, b0: 4, b1: 2, leaf: 0.1, stem: `hsl(30,25%,22%)`, skip: 0.35 }, (c, L, k, r) => {
      const l = 30 + 28 * k + r() * 8, R = L * 0.6;
      c.strokeStyle = `hsl(${hue},40%,${l - 10}%)`; c.lineWidth = 1.2; c.beginPath(); c.moveTo(0, 0); c.lineTo(L * 0.42, 0); c.stroke();
      c.save(); c.translate(L * 0.4, 0);
      c.beginPath(); c.moveTo(0, 0); c.arc(0, 0, R, -0.75, -0.06); c.lineTo(R * 0.55, 0); c.arc(0, 0, R, 0.06, 0.75); c.closePath();
      c.fillStyle = `hsl(${hue + (r() - 0.5) * 10},${55 + r() * 20}%,${l}%)`; c.fill(); c.restore();
    });
  }
  function drawMaple(ctx, ox, S, rng, hue) {
    spray(ctx, ox, S, rng, { depth: 2, b0: 4, b1: 2, leaf: 0.1, stem: `hsl(${hue},35%,25%)`, skip: 0.3 }, (c, L, k, r) => {
      const l = 28 + 26 * k + r() * 8, h = hue + (r() - 0.5) * 16;
      c.strokeStyle = `hsl(${h},50%,${l - 8}%)`; c.lineWidth = 1; c.beginPath(); c.moveTo(0, 0); c.lineTo(L * 0.35, 0); c.stroke();
      c.save(); c.translate(L * 0.35, 0); c.fillStyle = `hsl(${h},${60 + r() * 25}%,${l}%)`;
      for (let j = -3; j <= 3; j++) {
        const a = j * 0.42, len = L * 0.65 * (1 - Math.abs(j) * 0.13);
        c.save(); c.rotate(a); c.beginPath(); c.moveTo(0, 0); c.quadraticCurveTo(len * 0.4, -len * 0.16, len, 0); c.quadraticCurveTo(len * 0.4, len * 0.16, 0, 0); c.fill(); c.restore();
      }
      c.restore();
    });
  }
  function drawSakura(ctx, ox, S, rng, hue) {
    spray(ctx, ox, S, rng, { depth: 2, b0: 4, b1: 3, leaf: 0.075, stem: 'hsl(10,30%,22%)', skip: 0.15, per: 2, wiggle: 0.45 }, (c, L, k, r) => {
      if (r() < 0.12) { c.fillStyle = `hsl(95,40%,${30 + r() * 12}%)`; c.beginPath(); c.ellipse(L * 0.5, 0, L * 0.5, L * 0.2, 0, 0, 6.29); c.fill(); return; }
      const n = 2 + Math.floor(r() * 3);
      for (let f = 0; f < n; f++) {
        const fx = L * (0.4 + r() * 0.6), fy = (r() - 0.5) * L * 0.8, pr = L * (0.2 + r() * 0.06), lt = 80 + 12 * k + r() * 5;
        c.save(); c.translate(fx, fy); c.rotate(r() * 6.28);
        c.fillStyle = `hsl(${hue + (r() - 0.5) * 8},${55 + r() * 25}%,${Math.min(lt, 95)}%)`;
        for (let p = 0; p < 5; p++) { c.rotate(1.2566); c.beginPath(); c.ellipse(pr * 0.9, 0, pr * 0.75, pr * 0.55, 0, 0, 6.29); c.fill(); }
        c.fillStyle = `hsl(${hue},60%,55%)`; c.beginPath(); c.arc(0, 0, pr * 0.35, 0, 6.29); c.fill(); c.restore();
      }
    });
  }
  function drawScales(ctx, ox, S, rng, hue) { // hinoki: flat fronds of tiny overlapping scales
    spray(ctx, ox, S, rng, { depth: 3, b0: 5, b1: 3, leaf: 0.028, stem: `hsl(${hue},35%,20%)`, skip: 0.05, per: 4, angle: 0.45, ordered: true, len: 0.8 }, (c, L, k, r) => {
      c.fillStyle = `hsl(${hue + (r() - 0.5) * 10},${40 + r() * 15}%,${18 + 18 * k + r() * 8}%)`;
      c.beginPath(); c.ellipse(L * 0.5, 0, L * 0.7, L * 0.42, 0, 0, 6.29); c.fill();
    });
  }
  function drawNeedles(ctx, ox, S, rng, hue, o) { // generalised conifer spray (sugi: short awl needles all round)
    ctx.save(); ctx.beginPath(); ctx.rect(ox, 0, S, S); ctx.clip();
    const stems = [];
    const stem = (x, y, a, len, d) => {
      const pts = [[x, y, a]], n = 10;
      for (let i = 0; i < n; i++) { a += (rng() - 0.5) * 0.18; x += Math.cos(a) * len / n; y += Math.sin(a) * len / n; pts.push([x, y, a]); }
      stems.push({ pts, d });
      if (d < 2) for (let j = 1; j < n - 1; j++) for (const sd of [-1, 1]) if (rng() < (d ? 0.35 : 0.7)) stem(pts[j][0], pts[j][1], pts[j][2] + sd * (0.5 + rng() * 0.35), len * (0.42 * (1 - j / n) + 0.12), d + 1);
    };
    stem(ox + S * 0.02, S * 0.5, (rng() - 0.5) * 0.1, S * 0.94, 0);
    ctx.lineCap = 'round';
    for (const s of stems) { ctx.strokeStyle = `hsl(25,35%,${18 + s.d * 5}%)`; ctx.lineWidth = [5, 2.6, 1.6][s.d]; ctx.beginPath(); s.pts.forEach((p, i) => i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1])); ctx.stroke(); }
    ctx.lineWidth = o.w;
    for (const s of stems) for (let i = 0; i < s.pts.length - 1; i++) {
      const [x0, y0, a] = s.pts[i], [x1, y1] = s.pts[i + 1], L = Math.hypot(x1 - x0, y1 - y0), steps = Math.ceil(L / o.step);
      for (let k = 0; k < steps; k++) {
        const t = k / steps, x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
        for (let q = 0; q < o.around; q++) {
          const ang = a + (q % 2 ? 1 : -1) * (o.spread[0] + rng() * (o.spread[1] - o.spread[0])), nl = S * o.len * (0.75 + rng() * 0.5) * (s.d ? 0.85 : 1);
          ctx.strokeStyle = `hsl(${hue + (rng() - 0.5) * 14},${30 + rng() * 20}%,${o.light + rng() * 18}%)`;
          ctx.beginPath(); ctx.moveTo(x, y); ctx.quadraticCurveTo(x + Math.cos(ang) * nl * 0.6, y + Math.sin(ang) * nl * 0.6, x + Math.cos(ang * 0.7 + a * 0.3) * nl, y + Math.sin(ang * 0.7 + a * 0.3) * nl); ctx.stroke();
        }
      }
    }
    ctx.restore();
  }
  function drawPine(ctx, ox, S, rng, hue) { // tufts of long needles at twig tips
    ctx.save(); ctx.beginPath(); ctx.rect(ox, 0, S, S); ctx.clip(); ctx.lineCap = 'round';
    const tips = [];
    const stem = (x, y, a, len, d) => {
      let px = x, py = y; const n = 5;
      for (let i = 0; i < n; i++) { a += (rng() - 0.5) * 0.35; const nx = px + Math.cos(a) * len / n, ny = py + Math.sin(a) * len / n; ctx.strokeStyle = 'hsl(25,30%,22%)'; ctx.lineWidth = d ? 3 : 5; ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(nx, ny); ctx.stroke(); px = nx; py = ny; if (d === 0 && i > 1 && i < n - 1 && rng() < 0.8) stem(px, py, a + (rng() < 0.5 ? -1 : 1) * (0.6 + rng() * 0.4), len * 0.45, 1); }
      tips.push([px, py, a]);
    };
    stem(ox + S / 2, S * 0.98, -Math.PI / 2, S * 0.55, 0);
    for (const [x, y, a] of tips) {
      for (let k = 0; k < 70; k++) {
        const ang = a + (rng() - 0.5) * 2.4, back = rng() * S * 0.06, sx = x - Math.cos(a) * back, sy = y - Math.sin(a) * back, nl = S * (0.13 + rng() * 0.1);
        ctx.strokeStyle = `hsl(${hue + (rng() - 0.5) * 12},${28 + rng() * 18}%,${14 + rng() * 20}%)`; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(sx, sy); ctx.lineTo(sx + Math.cos(ang) * nl, sy + Math.sin(ang) * nl); ctx.stroke();
      }
      ctx.fillStyle = 'hsl(30,35%,45%)'; ctx.beginPath(); ctx.ellipse(x + Math.cos(a) * 6, y + Math.sin(a) * 6, 6, 3.5, a, 0, 6.29); ctx.fill();
    }
    ctx.restore();
  }
  function leafCanvas(P) {
    const kind = P.leafTex || P.leafType;
    if (kind === 'broad' || kind === 'needle') return makeLeafCanvas(P);
    const S = 512, cv = document.createElement('canvas'); cv.width = S * 2; cv.height = S;
    const ctx = cv.getContext('2d'), rng = mulberry32(53 + Math.round(P.leafHue) + kind.length * 7);
    for (let v = 0; v < 2; v++) {
      const ox = v * S, h = P.leafHue;
      if (kind === 'ginkgo') drawGinkgo(ctx, ox, S, rng, h);
      else if (kind === 'maple') drawMaple(ctx, ox, S, rng, h);
      else if (kind === 'sakura') drawSakura(ctx, ox, S, rng, h);
      else if (kind === 'hinoki') drawScales(ctx, ox, S, rng, h);
      else if (kind === 'pine') drawPine(ctx, ox, S, rng, h);
      else if (kind === 'sugi') drawNeedles(ctx, ox, S, rng, h, { len: 0.03, step: 3, around: 3, spread: [0.35, 1.0], light: 13, w: 2.6 });
      else throw new Error('unknown leafTex ' + kind);
    }
    const img = ctx.getImageData(0, 0, cv.width, cv.height), d = new Uint8Array(img.data);
    let r = 0, g = 0, b = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 200) { r += d[i]; g += d[i + 1]; b += d[i + 2]; n++; }
    if (n) { r /= n; g /= n; b /= n; }
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] < 10) { d[i] = r; d[i + 1] = g; d[i + 2] = b; }
    return { cv, data: d, W: cv.width, H: cv.height };
  }

  // ===================== Materials (standard PBR + wind) =====================
  const shared = { uTime: { value: 0 }, uWind: { value: 0.35 } };
  let manualTime = false;
  const tick = () => { if (!manualTime) shared.uTime.value = performance.now() / 1000; };
  const V_COMMON = '#include <common>\nattribute float ao;\nattribute float sway;\nattribute float phase;\nuniform float uTreeTime;\nuniform float uTreeWind;\nvarying float vTreeAo;';
  const vWind = (flutter) => `#include <begin_vertex>
  {
  vec4 tO = vec4(0.0, 0.0, 0.0, 1.0);
  #ifdef USE_INSTANCING
  tO = instanceMatrix * tO;
  #endif
  tO = modelMatrix * tO;
  float tt = uTreeTime + tO.x * 0.05 + tO.z * 0.07;
  float ww = sway * uTreeWind;
  vec3 tp = transformed;
  vec2 off = vec2(sin(tt * 1.1 + tp.x * 0.15 + tp.z * 0.1) * 0.7 + sin(tt * 2.7 + tp.y * 0.4) * 0.2, sin(tt * 0.83 + tp.z * 0.2 + 1.7) * 0.5);
  transformed.xz += off * ww * 0.6;
  ${flutter ? 'transformed += objectNormal * sin(tt * 7.0 + phase) * uTreeWind * 0.05;' : ''}
  }
  vTreeAo = ao;`;
  const F_BACKLIGHT = `#include <lights_fragment_end>
  #if NUM_DIR_LIGHTS > 0
  {
  float trl = pow(clamp(dot(normalize(-vViewPosition), directionalLights[0].direction), 0.0, 1.0), 3.0);
  reflectedLight.indirectDiffuse += diffuseColor.rgb * directionalLights[0].color * trl * 0.35 * vTreeAo;
  }
  #endif`;
  function patch(mat, kind) { // kind: bark | leaf | depth
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uTreeTime = shared.uTime; sh.uniforms.uTreeWind = shared.uWind;
      sh.vertexShader = sh.vertexShader.replace('#include <common>', V_COMMON).replace('#include <begin_vertex>', vWind(kind === 'leaf'));
      if (kind !== 'depth') {
        sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vTreeAo;')
          .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.rgb *= vTreeAo;');
        if (kind === 'leaf') sh.fragmentShader = sh.fragmentShader.replace('#include <lights_fragment_end>', F_BACKLIGHT);
      }
    };
    mat.customProgramCacheKey = () => 'proctree-' + kind;
    return mat;
  }
  function srgb(tex) { if ('colorSpace' in tex) tex.colorSpace = 'srgb'; else if (THREE.sRGBEncoding !== undefined) tex.encoding = THREE.sRGBEncoding; return tex; }
  const cache = { bark: new Map(), leaf: new Map(), tree: new Map() };
  function barkMats(type) {
    if (!cache.bark.has(type)) {
      const src = barkData(type), map = srgb(toTex(src, true));
      cache.bark.set(type, {
        src, map,
        mat: patch(new THREE.MeshStandardMaterial({ map, roughness: 0.95, metalness: 0 }), 'bark'),
        depth: patch(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }), 'depth'),
        dist: patch(new THREE.MeshDistanceMaterial(), 'depth')
      });
    }
    return cache.bark.get(type);
  }
  function leafMats(P) {
    const key = [P.leafTex || P.leafType, P.leafHue, P.leafWidth].join('|');
    if (!cache.leaf.has(key)) {
      const src = leafCanvas(P), map = srgb(toTex(src, false)), at = 0.42;
      cache.leaf.set(key, {
        src, map,
        mat: patch(new THREE.MeshStandardMaterial({ map, alphaTest: at, side: THREE.DoubleSide, roughness: 0.8, metalness: 0 }), 'leaf'),
        depth: patch(new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, map, alphaTest: at }), 'depth'),
        dist: patch(new THREE.MeshDistanceMaterial({ map, alphaTest: at }), 'depth')
      });
    }
    return cache.leaf.get(key);
  }
  function toGeo(B) {
    if (!B.idx.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(B.pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(B.nor, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(B.uv, 2)); g.setAttribute('ao', new THREE.Float32BufferAttribute(B.ao, 1));
    g.setAttribute('sway', new THREE.Float32BufferAttribute(B.sway, 1)); g.setAttribute('phase', new THREE.Float32BufferAttribute(B.ph, 1));
    g.setIndex(B.idx); g.computeBoundingSphere(); return g;
  }

  // ===================== Building trees =====================
  function resolve(species, opts) {
    const base = typeof species === 'string' ? PRESETS[species] : species;
    if (!base) throw new Error('Trees: unknown species "' + species + '". Use one of: ' + Object.keys(PRESETS).join(', '));
    const P = { ...base, ...(opts.params || {}) };
    P.seed = opts.seed ?? P.seed ?? 1;
    if (opts.height) { const k = opts.height / base.height; P.height = opts.height; if (!(opts.params && 'radius' in opts.params)) P.radius = base.radius * k; }
    return P;
  }
  function buildTree(P) {
    const key = JSON.stringify(P);
    if (!cache.tree.has(key)) {
      const skel = genSkeleton(P), cards = genCards(P, skel), crown = crownOf(cards, P);
      const lods = [0, 1, 2].map((l) => buildLOD(P, skel, cards, crown, l));
      cache.tree.set(key, { P, trunk: skel[0], crown, lods, Htop: lods[0].Htop, geo: lods.map((L) => ({ bark: toGeo(L.bark), leaf: toGeo(L.leaf) })) });
    }
    return cache.tree.get(key);
  }
  function levelGroup(T, l, shadows) {
    const P = T.P, g = new THREE.Group(), bm = barkMats(P.bark);
    const add = (geo, M) => {
      if (!geo) return;
      const m = new THREE.Mesh(geo, M.mat); m.customDepthMaterial = M.depth; m.customDistanceMaterial = M.dist;
      m.castShadow = shadows; m.receiveShadow = shadows; m.onBeforeRender = tick; g.add(m);
    };
    add(T.geo[l].bark, bm);
    if (T.geo[l].leaf) add(T.geo[l].leaf, leafMats(P));
    return g;
  }
  function create(species, opts = {}) {
    const P = resolve(species, opts), T = buildTree(P), sc = opts.scale || 1, shadows = opts.shadows !== false;
    const lod = opts.lod ?? 'auto'; let obj;
    if (lod === 'auto') {
      obj = new THREE.LOD();
      const d = opts.lodDistances || [P.height * sc * 4, P.height * sc * 10];
      obj.addLevel(levelGroup(T, 0, shadows), 0); obj.addLevel(levelGroup(T, 1, shadows), d[0]); obj.addLevel(levelGroup(T, 2, shadows), d[1]);
    } else obj = levelGroup(T, clamp(lod | 0, 0, 2), shadows);
    obj.name = 'tree:' + (typeof species === 'string' ? species : 'custom');
    obj.position.set(opts.x || 0, opts.y || 0, opts.z || 0); obj.rotation.y = opts.rot || 0; obj.scale.setScalar(sc);
    obj.userData.tree = {
      species: typeof species === 'string' ? species : 'custom', params: P,
      height: T.Htop * sc, stats: T.lods.map((L) => L.stats),
      // position (world) and radius of the trunk at height h (m above the tree's base, world units)
      trunkAt(h) {
        obj.updateWorldMatrix(true, false);
        const s = obj.scale.y, tr = T.trunk, ly = h / s - 0.15; let i = 0;
        while (i < tr.pts.length - 2 && tr.pts[i + 1].y < ly) i++;
        const a = tr.pts[i], b = tr.pts[i + 1], k = clamp((ly - a.y) / ((b.y - a.y) || 1), 0, 1);
        const p = new V3().lerpVectors(a, b, k);
        return { position: obj.localToWorld(p), radius: rAt(tr, (i + k) / (tr.pts.length - 1)) * s };
      }
    };
    return obj;
  }

  // ===================== Forest (instanced, optional) =====================
  function createInstanced(species, placements, opts = {}) {
    const base = typeof species === 'string' ? PRESETS[species] : species, nv = opts.variants || 3, seed0 = opts.seed || 1, shadows = opts.shadows !== false;
    const root = new THREE.Group(), groups = [], rng = mulberry32(seed0 * 31 + 7);
    const buckets = Array.from({ length: nv }, () => []);
    for (const p of placements) buckets[p.v ?? Math.floor(rng() * nv)].push(p);
    let H = 1;
    buckets.forEach((list, v) => {
      if (!list.length) return;
      const P = resolve(species, { ...opts, seed: seed0 + v * 37 }), T = buildTree(P); H = Math.max(H, P.height);
      const mats = new Float32Array(list.length * 16), m = new THREE.Matrix4(), q = new THREE.Quaternion();
      list.forEach((t, i) => { const s = t.scale || 1; q.setFromAxisAngle(UP, t.rot ?? rng() * 6.283); m.compose(new V3(t.x, t.y || 0, t.z), q, new V3(s, s, s)); m.toArray(mats, i * 16); });
      const grp = { list, mats, lods: [] };
      for (let l = 0; l < 3; l++) {
        const attr = new THREE.InstancedBufferAttribute(new Float32Array(list.length * 16), 16); attr.setUsage(THREE.DynamicDrawUsage);
        const mk = (geo, M) => { if (!geo) return null; const im = new THREE.InstancedMesh(geo, M.mat, list.length); im.instanceMatrix = attr; im.count = 0; im.frustumCulled = false; im.castShadow = im.receiveShadow = shadows; im.customDepthMaterial = M.depth; im.customDistanceMaterial = M.dist; im.onBeforeRender = tick; root.add(im); return im; };
        grp.lods.push({ attr, bark: mk(T.geo[l].bark, barkMats(P.bark)), leaf: P.leafDensity > 0 ? mk(T.geo[l].leaf, leafMats(P)) : null });
      }
      groups.push(grp);
    });
    const dist = { l0: H * 4, l1: H * 10, far: 250, ...(opts.distances || {}) };
    const last = { x: 1e9, z: 0, a: 0 }; let frames = 0;
    // call every frame; recomputes only when the camera moved/turned or every 10 frames
    root.update = (camera) => {
      const dir = new V3(); camera.getWorldDirection(dir);
      const cp = new V3(); camera.getWorldPosition(cp);
      const a = Math.atan2(dir.x, dir.z);
      if (Math.hypot(cp.x - last.x, cp.z - last.z) < 1 && Math.abs(a - last.a) < 0.05 && ++frames % 10) return root.triangles;
      last.x = cp.x; last.z = cp.z; last.a = a;
      const fl = Math.hypot(dir.x, dir.z) || 1, fx = dir.x / fl, fz = dir.z / fl;
      const L0 = dist.l0 ** 2, L1 = dist.l1 ** 2, F = dist.far ** 2; let tris = 0;
      for (const grp of groups) {
        const c = [0, 0, 0], arrs = grp.lods.map((l) => l.attr.array);
        for (let i = 0; i < grp.list.length; i++) {
          const t = grp.list[i], dx = t.x - cp.x, dz = t.z - cp.z, d2 = dx * dx + dz * dz;
          if (d2 > F || (d2 > 225 && dx * fx + dz * fz < -0.15 * Math.sqrt(d2))) continue;
          const l = d2 < L0 ? 0 : d2 < L1 ? 1 : 2;
          arrs[l].set(grp.mats.subarray(i * 16, i * 16 + 16), c[l] * 16); c[l]++;
        }
        grp.lods.forEach((L, l) => {
          for (const im of [L.bark, L.leaf]) if (im) { im.count = c[l]; tris += c[l] * im.geometry.index.count / 3; }
          L.attr.needsUpdate = c[l] > 0;
        });
      }
      return (root.triangles = tris);
    };
    root.triangles = 0;
    return root;
  }

  // ===================== Export =====================
  function dataToCanvas({ data, W, H }) {
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data), W, H), 0, 0); return c;
  }
  const toPng = (cv) => new Promise((res) => cv.toBlob((b) => b.arrayBuffer().then((ab) => res(new Uint8Array(ab))), 'image/png'));
  async function exportZip(species, opts = {}) {
    const P = resolve(species, opts), T = buildTree(P);
    const files = T.lods.map((L, i) => [`tree_LOD${i}.obj`, objText(L, i, P.seed)]);
    files.push(['tree.mtl', MTL], ['bark.png', await toPng(dataToCanvas(barkMats(P.bark).src))]);
    if (P.leafDensity > 0) files.push(['leaves.png', await toPng(leafMats(P).src.cv)]);
    files.push(['settings.json', JSON.stringify(P, null, 2)]);
    return new Blob(makeZip(files), { type: 'application/zip' });
  }

  const API = {
    create, createInstanced, exportZip,
    presets: PRESETS,
    get species() { return Object.keys(PRESETS).map((id) => ({ id, name: PRESETS[id].name, height: PRESETS[id].height })); },
    get wind() { return shared.uWind.value; }, set wind(v) { shared.uWind.value = v; },
    setTime(t) { manualTime = true; shared.uTime.value = t; },
    setLOD(obj, l) { if (obj.isLOD) return; const T = buildTree(obj.userData.tree.params); const fresh = levelGroup(T, l, obj.children[0]?.castShadow ?? true); obj.children.forEach((m, i) => { if (fresh.children[i]) m.geometry = fresh.children[i].geometry; }); },
    dispose() {
      for (const M of [...cache.bark.values(), ...cache.leaf.values()]) { M.map.dispose(); M.mat.dispose(); M.depth.dispose(); M.dist.dispose(); }
      for (const T of cache.tree.values()) for (const g of T.geo) { g.bark && g.bark.dispose(); g.leaf && g.leaf.dispose(); }
      cache.bark.clear(); cache.leaf.clear(); cache.tree.clear();
    },
    // low-level access (generator UI, custom pipelines)
    internals: { genSkeleton, genCards, crownOf, buildLOD, toGeo, barkData, leafCanvas, objText, makeZip, mulberry32 },
    forest: null // filled below
  };

  // ---- Vegetation placement ----
  // envFn(x, z) must return { h, s, m, cover, edge, tl, rd }:
  //   h = height (m), s = slope (rise/run), m = moisture 0..1, cover = forest cover 0..1
  //   (smoothstep of a large-scale noise), edge = 1 at the forest/meadow boundary, tl = treeline height,
  //   rd = distance to the nearest river channel (use 1e9 when there is none)
  const mix = (a, b, t) => a + (b - a) * t;
  const bell = (x, c, w) => Math.exp(-((x - c) / w) * ((x - c) / w));
  const SHRUB = { height: 2.2, radius: 0.06, shape: '1', baseSize: 0.05, bark: 'willow', levels: 2, branches: 10, children2: 5, children3: 0, length1: 0.7, lengthRatio: 0.6, downAngle: 55, gnarl: 0.5, droop: 0.15, upAttr: 0.2, leafType: 'broad', cardMode: 'cross', leafDensity: 5, leafSize: 0.75, leafWidth: 0.45, leafHue: 108, normalBend: 0.8, radialTrunk: 4, radialBranch: 3, lenSegTrunk: 2, lenSegBranch: 2, skipTwigs: true };
  // heights below are tuned for a valley 0..120 m with the treeline near 72 m; rescale for other terrain
  const ECO_SPECIES = [
    { id: 'oak', base: PRESETS.oak, variants: 3, spacing: 9 },
    { id: 'willow', base: PRESETS.willow, variants: 2, spacing: 8 },
    { id: 'birch', base: PRESETS.birch, variants: 3, spacing: 4.5 },
    { id: 'fir', base: PRESETS.fir, variants: 3, spacing: 5 },
    { id: 'dead', base: PRESETS.dead, variants: 2, spacing: 6 },
    { id: 'shrub', base: SHRUB, variants: 3, spacing: 2.4 }
  ];
  function suit(id, e) {
    if (e.h < 0.5 || e.s > 0.95) return 0;
    const channel = e.rd < 7 ? 0 : 1, gentle = smooth(0.95, 0.45, e.s);
    switch (id) {
      case 'oak': return channel * e.cover * smooth(36, 16, e.h) * (1 - smooth(0.55, 0.85, e.m)) * gentle;
      case 'willow': return (e.rd < 5.5 ? 0 : 1) * smooth(0.58, 0.85, e.m) * smooth(28, 10, e.h) * (0.5 + 0.5 * e.cover) * 1.4;
      case 'birch': return channel * bell(e.h, 32, 20) * (0.3 * e.cover + 0.9 * e.edge) * gentle;
      case 'fir': return channel * e.cover * smooth(20, 40, e.h) * smooth(e.tl + 3, e.tl - 5, e.h) * smooth(1.05, 0.6, e.s) * (0.6 + 0.4 * e.m) * 1.2;
      case 'dead': return channel * (bell(e.h, e.tl + 1, 6) * 0.35 + smooth(0.86, 0.97, e.m) * smooth(6, 2, e.h) * 0.5 + 0.025 * e.cover);
    }
    return 0;
  }

  // spatial hash
  function makeHash(cell = 8) {
    const map = new Map(), key = (i, j) => (i + 4096) * 8192 + (j + 4096);
    return {
      add(t) { const k = key(Math.floor(t.x / cell), Math.floor(t.z / cell)); let a = map.get(k); if (!a) map.set(k, a = []); a.push(t); },
      // calls fn(t) for trees near (x, z); return false from fn to stop early (then near() returns false)
      near(x, z, r, fn) {
        const c = Math.ceil(r / cell), cx = Math.floor(x / cell), cz = Math.floor(z / cell);
        for (let i = -c; i <= c; i++) for (let j = -c; j <= c; j++) { const a = map.get(key(cx + i, cz + j)); if (a) for (const t of a) if (fn(t) === false) return false; }
        return true;
      }
    };
  }

  // Returns { trees: [{sp, v, x, z, rot, scale}], hash }. half = half-size of the square area.
  function placeForest(envFn, half, seed = 2024) {
    const rng = mulberry32(seed), hash = makeHash(), trees = [];
    const byId = Object.fromEntries(ECO_SPECIES.map((s) => [s.id, s]));
    const put = (sp, x, z, scale) => { const t = { sp, x, z, scale, rot: rng() * Math.PI * 2, v: Math.floor(rng() * byId[sp].variants), spacing: byId[sp].spacing }; trees.push(t); hash.add(t); return t; };
    // 1) canopy trees: shuffled jittered candidates, species picked ∝ suitability, species-specific spacing (dart throwing)
    const cands = [];
    for (let x = -half + 3; x < half - 3; x += 3) for (let z = -half + 3; z < half - 3; z += 3) cands.push([x + (rng() - 0.5) * 3, z + (rng() - 0.5) * 3]);
    for (let i = cands.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [cands[i], cands[j]] = [cands[j], cands[i]]; }
    const canopy = ['oak', 'willow', 'birch', 'fir', 'dead'];
    for (const [x, z] of cands) {
      const e = envFn(x, z), w = canopy.map((id) => suit(id, e)), S = w.reduce((a, b) => a + b, 0);
      if (S <= 0.02 || rng() > Math.min(1, S) * 0.95) continue;
      let r = rng() * S, k = 0; while (r > w[k] && k < w.length - 1) { r -= w[k]; k++; }
      const sp = canopy[k], sd = byId[sp].spacing;
      const ok = hash.near(x, z, 20, (t) => Math.hypot(t.x - x, t.z - z) >= 0.5 * (sd + t.spacing) * (0.85 + 0.3 * rng()));
      if (!ok) continue;
      let sc = (0.72 + 0.5 * rng()) * (0.7 + 0.3 * w[k] / Math.max(S, 1e-3));
      if (sp === 'fir') sc *= mix(1, 0.38, smooth(e.tl - 20, e.tl + 2, e.h)); // krummholz near the treeline
      put(sp, x, z, sc);
    }
    // 2) shrubs: forest edges and bright gaps
    for (let x = -half + 2; x < half - 2; x += 2.2) for (let z = -half + 2; z < half - 2; z += 2.2) {
      const px = x + (rng() - 0.5) * 2.2, pz = z + (rng() - 0.5) * 2.2, e = envFn(px, pz);
      if (e.h < 0.8 || e.s > 0.8 || e.rd < 6) continue;
      const p = (e.edge * 0.55 + e.cover * 0.12 + (1 - e.cover) * 0.04) * smooth(e.tl + 8, e.tl - 4, e.h) * smooth(0.9, 0.3, e.m);
      if (rng() > p * 0.3) continue;
      const ok = hash.near(px, pz, 10, (t) => { const d = Math.hypot(t.x - px, t.z - pz); return t.sp === 'shrub' ? d > 2.2 : d > Math.max(2.2, t.scale * 1.6); });
      if (ok) put('shrub', px, pz, 0.7 + 0.6 * rng());
    }
    return { trees, hash };
  }

  PRESETS.shrub = { name: '低木', ...SHRUB };
  API.forest = { place: placeForest, suit, species: ECO_SPECIES };
  return API;
}
if (typeof window !== 'undefined' && window.THREE && !window.Trees) window.Trees = createTrees(window.THREE);
