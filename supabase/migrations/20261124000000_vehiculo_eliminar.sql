-- Eliminar un vehículo (baja lógica) · apéndice U de docs/08.
-- Idempotente (el CI la aplica dos veces). Sin begin/commit.
--
-- Por qué baja lógica y no DELETE físico: eventos_neumatico.vehiculo_id es RESTRICT (el historial de los neumáticos es
-- auditoría) y mediciones/alertas se perderían con CASCADE/SET NULL. El vehículo queda con `deleted_at`, sin
-- patente ni número (se guardan en patente_baja/numero_baja) para poder reutilizarlos, y sin sucursal para no trabar
-- la baja de la sucursal. La RLS de `vehiculos` lo oculta a todos los perfiles, así que las vistas, los embebidos y las
-- subconsultas de otras políticas dejan de verlo sin tocarlas una por una.
--
-- Qué queda visible tras eliminar (decisión: historial de auditoría; no se filtra cada tabla):
--   * Vehículo: nadie lo ve (RLS de `vehiculos`), tampoco el equipo Neumet.
--   * Neumáticos dados de baja con el vehículo (conservan vehiculo_id): el perfil global de la empresa no los ve (su
--     política los une a `vehiculos`); el equipo Neumet SÍ ve la fila, sus mediciones y eventos (política is_admin sin join).
--     Sus precios, costos y km no se sirven a nadie: neumaticos_precios, costo_cubierta_items, costo_vida_items y
--     km_tramos_cubierta los descartan (más abajo).
--   * Los que volvieron al stock se ven en el stock, con su historial.
--   * Mediciones, eventos y alertas del vehículo eliminado siguen legibles para el perfil global de la empresa y para el
--     equipo Neumet (historial de auditoría); el perfil de sucursal no los ve (su política los une a `vehiculos`).
--
-- Autoriza SOLO al administrador de empresa (admin_empresa_cliente_id): el equipo Neumet es de solo lectura (C2),
-- y los perfiles de sucursal, sin perfil o `api` reciben 42501 uniforme.

-- -----------------------------------------------------------------------------
-- 1. Columnas
-- -----------------------------------------------------------------------------
alter table public.vehiculos add column if not exists deleted_at   timestamptz;
alter table public.vehiculos add column if not exists deleted_by   uuid;
alter table public.vehiculos add column if not exists patente_baja text;
alter table public.vehiculos add column if not exists numero_baja  text;

-- -----------------------------------------------------------------------------
-- 2. RLS: un vehículo eliminado no lo ve nadie (ni el equipo Neumet)
-- -----------------------------------------------------------------------------
drop policy if exists vehiculos_cliente_select on public.vehiculos;
create policy vehiculos_cliente_select on public.vehiculos for select to authenticated
  using (deleted_at is null
         and cliente_id = (select public.current_cliente_id())
         and ((select public.current_sucursal_id()) is null or sucursal_id = (select public.current_sucursal_id())));

drop policy if exists vehiculos_admin_select on public.vehiculos;
create policy vehiculos_admin_select on public.vehiculos for select to authenticated
  using (deleted_at is null and (select public.is_admin()));

-- -----------------------------------------------------------------------------
-- 3. Funciones SECURITY DEFINER que leen el vehículo por id (la RLS no las alcanza)
-- -----------------------------------------------------------------------------
create or replace function public.neumatico_autorizar_vehiculo(p_vehiculo_id bigint)
 returns table(cliente_id bigint, es_admin boolean, es_global boolean)
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_uid  uuid := auth.uid();
  v_veh  public.vehiculos%rowtype;
  v_perf public.perfiles%rowtype;
begin
  if v_uid is null then
    raise exception 'permiso denegado' using errcode = '42501';
  end if;
  if p_vehiculo_id is null then
    raise exception 'parámetros obligatorios' using errcode = '22004';
  end if;

  select * into v_perf from public.perfiles p where p.user_id = v_uid and p.rol = 'cliente';
  if not found or v_perf.cliente_id is null then
    raise exception 'permiso denegado' using errcode = '42501';
  end if;

  select * into v_veh from public.vehiculos v
   where v.id = p_vehiculo_id
     and v.deleted_at is null
     and v.cliente_id = v_perf.cliente_id
     and (v_perf.sucursal_id is null or v.sucursal_id = v_perf.sucursal_id)
     and exists (select 1 from public.clientes c where c.id = v.cliente_id and c.deleted_at is null)
     for update of v;
  if not found then
    raise exception 'permiso denegado' using errcode = '42501';
  end if;
  return query select v_veh.cliente_id, false, (v_perf.sucursal_id is null);
