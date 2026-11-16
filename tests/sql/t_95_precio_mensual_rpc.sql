-- RPC del precio mensual (docs/17, migración C1, 20261120000000_precio_mensual_rpc.sql):
-- cliente_precios_mensuales y cliente_precio_mensual_fijar, solo para el equipo Neumet (is_admin()).
-- Matriz: equipo Neumet, administrador de empresa, usuario de sucursal, api, sin perfil, anon. Todo en una transacción que se revierte.
begin;

insert into auth.users (id, email) values ('a0000000-0000-0000-0000-0000000000e5', 'suc95@t');
insert into public.sucursales (id, cliente_id, nombre) overriding system value values (951, 1, 'Norte 95');
insert into public.perfiles (user_id, rol, cliente_id, sucursal_id) values
  ('a0000000-0000-0000-0000-0000000000e5', 'cliente', 1, 951);
create or replace function test.u_e5() returns uuid language sql immutable as $$ select 'a0000000-0000-0000-0000-0000000000e5'::uuid $$;
grant execute on function test.u_e5() to public;
update public.clientes set precio_mensual = 150.50 where id = 1;
update public.clientes set precio_mensual = 0 where id = 2;

-- ---- contrato (sin cambiar de rol) --------------------------------------------------------------------------------
select test.eq('las dos RPC son SECURITY DEFINER con search_path vacío',
  (select count(*) from pg_proc p where p.pronamespace = 'public'::regnamespace
     and p.proname in ('cliente_precios_mensuales', 'cliente_precio_mensual_fijar')
     and p.prosecdef and p.proconfig @> array['search_path=""']), 2::bigint);
select test.eq('PUBLIC no ejecuta las RPC',
  (select count(*) from pg_proc p, aclexplode(p.proacl) a
    where p.pronamespace = 'public'::regnamespace and p.proname in ('cliente_precios_mensuales', 'cliente_precio_mensual_fijar')
      and a.grantee = 0), 0::bigint);
select test.eq('anon no ejecuta las RPC',
  has_function_privilege('anon', 'public.cliente_precios_mensuales()', 'execute')
  or has_function_privilege('anon', 'public.cliente_precio_mensual_fijar(bigint, numeric)', 'execute'), false);
-- Retrocompatible: C1 no revoca nada; el front vigente (Balance) sigue usando la columna directa.
select test.eq('retrocompatible: authenticated sigue leyendo clientes.precio_mensual',
  has_column_privilege('authenticated', 'public.clientes', 'precio_mensual', 'select'), true);
select test.eq('retrocompatible: authenticated sigue actualizando clientes.precio_mensual',
  has_column_privilege('authenticated', 'public.clientes', 'precio_mensual', 'update'), true);

-- ---- equipo Neumet ---------------------------------------------------------------------------------------------
select test.become('authenticated', test.u_admin());
select test.eq('admin: lee el precio de cada cliente',
  (select precio_mensual from public.cliente_precios_mensuales() where cliente_id = 1), 150.50::numeric);
select test.eq('admin: lee todos los clientes',
  (select count(*) from public.cliente_precios_mensuales()), (select count(*) from public.clientes));
select test.eq('admin: fijar devuelve el valor guardado (redondeado a 2 decimales)',
  (select public.cliente_precio_mensual_fijar(1, 200.126)), 200.13::numeric);
select test.eq('admin: el precio quedó escrito', (select precio_mensual from public.clientes where id = 1), 200.13::numeric);
select test.eq('admin: no tocó otros clientes', (select precio_mensual from public.clientes where id = 2), 0::numeric);
select test.eq('admin: cero es válido', (select public.cliente_precio_mensual_fijar(2, 0)), 0::numeric);
select test.eq('admin: el cambio queda en la auditoría con el actor',
  (select count(*) from public.audit_log where entidad = 'clientes' and entidad_id = '1' and accion = 'UPDATE'
     and actor_id = test.u_admin() and (despues ->> 'precio_mensual')::numeric = 200.13), 1::bigint);
select test.denied('admin: precio negativo', $$select public.cliente_precio_mensual_fijar(1, -1)$$, '22023');
select test.denied('admin: precio nulo', $$select public.cliente_precio_mensual_fijar(1, null)$$, '22023');
select test.denied('admin: precio fuera de rango', $$select public.cliente_precio_mensual_fijar(1, 10000000000)$$, '22023');
select test.denied('admin: cliente inexistente', $$select public.cliente_precio_mensual_fijar(999999, 10)$$, 'P0002');
select test.eq('admin: un precio inválido no cambió nada', (select precio_mensual from public.clientes where id = 1), 200.13::numeric);

-- ---- el resto: 42501 ---------------------------------------------------------------------------------------------
select test.become('authenticated', test.u_cli_a());
select test.denied('administrador de empresa: leer', $$select * from public.cliente_precios_mensuales()$$);
select test.denied('administrador de empresa: fijar su propio precio', $$select public.cliente_precio_mensual_fijar(1, 1)$$);
select test.denied('administrador de empresa: fijar el de otro', $$select public.cliente_precio_mensual_fijar(2, 1)$$);
select test.become('authenticated', test.u_e5());
select test.denied('usuario de sucursal: leer', $$select * from public.cliente_precios_mensuales()$$);
select test.denied('usuario de sucursal: fijar', $$select public.cliente_precio_mensual_fijar(1, 1)$$);
select test.become('authenticated', test.u_api());
select test.denied('api: leer', $$select * from public.cliente_precios_mensuales()$$);
select test.denied('api: fijar', $$select public.cliente_precio_mensual_fijar(1, 1)$$);
select test.become('authenticated', test.u_sinperfil());
select test.denied('sin perfil: leer', $$select * from public.cliente_precios_mensuales()$$);
select test.denied('sin perfil: fijar', $$select public.cliente_precio_mensual_fijar(1, 1)$$);
select test.become('anon', null);
select test.denied('anon: leer', $$select * from public.cliente_precios_mensuales()$$);
select test.denied('anon: fijar', $$select public.cliente_precio_mensual_fijar(1, 1)$$);

reset role;
select test.eq('los intentos denegados no cambiaron el precio', (select precio_mensual from public.clientes where id = 1), 200.13::numeric);

rollback;
