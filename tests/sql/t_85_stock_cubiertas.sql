-- Stock de cubiertas individuales (stock_cubierta_*, neumatico_cambiar con cubierta y devolución a stock):
-- matriz de roles, aislamiento entre clientes, quema única, Nuevo -> Usado al montar, eliminación solo sin uso,
-- historial conservado al mover, montar y devolver, y que las vistas/API actuales no se vean afectadas.
-- Todo en una transacción que se revierte; cada escenario vuelve a un savepoint.
begin;

insert into auth.users (id, email) values ('a0000000-0000-0000-0000-0000000000c5', 'sb85@t');
insert into public.sucursales (id, cliente_id, nombre) overriding system value values
  (401, 1, 'Norte'), (402, 1, 'Sur'), (403, 2, 'Ajena B');
insert into public.perfiles (user_id, rol, cliente_id, sucursal_id) values
  ('a0000000-0000-0000-0000-0000000000c5', 'cliente', 1, 401);
create or replace function test.u_s85() returns uuid language sql immutable as $$ select 'a0000000-0000-0000-0000-0000000000c5'::uuid $$;
grant execute on function test.u_s85() to public;
update public.vehiculos set sucursal_id = 401 where id = 1;
update public.vehiculos set sucursal_id = 402 where id = 2;
insert into public.neumaticos (vehiculo_id, cliente_id, posicion, idneumatico, estado, marca, numero_quema) values
  (2, 1, 1, 'T-2-1', 'montado', 'Vieja', 'Q-MONTADA'), (2, 1, 2, 'T-2-2', 'montado', 'Vieja', null);
insert into public.stock_neumaticos (id, cliente_id, marca, modelo, cantidad, precio_unidad) overriding system value values
  (851, 1, 'Lote X', 'Modelo L', 3, 100);
update public.vehiculos set odometro_km = 1000 where id = 1;
-- Cubiertas de partida (insertadas con privilegios de dueño, como lo haría el seed).
insert into public.neumaticos (vehiculo_id, cliente_id, posicion, marca, modelo, idneumatico, estado, condicion,
                               sucursal_id, numero_quema, precio_unidad) values
  (null, 1, null, 'Michelin', 'X', 'CB-t-a', 'almacenado', 'nuevo', 401, 'S-A1', 500),
  (null, 1, null, 'Pirelli',  'Y', 'CB-t-b', 'almacenado', 'reparado', null, 'S-A2', 300),
  (null, 2, null, 'Ajena',    'Z', 'CB-t-c', 'almacenado', 'nuevo', 403, 'S-B1', 200);
create temp table _c as select numero_quema k, id from public.neumaticos where idneumatico like 'CB-t-%';
grant select on _c to public;
savepoint s0;

-- ---------------------------------------------------------------------------------------------
-- A. Permisos de ejecución y matriz de roles (todas las RPC rechazan con 42501 uniforme)
-- ---------------------------------------------------------------------------------------------
select test.become('anon', null);
select test.denied('anon no agrega', $$select public.stock_cubierta_agregar('X1', 'M')$$);
select test.denied('anon no edita', $$select public.stock_cubierta_editar((select id from pg_temp._c where k = 'S-A1'), '{"marca":"X"}')$$);
select test.denied('anon no mueve', $$select public.stock_cubierta_mover((select id from pg_temp._c where k = 'S-A1'), 402::bigint)$$);
select test.denied('anon no elimina', $$select public.stock_cubierta_eliminar((select id from pg_temp._c where k = 'S-A1'))$$);
reset role;
select test.become('authenticated', test.u_admin());
select test.denied('helper por id no invocable', $$select * from public.stock_cubierta_autorizar_por_id(1::bigint)$$);
select test.denied('helper de sucursal no invocable', $$select public.stock_cubierta_sucursal(1::bigint, 401::bigint)$$);
reset role;

-- Para cada rol sin permiso: las cuatro RPC sobre una cubierta del cliente A
create temp table _roles (rol text, uid uuid);
insert into _roles values ('api', test.u_api()), ('sin perfil', test.u_sinperfil()),
  ('sucursal', test.u_s85()), ('otro cliente (global B)', test.u_cli_b());
grant select on _roles to public;
do $t$
declare r record; v_id bigint := (select id from pg_temp._c where k = 'S-A1');
begin
  for r in select * from pg_temp._roles loop
    perform test.become('authenticated', r.uid);
    if r.rol not like 'otro%' then
      perform test.denied(r.rol || ' no agrega', 'select public.stock_cubierta_agregar(''ZZ'', ''M'')');
    end if;
    perform test.denied(r.rol || ' no agrega a nombre del cliente A', 'select public.stock_cubierta_agregar(''ZZ'', ''M'', null, null, null, null, 1::bigint)');
    perform test.denied(r.rol || ' no edita', format('select public.stock_cubierta_editar(%s, ''{"marca":"X"}'')', v_id));
    perform test.denied(r.rol || ' no mueve', format('select public.stock_cubierta_mover(%s, 402::bigint)', v_id));
    perform test.denied(r.rol || ' no elimina', format('select public.stock_cubierta_eliminar(%s)', v_id));
    reset role;
  end loop;
end
$t$;
select test.eq('la cubierta de A no cambió tras los intentos',
  (select marca || '|' || coalesce(sucursal_id::text, '-') || '|' || condicion from public.neumaticos where idneumatico = 'CB-t-a'), 'Michelin|401|nuevo');
