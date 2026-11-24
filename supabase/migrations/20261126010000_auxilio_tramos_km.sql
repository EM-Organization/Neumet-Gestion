-- =============================================================================
-- NEUMET · Auxilio (posición 99): corte de tramos de km y frecuencia de medición (RN-13, G-13, sección 4.5)
-- =============================================================================
-- Requiere 20261126000000_huella_minima.sql (y sus antecesores). Sin begin/commit. Idempotente. Sin backfill: no
-- reescribe eventos, mediciones ni alertas, no reevalúa clientes y no hace UPDATE masivo. Apéndice Z de docs/08.
--
-- Regla de negocio: la cubierta en la posición 99 no rueda, así que no suma km. Un tramo de km se corta al entrar a la
-- 99 (rotación de ruta a 99, o desmontaje en ruta) y se abre otro al salir a una posición de ruta (1..98, por rotación
-- desde la 99 o por montaje). Rotaciones entre posiciones de ruta no cortan. Montaje directo en la 99 no abre tramo;
-- desmontaje o baja desde la 99 no cierra ninguno (no crea km). Se decide por la posición de cada evento (origen y
-- destino), no por el vehículo actual, así que un intercambio neumatico_rotar cierra y abre cada cubierta por su lado.
--
-- Odómetro: un tramo sin odómetro en algún extremo, o con odómetro decreciente, es «sin dato»: no suma, deja
-- km_confiable = false y no se reemplaza por 0 ni por una estimación. Se quitó greatest(..., 0): un odómetro del vehículo
-- menor que el del último montaje en ruta ya no se muestra como 0 km; el tramo queda sin dato.
--
-- Qué cambia (firmas y columnas de salida idénticas; permisos y security_invoker/definer sin cambios):
--  1. km_tramos_cubierta(bigint): nueva regla de tramos (SECURITY DEFINER, search_path vacío).
--  2. v_km_cubierta: km_tramo_actual = 0 en la 99 (no rueda); sin greatest(); odometro_anomalo cubre el tramo actual.
--  3. v_estado_neumaticos: solo sin_medir. La posición 99 no figura como sin medir (sin plazo propio; no se inventa un
--     plazo de 90 días). dias_desde_medicion sigue mostrándose. El resto de la vista es el de 20261126000000.
--  4. costo_vida_items: el CPK por vida usa el mismo corte de tramos que km_tramos_cubierta (CA-13 da 50.000 km, no
--     100.000). Firma, columnas y permisos sin cambios: v_costo_vida y cpk_por_grupo siguen leyendo de ella. Costos y
--     vidas (reencauche) sin cambios.
-- Un solo auxilio por vehículo: se conserva el índice neumaticos_un_auxilio_por_vehiculo (init_schema).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. km_tramos_cubierta(p_neumatico): agregado de tramos de una cubierta
-- -----------------------------------------------------------------------------
-- Cada evento de montaje/desmontaje/baja/rotación se clasifica en una marca de tramo:
--   'abre'   montaje en ruta; rotación desde la 99 a ruta.
--   'cierra' desmontaje o baja desde ruta; rotación de ruta a la 99.
--   null     rotación entre rutas, montaje directo en la 99 y desmontaje o baja desde la 99 (no cortan).
-- Las marcas se ordenan por fecha e id y cada cierre se empareja con la marca anterior (que debe ser un abre del mismo
-- vehículo con odómetro conocido). Un abre seguido de otro abre es un tramo sin cierre (sin dato).
-- Columnas (firma pública, sin cambios): cerrados, cerrados_con_dato, km_cerrados, montajes_sin_cierre, ultimo_montaje
-- (el último tramo está abierto: última marca es un abre), ult_odo y ult_veh (odómetro y vehículo de ese abre) y
-- decreciente (odómetro decreciente entre dos eventos consecutivos de la cubierta en un mismo vehículo).
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
  -- Un neumático con vehículo eliminado no se lee por esta vía (20261124000000).
  if coalesce(current_setting('role', true), 'none') in ('authenticated', 'anon') then
    perform 1 from public.neumaticos n
      join public.vehiculos v on v.id = n.vehiculo_id
     where n.id = p_neumatico and v.deleted_at is not null;
    if found then
      return;
    end if;
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
    count(*) filter (where t.accion = 'cierra'),
    count(*) filter (where t.accion = 'cierra' and t.conocido),
    coalesce(sum(t.odometro_km - t.prev_odo) filter (where t.accion = 'cierra' and t.conocido), 0)::bigint,
    count(*) filter (where t.accion = 'abre' and t.prev_accion = 'abre'),
    coalesce(bool_or(t.ultimo and t.accion = 'abre'), false),
    max(case when t.ultimo and t.accion = 'abre' then t.odometro_km end),
    max(case when t.ultimo and t.accion = 'abre' then t.vehiculo_id end),
    coalesce(bool_or(t.decr), false)
  from (
    select
      w.vehiculo_id, w.accion, w.odometro_km, w.prev_accion, w.prev_veh, w.prev_odo, w.ultimo, w.decr,
      (w.accion = 'cierra' and w.prev_accion = 'abre' and w.prev_veh = w.vehiculo_id
        and w.odometro_km is not null and w.prev_odo is not null
        and w.odometro_km >= w.prev_odo)                                   as conocido
    from (
      select
        e.vehiculo_id, e.odometro_km, e.accion,
        lag(e.accion)      over wt as prev_accion,
        lag(e.vehiculo_id) over wt as prev_veh,
        lag(e.odometro_km) over wt as prev_odo,
        (lead(e.id) over wt is null) as ultimo,
        (e.odometro_km is not null and lag(e.odometro_km) over wv is not null
          and e.odometro_km < lag(e.odometro_km) over wv)    as decr
      from (
        select x.*,
          case
            when x.tipo = 'montaje' and coalesce(x.posicion_destino, 0) <> 99 then 'abre'
            when x.tipo in ('desmontaje', 'baja') and coalesce(x.posicion_origen, 0) <> 99 then 'cierra'
            when x.tipo = 'rotacion' and coalesce(x.posicion_origen, 0) <> 99 and x.posicion_destino = 99 then 'cierra'
            when x.tipo = 'rotacion' and x.posicion_origen = 99 and coalesce(x.posicion_destino, 0) <> 99 then 'abre'
            else null
          end as accion
        from public.eventos_neumatico x
        where x.neumatico_id = km_tramos_cubierta.p_neumatico and x.vehiculo_id is not null
          and x.tipo in ('montaje', 'desmontaje', 'baja', 'rotacion')
      ) e
      -- Marcas de tramo (accion no nula) en una partición; el resto de eventos, en otra. decr usa todos los eventos.
      window wt as (partition by (e.accion is not null) order by e.created_at, e.id),
             wv as (partition by e.vehiculo_id order by e.created_at, e.id)
    ) w
  ) t;
