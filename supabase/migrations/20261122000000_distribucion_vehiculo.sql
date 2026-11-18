-- =============================================================================
-- NEUMET · Distribución de neumáticos del vehículo (ejes simples y dobles)
-- =============================================================================
-- Requiere 20261110010000_gestion_sucursales.sql (vehiculo_crear), 20261109000000_mediciones_por_neumatico.sql
-- (api_obtener_montaje) y 20261121000000_api_crea_vehiculo.sql (api_guardar_montaje).
-- Sin begin/commit: la herramienta que aplica la migración ya la envuelve. Idempotente (el CI la aplica dos veces).
--
-- Decisión de producto (dueño, 2026-11-18): la numeración de los neumáticos va por eje, de adelante hacia atrás, y una
-- misma cantidad de ruedas admite varias disposiciones (eje doble o en línea). Si el operario ve un esquema distinto
-- del real mide un neumático por otro. Por eso cada vehículo guarda su distribución, elegida por quien lo conoce.
--
-- Catálogo (mismo que la app móvil y el panel; código AxB: A = posiciones de rueda, un par doble cuenta como una;
-- B = posiciones motrices; eje S = simple, 2 ruedas; eje D = doble, 4 ruedas; ejes de adelante hacia atrás):
--     4x2 = S,D       -> 6 ruedas        6x4 = S,D,D     -> 10 ruedas      8x4 = S,S,D,D -> 12 ruedas
--     6x2 = S,D,S     -> 8 ruedas        8x2 = S,S,D,S   -> 10 ruedas
-- Numeración: eje S = izquierda, derecha; eje D = izquierda exterior, izquierda interior, derecha interior, derecha exterior.
-- El auxilio no es parte de la distribución: sigue siendo la posición 99.
--
-- Qué hace:
--  1. vehiculos.distribucion (text, NULL): el código del catálogo. NULL = sin definir (los vehículos existentes y los que
--     crea la API sin informarla). El catálogo vive en public.distribucion_ruedas (única fuente en la base); ampliarlo
--     (hay cantidades pendientes: 2, 4, 14, 16 y 18 ruedas) es una migración que redefine esa función.
--  2. vehiculo_crear recibe p_distribucion (al final, con default null: las llamadas existentes no cambian). Con
--     distribución, tipo_ruedas se DERIVA (<= 10 ruedas -> 10; si no, 16) y p_tipo_ruedas se ignora; sin ella, todo como antes.
--  3. api_obtener_montaje devuelve 'distribucion' ('' si no está definida, como el resto de los textos ausentes).
--  4. api_guardar_montaje recibe p_distribucion (opcional):
--       * vehículo nuevo: se guarda con esa distribución, tipo_ruedas derivado y solo se crean posiciones 1..ruedas (más 99).
--       * vehículo existente SIN distribución: la adopta, salvo que su tipo_ruedas no coincida con el derivado.
--       * vehículo existente CON otra distribución, o adopción incompatible con su tipo_ruedas: ninguna posición se guarda
--         (guardado:false, motivo 'distribucion'). Las posiciones significan neumáticos distintos según la distribución;
--         guardarlas sería asignar lecturas al neumático equivocado. La respuesta a la app no cambia de forma.
--       * sin distribución: comportamiento idéntico al de siempre.
--  Las firmas anteriores se eliminan: con ambas, una llamada sin el parámetro nuevo sería ambigua.
--  Compatibilidad durante el despliegue: la función Edge solo envía p_distribucion cuando la app la informa.
-- =============================================================================

-- Los DDL de abajo toman ACCESS EXCLUSIVE sobre `vehiculos` (tabla en uso por la API): sin tope, una transacción larga ajena
-- haría esperar a la migración y, detrás, a todas las lecturas. Con 5 s falla limpiamente (se revierte entera) y se reintenta.
-- Este archivo no lleva begin/commit, así que se usa `set` de sesión y se devuelve con `reset` al final.
set lock_timeout = '5s';

