-- API de proveedor: motivo 'sin_neumaticos' (migración 20261112000000).
--   coche sin neumáticos montados con idneumatico  -> sin_neumaticos (estado global ok)
--   coche con neumáticos y posición inexistente    -> posicion
--   coche inexistente / de otro cliente            -> vehiculo (misma respuesta)
-- En los tres casos no se escribe nada en mediciones. Replay idempotente igual.
begin;

insert into public.vehiculos (id, cliente_id, nombre, patente, activo) values
  (81, 1, 'T58 vacio',   'TT5800', true),   -- sin ninguna fila en neumaticos
  (82, 1, 'T58 sin id',  'TT5810', true),   -- neumático sin idneumatico
  (83, 1, 'T58 baja',    'TT5820', true),   -- solo neumático en baja
  (84, 1, 'T58 con',     'TT5830', true),   -- con un neumático montado
  (85, 2, 'T58 ajeno',   'TT5840', true);
insert into public.neumaticos (vehiculo_id, cliente_id, posicion, idneumatico, estado) values
  (82, 1, 1, null,     'montado'),
  (83, 1, 1, 'N-83-1', 'baja'),
  (84, 1, 1, 'N-84-1', 'montado'),
  (85, 2, 1, 'N-85-1', 'montado');

select count(*) as med0 from public.mediciones \gset
create temp table _r (k text, r jsonb);
grant all on _r to public;

-- 1. Sin ninguna fila en neumaticos
insert into _r select 'vacio', public.api_guardar_montaje(1, test.u_api(), 'TT5800',
  '[{"posicion":1,"mm1":9,"mm2":9,"mm3":9},{"posicion":2,"mm1":null,"mm2":null,"mm3":null}]'::jsonb,
  gen_random_uuid(), 'k58-a', 'ha');
select test.eq('sin neumaticos: estado global ok', (select r->>'estado' from _r where k = 'vacio'), 'ok');
select test.eq('sin neumaticos: cada posición guardado:false con motivo sin_neumaticos',
  (select string_agg((e->>'posicion') || ':' || (e->>'guardado') || ':' || (e->>'motivo'), ',' order by (e->>'posicion')::int)
     from _r, jsonb_array_elements(r->'resultados') e where k = 'vacio'),
  '1:false:sin_neumaticos,2:false:sin_neumaticos');
select test.eq('sin neumaticos: no se escribió en mediciones', (select count(*) from public.mediciones), :med0::bigint);

-- 2. Neumático sin idneumatico y 3. solo neumático en baja: tampoco hay montaje visible
select test.eq('neumático sin idneumatico: sin_neumaticos',
  public.api_guardar_montaje(1, gen_random_uuid(), 'TT5810', '[{"posicion":1,"mm1":9,"mm2":9,"mm3":9}]'::jsonb,
    gen_random_uuid(), 'k58-b', 'hb')->'resultados'->0->>'motivo', 'sin_neumaticos');
select test.eq('solo neumático en baja: sin_neumaticos',
  public.api_guardar_montaje(1, gen_random_uuid(), 'TT5820', '[{"posicion":1,"mm1":9,"mm2":9,"mm3":9}]'::jsonb,
    gen_random_uuid(), 'k58-c', 'hc')->'resultados'->0->>'motivo', 'sin_neumaticos');
-- Prevalece sobre un rechazo de validación del cliente
select test.eq('sin neumaticos prevalece sobre un rechazo previo (rango)',
  public.api_guardar_montaje(1, gen_random_uuid(), 'TT5800',
    '[{"posicion":1,"mm1":null,"mm2":null,"mm3":null,"rechazar":"rango"}]'::jsonb,
    gen_random_uuid(), 'k58-d', 'hd')->'resultados'->0->>'motivo', 'sin_neumaticos');

-- 4. Coche con neumáticos: posición inexistente -> posicion; la existente se guarda
insert into _r select 'con', public.api_guardar_montaje(1, gen_random_uuid(), 'TT5830',
  '[{"posicion":1,"mm1":8,"mm2":8,"mm3":8},{"posicion":7,"mm1":9,"mm2":9,"mm3":9}]'::jsonb,
  gen_random_uuid(), 'k58-e', 'he');
