-- ============================================================================
-- Row Level Security (仕様31章)
--
-- 権限はフロント制御ではなくDB側で保証する。
-- COACH は自分の担当顧客・自分の売上・自分の評価のみ、ADMIN は全件。
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 権限判定ヘルパー
-- ポリシー内から public.users を参照すると RLS が再帰するため、
-- security definer 関数に切り出して参照を1箇所に閉じ込める。
-- ---------------------------------------------------------------------------
create or replace function app.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.users
    where id = auth.uid() and role = 'ADMIN' and active and deleted_at is null
  )
$$;

create or replace function app.current_coach_id() returns uuid
language sql stable security definer set search_path = public as $$
  select c.id from public.coaches c
  where c.user_id = auth.uid() and c.deleted_at is null
  limit 1
$$;

-- 担当履歴も含めて「自分が見てよい顧客か」を判定する。
-- 担当変更後も過去の担当分の成果を参照できるようにするため。
create or replace function app.can_access_customer(p_customer_id uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select app.is_admin() or exists (
    select 1 from public.customer_coach_assignments a
    where a.customer_id = p_customer_id and a.coach_id = app.current_coach_id()
  ) or exists (
    select 1 from public.customers c
    where c.id = p_customer_id and c.current_coach_id = app.current_coach_id()
  )
$$;

grant usage on schema app to authenticated;

-- ---------------------------------------------------------------------------
-- 全テーブルで RLS 有効化 (既定は全拒否)
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'users','coaches','customers','customer_goals','customer_coach_assignments',
    'performance_records','products','sales','evaluation_rules','evaluation_snapshots',
    'promotion_reviews','promotion_requirement_checks','coach_behavior_statuses',
    'monthly_lesson_counts','notifications','audit_logs'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- users: 本人 + ADMIN
-- ---------------------------------------------------------------------------
create policy users_select on public.users for select to authenticated
  using (id = auth.uid() or app.is_admin());
create policy users_admin_write on public.users for all to authenticated
  using (app.is_admin()) with check (app.is_admin());

-- ---------------------------------------------------------------------------
-- coaches: 本人 + ADMIN (他コーチの単価・ランクは見えない)
-- ---------------------------------------------------------------------------
create policy coaches_select on public.coaches for select to authenticated
  using (user_id = auth.uid() or app.is_admin());
create policy coaches_admin_write on public.coaches for all to authenticated
  using (app.is_admin()) with check (app.is_admin());

-- ---------------------------------------------------------------------------
-- customers: 担当コーチ (履歴含む) + ADMIN。作成・担当変更は ADMIN のみ
-- ---------------------------------------------------------------------------
create policy customers_select on public.customers for select to authenticated
  using (app.can_access_customer(id));
create policy customers_admin_write on public.customers for all to authenticated
  using (app.is_admin()) with check (app.is_admin());
-- コーチは担当顧客の目標案・メモなど限られた項目のみ更新できる (列制限はアプリ側で担保)
create policy customers_coach_update on public.customers for update to authenticated
  using (current_coach_id = app.current_coach_id())
  with check (current_coach_id = app.current_coach_id());

-- ---------------------------------------------------------------------------
-- customer_goals: 担当コーチは参照・起案、承認は ADMIN のみ
-- ---------------------------------------------------------------------------
create policy customer_goals_select on public.customer_goals for select to authenticated
  using (app.can_access_customer(customer_id));
create policy customer_goals_coach_insert on public.customer_goals for insert to authenticated
  with check (app.can_access_customer(customer_id) and approval_status in ('DRAFT','PENDING'));
create policy customer_goals_admin_write on public.customer_goals for all to authenticated
  using (app.is_admin()) with check (app.is_admin());

-- ---------------------------------------------------------------------------
-- customer_coach_assignments: 参照は関係者、変更は ADMIN のみ
-- ---------------------------------------------------------------------------
create policy cca_select on public.customer_coach_assignments for select to authenticated
  using (coach_id = app.current_coach_id() or app.is_admin());
create policy cca_admin_write on public.customer_coach_assignments for all to authenticated
  using (app.is_admin()) with check (app.is_admin());

-- ---------------------------------------------------------------------------
-- performance_records: 担当顧客のみ。訂正・削除は ADMIN のみ (履歴保全)
-- ---------------------------------------------------------------------------
create policy performance_records_select on public.performance_records for select to authenticated
  using (app.can_access_customer(customer_id));
create policy performance_records_coach_insert on public.performance_records for insert to authenticated
  with check (app.can_access_customer(customer_id));
create policy performance_records_admin_write on public.performance_records for all to authenticated
  using (app.is_admin()) with check (app.is_admin());

-- ---------------------------------------------------------------------------
-- products: 全員参照 (登録画面で必要)、変更は ADMIN のみ
-- ---------------------------------------------------------------------------
create policy products_select on public.products for select to authenticated using (true);
create policy products_admin_write on public.products for all to authenticated
  using (app.is_admin()) with check (app.is_admin());

-- ---------------------------------------------------------------------------
-- sales: 自分の売上のみ。他コーチの売上は行ごと不可視
-- ---------------------------------------------------------------------------
create policy sales_select on public.sales for select to authenticated
  using (coach_id = app.current_coach_id() or app.is_admin());
create policy sales_coach_insert on public.sales for insert to authenticated
  with check (coach_id = app.current_coach_id());
-- 取消・返金は ADMIN のみ (コーチが自分で売上を消せないようにする)
create policy sales_admin_write on public.sales for all to authenticated
  using (app.is_admin()) with check (app.is_admin());

-- ---------------------------------------------------------------------------
-- evaluation_rules: 全員参照 (画面表示に必要)、変更は ADMIN のみ
-- ---------------------------------------------------------------------------
create policy evaluation_rules_select on public.evaluation_rules for select to authenticated using (true);
create policy evaluation_rules_admin_write on public.evaluation_rules for all to authenticated
  using (app.is_admin()) with check (app.is_admin());

-- ---------------------------------------------------------------------------
-- evaluation_snapshots: 自分の評価のみ。書き込みはサービスロール (月次締め) のみ
-- ---------------------------------------------------------------------------
create policy evaluation_snapshots_select on public.evaluation_snapshots for select to authenticated
  using (coach_id = app.current_coach_id() or app.is_admin());
create policy evaluation_snapshots_admin_write on public.evaluation_snapshots for all to authenticated
  using (app.is_admin()) with check (app.is_admin());

-- ---------------------------------------------------------------------------
-- 昇格・行動ルール・レッスン数
-- ---------------------------------------------------------------------------
create policy promotion_reviews_select on public.promotion_reviews for select to authenticated
  using (coach_id = app.current_coach_id() or app.is_admin());
create policy promotion_reviews_admin_write on public.promotion_reviews for all to authenticated
  using (app.is_admin()) with check (app.is_admin());

create policy prc_select on public.promotion_requirement_checks for select to authenticated
  using (coach_id = app.current_coach_id() or app.is_admin());
create policy prc_admin_write on public.promotion_requirement_checks for all to authenticated
  using (app.is_admin()) with check (app.is_admin());

create policy cbs_select on public.coach_behavior_statuses for select to authenticated
  using (coach_id = app.current_coach_id() or app.is_admin());
create policy cbs_admin_write on public.coach_behavior_statuses for all to authenticated
  using (app.is_admin()) with check (app.is_admin());

create policy mlc_select on public.monthly_lesson_counts for select to authenticated
  using (coach_id = app.current_coach_id() or app.is_admin());
create policy mlc_coach_write on public.monthly_lesson_counts for all to authenticated
  using (coach_id = app.current_coach_id() or app.is_admin())
  with check (coach_id = app.current_coach_id() or app.is_admin());

-- ---------------------------------------------------------------------------
-- notifications: 本人のみ (既読更新も本人)
-- ---------------------------------------------------------------------------
create policy notifications_select on public.notifications for select to authenticated
  using (user_id = auth.uid());
create policy notifications_update on public.notifications for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- audit_logs: ADMIN のみ参照。書き込みはトリガ (security definer) 経由のみ
-- ---------------------------------------------------------------------------
create policy audit_logs_select on public.audit_logs for select to authenticated
  using (app.is_admin());
