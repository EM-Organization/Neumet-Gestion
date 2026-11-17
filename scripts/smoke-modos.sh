#!/usr/bin/env bash
# Corre el smoke de varios modos y resume. Uso: scripts/smoke-modos.sh [modo ...]   (sin argumentos: los once modos de CLAUDE.md)
# Cada modo levanta su propio servidor en un puerto libre, así que varias instancias (varios agentes) no chocan.
set -uo pipefail
cd "$(dirname "$0")/.."
MODOS=("$@"); [ ${#MODOS[@]} -gt 0 ] || MODOS=(admin cliente secuser detalle flota sinperfil api montar empresa empresa-sucursal empresa-admin)
ok=0; mal=0
for m in "${MODOS[@]}"; do
  if tests/smoke/run.sh "$m" >"${TMPDIR:-/tmp}/smoke-$$-$m.log" 2>&1; then ok=$((ok+1)); echo "ok    smoke $m"
  else mal=$((mal+1)); echo "FALLA smoke $m"; head -c 1500 "${TMPDIR:-/tmp}/smoke-$$-$m.log" | grep -E 'SMOKE|FAIL' | head -3; fi
  rm -f "${TMPDIR:-/tmp}/smoke-$$-$m.log"
done
echo "smoke: $ok ok, $mal con fallas"
[ "$mal" -eq 0 ]
