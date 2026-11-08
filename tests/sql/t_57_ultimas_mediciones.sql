-- ultimas_mediciones(): últimos vehículos medidos, visita = mismo día (Montevideo), comparativa con la medición
-- anterior del MISMO neumático (idneumatico), orden, límite, filtro de seccional, RLS y permisos.
-- Todo en una transacción que se revierte. Los instantes se fijan a mediodía de Montevideo para que la agrupación
-- por día no dependa de la hora a la que corra el test.
begin;

select (date_trunc('day', now() at time zone 'America/Montevideo') at time zone 'America/Montevideo') + interval '12 hours' as hoy \gset

insert into auth.users (id, email) values ('a0000000-0000-0000-0000-0000000000f9', 'um@t');
insert into public.sucursales (id, cliente_id, nombre) overriding system value values (321, 1, 'UM seccional');
insert into public.perfiles (user_id, rol, cliente_id, sucursal_id) values ('a0000000-0000-0000-0000-0000000000f9', 'cliente', 1, 321);
create or replace function test.u_um() returns uuid language sql immutable as $$ select 'a0000000-0000-0000-0000-0000000000f9'::uuid $$;
grant execute on function test.u_um() to public;

insert into public.vehiculos (id, cliente_id, nombre, patente, numero, activo, sucursal_id) values
  (21, 1, 'UM visita',   'UM2100', '210', true,  321),
  (22, 1, 'UM reciente', 'UM2200', '220', true,  null),
  (23, 1, 'UM inactivo', 'UM2300', '230', false, null),
  (24, 2, 'UM ajeno',    'UM2400', '240', true,  null),
  (25, 1, 'UM antiguo',  'UM2500', '250', true,  null);
insert into public.neumaticos (vehiculo_id, cliente_id, posicion, idneumatico, estado) values
  (21, 1, 1, 'UM-21-1', 'montado'), (21, 1, 2, 'UM-21-2', 'montado'), (21, 1, 3, null, 'montado'),
  (22, 1, 1, 'UM-22-1', 'montado'),
  (23, 1, 1, 'UM-23-1', 'montado'),
  (24, 2, 1, 'UM-24-1', 'montado'),
  (25, 1, 1, 'UM-25-1', 'montado');

-- V21: visita de hace 3 días (dos mediciones de P1 ese día: manda la última); P1 con dos visitas previas
-- (manda la más reciente anterior a la visita); P2 es un neumático nuevo; P3 no tiene idneumatico.
insert into public.mediciones (vehiculo_id, cliente_id, posicion, idneumatico, mm1, mm2, mm3, created_at) values
  (21, 1, 1, 'UM-21-1', 12,   12,   12,   :'hoy'::timestamptz - interval '20 days'),
  (21, 1, 1, 'UM-21-1',  9,    9,    9,   :'hoy'::timestamptz - interval '10 days'),
  (21, 1, 1, 'UM-21-1',  7.6,  7.6,  7.6, :'hoy'::timestamptz - interval '3 days' - interval '3 hours'),
  (21, 1, 1, 'UM-21-1',  7.4,  7.4,  7.4, :'hoy'::timestamptz - interval '3 days'),
  (21, 1, 2, 'UM-21-2', 14,   14,   14,   :'hoy'::timestamptz - interval '3 days'),
  (21, 1, 3, null,       8,    8,    8,   :'hoy'::timestamptz - interval '3 days'),
  (21, 1, 3, null,       9,    9,    9,   :'hoy'::timestamptz - interval '10 days'),
-- V22: medido ayer; la medición previa del neumático es de OTRO vehículo (rotación entre camiones): cuenta
  (22, 1, 1, 'UM-22-1', 10,   10,   10,   :'hoy'::timestamptz - interval '1 day'),
  (21, 1, 4, 'UM-22-1', 11,   11,   11,   :'hoy'::timestamptz - interval '15 days'),
-- V23 (inactivo) y V24 (otro cliente) medidos hoy
  (23, 1, 1, 'UM-23-1',  8,    8,    8,   :'hoy'::timestamptz),
  (24, 2, 1, 'UM-24-1',  8,    8,    8,   :'hoy'::timestamptz),
