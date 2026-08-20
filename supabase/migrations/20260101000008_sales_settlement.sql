-- ============================================================================
-- 売上の精算情報 (仕様8章)
--
-- 売価だけでなく、消費税・決済手数料・返金を差し引いた純額と、
-- どの決済経路で入金されたかを保持できるようにする。
--
-- 評価に使う金額の基準は evaluation_rules.sales.amountBasis で切り替える。
-- 既定は GROSS_MINUS_REFUND (売価 − 返金)。売上点のアンカー (200万/350万/500万) は
-- 商品の売価を前提に設計されているため、既定を変えると制度の水準が動く。
-- ============================================================================

create type payment_source as enum ('ROBOT_PAYMENT', 'MOSH', 'BANK_TRANSFER', 'MANUAL');

alter table public.sales
  add column tax_amount     integer not null default 0 check (tax_amount >= 0),
  add column payment_fee    integer not null default 0 check (payment_fee >= 0),
  add column payment_source payment_source not null default 'MANUAL';

-- 純額は常に他の列から導出する (手入力による齟齬を作らない)
alter table public.sales
  add column net_amount integer
    generated always as (greatest(amount - tax_amount - payment_fee - refund_amount, 0)) stored;

alter table public.sales
  add constraint sales_deductions_within_amount
    check (tax_amount + payment_fee + refund_amount <= amount);

comment on column public.sales.amount is '売価 (gross_amount)。商品マスタの標準価格を既定とし、案件ごとに変更可能';
comment on column public.sales.tax_amount is '消費税額。税抜運用の場合は0のままでよい';
comment on column public.sales.payment_fee is '決済手数料 (Robot Payment / MOSH など)';
comment on column public.sales.net_amount is '純額 = 売価 − 税 − 決済手数料 − 返金 (自動計算)';
comment on column public.sales.payment_source is '入金経路。銀行振込はMVPでは手入力';

create index sales_payment_source_idx on public.sales (payment_source) where deleted_at is null;

-- 決済情報の後付けを許すため、コーチの登録時に上書きするのは
-- インセンティブ額と初期ステータスのみとする (既存トリガの範囲は変更しない)
