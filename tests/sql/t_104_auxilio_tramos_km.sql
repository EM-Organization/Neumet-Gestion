-- Auxilio (posición 99) y tramos de km (RN-13, G-13, CA-13, sección 4.5). Migración 20261126010000_auxilio_tramos_km.sql.
-- Un tramo de km se corta al entrar a la 99 y se abre otro al salir a una posición de ruta (1..98). Montaje directo en
-- la 99 no abre tramo; desmontaje desde la 99 no cuenta km. Odómetro ausente: tramo sin dato, nunca cero ni estimado.
-- Un solo auxilio por vehículo. Frecuencia: la 99 no figura como sin medir. Todo en una transacción que se revierte.
begin;

insert into auth.users (id, email) values ('a0000000-0000-0000-0000-0000000000d4', 'k104s@t');
insert into public.sucursales (id, cliente_id, nombre) overriding system value values (1041, 1, 'Aux Sur');
insert into public.perfiles (user_id, rol, cliente_id, sucursal_id) values
  ('a0000000-0000-0000-0000-0000000000d4', 'cliente', 1, 1041);
create or replace function test.u_k104s() returns uuid language sql immutable as $$ select 'a0000000-0000-0000-0000-0000000000d4'::uuid $$;
grant execute on function test.u_k104s() to public;

-- Vehículos: 10401 CA-13; 10402 montaje directo en 99; 10403 segundo auxilio; 10404 y 10410 frecuencia; 10405 a 10408 odómetro
-- ausente; 10409 rotación con intercambio (sucursal 1041); 10411 de otro cliente.
insert into public.vehiculos (id, cliente_id, sucursal_id, nombre, patente, activo, odometro_km) values
  (10401, 1, null, 'K104 A', 'K104A1', true, 100000),
  (10402, 1, null, 'K104 B', 'K104B1', true, 60000),
  (10403, 1, null, 'K104 C', 'K104C1', true, 1000),
  (10404, 1, null, 'K104 D', 'K104D1', true, 1000),
  (10405, 1, null, 'K104 E1', 'K104E1', true, 3000),
  (10406, 1, null, 'K104 E2', 'K104E2', true, 1500),
  (10407, 1, null, 'K104 E3', 'K104E3', true, 3000),
  (10408, 1, null, 'K104 E4', 'K104E4', true, 2000),
  (10409, 1, 1041, 'K104 F', 'K104F1', true, 1000),
  (10410, 1, null, 'K104 D3', 'K104D3', true, 1000),
  (10411, 2, null, 'K104 G', 'K104G1', true, 200);

-- Helpers. Los eventos llevan fecha explícita (2020 + minutos) para fijar el orden; las RPC usan now(), posterior.
create or replace function test.n104(p_idn text, p_veh bigint, p_pos integer, p_estado text, p_aux boolean default false)
returns void language sql as $$
  insert into public.neumaticos (vehiculo_id, cliente_id, posicion, idneumatico, estado, marca, auxilio, km_previos)
  select v.id, v.cliente_id, p_pos, p_idn, p_estado, 'M', p_aux, 0 from public.vehiculos v where v.id = p_veh $$;
create or replace function test.e104(p_idn text, p_veh bigint, p_tipo text, p_orig integer, p_dest integer, p_odo integer, p_min integer)
returns void language sql as $$
  insert into public.eventos_neumatico (cliente_id, vehiculo_id, neumatico_id, idneumatico, tipo, posicion_origen, posicion_destino, odometro_km, created_at)
  select n.cliente_id, p_veh, n.id, n.idneumatico, p_tipo, p_orig, p_dest, p_odo, timestamptz '2020-01-01 00:00' + make_interval(mins => p_min)
    from public.neumaticos n where n.idneumatico = p_idn $$;
create or replace function test.st104(p_idn text, p_estado text, p_veh bigint, p_pos integer, p_aux boolean)
returns void language sql as $$
  update public.neumaticos set estado = p_estado, vehiculo_id = p_veh, posicion = p_pos, auxilio = p_aux
   where idneumatico = p_idn $$;
