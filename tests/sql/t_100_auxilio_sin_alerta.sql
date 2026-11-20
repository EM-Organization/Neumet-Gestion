-- La rueda de auxilio (neumaticos.auxilio o posición 99) no cuenta como advertencia de desgaste
-- (migración 20261125500000_auxilio_sin_alerta.sql): no abre alerta, cierra las existentes, no suma en
-- n_mayor_desgaste / n_critico de v_resumen_flota_cliente (sí en el total) y v_estado_neumaticos la sigue mostrando.
-- Todo en una transacción que se revierte.
begin;

insert into public.vehiculos (id, cliente_id, nombre, patente, activo, odometro_km) values
  (10001, 1, '10001', 'AX1000', true, 1000);
insert into public.neumaticos (vehiculo_id, cliente_id, posicion, idneumatico, estado, marca, modelo, auxilio) values
  (10001, 1, 1,  'AUX-N1', 'montado', 'M', 'X', false),
  (10001, 1, 99, 'AUX-A1', 'montado', 'M', 'X', true);

create temp table t_antes as
  select n_neumaticos_con_datos as con_datos, n_critico, n_mayor_desgaste, n_bajo, n_alertas_sev3
    from public.v_resumen_flota_cliente where cliente_id = 1;

-- Cliente 1: retiro 3,0 mm. La rueda normal queda en límite; el auxilio también (2,0 mm).
insert into public.mediciones (vehiculo_id, cliente_id, posicion, idneumatico, mm1, mm2, mm3, created_at) values
  (10001, 1, 1,  'AUX-N1', 2.8, 2.8, 2.8, now() - interval '2 hours'),
  (10001, 1, 99, 'AUX-A1', 2.0, 2.0, 2.0, now() - interval '2 hours');

select test.eq('la rueda normal en límite abre su alerta',
  (select count(*) from public.alertas a join public.neumaticos n on n.id = a.neumatico_id
    where n.idneumatico = 'AUX-N1' and a.estado <> 'resuelta'), 1::bigint);
select test.eq('el auxilio en límite NO abre alerta',
  (select count(*) from public.alertas a join public.neumaticos n on n.id = a.neumatico_id where n.idneumatico = 'AUX-A1'), 0::bigint);
select test.eq('el auxilio se sigue mostrando con su estado real en v_estado_neumaticos',
  (select estado from public.v_estado_neumaticos where idneumatico = 'AUX-A1'), 'desgaste_limite');
select test.eq('v_resumen: el límite sube en 1 (solo la rueda normal)',
  (select n_critico from public.v_resumen_flota_cliente where cliente_id = 1) - (select n_critico from t_antes), 1);
select test.eq('v_resumen: el auxilio cuenta como poco desgaste y sigue en el total',
  ((select n_bajo from public.v_resumen_flota_cliente where cliente_id = 1) - (select n_bajo from t_antes))
  || '|' || ((select n_neumaticos_con_datos from public.v_resumen_flota_cliente where cliente_id = 1) - (select con_datos from t_antes)),
  '1|2');
select test.eq('v_resumen: la alerta del auxilio no suma',
  (select n_alertas_sev3 from public.v_resumen_flota_cliente where cliente_id = 1) - (select n_alertas_sev3 from t_antes), 1);

-- Alerta preexistente del auxilio (de antes de la regla): la reevaluación la resuelve y deja de verse.
insert into public.alertas (cliente_id, vehiculo_id, neumatico_id, posicion, idneumatico, umbral_mm, mm_apertura, mm_minimo, mm_actual, ultima_medicion_at)
  select 1, 10001, n.id, 99, 'AUX-A1', 3.0, 2.0, 2.0, 2.0, now() from public.neumaticos n where n.idneumatico = 'AUX-A1';
select test.eq('alerta vieja del auxilio: no figura en v_alertas aunque siga abierta',
  (select count(*) from public.v_alertas where idneumatico = 'AUX-A1'), 0::bigint);
select public.alerta_sincronizar(1::bigint, null);
select test.eq('alerta vieja del auxilio: la reevaluación la resuelve',
  (select a.estado from public.alertas a join public.neumaticos n on n.id = a.neumatico_id where n.idneumatico = 'AUX-A1'), 'resuelta');

-- Por posición 99 aunque el indicador auxilio esté en falso.
update public.neumaticos set auxilio = false where idneumatico = 'AUX-A1';
insert into public.mediciones (vehiculo_id, cliente_id, posicion, idneumatico, mm1, mm2, mm3, created_at) values
  (10001, 1, 99, 'AUX-A1', 1.5, 1.5, 1.5, now() - interval '1 hour');
select test.eq('posición 99 sin indicador auxilio tampoco abre alerta',
  (select count(*) from public.alertas a join public.neumaticos n on n.id = a.neumatico_id
    where n.idneumatico = 'AUX-A1' and a.estado <> 'resuelta'), 0::bigint);

rollback;
