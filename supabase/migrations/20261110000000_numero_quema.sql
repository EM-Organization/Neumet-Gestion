-- =============================================================================
-- NEUMET · Número de quema por neumático y km que ya traía el neumático
-- =============================================================================
-- Requiere 20261106000000_init_schema.sql y 20261108000000_cambio_neumatico.sql.
-- Sin begin/commit: la herramienta que aplica la migración ya la envuelve.
-- Idempotente (add column if not exists, create or replace, drop if exists, revoke/grant repetibles).
--
-- 1. neumaticos.numero_quema (text, nullable): número grabado en el flanco del neumático.
--    Sin espacios en los extremos (lo garantiza un trigger y un CHECK), de 1 a 40 caracteres y
--    único por CLIENTE sin distinguir mayúsculas. neumaticos.cliente_id existe en cada fila
--    (lo escriben el panel y neumatico_cambiar), así que el índice único parcial se apoya en él:
--    (cliente_id, lower(numero_quema)) donde numero_quema no es nulo. La unicidad abarca todos
--    los estados (montado, almacenado, reparación, baja): el número identifica al neumático físico.
-- 2. neumaticos.km_previos (integer, not null, default 0): km que ya traía el neumático al montarlo
--    (0 = nuevo). Es un dato del NEUMÁTICO, independiente del odómetro del vehículo.
--    Km totales = km_previos + km recorridos; los recorridos salen de los eventos de
--    eventos_neumatico (montaje abre el tramo con el odómetro del vehículo; ver docs/08).
-- 3. neumatico_cambiar recibe p_numero_quema y p_km_previos (opcionales, compatibles con las
--    llamadas anteriores) y rechaza un odómetro menor al actual del vehículo con un mensaje claro.
--
-- Las vistas no cambian: el número de quema se lee de neumaticos (RLS por vehículo/sucursal ya
-- existente) y las columnas nuevas quedan cubiertas por los permisos de tabla actuales.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Columnas
-- -----------------------------------------------------------------------------
alter table public.neumaticos add column if not exists numero_quema text;
alter table public.neumaticos add column if not exists km_previos integer not null default 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'neumaticos_numero_quema_ck'
                  and conrelid = 'public.neumaticos'::regclass) then
    alter table public.neumaticos add constraint neumaticos_numero_quema_ck
      check (numero_quema is null
             or (numero_quema = btrim(numero_quema) and length(numero_quema) between 1 and 40));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'neumaticos_km_previos_ck'
                  and conrelid = 'public.neumaticos'::regclass) then
    alter table public.neumaticos add constraint neumaticos_km_previos_ck
      check (km_previos between 0 and 999999999);
  end if;
end
$$;

-- Normaliza antes del CHECK: recorta y convierte '' en NULL (también en escrituras directas del admin).
create or replace function public.neumaticos_normalizar_quema()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.numero_quema := nullif(btrim(new.numero_quema), '');
  return new;
end
$$;
revoke all on function public.neumaticos_normalizar_quema() from public, anon, authenticated;

drop trigger if exists neumaticos_normalizar_quema on public.neumaticos;
create trigger neumaticos_normalizar_quema
  before insert or update of numero_quema on public.neumaticos
  for each row execute function public.neumaticos_normalizar_quema();

-- Único por cliente cuando no es nulo, sin distinguir mayúsculas.
create unique index if not exists neumaticos_cliente_quema_uk
  on public.neumaticos (cliente_id, lower(numero_quema)) where numero_quema is not null;

-- -----------------------------------------------------------------------------
-- 2. neumatico_cambiar con número de quema y km previos
-- -----------------------------------------------------------------------------
-- Cambiar la firma crearía una segunda sobrecarga y las llamadas con los 7 argumentos anteriores
-- serían ambiguas: se elimina la firma vieja y la nueva la reemplaza (los argumentos nuevos
-- tienen valor por defecto, así que las llamadas por nombre o posicionales anteriores siguen valiendo).
drop function if exists public.neumatico_cambiar(bigint, smallint, text, text, integer, bigint, jsonb);

