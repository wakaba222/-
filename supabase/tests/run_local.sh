#!/usr/bin/env bash
# ローカル PostgreSQL に対してマイグレーション・RLSテスト・シードを流す。
# Supabase CLI (docker) が使えない環境でも、スキーマと権限設計を実地検証するための手段。
#
#   PGHOST=/tmp PGPORT=55432 ./supabase/tests/run_local.sh
#
# RLS テストは「空のDB」を前提にした件数アサーションを含むため、
# デモ用シードとはデータベースを分けて実行する。
set -euo pipefail

PGHOST="${PGHOST:-/tmp}"
PGPORT="${PGPORT:-55432}"
PGUSER="${PGUSER:-postgres}"
DB="${DB:-eagle_test}"
RLS_DB="${RLS_DB:-eagle_rls_test}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PSQL=(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -v ON_ERROR_STOP=1 -q)

apply_migrations() {
  local target="$1"
  "${PSQL[@]}" -d postgres -c "drop database if exists $target;" -c "create database $target;"
  for f in "$ROOT"/supabase/tests/_local_stub.sql "$ROOT"/supabase/migrations/*.sql; do
    "${PSQL[@]}" -d "$target" -f "$f"
  done
}

echo "== RLS テスト用DBを作成: $RLS_DB"
apply_migrations "$RLS_DB"
psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -v ON_ERROR_STOP=1 -d "$RLS_DB" -f "$ROOT/supabase/tests/rls_test.sql" | tail -3

echo "== デモ用DBを作成: $DB"
apply_migrations "$DB"
# 実環境では Admin API が作るデモユーザーを、ローカルでは模擬 auth.users に投入する
"${PSQL[@]}" -d "$DB" -f "$ROOT/supabase/tests/_local_users.sql"
"${PSQL[@]}" -d "$DB" -f "$ROOT/supabase/seed.sql"
echo "seed applied ($DB)"
