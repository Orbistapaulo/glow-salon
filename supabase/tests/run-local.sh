#!/usr/bin/env bash
# Runs the database tests on a throwaway local PostgreSQL cluster.
#   bash supabase/tests/run-local.sh baseline   live schema only
#   bash supabase/tests/run-local.sh crm        live schema plus the CRM migration
# Needs initdb, pg_ctl and psql on PATH. Nothing touches Supabase.
set -euo pipefail

MODE="${1:-crm}"
HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
PORT="${PGTEST_PORT:-54329}"
DATA="$(mktemp -d)"

cleanup() {
  pg_ctl -D "$DATA" -m immediate stop >/dev/null 2>&1 || true
  rm -rf "$DATA"
}
trap cleanup EXIT

initdb -D "$DATA" -U postgres -A trust -E UTF8 --no-locale >/dev/null
pg_ctl -D "$DATA" -o "-p $PORT -c listen_addresses=localhost" -l "$DATA/server.log" -w start >/dev/null

run() {
  # Prints "ok:" lines from the tests; stops on the first error.
  psql -X -q -v ON_ERROR_STOP=1 -h localhost -p "$PORT" -U postgres -d postgres \
       -v VERBOSITY=terse -f "$1" 2>&1 | sed -n 's/.*NOTICE:  //p; /ERROR/p'
  return "${PIPESTATUS[0]}"
}

echo "== setup ($MODE)"
run "$HERE/supabase_stub.sql"
run "$ROOT/supabase/migrations/20260923_baseline.sql"
run "$ROOT/supabase/seed.sql"
if [ "$MODE" = "crm" ]; then
  run "$ROOT/supabase/migrations/20260924_crm.sql"
fi

echo "== baseline_test.sql"
run "$HERE/baseline_test.sql"
if [ "$MODE" = "crm" ]; then
  echo "== crm_test.sql"
  run "$HERE/crm_test.sql"
fi
echo "== all passed"
