-- Administración de empresa (docs/17 §4.1, migración 20261119000000_admin_empresa.sql):
-- admin_empresa_cliente_id, accesos_quitados (sin acceso directo), accesos_quitados_marcar_auth (solo servicio),
-- usuarios_empresa_listar, usuario_empresa_quitar_acceso, usuario_empresa_reponer_acceso, vehiculo_corregir_odometro,
-- alerta_configurar ampliada y audit_row con actor_rol 'admin_empresa' / 'sucursal'.
-- Matriz por rol: equipo Neumet, administrador de empresa, administrador de otra empresa, usuario de sucursal, api,
-- sin perfil, anon. La concurrencia (dos sesiones) está en concurrencia_admin_empresa.sh.
-- Todo en una transacción que se revierte.
begin;

insert into auth.users (id, email) values
  ('a0000000-0000-0000-0000-0000000000f1', 'g2@t'),       -- segundo administrador de la empresa 1
  ('a0000000-0000-0000-0000-0000000000f2', 'suc@t'),      -- usuario de la sucursal 931 (empresa 1)
  ('a0000000-0000-0000-0000-0000000000f3', 'suc2@t'),     -- usuario de la sucursal 932 (empresa 1)
  ('a0000000-0000-0000-0000-0000000000f4', 'vinc@t');     -- sin perfil, vinculado como auth_user_id de la empresa 2 y otra más
insert into public.sucursales (id, cliente_id, nombre) overriding system value values
  (931, 1, 'Norte 93'), (932, 1, 'Sur 93'), (933, 2, 'Otra 93');
insert into public.perfiles (user_id, rol, cliente_id, sucursal_id) values
  ('a0000000-0000-0000-0000-0000000000f1', 'cliente', 1, null),
  ('a0000000-0000-0000-0000-0000000000f2', 'cliente', 1, 931),
  ('a0000000-0000-0000-0000-0000000000f3', 'cliente', 1, 932);
create or replace function test.u_f1() returns uuid language sql immutable as $$ select 'a0000000-0000-0000-0000-0000000000f1'::uuid $$;
create or replace function test.u_f2() returns uuid language sql immutable as $$ select 'a0000000-0000-0000-0000-0000000000f2'::uuid $$;
create or replace function test.u_f3() returns uuid language sql immutable as $$ select 'a0000000-0000-0000-0000-0000000000f3'::uuid $$;
create or replace function test.u_f4() returns uuid language sql immutable as $$ select 'a0000000-0000-0000-0000-0000000000f4'::uuid $$;
grant execute on function test.u_f1(), test.u_f2(), test.u_f3(), test.u_f4() to public;
insert into public.vehiculos (id, cliente_id, nombre, patente, activo, odometro_km) values
  (931, 1, 'V931', 'AD9310', true, 5000),
  (932, 2, 'V932', 'AD9320', true, 5000),
  (933, 1, 'V933 sin km', 'AD9330', true, null);

-- ---- admin_empresa_cliente_id ------------------------------------------------------------------------------------
select test.become('authenticated', test.u_cli_a());
select test.eq('A: administrador de empresa -> su cliente', public.admin_empresa_cliente_id(), 1::bigint);
select test.become('authenticated', test.u_f2());
select test.eq('A: usuario de sucursal -> nulo', public.admin_empresa_cliente_id(), null::bigint);
select test.become('authenticated', test.u_admin());
select test.eq('A: equipo Neumet -> nulo', public.admin_empresa_cliente_id(), null::bigint);
select test.become('authenticated', test.u_api());
select test.eq('A: api -> nulo', public.admin_empresa_cliente_id(), null::bigint);
select test.become('authenticated', test.u_sinperfil());
select test.eq('A: sin perfil -> nulo', public.admin_empresa_cliente_id(), null::bigint);
select test.become('anon', null);
select test.denied('A: anon sin ejecución', $$select public.admin_empresa_cliente_id()$$);

