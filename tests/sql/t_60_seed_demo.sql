-- Seed de demo (supabase/seed/demo.sql): es idempotente y deja datos ricos y aislados.
-- Va el último: confirma datos (el seed hace commit) y el resto de los tests ya corrieron.

-- (El fallo claro sin cliente Demo se comprueba en run.sh antes de este test.)
-- 2. Con el cliente creado
-- Las fixtures insertaron ids explícitos en vehiculos: se alinea la secuencia.
select setval(pg_get_serial_sequence('public.vehiculos','id'), (select max(id) from public.vehiculos));
insert into auth.users (id, email) values ('a0000000-0000-0000-0000-0000000000d1', 'demo@t');
insert into public.clientes (id, nombre, auth_user_id) values (50, 'Demo Transportes', 'a0000000-0000-0000-0000-0000000000d1');
\ir ../../supabase/seed/demo.sql
-- 3. Segunda ejecución: idempotente (mismos conteos, sin duplicar)
\ir ../../supabase/seed/demo.sql

begin;
select test.eq('2 seccionales', (select count(*) from public.sucursales where cliente_id = 50), 2::bigint);
select test.eq('14 vehículos', (select count(*) from public.vehiculos where cliente_id = 50), 14::bigint);
select test.eq('9 vehículos en Montevideo',
  (select count(*) from public.vehiculos v join public.sucursales s on s.id = v.sucursal_id where v.cliente_id = 50 and s.nombre = 'Montevideo'), 9::bigint);
select test.eq('5 vehículos en Salto',
  (select count(*) from public.vehiculos v join public.sucursales s on s.id = v.sucursal_id where v.cliente_id = 50 and s.nombre = 'Salto'), 5::bigint);
select test.eq('6 dispositivos', (select count(*) from public.dispositivos where cliente_id = 50), 6::bigint);
select test.eq('6 neumáticos en camiones de 6', (select count(*) from public.neumaticos where vehiculo_id = (select id from public.vehiculos where patente = 'DEMO003')), 6::bigint);
select test.eq('10 neumáticos + auxilio en DEMO001', (select count(*) from public.neumaticos where vehiculo_id = (select id from public.vehiculos where patente = 'DEMO001')), 11::bigint);
select test.eq('hay neumáticos de auxilio', (select count(*) > 0 from public.neumaticos where cliente_id = 50 and auxilio), true);
select test.eq('un solo set de neumáticos (sin duplicar)', (select count(*) from public.neumaticos where cliente_id = 50),
  (select count(distinct idneumatico) from public.neumaticos where cliente_id = 50));
select test.eq('mediciones: 10 sesiones por neumático medido (5 recién montados con una sola)',
  (select count(*) from public.mediciones where cliente_id = 50),
  (select 10 * (count(*) - 1 - 5) + 5 from public.neumaticos where cliente_id = 50));  -- -1: el que nunca se midió
select test.eq('las mediciones tienen promedio calculado', (select count(*) from public.mediciones where cliente_id = 50 and promedio <= 0), 0::bigint);
select test.eq('odómetro creciente en el tiempo (DEMO002 pos 1)',
  (select bool_and(odometro_km >= prev) from (
     select odometro_km, coalesce(lag(odometro_km) over (order by created_at), 0) prev
     from public.mediciones where cliente_id = 50 and idneumatico = 'DEMO-02-01') q), true);
select test.eq('stock de ejemplo', (select count(*) from public.stock_neumaticos where cliente_id = 50), 3::bigint);
select test.eq('otros clientes intactos (cliente 1: sin seccionales ni stock demo)',
  (select count(*) from public.sucursales where cliente_id in (1,2)), 0::bigint);

