-- =============================================================================
-- NEUMET · Datos de ejemplo para el cliente DEMO ('Demo Transportes')
-- =============================================================================
-- NO es una migración: no está en supabase/migrations y no se aplica solo.
-- Se ejecuta A MANO (SQL editor de Supabase o psql) DESPUÉS de aplicar todas las
-- migraciones (requiere 20261107020000_seccionales.sql) y de crear el cliente
-- 'Demo Transportes' desde el panel admin (Clientes > Nuevo cliente), que crea su
-- usuario global. Si el cliente no existe, el script falla con un mensaje claro.
--
-- QUÉ CREA (todo ficticio, solo para el cliente Demo; no toca ningún otro cliente):
--   * 2 seccionales: Montevideo y Salto.
--   * 14 vehículos 'Camión 1xx/2xx' con patentes DEMO001..DEMO014 (9 en Montevideo,
--     5 en Salto). Camiones con 6 o 10 neumáticos montados (tipo_ruedas=10, el
--     CHECK de la tabla solo admite 10 o 16) y, en algunos, neumático de auxilio (pos. 99).
--   * 6 dispositivos con MAC ficticias 02:DE:00:00:00:0N: 4 activos, 1 sin actividad
--     (~2 semanas) y 1 caído (>30 días).
--   * ~10 semanas de mediciones semanales por neumático con odómetro creciente:
--     desgaste lineal con ruido y tasas distintas; mezcla ok / bajo / crítico,
--     alertas "cruzará crítico pronto", desgaste irregular, un neumático sin ninguna
--     medición y neumáticos sin medir hace más de 30 días.
--   * Stock de ejemplo y algunos eventos (rotación, reparación, montaje).
-- Las fechas son relativas a now(): volver a ejecutar el script REFRESCA el demo
-- (borra y regenera las mediciones/eventos/stock del cliente Demo con fechas
-- actuales; vehículos, neumáticos, dispositivos y seccionales se actualizan sin duplicar).
-- Es seguro ejecutarlo varias veces. Como las mediciones no son editables desde el
-- panel, hay que correrlo con un rol que no esté sujeto a RLS (SQL editor / postgres).
-- =============================================================================

begin;

do $demo$
declare
  c_nombre constant text := 'Demo Transportes';
  v_cli     bigint;
  v_mvd     bigint;
  v_slt     bigint;
  r         record;
  t         record;
  v_veh     bigint;
  v_suc     bigint;
  v_odo     integer;
  v_wk_km   integer;
  v_dev     text;
  v_ses     uuid;
  k         integer;
  ts        timestamptz;
  cur       numeric;
  rate      numeric;
  a         numeric;
  o         numeric[];
  v_irreg   boolean;
  v_nomed   boolean;
  h         integer;
  v_marcas  text[] := array['Michelin','Bridgestone','Pirelli','Goodyear','Continental'];
  v_modelos text[] := array['X Multi Z','R249 Ecopia','FH88 Fleet','G661 Regional','HSR2 Eco'];
  m         integer;
