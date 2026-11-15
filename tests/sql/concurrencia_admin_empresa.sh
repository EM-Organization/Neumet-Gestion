#!/usr/bin/env bash
# Concurrencia de quitar y reponer acceso (docs/17 §4.1, migración 20261119000000_admin_empresa.sql).
# Se carga con `source` desde tests/sql/run.sh (usa el arreglo PSQL, WORK y los fixtures ya cargados).
# Dos sesiones reales: la primera retiene sus bloqueos con pg_sleep dentro de la transacción; la segunda se lanza cuando
# la primera ya está durmiendo y se espera (pg_stat_activity) a que quede bloqueada antes de soltar a la primera.
# Los datos son propios (cliente 9301), confirmados y se borran al terminar; no dependen del orden de los t_*.sql.

PQ() { "${PSQL[@]}" -X -q -At -v ON_ERROR_STOP=1 "$@"; }
C_UID() { printf 'b0000000-0000-0000-0000-%012d' "$1"; }
CA=$(C_UID 1); CB=$(C_UID 2); CC=$(C_UID 3)

c_reset() { # tres administradores vigentes (A, B, C) y sin rastros
  PQ <<SQL
delete from public.accesos_quitados where cliente_id = 9301;
delete from public.perfiles where cliente_id = 9301;
delete from public.clientes where id = 9301;
insert into auth.users (id, email) values ('$CA','ca@c'), ('$CB','cb@c'), ('$CC','cc@c') on conflict do nothing;
insert into public.clientes (id, nombre) overriding system value values (9301, 'Concurrencia 93');
insert into public.perfiles (user_id, rol, cliente_id, sucursal_id) values
  ('$CA','cliente',9301,null), ('$CB','cliente',9301,null), ('$CC','cliente',9301,null);
SQL
}

c_limpiar() {
  PQ <<SQL >/dev/null 2>&1 || true
delete from public.accesos_quitados where cliente_id = 9301;
delete from public.perfiles where cliente_id = 9301;
delete from public.clientes where id = 9301;
delete from auth.users where id in ('$CA','$CB','$CC');
SQL
}

c_esperar() { # c_esperar "condición SQL sobre pg_stat_activity" descripción
  local i
  for i in $(seq 1 200); do
    [ "$(PQ -c "select count(*) from pg_stat_activity where pid <> pg_backend_pid() and $1")" -ge 1 ] && return 0
    sleep 0.1
  done
  echo "FALLO concurrencia: no se alcanzó «$2»" >&2; c_limpiar; exit 1
}

# c_par «actor1» «sentencia1» «actor2» «sentencia2» «sal1» «sal2»: la sesión 1 ejecuta y duerme 3 s con sus bloqueos;
# la sesión 2 se lanza mientras duerme, queda esperando un bloqueo, y recién entonces la 1 confirma.
c_par() {
  local a1="$1" s1="$2" a2="$3" s2="$4" o1="$5" o2="$6"
  "${PSQL[@]}" -X -q -At -f - >"$o1" 2>&1 <<SQL &
begin;
select test.become('authenticated', '$a1');
$s1
select pg_sleep(2.718);
commit;
SQL
  local p1=$!
  c_esperar "state = 'active' and query like '%pg_sleep(2.718)%'" "sesión 1 durmiendo con sus bloqueos"
  "${PSQL[@]}" -X -q -At -f - >"$o2" 2>&1 <<SQL &
begin;
select test.become('authenticated', '$a2');
$s2
commit;
SQL
  local p2=$!
  c_esperar "wait_event_type = 'Lock'" "sesión 2 bloqueada esperando a la 1"
  wait "$p1" "$p2" || true
}

fallar() { echo "FALLO concurrencia: $1" >&2; echo "--- sesión 1:"; cat "$O1"; echo "--- sesión 2:"; cat "$O2"; c_limpiar; exit 1; }
O1="$WORK/c1.txt"; O2="$WORK/c2.txt"
Q() { echo "select public.usuario_empresa_quitar_acceso('$1');"; }
QR() { echo "select public.usuario_empresa_quitar_acceso('$1', $2);"; }  # reintento de la baja $2
R() { echo "select public.usuario_empresa_reponer_acceso($1);"; }
perfiles() { PQ -c "select count(*) from public.perfiles where cliente_id = 9301 and user_id = '$1'"; }

