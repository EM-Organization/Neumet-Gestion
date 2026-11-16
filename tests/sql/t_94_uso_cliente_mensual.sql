-- Uso mensual por cliente (docs/17 §5, migración 20261119500000_uso_cliente_mensual.sql):
-- uso_cliente_mensual (sin acceso directo), uso_cerrar_mes (solo servicio) y uso_clientes_listar (solo equipo Neumet).
-- Matriz por rol: equipo Neumet, administrador de empresa, usuario de sucursal, api, sin perfil, anon, servicio.
-- Todo en una transacción que se revierte.
begin;

insert into auth.users (id, email, last_sign_in_at) values
  ('a0000000-0000-0000-0000-0000000000e1', 'suc94@t', '2026-10-05 10:00+00'),
  ('a0000000-0000-0000-0000-0000000000e2', 'adm94@t', '2026-10-20 10:00+00');
insert into public.sucursales (id, cliente_id, nombre) overriding system value values (941, 1, 'Norte 94');
insert into public.perfiles (user_id, rol, cliente_id, sucursal_id) values
  ('a0000000-0000-0000-0000-0000000000e1', 'cliente', 1, 941);
create or replace function test.u_e1() returns uuid language sql immutable as $$ select 'a0000000-0000-0000-0000-0000000000e1'::uuid $$;
grant execute on function test.u_e1() to public;

-- Los clientes de las fixtures nacen "ahora": el cierre solo incluye clientes ya existentes en el mes.
update public.clientes set created_at = '2026-01-01+00' where id in (1, 2);
-- Datos de agosto de 2026 (mes cerrado) del cliente 1 y uno del cliente 2; más datos fuera del mes.
insert into public.dispositivos (id, mac_address, nombre, cliente_id, activo) overriding system value values
  (941, '94:00:00:00:00:01', 'D941', 1, true), (942, '94:00:00:00:00:02', 'D942 sin medir', 1, true);
insert into public.ingesta_log (recibido_at, endpoint, status, cliente_id) values
  ('2026-08-03 12:00+00', 'guardar_montaje_mm', 'ok', 1),
  ('2026-08-04 12:00+00', 'guardar_montaje_mm', 'ok', 1),
  ('2026-08-05 12:00+00', 'guardar_montaje_mm', 'rechazado', 1),
  ('2026-08-06 12:00+00', 'login', 'ok', 1),
  ('2026-08-07 12:00+00', 'login', 'ok', 1),
  ('2026-08-31 23:59:59+00', 'obtener_montaje', 'ok', 1),
  ('2026-09-01 00:00:00+00', 'obtener_montaje', 'ok', 1),     -- fuera del mes
  ('2026-07-31 23:59:59+00', 'obtener_montaje', 'ok', 1),     -- fuera del mes
  ('2026-08-10 12:00+00', 'obtener_montaje', 'error', 2),
  ('2026-08-11 12:00+00', 'obtener_montaje', 'ok', null);     -- sin cliente: no se cuenta
insert into public.mediciones (vehiculo_id, cliente_id, device_id, posicion, mm1, mm2, mm3, promedio, created_at) values
  (1, 1, '94:00:00:00:00:01', 1, 8, 8, 8, 8, '2026-08-15 10:00+00'),
  (1, 1, '94:00:00:00:00:01', 2, 8, 8, 8, 8, '2026-08-16 10:00+00'),
  (1, 1, '94:00:00:00:00:01', 3, 8, 8, 8, 8, '2026-09-02 10:00+00');   -- fuera del mes

-- ---- índices: mediciones es la tabla más escrita; esta migración no agrega un B-tree redundante ------------------
-- Duplicado = mismas columnas clave en el mismo orden (se ignora asc/desc), sin predicado parcial.
select test.eq('I: mediciones no tiene dos índices iguales sobre las mismas columnas',
  (select count(*) from (
     select indkey::text from pg_index where indrelid = 'public.mediciones'::regclass and indpred is null
     group by indkey::text having count(*) > 1) d), 0::bigint);
