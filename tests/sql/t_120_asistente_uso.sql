-- Asistente de reportes con IA: cuota y registro (migración 20261126090000_asistente_uso.sql, docs/24 §4, §7, §9):
--   1. asistente_reservar por rol (global, sucursal, admin, api, sin perfil, empresa dada de baja, anon);
--   2. cuota de 30 por usuario y día, con las filas de ayer y de «cuota» que no cuentan;
--   3. asistente_cerrar: solo la fila propia «en_curso», validaciones y cierre repetido;
--   4. visibilidad de asistente_uso por rol y escrituras directas denegadas;
--   5. las dos RPC son SECURITY DEFINER con search_path vacío.
-- La concurrencia (dos sesiones) está en concurrencia_asistente_cuota.sh.
-- Usuarios e ids propios (e1200000-..., cliente 1203, sucursales 1201 y 1202). Todo en una transacción que se revierte.
begin;

create function pg_temp.hoy() returns date language sql stable as $$
  select (now() at time zone 'America/Montevideo')::date $$;

-- Cada reserva se guarda aquí para afirmar sobre su respuesta completa (cada llamada permitida inserta una fila).
create temp table res (paso text, r jsonb);
grant all on res to public;

insert into auth.users (id, email) values
  ('e1200000-0000-0000-0000-000000000002', 'ga2@t'),    -- global de A: 29 de ayer y una «cuota» de hoy
  ('e1200000-0000-0000-0000-000000000003', 'ga3@t'),    -- global de A: caso de pedir otro cliente y de cierre
  ('e1200000-0000-0000-0000-0000000000a1', 'suc120@t'), -- sucursal Salto de A
  ('e1200000-0000-0000-0000-0000000000d1', 'baja120@t'); -- perfil de una empresa dada de baja

insert into public.clientes (id, nombre, deleted_at) values (1203, 'Baja 120', now());
insert into public.sucursales (id, cliente_id, nombre) values (1201, 1, 'Salto 120'), (1202, 1, 'Montevideo 120');
insert into public.perfiles (user_id, rol, cliente_id, sucursal_id) values
  ('e1200000-0000-0000-0000-000000000002', 'cliente', 1, null),
  ('e1200000-0000-0000-0000-000000000003', 'cliente', 1, null),
  ('e1200000-0000-0000-0000-0000000000a1', 'cliente', 1, 1201),
  ('e1200000-0000-0000-0000-0000000000d1', 'cliente', 1203, null);

-- Partida. Global A (u_cli_a, de los fixtures): 29 filas ok de hoy. Global A2: 29 de ayer y una «cuota» de hoy.
insert into public.asistente_uso (user_id, cliente_id, dia, resultado)
  select test.u_cli_a(), 1, pg_temp.hoy(), 'ok' from generate_series(1, 29);
insert into public.asistente_uso (user_id, cliente_id, dia, resultado)
  select 'e1200000-0000-0000-0000-000000000002', 1, pg_temp.hoy() - 1, 'ok' from generate_series(1, 29);
insert into public.asistente_uso (user_id, cliente_id, dia, resultado)
  values ('e1200000-0000-0000-0000-000000000002', 1, pg_temp.hoy(), 'cuota');

-- ---- 1 y 2. Cuota del global A: la pregunta 30 pasa, la 31 y las siguientes se rechazan --------------------------
select test.become('authenticated', test.u_cli_a());
insert into res values ('g1', public.asistente_reservar(null));
select test.eq('1: la pregunta 30 del día se permite', (select (r ->> 'permitido')::boolean from res where paso = 'g1'), true);
select test.eq('1: usadas = 30', (select (r ->> 'usadas')::integer from res where paso = 'g1'), 30);
select test.eq('1: rol global', (select r ->> 'rol' from res where paso = 'g1'), 'global');
select test.eq('1: costos visibles para el global', (select (r ->> 'costos_visibles')::boolean from res where paso = 'g1'), true);
select test.eq('1: cliente_nombre del cliente A', (select r ->> 'cliente_nombre' from res where paso = 'g1'), 'Cliente A');
select test.eq('1: moneda por defecto del cliente', (select r ->> 'moneda_default' from res where paso = 'g1'), 'USD');

insert into res values ('g2', public.asistente_reservar(null));
select test.eq('2: la pregunta 31 se rechaza', (select (r ->> 'permitido')::boolean from res where paso = 'g2'), false);
select test.eq('2: usadas = 30 al rechazar', (select (r ->> 'usadas')::integer from res where paso = 'g2'), 30);
select test.eq('2: una fila cuota', (select count(*) from public.asistente_uso
  where user_id = test.u_cli_a() and resultado = 'cuota'), 1::bigint);