-- Global B (cliente 2) sí puede agregar para SU cliente, pero no con la sucursal de A
select test.become('authenticated', test.u_cli_b());
select test.denied('global B no usa una sucursal de A', $$select public.stock_cubierta_agregar('ZZ', 'M', null, null, null, 401::bigint)$$);
select test.eq('global B agrega en su cliente', (public.stock_cubierta_agregar('ZZ', 'M', null, null, null, 403::bigint)->>'cliente_id'), '2');
reset role;
select test.eq('la agregada por B quedó en el cliente 2', (select cliente_id from public.neumaticos where numero_quema = 'ZZ'), 2::bigint);
rollback to s0;

-- Admin: debe indicar el cliente; actúa sobre cualquiera
select test.become('authenticated', test.u_admin());
select test.denied('admin sin p_cliente_id', $$select public.stock_cubierta_agregar('ADM', 'M')$$, '22004');
select test.denied('admin con cliente inexistente', $$select public.stock_cubierta_agregar('ADM', 'M', null, null, null, null, 999::bigint)$$, 'P0002');
select test.eq('admin agrega al cliente A', (public.stock_cubierta_agregar('ADM', 'M', null, null, null, 401::bigint, 1::bigint)->>'cliente_id'), '1');
select test.denied('admin no cruza clientes (sucursal de B para A)', $$select public.stock_cubierta_agregar('ADM2', 'M', null, null, null, 403::bigint, 1::bigint)$$);
select test.eq('admin mueve la cubierta de B a su sucursal', (public.stock_cubierta_mover((select id from pg_temp._c where k = 'S-B1'), null)->>'movido'), 'true');
select test.denied('admin: cubierta inexistente', $$select public.stock_cubierta_editar(99999::bigint, '{"marca":"X"}')$$, 'P0002');
select test.eq('admin elimina una cubierta nueva de cualquier cliente', (public.stock_cubierta_eliminar((select id from pg_temp._c where k = 'S-B1'))->>'numero_quema'), 'S-B1');
reset role;
rollback to s0;

-- ---------------------------------------------------------------------------------------------
-- B. Agregar (cliente GLOBAL): datos, validaciones y quema única
-- ---------------------------------------------------------------------------------------------
select test.become('authenticated', test.u_cli_a());
select test.eq('global agrega: condición nuevo y sin montar',
  (select r->>'condicion' from (select public.stock_cubierta_agregar('  s-100  ', ' Bridgestone ', ' R249 ', current_date - 5, 450.555, 401::bigint) r) q), 'nuevo');
reset role;
select test.eq('fila: quema recortada, estado almacenado, sin vehículo ni posición, sucursal, precio redondeado',
  (select numero_quema || '|' || estado || '|' || (vehiculo_id is null) || '|' || (posicion is null) || '|' || sucursal_id || '|'
          || condicion || '|' || marca || '|' || modelo || '|' || precio_unidad || '|' || cliente_id || '|' || vida || '|' || km_previos
     from public.neumaticos where lower(numero_quema) = 's-100'),
  's-100|almacenado|true|true|401|nuevo|Bridgestone|R249|450.56|1|0|0');
select test.eq('idneumatico generado con prefijo CB-', (select idneumatico ~ '^CB-1-[0-9a-f]{8}$' from public.neumaticos where numero_quema = 's-100'), true);
select test.eq('evento alta_stock con autor, destino y sin vehículo',
  (select tipo || '|' || sucursal_destino_id || '|' || (vehiculo_id is null) || '|' || (created_by = test.u_cli_a()) from public.eventos_neumatico
    where idneumatico = (select idneumatico from public.neumaticos where numero_quema = 's-100')), 'alta_stock|401|true|true');
select test.become('authenticated', test.u_cli_a());
select test.eq('sin sucursal y sin datos opcionales',
  (public.stock_cubierta_agregar('S-101', 'M')->>'sucursal_id') is null, true);
select test.denied('quema repetida (sin distinguir mayúsculas)', $$select public.stock_cubierta_agregar('S-A1', 'M')$$, '23505');
select test.denied('quema repetida con otra capitalización', $$select public.stock_cubierta_agregar('s-a1', 'M')$$, '23505');
select test.denied('quema repetida de un neumático montado', $$select public.stock_cubierta_agregar('q-montada', 'M')$$, '23505');
select test.denied('quema vacía', $$select public.stock_cubierta_agregar('   ', 'M')$$, '22023');
select test.denied('quema nula', $$select public.stock_cubierta_agregar(null, 'M')$$, '22023');
select test.denied('quema demasiado larga', $$select public.stock_cubierta_agregar(repeat('x', 41), 'M')$$, '22023');
select test.denied('marca vacía', $$select public.stock_cubierta_agregar('S-102', '  ')$$, '22023');
select test.denied('marca demasiado larga', $$select public.stock_cubierta_agregar('S-102', repeat('m', 61))$$, '22023');
select test.denied('precio negativo', $$select public.stock_cubierta_agregar('S-102', 'M', null, null, -1)$$, '23514');
select test.denied('precio fuera de rango', $$select public.stock_cubierta_agregar('S-102', 'M', null, null, 10000000000)$$, '23514');
select test.denied('fecha de compra futura', $$select public.stock_cubierta_agregar('S-102', 'M', null, current_date + 30)$$, '23514');
select test.denied('sucursal de otro cliente', $$select public.stock_cubierta_agregar('S-102', 'M', null, null, null, 403::bigint)$$);
select test.denied('sucursal inexistente (mismo error)', $$select public.stock_cubierta_agregar('S-102', 'M', null, null, null, 99999::bigint)$$);
select test.denied('p_cliente_id ajeno', $$select public.stock_cubierta_agregar('S-102', 'M', null, null, null, null, 2::bigint)$$);
reset role;
select test.eq('los rechazos no crearon nada', (select count(*) from public.neumaticos where numero_quema like 'S-102' or numero_quema = 'ZZ'), 0::bigint);
-- La misma quema en OTRO cliente es válida (único por cliente)
select test.become('authenticated', test.u_cli_b());
select test.eq('la quema S-A1 puede existir en otro cliente', (public.stock_cubierta_agregar('S-A1', 'M')->>'cliente_id'), '2');
reset role;
rollback to s0;

