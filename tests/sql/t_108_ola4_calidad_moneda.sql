-- Ola 4 de F8 (migración 20261126050000_calidad_moneda.sql):
--   1. función pura medicion_evaluar_calidad con la regla de caída brusca (umbral, evento entre, motivos unidos);
--   2. trigger con la referencia de caída (previa VÁLIDA de la misma cubierta, evento entre, umbral por cliente, cadena);
--   3. medicion_corregir: valores, errores, idempotencia, auditoría y matriz de roles;
--   4. moneda por defecto: costo_registrar, recauchutado_aceptar y cliente_fijar_moneda;
--   5. alerta_configurar con p_caida_brusca_mm;
--   6. visibilidad de caida_brusca_mm y moneda_default (privilegios por columna).
-- Cliente 1 con caida_brusca_mm 5 salvo donde se indica. Vehículo 1081 (sucursal 1081), uuids c1080000-...
-- Todo en una transacción que se revierte.
begin;

insert into auth.users (id, email) values
  ('c1080000-0000-0000-0000-000000000001', 's108a@t'),
  ('c1080000-0000-0000-0000-000000000002', 's108b@t');
insert into public.sucursales (id, cliente_id, nombre) overriding system value values
  (1081, 1, 'Suc108 A'), (1082, 1, 'Suc108 B');
insert into public.perfiles (user_id, rol, cliente_id, sucursal_id) values
  ('c1080000-0000-0000-0000-000000000001', 'cliente', 1, 1081),
  ('c1080000-0000-0000-0000-000000000002', 'cliente', 1, 1082);
create or replace function test.u108_s1() returns uuid language sql immutable as $$ select 'c1080000-0000-0000-0000-000000000001'::uuid $$;
create or replace function test.u108_s2() returns uuid language sql immutable as $$ select 'c1080000-0000-0000-0000-000000000002'::uuid $$;
grant execute on function test.u108_s1(), test.u108_s2() to public;

insert into public.vehiculos (id, cliente_id, nombre, patente, activo, tipo_ruedas, sucursal_id, distribucion) values
  (1081, 1, 'V108', 'TT1081', true, 10, 1081, '4x2');
insert into public.neumaticos (vehiculo_id, cliente_id, posicion, idneumatico, estado, marca)
  select 1081, 1, p, 'C108-' || p, 'montado', 'T' from generate_series(1, 13) p;
-- Cubierta en stock de la sucursal 1081 para el recauchutado (sin vehículo, como en t_91).
insert into public.neumaticos (vehiculo_id, cliente_id, posicion, idneumatico, estado, marca, sucursal_id)
  values (null, 1, null, 'C108-14', 'almacenado', 'T', 1081);

-- Proceso de recauchutado abierto o último de la cubierta (SECURITY DEFINER como en t_91).
create or replace function test.pid108(p_neum bigint) returns bigint language sql stable security definer set search_path = '' as $$
  select id from public.recauchutados where neumatico_id = p_neum order by id desc limit 1 $$;
grant execute on function test.pid108(bigint) to public;
-- Id de la última medición de una cubierta, sin RLS: la autorización de medicion_corregir es la que decide.
create or replace function test.m108(p_idn text) returns bigint language sql stable security definer set search_path = '' as $$ select max(id) from public.mediciones where idneumatico = p_idn $$;
grant execute on function test.m108(text) to public;

-- med(vehículo, cliente, posición, idneumatico, horas atrás, mm1, mm2, mm3, odómetro) -> id de la medición.
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
-- ev(vehículo, posición, tipo, horas atrás): evento sobre la cubierta que ocupa esa posición.
create function pg_temp.ev(p_veh bigint, p_pos int, p_tipo text, p_horas numeric) returns void language sql as $$
  insert into public.eventos_neumatico (cliente_id, vehiculo_id, neumatico_id, idneumatico, tipo, posicion_origen, posicion_destino, created_at)
  select n.cliente_id, n.vehiculo_id, n.id, n.idneumatico, p_tipo, p_pos, p_pos, now() - p_horas * interval '1 hour'
    from public.neumaticos n where n.vehiculo_id = p_veh and n.posicion = p_pos
