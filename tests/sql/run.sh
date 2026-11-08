#!/usr/bin/env bash
# Pruebas SQL de las migraciones contra un Postgres local DESECHABLE.
#
# Modos (en orden de preferencia):
#   1. TEST_PG_URL definido (p. ej. servicio postgres de CI, superusuario):
#        TEST_PG_URL=postgresql://postgres:postgres@localhost:5432/postgres tests/sql/run.sh
#      Crea una base temporal "neumet_test_<pid>" y la borra al terminar.
#   2. Binarios de Postgres (PATH, Homebrew postgresql@*, /usr/lib/postgresql/*):
#      initdb + pg_ctl en un directorio temporal (socket Unix, sin red).
#   3. Docker (imagen postgres:16).
# Si no hay ninguno, sale con código 2 explicándolo. Cualquier fallo => código != 0.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SQL="$ROOT/tests/sql"
MIG="$ROOT/supabase/migrations"
WORK="$(mktemp -d "${TMPDIR:-/tmp}/neumet-sql.XXXXXX")"
CLEANUP=()
cleanup() { for c in "${CLEANUP[@]:-}"; do [ -n "$c" ] && eval "$c" || true; done; rm -rf "$WORK"; }
trap cleanup EXIT

# --- 1. Elegir backend -------------------------------------------------------
find_bin() {
  local d
  command -v initdb >/dev/null 2>&1 && { dirname "$(command -v initdb)"; return 0; }
  for d in "$(brew --prefix 2>/dev/null || true)"/opt/postgresql@*/bin /opt/homebrew/opt/postgresql@*/bin \
           /usr/local/opt/postgresql@*/bin /usr/lib/postgresql/*/bin; do
    [ -x "$d/initdb" ] && { echo "$d"; return 0; }
  done
  return 1
}

if [ -n "${TEST_PG_URL:-}" ]; then
  command -v psql >/dev/null || { echo "psql no encontrado" >&2; exit 2; }
  DB="neumet_test_$$"
  psql "$TEST_PG_URL" -v ON_ERROR_STOP=1 -qc "create database $DB"
  CLEANUP+=("psql '$TEST_PG_URL' -qc 'drop database if exists $DB' >/dev/null 2>&1")
  # Sustituye la base del URL por la temporal.
  CONN="${TEST_PG_URL%/*}/$DB"
  PSQL=(psql "$CONN")
elif BIN="$(find_bin)"; then
  export PATH="$BIN:$PATH"
  DATA="$WORK/data"; SOCK="$WORK/s"; mkdir -p "$SOCK"
  initdb -D "$DATA" -U postgres --auth=trust -E UTF8 --no-locale >/dev/null
  pg_ctl -D "$DATA" -o "-c listen_addresses='' -c unix_socket_directories='$SOCK' -c fsync=off" \
         -l "$WORK/pg.log" -w start >/dev/null
  CLEANUP+=("pg_ctl -D '$DATA' -m immediate stop >/dev/null 2>&1")
  createdb -h "$SOCK" -U postgres neumet_test
  PSQL=(psql -h "$SOCK" -U postgres neumet_test)
elif command -v docker >/dev/null 2>&1; then
  CID="$(docker run -d --rm -e POSTGRES_PASSWORD=pw -p 127.0.0.1:0:5432 postgres:16)"
  CLEANUP+=("docker stop '$CID' >/dev/null 2>&1")
  PORT="$(docker port "$CID" 5432/tcp | head -1 | sed 's/.*://')"
  export PGPASSWORD=pw
  until docker exec "$CID" pg_isready -U postgres >/dev/null 2>&1; do sleep 1; done
  sleep 2
  PSQL=(psql -h 127.0.0.1 -p "$PORT" -U postgres postgres)
else
  echo "No hay Postgres disponible: ni TEST_PG_URL, ni initdb/pg_ctl, ni docker." >&2
  echo "Los tests SQL están listos en tests/sql; instala postgresql y reintenta." >&2
  exit 2
fi

run_quiet() { # run_quiet archivo [show]: muestra las aserciones OK; ante error vuelca todo y sale != 0
  local out="$WORK/out.txt"
  if ! "${PSQL[@]}" -X -q -v ON_ERROR_STOP=1 -f "$1" >"$out" 2>&1; then
    cat "$out"; echo "FALLO en $(basename "$1")" >&2; exit 1
  fi
  if [ "${2:-}" = show ]; then grep -E 'ok   - ' "$out" | sed 's/^psql:[^ ]* *//; s/NOTICE: *//' || true; fi
}
run() { "${PSQL[@]}" -X -q -v ON_ERROR_STOP=1 "$@"; }

