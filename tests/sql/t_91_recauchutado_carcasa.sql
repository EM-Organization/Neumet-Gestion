-- Recauchutado por carcasa (hoja de ruta F5): flujo enviar -> dictamen -> aceptar | rechazar, nueva vida sobre la
-- misma fila, costo y km por vida (v_costo_vida, cpk_por_grupo 'vida' y 'banda'), guardia de la cubierta en proceso,
-- y la matriz de roles: admin, cliente global, perfil de sucursal, otro cliente, api, sin perfil y anon.
-- Todo en una transacción que se revierte.
begin;

insert into auth.users (id, email) values ('a0000000-0000-0000-0000-0000000000c9', 'c91n@t');
insert into public.sucursales (id, cliente_id, nombre) overriding system value values
  (911, 1, 'Reca Norte'), (912, 1, 'Reca Sur'), (913, 2, 'Reca Otra');
insert into public.perfiles (user_id, rol, cliente_id, sucursal_id)
  values ('a0000000-0000-0000-0000-0000000000c9', 'cliente', 1, 911);
create or replace function test.u_c91n() returns uuid language sql immutable as $$ select 'a0000000-0000-0000-0000-0000000000c9'::uuid $$;

insert into public.vehiculos (id, cliente_id, sucursal_id, nombre, patente, activo, odometro_km) values
  (911, 1, 911, 'C911', 'RR9110', true, 50000),
  (912, 2, null, 'C912', 'RR9120', true, 5000);

-- Cubierta de stock (fecha de compra en una cohorte propia: 2030-05-01) y eventos con fecha relativa.
create or replace function test.neu91(p_idn text, p_cli bigint, p_veh bigint, p_pos smallint, p_marca text, p_modelo text,
                                      p_precio numeric, p_vida smallint default 0, p_suc bigint default null,
                                      p_estado text default null)
returns void language sql as $$
  insert into public.neumaticos (vehiculo_id, cliente_id, posicion, idneumatico, numero_quema, estado, marca, modelo,
                                 precio_unidad, vida, fecha_compra, sucursal_id, condicion)
  values (p_veh, p_cli, p_pos, p_idn, p_idn, coalesce(p_estado, case when p_veh is null then 'almacenado' else 'montado' end),
          p_marca, p_modelo, p_precio, p_vida, date '2030-05-01', p_suc, case when p_vida > 0 then 'recauchutado' else 'usado' end) $$;
create or replace function test.ev91(p_idn text, p_veh bigint, p_tipo text, p_odo int, p_dias numeric, p_costo numeric default null)
returns void language sql as $$
  insert into public.eventos_neumatico (cliente_id, vehiculo_id, neumatico_id, idneumatico, tipo, odometro_km, costo, created_at)
  select n.cliente_id, p_veh, n.id, n.idneumatico, p_tipo, p_odo, p_costo, now() - p_dias * interval '24 hours'
    from public.neumaticos n where n.idneumatico = p_idn $$;
-- Definer: resuelve ids sin pasar por la RLS del rol que consulta.
create or replace function test.id91(p_idn text) returns bigint language sql stable security definer set search_path = '' as $$
  select id from public.neumaticos where idneumatico = p_idn $$;
-- Estado | vida | sucursal | vehiculo de la cubierta
create or replace function test.n91(p_idn text) returns text language sql stable as $$
  select estado || '|' || vida || '|' || coalesce(sucursal_id::text, 'NULL') || '|' || coalesce(vehiculo_id::text, 'NULL')
    from public.neumaticos where idneumatico = p_idn $$;
-- Proceso abierto o último de la cubierta: estado | vida_nueva
create or replace function test.p91(p_idn text) returns text language sql stable as $$
  select estado || '|' || coalesce(vida_nueva::text, 'NULL') from public.recauchutados
   where neumatico_id = test.id91(p_idn) order by id desc limit 1 $$;
create or replace function test.pid91(p_idn text) returns bigint language sql stable security definer set search_path = '' as $$
  select id from public.recauchutados where neumatico_id = test.id91(p_idn) order by id desc limit 1 $$;
-- vida | costo_total | km | cpk (por vida, una línea por vida)
create or replace function test.v91(p_idn text) returns text language sql stable as $$
  select string_agg(vida || ':' || coalesce(costo_total::text, 'NULL') || ':' || coalesce(km_recorridos::text, 'NULL') || ':'
                    || coalesce(round(cpk, 6)::text, 'NULL'), ' ' order by vida)
    from public.v_costo_vida where idneumatico = p_idn $$;
create or replace function test.plan91(p_sql text) returns numeric language plpgsql as $$
declare j json;
begin
  execute 'explain (format json) ' || p_sql into j;
  return (j -> 0 -> 'Plan' ->> 'Total Cost')::numeric;
