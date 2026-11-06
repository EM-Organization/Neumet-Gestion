-- Seccionales: perfil global vs. perfiles de seccional (RLS en tablas y vistas), integridad y escritura.
-- Todo ocurre en una transacción que se revierte (no altera las fixtures de los demás tests).
begin;

-- Usuarios de seccional (cliente A): Montevideo (S101) y Salto (S102). S103 pertenece al cliente B.
insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-0000000000c1', 'sa@t'), ('a0000000-0000-0000-0000-0000000000c2', 'sb@t');
insert into public.sucursales (id, cliente_id, nombre) overriding system value values
  (101, 1, 'Montevideo'), (102, 1, 'Salto'), (103, 2, 'Rosario');
insert into public.perfiles (user_id, rol, cliente_id, sucursal_id) values
  ('a0000000-0000-0000-0000-0000000000c1', 'cliente', 1, 101),
  ('a0000000-0000-0000-0000-0000000000c2', 'cliente', 1, 102);
update public.vehiculos set sucursal_id = 101 where id = 1;
update public.vehiculos set sucursal_id = 102 where id = 2;   -- vehículo 4 (inactivo) queda sin seccional
update public.dispositivos set sucursal_id = 101 where mac_address = 'AA:BB:CC:00:00:01';
update public.dispositivos set sucursal_id = 102 where mac_address = 'AA:BB:CC:00:00:02';
insert into public.stock_neumaticos (cliente_id, marca, cantidad) values (1, 'Marca X', 3);
insert into public.eventos_neumatico (cliente_id, vehiculo_id, tipo) values (1, null, 'inspeccion'); -- sin vehículo
create or replace function test.u_sa() returns uuid language sql immutable as $$ select 'a0000000-0000-0000-0000-0000000000c1'::uuid $$;
create or replace function test.u_sb() returns uuid language sql immutable as $$ select 'a0000000-0000-0000-0000-0000000000c2'::uuid $$;
grant execute on function test.u_sa(), test.u_sb() to public;

-- Referencia: lo que ve el perfil GLOBAL del cliente A, restringido a cada vehículo (se calcula como superusuario).
create temp table _ref as
  select 'alertas_v1'::text k, (select count(*) from public.v_alertas where vehiculo_id = 1) n
  union all select 'alertas_v2', (select count(*) from public.v_alertas where vehiculo_id = 2)
  union all select 'med_v1', (select count(*) from public.mediciones where vehiculo_id = 1)
  union all select 'med_v2', (select count(*) from public.mediciones where vehiculo_id = 2)
  union all select 'med_cli1', (select count(*) from public.mediciones where cliente_id = 1)
  union all select 'neum_v1', (select count(*) from public.neumaticos where vehiculo_id = 1)
  union all select 'estado_v1', (select count(*) from public.v_estado_neumaticos where vehiculo_id = 1)
  union all select 'estado_v2', (select count(*) from public.v_estado_neumaticos where vehiculo_id = 2)
  union all select 'estado_cli1', (select count(*) from public.v_estado_neumaticos where cliente_id = 1)
  union all select 'alertas_cli1', (select count(*) from public.v_alertas where cliente_id = 1);
grant select on _ref to public;
create or replace function test.ref(p text) returns bigint language sql stable as $$ select n from pg_temp._ref where k = p $$;
grant execute on function test.ref(text) to public;

-- Perfil GLOBAL (cliente A): ve todo su cliente, incluido lo sin seccional
select test.become('authenticated', test.u_cli_a());
select test.eq('global ve sus 3 vehículos', (select count(*) from public.vehiculos), 3::bigint);
select test.eq('global ve sus 4 dispositivos', (select count(*) from public.dispositivos), 4::bigint);
select test.eq('global ve todas las mediciones del cliente', (select count(*) from public.mediciones), test.ref('med_cli1'));
select test.eq('global ve todo el estado de neumáticos', (select count(*) from public.v_estado_neumaticos), test.ref('estado_cli1'));
select test.eq('global ve todas las alertas', (select count(*) from public.v_alertas), test.ref('alertas_cli1'));
select test.eq('global ve sus 3 eventos (incl. sin vehículo)', (select count(*) from public.eventos_neumatico), 3::bigint);
select test.eq('global ve el stock', (select count(*) from public.stock_neumaticos), 1::bigint);
select test.eq('global ve sus 2 seccionales', (select count(*) from public.sucursales), 2::bigint);
select test.eq('global: resumen cuenta 2 vehículos activos', (select n_vehiculos_activos from public.v_resumen_flota_cliente), 2::bigint);
select test.eq('global no ve la seccional de otro cliente', (select count(*) from public.sucursales where id = 103), 0::bigint);
select test.denied('global no escribe sucursales', $$insert into public.sucursales (cliente_id, nombre) values (1, 'Nueva')$$);
reset role;

