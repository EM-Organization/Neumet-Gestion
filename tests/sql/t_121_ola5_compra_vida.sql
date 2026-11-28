-- Ola 5 de F8 (migración 20261126100000_compra_lote_vida.sql, docs/08 apéndice AE):
--   1. alta de compra por lote: autorización antes de validar (42501 por rol), alta feliz, límites, duplicados y todo-o-nada;
--   2. validación de los datos de compra (DOT, mm, longitudes) con sus SQLSTATE;
--   3. edición de los datos de compra y privilegios por columna (la sucursal no lee el precio);
--   4. vida sin tope: envío, aceptación, reencauche y el check de vida no negativa;
--   5. semanas hasta crítico y retiro con la huella mínima y la tasa;
--   6. mensajes exactos de v_alertas y el catálogo «Primera rotación».
-- Cliente 1 (dueño global test.u_cli_a), sucursal 1301 con usuario propio (test.u121_s). Todo en una transacción que se revierte.
begin;

insert into auth.users (id, email) values ('a1210000-0000-0000-0000-000000000001', 's121@t');
insert into public.sucursales (id, cliente_id, nombre) overriding system value values (1301, 1, 'Suc121');
-- Los dueños globales (test.u_cli_a y test.u_cli_b) ya tienen perfil global por su cliente; solo se crea el de sucursal.
-- Solo el perfil global gestiona el stock (sucursal_autorizar_gestion); el de sucursal queda fuera.
insert into public.perfiles (user_id, rol, cliente_id, sucursal_id) values
  ('a1210000-0000-0000-0000-000000000001', 'cliente', 1, 1301);
create or replace function test.u121_s() returns uuid language sql immutable as $$ select 'a1210000-0000-0000-0000-000000000001'::uuid $$;
grant execute on function test.u121_s() to public;

-- Id de una cubierta del cliente 1 por su quema, y último proceso de recauchutado de una cubierta: sin RLS,
-- la autorización la deciden las RPC que se prueban.
create or replace function test.id121(p_q text) returns bigint language sql stable security definer set search_path = '' as $$
  select id from public.neumaticos where cliente_id = 1 and numero_quema = p_q $$;
grant execute on function test.id121(text) to public;
create or replace function test.pid121(p_neum bigint) returns bigint language sql stable security definer set search_path = '' as $$
  select id from public.recauchutados where neumatico_id = p_neum order by id desc limit 1 $$;
grant execute on function test.pid121(bigint) to public;

-- SQLSTATE de la sentencia ('ok' si no falla) y SQLSTATE con mensaje para las aserciones de texto.
create function pg_temp.st121(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return 'ok'; exception when others then return sqlstate; end $$;
create function pg_temp.msg121(p_sql text) returns text language plpgsql as $$
begin execute p_sql; return 'ok'; exception when others then return sqlstate || '|' || sqlerrm; end $$;
create function pg_temp.n121() returns bigint language sql stable as $$ select count(*) from public.neumaticos $$;

-- ---- 1. Autorización antes de validar (42501) ------------------------------------------------------------------
-- El payload es válido a propósito: el rol decide antes de mirar el contenido.
select test.become('authenticated', test.u_admin());
select test.denied('admin Neumet: lote 42501', $$select public.stock_cubiertas_agregar_lote('{"marca":"X","profundidad_inicial_mm":16}', '[{"numero_quema":"L-1"}]')$$, '42501');
reset role;
select test.become('authenticated', test.u121_s());
select test.denied('sucursal: lote 42501', $$select public.stock_cubiertas_agregar_lote('{"marca":"X","profundidad_inicial_mm":16}', '[{"numero_quema":"L-1"}]')$$, '42501');
reset role;
select test.become('authenticated', test.u_sinperfil());
select test.denied('sin perfil: lote 42501', $$select public.stock_cubiertas_agregar_lote('{"marca":"X","profundidad_inicial_mm":16}', '[{"numero_quema":"L-1"}]')$$, '42501');
reset role;
select test.become('authenticated', test.u_api());
select test.denied('api: lote 42501', $$select public.stock_cubiertas_agregar_lote('{"marca":"X","profundidad_inicial_mm":16}', '[{"numero_quema":"L-1"}]')$$, '42501');
reset role;
select test.become('authenticated', test.u_cli_b());
select test.denied('global de otro cliente con p_cliente_id ajeno: 42501', $$select public.stock_cubiertas_agregar_lote('{"marca":"X","profundidad_inicial_mm":16}', '[{"numero_quema":"L-1"}]', 1)$$, '42501');
reset role;

-- ---- 2. Alta feliz (dueño global, sucursal 1301) ----------------------------------------------------------------
select test.become('authenticated', test.u_cli_a());
select test.eq('feliz: cantidad 3',
  (public.stock_cubiertas_agregar_lote(
     '{"marca":"Michelin","modelo":"X Multi Z","medida":"295/80R22.5","profundidad_inicial_mm":16,"precio":450000,
       "proveedor":"Gomería Sur","factura":"A-0001-00012345","soporte":"OC 77","sucursal_id":1301}',
     '[{"numero_quema":"L-1","dot":"0825"},{"numero_quema":"L-2","dot":"0925"},{"numero_quema":"L-3"}]')->>'cantidad')::int, 3);
