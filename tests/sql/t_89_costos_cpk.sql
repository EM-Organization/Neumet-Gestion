-- Costos por cubierta y CPK (hoja de ruta F4): tabla costos_neumatico, RPC costo_registrar / costo_eliminar,
-- v_costo_cubierta (sin doble conteo entre compra, eventos y entradas manuales; moneda mixta -> NULL; CPK NULL sin
-- km confiables o con km cero) y cpk_por_grupo (ponderado, muestra baja, cohorte por fecha), con la matriz de roles:
-- admin, cliente global, otro cliente, perfil de sucursal (NO ve costos), api, sin perfil y anon.
-- Todo en una transacción que se revierte.
begin;

insert into auth.users (id, email) values ('a0000000-0000-0000-0000-0000000000c8', 'c89n@t');
insert into public.sucursales (id, cliente_id, nombre) overriding system value values
  (891, 1, 'Costos Norte'), (892, 1, 'Costos Sur');
insert into public.perfiles (user_id, rol, cliente_id, sucursal_id)
  values ('a0000000-0000-0000-0000-0000000000c8', 'cliente', 1, 891);
create or replace function test.u_c89n() returns uuid language sql immutable as $$ select 'a0000000-0000-0000-0000-0000000000c8'::uuid $$;

insert into public.vehiculos (id, cliente_id, sucursal_id, nombre, patente, activo, odometro_km) values
  (891, 1, 891, 'C891', 'CC8910', true, 20000),
  (892, 2, null, 'C892', 'CC8920', true, 5000),
  (893, 1, 892, 'C893', 'CC8930', true, 2000);

create or replace function test.neu89(p_idn text, p_cli bigint, p_veh bigint, p_pos smallint, p_marca text, p_modelo text,
                                      p_precio numeric, p_prev int default 0, p_fecha date default null)
returns void language sql as $$
  insert into public.neumaticos (vehiculo_id, cliente_id, posicion, idneumatico, estado, marca, modelo, precio_unidad, km_previos, fecha_compra)
  values (p_veh, p_cli, p_pos, p_idn, case when p_veh is null then 'almacenado' else 'montado' end, p_marca, p_modelo, p_precio, p_prev, p_fecha) $$;
create or replace function test.ev89(p_idn text, p_veh bigint, p_tipo text, p_odo int, p_dias numeric, p_costo numeric default null)
returns void language sql as $$
  insert into public.eventos_neumatico (cliente_id, vehiculo_id, neumatico_id, idneumatico, tipo, odometro_km, costo, created_at)
  select n.cliente_id, p_veh, n.id, n.idneumatico, p_tipo, p_odo, p_costo, now() - p_dias * interval '24 hours'
    from public.neumaticos n where n.idneumatico = p_idn $$;
create or replace function test.man89(p_idn text, p_concepto text, p_monto numeric, p_moneda text default 'UYU')
returns void language sql as $$
  insert into public.costos_neumatico (cliente_id, neumatico_id, concepto, monto, moneda)
  select n.cliente_id, n.id, p_concepto, p_monto, p_moneda from public.neumaticos n where n.idneumatico = p_idn $$;
-- costo_total | cpk | cpk_provisional | moneda_mixta | km_confiable (NULL como texto)
create or replace function test.c89(p_idn text) returns text language sql stable as $$
  select coalesce(costo_total::text, 'NULL') || '|' || coalesce(round(cpk, 6)::text, 'NULL') || '|'
         || coalesce(round(cpk_provisional, 6)::text, 'NULL') || '|' || moneda_mixta || '|' || km_confiable
    from public.v_costo_cubierta where idneumatico = p_idn $$;
create or replace function test.id89(p_idn text) returns bigint language sql stable as $$
  select id from public.neumaticos where idneumatico = p_idn $$;
grant execute on function test.neu89(text, bigint, bigint, smallint, text, text, numeric, int, date),
  test.ev89(text, bigint, text, int, numeric, numeric), test.man89(text, text, numeric, text), test.c89(text), test.id89(text) to public;

