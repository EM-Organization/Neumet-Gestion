-- Tasa de desgaste robusta (20261111000000_tasa_y_rendimiento.sql) y equivalencia con la vista anterior.
-- Casos: 2 mediciones a 24 h; 2 a 2 h que cruzan la medianoche UTC; mismo día; justo bajo y sobre 14 días;
-- 3 mediciones y 14 días; reinicio por reencauche / reparación / montaje (la rotación no reinicia); pendiente negativa;
-- ventana de 90 días; aislamiento (cliente). Al final, equivalencia con la definición anterior de
-- v_estado_neumaticos en un conjunto grande (neumáticos etiquetados, históricos sin idneumatico, posiciones sin fila
-- en neumaticos, eventos) y comparación de la tasa con un cálculo independiente.
-- Los intervalos van en horas (no 'días'). Todo ocurre en una transacción que se revierte.
begin;

insert into public.vehiculos (id, cliente_id, nombre, patente, activo) values
  (581, 1, 'T58 casos', 'TT5810', true);
-- Un neumático por caso (posiciones 1..13).
insert into public.neumaticos (vehiculo_id, cliente_id, posicion, idneumatico, estado, marca)
  select 581, 1, p, 'N-58-' || p, 'montado', 'T' from generate_series(1, 13) p;

create function pg_temp.med(p_pos int, p_horas numeric, p_mm numeric) returns void language sql as $$
  insert into public.mediciones (vehiculo_id, cliente_id, posicion, idneumatico, mm1, mm2, mm3, created_at)
  values (581, 1, p_pos, 'N-58-' || p_pos, p_mm, p_mm, p_mm, now() - p_horas * interval '1 hour')
$$;
create function pg_temp.ev(p_pos int, p_tipo text, p_horas numeric) returns void language sql as $$
  insert into public.eventos_neumatico (cliente_id, vehiculo_id, neumatico_id, idneumatico, tipo, created_at)
  select 1, 581, n.id, n.idneumatico, p_tipo, now() - p_horas * interval '1 hour'
    from public.neumaticos n where n.vehiculo_id = 581 and n.posicion = p_pos
$$;
create function pg_temp.tasa(p_pos int) returns text language sql as $$
  select coalesce(tasa_mm_semana::text, 'null') from public.v_estado_neumaticos
   where vehiculo_id = 581 and posicion = p_pos
$$;
-- Horas desde un instante hasta ahora (para fijar mediciones respecto de la medianoche UTC).
create function pg_temp.horas_desde(p_ts timestamptz) returns numeric language sql as $$
  select (extract(epoch from now() - p_ts) / 3600)::numeric
$$;

-- P1: dos mediciones a 24 h (12,0 y 11,7) => sin tasa (antes 2,100 mm/semana)
select pg_temp.med(1, 24, 12.0), pg_temp.med(1, 0, 11.7);
-- P2: dos mediciones a 2 h que cruzan la medianoche UTC de ayer (antes 16,8 mm/semana)
select pg_temp.med(2, pg_temp.horas_desde(date_trunc('day', now() at time zone 'UTC') at time zone 'UTC' - interval '25 hours'), 12.0),
       pg_temp.med(2, pg_temp.horas_desde(date_trunc('day', now() at time zone 'UTC') at time zone 'UTC' - interval '23 hours'), 11.8);
