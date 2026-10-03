// ============================================================
//  ギャルゲーエンジン
// ============================================================
const $ = s => document.querySelector(s);
const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- 画面スケーリング ----------
function fit() {
  const s = Math.min(innerWidth / 1280, innerHeight / 720);
  $('#stage').style.transform = `translate(-50%, -50%) scale(${s})`;
}
addEventListener('resize', fit); fit();

// ---------- 状態 ----------
const SAVE_KEY = window.LIVE ? 'sakura-memorial-live-save' : 'sakura-memorial-save';
let S = null;
const newState = name => ({ name, day: 1, slot: 0, aff: { hina: 0, rena: 0, minori: 0 }, ev: { hina: 0, rena: 0, minori: 0 }, known: { hina: 1, rena: 1, minori: 1 }, last: null });
const save = () => { try { localStorage.setItem(SAVE_KEY, JSON.stringify(S)); } catch (e) {} };
const loadSave = () => { try { return JSON.parse(localStorage.getItem(SAVE_KEY)); } catch (e) { return null; } };

const opts = { auto: false, skip: false, mute: false };
const backlog = [];

// ---------- 日付 ----------
function dateOf(day) {
  const d = new Date(START_DATE); let n = 0;
  while (n < day) { d.setDate(d.getDate() + 1); if (d.getDay() !== 0 && d.getDay() !== 6) n++; }
  return d;
}
const WEEK = ['日', '月', '火', '水', '木', '金', '土'];

// ---------- 背景 ----------
let bgFlip = false;
function setBg(key) {
  const url = `url("${BGS[key]}")`;
  const a = $('#bg'), b = $('#bg2');
  const [front, back] = bgFlip ? [a, b] : [b, a];
  if (back.style.backgroundImage === url && back.style.opacity !== '0') return;
  front.style.backgroundImage = url;
  front.style.opacity = 1; back.style.opacity = 0;
  if (front === a) { a.style.zIndex = 1; b.style.zIndex = 0; } else { b.style.zIndex = 1; a.style.zIndex = 0; }
  bgFlip = !bgFlip;
}

// ---------- 桜吹雪 ----------
let petalTimer = null;
function petals(on) {
  clearInterval(petalTimer); petalTimer = null;
  if (!on) return;
  petalTimer = setInterval(() => {
    const p = document.createElement('div'); p.className = 'petal';
    p.style.left = Math.random() * 1400 - 100 + 'px';
    p.style.setProperty('--dx', (Math.random() * 300 - 60) + 'px');
    p.style.setProperty('--rot', (Math.random() * 900 - 450) + 'deg');
    const dur = 5 + Math.random() * 5; p.style.animationDuration = dur + 's';
    p.style.transform = `scale(${0.6 + Math.random() * 0.8})`;
    $('#petals').appendChild(p); setTimeout(() => p.remove(), dur * 1000);
  }, 220);
}

// ---------- 立ち絵 ----------
const sprites = {};
const POS = { left: '27%', center: '50%', right: '73%' };
function show(key, at = 'center') {
  let el = sprites[key];
  if (!el) {
    const c = CHARS[key];
    el = document.createElement('div'); el.className = 'sprite';
    el.innerHTML = `<img class="f-normal" src="${c.img}">` + (c.happy ? `<img class="f-happy" src="${c.happy}">` : '');
    $('#sprites').appendChild(el); sprites[key] = el;
  }
  el.style.left = POS[at];
  requestAnimationFrame(() => el.classList.add('show'));
}
function hide(key) {
  const keys = key === 'all' ? Object.keys(sprites) : [key];
  keys.forEach(k => { const el = sprites[k]; if (!el) return; el.classList.remove('show'); delete sprites[k]; setTimeout(() => el.remove(), 500); });
}
// 表情: ^ 喜び(笑顔差分+ジャンプ) / * 照れ(笑顔差分+頬の光) / _ 落ち込み / ! 驚き / ~ 通常
function setFace(el, happy) { el.classList.toggle('happy', happy); }
function emote(key, e) {
  const el = sprites[key]; if (!el) return;
  if (e === '^') { setFace(el, true); retrigger(el, 'hop'); el.classList.remove('sad'); hearts(3, el); }
  else if (e === '!') { setFace(el, false); retrigger(el, 'shake'); }
  else if (e === '*') { setFace(el, true); el.classList.add('blush'); el.classList.remove('sad'); hearts(1, el); }
  else if (e === '_') { setFace(el, false); el.classList.add('sad'); el.classList.remove('blush'); }
  else if (e === '~') { setFace(el, false); el.classList.remove('sad', 'blush'); }
}
function retrigger(el, cls) { el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls); setTimeout(() => el.classList.remove(cls), 600); }

