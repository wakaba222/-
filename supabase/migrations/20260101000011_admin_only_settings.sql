-- ============================================================================
-- 設定系テーブルは ADMIN (とサーバー側ジョブ) 以外書き込めない、をDBで確定させる
--
-- 既に RLS のポリシーで ADMIN 限定になっているが、ポリシーだけに頼ると
--   ・あとから誤って許可ポリシーを1本足しただけで穴が空く
--   ・拒否が「HTTP 200 + 0件更新」という無言の空振りになり、気づけない
-- という弱さがある。
--
-- そこで、行の可視性 (RLS) とは別に、トリガで書き込み自体を明示的に拒否する。
-- ポリシーが増えても、このトリガを外さない限り COACH は設定を変えられない。
-- 拒否は例外 (SQLSTATE 42501) として返るため、無言の空振りにならない。
-- ============================================================================

-- ---------------------------------------------------------------------------
-- サーバー側の実行かどうか。
--
-- PostgREST は JWT のロールに応じて SET ROLE する。
-- ブラウザから来た操作は必ず anon か authenticated のどちらかになる。
-- それ以外 (service_role の月次締めジョブ、マイグレーション、psql) は
-- サーバー側の実行として許可する。
--
-- この関数と下のトリガ関数は security definer にしない。
-- security definer にすると current_user が関数の所有者になり、
-- 呼び出し元のロールが判定できなくなるため。
-- ---------------------------------------------------------------------------
create or replace function app.is_service_context() returns boolean
language sql stable as $$
  select current_user not in ('anon', 'authenticated')
$$;

-- ---------------------------------------------------------------------------
-- 設定系テーブルへの書き込みを ADMIN 以外拒否する
-- ---------------------------------------------------------------------------
create or replace function app.deny_non_admin_write() returns trigger
language plpgsql set search_path = public, app as $$
begin
  if app.is_service_context() or app.is_admin() then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  raise exception '% の変更は管理者のみ行えます', tg_table_name
    using errcode = '42501',
          hint = 'この操作は管理画面から管理者が行ってください';
end;
$$;

-- ---------------------------------------------------------------------------
-- 対象テーブル
--   users                        ロール昇格 (COACH → ADMIN) の防止
--   coaches                      ランク・レッスン単価・入社日
--   products                     商品価格・インセンティブ額・Score対象フラグ
--   evaluation_rules             Score配点・昇格条件・報酬設定
--   evaluation_snapshots         確定済みの評価結果
--   promotion_reviews            昇格審査の結果
--   promotion_requirement_checks 昇格要件の承認
--   coach_behavior_statuses      行動ルールの判定
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'users','coaches','products','evaluation_rules','evaluation_snapshots',
    'promotion_reviews','promotion_requirement_checks','coach_behavior_statuses'
  ] loop
    execute format('drop trigger if exists %I on public.%I', t || '_admin_only', t);
    execute format(
      'create trigger %I before insert or update or delete on public.%I '
      || 'for each row execute function app.deny_non_admin_write()',
      t || '_admin_only', t);
  end loop;
end $$;
