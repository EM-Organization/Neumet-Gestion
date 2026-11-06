-- Lógica de las vistas (como admin: ve todo).
begin;
select test.become('authenticated', test.u_admin());

-- Estados del fixture (cliente A, umbrales por defecto 8/5/3)
select test.eq('pos2 promedio 8.0 => ok (límite exacto)',
  (select estado from v_estado_neumaticos where vehiculo_id=1 and posicion=2), 'ok');
select test.eq('pos3 promedio 5.0 => bajo (límite exacto)',
  (select estado from v_estado_neumaticos where vehiculo_id=1 and posicion=3), 'bajo');
select test.eq('pos4 promedio 4.99 => critico',
  (select estado from v_estado_neumaticos where vehiculo_id=1 and posicion=4), 'critico');
select test.eq('pos7 sin mediciones => sin_datos',
  (select estado from v_estado_neumaticos where vehiculo_id=1 and posicion=7), 'sin_datos');
select test.eq('neumático en baja excluido',
  (select count(*) from v_estado_neumaticos where vehiculo_id=1 and posicion=9), 0::bigint);
select test.eq('vehículo inactivo excluido',
  (select count(*) from v_estado_neumaticos where vehiculo_id=4), 0::bigint);
select test.eq('umbrales por cliente: B pos1 9 mm => bajo (con 8/5 sería ok)',
  (select estado from v_estado_neumaticos where vehiculo_id=3 and posicion=1), 'bajo');
select test.eq('umbrales por cliente: B pos2 5.5 mm => critico (con 8/5 sería bajo)',
  (select estado from v_estado_neumaticos where vehiculo_id=3 and posicion=2), 'critico');

rollback;

-- Límites exactos barriendo valores (inserta el propietario/service_role; se revierte)
begin;
do $$
declare r record; v_est text;
begin
  for r in select * from (values (7.99,'bajo'),(8.00,'ok'),(8.01,'ok'),(5.00,'bajo'),(4.99,'critico'),(0.00,'critico')) t(val, esp) loop
    insert into public.mediciones (vehiculo_id, cliente_id, posicion, mm1, mm2, mm3, created_at)
    values (1, 1, 3, r.val, r.val, r.val, now() + interval '1 hour');
    select estado into v_est from v_estado_neumaticos where vehiculo_id=1 and posicion=3;
    perform test.eq('semáforo '||r.val, v_est, r.esp);
    delete from public.mediciones where vehiculo_id=1 and posicion=3 and created_at = now() + interval '1 hour';
  end loop;
end $$;
select test.denied('odómetro negativo en mediciones',
  $$insert into public.mediciones (vehiculo_id,cliente_id,posicion,mm1,mm2,mm3,odometro_km) values (1,1,1,9,9,9,-1)$$, '23514');
rollback;

begin;
select test.become('authenticated', test.u_admin());

-- Tasa mm/semana y predicción
select test.eq('tasa pos1 = 1.000 mm/sem',
  (select tasa_mm_semana from v_estado_neumaticos where vehiculo_id=1 and posicion=1), 1.000);
select test.eq('semanas hasta crítico pos1 = (10-5)/1 = 5',
  (select semanas_hasta_critico from v_estado_neumaticos where vehiculo_id=1 and posicion=1), 5.00);
select test.eq('semanas hasta retiro pos1 = (10-3)/1 = 7',
  (select semanas_hasta_retiro from v_estado_neumaticos where vehiculo_id=1 and posicion=1), 7.00);
select test.eq('semanas hasta crítico pos2 = (8-5)/1 = 3',
  (select semanas_hasta_critico from v_estado_neumaticos where vehiculo_id=1 and posicion=2), 3.00);
select test.eq('tasa null con una sola medición (pos3)',
  (select tasa_mm_semana from v_estado_neumaticos where vehiculo_id=1 and posicion=3), null::numeric);
select test.eq('tasa null con 2 mediciones en la misma fecha (pos5)',
  (select tasa_mm_semana from v_estado_neumaticos where vehiculo_id=1 and posicion=5), null::numeric);
select test.eq('semanas null si no hay tasa',
  (select semanas_hasta_critico from v_estado_neumaticos where vehiculo_id=1 and posicion=3), null::numeric);
select test.eq('medición de hace 100 días queda fuera de la ventana de 90 (pos8: 1 medición)',
  (select n_mediciones_90d from v_estado_neumaticos where vehiculo_id=1 and posicion=8), 1::bigint);
select test.eq('pos8 tasa null (solo 1 medición en ventana)',
  (select tasa_mm_semana from v_estado_neumaticos where vehiculo_id=1 and posicion=8), null::numeric);
select test.eq('v_ultima_medicion pos1 toma la más reciente (promedio 10)',
  (select promedio from v_ultima_medicion where vehiculo_id=1 and posicion=1), 10.00);
select test.eq('v_ultima_medicion trae odómetro de la última',
  (select odometro_km from v_ultima_medicion where vehiculo_id=1 and posicion=1), 11000);
select test.eq('v_ultima_medicion: una fila por (vehículo,posición)',
  (select count(*) from (select 1 from v_ultima_medicion group by vehiculo_id, posicion having count(*)>1) x), 0::bigint);
select test.eq('v_ultima_medicion excluye mediciones sin vehículo',
  (select count(*) from v_ultima_medicion where vehiculo_id is null), 0::bigint);

-- Desgaste irregular (umbral estricto >)
select test.eq('dif 2.0 con umbral 2.0 => NO irregular (pos5)',
  (select desgaste_irregular from v_estado_neumaticos where vehiculo_id=1 and posicion=5), false);
