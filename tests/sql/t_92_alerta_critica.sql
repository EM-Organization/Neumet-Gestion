-- Alerta única «Neumático crítico» con estado (hoja de ruta F7, docs/15 B, migración 20261118500000):
-- apertura sin duplicados, histéresis, reapertura a 7 días, resolución (recuperada, cambio, baja, manual, sin_datos),
-- la alerta sigue al neumático en una rotación, umbral por cliente (alerta_configurar) con reevaluación, reconocer,
-- silenciar y resolver con la matriz de roles (admin, cliente global, perfil de sucursal, otro cliente, api, sin
-- perfil, anon), RLS de lectura (la sucursal solo ve la suya), sin escritura directa, auditoría con actor, consistencia
-- con v_estado_neumaticos y costo de los planes (< 100000 para que PG16 no active el JIT).
-- Todo en una transacción que se revierte.
begin;

insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-0000000000e1', 'c91n@t'),
  ('a0000000-0000-0000-0000-0000000000e2', 'c91s@t');
insert into public.sucursales (id, cliente_id, nombre) overriding system value values
  (911, 1, 'Alerta Norte'), (912, 1, 'Alerta Sur');
insert into public.perfiles (user_id, rol, cliente_id, sucursal_id) values
  ('a0000000-0000-0000-0000-0000000000e1', 'cliente', 1, 911),
  ('a0000000-0000-0000-0000-0000000000e2', 'cliente', 1, 912);
create or replace function test.u_c91n() returns uuid language sql immutable as $$ select 'a0000000-0000-0000-0000-0000000000e1'::uuid $$;
create or replace function test.u_c91s() returns uuid language sql immutable as $$ select 'a0000000-0000-0000-0000-0000000000e2'::uuid $$;
grant execute on function test.u_c91n(), test.u_c91s() to public;

insert into public.vehiculos (id, cliente_id, sucursal_id, nombre, patente, activo, odometro_km) values
  (911, 1, 911, '911', 'AL9110', true, 1000),
  (912, 1, 912, '912', 'AL9120', true, 1000),
  (913, 2, null, '913', 'AL9130', true, 1000);
-- Cliente 1: crítico 5,0 mm, bajo 8, retiro 3, histéresis 0,5 (valores del fixture). Cliente 2: crítico 6, bajo 10, retiro 4.
insert into public.neumaticos (vehiculo_id, cliente_id, posicion, idneumatico, estado, marca, modelo) values
  (911, 1, 1, 'A91-1', 'montado', 'M', 'X'),
  (911, 1, 2, 'A91-2', 'montado', 'M', 'X'),
  (911, 1, 3, 'A91-3', 'montado', 'M', 'X'),
  (911, 1, 4, 'A91-4', 'montado', 'M', 'X'),
  (912, 1, 1, 'A91-S1', 'montado', 'M', 'X'),
  (913, 2, 1, 'A91-B1', 'montado', 'M', 'X');

create or replace function test.med91(p_veh bigint, p_cli bigint, p_pos int, p_idn text, p_horas numeric, p_mm numeric)
returns bigint language sql as $$
  insert into public.mediciones (vehiculo_id, cliente_id, posicion, idneumatico, mm1, mm2, mm3, created_at)
  values (p_veh, p_cli, p_pos, p_idn, p_mm, p_mm, p_mm, now() - p_horas * interval '1 hour')
  returning id $$;
-- estado|mm_apertura|mm_minimo|mm_actual|veces_reabierta de la alerta no resuelta (o 'sin alerta')
create or replace function test.al91(p_idn text) returns text language sql stable as $$
  select coalesce((select a.estado || '|' || a.mm_apertura || '|' || a.mm_minimo || '|' || a.mm_actual || '|' || a.veces_reabierta
                     from public.alertas a join public.neumaticos n on n.id = a.neumatico_id
                    where n.idneumatico = p_idn and a.estado <> 'resuelta'), 'sin alerta') $$;
