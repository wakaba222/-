-- ============================================================================
-- デモ用シードデータ (仕様42章)
--   ADMIN 1名 / コーチ3名 (P1・P2・P3) / 顧客27名 / 成果・売上データ
--   コーチ1名は P2→P3 の昇格候補になるよう成績を調整している。
--
-- 日付は current_date からの相対で生成するため、いつ流しても「直近3ヶ月」が埋まる。
-- パスワードは全ユーザー共通で Passw0rd! (デモ環境専用)
-- ============================================================================
-- 認証ユーザー (auth.users) はここでは作らない。
-- Supabase 実環境では auth スキーマの構造が GoTrue のバージョンに追従するため、
-- 直接 INSERT するとログインできない不整合が起きうる。
-- デモユーザーは公式の Admin API 経由で作成する: npm run seed:users
do $$
declare v_missing text;
begin
  select string_agg(t.email, ', ') into v_missing
    from (values ('admin@eagle.example'), ('tanaka@eagle.example'),
                 ('sato@eagle.example'), ('suzuki@eagle.example')) as t(email)
   where not exists (select 1 from public.users u where u.email = t.email);

  if v_missing is not null then
    raise exception 'デモユーザーが未作成です (%)。先に `npm run seed:users` を実行してください', v_missing;
  end if;
end $$;

-- ロールは Admin API のメタデータからトリガが設定するが、取りこぼしを防ぐため明示する
update public.users set role = 'ADMIN', name = '経営管理者' where email = 'admin@eagle.example';
update public.users set role = 'COACH' where email in ('tanaka@eagle.example', 'sato@eagle.example', 'suzuki@eagle.example');
update public.users set name = '田中 健一' where email = 'tanaka@eagle.example';
update public.users set name = '佐藤 美咲' where email = 'sato@eagle.example';
update public.users set name = '鈴木 大輔' where email = 'suzuki@eagle.example';

insert into public.coaches (id, user_id, professional_level, lesson_unit_price, hire_date)
select 'aaaaaaaa-0000-0000-0000-000000000001'::uuid, u.id, 'P2'::professional_level, 10000, current_date - interval '3 years'
  from public.users u where u.email = 'tanaka@eagle.example'
union all
select 'aaaaaaaa-0000-0000-0000-000000000002'::uuid, u.id, 'P1'::professional_level, 0, current_date - interval '10 months'
  from public.users u where u.email = 'sato@eagle.example'
union all
select 'aaaaaaaa-0000-0000-0000-000000000003'::uuid, u.id, 'P3'::professional_level, 12000, current_date - interval '5 years'
  from public.users u where u.email = 'suzuki@eagle.example'
on conflict (user_id) do nothing;

-- --- 顧客の仕様表 -----------------------------------------------------------
-- achieved_month_offset: null = 未達成 / 0 = 今月, 1 = 先月 … (月境界で指定する)
--   月末で締める評価と噛み合うよう、日数ではなく「何ヶ月前の月」で指定している。
--   これにより seed をいつ流しても、直近3ヶ月の成績カーブが同じ形になる。
create temp table seed_customers (
  coach_no             int,
  name                 text,
  start_months_ago     int,
  status               customer_status,
  cancel_reason        cancel_reason_code,
  goal_type            goal_type,
  target_score         numeric,
  target_distance      numeric,
  achieved_month_offset int,
  achieved_day         int,
  goal_status          goal_approval_status
);

