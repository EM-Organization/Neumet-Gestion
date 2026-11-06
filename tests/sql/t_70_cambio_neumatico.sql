-- neumatico_cambiar / vehiculo_registrar_odometro / neumatico_rotar abierta al alcance del cliente:
-- autorización (admin, cliente global, seccional, otro cliente, api, anon), stock, atomicidad.
-- Todo en una transacción que se revierte; cada escenario vuelve a un savepoint.
begin;

insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-0000000000e1', 'sa70@t'), ('a0000000-0000-0000-0000-0000000000e2', 'sb70@t');
insert into public.sucursales (id, cliente_id, nombre) overriding system value values
  (201, 1, 'Seccional A'), (202, 1, 'Seccional B');
insert into public.perfiles (user_id, rol, cliente_id, sucursal_id) values
  ('a0000000-0000-0000-0000-0000000000e1', 'cliente', 1, 201),
  ('a0000000-0000-0000-0000-0000000000e2', 'cliente', 1, 202);
update public.vehiculos set sucursal_id = 201 where id = 1;
update public.vehiculos set sucursal_id = 202 where id = 2;
insert into public.neumaticos (vehiculo_id, cliente_id, posicion, idneumatico, estado, marca) values
  (2, 1, 1, 'T-2-1', 'montado', 'Vieja'), (2, 1, 2, 'T-2-2', 'montado', 'Vieja');
insert into public.stock_neumaticos (id, cliente_id, marca, modelo, cantidad, precio_unidad) overriding system value values
  (701, 1, 'Marca X', 'Modelo Y', 2, 1500.50),
  (702, 1, 'Marca Vacia', null, 0, 10),
  (703, 2, 'Marca Ajena', null, 5, 10);
create or replace function test.u_s70a() returns uuid language sql immutable as $$ select 'a0000000-0000-0000-0000-0000000000e1'::uuid $$;
create or replace function test.u_s70b() returns uuid language sql immutable as $$ select 'a0000000-0000-0000-0000-0000000000e2'::uuid $$;
grant execute on function test.u_s70a(), test.u_s70b() to public;
update public.vehiculos set odometro_km = 1000 where id = 1;
savepoint s0;

-- Permisos de ejecución
select test.become('anon', null);
select test.denied('anon no ejecuta neumatico_cambiar', $$select public.neumatico_cambiar(1::bigint,1::smallint,'baja','x',null,null,'{"marca":"M"}')$$);
select test.denied('anon no ejecuta registrar_odometro', $$select public.vehiculo_registrar_odometro(1::bigint, 5)$$);
reset role;
select test.become('authenticated', test.u_admin());
select test.denied('el helper interno no es invocable por authenticated', $$select * from public.neumatico_autorizar_vehiculo(1::bigint)$$);
reset role;
rollback to s0;

-- Admin: baja + stock
select test.become('authenticated', test.u_admin());
select test.eq('admin: cambio con stock devuelve el nuevo',
  (public.neumatico_cambiar(1::bigint, 1::smallint, 'baja', 'Corte lateral', 2000, 701)->>'stock_restante')::int, 1);
select test.eq('viejo en baja con motivo y fecha',
  (select estado || '|' || motivo_baja || '|' || (fecha_baja is not null) from public.neumaticos where idneumatico='T-1-1'), 'baja|Corte lateral|true');
select test.eq('viejo fuera de la posición 1', (select posicion <> 1 from public.neumaticos where idneumatico='T-1-1'), true);
select test.eq('nuevo montado en P1 con marca/modelo/precio del stock',
  (select marca||'|'||modelo||'|'||precio_unidad||'|'||estado||'|'||vida||'|'||stock_id from public.neumaticos where vehiculo_id=1 and posicion=1), 'Marca X|Modelo Y|1500.50|montado|0|701');