$$;

-- ---------------------------------------------------------------------------------------------
-- 1. Función pura
-- ---------------------------------------------------------------------------------------------
select test.eq('1: caída de exactamente 5,0 mm (umbral 5) es sospechosa, con coma decimal',
  (select estado || '|' || motivo from public.medicion_evaluar_calidad(5.0, 6, 7, p_prev_minimo => 10)),
  'sospechosa|Caída brusca de 5,0 mm desde la medición anterior');
select test.eq('1: caída de 4,9 mm es válida',
  (select estado || '|' || coalesce(motivo, 'NULL') from public.medicion_evaluar_calidad(5.1, 6, 7, p_prev_minimo => 10)),
  'valida|NULL');
select test.eq('1: con evento entre (reencauche, reparación o montaje) no hay caída',
  (select estado || '|' || coalesce(motivo, 'NULL') from public.medicion_evaluar_calidad(4.0, 6, 7, p_prev_minimo => 10, p_evento_entre => true)),
  'valida|NULL');
select test.eq('1: sin medición previa válida no hay caída',
  (select estado || '|' || coalesce(motivo, 'NULL') from public.medicion_evaluar_calidad(5.0, 6, 7, p_prev_minimo => null)),
  'valida|NULL');
select test.eq('1: umbral 3 (por cliente): caída de 5 es sospechosa',
  (select estado from public.medicion_evaluar_calidad(5.0, 6, 7, p_prev_minimo => 8, p_caida_brusca_mm => 3)), 'sospechosa');
select test.eq('1: umbral 3: caída de 2,9 es válida',
  (select estado from public.medicion_evaluar_calidad(5.1, 6, 7, p_prev_minimo => 8, p_caida_brusca_mm => 3)), 'valida');
select test.eq('1: la caída se suma a la huella absurda con «; »',
  (select motivo from public.medicion_evaluar_calidad(5, 16, 16, p_prev_minimo => 10)),
  'Diferencia entre huellas de 11 mm (máx. 10 mm); Caída brusca de 5,0 mm desde la medición anterior');

-- ---------------------------------------------------------------------------------------------
-- 2. Trigger: referencia de caída = última medición VÁLIDA de la misma cubierta (vehículo + posición)
-- ---------------------------------------------------------------------------------------------
-- Pos 1: previa válida 10 y lectura 5,0 de caída: sospechosa, auditada por el sistema.
select pg_temp.med(1081, 1, 1, 'C108-1', 80, 10, 10, 10) as p1a \gset
select pg_temp.med(1081, 1, 1, 'C108-1', 60, 5, 9, 9) as p1b \gset
select test.eq('2: caída de 5,0 mm desde una previa válida es sospechosa',
  pg_temp.cal(:p1b), 'sospechosa');
select test.eq('2: el motivo dice la caída con coma decimal',
  pg_temp.mot(:p1b), 'Caída brusca de 5,0 mm desde la medición anterior');
select test.eq('2: la caída la marca el sistema y deja auditoría',
  (select calidad_por || '|' || (select count(*) from public.audit_log where accion = 'CALIDAD_DETECTADA' and entidad_id = :'p1b'::text)::text
     from public.mediciones where id = :p1b), 'sistema|1');

-- Pos 2: cadena. La sospechosa no cambia la referencia: sigue siendo la válida 10.
select pg_temp.med(1081, 1, 2, 'C108-2', 80, 10, 10, 10) as p2a \gset
select pg_temp.med(1081, 1, 2, 'C108-2', 70, 5, 9, 9) as p2b \gset
select pg_temp.med(1081, 1, 2, 'C108-2', 60, 5.0, 5.5, 6.0) as p2c \gset
select test.eq('2: cadena: la referencia sigue siendo la válida (10), así que 5,0 también es caída',
  pg_temp.cal(:p2c) || '|' || pg_temp.mot(:p2c), 'sospechosa|Caída brusca de 5,0 mm desde la medición anterior');