-- Vehículo 891 (Norte, odómetro 20000): montajes a 10000 -> 10000 km confiables.
-- P1: compra en precio_unidad Y repetida en el evento de montaje (no se cuenta dos veces) + reparación + manual.
select test.neu89('C89-P1', 1, 891, 1::smallint, 'Alfa', 'X', 1000);
select test.ev89('C89-P1', 891, 'montaje', 10000, 30, 1000), test.ev89('C89-P1', 891, 'reparacion', null, 20, 200);
select test.man89('C89-P1', 'recauchutado', 300);
-- P2: sin precio_unidad: la compra sale del evento de montaje
select test.neu89('C89-P2', 1, 891, 2::smallint, 'Alfa', 'X', null);
select test.ev89('C89-P2', 891, 'montaje', 10000, 30, 800);
-- P3: una entrada manual 'compra' corrige el precio_unidad
select test.neu89('C89-P3', 1, 891, 3::smallint, 'Alfa', 'X', 1000);
select test.ev89('C89-P3', 891, 'montaje', 10000, 30, 1000);
select test.man89('C89-P3', 'compra', 900);
-- P4: moneda mixta (UYU del precio + USD manual)
select test.neu89('C89-P4', 1, 891, 4::smallint, 'Alfa', 'X', 500);
select test.ev89('C89-P4', 891, 'montaje', 10000, 30);
select test.man89('C89-P4', 'montaje', 50, 'USD');
-- P5: sin ningún costo
select test.neu89('C89-P5', 1, 891, 5::smallint, 'Alfa', 'X', null);
select test.ev89('C89-P5', 891, 'montaje', 10000, 30);
-- P6: con costo pero montaje sin odómetro -> km NULL y no confiables
select test.neu89('C89-P6', 1, 891, 6::smallint, 'Alfa', 'X', 600);
select test.ev89('C89-P6', 891, 'montaje', null, 30);
-- P9: reencauche e inspección con costo (recauchutado y otro)
select test.neu89('C89-P9', 1, 891, 9::smallint, 'Alfa', 'X', 100);
select test.ev89('C89-P9', 891, 'montaje', 10000, 30, 100), test.ev89('C89-P9', 891, 'reencauche', 10000, 10, 400),
       test.ev89('C89-P9', 891, 'inspeccion', null, 9, 10);
-- P7 (stock): un tramo con dato (1000 km) y otro sin -> 1010 km no confiables: CPK provisional
select test.neu89('C89-P7', 1, null, null, 'Alfa', 'Y', 1010, 10);
select test.ev89('C89-P7', 891, 'montaje', 500, 7), test.ev89('C89-P7', 891, 'desmontaje', 1500, 6),
       test.ev89('C89-P7', 891, 'montaje', null, 5), test.ev89('C89-P7', 891, 'desmontaje', 2000, 4);
-- P8 (stock, nunca montada): 0 km con dato real -> CPK NULL (no se divide por cero)
select test.neu89('C89-P8', 1, null, null, 'Alfa', 'Y', 100, 0);
-- Beta: dos cubiertas con CPK muy distintos (B1 1000/1000 km = 1,0; B2 100/10000 km = 0,01)
select test.neu89('C89-B1', 1, 891, 7::smallint, 'Beta', 'Z', 1000, 0, date '2026-03-01');
select test.ev89('C89-B1', 891, 'montaje', 19000, 30);
select test.neu89('C89-B2', 1, 891, 8::smallint, 'Beta', 'Z', 100, 0, date '2026-03-01');
select test.ev89('C89-B2', 891, 'montaje', 10000, 30);
-- Gama: cinco cubiertas en Sur (vehículo 893, odómetro 2000, montaje a 1000): 100 / 1000 km cada una
select test.neu89('C89-G' || g, 1, 893, g::smallint, 'Gama', 'W', 100, 0, date '2025-01-10') from generate_series(1, 5) g;
select test.ev89('C89-G' || g, 893, 'montaje', 1000, 30) from generate_series(1, 5) g;
-- Eps: una cubierta en UYU y otra en USD (dos filas, nunca sumadas); Delta: solo USD
select test.neu89('C89-E1', 1, 893, 6::smallint, 'Eps', 'V', 100);
select test.ev89('C89-E1', 893, 'montaje', 1000, 30);
select test.neu89('C89-E2', 1, 893, 7::smallint, 'Eps', 'V', null);
select test.ev89('C89-E2', 893, 'montaje', 1000, 30);
select test.man89('C89-E2', 'compra', 100, 'USD');
select test.neu89('C89-D1', 1, 893, 8::smallint, 'Delta', 'U', null);
select test.ev89('C89-D1', 893, 'montaje', 1000, 30);
select test.man89('C89-D1', 'compra', 200, 'USD');
-- Otro cliente
select test.neu89('C89-X1', 2, 892, 1::smallint, 'Omega', 'O', 300);
select test.ev89('C89-X1', 892, 'montaje', 1000, 30);

