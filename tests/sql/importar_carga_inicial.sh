#!/usr/bin/env bash
# Carga inicial del listado de un cliente (supabase/seed/importar-carga-inicial.mjs) contra el Postgres desechable.
# Se carga con `source` desde tests/sql/run.sh (usa PSQL, DB_URL, ROOT y WORK, con los fixtures ya cargados).
# Listado SINTÉTICO; el cliente 1 de los fixtures se llama «Cliente A». Comprueba: dry-run sin escribir, falla limpia con la
# restricción actual (baja sin vehículo), carga con --descarte omitir, idempotencia, carga completa con la restricción
# relajada, visibilidad por RLS para el administrador de empresa y el perfil de la sucursal de la carga, y que otra
# sucursal y el cliente 2 no ven nada. Todo se borra al terminar.

IC_PSQL() { "${PSQL[@]}" -X -q -At -v ON_ERROR_STOP=1 "$@"; }
IC_CLI() { NEUMET_DB_URL="$DB_URL" node "$ROOT/supabase/seed/importar-carga-inicial.mjs" --archivo "$WORK/listado.xlsx" \
  --nombre-cliente 'Cliente A' --cliente-id 1 --sucursal-id 9981 --fecha-carga 2026-11-20 "$@"; }
ic_falla() { echo "FALLO (importar carga inicial): $1" >&2; exit 1; }
ic_cuenta() { printf '%s\n' "$1" | IC_PSQL | grep -E '^[0-9]+$' | tail -1; } # devuelve un entero (la última línea numérica)
ic_igual() { [ "$(ic_cuenta "$2")" = "$3" ] || ic_falla "$1: esperaba $3 y hubo $(ic_cuenta "$2")"; echo "  ok   - $1"; }

ic_limpiar() {
  IC_PSQL <<'SQL' >/dev/null 2>&1 || true
delete from public.eventos_neumatico where cliente_id = 1 and notas like 'Carga inicial Excel%';
delete from public.neumaticos where cliente_id = 1 and idneumatico like 'CI-1-%';
delete from public.vehiculos where cliente_id = 1 and notas like 'Carga inicial Excel%';
delete from public.perfiles where user_id in ('a0000000-0000-0000-0000-0000000000d1', 'a0000000-0000-0000-0000-0000000000d2');
delete from auth.users where id in ('a0000000-0000-0000-0000-0000000000d1', 'a0000000-0000-0000-0000-0000000000d2');
delete from public.sucursales where id in (9981, 9982);
drop function if exists test.u_ic_suc();
drop function if exists test.u_ic_otra();
SQL
}
ic_limpiar
echo "== carga inicial del listado de un cliente (listado sintético)"
node "$ROOT/tests/unit/helpers/generar-listado.mjs" "$WORK/listado.xlsx"
IC_PSQL -c "insert into public.sucursales (id, cliente_id, nombre) overriding system value values (9981, 1, 'Carga sucursal'), (9982, 1, 'Otra sucursal');
  insert into auth.users (id, email) values ('a0000000-0000-0000-0000-0000000000d1', 'ic-suc@t'), ('a0000000-0000-0000-0000-0000000000d2', 'ic-otra@t');
  insert into public.perfiles (user_id, rol, cliente_id, sucursal_id) values
    ('a0000000-0000-0000-0000-0000000000d1', 'cliente', 1, 9981), ('a0000000-0000-0000-0000-0000000000d2', 'cliente', 1, 9982);
  create or replace function test.u_ic_suc() returns uuid language sql immutable as \$\$ select 'a0000000-0000-0000-0000-0000000000d1'::uuid \$\$;
  create or replace function test.u_ic_otra() returns uuid language sql immutable as \$\$ select 'a0000000-0000-0000-0000-0000000000d2'::uuid \$\$;
  grant execute on function test.u_ic_suc(), test.u_ic_otra() to public"
CK_ORIG="$(IC_PSQL -c "select pg_get_constraintdef(oid) from pg_constraint where conname = 'neumaticos_stock_ck' and conrelid = 'public.neumaticos'::regclass")"

