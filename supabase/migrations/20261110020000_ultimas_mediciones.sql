-- =============================================================================
-- NEUMET · Inicio: últimas mediciones por vehículo, con la medición anterior de cada neumático
-- =============================================================================
-- Requiere 20261106000000_init_schema.sql y 20261109000000_mediciones_por_neumatico.sql
-- (índice mediciones_idneumatico_idx). Sin begin/commit: la herramienta que aplica la migración ya la envuelve.
-- Idempotente (create index if not exists + create or replace + revoke/grant).
--
-- Una "visita" es el conjunto de mediciones del mismo vehículo en el mismo día calendario (hora de Montevideo):
-- los medidores envían una fila por neumático y la agrupación por día no depende de que el proveedor
-- informe sesion_id.
--
-- ultimas_mediciones(p_limite, p_sucursal) devuelve, para los p_limite vehículos medidos más recientemente,
-- una fila por posición de su última visita: mm de esa visita (promedio) y, si ese mismo neumático
-- (idneumatico) se midió antes de esa visita, los mm y la fecha de la medición anterior. Un neumático nuevo
-- o sin idneumatico no tiene medición anterior (mm_antes NULL): no hereda nada de la posición.
--
-- SECURITY INVOKER: las políticas RLS de vehiculos y mediciones deciden qué ve cada rol (cliente global,
-- seccional, admin). p_sucursal solo estrecha el resultado al selector de seccional del panel.
--
-- Costo: un sondeo por vehículo a (vehiculo_id, created_at desc), la visita de los 8 elegidos por rango sobre el
-- mismo índice y un sondeo por neumático a mediciones_idneumatico_idx; no recorre la tabla de mediciones.
-- =============================================================================

-- Última medición de un vehículo y mediciones de su visita (rango por fecha).
create index if not exists mediciones_vehiculo_fecha_idx
  on public.mediciones (vehiculo_id, created_at desc) where vehiculo_id is not null;

create or replace function public.ultimas_mediciones(p_limite integer default 8, p_sucursal bigint default null)
returns table (
  vehiculo_id  bigint,
  nombre       text,
  patente      text,
  numero       text,
  medido_at    timestamptz,   -- última medición de la visita
  posicion     smallint,
  idneumatico  text,
  mm_ahora     numeric,
  mm_antes     numeric,       -- NULL: sin medición previa de ese neumático
  antes_at     timestamptz
)
language sql
stable
security invoker
set search_path = ''
as $$
  with veh as (
    select v.id, v.nombre, v.patente, v.numero, ult.created_at as ultima,
           (date_trunc('day', ult.created_at at time zone 'America/Montevideo') at time zone 'America/Montevideo') as desde
      from public.vehiculos v
      cross join lateral (
        select m.created_at from public.mediciones m
         where m.vehiculo_id = v.id order by m.created_at desc limit 1
      ) ult
     where v.activo and (p_sucursal is null or v.sucursal_id = p_sucursal)
     order by ult.created_at desc, v.id
     limit least(greatest(coalesce(p_limite, 8), 1), 50)
  )
  select veh.id, veh.nombre, veh.patente, veh.numero, veh.ultima,
         a.posicion, a.idneumatico, a.promedio, pr.promedio, pr.created_at
    from veh
    cross join lateral (
      select distinct on (m.posicion) m.posicion, m.idneumatico, m.promedio
        from public.mediciones m
       where m.vehiculo_id = veh.id and m.created_at >= veh.desde
       order by m.posicion, m.created_at desc
    ) a
    left join lateral (
      select p.promedio, p.created_at from public.mediciones p
       where a.idneumatico is not null and p.idneumatico = a.idneumatico and p.created_at < veh.desde
       order by p.created_at desc limit 1
    ) pr on true
   order by veh.ultima desc, veh.id, a.posicion;
$$;

revoke all on function public.ultimas_mediciones(integer, bigint) from public, anon;
grant execute on function public.ultimas_mediciones(integer, bigint) to authenticated;
