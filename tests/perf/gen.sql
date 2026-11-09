-- Uso (no forma parte de la CI): psql "$PERF_PG_URL" -v ncli=1 -v veh=300 -f tests/perf/gen.sql   (3.000 neumáticos / 180.000 mediciones)
--   o -v ncli=10 -v veh=300 (30.000 / 1,8 M); después PERF_PG_URL=... tests/perf/bench.sh etiqueta
-- Datos sintéticos: :ncli clientes x :veh vehículos x 10 neumáticos x 60 mediciones en 210 días.
-- 5% de los vehículos son "históricos" (mediciones sin idneumatico -> regla 2), 2% sin filas en neumaticos (regla 3),
-- 3% de los neumáticos con evento de reparación (con costo) a mitad de ventana y unos 7 eventos de km por neumático (montajes,
-- desmontajes y rotaciones) para medir v_km_cubierta; marca, modelo, precio, montajes con costo y costos manuales
-- (con 5% en otra moneda) para medir v_costo_cubierta y cpk_por_grupo.
insert into auth.users (id, email)
  select ('a0000000-0000-0000-0000-' || lpad(g::text, 12, '0'))::uuid, 'u' || g || '@t' from generate_series(1, :ncli + 1) g;
insert into public.clientes (id, nombre, auth_user_id)
  select g, 'Cli ' || g, ('a0000000-0000-0000-0000-' || lpad((g + 1)::text, 12, '0'))::uuid from generate_series(1, :ncli) g;
insert into public.perfiles (user_id, rol) values ('a0000000-0000-0000-0000-000000000001', 'admin');
insert into public.perfiles (user_id, rol, cliente_id)
  select ('a0000000-0000-0000-0000-' || lpad((g + 1)::text, 12, '0'))::uuid, 'cliente', g from generate_series(1, :ncli) g on conflict do nothing;

insert into public.vehiculos (cliente_id, nombre, patente, activo)
  select c, 'V' || c || '-' || v, 'P' || lpad((c * 10000 + v)::text, 7, '0'), true
  from generate_series(1, :ncli) c, generate_series(1, :veh) v;

create temp table _cls as
  select v.id as vid, v.cliente_id as cid,
         case when v.id % 50 = 0 then 'hist' when v.id % 50 = 1 then 'sinneu' else 'normal' end as cls
  from public.vehiculos v;

-- Seis marcas y tres modelos; precio de compra en el 90% (el resto sin precio_unidad: la compra sale del evento de montaje).
insert into public.neumaticos (vehiculo_id, cliente_id, posicion, idneumatico, estado, marca, modelo, precio_unidad, fecha_compra)
  select vid, cid, p, 'N-' || vid || '-' || p, 'montado', 'Marca' || ((vid + p) % 6), 'Modelo' || ((vid * 3 + p) % 3),
         case when (vid + p) % 10 = 0 then null else 800 + ((vid + p) % 7) * 100 end,
         current_date - (((vid * 7 + p * 11) % 700)::int)
  from _cls, generate_series(1, 10) p where cls <> 'sinneu';

insert into public.mediciones (vehiculo_id, cliente_id, posicion, idneumatico, mm1, mm2, mm3, promedio, created_at)
  select c.vid, c.cid, p,
         case when c.cls = 'normal' then 'N-' || c.vid || '-' || p end,
         x.mm + (random() - 0.5) * 0.3, x.mm + (random() - 0.5) * 0.3, x.mm + (random() - 0.5) * 0.3, 0,
         now() - (k * 3.5) * interval '24 hours' - (random() * 4) * interval '1 hour'
  from _cls c, generate_series(1, 10) p, generate_series(0, 59) k,
  lateral (select greatest(16 - (0.1 + ((c.vid * 7 + p * 13) % 40) / 100.0) / 7.0 * (210 - k * 3.5), 1.0) as mm) x;

insert into public.eventos_neumatico (cliente_id, vehiculo_id, neumatico_id, idneumatico, tipo, created_at)
  select n.cliente_id, n.vehiculo_id, n.id, n.idneumatico, 'reparacion', now() - interval '40 days'
  from public.neumaticos n where n.id % 33 = 0;
update public.eventos_neumatico set costo = 150 where tipo = 'reparacion';

-- Historial de km (v_km_cubierta): odómetro de cada vehículo; montaje de cada neumático hace 300 días; 20% con un tramo
-- anterior cerrado en otro vehículo (montaje + desmontaje); 5 rotaciones por neumático (unos 7 eventos por neumático).
update public.vehiculos set odometro_km = 200000 + (id % 500) * 100;
insert into public.eventos_neumatico (cliente_id, vehiculo_id, neumatico_id, idneumatico, tipo, odometro_km, created_at)
  select n.cliente_id, o.id, n.id, n.idneumatico, x.tipo, x.odo, now() - x.dias * interval '1 day'
  from public.neumaticos n
  join lateral (select v.id from public.vehiculos v where v.cliente_id = n.cliente_id and v.id <> n.vehiculo_id order by v.id limit 1) o on true
  cross join (values ('montaje', 10000, 500), ('desmontaje', 60000, 320)) x(tipo, odo, dias)
  where n.id % 5 = 0;
-- El evento de montaje repite el precio de compra (como neumatico_cambiar / neumatico_montar): no debe contarse dos veces.
insert into public.eventos_neumatico (cliente_id, vehiculo_id, neumatico_id, idneumatico, tipo, odometro_km, costo, created_at)
  select n.cliente_id, n.vehiculo_id, n.id, n.idneumatico, 'montaje', 100000 + (n.id % 1000),
         coalesce(n.precio_unidad, case when n.id % 2 = 0 then 900 end), now() - interval '300 days'
  from public.neumaticos n;
insert into public.eventos_neumatico (cliente_id, vehiculo_id, neumatico_id, idneumatico, tipo, posicion_origen, posicion_destino, odometro_km, created_at)
  select n.cliente_id, n.vehiculo_id, n.id, n.idneumatico, 'rotacion', n.posicion, n.posicion, 100000 + (n.id % 1000) + k * 15000,
         now() - (300 - k * 50) * interval '1 day'
  from public.neumaticos n, generate_series(1, 5) k;
-- Costos manuales (F4): 30% de las cubiertas con un recauchutado, 5% con un gasto en USD (moneda mixta), 10% con una
-- compra que corrige el precio.
insert into public.costos_neumatico (cliente_id, neumatico_id, concepto, monto, moneda, fecha)
  select n.cliente_id, n.id, 'recauchutado', 400, 'UYU', current_date - 30 from public.neumaticos n where n.id % 10 < 3;
insert into public.costos_neumatico (cliente_id, neumatico_id, concepto, monto, moneda, fecha)
  select n.cliente_id, n.id, 'otro', 20, 'USD', current_date - 10 from public.neumaticos n where n.id % 20 = 1;
insert into public.costos_neumatico (cliente_id, neumatico_id, concepto, monto, moneda, fecha)
  select n.cliente_id, n.id, 'compra', 950, 'UYU', current_date - 300 from public.neumaticos n where n.id % 10 = 5;
analyze;