reset role;
select test.eq('feliz: 3 filas almacenadas, vida 0, con los datos de compra y el DOT de cada una',
  (select count(*) from public.neumaticos
    where cliente_id = 1 and estado = 'almacenado' and vida = 0 and sucursal_id = 1301 and marca = 'Michelin'
      and modelo = 'X Multi Z' and medida = '295/80R22.5' and profundidad_inicial_mm = 16 and precio_unidad = 450000
      and proveedor = 'Gomería Sur' and factura = 'A-0001-00012345' and soporte = 'OC 77'
      and ((numero_quema = 'L-1' and dot = '0825') or (numero_quema = 'L-2' and dot = '0925') or (numero_quema = 'L-3' and dot is null))),
  3::bigint);
select test.eq('feliz: 3 eventos alta_stock',
  (select count(*) from public.eventos_neumatico e join public.neumaticos n on n.id = e.neumatico_id
    where n.numero_quema in ('L-1', 'L-2', 'L-3') and e.tipo = 'alta_stock'), 3::bigint);

-- ---- 3. Límites: lo rechazado no deja filas; lo válido entra ------------------------------------------------------
create temp table _n121 as select pg_temp.n121() as n;
grant select on _n121 to public;
select test.become('authenticated', test.u_cli_a());
select test.eq('lote vacío: 22023', pg_temp.st121($$select public.stock_cubiertas_agregar_lote('{"marca":"X","profundidad_inicial_mm":16}', '[]')$$), '22023');
select test.eq('lote de 201: 22023', pg_temp.st121($$select public.stock_cubiertas_agregar_lote('{"marca":"X","profundidad_inicial_mm":16}', (select jsonb_agg(jsonb_build_object('numero_quema', 'Q' || g)) from generate_series(1, 201) g))$$), '22023');
select test.eq('quema repetida (L-9 y l-9 con espacio): 23505 con el primer texto',
  pg_temp.msg121($$select public.stock_cubiertas_agregar_lote('{"marca":"X","profundidad_inicial_mm":16}', '[{"numero_quema":"L-9"},{"numero_quema":"l-9 "}]')$$),
  '23505|Quema repetida en el lote: L-9');
select test.eq('quema existente en el cliente con otra nueva: 23505 y ninguna entra',
  pg_temp.msg121($$select public.stock_cubiertas_agregar_lote('{"marca":"X","profundidad_inicial_mm":16}', '[{"numero_quema":"N-NUEVA"},{"numero_quema":"L-1"}]')$$),
  '23505|Ya existe una cubierta con la quema L-1');