create temp table _ids89 as select idneumatico idn, id from public.neumaticos where idneumatico like 'C89-%';
grant select on _ids89 to public;
create temp table _cost89 as select id from public.costos_neumatico where neumatico_id = (select id from _ids89 where idn = 'C89-P1');
grant select on _cost89 to public;

-- ---------------------------------------------------------------------------------------------
-- A. Metadatos y permisos
-- ---------------------------------------------------------------------------------------------
select test.eq('la vista es security_invoker',
  (select coalesce('security_invoker=true' = any (reloptions), false) from pg_class where oid = 'public.v_costo_cubierta'::regclass), true);
select test.eq('anon sin acceso a la vista', has_table_privilege('anon', 'public.v_costo_cubierta', 'select'), false);
select test.eq('anon sin acceso a la tabla', has_table_privilege('anon', 'public.costos_neumatico', 'select'), false);
select test.eq('authenticated solo lee la tabla (sin escritura directa)',
  has_table_privilege('authenticated', 'public.costos_neumatico', 'select')
  and not has_table_privilege('authenticated', 'public.costos_neumatico', 'insert')
  and not has_table_privilege('authenticated', 'public.costos_neumatico', 'update')
  and not has_table_privilege('authenticated', 'public.costos_neumatico', 'delete'), true);
select test.eq('la tabla tiene RLS', (select relrowsecurity from pg_class where oid = 'public.costos_neumatico'::regclass), true);
select test.eq('no hay políticas de escritura en la tabla',
  (select count(*) from pg_policies where tablename = 'costos_neumatico' and cmd <> 'SELECT'), 0::bigint);
select test.eq('RPC: security definer con search_path vacío',
  (select bool_and(prosecdef and proconfig = '{search_path=\"\"}') from pg_proc
    where oid in ('public.costo_registrar(bigint,text,numeric,date,text,text)'::regprocedure, 'public.costo_eliminar(bigint)'::regprocedure)), true);
select test.eq('anon no ejecuta las RPC ni cpk_por_grupo',
  has_function_privilege('anon', 'public.costo_registrar(bigint,text,numeric,date,text,text)', 'execute')
  or has_function_privilege('anon', 'public.costo_eliminar(bigint)', 'execute')
  or has_function_privilege('anon', 'public.cpk_por_grupo(text,date,date,bigint)', 'execute'), false);
select test.eq('la FK compuesta (neumatico_id, cliente_id) existe',
  (select count(*) from pg_constraint where conrelid = 'public.costos_neumatico'::regclass and contype = 'f'
      and pg_get_constraintdef(oid) like 'FOREIGN KEY (neumatico_id, cliente_id) REFERENCES neumaticos(id, cliente_id)%'), 1::bigint);
select test.denied('FK compuesta: costo con el cliente equivocado',
  $$insert into public.costos_neumatico (cliente_id, neumatico_id, concepto, monto) select 2, id, 'otro', 1 from pg_temp._ids89 where idn = 'C89-P1'$$, '23503');
select test.denied('moneda inválida (CHECK)', $$insert into public.costos_neumatico (cliente_id, neumatico_id, concepto, monto, moneda) select 1, id, 'otro', 1, 'usd' from pg_temp._ids89 where idn = 'C89-P1'$$, '23514');
select test.denied('monto negativo (CHECK)', $$insert into public.costos_neumatico (cliente_id, neumatico_id, concepto, monto) select 1, id, 'otro', -1 from pg_temp._ids89 where idn = 'C89-P1'$$, '23514');
select test.denied('concepto inválido (CHECK)', $$insert into public.costos_neumatico (cliente_id, neumatico_id, concepto, monto) select 1, id, 'xx', 1 from pg_temp._ids89 where idn = 'C89-P1'$$, '23514');

-- ---------------------------------------------------------------------------------------------
-- B. Sin doble conteo
-- ---------------------------------------------------------------------------------------------
-- costo_total | cpk | cpk_provisional | moneda_mixta | km_confiable
select test.eq('P1: compra en precio_unidad y en el evento de montaje cuenta una vez + reparación + recauchutado manual',
  test.c89('C89-P1'), '1500.00|0.150000|NULL|false|true');
select test.eq('P1: desglose por concepto', (select costo_por_concepto::text from public.v_costo_cubierta where idneumatico = 'C89-P1'),
  '{"compra": 1000.00, "reparacion": 200.00, "recauchutado": 300.00}');
