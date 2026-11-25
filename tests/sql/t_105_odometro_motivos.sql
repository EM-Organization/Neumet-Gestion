-- Odómetro obligatorio por cliente (RN-12, CA-12) y motivo de cada movimiento (RN-14, CA-14).
-- Migración 20261126020000_odometro_motivos.sql. Todo en una transacción que se revierte.
-- A: catálogo y privilegios. B: RLS del catálogo por rol. C: flags false (compatibilidad). D0: cada flag gobierna solo lo suyo.
-- D: flags true (exigido). E: rotación decreciente. F: CA-14 por RPC. G: trigger de escrituras directas (el tipo de evento
-- y el tipo de motivo deben corresponder). H: montaje standalone. I: CA-03 (rotar de la 1 a la 7 en un 6x2).
begin;

-- Identidades: usuario global del cliente 1, usuario de la sucursal 1051 del cliente 1, usuario del cliente 2.
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-000000000105', 'g105@t'), ('a0000000-0000-0000-0000-000000000106', 's105@t'),
  ('a0000000-0000-0000-0000-000000000107', 'b105@t');
insert into public.sucursales (id, cliente_id, nombre) overriding system value values (1051, 1, 'Odo Sur');
insert into public.perfiles (user_id, rol, cliente_id, sucursal_id) values
  ('a0000000-0000-0000-0000-000000000105', 'cliente', 1, null),
  ('a0000000-0000-0000-0000-000000000106', 'cliente', 1, 1051),
  ('a0000000-0000-0000-0000-000000000107', 'cliente', 2, null);
create or replace function test.u_g105() returns uuid language sql immutable as $$ select 'a0000000-0000-0000-0000-000000000105'::uuid $$;
create or replace function test.u_s105() returns uuid language sql immutable as $$ select 'a0000000-0000-0000-0000-000000000106'::uuid $$;
create or replace function test.u_b105() returns uuid language sql immutable as $$ select 'a0000000-0000-0000-0000-000000000107'::uuid $$;
grant execute on function test.u_g105(), test.u_s105(), test.u_b105() to public;

-- Vehículos: 105001 sucursal 1051 (3 neumáticos montados); 105002 global (4 montados, pos 5 libre); 105003 sin odómetro;
-- 105004 del cliente 2; 105005 6x2 (CA-03). La distribución 6x2 deriva tipo_ruedas 10 (como en t_98).
insert into public.vehiculos (id, cliente_id, sucursal_id, nombre, patente, tipo_ruedas, activo, odometro_km) values
  (105001, 1, 1051, 'O105 S', 'O105S1', 10, true, 100000),
  (105002, 1, null, 'O105 G', 'O105G1', 10, true, 100000),
  (105003, 1, null, 'O105 N', 'O105N1', 10, true, null),
  (105004, 2, null, 'O105 B', 'O105B1', 10, true, 100000);
insert into public.vehiculos (id, cliente_id, nombre, patente, tipo_ruedas, activo, odometro_km, distribucion) values
  (105005, 1, 'O105 6x2', 'O105X6', 10, true, 100000, '6x2');

create or replace function test.n105(p_idn text, p_veh bigint, p_pos integer)
returns void language sql as $$
  insert into public.neumaticos (vehiculo_id, cliente_id, posicion, idneumatico, estado, marca, km_previos)
  select v.id, v.cliente_id, p_pos, p_idn, 'montado', 'M', 0 from public.vehiculos v where v.id = p_veh $$;
select test.n105('M105-S1', 105001, 1); select test.n105('M105-S2', 105001, 2); select test.n105('M105-S3', 105001, 3);
select test.n105('M105-G1', 105002, 1); select test.n105('M105-G2', 105002, 2);
select test.n105('M105-G3', 105002, 3); select test.n105('M105-G4', 105002, 4);
select test.n105('M105-N1', 105003, 1); select test.n105('M105-N2', 105003, 2);
select test.n105('M105-X1', 105005, 1);

-- Error de una sentencia como (sqlstate|mensaje); «sin error» si no falla. Para comprobar el mensaje y el SQLSTATE.
create or replace function test.err105(p_sql text) returns text language plpgsql as $$
begin
  execute p_sql;
  return 'sin error';
exception when others then
  return sqlstate || '|' || sqlerrm;
end $$;
grant execute on function test.err105(text) to public;

-- ---------------------------------------------------------------------------
-- A. Catálogo, columnas y privilegios (como dueño de la migración)
-- ---------------------------------------------------------------------------
select test.eq('A: catálogo base: baja 6, cambio 4, desmontaje 4, rotación 5 (sin rotacion_disco ni alineacion)',
  (select string_agg(tipo || '=' || n, ' ' order by tipo) from (
     select tipo, count(*) n from public.motivos_movimiento where cliente_id is null group by tipo) s),
  'baja=6 cambio=4 desmontaje=4 rotacion=5');
select test.eq('A: ningún catálogo personalizado sembrado para clientes reales',
  (select count(*) from public.motivos_movimiento where cliente_id is not null), 0::bigint);
