# 02. 推奨アーキテクチャ

## 1. 技術スタック (仕様書30章を採用、変更点は理由付き)

| 領域 | 採用 | 備考 |
|---|---|---|
| Framework | **Next.js 15 (App Router) / React 19** | Server Components + Server Actions。API層を薄くできる |
| 言語 | **TypeScript strict** | `any` 禁止 / `noUncheckedIndexedAccess` 有効 |
| UI | **Tailwind CSS v4 + shadcn/ui** | 白ベース + ダークグリーン + ゴールドをテーマトークン化 |
| DB / Auth | **Supabase (PostgreSQL + Auth + RLS)** | 権限はDB側で保証 |
| Validation | **Zod** | フォーム / Server Action / 環境変数 の3層で共通スキーマ |
| Form | **React Hook Form** | + `@hookform/resolvers/zod` |
| Charts | **Recharts** | MVPでは最小限 (Score推移 / 売上推移のみ) |
| Test | **Vitest** (unit) / **Playwright** (E2E・任意) | 評価ロジックは純粋関数なのでDB不要で全網羅テスト |
| Migration | **Supabase CLI (SQLマイグレーション)** | `supabase/migrations/*.sql` をGit管理 |
| Deploy | **Vercel** + Vercel Cron (月次締めジョブ) | |

**変更提案は1点のみ**: ORM(Prisma/Drizzle)は導入しない。
RLSを効かせるには「ユーザーのJWTでDBに接続する」必要があり、Supabase JS クライアント経由が最も安全かつ単純。
型は `supabase gen types typescript` で生成し、DB定義を単一の真実とする。

---

## 2. レイヤ構成 (ビジネスロジックとUIの完全分離)

```
src/
├── app/                        # Next.js ルーティング (UIのみ。計算は一切書かない)
│   ├── (auth)/login/
│   ├── (coach)/coach/...       # コーチ用。スマホ最適化最優先
│   ├── (admin)/admin/...       # ADMIN用。PC最適化 (一覧性優先)
│   └── api/cron/monthly-close/ # Vercel Cron エンドポイント
│
├── domain/                     # ★純粋関数のみ。I/O・Date.now()・環境依存 一切なし★
│   ├── evaluation/
│   │   ├── interpolate.ts      # 折れ線アンカー補間器 (全配点の共通基盤)
│   │   ├── eligibility.ts      # 評価対象判定 (4ヶ月ルール・休会・解約)
│   │   ├── customerSuccess.ts  # 長期/短期 成果率 → 点数
│   │   ├── sales.ts            # 売上額 → 点数 (SNS除外・返金相殺)
│   │   ├── professionalScore.ts# 合成 + 区分判定
│   │   ├── bonus.ts            # 四半期ボーナス
│   │   └── promotion.ts        # 昇格条件判定 (条件ごとの達成/未達を返す)
│   └── types.ts                # ドメイン型 (DB型とは分離)
│
├── server/                     # I/O層 (DBアクセス・Server Actions)
│   ├── repositories/           # 「DB行 → ドメイン入力」への変換のみ
│   ├── services/               # ユースケース (成果登録・売上登録・月次締め)
│   └── actions/                # Server Actions (Zod検証 → service呼び出し)
│
├── components/                 # 表示専用コンポーネント
└── lib/                        # supabase client / date(JST) utils / format
```

### 設計上の要 (ここが一番重要)
`domain/evaluation/*` は **DBもHTTPも時刻も知らない純粋関数**。
入力は `EvaluationInput` (顧客配列・売上配列・ルール・asOf) のみ、出力は `EvaluationResult` のみ。

```ts
// 全ての評価はこの1本の関数を通る
export function evaluateCoachMonth(input: EvaluationInput): EvaluationResult
```

これにより:
- 仕様書35章の必須テストケース13件を **DBなしで全て自動テスト可能**
- ダッシュボードの「リアルタイム表示」と「月次スナップショット」が **必ず同じ計算式** になる
- 制度変更 = ルールJSONの差し替えのみ。関数は変更不要

---

## 3. 評価の実行タイミング (2系統)

| 系統 | いつ | 何をする | 保存先 |
|---|---|---|---|
| **リアルタイム算出** | ダッシュボード表示時 | 現時点の速報値を都度計算 | 保存しない (キャッシュのみ) |
| **月次確定** | 毎月1日 05:00 JST (Cron) + ADMIN手動締め | 前月分を確定し保存 | `evaluation_snapshots` |

- スナップショットは `(coach_id, year_month, revision)` で保持。**上書きしない**。
  返金・成果修正で再計算が必要になったら `revision + 1` を新規追加し、旧revisionは監査用に残す。
- スナップショットには **必ず `evaluation_rule_version` を記録**。制度変更後も過去は当時のルールで再現可能。
- 昇格判定・ボーナス算定は **確定済みスナップショットのみ** を参照 (速報値では判定しない)。

---

## 4. セキュリティ方針

1. **RLSを全テーブルで有効化**。匿名ロールのアクセスは全拒否。
2. 権限判定用のヘルパー関数をDBに定義 (`auth.is_admin()`, `auth.coach_id()`)。
   `SECURITY DEFINER` + 検索パス固定で再帰RLSを回避。
3. COACH は「自分が担当中 or 過去に担当した顧客」のみ SELECT 可。
   他コーチの `sales` / `evaluation_snapshots` / `coaches.lesson_unit_price` は **行ごと不可視**。
4. 書き込みは原則 **Server Action 経由**。ただしRLSでも同じ制約を二重にかける (フロント制御に依存しない)。
5. `evaluation_rules` / `products` / `promotion_reviews` の書き込みは **ADMINのみ** (RLS + アプリ両方)。
6. **soft delete** (`deleted_at`)。物理削除はしない。
7. **監査ログはDBトリガで強制**。アプリ経由を忘れても記録が漏れない設計にする。

## 5. 監査ログ (仕様32章)

`audit_logs (actor_user_id, entity_table, entity_id, action, before jsonb, after jsonb, reason, created_at)`

対象: 顧客目標変更 / 担当変更 / 成果変更 / 完全達成変更 / 売上変更・取消 / 評価ルール変更 / ランク変更 / 昇格承認。
PostgreSQL トリガ (`AFTER INSERT OR UPDATE OR DELETE`) で自動記録し、
`current_setting('request.jwt.claims')` から実行者を取得する。
