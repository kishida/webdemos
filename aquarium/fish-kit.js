import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
// src/game/fish/photo-fish.ts
/** 写真の魚がある種類（species.ts の id → public/fish/ のファイル名） */
var FILES = {
	aji: "aji",
	seabass: "suzuki",
	mebaru: "mebaru",
	kasago: "kasago",
	saba: "saba",
	tachiuo: "tachiuo",
	sawara: "sawara",
	kamasu: "kamasu",
	buri: "buri",
	hiramasa: "hiramasa",
	kihada: "kihada",
	magochi: "magochi",
	kurodai: "kurodai",
	madai: "madai",
	katakuchi: "katakuchi",
	isaki: "isaki",
	isaki_young: "isaki_young",
	onagagure: "onagagure",
	kuchibuto: "kuchibuto",
	shibudai: "shibudai"
};
/** ひれ・口・えら・目を動かさない、のっぺりした種類 */
var STILL = /* @__PURE__ */ new Set(["katakuchi"]);
/** 背びれ・しりびれを、ふつう（1.1 rad）より深く、背中にしまうように畳める種類 */
var FOLD_MAX = { tachiuo: 1.52 };
/** えらぶたの後ろの縁・前の縁の折れ線の点の数（シェーダーに渡す数） */
var GILL_EDGE_N = 40;
var GILL_HINGE_N = 40;
/** 口の折れ線の点の数・上あごの多角形の点の数（シェーダーに渡す数） */
var MOUTH_N = 8;
var UPPER_N = 20;
var SWIM_HEAD = `
uniform float uTime, uSnout, uLen, uLam, uBreath, uSwimAmp, uPectRest, uLookAt, uGill, uMouth, uFloor;
uniform vec2 uEyeBulge;
uniform vec4 uMouthShape, uMouthUpper;
uniform vec4 uMouthUpper2;
uniform float uMouthClose;
attribute vec2 jaw;
// えら・口の中・目の周りの色を付けるため、動かす前の模型の位置と部位、切り抜いた板の縁の印をフラグメントへ渡す
varying vec3 vModel;
varying float vPart;
varying float vRim;
uniform vec3 uEnv;
uniform vec4 uFin, uFinMove, uFinMove2;
#ifdef FISH_INSTANCED
// まとめて描くとき（軽い固定版。FishBatches）：1 匹ごとに違う値は、1 匹ずつの属性で受け取る（SWIM_BODY の初めで写す）。
// iMisc = (泳ぐときの頭の振れの倍率, 体全体を使って泳ぐ度合い, 影の濃さ)
attribute vec4 iSwim, iNeck, iFlut;
attribute vec3 iMisc;
vec4 uSwim, uNeck, uFlut;
float uHead, uPower;
#else
uniform vec4 uSwim, uNeck, uFlut;
uniform float uHead, uPower;
#endif
attribute vec3 _fin;
attribute vec3 _piv;
attribute vec3 flutter;
attribute float finH;
// 頭から尾へ伝わる体のうねり。包絡 A(s) = c0 + c1 s + c2 s^2（s = 0 口先〜1 尾の先）、cyc は尾を振った回数
// 全身で泳ぐときは、尾の先の振れは同じまま、頭（尾の 25%）から体の真ん中まで大きくうねる
float fishH(float s, float cyc, float amp) {
  float A0 = uEnv.x * uHead + uEnv.y * s + uEnv.z * s * s;
  float A1 = (uEnv.x + uEnv.y + uEnv.z) * (0.25 + 0.75 * pow(max(s, 0.0), 1.6));
  float A = mix(A0, A1, clamp(uPower, 0.0, 1.0));
  return uLen * amp * A * sin(6.2831853 * (s / uLam - cyc));
}
// 床に横たわっているとき（uFloor：模型の横 +Z が上を向いている度合い -1〜1。0 は床なし）は、横のうねりを上へだけ曲げる
// （横倒しなので横のうねりが上下になり、下へ曲げた所が床に入る。体の長いタチウオは尾が大きく沈んだ）。0 の所でなめらかに折り返す
float lieH(float s, float cyc, float amp) {
  float h = fishH(s, cyc, amp);
  if (uFloor == 0.0) return h;
  float k = sign(uFloor), e = 0.004 * uLen;
  float up = 0.5 * (h * k + sqrt(h * h + e * e)) - 0.5 * e;
  return mix(h, k * up, abs(uFloor));
}
mat3 rotAxis(vec3 a, float t) {
  float c = cos(t), s = sin(t), k = 1.0 - c;
  return mat3(c + a.x * a.x * k, a.y * a.x * k + a.z * s, a.z * a.x * k - a.y * s,
              a.x * a.y * k - a.z * s, c + a.y * a.y * k, a.z * a.y * k + a.x * s,
              a.x * a.z * k + a.y * s, a.y * a.z * k - a.x * s, c + a.z * a.z * k);
}
// 0 から s までの smoothstep(a, b, t) の積分（首で曲げたとき、頭より後ろが横へずれる量）
float neckInt(float s, float a, float b) {
  if (s <= a) return 0.0;
  float w = b - a;
  if (s >= b) return 0.5 * w + (s - b);
  float u = (s - a) / w;
  return w * (u * u * u - 0.5 * u * u * u * u);
}
float fishHash(float n) { return fract(sin(n * 12.9898 + 4.1414) * 43758.5453); }
// ひれの気まぐれ：ひれごとに、よく分からない間隔で閉じたり広げたりする（-0.6 広げる 〜 +1 閉じる、半分ほどは何もしない）。
// しばらくそのままでいて、0.2〜0.9 秒ほどで次の開き具合へ動く（目の動きと同じ作り）。場面とは関係なく、ひれどうしもそろわない
float whimValue(float id, float seg) {
  if (fishHash(seg * 3.7 + id * 11.0) < 0.45) return 0.0;
  return mix(-0.6, 1.0, fishHash(seg * 1.3 + id * 23.0 + 5.0));
}
float finWhim(float id, float t) {
  float T = 1.4 + 2.6 * fishHash(id * 17.0 + 0.3);
  float k = t / T + fishHash(id * 5.0 + 1.7) * 9.0;
  float seg = floor(k);
  float move = mix(0.12, 0.3, fishHash(id + seg * 0.37));
  return mix(whimValue(id, seg - 1.0), whimValue(id, seg), smoothstep(0.0, move, fract(k)));
}
// 目の 1 つの動き：T 秒ごとに次の所へ、80ms ほどでさっと動く（-0.5〜0.5）
vec2 eyeJump(float id, float T) {
  float k = uTime / T + fishHash(id + 1.0) * 7.0, seg = floor(k);
  vec2 g0 = vec2(fishHash(seg * 1.7 + id), fishHash(seg * 2.3 + id + 11.0));
  vec2 g1 = vec2(fishHash(seg * 1.7 - 1.7 + id), fishHash(seg * 2.3 - 2.3 + id + 11.0));
  return mix(g1, g0, smoothstep(0.0, 0.08 / T, fract(k))) - 0.5;
}
// 目：大きく見る所を 0.35〜1.2 秒ごとに変え、その間にも 0.2〜0.5 秒ごとに小さくちらっと動き、いつも少しずつ揺れている
// （目玉がよく動くほど生きて見える）。左右の目はばらばら
vec2 eyeGaze(float id) {
  vec2 g = eyeJump(id, 0.35 + 0.85 * fishHash(id));
  g += 0.3 * eyeJump(id + 5.3, 0.2 + 0.3 * fishHash(id + 2.0));
  g += 0.06 * vec2(sin(uTime * 1.7 + id * 5.0), sin(uTime * 2.3 + id * 3.0));
  return g;
}
`;
var SWIM_BODY = `
#ifdef FISH_INSTANCED
uSwim = iSwim; uNeck = iNeck; uFlut = iFlut; uHead = iMisc.x; uPower = iMisc.y;
#endif
vec4 sw = uSwim, fs4 = uFin;
float seed = uSnout * 17.0;
float cyc = sw.x, amp = sw.y * uSwimAmp, bend = sw.z;
vec3 fishP = position;
vec3 objectNormal = normal;
float part = floor(_fin.x + 0.5);
float fw = _fin.y;
vModel = position;
vPart = part;
vRim = part > 6.5 ? _fin.z : 0.0;
vec3 piv = vec3(_piv.x, _piv.z, -_piv.y);
bool hasPiv = dot(_piv, _piv) > 1e-10;
mat3 R = mat3(1.0);
if (part == 4.0) {
  // 胸びれ：付け根を軸に開いて羽ばたく。先のほうが少し遅れてしなる
  float sd = sign(piv.z);
  float ang = uPectRest + sw.w + fs4.y * (0.5 - 0.5 * cos(6.2831853 * fs4.x - fw * 0.9));
  // 場面に合わせて開き（uFinMove2.y）、左右ばらばらにゆっくり開いたり閉じたりする
  float phz = mix(0.2, 0.5, fishHash(sd * 3.1 + uFlut.w * 7.0));
  ang += uFinMove2.y + uFinMove2.x * 0.36 * sin(6.2831853 * (phz * uFinMove.x + (sd > 0.0 ? 0.2 : 0.7)));
  // 左右ばらばらに、気まぐれに閉じたり（体に寄せる）広げたり
  ang -= uFinMove2.z * 0.45 * finWhim((sd > 0.0 ? 0.13 : 0.57) + uFlut.w * 3.1, uFinMove.x);
  ang = max(ang, 0.0);
  R = rotAxis(normalize(vec3(0.2, 1.0, 0.0)), sd * fw * ang);
} else if (part == 5.0) {
  // 腹びれ：閉じるとお腹に沿い、止まるときは前へ広げる
  float sd = sign(piv.z);
  float ang = mix(-0.12, 0.55, fs4.w) + 0.04 * sin(4.4 * uTime + seed);
  R = rotAxis(vec3(1.0, 0.0, 0.0), -sd * fw * ang);
} else if ((part == 1.0 || part == 2.0) && hasPiv) {
  // 背びれ・しりびれ：扇のように 1 本ずつ根元で後ろへ畳む
  R = rotAxis(vec3(0.0, 0.0, 1.0), _fin.z * (1.0 - fs4.z));
} else if (part == 3.0 && hasPiv) {
  // 尾びれ：振っていないときは少し閉じる
  R = rotAxis(vec3(0.0, 0.0, 1.0), _fin.z * 0.22 * (1.0 - clamp(amp * 1.5, 0.0, 1.0)));
} else if (part == 6.0 && hasPiv) {
  // 目：ばらばらに動き、曲がるときはそちらを見る。uLookAt なら、見ている人のほうの目が人を見る
  float sd = sign(piv.z);
  vec2 g = eyeGaze(seed * 7.13 + (sd > 0.0 ? 0.0 : 3.7));
  // 前後へ ±26°、上下へ ±14° まで
  float fwd = g.x * 0.9, up = g.y * 0.5, lw = 0.0;
  if (uLookAt > 0.0) {
    vec3 d = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz - piv;
    float side = d.z * sd, hz = length(vec2(d.x, side));
    lw = uLookAt * smoothstep(0.0, 0.35, side / max(length(d), 1e-4));
    fwd = mix(fwd, clamp(atan(d.x, side), -0.65, 0.65) + g.x * 0.2, lw);
    up = mix(up, clamp(atan(d.y, hz), -0.45, 0.45) + g.y * 0.1, lw);
  }
  float yaw = sd * fwd + clamp(bend * uLen, -1.0, 1.0) * 0.3 * (1.0 - lw);
  R = rotAxis(vec3(0.0, 1.0, 0.0), yaw) * rotAxis(vec3(1.0, 0.0, 0.0), -sd * up);
} else if (part == 7.0) {
  // えらぶた：前の縁（ちょうつがい）を軸に、後ろの縁ほど外へ開く（fw は前の縁からの距離。上の端は開かない）
  float sd = sign(fishP.z);
  fishP.z += sd * fw * sin(uGill);
  fishP.x += fw * (1.0 - cos(uGill));
  float ga = sd * uGill * clamp(fw / (0.05 * uLen), 0.0, 1.0);
  float gc = cos(ga), gs = sin(ga);
  objectNormal = vec3(objectNormal.x * gc + objectNormal.z * gs, objectNormal.y, -objectNormal.x * gs + objectNormal.z * gc);
}
// 目玉は uEyeBulge.x 倍の大きさにして、外へ uEyeBulge.y 押し出す（ぎょろっと出た目）
if (part == 6.0 && hasPiv) fishP = piv + (fishP - piv) * uEyeBulge.x + vec3(0.0, 0.0, sign(piv.z) * uEyeBulge.y);
if (part >= 1.0 && part <= 6.0) { fishP = piv + R * (fishP - piv); objectNormal = R * objectNormal; }
// 背びれ・しりびれ・腹びれを、胸びれのように筋肉で根元から動かす。付け根の線（体の表面）を軸に、
// 1 本ずつの骨を後ろへ倒して畳み（uFinMove.z）、ひれ全体を横へ傾ける（ひれごとにゆっくり、ばらばらに。舵の分 uFinMove.w も足す）
if (finH != 0.0 && part != 4.0 && flutter.z >= 0.0) {
  float mid = flutter.z;
  float mhz = mix(0.35, 0.8, fishHash(mid * 5.0 + uFlut.w * 11.0));
  float mph = 6.2831853 * (mhz * uFinMove.x + fishHash(mid * 3.0 + uFlut.w * 5.0));
  // 上のひれと下のひれで、舵は同じ側へ倒れるように向きをそろえる
  float side = finH > 0.0 ? 1.0 : -1.0;
  float tilt = side * (uFinMove.y * (sin(mph) + 0.5 * sin(2.3 * mph + 1.1)) + uFinMove.w);
  // 畳み具合：場面のねらい（uFinMove.z）に、ひれごとのゆっくりした開け閉め（uFinMove2.x）を重ねる
  float fhz = mix(0.2, 0.6, fishHash(mid * 9.0 + uFlut.w * 13.0));
  float fph = 6.2831853 * (fhz * uFinMove.x + fishHash(mid * 4.0 + uFlut.w * 3.0));
  float fold = uFinMove.z + uFinMove2.x * (0.7 * sin(fph) + 0.3 * sin(2.6 * fph + 0.8));
  // ひれごとの気まぐれな閉じ・広げ（場面とは関係なく）
  fold += uFinMove2.z * finWhim(mid + uFlut.w * 3.1, uFinMove.x);
  fold = clamp(fold, 0.0, 1.0) * uFinMove2.w;
  float h = abs(finH);
  vec3 base = vec3(fishP.x, fishP.y - finH, fishP.z);
  vec2 ray = vec2(-h * sin(fold), finH * cos(fold));
  fishP = base + vec3(ray.x, ray.y * cos(tilt), ray.y * sin(tilt));
  float tc = cos(tilt), ts = sin(tilt);
  objectNormal = vec3(objectNormal.x, objectNormal.y * tc - objectNormal.z * ts, objectNormal.y * ts + objectNormal.z * tc);
}
// ひれのはためき。どのひれも、付け根から縁へ大きくなる細かい波が前から後ろへ、上から下へ流れる。
// そのうえ旗のように、ひれごとに自分の速さとタイミングで、前から後ろへ波が流れて大きく振れる
// （体のうねりとも、ほかのひれともそろわない。縁と後ろほど大きく、前の縁はとげがあって硬い）。
// 胸びれはひれの面に垂直に、縦のひれは横（模型の Z）に揺らす
if (flutter.x > 0.0 && (uFlut.y > 0.0 || uFlut.z > 0.0)) {
  float fsF = (uSnout - fishP.x) / uLen;
  float arg = 6.2831853 * (2.5 * uFlut.x - fsF * 2.5 - fishP.y / uLen * 1.5);
  // 胸びれの縁の細かい揺れは、ほかのひれの 0.1 倍
  float fa = uLen * uFlut.y * pow(flutter.x, 1.5) * (part == 4.0 ? 0.1 : 1.0);
  float fz = fa * (sin(arg) + 0.35 * sin(1.7 * arg + 1.3));
  float dz = fa * (cos(arg) + 0.6 * cos(1.7 * arg + 1.3)) * 6.2831853 * 2.5 / uLen;
  // ひれの番号（胸びれは左右で別）。尾びれ（-1）は体のうねりで動くので旗にしない
  float fid = part == 4.0 ? (piv.z > 0.0 ? 0.31 : 0.77) : flutter.z;
  if (fid >= 0.0 && uFlut.z > 0.0) {
    float hz = mix(1.1, 2.3, fishHash(fid * 13.0 + uFlut.w * 31.0));
    float ph = 6.2831853 * (hz * uFlut.x + fishHash(fid * 7.0 + uFlut.w * 17.0 + 3.0) - flutter.y * 0.8 - flutter.x * 0.3);
    float W = flutter.x * (0.35 + 0.65 * flutter.y);
    float fl = uLen * uFlut.z * W * W * (part == 4.0 ? 0.6 : 1.0);
    // 速さの違う 2 つの波を重ねて、同じ振れを繰り返さないように
    fz += fl * (sin(ph) + 0.45 * sin(1.73 * ph + 2.1 + 6.2831853 * 0.37 * uFlut.x));
  }
  if (part == 4.0) fishP += objectNormal * fz;
  else {
    fishP.z += fz;
    objectNormal = normalize(vec3(objectNormal.x - dz * objectNormal.z, objectNormal.y, objectNormal.z));
  }
}
// 口：下あご（部位 8 の板と、jaw.x の重みの体）は、口の角の後ろ下の関節（uMouthShape.xy）を軸に回る。写真は口が開いているので、
// ふだんは uMouthClose だけ上へ回して閉じ、uMouth だけ開く（いちばん開いて写真の形）
float jw = part == 8.0 ? 1.0 : part == 0.0 ? jaw.x : 0.0;
if (jw > 0.0) {
  float ja = (uMouthClose - min(uMouth, uMouthClose + 0.35)) * jw;
  if (ja != 0.0) {
    vec2 hp = fishP.xy - uMouthShape.xy;
    float jc = cos(ja), js = sin(ja);
    fishP.xy = uMouthShape.xy + vec2(hp.x * jc - hp.y * js, hp.x * js + hp.y * jc);
    objectNormal.xy = vec2(objectNormal.x * jc - objectNormal.y * js, objectNormal.x * js + objectNormal.y * jc);
  }
}
// 上あご（部位 9 の板）は、口先の付け根（uMouthUpper.xy）を軸に、ふだんは uMouthUpper.z だけ後ろ上へ回して頬に沿わせる
// （口を閉じた写真の種類は 0 で写真のまま）。口を開くほど前下へ出て、uMouthUpper2.y まで開くと uMouthUpper2.x だけ回る
// （シーバスは写真の形。少し開くだけのときはほとんど動かない）。口を閉じた写真の種類は回さずに、uMouthUpper2.w だけ前下へすべり出る
if (part == 9.0) {
  float uo = clamp(uMouth / uMouthUpper2.y, 0.0, 1.0);
  float ua = uMouthUpper2.x * uo * uo - uMouthUpper.z;
  fishP.xy += vec2(0.94, -0.34) * uMouthUpper2.w * uo * uo;
  vec2 hp = fishP.xy - uMouthUpper.xy;
  float uc = cos(ua), us = sin(ua);
  fishP.xy = uMouthUpper.xy + vec2(hp.x * uc - hp.y * us, hp.x * us + hp.y * uc);
  objectNormal.xy = vec2(objectNormal.x * uc - objectNormal.y * us, objectNormal.x * us + objectNormal.y * uc);
}
float fs = (uSnout - fishP.x) / uLen;
// 首：頭のすぐ後ろ（uNeck.y〜z）でなめらかに曲げ、それより後ろを頭に対して uNeck.x rad 戻す（口先は動かさない）
if (uNeck.x != 0.0) {
  float psi = -uNeck.x * smoothstep(uNeck.y, uNeck.z, fs);
  float S = neckInt(fs, uNeck.y, uNeck.z);
  float nc = cos(psi), ns = sin(psi);
  fishP.x += uLen * 0.5 * uNeck.x * uNeck.x * S + fishP.z * ns;
  fishP.z = -uLen * uNeck.x * S + fishP.z * nc;
  objectNormal = vec3(objectNormal.x * nc + objectNormal.z * ns, objectNormal.y, -objectNormal.x * ns + objectNormal.z * nc);
}
float fd = (lieH(fs + 0.002, cyc, amp) - lieH(fs - 0.002, cyc, amp)) / 0.004 * (-1.0 / uLen);
// 曲がるときは、重心（口先から 35%）のまわりで体全体が弧になる
float bx = (fs - 0.35) * uLen;
fishP.z += lieH(fs, cyc, amp) + 0.5 * bend * bx * bx;
fd += bend * bx * (-1.0);
// 首振りの C 字：同じ弧で、口先の所は動かさない
float sx = 0.35 * uLen;
fishP.z += 0.5 * uNeck.w * (bx * bx - sx * sx);
fd -= uNeck.w * bx;
objectNormal = normalize(vec3(objectNormal.x - fd * objectNormal.z, objectNormal.y, objectNormal.z));
`;
/**
* 細かい形の魚（掛かった魚・図鑑・釣れたときの見本）のつや。昼と夜で別の値（夜はヘッドライトが近くから当たる）。
* fish.html の「モデル」の「つや」で、昼・夜の明かりの下で試せる。
* - rough：体のつやの広がり（0 でつるつる、1 でつやなし。目はいつもつやがある）
* - spec：光（太陽・月・ヘッドライト・街灯）の照り返しの強さの倍率
* - env：まわりの景色（空）の映り込みの強さの倍率
*/
var FISH_LOOK = {
	day: {
		rough: .6,
		spec: 1,
		env: 0
	},
	night: {
		rough: .6,
		spec: 1,
		env: 0
	}
};
/** すべての細かい形の魚の材質で同じものを使う（値を変えると、どの魚にもすぐ効く） */
var lookU = {
	uRough: { value: FISH_LOOK.day.rough },
	uSpecK: { value: FISH_LOOK.day.spec },
	uEnvK: { value: FISH_LOOK.day.env },
	/** 開いた口の中の暗さ（光の明るさに掛ける。奥まっていて光が入りにくい分） */
	uMouthIn: { value: .4 }
};
/** instanced：まとめて描く軽い固定版（FishBatches）のシェーダーにする */
function swimMaterial(a, instanced = false) {
	const { map, swim, gill, mouth, eye, photos, headMap } = a;
	const env = swim.env ?? [
		.02,
		-.08,
		.16
	];
	const u = {
		uTime: { value: 0 },
		uSnout: { value: swim.snout },
		uLen: { value: swim.length },
		uLam: { value: swim.lambda },
		uSwimAmp: { value: swim.amp },
		uEnv: { value: new THREE.Vector3(...env) },
		uBreath: { value: .004 * swim.length },
		uPectRest: { value: swim.pect_rest ?? 0 },
		uLookAt: { value: 0 },
		uFloor: { value: 0 },
		uHead: { value: 1 },
		uPower: { value: 0 },
		uNeck: { value: new THREE.Vector4(0, .23, .43, 0) },
		uFlut: { value: new THREE.Vector4(0, 0, 0, 0) },
		uFinMove: { value: new THREE.Vector4(0, 0, 0, 0) },
		uFinMove2: { value: new THREE.Vector4(0, 0, 0, a.foldMax) },
		uSwim: { value: new THREE.Vector4(0, 1, 0, .1) },
		uFin: { value: new THREE.Vector4(0, 0, .3, .2) },
		uGill: { value: 0 },
		uGillEdge: { value: padLine(gill?.edge, GILL_EDGE_N) },
		uGillHinge: { value: padLine(gill?.hinge, GILL_HINGE_N) },
		uGillShape2: { value: gill ? new THREE.Vector4(gill.top, gill.bottom, 1, 0) : new THREE.Vector4() },
		uGillBox: { value: gill ? new THREE.Vector2(Math.min(...gill.edge.map((p) => p[1])) - .006, Math.max(...gill.hinge.map((p) => p[1]))) : new THREE.Vector2() },
		uMouth: { value: 0 },
		uMouthShape: { value: mouth ? new THREE.Vector4(mouth.joint[0], mouth.joint[1], ...mouthCutX(mouth)) : new THREE.Vector4() },
		uMouthEdge: { value: padXY(mouth && mouth.close === 0 ? mouth.lowerLip : mouth?.jawEdge, MOUTH_N) },
		uMouthUpper: { value: mouth ? new THREE.Vector4(mouth.upperPivot[0], mouth.upperPivot[1], mouth.upperClose, mouth.photoClose) : new THREE.Vector4() },
		uMouthUpper2: { value: mouth ? mouth.close > 0 ? new THREE.Vector4(mouth.upperOpen ?? mouth.upperClose, mouth.close, 1, 0) : new THREE.Vector4(0, .4, 0, .6 * (mouth.upperOpen ?? 0) * Math.hypot(mouth.upperPivot[0] - mouth.lowerLip[0][0], mouth.upperPivot[1] - mouth.lowerLip[0][1])) : new THREE.Vector4(0, 1, 0, 0) },
		uMouthUpperPoly: { value: padXY(mouth?.upper, UPPER_N) },
		uMouthLip: { value: padXY(mouth?.lowerLip, MOUTH_N) },
		uMouthOn: { value: mouth ? 1 : 0 },
		uMouthClose: { value: mouth?.close ?? 0 },
		uEye: { value: eye ? new THREE.Vector4(eye.x, eye.y, eye.z, 1) : new THREE.Vector4() },
		uEyeBulge: { value: eye ? new THREE.Vector2(1.1, .0012) : new THREE.Vector2(1, 0) },
		uHeadOn: { value: photos ? 1 : 0 },
		uHeadTex: { value: photos?.head ?? blankTexture() },
		uCoverTex: { value: photos?.cover ?? blankTexture() },
		uHeadMap: { value: new THREE.Vector4(headMap.x0, headMap.z0, headMap.k, swim.photo ? 1 : 0) },
		uHeadBox: { value: new THREE.Vector4(...headMap.box) }
	};
	if (instanced) return {
		material: lightSwimMaterial(map, u),
		uniforms: u
	};
	const m = new THREE.MeshStandardMaterial({
		map,
		roughness: .4,
		metalness: 0,
		side: THREE.DoubleSide,
		alphaTest: .5
	});
	m.onBeforeCompile = (sh) => {
		Object.assign(sh.uniforms, u, lookU);
		sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\n" + SWIM_HEAD).replace("#include <beginnormal_vertex>", SWIM_BODY).replace("#include <begin_vertex>", "vec3 transformed = fishP;");
		sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\n" + GILL_FRAG_HEAD + "\nuniform float uRough, uSpecK, uEnvK, uMouthIn;").replace("#include <map_fragment>", "#include <map_fragment>\n" + PHOTO_FRAG + GILL_FRAG + FACE_FRAG).replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = uRough;\nif (vPart > 5.5 && vPart < 6.5) roughnessFactor = 0.07;\nif (vRim > 0.5 || (!gl_FrontFacing && (vPart < 0.5 || vPart > 7.5))) roughnessFactor = 0.9;").replace("#include <normal_fragment_maps>", "#include <normal_fragment_maps>\nif (vPart < 0.5) roughnessFactor = mix(1.0, roughnessFactor, smoothstep(0.1, 0.6, abs(dot(normal, normalize(vViewPosition)))));").replace("#include <lights_fragment_end>", "#include <lights_fragment_end>\nif (vPart < 0.5) { float graze = smoothstep(0.05, 0.45, abs(dot(normal, normalize(vViewPosition)))); reflectedLight.indirectSpecular *= graze; reflectedLight.directSpecular *= graze; }\nreflectedLight.directSpecular *= uSpecK; reflectedLight.indirectSpecular *= uEnvK;").replace("#include <opaque_fragment>", "if (uMouthOn > 0.5 && !gl_FrontFacing && (vPart < 0.5 || vPart > 7.5)) outgoingLight = (reflectedLight.directDiffuse + reflectedLight.indirectDiffuse) * uMouthIn;\n#include <opaque_fragment>");
	};
	if (instanced) m.defines = { FISH_INSTANCED: "" };
	m.customProgramCacheKey = () => instanced ? "photo-fish-instanced" : "photo-fish";
	return {
		material: m,
		uniforms: u
	};
}
/**
* 群れの魚（掛かっていない魚。種類ごとにまとめて描く）の材質。魚が集まって画面を広く覆うと、1 画素ごとの計算が効くので軽くする：
* - 光は明るさだけの安い計算（Lambert）。照り返し（つや）とまわりの景色の映り込み（環境マップ）はなし
*   （掛かった魚も、つやは広く弱く、映り込みなし：FISH_LOOK）
* - 目のまわりの陰は省く（FACE_FRAG）。泳ぎ・頭の写真・えらと口（止めてある）は、ふつうの魚と同じ
* 掛かった魚・図鑑・釣れたときの見本は、ふつうの材質（swimMaterial の MeshStandardMaterial）のまま
*/
var LIGHT_LOOK = { 
/** 掛かった魚と同じくらいの明るさになるよう、空と地面からの明るさ（半球の光）を何倍にするか */
ambient: .97 };
function lightSwimMaterial(map, u) {
	const lu = {
		...u,
		uAmbL: { value: LIGHT_LOOK.ambient }
	};
	const m = new THREE.MeshLambertMaterial({
		map,
		side: THREE.DoubleSide,
		alphaTest: .5
	});
	m.onBeforeCompile = (sh) => {
		Object.assign(sh.uniforms, lu);
		sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\n" + SWIM_HEAD).replace("#include <beginnormal_vertex>", SWIM_BODY).replace("#include <begin_vertex>", "vec3 transformed = fishP;");
		sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\n" + GILL_FRAG_HEAD + "\nuniform float uAmbL;").replace("#include <map_fragment>", "#include <map_fragment>\n" + PHOTO_FRAG + GILL_FRAG + FACE_FRAG).replace("#include <lights_fragment_end>", "#include <lights_fragment_end>\nreflectedLight.indirectDiffuse *= uAmbL;");
	};
	m.defines = { FISH_INSTANCED: "" };
	m.customProgramCacheKey = () => "photo-fish-instanced-light";
	return m;
}
/**
* 水の上から見ても魚の形と動きが分かる影。体と同じ形・同じ泳ぎ（同じ uniform）で、水面より後に暗く平らに塗る。
* 深さを比べて、魚のいちばん手前の面だけに塗る（体の裏やひれが重なって濃くならない。手前に岩や岸壁があれば隠れる）。
* 明るさを足すと、空を映した白い水面の上で見えなくなるので、暗い色で上から塗る
*/
function shadowMaterial(map, u, instanced = false) {
	const m = new THREE.MeshBasicMaterial({
		map,
		side: THREE.DoubleSide,
		alphaTest: .5,
		transparent: true,
		depthWrite: false,
		polygonOffset: true,
		polygonOffsetFactor: -2,
		polygonOffsetUnits: -4
	});
	m.onBeforeCompile = (sh) => {
		Object.assign(sh.uniforms, u);
		sh.vertexShader = sh.vertexShader.replace("#include <common>", "#include <common>\n" + SWIM_HEAD + "\nvarying float vShadeI;").replace("#include <begin_vertex>", SWIM_BODY + "\nvec3 transformed = fishP;\n#ifdef FISH_INSTANCED\nvShadeI = iMisc.z;\n#else\nvShadeI = 1.0;\n#endif");
		sh.fragmentShader = sh.fragmentShader.replace("#include <common>", "#include <common>\nuniform float uShade;\nuniform vec3 uShadeColor;\nvarying float vShadeI;").replace("#include <opaque_fragment>", "if (vShadeI < 0.005) discard;\ngl_FragColor = vec4(uShadeColor, uShade * vShadeI);");
	};
	if (instanced) m.defines = { FISH_INSTANCED: "" };
	m.customProgramCacheKey = () => instanced ? "photo-fish-shadow-instanced" : "photo-fish-shadow";
	return m;
}
var GILL_FRAG_HEAD = `
uniform vec4 uGillShape2, uEye;
uniform vec2 uGillBox;
uniform vec2 uGillEdge[${GILL_EDGE_N}];
uniform vec2 uGillHinge[${GILL_HINGE_N}];
// 折れ線 (y, x) の、高さ y での x（下から順に並んだ点を直線でつなぐ。端より外は端の x）
float gillEdgeX(float y) {
  float x = uGillEdge[0].y;
  for (int i = 0; i < 39; i++) {
    vec2 a = uGillEdge[i], b = uGillEdge[i + 1];
    if (y >= a.x && y <= b.x && b.x > a.x) x = mix(a.y, b.y, (y - a.x) / (b.x - a.x));
  }
  return y > uGillEdge[39].x ? uGillEdge[39].y : x;
}
float gillHingeX(float y) {
  float x = uGillHinge[0].y;
  for (int i = 0; i < 39; i++) {
    vec2 a = uGillHinge[i], b = uGillHinge[i + 1];
    if (y >= a.x && y <= b.x && b.x > a.x) x = mix(a.y, b.y, (y - a.x) / (b.x - a.x));
  }
  return y > uGillHinge[39].x ? uGillHinge[39].y : x;
}
uniform float uGill, uMouth, uMouthOn, uMouthClose, uHeadOn;
uniform vec4 uMouthShape, uMouthUpper, uHeadMap, uHeadBox;
uniform vec4 uMouthUpper2;
uniform sampler2D uHeadTex, uCoverTex;
// 模型の (x, y)［m］→ 頭の写真の uv（写真の画素 = (x0 − x·k, z0 − y·k)、そこから切り出した範囲の中の割合）
vec2 headUv(vec2 p) { return (vec2(uHeadMap.x - p.x * uHeadMap.z, uHeadMap.y - p.y * uHeadMap.z) - uHeadBox.xy) / uHeadBox.zw; }
float headIn(vec2 uv) { return step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0); }
uniform vec2 uMouthEdge[${MOUTH_N}];
uniform vec2 uMouthLip[${MOUTH_N}];
uniform vec2 uMouthUpperPoly[${UPPER_N}];
// 上あごの多角形の中か
bool inUpperJaw(vec2 p) {
  bool inside = false;
  for (int i = 0; i < ${UPPER_N}; i++) {
    vec2 a = uMouthUpperPoly[i], b = uMouthUpperPoly[i == 0 ? 19 : i - 1];
    if ((a.y > p.y) != (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
// 折れ線 (x, y) の、x での y（端より外は端の y）
float mouthLineY(vec2 l[${MOUTH_N}], float x) {
  float y = l[0].y;
  for (int i = 0; i < 7; i++) if (x >= l[i].x && x <= l[i + 1].x && l[i + 1].x > l[i].x) y = mix(l[i].y, l[i + 1].y, (x - l[i].x) / (l[i + 1].x - l[i].x));
  return x > l[7].x ? l[7].y : y;
}
varying vec3 vModel;
varying float vPart;
varying float vRim;
`;
var PHOTO_FRAG = `
if (uHeadOn > 0.5) {
  if (vPart < 0.5 && gl_FrontFacing) {
    vec2 hp = headUv(vModel.xy);
    vec4 hd = texture2D(uHeadTex, hp);
    // えらぶたの板があるのは前の縁のいちばん前（uGillBox.y）より後ろ（前へのびた細い所は板にしていないので、えらの写真を出さない）
    float under = step(0.5, texture2D(uCoverTex, hp).a) * step(vModel.x, uGillBox.y);
    diffuseColor.rgb = mix(diffuseColor.rgb, hd.rgb, under * hd.a * headIn(hp));
  }
  if (uHeadMap.w > 0.5 && vPart > 5.5 && vPart < 6.5) {
    // 目玉：もとの写真の目を、横からまっすぐ写す（動かす前の位置で読むので、目玉と一緒に回る）
    vec2 hp = headUv(vModel.xy);
    vec4 hd = texture2D(uHeadTex, hp);
    diffuseColor.rgb = mix(diffuseColor.rgb, hd.rgb, hd.a * headIn(hp));
  }
  if (vPart > 6.5 && vPart < 7.5 && gl_FrontFacing && vRim < 0.5) {
    vec2 hp = headUv(vModel.xy);
    vec4 cv = texture2D(uCoverTex, hp);
    diffuseColor.rgb = mix(diffuseColor.rgb, cv.rgb, cv.a * headIn(hp));
  }
  if (vPart > 7.5 && vPart < 8.5 && gl_FrontFacing && vRim < 0.5) {
    vec2 d = vModel.xy - uMouthShape.xy;
    float c = cos(uMouthUpper.w), s = sin(uMouthUpper.w);
    vec2 hp = headUv(uMouthShape.xy + vec2(d.x * c - d.y * s, d.x * s + d.y * c));
    vec4 hd = texture2D(uHeadTex, hp);
    // 関節の近く（8mm）は元の写真へなじませる（後ろの体と板の境目を見せない）
    diffuseColor.rgb = mix(diffuseColor.rgb, hd.rgb, hd.a * headIn(hp) * smoothstep(uMouthShape.x, uMouthShape.x + 0.008, vModel.x));
  }
}
`;
var FACE_FRAG = `
if (uMouthOn > 0.5) {
  float mx = vModel.x;
  // 口の中（下唇の線と上あごの骨の縁の間）と、上あごの板を切り抜いた所は抜く。下唇の線より 3mm 下まで（そこは下あごの板の裏で、
  // のびた三角形を見せない）。ふだんは閉じたあごの板の裏に隠れている。折れ線と多角形を調べるのは口のまわり（uMouthShape.zw の x）だけ
  if (vPart < 0.5 && mx > uMouthShape.z && mx < uMouthShape.w) {
    if (vModel.y > mouthLineY(uMouthLip, mx) - 0.003 && ((uMouthUpper2.z > 0.5 && inUpperJaw(vModel.xy)) ||
        (mx > uMouthEdge[0].x && mx < uMouthLip[7].x + 0.002 && vModel.y < mouthLineY(uMouthEdge, mx)))) {
      discard;
    }
  }
  // 口の中から見える頭の内側（体の裏の面）と、あごの板の裏は、明るい銀色（光を映さないので、0.8 倍した sRGB で 203, 206, 210 ほど）
  if (!gl_FrontFacing && (vPart > 7.5 || (vPart < 0.5 && mx > uMouthEdge[0].x - 0.01))) diffuseColor.rgb = vec3(0.75, 0.77, 0.81);
  // 上あごの板の厚み（縁の帯）は、板の色を少し暗く
  if (vPart > 8.5 && gl_FrontFacing && vRim > 0.5) diffuseColor.rgb *= 0.8;
  if (vPart > 7.5 && vPart < 8.5 && gl_FrontFacing) {
    // 下あごの唇の厚み（縁の帯）は白っぽい唇の色、唇の線の上下 0.5mm はほんの少し暗く（唇の合わせ目。黒くすると縁取りに見える）
    // （口を閉じた写真の種類は、白っぽい色が下あごの先に三角に見えるので、板の色を少し暗く）
    if (vRim > 0.5) diffuseColor.rgb = uMouthUpper2.z > 0.5 ? vec3(0.62, 0.57, 0.57) : diffuseColor.rgb * 0.75;
    else diffuseColor.rgb *= 1.0 - 0.2 * (1.0 - smoothstep(0.0002, 0.0005, abs(mouthLineY(uMouthLip, mx) - vModel.y)));
  }
}
// 目のまわりのくぼみの陰（群れの魚 FISH_INSTANCED は省く。体のすべての画素で計算するので重い）
#ifndef FISH_INSTANCED
if (uEye.w > 0.5 && vPart < 0.5) {
  float ed = length(vModel.xy - uEye.xy) / uEye.z;
  diffuseColor.rgb *= 1.0 - 0.28 * exp(-pow((ed - 1.08) / 0.14, 2.0));
}
#endif
`;
var GILL_FRAG = `
if (uGillShape2.z > 0.5) {
  float gy = vModel.y, gx = vModel.x;
  // 折れ線を調べるのは、えらぶたのまわり（uGillBox の x、上の端と下の端の間）だけ
  if (vPart < 0.5 && abs(vModel.z) > 0.004 && gx > uGillBox.x && gx < uGillBox.y && gy < uGillShape2.x && gy > uGillShape2.y) {
    float ex = gillEdgeX(gy);
    float hx = gillHingeX(gy);
    float inX = gx - ex;
    float inside = min(min(inX, hx - gx), min(uGillShape2.x - gy, gy - uGillShape2.y));
    if (inside <= 0.0 && inX > -0.006 && gx < hx) {
      diffuseColor.rgb *= 1.0 - min(0.6, 0.3 * (1.0 + uGill * 2.0)) * (1.0 + inX / 0.006);
    }
  }
  if (vPart > 6.5 && vPart < 7.5) {
    // えらぶたの縁（厚み）は暗い色でつやを消す（明るい色だと、光を受けて白い線に見える）、裏は暗い赤みがかった色（えらぶたの内側の膜）
    if (vRim > 0.5) diffuseColor.rgb = vec3(0.07, 0.065, 0.07);
    else if (!gl_FrontFacing) diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.24, 0.12, 0.13), 0.75);
  }
}
`;
var assets = /* @__PURE__ */ new Map();
/** cm の (x, y) を、えらぶたの折れ線の m の (y, x) に */
var cmY = (pts) => pts.map(([x, y]) => [y / 100, x / 100]);
var GILLS = {
	seabass: {
		edge: cmY([
			[19.12, -4.58],
			[18.09, -4.36],
			[17.65, -4.14],
			[17.28, -3.92],
			[17.06, -3.69],
			[16.84, -3.47],
			[16.65, -3.25],
			[16.51, -3.03],
			[16.36, -2.81],
			[16.25, -2.59],
			[16.14, -2.37],
			[16.03, -2.15],
			[15.92, -1.93],
			[15.81, -1.71],
			[15.66, -1.49],
			[15.51, -1.27],
			[15.33, -1.05],
			[15.15, -.83],
			[14.96, -.61],
			[14.74, -.39],
			[14.56, -.17],
			[14.34, .06],
			[14.23, .28],
			[14.08, .5],
			[14.08, .72],
			[14.3, .94],
			[14.52, 1.16],
			[14.74, 1.38],
			[14.96, 1.6],
			[15.22, 1.82],
			[15.44, 2.04],
			[15.7, 2.26],
			[15.96, 2.48],
			[16.21, 2.7],
			[16.47, 2.92],
			[16.88, 3.14],
			[17.32, 3.36],
			[17.9, 3.58],
			[18.68, 3.73]
		]),
		hinge: cmY([
			[19.52, -4.58],
			[21.07, -4.36],
			[21.5, -4.14],
			[21.5, -3.92],
			[21.5, -3.69],
			[21.5, -3.47],
			[21.5, -3.25],
			[21.5, -3.03],
			[20.04, -2.81],
			[19.89, -2.59],
			[19.78, -2.37],
			[19.71, -2.15],
			[19.63, -1.93],
			[19.6, -1.71],
			[19.56, -1.49],
			[19.52, -1.27],
			[19.52, -1.05],
			[19.49, -.83],
			[19.49, -.61],
			[19.45, -.39],
			[19.45, -.17],
			[19.45, .06],
			[19.45, .28],
			[19.45, .5],
			[19.49, .72],
			[19.49, .94],
			[19.52, 1.16],
			[19.52, 1.38],
			[19.56, 1.6],
			[19.6, 1.82],
			[19.63, 2.04],
			[19.67, 2.26],
			[19.71, 2.48],
			[19.78, 2.7],
			[19.85, 2.92],
			[19.93, 3.14],
			[20, 3.36],
			[20.04, 3.58],
			[19.6, 3.73]
		]),
		top: .0373,
		bottom: -.0458,
		pivotMax: .2
	},
	aji: {
		edge: cmY([
			[8.34, -2.18],
			[8.08, -2.09],
			[7.94, -1.99],
			[7.8, -1.9],
			[7.71, -1.81],
			[7.61, -1.71],
			[7.52, -1.62],
			[7.45, -1.52],
			[7.39, -1.43],
			[7.32, -1.34],
			[7.26, -1.24],
			[7.2, -1.15],
			[7.14, -1.06],
			[7.07, -.96],
			[7.01, -.87],
			[6.95, -.77],
			[6.89, -.68],
			[6.82, -.59],
			[6.76, -.49],
			[6.7, -.4],
			[6.61, -.31],
			[6.51, -.21],
			[6.58, -.12],
			[6.67, -.03],
			[6.77, .07],
			[6.82, .16],
			[6.85, .26],
			[6.88, .35],
			[6.91, .44],
			[6.95, .54],
			[6.98, .63],
			[7.02, .72],
			[7.08, .82],
			[7.14, .91],
			[7.21, 1.01],
			[7.3, 1.1],
			[7.39, 1.19],
			[7.53, 1.29],
			[7.67, 1.38]
		]),
		hinge: cmY([
			[8.48, -2.18],
			[8.85, -2.09],
			[9.23, -1.99],
			[9.6, -1.9],
			[9.63, -1.81],
			[9.63, -1.71],
			[9.63, -1.62],
			[9.63, -1.52],
			[9.63, -1.43],
			[9.63, -1.34],
			[9.63, -1.24],
			[9.6, -1.15],
			[9.33, -1.06],
			[9.19, -.96],
			[9.07, -.87],
			[8.97, -.77],
			[8.89, -.68],
			[8.82, -.59],
			[8.76, -.49],
			[8.7, -.4],
			[8.67, -.31],
			[8.64, -.21],
			[8.61, -.12],
			[8.6, -.03],
			[8.6, .07],
			[8.6, .16],
			[8.6, .26],
			[8.61, .35],
			[8.64, .44],
			[8.66, .54],
			[8.68, .63],
			[8.71, .72],
			[8.76, .82],
			[8.81, .91],
			[8.85, 1.01],
			[8.9, 1.1],
			[8.62, 1.19],
			[8.34, 1.29],
			[8.06, 1.38]
		]),
		top: .014,
		bottom: -.022,
		pivotMax: .0901
	},
	tachiuo: {
		edge: cmY([
			[41.36, -2.78],
			[40.65, -2.62],
			[40.33, -2.47],
			[40.06, -2.31],
			[39.83, -2.15],
			[39.59, -2],
			[39.41, -1.84],
			[39.22, -1.68],
			[39.03, -1.53],
			[38.87, -1.37],
			[38.71, -1.21],
			[38.55, -1.05],
			[38.4, -.9],
			[38.24, -.74],
			[38.08, -.58],
			[37.94, -.43],
			[37.82, -.27],
			[37.69, -.11],
			[37.59, .04],
			[37.56, .2],
			[37.53, .36],
			[37.51, .51],
			[37.57, .67],
			[37.63, .83],
			[37.69, .98],
			[37.81, 1.14],
			[37.94, 1.3],
			[38.06, 1.45],
			[38.24, 1.61],
			[38.44, 1.77],
			[38.64, 1.93],
			[38.87, 2.08],
			[39.11, 2.24],
			[39.42, 2.4],
			[39.79, 2.55],
			[40.28, 2.71],
			[40.83, 2.87],
			[41.38, 3.02],
			[41.93, 3.18]
		]),
		hinge: cmY([
			[41.66, -2.78],
			[42.61, -2.62],
			[43.23, -2.47],
			[43.86, -2.31],
			[44.49, -2.15],
			[45.06, -2],
			[45.52, -1.84],
			[45.61, -1.68],
			[42.75, -1.53],
			[42.44, -1.37],
			[42.25, -1.21],
			[42.15, -1.05],
			[42.06, -.9],
			[41.99, -.74],
			[41.96, -.58],
			[41.94, -.43],
			[41.91, -.27],
			[41.91, -.11],
			[41.93, .04],
			[41.96, .2],
			[41.98, .36],
			[42, .51],
			[42.05, .67],
			[42.09, .83],
			[42.14, .98],
			[42.18, 1.14],
			[42.24, 1.3],
			[42.31, 1.45],
			[42.38, 1.61],
			[42.44, 1.77],
			[42.51, 1.93],
			[42.56, 2.08],
			[42.61, 2.24],
			[42.67, 2.4],
			[42.69, 2.55],
			[42.67, 2.71],
			[42.64, 2.87],
			[42.61, 3.02],
			[42.12, 3.18]
		]),
		top: .032,
		bottom: -.028,
		pivotMax: .4311
	},
	sawara: {
		edge: cmY([
			[27.45, -4.78],
			[26.98, -4.58],
			[26.68, -4.38],
			[26.48, -4.18],
			[26.29, -3.97],
			[26.21, -3.77],
			[26.14, -3.57],
			[26.06, -3.37],
			[26, -3.17],
			[25.97, -2.97],
			[25.95, -2.76],
			[25.93, -2.56],
			[25.91, -2.36],
			[25.9, -2.16],
			[25.9, -1.96],
			[25.9, -1.76],
			[25.9, -1.55],
			[25.89, -1.35],
			[25.87, -1.15],
			[25.84, -.95],
			[25.82, -.75],
			[25.81, -.55],
			[25.84, -.35],
			[25.87, -.14],
			[25.89, .06],
			[26.01, .26],
			[26.14, .46],
			[26.28, .66],
			[26.46, .86],
			[26.67, 1.07],
			[26.87, 1.27],
			[27.1, 1.47],
			[27.33, 1.67],
			[27.57, 1.87],
			[27.95, 2.07],
			[28.35, 2.28],
			[28.87, 2.48],
			[29.51, 2.68],
			[30.64, 2.88]
		]),
		hinge: cmY([
			[28.39, -4.78],
			[29.27, -4.58],
			[29.94, -4.38],
			[30.66, -4.18],
			[31.44, -3.97],
			[32.5, -3.77],
			[33.24, -3.57],
			[33.89, -3.37],
			[34.41, -3.17],
			[34.41, -2.97],
			[31.73, -2.76],
			[31.63, -2.56],
			[31.53, -2.36],
			[31.5, -2.16],
			[31.5, -1.96],
			[31.5, -1.76],
			[31.5, -1.55],
			[31.53, -1.35],
			[31.57, -1.15],
			[31.61, -.95],
			[31.65, -.75],
			[31.69, -.55],
			[31.73, -.35],
			[31.77, -.14],
			[31.81, .06],
			[31.85, .26],
			[31.89, .46],
			[31.93, .66],
			[31.97, .86],
			[32.01, 1.07],
			[32.05, 1.27],
			[32.09, 1.47],
			[32.12, 1.67],
			[32.14, 1.87],
			[32.16, 2.07],
			[32.18, 2.28],
			[32.2, 2.48],
			[31.84, 2.68],
			[30.96, 2.88]
		]),
		top: .029,
		bottom: -.048,
		pivotMax: .3241
	},
	kamasu: {
		edge: cmY([
			[9.77, -1.78],
			[9.66, -1.7],
			[9.54, -1.63],
			[9.45, -1.55],
			[9.38, -1.48],
			[9.3, -1.4],
			[9.23, -1.33],
			[9.17, -1.25],
			[9.12, -1.18],
			[9.07, -1.1],
			[9.02, -1.03],
			[8.97, -.95],
			[8.92, -.88],
			[8.87, -.8],
			[8.82, -.73],
			[8.75, -.65],
			[8.68, -.58],
			[8.6, -.5],
			[8.56, -.43],
			[8.53, -.35],
			[8.54, -.27],
			[8.65, -.2],
			[8.76, -.12],
			[8.83, -.05],
			[8.88, .03],
			[8.93, .1],
			[8.98, .18],
			[9.03, .25],
			[9.08, .33],
			[9.14, .4],
			[9.19, .48],
			[9.25, .55],
			[9.33, .63],
			[9.4, .7],
			[9.48, .78],
			[9.58, .85],
			[9.69, .93],
			[10.22, 1],
			[10.52, 1.08]
		]),
		hinge: cmY([
			[10.3, -1.78],
			[10.68, -1.7],
			[11.55, -1.63],
			[11.93, -1.55],
			[12.04, -1.48],
			[12.04, -1.4],
			[12.04, -1.33],
			[11.31, -1.25],
			[11.18, -1.18],
			[11.1, -1.1],
			[11.03, -1.03],
			[10.95, -.95],
			[10.88, -.88],
			[10.83, -.8],
			[10.78, -.73],
			[10.73, -.65],
			[10.69, -.58],
			[10.68, -.5],
			[10.66, -.43],
			[10.64, -.35],
			[10.62, -.27],
			[10.6, -.2],
			[10.62, -.12],
			[10.64, -.05],
			[10.66, .03],
			[10.68, .1],
			[10.69, .18],
			[10.74, .25],
			[10.8, .33],
			[10.85, .4],
			[10.91, .48],
			[10.96, .55],
			[11.06, .63],
			[11.21, .7],
			[11.36, .78],
			[11.51, .85],
			[11.66, .93],
			[11.78, 1],
			[11.48, 1.08]
		]),
		top: .011,
		bottom: -.018,
		pivotMax: .1116
	},
	buri: {
		edge: cmY([
			[26.2, -6.58],
			[24.31, -6.29],
			[23.54, -6],
			[23.08, -5.71],
			[22.62, -5.42],
			[22.35, -5.12],
			[22.09, -4.83],
			[21.83, -4.54],
			[21.63, -4.25],
			[21.48, -3.96],
			[21.33, -3.67],
			[21.19, -3.38],
			[21.07, -3.09],
			[20.98, -2.8],
			[20.89, -2.51],
			[20.8, -2.21],
			[20.71, -1.92],
			[20.68, -1.63],
			[20.65, -1.34],
			[20.62, -1.05],
			[20.6, -.76],
			[20.57, -.47],
			[20.54, -.18],
			[20.51, .11],
			[20.4, .41],
			[20.25, .7],
			[20.11, .99],
			[20.43, 1.28],
			[20.73, 1.57],
			[20.84, 1.86],
			[20.98, 2.15],
			[21.12, 2.44],
			[21.27, 2.73],
			[21.52, 3.02],
			[21.82, 3.32],
			[22.19, 3.61],
			[22.72, 3.9],
			[23.42, 4.19],
			[24.96, 4.48]
		]),
		hinge: cmY([
			[26.65, -6.58],
			[28.36, -6.29],
			[29.26, -6],
			[29.26, -5.71],
			[29.26, -5.42],
			[29.26, -5.12],
			[29.26, -4.83],
			[29.26, -4.54],
			[29.26, -4.25],
			[29.26, -3.96],
			[26.26, -3.67],
			[26.1, -3.38],
			[25.98, -3.09],
			[25.93, -2.8],
			[25.87, -2.51],
			[25.82, -2.21],
			[25.81, -1.92],
			[25.84, -1.63],
			[25.86, -1.34],
			[25.89, -1.05],
			[25.93, -.76],
			[26, -.47],
			[26.07, -.18],
			[26.13, .11],
			[26.2, .41],
			[26.31, .7],
			[26.41, .99],
			[26.51, 1.28],
			[26.62, 1.57],
			[26.73, 1.86],
			[26.86, 2.15],
			[27, 2.44],
			[27.13, 2.73],
			[27.27, 3.02],
			[27.35, 3.32],
			[27.43, 3.61],
			[27.5, 3.9],
			[27.57, 4.19],
			[26.61, 4.48]
		]),
		top: .045,
		bottom: -.066,
		pivotMax: .2726
	},
	hiramasa: {
		edge: cmY([
			[30.15, -7.18],
			[28.36, -6.87],
			[27.42, -6.55],
			[26.93, -6.24],
			[26.43, -5.92],
			[26.14, -5.61],
			[25.86, -5.29],
			[25.59, -4.98],
			[25.42, -4.66],
			[25.24, -4.35],
			[25.07, -4.03],
			[24.94, -3.72],
			[24.83, -3.4],
			[24.73, -3.09],
			[24.62, -2.77],
			[24.54, -2.46],
			[24.46, -2.14],
			[24.38, -1.83],
			[24.3, -1.51],
			[24.12, -1.2],
			[23.93, -.89],
			[23.74, -.57],
			[23.74, -.26],
			[23.8, .06],
			[23.86, .37],
			[23.91, .69],
			[23.94, 1],
			[23.97, 1.32],
			[23.99, 1.63],
			[24.1, 1.95],
			[24.22, 2.26],
			[24.35, 2.58],
			[24.53, 2.89],
			[24.74, 3.21],
			[24.95, 3.52],
			[25.27, 3.84],
			[25.63, 4.15],
			[26.13, 4.47],
			[26.76, 4.78]
		]),
		hinge: cmY([
			[30.47, -7.18],
			[32.61, -6.87],
			[32.71, -6.55],
			[32.71, -6.24],
			[32.71, -5.92],
			[32.71, -5.61],
			[32.71, -5.29],
			[32.71, -4.98],
			[32.71, -4.66],
			[32.71, -4.35],
			[32.71, -4.03],
			[29.16, -3.72],
			[29.1, -3.4],
			[29.1, -3.09],
			[29.1, -2.77],
			[29.1, -2.46],
			[29.1, -2.14],
			[29.12, -1.83],
			[29.16, -1.51],
			[29.21, -1.2],
			[29.25, -.89],
			[29.29, -.57],
			[29.35, -.26],
			[29.4, .06],
			[29.46, .37],
			[29.52, .69],
			[29.58, 1],
			[29.66, 1.32],
			[29.74, 1.63],
			[29.83, 1.95],
			[29.91, 2.26],
			[29.99, 2.58],
			[30.15, 2.89],
			[30.3, 3.21],
			[30.46, 3.52],
			[30.83, 3.84],
			[31.01, 4.15],
			[29.68, 4.47],
			[27.81, 4.78]
		]),
		top: .048,
		bottom: -.072,
		pivotMax: .3046
	},
	magochi: {
		edge: cmY([
			[14.55, -2.88],
			[14.2, -2.73],
			[13.86, -2.58],
			[13.59, -2.43],
			[13.33, -2.27],
			[13.11, -2.12],
			[12.92, -1.97],
			[12.74, -1.82],
			[12.57, -1.67],
			[12.42, -1.52],
			[12.26, -1.36],
			[12.11, -1.21],
			[11.97, -1.06],
			[11.84, -.91],
			[11.71, -.76],
			[11.59, -.61],
			[11.47, -.45],
			[11.37, -.3],
			[11.27, -.15],
			[11.17, 0],
			[11.06, .15],
			[10.94, .3],
			[10.82, .45],
			[10.69, .61],
			[10.54, .76],
			[10.39, .91],
			[10.27, 1.06],
			[10.19, 1.21],
			[10.12, 1.36],
			[10.33, 1.52],
			[10.63, 1.67],
			[10.98, 1.82],
			[11.33, 1.97],
			[11.68, 2.12],
			[12.04, 2.27],
			[12.39, 2.43],
			[12.75, 2.58],
			[13.14, 2.73],
			[13.55, 2.88]
		]),
		hinge: cmY([
			[15.38, -2.88],
			[15.99, -2.73],
			[16.59, -2.58],
			[17.09, -2.43],
			[17.09, -2.27],
			[17.09, -2.12],
			[15.92, -1.97],
			[15.41, -1.82],
			[15.06, -1.67],
			[14.8, -1.52],
			[14.62, -1.36],
			[14.44, -1.21],
			[14.29, -1.06],
			[14.26, -.91],
			[14.23, -.76],
			[14.2, -.61],
			[14.32, -.45],
			[14.44, -.3],
			[14.56, -.15],
			[14.78, 0],
			[15.04, .15],
			[15.31, .3],
			[15.92, .45],
			[16.28, .61],
			[16.53, .76],
			[16.58, .91],
			[16.56, 1.06],
			[16.53, 1.21],
			[16.51, 1.36],
			[16.5, 1.52],
			[16.5, 1.67],
			[16.5, 1.82],
			[16.5, 1.97],
			[16.43, 2.12],
			[15.98, 2.27],
			[15.61, 2.43],
			[15.25, 2.58],
			[14.69, 2.73],
			[13.76, 2.88]
		]),
		top: .029,
		bottom: -.029,
		pivotMax: .1597
	},
	kurodai: {
		edge: cmY([
			[14.34, -4.78],
			[13.28, -4.58],
			[12.76, -4.38],
			[12.38, -4.18],
			[12.13, -3.98],
			[11.89, -3.79],
			[11.76, -3.59],
			[11.62, -3.39],
			[11.49, -3.19],
			[11.39, -2.99],
			[11.3, -2.79],
			[11.2, -2.59],
			[11.13, -2.39],
			[11.06, -2.19],
			[11, -1.99],
			[10.93, -1.8],
			[10.87, -1.6],
			[10.8, -1.4],
			[10.68, -1.2],
			[10.56, -1],
			[10.43, -.8],
			[10.28, -.6],
			[10.27, -.4],
			[10.42, -.2],
			[10.56, -.01],
			[10.7, .19],
			[10.83, .39],
			[10.95, .59],
			[11.05, .79],
			[11.14, .99],
			[11.24, 1.19],
			[11.34, 1.39],
			[11.44, 1.59],
			[11.55, 1.79],
			[11.67, 1.98],
			[11.79, 2.18],
			[12.1, 2.38],
			[12.54, 2.58],
			[13.38, 2.78]
		]),
		hinge: cmY([
			[14.58, -4.78],
			[15.38, -4.58],
			[16.15, -4.38],
			[16.22, -4.18],
			[16.22, -3.98],
			[16.22, -3.79],
			[16.22, -3.59],
			[16.22, -3.39],
			[16.22, -3.19],
			[15.3, -2.99],
			[15.21, -2.79],
			[15.12, -2.59],
			[15.04, -2.39],
			[14.99, -2.19],
			[14.97, -1.99],
			[14.94, -1.8],
			[14.92, -1.6],
			[14.9, -1.4],
			[14.9, -1.2],
			[14.9, -1],
			[14.9, -.8],
			[14.9, -.6],
			[14.9, -.4],
			[14.9, -.2],
			[14.9, -.01],
			[14.9, .19],
			[14.9, .39],
			[14.9, .59],
			[14.89, .79],
			[14.87, .99],
			[14.85, 1.19],
			[14.83, 1.39],
			[14.81, 1.59],
			[14.79, 1.79],
			[14.77, 1.98],
			[14.75, 2.18],
			[14.73, 2.38],
			[14.71, 2.58],
			[14.22, 2.78]
		]),
		top: .028,
		bottom: -.048,
		pivotMax: .1522
	},
	saba: {
		edge: cmY([
			[10.34, -2.88],
			[10.07, -2.75],
			[9.98, -2.62],
			[9.9, -2.5],
			[9.87, -2.37],
			[9.84, -2.24],
			[9.8, -2.11],
			[9.78, -1.98],
			[9.75, -1.86],
			[9.73, -1.73],
			[9.7, -1.6],
			[9.7, -1.47],
			[9.7, -1.35],
			[9.7, -1.22],
			[9.7, -1.09],
			[9.67, -.96],
			[9.65, -.83],
			[9.62, -.71],
			[9.6, -.58],
			[9.6, -.45],
			[9.6, -.32],
			[9.6, -.19],
			[9.67, -.07],
			[9.73, .06],
			[9.79, .19],
			[9.86, .32],
			[9.92, .45],
			[9.99, .57],
			[10.05, .7],
			[10.11, .83],
			[10.18, .96],
			[10.28, 1.08],
			[10.41, 1.21],
			[10.55, 1.34],
			[10.72, 1.47],
			[10.9, 1.6],
			[11.21, 1.72],
			[11.66, 1.85],
			[12.3, 1.98]
		]),
		hinge: cmY([
			[11.02, -2.88],
			[11.79, -2.75],
			[12.33, -2.62],
			[12.72, -2.5],
			[13.15, -2.37],
			[13.15, -2.24],
			[13.15, -2.11],
			[11, -1.98],
			[11, -1.86],
			[11.03, -1.73],
			[11.08, -1.6],
			[11.13, -1.47],
			[11.18, -1.35],
			[11.24, -1.22],
			[11.31, -1.09],
			[11.37, -.96],
			[11.43, -.83],
			[11.5, -.71],
			[11.57, -.58],
			[11.64, -.45],
			[11.72, -.32],
			[11.79, -.19],
			[11.86, -.07],
			[11.93, .06],
			[11.99, .19],
			[12.06, .32],
			[12.12, .45],
			[12.19, .57],
			[12.25, .7],
			[12.31, .83],
			[12.38, .96],
			[12.44, 1.08],
			[12.51, 1.21],
			[12.57, 1.34],
			[12.63, 1.47],
			[12.7, 1.6],
			[12.76, 1.72],
			[12.83, 1.85],
			[12.89, 1.98]
		]),
		top: .02,
		bottom: -.029,
		pivotMax: .1227
	},
	madai: {
		edge: cmY([
			[15.32, -5.98],
			[14.25, -5.72],
			[13.75, -5.47],
			[13.39, -5.21],
			[13.05, -4.95],
			[12.8, -4.7],
			[12.54, -4.44],
			[12.34, -4.18],
			[12.16, -3.93],
			[11.98, -3.67],
			[11.84, -3.41],
			[11.69, -3.15],
			[11.54, -2.9],
			[11.39, -2.64],
			[11.25, -2.38],
			[11.05, -2.13],
			[10.82, -1.87],
			[10.6, -1.61],
			[10.54, -1.36],
			[10.61, -1.1],
			[10.69, -.84],
			[10.79, -.59],
			[10.91, -.33],
			[11.02, -.07],
			[11.14, .18],
			[11.27, .44],
			[11.4, .7],
			[11.53, .95],
			[11.67, 1.21],
			[11.82, 1.47],
			[11.98, 1.73],
			[12.13, 1.98],
			[12.32, 2.24],
			[12.55, 2.5],
			[12.78, 2.75],
			[13.01, 3.01],
			[13.4, 3.27],
			[13.78, 3.52],
			[14.8, 3.78]
		]),
		hinge: cmY([
			[15.7, -5.98],
			[16.48, -5.72],
			[16.48, -5.47],
			[16.48, -5.21],
			[16.48, -4.95],
			[16.48, -4.7],
			[16.48, -4.44],
			[16.48, -4.18],
			[15.14, -3.93],
			[15.03, -3.67],
			[14.98, -3.41],
			[14.95, -3.15],
			[14.92, -2.9],
			[14.9, -2.64],
			[14.9, -2.38],
			[14.9, -2.13],
			[14.9, -1.87],
			[14.9, -1.61],
			[14.9, -1.36],
			[14.9, -1.1],
			[14.9, -.84],
			[14.9, -.59],
			[14.9, -.33],
			[14.9, -.07],
			[14.9, .18],
			[14.91, .44],
			[14.94, .7],
			[14.97, .95],
			[14.99, 1.21],
			[15.02, 1.47],
			[15.05, 1.73],
			[15.08, 1.98],
			[15.11, 2.24],
			[15.21, 2.5],
			[15.31, 2.75],
			[15.41, 3.01],
			[15.58, 3.27],
			[15.75, 3.52],
			[14.99, 3.78]
		]),
		top: .038,
		bottom: -.06,
		pivotMax: .1535
	},
	kasago: {
		edge: cmY([
			[7.62, -2.28],
			[7.18, -2.15],
			[6.86, -2.02],
			[6.63, -1.9],
			[6.41, -1.77],
			[6.24, -1.64],
			[6.11, -1.51],
			[5.98, -1.38],
			[5.86, -1.26],
			[5.73, -1.13],
			[5.6, -1],
			[5.48, -.87],
			[5.38, -.75],
			[5.27, -.62],
			[5.17, -.49],
			[5.08, -.36],
			[5, -.23],
			[4.92, -.11],
			[4.85, .02],
			[4.77, .15],
			[4.69, .28],
			[4.62, .41],
			[4.54, .53],
			[4.48, .66],
			[4.42, .79],
			[4.37, .92],
			[4.32, 1.05],
			[4.3, 1.17],
			[4.3, 1.3],
			[4.3, 1.43],
			[4.29, 1.56],
			[4.25, 1.68],
			[4.22, 1.81],
			[4.3, 1.94],
			[4.62, 2.07],
			[4.89, 2.2],
			[5.2, 2.32],
			[5.71, 2.45],
			[6.22, 2.58]
		]),
		hinge: cmY([
			[7.8, -2.28],
			[8.32, -2.15],
			[8.33, -2.02],
			[8.33, -1.9],
			[8.33, -1.77],
			[8.33, -1.64],
			[8.33, -1.51],
			[7.99, -1.38],
			[7.93, -1.26],
			[7.86, -1.13],
			[7.8, -1],
			[7.77, -.87],
			[7.75, -.75],
			[7.72, -.62],
			[7.7, -.49],
			[7.67, -.36],
			[7.65, -.23],
			[7.62, -.11],
			[7.6, .02],
			[7.6, .15],
			[7.6, .28],
			[7.6, .41],
			[7.59, .53],
			[7.57, .66],
			[7.54, .79],
			[7.52, .92],
			[7.5, 1.05],
			[7.5, 1.17],
			[7.5, 1.3],
			[7.5, 1.43],
			[7.5, 1.56],
			[7.5, 1.68],
			[7.5, 1.81],
			[7.5, 1.94],
			[7.5, 2.07],
			[7.5, 2.2],
			[7.5, 2.32],
			[7.29, 2.45],
			[6.78, 2.58]
		]),
		top: .026,
		bottom: -.023,
		pivotMax: .0778
	},
	mebaru: {
		edge: cmY([
			[7.22, -2.48],
			[6.84, -2.37],
			[6.62, -2.26],
			[6.44, -2.15],
			[6.29, -2.04],
			[6.14, -1.93],
			[6.02, -1.82],
			[5.91, -1.71],
			[5.8, -1.6],
			[5.72, -1.49],
			[5.64, -1.39],
			[5.56, -1.28],
			[5.49, -1.17],
			[5.46, -1.06],
			[5.44, -.95],
			[5.41, -.84],
			[5.36, -.73],
			[5.31, -.62],
			[5.25, -.51],
			[5.2, -.4],
			[5.17, -.29],
			[5.15, -.18],
			[5.12, -.07],
			[5.09, .04],
			[5.05, .15],
			[5.01, .26],
			[4.96, .37],
			[4.88, .48],
			[4.81, .59],
			[4.99, .69],
			[5.21, .8],
			[5.41, .91],
			[5.52, 1.02],
			[5.63, 1.13],
			[5.74, 1.24],
			[5.85, 1.35],
			[6.02, 1.46],
			[6.24, 1.57],
			[6.62, 1.68]
		]),
		hinge: cmY([
			[7.74, -2.48],
			[7.96, -2.37],
			[8.18, -2.26],
			[8.19, -2.15],
			[8.19, -2.04],
			[8.19, -1.93],
			[8.19, -1.82],
			[8.19, -1.71],
			[8.19, -1.6],
			[7.8, -1.49],
			[7.72, -1.39],
			[7.65, -1.28],
			[7.59, -1.17],
			[7.56, -1.06],
			[7.54, -.95],
			[7.51, -.84],
			[7.49, -.73],
			[7.46, -.62],
			[7.44, -.51],
			[7.42, -.4],
			[7.4, -.29],
			[7.4, -.18],
			[7.4, -.07],
			[7.4, .04],
			[7.4, .15],
			[7.4, .26],
			[7.4, .37],
			[7.4, .48],
			[7.4, .59],
			[7.4, .69],
			[7.4, .8],
			[7.4, .91],
			[7.4, 1.02],
			[7.4, 1.13],
			[7.41, 1.24],
			[7.44, 1.35],
			[7.47, 1.46],
			[7.49, 1.57],
			[7.18, 1.68]
		]),
		top: .017,
		bottom: -.025,
		pivotMax: .0764
	},
	kihada: {
		edge: cmY([
			[32.23, -9.03],
			[29.94, -8.62],
			[29.35, -8.21],
			[28.89, -7.8],
			[28.62, -7.39],
			[28.43, -6.98],
			[28.24, -6.57],
			[28.11, -6.16],
			[28.03, -5.75],
			[27.96, -5.34],
			[27.88, -4.93],
			[27.84, -4.52],
			[27.81, -4.11],
			[27.79, -3.7],
			[27.76, -3.29],
			[27.78, -2.88],
			[27.83, -2.47],
			[27.88, -2.06],
			[27.93, -1.65],
			[28.01, -1.24],
			[28.12, -.82],
			[28.22, -.41],
			[28.32, -0],
			[28.48, .41],
			[28.65, .82],
			[28.82, 1.23],
			[29.01, 1.64],
			[29.24, 2.05],
			[29.46, 2.46],
			[29.66, 2.87],
			[29.79, 3.28],
			[29.92, 3.69],
			[30.04, 4.1],
			[30.18, 4.51],
			[30.32, 4.92],
			[30.49, 5.33],
			[30.89, 5.74],
			[31.42, 6.15],
			[33.36, 6.56]
		]),
		hinge: cmY([
			[32.65, -9.03],
			[34.72, -8.62],
			[36.15, -8.21],
			[37.25, -7.8],
			[38.32, -7.39],
			[38.32, -6.98],
			[38.32, -6.57],
			[38.32, -6.16],
			[38.32, -5.75],
			[38.32, -5.34],
			[33.51, -4.93],
			[33.32, -4.52],
			[33.32, -4.11],
			[33.32, -3.7],
			[33.32, -3.29],
			[33.35, -2.88],
			[33.46, -2.47],
			[33.58, -2.06],
			[33.69, -1.65],
			[33.81, -1.24],
			[33.97, -.82],
			[34.13, -.41],
			[34.3, -0],
			[34.46, .41],
			[34.63, .82],
			[34.84, 1.23],
			[35.06, 1.64],
			[35.27, 2.05],
			[35.49, 2.46],
			[35.62, 2.87],
			[35.74, 3.28],
			[35.87, 3.69],
			[35.99, 4.1],
			[36.1, 4.51],
			[35.85, 4.92],
			[35.6, 5.33],
			[35.32, 5.74],
			[35.02, 6.15],
			[33.71, 6.56]
		]),
		top: .0658,
		bottom: -.0905,
		pivotMax: .3582
	},
	isaki: {
		edge: cmY([
			[12.17, -3.38],
			[11.92, -3.23],
			[11.68, -3.09],
			[11.44, -2.94],
			[11.19, -2.79],
			[11.05, -2.65],
			[10.9, -2.5],
			[10.77, -2.36],
			[10.69, -2.21],
			[10.6, -2.06],
			[10.51, -1.92],
			[10.45, -1.77],
			[10.39, -1.62],
			[10.33, -1.48],
			[10.27, -1.33],
			[10.21, -1.19],
			[10.16, -1.04],
			[10.1, -.89],
			[10.02, -.75],
			[9.95, -.6],
			[9.87, -.45],
			[9.77, -.31],
			[9.78, -.16],
			[10.07, -.01],
			[10.2, .13],
			[10.31, .28],
			[10.42, .42],
			[10.53, .57],
			[10.64, .72],
			[10.76, .86],
			[10.91, 1.01],
			[11.06, 1.16],
			[11.2, 1.3],
			[11.35, 1.45],
			[11.49, 1.59],
			[11.69, 1.74],
			[11.88, 1.89],
			[12.17, 2.03],
			[12.62, 2.18]
		]),
		hinge: cmY([
			[12.76, -3.38],
			[13.2, -3.23],
			[13.64, -3.09],
			[14, -2.94],
			[14, -2.79],
			[14, -2.65],
			[14, -2.5],
			[14, -2.36],
			[14, -2.21],
			[13.05, -2.06],
			[12.97, -1.92],
			[12.91, -1.77],
			[12.85, -1.62],
			[12.8, -1.48],
			[12.77, -1.33],
			[12.75, -1.19],
			[12.72, -1.04],
			[12.7, -.89],
			[12.7, -.75],
			[12.7, -.6],
			[12.7, -.45],
			[12.7, -.31],
			[12.7, -.16],
			[12.72, -.01],
			[12.74, .13],
			[12.76, .28],
			[12.78, .42],
			[12.8, .57],
			[12.81, .72],
			[12.83, .86],
			[12.85, 1.01],
			[12.87, 1.16],
			[12.89, 1.3],
			[12.91, 1.45],
			[12.96, 1.59],
			[13, 1.74],
			[13.04, 1.89],
			[13.08, 2.03],
			[12.78, 2.18]
		]),
		top: .022,
		bottom: -.034,
		pivotMax: .1313
	},
	kuchibuto: {
		edge: cmY([
			[14.76, -4.08],
			[13.97, -3.89],
			[13.59, -3.69],
			[13.36, -3.5],
			[13.13, -3.31],
			[12.91, -3.11],
			[12.72, -2.92],
			[12.52, -2.72],
			[12.39, -2.53],
			[12.26, -2.34],
			[12.13, -2.14],
			[12.02, -1.95],
			[11.93, -1.76],
			[11.83, -1.56],
			[11.76, -1.37],
			[11.71, -1.17],
			[11.65, -.98],
			[11.6, -.79],
			[11.6, -.59],
			[11.6, -.4],
			[11.6, -.21],
			[11.65, -.01],
			[11.71, .18],
			[11.76, .37],
			[11.83, .57],
			[11.91, .76],
			[12, .96],
			[12.08, 1.15],
			[12.18, 1.34],
			[12.29, 1.54],
			[12.4, 1.73],
			[12.52, 1.92],
			[12.68, 2.12],
			[12.84, 2.31],
			[13.01, 2.51],
			[13.35, 2.7],
			[13.69, 2.89],
			[14.13, 3.09],
			[14.96, 3.28]
		]),
		hinge: cmY([
			[15.04, -4.08],
			[15.82, -3.89],
			[15.82, -3.69],
			[15.82, -3.5],
			[15.82, -3.31],
			[15.82, -3.11],
			[15.82, -2.92],
			[14.57, -2.72],
			[14.54, -2.53],
			[14.51, -2.34],
			[14.5, -2.14],
			[14.5, -1.95],
			[14.5, -1.76],
			[14.49, -1.56],
			[14.47, -1.37],
			[14.44, -1.17],
			[14.41, -.98],
			[14.38, -.79],
			[14.36, -.59],
			[14.33, -.4],
			[14.3, -.21],
			[14.27, -.01],
			[14.25, .18],
			[14.22, .37],
			[14.21, .57],
			[14.24, .76],
			[14.27, .96],
			[14.29, 1.15],
			[14.34, 1.34],
			[14.4, 1.54],
			[14.45, 1.73],
			[14.51, 1.92],
			[14.59, 2.12],
			[14.68, 2.31],
			[14.76, 2.51],
			[14.84, 2.7],
			[14.93, 2.89],
			[15.01, 3.09],
			[15.09, 3.28]
		]),
		top: .033,
		bottom: -.041,
		pivotMax: .1482
	},
	shibudai: {
		edge: cmY([
			[13.08, -4.18],
			[12.37, -3.99],
			[11.99, -3.79],
			[11.7, -3.6],
			[11.41, -3.41],
			[11.21, -3.21],
			[11.02, -3.02],
			[10.84, -2.82],
			[10.68, -2.63],
			[10.51, -2.44],
			[10.36, -2.24],
			[10.23, -2.05],
			[10.1, -1.86],
			[9.97, -1.66],
			[9.85, -1.47],
			[9.72, -1.27],
			[9.58, -1.08],
			[9.43, -.89],
			[9.27, -.69],
			[9.14, -.5],
			[9.02, -.31],
			[8.91, -.11],
			[9.08, .08],
			[9.26, .27],
			[9.4, .47],
			[9.53, .66],
			[9.63, .86],
			[9.72, 1.05],
			[9.81, 1.24],
			[9.88, 1.44],
			[9.94, 1.63],
			[10.03, 1.82],
			[10.27, 2.02],
			[10.52, 2.21],
			[10.91, 2.41],
			[11.4, 2.6],
			[11.98, 2.79],
			[12.56, 2.99],
			[13.38, 3.18]
		]),
		hinge: cmY([
			[13.86, -4.18],
			[14.44, -3.99],
			[14.92, -3.79],
			[14.92, -3.6],
			[14.92, -3.41],
			[14.92, -3.21],
			[13.84, -3.02],
			[13.69, -2.82],
			[13.59, -2.63],
			[13.56, -2.44],
			[13.52, -2.24],
			[13.5, -2.05],
			[13.5, -1.86],
			[13.5, -1.66],
			[13.5, -1.47],
			[13.5, -1.27],
			[13.5, -1.08],
			[13.5, -.89],
			[13.5, -.69],
			[13.5, -.5],
			[13.52, -.31],
			[13.55, -.11],
			[13.57, .08],
			[13.6, .27],
			[13.6, .47],
			[13.6, .66],
			[13.6, .86],
			[13.6, 1.05],
			[13.62, 1.24],
			[13.64, 1.44],
			[13.67, 1.63],
			[13.69, 1.82],
			[13.68, 2.02],
			[13.66, 2.21],
			[13.63, 2.41],
			[13.6, 2.6],
			[13.57, 2.79],
			[13.54, 2.99],
			[13.5, 3.18]
		]),
		top: .032,
		bottom: -.042,
		pivotMax: .1392
	},
	onagagure: {
		edge: cmY([
			[17.14, -4.38],
			[16.59, -4.19],
			[16.22, -4.01],
			[15.88, -3.82],
			[15.61, -3.64],
			[15.35, -3.45],
			[15.17, -3.27],
			[14.98, -3.08],
			[14.81, -2.89],
			[14.67, -2.71],
			[14.52, -2.52],
			[14.39, -2.34],
			[14.27, -2.15],
			[14.14, -1.96],
			[14.04, -1.78],
			[13.95, -1.59],
			[13.85, -1.41],
			[13.77, -1.22],
			[13.69, -1.04],
			[13.62, -.85],
			[13.67, -.66],
			[13.76, -.48],
			[13.86, -.29],
			[13.98, -.11],
			[14.09, .08],
			[14.18, .26],
			[14.28, .45],
			[14.37, .64],
			[14.46, .82],
			[14.55, 1.01],
			[14.65, 1.19],
			[14.75, 1.38],
			[14.86, 1.57],
			[14.97, 1.75],
			[15.1, 1.94],
			[15.24, 2.12],
			[15.52, 2.31],
			[15.89, 2.49],
			[16.5, 2.68]
		]),
		hinge: cmY([
			[17.87, -4.38],
			[18.52, -4.19],
			[18.64, -4.01],
			[18.64, -3.82],
			[18.64, -3.64],
			[18.64, -3.45],
			[18.64, -3.27],
			[17.21, -3.08],
			[17.07, -2.89],
			[16.97, -2.71],
			[16.91, -2.52],
			[16.85, -2.34],
			[16.79, -2.15],
			[16.77, -1.96],
			[16.74, -1.78],
			[16.71, -1.59],
			[16.71, -1.41],
			[16.73, -1.22],
			[16.76, -1.04],
			[16.78, -.85],
			[16.81, -.66],
			[16.86, -.48],
			[16.9, -.29],
			[16.95, -.11],
			[16.99, .08],
			[17.06, .26],
			[17.13, .45],
			[17.2, .64],
			[17.27, .82],
			[17.33, 1.01],
			[17.37, 1.19],
			[17.42, 1.38],
			[17.47, 1.57],
			[17.51, 1.75],
			[17.53, 1.94],
			[17.55, 2.12],
			[17.58, 2.31],
			[17.6, 2.49],
			[17.15, 2.68]
		]),
		top: .027,
		bottom: -.044,
		pivotMax: .1751
	},
	isaki_young: {
		edge: cmY([
			[8.62, -2.48],
			[8.26, -2.38],
			[8.05, -2.28],
			[7.88, -2.18],
			[7.77, -2.07],
			[7.67, -1.97],
			[7.58, -1.87],
			[7.51, -1.77],
			[7.44, -1.67],
			[7.39, -1.57],
			[7.37, -1.46],
			[7.34, -1.36],
			[7.32, -1.26],
			[7.29, -1.16],
			[7.26, -1.06],
			[7.24, -.96],
			[7.21, -.85],
			[7.2, -.75],
			[7.2, -.65],
			[7.2, -.55],
			[7.17, -.45],
			[7.1, -.35],
			[7.03, -.25],
			[7.04, -.14],
			[7.12, -.04],
			[7.19, .06],
			[7.27, .16],
			[7.33, .26],
			[7.38, .36],
			[7.43, .47],
			[7.48, .57],
			[7.55, .67],
			[7.61, .77],
			[7.68, .87],
			[7.77, .97],
			[7.88, 1.08],
			[7.98, 1.18],
			[8.24, 1.28],
			[8.62, 1.38]
		]),
		hinge: cmY([
			[9.18, -2.48],
			[9.55, -2.38],
			[9.69, -2.28],
			[9.69, -2.18],
			[9.69, -2.07],
			[9.69, -1.97],
			[9.69, -1.87],
			[9.69, -1.77],
			[9.69, -1.67],
			[9.08, -1.57],
			[9.01, -1.46],
			[8.94, -1.36],
			[8.89, -1.26],
			[8.86, -1.16],
			[8.84, -1.06],
			[8.81, -.96],
			[8.8, -.85],
			[8.8, -.75],
			[8.8, -.65],
			[8.8, -.55],
			[8.8, -.45],
			[8.8, -.35],
			[8.8, -.25],
			[8.8, -.14],
			[8.8, -.04],
			[8.8, .06],
			[8.8, .16],
			[8.8, .26],
			[8.8, .36],
			[8.8, .47],
			[8.82, .57],
			[8.84, .67],
			[8.87, .77],
			[8.89, .87],
			[8.92, .97],
			[8.94, 1.08],
			[8.97, 1.18],
			[8.99, 1.28],
			[8.76, 1.38]
		]),
		top: .014,
		bottom: -.025,
		pivotMax: .0906
	}
};
/** 折れ線 (y, x) の、高さ y での x */
function lineX(line, y) {
	if (y <= line[0][0]) return line[0][1];
	for (let i = 0; i + 1 < line.length; i++) {
		const [y0, x0] = line[i];
		const [y1, x1] = line[i + 1];
		if (y <= y1) return x0 + (x1 - x0) * (y - y0) / Math.max(y1 - y0, 1e-9);
	}
	return line[line.length - 1][1];
}
/**
* 頭の写真の置き方。もとの写真（refs/fish/suzuki.png、1672 × 941）の画素と模型の位置の対応は、魚を作った japan-scenery の fishgen.py と同じ：
* 模型 x = (x0 − 画素 x) / k、模型 y = (z0 − 画素 y) / k（口先から尾の先までを 0.6m に）。頭の写真は、そこから box = (x, y, 幅, 高さ) を切り出したもの
*/
var HEAD_PHOTO = {
	x0: 832,
	z0: 451.5,
	k: 2720
};
/**
* 頭の写真がある種類（species.ts の id → public/fish/ の名前の頭と、切り出した範囲 (x, y, 幅, 高さ)。scripts/fishgen/head_photos.py が書き出す）。
* 新しい glb は、写真の画素と模型の対応を extras.swim.photo に持っている（無ければシーバスの HEAD_PHOTO）
*/
var HEAD_FILES = {
	seabass: {
		file: "suzuki",
		box: [
			0,
			296,
			512,
			320
		]
	},
	aji: {
		file: "aji",
		box: [
			0,
			309,
			478,
			353
		]
	},
	tachiuo: {
		file: "tachiuo",
		box: [
			4,
			373,
			312,
			212
		]
	},
	sawara: {
		file: "sawara",
		box: [
			0,
			340,
			373,
			275
		]
	},
	kamasu: {
		file: "kamasu",
		box: [
			0,
			357,
			505,
			253
		]
	},
	buri: {
		file: "buri",
		box: [
			0,
			322,
			498,
			341
		]
	},
	hiramasa: {
		file: "hiramasa",
		box: [
			0,
			312,
			471,
			335
		]
	},
	magochi: {
		file: "magochi",
		box: [
			0,
			289,
			526,
			332
		]
	},
	kurodai: {
		file: "kurodai",
		box: [
			0,
			308,
			497,
			421
		]
	},
	saba: {
		file: "saba",
		box: [
			0,
			311,
			456,
			347
		]
	},
	madai: {
		file: "madai",
		box: [
			0,
			281,
			538,
			466
		]
	},
	kasago: {
		file: "kasago",
		box: [
			0,
			219,
			593,
			477
		]
	},
	mebaru: {
		file: "mebaru",
		box: [
			0,
			282,
			543,
			428
		]
	},
	kihada: {
		file: "kihada",
		box: [
			0,
			298,
			450,
			373
		]
	},
	isaki: {
		file: "isaki",
		box: [
			0,
			299,
			450,
			377
		]
	},
	kuchibuto: {
		file: "kuchibuto",
		box: [
			0,
			258,
			429,
			419
		]
	},
	shibudai: {
		file: "shibudai",
		box: [
			0,
			259,
			542,
			415
		]
	},
	onagagure: {
		file: "onagagure",
		box: [
			0,
			299,
			407,
			376
		]
	},
	isaki_young: {
		file: "isaki_young",
		box: [
			0,
			309,
			445,
			371
		]
	}
};
var blank = null;
/** 頭の写真がない種類に渡す、1 画素の透明なテクスチャ */
function blankTexture() {
	if (!blank) {
		blank = new THREE.DataTexture(new Uint8Array([
			0,
			0,
			0,
			0
		]), 1, 1);
		blank.needsUpdate = true;
	}
	return blank;
}
/** シェーダーに渡す (x, y) の折れ線（決まった数まで、最後の点を繰り返して埋める） */
function padXY(line, n) {
	const pts = (line ?? [[0, 0]]).map(([x, y]) => new THREE.Vector2(x, y));
	while (pts.length < n) pts.push(pts[pts.length - 1].clone());
	return pts.slice(0, n);
}
/** シェーダーに渡す折れ線（決まった数まで、最後の点を繰り返して埋める） */
function padLine(line, n) {
	const pts = (line ?? [[0, 0]]).map(([y, x]) => new THREE.Vector2(y, x));
	while (pts.length < n) pts.push(pts[pts.length - 1].clone());
	return pts.slice(0, n);
}
var cm = (pts) => pts.map(([x, y]) => [x / 100, y / 100]);
var MOUTHS = {
	seabass: {
		joint: [.238, -.018],
		close: .36,
		lowerLip: cm([
			[24.2, -1.3],
			[25.8, -1.2],
			[27.4, -1.2],
			[28.8, -1.2],
			[29.7, -1.3]
		]),
		under: cm([
			[23.8, -1.8],
			[24.4, -2.6],
			[25.4, -2.9],
			[26.8, -2.8],
			[28.1, -2.4],
			[29.3, -1.9],
			[29.9, -1.6]
		]),
		jawEdge: cm([
			[24.2, -1.3],
			[25.4, -.7],
			[26.5, 0],
			[27.5, .7],
			[28.85, 1.05]
		]),
		upper: cm([
			[28.5, 1.3],
			[28, .8],
			[27.5, .2],
			[27, -.4],
			[26.6, -1],
			[26.2, -1.7],
			[26, -2.2],
			[25.6, -2.6],
			[25.1, -2.7],
			[25.3, -2.8],
			[25.6, -2.7],
			[26, -2.3],
			[26.5, -1.7],
			[27.1, -.9],
			[27.8, -.2],
			[28.5, .4],
			[29, .6],
			[29.1, .8],
			[29, 1.2],
			[28.7, 1.4]
		]),
		upperPivot: [.29, .013],
		upperClose: .4,
		photoClose: .2
	},
	aji: {
		joint: [.104, -.012],
		close: 0,
		lowerLip: cm([
			[10.6, -1.1],
			[10.96, -.86],
			[11.34, -.63],
			[11.72, -.42],
			[12.09, -.18],
			[12.5, -.1]
		]),
		under: cm([
			[10.1, -1.7],
			[10.53, -1.48],
			[10.97, -1.27],
			[11.39, -1.03],
			[11.78, -.74],
			[12.16, -.44],
			[12.5, -.1]
		]),
		jawEdge: cm([
			[10.6, -1.04],
			[10.96, -.79],
			[11.34, -.57],
			[11.72, -.36],
			[12.09, -.11],
			[12.5, -.04]
		]),
		upper: cm([
			[12.3, .2],
			[12.05, .2],
			[11.84, .09],
			[11.64, -.04],
			[11.43, -.18],
			[11.23, -.32],
			[11.02, -.45],
			[10.82, -.59],
			[10.61, -.72],
			[10.5, -.91],
			[10.54, -1.14],
			[10.73, -1.11],
			[10.93, -.97],
			[11.11, -.79],
			[11.29, -.63],
			[11.49, -.49],
			[11.69, -.34],
			[11.89, -.21],
			[12.09, -.07],
			[12.31, .05]
		]),
		upperPivot: [.123, .003],
		upperClose: 0,
		upperOpen: .175,
		photoClose: 0
	},
	tachiuo: {
		joint: [.437, -.02],
		close: 0,
		lowerLip: cm([
			[44, -1.8],
			[45.14, -1.26],
			[46.32, -.81],
			[47.54, -.48],
			[48.8, -.4],
			[50, -.6]
		]),
		under: cm([
			[43.5, -2.5],
			[44.64, -2.39],
			[45.76, -2.11],
			[46.9, -1.92],
			[48.01, -1.65],
			[49.09, -1.24],
			[50, -.6]
		]),
		jawEdge: cm([
			[44, -1.55],
			[45.14, -1.01],
			[46.32, -.56],
			[47.54, -.23],
			[48.8, -.15],
			[50, -.35]
		]),
		upper: cm([
			[50, -.1],
			[49.43, .26],
			[48.77, .44],
			[48.1, .44],
			[47.56, .06],
			[47.01, -.33],
			[46.38, -.57],
			[45.73, -.79],
			[45.09, -1.01],
			[44.49, -1.35],
			[44.01, -1.8],
			[44.62, -1.49],
			[45.24, -1.22],
			[45.87, -.97],
			[46.52, -.74],
			[47.17, -.55],
			[47.84, -.43],
			[48.52, -.4],
			[49.2, -.4],
			[49.85, -.5]
		]),
		upperPivot: [.498, .002],
		upperClose: 0,
		upperOpen: .044,
		photoClose: 0
	},
	sawara: {
		joint: [.327, -.024],
		close: 0,
		lowerLip: cm([
			[33, -2],
			[34.41, -1.57],
			[35.82, -1.14],
			[37.23, -.71],
			[38.66, -.36],
			[40, -.5]
		]),
		under: cm([
			[32.7, -3.8],
			[34.03, -3.49],
			[35.34, -3.12],
			[36.63, -2.66],
			[37.87, -2.1],
			[39.08, -1.47],
			[40, -.5]
		]),
		jawEdge: cm([
			[33, -1.8],
			[34.41, -1.37],
			[35.82, -.94],
			[37.23, -.51],
			[38.66, -.16],
			[40, -.3]
		]),
		upper: cm([
			[39.5, .3],
			[38.83, .64],
			[38.05, .59],
			[37.34, .23],
			[36.79, -.34],
			[36.1, -.73],
			[35.36, -1.04],
			[34.59, -1.27],
			[33.83, -1.52],
			[33.11, -1.84],
			[32.73, -2.49],
			[33.27, -2.77],
			[33.87, -2.23],
			[34.51, -1.77],
			[35.22, -1.39],
			[35.98, -1.14],
			[36.74, -.89],
			[37.49, -.62],
			[38.25, -.36],
			[39.02, -.14]
		]),
		upperPivot: [.392, .007],
		upperClose: 0,
		upperOpen: .157,
		photoClose: 0
	},
	kamasu: {
		joint: [.131, -.011],
		close: 0,
		lowerLip: cm([
			[13.3, -.9],
			[14.1, -.59],
			[14.95, -.46],
			[15.79, -.28],
			[16.64, -.17],
			[17.5, -.1]
		]),
		under: cm([
			[12.5, -1.5],
			[13.35, -1.29],
			[14.21, -1.1],
			[15.07, -.91],
			[15.93, -.72],
			[16.78, -.51],
			[17.5, -.1]
		]),
		jawEdge: cm([
			[13.3, -.81],
			[14.1, -.5],
			[14.95, -.38],
			[15.79, -.19],
			[16.64, -.08],
			[17.5, -.01]
		]),
		upper: cm([
			[17.1, .2],
			[16.67, .27],
			[16.22, .16],
			[15.78, .06],
			[15.35, -.08],
			[14.92, -.23],
			[14.48, -.36],
			[14.05, -.49],
			[13.62, -.65],
			[13.24, -.89],
			[12.9, -1.2],
			[13.31, -1.02],
			[13.68, -.77],
			[14.12, -.63],
			[14.55, -.5],
			[14.99, -.39],
			[15.44, -.32],
			[15.88, -.22],
			[16.32, -.1],
			[16.77, -.02]
		]),
		upperPivot: [.169, .003],
		upperClose: 0,
		upperOpen: .044,
		photoClose: 0
	},
	buri: {
		joint: [.327, -.016],
		close: 0,
		lowerLip: cm([
			[33.1, -1],
			[34.45, -.86],
			[35.79, -.66],
			[37.13, -.45],
			[38.46, -.22],
			[39.8, 0]
		]),
		under: cm([
			[32.6, -5.1],
			[34.13, -4.44],
			[35.64, -3.73],
			[37.11, -2.93],
			[38.52, -2.04],
			[39.53, -.82],
			[39.9, -.8]
		]),
		jawEdge: cm([
			[33.1, -.8],
			[34.45, -.66],
			[35.79, -.46],
			[37.13, -.25],
			[38.46, -.02],
			[39.8, .2]
		]),
		upper: cm([
			[39.8, .2],
			[39.53, 1],
			[38.99, 1.13],
			[38.32, .6],
			[37.54, .23],
			[36.72, -.04],
			[35.87, -.24],
			[35.02, -.38],
			[34.16, -.51],
			[33.31, -.66],
			[33.06, -1.33],
			[33.27, -2.17],
			[33.78, -2.84],
			[34.59, -2.84],
			[35.28, -2.33],
			[35.98, -1.83],
			[36.72, -1.37],
			[37.49, -.99],
			[38.29, -.65],
			[39.05, -.23]
		]),
		upperPivot: [.392, .014],
		upperClose: 0,
		upperOpen: .175,
		photoClose: 0
	},
	hiramasa: {
		joint: [.375, -.037],
		close: 0,
		lowerLip: cm([
			[38.4, -3.5],
			[39.65, -2.79],
			[40.84, -2],
			[42.16, -1.45],
			[43.54, -1.08],
			[44.9, -1.3]
		]),
		under: cm([
			[37, -5.4],
			[38.42, -4.9],
			[39.81, -4.34],
			[41.18, -3.71],
			[42.51, -3.01],
			[43.8, -2.24],
			[44.9, -1.3]
		]),
		jawEdge: cm([
			[38.4, -3.27],
			[39.65, -2.57],
			[40.84, -1.77],
			[42.16, -1.23],
			[43.54, -.85],
			[44.9, -1.07]
		]),
		upper: cm([
			[44.8, -.5],
			[44.13, -.01],
			[43.25, -.07],
			[42.37, -.35],
			[41.47, -.49],
			[40.55, -.59],
			[39.66, -.83],
			[38.78, -1.08],
			[37.88, -1.29],
			[37.15, -1.74],
			[37.25, -2.63],
			[37.62, -3.46],
			[38.41, -3.49],
			[39.06, -2.84],
			[39.71, -2.19],
			[40.46, -1.67],
			[41.28, -1.26],
			[42.18, -1.1],
			[43.1, -.98],
			[44.01, -.86]
		]),
		upperPivot: [.439, .006],
		upperClose: 0,
		upperOpen: .175,
		photoClose: 0
	},
	magochi: {
		joint: [.182, -.017],
		close: 0,
		lowerLip: cm([
			[18.4, -1.5],
			[19.14, -1.11],
			[19.94, -.84],
			[20.75, -.64],
			[21.58, -.46],
			[22.4, -.3]
		]),
		under: cm([
			[17.7, -2.3],
			[18.64, -2.13],
			[19.57, -1.97],
			[20.5, -1.75],
			[21.4, -1.45],
			[22.21, -.97],
			[22.5, -.5]
		]),
		jawEdge: cm([
			[18.4, -1.39],
			[19.14, -1],
			[19.94, -.73],
			[20.75, -.52],
			[21.58, -.35],
			[22.4, -.19]
		]),
		upper: cm([
			[22.4, 0],
			[22.07, .3],
			[21.6, .23],
			[21.14, .07],
			[20.69, -.12],
			[20.24, -.31],
			[19.8, -.5],
			[19.35, -.69],
			[18.91, -.9],
			[18.48, -1.12],
			[18.2, -1.49],
			[18.54, -1.66],
			[18.91, -1.34],
			[19.33, -1.09],
			[19.77, -.9],
			[20.23, -.74],
			[20.71, -.62],
			[21.18, -.51],
			[21.65, -.39],
			[22.12, -.27]
		]),
		upperPivot: [.221, .004],
		upperClose: 0,
		upperOpen: .044,
		photoClose: 0
	},
	kurodai: {
		joint: [.168, -.028],
		close: 0,
		lowerLip: cm([
			[17.2, -2.6],
			[17.7, -2.38],
			[18.25, -2.3],
			[18.8, -2.28],
			[19.35, -2.2],
			[19.9, -2.2]
		]),
		under: cm([
			[16.6, -4.1],
			[17.24, -3.92],
			[17.87, -3.74],
			[18.49, -3.49],
			[19.07, -3.18],
			[19.61, -2.79],
			[19.9, -2.2]
		]),
		jawEdge: cm([
			[17.2, -2.5],
			[17.7, -2.28],
			[18.25, -2.2],
			[18.8, -2.18],
			[19.35, -2.1],
			[19.9, -2.1]
		]),
		upper: cm([
			[19.7, -1.3],
			[19.36, -1.44],
			[19.01, -1.56],
			[18.66, -1.68],
			[18.31, -1.8],
			[17.96, -1.91],
			[17.59, -1.98],
			[17.25, -2.12],
			[17.04, -2.39],
			[17.08, -2.74],
			[17.4, -2.8],
			[17.66, -2.54],
			[18, -2.38],
			[18.35, -2.28],
			[18.71, -2.21],
			[19.08, -2.2],
			[19.45, -2.2],
			[19.82, -2.2],
			[20, -1.93],
			[19.94, -1.58]
		]),
		upperPivot: [.197, -.013],
		upperClose: 0,
		upperOpen: .262,
		photoClose: 0
	},
	saba: {
		joint: [.143, -.016],
		close: 0,
		lowerLip: cm([
			[14.5, -1.5],
			[15.11, -1.23],
			[15.68, -.89],
			[16.25, -.55],
			[16.85, -.26],
			[17.5, -.1]
		]),
		under: cm([
			[14, -2],
			[14.65, -1.78],
			[15.29, -1.56],
			[15.89, -1.24],
			[16.46, -.87],
			[17.07, -.56],
			[17.5, -.1]
		]),
		jawEdge: cm([
			[14.5, -1.41],
			[15.11, -1.15],
			[15.68, -.8],
			[16.25, -.46],
			[16.85, -.17],
			[17.5, -.01]
		]),
		upper: cm([
			[17.4, 0],
			[17.34, .36],
			[17.02, .56],
			[16.98, .35],
			[16.76, .06],
			[16.44, -.15],
			[16.11, -.35],
			[15.78, -.55],
			[15.47, -.79],
			[15.16, -1.02],
			[14.83, -1.22],
			[14.47, -1.38],
			[14.66, -1.44],
			[15.02, -1.29],
			[15.35, -1.09],
			[15.68, -.89],
			[16.01, -.69],
			[16.35, -.49],
			[16.69, -.32],
			[17.05, -.17]
		]),
		upperPivot: [.171, .005],
		upperClose: 0,
		upperOpen: .175,
		photoClose: 0
	},
	madai: {
		joint: [.19, -.034],
		close: 0,
		lowerLip: cm([
			[19.3, -3.1],
			[19.9, -3.05],
			[20.49, -2.76],
			[21.1, -2.53],
			[21.75, -2.41],
			[22.4, -2.4]
		]),
		under: cm([
			[18, -5.1],
			[18.84, -4.82],
			[19.67, -4.49],
			[20.45, -4.09],
			[21.23, -3.66],
			[21.95, -3.14],
			[22.4, -2.4]
		]),
		jawEdge: cm([
			[19.3, -2.99],
			[19.9, -2.94],
			[20.49, -2.64],
			[21.1, -2.42],
			[21.75, -2.3],
			[22.4, -2.29]
		]),
		upper: cm([
			[22.4, -2.4],
			[22.47, -1.97],
			[22.34, -1.53],
			[22, -1.5],
			[21.68, -1.81],
			[21.27, -2.01],
			[20.84, -2.15],
			[20.4, -2.25],
			[19.96, -2.35],
			[19.53, -2.49],
			[19.08, -2.5],
			[18.97, -2.77],
			[19.14, -3.18],
			[19.51, -3.38],
			[19.86, -3.14],
			[20.22, -2.89],
			[20.63, -2.69],
			[21.06, -2.55],
			[21.5, -2.45],
			[21.95, -2.4]
		]),
		upperPivot: [.223, -.014],
		upperClose: 0,
		upperOpen: .262,
		photoClose: 0
	},
	kasago: {
		joint: [.083, -.016],
		close: 0,
		lowerLip: cm([
			[8.4, -1.5],
			[8.87, -1.16],
			[9.36, -.86],
			[9.86, -.57],
			[10.36, -.29],
			[10.9, -.1]
		]),
		under: cm([
			[7.9, -2.2],
			[8.54, -1.98],
			[9.17, -1.71],
			[9.73, -1.34],
			[10.3, -.97],
			[10.81, -.55],
			[11, -.3]
		]),
		jawEdge: cm([
			[8.4, -1.45],
			[8.87, -1.11],
			[9.36, -.81],
			[9.86, -.51],
			[10.36, -.23],
			[10.9, -.05]
		]),
		upper: cm([
			[10.9, 0],
			[10.79, .31],
			[10.54, .27],
			[10.26, .06],
			[9.95, -.12],
			[9.6, -.23],
			[9.26, -.35],
			[8.92, -.46],
			[8.57, -.57],
			[8.22, -.67],
			[8.12, -.93],
			[8.28, -1.26],
			[8.48, -1.45],
			[8.79, -1.27],
			[9.09, -1.07],
			[9.38, -.86],
			[9.68, -.65],
			[9.99, -.48],
			[10.31, -.3],
			[10.65, -.18]
		]),
		upperPivot: [.107, .004],
		upperClose: 0,
		upperOpen: .175,
		photoClose: 0
	},
	mebaru: {
		joint: [.087, -.016],
		close: 0,
		lowerLip: cm([
			[8.9, -1.4],
			[9.34, -1.06],
			[9.74, -.67],
			[10.18, -.32],
			[10.6, .05],
			[11, -.2]
		]),
		under: cm([
			[8.5, -2],
			[9, -1.84],
			[9.43, -1.54],
			[9.85, -1.22],
			[10.24, -.86],
			[10.63, -.51],
			[11, -.2]
		]),
		jawEdge: cm([
			[8.9, -1.34],
			[9.34, -1],
			[9.74, -.61],
			[10.18, -.26],
			[10.6, .1],
			[11, -.15]
		]),
		upper: cm([
			[10.5, .4],
			[10.35, .17],
			[10.17, -.03],
			[9.97, -.23],
			[9.75, -.39],
			[9.52, -.55],
			[9.29, -.71],
			[9.1, -.9],
			[8.93, -1.11],
			[8.8, -1.35],
			[8.9, -1.43],
			[9.13, -1.27],
			[9.32, -1.08],
			[9.52, -.88],
			[9.71, -.69],
			[9.92, -.51],
			[10.14, -.34],
			[10.34, -.16],
			[10.55, .02],
			[10.69, .21]
		]),
		upperPivot: [.105, .003],
		upperClose: 0,
		upperOpen: .175,
		photoClose: 0
	},
	kihada: {
		joint: [.4239, -.0418],
		close: 0,
		lowerLip: cm([
			[42.68, -3.88],
			[43.95, -2.96],
			[45.27, -2.1],
			[46.72, -1.49],
			[48.21, -.99],
			[49.75, -.69]
		]),
		under: cm([
			[41.69, -5.97],
			[43.16, -5.28],
			[44.6, -4.51],
			[45.97, -3.64],
			[47.31, -2.72],
			[48.62, -1.75],
			[49.75, -.69]
		]),
		jawEdge: cm([
			[42.68, -3.63],
			[43.95, -2.71],
			[45.27, -1.85],
			[46.72, -1.24],
			[48.21, -.74],
			[49.75, -.44]
		]),
		upper: cm([
			[49.55, .11],
			[48.77, .56],
			[47.86, .7],
			[47.1, .49],
			[46.79, -.37],
			[46.14, -1.01],
			[45.31, -1.42],
			[44.45, -1.74],
			[43.57, -1.99],
			[42.67, -2.21],
			[42.31, -2.91],
			[42.62, -3.75],
			[43.38, -3.53],
			[44.11, -2.97],
			[44.84, -2.41],
			[45.62, -1.92],
			[46.42, -1.46],
			[47.24, -1.05],
			[48.1, -.72],
			[48.97, -.41]
		]),
		upperPivot: [.4906, .005],
		upperClose: 0,
		upperOpen: .131,
		photoClose: 0
	},
	isaki: {
		joint: [.152, -.019],
		close: 0,
		lowerLip: cm([
			[15.5, -1.7],
			[15.82, -1.39],
			[16.19, -1.15],
			[16.59, -.96],
			[16.99, -.77],
			[17.4, -.6]
		]),
		under: cm([
			[14.7, -2.6],
			[15.36, -2.44],
			[15.94, -2.11],
			[16.5, -1.73],
			[17.04, -1.33],
			[17.35, -.75],
			[17.5, -.7]
		]),
		jawEdge: cm([
			[15.5, -1.61],
			[15.82, -1.3],
			[16.19, -1.07],
			[16.59, -.87],
			[16.99, -.68],
			[17.4, -.51]
		]),
		upper: cm([
			[17.1, 0],
			[16.89, -.21],
			[16.67, -.43],
			[16.44, -.62],
			[16.19, -.8],
			[15.92, -.94],
			[15.64, -1.06],
			[15.36, -1.18],
			[15.22, -1.39],
			[15.3, -1.69],
			[15.51, -1.89],
			[15.67, -1.64],
			[15.88, -1.42],
			[16.11, -1.22],
			[16.35, -1.04],
			[16.62, -.89],
			[16.89, -.75],
			[17.16, -.62],
			[17.4, -.46],
			[17.34, -.17]
		]),
		upperPivot: [.171, 0],
		upperClose: 0,
		upperOpen: .131,
		photoClose: 0
	},
	kuchibuto: {
		joint: [.181, -.021],
		close: 0,
		lowerLip: cm([
			[18.3, -1.9],
			[18.5, -1.6],
			[18.76, -1.34],
			[19.06, -1.13],
			[19.36, -.93],
			[19.7, -.8]
		]),
		under: cm([
			[17.7, -3.1],
			[18.27, -2.81],
			[18.78, -2.42],
			[19.23, -1.97],
			[19.69, -1.51],
			[19.7, -.88],
			[19.9, -.9]
		]),
		jawEdge: cm([
			[18.3, -1.8],
			[18.5, -1.5],
			[18.76, -1.24],
			[19.06, -1.03],
			[19.36, -.83],
			[19.7, -.7]
		]),
		upper: cm([
			[19.5, .2],
			[19.66, -.03],
			[19.81, -.27],
			[19.9, -.52],
			[19.72, -.69],
			[19.48, -.82],
			[19.24, -.97],
			[19.01, -1.13],
			[18.8, -1.3],
			[18.6, -1.5],
			[18.43, -1.72],
			[18.27, -1.85],
			[18.23, -1.59],
			[18.3, -1.32],
			[18.42, -1.07],
			[18.57, -.83],
			[18.76, -.64],
			[18.96, -.44],
			[19.15, -.23],
			[19.3, 0]
		]),
		upperPivot: [.195, .002],
		upperClose: 0,
		upperOpen: .157,
		photoClose: 0
	},
	shibudai: {
		joint: [.158, -.027],
		close: 0,
		lowerLip: cm([
			[16.2, -2.2],
			[16.87, -1.77],
			[17.58, -1.41],
			[18.29, -1.06],
			[19.02, -.76],
			[19.8, -.6]
		]),
		under: cm([
			[15.4, -3.9],
			[16.36, -3.47],
			[17.28, -2.97],
			[18.22, -2.52],
			[19.09, -1.93],
			[19.73, -1.2],
			[20, -1]
		]),
		jawEdge: cm([
			[16.2, -2.1],
			[16.87, -1.67],
			[17.58, -1.31],
			[18.29, -.96],
			[19.02, -.66],
			[19.8, -.5]
		]),
		upper: cm([
			[19.8, -.5],
			[19.79, .01],
			[19.35, .05],
			[18.96, -.34],
			[18.5, -.65],
			[18.02, -.92],
			[17.55, -1.22],
			[17.05, -1.47],
			[16.56, -1.72],
			[16.04, -1.92],
			[15.69, -2.28],
			[15.77, -2.78],
			[16.18, -2.91],
			[16.47, -2.44],
			[16.89, -2.08],
			[17.33, -1.75],
			[17.79, -1.44],
			[18.27, -1.15],
			[18.76, -.88],
			[19.27, -.68]
		]),
		upperPivot: [.195, .002],
		upperClose: 0,
		upperOpen: .175,
		photoClose: 0
	},
	onagagure: {
		joint: [.207, -.022],
		close: 0,
		lowerLip: cm([
			[21, -2],
			[21.3, -1.8],
			[21.6, -1.6],
			[21.9, -1.4],
			[22.2, -1.2],
			[22.5, -1]
		]),
		under: cm([
			[20.4, -3.5],
			[20.79, -3.11],
			[21.23, -2.77],
			[21.63, -2.37],
			[22.02, -1.97],
			[22.34, -1.52],
			[22.5, -1]
		]),
		jawEdge: cm([
			[21, -1.89],
			[21.3, -1.69],
			[21.6, -1.49],
			[21.9, -1.29],
			[22.2, -1.09],
			[22.5, -.89]
		]),
		upper: cm([
			[22.5, -.6],
			[22.35, -.37],
			[22.16, -.16],
			[21.97, .03],
			[21.84, -.07],
			[21.77, -.34],
			[21.7, -.6],
			[21.53, -.83],
			[21.36, -1.05],
			[21.2, -1.27],
			[21.04, -1.49],
			[20.91, -1.73],
			[21, -1.99],
			[21.22, -1.85],
			[21.45, -1.7],
			[21.68, -1.55],
			[21.91, -1.39],
			[22.14, -1.24],
			[22.37, -1.09],
			[22.5, -.88]
		]),
		upperPivot: [.219, .001],
		upperClose: 0,
		upperOpen: .105,
		photoClose: 0
	},
	isaki_young: {
		joint: [.108, -.015],
		close: 0,
		lowerLip: cm([
			[11.1, -1.3],
			[11.38, -1.12],
			[11.62, -.89],
			[11.89, -.7],
			[12.17, -.52],
			[12.5, -.5]
		]),
		under: cm([
			[10.3, -2],
			[10.73, -1.83],
			[11.15, -1.66],
			[11.54, -1.42],
			[11.91, -1.14],
			[12.29, -.88],
			[12.5, -.5]
		]),
		jawEdge: cm([
			[11.1, -1.24],
			[11.38, -1.06],
			[11.62, -.83],
			[11.89, -.64],
			[12.17, -.46],
			[12.5, -.44]
		]),
		upper: cm([
			[12.2, 0],
			[12.08, -.18],
			[11.93, -.34],
			[11.75, -.47],
			[11.57, -.59],
			[11.39, -.71],
			[11.2, -.83],
			[11.02, -.94],
			[10.9, -1.09],
			[10.98, -1.28],
			[11.13, -1.37],
			[11.29, -1.21],
			[11.44, -1.06],
			[11.6, -.9],
			[11.78, -.78],
			[11.96, -.66],
			[12.15, -.54],
			[12.34, -.43],
			[12.5, -.29],
			[12.4, -.1]
		]),
		upperPivot: [.122, 0],
		upperClose: 0,
		upperOpen: .175,
		photoClose: 0
	}
};
/** 折れ線 (x, y) の、x での y（端より外は端の y） */
function lineXofX(line, x) {
	if (x <= line[0][0]) return line[0][1];
	for (let i = 0; i + 1 < line.length; i++) {
		const [x0, y0] = line[i];
		const [x1, y1] = line[i + 1];
		if (x <= x1) return y0 + (y1 - y0) * (x - x0) / Math.max(x1 - x0, 1e-9);
	}
	return line[line.length - 1][1];
}
/** 口の中を抜く所（下唇の線と上あごの骨の縁の間、と上あごの多角形）の x の範囲。シェーダーはこの外では抜くかどうか調べない */
function mouthCutX(m) {
	const ux = m.upper.map((p) => p[0]);
	return [Math.min(m.jawEdge[0][0], ...ux), Math.max(m.lowerLip[m.lowerLip.length - 1][0] + .002, ...ux)];
}
/** 多角形の中なら正、外なら負の、辺までの距離 */
function polyInside(poly, x, y) {
	let inside = false;
	let d = Infinity;
	for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
		const [xi, yi] = poly[i];
		const [xj, yj] = poly[j];
		if (yi > y !== yj > y && x < (xj - xi) * (y - yi) / (yj - yi) + xi) inside = !inside;
		const ex = xj - xi;
		const ey = yj - yi;
		const t = THREE.MathUtils.clamp(((x - xi) * ex + (y - yi) * ey) / Math.max(ex * ex + ey * ey, 1e-12), 0, 1);
		d = Math.min(d, Math.hypot(x - xi - ex * t, y - yi - ey * t));
	}
	return inside ? d : -d;
}
/**
* 下あごと一緒に回る所の上の端の高さ：唇の線。唇の線の前の端より前（下あごの先の丸み）は、唇の線より 4mm 上まで下あご
* （残すと、のびた三角形が口先から垂れる）。口を閉じた写真の種類は上げない（唇の線の先が口先で、その上は上あごの先。体を唇の線で
* 切り離すので垂れず、上げると上あごの先の白い皮が下あごと一緒に下がって、下あごの先に白い三角に見える）
*/
function lipCut(m, x) {
	const end = m.lowerLip[m.lowerLip.length - 1][0];
	return lineXofX(m.lowerLip, x) + (m.close > 0 && x > end ? .004 : 0);
}
/**
* 口を閉じた写真の種類は、唇の線（lipCut）をまたぐ体の三角形を上と下に切り分け、切り口の頂点を上と下で別にする。
* 口を開くと、上あごと下あごの間がつながらずに開いて、向こう側が見える（つながったままだと、のびた三角形が膜のように見える）。
* 切るのは、下あごの重みがかかり始める所（関節の 8mm 手前）より前。口の角より後ろも切らないと、体の三角形の大きい種類（タチウオ）では、
* 口の角の後ろの三角形が口の中を斜めに横切ってのびる。関節の近くはほとんど動かないので、すき間は口の角から関節へ細くなって閉じる
*/
function splitAtLip(geo, m) {
	const index = geo.getIndex();
	const pos = geo.getAttribute("position");
	const fin = geo.getAttribute("_fin");
	if (!index || !pos || !fin) return;
	const names = Object.keys(geo.attributes);
	const attrs = names.map((n) => geo.getAttribute(n));
	const offsets = [];
	let stride = 0;
	for (const a of attrs) {
		offsets.push(stride);
		stride += a.itemSize;
	}
	const iPos = offsets[names.indexOf("position")];
	const vert = (i) => {
		const v = [];
		attrs.forEach((a) => {
			for (let k = 0; k < a.itemSize; k++) v.push(comp(a, i, k));
		});
		return v;
	};
	const corner = Math.min(m.lowerLip[0][0], m.joint[0] - .008);
	const front = Math.max(...m.under.map((p) => p[0])) + .015;
	const f = (v) => v[iPos + 1] - lipCut(m, v[iPos]);
	const added = [];
	const sides = [];
	const keys = /* @__PURE__ */ new Map();
	const addVert = (v, side) => {
		const key = `${side},${v[iPos].toFixed(6)},${v[iPos + 1].toFixed(6)},${v[iPos + 2].toFixed(6)}`;
		const found = keys.get(key);
		if (found !== void 0) return found;
		const id = pos.count + added.length;
		added.push(v.slice());
		sides.push(side);
		keys.set(key, id);
		return id;
	};
	const keep = [];
	const tris = [];
	for (let t = 0; t < index.count; t += 3) {
		const ids = [
			index.getX(t),
			index.getX(t + 1),
			index.getX(t + 2)
		];
		const tri = ids.map(vert);
		const xs = tri.map((v) => v[iPos]);
		const fs = tri.map(f);
		if (ids.some((i) => partOf(fin, i) !== 0) || Math.max(...xs) < corner || Math.min(...xs) > front || fs.every((x) => x >= 0) || fs.every((x) => x < 0)) {
			keep.push(...ids);
			continue;
		}
		for (const side of [1, -1]) {
			const poly = [];
			const own = [];
			for (let k = 0; k < 3; k++) {
				const a = tri[k];
				const b = tri[(k + 1) % 3];
				const fa = fs[k];
				const fb = fs[(k + 1) % 3];
				if (fa >= 0 === side > 0) {
					poly.push(a);
					own.push(true);
				}
				if (fa >= 0 !== fb >= 0) {
					const s = fa / (fa - fb);
					poly.push(a.map((x, j) => x + (b[j] - x) * s));
					own.push(false);
				}
			}
			if (poly.length < 3) continue;
			const vs = poly.map((v, k) => own[k] ? ids[tri.indexOf(v)] : addVert(v, side));
			for (let k = 1; k + 1 < vs.length; k++) tris.push(vs[0], vs[k], vs[k + 1]);
		}
	}
	if (!tris.length) return;
	const total = pos.count + added.length;
	attrs.forEach((a, n) => {
		const arr = new Float32Array(total * a.itemSize);
		for (let i = 0; i < pos.count; i++) for (let k = 0; k < a.itemSize; k++) arr[i * a.itemSize + k] = comp(a, i, k);
		added.forEach((v, j) => {
			for (let k = 0; k < a.itemSize; k++) arr[(pos.count + j) * a.itemSize + k] = v[offsets[n] + k];
		});
		geo.setAttribute(names[n], new THREE.BufferAttribute(arr, a.itemSize));
	});
	const idx = new Uint32Array(keep.length + tris.length);
	idx.set(keep);
	idx.set(tris, keep.length);
	geo.setIndex(new THREE.BufferAttribute(idx, 1));
	geo.computeBoundingSphere();
	const lipSide = new Int8Array(total);
	lipSide.set(sides, pos.count);
	geo.userData.lipSide = lipSide;
}
/**
* あごの重み（頂点属性 jaw.x）：体の頂点が下あごの板と一緒に回る度合い。唇の線より下で関節より前は 1（板の裏に隠れる）、
* 下あごの下側の線から 8mm（模型）かけて、関節の後ろへも 8mm かけて 0 へ（のどの皮をなだらかにのばす）。唇の線より上（口の中）は 0
* （口の中を動かすと、つながった上あごの三角形が下へ引かれて、上あごの先がくちばしのように曲がる）。
* 口の形を決めていない種類は 0（属性だけ作る）
*/
function addJawWeights(geo, mouth) {
	const fin = geo.getAttribute("_fin");
	const pos = geo.getAttribute("position");
	if (!fin || !pos) return;
	const w = new Float32Array(pos.count * 2);
	if (mouth) {
		const front = Math.max(...mouth.under.map((p) => p[0]));
		for (let i = 0; i < pos.count; i++) {
			if (partOf(fin, i) !== 0) continue;
			const x = pos.getX(i);
			const y = pos.getY(i);
			if (x > front + .015) continue;
			const yLip = lipCut(mouth, x);
			const side = geo.userData.lipSide?.[i] ?? 0;
			if (side > 0) continue;
			let k;
			if (side < 0 || y <= yLip) {
				k = 1 - THREE.MathUtils.smoothstep(lineXofX(mouth.under, x) - y, 0, .008);
				if (mouth.close === 0) {
					const span = front - mouth.joint[0];
					k = Math.max(k, THREE.MathUtils.smoothstep(x, front - .6 * span, front - .3 * span));
				}
			} else continue;
			w[i * 2] = k * THREE.MathUtils.smoothstep(x, mouth.joint[0] - .008, mouth.joint[0]);
		}
	}
	geo.setAttribute("jaw", new THREE.BufferAttribute(w, 2));
}
/**
* 目（部位 6）の回る中心を作る（マダイの lowpoly_lite.py と同じ：左右それぞれの目の頂点の平均が目玉の中心）。
* 中心があれば、シェーダーが目をきょろきょろ動かし、見ている人を目で追う。glb に中心が入っている種類は触らない。
* 片方の目の中心と半径（体の横から見た大きさ）を返す
*/
function addEyePivots(geo) {
	const fin = geo.getAttribute("_fin");
	const piv = geo.getAttribute("_piv");
	const pos = geo.getAttribute("position");
	if (!fin || !piv || !pos) return null;
	const eye = [];
	for (let i = 0; i < pos.count; i++) if (partOf(fin, i) === 6) eye.push(i);
	if (!eye.length || eye.some((i) => piv.getX(i) !== 0 || piv.getY(i) !== 0 || piv.getZ(i) !== 0)) return null;
	let out = null;
	for (const side of [1, -1]) {
		const vs = eye.filter((i) => Math.sign(pos.getZ(i)) === side);
		if (!vs.length) continue;
		const c = new THREE.Vector3();
		for (const i of vs) c.add(new THREE.Vector3(pos.getX(i), pos.getY(i), pos.getZ(i)));
		c.divideScalar(vs.length);
		for (const i of vs) piv.setXYZ(i, c.x, -c.z, c.y);
		if (!out) {
			let r = 0;
			for (const i of vs) r = Math.max(r, Math.hypot(pos.getX(i) - c.x, pos.getY(i) - c.y));
			out = new THREE.Vector3(c.x, c.y, r);
		}
	}
	piv.needsUpdate = true;
	return out;
}
/** 頂点属性の i 番目の k 成分 */
var comp = (a, i, k) => k === 0 ? a.getX(i) : k === 1 ? a.getY(i) : k === 2 ? a.getZ(i) : a.getW(i);
/**
* 体の一部を切り抜いて、別に動く板にする（えらぶた・下あご）。体の三角形を limits（横から見た模型の (x, y) で、どれも 0 以上なら中）
* で切り抜いて写し、体から lift だけ浮かせて、縁に厚み thick を付ける。写真は体と同じ所なので、動かさなければ今までと同じに見える。
* part は部位の番号、_FIN.y には weight(x, y) を入れる（シェーダーが動かすのに使う）。sidesOnly なら体の横の面だけ（頭の上や下の面は入れない）。
* 縁の厚みは、rim(x, y) が両端とも true の辺だけに付ける（体につながっている辺に付けると、そこが光って白い線に見える）
*/
function cutPlate(geo, o) {
	const index = geo.getIndex();
	const pos = geo.getAttribute("position");
	const fin = geo.getAttribute("_fin");
	if (!index || !pos || !geo.getAttribute("normal") || !fin) return;
	const names = Object.keys(geo.attributes);
	const attrs = names.map((n) => geo.getAttribute(n));
	const offsets = [];
	let stride = 0;
	for (const a of attrs) {
		offsets.push(stride);
		stride += a.itemSize;
	}
	const at = (n) => offsets[names.indexOf(n)];
	const iPos = at("position");
	const iNor = at("normal");
	const iFin = at("_fin");
	const vert = (i) => {
		const v = [];
		attrs.forEach((a) => {
			for (let k = 0; k < a.itemSize; k++) v.push(comp(a, i, k));
		});
		return v;
	};
	const limits = o.limits.map((f) => (v) => f(v[iPos], v[iPos + 1]));
	const clip = (poly, f) => {
		const out = [];
		for (let k = 0; k < poly.length; k++) {
			const a = poly[k];
			const b = poly[(k + 1) % poly.length];
			const fa = f(a);
			const fb = f(b);
			if (fa >= 0) out.push(a);
			if (fa >= 0 !== fb >= 0) {
				const t = fa / (fa - fb);
				out.push(a.map((x, j) => x + (b[j] - x) * t));
			}
		}
		return out;
	};
	const mid = (a, b) => a.map((x, j) => (x + b[j]) / 2);
	const subdivide = (tri) => {
		const s = o.subdiv;
		if (!s) return [tri];
		const [x0, x1, y0, y1] = s.box;
		const xs = tri.map((v) => v[iPos]);
		const ys = tri.map((v) => v[iPos + 1]);
		if (Math.max(...xs) < x0 || Math.min(...xs) > x1 || Math.max(...ys) < y0 || Math.min(...ys) > y1) return [tri];
		let out = [tri];
		for (let k = 0; k < s.n; k++) out = out.flatMap(([a, b, c]) => {
			const ab = mid(a, b);
			const bc = mid(b, c);
			const ca = mid(c, a);
			return [
				[
					a,
					ab,
					ca
				],
				[
					ab,
					b,
					bc
				],
				[
					ca,
					bc,
					c
				],
				[
					ab,
					bc,
					ca
				]
			];
		});
		return out;
	};
	const lift = o.lift;
	const thick = o.thick;
	const added = [];
	const keys = /* @__PURE__ */ new Map();
	const tris = [];
	const addVert = (v) => {
		const key = `${v[iPos].toFixed(6)},${v[iPos + 1].toFixed(6)},${v[iPos + 2].toFixed(6)}`;
		const found = keys.get(key);
		if (found !== void 0) return found;
		const id = pos.count + added.length;
		added.push(v);
		keys.set(key, id);
		return id;
	};
	for (let t = 0; t < index.count; t += 3) {
		const ids = [
			index.getX(t),
			index.getX(t + 1),
			index.getX(t + 2)
		];
		if (ids.some((i) => partOf(fin, i) !== 0)) continue;
		const tri = ids.map(vert);
		const nz = tri.reduce((s, v) => s + v[iNor + 2], 0) / 3;
		if (o.sidesOnly && Math.abs(nz) < .3) continue;
		for (let poly of subdivide(tri)) {
			for (const f of limits) poly = clip(poly, f);
			if (poly.length < 3) continue;
			const vs = poly.map((v) => {
				const w = v.slice();
				const n = new THREE.Vector3(w[iNor], w[iNor + 1], w[iNor + 2]).normalize();
				w[iPos] += n.x * lift;
				w[iPos + 1] += n.y * lift;
				w[iPos + 2] += n.z * lift;
				w[iNor] = n.x;
				w[iNor + 1] = n.y;
				w[iNor + 2] = n.z;
				w[iFin] = o.part;
				w[iFin + 1] = o.weight(w[iPos], w[iPos + 1]);
				w[iFin + 2] = 0;
				return addVert(w);
			});
			for (let k = 1; k + 1 < vs.length; k++) tris.push(vs[0], vs[k], vs[k + 1]);
		}
	}
	if (!tris.length) return;
	const edgeUse = /* @__PURE__ */ new Map();
	const ek = (a, b) => a < b ? `${a}_${b}` : `${b}_${a}`;
	for (let t = 0; t < tris.length; t += 3) for (let k = 0; k < 3; k++) {
		const e = ek(tris[t + k], tris[t + (k + 1) % 3]);
		edgeUse.set(e, (edgeUse.get(e) ?? 0) + 1);
	}
	const vOf = (i) => added[i - pos.count];
	const center = [
		0,
		0,
		0
	];
	for (const v of added) for (let k = 0; k < 3; k++) center[k] += v[iPos + k] / added.length;
	const flapTris = tris.length;
	for (let t = 0; t < flapTris; t += 3) for (let k = 0; k < 3; k++) {
		const a = tris[t + k];
		const b = tris[t + (k + 1) % 3];
		if (edgeUse.get(ek(a, b)) !== 1) continue;
		if (!o.rim(vOf(a)[iPos], vOf(a)[iPos + 1]) || !o.rim(vOf(b)[iPos], vOf(b)[iPos + 1])) continue;
		const rim = (i, depth) => {
			const w = vOf(i).slice();
			const n = new THREE.Vector3(w[iNor], w[iNor + 1], w[iNor + 2]);
			w[iPos] -= n.x * depth;
			w[iPos + 1] -= n.y * depth;
			w[iPos + 2] -= n.z * depth;
			const o = new THREE.Vector3(w[iPos] - center[0], w[iPos + 1] - center[1], 0).normalize();
			w[iNor] = o.x;
			w[iNor + 1] = o.y;
			w[iNor + 2] = 0;
			w[iFin + 2] = 1;
			return pos.count + added.push(w) - 1;
		};
		const [oa, ob, ia, ib] = [
			rim(a, 0),
			rim(b, 0),
			rim(a, thick),
			rim(b, thick)
		];
		tris.push(oa, ob, ib, oa, ib, ia);
	}
	const total = pos.count + added.length;
	attrs.forEach((a, n) => {
		const arr = new Float32Array(total * a.itemSize);
		for (let i = 0; i < pos.count; i++) for (let k = 0; k < a.itemSize; k++) arr[i * a.itemSize + k] = comp(a, i, k);
		added.forEach((v, j) => {
			for (let k = 0; k < a.itemSize; k++) arr[(pos.count + j) * a.itemSize + k] = v[offsets[n] + k];
		});
		geo.setAttribute(names[n], new THREE.BufferAttribute(arr, a.itemSize));
	});
	const idx = new Uint32Array(index.count + tris.length);
	for (let i = 0; i < index.count; i++) idx[i] = index.getX(i);
	idx.set(tris, index.count);
	geo.setIndex(new THREE.BufferAttribute(idx, 1));
	geo.computeBoundingSphere();
}
/**
* えらぶたを、体とは別の動く板にする（部位 7）。体の左右の、えらぶたの所の三角形を縁の曲線で切り抜いて写し、
* 体から少し浮かせて（体長の 0.2%）、縁に厚み（体長の 0.4%）を付ける。
* _FIN.y には、前の縁（ちょうつがい）からの距離（上の端ほど小さく、上の端では開かない）を入れる。シェーダーがこれで外へ開く
*/
function addGillCover(geo, g, length) {
	const edgeX = (y) => lineX(g.edge, y);
	const hingeX = (y) => lineX(g.hinge, y);
	cutPlate(geo, {
		limits: [
			(x, y) => x - edgeX(y),
			(x, y) => hingeX(y) - x,
			(_x, y) => g.top - y,
			(_x, y) => y - g.bottom
		],
		part: 7,
		lift: .002 * length,
		thick: .004 * length,
		sidesOnly: true,
		weight: (x, y) => Math.max(0, Math.min(hingeX(y), g.pivotMax) - x) * THREE.MathUtils.smoothstep(g.top - y, 0, .02 * length),
		rim: (x, y) => Math.min(hingeX(y), g.pivotMax) - x > .006 * length && g.top - y > .004 * length
	});
}
/**
* 下あごを、体とは別の動く板にする（部位 8）。唇の線 lipA（上あごの骨の縁を、口を閉じる角度だけ下へ回した線。写真の下唇とほぼ同じ）より下、
* 下あごの下側 under より上、関節より前の三角形を、左右と下の面ごと切り抜く（Codex に教えてもらったやり方）。
* 口を閉じると、板の上の縁（lipA）がちょうど上あごの骨の縁に重なる
*/
function addJawPlate(geo, m, length) {
	const lip = m.lowerLip;
	const front = Math.max(...m.under.map((p) => p[0]));
	const x0 = m.lowerLip[0][0];
	const raise = (x) => .003 * (1 - THREE.MathUtils.smoothstep(x, x0, x0 + .025));
	cutPlate(geo, {
		limits: [
			(x, y) => lineXofX(lip, x) + raise(x) - y,
			(x, y) => y - lineXofX(m.under, x),
			(x) => x - m.joint[0],
			(x) => front - x
		],
		part: 8,
		lift: .0015 * length,
		thick: .003 * length,
		sidesOnly: false,
		weight: () => 1,
		rim: (x, y) => lineXofX(lip, x) + raise(x) - y < .0015 && x > m.joint[0] + .004
	});
}
/**
* 上あご（前上顎骨と主上顎骨）を、体とは別の動く板にする（部位 9）。多角形 upper の中の三角形を、左右と上下の面ごと切り抜いて、
* 下あごの板より少し外へ浮かせる（開いた口では、写真のとおり下あごの後ろに重なる）
*/
function addUpperJawPlate(geo, m, length) {
	cutPlate(geo, {
		limits: m.close > 0 ? [(x, y) => polyInside(m.upper, x, y)] : [(x, y) => polyInside(m.upper, x, y), (x, y) => y - lipCut(m, x)],
		part: 9,
		lift: (m.close > 0 ? .0025 : .001) * length,
		thick: (m.close > 0 ? .003 : .0012) * length,
		sidesOnly: false,
		weight: () => 1,
		rim: (x, y) => Math.hypot(x - m.upperPivot[0], y - m.upperPivot[1]) > .004,
		subdiv: {
			box: [
				Math.min(...m.upper.map((p) => p[0])),
				Math.max(...m.upper.map((p) => p[0])),
				Math.min(...m.upper.map((p) => p[1])),
				Math.max(...m.upper.map((p) => p[1]))
			],
			n: m.close > 0 ? 3 : 2
		}
	});
}
/** 部位の番号（_FIN の x） */
var partOf = (fin, i) => Math.round(fin.getX(i));
/**
* ひれの縁の線を消す（どの種類も、テクスチャの上の 400 行が体、その下がひれの写真）。
* ひれの写真のいちばん上の行は体の写真のすぐ下にあるので、そのまま写すと、ひれの縁に体の色が細い線になって出る。
* ひれの頂点の v を、体の写真の下の端から 4 ピクセル離す。胴の頂点は、体の写真の下の端の 1 ピクセル内側までにする
*/
function fixFinEdges(geo, texHeight) {
	const fin = geo.getAttribute("_fin");
	const uv = geo.getAttribute("uv");
	if (!fin || !uv) return;
	let bodyV = 0;
	for (let i = 0; i < uv.count; i++) if (partOf(fin, i) === 0) bodyV = Math.max(bodyV, uv.getY(i));
	const minV = bodyV + 4 / texHeight;
	const maxV = bodyV - 1 / texHeight;
	for (let i = 0; i < uv.count; i++) {
		const p = partOf(fin, i);
		if (p !== 0 && p !== 6 && p !== 7 && uv.getY(i) < minV) uv.setY(i, minV);
		if (p === 0 && uv.getY(i) > maxV) uv.setY(i, maxV);
	}
	uv.needsUpdate = true;
}
/** 体の上下の輪郭と、ひれの板（三角形でつながった、背びれ・しりびれなど部位 1・2 の頂点のまとまり） */
function finLayout(geo) {
	const fin = geo.getAttribute("_fin");
	const pos = geo.getAttribute("position");
	const index = geo.getIndex();
	if (!fin || !pos || !index) return null;
	let x0 = Infinity;
	let x1 = -Infinity;
	for (let i = 0; i < pos.count; i++) {
		if (partOf(fin, i) !== 0) continue;
		x0 = Math.min(x0, pos.getX(i));
		x1 = Math.max(x1, pos.getX(i));
	}
	const N = 100;
	const top = new Float32Array(N).fill(-Infinity);
	const bottom = new Float32Array(N).fill(Infinity);
	const bin = (x) => THREE.MathUtils.clamp(Math.floor((x - x0) / (x1 - x0) * N), 0, 99);
	for (let i = 0; i < pos.count; i++) {
		if (partOf(fin, i) !== 0) continue;
		const b = bin(pos.getX(i));
		top[b] = Math.max(top[b], pos.getY(i));
		bottom[b] = Math.min(bottom[b], pos.getY(i));
	}
	for (const arr of [top, bottom]) {
		const filled = [...arr.keys()].filter((k) => Number.isFinite(arr[k]));
		if (!filled.length) continue;
		for (let k = 0; k < N; k++) {
			if (Number.isFinite(arr[k])) continue;
			const a = filled.filter((j) => j < k).pop();
			const b = filled.find((j) => j > k);
			arr[k] = a === void 0 ? arr[b] : b === void 0 ? arr[a] : arr[a] + (arr[b] - arr[a]) * (k - a) / (b - a);
		}
	}
	const bodyAt = (x, upper) => {
		const b = bin(x);
		let y = upper ? Infinity : -Infinity;
		for (let k = Math.max(0, b - 1); k <= Math.min(99, b + 1); k++) {
			if (upper && Number.isFinite(top[k])) y = Math.min(y, top[k]);
			if (!upper && Number.isFinite(bottom[k])) y = Math.max(y, bottom[k]);
		}
		return y;
	};
	let bodyTop = -Infinity;
	let bodyBottom = Infinity;
	for (let k = 0; k < N; k++) {
		if (Number.isFinite(top[k])) bodyTop = Math.max(bodyTop, top[k]);
		if (Number.isFinite(bottom[k])) bodyBottom = Math.min(bodyBottom, bottom[k]);
	}
	const bodyMid = (bodyTop + bodyBottom) / 2;
	const parent = new Int32Array(pos.count).map((_, i) => i);
	const root = (i) => parent[i] === i ? i : parent[i] = root(parent[i]);
	for (let t = 0; t < index.count; t += 3) {
		const a = index.getX(t);
		if (partOf(fin, a) === 0) continue;
		parent[root(index.getX(t + 1))] = root(a);
		parent[root(index.getX(t + 2))] = root(a);
	}
	const plates = /* @__PURE__ */ new Map();
	for (let i = 0; i < pos.count; i++) {
		const p = partOf(fin, i);
		if (p !== 1 && p !== 2) continue;
		const r = root(i);
		if (!plates.has(r)) plates.set(r, []);
		plates.get(r).push(i);
	}
	return {
		x0,
		x1,
		bodyAt,
		bodyMid,
		plates: [...plates.values()]
	};
}
/**
* ひれのはためきの重み（頂点属性 flutter）= (付け根 0 〜 縁 1, 前 0 〜 後ろ 1, ひれの番号)。胸びれ（部位 4）は、もとの重み（付け根 0 〜 先 1）。
* 背びれ・しりびれ・腹びれは体の表面からの高さ、尾びれは体の後ろの端からの距離で測り、板ごとにいちばん遠い所を 1 にする。
* 前後は板ごとに、いちばん前（口に近い所）を 0、いちばん後ろを 1 にする。番号は板ごとにばらばらの 0〜1（尾びれは -1：旗にしない）
*/
/** 尾びれのほかのひれは、はためかない（軽い固定版） */
function tailOnlyFlutter(geo) {
	const fin = geo.getAttribute("_fin");
	const fl = geo.getAttribute("flutter");
	if (!fin || !fl) return;
	for (let i = 0; i < fl.count; i++) if (partOf(fin, i) !== 3) fl.setX(i, 0);
	fl.needsUpdate = true;
}
function addFlutterWeights(geo) {
	const fin = geo.getAttribute("_fin");
	const pos = geo.getAttribute("position");
	if (!fin || !pos) return;
	const w = new Float32Array(pos.count * 3);
	const h = new Float32Array(pos.count);
	for (let i = 0; i < pos.count; i++) if (partOf(fin, i) === 4) w[i * 3] = fin.getY(i);
	const layout = finLayout(geo);
	if (layout) {
		const { x0, bodyAt, bodyMid, plates } = layout;
		const cx = plates.map((vs) => vs.reduce((s, i) => s + pos.getX(i), 0) / vs.length);
		const rank = cx.map((x) => cx.filter((o) => o > x).length);
		plates.forEach((vs, n) => {
			let ymin = Infinity;
			let ymax = -Infinity;
			let xmin = Infinity;
			let xmax = -Infinity;
			for (const i of vs) {
				ymin = Math.min(ymin, pos.getY(i));
				ymax = Math.max(ymax, pos.getY(i));
				xmin = Math.min(xmin, pos.getX(i));
				xmax = Math.max(xmax, pos.getX(i));
			}
			let upper = ymin > bodyMid;
			let lower = ymax < bodyMid;
			if (!upper && !lower && (xmin + xmax) / 2 > x0 + .15 * (layout.x1 - x0)) {
				upper = vs.reduce((s, i) => s + pos.getY(i), 0) / vs.length > bodyMid;
				lower = !upper;
			}
			const d = vs.map((i) => {
				const x = pos.getX(i);
				const y = pos.getY(i);
				const v = upper ? y - bodyAt(x, true) : lower ? bodyAt(x, false) - y : x0 - x;
				return Number.isFinite(v) ? Math.max(0, v) : 0;
			});
			const far = Math.max(...d);
			if (far <= 0) return;
			const id = upper || lower ? (rank[n] + 1) * .618034 % 1 : -1;
			vs.forEach((i, k) => {
				w[i * 3] = d[k] / far;
				w[i * 3 + 1] = xmax > xmin ? (xmax - pos.getX(i)) / (xmax - xmin) : 0;
				w[i * 3 + 2] = id;
				if (upper || lower) h[i] = upper ? d[k] : -d[k];
			});
		});
	}
	geo.setAttribute("flutter", new THREE.BufferAttribute(w, 3));
	geo.setAttribute("finH", new THREE.BufferAttribute(h, 1));
}
/**
* 背びれ・しりびれの付け根のすきまを埋める。ひれは縦の平らな板で、板は体の中まであるが、写真のひれは付け根が
* 体の表面より少し外で切れていて、体との間が透けて見える。写真のひれの付け根の色を、体の表面の少し内側（体長の 0.6%）まで
* 伸ばしたテクスチャを作って返す。板の上の位置と写真の位置の対応は、板ごとに頂点から求める。minV より上の行は触らない
*/
function fillFinBases(geo, map, length, minV) {
	const fin = geo.getAttribute("_fin");
	const uv = geo.getAttribute("uv");
	const pos = geo.getAttribute("position");
	const index = geo.getIndex();
	const img = map.image;
	if (!fin || !uv || !pos || !index || !img?.width) return map;
	const W = img.width;
	const H = img.height;
	const canvas = document.createElement("canvas");
	canvas.width = W;
	canvas.height = H;
	const ctx = canvas.getContext("2d", { willReadFrequently: true });
	if (!ctx) return map;
	ctx.drawImage(img, 0, 0);
	const data = ctx.getImageData(0, 0, W, H);
	const px = data.data;
	const layout = finLayout(geo);
	if (!layout) return map;
	const { x0, x1, bodyAt, bodyMid, plates } = layout;
	const inset = .006 * length;
	const maxGap = .01 * length;
	for (const vs of plates) {
		let sx = 0, sy = 0, sxx = 0, sxy = 0, syy = 0, su = 0, sxu = 0, syu = 0, sv = 0, sxv = 0, syv = 0;
		let ymin = Infinity, ymax = -Infinity, umin = Infinity, umax = -Infinity, vmin = Infinity, vmax = -Infinity;
		for (const i of vs) {
			const x = pos.getX(i), y = pos.getY(i), u = uv.getX(i) * W, v = uv.getY(i) * H;
			sx += x;
			sy += y;
			sxx += x * x;
			sxy += x * y;
			syy += y * y;
			su += u;
			sxu += x * u;
			syu += y * u;
			sv += v;
			sxv += x * v;
			syv += y * v;
			ymin = Math.min(ymin, y);
			ymax = Math.max(ymax, y);
			umin = Math.min(umin, u);
			umax = Math.max(umax, u);
			vmin = Math.min(vmin, v);
			vmax = Math.max(vmax, v);
		}
		const upper = ymin > bodyMid;
		if (!upper && ymax > bodyMid) continue;
		const m = new THREE.Matrix3().set(sxx, sxy, sx, sxy, syy, sy, sx, sy, vs.length);
		if (Math.abs(m.determinant()) < 1e-12) continue;
		m.invert();
		const cu = new THREE.Vector3(sxu, syu, su).applyMatrix3(m);
		const cv = new THREE.Vector3(sxv, syv, sv).applyMatrix3(m);
		const inv = new THREE.Matrix3().set(cu.x, cu.y, cu.z, cv.x, cv.y, cv.z, 0, 0, 1);
		if (Math.abs(inv.determinant()) < 1e-12) continue;
		inv.invert();
		const p = new THREE.Vector3();
		const v0 = Math.max(Math.ceil(vmin), Math.ceil(minV * H));
		const v1 = Math.min(Math.floor(vmax), H - 1);
		for (let u = Math.max(0, Math.ceil(umin)); u <= Math.min(W - 1, Math.floor(umax)); u++) {
			let vo = -1;
			if (upper) {
				for (let v = v1; v >= v0 && vo < 0; v--) if (px[(v * W + u) * 4 + 3] >= 128) vo = v;
			} else for (let v = v0; v <= v1 && vo < 0; v++) if (px[(v * W + u) * 4 + 3] >= 128) vo = v;
			if (vo < 0) continue;
			p.set(u, vo, 1).applyMatrix3(inv);
			if (p.x < x0 || p.x > x1) continue;
			const yIn = upper ? bodyAt(p.x, true) - inset : bodyAt(p.x, false) + inset;
			if (!Number.isFinite(yIn)) continue;
			if ((upper ? p.y - yIn : yIn - p.y) > inset + maxGap) continue;
			const vIn = Math.round(cv.x * p.x + cv.y * yIn + cv.z);
			const c = (THREE.MathUtils.clamp(upper ? vo - 3 : vo + 3, v0, v1) * W + u) * 4;
			const r = px[c];
			const g = px[c + 1];
			const b = px[c + 2];
			const a0 = upper ? vo + 1 : Math.max(vIn, v0);
			const a1 = upper ? Math.min(vIn, v1) : vo - 1;
			for (let v = a0; v <= a1; v++) {
				const k = (v * W + u) * 4;
				px[k] = r;
				px[k + 1] = g;
				px[k + 2] = b;
				px[k + 3] = 255;
			}
		}
	}
	ctx.putImageData(data, 0, 0);
	const tex = new THREE.CanvasTexture(canvas);
	tex.colorSpace = map.colorSpace;
	tex.flipY = map.flipY;
	tex.wrapS = map.wrapS;
	tex.wrapT = map.wrapT;
	tex.anisotropy = map.anisotropy;
	map.dispose();
	return tex;
}
/**
* 写真の魚を読み込んでおく（無いファイルは飛ばし、その種類は手続きで作った形のまま。?nophotofish で全部手続きの形）。
* pick.only：この種類だけ読む、pick.skip：この種類は読まない（省けば全部）。
* pick.lo = false なら遠い形（_lo.glb）を読まない（ゲーム。掛かるまでの魚は軽い固定版で描き、細かい形で描くのは掛かった 1 匹だけなので、
* 遠くでも細かい形のまま描く。ファイルは確認ページのために残してある）。
* pick.fixed = false なら軽い固定版（_lo3.glb）を読まない（配布用の魚のキット。_lo3 は入れていない）
*/
async function loadPhotoFish(base = `/fish/`, pick = {}) {
	if (new URLSearchParams(location.search).has("nophotofish")) return;
	const loader = new GLTFLoader();
	const want = Object.entries(FILES).filter(([id]) => (!pick.only || pick.only.includes(id)) && !pick.skip?.includes(id));
	const lo = pick.lo === false ? null : "_lo";
	await Promise.all(want.map(async ([id, file]) => {
		await loadOne(loader, base, id, file, lo);
		if (pick.fixed !== false) await loadOne(loader, base, id, file, FIXED_SUFFIX, id + FIXED_SUFFIX + "_fixed", true, true);
	}));
}
var urlOf = (base, name) => typeof base === "string" ? base + name : base(name);
/** 写真の魚がある種類の id と、public/fish/ のファイル名（配布用の魚のキットが一覧に使う） */
function photoFishFiles() {
	return { ...FILES };
}
/** 軽い固定版の形のファイル名の後ろ（scripts/fishgen で FISH_LOD=3。画像は入れず、細かい形の画像を使う） */
var FIXED_SUFFIX = "_lo3";
/**
* 軽い固定版でも、細かい形の画像を使わず、固定版の glb に入れた自分の画像を使う種類。シーバスは細かい形の glb を別の生成スクリプト
* （japan-scenery）で作ったので、画像の中のひれの並べ方が違い、細かい形の画像を貼るとひれの模様がずれる
*/
var OWN_FIXED_TEXTURE = /* @__PURE__ */ new Set(["seabass"]);
/**
* 1 種類を読み込んで assets に入れる。loSuffix が null なら遠い形を読まない。needLo なら遠い形のファイルが無いときは入れない。
* fixed は軽い固定版（loadPhotoFishVariant）
*/
async function loadOne(loader, base, id, file, loSuffix = "_lo", key = id, needLo = false, fixed = false) {
	try {
		const hi0 = fixed ? null : first(await loader.loadAsync(urlOf(base, `${file}.glb`)));
		if (!fixed && !hi0) return;
		const lo0 = loSuffix === null ? null : await loader.loadAsync(urlOf(base, `${file}${loSuffix}.glb`)).then(first, () => null);
		if ((needLo || fixed) && !lo0) return;
		const hi = fixed ? lo0 : hi0;
		const lo = fixed ? null : lo0;
		const fileTris = {
			hi: triCount(hi.geometry),
			lo: lo ? triCount(lo.geometry) : 0
		};
		const swim = hi.userData.swim;
		const shared = fixed && !OWN_FIXED_TEXTURE.has(id) ? assets.get(id)?.map ?? null : null;
		const photo = shared ?? hi.material.map;
		if (!photo) return;
		const texHeight = photo.image?.height ?? 640;
		let bodyV = 0;
		const fin = hi.geometry.getAttribute("_fin");
		const uvs = hi.geometry.getAttribute("uv");
		if (fin && uvs) {
			for (let i = 0; i < uvs.count; i++) if (partOf(fin, i) === 0) bodyV = Math.max(bodyV, uvs.getY(i));
		}
		const map = shared ?? fillFinBases(hi.geometry, photo, swim.length, bodyV + 4 / texHeight);
		const mouth = fixed ? null : MOUTHS[id] ?? null;
		fixFinEdges(hi.geometry, texHeight);
		addFlutterWeights(hi.geometry);
		if (fixed) tailOnlyFlutter(hi.geometry);
		if (lo) {
			fixFinEdges(lo.geometry, texHeight);
			addFlutterWeights(lo.geometry);
		}
		const gill = fixed ? null : GILLS[id] ?? null;
		if (gill) {
			addGillCover(hi.geometry, gill, swim.length);
			if (lo) addGillCover(lo.geometry, gill, swim.length);
		}
		if (mouth) {
			if (mouth.close === 0) {
				splitAtLip(hi.geometry, mouth);
				if (lo) splitAtLip(lo.geometry, mouth);
			}
			addJawPlate(hi.geometry, mouth, swim.length);
			addUpperJawPlate(hi.geometry, mouth, swim.length);
			if (lo) {
				addJawPlate(lo.geometry, mouth, swim.length);
				addUpperJawPlate(lo.geometry, mouth, swim.length);
			}
		}
		addJawWeights(hi.geometry, mouth);
		if (lo) addJawWeights(lo.geometry, mouth);
		const still = fixed || STILL.has(id);
		const eye = still ? null : addEyePivots(hi.geometry);
		if (eye && lo) addEyePivots(lo.geometry);
		map.anisotropy = 4;
		map.wrapS = map.wrapT = THREE.ClampToEdgeWrapping;
		let photos = null;
		const hf = HEAD_FILES[id];
		if (hf && gill) {
			const tl = new THREE.TextureLoader();
			const load = async (f) => {
				const t = await tl.loadAsync(urlOf(base, f));
				t.colorSpace = THREE.SRGBColorSpace;
				t.flipY = false;
				t.anisotropy = 4;
				t.needsUpdate = true;
				return t;
			};
			photos = await Promise.all([load(`${hf.file}_head.webp`), load(`${hf.file}_cover.webp`)]).then(([head, cover]) => ({
				head,
				cover
			}), () => null);
		}
		const [x0, z0, k] = swim.photo ?? [
			HEAD_PHOTO.x0,
			HEAD_PHOTO.z0,
			HEAD_PHOTO.k
		];
		const headMap = {
			x0,
			z0,
			k,
			box: hf?.box ?? [
				0,
				0,
				1,
				1
			]
		};
		const foldMax = FOLD_MAX[id] ?? 1.1;
		assets.set(key, {
			hi: hi.geometry,
			lo: lo?.geometry ?? null,
			map,
			swim,
			gill,
			mouth,
			eye,
			photos,
			headMap,
			still,
			foldMax,
			fileTris,
			tailFlutter: fixed
		});
	} catch {}
}
/** glb の中のいちばん初めの形 */
function first(gltf) {
	let mesh = null;
	gltf.scene.traverse((o) => {
		if (!mesh && o.isMesh) mesh = o;
	});
	return mesh;
}
var triCount = (g) => g ? (g.index ? g.index.count : g.attributes.position.count) / 3 : 0;
/** 確認ページ用：形の三角形の数（細かい / 粗い。file は glb のままの数）、テクスチャの大きさ、泳ぎの値 */
function photoFishInfo(id) {
	const a = assets.get(id);
	if (!a) return null;
	const img = a.map.image;
	return {
		hi: triCount(a.hi),
		lo: triCount(a.lo),
		file: a.fileTris,
		texture: `${img?.width ?? "?"}×${img?.height ?? "?"}`,
		swim: a.swim
	};
}
new THREE.Matrix4();
new THREE.Matrix4();
/** まとめて描く軽い固定版の 1 匹（操作は buildPhotoFish と同じ。目・ひれ・えらぶた・口は動かないので、その操作は何もしない） */
function buildBatchedFish(key, a, length, batches) {
	const root = new THREE.Group();
	const anchor = new THREE.Object3D();
	const s = length / a.swim.length;
	anchor.scale.setScalar(s);
	anchor.rotation.y = -Math.PI / 2;
	anchor.position.z = s * (.47 * a.swim.length - a.swim.snout);
	root.add(anchor);
	const m = {
		anchor,
		swim: new THREE.Vector4(0, 1, 0, 0),
		neck: new THREE.Vector4(0, .23, .43, 0),
		flut: new THREE.Vector4(0, 0, 0, 0),
		head: 1,
		power: 0,
		shade: 0
	};
	const batch = batches.get(key, a);
	batch.add(m);
	const env = a.swim.env ?? [
		.02,
		-.08,
		.16
	];
	const tipEnv = env[0] + env[1] + env[2];
	return {
		root,
		shadows: [batch.shadow],
		/** もう使わない（まとまりから外す） */
		dispose() {
			batch.remove(m);
		},
		detail(_on) {},
		shade(opacity) {
			m.shade = opacity;
		},
		swim(phase, amp, bend = 0) {
			m.swim.set(phase / (Math.PI * 2), amp / (a.swim.amp * tipEnv), THREE.MathUtils.clamp(bend, -4, 4) * s, 0);
		},
		lieOnFloor(_up) {},
		lookAtViewer(_amount) {},
		finMove(_clock, _tilt, _fold, _steer, _wobble = 0, _pect = 0, _whim = 0) {},
		mouth(_open) {},
		mouthMax: 0,
		gill(_open) {},
		/** 尾びれのはためき（ほかのひれは、はためかない形になっている） */
		flutter(clock, amp, flag = 0, seed = 0) {
			m.flut.set(clock, amp, flag, seed);
		},
		flex(neck, from, to, cBend, head, power = 0) {
			m.neck.set(neck, from, to, THREE.MathUtils.clamp(cBend, -6, 6) * s);
			m.head = head;
			m.power = power;
		}
	};
}
/**
* 写真の魚を 1 匹作る。+Z が頭で、口先が体長の 47% 前に来る（手続きの魚と同じ置き方）。
* swim(phase, amp, bend)：phase は尾の位相 rad、amp は尾の先の振れ / 体長、bend は体の曲がり 1/m。
* batches を渡すと、まとめて描く（軽い固定版だけ。目・ひれ・えらぶた・口は動かさない）
*/
function buildPhotoFish(id, length, batches) {
	const a = assets.get(id);
	if (!a) return null;
	if (batches) return buildBatchedFish(id, a, length, batches);
	const { material, uniforms } = swimMaterial(a);
	const root = new THREE.Group();
	const lod = new THREE.LOD();
	const s = length / a.swim.length;
	lod.scale.setScalar(s);
	lod.rotation.y = -Math.PI / 2;
	lod.position.z = s * (.47 * a.swim.length - a.swim.snout);
	const shadeU = {
		...uniforms,
		uShade: { value: 0 },
		uShadeColor: { value: new THREE.Color(397332) }
	};
	const shadowMat = shadowMaterial(a.map, shadeU);
	const shadows = [];
	const level = (geo) => {
		const mesh = new THREE.Mesh(geo, material);
		const sh = new THREE.Mesh(geo, shadowMat);
		sh.renderOrder = 3;
		sh.visible = false;
		mesh.add(sh);
		shadows.push(sh);
		return mesh;
	};
	lod.addLevel(level(a.hi), 0);
	const loDist = 2.5 + length * 8;
	if (a.lo) lod.addLevel(level(a.lo), loDist, .1);
	root.add(lod);
	const env = a.swim.env ?? [
		.02,
		-.08,
		.16
	];
	const tipEnv = env[0] + env[1] + env[2];
	let lastPhase = 0;
	let flap = Math.random();
	return {
		root,
		shadows,
		/** 細かい形を使うか。false なら粗い形に切り替わる距離を 0 にして、近くでも粗い形で描く */
		detail(on) {
			const l = lod.levels[1];
			if (l) l.distance = on ? loDist : 0;
		},
		/** 水の上から見える影の濃さ 0〜1（0 で出さない） */
		shade(opacity) {
			shadeU.uShade.value = opacity;
			for (const s of shadows) s.visible = opacity > .005;
		},
		/** time：目を動かす時計 秒（省けばいまの時刻。配布用の魚のキットはスローにするとき自分の時計を渡す） */
		swim(phase, amp, bend = 0, time = performance.now() / 1e3) {
			const cyc = phase / (Math.PI * 2);
			const slow = THREE.MathUtils.clamp(1 - (amp - .04) / .06, 0, 1);
			flap += Math.max(0, cyc - lastPhase) * .8;
			lastPhase = cyc;
			uniforms.uTime.value = time;
			uniforms.uSwim.value.set(cyc, amp / (a.swim.amp * tipEnv), THREE.MathUtils.clamp(bend, -4, 4) * s, a.still ? 0 : .03 + slow * .08);
			if (a.still) uniforms.uFin.value.set(0, 0, 1, 0);
			else uniforms.uFin.value.set(flap, slow * .3, .15 + slow * .6, slow * .5);
		},
		/** 床に横たわっている：模型の横（+Z）が上を向いている度合い -1〜1（0 は床なし）。体を床へは曲げない */
		lieOnFloor(up) {
			uniforms.uFloor.value = up;
		},
		/** 見ている人を目で追う度合い 0〜1（釣り上げられた魚） */
		lookAtViewer(amount) {
			uniforms.uLookAt.value = amount;
		},
		/**
		* ひれを根元から動かす：時計 秒、横へ傾ける振れ rad、後ろへ畳む度合い 0〜1、舵の角度 rad、
		* ひれごとにゆっくり開け閉めする振れ 0〜1、胸びれを開く角度 rad、ひれごとに気まぐれに閉じたり広げたりする大きさ 0〜1
		*/
		finMove(clock, tilt, fold, steer, wobble = 0, pect = 0, whim = 0) {
			if (a.still) return;
			uniforms.uFinMove.value.set(clock, tilt, fold, steer);
			uniforms.uFinMove2.value.set(wobble, pect, whim, a.foldMax);
		},
		/** 下あごを開く角度 rad（口の形を決めてある種類だけ） */
		mouth(open) {
			uniforms.uMouth.value = a.mouth ? open : 0;
		},
		mouthMax: a.mouth ? a.mouth.close + .35 : 0,
		/** えらぶたを開く角度 rad（えらぶたを作ってある種類だけ） */
		gill(open) {
			uniforms.uGill.value = a.gill ? open : 0;
		},
		/** ひれのはためき：ひれの時計 秒、縁の細かい揺れと旗のような振れ（体長に対して）、1 匹ごとの乱数 0〜1 */
		flutter(clock, amp, flag = 0, seed = 0) {
			if (a.still && !a.tailFlutter) return;
			uniforms.uFlut.value.set(clock, amp, flag, seed);
		},
		/** 首で曲げる角度 rad（from〜to で）、首振りの C 字の曲がり 1/m、泳ぐときの頭の振れの倍率、体全体を使って泳ぐ度合い 0〜1 */
		flex(neck, from, to, cBend, head, power = 0) {
			uniforms.uNeck.value.set(neck, from, to, THREE.MathUtils.clamp(cBend, -6, 6) * s);
			uniforms.uHead.value = head;
			uniforms.uPower.value = power;
		}
	};
}
// fish-species.js
var ALL_SPECIES = [
	{
		"name": "アジ",
		"id": "aji",
		"en": "Horse Mackerel",
		"lengthCm": [16, 48],
		"bodyHeight": .25,
		"cruise": .4,
		"burst": 2,
		"glide": .35,
		"hoverPitch": 0,
		"finFlutter": .008,
		"finFlag": .035,
		"finMove": 1
	},
	{
		"name": "メバル",
		"id": "mebaru",
		"en": "Rockfish",
		"lengthCm": [17, 33],
		"bodyHeight": .32,
		"cruise": .25,
		"burst": 1.5,
		"glide": .5,
		"hoverPitch": .35,
		"finFlutter": .008,
		"finFlag": .035,
		"finMove": 1
	},
	{
		"name": "カサゴ",
		"id": "kasago",
		"en": "Scorpionfish",
		"lengthCm": [15, 33],
		"bodyHeight": .3,
		"cruise": .15,
		"burst": 1.2,
		"glide": .9,
		"hoverPitch": 0,
		"finFlutter": .008,
		"finFlag": .035,
		"finMove": 1
	},
	{
		"name": "シーバス",
		"id": "seabass",
		"en": "Seabass",
		"lengthCm": [50, 95],
		"bodyHeight": .24,
		"cruise": .6,
		"burst": 3.5,
		"glide": .3,
		"hoverPitch": 0,
		"finFlutter": .008,
		"finFlag": .035,
		"finMove": 1
	},
	{
		"name": "サバ",
		"id": "saba",
		"en": "Mackerel",
		"lengthCm": [20, 40],
		"bodyHeight": .2,
		"cruise": .6,
		"burst": 4,
		"glide": .25,
		"hoverPitch": 0,
		"finFlutter": .008,
		"finFlag": .035,
		"finMove": 1
	},
	{
		"name": "タチウオ",
		"id": "tachiuo",
		"en": "Cutlassfish",
		"lengthCm": [65, 145],
		"bodyHeight": .07,
		"cruise": .3,
		"burst": 2.5,
		"glide": .6,
		"hoverPitch": 0,
		"upright": 1.31,
		"maxBend": .08,
		"finFlutter": .008,
		"finFlag": .035,
		"finMove": 1
	},
	{
		"name": "サワラ",
		"id": "sawara",
		"en": "Spanish Mackerel",
		"lengthCm": [50, 100],
		"bodyHeight": .16,
		"cruise": .8,
		"burst": 4.5,
		"glide": .25,
		"hoverPitch": 0,
		"finFlutter": .008,
		"finFlag": .035,
		"finMove": 1
	},
	{
		"name": "カマス",
		"id": "kamasu",
		"en": "Barracuda",
		"lengthCm": [22, 46],
		"bodyHeight": .13,
		"cruise": .5,
		"burst": 3,
		"glide": .3,
		"hoverPitch": 0,
		"finFlutter": .008,
		"finFlag": .035,
		"finMove": 1
	},
	{
		"name": "ブリ",
		"id": "buri",
		"en": "Yellowtail",
		"lengthCm": [40, 100],
		"bodyHeight": .22,
		"cruise": .9,
		"burst": 5,
		"glide": .25,
		"hoverPitch": 0,
		"finFlutter": .008,
		"finFlag": .035,
		"finMove": 1
	},
	{
		"name": "ヒラマサ",
		"id": "hiramasa",
		"en": "Kingfish",
		"lengthCm": [50, 110],
		"bodyHeight": .21,
		"cruise": 1,
		"burst": 5.5,
		"glide": .25,
		"hoverPitch": 0,
		"finFlutter": .008,
		"finFlag": .035,
		"finMove": 1
	},
	{
		"name": "マゴチ",
		"id": "magochi",
		"en": "Flathead",
		"lengthCm": [35, 65],
		"bodyHeight": .12,
		"cruise": .15,
		"burst": 2.5,
		"glide": .85,
		"hoverPitch": 0,
		"finFlutter": .008,
		"finFlag": .035,
		"finMove": 1
	},
	{
		"name": "クロダイ",
		"id": "kurodai",
		"en": "Black Sea Bream",
		"lengthCm": [28, 65],
		"bodyHeight": .38,
		"cruise": .35,
		"burst": 2.5,
		"glide": .5,
		"hoverPitch": 0,
		"finFlutter": .008,
		"finFlag": .035,
		"finMove": 1
	},
	{
		"name": "マダイ",
		"id": "madai",
		"en": "Red Sea Bream",
		"lengthCm": [28, 90],
		"bodyHeight": .38,
		"cruise": .4,
		"burst": 3,
		"glide": .5,
		"hoverPitch": 0,
		"finFlutter": .008,
		"finFlag": .035,
		"finMove": 1
	},
	{
		"name": "キハダ",
		"id": "kihada",
		"en": "Yellowfin Tuna",
		"lengthCm": [126, 150],
		"bodyHeight": .25,
		"cruise": 1.3,
		"burst": 7,
		"glide": .15,
		"hoverPitch": 0,
		"finFlutter": .006,
		"finFlag": .025,
		"finMove": 1
	},
	{
		"name": "イサキ",
		"id": "isaki",
		"en": "Chicken Grunt",
		"lengthCm": [22, 45],
		"bodyHeight": .27,
		"cruise": .4,
		"burst": 2.2,
		"glide": .4,
		"hoverPitch": 0,
		"finFlutter": .008,
		"finFlag": .035,
		"finMove": 1
	},
	{
		"name": "尾長グレ",
		"id": "onagagure",
		"en": "Largescale Blackfish",
		"lengthCm": [30, 62],
		"bodyHeight": .36,
		"cruise": .4,
		"burst": 3.2,
		"glide": .4,
		"hoverPitch": 0,
		"finFlutter": .008,
		"finFlag": .035,
		"finMove": 1
	},
	{
		"name": "口太グレ",
		"id": "kuchibuto",
		"en": "Opaleye",
		"lengthCm": [25, 52],
		"bodyHeight": .38,
		"cruise": .35,
		"burst": 2.6,
		"glide": .45,
		"hoverPitch": 0,
		"finFlutter": .008,
		"finFlag": .035,
		"finMove": 1
	},
	{
		"name": "シブダイ",
		"id": "shibudai",
		"en": "Star Snapper",
		"lengthCm": [40, 60],
		"bodyHeight": .33,
		"cruise": .35,
		"burst": 2.8,
		"glide": .5,
		"hoverPitch": 0,
		"finFlutter": .008,
		"finFlag": .035,
		"finMove": 1
	},
	{
		"name": "カタクチイワシ",
		"id": "katakuchi",
		"en": "Anchovy",
		"lengthCm": [8, 15],
		"bodyHeight": .17,
		"cruise": .4,
		"burst": 1.8,
		"glide": .2,
		"hoverPitch": 0
	}
];
var RESERVE_SPECIES = [];
var recordKey = (sp) => sp.name;
// src/game/fish/swim-style.ts
/** えらぶたをいちばん開く角度 rad（Codex に教えてもらった目安の、大きく開くときの上の 20°） */
var GILL_MAX = .35;
/** 呼吸の速さ 回/秒（どの場面でも同じ間で、えらと口を開け閉めし続ける） */
var BREATH_HZ = .8;
/**
* ゲームのしなり方（fish.html でシーバスを見比べて決めた）。首振りは頭のすぐ後ろ（口先から 4 割）でよく曲げ、
* 体全体も C 字に大きくしならせる。尾は首振りに合わせない。泳ぐときの頭の左右の揺れは小さく（写真の値の 2 割）
*/
var GAME_STYLE = {
	neckFlex: .65,
	neckAt: .4,
	bodyBend: 1.5,
	tailLock: 0,
	tailOffset: 0,
	recoil: .2,
	flutter: 1,
	flag: 1,
	finMove: 1,
	finWhim: .55,
	gill: 1,
	mouth: 1,
	burst: 1,
	airAmp: .35,
	airFreq: .5,
	airGill: 1.5,
	airMouth: 1.5
};
// src/kit/fish-kit.ts
var MOTIONS = [
	{
		id: "swim",
		ja: "ゆったり泳ぐ",
		en: "Cruise",
		noteJa: "ふだんの速さ。ゆっくりの魚は尾を数回振っては体をまっすぐにして滑るのをくり返す",
		noteEn: "Everyday cruising speed. Slow species beat the tail a few times, then glide with a straight body.",
		onLine: false
	},
	{
		id: "power",
		ja: "全速で泳ぐ",
		en: "Full speed",
		noteJa: "その魚のいちばん速い泳ぎ。頭から尾まで体全体を大きくうねらせ、ひれを畳む",
		noteEn: "Top speed. The whole body undulates from head to tail and the fins fold back.",
		onLine: false
	},
	{
		id: "turn",
		ja: "曲がる",
		en: "Turning",
		noteJa: "左右へゆっくり向きを変えながら泳ぐ。体が曲がる側へ弧になり、ひれを舵のように傾ける",
		noteEn: "Swims while slowly turning left and right. The body arcs into the turn and the fins steer.",
		onLine: false
	},
	{
		id: "hover",
		ja: "止まる",
		en: "Hover",
		noteJa: "その場に止まって呼吸する。胸びれで漕ぎ、目がきょろきょろ動く（メバルは頭を上げ、タチウオは立ち泳ぎ）",
		noteEn: "Holds still and breathes, sculling with the pectoral fins while the eyes dart around (some species tilt up or stand vertical).",
		onLine: false
	},
	{
		id: "range",
		ja: "口・えら・ひれを開く",
		en: "Full range",
		noteJa: "4 秒に 1 回、口とえらぶたをいっぱいに開け、ひれを大きく広げてから体にぴったり畳む（動かせる範囲の見本）",
		noteEn: "Every 4 s the mouth and gill covers open fully and the fins spread wide, then everything closes and folds flat (range-of-motion demo).",
		onLine: false
	},
	{
		id: "bite",
		ja: "くわえて首を振る",
		en: "Bite & shake",
		noteJa: "ルアーをくわえて小さく首を振る。首で曲げ、体も C 字にしなる",
		noteEn: "Holds a lure and shakes its head gently, bending at the neck with a C-shaped body.",
		onLine: true
	},
	{
		id: "hooked",
		ja: "掛かって暴れる",
		en: "Hooked fight",
		noteJa: "針に掛かり、大きく首を振って粘る。ひれをいっぱいに広げる",
		noteEn: "Hooked and fighting with big head shakes, fins spread wide.",
		onLine: true
	},
	{
		id: "tired",
		ja: "弱って横倒し",
		en: "Exhausted",
		noteJa: "力が抜けて横に倒れ、尾をゆっくり小さく振る",
		noteEn: "Worn out, rolls onto its side and beats the tail slowly.",
		onLine: true
	},
	{
		id: "air",
		ja: "空中で暴れる",
		en: "Out of water",
		noteJa: "抜き上げられて糸にぶら下がり、尾を振ってねじれる。えらと口を大きくあえがせ、目がこちらを見る",
		noteEn: "Lifted out on the line: hangs head-up, twists and kicks, gasps with mouth and gills, and looks at you.",
		onLine: true
	},
	{
		id: "landed",
		ja: "床で跳ねる",
		en: "Flopping",
		noteJa: "床に横たわってピチピチ跳ねる。はじめは強く、だんだん弱く（2.4 秒ごとにくり返す）",
		noteEn: "Lies on its side on the deck and flops, strong at first then weaker (repeats every 2.4 s).",
		onLine: false
	}
];
var ON_LINE = /* @__PURE__ */ new Set([
	"bite",
	"hooked",
	"tired",
	"air"
]);
/** イサキの幼魚は種類ではなく、イサキの小さい個体の姿（species.ts の young） */
var YOUNG = { isaki_young: {
	of: "isaki",
	ja: "イサキ（幼魚）",
	en: "Grunt (juvenile)",
	lengthCm: [15, 28]
} };
var speciesById = (id) => [...ALL_SPECIES, ...RESERVE_SPECIES].find((s) => s.id === id);
function paramsOf(id) {
	const sp = speciesById(YOUNG[id]?.of ?? id);
	return {
		cruise: sp.cruise,
		burst: sp.burst,
		glide: sp.glide,
		hoverPitch: sp.hoverPitch,
		upright: sp.upright ?? 0,
		maxBend: sp.maxBend ?? .15,
		finFlutter: sp.finFlutter ?? 0,
		finFlag: sp.finFlag ?? 0,
		finMove: sp.finMove ?? 0,
		bodyHeight: sp.bodyHeight
	};
}
/** 写真の魚がある種類の一覧 */
var FISH = Object.entries(photoFishFiles()).flatMap(([id, file]) => {
	const y = YOUNG[id];
	if (y) return [{
		id,
		file,
		ja: y.ja,
		en: y.en,
		lengthCm: y.lengthCm,
		typicalCm: (y.lengthCm[0] + y.lengthCm[1]) / 2
	}];
	const sp = speciesById(id);
	if (!sp) return [];
	const lengthCm = [sp.lengthCm[0], sp.lengthCm[1]];
	return [{
		id,
		file,
		ja: recordKey(sp, false),
		en: sp.en,
		lengthCm,
		typicalCm: Math.round((lengthCm[0] + lengthCm[1]) / 2 * 10) / 10
	}];
});
/**
* 魚の形を読み込む。baseUrl は glb と webp の置き場所（末尾の / まで。例 './fish/'）か、
* ファイル名（'aji.glb'、'aji_head.webp' など）から URL を返す関数（data: URL や blob: URL を返してもよい）。
* ids を省けば全部。読み込めなかった種類は createFish が null を返す
*/
async function loadFish(baseUrl, ids) {
	await loadPhotoFish(baseUrl, {
		only: ids,
		fixed: false
	});
}
/**
* glb ファイルの三角形の数とテクスチャの大きさ（読み込んでいなければ null）。
* 描くときは、読み込むときに切り出すえらぶた・あごの板と、ひれの付け根の分が足されて 2〜3 倍になる
*/
function fishStats(id) {
	const i = photoFishInfo(id);
	return i ? {
		hiTris: i.file.hi,
		loTris: i.file.lo,
		texture: i.texture
	} : null;
}
var rand = (a, b) => a + (b - a) * Math.random();
var clamp = THREE.MathUtils.clamp;
var smooth = THREE.MathUtils.smoothstep;
var AXIS_X = new THREE.Vector3(1, 0, 0);
var AXIS_Y = new THREE.Vector3(0, 1, 0);
var AXIS_Z = new THREE.Vector3(0, 0, 1);
/** 口先は体の真ん中から体長の 47% 前 */
var MOUTH = .47;
/** 水の外で、こちらを見ている間（2〜4 秒）と、きょろきょろ見回す間（0.8〜2 秒）をくり返す（fish-mesh.ts の ViewerGaze） */
var Gaze = class {
	on = true;
	left = 1 + Math.random() * 2;
	amount = 0;
	update(dt) {
		this.left -= dt;
		if (this.left <= 0) {
			this.on = !this.on;
			this.left = this.on ? 2 + Math.random() * 2 : .8 + Math.random() * 1.2;
		}
		this.amount += ((this.on ? 1 : 0) - this.amount) * Math.min(1, dt * 6);
		return this.amount;
	}
};
/** 首振りの大きさ rad（ゲームでは、くわえている 9°、掛かって粘る 14〜31°） */
var SHAKE = {
	bite: THREE.MathUtils.degToRad(9),
	hooked: THREE.MathUtils.degToRad(25),
	tired: .04
};
/**
* 1 匹の魚。object を scene に足し、毎フレーム update(dt) を呼ぶ。
* 向き：口が +Z、背中が +Y、体の真ん中が原点。大きさは実寸（m）
*/
var FishActor = class {
	/** scene に足すもの */
	object = new THREE.Group();
	info;
	/** 体長 m */
	length;
	/** 床で跳ねる（landed）ときの床の高さ（object の中の y） */
	floorY;
	motion = "swim";
	/** 体のしなり方（ゲームの値。変えると動きが変わる） */
	style = { ...GAME_STYLE };
	/**
	* 自分で泳がせるとき：泳ぐ速さ m/s と曲がる速さ rad/s（+ で左へ）。泳ぐ動き（swim・power・turn・hover）の間、
	* 決まった見本の速さの代わりに使い、尾の振り方・体の曲がり・ひれをそれに合わせる。null なら見本の速さ。
	* 動かすのは使う人：毎フレーム object を口の向き（+Z）へ currentSpeed × dt 進め、turnRate × dt だけ Y 軸まわりに回す
	*/
	drive = null;
	body = new THREE.Group();
	mesh;
	p;
	gaze = new Gaze();
	seed = Math.random() * 100;
	base = new THREE.Quaternion();
	time = Math.random() * 100;
	phase = Math.random() * 10;
	finClock = Math.random() * 100;
	finFold = 0;
	gillPhase = Math.random() * 10;
	mouthOpen = 0;
	shakePhase = Math.random() * 10;
	shakeAmp = 0;
	shakeAngle = 0;
	shakeShown = 0;
	roll = 0;
	pitch = 0;
	yaw = 0;
	exert = 0;
	speed = 0;
	prevSpeed = 0;
	decel = 0;
	intent = 0;
	turn = 0;
	thrust = 1;
	bursting = true;
	gaitT = Math.random();
	flop = 2.4;
	constructor(id, lengthCm) {
		const info = FISH.find((f) => f.id === id);
		if (!info) throw new Error(`unknown fish: ${id}`);
		this.info = info;
		this.length = (lengthCm ?? info.typicalCm) / 100;
		const mesh = buildPhotoFish(id, this.length);
		if (!mesh) throw new Error(`fish not loaded: ${id} (call loadFish first)`);
		this.mesh = mesh;
		this.p = paramsOf(id);
		this.floorY = -this.length * this.p.bodyHeight * .2;
		this.body.add(mesh.root);
		this.object.add(this.body);
	}
	/** 動きを変える（体の状態はなめらかにつながる） */
	setMotion(m) {
		if (m === this.motion) return;
		this.motion = m;
		this.flop = 2.4;
	}
	/** 'auto'：カメラから遠いと軽い形、'high'：いつも細かい形、'low'：いつも軽い形 */
	setDetail(d) {
		const lod = this.mesh.root.children[0];
		lod.autoUpdate = d === "auto";
		if (d !== "auto") lod.levels.forEach((l, i) => l.object.visible = d === "low" ? i === lod.levels.length - 1 : i === 0);
		else this.mesh.detail(true);
	}
	/** いま泳いでいる速さ m/s（ゆっくりの魚は尾を振っては滑るので、drive.speed のまわりで上下する） */
	get currentSpeed() {
		return this.speed;
	}
	/** 口先の位置（object の中の座標）。口から糸を描くのに使う */
	getMouth(out = new THREE.Vector3()) {
		return out.set(0, 0, this.length * MOUTH).applyQuaternion(this.body.quaternion);
	}
	/** dt 秒すすめる */
	update(dt) {
		const L = this.length;
		const m = this.motion;
		const p = this.p;
		const st = this.style;
		const lure = ON_LINE.has(m) || m === "landed";
		this.time += dt;
		const drive = this.drive;
		if (!lure) {
			const want = drive ? Math.max(0, drive.speed) : m === "swim" || m === "turn" ? p.cruise : m === "power" ? p.burst : 0;
			const bl = want / Math.max(L, .05);
			const inter = p.glide * (1 - smooth(bl, 1, 2.5));
			let target = want;
			let accel = 1.5;
			if (inter < .05) {
				this.thrust += (1 - this.thrust) * Math.min(1, dt * 4);
				this.intent = want;
			} else {
				this.gaitT -= dt;
				if (this.gaitT <= 0) {
					this.bursting = !this.bursting;
					this.gaitT = this.bursting ? rand(.3, .7) : rand(.3, 1.4) * inter * 2.5;
				}
				if (this.bursting) {
					this.thrust += (1 - this.thrust) * Math.min(1, dt * 8);
					target = want * (1 + inter * 1.5);
					accel = 3;
					this.intent = target;
				} else {
					this.thrust += (.12 - this.thrust) * Math.min(1, dt * 5);
					target = 0;
					accel = .8;
					this.intent = want;
				}
			}
			this.speed += (target - this.speed) * Math.min(1, dt * accel);
			let yawRate = 0;
			if (drive) yawRate = drive.turnRate;
			else if (m === "turn") {
				const k = this.bursting || inter < .05 ? 1 : .15;
				yawRate = .9 * Math.cos(this.time * .45) * k - .3 * this.yaw;
			}
			this.yaw = m === "turn" && !drive ? this.yaw + yawRate * dt : this.yaw * (1 - Math.min(1, dt * 2));
			this.turn += (yawRate - this.turn) * Math.min(1, dt * 5);
		} else {
			this.speed += (0 - this.speed) * Math.min(1, dt * 3);
			this.intent = 0;
			this.yaw *= 1 - Math.min(1, dt * 2);
			this.turn -= this.turn * Math.min(1, dt * 5);
		}
		this.shakeShown = this.shakeAngle;
		this.shakeAmp += ((SHAKE[m] ?? 0) - this.shakeAmp) * Math.min(1, dt * 4);
		const shakeHz = 1.3 / Math.sqrt(Math.max(L, .1));
		this.shakePhase += dt * Math.PI * 2 * shakeHz;
		this.shakeAngle = this.shakeAmp * Math.sin(this.shakePhase);
		let freq;
		let amp;
		let roll = clamp(-this.turn * .35, -.6, .6);
		let exert = 0;
		if (m === "landed") {
			this.flop -= dt;
			if (this.flop <= 0) this.flop = 2.4;
			const vigor = Math.max(.25, this.flop / 2.4);
			freq = 4 + 4 * vigor;
			amp = .12 + .25 * vigor;
			roll = -Math.PI / 2;
		} else if (m === "air") {
			freq = 7 * st.airFreq;
			amp = .3 * st.airAmp;
			roll = Math.sin(this.time * 9) * .7;
		} else if (m === "tired") {
			freq = 1.8;
			amp = .05;
			roll = -1.3;
		} else if (m === "hooked") {
			freq = 4.5;
			amp = .18;
		} else if (m === "bite") {
			freq = 4;
			amp = .11;
		} else {
			const bl = this.speed / Math.max(L, .05);
			freq = (4 * bl + 4) / 3 * (.35 + .65 * this.thrust);
			amp = (.035 + Math.min(bl / 6, 1) * .09) * (.2 + .8 * this.thrust);
			exert = smooth(bl, 3, 6);
		}
		exert *= st.burst;
		this.exert += (exert - this.exert) * Math.min(1, dt * 3);
		freq /= 1 + .8 * this.exert;
		amp *= 1 + .5 * this.exert;
		const lock = m === "bite" || m === "hooked" ? st.tailLock : 0;
		if (lock > 0) {
			freq = THREE.MathUtils.lerp(freq, shakeHz, lock);
			amp *= 1 + .6 * lock;
		}
		this.phase += dt * Math.PI * 2 * freq;
		if (lock > 0) {
			const d = this.shakePhase + st.tailOffset - this.phase;
			this.phase += Math.atan2(Math.sin(d), Math.cos(d)) * lock * Math.min(1, dt * 6);
		}
		const shaking = ON_LINE.has(m);
		const neck = shaking ? this.shakeShown * st.neckFlex : 0;
		const cBend = shaking ? -st.bodyBend * this.shakeShown / Math.max(L, .05) : 0;
		this.mesh.flex(neck, st.neckAt - .1, st.neckAt + .1, cBend, st.recoil, this.exert);
		const flow = lure ? 1 : Math.min(1, this.speed / Math.max(L, .05) / 3);
		this.finClock += dt * (1 + .6 * flow);
		const flag = p.finFlag * st.flag * (.6 + .7 * flow);
		this.mesh.flutter(this.finClock, p.finFlutter * st.flutter * (1 + .4 * flow), flag, this.seed % 1);
		const muscle = p.finMove * st.finMove;
		if (dt > 0) {
			const d = lure ? 0 : Math.max(0, (this.prevSpeed - this.speed) / dt) / Math.max(L, .05);
			this.decel += (d - this.decel) * Math.min(1, dt * 6);
			this.prevSpeed = this.speed;
		}
		const plan = this.finPlan(m);
		this.finFold += (plan.fold - this.finFold) * Math.min(1, dt * 3);
		const steer = lure ? 0 : clamp(this.turn * .3, -.35, .35);
		const pect = .6 * (.25 - .15 * this.finFold + Math.min(.3, this.decel * .1));
		const m1 = Math.min(1, muscle);
		if (m === "range") {
			const s = .5 - .5 * Math.cos(this.time * Math.PI * .5);
			this.mesh.finMove(this.finClock, .4 * s, 1 - s, 0, 0, -.6 + 1.02 * s, 0);
			this.mesh.gill(GILL_MAX * s);
			this.mesh.mouth(this.mesh.mouthMax * s);
		} else {
			this.mesh.finMove(this.finClock, plan.sway * muscle, this.finFold * m1, steer * muscle, plan.wobble * m1, pect * muscle, st.finWhim * m1);
			this.gillPhase += dt * Math.PI * 2 * BREATH_HZ;
			const gill = GILL_MAX * (.5 - .5 * Math.cos(this.gillPhase));
			const mouth = .6 * (this.mesh.mouthMax || .35) * (.5 - .5 * Math.cos(this.gillPhase + 1.4));
			this.mouthOpen += (mouth - this.mouthOpen) * Math.min(1, dt * 12);
			const aloft = m === "air";
			this.mesh.gill(gill * st.gill * (aloft ? st.airGill : 1));
			this.mesh.mouth(this.mouthOpen * st.mouth * (aloft ? st.airMouth : 1));
		}
		this.mesh.lookAtViewer(m === "air" || m === "landed" ? this.gaze.update(dt) : 0);
		let bend = -this.turn / Math.max(this.speed, .15, .5 * L);
		const most = p.maxBend / (.325 * .65 * L);
		bend = clamp(bend, -most, most);
		this.mesh.swim(this.phase, amp, bend, this.time);
		this.roll += (roll - this.roll) * Math.min(1, dt * 4);
		this.mesh.lieOnFloor(m === "landed" ? -Math.sin(this.roll) : 0);
		const bl = Math.max(this.speed, this.intent) / Math.max(L, .05);
		let pitch = lure ? 0 : p.hoverPitch * (1 - smooth(bl, .5, 2));
		if (!lure && p.upright) pitch = Math.max(pitch, p.upright * (1 - smooth(bl, .1, .35)));
		this.pitch += (pitch - this.pitch) * Math.min(1, dt * 1.5);
		const up = m === "air" ? -Math.PI / 2 : 0;
		this.base.slerp(new THREE.Quaternion().setFromAxisAngle(AXIS_X, up), Math.min(1, dt * 6));
		const q = this.body.quaternion;
		q.setFromAxisAngle(AXIS_Y, this.yaw + (shaking ? this.shakeShown : 0)).multiply(this.base);
		q.multiply(new THREE.Quaternion().setFromAxisAngle(AXIS_X, -this.pitch));
		q.multiply(new THREE.Quaternion().setFromAxisAngle(AXIS_Z, this.roll));
	}
	/** ひれの開き具合（fold：0 いっぱいに開く〜1 畳む）、横へ傾ける振れ、ひれごとにばらばらに開け閉めする振れ */
	finPlan(m) {
		let r;
		if (m === "landed" || m === "air") r = [
			.3,
			.4,
			.6
		];
		else if (m === "tired") r = [
			.55,
			.08,
			.5
		];
		else if (m === "hooked") r = [
			.3,
			.35,
			.6
		];
		else if (m === "bite") r = [
			.35,
			.25,
			.6
		];
		else {
			const fast = smooth(this.speed / Math.max(this.length, .05), 1.5, 4);
			r = [
				.4 + .35 * fast,
				.2 - .14 * fast,
				.6 - .2 * fast
			];
			r[0] -= Math.min(.4, this.decel * .12) + Math.min(.2, Math.abs(this.turn) * .1);
		}
		return {
			fold: clamp(r[0], 0, 1),
			sway: r[1],
			wobble: r[2]
		};
	}
	/** scene から外して、この魚の材質を捨てる（形とテクスチャは読み込んだまま、ほかの魚と共有） */
	dispose() {
		this.object.removeFromParent();
		this.object.traverse((o) => {
			const mesh = o;
			if (mesh.isMesh) mesh.material.dispose();
		});
	}
};
/** 魚を 1 匹作る（loadFish で読み込んだあと）。lengthCm を省けばふつうの大きさ */
function createFish(id, lengthCm) {
	return new FishActor(id, lengthCm);
}
export { FISH, FishActor, MOTIONS, createFish, fishStats, loadFish };