-- previos|en_vehiculos|tramo_actual|totales|confiable|tramos_sin_dato (lo que ve el panel)
create or replace function test.k104(p_idn text) returns text language sql stable as $$
  select km_previos || '|' || coalesce(km_en_vehiculos::text, 'NULL') || '|' || coalesce(km_tramo_actual::text, 'NULL') || '|'
         || coalesce(km_totales::text, 'NULL') || '|' || km_confiable || '|' || tramos_sin_dato
    from public.v_km_cubierta where idneumatico = p_idn $$;
-- cerrados|cerrados_con_dato|km_cerrados|montajes_sin_cierre|ultimo_montaje (tramo abierto)|ult_odo|decreciente
create or replace function test.t104(p_idn text) returns text language sql stable as $$
  select t.cerrados || '|' || t.cerrados_con_dato || '|' || t.km_cerrados || '|' || t.montajes_sin_cierre || '|'
         || t.ultimo_montaje || '|' || coalesce(t.ult_odo::text, 'NULL') || '|' || t.decreciente
    from public.neumaticos n cross join lateral public.km_tramos_cubierta(n.id) t where n.idneumatico = p_idn $$;
grant execute on function test.n104(text, bigint, integer, text, boolean), test.e104(text, bigint, text, integer, integer, integer, integer),
  test.st104(text, text, bigint, integer, boolean), test.k104(text), test.t104(text) to public;

-- ---------------------------------------------------------------------------------------------
-- A. CA-13 exacto: montaje en 3 a 100.000, rotación a 99 a 130.000, salida a 4 a 180.000, desmontaje a 200.000
-- ---------------------------------------------------------------------------------------------
select test.n104('K104-A', 10401, 3, 'montado');
select test.e104('K104-A', 10401, 'montaje', null, 3, 100000, 1);
select test.e104('K104-A', 10401, 'rotacion', 3, 99, 130000, 2);
select test.st104('K104-A', 'montado', 10401, 99, true);
update public.vehiculos set odometro_km = 150000 where id = 10401;
select test.eq('A: durante el auxilio el total no crece con el odómetro del vehículo',
  test.k104('K104-A'), '0|30000|0|30000|true|0');
select test.eq('A: el primer tramo (3 a 99) cierra con 30.000 y no queda tramo abierto',
  test.t104('K104-A'), '1|1|30000|0|false|NULL|false');
select test.e104('K104-A', 10401, 'rotacion', 99, 4, 180000, 3);
select test.st104('K104-A', 'montado', 10401, 4, false);
update public.vehiculos set odometro_km = 190000 where id = 10401;
select test.eq('A: montada en ruta: tramo actual 10.000 (190.000 - 180.000)',
  test.k104('K104-A'), '0|30000|10000|40000|true|0');
select test.e104('K104-A', 10401, 'desmontaje', 4, null, 200000, 4);
select test.st104('K104-A', 'almacenado', null, null, false);
update public.vehiculos set odometro_km = 200000 where id = 10401;
select test.eq('CA-13 EXACTO: 50.000 km en vehículos y total (no 100.000)',
  test.k104('K104-A'), '0|50000|NULL|50000|true|0');
select test.eq('CA-13: dos tramos cerrados con dato (30.000 y 20.000), sin tramo abierto',
  test.t104('K104-A'), '2|2|50000|0|false|NULL|false');

-- ---------------------------------------------------------------------------------------------
-- B. Montaje directo en 99 y desmontaje desde 99: 0 km, sin tramo abierto ni dato faltante
-- ---------------------------------------------------------------------------------------------
select test.n104('K104-B', 10402, 99, 'montado', true);
select test.e104('K104-B', 10402, 'montaje', null, 99, 50000, 5);
update public.vehiculos set odometro_km = 60000 where id = 10402;
select test.eq('B: montaje directo en 99: 0 km, sin tramo abierto ni dato faltante',
  test.k104('K104-B'), '0|0|0|0|true|0');
