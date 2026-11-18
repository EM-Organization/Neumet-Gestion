-- Distribución de neumáticos del vehículo (migración 20261122000000):
--   catálogo public.distribucion_ruedas y CHECK de vehiculos.distribucion
--   vehiculo_crear(p_distribucion): tipo_ruedas derivado, código inválido rechazado, llamadas anteriores intactas
--   api_obtener_montaje informa la distribución ('' si no está definida; sin cambios si no hay vehículo)
--   api_guardar_montaje(p_distribucion): alta con la distribución, adopción, conflicto, idempotencia y privilegios.
begin;

insert into public.vehiculos (id, cliente_id, nombre, patente, tipo_ruedas, distribucion, activo) values
  (981, 1, 'T98 sin distribución', 'TT9810', 10, null,  true),
  (982, 1, 'T98 con 6x2',          'TT9820', 10, '6x2', true),
  (983, 1, 'T98 tipo 16',          'TT9830', 16, null,  true),
  (984, 1, 'T98 sin dist (10)',    'TT9840', 10, null,  true);
insert into public.neumaticos (vehiculo_id, cliente_id, posicion, idneumatico, estado) values
  (981, 1, 1, 'N-981-1', 'montado'),
  (982, 1, 1, 'N-982-1', 'montado'),
  (983, 1, 1, 'N-983-1', 'montado'),
  (984, 1, 1, 'N-984-1', 'montado');

create temp table _r (k text, r jsonb);
grant all on _r to public;

-- 1. Catálogo -------------------------------------------------------------------------------------------------------
select test.eq('catálogo: ruedas de cada código',
  (select string_agg(c || ':' || coalesce(public.distribucion_ruedas(c)::text, '-'), ',' order by c)
     from unnest(array['4x2','6x2','6x4','8x2','8x4']) c),
  '4x2:6,6x2:8,6x4:10,8x2:10,8x4:12');
select test.eq('catálogo: lo ajeno al catálogo da null (otro código, mayúsculas, vacío, null)',
  (select count(*) from unnest(array['4x4','6X2','', ' 6x2', null]) c where public.distribucion_ruedas(c) is not null), 0::bigint);

-- 2. CHECK de la columna ----------------------------------------------------------------------------------------------
select test.denied('check: un código fuera del catálogo no se guarda',
  $$update public.vehiculos set distribucion = '9x9' where id = 981$$, '23514');
select test.denied('check: ni en minúsculas con otro formato',
  $$update public.vehiculos set distribucion = '6X2' where id = 981$$, '23514');
select test.eq('check: sigue sin distribución', (select distribucion is null from public.vehiculos where id = 981), true);

-- 3. vehiculo_crear ---------------------------------------------------------------------------------------------------
select test.eq('una sola firma de vehiculo_crear (la anterior se eliminó: sin ambigüedad)',
  (select count(*) from pg_proc where proname = 'vehiculo_crear' and pronamespace = 'public'::regnamespace), 1::bigint);
select test.become('authenticated', test.u_cli_a());
-- Cada alta se guarda primero (una función volátil en un WHERE se evaluaría por fila y repetiría el alta).
insert into _r select 'c6x2', public.vehiculo_crear('9801', null, 10::smallint, null, null, '6x2');
insert into _r select 'c8x4', public.vehiculo_crear('9802', null, 10::smallint, null, null, '8x4');
insert into _r select 'c4x2', public.vehiculo_crear('9803', p_distribucion => '4x2');
insert into _r select 'csin', public.vehiculo_crear('9804', null, 16::smallint);
insert into _r select 'cblanco', public.vehiculo_crear('9805', p_distribucion => '   ');
reset role;
select test.eq('crear con 6x2: distribución guardada y tipo 10',
  (select distribucion || '/' || tipo_ruedas from public.vehiculos where id = (select (r->>'id')::bigint from _r where k = 'c6x2')), '6x2/10');
select test.eq('crear con 8x4: tipo 16 derivado aunque se pase 10',
  (select distribucion || '/' || tipo_ruedas from public.vehiculos where id = (select (r->>'id')::bigint from _r where k = 'c8x4')), '8x4/16');
select test.eq('crear con 4x2 sin pasar el tipo: tipo 10',
  (select distribucion || '/' || tipo_ruedas from public.vehiculos where id = (select (r->>'id')::bigint from _r where k = 'c4x2')), '4x2/10');