function hearts(n, el) {
  const left = el ? parseFloat(el.style.left) / 100 * 1280 : 640;
  for (let i = 0; i < n; i++) {
    setTimeout(() => {
      const h = document.createElement('div'); h.className = 'heart-p'; h.textContent = '♥';
      h.style.left = left - 160 + Math.random() * 320 + 'px'; h.style.top = 200 + Math.random() * 160 + 'px';
      h.style.fontSize = 22 + Math.random() * 26 + 'px';
      $('#fx').appendChild(h); setTimeout(() => h.remove(), 1700);
    }, i * 140);
  }
}

// ---------- HUD ----------
const level = v => v >= 85 ? 5 : v >= 70 ? 4 : v >= 50 ? 3 : v >= 30 ? 2 : v >= 12 ? 1 : 0;
function updateHud() {
  const d = dateOf(S.day);
  $('#date-main').textContent = `${d.getMonth() + 1}月${d.getDate()}日(${WEEK[d.getDay()]})`;
  $('#date-slot').textContent = S.day >= LAST_DAY ? '運命の日' : S.day === 0 ? '始業式' : SLOTS[S.slot] || '';
  $('#hearts').innerHTML = Object.keys(CHARS).filter(k => S.known[k]).map(k => {
    const c = CHARS[k], v = S.aff[k];
    return `<div class="hcard" style="--c:${c.color}"><div class="face" style="background-image:url(${c.img})"></div>
      <div><div>${c.name} <span class="lv">${'♥'.repeat(level(v))}${'♡'.repeat(5 - level(v))}</span></div><div class="bar"><i style="width:${v}%"></i></div></div></div>`;
  }).join('');
}

function addAff(obj) {
  Object.entries(obj).forEach(([k, v], i) => {
    if (!v) return;
    S.aff[k] = Math.max(0, Math.min(100, S.aff[k] + v));
    setTimeout(() => {
      const pop = document.createElement('div');
      pop.className = 'aff-pop' + (v < 0 ? ' minus' : '');
      pop.textContent = v > 0 ? `♥ ${CHARS[k].name}の好感度 UP!` : `♡ ${CHARS[k].name}の好感度 DOWN…`;
      $('#fx').appendChild(pop); setTimeout(() => pop.remove(), 2000);
      if (v > 0) { FM.se(v >= 10 ? 'up' : 'heart'); hearts(v >= 10 ? 8 : 4, sprites[k]); if (v >= 10 && sprites[k]) setFace(sprites[k], true); }
      else FM.se('down');
    }, i * 300);
  });
  updateHud();
}

// ---------- 入力待ち ----------
let clickResolver = null;
function waitClick() { return new Promise(r => { clickResolver = r; }); }
function fireClick() { if (clickResolver) { const r = clickResolver; clickResolver = null; r(); } }
$('#msgwin').addEventListener('click', fireClick);
$('#sprites').parentElement.addEventListener('click', e => {
  if (e.target.closest('button, .screen, #choices, #map, #msgwin')) return;
  fireClick();
});
addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fireClick(); }
  if (e.key === 'Control') opts.ctrl = true;
});
addEventListener('keyup', e => { if (e.key === 'Control') opts.ctrl = false; });
addEventListener('wheel', e => { if (e.deltaY < 0 && !$('#msgwin').classList.contains('hidden')) openLog(); });
const skipping = () => opts.skip || opts.ctrl;

// ---------- テキスト表示 ----------
const fmt = t => t.replace(/\{p\}/g, S ? S.name : '');
function speakerName(key) {
  if (!key) return '';
  if (key === 'me') return S.name;
  if (key === '?') return '？？？';
  return S.known[key] ? CHARS[key].name : '？？？';
}