select test.eq('DOT 5425: 22023', pg_temp.st121($$select public.stock_cubiertas_agregar_lote('{"marca":"X","profundidad_inicial_mm":16}', '[{"numero_quema":"D-2","dot":"5425"}]')$$), '22023');
select test.eq('DOT 0025: 22023', pg_temp.st121($$select public.stock_cubiertas_agregar_lote('{"marca":"X","profundidad_inicial_mm":16}', '[{"numero_quema":"D-3","dot":"0025"}]')$$), '22023');
select test.eq('DOT 825: 22023', pg_temp.st121($$select public.stock_cubiertas_agregar_lote('{"marca":"X","profundidad_inicial_mm":16}', '[{"numero_quema":"D-4","dot":"825"}]')$$), '22023');
select test.eq('DOT 08A5: 22023', pg_temp.st121($$select public.stock_cubiertas_agregar_lote('{"marca":"X","profundidad_inicial_mm":16}', '[{"numero_quema":"D-5","dot":"08A5"}]')$$), '22023');
select test.eq('DOT de la semana siguiente a la actual: 22023',
  pg_temp.st121(format($$select public.stock_cubiertas_agregar_lote('{"marca":"X","profundidad_inicial_mm":16}', '[{"numero_quema":"D-6","dot":"%s"}]')$$,
    to_char(current_date + 7, 'IW') || to_char(current_date + 7, 'IYY'))), '22023');
select test.eq('mm ausentes: 22023', pg_temp.st121($$select public.stock_cubiertas_agregar_lote('{"marca":"X"}', '[{"numero_quema":"M-1"}]')$$), '22023');
select test.eq('mm 0: 22023', pg_temp.st121($$select public.stock_cubiertas_agregar_lote('{"marca":"X","profundidad_inicial_mm":0}', '[{"numero_quema":"M-2"}]')$$), '22023');
select test.eq('mm 30,1: 22023', pg_temp.st121($$select public.stock_cubiertas_agregar_lote('{"marca":"X","profundidad_inicial_mm":30.1}', '[{"numero_quema":"M-3"}]')$$), '22023');
select test.eq('clave color: 22023', pg_temp.st121($$select public.stock_cubiertas_agregar_lote('{"marca":"X","profundidad_inicial_mm":16,"color":"rojo"}', '[{"numero_quema":"M-4"}]')$$), '22023');
select test.eq('factura de 61: 22023', pg_temp.st121($$select public.stock_cubiertas_agregar_lote(jsonb_build_object('marca','X','profundidad_inicial_mm',16,'factura',repeat('A',61)), '[{"numero_quema":"F-61"}]')$$), '22023');
reset role;
select test.eq('los rechazos no dejaron filas', (select n from _n121), pg_temp.n121());

select test.become('authenticated', test.u_cli_a());
select test.eq('límite: 200 cubiertas entran',
  (public.stock_cubiertas_agregar_lote('{"marca":"X","profundidad_inicial_mm":16}',
     (select jsonb_agg(jsonb_build_object('numero_quema', 'Q' || g)) from generate_series(1, 200) g))->>'cantidad')::int, 200);
select test.eq('DOT 5325 (semana 53 de 2025) entra',
  (public.stock_cubiertas_agregar_lote('{"marca":"X","profundidad_inicial_mm":16}', '[{"numero_quema":"D-1","dot":"5325"}]')->>'cantidad')::int, 1);
select test.eq('mm 30 entra',
  (public.stock_cubiertas_agregar_lote('{"marca":"X","profundidad_inicial_mm":30}', '[{"numero_quema":"M-30"}]')->>'cantidad')::int, 1);
select test.eq('factura de 60 entra',
  (public.stock_cubiertas_agregar_lote(jsonb_build_object('marca','X','profundidad_inicial_mm',16,'factura',repeat('A',60)), '[{"numero_quema":"F-60"}]')->>'cantidad')::int, 1);
select test.eq('proveedor en blanco entra como nulo',
  (public.stock_cubiertas_agregar_lote('{"marca":"X","profundidad_inicial_mm":16,"proveedor":"   "}', '[{"numero_quema":"P-1"}]')->>'cantidad')::int, 1);
reset role;
select test.eq('tras los aceptados: 204 filas más (200 + DOT + mm 30 + factura 60 + proveedor)', pg_temp.n121(), (select n from _n121) + 204);
select test.eq('proveedor en blanco quedó nulo', (select proveedor is null from public.neumaticos where numero_quema = 'P-1'), true);
select test.eq('DOT 5325 guardado', (select dot from public.neumaticos where numero_quema = 'D-1'), '5325');
select test.eq('mm 30 guardado', (select profundidad_inicial_mm from public.neumaticos where numero_quema = 'M-30'), 30::numeric);

