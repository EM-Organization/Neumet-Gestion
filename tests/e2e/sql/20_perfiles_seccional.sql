-- Perfiles de sucursal (después del seed, que crea las sucursales Montevideo y Salto del cliente Demo).
insert into public.perfiles (user_id, rol, cliente_id, sucursal_id, email)
select 'e2e00000-0000-0000-0000-000000000003', 'cliente', s.cliente_id, s.id, 'demo-salto@e2e.test'
  from public.sucursales s join public.clientes c on c.id = s.cliente_id
 where c.nombre = 'Demo Transportes' and lower(s.nombre) = 'salto';
insert into public.perfiles (user_id, rol, cliente_id, sucursal_id, email)
select 'e2e00000-0000-0000-0000-000000000004', 'cliente', s.cliente_id, s.id, 'demo-montevideo@e2e.test'
  from public.sucursales s join public.clientes c on c.id = s.cliente_id
 where c.nombre = 'Demo Transportes' and lower(s.nombre) = 'montevideo';