create or replace function public.neumatico_cambiar(
  p_vehiculo_id   bigint,
  p_posicion      smallint,
  p_destino_viejo text,
  p_motivo        text,
  p_odometro_km   integer default null,
  p_stock_id      bigint default null,
  p_nuevo         jsonb default null,
  p_numero_quema  text default null,
  p_km_previos    integer default 0
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
  v_quema    text := nullif(btrim(coalesce(p_numero_quema, '')), '');
  v_km_prev  integer := coalesce(p_km_previos, 0);
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
  v_odo_act  integer;
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
    raise exception 'indicar el motivo de la baja' using errcode = '22023';
  end if;
  if v_motivo is not null and length(v_motivo) > 200 then
    raise exception 'motivo demasiado largo (máx. 200)' using errcode = '22023';
  end if;
  if p_odometro_km is not null and p_odometro_km < 0 then
    raise exception 'odómetro negativo' using errcode = '23514';
  end if;
  -- El odómetro del vehículo es un dato aparte (opcional): si se informa, no puede bajar.
  -- El vehículo ya quedó bloqueado por neumatico_autorizar_vehiculo.
  if p_odometro_km is not null then
    select v.odometro_km into v_odo_act from public.vehiculos v where v.id = p_vehiculo_id;
    if v_odo_act is not null and p_odometro_km < v_odo_act then
      raise exception 'el odómetro del vehículo no puede ser menor al actual (% km)', v_odo_act
        using errcode = '23514';
    end if;
  end if;
  if v_km_prev < 0 or v_km_prev > 999999999 then
    raise exception 'km previos fuera de rango (0 a 999999999)' using errcode = '23514';
  end if;
  if v_quema is not null and length(v_quema) > 40 then
    raise exception 'número de quema demasiado largo (máx. 40)' using errcode = '22023';
  end if;
  if (p_stock_id is null) = (p_nuevo is null) then
    raise exception 'indicar el neumático nuevo: del stock o ingresado (uno solo)' using errcode = '22023';
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

  -- Número de quema: único por cliente, sin distinguir mayúsculas (el índice único lo respalda).
  if v_quema is not null and exists (
       select 1 from public.neumaticos n
        where n.cliente_id = v_aut.cliente_id and lower(n.numero_quema) = lower(v_quema)) then
    raise exception 'el número de quema ya está registrado en otro neumático' using errcode = '23505';
  end if;

  -- Neumático nuevo: del stock del MISMO cliente o ingresado a mano
  if p_stock_id is not null then
    if not v_aut.es_global then
      raise exception 'el stock lo gestiona el perfil global: ingresar el neumático nuevo a mano'
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
      raise exception 'indicar la marca del neumático nuevo' using errcode = '22023';
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
     idneumatico, codigo, auxilio, vida, estado, numero_quema, km_previos)
  values
    (p_vehiculo_id, v_aut.cliente_id, p_posicion, p_stock_id, v_marca, v_modelo, v_fecha_c, v_precio,
     v_idn, v_codigo, v_viejo.auxilio, v_vida_n, 'montado', v_quema, v_km_prev)
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
          p_odometro_km, v_precio,
          'Cambio de neumático: reemplaza a ' || coalesce(v_viejo.idneumatico, '#' || v_viejo.id)
            || coalesce(' · quema ' || v_quema, '')
            || case when v_km_prev > 0 then ' · ' || v_km_prev || ' km previos' else '' end,
          auth.uid())
  returning id into v_ev;
  v_ev_ids := v_ev_ids || v_ev;

  -- 4) Odómetro del vehículo: solo sube (ya se comprobó que no es menor al actual)
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
    'numero_quema', v_quema,
    'km_previos', v_km_prev,
    'stock_id', p_stock_id,
    'stock_restante', case when p_stock_id is not null then v_stock.cantidad - 1 end,
    'odometro_km', v_odo_veh,
    'eventos', to_jsonb(v_ev_ids));
end
$$;

revoke all on function public.neumatico_cambiar(bigint, smallint, text, text, integer, bigint, jsonb, text, integer) from public, anon;
grant execute on function public.neumatico_cambiar(bigint, smallint, text, text, integer, bigint, jsonb, text, integer) to authenticated;