-- ---- 4. Editar los datos de compra (dueño global) ----------------------------------------------------------------
select test.become('authenticated', test.u_cli_a());
select public.stock_cubierta_editar(test.id121('L-1'), '{"dot":"1024","medida":"11R22.5"}');
select public.stock_cubierta_editar(test.id121('L-2'), '{"dot":""}');
select test.denied('editar: DOT 99 denegado', $$select public.stock_cubierta_editar(test.id121('L-1'), '{"dot":"99"}')$$, '22023');
reset role;
select test.eq('editar: DOT y medida actualizados', (select dot || '|' || medida from public.neumaticos where numero_quema = 'L-1'), '1024|11R22.5');
select test.eq('editar: texto vacío borra el DOT', (select dot is null from public.neumaticos where numero_quema = 'L-2'), true);

-- ---- 5. Columnas: la sucursal lee los datos de compra y no el precio ---------------------------------------------
-- El stock (vehiculo_id nulo) solo lo ve el perfil global: la sucursal ve las cubiertas montadas en sus vehículos.
-- Por eso la prueba usa T-1-2 (fixture) montada en el vehículo 1, que pasa a la sucursal 1301.
update public.vehiculos set sucursal_id = 1301 where id = 1;
update public.neumaticos set dot = '1024', medida = '11R22.5', proveedor = 'Gomería Sur', factura = 'A-0001-00012345', soporte = 'OC 77'
 where idneumatico = 'T-1-2';
select test.become('authenticated', test.u121_s());
select test.eq('columnas: la sucursal lee dot, medida, proveedor, factura y soporte',
  (select dot || '|' || medida || '|' || proveedor || '|' || factura || '|' || soporte from public.neumaticos where idneumatico = 'T-1-2'),
  '1024|11R22.5|Gomería Sur|A-0001-00012345|OC 77');
select test.denied('columnas: la sucursal no lee precio_unidad', $$select precio_unidad from public.neumaticos where idneumatico = 'T-1-2'$$, '42501');
select test.denied('columnas: update directo de dot denegado', $$update public.neumaticos set dot = '0125' where idneumatico = 'T-1-2'$$, '42501');
reset role;

-- ---- 6. Vida sin tope --------------------------------------------------------------------------------------------
-- Cubiertas de partida con vida 3 y 7 (inserción de dueño, como lo haría el seed).
insert into public.neumaticos (vehiculo_id, cliente_id, posicion, marca, idneumatico, estado, condicion, sucursal_id, numero_quema, vida) values
  (null, 1, null, 'Michelin', 'V-121-1', 'almacenado', 'nuevo', 1301, 'V-Q1', 3),
  (null, 1, null, 'Michelin', 'V-121-2', 'almacenado', 'nuevo', 1301, 'V-Q2', 7);
select test.become('authenticated', test.u_cli_a());
select test.eq('vida 3: el envío pasa', (public.recauchutado_enviar(test.id121('V-Q1'), 'Prov 121') ->> 'estado'), 'enviado');
select test.eq('vida 7: también se envía', (public.recauchutado_enviar(test.id121('V-Q2'), 'Prov 121') ->> 'estado'), 'enviado');
select public.recauchutado_dictaminar(test.pid121(test.id121('V-Q1')), true);
select public.recauchutado_aceptar(test.pid121(test.id121('V-Q1')), 15);
reset role;
select test.eq('vida 3 aceptada queda en vida 4', (select vida from public.neumaticos where numero_quema = 'V-Q1'), 4);
select test.eq('vida 4 con fila en neumatico_vidas', (select count(*) from public.neumatico_vidas where neumatico_id = test.id121('V-Q1') and vida = 4), 1::bigint);

-- Reencauche de una cubierta de vida 3 (T-1-1 del fixture), con una nueva de vida 5 que entra.
update public.neumaticos set vida = 3 where idneumatico = 'T-1-1';
select test.become('authenticated', test.u_cli_a());
select test.eq('reencauche con viejo de vida 3 y nuevo de vida 5 pasa',
  (public.neumatico_cambiar(1::bigint, 1::smallint, 'reencauche', null, null, null, '{"marca":"M","vida":5}', p_motivo_codigo => 'otro', p_motivo_texto => 'Motivo de prueba')->>'posicion')::int, 1);
