// import * as THREE from 'three';

/* ============ ユーティリティ ============ */
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const rnd=(a=1,b)=>b===undefined?Math.random()*a:a+Math.random()*(b-a);
const pick=a=>a[Math.floor(Math.random()*a.length)];
const wrapA=a=>{while(a>Math.PI)a-=Math.PI*2;while(a<-Math.PI)a+=Math.PI*2;return a};
const D2R=Math.PI/180;
const $=id=>document.getElementById(id);
const fmtT=s=>`${String(Math.floor(s/60)).padStart(2,'0')}:${String(Math.floor(s%60)).padStart(2,'0')}`;

/* ============ 定数(都市グリッド) ============ */
const GRID=7, CELL=44, ROAD=16, BLOCK=28, T=GRID*CELL+ROAD, HALF=T/2;

/* ============ 基本セットアップ ============ */
const renderer=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});
renderer.setPixelRatio(Math.min(devicePixelRatio,1.75));
renderer.setSize(innerWidth,innerHeight);
renderer.shadowMap.enabled=true;
renderer.shadowMap.type=THREE.PCFSoftShadowMap;
renderer.toneMapping=THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure=1.05;
renderer.outputColorSpace=THREE.SRGBColorSpace;
$('wrap').appendChild(renderer.domElement);
renderer.domElement.addEventListener('contextmenu',e=>e.preventDefault());

const scene=new THREE.Scene();
scene.fog=new THREE.Fog(0xcfc2ab, 90, 380);
const camera=new THREE.PerspectiveCamera(55, innerWidth/innerHeight, .1, 1600);