select test.eq('B: montaje directo en 99 no es un montaje abierto', test.t104('K104-B'), '0|0|0|0|false|NULL|false');
update public.vehiculos set odometro_km = null where id = 10402;
select test.eq('B: sin odómetro del vehículo, el auxilio no pide dato (0 km, confiable)',
  test.k104('K104-B'), '0|0|0|0|true|0');
update public.vehiculos set odometro_km = 60000 where id = 10402;
select test.e104('K104-B', 10402, 'desmontaje', 99, null, 70000, 6);
select test.st104('K104-B', 'baja', 10402, 97, false);
update public.vehiculos set odometro_km = 70000 where id = 10402;
select test.eq('B: desmontaje desde 99: 0 km y confiable', test.k104('K104-B'), '0|0|NULL|0|true|0');

-- ---------------------------------------------------------------------------------------------
-- C. Un solo auxilio por vehículo: el segundo se rechaza (RPC y índice)
-- ---------------------------------------------------------------------------------------------
select test.n104('K104-C1', 10403, 99, 'montado', true);
select test.become('authenticated', test.u_cli_a());
select test.denied('C: segundo auxilio por RPC: la posición 99 ya está ocupada',
  $$select public.neumatico_montar(10403::bigint, 99::smallint, null, '{"marca":"Aux2"}'::jsonb)$$, '55000');
reset role;
select test.denied('C: segundo auxilio directo en otra posición: el índice lo rechaza',
  $$insert into public.neumaticos (vehiculo_id, cliente_id, posicion, idneumatico, estado, marca, auxilio)
    values (10403, 1, 98, 'K104-C2', 'montado', 'M', true)$$, '23505');
select test.eq('C: el índice de un auxilio por vehículo sigue vigente',
  (select count(*) from pg_indexes where schemaname = 'public' and indexname = 'neumaticos_un_auxilio_por_vehiculo'
      and indexdef like 'CREATE UNIQUE INDEX%(vehiculo_id)%auxilio%'), 1::bigint);
select test.eq('C: sigue habiendo un solo auxilio en el vehículo',
  (select count(*) from public.neumaticos where vehiculo_id = 10403 and auxilio), 1::bigint);

-- ---------------------------------------------------------------------------------------------
-- D. Frecuencia: el auxilio no figura como sin medir; la rueda de ruta sí
-- ---------------------------------------------------------------------------------------------
select test.n104('K104-D1', 10404, 3, 'montado');
select test.n104('K104-D2', 10404, 99, 'montado', true);
select test.n104('K104-D3', 10410, 99, 'montado', true);
insert into public.mediciones (vehiculo_id, cliente_id, posicion, idneumatico, mm1, mm2, mm3, created_at) values
  (10404, 1, 3, 'K104-D1', 8, 8, 8, now() - interval '31 days'),
  (10404, 1, 99, 'K104-D2', 8, 8, 8, now() - interval '31 days');
select test.eq('D: auxilio medido hace 31 días: sin_medir = false',
  (select sin_medir from public.v_estado_neumaticos where idneumatico = 'K104-D2'), false);
select test.eq('D: el auxilio sigue mostrando dias_desde_medicion = 31',
  (select dias_desde_medicion from public.v_estado_neumaticos where idneumatico = 'K104-D2'), 31);
select test.eq('D: rueda de ruta medida hace 31 días sí vencida (plazo 30)',
  (select sin_medir from public.v_estado_neumaticos where idneumatico = 'K104-D1'), true);
select test.eq('D: auxilio sin ninguna medición tampoco figura como sin medir',
  (select sin_medir from public.v_estado_neumaticos where idneumatico = 'K104-D3'), false);

