# 03. ER図 / 主要テーブル設計

## 1. ER図

```mermaid
erDiagram
    users ||--o| coaches : "1:0..1"
    coaches ||--o{ customers : "現担当"
    coaches ||--o{ customer_coach_assignments : "担当履歴"
    customers ||--o{ customer_coach_assignments : ""
    customers ||--o{ customer_goals : "目標(履歴)"
    customers ||--o{ performance_records : "成果履歴"
    customers ||--o{ sales : ""
    coaches ||--o{ sales : "売上帰属"
    products ||--o{ sales : ""
    coaches ||--o{ evaluation_snapshots : "月次確定"
    evaluation_rules ||--o{ evaluation_snapshots : "適用version"
    coaches ||--o{ promotion_reviews : "昇格判定"
    promotion_reviews ||--o{ promotion_requirement_checks : "条件別結果"
    coaches ||--o{ coach_behavior_statuses : "行動ルール履歴"
    coaches ||--o{ monthly_lesson_counts : "レッスン数"
    coaches ||--o{ notifications : ""
    users ||--o{ audit_logs : "実行者"

    users {
        uuid id PK "auth.users.id と同一"
        text name
        citext email UK
        text role "ADMIN | COACH"
        bool active
        timestamptz deleted_at
    }
    coaches {
        uuid id PK
        uuid user_id FK UK
        text professional_level "P1|P2|P3|P4"
        int lesson_unit_price "P2:10000 P3:12000 P4:15000"
        date hire_date
        date left_at "退職"
    }
    customers {
        uuid id PK
        text name
        uuid current_coach_id FK "参照用の非正規化"
        date program_start_date
        date program_end_date "既定: 開始+6ヶ月"
        text status "ACTIVE|SUSPENDED|COMPLETED|CANCELLED"
        date status_changed_at
        text cancel_reason_code "SELF|PERFORMANCE|OTHER"
        numeric start_score
        numeric target_score
        numeric start_distance
        numeric target_distance
        text goal_type "SCORE|DISTANCE|BOTH"
        text goal_approval_status "DRAFT|PENDING|APPROVED|REJECTED"
        bool complete_success
        timestamptz complete_success_at
        uuid complete_success_record_id FK
    }
    customer_goals {
        uuid id PK
        uuid customer_id FK
        text goal_type
        numeric start_score
        numeric target_score
        numeric start_distance
        numeric target_distance
        text approval_status
        uuid approved_by FK
        timestamptz approved_at
        timestamptz effective_from
        timestamptz superseded_at "履歴保持"
    }
    customer_coach_assignments {
        uuid id PK
        uuid customer_id FK
        uuid coach_id FK
        date start_date
        date end_date "NULL=現担当"
        text reason
    }
    performance_records {
        uuid id PK
        uuid customer_id FK
        uuid coach_id FK "記録時点の担当"
        date recorded_on "過去日付登録可"
        numeric score
        numeric distance
        bool meets_score_goal "算出結果を保存"
        bool meets_distance_goal
        bool is_complete_success "この記録で完全達成したか"
        text note
        uuid created_by FK
        timestamptz deleted_at
    }
    products {
        uuid id PK
        text code UK
        text name
        numeric default_price
        numeric incentive_amount
        bool is_sales_score_target "評価対象/対象外"
        bool active
        int sort_order
    }
    sales {
        uuid id PK
        uuid coach_id FK "売上帰属コーチ"
        uuid customer_id FK "NULL可(イベント等)"
        uuid product_id FK
        date sold_on
        numeric amount
        numeric incentive_amount "成約時点の値を固定保存"
        text acquisition_source "EXISTING|COACH_SNS|COMPANY|OTHER"
        text status "ACTIVE|CANCELLED|REFUNDED"
        numeric refund_amount
        date status_changed_on
        text note
        timestamptz deleted_at
    }
    evaluation_rules {
        int version PK
        date effective_from
        date effective_to
        jsonb rules "全閾値・配点・昇格基準"
        text note
        uuid created_by FK
    }
    evaluation_snapshots {
        uuid id PK
        uuid coach_id FK
        text year_month "YYYY-MM"
        int revision "再計算のたびに+1"
        numeric long_term_success_rate "null許容=N/A"
        int long_term_target_count
        int long_term_achieved_count
        numeric long_term_score
        numeric short_term_success_rate
        int short_term_target_count
        int short_term_achieved_count
        numeric short_term_score
        numeric customer_success_score
        numeric sales_amount
        numeric sales_score
        numeric professional_score
        text score_band
        text current_rank
        int evaluation_rule_version FK
        bool is_evaluable "N/Aフラグ"
        timestamptz calculated_at
    }
    promotion_reviews {
        uuid id PK
        uuid coach_id FK
        text year_month
        text from_rank
        text to_rank
        text status "NOT_ELIGIBLE|CANDIDATE|APPROVED|REJECTED"
        numeric three_month_avg_score
        jsonb condition_results "条件ごとの達成状況"
        uuid decided_by FK
        timestamptz decided_at
        text decision_note
    }
    promotion_requirement_checks {
        uuid id PK
        uuid promotion_review_id FK
        text requirement_code "SENIOR_ACTIVITY|OWN_BUSINESS_RESULT..."
        int required_count
        int achieved_count
        bool approved
        uuid approved_by FK
    }
    coach_behavior_statuses {
        uuid id PK
        uuid coach_id FK
        text year_month
        text status "OK|WARNING|NG"
        text note
        uuid set_by FK
    }
    monthly_lesson_counts {
        uuid id PK
        uuid coach_id FK
        text year_month
        int lesson_count
    }
    notifications {
        uuid id PK
        uuid user_id FK
        text type
        text title
        text body
        text link_url
        timestamptz read_at
    }
    audit_logs {
        uuid id PK
        uuid actor_user_id FK
        text entity_table
        uuid entity_id
        text action "INSERT|UPDATE|DELETE"
        jsonb before
        jsonb after
        text reason
        timestamptz created_at
    }
```

