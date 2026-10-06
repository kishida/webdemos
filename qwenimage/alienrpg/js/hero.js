import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// Rigged, animated soldier (Mixamo, from the three.js examples) rendered live into a texture.
// The forest shows that texture on a sprite, so the hero turns in any direction and animates,
// while still being sorted with the other sprites by its ground position.
const MODEL_URL = 'https://cdn.jsdelivr.net/gh/mrdoob/three.js@r170/examples/models/gltf/Soldier.glb';
const HEIGHT = 2.35;              // world units, feet to head
const VIEW = { w: 2.6, top: 2.55, bottom: -0.6 };
const RT_H = 420;

export class Hero {
  constructor(renderer, camOff) {
    this.renderer = renderer;
    this.ready = false;
    const vh = VIEW.top - VIEW.bottom;
    this.size = new THREE.Vector2(VIEW.w, vh);
    this.center = new THREE.Vector2(0.5, -VIEW.bottom / vh);   // feet position inside the texture
    this.rt = new THREE.WebGLRenderTarget(Math.round(RT_H * VIEW.w / vh), RT_H, { samples: 4 });
    this.rt.texture.colorSpace = THREE.SRGBColorSpace;

    this.scene = new THREE.Scene();
    this.cam = new THREE.OrthographicCamera(-VIEW.w / 2, VIEW.w / 2, VIEW.top, VIEW.bottom, 0.1, 100);
    this.cam.position.copy(camOff).normalize().multiplyScalar(30);
    this.cam.lookAt(0, 0, 0);
    // same mood as the forest: cold sky, warm low sun, plus the hero's lantern and a cool rim
    this.scene.add(new THREE.HemisphereLight(0xb8c8d8, 0x3a4528, 1.6));
    const sun = new THREE.DirectionalLight(0xffd2a0, 2.4); sun.position.set(-30, 30, 12); this.scene.add(sun);
    const lantern = new THREE.PointLight(0xffe6c0, 6, 6, 1.4); lantern.position.set(0, 3, 1); this.scene.add(lantern);
    const rim = new THREE.DirectionalLight(0x9fd0ff, 1.5); rim.position.set(-10, 8, -20); this.scene.add(rim);

    this.yaw = 0;
    this.current = null;
    new GLTFLoader().load(MODEL_URL, g => this._setup(g), undefined, err => console.warn('hero model failed, using sprite', err));
  }

  _setup(gltf) {
    const model = gltf.scene;
    const box = new THREE.Box3().setFromObject(model);
    const s = HEIGHT / (box.max.y - box.min.y);
    model.scale.setScalar(s);
    model.position.y = -box.min.y * s;
    this.root = new THREE.Group();
    this.root.add(model);
    this.scene.add(this.root);
    model.traverse(o => {
      if (o.isMesh) {
        o.frustumCulled = false;
        // grey tactical armour look
        o.material = o.material.clone();
        o.material.color?.multiply(new THREE.Color(0.42, 0.45, 0.48));
        o.material.roughness = 0.6;
      }
    });
    this.rifle = this._rifle();
    const hand = model.getObjectByName('mixamorigRightHand');
    if (hand) {
      hand.add(this.rifle);
      // the Mixamo armature carries its own scale: size the rifle in world units
      model.updateMatrixWorld(true);
      this.rifle.scale.setScalar(1 / hand.getWorldScale(new THREE.Vector3()).x);
    }
    this.mixer = new THREE.AnimationMixer(model);
    this.actions = {};
    for (const clip of gltf.animations) this.actions[clip.name] = this.mixer.clipAction(clip);
    this.play('Idle', 0);
    this.ready = true;
  }

  _rifle() {
    const g = new THREE.Group();
    const dark = new THREE.MeshStandardMaterial({ color: 0x1c1e21, roughness: 0.5, metalness: 0.6 });
    const olive = new THREE.MeshStandardMaterial({ color: 0x3b4230, roughness: 0.7, metalness: 0.2 });
    const glow = new THREE.MeshBasicMaterial({ color: new THREE.Color(0.4, 2.5, 0.8), toneMapped: false });
    const add = (geo, m, x, y, z) => { const o = new THREE.Mesh(geo, m); o.position.set(x, y, z); g.add(o); return o; };
    add(new THREE.BoxGeometry(0.07, 0.09, 0.55), olive, 0, 0, 0.12);
    add(new THREE.BoxGeometry(0.03, 0.03, 0.3), dark, 0, 0.02, 0.5);
    add(new THREE.BoxGeometry(0.04, 0.12, 0.06), dark, 0, -0.09, 0.05);
    add(new THREE.BoxGeometry(0.02, 0.02, 0.05), glow, 0, 0.055, 0.05);
    // orientation tuned to the Mixamo right hand (barrel along the forearm)
    g.rotation.set(-Math.PI / 2, 0, Math.PI / 2);
    g.position.set(0.02, 0.08, 0.03);
    return g;
  }

  play(name, fade = 0.25) {
    const next = this.actions[name];
    if (!next || next === this.current) return;
    next.reset().setEffectiveWeight(1).play();
    if (this.current) this.current.crossFadeTo(next, fade, false);
    this.current = next;
  }

  // face: world-space direction (x,z) the hero should look; state: 'idle' | 'walk' | 'run'
  update(dt, face, state) {
    if (!this.ready) return;
    if (face && face.lengthSq() > 1e-4) {
      const target = Math.atan2(face.x, face.z) + Math.PI;   // Mixamo soldier looks down -Z
      let d = target - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * Math.min(1, dt * 14);
    }
    this.root.rotation.y = this.yaw;
    this.play(state === 'run' ? 'Run' : state === 'walk' ? 'Walk' : 'Idle');
    if (this.actions.Walk) this.actions.Walk.timeScale = 1.25;
    this.mixer.update(dt);

    const r = this.renderer, prevRT = r.getRenderTarget(), prevAlpha = r.getClearAlpha();
    const prevColor = r.getClearColor(new THREE.Color());
    r.setRenderTarget(this.rt);
    r.setClearColor(0x000000, 0);
    r.clear();
    r.render(this.scene, this.cam);
    r.setRenderTarget(prevRT);
    r.setClearColor(prevColor, prevAlpha);
  }
}
