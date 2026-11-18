-- =============================================================================
-- NEUMET · Cinco categorías de desgaste y alerta única en «desgaste límite»
-- =============================================================================
-- Requiere 20261122000000_distribucion_vehiculo.sql y 20261118500000_alerta_critica.sql.
-- Sin begin/commit: la herramienta que aplica la migración ya la envuelve. Idempotente.
--
-- Decisión de producto (docs/15, hoja de ruta F8): los estados de desgaste pasan a ser
--   nuevo, poco desgaste, mayor desgaste, desgaste límite y desconocido. La única alerta
--   se dispara cuando el promedio de huellas es menor que el umbral de retiro del cliente
--   (clientes.umbral_retiro_mm, 3 mm por defecto) y se resuelve cuando supera ese umbral
--   más la histéresis (clientes.alerta_histeresis_mm).
--
-- Mapeo de umbrales (se mantienen los nombres de columnas):
--   >= umbral_bajo_mm      -> nuevo
--   >= umbral_critico_mm   -> poco desgaste
--   >= umbral_retiro_mm    -> mayor desgaste
--   <  umbral_retiro_mm    -> desgaste límite
--   sin promedio           -> desconocido
--
-- Qué hace:
--  1. Migra el tipo de alerta de 'critico' a 'limite' y ajusta su check.
--  2. Recrea v_estado_neumaticos con los nuevos estados.
--  3. Recrea v_alertas con el tipo 'limite' y mensaje asociado.
--  4. Recrea v_resumen_flota_cliente con conteos para cada categoría.
--  5. Recrea alerta_sincronizar para evaluar sobre umbral_retiro_mm.
--  6. Actualiza el trigger de clientes para reevaluar también ante cambios de umbral_retiro_mm.
--  7. Reevalúa las alertas no resueltas de todos los clientes.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Tipo de alerta: de 'critico' a 'limite'
-- -----------------------------------------------------------------------------
-- El check inline de la tabla original (tipo = 'critico') se nombra automaticamente
-- alertas_tipo_check; lo eliminamos antes de añadir el nuestro.
alter table public.alertas drop constraint if exists alertas_tipo_check;
alter table public.alertas drop constraint if exists alertas_tipo_ck;
update public.alertas set tipo = 'limite' where tipo = 'critico';
alter table public.alertas alter column tipo set default 'limite';
alter table public.alertas add constraint alertas_tipo_ck check (tipo = 'limite');

