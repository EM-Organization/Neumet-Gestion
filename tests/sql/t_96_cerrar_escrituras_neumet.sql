-- Migración C2 (20261120500000_cerrar_escrituras_neumet.sql, docs/17 §4.1 y §10): el equipo Neumet (admin) queda sin
-- escritura sobre los datos de los clientes. Pruebas generadas desde el catálogo (grants, políticas, funciones) y por rol
-- (admin, administrador de empresa, usuario de sucursal, api, sin perfil, anon). Todo en una transacción que se revierte.
begin;

insert into auth.users (id, email) values ('a0000000-0000-0000-0000-0000000000e6', 'suc96@t');
insert into public.sucursales (id, cliente_id, nombre) overriding system value values (961, 1, 'Norte 96');
insert into public.perfiles (user_id, rol, cliente_id, sucursal_id) values
  ('a0000000-0000-0000-0000-0000000000e6', 'cliente', 1, 961);
create or replace function test.u_e6() returns uuid language sql immutable as $$ select 'a0000000-0000-0000-0000-0000000000e6'::uuid $$;
grant execute on function test.u_e6() to public;

-- ---------------------------------------------------------------------------------------------
-- 1. Catálogo: privilegios de escritura (todas las relaciones de public: tablas, particionadas, vistas, matviews, foráneas)
-- ---------------------------------------------------------------------------------------------
select test.eq('catálogo: sin INSERT ni DELETE de tabla para authenticated fuera de dispositivos y gastos',
  (select coalesce(string_agg(c.relname, ',' order by c.relname), '') from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f')
      and c.relname not in ('dispositivos', 'gastos')
      and (has_table_privilege('authenticated', c.oid, 'insert') or has_table_privilege('authenticated', c.oid, 'delete')
        or has_table_privilege('authenticated', c.oid, 'truncate'))), '');
select test.eq('catálogo: ninguna columna con INSERT o UPDATE para authenticated salvo dispositivos, gastos y clientes(nombre)',
  (select coalesce(string_agg(c.relname || '.' || a.attname, ',' order by c.relname, a.attname), '')
     from pg_class c join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f')
      and c.relname not in ('dispositivos', 'gastos')
      and not (c.relname = 'clientes' and a.attname = 'nombre')
      and (has_column_privilege('authenticated', c.oid, a.attnum, 'update') or has_column_privilege('authenticated', c.oid, a.attnum, 'insert'))), '');
select test.eq('catálogo: clientes solo otorga UPDATE de columna a nombre',
  (select string_agg(a.attname, ',' order by a.attname) from pg_attribute a
    where a.attrelid = 'public.clientes'::regclass and a.attnum > 0 and not a.attisdropped
      and has_column_privilege('authenticated', 'public.clientes'::regclass, a.attnum, 'update')), 'nombre');
-- Una columna nueva de clientes debe otorgarse a propósito (la migración C2 otorgó la lista vigente en su momento):
-- si este test falla, falta `grant select (columna)` en la migración que la creó. Única excepción: precio_mensual.
select test.eq('clientes: todas las columnas salvo precio_mensual son legibles para authenticated',
  (select coalesce(string_agg(a.attname, ','), '') from pg_attribute a
    where a.attrelid = 'public.clientes'::regclass and a.attnum > 0 and not a.attisdropped and a.attname <> 'precio_mensual'
      and not has_column_privilege('authenticated', a.attrelid, a.attnum, 'select')), '');
select test.eq('catálogo: anon no escribe en ninguna relación de public',
  (select coalesce(string_agg(c.relname, ',' order by c.relname), '') from pg_class c
    where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f')
      and (has_table_privilege('anon', c.oid, 'insert') or has_table_privilege('anon', c.oid, 'update')
        or has_table_privilege('anon', c.oid, 'delete'))), '');

-- ---------------------------------------------------------------------------------------------
-- 2. Catálogo: políticas de escritura con is_admin()
-- ---------------------------------------------------------------------------------------------
select test.eq('catálogo: solo dispositivos, gastos y clientes_admin_update tienen política de escritura con is_admin()',
  (select coalesce(string_agg(tablename || '.' || policyname, ',' order by tablename, policyname), '') from pg_policies
    where schemaname = 'public' and cmd in ('ALL', 'INSERT', 'UPDATE', 'DELETE')
      and (coalesce(qual, '') like '%is_admin%' or coalesce(with_check, '') like '%is_admin%')),
  'clientes.clientes_admin_update,dispositivos.dispositivos_admin_all,gastos.gastos_admin_all');
