-- Montar y desmontar neumáticos sin reemplazo (neumatico_montar, neumatico_desmontar; migración 20261114500000):
-- matriz de roles, posición libre y esperada (10/16 ruedas y auxilio 99), quema única, cubierta del stock del
-- mismo cliente, odómetro que solo sube, evento registrado, desmontar a stock/reparación/baja con historial conservado
-- y que la API de proveedor deje de responder sin_neumaticos al montar un neumático con idneumatico.
-- Todo en una transacción que se revierte; cada escenario vuelve a un savepoint.
begin;

insert into auth.users (id, email) values ('a0000000-0000-0000-0000-0000000000c7', 'sb87@t');
insert into public.sucursales (id, cliente_id, nombre) overriding system value values
  (871, 1, 'Norte87'), (872, 1, 'Sur87'), (873, 2, 'Ajena87');
insert into public.perfiles (user_id, rol, cliente_id, sucursal_id) values
  ('a0000000-0000-0000-0000-0000000000c7', 'cliente', 1, 871);
create or replace function test.u_s87() returns uuid language sql immutable as $$ select 'a0000000-0000-0000-0000-0000000000c7'::uuid $$;
grant execute on function test.u_s87() to public;

insert into public.vehiculos (id, cliente_id, nombre, patente, activo, tipo_ruedas, sucursal_id, odometro_km) values
  (871, 1, 'T87 propia',  'TT8710', true, 10, 871, 1000),   -- sucursal del perfil
  (872, 1, 'T87 ajena',   'TT8720', true, 16, 872, null),   -- otra sucursal del mismo cliente
  (873, 2, 'T87 otro',    'TT8730', true, 10, 873, null);   -- otro cliente
-- Neumáticos de partida: uno montado en el vehículo de B y cubiertas del stock de A y de B
insert into public.neumaticos (vehiculo_id, cliente_id, posicion, idneumatico, estado, numero_quema, marca) values
  (873, 2, 1, 'T-873-1', 'montado', 'Q-B-MONTADA', 'B');
insert into public.neumaticos (vehiculo_id, cliente_id, posicion, marca, modelo, idneumatico, estado, condicion,
                               sucursal_id, numero_quema, precio_unidad, km_previos) values
  (null, 1, null, 'Michelin', 'X', 'CB-87-a', 'almacenado', 'nuevo',     871, 'S87-A1', 500, 0),
  (null, 1, null, 'Pirelli',  'Y', 'CB-87-b', 'almacenado', 'reparado',  null, 'S87-A2', 300, 12000),
  (null, 2, null, 'Ajena',    'Z', 'CB-87-c', 'almacenado', 'nuevo',     873, 'S87-B1', 200, 0);
create temp table _c as select numero_quema k, id from public.neumaticos where idneumatico like 'CB-87-%';
grant select on _c to public;
select count(*) as ev0 from public.eventos_neumatico \gset
create temp table _r (k text, r jsonb);
grant all on _r to public;
savepoint s0;

-- ---------------------------------------------------------------------------------------------
-- A. Permisos de ejecución y matriz de roles (42501 uniforme; la base queda intacta)
-- ---------------------------------------------------------------------------------------------
select test.become('anon', null);
select test.denied('anon no monta', $$select public.neumatico_montar(871::bigint, 1::smallint, null, '{"marca":"X"}')$$);
select test.denied('anon no desmonta', $$select public.neumatico_desmontar(871::bigint, 1::smallint, 'baja', 'x')$$);
reset role;
select test.become('authenticated', test.u_admin());
select test.denied('el helper de autorización no es invocable', $$select * from public.neumatico_autorizar_vehiculo(871::bigint)$$);
reset role;

create temp table _roles (rol text, uid uuid, veh bigint);
insert into _roles values
  ('api', test.u_api(), 871), ('sin perfil', test.u_sinperfil(), 871),
  ('otro cliente (global B)', test.u_cli_b(), 871),
  ('sucursal propia en vehículo de otra sucursal', test.u_s87(), 872),
  ('sucursal propia en vehículo de otro cliente', test.u_s87(), 873),
  ('global A en vehículo de otro cliente', test.u_cli_a(), 873);
