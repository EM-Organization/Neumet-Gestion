#!/usr/bin/env bash
# Concurrencia del alta de vehículo por la API (migración 20261121000000_api_crea_vehiculo.sql).
# Se carga con `source` desde tests/sql/run.sh (usa el arreglo PSQL, WORK y los fixtures ya cargados).
# Dos sesiones reales con la MISMA patente nueva y claves de idempotencia distintas: la primera crea el coche y retiene
# su transacción con pg_sleep; la segunda se lanza mientras duerme, queda esperando el lock de alta y, al confirmar la
# primera, debe ver el coche ya creado (no crear un segundo ni fallar con 23505).
# Datos propios (cliente 9302), confirmados y borrados al terminar.

PQa() { "${PSQL[@]}" -X -q -At -v ON_ERROR_STOP=1 "$@"; }
CUENTA='b0000000-0000-0000-0000-0000000093a1'
A_OUT1="$WORK/a1.txt"; A_OUT2="$WORK/a2.txt"

a_limpiar() {
  PQa <<SQL >/dev/null 2>&1 || true
delete from public.api_idempotencia where cuenta = '$CUENTA';
delete from public.mediciones where cliente_id = 9302;
delete from public.neumaticos where cliente_id = 9302;
delete from public.vehiculos where cliente_id = 9302;
delete from public.clientes where id = 9302;
SQL
}
a_limpiar
PQa <<SQL
insert into public.clientes (id, nombre) overriding system value values (9302, 'Concurrencia API 93');
SQL

"${PSQL[@]}" -X -q -At -f - >"$A_OUT1" 2>&1 <<SQL &
begin;
select public.api_guardar_montaje(9302, '$CUENTA', 'CONC9302',
  '[{"posicion":1,"mm1":9,"mm2":9,"mm3":9}]'::jsonb, gen_random_uuid(), 'conc-1', 'h1')->>'creado';
select pg_sleep(2.718);
commit;
SQL
A_P1=$!
for i in $(seq 1 200); do
  [ "$(PQa -c "select count(*) from pg_stat_activity where pid <> pg_backend_pid() and state = 'active' and query like '%pg_sleep(2.718)%'")" -ge 1 ] && break
  sleep 0.1
done
"${PSQL[@]}" -X -q -At -f - >"$A_OUT2" 2>&1 <<SQL &
select public.api_guardar_montaje(9302, '$CUENTA', 'CONC9302',
  '[{"posicion":1,"mm1":8,"mm2":8,"mm3":8},{"posicion":2,"mm1":8,"mm2":8,"mm3":8}]'::jsonb, gen_random_uuid(), 'conc-2', 'h2');
SQL
A_P2=$!
for i in $(seq 1 200); do
  [ "$(PQa -c "select count(*) from pg_stat_activity where pid <> pg_backend_pid() and wait_event_type = 'Lock'")" -ge 1 ] && break
  sleep 0.1
done
wait "$A_P1" "$A_P2" || true

a_fallar() { echo "FALLO concurrencia API: $1" >&2; echo "--- sesión 1:"; cat "$A_OUT1"; echo "--- sesión 2:"; cat "$A_OUT2"; a_limpiar; exit 1; }
[ "$(PQa -c "select count(*) from public.vehiculos where cliente_id = 9302 and patente_norm = 'CONC9302'")" = "1" ] \
  || a_fallar "debe existir exactamente un vehículo"
grep -q '^true$' "$A_OUT1" || a_fallar "la sesión 1 debía crear el vehículo"
grep -q '23505\|ERROR' "$A_OUT2" && a_fallar "la sesión 2 no debía fallar"
# La sesión 2 ve el coche ya creado: la posición 1 existe (se guarda) y la 2 no (posicion); no hay alta.
grep -q '"creado"' "$A_OUT2" && a_fallar "la sesión 2 no debía crear otro vehículo"
grep -q '"motivo": "posicion"' "$A_OUT2" || a_fallar "la sesión 2 debía informar la posición 2 como inexistente"
[ "$(PQa -c "select count(*) from public.neumaticos where cliente_id = 9302")" = "1" ] || a_fallar "debe existir un solo neumático"
a_limpiar
echo "ok   - concurrencia API: dos altas simultáneas de la misma patente crean un solo vehículo"
