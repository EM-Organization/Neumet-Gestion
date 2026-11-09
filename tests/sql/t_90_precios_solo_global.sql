-- Precios y costos solo para admin y perfil global (migración 20261116500000): privilegios por columna sobre
-- neumaticos.precio_unidad y eventos_neumatico.costo. Un perfil de sucursal NO los lee ni por select directo, ni por
-- `select *`, ni por filtro u orden (42501); admin y global los leen solo por neumaticos_precios() / eventos_costos().
-- Las vistas security_invoker y las funciones existentes siguen funcionando para todos los roles.
-- Matriz: admin, global A, sucursal Norte (y Sur), otro cliente B, api, sin perfil y anon. Todo en una transacción que se revierte.
begin;

insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-000000000090', 'p90n@t'), ('a0000000-0000-0000-0000-000000000091', 'p90s@t');
insert into public.sucursales (id, cliente_id, nombre) overriding system value values
  (901, 1, 'Precios Norte'), (902, 1, 'Precios Sur');
insert into public.perfiles (user_id, rol, cliente_id, sucursal_id) values
  ('a0000000-0000-0000-0000-000000000090', 'cliente', 1, 901),
  ('a0000000-0000-0000-0000-000000000091', 'cliente', 1, 902);
create or replace function test.u_p90n() returns uuid language sql immutable as $$ select 'a0000000-0000-0000-0000-000000000090'::uuid $$;
create or replace function test.u_p90s() returns uuid language sql immutable as $$ select 'a0000000-0000-0000-0000-000000000091'::uuid $$;
grant execute on function test.u_p90n(), test.u_p90s() to public;

insert into public.vehiculos (id, cliente_id, sucursal_id, nombre, patente, numero, activo, odometro_km) values
  (901, 1, 901, 'P901', 'PP9010', '901', true, 5000),
  (902, 1, 902, 'P902', 'PP9020', '902', true, 7000);
insert into public.neumaticos (vehiculo_id, cliente_id, posicion, idneumatico, estado, marca, precio_unidad) values
  (901, 1, 1, 'P90-N1', 'montado', 'M', 111.10), (901, 1, 2, 'P90-N2', 'montado', 'M', null),
  (902, 1, 1, 'P90-S1', 'montado', 'M', 222.20);
-- Stock del cliente A (sin vehículo) y neumático del cliente B con precio
insert into public.neumaticos (vehiculo_id, cliente_id, posicion, idneumatico, estado, marca, precio_unidad, numero_quema) values
  (null, 1, null, 'P90-STK', 'almacenado', 'M', 333.30, 'P90-STK');
update public.neumaticos set precio_unidad = 777.70 where idneumatico = 'T-3-1';
insert into public.mediciones (vehiculo_id, cliente_id, posicion, idneumatico, mm1, mm2, mm3, created_at) values
  (901, 1, 1, 'P90-N1', 9, 9, 9, now() - interval '2 days'), (901, 1, 1, 'P90-N1', 8, 8, 8, now() - interval '1 day'),
  (902, 1, 1, 'P90-S1', 12, 12, 12, now() - interval '1 day');
insert into public.eventos_neumatico (cliente_id, vehiculo_id, neumatico_id, idneumatico, tipo, odometro_km, costo, created_at) values
  (1, 901, (select id from public.neumaticos where idneumatico = 'P90-N1'), 'P90-N1', 'montaje', 4000, 111.10, now() - interval '5 days'),
  (1, 901, (select id from public.neumaticos where idneumatico = 'P90-N1'), 'P90-N1', 'reparacion', 4500, 15.00, now() - interval '4 days'),
  (1, 901, (select id from public.neumaticos where idneumatico = 'P90-N2'), 'P90-N2', 'montaje', 4000, null, now() - interval '5 days'),
  (1, 902, (select id from public.neumaticos where idneumatico = 'P90-S1'), 'P90-S1', 'montaje', 6000, 222.20, now() - interval '5 days');

