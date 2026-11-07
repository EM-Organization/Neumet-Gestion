-- Número de quema (neumaticos.numero_quema) y km previos (neumaticos.km_previos):
-- restricciones, unicidad por cliente, neumatico_cambiar con los parámetros nuevos, compatibilidad con la
-- firma anterior, odómetro del vehículo como dato aparte y alcance por rol (admin, global, sucursal, otro cliente).
-- Todo en una transacción que se revierte; cada escenario vuelve a un savepoint.
begin;

insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-0000000000c1', 'sq75a@t'), ('a0000000-0000-0000-0000-0000000000c2', 'sq75b@t');
insert into public.sucursales (id, cliente_id, nombre) overriding system value values
  (251, 1, 'Sucursal Q-A'), (252, 1, 'Sucursal Q-B');
insert into public.perfiles (user_id, rol, cliente_id, sucursal_id) values
  ('a0000000-0000-0000-0000-0000000000c1', 'cliente', 1, 251),
  ('a0000000-0000-0000-0000-0000000000c2', 'cliente', 1, 252);
update public.vehiculos set sucursal_id = 251 where id = 1;
update public.vehiculos set sucursal_id = 252 where id = 2;
insert into public.neumaticos (vehiculo_id, cliente_id, posicion, idneumatico, estado, marca) values
  (2, 1, 1, 'Q-2-1', 'montado', 'Vieja'), (2, 1, 2, 'Q-2-2', 'montado', 'Vieja');
insert into public.stock_neumaticos (id, cliente_id, marca, modelo, cantidad, precio_unidad) overriding system value values
  (751, 1, 'Marca Q', 'Modelo Q', 3, 900);
create or replace function test.u_q75a() returns uuid language sql immutable as $$ select 'a0000000-0000-0000-0000-0000000000c1'::uuid $$;
create or replace function test.u_q75b() returns uuid language sql immutable as $$ select 'a0000000-0000-0000-0000-0000000000c2'::uuid $$;
grant execute on function test.u_q75a(), test.u_q75b() to public;
update public.vehiculos set odometro_km = 1000 where id = 1;
savepoint s0;

-- Columnas nuevas: valores por defecto y restricciones
select test.eq('km_previos por defecto 0 y quema nula',
  (select km_previos||'|'||coalesce(numero_quema, 'nulo') from public.neumaticos where idneumatico = 'T-1-1'), '0|nulo');
update public.neumaticos set numero_quema = '  AB-123  ' where idneumatico = 'T-1-1';
select test.eq('el trigger recorta la quema', (select numero_quema from public.neumaticos where idneumatico = 'T-1-1'), 'AB-123');
update public.neumaticos set numero_quema = '   ' where idneumatico = 'T-1-1';
select test.eq('quema en blanco queda nula', (select numero_quema is null from public.neumaticos where idneumatico = 'T-1-1'), true);
select test.denied('quema de más de 40 caracteres',
  $$update public.neumaticos set numero_quema = repeat('Q', 41) where idneumatico = 'T-1-1'$$, '23514');
update public.neumaticos set numero_quema = repeat('Q', 40) where idneumatico = 'T-1-1';
select test.eq('quema de exactamente 40 caracteres', (select length(numero_quema) from public.neumaticos where idneumatico = 'T-1-1'), 40);
select test.denied('km_previos negativo', $$update public.neumaticos set km_previos = -1 where idneumatico = 'T-1-1'$$, '23514');
select test.denied('km_previos fuera de rango', $$update public.neumaticos set km_previos = 1000000000 where idneumatico = 'T-1-1'$$, '23514');
-- Unicidad por cliente, sin distinguir mayúsculas; el mismo número en otro cliente es válido
update public.neumaticos set numero_quema = 'Q-100' where idneumatico = 'T-1-1';
select test.denied('misma quema en el mismo cliente (otra caja)',
  $$update public.neumaticos set numero_quema = 'q-100' where idneumatico = 'T-1-2'$$, '23505');
select test.denied('misma quema con espacios en el mismo cliente',
  $$update public.neumaticos set numero_quema = ' Q-100 ' where idneumatico = 'T-1-2'$$, '23505');
update public.neumaticos set numero_quema = 'Q-100' where vehiculo_id = 3 and posicion = 1;
select test.eq('la misma quema en otro cliente es válida',
  (select count(*) from public.neumaticos where lower(numero_quema) = 'q-100'), 2::bigint);
