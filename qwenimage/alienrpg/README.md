# DERELICT — 森の異星船

森に墜落した異星船を探索し、エイリアンと戦いながら3つのアーティファクトを集めるRPG（three.js）。

## 起動
```
python tools/serve.py 8765
```
ブラウザで http://127.0.0.1:8765/ を開く（`?mute` を付けると無音）。

## 構成
- `js/forest.js` 森（クオータービュー、正射影カメラ＋スプライト、画家のアルゴリズムで前後関係）
- `js/hero.js` 主人公（リグ付き3Dモデル Soldier.glb をリアルタイムでテクスチャに描画し、スプライトとして表示。全方向に向き、待機/歩き/走りアニメ）
- `js/ship.js` 船内（一人称3D、3デッキを手続き生成、フローフィールド追跡AI、女王ボス）
- `js/audio.js` FM音源（2〜3オペレータ）による BGM シーケンサと効果音
- `js/main.js` 共通（ステータス・レベル・HUD・入力・シーン切替）
- `tools/gen_assets.py` 画像生成（Unsloth ローカルAPI）→ `raw/`
- `tools/process_assets.py` クロマキー抜き・フリンジ除去・シームレス化・法線マップ生成 → `assets/`