select test.eq('P2: sin precio_unidad la compra sale del evento de montaje', test.c89('C89-P2'), '800.00|0.080000|NULL|false|true');
select test.eq('P2: desglose', (select costo_por_concepto::text from public.v_costo_cubierta where idneumatico = 'C89-P2'), '{"compra": 800.00}');
select test.eq('P3: la entrada manual de compra reemplaza al precio_unidad y al evento (no 1900 ni 2800)',
  test.c89('C89-P3'), '900.00|0.090000|NULL|false|true');
select test.eq('P9: reencauche -> recauchutado, inspección -> otro, compra una vez',
  (select costo_por_concepto::text from public.v_costo_cubierta where idneumatico = 'C89-P9'),
  '{"otro": 10.00, "compra": 100.00, "recauchutado": 400.00}');
select test.eq('P9: total', test.c89('C89-P9'), '510.00|0.051000|NULL|false|true');
select test.eq('una entrada de costo repetida entra una vez por fila (no se deduplica lo manual)',
  (select count(*) from public.costos_neumatico where neumatico_id = (select id from _ids89 where idn = 'C89-P3')), 1::bigint);

-- ---------------------------------------------------------------------------------------------
-- C. Moneda mixta, sin costos, CPK NULL
-- ---------------------------------------------------------------------------------------------
select test.eq('P4: moneda mixta -> total, desglose y CPK NULL', test.c89('C89-P4'), 'NULL|NULL|NULL|true|true');
select test.eq('P4: lista de monedas', (select monedas::text from public.v_costo_cubierta where idneumatico = 'C89-P4'), '{USD,UYU}');
select test.eq('P4: tiene costo pero sin moneda única',
  (select tiene_costo and moneda is null from public.v_costo_cubierta where idneumatico = 'C89-P4'), true);
select test.eq('P5: sin ningún costo -> tiene_costo false, total NULL (no 0)',
  (select not tiene_costo and costo_total is null and cpk is null and not moneda_mixta from public.v_costo_cubierta where idneumatico = 'C89-P5'), true);
select test.eq('P6: km no confiables y NULL -> CPK y CPK provisional NULL', test.c89('C89-P6'), '600.00|NULL|NULL|false|false');
select test.eq('P6: km_totales NULL', (select km_totales is null from public.v_costo_cubierta where idneumatico = 'C89-P6'), true);
select test.eq('P7: km con un tramo sin dato -> sin CPK final, con CPK provisional explícito (1010 / 1010)',
  test.c89('C89-P7'), '1010.00|NULL|1.000000|false|false');
select test.eq('P8: 0 km con dato real -> CPK NULL (nunca divide por cero)',
  (select km_totales = 0 and km_confiable and cpk is null and cpk_provisional is null and costo_total = 100 from public.v_costo_cubierta where idneumatico = 'C89-P8'), true);

-- ---------------------------------------------------------------------------------------------
-- D. cpk_por_grupo: agregación ponderada
-- ---------------------------------------------------------------------------------------------
select test.become('authenticated', test.u_admin());
-- Beta: (1000 + 100) / (1000 + 10000) = 0,1. El promedio de CPK individuales (1,0 y 0,01) daría 0,505.
select test.eq('Beta: CPK ponderado = suma de costos / suma de km',
  (select round(cpk, 6) from public.cpk_por_grupo('marca') where clave = 'Beta'), 0.1);
select test.eq('Beta: no es el promedio de CPK individuales',
  (select round(avg(cpk), 6) from public.v_costo_cubierta where marca = 'Beta'), 0.505);
select test.eq('Beta: n, km, costo, muestra baja (n < 5)',
  (select n_neumaticos || '|' || km_totales || '|' || costo_total || '|' || muestra_baja || '|' || moneda || '|' || n_sin_km
     from public.cpk_por_grupo('marca') where clave = 'Beta'), '2|11000|1100.00|true|UYU|0');
-- Alfa: solo entran P1, P2, P3, P9 (km confiables y costo en una moneda): 3710 / 40000. P4 (mixta), P5 (sin costo) quedan fuera.
select test.eq('Alfa: ponderado sobre cubiertas con km confiables',
  (select n_neumaticos || '|' || km_totales || '|' || costo_total || '|' || round(cpk, 6) from public.cpk_por_grupo('marca') where clave = 'Alfa'),
  '4|40000|3710.00|0.092750');
select test.eq('Alfa: las con costo pero sin km confiables o con 0 km se cuentan aparte (P6, P7, P8)',
  (select n_sin_km from public.cpk_por_grupo('marca') where clave = 'Alfa'), 3::bigint);