async function say(speaker, text) {
  text = fmt(text);
  let em = null;
  if (speaker && /[\^*_!~]$/.test(speaker)) { em = speaker.slice(-1); speaker = speaker.slice(0, -1); }
  if (em) {
    const target = speaker === '?' ? Object.keys(sprites)[0] : speaker;
    if (target) emote(target, em);
  }
  // 話者以外を暗く
  const shown = Object.keys(sprites);
  if (shown.length > 1) shown.forEach(k => sprites[k].classList.toggle('dim', CHARS[speaker] ? k !== speaker : false));
  const name = speakerName(speaker);
  $('#msgwin').classList.remove('hidden');
  $('#namebox').textContent = name;
  $('#namebox').style.background = CHARS[speaker] ? `linear-gradient(135deg, ${CHARS[speaker].color}, #ffb3d4)` : '';
  backlog.push({ name, text }); if (backlog.length > 200) backlog.shift();
  const msg = $('#msg'); const next = $('#next');
  next.classList.remove('on');
  const body = name ? `「${text}」` : text;
  if (skipping()) { msg.textContent = body; await sleep(40); return; }
  let done = false;
  const finish = () => { done = true; };
  clickResolver = finish;
  for (let i = 0; i <= body.length && !done; i++) {
    msg.textContent = body.slice(0, i);
    if (i % 2 === 0 && body[i] && body[i] !== '　') FM.se('blip');
    await sleep(32);
    if (skipping()) break;
  }
  msg.textContent = body;
  next.classList.add('on');
  if (skipping()) { await sleep(40); return; }
  if (opts.auto) {
    await Promise.race([waitClick(), sleep(1200 + body.length * 60)]);
    clickResolver = null;
  } else await waitClick();
  FM.se('click');
}

function choose(list) {
  return new Promise(res => {
    const box = $('#choices'); box.innerHTML = ''; box.classList.remove('hidden');
    $('#next').classList.remove('on');
    list.forEach((c, i) => {
      const b = document.createElement('button'); b.className = 'choice'; b.textContent = fmt(c[0]);
      b.style.animationDelay = i * 0.08 + 's';
      b.onmouseenter = () => FM.se('click');
      b.onclick = e => { e.stopPropagation(); FM.se('select'); box.classList.add('hidden'); res(i); };
      box.appendChild(b);
    });
  });
}

// ---------- スクリプト実行 ----------
async function run(script) {
  for (const cmd of script) {
    if (typeof cmd === 'string') { await say('', cmd); continue; }
    if (Array.isArray(cmd)) { await say(cmd[0], cmd[1]); continue; }
    if (cmd.bg) { hide('all'); setBg(cmd.bg); await sleep(skipping() ? 50 : 500); }
    if (cmd.bgm) FM.play(cmd.bgm);
    if (cmd.show) { show(cmd.show, cmd.at); await sleep(skipping() ? 50 : 350); }
    if (cmd.hide) { hide(cmd.hide); await sleep(skipping() ? 50 : 300); }
    if (cmd.known) { S.known[cmd.known] = 1; updateHud(); }
    if (cmd.aff) addAff(cmd.aff);
    if (cmd.se) FM.se(cmd.se);
    if (cmd.flash) { const f = document.createElement('div'); f.className = 'flash'; $('#fx').appendChild(f); setTimeout(() => f.remove(), 700); }
    if (cmd.petals !== undefined) petals(cmd.petals);
    if (cmd.wait) await sleep(cmd.wait);
    if (cmd.ch) {
      const i = await choose(cmd.ch);
      const [label, aff, sub] = cmd.ch[i];
      backlog.push({ name: '選択', text: fmt(label) });
      if (aff) addAff(aff);
      await sleep(400);
      if (sub) await run(sub);
    }
  }
}

// ---------- 日付カード ----------
async function dayCard(day) {
  const d = dateOf(day);
  $('#dc-date').textContent = `${d.getMonth() + 1}/${d.getDate()}`;
  $('#dc-week').textContent = `${WEEK[d.getDay()]}曜日`;
  const el = $('#daycard'); el.classList.remove('hidden');
  el.style.animation = 'none'; void el.offsetWidth; el.style.animation = '';
  FM.se('chime');
  await sleep(2200);
  el.classList.add('hidden');
}

// ---------- マップ ----------
function eventReady(k) {
  const e = EVENTS[k][S.ev[k]];
  return e && S.aff[k] >= e.need;
}
function chooseLocation() {
  return new Promise(res => {
    $('#msgwin').classList.add('hidden');
    $('#map-title').textContent = `${SLOTS[S.slot]}、どこへ行こう？`;
    const list = $('#map-list'); list.innerHTML = '';
    PLACES.forEach((p, i) => {
      const who = p.who[S.slot];
      const b = document.createElement('button'); b.className = 'loc';
      b.style.backgroundImage = `url(${BGS[p.bg]})`; b.style.animationDelay = i * 0.06 + 's';
      b.innerHTML = `<div class="lname">${p.name}</div>` +
        (who ? `<div class="who" style="background-image:url(${CHARS[who].img});border-color:${CHARS[who].color}"></div>` : '') +
        (who && eventReady(who) ? '<div class="new">EVENT!</div>' : '');
      b.onmouseenter = () => FM.se('click');
      b.onclick = () => { FM.se('select'); $('#map').classList.add('hidden'); res(p); };
      list.appendChild(b);
    });
    $('#map').classList.remove('hidden');
  });
}

