import * as THREE from 'three';

function canvasTex(size, draw) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  draw(c.getContext('2d'), size);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export const blobTex = canvasTex(128, (g, s) => {
  const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  gr.addColorStop(0, 'rgba(0,0,0,0.75)');
  gr.addColorStop(0.5, 'rgba(0,0,0,0.4)');
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.fillRect(0, 0, s, s);
});

export const glowTex = canvasTex(128, (g, s) => {
  const gr = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.2, 'rgba(255,255,255,0.6)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, s, s);
});

export const flashTex = canvasTex(128, (g, s) => {
  g.translate(s / 2, s / 2);
  for (let i = 0; i < 7; i++) {
    g.rotate(Math.PI * 2 / 7 + Math.random() * 0.3);
    const gr = g.createLinearGradient(0, 0, s / 2, 0);
    gr.addColorStop(0, 'rgba(255,240,200,1)'); gr.addColorStop(1, 'rgba(255,160,40,0)');
    g.fillStyle = gr;
    g.beginPath(); g.moveTo(0, -5); g.lineTo(s / 2 * (0.6 + Math.random() * 0.4), 0); g.lineTo(0, 5); g.fill();
  }
  const gr = g.createRadialGradient(0, 0, 0, 0, 0, s / 4);
  gr.addColorStop(0, 'rgba(255,255,230,1)'); gr.addColorStop(1, 'rgba(255,180,60,0)');
  g.fillStyle = gr; g.beginPath(); g.arc(0, 0, s / 4, 0, Math.PI * 2); g.fill();
});

export const splatTex = canvasTex(256, (g, s) => {
  g.fillStyle = 'rgba(70,160,20,0.85)';
  for (let i = 0; i < 40; i++) {
    const a = Math.random() * Math.PI * 2, r = Math.random() ** 2 * s * 0.42;
    const rad = (1 - r / (s * 0.45)) * 26 + 3;
    g.beginPath(); g.arc(s / 2 + Math.cos(a) * r, s / 2 + Math.sin(a) * r, rad * Math.random() + 2, 0, Math.PI * 2); g.fill();
  }
  g.fillStyle = 'rgba(140,230,40,0.5)';
  g.beginPath(); g.arc(s / 2, s / 2, s * 0.12, 0, Math.PI * 2); g.fill();
});

export const ringTex = canvasTex(256, (g, s) => {
  g.strokeStyle = 'rgba(120,255,160,1)'; g.lineWidth = 6;
  g.shadowColor = '#6f9'; g.shadowBlur = 16;
  g.beginPath(); g.arc(s / 2, s / 2, s * 0.4, 0, Math.PI * 2); g.stroke();
  g.lineWidth = 3; g.setLineDash([12, 14]);
  g.beginPath(); g.arc(s / 2, s / 2, s * 0.3, 0, Math.PI * 2); g.stroke();
});

// Tex aspect (w/h) once loaded; fallback 1
export const aspect = t => (t.image && t.image.width ? t.image.width / t.image.height : 1);

// texture mirrored horizontally (shares the image)
export function mirrored(t) {
  const m = t.clone();
  m.wrapS = THREE.RepeatWrapping;
  m.repeat.x = -1; m.offset.x = 1;
  m.needsUpdate = true;
  return m;
}

export const rand = (a, b) => a + Math.random() * (b - a);

// seeded RNG (mulberry32)
export function rng(seed) {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

// Simple CPU particle bursts (additive points)
export class Particles {
  constructor(scene, max = 400, size = 0.12, atten = true) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.geo = new THREE.BufferGeometry();
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3));
    this.mat = new THREE.PointsMaterial({ size, sizeAttenuation: atten, map: glowTex, vertexColors: true, transparent: true,
      depthWrite: false, blending: THREE.AdditiveBlending });
    this.points = new THREE.Points(this.geo, this.mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
    this.i = 0;
  }
  burst(p, n, color, speed = 4, life = 0.6, grav = 9) {
    const c = new THREE.Color(color);
    for (let k = 0; k < n; k++) {
      const i = this.i = (this.i + 1) % this.max;
      this.pos[i * 3] = p.x; this.pos[i * 3 + 1] = p.y; this.pos[i * 3 + 2] = p.z;
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.3 + Math.random()));
      this.vel[i * 3] = v.x; this.vel[i * 3 + 1] = v.y + speed * 0.3; this.vel[i * 3 + 2] = v.z;
      this.col[i * 3] = c.r; this.col[i * 3 + 1] = c.g; this.col[i * 3 + 2] = c.b;
      this.life[i] = life * (0.5 + Math.random() * 0.5);
      this.grav[i] = grav;
    }
  }
  update(dt) {
    for (let i = 0; i < this.max; i++) {
      if (this.life[i] <= 0) { this.pos[i * 3 + 1] = -999; continue; }
      this.life[i] -= dt;
      this.vel[i * 3 + 1] -= this.grav[i] * dt;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      const f = Math.min(1, this.life[i] * 3);
      this.col[i * 3] *= 0.97 + 0.03 * f; this.col[i * 3 + 1] *= 0.97 + 0.03 * f; this.col[i * 3 + 2] *= 0.97 + 0.03 * f;
    }
    this.geo.attributes.position.needsUpdate = true;
    this.geo.attributes.color.needsUpdate = true;
  }
}