end
$$;
revoke all on function public.km_tramos_cubierta(bigint) from public, anon;
grant execute on function public.km_tramos_cubierta(bigint) to authenticated;

-- -----------------------------------------------------------------------------
-- 2. v_km_cubierta (misma firma, columnas y tipos; security_invoker)
-- -----------------------------------------------------------------------------
-- Tramo en curso: solo una cubierta montada en ruta (1..98) tiene tramo abierto. En la 99 no hay tramo: 0 km y sin dato.
-- Sin greatest(): un odómetro menor que el del último montaje es «sin dato» y odometro_anomalo.
create or replace view public.v_km_cubierta
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
  -- Tramo en curso: 0 si está en la 99 (no rueda); odómetro actual menos el del último montaje si está en ruta con
  -- odómetros conocidos y no decrecientes; NULL (sin dato) en cualquier otro caso de cubierta montada.
  case when b.en_aux then 0
       when b.actual_ok then b.odo_vehiculo - b.ult_odo
  end                                                                    as km_tramo_actual,
  case when (b.cerrados_total - b.cerrados_con_dato + b.actual_sin_dato) > 0
        and (b.cerrados_con_dato + b.actual_ok::int) = 0
       then null
       else b.km_previos::bigint
            + case when b.cerrados_total = 0 or b.cerrados_con_dato = 0 then 0 else b.km_cerrados end
            + case when b.actual_ok then b.odo_vehiculo - b.ult_odo else 0 end
  end                                                                    as km_totales,
  ((b.cerrados_total - b.cerrados_con_dato + b.actual_sin_dato) = 0
   and not b.odometro_anomalo)                                           as km_confiable,
  (b.cerrados_con_dato + b.actual_ok::int)                               as tramos_con_dato,
  (b.cerrados_total - b.cerrados_con_dato + b.actual_sin_dato)           as tramos_sin_dato,
  b.odometro_anomalo                                                     as odometro_anomalo
