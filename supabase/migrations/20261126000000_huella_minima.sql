-- =============================================================================
-- NEUMET · Estado de desgaste y alertas por la huella MÍNIMA (RN-01, RN-08, P0-3 / G-01)
-- =============================================================================
-- Requiere 20261125500000_auxilio_sin_alerta.sql (y sus antecesores). Sin begin/commit. Idempotente.
--
-- Regla de negocio: el desgaste se evalúa con min(mm1, mm2, mm3), no con el promedio. El promedio sigue
-- expuesto como dato informativo. Una cubierta bajo 3 mm se retira ya (RN-08) y su alerta roja se abre con el mínimo.
--
-- Qué cambia:
--  1. v_estado_neumaticos: columna nueva `minimo` (al final, para que CREATE OR REPLACE VIEW no rompa dependientes).
--     `estado` se decide con el mínimo. Sin una de las tres huellas, `minimo` es NULL y `estado` es 'desconocido':
--     nunca se fabrica un estado con dos huellas. Los valores crudos mm1..mm3 y `promedio` no cambian.
--  2. alerta_sincronizar: abre, cierra y reabre con el mínimo; mm_actual, mm_minimo y mm_apertura guardan el
--     mínimo, de modo que el mensaje «Desgaste límite: X mm» de v_alertas coincide con la decisión.
--     Sin mínimo (NULL) no abre ni mantiene alerta. La lógica del auxilio (posición 99) no cambia.
--  3. No hay backfill: las alertas abiertas con el promedio se corrigen en su próxima sincronización.
--     Esta migración NO reevalúa clientes ni reescribe filas existentes.
--
-- Umbrales: se siguen leyendo de clientes (umbral_bajo/critico/retiro_mm, alerta_histeresis_mm). Sin umbrales por eje.
-- Permisos: sin cambios. v_estado_neumaticos sigue con security_invoker y select para authenticated;
-- alerta_sincronizar sigue sin ejecución para public, anon y authenticated (solo la invocan triggers).
-- Mapeo DAC mm1..mm4 sin cambios.
-- La misma regla vive en assets/js/domain/desgaste.js (huellaMinima).
-- =============================================================================

-- 1. v_estado_neumaticos: estado por mínimo; columna `minimo` agregada al final.
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
    -- RN-01/RN-08: el estado sale de la huella mínima. Con una huella sin medir no hay estado (sin fabricarlo).
    case when s.mm1 is null or s.mm2 is null or s.mm3 is null then 'desconocido'
         when least(s.mm1, s.mm2, s.mm3) < s.umbral_retiro_mm    then 'desgaste_limite'
         when least(s.mm1, s.mm2, s.mm3) < s.umbral_critico_mm   then 'mayor_desgaste'
         when least(s.mm1, s.mm2, s.mm3) < s.umbral_bajo_mm      then 'poco_desgaste'
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
       then round(greatest(b.promedio - b.umbral_retiro_mm, 0) / b.tasa_mm_semana, 2) end  as semanas_hasta_retiro,
  -- Huella mínima (RN-01). NULL si falta cualquiera de las tres: least() ignora nulos y daría un mínimo falso.
  case when b.mm1 is null or b.mm2 is null or b.mm3 is null then null
       else least(b.mm1, b.mm2, b.mm3) end as minimo
from b;

revoke all on public.v_estado_neumaticos from public, anon;
grant select on public.v_estado_neumaticos to authenticated;

-- 2. alerta_sincronizar: abre, cierra y reabre con la huella mínima (mismo cuerpo que el auxilio, salvo el mínimo).
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

  -- 2. Neumáticos montados: cierra, actualiza, reabre o abre. Todo con la huella MÍNIMA (RN-01).
  with e as (
    select s.neumatico_id, s.vehiculo_id, s.posicion, s.idneumatico, s.minimo, s.ultima_medicion_at,
           c.umbral_retiro_mm as umbral, c.alerta_histeresis_mm as hist,
           -- Regla del auxilio: su poca vida útil es normal, no es advertencia. Es auxilio la rueda en la posición 99.
           (s.posicion = 99) as auxilio
      from public.v_estado_neumaticos s
      join public.clientes c on c.id = s.cliente_id
     where s.cliente_id = p_cliente_id
       and s.neumatico_id is not null
       and (p_neumaticos is null or s.neumatico_id = any (p_neumaticos))
  ),
  cierra as (
    update public.alertas a
       set estado = 'resuelta', resuelta_at = v_now, updated_at = v_now, silenciada_hasta = null,
           resuelta_motivo = case when e.minimo is null or e.auxilio then 'sin_datos' else 'recuperada' end,
           mm_actual = coalesce(e.minimo, a.mm_actual), umbral_mm = e.umbral,
           vehiculo_id = e.vehiculo_id, posicion = e.posicion
      from e
     where e.neumatico_id = a.neumatico_id
       and a.estado <> 'resuelta'
       and (e.minimo is null or e.auxilio or e.minimo >= e.umbral + e.hist)
     returning a.neumatico_id
  ),
  sigue as (
    update public.alertas a
       set mm_actual = e.minimo, mm_minimo = least(a.mm_minimo, e.minimo), umbral_mm = e.umbral,
           vehiculo_id = e.vehiculo_id, posicion = e.posicion, idneumatico = e.idneumatico,
           ultima_medicion_at = e.ultima_medicion_at, updated_at = v_now
      from e
     where e.neumatico_id = a.neumatico_id
       and a.estado <> 'resuelta'
       and e.minimo is not null
       and not e.auxilio
       and e.minimo < e.umbral + e.hist
     returning a.neumatico_id
  ),
  candidatos as (
    -- Neumáticos en desgaste límite (mínimo bajo el umbral) sin alerta no resuelta. Sin mínimo, nunca abren alerta.
    select e.* from e
     where e.minimo is not null
       and not e.auxilio
       and e.minimo < e.umbral
       and not exists (select 1 from public.alertas x
                        where x.neumatico_id = e.neumatico_id and x.estado <> 'resuelta')
  ),
  reabre as (
    update public.alertas a
       set estado = 'abierta', resuelta_at = null, resuelta_motivo = null, resuelta_por = null, nota_resolucion = null,
           reconocida_at = null, reconocida_por = null, nota_reconocida = null,
           silenciada_hasta = null, silencio_motivo = null, silenciada_por = null,
           veces_reabierta = a.veces_reabierta + 1, abierta_at = v_now, updated_at = v_now,
           mm_apertura = k.minimo, mm_minimo = k.minimo, mm_actual = k.minimo, umbral_mm = k.umbral,
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
         c.minimo, c.minimo, c.minimo, c.ultima_medicion_at
    from candidatos c
   where c.neumatico_id not in (select neumatico_id from reabre)
  on conflict (neumatico_id) where estado <> 'resuelta' do nothing;
end
$$;
revoke all on function public.alerta_sincronizar(bigint, bigint[]) from public, anon, authenticated;

-- Sin reevaluación masiva: las alertas abiertas con el promedio se corrigen en su próxima sincronización.
