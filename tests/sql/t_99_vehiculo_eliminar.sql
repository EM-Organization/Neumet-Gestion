-- Eliminar vehículo (migración 20261124000000_vehiculo_eliminar.sql): RPC vehiculo_eliminar, baja lógica
-- (deleted_at), RLS que oculta el vehículo eliminado y reutilización de patente/número.
-- Matriz por rol: administrador de empresa (OK), administrador de otra empresa, usuario de sucursal, equipo Neumet,
-- api, sin perfil, anon. La concurrencia (dos sesiones) está en concurrencia_vehiculo_eliminar.sh.
-- Todo en una transacción que se revierte.
begin;

insert into auth.users (id, email) values ('a0000000-0000-0000-0000-0000000000e2', 'suc99@t');
insert into public.sucursales (id, cliente_id, nombre) overriding system value values (991, 1, 'Norte 99');
insert into public.perfiles (user_id, rol, cliente_id, sucursal_id) values
  ('a0000000-0000-0000-0000-0000000000e2', 'cliente', 1, 991);
create or replace function test.u_e2() returns uuid language sql immutable as $$ select 'a0000000-0000-0000-0000-0000000000e2'::uuid $$;
grant execute on function test.u_e2() to public;

insert into public.vehiculos (id, cliente_id, nombre, patente, numero, activo, sucursal_id) values
  (9901, 1, 'T99 a stock',   'EL9901', '9901', true, 991),
  (9902, 1, 'T99 a baja',    'EL9902', '9902', true, 991),
  (9903, 1, 'T99 sin neum.', 'EL9903', '9903', true, null),
  (9904, 1, 'T99 sin quema', 'EL9904', '9904', true, null),
  (9905, 2, 'T99 ajeno',     'EL9905', '9905', true, null),
  (9906, 1, 'T99 sucursal',  'EL9906', '9906', true, 991),
  (9907, 1, 'T99 baja prev', 'EL9907', '9907', true, null);
insert into public.neumaticos (vehiculo_id, cliente_id, posicion, idneumatico, estado, condicion, numero_quema) values
  (9901, 1, 1, 'N-9901-1', 'montado', 'usado',     'Q9901-1'),
  (9901, 1, 2, 'N-9901-2', 'montado', 'reparado',  'Q9901-2'),
  (9902, 1, 1, 'N-9902-1', 'montado', 'usado',     'Q9902-1'),
  (9902, 1, 2, 'N-9902-2', 'montado', 'usado',     null),
  (9904, 1, 1, 'N-9904-1', 'montado', 'usado',     null),
  (9904, 1, 2, 'N-9904-2', 'montado', 'usado',     'Q9904-2'),
  (9905, 2, 1, 'N-9905-1', 'montado', 'usado',     'Q9905-1'),
  (9906, 1, 1, 'N-9906-1', 'montado', 'usado',     'Q9906-1'),
  (9907, 1, 1, 'N-9907-1', 'montado', 'usado',     'Q9907-1');
-- Un neumático ya dado de baja del vehículo 9907 (no se toca) y otro montado.
update public.neumaticos set estado = 'baja', fecha_baja = '2026-01-01', motivo_baja = 'previa', posicion = 50
 where idneumatico = 'N-9907-1';
insert into public.neumaticos (vehiculo_id, cliente_id, posicion, idneumatico, estado, condicion, numero_quema) values
  (9907, 1, 2, 'N-9907-2', 'montado', 'usado', 'Q9907-2');

-- ---- A. Denegados: nada cambia --------------------------------------------------------------------------------------
select test.become('authenticated', test.u_admin());
select test.denied('A: equipo Neumet no elimina', $$select public.vehiculo_eliminar(9901, 'stock')$$, '42501');
select test.become('authenticated', test.u_e2());
select test.denied('A: usuario de sucursal no elimina', $$select public.vehiculo_eliminar(9906, 'stock')$$, '42501');
select test.become('authenticated', test.u_api());
select test.denied('A: api no elimina', $$select public.vehiculo_eliminar(9901, 'stock')$$, '42501');
select test.become('authenticated', test.u_sinperfil());
select test.denied('A: sin perfil no elimina', $$select public.vehiculo_eliminar(9901, 'stock')$$, '42501');
select test.become('anon', null);
select test.denied('A: anon sin ejecución', $$select public.vehiculo_eliminar(9901, 'stock')$$);
select test.become('authenticated', test.u_cli_b());
select test.denied('A: administrador de otra empresa no elimina', $$select public.vehiculo_eliminar(9901, 'stock')$$, '42501');
select test.become('authenticated', test.u_cli_a());
select test.denied('A: vehículo de otra empresa', $$select public.vehiculo_eliminar(9905, 'stock')$$, '42501');
select test.denied('A: vehículo inexistente', $$select public.vehiculo_eliminar(999999, 'stock')$$, '42501');
select test.denied('A: sin id', $$select public.vehiculo_eliminar(null, 'stock')$$, '22004');
reset role;
select test.eq('A: ningún vehículo cambió',
  (select count(*) from public.vehiculos where id between 9901 and 9907 and deleted_at is not null), 0::bigint);
