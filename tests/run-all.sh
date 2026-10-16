#!/bin/bash
# Full regression: fresh API server before each suite (the engine's global
# anti-abuse rate cap means suites contaminate each other otherwise).
cd "$(dirname "$0")/.."
for f in rating-e2e guarantee-e2e refund-e2e refund-sheet-e2e; do
  pkill -f 'dev-api[.]mj[s]' 2>/dev/null
  sleep 1
  nohup node scripts/dev-api.mjs > /tmp/dev-api.log 2>&1 &
  sleep 3
  echo "=== $f ==="
  python3 "tests/$f.py" 2>&1 | tail -1
done
pkill -f 'dev-api[.]mj[s]' 2>/dev/null
sleep 1
nohup node scripts/dev-api.mjs > /tmp/dev-api.log 2>&1 &
echo "=== rating-unit ==="
node tests/rating-unit.mjs 2>&1 | tail -1