-- ---------------------------------------------------------------------------------------------
-- E. Odómetro ausente en un borde: tramo sin dato, km_confiable = false, nunca cero estimado
-- ---------------------------------------------------------------------------------------------
-- E1: entrada a 99 sin odómetro (3 a 99 sin dato), luego 99 a 4 a 2.000 y desmontaje a 3.000
select test.n104('K104-E1', 10405, 3, 'montado');
select test.e104('K104-E1', 10405, 'montaje', null, 3, 1000, 1);
select test.e104('K104-E1', 10405, 'rotacion', 3, 99, null, 2);
select test.e104('K104-E1', 10405, 'rotacion', 99, 4, 2000, 3);
select test.e104('K104-E1', 10405, 'desmontaje', 4, null, 3000, 4);
select test.st104('K104-E1', 'almacenado', null, null, false);
select test.eq('E1: entrada a 99 sin odómetro: el tramo sin dato no suma y no es confiable',
  test.k104('K104-E1'), '0|1000|NULL|1000|false|1');
select test.eq('E1: un cierre con dato y otro sin dato',
  test.t104('K104-E1'), '2|1|1000|0|false|NULL|false');

-- E2: entrada a 99 sin odómetro, único tramo: sin dato, no 0
select test.n104('K104-E2', 10406, 3, 'montado');
select test.e104('K104-E2', 10406, 'montaje', null, 3, 1000, 1);
select test.e104('K104-E2', 10406, 'rotacion', 3, 99, null, 2);
select test.st104('K104-E2', 'montado', 10406, 99, true);
select test.eq('E2: entrada a 99 sin odómetro y único tramo: total NULL, no 0',
  test.k104('K104-E2'), '0|NULL|0|NULL|false|1');

-- E3: salida de 99 a 4 sin odómetro, montada en ruta: el tramo actual es Sin dato
select test.n104('K104-E3', 10407, 3, 'montado');
select test.e104('K104-E3', 10407, 'montaje', null, 3, 1000, 1);
select test.e104('K104-E3', 10407, 'rotacion', 3, 99, 1500, 2);
select test.e104('K104-E3', 10407, 'rotacion', 99, 4, null, 3);
select test.st104('K104-E3', 'montado', 10407, 4, false);
update public.vehiculos set odometro_km = 3000 where id = 10407;
select test.eq('E3: salida de 99 sin odómetro y montada en ruta: tramo actual Sin dato',
  test.k104('K104-E3'), '0|500|NULL|500|false|1');

-- E4: salida de 99 a 4 sin odómetro, luego desmontada con odómetro: el tramo sin dato no suma
select test.n104('K104-E4', 10408, 3, 'montado');
select test.e104('K104-E4', 10408, 'montaje', null, 3, 1000, 1);
select test.e104('K104-E4', 10408, 'rotacion', 3, 99, 1500, 2);
select test.e104('K104-E4', 10408, 'rotacion', 99, 4, null, 3);
select test.e104('K104-E4', 10408, 'desmontaje', 4, null, 2000, 4);
select test.st104('K104-E4', 'almacenado', null, null, false);
select test.eq('E4: salida de 99 sin odómetro y desmontada: solo suma el tramo con dato',
  test.k104('K104-E4'), '0|500|NULL|500|false|1');

-- ---------------------------------------------------------------------------------------------
-- F. Rotación ruta <-> 99 con intercambio (RPC): cada cubierta cierra y abre su tramo
-- ---------------------------------------------------------------------------------------------
select test.n104('K104-F1', 10409, 3, 'montado');
select test.n104('K104-F2', 10409, 99, 'montado', true);
select test.e104('K104-F1', 10409, 'montaje', null, 3, 1000, 1);
select test.e104('K104-F2', 10409, 'montaje', null, 99, 1000, 2);
select test.become('authenticated', test.u_cli_a());
select test.eq('F: rotación 3 <-> 99 con intercambio (RPC)',
  (public.neumatico_rotar(10409::bigint, 3::smallint, 99::smallint, 2000)->>'intercambio'), 'true');
