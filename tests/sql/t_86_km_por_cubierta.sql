-- Km por cubierta (v_km_cubierta) y diagnóstico de odómetro (odometro_anomalias), hoja de ruta F2:
-- tramos cerrados y en curso, rotación sin duplicar km, cambio de vehículo (con paso por el stock), odómetros
-- faltantes -> NULL y km_confiable = false, odómetro decreciente señalado sin borrar nada, invariantes de montaje
-- (una cubierta por posición) y matriz de roles / RLS. Todo en una transacción que se revierte.
begin;

insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-0000000000c6', 'k86a@t'), ('a0000000-0000-0000-0000-0000000000c7', 'k86b@t');
insert into public.sucursales (id, cliente_id, nombre) overriding system value values
  (861, 1, 'Km Norte'), (862, 1, 'Km Sur');
insert into public.perfiles (user_id, rol, cliente_id, sucursal_id) values
  ('a0000000-0000-0000-0000-0000000000c6', 'cliente', 1, 861),
  ('a0000000-0000-0000-0000-0000000000c7', 'cliente', 1, 862);
create or replace function test.u_k86n() returns uuid language sql immutable as $$ select 'a0000000-0000-0000-0000-0000000000c6'::uuid $$;
create or replace function test.u_k86s() returns uuid language sql immutable as $$ select 'a0000000-0000-0000-0000-0000000000c7'::uuid $$;

-- Vehículos: 861 historial de A1 (sucursal Norte); 862 destino de A1 (Sur); 863 rotación; 864 datos faltantes;
-- 865 decreciente; 866 y 867 flujo completo por las RPC; 868 de otro cliente.
insert into public.vehiculos (id, cliente_id, sucursal_id, nombre, patente, activo, odometro_km) values
  (861, 1, 861, 'K861', 'KK8610', true, 15000),
  (862, 1, 862, 'K862', 'KK8620', true, 800),
  (863, 1, 861, 'K863', 'KK8630', true, 30000),
  (864, 1, 861, 'K864', 'KK8640', true, 5000),
  (865, 1, 861, 'K865', 'KK8650', true, 3000),
  (866, 1, 861, 'K866', 'KK8660', true, 1000),
  (867, 1, 861, 'K867', 'KK8670', true, 200),
  (868, 2, null, 'K868', 'KK8680', true, 300);

-- Neumático (por defecto montado en veh/pos) y evento con antigüedad en días.
create or replace function test.neu86(p_idn text, p_cli bigint, p_veh bigint, p_pos smallint, p_estado text, p_prev int default 0)
returns void language sql as $$
  insert into public.neumaticos (vehiculo_id, cliente_id, posicion, idneumatico, estado, marca, km_previos)
  values (p_veh, p_cli, p_pos, p_idn, p_estado, 'M', p_prev) $$;
create or replace function test.ev86(p_idn text, p_veh bigint, p_tipo text, p_odo int, p_dias numeric)
returns void language sql as $$
  insert into public.eventos_neumatico (cliente_id, vehiculo_id, neumatico_id, idneumatico, tipo, odometro_km, created_at)
  select n.cliente_id, p_veh, n.id, n.idneumatico, p_tipo, p_odo, now() - p_dias * interval '24 hours'
    from public.neumaticos n where n.idneumatico = p_idn $$;
create or replace function test.km86(p_idn text) returns text language sql stable as $$
  select km_previos || '|' || coalesce(km_en_vehiculos::text, 'NULL') || '|' || coalesce(km_tramo_actual::text, 'NULL') || '|'
         || coalesce(km_totales::text, 'NULL') || '|' || km_confiable
    from public.v_km_cubierta where idneumatico = p_idn $$;
grant execute on function test.neu86(text, bigint, bigint, smallint, text, int), test.ev86(text, bigint, text, int, numeric),
  test.km86(text) to public;