select test.eq('stock descontado', (select cantidad from public.stock_neumaticos where id=701), 1);
select test.eq('eventos: baja + montaje con odómetro',
  (select string_agg(tipo || ':' || odometro_km, ',' order by id) from public.eventos_neumatico where created_by = test.u_admin()), 'baja:2000,montaje:2000');
select test.eq('costo del montaje = precio', (select costo from public.eventos_neumatico where tipo='montaje' and created_by = test.u_admin()), 1500.50);
select test.eq('odómetro del vehículo sube', (select odometro_km from public.vehiculos where id=1), 2000);
select test.eq('idneumatico generado único', (select count(distinct idneumatico) from public.neumaticos where vehiculo_id=1), 10::bigint);
reset role;
rollback to s0;

-- Cliente GLOBAL del mismo cliente: reencauche suma vida, ingresa uno nuevo
select test.become('authenticated', test.u_cli_a());
select test.eq('cliente global: cambio con neumático ingresado',
  (public.neumatico_cambiar(1::bigint, 2::smallint, 'reencauche', null, 500, null,
     '{"marca":"Pirelli","modelo":"FR85","codigo":"AB-1","precio":1200,"vida":1}'::jsonb)->>'posicion')::int, 2);
select test.eq('viejo: reencauche suma vida y queda almacenado',
  (select vida||'|'||estado from public.neumaticos where idneumatico='T-1-2'), '1|almacenado');
select test.eq('nuevo: datos ingresados',
  (select marca||'|'||modelo||'|'||codigo||'|'||precio_unidad||'|'||vida from public.neumaticos where vehiculo_id=1 and posicion=2), 'Pirelli|FR85|AB-1|1200.00|1');
select test.eq('eventos: desmontaje + reencauche + montaje',
  (select string_agg(tipo, ',' order by id) from public.eventos_neumatico where created_by = test.u_cli_a()), 'desmontaje,reencauche,montaje');
select test.eq('odómetro repetido o menor en el cambio no baja el del vehículo', (select odometro_km from public.vehiculos where id=1), 1000);
select test.eq('registrar odómetro igual es válido',
  (public.vehiculo_registrar_odometro(1::bigint, 1000)->>'odometro_km')::int, 1000);
select test.denied('cliente no baja el odómetro', $$select public.vehiculo_registrar_odometro(1::bigint, 10)$$, '23514');
select test.eq('cliente sube el odómetro', (public.vehiculo_registrar_odometro(1::bigint, 1500)->>'anterior')::int, 1000);
-- reparación y almacenado
select test.eq('reparacion: destino del viejo',
  (public.neumatico_cambiar(1::bigint, 3::smallint, 'reparacion', 'Pinchazo', null, 701)->>'destino_viejo'), 'reparacion');
select test.eq('estado reparacion', (select estado from public.neumaticos where idneumatico='T-1-3'), 'reparacion');
select test.eq('almacenado: destino del viejo',
  (public.neumatico_cambiar(1::bigint, 4::smallint, 'almacenado', null, null, null, '{"marca":"Z"}')->>'destino_viejo'), 'almacenado');
-- el cliente no escribe tablas directamente
select test.denied('cliente no inserta neumáticos directo', $$insert into public.neumaticos (vehiculo_id, cliente_id, posicion) values (1,1,50)$$);
select test.denied('cliente no inserta eventos directo', $$insert into public.eventos_neumatico (cliente_id, vehiculo_id, tipo) values (1,1,'baja')$$);
update public.vehiculos set odometro_km = 5 where id = 1;
select test.eq('cliente no actualiza vehículos directo (RLS: sin efecto)', (select odometro_km from public.vehiculos where id=1), 1500);
-- rotación abierta al mismo alcance
select test.eq('cliente global rota en su vehículo',
  (public.neumatico_rotar(1::bigint, 5::smallint, 6::smallint)->>'intercambio')::boolean, true);
select test.denied('cliente global no rota el vehículo de otro cliente', $$select public.neumatico_rotar(3::bigint, 1::smallint, 2::smallint)$$);
reset role;
rollback to s0;