reset role;
update public.vehiculos set odometro_km = 2500 where id = 10409;
select test.eq('F1: pasó de ruta a 99: cierra su tramo (1.000) y queda sin tramo abierto',
  test.k104('K104-F1'), '0|1000|0|1000|true|0');
select test.eq('F1: cierre por rotación en el tramo cerrado', test.t104('K104-F1'), '1|1|1000|0|false|NULL|false');
select test.eq('F2: pasó de 99 a ruta: abre su tramo (2.000) y suma lo recorrido (500)',
  test.k104('K104-F2'), '0|0|500|500|true|0');
select test.eq('F2: tramo abierto desde la salida de 99', test.t104('K104-F2'), '0|0|0|0|true|2000|false');
select test.become('authenticated', test.u_cli_a());
select test.eq('F: segunda rotación con intercambio (RPC)',
  (public.neumatico_rotar(10409::bigint, 3::smallint, 99::smallint, 3000)->>'intercambio'), 'true');
reset role;
update public.vehiculos set odometro_km = 3200 where id = 10409;
select test.eq('F1: vuelve a ruta: 1.000 cerrados y tramo actual 200',
  test.k104('K104-F1'), '0|1000|200|1200|true|0');
select test.eq('F2: a 99 otra vez: 1.000 cerrados, sin tramo abierto',
  test.k104('K104-F2'), '0|1000|0|1000|true|0');
select test.eq('F2: cierre 2.000 a 3.000 y ningún tramo abierto', test.t104('K104-F2'), '1|1|1000|0|false|NULL|false');

-- ---------------------------------------------------------------------------------------------
-- G. Roles: misma visibilidad que antes; sin datos de otra empresa
-- ---------------------------------------------------------------------------------------------
select test.n104('K104-G', 10411, 3, 'montado');
select test.e104('K104-G', 10411, 'montaje', null, 3, 100, 1);
select test.eq('la vista conserva sus columnas y su orden',
  (select string_agg(column_name, ',' order by ordinal_position) from information_schema.columns
    where table_schema = 'public' and table_name = 'v_km_cubierta'),
  'neumatico_id,cliente_id,vehiculo_id,idneumatico,numero_quema,estado,km_previos,km_en_vehiculos,km_tramo_actual,km_totales,km_confiable,tramos_con_dato,tramos_sin_dato,odometro_anomalo');
select test.become('authenticated', test.u_admin());
select test.eq('admin ve todas las cubiertas K104', (select count(*) from public.v_km_cubierta where idneumatico like 'K104-%'), 13::bigint);
reset role;
select test.become('authenticated', test.u_cli_a());
select test.eq('cliente A (global) ve las 12 de su empresa', (select count(*) from public.v_km_cubierta where idneumatico like 'K104-%'), 12::bigint);
select test.eq('cliente A: no ve la de otra empresa', (select count(*) from public.v_km_cubierta where idneumatico = 'K104-G'), 0::bigint);
select test.eq('cliente A: km_tramos_cubierta de la cubierta de otra empresa no devuelve filas',
  (select count(*) from public.km_tramos_cubierta((select id from public.neumaticos where idneumatico = 'K104-G'))), 0::bigint);
select test.eq('cliente A: CA-13 visible con sus km', test.k104('K104-A'), '0|50000|NULL|50000|true|0');
reset role;
select test.become('authenticated', test.u_cli_b());
select test.eq('otra empresa ve solo su cubierta', (select string_agg(idneumatico, ',') from public.v_km_cubierta where idneumatico like 'K104-%'), 'K104-G');
select test.eq('otra empresa: sin tramos de las cubiertas ajenas',
  (select count(*) from public.km_tramos_cubierta((select id from public.neumaticos where idneumatico = 'K104-A'))), 0::bigint);
reset role;
select test.become('authenticated', test.u_k104s());
select test.eq('sucursal solo ve las cubiertas de su vehículo (F1 y F2)',
  (select string_agg(idneumatico, ',' order by idneumatico) from public.v_km_cubierta where idneumatico like 'K104-%'), 'K104-F1,K104-F2');