insert into res values ('g3', public.asistente_reservar(null));
select test.eq('2: otra pregunta rechazada', (select (r ->> 'permitido')::boolean from res where paso = 'g3'), false);
select test.eq('2: sigue una sola fila cuota', (select count(*) from public.asistente_uso
  where user_id = test.u_cli_a() and resultado = 'cuota'), 1::bigint);

-- ---- 3. Ayer y «cuota» no cuentan: el global A2 empieza en 1 ----------------------------------------------------
select test.become('authenticated', 'e1200000-0000-0000-0000-000000000002');
insert into res values ('a1', public.asistente_reservar(null));
select test.eq('3: ayer y cuota no cuentan (usadas = 1)', (select (r ->> 'usadas')::integer from res where paso = 'a1'), 1);
select test.eq('3: permitido', (select (r ->> 'permitido')::boolean from res where paso = 'a1'), true);

-- ---- 4. El global pide otro cliente: vale el de su perfil --------------------------------------------------------
select test.become('authenticated', 'e1200000-0000-0000-0000-000000000003');
insert into res values ('c1', public.asistente_reservar(2));
select test.eq('4: la respuesta usa el cliente del perfil (A)', (select (r ->> 'cliente_id')::bigint from res where paso = 'c1'), 1::bigint);
select test.eq('4: la fila queda con el cliente A', (select cliente_id from public.asistente_uso
  where user_id = 'e1200000-0000-0000-0000-000000000003'), 1::bigint);

-- ---- 5. Perfil de sucursal: sin costos y con el nombre de su sucursal --------------------------------------------
select test.become('authenticated', 'e1200000-0000-0000-0000-0000000000a1');
insert into res values ('p1', public.asistente_reservar(null));
select test.eq('5: rol sucursal', (select r ->> 'rol' from res where paso = 'p1'), 'sucursal');
select test.eq('5: sin costos visibles', (select (r ->> 'costos_visibles')::boolean from res where paso = 'p1'), false);
select test.eq('5: sucursal_nombre', (select r ->> 'sucursal_nombre' from res where paso = 'p1'), 'Salto 120');

-- ---- 6. Admin: debe elegir un cliente existente y activo ----------------------------------------------------------
select test.become('authenticated', test.u_admin());
select test.denied('6: admin sin cliente = cliente_requerido (22023)', $$select public.asistente_reservar(null)$$, '22023');
select test.denied('6: admin con cliente dado de baja (22023)', $$select public.asistente_reservar(1203)$$, '22023');
select test.denied('6: admin con cliente inexistente (22023)', $$select public.asistente_reservar(987654)$$, '22023');
insert into res values ('ad1', public.asistente_reservar(2));
select test.eq('6: admin con cliente B, rol admin', (select r ->> 'rol' from res where paso = 'ad1'), 'admin');
select test.eq('6: admin con cliente B, cliente_id B', (select (r ->> 'cliente_id')::bigint from res where paso = 'ad1'), 2::bigint);
select test.eq('6: admin ve costos', (select (r ->> 'costos_visibles')::boolean from res where paso = 'ad1'), true);

-- ---- 7. Sin acceso: api, sin perfil, empresa dada de baja, anon -------------------------------------------------
select test.become('authenticated', test.u_api());
select test.denied('7: api (42501)', $$select public.asistente_reservar(null)$$);
select test.become('authenticated', test.u_sinperfil());
select test.denied('7: sin perfil (42501)', $$select public.asistente_reservar(null)$$);
select test.become('authenticated', 'e1200000-0000-0000-0000-0000000000d1');
select test.denied('7: empresa dada de baja (42501)', $$select public.asistente_reservar(null)$$);
select test.become('anon', null);
select test.denied('7: anon sin permiso para ejecutar (42501)', $$select public.asistente_reservar(null)$$);

-- ---- 8. asistente_cerrar -----------------------------------------------------------------------------------------
-- Fila «en_curso» del global A3 (caso 4).
select test.become('authenticated', 'e1200000-0000-0000-0000-000000000003');
select test.eq('8: cierra la fila propia en_curso', (select public.asistente_cerrar(
  (select id from public.asistente_uso where user_id = 'e1200000-0000-0000-0000-000000000003' and resultado = 'en_curso'),
  'ok', 'm', array['estado_flota'], 10, 5, 0.000120, 1500, 'v1', null)), true);
