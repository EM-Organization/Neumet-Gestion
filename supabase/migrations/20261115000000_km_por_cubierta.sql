-- =============================================================================
-- NEUMET · Km por cubierta (hoja de ruta F2): v_km_cubierta y odometro_anomalias
-- =============================================================================
-- Requiere 20261106000000 (init), 20261106020000 (eventos_neumatico), 20261110000000 (km_previos) y
-- 20261113000000 (neumaticos sin vehículo). Sin begin/commit: la herramienta que aplica la migración ya la envuelve.
-- Idempotente (drop view if exists + create, create or replace, revoke/grant repetibles). No modifica datos.
-- Diseño y reglas: docs/08-esquema-datos.md (apéndice H).
--
-- Km totales de una cubierta = km_previos + suma de los TRAMOS montados. Un tramo es un montaje y su cierre en el
-- mismo vehículo: odómetro del evento de cierre (desmontaje o baja) menos odómetro del evento de montaje. Nunca se
-- comparan odómetros de vehículos distintos. Una rotación (en el mismo vehículo) no abre ni cierra tramo, así que
-- no duplica km; pasar a otro vehículo son un desmontaje y un montaje (dos tramos). El tramo actual de una cubierta
-- montada llega hasta el odómetro actual del vehículo.
--
-- Sin inventar precisión: un tramo sin odómetro en algún extremo, con fin menor que inicio, sin evento de montaje o
-- sin cierre es un tramo «sin dato»: no suma km y baja km_confiable a false. Si TODOS los tramos son sin dato el
-- total es NULL (nunca 0).
--
-- Historial completo aunque la RLS oculte eventos: un perfil de sucursal solo ve los eventos de vehículos de su
-- sucursal, y una cubierta que pasó por otra sucursal tendría km subestimados. Por eso los tramos de cada cubierta
-- los agrega km_tramos_cubierta(p_neumatico), SECURITY DEFINER y acotada: solo responde por una cubierta que quien
-- llama ya puede ver (mismo criterio que la RLS de neumaticos) y solo devuelve agregados (sin fechas, notas ni
-- vehículos de otras sucursales). La vista sigue siendo security_invoker: la RLS de neumaticos y vehiculos decide
-- qué filas aparecen.
--
-- Costo: sin CTE recursiva. La vista hace un LATERAL correlacionado por n.id sobre eventos_neumatico_neum_idx, de
-- modo que un filtro por vehiculo_id o neumatico_id solo agrega los eventos de esas cubiertas (docs/08 apéndice H).
-- =============================================================================

drop view if exists public.v_km_cubierta;

-- -----------------------------------------------------------------------------
-- km_tramos_cubierta(p_neumatico): agregado de tramos de una cubierta (interno de la vista)
-- -----------------------------------------------------------------------------
-- Devuelve una fila (o ninguna si quien llama no puede ver la cubierta):
--   cerrados / cerrados_con_dato / km_cerrados: cierres (desmontaje o baja) y los que tienen dato;
--   montajes_sin_cierre: montajes seguidos de otro montaje (el primero quedó sin cierre);
--   ultimo_montaje, ult_odo, ult_veh: si el último evento de la secuencia es un montaje, su odómetro y vehículo;
--   decreciente: odómetro decreciente entre eventos consecutivos de la cubierta en un mismo vehículo.
-- La rotación queda en otra partición de la ventana: no corta el tramo ni lo duplica.
create or replace function public.km_tramos_cubierta(p_neumatico bigint)
returns table (
  cerrados            bigint,
  cerrados_con_dato   bigint,
  km_cerrados         bigint,
  montajes_sin_cierre bigint,
  ultimo_montaje      boolean,
  ult_odo             integer,
  ult_veh             bigint,
  decreciente         boolean
)
language plpgsql
stable
security definer
set search_path = ''
rows 1
as $$
declare
  v_rol text;
  v_cli bigint;
  v_suc bigint;
