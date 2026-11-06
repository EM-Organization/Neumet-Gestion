-- Datos de prueba (relativos a now() de esta transacción; las tasas dependen
-- solo de diferencias entre fechas, por lo que son deterministas).
begin;
insert into auth.users (id, email) values
  (test.u_admin(), 'admin@t'), (test.u_cli_a(), 'a@t'), (test.u_cli_b(), 'b@t'),
  (test.u_api(), 'api@t'), (test.u_sinperfil(), 'x@t');

-- Cliente A: umbrales por defecto. Cliente B: umbrales propios.
insert into public.clientes (id, nombre, auth_user_id) values (1, 'Cliente A', test.u_cli_a());
insert into public.clientes (id, nombre, auth_user_id, umbral_bajo_mm, umbral_critico_mm, umbral_retiro_mm,
                             dias_sin_medir_alerta, irregularidad_mm)
  values (2, 'Cliente B', test.u_cli_b(), 10, 6, 4, 10, 1.0);
insert into public.perfiles (user_id, rol) values (test.u_admin(), 'admin');
insert into public.perfiles (user_id, rol, cliente_id) values (test.u_api(), 'api', 1);

insert into public.vehiculos (id, cliente_id, nombre, patente, activo) values
  (1, 1, 'Bus 1', 'AA1111', true),
  (2, 1, 'Bus 2', 'BB2222', true),
  (3, 2, 'Camion B', 'CC3333', true),
  (4, 1, 'Bus inactivo', 'DD4444', false);

insert into public.neumaticos (vehiculo_id, cliente_id, posicion, idneumatico, estado) values
  (1,1,1,'T-1-1','montado'), (1,1,2,'T-1-2','montado'), (1,1,3,'T-1-3','montado'),
  (1,1,4,'T-1-4','montado'), (1,1,5,'T-1-5','montado'), (1,1,6,'T-1-6','montado'),
  (1,1,7,'T-1-7','montado'), (1,1,8,'T-1-8','montado'), (1,1,9,'T-1-9','baja'),
  (3,2,1,'T-3-1','montado'), (3,2,2,'T-3-2','montado'), (3,2,3,'T-3-3','montado');

-- mediciones: (veh, cli, pos, dias_atras, mm1, mm2, mm3, device, odometro)
create temp table _m (veh bigint, cli bigint, pos smallint, dias numeric, a numeric, b numeric, c numeric, dev text, odo int);
insert into _m values
  -- V1 pos1: 12,11,10 cada 7 días => 1.0 mm/sem; crítico en 5 sem; retiro en 7
  (1,1,1,14,12,12,12,null,10000),(1,1,1,7,11,11,11,null,10500),(1,1,1,0,10,10,10,null,11000),
  -- V1 pos2: promedio exacto 8.0 (ok), 1 mm/sem => crítico en 3 sem
  (1,1,2,7,9,9,9,null,null),(1,1,2,0,8,8,8,null,null),
  -- V1 pos3: 5.0 exacto (bajo)
  (1,1,3,1,5,5,5,null,null),
  -- V1 pos4: 4.99 (crítico)
  (1,1,4,1,4.99,4.99,4.99,null,null),
  -- V1 pos5: dif exacta 2.0 (NO irregular); dos filas idénticas misma fecha => tasa null
  (1,1,5,2,10,8,9,null,null),(1,1,5,2,10,8,9,null,null),
  -- V1 pos6: dif 2.1 (irregular)
  (1,1,6,1,10.1,8,9,null,null),
  -- V1 pos7: sin mediciones (neumático montado)
  -- V1 pos8: 40 días (sin_medir) y otra de 100 días (fuera de la ventana de 90)
  (1,1,8,40,10,10,10,null,null),(1,1,8,100,14,14,14,null,null),
  -- V1 pos9: neumático en baja => excluido
  (1,1,9,1,3,3,3,null,null),
  -- V2 (sin filas en neumaticos): dispositivos con distinta actividad
  (2,1,1,1,20,20,20,'AA:BB:CC:00:00:01',null),
  (2,1,2,8,20,20,20,'AA:BB:CC:00:00:02',null),
  (2,1,3,31,20,20,20,'AA:BB:CC:00:00:03',null),
  -- V4 inactivo: no debe aparecer
  (4,1,1,1,2,2,2,null,null),
  -- Cliente B (umbrales 10/6/4, irregularidad 1.0, 10 días)
  (3,2,1,1,9,9,9,'AA:BB:CC:00:00:05',null),            -- bajo (<10)
  (3,2,2,1,5.5,5.5,5.5,null,null),                     -- crítico (<6)
  (3,2,3,1,10.5,11.8,10.5,null,null);                  -- ok + irregular (1.3 > 1.0)
insert into public.mediciones (vehiculo_id, cliente_id, posicion, mm1, mm2, mm3, device_id, odometro_km, created_at)
  select veh, cli, pos, a, b, c, dev, odo, now() - dias * interval '24 hours' from _m;
-- medición device-first sin vehículo ni cliente
insert into public.mediciones (device_id, posicion, mm1, mm2, mm3, created_at)
  values ('AA:BB:CC:00:00:99', 1, 7, 7, 7, now());

insert into public.dispositivos (mac_address, nombre, cliente_id) values
  ('AA:BB:CC:00:00:01','d1',1),('AA:BB:CC:00:00:02','d2',1),('AA:BB:CC:00:00:03','d3',1),
  ('AA:BB:CC:00:00:04','d4 nunca',1),('AA:BB:CC:00:00:05','d5',2);

insert into public.eventos_neumatico (cliente_id, vehiculo_id, neumatico_id, idneumatico, tipo, odometro_km, costo) values
  (1, 1, (select id from public.neumaticos where idneumatico='T-1-1'), 'T-1-1', 'montaje', 10000, 350.00),
  (1, 1, (select id from public.neumaticos where idneumatico='T-1-2'), 'T-1-2', 'reparacion', 10200, 20.50),
  (2, 3, (select id from public.neumaticos where idneumatico='T-3-1'), 'T-3-1', 'montaje', 500, 400.00);

insert into public.gastos (nombre, monto) values ('secreto', 100);
commit;
