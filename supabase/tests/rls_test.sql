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