-- ---- accesos_quitados: sin acceso directo para nadie --------------------------------------------------------------
select test.become('authenticated', test.u_cli_a());
select test.denied('B: select directo (administrador de empresa)', $$select * from public.accesos_quitados$$);
select test.denied('B: insert directo', $$insert into public.accesos_quitados (cliente_id, user_id, rol, quitado_por) values (1, test.u_f2(), 'cliente', test.u_cli_a())$$);
select test.denied('B: update directo', $$update public.accesos_quitados set email = 'x'$$);
select test.denied('B: delete directo', $$delete from public.accesos_quitados$$);
select test.become('authenticated', test.u_admin());
select test.denied('B: select directo (equipo Neumet)', $$select * from public.accesos_quitados$$);
select test.become('anon', null);
select test.denied('B: select directo (anon)', $$select * from public.accesos_quitados$$);
select test.denied('B: insert directo (anon)', $$insert into public.accesos_quitados (cliente_id, user_id, rol, quitado_por) values (1, test.u_f2(), 'cliente', test.u_cli_a())$$);

-- ---- usuarios_empresa_listar --------------------------------------------------------------------------------------
select test.become('authenticated', test.u_cli_a());
select test.eq('C: administrador ve los 4 usuarios de su empresa (2 administradores y 2 de sucursal)',
  (select count(*) from public.usuarios_empresa_listar()), 4::bigint);
select test.eq('C: email real del primer usuario aunque perfiles.email sea nulo',
  (select email from public.usuarios_empresa_listar() where user_id = test.u_cli_a()), 'a@t');
select test.eq('C: alcance de sucursal con su nombre',
  (select alcance || '|' || sucursal_nombre from public.usuarios_empresa_listar() where user_id = test.u_f2()), 'sucursal|Norte 93');
select test.eq('C: pasar el propio cliente es válido', (select count(*) from public.usuarios_empresa_listar(1)), 4::bigint);
select test.denied('C: pedir otra empresa', $$select * from public.usuarios_empresa_listar(2)$$);
select test.become('authenticated', test.u_admin());
select test.eq('C: equipo Neumet lista la empresa indicada', (select count(*) from public.usuarios_empresa_listar(1)), 4::bigint);
select test.denied('C: equipo Neumet sin empresa', $$select * from public.usuarios_empresa_listar()$$, '22004');
select test.become('authenticated', test.u_cli_b());
select test.eq('C: administrador de otra empresa solo ve la suya', (select count(*) from public.usuarios_empresa_listar()), 1::bigint);
select test.become('authenticated', test.u_f2());
select test.denied('C: usuario de sucursal', $$select * from public.usuarios_empresa_listar()$$);
select test.become('authenticated', test.u_api());
select test.denied('C: api', $$select * from public.usuarios_empresa_listar()$$);
select test.become('authenticated', test.u_sinperfil());
select test.denied('C: sin perfil', $$select * from public.usuarios_empresa_listar()$$);
select test.become('anon', null);
select test.denied('C: anon', $$select * from public.usuarios_empresa_listar()$$);

-- ---- quitar acceso: matriz de roles -------------------------------------------------------------------------------
select test.become('authenticated', test.u_f2());
select test.denied('D: usuario de sucursal no quita', format($$select public.usuario_empresa_quitar_acceso(%L)$$, test.u_f3()));
select test.become('authenticated', test.u_admin());
select test.denied('D: equipo Neumet no quita (solo mira)', format($$select public.usuario_empresa_quitar_acceso(%L)$$, test.u_f3()));
select test.become('authenticated', test.u_api());
select test.denied('D: api no quita', format($$select public.usuario_empresa_quitar_acceso(%L)$$, test.u_f3()));
select test.become('authenticated', test.u_sinperfil());
select test.denied('D: sin perfil no quita', format($$select public.usuario_empresa_quitar_acceso(%L)$$, test.u_f3()));
select test.become('anon', null);
select test.denied('D: anon no quita', format($$select public.usuario_empresa_quitar_acceso(%L)$$, test.u_f3()));
select test.become('authenticated', test.u_cli_b());
select test.denied('D: administrador de otra empresa no quita', format($$select public.usuario_empresa_quitar_acceso(%L)$$, test.u_f3()));
select test.denied('D: uno mismo sí es 22023 y el otro cliente sigue vigente', format($$select public.usuario_empresa_quitar_acceso(%L)$$, test.u_cli_b()), '22023');
reset role;
select test.eq('D: tras los rechazos el usuario de sucursal sigue con perfil',
  (select count(*) from public.perfiles where user_id = test.u_f3()), 1::bigint);