-- Pos 3: caída de 4,9 mm: válida.
select pg_temp.med(1081, 1, 3, 'C108-3', 80, 10, 10, 10) as p3a \gset
select pg_temp.med(1081, 1, 3, 'C108-3', 60, 5.1, 6, 7) as p3b \gset
select test.eq('2: caída de 4,9 mm desde la válida es válida', pg_temp.cal(:p3b), 'valida');

-- Pos 4: previa invalidada (10) y válida anterior (9): la referencia es la válida (9); caída de 4 = válida.
select pg_temp.med(1081, 1, 4, 'C108-4', 100, 9, 9, 9) as p4a \gset
select pg_temp.med(1081, 1, 4, 'C108-4', 80, 10, 10, 10) as p4b \gset
update public.mediciones set calidad = 'invalidada', calidad_motivo = 'prueba' where id = :p4b;
select pg_temp.med(1081, 1, 4, 'C108-4', 60, 5.0, 5.5, 6.0) as p4c \gset
select test.eq('2: la referencia es la última válida (9): caída de 4 mm es válida',
  pg_temp.cal(:p4c), 'valida');

-- Pos 5: reencauche entre la previa (10) y la nueva (4): hay evento, no es caída.
select pg_temp.med(1081, 1, 5, 'C108-5', 80, 10, 10, 10) as p5a \gset
select pg_temp.ev(1081, 5, 'reencauche', 70);
select pg_temp.med(1081, 1, 5, 'C108-5', 60, 4, 4, 4) as p5b \gset
select test.eq('2: reencauche entre la previa (10) y la nueva (4): válida',
  pg_temp.cal(:p5b), 'valida');

-- Pos 6: montaje sobre la posición entre la previa (10) y la nueva (4): válida.
select pg_temp.med(1081, 1, 6, 'C108-6', 80, 10, 10, 10) as p6a \gset
select pg_temp.ev(1081, 6, 'montaje', 70);
select pg_temp.med(1081, 1, 6, 'C108-6', 60, 4, 4, 4) as p6b \gset
select test.eq('2: montaje entre la previa (10) y la nueva (4), por posición: válida',
  pg_temp.cal(:p6b), 'valida');

-- Pos 7: umbral del cliente en 8: caída de 6 es válida.
update public.clientes set caida_brusca_mm = 8 where id = 1;
select pg_temp.med(1081, 1, 7, 'C108-7', 80, 10, 10, 10) as p7a \gset
select pg_temp.med(1081, 1, 7, 'C108-7', 60, 4, 4, 4) as p7b \gset
select test.eq('2: cliente con caida_brusca_mm 8: caída de 6 es válida', pg_temp.cal(:p7b), 'valida');
update public.clientes set caida_brusca_mm = 5 where id = 1;

-- ---------------------------------------------------------------------------------------------
-- 3. medicion_corregir
-- ---------------------------------------------------------------------------------------------
-- Pos 8: sospechosa 5/9/9 con previa válida 10 (la que se corrige).
select pg_temp.med(1081, 1, 8, 'C108-8', 80, 10, 10, 10) as s8a \gset
select pg_temp.med(1081, 1, 8, 'C108-8', 50, 5, 9, 9) as s8 \gset
-- Pos 10: válida 10/10/10 corregida a mano a 9,5 (con motivo «otro» y texto).
select pg_temp.med(1081, 1, 10, 'C108-10', 60, 10, 10, 10) as a10 \gset
-- Pos 11: invalidada: no se puede corregir sin revalidar.
select pg_temp.med(1081, 1, 11, 'C108-11', 60, 10, 10, 10) as i11 \gset
update public.mediciones set calidad = 'invalidada', calidad_motivo = 'prueba' where id = :i11;
-- Pos 12: la corrige el usuario de la sucursal 1081.
select pg_temp.med(1081, 1, 12, 'C108-12', 80, 10, 10, 10) as q12a \gset
select pg_temp.med(1081, 1, 12, 'C108-12', 50, 5, 9, 9) as q12 \gset