end $$;
grant execute on function test.neu91(text, bigint, bigint, smallint, text, text, numeric, smallint, bigint, text),
  test.ev91(text, bigint, text, int, numeric, numeric), test.id91(text), test.n91(text), test.p91(text),
  test.pid91(text), test.v91(text), test.plan91(text) to public;

-- R1: carcasa de Alfa con un tramo de 10.000 km en la vida original (vehículo 911, odómetro 10000 -> 20000), en stock.
select test.neu91('R91-1', 1, null, null, 'Alfa', 'X', 1000, 0::smallint, 911);
select test.ev91('R91-1', 911, 'montaje', 10000, 60), test.ev91('R91-1', 911, 'desmontaje', 20000, 30);
-- R2: para el rechazo (dos veces: dictamen no apto y rechazo al recibir)
select test.neu91('R91-2', 1, null, null, 'Beta', 'Y', 800, 0::smallint, 911);
-- R3: vida máxima; R4: aparcada en un vehículo; R5: montada; R6: de baja
select test.neu91('R91-3', 1, null, null, 'Gama', 'Z', 700, 3::smallint, 911);
select test.neu91('R91-4', 1, 911, 98::smallint, 'Delta', 'W', 600, 0::smallint, null, 'almacenado');
select test.neu91('R91-5', 1, 911, 1::smallint, 'Eps', 'V', 500, 0::smallint);
select test.neu91('R91-6', 1, 911, 97::smallint, 'Zeta', 'U', 400, 0::smallint, null, 'baja');
-- R7: costos por vida con la compra, una reparación y moneda mixta en la vida 1
select test.neu91('R91-7', 1, null, null, 'Eta', 'T', 500, 0::smallint, 911);
-- R8: entró con vida 2 (sin eventos 'reencauche'): solo existe la vida 2
select test.neu91('R91-8', 1, null, null, 'Theta', 'S', 900, 2::smallint, 911);
-- R9: recauchutado por «Cambiar neumático» (flujo anterior): evento reencauche con costo, sin proceso ni banda
select test.neu91('R91-9', 1, null, null, 'Iota', 'R', 800, 1::smallint, 911);
select test.ev91('R91-9', 911, 'montaje', 1000, 90, 800), test.ev91('R91-9', 911, 'desmontaje', 3000, 60),
       test.ev91('R91-9', 911, 'reencauche', 3000, 59, 300), test.ev91('R91-9', 911, 'montaje', 3000, 50),
       test.ev91('R91-9', 911, 'desmontaje', 4000, 40);
-- Otro cliente
select test.neu91('R91-X', 2, null, null, 'Omega', 'O', 300, 0::smallint, 913);

create temp table _ids91 as select idneumatico idn, id from public.neumaticos where idneumatico like 'R91-%';
grant select on _ids91 to public;

-- ---------------------------------------------------------------------------------------------
-- A. Metadatos y permisos
-- ---------------------------------------------------------------------------------------------
select test.eq('v_costo_vida es security_invoker',
  (select coalesce('security_invoker=true' = any (reloptions), false) from pg_class where oid = 'public.v_costo_vida'::regclass), true);
select test.eq('anon sin acceso a las tablas ni a la vista',
  has_table_privilege('anon', 'public.recauchutados', 'select') or has_table_privilege('anon', 'public.neumatico_vidas', 'select')
  or has_table_privilege('anon', 'public.v_costo_vida', 'select'), false);
select test.eq('authenticated solo lee las tablas (sin escritura directa)',
  has_table_privilege('authenticated', 'public.recauchutados', 'select')
  and has_table_privilege('authenticated', 'public.neumatico_vidas', 'select')
  and not has_table_privilege('authenticated', 'public.recauchutados', 'insert')
  and not has_table_privilege('authenticated', 'public.recauchutados', 'update')
  and not has_table_privilege('authenticated', 'public.recauchutados', 'delete')
  and not has_table_privilege('authenticated', 'public.neumatico_vidas', 'insert')
  and not has_table_privilege('authenticated', 'public.neumatico_vidas', 'update')
  and not has_table_privilege('authenticated', 'public.neumatico_vidas', 'delete'), true);
select test.eq('RLS activa y sin políticas de escritura',
  (select bool_and(relrowsecurity) from pg_class where oid in ('public.recauchutados'::regclass, 'public.neumatico_vidas'::regclass))
  and (select count(*) from pg_policies where tablename in ('recauchutados', 'neumatico_vidas') and cmd <> 'SELECT') = 0, true);
select test.eq('RPC y auxiliares: security definer con search_path vacío',
  (select bool_and(prosecdef and proconfig = '{search_path=\"\"}') from pg_proc where oid in (
     'public.recauchutado_enviar(bigint,text,date,text)'::regprocedure,
     'public.recauchutado_dictaminar(bigint,boolean,text,date,bigint)'::regprocedure,
     'public.recauchutado_aceptar(bigint,numeric,text,text,numeric,text,date,bigint,text)'::regprocedure,
     'public.recauchutado_rechazar(bigint,text,date,bigint)'::regprocedure,
     'public.recauchutado_autorizar(bigint)'::regprocedure,
     'public.recauchutado_cerrar_rechazo(bigint,text,date,bigint)'::regprocedure,
     'public.costo_vida_items(bigint)'::regprocedure,
     'public.neumaticos_guardia_recauchutado()'::regprocedure)), true);
