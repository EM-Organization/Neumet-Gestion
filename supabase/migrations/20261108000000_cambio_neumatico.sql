-- =============================================================================
-- NEUMET · Cambio de neumático y odómetro desde el taller (vía RPC acotada)
-- =============================================================================
-- Requiere 20261106000000_init_schema.sql, 20261106020000_producto_vistas.sql,
-- 20261107000000_rpc_rotacion.sql y 20261107020000_seccionales.sql.
-- Sin begin/commit: la herramienta que aplica la migración ya la envuelve.
-- Idempotente (create or replace + revoke/grant repetibles).
--
-- Problema: el gomero (usuario CLIENTE) registra el cambio de un neumático cuando
-- el taller lo ejecuta, pero el rol cliente es solo lectura (RLS) y solo el admin
-- escribe. NO se amplían políticas de escritura directa: toda escritura del cliente
-- pasa por estas RPC SECURITY DEFINER, que verifican la autorización DENTRO de la
-- función (nunca por parámetros) y acotan lo que se puede hacer:
--   * admin (is_admin())  -> cualquier vehículo.
--   * perfil rol 'cliente' GLOBAL (sucursal_id null) -> vehículos de SU cliente.
--   * perfil rol 'cliente' de SECCIONAL -> solo vehículos de su cliente Y su
--     seccional (vehiculos.sucursal_id = perfiles.sucursal_id).
--   * rol 'api', sin perfil, anon -> nada.
-- El stock (inventario con precios) solo lo puede consumir el admin o el perfil
-- global, igual que su política de lectura; el de seccional ingresa el neumático
-- nuevo con p_nuevo.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Autorización común (interna: nadie fuera del dueño puede ejecutarla)
-- -----------------------------------------------------------------------------
-- Bloquea la fila del vehículo (serializa cambios concurrentes sobre él) y devuelve
-- cliente_id y si quien llama es admin / perfil global. Si el vehículo no existe o
-- no le corresponde a un no-admin responde lo mismo (42501): no revela existencia.
create or replace function public.neumatico_autorizar_vehiculo(p_vehiculo_id bigint)
returns table (cliente_id bigint, es_admin boolean, es_global boolean)
language plpgsql
security definer
set search_path = ''
as $$
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

  if public.is_admin() then
    select * into v_veh from public.vehiculos v where v.id = p_vehiculo_id for update;
    if not found then
      raise exception 'vehículo inexistente' using errcode = 'P0002';
    end if;
    return query select v_veh.cliente_id, true, true;
    return;
  end if;

  select * into v_perf from public.perfiles p where p.user_id = v_uid and p.rol = 'cliente';
  if not found or v_perf.cliente_id is null then
    raise exception 'permiso denegado' using errcode = '42501';
  end if;

  select * into v_veh from public.vehiculos v
   where v.id = p_vehiculo_id
     and v.cliente_id = v_perf.cliente_id
     and (v_perf.sucursal_id is null or v.sucursal_id = v_perf.sucursal_id)
     and exists (select 1 from public.clientes c where c.id = v.cliente_id and c.deleted_at is null)
     for update of v;
  if not found then
    raise exception 'permiso denegado' using errcode = '42501';
  end if;
  return query select v_veh.cliente_id, false, (v_perf.sucursal_id is null);
