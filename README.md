# RecordLog

話す → 文字になる → **1日1回、AI がその日ぶんを整理して積む**。それだけの音声メモ。

ブラウザで開けて、ホーム画面にインストールできる PWA。Cloudflare の無料枠だけで動きます。

```
       話す                すぐ                    毎日 03:00
  ┌───────────┐    ┌──────────────┐    ┌────────────────────┐
  │  録音     │ ─> │  文字起こし   │ ─> │  その日を1枚にまとめ │
  │ (端末)    │    │  (Whisper)   │    │   て積層 (Cron)     │
  └───────────┘    └──────────────┘    └────────────────────┘
       IndexedDB に即保存           D1 に同期        digests に保存
```

---

## 何ができるか

- **押して話すだけ。** 電波が無くても録れる。端末に先に書いてから、つながった時にサーバーへ送る。
- **話している最中から文字が出る。** リアルタイム字幕はブラウザの音声認識、保存される本文は Whisper。
- **1日1回だけまとめる。** Cloudflare の Cron Trigger が毎日 03:00 (Asia/Tokyo) に走り、前日ぶんを
  AI が概要・話題別の節・やること・続き・引用に編集して保存する。取りこぼした日は次の実行で追いつく。
- **インストールできる。** ホーム画面から全画面で開く。オフラインでも起動する。
- **全部無料枠。** Workers / D1 / R2 / Workers AI の無料枠内で動く前提の設計。

---

## 音声キャプチャについて

いちばん手をかけた部分です。ブラウザ録音が「なんとなく聞き取れない」ものになる原因は、だいたい
決まったところにあります。

| 手当てしたこと                                                       | なぜ                                                                                                                                                                                                                   |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **AudioWorklet で取り込む** (`public/worklets/capture-processor.js`) | 音声レンダリングスレッドで動くので、React の再描画や GC でサンプルが落ちない。`MediaRecorder` と違い、圧縮前の生の PCM が手に入る。                                                                                    |
| **DC 除去 (1次ハイパス, ~30 Hz)**                                    | マイクのゴロつきは Whisper の最初のトークンを壊す。入口で落とす。                                                                                                                                                      |
| **適応ノイズフロア + ヒステリシス付き VAD**                          | 立ち上がり 90 ms・ハングオーバー 620 ms。キーボードのカチッでゲートが開かず、息継ぎで閉じない。                                                                                                                        |
| **Kaiser 窓 sinc リサンプラ** (`src/lib/audio/resample.ts`)          | Whisper は 16 kHz。48 kHz から 3 サンプルおきに間引くと 8 kHz 以上が折り返して歯擦音の帯域を潰す。32 タップ・512 位相のポリフェーズで正しく落とす。**テストで 12 kHz のトーンが 4 kHz に折り返さないことを検証済み。** |
| **前後の無音トリム + 上限つきノーマライズ**                          | 頭とお尻の空白を切り、小さい録音だけ持ち上げる (最大 +20 dB)。静かな部屋をヒスの壁にしない。                                                                                                                           |
| **クリップ検出**                                                     | 割れ始めたら録音中に警告する。あとで気づいても手遅れなので。                                                                                                                                                           |
| **Wake Lock**                                                        | 話している最中に画面が寝ない。                                                                                                                                                                                         |

文字起こしエンジンは 3 系統。**落ちても思考を落とさない**ように多段になっています。

1. **Cloud Whisper** — Workers AI の `@cf/openai/whisper-large-v3-turbo`。既定。無料枠内。
2. **端末内 Whisper** — transformers.js。WebGPU があれば `whisper-large-v3-turbo`、無ければ
   `whisper-base`。音声が端末から一切出ない。圏外でも動く。モデルは CDN から遅延取得するので
   アプリ本体のバンドルは太らない。
3. **ブラウザ音声認識 (Web Speech API)** — リアルタイム字幕専用。保存本文には使わない
   (ただし 1・2 が両方失敗した時は、聞き取れた分をメモとして残す)。

---

## 構成

| 層       | 使っているもの                                                       |
| -------- | -------------------------------------------------------------------- |
| UI       | React 19 · TypeScript · Vite 8 · Tailwind CSS 4 · Zustand            |
| PWA      | vite-plugin-pwa (Workbox) — インストール可・オフライン起動・更新通知 |
| 端末保存 | IndexedDB (`idb`) — メモ・音声・ダイジェスト                         |
| API      | Cloudflare Workers + Hono                                            |
| データ   | D1 (SQLite)                                                          |
| 音声保管 | R2 (既定 14 日で自動削除)                                            |
| AI       | Workers AI — Whisper (文字起こし) / Llama 3.3 70B (整理)             |
| 定期実行 | Cloudflare Cron Triggers                                             |