-- ---------------------------------------------------------------------------------------------
-- C. Restricciones de tabla y RLS (sin abrir escritura directa)
-- ---------------------------------------------------------------------------------------------
select test.denied('CHECK: sin vehículo debe estar almacenado', $$insert into public.neumaticos (cliente_id, estado, idneumatico) values (1, 'montado', 'X-1')$$, '23514');
select test.denied('CHECK: sin vehículo no lleva posición', $$insert into public.neumaticos (cliente_id, posicion, estado, idneumatico) values (1, 3, 'almacenado', 'X-2')$$, '23514');
select test.denied('CHECK: con vehículo debe llevar posición', $$insert into public.neumaticos (vehiculo_id, cliente_id, estado, idneumatico) values (1, 1, 'montado', 'X-3')$$, '23514');
select test.denied('CHECK: sin vehículo no puede ser auxilio', $$insert into public.neumaticos (cliente_id, estado, auxilio, idneumatico) values (1, 'almacenado', true, 'X-4')$$, '23514');
select test.denied('CHECK: sucursal solo para cubiertas sin montar', $$insert into public.neumaticos (vehiculo_id, cliente_id, posicion, sucursal_id, idneumatico) values (1, 1, 50, 401, 'X-5')$$, '23514');
select test.denied('CHECK: condición inválida', $$insert into public.neumaticos (cliente_id, estado, condicion, idneumatico) values (1, 'almacenado', 'roto', 'X-6')$$, '23514');
select test.denied('FK compuesta: sucursal de otro cliente', $$insert into public.neumaticos (cliente_id, estado, sucursal_id, idneumatico) values (1, 'almacenado', 403, 'X-7')$$, '23503');
select test.denied('quema única por cliente (índice)', $$insert into public.neumaticos (cliente_id, estado, idneumatico, numero_quema) values (1, 'almacenado', 'X-8', 's-a1')$$, '23505');
insert into public.neumaticos (vehiculo_id, cliente_id, posicion, idneumatico, condicion) values (1, 1, 50, 'X-9', 'nuevo');
select test.eq('montado con condición nuevo pasa a usado (trigger)', (select condicion from public.neumaticos where idneumatico = 'X-9'), 'usado');
rollback to s0;

-- Lectura: global ve su stock; sucursal, api, sin perfil y otro cliente no ven el de A; admin ve todo
select test.become('authenticated', test.u_cli_a());
select test.eq('global A ve sus 2 cubiertas', (select count(*) from public.neumaticos where vehiculo_id is null), 2::bigint);
select test.eq('global A no ve las de B', (select count(*) from public.neumaticos where numero_quema = 'S-B1'), 0::bigint);
reset role;
select test.become('authenticated', test.u_cli_b());
select test.eq('global B ve solo la suya', (select string_agg(numero_quema, ',') from public.neumaticos where vehiculo_id is null), 'S-B1');
reset role;
select test.become('authenticated', test.u_s85());
select test.eq('perfil de sucursal no ve cubiertas sin montar', (select count(*) from public.neumaticos where vehiculo_id is null), 0::bigint);
select test.eq('perfil de sucursal sigue viendo los neumáticos montados de su sucursal', (select count(*) > 0 from public.neumaticos where vehiculo_id = 1), true);
reset role;
select test.become('authenticated', test.u_api());
select test.eq('api no ve nada', (select count(*) from public.neumaticos), 0::bigint);
reset role;
select test.become('authenticated', test.u_sinperfil());
select test.eq('sin perfil no ve nada', (select count(*) from public.neumaticos), 0::bigint);
reset role;
select test.become('anon', null);
select test.denied('anon no lee neumaticos', $$select count(*) from public.neumaticos$$);
reset role;
select test.become('authenticated', test.u_admin());
select test.eq('admin ve todas', (select count(*) from public.neumaticos where vehiculo_id is null and cliente_id in (1, 2)), 3::bigint);
reset role;

-- Escritura directa del cliente: sigue cerrada
select test.become('authenticated', test.u_cli_a());
select test.denied('el cliente no inserta directo', $$insert into public.neumaticos (cliente_id, estado, idneumatico, numero_quema) values (1, 'almacenado', 'DIR-1', 'DIR')$$);
update public.neumaticos set marca = 'Hack' where vehiculo_id is null;
delete from public.neumaticos where vehiculo_id is null;
reset role;
select test.eq('el cliente no actualiza ni borra directo', (select count(*) from public.neumaticos where vehiculo_id is null and cliente_id in (1, 2) and marca <> 'Hack'), 3::bigint);
rollback to s0;