# 1. Dry-run: informa y no escribe.
IC_CLI >"$WORK/ic_dry.txt" 2>&1 || { cat "$WORK/ic_dry.txt"; ic_falla "el dry-run falló"; }
grep -q 'Vehículos a cargar: 3' "$WORK/ic_dry.txt" || { cat "$WORK/ic_dry.txt"; ic_falla "el dry-run no cuenta 3 vehículos"; }
grep -q 'Dry-run: no se escribió nada' "$WORK/ic_dry.txt" || ic_falla "el dry-run no lo dice"
grep -q 'Montados sin km del tramo actual: 21' "$WORK/ic_dry.txt" || { cat "$WORK/ic_dry.txt"; ic_falla "el dry-run no avisa de los montados sin km del tramo"; }
ic_igual "dry-run no escribe vehículos" "select count(*) from public.vehiculos where notas like 'Carga inicial Excel%'" 0
ic_igual "dry-run no escribe neumáticos" "select count(*) from public.neumaticos where idneumatico like 'CI-1-%'" 0

# 2. Cliente con otro nombre: no escribe.
if IC_CLI --nombre-cliente 'Otra empresa' --ejecutar >"$WORK/ic_nom.txt" 2>&1; then ic_falla "debía rechazar un nombre de cliente distinto"; fi
ic_igual "nombre de cliente distinto: no escribe" "select count(*) from public.neumaticos where idneumatico like 'CI-1-%'" 0

# 3. Con la restricción actual (baja sin vehículo prohibida) falla limpio y no deja nada a medias.
if IC_CLI --ejecutar >"$WORK/ic_ck.txt" 2>&1; then ic_falla "debía negarse: la base no admite bajas sin vehículo"; fi
grep -q 'no admite neumáticos en baja sin vehículo' "$WORK/ic_ck.txt" || { cat "$WORK/ic_ck.txt"; ic_falla "mensaje de la restricción inesperado"; }
ic_igual "restricción actual: no escribe nada" "select count(*) from public.neumaticos where idneumatico like 'CI-1-%'" 0

# 4. --descarte omitir: carga todo salvo las bajas.
IC_CLI --descarte omitir --ejecutar >"$WORK/ic_om.txt" 2>&1 || { cat "$WORK/ic_om.txt"; ic_falla "la carga con --descarte omitir falló"; }
ic_igual "vehículos cargados" "select count(*) from public.vehiculos where cliente_id = 1 and notas like 'Carga inicial Excel%'" 3
ic_igual "neumáticos montados" "select count(*) from public.neumaticos where idneumatico like 'CI-1-%' and estado = 'montado'" 21
ic_igual "auxilios en posición 99" "select count(*) from public.neumaticos where idneumatico like 'CI-1-%' and auxilio and posicion = 99" 2
ic_igual "stock en la sucursal, sin vehículo ni posición" "select count(*) from public.neumaticos where idneumatico like 'CI-1-%' and estado = 'almacenado' and sucursal_id = 9981 and vehiculo_id is null and posicion is null" 4
ic_igual "ninguna baja con --descarte omitir" "select count(*) from public.neumaticos where idneumatico like 'CI-1-%' and estado = 'baja'" 0
ic_igual "ningún montado quedó como nuevo" "select count(*) from public.neumaticos where idneumatico like 'CI-1-%' and estado = 'montado' and condicion = 'nuevo'" 0
ic_igual "el código repetido quedó sin código" "select count(*) from public.neumaticos where idneumatico like 'CI-1-%' and codigo is null" 1
ic_igual "un evento por cubierta" "select count(*) from public.eventos_neumatico where cliente_id = 1 and notas like 'Carga inicial Excel%'" 25
ic_igual "fecha de montaje en el evento" "select count(*) from public.eventos_neumatico where cliente_id = 1 and tipo = 'montaje' and created_at::date = date '2026-03-15'" 21
ic_igual "número de quema vacío" "select count(*) from public.neumaticos where idneumatico like 'CI-1-%' and numero_quema is not null" 0

# 5. Idempotencia: repetirla no duplica nada.
IC_CLI --descarte omitir --ejecutar >"$WORK/ic_re.txt" 2>&1 || { cat "$WORK/ic_re.txt"; ic_falla "la segunda ejecución falló"; }
ic_igual "reejecutar: mismos vehículos" "select count(*) from public.vehiculos where cliente_id = 1 and notas like 'Carga inicial Excel%'" 3
ic_igual "reejecutar: mismos neumáticos" "select count(*) from public.neumaticos where idneumatico like 'CI-1-%'" 25
ic_igual "reejecutar: mismos eventos" "select count(*) from public.eventos_neumatico where cliente_id = 1 and notas like 'Carga inicial Excel%'" 25