grant select on _roles to public;
do $t$
declare r record;
begin
  for r in select * from pg_temp._roles loop
    perform test.become('authenticated', r.uid);
    perform test.denied(r.rol || ': no monta (nuevo)', format('select public.neumatico_montar(%s::bigint, 1::smallint, null, ''{"marca":"X"}'')', r.veh));
    perform test.denied(r.rol || ': no monta (cubierta)', format('select public.neumatico_montar(%s::bigint, 2::smallint, %s)', r.veh, (select id from pg_temp._c where k = 'S87-A1')));
    perform test.denied(r.rol || ': no desmonta', format('select public.neumatico_desmontar(%s::bigint, 1::smallint, ''baja'', ''x'')', r.veh));
    reset role;
  end loop;
end
$t$;
select test.become('authenticated', test.u_cli_a());
select test.denied('vehículo inexistente para un no-admin: mismo error', $$select public.neumatico_montar(99999::bigint, 1::smallint, null, '{"marca":"X"}')$$);
reset role;
select test.eq('los rechazos no montaron nada (871, 872)', (select count(*) from public.neumaticos where vehiculo_id in (871, 872)), 0::bigint);
select test.eq('...ni tocaron la cubierta del stock', (select estado from public.neumaticos where idneumatico = 'CB-87-a'), 'almacenado');
select test.eq('...ni registraron eventos', (select count(*) from public.eventos_neumatico), :ev0::bigint);
select test.become('authenticated', test.u_admin());
select test.denied('admin: vehículo inexistente', $$select public.neumatico_montar(99999::bigint, 1::smallint, null, '{"marca":"X"}')$$, 'P0002');
reset role;
rollback to s0;

-- ---------------------------------------------------------------------------------------------
-- B. Roles permitidos: admin, global y sucursal propia (solo ingreso a mano)
-- ---------------------------------------------------------------------------------------------
select test.become('authenticated', test.u_admin());
select test.eq('admin monta en cualquier vehículo', (public.neumatico_montar(872::bigint, 1::smallint, null, '{"marca":"Adm"}')->>'posicion'), '1');
reset role;
select test.become('authenticated', test.u_cli_a());
select test.eq('global monta en su vehículo', (public.neumatico_montar(871::bigint, 1::smallint, null, '{"marca":"Glob"}')->>'posicion'), '1');
reset role;
select test.become('authenticated', test.u_s87());
select test.eq('sucursal propia monta ingresando a mano', (public.neumatico_montar(871::bigint, 2::smallint, null, '{"marca":"Suc"}')->>'posicion'), '2');
select test.denied('sucursal propia no usa el stock', format('select public.neumatico_montar(871::bigint, 3::smallint, %s)', (select id from pg_temp._c where k = 'S87-A1')));
reset role;
select test.eq('la cubierta del stock sigue en stock tras el rechazo', (select estado from public.neumaticos where idneumatico = 'CB-87-a'), 'almacenado');
select test.eq('montados: 1 en 872 y 2 en 871', (select count(*) from public.neumaticos where vehiculo_id in (871, 872) and estado = 'montado'), 3::bigint);
rollback to s0;

-- ---------------------------------------------------------------------------------------------
-- C. Montar un neumático ingresado a mano: datos, evento, odómetro
-- ---------------------------------------------------------------------------------------------
select test.become('authenticated', test.u_cli_a());
insert into _r select 'm1', public.neumatico_montar(871::bigint, 3::smallint, null,
  '{"marca":" Bridgestone ","modelo":"R249","numero_quema":" nq-1 ","km_previos":4500,"fecha_compra":"2026-01-10","precio":450.555,"vida":1}'::jsonb,
  1500, ' prueba ');
reset role;
select test.eq('fila montada: datos normalizados',
  (select marca || '|' || modelo || '|' || numero_quema || '|' || km_previos || '|' || fecha_compra || '|' || test.pu(id) || '|' || vida || '|' || condicion
          || '|' || estado || '|' || posicion || '|' || auxilio || '|' || cliente_id
     from public.neumaticos where vehiculo_id = 871 and posicion = 3),
  'Bridgestone|R249|nq-1|4500|2026-01-10|450.56|1|recauchutado|montado|3|false|1');
select test.eq('idneumatico generado con prefijo CN-', (select idneumatico ~ '^CN-871-3-[0-9a-f]{8}$' from public.neumaticos where vehiculo_id = 871 and posicion = 3), true);
select test.eq('evento montaje con posición, odómetro, costo, autor y notas',
  (select tipo || '|' || posicion_destino || '|' || odometro_km || '|' || test.cu(id) || '|' || (created_by = test.u_cli_a()) || '|' || (notas like 'Montaje en posición libre%quema nq-1%4500 km previos%prueba')
     from public.eventos_neumatico where neumatico_id = (select id from public.neumaticos where vehiculo_id = 871 and posicion = 3)),
  'montaje|3|1500|450.56|true|true');