select test.eq('A: los dos flags son false por defecto y ningún cliente real se cambió',
  (select string_agg(odometro_obligatorio::text || '/' || odometro_obligatorio_api::text, ',' order by id)
     from public.clientes where id in (1, 2)), 'false/false,false/false');
select test.eq('A: authenticated lee los dos flags y no los actualiza',
  has_column_privilege('authenticated', 'public.clientes', 'odometro_obligatorio', 'select')
  and has_column_privilege('authenticated', 'public.clientes', 'odometro_obligatorio_api', 'select')
  and not has_column_privilege('authenticated', 'public.clientes', 'odometro_obligatorio', 'update')
  and not has_column_privilege('authenticated', 'public.clientes', 'odometro_obligatorio_api', 'update'), true);
select test.eq('A: authenticated no lee precio_mensual (C2 sin cambios)',
  has_column_privilege('authenticated', 'public.clientes', 'precio_mensual', 'select'), false);
select test.eq('A: authenticated lee motivo_codigo y motivo_texto (columnas nuevas otorgadas)',
  has_column_privilege('authenticated', 'public.eventos_neumatico', 'motivo_codigo', 'select')
  and has_column_privilege('authenticated', 'public.eventos_neumatico', 'motivo_texto', 'select'), true);
select test.eq('A: motivos_movimiento solo SELECT para authenticated',
  has_table_privilege('authenticated', 'public.motivos_movimiento', 'select')
  and not has_table_privilege('authenticated', 'public.motivos_movimiento', 'insert')
  and not has_table_privilege('authenticated', 'public.motivos_movimiento', 'update')
  and not has_table_privilege('authenticated', 'public.motivos_movimiento', 'delete'), true);
select test.eq('A: anon sin privilegios sobre motivos_movimiento',
  has_any_column_privilege('anon', 'public.motivos_movimiento', 'select'), false);
select test.eq('A: las funciones nuevas no las ejecuta authenticated directamente',
  has_function_privilege('authenticated', 'public.motivo_movimiento_validar(bigint,text,text,text)', 'execute')
  or has_function_privilege('authenticated', 'public.odometro_obligatorio_validar(bigint,integer)', 'execute')
  or has_function_privilege('authenticated', 'public.odometro_obligatorio_api_validar(bigint,integer)', 'execute'), false);
select test.eq('A: SECURITY DEFINER con search_path vacío en los helpers nuevos',
  (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
     and p.proname in ('motivo_movimiento_validar', 'odometro_obligatorio_validar', 'odometro_obligatorio_api_validar',
                       'eventos_motivo_validar')
     and p.prosecdef and p.proconfig::text like '%search_path=%'), 4::bigint);
select test.eq('A: la etiqueta de paso_direccional_a_traccion es la del brief',
  (select etiqueta from public.motivos_movimiento
    where tipo = 'rotacion' and codigo = 'paso_direccional_a_traccion' and cliente_id is null),
  'Direccional pasa a tracción o eje loco');

-- ---------------------------------------------------------------------------
-- B. RLS del catálogo por rol (catálogo base visible, personalizado solo a su cliente, admin ve todo)
-- ---------------------------------------------------------------------------
insert into public.motivos_movimiento (cliente_id, tipo, codigo, etiqueta) values (2, 'baja', 'zz105', 'Solo cliente B');
select test.become('authenticated', test.u_g105());
select test.eq('B: global del cliente 1 ve el catálogo base (19)',
  (select count(*) from public.motivos_movimiento where cliente_id is null), 19::bigint);
select test.eq('B: global del cliente 1 no ve el personalizado del cliente 2',
  (select count(*) from public.motivos_movimiento where codigo = 'zz105'), 0::bigint);
select test.denied('B: authenticated no inserta en el catálogo',
  $$insert into public.motivos_movimiento (tipo, codigo, etiqueta) values ('baja', 'x105', 'x')$$, '42501');
reset role;
select test.become('authenticated', test.u_s105());
select test.eq('B: sucursal del cliente 1 ve el catálogo base (19)',
  (select count(*) from public.motivos_movimiento where cliente_id is null), 19::bigint);
reset role;
select test.become('authenticated', test.u_b105());
select test.eq('B: cliente 2 ve su personalizado y el base (20)',
  (select count(*) from public.motivos_movimiento where codigo = 'zz105' or cliente_id is null), 20::bigint);
reset role;
select test.become('authenticated', test.u_sinperfil());
select test.eq('B: sin perfil no ve el catálogo', (select count(*) from public.motivos_movimiento), 0::bigint);
reset role;
select test.become('authenticated', test.u_admin());
select test.eq('B: admin del equipo ve el catálogo base y el personalizado (20)',
  (select count(*) from public.motivos_movimiento), 20::bigint);
reset role;
select test.become('anon');
select test.denied('B: anon no lee el catálogo', $$select count(*) from public.motivos_movimiento$$, '42501');
reset role;

-- ---------------------------------------------------------------------------
-- C. Flags false (compatibilidad): request sin odómetro aceptado, sin fabricar km
-- ---------------------------------------------------------------------------
select test.become('authenticated', test.u_g105());
select test.eq('C: montar standalone sin odómetro y sin motivo se acepta (flag false)',
  (public.neumatico_montar(105003, 5::smallint, null, '{"marca":"Z"}', null)->>'odometro_km'), null);
