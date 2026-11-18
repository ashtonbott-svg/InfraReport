#!/usr/bin/env bash
# Apply pending InfraReport migrations to the hosted Supabase project through the Management API.
# A file counts as applied when its name (without .sql) is in the hosted migration history, so earlier
# migrations are never executed again. Requires the Supabase token saved on the InfraReport environment
# (the network proxy adds it; nothing is read from or written to this script).
#   scripts/supabase-migrate.sh --dry-run   # list pending files only
#   scripts/supabase-migrate.sh             # apply pending files in order, stop at the first failure
set -euo pipefail
REF="yuoqdyrhhchfdapyqxdz"   # InfraReport only
API="https://api.supabase.com/v1/projects/$REF/database/migrations"
cd "$(dirname "$0")/../supabase/migrations"
applied="$(curl -sf -m 60 "$API" | python3 -c 'import json,sys; print("\n".join(m["name"] for m in json.load(sys.stdin)))')"
pending=()
for f in *.sql; do
  name="${f%.sql}"
  grep -qxF "$name" <<<"$applied" || pending+=("$f")
done
if [ ${#pending[@]} -eq 0 ]; then echo "Nothing to apply: hosted history has every migration."; exit 0; fi
printf 'Pending: %s\n' "${pending[@]}"
[ "${1:-}" = "--dry-run" ] && exit 0
for f in "${pending[@]}"; do
  name="${f%.sql}"
  body="$(python3 -c 'import json,sys; print(json.dumps({"name": sys.argv[1], "query": open(sys.argv[2]).read()}))' "$name" "$f")"
  code="$(curl -s -m 300 -o /tmp/supabase-migrate.out -w '%{http_code}' -X POST -H 'content-type: application/json' -H "Idempotency-Key: infrareport-apply-$name" --data "$body" "$API")"
  if [ "$code" != "200" ] && [ "$code" != "201" ]; then echo "FAILED $f (HTTP $code): $(cat /tmp/supabase-migrate.out)"; exit 1; fi
  echo "Applied $f"
done
