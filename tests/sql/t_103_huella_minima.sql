-- Huella MÍNIMA (RN-01, RN-08, CA-01, CA-08; migración 20261126000000_huella_minima.sql).
-- El estado y la alerta se deciden con least(mm1, mm2, mm3); el promedio solo es informativo. Sin una huella,
-- minimo es NULL y no se fabrica estado ni alerta. Cliente 1 con umbrales por defecto: bajo 8, crítico 5, retiro 3,
-- histéresis 0,5. Todo en una transacción que se revierte.
begin;

insert into public.vehiculos (id, cliente_id, nombre, patente, activo, odometro_km) values
  (10301, 1, '10301', 'HM1301', true, 1000),
  (10302, 1, '10302', 'HM1302', true, 1000),
  (10303, 1, '10303', 'HM1303', true, 1000),
  (10304, 1, '10304', 'HM1304', true, 1000),
  (10305, 1, '10305', 'HM1305', true, 1000),
  (10306, 1, '10306', 'HM1306', true, 1000);
insert into public.neumaticos (vehiculo_id, cliente_id, posicion, idneumatico, estado, marca, modelo, auxilio) values
  (10301, 1, 3, 'HM-CA1',  'montado', 'M', 'X', false),
  (10302, 1, 2, 'HM-CA8',  'montado', 'M', 'X', false),
  (10303, 1, 3, 'HM-B3',   'montado', 'M', 'X', false),
  (10303, 1, 2, 'HM-B3E',  'montado', 'M', 'X', false),
  (10304, 1, 3, 'HM-B8',   'montado', 'M', 'X', false),
  (10304, 1, 2, 'HM-B8L',  'montado', 'M', 'X', false),
  (10305, 1, 3, 'HM-B6',   'montado', 'M', 'X', false),
  (10305, 1, 2, 'HM-B5',   'montado', 'M', 'X', false),
  (10305, 1, 1, 'HM-B499', 'montado', 'M', 'X', false),
  (10306, 1, 3, 'HM-NULL', 'montado', 'M', 'X', false);

-- Caso obligatorio CA-01: 2,8 / 4,0 / 4,2 (promedio 3,67) => desgaste límite, no mayor desgaste.
insert into public.mediciones (vehiculo_id, cliente_id, posicion, idneumatico, mm1, mm2, mm3, created_at) values
  (10301, 1, 3, 'HM-CA1', 2.8, 4.0, 4.2, now() - interval '2 hours');
select test.eq('CA-01: 2,8/4,0/4,2 => estado desgaste_limite (no mayor por el promedio 3,67)',
  (select estado from public.v_estado_neumaticos where idneumatico = 'HM-CA1'), 'desgaste_limite');
select test.eq('CA-01: el mínimo es 2,8 y las huellas crudas no cambian',
  (select minimo::text || '|' || mm1::text || '|' || mm2::text || '|' || mm3::text
     from public.v_estado_neumaticos where idneumatico = 'HM-CA1'), '2.80|2.80|4.00|4.20');
select test.eq('el promedio sigue expuesto como dato informativo (3,67)',
  (select promedio::text from public.v_estado_neumaticos where idneumatico = 'HM-CA1'), '3.67');
select test.eq('CA-01: abre una alerta roja límite con el mínimo como valor',
  (select a.tipo || '|' || a.mm_actual::text from public.alertas a join public.neumaticos n on n.id = a.neumatico_id
    where n.idneumatico = 'HM-CA1' and a.estado <> 'resuelta'), 'limite|2.80');
select test.eq('v_alertas muestra el mensaje con el mínimo (coherente con la decisión)',
  (select mensaje from public.v_alertas where idneumatico = 'HM-CA1'), 'Desgaste límite: 2,8 mm (umbral 3 mm)');
select test.eq('CA-01 cuenta como límite en v_estado (solo HM-CA1 en este punto)',
  (select count(*) from public.v_estado_neumaticos
    where cliente_id = 1 and idneumatico like 'HM-%' and estado = 'desgaste_limite'), 1::bigint);

-- CA-08 / franja extrema bajo retiro: 2,9 en una huella y 8 o más en las otras dos.
insert into public.mediciones (vehiculo_id, cliente_id, posicion, idneumatico, mm1, mm2, mm3, created_at) values
  (10302, 1, 2, 'HM-CA8', 8.5, 8.5, 2.9, now() - interval '2 hours');
select test.eq('CA-08: una huella de 2,9 mm y las otras de 8,5 => desgaste_limite',
  (select estado from public.v_estado_neumaticos where idneumatico = 'HM-CA8'), 'desgaste_limite');
select test.eq('CA-08: abre alerta roja límite',
  (select count(*) from public.alertas a join public.neumaticos n on n.id = a.neumatico_id
    where n.idneumatico = 'HM-CA8' and a.estado <> 'resuelta' and a.tipo = 'limite'), 1::bigint);

