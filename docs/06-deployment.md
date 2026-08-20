# 06. デプロイ手順 (Vercel)

ブラウザから使える公開URLを用意するための手順。
Supabase への初期投入 (migrations / seed / 検証) が完了していることが前提。

## 1. 事前に用意するもの

Supabase ダッシュボードの **Project Settings → API** から取得する値。

| 環境変数 | 取得元 | 用途 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL | アプリの接続先 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | anon public / Publishable key | ブラウザからの接続 |
| `SUPABASE_SERVICE_ROLE_KEY` | service_role / Secret key | 月次締めジョブ (サーバー側のみ) |
| `CRON_SECRET` | 任意の文字列 | 月次締めエンドポイントの認証 |

`NEXT_PUBLIC_` が付く2つはブラウザに配信される。付いていない2つは
サーバー側でのみ使われ、クライアントには渡らない。

## 2. Vercel での手順

1. https://vercel.com にログイン (GitHubアカウントで可)
2. **Add New… → Project** を選ぶ
3. GitHub リポジトリの一覧から対象リポジトリを **Import**
4. **Framework Preset** が `Next.js` になっていることを確認
5. **Root Directory** はリポジトリ直下のまま
6. **Environment Variables** に上記4つを1つずつ追加
7. **Deploy** を押す
8. 完了後に表示される `https://<プロジェクト名>.vercel.app` が公開URL

ブランチを指定する場合は、Import 後の **Settings → Git → Production Branch** で
`claude/eagle-coach-performance-1xg0jp` を指定する。

## 3. デプロイ後にSupabase側で行う設定

Supabase ダッシュボード → **Authentication → URL Configuration**:

- **Site URL** に公開URL (`https://<プロジェクト名>.vercel.app`) を設定
- **Redirect URLs** に同じURLを追加

これを設定しないと、ログイン後のリダイレクトが正しく動かない場合がある。

## 4. 月次締めの自動実行

`vercel.json` に Cron が定義済み (毎月1日 05:00 JST に前月を確定)。

```json
{ "crons": [{ "path": "/api/cron/monthly-close", "schedule": "0 20 1 * *" }] }
```

Vercel Cron は `Authorization: Bearer $CRON_SECRET` を自動で付与する。
手動で締める場合は ADMIN 画面の **月次締め** から実行できる。

> Cron は Vercel の Hobby プランでは1日1回までの制限がある。
> 月次実行のため通常は問題にならない。

## 5. 動作確認

1. 公開URLを開く → ログイン画面
2. ADMIN (`admin@eagle.example`) でログイン → 全コーチ比較表
3. コーチ (`tanaka@eagle.example`) でログイン → Professional Score とその内訳
4. 成果登録 → 達成判定が即時表示される
5. 売上登録 → 商品選択で金額が自動入力される
6. ダッシュボードに戻る → Score が更新されている

## 6. 本番運用へ移行する際のチェックリスト

- [ ] デモユーザー4名を削除し、実際のコーチのアカウントを作成する
- [ ] デモ顧客27名・売上データを削除する
- [ ] `DEMO_USER_PASSWORD` を使ったアカウントを残さない
- [ ] `SUPABASE_ACCESS_TOKEN` (個人アクセストークン) を失効させる
- [ ] 評価ルールの閾値を実際の制度に合わせて確認する (`/admin/rules`)
- [ ] 商品マスタの価格・インセンティブ額を確認する (`/admin/products`)
- [ ] Supabase のバックアップ設定を確認する