select test.eq('I: hay un índice utilizable por (cliente_id, created_at) en mediciones',
  (select count(*) from pg_index i where i.indrelid = 'public.mediciones'::regclass and i.indpred is null
     and (i.indkey::int2[])[0] = (select attnum from pg_attribute where attrelid = 'public.mediciones'::regclass and attname = 'cliente_id')
     and (i.indkey::int2[])[1] = (select attnum from pg_attribute where attrelid = 'public.mediciones'::regclass and attname = 'created_at')) >= 1, true);
select test.eq('I: el índice de ingesta_log por (cliente_id, recibido_at) existe',
  (select count(*) from pg_indexes where schemaname = 'public' and tablename = 'ingesta_log' and indexname = 'ingesta_log_cliente_recibido_idx'), 1::bigint);

-- ---- cierre (servicio) -----------------------------------------------------------------------------------------
select test.become('service_role', null);
select test.eq('A: el cierre escribe una fila por cliente vigente', (select public.uso_cerrar_mes('2026-08-20')) >= 2, true);
reset role;
select test.eq('A: llamadas a la API sin login ni otros meses', (select api_llamadas from public.uso_cliente_mensual where cliente_id = 1 and mes = '2026-08-01'), 4);
select test.eq('A: por endpoint y estado',
  (select api_por_endpoint from public.uso_cliente_mensual where cliente_id = 1 and mes = '2026-08-01'),
  '{"obtener_montaje": {"ok": 1}, "guardar_montaje_mm": {"ok": 2, "rechazado": 1}}'::jsonb);
select test.eq('A: el login no está en las llamadas', (select api_por_endpoint ? 'login' from public.uso_cliente_mensual where cliente_id = 1 and mes = '2026-08-01'), false);
select test.eq('A: logins aparte', (select logins from public.uso_cliente_mensual where cliente_id = 1 and mes = '2026-08-01'), 2);
select test.eq('A: mediciones del mes', (select mediciones from public.uso_cliente_mensual where cliente_id = 1 and mes = '2026-08-01'),
  (select count(*)::integer from public.mediciones where cliente_id = 1 and created_at >= '2026-08-01+00' and created_at < '2026-09-01+00'));
select test.eq('A: incluye las dos mediciones de agosto sembradas aquí', (select count(*) from public.mediciones where device_id = '94:00:00:00:00:01' and created_at < '2026-09-01+00'), 2::bigint);
select test.eq('A: dispositivos activos con medición en el mes', (select dispositivos_activos from public.uso_cliente_mensual where cliente_id = 1 and mes = '2026-08-01'), 1);
select test.eq('A: usuarios (perfiles cliente, sin api)',
  (select usuarios from public.uso_cliente_mensual where cliente_id = 1 and mes = '2026-08-01'),
  (select count(*)::integer from public.perfiles where cliente_id = 1 and rol = 'cliente'));
select test.eq('A: llamadas del cliente 2', (select api_llamadas from public.uso_cliente_mensual where cliente_id = 2 and mes = '2026-08-01'), 1);
select test.eq('A: un 401 sin cliente no se atribuye a nadie', (select sum(api_llamadas) from public.uso_cliente_mensual where mes = '2026-08-01'), 5::bigint);

-- idempotencia y recalculo: mismo resultado; las fotos del primer cierre no se pisan
create temp table _antes as select * from public.uso_cliente_mensual where mes = '2026-08-01';
select test.become('service_role', null);
select public.uso_cerrar_mes('2026-08-01');
reset role;
select test.eq('B: reejecutar deja las mismas filas',
  (select count(*) from (select * from public.uso_cliente_mensual where mes = '2026-08-01' except select * from _antes) x), 0::bigint);
insert into public.ingesta_log (recibido_at, endpoint, status, cliente_id) values ('2026-08-20 12:00+00', 'obtener_montaje', 'ok', 1);
update public.vehiculos set activo = false where cliente_id = 1;
select test.become('service_role', null);
select public.uso_cerrar_mes('2026-08-01');
reset role;
select test.eq('B: el re-cierre recalcula lo que sale de ingesta_log', (select api_llamadas from public.uso_cliente_mensual where cliente_id = 1 and mes = '2026-08-01'), 5);
select test.eq('B: la foto de vehículos del primer cierre no se pisa',
  (select vehiculos_activos from public.uso_cliente_mensual where cliente_id = 1 and mes = '2026-08-01'),
  (select vehiculos_activos from _antes where cliente_id = 1));
