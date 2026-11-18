#!/usr/bin/env bash
# Concurrencia al adoptar la distribución (migración 20261122000000_distribucion_vehiculo.sql).
# Se carga con `source` desde tests/sql/run.sh (usa PSQL, WORK y los fixtures ya cargados).
# Vehículo existente sin distribución y dos sesiones con distribuciones DISTINTAS y claves distintas: la primera adopta
# y retiene su transacción con pg_sleep; la segunda queda esperando el lock de la fila y, al confirmar la primera, debe
# ver la distribución adoptada y rechazar sus lecturas (motivo distribucion), sin pisarla.
# Datos propios (cliente 9303), confirmados y borrados al terminar.

PQd() { "${PSQL[@]}" -X -q -At -v ON_ERROR_STOP=1 "$@"; }
D_CUENTA='b0000000-0000-0000-0000-0000000093a2'
D_OUT1="$WORK/d1.txt"; D_OUT2="$WORK/d2.txt"

d_limpiar() {
  PQd <<SQL >/dev/null 2>&1 || true
delete from public.api_idempotencia where cuenta = '$D_CUENTA';
delete from public.mediciones where cliente_id = 9303;
delete from public.neumaticos where cliente_id = 9303;
delete from public.vehiculos where cliente_id = 9303;
delete from public.clientes where id = 9303;
SQL
}
d_limpiar
PQd <<SQL
insert into public.clientes (id, nombre) overriding system value values (9303, 'Concurrencia Distribucion 93');
select public.api_guardar_montaje(9303, '$D_CUENTA', 'CONC9303',
  '[{"posicion":1,"mm1":9,"mm2":9,"mm3":9}]'::jsonb, gen_random_uuid(), 'dist-0', 'h0');
SQL

"${PSQL[@]}" -X -q -At -f - >"$D_OUT1" 2>&1 <<SQL &
begin;
select public.api_guardar_montaje(9303, '$D_CUENTA', 'CONC9303',
  '[{"posicion":1,"mm1":9,"mm2":9,"mm3":9}]'::jsonb, gen_random_uuid(), 'dist-1', 'h1', '6x4')->'resultados'->0->>'guardado';
select pg_sleep(2.718);
commit;
SQL
D_P1=$!
for i in $(seq 1 200); do
  [ "$(PQd -c "select count(*) from pg_stat_activity where pid <> pg_backend_pid() and state = 'active' and query like '%pg_sleep(2.718)%'")" -ge 1 ] && break
  sleep 0.1
done
"${PSQL[@]}" -X -q -At -f - >"$D_OUT2" 2>&1 <<SQL &
select public.api_guardar_montaje(9303, '$D_CUENTA', 'CONC9303',
  '[{"posicion":1,"mm1":8,"mm2":8,"mm3":8}]'::jsonb, gen_random_uuid(), 'dist-2', 'h2', '8x2');
SQL
D_P2=$!
for i in $(seq 1 200); do
  [ "$(PQd -c "select count(*) from pg_stat_activity where pid <> pg_backend_pid() and wait_event_type = 'Lock'")" -ge 1 ] && break
  sleep 0.1
done
wait "$D_P1" "$D_P2" || true

d_fallar() { echo "FALLO concurrencia distribución: $1" >&2; echo "--- sesión 1:"; cat "$D_OUT1"; echo "--- sesión 2:"; cat "$D_OUT2"; d_limpiar; exit 1; }
grep -q '^true$' "$D_OUT1" || d_fallar "la sesión 1 debía adoptar y guardar"
grep -q 'ERROR' "$D_OUT2" && d_fallar "la sesión 2 no debía fallar"
grep -q '"motivo": "distribucion"' "$D_OUT2" || d_fallar "la sesión 2 debía rechazar por distribución"
[ "$(PQd -c "select distribucion from public.vehiculos where cliente_id = 9303")" = "6x4" ] || d_fallar "la distribución adoptada debía ser 6x4"
[ "$(PQd -c "select count(*) from public.mediciones where cliente_id = 9303")" = "2" ] || d_fallar "solo debían quedar la medición del alta y la de la sesión 1"
d_limpiar
echo "ok   - concurrencia API: dos adopciones simultáneas de distinta distribución no se pisan"