-- Seccional A (Montevideo)
select test.become('authenticated', test.u_sa());
select test.eq('seccional MVD: 1 vehículo', (select count(*) from public.vehiculos), 1::bigint);
select test.eq('seccional MVD: solo vehículo 1', (select count(*) from public.vehiculos where id <> 1), 0::bigint);
select test.eq('seccional MVD: 1 dispositivo', (select count(*) from public.dispositivos), 1::bigint);
select test.eq('seccional MVD: neumáticos del vehículo 1', (select count(*) from public.neumaticos), test.ref('neum_v1'));
select test.eq('seccional MVD: mediciones del vehículo 1', (select count(*) from public.mediciones), test.ref('med_v1'));
select test.eq('seccional MVD: 0 mediciones ajenas', (select count(*) from public.mediciones where vehiculo_id is distinct from 1), 0::bigint);
select test.eq('seccional MVD: estado de su vehículo', (select count(*) from public.v_estado_neumaticos), test.ref('estado_v1'));
select test.eq('seccional MVD: alertas de su vehículo', (select count(*) from public.v_alertas), test.ref('alertas_v1'));
select test.eq('seccional MVD: 0 alertas ajenas', (select count(*) from public.v_alertas where vehiculo_id <> 1), 0::bigint);
select test.eq('seccional MVD: salud de su dispositivo', (select count(*) from public.v_salud_dispositivos), 1::bigint);
select test.eq('seccional MVD: eventos de su vehículo', (select count(*) from public.eventos_neumatico), 2::bigint);
select test.eq('seccional MVD: no ve stock', (select count(*) from public.stock_neumaticos), 0::bigint);
select test.eq('seccional MVD: ve solo su seccional', (select string_agg(nombre, ',') from public.sucursales), 'Montevideo');
select test.eq('seccional MVD: resumen de su vehículo', (select n_vehiculos_activos from public.v_resumen_flota_cliente), 1::bigint);
select test.eq('seccional MVD: ve la fila de su cliente', (select count(*) from public.clientes), 1::bigint);
select test.eq('seccional MVD: no ve gastos', (select count(*) from public.gastos), 0::bigint);
select test.eq('seccional MVD: lee su perfil (con su seccional)', (select sucursal_id from public.perfiles), 101::bigint);
-- No puede editar umbrales, ni reasignarse, ni escribir
update public.clientes set umbral_bajo_mm = 9 where id = 1;
select test.eq('seccional MVD no edita umbrales', (select umbral_bajo_mm from public.clientes where id = 1), 8::numeric);
update public.perfiles set sucursal_id = null;
select test.eq('seccional MVD no se vuelve global', (select sucursal_id from public.perfiles), 101::bigint);
update public.vehiculos set sucursal_id = 102 where id = 1;
select test.eq('seccional MVD no mueve vehículos', (select sucursal_id from public.vehiculos where id = 1), 101::bigint);
select test.denied('seccional MVD no inserta vehículos', $$insert into public.vehiculos (cliente_id, nombre, sucursal_id) values (1,'x',101)$$);
select test.denied('seccional MVD no inserta sucursales', $$insert into public.sucursales (cliente_id, nombre) values (1,'Otra')$$);
select test.denied('seccional MVD no rota vehículos de otra seccional', $$select public.neumatico_rotar(2::bigint, 1::smallint, 2::smallint)$$);
reset role;

