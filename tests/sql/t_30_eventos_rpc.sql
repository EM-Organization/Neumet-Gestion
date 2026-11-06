-- eventos_neumatico (RLS, constraints, auditoría) y cliente_eliminar_suave.

-- Auditoría de eventos y escritura
begin;
select test.become('authenticated', test.u_admin());
insert into public.eventos_neumatico (cliente_id, vehiculo_id, tipo, costo, notas)
  values (1, 1, 'inspeccion', 0, 'nuevo');
select test.eq('created_by = auth.uid() del admin',
  (select created_by from public.eventos_neumatico where notas='nuevo'), test.u_admin());
select test.eq('trigger de auditoría registra el INSERT del evento',
  (select count(*) from public.audit_log where entidad='eventos_neumatico' and accion='INSERT'
     and despues->>'notas'='nuevo' and actor_id = test.u_admin() and actor_rol='admin'), 1::bigint);
update public.eventos_neumatico set notas='editado' where notas='nuevo';
select test.eq('auditoría registra el UPDATE (antes y después)',
  (select count(*) from public.audit_log where entidad='eventos_neumatico' and accion='UPDATE'
     and antes->>'notas'='nuevo' and despues->>'notas'='editado'), 1::bigint);
delete from public.eventos_neumatico where notas='editado';
select test.eq('auditoría registra el DELETE',
  (select count(*) from public.audit_log where entidad='eventos_neumatico' and accion='DELETE'), 1::bigint);
select test.denied('tipo de evento inválido',
  $$insert into public.eventos_neumatico (cliente_id, tipo) values (1,'robo')$$, '23514');
select test.denied('costo negativo',
  $$insert into public.eventos_neumatico (cliente_id, tipo, costo) values (1,'baja',-1)$$, '23514');
select test.denied('odómetro negativo en evento',
  $$insert into public.eventos_neumatico (cliente_id, tipo, odometro_km) values (1,'baja',-1)$$, '23514');
select test.denied('cliente_id inexistente',
  $$insert into public.eventos_neumatico (cliente_id, tipo) values (999,'baja')$$, '23503');
rollback;

-- Cliente: solo lectura de lo suyo
begin;
select test.become('authenticated', test.u_cli_a());
select test.denied('cliente A no puede insertar eventos',
  $$insert into public.eventos_neumatico (cliente_id, tipo) values (1,'baja')$$);
update public.eventos_neumatico set notas='hack';
select test.eq('cliente A no modifica eventos (0 filas)',
  (select count(*) from public.eventos_neumatico where notas='hack'), 0::bigint);
delete from public.eventos_neumatico;
select test.eq('cliente A sigue viendo sus 2 eventos tras DELETE intentado',
  (select count(*) from public.eventos_neumatico), 2::bigint);
rollback;
begin;
select test.become('authenticated', test.u_api());
select test.denied('api no puede insertar eventos',
  $$insert into public.eventos_neumatico (cliente_id, tipo) values (1,'baja')$$);
rollback;
begin;
select test.become('anon', null);
select test.denied('anon no puede insertar eventos',
  $$insert into public.eventos_neumatico (cliente_id, tipo) values (1,'baja')$$);
rollback;

-- Integridad referencial
begin;
delete from public.neumaticos where idneumatico='T-1-1';
select test.eq('borrar neumático deja el evento con neumatico_id null (SET NULL)',
  (select count(*) from public.eventos_neumatico where idneumatico='T-1-1' and neumatico_id is null), 1::bigint);
insert into public.eventos_neumatico (cliente_id, vehiculo_id, tipo) values (1, 2, 'inspeccion');
select test.denied('no se puede borrar un vehículo con eventos (RESTRICT)',
  $$delete from public.vehiculos where id=2$$, '23503');
rollback;

-- audit_log sigue siendo inmutable (incluso para el propietario)
begin;
select test.denied('audit_log: UPDATE bloqueado', $$update public.audit_log set accion='X'$$);
select test.denied('audit_log: DELETE bloqueado', $$delete from public.audit_log$$);
select test.denied('audit_log: TRUNCATE bloqueado', $$truncate public.audit_log$$);
rollback;

-- cliente_eliminar_suave: denegado para no-admin
begin;
select test.become('authenticated', test.u_cli_a());
select test.denied('cliente no puede eliminar (suave) clientes', $$select public.cliente_eliminar_suave(1)$$);
select test.denied('cliente no puede eliminar a otro cliente', $$select public.cliente_eliminar_suave(2)$$);
rollback;
begin;
select test.become('authenticated', test.u_api());
select test.denied('api no puede eliminar (suave)', $$select public.cliente_eliminar_suave(1)$$);
rollback;
begin;
select test.become('authenticated', test.u_sinperfil());
select test.denied('sin perfil no puede eliminar (suave)', $$select public.cliente_eliminar_suave(1)$$);
rollback;
begin;
select test.become('anon', null);
select test.denied('anon sin execute en cliente_eliminar_suave', $$select public.cliente_eliminar_suave(1)$$);
rollback;

-- cliente_eliminar_suave: admin
begin;
select test.become('authenticated', test.u_admin());
select test.eq('admin: resultado de eliminar suave cliente B',
  public.cliente_eliminar_suave(2),
  jsonb_build_object('cliente_id', 2, 'vehiculos_desactivados', 1, 'dispositivos_desactivados', 1));
select test.eq('cliente marcado deleted_at', (select deleted_at is not null from public.clientes where id=2), true);
select test.eq('vehículos del cliente inactivos', (select count(*) from public.vehiculos where cliente_id=2 and activo), 0::bigint);
select test.eq('dispositivos del cliente inactivos', (select count(*) from public.dispositivos where cliente_id=2 and activo), 0::bigint);
select test.eq('no se borró nada (vehículos)', (select count(*) from public.vehiculos where cliente_id=2), 1::bigint);
select test.eq('no se borró nada (mediciones)', (select count(*) from public.mediciones where cliente_id=2), 3::bigint);
select test.eq('el cliente eliminado sale de v_resumen_flota_cliente', (select count(*) from public.v_resumen_flota_cliente where cliente_id=2), 0::bigint);
select test.eq('sus neumáticos salen de v_estado_neumaticos', (select count(*) from public.v_estado_neumaticos where cliente_id=2), 0::bigint);
select test.eq('sus alertas desaparecen', (select count(*) from public.v_alertas where cliente_id=2), 0::bigint);
select test.eq('idempotente: segunda llamada OK',
  (public.cliente_eliminar_suave(2)->>'vehiculos_desactivados')::int, 0);
select test.denied('cliente inexistente', $$select public.cliente_eliminar_suave(999)$$, '23503');
select test.denied('el DELETE directo sigue fallando (RESTRICT)', $$delete from public.clientes where id=2$$, '23503');
select test.eq('auditoría del soft delete en clientes',
  (select count(*) from public.audit_log where entidad='clientes' and accion='UPDATE'
     and despues->>'deleted_at' is not null and antes->>'deleted_at' is null), 1::bigint);
rollback;
-- B tras ser eliminado: no ve su fila de clientes ni resumen (simulado como superusuario + rol)
begin;
update public.clientes set deleted_at = now() where id = 2;
select test.become('authenticated', test.u_cli_b());
select test.eq('cliente eliminado no ve su fila en clientes', (select count(*) from public.clientes), 0::bigint);
select test.eq('cliente eliminado no ve resumen', (select count(*) from public.v_resumen_flota_cliente), 0::bigint);
select test.eq('cliente eliminado no ve estado', (select count(*) from public.v_estado_neumaticos), 0::bigint);
rollback;