-- ---------------------------------------------------------------------------------------------
-- D. Editar y cambiar condición
-- ---------------------------------------------------------------------------------------------
select test.become('authenticated', test.u_cli_a());
select test.eq('editar datos',
  (public.stock_cubierta_editar((select id from pg_temp._c where k = 'S-A1'),
     '{"marca":" Goodyear ","modelo":null,"fecha_compra":"2026-01-15","precio":812.5}'::jsonb)->>'condicion'), 'nuevo');
reset role;
select test.eq('datos guardados',
  (select marca || '|' || coalesce(modelo, '-') || '|' || fecha_compra || '|' || precio_unidad || '|' || condicion || '|' || numero_quema from public.neumaticos where idneumatico = 'CB-t-a'),
  'Goodyear|-|2026-01-15|812.50|nuevo|S-A1');
select test.eq('editar sin cambiar condición no crea evento', (select count(*) from public.eventos_neumatico where tipo = 'cambio_condicion'), 0::bigint);
select test.become('authenticated', test.u_cli_a());
select test.eq('marcar recauchutado', (public.stock_cubierta_editar((select id from pg_temp._c where k = 'S-A1'), '{"condicion":"recauchutado"}')->>'condicion'), 'recauchutado');
select test.eq('marcar reparado', (public.stock_cubierta_editar((select id from pg_temp._c where k = 'S-A1'), '{"condicion":"reparado"}')->>'condicion'), 'reparado');
select test.denied('no vuelve a nuevo a mano', $$select public.stock_cubierta_editar((select id from pg_temp._c where k = 'S-A1'), '{"condicion":"nuevo"}')$$, '22023');
select test.denied('no pasa a usado a mano', $$select public.stock_cubierta_editar((select id from pg_temp._c where k = 'S-A1'), '{"condicion":"usado"}')$$, '22023');
select test.denied('condición desconocida', $$select public.stock_cubierta_editar((select id from pg_temp._c where k = 'S-A1'), '{"condicion":"roto"}')$$, '22023');
select test.denied('la quema no se edita', $$select public.stock_cubierta_editar((select id from pg_temp._c where k = 'S-A1'), '{"numero_quema":"OTRA"}')$$, '22023');
select test.denied('la sucursal no se edita aquí', $$select public.stock_cubierta_editar((select id from pg_temp._c where k = 'S-A1'), '{"sucursal_id":402}')$$, '22023');
select test.denied('marca vacía', $$select public.stock_cubierta_editar((select id from pg_temp._c where k = 'S-A1'), '{"marca":" "}')$$, '22023');
select test.denied('precio negativo', $$select public.stock_cubierta_editar((select id from pg_temp._c where k = 'S-A1'), '{"precio":-5}')$$, '23514');
select test.denied('precio de tipo inválido', $$select public.stock_cubierta_editar((select id from pg_temp._c where k = 'S-A1'), '{"precio":"abc"}')$$, '22023');
select test.denied('fecha futura', $$select public.stock_cubierta_editar((select id from pg_temp._c where k = 'S-A1'), format('{"fecha_compra":"%s"}', current_date + 40)::jsonb)$$, '23514');
select test.denied('datos que no son un objeto', $$select public.stock_cubierta_editar((select id from pg_temp._c where k = 'S-A1'), '[1]')$$, '22023');
select test.denied('cubierta de otro cliente', $$select public.stock_cubierta_editar((select id from pg_temp._c where k = 'S-B1'), '{"marca":"X"}')$$);
select test.denied('cubierta inexistente: mismo error que ajena', $$select public.stock_cubierta_editar(99999::bigint, '{"marca":"X"}')$$);
select test.denied('un neumático montado no se edita desde el stock', $$select public.stock_cubierta_editar((select id from public.neumaticos where idneumatico = 'T-2-1'), '{"marca":"X"}')$$, '55000');
reset role;
select test.eq('eventos de condición registrados con autor',
  (select string_agg(notas, ' | ' order by id) from public.eventos_neumatico where tipo = 'cambio_condicion' and created_by = test.u_cli_a()),
  'Condición: nuevo → recauchutado | Condición: recauchutado → reparado');
select test.eq('auditoría del cambio de datos (antes y después)',
  (select (antes->>'marca') || '>' || (despues->>'marca') from public.audit_log where accion = 'STOCK_CUBIERTA_EDITAR'
    and entidad_id = (select id::text from pg_temp._c where k = 'S-A1') order by id limit 1), 'Michelin>Goodyear');
select test.eq('auditoría con actor y rol (3 ediciones válidas)', (select count(*) from public.audit_log where accion = 'STOCK_CUBIERTA_EDITAR'
    and actor_id = test.u_cli_a() and actor_rol = 'cliente'), 3::bigint);
rollback to s0;

-- ---------------------------------------------------------------------------------------------
-- E. Mover entre sucursales (historial: origen, destino, fecha, autor)
-- ---------------------------------------------------------------------------------------------
select test.become('authenticated', test.u_cli_a());
select test.eq('mover: anterior, nueva y movido',
  (select (r->>'anterior') || '>' || (r->>'nueva') || '>' || (r->>'movido') from (select public.stock_cubierta_mover((select id from pg_temp._c where k = 'S-A1'), 402::bigint) r) q), '401>402>true');
