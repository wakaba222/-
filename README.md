# EAGLE Coach Performance System

株式会社イーグル ゴルフコーチ向け 評価・報酬管理システム。

コーチが顧客成果を出し、売上を作り、キャリアを上げるためのシステム。
評価制度の管理台帳ではなく、**「今どこにいるか」「次に何をすればいいか」** を示すことを最優先に設計している。

コーチの日常入力は **成果登録と売上登録の2つだけ**。
経過月数・評価対象判定・各種成果率・配点・3ヶ月平均・ボーナス・昇格判定はすべて自動計算する。

## 評価モデル

```
Professional Score (通常100点 / 最大120点)
├── 顧客成果点 (通常50 / 最大60)
│   ├── 長期: 完全成果率      90% → 30点 / 100% → 36点
│   └── 短期: 直近3ヶ月成果率 90% → 20点 / 100% → 24点
└── 売上点   (通常50 / 最大60)
    └── 月次 200万 → 40点 / 350万 → 50点 / 500万 → 60点
```

- 顧客はプログラム開始から **満4ヶ月経過後** に成果評価の対象になる
- **プログラム終了後の達成も完全成果として加算**する (未達を永久固定にしない)
- 昇格・四半期ボーナスは **単月では判定せず**、3ヶ月連続 + 3ヶ月平均で判定する
- 評価対象が0名のときは 0点ではなく **N/A (評価対象不足)** として扱う
- 閾値・配点・昇格基準はすべて `evaluation_rules` に JSON で保持し、version 管理する

## 技術構成

| 領域 | 採用 |
|---|---|
| Framework | Next.js 16 (App Router) / React 19 / TypeScript strict |
| UI | Tailwind CSS v4 (白ベース + ダークグリーン + ゴールド) |
| DB / Auth | Supabase (PostgreSQL + Auth + Row Level Security) |
| Validation | Zod (フォーム / Server Action / 評価ルール) |
| Test | Vitest (評価ロジックの単体テスト) + psql による RLS 実地テスト |

### ディレクトリ構成の要点

```
src/
├── domain/          ★ 純粋関数のみ。DB・時刻・環境に一切依存しない
│   ├── date.ts          Date を介さない日付演算 (JST固定)
│   └── evaluation/      評価エンジン (rules / 対象判定 / 成果率 / 売上 / 昇格 / ボーナス)
├── server/          I/O層 (repositories / services / Server Actions)
├── app/             画面 (計算は書かない)
└── components/      表示専用コンポーネント
```

評価は **リアルタイム表示も月次確定も同じ `evaluateCoachMonth` を通る**ため、
ダッシュボードの数字とスナップショットの数字が食い違わない。

## セットアップ

```bash
npm install
cp .env.example .env.local   # Supabase の URL / キーを設定
npm run dev
```

### Supabase プロジェクトへの初期投入

```bash
npm run db:push -- supabase/migrations/*.sql   # スキーマ・RLS・監査ログ・マスタデータ
npm run seed:users                             # デモユーザーを Auth の Admin API で作成
npm run db:push -- supabase/seed.sql           # デモデータ (顧客27名・成果・売上)
npm run verify:remote                          # 実環境の通し検証
```

Supabase CLI が使える環境なら `supabase db reset` でも migrations を適用できる
(その場合も認証ユーザーは `npm run seed:users` で作成する)。

`seed.sql` は認証ユーザーを直接作らない。
`auth` スキーマの構造は GoTrue のバージョンに追従するため、直接 INSERT すると
ログインできない不整合が起きうる。デモユーザーは必ず Admin API 経由で作成する。

### デモアカウント

| 役割 | メール | 想定される状態 |
|---|---|---|
| ADMIN | `admin@eagle.example` | 全体管理 |
| COACH | `tanaka@eagle.example` | P2・**P3昇格候補** (Score 108.5 / 完全成果率90%) |
| COACH | `sato@eagle.example` | P1・基準未達 (Score 50.2 / 行動ルール WARNING) |
| COACH | `suzuki@eagle.example` | P3・最高評価 (Score 120 / 事業成果要件が未承認で昇格不可) |

パスワードは `DEMO_USER_PASSWORD` に設定した値 (デモ環境専用)。