select test.eq('el odómetro del vehículo sube a 1500', (select odometro_km from public.vehiculos where id = 871), 1500);
select test.eq('la respuesta trae el id y el evento',
  (select (r->>'idneumatico') = (select idneumatico from public.neumaticos where vehiculo_id = 871 and posicion = 3) and (r->>'evento_id') is not null from _r where k = 'm1'), true);

select test.become('authenticated', test.u_cli_a());
-- odómetro: no puede bajar; igual al actual vale; sin odómetro no toca el del vehículo
select test.denied('odómetro menor al actual', $$select public.neumatico_montar(871::bigint, 4::smallint, null, '{"marca":"M"}', 1499)$$, '23514');
select test.denied('odómetro negativo', $$select public.neumatico_montar(871::bigint, 4::smallint, null, '{"marca":"M"}', -1)$$, '23514');
select test.eq('odómetro igual al actual', (public.neumatico_montar(871::bigint, 4::smallint, null, '{"marca":"M"}', 1500)->>'odometro_km'), '1500');
select test.eq('sin odómetro: devuelve el actual', (public.neumatico_montar(871::bigint, 5::smallint, null, '{"marca":"M"}')->>'odometro_km'), '1500');
reset role;
select test.eq('eventos sin odómetro: nulo', (select odometro_km is null from public.eventos_neumatico where neumatico_id = (select id from public.neumaticos where vehiculo_id = 871 and posicion = 5)), true);
-- vehículo sin odómetro previo: se fija el informado
select test.become('authenticated', test.u_cli_a());
select test.eq('odómetro inicial del vehículo sin lectura', (public.neumatico_montar(872::bigint, 1::smallint, null, '{"marca":"M"}', 700)->>'odometro_km'), '700');

-- Posición ocupada, fuera de rango y esperada según tipo de ruedas
select test.denied('posición ocupada', $$select public.neumatico_montar(871::bigint, 3::smallint, null, '{"marca":"M"}')$$, '55000');
select test.denied('posición 0', $$select public.neumatico_montar(871::bigint, 0::smallint, null, '{"marca":"M"}')$$, '23514');
select test.denied('posición 100', $$select public.neumatico_montar(871::bigint, 100::smallint, null, '{"marca":"M"}')$$, '23514');
select test.denied('posición negativa', $$select public.neumatico_montar(871::bigint, (-2)::smallint, null, '{"marca":"M"}')$$, '23514');
select test.denied('posición nula', $$select public.neumatico_montar(871::bigint, null, null, '{"marca":"M"}')$$, '22004');
select test.denied('tipo 10: la posición 11 no existe', $$select public.neumatico_montar(871::bigint, 11::smallint, null, '{"marca":"M"}')$$, '23514');
select test.denied('tipo 10: la posición 50 no existe', $$select public.neumatico_montar(871::bigint, 50::smallint, null, '{"marca":"M"}')$$, '23514');
select test.eq('tipo 10: la posición 10 sí', (public.neumatico_montar(871::bigint, 10::smallint, null, '{"marca":"M"}')->>'posicion'), '10');
select test.eq('tipo 16: la posición 16 sí', (public.neumatico_montar(872::bigint, 16::smallint, null, '{"marca":"M"}')->>'posicion'), '16');
select test.denied('tipo 16: la posición 17 no existe', $$select public.neumatico_montar(872::bigint, 17::smallint, null, '{"marca":"M"}')$$, '23514');
-- Auxilio 99
select test.eq('auxilio 99 en tipo 10', (public.neumatico_montar(871::bigint, 99::smallint, null, '{"marca":"Aux"}')->>'auxilio'), 'true');
select test.denied('segundo auxilio: la posición está ocupada', $$select public.neumatico_montar(871::bigint, 99::smallint, null, '{"marca":"Aux2"}')$$, '55000');
select test.eq('auxilio 99 en tipo 16', (public.neumatico_montar(872::bigint, 99::smallint, null, '{"marca":"Aux"}')->>'auxilio'), 'true');
reset role;
select test.eq('solo la 99 es auxilio', (select string_agg(posicion::text, ',' order by posicion) from public.neumaticos where vehiculo_id = 871 and auxilio), '99');
-- Un vehículo de tipo 10 con un neumático montado en 11..98 se trata como de 16 (igual que el diagrama)
insert into public.neumaticos (vehiculo_id, cliente_id, posicion, idneumatico, estado) values (871, 1, 12, 'T-871-12', 'montado');
select test.become('authenticated', test.u_cli_a());
select test.eq('tipo 10 con neumático en 12: se acepta la 13', (public.neumatico_montar(871::bigint, 13::smallint, null, '{"marca":"M"}')->>'posicion'), '13');
select test.denied('...pero no la 17', $$select public.neumatico_montar(871::bigint, 17::smallint, null, '{"marca":"M"}')$$, '23514');
reset role;
rollback to s0;