update public.neumaticos set numero_quema = null where idneumatico in ('T-1-2', 'T-1-3');
select test.eq('varias quemas nulas conviven', (select count(*) from public.neumaticos where cliente_id = 1 and numero_quema is null), (select count(*) from public.neumaticos where cliente_id = 1) - 1);
rollback to s0;

-- Admin: cambio con quema y km previos desde el stock
select test.become('authenticated', test.u_admin());
select test.eq('admin: cambio con quema y km previos',
  (public.neumatico_cambiar(1::bigint, 1::smallint, 'baja', 'Corte', 1200, 751, null, ' Q-7 ', 35000)->>'numero_quema'), 'Q-7');
select test.eq('nuevo neumático guarda quema recortada y km previos',
  (select numero_quema||'|'||km_previos||'|'||estado from public.neumaticos where vehiculo_id = 1 and posicion = 1), 'Q-7|35000|montado');
select test.eq('el evento de montaje deja constancia de la quema y los km previos',
  (select notas like '%quema Q-7%' and notas like '%35000 km previos%' from public.eventos_neumatico where tipo = 'montaje' and created_by = test.u_admin()), true);
select test.eq('el viejo conserva su (ausencia de) quema', (select numero_quema is null from public.neumaticos where idneumatico = 'T-1-1'), true);
reset role;
rollback to s0;

-- Compatibilidad: llamadas con la firma anterior (7 argumentos, por posición y por nombre)
select test.become('authenticated', test.u_cli_a());
select test.eq('firma anterior posicional: quema nula y 0 km previos',
  (public.neumatico_cambiar(1::bigint, 2::smallint, 'baja', 'x', null, null, '{"marca":"N"}'::jsonb)->>'km_previos')::int, 0);
select test.eq('firma anterior por nombre',
  (public.neumatico_cambiar(p_vehiculo_id => 1::bigint, p_posicion => 3::smallint, p_destino_viejo => 'baja',
     p_motivo => 'x', p_nuevo => '{"marca":"N"}'::jsonb)->>'posicion')::int, 3);
select test.eq('sin quema informada: columna nula',
  (select count(*) from public.neumaticos where vehiculo_id = 1 and posicion in (2, 3) and numero_quema is null), 2::bigint);
select test.eq('queda una sola sobrecarga de neumatico_cambiar',
  (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = 'neumatico_cambiar'), 1::bigint);
reset role;
rollback to s0;

-- Neumático nuevo: 0 km es válido y el odómetro del vehículo es un dato aparte
select test.become('authenticated', test.u_cli_a());
select test.eq('0 km previos y sin odómetro: válido',
  (public.neumatico_cambiar(1::bigint, 1::smallint, 'baja', 'x', null, null, '{"marca":"N"}', 'Q-1', 0)->>'km_previos')::int, 0);
select test.eq('sin odómetro, el del vehículo no cambia', (select odometro_km from public.vehiculos where id = 1), 1000);
select test.eq('km previos 80000 con odómetro del vehículo mayor',
  (public.neumatico_cambiar(1::bigint, 2::smallint, 'baja', 'x', 1500, null, '{"marca":"N"}', 'Q-2', 80000)->>'odometro_km')::int, 1500);
select test.eq('los km previos no tocan el odómetro del vehículo', (select odometro_km from public.vehiculos where id = 1), 1500);
select test.denied('odómetro del vehículo menor al actual',
  $$select public.neumatico_cambiar(1::bigint,3::smallint,'baja','x',10,null,'{"marca":"N"}')$$, '23514');
select test.eq('el rechazo no cambió nada',
  (select count(*) from public.neumaticos where vehiculo_id = 1 and posicion = 3 and idneumatico = 'T-1-3'), 1::bigint);
select test.eq('odómetro igual al actual es válido',
  (public.neumatico_cambiar(1::bigint, 3::smallint, 'baja', 'x', 1500, null, '{"marca":"N"}')->>'odometro_km')::int, 1500);
select test.denied('km previos negativo', $$select public.neumatico_cambiar(1::bigint,4::smallint,'baja','x',null,null,'{"marca":"N"}','Q-4',-5)$$, '23514');
select test.denied('km previos enorme', $$select public.neumatico_cambiar(1::bigint,4::smallint,'baja','x',null,null,'{"marca":"N"}','Q-4',1000000000)$$, '23514');
select test.denied('quema de más de 40 caracteres',
  $$select public.neumatico_cambiar(1::bigint,4::smallint,'baja','x',null,null,'{"marca":"N"}',repeat('Z', 41),0)$$, '22023');
select test.eq('km previos nulo se toma como 0',
  (public.neumatico_cambiar(1::bigint, 4::smallint, 'baja', 'x', null, null, '{"marca":"N"}', null, null)->>'km_previos')::int, 0);
