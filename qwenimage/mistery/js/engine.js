// 霧雨館殺人事件 — ノベル／捜査エンジン
const $ = (id) => document.getElementById(id);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const IMG = (n) => `img/${n}.png`;

const CHARS = {
  me: { name: '九条' },
  h: { name: 'ひより', slot: 'L', img: { '': 'hiyori', '!': 'hiyori_surprised', '?': 'hiyori_serious' } },
  r: { name: '玲子', slot: 'R', img: { '': 'reiko' } },
  s: { name: '慎也', slot: 'R', img: { '': 'shinya' } },
  k: { name: '真壁', slot: 'R', img: { '': 'makabe' } },
  m: { name: '美月', slot: 'R', img: { '': 'mitsuki', '#': 'mitsuki_dark' } },
  g: { name: '源一郎', slot: 'R', img: { '': 'genichiro_live', '@': 'genichiro' } },
  tape: { name: '源一郎の声', slot: 'R', img: { '': 'it_recorder' } },
};

const S = { act: 0, loc: 'study', done: {}, items: [], upd: {}, lives: 5 };
const Game = { ITEMS: {}, LOCS: {}, ACTIONS: [], HINTS: {} }; // story.js が埋める

// ---------- 表示 ----------
let bgFront = 'bgA';
function setBg(name) {
  const back = bgFront === 'bgA' ? 'bgB' : 'bgA';
  const src = IMG('bg_' + name);
  if ($(bgFront).getAttribute('src') === src) return;
  $(back).src = src;
  $(back).style.opacity = 1; $(bgFront).style.opacity = 0;
  bgFront = back;
}
const portrait = { L: null, R: null };
function show(key, face = '') {
  const c = CHARS[key]; if (!c || !c.img) return;
  const slot = c.slot, el = $('ch' + slot);
  const src = IMG(c.img[face] || c.img['']);
  if (el.getAttribute('src') !== src) el.src = src;
  el.classList.add('on'); portrait[slot] = key;
  for (const s of ['L', 'R']) $('ch' + s).classList.toggle('dim', s !== slot && portrait[s]);
}
function hide(slot = 'all') {
  for (const s of slot === 'all' ? ['L', 'R'] : [slot]) { $('ch' + s).classList.remove('on', 'dim'); portrait[s] = null; }
}
function flash() { const f = $('flash'); f.classList.remove('on'); void f.offsetWidth; f.classList.add('on'); }
function shake() { const s = $('stage'); s.classList.remove('shake'); void s.offsetWidth; s.classList.add('shake'); }

// ---------- 入力 ----------
let clickWaiter = null;
function waitClick() { return new Promise((r) => { clickWaiter = r; }); }
function advance() { if (clickWaiter) { const r = clickWaiter; clickWaiter = null; r(); } }
$('stage').addEventListener('click', (e) => {
  if (e.target.closest('button, .act, .card, #note, #menu, #hud')) return;
  advance();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') { if (!$('menu').classList.contains('on') && !$('note').classList.contains('on')) { e.preventDefault(); advance(); } }
  if (e.key === 'm' || e.key === 'M') toggleMute();
});

// ---------- 台詞 ----------
let typing = false;
async function say(who, text, face = '') {
  const box = $('box'), t = $('text');
  box.classList.add('on'); $('next').classList.remove('on');
  const c = CHARS[who];
  $('name').textContent = c ? c.name : '';
  t.classList.toggle('narr', !c);
  if (c && c.img) show(who, face);
  else if (who === 'me') for (const s of ['L', 'R']) if (portrait[s]) $('ch' + s).classList.add('dim');
  t.textContent = '';
  typing = true;
  let skip = false;
  clickWaiter = () => { skip = true; };
  for (let i = 0; i < text.length && !skip; i++) {
    t.textContent += text[i];
    if (i % 3 === 0 && c && FM.ready) Music.se('page');
    await sleep('。！？'.includes(text[i]) ? 110 : text[i] === '…' ? 60 : 26);
  }
  t.textContent = text;
  typing = false;
  $('next').classList.add('on');
  await waitClick();
}

