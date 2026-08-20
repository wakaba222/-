-- ============================================================================
-- 権限付与
-- 実際のアクセス制御は RLS が行う。GRANT はテーブルに触れる余地を与えるだけで、
-- 行の可視性はポリシー側で決まる。
-- ============================================================================

grant usage on schema public to anon, authenticated, service_role;

-- 参照は RLS 前提で広く許可
grant select on all tables in schema public to authenticated;

-- 書き込みが必要なテーブルのみ個別に許可 (evaluation_snapshots はサービスロール優先だが
-- ADMIN の手動締めにも対応するため authenticated にも与える)
grant insert, update on public.users, public.coaches, public.customers, public.customer_goals,
  public.customer_coach_assignments, public.performance_records, public.products, public.sales,
  public.evaluation_rules, public.evaluation_snapshots, public.promotion_reviews,
  public.promotion_requirement_checks, public.coach_behavior_statuses,
  public.monthly_lesson_counts, public.notifications
  to authenticated;

grant delete on public.customer_goals, public.customer_coach_assignments,
  public.promotion_requirement_checks to authenticated;

grant all on all tables in schema public to service_role;
grant usage on schema app to authenticated, service_role;

-- 匿名ロールには一切与えない (ログイン前にデータへ到達させない)
revoke all on all tables in schema public from anon;
