-- ============================================================================
-- 一覧画面向けのインデックス追加 (評価ロジックには影響しない)
--
-- EXPLAIN ANALYZE で以下を確認した上で追加している:
--   ・ADMIN売上一覧 (deleted_at is null / sold_on desc / 100件)
--       → sales 全件の Seq Scan + top-N sort になっていた
--   ・監査ログ一覧 (created_at desc / 100件)
--       → audit_logs 全件の Seq Scan + top-N sort になっていた
-- どちらも件数の増加にそのまま比例して遅くなるため、並び順に沿った索引を用意する。
-- ============================================================================

-- ADMIN 売上一覧: 成約日の新しい順に先頭100件だけ読む
create index if not exists sales_sold_on_idx
  on public.sales (sold_on desc)
  where deleted_at is null;

-- 監査ログ一覧: 記録日時の新しい順に先頭100件だけ読む
create index if not exists audit_logs_created_at_idx
  on public.audit_logs (created_at desc);
