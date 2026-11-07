-- Las mediciones siguen al NEUMÁTICO (no a la posición): cambio, rotación, histórico sin idneumatico,
-- neumáticos fuera de servicio, aislamiento por cliente/seccional, API de proveedor y forma de las vistas.
-- Todo ocurre en una transacción que se revierte; cada escenario vuelve a un savepoint.
-- Los intervalos van en horas (no 'días'): un cambio de horario del servidor desplazaría las tasas.
-- now() es fijo dentro de la transacción: las mediciones usan fechas explícitas relativas a now().
begin;

insert into auth.users (id, email) values ('a0000000-0000-0000-0000-0000000000f8', 'sd80@t');
insert into public.sucursales (id, cliente_id, nombre) overriding system value values (301, 1, 'Seccional 80'), (302, 1, 'Otra 80');
insert into public.perfiles (user_id, rol, cliente_id, sucursal_id) values
  ('a0000000-0000-0000-0000-0000000000f8', 'cliente', 1, 301);
create or replace function test.u_s80() returns uuid language sql immutable as $$ select 'a0000000-0000-0000-0000-0000000000f8'::uuid $$;
grant execute on function test.u_s80() to public;

-- Vehículos propios de este test (cliente 1 salvo el 15, del cliente 2).
insert into public.vehiculos (id, cliente_id, nombre, patente, activo, sucursal_id) values
  (11, 1, 'T80 cambio',   'TT1100', true, 301),
  (12, 1, 'T80 rotacion', 'TT1200', true, 302),
  (13, 1, 'T80 historico','TT1300', true, null),
  (14, 1, 'T80 fuera',    'TT1400', true, null),
  (15, 2, 'T80 ajeno',    'TT1500', true, null);

-- V11: P1 crítico (4.2) con historial, P2 ok, P3 solo medición histórica sin idneumatico, P4 sin mediciones
insert into public.neumaticos (vehiculo_id, cliente_id, posicion, idneumatico, estado, marca) values
  (11, 1, 1, 'N-11-1', 'montado', 'Vieja'), (11, 1, 2, 'N-11-2', 'montado', 'Vieja'),
  (11, 1, 3, 'N-11-3', 'montado', 'Vieja'), (11, 1, 4, 'N-11-4', 'montado', 'Vieja');
insert into public.mediciones (vehiculo_id, cliente_id, posicion, idneumatico, mm1, mm2, mm3, created_at) values
  (11, 1, 1, 'N-11-1', 6.2, 6.2, 6.2, now() - interval '336 hours'),
  (11, 1, 1, 'N-11-1', 5.2, 5.2, 5.2, now() - interval '168 hours'),
  (11, 1, 1, 'N-11-1', 4.2, 4.2, 4.2, now() - interval '1 second'),
  (11, 1, 2, 'N-11-2', 9.0, 9.0, 9.0, now() - interval '24 hours'),
  (11, 1, 3, null,     7.0, 7.0, 7.0, now() - interval '72 hours');   -- histórica, posición 3

-- V12: dos neumáticos medidos con tasas distintas (A en P1: 1 mm/sem; B en P2: 0.5 mm/sem)
insert into public.neumaticos (vehiculo_id, cliente_id, posicion, idneumatico, estado, marca) values
  (12, 1, 1, 'N-12-A', 'montado', 'A'), (12, 1, 2, 'N-12-B', 'montado', 'B');
insert into public.mediciones (vehiculo_id, cliente_id, posicion, idneumatico, mm1, mm2, mm3, created_at) values
  (12, 1, 1, 'N-12-A', 11, 11, 11, now() - interval '336 hours'),
  (12, 1, 1, 'N-12-A', 10, 10, 10, now() - interval '168 hours'),
  (12, 1, 1, 'N-12-A',  9,  9,  9, now() - interval '1 second'),
  (12, 1, 2, 'N-12-B', 7.5, 7.5, 7.5, now() - interval '336 hours'),
  (12, 1, 2, 'N-12-B', 7.0, 7.0, 7.0, now() - interval '168 hours'),
  (12, 1, 2, 'N-12-B', 6.5, 6.5, 6.5, now() - interval '1 second');

-- V13: casos del histórico sin idneumatico
insert into public.neumaticos (vehiculo_id, cliente_id, posicion, idneumatico, estado, marca) values
  (13, 1, 1, 'N-13-1', 'montado', 'M'),   -- solo histórica
  (13, 1, 2, 'N-13-2', 'montado', 'M'),   -- histórica + etiquetada: manda la etiquetada
  (13, 1, 3, null,     'montado', 'M'),   -- sin idneumatico en el neumático: cae a la posición
  (13, 1, 4, 'N-13-4', 'montado', 'M'),   -- histórica anterior a un evento de montaje en la posición
  (13, 1, 5, 'N-13-5', 'montado', 'M');   -- histórica posterior al evento de montaje