create or replace function test.nal91(p_idn text) returns bigint language sql stable as $$
  select count(*) from public.alertas a join public.neumaticos n on n.id = a.neumatico_id where n.idneumatico = p_idn $$;
create or replace function test.aid91(p_idn text) returns bigint language sql stable as $$
  select a.id from public.alertas a join public.neumaticos n on n.id = a.neumatico_id
   where n.idneumatico = p_idn order by a.id desc limit 1 $$;
create or replace function test.costo91(p_sql text) returns numeric language plpgsql as $$
declare j json;
begin
  execute 'explain (format json) ' || p_sql into j;
  return (j -> 0 -> 'Plan' ->> 'Total Cost')::numeric;
end $$;
grant execute on function test.med91(bigint, bigint, int, text, numeric, numeric), test.al91(text), test.nal91(text),
  test.aid91(text), test.costo91(text) to public;

-- ---------------------------------------------------------------------------------------------
-- A. Apertura, deduplicación, histéresis, reapertura
-- ---------------------------------------------------------------------------------------------
select test.eq('A: el relleno no creó alertas de prueba antes de medir', test.nal91('A91-1'), 0::bigint);
select test.med91(911, 1, 1, 'A91-1', 100, 6.0);
select test.eq('A: 6,0 mm con umbral 5,0 no abre alerta', test.al91('A91-1'), 'sin alerta');
select test.med91(911, 1, 1, 'A91-1', 90, 4.8);
select test.eq('A: 4,8 mm abre una alerta, con mm de apertura y mínimo', test.al91('A91-1'), 'abierta|4.80|4.80|4.80|0');
select test.eq('A: la alerta guarda el umbral vigente y el vehículo',
  (select umbral_mm || '|' || vehiculo_id || '|' || posicion || '|' || tipo from public.alertas where id = test.aid91('A91-1')), '5.0|911|1|critico');
select test.med91(911, 1, 1, 'A91-1', 80, 4.5);
select test.eq('A: otra medición bajo el umbral no abre otra: sigue una y baja el mínimo', test.al91('A91-1') || '|' || test.nal91('A91-1'), 'abierta|4.80|4.50|4.50|0|1');
select test.med91(911, 1, 1, 'A91-1', 70, 5.2);
select test.eq('A: histéresis: 5,2 mm (entre 5,0 y 5,5) no resuelve', test.al91('A91-1'), 'abierta|4.80|4.50|5.20|0');
select test.med91(911, 1, 1, 'A91-1', 60, 5.6);
select test.eq('A: 5,6 mm (>= 5,5) resuelve como recuperada', test.al91('A91-1') || '|' || (select resuelta_motivo from public.alertas where id = test.aid91('A91-1')), 'sin alerta|recuperada');
select test.eq('A: resuelta no figura en v_alertas', (select count(*) from public.v_alertas where idneumatico = 'A91-1'), 0::bigint);
select test.med91(911, 1, 1, 'A91-1', 50, 4.9);
select test.eq('A: cruce nuevo dentro de 7 días reabre la MISMA fila (veces_reabierta + 1)',
  test.al91('A91-1') || '|' || test.nal91('A91-1'), 'abierta|4.90|4.90|4.90|1|1');
select test.eq('A: reabierta sin reconocimiento ni resolución previos',
  (select (reconocida_at is null and resuelta_at is null and resuelta_motivo is null)::text from public.alertas where id = test.aid91('A91-1')), 'true');
select test.eq('A: dato no medido: A91-3 sin mediciones no genera alerta', test.nal91('A91-3'), 0::bigint);
select test.eq('A: v_alertas expone alerta_id, estado y severidad crítica',
  (select alerta_id || '|' || estado || '|' || severidad || '|' || mensaje from public.v_alertas where idneumatico = 'A91-1'),
  test.aid91('A91-1') || '|abierta|3|Neumático crítico: 4,9 mm (límite 5 mm)');