from (
  select
    n.id as neumatico_id, n.cliente_id, n.vehiculo_id, n.idneumatico, n.numero_quema, n.estado, n.km_previos,
    v.odometro_km as odo_vehiculo,
    a.ult_odo,
    coalesce(a.decreciente, false)                                         as decreciente,
    coalesce(a.cerrados_con_dato, 0)                                       as cerrados_con_dato,
    coalesce(a.km_cerrados, 0)                                             as km_cerrados,
    -- Montada en la 99: el auxilio no tiene tramo abierto (sin dato no aplica).
    (n.estado = 'montado' and n.vehiculo_id is not null and n.posicion = 99)              as en_aux,
    -- Montada en ruta: su tramo abierto es el último abre de este vehículo.
    (n.estado = 'montado' and n.vehiculo_id is not null and n.posicion is distinct from 99) as en_ruta,
    coalesce(a.ultimo_montaje, false)                                      as abierto,
    coalesce(a.cerrados, 0) + coalesce(a.montajes_sin_cierre, 0)
      + case when coalesce(a.ultimo_montaje, false) and not (n.estado = 'montado' and n.vehiculo_id is not null
                                                              and n.posicion is distinct from 99)
             then 1 else 0 end                                             as cerrados_total,
    -- Tramo abierto de una cubierta montada en ruta, con odómetros conocidos y no decrecientes.
    (n.estado = 'montado' and n.vehiculo_id is not null and n.posicion is distinct from 99
      and coalesce(a.ultimo_montaje, false) and a.ult_veh = n.vehiculo_id
      and a.ult_odo is not null and v.odometro_km is not null and v.odometro_km >= a.ult_odo) as actual_ok,
    -- Odómetro decreciente en el tramo abierto (el vehículo marca menos que su último montaje).
    (n.estado = 'montado' and n.vehiculo_id is not null and n.posicion is distinct from 99
      and coalesce(a.ultimo_montaje, false) and a.ult_veh = n.vehiculo_id
      and a.ult_odo is not null and v.odometro_km is not null and v.odometro_km < a.ult_odo) as actual_decr,
    case when n.estado = 'montado' and n.vehiculo_id is not null and n.posicion is distinct from 99
          and not (coalesce(a.ultimo_montaje, false) and a.ult_veh = n.vehiculo_id
                   and a.ult_odo is not null and v.odometro_km is not null and v.odometro_km >= a.ult_odo)
         then 1 else 0 end                                                 as actual_sin_dato,
    (coalesce(a.decreciente, false)
      or (n.estado = 'montado' and n.vehiculo_id is not null and n.posicion is distinct from 99
          and coalesce(a.ultimo_montaje, false) and a.ult_veh = n.vehiculo_id
          and a.ult_odo is not null and v.odometro_km is not null and v.odometro_km < a.ult_odo)) as odometro_anomalo
  from public.neumaticos n
  left join public.vehiculos v on v.id = n.vehiculo_id
  left join lateral public.km_tramos_cubierta(n.id) a on true
) b;

comment on view public.v_km_cubierta is
  'Km por cubierta: km_previos + tramos. El auxilio (99) no suma km; NULL y km_confiable=false cuando faltan odómetros (docs/08 apéndice Z).';

revoke all on public.v_km_cubierta from public, anon;
grant select on public.v_km_cubierta to authenticated;