select test.eq('catálogo: clientes_admin_update es la única política UPDATE de clientes (el global no actualiza la fila)',
  (select string_agg(policyname || ':' || cmd, ',' order by policyname) from pg_policies
    where schemaname = 'public' and tablename = 'clientes' and cmd in ('ALL', 'INSERT', 'UPDATE', 'DELETE')), 'clientes_admin_update:UPDATE');
select test.eq('catálogo: las siete tablas conservan su política de lectura para admin',
  (select count(*) from pg_policies where schemaname = 'public' and cmd = 'SELECT' and policyname like '%\_admin\_select'
     and tablename in ('clientes', 'neumaticos', 'eventos_neumatico', 'perfiles', 'stock_neumaticos', 'sucursales', 'vehiculos')), 7::bigint);

-- ---------------------------------------------------------------------------------------------
-- 3. Catálogo de funciones: cada SECURITY DEFINER ejecutable por authenticated debe figurar en un grupo
-- ---------------------------------------------------------------------------------------------
create temp table _grp96 (grupo text, f text);
insert into _grp96 values
  -- las 26 que pierden la rama de admin (docs/17 §4.1)
  ('recorta', 'alerta_configurar'), ('recorta', 'alerta_reconocer'), ('recorta', 'alerta_silenciar'), ('recorta', 'alerta_resolver'),
  ('recorta', 'neumatico_cambiar'), ('recorta', 'neumatico_montar'), ('recorta', 'neumatico_desmontar'), ('recorta', 'neumatico_rotar'),
  ('recorta', 'vehiculo_crear'), ('recorta', 'vehiculo_mover_sucursal'), ('recorta', 'vehiculo_registrar_odometro'),
  ('recorta', 'sucursal_crear'), ('recorta', 'sucursal_renombrar'), ('recorta', 'sucursal_eliminar'),
  ('recorta', 'stock_cubierta_agregar'), ('recorta', 'stock_cubierta_editar'), ('recorta', 'stock_cubierta_eliminar'), ('recorta', 'stock_cubierta_mover'),
  ('recorta', 'recauchutado_enviar'), ('recorta', 'recauchutado_dictaminar'), ('recorta', 'recauchutado_aceptar'), ('recorta', 'recauchutado_rechazar'),
  ('recorta', 'costo_registrar'), ('recorta', 'costo_eliminar'), ('recorta', 'medicion_invalidar'), ('recorta', 'medicion_revalidar'),
  -- plataforma que se conserva (2)
  ('plataforma', 'asignar_dispositivo_a_cliente'), ('plataforma', 'cliente_eliminar_suave'),
  -- lectura con rama de admin que se conserva (8)
  ('lectura', 'neumaticos_precios'), ('lectura', 'eventos_costos'), ('lectura', 'costo_cubierta_items'), ('lectura', 'costo_vida_items'),
  ('lectura', 'precios_visibles'), ('lectura', 'km_tramos_cubierta'), ('lectura', 'cuentas_api_listar'), ('lectura', 'get_unregistered_devices'),
  -- predicados de identidad (3)
  ('identidad', 'is_admin'), ('identidad', 'current_cliente_id'), ('identidad', 'current_sucursal_id'),
  -- RPC del plan de roles ya fusionadas, sin escritura del equipo Neumet: nacen con su propio control de rol
  ('plan', 'admin_empresa_cliente_id'), ('plan', 'vehiculo_corregir_odometro'), ('plan', 'usuarios_empresa_listar'),
  ('plan', 'usuario_empresa_quitar_acceso'), ('plan', 'usuario_empresa_reponer_acceso'), ('plan', 'vehiculo_eliminar'),
  -- RPC de plataforma de solo equipo Neumet (precio mensual y uso, C1 y uso mensual)
  ('plataforma', 'cliente_precios_mensuales'), ('plataforma', 'cliente_precio_mensual_fijar'), ('plataforma', 'uso_clientes_listar');