-- Bordes en 3 mm (retiro): 3,0 exacto no es límite; 2,99 sí.
insert into public.mediciones (vehiculo_id, cliente_id, posicion, idneumatico, mm1, mm2, mm3, created_at) values
  (10303, 1, 3, 'HM-B3',  3.0, 8.0, 8.0, now() - interval '2 hours'),
  (10303, 1, 2, 'HM-B3E', 2.99, 8.0, 8.0, now() - interval '2 hours');
select test.eq('borde 3 mm: mínimo 3,0 => mayor desgaste (retiro es < 3, no <= 3)',
  (select estado from public.v_estado_neumaticos where idneumatico = 'HM-B3'), 'mayor_desgaste');
select test.eq('borde 3 mm: mínimo 2,99 => desgaste límite',
  (select estado from public.v_estado_neumaticos where idneumatico = 'HM-B3E'), 'desgaste_limite');
-- Solo el límite: con huellas de 3,0 u 2,99 y 8 en las otras dos, la diferencia (5 mm) también abre «irregular» (default 2 mm).
select test.eq('borde 3 mm: 3,0 no abre alerta de límite; 2,99 sí',
  (select count(*) from public.alertas a join public.neumaticos n on n.id = a.neumatico_id
    where n.idneumatico in ('HM-B3', 'HM-B3E') and a.estado <> 'resuelta' and a.tipo = 'limite'), 1::bigint);

-- Bordes en 8 mm (bueno): 8,0 exacto es nuevo; 7,9 es poco desgaste.
insert into public.mediciones (vehiculo_id, cliente_id, posicion, idneumatico, mm1, mm2, mm3, created_at) values
  (10304, 1, 3, 'HM-B8', 8.0, 8.0, 8.0, now() - interval '2 hours'),
  (10304, 1, 2, 'HM-B8L', 7.9, 9.0, 9.0, now() - interval '2 hours');
select test.eq('borde 8 mm: mínimo 8,0 => nuevo',
  (select estado from public.v_estado_neumaticos where idneumatico = 'HM-B8'), 'nuevo');
select test.eq('borde 8 mm: mínimo 7,9 (promedio 8,3) => poco desgaste',
  (select estado from public.v_estado_neumaticos where idneumatico = 'HM-B8L'), 'poco_desgaste');

-- Bordes en 6 y 5 mm (crítico, por defecto 5): 6,0 poco; 5,0 poco; 4,99 mayor.
insert into public.mediciones (vehiculo_id, cliente_id, posicion, idneumatico, mm1, mm2, mm3, created_at) values
  (10305, 1, 3, 'HM-B6',   6.0, 9.0, 9.0, now() - interval '2 hours'),
  (10305, 1, 2, 'HM-B5',   5.0, 9.0, 9.0, now() - interval '2 hours'),
  (10305, 1, 1, 'HM-B499', 4.99, 9.0, 9.0, now() - interval '2 hours');
select test.eq('borde 6 mm: mínimo 6,0 => poco desgaste',
  (select estado from public.v_estado_neumaticos where idneumatico = 'HM-B6'), 'poco_desgaste');
select test.eq('borde 5 mm: mínimo 5,0 => poco desgaste (crítico es < 5)',
  (select estado from public.v_estado_neumaticos where idneumatico = 'HM-B5'), 'poco_desgaste');
select test.eq('borde 5 mm: mínimo 4,99 => mayor desgaste',
  (select estado from public.v_estado_neumaticos where idneumatico = 'HM-B499'), 'mayor_desgaste');

-- Sin medición: mínimo NULL, estado desconocido, sin alerta (no se fabrica estado).
select test.eq('sin medición: minimo NULL y estado desconocido',
  (select (minimo is null)::text || '|' || estado from public.v_estado_neumaticos where idneumatico = 'HM-NULL'),
  'true|desconocido');
select test.eq('sin medición: no abre alerta',
  (select count(*) from public.alertas a join public.neumaticos n on n.id = a.neumatico_id
    where n.idneumatico = 'HM-NULL'), 0::bigint);

-- Histéresis sobre el mínimo: abierta en 2,8; con 3,2 sigue (3,2 < 3,5); con 3,6 se resuelve.
insert into public.mediciones (vehiculo_id, cliente_id, posicion, idneumatico, mm1, mm2, mm3, created_at) values
  (10301, 1, 3, 'HM-CA1', 3.2, 4.5, 4.5, now() - interval '1 hour');
select test.eq('histéresis: con mínimo 3,2 la alerta sigue abierta',
  (select count(*) from public.alertas a join public.neumaticos n on n.id = a.neumatico_id
    where n.idneumatico = 'HM-CA1' and a.estado <> 'resuelta' and a.tipo = 'limite'), 1::bigint);
insert into public.mediciones (vehiculo_id, cliente_id, posicion, idneumatico, mm1, mm2, mm3, created_at) values
  (10301, 1, 3, 'HM-CA1', 3.6, 4.5, 4.5, now());
select test.eq('histéresis: con mínimo 3,6 (>= 3,5) la alerta se resuelve por recuperación',
  (select a.resuelta_motivo from public.alertas a join public.neumaticos n on n.id = a.neumatico_id
    where n.idneumatico = 'HM-CA1' and a.tipo = 'limite' order by a.id desc limit 1), 'recuperada');

rollback;