-- -----------------------------------------------------------------------------
-- 1. Catálogo y columna
-- -----------------------------------------------------------------------------
-- Ruedas de una distribución (sin el auxilio); NULL si el código no pertenece al catálogo.
create or replace function public.distribucion_ruedas(p_id text)
returns smallint
language sql
immutable
parallel safe
set search_path = ''
as $$
  select case p_id
    when '4x2' then 6
    when '6x2' then 8
    when '6x4' then 10
    when '8x2' then 10
    when '8x4' then 12
  end::smallint
$$;
revoke all on function public.distribucion_ruedas(text) from public, anon;
grant execute on function public.distribucion_ruedas(text) to authenticated, service_role;

alter table public.vehiculos add column if not exists distribucion text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'vehiculos_distribucion_ck' and conrelid = 'public.vehiculos'::regclass) then
    alter table public.vehiculos
      add constraint vehiculos_distribucion_ck
      check (distribucion is null or public.distribucion_ruedas(distribucion) is not null);
  end if;
end
$$;

comment on column public.vehiculos.distribucion is
  'Distribución de ejes y neumáticos (4x2, 6x2, 6x4, 8x2, 8x4; ver public.distribucion_ruedas). NULL = sin definir. Define qué neumático es cada posición.';

-- -----------------------------------------------------------------------------
-- 2. vehiculo_crear: distribución elegida al crear el vehículo
-- -----------------------------------------------------------------------------
drop function if exists public.vehiculo_crear(text, text, smallint, bigint, bigint);

create or replace function public.vehiculo_crear(
  p_numero        text,
  p_patente       text default null,
  p_tipo_ruedas   smallint default 10,
  p_sucursal_id   bigint default null,
  p_cliente_id    bigint default null,
  p_distribucion  text default null
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
  v_dist    text := nullif(btrim(coalesce(p_distribucion, '')), '');
  v_tipo    smallint := p_tipo_ruedas;
  v_id      bigint;
begin
  select * into v_aut from public.sucursal_autorizar_gestion(p_cliente_id);
  if v_numero is null or length(v_numero) > 50 then
    raise exception 'número de coche inválido (1 a 50 caracteres)' using errcode = '23514';
  end if;
  if v_patente is not null and length(v_patente) > 20 then
    raise exception 'matrícula demasiado larga (máx. 20)' using errcode = '23514';
  end if;
  if v_dist is not null then
    if public.distribucion_ruedas(v_dist) is null then
      raise exception 'distribución inválida' using errcode = '23514';
    end if;
    -- Con distribución, el tipo sale de ella (el mismo criterio que la API: más de 10 ruedas -> 16).
    v_tipo := case when public.distribucion_ruedas(v_dist) <= 10 then 10 else 16 end;
  elsif v_tipo is null or v_tipo not in (10, 16) then
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
  insert into public.vehiculos (cliente_id, nombre, numero, patente, tipo_ruedas, sucursal_id, distribucion)
  values (v_aut.cliente_id, 'Coche ' || v_numero, v_numero, v_patente, v_tipo, p_sucursal_id, v_dist)
  returning id into v_id;
  return jsonb_build_object('id', v_id, 'cliente_id', v_aut.cliente_id, 'sucursal_id', p_sucursal_id);
end
$$;
revoke all on function public.vehiculo_crear(text, text, smallint, bigint, bigint, text) from public, anon;
grant execute on function public.vehiculo_crear(text, text, smallint, bigint, bigint, text) to authenticated;

-- -----------------------------------------------------------------------------
-- 3. api_obtener_montaje: informa la distribución del vehículo
-- -----------------------------------------------------------------------------
create or replace function public.api_obtener_montaje(
  p_cliente_id bigint, p_matricula text, p_numero text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_veh public.vehiculos%rowtype;
  v_mat text := public.normalizar_patente(p_matricula);
  v_num text := nullif(btrim(coalesce(p_numero, '')), '');
  v_data jsonb;
begin
  -- El cliente sale SIEMPRE del parámetro (perfil), nunca del cuerpo.
  select * into v_veh
    from public.vehiculos v
   where v.cliente_id = p_cliente_id
     and ((v_mat is not null and v.patente_norm = v_mat)
          or (v_mat is null and v_num is not null and v.numero = v_num))
   limit 1;

  if not found then
    return jsonb_build_object('encontrado', false, 'matricula', '', 'numero', '', 'data', '[]'::jsonb);
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
           'idneumatico', n.idneumatico, 'codigo', coalesce(n.codigo, ''),
           'posicion', n.posicion, 'auxilio', n.auxilio,
           'mm1', m.mm1, 'mm2', m.mm2, 'mm3', m.mm3) order by n.posicion), '[]'::jsonb)
    into v_data
    from public.neumaticos n
    left join lateral (
      select h.mm1, h.mm2, h.mm3
        from public.v_mediciones_neumatico h
       where h.neumatico_id = n.id and h.cliente_id = p_cliente_id
       order by h.created_at desc, h.medicion_id desc
       limit 1
    ) m on true
   where n.vehiculo_id = v_veh.id and n.idneumatico is not null and n.estado = 'montado';

  return jsonb_build_object('encontrado', true, 'vehiculo_id', v_veh.id,
    'matricula', coalesce(v_veh.patente_norm, ''), 'numero', coalesce(v_veh.numero, ''),
    'distribucion', coalesce(v_veh.distribucion, ''),
    'data', v_data);