-- Lote de la API: varias mediciones de varios neumáticos en UNA sentencia, una alerta por neumático.
insert into public.mediciones (vehiculo_id, cliente_id, posicion, idneumatico, mm1, mm2, mm3, created_at) values
  (911, 1, 2, 'A91-2', 4.0, 4.0, 4.0, now() - interval '30 hours'),
  (911, 1, 2, 'A91-2', 3.9, 3.9, 3.9, now() - interval '29 hours'),
  (911, 1, 4, 'A91-4', 3.0, 3.0, 3.0, now() - interval '28 hours');
select test.eq('A: lote en una sentencia: una alerta por neumático', test.nal91('A91-2') || '|' || test.nal91('A91-4'), '1|1');
select test.eq('A: lote: A91-2 toma la medición más reciente', test.al91('A91-2'), 'abierta|3.90|3.90|3.90|0');

-- Atribución por posición (medición sin idneumatico, regla 2): vehículo 912
select test.med91(912, 1, 1, null, 20, 4.0);
select test.eq('A: medición sin idneumatico abre la alerta del neumático montado en la posición', test.al91('A91-S1'), 'abierta|4.00|4.00|4.00|0');

-- Todas las mediciones del neumático invalidadas: se resuelve como sin_datos (nunca crítico por falta de dato)
update public.mediciones set calidad = 'invalidada', calidad_motivo = 'prueba' where idneumatico = 'A91-4';
select test.eq('A: invalidar todas las mediciones resuelve la alerta como sin_datos',
  test.al91('A91-4') || '|' || (select resuelta_motivo from public.alertas where id = test.aid91('A91-4')), 'sin alerta|sin_datos');

-- ---------------------------------------------------------------------------------------------
-- B. La alerta sigue al neumático (rotar) y se resuelve al cambiarlo o darlo de baja
-- ---------------------------------------------------------------------------------------------
select test.become('authenticated', test.u_cli_a());
select public.neumatico_rotar(911::bigint, 1::smallint, 2::smallint) as rot \gset
reset role;
select test.eq('B: rotar conserva las dos alertas (misma fila, nueva posición)',
  (select string_agg(n.idneumatico || '@' || a.posicion || '#' || a.estado, ',' order by n.idneumatico)
     from public.alertas a join public.neumaticos n on n.id = a.neumatico_id
    where a.vehiculo_id = 911 and a.estado <> 'resuelta'), 'A91-1@2#abierta,A91-2@1#abierta');
select test.eq('B: rotar no abrió alertas nuevas', test.nal91('A91-1') || '|' || test.nal91('A91-2'), '1|1');
select test.become('authenticated', test.u_cli_a());
select public.neumatico_cambiar(911::bigint, 2::smallint, 'reparacion', 'Pinchazo', 1100, null, '{"marca":"N"}') as cam \gset
select public.neumatico_cambiar(911::bigint, 1::smallint, 'baja', 'Corte lateral', 1100, null, '{"marca":"N"}') as baj \gset
reset role;
select test.eq('B: cambiar el neumático lo resuelve con motivo cambio (A91-1 estaba en pos 2)',
  (select resuelta_motivo from public.alertas where id = test.aid91('A91-1')), 'cambio');
select test.eq('B: dar de baja lo resuelve con motivo baja (A91-2 estaba en pos 1)',
  (select resuelta_motivo from public.alertas where id = test.aid91('A91-2')), 'baja');
select test.eq('B: los neumáticos nuevos no heredan alerta',
  (select count(*) from public.alertas a join public.neumaticos n on n.id = a.neumatico_id
    where a.vehiculo_id = 911 and a.estado <> 'resuelta'), 0::bigint);

-- ---------------------------------------------------------------------------------------------
-- C. Umbral por cliente (alerta_configurar): reevalúa la flota; validaciones; matriz de roles
-- ---------------------------------------------------------------------------------------------
select test.med91(911, 1, 3, 'A91-3', 10, 6.5);
select test.eq('C: A91-3 con 6,5 mm no es crítico con umbral 5,0', test.nal91('A91-3'), 0::bigint);
select test.become('authenticated', test.u_cli_a());
select public.alerta_configurar(null::bigint, 7.0) as cfg1 \gset
reset role;
select test.eq('C: cliente global sube el umbral a 7,0: devuelve la configuración',
  (:'cfg1'::jsonb ->> 'umbral_critico_mm') || '|' || (:'cfg1'::jsonb ->> 'histeresis_mm'), '7.0|0.5');