select test.eq('mover a "sin sucursal"', (public.stock_cubierta_mover((select id from pg_temp._c where k = 'S-A1'), null)->>'movido'), 'true');
select test.eq('mover al mismo lugar no hace nada', (public.stock_cubierta_mover((select id from pg_temp._c where k = 'S-A1'), null)->>'movido'), 'false');
select test.denied('no mueve a una sucursal de otro cliente', $$select public.stock_cubierta_mover((select id from pg_temp._c where k = 'S-A1'), 403::bigint)$$);
select test.denied('no mueve a una sucursal inexistente', $$select public.stock_cubierta_mover((select id from pg_temp._c where k = 'S-A1'), 99999::bigint)$$);
select test.denied('no mueve la cubierta de otro cliente', $$select public.stock_cubierta_mover((select id from pg_temp._c where k = 'S-B1'), 401::bigint)$$);
reset role;
select test.eq('ubicación final: sin sucursal', (select sucursal_id is null from public.neumaticos where idneumatico = 'CB-t-a'), true);
select test.eq('2 traslados registrados con origen, destino y autor',
  (select string_agg(coalesce(sucursal_origen_id::text, '-') || '>' || coalesce(sucursal_destino_id::text, '-') || '|' || (created_by = test.u_cli_a()) || '|' || (created_at is not null), ',' order by id)
     from public.eventos_neumatico where tipo = 'traslado' and idneumatico = 'CB-t-a'), '401>402|true|true,402>-|true|true');
select test.eq('el texto del traslado nombra las sucursales',
  (select notas from public.eventos_neumatico where tipo = 'traslado' and idneumatico = 'CB-t-a' order by id limit 1), 'Traslado: Norte → Sur');
select test.eq('auditoría MOVER_SUCURSAL de la cubierta',
  (select count(*) from public.audit_log where accion = 'MOVER_SUCURSAL' and entidad = 'neumaticos' and entidad_id = (select id::text from pg_temp._c where k = 'S-A1') and actor_id = test.u_cli_a()), 2::bigint);
select test.eq('mover conserva quema, idneumatico y condición',
  (select numero_quema || '|' || idneumatico || '|' || condicion from public.neumaticos where idneumatico = 'CB-t-a'), 'S-A1|CB-t-a|nuevo');
select test.eq('la cubierta de B no cambió', (select sucursal_id from public.neumaticos where idneumatico = 'CB-t-c'), 403::bigint);
rollback to s0;

-- ---------------------------------------------------------------------------------------------
-- F. Montar una cubierta individual (Nuevo -> Usado), quema y mediciones siguen a la misma cubierta
-- ---------------------------------------------------------------------------------------------
select test.become('authenticated', test.u_cli_a());
select test.denied('con lote y cubierta a la vez: elegir una sola fuente',
  $$select public.neumatico_cambiar(1::bigint, 1::smallint, 'baja', 'x', null, 851::bigint, null, null, 0, (select id from pg_temp._c where k = 'S-A1'))$$, '22023');
select test.denied('con cubierta y datos nuevos a la vez',
  $$select public.neumatico_cambiar(1::bigint, 1::smallint, 'baja', 'x', null, null, '{"marca":"M"}'::jsonb, null, 0, (select id from pg_temp._c where k = 'S-A1'))$$, '22023');
select test.denied('con cubierta no se informa otra quema',
  $$select public.neumatico_cambiar(1::bigint, 1::smallint, 'baja', 'x', null, null, null, 'OTRA', 0, (select id from pg_temp._c where k = 'S-A1'))$$, '22023');
select test.denied('cubierta de otro cliente',
  $$select public.neumatico_cambiar(1::bigint, 1::smallint, 'baja', 'x', null, null, null, null, 0, (select id from pg_temp._c where k = 'S-B1'))$$, 'P0002');
select test.denied('cubierta inexistente',
  $$select public.neumatico_cambiar(1::bigint, 1::smallint, 'baja', 'x', null, null, null, null, 0, 99999::bigint)$$, 'P0002');
reset role;
select test.eq('los rechazos no tocaron la posición 1', (select idneumatico from public.neumaticos where vehiculo_id = 1 and posicion = 1), 'T-1-1');
-- El perfil de sucursal no usa el stock
select test.become('authenticated', test.u_s85());
select test.denied('sucursal no monta cubiertas del stock',
  $$select public.neumatico_cambiar(1::bigint, 1::smallint, 'baja', 'x', null, null, null, null, 0, (select id from pg_temp._c where k = 'S-A1'))$$);
reset role;
select test.become('authenticated', test.u_cli_b());
select test.denied('otro cliente no monta en un vehículo ajeno',
  $$select public.neumatico_cambiar(1::bigint, 1::smallint, 'baja', 'x', null, null, null, null, 0, (select id from pg_temp._c where k = 'S-A1'))$$);
reset role;
select test.eq('la cubierta sigue en stock tras los rechazos', (select vehiculo_id is null from public.neumaticos where idneumatico = 'CB-t-a'), true);

-- medición previa de otro neumático para comprobar que no se hereda
select test.become('authenticated', test.u_cli_a());
select test.eq('monta la cubierta en P1 (baja del viejo)',
  (public.neumatico_cambiar(1::bigint, 1::smallint, 'baja', 'Desgaste', 2000, null, null, null, 0, (select id from pg_temp._c where k = 'S-A1'))->>'condicion_nuevo'), 'usado');