-- A1: montaje 861 a 10000, rotación a 12000, desmontaje a 15000; luego montaje en 862 a 500 (odómetro actual 800)
select test.neu86('K86-A1', 1, 862, 1::smallint, 'montado', 1000);
select test.ev86('K86-A1', 861, 'montaje', 10000, 30), test.ev86('K86-A1', 861, 'rotacion', 12000, 20),
       test.ev86('K86-A1', 861, 'desmontaje', 15000, 10), test.ev86('K86-A1', 862, 'montaje', 500, 5);
-- B1 y B2: montadas en 863 a 29000 (odómetro actual 30000)
select test.neu86('K86-B1', 1, 863, 1::smallint, 'montado'), test.neu86('K86-B2', 1, 863, 2::smallint, 'montado');
select test.ev86('K86-B1', 863, 'montaje', 29000, 3), test.ev86('K86-B2', 863, 'montaje', 29000, 3);
-- C: odómetros faltantes
select test.neu86('K86-C1', 1, 864, 1::smallint, 'montado'), test.neu86('K86-C2', 1, 864, 2::smallint, 'montado');
select test.ev86('K86-C1', 864, 'montaje', null, 9);                                    -- montaje sin odómetro
select test.neu86('K86-C3', 1, null, null, 'almacenado', 777);                          -- stock sin uso
select test.neu86('K86-C4', 1, null, null, 'almacenado', 50);                           -- único tramo sin odómetro
select test.ev86('K86-C4', 864, 'montaje', null, 9), test.ev86('K86-C4', 864, 'desmontaje', 100, 8);
select test.neu86('K86-C5', 1, null, null, 'almacenado', 10);                          -- un tramo con dato y otro sin
select test.ev86('K86-C5', 864, 'montaje', 500, 7), test.ev86('K86-C5', 864, 'desmontaje', 1500, 6),
       test.ev86('K86-C5', 864, 'montaje', null, 5), test.ev86('K86-C5', 864, 'desmontaje', 2000, 4);
-- D: odómetro decreciente (D2) y odómetro actual del vehículo menor al del último evento (D1)
select test.neu86('K86-D1', 1, 865, 1::smallint, 'montado'), test.neu86('K86-D2', 1, 865, 2::smallint, 'almacenado');
select test.ev86('K86-D2', 865, 'montaje', 2000, 6), test.ev86('K86-D2', 865, 'desmontaje', 1500, 5),
       test.ev86('K86-D1', 865, 'montaje', 5000, 4);
-- E1/E2: se mueven con las RPC; X1: otro cliente
select test.neu86('K86-E1', 1, 866, 1::smallint, 'montado'), test.neu86('K86-E2', 1, 867, 1::smallint, 'montado');
select test.ev86('K86-E1', 866, 'montaje', 1000, 2), test.ev86('K86-E2', 867, 'montaje', 200, 2);
select test.neu86('K86-X1', 2, 868, 1::smallint, 'montado');
select test.ev86('K86-X1', 868, 'montaje', 100, 2);
create temp table _k86 as select idneumatico idn, id from public.neumaticos where idneumatico like 'K86-%';
grant select on _k86 to public;
create temp table _ev_antes as select count(*) n from public.eventos_neumatico where idneumatico like 'K86-%';
grant select on _ev_antes to public;

-- ---------------------------------------------------------------------------------------------
-- A. Metadatos: security_invoker y permisos
-- ---------------------------------------------------------------------------------------------
select test.eq('la vista es security_invoker',
  (select coalesce('security_invoker=true' = any (reloptions), false) from pg_class where oid = 'public.v_km_cubierta'::regclass), true);
select test.eq('anon sin acceso a la vista', has_table_privilege('anon', 'public.v_km_cubierta', 'select'), false);
select test.eq('authenticated lee la vista', has_table_privilege('authenticated', 'public.v_km_cubierta', 'select'), true);
select test.eq('anon no ejecuta el diagnóstico', has_function_privilege('anon', 'public.odometro_anomalias(bigint)', 'execute'), false);
select test.eq('authenticated ejecuta el diagnóstico', has_function_privilege('authenticated', 'public.odometro_anomalias(bigint)', 'execute'), true);
select test.eq('km_tramos_cubierta: security definer con search_path vacío',
  (select prosecdef and proconfig = '{search_path=\"\"}' from pg_proc where oid = 'public.km_tramos_cubierta(bigint)'::regprocedure), true);
