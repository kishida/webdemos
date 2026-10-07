// パーティクル: スモーク、タイヤの白煙、爆発
import * as THREE from 'three';
import { cloudTexture, glowTexture } from './textures.js';

export class Particles {
  constructor(scene, max = 700) {
    this.scene = scene; this.list = [];
    this.smokeTex = cloudTexture(7); this.glow = glowTexture();
    this.pool = [];
    for (let i = 0; i < max; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.smokeTex, transparent: true, depthWrite: false, opacity: 0 }));
      s.visible = false; scene.add(s); this.pool.push(s);
    }
    this.next = 0;
  }
  spawn({ pos, vel = new THREE.Vector3(), size = 2, grow = 2, life = 4, color = 0xffffff, opacity = 0.8, additive = false, drag = 0.5, rise = 0 }) {
    const s = this.pool[this.next]; this.next = (this.next + 1) % this.pool.length;
    const m = s.material;
    m.map = additive ? this.glow : this.smokeTex; m.blending = additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    m.color.set(color); m.opacity = opacity; m.needsUpdate = true; m.rotation = Math.random() * 6.28;
    s.position.copy(pos); s.scale.setScalar(size); s.visible = true;
    const p = { s, vel: vel.clone(), size, grow, life, age: 0, opacity, drag, rise };
    const old = this.list.findIndex((q) => q.s === s); if (old >= 0) this.list.splice(old, 1);
    this.list.push(p);
  }
  explosion(pos) {
    for (let i = 0; i < 40; i++) {
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.8, Math.random() - 0.5).multiplyScalar(40);
      this.spawn({ pos, vel: v, size: 8 + Math.random() * 10, grow: 14, life: 1.2 + Math.random(), color: i % 3 ? 0xff8a30 : 0xffd060, opacity: 1, additive: true, drag: 2 });
    }
    for (let i = 0; i < 60; i++) {
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.6 + 0.2, Math.random() - 0.5).multiplyScalar(18);
      this.spawn({ pos: pos.clone().add(new THREE.Vector3(0, 3, 0)), vel: v, size: 10, grow: 9, life: 8 + Math.random() * 6, color: 0x2a2826, opacity: 0.85, drag: 0.6, rise: 4 });
    }
  }
  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i]; p.age += dt;
      if (p.age >= p.life) { p.s.visible = false; this.list.splice(i, 1); continue; }
      p.vel.multiplyScalar(Math.exp(-p.drag * dt)); p.vel.y += p.rise * dt;
      p.s.position.addScaledVector(p.vel, dt);
      p.s.scale.setScalar(p.size + p.grow * p.age);
      const t = p.age / p.life;
      p.s.material.opacity = p.opacity * (t < 0.1 ? t / 0.1 : 1 - (t - 0.1) / 0.9);
    }
  }
  clear() { for (const p of this.list) p.s.visible = false; this.list = []; }
}
