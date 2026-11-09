-- Calidad de datos de las mediciones (20261116000000_calidad_datos.sql):
--   A. función pura medicion_evaluar_calidad (cada regla, límites, NULL distinto de 0, conversión de 32avos);
--   B. trigger AFTER INSERT (aumento sin recauchutado y sus excepciones, duplicados, rango, huellas, odómetro, neumáticos
--      sin idneumatico, jamás rechaza la inserción, camino de la API) y audit_log;
--   C. una medición invalidada no cuenta en v_mediciones_neumatico / v_ultima_medicion / v_estado_neumaticos /
--      v_alertas / ultimas_mediciones / api_obtener_montaje (tres atribuciones), se conserva intacta y revalidar la
--      devuelve; las sospechosas siguen contando; sin mediciones válidas el estado es «sin datos», nunca crítico;
--   D. matriz de roles de medicion_invalidar / medicion_revalidar (admin, global, sucursal propia y ajena, otro
--      cliente, api, sin perfil, anon), motivo obligatorio, idempotencia y registro en audit_log;
--   E. valor original y unidad.
-- Todo en una transacción que se revierte.
begin;

insert into auth.users (id, email) values ('a0000000-0000-0000-0000-0000000000c8', 'sb88@t');
insert into public.sucursales (id, cliente_id, nombre) overriding system value values
  (881, 1, 'Norte88'), (882, 1, 'Sur88'), (883, 2, 'Ajena88');
insert into public.perfiles (user_id, rol, cliente_id, sucursal_id) values
  ('a0000000-0000-0000-0000-0000000000c8', 'cliente', 1, 881);
create or replace function test.u_s88() returns uuid language sql immutable as $$ select 'a0000000-0000-0000-0000-0000000000c8'::uuid $$;
grant execute on function test.u_s88() to public;

insert into public.vehiculos (id, cliente_id, nombre, patente, activo, tipo_ruedas, sucursal_id) values
  (881, 1, 'T88 reglas',   'TT8810', true, 10, 881),
  (882, 1, 'T88 ajena',    'TT8820', true, 10, 882),
  (883, 2, 'T88 otro',     'TT8830', true, 10, 883),
  (884, 1, 'T88 etiquet.', 'TT8840', true, 10, 881),
  (885, 1, 'T88 posicion', 'TT8850', true, 10, 881),
  (886, 1, 'T88 sin neum', 'TT8860', true, 10, 881),
  (887, 1, 'T88 inicio',   'TT8870', true, 10, 881);
insert into public.neumaticos (vehiculo_id, cliente_id, posicion, idneumatico, estado, marca)
  select 881, 1, p, 'T-881-' || p, 'montado', 'T' from generate_series(1, 9) p;
insert into public.neumaticos (vehiculo_id, cliente_id, posicion, idneumatico, estado, marca) values
  (882, 1, 1, 'T-882-1', 'montado', 'T'), (883, 2, 1, 'T-883-1', 'montado', 'T'),
  (884, 1, 1, 'T-884-1', 'montado', 'T'), (884, 1, 2, 'T-884-2', 'montado', 'T'),
  (885, 1, 1, 'T-885-1', 'montado', 'T'), (887, 1, 1, 'T-887-1', 'montado', 'T'),
  (884, 1, 3, 'T-884-3', 'montado', 'T'), (884, 1, 4, 'T-884-4', 'montado', 'T'), (884, 1, 5, 'T-884-5', 'montado', 'T');

-- med(vehículo, cliente, posición, idneumatico, días atrás, mm1, mm2, mm3, odómetro) -> id de la medición.
create function pg_temp.med(p_veh bigint, p_cli bigint, p_pos int, p_idn text, p_horas numeric,
                            p_a numeric, p_b numeric, p_c numeric, p_odo int default null) returns bigint language sql as $$
  insert into public.mediciones (vehiculo_id, cliente_id, posicion, idneumatico, mm1, mm2, mm3, odometro_km, created_at)
  values (p_veh, p_cli, p_pos, p_idn, p_a, p_b, p_c, p_odo, now() - p_horas * interval '1 hour')
  returning id
$$;
create function pg_temp.cal(p_id bigint) returns text language sql as $$
  select calidad from public.mediciones where id = p_id $$;
create function pg_temp.mot(p_id bigint) returns text language sql as $$
  select calidad_motivo from public.mediciones where id = p_id $$;
create function pg_temp.ev(p_veh bigint, p_pos int, p_tipo text, p_horas numeric) returns void language sql as $$
  insert into public.eventos_neumatico (cliente_id, vehiculo_id, neumatico_id, idneumatico, tipo, posicion_origen, posicion_destino, created_at)
  select n.cliente_id, n.vehiculo_id, n.id, n.idneumatico, p_tipo, p_pos, p_pos, now() - p_horas * interval '1 hour'
    from public.neumaticos n where n.vehiculo_id = p_veh and n.posicion = p_pos
$$;

-- ---------------------------------------------------------------------------------------------
-- A. Función pura
-- ---------------------------------------------------------------------------------------------
select test.eq('A: medición normal es válida y sin motivo',
  (select estado || '/' || coalesce(motivo, 'NULL') from public.medicion_evaluar_calidad(8, 8.5, 9)), 'valida/NULL');
select test.eq('A: cero mm es un valor medido, no «sin dato» (válida)',
  (select estado from public.medicion_evaluar_calidad(0, 0, 0)), 'valida');
select test.eq('A: un NULL parcial es incompleta, nunca cero',
  (select estado || '|' || motivo from public.medicion_evaluar_calidad(8, null, 9)),
  'sospechosa|Medición incompleta o con valores no numéricos');
select test.eq('A: todo NULL también es incompleta (no se evalúa como 0 mm)',
  (select motivo from public.medicion_evaluar_calidad(null, null, null)), 'Medición incompleta o con valores no numéricos');
select test.eq('A: NaN es no numérico',
  (select motivo from public.medicion_evaluar_calidad('NaN'::numeric, 5, 5)), 'Medición incompleta o con valores no numéricos');