end
$function$;

create or replace function public.vehiculo_corregir_odometro(p_vehiculo_id bigint, p_odometro_km integer)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_cli bigint;
  v_veh public.vehiculos%rowtype;
begin
  if auth.uid() is null then
    raise exception 'permiso denegado' using errcode = '42501';
  end if;
  v_cli := public.admin_empresa_cliente_id();
  if v_cli is null then
    raise exception 'permiso denegado' using errcode = '42501';
  end if;
  if p_vehiculo_id is null or p_odometro_km is null then
    raise exception 'parámetros obligatorios' using errcode = '22004';
  end if;
  select * into v_veh from public.vehiculos v
   where v.id = p_vehiculo_id and v.cliente_id = v_cli and v.deleted_at is null
     and exists (select 1 from public.clientes c where c.id = v.cliente_id and c.deleted_at is null)
   for update of v;
  if not found then
    raise exception 'permiso denegado' using errcode = '42501';
  end if;
  if p_odometro_km < 0 then
    raise exception 'odómetro negativo' using errcode = '23514';
  end if;
  if v_veh.odometro_km is null or p_odometro_km > v_veh.odometro_km then
    raise exception 'la corrección solo baja el kilometraje: para subirlo se registra el odómetro' using errcode = '23514';
  end if;
  update public.vehiculos v set odometro_km = p_odometro_km, odometro_actualizado_at = now() where v.id = v_veh.id;
  return jsonb_build_object('vehiculo_id', v_veh.id, 'odometro_km', p_odometro_km, 'anterior', v_veh.odometro_km);
end
$function$;

-- Las tres funciones de costos/km (SECURITY DEFINER) leían la cubierta sin pasar por la RLS: se recrean idénticas salvo
-- el descarte inicial de los neumáticos de un vehículo eliminado.
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
    -- Un neumático dado de baja con un vehículo eliminado no se lee por esta vía (ni para el equipo Neumet).
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

create or replace function public.costo_cubierta_items(p_neumatico bigint)
returns table (
  n_items       integer,
  n_monedas     integer,
  moneda        text,
  monedas       text[],
  total         numeric,
  por_concepto  jsonb,
  marca         text,
  modelo        text,
  vida          smallint,
  condicion     text,
  fecha_alta    date,
  sucursal_id   bigint
)
language plpgsql
stable
security definer
set search_path = ''
rows 1
as $$
declare
  v_precio numeric;
  v_marca  text;
  v_modelo text;
  v_vida   smallint;
  v_cond   text;
  v_alta   date;
  v_suc    bigint;
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
      -- Perfil global: la cubierta debe estar en un vehículo de su cliente o en su stock.
      perform 1 from public.neumaticos n
        left join public.vehiculos v on v.id = n.vehiculo_id
       where n.id = p_neumatico
         and ((v.id is not null and v.cliente_id = v_cli) or (n.vehiculo_id is null and n.cliente_id = v_cli));
      if not found then
        return;
      end if;
    end if;
  end if;

  -- Datos de la cubierta (la vista no vuelve a unirse a neumaticos: evita repetir la RLS por fila).
  select n.precio_unidad, n.marca, n.modelo, n.vida, n.condicion, coalesce(n.fecha_compra, n.created_at::date),
         coalesce(v.sucursal_id, n.sucursal_id)
    into v_precio, v_marca, v_modelo, v_vida, v_cond, v_alta, v_suc
    from public.neumaticos n
    left join public.vehiculos v on v.id = n.vehiculo_id
   where n.id = p_neumatico;
  if not found then
    return;
  end if;

  return query
  select a.n_items, a.n_monedas, a.moneda, a.monedas, a.total, a.por_concepto,
         v_marca, v_modelo, v_vida, v_cond, v_alta, v_suc
  from (
  select
    count(*)::int as n_items,
    count(distinct g.moneda)::int as n_monedas,
    min(g.moneda) as moneda,
    array_agg(distinct g.moneda) as monedas,
    sum(g.monto) as total,
    jsonb_object_agg(g.concepto, g.monto) as por_concepto
  from (
    select i.concepto, i.moneda, sum(i.monto) as monto
    from (
      -- Entradas manuales
      select m.concepto, m.moneda, m.monto
        from public.costos_neumatico m
       where m.neumatico_id = p_neumatico
      union all
      -- Eventos con costo que no son el montaje (el montaje repite el precio de compra)
      select case e.tipo when 'reparacion' then 'reparacion' when 'reencauche' then 'recauchutado' else 'otro' end,
             'UYU', e.costo
        from public.eventos_neumatico e
       where e.neumatico_id = p_neumatico and e.costo is not null and e.tipo <> 'montaje'
      union all
      -- Compra: precio_unidad, salvo que una entrada manual 'compra' la corrija
      select 'compra', 'UYU', v_precio
       where v_precio is not null
         and not exists (select 1 from public.costos_neumatico m
                          where m.neumatico_id = p_neumatico and m.concepto = 'compra')
      union all
      -- Compra sin precio_unidad: el costo del evento de montaje (una sola vez)
      select 'compra', 'UYU', max(e.costo)
        from public.eventos_neumatico e
       where v_precio is null and e.neumatico_id = p_neumatico
         and e.tipo = 'montaje' and e.costo is not null
         and not exists (select 1 from public.costos_neumatico m
                          where m.neumatico_id = p_neumatico and m.concepto = 'compra')
      having max(e.costo) is not null
    ) i
    group by i.concepto, i.moneda
  ) g
  ) a;