-- P3: tres mediciones el mismo día
select pg_temp.med(3, 3, 12.0), pg_temp.med(3, 2, 11.9), pg_temp.med(3, 1, 11.8);
-- P4: 3 mediciones y exactamente 14 días: 1 mm/semana
select pg_temp.med(4, 336, 12), pg_temp.med(4, 168, 11), pg_temp.med(4, 0, 10);
-- P5: tres mediciones, 13 días 23 h entre la primera y la última => sin tasa
select pg_temp.med(5, 335, 12), pg_temp.med(5, 168, 11), pg_temp.med(5, 0, 10);
-- P6: reencauche a mitad de ventana. Antes 0,75 mm/semana durante 8 semanas, salto a 14 mm y después 0,5 mm/semana.
select pg_temp.med(6, 24 * 7 * k, 14 - 0.75 * (k - 2)) from generate_series(3, 10) k;
select pg_temp.med(6, 24 * 7 * 2, 14), pg_temp.med(6, 24 * 7, 13.5), pg_temp.med(6, 0, 13.0);
select pg_temp.ev(6, 'reencauche', 24 * 7 * 2 + 1);
-- P7: igual que P6 pero con solo 2 mediciones después del reencauche => sin tasa
select pg_temp.med(7, 24 * 7 * k, 14 - 0.75 * (k - 2)) from generate_series(3, 10) k;
select pg_temp.med(7, 24 * 7, 14), pg_temp.med(7, 0, 13.5);
select pg_temp.ev(7, 'reencauche', 24 * 7 + 1);
-- P8: reparación con salto positivo (sin reinicio daría tasa negativa)
select pg_temp.med(8, 24 * 7 * 5, 8), pg_temp.med(8, 24 * 7 * 4, 7), pg_temp.med(8, 24 * 7 * 3, 6);
select pg_temp.med(8, 24 * 7 * 2, 12), pg_temp.med(8, 24 * 7, 11.5), pg_temp.med(8, 0, 11);
select pg_temp.ev(8, 'reparacion', 24 * 7 * 2 + 1);
-- P9: montaje a mitad de ventana (mediciones previas de otro régimen)
select pg_temp.med(9, 24 * 7 * 5, 10), pg_temp.med(9, 24 * 7 * 4, 6);
select pg_temp.med(9, 24 * 7 * 2, 12), pg_temp.med(9, 24 * 7, 11), pg_temp.med(9, 0, 10);
select pg_temp.ev(9, 'montaje', 24 * 7 * 3);
-- P10: una rotación a mitad de ventana NO reinicia: la serie completa da 1 mm/semana
select pg_temp.med(10, 24 * 7 * 3, 12), pg_temp.med(10, 24 * 7 * 2, 11), pg_temp.med(10, 24 * 7, 10), pg_temp.med(10, 0, 9);
select pg_temp.ev(10, 'rotacion', 24 * 7 * 2 - 5);
-- P11: pendiente negativa (el neumático «gana» mm sin evento) => sin tasa
select pg_temp.med(11, 24 * 7 * 3, 8), pg_temp.med(11, 24 * 7 * 2, 9), pg_temp.med(11, 24 * 7, 10), pg_temp.med(11, 0, 11);
-- P12: ventana de 90 días: la medición de hace 120 días no cuenta; las 3 siguientes (28 días) dan 0,5 mm/semana
select pg_temp.med(12, 24 * 120, 20), pg_temp.med(12, 24 * 28, 12), pg_temp.med(12, 24 * 14, 11), pg_temp.med(12, 0, 10);
-- P13: montaje posterior a todas las mediciones: sin tasa hasta que haya 3 mediciones nuevas
select pg_temp.med(13, 24 * 7 * 3, 12), pg_temp.med(13, 24 * 7 * 2, 11), pg_temp.med(13, 24 * 7, 10);
select pg_temp.ev(13, 'montaje', 1);

select test.become('authenticated', test.u_admin());
select test.eq('P1 dos mediciones a 24 h => sin tasa', pg_temp.tasa(1), 'null');
select test.eq('P1 sin alerta cruza_critico_pronto',
  (select count(*) from public.v_alertas where vehiculo_id = 581 and posicion = 1 and tipo = 'cruza_critico_pronto'), 0::bigint);
select test.eq('P1 sin semanas hasta crítico ni retiro',
  (select semanas_hasta_critico is null and semanas_hasta_retiro is null from public.v_estado_neumaticos where vehiculo_id = 581 and posicion = 1), true);
select test.eq('P1 conserva promedio y n_mediciones_90d',
  (select promedio || '|' || n_mediciones_90d from public.v_estado_neumaticos where vehiculo_id = 581 and posicion = 1), '11.70|2');
select test.eq('P2 dos mediciones a 2 h cruzando medianoche UTC => sin tasa', pg_temp.tasa(2), 'null');
select test.eq('P2 son dos fechas UTC distintas',
  (select count(distinct (created_at at time zone 'UTC')::date) from public.mediciones where vehiculo_id = 581 and posicion = 2), 2::bigint);