# 6. Visibilidad por RLS: el administrador de empresa (cliente 1) ve la carga; el cliente 2 no ve nada de ella.
ic_igual "administrador de empresa ve los vehículos" "begin; select test.become('authenticated', test.u_cli_a()); select count(*) from public.vehiculos where notas like 'Carga inicial Excel%'; rollback;" 3
ic_igual "administrador de empresa ve los neumáticos" "begin; select test.become('authenticated', test.u_cli_a()); select count(*) from public.neumaticos where idneumatico like 'CI-1-%'; rollback;" 25
ic_igual "perfil de sucursal de la carga ve los vehículos" "begin; select test.become('authenticated', test.u_ic_suc()); select count(*) from public.vehiculos where notas like 'Carga inicial Excel%'; rollback;" 3
# El stock sin vehículo es del perfil global (neumaticos_stock_cliente_select): la sucursal ve solo los montados de sus vehículos.
ic_igual "perfil de sucursal de la carga ve los neumáticos montados" "begin; select test.become('authenticated', test.u_ic_suc()); select count(*) from public.neumaticos where idneumatico like 'CI-1-%' and estado = 'montado'; rollback;" 21
ic_igual "perfil de sucursal no ve el stock sin vehículo (política vigente)" "begin; select test.become('authenticated', test.u_ic_suc()); select count(*) from public.neumaticos where idneumatico like 'CI-1-%' and estado = 'almacenado'; rollback;" 0
ic_igual "perfil de otra sucursal del mismo cliente no ve vehículos de la carga" "begin; select test.become('authenticated', test.u_ic_otra()); select count(*) from public.vehiculos where notas like 'Carga inicial Excel%'; rollback;" 0
ic_igual "perfil de otra sucursal no ve montados ni stock de la carga" "begin; select test.become('authenticated', test.u_ic_otra()); select count(*) from public.neumaticos where idneumatico like 'CI-1-%'; rollback;" 0
ic_igual "otro cliente no ve la carga" "begin; select test.become('authenticated', test.u_cli_b()); select count(*) from public.neumaticos where idneumatico like 'CI-1-%'; rollback;" 0

# 7. Con la restricción relajada (lo que haría la migración futura) las bajas también entran, una vez.
IC_PSQL -c "alter table public.neumaticos drop constraint neumaticos_stock_ck;
  alter table public.neumaticos add constraint neumaticos_stock_ck check (
    ((vehiculo_id is null) = (posicion is null)) and (vehiculo_id is not null or (estado in ('almacenado','baja') and not auxilio))
    and (sucursal_id is null or vehiculo_id is null) and (condicion <> 'nuevo' or vehiculo_id is null))"
IC_CLI --ejecutar >"$WORK/ic_baja.txt" 2>&1 || { cat "$WORK/ic_baja.txt"; ic_falla "la carga con bajas falló con la restricción relajada"; }
ic_igual "bajas cargadas" "select count(*) from public.neumaticos where idneumatico like 'CI-1-%' and estado = 'baja' and motivo_baja = 'Descarte (carga inicial)' and fecha_baja = date '2026-11-20' and vehiculo_id is null" 2
ic_igual "las bajas dicen su depósito" "select count(*) from public.neumaticos where idneumatico like 'CI-1-%' and estado = 'baja' and notas like '%Depósito: DESCARTE%'" 2
ic_igual "lo ya cargado no se duplicó" "select count(*) from public.neumaticos where idneumatico like 'CI-1-%'" 27
IC_CLI --ejecutar >/dev/null 2>&1 || ic_falla "la reejecución con bajas falló"
ic_igual "reejecutar con bajas: sin duplicados" "select count(*) from public.neumaticos where idneumatico like 'CI-1-%'" 27
ic_igual "reejecutar con bajas: eventos" "select count(*) from public.eventos_neumatico where cliente_id = 1 and notas like 'Carga inicial Excel%'" 27

# Restablece la restricción original y limpia.
IC_PSQL -c "delete from public.eventos_neumatico where cliente_id = 1 and notas like 'Carga inicial Excel%'; delete from public.neumaticos where idneumatico like 'CI-1-%' and estado = 'baja'"
IC_PSQL -c "alter table public.neumaticos drop constraint neumaticos_stock_ck; alter table public.neumaticos add constraint neumaticos_stock_ck $CK_ORIG"
ic_limpiar
ic_igual "limpieza: sin neumáticos de la carga" "select count(*) from public.neumaticos where idneumatico like 'CI-1-%'" 0
