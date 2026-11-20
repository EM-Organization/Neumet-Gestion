-- Neumáticos dados de baja SIN vehículo (descartes de una carga inicial, issue #137).
-- Depende de 20261113000000_stock_cubiertas (neumaticos_stock_ck) y 20261124000000_vehiculo_eliminar (neumaticos_precios).
-- Decisión: una baja sin vehículo es historial, no stock: exige fecha_baja y motivo_baja y no cuenta como inventario
-- (los listados de stock filtran estado = 'almacenado'; aquí, neumaticos_precios con p_solo_stock).

alter table public.neumaticos drop constraint if exists neumaticos_stock_ck;
alter table public.neumaticos add constraint neumaticos_stock_ck check (
  ((vehiculo_id is null) = (posicion is null))
  and (vehiculo_id is not null
       or (not auxilio
           and (estado = 'almacenado'
                or (estado = 'baja' and fecha_baja is not null and nullif(btrim(motivo_baja), '') is not null))))
  and (sucursal_id is null or vehiculo_id is null)
  and (condicion <> 'nuevo' or vehiculo_id is null)
);

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
    and (not coalesce(p_solo_stock, false) or (n.vehiculo_id is null and n.estado = 'almacenado'))
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
-- Autorización del stock: una baja sin vehículo (historial) no es una cubierta del stock.
-- -----------------------------------------------------------------------------
-- Antes solo se rechazaba la cubierta montada; con bajas sin vehículo, editar/mover/eliminar las habrían aceptado.
-- Mismo cuerpo que 20261120500000_cerrar_escrituras_neumet.sql más el chequeo de estado (sus únicos llamadores son
-- stock_cubierta_editar, _mover y _eliminar, que solo operan sobre estado 'almacenado').
create or replace function public.stock_cubierta_autorizar_por_id(p_id bigint)
 RETURNS SETOF neumaticos
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
declare
  v_n    public.neumaticos%rowtype;
  v_aut  record;
begin
  if p_id is null then
    raise exception 'parámetros obligatorios' using errcode = '22004';
  end if;
  select * into v_n from public.neumaticos n where n.id = p_id;
  if not found then
    raise exception 'permiso denegado' using errcode = '42501';
  end if;
  select * into v_aut from public.sucursal_autorizar_gestion(v_n.cliente_id);
  select * into v_n from public.neumaticos n where n.id = p_id for update;
  if not found then
    raise exception 'permiso denegado' using errcode = '42501';
  end if;
  if v_n.vehiculo_id is not null then
    raise exception 'la cubierta está montada en un vehículo: no se gestiona desde el stock' using errcode = '55000';
  end if;
  if v_n.estado <> 'almacenado' then
    raise exception 'no es una cubierta del stock' using errcode = '55000';
  end if;
  return next v_n;
end
$$;
revoke all on function public.stock_cubierta_autorizar_por_id(bigint) from public, anon, authenticated;