end
$$;

revoke all on function public.api_obtener_montaje(bigint, text, text) from public, anon, authenticated;
grant execute on function public.api_obtener_montaje(bigint, text, text) to service_role;

-- -----------------------------------------------------------------------------
-- 4. api_guardar_montaje: distribución opcional
-- -----------------------------------------------------------------------------
drop function if exists public.api_guardar_montaje(bigint, uuid, text, jsonb, uuid, text, text);

create or replace function public.api_guardar_montaje(
  p_cliente_id bigint, p_cuenta uuid, p_patente text, p_montajes jsonb,
  p_sesion uuid, p_clave text, p_hash text, p_distribucion text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_prev   public.api_idempotencia%rowtype;
  v_veh_id bigint;
  v_item   jsonb;
  v_n      public.neumaticos%rowtype;
  v_res    jsonb := '[]'::jsonb;
  v_pos    smallint;
  v_ok     boolean;
  v_motivo text;
  v_tiene  boolean;
  v_out    jsonb;
  v_alta   boolean := false;   -- esta request crea el vehículo
  v_ncre   integer := 0;       -- neumáticos creados por esta request
  v_tipo   smallint;
  v_pat    text := public.normalizar_patente(p_patente);
  v_nvalid integer;
  v_dist     text := nullif(btrim(coalesce(p_distribucion, '')), '');
  v_ruedas   smallint := public.distribucion_ruedas(nullif(btrim(coalesce(p_distribucion, '')), ''));
  v_max      smallint;          -- posición máxima que admite un vehículo nuevo
  v_veh_tipo smallint;
  v_veh_dist text;
  v_conf     boolean := false;  -- la distribución informada no es compatible con la del vehículo
begin
  if jsonb_typeof(p_montajes) is distinct from 'array' then
    raise exception 'p_montajes debe ser un array';
  end if;
  -- El handler ya valida contra el catálogo; esto cubre una llamada directa con un código ajeno.
  if v_dist is not null and v_ruedas is null then
    raise exception 'distribución inválida' using errcode = '22023';
  end if;
  v_max := coalesce(v_ruedas, 16);   -- sin distribución, el rango de siempre (1..16)

  delete from public.api_idempotencia where created_at < now() - interval '24 hours';

  -- Serializa reintentos concurrentes de la misma clave.
  perform pg_advisory_xact_lock(hashtextextended(p_cuenta::text || '|' || p_clave, 0));

  select * into v_prev from public.api_idempotencia where cuenta = p_cuenta and clave = p_clave;
  if found then
    if left(p_clave, 2) = 'h:' and v_prev.created_at < now() - interval '10 minutes' then
      delete from public.api_idempotencia where cuenta = p_cuenta and clave = p_clave;
    elsif v_prev.respuesta->>'hash' is distinct from p_hash then
      return jsonb_build_object('estado', 'conflicto', 'replay', false, 'resultados', '[]'::jsonb);
    else
      return (v_prev.respuesta->'resp') || jsonb_build_object('replay', true);
    end if;
  end if;

  select v.id, v.tipo_ruedas, v.distribucion into v_veh_id, v_veh_tipo, v_veh_dist
    from public.vehiculos v
   where v.cliente_id = p_cliente_id and v.patente_norm = public.normalizar_patente(p_patente)
   for update;   -- serializa la adopción: dos requests con claves distintas no se pisan la distribución

  if v_veh_id is not null and v_dist is not null then
    -- Vehículo existente: la distribución informada debe ser la suya; si no tiene, solo se adopta una compatible con su tipo.
    if v_veh_dist is not null then
      v_conf := v_veh_dist is distinct from v_dist;
    else
      v_conf := (case when v_ruedas <= 10 then 10 else 16 end) is distinct from v_veh_tipo;
      if not v_conf then
        update public.vehiculos set distribucion = v_dist where id = v_veh_id;
      end if;
    end if;
  end if;

  if v_veh_id is null and v_pat is not null then
    -- Posiciones que justifican crear el coche: 1..max (16 sin distribución) o 99, sin rechazo previo y con las tres lecturas.
    select count(*) into v_nvalid
      from jsonb_array_elements(p_montajes) e
     where not (e ? 'rechazar' and e->>'rechazar' is not null)
       and ((e->>'posicion')::int between 1 and v_max or (e->>'posicion')::int = 99)
       and (e->>'mm1') is not null and (e->>'mm2') is not null and (e->>'mm3') is not null;
    if v_nvalid > 0 then
      -- Serializa altas simultáneas de la misma patente; el orden de locks (clave, patente) es fijo.
      perform pg_advisory_xact_lock(hashtextextended('alta|' || p_cliente_id::text || '|' || v_pat, 0));
      select v.id into v_veh_id from public.vehiculos v
       where v.cliente_id = p_cliente_id and v.patente_norm = v_pat;
      if v_veh_id is null then
        -- Con distribución el tipo se deriva de ella; sin ella, de las posiciones recibidas.
        select case when v_ruedas is not null then (case when v_ruedas <= 10 then 10 else 16 end)
                    when exists (select 1 from jsonb_array_elements(p_montajes) e
                                  where (e->>'posicion')::int between 11 and 16) then 16
                    else 10 end
          into v_tipo;
        insert into public.vehiculos (cliente_id, nombre, patente, tipo_ruedas, distribucion)
        values (p_cliente_id, v_pat, v_pat, v_tipo, v_dist)
        on conflict (cliente_id, patente_norm) where patente_norm is not null do nothing
        returning id into v_veh_id;
        v_alta := v_veh_id is not null;
        if v_veh_id is null then   -- defensa: otro commit ganó la carrera pese al lock
          select v.id into v_veh_id from public.vehiculos v
           where v.cliente_id = p_cliente_id and v.patente_norm = v_pat;
        end if;
      end if;
    end if;
  end if;

  if v_veh_id is null then
    -- Mismo resultado para "inexistente" y "de otro cliente" (y para nada válido que crear).
    for v_item in select * from jsonb_array_elements(p_montajes) loop
      v_res := v_res || jsonb_build_object('posicion', (v_item->>'posicion')::int,
                                           'guardado', false, 'motivo', 'vehiculo');
    end loop;
    return jsonb_build_object('estado', 'no_encontrado', 'replay', false, 'resultados', v_res);
  end if;

  -- Mismo montaje visible que api_obtener_montaje: montados con idneumatico.
  select exists (select 1 from public.neumaticos n
                  where n.vehiculo_id = v_veh_id and n.cliente_id = p_cliente_id
                    and n.idneumatico is not null and n.estado = 'montado')
    into v_tiene;
  if v_alta then v_tiene := true; end if;

  for v_item in select * from jsonb_array_elements(p_montajes) loop
    v_pos := (v_item->>'posicion')::smallint;
    v_ok := false; v_motivo := null;
    begin   -- subtransacción (savepoint) por posición
      if v_conf then
        v_motivo := 'distribucion';     -- la numeración informada no es la del vehículo: no se guarda nada
      elsif not v_tiene then
        v_motivo := 'sin_neumaticos';   -- el coche no tiene neumáticos cargados: nada que guardar
      elsif v_item ? 'rechazar' and v_item->>'rechazar' is not null then
        v_motivo := v_item->>'rechazar';
      elsif v_alta then
        -- Coche recién creado: el neumático se crea junto con su medición (mismo savepoint).
        if (v_item->>'mm1') is null and (v_item->>'mm2') is null and (v_item->>'mm3') is null then
          if v_pos = 99 then v_ok := true; else v_motivo := 'sin_medicion'; end if;   -- auxilio sin medir: ni se crea
        elsif (v_item->>'mm1') is null or (v_item->>'mm2') is null or (v_item->>'mm3') is null then
          v_motivo := 'incompleta';
        elsif not (v_pos between 1 and v_max or v_pos = 99) then
          v_motivo := 'posicion';
        else
          insert into public.neumaticos (vehiculo_id, cliente_id, posicion, idneumatico, auxilio)
          values (v_veh_id, p_cliente_id, v_pos, 'API-' || v_veh_id::text || '-P' || v_pos::text, v_pos = 99)
          returning * into v_n;
          insert into public.mediciones
            (vehiculo_id, cliente_id, device_id, patente_raw, numero_raw, posicion,
             mm1, mm2, mm3, promedio, idneumatico, sesion_id)
          values
            (v_veh_id, p_cliente_id, 'api:' || p_cuenta::text, p_patente, '', v_pos,
             (v_item->>'mm1')::numeric, (v_item->>'mm2')::numeric, (v_item->>'mm3')::numeric,
             0, v_n.idneumatico, p_sesion);
          v_ok := true;
          v_ncre := v_ncre + 1;
        end if;
      else
        select * into v_n from public.neumaticos
         where vehiculo_id = v_veh_id and cliente_id = p_cliente_id and posicion = v_pos
           and idneumatico is not null and estado = 'montado';   -- mismo montaje visible que api_obtener_montaje
        if not found then
          v_motivo := 'posicion';
        elsif (v_item->>'mm1') is null and (v_item->>'mm2') is null and (v_item->>'mm3') is null then
          if v_n.auxilio then
            v_ok := true;            -- auxilio sin medir: nada que persistir, no es error ni cero
          else
            v_motivo := 'sin_medicion';
          end if;
        elsif (v_item->>'mm1') is null or (v_item->>'mm2') is null or (v_item->>'mm3') is null then
          v_motivo := 'incompleta';
        else
          insert into public.mediciones
            (vehiculo_id, cliente_id, device_id, patente_raw, numero_raw, posicion,
             mm1, mm2, mm3, promedio, idneumatico, sesion_id)
          values
            (v_veh_id, p_cliente_id, 'api:' || p_cuenta::text, p_patente, '', v_pos,
             (v_item->>'mm1')::numeric, (v_item->>'mm2')::numeric, (v_item->>'mm3')::numeric,
             0, v_n.idneumatico, p_sesion);   -- promedio lo recalcula el trigger
          v_ok := true;
        end if;
      end if;
    exception when others then
      v_ok := false; v_motivo := 'error';
    end;
    v_res := v_res || jsonb_build_object('posicion', v_pos, 'guardado', v_ok, 'motivo', v_motivo);
  end loop;

  if v_alta and v_ncre = 0 then
    -- Ninguna posición llegó a guardarse (fallo inesperado en todas): no queda un coche vacío.
    delete from public.vehiculos where id = v_veh_id;
    v_res := '[]'::jsonb;
    for v_item in select * from jsonb_array_elements(p_montajes) loop
      v_res := v_res || jsonb_build_object('posicion', (v_item->>'posicion')::int,
                                           'guardado', false, 'motivo', 'vehiculo');
    end loop;
    return jsonb_build_object('estado', 'no_encontrado', 'replay', false, 'resultados', v_res);
  end if;

  v_out := jsonb_build_object('estado', 'ok', 'replay', false, 'vehiculo_id', v_veh_id, 'resultados', v_res)
           || case when v_alta then jsonb_build_object('creado', true, 'neumaticos_creados', v_ncre) else '{}'::jsonb end;
  insert into public.api_idempotencia (cuenta, clave, respuesta)
  values (p_cuenta, p_clave, jsonb_build_object('hash', p_hash, 'resp', v_out));
  return v_out;
end
$$;

revoke all on function public.api_guardar_montaje(bigint, uuid, text, jsonb, uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.api_guardar_montaje(bigint, uuid, text, jsonb, uuid, text, text, text) to service_role;

reset lock_timeout;