-- Las vistas devuelven filas ricas para el cliente Demo (como superusuario)
select test.eq('v_estado_neumaticos devuelve filas', (select count(*) > 60 from public.v_estado_neumaticos where cliente_id = 50), true);
select test.eq('hay neumáticos ok', (select count(*) > 0 from public.v_estado_neumaticos where cliente_id = 50 and estado = 'ok'), true);
select test.eq('hay neumáticos bajos', (select count(*) > 0 from public.v_estado_neumaticos where cliente_id = 50 and estado = 'bajo'), true);
select test.eq('hay neumáticos críticos', (select count(*) > 0 from public.v_estado_neumaticos where cliente_id = 50 and estado = 'critico'), true);
select test.eq('hay un neumático sin datos', (select count(*) from public.v_estado_neumaticos where cliente_id = 50 and estado = 'sin_datos'), 1::bigint);
select test.eq('hay neumáticos sin medir hace >30 días', (select count(*) > 0 from public.v_estado_neumaticos where cliente_id = 50 and sin_medir and dias_desde_medicion > 30), true);
select test.eq('hay desgaste irregular', (select count(*) >= 3 from public.v_estado_neumaticos where cliente_id = 50 and desgaste_irregular), true);
select test.eq('hay tasas de desgaste calculadas', (select count(*) > 40 from public.v_estado_neumaticos where cliente_id = 50 and tasa_mm_semana > 0), true);
select test.eq('alertas de los 5 tipos',
  (select count(distinct tipo) from public.v_alertas where cliente_id = 50), 5::bigint);
select test.eq('salud: hay activos', (select count(*) > 0 from public.v_salud_dispositivos where cliente_id = 50 and estado = 'activo'), true);
select test.eq('salud: un dispositivo sin actividad', (select count(*) from public.v_salud_dispositivos where cliente_id = 50 and estado = 'sin_actividad'), 1::bigint);
select test.eq('salud: un dispositivo caído', (select count(*) from public.v_salud_dispositivos where cliente_id = 50 and estado = 'caido'), 1::bigint);
select test.eq('resumen de flota del demo', (select n_vehiculos_activos from public.v_resumen_flota_cliente where cliente_id = 50), 14::bigint);

-- «Últimas mediciones» de Inicio: 10 vehículos medidos en los últimos 5 días, con comparativa y con neumáticos nuevos
select test.eq('últimas mediciones: los 14 vehículos del demo aparecen',
  (select count(distinct vehiculo_id) from public.ultimas_mediciones(50) where vehiculo_id in (select id from public.vehiculos where cliente_id = 50)), 14::bigint);
select test.eq('10 vehículos medidos en los últimos 5 días',
  (select count(*) from (select vehiculo_id from public.mediciones where cliente_id = 50 group by 1 having max(created_at) > now() - interval '5 days') q), 10::bigint);
select test.eq('últimas mediciones: hay neumáticos con comparativa',
  (select count(*) > 30 from public.ultimas_mediciones(50) where mm_antes is not null and vehiculo_id in (select id from public.vehiculos where cliente_id = 50)), true);
select test.eq('últimas mediciones: hay neumáticos nuevos sin comparativa',
  (select count(*) >= 5 from public.ultimas_mediciones(50) where mm_antes is null and vehiculo_id in (select id from public.vehiculos where cliente_id = 50)), true);

-- Perfil global del demo ve los 14; un perfil de seccional ve solo los suyos
insert into auth.users (id, email) values ('a0000000-0000-0000-0000-0000000000d2', 'demo-slt@t');
insert into public.perfiles (user_id, rol, cliente_id, sucursal_id)
  select 'a0000000-0000-0000-0000-0000000000d2', 'cliente', 50, id from public.sucursales where cliente_id = 50 and nombre = 'Salto';
select test.become('authenticated', 'a0000000-0000-0000-0000-0000000000d1');
select test.eq('demo global ve 14 vehículos', (select count(*) from public.vehiculos), 14::bigint);
select test.eq('demo global ve estado de neumáticos', (select count(*) > 60 from public.v_estado_neumaticos), true);
reset role;
select test.become('authenticated', 'a0000000-0000-0000-0000-0000000000d2');
select test.eq('demo Salto ve 5 vehículos', (select count(*) from public.vehiculos), 5::bigint);
select test.eq('demo Salto: estado solo de sus vehículos',
  (select count(*) from public.v_estado_neumaticos where vehiculo_id not in (select id from public.vehiculos)), 0::bigint);
select test.eq('demo Salto: alertas solo de sus vehículos',
  (select count(*) from public.v_alertas where patente not in ('DEMO010','DEMO011','DEMO012','DEMO013','DEMO014')), 0::bigint);
select test.eq('demo Salto ve 2 dispositivos', (select count(*) from public.dispositivos), 2::bigint);
reset role;
rollback;
