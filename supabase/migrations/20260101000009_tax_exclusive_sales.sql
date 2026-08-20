-- ============================================================================
-- 売上Scoreの税抜化 (経営判断による確定仕様)
--
--   Professional Score 対象売上 = 税抜売上 − 返金の税抜相当額
--
-- 決済手数料は会社側の利益管理に使うが、コーチの売上Scoreからは控除しない。
-- 売上点のアンカー (200万 / 350万 / 500万) は今後「税抜売上額」の基準として扱う。
--
-- 税抜売上は常に amount − tax_amount で導出する。
-- 内税商品は登録時に税額を自動算出し、外税商品は amount 自体が税抜なので税額0とする。
-- ============================================================================

alter table public.products
  add column tax_rate numeric(5,4) not null default 0.1000 check (tax_rate >= 0 and tax_rate < 1),
  add column price_includes_tax boolean not null default true;

comment on column public.products.tax_rate is '消費税率 (0.10 = 10%)';
comment on column public.products.price_includes_tax is
  '標準価格が税込か。true=内税 (売価から税を割り戻す) / false=外税 (売価がそのまま税抜)';

-- ---------------------------------------------------------------------------
-- 売上登録時に消費税額を商品マスタから導出する。
-- クライアントが税額を申告できてしまうと税抜売上を操作できるため、
-- インセンティブ額と同様にサーバー側で確定させる。
-- ---------------------------------------------------------------------------
create or replace function app.set_sale_incentive() returns trigger
language plpgsql security definer set search_path = public, app as $$
declare
  v_product record;
begin
  select p.incentive_amount, p.tax_rate, p.price_includes_tax
    into v_product
    from public.products p
   where p.id = new.product_id;

  new.incentive_amount := v_product.incentive_amount;

  -- 内税商品: 売価に含まれる消費税を割り戻す / 外税商品: 売価がそのまま税抜
  new.tax_amount := case
    when v_product.price_includes_tax
      then round(new.amount * v_product.tax_rate / (1 + v_product.tax_rate))
    else 0
  end;

  -- 登録直後の売上は必ず有効・返金なしから始める (取消/返金は ADMIN の更新操作)
  new.status := 'ACTIVE';
  new.refund_amount := 0;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 既存の売上に消費税額を反映する (税抜基準の適用開始)
-- ---------------------------------------------------------------------------
update public.sales s
   set tax_amount = case
         when p.price_includes_tax then round(s.amount * p.tax_rate / (1 + p.tax_rate))
         else 0
       end
  from public.products p
 where p.id = s.product_id;

-- ---------------------------------------------------------------------------
-- 評価ルール v1 の売上算定基準を税抜へ変更する
-- ---------------------------------------------------------------------------
update public.evaluation_rules
   set rules = jsonb_set(rules, '{sales,amountBasis}', '"TAX_EXCLUSIVE"'::jsonb, true),
       note = coalesce(note, '') || ' / 売上Scoreを税抜基準へ変更'
 where version = 1;