-- Validación de datos
select test.become('authenticated', test.u_cli_a());
select test.denied('sin origen', $$select public.neumatico_montar(871::bigint, 1::smallint)$$, '22023');
select test.denied('cubierta y nuevo a la vez', format('select public.neumatico_montar(871::bigint, 1::smallint, %s, ''{"marca":"M"}'')', (select id from pg_temp._c where k = 'S87-A1')), '22023');
select test.denied('nuevo no es objeto', $$select public.neumatico_montar(871::bigint, 1::smallint, null, '[1]')$$, '22023');
select test.denied('marca vacía', $$select public.neumatico_montar(871::bigint, 1::smallint, null, '{"marca":"  "}')$$, '22023');
select test.denied('sin marca', $$select public.neumatico_montar(871::bigint, 1::smallint, null, '{"modelo":"X"}')$$, '22023');
select test.denied('marca demasiado larga', format('select public.neumatico_montar(871::bigint, 1::smallint, null, ''{"marca":"%s"}'')', repeat('m', 61)), '22023');
select test.denied('quema demasiado larga', format('select public.neumatico_montar(871::bigint, 1::smallint, null, ''{"marca":"M","numero_quema":"%s"}'')', repeat('q', 41)), '22023');
select test.denied('campo desconocido', $$select public.neumatico_montar(871::bigint, 1::smallint, null, '{"marca":"M","cliente_id":2}')$$, '22023');
select test.denied('km previos negativos', $$select public.neumatico_montar(871::bigint, 1::smallint, null, '{"marca":"M","km_previos":-1}')$$, '23514');
select test.denied('km previos decimales', $$select public.neumatico_montar(871::bigint, 1::smallint, null, '{"marca":"M","km_previos":10.5}')$$, '23514');
select test.denied('km previos texto', $$select public.neumatico_montar(871::bigint, 1::smallint, null, '{"marca":"M","km_previos":"10"}')$$, '22023');
select test.denied('vida 4', $$select public.neumatico_montar(871::bigint, 1::smallint, null, '{"marca":"M","vida":4}')$$, '23514');
select test.denied('vida decimal', $$select public.neumatico_montar(871::bigint, 1::smallint, null, '{"marca":"M","vida":1.5}')$$, '23514');
select test.denied('precio negativo', $$select public.neumatico_montar(871::bigint, 1::smallint, null, '{"marca":"M","precio":-1}')$$, '23514');
select test.denied('fecha futura', format('select public.neumatico_montar(871::bigint, 1::smallint, null, ''{"marca":"M","fecha_compra":"%s"}'')', current_date + 30), '23514');
select test.denied('notas demasiado largas', format('select public.neumatico_montar(871::bigint, 1::smallint, null, ''{"marca":"M"}'', null, ''%s'')', repeat('n', 201)), '22023');
reset role;
select test.eq('los rechazos no montaron nada', (select count(*) from public.neumaticos where vehiculo_id = 871), 0::bigint);
select test.eq('...ni cambiaron el odómetro', (select odometro_km from public.vehiculos where id = 871), 1000);
rollback to s0;

