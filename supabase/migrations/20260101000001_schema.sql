-- ============================================================================
-- EAGLE Coach Performance System — 基本スキーマ
--
-- 方針:
--   * 履歴を失う UPDATE をしない (目標・担当・成果・売上は全て履歴テーブル or 状態遷移で表現)
--   * 物理削除しない (deleted_at による soft delete)
--   * 評価基準は evaluation_rules に JSON で保持し、コード側に閾値を持たない
-- ============================================================================

create schema if not exists app;

-- ---------------------------------------------------------------------------
-- 列挙型
-- ---------------------------------------------------------------------------
create type user_role            as enum ('ADMIN', 'COACH');
create type professional_level   as enum ('P1', 'P2', 'P3', 'P4');
create type behavior_status      as enum ('OK', 'WARNING', 'NG');
create type goal_type            as enum ('SCORE', 'DISTANCE', 'BOTH');
create type goal_approval_status as enum ('DRAFT', 'PENDING', 'APPROVED', 'REJECTED');
create type customer_status      as enum ('ACTIVE', 'SUSPENDED', 'COMPLETED', 'CANCELLED');
create type cancel_reason_code   as enum ('SELF', 'PERFORMANCE', 'OTHER');
create type acquisition_source   as enum ('EXISTING', 'COACH_SNS', 'COMPANY', 'OTHER');
create type sale_status          as enum ('ACTIVE', 'CANCELLED', 'REFUNDED');
create type promotion_status     as enum ('NOT_ELIGIBLE', 'CANDIDATE', 'CANDIDATE_REQUIRES_APPROVAL', 'APPROVED', 'REJECTED');

