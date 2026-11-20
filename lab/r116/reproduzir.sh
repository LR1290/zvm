#!/usr/bin/env bash
set -euo pipefail
if (( $# != 2 )); then
  echo "Uso: reproduzir.sh ARVORE_PR151 ARVORE_CANDIDATA" >&2
  exit 2
fi
base=$(realpath "$1")
candidate=$(realpath "$2")
cd "$(dirname "$0")"
: "${CHROMIUM_PATH:?Indique o Chromium autorizado do laboratório}"
node -e "require('playwright')"
(
  cd "$candidate"
  sha256sum --quiet --check "$OLDPWD/inventory.sha256"
)
export ZVM_LAB_SOURCE="$candidate"
node --test ../qa-auth/*.test.cjs ./*.test.cjs
node --test ../../tests/r98-v4-free-quota.test.js ../../tests/r46-78-v4-session-db-recovery.test.js
for comparison in executor-browser timeout-before-bridge switch tick-stress scope-membership membership-history membership-bench history follow-tick child-receipt sequence-checkpoint admission; do
  node "$comparison.cjs" "$base" "$candidate"
done
for scenario in controls recovery claim login-late session-stores concurrency durable-path motor-path preflight login-sla; do
  node "$scenario.cjs" "$candidate"
done
