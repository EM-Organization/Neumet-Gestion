-- Datos previos al seed demo: rol de PostgREST, usuarios de prueba, cliente 'Demo Transportes' y un segundo cliente ajeno.
-- (En producción el cliente y su usuario global los crea el panel admin; el trigger clientes_sync_perfil crea el perfil.)
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'authenticator') then
    create role authenticator noinherit login password 'authenticator-de-prueba';
  end if;
end $$;
grant anon, authenticated, service_role to authenticator;

insert into auth.users (id, email) values
  ('e2e00000-0000-0000-0000-000000000001', 'admin@e2e.test'),
  ('e2e00000-0000-0000-0000-000000000002', 'demo-global@e2e.test'),
  ('e2e00000-0000-0000-0000-000000000003', 'demo-salto@e2e.test'),
  ('e2e00000-0000-0000-0000-000000000004', 'demo-montevideo@e2e.test'),
  ('e2e00000-0000-0000-0000-000000000005', 'otra@e2e.test'),
  ('e2e00000-0000-0000-0000-000000000006', 'sin-perfil@e2e.test'), -- autenticado, sin fila en perfiles
  ('e2e00000-0000-0000-0000-000000000007', 'api@e2e.test');

insert into public.perfiles (user_id, rol) values ('e2e00000-0000-0000-0000-000000000001', 'admin');
insert into public.clientes (nombre, auth_user_id) values ('Demo Transportes', 'e2e00000-0000-0000-0000-000000000002');
-- Cuenta de integración (rol 'api'): ligada al cliente Demo; no debe entrar al panel.
insert into public.perfiles (user_id, rol, cliente_id)
  select 'e2e00000-0000-0000-0000-000000000007', 'api', id from public.clientes where nombre = 'Demo Transportes';

-- Cliente ajeno: ninguna sesión de Demo debe verlo.
insert into public.clientes (nombre, auth_user_id) values ('Otra Empresa SA', 'e2e00000-0000-0000-0000-000000000005');
insert into public.vehiculos (cliente_id, nombre, patente, numero, tipo_ruedas, activo)
  select id, 'Camión Ajeno', 'OTRA001', '900', 10, true from public.clientes where nombre = 'Otra Empresa SA';
insert into public.neumaticos (vehiculo_id, cliente_id, posicion, idneumatico, estado, marca)
  select v.id, v.cliente_id, p, 'OTRA-' || p, 'montado', 'Ajena'
    from public.vehiculos v, generate_series(1, 4) p where v.patente = 'OTRA001';

-- Casos límite de búsqueda (no existen en el demo): matrícula guardada en minúsculas y con espacios, nombre con Ñ y tilde,
-- vehículo sin matrícula, vehículo sin número de coche y matrícula con guion (SAB-1234, se busca también como SAB1234).
insert into public.vehiculos (cliente_id, nombre, patente, numero, tipo_ruedas, activo)
  select id, v.nombre, v.patente, v.numero, 10, true
    from public.clientes c,
         (values ('Tractor Ñandú', 'ab 123 cd', null), ('Sin matrícula', null, '7'), ('Camión con guion', 'SAB-1234', '301')) v(nombre, patente, numero)
   where c.nombre = 'Otra Empresa SA';

-- Stock de cubiertas del cliente ajeno (sin sucursales: Otra Empresa SA no tiene ninguna al empezar). La quema 'S-001' se repite
-- a propósito con la del demo (la unicidad es por cliente) y 'OTRA-Q1' no existe en ningún otro cliente.
insert into public.neumaticos (vehiculo_id, cliente_id, posicion, idneumatico, estado, condicion, marca, modelo, numero_quema)
  select null, c.id, null, 'CB-OTRA-1', 'almacenado', 'nuevo', 'MarcaAjena', 'Modelo Z', 'S-001'
    from public.clientes c where c.nombre = 'Otra Empresa SA';
insert into public.neumaticos (vehiculo_id, cliente_id, posicion, idneumatico, estado, condicion, marca, numero_quema)
  select null, c.id, null, 'CB-OTRA-2', 'almacenado', 'usado', 'MarcaAjena', 'OTRA-Q1'
    from public.clientes c where c.nombre = 'Otra Empresa SA';