select test.eq('catálogo: toda función SECURITY DEFINER ejecutable por authenticated figura en un grupo (una nueva debe declararse aquí)',
  (select coalesce(string_agg(p.proname, ',' order by p.proname), '') from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.prosecdef and has_function_privilege('authenticated', p.oid, 'execute')
      and p.proname not in (select f from _grp96)), '');
select test.eq('catálogo: las 26 RPC recortadas existen y son SECURITY DEFINER con search_path vacío',
  (select count(distinct p.proname) from pg_proc p join _grp96 g on g.f = p.proname and g.grupo = 'recorta'
    where p.pronamespace = 'public'::regnamespace and p.prosecdef and p.proconfig @> array['search_path=""']), 26::bigint);
-- Ningún cuerpo de las funciones que pierden la rama contiene ya la rama de admin (los helpers tampoco).
select test.eq('catálogo: ni las 26 RPC ni sus helpers consultan is_admin() ni el rol admin',
  (select coalesce(string_agg(p.proname, ',' order by p.proname), '') from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and (p.proname in (select f from _grp96 where grupo = 'recorta')
           or p.proname in ('neumatico_autorizar_vehiculo', 'sucursal_autorizar_gestion', 'sucursal_autorizar_por_id', 'medicion_autorizar',
                            'stock_cubierta_autorizar_por_id', 'recauchutado_autorizar', 'alerta_cargar'))
      and (p.prosrc ~* 'is_admin\s*\(' or p.prosrc ~* '''admin''')), '');
select test.eq('catálogo: los siete helpers no son ejecutables por authenticated',
  (select count(*) from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname in ('neumatico_autorizar_vehiculo', 'sucursal_autorizar_gestion', 'sucursal_autorizar_por_id', 'medicion_autorizar',
                        'stock_cubierta_autorizar_por_id', 'recauchutado_autorizar', 'alerta_cargar')
      and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))), 0::bigint);

-- ---------------------------------------------------------------------------------------------
-- 4. Matriz por rol sobre las RPC de escritura (se genera desde pg_proc: llama con argumentos de relleno válidos)
-- ---------------------------------------------------------------------------------------------
-- La autorización va antes que cualquier validación de contenido: sin permiso siempre es 42501.
-- Argumentos de relleno por tipo: ids que sí existen en las fixtures (cliente 1, vehículo 1), para que la denegación
-- no se confunda con «no existe».
create or replace function pg_temp.dummy96(p_t oid) returns text language sql as $$
  select case format_type(p_t, null)
    when 'bigint' then '1::bigint' when 'smallint' then '1::smallint' when 'integer' then '1::integer'
    when 'numeric' then '5::numeric' when 'text' then '''x''::text' when 'boolean' then 'true'
    when 'date' then 'current_date' when 'jsonb' then '''{}''::jsonb' when 'uuid' then 'test.u_cli_a()'
    when 'timestamp with time zone' then 'now()' else 'null::' || format_type(p_t, null) end
$$;
create temp table _llamadas96 as
select p.proname f,
       'select public.' || quote_ident(p.proname) || '(' ||
       (select string_agg(pg_temp.dummy96(t.oid), ', ' order by o.n)
          from unnest(p.proargtypes::oid[]) with ordinality o(oid, n) join pg_type t on t.oid = o.oid) || ')' sql
  from pg_proc p join _grp96 g on g.f = p.proname and g.grupo in ('recorta')
 where p.pronamespace = 'public'::regnamespace
union all
select p.proname,
       'select public.' || quote_ident(p.proname) || '(' ||
       (select string_agg(pg_temp.dummy96(t.oid), ', ' order by o.n)
          from unnest(p.proargtypes::oid[]) with ordinality o(oid, n) join pg_type t on t.oid = o.oid) || ')'
  from pg_proc p
 where p.pronamespace = 'public'::regnamespace
   and p.proname in ('vehiculo_corregir_odometro', 'usuario_empresa_quitar_acceso', 'usuario_empresa_reponer_acceso');
grant select on _llamadas96 to public;
select test.eq('la matriz cubre las 26 RPC recortadas y las 3 del plan de roles', (select count(*) from _llamadas96), 29::bigint);

create or replace function pg_temp.matriz96(p_rol text) returns void language plpgsql as $$
declare
  r record;
