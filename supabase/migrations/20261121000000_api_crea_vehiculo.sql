-- =============================================================================
-- NEUMET · API de proveedor: guardar_montaje_mm CREA el vehículo y sus neumáticos
-- =============================================================================
-- Requiere 20261112000000_api_sin_neumaticos.sql (api_guardar_montaje) y los índices únicos de
-- 20261106000000_init_schema.sql (vehiculos_cliente_patente_norm_uk).
-- Sin begin/commit: la herramienta que aplica la migración ya la envuelve.
-- Idempotente (create or replace + revoke/grant).
--
-- Decisión de producto (dueño, 2026-11-17): si la patente NO existe para el cliente de la cuenta
-- api, la misma request crea el vehículo y los neumáticos de las posiciones medidas, y guarda las
-- mediciones. Hoy respondía guardado:false motivo 'vehiculo' y no creaba nada. Siempre activo para
-- todas las cuentas api (sin bandera por cuenta).
--
-- Reglas:
--   * Unicidad de patente POR CLIENTE (vehiculos_cliente_patente_norm_uk): una patente que existe en
--     otro cliente no impide ni revela nada; se crea en el cliente del llamante (cliente_id sale del
--     perfil, nunca del cuerpo).
--   * Solo se crea si al menos UNA posición es válida (1..16 o 99, sin rechazo previo, con las tres
--     lecturas completas). Si ninguna lo es, respuesta idéntica a la de hoy (no_encontrado/'vehiculo'):
--     no se crea nada. Una posición inválida (rango, incompleta, mm3<>mm2, 17..98, sin medir) no crea
--     su neumático y se informa con su motivo; el auxilio (99) con los cuatro null es guardado:true
--     y no se persiste ni se crea.
--   * tipo_ruedas se DEDUCE de las posiciones recibidas: alguna 11..16 -> 16; si no, 10 (1..10 y 99).
--   * Neumáticos creados: sin marca, modelo, precio ni fecha de compra (se completan en el panel);
--     idneumatico estable 'API-<vehiculo_id>-P<posicion>' (único global por vehiculo_id); auxilio
--     solo en la posición 99. vehiculos.sucursal_id queda NULL: perfiles_sucursal_rol_ck impide
--     que una cuenta api tenga sucursal, así que el coche es visible para perfiles globales.
--   * Concurrencia: lock de transacción por (cliente, patente) antes de crear + insert ... on conflict
--     sobre el índice único; la request perdedora ve el coche ya creado y sigue el camino de siempre.
--   * Atomicidad: savepoint por posición (neumático + medición juntos). Si tras el bucle no se guardó
--     ninguna posición, se deshace el alta del vehículo y se responde como "no encontrado".
--   * Idempotencia: sin cambios; la respuesta (con creado/neumaticos_creados) se guarda y el replay la
--     repite sin crear de nuevo.
-- La respuesta a DAC no cambia de forma: el handler solo reenvía {posicion, guardado}.
-- =============================================================================

create or replace function public.api_guardar_montaje(
  p_cliente_id bigint, p_cuenta uuid, p_patente text, p_montajes jsonb,
  p_sesion uuid, p_clave text, p_hash text)
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
begin
  if jsonb_typeof(p_montajes) is distinct from 'array' then
    raise exception 'p_montajes debe ser un array';
  end if;

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

  select v.id into v_veh_id
    from public.vehiculos v
   where v.cliente_id = p_cliente_id and v.patente_norm = public.normalizar_patente(p_patente);

  if v_veh_id is null and v_pat is not null then
    -- Posiciones que justifican crear el coche: 1..16 o 99, sin rechazo previo y con las tres lecturas.
    select count(*) into v_nvalid
      from jsonb_array_elements(p_montajes) e
     where not (e ? 'rechazar' and e->>'rechazar' is not null)
       and ((e->>'posicion')::int between 1 and 16 or (e->>'posicion')::int = 99)
       and (e->>'mm1') is not null and (e->>'mm2') is not null and (e->>'mm3') is not null;
    if v_nvalid > 0 then
      -- Serializa altas simultáneas de la misma patente; el orden de locks (clave, patente) es fijo.
      perform pg_advisory_xact_lock(hashtextextended('alta|' || p_cliente_id::text || '|' || v_pat, 0));
      select v.id into v_veh_id from public.vehiculos v
       where v.cliente_id = p_cliente_id and v.patente_norm = v_pat;
      if v_veh_id is null then
        select case when exists (select 1 from jsonb_array_elements(p_montajes) e
                                  where (e->>'posicion')::int between 11 and 16) then 16 else 10 end
          into v_tipo;
        insert into public.vehiculos (cliente_id, nombre, patente, tipo_ruedas)
        values (p_cliente_id, v_pat, v_pat, v_tipo)
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
      if not v_tiene then
        v_motivo := 'sin_neumaticos';   -- el coche no tiene neumáticos cargados: nada que guardar
      elsif v_item ? 'rechazar' and v_item->>'rechazar' is not null then
        v_motivo := v_item->>'rechazar';
      elsif v_alta then
        -- Coche recién creado: el neumático se crea junto con su medición (mismo savepoint).
        if (v_item->>'mm1') is null and (v_item->>'mm2') is null and (v_item->>'mm3') is null then
          if v_pos = 99 then v_ok := true; else v_motivo := 'sin_medicion'; end if;   -- auxilio sin medir: ni se crea
        elsif (v_item->>'mm1') is null or (v_item->>'mm2') is null or (v_item->>'mm3') is null then
          v_motivo := 'incompleta';
        elsif not (v_pos between 1 and 16 or v_pos = 99) then
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

revoke all on function public.api_guardar_montaje(bigint, uuid, text, jsonb, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.api_guardar_montaje(bigint, uuid, text, jsonb, uuid, text, text) to service_role;
