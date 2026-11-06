-- neumatico_rotar: permisos, intercambio atómico, movimiento a posición libre y eventos.

-- Permisos
begin;
-- (desde 20261108 el cliente puede rotar en SU vehículo: ver t_70; aquí, el de OTRO cliente sigue denegado)
select test.become('authenticated', test.u_cli_a());
select test.denied('cliente no puede rotar el vehículo de otro cliente', $$select public.neumatico_rotar(3::bigint, 1::smallint, 2::smallint)$$);
rollback;
begin;
select test.become('authenticated', test.u_api());
select test.denied('api no puede rotar', $$select public.neumatico_rotar(1::bigint, 1::smallint, 2::smallint)$$);
rollback;
begin;
select test.become('authenticated', test.u_sinperfil());
select test.denied('sin perfil no puede rotar', $$select public.neumatico_rotar(1::bigint, 1::smallint, 2::smallint)$$);
rollback;
begin;
select test.become('anon', null);
select test.denied('anon sin execute en neumatico_rotar', $$select public.neumatico_rotar(1::bigint, 1::smallint, 2::smallint)$$);
rollback;

-- Admin: intercambio
begin;
select test.become('authenticated', test.u_admin());
select test.eq('admin: intercambio P1<->P2',
  (public.neumatico_rotar(1::bigint, 1::smallint, 2::smallint, 12345)->>'intercambio')::boolean, true);
select test.eq('T-1-1 queda en P2', (select posicion from public.neumaticos where idneumatico='T-1-1'), 2::smallint);
select test.eq('T-1-2 queda en P1', (select posicion from public.neumaticos where idneumatico='T-1-2'), 1::smallint);
select test.eq('se registran 2 eventos de rotación',
  (select count(*) from public.eventos_neumatico where tipo='rotacion' and vehiculo_id=1 and odometro_km=12345), 2::bigint);
select test.eq('evento de T-1-1: 1 -> 2',
  (select posicion_origen*10+posicion_destino from public.eventos_neumatico where idneumatico='T-1-1' and tipo='rotacion'), 12);
select test.eq('evento de T-1-2: 2 -> 1',
  (select posicion_origen*10+posicion_destino from public.eventos_neumatico where idneumatico='T-1-2' and tipo='rotacion'), 21);
select test.eq('created_by = admin',
  (select count(*) from public.eventos_neumatico where tipo='rotacion' and created_by = test.u_admin()), 2::bigint);
rollback;

-- Admin: mover a posición libre (un solo evento)
begin;
select test.become('authenticated', test.u_admin());
select test.eq('admin: mover a posición libre',
  (public.neumatico_rotar(1::bigint, 1::smallint, 20::smallint)->>'intercambio')::boolean, false);
select test.eq('T-1-1 en P20', (select posicion from public.neumaticos where idneumatico='T-1-1'), 20::smallint);
select test.eq('un solo evento', (select count(*) from public.eventos_neumatico where tipo='rotacion' and vehiculo_id=1), 1::bigint);
select test.eq('odómetro nulo por defecto', (select odometro_km is null from public.eventos_neumatico where tipo='rotacion'), true);
rollback;

-- Validaciones: ante error no cambia nada (cada denied corre en su subtransacción)
begin;
select test.become('authenticated', test.u_admin());
select test.denied('posición origen inexistente', $$select public.neumatico_rotar(1::bigint, 50::smallint, 2::smallint)$$, 'P0002');
select test.denied('vehículo sin neumáticos', $$select public.neumatico_rotar(2::bigint, 1::smallint, 2::smallint)$$, 'P0002');
select test.denied('posiciones iguales', $$select public.neumatico_rotar(1::bigint, 1::smallint, 1::smallint)$$, '22023');
select test.denied('destino fuera de rango', $$select public.neumatico_rotar(1::bigint, 1::smallint, 100::smallint)$$, '23514');
select test.denied('destino ocupado por neumático dado de baja', $$select public.neumatico_rotar(1::bigint, 1::smallint, 9::smallint)$$, '23514');
select test.denied('odómetro negativo', $$select public.neumatico_rotar(1::bigint, 1::smallint, 2::smallint, -1)$$, '23514');
select test.eq('T-1-1 sigue en P1', (select posicion from public.neumaticos where idneumatico='T-1-1'), 1::smallint);
select test.eq('T-1-2 sigue en P2', (select posicion from public.neumaticos where idneumatico='T-1-2'), 2::smallint);
select test.eq('sin eventos de rotación', (select count(*) from public.eventos_neumatico where tipo='rotacion'), 0::bigint);
rollback;

-- Atomicidad: si el evento no se puede registrar, el intercambio se revierte
begin;
select test.become('authenticated', test.u_admin());
-- odómetro fuera de rango de integer no cabe; usamos un trigger que falla al insertar el evento de rotación
reset role;
create function pg_temp.falla_evento() returns trigger language plpgsql as $$
begin raise exception 'fallo simulado' using errcode = 'P0001'; end $$;
create trigger trg_falla_evento before insert on public.eventos_neumatico
  for each row when (new.tipo = 'rotacion') execute function pg_temp.falla_evento();
select test.become('authenticated', test.u_admin());
select test.denied('fallo al registrar el evento', $$select public.neumatico_rotar(1::bigint, 1::smallint, 2::smallint)$$, 'P0001');
select test.eq('intercambio revertido: T-1-1 en P1', (select posicion from public.neumaticos where idneumatico='T-1-1'), 1::smallint);
select test.eq('intercambio revertido: T-1-2 en P2', (select posicion from public.neumaticos where idneumatico='T-1-2'), 2::smallint);
rollback;