select test.eq('A: un NULL no dispara además rango ni huellas',
  (select count(*) from public.medicion_evaluar_calidad(null, 40, 0) where motivo like '%rango%' or motivo like '%huellas%'), 0::bigint);
select test.eq('A: 30 mm es el límite físico (válida)', (select estado from public.medicion_evaluar_calidad(30, 30, 30)), 'valida');
select test.eq('A: 30,01 mm fuera de rango',
  (select motivo from public.medicion_evaluar_calidad(30.01, 30, 30)), 'Valor fuera del rango físico (0 a 30 mm)');
select test.eq('A: negativo fuera de rango', (select estado from public.medicion_evaluar_calidad(-0.1, 5, 5)), 'sospechosa');
select test.eq('A: diferencia de huellas 10 mm exactos es válida', (select estado from public.medicion_evaluar_calidad(15, 5, 10)), 'valida');
select test.eq('A: diferencia 10,1 mm es sospechosa',
  (select motivo from public.medicion_evaluar_calidad(15.1, 5, 10)), 'Diferencia entre huellas de 10,1 mm (máx. 10 mm)');
select test.eq('A: umbral de huellas configurable',
  (select estado from public.medicion_evaluar_calidad(15.1, 5, 10, p_huella_max_mm => 12)), 'valida');
select test.eq('A: aumento de exactamente 1,0 mm es válido (umbral estricto)',
  (select estado from public.medicion_evaluar_calidad(9, 9, 9, p_prev_promedio => 8)), 'valida');
select test.eq('A: aumento de 1,1 mm sin evento: «Aumento sin recauchutado»',
  (select motivo from public.medicion_evaluar_calidad(9.1, 9.1, 9.1, p_prev_promedio => 8)), 'Aumento sin recauchutado');
select test.eq('A: el mismo aumento con evento entre ambas es válido',
  (select estado from public.medicion_evaluar_calidad(9.1, 9.1, 9.1, p_prev_promedio => 8, p_evento_entre => true)), 'valida');
select test.eq('A: sin medición previa no hay aumento',
  (select estado from public.medicion_evaluar_calidad(20, 20, 20)), 'valida');
select test.eq('A: una baja de profundidad es normal',
  (select estado from public.medicion_evaluar_calidad(5, 5, 5, p_prev_promedio => 8)), 'valida');
select test.eq('A: duplicada', (select motivo from public.medicion_evaluar_calidad(8, 8, 8, p_duplicada => true)), 'Lectura duplicada');
select test.eq('A: odómetro menor',
  (select motivo from public.medicion_evaluar_calidad(8, 8, 8, p_odometro_km => 999, p_prev_odometro_km => 1000)),
  'Odómetro menor al de la medición anterior');
select test.eq('A: odómetro igual o mayor es válido',
  (select count(*) from public.medicion_evaluar_calidad(8, 8, 8, p_odometro_km => 1000, p_prev_odometro_km => 1000) where estado = 'valida'), 1::bigint);
select test.eq('A: sin odómetro previo o actual no se evalúa',
  (select estado from public.medicion_evaluar_calidad(8, 8, 8, p_odometro_km => 5)), 'valida');
select test.eq('A: varias reglas se acumulan en el motivo',
  (select motivo from public.medicion_evaluar_calidad(35, 5, 5, p_duplicada => true)),
  'Valor fuera del rango físico (0 a 30 mm); Diferencia entre huellas de 30 mm (máx. 10 mm); Lectura duplicada');
select test.eq('A: la función es pura (IMMUTABLE)', (select provolatile from pg_proc where proname = 'medicion_evaluar_calidad'), 'i');
select test.eq('A: 1/32" = 0,79375 mm', public.convertir_32avos_a_mm(1), 0.79375::numeric);
select test.eq('A: 32/32" = 25,4 mm', public.convertir_32avos_a_mm(32), 25.4::numeric);
select test.eq('A: 12/32" = 9,525 mm', public.convertir_32avos_a_mm(12), 9.525::numeric);
select test.eq('A: NULL en 32avos sigue NULL (no 0)', public.convertir_32avos_a_mm(null), null::numeric);

-- ---------------------------------------------------------------------------------------------
-- B. Trigger AFTER INSERT
-- ---------------------------------------------------------------------------------------------
select count(*) as aud0, (select coalesce(max(id), 0) from public.mediciones) as mx0 from public.audit_log where accion = 'CALIDAD_DETECTADA' \gset

-- B1. Serie normal: ninguna observación y sin autor de calidad
select pg_temp.med(881, 1, 1, 'T-881-1', 24 * 21, 12, 12, 12) as b1a \gset
select pg_temp.med(881, 1, 1, 'T-881-1', 24 * 14, 11.5, 11.5, 11.5) as b1b \gset
select pg_temp.med(881, 1, 1, 'T-881-1', 24 * 7, 11, 11.2, 10.8) as b1c \gset
select test.eq('B1: serie normal válida', (select string_agg(pg_temp.cal(i), ',') from unnest(array[:b1a, :b1b, :b1c]) i), 'valida,valida,valida');
select test.eq('B1: sin autor de calidad en las válidas', (select calidad_por from public.mediciones where id = :b1c), null::text);

