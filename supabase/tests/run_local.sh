#!/usr/bin/env bash
# ローカル PostgreSQL に対してマイグレーションと RLS テストを流す。
# Supabase CLI (docker) が使えない環境でもスキーマと権限設計を検証するための手段。
#
#   PGHOST=/tmp PGPORT=55432 ./supabase/tests/run_local.sh
set -euo pipefail

PGHOST="${PGHOST:-/tmp}"
PGPORT="${PGPORT:-55432}"
PGUSER="${PGUSER:-postgres}"
DB="${DB:-eagle_test}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
PSQL=(psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -v ON_ERROR_STOP=1 -q)

"${PSQL[@]}" -d postgres -c "drop database if exists $DB;" -c "create database $DB;"

for f in "$ROOT"/supabase/tests/_local_stub.sql "$ROOT"/supabase/migrations/*.sql; do
  echo "apply: $(basename "$f")"
  "${PSQL[@]}" -d "$DB" -f "$f"
done

# RLS テストは空のDBを前提にしているため、シード投入より先に流す
echo "test: rls_test.sql"
psql -h "$PGHOST" -p "$PGPORT" -U "$PGUSER" -v ON_ERROR_STOP=1 -d "$DB" -f "$ROOT/supabase/tests/rls_test.sql" | tail -3

echo "seed: seed.sql"
"${PSQL[@]}" -d "$DB" -f "$ROOT/supabase/seed.sql"
echo "seed applied"