insert into public.mediciones (vehiculo_id, cliente_id, posicion, idneumatico, mm1, mm2, mm3, created_at) values
  (13, 1, 1, null,     6.0, 6.0, 6.0, now() - interval '120 hours'),
  (13, 1, 2, null,     5.0, 5.0, 5.0, now() - interval '120 hours'),
  (13, 1, 2, 'N-13-2', 9.0, 9.0, 9.0, now() - interval '48 hours'),
  (13, 1, 3, null,     6.5, 6.5, 6.5, now() - interval '120 hours'),
  (13, 1, 4, null,     3.0, 3.0, 3.0, now() - interval '480 hours'),
  (13, 1, 5, null,     7.5, 7.5, 7.5, now() - interval '48 hours');
insert into public.eventos_neumatico (cliente_id, vehiculo_id, neumatico_id, idneumatico, tipo, posicion_destino, created_at) values
  (1, 13, (select id from public.neumaticos where idneumatico='N-13-4'), 'N-13-4', 'montaje', 4, now() - interval '240 hours'),
  (1, 13, (select id from public.neumaticos where idneumatico='N-13-5'), 'N-13-5', 'montaje', 5, now() - interval '240 hours');
-- La medición de P4 (hace 20 días) es anterior al montaje de hace 10 días: es del neumático anterior.
-- Un evento del mismo vehículo en OTRA posición no afecta a P1.
insert into public.eventos_neumatico (cliente_id, vehiculo_id, tipo, posicion_destino, created_at) values
  (1, 13, 'montaje', 9, now() - interval '24 hours');

-- V14: neumáticos que no cuentan como montados
insert into public.neumaticos (vehiculo_id, cliente_id, posicion, idneumatico, estado, marca) values
  (14, 1, 1, 'N-14-1', 'montado', 'M'), (14, 1, 2, 'N-14-2', 'almacenado', 'M'),
  (14, 1, 3, 'N-14-3', 'baja', 'M'), (14, 1, 4, 'N-14-4', 'reparacion', 'M'), (14, 1, 5, null, 'baja', 'M');
insert into public.mediciones (vehiculo_id, cliente_id, posicion, idneumatico, mm1, mm2, mm3, created_at) values
  (14, 1, 1, 'N-14-1', 9, 9, 9, now() - interval '24 hours'),
  (14, 1, 2, 'N-14-2', 3, 3, 3, now() - interval '24 hours'),
  (14, 1, 3, 'N-14-3', 3, 3, 3, now() - interval '24 hours'),
  (14, 1, 4, 'N-14-4', 3, 3, 3, now() - interval '24 hours'),
  (14, 1, 5, null,     3, 3, 3, now() - interval '24 hours');

-- V15: otro cliente
insert into public.neumaticos (vehiculo_id, cliente_id, posicion, idneumatico, estado, marca) values
  (15, 2, 1, 'N-15-1', 'montado', 'X');
insert into public.mediciones (vehiculo_id, cliente_id, posicion, idneumatico, mm1, mm2, mm3, created_at) values
  (15, 2, 1, 'N-15-1', 4, 4, 4, now() - interval '24 hours');

create or replace function test.est(p_veh bigint, p_pos smallint) returns text language sql stable as $$
  select estado from public.v_estado_neumaticos where vehiculo_id = p_veh and posicion = p_pos $$;
create or replace function test.prom(p_veh bigint, p_pos smallint) returns numeric language sql stable as $$
  select promedio from public.v_estado_neumaticos where vehiculo_id = p_veh and posicion = p_pos $$;
create or replace function test.idn(p_veh bigint, p_pos smallint) returns text language sql stable as $$
  select idneumatico from public.v_estado_neumaticos where vehiculo_id = p_veh and posicion = p_pos $$;
create or replace function test.n_alertas(p_veh bigint, p_pos smallint, p_tipo text) returns bigint language sql stable as $$
  select count(*) from public.v_alertas where vehiculo_id = p_veh and posicion = p_pos and tipo = p_tipo $$;
grant execute on function test.est(bigint, smallint), test.prom(bigint, smallint), test.idn(bigint, smallint),
  test.n_alertas(bigint, smallint, text) to public;
savepoint s0;

-- -----------------------------------------------------------------------------
-- 1. Estado inicial (la regla por neumático no cambia lo que ya funcionaba)
-- -----------------------------------------------------------------------------
select test.become('authenticated', test.u_admin());
select test.eq('V11 P1 crítico 4.2', test.prom(11, 1::smallint), 4.20);
select test.eq('V11 P1 estado crítico', test.est(11, 1::smallint), 'critico');
select test.eq('V11 P2 ok', test.est(11, 2::smallint), 'ok');
select test.eq('V11 P3: histórica sin idneumatico cuenta (neumático sin etiquetadas, sin eventos) => bajo 7.0',
  test.prom(11, 3::smallint), 7.00);