-- ---------------------------------------------------------------------------------------------
-- D. Quema única por cliente (sin distinguir mayúsculas) y entre estados
-- ---------------------------------------------------------------------------------------------
select test.become('authenticated', test.u_cli_a());
select test.eq('monta con quema nueva', (public.neumatico_montar(871::bigint, 1::smallint, null, '{"marca":"M","numero_quema":"NQ-87"}')->>'numero_quema'), 'NQ-87');
select test.denied('quema repetida (otro neumático montado)', $$select public.neumatico_montar(871::bigint, 2::smallint, null, '{"marca":"M","numero_quema":"NQ-87"}')$$, '23505');
select test.denied('quema repetida con otra capitalización', $$select public.neumatico_montar(871::bigint, 2::smallint, null, '{"marca":"M","numero_quema":"nq-87"}')$$, '23505');
select test.denied('quema repetida de una cubierta del stock', $$select public.neumatico_montar(871::bigint, 2::smallint, null, '{"marca":"M","numero_quema":"s87-a1"}')$$, '23505');
select test.eq('sin quema', (public.neumatico_montar(871::bigint, 2::smallint, null, '{"marca":"M"}')->>'numero_quema') is null, true);
select test.eq('sin quema (otra vez: el vacío no cuenta como repetido)', (public.neumatico_montar(871::bigint, 3::smallint, null, '{"marca":"M"}')->>'numero_quema') is null, true);
reset role;
select test.become('authenticated', test.u_cli_b());
select test.eq('la misma quema en otro cliente es válida', (public.neumatico_montar(873::bigint, 2::smallint, null, '{"marca":"M","numero_quema":"NQ-87"}')->>'numero_quema'), 'NQ-87');
reset role;
rollback to s0;

-- ---------------------------------------------------------------------------------------------
-- E. Montar una cubierta del stock: misma fila, quema y km conservados, Nuevo -> Usado, solo del mismo cliente
-- ---------------------------------------------------------------------------------------------
select test.become('authenticated', test.u_cli_a());
insert into _r select 'c1', public.neumatico_montar(871::bigint, 4::smallint, (select id from pg_temp._c where k = 'S87-A1'), null, 1100, 'del stock');
reset role;
select test.eq('misma fila: quema y idneumatico conservados, montada, usado, sin sucursal, en la posición',
  (select numero_quema || '|' || idneumatico || '|' || estado || '|' || condicion || '|' || (sucursal_id is null) || '|' || vehiculo_id || '|' || posicion || '|' || auxilio
     from public.neumaticos where id = (select id from pg_temp._c where k = 'S87-A1')),
  'S87-A1|CB-87-a|montado|usado|true|871|4|false');
select test.eq('no se duplicó la cubierta', (select count(*) from public.neumaticos where numero_quema = 'S87-A1'), 1::bigint);
select test.eq('evento montaje: costo (primer montaje), sucursal de origen y odómetro',
  (select tipo || '|' || test.cu(id) || '|' || sucursal_origen_id || '|' || odometro_km || '|' || (notas like '%cubierta del stock (Norte87)%') from public.eventos_neumatico where neumatico_id = (select id from pg_temp._c where k = 'S87-A1')),
  'montaje|500.00|871|1100|true');
select test.eq('el odómetro del vehículo sube', (select odometro_km from public.vehiculos where id = 871), 1100);
select test.become('authenticated', test.u_cli_a());
-- cubierta ya montada, de otro cliente e inexistente: mismo error
select test.denied('cubierta ya montada', format('select public.neumatico_montar(871::bigint, 5::smallint, %s)', (select id from pg_temp._c where k = 'S87-A1')), 'P0002');
select test.denied('cubierta de otro cliente', format('select public.neumatico_montar(871::bigint, 5::smallint, %s)', (select id from pg_temp._c where k = 'S87-B1')), 'P0002');
select test.denied('cubierta inexistente', $$select public.neumatico_montar(871::bigint, 5::smallint, 999999::bigint)$$, 'P0002');
select test.denied('cubierta en posición ocupada', format('select public.neumatico_montar(871::bigint, 4::smallint, %s)', (select id from pg_temp._c where k = 'S87-A2')), '55000');
-- cubierta ya usada (reparada, 12000 km previos): sin costo
select test.eq('cubierta reparada con km previos', (public.neumatico_montar(871::bigint, 5::smallint, (select id from pg_temp._c where k = 'S87-A2'))->>'km_previos'), '12000');
reset role;
select test.eq('la cubierta reparada conserva su condición y no imputa costo',
  (select n.condicion || '|' || coalesce(test.cu(e.id)::text, 'sin costo') from public.neumaticos n join public.eventos_neumatico e on e.neumatico_id = n.id and e.tipo = 'montaje' where n.numero_quema = 'S87-A2'), 'reparado|sin costo');
select test.eq('la cubierta de B no se tocó', (select estado || '|' || (vehiculo_id is null) from public.neumaticos where numero_quema = 'S87-B1'), 'almacenado|true');
-- Admin: la cubierta debe ser del cliente del vehículo
select test.become('authenticated', test.u_admin());
select test.denied('admin: cubierta de otro cliente que el vehículo', format('select public.neumatico_montar(871::bigint, 6::smallint, %s)', (select id from pg_temp._c where k = 'S87-B1')), 'P0002');
select test.eq('admin monta la cubierta de B en un vehículo de B', (public.neumatico_montar(873::bigint, 3::smallint, (select id from pg_temp._c where k = 'S87-B1'))->>'posicion'), '3');
reset role;
rollback to s0;