select test.eq('A: ningún neumático cambió',
  (select count(*) from public.neumaticos where vehiculo_id between 9901 and 9907 and estado = 'baja'), 1::bigint);

-- ---- B. Validación de parámetros -----------------------------------------------------------------------------------
select test.become('authenticated', test.u_cli_a());
select test.denied('B: con neumáticos y sin destino', $$select public.vehiculo_eliminar(9901)$$, '22023');
select test.denied('B: con neumáticos y destino vacío', $$select public.vehiculo_eliminar(9901, '  ')$$, '22023');
select test.denied('B: destino desconocido', $$select public.vehiculo_eliminar(9901, 'borrar')$$, '22023');
select test.denied('B: destino desconocido en vehículo sin neumáticos', $$select public.vehiculo_eliminar(9903, 'x')$$, '22023');
select test.denied('B: stock con un neumático sin quema', $$select public.vehiculo_eliminar(9904, 'stock')$$, '22023');
reset role;
select test.eq('B: nada cambió tras los rechazos',
  (select count(*) from public.vehiculos where id in (9901, 9903, 9904) and deleted_at is not null), 0::bigint);
select test.eq('B: los neumáticos del vehículo sin quema siguen montados',
  (select count(*) from public.neumaticos where vehiculo_id = 9904 and estado = 'montado'), 2::bigint);

-- ---- C. Destino stock ---------------------------------------------------------------------------------------------
create temp table _r (k text, r jsonb);
grant all on _r to public;
select test.become('authenticated', test.u_cli_a());
insert into _r select 'stock', public.vehiculo_eliminar(9901, 'stock');
reset role;
select test.eq('C: resumen', (select r->>'neumaticos' || '/' || (r->>'destino') from _r where k = 'stock'), '2/stock');
select test.eq('C: vehículo marcado, inactivo, sin patente ni número ni sucursal, originales guardados',
  (select (deleted_at is not null)::text || '|' || activo::text || '|' || coalesce(patente, 'null') || '|' || coalesce(numero, 'null')
       || '|' || coalesce(sucursal_id::text, 'null') || '|' || patente_baja || '|' || numero_baja
     from public.vehiculos where id = 9901), 'true|false|null|null|null|EL9901|9901');
select test.eq('C: quién eliminó', (select deleted_by from public.vehiculos where id = 9901), test.u_cli_a());
select test.eq('C: neumáticos en stock de la sucursal del vehículo, con su condición y su quema',
  (select string_agg(estado || '|' || coalesce(vehiculo_id::text, 'null') || '|' || coalesce(posicion::text, 'null') || '|'
                     || sucursal_id || '|' || condicion || '|' || numero_quema, ',' order by idneumatico)
     from public.neumaticos where idneumatico like 'N-9901-%'),
  'almacenado|null|null|991|usado|Q9901-1,almacenado|null|null|991|reparado|Q9901-2');
select test.eq('C: un evento desmontaje por neumático, con el vehículo y el actor',
  (select count(*) from public.eventos_neumatico where vehiculo_id = 9901 and tipo = 'desmontaje'
      and notas like 'Vehículo eliminado%' and created_by = test.u_cli_a() and sucursal_destino_id = 991), 2::bigint);

-- ---- D. Destino baja ----------------------------------------------------------------------------------------------
select test.become('authenticated', test.u_cli_a());
insert into _r select 'baja', public.vehiculo_eliminar(9902, 'baja');
reset role;
select test.eq('D: neumáticos dados de baja con motivo y fecha (aunque no tengan quema)',
  (select string_agg(estado || '|' || (fecha_baja = current_date)::text || '|' || motivo_baja, ',' order by idneumatico)
     from public.neumaticos where idneumatico like 'N-9902-%'),
  'baja|true|Baja del vehículo,baja|true|Baja del vehículo');
select test.eq('D: un evento baja por neumático',
  (select count(*) from public.eventos_neumatico where vehiculo_id = 9902 and tipo = 'baja' and created_by = test.u_cli_a()), 2::bigint);
select test.eq('D: el vehículo quedó eliminado', (select deleted_at is not null from public.vehiculos where id = 9902), true);