reset role;
select test.eq('C: el odómetro del vehículo no se inventa (sigue null)',
  (select odometro_km from public.vehiculos where id = 105003), null::integer);
select test.eq('C: el evento de montaje sin odómetro queda NULL y sin motivo (Sin dato, no cero)',
  (select (odometro_km is null)::text || '|' || (motivo_codigo is null)::text from public.eventos_neumatico
    where vehiculo_id = 105003 and tipo = 'montaje'), 'true|true');
-- Odómetro con valor pero flag false: funciona igual.
select test.become('authenticated', test.u_g105());
select test.eq('C: con odómetro (flag false) el vehículo sube y la medición lo guarda',
  (public.neumatico_montar(105002, 5::smallint, null, '{"marca":"Z"}', 101000)->>'odometro_km')::int, 101000);
reset role;
select test.eq('C: API sin odómetro con los dos flags en false: alta ok',
  (select (r->>'estado') || '|' || (r->>'creado') from (select public.api_guardar_montaje(1, test.u_api(), 'O105C0',
     '[{"posicion":1,"mm1":9,"mm2":9,"mm3":9},{"posicion":2,"mm1":8,"mm2":8,"mm3":8}]'::jsonb,
     gen_random_uuid(), 'k105-c0', 'h105-c0') r) s), 'ok|true');
select test.become('authenticated', test.u_g105());
select test.eq('C: rotar sin odómetro con los dos flags en false: intercambio',
  (public.neumatico_rotar(105002, 1::smallint, 2::smallint, null, 'diferencia_huellas')->>'intercambio')::boolean::text, 'true');
reset role;

-- ---------------------------------------------------------------------------
-- D0. Independencia de los flags (CA-12): el de movimientos no exige la API y el de la API no exige los movimientos
-- ---------------------------------------------------------------------------
update public.clientes set odometro_obligatorio = true, odometro_obligatorio_api = false where id = 1;
select test.become('authenticated', test.u_g105());
select test.eq('D0: flag de movimientos true: rotar sin odómetro responde 22023 con «odometro»',
  (select split_part(x, '|', 1) || ' ' || (position('odometro' in x) > 0)::text from (select test.err105(
    $$select public.neumatico_rotar(105002, 1::smallint, 2::smallint, null, 'diferencia_huellas')$$) x) s), '22023 true');
reset role;
select test.eq('D0: flag de API false: la API sin odómetro sigue aceptando la alta',
  (select (r->>'estado') || '|' || (r->>'creado') from (select public.api_guardar_montaje(1, test.u_api(), 'O105D0',
     '[{"posicion":1,"mm1":9,"mm2":9,"mm3":9},{"posicion":2,"mm1":8,"mm2":8,"mm3":8}]'::jsonb,
     gen_random_uuid(), 'k105-d0', 'h105-d0') r) s), 'ok|true');
update public.clientes set odometro_obligatorio = false, odometro_obligatorio_api = true where id = 1;
select test.eq('D0: flag de API true: la API sin odómetro responde 22023 con «odometro»',
  (select split_part(x, '|', 1) || ' ' || (position('odometro' in x) > 0)::text from (select test.err105(
    $$select public.api_guardar_montaje(1, test.u_api(), 'O105D1',
       '[{"posicion":1,"mm1":9,"mm2":9,"mm3":9},{"posicion":2,"mm1":8,"mm2":8,"mm3":8}]'::jsonb, gen_random_uuid(), 'k105-d1', 'h105-d1')$$) x) s),
  '22023 true');
select test.become('authenticated', test.u_g105());
select test.eq('D0: flag de movimientos false: rotar sin odómetro se acepta',
  (public.neumatico_rotar(105002, 1::smallint, 2::smallint, null, 'diferencia_huellas')->>'intercambio')::boolean::text, 'true');
reset role;

-- ---------------------------------------------------------------------------
-- D. Flags true: el odómetro es obligatorio (RPC y API)
-- ---------------------------------------------------------------------------
update public.clientes set odometro_obligatorio = true, odometro_obligatorio_api = true where id = 1;
select test.become('authenticated', test.u_g105());
select test.eq('D: montar sin odómetro: 22023 y mensaje con «odometro»',
  (select (split_part(x, '|', 1) || ' ' || (position('odometro' in x) > 0)::text) from (select test.err105(
    $$select public.neumatico_montar(105002, 6::smallint, null, '{"marca":"Z"}', null)$$) x) s), '22023 true');
select test.eq('D: desmontar sin odómetro: 22023',
  split_part(test.err105($$select public.neumatico_desmontar(105002, 4::smallint, 'reparacion', null, null, null, null, p_motivo_codigo => 'otro', p_motivo_texto => 'x')$$), '|', 1), '22023');
select test.eq('D: cambiar sin odómetro: 22023',
  split_part(test.err105($$select public.neumatico_cambiar(p_vehiculo_id => 105002, p_posicion => 3::smallint, p_destino_viejo => 'reparacion', p_motivo => null, p_nuevo => '{"marca":"N"}', p_motivo_codigo => 'otro', p_motivo_texto => 'x')$$), '|', 1), '22023');