begin
  for r in select f, sql from _llamadas96 order by f loop
    perform test.denied(p_rol || ': ' || r.f || ' denegada', r.sql, '42501');
  end loop;
end $$;

select test.become('authenticated', test.u_admin());
select pg_temp.matriz96('admin');
reset role;
select test.become('authenticated', test.u_api());
select pg_temp.matriz96('api');
reset role;
select test.become('authenticated', test.u_sinperfil());
select pg_temp.matriz96('sin perfil');
reset role;
select test.become('anon', null);
select pg_temp.matriz96('anon');
reset role;

-- El administrador de empresa y el usuario de sucursal conservan lo suyo (las matrices detalladas viven en t_70, t_80, t_85,
-- t_87, t_88, t_89, t_91 y t_92; aquí una muestra por grupo para que C2 no los deje sin rama de empresa).
select test.become('authenticated', test.u_cli_a());
select test.eq('global: sucursal_crear', (public.sucursal_crear('S96 global')->>'cliente_id'), '1');
select test.eq('global: vehiculo_crear', (public.vehiculo_crear('960', 'ZZ9600', 10::smallint, null)->>'cliente_id'), '1');
select test.eq('global: stock_cubierta_agregar', (public.stock_cubierta_agregar('Q-96-1', 'Marca')->>'cliente_id'), '1');
select test.eq('global: alerta_configurar', (public.alerta_configurar(null::bigint, 6.5)->>'umbral_critico_mm'), '6.5');
select test.eq('global: neumatico_rotar en su vehículo', (public.neumatico_rotar(1::bigint, 1::smallint, 2::smallint)->>'intercambio'), 'true');
reset role;
select test.become('authenticated', test.u_e6());
select test.denied('sucursal: no crea sucursales', $$select public.sucursal_crear('X')$$);
reset role;

-- ---------------------------------------------------------------------------------------------
-- 5. Lo que el admin conserva: plataforma (RPC, dispositivos, gastos), lectura y las RPC de lectura
-- ---------------------------------------------------------------------------------------------
select test.become('authenticated', test.u_admin());
select test.eq('admin: lee todas las tablas operativas',
  (select (select count(*) from public.clientes) > 0 and (select count(*) from public.vehiculos) > 0
      and (select count(*) from public.neumaticos) > 0 and (select count(*) from public.eventos_neumatico) >= 0
      and (select count(*) from public.sucursales) > 0 and (select count(*) from public.perfiles) > 0
      and (select count(*) from public.stock_neumaticos) >= 0), true);
select test.eq('admin: precios_visibles()', public.precios_visibles(), true);
select test.eq('admin: neumaticos_precios() responde', (select count(*) >= 0 from public.neumaticos_precios()), true);
select test.eq('admin: cuentas_api_listar responde', (select count(*) >= 0 from public.cuentas_api_listar(1)), true);
select test.eq('admin: get_unregistered_devices responde', (select count(*) >= 0 from public.get_unregistered_devices()), true);
select test.eq('admin: lee el precio mensual por la RPC', (select count(*) from public.cliente_precios_mensuales()), (select count(*) from public.clientes));
insert into public.dispositivos (mac_address, nombre, cliente_id, activo) values ('96:00:00:00:00:01', 'D96', 1, true);
update public.dispositivos set nombre = 'D96b' where mac_address = '96:00:00:00:00:01';
select test.eq('admin: dispositivos, insert y update directo (plataforma)',
  (select nombre from public.dispositivos where mac_address = '96:00:00:00:00:01'), 'D96b');
delete from public.dispositivos where mac_address = '96:00:00:00:00:01';
select test.eq('admin: dispositivos, delete directo', (select count(*) from public.dispositivos where mac_address = '96:00:00:00:00:01'), 0::bigint);
insert into public.gastos (nombre, categoria, monto) values ('G96', 'otro', 1);
select test.eq('admin: gastos, insert directo (plataforma)', (select count(*) from public.gastos where nombre = 'G96'), 1::bigint);
delete from public.gastos where nombre = 'G96';
select test.eq('admin: gastos, delete directo', (select count(*) from public.gastos where nombre = 'G96'), 0::bigint);
select test.eq('admin: asignar_dispositivo_a_cliente sigue ejecutable',
  (public.asignar_dispositivo_a_cliente('96:00:00:00:00:02', 1, 'D96 nuevo') is not null), true);