select test.eq('V11 P4 sin mediciones => sin_datos', test.est(11, 4::smallint), 'sin_datos');
select test.eq('V11 hay alerta crítica en P1', test.n_alertas(11, 1::smallint, 'critico'), 1::bigint);
select test.eq('V11 P4 alerta sin_medir (montado sin mediciones)', test.n_alertas(11, 4::smallint, 'sin_medir'), 1::bigint);
select test.eq('V11 P1 tasa por neumático: 1 mm/sem', (select tasa_mm_semana from public.v_estado_neumaticos where vehiculo_id=11 and posicion=1), 1.000);
select test.eq('V11 P1 idneumatico del neumático medido', test.idn(11, 1::smallint), 'N-11-1');
select test.eq('v_ultima_medicion devuelve la posición actual y la medición más reciente',
  (select promedio from public.v_ultima_medicion where vehiculo_id=11 and posicion=1), 4.20);
reset role;

-- -----------------------------------------------------------------------------
-- 2. Cambio de un neumático crítico: la rueda nueva NO hereda la medición del viejo
-- -----------------------------------------------------------------------------
select test.become('authenticated', test.u_admin());
select (public.neumatico_cambiar(11::bigint, 1::smallint, 'baja', 'Desgaste', 5000, null,
   '{"marca":"Nuevo","modelo":"Z","precio":900}'::jsonb)->>'idneumatico_nuevo') as nuevo_idn \gset
reset role;
select test.become('authenticated', test.u_admin());
select test.eq('tras el cambio P1 es sin_datos', test.est(11, 1::smallint), 'sin_datos');
select test.eq('tras el cambio P1 sin promedio (no hereda 4.2)', test.prom(11, 1::smallint) is null, true);
select test.eq('tras el cambio P1 figura el idneumatico del nuevo', test.idn(11, 1::smallint), :'nuevo_idn');
select test.eq('tras el cambio P1 sin_medir', (select sin_medir from public.v_estado_neumaticos where vehiculo_id=11 and posicion=1), true);
select test.eq('tras el cambio desaparece la alerta crítica de P1', test.n_alertas(11, 1::smallint, 'critico'), 0::bigint);
select test.eq('tras el cambio P1 sin alerta bajo ni cruza_critico_pronto',
  (select count(*) from public.v_alertas where vehiculo_id=11 and posicion=1 and tipo in ('bajo','cruza_critico_pronto')), 0::bigint);
select test.eq('tras el cambio P1 queda la alerta de neumático montado sin ninguna medición',
  test.n_alertas(11, 1::smallint, 'sin_medir'), 1::bigint);
select test.eq('tras el cambio P1 sin tasa ni historial del viejo',
  (select n_mediciones_90d || '|' || coalesce(tasa_mm_semana::text, 'null') from public.v_estado_neumaticos where vehiculo_id=11 and posicion=1), '0|null');
select test.eq('el viejo (baja) ya no cuenta como montado en el estado',
  (select count(*) from public.v_estado_neumaticos where idneumatico = 'N-11-1'), 0::bigint);
select test.eq('el viejo (baja) no figura en v_ultima_medicion',
  (select count(*) from public.v_ultima_medicion where idneumatico = 'N-11-1'), 0::bigint);
select test.eq('v_ultima_medicion: la posición 1 no tiene fila (sin medición del nuevo)',
  (select count(*) from public.v_ultima_medicion where vehiculo_id=11 and posicion=1), 0::bigint);
select test.eq('el historial del viejo se conserva (3 mediciones) en v_mediciones_neumatico',
  (select count(*) from public.v_mediciones_neumatico where idneumatico = 'N-11-1' and estado_montaje = 'baja'), 3::bigint);
select test.eq('el nuevo no tiene mediciones atribuidas',
  (select count(*) from public.v_mediciones_neumatico where idneumatico = :'nuevo_idn'), 0::bigint);
select test.eq('resumen de flota: P1 ya no cuenta como crítico del cliente 1 (V11)',
  (select count(*) from public.v_estado_neumaticos where vehiculo_id=11 and estado='critico'), 0::bigint);
select test.eq('el resto de V11 no cambia (P2 ok, P3 7.0, P4 sin_datos)',
  test.est(11, 2::smallint) || '|' || test.prom(11, 3::smallint) || '|' || test.est(11, 4::smallint), 'ok|7.00|sin_datos');
reset role;

-- El nuevo se mide: la posición toma SU valor. Se mide también con una medición de posición (sin
-- idneumatico) posterior al montaje: pertenece al nuevo.
insert into public.mediciones (vehiculo_id, cliente_id, posicion, idneumatico, mm1, mm2, mm3, created_at)
  values (11, 1, 1, :'nuevo_idn', 11, 11, 11, now() + interval '1 hour');