select test.eq('D: rotar sin odómetro: 22023 con «odometro»',
  (select split_part(x, '|', 1) || ' ' || (position('odometro' in x) > 0)::text from (select test.err105(
    $$select public.neumatico_rotar(105002, 1::smallint, 2::smallint, null, 'diferencia_huellas')$$) x) s), '22023 true');
select test.eq('D: montar con 123456 sube el odómetro del vehículo (de 101000)',
  (public.neumatico_montar(105002, 6::smallint, null, '{"marca":"Z"}', 123456)->>'odometro_km')::int, 123456);
select test.eq('D: rotar con 123456 (igual al actual) registra el evento con ese odómetro',
  (public.neumatico_rotar(105002, 1::smallint, 2::smallint, 123456, 'diferencia_huellas')->>'intercambio')::boolean, true);
select test.eq('D: el odómetro del vehículo no baja con una rotación igual',
  (select odometro_km from public.vehiculos where id = 105002), 123456);
reset role;

-- D (API): sin odómetro, rechazo; con 123456, todas las mediciones lo guardan y el vehículo sube si era menor.
select test.eq('D: API sin odómetro con flag true: 22023 y mensaje con «odometro»',
  (select split_part(x, '|', 1) || ' ' || (position('odometro' in x) > 0)::text from (select test.err105(
    $$select public.api_guardar_montaje(1, test.u_api(), 'O105A1', '[{"posicion":1,"mm1":9,"mm2":9,"mm3":9},{"posicion":2,"mm1":8,"mm2":8,"mm3":8}]'::jsonb, gen_random_uuid(), 'k105-sin', 'h105-sin')$$) x) s),
  '22023 true');
select test.eq('D: API con 123456: la alta responde ok y crea el vehículo',
  (select (r->>'estado') || '|' || (r->>'creado') from (select public.api_guardar_montaje(1, test.u_api(), 'O105A1',
     '[{"posicion":1,"mm1":9,"mm2":9,"mm3":9},{"posicion":2,"mm1":8,"mm2":8,"mm3":8}]'::jsonb,
     gen_random_uuid(), 'k105-a', 'h105-a', null, 123456) r) s), 'ok|true');
select test.eq('D: API con 123456: ambas mediciones con 123456 y el vehículo en 123456',
  (select string_agg(coalesce(m.odometro_km::text, 'NULL'), ',' order by m.posicion) || '|' ||
          (select odometro_km from public.vehiculos where patente = 'O105A1')
     from public.mediciones m where m.vehiculo_id = (select id from public.vehiculos where patente = 'O105A1')),
  '123456,123456|123456');
select test.eq('D: API con 123456: 2 mediciones en total tras la alta',
  (select count(*) from public.mediciones where vehiculo_id = (select id from public.vehiculos where patente = 'O105A1')), 2::bigint);
select test.eq('D: API replay: replay true y sin mediciones nuevas',
  (select (public.api_guardar_montaje(1, test.u_api(), 'O105A1',
     '[{"posicion":1,"mm1":9,"mm2":9,"mm3":9},{"posicion":2,"mm1":8,"mm2":8,"mm3":8}]'::jsonb,
     gen_random_uuid(), 'k105-a', 'h105-a', null, 123456)->>'replay')::boolean)::text
   || '|' || (select count(*) from public.mediciones where vehiculo_id = (select id from public.vehiculos where patente = 'O105A1'))::text,
  'true|2');
-- Medición con odómetro menor (100 < 123456): se guarda como sospechosa y el vehículo no baja.
select public.api_guardar_montaje(1, test.u_api(), 'O105A1',
  '[{"posicion":1,"mm1":8,"mm2":8,"mm3":8}]'::jsonb, gen_random_uuid(), 'k105-b', 'h105-b', null, 100);
select test.eq('D: API odómetro menor (100): medición guardada con 100 y marcada sospechosa',
  (select m.odometro_km || '|' || m.calidad from public.mediciones m
     where m.vehiculo_id = (select id from public.vehiculos where patente = 'O105A1') order by m.id desc limit 1),
  '100|sospechosa');
select test.eq('D: API odómetro menor: el vehículo se queda en 123456',
  (select odometro_km from public.vehiculos where patente = 'O105A1'), 123456);
-- Vehículo existente con 100000: la API lo sube a 123456 (solo sube).
select public.api_guardar_montaje(1, test.u_api(), 'O105A2', '[{"posicion":1,"mm1":9,"mm2":9,"mm3":9}]'::jsonb,
  gen_random_uuid(), 'k105-e', 'h105-e', null, 100000);
select public.api_guardar_montaje(1, test.u_api(), 'O105A2', '[{"posicion":1,"mm1":8,"mm2":8,"mm3":8}]'::jsonb,
  gen_random_uuid(), 'k105-f', 'h105-f', null, 123456);
select test.eq('D: API sube el odómetro de un vehículo existente si era menor (100000 a 123456)',
  (select odometro_km from public.vehiculos where patente = 'O105A2'), 123456);

