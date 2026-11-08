-- =============================================================================
-- NEUMET · Tasa de desgaste robusta y v_estado_neumaticos por neumático (sondas al índice)
-- =============================================================================
-- Requiere 20261109000000_mediciones_por_neumatico.sql (v_mediciones_neumatico, índices
-- mediciones_idneumatico_idx y eventos_neumatico_veh_fecha_idx) y eventos_neumatico.
-- Sin begin/commit: la herramienta que aplica la migración ya la envuelve.
-- Idempotente (create or replace view + create index if not exists + revoke/grant). Sin cambios de datos.
--
-- 1. Tasa mm/semana (tasa_mm_semana y, por derivación, semanas_hasta_critico / semanas_hasta_retiro):
--    * Se calcula con TIEMPO TRANSCURRIDO, no con fechas distintas: dos mediciones a 2 horas que cruzan la
--      medianoche UTC ya no dan una tasa absurda (antes 0,2 mm en 2 h se extrapolaba a 16,8 mm/semana).
--    * Exige al menos 3 mediciones y al menos 14 días entre la primera y la última de la ventana. Si no se
--      cumple, la tasa es NULL («mediciones insuficientes») y no se dispara cruza_critico_pronto.
--    * La ventana (90 días) se reinicia en el último evento del neumático de tipo reencauche, reparacion o
--      montaje (eventos_neumatico.neumatico_id): no se mezclan mediciones de antes y después del salto.
--    * Una pendiente negativa (el neumático «gana» mm) no es una tasa: queda NULL.
--    n_mediciones_90d conserva su significado (mediciones de los últimos 90 días, sin reinicio).
--
-- 2. Rendimiento: la vista ya no materializa todas las mediciones de la flota. Para cada neumático montado
--    hay una sonda al índice mediciones_idneumatico_idx (última medición) y otra por el rango de 90 días
--    (agregados de la regresión). El costo depende de las mediciones de 90 días de los neumáticos que se
--    piden, y un filtro externo (vehiculo_id, cliente_id, LIMIT) se aplica en el origen.
--
-- Mediciones históricas sin idneumatico (reglas 2 y 3 de 20261109000000): NO se hace backfill; se conservan
-- con exactamente las mismas reglas, pero como fallback por índice solo donde hace falta:
--    * Neumático montado sin ninguna medición etiquetada (o sin idneumatico): sonda a
--      mediciones_veh_pos_fecha_idx (vehículo, posición) de las mediciones sin idneumatico posteriores al
--      último evento que movió esa posición. Para los neumáticos con mediciones etiquetadas esta sonda no se ejecuta.
--    * Posición medida sin fila en neumaticos: se enumeran las posiciones del vehículo saltando por el mismo
--      índice (una sonda por posición distinta) y se aplica la regla 3.
--
-- Las columnas, sus tipos, security_invoker y los grants son los mismos que antes; v_alertas y
-- v_resumen_flota_cliente no cambian (leen esta vista).
-- =============================================================================

-- Posiciones con mediciones en un vehículo que no tienen fila en neumaticos (regla 3), enumeradas saltando por el
-- índice vehículo/posición (una sonda por posición distinta). Es una función (y no una CTE recursiva dentro de la
-- vista) para declarar ROWS 1: el planificador estima ~100 filas por vehículo en una CTE recursiva y la vista salía con
-- un costo estimado de cientos de miles incluso con 14 vehículos, lo que dispara el JIT de PostgreSQL (jit_above_cost =
-- 100000) y añade cientos de ms de compilación a cada consulta donde el JIT está disponible (imagen postgres:16 de CI).
-- SECURITY INVOKER: la RLS de mediciones y neumaticos decide qué ve cada rol.
create or replace function public.posiciones_medidas_sin_neumatico(p_vehiculo_id bigint)
returns setof smallint
language sql
stable
security invoker
set search_path = ''
rows 1
as $$
  with recursive q(posicion) as (
    (select m.posicion from public.mediciones m where m.vehiculo_id = p_vehiculo_id order by m.posicion limit 1)
    union all
    select (select m.posicion from public.mediciones m
             where m.vehiculo_id = p_vehiculo_id and m.posicion > q.posicion order by m.posicion limit 1)
      from q where q.posicion is not null
  )
  select q.posicion from q
   where q.posicion is not null
     and not exists (select 1 from public.neumaticos np
                      where np.vehiculo_id = p_vehiculo_id and np.posicion = q.posicion)
$$;

revoke all on function public.posiciones_medidas_sin_neumatico(bigint) from public, anon;
grant execute on function public.posiciones_medidas_sin_neumatico(bigint) to authenticated;