-- ---------------------------------------------------------------------------
-- 0. Contrato de privilegios (sin cambiar de rol)
-- ---------------------------------------------------------------------------
select test.eq('authenticated no tiene SELECT de tabla sobre neumaticos', has_table_privilege('authenticated', 'public.neumaticos', 'select'), false);
select test.eq('authenticated no tiene SELECT de tabla sobre eventos_neumatico', has_table_privilege('authenticated', 'public.eventos_neumatico', 'select'), false);
select test.eq('authenticated no lee neumaticos.precio_unidad', has_column_privilege('authenticated', 'public.neumaticos', 'precio_unidad', 'select'), false);
select test.eq('authenticated no lee eventos_neumatico.costo', has_column_privilege('authenticated', 'public.eventos_neumatico', 'costo', 'select'), false);
-- Cualquier columna nueva debe otorgarse a propósito: si este test falla, falta `grant select (columna)` en la migración que la creó.
select test.eq('neumaticos: todas las demás columnas son legibles',
  (select coalesce(string_agg(a.attname, ','), '') from pg_attribute a
    where a.attrelid = 'public.neumaticos'::regclass and a.attnum > 0 and not a.attisdropped and a.attname <> 'precio_unidad'
      and not has_column_privilege('authenticated', a.attrelid, a.attnum, 'select')), '');
select test.eq('eventos_neumatico: todas las demás columnas son legibles',
  (select coalesce(string_agg(a.attname, ','), '') from pg_attribute a
    where a.attrelid = 'public.eventos_neumatico'::regclass and a.attnum > 0 and not a.attisdropped and a.attname <> 'costo'
      and not has_column_privilege('authenticated', a.attrelid, a.attnum, 'select')), '');
select test.eq('anon no tiene ningún privilegio sobre neumaticos', has_any_column_privilege('anon', 'public.neumaticos', 'select'), false);
select test.eq('anon no tiene ningún privilegio sobre eventos_neumatico', has_any_column_privilege('anon', 'public.eventos_neumatico', 'select'), false);
select test.eq('PUBLIC no ejecuta las funciones de lectura',
  (select count(*) from pg_proc p, aclexplode(p.proacl) a
    where p.pronamespace = 'public'::regnamespace and p.proname in ('neumaticos_precios', 'eventos_costos', 'precios_visibles')
      and a.grantee = 0), 0::bigint);
select test.eq('las funciones de lectura son SECURITY DEFINER con search_path vacío',
  (select count(*) from pg_proc p
    where p.pronamespace = 'public'::regnamespace and p.proname in ('neumaticos_precios', 'eventos_costos', 'precios_visibles')
      and p.prosecdef and p.proconfig = array['search_path=""']), 3::bigint);
select test.eq('las vistas siguen siendo security_invoker',
  (select count(*) from pg_class c where c.relnamespace = 'public'::regnamespace
     and c.relname in ('v_estado_neumaticos', 'v_alertas', 'v_mediciones_neumatico', 'v_ultima_medicion', 'v_km_cubierta')
     and c.reloptions @> array['security_invoker=true']), 5::bigint);

-- ---------------------------------------------------------------------------
-- 1. Perfil de SUCURSAL (Norte): no ve precios ni costos de su propia sucursal
-- ---------------------------------------------------------------------------
select test.become('authenticated', test.u_p90n());
select test.eq('sucursal: precios_visibles() = false', public.precios_visibles(), false);
select test.denied('sucursal: select precio_unidad', 'select precio_unidad from public.neumaticos');
select test.denied('sucursal: select precio_unidad de su vehículo', 'select precio_unidad from public.neumaticos where vehiculo_id = 901');
select test.denied('sucursal: select * de neumaticos', 'select * from public.neumaticos');
select test.denied('sucursal: select n.* de neumaticos', 'select n.* from public.neumaticos n where n.vehiculo_id = 901');
select test.denied('sucursal: to_jsonb de la fila completa', 'select to_jsonb(n) from public.neumaticos n where n.vehiculo_id = 901');
select test.denied('sucursal: filtrar por precio_unidad', 'select id from public.neumaticos where precio_unidad > 0');
select test.denied('sucursal: ordenar por precio_unidad', 'select id from public.neumaticos order by precio_unidad');
select test.denied('sucursal: agregar precio_unidad', 'select sum(precio_unidad) from public.neumaticos');
select test.denied('sucursal: select costo', 'select costo from public.eventos_neumatico');
select test.denied('sucursal: select * de eventos_neumatico', 'select * from public.eventos_neumatico');
select test.denied('sucursal: filtrar por costo', 'select id from public.eventos_neumatico where costo is not null');
select test.denied('sucursal: costo vía subconsulta', 'select (select max(e.costo) from public.eventos_neumatico e where e.vehiculo_id = v.id) from public.vehiculos v');
select test.eq('sucursal: sí lee el resto de columnas de su sucursal (RLS intacta)',
  (select string_agg(idneumatico || ':' || marca, ',' order by idneumatico) from public.neumaticos where vehiculo_id = 901), 'P90-N1:M,P90-N2:M');