-- Seccional A: su vehículo sí; el de la seccional B no; stock no
select test.become('authenticated', test.u_s70a());
select test.eq('seccional A cambia en su vehículo',
  (public.neumatico_cambiar(1::bigint, 5::smallint, 'baja', 'Desgaste', 100, null, '{"marca":"N"}')->>'posicion')::int, 5);
select test.denied('seccional A no cambia en el vehículo de la seccional B', $$select public.neumatico_cambiar(2::bigint,1::smallint,'baja','x',null,null,'{"marca":"N"}')$$);
select test.denied('seccional A no registra odómetro de la seccional B', $$select public.vehiculo_registrar_odometro(2::bigint, 9)$$);
select test.denied('seccional A no rota en la seccional B', $$select public.neumatico_rotar(2::bigint, 1::smallint, 2::smallint)$$);
select test.denied('seccional A no usa el stock (solo perfil global)', $$select public.neumatico_cambiar(1::bigint,6::smallint,'baja','x',null,701)$$);
select test.eq('seccional A rota en su vehículo',
  (public.neumatico_rotar(1::bigint, 7::smallint, 8::smallint)->>'intercambio')::boolean, true);
select test.eq('seccional A registra odómetro propio', (public.vehiculo_registrar_odometro(1::bigint, 3000)->>'odometro_km')::int, 3000);
reset role;
select test.become('authenticated', test.u_s70b());
select test.denied('seccional B no cambia en el vehículo de la seccional A', $$select public.neumatico_cambiar(1::bigint,1::smallint,'baja','x',null,null,'{"marca":"N"}')$$);
select test.eq('seccional B cambia en el suyo',
  (public.neumatico_cambiar(2::bigint, 1::smallint, 'baja', 'x', null, null, '{"marca":"N"}')->>'posicion')::int, 1);
reset role;
rollback to s0;

-- Otro cliente, api, sin perfil
select test.become('authenticated', test.u_cli_b());
select test.denied('cliente de otro cliente NO cambia', $$select public.neumatico_cambiar(1::bigint,1::smallint,'baja','x',null,null,'{"marca":"N"}')$$);
select test.denied('cliente de otro cliente NO registra odómetro', $$select public.vehiculo_registrar_odometro(1::bigint, 99999)$$);
select test.denied('vehículo inexistente = mismo rechazo', $$select public.neumatico_cambiar(999::bigint,1::smallint,'baja','x',null,null,'{"marca":"N"}')$$);
reset role;
select test.become('authenticated', test.u_cli_a());
select test.denied('cliente A NO cambia en vehículo de cliente B', $$select public.neumatico_cambiar(3::bigint,1::smallint,'baja','x',null,null,'{"marca":"N"}')$$);
reset role;
select test.become('authenticated', test.u_api());
select test.denied('rol api NO cambia', $$select public.neumatico_cambiar(1::bigint,1::smallint,'baja','x',null,null,'{"marca":"N"}')$$);
reset role;
select test.become('authenticated', test.u_sinperfil());
select test.denied('sin perfil NO cambia', $$select public.neumatico_cambiar(1::bigint,1::smallint,'baja','x',null,null,'{"marca":"N"}')$$);
reset role;
select test.eq('nada cambió tras los rechazos', (select count(*) from public.eventos_neumatico where tipo in ('baja','desmontaje') and created_by is not null), 0::bigint);
rollback to s0;