select test.eq('anon no ejecuta nada de F5',
  has_function_privilege('anon', 'public.recauchutado_enviar(bigint,text,date,text)', 'execute')
  or has_function_privilege('anon', 'public.recauchutado_dictaminar(bigint,boolean,text,date,bigint)', 'execute')
  or has_function_privilege('anon', 'public.recauchutado_aceptar(bigint,numeric,text,text,numeric,text,date,bigint,text)', 'execute')
  or has_function_privilege('anon', 'public.recauchutado_rechazar(bigint,text,date,bigint)', 'execute')
  or has_function_privilege('anon', 'public.costo_vida_items(bigint)', 'execute'), false);
select test.eq('los auxiliares internos no se ejecutan desde la API',
  has_function_privilege('authenticated', 'public.recauchutado_autorizar(bigint)', 'execute')
  or has_function_privilege('authenticated', 'public.recauchutado_cerrar_rechazo(bigint,text,date,bigint)', 'execute')
  or has_function_privilege('authenticated', 'public.recauchutado_validar_fecha(date,date)', 'execute'), false);
select test.denied('vida de otra fila: unique (neumatico_id, vida)', $$
  insert into public.recauchutados (cliente_id, neumatico_id, vida_origen, proveedor, estado, fecha_cierre, vida_nueva)
    select 1, id, 0, 'P', 'recibido', current_date, 1 from pg_temp._ids91 where idn = 'R91-1';
  insert into public.neumatico_vidas (cliente_id, neumatico_id, vida, proceso_id, fecha, profundidad_inicial_mm)
    select 1, n.id, 1, (select max(id) from public.recauchutados), current_date, 15 from pg_temp._ids91 n where idn = 'R91-1';
  insert into public.neumatico_vidas (cliente_id, neumatico_id, vida, proceso_id, fecha, profundidad_inicial_mm)
    select 1, n.id, 1, (select max(id) from public.recauchutados), current_date, 15 from pg_temp._ids91 n where idn = 'R91-1'$$, '23505');
select test.denied('FK compuesta: proceso con el cliente equivocado',
  $$insert into public.recauchutados (cliente_id, neumatico_id, vida_origen, proveedor) select 2, id, 0, 'P' from pg_temp._ids91 where idn = 'R91-1'$$, '23503');
select test.denied('una vida nueva solo con el proceso recibido (CHECK)',
  $$insert into public.recauchutados (cliente_id, neumatico_id, vida_origen, proveedor, vida_nueva) select 1, id, 0, 'P', 1 from pg_temp._ids91 where idn = 'R91-1'$$, '23514');
select test.eq('los inserts de prueba no dejaron procesos (la transacción de denied se deshace)',
  (select count(*) from public.recauchutados), 0::bigint);

-- ---------------------------------------------------------------------------------------------
-- B. Matriz de roles: ninguna RPC responde a sucursal, otro cliente, api, sin perfil ni anon
-- ---------------------------------------------------------------------------------------------
create temp table _roles91 (rol text, uid uuid);
insert into _roles91 values ('sucursal', test.u_c91n()), ('otro cliente', test.u_cli_b()), ('api', test.u_api()),
  ('sin perfil', test.u_sinperfil());
grant select on _roles91 to public;
do $t$
declare r record;
begin
  for r in select * from _roles91 loop
    perform test.become('authenticated', r.uid);
    perform test.denied(r.rol || ': no envía', format('select public.recauchutado_enviar(%s, ''Prov'')', test.id91('R91-1')));
    perform test.denied(r.rol || ': no dictamina', 'select public.recauchutado_dictaminar(1, true)');
    perform test.denied(r.rol || ': no acepta', 'select public.recauchutado_aceptar(1, 15)');
    perform test.denied(r.rol || ': no rechaza', 'select public.recauchutado_rechazar(1, ''x'')');
    perform test.denied(r.rol || ': cubierta inexistente da lo mismo (42501)', 'select public.recauchutado_enviar(999999, ''Prov'')');
    reset role;
  end loop;
end $t$;
select test.become('anon', null);
select test.denied('anon no envía', format('select public.recauchutado_enviar(%s, ''Prov'')', test.id91('R91-1')));
reset role;
select test.eq('lo denegado no dejó procesos', (select count(*) from public.recauchutados), 0::bigint);