-- Una medición TARDÍA etiquetada con el neumático viejo no cambia la posición.
insert into public.mediciones (vehiculo_id, cliente_id, posicion, idneumatico, mm1, mm2, mm3, created_at)
  values (11, 1, 1, 'N-11-1', 2, 2, 2, now() + interval '2 hours');
select test.become('authenticated', test.u_admin());
select test.eq('el nuevo medido: P1 ok con su valor 11', test.est(11, 1::smallint) || '|' || test.prom(11, 1::smallint), 'ok|11.00');
select test.eq('una medición tardía del viejo no pisa al nuevo', test.prom(11, 1::smallint), 11.00);
select test.eq('la tasa del nuevo no mezcla puntos del viejo (1 punto)',
  (select n_mediciones_90d || '|' || coalesce(tasa_mm_semana::text, 'null') from public.v_estado_neumaticos where vehiculo_id=11 and posicion=1), '1|null');
select test.eq('ya no hay alertas de P1 de crítico ni de sin_medir',
  (select count(*) from public.v_alertas where vehiculo_id=11 and posicion=1), 0::bigint);
reset role;
-- Medición de posición (sin idneumatico) posterior al montaje, con otro nuevo neumático sin etiquetadas
rollback to s0;

-- 2b. Cambio donde el viejo va a 'almacenado' y el nuevo se mide solo por posición (sin idneumatico)
select test.become('authenticated', test.u_admin());
select public.neumatico_cambiar(11::bigint, 2::smallint, 'almacenado', null, null, null, '{"marca":"N2"}'::jsonb);
reset role;
select test.eq('P2 (cambio, viejo almacenado) sin_datos', (select test.est(11, 2::smallint)), 'sin_datos');
select test.eq('el neumático almacenado conserva sus mediciones fuera del estado',
  (select count(*) from public.v_mediciones_neumatico where idneumatico='N-11-2' and estado_montaje='almacenado'), 1::bigint);
insert into public.mediciones (vehiculo_id, cliente_id, posicion, mm1, mm2, mm3, created_at)
  values (11, 1, 2, 8.5, 8.5, 8.5, now() + interval '1 hour');
select test.eq('medición de posición posterior al montaje se atribuye al nuevo', (select test.prom(11, 2::smallint)), 8.50);
rollback to s0;

-- 2c. P3 tenía solo una medición histórica: tras el cambio el nuevo NO la hereda
select test.become('authenticated', test.u_admin());
select public.neumatico_cambiar(11::bigint, 3::smallint, 'reparacion', null, null, null, '{"marca":"N3"}'::jsonb);
select test.eq('P3 tras cambio: la medición histórica del viejo no se hereda (evento posterior)', test.est(11, 3::smallint), 'sin_datos');
reset role;
rollback to s0;

-- -----------------------------------------------------------------------------
-- 3. Rotación 1 <-> 2 (V12): las mediciones acompañan al neumático
-- -----------------------------------------------------------------------------
select test.become('authenticated', test.u_admin());
select test.eq('V12 antes: P1 ok 9.0 (A), P2 bajo 6.5 (B)',
  test.est(12, 1::smallint) || test.prom(12, 1::smallint) || '|' || test.est(12, 2::smallint) || test.prom(12, 2::smallint), 'ok9.00|bajo6.50');
select test.eq('V12 antes: tasas A 1.000 y B 0.500',
  (select string_agg(tasa_mm_semana::text, ',' order by posicion) from public.v_estado_neumaticos where vehiculo_id=12 and posicion in (1,2)), '1.000,0.500');
select public.neumatico_rotar(12::bigint, 1::smallint, 2::smallint, 100);
select test.eq('V12 tras rotar: P1 ahora es B (bajo 6.5)',
  test.idn(12, 1::smallint) || '|' || test.est(12, 1::smallint) || '|' || test.prom(12, 1::smallint), 'N-12-B|bajo|6.50');
select test.eq('V12 tras rotar: P2 ahora es A (ok 9.0)',
  test.idn(12, 2::smallint) || '|' || test.est(12, 2::smallint) || '|' || test.prom(12, 2::smallint), 'N-12-A|ok|9.00');
select test.eq('V12 tras rotar: las tasas acompañan al neumático (P1=B 0.5, P2=A 1.0)',
  (select string_agg(tasa_mm_semana::text, ',' order by posicion) from public.v_estado_neumaticos where vehiculo_id=12 and posicion in (1,2)), '0.500,1.000');
select test.eq('V12 tras rotar: semanas hasta crítico acompañan al neumático (B: (6.5-5)/0.5=3; A: (9-5)/1=4)',
  (select string_agg(semanas_hasta_critico::text, ',' order by posicion) from public.v_estado_neumaticos where vehiculo_id=12 and posicion in (1,2)), '3.00,4.00');
