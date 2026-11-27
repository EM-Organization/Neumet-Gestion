-- Ola 2 de F8 (migración 20261126030000): alertas de dirección, desparejo y swap; cierres de alerta_sincronizar
-- en orden de prioridad (sin_datos, rotacion, reemplazada, recuperada); v_alertas (color, severidad, swap,
-- umbral_mm); servicio del vehículo y roles con JWT simulado.
--
-- Cada caso va en su propia transacción y se revierte. Datos propios: vehículos 941-944 (4x2), sucursales 941-942
-- y uuids b104... Los umbrales son los del brief (bloque 0); el resto de los casos depende de ellos.
-- Los helpers m104_* se crean fuera de transacción, como los de 01_fixtures.sql.
-- now() es el inicio de la transacción: las mediciones de un mismo caso van con horas distintas.

-- ---- Helpers --------------------------------------------------------------------------------------------------------

create or replace function test.m104_u_emp() returns uuid language sql immutable as $$
  select 'b1040000-0000-0000-0000-0000000000c1'::uuid $$;
create or replace function test.m104_u_suc() returns uuid language sql immutable as $$
  select 'b1040000-0000-0000-0000-0000000000c2'::uuid $$;

-- Vehículo 4x2 (dirección: posiciones 1 y 2) con una cubierta montada y sin medición.
create or replace function test.m104_montar(p_veh bigint, p_idn text, p_pos integer,
                                            p_odo integer default 1000, p_suc bigint default null)
returns void language plpgsql as $$
begin
  insert into public.vehiculos (id, cliente_id, sucursal_id, nombre, patente, activo, distribucion, odometro_km)
    values (p_veh, 1, p_suc, 'Tractor ' || p_veh, 'TT' || lpad(p_veh::text, 4, '0'), true, '4x2', p_odo);
  insert into public.neumaticos (vehiculo_id, cliente_id, posicion, idneumatico, estado)
    values (p_veh, 1, p_pos, p_idn, 'montado');
end $$;

-- Medición de hace p_horas horas. La más reciente (created_at desc) es la que cuenta.
create or replace function test.m104_medir(p_veh bigint, p_idn text, p_pos integer, p_horas integer,
                                           p_mm1 numeric, p_mm2 numeric, p_mm3 numeric)
returns void language sql as $$
  insert into public.mediciones (vehiculo_id, cliente_id, posicion, idneumatico, mm1, mm2, mm3, created_at)
    values (p_veh, 1, p_pos, p_idn, p_mm1, p_mm2, p_mm3, now() - make_interval(hours => p_horas));
$$;

-- Dirección: cubierta en la posición 1 con 7,0 mm (aviso: entre el retiro y 8 mm) y alerta abierta.
create or replace function test.m104_direccion(p_veh bigint, p_idn text, p_suc bigint default null)
returns void language plpgsql as $$
begin
  perform test.m104_montar(p_veh, p_idn, 1, 1000, p_suc);
  perform test.m104_medir(p_veh, p_idn, 1, 2, 7, 7, 7);
  perform public.alerta_sincronizar(1, null);
end $$;

-- Swap: cubierta de vida 0 montada con odómetro 10.000 km; el vehículo marca 35.000 (25.000 km, más que 20.000).
create or replace function test.m104_swap(p_veh bigint, p_idn text) returns void language plpgsql as $$
begin
  perform test.m104_montar(p_veh, p_idn, 3, 35000);
  insert into public.eventos_neumatico (cliente_id, vehiculo_id, neumatico_id, idneumatico, tipo, odometro_km, costo, created_at)
    values (1, p_veh, (select id from public.neumaticos where idneumatico = p_idn), p_idn, 'montaje', 10000, 350.00,
            now() - interval '2000 hours');
  perform test.m104_medir(p_veh, p_idn, 3, 2, 10, 10, 10);
  perform public.alerta_sincronizar(1, null);
end $$;