select test.eq('P2 sin alerta cruza_critico_pronto',
  (select count(*) from public.v_alertas where vehiculo_id = 581 and posicion = 2 and tipo = 'cruza_critico_pronto'), 0::bigint);
select test.eq('P3 tres mediciones el mismo día => sin tasa', pg_temp.tasa(3), 'null');
select test.eq('P4 3 mediciones y 14 días exactos => 1.000 mm/semana', pg_temp.tasa(4), '1.000');
select test.eq('P4 semanas hasta crítico (10-5)/1',
  (select semanas_hasta_critico from public.v_estado_neumaticos where vehiculo_id = 581 and posicion = 4), 5.00);
select test.eq('P5 13 días 23 h => sin tasa', pg_temp.tasa(5), 'null');
select test.eq('P6 reencauche a mitad de ventana reinicia: tasa 0.500', pg_temp.tasa(6), '0.500');
select test.eq('P6 n_mediciones_90d cuenta toda la ventana de 90 días',
  (select n_mediciones_90d from public.v_estado_neumaticos where vehiculo_id = 581 and posicion = 6), 11::bigint);
select test.eq('P7 reencauche con 2 mediciones posteriores => sin tasa', pg_temp.tasa(7), 'null');
select test.eq('P8 reparación: el salto positivo no da tasa negativa; tasa posterior 0.500', pg_temp.tasa(8), '0.500');
select test.eq('P9 montaje a mitad de ventana reinicia: tasa 1.000', pg_temp.tasa(9), '1.000');
select test.eq('P10 una rotación no reinicia: tasa 1.000', pg_temp.tasa(10), '1.000');
select test.eq('P11 pendiente negativa => sin tasa (no negativa)', pg_temp.tasa(11), 'null');
select test.eq('P12 la medición de hace 120 días queda fuera: 0.500', pg_temp.tasa(12), '0.500');
select test.eq('P13 montaje posterior a todas las mediciones => sin tasa', pg_temp.tasa(13), 'null');
select test.eq('ninguna tasa negativa en la vista',
  (select count(*) from public.v_estado_neumaticos where tasa_mm_semana < 0), 0::bigint);
select test.eq('cruza_critico_pronto nunca sin tasa',
  (select count(*) from public.v_alertas a join public.v_estado_neumaticos e using (vehiculo_id, posicion)
    where a.vehiculo_id = 581 and a.tipo = 'cruza_critico_pronto' and e.tasa_mm_semana is null), 0::bigint);
reset role;

-- El cliente (RLS) ve las mismas tasas que el administrador
select test.become('authenticated', test.u_cli_a());
select test.eq('cliente A ve las tasas de P1 (sin tasa), P4 y P6',
  (select string_agg(coalesce(tasa_mm_semana::text, 'null'), ',' order by posicion) from public.v_estado_neumaticos
    where vehiculo_id = 581 and posicion in (1, 4, 6)), 'null,1.000,0.500');
reset role;

-- -----------------------------------------------------------------------------
-- Equivalencia con la vista anterior en un conjunto grande
-- -----------------------------------------------------------------------------
-- Vehículos 6000..6199 (cliente 1), 6 neumáticos x 30 mediciones cada uno, por clase (g % 5):
--   0 y 4: mediciones etiquetadas (en la clase 4 el neumático de la posición 6 no tiene idneumatico: sus mediciones
--          etiquetadas quedan huérfanas, como antes);  1: históricas sin idneumatico (regla 2);
--   2: sin filas en neumaticos (regla 3);  3: históricas con un montaje en la posición 3 que corta la historia.
-- Uno de cada 17 vehículos tiene un salto positivo reciente; reencauche/reparación/montaje en 1 de cada 7 neumáticos.
insert into public.vehiculos (id, cliente_id, nombre, patente, activo)
  select 6000 + g, 1, 'T58 grande ' || g, 'TG' || lpad(g::text, 4, '0'), true from generate_series(0, 199) g;