select test.eq('V12 tras rotar: la alerta bajo está en P1 (donde está B), no en P2',
  test.n_alertas(12, 1::smallint, 'bajo') || '|' || test.n_alertas(12, 2::smallint, 'bajo'), '1|0');
select test.eq('V12 historial de B: posición de medición 2, posición actual 1',
  (select string_agg(distinct posicion_medicion || '>' || posicion_actual, ',') from public.v_mediciones_neumatico where idneumatico='N-12-B'), '2>1');
select test.eq('V12 historial: 3 mediciones por neumático',
  (select count(*) from public.v_mediciones_neumatico where vehiculo_id=12 and neumatico_id = (select id from public.neumaticos where idneumatico='N-12-A')), 3::bigint);
select test.eq('V12 eventos de rotación coherentes (A 1>2, B 2>1)',
  (select string_agg(idneumatico || ':' || posicion_origen || '>' || posicion_destino, ',' order by idneumatico) from public.eventos_neumatico where vehiculo_id=12 and tipo='rotacion'), 'N-12-A:1>2,N-12-B:2>1');
select test.eq('V12 v_ultima_medicion por posición actual',
  (select string_agg(posicion || ':' || idneumatico, ',' order by posicion) from public.v_ultima_medicion where vehiculo_id=12 and posicion in (1,2)), '1:N-12-B,2:N-12-A');
-- Rotar de vuelta restablece
select public.neumatico_rotar(12::bigint, 1::smallint, 2::smallint, null);
select test.eq('V12 rotar de vuelta: P1 vuelve a A', test.idn(12, 1::smallint) || test.prom(12, 1::smallint), 'N-12-A9.00');
-- Mover a una posición libre: la medición viaja
select public.neumatico_rotar(12::bigint, 2::smallint, 7::smallint, null);
select test.eq('V12 movido a posición libre P7: B con 6.5 y P2 deja de existir',
  test.idn(12, 7::smallint) || test.prom(12, 7::smallint) || '|' || (select count(*) from public.v_estado_neumaticos where vehiculo_id=12 and posicion=2), 'N-12-B6.50|0');
reset role;
rollback to s0;

-- 3b. Rotación de neumáticos con SOLO histórico sin idneumatico (V13 P1 y P3 intercambian)
select test.become('authenticated', test.u_admin());
select test.eq('V13 antes: P1 6.0 (histórica), P3 6.5 (neumático sin idneumatico)',
  test.prom(13, 1::smallint) || '|' || test.prom(13, 3::smallint), '6.00|6.50');
select public.neumatico_rotar(13::bigint, 1::smallint, 3::smallint, null);
select test.eq('V13 tras rotar: el histórico sin idneumatico queda huérfano (posición cambió después de medir): sin_datos en ambas',
  test.est(13, 1::smallint) || '|' || test.est(13, 3::smallint), 'sin_datos|sin_datos');
reset role;
rollback to s0;

-- -----------------------------------------------------------------------------
-- 4. Mediciones históricas con idneumatico NULL (V13)
-- -----------------------------------------------------------------------------
select test.become('authenticated', test.u_admin());
select test.eq('P1: solo histórica, sin eventos => cuenta (6.0, bajo)', test.est(13, 1::smallint) || test.prom(13, 1::smallint), 'bajo6.00');
select test.eq('P2: con etiquetada manda la etiquetada (9.0), no la histórica 5.0', test.prom(13, 2::smallint), 9.00);
select test.eq('P2: la histórica no entra ni en el historial del neumático',
  (select count(*) from public.v_mediciones_neumatico where idneumatico='N-13-2'), 1::bigint);
select test.eq('P3: neumático sin idneumatico cae a la posición (6.5)', test.prom(13, 3::smallint), 6.50);
select test.eq('P4: medición anterior al montaje de la posición no se hereda', test.est(13, 4::smallint), 'sin_datos');
select test.eq('P5: medición posterior al montaje sí cuenta (7.5)', test.prom(13, 5::smallint), 7.50);
select test.eq('un evento de otra posición no invalida las históricas de P1', test.est(13, 1::smallint), 'bajo');
select test.eq('atribución registrada: P1 por posición, P2 por idneumatico',
  (select string_agg(distinct atribucion, ',') from public.v_mediciones_neumatico where idneumatico = 'N-13-1') || '|' ||
  (select string_agg(distinct atribucion, ',') from public.v_mediciones_neumatico where idneumatico = 'N-13-2'), 'posicion|idneumatico');
select test.eq('ninguna medición se atribuye a dos neumáticos',
  (select count(*) from (select medicion_id from public.v_mediciones_neumatico group by medicion_id having count(*) > 1) x), 0::bigint);
reset role;

-- Empate de fechas: manda la de mayor id
insert into public.mediciones (vehiculo_id, cliente_id, posicion, idneumatico, mm1, mm2, mm3, created_at) values
  (14, 1, 1, 'N-14-1', 6, 6, 6, now()),
  (14, 1, 1, 'N-14-1', 7, 7, 7, now());
