-- ============================================================================
-- 監査ログ (仕様32章)
--
-- アプリ経由の記録漏れを防ぐため、記録はトリガでDB側から強制する。
-- 誰が・いつ・何を・変更前→変更後 を残す。
-- ============================================================================

create or replace function app.current_actor_id() returns uuid
language sql stable as $$
  select auth.uid()
$$;

create or replace function app.write_audit_log() returns trigger
language plpgsql security definer set search_path = public, app as $$
declare
  v_entity_id uuid;
  v_before jsonb;
  v_after jsonb;
begin
  if tg_op = 'DELETE' then
    v_before := to_jsonb(old);
  elsif tg_op = 'INSERT' then
    v_after := to_jsonb(new);
  else
    v_before := to_jsonb(old);
    v_after := to_jsonb(new);
    -- 実質的な変更がない UPDATE はログを汚すだけなので記録しない
    if v_before - 'updated_at' = v_after - 'updated_at' then
      return new;
    end if;
  end if;

  -- evaluation_rules のように id 列を持たないテーブルもあるため jsonb 経由で取得する
  v_entity_id := nullif(coalesce(v_after, v_before)->>'id', '')::uuid;

  insert into public.audit_logs (actor_user_id, entity_table, entity_id, action, before, after)
  values (app.current_actor_id(), tg_table_name, v_entity_id, tg_op, v_before, v_after);

  return coalesce(new, old);
end;
$$;

-- 重要操作を行うテーブルにのみ付与する (通知やスナップショットは対象外)
do $$
declare t text;
begin
  foreach t in array array[
    'customers','customer_goals','customer_coach_assignments','performance_records',
    'sales','products','evaluation_rules','coaches','promotion_reviews',
    'promotion_requirement_checks','coach_behavior_statuses'
  ] loop
    execute format(
      'create trigger %I_audit after insert or update or delete on public.%I for each row execute function app.write_audit_log()',
      t, t);
  end loop;
end $$;
