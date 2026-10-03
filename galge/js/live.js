// ============================================================
//  実写版: 素材の差し替えと見た目の切り替え (story.js の後、game.js の前に読み込む)
// ============================================================
window.LIVE = true;
Object.keys(CHARS).forEach(k => {
  CHARS[k].img = `assets_live/${k}.png`;
  CHARS[k].happy = `assets_live/${k}_happy.png`;
});
Object.keys(BGS).forEach(k => { BGS[k] = `assets_live/bg_${k}.jpg`; });
document.documentElement.classList.add('live');