-- Estado de la alerta de un tipo para una cubierta: 'abierta', su motivo de cierre o 'sin alerta'.
create or replace function test.m104_motivo(p_idn text, p_tipo text) returns text language sql stable as $$
  select coalesce(
    (select 'abierta' from public.alertas a join public.neumaticos n on n.id = a.neumatico_id
      where n.idneumatico = p_idn and a.tipo = p_tipo and a.estado <> 'resuelta' limit 1),
    (select a.resuelta_motivo from public.alertas a join public.neumaticos n on n.id = a.neumatico_id
      where n.idneumatico = p_idn and a.tipo = p_tipo order by a.id desc limit 1),
    'sin alerta');
$$;

-- ---- 0. Umbrales del cliente A --------------------------------------------------------------------------------------
begin;
select test.eq('0 cliente A: aviso 8, límite 6, retiro 3, histéresis 0,5, irregularidad 2,0 y swap 20.000 km',
  (select direccion_aviso_mm = 8 and direccion_limite_mm = 6 and umbral_retiro_mm = 3 and alerta_histeresis_mm = 0.5
          and irregularidad_mm = 2 and swap_km = 20000
     from public.clientes where id = 1), true);
rollback;

-- ---- 1. Cierres en orden de prioridad: sin_datos, rotacion, reemplazada, recuperada ----------------------------------
-- 1a. sin_datos: la medición deja de contar (invalidada) y la cubierta sigue en su posición.
begin;
select test.m104_direccion(941, 'T104-1');
select test.eq('1a precondición: alerta de dirección abierta con 7,0 mm', test.m104_motivo('T104-1', 'direccion_aviso'), 'abierta');
update public.mediciones set calidad = 'invalidada', calidad_motivo = 'prueba' where idneumatico = 'T104-1';
select public.alerta_sincronizar(1, null);
select test.eq('1a sin_datos: queda sin medición válida', test.m104_motivo('T104-1', 'direccion_aviso'), 'sin_datos');
rollback;

-- 1b. sin_datos: pasa a auxilio (99). docs/08 W.2: las alertas abiertas de una cubierta en la 99 cierran sin_datos.
begin;
select test.m104_direccion(941, 'T104-1');
select test.eq('1b precondición', test.m104_motivo('T104-1', 'direccion_aviso'), 'abierta');
update public.neumaticos set posicion = 99 where idneumatico = 'T104-1';
select public.alerta_sincronizar(1, null);
select test.eq('1b sin_datos: pasa a auxilio (99)', test.m104_motivo('T104-1', 'direccion_aviso'), 'sin_datos');
rollback;

-- 1c. sin_datos antes que rotacion: cambió de posición y además quedó sin medición válida.
-- Primero se mueve (no hay disparador en neumaticos dentro de la transacción) y luego se invalida la medición:
-- su disparador inmediato sincroniza con los dos cambios a la vez.
begin;
select test.m104_direccion(941, 'T104-1');
select test.eq('1c precondición', test.m104_motivo('T104-1', 'direccion_aviso'), 'abierta');
update public.neumaticos set posicion = 3 where idneumatico = 'T104-1';
update public.mediciones set calidad = 'invalidada', calidad_motivo = 'prueba' where idneumatico = 'T104-1';
select public.alerta_sincronizar(1, null);
select test.eq('1c sin_datos antes que rotacion: movida y sin medición válida', test.m104_motivo('T104-1', 'direccion_aviso'), 'sin_datos');
rollback;

-- 1d. rotacion: cambió de posición y la medición (7,0 mm) sigue vigente.
begin;
select test.m104_direccion(941, 'T104-1');
select test.eq('1d precondición', test.m104_motivo('T104-1', 'direccion_aviso'), 'abierta');
update public.neumaticos set posicion = 3 where idneumatico = 'T104-1';
select public.alerta_sincronizar(1, null);
select test.eq('1d rotacion: cambió de posición con 7,0 mm', test.m104_motivo('T104-1', 'direccion_aviso'), 'rotacion');
rollback;

-- 1e. rotacion antes que reemplazada: cambió de posición y quedó bajo el retiro (2,5 mm).
begin;
select test.m104_direccion(941, 'T104-1');
select test.eq('1e precondición', test.m104_motivo('T104-1', 'direccion_aviso'), 'abierta');
update public.neumaticos set posicion = 3 where idneumatico = 'T104-1';
select test.m104_medir(941, 'T104-1', 3, 1, 2.5, 2.5, 2.5);
select public.alerta_sincronizar(1, null);
select test.eq('1e rotacion antes que reemplazada: movida a 2,5 mm', test.m104_motivo('T104-1', 'direccion_aviso'), 'rotacion');
rollback;