select test.eq('anon no ejecuta km_tramos_cubierta', has_function_privilege('anon', 'public.km_tramos_cubierta(bigint)', 'execute'), false);
select test.eq('el diagnóstico es security invoker', (select not prosecdef from pg_proc where oid = 'public.odometro_anomalias(bigint)'::regprocedure), true);

-- ---------------------------------------------------------------------------------------------
-- B. Tramos y rotación
-- ---------------------------------------------------------------------------------------------
-- previos|en_vehiculos|tramo_actual|totales|confiable
select test.eq('A1: tramo cerrado (rotación no corta) + tramo en otro vehículo', test.km86('K86-A1'), '1000|5000|300|6300|true');
select test.eq('A1: dos tramos con dato y ninguno sin dato',
  (select tramos_con_dato || '|' || tramos_sin_dato from public.v_km_cubierta where idneumatico = 'K86-A1'), '2|0');
select test.eq('B1: tramo en curso desde el montaje', test.km86('K86-B1'), '0|0|1000|1000|true');
-- Rotación real por la RPC: no abre tramo nuevo ni duplica km
select test.become('authenticated', test.u_admin());
select test.eq('rotación B1 <-> B2 (RPC)', (public.neumatico_rotar(863::bigint, 1::smallint, 2::smallint, 29500)->>'intercambio'), 'true');
reset role;
select test.eq('B1 tras rotar: mismo km, sin tramo nuevo', test.km86('K86-B1'), '0|0|1000|1000|true');
select test.eq('B2 tras rotar: mismo km, sin tramo nuevo', test.km86('K86-B2'), '0|0|1000|1000|true');
select test.eq('la rotación solo agregó eventos de rotación',
  (select count(*) from public.eventos_neumatico where idneumatico in ('K86-B1', 'K86-B2') and tipo = 'montaje'), 2::bigint);
select test.eq('la suma de km de B1 y B2 no se duplica',
  (select sum(km_totales) from public.v_km_cubierta where idneumatico in ('K86-B1', 'K86-B2')), 2000::numeric);
-- Odómetro actual que no avanza: el tramo en curso es 0 (con dato), no NULL
update public.vehiculos set odometro_km = 29000 where id = 863;
select test.eq('odómetro igual al del montaje: tramo 0 con dato', test.km86('K86-B1'), '0|0|0|0|true');
update public.vehiculos set odometro_km = 30000 where id = 863;

-- ---------------------------------------------------------------------------------------------
-- C. Datos faltantes: NULL y km_confiable = false (nunca 0)
-- ---------------------------------------------------------------------------------------------
select test.eq('C1: montaje sin odómetro -> tramo actual y total NULL', test.km86('K86-C1'), '0|0|NULL|NULL|false');
select test.eq('C2: montada sin ningún evento -> NULL', test.km86('K86-C2'), '0|0|NULL|NULL|false');
select test.eq('C3: stock sin uso -> 0 km en vehículos, total = km previos, confiable', test.km86('K86-C3'), '777|0|NULL|777|true');
select test.eq('C4: único tramo sin odómetro -> NULL (no 0)', test.km86('K86-C4'), '50|NULL|NULL|NULL|false');
select test.eq('C5: un tramo con dato y otro sin: suma lo conocido y no es confiable', test.km86('K86-C5'), '10|1000|NULL|1010|false');
select test.eq('C5: cuenta tramos con y sin dato',
  (select tramos_con_dato || '|' || tramos_sin_dato from public.v_km_cubierta where idneumatico = 'K86-C5'), '1|1');
