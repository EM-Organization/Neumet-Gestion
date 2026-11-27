#!/usr/bin/env bash
# Concurrencia de la cuota del asistente (migración 20261126090000_asistente_uso.sql, docs/24 §7).
# Se carga con `source` desde tests/sql/run.sh (usa el arreglo PSQL y WORK).
# Dos sesiones reales del mismo usuario con 29 preguntas de hoy: la primera reserva y duerme dentro de su transacción
# (retiene el bloqueo por usuario); la segunda pregunta mientras tanto. Con pg_advisory_xact_lock, la segunda espera,
# cuenta 30 y se rechaza. Sin él, cuenta 29, se permite y quedan 31 filas: la prueba debe fallar.
# Datos propios (cliente 9120), confirmados y borrados al terminar.

ACU_AQ() { "${PSQL[@]}" -X -q -At -v ON_ERROR_STOP=1 "$@"; }
ACU_UID='e1200000-0000-0000-0000-00000000c0a1'
ACU_CLI=9120

acu_reset() { # un usuario con 29 preguntas ok de hoy y sin rastros
  ACU_AQ <<SQL
delete from public.asistente_uso where cliente_id = $ACU_CLI;
delete from public.perfiles where user_id = '$ACU_UID';
delete from public.clientes where id = $ACU_CLI;
insert into auth.users (id, email) values ('$ACU_UID', 'acuota@c') on conflict do nothing;
insert into public.clientes (id, nombre) values ($ACU_CLI, 'Concurrencia cuota');
insert into public.perfiles (user_id, rol, cliente_id) values ('$ACU_UID', 'cliente', $ACU_CLI);
insert into public.asistente_uso (user_id, cliente_id, dia, resultado)
  select '$ACU_UID', $ACU_CLI, (now() at time zone 'America/Montevideo')::date, 'ok' from generate_series(1, 29);
SQL
}

acu_limpiar() {
  ACU_AQ >/dev/null 2>&1 <<SQL || true
delete from public.asistente_uso where cliente_id = $ACU_CLI;
delete from public.perfiles where user_id = '$ACU_UID';
delete from public.clientes where id = $ACU_CLI;
delete from auth.users where id = '$ACU_UID';
SQL
}

acu_fallar() {
  echo "FALLO concurrencia cuota: $1" >&2
  echo "--- sesión 1:"; cat "$WORK/acu1.txt" 2>/dev/null || true
  echo "--- sesión 2:"; cat "$WORK/acu2.txt" 2>/dev/null || true
  acu_limpiar
  exit 1
}

echo "== concurrencia: dos preguntas simultáneas con 29 usadas hoy"
acu_reset
"${PSQL[@]}" -X -q -At -f - >"$WORK/acu1.txt" 2>&1 <<SQL &
begin;
select test.become('authenticated', '$ACU_UID');
select public.asistente_reservar(null);
select pg_sleep(3);
commit;
SQL
p1=$!
# La primera reserva ya está escrita (sin confirmar) y durmiendo cuando lanzamos la segunda.
for _ in $(seq 1 200); do
  [ "$(ACU_AQ -c "select count(*) from pg_stat_activity where pid <> pg_backend_pid() and state = 'active' and query like '%pg_sleep(3)%'")" -ge 1 ] && break
  sleep 0.1
done
"${PSQL[@]}" -X -q -At -f - >"$WORK/acu2.txt" 2>&1 <<SQL &
begin;
select test.become('authenticated', '$ACU_UID');
select public.asistente_reservar(null);
commit;
SQL
p2=$!
# Con el bloqueo, la segunda queda esperando a la primera; sin él, termina en milisegundos. Esperar 1,5 s cubre los dos casos.
sleep 1.5
wait "$p1" || true
wait "$p2" || true

grep -q 'ERROR' "$WORK/acu1.txt" "$WORK/acu2.txt" && acu_fallar "error en una sesión"
[ "$(cat "$WORK/acu1.txt" "$WORK/acu2.txt" | grep -c '"permitido": true')" = 1 ] || acu_fallar "solo una pregunta debía permitirse"
[ "$(cat "$WORK/acu1.txt" "$WORK/acu2.txt" | grep -c '"permitido": false')" = 1 ] || acu_fallar "la otra debía rechazarse"
grep -q '"usadas": 30' "$WORK/acu1.txt" "$WORK/acu2.txt" || acu_fallar "la rechazada debía contar 30 usadas"
[ "$(ACU_AQ -c "select count(*) from public.asistente_uso where user_id = '$ACU_UID' and resultado <> 'cuota'")" = 30 ] \
  || acu_fallar "deben quedar 30 preguntas registradas, no más"
[ "$(ACU_AQ -c "select count(*) from public.asistente_uso where user_id = '$ACU_UID' and resultado = 'cuota'")" = 1 ] \
  || acu_fallar "una sola fila de cuota"
echo "ok   - dos preguntas simultáneas con 29 usadas: una pasa y la otra se rechaza (30 registradas)"
acu_limpiar