select test.eq('D: y no se escribió ningún rastro', (select count(*) from public.accesos_quitados), 0::bigint);

select test.become('authenticated', test.u_cli_a());
select test.denied('D: no puede quitarse a sí mismo', format($$select public.usuario_empresa_quitar_acceso(%L)$$, test.u_cli_a()), '22023');
select test.denied('D: no quita al equipo Neumet', format($$select public.usuario_empresa_quitar_acceso(%L)$$, test.u_admin()));
select test.denied('D: no quita a una cuenta api', format($$select public.usuario_empresa_quitar_acceso(%L)$$, test.u_api()));
select test.denied('D: no quita a un administrador de otra empresa', format($$select public.usuario_empresa_quitar_acceso(%L)$$, test.u_cli_b()));
select test.denied('D: usuario inexistente', $$select public.usuario_empresa_quitar_acceso('a0000000-0000-0000-0000-0000000000ee')$$);
select test.denied('D: sin parámetro', $$select public.usuario_empresa_quitar_acceso(null)$$, '22004');

-- ---- quitar acceso: camino feliz con vínculo clientes.auth_user_id en otra empresa --------------------------------
reset role;
-- f3 figura además como cuenta vinculada de la empresa 2 (caso real: el mismo usuario en dos empresas)
update public.clientes set auth_user_id = test.u_f3() where id = 2;
select test.become('authenticated', test.u_cli_a());
select test.eq('E: quita al usuario de sucursal', public.usuario_empresa_quitar_acceso(test.u_f3()) ->> 'estado', 'quitado');
reset role;
select test.eq('E: perfil borrado', (select count(*) from public.perfiles where user_id = test.u_f3()), 0::bigint);
select test.eq('E: el vínculo clientes.auth_user_id de la otra empresa quedó anulado',
  (select auth_user_id from public.clientes where id = 2), null::uuid);
select test.eq('E: el trigger no recreó el perfil', (select count(*) from public.perfiles where cliente_id = 2 and user_id = test.u_f3()), 0::bigint);
select test.eq('E: rastro con rol, sucursal y vínculos desvinculados',
  (select rol || '|' || sucursal_id || '|' || clientes_desvinculados::text || '|' || email from public.accesos_quitados where user_id = test.u_f3()),
  'cliente|932|{2}|suc2@t');
select test.eq('E: el usuario de Auth sigue existiendo (lo maneja la Edge Function)', (select count(*) from auth.users where id = test.u_f3()), 1::bigint);
update public.clientes set auth_user_id = test.u_cli_b() where id = 2;

select test.become('authenticated', test.u_cli_a());
select test.eq('E: aparece como quitado en el listado',
  (select estado || '|' || bloqueo_auth_pendiente::text from public.usuarios_empresa_listar() where user_id = test.u_f3()), 'quitado|true');
select test.eq('E: ya no cuenta como vigente', (select count(*) from public.usuarios_empresa_listar() where estado = 'vigente'), 3::bigint);
select test.eq('E: reintento sin marca de Auth: ya_quitado', public.usuario_empresa_quitar_acceso(test.u_f3()) ->> 'estado', 'ya_quitado');
select test.become('authenticated', test.u_cli_b());
select test.denied('E: otra empresa no reintenta la baja ajena', format($$select public.usuario_empresa_quitar_acceso(%L)$$, test.u_f3()));
select test.eq('E: otra empresa no ve a los quitados ajenos', (select count(*) from public.usuarios_empresa_listar()), 1::bigint);