-- Validaciones y stock
select test.become('authenticated', test.u_cli_a());
select test.denied('stock de OTRO cliente rechazado', $$select public.neumatico_cambiar(1::bigint,1::smallint,'baja','x',null,703)$$, 'P0002');
select test.denied('stock inexistente', $$select public.neumatico_cambiar(1::bigint,1::smallint,'baja','x',null,99999)$$, 'P0002');
select test.denied('stock con cantidad 0 rechazado', $$select public.neumatico_cambiar(1::bigint,1::smallint,'baja','x',null,702)$$, '55000');
select test.denied('sin nuevo (ni stock ni ingresado)', $$select public.neumatico_cambiar(1::bigint,1::smallint,'baja','x')$$, '22023');
select test.denied('stock y nuevo a la vez', $$select public.neumatico_cambiar(1::bigint,1::smallint,'baja','x',null,701,'{"marca":"N"}')$$, '22023');
select test.denied('baja sin motivo', $$select public.neumatico_cambiar(1::bigint,1::smallint,'baja','  ',null,701)$$, '22023');
select test.denied('destino inválido', $$select public.neumatico_cambiar(1::bigint,1::smallint,'tirar','x',null,701)$$, '22023');
select test.denied('posición vacía', $$select public.neumatico_cambiar(1::bigint,50::smallint,'baja','x',null,701)$$, 'P0002');
select test.denied('posición con neumático en baja', $$select public.neumatico_cambiar(1::bigint,9::smallint,'baja','x',null,701)$$, '23514');
select test.denied('odómetro negativo', $$select public.neumatico_cambiar(1::bigint,1::smallint,'baja','x',-1,701)$$, '23514');
select test.denied('nuevo sin marca', $$select public.neumatico_cambiar(1::bigint,1::smallint,'baja','x',null,null,'{"modelo":"M"}')$$, '22023');
select test.denied('precio negativo', $$select public.neumatico_cambiar(1::bigint,1::smallint,'baja','x',null,null,'{"marca":"M","precio":-5}')$$, '23514');
select test.denied('precio no numérico', $$select public.neumatico_cambiar(1::bigint,1::smallint,'baja','x',null,null,'{"marca":"M","precio":"abc"}')$$, '22023');
select test.denied('vida fuera de rango', $$select public.neumatico_cambiar(1::bigint,1::smallint,'baja','x',null,null,'{"marca":"M","vida":4}')$$, '23514');
select test.eq('ningún rechazo tocó el stock', (select cantidad from public.stock_neumaticos where id=701), 2);
select test.eq('ningún rechazo tocó los neumáticos', (select count(*) from public.neumaticos where vehiculo_id=1 and estado='montado'), 8::bigint);
reset role;
-- vida máxima
update public.neumaticos set vida = 3 where idneumatico = 'T-1-1';
select test.become('authenticated', test.u_cli_a());
select test.denied('reencauche con vida máxima', $$select public.neumatico_cambiar(1::bigint,1::smallint,'reencauche',null,null,701)$$, '23514');
reset role;
rollback to s0;

-- Atomicidad: si falla el evento de montaje (último paso), no queda nada a medias
create function pg_temp.falla_montaje() returns trigger language plpgsql as $$
begin raise exception 'fallo simulado' using errcode = 'P0001'; end $$;
create trigger trg_falla_montaje before insert on public.eventos_neumatico
  for each row when (new.tipo = 'montaje') execute function pg_temp.falla_montaje();
select test.become('authenticated', test.u_cli_a());
select test.denied('fallo al registrar el montaje', $$select public.neumatico_cambiar(1::bigint,1::smallint,'baja','x',777,701)$$, 'P0001');
select test.eq('atomicidad: viejo intacto', (select estado||'|'||posicion from public.neumaticos where idneumatico='T-1-1'), 'montado|1');
select test.eq('atomicidad: sin neumático nuevo', (select count(*) from public.neumaticos where vehiculo_id=1), 9::bigint);
select test.eq('atomicidad: stock intacto', (select cantidad from public.stock_neumaticos where id=701), 2);
select test.eq('atomicidad: odómetro intacto', (select odometro_km from public.vehiculos where id=1), 1000);
select test.eq('atomicidad: sin eventos de baja', (select count(*) from public.eventos_neumatico where tipo='baja' and created_by = test.u_cli_a()), 0::bigint);
reset role;
rollback to s0;

rollback;
