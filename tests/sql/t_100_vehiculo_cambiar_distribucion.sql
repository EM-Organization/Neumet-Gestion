-- Cambiar la distribución de un vehículo (migración 20261125500000_vehiculo_cambiar_distribucion.sql).
-- Matriz por rol: administrador de empresa (OK), usuario de la sucursal del vehículo (OK), usuario de otra sucursal,
-- equipo Neumet, otra empresa, api, sin perfil, anon (rechazados). Reglas: no reducir por debajo de lo montado,
-- el auxilio (99) no cuenta, tipo_ruedas derivado, «otra» deja la distribución sin definir.
-- Todo en una transacción que se revierte.
begin;

insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-0000000000d1', 'sucA100@t'),
  ('a0000000-0000-0000-0000-0000000000d2', 'sucB100@t');
insert into public.sucursales (id, cliente_id, nombre) overriding system value values (1001, 1, 'Norte 100'), (1002, 1, 'Sur 100');
insert into public.perfiles (user_id, rol, cliente_id, sucursal_id) values
  ('a0000000-0000-0000-0000-0000000000d1', 'cliente', 1, 1001),
  ('a0000000-0000-0000-0000-0000000000d2', 'cliente', 1, 1002);
create or replace function test.u_d1() returns uuid language sql immutable as $$ select 'a0000000-0000-0000-0000-0000000000d1'::uuid $$;
create or replace function test.u_d2() returns uuid language sql immutable as $$ select 'a0000000-0000-0000-0000-0000000000d2'::uuid $$;
grant execute on function test.u_d1(), test.u_d2() to public;

insert into public.vehiculos (id, cliente_id, nombre, patente, numero, activo, sucursal_id, tipo_ruedas, distribucion) values
  (10001, 1, 'T100 sin definir', 'CD1001', '10001', true, 1001, 10, null),
  (10002, 1, 'T100 con carga',   'CD1002', '10002', true, null, 16, '8x4'),
  (10003, 1, 'T100 auxilio',     'CD1003', '10003', true, null, 10, '6x4'),
  (10004, 2, 'T100 ajeno',       'CD1004', '10004', true, null, 10, null);
-- 10002: neumáticos en 1, 2 y 11 (8x4 = 12 ruedas) y una cubierta ya dada de baja en 12 (no cuenta).
insert into public.neumaticos (vehiculo_id, cliente_id, posicion, idneumatico, estado, condicion, numero_quema) values
  (10002, 1, 1,  'N-10002-1',  'montado', 'usado', 'Q10002-1'),
  (10002, 1, 2,  'N-10002-2',  'montado', 'usado', 'Q10002-2'),
  (10002, 1, 11, 'N-10002-11', 'montado', 'usado', 'Q10002-11'),
  (10002, 1, 12, 'N-10002-12', 'montado', 'usado', 'Q10002-12'),
  (10003, 1, 1,  'N-10003-1',  'montado', 'usado', 'Q10003-1'),
  (10003, 1, 99, 'N-10003-99', 'montado', 'usado', 'Q10003-99');
update public.neumaticos set estado = 'baja', fecha_baja = '2026-01-01', motivo_baja = 'previa', posicion = 12
 where idneumatico = 'N-10002-12';

-- ---- A. Denegados: nada cambia --------------------------------------------------------------------------------------
select test.become('authenticated', test.u_admin());
select test.denied('A: equipo Neumet no cambia', $$select public.vehiculo_cambiar_distribucion(10001, '6x2')$$, '42501');
select test.become('authenticated', test.u_d2());
select test.denied('A: usuario de otra sucursal no cambia', $$select public.vehiculo_cambiar_distribucion(10001, '6x2')$$, '42501');
select test.become('authenticated', test.u_api());
select test.denied('A: api no cambia', $$select public.vehiculo_cambiar_distribucion(10001, '6x2')$$, '42501');
select test.become('authenticated', test.u_sinperfil());
select test.denied('A: sin perfil no cambia', $$select public.vehiculo_cambiar_distribucion(10001, '6x2')$$, '42501');
select test.become('anon', null);
select test.denied('A: anon sin ejecución', $$select public.vehiculo_cambiar_distribucion(10001, '6x2')$$);
select test.become('authenticated', test.u_cli_b());
select test.denied('A: otra empresa no cambia', $$select public.vehiculo_cambiar_distribucion(10001, '6x2')$$, '42501');
select test.become('authenticated', test.u_cli_a());
select test.denied('A: vehículo de otra empresa', $$select public.vehiculo_cambiar_distribucion(10004, '6x2')$$, '42501');
select test.denied('A: vehículo inexistente', $$select public.vehiculo_cambiar_distribucion(999999, '6x2')$$, '42501');
select test.denied('A: sin id', $$select public.vehiculo_cambiar_distribucion(null, '6x2')$$, '22004');
reset role;
select test.eq('A: ningún vehículo cambió',
  (select count(*) from public.vehiculos where id = 10001 and distribucion is null and tipo_ruedas = 10), 1::bigint);

