-- =============================================================================
-- NEUMET · La rueda de auxilio no cuenta como advertencia de desgaste
-- =============================================================================
-- Requiere 20261123000000_categorias_desgaste.sql. Sin begin/commit. Idempotente.
--
-- Regla de negocio: el auxilio (neumaticos.auxilio = true o posición 99) casi siempre tiene poca vida útil,
-- así que su mayor desgaste / desgaste límite no es una advertencia. Se sigue mostrando con su estado y su
-- medición (v_estado_neumaticos no cambia) y sigue en el total de neumáticos.
--
--  1. alerta_sincronizar: el auxilio nunca abre alerta; las abiertas de una rueda con el indicador auxilio se
--     resuelven con resuelta_motivo = 'sin_datos' (no se borra nada: la tabla ya tiene estado «resuelta»).
--     La posición 99 sola no cierra alertas: neumatico_rotar aparca ahí una rueda durante un intercambio.
--  2. v_alertas: excluye las alertas de auxilio (defensa si alguna quedara).
--  3. v_resumen_flota_cliente: su mayor desgaste / límite se cuenta como poco desgaste (mismas columnas).
--  4. Reevaluación inicial de todos los clientes (cierra las alertas de auxilio existentes).
-- La misma regla vive en assets/js/domain/auxilio.js (posición 99 o auxilio verdadero).
-- =============================================================================

-- 1. alerta_sincronizar
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
           c.umbral_retiro_mm as umbral, c.alerta_histeresis_mm as hist,
           -- Regla del auxilio: su poca vida útil es normal, no es advertencia (posición 99 o neumáticos.auxilio).
           -- Abrir alerta nuevo excluye ambos; cerrar y dejar de actualizar solo con el indicador, porque
           -- neumatico_rotar «aparca» una rueda en la posición 99 un instante y cerraría su alerta sin motivo.
           coalesce(n.auxilio, false) as auxilio, (s.posicion = 99) as en_99
      from public.v_estado_neumaticos s
      join public.clientes c on c.id = s.cliente_id
      left join public.neumaticos n on n.id = s.neumatico_id
     where s.cliente_id = p_cliente_id
       and s.neumatico_id is not null
       and (p_neumaticos is null or s.neumatico_id = any (p_neumaticos))
  ),
  cierra as (
    update public.alertas a
       set estado = 'resuelta', resuelta_at = v_now, updated_at = v_now, silenciada_hasta = null,
           resuelta_motivo = case when e.promedio is null or e.auxilio then 'sin_datos' else 'recuperada' end,
           mm_actual = coalesce(e.promedio, a.mm_actual), umbral_mm = e.umbral,
           vehiculo_id = e.vehiculo_id, posicion = e.posicion
      from e
     where e.neumatico_id = a.neumatico_id
       and a.estado <> 'resuelta'
       and (e.promedio is null or e.auxilio or e.promedio >= e.umbral + e.hist)
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
       and not e.auxilio
       and e.promedio < e.umbral + e.hist
     returning a.neumatico_id
  ),
  candidatos as (
    -- Neumáticos en desgaste límite sin alerta no resuelta (el promedio nulo nunca genera alerta).
    select e.* from e
     where e.promedio is not null
       and not e.auxilio and not e.en_99
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

-- 2. v_alertas
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
left join public.neumaticos n on n.id = a.neumatico_id
join public.clientes c on c.id = a.cliente_id and c.deleted_at is null
where a.estado <> 'resuelta'
  -- El auxilio no genera advertencias (posición 99 o neumáticos.auxilio).
  and not (a.posicion = 99 or coalesce(n.auxilio, false));

revoke all on public.v_alertas from public, anon;
grant select on public.v_alertas to authenticated;

-- 3. v_resumen_flota_cliente
create or replace view public.v_resumen_flota_cliente
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
           -- Auxilio: sigue en el total, pero su mayor desgaste / desgaste límite cuenta como poco desgaste.
           from (select s.cliente_id,
                        case when s.estado in ('mayor_desgaste', 'desgaste_limite')
                                  and (s.posicion = 99 or coalesce(n.auxilio, false))
                             then 'poco_desgaste' else s.estado end as estado
                   from public.v_estado_neumaticos s
                   left join public.neumaticos n on n.id = s.neumatico_id) s
          group by cliente_id) e on e.cliente_id = c.id
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

-- 4. Reevaluación inicial
select public.alerta_sincronizar(c.id, null) from public.clientes c where c.deleted_at is null;