create or replace view public.v_estado_neumaticos
with (security_invoker = true) as
with s as (
  -- ---- Neumáticos montados (reglas 1 y 2) ----------------------------------------------------------------------
  select
    v.cliente_id, n.vehiculo_id, v.nombre as vehiculo_nombre, v.patente, n.posicion,
    n.id as neumatico_id,
    coalesce(t.idneumatico, p.idneumatico, n.idneumatico) as idneumatico,
    n.marca, n.modelo, n.vida,
    n.estado as estado_montaje,
    coalesce(t.mm1, p.mm1) as mm1, coalesce(t.mm2, p.mm2) as mm2, coalesce(t.mm3, p.mm3) as mm3,
    coalesce(t.promedio, p.promedio) as promedio, coalesce(t.odometro_km, p.odometro_km) as odometro_km,
    coalesce(t.created_at, p.created_at) as ultima_at,
    case when t.id is not null then t.n90   else p.n90   end as n90,
    case when t.id is not null then t.n_v   else p.n_v   end as n_v,
    case when t.id is not null then t.t0    else p.t0    end as t0,
    case when t.id is not null then t.t1    else p.t1    end as t1,
    case when t.id is not null then t.slope else p.slope end as slope,
    c.umbral_bajo_mm, c.umbral_critico_mm, c.umbral_retiro_mm, c.dias_sin_medir_alerta, c.irregularidad_mm
  from public.neumaticos n
  join public.vehiculos v on v.id = n.vehiculo_id and v.activo
  join public.clientes  c on c.id = v.cliente_id and c.deleted_at is null
  -- Último evento que reinicia la ventana de la tasa (reencauche, reparación o montaje de ESTE neumático).
  left join lateral (
    select max(e.created_at) as reinicio
      from public.eventos_neumatico e
     where e.neumatico_id = n.id and e.tipo in ('reencauche', 'reparacion', 'montaje')
  ) r on true
  -- Regla 1: mediciones etiquetadas con el idneumatico del neumático (esté donde esté).
  left join lateral (
    select l.*, a.*
      from (select m.id, m.idneumatico, m.mm1, m.mm2, m.mm3, m.promedio, m.odometro_km, m.created_at
              from public.mediciones m
             where n.idneumatico is not null and m.idneumatico = n.idneumatico
             order by m.created_at desc, m.id desc limit 1) l
     cross join lateral (
       select count(*) as n90,
              count(*) filter (where m.created_at >= coalesce(r.reinicio, '-infinity')) as n_v,
              min(m.created_at) filter (where m.created_at >= coalesce(r.reinicio, '-infinity')) as t0,
              max(m.created_at) filter (where m.created_at >= coalesce(r.reinicio, '-infinity')) as t1,
              regr_slope(m.promedio::float8, extract(epoch from m.created_at))
                filter (where m.created_at >= coalesce(r.reinicio, '-infinity')) as slope
         from public.mediciones m
        where m.idneumatico = n.idneumatico and m.created_at >= now() - interval '90 days'
     ) a
  ) t on true
  -- Regla 2 (solo si el neumático no tiene mediciones etiquetadas): corte = último evento de
  -- montaje/desmontaje/rotación/baja que tocó la posición (origen o destino).
  left join lateral (
    select max(e.created_at) as cut
      from public.eventos_neumatico e
     where t.id is null and e.vehiculo_id = n.vehiculo_id
       and e.tipo in ('montaje', 'desmontaje', 'rotacion', 'baja')
       and (e.posicion_origen = n.posicion or e.posicion_destino = n.posicion)
  ) z on true
  left join lateral (
    select l.*, a.*
      from (select m.id, m.idneumatico, m.mm1, m.mm2, m.mm3, m.promedio, m.odometro_km, m.created_at
              from public.mediciones m
             where t.id is null and m.vehiculo_id = n.vehiculo_id and m.posicion = n.posicion
               and m.idneumatico is null and (z.cut is null or m.created_at >= z.cut)
             order by m.created_at desc, m.id desc limit 1) l
     cross join lateral (
       select count(*) as n90,
              count(*) filter (where m.created_at >= coalesce(r.reinicio, '-infinity')) as n_v,
              min(m.created_at) filter (where m.created_at >= coalesce(r.reinicio, '-infinity')) as t0,
              max(m.created_at) filter (where m.created_at >= coalesce(r.reinicio, '-infinity')) as t1,
              regr_slope(m.promedio::float8, extract(epoch from m.created_at))
                filter (where m.created_at >= coalesce(r.reinicio, '-infinity')) as slope
         from public.mediciones m
        where m.vehiculo_id = n.vehiculo_id and m.posicion = n.posicion and m.idneumatico is null
          and (z.cut is null or m.created_at >= z.cut) and m.created_at >= now() - interval '90 days'
     ) a
  ) p on true
  where n.estado = 'montado'
  union all
  -- ---- Regla 3: posiciones medidas sin fila en neumaticos -------------------------------------------------------
  select
    v.cliente_id, v.id, v.nombre, v.patente, q.posicion,
    null::bigint, l.idneumatico,
    null::text, null::text, null::smallint,
    'montado'::text,
    l.mm1, l.mm2, l.mm3, l.promedio, l.odometro_km, l.created_at,
    a.n90, a.n_v, a.t0, a.t1, a.slope,
    c.umbral_bajo_mm, c.umbral_critico_mm, c.umbral_retiro_mm, c.dias_sin_medir_alerta, c.irregularidad_mm
  from public.vehiculos v
  join public.clientes c on c.id = v.cliente_id and c.deleted_at is null
  -- Posiciones medidas del vehículo sin fila en neumaticos (función con ROWS bajo: ver arriba).
  cross join lateral public.posiciones_medidas_sin_neumatico(v.id) as q(posicion)
  cross join lateral (
    select max(e.created_at) as cut
      from public.eventos_neumatico e
     where e.vehiculo_id = v.id and e.tipo in ('montaje', 'desmontaje', 'rotacion', 'baja')
       and (e.posicion_origen = q.posicion or e.posicion_destino = q.posicion)
  ) z
  cross join lateral (
    select m.id, m.idneumatico, m.mm1, m.mm2, m.mm3, m.promedio, m.odometro_km, m.created_at
      from public.mediciones m
     where m.vehiculo_id = v.id and m.posicion = q.posicion
       and (m.idneumatico is null
            or not exists (select 1 from public.neumaticos nt where nt.idneumatico = m.idneumatico))
       and (z.cut is null or m.created_at >= z.cut)
     order by m.created_at desc, m.id desc limit 1
  ) l
  cross join lateral (
    select count(*) as n90, count(*) as n_v, min(m.created_at) as t0, max(m.created_at) as t1,
           regr_slope(m.promedio::float8, extract(epoch from m.created_at)) as slope
      from public.mediciones m
     where m.vehiculo_id = v.id and m.posicion = q.posicion
       and (m.idneumatico is null
            or not exists (select 1 from public.neumaticos nt where nt.idneumatico = m.idneumatico))
       and (z.cut is null or m.created_at >= z.cut) and m.created_at >= now() - interval '90 days'
  ) a
  where v.activo
),
b as (
  select
    s.cliente_id, s.vehiculo_id, s.vehiculo_nombre, s.patente, s.posicion,
    s.neumatico_id, s.idneumatico, s.marca, s.modelo, s.vida, s.estado_montaje,
    s.mm1, s.mm2, s.mm3, s.promedio, s.odometro_km,
    s.ultima_at as ultima_medicion_at,
    case when s.ultima_at is null then null
         else floor(extract(epoch from now() - s.ultima_at) / 86400)::integer end as dias_desde_medicion,
    case when s.promedio is null                 then 'sin_datos'
         when s.promedio < s.umbral_critico_mm   then 'critico'
         when s.promedio < s.umbral_bajo_mm      then 'bajo'
         else 'ok' end as estado,
    case when s.ultima_at is null then s.neumatico_id is not null
         else s.ultima_at < now() - make_interval(days => s.dias_sin_medir_alerta) end as sin_medir,
    case when s.promedio is null then null
         else greatest(s.mm1, s.mm2, s.mm3) - least(s.mm1, s.mm2, s.mm3) end as diferencia_huellas_mm,
    coalesce(greatest(s.mm1, s.mm2, s.mm3) - least(s.mm1, s.mm2, s.mm3) > s.irregularidad_mm, false)
      as desgaste_irregular,
    coalesce(s.n90, 0) as n_mediciones_90d,
    -- Tasa: al menos 3 mediciones y 14 días reales entre la primera y la última de la ventana
    -- (reiniciada en reencauche/reparación/montaje); pendiente negativa = sin tasa.
    case when s.n_v >= 3
          and extract(epoch from s.t1 - s.t0) >= 14 * 86400
          and s.slope < 0
         then round((-s.slope * 604800)::numeric, 3) end as tasa_mm_semana,
    s.umbral_bajo_mm, s.umbral_critico_mm, s.umbral_retiro_mm, s.dias_sin_medir_alerta
  from s
)
select b.*,
  case when b.tasa_mm_semana > 0 and b.promedio is not null
       then round(greatest(b.promedio - b.umbral_critico_mm, 0) / b.tasa_mm_semana, 2) end as semanas_hasta_critico,
  case when b.tasa_mm_semana > 0 and b.promedio is not null
       then round(greatest(b.promedio - b.umbral_retiro_mm, 0) / b.tasa_mm_semana, 2) end  as semanas_hasta_retiro
from b;

-- Permisos: iguales que antes (create or replace los conserva; se repiten para que la migración sea autosuficiente).
revoke all on public.v_estado_neumaticos from public, anon;
grant select on public.v_estado_neumaticos to authenticated;
