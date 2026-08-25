-- ============================================================================
-- RLS の動作検証 (ローカル専用)
-- COACH が他コーチのデータへ到達できないことを DB レベルで確認する。
-- ============================================================================
\set ON_ERROR_STOP on

-- --- テストデータ (superuser として投入) ---------------------------------
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-0000000000a1', 'admin@example.com'),
  ('00000000-0000-0000-0000-0000000000c1', 'coach1@example.com'),
  ('00000000-0000-0000-0000-0000000000c2', 'coach2@example.com');

-- auth.users へのINSERTでプロフィール行はトリガが作成済み。ロールだけ確定させる
update public.users set name = '管理者', role = 'ADMIN' where id = '00000000-0000-0000-0000-0000000000a1';
update public.users set name = 'コーチ1' where id = '00000000-0000-0000-0000-0000000000c1';
update public.users set name = 'コーチ2' where id = '00000000-0000-0000-0000-0000000000c2';

insert into public.coaches (id, user_id, professional_level, lesson_unit_price, hire_date) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000c1', 'P2', 10000, '2024-01-01'),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000c2', 'P2', 10000, '2024-01-01');

insert into public.customers (id, name, current_coach_id, program_start_date, program_end_date, goal_type, target_score, goal_approval_status) values
  ('00000000-0000-0000-0000-0000000000d1', 'コーチ1の顧客', '00000000-0000-0000-0000-0000000000f1', '2026-01-01', '2026-06-30', 'SCORE', 100, 'APPROVED'),
  ('00000000-0000-0000-0000-0000000000d2', 'コーチ2の顧客', '00000000-0000-0000-0000-0000000000f2', '2026-01-01', '2026-06-30', 'SCORE', 100, 'APPROVED');

insert into public.customer_coach_assignments (customer_id, coach_id, start_date) values
  ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000f1', '2026-01-01'),
  ('00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000f2', '2026-01-01');

insert into public.products (id, code, name, default_price, incentive_amount) values
  ('00000000-0000-0000-0000-0000000000b1', 'TEST_ONLY', 'テスト商品', 498000, 10000);

insert into public.sales (coach_id, customer_id, product_id, sold_on, amount, incentive_amount) values
  ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000b1', '2026-05-01', 498000, 10000),
  ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000d2', '00000000-0000-0000-0000-0000000000b1', '2026-05-02', 498000, 10000);

-- --- COACH1 として検証 ----------------------------------------------------
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c1';

do $$
declare n integer;
begin
  select count(*) into n from public.customers;
  assert n = 1, format('COACH は自分の担当顧客のみ見えるべき: %s件見えている', n);

  select count(*) into n from public.sales;
  assert n = 1, format('COACH は自分の売上のみ見えるべき: %s件見えている', n);

  select count(*) into n from public.coaches;
  assert n = 1, format('COACH は自分のコーチ行のみ見えるべき: %s件見えている', n);

  select count(*) into n from public.users;
  assert n = 1, format('COACH は自分のユーザー行のみ見えるべき: %s件見えている', n);

  select count(*) into n from public.audit_logs;
  assert n = 0, 'COACH は監査ログを参照できないべき';
end $$;

-- 他コーチ名義の売上は登録できない
do $$
begin
  begin
    insert into public.sales (coach_id, customer_id, product_id, sold_on, amount)
    values ('00000000-0000-0000-0000-0000000000f2', '00000000-0000-0000-0000-0000000000d2',
            '00000000-0000-0000-0000-0000000000b1', '2026-05-03', 100000);
    raise exception '他コーチ名義の売上登録が通ってしまった';
  exception when insufficient_privilege then
    null; -- 期待どおり RLS で拒否
  end;
end $$;

-- 担当外の顧客への成果登録も拒否される
do $$
begin
  begin
    insert into public.performance_records (customer_id, recorded_on, score)
    values ('00000000-0000-0000-0000-0000000000d2', '2026-05-03', 95);
    raise exception '担当外顧客への成果登録が通ってしまった';
  exception when insufficient_privilege then
    null;
  end;
end $$;

-- 自分の担当顧客への成果登録は成功する
insert into public.performance_records (customer_id, coach_id, recorded_on, score)
values ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000f1', '2026-05-03', 98);

-- --- ADMIN として検証 -----------------------------------------------------
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';
do $$
declare n integer;
begin
  select count(*) into n from public.customers;
  assert n = 2, format('ADMIN は全顧客が見えるべき: %s件', n);
  select count(*) into n from public.sales;
  assert n = 2, format('ADMIN は全売上が見えるべき: %s件', n);
  select count(*) into n from public.audit_logs;
  assert n > 0, '重要操作の監査ログが記録されているべき';