```
shared/          PWA と Worker が共有する型と日付計算（両側でズレると深夜のメモが迷子になる）
src/lib/audio/   録音・DSP・リサンプラ・WAV
src/lib/asr/     文字起こしエンジンとフォールバック
src/lib/db/      IndexedDB
src/features/    録音ドック・メモ一覧・積層・設定
worker/          API・認証・D1・Workers AI・日次ジョブ
public/worklets/ AudioWorklet プロセッサ
public/workers/  端末内 Whisper ワーカー
```

---

## セットアップ

必要なもの: Node 20 以上、Cloudflare アカウント（無料プランで可）。

```bash
npm install
npx wrangler login
```

### 1. D1 を作る

```bash
npx wrangler d1 create recordlog
```

出力された `database_id` を `wrangler.jsonc` の `d1_databases[0].database_id` に入れます。

> このリポジトリには作成済みの `database_id` が入っています。同じアカウントで使うならそのままで
> 構いません。別のアカウントに置く場合だけ作り直してください。

### 2. スキーマを流す

```bash
npm run db:migrate          # 本番
npm run db:migrate:local    # ローカル
```

### 2.5. （任意）音声もサーバーに残したいなら R2

**なくても動きます。** R2 を繋がない場合、文字起こしも日次まとめもそのまま動き、音声は録音した
端末の中（IndexedDB）にだけ残ります。アプリは binding の有無を自分で見て、設定の
「音声をサーバーに保管」を無効表示に切り替えます。

複数の端末から録音を聴き返したい場合だけ、ダッシュボードで **R2 > Enable** を押してから:

```bash
npx wrangler r2 bucket create recordlog-audio
```

`wrangler.jsonc` の `r2_buckets` の行のコメントを外して再デプロイすれば有効になります。

### 3. パスフレーズを設定する

公開ホストに置くなら必須です。設定しない場合、URL を知っている人は誰でも読み書きできます。

```bash
npx wrangler secret put AUTH_PASSPHRASE
npx wrangler secret put SESSION_SECRET   # 長いランダム文字列。変えると全端末がログアウトする
```

### 4. デプロイ

```bash
npm run deploy
```

`https://recordlog.<your-subdomain>.workers.dev` が出ます。スマホで開いて、
共有 →「ホーム画面に追加」(iOS) か、表示されるインストールボタン (Android/PC) で入れてください。

#### GitHub 連携 (Cloudflare Workers Builds) で自動デプロイする場合

ダッシュボード側に build コマンドを設定する必要は**ありません**。PWA のビルドは
`wrangler.jsonc` の `build.command` に書いてあるので、Workers Builds の
**Deploy command** が既定の `npx wrangler deploy` のままで、
`npm run build` → `dist/` 生成 → デプロイまで一気に走ります。

ただし **D1 だけは先に用意しておくこと。** `database_id` が
`REPLACE_WITH_YOUR_D1_DATABASE_ID` のままだと、ビルド冒頭の preflight が何をすればいいかを
出したうえで止まります。R2 は任意なので、なくてもデプロイは通ります。

`AUTH_PASSPHRASE` と `SESSION_SECRET` は `wrangler secret put` で入れたものが
そのまま使われます（Workers Builds 側で環境変数として入れ直す必要はありません）。

---

## ローカル開発

```bash
cp .dev.vars.example .dev.vars   # パスフレーズを試すとき
npm run db:migrate:local

npm run dev          # UI (Vite, :5173) — /api は :8787 にプロキシされる
npm run dev:worker   # API (Wrangler, :8787)
```

Workers AI はローカルにモデルを持たないため、`wrangler dev` では文字起こしと日次まとめが
`Binding AI needs to be run remotely` で失敗します。UI と録音パイプラインの確認はこれで十分です。
AI まで通したい場合は `npx wrangler dev --remote` を使ってください。

### 日次ジョブを手で走らせる

```bash
npm run dev:worker
curl "http://127.0.0.1:8787/cdn-cgi/local/scheduled?cron=0+18+*+*+*"
```

アプリ内の「今すぐ走らせる」ボタン、または日付見出しの「今すぐ積む」でも同じ処理を叩けます。
実行結果は `runs` テーブルに残るので、失敗が黙って消えることはありません。

```bash
npx wrangler d1 execute recordlog --local \
  --command "SELECT ran_at, day, trigger, status, memo_count, detail FROM runs ORDER BY ran_at DESC LIMIT 10"
```

---

## トラブルシューティング

