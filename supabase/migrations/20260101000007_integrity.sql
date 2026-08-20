-- ============================================================================
-- データ整合性の DB 側での担保
--
-- COACH はブラウザから anon キーで PostgREST に直接アクセスできるため、
-- 「アプリ経由なら正しい値が入る」だけでは不十分。
-- 評価に直結する列 (完全達成フラグ・インセンティブ額・達成日) は
-- クライアントの申告を信用せず、DB 側で必ず導出する。
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 完全達成の判定 (スコアは小さいほど良い / 飛距離は大きいほど良い)
-- TypeScript 側の judgeCompleteSuccess と同じ規則。
-- 画面の即時プレビューは TS 側、保存される値は必ずこちらが決める。
-- ---------------------------------------------------------------------------
create or replace function app.judge_complete_success(
  p_score          numeric,
  p_distance       numeric,
  p_goal_type      goal_type,
  p_target_score   numeric,
  p_target_distance numeric,
  p_both_rule      text
) returns boolean
language sql immutable as $$
  select case p_goal_type
    when 'SCORE'    then p_score is not null and p_target_score is not null and p_score <= p_target_score
    when 'DISTANCE' then p_distance is not null and p_target_distance is not null and p_distance >= p_target_distance
    when 'BOTH'     then case when coalesce(p_both_rule, 'ALL') = 'ANY'
      then (p_score is not null and p_target_score is not null and p_score <= p_target_score)
        or (p_distance is not null and p_target_distance is not null and p_distance >= p_target_distance)
      else (p_score is not null and p_target_score is not null and p_score <= p_target_score)
       and (p_distance is not null and p_target_distance is not null and p_distance >= p_target_distance)
    end
  end
$$;

/**
 * 成果記録の達成フラグをサーバー側で確定する。
 * 判定は「記録日時点で有効だった目標」に対して行うため、
 * 後から目標を変更しても過去の達成が覆らない。
 */
create or replace function app.set_performance_judgement() returns trigger
language plpgsql security definer set search_path = public, app as $$
declare
  v_goal        record;
  v_both_rule   text;
begin
  select g.id as id, g.goal_type as goal_type,
         g.target_score as target_score, g.target_distance as target_distance
    into v_goal
    from public.customer_goals g
   where g.customer_id = new.customer_id
     and g.effective_from <= new.recorded_on
   order by g.effective_from desc
   limit 1;

  if v_goal.id is null then
    select null::uuid as id, c.goal_type as goal_type,
           c.target_score as target_score, c.target_distance as target_distance
      into v_goal
      from public.customers c
     where c.id = new.customer_id;
  end if;

  select r.rules #>> '{customerSuccess,bothGoalRule}'
    into v_both_rule
    from public.evaluation_rules r
   where r.effective_from <= new.recorded_on
   order by r.version desc
   limit 1;

  new.goal_id := coalesce(new.goal_id, v_goal.id);
  new.meets_score_goal :=
    new.score is not null and v_goal.target_score is not null and new.score <= v_goal.target_score;
  new.meets_distance_goal :=
    new.distance is not null and v_goal.target_distance is not null and new.distance >= v_goal.target_distance;
  new.is_complete_success := coalesce(
    app.judge_complete_success(new.score, new.distance, v_goal.goal_type,
                               v_goal.target_score, v_goal.target_distance, v_both_rule),
    false);

  return new;
end;
$$;

create trigger performance_records_judge
  before insert or update of score, distance, recorded_on on public.performance_records
  for each row execute function app.set_performance_judgement();

-- ---------------------------------------------------------------------------
-- インセンティブ額は商品マスタの成約時点の値で固定する。
-- コーチが任意の金額を申告できないようにするため、INSERT 時に必ず上書きする。
-- ---------------------------------------------------------------------------
create or replace function app.set_sale_incentive() returns trigger
language plpgsql security definer set search_path = public, app as $$
begin
  select p.incentive_amount into new.incentive_amount
    from public.products p where p.id = new.product_id;
  -- 登録直後の売上は必ず有効・返金なしから始める (取消/返金は ADMIN の更新操作)
  new.status := 'ACTIVE';
  new.refund_amount := 0;
  return new;
end;
$$;

create trigger sales_set_incentive
  before insert on public.sales
  for each row execute function app.set_sale_incentive();

-- ---------------------------------------------------------------------------
-- 顧客側のキャッシュ列を成果履歴から再計算する。
--
-- COACH に customers の UPDATE 権限を与えると完全達成フラグを直接書けてしまうため、
-- 更新経路をこの関数だけに限定する (security definer)。
-- 達成日は「達成した記録のうち最も古い日付」= ラチェット方式。
-- ---------------------------------------------------------------------------
create or replace function public.refresh_customer_achievement(p_customer_id uuid) returns void
language plpgsql security definer set search_path = public, app as $$
declare
  v_latest      record;
  v_achievement record;
begin
  if not app.can_access_customer(p_customer_id) then
    raise exception 'この顧客を更新する権限がありません' using errcode = '42501';
  end if;

  select r.score, r.distance into v_latest
    from public.performance_records r
   where r.customer_id = p_customer_id and r.deleted_at is null
   order by r.recorded_on desc, r.created_at desc
   limit 1;

  select r.recorded_on into v_achievement
    from public.performance_records r
   where r.customer_id = p_customer_id and r.deleted_at is null and r.is_complete_success
   order by r.recorded_on asc
   limit 1;

  update public.customers
     set latest_score        = v_latest.score,
         latest_distance     = v_latest.distance,
         complete_success    = v_achievement.recorded_on is not null,
         complete_success_at = v_achievement.recorded_on
   where id = p_customer_id;
end;
$$;

grant execute on function public.refresh_customer_achievement(uuid) to authenticated;

-- COACH は customers を直接更新できない (評価に効く列を書き換えられてしまうため)。
-- このポリシーを外すと、customers への UPDATE は customers_admin_write だけが残り、
-- ADMIN 以外の更新は RLS が行レベルで拒否する。
-- COACH 側の更新経路は refresh_customer_achievement() のみ。
drop policy if exists customers_coach_update on public.customers;
