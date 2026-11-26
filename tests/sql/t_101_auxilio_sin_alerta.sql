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

-- ---------------------------------------------------------------------------------------------
-- La posición manda: rotar con el auxilio (3 <-> 99) mueve la regla con la rueda
-- ---------------------------------------------------------------------------------------------
insert into public.vehiculos (id, cliente_id, nombre, patente, activo, odometro_km) values
  (10002, 1, '10002', 'AX1002', true, 1000),
  (10003, 1, '10003', 'AX1003', true, 1000),
  (10004, 1, '10004', 'AX1004', true, 1000);
insert into public.neumaticos (vehiculo_id, cliente_id, posicion, idneumatico, estado, marca, modelo, auxilio) values
  (10002, 1, 3,  'R-RUTA', 'montado', 'M', 'X', false),
  (10002, 1, 99, 'R-AUX',  'montado', 'M', 'X', true),
  (10003, 1, 3,  'R-X',    'montado', 'M', 'X', false),
  (10003, 1, 99, 'R-Y',    'montado', 'M', 'X', true),
  (10004, 1, 1,  'R-P1',   'montado', 'M', 'X', false),
  (10004, 1, 2,  'R-P2',   'montado', 'M', 'X', false);
insert into public.mediciones (vehiculo_id, cliente_id, posicion, idneumatico, mm1, mm2, mm3, created_at) values
  (10002, 1, 3,  'R-RUTA', 6.0, 6.0, 6.0, now() - interval '5 hours'),
  (10002, 1, 99, 'R-AUX',  2.0, 2.0, 2.0, now() - interval '5 hours'),
  (10003, 1, 3,  'R-X',    2.0, 2.0, 2.0, now() - interval '5 hours'),
  (10003, 1, 99, 'R-Y',    6.0, 6.0, 6.0, now() - interval '5 hours'),
  (10004, 1, 1,  'R-P1',   2.0, 2.0, 2.0, now() - interval '5 hours'),
  (10004, 1, 2,  'R-P2',   6.0, 6.0, 6.0, now() - interval '5 hours');
create or replace function test.abiertas100(p_idn text) returns bigint language sql as $$
  select count(*) from public.alertas a join public.neumaticos n on n.id = a.neumatico_id
   where n.idneumatico = p_idn and a.estado <> 'resuelta' $$;
-- Los triggers de alertas son diferidos: se vacían aquí para que la aserción lea el estado ya sincronizado.
set constraints all immediate;
set constraints all deferred;
select test.eq('A: el auxilio en 99 (2,0 mm) no tiene alerta; la rueda de ruta sana tampoco',
  test.abiertas100('R-AUX') || '|' || test.abiertas100('R-RUTA'), '0|0');
create temp table t_pre as
  select n_critico, n_alertas_sev3 from public.v_resumen_flota_cliente where cliente_id = 1;
grant select on t_pre to public;

select test.become('authenticated', test.u_cli_a());
select public.neumatico_rotar(10002::bigint, 3::smallint, 99::smallint, p_motivo_codigo => 'diferencia_huellas') as rot \gset
reset role;
select test.eq('A: tras rotar 3<->99, el indicador auxilio sigue a la posición',
  (select string_agg(idneumatico || '@' || posicion || ':' || auxilio, ',' order by idneumatico)
     from public.neumaticos where vehiculo_id = 10002), 'R-AUX@3:false,R-RUTA@99:true');
-- La rotación encola sus triggers diferidos: se vacían antes de leer la alerta (y se vuelve al modo diferido).
set constraints all immediate;
set constraints all deferred;
select test.eq('A: la rueda que pasó a la posición 3 (2,0 mm) abre alerta; la que pasó a 99 no',
  test.abiertas100('R-AUX') || '|' || test.abiertas100('R-RUTA'), '1|0');
select test.eq('A: v_alertas ve la alerta de R-AUX en la posición 3',
  (select string_agg(idneumatico || '@' || posicion, ',') from public.v_alertas where vehiculo_id = 10002), 'R-AUX@3');