begin
  -- Solo para una cubierta que quien llama puede ver (mismo criterio que las políticas de neumaticos): admin;
  -- perfil cliente con la cubierta en un vehículo de su cliente (y de su sucursal si es perfil de sucursal); perfil
  -- global con la cubierta en su stock. api, sin perfil, otro cliente: ninguna fila. Un rol que ya omite la RLS
  -- (service_role, dueño o superusuario: el rol activo no es authenticated ni anon) ve todo, como en la tabla.
  -- El perfil se lee una vez (y no con is_admin/current_*): esta función corre una vez por fila de la vista.
  if coalesce(current_setting('role', true), 'none') in ('authenticated', 'anon') then
    select p.rol, p.cliente_id, p.sucursal_id into v_rol, v_cli, v_suc
      from public.perfiles p where p.user_id = auth.uid();
    if v_rol is distinct from 'admin' then
      if v_rol is distinct from 'cliente' or v_cli is null then
        return;
      end if;
      perform 1 from public.neumaticos n
        left join public.vehiculos v on v.id = n.vehiculo_id
       where n.id = p_neumatico
         and ((v.id is not null and v.cliente_id = v_cli and (v_suc is null or v.sucursal_id = v_suc))
              or (n.vehiculo_id is null and n.cliente_id = v_cli and v_suc is null));
      if not found then
        return;
      end if;
    end if;
  end if;

  return query

  select
    count(*) filter (where t.cierre),
    count(*) filter (where t.cierre and t.conocido),
    coalesce(sum(t.odometro_km - t.prev_odo) filter (where t.cierre and t.conocido), 0)::bigint,
    count(*) filter (where t.tipo = 'montaje' and t.prev_tipo = 'montaje'),
    coalesce(bool_or(t.ultimo and t.tipo = 'montaje'), false),
    max(case when t.ultimo and t.tipo = 'montaje' then t.odometro_km end),
    max(case when t.ultimo and t.tipo = 'montaje' then t.vehiculo_id end),
    coalesce(bool_or(t.decr), false)
  from (
    select
      w.vehiculo_id, w.tipo, w.odometro_km, w.prev_tipo, w.prev_odo, w.ultimo, w.decr,
      (w.tipo in ('desmontaje', 'baja'))                                   as cierre,
      (w.tipo in ('desmontaje', 'baja') and w.prev_tipo = 'montaje' and w.prev_veh = w.vehiculo_id
        and w.odometro_km is not null and w.prev_odo is not null
        and w.odometro_km >= w.prev_odo)                                   as conocido
    from (
      select
        e.vehiculo_id, e.tipo, e.odometro_km,
        lag(e.tipo)        over wt as prev_tipo,
        lag(e.vehiculo_id) over wt as prev_veh,
        lag(e.odometro_km) over wt as prev_odo,
        (e.tipo <> 'rotacion' and lead(e.id) over wt is null) as ultimo,
        (e.odometro_km is not null and lag(e.odometro_km) over wv is not null
          and e.odometro_km < lag(e.odometro_km) over wv)    as decr
      from public.eventos_neumatico e
      where e.neumatico_id = km_tramos_cubierta.p_neumatico and e.vehiculo_id is not null
        and e.tipo in ('montaje', 'desmontaje', 'baja', 'rotacion')
      window wt as (partition by (e.tipo = 'rotacion') order by e.created_at, e.id),
             wv as (partition by e.vehiculo_id order by e.created_at, e.id)
    ) w
  ) t;
end
$$;
revoke all on function public.km_tramos_cubierta(bigint) from public, anon;
grant execute on function public.km_tramos_cubierta(bigint) to authenticated;

create view public.v_km_cubierta
with (security_invoker = true) as
select
  b.neumatico_id,
  b.cliente_id,
  b.vehiculo_id,
  b.idneumatico,
  b.numero_quema,
  b.estado,
  b.km_previos,
  -- Suma de tramos cerrados. 0 solo si no hay ningún tramo cerrado; NULL si los hay y ninguno tiene datos.
  case when b.cerrados_total = 0 then 0
       when b.cerrados_con_dato = 0 then null
       else b.km_cerrados end                                           as km_en_vehiculos,
  -- Tramo en curso (cubierta montada): odómetro actual del vehículo menos el del último montaje, mínimo 0.
  case when b.actual_ok then greatest(b.odo_vehiculo - b.ult_odo, 0) end as km_tramo_actual,
  case when (b.cerrados_total - b.cerrados_con_dato + b.actual_sin_dato) > 0
        and (b.cerrados_con_dato + b.actual_ok::int) = 0
       then null
       else b.km_previos::bigint
            + case when b.cerrados_total = 0 or b.cerrados_con_dato = 0 then 0 else b.km_cerrados end
            + case when b.actual_ok then greatest(b.odo_vehiculo - b.ult_odo, 0) else 0 end
  end                                                                    as km_totales,
  ((b.cerrados_total - b.cerrados_con_dato + b.actual_sin_dato) = 0
   and not (b.decreciente or (b.actual_ok and b.odo_vehiculo < b.ult_odo))) as km_confiable,
  (b.cerrados_con_dato + b.actual_ok::int)                               as tramos_con_dato,
  (b.cerrados_total - b.cerrados_con_dato + b.actual_sin_dato)           as tramos_sin_dato,
  (b.decreciente or (b.actual_ok and b.odo_vehiculo < b.ult_odo))        as odometro_anomalo