select test.become('authenticated', test.u_cli_a());
select test.eq('3: el administrador de empresa corrige la sospechosa: cambiado true',
  (select public.medicion_corregir(:s8, 9, 9, 9, 'error_calibre') ->> 'cambiado'), 'true');
reset role;
select test.eq('3: la corrección deja la medición válida con el valor corregido',
  (select calidad || '|' || (mm1 = 9 and mm2 = 9 and mm3 = 9)::text || '|' || (promedio = 9)::text || '|'
          || (corregida_at is not null)::text || '|' || calidad_motivo
     from public.mediciones where id = :s8),
  'valida|true|true|true|Corregida: Error del calibre');
select test.eq('3: un registro CORREGIR_MEDICION con antes y después',
  (select count(*) || '|' || (max((antes ->> 'mm1')::numeric) = 5 and max((despues ->> 'mm1')::numeric) = 9)::text || '|' || max(actor_rol)
     from public.audit_log where accion = 'CORREGIR_MEDICION' and entidad_id = :'s8'::text),
  '1|true|admin_empresa');

select test.become('authenticated', test.u_cli_a());
select test.eq('3: repetir la misma corrección no escribe: cambiado false',
  (select public.medicion_corregir(:s8, 9, 9, 9, 'error_calibre') ->> 'cambiado'), 'false');
reset role;
select test.eq('3: el doble envío deja un solo registro de auditoría',
  (select count(*)::text from public.audit_log where accion = 'CORREGIR_MEDICION' and entidad_id = :'s8'::text), '1');

select test.become('authenticated', test.u_cli_a());
select test.eq('3: corregir una válida es válido (otro, con texto): cambiado true',
  (select public.medicion_corregir(:a10, 9.5, 9.5, 9.5, 'otro', 'ajuste de calibre') ->> 'cambiado'), 'true');
select test.denied('3: corregir una invalidada exige revalidarla (22023)',
  $$select public.medicion_corregir(test.m108('C108-11'), 9, 9, 9, 'error_calibre')$$, '22023');
select test.denied('3: «otro» sin texto (22023)',
  $$select public.medicion_corregir(test.m108('C108-8'), 9, 9, 9, 'otro')$$, '22023');
select test.denied('3: código inexistente (22023)',
  $$select public.medicion_corregir(test.m108('C108-8'), 9, 9, 9, 'no_existe')$$, '22023');
select test.denied('3: motivo nulo (22023)',
  $$select public.medicion_corregir(test.m108('C108-8'), 9, 9, 9, null)$$, '22023');
select test.denied('3: código de otro tipo (22023)',
  $$select public.medicion_corregir(test.m108('C108-8'), 9, 9, 9, 'desgaste_lateral')$$, '22023');
select test.denied('3: mm1 nulo (22004)',
  $$select public.medicion_corregir(test.m108('C108-8'), null, 9, 9, 'error_calibre')$$, '22004');
select test.denied('3: -0,1 mm (23514)',
  $$select public.medicion_corregir(test.m108('C108-8'), -0.1, 9, 9, 'error_calibre')$$, '23514');
select test.denied('3: 30,1 mm (23514)',
  $$select public.medicion_corregir(test.m108('C108-8'), 30.1, 9, 9, 'error_calibre')$$, '23514');
select test.denied('3: 8,25 mm: más de un decimal (22023)',
  $$select public.medicion_corregir(test.m108('C108-8'), 8.25, 9, 9, 'error_calibre')$$, '22023');
reset role;

