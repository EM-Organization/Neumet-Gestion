#!/usr/bin/env bash
# Concurrencia al eliminar un vehículo (migración 20261124000000_vehiculo_eliminar.sql).
# Se carga con `source` desde tests/sql/run.sh (usa PSQL, WORK y los fixtures ya cargados).
# Dos sesiones del administrador de empresa eliminan el MISMO vehículo con destinos distintos: la primera retiene su
# transacción con pg_sleep; la segunda espera el lock del vehículo y, al confirmar la primera, debe ver `deleted_at`
# y fallar con «ya fue eliminado» (P0002) sin repetir eventos ni pisar el destino elegido por la primera.
# Datos propios (vehículo 9990 de la empresa 1), confirmados y borrados al terminar.

PQe() { "${PSQL[@]}" -X -q -At -v ON_ERROR_STOP=1 "$@"; }
E_OUT1="$WORK/e1.txt"; E_OUT2="$WORK/e2.txt"

e_limpiar() {
  PQe <<SQL >/dev/null 2>&1 || true
delete from public.eventos_neumatico where vehiculo_id = 9990;
delete from public.neumaticos where idneumatico like 'N-9990-%';
delete from public.vehiculos where id = 9990;
SQL
}
e_limpiar
PQe <<SQL
insert into public.vehiculos (id, cliente_id, nombre, patente, activo) values (9990, 1, 'Concurrencia eliminar', 'CE9990', true);
insert into public.neumaticos (vehiculo_id, cliente_id, posicion, idneumatico, estado, condicion, numero_quema) values
  (9990, 1, 1, 'N-9990-1', 'montado', 'usado', 'QCE9990-1'),
  (9990, 1, 2, 'N-9990-2', 'montado', 'usado', 'QCE9990-2');
SQL

"${PSQL[@]}" -X -q -At -f - >"$E_OUT1" 2>&1 <<SQL &
begin;
select test.become('authenticated', test.u_cli_a());
select public.vehiculo_eliminar(9990, 'stock')->>'neumaticos';
select pg_sleep(2.718);
commit;
SQL
E_P1=$!
for i in $(seq 1 200); do
  [ "$(PQe -c "select count(*) from pg_stat_activity where pid <> pg_backend_pid() and state = 'active' and query like '%pg_sleep(2.718)%'")" -ge 1 ] && break
  sleep 0.1
done
"${PSQL[@]}" -X -q -At -f - >"$E_OUT2" 2>&1 <<SQL &
begin;
select test.become('authenticated', test.u_cli_a());
select public.vehiculo_eliminar(9990, 'baja');
commit;
SQL
E_P2=$!
for i in $(seq 1 200); do
  [ "$(PQe -c "select count(*) from pg_stat_activity where pid <> pg_backend_pid() and wait_event_type = 'Lock'")" -ge 1 ] && break
  sleep 0.1
done
wait "$E_P1" "$E_P2" || true

e_fallar() { echo "FALLO concurrencia eliminar vehículo: $1" >&2; echo "--- sesión 1:"; cat "$E_OUT1"; echo "--- sesión 2:"; cat "$E_OUT2"; e_limpiar; exit 1; }
grep -q '^2$' "$E_OUT1" || e_fallar "la sesión 1 debía eliminar con 2 neumáticos"
grep -q 'el vehículo ya fue eliminado' "$E_OUT2" || e_fallar "la sesión 2 debía fallar con «ya fue eliminado»"
[ "$(PQe -c "select count(*) from public.neumaticos where idneumatico like 'N-9990-%' and estado = 'almacenado'")" = "2" ] || e_fallar "los neumáticos debían quedar en stock (destino de la sesión 1)"
[ "$(PQe -c "select count(*) from public.eventos_neumatico where vehiculo_id = 9990")" = "2" ] || e_fallar "solo debían quedar los 2 eventos de la sesión 1"
e_limpiar
echo "ok   - concurrencia: dos eliminaciones simultáneas del mismo vehículo se serializan y la segunda falla sin repetir nada"