update public.vehiculos set odometro_km = null where id = 864;
select test.eq('C1: vehículo sin odómetro tampoco inventa km', test.km86('K86-C1'), '0|0|NULL|NULL|false');
update public.vehiculos set odometro_km = 5000 where id = 864;

-- ---------------------------------------------------------------------------------------------
-- D. Odómetro decreciente: señalado, no borrado
-- ---------------------------------------------------------------------------------------------
select test.eq('D2: desmontaje con odómetro menor -> tramo sin dato, no confiable', test.km86('K86-D2'), '0|NULL|NULL|NULL|false');
select test.eq('D2: marcado como anómalo', (select odometro_anomalo from public.v_km_cubierta where idneumatico = 'K86-D2'), true);
select test.eq('D1: odómetro actual menor al del montaje -> tramo 0 y no confiable', test.km86('K86-D1'), '0|0|0|0|false');
select test.eq('D1: marcado como anómalo', (select odometro_anomalo from public.v_km_cubierta where idneumatico = 'K86-D1'), true);
select test.eq('A1 sin anomalías', (select odometro_anomalo from public.v_km_cubierta where idneumatico = 'K86-A1'), false);
select test.become('authenticated', test.u_admin());
select test.eq('odometro_anomalias(865): decreciente y actual menor',
  (select string_agg(anomalia || ':' || odometro_km || '<' || odometro_previo_km, ',' order by fecha, evento_id nulls last)
     from public.odometro_anomalias(865)), 'decreciente:1500<2000,actual_menor_que_evento:3000<5000');
select test.eq('odometro_anomalias(865) identifica el neumático y el evento',
  (select neumatico_id = (select id from public.neumaticos where idneumatico = 'K86-D2') and tipo_evento = 'desmontaje' and evento_previo_id is not null
     from public.odometro_anomalias(865) where anomalia = 'decreciente'), true);
select test.eq('odometro_anomalias(863): serie creciente, sin anomalías', (select count(*) from public.odometro_anomalias(863)), 0::bigint);
select test.eq('odometro_anomalias(861): sin anomalías', (select count(*) from public.odometro_anomalias(861)), 0::bigint);
select test.eq('vehículo inexistente: cero filas', (select count(*) from public.odometro_anomalias(99999)), 0::bigint);
select test.eq('argumento null no devuelve filas', (select count(*) from public.odometro_anomalias(null)), 0::bigint);
reset role;
-- Un odómetro negativo no puede existir en la base (CHECK): no hay nada que borrar ni corregir
select test.denied('evento con odómetro negativo', $$insert into public.eventos_neumatico (cliente_id, vehiculo_id, tipo, odometro_km) values (1, 865, 'inspeccion', -5)$$, '23514');
select test.eq('el diagnóstico no borró eventos', (select count(*) from public.eventos_neumatico where idneumatico like 'K86-%'), (select n + 2 from pg_temp._ev_antes));  -- +2: los eventos de la rotación de B1 y B2

-- ---------------------------------------------------------------------------------------------
-- E. Cambio de vehículo con paso por el stock (RPC neumatico_cambiar)
-- ---------------------------------------------------------------------------------------------
select test.become('authenticated', test.u_admin());
-- E1 sale de 866 a 1500 km y vuelve al stock; el nuevo neumático ocupa la posición
select test.eq('E1 vuelve al stock',
  (public.neumatico_cambiar(866::bigint, 1::smallint, 'almacenado', null, 1500, null, '{"marca":"Nueva"}'::jsonb, null, 0, null, true, 861::bigint, 'K86-E1Q')->>'neumatico_viejo_en_stock'), 'true');
reset role;
select test.eq('E1 en stock: 500 km del primer vehículo, sin tramo actual', test.km86('K86-E1'), '0|500|NULL|500|true');
-- E1 se monta en 867 (odómetro 200) a 250 km
select test.become('authenticated', test.u_admin());
select public.neumatico_cambiar(867::bigint, 1::smallint, 'baja', 'Desgaste', 250, null, null, null, 0,
  (select id from public.neumaticos where idneumatico = 'K86-E1'));