# --- 2. Esquema simulado + migraciones ---------------------------------------
echo "== stub de auth / roles"
run -f "$SQL/00_stub_auth.sql"
echo "== migración inicial"
run_quiet "$MIG/20261106000000_init_schema.sql"
echo "== migración de API de proveedor (trae su propio begin/commit)"
run -f "$MIG/20261106010000_api_proveedor.sql"
echo "== migración de producto (1/2)"
PGOPTIONS="-c client_min_messages=warning" run -1 -f "$MIG/20261106020000_producto_vistas.sql"
echo "== migración de producto (2/2: idempotencia)"
PGOPTIONS="-c client_min_messages=warning" run -1 -f "$MIG/20261106020000_producto_vistas.sql"
echo "== migración de rotación (1/2)"
PGOPTIONS="-c client_min_messages=warning" run -1 -f "$MIG/20261107000000_rpc_rotacion.sql"
echo "== migración de rotación (2/2: idempotencia)"
PGOPTIONS="-c client_min_messages=warning" run -1 -f "$MIG/20261107000000_rpc_rotacion.sql"
echo "== migración de cuentas api (1/2)"
PGOPTIONS="-c client_min_messages=warning" run -1 -f "$MIG/20261107010000_cuentas_api.sql"
echo "== migración de cuentas api (2/2: idempotencia)"
PGOPTIONS="-c client_min_messages=warning" run -1 -f "$MIG/20261107010000_cuentas_api.sql"
echo "== migración de sucursales (1/2)"
PGOPTIONS="-c client_min_messages=warning" run -1 -f "$MIG/20261107020000_seccionales.sql"
echo "== migración de sucursales (2/2: idempotencia)"
PGOPTIONS="-c client_min_messages=warning" run -1 -f "$MIG/20261107020000_seccionales.sql"
echo "== migración de cambio de neumático (1/2)"
PGOPTIONS="-c client_min_messages=warning" run -1 -f "$MIG/20261108000000_cambio_neumatico.sql"
echo "== migración de cambio de neumático (2/2: idempotencia)"
PGOPTIONS="-c client_min_messages=warning" run -1 -f "$MIG/20261108000000_cambio_neumatico.sql"
echo "== migración de mediciones por neumático (1/2)"
PGOPTIONS="-c client_min_messages=warning" run -1 -f "$MIG/20261109000000_mediciones_por_neumatico.sql"
echo "== migración de mediciones por neumático (2/2: idempotencia)"
PGOPTIONS="-c client_min_messages=warning" run -1 -f "$MIG/20261109000000_mediciones_por_neumatico.sql"
echo "== migración de número de quema y km previos (1/2)"
PGOPTIONS="-c client_min_messages=warning" run -1 -f "$MIG/20261110000000_numero_quema.sql"
echo "== migración de número de quema y km previos (2/2: idempotencia)"
PGOPTIONS="-c client_min_messages=warning" run -1 -f "$MIG/20261110000000_numero_quema.sql"
echo "== migración de gestión de sucursales (1/2)"
PGOPTIONS="-c client_min_messages=warning" run -1 -f "$MIG/20261110010000_gestion_sucursales.sql"
echo "== migración de gestión de sucursales (2/2: idempotencia)"
PGOPTIONS="-c client_min_messages=warning" run -1 -f "$MIG/20261110010000_gestion_sucursales.sql"
echo "== migración de últimas mediciones (1/2)"
PGOPTIONS="-c client_min_messages=warning" run -1 -f "$MIG/20261110020000_ultimas_mediciones.sql"
echo "== migración de últimas mediciones (2/2: idempotencia)"
PGOPTIONS="-c client_min_messages=warning" run -1 -f "$MIG/20261110020000_ultimas_mediciones.sql"
echo "== migración de tasa y rendimiento (1/2)"
PGOPTIONS="-c client_min_messages=warning" run -1 -f "$MIG/20261111000000_tasa_y_rendimiento.sql"
echo "== migración de tasa y rendimiento (2/2: idempotencia)"
PGOPTIONS="-c client_min_messages=warning" run -1 -f "$MIG/20261111000000_tasa_y_rendimiento.sql"
echo "== migración de motivo sin_neumaticos (1/2)"
PGOPTIONS="-c client_min_messages=warning" run -1 -f "$MIG/20261112000000_api_sin_neumaticos.sql"
echo "== migración de motivo sin_neumaticos (2/2: idempotencia)"
PGOPTIONS="-c client_min_messages=warning" run -1 -f "$MIG/20261112000000_api_sin_neumaticos.sql"
echo "== migración de stock de cubiertas (1/2)"
PGOPTIONS="-c client_min_messages=warning" run -1 -f "$MIG/20261113000000_stock_cubiertas.sql"
echo "== migración de stock de cubiertas (2/2: idempotencia)"
PGOPTIONS="-c client_min_messages=warning" run -1 -f "$MIG/20261113000000_stock_cubiertas.sql"

# --- 3. Datos y aserciones ---------------------------------------------------
echo "== fixtures"
run -f "$SQL/01_fixtures.sql"
echo "== estadísticas del planificador (una base recién cargada no las tiene)"
run -c "analyze"
echo "== seed demo sin cliente: debe fallar con mensaje claro"
if "${PSQL[@]}" -X -q -v ON_ERROR_STOP=1 -f "$ROOT/supabase/seed/demo.sql" >"$WORK/seed.txt" 2>&1; then
  echo "FALLO: el seed no debería ejecutarse sin el cliente Demo" >&2; exit 1
fi
grep -q 'No existe el cliente "Demo Transportes"' "$WORK/seed.txt" || { cat "$WORK/seed.txt"; echo "FALLO: mensaje de error inesperado" >&2; exit 1; }
for f in "$SQL"/t_*.sql; do
  echo "== $(basename "$f")"
  run_quiet "$f" show
done
echo "TODOS LOS TESTS SQL PASARON"