reset role;
select test.eq('misma fila: sale del stock y ocupa la posición (conserva id, idneumatico y quema)',
  (select id = (select id from pg_temp._c where k = 'S-A1') and idneumatico = 'CB-t-a' and numero_quema = 'S-A1' and vehiculo_id = 1 and posicion = 1
          and estado = 'montado' and sucursal_id is null from public.neumaticos where idneumatico = 'CB-t-a'), true);
select test.eq('Nuevo pasó automáticamente a Usado', (select condicion from public.neumaticos where idneumatico = 'CB-t-a'), 'usado');
select test.eq('ya no figura en el stock del cliente', (select count(*) from public.neumaticos where cliente_id = 1 and vehiculo_id is null), 1::bigint);
select test.eq('no se creó una fila nueva (sin duplicar unidades)', (select count(*) from public.neumaticos where numero_quema = 'S-A1'), 1::bigint);
select test.eq('evento de montaje: costo = precio de compra, origen = sucursal de la cubierta',
  (select costo || '|' || sucursal_origen_id || '|' || vehiculo_id || '|' || posicion_destino from public.eventos_neumatico where tipo = 'montaje' and idneumatico = 'CB-t-a'), '500.00|401|1|1');
select test.eq('viejo dado de baja', (select estado from public.neumaticos where idneumatico = 'T-1-1'), 'baja');
select test.eq('la cubierta montada aparece en v_estado_neumaticos sin datos (no hereda mediciones del viejo)',
  (select estado from public.v_estado_neumaticos where idneumatico = 'CB-t-a'), 'sin_datos');
-- Mediciones siguen a la misma cubierta
insert into public.mediciones (vehiculo_id, cliente_id, posicion, mm1, mm2, mm3, idneumatico, created_at)
  values (1, 1, 1, 12, 12, 12, 'CB-t-a', now() - interval '1 day');
select test.eq('medición atribuida a la cubierta', (select count(*) from public.v_mediciones_neumatico where idneumatico = 'CB-t-a'), 1::bigint);
select test.eq('v_estado_neumaticos toma la medición de la cubierta', (select promedio from public.v_estado_neumaticos where idneumatico = 'CB-t-a'), 12.00);
-- Un montado ya no se puede volver a montar (la cubierta ya no está en el stock)
select test.become('authenticated', test.u_cli_a());
select test.denied('segundo montaje de la misma cubierta',
  $$select public.neumatico_cambiar(1::bigint, 2::smallint, 'baja', 'x', null, null, null, null, 0, (select id from pg_temp._c where k = 'S-A1'))$$, 'P0002');
select test.denied('no se elimina una cubierta montada', $$select public.stock_cubierta_eliminar((select id from pg_temp._c where k = 'S-A1'))$$, '55000');
reset role;

-- ---------------------------------------------------------------------------------------------
-- G. Devolver el neumático retirado al stock (conserva quema, mediciones y eventos)
-- ---------------------------------------------------------------------------------------------
-- Una medición etiquetada del neumático que va a volver al stock (T-1-2 en P2 de vehículo 1)
insert into public.mediciones (vehiculo_id, cliente_id, posicion, mm1, mm2, mm3, idneumatico, created_at)
  values (1, 1, 2, 9, 9, 9, 'T-1-2', now() - interval '2 days');
select test.become('authenticated', test.u_cli_a());
select test.denied('sin quema el neumático retirado no vuelve al stock',
  $$select public.neumatico_cambiar(1::bigint, 2::smallint, 'almacenado', null, null, null, '{"marca":"N"}'::jsonb, null, 0, null, true, 402::bigint)$$, '22023');
select test.denied('la quema indicada ya existe en otro neumático',
  $$select public.neumatico_cambiar(1::bigint, 2::smallint, 'almacenado', null, null, null, '{"marca":"N"}'::jsonb, null, 0, null, true, 402::bigint, 'q-montada')$$, '23505');
select test.denied('sucursal de otro cliente como destino',
  $$select public.neumatico_cambiar(1::bigint, 2::smallint, 'almacenado', null, null, null, '{"marca":"N"}'::jsonb, null, 0, null, true, 403::bigint, 'Q-VIEJA')$$);
select test.denied('solo "almacenado" vuelve al stock',
  $$select public.neumatico_cambiar(1::bigint, 2::smallint, 'baja', 'x', null, null, '{"marca":"N"}'::jsonb, null, 0, null, true, 402::bigint, 'Q-VIEJA')$$, '22023');
reset role;
select test.eq('los rechazos no movieron nada (atómico)',
  (select vehiculo_id || '|' || posicion || '|' || estado from public.neumaticos where idneumatico = 'T-1-2'), '1|2|montado');
select test.become('authenticated', test.u_s85());
select test.denied('el perfil de sucursal no devuelve al stock',
  $$select public.neumatico_cambiar(1::bigint, 2::smallint, 'almacenado', null, null, null, '{"marca":"N"}'::jsonb, null, 0, null, true, 402::bigint, 'Q-VIEJA')$$);