select test.become('authenticated', test.u_admin());
select test.eq('empate exacto de created_at: gana la de mayor id (7.0)', test.prom(14, 1::smallint), 7.00);
reset role;
rollback to s0;

-- -----------------------------------------------------------------------------
-- 5. Neumáticos que no están montados (V14)
-- -----------------------------------------------------------------------------
select test.become('authenticated', test.u_admin());
select test.eq('V14: solo el montado figura en el estado', (select count(*) from public.v_estado_neumaticos where vehiculo_id=14), 1::bigint);
select test.eq('V14: almacenado/baja/reparación no figuran en v_ultima_medicion',
  (select count(*) from public.v_ultima_medicion where vehiculo_id=14), 1::bigint);
select test.eq('V14: no generan alertas (solo el montado, ok)', (select count(*) from public.v_alertas where vehiculo_id=14 and tipo in ('critico','bajo')), 0::bigint);
select test.eq('V14: sus 3 mm no cuentan como críticos del cliente',
  (select count(*) from public.v_estado_neumaticos where vehiculo_id=14 and estado='critico'), 0::bigint);
select test.eq('V14: baja sin idneumatico con medición de posición: no se atribuye',
  (select count(*) from public.v_mediciones_neumatico where vehiculo_id=14 and neumatico_id = (select id from public.neumaticos where vehiculo_id=14 and posicion=5)), 0::bigint);
reset role;
rollback to s0;

-- -----------------------------------------------------------------------------
-- 6. Aislamiento (RLS intacta en las vistas, incluida la nueva)
-- -----------------------------------------------------------------------------
select test.become('authenticated', test.u_s80());   -- seccional 301 = solo V11
select test.eq('seccional: v_mediciones_neumatico solo de su vehículo',
  (select count(*) from public.v_mediciones_neumatico where vehiculo_id is distinct from 11), 0::bigint);
select test.eq('seccional ve las mediciones de su vehículo', (select count(*) from public.v_mediciones_neumatico where vehiculo_id = 11) > 0, true);
select test.eq('seccional: v_estado solo su vehículo', (select count(*) from public.v_estado_neumaticos where vehiculo_id is distinct from 11), 0::bigint);
select test.eq('seccional: v_alertas solo su vehículo', (select count(*) from public.v_alertas where vehiculo_id is distinct from 11), 0::bigint);
select test.eq('seccional: v_ultima_medicion solo su vehículo', (select count(*) from public.v_ultima_medicion where vehiculo_id is distinct from 11), 0::bigint);
select test.eq('seccional no ve V12 (otra seccional)', (select count(*) from public.v_mediciones_neumatico where vehiculo_id = 12), 0::bigint);
-- El seccional cambia SU neumático: ve el resultado, y no se filtra nada de otros
select public.neumatico_cambiar(11::bigint, 1::smallint, 'baja', 'Corte', null, null, '{"marca":"S"}'::jsonb);
select test.eq('seccional tras cambiar: P1 sin_datos', test.est(11, 1::smallint), 'sin_datos');
reset role;
rollback to s0;

select test.become('authenticated', test.u_cli_a());   -- global del cliente 1
select test.eq('global ve todos los vehículos del cliente 1 (11..14) y ninguno del 2',
  (select string_agg(distinct vehiculo_id::text, ',' order by vehiculo_id::text) from public.v_mediciones_neumatico where vehiculo_id between 11 and 15), '11,12,13,14');
reset role;
select test.become('authenticated', test.u_cli_b());   -- cliente 2
select test.eq('cliente B ve solo su vehículo 15 (y nada de V11..V14)',
  (select string_agg(distinct vehiculo_id::text, ',') from public.v_mediciones_neumatico where vehiculo_id between 11 and 15), '15');
select test.eq('cliente B: v_estado de V11 vacío', (select count(*) from public.v_estado_neumaticos where vehiculo_id = 11), 0::bigint);
reset role;
select test.become('authenticated', test.u_sinperfil());
select test.eq('sin perfil: nada en v_mediciones_neumatico', (select count(*) from public.v_mediciones_neumatico), 0::bigint);
reset role;
select test.become('anon', null);
select test.denied('anon denegado en v_mediciones_neumatico', 'select 1 from public.v_mediciones_neumatico');
reset role;
-- Aislamiento por neumático: una medición etiquetada con un idneumatico de OTRO cliente no se cruza
insert into public.mediciones (vehiculo_id, cliente_id, posicion, idneumatico, mm1, mm2, mm3, created_at)
  values (11, 1, 1, 'N-15-1', 1, 1, 1, now());
select test.become('authenticated', test.u_cli_a());
select test.eq('un idneumatico ajeno en una medición del cliente 1 no aparece al cliente 1 (el neumático es de otro cliente)',
  (select count(*) from public.v_mediciones_neumatico where idneumatico = 'N-15-1' and cliente_id = 1), 0::bigint);