-- ---- accesos_quitados_marcar_auth: solo servicio, con revalidación -------------------------------------------------
reset role;
create temp table _acc as select id from public.accesos_quitados where user_id = test.u_f3();
grant select on _acc to public;
select test.become('authenticated', test.u_cli_a());
select test.denied('F: authenticated no marca', $$select public.accesos_quitados_marcar_auth((select id from _acc), 'aplicado')$$);
select test.become('anon', null);
select test.denied('F: anon no marca', $$select public.accesos_quitados_marcar_auth(1, 'aplicado')$$);
select test.become('service_role', null);
select test.eq('F: el servicio marca «aplicado»', public.accesos_quitados_marcar_auth((select id from _acc), 'aplicado') ->> 'escrita', 'true');
select test.eq('F: «levantado» exige reposición: no escribe y devuelve el estado (sin perfil)',
  (select (r ->> 'escrita') || '|' || (r ->> 'tiene_perfil') from (select public.accesos_quitados_marcar_auth((select id from _acc), 'levantado') r) x), 'false|false');
select test.eq('F: sin marca es solo lectura y devuelve el estado',
  (select (r ->> 'escrita') || '|' || (r ->> 'tiene_perfil') from (select public.accesos_quitados_marcar_auth((select id from _acc)) r) x), 'false|false');
select test.eq('F: marca inexistente no es error', public.accesos_quitados_marcar_auth(999999, 'aplicado') ->> 'existe', 'false');
select test.denied('F: marca desconocida', $$select public.accesos_quitados_marcar_auth((select id from _acc), 'otra')$$, '22023');
select test.become('authenticated', test.u_cli_a());
select test.eq('F: tras la marca, el reintento ya no tiene nada pendiente', public.usuario_empresa_quitar_acceso(test.u_f3()) ->> 'estado', 'ya_quitado');

-- ---- reponer acceso -----------------------------------------------------------------------------------------------
select test.become('authenticated', test.u_f2());
select test.denied('G: usuario de sucursal no repone', $$select public.usuario_empresa_reponer_acceso((select id from _acc))$$);
select test.become('authenticated', test.u_admin());
select test.denied('G: equipo Neumet no repone', $$select public.usuario_empresa_reponer_acceso((select id from _acc))$$);
select test.become('authenticated', test.u_api());
select test.denied('G: api no repone', $$select public.usuario_empresa_reponer_acceso((select id from _acc))$$);
select test.become('authenticated', test.u_sinperfil());
select test.denied('G: sin perfil no repone', $$select public.usuario_empresa_reponer_acceso((select id from _acc))$$);
select test.become('anon', null);
select test.denied('G: anon no repone', $$select public.usuario_empresa_reponer_acceso((select id from _acc))$$);
select test.become('authenticated', test.u_cli_b());
select test.denied('G: otra empresa no repone', $$select public.usuario_empresa_reponer_acceso((select id from _acc))$$);
select test.become('authenticated', test.u_cli_a());
select test.denied('G: sin parámetro', $$select public.usuario_empresa_reponer_acceso(null)$$, '22004');
select test.denied('G: acceso inexistente', $$select public.usuario_empresa_reponer_acceso(999999)$$);
-- sucursal original borrada: hay que elegir otra
reset role;
delete from public.sucursales where id = 932;
select test.become('authenticated', test.u_cli_a());
select test.denied('G: sucursal original borrada exige elegir otra', $$select public.usuario_empresa_reponer_acceso((select id from _acc))$$, '22023');
select test.denied('G: sucursal de otra empresa', $$select public.usuario_empresa_reponer_acceso((select id from _acc), 933)$$, '22023');
select test.denied('G: sucursal inexistente', $$select public.usuario_empresa_reponer_acceso((select id from _acc), 999999)$$, '22023');
reset role;
select test.eq('G: el rechazo no dejó perfil', (select count(*) from public.perfiles where user_id = test.u_f3()), 0::bigint);
select test.become('authenticated', test.u_cli_a());
select test.eq('G: repone en otra sucursal de la misma empresa', public.usuario_empresa_reponer_acceso((select id from _acc), 931) ->> 'estado', 'repuesto');
reset role;
select test.eq('G: perfil vuelve con la sucursal elegida', (select sucursal_id from public.perfiles where user_id = test.u_f3()), 931::bigint);
select test.become('authenticated', test.u_cli_a());
select test.eq('G: segundo reponer: ya_repuesto', public.usuario_empresa_reponer_acceso((select id from _acc), 931) ->> 'estado', 'ya_repuesto');
reset role;
select test.eq('G: sigue habiendo un solo perfil', (select count(*) from public.perfiles where user_id = test.u_f3()), 1::bigint);
select test.become('authenticated', test.u_cli_a());
select test.become('service_role', null);
select test.eq('G: el servicio levanta el bloqueo', public.accesos_quitados_marcar_auth((select id from _acc), 'levantado') ->> 'escrita', 'true');
select test.eq('G: «aplicado» ya no vale (hay perfil): no escribe y lo dice',
  (select (r ->> 'escrita') || '|' || (r ->> 'tiene_perfil') from (select public.accesos_quitados_marcar_auth((select id from _acc), 'aplicado') r) x), 'false|true');