select test.eq('sucursal: sigue sin ver neumáticos de otra sucursal', (select count(*) from public.neumaticos where vehiculo_id = 902), 0::bigint);
select test.eq('sucursal: eventos de su sucursal (sin costo)',
  (select string_agg(tipo, ',' order by id) from public.eventos_neumatico where vehiculo_id = 901), 'montaje,reparacion,montaje');
select test.eq('sucursal: count(*) funciona', (select count(*) from public.neumaticos), 2::bigint);
select test.eq('sucursal: neumaticos_precios() vacío', (select count(*) from public.neumaticos_precios()), 0::bigint);
select test.eq('sucursal: neumaticos_precios(su vehículo) vacío', (select count(*) from public.neumaticos_precios(901)), 0::bigint);
select test.eq('sucursal: eventos_costos() vacío', (select count(*) from public.eventos_costos()), 0::bigint);
select test.eq('sucursal: eventos_costos(su vehículo) vacío', (select count(*) from public.eventos_costos(901)), 0::bigint);
-- Vistas y funciones existentes (security_invoker): siguen funcionando con sus filas
select test.eq('sucursal: v_estado_neumaticos', (select count(*) from public.v_estado_neumaticos where vehiculo_id = 901), 2::bigint);
select test.eq('sucursal: v_estado_neumaticos no trae otras sucursales', (select count(*) from public.v_estado_neumaticos where vehiculo_id = 902), 0::bigint);
select test.eq('sucursal: v_ultima_medicion', (select count(*) from public.v_ultima_medicion where vehiculo_id = 901), 1::bigint);
select test.eq('sucursal: v_mediciones_neumatico', (select count(*) from public.v_mediciones_neumatico where vehiculo_id = 901), 2::bigint);
select test.eq('sucursal: v_alertas se consulta', (select count(*) >= 0 from public.v_alertas), true);
select test.eq('sucursal: v_km_cubierta', (select string_agg(idneumatico, ',' order by idneumatico) from public.v_km_cubierta where idneumatico like 'P90-%'), 'P90-N1,P90-N2');
select test.eq('sucursal: v_resumen_flota_cliente se consulta', (select count(*) >= 0 from public.v_resumen_flota_cliente), true);
select test.eq('sucursal: ultimas_mediciones', (select array_agg(vehiculo_id) from public.ultimas_mediciones(8)), array[901::bigint]);
select test.eq('sucursal: odometro_anomalias se ejecuta', (select count(*) >= 0 from public.odometro_anomalias(901)), true);
select test.eq('sucursal: km_tramos_cubierta se ejecuta',
  (select count(*) >= 0 from public.km_tramos_cubierta((select id from public.neumaticos where idneumatico = 'P90-N1'))), true);
select test.eq('sucursal: posiciones_medidas_sin_neumatico se ejecuta', (select count(*) >= 0 from public.posiciones_medidas_sin_neumatico(901)), true);
reset role;