-- Seccional B (Salto): ve lo suyo y nada de Montevideo
select test.become('authenticated', test.u_sb());
select test.eq('seccional Salto: 1 vehículo (el 2)', (select id from public.vehiculos), 2::bigint);
select test.eq('seccional Salto: mediciones del vehículo 2', (select count(*) from public.mediciones), test.ref('med_v2'));
select test.eq('seccional Salto: estado de su vehículo', (select count(*) from public.v_estado_neumaticos), test.ref('estado_v2'));
select test.eq('seccional Salto: alertas de su vehículo', (select count(*) from public.v_alertas), test.ref('alertas_v2'));
select test.eq('seccional Salto: 0 neumáticos (vehículo 2 no tiene)', (select count(*) from public.neumaticos), 0::bigint);
select test.eq('seccional Salto: 0 eventos', (select count(*) from public.eventos_neumatico), 0::bigint);
select test.eq('seccional Salto: 1 dispositivo', (select mac_address from public.dispositivos), 'AA:BB:CC:00:00:02');
select test.eq('seccional Salto: no ve Montevideo', (select count(*) from public.sucursales where nombre = 'Montevideo'), 0::bigint);
reset role;

-- Aislamiento entre clientes: el cliente B no ve nada de A ni de sus seccionales
select test.become('authenticated', test.u_cli_b());
select test.eq('cliente B: ve solo su seccional', (select string_agg(nombre, ',') from public.sucursales), 'Rosario');
select test.eq('cliente B: 1 vehículo', (select count(*) from public.vehiculos), 1::bigint);
select test.eq('cliente B: 0 vehículos con seccional de A', (select count(*) from public.vehiculos where sucursal_id in (101,102)), 0::bigint);
reset role;

-- Admin ve todo y gestiona
select test.become('authenticated', test.u_admin());
select test.eq('admin ve las 3 seccionales', (select count(*) from public.sucursales), 3::bigint);
select test.eq('admin ve los 4 vehículos', (select count(*) from public.vehiculos), 4::bigint);
update public.vehiculos set sucursal_id = 102 where id = 4;
select test.eq('admin asigna vehículo a seccional', (select sucursal_id from public.vehiculos where id = 4), 102::bigint);
update public.vehiculos set sucursal_id = null where id = 4;
select test.denied('admin: vehículo de A no puede ir a seccional de B (FK compuesta)',
  $$update public.vehiculos set sucursal_id = 103 where id = 1$$, '23503');
select test.denied('admin: dispositivo de A no puede ir a seccional de B',
  $$update public.dispositivos set sucursal_id = 103 where mac_address='AA:BB:CC:00:00:01'$$, '23503');
select test.denied('perfil de cliente A no puede apuntar a seccional de B',
  $$insert into public.perfiles (user_id, rol, cliente_id, sucursal_id) values (test.u_sinperfil(),'cliente',1,103)$$, '23503');
select test.denied('un perfil admin no puede tener seccional',
  $$insert into public.perfiles (user_id, rol, sucursal_id) values (test.u_sinperfil(),'admin',101)$$, '23514');
select test.denied('nombre de seccional duplicado (sin distinguir mayúsculas)',
  $$insert into public.sucursales (cliente_id, nombre) values (1, ' MONTEVIDEO ')$$, '23505');
select test.denied('seccional con nombre vacío', $$insert into public.sucursales (cliente_id, nombre) values (1, '  ')$$, '23514');
select test.denied('no se borra una seccional con vehículos (RESTRICT)', $$delete from public.sucursales where id = 101$$, '23503');
update public.vehiculos set sucursal_id = null where sucursal_id = 101;
update public.dispositivos set sucursal_id = null where sucursal_id = 101;
select test.denied('no se borra una seccional con usuarios (RESTRICT: nadie pasa a global)',
  $$delete from public.sucursales where id = 101$$, '23503');
delete from public.perfiles where sucursal_id = 101;
delete from public.sucursales where id = 101;
select test.eq('admin borra una seccional vacía', (select count(*) from public.sucursales where id = 101), 0::bigint);
reset role;

-- anon: nada
select test.become('anon', null);
select test.denied('anon denegado en sucursales', 'select count(*) from public.sucursales');
select test.denied('anon no puede current_sucursal_id()', 'select public.current_sucursal_id()');
reset role;

-- Estructura
select test.eq('current_sucursal_id es SECURITY DEFINER con search_path fijo',
  (select count(*) from pg_proc p where p.proname='current_sucursal_id' and p.prosecdef
     and exists (select 1 from unnest(p.proconfig) c where c like 'search_path=%')), 1::bigint);
select test.eq('sucursales tiene RLS',
  (select relrowsecurity::int from pg_class where oid = 'public.sucursales'::regclass), 1);
rollback;