select test.eq('admin: cliente_eliminar_suave sigue ejecutable (baja lógica)',
  (public.cliente_eliminar_suave(2) is not null), true);
update public.clientes set nombre = 'Cliente B 96' where id = 2;
select test.eq('admin: el nombre quedó guardado', (select nombre from public.clientes where id = 2), 'Cliente B 96');
-- auth_user_id no se reasigna por la API (decisión del dueño, docs/17 §4.1): sin grant de columna.
select test.denied('admin: no reasigna clientes.auth_user_id', $$update public.clientes set auth_user_id = test.u_sinperfil() where id = 2$$);
select test.eq('admin: el cliente 2 sigue sin cuenta reasignada', (select count(*) from public.perfiles where user_id = test.u_sinperfil()), 0::bigint);
reset role;

-- ---------------------------------------------------------------------------------------------
-- 6. Escritura directa del admin (PostgREST): 42501 en cada tabla operativa
-- ---------------------------------------------------------------------------------------------
select test.become('authenticated', test.u_admin());
select test.denied('admin: insert directo en vehiculos', $$insert into public.vehiculos (cliente_id, nombre, patente) values (1, 'X', 'ZZ0000')$$);
select test.denied('admin: update directo en vehiculos', $$update public.vehiculos set nombre = 'x' where id = 1$$);
select test.denied('admin: delete directo en vehiculos', $$delete from public.vehiculos where id = 4$$);
select test.denied('admin: insert directo en neumaticos', $$insert into public.neumaticos (vehiculo_id, cliente_id, posicion) values (1, 1, 60)$$);
select test.denied('admin: update directo en neumaticos', $$update public.neumaticos set marca = 'x' where id > 0$$);
select test.denied('admin: delete directo en neumaticos', $$delete from public.neumaticos where id > 0$$);
select test.denied('admin: insert directo en eventos_neumatico', $$insert into public.eventos_neumatico (cliente_id, vehiculo_id, tipo) values (1, 1, 'baja')$$);
select test.denied('admin: update directo en eventos_neumatico', $$update public.eventos_neumatico set notas = 'x'$$);
select test.denied('admin: delete directo en eventos_neumatico', $$delete from public.eventos_neumatico$$);
select test.denied('admin: insert directo en stock_neumaticos', $$insert into public.stock_neumaticos (cliente_id, marca, cantidad) values (1, 'x', 1)$$);
select test.denied('admin: update directo en stock_neumaticos', $$update public.stock_neumaticos set marca = 'x'$$);
select test.denied('admin: delete directo en stock_neumaticos', $$delete from public.stock_neumaticos$$);
select test.denied('admin: insert directo en sucursales', $$insert into public.sucursales (cliente_id, nombre) values (1, 'x')$$);
select test.denied('admin: update directo en sucursales', $$update public.sucursales set nombre = 'x'$$);
select test.denied('admin: delete directo en sucursales', $$delete from public.sucursales$$);
select test.denied('admin: insert directo en perfiles (escalada de privilegios)', $$insert into public.perfiles (user_id, rol) values (test.u_sinperfil(), 'admin')$$);
select test.denied('admin: update directo en perfiles', $$update public.perfiles set rol = 'admin' where user_id = test.u_cli_a()$$);
select test.denied('admin: delete directo en perfiles (saltaría accesos_quitados)', $$delete from public.perfiles where user_id = test.u_cli_a()$$);
select test.denied('admin: insert directo en clientes', $$insert into public.clientes (nombre) values ('Nuevo')$$);
select test.denied('admin: delete directo en clientes', $$delete from public.clientes where id = 2$$);
select test.denied('admin: precio_mensual directo (solo por RPC)', $$update public.clientes set precio_mensual = 1 where id = 1$$);
select test.denied('admin: umbral_critico_mm directo (solo alerta_configurar)', $$update public.clientes set umbral_critico_mm = 5 where id = 1$$);
select test.denied('admin: huella_absurda_mm directo', $$update public.clientes set huella_absurda_mm = 5 where id = 1$$);
select test.denied('admin: irregularidad_mm directo', $$update public.clientes set irregularidad_mm = 1 where id = 1$$);
select test.denied('admin: no lee precio_mensual por la tabla', $$select precio_mensual from public.clientes$$);
select test.denied('admin: select * de clientes falla por la columna sensible', $$select * from public.clientes$$);
select test.eq('admin: lee el resto de las columnas de clientes (nombre, umbrales)',
  (select count(*) from (select id, nombre, auth_user_id, umbral_bajo_mm, umbral_critico_mm, umbral_retiro_mm, dias_sin_medir_alerta,
                                irregularidad_mm, alerta_histeresis_mm, huella_absurda_mm, created_at, deleted_at from public.clientes) q), (select count(*) from public.clientes));