-- ---------------------------------------------------------------------------------------------
-- F. Desmontar: stock, reparación y baja; historial conservado
-- ---------------------------------------------------------------------------------------------
select test.become('authenticated', test.u_cli_a());
insert into _r select 'm', public.neumatico_montar(871::bigint, 6::smallint, (select id from pg_temp._c where k = 'S87-A1'), null, 1100);
reset role;
insert into public.mediciones (vehiculo_id, cliente_id, posicion, mm1, mm2, mm3, idneumatico, created_at)
  values (871, 1, 6, 12, 12, 12, 'CB-87-a', now() - interval '1 day');
select test.become('authenticated', test.u_cli_a());
select test.denied('posición vacía', $$select public.neumatico_desmontar(871::bigint, 7::smallint, 'baja', 'x')$$, 'P0002');
select test.denied('destino inválido', $$select public.neumatico_desmontar(871::bigint, 6::smallint, 'reencauche', 'x')$$, '22023');
select test.denied('baja sin motivo', $$select public.neumatico_desmontar(871::bigint, 6::smallint, 'baja')$$, '22023');
select test.denied('baja con motivo en blanco', $$select public.neumatico_desmontar(871::bigint, 6::smallint, 'baja', '  ')$$, '22023');
select test.denied('motivo demasiado largo', format('select public.neumatico_desmontar(871::bigint, 6::smallint, ''baja'', ''%s'')', repeat('m', 201)), '22023');
select test.denied('odómetro menor', $$select public.neumatico_desmontar(871::bigint, 6::smallint, 'almacenado', null, 1099)$$, '23514');
select test.denied('sucursal de otro cliente', $$select public.neumatico_desmontar(871::bigint, 6::smallint, 'almacenado', null, null, 873::bigint)$$);
select test.denied('sucursal con reparación', $$select public.neumatico_desmontar(871::bigint, 6::smallint, 'reparacion', null, null, 871::bigint)$$, '22023');
select test.denied('posición fuera de rango', $$select public.neumatico_desmontar(871::bigint, 100::smallint, 'baja', 'x')$$, '23514');
-- A stock en una sucursal
select test.eq('desmontar a stock en Sur87',
  (public.neumatico_desmontar(871::bigint, 6::smallint, 'almacenado', 'montaje equivocado', 1200, 872::bigint)->>'en_stock'), 'true');
reset role;
select test.eq('misma fila: sin vehículo ni posición, almacenado, sucursal, quema, condición e idneumatico conservados',
  (select (vehiculo_id is null) || '|' || (posicion is null) || '|' || estado || '|' || sucursal_id || '|' || numero_quema || '|' || condicion || '|' || idneumatico || '|' || auxilio
     from public.neumaticos where id = (select id from pg_temp._c where k = 'S87-A1')),
  'true|true|almacenado|872|S87-A1|usado|CB-87-a|false');
select test.eq('historial conservado: mediciones', (select count(*) from public.mediciones where idneumatico = 'CB-87-a'), 1::bigint);
select test.eq('historial conservado: eventos montaje y desmontaje con sucursal y odómetro',
  (select string_agg(tipo || ':' || coalesce(odometro_km::text, '-') || ':' || coalesce(sucursal_destino_id::text, '-'), ',' order by id)
     from public.eventos_neumatico where neumatico_id = (select id from pg_temp._c where k = 'S87-A1')), 'montaje:1100:-,desmontaje:1200:872');
select test.eq('el odómetro del vehículo sube con el desmontaje', (select odometro_km from public.vehiculos where id = 871), 1200);
select test.eq('el vehículo queda sin neumáticos', (select count(*) from public.neumaticos where vehiculo_id = 871), 0::bigint);
-- ...y vuelve a ser montable (ciclo completo)
select test.become('authenticated', test.u_cli_a());
select test.eq('la cubierta devuelta se puede montar de nuevo', (public.neumatico_montar(871::bigint, 7::smallint, (select id from pg_temp._c where k = 'S87-A1'))->>'posicion'), '7');
reset role;
select test.eq('...y no cobra el costo de compra otra vez', (select count(*) from public.eventos_neumatico where neumatico_id = (select id from pg_temp._c where k = 'S87-A1') and tipo = 'montaje' and costo is not null), 1::bigint);
rollback to s0;