reset role;
select test.eq('E1 en otro vehículo: tramo previo cerrado + tramo nuevo desde 250 (sin comparar odómetros entre vehículos)',
  test.km86('K86-E1'), '0|500|0|500|true');
select test.eq('E2 dado de baja: tramo cerrado 250 - 200', test.km86('K86-E2'), '0|50|NULL|50|true');
select test.become('authenticated', test.u_admin());
select public.vehiculo_registrar_odometro(867::bigint, 400);
reset role;
select test.eq('E1 tras avanzar el vehículo destino', test.km86('K86-E1'), '0|500|150|650|true');
-- La RPC sigue rechazando un odómetro menor al actual
select test.become('authenticated', test.u_admin());
select test.denied('cambio con odómetro menor al actual', $$select public.neumatico_cambiar(867::bigint, 1::smallint, 'baja', 'x', 100, null, '{"marca":"Z"}'::jsonb)$$, '23514');
reset role;
select test.eq('el rechazo no dejó eventos ni cambió el tramo', test.km86('K86-E1'), '0|500|150|650|true');

-- ---------------------------------------------------------------------------------------------
-- F. Invariantes de montaje: una cubierta por posición, una posición por cubierta
-- ---------------------------------------------------------------------------------------------
select test.eq('unique (vehiculo_id, posicion) existe',
  (select count(*) from pg_constraint where conrelid = 'public.neumaticos'::regclass and contype = 'u'
      and pg_get_constraintdef(oid) = 'UNIQUE (vehiculo_id, posicion)'), 1::bigint);
select test.denied('dos neumáticos en la misma posición', $$insert into public.neumaticos (vehiculo_id, cliente_id, posicion, idneumatico, estado) values (863, 1, 1, 'K86-DUP', 'montado')$$, '23505');
select test.denied('dos neumáticos de auxilio en el mismo vehículo', $$insert into public.neumaticos (vehiculo_id, cliente_id, posicion, idneumatico, estado, auxilio) values (864, 1, 98, 'K86-AX1', 'montado', true), (864, 1, 97, 'K86-AX2', 'montado', true)$$, '23505');
select test.denied('con vehículo y sin posición', $$insert into public.neumaticos (vehiculo_id, cliente_id, posicion, idneumatico, estado) values (864, 1, null, 'K86-NP', 'montado')$$, '23514');
select test.denied('mover una cubierta a una posición ocupada', $$update public.neumaticos set posicion = 2 where idneumatico = 'K86-C1'$$, '23505');
select test.eq('cada cubierta ocupa a lo sumo una posición activa',
  (select count(*) from (select id from public.neumaticos where estado = 'montado' and vehiculo_id is not null group by id having count(*) > 1) x), 0::bigint);

-- ---------------------------------------------------------------------------------------------
-- G. Matriz de roles y RLS
-- ---------------------------------------------------------------------------------------------
select test.become('authenticated', test.u_admin());
select test.eq('admin ve todas', (select count(*) from public.v_km_cubierta where idneumatico like 'K86-%'), 13::bigint);
reset role;
select test.become('authenticated', test.u_cli_a());
select test.eq('cliente global A ve las de su cliente (montadas y en stock)',
  (select count(*) from public.v_km_cubierta where idneumatico like 'K86-%'), 12::bigint);
