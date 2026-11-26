-- F8 · Ola 2, brief 1 (base): ejes, umbrales de dirección y alertas con tipo (RN-02, RN-05, RN-06, RN-07, RN-31).
-- Requiere 20261126020000_odometro_motivos.sql (y sus antecesores).
-- Reemplaza definiciones vigentes de 20261126010000, 20261126000000, 20261125500000, 20261123000000 y 20261120500000.
-- Cada decisión (D1 a D8) está en el apéndice AB de docs/08, con los riesgos de despliegue.
-- Idempotente (el CI la aplica dos veces): sin begin/commit y search_path vacío en las SECURITY DEFINER.

-- 1. Ejes y rol de cada posición (CA-31). El catálogo da los ejes de adelante hacia atrás (S simple de 2 ruedas,
--    D doble de 4). El rol sale del eje: simple antes del primer doble es dirección, doble es tracción y simple después
--    es eje loco. La posición 99 es auxilio. Espejo de assets/js/domain/rol-eje.js (tests/unit/rol-eje-sql.test.mjs).
create or replace function public.distribucion_ejes(p_id text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case p_id
    when '4x2' then 'SD'
    when '6x2' then 'SDS'
    when '6x4' then 'SDD'
    when '8x2' then 'SSDS'
    when '8x4' then 'SSDD'
  end
$$;
revoke all on function public.distribucion_ejes(text) from public, anon;
grant execute on function public.distribucion_ejes(text) to authenticated, service_role;

create or replace function public.rol_eje_posicion(p_distribucion text, p_posicion integer)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  with ejes as (
    -- Ejes en orden, con las ruedas acumuladas hasta cada uno (S = 2, D = 4). Fuera del catálogo no hay ejes.
    select x.k, x.letra, sum(case x.letra when 'D' then 4 else 2 end) over (order by x.k) as hasta
      from (select g.k, substr(public.distribucion_ejes(p_distribucion), g.k, 1) as letra
              from generate_series(1, 4) as g(k)) x
     where x.letra in ('S', 'D')
  )
  select case
    when p_posicion = 99 then 'auxilio'
    -- Sin distribución del catálogo solo se sabe que 1 y 2 son el eje delantero (igual que rolEjePosicion).
    when not exists (select 1 from ejes) then case when p_posicion in (1, 2) then 'direccion' end
    else (select case when e.letra = 'D' then 'traccion'
                      when e.k < (select min(d.k) from ejes d where d.letra = 'D') then 'direccion'
                      else 'loco' end
            from ejes e
           where p_posicion between 1 and e.hasta
           order by e.k
           limit 1)
  end
$$;
revoke all on function public.rol_eje_posicion(text, integer) from public, anon;
grant execute on function public.rol_eje_posicion(text, integer) to authenticated, service_role;

-- 2. Umbrales de dirección, km del swap y revisión por km (D8, D1, D4). Dirección: aviso 8 mm y límite 6 mm para la
--    rueda del eje de dirección. Swap: km a los que se pide el cambio (20.000 por defecto). km_por_mm_revision nulo
--    apaga el tipo km_por_mm (D4: no se evalúa en esta ola).
alter table public.clientes
  add column if not exists direccion_aviso_mm numeric(4,1) not null default 8,
  add column if not exists direccion_limite_mm numeric(4,1) not null default 6,
  add column if not exists swap_km integer not null default 20000,
  add column if not exists km_por_mm_revision integer;
-- Privilegios por columna: t_96 exige que toda columna nueva de clientes se otorgue a propósito. Son configuración,
-- no sensibles: v_estado_neumaticos las lee con security_invoker. authenticated no las escribe; las cambia alerta_configurar.
grant select (direccion_aviso_mm, direccion_limite_mm, swap_km, km_por_mm_revision) on public.clientes to authenticated;
alter table public.clientes drop constraint if exists clientes_direccion_umbrales_ck;
alter table public.clientes add constraint clientes_direccion_umbrales_ck
  check (0 < direccion_limite_mm and direccion_limite_mm < direccion_aviso_mm and direccion_aviso_mm <= 99.9);
alter table public.clientes drop constraint if exists clientes_swap_km_ck;
alter table public.clientes add constraint clientes_swap_km_ck check (swap_km between 1000 and 200000);
alter table public.clientes drop constraint if exists clientes_km_por_mm_ck;
alter table public.clientes add constraint clientes_km_por_mm_ck
  check (km_por_mm_revision is null or km_por_mm_revision > 0);

-- 3. Servicio del vehículo (D5): camión o bus. Lo fija el administrador con la RPC, con el mismo permiso que la
--    distribución (neumatico_autorizar_vehiculo). Vacío o nulo deja el servicio sin definir.
alter table public.vehiculos add column if not exists servicio text;
alter table public.vehiculos drop constraint if exists vehiculos_servicio_ck;
alter table public.vehiculos add constraint vehiculos_servicio_ck
  check (servicio is null or servicio in ('camion', 'bus'));

create or replace function public.vehiculo_fijar_servicio(p_vehiculo_id bigint, p_servicio text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_aut      record;
  v_servicio text := lower(nullif(btrim(coalesce(p_servicio, '')), ''));
begin
  -- 42501 si el vehículo no es del usuario. Va antes que el catálogo: a quien no puede tocarlo no se le revela nada.
  select * into v_aut from public.neumatico_autorizar_vehiculo(p_vehiculo_id);
  if v_servicio is not null and v_servicio not in ('camion', 'bus') then
    raise exception 'servicio fuera de catálogo' using errcode = '23514';
  end if;
  update public.vehiculos v set servicio = v_servicio where v.id = p_vehiculo_id;
end;
$$;
revoke all on function public.vehiculo_fijar_servicio(bigint, text) from public, anon;
grant execute on function public.vehiculo_fijar_servicio(bigint, text) to authenticated;

-- Base: copia de 20261126010000_auxilio_tramos_km.sql:224-386. La ola 2 agrega columnas al final y cambia desgaste_irregular.
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
    -- RN-06 y D7: la diferencia se redondea a 0,1 mm, como en el panel, y el umbral incluye el valor (>=).
    coalesce(round(greatest(s.mm1, s.mm2, s.mm3) - least(s.mm1, s.mm2, s.mm3), 1) >= s.irregularidad_mm, false)
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
-- Dirección (D3, RN-07): solo en el eje de dirección, con huella medida y no bajo el retiro (RN-08: bajo el retiro
-- manda la roja). El límite se mira antes que el aviso, porque el rango del aviso incluye al límite.
select y.*,
  case when y.rol_eje = 'direccion' and y.minimo >= y.umbral_retiro_mm then
         case when y.minimo < y.direccion_limite_mm then 'direccion_limite'
              when y.minimo <= y.direccion_aviso_mm then 'direccion_aviso' end
  end as estado_direccion
from (
  select b.*,
    case when b.tasa_mm_semana > 0 and b.promedio is not null
         then round(greatest(b.promedio - b.umbral_critico_mm, 0) / b.tasa_mm_semana, 2) end as semanas_hasta_critico,
    case when b.tasa_mm_semana > 0 and b.promedio is not null
         then round(greatest(b.promedio - b.umbral_retiro_mm, 0) / b.tasa_mm_semana, 2) end as semanas_hasta_retiro,
    -- Huella mínima (RN-01). NULL si falta cualquiera de las tres: least() ignora nulos y daría un mínimo falso.
    case when b.mm1 is null or b.mm2 is null or b.mm3 is null then null
         else least(b.mm1, b.mm2, b.mm3) end as minimo,
    -- Columnas nuevas al final: distribución y servicio del vehículo, rol del eje y umbrales de dirección del cliente.
    vh.distribucion, vh.servicio,
    public.rol_eje_posicion(vh.distribucion, b.posicion) as rol_eje,
    cl.direccion_aviso_mm, cl.direccion_limite_mm
  from b
  left join public.vehiculos vh on vh.id = b.vehiculo_id
  left join public.clientes cl on cl.id = b.cliente_id
) y;

revoke all on public.v_estado_neumaticos from public, anon;
grant select on public.v_estado_neumaticos to authenticated;

-- Copia de 20261126000000_huella_minima.sql:190-290
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

-- Copia de 20261126010000_auxilio_tramos_km.sql:40-138
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

-- Base: copia de 20261120500000_cerrar_escrituras_neumet.sql:242-337. La ola 2 agrega dirección y swap, con firma nueva.
-- create or replace no cambia una firma: hay que quitar la de ocho argumentos. Los tres parámetros nuevos van al final y
-- nulos = no cambiar, así el panel actual sigue funcionando hasta que se fusione el Brief 2.
drop function if exists public.alerta_configurar(bigint, numeric, numeric, numeric, numeric, integer, numeric, numeric);
create or replace function public.alerta_configurar(p_cliente_id bigint, p_umbral_critico_mm numeric DEFAULT NULL::numeric, p_histeresis_mm numeric DEFAULT NULL::numeric, p_umbral_bajo_mm numeric DEFAULT NULL::numeric, p_umbral_retiro_mm numeric DEFAULT NULL::numeric, p_dias_sin_medir integer DEFAULT NULL::integer, p_irregularidad_mm numeric DEFAULT NULL::numeric, p_huella_absurda_mm numeric DEFAULT NULL::numeric, p_direccion_aviso_mm numeric DEFAULT NULL::numeric, p_direccion_limite_mm numeric DEFAULT NULL::numeric, p_swap_km integer DEFAULT NULL::integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
declare
  v_uid      uuid := auth.uid();
  v_cli_id   bigint;
  v_c        public.clientes%rowtype;
  v_bajo     numeric;
  v_critico  numeric;
  v_retiro   numeric;
  v_abiertas bigint;
  v_da       numeric;
  v_dl       numeric;
begin
  if v_uid is null then
    raise exception 'permiso denegado' using errcode = '42501';
  end if;
  v_cli_id := public.admin_empresa_cliente_id();
  if v_cli_id is null or (p_cliente_id is not null and p_cliente_id <> v_cli_id) then
    raise exception 'permiso denegado' using errcode = '42501';
  end if;

  select * into v_c from public.clientes c where c.id = v_cli_id and c.deleted_at is null for update;
  if not found then
    raise exception 'permiso denegado' using errcode = '42501';
  end if;

  if p_umbral_critico_mm is null and p_histeresis_mm is null and p_umbral_bajo_mm is null and p_umbral_retiro_mm is null
     and p_dias_sin_medir is null and p_irregularidad_mm is null and p_huella_absurda_mm is null
     and p_direccion_aviso_mm is null and p_direccion_limite_mm is null and p_swap_km is null then
    raise exception 'parámetros obligatorios' using errcode = '22004';
  end if;

  -- Milímetros: un decimal, mayor que 0 y hasta 99,9 (igual que el panel, assets/js/domain/umbrales.js)
  if p_umbral_critico_mm is not null and (p_umbral_critico_mm <> round(p_umbral_critico_mm, 1)) then
    raise exception 'el umbral admite un decimal' using errcode = '22023';
  end if;
  if p_umbral_bajo_mm is not null and (p_umbral_bajo_mm <> round(p_umbral_bajo_mm, 1)) then
    raise exception 'el umbral admite un decimal' using errcode = '22023';
  end if;
  if p_umbral_retiro_mm is not null and (p_umbral_retiro_mm <> round(p_umbral_retiro_mm, 1)) then
    raise exception 'el umbral admite un decimal' using errcode = '22023';
  end if;
  if p_irregularidad_mm is not null and (p_irregularidad_mm <> round(p_irregularidad_mm, 1)) then
    raise exception 'la irregularidad admite un decimal' using errcode = '22023';
  end if;
  if p_huella_absurda_mm is not null and (p_huella_absurda_mm <> round(p_huella_absurda_mm, 1)) then
    raise exception 'la huella admite un decimal' using errcode = '22023';
  end if;
  if (p_umbral_bajo_mm is not null and (p_umbral_bajo_mm <= 0 or p_umbral_bajo_mm > 99.9))
     or (p_umbral_retiro_mm is not null and (p_umbral_retiro_mm <= 0 or p_umbral_retiro_mm > 99.9))
     or (p_umbral_critico_mm is not null and (p_umbral_critico_mm <= 0 or p_umbral_critico_mm > 99.9)) then
    raise exception 'los umbrales van de 0,1 a 99,9 mm' using errcode = '23514';
  end if;
  if p_irregularidad_mm is not null and (p_irregularidad_mm <= 0 or p_irregularidad_mm > 99.9) then
    raise exception 'la irregularidad va de 0,1 a 99,9 mm' using errcode = '23514';
  end if;
  if p_huella_absurda_mm is not null and (p_huella_absurda_mm <= 0 or p_huella_absurda_mm > 40) then
    raise exception 'la huella absurda va de 0,1 a 40 mm' using errcode = '23514';
  end if;
  if p_dias_sin_medir is not null and (p_dias_sin_medir < 1 or p_dias_sin_medir > 3650) then
    raise exception 'los días sin medir van de 1 a 3650' using errcode = '23514';
  end if;
  if p_histeresis_mm is not null then
    if p_histeresis_mm <> round(p_histeresis_mm, 1) or p_histeresis_mm < 0 or p_histeresis_mm > 3 then
      raise exception 'la histéresis va de 0 a 3 mm, con un decimal' using errcode = '23514';
    end if;
  end if;

  -- Dirección (D8) y swap (D1). El check de clientes es la última barrera; estos mensajes son los que ve el operario.
  if p_direccion_aviso_mm is not null and p_direccion_aviso_mm <> round(p_direccion_aviso_mm, 1)
     or p_direccion_limite_mm is not null and p_direccion_limite_mm <> round(p_direccion_limite_mm, 1) then
    raise exception 'los umbrales de dirección admiten un decimal' using errcode = '22023';
  end if;
  if (p_direccion_aviso_mm is not null and (p_direccion_aviso_mm <= 0 or p_direccion_aviso_mm > 99.9))
     or (p_direccion_limite_mm is not null and (p_direccion_limite_mm <= 0 or p_direccion_limite_mm > 99.9)) then
    raise exception 'los umbrales de dirección van de 0,1 a 99,9 mm' using errcode = '23514';
  end if;
  if p_swap_km is not null and (p_swap_km < 1000 or p_swap_km > 200000) then
    raise exception 'el swap va de 1.000 a 200.000 km' using errcode = '23514';
  end if;
  v_bajo    := coalesce(p_umbral_bajo_mm,    v_c.umbral_bajo_mm);
  v_critico := coalesce(p_umbral_critico_mm, v_c.umbral_critico_mm);
  v_retiro  := coalesce(p_umbral_retiro_mm,  v_c.umbral_retiro_mm);
  if not (v_retiro < v_critico and v_critico < v_bajo) then
    raise exception 'el nivel crítico debe quedar entre el de retiro (% mm) y el de desgaste bajo (% mm)', v_retiro, v_bajo
      using errcode = '23514';
  end if;

  -- El límite de dirección debe quedar bajo el aviso (D8). No se cruza con el retiro.
  v_da := coalesce(p_direccion_aviso_mm, v_c.direccion_aviso_mm);
  v_dl := coalesce(p_direccion_limite_mm, v_c.direccion_limite_mm);
  if not (v_dl < v_da) then
    raise exception 'el límite de dirección (% mm) debe quedar bajo el aviso (% mm)', v_dl, v_da using errcode = '23514';
  end if;

  update public.clientes c
     set umbral_bajo_mm        = v_bajo,
         umbral_critico_mm     = v_critico,
         umbral_retiro_mm      = v_retiro,
         dias_sin_medir_alerta = coalesce(p_dias_sin_medir, c.dias_sin_medir_alerta),
         irregularidad_mm      = coalesce(p_irregularidad_mm, c.irregularidad_mm),
         alerta_histeresis_mm  = coalesce(p_histeresis_mm, c.alerta_histeresis_mm),
         huella_absurda_mm     = coalesce(p_huella_absurda_mm, c.huella_absurda_mm),
         direccion_aviso_mm    = v_da,
         direccion_limite_mm   = v_dl,
         swap_km               = coalesce(p_swap_km, c.swap_km)
   where c.id = v_c.id;

  select count(*) into v_abiertas from public.alertas a where a.cliente_id = v_c.id and a.estado <> 'resuelta';
  select * into v_c from public.clientes c where c.id = v_c.id;
  return jsonb_build_object('cliente_id', v_c.id, 'umbral_critico_mm', v_c.umbral_critico_mm,
                            'histeresis_mm', v_c.alerta_histeresis_mm, 'umbral_bajo_mm', v_c.umbral_bajo_mm,
                            'umbral_retiro_mm', v_c.umbral_retiro_mm, 'dias_sin_medir_alerta', v_c.dias_sin_medir_alerta,
                            'irregularidad_mm', v_c.irregularidad_mm, 'huella_absurda_mm', v_c.huella_absurda_mm,
                            'direccion_aviso_mm', v_c.direccion_aviso_mm, 'direccion_limite_mm', v_c.direccion_limite_mm,
                            'swap_km', v_c.swap_km,
                            'alertas_abiertas', v_abiertas);
end
$$;

revoke all on function public.alerta_configurar(bigint, numeric, numeric, numeric, numeric, integer, numeric, numeric, numeric, numeric, integer) from public, anon;
grant execute on function public.alerta_configurar(bigint, numeric, numeric, numeric, numeric, integer, numeric, numeric, numeric, numeric, integer) to authenticated;

-- Copia de 20261125500000_auxilio_sin_alerta.sql:149-193
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
                                  and s.posicion = 99
                             then 'poco_desgaste' else s.estado end as estado
                   from public.v_estado_neumaticos s) s
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

-- Copia de 20261125500000_auxilio_sin_alerta.sql:128-146
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
  -- El auxilio (la rueda en la posición 99) no genera advertencias; manda la posición actual del neumático.
  and coalesce(n.posicion, a.posicion) is distinct from 99;

revoke all on public.v_alertas from public, anon;
grant select on public.v_alertas to authenticated;