end
$$;
revoke all on function public.costo_cubierta_items(bigint) from public, anon;
grant execute on function public.costo_cubierta_items(bigint) to authenticated;

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

  select n.precio_unidad, n.vida, n.estado, n.vehiculo_id, v.odometro_km
    into v_precio, v_vida, v_estado, v_veh, v_odo
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
    select e.id, e.created_at, e.tipo, e.vehiculo_id, e.odometro_km, e.costo,
           least(v_base + (count(*) filter (where e.tipo = 'reencauche') over (order by e.created_at, e.id))::int, 3)::smallint as vida_ev
      from public.eventos_neumatico e
     where e.neumatico_id = p_neumatico
  ),
  seq as (
    select s.vida_ev, s.tipo, s.vehiculo_id, s.odometro_km,
           lead(s.tipo)        over w as sig_tipo,
           lead(s.vehiculo_id) over w as sig_veh,
           lead(s.odometro_km) over w as sig_odo
      from ev s
     where s.vehiculo_id is not null and s.tipo in ('montaje', 'desmontaje', 'baja')
    window w as (order by s.created_at, s.id)
  ),
  tr as (
    select s.vida_ev as vida,
           case
             when s.sig_tipo in ('desmontaje', 'baja')
               then (s.sig_veh = s.vehiculo_id and s.odometro_km is not null and s.sig_odo is not null
                     and s.sig_odo >= s.odometro_km)
             when s.sig_tipo is null
               then (v_estado = 'montado' and v_veh = s.vehiculo_id and s.odometro_km is not null and v_odo is not null)
             else false end as conocido,
           case
             when s.sig_tipo in ('desmontaje', 'baja') then s.sig_odo - s.odometro_km
             when s.sig_tipo is null then greatest(v_odo - s.odometro_km, 0)
           end as km
      from seq s
     where s.tipo = 'montaje'
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


-- Los precios de los neumáticos que quedaron dados de baja con un vehículo eliminado dejan de ser visibles,
-- igual que las filas (la RLS de neumaticos ya los oculta).
create or replace function public.neumaticos_precios(p_vehiculo bigint default null::bigint, p_solo_stock boolean default false)
 returns table(id bigint, precio_unidad numeric)
 language sql
 stable security definer
 set search_path to ''
as $function$
  select n.id, n.precio_unidad
  from public.neumaticos n
  where n.precio_unidad is not null
    and (select public.precios_visibles())
    and (p_vehiculo is null or n.vehiculo_id = p_vehiculo)
    and (not coalesce(p_solo_stock, false) or n.vehiculo_id is null)
    -- El neumático de un vehículo eliminado no se lista para nadie (tampoco para el equipo Neumet).
    and (n.vehiculo_id is null
         or exists (select 1 from public.vehiculos vd where vd.id = n.vehiculo_id and vd.deleted_at is null))
    and ((select public.is_admin())
         or ((select public.current_cliente_id()) is not null
             and ((n.vehiculo_id is null and n.cliente_id = (select public.current_cliente_id()))
                  or exists (select 1 from public.vehiculos v
                             where v.id = n.vehiculo_id
                               and v.cliente_id = (select public.current_cliente_id())))))
  order by n.id
$function$;

-- -----------------------------------------------------------------------------
-- 4. RPC vehiculo_eliminar
-- -----------------------------------------------------------------------------
-- p_destino_neumaticos: 'stock' (vuelven al stock del cliente, en la sucursal del vehículo, conservando condición, quema,
-- mediciones y eventos) o 'baja' (quedan dados de baja con el vehículo). Obligatorio si el vehículo tiene neumáticos que
-- no estén ya dados de baja; sin neumáticos se ignora. Todo ocurre en una sola transacción: si algo falla, no se guarda nada.
create or replace function public.vehiculo_eliminar(p_vehiculo_id bigint, p_destino_neumaticos text default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_cli     bigint;
  v_veh     public.vehiculos%rowtype;
  v_destino text := lower(nullif(btrim(coalesce(p_destino_neumaticos, '')), ''));
  v_n       public.neumaticos%rowtype;
  v_total   integer := 0;
  v_sin_q   integer;
  v_motivo  constant text := 'Baja del vehículo';
begin
  if auth.uid() is null then
    raise exception 'permiso denegado' using errcode = '42501';
  end if;
  v_cli := public.admin_empresa_cliente_id();
  if v_cli is null then
    raise exception 'permiso denegado' using errcode = '42501';
  end if;
  if p_vehiculo_id is null then
    raise exception 'parámetros obligatorios' using errcode = '22004';
  end if;
  if v_destino is not null and v_destino not in ('stock', 'baja') then
    raise exception 'destino de los neumáticos no válido: usar stock o baja' using errcode = '22023';
  end if;

  -- Bloquea el vehículo: dos eliminaciones simultáneas se serializan y la segunda ve `deleted_at`.
  select * into v_veh from public.vehiculos v
   where v.id = p_vehiculo_id and v.cliente_id = v_cli
   for update of v;
  if not found then
    raise exception 'permiso denegado' using errcode = '42501';
  end if;
  if v_veh.deleted_at is not null then
    raise exception 'el vehículo ya fue eliminado' using errcode = 'P0002';
  end if;

  -- Bloquea los neumáticos ANTES de contarlos: un recauchutado_enviar concurrente no puede cambiar el conjunto entre
  -- el conteo y la actualización.
  perform 1 from public.neumaticos n
   where n.vehiculo_id = v_veh.id and n.estado <> 'baja'
   order by n.id for update;

  select count(*) into v_total from public.neumaticos n
   where n.vehiculo_id = v_veh.id and n.estado <> 'baja';

  if v_total > 0 then
    if v_destino is null then
      raise exception 'elegir qué hacer con los neumáticos: enviarlos al stock o darlos de baja' using errcode = '22023';
    end if;
    if v_destino = 'stock' then
      select count(*) into v_sin_q from public.neumaticos n
       where n.vehiculo_id = v_veh.id and n.estado <> 'baja' and n.numero_quema is null;
      if v_sin_q > 0 then
        -- La quema identifica a la cubierta física y el stock exige tenerla (como al retirar un neumático al stock).
        raise exception '% neumático(s) sin número de quema no pueden ir al stock: darlos de baja o completar la quema antes', v_sin_q
          using errcode = '22023';
      end if;
    end if;

    for v_n in select * from public.neumaticos n
                where n.vehiculo_id = v_veh.id and n.estado <> 'baja'
                order by n.id for update
    loop
      if v_destino = 'stock' then
        update public.neumaticos
           set vehiculo_id = null, posicion = null, auxilio = false, estado = 'almacenado',
               sucursal_id = v_veh.sucursal_id
         where id = v_n.id;
        insert into public.eventos_neumatico
          (cliente_id, vehiculo_id, neumatico_id, idneumatico, tipo, posicion_origen,
           sucursal_destino_id, notas, created_by)
        values (v_cli, v_veh.id, v_n.id, v_n.idneumatico, 'desmontaje', v_n.posicion,
                v_veh.sucursal_id, 'Vehículo eliminado · vuelve al stock', auth.uid());
      else
        update public.neumaticos
           set auxilio = false, estado = 'baja', fecha_baja = current_date, motivo_baja = v_motivo
         where id = v_n.id;
        insert into public.eventos_neumatico
          (cliente_id, vehiculo_id, neumatico_id, idneumatico, tipo, posicion_origen, notas, created_by)
        values (v_cli, v_veh.id, v_n.id, v_n.idneumatico, 'baja', v_n.posicion,
                'Vehículo eliminado · ' || v_motivo, auth.uid());
      end if;
    end loop;
  end if;

  update public.vehiculos v
     set deleted_at = now(), deleted_by = auth.uid(), activo = false,
         patente_baja = v_veh.patente, numero_baja = v_veh.numero,
         patente = null, numero = null, sucursal_id = null
   where v.id = v_veh.id;

  return jsonb_build_object(
    'vehiculo_id', v_veh.id,
    'neumaticos', v_total,
    'destino', case when v_total > 0 then v_destino else null end);
end
$function$;

revoke all on function public.vehiculo_eliminar(bigint, text) from public, anon;
grant execute on function public.vehiculo_eliminar(bigint, text) to authenticated;
