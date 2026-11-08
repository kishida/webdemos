# 大水槽

fish-kit の魚が泳ぐ、水族館の大水槽（three.js）。このフォルダだけで動きます。

## クレジット

- 魚のモデルと動き：Fish Kit（CC0 1.0）― https://cda-social.github.io/fish/gallery.html
- 沈没船・樽・壺・錨：Effigy で生成（各 `props/*_web/CREDITS.txt`、`LICENSES.json`）

## 開き方

ブラウザは `file://` から ES モジュールを読めないので、このフォルダを http で配ります。

```bash
python -m http.server 8765 --directory .
```

http://localhost:8765/ を開く。ドラッグで見回し、ホイールで近づき、魚にカーソルで名前。

## VR

画面下の「ENTER VR」で入ります（WebXR）。通路に立って窓をのぞきます。

- 左スティック：歩く（見ている向きが前）
- 右スティック：30° ずつ向きを変える
- トリガー：指した魚の名前を出す

ヘッドセットのブラウザは https か localhost でないと VR に入れません。

- PC につないで使う（Quest Link / Air Link、SteamVR）：PC の Chrome / Edge で http://localhost:8765/ を開く
- Quest 単体：USB でつないで `adb reverse tcp:8765 tcp:8765` を実行し、Quest のブラウザで http://localhost:8765/ を開く

ヘッドセットなしで試すときは http://localhost:8765/?xremu （Meta の WebXR エミュレーター IWER を読み込む）。

VR ではにじみ（bloom）と周辺減光の後処理は使えないので省きます。

## 中身

| | |
|---|---|
| `index.html` | 水槽（岩・砂・海藻・光・水の色・魚のふるまいは、すべてこの中のコードで作る） |
| `fish-kit.js`, `fish/` | fish-kit の写しそのまま（CC0、`fish-kit-LICENSE.txt`） |
| `props/` | Effigy で作った沈没船・樽・壺・錨。`*_web/` に Effigy の `CREDITS.txt` と `LICENSES.json` |

沈めるものの位置・向き・埋まり具合は `index.html` の `PROPS` の表で変えられます。