-- ---------------------------------------------------------------------------
-- E. Rotación decreciente: se rechaza (la spec lo declara vigente; antes no se rechazaba)
-- ---------------------------------------------------------------------------
select test.become('authenticated', test.u_g105());
select test.eq('E: rotar con odómetro menor al del vehículo: 23514',
  split_part(test.err105($$select public.neumatico_rotar(105002, 1::smallint, 2::smallint, 120000, 'diferencia_huellas')$$), '|', 1), '23514');
select test.eq('E: el vehículo conserva su odómetro tras el rechazo',
  (select odometro_km from public.vehiculos where id = 105002), 123456);
reset role;
-- Montaje con odómetro menor sigue rechazado (comportamiento existente).
select test.become('authenticated', test.u_g105());
select test.eq('E: montar con odómetro menor: 23514 (sin cambio)',
  split_part(test.err105($$select public.neumatico_montar(105002, 7::smallint, null, '{"marca":"Z"}', 1000)$$), '|', 1), '23514');
reset role;
-- Negativo rechazado en RPC. El decimal no llega a la base: PostgREST rechaza el entero y la API responde 400 (commit 31a9f96).
select test.become('authenticated', test.u_g105());
select test.eq('E: odómetro negativo rechazado (23514)',
  split_part(test.err105($$select public.neumatico_rotar(105002, 1::smallint, 2::smallint, -5, 'diferencia_huellas')$$), '|', 1), '23514');
reset role;

-- ---------------------------------------------------------------------------
-- F. CA-14 por RPC: motivo obligatorio con el catálogo del tipo
-- ---------------------------------------------------------------------------
select test.become('authenticated', test.u_g105());
select test.eq('F: rotar sin código: 22023', split_part(test.err105($$select public.neumatico_rotar(105002, 1::smallint, 2::smallint, 123456)$$), '|', 1), '22023');
select test.eq('F: rotar con código inexistente: 22023', split_part(test.err105($$select public.neumatico_rotar(105002, 1::smallint, 2::smallint, 123456, 'no_existe')$$), '|', 1), '22023');
select test.eq('F: rotar con código de otro tipo (baja): 22023', split_part(test.err105($$select public.neumatico_rotar(105002, 1::smallint, 2::smallint, 123456, 'desgaste')$$), '|', 1), '22023');
select test.eq('F: rotar con «otro» sin texto: 22023', split_part(test.err105($$select public.neumatico_rotar(105002, 1::smallint, 2::smallint, 123456, 'otro')$$), '|', 1), '22023');
select test.eq('F: rotar con texto de 301 caracteres: 22023', split_part(test.err105($$select public.neumatico_rotar(105002, 1::smallint, 2::smallint, 123456, 'otro', repeat('x', 301))$$), '|', 1), '22023');
reset role;
-- Código inactivo: se desactiva solo dentro de esta transacción.
update public.motivos_movimiento set activo = false where tipo = 'rotacion' and codigo = 'swap_20000';
select test.become('authenticated', test.u_g105());
select test.eq('F: rotar con código inactivo: 22023', split_part(test.err105($$select public.neumatico_rotar(105002, 1::smallint, 2::smallint, 123456, 'swap_20000')$$), '|', 1), '22023');
reset role;
update public.motivos_movimiento set activo = true where tipo = 'rotacion' and codigo = 'swap_20000';

select test.become('authenticated', test.u_g105());
select test.eq('F: rotar con código válido persiste código, texto nulo, usuario y fecha',
  (public.neumatico_rotar(105002, 1::smallint, 2::smallint, 123456, 'swap_20000')->>'intercambio')::boolean::text, 'true');
reset role;
select test.eq('F: el evento de rotación guarda código, texto nulo, usuario y fecha (ambos eventos)',
  (select string_agg(e.motivo_codigo || '|' || coalesce(e.motivo_texto, 'NULL') || '|' || (e.created_by = test.u_g105())::text || '|' || (e.created_at is not null)::text, ';' order by e.id)
     from public.eventos_neumatico e where e.vehiculo_id = 105002 and e.tipo = 'rotacion' and e.motivo_codigo = 'swap_20000'),
  'swap_20000|NULL|true|true;swap_20000|NULL|true|true');
select test.become('authenticated', test.u_g105());
select test.eq('F: el motivo aparece en el historial que lee el panel (sin columnas de costo)',
  (select count(*) from public.eventos_neumatico where vehiculo_id = 105002 and motivo_codigo = 'swap_20000'), 2::bigint);
reset role;

-- Cambiar: baja usa el catálogo de baja; otros destinos, el de cambio (desgaste, daño, desgaste irregular u otro con texto).
select test.become('authenticated', test.u_g105());
select test.eq('F: cambiar a baja sin código, con el texto antiguo en p_motivo: 22023 (no hay atajo)',
  split_part(test.err105($$select public.neumatico_cambiar(p_vehiculo_id => 105002, p_posicion => 3::smallint, p_destino_viejo => 'baja', p_motivo => 'Desgaste', p_nuevo => '{"marca":"N"}')$$), '|', 1), '22023');