select test.eq('C: la reevaluación abre la alerta de A91-3 con el umbral nuevo', test.al91('A91-3'), 'abierta|6.50|6.50|6.50|0');
select test.eq('C: la alerta guarda el umbral nuevo', (select umbral_mm from public.alertas where id = test.aid91('A91-3')), 7.0);
select test.eq('C: el estado de v_estado_neumaticos coincide (crítico con 7,0)',
  (select estado from public.v_estado_neumaticos where idneumatico = 'A91-3'), 'critico');
select test.eq('C: la reevaluación no toca a otro cliente (A91-B1 sin alerta)', test.nal91('A91-B1'), 0::bigint);
select test.become('authenticated', test.u_cli_a());
select public.alerta_configurar(1::bigint, 5.0, 0.0);
reset role;
select test.eq('C: umbral de vuelta a 5,0 con histéresis 0: 6,5 >= 5,0 resuelve como recuperada',
  test.al91('A91-3') || '|' || (select resuelta_motivo from public.alertas where id = test.aid91('A91-3')), 'sin alerta|recuperada');
select test.become('authenticated', test.u_cli_a());
select public.alerta_configurar(null::bigint, null, 0.5);
reset role;
select test.eq('C: solo histéresis: umbral intacto',
  (select umbral_critico_mm || '|' || alerta_histeresis_mm from public.clientes where id = 1), '5.0|0.5');
select test.eq('C: la configuración queda auditada con el actor',
  (select count(*) > 0 from public.audit_log where entidad = 'clientes' and entidad_id = '1' and accion = 'UPDATE' and actor_id = test.u_cli_a()), true);

select test.become('authenticated', test.u_cli_a());
select test.denied('C: umbral igual o mayor al de desgaste bajo (8,0)', $$select public.alerta_configurar(null::bigint, 8.0)$$, '23514');
select test.denied('C: umbral igual o menor al de retiro (3,0)', $$select public.alerta_configurar(null::bigint, 3.0)$$, '23514');
select test.denied('C: umbral con más de un decimal', $$select public.alerta_configurar(null::bigint, 5.55)$$, '22023');
select test.denied('C: histéresis fuera de rango', $$select public.alerta_configurar(null::bigint, null, 3.5)$$, '23514');
select test.denied('C: histéresis negativa', $$select public.alerta_configurar(null::bigint, null, -0.1)$$, '23514');
select test.denied('C: sin ningún valor', $$select public.alerta_configurar(null::bigint)$$, '22004');
select test.denied('C: cliente global no configura a otro cliente', $$select public.alerta_configurar(2::bigint, 7.0)$$);
reset role;
select test.eq('C: los rechazos no cambiaron nada', (select umbral_critico_mm || '|' || alerta_histeresis_mm from public.clientes where id = 1), '5.0|0.5');
select test.become('authenticated', test.u_c91n());
select test.denied('C: perfil de sucursal no edita umbrales', $$select public.alerta_configurar(null::bigint, 7.0)$$);
select test.denied('C: perfil de sucursal tampoco indicando su cliente', $$select public.alerta_configurar(1::bigint, 7.0)$$);
reset role;
select test.become('authenticated', test.u_cli_b());
select test.denied('C: otro cliente no configura el cliente 1', $$select public.alerta_configurar(1::bigint, 7.0)$$);
reset role;
select test.become('authenticated', test.u_api());
select test.denied('C: api no configura', $$select public.alerta_configurar(1::bigint, 7.0)$$);
reset role;
select test.become('authenticated', test.u_sinperfil());
select test.denied('C: sin perfil no configura', $$select public.alerta_configurar(1::bigint, 7.0)$$);
reset role;
select test.become('anon', null);
select test.denied('C: anon sin execute en alerta_configurar', $$select public.alerta_configurar(1::bigint, 7.0)$$);
reset role;
select test.become('authenticated', test.u_admin());
select test.denied('C: admin debe indicar el cliente', $$select public.alerta_configurar(null::bigint, 7.0)$$, '22004');
select test.eq('C: admin configura el cliente 2 (umbral 7,0 entre 4 y 10)',
  (public.alerta_configurar(2::bigint, 7.0) ->> 'umbral_critico_mm'), '7.0');