-- ---------------------------------------------------------------------------
-- 共通トリガ関数
-- ---------------------------------------------------------------------------
create or replace function app.set_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- users / coaches
-- ---------------------------------------------------------------------------
create table public.users (
  id          uuid primary key references auth.users(id) on delete cascade,
  name        text not null,
  email       text not null,
  role        user_role not null default 'COACH',
  active      boolean not null default true,
  deleted_at  timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index users_email_unique on public.users (lower(email)) where deleted_at is null;

create table public.coaches (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null unique references public.users(id) on delete cascade,
  professional_level professional_level not null default 'P1',
  -- 単価はランクから導出できるが、個別契約に対応できるよう実額も保持する
  lesson_unit_price  integer not null default 0 check (lesson_unit_price >= 0),
  hire_date          date not null,
  left_on            date,
  deleted_at         timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create index coaches_active_idx on public.coaches (deleted_at, left_on);

-- ---------------------------------------------------------------------------
-- customers / goals / 担当履歴
-- ---------------------------------------------------------------------------
create table public.customers (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null,
  -- 現担当。履歴の真実は customer_coach_assignments 側 (仕様37章)
  current_coach_id     uuid references public.coaches(id),
  program_start_date   date not null,
  program_end_date     date not null,
  status               customer_status not null default 'ACTIVE',
  status_changed_on    date,
  cancel_reason_code   cancel_reason_code,
  -- 休会の累計日数。評価対象までの経過月数から差し引く
  suspended_days       integer not null default 0 check (suspended_days >= 0),
  start_score          numeric(5,1),
  target_score         numeric(5,1),
  start_distance       numeric(5,1),
  target_distance      numeric(5,1),
  goal_type            goal_type not null default 'SCORE',
  goal_approval_status goal_approval_status not null default 'DRAFT',
  goal_approved_by     uuid references public.users(id),
  goal_approved_at     timestamptz,
  latest_score         numeric(5,1),
  latest_distance      numeric(5,1),
  -- 完全達成のキャッシュ。真実は performance_records の履歴から導出できる
  complete_success     boolean not null default false,
  complete_success_at  date,
  note                 text,
  deleted_at           timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint customers_goal_required check (
    case goal_type
      when 'SCORE'    then target_score is not null
      when 'DISTANCE' then target_distance is not null
      when 'BOTH'     then target_score is not null and target_distance is not null
    end
  ),
  constraint customers_cancel_reason_required check (
    status <> 'CANCELLED' or cancel_reason_code is not null
  )
);
create index customers_coach_idx  on public.customers (current_coach_id) where deleted_at is null;
create index customers_status_idx on public.customers (status) where deleted_at is null;

-- 目標の履歴。達成判定は「その成果記録の日付時点で有効だった目標」に対して行う
create table public.customer_goals (
  id               uuid primary key default gen_random_uuid(),
  customer_id      uuid not null references public.customers(id) on delete cascade,
  goal_type        goal_type not null,
  start_score      numeric(5,1),
  target_score     numeric(5,1),
  start_distance   numeric(5,1),
  target_distance  numeric(5,1),
  approval_status  goal_approval_status not null default 'PENDING',
  approved_by      uuid references public.users(id),
  approved_at      timestamptz,
  effective_from   date not null,
  superseded_at    timestamptz,
  note             text,
  created_by       uuid references public.users(id),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index customer_goals_customer_idx on public.customer_goals (customer_id, effective_from desc);

create table public.customer_coach_assignments (
  id          uuid primary key default gen_random_uuid(),
  customer_id uuid not null references public.customers(id) on delete cascade,
  coach_id    uuid not null references public.coaches(id),
  start_date  date not null,
  end_date    date,
  reason      text,
  created_by  uuid references public.users(id),
  created_at  timestamptz not null default now()
);
create index cca_customer_idx on public.customer_coach_assignments (customer_id, start_date desc);
create index cca_coach_idx    on public.customer_coach_assignments (coach_id);
-- 1顧客につき現担当は1人
create unique index cca_single_current on public.customer_coach_assignments (customer_id) where end_date is null;

-- ---------------------------------------------------------------------------
-- performance_records (成果履歴。上書きしない)
-- ---------------------------------------------------------------------------
create table public.performance_records (
  id                   uuid primary key default gen_random_uuid(),
  customer_id          uuid not null references public.customers(id) on delete cascade,
  -- 成果達成日時点の担当コーチに帰属させる (仕様37章)
  coach_id             uuid references public.coaches(id),
  goal_id              uuid references public.customer_goals(id),
  recorded_on          date not null,
  score                numeric(5,1),
  distance             numeric(5,1),
  meets_score_goal     boolean not null default false,
  meets_distance_goal  boolean not null default false,
  is_complete_success  boolean not null default false,
  note                 text,
  created_by           uuid references public.users(id),
  deleted_at           timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint performance_records_value_required check (score is not null or distance is not null)
);
create index performance_records_customer_idx on public.performance_records (customer_id, recorded_on desc)
  where deleted_at is null;

-- ---------------------------------------------------------------------------
-- products / sales
-- ---------------------------------------------------------------------------
create table public.products (
  id                    uuid primary key default gen_random_uuid(),
  code                  text not null unique,
  name                  text not null,
  default_price         integer not null check (default_price >= 0),
  incentive_amount      integer not null default 0 check (incentive_amount >= 0),
  -- 売上点の評価対象に含めるか (仕様12章)
  is_sales_score_target boolean not null default true,
  active                boolean not null default true,
  sort_order            integer not null default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create table public.sales (
  id                 uuid primary key default gen_random_uuid(),
  -- 売上は担当者ではなく販売者に帰属する (仕様38章)
  coach_id           uuid not null references public.coaches(id),
  customer_id        uuid references public.customers(id),
  product_id         uuid not null references public.products(id),
  sold_on            date not null,
  amount             integer not null check (amount >= 0),
  -- 商品マスタの後日変更で過去の支給額が変わらないよう、成約時点の値をコピーする
  incentive_amount   integer not null default 0 check (incentive_amount >= 0),
  acquisition_source acquisition_source not null default 'EXISTING',
  status             sale_status not null default 'ACTIVE',
  refund_amount      integer not null default 0 check (refund_amount >= 0),
  status_changed_on  date,
  note               text,
  created_by         uuid references public.users(id),
  deleted_at         timestamptz,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint sales_refund_within_amount check (refund_amount <= amount)
);
create index sales_coach_month_idx on public.sales (coach_id, sold_on) where deleted_at is null;
create index sales_customer_idx    on public.sales (customer_id) where deleted_at is null;
-- 同日・同顧客・同商品・同額の重複登録を防ぐ (仕様36章)
create unique index sales_duplicate_guard on public.sales (coach_id, customer_id, product_id, sold_on, amount)
  where deleted_at is null and status = 'ACTIVE' and customer_id is not null;

-- ---------------------------------------------------------------------------
-- 評価ルール / スナップショット
-- ---------------------------------------------------------------------------
create table public.evaluation_rules (
  version        integer primary key,
  effective_from date not null,
  effective_to   date,
  rules          jsonb not null,
  note           text,
  created_by     uuid references public.users(id),
  created_at     timestamptz not null default now()
);

create table public.evaluation_snapshots (
  id                       uuid primary key default gen_random_uuid(),
  coach_id                 uuid not null references public.coaches(id) on delete cascade,
  year_month               text not null check (year_month ~ '^\d{4}-\d{2}$'),
  -- 返金・成果訂正で再計算が必要になったら revision を増やして追加する (上書きしない)
  revision                 integer not null default 1,
  is_evaluable             boolean not null default true,
  long_term_success_rate   numeric(5,4),
  long_term_target_count   integer not null default 0,
  long_term_achieved_count integer not null default 0,
  long_term_score          numeric(5,1),
  short_term_success_rate  numeric(5,4),
  short_term_target_count  integer not null default 0,
  short_term_achieved_count integer not null default 0,
  short_term_score         numeric(5,1),
  customer_success_score   numeric(5,1),
  sales_amount             bigint not null default 0,
  sales_score              numeric(5,1) not null default 0,
  professional_score       numeric(5,1),
  score_band               text,
  current_rank             professional_level not null,
  evaluation_rule_version  integer not null references public.evaluation_rules(version),
  calculated_at            timestamptz not null default now(),
  created_at               timestamptz not null default now()
);
create unique index evaluation_snapshots_unique on public.evaluation_snapshots (coach_id, year_month, revision);
create index evaluation_snapshots_month_idx on public.evaluation_snapshots (year_month);

-- 各月の最新 revision だけを見るためのビュー
-- security_invoker: ビュー越しでも呼び出し元のRLSが効くようにする
create view public.latest_evaluation_snapshots with (security_invoker = on) as
select distinct on (coach_id, year_month) *
from public.evaluation_snapshots
order by coach_id, year_month, revision desc;

-- ---------------------------------------------------------------------------
-- 昇格 / 行動ルール / レッスン数 / 通知
-- ---------------------------------------------------------------------------
create table public.promotion_reviews (
  id                     uuid primary key default gen_random_uuid(),
  coach_id               uuid not null references public.coaches(id) on delete cascade,
  year_month             text not null,
  from_level             professional_level not null,
  to_level               professional_level,
  status                 promotion_status not null default 'NOT_ELIGIBLE',
  three_month_avg_score  numeric(5,1),
  -- 条件ごとの達成状況をそのまま保存し、当時の判定根拠を再現できるようにする
  condition_results      jsonb not null default '[]'::jsonb,
  decided_by             uuid references public.users(id),
  decided_at             timestamptz,
  decision_note          text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
create unique index promotion_reviews_unique on public.promotion_reviews (coach_id, year_month);

create table public.promotion_requirement_checks (
  id             uuid primary key default gen_random_uuid(),
  coach_id       uuid not null references public.coaches(id) on delete cascade,
  requirement_code text not null,
  label          text not null,
  achieved_count integer not null default 0 check (achieved_count >= 0),
  note           text,
  approved_by    uuid references public.users(id),
  approved_at    timestamptz,
  updated_at     timestamptz not null default now()
);
create unique index prc_unique on public.promotion_requirement_checks (coach_id, requirement_code);

create table public.coach_behavior_statuses (
  id         uuid primary key default gen_random_uuid(),
  coach_id   uuid not null references public.coaches(id) on delete cascade,
  year_month text not null,
  status     behavior_status not null default 'OK',
  note       text,
  set_by     uuid references public.users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index cbs_unique on public.coach_behavior_statuses (coach_id, year_month);

create table public.monthly_lesson_counts (
  id           uuid primary key default gen_random_uuid(),
  coach_id     uuid not null references public.coaches(id) on delete cascade,
  year_month   text not null,
  lesson_count integer not null default 0 check (lesson_count >= 0),
  updated_at   timestamptz not null default now()
);
create unique index mlc_unique on public.monthly_lesson_counts (coach_id, year_month);

create table public.notifications (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users(id) on delete cascade,
  type       text not null,
  title      text not null,
  body       text,
  link_url   text,
  -- 同じ通知を何度も出さないためのキー (例: 'ELIGIBLE:<customer_id>:2026-05')
  dedupe_key text not null,
  read_at    timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on public.notifications (user_id, created_at desc);
create unique index notifications_dedupe on public.notifications (user_id, dedupe_key);

-- ---------------------------------------------------------------------------
-- 監査ログ
-- ---------------------------------------------------------------------------
create table public.audit_logs (
  id            uuid primary key default gen_random_uuid(),
  actor_user_id uuid references public.users(id),
  entity_table  text not null,
  entity_id     uuid,
  action        text not null,
  before        jsonb,
  after         jsonb,
  reason        text,
  created_at    timestamptz not null default now()
);
create index audit_logs_entity_idx on public.audit_logs (entity_table, entity_id, created_at desc);

-- ---------------------------------------------------------------------------
-- updated_at 自動更新
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'users','coaches','customers','customer_goals','performance_records','products','sales',
    'promotion_reviews','promotion_requirement_checks','coach_behavior_statuses','monthly_lesson_counts'
  ] loop
    execute format(
      'create trigger %I_set_updated_at before update on public.%I for each row execute function app.set_updated_at()',
      t, t);
  end loop;
end $$;
