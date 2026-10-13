# 山手線に勝て！

東京の本物の道を自転車で走り、山手線より先に次の駅を目指すブラウザのレースゲームです。
山手線1周の全30区間を、真上から見下ろす **2D版** と、街を立体で走る **3D版（試作）** で遊べます。

> JR東日本とは関係のない非公式のファンゲームです。

| 2D版 | 3D版（試作） |
| --- | --- |
| ![2D版のレース画面。渋谷→原宿の神宮通りを走る自転車と、横の線路を走る山手線](docs/screenshots/race-2d.png) | ![3D版のレース画面。夕方の渋谷の交差点を走る自転車と、高架を走る山手線](docs/screenshots/race-3d.jpg) |

## 遊び方

山手線の隣り合う2駅の間を自転車で走り、電車が着く前（制限時間内）にゴール駅の緑の円に入れば勝ちです。前の区間に勝つと次の区間が開き、最後の恵比寿→渋谷に勝つと「山手線1周達成！」です。

- **道路**：OpenStreetMap の実際の道路。建物は壁、歩道と道路の外は遅くなります。
- **障害**：信号（赤で進入すると5秒停止）、一方通行の逆走（減速）、車（衝突で2秒停止）、歩行者（衝突で1秒停止）。
- **難易度**：かんたん・ふつう・むずかしい（制限時間の倍率が変わります）。
- **時間帯と天気**：昼・夕方・夜、晴れ・雨・雪を選べます。「天気の影響：あり」にすると、雨や雪で自転車が走りにくくなり、制限時間も延びます。
- **ゴースト**：ベストタイムの走りを半透明の自転車で再生します。
- **結果画面**：勝つとタイムに応じて金・銀・銅のメダル。今回の走りと最速ルートを地図に重ね、止まった場所に印を付けます。結果は短い文にしてシェアできます。

### 操作

| 操作 | キーボード | スマホ |
| --- | --- | --- |
| 決定・スタート | Enter / Space | タップ |
| 区間を選ぶ（区間選択画面） | ↑ ↓ | タップ |
| 難易度を変える（区間選択画面） | ← → | タップ |
| 遊び方を見る（タイトル画面） | H | タップ |
| 加速・ブレーキ | ↑ ↓ / W S | 画面下の「アクセル」「ブレーキ」 |
| 曲がる | ← → / A D | 画面下の ◀ ▶ |
| 一時停止・再開（レース中） | P | 右上の ❚❚ |
| やり直し | R | 結果画面の「もう一度」 |
| 結果をシェア（結果画面） | S（文をコピー） | 「結果をシェア」（共有メニュー） |
| 戻る | Esc | 右上の ✕ |
| 音のオン／オフ | M | 右上の「音」 |
| ゴーストの表示 | G | 区間選択画面でタップ |
| 視点の切り替え（3D版） | C | 右上の「視点」 |
| ベル（3D版） | B | — |
| 時間帯・天気・天気の影響（区間選択画面） | T・Y・E | タップ |

## 必要な環境

- **遊ぶ**：import map に対応した新しいブラウザ（Chrome・Edge・Firefox・Safari の最近の版）と、ローカルサーバー（同梱の `tools/serve.py` を使うなら Python 3）
- **区間データを作り直す**：Node.js 18 以上（`tools/fetch-osm.mjs` が組み込みの `fetch` を使うため）

## 今の状態

- 2D版：山手線1周の全30区間が遊べます。
- 3D版：試作です。全30区間を走れますが、視点や操作感はまだ調整中です。
- これまでの確認は、ほぼすべてブラウザ上の自動テスト（自動運転と操作イベントの送信）です。人による試遊とスマホ実機（iPhone の Safari を含む）での確認、3D版のスマホでの重さの確認はまだです。
- まだ公開していません（GitHub Pages に置く予定）。

## 起動方法

ビルドは不要です。ES モジュールを使うため、ファイルを直接開くのではなくローカルサーバー経由で開きます。

```bash
python tools/serve.py 8173
```

ファイルを配るだけのサーバーなら何でも動きます（`npx serve` など）。その場合は、そのサーバーが表示するアドレスを開いてください。