select test.eq('vida -1 en el nuevo: 23514',
  pg_temp.st121($$select public.neumatico_cambiar(1::bigint, 1::smallint, 'reencauche', null, null, null, '{"marca":"M","vida":-1}', p_motivo_codigo => 'otro', p_motivo_texto => 'Motivo de prueba')$$), '23514');
reset role;
-- T-1-3 no está en un proceso de recauchutado (V-121-2 sí, y ahí el trigger corta antes con 55000).
select test.eq('vida -1 en la tabla: el check la rechaza (dueño)', pg_temp.st121($$update public.neumaticos set vida = -1 where idneumatico = 'T-1-3'$$), '23514');

-- ---- 7. Semanas hasta crítico y retiro, mensajes exactos y catálogo -----------------------------------------------
insert into public.vehiculos (id, cliente_id, nombre, patente, activo, odometro_km) values
  (1311, 1, 'V121-S', 'T121S', true, 1000),
  (1312, 1, 'V121-L', 'T121L', true, 1000),
  (1313, 1, 'V121-W', 'T121W', true, 48000);
insert into public.neumaticos (vehiculo_id, cliente_id, posicion, idneumatico, estado, marca, condicion) values
  (1311, 1, 1, 'SEM-1', 'montado', 'M', 'nuevo'),
  (1311, 1, 2, 'SEM-2', 'montado', 'M', 'nuevo'),
  (1312, 1, 3, 'LIM-1', 'montado', 'M', 'nuevo'),
  (1313, 1, 3, 'SW-1',  'montado', 'M', 'nuevo');
-- Montaje de SW-1 a 10.000 km: con el odómetro de 48.000 km el swap marca 38.000 km.
insert into public.eventos_neumatico (cliente_id, vehiculo_id, neumatico_id, idneumatico, tipo, odometro_km, created_at)
  values (1, 1313, (select id from public.neumaticos where idneumatico = 'SW-1'), 'SW-1', 'montaje', 10000, now() - interval '2000 hours');
-- SEM-1: promedio 10, 9,5 y 9 (huella mínima 8) en 14 días: tasa 0,5 mm por semana. SEM-2 sin medir.
insert into public.mediciones (vehiculo_id, cliente_id, posicion, idneumatico, mm1, mm2, mm3, created_at) values
  (1311, 1, 1, 'SEM-1', 10, 10, 10, now() - interval '14 days'),
  (1311, 1, 1, 'SEM-1', 9.5, 9.5, 9.5, now() - interval '7 days'),
  (1311, 1, 1, 'SEM-1', 10, 8, 9, now()),
  (1312, 1, 3, 'LIM-1', 2.8, 4.0, 4.2, now()),
  (1313, 1, 3, 'SW-1', 10, 10, 10, now());
select public.alerta_sincronizar(1, null);

savepoint s121;
update public.clientes set umbral_critico_mm = 3, umbral_retiro_mm = 2 where id = 1;
select test.eq('semanas: crítico 10 y retiro 12 con la huella mínima (no 12 y 14 con el promedio)',
  (select semanas_hasta_critico = 10 and semanas_hasta_retiro = 12 from public.v_estado_neumaticos where idneumatico = 'SEM-1'), true);
select test.eq('semanas: sin mm, nulas', (select semanas_hasta_critico is null and semanas_hasta_retiro is null from public.v_estado_neumaticos where idneumatico = 'SEM-2'), true);
rollback to savepoint s121;

select test.eq('mensaje límite 2,8 mm sin umbral entre paréntesis',
  (select mensaje from public.v_alertas where idneumatico = 'LIM-1' and tipo = 'limite'), 'Desgaste límite: 2,8 mm');
select test.eq('mensaje swap 38.000 km con «Primera rotación»',
  (select mensaje from public.v_alertas where idneumatico = 'SW-1' and tipo = 'swap'), 'Primera rotación: 38.000 km desde el montaje');
select test.eq('catálogo: las dos filas swap_20000 se llaman «Primera rotación»',
  (select count(*) from public.motivos_movimiento where codigo = 'swap_20000' and etiqueta = 'Primera rotación'), 2::bigint);

rollback;