select public.alerta_configurar(2::bigint, 6.0);
reset role;

-- ---------------------------------------------------------------------------------------------
-- D. Reconocer, silenciar, resolver: matriz de roles
-- ---------------------------------------------------------------------------------------------
-- Alertas vivas: A91-S1 (vehículo 912, sucursal Sur) y una nueva en el vehículo 911 (sucursal Norte) y otra de B.
select test.med91(911, 1, 3, 'A91-3', 5, 4.0);
select test.med91(913, 2, 1, 'A91-B1', 5, 5.0);
select test.eq('D: alertas vivas de partida: Norte 1, Sur 1, B 1 (umbral de B 6,0)',
  (select count(*) filter (where vehiculo_id = 911) || '|' || count(*) filter (where vehiculo_id = 912) || '|' || count(*) filter (where vehiculo_id = 913)
     from public.alertas where estado <> 'resuelta'), '1|1|1');
select test.aid91('A91-3') as a_n, test.aid91('A91-S1') as a_s, test.aid91('A91-B1') as a_b \gset

select test.become('authenticated', test.u_c91n());
select test.denied('D: sucursal Norte no reconoce una alerta de Sur', format($$select public.alerta_reconocer(%s)$$, :a_s));
select test.denied('D: sucursal Norte no silencia una alerta de Sur', format($$select public.alerta_silenciar(%s, now() + interval '1 day')$$, :a_s));
select test.denied('D: sucursal Norte no resuelve una alerta de Sur', format($$select public.alerta_resolver(%s, 'x')$$, :a_s));
select test.denied('D: sucursal Norte no reconoce una alerta de otro cliente', format($$select public.alerta_reconocer(%s)$$, :a_b));
select test.denied('D: alerta inexistente = mismo 42501 para no admin', $$select public.alerta_reconocer(999999)$$);
select test.eq('D: sucursal Norte reconoce la suya', public.alerta_reconocer(:a_n, 'En revisión') ->> 'estado', 'reconocida');
select test.eq('D: reconocer de nuevo es idempotente (cambiado = false)', public.alerta_reconocer(:a_n) ->> 'cambiado', 'false');
select test.denied('D: nota de más de 200 caracteres', format($$select public.alerta_reconocer(%s, repeat('x', 201))$$, :a_n), '22023');
select test.eq('D: silenciar la suya 3 días', (public.alerta_silenciar(:a_n, now() + interval '3 days', 'Espera de repuesto') ->> 'silenciada_hasta') is not null, true);
select test.denied('D: silencio en el pasado', format($$select public.alerta_silenciar(%s, now() - interval '1 hour')$$, :a_n), '22023');
select test.denied('D: silencio de más de 90 días', format($$select public.alerta_silenciar(%s, now() + interval '91 days')$$, :a_n), '22023');
select test.denied('D: resolver exige nota', format($$select public.alerta_resolver(%s, '  ')$$, :a_n), '22023');
reset role;
select test.eq('D: reconocida con autor y nota; silenciada con motivo y autor',
  (select estado || '|' || (reconocida_por = test.u_c91n())::text || '|' || nota_reconocida || '|' || (silenciada_hasta is not null)::text || '|' || silencio_motivo || '|' || (silenciada_por = test.u_c91n())::text
     from public.alertas where id = :a_n), 'reconocida|true|En revisión|true|Espera de repuesto|true');