reset role;
select test.become('authenticated', test.u_cli_a());
select test.eq('devuelve al stock en Sur con quema nueva',
  (select (r->>'neumatico_viejo_en_stock') from (select public.neumatico_cambiar(1::bigint, 2::smallint, 'almacenado', 'Rotación a otro coche', 2100, null, '{"marca":"N"}'::jsonb, null, 0, null, true, 402::bigint, 'Q-VIEJA') r) q), 'true');
select test.eq('el stock del cliente la lista con su quema y sucursal',
  (select numero_quema || '|' || sucursal_id || '|' || estado || '|' || condicion from public.neumaticos where vehiculo_id is null and idneumatico = 'T-1-2'), 'Q-VIEJA|402|almacenado|usado');
reset role;
select test.eq('misma fila (identidad estable) y sin posición', (select (vehiculo_id is null) and (posicion is null) from public.neumaticos where idneumatico = 'T-1-2'), true);
select test.eq('sus mediciones se conservan en el historial por neumático',
  (select count(*) || '|' || min(estado_montaje) || '|' || min(atribucion) from public.v_mediciones_neumatico where idneumatico = 'T-1-2'), '1|almacenado|idneumatico');
select test.eq('no figura en v_estado_neumaticos ni genera alertas',
  (select count(*) from public.v_estado_neumaticos where idneumatico = 'T-1-2') + (select count(*) from public.v_alertas where idneumatico = 'T-1-2'), 0::bigint);
select test.eq('evento de desmontaje con vehículo, destino y autor',
  (select vehiculo_id || '|' || posicion_origen || '|' || sucursal_destino_id || '|' || odometro_km || '|' || (created_by = test.u_cli_a()) from public.eventos_neumatico where tipo = 'desmontaje' and idneumatico = 'T-1-2'), '1|2|402|2100|true');
select test.eq('el nuevo ocupa P2', (select marca from public.neumaticos where vehiculo_id = 1 and posicion = 2), 'N');
-- No se puede eliminar: tuvo uso (montaje/mediciones)
select test.become('authenticated', test.u_cli_a());
select test.denied('no elimina una cubierta que tuvo uso', $$select public.stock_cubierta_eliminar((select id from public.neumaticos where idneumatico = 'T-1-2'))$$, '55000');
-- Se vuelve a montar en otro vehículo (vehículo 2 es de otra sucursal; el global puede)
select test.eq('se monta otra vez en el vehículo 2 (P2: neumático de esa posición pasa a almacenado)',
  (public.neumatico_cambiar(2::bigint, 2::smallint, 'almacenado', null, 500, null, null, null, 0, (select id from public.neumaticos where idneumatico = 'T-1-2'))->>'cubierta_id')::bigint, (select id from public.neumaticos where idneumatico = 'T-1-2'));
reset role;
select test.eq('la misma cubierta ahora está en el vehículo 2',
  (select vehiculo_id || '|' || posicion || '|' || estado || '|' || numero_quema || '|' || coalesce(sucursal_id::text, '-') from public.neumaticos where idneumatico = 'T-1-2'), '2|2|montado|Q-VIEJA|-');
select test.eq('historial completo de la cubierta: desmontaje y montaje, en orden',
  (select string_agg(tipo || '@' || vehiculo_id, ',' order by id) from public.eventos_neumatico where idneumatico = 'T-1-2' and tipo in ('desmontaje', 'montaje')), 'desmontaje@1,montaje@2');
select test.eq('el montaje de una cubierta usada no imputa costo otra vez',
  (select costo is null from public.eventos_neumatico where tipo = 'montaje' and idneumatico = 'T-1-2'), true);
select test.eq('la medición histórica sigue con la cubierta en su nuevo vehículo (mediciones por neumático)',
  (select count(*) from public.v_mediciones_neumatico where idneumatico = 'T-1-2' and estado_montaje = 'montado' and vehiculo_id = 2), 1::bigint);
rollback to s0;

-- ---------------------------------------------------------------------------------------------
-- H. Eliminar: solo si nunca se usó
-- ---------------------------------------------------------------------------------------------
select test.become('authenticated', test.u_cli_a());
select test.eq('elimina una cubierta nunca usada', (public.stock_cubierta_eliminar((select id from pg_temp._c where k = 'S-A1'))->>'numero_quema'), 'S-A1');
select test.denied('ya no existe', $$select public.stock_cubierta_eliminar((select id from pg_temp._c where k = 'S-A1'))$$);
select test.denied('no elimina la de otro cliente', $$select public.stock_cubierta_eliminar((select id from pg_temp._c where k = 'S-B1'))$$);
reset role;
select test.eq('la fila y sus eventos de stock se fueron', (select count(*) from public.neumaticos where idneumatico = 'CB-t-a') + (select count(*) from public.eventos_neumatico where idneumatico = 'CB-t-a'), 0::bigint);
select test.eq('auditoría con los datos eliminados',
  (select (antes->>'numero_quema') from public.audit_log where accion = 'STOCK_CUBIERTA_ELIMINAR' and actor_id = test.u_cli_a()), 'S-A1');