select test.eq('8: la fila queda ok con cerrada_at', (select resultado || '|' || (cerrada_at is not null)::text
  from public.asistente_uso where user_id = 'e1200000-0000-0000-0000-000000000003'), 'ok|true');
select test.eq('8: segundo cierre devuelve false', (select public.asistente_cerrar(
  (select id from public.asistente_uso where user_id = 'e1200000-0000-0000-0000-000000000003'), 'error')), false);
-- Fila ajena: la del administrador (caso 6), en curso y sin cerrar. Su id se guarda antes de cambiar de usuario,
-- porque el global A3 no la ve por RLS (un id nulo daría false por la razón equivocada).
select test.become('authenticated', test.u_admin());
insert into res select 'adid', jsonb_build_object('id', id) from public.asistente_uso where user_id = test.u_admin();
select test.eq('8: existe la fila ajena', (select r ->> 'id' is not null from res where paso = 'adid'), true);
select test.become('authenticated', 'e1200000-0000-0000-0000-000000000003');
select test.eq('8: cerrar la fila ajena devuelve false', (select public.asistente_cerrar(
  (select (r ->> 'id')::bigint from res where paso = 'adid'), 'ok')), false);
select test.become('authenticated', test.u_admin());
select test.eq('8: la fila ajena queda intacta', (select resultado || '|' || (cerrada_at is null)::text
  from public.asistente_uso where user_id = test.u_admin()), 'en_curso|true');

-- ---- 9. Validaciones (22023), antes de tocar ninguna fila --------------------------------------------------------
select test.become('authenticated', 'e1200000-0000-0000-0000-000000000003');
select test.denied('9: resultado cuota no se puede cerrar', $$select public.asistente_cerrar(0, 'cuota')$$, '22023');
select test.denied('9: tokens de entrada negativos', $$select public.asistente_cerrar(0, 'ok', null, null, -1)$$, '22023');
select test.denied('9: 21 tools', $$select public.asistente_cerrar(0, 'ok', null, array(select 't'::text from generate_series(1, 21)))$$, '22023');
select test.denied('9: aviso de 61 caracteres', $$select public.asistente_cerrar(0, 'ok', null, null, null, null, null, null, null, repeat('x', 61))$$, '22023');
select test.denied('9: modelo de 101 caracteres', $$select public.asistente_cerrar(0, 'ok', repeat('m', 101))$$, '22023');

-- ---- 10. Visibilidad de la tabla: cada uno ve lo suyo; el admin, todo; anon, nada --------------------------------
select test.become('authenticated', test.u_cli_a());
select test.eq('10: el global no ve filas de otro usuario', (select count(*) from public.asistente_uso
  where user_id <> test.u_cli_a()), 0::bigint);
select test.eq('10: el global ve sus 31 filas (29 ok, en curso y cuota)', (select count(*) from public.asistente_uso), 31::bigint);
select test.become('authenticated', test.u_admin());
select test.eq('10: el admin ve las filas de otro usuario', (select count(*) from public.asistente_uso
  where user_id = 'e1200000-0000-0000-0000-000000000003'), 1::bigint);
select test.become('anon', null);
select test.denied('10: anon sin select (42501)', $$select count(*) from public.asistente_uso$$);

-- ---- 11. Escrituras directas denegadas (solo las RPC escriben) ---------------------------------------------------
select test.become('authenticated', test.u_cli_a());
select test.denied('11: insert directo (42501)', $$insert into public.asistente_uso (user_id, cliente_id, dia) values (test.u_cli_a(), 1, current_date)$$);
select test.denied('11: update directo (42501)', $$update public.asistente_uso set modelo = 'x'$$);
select test.denied('11: delete directo (42501)', $$delete from public.asistente_uso$$);
select test.become('authenticated', test.u_admin());
select test.denied('11: el admin tampoco borra directo (42501)', $$delete from public.asistente_uso$$);

-- ---- 12. Las RPC son SECURITY DEFINER con search_path vacío -----------------------------------------------------
reset role;
select test.eq('12: asistente_reservar definer y search_path vacío', (select p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=""'
  from pg_proc p where p.oid = 'public.asistente_reservar(bigint)'::regprocedure), true);
select test.eq('12: asistente_cerrar definer y search_path vacío', (select p.prosecdef and array_to_string(p.proconfig, ',') = 'search_path=""'
  from pg_proc p where p.oid = 'public.asistente_cerrar(bigint,text,text,text[],integer,integer,numeric,integer,text,text)'::regprocedure), true);

rollback;