select test.eq('dif 2.1 => irregular (pos6)',
  (select desgaste_irregular from v_estado_neumaticos where vehiculo_id=1 and posicion=6), true);
select test.eq('irregularidad por cliente: B pos3 dif 1.3 > 1.0',
  (select desgaste_irregular from v_estado_neumaticos where vehiculo_id=3 and posicion=3), true);

-- Alertas por tipo (cliente A)
select test.eq('A: alertas critico', (select count(*) from v_alertas where cliente_id=1 and tipo='critico'), 1::bigint);
select test.eq('A: alerta critico es pos4 sev 3',
  (select posicion::int*10 + severidad from v_alertas where cliente_id=1 and tipo='critico'), 43);
select test.eq('A: alertas bajo (pos3)', (select posicion from v_alertas where cliente_id=1 and tipo='bajo'), 3::smallint);
select test.eq('A: cruza_critico_pronto solo pos2 (3 sem); pos1 con 5 sem no',
  (select array_agg(posicion order by posicion) from v_alertas where cliente_id=1 and tipo='cruza_critico_pronto'), array[2::smallint]);
select test.eq('A: cruza_critico_pronto valor = 3 semanas',
  (select valor from v_alertas where cliente_id=1 and tipo='cruza_critico_pronto'), 3.00);
select test.eq('A: desgaste_irregular solo pos6',
  (select array_agg(posicion) from v_alertas where cliente_id=1 and tipo='desgaste_irregular'), array[6::smallint]);
select test.eq('A: sin_medir = pos7 (nunca), pos8 (40 d), V2 pos3 (31 d)',
  (select array_agg(vehiculo_id::text||'/'||posicion order by vehiculo_id, posicion) from v_alertas where cliente_id=1 and tipo='sin_medir'),
  array['1/7','1/8','2/3']);
select test.eq('A: sin_medir de pos7 sin valor (nunca medido)',
  (select valor from v_alertas where cliente_id=1 and tipo='sin_medir' and posicion=7), null::numeric);
select test.eq('A: sin_medir V2 pos2 (8 d) NO alerta',
  (select count(*) from v_alertas where vehiculo_id=2 and posicion=2), 0::bigint);
select test.eq('A: total alertas = 7', (select count(*) from v_alertas where cliente_id=1), 7::bigint);
select test.eq('B: alertas bajo/critico/irregular (sin sin_medir)',
  (select array_agg(tipo order by tipo) from v_alertas where cliente_id=2), array['bajo','critico','desgaste_irregular']);
select test.eq('alertas: mensaje no vacío y severidad 1..3',
  (select count(*) from v_alertas where mensaje is null or mensaje = '' or severidad not between 1 and 3), 0::bigint);

-- Resumen de flota
select test.eq('resumen A: vehículos activos', (select n_vehiculos_activos from v_resumen_flota_cliente where cliente_id=1), 2::bigint);
select test.eq('resumen A: ok/bajo/critico/sin_datos',
  (select array[n_ok,n_bajo,n_critico,n_sin_datos] from v_resumen_flota_cliente where cliente_id=1), array[8::bigint,1,1,1]);
select test.eq('resumen A: con datos', (select n_neumaticos_con_datos from v_resumen_flota_cliente where cliente_id=1), 10::bigint);
select test.eq('resumen A: alertas por severidad 1/2/3',
  (select array[n_alertas_sev1,n_alertas_sev2,n_alertas_sev3] from v_resumen_flota_cliente where cliente_id=1), array[3::bigint,3,1]);
select test.eq('resumen B: ok/bajo/critico',
  (select array[n_ok,n_bajo,n_critico] from v_resumen_flota_cliente where cliente_id=2), array[1::bigint,1,1]);
select test.eq('resumen A: última medición no nula',
  (select ultima_medicion_at is not null from v_resumen_flota_cliente where cliente_id=1), true);

-- Salud de dispositivos
select test.eq('dispositivo d1 (1 d) activo', (select estado from v_salud_dispositivos where nombre='d1'), 'activo');
select test.eq('dispositivo d2 (8 d) sin_actividad', (select estado from v_salud_dispositivos where nombre='d2'), 'sin_actividad');
select test.eq('dispositivo d3 (31 d) caido', (select estado from v_salud_dispositivos where nombre='d3'), 'caido');
select test.eq('dispositivo d4 nunca', (select estado from v_salud_dispositivos where nombre='d4 nunca'), 'nunca');
select test.eq('dispositivo d4: 0 mediciones y días null',
  (select total_mediciones::text || coalesce(dias_sin_actividad::text,'-') from v_salud_dispositivos where nombre='d4 nunca'), '0-');
select test.eq('dispositivo d2: dias_sin_actividad = 8', (select dias_sin_actividad from v_salud_dispositivos where nombre='d2'), 8);
select test.eq('dispositivo d1: total_mediciones', (select total_mediciones from v_salud_dispositivos where nombre='d1'), 1::bigint);

-- Odómetro y umbrales: restricciones
select test.denied('odómetro negativo en vehículos', $$update public.vehiculos set odometro_km=-5 where id=1$$, '23514');
select test.denied('umbrales incoherentes (retiro >= crítico)',
  $$update public.clientes set umbral_retiro_mm=6 where id=1$$, '23514');
select test.denied('umbrales incoherentes (crítico >= bajo)',
  $$update public.clientes set umbral_critico_mm=9 where id=1$$, '23514');
select test.denied('neumático vida 4', $$update public.neumaticos set vida=4 where id=1$$, '23514');
select test.denied('neumático estado inválido', $$update public.neumaticos set estado='perdido' where id=1$$, '23514');
rollback;