-- A stock sin quema: exige quema (propia o indicada) y única
select test.become('authenticated', test.u_cli_a());
select public.neumatico_montar(871::bigint, 1::smallint, null, '{"marca":"SinQ"}');
select public.neumatico_montar(871::bigint, 2::smallint, null, '{"marca":"Q2","numero_quema":"NQ-DUP"}');
select test.denied('sin quema: no vuelve al stock', $$select public.neumatico_desmontar(871::bigint, 1::smallint, 'almacenado')$$, '22023');
select test.denied('quema indicada ya registrada', $$select public.neumatico_desmontar(871::bigint, 1::smallint, 'almacenado', null, null, null, 'nq-dup')$$, '23505');
select test.denied('quema indicada demasiado larga', format('select public.neumatico_desmontar(871::bigint, 1::smallint, ''almacenado'', null, null, null, ''%s'')', repeat('q', 41)), '22023');
select test.eq('con quema indicada vuelve al stock sin sucursal', (public.neumatico_desmontar(871::bigint, 1::smallint, 'almacenado', null, null, null, ' NQ-NUEVA ')->>'numero_quema'), 'NQ-NUEVA');
reset role;
select test.eq('queda en stock con la quema indicada', (select estado || '|' || (sucursal_id is null) || '|' || (vehiculo_id is null) from public.neumaticos where numero_quema = 'NQ-NUEVA'), 'almacenado|true|true');
rollback to s0;

-- Reparación y baja: aparcado en el vehículo; auxilio
select test.become('authenticated', test.u_cli_a());
select public.neumatico_montar(871::bigint, 1::smallint, null, '{"marca":"RepX"}');
select public.neumatico_montar(871::bigint, 2::smallint, null, '{"marca":"BajaX"}');
select public.neumatico_montar(871::bigint, 99::smallint, null, '{"marca":"AuxX"}');
select test.eq('reparación: aparcado en 98', (public.neumatico_desmontar(871::bigint, 1::smallint, 'reparacion', 'pinchazo')->>'posicion_aparcado'), '98');
select test.eq('baja con motivo: aparcado en 97', (public.neumatico_desmontar(871::bigint, 2::smallint, 'baja', 'montaje equivocado', 1300)->>'posicion_aparcado'), '97');
select test.eq('auxilio a baja', (public.neumatico_desmontar(871::bigint, 99::smallint, 'baja', 'dañado')->>'destino'), 'baja');
reset role;
select test.eq('reparación: estado y condición',
  (select estado || '|' || condicion || '|' || posicion || '|' || auxilio from public.neumaticos where marca = 'RepX'), 'reparacion|reparado|98|false');
select test.eq('baja: estado, motivo y fecha',
  (select estado || '|' || motivo_baja || '|' || (fecha_baja = current_date) from public.neumaticos where marca = 'BajaX'), 'baja|montaje equivocado|true');
select test.eq('el auxilio dado de baja ya no es auxilio', (select auxilio from public.neumaticos where marca = 'AuxX'), false);
select test.eq('eventos: desmontaje, baja y baja',
  (select string_agg(tipo || ':' || coalesce(posicion_origen::text, '-') || ':' || coalesce(odometro_km::text, '-'), ',' order by id)
     from public.eventos_neumatico where tipo in ('desmontaje', 'baja') and vehiculo_id = 871), 'desmontaje:1:-,baja:2:1300,baja:99:-');
select test.eq('no quedan neumáticos montados', (select count(*) from public.neumaticos where vehiculo_id = 871 and estado = 'montado'), 0::bigint);
-- Las posiciones esperadas quedaron libres: se vuelve a montar
select test.become('authenticated', test.u_cli_a());
select test.eq('la posición 1 vuelve a quedar libre', (public.neumatico_montar(871::bigint, 1::smallint, null, '{"marca":"N"}')->>'posicion'), '1');
select test.denied('un neumático dado de baja ya no está montado en su posición aparcada', $$select public.neumatico_desmontar(871::bigint, 97::smallint, 'baja', 'x')$$, 'P0002');
reset role;
rollback to s0;