select test.eq('crear sin distribución: como siempre (null, tipo pedido)',
  (select coalesce(distribucion, 'null') || '/' || tipo_ruedas from public.vehiculos where id = (select (r->>'id')::bigint from _r where k = 'csin')), 'null/16');
select test.eq('crear con distribución en blanco: sin distribución',
  (select coalesce(distribucion, 'null') from public.vehiculos where id = (select (r->>'id')::bigint from _r where k = 'cblanco')), 'null');
select test.become('authenticated', test.u_cli_a());
select test.denied('crear: distribución fuera del catálogo',
  $$select public.vehiculo_crear('9806', null, 10::smallint, null, null, '4x4')$$, '23514');
select test.denied('crear: sin distribución sigue validando el tipo',
  $$select public.vehiculo_crear('9807', null, 12::smallint)$$, '23514');
select test.denied('crear con distribución en otro cliente (p_cliente_id ajeno)',
  $$select public.vehiculo_crear('9808', null, 10::smallint, null, 2::bigint, '6x2')$$);
reset role;
select test.eq('no se creó nada tras los rechazos', (select count(*) from public.vehiculos where numero in ('9806','9807','9808')), 0::bigint);

-- 4. api_obtener_montaje ----------------------------------------------------------------------------------------------
select test.eq('obtener: con distribución',
  public.api_obtener_montaje(1, 'TT9820', null)->>'distribucion', '6x2');
select test.eq('obtener: sin distribución es texto vacío (no null)',
  public.api_obtener_montaje(1, 'TT9810', null)->>'distribucion', '');
select test.eq('obtener: vehículo inexistente, respuesta de siempre sin el campo',
  public.api_obtener_montaje(1, 'NOEXISTE98', null), '{"encontrado":false,"matricula":"","numero":"","data":[]}'::jsonb);
select test.eq('obtener: el vehículo de otro cliente no revela su distribución',
  public.api_obtener_montaje(2, 'TT9820', null)->>'encontrado', 'false');

-- 5. api_guardar_montaje: alta con distribución ------------------------------------------------------------------------
select test.eq('una sola firma de api_guardar_montaje',
  (select count(*) from pg_proc where proname = 'api_guardar_montaje' and pronamespace = 'public'::regnamespace), 1::bigint);

insert into _r select 'a6x2', public.api_guardar_montaje(1, test.u_api(), 'TT9800',
  '[{"posicion":1,"mm1":9,"mm2":9,"mm3":9},{"posicion":2,"mm1":9,"mm2":9,"mm3":9},{"posicion":8,"mm1":9,"mm2":9,"mm3":9},
    {"posicion":9,"mm1":9,"mm2":9,"mm3":9},{"posicion":99,"mm1":7,"mm2":7,"mm3":7}]'::jsonb,
  gen_random_uuid(), 'k98-a', 'h98a', '6x2');
select test.eq('alta 6x2: estado ok, creado, 4 neumáticos (la 9 no entra en 8 ruedas)',
  (select (r->>'estado') || '/' || (r->>'creado') || '/' || (r->>'neumaticos_creados') from _r where k = 'a6x2'), 'ok/true/4');
select test.eq('alta 6x2: resultado por posición',
  (select string_agg((e->>'posicion') || ':' || (e->>'guardado') || ':' || coalesce(e->>'motivo', '-'), ',' order by (e->>'posicion')::int)
     from _r, jsonb_array_elements(r->'resultados') e where k = 'a6x2'),
  '1:true:-,2:true:-,8:true:-,9:false:posicion,99:true:-');
select test.eq('alta 6x2: vehículo con distribución, tipo 10 y neumáticos 1,2,8,99',
  (select v.distribucion || '/' || v.tipo_ruedas || '/' || (select string_agg(n.posicion::text, ',' order by n.posicion) from public.neumaticos n where n.vehiculo_id = v.id)
     from public.vehiculos v where v.id = (select (r->>'vehiculo_id')::bigint from _r where k = 'a6x2')), '6x2/10/1,2,8,99');
select test.eq('alta 6x2: obtener_montaje ya informa la distribución',
  public.api_obtener_montaje(1, 'TT9800', null)->>'distribucion', '6x2');

