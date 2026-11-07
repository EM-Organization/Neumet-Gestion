-- Gestión de sucursales (sucursal_*, vehiculo_crear, vehiculo_mover_sucursal): autorización por rol,
-- aislamiento entre clientes, borrado restringido, conservación del historial y auditoría.
-- Todo en una transacción que se revierte; cada escenario vuelve a un savepoint.
begin;

insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-0000000000f1', 'sa80@t'), ('a0000000-0000-0000-0000-0000000000f2', 'sb80@t');
insert into public.sucursales (id, cliente_id, nombre) overriding system value values
  (301, 1, 'Norte'), (302, 1, 'Sur'), (303, 2, 'Ajena B');
insert into public.perfiles (user_id, rol, cliente_id, sucursal_id) values
  ('a0000000-0000-0000-0000-0000000000f1', 'cliente', 1, 301),
  ('a0000000-0000-0000-0000-0000000000f2', 'cliente', 2, 303);
update public.vehiculos set sucursal_id = 301 where id = 1;
update public.vehiculos set sucursal_id = null where id = 2;
create or replace function test.u_s80a() returns uuid language sql immutable as $$ select 'a0000000-0000-0000-0000-0000000000f1'::uuid $$;
create or replace function test.u_s80b() returns uuid language sql immutable as $$ select 'a0000000-0000-0000-0000-0000000000f2'::uuid $$;
grant execute on function test.u_s80a(), test.u_s80b() to public;
savepoint s0;

-- Permisos de ejecución
select test.become('anon', null);
select test.denied('anon no crea sucursales', $$select public.sucursal_crear('X')$$);
select test.denied('anon no mueve vehículos', $$select public.vehiculo_mover_sucursal(1::bigint, 301::bigint)$$);
reset role;
select test.become('authenticated', test.u_admin());
select test.denied('helper de gestión no invocable', $$select * from public.sucursal_autorizar_gestion(1::bigint)$$);
select test.denied('helper por id no invocable', $$select * from public.sucursal_autorizar_por_id(301::bigint)$$);
reset role;

-- Cliente GLOBAL (cliente A): crea, renombra, mueve, agrega, elimina
select test.become('authenticated', test.u_cli_a());
select test.eq('global crea sucursal', (public.sucursal_crear('  Este  ')->>'nombre'), 'Este');
select test.eq('la sucursal queda en su cliente', (select cliente_id from public.sucursales where nombre = 'Este'), 1::bigint);
select test.denied('nombre repetido (sin distinguir mayúsculas)', $$select public.sucursal_crear('norte')$$, '23505');
select test.denied('nombre vacío', $$select public.sucursal_crear('   ')$$, '23514');
select test.denied('nombre demasiado largo', $$select public.sucursal_crear(repeat('x', 101))$$, '23514');
select test.denied('global no crea en otro cliente (p_cliente_id ajeno)', $$select public.sucursal_crear('Colada', 2::bigint)$$);
select test.eq('global renombra', (public.sucursal_renombrar(302::bigint, 'Sur 2')->>'nombre'), 'Sur 2');
select test.denied('renombrar a un nombre existente', $$select public.sucursal_renombrar(302::bigint, 'Norte')$$, '23505');
select test.denied('global no renombra la sucursal de otro cliente', $$select public.sucursal_renombrar(303::bigint, 'Hack')$$);
select test.denied('sucursal inexistente: mismo error que ajena', $$select public.sucursal_renombrar(99999::bigint, 'Hack')$$);
reset role;
select test.eq('la sucursal ajena no cambió', (select nombre from public.sucursales where id = 303), 'Ajena B');

select test.become('authenticated', test.u_cli_a());
-- Mover vehículo 2 (sin sucursal) a 302 y luego a Norte; historial intacto
reset role;
create temp table _h as select
  (select count(*) from public.mediciones where vehiculo_id = 1) med,
  (select count(*) from public.neumaticos where vehiculo_id = 1) neum,
  (select count(*) from public.eventos_neumatico where vehiculo_id = 1) ev,
  (select count(*) from public.v_estado_neumaticos where vehiculo_id = 1) estado,
  (select count(*) from public.v_alertas where vehiculo_id = 1) alertas;
grant select on _h to public;
select test.become('authenticated', test.u_cli_a());
select test.eq('mover: devuelve anterior y nueva',
  (select (r->>'anterior') || '>' || (r->>'nueva') || '>' || (r->>'movido') from (select public.vehiculo_mover_sucursal(1::bigint, 302::bigint) r) q), '301>302>true');