ブラウザで次のページを開きます。

- 2D版：http://localhost:8173/
- 3D版：http://localhost:8173/3d.html

タイトル画面からも 2D版と 3D版を切り替えられます。記録（クリア状況・ベストタイム・ゴースト）は同じブラウザ内で共通です。

`tools/serve.py` は `python -m http.server` と同じですが、修正したプログラムがすぐ反映されるよう `Cache-Control: no-cache` を付けます。Claude Code のプレビューでは `.claude/launch.json` の `yamanote-race` で同じサーバーを起動できます。

## 技術構成

HTML・CSS・JavaScript（ES モジュール）だけで作っており、ビルドツールは使いません。Three.js もプロジェクトに同梱していて、ゲーム中はネットから何も読み込まないので、ネットがなくても動きます。

| 役割 | 使うもの |
| --- | --- |
| 2D の描画 | HTML5 Canvas 2D |
| 3D の描画 | Three.js 0.170.0（`vendor/` に同梱） |
| 地図データ（道路・建物・信号・ランドマーク・公園や水域や線路などの背景） | OpenStreetMap（Overpass API で事前に取得し JSON に変換） |
| 音楽・効果音 | Web Audio API でその場で合成（素材ファイルなし） |
| 記録・設定の保存 | localStorage（キーは `yamanote-race:` で始まる） |

## フォルダ構成

```
├─ index.html          2D版の入口
├─ 3d.html             3D版の入口
├─ style.css
├─ src/
│  ├─ main.js          2D版の起動
│  ├─ main3d.js        3D版の起動
│  ├─ game.js          ゲームの仕組み（物理・信号・車・電車・音・記録・HUD）
│  ├─ render2d.js      2D の描き方
│  ├─ render3d.js      3D の描き方
│  ├─ map.js           道路・建物の描画、当たり判定、道路のつながり
│  ├─ player.js        自転車の動き
│  ├─ obstacles.js     信号・車・歩行者
│  ├─ train.js         難易度・制限時間・電車の進み具合
│  ├─ trainpath.js     地図の上を走る電車の経路
│  ├─ route.js         最速ルートの計算
│  ├─ ghost.js         ゴーストの記録と再生
│  ├─ share.js         結果のシェア（共有メニュー・クリップボード）
│  ├─ minimap.js       ミニマップ
│  ├─ landmarks.js     ランドマークの名前
│  ├─ audio.js         効果音・音楽・街の音
│  ├─ hud.js           画面表示（レースバー、各画面）
│  ├─ input.js         キー入力とスマホの画面ボタン
│  ├─ signals.js       信号機の見た目（2D版・3D版で共通）
│  ├─ vehicles.js      車の見た目（2D版・3D版で共通）
│  └─ pedestrians.js   歩行者の見た目（2D版・3D版で共通）
├─ data/
│  ├─ stations.json    駅の座標、区間の一覧、基準タイム
│  ├─ <区間ID>.json    区間ごとの地図データ（30ファイル、計約16MB。遊ぶときは選んだ区間の分だけ読み込む）
│  └─ models/
│     ├─ tokyo_station.glb     東京駅丸の内駅舎の 3D モデル（tools/build-tokyo-station.py で作成）
│     ├─ takanawa_gateway.glb  高輪ゲートウェイ駅の 3D モデル（tools/build-takanawa-gateway.py で作成）
│     ├─ ueno_station.glb      上野駅（1932 年の駅舎）の 3D モデル（tools/build-ueno-station.py で作成）
│     ├─ shinjuku_station.glb  新宿駅東口の駅ビルの 3D モデル（tools/build-shinjuku-station.py で作成）
│     ├─ shibuya_station.glb   渋谷駅（銀座線）の 3D モデル（tools/build-shibuya-station.py で作成）
│     ├─ ikebukuro_station.glb 池袋駅東口の駅ビルの 3D モデル（tools/build-ikebukuro-station.py で作成）
│     ├─ shinagawa_station.glb 品川駅の線路の上のコンコースの 3D モデル（tools/build-shinagawa-station.py で作成）
│     ├─ akihabara_station.glb 秋葉原駅（総武線のホームの屋根と駅の建物）の 3D モデル（tools/build-akihabara-station.py で作成）
│     ├─ kanda_station.glb     神田駅（高架の下の赤レンガのアーチと改札口）の 3D モデル（tools/build-kanda-station.py で作成）
│     └─ yurakucho_station.glb 有楽町駅（高架の下の赤レンガのアーチと改札口）の 3D モデル（tools/build-yurakucho-station.py で作成）
├─ tools/
│  ├─ fetch-osm.mjs    OpenStreetMap の取得・変換スクリプト（Node.js）
│  ├─ measure-par.js   基準タイムの計測（ブラウザのコンソールで使う）
│  ├─ build-tokyo-station.py  東京駅のモデルをゲーム向けに軽く Blender で組み立てる（Blender で実行）
│  ├─ build-takanawa-gateway.py  高輪ゲートウェイ駅のモデルを Blender で組み立てる（Blender で実行）
│  ├─ build-ueno-station.py  上野駅のモデルを Blender で組み立てる（Blender で実行）
│  ├─ build-shinjuku-station.py  新宿駅東口の駅ビルのモデルを Blender で組み立てる（Blender で実行）
│  ├─ build-shibuya-station.py  渋谷駅（銀座線）のモデルを Blender で組み立てる（Blender で実行）
│  ├─ build-ikebukuro-station.py  池袋駅東口の駅ビルのモデルを Blender で組み立てる（Blender で実行）
│  ├─ build-shinagawa-station.py  品川駅のコンコースのモデルを Blender で組み立てる（Blender で実行）
│  ├─ build-akihabara-station.py  秋葉原駅のモデルを Blender で組み立てる（Blender で実行）
│  ├─ build-kanda-station.py  神田駅のモデルを Blender で組み立てる（Blender で実行）
│  ├─ build-yurakucho-station.py  有楽町駅のモデルを Blender で組み立てる（Blender で実行）
│  ├─ export-glb.py    .blend のコレクションを glb に書き出す（Blender で実行）
│  └─ serve.py         開発用のサーバー
├─ vendor/
│  ├─ three.module.js  Three.js
│  └─ addons/          Three.js の GLTFLoader（glb の読み込み）と、それが使う BufferGeometryUtils
└─ docs/screenshots/   README のスクリーンショット
```

