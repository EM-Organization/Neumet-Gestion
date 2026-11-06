-- NEUMET: auditoria RLS/privilegios. SOLO LECTURA. Ejecutar en el SQL editor de Supabase.
-- Cada consulta: resultado NO vacio = hallazgo a revisar.

-- 1) Tablas de public SIN RLS. No vacio: cualquier rol con GRANT lee/escribe todo.
select c.relname as tabla
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r','p') and not c.relrowsecurity;

-- 2) Tablas con RLS pero SIN politicas. No vacio: nadie (salvo service_role) accede; puede ser intencional o un bug funcional.
select c.relname as tabla
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r','p') and c.relrowsecurity
  and not exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.relname);

-- 3) Politicas aplicables a anon o public. No vacio: acceso sin autenticar; confirmar que es deliberado.
select schemaname, tablename, policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public' and (roles && array['anon','public']::name[]);

-- 4) Politicas permisivas USING (true) / WITH CHECK (true). No vacio: sin filtro por fila; cualquier rol listado accede a todas las filas.
select schemaname, tablename, policyname, cmd, roles, qual, with_check
from pg_policies
where schemaname = 'public' and (trim(coalesce(qual,'')) = 'true' or trim(coalesce(with_check,'')) = 'true');

-- 5) Funciones SECURITY DEFINER en public sin search_path fijado. No vacio: riesgo de search_path hijacking / escalada.
select p.oid::regprocedure as funcion, p.proconfig
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef
  and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) cfg where cfg like 'search_path=%');

-- 5b) Funciones SECURITY DEFINER ejecutables por anon/PUBLIC. No vacio: invocables sin login via /rpc; revocar EXECUTE si no es necesario.
select p.oid::regprocedure as funcion,
       has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec,
       exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
               where a.grantee = 0 and a.privilege_type = 'EXECUTE') as public_exec
from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public' and p.prosecdef
  and (has_function_privilege('anon', p.oid, 'EXECUTE')
       or exists (select 1 from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
                  where a.grantee = 0 and a.privilege_type = 'EXECUTE'));

-- 6) Grants directos a anon sobre tablas de public. No vacio: anon tiene privilegios; solo la RLS lo protege.
select table_name, privilege_type
from information_schema.role_table_grants
where table_schema = 'public' and grantee = 'anon'
order by table_name, privilege_type;

-- 7) Usuarios de auth.users sin fila en public.clientes (candidatos a 'admin por exclusion').
--    No vacio: si el rol admin se deduce por no ser cliente, estos usuarios serian admin. Verificar uno a uno.
--    (El panel enlaza usuario y cliente por public.clientes.auth_user_id.)
select u.id, u.email, u.created_at
from auth.users u
where not exists (select 1 from public.clientes c where c.auth_user_id = u.id);

-- 8) Columnas cliente_id sin indice inicial. No vacio: las politicas RLS por cliente haran seq scan.
select c.relname as tabla, a.attname as columna
from pg_attribute a
join pg_class c on c.oid = a.attrelid
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind in ('r','p') and a.attname = 'cliente_id' and not a.attisdropped
  and not exists (select 1 from pg_index i where i.indrelid = c.oid and i.indkey[0] = a.attnum);

-- 9) Tamano de mediciones (informativo; planificar particionado/retencion si crece).
select pg_size_pretty(pg_total_relation_size('public.mediciones')) as tamano_total,
       (select reltuples::bigint from pg_class where oid = 'public.mediciones'::regclass) as filas_aprox;