## テスト

```bash
npm test              # 評価ロジックの単体テスト (仕様35章の必須13ケース + 異常系)
npm run typecheck
npm run lint
npm run build
```

### Supabase CLI が使えない環境での DB 検証

Docker が無い環境でもスキーマ・RLS・シードを検証できるようにしてある。

```bash
# ローカル PostgreSQL を起動しておく (例: ポート 55432)
npm run db:local      # マイグレーション適用 → RLSテスト → シード投入
npm run verify:seed   # シードデータに評価エンジンを実際に適用して結果を検証
```

`db:local` は COACH が他コーチの顧客・売上へ到達できないこと、
監査ログに変更前後が記録されることを DB レベルで検証する。
`verify:seed` は DB → 評価 → 昇格判定までを通しで実行し、想定した結果になるか確認する。

### 実環境の検証

```bash
npm run verify:remote   # データ層: 認証・RLS・評価・スナップショット・昇格判定
npm run build && npm run e2e   # 画面: 実ブラウザでコーチ/ADMINの主要導線を確認
```

`verify:remote` は認証 → RLS → 権限昇格の防止 → Professional Score 算出 →
月次スナップショット → 昇格判定までを、実際の Supabase プロジェクトに対して順に確認する。

`e2e` は本番ビルドを起動し、実ブラウザ (Chromium) で
コーチのダッシュボード・成果登録・売上登録・スコア反映と、
ADMIN の比較表・目標承認・昇格審査・月次締めを確認する。
コーチ画面はスマートフォン (iPhone 14) の画面サイズでも検証する。

## 秘密情報の取り扱い

- 実際のキーは `.env.local` にのみ置く (`.gitignore` 済み)
- `SUPABASE_SERVICE_ROLE_KEY` はサーバー側の処理と運用スクリプトでのみ使用し、
  クライアントバンドルには含めない (`NEXT_PUBLIC_` 接頭辞を付けない)
- `SUPABASE_ACCESS_TOKEN` は初期セットアップ専用。作業後は Supabase の
  Account Settings → Access Tokens から失効させてよい

## 運用フロー

```
ADMINが顧客を登録 → 目標を承認 → コーチが成果を登録
  → 満4ヶ月経過で自動的に評価対象 → 完全成果率・短期成果率を自動更新
  → コーチが売上を登録 → 売上点・Professional Score を自動更新
  → 月次締め (ADMIN操作 or Vercel Cron) でスナップショットを確定
  → 3ヶ月平均・四半期ボーナス・昇格条件を自動判定
  → コーチ画面に「現在地と次の条件」、ADMIN画面に全員比較を表示
```

月次締めは `/admin/close` から手動実行、または `/api/cron/monthly-close` を
毎月1日に Vercel Cron から呼び出す (`vercel.json` に設定済み)。

## 検証状況

| 検証 | 手段 | 結果 |
|---|---|---|
| 評価ロジック | `npm test` | 122件通過 (制度の数値表・昇格ケース・異常系) |
| 型・Lint・ビルド | `npm run typecheck` / `lint` / `build` | エラー0 |
| スキーマ・RLS (ローカル) | `npm run db:local` | 通過 |
| 実環境の通し検証 | `npm run verify:remote` | 23件通過 (認証・RLS・権限昇格防止・Score・スナップショット・昇格判定・ルール変更時の不変性) |
| 画面 (実ブラウザ) | `npm run e2e` | 17件通過 (デスクトップ14 / スマホ3) |

## 設計ドキュメント

| ドキュメント | 内容 |
|---|---|
| [01-requirements.md](docs/01-requirements.md) | 要件理解 / 仕様の論点と確定した判断 |
| [02-architecture.md](docs/02-architecture.md) | アーキテクチャ / レイヤ構成 / セキュリティ |
| [03-er-and-schema.md](docs/03-er-and-schema.md) | ER図 / テーブル設計 |
| [04-evaluation-logic.md](docs/04-evaluation-logic.md) | 評価ルールJSON / ロジック擬似コード |
| [05-screens-and-plan.md](docs/05-screens-and-plan.md) | 画面一覧 / 実装Phase / リスク / スコープ |