-- -----------------------------------------------------------------------------
-- 3. v_estado_neumaticos: solo la frecuencia de medición del auxilio
-- -----------------------------------------------------------------------------
-- Copia literal de 20261126000000_huella_minima.sql (misma lista de columnas, en el mismo orden) salvo sin_medir.
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
    -- RN-13: el auxilio (99) no tiene plazo de medición vencida; sin_medir no aplica. Sin plazo propio inventado.
    case when s.posicion = 99 then false
         when s.ultima_at is null then s.neumatico_id is not null
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
-- -----------------------------------------------------------------------------
-- 4. costo_vida_items(p_neumatico): CPK por vida con el corte de tramos de la 99 (RN-13, CA-13)
-- -----------------------------------------------------------------------------
-- Misma firma, columnas y tipos que en 20261124000000 (la vista v_costo_vida y cpk_por_grupo dependen de ellas).
-- Cambia solo cómo se reparten los km por vida: la secuencia de tramos es la de km_tramos_cubierta (sección 1):
--   abre = montaje en ruta o salida de la 99 a ruta; cierra = desmontaje o baja desde ruta o entrada a la 99.
-- El tramo es de la vida en que se abrió. Un cierre sin abre previo, un abre sin cierre o un odómetro ausente o
-- decreciente es «sin dato» (no suma y cuenta en tramos_sin_dato); nunca 0 ni una estimación (sin greatest()).
-- Montaje directo en la 99 y desmontaje desde la 99 no abren ni cierran tramo. Costos y vidas (reencauche): sin cambios.
-- Sin backfill: es una lectura; no escribe nada.
create or replace function public.costo_vida_items(p_neumatico bigint)
returns table (
  vida                   smallint,
  vida_actual            smallint,
  banda_marca            text,
  banda_modelo           text,
  profundidad_inicial_mm numeric,
  fecha_inicio           date,
  n_items                integer,
  n_monedas              integer,
  moneda                 text,
  total                  numeric,
  km_recorridos          bigint,
  tramos_con_dato        integer,
  tramos_sin_dato        integer
)
language plpgsql
stable
security definer
set search_path = ''
rows 2
as $$
declare
  v_precio numeric;
  v_vida   smallint;
  v_estado text;
  v_pos    smallint;
  v_veh    bigint;
  v_odo    integer;
  v_nre    integer;
  v_base   integer;
  v_rol    text;
  v_cli    bigint;