async function visit(place) {
  hide('all');
  setBg(place.bg);
  await sleep(500);
  const who = place.who[S.slot];
  if (!who) { FM.play('night'); await run(EMPTY[place.id].concat()); return; }
  S.last = who;
  if (eventReady(who)) {
    const e = EVENTS[who][S.ev[who]];
    FM.play(e.need >= 70 ? 'confession' : 'daily');
    await run(e.s);
    S.ev[who]++;
  } else {
    FM.play('daily');
    const chats = CHATS[who];
    await run([{ show: who }, ...chats[Math.floor(Math.random() * chats.length)]]);
  }
  hide('all');
}

// ---------- 夜 ----------
async function night() {
  hide('all'); setBg('room'); FM.play('night'); await sleep(500);
  const top = topHeroine();
  const lines = [];
  if (S.last) lines.push(`今日は${CHARS[S.last].name}と過ごした。`);
  if (top && S.aff[top] >= CONFESS_LINE) lines.push(`目を閉じると、${CHARS[top].name}の笑顔が浮かんでくる。`);
  else lines.push('明日はどんな一日になるだろう。');
  if (LAST_DAY - S.day - 1 === 3) lines.push('……そういえば、一本桜の花が散るまで、あと少しらしい。');
  await run(lines);
}
const topHeroine = () => Object.keys(S.aff).sort((a, b) => S.aff[b] - S.aff[a])[0];

// ---------- 告白の日 ----------
async function finale() {
  await dayCard(LAST_DAY);
  S.day = LAST_DAY; updateHud();
  hide('all'); setBg('classroom'); FM.play('daily');
  await run(['桜の花が散り始めた、ある日の放課後。', '下駄箱を開けると、一通の手紙が入っていた。', '『放課後、一本桜の下で待っています』']);
  const top = topHeroine();
  const ok = S.aff[top] >= CONFESS_LINE;
  if (!ok) { await run(['……差出人の名前はない。', '急いで丘へ向かったが――']); await run(NORMAL_END); return ending(null); }
  setBg('tree'); FM.play('confession'); await sleep(800);
  await run(['夕暮れの丘。満開の一本桜の下に、見覚えのある後ろ姿があった。']);
  await run(ENDINGS[top]);
  return ending(top);
}

async function ending(who) {
  $('#msgwin').classList.add('hidden'); $('#hud').classList.add('hidden'); $('#sysbtns').classList.add('hidden');
  try { localStorage.removeItem(SAVE_KEY); } catch (e) {}
  if (who) { FM.play('title'); petals(1); }
  const c = document.createElement('div'); c.className = 'credits';
  c.innerHTML = who
    ? `<h1>♥ HAPPY END ♥</h1><p>${CHARS[who].full} エンド</p><p style="font-size:18px">好感度 ${S.aff[who]} / 100</p><p style="font-size:16px;opacity:.8">クリックでタイトルへ</p>`
    : `<h1>NORMAL END</h1><p>それぞれの春</p><p style="font-size:16px;opacity:.8">クリックでタイトルへ</p>`;
  $('#stage').appendChild(c);
  await sleep(1500);
  await new Promise(r => c.addEventListener('click', r, { once: true }));
  c.remove(); hide('all'); petals(0);
  titleScreen();
}

// ---------- メインループ ----------
async function playGame() {
  $('#hud').classList.remove('hidden'); $('#sysbtns').classList.remove('hidden');
  updateHud();
  while (S.day < LAST_DAY) {
    if (S.slot === 0) { hide('all'); setBg('gate'); FM.play('daily'); await dayCard(S.day); }
    updateHud();
    while (S.slot < SLOTS.length) {
      updateHud(); save();
      setBg(S.slot === 0 ? 'classroom' : 'street');
      const place = await chooseLocation();
      await visit(place);
      S.slot++;
    }
    await night();
    S.day++; S.slot = 0; S.last = null; save();
  }
  await finale();
}

async function newGame() {
  const name = await askName();
  S = newState(name);
  S.known = { hina: 0, rena: 0, minori: 0 };
  $('#title').classList.add('hidden');
  $('#hud').classList.remove('hidden'); $('#sysbtns').classList.remove('hidden');
  S.day = 0; updateHud();
  await run(PROLOGUE);
  hide('all'); petals(0);
  S.day = 1; S.slot = 0; save();
  await playGame();
}