select test.eq('F: cambiar a baja con código de otro tipo (rotación): 22023',
  split_part(test.err105($$select public.neumatico_cambiar(p_vehiculo_id => 105002, p_posicion => 3::smallint, p_destino_viejo => 'baja', p_motivo => null, p_nuevo => '{"marca":"N"}', p_motivo_codigo => 'swap_20000', p_odometro_km => 123456)$$), '|', 1), '22023');
select test.eq('F: cambiar a recauchutado con código de baja (venta): 22023 (cambio no admite códigos de baja)',
  split_part(test.err105($$select public.neumatico_cambiar(p_vehiculo_id => 105002, p_posicion => 3::smallint, p_destino_viejo => 'reencauche', p_motivo => null, p_nuevo => '{"marca":"N"}', p_motivo_codigo => 'venta', p_odometro_km => 123456)$$), '|', 1), '22023');
select test.eq('F: cambiar a reparación con «otro» sin texto: 22023',
  split_part(test.err105($$select public.neumatico_cambiar(p_vehiculo_id => 105002, p_posicion => 3::smallint, p_destino_viejo => 'reparacion', p_motivo => null, p_nuevo => '{"marca":"N"}', p_motivo_codigo => 'otro', p_odometro_km => 123456)$$), '|', 1), '22023');
select test.eq('F: cambiar a reparación con «otro» y texto: persiste',
  (public.neumatico_cambiar(p_vehiculo_id => 105002, p_posicion => 3::smallint, p_destino_viejo => 'reparacion', p_motivo => null, p_nuevo => '{"marca":"N"}', p_motivo_codigo => 'otro', p_motivo_texto => 'Pinchazo lateral', p_odometro_km => 123456)->>'destino_viejo'), 'reparacion');
select test.eq('F: cambiar a reparación con «desgaste» (catálogo de cambio): persiste',
  (public.neumatico_cambiar(p_vehiculo_id => 105002, p_posicion => 3::smallint, p_destino_viejo => 'reparacion', p_motivo => null, p_nuevo => '{"marca":"N"}', p_motivo_codigo => 'desgaste', p_odometro_km => 123456)->>'destino_viejo'), 'reparacion');
select test.eq('F: cambiar a reparación con «traslado» (solo de desmontaje): 22023',
  split_part(test.err105($$select public.neumatico_cambiar(p_vehiculo_id => 105002, p_posicion => 3::smallint, p_destino_viejo => 'reparacion', p_motivo => null, p_nuevo => '{"marca":"N"}', p_motivo_codigo => 'traslado', p_odometro_km => 123456)$$), '|', 1), '22023');
select test.eq('F: cambiar a baja con código válido persiste código y texto (motivo_baja = etiqueta)',
  (public.neumatico_cambiar(p_vehiculo_id => 105002, p_posicion => 4::smallint, p_destino_viejo => 'baja', p_motivo => 'Desgaste', p_nuevo => '{"marca":"N"}', p_motivo_codigo => 'desgaste', p_odometro_km => 123456)->>'destino_viejo'), 'baja');
reset role;
select test.eq('F: el cambio a baja persiste el código en el evento de baja y en el montaje del nuevo',
  (select (select e.motivo_codigo from public.eventos_neumatico e where e.vehiculo_id = 105002 and e.tipo = 'baja' and e.idneumatico = 'M105-G4')
     || ',' || (select e.motivo_codigo from public.eventos_neumatico e where e.vehiculo_id = 105002 and e.tipo = 'montaje' and e.posicion_destino = 4 order by e.id desc limit 1)),
  'desgaste,desgaste');
select test.eq('F: motivo_baja del neumático dado de baja queda con la etiqueta del catálogo',
  (select motivo_baja from public.neumaticos where idneumatico = 'M105-G4'), 'Desgaste');

-- Desmontar: baja usa el catálogo de baja; retiro a reparación, el de desmontaje (con «otro» y texto).
select test.become('authenticated', test.u_g105());
select test.eq('F: desmontar a baja sin código: 22023',
  split_part(test.err105($$select public.neumatico_desmontar(105002, 1::smallint, 'baja', null, 123456)$$), '|', 1), '22023');
select test.eq('F: desmontar a reparación con código de rotación: 22023',
  split_part(test.err105($$select public.neumatico_desmontar(105002, 1::smallint, 'reparacion', null, 123456, null, null, 'swap_20000')$$), '|', 1), '22023');
select test.eq('F: desmontar a reparación con «otro» y texto: persiste',
  (public.neumatico_desmontar(105002, 1::smallint, 'reparacion', null, 123456, null, null, 'otro', 'Retiro de prueba')->>'destino'), 'reparacion');
select test.eq('F: desmontar a reparación: motivo persistido (desmontaje, otro, texto)',
  (select e.motivo_codigo || '|' || e.motivo_texto from public.eventos_neumatico e
    where e.vehiculo_id = 105002 and e.tipo = 'desmontaje' and e.motivo_codigo is not null order by e.id desc limit 1),
  'otro|Retiro de prueba');