-- 1f. reemplazada: sin cambio de posición y bajo el retiro (2,5 mm).
begin;
select test.m104_direccion(941, 'T104-1');
select test.eq('1f precondición', test.m104_motivo('T104-1', 'direccion_aviso'), 'abierta');
select test.m104_medir(941, 'T104-1', 1, 1, 2.5, 2.5, 2.5);
select public.alerta_sincronizar(1, null);
select test.eq('1f reemplazada: 2,5 mm en la misma posición', test.m104_motivo('T104-1', 'direccion_aviso'), 'reemplazada');
rollback;

-- 1g. recuperada: vuelve sobre el aviso más la histéresis (8 + 0,5 = 8,5 mm).
begin;
select test.m104_direccion(941, 'T104-1');
select test.eq('1g precondición', test.m104_motivo('T104-1', 'direccion_aviso'), 'abierta');
select test.m104_medir(941, 'T104-1', 1, 1, 9.5, 9.5, 9.5);
select public.alerta_sincronizar(1, null);
select test.eq('1g recuperada: vuelve a 9,5 mm en la misma posición', test.m104_motivo('T104-1', 'direccion_aviso'), 'recuperada');
rollback;

-- 1h. sin_datos también para el swap: la cubierta pasa a auxilio (99) con el swap abierto.
begin;
select test.m104_swap(944, 'T104-4');
select test.eq('1h precondición: swap abierto a 25.000 km', test.m104_motivo('T104-4', 'swap'), 'abierta');
update public.neumaticos set posicion = 99 where idneumatico = 'T104-4';
select public.alerta_sincronizar(1, null);
select test.eq('1h sin_datos: swap de una cubierta que pasa a auxilio (99)', test.m104_motivo('T104-4', 'swap'), 'sin_datos');
rollback;

-- ---- 2. Desparejo (tipo irregular): diferencia round(máx - mín, 1) >= irregularidad_mm (2,0) ----------------------
begin;
select test.m104_montar(943, 'T104-3', 3);
select test.m104_medir(943, 'T104-3', 3, 1, 10, 8, 9);
select public.alerta_sincronizar(1, null);
select test.eq('2a desparejo: 10/8/9 (diferencia 2,0) abre', test.m104_motivo('T104-3', 'irregular'), 'abierta');
select test.eq('2a desparejo: umbral y apertura en 2,0', (select umbral_mm = 2 and mm_apertura = 2
  from public.alertas a join public.neumaticos n on n.id = a.neumatico_id
  where n.idneumatico = 'T104-3' and a.tipo = 'irregular'), true);
rollback;

begin;
select test.m104_montar(942, 'T104-2', 3);
select test.m104_medir(942, 'T104-2', 3, 1, 10, 8.1, 9);
select public.alerta_sincronizar(1, null);
select test.eq('2b desparejo: 10/8,1/9 (diferencia 1,9) no abre', test.m104_motivo('T104-2', 'irregular'), 'sin alerta');
rollback;

begin;
select test.m104_montar(944, 'T104-4', 3);
select public.alerta_sincronizar(1, null);
-- mm1..mm3 son NOT NULL en la base: el caso real es la falta de medición, no un mm nulo.
select test.eq('2c desparejo: sin medición no abre', test.m104_motivo('T104-4', 'irregular'), 'sin alerta');
rollback;

-- ---- 3. v_alertas: color y severidad por tipo; swap con km y umbral; umbral_mm sigue -------------------------------
begin;
select test.m104_direccion(941, 'T104-1');
select test.m104_montar(942, 'T104-2', 3);
select test.m104_medir(942, 'T104-2', 3, 1, 2.5, 2.5, 2.5);
select test.m104_montar(943, 'T104-3', 3);
select test.m104_medir(943, 'T104-3', 3, 1, 10, 8, 9);
select test.m104_swap(944, 'T104-4');
select public.alerta_sincronizar(1, null);
select test.eq('3 color y severidad: límite rojo 3; el resto amarillo 2',
  (select string_agg(tipo || ':' || color || ':' || severidad, ',' order by tipo)
     from public.v_alertas where vehiculo_id between 941 and 944),
  'direccion_aviso:amarillo:2,irregular:amarillo:2,limite:rojo:3,swap:amarillo:2');