-- ---------------------------------------------------------------------------------------------
-- C. Flujo feliz de R1 como perfil global: enviar -> dictamen apto -> aceptar con banda y costo
-- ---------------------------------------------------------------------------------------------
select test.become('authenticated', test.u_cli_a());
select test.denied('proveedor obligatorio', format('select public.recauchutado_enviar(%s, ''  '')', test.id91('R91-1')), '22023');
select test.denied('fecha futura', format('select public.recauchutado_enviar(%s, ''Prov'', current_date + 30)', test.id91('R91-1')), '23514');
select test.denied('cubierta montada: retirarla antes', format('select public.recauchutado_enviar(%s, ''Prov'')', test.id91('R91-5')), '55000');
select test.denied('cubierta dada de baja', format('select public.recauchutado_enviar(%s, ''Prov'')', test.id91('R91-6')), '55000');
select test.denied('vida máxima (3 recauchutados)', format('select public.recauchutado_enviar(%s, ''Prov'')', test.id91('R91-3')), '23514');
select test.denied('cubierta inexistente: 42501 para un no-admin', 'select public.recauchutado_enviar(999999, ''Prov'')');
select test.eq('enviar: devuelve el proceso', (select public.recauchutado_enviar(test.id91('R91-1'), 'Recauchutadora Sur', null, 'Lote 7') ->> 'estado'), 'enviado');
reset role;
select test.eq('enviar: la cubierta sale del stock (sin sucursal ni vehículo), vida intacta', test.n91('R91-1'), 'almacenado|0|NULL|NULL');
select test.eq('enviar: proceso abierto', test.p91('R91-1'), 'enviado|NULL');
select test.eq('enviar: copia quema, marca y vida de origen',
  (select numero_quema || '|' || marca || '|' || vida_origen || '|' || proveedor || '|' || sucursal_origen_id from public.recauchutados where id = test.pid91('R91-1')),
  'R91-1|Alfa|0|Recauchutadora Sur|911');
select test.eq('enviar: evento envio_recauchutado con la sucursal de origen',
  (select count(*) from public.eventos_neumatico where neumatico_id = test.id91('R91-1') and tipo = 'envio_recauchutado' and sucursal_origen_id = 911), 1::bigint);

select test.become('authenticated', test.u_cli_a());
select test.denied('un solo proceso abierto por cubierta', format('select public.recauchutado_enviar(%s, ''Otro'')', test.id91('R91-1')), '55000');
-- La guardia: la cubierta en recauchutado no se monta, no se mueve y no se retira
select test.denied('en recauchutado: no se monta (neumatico_montar)',
  format('select public.neumatico_montar(911::bigint, 2::smallint, %s)', test.id91('R91-1')), '55000');
select test.denied('en recauchutado: no se mueve de sucursal', format('select public.stock_cubierta_mover(%s, 912)', test.id91('R91-1')), '55000');
select test.denied('aceptar sin dictamen', format('select public.recauchutado_aceptar(%s, 15)', test.pid91('R91-1')), '55000');
select test.denied('rechazar sin dictamen apto: se dictamina', format('select public.recauchutado_rechazar(%s, ''x'')', test.pid91('R91-1')), '55000');
select test.denied('dictamen obligatorio', format('select public.recauchutado_dictaminar(%s, null)', test.pid91('R91-1')), '22004');
select test.denied('no apto exige motivo', format('select public.recauchutado_dictaminar(%s, false, null)', test.pid91('R91-1')), '22023');
select test.denied('fecha del dictamen anterior al envío', format('select public.recauchutado_dictaminar(%s, true, null, date ''2020-01-01'')', test.pid91('R91-1')), '23514');
select test.eq('dictamen apto', (select public.recauchutado_dictaminar(test.pid91('R91-1'), true, 'Casco en buen estado') ->> 'estado'), 'apto');
select test.denied('doble dictamen', format('select public.recauchutado_dictaminar(%s, true)', test.pid91('R91-1')), '55000');
select test.denied('apto: sigue sin poder montarse',
  format('select public.neumatico_montar(911::bigint, 2::smallint, %s)', test.id91('R91-1')), '55000');
-- Validaciones de la aceptación: ninguna deja rastros
select test.denied('profundidad obligatoria', format('select public.recauchutado_aceptar(%s, null)', test.pid91('R91-1')), '22004');
select test.denied('profundidad 0', format('select public.recauchutado_aceptar(%s, 0)', test.pid91('R91-1')), '23514');
select test.denied('profundidad 31', format('select public.recauchutado_aceptar(%s, 31)', test.pid91('R91-1')), '23514');
select test.denied('costo negativo', format('select public.recauchutado_aceptar(%s, 16, null, null, -1)', test.pid91('R91-1')), '23514');
select test.denied('moneda inválida', format('select public.recauchutado_aceptar(%s, 16, null, null, 100, ''U$D'')', test.pid91('R91-1')), '23514');
select test.denied('sucursal de otro cliente: 42501', format('select public.recauchutado_aceptar(%s, 16, null, null, null, ''UYU'', null, 913)', test.pid91('R91-1')));
select test.denied('fecha futura al aceptar', format('select public.recauchutado_aceptar(%s, 16, null, null, null, ''UYU'', current_date + 30)', test.pid91('R91-1')), '23514');
reset role;
select test.eq('las validaciones fallidas no cambiaron nada', test.n91('R91-1') || '/' || test.p91('R91-1'), 'almacenado|0|NULL|NULL/apto|NULL');
select test.eq('sin vidas ni costos por las validaciones fallidas',
  (select count(*) from public.neumatico_vidas where neumatico_id = test.id91('R91-1'))
  + (select count(*) from public.costos_neumatico where neumatico_id = test.id91('R91-1')), 0::bigint);