---

## 2. 設計上の重要ポイント

### 2-1. `performance_records` は履歴。絶対に上書きしない (仕様29章)
最新値は `customers` 側のキャッシュ列 (`complete_success`) ではなく **常に履歴から導出**できるようにする。
`customers.complete_success` は「一覧の高速表示用の非正規化」であり、真実は `performance_records`。
成果の修正は UPDATE ではなく **訂正レコード + `deleted_at`** で表現し、監査ログに残す。

### 2-2. 「6ヶ月終了後の達成」を素直に扱える構造 (仕様9章)
`performance_records.recorded_on` は **契約終了日より後でも登録可能**。
評価対象判定は「プログラム期間中か」ではなく **「開始から4ヶ月以上経過しているか」** のみで行うため、
8月に100切りを達成すれば、その月のスナップショットから完全達成人数に加算される。
これが「未達を永久固定にしない」の実装上の担保。

### 2-3. 目標変更に耐える `customer_goals` の履歴化
目標は途中変更されうる。変更のたびに新レコードを作り、旧レコードに `superseded_at` を入れる。
**達成判定は「その成果記録の日付時点で有効だった目標」** に対して行う。
(過去の達成が、後の目標変更で覆らないようにするため)

### 2-4. 売上の取消・返金 (仕様36章)
`sales` は削除しない。`status` を `CANCELLED` / `REFUNDED` に変え、
**売上計上は「元の成約月」から差し引く** (= 元月のスナップショットを `revision+1` で再計算)。
`incentive_amount` は成約時点の商品マスタ値をコピー保存する
(後で商品マスタのインセン額を変えても、過去の支給額が変わらないようにするため)。

### 2-5. SNS経由売上 (仕様14章)
`acquisition_source = 'COACH_SNS'` で記録し、
`evaluation_rules.rules.sales.include_coach_sns = false` (MVP既定) により **売上点から除外**。
ただしダッシュボードには「SNS経由売上」として別枠で必ず表示する (将来のインセン実装の布石)。

### 2-6. 一意制約 / 重複防止 (仕様36章「同じ顧客の重複売上」)
`sales` に `(coach_id, customer_id, product_id, sold_on, amount)` の
**部分ユニークインデックス (status='ACTIVE' かつ deleted_at IS NULL)** を張り、
UI側でも登録前に「同日・同商品・同顧客の売上が既にあります」と警告する (強制ブロックはしない)。
