-- =============================================================================
-- NEUMET · Gestión de sucursales y altas/movimientos de vehículos (vía RPC acotada)
-- =============================================================================
-- Requiere 20261106000000_init_schema.sql, 20261107020000_seccionales.sql (tabla
-- sucursales, perfiles.sucursal_id) y 20261108000000_cambio_neumatico.sql
-- (neumatico_autorizar_vehiculo).
-- Sin begin/commit: la herramienta que aplica la migración ya la envuelve.
-- Idempotente (create or replace + revoke/grant repetibles). No toca tablas ni RLS.
--
-- El rol cliente es solo lectura (RLS). NO se amplían políticas de escritura:
-- toda escritura pasa por estas RPC SECURITY DEFINER (search_path = ''), que
-- verifican la autorización DENTRO de la función (nunca por parámetros):
--   * admin (is_admin())                             -> cualquier cliente (indica p_cliente_id).
--   * perfil rol 'cliente' GLOBAL (sucursal_id null) -> solo SU cliente.
--   * perfil rol 'cliente' de SUCURSAL, rol 'api', sin perfil, anon -> nada.
-- Aislamiento por cliente: la sucursal y el vehículo deben pertenecer al cliente
-- del que llama; si no existen o son de otro cliente se responde igual (42501) para
-- no revelar su existencia. Además las FK compuestas (sucursal_id, cliente_id)
-- impiden a nivel de tabla asignar una sucursal de otro cliente.
--
-- Mover un vehículo solo cambia vehiculos.sucursal_id: mediciones, neumáticos y
-- eventos cuelgan de vehiculo_id, así que el historial se conserva íntegro.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Autorización común (interna: nadie fuera del dueño puede ejecutarla)
-- -----------------------------------------------------------------------------
create or replace function public.sucursal_autorizar_gestion(p_cliente_id bigint)
returns table (cliente_id bigint, es_admin boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid  uuid := auth.uid();
  v_perf public.perfiles%rowtype;
begin
  if v_uid is null then
    raise exception 'permiso denegado' using errcode = '42501';
  end if;

  if public.is_admin() then
    if p_cliente_id is null then
      raise exception 'parámetros obligatorios' using errcode = '22004';
    end if;
    if not exists (select 1 from public.clientes c where c.id = p_cliente_id and c.deleted_at is null) then
      raise exception 'cliente inexistente' using errcode = 'P0002';
    end if;
    return query select p_cliente_id, true;
    return;
  end if;

  select * into v_perf from public.perfiles p where p.user_id = v_uid and p.rol = 'cliente';
  -- Solo el perfil GLOBAL gestiona sucursales; el de sucursal queda fuera.
  if not found or v_perf.cliente_id is null or v_perf.sucursal_id is not null
     or (p_cliente_id is not null and p_cliente_id <> v_perf.cliente_id)
     or not exists (select 1 from public.clientes c where c.id = v_perf.cliente_id and c.deleted_at is null) then
    raise exception 'permiso denegado' using errcode = '42501';
  end if;
  return query select v_perf.cliente_id, false;
end
$$;
revoke all on function public.sucursal_autorizar_gestion(bigint) from public, anon, authenticated;

-- Cliente dueño de una sucursal, o error uniforme si no existe / no corresponde.
-- (Para un no-admin, "no existe" y "es de otro cliente" son indistinguibles.)
create or replace function public.sucursal_autorizar_por_id(p_sucursal_id bigint)
returns table (cliente_id bigint, nombre text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_suc public.sucursales%rowtype;
  v_aut record;
begin
  if p_sucursal_id is null then
    raise exception 'parámetros obligatorios' using errcode = '22004';
  end if;
  select * into v_suc from public.sucursales s where s.id = p_sucursal_id;
  if not found then
    if auth.uid() is not null and public.is_admin() then
      raise exception 'sucursal inexistente' using errcode = 'P0002';
    end if;
    raise exception 'permiso denegado' using errcode = '42501';
  end if;
  select * into v_aut from public.sucursal_autorizar_gestion(v_suc.cliente_id);
  -- Bloquea la fila: serializa renombrar/eliminar contra ella.
  select * into v_suc from public.sucursales s where s.id = p_sucursal_id for update;
  if not found then
    raise exception 'permiso denegado' using errcode = '42501';
  end if;
  return query select v_suc.cliente_id, v_suc.nombre;
end
$$;
revoke all on function public.sucursal_autorizar_por_id(bigint) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. sucursal_crear
-- -----------------------------------------------------------------------------
create or replace function public.sucursal_crear(p_nombre text, p_cliente_id bigint default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_aut    record;
  v_nombre text := btrim(coalesce(p_nombre, ''));
  v_id     bigint;
begin
  select * into v_aut from public.sucursal_autorizar_gestion(p_cliente_id);
  if v_nombre = '' or length(v_nombre) > 100 then
    raise exception 'nombre de sucursal inválido (1 a 100 caracteres)' using errcode = '23514';
  end if;
  -- Nombre repetido en el cliente: 23505 por el índice único (cliente, lower(btrim(nombre))).
  insert into public.sucursales (cliente_id, nombre) values (v_aut.cliente_id, v_nombre)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'cliente_id', v_aut.cliente_id, 'nombre', v_nombre);
end
$$;
revoke all on function public.sucursal_crear(text, bigint) from public, anon;
grant execute on function public.sucursal_crear(text, bigint) to authenticated;

-- -----------------------------------------------------------------------------
-- 3. sucursal_renombrar
-- -----------------------------------------------------------------------------
create or replace function public.sucursal_renombrar(p_sucursal_id bigint, p_nombre text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_aut    record;
  v_nombre text := btrim(coalesce(p_nombre, ''));
begin
  select * into v_aut from public.sucursal_autorizar_por_id(p_sucursal_id);
  if v_nombre = '' or length(v_nombre) > 100 then
    raise exception 'nombre de sucursal inválido (1 a 100 caracteres)' using errcode = '23514';
  end if;
  update public.sucursales set nombre = v_nombre where id = p_sucursal_id;
  return jsonb_build_object('id', p_sucursal_id, 'cliente_id', v_aut.cliente_id, 'nombre', v_nombre);
end
$$;
revoke all on function public.sucursal_renombrar(bigint, text) from public, anon;
grant execute on function public.sucursal_renombrar(bigint, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 4. sucursal_eliminar: solo si no tiene vehículos, dispositivos ni usuarios
-- -----------------------------------------------------------------------------
-- La FK es RESTRICT (borrar con datos haría global a un perfil de sucursal);
-- se comprueba antes para dar un mensaje claro con los conteos.
create or replace function public.sucursal_eliminar(p_sucursal_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_aut record;
  v_veh bigint;
  v_dis bigint;
  v_usu bigint;
begin
  select * into v_aut from public.sucursal_autorizar_por_id(p_sucursal_id);
  select count(*) into v_veh from public.vehiculos    v where v.sucursal_id = p_sucursal_id;
  select count(*) into v_dis from public.dispositivos d where d.sucursal_id = p_sucursal_id;
  select count(*) into v_usu from public.perfiles     p where p.sucursal_id = p_sucursal_id;
  if v_veh + v_dis + v_usu > 0 then
    raise exception 'la sucursal tiene % vehículo(s), % dispositivo(s) y % usuario(s): reasignarlos antes de eliminarla', v_veh, v_dis, v_usu
      using errcode = '23503';
  end if;
  delete from public.sucursales where id = p_sucursal_id;
  return jsonb_build_object('id', p_sucursal_id, 'cliente_id', v_aut.cliente_id, 'nombre', v_aut.nombre);
end
$$;
revoke all on function public.sucursal_eliminar(bigint) from public, anon;
grant execute on function public.sucursal_eliminar(bigint) to authenticated;

-- -----------------------------------------------------------------------------
-- 5. vehiculo_crear: alta de un vehículo del cliente (sucursal opcional)
-- -----------------------------------------------------------------------------
create or replace function public.vehiculo_crear(
  p_numero       text,
  p_patente      text default null,
  p_tipo_ruedas  smallint default 10,
  p_sucursal_id  bigint default null,
  p_cliente_id   bigint default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_aut     record;
  v_numero  text := nullif(btrim(coalesce(p_numero, '')), '');
  v_patente text := nullif(btrim(coalesce(p_patente, '')), '');
  v_id      bigint;
begin
  select * into v_aut from public.sucursal_autorizar_gestion(p_cliente_id);
  if v_numero is null or length(v_numero) > 50 then
    raise exception 'número de coche inválido (1 a 50 caracteres)' using errcode = '23514';
  end if;
  if v_patente is not null and length(v_patente) > 20 then
    raise exception 'matrícula demasiado larga (máx. 20)' using errcode = '23514';
  end if;
  if p_tipo_ruedas is null or p_tipo_ruedas not in (10, 16) then
    raise exception 'tipo de ruedas inválido (10 o 16)' using errcode = '23514';
  end if;
  if p_sucursal_id is not null then
    perform 1 from public.sucursales s
     where s.id = p_sucursal_id and s.cliente_id = v_aut.cliente_id for share;
    if not found then
      raise exception 'permiso denegado' using errcode = '42501';
    end if;
  end if;
  -- Matrícula o número repetidos en el cliente: 23505 por los índices únicos existentes.
  insert into public.vehiculos (cliente_id, nombre, numero, patente, tipo_ruedas, sucursal_id)
  values (v_aut.cliente_id, 'Coche ' || v_numero, v_numero, v_patente, p_tipo_ruedas, p_sucursal_id)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'cliente_id', v_aut.cliente_id, 'sucursal_id', p_sucursal_id);
end
$$;
revoke all on function public.vehiculo_crear(text, text, smallint, bigint, bigint) from public, anon;
grant execute on function public.vehiculo_crear(text, text, smallint, bigint, bigint) to authenticated;

-- -----------------------------------------------------------------------------
-- 6. vehiculo_mover_sucursal: de una sucursal a otra (o a "sin sucursal" con null)
-- -----------------------------------------------------------------------------
-- Solo admin o perfil global. Deja una fila en audit_log (acción MOVER_SUCURSAL) además
-- de la del trigger de vehiculos. No toca mediciones, neumáticos ni eventos.
create or replace function public.vehiculo_mover_sucursal(p_vehiculo_id bigint, p_sucursal_id bigint)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_aut  record;
  v_veh  public.vehiculos%rowtype;
begin
  -- Autoriza y bloquea el vehículo (el perfil de sucursal recibe 42501 abajo).
  select * into v_aut from public.neumatico_autorizar_vehiculo(p_vehiculo_id);
  if not (v_aut.es_admin or v_aut.es_global) then
    raise exception 'permiso denegado' using errcode = '42501';
  end if;
  if p_sucursal_id is not null then
    perform 1 from public.sucursales s
     where s.id = p_sucursal_id and s.cliente_id = v_aut.cliente_id for share;
    if not found then
      raise exception 'permiso denegado' using errcode = '42501';
    end if;
  end if;

  select * into v_veh from public.vehiculos v where v.id = p_vehiculo_id;
  if v_veh.sucursal_id is not distinct from p_sucursal_id then
    return jsonb_build_object('vehiculo_id', p_vehiculo_id, 'anterior', v_veh.sucursal_id,
                              'nueva', p_sucursal_id, 'movido', false);
  end if;

  update public.vehiculos set sucursal_id = p_sucursal_id where id = p_vehiculo_id;
  insert into public.audit_log (actor_id, actor_rol, accion, entidad, entidad_id, antes, despues)
  values (auth.uid(), case when v_aut.es_admin then 'admin' else 'cliente' end,
          'MOVER_SUCURSAL', 'vehiculos', p_vehiculo_id::text,
          jsonb_build_object('sucursal_id', v_veh.sucursal_id),
          jsonb_build_object('sucursal_id', p_sucursal_id, 'cliente_id', v_aut.cliente_id));
  return jsonb_build_object('vehiculo_id', p_vehiculo_id, 'anterior', v_veh.sucursal_id,
                            'nueva', p_sucursal_id, 'movido', true);
end
$$;
revoke all on function public.vehiculo_mover_sucursal(bigint, bigint) from public, anon;
grant execute on function public.vehiculo_mover_sucursal(bigint, bigint) to authenticated;