end $$;

-- 監査ログに変更前後が残っているか
set role postgres;
do $$
declare v_action text; v_after jsonb;
begin
  update public.customers set target_score = 95
   where id = '00000000-0000-0000-0000-0000000000d1';
  select action, after into v_action, v_after from public.audit_logs
   where entity_table = 'customers' and action = 'UPDATE' order by created_at desc limit 1;
  assert v_action = 'UPDATE', '顧客更新の監査ログが無い';
  assert (v_after->>'target_score')::numeric = 95, '監査ログに変更後の値が入っていない';
end $$;

select 'RLS TEST PASSED' as result;

-- ============================================================================
-- 整合性トリガの検証
-- クライアントが達成フラグやインセンティブ額を偽装できないことを確認する
-- ============================================================================
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c1';

-- 目標未達なのに完全達成を申告しても、DB 側で false に矯正される
do $$
declare v_flag boolean;
begin
  insert into public.performance_records (customer_id, coach_id, recorded_on, score, is_complete_success)
  values ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000f1',
          '2026-05-04', 130, true)
  returning is_complete_success into v_flag;
  assert v_flag = false, '未達の記録が完全達成として保存されてしまった';
end $$;

-- 目標達成の記録は申告が false でも true に矯正される
do $$
declare v_flag boolean;
begin
  insert into public.performance_records (customer_id, coach_id, recorded_on, score, is_complete_success)
  values ('00000000-0000-0000-0000-0000000000d1', '00000000-0000-0000-0000-0000000000f1',
          '2026-05-05', 90, false)
  returning is_complete_success into v_flag;
  assert v_flag = true, '達成した記録が未達として保存されてしまった';
end $$;

-- COACH は customers を直接更新できない (完全達成フラグの偽装を防ぐ)
do $$
declare v_updated int;
begin
  update public.customers set complete_success = true, complete_success_at = '2026-01-01'
   where id = '00000000-0000-0000-0000-0000000000d1';
  get diagnostics v_updated = row_count;
  assert v_updated = 0, 'COACH が顧客の完全達成フラグを直接書き換えられてしまった';
exception when insufficient_privilege then
  null; -- 権限エラーで拒否されるのも期待どおり
end $$;

-- 更新経路は再計算関数のみ。履歴から達成日が導出される
do $$
declare v_success boolean; v_at date;
begin
  perform public.refresh_customer_achievement('00000000-0000-0000-0000-0000000000d1');
  select complete_success, complete_success_at into v_success, v_at
    from public.customers where id = '00000000-0000-0000-0000-0000000000d1';
  assert v_success, '達成記録があるのに完全達成にならない';
  assert v_at = '2026-05-03', format('達成日は最も古い達成記録の日付であるべき: %s', v_at);
end $$;

-- インセンティブ額は商品マスタの値で固定される (自己申告できない)
do $$
declare v_incentive integer;
begin
  insert into public.sales (coach_id, customer_id, product_id, sold_on, amount, incentive_amount)
  values ('00000000-0000-0000-0000-0000000000f1', '00000000-0000-0000-0000-0000000000d1',
          '00000000-0000-0000-0000-0000000000b1', '2026-05-09', 498000, 999999)
  returning incentive_amount into v_incentive;
  assert v_incentive = 10000, format('インセンティブ額が申告値のまま保存された: %s', v_incentive);
end $$;

-- 完全達成判定が TypeScript 側 (judgeCompleteSuccess) と同じ規則になっているか。
-- src/domain/evaluation/evaluation.test.ts の「完全達成判定」と同じケースを並べている。
set role postgres;
do $$
begin
  -- スコアは目標以下で達成
  assert app.judge_complete_success(98, null, 'SCORE', 100, null, 'ALL');
  assert not app.judge_complete_success(101, null, 'SCORE', 100, null, 'ALL');
  -- 飛距離は目標以上で達成
  assert app.judge_complete_success(null, 255, 'DISTANCE', null, 250, 'ALL');
  assert not app.judge_complete_success(null, 245, 'DISTANCE', null, 250, 'ALL');
  -- BOTH は既定で両方必要
  assert app.judge_complete_success(98, 255, 'BOTH', 100, 250, 'ALL');
  assert not app.judge_complete_success(98, 240, 'BOTH', 100, 250, 'ALL');
  -- ANY 設定なら片方で成立
  assert app.judge_complete_success(98, 240, 'BOTH', 100, 250, 'ANY');
  -- 値が無い場合は達成にしない
  assert not app.judge_complete_success(null, null, 'SCORE', 100, null, 'ALL');