select test.eq('vehículo en la nueva sucursal', (select sucursal_id from public.vehiculos where id = 1), 302::bigint);
select test.eq('mover conserva mediciones', (select count(*) from public.mediciones where vehiculo_id = 1), (select med from pg_temp._h));
select test.eq('mover conserva neumáticos', (select count(*) from public.neumaticos where vehiculo_id = 1), (select neum from pg_temp._h));
select test.eq('mover conserva eventos', (select count(*) from public.eventos_neumatico where vehiculo_id = 1), (select ev from pg_temp._h));
select test.eq('mover conserva estado de neumáticos', (select count(*) from public.v_estado_neumaticos where vehiculo_id = 1), (select estado from pg_temp._h));
select test.eq('mover conserva alertas', (select count(*) from public.v_alertas where vehiculo_id = 1), (select alertas from pg_temp._h));
select test.eq('mover a "sin sucursal"', (public.vehiculo_mover_sucursal(1::bigint, null)->>'movido'), 'true');
select test.eq('vehículo sin sucursal', (select sucursal_id is null from public.vehiculos where id = 1), true);
select test.eq('mover al mismo lugar no hace nada', (public.vehiculo_mover_sucursal(1::bigint, null)->>'movido'), 'false');
select test.denied('no mueve a una sucursal de otro cliente', $$select public.vehiculo_mover_sucursal(1::bigint, 303::bigint)$$);
select test.denied('no mueve a una sucursal inexistente', $$select public.vehiculo_mover_sucursal(1::bigint, 99999::bigint)$$);
select test.denied('no mueve un vehículo de otro cliente', $$select public.vehiculo_mover_sucursal(3::bigint, 301::bigint)$$);
select test.denied('no mueve un vehículo de otro cliente a su propia sucursal ajena', $$select public.vehiculo_mover_sucursal(3::bigint, 303::bigint)$$);
select test.denied('vehículo inexistente', $$select public.vehiculo_mover_sucursal(99999::bigint, 301::bigint)$$);
reset role;
select test.eq('el vehículo ajeno no cambió', (select sucursal_id is null from public.vehiculos where id = 3), true);
select test.eq('auditoría: 2 movimientos registrados por el cliente',
  (select count(*) from public.audit_log where accion = 'MOVER_SUCURSAL' and entidad = 'vehiculos' and entidad_id = '1' and actor_id = test.u_cli_a() and actor_rol = 'cliente'), 2::bigint);
select test.eq('auditoría: antes y después',
  (select (antes->>'sucursal_id') || '>' || coalesce(despues->>'sucursal_id', 'null') from public.audit_log where accion = 'MOVER_SUCURSAL' and entidad_id = '1' order by id limit 1), '301>302');
select test.eq('la auditoría de tabla también ve el UPDATE',
  (select count(*) >= 2 from public.audit_log where accion = 'UPDATE' and entidad = 'vehiculos' and entidad_id = '1' and actor_id = test.u_cli_a()), true);

-- Alta de vehículo
select test.become('authenticated', test.u_cli_a());
select test.eq('global agrega vehículo con sucursal',
  (select (r->>'sucursal_id') from (select public.vehiculo_crear('777', 'zz 1234', 16::smallint, 301::bigint) r) q), '301');
select test.eq('vehículo creado: datos y cliente',
  (select cliente_id || '|' || nombre || '|' || numero || '|' || patente || '|' || patente_norm || '|' || tipo_ruedas || '|' || sucursal_id from public.vehiculos where numero = '777'), '1|Coche 777|777|zz 1234|ZZ1234|16|301');
select test.eq('vehículo sin sucursal ni matrícula', (public.vehiculo_crear('778')->>'sucursal_id') is null, true);
select test.eq('tipo de ruedas por defecto 10', (select tipo_ruedas from public.vehiculos where numero = '778'), 10::smallint);
select test.denied('matrícula repetida (normalizada)', $$select public.vehiculo_crear('779', 'zz1234')$$, '23505');
select test.denied('número repetido', $$select public.vehiculo_crear('777')$$, '23505');
select test.denied('número vacío', $$select public.vehiculo_crear('  ')$$, '23514');
select test.denied('tipo de ruedas inválido', $$select public.vehiculo_crear('780', null, 12::smallint)$$, '23514');
select test.denied('no crea con sucursal de otro cliente', $$select public.vehiculo_crear('781', null, 10::smallint, 303::bigint)$$);
select test.denied('no crea en otro cliente (p_cliente_id ajeno)', $$select public.vehiculo_crear('782', null, 10::smallint, null, 2::bigint)$$);
reset role;
select test.eq('no se creó nada tras los rechazos', (select count(*) from public.vehiculos where numero in ('779','780','781','782')), 0::bigint);

-- Eliminar: con datos se rechaza (mensaje claro); vacía se elimina
select test.become('authenticated', test.u_cli_a());
select test.denied('eliminar con vehículos asociados', $$select public.sucursal_eliminar(301::bigint)$$, '23503');
select test.eq('sigue existiendo', (select count(*) from public.sucursales where id = 301), 1::bigint);
select test.eq('elimina una sucursal vacía', (public.sucursal_eliminar((select id from public.sucursales where nombre = 'Este'))->>'nombre'), 'Este');
select test.eq('ya no existe', (select count(*) from public.sucursales where nombre = 'Este'), 0::bigint);
select test.denied('no elimina la sucursal de otro cliente', $$select public.sucursal_eliminar(303::bigint)$$);
reset role;
select test.eq('la sucursal ajena sigue', (select count(*) from public.sucursales where id = 303), 1::bigint);
-- Con un usuario de sucursal también se rechaza (un perfil de sucursal quedaría global)
select test.become('authenticated', test.u_admin());
select test.eq('admin: elimina vacía', (public.sucursal_eliminar(302::bigint)->>'id'), '302');
select test.denied('admin: con usuarios no elimina', $$select public.sucursal_eliminar(303::bigint)$$, '23503');
reset role;
rollback to s0;