-- B2. Aumento sin recauchutado (> 1,0 mm) y sus excepciones
select pg_temp.med(881, 1, 2, 'T-881-2', 24 * 10, 8, 8, 8) as b2a \gset
select pg_temp.med(881, 1, 2, 'T-881-2', 24 * 5, 9.5, 9.5, 9.5) as b2b \gset
select test.eq('B2: aumento de 1,5 mm sin evento es sospechosa', pg_temp.cal(:b2b), 'sospechosa');
select test.eq('B2: motivo «Aumento sin recauchutado»', pg_temp.mot(:b2b), 'Aumento sin recauchutado');
select test.eq('B2: calidad_por = sistema', (select calidad_por from public.mediciones where id = :b2b), 'sistema');
select test.eq('B2: la medición anterior queda válida', pg_temp.cal(:b2a), 'valida');
select test.eq('B2: los mm no se tocan (sin borrar ni corregir)', (select mm1 || '/' || promedio from public.mediciones where id = :b2b), '9.50/9.50');
-- con recauchutado entre ambas
select pg_temp.med(881, 1, 3, 'T-881-3', 24 * 10, 3, 3, 3) as b2c \gset
select pg_temp.ev(881, 3, 'reencauche', 24 * 7);
select pg_temp.med(881, 1, 3, 'T-881-3', 24 * 5, 14, 14, 14) as b2d \gset
select test.eq('B2: aumento con reencauche entre ambas es válido', pg_temp.cal(:b2d), 'valida');
-- con reparación y con montaje
select pg_temp.med(881, 1, 4, 'T-881-4', 24 * 10, 5, 5, 5) as b2e \gset
select pg_temp.ev(881, 4, 'reparacion', 24 * 7);
select pg_temp.med(881, 1, 4, 'T-881-4', 24 * 5, 7, 7, 7) as b2f \gset
select test.eq('B2: aumento con reparación entre ambas es válido', pg_temp.cal(:b2f), 'valida');
select pg_temp.med(881, 1, 5, 'T-881-5', 24 * 10, 5, 5, 5) as b2g \gset
select pg_temp.ev(881, 5, 'montaje', 24 * 7);
select pg_temp.med(881, 1, 5, 'T-881-5', 24 * 5, 12, 12, 12) as b2h \gset
select test.eq('B2: aumento con montaje entre ambas es válido', pg_temp.cal(:b2h), 'valida');
-- un evento ANTERIOR a la medición previa o una rotación no lo justifican
select pg_temp.ev(881, 6, 'reencauche', 24 * 20);
select pg_temp.med(881, 1, 6, 'T-881-6', 24 * 10, 5, 5, 5) as b2i \gset
select pg_temp.med(881, 1, 6, 'T-881-6', 24 * 5, 9, 9, 9) as b2j \gset
select test.eq('B2: un reencauche anterior a la medición previa no lo justifica', pg_temp.cal(:b2j), 'sospechosa');
select pg_temp.med(881, 1, 7, 'T-881-7', 24 * 10, 5, 5, 5) as b2k \gset
select pg_temp.ev(881, 7, 'rotacion', 24 * 7);
select pg_temp.med(881, 1, 7, 'T-881-7', 24 * 5, 9, 9, 9) as b2l \gset
select test.eq('B2: una rotación no justifica el aumento', pg_temp.cal(:b2l), 'sospechosa');
-- aumento de 1,0 exacto: válido
select pg_temp.med(881, 1, 8, 'T-881-8', 24 * 10, 5, 5, 5) as b2m \gset
select pg_temp.med(881, 1, 8, 'T-881-8', 24 * 5, 6, 6, 6) as b2n \gset
select test.eq('B2: aumento de 1,0 exacto es válido', pg_temp.cal(:b2n), 'valida');
-- la comparación es con la previa VÁLIDA: si la anterior estaba invalidada se compara con la anterior a esa
select pg_temp.med(881, 1, 9, 'T-881-9', 24 * 12, 8, 8, 8) as b2o \gset
select pg_temp.med(881, 1, 9, 'T-881-9', 24 * 8, 3, 3, 3) as b2p \gset
update public.mediciones set calidad = 'invalidada', calidad_motivo = 'prueba' where id = :b2p;
select pg_temp.med(881, 1, 9, 'T-881-9', 24 * 4, 8.5, 8.5, 8.5) as b2q \gset
select test.eq('B2: se compara con la previa válida (la invalidada se ignora)', pg_temp.cal(:b2q), 'valida');
-- orden de llegada: una medición vieja que llega tarde no compara con una posterior
select pg_temp.med(881, 1, 9, 'T-881-9', 24 * 14, 4, 4, 4) as b2r \gset
select test.eq('B2: una medición antigua que llega después se compara con lo anterior a ella, no con lo posterior', pg_temp.cal(:b2r), 'valida');

-- B3. Lectura duplicada (mismo neumático, mismos valores, ±2 minutos)
select pg_temp.med(884, 1, 3, 'T-884-3', 100, 7, 7.2, 7.4) as b3a \gset
select pg_temp.med(884, 1, 3, 'T-884-3', 100 - 1.0 / 60, 7, 7.2, 7.4) as b3b \gset
select pg_temp.med(884, 1, 3, 'T-884-3', 100 - 5.0 / 60, 7, 7.2, 7.4) as b3c \gset
select pg_temp.med(884, 1, 3, 'T-884-3', 100 - 6.0 / 60, 7, 7.2, 7.5) as b3d \gset
select test.eq('B3: la primera lectura es válida', pg_temp.cal(:b3a), 'valida');
select test.eq('B3: igual a +1 min: duplicada', pg_temp.cal(:b3b) || '/' || pg_temp.mot(:b3b), 'sospechosa/Lectura duplicada');
select test.eq('B3: igual a +5 min de la primera pero 4 de la segunda: válida (fuera de ±2 min)', pg_temp.cal(:b3c), 'valida');
select test.eq('B3: otro valor a +6 min: válida', pg_temp.cal(:b3d), 'valida');
-- otro neumático con los mismos valores en el mismo instante: no es duplicado
select pg_temp.med(884, 1, 4, 'T-884-4', 100, 7, 7.2, 7.4) as b3e \gset
select test.eq('B3: los mismos valores en OTRO neumático no son duplicado', pg_temp.cal(:b3e), 'valida');
-- sin idneumatico: duplicado por vehículo y posición
select pg_temp.med(886, 1, 4, null, 50, 6, 6, 6) as b3f \gset
select pg_temp.med(886, 1, 4, null, 50 - 1.0 / 60, 6, 6, 6) as b3g \gset
select test.eq('B3: sin idneumatico, la posterior igual es duplicada', pg_temp.cal(:b3f) || '/' || pg_temp.cal(:b3g), 'valida/sospechosa');
-- dos filas idénticas con la misma fecha en una sola sentencia: se marca una sola (la de id mayor)
insert into public.mediciones (vehiculo_id, cliente_id, posicion, idneumatico, mm1, mm2, mm3, created_at)
  select 881, 1, 1, 'T-881-1', 10.5, 10.5, 10.5, now() - interval '1 hour' from generate_series(1, 2);