end $$;

-- ============================================================================
-- 担当変更履歴 (仕様22章)
-- 過去の担当を消さずに履歴として残せること、現担当は常に1人であることを確認する
-- ============================================================================
set role postgres;
do $$
declare v_customer uuid := '00000000-0000-0000-0000-0000000000d1';
begin
  -- 現担当を閉じずに新担当を追加することはできない
  begin
    insert into public.customer_coach_assignments (customer_id, coach_id, start_date)
    values (v_customer, '00000000-0000-0000-0000-0000000000f2', current_date);
    raise exception '現担当が2人になる登録が通ってしまった';
  exception when unique_violation then
    null; -- 期待どおり
  end;

  -- 正しい手順: 現担当を終了させてから新担当を追加する
  update public.customer_coach_assignments set end_date = current_date
   where customer_id = v_customer and end_date is null;
  insert into public.customer_coach_assignments (customer_id, coach_id, start_date)
  values (v_customer, '00000000-0000-0000-0000-0000000000f2', current_date);

  -- 過去の担当履歴が残っていること
  assert (select count(*) from public.customer_coach_assignments where customer_id = v_customer) = 2,
    '担当変更で過去の履歴が失われた';
  assert (select count(*) from public.customer_coach_assignments
           where customer_id = v_customer and end_date is null) = 1,
    '現担当が1人になっていない';
end $$;

-- ============================================================================
-- 消費税額の導出 (確定仕様: 売上Scoreは税抜売上ベース)
-- src/domain/evaluation/sales.ts の deriveTaxAmount と同じ結果になること
-- ============================================================================
set role postgres;
do $$
declare
  v_product uuid;
  v_tax integer;
  v_sale_amount integer := 498000;
begin
  -- 内税商品: 売価から消費税を割り戻す
  insert into public.products (code, name, default_price, incentive_amount, tax_rate, price_includes_tax)
  values ('TAX_INCLUSIVE_TEST', '内税テスト商品', v_sale_amount, 10000, 0.10, true)
  returning id into v_product;

  insert into public.sales (coach_id, product_id, sold_on, amount)
  values ('00000000-0000-0000-0000-0000000000f1', v_product, '2026-05-20', v_sale_amount)
  returning tax_amount into v_tax;
  assert v_tax = 45273, format('内税の税額が想定と違う: %s (期待 45273)', v_tax);
  assert v_sale_amount - v_tax = 452727, '税抜売上が想定と違う';

  -- 外税商品: 売価がそのまま税抜なので税額は0
  insert into public.products (code, name, default_price, incentive_amount, tax_rate, price_includes_tax)
  values ('TAX_EXCLUSIVE_TEST', '外税テスト商品', 1000000, 0, 0.10, false)
  returning id into v_product;

  insert into public.sales (coach_id, product_id, sold_on, amount)
  values ('00000000-0000-0000-0000-0000000000f1', v_product, '2026-05-21', 1000000)
  returning tax_amount into v_tax;
  assert v_tax = 0, format('外税商品の税額が0でない: %s', v_tax);

  -- 税額はクライアント申告を採用しない
  insert into public.products (code, name, default_price, incentive_amount, tax_rate, price_includes_tax)
  values ('TAX_SPOOF_TEST', '申告テスト商品', 2000000, 50000, 0.10, true)
  returning id into v_product;

  insert into public.sales (coach_id, product_id, sold_on, amount, tax_amount)
  values ('00000000-0000-0000-0000-0000000000f1', v_product, '2026-05-22', 2000000, 1900000)
  returning tax_amount into v_tax;
  assert v_tax = 181818, format('申告された税額が保存されてしまった: %s (期待 181818)', v_tax);
end $$;

-- ============================================================================
-- 設定変更は ADMIN 限定 (仕様: COACH は設定変更権限を一切持たない)
--
-- RLS のポリシーだけでなく、トリガによる明示的な拒否も効いていることを確認する。
-- 「エラーは出ないが0件更新」で通過してしまわないよう、
--   ① 例外が起きること
--   ② 実際に値が変わっていないこと
-- の両方を見る。
-- ============================================================================
reset role;
reset request.jwt.claim.sub;

