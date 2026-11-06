-- =============================================================================
-- NEUMET · RPC de rotación / intercambio de neumáticos (atómica)
-- =============================================================================
-- Requiere 20261106000000_init_schema.sql y 20261106020000_producto_vistas.sql
-- (is_admin(), neumaticos con unique (vehiculo_id, posicion), eventos_neumatico).
-- Sin begin/commit: la herramienta que aplica la migración ya la envuelve.
-- Idempotente (create or replace + revoke/grant repetibles).
--
-- Antes la rotación eran 3 UPDATE sueltos desde el cliente (posición temporal);
-- si uno fallaba quedaba el vehículo a medias. Ahora es una sola llamada
-- transaccional: o se intercambia todo (y se registran los eventos) o nada.
-- =============================================================================

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
  if not public.is_admin() then
    raise exception 'permiso denegado' using errcode = '42501';
  end if;
  if p_vehiculo_id is null or p_pos_a is null or p_pos_b is null then
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

  -- Bloqueo de filas (orden por id: sin deadlocks entre rotaciones concurrentes).
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
    -- (vehiculo_id, posicion) es único y no diferible: se pasa por una posición libre.
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
    (cliente_id, vehiculo_id, neumatico_id, idneumatico, tipo, posicion_origen, posicion_destino, odometro_km)
  values (v_a.cliente_id, v_a.vehiculo_id, v_a.id, v_a.idneumatico, 'rotacion', p_pos_a, p_pos_b, p_odometro_km);
  if v_swap then
    insert into public.eventos_neumatico
      (cliente_id, vehiculo_id, neumatico_id, idneumatico, tipo, posicion_origen, posicion_destino, odometro_km)
    values (v_b.cliente_id, v_b.vehiculo_id, v_b.id, v_b.idneumatico, 'rotacion', p_pos_b, p_pos_a, p_odometro_km);
  end if;

  return jsonb_build_object('vehiculo_id', p_vehiculo_id, 'intercambio', v_swap,
                            'neumatico_a', v_a.id, 'neumatico_b', case when v_swap then v_b.id end);
end
$$;

revoke all on function public.neumatico_rotar(bigint, smallint, smallint, integer) from public, anon;
grant execute on function public.neumatico_rotar(bigint, smallint, smallint, integer) to authenticated;