select test.eq('3 swap: valor 25.000 km; km_actual y umbral_km (20.000) no nulos',
  (select valor::text || '|' || (km_actual is not null and umbral_km = 20000)::text
     from public.v_alertas where tipo = 'swap' and vehiculo_id = 944), '25000|true');
select test.eq('3 umbral_mm sigue existiendo en v_alertas',
  (select count(*) from information_schema.columns
    where table_schema = 'public' and table_name = 'v_alertas' and column_name = 'umbral_mm'), 1::bigint);
rollback;

-- ---- 4. vehiculo_fijar_servicio: valor válido se guarda; fuera de catálogo, sin perfil o anónimo, falla -----------
begin;
insert into auth.users (id, email) values ('b1040000-0000-0000-0000-0000000000c1', 'emp104@t');
insert into public.perfiles (user_id, rol, cliente_id, sucursal_id) values
  ('b1040000-0000-0000-0000-0000000000c1', 'cliente', 1, null);
select test.m104_montar(941, 'T104-1', 1);
select test.become('authenticated', test.m104_u_emp());
select public.vehiculo_fijar_servicio(941, 'bus');
select test.eq('4 servicio válido: bus se guarda', (select servicio from public.vehiculos where id = 941), 'bus');
select test.denied('4 servicio fuera de catálogo: tractor da 23514',
  $$select public.vehiculo_fijar_servicio(941, 'tractor')$$, '23514');
select test.become('anon', null);
select test.denied('4 anónimo sin execute: 42501', $$select public.vehiculo_fijar_servicio(941, 'bus')$$);
select test.become('authenticated', test.u_sinperfil());
select test.denied('4 sin perfil de cliente: 42501', $$select public.vehiculo_fijar_servicio(941, 'bus')$$);
rollback;

-- ---- 5. Roles con JWT simulado: admin de empresa, sucursal y sin perfil en v_alertas -------------------------------
begin;
insert into auth.users (id, email) values
  ('b1040000-0000-0000-0000-0000000000c1', 'emp104@t'),
  ('b1040000-0000-0000-0000-0000000000c2', 'suc104@t');
insert into public.sucursales (id, cliente_id, nombre) overriding system value values
  (941, 1, 'Ola 2 Norte'), (942, 1, 'Ola 2 Sur');
insert into public.perfiles (user_id, rol, cliente_id, sucursal_id) values
  ('b1040000-0000-0000-0000-0000000000c1', 'cliente', 1, null),
  ('b1040000-0000-0000-0000-0000000000c2', 'cliente', 1, 941);
select test.m104_direccion(941, 'T104-1', 941);
select test.m104_direccion(942, 'T104-2', 942);
select test.eq('5 precondición: dos vehículos con alerta en dos sucursales',
  (select count(distinct vehiculo_id) from public.v_alertas where vehiculo_id in (941, 942)), 2::bigint);
-- Lo que debe ver el admin de empresa: exactamente las alertas de cliente 1, según el superusuario.
create temp table _m104_admin as select alerta_id from public.v_alertas where cliente_id = 1;
grant select on _m104_admin to public;

select test.become('authenticated', test.m104_u_emp());
select test.eq('5 admin de empresa: ninguna alerta de otro cliente',
  (select count(*) from public.v_alertas where cliente_id <> 1), 0::bigint);
select test.eq('5 admin de empresa: todas las alertas de su cliente',
  (select array_agg(alerta_id order by alerta_id) from public.v_alertas),
  (select array_agg(alerta_id order by alerta_id) from _m104_admin));

select test.become('authenticated', test.m104_u_suc());
select test.eq('5 sucursal: solo alertas de los vehículos de su sucursal',
  (select coalesce(array_agg(distinct vehiculo_id order by vehiculo_id), '{}'::bigint[]) from public.v_alertas),
  '{941}'::bigint[]);

select test.become('authenticated', test.u_sinperfil());
select test.eq('5 sin perfil: ninguna alerta', (select count(*) from public.v_alertas), 0::bigint);
rollback;