-- 変更前の値を控える
create table if not exists _settings_before as
select
  (select professional_level::text from public.coaches where id = '00000000-0000-0000-0000-0000000000f1') as coach_level,
  (select lesson_unit_price from public.coaches where id = '00000000-0000-0000-0000-0000000000f1') as coach_price,
  (select incentive_amount from public.products where id = '00000000-0000-0000-0000-0000000000b1') as product_incentive,
  (select default_price from public.products where id = '00000000-0000-0000-0000-0000000000b1') as product_price,
  (select role::text from public.users where id = '00000000-0000-0000-0000-0000000000c1') as coach_role,
  (select count(*) from public.evaluation_rules) as rule_count,
  (select count(*) from public.evaluation_snapshots) as snapshot_count,
  (select count(*) from public.promotion_reviews) as review_count,
  (select count(*) from public.coach_behavior_statuses) as behavior_count,
  (select count(*) from public.promotion_requirement_checks) as requirement_count;

set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000c1';

do $$
declare
  v_allowed text[] := array[]::text[];
  v_denied  text[] := array[]::text[];

  -- 拒否のされ方は2通りある:
  --   ・トリガが例外を投げる (insufficient_privilege)
  --   ・RLS が対象行を隠し、0件更新で終わる (UPDATE の場合)
  -- どちらも「変更できなかった」なので、両方を拒否として数える。
  procedure_placeholder boolean;
begin
  -- 1. 自分のランクを上げる
  begin
    update public.coaches set professional_level = 'P4'
     where id = '00000000-0000-0000-0000-0000000000f1';
    if found then v_allowed := v_allowed || 'コーチのランク変更'::text;
    else v_denied := v_denied || 'コーチのランク変更'::text; end if;
  exception when insufficient_privilege then v_denied := v_denied || 'コーチのランク変更'::text;
  end;

  -- 2. 自分のレッスン単価を上げる
  begin
    update public.coaches set lesson_unit_price = 999999
     where id = '00000000-0000-0000-0000-0000000000f1';
    if found then v_allowed := v_allowed || 'レッスン単価の変更'::text;
    else v_denied := v_denied || 'レッスン単価の変更'::text; end if;
  exception when insufficient_privilege then v_denied := v_denied || 'レッスン単価の変更'::text;
  end;

  -- 3. インセンティブ額を上げる
  begin
    update public.products set incentive_amount = 999999
     where id = '00000000-0000-0000-0000-0000000000b1';
    if found then v_allowed := v_allowed || 'インセンティブ額の変更'::text;
    else v_denied := v_denied || 'インセンティブ額の変更'::text; end if;
  exception when insufficient_privilege then v_denied := v_denied || 'インセンティブ額の変更'::text;
  end;

  -- 4. 商品を新規登録する
  begin
    insert into public.products (code, name, default_price, incentive_amount)
    values ('COACH_TAMPER', '[不正]', 1, 999999);
    v_allowed := v_allowed || '商品の新規登録'::text;
  exception when insufficient_privilege then v_denied := v_denied || '商品の新規登録'::text;
  end;

  -- 5. 評価ルールを追加する
  begin
    insert into public.evaluation_rules (version, effective_from, rules)
    values (9999, '2030-01-01', '{"tampered":true}'::jsonb);
    v_allowed := v_allowed || '評価ルールの追加'::text;
  exception when insufficient_privilege then v_denied := v_denied || '評価ルールの追加'::text;
  end;

  -- 6. 評価ルールの中身を書き換える
  begin
    update public.evaluation_rules set note = '[不正] COACHによる変更';
    if found then v_allowed := v_allowed || '評価ルールの書き換え'::text;
    else v_denied := v_denied || '評価ルールの書き換え'::text; end if;
  exception when insufficient_privilege then v_denied := v_denied || '評価ルールの書き換え'::text;
  end;

  -- 7. 評価スナップショットを作る
  begin
    insert into public.evaluation_snapshots
      (coach_id, year_month, revision, current_rank, evaluation_rule_version, professional_score)
    values ('00000000-0000-0000-0000-0000000000f1', '2030-01', 1, 'P2',
            (select min(version) from public.evaluation_rules), 120);
    v_allowed := v_allowed || '評価スナップショットの作成'::text;
  exception when insufficient_privilege then v_denied := v_denied || '評価スナップショットの作成'::text;
  end;

  -- 8. 昇格審査を承認済みにする
  begin
    insert into public.promotion_reviews (coach_id, year_month, from_level, to_level, status)
    values ('00000000-0000-0000-0000-0000000000f1', '2030-01', 'P2', 'P4', 'APPROVED');
    v_allowed := v_allowed || '昇格審査の作成'::text;
  exception when insufficient_privilege then v_denied := v_denied || '昇格審査の作成'::text;
  end;

  -- 9. 行動ルールを OK にする
  begin
    insert into public.coach_behavior_statuses (coach_id, year_month, status)
    values ('00000000-0000-0000-0000-0000000000f1', '2030-01', 'OK');
    v_allowed := v_allowed || '行動ルールの登録'::text;
  exception when insufficient_privilege then v_denied := v_denied || '行動ルールの登録'::text;
  end;

  -- 10. 昇格要件を自分で承認する
  begin
    insert into public.promotion_requirement_checks
      (coach_id, requirement_code, label, achieved_count, approved_at)
    values ('00000000-0000-0000-0000-0000000000f1', 'TAMPER', '[不正]', 99, now());
    v_allowed := v_allowed || '昇格要件の承認'::text;
  exception when insufficient_privilege then v_denied := v_denied || '昇格要件の承認'::text;
  end;

  -- 11. 自分を ADMIN に昇格させる
  begin
    update public.users set role = 'ADMIN'
     where id = '00000000-0000-0000-0000-0000000000c1';
    if found then v_allowed := v_allowed || 'ロールの昇格'::text;
    else v_denied := v_denied || 'ロールの昇格'::text; end if;
  exception when insufficient_privilege then v_denied := v_denied || 'ロールの昇格'::text;
  end;

  assert array_length(v_allowed, 1) is null,
    format('COACH が設定を変更できてしまった: %s', array_to_string(v_allowed, ' / '));
  assert array_length(v_denied, 1) = 11,
    format('拒否された件数が想定と違う: %s件 (%s)', coalesce(array_length(v_denied, 1), 0),
           array_to_string(v_denied, ' / '));