-- ADMIN: debe indicar el cliente; actúa sobre cualquiera
select test.become('authenticated', test.u_admin());
select test.denied('admin sin p_cliente_id', $$select public.sucursal_crear('Admin Suc')$$, '22004');
select test.denied('admin con cliente inexistente', $$select public.sucursal_crear('Admin Suc', 999::bigint)$$, 'P0002');
select test.eq('admin crea en el cliente B', (public.sucursal_crear('Admin Suc', 2::bigint)->>'cliente_id'), '2');
select test.eq('admin mueve el vehículo de B a su sucursal', (public.vehiculo_mover_sucursal(3::bigint, 303::bigint)->>'movido'), 'true');
select test.denied('admin no cruza clientes al mover', $$select public.vehiculo_mover_sucursal(3::bigint, 301::bigint)$$);
select test.eq('admin crea vehículo en B', (public.vehiculo_crear('900', 'AD9000', 10::smallint, 303::bigint, 2::bigint)->>'cliente_id'), '2');
select test.denied('admin: vehículo con sucursal de otro cliente', $$select public.vehiculo_crear('901', null, 10::smallint, 301::bigint, 2::bigint)$$);
select test.eq('auditoría con actor admin', (select count(*) from public.audit_log where accion = 'MOVER_SUCURSAL' and actor_rol = 'admin'), 1::bigint);
reset role;
rollback to s0;

-- PERFIL DE SUCURSAL (cliente A, Norte): no gestiona nada
select test.become('authenticated', test.u_s80a());
select test.denied('sucursal: no crea sucursales', $$select public.sucursal_crear('Nueva')$$);
select test.denied('sucursal: no renombra la suya', $$select public.sucursal_renombrar(301::bigint, 'Otro')$$);
select test.denied('sucursal: no elimina', $$select public.sucursal_eliminar(302::bigint)$$);
select test.denied('sucursal: no mueve su vehículo', $$select public.vehiculo_mover_sucursal(1::bigint, 302::bigint)$$);
select test.denied('sucursal: no mueve a "sin sucursal"', $$select public.vehiculo_mover_sucursal(1::bigint, null)$$);
select test.denied('sucursal: no crea vehículos', $$select public.vehiculo_crear('555', 'QQ5555', 10::smallint, 301::bigint)$$);
reset role;
select test.eq('nada cambió', (select sucursal_id from public.vehiculos where id = 1), 301::bigint);
select test.eq('sin vehículo nuevo', (select count(*) from public.vehiculos where numero = '555'), 0::bigint);

-- OTRO CLIENTE (B, global): no toca nada del cliente A
select test.become('authenticated', test.u_s80b());
select test.denied('B no mueve vehículos de A', $$select public.vehiculo_mover_sucursal(1::bigint, 303::bigint)$$);
select test.denied('B no mueve su vehículo a sucursal de A', $$select public.vehiculo_mover_sucursal(3::bigint, 301::bigint)$$);
reset role;
select test.become('authenticated', test.u_cli_b());
select test.denied('B (global) no renombra sucursales de A', $$select public.sucursal_renombrar(301::bigint, 'Hack')$$);
select test.denied('B no elimina sucursales de A', $$select public.sucursal_eliminar(302::bigint)$$);
select test.denied('B no crea en A', $$select public.sucursal_crear('Hack', 1::bigint)$$);
select test.denied('B no mueve vehículos de A', $$select public.vehiculo_mover_sucursal(2::bigint, 303::bigint)$$);
select test.denied('B no crea vehículos con sucursal de A', $$select public.vehiculo_crear('B1', null, 10::smallint, 301::bigint)$$);
select test.eq('B crea su propia sucursal', (public.sucursal_crear('B Propia')->>'cliente_id'), '2');
select test.eq('B mueve su vehículo', (public.vehiculo_mover_sucursal(3::bigint, 303::bigint)->>'movido'), 'true');
reset role;
select test.eq('A intacto tras los intentos de B', (select count(*) from public.sucursales where cliente_id = 1 and nombre in ('Hack','Norte','Sur')), 2::bigint);
rollback to s0;

-- api, sin perfil
select test.become('authenticated', test.u_api());
select test.denied('api no crea sucursales', $$select public.sucursal_crear('X')$$);
select test.denied('api no mueve', $$select public.vehiculo_mover_sucursal(1::bigint, 301::bigint)$$);
reset role;
select test.become('authenticated', test.u_sinperfil());
select test.denied('sin perfil no crea sucursales', $$select public.sucursal_crear('X')$$);
select test.denied('sin perfil no crea vehículos', $$select public.vehiculo_crear('X1')$$);
reset role;

rollback;