reset role;
rollback to s0;

-- Unicidad desde la RPC
select test.become('authenticated', test.u_cli_a());
select test.eq('primera quema registrada',
  (public.neumatico_cambiar(1::bigint, 1::smallint, 'baja', 'x', null, null, '{"marca":"N"}', 'Q-DUP', 0)->>'numero_quema'), 'Q-DUP');
select test.denied('quema repetida en el mismo cliente (otra caja y espacios)',
  $$select public.neumatico_cambiar(1::bigint,2::smallint,'baja','x',null,null,'{"marca":"N"}',' q-dup ',0)$$, '23505');
select test.denied('quema repetida en otro vehículo del mismo cliente',
  $$select public.neumatico_cambiar(2::bigint,1::smallint,'baja','x',null,null,'{"marca":"N"}','Q-DUP',0)$$, '23505');
select test.eq('el rechazo no consumió el neumático viejo',
  (select estado from public.neumaticos where idneumatico = 'T-1-2'), 'montado');
reset role;
select test.become('authenticated', test.u_admin());
select test.denied('admin: quema repetida en otro vehículo del mismo cliente',
  $$select public.neumatico_cambiar(2::bigint,1::smallint,'baja','x',null,null,'{"marca":"N"}','Q-DUP',0)$$, '23505');
reset role;
select test.become('authenticated', test.u_cli_b());
select test.denied('otro cliente no usa el vehículo ajeno',
  $$select public.neumatico_cambiar(1::bigint,5::smallint,'baja','x',null,null,'{"marca":"N"}','Q-B',0)$$);
reset role;
rollback to s0;

-- Sucursales: dentro de su vehículo sí; stock no; el vehículo de otra sucursal no
select test.become('authenticated', test.u_q75a());
select test.eq('sucursal A registra quema en su vehículo',
  (public.neumatico_cambiar(1::bigint, 1::smallint, 'baja', 'x', null, null, '{"marca":"N"}', 'Q-SA', 12000)->>'numero_quema'), 'Q-SA');
select test.eq('sucursal A ve la quema de su neumático',
  (select numero_quema from public.neumaticos where vehiculo_id = 1 and posicion = 1), 'Q-SA');
select test.denied('sucursal A no cambia en la sucursal B',
  $$select public.neumatico_cambiar(2::bigint,1::smallint,'baja','x',null,null,'{"marca":"N"}','Q-X',0)$$);
select test.denied('sucursal A no usa el stock aunque informe quema',
  $$select public.neumatico_cambiar(1::bigint,2::smallint,'baja','x',null,751,null,'Q-Y',0)$$);
reset role;
select test.become('authenticated', test.u_q75b());
select test.eq('sucursal B no ve la quema de la sucursal A',
  (select count(*) from public.neumaticos where numero_quema = 'Q-SA'), 0::bigint);
select test.eq('sucursal B no puede buscar la quema de A en la tabla', (select count(*) from public.neumaticos where lower(numero_quema) like 'q-s%'), 0::bigint);
reset role;
select test.become('authenticated', test.u_cli_a());
select test.eq('cliente global ve la quema de la sucursal A',
  (select count(*) from public.neumaticos where numero_quema = 'Q-SA'), 1::bigint);
reset role;
select test.become('authenticated', test.u_cli_b());
select test.eq('otro cliente no ve ninguna quema ajena', (select count(*) from public.neumaticos where numero_quema = 'Q-SA'), 0::bigint);
reset role;
select test.become('anon', null);
select test.denied('anon no ejecuta neumatico_cambiar',
  $$select public.neumatico_cambiar(1::bigint,1::smallint,'baja','x',null,null,'{"marca":"N"}','Q-Z',0)$$);
reset role;
select test.become('authenticated', test.u_api());
select test.denied('rol api no ejecuta neumatico_cambiar',
  $$select public.neumatico_cambiar(1::bigint,1::smallint,'baja','x',null,null,'{"marca":"N"}','Q-Z',0)$$);
reset role;
rollback to s0;

-- Las vistas y sus grants siguen igual (las columnas nuevas no se filtran por ellas)
select test.eq('v_estado_neumaticos sigue con security_invoker',
  (select coalesce(reloptions::text, '') like '%security_invoker=true%' from pg_class where relname = 'v_estado_neumaticos'), true);
select test.eq('el trigger de normalización no es ejecutable por authenticated',
  has_function_privilege('authenticated', 'public.neumaticos_normalizar_quema()', 'execute'), false);

rollback;
