-- Ola 3 de F8 (migración 20261126040000): rotación en disco, alineación y desgaste lateral (RN-05, RN-15 a RN-17; R1).
-- A: R1 por bandas (T04 a T07 y bordes). B: cambio de tipo en la misma fila. C: rotación en disco (cierres, no reabre,
-- errores, odómetro, duplicada, tramo de km). D: alineación. E: la rotación de posición cierra lateral e irregular.
-- F: catálogo de motivos y guarda del trigger. G: CA-31 (rol_eje_posicion). H: roles y visibilidad.
-- Una transacción; cada caso va en un savepoint que se revierte. Datos propios: vehículos 971-976, sucursales 1071-1072,
-- uuids b1070000-... Umbrales del cliente 1: irregularidad 2,0 mm y swap 20.000 km.
-- now() es el inicio de la transacción: lo que va después de una medición se fecha con now() + interval.

begin;

insert into auth.users (id, email) values
  ('b1070000-0000-0000-0000-000000000001', 'g107@t'),
  ('b1070000-0000-0000-0000-000000000002', 's107@t'),
  ('b1070000-0000-0000-0000-000000000003', 'o107@t'),
  ('b1070000-0000-0000-0000-000000000004', 'b107@t');
insert into public.sucursales (id, cliente_id, nombre) overriding system value values
  (1071, 1, 'Disco 107 A'), (1072, 1, 'Disco 107 B');
insert into public.perfiles (user_id, rol, cliente_id, sucursal_id) values
  ('b1070000-0000-0000-0000-000000000001', 'cliente', 1, null),
  ('b1070000-0000-0000-0000-000000000002', 'cliente', 1, 1071),
  ('b1070000-0000-0000-0000-000000000003', 'cliente', 1, 1072),
  ('b1070000-0000-0000-0000-000000000004', 'cliente', 2, null);

-- ---- Identidades y helpers ------------------------------------------------------------------------------------------

create or replace function test.m107_u_g() returns uuid language sql immutable as $$ select 'b1070000-0000-0000-0000-000000000001'::uuid $$;
create or replace function test.m107_u_s() returns uuid language sql immutable as $$ select 'b1070000-0000-0000-0000-000000000002'::uuid $$;
create or replace function test.m107_u_o() returns uuid language sql immutable as $$ select 'b1070000-0000-0000-0000-000000000003'::uuid $$;
create or replace function test.m107_u_b() returns uuid language sql immutable as $$ select 'b1070000-0000-0000-0000-000000000004'::uuid $$;

-- Vehículo del cliente 1 (4x2: dirección 1-2, tracción 3-4; 6x2 para diez cubiertas).
create or replace function test.m107_veh(p_id bigint, p_suc bigint, p_odo integer, p_dist text)
returns void language sql as $$
  insert into public.vehiculos (id, cliente_id, sucursal_id, nombre, patente, activo, odometro_km, distribucion)
  values (p_id, 1, p_suc, 'V107 ' || p_id, 'K' || lpad(p_id::text, 5, '0'), true, p_odo, p_dist) $$;

create or replace function test.m107_montar(p_veh bigint, p_idn text, p_pos integer)
returns void language sql as $$
  insert into public.neumaticos (vehiculo_id, cliente_id, posicion, idneumatico, estado, marca, km_previos)
  select v.id, v.cliente_id, p_pos, p_idn, 'montado', 'M', 0 from public.vehiculos v where v.id = p_veh $$;

-- Medición con la huella interna (mm1), central (mm2) y externa (mm3); p_desde se suma a now() (constante en la transacción).
create or replace function test.m107_medir(p_veh bigint, p_idn text, p_pos integer, p_mm1 numeric, p_mm2 numeric,
                                           p_mm3 numeric, p_desde interval default interval '0')
returns void language sql as $$
  insert into public.mediciones (vehiculo_id, cliente_id, posicion, idneumatico, mm1, mm2, mm3, created_at)
  select v.id, v.cliente_id, p_pos, p_idn, p_mm1, p_mm2, p_mm3, now() + p_desde
    from public.vehiculos v where v.id = p_veh $$;

create or replace function test.m107_sync() returns void language plpgsql as $$
begin
  perform public.alerta_sincronizar(1, null);
end $$;