select test.become('authenticated', test.u_cli_a());
select test.eq('G: reponer repetido tras levantar', public.usuario_empresa_reponer_acceso((select id from _acc)) ->> 'estado', 'ya_repuesto');
select test.eq('G: ya no aparece como quitado', (select count(*) from public.usuarios_empresa_listar() where estado = 'quitado'), 0::bigint);
select test.eq('G: quitarlo de nuevo crea otra fila', public.usuario_empresa_quitar_acceso(test.u_f3()) ->> 'estado', 'quitado');
select test.eq('G: dos filas de baja para el usuario', (select count(*) from public.usuarios_empresa_listar() where estado = 'quitado'), 1::bigint);
select test.denied('G: la fila vieja ya no repone (hay una más reciente)', $$select public.usuario_empresa_reponer_acceso((select id from _acc))$$);

-- ---- perfil reasignado por otra vía: reponer no lo pisa ----------------------------------------------------------
reset role;
delete from public.perfiles where user_id = test.u_f2();
insert into public.accesos_quitados (cliente_id, user_id, email, rol, sucursal_id, quitado_por)
  values (1, test.u_f2(), 'suc@t', 'cliente', 931, test.u_cli_a());
insert into public.perfiles (user_id, rol, cliente_id, sucursal_id) values (test.u_f2(), 'cliente', 1, null);
create temp table _acc2 as select max(id) as id from public.accesos_quitados where user_id = test.u_f2();
grant select on _acc2 to public;
select test.become('authenticated', test.u_cli_a());
select test.eq('H: perfil presente sin reposición marcada (reasignado por el equipo Neumet): ya_repuesto, no se pisa',
  public.usuario_empresa_reponer_acceso((select id from _acc2)) ->> 'estado', 'ya_repuesto');
select test.eq('H: el perfil reasignado queda como estaba', (select count(*) from public.usuarios_empresa_listar() where user_id = test.u_f2() and estado = 'vigente' and alcance = 'empresa'), 1::bigint);
select test.become('authenticated', test.u_cli_b());
select test.denied('H: otra empresa no obtiene nada', $$select public.usuario_empresa_reponer_acceso((select id from _acc2))$$);
reset role;
delete from public.perfiles where user_id = test.u_f2();
insert into public.perfiles (user_id, rol, cliente_id, sucursal_id) values (test.u_f2(), 'cliente', 1, 931);

-- ---- último administrador: no se puede dejar la empresa sin administradores ----------------------------------------
select test.become('authenticated', test.u_cli_a());
select test.eq('I: quitar al segundo administrador (queda uno)', public.usuario_empresa_quitar_acceso(test.u_f1()) ->> 'estado', 'quitado');
reset role;
create temp table _acc1 as select max(id) as id from public.accesos_quitados where user_id = test.u_f1();
grant select on _acc1 to public;
select test.become('authenticated', test.u_f1());
select test.denied('I: el administrador quitado ya no puede actuar con su JWT vigente',
  format($$select public.usuario_empresa_quitar_acceso(%L)$$, test.u_cli_a()));
select test.denied('I: ni listar', $$select * from public.usuarios_empresa_listar()$$);
select test.denied('I: ni corregir kilometraje', $$select public.vehiculo_corregir_odometro(931, 10)$$);
select test.denied('I: ni configurar alertas', $$select public.alerta_configurar(null::bigint, 4.5)$$);
select test.become('authenticated', test.u_cli_a());
select test.denied('I: el último no puede quitarse a sí mismo', format($$select public.usuario_empresa_quitar_acceso(%L)$$, test.u_cli_a()), '22023');
select test.eq('I: se repone al administrador quitado', public.usuario_empresa_reponer_acceso(
  (select id from _acc1)) ->> 'estado', 'repuesto');