select test.eq('F: desmontar a reparación con «desgaste_irregular» (solo de cambio): 22023',
  split_part(test.err105($$select public.neumatico_desmontar(105002, 5::smallint, 'reparacion', null, 123456, null, null, 'desgaste_irregular')$$), '|', 1), '22023');
select test.eq('F: desmontar a reparación con «traslado» (de desmontaje): persiste',
  (public.neumatico_desmontar(105002, 5::smallint, 'reparacion', null, 123456, null, null, 'traslado')->>'destino'), 'reparacion');
select test.eq('F: desmontar a baja con código de rotación: 22023',
  split_part(test.err105($$select public.neumatico_desmontar(105002, 6::smallint, 'baja', null, 123456, null, null, 'swap_20000')$$), '|', 1), '22023');
select test.eq('F: desmontar a baja con «chatarra»: persiste',
  (public.neumatico_desmontar(105002, 6::smallint, 'baja', null, 123456, null, null, 'chatarra')->>'destino'), 'baja');
select test.eq('F: desmontar a baja: motivo_baja queda con la etiqueta del catálogo («Chatarra»)',
  (select count(*) from public.neumaticos where vehiculo_id = 105002 and motivo_baja = 'Chatarra'), 1::bigint);
reset role;

-- Por rol: sucursal del vehículo permitida; otro cliente y api, 42501 (antes que el motivo).
select test.become('authenticated', test.u_s105());
select test.eq('F: sucursal del vehículo rota con código válido',
  (public.neumatico_rotar(105001, 1::smallint, 2::smallint, 100000, 'paso_a_eje_loco')->>'intercambio')::boolean::text, 'true');
select test.eq('F: sucursal sin código: 22023 (la autorización pasa, el motivo falla)',
  split_part(test.err105($$select public.neumatico_rotar(105001, 1::smallint, 3::smallint, 100000)$$), '|', 1), '22023');
reset role;
select test.become('authenticated', test.u_b105());
select test.denied('F: otro cliente no rota aunque el código sea válido',
  $$select public.neumatico_rotar(105001, 1::smallint, 3::smallint, 100000, 'paso_a_eje_loco')$$, '42501');
reset role;
select test.become('authenticated', test.u_api());
select test.denied('F: el rol api no rota (antes que el motivo)',
  $$select public.neumatico_rotar(105001, 1::smallint, 3::smallint, 100000, 'paso_a_eje_loco')$$, '42501');
reset role;
select test.become('authenticated', test.u_b105());
select test.denied('F: otro cliente no cambia (sin código no llega al motivo)',
  $$select public.neumatico_cambiar(p_vehiculo_id => 105001, p_posicion => 1::smallint, p_destino_viejo => 'baja', p_motivo => null, p_nuevo => '{"marca":"N"}')$$, '42501');
reset role;

-- ---------------------------------------------------------------------------
-- G. Escrituras directas (consola, admin): el trigger valida el código contra el catálogo del tipo del evento
-- ---------------------------------------------------------------------------
select test.eq('G: código inexistente en escritura directa: 22023',
  split_part(test.err105($$insert into public.eventos_neumatico (cliente_id, vehiculo_id, idneumatico, tipo, motivo_codigo) values (1, 105002, 'M105-G1', 'rotacion', 'inventado')$$), '|', 1), '22023');
select test.eq('G: «otro» sin texto en escritura directa: 22023',
  split_part(test.err105($$insert into public.eventos_neumatico (cliente_id, vehiculo_id, idneumatico, tipo, motivo_codigo) values (1, 105002, 'M105-G1', 'rotacion', 'otro')$$), '|', 1), '22023');
select test.eq('G: texto de 301 en escritura directa: rechazado por CHECK (23514)',
  split_part(test.err105($$insert into public.eventos_neumatico (cliente_id, vehiculo_id, idneumatico, tipo, motivo_codigo, motivo_texto) values (1, 105002, 'M105-G1', 'rotacion', 'otro', repeat('x', 301))$$), '|', 1), '23514');
select test.eq('G: código del catálogo en escritura directa: se acepta',
  split_part(test.err105($$insert into public.eventos_neumatico (cliente_id, vehiculo_id, idneumatico, tipo, motivo_codigo) values (1, 105002, 'M105-G1', 'rotacion', 'diferencia_huellas')$$), '|', 1), 'sin error');
select test.eq('G: baja con código de rotación (swap_20000): 22023 (el tipo de motivo no corresponde)',
  split_part(test.err105($$insert into public.eventos_neumatico (cliente_id, vehiculo_id, idneumatico, tipo, motivo_codigo) values (1, 105002, 'M105-G1', 'baja', 'swap_20000')$$), '|', 1), '22023');
select test.eq('G: rotación con código de baja (venta): 22023',
  split_part(test.err105($$insert into public.eventos_neumatico (cliente_id, vehiculo_id, idneumatico, tipo, motivo_codigo) values (1, 105002, 'M105-G1', 'rotacion', 'venta')$$), '|', 1), '22023');
select test.eq('G: desmontaje con código de cambio (desgaste_irregular): se acepta (cambiar lo escribe así)',
  split_part(test.err105($$insert into public.eventos_neumatico (cliente_id, vehiculo_id, idneumatico, tipo, motivo_codigo) values (1, 105002, 'M105-G1', 'desmontaje', 'desgaste_irregular')$$), '|', 1), 'sin error');