select test.eq('cliente global A no ve la de otro cliente', (select count(*) from public.v_km_cubierta where idneumatico = 'K86-X1'), 0::bigint);
select test.eq('cliente global A ve los km exactos de A1', test.km86('K86-A1'), '1000|5000|300|6300|true');
select test.eq('cliente global A: km_tramos_cubierta de su cubierta en stock', (select km_cerrados from public.km_tramos_cubierta((select id from pg_temp._k86 where idn = 'K86-C5'))), 1000::bigint);
select test.eq('cliente global A ve el diagnóstico de su vehículo', (select count(*) from public.odometro_anomalias(865)), 2::bigint);
reset role;
select test.become('authenticated', test.u_cli_b());
select test.eq('otro cliente ve solo lo suyo', (select string_agg(idneumatico, ',') from public.v_km_cubierta where idneumatico like 'K86-%'), 'K86-X1');
select test.eq('otro cliente: km de lo suyo', test.km86('K86-X1'), '0|0|200|200|true');
select test.eq('otro cliente no ve el diagnóstico de un vehículo ajeno', (select count(*) from public.odometro_anomalias(865)), 0::bigint);
select test.eq('otro cliente: km_tramos_cubierta de una cubierta ajena no devuelve filas (ni una de ceros)',
  (select count(*) from public.km_tramos_cubierta((select id from pg_temp._k86 where idn = 'K86-A1'))), 0::bigint);
reset role;
select test.become('authenticated', test.u_k86n());
select test.eq('sucursal Norte solo ve neumáticos de vehículos de su sucursal (sin stock ni otras sucursales)',
  (select string_agg(idneumatico, ',' order by idneumatico) from public.v_km_cubierta where idneumatico like 'K86-%'),
  'K86-B1,K86-B2,K86-C1,K86-C2,K86-D1,K86-D2,K86-E1,K86-E2');
select test.eq('sucursal Norte: no ve A1 (montada en Sur)', (select count(*) from public.v_km_cubierta where idneumatico = 'K86-A1'), 0::bigint);
select test.eq('sucursal Norte: km_tramos_cubierta de A1 (Sur) no devuelve filas', (select count(*) from public.km_tramos_cubierta((select id from pg_temp._k86 where idn = 'K86-A1'))), 0::bigint);
select test.eq('sucursal Norte: ve el diagnóstico de su vehículo', (select count(*) from public.odometro_anomalias(865)), 2::bigint);
select test.eq('sucursal Norte: no ve el diagnóstico de un vehículo de Sur', (select count(*) from public.odometro_anomalias(862)), 0::bigint);
reset role;
select test.become('authenticated', test.u_k86s());
select test.eq('sucursal Sur solo ve la montada en su vehículo', (select string_agg(idneumatico, ',') from public.v_km_cubierta where idneumatico like 'K86-%'), 'K86-A1');
select test.eq('sucursal Sur ve los km completos de A1 aunque el tramo de Norte esté fuera de su RLS',
  test.km86('K86-A1'), '1000|5000|300|6300|true');
select test.eq('sucursal Sur no ve los eventos de Norte (la RLS sigue igual)',
  (select count(*) from public.eventos_neumatico where idneumatico = 'K86-A1'), 1::bigint);
select test.eq('sucursal Sur no ve el diagnóstico de Norte', (select count(*) from public.odometro_anomalias(865)), 0::bigint);
select test.eq('sucursal Sur: km_tramos_cubierta de una cubierta de Norte no devuelve filas',
  (select count(*) from public.km_tramos_cubierta((select id from pg_temp._k86 where idn = 'K86-B1'))), 0::bigint);
reset role;
select test.become('authenticated', test.u_api());
select test.eq('rol api no ve nada', (select count(*) from public.v_km_cubierta), 0::bigint);
select test.eq('rol api: diagnóstico vacío', (select count(*) from public.odometro_anomalias(865)), 0::bigint);
select test.eq('rol api: km_tramos_cubierta vacío', (select count(*) from public.km_tramos_cubierta((select id from pg_temp._k86 where idn = 'K86-A1'))), 0::bigint);
reset role;
select test.become('authenticated', test.u_sinperfil());
select test.eq('sin perfil no ve nada', (select count(*) from public.v_km_cubierta), 0::bigint);
reset role;
select test.become('anon', null);
select test.denied('anon no lee la vista', $$select count(*) from public.v_km_cubierta$$);
select test.denied('anon no ejecuta el diagnóstico', $$select * from public.odometro_anomalias(865)$$);
select test.denied('anon no ejecuta km_tramos_cubierta', $$select * from public.km_tramos_cubierta(1)$$);
reset role;

rollback;