insert into _r select 'a8x4', public.api_guardar_montaje(1, test.u_api(), 'TT9801',
  '[{"posicion":1,"mm1":9,"mm2":9,"mm3":9},{"posicion":12,"mm1":9,"mm2":9,"mm3":9},{"posicion":13,"mm1":9,"mm2":9,"mm3":9}]'::jsonb,
  gen_random_uuid(), 'k98-b', 'h98b', '8x4');
select test.eq('alta 8x4: tipo 16 derivado; la 13 no entra en 12 ruedas',
  (select v.distribucion || '/' || v.tipo_ruedas || '/' || (select string_agg(n.posicion::text, ',' order by n.posicion) from public.neumaticos n where n.vehiculo_id = v.id)
     from public.vehiculos v where v.id = (select (r->>'vehiculo_id')::bigint from _r where k = 'a8x4')), '8x4/16/1,12');

insert into _r select 'asin', public.api_guardar_montaje(1, test.u_api(), 'TT9802',
  '[{"posicion":1,"mm1":9,"mm2":9,"mm3":9},{"posicion":14,"mm1":9,"mm2":9,"mm3":9}]'::jsonb,
  gen_random_uuid(), 'k98-c', 'h98c');
select test.eq('alta sin distribución: igual que antes (tipo deducido 16, sin distribución, 1..16)',
  (select coalesce(v.distribucion, 'null') || '/' || v.tipo_ruedas || '/' || (select string_agg(n.posicion::text, ',' order by n.posicion) from public.neumaticos n where n.vehiculo_id = v.id)
     from public.vehiculos v where v.id = (select (r->>'vehiculo_id')::bigint from _r where k = 'asin')), 'null/16/1,14');

select test.denied('un código ajeno al catálogo en una llamada directa se rechaza',
  $$select public.api_guardar_montaje(1, gen_random_uuid(), 'TT9803', '[{"posicion":1,"mm1":9,"mm2":9,"mm3":9}]'::jsonb, gen_random_uuid(), 'k98-d', 'h98d', '4x4')$$, '22023');
select test.eq('un código inválido no creó el vehículo', (select count(*) from public.vehiculos where patente_norm = 'TT9803'), 0::bigint);

-- 6. Vehículo existente: adopta, conflicta o no cambia ------------------------------------------------------------------
select count(*) as med0 from public.mediciones where vehiculo_id = 982 \gset
insert into _r select 'adopta', public.api_guardar_montaje(1, test.u_api(), 'TT9810',
  '[{"posicion":1,"mm1":6,"mm2":6,"mm3":6}]'::jsonb, gen_random_uuid(), 'k98-e', 'h98e', '6x2');
select test.eq('existente sin distribución: la adopta y guarda la lectura',
  (select (r->'resultados'->0->>'guardado') from _r where k = 'adopta') || '/' || (select distribucion from public.vehiculos where id = 981), 'true/6x2');
insert into _r select 'adopta16', public.api_guardar_montaje(1, test.u_api(), 'TT9830',
  '[{"posicion":1,"mm1":6,"mm2":6,"mm3":6}]'::jsonb, gen_random_uuid(), 'k98-f', 'h98f', '8x4');
select test.eq('existente de tipo 16 adopta 8x4 (tipo derivado 16, coincide)',
  (select (r->'resultados'->0->>'guardado') from _r where k = 'adopta16') || '/' || (select distribucion from public.vehiculos where id = 983), 'true/8x4');
insert into _r select 'incompat', public.api_guardar_montaje(1, test.u_api(), 'TT9840',
  '[{"posicion":1,"mm1":6,"mm2":6,"mm3":6}]'::jsonb, gen_random_uuid(), 'k98-g', 'h98g', '8x4');
select test.eq('existente de tipo 10 con 8x4 (tipo 16): no se guarda, motivo distribucion',
  (select (r->'resultados'->0->>'guardado') || ':' || (r->'resultados'->0->>'motivo') from _r where k = 'incompat'), 'false:distribucion');
select test.eq('incompatible: no se adoptó y no se escribió la lectura',
  (select coalesce(distribucion, 'null') from public.vehiculos where id = 984) || '/' || (select count(*) from public.mediciones where vehiculo_id = 984), 'null/0');