select test.eq('con neumáticos: P1 guardada y P7 inexistente -> posicion',
  (select string_agg((e->>'posicion') || ':' || (e->>'guardado') || ':' || coalesce(e->>'motivo', '-'), ',' order by (e->>'posicion')::int)
     from _r, jsonb_array_elements(r->'resultados') e where k = 'con'), '1:true:-,7:false:posicion');
select test.eq('con neumáticos: solo se insertó la medición de P1',
  (select count(*) from public.mediciones), :med0::bigint + 1);

-- 5. Otro cliente / inexistente: vehiculo, indistinguibles
insert into _r select 'ajeno', public.api_guardar_montaje(1, gen_random_uuid(), 'TT5840',
  '[{"posicion":1,"mm1":9,"mm2":9,"mm3":9}]'::jsonb, gen_random_uuid(), 'k58-f', 'hf');
insert into _r select 'nada', public.api_guardar_montaje(1, gen_random_uuid(), 'NOEXISTE9',
  '[{"posicion":1,"mm1":9,"mm2":9,"mm3":9}]'::jsonb, gen_random_uuid(), 'k58-g', 'hg');
select test.eq('vehículo de otro cliente: no_encontrado + vehiculo',
  (select r->>'estado' || '/' || (r->'resultados'->0->>'motivo') from _r where k = 'ajeno'), 'no_encontrado/vehiculo');
select test.eq('vehículo ajeno e inexistente: misma respuesta',
  (select (r - 'vehiculo_id') from _r where k = 'ajeno'), (select (r - 'vehiculo_id') from _r where k = 'nada'));
select test.eq('cliente 2 sobre su coche sin neumáticos ajenos: el coche 81 (cliente 1) es vehiculo',
  public.api_guardar_montaje(2, gen_random_uuid(), 'TT5800', '[{"posicion":1,"mm1":9,"mm2":9,"mm3":9}]'::jsonb,
    gen_random_uuid(), 'k58-h', 'hh')->'resultados'->0->>'motivo', 'vehiculo');

-- 6. Replay idempotente: misma clave y hash -> misma respuesta con replay:true, sin escribir
select count(*) as med1 from public.mediciones \gset
select test.eq('replay (sin_neumaticos): misma respuesta con replay:true',
  public.api_guardar_montaje(1, test.u_api(), 'TT5800',
    '[{"posicion":1,"mm1":9,"mm2":9,"mm3":9},{"posicion":2,"mm1":null,"mm2":null,"mm3":null}]'::jsonb,
    gen_random_uuid(), 'k58-a', 'ha'),
  (select (r - 'replay') || '{"replay":true}'::jsonb from _r where k = 'vacio'));
select test.eq('replay (sin_neumaticos): conserva el motivo',
  public.api_guardar_montaje(1, test.u_api(), 'TT5800',
    '[{"posicion":1,"mm1":9,"mm2":9,"mm3":9},{"posicion":2,"mm1":null,"mm2":null,"mm3":null}]'::jsonb,
    gen_random_uuid(), 'k58-a', 'ha')->'resultados'->0->>'motivo', 'sin_neumaticos');
select test.eq('replay con otro hash: conflicto',
  public.api_guardar_montaje(1, test.u_api(), 'TT5800', '[{"posicion":1,"mm1":1,"mm2":1,"mm3":1}]'::jsonb,
    gen_random_uuid(), 'k58-a', 'otro')->>'estado', 'conflicto');
select test.eq('replays: no escriben en mediciones', (select count(*) from public.mediciones), :med1::bigint);

-- 7. obtener_montaje conserva el contrato: encontrado:true y data []
select test.eq('obtener sin neumáticos: encontrado true',
  public.api_obtener_montaje(1, 'TT5800', null)->>'encontrado', 'true');
select test.eq('obtener sin neumáticos: data vacío',
  public.api_obtener_montaje(1, 'TT5800', null)->'data', '[]'::jsonb);
select test.eq('obtener sin neumáticos: sin campos nuevos',
  (select string_agg(k, ',' order by k) from jsonb_object_keys(public.api_obtener_montaje(1, 'TT5800', null)) k),
  'data,encontrado,matricula,numero,vehiculo_id');

rollback;
