# Sats World Map ⚡ — ライトニングで地図を灯そう

ビットコインカンファレンスの会場のプロジェクターに映す、合間の時間のミニゲーム。
お客さんがスクリーンの QR をスマホで読み、都道府県か国を選んで Lightning で sats を投げると、
地図がその場で灯り、稲妻・花火・吹き出しが出ます。

元は [fixthemoney/SatsMap](https://github.com/fixthemoney/SatsMap) の見た目のモックアップ（ダミーデータ）。
これに Blink での本物の支払いと、会場向けの遊びを足しました。

- **サーバーはいりません。** 置くのは HTML・CSS・JS だけで、Nostr（nsite）に上げて公開します
- **受け取りは Blink。** スマホのページは、キーなしで「受け取る人宛てのインボイス」を Blink に作ってもらいます
- **スクリーンは Blink の「受け取った支払い」を数秒ごとに読みます。** そのための API キー（Read だけ）は、スクリーンを映すパソコンのブラウザの中にだけ置きます

---

## 1. できること

| | |
|---|---|
| **スマホの支払いページ**（`pay.html`） | 47 都道府県（名物の絵文字つき）か世界の国を選ぶ → 21 / 210 / 2,100 / 21,000 sats か好きな金額 → ニックネームとひとこと（なくてもよい）→「投げる」でウォレットが開く。払うと「届きました！」。選んだ地域と名前は次のために覚える |
| **地図が灯る** | 届いたらその地域へ寄って、金額に応じて演出：100 未満は火花、100〜は稲妻、2,100〜は花火、21,000〜は画面いっぱいの 🐋 WHALE ZAP（画面がゆれる）。地図の色は合計の多さで濃くなる |
| **吹き出し** | その地域の上に、名前とひとことが出る |
| **日本 vs 世界の綱引き** | 都道府県（と日本）に投げた分 vs ほかの国に投げた分 |
| **制覇** | 都道府県 N / 47。初めての地域は「NEW! 初制覇」、47 そろうと「全国制覇！」 |
| **ラウンド** | 合間ごとに 1 ラウンド（長さとゴールは管理画面で）。残り時間・ゴールのバー（25・50・75・100% で知らせ）・いまの MVP。終わると結果の画面（合計・MVP・いちばん灯った地域・最大の 1 投・日本 vs 世界） |
| **おまけ** | 20 秒以内に続くと 🔥 COMBO、ゾロ目（111・777…）、キリ番（10・21・50・100 投目…）、累計の節目（1,000・2,100・5,000・10,000… sats 突破） |
| **ランキング** | 地域と「投げた人」（ニックネーム）を 12 秒ごとに切り替え |
| **呼び込み** | 下の帯に「まだだれも投げていない：🐫 鳥取県 — 最初の 1 投で初制覇！」などを順に出す |
| **効果音** | 合成した短い音（ファイルなし）。ブラウザの決まりで、スクリーンを一度クリックしてから鳴る |
| **管理画面**（`admin.html`） | Blink の設定と接続テスト、ラウンドの開始・終了、演出の金額、メッセージの NG ワード・隠す、テストの 1 投、CSV で保存、最初からやり直す |
| **デモ** | API キーを入れるまではデモ。下のボタンで送金をまねて、演出を確かめられる |

メッセージは、NG ワードを含むものは出さず、URL・インボイス・npub は 🔗 に置き換えます。名前やひとことに書いた HTML は文字として出します。

## 2. しくみ

```
お客さんのスマホ                     Blink                       会場のパソコン（スクリーン）
 pay.html ──「◯◯宛てのインボイスを」→ api.blink.sv ←── 受け取った支払いを 4 秒ごとに読む（API キー：Read）
   │          （キー不要）              ↑                    │
   └── ウォレットで払う ────────────────┘                    └→ メモの地域・名前で、地図を灯す
```

インボイスのメモに、地域・ニックネーム・ひとことを入れています（ウォレットにもそのまま出ます）：

```
⚡SatsMap 🗼東京都 from ましゅ ##{"v":1,"r":"jp_prefecture:JP-13","n":"ましゅ","m":"はじめての Lightning！"}
```

スクリーンは、このメモが付いた入金だけを数えます（管理画面で「直接の送金も数える」をオンにしたときを除く）。
本物のお金が Blink に入ったものだけが地図に出るので、偽の「投げた」は作れません。

## 3. 準備するもの

1. **Blink のアカウント**（https://www.blink.sv）。**イベント専用のアカウントをおすすめします**（スクリーンは受け取った支払いを読むので）
2. **API キー**：Blink のダッシュボード（https://dashboard.blink.sv）→ API Keys で作る。**権限は Read だけ**（Receive・Write は要りません。Read だけなら、このキーでお金は動かせません）
3. 上げるとき：Mac に [nsyte](https://github.com/sandwichfarm/nsyte) と、署名アプリ（Clave・nsec.app など。bunker:// を出せるもの）

## 4. 手元で試す

```bash
npm run serve
```

`http://localhost:8787/` を開くとデモで動きます（下のボタンで送金をまねる）。
`http://localhost:8787/admin.html` で Blink のユーザー名と API キーを入れると、本物の支払いで動きます。
スマホからは同じ Wi-Fi で `http://<パソコンの IP>:8787/pay.html?u=<Blink のユーザー名>`。

自動の確認（Blink の API はまねて答えます）：

```bash
npm test
```

## 5. Nostr（nsite）に上げる

1. nsyte を入れる

```bash
curl -fsSL https://nsyte.run/get/install.sh | bash
```

2. （はじめてだけ）署名アプリとつなぐ。秘密鍵は打ち込まない

```bash
nsyte bunker connect 'bunker://…'
```

3. 上げる

```bash
npm run deploy
```

開く場所は `https://<署名した人の npub>.nsite.lol/`。スクリーン・`/admin.html`・`/pay.html` が開けます。
置き場所（リレー・Blossom サーバー）は `.nsite/config.json`。

支払いページの URL をポスターなどに刷るときは、先に `js/config.js` の `blinkUsername` に Blink のユーザー名を書いてから上げてください
（書かないときは、管理画面で入れた名前が QR の URL に `?u=` で付きます）。イベント名も `js/config.js` の `eventName` に書けます。

## 6. 会場で

1. スクリーンを映すパソコンで、Chrome で `https://<npub>.nsite.lol/` を開く
2. 同じブラウザで `admin.html` を開く（スクリーンで `A` を押しても開く）→ Blink のユーザー名と API キーを入れて **接続テスト**。✓ が 3 つ並べば OK
3. 自分のスマホでスクリーンの QR を読み、**21 sats を投げて、スクリーンに出るまで**を確かめる（リハーサル）
4. 管理画面の「テストの記録を消す」、必要なら「最初からやり直す」
5. スクリーンを一度クリック（音を出すため）→ `F` で全画面
6. 合間になったら `Space`（または管理画面の「ラウンドを始める」）。時間が来ると結果が出る。次の合間にまた `Space`

| キー（スクリーン） | |
|---|---|
| `F` | 全画面 |
| `Space` | ラウンドを始める・終える |
| `M` | 音を出す・止める |
| `1` / `2` / `0` | 世界だけ / 日本だけ / 両方 |
| `A` | 管理画面 |
| `D` | デモの 1 投（デモのときだけ） |
| `Esc` | 結果の画面を閉じる |

記録はそのパソコンのブラウザの中にあり、開き直しても続きから。閉じていたあいだの入金も、開いたときに数えます（演出はなし）。

## 7. 安全とお金のこと

- API キー・記録は、スクリーンを映すパソコンのブラウザ（localStorage）の中だけ。サイトのファイル・Nostr には入りません。終わったら管理画面の「キーを消す」
- API キーは **Read だけ**で作る。漏れても残高と履歴が見えるだけで、お金は動かせません
- 管理画面は URL を知っていればだれでも開けますが、キーも記録もその人のブラウザにしかないので、会場のスクリーンには何もできません
- 「投げた sats は返金できない」「景品・賞品はない」と支払いページに書いています。**投げた結果で景品が当たる形にはしないでください**（賭博・景品表示法にかかるおそれがあります）
- ニックネーム・ひとことはインボイスのメモに入るので、Blink の履歴に残ります

## 8. 確かめていないこと【要確認】

作業した環境から Blink・nsite につながらなかったため、次は本番の前に確かめてください（管理画面の接続テストとリハーサルでわかります）：

- **Blink の API**：使っているのは `accountDefaultWallet`・`lnInvoiceCreateOnBehalfOfRecipient`・`lnInvoicePaymentStatusByPaymentRequest`（ない場合は `lnInvoicePaymentStatus`）・`me { … transactions }`。ブラウザから直接呼んでいる（CORS）。自動の確認は、これらの形をまねて通しています
- **nsite.lol** で、ページから api.blink.sv への通信が止められないか
- 受け取りのメモ（`memo`）が Blink の取引の一覧にそのまま出るか（出ないと、地域が「⚡」になる）
- 会場の Wi-Fi が不安定なときは、スクリーンのパソコンをスマホのテザリングにつなぐと安心

## 9. ファイル

```
index.html        スクリーン（プロジェクター）
pay.html          スマホの支払いページ
admin.html        管理画面
css/              style.css（スクリーン）・pay.css・admin.css
js/config.js      会場ごとの設定（Blink のユーザー名・イベント名・金額）
js/common.js      地域（都道府県・国）・メモの読み書き・NG ワード
js/blink.js       Blink の GraphQL API
js/store.js       設定と記録（localStorage）・スクリーンと管理画面の知らせ（BroadcastChannel）
js/effects.js     演出（稲妻・花火・紙吹雪・札）と効果音
js/map.js         amCharts の世界地図・日本地図
js/app.js         スクリーンの動き
js/pay.js / js/admin.js
js/countries.js   国の一覧（scripts/build-vendor.mjs が作る）
vendor/           amCharts・QR コード・Font Awesome（scripts/build-vendor.mjs が node_modules から作る）
scripts/          serve.mjs（手元のサーバー）・e2e.mjs（自動の確認）・build-site.mjs・deploy-nsite.sh・build-vendor.mjs
.nsite/config.json  nsite の置き場所
```

ライブラリを上げるときは `npm install` → `npm run vendor`。

## 10. ライセンス

| もの | ライセンス |
|---|---|
| [amCharts 5](https://www.amcharts.com/)（地図） | 無料版のリンクウェア。地図の左下のロゴを消さないこと、`vendor/amcharts/LICENSE` を一緒に置くことが条件 |
| [qrcode-generator](https://github.com/kazuhikoarase/qrcode-generator)（Kazuhiko Arase） | MIT |
| [Font Awesome Free](https://fontawesome.com/) | アイコン CC BY 4.0・フォント SIL OFL 1.1・コード MIT（`vendor/fontawesome/LICENSE.txt`） |
| Inter・JetBrains Mono（Google Fonts） | SIL OFL 1.1 |
| 元のモックアップ | [fixthemoney/SatsMap](https://github.com/fixthemoney/SatsMap) |
