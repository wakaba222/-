# 08. 権限設計 — COACH は設定変更権限を一切持たない

**確定仕様: COACH ロールは設定変更の権限を一切持たない。**
設定系の画面・API・DB更新はすべて ADMIN 限定とする。

---

## 1. 「設定」の定義

COACH が変更できないもの:

| 対象 | 中身 | どこに入っているか |
|---|---|---|
| 評価ルール | Score配点・アンカー・昇格条件・報酬設定 | `evaluation_rules` |
| 商品・インセンティブ設定 | 価格・税区分・インセンティブ額・Score対象フラグ | `products` |
| コーチのランク | P1〜P4 | `coaches.professional_level` |
| レッスン単価 | 1レッスンあたりの単価 | `coaches.lesson_unit_price` |
| 入社日 | 経過月数の基準 | `coaches.hire_date` |
| 行動ルール | OK / WARNING / VIOLATION の判定 | `coach_behavior_statuses` |
| 昇格審査 | 昇格の可否 | `promotion_reviews` |
| 昇格要件の承認 | 要件を満たしたかの承認 | `promotion_requirement_checks` |
| 評価スナップショット | 確定済みの評価結果 | `evaluation_snapshots` |
| ユーザーのロール | ADMIN / COACH | `users.role` |

COACH が引き続きできること (業務上必要な入力・参照):

- 担当顧客の**成果記録の登録** (`performance_records` の INSERT)
- 自分名義の**売上の登録** (`sales` の INSERT。取消・返金は ADMIN のみ)
- 自分の**レッスン数の申告** (`monthly_lesson_counts`。単価は ADMIN 管理のため報酬の見込み表示にのみ効く)
- 自分の担当顧客・自分の売上・自分の評価の**参照**
- 評価ルール・商品の**参照** (画面表示と売上登録に必要)
- 自分宛の通知の既読化

参照できないもの: 他コーチのデータ、監査ログ。

---

## 2. 防御は3層

画面に出さないことは利便性のためであり、権限の担保ではない。
COACH はブラウザから自分のアクセストークンを取り出して、
PostgREST へ直接 HTTP を投げられるため、**UI を消しただけでは何の防御にもならない**。

### 層1: DB (`supabase/migrations/20260101000003_rls.sql`, `20260101000011_admin_only_settings.sql`)

1. **RLS ポリシー** … 設定系テーブルの書き込みは `app.is_admin()` のみ。
2. **拒否トリガ** … 上記8テーブルに `*_admin_only` トリガを付け、
   ADMIN とサーバー側実行以外の INSERT/UPDATE/DELETE を例外 (SQLSTATE 42501) で止める。

トリガを足している理由は2つ。

- ポリシーは**あとから1本足しただけで穴が空く**。トリガはポリシーと独立して効く。
- ポリシーだけだと、UPDATE の拒否が「HTTP 200 + 0件更新」という**無言の空振り**になる。
  トリガがあれば明示的なエラーになり、気づける。

サーバー側実行の判定は `app.is_service_context()` が行う。
PostgREST は JWT のロールに応じて `SET ROLE` するため、ブラウザ由来は必ず
`anon` か `authenticated` になる。それ以外 (`service_role` の月次締めジョブ、
マイグレーション、psql) を許可する。
**この判定のため、トリガ関数は `security definer` にしていない**
(`security definer` にすると `current_user` が関数の所有者になり、呼び出し元が分からなくなる)。

### 層2: Server Action (`src/server/authz.ts`)

管理系14アクションはすべて先頭で `requireAdminForAction()` を通す。

ページ用の `requireAdmin()` は `redirect()` を使うが、`redirect()` は例外として投げられるため、
**呼び出し側が `try/catch` で握りつぶすと素通りする**。書き込み処理では事故が致命的なので、
Server Action 用のガードは例外を使わず、拒否を戻り値として返す。

```ts
const guard = await requireAdminForAction();
if (!guard.ok) return guard.result;   // { ok: false, error: 'この操作は管理者のみ実行できます' }
```

### 層3: Route Handler

- `/api/export/[type]` … `requireAdminForRoute()` で 401 / 403 を返す
- `/api/cron/monthly-close` … 共有シークレット (`CRON_SECRET`) のみ。ログインセッションでは通らない

### 補助: UI

コーチ画面のナビは ホーム / 担当顧客 / 成果登録 / 売上登録 / 昇格 のみ。
設定への導線 (`/admin` へのリンク、設定変更のボタン) は1つも置かない。

---

## 3. 拒否テスト (恒久化済み)

| どこ | 何を確認するか | 実行方法 |
|---|---|---|
| `supabase/tests/rls_test.sql` | COACH として11種の設定変更を試み、全て拒否・値が変わらないこと。ADMIN と service_role は従来どおり書けること | `npm run db:local` |
| `src/server/actions/adminActions.authz.test.ts` | COACH のセッションで管理系14アクションが全て「管理者のみ」で拒否されること。**アクションを追加してガードを付け忘れると落ちる** | `npm test` |
| `scripts/verify-authz.ts` | COACH のアクセストークンで PostgREST を直接叩き、15種の書き込みが拒否され値が変わらないこと。アプリ層 (CSV出力・月次締め・ADMIN画面) も確認 | `npm run verify:authz` |
| `e2e/coach-settings-lockdown.spec.ts` | ブラウザ視点で、設定系ADMIN画面が開かず、コーチ画面に設定の操作が無いこと | `npm run e2e` |

テストが空振りしていないことも確認済み:
拒否トリガを1つ外して許可ポリシーを足すと、`rls_test.sql` は
`COACH が設定を変更できてしまった: インセンティブ額の変更 / 商品の新規登録` で落ちる。

### 本番での実地確認結果

```
npm run verify:authz                     … 39件すべて意図どおり
AUTHZ_APP_URL=<公開URL> で アプリ層も込み
```

- DB層 15件 … 全て拒否。うち INSERT 5件は **HTTP 403 で明示的に拒否**、
  UPDATE/DELETE 10件は RLS が対象行を隠して 0件更新
- 変更検知 8項目 … 拒否後に値が1つも変わっていないこと
- COACH の正常系 6件 … 参照は従来どおり通る / 監査ログは0件
- アプリ層 10件 … CSV出力 403 / 月次締め 401 / ADMIN画面6つが `/coach` へ退避

締めすぎていないことも本番で確認済み:

- ADMIN … 商品の登録・インセンティブ額の変更・削除、コーチのランクと単価の更新、評価ルールの更新 すべて可能
- service_role (月次締め) … 評価スナップショット・昇格審査・行動ルール すべて書き込み可能

いずれも検証用データは作成後に削除し、原状復帰済み。

---

## 4. 運用上の注意

- **管理系の Server Action を追加したら、必ず `requireAdminForAction()` を通すこと。**
  付け忘れると `adminActions.authz.test.ts` が落ちる (アクション数を突き合わせている)。
- **設定系テーブルを追加したら、migration 0011 の配列にテーブル名を足すこと。**
- レッスン数 (`monthly_lesson_counts`) はコーチ本人が申告できる唯一の数値。
  単価は ADMIN 管理のため制度上の Score・昇格判定には影響しないが、
  報酬の見込み表示には効く。承認制にしたい場合は ADMIN 限定へ移せる。