select test.eq('sucursal: km_tramos_cubierta de una cubierta de su vehículo responde',
  (select count(*) from public.km_tramos_cubierta((select id from public.neumaticos where idneumatico = 'K104-F1'))), 1::bigint);
select test.eq('sucursal: km_tramos_cubierta de una cubierta ajena no devuelve filas',
  (select count(*) from public.km_tramos_cubierta((select id from public.neumaticos where idneumatico = 'K104-A'))), 0::bigint);
reset role;
select test.become('authenticated', test.u_api());
select test.eq('rol api no ve nada', (select count(*) from public.v_km_cubierta where idneumatico like 'K104-%'), 0::bigint);
reset role;
select test.become('authenticated', test.u_sinperfil());
select test.eq('sin perfil no ve nada', (select count(*) from public.v_km_cubierta where idneumatico like 'K104-%'), 0::bigint);
reset role;
select test.become('anon', null);
select test.denied('anon no lee la vista', $$select count(*) from public.v_km_cubierta$$);
reset role;

-- ---------------------------------------------------------------------------------------------
-- H. CPK por vida (costo_vida_items, v_costo_vida): el mismo corte de tramos que v_km_cubierta (CA-13)
-- ---------------------------------------------------------------------------------------------
insert into public.costos_neumatico (cliente_id, neumatico_id, concepto, monto)
  select 1, n.id, 'otro', 1000 from public.neumaticos n where n.idneumatico = 'K104-A';
select test.eq('H: costo_vida_items (CA-13): 50.000 km en la vida 0, no 100.000',
  (select km_recorridos from public.costo_vida_items((select id from public.neumaticos where idneumatico = 'K104-A')) where vida = 0),
  50000::bigint);
select test.eq('H: costo_vida_items (CA-13): dos tramos con dato (30.000 y 20.000) y ninguno sin dato',
  (select tramos_con_dato || '|' || tramos_sin_dato from public.costo_vida_items((select id from public.neumaticos where idneumatico = 'K104-A')) where vida = 0),
  '2|0');
select test.eq('H: v_costo_vida (CA-13): 50.000 km, confiable, sin tramo abierto',
  (select km_recorridos || '|' || km_confiable from public.v_costo_vida where idneumatico = 'K104-A'), '50000|true');
select test.eq('H: CPK de la vida 0 = 1.000 / 50.000 km',
  (select round(cpk, 4) from public.v_costo_vida where idneumatico = 'K104-A'), 0.0200::numeric);
select test.eq('H: coherente con v_km_cubierta: la suma de km por vida = km en vehículos',
  (select sum(km_recorridos)::bigint from public.v_costo_vida where idneumatico = 'K104-A'),
  (select km_en_vehiculos from public.v_km_cubierta where idneumatico = 'K104-A'));
select test.eq('H: coherente con v_costo_cubierta: mismos km recorridos de la cubierta',
  (select km_recorridos from public.v_costo_cubierta where idneumatico = 'K104-A'), 50000::bigint);
select test.eq('H: CPK por cubierta (v_costo_cubierta) = el mismo costo y km de la vida',
  (select round(cpk, 4) from public.v_costo_cubierta where idneumatico = 'K104-A'), 0.0200::numeric);
select test.eq('H: entrada a 99 sin odómetro (E1): tramo sin dato, el km con dato sale y el sin dato no suma',
  (select km_recorridos || '|' || tramos_con_dato || '|' || tramos_sin_dato
     from public.costo_vida_items((select id from public.neumaticos where idneumatico = 'K104-E1')) where vida = 0), '1000|1|1');
select test.eq('H: entrada a 99 sin odómetro y único tramo (E2): total NULL, no 0',
  (select km_recorridos is null and tramos_sin_dato = 1
     from public.costo_vida_items((select id from public.neumaticos where idneumatico = 'K104-E2')) where vida = 0), true);

rollback;