select test.become('authenticated', test.u_p90s());
select test.denied('sucursal Sur: select precio_unidad', 'select precio_unidad from public.neumaticos');
select test.denied('sucursal Sur: select costo', 'select costo from public.eventos_neumatico');
select test.eq('sucursal Sur: neumaticos_precios() vacío', (select count(*) from public.neumaticos_precios()), 0::bigint);
select test.eq('sucursal Sur: eventos_costos() vacío', (select count(*) from public.eventos_costos()), 0::bigint);
select test.eq('sucursal Sur: ve su vehículo y no el de Norte', (select array_agg(distinct vehiculo_id) from public.v_estado_neumaticos where vehiculo_id in (901, 902)), array[902::bigint]);
reset role;

-- ---------------------------------------------------------------------------
-- 2. Perfil GLOBAL (cliente A): ve precios y costos de su cliente solo por las funciones
-- ---------------------------------------------------------------------------
select test.become('authenticated', test.u_cli_a());
select test.eq('global: precios_visibles() = true', public.precios_visibles(), true);
select test.denied('global: tampoco lee precio_unidad por select directo', 'select precio_unidad from public.neumaticos');
select test.denied('global: tampoco select * de neumaticos', 'select * from public.neumaticos');
select test.denied('global: tampoco lee costo por select directo', 'select costo from public.eventos_neumatico');
select test.denied('global: tampoco select * de eventos_neumatico', 'select * from public.eventos_neumatico');
select test.eq('global: precios de todos sus neumáticos (vehículos de todas las sucursales y stock), no los de B',
  (select string_agg(n.idneumatico || '=' || p.precio_unidad, ',' order by n.idneumatico)
     from public.neumaticos_precios() p join public.neumaticos n on n.id = p.id where n.idneumatico like 'P90-%'),
  'P90-N1=111.10,P90-S1=222.20,P90-STK=333.30');
select test.eq('global: ningún precio de otro cliente', (select count(*) from public.neumaticos_precios() p where p.precio_unidad = 777.70), 0::bigint);
select test.eq('global: precios de un vehículo',
  (select string_agg(n.idneumatico, ',') from public.neumaticos_precios(901) p join public.neumaticos n on n.id = p.id), 'P90-N1');
select test.eq('global: precios de un vehículo de otro cliente: nada', (select count(*) from public.neumaticos_precios(3)), 0::bigint);
select test.eq('global: solo stock',
  (select string_agg(n.idneumatico, ',') from public.neumaticos_precios(null, true) p join public.neumaticos n on n.id = p.id), 'P90-STK');
select test.eq('global: costos de sus eventos, no los de B',
  (select string_agg(costo::text, ',' order by costo) from public.eventos_costos() where costo in (350.00, 20.50, 111.10, 15.00, 222.20, 400.00)),
  '15.00,20.50,111.10,222.20,350.00');
select test.eq('global: costos de un vehículo', (select string_agg(costo::text, ',' order by costo) from public.eventos_costos(901)), '15.00,111.10');
select test.eq('global: costos de un vehículo de otro cliente: nada', (select count(*) from public.eventos_costos(3)), 0::bigint);
select test.eq('global: el resultado se filtra y se ordena como una tabla (PostgREST)',
  (select count(*) from (select * from public.eventos_costos() where costo >= 100 order by id limit 2) x), 2::bigint);
select test.eq('global: vistas y funciones existentes', (select count(*) from public.v_estado_neumaticos where vehiculo_id in (901, 902)), 3::bigint);
select test.eq('global: ultimas_mediciones', (select count(*) >= 2 from public.ultimas_mediciones(8)), true);
select test.eq('global: v_km_cubierta', (select count(*) from public.v_km_cubierta where idneumatico like 'P90-%'), 4::bigint);
reset role;

-- ---------------------------------------------------------------------------
-- 3. Admin: todos los clientes, solo por las funciones
-- ---------------------------------------------------------------------------
select test.become('authenticated', test.u_admin());
select test.eq('admin: precios_visibles() = true', public.precios_visibles(), true);
select test.denied('admin: tampoco select directo de precio_unidad', 'select precio_unidad from public.neumaticos');
select test.denied('admin: tampoco select *', 'select * from public.neumaticos');
select test.denied('admin: tampoco select directo de costo', 'select costo from public.eventos_neumatico');
select test.denied('admin: tampoco select * de eventos', 'select * from public.eventos_neumatico');
select test.eq('admin: precios de todos los clientes',
  (select string_agg(n.idneumatico || '=' || p.precio_unidad, ',' order by n.idneumatico) from public.neumaticos_precios() p join public.neumaticos n on n.id = p.id
    where n.idneumatico in ('P90-N1', 'P90-S1', 'P90-STK', 'T-3-1')), 'P90-N1=111.10,P90-S1=222.20,P90-STK=333.30,T-3-1=777.70');
