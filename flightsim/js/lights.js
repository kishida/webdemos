// 点光源（滑走路灯、街灯、航空障害灯など）を Points とシェーダで描画する
import * as THREE from 'three';
import { glowTexture } from './textures.js';

let glow = null;
const VERT = /* glsl */`
  attribute vec3 color; attribute float size; attribute vec2 flash;
  uniform float uTime, uScale, uIntensity, uMinPx;
  varying vec3 vColor; varying float vAlpha;
  #include <common>
  #include <logdepthbuf_pars_vertex>
  void main(){
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float on = 1.0;
    float mode = flash.x, ph = flash.y;
    if (mode > 0.5 && mode < 1.5) { // ストロボ（1秒周期の短い閃光）
      on = step(fract(uTime + ph), 0.06);
    } else if (mode > 1.5 && mode < 2.5) { // 航空障害灯（ゆっくり明滅）
      on = 0.15 + 0.85 * smoothstep(0.0, 0.25, sin((uTime * 0.8 + ph) * 6.2832));
    } else if (mode > 2.5) { // シーケンスフラッシャー（進入灯の「ウサギ」）
      on = step(fract(uTime * 2.0 - ph), 0.05) * 2.0;
    }
    vColor = color; vAlpha = on * uIntensity;
    float d = -mv.z;
    gl_PointSize = clamp(size * uScale / d, uMinPx, 48.0) * (0.6 + 0.4 * min(on, 1.5));
    if (vAlpha < 0.01) gl_PointSize = 0.0;
    gl_Position = projectionMatrix * mv;
    #include <logdepthbuf_vertex>
  }`;
const FRAG = /* glsl */`
  uniform sampler2D uTex;
  varying vec3 vColor; varying float vAlpha;
  #include <common>
  #include <logdepthbuf_pars_fragment>
  void main(){
    #include <logdepthbuf_fragment>
    vec4 t = texture2D(uTex, gl_PointCoord);
    gl_FragColor = vec4(vColor * t.rgb * vAlpha, t.a * min(vAlpha, 1.0));
  }`;

export class LightField {
  constructor({ minPx = 1.5, intensityDay = 0.3, intensityNight = 1.0 } = {}) {
    this.pos = []; this.col = []; this.size = []; this.flash = [];
    this.minPx = minPx; this.intensityDay = intensityDay; this.intensityNight = intensityNight;
  }
  add(x, y, z, color, size = 1, mode = 0, phase = 0) {
    this.pos.push(x, y, z); this.col.push(...color); this.size.push(size); this.flash.push(mode, phase);
    return this.size.length - 1;
  }
  build() {
    if (!glow) glow = glowTexture();
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.setAttribute('size', new THREE.Float32BufferAttribute(this.size, 1));
    g.setAttribute('flash', new THREE.Float32BufferAttribute(this.flash, 2));
    g.computeBoundingSphere();
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uScale: { value: 800 }, uIntensity: { value: 1 }, uMinPx: { value: this.minPx }, uTex: { value: glow } },
    });
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false; this.points.renderOrder = 5;
    return this.points;
  }
  setColor(i, c) { const a = this.points.geometry.attributes.color; a.setXYZ(i, c[0], c[1], c[2]); a.needsUpdate = true; }
  update(t, scale, night) {
    const u = this.material.uniforms; u.uTime.value = t; u.uScale.value = scale;
    u.uIntensity.value = this.intensityDay + (this.intensityNight - this.intensityDay) * night;
  }
}

export const LC = {
  white: [1.6, 1.5, 1.3], yellow: [1.7, 1.3, 0.5], green: [0.3, 1.6, 0.6], red: [1.8, 0.25, 0.15],
  blue: [0.35, 0.5, 1.8], orange: [1.6, 0.9, 0.35], sodium: [1.4, 0.85, 0.4], cool: [1.1, 1.2, 1.5],
};