reset role;
rollback to s0;

-- -----------------------------------------------------------------------------
-- 7. API de proveedor
-- -----------------------------------------------------------------------------
select test.eq('API: V11 devuelve los 4 neumáticos montados con la medición de cada uno',
  (select string_agg((e->>'posicion') || ':' || coalesce(e->>'mm1', 'null'), ',' order by (e->>'posicion')::int)
     from jsonb_array_elements(public.api_obtener_montaje(1, 'TT1100', null)->'data') e), '1:4.20,2:9.00,3:7.00,4:null');
select test.become('authenticated', test.u_admin());
select public.neumatico_cambiar(11::bigint, 1::smallint, 'baja', 'x', null, null, '{"marca":"Nueva"}'::jsonb) is not null as _x \gset
reset role;
select test.eq('API tras el cambio: P1 es el neumático nuevo sin medición (no hereda 4.2) y el viejo no se ofrece',
  (select string_agg((e->>'posicion') || ':' || coalesce(e->>'mm1', 'null'), ',' order by (e->>'posicion')::int)
     from jsonb_array_elements(public.api_obtener_montaje(1, 'TT1100', null)->'data') e), '1:null,2:9.00,3:7.00,4:null');
select test.eq('API: el idneumatico de P1 es el del nuevo (CN-)',
  (select (e->>'idneumatico') like 'CN-11-1-%' from jsonb_array_elements(public.api_obtener_montaje(1, 'TT1100', null)->'data') e where e->>'posicion' = '1'), true);
select test.eq('API: no se devuelve el neumático dado de baja (aparcado)',
  (select count(*) from jsonb_array_elements(public.api_obtener_montaje(1, 'TT1100', null)->'data') e where e->>'idneumatico' = 'N-11-1'), 0::bigint);
-- guardar inserta con el idneumatico del neumático ACTUAL de la posición
select test.eq('API guardar: P1 guardado',
  public.api_guardar_montaje(1, gen_random_uuid(), 'TT1100', '[{"posicion":1,"mm1":10,"mm2":10,"mm3":10}]'::jsonb, gen_random_uuid(), 'k80-a', 'h')->'resultados'->0->>'guardado', 'true');
select test.eq('API guardar: la medición lleva el idneumatico del nuevo',
  (select idneumatico like 'CN-11-1-%' from public.mediciones where vehiculo_id=11 and posicion=1 order by id desc limit 1), true);
select test.eq('API tras guardar: P1 muestra 10 mm', (select (e->>'mm1') from jsonb_array_elements(public.api_obtener_montaje(1, 'TT1100', null)->'data') e where e->>'posicion' = '1'), '10.00');
select test.eq('API guardar: el estado de la vista refleja la medición del nuevo', (select test.est(11, 1::smallint)), 'ok');
select test.eq('API guardar: el aparcado (posición de estacionamiento) se rechaza',
  public.api_guardar_montaje(1, gen_random_uuid(), 'TT1100',
    format('[{"posicion":%s,"mm1":9,"mm2":9,"mm3":9}]', (select posicion from public.neumaticos where idneumatico='N-11-1'))::jsonb,
    gen_random_uuid(), 'k80-b', 'h2')->'resultados'->0->>'motivo', 'posicion');
select test.eq('API: otro cliente no ve el vehículo', public.api_obtener_montaje(2, 'TT1100', null)->>'encontrado', 'false');
-- Rotación en la API
select test.become('authenticated', test.u_admin());
select public.neumatico_rotar(12::bigint, 1::smallint, 2::smallint, null);
reset role;
select test.eq('API tras rotar V12: los mm acompañan al neumático (P1=B 6.5, P2=A 9)',
  (select string_agg((e->>'idneumatico') || '=' || (e->>'mm1'), ',' order by (e->>'posicion')::int)
     from jsonb_array_elements(public.api_obtener_montaje(1, 'TT1200', null)->'data') e), 'N-12-B=6.50,N-12-A=9.00');
select test.eq('API: consulta por número de coche sin patente sigue funcionando (vehículo inexistente => no encontrado)',
  public.api_obtener_montaje(1, null, 'no-existe')->>'encontrado', 'false');
select test.become('authenticated', test.u_admin());
select test.denied('la API no es ejecutable por authenticated', $$select public.api_obtener_montaje(1, 'TT1100', null)$$);
reset role;
rollback to s0;