## 区間データの作り直し・追加

区間データは `tools/fetch-osm.mjs` で OpenStreetMap から作ります（Node.js が必要です）。

```bash
node tools/fetch-osm.mjs all
```

区間IDを指定するとその区間だけを変換し、`--refresh` を付けると Overpass から取り直します。取得した元データは `tools/.cache/`（git の対象外）に保存され、変換だけやり直すときは再取得しません。

区間を足すときは「`data/stations.json` に駅と区間を書く → 変換スクリプトを動かす → 確認する → `tools/measure-par.js` で基準タイムを計って `parSeconds` に書く」の順です。詳しい手順や取り込みのルールは [開発手順書_山手線に勝て.md](開発手順書_山手線に勝て.md) を参照してください。

## 開発の記録

各フェーズで作ったもの、仕様を変えた理由、テストの方法（`window.game` を使った自動運転など）、今後の課題は [開発手順書_山手線に勝て.md](開発手順書_山手線に勝て.md) にまとめています。

## クレジット・ライセンス

- このゲームのプログラム（HTML・CSS・JavaScript・ツール）は [MIT ライセンス](LICENSE) です。ただし、下の地図データと Three.js はそれぞれのライセンスに従います。
- `data/` の地図データは OpenStreetMap から作ったものなので、MIT ではなく ODbL に従います（`data/models/` の 3D モデルは Blender で自作したもので、OpenStreetMap のデータではありません）。© [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors（ゲーム画面の右下とタイトル画面にも表示しています）。
- [Three.js](https://threejs.org/)（MIT ライセンス）。著作権表示は `vendor/three.module.js` の先頭にあります（`vendor/addons/` も同じ Three.js 0.170.0 のファイルです）。
- 発車メロディ風の曲と効果音はすべてオリジナルで、Web Audio で合成しています。
- JR のロゴや駅名標のデザインは使っていません（駅名の文字だけ）。
