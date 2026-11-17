-- API de proveedor: guardar_montaje_mm CREA el vehículo y los neumáticos (migración 20261121000000).
--   patente nueva + posiciones válidas -> vehículo (cliente del llamante) + neumáticos + mediciones
--   tipo_ruedas deducido; posiciones inválidas no crean neumático; ninguna válida -> no se crea nada
--   idempotencia (replay no duplica), aislamiento entre clientes, existentes sin cambios, permisos.
begin;

insert into public.vehiculos (id, cliente_id, nombre, patente, activo) values
  (91, 2, 'T97 de B', 'TT9700', true),     -- misma patente que se usará en A: unicidad por cliente
  (92, 1, 'T97 existente', 'TT9710', true);
insert into public.neumaticos (vehiculo_id, cliente_id, posicion, idneumatico, estado) values
  (92, 1, 1, 'N-92-1', 'montado');

select count(*) as veh0 from public.vehiculos \gset
create temp table _r (k text, r jsonb);
grant all on _r to public;

-- 1. Alta con 1, 2 y auxilio: tipo 10, un neumático por posición válida, auxilio solo en 99
insert into _r select 'alta', public.api_guardar_montaje(1, test.u_api(), ' tt 9700 ',
  '[{"posicion":1,"mm1":9,"mm2":9,"mm3":9},{"posicion":2,"mm1":8,"mm2":8,"mm3":8},
    {"posicion":99,"mm1":7,"mm2":7,"mm3":7}]'::jsonb, gen_random_uuid(), 'k97-a', 'ha');
select test.eq('alta: estado ok, creado, 3 neumáticos',
  (select (r->>'estado') || '/' || (r->>'creado') || '/' || (r->>'neumaticos_creados') from _r where k = 'alta'), 'ok/true/3');
select test.eq('alta: todas guardado:true',
  (select string_agg((e->>'posicion') || ':' || (e->>'guardado'), ',' order by (e->>'posicion')::int)
     from _r, jsonb_array_elements(r->'resultados') e where k = 'alta'), '1:true,2:true,99:true');
select test.eq('alta: un vehículo más', (select count(*) from public.vehiculos), :veh0::bigint + 1);
select test.eq('alta: en el cliente del llamante (A), patente normalizada, tipo 10, sin sucursal',
  (select cliente_id || '/' || patente_norm || '/' || tipo_ruedas || '/' || coalesce(sucursal_id::text, 'null') || '/' || activo
     from public.vehiculos where id = (select (r->>'vehiculo_id')::bigint from _r where k = 'alta')), '1/TT9700/10/null/true');
select test.eq('alta: el coche de B con la misma patente sigue siendo de B y único',
  (select count(*) from public.vehiculos where patente_norm = 'TT9700' and cliente_id = 2), 1::bigint);
select test.eq('alta: neumáticos sin marca/modelo/precio/fecha, idneumatico estable, auxilio solo en 99',
  (select string_agg(posicion || ':' || idneumatico || ':' || auxilio || ':' || estado || ':'
                     || (marca is null and modelo is null and precio_unidad is null and fecha_compra is null), ',' order by posicion)
     from public.neumaticos where vehiculo_id = (select (r->>'vehiculo_id')::bigint from _r where k = 'alta')),
  (select '1:API-' || v || '-P1:false:montado:true,2:API-' || v || '-P2:false:montado:true,99:API-' || v || '-P99:true:montado:true'
     from (select (r->>'vehiculo_id') v from _r where k = 'alta') x));
select test.eq('alta: 3 mediciones con el idneumatico y device api:<cuenta>',
  (select count(*) from public.mediciones m
    where m.vehiculo_id = (select (r->>'vehiculo_id')::bigint from _r where k = 'alta')
      and m.idneumatico like 'API-%' and m.device_id = 'api:' || test.u_api()::text), 3::bigint);
select test.eq('alta: obtener_montaje ya lo devuelve',
  (select jsonb_array_length(public.api_obtener_montaje(1, 'TT9700', null)->'data')), 3);

-- 2. Replay idempotente: misma respuesta, sin crear de nuevo
select (select count(*) from public.vehiculos) || '/' || (select count(*) from public.neumaticos) || '/' || (select count(*) from public.mediciones) as cuenta1 \gset
select test.eq('replay: misma respuesta con replay:true',
  public.api_guardar_montaje(1, test.u_api(), 'TT9700',
    '[{"posicion":1,"mm1":9,"mm2":9,"mm3":9},{"posicion":2,"mm1":8,"mm2":8,"mm3":8},{"posicion":99,"mm1":7,"mm2":7,"mm3":7}]'::jsonb,
    gen_random_uuid(), 'k97-a', 'ha'),
  (select (r - 'replay') || '{"replay":true}'::jsonb from _r where k = 'alta'));