insert into seed_customers (coach_no, name, start_months_ago, status, cancel_reason, goal_type, target_score, target_distance, achieved_month_offset, achieved_day, goal_status) values
  -- コーチ1 (田中/P2): 昇格候補。評価対象10名中9名達成 = 完全成果率90%
  (1, '青木 慎一', 10, 'COMPLETED', null, 'SCORE',    100, null,  6,    12, 'APPROVED'),
  (1, '井上 亮',    9, 'COMPLETED', null, 'SCORE',     95, null,  5,    18, 'APPROVED'),
  (1, '上田 直樹',  9, 'COMPLETED', null, 'DISTANCE', null, 250,  4,     8, 'APPROVED'),
  (1, '遠藤 拓也',  8, 'ACTIVE',    null, 'SCORE',     90, null,  3,    22, 'APPROVED'),
  (1, '大野 剛',    8, 'ACTIVE',    null, 'SCORE',    100, null,  2,     5, 'APPROVED'),
  (1, '加藤 学',    7, 'ACTIVE',    null, 'BOTH',     100,  240,  2,    12, 'APPROVED'),
  (1, '川口 洋介',  7, 'ACTIVE',    null, 'SCORE',     95, null,  2,    18, 'APPROVED'),
  (1, '木村 修',    6, 'ACTIVE',    null, 'SCORE',    100, null,  2,    24, 'APPROVED'),
  -- プログラム終了後に達成 (仕様9章: 終了後の達成も完全成果に加算される)
  (1, '小林 康平', 11, 'COMPLETED', null, 'SCORE',    100, null,  2,    27, 'APPROVED'),
  (1, '斉藤 誠',    6, 'ACTIVE',    null, 'SCORE',     90, null,  null, null, 'APPROVED'),
  -- 評価対象前 (開始2ヶ月) と 目標の承認待ち
  (1, '佐々木 涼',  2, 'ACTIVE',    null, 'SCORE',    100, null,  null, null, 'APPROVED'),
  (1, '島田 光',    1, 'ACTIVE',    null, 'SCORE',    100, null,  null, null, 'PENDING'),

  -- コーチ2 (佐藤/P1): 育成段階。評価対象6名中3名達成
  (2, '田村 直人',  9, 'COMPLETED', null, 'SCORE',    100, null,  6,    14, 'APPROVED'),
  (2, '中島 悠',    8, 'ACTIVE',    null, 'SCORE',    100, null,  3,     9, 'APPROVED'),
  (2, '西村 亮太',  7, 'ACTIVE',    null, 'DISTANCE', null, 230,  1,    16, 'APPROVED'),
  (2, '野口 健',    7, 'ACTIVE',    null, 'SCORE',     95, null,  null, null, 'APPROVED'),
  (2, '橋本 淳',    6, 'ACTIVE',    null, 'SCORE',    100, null,  null, null, 'APPROVED'),
  (2, '林 大地',    5, 'ACTIVE',    null, 'SCORE',    100, null,  null, null, 'APPROVED'),
  (2, '福田 翔',    3, 'ACTIVE',    null, 'SCORE',    100, null,  null, null, 'APPROVED'),
  -- 休会 (経過月数のカウントが止まり、評価分母から外れる)
  (2, '古川 諒',    8, 'SUSPENDED', null, 'SCORE',    100, null,  null, null, 'APPROVED'),

  -- コーチ3 (鈴木/P3): トップ水準。評価対象6名全員が達成 = 120点
  (3, '本田 修平', 10, 'COMPLETED', null, 'SCORE',     90, null,  6,    11, 'APPROVED'),
  (3, '松井 圭',    9, 'COMPLETED', null, 'BOTH',      95,  260,  4,    17, 'APPROVED'),
  (3, '三浦 悠真',  8, 'ACTIVE',    null, 'SCORE',     90, null,  3,     6, 'APPROVED'),
  (3, '村上 蓮',    7, 'ACTIVE',    null, 'DISTANCE', null, 270,  2,    21, 'APPROVED'),
  (3, '森 陸',      6, 'ACTIVE',    null, 'SCORE',     95, null,  1,    13, 'APPROVED'),
  (3, '山口 颯',    5, 'ACTIVE',    null, 'SCORE',    100, null,  0,     4, 'APPROVED'),
  -- 自己都合解約 (評価分母から外れる)
  (3, '吉田 匠',    7, 'CANCELLED', 'SELF', 'SCORE',  100, null,  null, null, 'APPROVED');

-- --- 顧客・目標・担当履歴・成果履歴の生成 ------------------------------------
do $$
declare
  r            record;
  v_coach      uuid;
  v_customer   uuid;
  v_goal       uuid;
  v_start      date;
  v_end        date;
  v_achieved   date;
  v_target_s   numeric;
  v_target_d   numeric;
  v_admin      uuid;