function askName() {
  return new Promise(res => {
    $('#namein').classList.remove('hidden');
    const inp = $('#name-input'); inp.focus(); inp.select();
    const ok = () => { const v = inp.value.trim() || '悠真'; FM.se('select'); $('#namein').classList.add('hidden'); res(v); };
    $('#name-ok').onclick = ok;
    inp.onkeydown = e => { if (e.key === 'Enter') { e.stopPropagation(); ok(); } };
  });
}

// ---------- タイトル ----------
function titleScreen() {
  $('#hud').classList.add('hidden'); $('#sysbtns').classList.add('hidden'); $('#msgwin').classList.add('hidden');
  $('#map').classList.add('hidden'); $('#choices').classList.add('hidden');
  setBg('tree'); petals(1); FM.play('title');
  $('#title').classList.remove('hidden');
  $('#btn-load').disabled = !loadSave();
}
$('#btn-new').onclick = () => { FM.se('select'); newGame(); };
$('#btn-load').onclick = () => {
  const s = loadSave(); if (!s) return;
  FM.se('select'); S = s; $('#title').classList.add('hidden'); petals(0); playGame();
};

// ---------- 音楽室 ----------
const TRACKS = [
  ['title', '桜色メモリアル', 'オープニングテーマ'], ['daily', 'いつもの放課後', '日常'],
  ['comical', 'ドタバタ・ハプニング', 'コミカル'], ['night', '星降る夜に', '夜・静寂'],
  ['confession', '桜の木の下で', '告白・エンディング'],
];
let scopeRAF = null;
$('#btn-music').onclick = () => {
  FM.se('select'); $('#title').classList.add('hidden'); $('#music').classList.remove('hidden');
  const list = $('#music-list'); list.innerHTML = '';
  TRACKS.forEach(([k, t, d], i) => {
    const b = document.createElement('button'); b.className = 'track' + (FM.current === k ? ' on' : '');
    b.innerHTML = `${String(i + 1).padStart(2, '0')}. ${t}<small>${d} / ${SONGS[k].bpm} BPM</small>`;
    b.onclick = () => { FM.play(k); list.querySelectorAll('.track').forEach(x => x.classList.remove('on')); b.classList.add('on'); };
    list.appendChild(b);
  });
  drawScope();
};
$('#music-back').onclick = () => { cancelAnimationFrame(scopeRAF); $('#music').classList.add('hidden'); FM.play('title'); $('#title').classList.remove('hidden'); };
function drawScope() {
  const cv = $('#scope'), g = cv.getContext('2d'), an = FM.analyser;
  const buf = new Uint8Array(an.fftSize);
  const loop = () => {
    an.getByteTimeDomainData(buf);
    g.fillStyle = '#1c1430'; g.fillRect(0, 0, cv.width, cv.height);
    g.strokeStyle = '#ff7eb6'; g.lineWidth = 2; g.beginPath();
    for (let i = 0; i < buf.length; i++) { const x = i / buf.length * cv.width, y = buf[i] / 255 * cv.height; i ? g.lineTo(x, y) : g.moveTo(x, y); }
    g.stroke(); scopeRAF = requestAnimationFrame(loop);
  };
  loop();
}

// ---------- システムボタン ----------
function openLog() {
  if (!$('#log').classList.contains('hidden')) return;
  $('#log-list').innerHTML = backlog.map(b => `<div class="log-item">${b.name ? `<b>${b.name}</b>` : ''}${b.text}</div>`).join('');
  $('#log').classList.remove('hidden');
  const l = $('#log-list'); l.scrollTop = l.scrollHeight;
}
$('#log-close').onclick = () => $('#log').classList.add('hidden');
$('#sysbtns').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  e.stopPropagation(); FM.se('click');
  const a = b.dataset.act;
  if (a === 'log') openLog();
  if (a === 'auto') { opts.auto = !opts.auto; b.classList.toggle('on', opts.auto); if (opts.auto) fireClick(); }
  if (a === 'skip') { opts.skip = !opts.skip; b.classList.toggle('on', opts.skip); if (opts.skip) fireClick(); }
  if (a === 'mute') { opts.mute = !opts.mute; FM.setMusicVol(opts.mute ? 0 : 0.55); b.classList.toggle('on', opts.mute); }
  if (a === 'title') { if (confirm('タイトルに戻りますか？（今日の始めまでは自動セーブされています）')) location.reload(); }
});

// ---------- 起動 ----------
// 画像のプリロード
[...Object.values(BGS), ...Object.values(CHARS).flatMap(c => [c.img, c.happy].filter(Boolean))].forEach(src => { const i = new Image(); i.src = src; });
$('#boot').addEventListener('click', () => {
  FM.init();
  $('#boot').classList.add('hidden');
  titleScreen();
}, { once: true });
