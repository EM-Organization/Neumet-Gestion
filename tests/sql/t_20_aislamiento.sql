-- Aislamiento por rol/cliente en TODAS las vistas y tablas nuevas.
-- Cada identidad cuenta filas por objeto; anon debe recibir "permission denied".

create temp table _esperado (obj text, admin bigint, a bigint, b bigint);
insert into _esperado values
  -- v_ultima_medicion ya no lista posiciones de neumáticos que no están montados (baja, pos. 9).
  ('v_ultima_medicion',       14, 11, 3),
  ('v_mediciones_neumatico',  19, 16, 3),
  ('v_estado_neumaticos',     14, 11, 3),
  ('v_alertas',               10,  7, 3),
  ('v_resumen_flota_cliente',  2,  1, 1),
  ('v_salud_dispositivos',     5,  4, 1),
  ('eventos_neumatico',        3,  2, 1),
  ('gastos',                   1,  0, 0),
  ('clientes',                 2,  1, 1);
grant select on _esperado to public;

create or replace function test.contar(p_obj text) returns bigint language plpgsql as $$
declare n bigint;
begin execute format('select count(*) from public.%I', p_obj) into n; return n; end $$;

create or replace function test.filas_ajenas(p_obj text, p_cliente bigint) returns bigint language plpgsql as $$
declare n bigint; col text := case p_obj when 'v_resumen_flota_cliente' then 'cliente_id'
                                         when 'clientes' then 'id' else 'cliente_id' end;
begin
  if p_obj = 'gastos' then return 0; end if;
  execute format('select count(*) from public.%I where %I is distinct from %s', p_obj, col, p_cliente) into n;
  return n;
end $$;

-- admin
begin;
select test.become('authenticated', test.u_admin());
select test.eq('admin ve '||obj, test.contar(obj), admin) from _esperado;
rollback;

-- cliente A
begin;
select test.become('authenticated', test.u_cli_a());
select test.eq('cliente A ve '||obj, test.contar(obj), a) from _esperado;
select test.eq('cliente A: 0 filas ajenas en '||obj, test.filas_ajenas(obj, 1), 0::bigint) from _esperado;
select test.eq('cliente A no ve gastos', (select count(*) from public.gastos), 0::bigint);
select test.eq('cliente A no ve audit_log', (select count(*) from public.audit_log), 0::bigint);
rollback;

-- cliente B
begin;
select test.become('authenticated', test.u_cli_b());
select test.eq('cliente B ve '||obj, test.contar(obj), b) from _esperado;
select test.eq('cliente B: 0 filas ajenas en '||obj, test.filas_ajenas(obj, 2), 0::bigint) from _esperado;
rollback;

-- rol 'api' (authenticated con perfil api): 0 filas en todo
begin;
select test.become('authenticated', test.u_api());
select test.eq('api ve 0 en '||obj, test.contar(obj), 0::bigint) from _esperado;
rollback;

-- usuario autenticado sin perfil: 0 filas
begin;
select test.become('authenticated', test.u_sinperfil());
select test.eq('sin perfil ve 0 en '||obj, test.contar(obj), 0::bigint) from _esperado;
rollback;

-- anon: denegado en todo
begin;
select test.become('anon', null);
select test.denied('anon denegado en '||obj, format('select count(*) from public.%I', obj)) from _esperado;
select test.denied('anon denegado en v_ultima_medicion', 'select 1 from public.v_ultima_medicion');
rollback;

-- Estructura: security_invoker, grants y RLS
begin;
select test.eq('5 vistas con security_invoker=true',
  (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relkind='v'
     and c.relname in ('v_ultima_medicion','v_estado_neumaticos','v_alertas','v_resumen_flota_cliente','v_salud_dispositivos')
     and 'security_invoker=true' = any(c.reloptions)), 5::bigint);
select test.eq('ninguna vista de public sin security_invoker',
  (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relkind='v' and not coalesce('security_invoker=true' = any(c.reloptions), false)), 0::bigint);
select test.eq('anon sin privilegios sobre tablas/vistas de public',
  (select count(*) from information_schema.role_table_grants where table_schema='public' and grantee in ('anon','PUBLIC')), 0::bigint);
-- La migración inicial deja EXECUTE a PUBLIC solo en funciones puras/de trigger
-- sin acceso a datos (heredado; no es de esta migración). Todo lo demás, cerrado.
select test.eq('anon/PUBLIC sin execute en funciones con acceso a datos o RPCs',
  (select count(*) from information_schema.routine_privileges
   where routine_schema='public' and grantee in ('anon','PUBLIC')
     and routine_name not in ('normalizar_patente','dispositivos_normalizar_mac',
                              'mediciones_set_promedio','audit_log_inmutable')), 0::bigint);
select test.eq('todas las tablas de public con RLS',
  (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relkind='r' and not c.relrowsecurity), 0::bigint);
select test.eq('SECURITY DEFINER sin search_path fijo',
  (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.prosecdef
     and not exists (select 1 from unnest(coalesce(p.proconfig,'{}')) c where c like 'search_path=%')), 0::bigint);
select test.eq('authenticated tiene SELECT en las 5 vistas',
  (select count(*) from information_schema.role_table_grants
   where table_schema='public' and grantee='authenticated' and privilege_type='SELECT'
     and table_name in ('v_ultima_medicion','v_estado_neumaticos','v_alertas','v_resumen_flota_cliente','v_salud_dispositivos')), 5::bigint);
rollback;