select test.eq('D: sigue abierta para la vista (reconocida y silenciada no desaparecen)',
  (select estado || '|' || (silenciada_hasta is not null)::text from public.v_alertas where alerta_id = :a_n), 'reconocida|true');

select test.become('authenticated', test.u_cli_b());
select test.denied('D: otro cliente no reconoce', format($$select public.alerta_reconocer(%s)$$, :a_n));
select test.denied('D: otro cliente no resuelve', format($$select public.alerta_resolver(%s, 'x')$$, :a_n));
reset role;
select test.become('authenticated', test.u_api());
select test.denied('D: api no reconoce', format($$select public.alerta_reconocer(%s)$$, :a_n));
reset role;
select test.become('authenticated', test.u_sinperfil());
select test.denied('D: sin perfil no reconoce', format($$select public.alerta_reconocer(%s)$$, :a_n));
reset role;
select test.become('anon', null);
select test.denied('D: anon sin execute en reconocer', format($$select public.alerta_reconocer(%s)$$, :a_n));
select test.denied('D: anon sin execute en silenciar', format($$select public.alerta_silenciar(%s, now() + interval '1 day')$$, :a_n));
select test.denied('D: anon sin execute en resolver', format($$select public.alerta_resolver(%s, 'x')$$, :a_n));
reset role;

select test.become('authenticated', test.u_cli_a());
select test.eq('D: cliente global quita el silencio con null', (public.alerta_silenciar(:a_n, null) ->> 'silenciada_hasta') is null, true);
select test.eq('D: cliente global resuelve con nota', public.alerta_resolver(:a_n, 'Neumático retirado a taller') ->> 'estado', 'resuelta');
select test.denied('D: resolver dos veces', format($$select public.alerta_resolver(%s, 'otra')$$, :a_n), '55000');
select test.denied('D: reconocer una resuelta', format($$select public.alerta_reconocer(%s)$$, :a_n), '55000');
select test.denied('D: silenciar una resuelta', format($$select public.alerta_silenciar(%s, now() + interval '1 day')$$, :a_n), '55000');
reset role;
select test.eq('D: resolución manual con motivo, autor y nota',
  (select resuelta_motivo || '|' || (resuelta_por = test.u_cli_a())::text || '|' || nota_resolucion || '|' || (silenciada_hasta is null)::text from public.alertas where id = :a_n),
  'manual|true|Neumático retirado a taller|true');
select test.med91(911, 1, 3, 'A91-3', 2, 3.8);
select test.eq('D: tras resolver a mano, la siguiente medición bajo el umbral abre una alerta NUEVA',
  test.nal91('A91-3') || '|' || (test.aid91('A91-3') > :a_n)::text || '|' || test.al91('A91-3'), '2|true|abierta|3.80|3.80|3.80|0');

select test.become('authenticated', test.u_admin());
select test.denied('D: admin con alerta inexistente: P0002', $$select public.alerta_reconocer(999999)$$, 'P0002');
select test.eq('D: admin reconoce cualquiera (otro cliente)', public.alerta_reconocer(:a_b) ->> 'estado', 'reconocida');
reset role;