select test.eq('Gama: cinco cubiertas -> muestra suficiente',
  (select n_neumaticos || '|' || muestra_baja || '|' || round(cpk, 4) from public.cpk_por_grupo('marca') where clave = 'Gama'), '5|false|0.1000');
select test.eq('monedas distintas no se suman: Eps tiene una fila por moneda',
  (select string_agg(moneda || ':' || n_neumaticos || ':' || costo_total, ',' order by moneda) from public.cpk_por_grupo('marca') where clave = 'Eps'),
  'USD:1:100.00,UYU:1:100.00');
select test.eq('Delta: solo USD', (select moneda || '|' || round(cpk, 3) from public.cpk_por_grupo('marca') where clave = 'Delta'), 'USD|0.200');
select test.eq('modelo: marca + modelo (Alfa X no se mezcla con Alfa Y)',
  (select string_agg(clave || ':' || n_neumaticos, ',' order by clave) from public.cpk_por_grupo('modelo') where clave like 'Alfa%'), 'Alfa X:4,Alfa Y:0');
select test.eq('Alfa Y: sin km confiables -> n 0, CPK NULL, muestra baja',
  (select cpk is null and muestra_baja and n_neumaticos = 0 and n_sin_km = 2 from public.cpk_por_grupo('modelo') where clave = 'Alfa Y'), true);
select test.eq('sucursal: Norte (Alfa X sin P4/P5 más Beta) y Sur, con cliente_id',
  (select string_agg(clave || ':' || cliente_id || ':' || n_neumaticos, ',' order by clave) from public.cpk_por_grupo('sucursal') where moneda = 'UYU' and cliente_id = 1),
  'Costos Norte:1:6,Costos Sur:1:6,Sin sucursal:1:0');
select test.eq('sucursal: otra empresa sin sucursal aparece como «Sin sucursal» de su cliente',
  (select n_neumaticos from public.cpk_por_grupo('sucursal') where cliente_id = 2), 1::bigint);
-- Cohorte por fecha de alta (fecha de compra, o de creación si falta)
select test.eq('cohorte: desde 2026-01-01 deja fuera a Gama (2025)',
  (select count(*) from public.cpk_por_grupo('marca', date '2026-01-01', null) where clave = 'Gama'), 0::bigint);
select test.eq('cohorte: hasta 2025-12-31 deja solo a Gama',
  (select string_agg(clave, ',') from public.cpk_por_grupo('marca', null, date '2025-12-31') where clave in ('Alfa','Beta','Gama','Eps','Delta','Omega')), 'Gama');
select test.eq('cohorte: rango 2026-03-01..2026-03-01 deja solo a Beta',
  (select string_agg(clave, ',') from public.cpk_por_grupo('marca', date '2026-03-01', date '2026-03-01') where clave in ('Alfa','Beta','Gama','Eps','Delta','Omega')), 'Beta');
select test.eq('rango vacío: sin filas', (select count(*) from public.cpk_por_grupo('marca', date '2030-01-01', null) where clave in ('Alfa','Beta','Gama','Eps','Delta','Omega')), 0::bigint);
select test.eq('p_cliente_id acota al cliente (el admin no mezcla clientes)',
  (select string_agg(clave, ',' order by clave) from public.cpk_por_grupo('marca', null, null, 2) where clave in ('Alfa','Beta','Gama','Eps','Delta','Omega')), 'Omega');
select test.eq('p_cliente_id = 1 deja fuera a Omega',
  (select count(*) from public.cpk_por_grupo('marca', null, null, 1) where clave = 'Omega'), 0::bigint);
select test.denied('grupo inválido', $$select * from public.cpk_por_grupo('banda')$$, '22023');
select test.denied('grupo null', $$select * from public.cpk_por_grupo(null)$$, '22023');
select test.denied('rango invertido', $$select * from public.cpk_por_grupo('marca', date '2026-02-01', date '2026-01-01')$$, '22023');
reset role;

-- ---------------------------------------------------------------------------------------------
-- E. RPC costo_registrar y costo_eliminar
-- ---------------------------------------------------------------------------------------------
select test.become('authenticated', test.u_cli_a());
select test.eq('global registra un costo de su cliente',
  (public.costo_registrar((select id from _ids89 where idn = 'C89-P5'), 'reparacion', 250.5, current_date, 'Parche', 'UYU')->>'monto'), '250.50');