end $$;

reset role;
reset request.jwt.claim.sub;

-- 値が1つも変わっていないこと
do $$
declare b record;
begin
  select * into b from _settings_before;
  assert (select professional_level::text from public.coaches where id = '00000000-0000-0000-0000-0000000000f1') = b.coach_level,
    'コーチのランクが書き換わっている';
  assert (select lesson_unit_price from public.coaches where id = '00000000-0000-0000-0000-0000000000f1') = b.coach_price,
    'レッスン単価が書き換わっている';
  assert (select incentive_amount from public.products where id = '00000000-0000-0000-0000-0000000000b1') = b.product_incentive,
    'インセンティブ額が書き換わっている';
  assert (select default_price from public.products where id = '00000000-0000-0000-0000-0000000000b1') = b.product_price,
    '商品価格が書き換わっている';
  assert (select role::text from public.users where id = '00000000-0000-0000-0000-0000000000c1') = b.coach_role,
    'ロールが書き換わっている';
  assert (select count(*) from public.evaluation_rules) = b.rule_count, '評価ルールが増減している';
  assert (select count(*) from public.evaluation_snapshots) = b.snapshot_count, 'スナップショットが増減している';
  assert (select count(*) from public.promotion_reviews) = b.review_count, '昇格審査が増減している';
  assert (select count(*) from public.coach_behavior_statuses) = b.behavior_count, '行動ルールが増減している';
  assert (select count(*) from public.promotion_requirement_checks) = b.requirement_count, '昇格要件が増減している';
end $$;

-- ADMIN は同じ操作ができること (締めすぎて運用が止まっていないかの確認)
set role authenticated;
set request.jwt.claim.sub = '00000000-0000-0000-0000-0000000000a1';

do $$
begin
  update public.products set incentive_amount = incentive_amount
   where id = '00000000-0000-0000-0000-0000000000b1';
  assert found, 'ADMIN が商品を更新できない';

  insert into public.coach_behavior_statuses (coach_id, year_month, status)
  values ('00000000-0000-0000-0000-0000000000f1', '2029-12', 'WARNING');

  insert into public.evaluation_snapshots
    (coach_id, year_month, revision, current_rank, evaluation_rule_version, professional_score)
  values ('00000000-0000-0000-0000-0000000000f1', '2029-12', 1, 'P2',
          (select min(version) from public.evaluation_rules), 100);
end $$;

reset role;
reset request.jwt.claim.sub;

-- サーバー側ジョブ (service_role) も書けること
set role service_role;
do $$
begin
  insert into public.evaluation_snapshots
    (coach_id, year_month, revision, current_rank, evaluation_rule_version, professional_score)
  values ('00000000-0000-0000-0000-0000000000f2', '2029-12', 1, 'P2',
          (select min(version) from public.evaluation_rules), 90);
end $$;
reset role;

drop table _settings_before;

select 'INTEGRITY TEST PASSED' as result;