-- Cubierta de tracción (posición 3 de un 4x2 sin sucursal), una medición y la sincronización.
create or replace function test.m107_banda(p_mm1 numeric, p_mm2 numeric, p_mm3 numeric) returns void language plpgsql as $$
begin
  perform test.m107_veh(971, null, 1000, '4x2');
  perform test.m107_montar(971, 'R107', 3);
  perform test.m107_medir(971, 'R107', 3, p_mm1, p_mm2, p_mm3);
  perform public.alerta_sincronizar(1, null);
end $$;

-- Dos cubiertas: R107 en la 3 y R107B en la 4 (tracción), sin mediciones.
create or replace function test.m107_par() returns void language plpgsql as $$
begin
  perform test.m107_veh(971, null, 1000, '4x2');
  perform test.m107_montar(971, 'R107', 3);
  perform test.m107_montar(971, 'R107B', 4);
end $$;

-- Cubierta de vida 0 con tramo de 25.000 km (odómetro 35.000 menos 10.000 del montaje): alerta de swap abierta.
create or replace function test.m107_swap(p_veh bigint, p_idn text) returns void language plpgsql as $$
begin
  perform test.m107_veh(p_veh, null, 35000, '4x2');
  perform test.m107_montar(p_veh, p_idn, 3);
  insert into public.eventos_neumatico (cliente_id, vehiculo_id, neumatico_id, idneumatico, tipo, odometro_km, costo, created_at)
    values (1, p_veh, (select id from public.neumaticos where idneumatico = p_idn), p_idn, 'montaje', 10000, 350.00,
            now() - interval '2000 hours');
  perform test.m107_medir(p_veh, p_idn, 3, 10, 10, 10, interval '-2 hours');
  perform public.alerta_sincronizar(1, null);
end $$;

-- Alertas abiertas de desgaste de una cubierta, como «tipo:mm» (p. ej. «lateral:2.5»), o «ninguna».
create or replace function test.m107_abiertas(p_idn text) returns text language sql stable as $$
  select coalesce(string_agg(a.tipo || ':' || trim_scale(a.mm_actual)::text, ' ' order by a.tipo), 'ninguna')
    from public.alertas a join public.neumaticos n on n.id = a.neumatico_id
   where n.idneumatico = p_idn and a.estado <> 'resuelta' and a.tipo in ('lateral', 'irregular') $$;

-- Estado de la última alerta de un tipo: «abierta», su motivo de cierre o «sin alerta».
create or replace function test.m107_motivo(p_idn text, p_tipo text) returns text language sql stable as $$
  select coalesce(
    (select 'abierta' from public.alertas a join public.neumaticos n on n.id = a.neumatico_id
      where n.idneumatico = p_idn and a.tipo = p_tipo and a.estado <> 'resuelta' limit 1),
    (select a.resuelta_motivo from public.alertas a join public.neumaticos n on n.id = a.neumatico_id
      where n.idneumatico = p_idn and a.tipo = p_tipo order by a.id desc limit 1),
    'sin alerta') $$;

-- Asimetría lateral, desgaste lateral y desgaste irregular de la vista de estado.
create or replace function test.m107_vista(p_idn text) returns text language sql stable as $$
  select trim_scale(asimetria_lateral_mm)::text || ' ' || desgaste_lateral::text || ' ' || desgaste_irregular::text
    from public.v_estado_neumaticos where idneumatico = p_idn $$;

-- Hace que la alerta abierta de ese tipo haya empezado hace un día, para que una atención de hoy sea posterior.
create or replace function test.m107_atras(p_idn text, p_tipo text) returns void language sql as $$
  update public.alertas a set abierta_at = now() - interval '1 day'
    from public.neumaticos n
   where n.id = a.neumatico_id and n.idneumatico = p_idn and a.tipo = p_tipo and a.estado <> 'resuelta' $$;