-- -----------------------------------------------------------------------------
-- 8. Forma de las vistas: mismas columnas, tipos, orden, security_invoker y grants que antes
-- -----------------------------------------------------------------------------
select test.become('authenticated', test.u_admin());
select test.eq('v_ultima_medicion: columnas',
  (select string_agg(column_name || ':' || data_type, ',' order by ordinal_position) from information_schema.columns
    where table_schema='public' and table_name='v_ultima_medicion'),
  'cliente_id:bigint,vehiculo_id:bigint,posicion:smallint,medicion_id:bigint,idneumatico:text,mm1:numeric,mm2:numeric,mm3:numeric,promedio:numeric,odometro_km:integer,device_id:text,created_at:timestamp with time zone');
select test.eq('v_estado_neumaticos: columnas',
  (select string_agg(column_name || ':' || data_type, ',' order by ordinal_position) from information_schema.columns
    where table_schema='public' and table_name='v_estado_neumaticos'),
  'cliente_id:bigint,vehiculo_id:bigint,vehiculo_nombre:text,patente:text,posicion:smallint,neumatico_id:bigint,idneumatico:text,marca:text,modelo:text,vida:smallint,estado_montaje:text,mm1:numeric,mm2:numeric,mm3:numeric,promedio:numeric,odometro_km:integer,ultima_medicion_at:timestamp with time zone,dias_desde_medicion:integer,estado:text,sin_medir:boolean,diferencia_huellas_mm:numeric,desgaste_irregular:boolean,n_mediciones_90d:bigint,tasa_mm_semana:numeric,umbral_bajo_mm:numeric,umbral_critico_mm:numeric,umbral_retiro_mm:numeric,dias_sin_medir_alerta:integer,semanas_hasta_critico:numeric,semanas_hasta_retiro:numeric');
select test.eq('v_alertas: columnas',
  (select string_agg(column_name || ':' || data_type, ',' order by ordinal_position) from information_schema.columns
    where table_schema='public' and table_name='v_alertas'),
  'cliente_id:bigint,vehiculo_id:bigint,vehiculo_nombre:text,patente:text,posicion:smallint,neumatico_id:bigint,idneumatico:text,tipo:text,severidad:integer,valor:numeric,mensaje:text,ultima_medicion_at:timestamp with time zone');
select test.eq('v_resumen_flota_cliente: columnas',
  (select string_agg(column_name || ':' || data_type, ',' order by ordinal_position) from information_schema.columns
    where table_schema='public' and table_name='v_resumen_flota_cliente'),
  'cliente_id:bigint,nombre:text,n_vehiculos_activos:bigint,n_neumaticos_con_datos:bigint,n_ok:bigint,n_bajo:bigint,n_critico:bigint,n_sin_datos:bigint,n_alertas_sev1:bigint,n_alertas_sev2:bigint,n_alertas_sev3:bigint,ultima_medicion_at:timestamp with time zone');
select test.eq('vistas del producto con security_invoker',
  (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
    where n.nspname='public' and c.relname in ('v_mediciones_neumatico','v_ultima_medicion','v_estado_neumaticos','v_alertas','v_resumen_flota_cliente')
      and 'security_invoker=true' = any(c.reloptions)), 5::bigint);
select test.eq('grants: authenticated SELECT y nadie más (anon/PUBLIC) en las vistas',
  (select string_agg(table_name || ':' || grantee, ',' order by table_name, grantee) from information_schema.role_table_grants
    where table_schema='public' and privilege_type='SELECT'
      and table_name in ('v_mediciones_neumatico','v_ultima_medicion','v_estado_neumaticos','v_alertas','v_resumen_flota_cliente')),
  'v_alertas:authenticated,v_estado_neumaticos:authenticated,v_mediciones_neumatico:authenticated,v_resumen_flota_cliente:authenticated,v_ultima_medicion:authenticated');
select test.eq('api_obtener_montaje / api_guardar_montaje: solo service_role ejecuta',
  (select string_agg(p.proname || ':' || has_function_privilege('anon', p.oid, 'execute')
                     || has_function_privilege('authenticated', p.oid, 'execute')
                     || has_function_privilege('service_role', p.oid, 'execute'), ',' order by p.proname)
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('api_obtener_montaje', 'api_guardar_montaje')),
  'api_guardar_montaje:falsefalsetrue,api_obtener_montaje:falsefalsetrue');
reset role;

-- El resumen de flota hereda: tras cambiar un crítico el contador de críticos baja
select test.become('authenticated', test.u_admin());
select n_critico as crit_antes, n_sin_datos as sd_antes from public.v_resumen_flota_cliente where cliente_id = 1 \gset
select public.neumatico_cambiar(11::bigint, 1::smallint, 'baja', 'x', null, null, '{"marca":"Nueva"}'::jsonb) is not null as _y \gset
select test.eq('resumen: un crítico menos tras el cambio',
  (select n_critico from public.v_resumen_flota_cliente where cliente_id = 1), :crit_antes - 1);
select test.eq('resumen: un sin_datos más tras el cambio',
  (select n_sin_datos from public.v_resumen_flota_cliente where cliente_id = 1), :sd_antes + 1);
reset role;

rollback;