begin
  select id into v_cli from public.clientes where nombre = c_nombre and deleted_at is null order by id limit 1;
  if v_cli is null then
    raise exception 'No existe el cliente "%": créalo primero desde el panel admin (Clientes > Nuevo cliente) y vuelve a ejecutar este script.', c_nombre
      using errcode = 'P0002';
  end if;

  perform setseed(0.42);  -- ruido reproducible

  -- ---- Seccionales ----------------------------------------------------------
  insert into public.sucursales (cliente_id, nombre) values (v_cli, 'Montevideo'), (v_cli, 'Salto')
    on conflict (cliente_id, (lower(btrim(nombre)))) do nothing;
  select id into v_mvd from public.sucursales where cliente_id = v_cli and lower(btrim(nombre)) = 'montevideo';
  select id into v_slt from public.sucursales where cliente_id = v_cli and lower(btrim(nombre)) = 'salto';

  -- ---- Dispositivos (MAC ficticias de administración local) --------------------
  for r in select * from (values
      (1, 'Sensor Demo 1 (MVD)', 'mvd'), (2, 'Sensor Demo 2 (MVD)', 'mvd'), (3, 'Sensor Demo 3 (MVD)', 'mvd'),
      (4, 'Sensor Demo 4 (MVD)', 'mvd'), (5, 'Sensor Demo 5 (Salto)', 'slt'), (6, 'Sensor Demo 6 (Salto)', 'slt')
    ) d(n, nombre, suc)
  loop
    v_dev := format('02:DE:00:00:00:%s', lpad(r.n::text, 2, '0'));
    if exists (select 1 from public.dispositivos where mac_address = v_dev and cliente_id <> v_cli) then
      raise exception 'La MAC ficticia % ya pertenece a otro cliente', v_dev using errcode = '23505';
    end if;
    insert into public.dispositivos (mac_address, nombre, cliente_id, activo, sucursal_id)
    values (v_dev, r.nombre, v_cli, true, case r.suc when 'mvd' then v_mvd else v_slt end)
    on conflict (mac_address) do update
      set nombre = excluded.nombre, activo = true, sucursal_id = excluded.sucursal_id;
  end loop;

  -- ---- Limpieza de lo regenerable ---------------------------------------------
  delete from public.mediciones where cliente_id = v_cli and (idneumatico like 'DEMO-%');
  delete from public.eventos_neumatico where cliente_id = v_cli;
  delete from public.stock_neumaticos where cliente_id = v_cli and notas = 'Datos de ejemplo (demo)';

  -- ---- Escenarios por neumático (veh, pos, mm actual, mm/semana, irregular, nunca medido) -----
  create temp table _demo_esc (veh int, pos int, cur numeric, rate numeric, irregular boolean, nomed boolean) on commit drop;
  insert into _demo_esc values
    -- críticos
    (1, 3, 4.2, 0.8, false, false), (4, 7, 3.8, 0.9, false, false), (6, 2, 4.6, 0.7, false, false), (10, 5, 4.0, 0.8, false, false),
    -- bajos
    (2, 1, 7.2, 0.5, false, false), (2, 4, 6.5, 0.6, false, false), (3, 2, 7.8, 0.4, false, false), (5, 4, 6.1, 0.5, false, false),
    (8, 3, 7.0, 0.5, false, false), (11, 1, 6.8, 0.5, false, false), (12, 6, 7.4, 0.4, false, false),
    -- ok pero cruzarán el nivel crítico pronto (alerta preventiva)
    (9, 2, 8.6, 0.9, false, false), (10, 8, 8.9, 1.0, false, false), (6, 9, 9.0, 1.1, false, false),
    -- desgaste irregular (diferencia entre huellas > 2 mm)
    (1, 6, 11.0, 0.4, true, false), (7, 4, 9.5, 0.5, true, false), (12, 2, 10.5, 0.4, true, false),
    -- montado y nunca medido
    (9, 5, null, null, false, true);

  -- ---- Vehículos, neumáticos y mediciones --------------------------------------
  for r in select * from (values
      -- n, nombre, patente, nº neumáticos, auxilio, seccional, dispositivo, días desde la última medición
      (1,  'Camión 101', 'DEMO001', 10, true,  'mvd', 1, 1),
      (2,  'Camión 102', 'DEMO002', 10, false, 'mvd', 1, 2),
      (3,  'Camión 103', 'DEMO003',  6, false, 'mvd', 2, 0),
      (4,  'Camión 104', 'DEMO004', 10, true,  'mvd', 2, 3),
      (5,  'Camión 105', 'DEMO005',  6, false, 'mvd', 3, 1),
      (6,  'Camión 106', 'DEMO006', 10, false, 'mvd', 3, 4),
      (7,  'Camión 107', 'DEMO007', 10, false, 'mvd', 4, 15),   -- dispositivo 4: sin actividad
      (8,  'Camión 108', 'DEMO008',  6, false, 'mvd', 4, 17),
      (9,  'Camión 109', 'DEMO009', 10, true,  'mvd', 1, 2),
      (10, 'Camión 201', 'DEMO010', 10, false, 'slt', 5, 1),
      (11, 'Camión 202', 'DEMO011',  6, false, 'slt', 5, 2),
      (12, 'Camión 203', 'DEMO012', 10, true,  'slt', 5, 0),
      (13, 'Camión 204', 'DEMO013', 10, false, 'slt', 6, 45),   -- dispositivo 6: caído (>30 días)
      (14, 'Camión 205', 'DEMO014',  6, false, 'slt', 6, 48)
    ) x(n, nombre, patente, n_neum, aux, suc, dev, ultima_dias)
  loop
    v_suc := case r.suc when 'mvd' then v_mvd else v_slt end;
    v_dev := format('02:DE:00:00:00:%s', lpad(r.dev::text, 2, '0'));
    v_odo := 90000 + (r.n * 27000) % 330000;           -- odómetro actual ficticio
    v_wk_km := 900 + (r.n * 137) % 700;                -- km por semana

    select id into v_veh from public.vehiculos where cliente_id = v_cli and patente_norm = r.patente;
    if v_veh is null then
      insert into public.vehiculos (cliente_id, nombre, patente, numero, tipo_ruedas, activo, sucursal_id,
                                    fecha_compra, notas)
      values (v_cli, r.nombre, r.patente, (100 + r.n)::text, 10, true, v_suc,
              (current_date - (400 + r.n * 20)), 'Datos de ejemplo (demo)')
      returning id into v_veh;
    else
      update public.vehiculos set nombre = r.nombre, tipo_ruedas = 10, activo = true, sucursal_id = v_suc where id = v_veh;
    end if;
    update public.vehiculos
       set odometro_km = v_odo, odometro_actualizado_at = now() - (r.ultima_dias * interval '1 day'),
           ultimo_servicio = current_date - 30 - r.n
     where id = v_veh;

    -- Neumáticos montados: posiciones 1..n_neum y, si corresponde, auxilio en 99
    for m in 1 .. r.n_neum + case when r.aux then 1 else 0 end loop
      declare
        v_pos int := case when m > r.n_neum then 99 else m end;
        v_aux boolean := (v_pos = 99);
        v_id text := format('DEMO-%s-%s', lpad(r.n::text, 2, '0'), lpad(v_pos::text, 2, '0'));
      begin
        h := abs(hashtext(v_id));
        insert into public.neumaticos (vehiculo_id, cliente_id, posicion, marca, modelo, idneumatico, codigo,
                                       auxilio, fecha_compra, precio_unidad, vida, estado, notas)
        values (v_veh, v_cli, v_pos, v_marcas[1 + h % 5], v_modelos[1 + (h / 7) % 5], v_id, 'COD-' || (h % 9000 + 1000),
                v_aux, current_date - (300 + h % 200), 380 + (h % 14) * 10, (h % 7) / 6, 'montado',
                'Datos de ejemplo (demo)')
        on conflict (vehiculo_id, posicion) do update
          set marca = excluded.marca, modelo = excluded.modelo, idneumatico = excluded.idneumatico,
              auxilio = excluded.auxilio, estado = 'montado', vida = excluded.vida, precio_unidad = excluded.precio_unidad;
      end;
    end loop;

    -- Mediciones semanales (10 sesiones), una por neumático
    for k in 0 .. 9 loop
      v_ses := gen_random_uuid();
      ts := now() - (r.ultima_dias * interval '1 day') - (k * interval '7 days') - ((random() * 8) * interval '1 hour');
      for t in select n.posicion, n.idneumatico, n.auxilio from public.neumaticos n where n.vehiculo_id = v_veh order by n.posicion loop
        v_irreg := false; v_nomed := false; cur := null; rate := null;
        select e.cur, e.rate, e.irregular, e.nomed into cur, rate, v_irreg, v_nomed
          from _demo_esc e where e.veh = r.n and e.pos = t.posicion;
        v_irreg := coalesce(v_irreg, false); v_nomed := coalesce(v_nomed, false);
        continue when v_nomed;
        if t.auxilio then
          a := 13.0;                                              -- el auxilio no se desgasta
        else
          h := abs(hashtext(t.idneumatico));
          cur  := coalesce(cur,  9.5 + (h % 1000) / 1000.0 * 6.5);    -- ok: 9.5 .. 16 mm
          rate := coalesce(rate, 0.2 + ((h / 1000) % 1000) / 1000.0 * 0.4);  -- 0.2 .. 0.6 mm/semana
          a := cur + rate * k + (random() - 0.5) * 0.3;              -- lineal + ruido
        end if;
        o := case when v_irreg then array[1.5, 0.0, -1.5]
                  else array[(random() - 0.5) * 0.5, (random() - 0.5) * 0.5, (random() - 0.5) * 0.5] end;
        insert into public.mediciones (vehiculo_id, cliente_id, device_id, posicion, mm1, mm2, mm3, promedio,
                                       idneumatico, sesion_id, odometro_km, created_at)
        values (v_veh, v_cli, v_dev, t.posicion,
                greatest(round(a + o[1], 2), 0.5), greatest(round(a + o[2], 2), 0.5), greatest(round(a + o[3], 2), 0.5),
                0,  -- el trigger recalcula el promedio
                t.idneumatico, v_ses, greatest(v_odo - k * v_wk_km, 0), ts);
      end loop;
    end loop;
    -- Odómetro del vehículo = el de su última sesión
    update public.vehiculos set odometro_km = v_odo where id = v_veh;

    -- Eventos de ejemplo: rotación 1<->2 hace 3 semanas, reparación en una posición, montaje del auxilio
    insert into public.eventos_neumatico (cliente_id, vehiculo_id, neumatico_id, idneumatico, tipo,
                                          posicion_origen, posicion_destino, odometro_km, notas, created_at)
    select v_cli, v_veh, n.id, n.idneumatico, 'rotacion', 1, 2, greatest(v_odo - 3 * v_wk_km, 0), 'Rotación de rutina (demo)',
           now() - interval '21 days'
      from public.neumaticos n where n.vehiculo_id = v_veh and n.posicion = 1;
    insert into public.eventos_neumatico (cliente_id, vehiculo_id, neumatico_id, idneumatico, tipo,
                                          odometro_km, costo, notas, created_at)
    select v_cli, v_veh, n.id, n.idneumatico, 'reparacion', greatest(v_odo - 6 * v_wk_km, 0), 35 + r.n,
           'Reparación de pinchazo (demo)', now() - interval '42 days'
      from public.neumaticos n where n.vehiculo_id = v_veh and n.posicion = 3;
    if r.aux then
      insert into public.eventos_neumatico (cliente_id, vehiculo_id, neumatico_id, idneumatico, tipo, odometro_km, costo, notas, created_at)
      select v_cli, v_veh, n.id, n.idneumatico, 'montaje', greatest(v_odo - 9 * v_wk_km, 0), n.precio_unidad,
             'Montaje de auxilio (demo)', now() - interval '63 days'
        from public.neumaticos n where n.vehiculo_id = v_veh and n.posicion = 99;
    end if;
  end loop;

  -- ---- Stock de ejemplo ----------------------------------------------------------
  insert into public.stock_neumaticos (cliente_id, marca, modelo, cantidad, precio_unidad, fecha_compra, notas) values
    (v_cli, 'Michelin',    'X Multi Z',   8, 455.00, current_date - 60, 'Datos de ejemplo (demo)'),
    (v_cli, 'Bridgestone', 'R249 Ecopia', 4, 420.00, current_date - 35, 'Datos de ejemplo (demo)'),
    (v_cli, 'Pirelli',     'FH88 Fleet',  2, 390.00, current_date - 10, 'Datos de ejemplo (demo)');

  raise notice 'Demo listo para el cliente % (id %): seccionales Montevideo=% Salto=%', c_nombre, v_cli, v_mvd, v_slt;
end
$demo$;

commit;

-- Comprobaciones sugeridas (solo lectura), sustituir <id> por el id del cliente Demo:
--   select s.nombre, count(*) from public.vehiculos v join public.sucursales s on s.id = v.sucursal_id
--    where v.cliente_id = <id> group by 1;                                   -- Montevideo 9, Salto 5
--   select estado, count(*) from public.v_estado_neumaticos where cliente_id = <id> group by 1;
--   select tipo, count(*) from public.v_alertas where cliente_id = <id> group by 1 order by 2 desc;
--   select estado, count(*) from public.v_salud_dispositivos where cliente_id = <id> group by 1;