-- Desmontar: perfil de sucursal propia, otro cliente y admin
select test.become('authenticated', test.u_admin());
select public.neumatico_montar(871::bigint, 1::smallint, null, '{"marca":"X","numero_quema":"NQ-S1"}');
select public.neumatico_montar(871::bigint, 2::smallint, null, '{"marca":"X"}');
select public.neumatico_montar(871::bigint, 3::smallint, null, '{"marca":"X"}');
reset role;
select test.become('authenticated', test.u_s87());
select test.denied('sucursal propia no devuelve al stock', $$select public.neumatico_desmontar(871::bigint, 1::smallint, 'almacenado')$$);
select test.eq('sucursal propia retira a reparación', (public.neumatico_desmontar(871::bigint, 2::smallint, 'reparacion')->>'destino'), 'reparacion');
select test.eq('sucursal propia da de baja con motivo', (public.neumatico_desmontar(871::bigint, 3::smallint, 'baja', 'desgaste')->>'destino'), 'baja');
reset role;
select test.eq('el neumático con quema sigue montado tras el rechazo', (select estado from public.neumaticos where numero_quema = 'NQ-S1'), 'montado');
select test.become('authenticated', test.u_cli_b());
select test.denied('otro cliente no desmonta', $$select public.neumatico_desmontar(871::bigint, 1::smallint, 'baja', 'x')$$);
reset role;
select test.become('authenticated', test.u_admin());
select test.eq('admin desmonta a stock de cualquier cliente', (public.neumatico_desmontar(871::bigint, 1::smallint, 'almacenado', null, null, 872::bigint)->>'en_stock'), 'true');
reset role;
rollback to s0;

-- ---------------------------------------------------------------------------------------------
-- G. Segundo montaje en la misma posición: error claro y nada duplicado
-- (la serialización real entre sesiones se prueba en tests/e2e)
-- ---------------------------------------------------------------------------------------------
select test.become('authenticated', test.u_cli_a());
select public.neumatico_montar(871::bigint, 1::smallint, null, '{"marca":"Primero"}');
select test.denied('el segundo montaje en la misma posición falla con error claro', $$select public.neumatico_montar(871::bigint, 1::smallint, null, '{"marca":"Segundo"}')$$, '55000');
reset role;
select test.eq('queda el primero', (select marca from public.neumaticos where vehiculo_id = 871 and posicion = 1), 'Primero');
select test.eq('un solo evento de montaje', (select count(*) from public.eventos_neumatico where vehiculo_id = 871 and tipo = 'montaje'), 1::bigint);
rollback to s0;

-- ---------------------------------------------------------------------------------------------
-- H. API de proveedor: un coche con neumáticos montados con idneumatico deja de dar sin_neumaticos
-- ---------------------------------------------------------------------------------------------
select test.eq('coche vacío: sin_neumaticos',
  public.api_guardar_montaje(1, test.u_api(), 'TT8710',
    '[{"posicion":1,"mm1":9,"mm2":9,"mm3":9},{"posicion":2,"mm1":9,"mm2":9,"mm3":9}]'::jsonb, gen_random_uuid(), 'k87-a', 'h87a')->'resultados'->0->>'motivo', 'sin_neumaticos');
select test.become('authenticated', test.u_cli_a());
select public.neumatico_montar(871::bigint, 1::smallint, null, '{"marca":"Api"}');
select public.neumatico_montar(871::bigint, 2::smallint, (select id from pg_temp._c where k = 'S87-A1'));
reset role;
select count(*) as med0 from public.mediciones \gset
create temp table _api (r jsonb);
grant all on _api to public;
insert into _api select public.api_guardar_montaje(1, test.u_api(), 'TT8710',
  '[{"posicion":1,"mm1":9,"mm2":9,"mm3":9},{"posicion":2,"mm1":8,"mm2":8,"mm3":8},{"posicion":3,"mm1":7,"mm2":7,"mm3":7}]'::jsonb,
  gen_random_uuid(), 'k87-b', 'h87b');
select test.eq('con neumáticos montados: P1 y P2 se guardan, P3 (sin neumático) -> posicion',
  (select string_agg((e->>'posicion') || ':' || (e->>'guardado') || ':' || coalesce(e->>'motivo', '-'), ',' order by (e->>'posicion')::int)
     from _api, jsonb_array_elements(r->'resultados') e), '1:true:-,2:true:-,3:false:posicion');
select test.eq('se insertaron 2 mediciones, por neumático', (select count(*) from public.mediciones), :med0::bigint + 2);
select test.eq('la medición de P2 quedó en la cubierta del stock (misma quema)',
  (select count(*) from public.mediciones where idneumatico = 'CB-87-a'), 1::bigint);
rollback to s0;

rollback;