-- ---------------------------------------------------------------------------------------------
-- E. RLS de lectura y sin escritura directa
-- ---------------------------------------------------------------------------------------------
select test.eq('E: admin ve todas las vivas', (select count(*) from public.alertas a where a.estado <> 'resuelta') >= 3, true);
select test.become('authenticated', test.u_c91n());
select test.eq('E: sucursal Norte solo ve alertas de su vehículo (tabla)', (select count(*) from public.alertas where vehiculo_id <> 911), 0::bigint);
select test.eq('E: sucursal Norte solo ve alertas de su vehículo (vista)', (select count(*) from public.v_alertas where vehiculo_id <> 911), 0::bigint);
select test.eq('E: sucursal Norte ve la suya', (select count(*) from public.v_alertas where vehiculo_id = 911) >= 1, true);
select test.eq('E: sucursal Norte no ve la de Sur ni la de B', (select count(*) from public.alertas where id in (:a_s, :a_b)), 0::bigint);
reset role;
select test.become('authenticated', test.u_c91s());
select test.eq('E: sucursal Sur ve solo la suya', (select string_agg(idneumatico, ',') from public.v_alertas), 'A91-S1');
reset role;
select test.become('authenticated', test.u_cli_a());
select test.eq('E: cliente global ve las de su cliente y ninguna ajena', (select count(*) from public.alertas where cliente_id <> 1), 0::bigint);
select test.eq('E: cliente global ve Norte y Sur', (select count(distinct vehiculo_id) from public.alertas where vehiculo_id in (911, 912)), 2::bigint);
select test.denied('E: INSERT directo', $$insert into public.alertas (cliente_id, vehiculo_id, neumatico_id, umbral_mm, mm_apertura, mm_minimo, mm_actual) select 1, 911, id, 5, 1, 1, 1 from public.neumaticos limit 1$$);
select test.denied('E: UPDATE directo', $$update public.alertas set estado = 'resuelta', resuelta_at = now()$$);
select test.denied('E: DELETE directo', $$delete from public.alertas$$);
reset role;
select test.become('authenticated', test.u_cli_b());
select test.eq('E: otro cliente ve solo las suyas', (select count(*) from public.alertas where cliente_id <> 2), 0::bigint);
select test.eq('E: otro cliente ve la suya', (select count(*) from public.v_alertas where vehiculo_id = 913), 1::bigint);
reset role;
select test.become('authenticated', test.u_admin());
select test.denied('E: ni el admin escribe directo (solo por RPC o triggers)', $$update public.alertas set nota_reconocida = 'x'$$);
reset role;
select test.become('authenticated', test.u_api());
select test.eq('E: api ve 0 alertas', (select count(*) from public.alertas) + (select count(*) from public.v_alertas), 0::bigint);
reset role;
select test.become('authenticated', test.u_sinperfil());
select test.eq('E: sin perfil ve 0', (select count(*) from public.alertas) + (select count(*) from public.v_alertas), 0::bigint);
reset role;
select test.become('anon', null);
select test.denied('E: anon no lee alertas', 'select count(*) from public.alertas');
select test.denied('E: anon no lee v_alertas', 'select count(*) from public.v_alertas');
reset role;

-- ---------------------------------------------------------------------------------------------
-- F. Auditoría, funciones internas, consistencia y planes
-- ---------------------------------------------------------------------------------------------
select test.eq('F: audit_log registra la apertura (INSERT) de alertas',
  (select count(*) > 0 from public.audit_log where entidad = 'alertas' and accion = 'INSERT' and entidad_id = :'a_n'), true);
select test.eq('F: audit_log registra el reconocimiento con el usuario de la sucursal',
  (select count(*) > 0 from public.audit_log where entidad = 'alertas' and accion = 'UPDATE' and entidad_id = :'a_n'
     and actor_id = test.u_c91n() and despues ->> 'estado' = 'reconocida'), true);
select test.eq('F: audit_log registra la resolución con el usuario del cliente',
  (select count(*) > 0 from public.audit_log where entidad = 'alertas' and accion = 'UPDATE' and entidad_id = :'a_n'
     and actor_id = test.u_cli_a() and despues ->> 'estado' = 'resuelta'), true);
select test.eq('F: las funciones internas no las ejecuta nadie fuera del dueño',
  (select string_agg(p.proname || ':' || has_function_privilege('anon', p.oid, 'execute')::text || has_function_privilege('authenticated', p.oid, 'execute')::text, ',' order by p.proname)
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('alerta_sincronizar', 'alerta_cargar', 'trg_alerta_mediciones', 'trg_alerta_neumaticos', 'trg_alerta_clientes')),
  'alerta_cargar:falsefalse,alerta_sincronizar:falsefalse,trg_alerta_clientes:falsefalse,trg_alerta_mediciones:falsefalse,trg_alerta_neumaticos:falsefalse');