begin
  select id into v_admin from public.users where email = 'admin@eagle.example';
  for r in select * from seed_customers loop
    v_coach := case r.coach_no
                 when 1 then 'aaaaaaaa-0000-0000-0000-000000000001'::uuid
                 when 2 then 'aaaaaaaa-0000-0000-0000-000000000002'::uuid
                 else        'aaaaaaaa-0000-0000-0000-000000000003'::uuid end;
    v_start := current_date - make_interval(months => r.start_months_ago);
    v_end   := v_start + interval '6 months';
    -- 達成日は「N ヶ月前の月の指定日」。未来日にならないよう当日で丸める
    v_achieved := case when r.achieved_month_offset is null then null
                       else least(
                         current_date - 1,
                         (date_trunc('month', current_date)
                          - make_interval(months => r.achieved_month_offset)
                          + make_interval(days => r.achieved_day - 1))::date
                       ) end;
    v_target_s := r.target_score;
    v_target_d := r.target_distance;

    insert into public.customers (
      name, current_coach_id, program_start_date, program_end_date, status, status_changed_on,
      cancel_reason_code, suspended_days, start_score, target_score, start_distance, target_distance,
      goal_type, goal_approval_status, goal_approved_by, goal_approved_at,
      latest_score, latest_distance, complete_success, complete_success_at)
    values (
      r.name, v_coach, v_start, v_end, r.status,
      case when r.status in ('CANCELLED','SUSPENDED','COMPLETED') then v_start + interval '5 months' end,
      r.cancel_reason,
      case when r.status = 'SUSPENDED' then 60 else 0 end,
      case when v_target_s is not null then v_target_s + 20 end, v_target_s,
      case when v_target_d is not null then v_target_d - 25 end, v_target_d,
      r.goal_type, r.goal_status,
      case when r.goal_status = 'APPROVED' then v_admin end,
      case when r.goal_status = 'APPROVED' then v_start + interval '3 days' end,
      case when v_target_s is not null then coalesce(v_target_s - 2, 0) + case when v_achieved is null then 6 else 0 end end,
      case when v_target_d is not null then v_target_d + case when v_achieved is null then -12 else 5 end end,
      v_achieved is not null, v_achieved)
    returning id into v_customer;

    insert into public.customer_goals (customer_id, goal_type, start_score, target_score, start_distance,
                                       target_distance, approval_status, approved_by, approved_at, effective_from)
    values (v_customer, r.goal_type,
            case when v_target_s is not null then v_target_s + 20 end, v_target_s,
            case when v_target_d is not null then v_target_d - 25 end, v_target_d,
            r.goal_status,
            case when r.goal_status = 'APPROVED' then v_admin end,
            case when r.goal_status = 'APPROVED' then v_start + interval '3 days' end,
            v_start)
    returning id into v_goal;

    insert into public.customer_coach_assignments (customer_id, coach_id, start_date)
    values (v_customer, v_coach, v_start);

    -- 途中経過の成果記録 (未達成の記録)
    insert into public.performance_records (customer_id, coach_id, goal_id, recorded_on, score, distance,
                                            meets_score_goal, meets_distance_goal, is_complete_success, note)
    values (v_customer, v_coach, v_goal, v_start + interval '2 months',
            case when v_target_s is not null then v_target_s + 12 end,
            case when v_target_d is not null then v_target_d - 18 end,
            false, false, false, '中間チェック');

    -- 完全達成の記録
    if v_achieved is not null then
      insert into public.performance_records (customer_id, coach_id, goal_id, recorded_on, score, distance,
                                              meets_score_goal, meets_distance_goal, is_complete_success, note)
      values (v_customer, v_coach, v_goal, v_achieved,
              case when v_target_s is not null then v_target_s - 2 end,
              case when v_target_d is not null then v_target_d + 5 end,
              v_target_s is not null, v_target_d is not null, true, '目標達成');
    end if;
  end loop;
end $$;

-- --- 売上データ -------------------------------------------------------------
-- 直近4ヶ月に加え、年間累計が見えるよう過去分も投入する
do $$
declare
  v_coach      uuid;
  v_product    uuid;
  v_customer   uuid;
  m            int;
  i            int;
  v_amount     int;
  v_coach_no   int;
  v_codes      text[] := array['RESTART','BREAKTHROUGH','HIGH_PERFORMANCE'];
  v_code       text;
  v_refunded_sale uuid;