echo "== concurrencia: A quita a B mientras B quita a C"
c_reset
c_par "$CA" "$(Q "$CB")" "$CB" "$(Q "$CC")" "$O1" "$O2"
grep -q '"estado": "quitado"' "$O1" || fallar "A debía quitar a B"
grep -q 'permiso denegado' "$O2" || fallar "B, ya quitado, debía recibir permiso denegado"
[ "$(perfiles "$CC")" = 1 ] || fallar "C debía seguir vigente"
[ "$(perfiles "$CB")" = 0 ] || fallar "B debía estar quitado"
[ "$(PQ -c "select count(*) from public.accesos_quitados where cliente_id = 9301")" = 1 ] || fallar "una sola baja"
echo "ok   - el quitado no quita a un tercero con su JWT vigente"

echo "== concurrencia: dos administradores se quitan mutuamente"
c_reset
c_par "$CA" "$(Q "$CB")" "$CB" "$(Q "$CA")" "$O1" "$O2"
grep -q 'permiso denegado' "$O2" || fallar "la segunda baja debía rechazarse"
[ "$(perfiles "$CA")" = 1 ] && [ "$(perfiles "$CB")" = 0 ] || fallar "solo uno debía prosperar"
[ "$(PQ -c "select count(*) from public.perfiles where cliente_id = 9301 and sucursal_id is null")" -ge 1 ] || fallar "la empresa quedó sin administradores"
echo "ok   - solo una de dos bajas mutuas prospera"

echo "== concurrencia: dos «reponer» simultáneos"
c_reset
PQ -c "select test.become('authenticated','$CA'); select public.usuario_empresa_quitar_acceso('$CB');" >/dev/null
ID=$(PQ -c "select max(id) from public.accesos_quitados where user_id = '$CB'")
c_par "$CA" "$(R "$ID")" "$CC" "$(R "$ID")" "$O1" "$O2"
grep -q '"estado": "repuesto"' "$O1" || fallar "la primera debía reponer"
grep -q '"estado": "ya_repuesto"' "$O2" || fallar "la segunda debía responder ya_repuesto"
grep -qi 'duplicate\|23505\|ERROR' "$O1" "$O2" && fallar "sin errores de clave duplicada"
[ "$(perfiles "$CB")" = 1 ] || fallar "un solo perfil"
echo "ok   - dos reposiciones simultáneas: repuesto y ya_repuesto, un solo perfil"

echo "== concurrencia: reponer contra el reintento de la baja"
c_reset
PQ -c "select test.become('authenticated','$CA'); select public.usuario_empresa_quitar_acceso('$CB');" >/dev/null
ID=$(PQ -c "select max(id) from public.accesos_quitados where user_id = '$CB'")
c_par "$CA" "$(QR "$CB" "$ID")" "$CC" "$(R "$ID")" "$O1" "$O2"
grep -q 'ya_quitado' "$O1" || fallar "el reintento debía responder ya_quitado"
grep -q '"estado": "repuesto"' "$O2" || fallar "la reposición debía prosperar tras el reintento"
[ "$(perfiles "$CB")" = 1 ] || fallar "B debía estar repuesto"
[ "$(PQ -c "select (repuesto_at is not null)::text || (bloqueo_auth_aplicado_at is null)::text from public.accesos_quitados where id = $ID")" = "truetrue" ] \
  || fallar "marcas inconsistentes: repuesto sin aplicado"
echo "ok   - reponer tras un reintento de baja deja marcas consistentes"

echo "== concurrencia: el reintento de la baja pierde frente a «reponer» (X1)"
c_reset
PQ -c "select test.become('authenticated','$CA'); select public.usuario_empresa_quitar_acceso('$CB');" >/dev/null
ID=$(PQ -c "select max(id) from public.accesos_quitados where user_id = '$CB'")
# la sesión 1 repone y retiene el bloqueo; la 2 reintenta la baja $ID y debe esperar, luego ver el perfil y recibir 42501
c_par "$CC" "$(R "$ID")" "$CA" "$(QR "$CB" "$ID")" "$O1" "$O2"
grep -q '"estado": "repuesto"' "$O1" || fallar "la reposición debía prosperar"
grep -q 'permiso denegado' "$O2" || fallar "el reintento que pierde debía recibir 42501, no una baja nueva"
grep -q '"estado"' "$O2" && fallar "el reintento que pierde no debía responder un estado de éxito"
[ "$(perfiles "$CB")" = 1 ] || fallar "B debía seguir repuesto"
[ "$(PQ -c "select count(*) from public.accesos_quitados where user_id = '$CB'")" = 1 ] || fallar "no debía crearse una baja nueva"
echo "ok   - el reintento que pierde frente a reponer da 42501 y no vuelve a quitar"
c_limpiar