select test.eq('B: cerrado_at es el del primer cierre', (select cerrado_at from public.uso_cliente_mensual where cliente_id = 1 and mes = '2026-08-01'), (select cerrado_at from _antes where cliente_id = 1));
select test.eq('B: sigue habiendo una sola fila por cliente y mes', (select count(*) from public.uso_cliente_mensual where cliente_id = 1 and mes = '2026-08-01'), 1::bigint);

-- mes en curso y futuro: rechazados; el valor por omisión es el mes anterior
select test.become('service_role', null);
select test.denied('C: mes en curso', $$select public.uso_cerrar_mes((now() at time zone 'UTC')::date)$$, '22023');
select test.denied('C: mes futuro', $$select public.uso_cerrar_mes(((now() at time zone 'UTC')::date + interval '40 days')::date)$$, '22023');
select public.uso_cerrar_mes();
reset role;
select test.eq('C: sin parámetro cierra el mes anterior (UTC)',
  (select count(*) from public.uso_cliente_mensual where cliente_id = 1
     and mes = (date_trunc('month', now() at time zone 'UTC') - interval '1 month')::date), 1::bigint);

-- ---- quién puede cerrar ----------------------------------------------------------------------------------------
select test.become('authenticated', test.u_admin());
select test.denied('D: equipo Neumet no cierra', $$select public.uso_cerrar_mes('2026-08-01')$$);
select test.become('authenticated', test.u_cli_a());
select test.denied('D: administrador de empresa no cierra', $$select public.uso_cerrar_mes('2026-08-01')$$);
select test.become('authenticated', test.u_api());
select test.denied('D: api no cierra', $$select public.uso_cerrar_mes('2026-08-01')$$);
select test.become('anon', null);
select test.denied('D: anon no cierra', $$select public.uso_cerrar_mes('2026-08-01')$$);

-- ---- tabla sin acceso directo ----------------------------------------------------------------------------------
select test.become('authenticated', test.u_admin());
select test.denied('E: select directo (equipo Neumet)', $$select * from public.uso_cliente_mensual$$);
select test.become('authenticated', test.u_cli_a());
select test.denied('E: select directo (administrador de empresa)', $$select * from public.uso_cliente_mensual$$);
select test.denied('E: insert directo', $$insert into public.uso_cliente_mensual (cliente_id, mes) values (1, '2026-01-01')$$);
select test.denied('E: update directo', $$update public.uso_cliente_mensual set logins = 0$$);
select test.denied('E: delete directo', $$delete from public.uso_cliente_mensual$$);
select test.become('anon', null);
select test.denied('E: select directo (anon)', $$select * from public.uso_cliente_mensual$$);

-- ---- RPC de lectura: solo el equipo Neumet ---------------------------------------------------------------------
select test.become('authenticated', test.u_admin());
select test.eq('F: equipo Neumet ve las filas de ambas empresas',
  (select count(distinct cliente_id) from public.uso_clientes_listar('2026-08-01', '2026-08-31')) >= 2, true);
select test.eq('F: filtro por cliente', (select count(*) from public.uso_clientes_listar(null, null, 2) where cliente_id <> 2), 0::bigint);
select test.eq('F: trae el nombre', (select cliente_nombre from public.uso_clientes_listar('2026-08-01', '2026-08-01', 1)), 'Cliente A');
select test.eq('F: rango sin datos', (select count(*) from public.uso_clientes_listar('2020-01-01', '2020-12-31')), 0::bigint);
select test.become('authenticated', test.u_cli_a());
select test.denied('F: administrador de empresa', $$select * from public.uso_clientes_listar()$$);
select test.denied('F: administrador de empresa pidiendo su cliente', $$select * from public.uso_clientes_listar(null, null, 1)$$);
select test.become('authenticated', test.u_e1());
select test.denied('F: usuario de sucursal', $$select * from public.uso_clientes_listar()$$);
select test.become('authenticated', test.u_api());
select test.denied('F: api', $$select * from public.uso_clientes_listar()$$);
select test.become('authenticated', test.u_sinperfil());
select test.denied('F: sin perfil', $$select * from public.uso_clientes_listar()$$);
select test.become('anon', null);
select test.denied('F: anon', $$select * from public.uso_clientes_listar()$$);

rollback;