select test.become('authenticated', test.u_cli_a());
select test.eq('aceptar: nueva vida con costo propio',
  (select public.recauchutado_aceptar(test.pid91('R91-1'), 16.04, ' Vipal ', 'VT-1', 400, 'UYU', null, 912, 'Banda con cinta') ->> 'vida'), '1');
select test.denied('doble aceptación', format('select public.recauchutado_aceptar(%s, 16)', test.pid91('R91-1')), '55000');
select test.denied('ya cerrado: no se rechaza', format('select public.recauchutado_rechazar(%s, ''x'')', test.pid91('R91-1')), '55000');
reset role;
select test.eq('aceptar: misma fila, vida 1, en la sucursal indicada', test.n91('R91-1'), 'almacenado|1|912|NULL');
select test.eq('aceptar: condición recauchutado', (select condicion from public.neumaticos where idneumatico = 'R91-1'), 'recauchutado');
select test.eq('aceptar: proceso recibido con vida nueva', test.p91('R91-1'), 'recibido|1');
select test.eq('aceptar: banda registrada (profundidad redondeada a 1 decimal)',
  (select vida || '|' || profundidad_inicial_mm || '|' || banda_marca || '|' || banda_modelo from public.neumatico_vidas where neumatico_id = test.id91('R91-1')),
  '1|16.0|Vipal|VT-1');
select test.eq('aceptar: costo de recauchutado en la vida 1',
  (select concepto || '|' || monto || '|' || vida from public.costos_neumatico where neumatico_id = test.id91('R91-1')), 'recauchutado|400.00|1');
select test.eq('aceptar: evento reencauche sin costo (no se cuenta dos veces)',
  (select count(*) from public.eventos_neumatico where neumatico_id = test.id91('R91-1') and tipo = 'reencauche' and costo is null), 1::bigint);
select test.eq('el historial dejó envío, dictamen y recauchutado',
  (select string_agg(tipo, ',' order by id) from public.eventos_neumatico
    where neumatico_id = test.id91('R91-1') and tipo in ('envio_recauchutado', 'dictamen_recauchutado', 'reencauche')),
  'envio_recauchutado,dictamen_recauchutado,reencauche');
select test.eq('la quema y el idneumatico no cambian', (select numero_quema || '|' || idneumatico from public.neumaticos where id = test.id91('R91-1')), 'R91-1|R91-1');

-- La cubierta ya puede montarse otra vez (misma fila) y sigue la vida 1: 12.000 km
select test.become('authenticated', test.u_cli_a());
select test.eq('vuelve a montarse', (select public.neumatico_montar(911::bigint, 2::smallint, test.id91('R91-1'), null, 50000) ->> 'neumatico_id')::bigint, test.id91('R91-1'));
reset role;
update public.vehiculos set odometro_km = 62000 where id = 911;

-- ---------------------------------------------------------------------------------------------
-- D. Costo y km por vida
-- ---------------------------------------------------------------------------------------------
select test.become('authenticated', test.u_cli_a());
select test.eq('R1: vida 0 = 1.000 / 10.000 km; vida 1 = 400 / 12.000 km',
  test.v91('R91-1'), '0:1000.00:10000:0.100000 1:400.00:12000:0.033333');
select test.eq('R1: la suma de las vidas es el costo de la carcasa y los km recorridos coinciden',
  (select sum(v.costo_total) = c.costo_total and sum(v.km_recorridos) = c.km_recorridos
     from public.v_costo_vida v join public.v_costo_cubierta c using (neumatico_id)
    where v.idneumatico = 'R91-1' group by c.costo_total, c.km_recorridos), true);
select test.eq('R1: CPK de carcasa (1.400 / 22.000 km)', (select round(cpk_carcasa, 6) from public.v_costo_cubierta where idneumatico = 'R91-1'), 0.063636);
select test.eq('R1: banda y vida actual',
  (select string_agg(vida || ':' || vida_actual || ':' || coalesce(banda_marca, '-'), ' ' order by vida) from public.v_costo_vida where idneumatico = 'R91-1'),
  '0:false:- 1:true:Vipal');