select test.eq('G: desmontaje con código de desmontaje (traslado): se acepta',
  split_part(test.err105($$insert into public.eventos_neumatico (cliente_id, vehiculo_id, idneumatico, tipo, motivo_codigo) values (1, 105002, 'M105-G1', 'desmontaje', 'traslado')$$), '|', 1), 'sin error');
select test.eq('G: reencauche con código de rotación (swap_20000): 22023',
  split_part(test.err105($$insert into public.eventos_neumatico (cliente_id, vehiculo_id, idneumatico, tipo, motivo_codigo) values (1, 105002, 'M105-G1', 'reencauche', 'swap_20000')$$), '|', 1), '22023');
select test.eq('G: reencauche con código de cambio (desgaste): se acepta',
  split_part(test.err105($$insert into public.eventos_neumatico (cliente_id, vehiculo_id, idneumatico, tipo, motivo_codigo) values (1, 105002, 'M105-G1', 'reencauche', 'desgaste')$$), '|', 1), 'sin error');
select test.eq('G: montaje con código de desmontaje (traslado): 22023',
  split_part(test.err105($$insert into public.eventos_neumatico (cliente_id, vehiculo_id, idneumatico, tipo, motivo_codigo) values (1, 105002, 'M105-G1', 'montaje', 'traslado')$$), '|', 1), '22023');
select test.eq('G: montaje con código de baja (venta), como el de un cambio a baja: se acepta',
  split_part(test.err105($$insert into public.eventos_neumatico (cliente_id, vehiculo_id, idneumatico, tipo, motivo_codigo) values (1, 105002, 'M105-G1', 'montaje', 'venta')$$), '|', 1), 'sin error');
select test.eq('G: montaje sin motivo (montar standalone): se acepta',
  split_part(test.err105($$insert into public.eventos_neumatico (cliente_id, vehiculo_id, idneumatico, tipo) values (1, 105002, 'M105-G1', 'montaje')$$), '|', 1), 'sin error');

-- ---------------------------------------------------------------------------
-- H. Montaje standalone: no lleva motivo (flag true ya exige odómetro, no motivo)
-- ---------------------------------------------------------------------------
select test.become('authenticated', test.u_g105());
select test.eq('H: montar standalone con odómetro y sin código: se acepta',
  (public.neumatico_montar(105001, 5::smallint, null, '{"marca":"Z"}', 100001)->>'odometro_km')::int, 100001);
reset role;

-- ---------------------------------------------------------------------------
-- I. CA-03: rotar de la posición 1 a la 7 en un 6x2, con motivo y odómetro, responde OK (la 7 está libre)
-- ---------------------------------------------------------------------------
select test.become('authenticated', test.u_g105());
select test.eq('I: rotar 1 a 7 en 6x2 con motivo y odómetro: OK, sin intercambio',
  (public.neumatico_rotar(105005, 1::smallint, 7::smallint, 100000, 'paso_direccional_a_traccion')->>'intercambio')::boolean::text, 'false');
reset role;
select test.eq('I: el neumático queda en la 7 y el evento guarda motivo y odómetro',
  (select n.posicion || '|' || e.motivo_codigo || '|' || e.odometro_km from public.neumaticos n
     join public.eventos_neumatico e on e.neumatico_id = n.id and e.tipo = 'rotacion'
      and e.motivo_codigo = 'paso_direccional_a_traccion'
    where n.idneumatico = 'M105-X1' order by e.id desc limit 1),
  '7|paso_direccional_a_traccion|100000');
select test.eq('I: el odómetro del vehículo 6x2 se queda en 100000',
  (select odometro_km from public.vehiculos where id = 105005), 100000);

-- ---------------------------------------------------------------------------
-- K. Quién lee cada flag (docs/07 §4.1). La API lee perfiles → clientes con service_role (supabase_deps.ts, getPerfil), que
-- salta la RLS. El rol api con su propio JWT no ve su fila: current_cliente_id() solo devuelve cliente para el rol cliente.
-- El panel lee odometro_obligatorio con el JWT de rol cliente.
-- ---------------------------------------------------------------------------
update public.clientes set odometro_obligatorio = true, odometro_obligatorio_api = true where id = 1;
set role service_role;
select test.eq('K: service_role (la función de la API) lee odometro_obligatorio_api del cliente 1',
  (select odometro_obligatorio_api from public.clientes where id = 1), true);
reset role;
select test.become('authenticated', test.u_api());
select test.eq('K: el rol api con su JWT no ve la fila del cliente: la RLS no le da cliente_id',
  (select count(*) from public.clientes where id = 1), 0::bigint);
reset role;
select test.become('authenticated', test.u_g105());
select test.eq('K: el cliente lee odometro_obligatorio del panel con su JWT',
  (select odometro_obligatorio from public.clientes where id = 1), true);
reset role;

update public.clientes set odometro_obligatorio = false, odometro_obligatorio_api = false where id = 1;

rollback;