select test.eq('B3: dos idénticas en la misma sentencia: una válida y una duplicada',
  (select string_agg(calidad, ',' order by id) from public.mediciones
    where idneumatico = 'T-881-1' and mm1 = 10.5 and created_at = now() - interval '1 hour'), 'valida,sospechosa');

-- B4. Rango físico y diferencia absurda entre huellas
select pg_temp.med(884, 1, 5, 'T-884-5', 1, 35, 35, 35) as b4a \gset
select test.eq('B4: 35 mm: rango físico', pg_temp.cal(:b4a) || '/' || pg_temp.mot(:b4a), 'sospechosa/Valor fuera del rango físico (0 a 30 mm)');
select pg_temp.med(884, 1, 2, 'T-884-2', 90, 30, 30, 30) as b4b \gset
select test.eq('B4: 30 mm exactos es válido', pg_temp.cal(:b4b), 'valida');
select pg_temp.med(884, 1, 2, 'T-884-2', 89, 14, 3, 14) as b4c \gset
select test.eq('B4: diferencia de 11 mm entre huellas es sospechosa', pg_temp.mot(:b4c), 'Diferencia entre huellas de 11 mm (máx. 10 mm)');
update public.clientes set huella_absurda_mm = 12 where id = 1;
select pg_temp.med(884, 1, 2, 'T-884-2', 88, 14, 3, 14) as b4d \gset
select test.eq('B4: el umbral por cliente es configurable (12 mm: 11 mm es válida)', pg_temp.cal(:b4d), 'valida');
update public.clientes set huella_absurda_mm = 10 where id = 1;
select test.denied('B4: el umbral del cliente debe ser positivo', $$update public.clientes set huella_absurda_mm = 0 where id = 1$$, '23514');

-- B5. Odómetro decreciente respecto al vehículo
select pg_temp.med(885, 1, 2, null, 40, 8, 8, 8, 50000) as b5a \gset
select pg_temp.med(885, 1, 3, null, 30, 8, 8, 8, 49000) as b5b \gset
select pg_temp.med(885, 1, 4, null, 20, 8, 8, 8, null) as b5c \gset
select pg_temp.med(885, 1, 5, null, 10, 8, 8, 8, 50500) as b5d \gset
select test.eq('B5: odómetro menor al anterior del vehículo: sospechosa',
  pg_temp.cal(:b5b) || '/' || pg_temp.mot(:b5b), 'sospechosa/Odómetro menor al de la medición anterior');
select test.eq('B5: sin odómetro: no se evalúa', pg_temp.cal(:b5c), 'valida');
select test.eq('B5: odómetro creciente: válida', pg_temp.cal(:b5d), 'valida');

-- B6. Sin idneumatico: aumento por vehículo y posición, con evento de la posición
select pg_temp.med(886, 1, 1, null, 24 * 10, 6, 6, 6) as b6a \gset
select pg_temp.med(886, 1, 1, null, 24 * 5, 8, 8, 8) as b6b \gset
select test.eq('B6: sin idneumatico, aumento sin evento: sospechosa', pg_temp.cal(:b6b), 'sospechosa');
insert into public.eventos_neumatico (cliente_id, vehiculo_id, tipo, posicion_origen, posicion_destino, created_at)
  values (1, 886, 'montaje', 2, 2, now() - interval '7 days');
select pg_temp.med(886, 1, 2, null, 24 * 10, 6, 6, 6) as b6c \gset
select pg_temp.med(886, 1, 2, null, 24 * 5, 9, 9, 9) as b6d \gset
select test.eq('B6: sin idneumatico, montaje de la posición entre ambas: válida', pg_temp.cal(:b6d), 'valida');

-- B7. Registro en audit_log (solo de los hallazgos del sistema)
select test.eq('B7: cada hallazgo deja un registro de auditoría',
  (select count(*) from public.audit_log where accion = 'CALIDAD_DETECTADA') - :aud0,
  (select count(*) from public.mediciones where id > :mx0 and calidad = 'sospechosa' and calidad_por = 'sistema'));
select test.eq('B7: el registro lleva sistema, entidad, motivo y estado',
  (select actor_rol || '|' || entidad || '|' || (despues ->> 'calidad') || '|' || (despues ->> 'motivo')
     from public.audit_log where accion = 'CALIDAD_DETECTADA' and entidad_id = :b2b::text),
  'sistema|mediciones|sospechosa|Aumento sin recauchutado');

-- B8. Jamás rechaza la inserción: aunque la evaluación falle, la medición se guarda
savepoint s_falla;
create or replace function public.medicion_evaluar_calidad(
  p_mm1 numeric, p_mm2 numeric, p_mm3 numeric, p_prev_promedio numeric default null, p_evento_entre boolean default false,
  p_duplicada boolean default false, p_odometro_km integer default null, p_prev_odometro_km integer default null,
  p_huella_max_mm numeric default 10, p_aumento_max_mm numeric default 1.0, p_mm_max numeric default 30)
returns table (estado text, motivo text) language plpgsql as $$ begin raise exception 'falla simulada'; end $$;
select pg_temp.med(881, 1, 1, 'T-881-1', 0.5, 9, 9, 9) as b8a \gset
select test.eq('B8: con el control roto la medición se inserta igual y queda válida', pg_temp.cal(:b8a), 'valida');
rollback to s_falla;
-- ...y el trigger no admite que una restricción de la tabla se evada: lo que la tabla rechaza sigue rechazándose
select test.denied('B8: la restricción de la tabla (0..40) sigue vigente',
  $$insert into public.mediciones (vehiculo_id, cliente_id, posicion, mm1, mm2, mm3) values (881, 1, 1, 41, 5, 5)$$, '23514');
select test.denied('B8: mm NULL sigue rechazado por la tabla (no se convierte en 0)',
  $$insert into public.mediciones (vehiculo_id, cliente_id, posicion, mm1, mm2, mm3) values (881, 1, 1, null, 5, 5)$$, '23502');