select test.eq('R1: km totales de la vista de km (sin duplicar ni perder)', (select km_totales from public.v_km_cubierta where neumatico_id = test.id91('R91-1')), 22000::bigint);

-- cpk_por_grupo por vida y por banda (cohorte 2030-05-01 = solo las cubiertas de esta prueba)
-- Banda original: R1 (1.000 / 10.000 km) y R9 (800 / 2.000 km) -> 1.800 / 12.000 (no el promedio de 0,1 y 0,4).
select test.eq('grupo vida: la banda original pondera costos y km de R1 y R9',
  (select n_neumaticos || '|' || km_recorridos || '|' || costo_total || '|' || round(cpk, 6) from public.cpk_por_grupo('vida', date '2030-05-01', date '2030-05-01', 1) where clave = 'Banda original'),
  '2|12000|1800.00|0.150000');
-- Recauchutado nº 1: R1 (400 / 12.000 km) y R9 (300 / 1.000 km); R7 (monedas mixtas en esa vida) queda fuera.
select test.eq('grupo vida: Recauchutado nº 1 pondera R1 y R9',
  (select n_neumaticos || '|' || km_recorridos || '|' || costo_total || '|' || round(cpk, 6) || '|' || muestra_baja from public.cpk_por_grupo('vida', date '2030-05-01', date '2030-05-01', 1) where clave = 'Recauchutado nº 1'),
  '2|13000|700.00|0.053846|true');
select test.eq('grupo banda: Vipal VT-1', (select km_recorridos || '|' || round(cpk, 6) from public.cpk_por_grupo('banda', date '2030-05-01', date '2030-05-01', 1) where clave = 'Vipal VT-1'), '12000|0.033333');
select test.eq('grupo vida: no incluye otro cliente (p_cliente_id)', (select count(*) from public.cpk_por_grupo('vida', date '2030-05-01', date '2030-05-01', 2)), 0::bigint);
select test.eq('los grupos anteriores siguen (marca)', (select count(*) > 0 from public.cpk_por_grupo('marca', date '2030-05-01', date '2030-05-01', 1)), true);
select test.denied('grupo inválido', $$select * from public.cpk_por_grupo('eje')$$, '22023');
reset role;

-- R9: recauchutado por «Cambiar neumático» (flujo anterior, sin banda): el costo del evento va a la vida 1
select test.become('authenticated', test.u_cli_a());
select test.eq('R9: vida 0 = compra 800 / 2.000 km; vida 1 = recauchutado 300 / 1.000 km',
  test.v91('R91-9'), '0:800.00:2000:0.400000 1:300.00:1000:0.300000');
select test.eq('R9: sin banda registrada', (select bool_and(banda_marca is null and profundidad_inicial_mm is null) from public.v_costo_vida where idneumatico = 'R91-9'), true);
select test.eq('R9: la suma de las vidas es el total de la carcasa',
  (select sum(v.costo_total) = c.costo_total from public.v_costo_vida v join public.v_costo_cubierta c using (neumatico_id) where v.idneumatico = 'R91-9' group by c.costo_total), true);
select test.eq('R8: entró con vida 2: solo existe la vida 2', test.v91('R91-8'), '2:900.00:0:NULL');
select test.eq('grupo banda: sin banda registrada se rotula aparte',
  (select count(*) from public.cpk_por_grupo('banda', date '2030-05-01', date '2030-05-01', 1) where clave = 'Sin dato de banda'), 1::bigint);
reset role;

-- costo_registrar asigna la vida actual; la compra, la vida base
select test.become('authenticated', test.u_cli_a());
select test.eq('R7: costo_registrar reparación', (select public.costo_registrar(test.id91('R91-7'), 'reparacion', 50) ->> 'concepto'), 'reparacion');
select public.recauchutado_enviar(test.id91('R91-7'), 'Prov B');
select public.recauchutado_dictaminar(test.pid91('R91-7'), true);
select public.recauchutado_aceptar(test.pid91('R91-7'), 15, 'Bandag', 'BDR', 300);
select public.costo_registrar(test.id91('R91-7'), 'otro', 20);
select public.costo_registrar(test.id91('R91-7'), 'otro', 5, null, null, 'USD');
select public.costo_registrar(test.id91('R91-7'), 'compra', 450);
reset role;
select test.eq('R7: cada costo en su vida (la compra manual, en la vida base)',
  (select string_agg(concepto || ':' || vida, ' ' order by id) from public.costos_neumatico where neumatico_id = test.id91('R91-7')),
  'reparacion:0 recauchutado:1 otro:1 otro:1 compra:0');
select test.become('authenticated', test.u_cli_a());
select test.eq('R7: vida 1 con USD y UYU: total y CPK NULL; vida 0 suma la compra manual (450) y la reparación',
  (select string_agg(vida || ':' || coalesce(costo_total::text, 'NULL') || ':' || moneda_mixta, ' ' order by vida) from public.v_costo_vida where idneumatico = 'R91-7'),
  '0:500.00:false 1:NULL:true');