reset role;

-- ---------------------------------------------------------------------------------------------
-- 7. clientes por columna para los roles de empresa: precio_mensual ilegible; escritura solo por RPC
-- ---------------------------------------------------------------------------------------------
select test.become('authenticated', test.u_cli_a());
select test.denied('global: no lee precio_mensual', $$select precio_mensual from public.clientes$$);
select test.denied('global: select * de clientes falla', $$select * from public.clientes$$);
select test.eq('global: lee el nombre de su cliente', (select nombre from public.clientes), 'Cliente A');
select test.eq('global: lee sus umbrales', (select umbral_critico_mm from public.clientes), 6.5);
select test.denied('global: no escribe precio_mensual', $$update public.clientes set precio_mensual = 1 where id = 1$$);
select test.denied('global: no escribe umbrales directo (solo alerta_configurar)', $$update public.clientes set umbral_critico_mm = 5 where id = 1$$);
select test.denied('global: no escribe huella_absurda_mm directo', $$update public.clientes set huella_absurda_mm = 5 where id = 1$$);
update public.clientes set nombre = 'Hack' where id = 1;
select test.denied('global: no inserta clientes', $$insert into public.clientes (nombre) values ('x')$$);
select test.denied('global: no borra clientes', $$delete from public.clientes where id = 1$$);
reset role;
-- (el UPDATE de nombre del global afecta 0 filas: sin política UPDATE para la empresa)
select test.eq('el nombre del cliente 1 no cambió', (select nombre from public.clientes where id = 1), 'Cliente A');
select test.become('authenticated', test.u_cli_a());
select test.denied('global: no reasigna auth_user_id', $$update public.clientes set auth_user_id = test.u_sinperfil() where id = 1$$);
reset role;
select test.become('authenticated', test.u_e6());
select test.denied('sucursal: no reasigna auth_user_id', $$update public.clientes set auth_user_id = test.u_sinperfil() where id = 1$$);
reset role;
select test.eq('auth_user_id del cliente 1 no cambió', (select auth_user_id from public.clientes where id = 1), test.u_cli_a());
select test.become('authenticated', test.u_e6());
select test.denied('sucursal: no lee precio_mensual', $$select precio_mensual from public.clientes$$);
select test.denied('sucursal: no escribe precio_mensual', $$update public.clientes set precio_mensual = 1 where id = 1$$);
select test.eq('sucursal: lee el nombre de su cliente', (select nombre from public.clientes), 'Cliente A');
reset role;
select test.become('authenticated', test.u_api());
select test.denied('api: no lee precio_mensual', $$select precio_mensual from public.clientes$$);
update public.clientes set nombre = 'x-api';
reset role;
select test.eq('api: el update de nombre no afectó filas (sin política UPDATE)', (select count(*) from public.clientes where nombre = 'x-api'), 0::bigint);
select test.become('authenticated', test.u_sinperfil());
select test.denied('sin perfil: no lee precio_mensual', $$select precio_mensual from public.clientes$$);
select test.eq('sin perfil: no ve ningún cliente', (select count(*) from public.clientes), 0::bigint);
reset role;
select test.become('anon', null);
select test.denied('anon: no lee clientes', $$select nombre from public.clientes$$);
reset role;

-- Las vistas siguen leyendo `clientes` (security_invoker) sin necesitar precio_mensual
select test.become('authenticated', test.u_cli_a());
select test.eq('global: las vistas de estado y alertas responden con el privilegio por columna',
  (select count(*) >= 0 from public.v_estado_neumaticos) and (select count(*) >= 0 from public.v_alertas), true);
reset role;

rollback;