-- -----------------------------------------------------------------------------
-- 2. v_estado_neumaticos: cinco categorías de desgaste
-- -----------------------------------------------------------------------------
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
             where n.idneumatico is not null and m.idneumatico = n.idneumatico and m.calidad <> 'invalidada'
             order by m.created_at desc, m.id desc limit 1) l
     cross join lateral (
       select count(*) as n90,
              count(*) filter (where m.created_at >= coalesce(r.reinicio, '-infinity')) as n_v,
              min(m.created_at) filter (where m.created_at >= coalesce(r.reinicio, '-infinity')) as t0,
              max(m.created_at) filter (where m.created_at >= coalesce(r.reinicio, '-infinity')) as t1,
              regr_slope(m.promedio::float8, extract(epoch from m.created_at))
                filter (where m.created_at >= coalesce(r.reinicio, '-infinity')) as slope
         from public.mediciones m
        where m.idneumatico = n.idneumatico and m.calidad <> 'invalidada' and m.created_at >= now() - interval '90 days'
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
               and m.idneumatico is null and m.calidad <> 'invalidada'
               and (n.idneumatico is null or not exists (select 1 from public.mediciones x where x.idneumatico = n.idneumatico)) and (z.cut is null or m.created_at >= z.cut)
             order by m.created_at desc, m.id desc limit 1) l
     cross join lateral (
       select count(*) as n90,
              count(*) filter (where m.created_at >= coalesce(r.reinicio, '-infinity')) as n_v,
              min(m.created_at) filter (where m.created_at >= coalesce(r.reinicio, '-infinity')) as t0,
              max(m.created_at) filter (where m.created_at >= coalesce(r.reinicio, '-infinity')) as t1,
              regr_slope(m.promedio::float8, extract(epoch from m.created_at))
                filter (where m.created_at >= coalesce(r.reinicio, '-infinity')) as slope
         from public.mediciones m
        where m.vehiculo_id = n.vehiculo_id and m.posicion = n.posicion and m.idneumatico is null and m.calidad <> 'invalidada'
          and (n.idneumatico is null or not exists (select 1 from public.mediciones x where x.idneumatico = n.idneumatico))
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
       and m.calidad <> 'invalidada'
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
       and m.calidad <> 'invalidada'
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
    case when s.promedio is null                 then 'desconocido'
         when s.promedio < s.umbral_retiro_mm    then 'desgaste_limite'
         when s.promedio < s.umbral_critico_mm   then 'mayor_desgaste'
         when s.promedio < s.umbral_bajo_mm      then 'poco_desgaste'
         else 'nuevo' end as estado,
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

revoke all on public.v_estado_neumaticos from public, anon;
grant select on public.v_estado_neumaticos to authenticated;

-- -----------------------------------------------------------------------------
-- 3. v_alertas: alerta única de «desgaste límite»
-- -----------------------------------------------------------------------------
create or replace view public.v_alertas
with (security_invoker = true) as
select a.cliente_id, a.vehiculo_id, v.nombre as vehiculo_nombre, v.patente, a.posicion, a.neumatico_id, a.idneumatico,
       a.tipo, 3 as severidad, a.mm_actual::numeric as valor,
       format('Desgaste límite: %s mm (umbral %s mm)', replace(trim_scale(a.mm_actual)::text, '.', ','),
              replace(trim_scale(a.umbral_mm)::text, '.', ',')) as mensaje,
       a.ultima_medicion_at,
       a.id as alerta_id, a.estado, a.umbral_mm, a.mm_apertura, a.mm_minimo, a.abierta_at, a.reconocida_at,
       a.silenciada_hasta, a.veces_reabierta
from public.alertas a
join public.vehiculos v on v.id = a.vehiculo_id
join public.clientes c on c.id = a.cliente_id and c.deleted_at is null
where a.estado <> 'resuelta';

revoke all on public.v_alertas from public, anon;
grant select on public.v_alertas to authenticated;

-- -----------------------------------------------------------------------------
-- 4. v_resumen_flota_cliente: conteos por categoría
-- -----------------------------------------------------------------------------
-- Se mantienen los nombres de columnas históricos (n_ok, n_bajo, n_critico, n_sin_datos)
-- para no romper el contrato público; se agrega n_mayor_desgaste para la categoría nueva.
drop view if exists public.v_resumen_flota_cliente cascade;
create view public.v_resumen_flota_cliente
with (security_invoker = true) as
select
  c.id as cliente_id,
  c.nombre,
  coalesce(veh.n, 0)         as n_vehiculos_activos,
  coalesce(e.n_con_datos, 0) as n_neumaticos_con_datos,
  coalesce(e.n_nuevo, 0)     as n_ok,
  coalesce(e.n_poco_desgaste, 0) as n_bajo,
  coalesce(e.n_mayor_desgaste, 0) as n_mayor_desgaste,
  coalesce(e.n_desgaste_limite, 0) as n_critico,
  coalesce(e.n_desconocido, 0) as n_sin_datos,
  coalesce(a.sev1, 0)        as n_alertas_sev1,
  coalesce(a.sev2, 0)        as n_alertas_sev2,
  coalesce(a.sev3, 0)        as n_alertas_sev3,
  mm.ultima_medicion_at
from public.clientes c
left join (select cliente_id, count(*) as n from public.vehiculos where activo group by cliente_id) veh
       on veh.cliente_id = c.id
left join (select cliente_id,
                  count(*) filter (where estado <> 'desconocido') as n_con_datos,
                  count(*) filter (where estado = 'nuevo')         as n_nuevo,
                  count(*) filter (where estado = 'poco_desgaste')       as n_poco_desgaste,
                  count(*) filter (where estado = 'mayor_desgaste')    as n_mayor_desgaste,
                  count(*) filter (where estado = 'desgaste_limite')    as n_desgaste_limite,
                  count(*) filter (where estado = 'desconocido')  as n_desconocido
           from public.v_estado_neumaticos group by cliente_id) e on e.cliente_id = c.id
left join (select cliente_id,
                  count(*) filter (where severidad = 1) as sev1,
                  count(*) filter (where severidad = 2) as sev2,
                  count(*) filter (where severidad = 3) as sev3
           from public.v_alertas group by cliente_id) a on a.cliente_id = c.id
left join (select cliente_id, max(created_at) as ultima_medicion_at
           from public.mediciones where cliente_id is not null group by cliente_id) mm
       on mm.cliente_id = c.id
where c.deleted_at is null;

revoke all on public.v_resumen_flota_cliente from authenticated, public, anon;
grant select on public.v_resumen_flota_cliente to authenticated;

-- -----------------------------------------------------------------------------
-- 5. alerta_sincronizar: evalúa sobre umbral_retiro_mm
-- -----------------------------------------------------------------------------
create or replace function public.alerta_sincronizar(p_cliente_id bigint, p_neumaticos bigint[] default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
begin
  if p_cliente_id is null then
    return;
  end if;

  -- 1. El neumático ya no está montado: cambio o baja.
  update public.alertas a
     set estado = 'resuelta', resuelta_at = v_now, updated_at = v_now, silenciada_hasta = null,
         resuelta_motivo = case when n.estado = 'baja' then 'baja' else 'cambio' end
    from public.neumaticos n
   where n.id = a.neumatico_id
     and a.cliente_id = p_cliente_id
     and a.estado <> 'resuelta'
     and n.estado <> 'montado'
     and (p_neumaticos is null or a.neumatico_id = any (p_neumaticos));

  -- 2. Neumáticos montados: cierra, actualiza, reabre o abre.
  with e as (
    select s.neumatico_id, s.vehiculo_id, s.posicion, s.idneumatico, s.promedio, s.ultima_medicion_at,
           c.umbral_retiro_mm as umbral, c.alerta_histeresis_mm as hist
      from public.v_estado_neumaticos s
      join public.clientes c on c.id = s.cliente_id
     where s.cliente_id = p_cliente_id
       and s.neumatico_id is not null
       and (p_neumaticos is null or s.neumatico_id = any (p_neumaticos))
  ),
  cierra as (
    update public.alertas a
       set estado = 'resuelta', resuelta_at = v_now, updated_at = v_now, silenciada_hasta = null,
           resuelta_motivo = case when e.promedio is null then 'sin_datos' else 'recuperada' end,
           mm_actual = coalesce(e.promedio, a.mm_actual), umbral_mm = e.umbral,
           vehiculo_id = e.vehiculo_id, posicion = e.posicion
      from e
     where e.neumatico_id = a.neumatico_id
       and a.estado <> 'resuelta'
       and (e.promedio is null or e.promedio >= e.umbral + e.hist)
     returning a.neumatico_id
  ),
  sigue as (
    update public.alertas a
       set mm_actual = e.promedio, mm_minimo = least(a.mm_minimo, e.promedio), umbral_mm = e.umbral,
           vehiculo_id = e.vehiculo_id, posicion = e.posicion, idneumatico = e.idneumatico,
           ultima_medicion_at = e.ultima_medicion_at, updated_at = v_now
      from e
     where e.neumatico_id = a.neumatico_id
       and a.estado <> 'resuelta'
       and e.promedio is not null
       and e.promedio < e.umbral + e.hist
     returning a.neumatico_id
  ),
  candidatos as (
    -- Neumáticos en desgaste límite sin alerta no resuelta (el promedio nulo nunca genera alerta).
    select e.* from e
     where e.promedio is not null
       and e.promedio < e.umbral
       and not exists (select 1 from public.alertas x
                        where x.neumatico_id = e.neumatico_id and x.estado <> 'resuelta')
  ),
  reabre as (
    update public.alertas a
       set estado = 'abierta', resuelta_at = null, resuelta_motivo = null, resuelta_por = null, nota_resolucion = null,
           reconocida_at = null, reconocida_por = null, nota_reconocida = null,
           silenciada_hasta = null, silencio_motivo = null, silenciada_por = null,
           veces_reabierta = a.veces_reabierta + 1, abierta_at = v_now, updated_at = v_now,
           mm_apertura = k.promedio, mm_minimo = k.promedio, mm_actual = k.promedio, umbral_mm = k.umbral,
           vehiculo_id = k.vehiculo_id, posicion = k.posicion, idneumatico = k.idneumatico,
           ultima_medicion_at = k.ultima_medicion_at
      from (select u.id as alerta_id, c.*
              from candidatos c
              -- Solo la última alerta resuelta del neumático, y solo si fue por recuperación reciente.
              cross join lateral (select r.id, r.resuelta_motivo, r.resuelta_at
                                    from public.alertas r
                                   where r.neumatico_id = c.neumatico_id and r.estado = 'resuelta'
                                   order by r.resuelta_at desc, r.id desc limit 1) u
             where u.resuelta_motivo = 'recuperada'
               and u.resuelta_at >= v_now - interval '7 days') k
     where a.id = k.alerta_id
    returning a.neumatico_id
  )
  insert into public.alertas (cliente_id, vehiculo_id, neumatico_id, posicion, idneumatico, umbral_mm,
                              mm_apertura, mm_minimo, mm_actual, ultima_medicion_at)
  select p_cliente_id, c.vehiculo_id, c.neumatico_id, c.posicion, c.idneumatico, c.umbral,
         c.promedio, c.promedio, c.promedio, c.ultima_medicion_at
    from candidatos c
   where c.neumatico_id not in (select neumatico_id from reabre)
  on conflict (neumatico_id) where estado <> 'resuelta' do nothing;
end
$$;
revoke all on function public.alerta_sincronizar(bigint, bigint[]) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 6. Trigger de clientes: reevaluar también ante cambios de umbral_retiro_mm
-- -----------------------------------------------------------------------------
drop trigger if exists trg_alerta_clientes on public.clientes;
create trigger trg_alerta_clientes after update of umbral_critico_mm, umbral_retiro_mm, alerta_histeresis_mm on public.clientes
  for each row
  when (old.umbral_critico_mm is distinct from new.umbral_critico_mm
        or old.umbral_retiro_mm is distinct from new.umbral_retiro_mm
        or old.alerta_histeresis_mm is distinct from new.alerta_histeresis_mm)
  execute function public.trg_alerta_clientes();

-- -----------------------------------------------------------------------------
-- 7. Reevaluación inicial: cierra las alertas que ya no están bajo el umbral de
--    retiro y abre las que ahora están en desgaste límite.
-- -----------------------------------------------------------------------------
select public.alerta_sincronizar(c.id, null) from public.clientes c where c.deleted_at is null;