/* 空(グラデーション+太陽) */
scene.add(new THREE.Mesh(new THREE.SphereGeometry(900,24,16), new THREE.ShaderMaterial({
  side:THREE.BackSide, depthWrite:false, fog:false,
  uniforms:{sunDir:{value:new THREE.Vector3(.45,.55,.35).normalize()}},
  vertexShader:`varying vec3 vP; void main(){vP=position; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
  fragmentShader:`varying vec3 vP; uniform vec3 sunDir;
    void main(){ float h=normalize(vP).y;
      vec3 hor=vec3(.91,.78,.60), mid=vec3(.70,.71,.66), zen=vec3(.44,.51,.62);
      vec3 c = h<=0. ? hor : (h<.35 ? mix(hor,mid,h/.35) : mix(mid,zen,smoothstep(.35,.9,h)));
      float s=pow(max(dot(normalize(vP),sunDir),0.),80.);
      c+=vec3(1.,.72,.42)*s*1.6 + vec3(1.,.75,.5)*pow(max(dot(normalize(vP),sunDir),0.),6.)*.15;
      gl_FragColor=vec4(c,1.);}`
})));

/* 照明 */
const hemi=new THREE.HemisphereLight(0xbfc7d4,0x5a5648,.55); scene.add(hemi);
const sunL=new THREE.DirectionalLight(0xffd9a8,2.4);
sunL.castShadow=true;
sunL.shadow.mapSize.set(2048,2048);
sunL.shadow.camera.left=-75; sunL.shadow.camera.right=75;
sunL.shadow.camera.top=75; sunL.shadow.camera.bottom=-75;
sunL.shadow.camera.near=20; sunL.shadow.camera.far=400;
sunL.shadow.bias=-0.0006;
scene.add(sunL); scene.add(sunL.target);
const flashLight=new THREE.PointLight(0xffb066,0,30,2); scene.add(flashLight);

/* ============ テクスチャ生成 ============ */
function mkTex(c){const t=new THREE.CanvasTexture(c); t.colorSpace=THREE.SRGBColorSpace; t.anisotropy=4; return t;}
const pTex=(()=>{const c=document.createElement('canvas');c.width=c.height=64;const x=c.getContext('2d');
  const g=x.createRadialGradient(32,32,0,32,32,32);
  g.addColorStop(0,'rgba(255,255,255,1)');g.addColorStop(.4,'rgba(255,255,255,.55)');g.addColorStop(1,'rgba(255,255,255,0)');
  x.fillStyle=g;x.fillRect(0,0,64,64);return new THREE.CanvasTexture(c);})();
const scorchTex=(()=>{const c=document.createElement('canvas');c.width=c.height=64;const x=c.getContext('2d');
  const g=x.createRadialGradient(32,32,0,32,32,32);
  g.addColorStop(0,'rgba(10,10,10,.95)');g.addColorStop(.6,'rgba(20,18,14,.55)');g.addColorStop(1,'rgba(0,0,0,0)');
  x.fillStyle=g;x.fillRect(0,0,64,64);return new THREE.CanvasTexture(c);})();
const cloudTex=(()=>{const c=document.createElement('canvas');c.width=c.height=128;const x=c.getContext('2d');
  for(let i=0;i<7;i++){const g=x.createRadialGradient(rnd(30,98),rnd(45,83),0,64,64,60);
    g.addColorStop(0,'rgba(255,250,240,.5)');g.addColorStop(1,'rgba(255,250,240,0)');
    x.fillStyle=g;x.fillRect(0,0,128,128);}
  return new THREE.CanvasTexture(c);})();

/* ============ 地面(アスファルト/標示を1枚のテクスチャに) ============ */
const clouds=[];
(function buildGround(){
  const S=2048, c=document.createElement('canvas'); c.width=c.height=S; const x=c.getContext('2d');
  const k=S/T, W=v=>(v+HALF)*k;
  x.fillStyle='#33363a'; x.fillRect(0,0,S,S);
  for(let i=0;i<9000;i++){x.fillStyle=Math.random()<.5?'rgba(255,255,255,.03)':'rgba(0,0,0,.05)';x.fillRect(rnd(S),rnd(S),rnd(1,2),rnd(1,2));}
  // 街区(歩道)
  for(let i=0;i<GRID;i++)for(let j=0;j<GRID;j++){
    const x0=W(-146+44*i), z0=W(-146+44*j), b=BLOCK*k;
    x.fillStyle='#5c5f57'; x.fillRect(x0,z0,b,b);
    x.fillStyle='#474a45'; x.fillRect(x0+1.2*k,z0+1.2*k,b-2.4*k,b-2.4*k);
    x.strokeStyle='#767a6e'; x.lineWidth=2; x.strokeRect(x0,z0,b,b);
    x.strokeStyle='rgba(0,0,0,.14)'; x.lineWidth=1;
    for(let s=4;s<BLOCK;s+=4){x.beginPath();x.moveTo(x0+s*k,z0);x.lineTo(x0+s*k,z0+b);x.stroke();
      x.beginPath();x.moveTo(x0,z0+s*k);x.lineTo(x0+b,z0+s*k);x.stroke();}
  }
  const inInt=v=>{for(let l=0;l<=GRID;l++) if(Math.abs(v-(-154+44*l))<11) return true; return false;};
  // 中央線(破線)
  x.strokeStyle='rgba(196,158,66,.75)'; x.lineWidth=Math.max(1.5,.3*k);
  for(let q=0;q<=GRID;q++){const rc=-154+44*q;
    for(let v=-HALF+4;v<HALF-4;v+=5.6){ if(inInt(v)||inInt(v+2.6)) continue;
      x.beginPath();x.moveTo(W(rc),W(v));x.lineTo(W(rc),W(v+2.6));x.stroke();
      x.beginPath();x.moveTo(W(v),W(rc));x.lineTo(W(v+2.6),W(rc));x.stroke();}}
  // 横断歩道
  x.fillStyle='rgba(226,224,210,.78)';
  for(let a=0;a<=GRID;a++)for(let b=0;b<=GRID;b++){
    const rx=-154+44*a, rz=-154+44*b;
    for(const zb of [[rz-11.4,2.5],[rz+8.9,2.5]]) for(let xx=-6.6;xx<=6.6;xx+=1.76)
      x.fillRect(W(rx+xx-.35),W(zb[0]),.7*k,zb[1]*k);
    for(const xb of [[rx-11.4,2.5],[rx+8.9,2.5]]) for(let zz=-6.6;zz<=6.6;zz+=1.76)
      x.fillRect(W(xb[0]),W(rz+zz-.35),xb[1]*k,.7*k);
  }
  // マンホール
  for(let i=0;i<45;i++){const v=-154+44*Math.floor(rnd(0,GRID+1)), t=rnd(-HALF+10,HALF-10), swap=Math.random()<.5;
    const px=swap?t:v, pz=swap?v:t;
    x.fillStyle='#24272b'; x.beginPath(); x.arc(W(px),W(pz),.45*k,0,7); x.fill();
    x.strokeStyle='#3c4046'; x.lineWidth=1.5; x.stroke();}
  // 汚れ・ひび
  for(let i=0;i<160;i++){x.fillStyle=`rgba(${Math.random()<.7?'0,0,0':'60,60,40'},${rnd(.05,.14)})`;
    x.beginPath();x.ellipse(rnd(S),rnd(S),rnd(3,22),rnd(3,22),rnd(3),0,7);x.fill();}
  x.strokeStyle='rgba(10,10,10,.28)'; x.lineWidth=1;
  for(let i=0;i<70;i++){let px=rnd(S),py=rnd(S);x.beginPath();x.moveTo(px,py);
    for(let s=0;s<rnd(3,6);s++){px+=rnd(-14,14);py+=rnd(-14,14);x.lineTo(px,py);}x.stroke();}
  const gtx=mkTex(c); gtx.anisotropy=8;
  const ground=new THREE.Mesh(new THREE.PlaneGeometry(T,T),new THREE.MeshStandardMaterial({map:gtx,roughness:.95}));
  ground.rotation.x=-Math.PI/2; ground.receiveShadow=true; scene.add(ground);
  const field=new THREE.Mesh(new THREE.PlaneGeometry(720,720),new THREE.MeshStandardMaterial({color:0x4a4f43,roughness:1}));
  field.rotation.x=-Math.PI/2; field.position.y=-.04; scene.add(field);
  // 郊外の木
  const trunkG=new THREE.CylinderGeometry(.15,.22,1.4,5), leafG=new THREE.IcosahedronGeometry(1.4,0);
  const trunkM=new THREE.MeshStandardMaterial({color:0x5a4634,roughness:1}), leafM=new THREE.MeshStandardMaterial({color:0x46523c,roughness:1,flatShading:true});
  for(let i=0;i<14;i++){const a=rnd(6.28), r=rnd(185,330), px=Math.cos(a)*r, pz=Math.sin(a)*r;
    const tr=new THREE.Mesh(trunkG,trunkM); tr.position.set(px,.7,pz); scene.add(tr);
    const lf=new THREE.Mesh(leafG,leafM); lf.scale.setScalar(rnd(.9,1.9)); lf.position.set(px,2.2,pz); lf.castShadow=true; scene.add(lf);}
  // 雲
  for(let i=0;i<6;i++){const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:cloudTex,transparent:true,opacity:.32,depthWrite:false,fog:false}));
    sp.position.set(rnd(-400,400),rnd(110,160),rnd(-400,400)); sp.scale.set(rnd(120,220),rnd(50,90),1); sp.userData.vx=rnd(.4,1.2); scene.add(sp); clouds.push(sp);}
})();

/* ============ 街の建造 ============ */
const aabbs=[], circles=[];
const roofMat=new THREE.MeshStandardMaterial({color:0x3b3e40,roughness:.95});
const bottomMat=new THREE.MeshStandardMaterial({color:0x2a2c26,roughness:1});
const wreckMat=new THREE.MeshStandardMaterial({color:0x221f1c,roughness:1});
const BPAL=['#8a8272','#79808a','#8f5a45','#6f7d68','#9a8e77','#68727d','#5f574c','#86705a'];

function makeFacade(len,h){
  const Wc=256, Hc=clamp(Math.round(256*h/len),56,512);
  const c=document.createElement('canvas'); c.width=Wc; c.height=Hc; const x=c.getContext('2d');
  const e=document.createElement('canvas'); e.width=Wc; e.height=Hc; const ex=e.getContext('2d');
  ex.fillStyle='#000'; ex.fillRect(0,0,Wc,Hc);
  x.fillStyle=pick(BPAL); x.fillRect(0,0,Wc,Hc);
  const gr=x.createLinearGradient(0,0,0,Hc); gr.addColorStop(0,'rgba(255,255,255,.05)'); gr.addColorStop(1,'rgba(0,0,0,.18)');
  x.fillStyle=gr; x.fillRect(0,0,Wc,Hc);
  for(let i=0;i<450;i++){x.fillStyle=Math.random()<.5?'rgba(0,0,0,.06)':'rgba(255,255,255,.05)';x.fillRect(rnd(Wc),rnd(Hc),1,1);}
  const floors=Math.max(2,Math.round(h/3.4)), cols=Math.max(2,Math.round(len/3.6));
  const cw=Wc/cols, ch=Hc/floors;
  for(let f=0;f<floors;f++)for(let col=0;col<cols;col++){
    const wx=col*cw+cw*.24, wy=f*ch+ch*.28, ww=cw*.52, wh=ch*.44;
    if(f===floors-1 && Math.random()<.45){ x.fillStyle='rgba(25,30,38,.85)'; x.fillRect(col*cw+cw*.12,f*ch+ch*.3,cw*.76,ch*.58); continue; }
    const lit=Math.random()<.09;
    x.fillStyle=lit?'#e8c887':pick(['#232a33','#28303a','#1f252d','#2b3340']);
    x.fillRect(wx,wy,ww,wh);
    x.fillStyle='rgba(0,0,0,.35)'; x.fillRect(wx-1,wy-1,ww+2,1); x.fillRect(wx-1,wy+wh,ww+2,1);
    if(lit){ ex.fillStyle='rgba(255,205,120,.9)'; ex.fillRect(wx,wy,ww,wh); }
    if(Math.random()<.12){ x.fillStyle='#6e7175'; x.fillRect(wx,wy+wh+2,ww*.7,4); }
  }
  x.fillStyle='#1c1f24'; x.fillRect(Wc/2-cw*.3,Hc-ch*.8,cw*.6,ch*.75);
  x.fillStyle='rgba(0,0,0,.25)'; x.fillRect(0,0,Wc,4);
  x.fillStyle='rgba(255,255,255,.12)'; x.fillRect(0,4,Wc,1);
  x.fillStyle='rgba(0,0,0,.28)'; x.fillRect(2,0,2,Hc); x.fillRect(Wc-4,0,2,Hc);
  x.strokeStyle='rgba(0,0,0,.1)'; x.lineWidth=1;
  for(let sx=Wc/4;sx<Wc;sx+=Wc/4){x.beginPath();x.moveTo(sx,0);x.lineTo(sx,Hc);x.stroke();}
  return {map:mkTex(c), emi:mkTex(e)};
}
function addBuilding(cx,cz,w,d,h){
  const tw=makeFacade(w,h), td=makeFacade(d,h);
  const mw=new THREE.MeshStandardMaterial({map:tw.map,emissiveMap:tw.emi,emissive:0xffffff,emissiveIntensity:.55,roughness:.92});
  const md=new THREE.MeshStandardMaterial({map:td.map,emissiveMap:td.emi,emissive:0xffffff,emissiveIntensity:.55,roughness:.92});
  const mesh=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),[md,md,roofMat,bottomMat,mw,mw]);
  mesh.position.set(cx,h/2,cz); mesh.castShadow=mesh.receiveShadow=true; scene.add(mesh);
  aabbs.push({minX:cx-w/2,maxX:cx+w/2,minZ:cz-d/2,maxZ:cz+d/2,h,bld:true});
  const add=(g,m,px,py,pz,s=1)=>{const o=new THREE.Mesh(g,m);o.position.set(px,py,pz);o.scale.setScalar(s);o.castShadow=true;scene.add(o);};
  if(Math.random()<.85) add(new THREE.BoxGeometry(1.4,.8,1),roofMat,cx+rnd(-w/4,w/4),h+.4,cz+rnd(-d/4,d/4),rnd(.8,1.6));
  if(Math.random()<.35) add(new THREE.CylinderGeometry(1,1,1.6,10),roofMat,cx+rnd(-w/4,w/4),h+.8,cz+rnd(-d/4,d/4));
  if(Math.random()<.5){const a=new THREE.Mesh(new THREE.CylinderGeometry(.05,.1,2.6,5),roofMat);
    a.position.set(cx+rnd(-w/4,w/4),h+1.3,cz+rnd(-d/4,d/4)); scene.add(a);}
}
function addRubble(x,z,r){
  const g1=new THREE.DodecahedronGeometry(1,0), g2=new THREE.BoxGeometry(1,.7,1);
  const m1=new THREE.MeshStandardMaterial({color:0x6b675e,roughness:1,flatShading:true});
  const m2=new THREE.MeshStandardMaterial({color:0x57544c,roughness:1,flatShading:true});
  for(let i=0;i<rnd(5,8);i++){const o=new THREE.Mesh(Math.random()<.5?g1:g2,Math.random()<.5?m1:m2);
    o.position.set(x+rnd(-r,r)*.7,.3+rnd(0,.5),z+rnd(-r,r)*.7);
    o.rotation.set(rnd(3),rnd(3),rnd(3)); o.scale.setScalar(rnd(.4,1.1)); o.castShadow=true; scene.add(o);}
  circles.push({x,z,r});
  if(Math.random()<.6) ambientSmoke.push({x:x+rnd(-1,1),z:z+rnd(-1,1),acc:rnd(1)});
}
function addCar(x,z,yaw){
  const g=new THREE.Group();
  const bodyC=pick(['#7a4a3a','#3e5468','#6e6e66','#555','#7d6a4a','#44503f']);
  const bm=new THREE.MeshStandardMaterial({color:bodyC,roughness:.6,metalness:.3});
  const dm=new THREE.MeshStandardMaterial({color:0x20242a,roughness:.3});
  const B=(w,h,d,m,px,py,pz,rx=0,rz=0)=>{const o=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),m);o.position.set(px,py,pz);o.rotation.x=rx;o.rotation.z=rz;g.add(o);};
  B(1.9,.72,4.4,bm,0,.62,0,0,rnd(-.05,.05));
  B(1.7,.6,2.2,dm,0,1.18,-.25,rnd(-.15,.3),rnd(-.35,.35));
  const wg=new THREE.CylinderGeometry(.32,.32,.25,8);
  const wm=new THREE.MeshStandardMaterial({color:0x1a1c1e,roughness:.9});
  for(const s of[-1,1])for(const f of[-1,1]){const o=new THREE.Mesh(wg,wm);o.position.set(s*.85,.32,f*1.5);o.rotation.z=Math.PI/2;g.add(o);}
  g.position.set(x,0,z); g.rotation.y=yaw;
  g.traverse(m=>{if(m.isMesh)m.castShadow=true;});
  scene.add(g);
  const bb=Math.abs(Math.cos(yaw))*2.3+Math.abs(Math.sin(yaw))*2.4, dd=Math.abs(Math.sin(yaw))*2.3+Math.abs(Math.cos(yaw))*2.4;
  aabbs.push({minX:x-bb/2,maxX:x+bb/2,minZ:z-dd/2,maxZ:z+dd/2,h:1.9});
}
const ambientSmoke=[];
function addLamp(x,z,dir){
  const pm=new THREE.MeshStandardMaterial({color:0x3b3e40,roughness:.7});
  const pole=new THREE.Mesh(new THREE.CylinderGeometry(.09,.13,5.4,6),pm); pole.position.set(x,2.7,z); pole.castShadow=true; scene.add(pole);
  const arm=new THREE.Mesh(new THREE.BoxGeometry(.1,.08,1.7),pm); arm.position.set(x,5.3,z+dir*.85); scene.add(arm);
  const head=new THREE.Mesh(new THREE.BoxGeometry(.55,.16,.9),new THREE.MeshStandardMaterial({color:0xd8d2b8,emissive:0xfff2cc,emissiveIntensity:.4,roughness:.4}));
  head.position.set(x,5.28,z+dir*1.6); scene.add(head);
}
function addBarrierRow(x,z,ry,n,matC){
  const m=new THREE.MeshStandardMaterial({color:matC,roughness:1});
  const g=new THREE.Group();
  for(let i=0;i<n;i++){const o=new THREE.Mesh(new THREE.BoxGeometry(3.2,.85,.9),m);o.position.set(i*3.3,0.5,0);o.castShadow=true;g.add(o);}
  g.position.set(x,0,z); g.rotation.y=ry; scene.add(g);
  aabbs.push({minX:x-5,maxX:x+5,minZ:z-1,maxZ:z+1,h:1.2});
}
/* 街区配置 */
(function buildCity(){
  const landmarks=new Set(); while(landmarks.size<4){const k=Math.floor(rnd(0,49)); if(!(k===10*0+3*7+3)) landmarks.add(k);}
  for(let i=0;i<GRID;i++)for(let j=0;j<GRID;j++){
    const cx=-132+44*i, cz=-132+44*j;
    if(i===3&&j===3){ // 中央広場(出撃地)
      addRubble(7,8,2.6); addRubble(-9,-8,2.2); addRubble(10,-6,1.8);
      addCar(3,-5,.35); addCar(-5,6,-1.2);
      addBarrierRow(2,13,.08,4,0x8a7f66); addBarrierRow(-4,-14,.5,3,0x565a5c);
      addLamp(5,-12,1); addLamp(-6,12,-1);
      continue;
    }
    const r=Math.random();
    if(r<.13){ addRubble(cx+rnd(-6,6),cz+rnd(-6,6),rnd(2,3.2));
      if(Math.random()<.6) addRubble(cx+rnd(-8,8),cz+rnd(-8,8),rnd(1.5,2.4));
      if(Math.random()<.7) addCar(cx+rnd(-4,4),cz+rnd(-4,4),rnd(3)); continue; }
    if(r<.42){ // 2棟
      addBuilding(cx-7.5,cz,12,rnd(14,20),rnd(9,20));
      addBuilding(cx+7.5,cz,12,rnd(14,20),rnd(9,20));
    }else{ // 1棟
      const tall=landmarks.has(i*7+j);
      addBuilding(cx+rnd(-1.5,1.5),cz+rnd(-1.5,1.5),rnd(16,26),rnd(16,26),tall?rnd(27,33):rnd(9,24));
    }
  }
  // 路上の車
  for(let n=0;n<20;n++){
    const i=Math.floor(rnd(0,GRID)), j=Math.floor(rnd(0,GRID));
    const a=-146+44*i, b=-146+44*j, e=Math.floor(rnd(0,4));
    if(e===0) addCar(a-1.6,rnd(b+4,b+24),0);
    else if(e===1) addCar(a+28+1.6,rnd(b+4,b+24),Math.PI);
    else if(e===2) addCar(rnd(a+4,a+24),b+1.6,Math.PI/2);
    else addCar(rnd(a+4,a+24),b-1.6,-Math.PI/2);
  }
  // 街灯
  for(let k=0;k<=GRID;k++)for(let l=0;l<=GRID;l++) if((k+l)%2===0){
    const rx=-154+44*k, rz=-154+44*l, d=Math.random()<.5?1:-1;
    addLamp(rx+8*d,rz-8*d,d); addLamp(rx-8*d,rz+8*d,-d);
  }
})();

/* ============ 戦車モデリング ============ */
const stdMat=(c,r=.85)=>new THREE.MeshStandardMaterial({color:c,roughness:r,metalness:.25});
function buildTank(o){
  const g=new THREE.Group(), tr=new THREE.Group();
  const M={hull:stdMat(o.pal.hull),dark:stdMat(o.pal.dark),track:stdMat(o.pal.track,.95),wheel:stdMat(o.pal.wheel,.9),gun:stdMat(o.pal.gun,.7),metal:stdMat('#2e3134',.55)};
  const B=(w,h,d,m,px,py,pz,rx=0,parent=g)=>{const s=new THREE.Mesh(new THREE.BoxGeometry(w,h,d),m);s.position.set(px,py,pz);s.rotation.x=rx;parent.add(s);return s;};
  const C=(rt,rb,h,m,px,py,pz,rx=0,rz=0,seg=12,parent=g)=>{const s=new THREE.Mesh(new THREE.CylinderGeometry(rt,rb,h,seg),m);s.position.set(px,py,pz);s.rotation.set(rx,0,rz);parent.add(s);return s;};
  const lw=o.lw, ld=o.ld;
  // 車体
  B(lw,1.05,ld*.98,M.hull,0,.8,0);
  B(lw*.92,.6,ld*.62,M.hull,0,1.5,-.5);
  B(lw*.92,.6,ld*.3,M.hull,0,1.18,ld*.42,-.5);
  B(.14,1.2,ld*.9,M.dark,lw/2+.07,1,0); B(.14,1.2,ld*.9,M.dark,-lw/2-.07,1,0);
  B(lw*.5,.35,1.1,M.dark,0,1.55,-ld*.5-.2);
  const hl=new THREE.MeshStandardMaterial({color:0xe8e2c8,emissive:0xfff3cf,emissiveIntensity:.5,roughness:.4});
  C(.13,.13,.2,hl,lw*.34,1.32,ld*.49,Math.PI/2,0,8); C(.13,.13,.2,hl,-lw*.34,1.32,ld*.49,Math.PI/2,0,8);
  // 履帯・車輪
  const wx=lw/2+.38;
  for(const s of[-1,1]){
    B(.78,.62,ld+.55,M.track,s*wx,.55,0);
    B(.78,.34,ld-.7,M.track,s*wx,1.35,-.25);
    C(.52,.52,.8,M.wheel,s*wx,.78,ld/2+.1,0,Math.PI/2);
    C(.52,.52,.8,M.wheel,s*wx,.78,-ld/2-.1,0,Math.PI/2);
    for(let i=0;i<6;i++) C(.46,.46,.75,M.wheel,s*wx,.55,ld/2-1-i*(ld-2.2)/5,0,Math.PI/2,10);
    for(let i=0;i<10;i++) B(.8,.16,.4,M.track,s*wx,1.56,ld/2-1.05-i*(ld-2.3)/9);
  }
  // 砲塔
  tr.position.set(0,1.95,-.35); g.add(tr);
  const TB=(w,h,d,m,px,py,pz)=>B(w,h,d,m,px,py,pz,0,tr);
  if(o.turret==='round'){
    const cyl=new THREE.Mesh(new THREE.CylinderGeometry(1.45,1.62,.75,16),M.hull); cyl.position.y=.28; tr.add(cyl);
    TB(2.3,.72,1.1,M.hull,0,.28,1.15); TB(2.1,.8,1.5,M.hull,0,.28,-1.5);
  }else{
    TB(2,.75,2.4,M.hull,0,.32,-.1); TB(1.6,.5,1,M.hull,0,.32,1.3);
  }
  TB(1.25,.85,.6,M.dark,0,.24,1.8);                       // マンレット
  const gl=o.gunLen;
  C(.11,.11,gl,M.gun,0,.24,1.8+gl/2,Math.PI/2,0,10,tr);   // 主砲
  C(.16,.16,.7,M.gun,0,.24,1.8+gl*.6,Math.PI/2,0,10,tr);  // 排煙器
  C(.14,.14,.5,M.dark,0,.24,1.8+gl+.15,Math.PI/2,0,10,tr);
  C(.025,.025,1.3,M.metal,0,.4,1.8+gl+.5,Math.PI/2,0,6,tr);
  C(.05,.05,1.1,M.metal,.78,.16,1.9,Math.PI/2,0,8,tr);    // 同軸機関銃
  const cup=new THREE.Mesh(new THREE.CylinderGeometry(.42,.46,.5,10),M.dark); cup.position.set(-.55,.95,-.45); tr.add(cup);
  const hat=new THREE.Mesh(new THREE.CylinderGeometry(.36,.36,.09,10),M.metal); hat.position.set(-.55,1.22,-.45); tr.add(hat);
  const ant=new THREE.Mesh(new THREE.CylinderGeometry(.015,.03,2.3,5),M.metal); ant.position.set(.95,1,-1.2); ant.rotation.x=.12; tr.add(ant);
  if(o.stow) for(let i=0;i<3;i++) C(.11,.11,2.4,M.dark,lw/2+.28,2,-.9-i*.4,0,Math.PI/2,8,tr);
  const mz=new THREE.Object3D(); mz.position.set(0,.24,1.8+gl+.7); tr.add(mz);
  g.traverse(m=>{if(m.isMesh){m.castShadow=true;}});
  return {g,tr,mz};
}
class Tank{
  constructor(cfg){
    const m=buildTank(cfg);
    this.g=m.g; this.tr=m.tr; this.mz=m.mz;
    this.pos=this.g.position;
    this.hullYaw=0; this.tLocal=0; this.kick=0;
    this.speed=0; this.throttle=0; this.steer=0;
    this.r=cfg.r; this.maxSpd=cfg.speed; this.turn=cfg.turn; this.st=cfg.st||null;
    this.hp=cfg.hp; this.maxhp=cfg.hp;
    this.reload=0; this.dead=false;
    this.vel=new THREE.Vector3(); this.prev=this.pos.clone();
    this.lastX=0; this.lastZ=0; this.stuck=0; this.rev=0;
    scene.add(this.g);
  }
  drive(dt){
    if(dt<=0) return;
    this.speed+=this.throttle*(this.throttle>0?9:6)*dt;
    this.speed-=this.speed*Math.min(1,1.8*dt);
    this.speed=clamp(this.speed,-this.maxSpd*.45,this.maxSpd);
    const sf=clamp(Math.abs(this.speed)/9,0,1);
    this.hullYaw+=this.steer*this.turn*sf*(this.speed<0?-1:1)*dt;
    const fx=Math.sin(this.hullYaw), fz=Math.cos(this.hullYaw);
    this.pos.x+=fx*this.speed*dt; this.pos.z+=fz*this.speed*dt;
    collide(this);
    this.pos.x=clamp(this.pos.x,-HALF+3,HALF-3);
    this.pos.z=clamp(this.pos.z,-HALF+3,HALF-3);
    this.vel.set((this.pos.x-this.prev.x)/dt,0,(this.pos.z-this.prev.z)/dt);
    this.prev.copy(this.pos);
    this.g.rotation.y=this.hullYaw;
    this.tr.rotation.y=this.tLocal+this.kick;
    this.kick*=Math.exp(-7*dt);
  }
}
function collide(t){
  for(const b of aabbs){
    const cx=clamp(t.pos.x,b.minX,b.maxX), cz=clamp(t.pos.z,b.minZ,b.maxZ);
    let dx=t.pos.x-cx, dz=t.pos.z-cz; const d2=dx*dx+dz*dz;
    if(d2<t.r*t.r){ let d=Math.sqrt(d2);
      if(d<1e-4){dx=1;dz=0;d=1;} else {dx/=d;dz/=d;}
      t.pos.x=cx+dx*t.r; t.pos.z=cz+dz*t.r; }
  }
  for(const c of circles){
    const dx=t.pos.x-c.x, dz=t.pos.z-c.z, rr=t.r+c.r, d2=dx*dx+dz*dz;
    if(d2<rr*rr){ const d=Math.sqrt(d2)||1e-4; t.pos.x=c.x+dx/d*rr; t.pos.z=c.z+dz/d*rr; }
  }
}
function separate(a,b){
  const dx=b.pos.x-a.pos.x, dz=b.pos.z-a.pos.z, rr=a.r+b.r, d2=dx*dx+dz*dz;
  if(d2<rr*rr&&d2>1e-6){ const d=Math.sqrt(d2), p=(rr-d)/2, nx=dx/d, nz=dz/d;
    a.pos.x-=nx*p; a.pos.z-=nz*p; b.pos.x+=nx*p; b.pos.z+=nz*p; }
}
function segAABB(ax,az,bx,bz,b){
  const dx=bx-ax, dz=bz-az; let tmin=0,tmax=1;
  if(Math.abs(dx)<1e-9){ if(ax<b.minX||ax>b.maxX) return false; }
  else{ let t1=(b.minX-ax)/dx,t2=(b.maxX-ax)/dx; if(t1>t2){const t=t1;t1=t2;t2=t;} tmin=Math.max(tmin,t1); tmax=Math.min(tmax,t2); if(tmin>tmax) return false; }
  if(Math.abs(dz)<1e-9){ if(az<b.minZ||az>b.maxZ) return false; }
  else{ let t1=(b.minZ-az)/dz,t2=(b.maxZ-az)/dz; if(t1>t2){const t=t1;t1=t2;t2=t;} tmin=Math.max(tmin,t1); tmax=Math.min(tmax,t2); if(tmin>tmax) return false; }
  return true;
}
function segCircle(ax,az,bx,bz,c){
  const abx=bx-ax, abz=bz-az; const t=clamp(((c.x-ax)*abx+(c.z-az)*abz)/(abx*abx+abz*abz),0,1);
  const dx=c.x-(ax+abx*t), dz=c.z-(az+abz*t);
  return dx*dx+dz*dz<c.r*c.r;
}
function los(ax,az,bx,bz){
  for(const b of aabbs) if(segAABB(ax,az,bx,bz,b)) return false;
  for(const c of circles) if(segCircle(ax,az,bx,bz,c)) return false;
  return true;
}

/* ============ 兵装 ============ */
const player=new Tank({lw:4.4,ld:7.2,gunLen:5.2,r:2.3,speed:13,turn:1.05,hp:220,turret:'round',stow:true,
  pal:{hull:'#67714f',dark:'#454b36',track:'#20241c',wheel:'#31362a',gun:'#5a6152'}});
player.pos.set(0,0,0); player.hullYaw=Math.PI; player.prev.set(0,0,0);
player.ammoType='ap'; player.heAmmo=8; player.mgCd=0;
const LCFG={lw:3.3,ld:5.4,gunLen:3.2,r:1.8,speed:8.5,turn:1.25,hp:60,turret:'box',stow:false,
  pal:{hull:'#4d5a4e',dark:'#353e37',track:'#1d211d',wheel:'#2e342e',gun:'#48524a'},
  st:{dmg:10,reload:1.5,err:.1,shellSpd:75,tRate:1.7,score:100}};
const HCFG={lw:4.1,ld:6.6,gunLen:4.6,r:2.1,speed:5.8,turn:.8,hp:135,turret:'round',stow:true,
  pal:{hull:'#7a7259',dark:'#4f4a3a',track:'#24231b',wheel:'#3a372c',gun:'#6b644f'},
  st:{dmg:18,reload:2.6,err:.055,shellSpd:85,tRate:1.25,score:150}};
const NAMES={light:['BMP-2','PT-76','BTR-80','T-55'],heavy:['T-72','T-80U','T-90','T-62']};
const enemies=[];
function spawnEnemy(type){
  const e=new Tank(type==='heavy'?HCFG:LCFG);
  e.type=type; e.name=pick(NAMES[type]);
  for(let i=0;i<24;i++){
    const kx=Math.floor(rnd(0,GRID+1)), lz=Math.floor(rnd(0,GRID+1));
    let x=-154+44*kx, z=Math.random()<.5 ? -154+44*lz : rnd(-HALF+12,HALF-12);
    if(Math.hypot(x-player.pos.x,z-player.pos.z)<85) continue;
    if(aabbs.some(b=>x>b.minX-2&&x<b.maxX+2&&z>b.minZ-2&&z<b.maxZ+2)) continue;
    e.pos.set(x,0,z); e.lastX=x; e.lastZ=z; e.hullYaw=rnd(6.28); e.reload=rnd(.5,1.5); break;
  }
  enemies.push(e);
}

/* ============ 砲弾 ============ */
const shells=[];
const shellGeoAP=new THREE.SphereGeometry(.09,8,8), shellGeoHE=new THREE.SphereGeometry(.13,8,8);
const matAPp=new THREE.MeshBasicMaterial({color:0xffd27a}), matAPe=new THREE.MeshBasicMaterial({color:0xff7a4d});
const matHE=new THREE.MeshBasicMaterial({color:0xffb36a});
function spawnShell(p,v,dmg,type,owner){
  const mesh=new THREE.Mesh(type==='he'?shellGeoHE:shellGeoAP, owner==='p'?(type==='he'?matHE:matAPp):matAPe);
  const glow=new THREE.Sprite(new THREE.SpriteMaterial({map:pTex,color:owner==='p'?0xffcf8a:0xff8a5a,transparent:true,opacity:.8,blending:THREE.AdditiveBlending,depthWrite:false}));
  glow.scale.set(.9,.9,1); mesh.add(glow);
  mesh.position.copy(p); scene.add(mesh);
  shells.push({p:p.clone(),v,dmg,type,owner,life:4,mesh,impact:false});
}
/* ============ パーティクル / FX ============ */
const pPool=[], pLive=[];
function spawnP(type,x,y,z,o={}){
  let s=pPool.pop();
  if(!s){ if(pLive.length>=320) return;
    s=new THREE.Sprite(new THREE.SpriteMaterial({map:pTex,transparent:true,depthWrite:false})); scene.add(s); }
  const u=s.userData;
  Object.assign(u,{type,life:0,max:o.life||1,s0:o.s0??1,s1:o.s1??1.5,vx:o.vx||0,vy:o.vy||0,vz:o.vz||0,
    grav:o.grav||0,drag:o.drag||1,op:o.op||.8});
  u.life=0;
  s.material.color.set(o.col||'#888');
  s.material.blending=o.add?THREE.AdditiveBlending:THREE.NormalBlending;
  s.position.set(x,y,z); s.visible=true;
  pLive.push(s);
}
const P={
  smoke:(x,y,z,o={})=>spawnP('smoke',x,y,z,Object.assign({s0:1,s1:3.4,life:rnd(1.3,2.5),vy:rnd(1,2),drag:1.4,op:.45,col:'#4a4a48'},o)),
  dust:(x,y,z,o={})=>spawnP('dust',x,y,z,Object.assign({s0:.5,s1:2.2,life:rnd(.6,1.1),vy:.8,drag:2,op:.4,col:'#7d7466'},o)),
  spark:(x,y,z,o={})=>spawnP('spark',x,y,z,Object.assign({add:true,s0:.3,s1:.1,life:rnd(.25,.5),grav:9,vy:2,drag:2,op:1,col:'#ffbe6e'},o)),
  fire:(x,y,z,o={})=>spawnP('fire',x,y,z,Object.assign({add:true,s0:.7,s1:1.6,life:rnd(.25,.4),vy:1.5,drag:1,op:.9,col:'#ff7a2a'},o)),
  flash:(x,y,z,o={})=>spawnP('flash',x,y,z,Object.assign({add:true,s0:2.2,s1:1.2,life:.07,op:1,col:'#fff2c8'},o)),
};
function sparkFX(p,n=6){for(let i=0;i<n;i++)P.spark(p.x+rnd(-.3,.3),p.y,p.z+rnd(-.3,.3));}
function dustFX(p,n=5){for(let i=0;i<n;i++)P.dust(p.x+rnd(-.8,.8),.2,p.z+rnd(-.8,.8));}
function flashFX(p,s=1){P.flash(p.x,p.y,p.z,{s0:1.6*s+.6,s1:.8,life:.07});
  flashLight.position.copy(p); flashLight.intensity=Math.max(flashLight.intensity,70*s);}
const debris=[], rings=[], decals=[];
const debGeo=new THREE.BoxGeometry(.35,.25,.35), debMat=new THREE.MeshStandardMaterial({color:0x2e2b27,roughness:1});
const ringGeo=new THREE.RingGeometry(.4,.55,28);
function explosionFx(p,s=1){
  for(let i=0;i<3;i++)P.flash(p.x+rnd(-.5,.5)*s,1.2+rnd(.5),p.z+rnd(-.5,.5)*s,{s0:2.5*s,s1:1.4,life:.1});
  for(let i=0;i<9*s;i++)P.fire(p.x+rnd(-1.5,1.5)*s,1.3,p.z+rnd(-1.5,1.5)*s,{vx:rnd(-4,4),vy:rnd(1,4),vz:rnd(-4,4),col:Math.random()<.5?'#ff7a2a':'#ffb04a'});
  for(let i=0;i<11*s;i++)P.smoke(p.x+rnd(-1.2,1.2)*s,1.4,p.z+rnd(-1.2,1.2)*s,{vx:rnd(-1.5,1.5),vy:rnd(1.2,2.6),vz:rnd(-1.5,1.5),col:pick(['#4a4a48','#3c3f42','#55524c'])});
  for(let i=0;i<8*s;i++){const m=new THREE.Mesh(debGeo,debMat);m.position.set(p.x,1.4,p.z);
    scene.add(m); debris.push({m,v:new THREE.Vector3(rnd(-7,7),rnd(4,11),rnd(-7,7)),rs:rnd(-6,6),life:rnd(.9,1.5)});}
  const rm=new THREE.Mesh(ringGeo,new THREE.MeshBasicMaterial({color:0xe8d9b8,transparent:true,opacity:.7,side:THREE.DoubleSide}));
  rm.rotation.x=-Math.PI/2; rm.position.set(p.x,.06,p.z); scene.add(rm); rings.push({m:rm,t:0,s});
}
function addDecal(p){
  if(decals.length>=40) return;
  const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:scorchTex,transparent:true,opacity:.75,depthWrite:false}));
  sp.position.set(p.x,.05,p.z); sp.material.rotation=rnd(6.28); sp.scale.set(1.6,1.6,1); scene.add(sp);
  decals.push({sp,t:0});
}
function updBursts(dt){
  for(let i=pLive.length-1;i>=0;i--){
    const s=pLive[i], u=s.userData; u.life+=dt;
    const k=u.life/u.max;
    if(k>=1){s.visible=false;pLive.splice(i,1);pPool.push(s);continue;}
    u.vy+=u.grav*dt;
    s.position.x+=u.vx*dt; s.position.y+=u.vy*dt; s.position.z+=u.vz*dt;
    const dr=Math.max(0,1-u.drag*dt); u.vx*=dr; u.vz*=dr;
    const sc=THREE.MathUtils.lerp(u.s0,u.s1,k); s.scale.set(sc,sc,1);
    s.material.opacity=u.type==='smoke'?u.op*Math.min(1,k*4)*(1-k):u.op*(1-k);
  }
  for(let i=debris.length-1;i>=0;i--){const d=debris[i];
    d.v.y-=18*dt; d.m.position.addScaledVector(d.v,dt);
    if(d.m.position.y<.15){d.m.position.y=.15;d.v.y*=-.3;d.v.x*=.7;}
    d.m.rotation.x+=d.rs*dt; d.m.rotation.y+=d.rs*dt;
    d.life-=dt; d.m.scale.setScalar(clamp(d.life/.3,0,1));
    if(d.life<=0){scene.remove(d.m);debris.splice(i,1);}}
  for(let i=rings.length-1;i>=0;i--){const r=rings[i]; r.t+=dt; const k=r.t/.55;
    r.m.scale.setScalar(1+k*16*r.s); r.m.material.opacity=.65*(1-k);
    if(k>=1){scene.remove(r.m);rings.splice(i,1);}}
  for(let i=decals.length-1;i>=0;i--){const d=decals[i]; d.t+=dt;
    d.sp.material.opacity=.75*Math.max(0,1-d.t/45);
    if(d.t>45){scene.remove(d.sp);decals.splice(i,1);}}
}
/* 焼死体 */
const burning=[];
function wreckify(t){
  t.g.traverse(m=>{if(m.isMesh)m.material=wreckMat;});
  t.tr.rotation.x=rnd(-.15,.15);
  burning.push({x:t.pos.x,z:t.pos.z,t:0,dur:rnd(9,20),acc:0,acc2:0});
  if(burning.length>10) burning[0].dur=0;
  circles.push({x:t.pos.x,z:t.pos.z,r:2.4});
}
function updateBurning(dt){
  for(const b of burning){
    b.t+=dt; b.acc+=dt;
    if(b.t<b.dur){
      if(b.acc>.07){b.acc=0;
        P.smoke(b.x+rnd(-1,1),1.6,b.z+rnd(-1,1),{vy:rnd(1,2),s0:1,s1:3.2,life:rnd(1.2,2.2),col:'#33363a'});
        if(Math.random()<.5)P.fire(b.x+rnd(-1,1),1.4,b.z+rnd(-1,1),{s0:.6,s1:1.4,life:.3});}
    }else{
      b.acc2+=dt;
      if(b.acc2>1.4){b.acc2=0;P.smoke(b.x+rnd(-.8,.8),1.4,b.z+rnd(-.8,.8),{vy:.8,s0:.8,s1:2.4,life:2,col:'#3a3d40',op:.3});}
    }
  }
  for(const a of ambientSmoke){ a.acc+=dt;
    if(a.acc>.45){a.acc=0;P.smoke(a.x,1.2,a.z,{vy:.9,s0:.9,s1:2.8,life:2,col:'#3f4245',op:.25});} }
}

/* ============ 音響 ============ */
const AU={
  ok:false,
  init(){ if(this.ok) return; try{
    const C=this.ctx=new (window.AudioContext||window.webkitAudioContext)();
    this.master=C.createGain(); this.master.gain.value=.85;
    const comp=C.createDynamicsCompressor(); this.master.connect(comp); comp.connect(C.destination);
    this.bus=C.createGain(); this.bus.connect(this.master);
    const dl=C.createDelay(1); dl.delayTime.value=.16;
    const fb=C.createGain(); fb.gain.value=.22; const wet=C.createGain(); wet.gain.value=.16;
    this.bus.connect(dl); dl.connect(fb); fb.connect(dl); dl.connect(wet); wet.connect(this.master);
    const nb=C.createBuffer(1,C.sampleRate,C.sampleRate); const d=nb.getChannelData(0);
    for(let i=0;i<d.length;i++)d[i]=Math.random()*2-1; this.noise=nb;
    const o1=C.createOscillator(); o1.type='sawtooth'; o1.frequency.value=46;
    const o2=C.createOscillator(); o2.type='sawtooth'; o2.frequency.value=46.7;
    const ef=C.createBiquadFilter(); ef.type='lowpass'; ef.frequency.value=240;
    const eg=C.createGain(); eg.gain.value=0;
    o1.connect(ef); o2.connect(ef); ef.connect(eg); eg.connect(this.bus); o1.start(); o2.start();
    this.eo=[o1,o2]; this.eg=eg;
    const ws=C.createBufferSource(); ws.buffer=nb; ws.loop=true;
    const wf=C.createBiquadFilter(); wf.type='lowpass'; wf.frequency.value=320;
    const wg=C.createGain(); wg.gain.value=.02;
    ws.connect(wf); wf.connect(wg); wg.connect(this.bus); ws.start();
    this.ok=true;
  }catch(e){} },
  env(g,t,a,d,v){g.gain.setValueAtTime(0,t);g.gain.linearRampToValueAtTime(v,t+a);g.gain.exponentialRampToValueAtTime(.001,t+a+d);},
  fireMain(dist){ if(!this.ok)return; const C=this.ctx,t=C.currentTime,g=clamp(1.1-dist/140,.05,1);
    const o=C.createOscillator(); o.type='sine'; o.frequency.setValueAtTime(150,t); o.frequency.exponentialRampToValueAtTime(38,t+.25);
    const og=C.createGain(); this.env(og,t,.005,.35,.9*g); o.connect(og); og.connect(this.bus); o.start(t); o.stop(t+.4);
    const n=C.createBufferSource(); n.buffer=this.noise;
    const f=C.createBiquadFilter(); f.type='lowpass'; f.frequency.setValueAtTime(900,t); f.frequency.exponentialRampToValueAtTime(120,t+.3);
    const ng=C.createGain(); this.env(ng,t,.002,.3,.7*g); n.connect(f); f.connect(ng); ng.connect(this.bus); n.start(t); n.stop(t+.35); },
  mg(dist){ if(!this.ok)return; const C=this.ctx,t=C.currentTime,g=clamp(1.1-dist/120,.04,1)*.35;
    const n=C.createBufferSource(); n.buffer=this.noise;
    const f=C.createBiquadFilter(); f.type='bandpass'; f.frequency.value=1400; f.Q.value=1.2;
    const ng=C.createGain(); this.env(ng,t,.002,.06,g); n.connect(f); f.connect(ng); ng.connect(this.bus); n.start(t); n.stop(t+.08);
    const o=C.createOscillator(); o.type='square'; o.frequency.setValueAtTime(200,t); o.frequency.exponentialRampToValueAtTime(80,t+.04);
    const og=C.createGain(); this.env(og,t,.002,.05,g*.4); o.connect(og); og.connect(this.bus); o.start(t); o.stop(t+.06); },
  explosion(dist,s){ if(!this.ok)return; const C=this.ctx,t=C.currentTime,g=clamp(1.3-dist/130,.06,1)*s;
    const n=C.createBufferSource(); n.buffer=this.noise;
    const f=C.createBiquadFilter(); f.type='lowpass'; f.frequency.setValueAtTime(1200,t); f.frequency.exponentialRampToValueAtTime(50,t+1.1);
    const ng=C.createGain(); this.env(ng,t,.01,1.1,1.1*g); n.connect(f); f.connect(ng); ng.connect(this.bus); n.start(t); n.stop(t+1.2);
    const o=C.createOscillator(); o.type='sine'; o.frequency.setValueAtTime(60,t); o.frequency.exponentialRampToValueAtTime(26,t+.7);
    const og=C.createGain(); this.env(og,t,.01,.8,1*g); o.connect(og); og.connect(this.bus); o.start(t); o.stop(t+.9); },
  hit(dist){ if(!this.ok)return; const C=this.ctx,t=C.currentTime,g=clamp(1.2-dist/100,.05,1);
    const o=C.createOscillator(); o.type='triangle'; o.frequency.setValueAtTime(340,t); o.frequency.exponentialRampToValueAtTime(140,t+.09);
    const og=C.createGain(); this.env(og,t,.002,.12,.3*g); o.connect(og); og.connect(this.bus); o.start(t); o.stop(t+.14);
    const n=C.createBufferSource(); n.buffer=this.noise;
    const f=C.createBiquadFilter(); f.type='highpass'; f.frequency.value=2500;
    const ng=C.createGain(); this.env(ng,t,.001,.05,.25*g); n.connect(f); f.connect(ng); ng.connect(this.bus); n.start(t); n.stop(t+.07); },
  click(){ if(!this.ok)return; const C=this.ctx,t=C.currentTime;
    const o=C.createOscillator(); o.type='square'; o.frequency.value=900;
    const og=C.createGain(); this.env(og,t,.001,.04,.08); o.connect(og); og.connect(this.bus); o.start(t); o.stop(t+.05); },
  engine(speed,thr,on){ if(!this.ok)return; const t=this.ctx.currentTime,f=42+Math.abs(speed)*2.6;
    this.eo[0].frequency.setTargetAtTime(f,t,.1); this.eo[1].frequency.setTargetAtTime(f*1.03,t,.1);
    this.eg.gain.setTargetAtTime(on?.035+Math.abs(thr)*.05:0,t,.15); }
};

/* ============ 入力 ============ */
const k={}, mouseNdc=new THREE.Vector2();
let mDownL=false, mDownR=false, camMode=0, state='brief';
addEventListener('keydown',e=>{
  k[e.code]=true;
  if(e.code==='Space') e.preventDefault();
  if(e.code==='KeyC'&&state==='play'){camMode=1-camMode;$('camname').textContent=camMode?'追従 3RD':'一人称 FPV';AU.click();}
  if(e.code==='KeyQ'&&state==='play') toggleAmmo();
  if(e.code==='Escape') togglePause();
  if(e.code==='Space'&&state==='play') tryMain();
});
addEventListener('keyup',e=>k[e.code]=false);
addEventListener('pointermove',e=>{
  mouseNdc.set(e.clientX/innerWidth*2-1,-(e.clientY/innerHeight)*2+1);
  const xh=$('xh'); xh.style.left=e.clientX+'px'; xh.style.top=e.clientY+'px';
});
addEventListener('pointerdown',e=>{
  if(state!=='play') return;
  if(e.button===0){mDownL=true;tryMain();}
  if(e.button===2)mDownR=true;
});
addEventListener('pointerup',e=>{if(e.button===0)mDownL=false;if(e.button===2)mDownR=false;});
addEventListener('blur',()=>{if(state==='play')togglePause();});
addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});

/* ============ HUD ============ */
const CAPS={0:'N',45:'NE',90:'E',135:'SE',180:'S',225:'SW',270:'W',315:'NW'};
(function buildCompass(){
  const PXc=3; let h='';
  for(let d=0;d<720;d+=5){
    const g=d%360;
    h+=`<i class="${g%30===0?'maj':g%10===0?'mid':''}" style="left:${d*PXc}px"></i>`;
    if(g%45===0) h+=`<b class="cap" style="left:${d*PXc}px">${CAPS[g]}</b>`;
    else if(g%30===0) h+=`<b style="left:${d*PXc}px">${String(g).padStart(3,'0')}</b>`;
  }
  $('ctape').innerHTML=h;
})();
const PXc=3;
const headingDeg=yaw=>((Math.atan2(Math.sin(yaw),-Math.cos(yaw))/D2R)%360+360)%360;
/* レーダー */
const rctx=$('radar').getContext('2d');
const radarStatic=(()=>{const c=document.createElement('canvas');c.width=c.height=168;const x=c.getContext('2d');
  const s=168/T;
  x.fillStyle='rgba(110,122,86,.55)';
  for(const b of aabbs) if(b.bld) x.fillRect((b.minX+HALF)*s,(b.minZ+HALF)*s,(b.maxX-b.minX)*s,(b.maxZ-b.minZ)*s);
  return c;})();
function drawRadar(){
  const s=168/T;
  rctx.fillStyle='#0e120b'; rctx.fillRect(0,0,168,168);
  rctx.strokeStyle='rgba(120,140,90,.12)'; rctx.lineWidth=1;
  for(let i=1;i<4;i++){rctx.beginPath();rctx.moveTo(i*42,0);rctx.lineTo(i*42,168);rctx.stroke();
    rctx.beginPath();rctx.moveTo(0,i*42);rctx.lineTo(168,i*42);rctx.stroke();}
  rctx.drawImage(radarStatic,0,0);
  for(const e of enemies){
    const px=(e.pos.x+HALF)*s, py=(e.pos.z+HALF)*s;
    rctx.fillStyle=`rgba(255,80,60,${.6+.4*Math.sin(tGlobal*6)})`;
    rctx.beginPath(); rctx.arc(px,py,2.6,0,7); rctx.fill();
  }
  if(!player.dead){
    const px=(player.pos.x+HALF)*s, py=(player.pos.z+HALF)*s;
    const fx=Math.sin(player.hullYaw), fz=Math.cos(player.hullYaw);
    rctx.save(); rctx.translate(px,py); rctx.rotate(Math.atan2(fx,-fz));
    rctx.fillStyle='#ffb454'; rctx.beginPath();
    rctx.moveTo(0,-6); rctx.lineTo(4,5); rctx.lineTo(0,3); rctx.lineTo(-4,5); rctx.closePath(); rctx.fill();
    rctx.restore();
  }
}
function banner(main,sub){ $('bmain').textContent=main; $('bsub').textContent=sub||'';
  const b=$('banner'); b.classList.remove('show'); void b.offsetWidth; b.classList.add('show'); }
function feed(html){ const d=document.createElement('div'); d.className='fi'; d.innerHTML=html;
  $('feed').prepend(d); while($('feed').children.length>5) $('feed').lastChild.remove();
  setTimeout(()=>d.classList.add('out'),3200); setTimeout(()=>d.remove(),3900); }
function dmgFlash(){ const d=$('dmgf'); d.classList.remove('on'); void d.offsetWidth; d.classList.add('on'); }
let hitT=null;
function hitMark(){ const x=$('xh'); x.classList.add('hit'); clearTimeout(hitT); hitT=setTimeout(()=>x.classList.remove('hit'),120); }
function xhKick(){ const x=$('xhin'); x.classList.add('kick'); setTimeout(()=>x.classList.remove('kick'),90); }
function toggleAmmo(){
  if(player.ammoType==='ap'){
    if(player.heAmmo>0){player.ammoType='he';}
  }else player.ammoType='ap';
  $('apill').classList.toggle('on',player.ammoType==='ap');
  $('hepill').classList.toggle('on',player.ammoType==='he');
  $('xh').classList.toggle('he',player.ammoType==='he');
  AU.click();
}

/* ============ 戦闘ロジック ============ */
let kills=0, score=0, playT=0, mainFired=0, mainHits=0, mgFired=0, mgHits=0;
let shake=0, dieT=0;
function tryMain(){
  if(state!=='play'||player.reload>0) return;
  if(player.ammoType==='he'&&player.heAmmo<=0){toggleAmmo();}
  const he=player.ammoType==='he';
  if(he) player.heAmmo--;
  player.reload=he?3.2:2.3;
  const mw=new THREE.Vector3(); player.mz.getWorldPosition(mw);
  const yaw=player.hullYaw+player.tLocal+rnd(-.004,.004);
  spawnShell(mw,new THREE.Vector3(Math.sin(yaw),0,Math.cos(yaw)).multiplyScalar(he?90:115),he?55:30,he?'he':'ap','p');
  player.kick=.07; shake=Math.min(shake+.4,1);
  flashFX(mw,1); AU.fireMain(0); mainFired++; xhKick();
}
function fireMG(){
  const mw=new THREE.Vector3(); player.mz.getWorldPosition(mw);
  const yaw=player.hullYaw+player.tLocal+rnd(-.012,.012);
  spawnShell(mw,new THREE.Vector3(Math.sin(yaw),0,Math.cos(yaw)).multiplyScalar(160),4,'mg','p');
  player.mgCd=.09; player.kick+=.012; shake=Math.min(shake+.04,.6);
  flashFX(mw,.4); AU.mg(0); mgFired++;
}
function splash(s){
  const P=s.p;
  explosionFx(P,.9);
  for(const e of enemies){ if(e.dead) continue;
    const d=Math.hypot(e.pos.x-P.x,e.pos.z-P.z);
    if(d<7) hitEnemy(e,55*clamp(1-d/7,0,1)); }
  if(!player.dead){ const d=Math.hypot(player.pos.x-P.x,player.pos.z-P.z);
    if(d<7) damagePlayer(44*clamp(1-d/7,0,1)); }
}
function hitEnemy(e,dmg){
  if(e.dead) return;
  e.hp-=dmg; sparkFX(e.pos.clone().setY(2)); hitMark(); AU.hit(0);
  if(e.hp<=0){
    e.dead=true; enemies.splice(enemies.indexOf(e),1);
    kills++; score+=e.st.score;
    feed(`撃破 <b>${e.name}</b> <b>+${e.st.score}</b>`);
    explosionFx(e.pos.clone(),e.type==='heavy'?1.3:1);
    AU.explosion(e.pos.distanceTo(player.pos),e.type==='heavy'?1.3:1);
    wreckify(e); shake=Math.min(shake+.3,1);
  }
}
function damagePlayer(dmg){
  if(player.dead||state!=='play') return;
  player.hp=Math.max(0,player.hp-dmg);
  dmgFlash(); shake=Math.min(shake+.35,1); AU.hit(0);
  if(player.hp<=0) playerDie();
}
function playerDie(){
  player.dead=true;
  explosionFx(player.pos.clone(),1.6);
  AU.explosion(0,1.6);
  wreckify(player); shake=1.5;
  state='dying'; dieT=2.2;
}
function updateEnemy(e,dt){
  if(player.dead){ e.throttle=0; e.steer=0; e.drive(dt); return; }
  e.reload=Math.max(0,e.reload-dt);
  const p=player.pos, ep=e.pos, st=e.st;
  const dx=p.x-ep.x, dz=p.z-ep.z, dist=Math.max(.01,Math.hypot(dx,dz));
  let desX=dx/dist, desZ=dz/dist;
  if(dist<26){desX*=.4;desZ*=.4;}
  let rx=0,rz=0;
  for(const b of aabbs){
    const cx=clamp(ep.x,b.minX,b.maxX), cz=clamp(ep.z,b.minZ,b.maxZ);
    let ox=ep.x-cx, oz=ep.z-cz; const d2=ox*ox+oz*oz;
    if(d2<196&&d2>.0001){const d=Math.sqrt(d2),f=1-d/14;rx+=ox/d*f;rz+=oz/d*f;}
  }
  for(const c of circles){
    const ox=ep.x-c.x, oz=ep.z-c.z, d2=ox*ox+oz*oz, R=c.r+12;
    if(d2<R*R&&d2>.0001){const d=Math.sqrt(d2),f=clamp(1-d/R,0,1);rx+=ox/d*f;rz+=oz/d*f;}
  }
  const moved=Math.hypot(ep.x-e.lastX,ep.z-e.lastZ);
  if(e.throttle>.5&&moved<e.speed*dt*.35) e.stuck+=dt; else e.stuck=0;
  if(e.stuck>1.1){e.rev=1.3;e.stuck=0;}
  if(e.rev>0){ e.rev-=dt; e.throttle=-.8; e.steer=0; }
  else{
    e.throttle=1;
    const tx=Math.atan2(desX+rx*1.9,desZ+rz*1.9);
    const d=wrapA(tx-e.hullYaw);
    e.hullYaw+=clamp(d,-e.turn*dt,e.turn*dt);
    e.steer=clamp(d*2,-1,1);
  }
  e.drive(dt); e.lastX=ep.x; e.lastZ=ep.z;
  const lead=dist/st.shellSpd;
  const ax=p.x+player.vel.x*lead, az=p.z+player.vel.z*lead;
  let dl=wrapA(Math.atan2(ax-ep.x,az-ep.z)-e.hullYaw); dl=clamp(dl,-2.4,2.4);
  e.tLocal+=clamp(dl-e.tLocal,-st.tRate*dt,st.tRate*dt);
  if(e.reload<=0&&dist<95&&dist>10&&Math.abs(e.tLocal-dl)<st.err&&los(ep.x,ep.z,p.x,p.z)){
    e.reload=st.reload*rnd(.85,1.25);
    const mw=new THREE.Vector3(); e.mz.getWorldPosition(mw);
    const ty=e.hullYaw+e.tLocal+rnd(-st.err,st.err)*.5;
    spawnShell(mw,new THREE.Vector3(Math.sin(ty),0,Math.cos(ty)).multiplyScalar(st.shellSpd),st.dmg,'ap','e');
    flashFX(mw,.7); AU.fireMain(ep.distanceTo(p));
  }
}
function updShells(dt){
  for(let i=shells.length-1;i>=0;i--){
    const s=shells[i];
    s.p.addScaledVector(s.v,dt); s.life-=dt;
    let kill=s.life<=0||Math.abs(s.p.x)>HALF+5||Math.abs(s.p.z)>HALF+5;
    if(!kill&&s.owner==='p'){
      for(const e of enemies){ if(e.dead) continue;
        const dx=e.pos.x-s.p.x, dz=e.pos.z-s.p.z;
        if(dx*dx+dz*dz<2.4*2.4){
          s.impact=true;
          if(s.type==='mg') mgHits++; else mainHits++;
          hitEnemy(e,s.dmg); kill=true; break;
        }}
    }else if(!kill&&s.owner==='e'&&!player.dead){
      const dx=player.pos.x-s.p.x, dz=player.pos.z-s.p.z;
      if(dx*dx+dz*dz<2.5*2.5){ s.impact=true; sparkFX(s.p); damagePlayer(s.dmg); kill=true; }
    }
    if(!kill){
      for(const b of aabbs){
        if(s.p.x>b.minX&&s.p.x<b.maxX&&s.p.z>b.minZ&&s.p.z<b.maxZ){
          s.impact=true; sparkFX(s.p); dustFX(s.p); addDecal(s.p); AU.hit(s.p.distanceTo(player.pos)); kill=true; break; }}
      if(!kill) for(const c of circles){
        const dx=c.x-s.p.x, dz=c.z-s.p.z;
        if(dx*dx+dz*dz<c.r*c.r){ s.impact=true; sparkFX(s.p); dustFX(s.p); addDecal(s.p); AU.hit(s.p.distanceTo(player.pos)); kill=true; break; }}
    }
    if(kill){
      if(s.type==='he'&&s.impact) splash(s);
      scene.remove(s.mesh); shells.splice(i,1);
    }else s.mesh.position.copy(s.p);
  }
}

/* ============ 波(ウェーブ) ============ */
let waveN=0, waveState='pre', waveTimer=2.2, queue=[], spawnT=0, restT=0;
function startWave(){
  waveN++;
  const count=Math.min(2+waveN,9);
  const hc=waveN>=2?Math.min(.18+waveN*.08,.5):0;
  queue=[]; for(let i=0;i<count;i++) queue.push(Math.random()<hc?'heavy':'light');
  for(let i=queue.length-1;i>0;i--){const j=Math.floor(rnd(i+1));[queue[i],queue[j]]=[queue[j],queue[i]];}
  waveState='spawn'; spawnT=.8;
  banner(`WAVE ${waveN}`,`${count} 両の敵戦車 接近`);
}
function updateWaves(dt){
  if(waveState==='pre'){ waveTimer-=dt; if(waveTimer<=0) startWave(); }
  else if(waveState==='spawn'){
    spawnT-=dt;
    if(spawnT<=0&&queue.length&&enemies.length<5){ spawnEnemy(queue.shift()); spawnT=1.6; }
    if(!queue.length&&!enemies.length){
      waveState='rest'; restT=6;
      score+=50*waveN; player.hp=Math.min(player.maxhp,player.hp+30);
      feed('全敵 撃破 — <b>装甲修復 +30</b>');
      $('restline').classList.remove('hidden');
    }
  }
  else if(waveState==='rest'){
    restT-=dt;
    $('restline').textContent=`NEXT WAVE — ${Math.max(0,Math.ceil(restT))}`;
    if(restT<=0){ $('restline').classList.add('hidden'); startWave(); }
  }
}

/* ============ カメラ ============ */
const fpvPos=new THREE.Vector3(), topPos=new THREE.Vector3(), follow=player.pos.clone();
const fpvQuat=new THREE.Quaternion(), topQuat=new THREE.Quaternion(), m4=new THREE.Matrix4(), UP=new THREE.Vector3(0,1,0);
const camCur={b:0};
const _cv1=new THREE.Vector3(), _cv2=new THREE.Vector3();
const raycaster=new THREE.Raycaster();
function mouseGround(){
  raycaster.setFromCamera(mouseNdc,camera);
  const o=raycaster.ray.origin, d=raycaster.ray.direction;
  if(Math.abs(d.y)<1e-5) return null;
  const t=-o.y/d.y; if(t<0||t>1500) return null;
  return new THREE.Vector3(o.x+d.x*t,0,o.z+d.z*t);
}
const aimRing=new THREE.Mesh(new THREE.RingGeometry(.55,.7,24),new THREE.MeshBasicMaterial({color:0xffb454,transparent:true,opacity:.4,side:THREE.DoubleSide}));
aimRing.rotation.x=-Math.PI/2; aimRing.position.y=.07; aimRing.visible=false; scene.add(aimRing);

/* 追従カメラ用: 建物が視界を塞ぐ場合はカメラを手前に引き込む */
const bldAabbs=aabbs.filter(b=>b.bld);
const CH={d:10.5,h:5.4,ahead:16,ty:2.2};
function chaseCam(p,ax,az){
  let d=CH.d;
  const tx=p.x+ax*CH.ahead, tz=p.z+az*CH.ahead;
  const cx=p.x-ax*CH.d, cz=p.z-az*CH.d;
  const dx=cx-tx, dz=cz-tz;
  for(const b of bldAabbs){
    let tmin=0,tmax=1;
    if(Math.abs(dx)<1e-9){ if(tx<b.minX||tx>b.maxX) continue; }
    else{ let t1=(b.minX-tx)/dx,t2=(b.maxX-tx)/dx; if(t1>t2){const q=t1;t1=t2;t2=q;}
      tmin=Math.max(tmin,t1); tmax=Math.min(tmax,t2); if(tmin>tmax) continue; }
    if(Math.abs(dz)<1e-9){ if(tz<b.minZ||tz>b.maxZ) continue; }
    else{ let t1=(b.minZ-tz)/dz,t2=(b.maxZ-tz)/dz; if(t1>t2){const q=t1;t1=t2;t2=q;}
      tmin=Math.max(tmin,t1); tmax=Math.min(tmax,t2); if(tmin>tmax) continue; }
    const y=CH.ty+(CH.h-CH.ty)*tmin;
    if(y<b.h-.3){ const s=tmin*(CH.ahead+CH.d)-CH.ahead; if(s>0&&s<d) d=Math.max(2.2,s-1.0); }
  }
  let h=CH.h;
  const qx=p.x-ax*d, qz=p.z-az*d;
  for(const b of bldAabbs) if(qx>b.minX&&qx<b.maxX&&qz>b.minZ&&qz<b.maxZ&&h<b.h) h=b.h+1.2;
  return {d,h,qx,qz,tx,tz};
}
const _ax0=Math.sin(player.hullYaw), _az0=Math.cos(player.hullYaw);
const chPos=new THREE.Vector3(player.pos.x-_ax0*CH.d,CH.h,player.pos.z-_az0*CH.d);
const chLook=new THREE.Vector3(player.pos.x+_ax0*CH.ahead,CH.ty,player.pos.z+_az0*CH.ahead);

/* コクピット(FPV専用) */
scene.add(camera);
const cockpit=new THREE.Group(); const ckMats=[];
(function buildCockpit(){
  const c=document.createElement('canvas'); c.width=1024; c.height=576; const x=c.getContext('2d');
  const W=1024,H=576,mx=150,my=96,r=26;
  const win=()=>{x.beginPath();
    x.moveTo(mx+r,my); x.lineTo(W-mx-r,my); x.arcTo(W-mx,my,W-mx,my+r,r);
    x.lineTo(W-mx,H-my-r); x.arcTo(W-mx,H-my,W-mx-r,H-my,r);
    x.lineTo(mx+r,H-my); x.arcTo(mx,H-my,mx,H-my-r,r);
    x.lineTo(mx,my+r); x.arcTo(mx,my,mx+r,my,r); x.closePath();};
  x.beginPath(); x.rect(0,0,W,H); win();
  x.fillStyle='#262b22'; x.fill('evenodd');
  x.save(); x.beginPath(); x.rect(0,0,W,H); win(); x.clip('evenodd');
  const g=x.createLinearGradient(0,0,0,H);
  g.addColorStop(0,'rgba(255,255,255,.08)'); g.addColorStop(.5,'rgba(0,0,0,0)'); g.addColorStop(1,'rgba(0,0,0,.28)');
  x.fillStyle=g; x.fillRect(0,0,W,H);
  for(let i=0;i<900;i++){x.fillStyle=Math.random()<.5?'rgba(0,0,0,.10)':'rgba(255,255,255,.05)';x.fillRect(rnd(W),rnd(H),2,2);}
  x.strokeStyle='rgba(0,0,0,.35)'; x.lineWidth=3;
  x.beginPath();
  x.moveTo(W*.3,0); x.lineTo(W*.3,my); x.moveTo(W*.7,0); x.lineTo(W*.7,my);
  x.moveTo(W*.3,H-my); x.lineTo(W*.3,H); x.moveTo(W*.7,H-my); x.lineTo(W*.7,H); x.stroke();
  x.fillStyle='#4a5240';
  for(let px=mx-24;px<=W-mx+24;px+=64){ x.beginPath();x.arc(px,my-36,5,0,7);x.fill(); x.beginPath();x.arc(px,H-my+36,5,0,7);x.fill(); }
  for(let py=my+40;py<=H-my-40;py+=64){ x.beginPath();x.arc(mx-36,py,5,0,7);x.fill(); x.beginPath();x.arc(W-mx+36,py,5,0,7);x.fill(); }
  x.fillStyle='rgba(255,214,150,.5)'; x.font='bold 26px monospace'; x.textAlign='center';
  x.fillText('COMMANDER · IRON LANES',W/2,my-30);
  x.restore();
  win(); x.fillStyle='rgba(190,210,235,.05)'; x.fill();
  win(); x.strokeStyle='rgba(0,0,0,.5)'; x.lineWidth=6; x.stroke();
  win(); x.strokeStyle='rgba(170,180,155,.2)'; x.lineWidth=2; x.stroke();
  const tex=mkTex(c);
  const fm=new THREE.MeshBasicMaterial({map:tex,transparent:true,depthTest:false,side:THREE.FrontSide,fog:false});
  fm.renderOrder=20; ckMats.push(fm);
  const plane=new THREE.Mesh(new THREE.PlaneGeometry(3.6,2.025),fm);
  plane.position.z=-.45; cockpit.add(plane);
  const bm=new THREE.MeshStandardMaterial({color:0x3a3f33,roughness:.55,metalness:.4,transparent:true});
  const manM=new THREE.MeshStandardMaterial({color:0x454b36,roughness:.8,transparent:true});
  ckMats.push(bm,manM);
  const barrel=new THREE.Mesh(new THREE.CylinderGeometry(.045,.05,2.6,10),bm);
  barrel.rotation.x=Math.PI/2; barrel.position.set(0,-.14,-1.0); cockpit.add(barrel);
  const brake=new THREE.Mesh(new THREE.BoxGeometry(.15,.17,.32),bm);
  brake.position.set(0,-.14,-2.25); cockpit.add(brake);
  const man=new THREE.Mesh(new THREE.BoxGeometry(.55,.32,.28),manM);
  man.position.set(0,-.26,-.34); cockpit.add(man);
  scene.add(cockpit);
})();
function updateCamera(dt){
  if(state==='brief'){
    const a=tGlobal*.12;
    camera.position.set(Math.cos(a)*30,15+Math.sin(tGlobal*.3)*2,Math.sin(a)*30);
    camera.lookAt(0,2.5,0);
    cockpit.visible=false; player.g.visible=true; return;
  }
  const mp=mouseGround();
  if(mp){
    aimRing.visible=state==='play';
    aimRing.position.set(clamp(mp.x,-HALF,HALF),.07,clamp(mp.z,-HALF,HALF));
    aimRing.scale.setScalar(1+.12*Math.sin(tGlobal*5));
    if(state==='play'){
      const tx=Math.atan2(mp.x-player.pos.x,mp.z-player.pos.z);
      const d=clamp(wrapA(tx-player.hullYaw),-2.6,2.6);
      player.tLocal+=(d-player.tLocal)*Math.min(1,dt*8);
    }
  }
  const target=player.dead?1:camMode;
  camCur.b+=(target-camCur.b)*Math.min(1,dt*6);
  const e=camCur.b*camCur.b*(3-2*camCur.b);
  const th=player.hullYaw+player.tLocal+player.kick, p=player.pos;
  /* FPV: コクピット(指揮塔ハッチ)からの視点。車体は非表示 */
  fpvPos.set(p.x+Math.sin(th)*.35, 2.72, p.z+Math.cos(th)*.35);
  fpvQuat.setFromEuler(new THREE.Euler(-.07,th+Math.PI,0,'YXZ'));
  /* 追従: 砲塔の後ろ斜め上から照準方向を眺める */
  follow.lerp(p,Math.min(1,dt*6));
  const ax=Math.sin(th), az=Math.cos(th);
  const cc=chaseCam(follow,ax,az);
  _cv1.set(follow.x-ax*cc.d,cc.h,follow.z-az*cc.d);
  _cv2.set(follow.x+ax*CH.ahead,CH.ty,follow.z+az*CH.ahead);
  const ka=Math.min(1,dt*8);
  chPos.lerp(_cv1,ka); chLook.lerp(_cv2,ka);
  topPos.copy(chPos);
  m4.lookAt(chPos,chLook,UP); topQuat.setFromRotationMatrix(m4);
  camera.position.lerpVectors(fpvPos,topPos,e);
  camera.quaternion.slerpQuaternions(fpvQuat,topQuat,e);
  player.g.visible=e>.5;
  const fw=Math.min(1,(1-e)*1.6);
  cockpit.visible=fw>.02;
  for(const m of ckMats) m.opacity=fw;
  if(shake>.002){
    camera.position.x+=rnd(-1,1)*shake*.4; camera.position.y+=rnd(-1,1)*shake*.25; camera.position.z+=rnd(-1,1)*shake*.4;
    camera.rotation.z+=rnd(-1,1)*shake*.004;
    shake*=Math.exp(-5*dt);
  }
}

/* ============ HUD更新 ============ */
function hud(){
  const ap=player.hp/player.maxhp;
  const af=$('afill'); af.style.width=(ap*100)+'%';
  af.className=ap<.3?'crit':ap<.6?'warn':'';
  $('atxt').textContent=`${Math.ceil(player.hp)} / ${player.maxhp}`;
  $('lowarm').classList.toggle('hidden',ap>=.3||player.dead);
  const rm=player.ammoType==='he'?3.2:2.3, r=clamp(player.reload/rm,0,1);
  $('rfill').style.width=((1-r)*100)+'%';
  const ring=$('ring'); ring.style.strokeDashoffset=188.5*r; ring.style.opacity=r>0?.9:0;
  const rs=$('rstat'); rs.textContent=r>0?'再装填中':'READY'; rs.className='num '+(r>0?'rl':'rdy');
  $('henum').textContent=player.heAmmo;
  $('mgst').textContent=mDownR?'発射中':'READY';
  $('mgst').className='num '+(mDownR?'rl':'rdy');
  const hd=headingDeg(player.hullYaw);
  $('ctape').style.transform=`translateX(${170-(hd+360)*PXc}px)`;
  $('chead').textContent=`HDG ${String(Math.round(hd)).padStart(3,'0')}°`;
  $('uwave').textContent=waveN||'-';
  $('ukills').textContent=kills;
  $('uscore').textContent=score;
  $('utime').textContent=fmtT(playT);
  drawRadar();
}

/* ============ 状態遷移 ============ */
function startGame(){
  AU.init(); AU.click();
  $('brief').classList.add('hidden');
  $('hud').classList.remove('hidden');
  $('xh').classList.remove('hidden');
  state='play'; waveState='pre'; waveTimer=2.2;
  banner('出撃せよ','敵装甲部隊 接近中');
  setTimeout(()=>$('hintbar').style.opacity=0,11000);
}
function togglePause(){
  if(state==='play'){ state='pause'; $('pauseov').classList.remove('hidden'); AU.engine(0,0,false); }
  else if(state==='pause'){ state='play'; $('pauseov').classList.add('hidden'); }
}
function showOver(){
  state='over'; AU.engine(0,0,false);
  const fired=mainFired+mgFired;
  $('stKills').textContent=kills; $('stWave').textContent=waveN; $('stScore').textContent=score;
  $('stTime').textContent=fmtT(playT);
  $('stAcc').textContent=(fired?Math.round((mainHits+mgHits)/fired*100):0)+'%';
  $('overov').classList.remove('hidden');
  $('xh').classList.add('hidden');
}
$('btnStart').onclick=startGame;
$('btnResume').onclick=togglePause;
$('btnRestart').onclick=()=>location.reload();
$('btnRetry').onclick=()=>location.reload();

/* ============ メインループ ============ */
let last=performance.now(), tGlobal=0;
function loop(now){
  requestAnimationFrame(loop);
  const dt=Math.min(.05,(now-last)/1000); last=now; tGlobal+=dt;
  if(state!=='pause'){
    if(state==='play'){
      playT+=dt;
      player.throttle=(k.KeyW||k.ArrowUp?1:0)-(k.KeyS||k.ArrowDown?1:0);
      player.steer=(k.KeyA||k.ArrowLeft?1:0)-(k.KeyD||k.ArrowRight?1:0);
      player.drive(dt);
      player.reload=Math.max(0,player.reload-dt);
      player.mgCd-=dt;
      if(mDownL) tryMain();
      if(mDownR&&player.mgCd<=0) fireMG();
      for(const e of enemies){ updateEnemy(e,dt); separate(player,e); }
      for(let i=0;i<enemies.length;i++) for(let j=i+1;j<enemies.length;j++) separate(enemies[i],enemies[j]);
      updateWaves(dt);
      AU.engine(player.speed,player.throttle,true);
    }else if(state==='dying'){
      dieT-=dt;
      for(const e of enemies){ e.throttle=0; e.drive(dt); }
      if(dieT<=0) showOver();
    }
    if(state==='play'||state==='dying'||state==='over') updShells(dt);
    updBursts(dt); updateBurning(dt);
    for(const c of clouds){ c.position.x+=c.userData.vx*dt; if(c.position.x>480) c.position.x=-480; }
    flashLight.intensity*=Math.exp(-28*dt);
    sunL.position.set(player.pos.x+73,92,player.pos.z+57);
    sunL.target.position.copy(player.pos);
    updateCamera(dt);
    if(state!=='brief') hud();
  }
  renderer.render(scene,camera);
}
requestAnimationFrame(loop);
