-- Baja sin vehículo (migración 20261125000000_baja_sin_vehiculo.sql): el check admite estado 'baja' sin vehículo
-- solo con fecha y motivo, y una baja no cuenta como stock (neumaticos_precios p_solo_stock).
begin;

insert into public.neumaticos (vehiculo_id, cliente_id, posicion, idneumatico, estado, condicion, precio_unidad) values
  (null, 1, null, 'B137-stock', 'almacenado', 'usado', 111);

-- A. Check: la baja sin vehículo exige fecha y motivo; los demás estados siguen prohibidos.
select test.denied('baja sin vehículo sin fecha ni motivo',
  $$insert into public.neumaticos (vehiculo_id, cliente_id, posicion, idneumatico, estado, condicion)
    values (null, 1, null, 'B137-x1', 'baja', 'usado')$$, '23514');
select test.denied('baja sin vehículo con motivo vacío',
  $$insert into public.neumaticos (vehiculo_id, cliente_id, posicion, idneumatico, estado, condicion, fecha_baja, motivo_baja)
    values (null, 1, null, 'B137-x2', 'baja', 'usado', current_date, '  ')$$, '23514');
select test.denied('montado sin vehículo sigue prohibido',
  $$insert into public.neumaticos (vehiculo_id, cliente_id, posicion, idneumatico, estado, condicion)
    values (null, 1, null, 'B137-x3', 'montado', 'usado')$$, '23514');

insert into public.neumaticos (vehiculo_id, cliente_id, posicion, idneumatico, estado, condicion, fecha_baja, motivo_baja, precio_unidad)
  values (null, 1, null, 'B137-baja', 'baja', 'usado', current_date, 'Descarte (carga inicial)', 222);
select test.eq('la baja sin vehículo se guarda',
  (select estado from public.neumaticos where idneumatico = 'B137-baja'), 'baja');

-- B. No cuenta como stock: el listado de precios del stock solo trae la almacenada.
select test.become('authenticated', test.u_admin());
select test.eq('admin: precios del stock sin la baja',
  (select string_agg(n.idneumatico, ',' order by n.idneumatico)
     from public.neumaticos_precios(null, true) p join public.neumaticos n on n.id = p.id
    where n.idneumatico like 'B137-%'), 'B137-stock');
reset role;

-- C. Una baja sin vehículo no es stock: editar, mover y eliminar la rechazan (55000), con el usuario global del cliente dueño.
select test.become('authenticated', test.u_cli_a());
select test.denied('baja sin vehículo: no se mueve',
  format('select public.stock_cubierta_mover(%s, null::bigint)', (select id from public.neumaticos where idneumatico = 'B137-baja')), '55000');
select test.denied('baja sin vehículo: no se edita',
  format($q$select public.stock_cubierta_editar(%s, '{"marca":"X"}'::jsonb)$q$, (select id from public.neumaticos where idneumatico = 'B137-baja')), '55000');
select test.denied('baja sin vehículo: no se elimina',
  format('select public.stock_cubierta_eliminar(%s)', (select id from public.neumaticos where idneumatico = 'B137-baja')), '55000');
reset role;

rollback;