insert into _r select 'otra', public.api_guardar_montaje(1, test.u_api(), 'TT9820',
  '[{"posicion":1,"mm1":6,"mm2":6,"mm3":6}]'::jsonb, gen_random_uuid(), 'k98-h', 'h98h', '6x4');
select test.eq('existente con 6x2 informando 6x4: no se guarda, motivo distribucion',
  (select (r->'resultados'->0->>'guardado') || ':' || (r->'resultados'->0->>'motivo') from _r where k = 'otra'), 'false:distribucion');
select test.eq('conflicto: sigue 6x2 y no se escribió ninguna lectura',
  (select distribucion from public.vehiculos where id = 982) || '/' || ((select count(*) from public.mediciones where vehiculo_id = 982) - :med0::bigint), '6x2/0');
select test.eq('conflicto: el estado de la respuesta es ok (la app recibe guardado:false por posición)',
  (select r->>'estado' from _r where k = 'otra'), 'ok');

select test.eq('existente con 6x2 informando 6x2: se guarda',
  (public.api_guardar_montaje(1, test.u_api(), 'TT9820', '[{"posicion":1,"mm1":5,"mm2":5,"mm3":5}]'::jsonb,
     gen_random_uuid(), 'k98-i', 'h98i', '6x2')->'resultados'->0->>'guardado'), 'true');
select test.eq('existente con 6x2 sin informar distribución: se guarda y no cambia',
  (public.api_guardar_montaje(1, test.u_api(), 'TT9820', '[{"posicion":1,"mm1":4,"mm2":4,"mm3":4}]'::jsonb,
     gen_random_uuid(), 'k98-j', 'h98j')->'resultados'->0->>'guardado')
  || '/' || (select distribucion from public.vehiculos where id = 982), 'true/6x2');

-- 7. Idempotencia: el replay repite la respuesta y no crea de nuevo ------------------------------------------------------
select (select count(*) from public.vehiculos) || '/' || (select count(*) from public.neumaticos) || '/' || (select count(*) from public.mediciones) as cuenta1 \gset
select test.eq('replay con distribución: misma respuesta, replay:true',
  public.api_guardar_montaje(1, test.u_api(), 'TT9800',
    '[{"posicion":1,"mm1":9,"mm2":9,"mm3":9},{"posicion":2,"mm1":9,"mm2":9,"mm3":9},{"posicion":8,"mm1":9,"mm2":9,"mm3":9},
      {"posicion":9,"mm1":9,"mm2":9,"mm3":9},{"posicion":99,"mm1":7,"mm2":7,"mm3":7}]'::jsonb,
    gen_random_uuid(), 'k98-a', 'h98a', '6x2'),
  (select (r - 'replay') || '{"replay":true}'::jsonb from _r where k = 'a6x2'));
select test.eq('replay: nada nuevo',
  (select count(*) from public.vehiculos) || '/' || (select count(*) from public.neumaticos) || '/' || (select count(*) from public.mediciones),
  :'cuenta1');

-- 8. Privilegios: solo service_role ejecuta la RPC ---------------------------------------------------------------------------
select test.become('authenticated', test.u_api());
select test.denied('api (authenticated) no ejecuta la RPC con distribución',
  $$select public.api_guardar_montaje(1, gen_random_uuid(), 'TT9890', '[{"posicion":1,"mm1":9,"mm2":9,"mm3":9}]'::jsonb, gen_random_uuid(), 'k98-k', 'h98k', '6x2')$$);
select test.become('anon');
select test.denied('anon no ejecuta la RPC con distribución',
  $$select public.api_guardar_montaje(1, gen_random_uuid(), 'TT9890', '[{"posicion":1,"mm1":9,"mm2":9,"mm3":9}]'::jsonb, gen_random_uuid(), 'k98-k', 'h98k', '6x2')$$);
select test.denied('anon no crea vehículos con distribución',
  $$select public.vehiculo_crear('9890', null, 10::smallint, null, null, '6x2')$$);
select test.become('service_role');
select test.eq('service_role la ejecuta y crea con distribución',
  (public.api_guardar_montaje(1, test.u_api(), 'TT9890', '[{"posicion":1,"mm1":9,"mm2":9,"mm3":9}]'::jsonb,
     gen_random_uuid(), 'k98-k', 'h98k', '6x2')->>'creado'), 'true');
reset role;

rollback;
