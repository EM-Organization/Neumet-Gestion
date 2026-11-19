-- Eliminar un vehículo (baja lógica) · apéndice U de docs/08.
-- Idempotente (el CI la aplica dos veces). Sin begin/commit.
--
-- Por qué baja lógica y no DELETE físico: eventos_neumatico.vehiculo_id es RESTRICT (el historial de los neumáticos es
-- auditoría) y mediciones/alertas se perderían con CASCADE/SET NULL. El vehículo queda con `deleted_at`, sin
-- patente ni número (se guardan en patente_baja/numero_baja) para poder reutilizarlos, y sin sucursal para no trabar
-- la baja de la sucursal. La RLS lo oculta a todos los perfiles, así que las vistas, los embebidos y las subconsultas
-- de otras políticas dejan de verlo sin tocarlas una por una.
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
    and ((select public.is_admin())
         or ((select public.current_cliente_id()) is not null
             and ((n.vehiculo_id is null and n.cliente_id = (select public.current_cliente_id()))
                  or exists (select 1 from public.vehiculos v
                             where v.id = n.vehiculo_id
                               and v.deleted_at is null
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