select test.eq('el costo aparece en la vista', test.c89('C89-P5'), '250.50|0.025050|NULL|false|true');
select test.eq('moneda en minúsculas se normaliza; concepto con espacios y mayúsculas también',
  (public.costo_registrar((select id from _ids89 where idn = 'C89-P5'), ' Otro ', 10, current_date + 1, null, 'uyu')->>'moneda'), 'UYU');
select test.eq('fecha por omisión: hoy',
  (public.costo_registrar((select id from _ids89 where idn = 'C89-P5'), 'montaje', 5, null)->>'fecha'), current_date::text);
select test.denied('monto negativo', $$select public.costo_registrar((select id from pg_temp._ids89 where idn = 'C89-P5'), 'otro', -1, current_date)$$, '23514');
select test.denied('monto null', $$select public.costo_registrar((select id from pg_temp._ids89 where idn = 'C89-P5'), 'otro', null, current_date)$$, '22004');
select test.denied('monto fuera de rango', $$select public.costo_registrar((select id from pg_temp._ids89 where idn = 'C89-P5'), 'otro', 100000000000, current_date)$$, '22003');
select test.denied('monto NaN', $$select public.costo_registrar((select id from pg_temp._ids89 where idn = 'C89-P5'), 'otro', 'NaN'::numeric, current_date)$$, '23514');
select test.denied('moneda de 2 letras', $$select public.costo_registrar((select id from pg_temp._ids89 where idn = 'C89-P5'), 'otro', 1, current_date, null, 'US')$$, '23514');
select test.denied('moneda con dígitos', $$select public.costo_registrar((select id from pg_temp._ids89 where idn = 'C89-P5'), 'otro', 1, current_date, null, 'U5D')$$, '23514');
select test.denied('fecha futura (más de un día)', $$select public.costo_registrar((select id from pg_temp._ids89 where idn = 'C89-P5'), 'otro', 1, current_date + 2)$$, '23514');
select test.denied('fecha anterior a 2000', $$select public.costo_registrar((select id from pg_temp._ids89 where idn = 'C89-P5'), 'otro', 1, date '1999-12-31')$$, '23514');
select test.denied('concepto inválido', $$select public.costo_registrar((select id from pg_temp._ids89 where idn = 'C89-P5'), 'regalo', 1, current_date)$$, '23514');
select test.denied('concepto null', $$select public.costo_registrar((select id from pg_temp._ids89 where idn = 'C89-P5'), null, 1, current_date)$$, '23514');
select test.denied('notas de más de 500 caracteres', $$select public.costo_registrar((select id from pg_temp._ids89 where idn = 'C89-P5'), 'otro', 1, current_date, repeat('x', 501))$$, '23514');
select test.denied('cubierta de otro cliente: 42501', $$select public.costo_registrar((select id from pg_temp._ids89 where idn = 'C89-X1'), 'otro', 1, current_date)$$, '42501');
select test.denied('cubierta inexistente: 42501 uniforme', $$select public.costo_registrar(999999, 'otro', 1, current_date)$$, '42501');
select test.denied('id null: 42501 uniforme', $$select public.costo_registrar(null, 'otro', 1, current_date)$$, '42501');
select test.denied('sin escritura directa (insert)', $$insert into public.costos_neumatico (cliente_id, neumatico_id, concepto, monto) values (1, 1, 'otro', 1)$$, '42501');
select test.denied('sin escritura directa (update)', $$update public.costos_neumatico set monto = 1$$, '42501');
select test.denied('sin escritura directa (delete)', $$delete from public.costos_neumatico$$, '42501');
reset role;
select test.eq('lo rechazado no dejó filas (solo las 3 válidas en P5)',
  (select count(*) from public.costos_neumatico where neumatico_id = (select id from _ids89 where idn = 'C89-P5')), 3::bigint);
select test.eq('el monto se guardó redondeado a 2 decimales',
  (select monto from public.costos_neumatico where neumatico_id = (select id from _ids89 where idn = 'C89-P5') and concepto = 'reparacion'), 250.50);
select test.eq('created_by = quien registró',
  (select count(*) from public.costos_neumatico where neumatico_id = (select id from _ids89 where idn = 'C89-P5') and created_by = test.u_cli_a()), 3::bigint);
select test.eq('auditoría: INSERT con actor y rol',
  (select count(*) from public.audit_log where entidad = 'costos_neumatico' and accion = 'INSERT' and actor_id = test.u_cli_a() and actor_rol = 'cliente'), 3::bigint);

select test.become('authenticated', test.u_admin());
select test.eq('admin registra un costo en cualquier cliente',
  (public.costo_registrar((select id from _ids89 where idn = 'C89-X1'), 'compra', 20, current_date, 'Ajuste')->>'neumatico_id')::bigint, (select id from _ids89 where idn = 'C89-X1'));