from (
  select
    n.id as neumatico_id, n.cliente_id, n.vehiculo_id, n.idneumatico, n.numero_quema, n.estado, n.km_previos,
    v.odometro_km as odo_vehiculo,
    a.ult_odo,
    coalesce(a.decreciente, false)                                         as decreciente,
    coalesce(a.cerrados_con_dato, 0)                                       as cerrados_con_dato,
    coalesce(a.km_cerrados, 0)                                             as km_cerrados,
    coalesce(a.cerrados, 0) + coalesce(a.montajes_sin_cierre, 0)
      + case when not (n.estado = 'montado' and n.vehiculo_id is not null) and coalesce(a.ultimo_montaje, false)
             then 1 else 0 end                                             as cerrados_total,
    -- Cubierta montada con último montaje en este vehículo y odómetros conocidos en ambos extremos.
    (n.estado = 'montado' and n.vehiculo_id is not null
      and coalesce(a.ultimo_montaje, false) and a.ult_veh = n.vehiculo_id
      and a.ult_odo is not null and v.odometro_km is not null)             as actual_ok,
    case when n.estado = 'montado' and n.vehiculo_id is not null
          and not (coalesce(a.ultimo_montaje, false) and a.ult_veh = n.vehiculo_id
                   and a.ult_odo is not null and v.odometro_km is not null)
         then 1 else 0 end                                                 as actual_sin_dato
  from public.neumaticos n
  left join public.vehiculos v on v.id = n.vehiculo_id
  left join lateral public.km_tramos_cubierta(n.id) a on true
) b;

comment on view public.v_km_cubierta is
  'Km por cubierta: km_previos + tramos montados. NULL y km_confiable=false cuando faltan odómetros (docs/08 apéndice H).';

revoke all on public.v_km_cubierta from public, anon;
grant select on public.v_km_cubierta to authenticated;

-- -----------------------------------------------------------------------------
-- odometro_anomalias(p_vehiculo): diagnóstico por vehículo (señala, no corrige ni borra)
-- -----------------------------------------------------------------------------
-- Recorre los eventos con odómetro del vehículo por fecha y señala:
--   'decreciente'            el odómetro del evento es menor al del evento anterior con odómetro;
--   'negativo'               odómetro < 0 (la tabla ya lo impide con un CHECK; defensa por si se relaja);
--   'actual_menor_que_evento' el odómetro actual del vehículo es menor al del último evento con odómetro. Esta fila
--                            no es un evento: evento_id es NULL, odometro_km es el actual del vehículo y
--                            evento_previo_id / odometro_previo_km son los del último evento.
-- SECURITY INVOKER: la RLS de eventos_neumatico y vehiculos filtra por cliente y sucursal; un vehículo ajeno
-- devuelve cero filas. Sin grant a anon.
create or replace function public.odometro_anomalias(p_vehiculo bigint)
returns table (
  vehiculo_id         bigint,
  evento_id           bigint,
  neumatico_id        bigint,
  tipo_evento         text,
  fecha               timestamptz,
  odometro_km         integer,
  odometro_previo_km  integer,
  evento_previo_id    bigint,
  anomalia            text
)
language sql
stable
security invoker
set search_path = ''
as $$
  with ev as (
    select e.id, e.neumatico_id, e.tipo, e.created_at, e.odometro_km,
           lag(e.odometro_km) over w as prev_odo,
           lag(e.id)          over w as prev_id,
           lead(e.id)         over w as next_id
      from public.eventos_neumatico e
     where e.vehiculo_id = p_vehiculo and e.odometro_km is not null
    window w as (order by e.created_at, e.id)
  )
  select p_vehiculo, ev.id, ev.neumatico_id, ev.tipo, ev.created_at, ev.odometro_km, ev.prev_odo, ev.prev_id,
         case when ev.odometro_km < 0 then 'negativo' else 'decreciente' end
    from ev
   where ev.odometro_km < 0 or ev.odometro_km < ev.prev_odo
  union all
  select p_vehiculo, null::bigint, ev.neumatico_id, ev.tipo, ev.created_at, v.odometro_km, ev.odometro_km, ev.id,
         'actual_menor_que_evento'
    from ev
    join public.vehiculos v on v.id = p_vehiculo
   where ev.next_id is null and v.odometro_km is not null and v.odometro_km < ev.odometro_km
  order by 5, 2 nulls last
$$;

revoke all on function public.odometro_anomalias(bigint) from public, anon;
grant execute on function public.odometro_anomalias(bigint) to authenticated;