// スクリプト配列を実行。文字列 'h!:台詞' / 'ナレーション' / コマンドオブジェクト
const LINE = /^(me|h|r|s|k|m|g|tape)([!?#@]?):([\s\S]*)$/;
async function run(lines) {
  for (const l of lines) {
    if (typeof l === 'string') {
      const m = LINE.exec(l);
      if (m) await say(m[1], m[3], m[2]); else await say(null, l);
    } else if (typeof l === 'function') {
      await l();
    } else {
      if ('bg' in l) setBg(l.bg);
      if ('bgm' in l) Music.play(l.bgm);
      if (l.se) Music.se(l.se);
      if (l.hide) hide(l.hide);
      if (l.show) show(l.show[0], l.show[1] || '');
      if (l.flash) flash();
      if (l.shake) shake();
      if (l.upd) { S.upd[l.upd] = true; await notice(l.upd, true); }
      if (l.item) await getItem(l.item);
      if (l.banner) await banner(l.banner);
      if (l.wait) await sleep(l.wait);
    }
  }
}

async function banner(text) {
  $('box').classList.remove('on');
  const b = $('banner'); b.textContent = text; b.classList.add('on');
  await sleep(600); await waitClick(); b.classList.remove('on');
}

function itemImg(id) {
  const it = Game.ITEMS[id];
  if (it.who) { const c = CHARS[it.who]; return IMG(c.img['']); }
  return IMG(it.img);
}
async function getItem(id) { if (!S.items.includes(id)) S.items.push(id); await notice(id, false); }
async function notice(id, updated) {
  const it = Game.ITEMS[id], g = $('get');
  g.querySelector('.k').textContent = updated ? '― 手帳の記録を更新した ―' : (it.who ? '― 証言を記録した ―' : '― 証拠品を手に入れた ―');
  g.querySelector('img').src = itemImg(id);
  g.querySelector('.n').textContent = it.name;
  g.classList.add('on'); Music.se('powerup');
  await sleep(400); await waitClick(); g.classList.remove('on');
}

// ---------- 選択肢 ----------
function choice(options, question = '') {
  return new Promise((resolve) => {
    const m = $('menu'); m.innerHTML = '';
    if (question) { const q = document.createElement('div'); q.className = 'q'; q.textContent = question; m.appendChild(q); }
    options.forEach((o, i) => {
      const b = document.createElement('button'); b.className = 'btn'; b.textContent = o;
      b.onclick = () => { Music.se('select'); m.classList.remove('on'); resolve(i); };
      m.appendChild(b);
    });
    m.classList.add('on');
  });
}

// ---------- 手帳 ----------
let noteResolve = null, noteSel = null;
function openNote(mode = 'view', prompt = '') {
  return new Promise((resolve) => {
    noteResolve = resolve; noteSel = S.items[0] || null;
    $('notePrompt').textContent = prompt; $('notePrompt').style.display = prompt ? '' : 'none';
    $('noteClose').textContent = mode === 'present' ? 'もう一度聞く' : '閉じる';
    $('note').dataset.mode = mode;
    renderNote(); $('note').classList.add('on'); Music.se('page');
  });
}
function renderNote() {
  const grid = $('grid'); grid.innerHTML = '';
  for (const id of S.items) {
    const it = Game.ITEMS[id], d = document.createElement('div');
    d.className = 'card' + (id === noteSel ? ' sel' : '');
    d.innerHTML = `<img src="${itemImg(id)}" alt=""><div class="lbl">${it.name}</div>` + (it.who ? '<div class="tag">証言</div>' : '');
    d.onclick = () => { noteSel = id; Music.se('page'); renderNote(); };
    grid.appendChild(d);
  }
  const det = $('detail');
  if (!noteSel) { det.innerHTML = '<p>まだ何も記録していない。</p>'; return; }
  const it = Game.ITEMS[noteSel];
  det.innerHTML = `<img src="${itemImg(noteSel)}" alt=""><h3>${it.name}</h3><p>${it.desc}${S.upd[noteSel] && it.desc2 ? `\n<span class="upd">【追記】${it.desc2}</span>` : ''}</p>`;
  if ($('note').dataset.mode === 'present') {
    const b = document.createElement('button'); b.className = 'btn'; b.id = 'presentBtn'; b.textContent = 'つきつける！';
    b.onclick = () => closeNote(noteSel);
    det.appendChild(b);
  }
}
function closeNote(v) { $('note').classList.remove('on'); const r = noteResolve; noteResolve = null; if (r) r(v); }
$('noteClose').onclick = () => { Music.se('cancel'); closeNote(null); };
$('bNote').onclick = () => { if (!noteResolve) openNote('view'); };
function present(prompt) { return openNote('present', prompt); }

// ---------- HUD ----------
function toggleMute() { if (!FM.ready) return; FM.toggleMute(); $('bMute').textContent = FM.muted ? '♪ OFF' : '♪ ON'; }
$('bMute').onclick = toggleMute;
function hud(on, extra = {}) {
  $('hud').classList.toggle('on', on);
  $('bHint').style.display = extra.hint === false ? 'none' : '';
}
function drawLives() { $('lives').textContent = '♥'.repeat(S.lives) + '♡'.repeat(5 - S.lives); }
let hubBusy = false;
$('bHint').onclick = async () => {
  if (hubBusy || !$('hub').classList.contains('on')) return;
  hubBusy = true; $('hub').classList.remove('on'); $('chC').classList.remove('on');
  await run(Game.hint());
  hubBusy = false; hubRefresh();
};

// ---------- 捜査パート ----------
let hubResolve = null;
function actionsHere() { return Game.ACTIONS.filter((a) => a.loc === S.loc && a.act === S.act && (!a.cond || a.cond(S))); }
function hubRefresh() {
  const L = Game.LOCS[S.loc];
  setBg(L.bg); hide();
  const who = L.who && L.who(S);
  const cc = $('chC');
  if (who) { cc.src = IMG(CHARS[who].img['']); cc.classList.add('on'); } else cc.classList.remove('on');
  $('box').classList.remove('on');
  $('hubLoc').textContent = L.name; $('hudLoc').textContent = Game.actTitle();
  const sc = $('hubScroll'); sc.innerHTML = '';
  const add = (label, ic, cls, fn, parent = sc) => {
    const d = document.createElement('div'); d.className = 'act ' + cls;
    d.innerHTML = `<span class="ic">${ic}</span><span>${label}</span>`;
    d.onclick = () => { if (hubBusy) return; Music.se('select'); fn(); };
    parent.appendChild(d);
  };
  const grp = (t) => { const g = document.createElement('div'); g.className = 'grp'; g.textContent = t; sc.appendChild(g); };
  if (Game.ready()) add(Game.readyLabel(), '⚖', 'big', () => hubResolve({ kind: 'deduce' }));
  const acts = actionsHere();
  for (const [type, title, ic] of [['look', '自分で調べる', '🔍'], ['hiyori', 'ひよりに頼む', '🎀'], ['talk', '話を聞く', '💬']]) {
    const list = acts.filter((a) => a.type === type);
    if (!list.length) continue;
    grp(title);
    for (const a of list) add(a.label, ic, S.done[a.id] ? 'done' : 'new', () => hubResolve({ kind: 'action', a }));
  }
  grp('移動する');
  const mv = document.createElement('div'); mv.className = 'moves'; sc.appendChild(mv);
  for (const [id, l] of Object.entries(Game.LOCS)) if (id !== S.loc) add(l.name, '🚪', '', () => hubResolve({ kind: 'move', id }), mv);
  $('hub').classList.add('on'); hud(true);
}
async function hubLoop() {
  Music.play(Game.hubBgm());
  while (true) {
    save();
    const pick = await new Promise((r) => { hubResolve = r; hubRefresh(); });
    hubBusy = true; $('hub').classList.remove('on'); $('chC').classList.remove('on');
    if (pick.kind === 'move') { Music.se('step'); S.loc = pick.id; hubBusy = false; continue; }
    if (pick.kind === 'action') { await run(pick.a.lines); S.done[pick.a.id] = true; hide(); }
    if (pick.kind === 'deduce') { hud(false); const end = await Game.deduce(); if (end) return; Music.play(Game.hubBgm()); }
    hubBusy = false;
  }
}

// ---------- セーブ ----------
const SAVE_KEY = 'kirisame_save_v1';
function save() { try { localStorage.setItem(SAVE_KEY, JSON.stringify({ act: S.act, loc: S.loc, done: S.done, items: S.items, upd: S.upd })); } catch (e) {} }
function loadSave() { try { return JSON.parse(localStorage.getItem(SAVE_KEY)); } catch (e) { return null; } }
function clearSave() { try { localStorage.removeItem(SAVE_KEY); } catch (e) {} }

// ---------- 画面スケール ----------
function fit() { const s = Math.min(innerWidth / 1280, innerHeight / 720); $('stage').style.transform = `scale(${s})`; }
addEventListener('resize', fit); fit();

// ---------- タイトル ----------
async function audioOn() { try { await Music.init(); } catch (e) { console.warn(e); } }
async function toTitle() {
  hud(false); hide(); $('box').classList.remove('on'); $('lives').classList.remove('on'); $('hub').classList.remove('on');
  setBg('title'); $('title').classList.remove('off');
  $('bCont').style.display = loadSave() ? '' : 'none';
  Music.play('title');
}
setBg('title'); $('bCont').style.display = loadSave() ? '' : 'none';
$('title').addEventListener('click', async (e) => { if (!FM.ready) { await audioOn(); Music.play('title'); } });
$('bStart').onclick = async (e) => {
  e.stopPropagation(); await audioOn(); Music.se('select');
  $('title').classList.add('off');
  Object.assign(S, { act: 0, loc: 'study', done: {}, items: [], upd: {}, lives: 5 });
  clearSave();
  await Game.prologue();
  await hubLoop(); await toTitle();
};
$('bCont').onclick = async (e) => {
  e.stopPropagation(); await audioOn(); Music.se('select');
  const d = loadSave(); if (!d) return;
  $('title').classList.add('off');
  Object.assign(S, d, { lives: 5 });
  await hubLoop(); await toTitle();
};