select test.denied('admin: cubierta inexistente', $$select public.costo_registrar(999999, 'otro', 1, current_date)$$, 'P0002');
select test.denied('admin: costo inexistente', $$select public.costo_eliminar(999999)$$, 'P0002');
select test.denied('admin tampoco escribe directo', $$insert into public.costos_neumatico (cliente_id, neumatico_id, concepto, monto) values (1, 1, 'otro', 1)$$, '42501');
reset role;
select test.eq('X1: la compra manual de 20 reemplaza al precio de 300', test.c89('C89-X1'), '20.00|0.005000|NULL|false|true');

-- Eliminar
select test.become('authenticated', test.u_cli_b());
select test.denied('otro cliente no elimina un costo ajeno', $$select public.costo_eliminar((select min(id) from pg_temp._cost89))$$, '42501');
select test.denied('otro cliente: costo inexistente, 42501 uniforme', $$select public.costo_eliminar(999999)$$, '42501');
reset role;
select test.become('authenticated', test.u_c89n());
select test.denied('sucursal no elimina', $$select public.costo_eliminar((select min(id) from pg_temp._cost89))$$, '42501');
select test.denied('sucursal no registra', $$select public.costo_registrar((select id from pg_temp._ids89 where idn = 'C89-P1'), 'otro', 1, current_date)$$, '42501');
reset role;
select test.become('authenticated', test.u_api());
select test.denied('api no registra', $$select public.costo_registrar((select id from pg_temp._ids89 where idn = 'C89-P1'), 'otro', 1, current_date)$$, '42501');
select test.denied('api no elimina', $$select public.costo_eliminar((select min(id) from pg_temp._cost89))$$, '42501');
reset role;
select test.become('authenticated', test.u_sinperfil());
select test.denied('sin perfil no registra', $$select public.costo_registrar((select id from pg_temp._ids89 where idn = 'C89-P1'), 'otro', 1, current_date)$$, '42501');
select test.denied('sin perfil no elimina', $$select public.costo_eliminar((select min(id) from pg_temp._cost89))$$, '42501');
reset role;
select test.become('anon', null);
select test.denied('anon no registra', $$select public.costo_registrar(1, 'otro', 1, current_date)$$, '42501');
select test.denied('anon no elimina', $$select public.costo_eliminar(1)$$, '42501');
reset role;
select test.eq('los intentos rechazados no borraron nada', test.c89('C89-P1'), '1500.00|0.150000|NULL|false|true');

select test.become('authenticated', test.u_cli_a());
select test.eq('global elimina un costo de su cliente',
  (public.costo_eliminar((select id from public.costos_neumatico where neumatico_id = (select id from _ids89 where idn = 'C89-P5') and concepto = 'montaje'))->>'id') is not null, true);
reset role;
select test.eq('tras eliminar el total baja', test.c89('C89-P5'), '260.50|0.026050|NULL|false|true');
select test.eq('auditoría: DELETE con actor y rol',
  (select count(*) from public.audit_log where entidad = 'costos_neumatico' and accion = 'DELETE' and actor_id = test.u_cli_a() and actor_rol = 'cliente'), 1::bigint);
select test.become('authenticated', test.u_admin());
select test.eq('admin elimina cualquier costo', (public.costo_eliminar((select min(id) from _cost89))->>'neumatico_id')::bigint, (select id from _ids89 where idn = 'C89-P1'));
reset role;
select test.eq('P1 sin la entrada manual', test.c89('C89-P1'), '1200.00|0.120000|NULL|false|true');
select test.eq('auditoría: el actor admin queda registrado',
  (select count(*) from public.audit_log where entidad = 'costos_neumatico' and actor_rol = 'admin'), 2::bigint);

-- Borrar la cubierta borra sus costos (cascada) y queda en la auditoría
create temp table _antes89 as select count(*) n from public.audit_log where entidad = 'costos_neumatico' and accion = 'DELETE';
grant select on _antes89 to public;
delete from public.eventos_neumatico where neumatico_id = (select id from _ids89 where idn = 'C89-D1');
delete from public.neumaticos where idneumatico = 'C89-D1';
select test.eq('cascada: los costos de la cubierta borrada desaparecen',
  (select count(*) from public.costos_neumatico where neumatico_id = (select id from _ids89 where idn = 'C89-D1')), 0::bigint);