**`The directory specified by the "assets.directory" field ... does not exist: /opt/buildhome/repo/dist`**
`dist/` を作る前に `wrangler deploy` が走っています。`wrangler.jsonc` の
`build.command` が消えていないか確認してください。ここに書いてあれば
`wrangler deploy` / `wrangler dev` のどちらでも先にビルドが走ります。

**`preflight: Cloudflare 側のセットアップが未完了です`**
メッセージのとおり、D1 を作って `database_id` を貼り替えてください。
ローカルビルドでは警告だけで止まりません。

**`Please enable R2 through the Cloudflare Dashboard` / 音声の再生が 404**
R2 がアカウントで有効になっていません。R2 は任意なので、繋がないまま使うのが既定です
（音声は端末に残ります）。使いたい場合は手順 2.5 を参照してください。

**日次まとめが走っていない**
`runs` テーブルを見てください。理由が残っています。

```bash
npx wrangler d1 execute recordlog --remote \
  --command "SELECT ran_at, day, trigger, status, memo_count, detail FROM runs ORDER BY ran_at DESC LIMIT 10"
```

`status = 'error'` で `detail` に Workers AI のエラーが出ていれば、無料枠の
Neurons を使い切っている可能性があります。翌日には戻り、取りこぼした日は次の実行で
追いつきます。

---

## テスト

```bash
npm run check     # typecheck + lint + unit + build
npm run test      # Vitest — リサンプラ・DSP・WAV・日付・JSON 抽出
```

実ブラウザでの録音経路の検証（AudioWorklet → VAD → リサンプラ → WAV → IndexedDB）:

```bash
npm run e2e:fixture                       # 音声っぽい合成音を作る
npm run build && npm run dev:worker &     # 別シェルで
PASS=<passphrase> npm run e2e
```

Chromium の合成マイクにその WAV を食わせ、保存された音声が本当に 16 kHz モノラル 16-bit PCM で、
録音長と一致しているところまで確かめます。スクリーンショットは `tests/e2e/artifacts/` に出ます。

---

## 設定できること

`wrangler.jsonc` の `vars`:

| 変数              | 既定                                       | 意味                                             |
| ----------------- | ------------------------------------------ | ------------------------------------------------ |
| `APP_TIMEZONE`    | `Asia/Tokyo`                               | 「1日」の境界。Cron の時刻もこれに合わせて決める |
| `ASR_MODEL`       | `@cf/openai/whisper-large-v3-turbo`        | 文字起こしモデル                                 |
| `LLM_MODEL`       | `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | 整理に使うモデル                                 |
| `KEEP_AUDIO_DAYS` | `14`                                       | R2 の音声を残す日数。`0` で無期限                |

`triggers.crons` の `"0 18 * * *"` は **UTC** です。18:00 UTC = 03:00 JST。
タイムゾーンを変えたら、この値も一緒に直してください。

アプリ内の設定（歯車アイコン）からは、エンジン・言語・リアルタイム字幕・自動整形・
ブラウザの音声処理・無音自動停止・音声の保管先を切り替えられます。

---

## 無料枠について

| サービス      | 無料枠                      | このアプリの使い方                                                   |
| ------------- | --------------------------- | -------------------------------------------------------------------- |
| Workers       | 100,000 req/日              | API と静的配信                                                       |
| D1            | 5 GB · 500 万行書き込み/月  | メモとダイジェスト（テキストのみ）                                   |
| R2 (任意)     | 10 GB · エグレス無料        | 元音声。既定 14 日で削除。使うにはダッシュボードで R2 の有効化が必要 |
| Workers AI    | 1 日あたりの Neurons 無料枠 | Whisper と Llama。1 日 1 回のまとめは 1〜数回の推論で済む            |
| Cron Triggers | 無料                        | 1 日 1 回                                                            |

R2 を繋がない既定の構成なら、使うのは Workers・D1・Workers AI の 3 つだけです。

---

## ライセンス

MIT

<!-- ecosystem:begin (自動生成: gentaron/infocollect の ecosystem/registry.json から。手で直さない) -->

## つながり

gentaron のリポジトリ群のうち **道具** の一つ。話す → 文字になる → 1日1回 AI が整理して積む音声メモ。

- **同じ島**: [pk3](https://github.com/gentaron/pk3)、[Bubble](https://github.com/gentaron/Bubble)、[veile-bot](https://github.com/gentaron/veile-bot)、[webportal](https://github.com/gentaron/webportal)

全体の地図 → [ecosystem](https://github.com/gentaron/infocollect/blob/HEAD/ecosystem/README.md)

<!-- ecosystem:end -->