reset role;
select test.eq('I: vuelve como administrador de empresa', (select sucursal_id from public.perfiles where user_id = test.u_f1()), null::bigint);
select test.become('authenticated', test.u_cli_a());

-- ---- vehiculo_corregir_odometro ----------------------------------------------------------------------------------
select test.become('authenticated', test.u_cli_a());
select test.eq('J: baja el kilometraje', public.vehiculo_corregir_odometro(931, 4000) ->> 'anterior', '5000');
select test.eq('J: queda el nuevo valor', (select odometro_km from public.vehiculos where id = 931), 4000);
select test.eq('J: repetir el mismo valor es válido', public.vehiculo_corregir_odometro(931, 4000) ->> 'odometro_km', '4000');
select test.denied('J: subir no va por aquí', $$select public.vehiculo_corregir_odometro(931, 4001)$$, '23514');
select test.denied('J: negativo', $$select public.vehiculo_corregir_odometro(931, -1)$$, '23514');
select test.denied('J: vehículo sin kilometraje previo', $$select public.vehiculo_corregir_odometro(933, 10)$$, '23514');
select test.denied('J: vehículo de otra empresa', $$select public.vehiculo_corregir_odometro(932, 10)$$);
select test.denied('J: vehículo inexistente', $$select public.vehiculo_corregir_odometro(999999, 10)$$);
select test.denied('J: parámetros nulos', $$select public.vehiculo_corregir_odometro(931, null)$$, '22004');
reset role;
select test.eq('J: auditoría con valor anterior, nuevo, actor y rol de empresa',
  (select (antes ->> 'odometro_km') || '|' || (despues ->> 'odometro_km') || '|' || actor_rol || '|' || (actor_id = test.u_cli_a())::text
     from public.audit_log where entidad = 'vehiculos' and entidad_id = '931' and accion = 'UPDATE'
      and (despues ->> 'odometro_km') = '4000' and (antes ->> 'odometro_km') = '5000'),
  '5000|4000|admin_empresa|true');
select test.become('authenticated', test.u_admin());
select test.denied('J: equipo Neumet no corrige', $$select public.vehiculo_corregir_odometro(931, 10)$$);
select test.become('authenticated', test.u_f2());
select test.denied('J: usuario de sucursal no corrige', $$select public.vehiculo_corregir_odometro(931, 10)$$);
select test.denied('J: usuario de sucursal no baja con vehiculo_registrar_odometro', $$select public.vehiculo_registrar_odometro(931, 10)$$);
select test.become('authenticated', test.u_cli_a());
select test.denied('J: ni el administrador baja con vehiculo_registrar_odometro', $$select public.vehiculo_registrar_odometro(931, 10)$$, '23514');
select test.become('authenticated', test.u_cli_b());
select test.denied('J: administrador de otra empresa', $$select public.vehiculo_corregir_odometro(931, 10)$$);
select test.become('authenticated', test.u_api());
select test.denied('J: api', $$select public.vehiculo_corregir_odometro(931, 10)$$);
select test.become('authenticated', test.u_sinperfil());
select test.denied('J: sin perfil', $$select public.vehiculo_corregir_odometro(931, 10)$$);
select test.become('anon', null);
select test.denied('J: anon', $$select public.vehiculo_corregir_odometro(931, 10)$$);

-- ---- alerta_configurar ampliada ----------------------------------------------------------------------------------
select test.become('authenticated', test.u_cli_a());
select test.eq('K: el administrador configura los 7 parámetros',
  (select concat_ws('|', r ->> 'umbral_bajo_mm', r ->> 'umbral_critico_mm', r ->> 'umbral_retiro_mm', r ->> 'dias_sin_medir_alerta',
                    r ->> 'irregularidad_mm', r ->> 'histeresis_mm', r ->> 'huella_absurda_mm')
     from (select public.alerta_configurar(null::bigint, 5.5, 0.4, 9.0, 3.0, 20, 1.5, 25.0) as r) x),
  '9.0|5.5|3.0|20|1.5|0.4|25.0');