reset role;

-- ---------------------------------------------------------------------------------------------
-- E. Rechazo: no crea vida ficticia
-- ---------------------------------------------------------------------------------------------
select test.become('authenticated', test.u_cli_a());
select public.recauchutado_enviar(test.id91('R91-2'), 'Recauchutadora Norte');
select test.eq('dictamen no apto: rechazado y vuelve a Reca Sur',
  (select public.recauchutado_dictaminar(test.pid91('R91-2'), false, 'Carcasa con corte de flanco', null, 912) ->> 'estado'), 'rechazado');
reset role;
select test.eq('R2 rechazada: vida intacta, en la sucursal indicada, proceso cerrado', test.n91('R91-2') || '/' || test.p91('R91-2'), 'almacenado|0|912|NULL/rechazado|NULL');
select test.eq('R2 rechazada: sin fila de vida ni costos',
  (select count(*) from public.neumatico_vidas where neumatico_id = test.id91('R91-2'))
  + (select count(*) from public.costos_neumatico where neumatico_id = test.id91('R91-2')), 0::bigint);
select test.eq('R2: evento de rechazo con el motivo',
  (select count(*) from public.eventos_neumatico where neumatico_id = test.id91('R91-2') and tipo = 'rechazo_recauchutado' and notas like '%corte de flanco%'), 1::bigint);
select test.eq('R2: la condición no pasó a recauchutado', (select condicion from public.neumaticos where idneumatico = 'R91-2'), 'usado');
select test.eq('R2: la vista de vidas muestra solo la vida 0', test.v91('R91-2'), '0:800.00:0:NULL');
select test.become('authenticated', test.u_cli_a());
-- Puede enviarse de nuevo; esta vez el dictamen es apto y se rechaza al recibir
select public.recauchutado_enviar(test.id91('R91-2'), 'Recauchutadora Centro');
select public.recauchutado_dictaminar(test.pid91('R91-2'), true);
select test.denied('rechazo al recibir exige motivo', format('select public.recauchutado_rechazar(%s, null)', test.pid91('R91-2')), '22023');
select test.eq('rechazo al recibir', (select public.recauchutado_rechazar(test.pid91('R91-2'), 'Banda despegada', null, 911) ->> 'estado'), 'rechazado');
reset role;
select test.eq('R2: dos procesos, ninguna vida',
  (select count(*) from public.recauchutados where neumatico_id = test.id91('R91-2') and estado = 'rechazado')::text || '|' || test.n91('R91-2'), '2|almacenado|0|911|NULL');
select test.become('authenticated', test.u_cli_a());
select test.eq('la cubierta rechazada vuelve a poder moverse', (select public.stock_cubierta_mover(test.id91('R91-2'), 912) ->> 'movido'), 'true');
reset role;

-- R4: aparcada en un vehículo: al enviarla sale del vehículo
select test.become('authenticated', test.u_cli_a());
select public.recauchutado_enviar(test.id91('R91-4'), 'Prov C');
reset role;
select test.eq('R4: la cubierta aparcada deja el vehículo', test.n91('R91-4'), 'almacenado|0|NULL|NULL');
select test.eq('R4: sin posición', (select posicion is null and not auxilio from public.neumaticos where idneumatico = 'R91-4'), true);

-- Admin: envía una cubierta de cualquier cliente; inexistente da P0002
select test.become('authenticated', test.u_admin());
select test.eq('admin envía', (select public.recauchutado_enviar(test.id91('R91-X'), 'Prov X') ->> 'estado'), 'enviado');
select test.denied('admin: cubierta inexistente P0002', 'select public.recauchutado_enviar(999999, ''Prov'')', 'P0002');
select test.denied('admin: proceso inexistente P0002', 'select public.recauchutado_dictaminar(999999, true)', 'P0002');
select test.eq('admin dictamina y acepta', (select public.recauchutado_dictaminar(test.pid91('R91-X'), true) ->> 'estado'), 'apto');
select test.eq('admin acepta con costo en USD', (select public.recauchutado_aceptar(test.pid91('R91-X'), 14.5, 'Otra', 'O1', 120, 'USD') ->> 'vida'), '1');
reset role;
select test.eq('R-X: costo en USD en la vida 1', (select monto || '|' || moneda || '|' || vida from public.costos_neumatico where neumatico_id = test.id91('R91-X')), '120.00|USD|1');

-- ---------------------------------------------------------------------------------------------
-- F. Lectura por rol
-- ---------------------------------------------------------------------------------------------
select test.become('authenticated', test.u_cli_a());
select test.eq('global: ve los procesos de su cliente y ninguno ajeno',
  (select count(*) > 0 and bool_and(cliente_id = 1) from public.recauchutados), true);