select test.eq('admin: costos de todos los clientes (incluye el de B)',
  (select count(*) from public.eventos_costos() where costo = 400.00), 1::bigint);
select test.eq('admin: costos de un vehículo de otro cliente', (select string_agg(costo::text, ',') from public.eventos_costos(3)), '400.00');
select test.eq('admin: no devuelve filas sin valor', (select count(*) from public.neumaticos_precios() p where p.precio_unidad is null) , 0::bigint);
-- Escrituras del admin: INSERT / UPDATE / upsert siguen funcionando (privilegios de escritura, no de lectura)
insert into public.neumaticos (vehiculo_id, cliente_id, posicion, marca, precio_unidad) values (901, 1, 60, 'AdminIns', 50.5);
update public.neumaticos set precio_unidad = 51.5 where vehiculo_id = 901 and posicion = 60;
select test.eq('admin: insert y update con precio_unidad', (select p.precio_unidad from public.neumaticos_precios(901) p join public.neumaticos n on n.id = p.id and n.posicion = 60), 51.50);
-- Upsert (forma de PostgREST, onConflict: vehiculo_id,posicion): ON CONFLICT DO UPDATE que LEE excluded.precio_unidad
-- exige SELECT sobre la columna, por eso el panel del admin ya no usa upsert: actualiza por id o inserta.
select test.denied('admin: upsert que lee excluded.precio_unidad', $$insert into public.neumaticos (vehiculo_id, cliente_id, posicion, marca, precio_unidad)
  select vehiculo_id, cliente_id, posicion, marca, precio_unidad from json_populate_recordset(null::public.neumaticos,
    '[{"vehiculo_id":901,"cliente_id":1,"posicion":60,"marca":"AdminUps","precio_unidad":52.5}]'::json) _
  on conflict (vehiculo_id, posicion) do update set marca = excluded.marca, precio_unidad = excluded.precio_unidad$$);
update public.neumaticos set marca = 'AdminUpd', precio_unidad = 52.5 where id = (select id from public.neumaticos where vehiculo_id = 901 and posicion = 60);
select test.eq('admin: ...marca y precio', (select n.marca || '|' || p.precio_unidad from public.neumaticos_precios(901) p join public.neumaticos n on n.id = p.id and n.posicion = 60), 'AdminUpd|52.50');
insert into public.eventos_neumatico (cliente_id, vehiculo_id, tipo, costo, notas) values (1, 901, 'reparacion', 7.25, 'p90');
select test.eq('admin: insert de evento con costo', (select count(*) from public.eventos_costos(901) where costo = 7.25), 1::bigint);
select test.denied('admin: RETURNING de la columna sensible', $$update public.neumaticos set marca = 'x' where vehiculo_id = 901 and posicion = 60 returning precio_unidad$$);
update public.neumaticos set marca = 'AdminUpd' where vehiculo_id = 901 and posicion = 60 returning id;
select test.eq('admin: vistas', (select count(*) > 0 from public.v_estado_neumaticos), true);
select test.eq('admin: v_alertas', (select count(*) >= 0 from public.v_alertas), true);
select test.eq('admin: v_km_cubierta', (select count(*) >= 4 from public.v_km_cubierta where idneumatico like 'P90-%'), true);
select test.eq('admin: v_mediciones_neumatico', (select count(*) > 0 from public.v_mediciones_neumatico), true);
select test.eq('admin: ultimas_mediciones', (select count(*) > 0 from public.ultimas_mediciones(8)), true);
reset role;

