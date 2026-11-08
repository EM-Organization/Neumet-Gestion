-- =============================================================================
-- NEUMET · Montar y desmontar neumáticos sin reemplazo (vehículo sin neumáticos, corrección de montajes)
-- =============================================================================
-- Requiere 20261108000000 (neumatico_autorizar_vehiculo), 20261110000000 (numero_quema, km_previos) y
-- 20261113000000 (stock de cubiertas: neumaticos.condicion/sucursal_id, vehiculo_id nulo, stock_cubierta_sucursal).
-- Independiente de la migración de km por cubierta (20261114000000): no toca tablas, vistas ni RLS.
-- Sin begin/commit: la herramienta que aplica la migración ya la envuelve.
-- Idempotente (create or replace + revoke/grant repetibles).
--
-- Problema: un vehículo creado sin neumáticos (vehiculo_crear) quedaba sin neumáticos para siempre, porque
-- neumatico_cambiar solo sustituye uno existente. Se añaden dos RPC SECURITY DEFINER (search_path = '') con la
-- misma autorización que neumatico_cambiar (neumatico_autorizar_vehiculo; nunca por parámetros):
--   * admin                         -> cualquier vehículo.
--   * perfil 'cliente' GLOBAL       -> vehículos de su cliente.
--   * perfil 'cliente' de SUCURSAL  -> solo vehículos de su sucursal; no usa el stock (lo gestiona el perfil global).
--   * rol 'api', sin perfil, anon, otro cliente -> 42501 uniforme (no revela si el vehículo existe).
--
-- neumatico_montar: monta un neumático en una posición LIBRE.
--   Origen: una cubierta individual del stock (p_cubierta_id; misma fila, conserva quema y mediciones; «Nuevo» pasa
--   a «Usado» por el trigger neumaticos_condicion_auto) o un neumático ingresado a mano (p_nuevo).
--   Posiciones: 1..N con N = ruedas del vehículo (10 o 16, igual que layoutRuedas en el panel: un vehículo de tipo
--   10 con algún neumático montado en 11..98 se trata como de 16) y 99 = auxilio. No hay posiciones 17..98
--   nuevas: esas solo las crea la ingesta de la API.
--   Atomicidad: el vehículo queda bloqueado (neumatico_autorizar_vehiculo) y la cubierta del stock se bloquea
--   con FOR UPDATE; dos montajes simultáneos en la misma posición o de la misma cubierta: uno confirma y el otro falla
--   (55000 posición ocupada / P0002 cubierta ya montada).
-- neumatico_desmontar: retira el neumático de una posición SIN poner otro (corrige un montaje equivocado).
--   Destinos: 'almacenado' (vuelve al stock, en una sucursal del cliente, conservando su quema), 'reparacion' o
--   'baja' (motivo obligatorio). Reparación y baja dejan el neumático «aparcado» en el vehículo igual que
--   neumatico_cambiar (posición libre de 98 hacia abajo), porque el stock solo admite cubiertas utilizables.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. neumatico_montar
-- -----------------------------------------------------------------------------
-- p_nuevo (jsonb, solo sin p_cubierta_id): marca (obligatoria), modelo, codigo, numero_quema (única por cliente sin
--   distinguir mayúsculas, máx. 40), km_previos (entero 0..999999999), fecha_compra (no futura), precio (>= 0),
--   vida (entero 0..3). Claves desconocidas -> 22023.
create or replace function public.neumatico_montar(
  p_vehiculo_id  bigint,
  p_posicion     smallint,
  p_cubierta_id  bigint  default null,
  p_nuevo        jsonb   default null,
  p_odometro_km  integer default null,
  p_notas        text    default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_aut     record;
  v_veh     public.vehiculos%rowtype;
  v_cub     public.neumaticos%rowtype;
  v_notas   text := nullif(btrim(coalesce(p_notas, '')), '');
  v_max     smallint;
  v_marca   text;
  v_modelo  text;
  v_codigo  text;
  v_quema   text;
  v_km_prev integer := 0;
  v_fecha_c date;
  v_precio  numeric(12,2);
  v_vida    smallint := 0;
  v_idn     text;
  v_id      bigint;
  v_cond    text;
  v_suc_org text;
  v_ev      bigint;
  v_odo_veh integer;
  v_aux     boolean := (p_posicion = 99);
  v_txt     text;
  v_k       text;
begin
  select * into v_aut from public.neumatico_autorizar_vehiculo(p_vehiculo_id);

  if p_posicion is null then
    raise exception 'parámetros obligatorios' using errcode = '22004';
  end if;
  if p_posicion not between 1 and 99 then
    raise exception 'posición fuera de rango (1-99)' using errcode = '23514';
  end if;
  if (p_cubierta_id is not null)::int + (p_nuevo is not null)::int <> 1 then
    raise exception 'indicar el neumático a montar: cubierta del stock o ingresado (uno solo)' using errcode = '22023';
  end if;
  if v_notas is not null and length(v_notas) > 200 then
    raise exception 'notas demasiado largas (máx. 200)' using errcode = '22023';
  end if;
  if p_odometro_km is not null and p_odometro_km < 0 then
    raise exception 'odómetro negativo' using errcode = '23514';
  end if;

  -- El vehículo ya está bloqueado: la lectura de su odómetro y de sus neumáticos es estable.
  select * into v_veh from public.vehiculos v where v.id = p_vehiculo_id;
  if p_odometro_km is not null and v_veh.odometro_km is not null and p_odometro_km < v_veh.odometro_km then
    raise exception 'el odómetro del vehículo no puede ser menor al actual (% km)', v_veh.odometro_km
      using errcode = '23514';
  end if;

  -- Posición esperada: igual que el diagrama del panel (tipo 10 pasa a 16 si hay un neumático montado en 11..98).
  if p_posicion < 99 then
    v_max := case when v_veh.tipo_ruedas = 16 or exists (
                       select 1 from public.neumaticos n
                        where n.vehiculo_id = p_vehiculo_id and n.estado = 'montado' and n.posicion between 11 and 98)
                  then 16 else 10 end;
    if p_posicion > v_max then
      raise exception 'la posición % no existe en un vehículo de % ruedas (posiciones 1-% y auxilio 99)',
        p_posicion, v_max, v_max using errcode = '23514';
    end if;
  end if;

  -- Posición libre (cualquier fila ocupa la posición: unique vehiculo_id+posicion).
  if exists (select 1 from public.neumaticos n where n.vehiculo_id = p_vehiculo_id and n.posicion = p_posicion) then
    raise exception 'la posición % ya tiene un neumático', p_posicion using errcode = '55000';
  end if;
  if v_aux and exists (select 1 from public.neumaticos n where n.vehiculo_id = p_vehiculo_id and n.auxilio) then
    raise exception 'el vehículo ya tiene un neumático de auxilio' using errcode = '55000';
  end if;

  if p_cubierta_id is not null then
    -- Cubierta individual del stock: solo admin o perfil global, y del MISMO cliente que el vehículo.
    if not v_aut.es_global then
      raise exception 'el stock lo gestiona el perfil global: ingresar el neumático a mano' using errcode = '42501';
    end if;
    select * into v_cub from public.neumaticos n
     where n.id = p_cubierta_id and n.cliente_id = v_aut.cliente_id
       and n.vehiculo_id is null and n.estado = 'almacenado' for update;
    if not found then
      -- Inexistente, de otro cliente o ya montada: el mismo mensaje.
      raise exception 'cubierta del stock inexistente o ya montada' using errcode = 'P0002';
    end if;
    v_marca := v_cub.marca; v_modelo := v_cub.modelo; v_quema := v_cub.numero_quema;
    v_km_prev := v_cub.km_previos; v_precio := v_cub.precio_unidad; v_idn := v_cub.idneumatico;
    v_id := v_cub.id;
    if v_cub.sucursal_id is not null then
      select s.nombre into v_suc_org from public.sucursales s where s.id = v_cub.sucursal_id;
    end if;
  else
    if jsonb_typeof(p_nuevo) <> 'object' then
      raise exception 'datos del neumático inválidos' using errcode = '22023';
    end if;
    for v_k in select jsonb_object_keys(p_nuevo) loop
      if v_k not in ('marca', 'modelo', 'codigo', 'numero_quema', 'km_previos', 'fecha_compra', 'precio', 'vida') then
        raise exception 'campo desconocido: %', v_k using errcode = '22023';
      end if;
    end loop;
    v_marca  := nullif(btrim(coalesce(p_nuevo ->> 'marca', '')), '');
    v_modelo := nullif(btrim(coalesce(p_nuevo ->> 'modelo', '')), '');
    v_codigo := nullif(btrim(coalesce(p_nuevo ->> 'codigo', '')), '');
    v_quema  := nullif(btrim(coalesce(p_nuevo ->> 'numero_quema', '')), '');
    if v_marca is null then
      raise exception 'indicar la marca del neumático' using errcode = '22023';
    end if;
    if length(v_marca) > 60 or length(coalesce(v_modelo, '')) > 60 or length(coalesce(v_codigo, '')) > 60 then
      raise exception 'marca, modelo o código demasiado largos (máx. 60)' using errcode = '22023';
    end if;
    if v_quema is not null and length(v_quema) > 40 then
      raise exception 'número de quema demasiado largo (máx. 40)' using errcode = '22023';
    end if;
    if v_quema is not null and exists (
         select 1 from public.neumaticos n
          where n.cliente_id = v_aut.cliente_id and lower(n.numero_quema) = lower(v_quema)) then
      raise exception 'el número de quema ya está registrado en otro neumático' using errcode = '23505';
    end if;
    if p_nuevo ? 'km_previos' and jsonb_typeof(p_nuevo -> 'km_previos') not in ('number', 'null') then
      raise exception 'km previos inválidos' using errcode = '22023';
    end if;
    if jsonb_typeof(p_nuevo -> 'km_previos') = 'number' then
      v_txt := p_nuevo ->> 'km_previos';
      if v_txt::numeric < 0 or v_txt::numeric > 999999999 or v_txt::numeric <> trunc(v_txt::numeric) then
        raise exception 'km previos fuera de rango (0 a 999999999)' using errcode = '23514';
      end if;
      v_km_prev := v_txt::integer;
    end if;
    if p_nuevo ? 'fecha_compra' and jsonb_typeof(p_nuevo -> 'fecha_compra') not in ('string', 'null') then
      raise exception 'fecha de compra inválida' using errcode = '22023';
    end if;
    v_fecha_c := nullif(btrim(coalesce(p_nuevo ->> 'fecha_compra', '')), '')::date;
    if v_fecha_c > current_date + 1 then
      raise exception 'la fecha de compra no puede ser futura' using errcode = '23514';
    end if;
    if p_nuevo ? 'precio' and jsonb_typeof(p_nuevo -> 'precio') not in ('number', 'null') then
      raise exception 'precio inválido' using errcode = '22023';
    end if;
    if jsonb_typeof(p_nuevo -> 'precio') = 'number' then
      v_txt := p_nuevo ->> 'precio';
      if v_txt::numeric < 0 or v_txt::numeric >= 10000000000 then
        raise exception 'precio fuera de rango' using errcode = '23514';
      end if;
      v_precio := round(v_txt::numeric, 2);
    end if;
    if p_nuevo ? 'vida' and jsonb_typeof(p_nuevo -> 'vida') not in ('number', 'null') then
      raise exception 'vida inválida' using errcode = '22023';
    end if;
    if jsonb_typeof(p_nuevo -> 'vida') = 'number' then
      v_txt := p_nuevo ->> 'vida';
      if v_txt::numeric not between 0 and 3 or v_txt::numeric <> trunc(v_txt::numeric) then
        raise exception 'vida fuera de rango (0-3)' using errcode = '23514';
      end if;
      v_vida := v_txt::smallint;
    end if;
  end if;

  -- Monta
  if p_cubierta_id is not null then
    update public.neumaticos
       set vehiculo_id = p_vehiculo_id, posicion = p_posicion, sucursal_id = null,
           estado = 'montado', auxilio = v_aux
     where id = v_cub.id
    returning condicion into v_cond;                 -- el trigger pasó «nuevo» a «usado»
  else
    loop
      v_idn := 'CN-' || p_vehiculo_id || '-' || p_posicion || '-'
               || substr(md5(clock_timestamp()::text || random()::text), 1, 8);
      exit when not exists (select 1 from public.neumaticos n where n.idneumatico = v_idn);
    end loop;
    insert into public.neumaticos
      (vehiculo_id, cliente_id, posicion, marca, modelo, fecha_compra, precio_unidad,
       idneumatico, codigo, auxilio, vida, estado, numero_quema, km_previos, condicion)
    values
      (p_vehiculo_id, v_aut.cliente_id, p_posicion, v_marca, v_modelo, v_fecha_c, v_precio,
       v_idn, v_codigo, v_aux, v_vida, 'montado', v_quema, v_km_prev,
       case when v_vida > 0 then 'recauchutado' else 'usado' end)
    returning id, condicion into v_id, v_cond;
  end if;

  insert into public.eventos_neumatico
    (cliente_id, vehiculo_id, neumatico_id, idneumatico, tipo, posicion_destino, odometro_km, costo,
     sucursal_origen_id, notas, created_by)
  values (v_aut.cliente_id, p_vehiculo_id, v_id, v_idn, 'montaje', p_posicion, p_odometro_km,
          -- El costo de compra se imputa una sola vez: al ingresarlo o en el primer montaje de la cubierta («nuevo»).
          case when p_cubierta_id is null or v_cub.condicion = 'nuevo' then v_precio end,
          case when p_cubierta_id is not null then v_cub.sucursal_id end,
          'Montaje en posición libre'
            || coalesce(' · quema ' || v_quema, '')
            || case when v_km_prev > 0 then ' · ' || v_km_prev || ' km previos' else '' end
            || case when p_cubierta_id is not null
                    then ' · cubierta del stock (' || coalesce(v_suc_org, 'sin sucursal') || ')' else '' end
            || coalesce(': ' || v_notas, ''),
          auth.uid())
  returning id into v_ev;

  -- Odómetro del vehículo: solo sube
  if p_odometro_km is not null then
    update public.vehiculos
       set odometro_km = p_odometro_km, odometro_actualizado_at = now()
     where id = p_vehiculo_id and (odometro_km is null or odometro_km < p_odometro_km);
  end if;
  select odometro_km into v_odo_veh from public.vehiculos where id = p_vehiculo_id;

  return jsonb_build_object(
    'vehiculo_id', p_vehiculo_id,
    'posicion', p_posicion,
    'auxilio', v_aux,
    'neumatico_id', v_id,
    'idneumatico', v_idn,
    'numero_quema', v_quema,
    'km_previos', v_km_prev,
    'condicion', v_cond,
    'cubierta_id', p_cubierta_id,
    'odometro_km', v_odo_veh,
    'evento_id', v_ev);
end
$$;
revoke all on function public.neumatico_montar(bigint, smallint, bigint, jsonb, integer, text) from public, anon;
grant execute on function public.neumatico_montar(bigint, smallint, bigint, jsonb, integer, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 2. neumatico_desmontar
-- -----------------------------------------------------------------------------
-- p_destino: 'almacenado' (vuelve al stock: solo admin o perfil global; necesita número de quema, el propio o
--   p_quema; la sucursal p_sucursal_stock debe ser del cliente o null = sin sucursal), 'reparacion' o 'baja'
--   (p_motivo obligatorio).
create or replace function public.neumatico_desmontar(
  p_vehiculo_id    bigint,
  p_posicion       smallint,
  p_destino        text,
  p_motivo         text    default null,
  p_odometro_km    integer default null,
  p_sucursal_stock bigint  default null,
  p_quema          text    default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_aut     record;
  v_n       public.neumaticos%rowtype;
  v_motivo  text := nullif(btrim(coalesce(p_motivo, '')), '');
  v_quema   text;
  v_suc     text;
  v_park    smallint;
  v_ev      bigint;
  v_odo_act integer;
  v_odo_veh integer;
begin
  select * into v_aut from public.neumatico_autorizar_vehiculo(p_vehiculo_id);

  if p_posicion is null or p_destino is null then
    raise exception 'parámetros obligatorios' using errcode = '22004';
  end if;
  if p_posicion not between 1 and 99 then
    raise exception 'posición fuera de rango (1-99)' using errcode = '23514';
  end if;
  if p_destino not in ('almacenado', 'reparacion', 'baja') then
    raise exception 'destino del neumático inválido' using errcode = '22023';
  end if;
  if p_destino = 'baja' and v_motivo is null then
    raise exception 'indicar el motivo de la baja' using errcode = '22023';
  end if;
  if v_motivo is not null and length(v_motivo) > 200 then
    raise exception 'motivo demasiado largo (máx. 200)' using errcode = '22023';
  end if;
  if p_odometro_km is not null and p_odometro_km < 0 then
    raise exception 'odómetro negativo' using errcode = '23514';
  end if;
  if p_odometro_km is not null then
    select v.odometro_km into v_odo_act from public.vehiculos v where v.id = p_vehiculo_id;
    if v_odo_act is not null and p_odometro_km < v_odo_act then
      raise exception 'el odómetro del vehículo no puede ser menor al actual (% km)', v_odo_act
        using errcode = '23514';
    end if;
  end if;
  if p_destino <> 'almacenado' and (p_sucursal_stock is not null or nullif(btrim(coalesce(p_quema, '')), '') is not null) then
    raise exception 'sucursal y quema solo se indican al volver al stock' using errcode = '22023';
  end if;

  -- Solo un neumático montado en esa posición (bloqueado)
  select * into v_n from public.neumaticos n
   where n.vehiculo_id = p_vehiculo_id and n.posicion = p_posicion and n.estado = 'montado' for update;
  if not found then
    raise exception 'no hay neumático montado en la posición % del vehículo', p_posicion using errcode = 'P0002';
  end if;

  if p_destino = 'almacenado' then
    if not v_aut.es_global then
      raise exception 'el stock lo gestiona el perfil global: retirar a reparación o baja' using errcode = '42501';
    end if;
    v_quema := coalesce(v_n.numero_quema, nullif(btrim(coalesce(p_quema, '')), ''));
    if v_quema is null then
      raise exception 'el neumático necesita número de quema para volver al stock' using errcode = '22023';
    end if;
    if length(v_quema) > 40 then
      raise exception 'número de quema demasiado largo (máx. 40)' using errcode = '22023';
    end if;
    if v_n.numero_quema is null and exists (
         select 1 from public.neumaticos n
          where n.cliente_id = v_aut.cliente_id and lower(n.numero_quema) = lower(v_quema)) then
      raise exception 'el número de quema ya está registrado en otro neumático' using errcode = '23505';
    end if;
    v_suc := public.stock_cubierta_sucursal(v_aut.cliente_id, p_sucursal_stock);

    -- Misma fila: conserva quema, mediciones y eventos (sin vehículo ni posición).
    update public.neumaticos
       set vehiculo_id = null, posicion = null, auxilio = false, estado = 'almacenado',
           sucursal_id = p_sucursal_stock, numero_quema = v_quema
     where id = v_n.id;

    insert into public.eventos_neumatico
      (cliente_id, vehiculo_id, neumatico_id, idneumatico, tipo, posicion_origen, odometro_km,
       sucursal_destino_id, notas, created_by)
    values (v_aut.cliente_id, p_vehiculo_id, v_n.id, v_n.idneumatico, 'desmontaje', p_posicion, p_odometro_km,
            p_sucursal_stock,
            'Retiro sin reemplazo · vuelve al stock: ' || coalesce(v_suc, 'sin sucursal') || coalesce(' · ' || v_motivo, ''),
            auth.uid())
    returning id into v_ev;
  else
    -- No puede quedar en la posición: se «aparca» en una posición libre (de 98 hacia abajo; 99 solo si no queda otra).
    select g into v_park
      from generate_series(99, 1, -1) g
     where g <> p_posicion
       and not exists (select 1 from public.neumaticos n where n.vehiculo_id = p_vehiculo_id and n.posicion = g)
     order by (g = 99), g desc
     limit 1;
    if v_park is null then
      raise exception 'no hay posición libre para guardar el neumático retirado' using errcode = '53400';
    end if;
    update public.neumaticos
       set posicion    = v_park,
           auxilio     = false,
           estado      = case p_destino when 'baja' then 'baja' else 'reparacion' end,
           condicion   = case p_destino when 'reparacion' then 'reparado' else condicion end,
           fecha_baja  = case when p_destino = 'baja' then current_date else fecha_baja end,
           motivo_baja = case when p_destino = 'baja' then v_motivo else motivo_baja end
     where id = v_n.id;

    if p_destino = 'baja' then
      insert into public.eventos_neumatico
        (cliente_id, vehiculo_id, neumatico_id, idneumatico, tipo, posicion_origen, odometro_km, notas, created_by)
      values (v_aut.cliente_id, p_vehiculo_id, v_n.id, v_n.idneumatico, 'baja', p_posicion, p_odometro_km,
              'Retiro sin reemplazo: ' || v_motivo, auth.uid())
      returning id into v_ev;
    else
      insert into public.eventos_neumatico
        (cliente_id, vehiculo_id, neumatico_id, idneumatico, tipo, posicion_origen, odometro_km, notas, created_by)
      values (v_aut.cliente_id, p_vehiculo_id, v_n.id, v_n.idneumatico, 'desmontaje', p_posicion, p_odometro_km,
              'Retiro sin reemplazo (reparación)' || coalesce(': ' || v_motivo, ''), auth.uid())
      returning id into v_ev;
    end if;
  end if;

  -- Odómetro del vehículo: solo sube
  if p_odometro_km is not null then
    update public.vehiculos
       set odometro_km = p_odometro_km, odometro_actualizado_at = now()
     where id = p_vehiculo_id and (odometro_km is null or odometro_km < p_odometro_km);
  end if;
  select odometro_km into v_odo_veh from public.vehiculos where id = p_vehiculo_id;

  return jsonb_build_object(
    'vehiculo_id', p_vehiculo_id,
    'posicion', p_posicion,
    'neumatico_id', v_n.id,
    'idneumatico', v_n.idneumatico,
    'destino', p_destino,
    'en_stock', p_destino = 'almacenado',
    'posicion_aparcado', case when p_destino = 'almacenado' then null else v_park end,
    'numero_quema', coalesce(v_quema, v_n.numero_quema),
    'odometro_km', v_odo_veh,
    'evento_id', v_ev);
end
$$;
revoke all on function public.neumatico_desmontar(bigint, smallint, text, text, integer, bigint, text) from public, anon;
grant execute on function public.neumatico_desmontar(bigint, smallint, text, text, integer, bigint, text) to authenticated;