select test.eq('A: v_resumen_flota_cliente coincide: el límite sube en 1 y la alerta sev3 en 1',
  ((select n_critico from public.v_resumen_flota_cliente where cliente_id = 1) - (select n_critico from t_pre))
  || '|' || ((select n_alertas_sev3 from public.v_resumen_flota_cliente where cliente_id = 1) - (select n_alertas_sev3 from t_pre)),
  '1|1');
-- Medir la rueda en la posición 3 sigue alertando (en la rama sin el arreglo no lo hacía)
insert into public.mediciones (vehiculo_id, cliente_id, posicion, idneumatico, mm1, mm2, mm3, created_at) values
  (10002, 1, 3, 'R-AUX', 1.9, 1.9, 1.9, now() - interval '1 hour');
select test.eq('A: medir R-AUX en la posición 3 mantiene la alerta con el valor nuevo',
  (select mm_actual from public.alertas a join public.neumaticos n on n.id = a.neumatico_id
    where n.idneumatico = 'R-AUX' and a.estado <> 'resuelta'), 1.9::numeric);

-- Inverso: una rueda de ruta con alerta abierta que pasa a 99 la cierra; al volver a la ruta se reevalúa
select test.eq('B: R-X (2,0 mm) en la posición 3 tiene alerta abierta', test.abiertas100('R-X'), 1::bigint);
select test.become('authenticated', test.u_cli_a());
select public.neumatico_rotar(10003::bigint, 3::smallint, 99::smallint, p_motivo_codigo => 'diferencia_huellas') as rot \gset
reset role;
-- La rotación encola sus triggers diferidos: se vacían antes de leer (y se vuelve al modo diferido).
set constraints all immediate;
set constraints all deferred;
select test.eq('B: R-X en 99 queda sin alerta abierta y fuera de v_alertas',
  test.abiertas100('R-X') || '|' || (select count(*) from public.v_alertas where vehiculo_id = 10003), '0|0');
select test.become('authenticated', test.u_cli_a());
select public.neumatico_rotar(10003::bigint, 3::smallint, 99::smallint, p_motivo_codigo => 'diferencia_huellas') as rot \gset
reset role;
-- La rotación encola sus triggers diferidos: se vacían antes de leer (y se vuelve al modo diferido).
set constraints all immediate;
set constraints all deferred;
select test.eq('B: al volver R-X a la ruta (posición 3) la alerta se reevalúa y vuelve a abrirse',
  test.abiertas100('R-X') || '|' || (select count(*) from public.v_alertas where vehiculo_id = 10003), '1|1');

-- C: el aparcamiento transitorio de rotar (vehículo sin rueda en 99) no cierra ni duplica la alerta
create temp table t_c as select a.id, a.veces_reabierta from public.alertas a join public.neumaticos n on n.id = a.neumatico_id
  where n.idneumatico = 'R-P1' and a.estado <> 'resuelta';
grant select on t_c to public;
select test.eq('C: R-P1 (2,0 mm) tiene su alerta', (select count(*) from t_c), 1::bigint);
select test.become('authenticated', test.u_cli_a());
select public.neumatico_rotar(10004::bigint, 1::smallint, 2::smallint, p_motivo_codigo => 'diferencia_huellas') as rot \gset
reset role;
-- La rotación encola sus triggers diferidos: se vacían antes de leer (y se vuelve al modo diferido).
set constraints all immediate;
set constraints all deferred;
select test.eq('C: rotar 1<->2 conserva la misma alerta abierta, sin cierres ni reaperturas en falso',
  (select count(*) from public.alertas a join public.neumaticos n on n.id = a.neumatico_id
    where n.idneumatico = 'R-P1' and a.estado <> 'resuelta' and a.id = (select id from t_c) and a.veces_reabierta = (select veces_reabierta from t_c)),
  1::bigint);
select test.eq('C: ninguna alerta de R-P1 quedó resuelta',
  (select count(*) from public.alertas a join public.neumaticos n on n.id = a.neumatico_id
    where n.idneumatico = 'R-P1' and a.estado = 'resuelta'), 0::bigint);
select test.eq('C: R-P1 quedó en la posición 2, sin auxilio', (select posicion || ':' || auxilio from public.neumaticos where idneumatico = 'R-P1'), '2:false');

rollback;
