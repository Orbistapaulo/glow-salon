#!/usr/bin/env bash
# Runs the database tests on a throwaway local PostgreSQL cluster.
#   bash supabase/tests/run-local.sh baseline   live schema only
#   bash supabase/tests/run-local.sh crm        live schema plus the CRM migration
#   bash supabase/tests/run-local.sh crm-numeric  same, with services.price as numeric(10,2)
#                                               (the summary query cannot show the live precision)
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
BASELINE="$ROOT/supabase/migrations/20260923_baseline.sql"
if [ "$MODE" = "crm-numeric" ]; then
  sed 's/price numeric not null check/price numeric(10,2) not null check/' "$BASELINE" > "$DATA/baseline.sql"
  BASELINE="$DATA/baseline.sql"
  MODE=crm
fi
run "$BASELINE"
run "$ROOT/supabase/seed.sql"
if [ "$MODE" = "crm" ]; then
  run "$HERE/fixtures_pre_crm.sql"
  run "$ROOT/supabase/migrations/20260924_crm.sql"
  run "$ROOT/supabase/migrations/20260925_drop_max_parallel_bookings.sql"
fi

echo "== baseline_test.sql"
run "$HERE/baseline_test.sql"
if [ "$MODE" = "crm" ]; then
  echo "== crm_test.sql"
  run "$HERE/crm_test.sql"
fi
echo "== all passed"