insert into public.neumaticos (vehiculo_id, cliente_id, posicion, idneumatico, estado, marca)
  select 6000 + g, 1, p, case when g % 5 = 4 and p = 6 then null else 'N-G-' || g || '-' || p end, 'montado', 'G'
    from generate_series(0, 199) g, generate_series(1, 6) p where g % 5 <> 2;
insert into public.mediciones (vehiculo_id, cliente_id, posicion, idneumatico, mm1, mm2, mm3, created_at)
  select 6000 + g, 1, p,
         case when g % 5 in (0, 4) then 'N-G-' || g || '-' || p end,
         x.mm + ((g * 7 + p * 3 + k) % 5) * 0.05, x.mm - ((g + k) % 3) * 0.05, x.mm,
         now() - (k * 76 + (g * 11 + p) % 60) * interval '1 hour'
    from generate_series(0, 199) g, generate_series(1, 6) p, generate_series(0, 29) k,
    lateral (select greatest(16 - (0.1 + ((g * 7 + p * 13) % 40) / 100.0) / 168.0 * (29 - k) * 76, 1.0)
                    + case when g % 17 = 0 and k < 6 then 3 else 0 end as mm) x;
insert into public.eventos_neumatico (cliente_id, vehiculo_id, tipo, posicion_destino, created_at)
  select 1, 6000 + g, 'montaje', 3, now() - interval '240 hours' from generate_series(0, 199) g where g % 5 = 3;
insert into public.eventos_neumatico (cliente_id, vehiculo_id, neumatico_id, idneumatico, tipo, created_at)
  select 1, n.vehiculo_id, n.id, n.idneumatico, (array['reencauche', 'reparacion', 'montaje'])[1 + n.id % 3], now() - interval '720 hours'
    from public.neumaticos n where n.vehiculo_id >= 6000 and n.idneumatico is not null and n.id % 7 = 0;
analyze public.mediciones;
analyze public.neumaticos;

