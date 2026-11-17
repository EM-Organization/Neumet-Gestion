#!/usr/bin/env bash
# npm run verificar:rapido — lo barato del CI, según lo que cambió respecto de origin/main:
#   siempre: lint (sin warnings) + check + unitarias; test:front y test:lint si cambió src/ (o la config de Vite);
#   smoke de los once modos si cambió assets/, adminpanel/ o tests/smoke/ (cada modo en su propio puerto libre).
# Lo lento (SQL, e2e, Deno, capturas) NO corre aquí: al final se lista qué corresponde según el diff. Ver neumet-verificar.
# Variables: BASE (origin/main), SIN_SMOKE=1 para omitir el smoke.
set -uo pipefail
cd "$(dirname "$0")/.."
BASE="${BASE:-origin/main}"

[ -d node_modules/.bin ] && [ -x node_modules/.bin/eslint ] || { echo "Faltan dependencias: scripts/preparar-worktree.sh"; exit 2; }
CAMBIOS=$( { git diff --name-only "$BASE"...HEAD 2>/dev/null; git diff --name-only HEAD 2>/dev/null; git ls-files --others --exclude-standard; } | sort -u)
[ -n "$CAMBIOS" ] || echo "(sin cambios respecto de $BASE: se corre lo básico)"
hay() { printf '%s\n' "$CAMBIOS" | grep -Eq "$1"; }

FALLAS=()
paso() { local nombre="$1"; shift; echo "== $nombre"; "$@" || FALLAS+=("$nombre"); }

paso "lint" npm run -s lint -- --quiet
paso "check" npm run -s check
paso "unitarias" npm test --silent
if hay '^(src/|vite\.config|package(-lock)?\.json|tests/front)'; then paso "test:front" npm run -s test:front; fi
if hay '^(src/|tests/lint/|eslint)'; then paso "test:lint" npm run -s test:lint; fi
if [ -z "${SIN_SMOKE:-}" ] && hay '^(assets/|adminpanel/|tests/smoke/|tests/lib-servidor\.sh|scripts/servir-estatico\.mjs)'; then
  paso "smoke (11 modos)" scripts/smoke-modos.sh
fi

echo "== Pendiente de correr a mano según el diff"
hay '^(supabase/migrations/|tests/sql/|supabase/seed/)' && echo "  tests/sql/run.sh"
hay '^supabase/functions/' && echo "  deno task --config supabase/functions/deno.json check|test"
hay '^(supabase/|src/|assets/|adminpanel/|tests/e2e/)' && echo "  npm run e2e (si el cambio toca la base o un flujo que la usa)"
hay '^(src/|assets/|adminpanel/)' && echo "  tests/visual/run.sh <escenas> (interfaz visible)"

if [ ${#FALLAS[@]} -gt 0 ]; then echo "FALLARON: ${FALLAS[*]}"; exit 1; fi
echo "verificar:rapido OK"