begin
  for v_coach_no in 1..3 loop
    v_coach := case v_coach_no
                 when 1 then 'aaaaaaaa-0000-0000-0000-000000000001'::uuid
                 when 2 then 'aaaaaaaa-0000-0000-0000-000000000002'::uuid
                 else        'aaaaaaaa-0000-0000-0000-000000000003'::uuid end;

    for m in 0..11 loop
      -- コーチごとの月間売上水準: 1=約540万(昇格候補) / 2=約140万 / 3=約740万(上限到達のデモ)
      for i in 1..(case v_coach_no when 1 then 4 when 2 then 2 else 5 end) loop
        v_code := v_codes[least(i, 3)];
        select id into v_product from public.products where code = v_code;
        select id into v_customer from public.customers
         where current_coach_id = v_coach order by md5(id::text || m::text || i::text) limit 1;

        select default_price into v_amount from public.products where id = v_product;
        insert into public.sales (coach_id, customer_id, product_id, sold_on, amount, incentive_amount,
                                  acquisition_source, note)
        select v_coach, v_customer, v_product,
               (date_trunc('month', current_date) - make_interval(months => m) + make_interval(days => 5 + i * 3))::date,
               v_amount, p.incentive_amount, 'EXISTING', null
        from public.products p where p.id = v_product;
      end loop;
    end loop;
  end loop;

  -- SNS経由の新規Re:Swing売上 (既定では売上点から除外され、別枠表示される)
  select id into v_product from public.products where code = 'RESTART';
  insert into public.sales (coach_id, customer_id, product_id, sold_on, amount, incentive_amount, acquisition_source, note)
  values ('aaaaaaaa-0000-0000-0000-000000000001', null, v_product,
          (date_trunc('month', current_date) + interval '8 days')::date, 498000, 10000, 'COACH_SNS', 'Instagram経由の新規');

  -- 一部返金された売上 (税抜相当額が控除されることの確認用)
  --
  -- 売上は登録時に必ず「有効・返金0」で始まる (整合性トリガ)。
  -- 返金はADMINの更新操作なので、seedでも登録してから更新する。
  select id into v_product from public.products where code = 'BREAKTHROUGH';
  insert into public.sales (coach_id, customer_id, product_id, sold_on, amount, incentive_amount,
                            acquisition_source, note)
  values ('aaaaaaaa-0000-0000-0000-000000000002', null, v_product,
          (date_trunc('month', current_date) - interval '1 month' + interval '12 days')::date,
          899000, 20000, 'EXISTING', '中途解約に伴う一部返金')
  returning id into v_refunded_sale;

  update public.sales
     set status = 'REFUNDED', refund_amount = 400000, status_changed_on = current_date
   where id = v_refunded_sale;
end $$;

-- --- 行動ルール・上位活動要件 ------------------------------------------------
insert into public.coach_behavior_statuses (coach_id, year_month, status, set_by)
select c.id, to_char(current_date - make_interval(months => m), 'YYYY-MM'),
       case when c.id = 'aaaaaaaa-0000-0000-0000-000000000002' and m = 0 then 'WARNING'::behavior_status
            else 'OK'::behavior_status end,
       (select id from public.users where email = 'admin@eagle.example')
from public.coaches c, generate_series(0, 3) as m
on conflict do nothing;

-- 昇格候補 (コーチ1) は上位活動要件2件を承認済み
insert into public.promotion_requirement_checks (coach_id, requirement_code, label, achieved_count, approved_by, approved_at)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'SENIOR_ACTIVITY', '上位活動要件 (1対多数の専門性)', 2,
   (select id from public.users where email = 'admin@eagle.example'), now()),
  ('aaaaaaaa-0000-0000-0000-000000000003', 'OWN_BUSINESS_RESULT', '本人起点の事業成果', 0, null, null)
on conflict (coach_id, requirement_code) do nothing;

-- --- レッスン数 (報酬シミュレーション用) --------------------------------------
insert into public.monthly_lesson_counts (coach_id, year_month, lesson_count)
select c.id, to_char(current_date - make_interval(months => m), 'YYYY-MM'),
       case c.professional_level when 'P3' then 42 when 'P2' then 38 else 20 end
from public.coaches c, generate_series(0, 3) as m
on conflict do nothing;

drop table if exists seed_customers;