-- V25: visita antigua
  (25, 1, 1, 'UM-25-1',  6,    6,    6,   :'hoy'::timestamptz - interval '40 days'),
  (25, 1, 1, 'UM-25-1',  7,    7,    7,   :'hoy'::timestamptz - interval '50 days');

-- Admin: ve todos los clientes; el inactivo no aparece
select test.become('authenticated', test.u_admin());
select test.eq('admin: el vehículo inactivo no figura',
  (select count(*) from public.ultimas_mediciones(50) where vehiculo_id = 23), 0::bigint);
select test.eq('admin: figura el vehículo de otro cliente',
  (select count(*) from public.ultimas_mediciones(50) where vehiculo_id = 24), 1::bigint);
reset role;

select test.become('authenticated', test.u_cli_a());
select test.eq('cliente A: un vehículo de otro cliente no figura',
  (select count(*) from public.ultimas_mediciones(50) where vehiculo_id = 24), 0::bigint);
select test.eq('cliente A: orden por última medición descendente',
  (select array_agg(vehiculo_id order by ord) from (select vehiculo_id, min(ordinality) ord
     from public.ultimas_mediciones(50) with ordinality where vehiculo_id >= 21 group by vehiculo_id) q),
  array[22, 21, 25]::bigint[]);
select test.eq('cliente A: el límite acota la cantidad de vehículos',
  (select count(distinct vehiculo_id) from public.ultimas_mediciones(2)), 2::bigint);
select test.eq('cliente A: límite 0 se trata como 1',
  (select count(distinct vehiculo_id) from public.ultimas_mediciones(0)), 1::bigint);
select test.eq('una fila por posición de la última visita (V21: 3)',
  (select count(*) from public.ultimas_mediciones(50) where vehiculo_id = 21), 3::bigint);
select test.eq('V21 P1: mm de la última medición del día y anterior = la visita previa más reciente',
  (select mm_ahora || '/' || mm_antes from public.ultimas_mediciones(50) where vehiculo_id = 21 and posicion = 1), '7.40/9.00');
select test.eq('V21 P1: fecha de la medición anterior',
  (select antes_at from public.ultimas_mediciones(50) where vehiculo_id = 21 and posicion = 1), :'hoy'::timestamptz - interval '10 days');
select test.eq('V21 P2: neumático nuevo sin comparativa',
  (select mm_ahora::text || '/' || coalesce(mm_antes::text, 'null') from public.ultimas_mediciones(50) where vehiculo_id = 21 and posicion = 2), '14.00/null');
select test.eq('V21 P3: sin idneumatico no hereda la medición de la posición',
  (select mm_antes is null from public.ultimas_mediciones(50) where vehiculo_id = 21 and posicion = 3), true);
select test.eq('V22 P1: la medición previa del neumático puede ser de otro vehículo',
  (select mm_antes from public.ultimas_mediciones(50) where vehiculo_id = 22), 11.00);
select test.eq('V25: una visita antigua sigue figurando con su medición previa',
  (select mm_ahora || '/' || mm_antes from public.ultimas_mediciones(50) where vehiculo_id = 25), '6.00/7.00');
select test.eq('filtro de seccional: solo el vehículo de la seccional',
  (select array_agg(distinct vehiculo_id) from public.ultimas_mediciones(50, 321)), array[21]::bigint[]);
reset role;

select test.become('authenticated', test.u_um());
select test.eq('perfil de seccional: solo ve su vehículo',
  (select array_agg(distinct vehiculo_id) from public.ultimas_mediciones(50)), array[21]::bigint[]);
reset role;

select test.become('authenticated', test.u_cli_b());
select test.eq('cliente B: solo lo suyo',
  (select array_agg(distinct vehiculo_id order by vehiculo_id) filter (where vehiculo_id >= 21) from public.ultimas_mediciones(50)), array[24]::bigint[]);
reset role;

select test.become('authenticated', test.u_sinperfil());
select test.eq('sin perfil: nada', (select count(*) from public.ultimas_mediciones(50)), 0::bigint);
reset role;

select test.become('anon', null);
select test.denied('anon no ejecuta la función', 'select * from public.ultimas_mediciones(8)');
reset role;

select test.eq('la función es security invoker',
  (select prosecdef from pg_proc where proname = 'ultimas_mediciones'), false);

rollback;
