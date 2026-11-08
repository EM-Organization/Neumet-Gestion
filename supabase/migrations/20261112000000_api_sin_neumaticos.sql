-- =============================================================================
-- NEUMET · API de proveedor: motivo explícito 'sin_neumaticos'
-- =============================================================================
-- Requiere 20261109000000_mediciones_por_neumatico.sql.
-- Sin begin/commit: la herramienta que aplica la migración ya la envuelve.
-- Idempotente (create or replace + revoke/grant).
--
-- Problema: si el vehículo existía pero no tenía ningún neumático montado con
-- idneumatico, api_guardar_montaje respondía cada posición con motivo 'posicion',
-- indistinguible de una posición inexistente en un coche que sí tiene neumáticos.
--
-- Regla nueva, solo en api_guardar_montaje:
--   * vehículo inexistente o de otro cliente -> 'vehiculo' (sin cambios, mismo camino);
--   * vehículo del cliente SIN neumáticos montados con idneumatico -> cada posición
--     enviada devuelve guardado:false, motivo 'sin_neumaticos' (prevalece sobre
--     rechazos de validación del cliente: no hay dónde guardar); estado global 'ok';
--   * vehículo con neumáticos pero posición inexistente -> 'posicion' (sin cambios).
-- No se escribe en mediciones en ninguno de esos casos. Idempotencia, replay,
-- conflicto y hash no cambian (la respuesta se guarda como antes).
--
-- api_obtener_montaje NO cambia: sigue devolviendo encontrado:true y data [] para
-- un coche sin neumáticos (contrato con DAC). El motivo solo viaja en la respuesta
-- de la RPC hacia la Edge Function, que lo registra en ingesta_log; la respuesta a
-- DAC conserva sus campos (guardados:[{posicion, guardado}]).
-- =============================================================================

-- api_guardar_montaje: igual que en 20261109000000 salvo v_tiene y el motivo 'sin_neumaticos'.
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

  if v_veh_id is null then
    -- Mismo resultado para "inexistente" y "de otro cliente".
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

  for v_item in select * from jsonb_array_elements(p_montajes) loop
    v_pos := (v_item->>'posicion')::smallint;
    v_ok := false; v_motivo := null;
    begin   -- subtransacción (savepoint) por posición
      if not v_tiene then
        v_motivo := 'sin_neumaticos';   -- el coche no tiene neumáticos cargados: nada que guardar
      elsif v_item ? 'rechazar' and v_item->>'rechazar' is not null then
        v_motivo := v_item->>'rechazar';
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

  v_out := jsonb_build_object('estado', 'ok', 'replay', false, 'vehiculo_id', v_veh_id, 'resultados', v_res);
  insert into public.api_idempotencia (cuenta, clave, respuesta)
  values (p_cuenta, p_clave, jsonb_build_object('hash', p_hash, 'resp', v_out));
  return v_out;
end
$$;

revoke all on function public.api_guardar_montaje(bigint, uuid, text, jsonb, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.api_guardar_montaje(bigint, uuid, text, jsonb, uuid, text, text) to service_role;