-- Matriz de roles sobre una medición de otra sucursal, otro cliente, equipo Neumet, api, sin perfil y anon.
select test.become('authenticated', test.u_cli_b());
select test.denied('3: otro cliente no corrige (42501)',
  $$select public.medicion_corregir(test.m108('C108-8'), 9, 9, 9, 'error_calibre')$$);
select test.become('authenticated', test.u108_s2());
select test.denied('3: usuario de otra sucursal no corrige (42501)',
  $$select public.medicion_corregir(test.m108('C108-8'), 9, 9, 9, 'error_calibre')$$);
select test.become('authenticated', test.u_admin());
select test.denied('3: equipo Neumet no corrige (42501)',
  $$select public.medicion_corregir(test.m108('C108-8'), 9, 9, 9, 'error_calibre')$$);
select test.become('authenticated', test.u_api());
select test.denied('3: api no corrige (42501)',
  $$select public.medicion_corregir(test.m108('C108-8'), 9, 9, 9, 'error_calibre')$$);
select test.become('authenticated', test.u_sinperfil());
select test.denied('3: sin perfil no corrige (42501)',
  $$select public.medicion_corregir(test.m108('C108-8'), 9, 9, 9, 'error_calibre')$$);
select test.become('anon', null);
select test.denied('3: anon sin permiso de ejecución (42501)',
  $$select public.medicion_corregir(test.m108('C108-8'), 9, 9, 9, 'error_calibre')$$);

-- El usuario de la sucursal de la cubierta sí corrige su medición.
select test.become('authenticated', test.u108_s1());
select test.eq('3: usuario de la sucursal corrige una medición de su sucursal: cambiado true',
  (select public.medicion_corregir(:q12, 9, 9, 9, 'carga_manual') ->> 'cambiado'), 'true');
reset role;

-- Valor 30 es el máximo permitido (último, porque cambia la medición).
select test.become('authenticated', test.u_cli_a());
select test.eq('3: 30 mm es el máximo válido',
  (select public.medicion_corregir(:s8, 30, 30, 30, 'error_calibre') ->> 'cambiado'), 'true');
reset role;

-- ---------------------------------------------------------------------------------------------
-- 4. Moneda por defecto
-- ---------------------------------------------------------------------------------------------
select test.eq('4: cliente 1 con moneda por defecto USD', (select moneda_default from public.clientes where id = 1), 'USD');
select test.denied('4: el check rechaza una moneda en minúsculas (23514)',
  $$update public.clientes set moneda_default = 'usd' where id = 1$$, '23514');

select id as n1 from public.neumaticos where idneumatico = 'C108-1' \gset
select id as n13 from public.neumaticos where idneumatico = 'C108-14' \gset

select test.become('authenticated', test.u_cli_a());
select public.costo_registrar(:n1, 'otro', 10);
reset role;
select test.eq('4: costo sin moneda toma la del cliente (USD)',
  (select moneda from public.costos_neumatico where neumatico_id = :n1 order by id desc limit 1), 'USD');

select test.become('authenticated', test.u_cli_a());
select public.recauchutado_enviar(:n13, 'Prov 108');
select public.recauchutado_dictaminar(test.pid108(:n13), true);
select public.recauchutado_aceptar(test.pid108(:n13), 15, 'Bandag', 'BDR', 300);
reset role;
select test.eq('4: recauchutado con costo y sin moneda toma USD del cliente',
  (select moneda from public.costos_neumatico where neumatico_id = :n13 and concepto = 'recauchutado' order by id desc limit 1), 'USD');

select test.become('authenticated', test.u_cli_a());
select test.eq('4: el administrador fija la moneda con espacios y minúsculas: cambiado true',
  (select public.cliente_fijar_moneda(null, ' uyu ') ->> 'cambiado'), 'true');
select test.eq('4: repetir la misma moneda: cambiado false',
  (select public.cliente_fijar_moneda(null, 'UYU') ->> 'cambiado'), 'false');