select test.eq('global: ve las bandas de su cliente', (select count(*) > 0 and bool_and(cliente_id = 1) from public.neumatico_vidas), true);
select test.eq('global: v_costo_vida solo de su cliente', (select count(*) > 0 and bool_and(cliente_id = 1) from public.v_costo_vida), true);
select test.denied('global: precio_unidad sigue sin leerse por la tabla', $$select precio_unidad from public.neumaticos limit 1$$);
select test.denied('global: no escribe directo en recauchutados', $$update public.recauchutados set proveedor = 'x'$$);
select test.denied('global: no borra directo en neumatico_vidas', $$delete from public.neumatico_vidas$$);
select test.eq('global: costo_vida_items de una cubierta ajena no devuelve filas',
  (select count(*) from public.costo_vida_items(test.id91('R91-X'))), 0::bigint);
reset role;
select test.become('authenticated', test.u_c91n());
select test.eq('sucursal: no ve procesos', (select count(*) from public.recauchutados), 0::bigint);
select test.eq('sucursal: no ve bandas', (select count(*) from public.neumatico_vidas), 0::bigint);
select test.eq('sucursal: v_costo_vida sin filas', (select count(*) from public.v_costo_vida), 0::bigint);
select test.eq('sucursal: costo_vida_items sin filas ni de su propia cubierta', (select count(*) from public.costo_vida_items(test.id91('R91-5'))), 0::bigint);
select test.eq('sucursal: cpk_por_grupo vida sin filas', (select count(*) from public.cpk_por_grupo('vida')), 0::bigint);
select test.denied('sucursal: eventos_neumatico.costo sigue sin leerse', $$select costo from public.eventos_neumatico limit 1$$);
reset role;
select test.become('authenticated', test.u_cli_b());
select test.eq('otro cliente: solo lo suyo (R-X)', (select count(*) from public.recauchutados where cliente_id <> 2), 0::bigint);
select test.eq('otro cliente: costo_vida_items de A sin filas', (select count(*) from public.costo_vida_items(test.id91('R91-5'))), 0::bigint);
reset role;
select test.become('authenticated', test.u_api());
select test.eq('api: sin procesos, bandas ni vidas',
  (select count(*) from public.recauchutados) + (select count(*) from public.neumatico_vidas) + (select count(*) from public.v_costo_vida), 0::bigint);
reset role;
select test.become('anon', null);
select test.denied('anon no lee procesos', $$select * from public.recauchutados$$);
select test.denied('anon no lee v_costo_vida', $$select * from public.v_costo_vida$$);
select test.denied('anon no ejecuta cpk_por_grupo', $$select * from public.cpk_por_grupo('vida')$$);
reset role;
select test.become('authenticated', test.u_admin());
select test.eq('admin: ve procesos de ambos clientes', (select count(distinct cliente_id) from public.recauchutados), 2::bigint);
reset role;

-- ---------------------------------------------------------------------------------------------
-- G. Una nueva banda no es «aumento de profundidad sin recauchutado» (calidad de datos, F3)
-- ---------------------------------------------------------------------------------------------
-- R1 tenía 4 mm antes de recauchutarse y 16 mm después: el evento 'reencauche' entre ambas lecturas la justifica.
-- R7 sube de 4 a 16 mm sin ningún evento y sí es sospechosa.
insert into public.mediciones (vehiculo_id, cliente_id, posicion, idneumatico, mm1, mm2, mm3, created_at) values
  (911, 1, 2, 'R91-1', 4, 4, 4, now() - interval '20 days'),
  (911, 1, 2, 'R91-1', 16, 16, 16, now()),
  (911, 1, 3, 'R91-8', 4, 4, 4, now() - interval '20 days'),
  (911, 1, 3, 'R91-8', 16, 16, 16, now());
select test.eq('lectura tras el recauchutado: válida',
  (select calidad from public.mediciones where idneumatico = 'R91-1' and mm1 = 16), 'valida');
select test.eq('contraste: aumento sin evento: sospechosa',
  (select calidad from public.mediciones where idneumatico = 'R91-8' and mm1 = 16), 'sospechosa');

-- ---------------------------------------------------------------------------------------------
-- H. Rendimiento: el plan de las consultas del panel queda muy por debajo del umbral de JIT (100000)
-- ---------------------------------------------------------------------------------------------
select test.become('authenticated', test.u_cli_a());
select test.eq('plan: una cubierta', test.plan91('select * from public.v_costo_vida where neumatico_id = ' || test.id91('R91-1')) < 100000, true);
select test.eq('plan: un vehículo', test.plan91('select * from public.v_costo_vida where vehiculo_id = 911') < 100000, true);
select test.eq('plan: cpk_por_grupo(vida)', test.plan91($$select * from public.cpk_por_grupo('vida')$$) < 100000, true);
select test.eq('plan: vista completa en la base de prueba', test.plan91('select * from public.v_costo_vida') < 100000, true);
reset role;

rollback;