-- ---------------------------------------------------------------------------
-- 4. Otro cliente (B): solo lo suyo
-- ---------------------------------------------------------------------------
select test.become('authenticated', test.u_cli_b());
select test.eq('cliente B: precios_visibles() = true (es global de su cliente)', public.precios_visibles(), true);
select test.denied('cliente B: select directo de precio_unidad', 'select precio_unidad from public.neumaticos');
select test.eq('cliente B: solo ve los precios de lo suyo', (select string_agg(p.precio_unidad::text, ',') from public.neumaticos_precios() p), '777.70');
select test.eq('cliente B: solo ve los costos de lo suyo', (select string_agg(costo::text, ',') from public.eventos_costos()), '400.00');
select test.eq('cliente B: no ve precios de un vehículo de A', (select count(*) from public.neumaticos_precios(901)), 0::bigint);
select test.eq('cliente B: no ve costos de un vehículo de A', (select count(*) from public.eventos_costos(901)), 0::bigint);
reset role;

-- ---------------------------------------------------------------------------
-- 5. api, sin perfil y anon
-- ---------------------------------------------------------------------------
select test.become('authenticated', test.u_api());
select test.eq('api: precios_visibles() = false', public.precios_visibles(), false);
select test.denied('api: select precio_unidad', 'select precio_unidad from public.neumaticos');
select test.denied('api: select costo', 'select costo from public.eventos_neumatico');
select test.eq('api: neumaticos_precios() vacío', (select count(*) from public.neumaticos_precios()), 0::bigint);
select test.eq('api: eventos_costos() vacío', (select count(*) from public.eventos_costos()), 0::bigint);
select test.eq('api: no ve nada en neumaticos (sin políticas)', (select count(*) from public.neumaticos), 0::bigint);
select test.eq('api: vista vacía', (select count(*) from public.v_estado_neumaticos), 0::bigint);
reset role;
select test.become('authenticated', test.u_sinperfil());
select test.eq('sin perfil: precios_visibles() = false', public.precios_visibles(), false);
select test.denied('sin perfil: select precio_unidad', 'select precio_unidad from public.neumaticos');
select test.eq('sin perfil: neumaticos_precios() vacío', (select count(*) from public.neumaticos_precios()), 0::bigint);
select test.eq('sin perfil: eventos_costos() vacío', (select count(*) from public.eventos_costos()), 0::bigint);
reset role;
select test.become('anon', null);
select test.denied('anon: select neumaticos', 'select id from public.neumaticos');
select test.denied('anon: select precio_unidad', 'select precio_unidad from public.neumaticos');
select test.denied('anon: select eventos_neumatico', 'select id from public.eventos_neumatico');
select test.denied('anon: select costo', 'select costo from public.eventos_neumatico');
select test.denied('anon: precios_visibles()', 'select public.precios_visibles()');
select test.denied('anon: neumaticos_precios()', 'select * from public.neumaticos_precios()');
select test.denied('anon: eventos_costos()', 'select * from public.eventos_costos()');
reset role;

-- ---------------------------------------------------------------------------
-- 6. RPC SECURITY DEFINER: leen y escriben como su dueño y no se ven afectadas
-- ---------------------------------------------------------------------------
select test.become('authenticated', test.u_p90n());
select test.eq('sucursal: neumatico_cambiar con un neumático ingresado (precio) sigue funcionando',
  (public.neumatico_cambiar(901::bigint, 2::smallint, 'baja', 'Prueba', 5100, null, '{"marca":"Nueva","precio":99.5}'::jsonb) ->> 'stock_restante') is null, true);
select test.denied('sucursal: sigue sin poder escribir neumaticos directo', $$insert into public.neumaticos (vehiculo_id, cliente_id, posicion, marca) values (901, 1, 50, 'X')$$);
reset role;
select test.eq('el cambio de la sucursal imputó el precio como costo del montaje (lectura como dueño)',
  (select test.cu(id) from public.eventos_neumatico where vehiculo_id = 901 and tipo = 'montaje' and odometro_km = 5100), 99.50);
select test.eq('...y el precio quedó en la fila nueva',
  (select test.pu(id) from public.neumaticos where vehiculo_id = 901 and posicion = 2 and estado = 'montado'), 99.50);

rollback;