select test.eq('la quema vuelve a estar disponible', (select count(*) from public.neumaticos where lower(numero_quema) = 's-a1' and cliente_id = 1), 0::bigint);
select test.eq('la de B sigue', (select count(*) from public.neumaticos where idneumatico = 'CB-t-c'), 1::bigint);
rollback to s0;
-- Con mediciones no se elimina aunque nunca se haya montado
insert into public.mediciones (cliente_id, posicion, mm1, mm2, mm3, idneumatico) values (1, 1, 10, 10, 10, 'CB-t-b');
select test.become('authenticated', test.u_cli_a());
select test.denied('con mediciones no se elimina', $$select public.stock_cubierta_eliminar((select id from pg_temp._c where k = 'S-A2'))$$, '55000');
reset role;
rollback to s0;
-- Con un montaje registrado tampoco
insert into public.eventos_neumatico (cliente_id, vehiculo_id, neumatico_id, idneumatico, tipo)
  values (1, 1, (select id from pg_temp._c where k = 'S-A2'), 'CB-t-b', 'montaje');
select test.become('authenticated', test.u_cli_a());
select test.denied('con montaje previo no se elimina', $$select public.stock_cubierta_eliminar((select id from pg_temp._c where k = 'S-A2'))$$, '55000');
reset role;
rollback to s0;

-- ---------------------------------------------------------------------------------------------
-- I. Sucursales con stock; lotes antiguos y destinos anteriores siguen funcionando
-- ---------------------------------------------------------------------------------------------
insert into public.sucursales (id, cliente_id, nombre) overriding system value values (404, 1, 'Solo stock');
select test.become('authenticated', test.u_cli_a());
select test.eq('mueve una cubierta a la sucursal vacía', (public.stock_cubierta_mover((select id from pg_temp._c where k = 'S-A2'), 404::bigint)->>'movido'), 'true');
select test.denied('no elimina una sucursal que solo tiene cubiertas en stock', $$select public.sucursal_eliminar(404::bigint)$$, '23503');
select test.eq('la cubierta sigue ubicada ahí', (select sucursal_id from public.neumaticos where idneumatico = 'CB-t-b'), 404::bigint);
reset role;
select test.denied('FK: tampoco por SQL directo', $$delete from public.sucursales where id = 404$$, '23503');
select test.become('authenticated', test.u_cli_a());
select test.eq('al sacar la cubierta, la sucursal se elimina', (public.stock_cubierta_mover((select id from pg_temp._c where k = 'S-A2'), null)->>'movido'), 'true');
select test.eq('sucursal vacía sí', (public.sucursal_eliminar(404::bigint)->>'id'), '404');
reset role;
rollback to s0;

-- Lote antiguo: sigue disponible, descuenta y crea un neumático con condición usado
select test.become('authenticated', test.u_cli_a());
select test.eq('lote antiguo: cambio con p_stock_id',
  (public.neumatico_cambiar(1::bigint, 3::smallint, 'reencauche', null, null, 851::bigint)->>'stock_restante')::int, 2);
select test.eq('lote antiguo: el neumático nuevo es usado y sin vida', (select condicion || '|' || vida from public.neumaticos where vehiculo_id = 1 and posicion = 3), 'usado|0');
select test.eq('reencauche: el viejo queda recauchutado y aparcado en el vehículo (comportamiento anterior)',
  (select condicion || '|' || (vehiculo_id is not null) || '|' || estado || '|' || vida from public.neumaticos where idneumatico = 'T-1-3'), 'recauchutado|true|almacenado|1');
select test.eq('almacenado sin devolver al stock: se aparca en el vehículo (comportamiento anterior)',
  (public.neumatico_cambiar(1::bigint, 4::smallint, 'almacenado', null, null, null, '{"marca":"Z"}'::jsonb)->>'neumatico_viejo_en_stock'), 'false');
select test.eq('...y sigue con vehículo', (select vehiculo_id is not null from public.neumaticos where idneumatico = 'T-1-4'), true);
select test.eq('reparación: condición reparado', (public.neumatico_cambiar(1::bigint, 5::smallint, 'reparacion', null, null, null, '{"marca":"Z"}'::jsonb)->>'destino_viejo'), 'reparacion');
select test.eq('...queda reparado', (select condicion from public.neumaticos where idneumatico = 'T-1-5'), 'reparado');
select test.eq('ingresado con vida 2 figura recauchutado',
  (public.neumatico_cambiar(1::bigint, 6::smallint, 'baja', 'x', null, null, '{"marca":"R","vida":2}'::jsonb)->>'condicion_nuevo'), 'recauchutado');
select test.denied('sin ninguna fuente de neumático nuevo', $$select public.neumatico_cambiar(1::bigint, 7::smallint, 'baja', 'x')$$, '22023');
reset role;

-- La API de proveedor y las vistas no ven las cubiertas sin montar
rollback to s0;
select test.eq('api_obtener_montaje (service_role) lista solo montados',
  (select count(*) from jsonb_array_elements(public.api_obtener_montaje(1::bigint, 'AA1111', null)->'data')), 8::bigint);
select test.eq('ninguna cubierta sin montar en las vistas de estado, alertas y última medición',
  (select count(*) from public.v_estado_neumaticos where idneumatico like 'CB-t-%')
  + (select count(*) from public.v_alertas where idneumatico like 'CB-t-%')
  + (select count(*) from public.v_ultima_medicion where idneumatico like 'CB-t-%'), 0::bigint);
select test.eq('v_resumen_flota_cliente no cuenta cubiertas sin montar',
  (select n_neumaticos_con_datos from public.v_resumen_flota_cliente where cliente_id = 1),
  (select count(*) from public.v_estado_neumaticos where cliente_id = 1 and estado <> 'sin_datos'));

rollback;