-- B9. Camino de la API: acepta todo lo que acepta hoy y marca lo sospechoso
select public.api_guardar_montaje(1, test.u_api(), 'TT8810',
  '[{"posicion":1,"mm1":35,"mm2":35,"mm3":35},{"posicion":2,"mm1":8,"mm2":null,"mm3":8}]'::jsonb,
  gen_random_uuid(), 'k:t88-1', 'h1') as r_api \gset
select test.eq('B9: la API guarda la lectura de 35 mm (contrato sin cambios)', (:'r_api'::jsonb #>> '{resultados,0,guardado}'), 'true');
select test.eq('B9: la lectura incompleta sigue rechazándose por posición, no por calidad',
  (:'r_api'::jsonb #>> '{resultados,1,motivo}'), 'incompleta');
select test.eq('B9: la medición de la API quedó sospechosa por rango',
  (select calidad from public.mediciones where device_id = 'api:' || test.u_api()::text and mm1 = 35), 'sospechosa');

-- ---------------------------------------------------------------------------------------------
-- C. Las invalidadas no cuentan; las sospechosas sí
-- ---------------------------------------------------------------------------------------------
-- C1. Atribución por idneumatico (884 pos 1): 12, 11, 10, 9 semanales y una lectura errónea de 3,0 el último día
select pg_temp.med(884, 1, 1, 'T-884-1', 24 * 28, 12, 12, 12) as c1a \gset
select pg_temp.med(884, 1, 1, 'T-884-1', 24 * 21, 11, 11, 11) as c1b \gset
select pg_temp.med(884, 1, 1, 'T-884-1', 24 * 14, 10, 10, 10) as c1c \gset
select pg_temp.med(884, 1, 1, 'T-884-1', 24 * 7,  9, 9, 9) as c1d \gset
select pg_temp.med(884, 1, 1, 'T-884-1', 24 * 1,  3, 3, 3) as c1e \gset
select test.eq('C1: antes de invalidar, la lectura errónea manda: crítico',
  (select estado from public.v_estado_neumaticos where vehiculo_id = 884 and posicion = 1), 'critico');
select test.eq('C1: ...y hay alerta crítica',
  (select count(*) from public.v_alertas where vehiculo_id = 884 and posicion = 1 and tipo = 'critico'), 1::bigint);
select test.eq('C1: una sospechosa sigue contando (la lectura de 35 mm de la API está en la vista)',
  (select count(*) from public.v_mediciones_neumatico where medicion_id = (select id from public.mediciones where mm1 = 35 and vehiculo_id = 881)), 1::bigint);

select pg_temp.med(887, 1, 1, 'T-887-1', 24 * 14, 10, 10, 10) as c1f \gset
select pg_temp.med(887, 1, 1, 'T-887-1', 24 * 7, 9, 9, 9) as c1g \gset
select pg_temp.med(887, 1, 1, 'T-887-1', 24 * 1, 3, 3, 3) as c1h \gset
select test.eq('C1: ultimas_mediciones antes de invalidar muestra la errónea (3 mm) y la previa (9 mm)',
  (select mm_ahora || '|' || mm_antes from public.ultimas_mediciones(50, null) where vehiculo_id = 887 and posicion = 1), '3.00|9.00');
select test.become('authenticated', test.u_cli_a());
select public.medicion_invalidar(:c1e, 'Lectura errónea del medidor') as inv1 \gset
select public.medicion_invalidar(:c1h, 'Lectura errónea del medidor') as inv2 \gset
reset role;
select test.eq('C1: invalidar responde cambiado', (:'inv1'::jsonb ->> 'cambiado'), 'true');
select test.eq('C1: ya no figura en v_mediciones_neumatico',
  (select count(*) from public.v_mediciones_neumatico where medicion_id = :c1e), 0::bigint);
select test.eq('C1: v_ultima_medicion toma la anterior (9 mm)',
  (select promedio from public.v_ultima_medicion where vehiculo_id = 884 and posicion = 1), 9.00::numeric);
select test.eq('C1: estado ok (9 mm) y última medición de hace 7 días',
  (select estado || '|' || promedio || '|' || dias_desde_medicion from public.v_estado_neumaticos where vehiculo_id = 884 and posicion = 1), 'ok|9.00|7');
select test.eq('C1: la tasa se calcula sin la lectura invalidada (1,000 mm/semana)',
  (select tasa_mm_semana from public.v_estado_neumaticos where vehiculo_id = 884 and posicion = 1), 1.000::numeric);
select test.eq('C1: 4 mediciones en la ventana (no 5)',
  (select n_mediciones_90d from public.v_estado_neumaticos where vehiculo_id = 884 and posicion = 1), 4::bigint);
select test.eq('C1: sin alerta crítica (la invalidación la resolvió como recuperada); queda el indicador de cruce próximo (4 semanas al crítico)',
  (select count(*) from public.v_alertas where vehiculo_id = 884 and posicion = 1)
  || '|' || (select resuelta_motivo from public.alertas where vehiculo_id = 884 and posicion = 1)
  || '|' || (select semanas_hasta_critico from public.v_estado_neumaticos where vehiculo_id = 884 and posicion = 1), '0|recuperada|4.00');
select test.eq('C1: la fila se conserva con sus mm y la marca',
  (select mm1 || '|' || calidad || '|' || calidad_motivo from public.mediciones where id = :c1e), '3.00|invalidada|Lectura errónea del medidor');
select test.eq('C1: calidad_por es el usuario',
  (select calidad_por from public.mediciones where id = :c1e), test.u_cli_a()::text);
select test.eq('C1: ultimas_mediciones usa la última válida (9 mm) y la previa a esa visita (10 mm)',
  (select mm_ahora || '|' || mm_antes from public.ultimas_mediciones(50, null) where vehiculo_id = 887 and posicion = 1), '9.00|10.00');
select test.eq('C1: api_obtener_montaje devuelve la última válida',
  (public.api_obtener_montaje(1, 'TT8870', '') #>> '{data,0,mm1}')::numeric, 9.00::numeric);

-- revalidar la devuelve al cálculo
select test.become('authenticated', test.u_cli_a());
select public.medicion_revalidar(:c1e) as rev1 \gset
reset role;
select test.eq('C1: revalidar responde cambiado', (:'rev1'::jsonb ->> 'cambiado'), 'true');
select test.eq('C1: tras revalidar vuelve a contar (crítico)',
  (select estado from public.v_estado_neumaticos where vehiculo_id = 884 and posicion = 1), 'critico');
select test.eq('C1: tras revalidar vuelve la alerta crítica (misma fila reabierta)',
  (select count(*) || '|' || max(veces_reabierta) from public.v_alertas where vehiculo_id = 884 and posicion = 1 and tipo = 'critico'), '1|1');
select test.eq('C1: revalidada: válida, sin motivo, con autor',
  (select calidad || '|' || coalesce(calidad_motivo, 'NULL') || '|' || (calidad_por = test.u_cli_a()::text)::text from public.mediciones where id = :c1e), 'valida|NULL|true');

-- una sospechosa NO se excluye: sigue contando hasta que alguien decida
update public.mediciones set calidad = 'sospechosa', calidad_motivo = 'prueba' where id = :c1e;
select test.eq('C1: sospechosa sigue contando (crítico)',
  (select estado from public.v_estado_neumaticos where vehiculo_id = 884 and posicion = 1), 'critico');
update public.mediciones set calidad = 'invalidada' where id = :c1e;

-- C2. Todas las mediciones del neumático invalidadas: «sin datos», no crítico y sin heredar las de la posición
select pg_temp.med(884, 1, 2, 'T-884-2', 24 * 3, 9, 9, 9) as c2a \gset
select pg_temp.med(884, 1, 2, null, 24 * 4, 2, 2, 2) as c2b \gset
-- (T-884-2 tiene además lecturas de B3/B4 de hace ~90 días: se invalidan todas)
update public.mediciones set calidad = 'invalidada', calidad_motivo = 'prueba' where idneumatico = 'T-884-2';
select test.eq('C2: sin mediciones válidas: estado sin_datos (no crítico)',
  (select estado from public.v_estado_neumaticos where vehiculo_id = 884 and posicion = 2), 'sin_datos');
select test.eq('C2: promedio NULL (no 0) y sin tasa',
  (select coalesce(promedio::text, 'NULL') || '|' || coalesce(tasa_mm_semana::text, 'NULL') from public.v_estado_neumaticos where vehiculo_id = 884 and posicion = 2), 'NULL|NULL');
select test.eq('C2: no hereda la medición sin idneumatico de la posición',
  (select count(*) from public.v_mediciones_neumatico where vehiculo_id = 884 and posicion_actual = 2), 0::bigint);
select test.eq('C2: sin alerta crítica por falta de dato',
  (select count(*) from public.v_alertas where vehiculo_id = 884 and posicion = 2), 0::bigint);
select test.eq('C2: la falta de dato se informa como «sin medir»',
  (select count(*) from public.v_estado_neumaticos where vehiculo_id = 884 and posicion = 2 and sin_medir), 1::bigint);

-- C3. Atribución por posición (neumático sin lecturas etiquetadas, regla 2): 885 pos 1
select pg_temp.med(885, 1, 1, null, 24 * 20, 10, 10, 10) as c3a \gset
select pg_temp.med(885, 1, 1, null, 24 * 10, 9, 9, 9) as c3b \gset
select pg_temp.med(885, 1, 1, null, 24 * 1, 2, 2, 2) as c3c \gset
select test.eq('C3: regla 2, antes: crítico', (select estado from public.v_estado_neumaticos where vehiculo_id = 885 and posicion = 1), 'critico');
update public.mediciones set calidad = 'invalidada', calidad_motivo = 'prueba' where id = :c3c;
select test.eq('C3: regla 2, invalidada: 9 mm, ok',
  (select estado || '|' || promedio from public.v_estado_neumaticos where vehiculo_id = 885 and posicion = 1), 'ok|9.00');
select test.eq('C3: regla 2, la vista de mediciones no la lista',
  (select count(*) from public.v_mediciones_neumatico where medicion_id = :c3c), 0::bigint);
select test.eq('C3: regla 2, v_ultima_medicion',
  (select promedio from public.v_ultima_medicion where vehiculo_id = 885 and posicion = 1), 9.00::numeric);

-- C4. Posición medida sin fila en neumaticos (regla 3): 886 pos 3
select pg_temp.med(886, 1, 3, null, 24 * 10, 10, 10, 10) as c4a \gset
select pg_temp.med(886, 1, 3, null, 24 * 1, 2, 2, 2) as c4b \gset
select test.eq('C4: regla 3, antes: crítico', (select estado from public.v_estado_neumaticos where vehiculo_id = 886 and posicion = 3), 'critico');
update public.mediciones set calidad = 'invalidada', calidad_motivo = 'prueba' where id = :c4b;
select test.eq('C4: regla 3, invalidada: 10 mm, ok',
  (select estado || '|' || promedio from public.v_estado_neumaticos where vehiculo_id = 886 and posicion = 3), 'ok|10.00');
select test.eq('C4: regla 3, la vista de mediciones no la lista',
  (select count(*) from public.v_mediciones_neumatico where medicion_id = :c4b), 0::bigint);
update public.mediciones set calidad = 'invalidada', calidad_motivo = 'prueba' where id = :c4a;
select test.eq('C4: regla 3, todas invalidadas: la posición desaparece (no hay dato, tampoco crítico)',
  (select count(*) from public.v_estado_neumaticos where vehiculo_id = 886 and posicion = 3), 0::bigint);

-- C5. Las vistas conservan columnas y tipos (los tests existentes lo cubren; aquí, la lista)
select test.eq('C5: v_estado_neumaticos conserva sus 30 columnas',
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'v_estado_neumaticos'), 30::bigint);
select test.eq('C5: v_mediciones_neumatico conserva sus 16 columnas',
  (select count(*) from information_schema.columns where table_schema = 'public' and table_name = 'v_mediciones_neumatico'), 16::bigint);

-- ---------------------------------------------------------------------------------------------
-- D. Matriz de roles de medicion_invalidar y medicion_revalidar
-- ---------------------------------------------------------------------------------------------
select pg_temp.med(881, 1, 1, 'T-881-1', 6, 9, 9, 9) as dm_a \gset
select pg_temp.med(882, 1, 1, 'T-882-1', 6, 9, 9, 9) as dm_aj \gset
select pg_temp.med(883, 2, 1, 'T-883-1', 6, 9, 9, 9) as dm_b \gset
select pg_temp.med(null, 1, 1, null, 6, 9, 9, 9) as dm_nov \gset
insert into public.mediciones (posicion, mm1, mm2, mm3, device_id) values (1, 9, 9, 9, 'AA:BB:CC:88:88:88');
select id as dm_dev from public.mediciones where device_id = 'AA:BB:CC:88:88:88' \gset
select count(*) as aud_d0 from public.audit_log where entidad = 'mediciones' and accion in ('INVALIDAR_MEDICION', 'REVALIDAR_MEDICION') \gset

select test.become('anon', null);
select test.denied('D: anon no invalida', format('select public.medicion_invalidar(%s::bigint, ''motivo'')', :dm_a));
select test.denied('D: anon no revalida', format('select public.medicion_revalidar(%s::bigint)', :dm_a));
reset role;
select test.become('authenticated', test.u_admin());
select test.denied('D: el helper de autorización no es invocable', format('select public.medicion_autorizar(%s::bigint)', :dm_a));
select test.denied('D: el trigger de calidad no es invocable', $$select public.mediciones_registrar_calidad()$$);
reset role;

create temp table _roles (rol text, uid uuid, med bigint);
insert into _roles values
  ('api', test.u_api(), :dm_a), ('sin perfil', test.u_sinperfil(), :dm_a),
  ('otro cliente (global B)', test.u_cli_b(), :dm_a),
  ('global B sobre medición de A', test.u_cli_b(), :dm_nov),
  ('sucursal propia en vehículo de otra sucursal', test.u_s88(), :dm_aj),
  ('sucursal propia en vehículo de otro cliente', test.u_s88(), :dm_b),
  ('sucursal propia en medición sin vehículo', test.u_s88(), :dm_nov),
  ('global A en medición de otro cliente', test.u_cli_a(), :dm_b),
  ('global A en medición device-first sin cliente', test.u_cli_a(), :dm_dev),
  ('sucursal en medición device-first sin cliente', test.u_s88(), :dm_dev),
  ('global A en medición inexistente', test.u_cli_a(), 99999999);
grant select on _roles to public;
do $t$
declare r record;
begin
  for r in select * from pg_temp._roles loop
    perform test.become('authenticated', r.uid);
    perform test.denied(r.rol || ': no invalida', format('select public.medicion_invalidar(%s::bigint, ''motivo valido'')', r.med));
    perform test.denied(r.rol || ': no revalida', format('select public.medicion_revalidar(%s::bigint)', r.med));
    reset role;
  end loop;
end
$t$;
select test.eq('D: los rechazos no cambiaron nada',
  (select count(*) from public.mediciones where id in (:dm_a, :dm_aj, :dm_b, :dm_nov, :dm_dev) and calidad <> 'valida'), 0::bigint);
select test.eq('D: ni dejaron auditoría',
  (select count(*) from public.audit_log where entidad = 'mediciones' and accion in ('INVALIDAR_MEDICION', 'REVALIDAR_MEDICION')), :aud_d0::bigint);
select test.become('authenticated', test.u_admin());
select test.denied('D: admin, medición inexistente', $$select public.medicion_invalidar(99999999::bigint, 'motivo valido')$$, 'P0002');
reset role;
select test.become('authenticated', test.u_cli_a());
select test.eq('D: global A no ve la medición de B (RLS)', (select count(*) from public.mediciones where id = :dm_b), 0::bigint);
select test.denied('D: no puede escribir calidad directamente (sin UPDATE)', format('update public.mediciones set calidad = ''invalidada'' where id = %s', :dm_a), '42501');
-- Permitidos
select test.denied('D: global: motivo vacío', format('select public.medicion_invalidar(%s::bigint, '' '')', :dm_a), '22023');
select test.denied('D: global: motivo NULL', format('select public.medicion_invalidar(%s::bigint, null)', :dm_a), '22023');
select test.denied('D: global: motivo demasiado corto', format('select public.medicion_invalidar(%s::bigint, ''ab'')', :dm_a), '22023');
select test.denied('D: global: motivo de más de 300', format('select public.medicion_invalidar(%s::bigint, %L)', :dm_a, repeat('x', 301)), '22023');
select test.denied('D: global: id nulo', $$select public.medicion_invalidar(null, 'motivo valido')$$, '22004');
select public.medicion_invalidar(:dm_a, '  Medidor descalibrado  ') as d1 \gset
select public.medicion_invalidar(:dm_a, 'otro motivo') as d1b \gset
select public.medicion_invalidar(:dm_aj, 'Global invalida en otra sucursal') as d1c \gset
select public.medicion_invalidar(:dm_nov, 'Global invalida sin vehículo') as d1d \gset
reset role;
select test.eq('D: global invalida', (:'d1'::jsonb ->> 'calidad') || '/' || (:'d1'::jsonb ->> 'cambiado'), 'invalidada/true');
select test.eq('D: invalidar de nuevo es idempotente (cambiado=false)', (:'d1b'::jsonb ->> 'cambiado'), 'false');
select test.eq('D: la segunda invalidación no pisa el motivo (se recorta el primero)', pg_temp.mot(:dm_a), 'Medidor descalibrado');
select test.eq('D: global A invalida en cualquier sucursal y sin vehículo', pg_temp.cal(:dm_aj) || '/' || pg_temp.cal(:dm_nov), 'invalidada/invalidada');
select test.eq('D: auditoría: una fila por cambio real (3, la repetida no cuenta)',
  (select count(*) from public.audit_log where accion = 'INVALIDAR_MEDICION' and entidad_id in (:dm_a::text, :dm_aj::text, :dm_nov::text)), 3::bigint);
select test.eq('D: auditoría: actor, rol, antes y después',
  (select actor_id::text || '|' || actor_rol || '|' || (antes ->> 'calidad') || '|' || (despues ->> 'calidad') || '|' || (despues ->> 'motivo')
     from public.audit_log where accion = 'INVALIDAR_MEDICION' and entidad_id = :dm_a::text),
  test.u_cli_a()::text || '|cliente|valida|invalidada|Medidor descalibrado');
-- Sucursal propia
select pg_temp.med(881, 1, 2, 'T-881-2', 5, 9, 9, 9) as dm_s \gset
select test.become('authenticated', test.u_s88());
select test.eq('D: sucursal propia ve su medición', (select count(*) from public.mediciones where id = :dm_s), 1::bigint);
select public.medicion_invalidar(:dm_s, 'Sucursal invalida lo suyo') as d2 \gset
select public.medicion_revalidar(:dm_s) as d3 \gset
select public.medicion_invalidar(:dm_s, 'Segunda vez') as d3b \gset
reset role;
select test.eq('D: sucursal propia invalida', (:'d2'::jsonb ->> 'cambiado'), 'true');
select test.eq('D: sucursal propia revalida', (:'d3'::jsonb ->> 'cambiado'), 'true');
select test.eq('D: la revalidación quita el motivo y deja autor y fecha',
  (select calidad || '|' || coalesce(calidad_motivo, 'NULL') || '|' || (calidad_por = test.u_s88()::text)::text || '|' || (calidad_at is not null)::text
     from public.mediciones where id = :dm_s), 'invalidada|Segunda vez|true|true');
select test.become('authenticated', test.u_s88());
select public.medicion_revalidar(:dm_s) as d3c \gset
select public.medicion_revalidar(:dm_s) as d3d \gset
reset role;
select test.eq('D: revalidar una ya válida es idempotente', (:'d3d'::jsonb ->> 'cambiado'), 'false');
select test.eq('D: auditoría de revalidación: rol cliente, antes invalidada y después válida',
  (select actor_rol || '|' || (antes ->> 'calidad') || '|' || (despues ->> 'calidad') from public.audit_log
    where accion = 'REVALIDAR_MEDICION' and entidad_id = :dm_s::text order by id desc limit 1), 'cliente|invalidada|valida');
-- Admin: cualquier cliente; revalidar una sospechosa del sistema
select test.become('authenticated', test.u_admin());
select public.medicion_invalidar(:dm_b, 'Admin invalida de otro cliente') as d4 \gset
select public.medicion_invalidar(:dm_dev, 'Admin invalida device-first') as d4b \gset
select public.medicion_revalidar(:b2b) as d5 \gset
reset role;
select test.eq('D: admin invalida de cualquier cliente y device-first', pg_temp.cal(:dm_b) || '/' || pg_temp.cal(:dm_dev), 'invalidada/invalidada');
select test.eq('D: admin revalida una sospechosa del sistema', pg_temp.cal(:b2b), 'valida');
select test.eq('D: auditoría del admin: rol admin',
  (select actor_rol from public.audit_log where accion = 'REVALIDAR_MEDICION' and entidad_id = :b2b::text), 'admin');
select test.eq('D: la revalidación conserva el hallazgo original en auditoría',
  (select antes ->> 'motivo' from public.audit_log where accion = 'REVALIDAR_MEDICION' and entidad_id = :b2b::text), 'Aumento sin recauchutado');
-- La cuenta del perfil del cliente eliminado no puede actuar
update public.clientes set deleted_at = now() where id = 2;
select test.become('authenticated', test.u_cli_b());
select test.denied('D: cliente dado de baja: no invalida', format('select public.medicion_invalidar(%s::bigint, ''motivo valido'')', :dm_b));
reset role;
update public.clientes set deleted_at = null where id = 2;

-- Aislamiento de lectura de la columna: B no ve las observaciones de A
select test.become('authenticated', test.u_cli_b());
select test.eq('D: B no ve mediciones con observaciones de A',
  (select count(*) from public.mediciones where cliente_id = 1), 0::bigint);
reset role;
select test.eq('D: authenticated no tiene UPDATE sobre mediciones (solo las RPC cambian la calidad)',
  (select has_table_privilege('authenticated', 'public.mediciones', 'update')), false);

-- ---------------------------------------------------------------------------------------------
-- E. Valor original y unidad
-- ---------------------------------------------------------------------------------------------
select test.eq('E: por defecto la unidad de origen es mm y sin valor original',
  (select unidad_origen || '|' || coalesce(valor_original::text, 'NULL') from public.mediciones where id = :b1a), 'mm|NULL');
insert into public.mediciones (vehiculo_id, cliente_id, posicion, idneumatico, mm1, mm2, mm3, unidad_origen, valor_original, created_at)
  values (881, 1, 1, 'T-881-1', round(public.convertir_32avos_a_mm(12), 2), round(public.convertir_32avos_a_mm(11), 2),
          round(public.convertir_32avos_a_mm(12), 2), '32avos', '{"mm1":12,"mm2":11,"mm3":12,"unidad":"32avos"}', now() - interval '30 minutes');
select test.eq('E: se conserva el valor crudo y la unidad; mm normalizados (12/32" = 9,53 mm)',
  (select unidad_origen || '|' || (valor_original ->> 'mm1') || '|' || mm1 || '|' || mm2 from public.mediciones where unidad_origen = '32avos'), '32avos|12|9.53|8.73');
select test.denied('E: unidad de origen desconocida', $$insert into public.mediciones (posicion, mm1, mm2, mm3, unidad_origen) values (1, 5, 5, 5, 'pulgadas')$$, '23514');
select test.denied('E: calidad desconocida', $$update public.mediciones set calidad = 'rara' where id = (select min(id) from public.mediciones)$$, '23514');
select test.denied('E: sospechosa/invalidada exigen motivo',
  $$update public.mediciones set calidad = 'invalidada', calidad_motivo = ' ' where id = (select min(id) from public.mediciones)$$, '23514');

rollback;