-- Un neumático ya en baja no se toca ni cuenta: queda con su motivo anterior.
select test.become('authenticated', test.u_cli_a());
insert into _r select 'prev', public.vehiculo_eliminar(9907, 'stock');
reset role;
select test.eq('D2: solo cuenta el neumático no dado de baja', (select r->>'neumaticos' from _r where k = 'prev'), '1');
select test.eq('D2: el de baja previa conserva motivo y vehículo',
  (select motivo_baja || '|' || vehiculo_id from public.neumaticos where idneumatico = 'N-9907-1'), 'previa|9907');

-- ---- E. Sin neumáticos: el destino no hace falta --------------------------------------------------------------------
select test.become('authenticated', test.u_cli_a());
insert into _r select 'vacio', public.vehiculo_eliminar(9903);
reset role;
select test.eq('E: resumen sin neumáticos', (select (r->>'neumaticos') || '|' || coalesce(r->>'destino', 'null') from _r where k = 'vacio'), '0|null');
select test.eq('E: eliminado', (select deleted_at is not null from public.vehiculos where id = 9903), true);

-- ---- F. Ya eliminado: error claro, nada se repite --------------------------------------------------------------------
select test.become('authenticated', test.u_cli_a());
select test.denied('F: reintento sobre un vehículo ya eliminado', $$select public.vehiculo_eliminar(9901, 'stock')$$, 'P0002');
reset role;
select test.eq('F: no se duplicaron los eventos', (select count(*) from public.eventos_neumatico where vehiculo_id = 9901 and tipo = 'desmontaje'), 2::bigint);

-- ---- G. Visibilidad: nadie ve el vehículo eliminado ---------------------------------------------------------------
select test.become('authenticated', test.u_cli_a());
select test.eq('G: el administrador de empresa no lo ve', (select count(*) from public.vehiculos where id in (9901, 9902, 9903)), 0::bigint);
select test.eq('G: sigue viendo los demás', (select count(*) from public.vehiculos where id in (9904, 9906)), 2::bigint);
select test.eq('G: los neumáticos de baja del vehículo eliminado no se ven', (select count(*) from public.neumaticos where idneumatico like 'N-9902-%'), 0::bigint);
select test.eq('G: los que fueron al stock sí se ven', (select count(*) from public.neumaticos where idneumatico like 'N-9901-%' and vehiculo_id is null), 2::bigint);
select test.eq('G: ni el estado de neumáticos de v_estado_neumaticos', (select count(*) from public.v_estado_neumaticos where vehiculo_id in (9901, 9902, 9903)), 0::bigint);
select test.become('authenticated', test.u_admin());
select test.eq('G: el equipo Neumet tampoco', (select count(*) from public.vehiculos where id in (9901, 9902, 9903)), 0::bigint);
select test.become('authenticated', test.u_e2());
select test.eq('G: ni el usuario de sucursal', (select count(*) from public.vehiculos where id in (9901, 9902, 9903)), 0::bigint);
reset role;

-- Las RPC que operan por id tratan un vehículo eliminado como inexistente.
select test.become('authenticated', test.u_cli_a());
select test.denied('G: no se corrige el odómetro de un vehículo eliminado', $$select public.vehiculo_corregir_odometro(9901, 0)$$, '42501');
select test.denied('G: no se retira un neumático de un vehículo eliminado',
  $$select public.neumatico_desmontar(9902, 1::smallint, 'baja', 'x', p_motivo_codigo => 'desgaste')$$, '42501');
select test.denied('G: no se mueve de sucursal', $$select public.vehiculo_mover_sucursal(9901, 991)$$, '42501');
reset role;

-- Lecturas por función SECURITY DEFINER (no pasan por la RLS): el neumático dado de baja con el vehículo eliminado
-- no se lista ni se calcula, ni para el administrador de empresa ni para el equipo Neumet.
reset role;
update public.neumaticos set precio_unidad = 1000 where idneumatico in ('N-9902-1', 'N-9901-1');
create temp table _n (k text, id bigint);
grant all on _n to public;
insert into _n select 'baja', id from public.neumaticos where idneumatico = 'N-9902-1';
insert into _n select 'stock', id from public.neumaticos where idneumatico = 'N-9901-1';
select test.become('authenticated', test.u_cli_a());
select test.eq('G: neumaticos_precios(vehículo eliminado) vacío para el global',
  (select count(*) from public.neumaticos_precios(9902)), 0::bigint);
select test.eq('G: neumaticos_precios sin filtro no trae el neumático de baja (global)',
  (select count(*) from public.neumaticos_precios() p where p.id = (select id from _n where k = 'baja')), 0::bigint);
select test.eq('G: neumaticos_precios sí trae el que volvió al stock (global)',
  (select count(*) from public.neumaticos_precios() p where p.id = (select id from _n where k = 'stock')), 1::bigint);