select test.eq('K: lo escrito en clientes',
  (select concat_ws('|', umbral_bajo_mm, umbral_critico_mm, umbral_retiro_mm, dias_sin_medir_alerta, irregularidad_mm, alerta_histeresis_mm, huella_absurda_mm)
     from public.clientes where id = 1), '9.0|5.5|3.0|20|1.5|0.4|25.0');
select test.eq('K: nulo no cambia (solo huella)', public.alerta_configurar(null::bigint, p_huella_absurda_mm => 30) ->> 'umbral_critico_mm', '5.5');
select test.eq('K: nombre del parámetro nuevo', (select huella_absurda_mm from public.clientes where id = 1), 30.0);
select test.denied('K: huella cero', $$select public.alerta_configurar(null::bigint, p_huella_absurda_mm => 0)$$, '23514');
select test.denied('K: huella sobre 40', $$select public.alerta_configurar(null::bigint, p_huella_absurda_mm => 40.5)$$, '23514');
select test.denied('K: huella con dos decimales', $$select public.alerta_configurar(null::bigint, p_huella_absurda_mm => 20.55)$$, '22023');
select test.denied('K: días fuera de rango', $$select public.alerta_configurar(null::bigint, p_dias_sin_medir => 0)$$, '23514');
select test.denied('K: días excesivos', $$select public.alerta_configurar(null::bigint, p_dias_sin_medir => 3651)$$, '23514');
select test.denied('K: irregularidad cero', $$select public.alerta_configurar(null::bigint, p_irregularidad_mm => 0)$$, '23514');
select test.denied('K: retiro sobre el crítico', $$select public.alerta_configurar(null::bigint, p_umbral_retiro_mm => 6.0)$$, '23514');
select test.denied('K: bajo bajo el crítico', $$select public.alerta_configurar(null::bigint, p_umbral_bajo_mm => 5.0)$$, '23514');
select test.denied('K: crítico igual al bajo', $$select public.alerta_configurar(null::bigint, 9.0)$$, '23514');
select test.denied('K: sin ningún valor', $$select public.alerta_configurar(null::bigint)$$, '22004');
select test.denied('K: otra empresa por parámetro', $$select public.alerta_configurar(2, 5.0)$$);
select test.become('authenticated', test.u_f2());
select test.denied('K: usuario de sucursal', $$select public.alerta_configurar(null::bigint, 5.0)$$);
select test.become('authenticated', test.u_api());
select test.denied('K: api', $$select public.alerta_configurar(null::bigint, 5.0)$$);
select test.become('authenticated', test.u_sinperfil());
select test.denied('K: sin perfil', $$select public.alerta_configurar(null::bigint, 5.0)$$);
select test.become('anon', null);
select test.denied('K: anon', $$select public.alerta_configurar(null::bigint, 5.0)$$);
select test.become('authenticated', test.u_admin());
select test.eq('K: la rama del equipo Neumet sigue hasta la migración C2', public.alerta_configurar(2, 6.0) ->> 'cliente_id', '2');

-- ---- audit_row: rótulo por alcance ---------------------------------------------------------------------------------
reset role;
update public.vehiculos set sucursal_id = 931 where id = 931;
select test.become('authenticated', test.u_f2());
-- el usuario de sucursal no escribe vehículos por RPC de odómetro hacia abajo, pero sí sube: deja rastro con rol «sucursal»
select public.vehiculo_registrar_odometro(931, 4500);
reset role;
select test.eq('L: usuario de sucursal queda como «sucursal»',
  (select actor_rol from public.audit_log where entidad = 'vehiculos' and entidad_id = '931' and (despues ->> 'odometro_km') = '4500'), 'sucursal');
select test.become('authenticated', test.u_admin());
select public.vehiculo_registrar_odometro(931, 4600);
reset role;
select test.eq('L: el equipo Neumet sigue como «admin»',
  (select actor_rol from public.audit_log where entidad = 'vehiculos' and entidad_id = '931' and (despues ->> 'odometro_km') = '4600'), 'admin');

rollback;