-- SQLSTATE de una sentencia, o «sin error» si no falla.
create or replace function test.m107_err(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'sin error';
exception when others then
  return sqlstate || '|' || sqlerrm;
end $$;

grant execute on all functions in schema test to public;

-- ---- A. R1 por bandas (RN-16, CA-15): lateral = |mm1 − mm3| >= 2,0; irregular = rango >= 2,0; excluyentes -----------

savepoint s_a1;
select test.m107_banda(9, 8, 6.5);
select test.eq('A1 T04 9/8/6,5: lateral 2,5 y sin irregular', test.m107_abiertas('R107'), 'lateral:2.5');
select test.eq('A1 T04: asimetría 2,5 y desgaste lateral', test.m107_vista('R107'), '2.5 true true');
select test.eq('A1 T04: mensaje de la alerta lateral',
  (select mensaje from public.v_alertas where idneumatico = 'R107' and tipo = 'lateral'),
  'Revisar alineación: 2,5 mm de diferencia entre la huella interna y la externa');
rollback to savepoint s_a1;

savepoint s_a2;
select test.m107_banda(9, 6.5, 9);
select test.eq('A2 T05 9/6,5/9: irregular 2,5 y sin lateral', test.m107_abiertas('R107'), 'irregular:2.5');
select test.eq('A2 T05: asimetría 0 y sin desgaste lateral', test.m107_vista('R107'), '0 false true');
rollback to savepoint s_a2;

savepoint s_a3;
select test.m107_banda(6, 8.6, 6);
select test.eq('A3 T06 6/8,6/6: irregular 2,6 y sin lateral', test.m107_abiertas('R107'), 'irregular:2.6');
select test.eq('A3 T06: asimetría 0 y sin desgaste lateral', test.m107_vista('R107'), '0 false true');
rollback to savepoint s_a3;

savepoint s_a4;
select test.m107_banda(9, 8, 9);
select test.eq('A4 T07 9/8/9: ninguna alerta', test.m107_abiertas('R107'), 'ninguna');
select test.eq('A4 T07: ni lateral ni irregular en la vista', test.m107_vista('R107'), '0 false false');
rollback to savepoint s_a4;

savepoint s_a5;
select test.m107_banda(10, 9, 8);
select test.eq('A5 borde 10/9/8: lateral 2,0 exacto', test.m107_abiertas('R107'), 'lateral:2');
select test.eq('A5 borde: asimetría 2 y desgaste lateral', test.m107_vista('R107'), '2 true true');
rollback to savepoint s_a5;

savepoint s_a6;
select test.m107_banda(9.9, 9, 8);
select test.eq('A6 borde 9,9/9/8: lateral 1,9 y rango 1,9, ninguna', test.m107_abiertas('R107'), 'ninguna');
select test.eq('A6 borde: asimetría 1,9 y sin desgaste', test.m107_vista('R107'), '1.9 false false');
rollback to savepoint s_a6;

savepoint s_a7;
select test.m107_banda(10, 8, 8.1);
select test.eq('A7 borde 10/8/8,1: lateral 1,9 no alcanza, rango 2,0 es irregular', test.m107_abiertas('R107'), 'irregular:2');
select test.eq('A7 borde: asimetría 1,9, sin lateral', test.m107_vista('R107'), '1.9 false true');
rollback to savepoint s_a7;

reset role;

-- ---- B. Cambio de tipo en la misma fila (sin reconocer ni silenciar) ------------------------------------------------

savepoint s_b;
select test.m107_banda(9, 6.5, 9);
select test.eq('B precondición: irregular 2,5 abierta', test.m107_abiertas('R107'), 'irregular:2.5');
update public.alertas set estado = 'reconocida', reconocida_at = now() where tipo = 'irregular';
update public.alertas set abierta_at = now() - interval '1 day' where tipo = 'irregular';
select test.m107_medir(971, 'R107', 3, 9, 8, 6.5, interval '1 minute');
select test.m107_sync();
select test.eq('B: la misma fila pasa a lateral, abierta de nuevo, sin reconocer y con abierta_at nuevo',
  (select a.tipo || ' ' || a.estado || ' ' || (a.reconocida_at is null)::text || ' ' ||
          (a.abierta_at > now() - interval '1 hour')::text || ' ' || trim_scale(a.mm_actual)::text
     from public.alertas a join public.neumaticos n on n.id = a.neumatico_id
    where n.idneumatico = 'R107' order by a.id desc limit 1),
  'lateral abierta true true 2.5');
select test.eq('B: sigue habiendo una sola fila para la cubierta',
  (select count(*) from public.alertas a join public.neumaticos n on n.id = a.neumatico_id where n.idneumatico = 'R107'),
  1::bigint);
update public.alertas set abierta_at = now() - interval '1 day' where tipo = 'lateral';
select test.m107_medir(971, 'R107', 3, 9, 6.5, 9, interval '2 minutes');
select test.m107_sync();
select test.eq('B: y vuelve a irregular en la misma fila',
  (select a.tipo || ' ' || a.estado from public.alertas a join public.neumaticos n on n.id = a.neumatico_id
    where n.idneumatico = 'R107' order by a.id desc limit 1),
  'irregular abierta');
select test.eq('B: la vuelta tampoco crea una segunda fila',
  (select count(*) from public.alertas a join public.neumaticos n on n.id = a.neumatico_id where n.idneumatico = 'R107'),
  1::bigint);
rollback to savepoint s_b;

reset role;

-- ---- C. Rotación en disco (neumatico_rotar_disco) -----------------------------------------------------------------

-- C1. La lateral se cierra con rotación; no se reabre sin medición posterior; sí con una medición posterior.
savepoint s_c1;
select test.m107_banda(9, 8, 6.5);
select test.eq('C1 precondición: lateral 2,5 abierta', test.m107_abiertas('R107'), 'lateral:2.5');
select test.m107_atras('R107', 'lateral');
select test.become('authenticated', test.m107_u_g());
select test.eq('C1: rotación en disco por desgaste lateral (no duplicada)',
  (public.neumatico_rotar_disco(971, 3::smallint, null, 'desgaste_lateral', null) ->> 'duplicada'), 'false');
reset role;
select test.eq('C1: el disco cierra la lateral con motivo rotacion', test.m107_motivo('R107', 'lateral'), 'rotacion');
select test.m107_sync();
select test.eq('C1: sin medición posterior la lateral no se reabre', test.m107_abiertas('R107'), 'ninguna');
select test.m107_medir(971, 'R107', 3, 9, 8, 6.5, interval '1 minute');
select test.m107_sync();
select test.eq('C1: una medición posterior abre una alerta nueva', test.m107_abiertas('R107'), 'lateral:2.5');
select test.eq('C1: y quedan dos filas para la cubierta',
  (select count(*) from public.alertas a join public.neumaticos n on n.id = a.neumatico_id where n.idneumatico = 'R107'),
  2::bigint);
rollback to savepoint s_c1;

-- C2. La irregular también se cierra con rotación en disco.
savepoint s_c2;
select test.m107_banda(9, 6.5, 9);
select test.eq('C2 precondición: irregular 2,5 abierta', test.m107_abiertas('R107'), 'irregular:2.5');
select test.m107_atras('R107', 'irregular');
select test.become('authenticated', test.m107_u_g());
select test.eq('C2: rotación en disco con motivo otro',
  (public.neumatico_rotar_disco(971, 3::smallint, null, 'otro', 'Rotación de prueba') ->> 'duplicada'), 'false');
reset role;
select test.eq('C2: el disco cierra la irregular con motivo rotacion', test.m107_motivo('R107', 'irregular'), 'rotacion');
rollback to savepoint s_c2;

-- C3. El swap se cierra con rotación en disco (CA-05) y no se reabre al sincronizar.
savepoint s_c3;
select test.m107_swap(973, 'SW107');
select test.eq('C3 precondición: swap abierta', test.m107_motivo('SW107', 'swap'), 'abierta');
select test.m107_atras('SW107', 'swap');
select test.become('authenticated', test.m107_u_g());
select test.eq('C3: rotación en disco por swap a 20.000 km (no duplicada)',
  (public.neumatico_rotar_disco(973, 3::smallint, null, 'swap_20000', null) ->> 'duplicada'), 'false');
reset role;
select test.m107_sync();
select test.eq('C3: el swap cerrado por disco queda cerrado y no se reabre', test.m107_motivo('SW107', 'swap'), 'rotacion');
rollback to savepoint s_c3;

-- C4. Errores (22023, 22004, P0002, 23514), odómetro y duplicada.
savepoint s_c4;
select test.m107_par();
select test.become('authenticated', test.m107_u_g());
select test.eq('C4: posición 99 (auxilio) no se rota en disco: 22023',
  split_part(test.m107_err($q$select public.neumatico_rotar_disco(971, 99::smallint, null, 'desgaste_lateral', null)$q$), '|', 1), '22023');
select test.eq('C4: posición nula: 22004',
  split_part(test.m107_err($q$select public.neumatico_rotar_disco(971, null::smallint, null, 'desgaste_lateral', null)$q$), '|', 1), '22004');
select test.eq('C4: posición sin cubierta: P0002',
  split_part(test.m107_err($q$select public.neumatico_rotar_disco(971, 7::smallint, null, 'desgaste_lateral', null)$q$), '|', 1), 'P0002');
select test.eq('C4: motivo de rotación de posición no vale en disco: 22023',
  split_part(test.m107_err($q$select public.neumatico_rotar_disco(971, 3::smallint, null, 'paso_a_eje_loco', null)$q$), '|', 1), '22023');
select test.eq('C4: «otro» sin texto: 22023',
  split_part(test.m107_err($q$select public.neumatico_rotar_disco(971, 3::smallint, null, 'otro', null)$q$), '|', 1), '22023');
select test.eq('C4: sin motivo: 22023',
  split_part(test.m107_err($q$select public.neumatico_rotar_disco(971, 3::smallint, null, null, null)$q$), '|', 1), '22023');
select test.eq('C4: odómetro negativo: 23514',
  split_part(test.m107_err($q$select public.neumatico_rotar_disco(971, 3::smallint, -1, 'desgaste_lateral', null)$q$), '|', 1), '23514');
select test.eq('C4: odómetro menor al actual (1000): 23514',
  split_part(test.m107_err($q$select public.neumatico_rotar_disco(971, 3::smallint, 500, 'desgaste_lateral', null)$q$), '|', 1), '23514');
rollback to savepoint s_c4;

savepoint s_c4b;
select test.m107_par();
update public.clientes set odometro_obligatorio = true where id = 1;
select test.become('authenticated', test.m107_u_g());
select test.eq('C4: con odómetro obligatorio y sin odómetro: 22023',
  split_part(test.m107_err($q$select public.neumatico_rotar_disco(971, 3::smallint, null, 'desgaste_lateral', null)$q$), '|', 1), '22023');
reset role;
rollback to savepoint s_c4b;

savepoint s_c4c;
select test.m107_par();
select test.become('authenticated', test.m107_u_g());
select test.eq('C4: rotación con odómetro 1500 (no duplicada)',
  (public.neumatico_rotar_disco(971, 3::smallint, 1500, 'desgaste_lateral', null) ->> 'duplicada'), 'false');
select test.eq('C4: doble envío dentro de 30 s: duplicada',
  (public.neumatico_rotar_disco(971, 3::smallint, 1500, 'desgaste_lateral', null) ->> 'duplicada'), 'true');
reset role;
select test.eq('C4: un solo evento de disco', (select count(*) from public.eventos_neumatico where tipo = 'rotacion_disco'), 1::bigint);
select test.eq('C4: el odómetro del vehículo sube a 1500', (select odometro_km from public.vehiculos where id = 971), 1500);
rollback to savepoint s_c4c;

-- C5. La rotación en disco no corta el tramo de km de la cubierta (no cambia neumaticos).
savepoint s_c5;
select test.m107_swap(973, 'SW107');
create temp table t107_km on commit drop as
  select km_tramo_actual from public.v_km_cubierta where idneumatico = 'SW107';
select test.eq('C5 precondición: tramo de km calculado', (select km_tramo_actual is not null from t107_km), true);
select test.become('authenticated', test.m107_u_g());
select test.eq('C5: la rotación en disco no cambia el tramo', (public.neumatico_rotar_disco(973, 3::smallint, null, 'desgaste_lateral', null) ->> 'posicion'), '3');
reset role;
select test.eq('C5: km_tramo_actual igual antes y después',
  (select km_tramo_actual from public.v_km_cubierta where idneumatico = 'SW107'),
  (select km_tramo_actual from t107_km));
rollback to savepoint s_c5;

reset role;

-- ---- D. Alineación (vehiculo_alinear) -----------------------------------------------------------------------------

savepoint s_d;
select test.m107_veh(975, null, 1000, '6x2');
select test.m107_montar(975, 'AL107-' || p, p) from generate_series(1, 10) p;
select test.m107_montar(975, 'AL107-99', 99);
select test.m107_medir(975, 'AL107-3', 3, 9, 8, 6.5);
select test.m107_medir(975, 'AL107-4', 4, 9, 6.5, 9);
select test.m107_sync();
select test.m107_atras('AL107-3', 'lateral');
select test.m107_atras('AL107-4', 'irregular');
select test.become('authenticated', test.m107_u_g());
select test.eq('D: alineación de diez cubiertas (el auxilio no cuenta)',
  (public.vehiculo_alinear(975, null, 'control', null) ->> 'neumaticos'), '10');
select test.eq('D: la segunda llamada dentro de 30 s es duplicada sin cubiertas',
  (public.vehiculo_alinear(975, null, 'control', null) ->> 'duplicada'), 'true');
reset role;
select test.eq('D: diez eventos de alineación, ninguno en el auxilio',
  (select count(*) from public.eventos_neumatico e join public.neumaticos n on n.id = e.neumatico_id
    where e.tipo = 'alineacion' and n.posicion <> 99), 10::bigint);
select test.eq('D: el auxilio no recibe evento de alineación',
  (select count(*) from public.eventos_neumatico e join public.neumaticos n on n.id = e.neumatico_id
    where e.tipo = 'alineacion' and n.posicion = 99), 0::bigint);
select test.eq('D: la alineación cierra la lateral con motivo alineacion', test.m107_motivo('AL107-3', 'lateral'), 'alineacion');
select test.eq('D: la alineación no cierra la irregular', test.m107_motivo('AL107-4', 'irregular'), 'abierta');
select test.m107_sync();
select test.eq('D: sin medición posterior la lateral no se reabre', test.m107_abiertas('AL107-3'), 'ninguna');
select test.m107_medir(975, 'AL107-3', 3, 9, 8, 6.5, interval '1 minute');
select test.m107_sync();
select test.eq('D: con medición posterior la lateral vuelve a abrirse', test.m107_abiertas('AL107-3'), 'lateral:2.5');
rollback to savepoint s_d;

savepoint s_d2;
select test.m107_veh(976, null, 1000, '6x2');
select test.become('authenticated', test.m107_u_g());
select test.eq('D: vehículo sin cubiertas montadas: 22023',
  split_part(test.m107_err($q$select public.vehiculo_alinear(976, null, 'control', null)$q$), '|', 1), '22023');
rollback to savepoint s_d2;

reset role;

-- ---- E. La rotación de posición cierra lateral e irregular (CA-17) -----------------------------------------------

savepoint s_e;
select test.m107_par();
select test.m107_medir(971, 'R107', 3, 9, 8, 6.5);
select test.m107_medir(971, 'R107B', 4, 9, 6.5, 9);
select test.m107_sync();
select test.m107_atras('R107', 'lateral');
select test.m107_atras('R107B', 'irregular');
select test.become('authenticated', test.m107_u_g());
select test.eq('E: rotación de posiciones 3 y 4 con diferencia de huellas: intercambio',
  (public.neumatico_rotar(971, 3::smallint, 4::smallint, null, 'diferencia_huellas', null) ->> 'intercambio'), 'true');
reset role;
-- neumatico_rotar solo mueve las posiciones: la sincronización la hace el trigger al confirmar. Aquí se llama a mano.
select test.m107_sync();
select test.eq('E: la rotación de posición cierra la lateral con motivo rotacion', test.m107_motivo('R107', 'lateral'), 'rotacion');
select test.eq('E: la rotación de posición cierra la irregular con motivo rotacion', test.m107_motivo('R107B', 'irregular'), 'rotacion');
rollback to savepoint s_e;

reset role;

-- ---- F. Catálogo y guarda del trigger -----------------------------------------------------------------------------

savepoint s_f1;
select test.m107_par();
select test.become('authenticated', test.m107_u_g());
select test.eq('F1: neumatico_rotar con desgaste_lateral (de disco): 22023',
  split_part(test.m107_err($q$select public.neumatico_rotar(971, 3::smallint, 4::smallint, null, 'desgaste_lateral', null)$q$), '|', 1), '22023');
select test.eq('F1: neumatico_rotar con swap_20000 sigue aceptado',
  test.m107_err($q$select public.neumatico_rotar(971, 3::smallint, 4::smallint, null, 'swap_20000', null)$q$), 'sin error');
select test.eq('F1: vehiculo_alinear con swap_20000: 22023',
  split_part(test.m107_err($q$select public.vehiculo_alinear(971, null, 'swap_20000', null)$q$), '|', 1), '22023');
reset role;
rollback to savepoint s_f1;

-- El trigger no se dispara ni sincroniza si el UPDATE no cambia estado, posición, vehículo, cubierta ni vida.
savepoint s_f2;
select test.m107_banda(9, 6.5, 9);
set constraints all immediate;
update public.alertas set updated_at = '2000-01-01 00:00:00+00';
update public.neumaticos set posicion = posicion where idneumatico = 'R107';
select test.eq('F2: un update sin cambio de posición no toca alertas.updated_at',
  (select updated_at from public.alertas where tipo = 'irregular' limit 1), '2000-01-01 00:00:00+00'::timestamptz);
rollback to savepoint s_f2;

reset role;

-- ---- G. CA-31: rol de eje por distribución (rol_eje_posicion) ------------------------------------------------------

savepoint s_g;
select test.eq('G: 6x2, posiciones 1 y 2 son dirección',
  (public.rol_eje_posicion('6x2', 1) = 'direccion' and public.rol_eje_posicion('6x2', 2) = 'direccion'), true);
select test.eq('G: 6x2, posición 3 es tracción', public.rol_eje_posicion('6x2', 3), 'traccion');
select test.eq('G: 8x2, posiciones 1 a 4 son dirección',
  (select bool_and(public.rol_eje_posicion('8x2', p) = 'direccion') from generate_series(1, 4) p), true);
select test.eq('G: 8x2, posición 5 es tracción', public.rol_eje_posicion('8x2', 5), 'traccion');
rollback to savepoint s_g;

reset role;

-- ---- H. Roles y visibilidad (JWT simulado) -----------------------------------------------------------------------

savepoint s_h;
select test.m107_veh(971, 1071, 1000, '4x2');
select test.m107_veh(972, 1072, 1000, '4x2');
select test.m107_montar(971, 'R107', 3);
select test.m107_montar(972, 'R107B', 3);
select test.m107_medir(971, 'R107', 3, 9, 8, 6.5);
select test.m107_medir(972, 'R107B', 3, 9, 8, 6.5);
select test.m107_sync();
select test.eq('H precondición: una lateral abierta en cada sucursal',
  (select count(*) from public.alertas where tipo = 'lateral' and estado <> 'resuelta'), 2::bigint);

select test.become('authenticated', test.m107_u_g());
select test.eq('H: el global del cliente ve las dos laterales', (select count(*) from public.v_alertas where tipo = 'lateral'), 2::bigint);

select test.become('authenticated', test.m107_u_s());
select test.eq('H: la sucursal A ve solo su lateral', (select count(*) from public.v_alertas where tipo = 'lateral'), 1::bigint);
select test.eq('H: la sucursal A rota en disco en su vehículo',
  (public.neumatico_rotar_disco(971, 3::smallint, null, 'desgaste_lateral', null) ->> 'duplicada'), 'false');
select test.denied('H: la sucursal A no rota en disco en la sucursal B',
  $$select public.neumatico_rotar_disco(972, 3::smallint, null, 'desgaste_lateral', null)$$);
select test.denied('H: la sucursal A no alinea en la sucursal B',
  $$select public.vehiculo_alinear(972, null, 'control', null)$$);

select test.become('authenticated', test.m107_u_o());
select test.eq('H: la sucursal B ve solo su lateral', (select count(*) from public.v_alertas where tipo = 'lateral'), 1::bigint);
select test.eq('H: la sucursal B alinea su vehículo',
  (public.vehiculo_alinear(972, null, 'control', null) ->> 'duplicada'), 'false');

select test.become('authenticated', test.m107_u_b());
select test.eq('H: otro cliente no ve laterales', (select count(*) from public.v_alertas where tipo = 'lateral'), 0::bigint);
select test.denied('H: otro cliente no rota en disco',
  $$select public.neumatico_rotar_disco(971, 3::smallint, null, 'desgaste_lateral', null)$$);

select test.become('authenticated', test.u_admin());
select test.denied('H: el admin del equipo Neumet no rota en disco',
  $$select public.neumatico_rotar_disco(971, 3::smallint, null, 'desgaste_lateral', null)$$);

select test.become('authenticated', test.u_api());
select test.denied('H: la api no rota en disco',
  $$select public.neumatico_rotar_disco(971, 3::smallint, null, 'desgaste_lateral', null)$$);

select test.become('authenticated', test.u_sinperfil());
select test.denied('H: sin perfil no rota en disco',
  $$select public.neumatico_rotar_disco(971, 3::smallint, null, 'desgaste_lateral', null)$$);

select test.become('anon');
select test.denied('H: anon no rota en disco',
  $$select public.neumatico_rotar_disco(971, 3::smallint, null, 'desgaste_lateral', null)$$);
select test.denied('H: anon no alinea',
  $$select public.vehiculo_alinear(971, null, 'control', null)$$);

reset role;
select set_config('request.jwt.claims', '{}', true);
rollback to savepoint s_h;

rollback;