end
$$;
revoke all on function public.neumatico_autorizar_vehiculo(bigint) from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 2. neumatico_cambiar: baja/reencauche/reparación/almacén del viejo + montaje del nuevo
-- -----------------------------------------------------------------------------
-- El neumático viejo no puede quedar en la posición (unique vehiculo_id+posicion):
-- se "aparca" en una posición libre (de 98 hacia abajo; 99 solo si no queda otra)
-- con su nuevo estado. Las vistas solo cuentan estado 'montado', así que no afecta.
-- Eventos: baja -> 'baja'; el resto -> 'desmontaje' (cierra el tramo de km), y para
-- reencauche además 'reencauche'. Luego 'montaje' del nuevo con el costo.
create or replace function public.neumatico_cambiar(
  p_vehiculo_id  bigint,
  p_posicion     smallint,
  p_destino_viejo text,
  p_motivo       text,
  p_odometro_km  integer default null,
  p_stock_id     bigint default null,
  p_nuevo        jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_aut      record;
  v_viejo    public.neumaticos%rowtype;
  v_stock    public.stock_neumaticos%rowtype;
  v_motivo   text := nullif(btrim(coalesce(p_motivo, '')), '');
  v_marca    text;
  v_modelo   text;
  v_codigo   text;
  v_precio   numeric(12,2);
  v_vida_n   smallint := 0;
  v_fecha_c  date;
  v_park     smallint;
  v_idn      text;
  v_nuevo_id bigint;
  v_estado_v text;
  v_ev_ids   bigint[] := '{}';
  v_ev       bigint;
  v_odo_veh  integer;
  v_txt      text;
begin
  select * into v_aut from public.neumatico_autorizar_vehiculo(p_vehiculo_id);

  if p_posicion is null or p_destino_viejo is null then
    raise exception 'parámetros obligatorios' using errcode = '22004';
  end if;
  if p_posicion not between 1 and 99 then
    raise exception 'posición fuera de rango (1-99)' using errcode = '23514';
  end if;
  if p_destino_viejo not in ('baja', 'reencauche', 'reparacion', 'almacenado') then
    raise exception 'destino del neumático viejo inválido' using errcode = '22023';
  end if;
  if p_destino_viejo = 'baja' and v_motivo is null then
    raise exception 'indicá el motivo de la baja' using errcode = '22023';
  end if;
  if v_motivo is not null and length(v_motivo) > 200 then
    raise exception 'motivo demasiado largo (máx. 200)' using errcode = '22023';
  end if;
  if p_odometro_km is not null and p_odometro_km < 0 then
    raise exception 'odómetro negativo' using errcode = '23514';
  end if;
  if (p_stock_id is null) = (p_nuevo is null) then
    raise exception 'indicá el neumático nuevo: del stock o ingresado (uno solo)' using errcode = '22023';
  end if;

  -- Neumático actual de la posición (bloqueado)
  select * into v_viejo from public.neumaticos n
   where n.vehiculo_id = p_vehiculo_id and n.posicion = p_posicion for update;
  if not found then
    raise exception 'no hay neumático en la posición % del vehículo', p_posicion using errcode = 'P0002';
  end if;
  if v_viejo.estado = 'baja' then
    raise exception 'el neumático de la posición % está dado de baja', p_posicion using errcode = '23514';
  end if;
  if p_destino_viejo = 'reencauche' and v_viejo.vida >= 3 then
    raise exception 'el neumático ya alcanzó la vida máxima (3 reencauches)' using errcode = '23514';
  end if;

  -- Neumático nuevo: del stock del MISMO cliente o ingresado a mano
  if p_stock_id is not null then
    if not v_aut.es_global then
      raise exception 'el stock lo gestiona el perfil global: ingresá el neumático nuevo a mano'
        using errcode = '42501';
    end if;
    select * into v_stock from public.stock_neumaticos s
     where s.id = p_stock_id and s.cliente_id = v_aut.cliente_id for update;
    if not found then
      raise exception 'stock inexistente' using errcode = 'P0002';
    end if;
    if v_stock.cantidad <= 0 then
      raise exception 'sin unidades en el stock seleccionado' using errcode = '55000';
    end if;
    v_marca := v_stock.marca; v_modelo := v_stock.modelo;
    v_precio := v_stock.precio_unidad; v_fecha_c := v_stock.fecha_compra;
  else
    if jsonb_typeof(p_nuevo) <> 'object' then
      raise exception 'datos del neumático nuevo inválidos' using errcode = '22023';
    end if;
    -- marca / modelo / codigo: texto; precio: número >= 0; vida: 0..3
    v_marca := nullif(btrim(coalesce(p_nuevo ->> 'marca', '')), '');
    v_modelo := nullif(btrim(coalesce(p_nuevo ->> 'modelo', '')), '');
    v_codigo := nullif(btrim(coalesce(p_nuevo ->> 'codigo', '')), '');
    if v_marca is null then
      raise exception 'indicá la marca del neumático nuevo' using errcode = '22023';
    end if;
    if length(v_marca) > 60 or length(coalesce(v_modelo, '')) > 60 or length(coalesce(v_codigo, '')) > 60 then
      raise exception 'marca, modelo o código demasiado largos (máx. 60)' using errcode = '22023';
    end if;
    if p_nuevo ? 'precio' and jsonb_typeof(p_nuevo -> 'precio') not in ('number', 'null') then
      raise exception 'precio inválido' using errcode = '22023';
    end if;
    if jsonb_typeof(p_nuevo -> 'precio') = 'number' then
      v_txt := p_nuevo ->> 'precio';
      if (v_txt)::numeric < 0 or (v_txt)::numeric >= 10000000000 then
        raise exception 'precio fuera de rango' using errcode = '23514';
      end if;
      v_precio := round((v_txt)::numeric, 2);
    end if;
    if p_nuevo ? 'vida' and jsonb_typeof(p_nuevo -> 'vida') not in ('number', 'null') then
      raise exception 'vida inválida' using errcode = '22023';
    end if;
    if jsonb_typeof(p_nuevo -> 'vida') = 'number' then
      v_txt := p_nuevo ->> 'vida';
      if (v_txt)::numeric not between 0 and 3 or (v_txt)::numeric <> trunc((v_txt)::numeric) then
        raise exception 'vida fuera de rango (0-3)' using errcode = '23514';
      end if;
      v_vida_n := (v_txt)::smallint;
    end if;
  end if;

  -- 1) El viejo sale de la posición
  select g into v_park
    from generate_series(99, 1, -1) g
   where g <> p_posicion
     and not exists (select 1 from public.neumaticos n
                      where n.vehiculo_id = p_vehiculo_id and n.posicion = g)
   order by (g = 99), g desc
   limit 1;
  if v_park is null then
    raise exception 'no hay posición libre para guardar el neumático retirado' using errcode = '53400';
  end if;

  v_estado_v := case p_destino_viejo
                  when 'baja' then 'baja'
                  when 'reparacion' then 'reparacion'
                  else 'almacenado' end;
  update public.neumaticos
     set posicion    = v_park,
         auxilio     = false,
         estado      = v_estado_v,
         vida        = case when p_destino_viejo = 'reencauche' then vida + 1 else vida end,
         fecha_baja  = case when p_destino_viejo = 'baja' then current_date else fecha_baja end,
         motivo_baja = case when p_destino_viejo = 'baja' then v_motivo else motivo_baja end
   where id = v_viejo.id;

  -- 2) El nuevo entra con identificador único
  loop
    v_idn := 'CN-' || p_vehiculo_id || '-' || p_posicion || '-'
             || substr(md5(clock_timestamp()::text || random()::text), 1, 8);
    exit when not exists (select 1 from public.neumaticos n where n.idneumatico = v_idn);
  end loop;
  insert into public.neumaticos
    (vehiculo_id, cliente_id, posicion, stock_id, marca, modelo, fecha_compra, precio_unidad,
     idneumatico, codigo, auxilio, vida, estado)
  values
    (p_vehiculo_id, v_aut.cliente_id, p_posicion, p_stock_id, v_marca, v_modelo, v_fecha_c, v_precio,
     v_idn, v_codigo, v_viejo.auxilio, v_vida_n, 'montado')
  returning id into v_nuevo_id;

  if p_stock_id is not null then
    update public.stock_neumaticos set cantidad = cantidad - 1 where id = p_stock_id;
  end if;

  -- 3) Eventos
  if p_destino_viejo = 'baja' then
    insert into public.eventos_neumatico
      (cliente_id, vehiculo_id, neumatico_id, idneumatico, tipo, posicion_origen, odometro_km, notas, created_by)
    values (v_aut.cliente_id, p_vehiculo_id, v_viejo.id, v_viejo.idneumatico, 'baja', p_posicion,
            p_odometro_km, 'Cambio de neumático: ' || v_motivo, auth.uid())
    returning id into v_ev;
    v_ev_ids := v_ev_ids || v_ev;
  else
    insert into public.eventos_neumatico
      (cliente_id, vehiculo_id, neumatico_id, idneumatico, tipo, posicion_origen, odometro_km, notas, created_by)
    values (v_aut.cliente_id, p_vehiculo_id, v_viejo.id, v_viejo.idneumatico, 'desmontaje', p_posicion,
            p_odometro_km,
            'Cambio de neumático (' || p_destino_viejo || ')' || coalesce(': ' || v_motivo, ''), auth.uid())
    returning id into v_ev;
    v_ev_ids := v_ev_ids || v_ev;
    if p_destino_viejo = 'reencauche' then
      insert into public.eventos_neumatico
        (cliente_id, vehiculo_id, neumatico_id, idneumatico, tipo, posicion_origen, odometro_km, notas, created_by)
      values (v_aut.cliente_id, p_vehiculo_id, v_viejo.id, v_viejo.idneumatico, 'reencauche', p_posicion,
              p_odometro_km, 'Reencauche nº ' || (v_viejo.vida + 1), auth.uid())
      returning id into v_ev;
      v_ev_ids := v_ev_ids || v_ev;
    end if;
  end if;
  insert into public.eventos_neumatico
    (cliente_id, vehiculo_id, neumatico_id, idneumatico, tipo, posicion_destino, odometro_km, costo, notas, created_by)
  values (v_aut.cliente_id, p_vehiculo_id, v_nuevo_id, v_idn, 'montaje', p_posicion,
          p_odometro_km, v_precio, 'Cambio de neumático: reemplaza a ' || coalesce(v_viejo.idneumatico, '#' || v_viejo.id), auth.uid())
  returning id into v_ev;
  v_ev_ids := v_ev_ids || v_ev;

  -- 4) Odómetro del vehículo: solo sube
  if p_odometro_km is not null then
    update public.vehiculos
       set odometro_km = p_odometro_km, odometro_actualizado_at = now()
     where id = p_vehiculo_id and (odometro_km is null or odometro_km < p_odometro_km);
  end if;
  select odometro_km into v_odo_veh from public.vehiculos where id = p_vehiculo_id;

  return jsonb_build_object(
    'vehiculo_id', p_vehiculo_id,
    'posicion', p_posicion,
    'neumatico_viejo_id', v_viejo.id,
    'neumatico_viejo_posicion', v_park,
    'destino_viejo', p_destino_viejo,
    'neumatico_nuevo_id', v_nuevo_id,
    'idneumatico_nuevo', v_idn,
    'stock_id', p_stock_id,
    'stock_restante', case when p_stock_id is not null then v_stock.cantidad - 1 end,
    'odometro_km', v_odo_veh,
    'eventos', to_jsonb(v_ev_ids));