select test.eq('cascada: queda en audit_log', (select count(*) - (select n from _antes89) from public.audit_log where entidad = 'costos_neumatico' and accion = 'DELETE'), 1::bigint);

-- ---------------------------------------------------------------------------------------------
-- F. Matriz de roles y RLS (lectura)
-- ---------------------------------------------------------------------------------------------
select test.become('authenticated', test.u_admin());
select test.eq('admin ve todas las cubiertas en la vista', (select count(*) from public.v_costo_cubierta where idneumatico like 'C89-%'), 19::bigint);
select test.eq('admin ve las entradas de costo de ambos clientes',
  (select count(distinct cliente_id) from public.costos_neumatico), 2::bigint);
select test.eq('admin: cpk_por_grupo devuelve filas', (select count(*) > 0 from public.cpk_por_grupo('marca')), true);
reset role;
select test.become('authenticated', test.u_cli_a());
select test.eq('global A ve las cubiertas de su cliente (montadas y en stock), no las de otro',
  (select count(*) from public.v_costo_cubierta where idneumatico like 'C89-%'), 18::bigint);
select test.eq('global A no ve la cubierta de otro cliente', (select count(*) from public.v_costo_cubierta where idneumatico = 'C89-X1'), 0::bigint);
select test.eq('global A ve sus costos y los números exactos', test.c89('C89-P1'), '1200.00|0.120000|NULL|false|true');
select test.eq('global A solo ve entradas de costo de su cliente', (select count(distinct cliente_id) from public.costos_neumatico), 1::bigint);
select test.eq('global A: cpk_por_grupo no incluye a Omega (otro cliente)', (select count(*) from public.cpk_por_grupo('marca') where clave = 'Omega'), 0::bigint);
select test.eq('global A: cpk_por_grupo igual que el admin para su cliente',
  (select round(cpk, 6) from public.cpk_por_grupo('marca') where clave = 'Beta'), 0.1);
reset role;
select test.become('authenticated', test.u_cli_b());
select test.eq('otro cliente ve solo lo suyo', (select string_agg(idneumatico, ',') from public.v_costo_cubierta where idneumatico like 'C89-%'), 'C89-X1');
select test.eq('otro cliente: grupos solo de lo suyo', (select string_agg(clave, ',' order by clave) from public.cpk_por_grupo('marca') where clave in ('Alfa','Beta','Gama','Eps','Delta','Omega')), 'Omega');
select test.eq('otro cliente no ve costos de A', (select count(*) from public.costos_neumatico where neumatico_id <> (select id from _ids89 where idn = 'C89-X1')), 0::bigint);
reset role;
select test.become('authenticated', test.u_c89n());
select test.eq('sucursal: la tabla de costos está vacía', (select count(*) from public.costos_neumatico), 0::bigint);
select test.eq('sucursal: la vista de costos no devuelve filas (aunque vea sus neumáticos)',
  (select count(*) from public.v_costo_cubierta), 0::bigint);
select test.eq('sucursal sí ve sus neumáticos y sus km (v_km_cubierta no cambia)',
  (select count(*) from public.v_km_cubierta where idneumatico like 'C89-%'), 9::bigint);
select test.eq('sucursal: cpk_por_grupo vacío (marca, modelo, sucursal)',
  (select count(*) from public.cpk_por_grupo('marca')) + (select count(*) from public.cpk_por_grupo('modelo')) + (select count(*) from public.cpk_por_grupo('sucursal')), 0::bigint);
reset role;
select test.become('authenticated', test.u_api());
select test.eq('api: vista vacía', (select count(*) from public.v_costo_cubierta), 0::bigint);
select test.eq('api: tabla vacía', (select count(*) from public.costos_neumatico), 0::bigint);
select test.eq('api: cpk_por_grupo vacío', (select count(*) from public.cpk_por_grupo('marca')), 0::bigint);
reset role;
select test.become('authenticated', test.u_sinperfil());
select test.eq('sin perfil: vista, tabla y grupos vacíos',
  (select count(*) from public.v_costo_cubierta) + (select count(*) from public.costos_neumatico) + (select count(*) from public.cpk_por_grupo('marca')), 0::bigint);
reset role;
select test.become('anon', null);
select test.denied('anon no lee la vista', $$select count(*) from public.v_costo_cubierta$$);
select test.denied('anon no lee la tabla', $$select count(*) from public.costos_neumatico$$);
select test.denied('anon no ejecuta cpk_por_grupo', $$select * from public.cpk_por_grupo('marca')$$);
reset role;

rollback;