select test.eq('replay: nada nuevo',
  (select count(*) from public.vehiculos) || '/' || (select count(*) from public.neumaticos) || '/' || (select count(*) from public.mediciones),
  :'cuenta1');
-- Otra clave con la misma patente ya creada: camino de siempre (no crea otro coche)
select test.eq('misma patente con otra clave: no duplica el vehículo; posición nueva -> posicion',
  (select string_agg((e->>'posicion') || ':' || (e->>'guardado') || ':' || coalesce(e->>'motivo', '-'), ',' order by (e->>'posicion')::int)
     from jsonb_array_elements(public.api_guardar_montaje(1, test.u_api(), 'TT9700',
       '[{"posicion":1,"mm1":6,"mm2":6,"mm3":6},{"posicion":5,"mm1":6,"mm2":6,"mm3":6}]'::jsonb, gen_random_uuid(), 'k97-a2', 'ha2')->'resultados') e),
  '1:true:-,5:false:posicion');
select test.eq('misma patente otra clave: sigue un solo coche en A',
  (select count(*) from public.vehiculos where cliente_id = 1 and patente_norm = 'TT9700'), 1::bigint);

-- 3. tipo_ruedas = 16 si llega alguna posición 11..16 (también con medición inválida en esa posición)
insert into _r select 'alta16', public.api_guardar_montaje(1, test.u_api(), 'TT9720',
  '[{"posicion":1,"mm1":9,"mm2":9,"mm3":9},{"posicion":12,"mm1":null,"mm2":null,"mm3":null,"rechazar":"rango"}]'::jsonb,
  gen_random_uuid(), 'k97-b', 'hb');
select test.eq('alta con 12 (inválida) -> tipo 16 y solo se crea la posición 1',
  (select v.tipo_ruedas || '/' || (select count(*) from public.neumaticos n where n.vehiculo_id = v.id)
     from public.vehiculos v where v.id = (select (r->>'vehiculo_id')::bigint from _r where k = 'alta16')), '16/1');
select test.eq('alta16: la posición inválida informa su motivo',
  (select string_agg((e->>'posicion') || ':' || (e->>'guardado') || ':' || coalesce(e->>'motivo', '-'), ',' order by (e->>'posicion')::int)
     from _r, jsonb_array_elements(r->'resultados') e where k = 'alta16'), '1:true:-,12:false:rango');

-- 4. Posiciones inválidas no crean su neumático (incompleta, 17..98, sin medir) pero sí el coche si hay una válida
insert into _r select 'mix', public.api_guardar_montaje(1, test.u_api(), 'TT9730',
  '[{"posicion":1,"mm1":9,"mm2":9,"mm3":9},{"posicion":2,"mm1":9,"mm2":null,"mm3":9},{"posicion":3,"mm1":null,"mm2":null,"mm3":null},
    {"posicion":50,"mm1":9,"mm2":9,"mm3":9},{"posicion":99,"mm1":null,"mm2":null,"mm3":null}]'::jsonb,
  gen_random_uuid(), 'k97-c', 'hc');
select test.eq('mix: motivos por posición',
  (select string_agg((e->>'posicion') || ':' || (e->>'guardado') || ':' || coalesce(e->>'motivo', '-'), ',' order by (e->>'posicion')::int)
     from _r, jsonb_array_elements(r->'resultados') e where k = 'mix'),
  '1:true:-,2:false:incompleta,3:false:sin_medicion,50:false:posicion,99:true:-');
select test.eq('mix: solo existe el neumático de la posición 1 (auxilio sin medir no se crea)',
  (select string_agg(posicion::text, ',') from public.neumaticos
    where vehiculo_id = (select (r->>'vehiculo_id')::bigint from _r where k = 'mix')), '1');
select test.eq('mix: tipo 10 (17..98 no deduce 16)',
  (select tipo_ruedas from public.vehiculos where id = (select (r->>'vehiculo_id')::bigint from _r where k = 'mix')), 10::smallint);