select test.eq('G: costo_cubierta_items del neumático de baja vacío (global)',
  (select count(*) from public.costo_cubierta_items((select id from _n where k = 'baja'))), 0::bigint);
select test.eq('G: costo_vida_items del neumático de baja vacío (global)',
  (select count(*) from public.costo_vida_items((select id from _n where k = 'baja'))), 0::bigint);
select test.eq('G: km_tramos_cubierta del neumático de baja vacío (global)',
  (select count(*) from public.km_tramos_cubierta((select id from _n where k = 'baja'))), 0::bigint);
select test.eq('G: costo_cubierta_items del que volvió al stock sí responde (global)',
  (select count(*) from public.costo_cubierta_items((select id from _n where k = 'stock'))), 1::bigint);
select test.become('authenticated', test.u_admin());
select test.eq('G: neumaticos_precios(vehículo eliminado) vacío para el equipo Neumet',
  (select count(*) from public.neumaticos_precios(9902)), 0::bigint);
select test.eq('G: neumaticos_precios sin filtro no trae el neumático de baja (equipo Neumet)',
  (select count(*) from public.neumaticos_precios() p where p.id = (select id from _n where k = 'baja')), 0::bigint);
select test.eq('G: costo_cubierta_items del neumático de baja vacío (equipo Neumet)',
  (select count(*) from public.costo_cubierta_items((select id from _n where k = 'baja'))), 0::bigint);
select test.eq('G: costo_vida_items del neumático de baja vacío (equipo Neumet)',
  (select count(*) from public.costo_vida_items((select id from _n where k = 'baja'))), 0::bigint);
select test.eq('G: km_tramos_cubierta del neumático de baja vacío (equipo Neumet)',
  (select count(*) from public.km_tramos_cubierta((select id from _n where k = 'baja'))), 0::bigint);
select test.eq('G: costo_cubierta_items del que volvió al stock sí responde (equipo Neumet)',
  (select count(*) from public.costo_cubierta_items((select id from _n where k = 'stock'))), 1::bigint);
reset role;
select test.eq('G: anon no ejecuta vehiculo_eliminar',
  has_function_privilege('anon', 'public.vehiculo_eliminar(bigint, text)', 'execute'), false);
select test.eq('G: authenticated sí ejecuta vehiculo_eliminar',
  has_function_privilege('authenticated', 'public.vehiculo_eliminar(bigint, text)', 'execute'), true);

-- ---- H. Patente y número se pueden reutilizar -----------------------------------------------------------------------
select test.become('authenticated', test.u_cli_a());
insert into _r select 'nuevo', public.vehiculo_crear('9901', 'EL9901');
reset role;
select test.eq('H: se crea otro vehículo con el mismo número y matrícula',
  (select count(*) from public.vehiculos where cliente_id = 1 and patente = 'EL9901' and numero = '9901' and deleted_at is null), 1::bigint);

-- ---- I. La baja de la sucursal ya no queda trabada por vehículos eliminados -------------------------------------
select test.eq('I: ningún vehículo eliminado conserva sucursal',
  (select count(*) from public.vehiculos where id in (9901, 9902, 9907) and sucursal_id is not null), 0::bigint);

-- ---- J. Atomicidad: si un neumático falla, no se guarda nada ----------------------------------------------------
-- La guarda de recauchutado rechaza mover un neumático enviado a recauchutar: el vehículo y los otros neumáticos no cambian.
reset role;
insert into public.vehiculos (id, cliente_id, nombre, patente, activo) values (9908, 1, 'T99 reca', 'EL9908', true);
insert into public.neumaticos (id, vehiculo_id, cliente_id, posicion, idneumatico, estado, condicion, numero_quema) values
  (990801, 9908, 1, 1, 'N-9908-1', 'montado', 'usado', 'Q9908-1'),
  (990802, 9908, 1, 2, 'N-9908-2', 'montado', 'usado', 'Q9908-2');
insert into public.recauchutados (cliente_id, neumatico_id, vida_origen, proveedor, estado)
  values (1, 990802, 0, 'Proveedor 99', 'enviado');
select test.become('authenticated', test.u_cli_a());
select test.denied('J: un neumático en recauchutado impide eliminar', $$select public.vehiculo_eliminar(9908, 'baja')$$, '55000');
reset role;
select test.eq('J: el vehículo sigue vigente', (select deleted_at is null from public.vehiculos where id = 9908), true);
select test.eq('J: el primer neumático (procesado antes del fallo) no quedó en baja',
  (select estado from public.neumaticos where id = 990801), 'montado');
select test.eq('J: sin eventos a medias', (select count(*) from public.eventos_neumatico where vehiculo_id = 9908), 0::bigint);

rollback;