end
$$;

revoke all on function public.neumatico_cambiar(bigint, smallint, text, text, integer, bigint, jsonb) from public, anon;
grant execute on function public.neumatico_cambiar(bigint, smallint, text, text, integer, bigint, jsonb) to authenticated;

-- -----------------------------------------------------------------------------
-- 3. vehiculo_registrar_odometro
-- -----------------------------------------------------------------------------
-- El cliente solo puede subir (o repetir) el kilometraje; bajarlo (p. ej. cambio de
-- tablero) es una corrección que solo hace el admin.
create or replace function public.vehiculo_registrar_odometro(
  p_vehiculo_id bigint,
  p_odometro_km integer
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_aut record;
  v_act integer;
begin
  select * into v_aut from public.neumatico_autorizar_vehiculo(p_vehiculo_id);
  if p_odometro_km is null then
    raise exception 'parámetros obligatorios' using errcode = '22004';
  end if;
  if p_odometro_km < 0 then
    raise exception 'odómetro negativo' using errcode = '23514';
  end if;
  select odometro_km into v_act from public.vehiculos where id = p_vehiculo_id;
  if v_act is not null and p_odometro_km < v_act and not v_aut.es_admin then
    raise exception 'el kilometraje no puede ser menor al actual (%)', v_act using errcode = '23514';
  end if;
  update public.vehiculos
     set odometro_km = p_odometro_km, odometro_actualizado_at = now()
   where id = p_vehiculo_id;
  return jsonb_build_object('vehiculo_id', p_vehiculo_id, 'odometro_km', p_odometro_km, 'anterior', v_act);
end
$$;

revoke all on function public.vehiculo_registrar_odometro(bigint, integer) from public, anon;
grant execute on function public.vehiculo_registrar_odometro(bigint, integer) to authenticated;

-- -----------------------------------------------------------------------------
-- 4. neumatico_rotar abierta al mismo alcance (mismos controles)
-- -----------------------------------------------------------------------------
-- Misma lógica que 20261107000000; solo cambia la autorización: admin o cliente
-- dentro de su cliente/seccional (neumatico_autorizar_vehiculo).
create or replace function public.neumatico_rotar(
  p_vehiculo_id bigint,
  p_pos_a       smallint,
  p_pos_b       smallint,
  p_odometro_km integer default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_a    public.neumaticos%rowtype;
  v_b    public.neumaticos%rowtype;
  v_tmp  smallint;
  v_swap boolean;
begin
  perform 1 from public.neumatico_autorizar_vehiculo(p_vehiculo_id);
  if p_pos_a is null or p_pos_b is null then
    raise exception 'parámetros obligatorios' using errcode = '22004';
  end if;
  if p_pos_a = p_pos_b then
    raise exception 'las posiciones deben ser distintas' using errcode = '22023';
  end if;
  if p_pos_a not between 1 and 99 or p_pos_b not between 1 and 99 then
    raise exception 'posición fuera de rango (1-99)' using errcode = '23514';
  end if;
  if p_odometro_km is not null and p_odometro_km < 0 then
    raise exception 'odómetro negativo' using errcode = '23514';
  end if;

  perform 1
    from public.neumaticos n
   where n.vehiculo_id = p_vehiculo_id and n.posicion in (p_pos_a, p_pos_b)
   order by n.id
     for update;

  select * into v_a from public.neumaticos
   where vehiculo_id = p_vehiculo_id and posicion = p_pos_a;
  if not found then
    raise exception 'no hay neumático en la posición % del vehículo %', p_pos_a, p_vehiculo_id
      using errcode = 'P0002';
  end if;
  if v_a.estado = 'baja' then
    raise exception 'el neumático de la posición % está dado de baja', p_pos_a using errcode = '23514';
  end if;

  select * into v_b from public.neumaticos
   where vehiculo_id = p_vehiculo_id and posicion = p_pos_b;
  v_swap := found;
  if v_swap and v_b.estado = 'baja' then
    raise exception 'el neumático de la posición % está dado de baja', p_pos_b using errcode = '23514';
  end if;

  if v_swap then
    select g into v_tmp
      from generate_series(99, 1, -1) g
     where not exists (select 1 from public.neumaticos n
                        where n.vehiculo_id = p_vehiculo_id and n.posicion = g)
     limit 1;
    if v_tmp is null then
      raise exception 'no hay posición libre para intercambiar' using errcode = '53400';
    end if;
    update public.neumaticos set posicion = v_tmp   where id = v_a.id;
    update public.neumaticos set posicion = p_pos_a where id = v_b.id;
    update public.neumaticos set posicion = p_pos_b where id = v_a.id;
  else
    update public.neumaticos set posicion = p_pos_b where id = v_a.id;
  end if;

  insert into public.eventos_neumatico
    (cliente_id, vehiculo_id, neumatico_id, idneumatico, tipo, posicion_origen, posicion_destino, odometro_km, created_by)
  values (v_a.cliente_id, v_a.vehiculo_id, v_a.id, v_a.idneumatico, 'rotacion', p_pos_a, p_pos_b, p_odometro_km, auth.uid());
  if v_swap then
    insert into public.eventos_neumatico
      (cliente_id, vehiculo_id, neumatico_id, idneumatico, tipo, posicion_origen, posicion_destino, odometro_km, created_by)
    values (v_b.cliente_id, v_b.vehiculo_id, v_b.id, v_b.idneumatico, 'rotacion', p_pos_b, p_pos_a, p_odometro_km, auth.uid());
  end if;

  return jsonb_build_object('vehiculo_id', p_vehiculo_id, 'intercambio', v_swap,
                            'neumatico_a', v_a.id, 'neumatico_b', case when v_swap then v_b.id end);
end
$$;

revoke all on function public.neumatico_rotar(bigint, smallint, smallint, integer) from public, anon;
grant execute on function public.neumatico_rotar(bigint, smallint, smallint, integer) to authenticated;