-- 5. Ninguna posición válida: no se crea el coche; respuesta igual a la de un coche ajeno/inexistente
select (select count(*) from public.vehiculos) || '/' || (select count(*) from public.neumaticos) as cuenta2 \gset
insert into _r select 'nada', public.api_guardar_montaje(1, test.u_api(), 'TT9740',
  '[{"posicion":1,"mm1":null,"mm2":9,"mm3":9},{"posicion":2,"mm1":9,"mm2":9,"mm3":9,"rechazar":"rango"},
    {"posicion":99,"mm1":null,"mm2":null,"mm3":null},{"posicion":60,"mm1":9,"mm2":9,"mm3":9}]'::jsonb,
  gen_random_uuid(), 'k97-d', 'hd');
select test.eq('ninguna válida: no_encontrado + vehiculo en todas',
  (select (r->>'estado') || '/' || (select string_agg(e->>'motivo', ',' order by (e->>'posicion')::int) from jsonb_array_elements(r->'resultados') e)
     from _r where k = 'nada'),
  'no_encontrado/vehiculo,vehiculo,vehiculo,vehiculo');
select test.eq('ninguna válida: no se creó vehículo ni neumáticos',
  (select count(*) from public.vehiculos) || '/' || (select count(*) from public.neumaticos), :'cuenta2');
select test.eq('ninguna válida: respuesta sin campos de alta', (select r ? 'creado' from _r where k = 'nada'), false);

-- 6. Aislamiento: la cuenta de B crea su propio coche con una patente de A sin tocar el de A
select test.eq('cliente 2 crea en su cliente una patente de A (unicidad por cliente)',
  public.api_guardar_montaje(2, gen_random_uuid(), 'TT9710', '[{"posicion":1,"mm1":9,"mm2":9,"mm3":9}]'::jsonb,
    gen_random_uuid(), 'k97-e', 'he')->>'creado', 'true');
select test.eq('cliente 2 no tocó el coche 92 de A', (select count(*) from public.mediciones where vehiculo_id = 92), 0::bigint);
select test.eq('el coche creado para 2 es de 2 y no de 1',
  (select string_agg(cliente_id::text, ',' order by cliente_id) from public.vehiculos where patente_norm = 'TT9710'), '1,2');
-- Coche existente de A con neumático: camino de siempre (no crea)
select test.eq('coche existente de A: posición 1 guardada, posición 4 inexistente -> posicion (sin alta)',
  (select string_agg((e->>'posicion') || ':' || (e->>'guardado') || ':' || coalesce(e->>'motivo', '-'), ',' order by (e->>'posicion')::int)
     from jsonb_array_elements(public.api_guardar_montaje(1, test.u_api(), 'TT9710',
       '[{"posicion":1,"mm1":5,"mm2":5,"mm3":5},{"posicion":4,"mm1":5,"mm2":5,"mm3":5}]'::jsonb, gen_random_uuid(), 'k97-f', 'hf')->'resultados') e),
  '1:true:-,4:false:posicion');

-- 7. Conflicto de idempotencia (misma clave, otro hash) no crea nada
select (select count(*) from public.vehiculos) as veh3 \gset
select test.eq('conflicto: no crea',
  public.api_guardar_montaje(1, test.u_api(), 'TT9750', '[{"posicion":1,"mm1":9,"mm2":9,"mm3":9}]'::jsonb,
    gen_random_uuid(), 'k97-a', 'otro')->>'estado', 'conflicto');
select test.eq('conflicto: sin vehículo nuevo', (select count(*) from public.vehiculos), :veh3::bigint);

-- 8. Privilegios: solo service_role ejecuta la RPC
select test.become('authenticated', test.u_api());
select test.denied('api (authenticated) no ejecuta la RPC',
  $$select public.api_guardar_montaje(1, gen_random_uuid(), 'TT9760', '[{"posicion":1,"mm1":9,"mm2":9,"mm3":9}]'::jsonb, gen_random_uuid(), 'k97-g', 'hg')$$);
select test.become('anon');
select test.denied('anon no ejecuta la RPC',
  $$select public.api_guardar_montaje(1, gen_random_uuid(), 'TT9760', '[{"posicion":1,"mm1":9,"mm2":9,"mm3":9}]'::jsonb, gen_random_uuid(), 'k97-g', 'hg')$$);
select test.become('service_role');
select test.eq('service_role la ejecuta y crea',
  public.api_guardar_montaje(1, test.u_api(), 'TT9760', '[{"posicion":1,"mm1":9,"mm2":9,"mm3":9}]'::jsonb,
    gen_random_uuid(), 'k97-g', 'hg')->>'creado', 'true');

rollback;