-- La definición anterior de v_estado_neumaticos (copiada de 20261109000000_mediciones_por_neumatico.sql).
create view pg_temp.v_estado_old
with (security_invoker = true) as
with h as materialized (
  select * from public.v_mediciones_neumatico where estado_montaje = 'montado'
),
-- Una sola pasada por neumático: última medición + tasa de los últimos 90 días (ventana por
-- neumático; las posiciones sin fila en neumaticos, por posición). Sin joins entre agregados.
u as materialized (
  select distinct on (x.vehiculo_id, x.posicion)
    x.vehiculo_id, x.posicion, x.idneumatico,
    x.mm1, x.mm2, x.mm3, x.promedio, x.odometro_km, x.created_at,
    x.n_mediciones_90d, x.n_fechas, x.slope_mm_s
  from (
    select h.vehiculo_id, h.posicion_actual as posicion, h.idneumatico, h.medicion_id,
      h.mm1, h.mm2, h.mm3, h.promedio, h.odometro_km, h.created_at,
      count(*) filter (where h.created_at >= now() - interval '90 days')
        over w as n_mediciones_90d,
      (max((h.created_at at time zone 'UTC')::date) filter (where h.created_at >= now() - interval '90 days') over w
        - min((h.created_at at time zone 'UTC')::date) filter (where h.created_at >= now() - interval '90 days') over w) as n_fechas,
      regr_slope(h.promedio::float8, extract(epoch from h.created_at))
        filter (where h.created_at >= now() - interval '90 days') over w as slope_mm_s
    from h
    window w as (partition by h.vehiculo_id, h.posicion_actual)
  ) x
  order by x.vehiculo_id, x.posicion, x.created_at desc, x.medicion_id desc
),
slots as materialized (
  select n.vehiculo_id, n.posicion, n.id as neumatico_id, n.idneumatico as neum_idneumatico,
         n.marca, n.modelo, n.vida, n.estado as estado_montaje
  from public.neumaticos n
  union all
  select u.vehiculo_id, u.posicion, null::bigint, null::text, null::text, null::text, null::smallint, null::text
  from u
  where not exists (select 1 from public.neumaticos n
                    where n.vehiculo_id = u.vehiculo_id and n.posicion = u.posicion)
),
b as (
  select
    v.cliente_id, s.vehiculo_id, v.nombre as vehiculo_nombre, v.patente, s.posicion,
    s.neumatico_id,
    coalesce(u.idneumatico, s.neum_idneumatico) as idneumatico,
    s.marca, s.modelo, s.vida,
    coalesce(s.estado_montaje, 'montado') as estado_montaje,
    u.mm1, u.mm2, u.mm3, u.promedio, u.odometro_km,
    u.created_at as ultima_medicion_at,
    case when u.created_at is null then null
         else floor(extract(epoch from now() - u.created_at) / 86400)::integer end as dias_desde_medicion,
    case when u.promedio is null               then 'sin_datos'
         when u.promedio < c.umbral_critico_mm then 'critico'
         when u.promedio < c.umbral_bajo_mm    then 'bajo'
         else 'ok' end as estado,
    case when u.created_at is null then s.neumatico_id is not null
         else u.created_at < now() - make_interval(days => c.dias_sin_medir_alerta) end as sin_medir,
    case when u.promedio is null then null
         else greatest(u.mm1, u.mm2, u.mm3) - least(u.mm1, u.mm2, u.mm3) end as diferencia_huellas_mm,
    coalesce(greatest(u.mm1, u.mm2, u.mm3) - least(u.mm1, u.mm2, u.mm3) > c.irregularidad_mm, false)
      as desgaste_irregular,
    coalesce(u.n_mediciones_90d, 0) as n_mediciones_90d,
    case when u.n_fechas >= 1 and u.slope_mm_s is not null
         then round((-u.slope_mm_s * 604800)::numeric, 3) end as tasa_mm_semana,
    c.umbral_bajo_mm, c.umbral_critico_mm, c.umbral_retiro_mm, c.dias_sin_medir_alerta
  from slots s
  join public.vehiculos v on v.id = s.vehiculo_id and v.activo
  join public.clientes  c on c.id = v.cliente_id and c.deleted_at is null
  left join u on u.vehiculo_id = s.vehiculo_id and u.posicion = s.posicion
  where coalesce(s.estado_montaje, 'montado') = 'montado'
)
select b.*,
  case when b.tasa_mm_semana > 0 and b.promedio is not null
       then round(greatest(b.promedio - b.umbral_critico_mm, 0) / b.tasa_mm_semana, 2) end as semanas_hasta_critico,
  case when b.tasa_mm_semana > 0 and b.promedio is not null
       then round(greatest(b.promedio - b.umbral_retiro_mm, 0) / b.tasa_mm_semana, 2) end  as semanas_hasta_retiro
from b;

select test.eq('el conjunto grande tiene más de 1000 filas de estado',
  (select count(*) > 1000 from public.v_estado_neumaticos where vehiculo_id >= 6000), true);
select test.eq('mismas filas (vehículo, posición) en la vista nueva y la anterior',
  (select count(*) from (
     (select vehiculo_id, posicion from public.v_estado_neumaticos except select vehiculo_id, posicion from pg_temp.v_estado_old)
     union all
     (select vehiculo_id, posicion from pg_temp.v_estado_old except select vehiculo_id, posicion from public.v_estado_neumaticos)) d), 0::bigint);
select test.eq('todas las columnas salvo la tasa y sus derivadas son idénticas a las de la vista anterior',
  (select count(*) from public.v_estado_neumaticos n join pg_temp.v_estado_old o using (vehiculo_id, posicion)
    where (n.cliente_id, n.vehiculo_nombre, n.patente, n.neumatico_id, n.idneumatico, n.marca, n.modelo, n.vida, n.estado_montaje,
           n.mm1, n.mm2, n.mm3, n.promedio, n.odometro_km, n.ultima_medicion_at, n.dias_desde_medicion, n.estado, n.sin_medir,
           n.diferencia_huellas_mm, n.desgaste_irregular, n.n_mediciones_90d,
           n.umbral_bajo_mm, n.umbral_critico_mm, n.umbral_retiro_mm, n.dias_sin_medir_alerta)
      is distinct from
          (o.cliente_id, o.vehiculo_nombre, o.patente, o.neumatico_id, o.idneumatico, o.marca, o.modelo, o.vida, o.estado_montaje,
           o.mm1, o.mm2, o.mm3, o.promedio, o.odometro_km, o.ultima_medicion_at, o.dias_desde_medicion, o.estado, o.sin_medir,
           o.diferencia_huellas_mm, o.desgaste_irregular, o.n_mediciones_90d,
           o.umbral_bajo_mm, o.umbral_critico_mm, o.umbral_retiro_mm, o.dias_sin_medir_alerta)), 0::bigint);