-- ---- B. Validación ----------------------------------------------------------------------------------------------------
select test.become('authenticated', test.u_cli_a());
select test.denied('B: sin distribución', $$select public.vehiculo_cambiar_distribucion(10001, '  ')$$, '22023');
select test.denied('B: distribución desconocida', $$select public.vehiculo_cambiar_distribucion(10001, '2x2')$$, '23514');
select test.denied('B: «otra» sin tipo de ruedas', $$select public.vehiculo_cambiar_distribucion(10001, 'otra')$$, '23514');
select test.denied('B: «otra» con tipo inválido', $$select public.vehiculo_cambiar_distribucion(10001, 'otra', 12::smallint)$$, '23514');
-- ---- C. No reducir por debajo de lo montado --------------------------------------------------------------------------
select test.denied('C: 8x4 (12) a 6x4 (10) con neumático en la 11 (la 12 está dada de baja y no cuenta)',
  $$select public.vehiculo_cambiar_distribucion(10002, '6x4')$$, '23514');
select test.denied('C: «otra» de 10 ruedas tampoco', $$select public.vehiculo_cambiar_distribucion(10002, 'otra', 10::smallint)$$, '23514');
reset role;
select test.eq('C: el vehículo con carga no cambió',
  (select distribucion || '|' || tipo_ruedas from public.vehiculos where id = 10002), '8x4|16');

-- ---- D. Cambios válidos -----------------------------------------------------------------------------------------------
select test.become('authenticated', test.u_cli_a());
select test.eq('D: administrador de empresa define la distribución (sin definir -> 6x2, tipo 10)',
  (select public.vehiculo_cambiar_distribucion(10001, '6x2')->>'distribucion'), '6x2');
select test.eq('D: mismo valor es idempotente', (select public.vehiculo_cambiar_distribucion(10001, '6x2')->>'tipo_ruedas'), '10');
select test.eq('D: el auxilio (99) no impide reducir',
  (select public.vehiculo_cambiar_distribucion(10003, '4x2')->>'distribucion'), '4x2');
select test.eq('D: 8x4 -> 8x4 con carga hasta la 11 es válido y deriva 16',
  (select public.vehiculo_cambiar_distribucion(10002, '8x4')->>'tipo_ruedas'), '16');
reset role;
select test.eq('D: guardado en la tabla', (select distribucion || '|' || tipo_ruedas from public.vehiculos where id = 10001), '6x2|10');
select test.become('authenticated', test.u_d1());
select test.eq('D: usuario de la sucursal del vehículo cambia a 8x4 (tipo 16)',
  (select public.vehiculo_cambiar_distribucion(10001, '8x4')->>'tipo_ruedas'), '16');
select test.eq('D: «otra» deja sin distribución con el tipo elegido',
  (select coalesce(public.vehiculo_cambiar_distribucion(10001, 'otra', 10::smallint)->>'distribucion', 'null')), 'null');
reset role;
select test.eq('D: queda NULL y tipo 10', (select coalesce(distribucion, 'null') || '|' || tipo_ruedas from public.vehiculos where id = 10001), 'null|10');
select test.eq('D: los neumáticos no se tocaron',
  (select count(*) from public.neumaticos where vehiculo_id = 10002 and estado = 'montado'), 3::bigint);
select test.eq('D: anon no ejecuta', has_function_privilege('anon', 'public.vehiculo_cambiar_distribucion(bigint, text, smallint)', 'execute'), false);

rollback;