select test.eq('F: las RPC públicas: authenticated sí, anon no',
  (select string_agg(p.proname || ':' || has_function_privilege('anon', p.oid, 'execute')::text || has_function_privilege('authenticated', p.oid, 'execute')::text, ',' order by p.proname)
     from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname in ('alerta_reconocer', 'alerta_silenciar', 'alerta_resolver', 'alerta_configurar')),
  'alerta_configurar:falsetrue,alerta_reconocer:falsetrue,alerta_resolver:falsetrue,alerta_silenciar:falsetrue');
select test.eq('F: toda función alerta_* es SECURITY DEFINER con search_path vacío',
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and (p.proname like 'alerta\_%' or p.proname like 'trg\_alerta\_%')
      and not (p.prosecdef and 'search_path=""' = any (p.proconfig))), 0::bigint);
select test.eq('F: la tabla tiene RLS activa y authenticated solo SELECT',
  (select relrowsecurity::text from pg_class where oid = 'public.alertas'::regclass)
  || '|' || (select string_agg(privilege_type, ',' order by privilege_type) from information_schema.role_table_grants
              where table_schema = 'public' and table_name = 'alertas' and grantee = 'authenticated'), 'true|SELECT');
select test.eq('F: v_alertas sigue con security_invoker',
  (select reloptions::text from pg_class where oid = 'public.v_alertas'::regclass), '{security_invoker=true}');

-- Consistencia con v_estado_neumaticos: todo neumático crítico tiene su alerta no resuelta (la banda de histéresis
-- solo puede dejar alertas de más, nunca de menos).
select test.eq('F: ningún neumático crítico queda sin alerta (toda la base de prueba)',
  (select count(*) from public.v_estado_neumaticos e
    where e.estado = 'critico' and e.neumatico_id is not null
      and not exists (select 1 from public.alertas a where a.neumatico_id = e.neumatico_id and a.estado <> 'resuelta')), 0::bigint);
select test.eq('F: ninguna alerta no resuelta con el neumático sano (>= umbral + histéresis)',
  (select count(*) from public.alertas a join public.v_estado_neumaticos e on e.neumatico_id = a.neumatico_id
    join public.clientes c on c.id = a.cliente_id
    where a.estado <> 'resuelta' and e.promedio >= c.umbral_critico_mm + c.alerta_histeresis_mm), 0::bigint);
select test.eq('F: una sola alerta no resuelta por neumático (índice único parcial)',
  (select count(*) from (select neumatico_id from public.alertas where estado <> 'resuelta' group by 1 having count(*) > 1) x), 0::bigint);

-- Planes: por debajo de jit_above_cost (100000) para que PG16 no compile con JIT.
select test.become('authenticated', test.u_cli_a());
select test.eq('F: plan de v_alertas (página de Inicio) < 100000',
  test.costo91('select * from public.v_alertas order by vehiculo_id, posicion limit 1000') < 100000, true);
select test.eq('F: plan de v_alertas de un vehículo < 100000',
  test.costo91('select * from public.v_alertas where vehiculo_id = 911') < 100000, true);
reset role;
select test.eq('F: plan de la evaluación por neumático (alerta_sincronizar) < 100000',
  test.costo91('select s.neumatico_id from public.v_estado_neumaticos s join public.clientes c on c.id = s.cliente_id where s.cliente_id = 1 and s.neumatico_id = any (array[1,2,3]::bigint[])') < 100000, true);
select test.eq('F: plan de la evaluación de todo el cliente < 100000',
  test.costo91('select s.neumatico_id from public.v_estado_neumaticos s join public.clientes c on c.id = s.cliente_id where s.cliente_id = 1') < 100000, true);

-- La evaluación es idempotente: reejecutarla no cambia nada.
select count(*) as antes from public.alertas \gset
select public.alerta_sincronizar(1::bigint, null);
select public.alerta_sincronizar(2::bigint, null);
select test.eq('F: reevaluar de nuevo no crea ni duplica alertas', (select count(*) from public.alertas), :antes::bigint);

rollback;