-- Oráculo independiente de la tasa: v_mediciones_neumatico (sin cambios) + eventos de reinicio.
create temp table _oraculo as
  with h as (
    select m.vehiculo_id, m.posicion_actual as posicion, m.created_at, m.promedio,
           coalesce((select max(e.created_at) from public.eventos_neumatico e
                      where e.neumatico_id = m.neumatico_id and e.tipo in ('reencauche', 'reparacion', 'montaje')), '-infinity') as reinicio
      from public.v_mediciones_neumatico m
     where m.estado_montaje = 'montado' and m.created_at >= now() - interval '90 days')
  select vehiculo_id, posicion,
         count(*) filter (where created_at >= reinicio) as n,
         extract(epoch from max(created_at) filter (where created_at >= reinicio)
                          - min(created_at) filter (where created_at >= reinicio)) as span,
         regr_slope(promedio::float8, extract(epoch from created_at)) filter (where created_at >= reinicio) as slope
    from h group by vehiculo_id, posicion;
select test.eq('la tasa coincide con un cálculo independiente (≥3 mediciones, ≥14 días, ventana reiniciada, pendiente < 0)',
  (select count(*) from public.v_estado_neumaticos e
     left join _oraculo o using (vehiculo_id, posicion)
    where e.tasa_mm_semana is distinct from
          (case when o.n >= 3 and o.span >= 14 * 86400 and o.slope < 0 then round((-o.slope * 604800)::numeric, 3) end)), 0::bigint);
select test.eq('hay tasas con valor y tasas nulas en el conjunto grande',
  (select count(*) filter (where tasa_mm_semana > 0) > 500 and count(*) filter (where tasa_mm_semana is null) > 100
     from public.v_estado_neumaticos where vehiculo_id >= 6000), true);
select test.eq('sin reinicio y con ventana suficiente, la tasa positiva coincide con la anterior',
  (select count(*) from public.v_estado_neumaticos n
     join pg_temp.v_estado_old o using (vehiculo_id, posicion)
     join _oraculo r using (vehiculo_id, posicion)
    where r.n >= 3 and r.span >= 14 * 86400 and o.tasa_mm_semana > 0
      and not exists (select 1 from public.eventos_neumatico e
                       where e.neumatico_id = n.neumatico_id and e.tipo in ('reencauche', 'reparacion', 'montaje'))
      and n.tasa_mm_semana is distinct from o.tasa_mm_semana), 0::bigint);
select test.eq('hay filas comparadas en la equivalencia de tasa',
  (select count(*) > 500 from public.v_estado_neumaticos n
     join pg_temp.v_estado_old o using (vehiculo_id, posicion)
     join _oraculo r using (vehiculo_id, posicion)
    where r.n >= 3 and r.span >= 14 * 86400 and o.tasa_mm_semana > 0 and n.tasa_mm_semana = o.tasa_mm_semana), true);

-- Las vistas derivadas siguen leyendo la nueva tasa y conservan su forma
select test.eq('v_alertas coincide con las alertas esperadas por fila (cruza_critico_pronto solo con tasa positiva)',
  (select count(*) from public.v_alertas a join public.v_estado_neumaticos e using (vehiculo_id, posicion)
    where a.tipo = 'cruza_critico_pronto' and not (e.tasa_mm_semana > 0 and e.semanas_hasta_critico <= 4)), 0::bigint);
select test.eq('v_estado_neumaticos conserva security_invoker',
  (select reloptions::text from pg_class where oid = 'public.v_estado_neumaticos'::regclass), '{security_invoker=true}');
select test.denied('anon no lee v_estado_neumaticos', 'set local role anon; select * from public.v_estado_neumaticos');

rollback;