select test.denied('4: moneda de dos letras (23514)', $$select public.cliente_fijar_moneda(null, 'US')$$, '23514');
select test.denied('4: moneda nula (23514)', $$select public.cliente_fijar_moneda(null, null)$$, '23514');
select public.costo_registrar(:n1, 'otro', 20);
select public.costo_registrar(:n1, 'otro', 5, null, null, 'eur');
reset role;
select test.eq('4: después de fijar, costo sin moneda queda en UYU',
  (select moneda from public.costos_neumatico where neumatico_id = :n1 order by id desc limit 1 offset 1), 'UYU');
select test.eq('4: con p_moneda explícita se respeta en mayúsculas',
  (select moneda from public.costos_neumatico where neumatico_id = :n1 order by id desc limit 1), 'EUR');
select test.eq('4: los costos anteriores no cambian de moneda',
  (select string_agg(moneda, ',' order by id) from public.costos_neumatico where neumatico_id = :n13 and concepto = 'recauchutado'), 'USD');
select test.eq('4: auditoría FIJAR_MONEDA una sola vez',
  (select count(*)::text || '|' || max(actor_rol) from public.audit_log where accion = 'FIJAR_MONEDA' and entidad_id = '1'), '1|admin_empresa');

-- Solo el administrador de empresa fija la moneda del propio cliente.
select test.become('authenticated', test.u108_s1());
select test.denied('4: usuario de sucursal no fija la moneda (42501)', $$select public.cliente_fijar_moneda(null, 'EUR')$$);
select test.become('authenticated', test.u_cli_b());
select test.denied('4: otro cliente no fija la moneda de este cliente (42501)', $$select public.cliente_fijar_moneda(1, 'EUR')$$);
select test.become('authenticated', test.u_admin());
select test.denied('4: equipo Neumet no fija la moneda (42501)', $$select public.cliente_fijar_moneda(1, 'EUR')$$);
select test.become('authenticated', test.u_api());
select test.denied('4: api no fija la moneda (42501)', $$select public.cliente_fijar_moneda(1, 'EUR')$$);
select test.become('authenticated', test.u_sinperfil());
select test.denied('4: sin perfil no fija la moneda (42501)', $$select public.cliente_fijar_moneda(null, 'EUR')$$);
select test.become('authenticated', test.u_cli_a());
select test.denied('4: el administrador no escribe moneda_default directamente (42501)',
  $$update public.clientes set moneda_default = 'EUR' where id = 1$$);
reset role;

-- ---------------------------------------------------------------------------------------------
-- 5. alerta_configurar con p_caida_brusca_mm
-- ---------------------------------------------------------------------------------------------
select test.become('authenticated', test.u_cli_a());
select public.alerta_configurar(1, p_caida_brusca_mm => 4);
reset role;
select test.eq('5: guarda la caída brusca de 4 mm', (select caida_brusca_mm from public.clientes where id = 1), 4::numeric);
select test.become('authenticated', test.u_cli_a());
select test.denied('5: caída de 0 (23514)', $$select public.alerta_configurar(1, p_caida_brusca_mm => 0)$$, '23514');
select test.denied('5: caída de 30,1 (23514)', $$select public.alerta_configurar(1, p_caida_brusca_mm => 30.1)$$, '23514');
select test.denied('5: caída de 4,25 admite un decimal (22023)', $$select public.alerta_configurar(1, p_caida_brusca_mm => 4.25)$$, '22023');
reset role;

-- ---------------------------------------------------------------------------------------------
-- 6. Visibilidad: caida_brusca_mm y moneda_default por privilegio de columna
-- ---------------------------------------------------------------------------------------------
select test.become('authenticated', test.u108_s1());
select test.eq('6: el usuario de sucursal ve el umbral y la moneda de su cliente',
  (select caida_brusca_mm || '|' || moneda_default from public.clientes where id = 1), '4.0|UYU');
select test.denied('6: el usuario de sucursal no lee precio_mensual (42501)', $$select precio_mensual from public.clientes where id = 1$$);
reset role;

rollback;