begin
  if coalesce(current_setting('role', true), 'none') in ('authenticated', 'anon') then
    -- Un neumático dado de baja con un vehículo eliminado no se lee por esta vía (ni para el equipo Neumet).
    perform 1 from public.neumaticos n
      join public.vehiculos v on v.id = n.vehiculo_id
     where n.id = p_neumatico and v.deleted_at is not null;
    if found then
      return;
    end if;
    if not public.precios_visibles() then
      return;
    end if;
    select p.rol, p.cliente_id into v_rol, v_cli from public.perfiles p where p.user_id = auth.uid();
    if v_rol is distinct from 'admin' then
      perform 1 from public.neumaticos n
        left join public.vehiculos v on v.id = n.vehiculo_id
       where n.id = p_neumatico
         and ((v.id is not null and v.cliente_id = v_cli) or (n.vehiculo_id is null and n.cliente_id = v_cli));
      if not found then
        return;
      end if;
    end if;
  end if;


  select n.precio_unidad, n.vida, n.estado, n.posicion, n.vehiculo_id, v.odometro_km
    into v_precio, v_vida, v_estado, v_pos, v_veh, v_odo
    from public.neumaticos n
    left join public.vehiculos v on v.id = n.vehiculo_id
   where n.id = p_neumatico;
  if not found then
    return;
  end if;
  select count(*)::int into v_nre from public.eventos_neumatico e where e.neumatico_id = p_neumatico and e.tipo = 'reencauche';
  v_base := greatest(v_vida - v_nre, 0);

  return query
  with ev as (
    select e.id, e.created_at, e.tipo, e.vehiculo_id, e.odometro_km, e.costo, e.posicion_origen, e.posicion_destino,
           least(v_base + (count(*) filter (where e.tipo = 'reencauche') over (order by e.created_at, e.id))::int, 3)::smallint as vida_ev
      from public.eventos_neumatico e
     where e.neumatico_id = p_neumatico
  ),
  mk as (
    -- Marcas de tramo, con la misma regla de posiciones que km_tramos_cubierta.
    select m.id, m.created_at, m.vida_ev, m.vehiculo_id, m.odometro_km, m.accion,
           lag(m.accion)       over w as prev_accion,
           lag(m.vehiculo_id)  over w as prev_veh,
           lag(m.odometro_km)  over w as prev_odo,
           lag(m.vida_ev)      over w as prev_vida,
           lead(m.accion)      over w as sig_accion
      from (
        select s.*,
          case
            when s.tipo = 'montaje' and coalesce(s.posicion_destino, 0) <> 99 then 'abre'
            when s.tipo in ('desmontaje', 'baja') and coalesce(s.posicion_origen, 0) <> 99 then 'cierra'
            when s.tipo = 'rotacion' and coalesce(s.posicion_origen, 0) <> 99 and s.posicion_destino = 99 then 'cierra'
            when s.tipo = 'rotacion' and s.posicion_origen = 99 and coalesce(s.posicion_destino, 0) <> 99 then 'abre'
            else null
          end as accion
          from ev s
         where s.vehiculo_id is not null and s.tipo in ('montaje', 'desmontaje', 'baja', 'rotacion')
      ) m
     where m.accion is not null
    window w as (order by m.created_at, m.id)
  ),
  tr as (
    -- Cierre: cierra el tramo que abrió la marca anterior (en la vida de ese abre) o es un cierre suelto (sin dato).
    select (case when m.prev_accion = 'abre' then m.prev_vida else m.vida_ev end) as vida,
           (m.prev_accion = 'abre' and m.prev_veh = m.vehiculo_id and m.odometro_km is not null
             and m.prev_odo is not null and m.odometro_km >= m.prev_odo)            as conocido,
           (m.odometro_km - m.prev_odo)                                             as km
      from mk m
     where m.accion = 'cierra'
    union all
    -- Abre sin cierre después: sin dato, salvo el tramo en curso de una cubierta montada en ruta (odómetros ok).
    select m.vida_ev,
           (m.sig_accion is null and v_estado = 'montado' and v_pos is distinct from 99 and v_veh = m.vehiculo_id
             and m.odometro_km is not null and v_odo is not null and v_odo >= m.odometro_km),
           (v_odo - m.odometro_km)
      from mk m
     where m.accion = 'abre' and m.sig_accion is distinct from 'cierra'
  ),
  kv as (
    select t.vida,
           coalesce(sum(t.km) filter (where t.conocido), 0)::bigint as km,
           (count(*) filter (where t.conocido))::int as con,
           (count(*) filter (where not t.conocido))::int as sin
      from tr t
     group by t.vida
  ),
  it as (
    select i.vida, i.concepto, i.moneda, sum(i.monto) as monto
      from (
        select m.vida, m.concepto, m.moneda, m.monto
          from public.costos_neumatico m
         where m.neumatico_id = p_neumatico
        union all
        select x.vida_ev, case x.tipo when 'reparacion' then 'reparacion' when 'reencauche' then 'recauchutado'
                                      else 'otro' end, 'UYU', x.costo
          from ev x
         where x.costo is not null and x.tipo <> 'montaje'
        union all
        select v_base::smallint, 'compra', 'UYU', v_precio
         where v_precio is not null
           and not exists (select 1 from public.costos_neumatico m
                            where m.neumatico_id = p_neumatico and m.concepto = 'compra')
        union all
        select v_base::smallint, 'compra', 'UYU', max(x.costo)
          from ev x
         where v_precio is null and x.tipo = 'montaje' and x.costo is not null
           and not exists (select 1 from public.costos_neumatico m
                            where m.neumatico_id = p_neumatico and m.concepto = 'compra')
        having max(x.costo) is not null
      ) i
     group by i.vida, i.concepto, i.moneda
  ),
  cv as (
    select g.vida,
           count(*)::int as n_items,
           count(distinct g.moneda)::int as n_monedas,
           min(g.moneda) as moneda,
           sum(g.monto) as total
      from it g
     group by g.vida
  )
  select gs.vida::smallint,
         v_vida,
         nv.banda_marca,
         nv.banda_modelo,
         nv.profundidad_inicial_mm,
         nv.fecha,
         coalesce(cv.n_items, 0),
         coalesce(cv.n_monedas, 0),
         cv.moneda,
         cv.total,
         case when coalesce(kv.con, 0) = 0 and coalesce(kv.sin, 0) > 0 then null else coalesce(kv.km, 0) end,
         coalesce(kv.con, 0),
         coalesce(kv.sin, 0)
    from generate_series(v_base, v_vida) gs(vida)
    left join cv on cv.vida = gs.vida
    left join kv on kv.vida = gs.vida
    left join public.neumatico_vidas nv on nv.neumatico_id = p_neumatico and nv.vida = gs.vida
   order by gs.vida;
end
$$;
revoke all on function public.costo_vida_items(bigint) from public, anon;
grant execute on function public.costo_vida_items(bigint) to authenticated;

