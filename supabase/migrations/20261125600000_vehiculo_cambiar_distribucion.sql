-- Cambiar la distribución de ruedas de un vehículo existente · apéndice W de docs/08.
-- Idempotente (el CI la aplica dos veces). Sin begin/commit.
--
-- Caso real: una carga inicial dejó vehículos con la distribución sin definir o equivocada, y la única salida era eliminar el
-- vehículo y crearlo de nuevo. Esta RPC corrige solo la distribución, con las mismas opciones que vehiculo_crear:
--   * un código del catálogo (public.distribucion_ruedas): tipo_ruedas se DERIVA (<= 10 ruedas -> 10; si no, 16);
--   * 'otra': el vehículo queda SIN distribución (NULL) con el tipo de ruedas (10 o 16) que se indique en p_tipo_ruedas.
-- Autoriza con neumatico_autorizar_vehiculo: administrador de empresa o usuario de la sucursal del vehículo (los mismos que
-- operan neumáticos). El equipo Neumet es de solo lectura, y api / sin perfil / otra empresa reciben 42501 uniforme.
-- No deja reducir por debajo de lo montado: si hay un neumático (no dado de baja) en una posición mayor que las ruedas de
-- la nueva distribución, se rechaza nombrando las posiciones. El auxilio (posición 99) no cuenta.
-- La base no audita cambios de vehículo (eventos_neumatico es por neumático), por lo que no se registra evento.

create or replace function public.vehiculo_cambiar_distribucion(
  p_vehiculo_id bigint, p_distribucion text, p_tipo_ruedas smallint default null)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_dist   text := lower(nullif(btrim(coalesce(p_distribucion, '')), ''));
  v_aut    record;
  v_tipo   smallint;
  v_dist_n text;
  v_ruedas integer;
  v_fuera  text;
  v_ant    text;
begin
  -- Autoriza y bloquea el vehículo (for update): dos cambios simultáneos se serializan.
  select * into v_aut from public.neumatico_autorizar_vehiculo(p_vehiculo_id);

  if v_dist is null then
    raise exception 'elegir la distribución' using errcode = '22023';
  end if;
  if v_dist = 'otra' then
    if p_tipo_ruedas is null or p_tipo_ruedas not in (10, 16) then
      raise exception 'tipo de ruedas inválido (10 o 16)' using errcode = '23514';
    end if;
    v_tipo := p_tipo_ruedas;
    v_dist_n := null;
    v_ruedas := p_tipo_ruedas;
  else
    if public.distribucion_ruedas(v_dist) is null then
      raise exception 'distribución inválida' using errcode = '23514';
    end if;
    v_dist_n := v_dist;
    v_ruedas := public.distribucion_ruedas(v_dist);
    v_tipo := case when v_ruedas <= 10 then 10 else 16 end;
  end if;

  -- Neumáticos vivos del vehículo: se bloquean antes de contar (un montaje concurrente no cambia el conjunto).
  perform 1 from public.neumaticos n
   where n.vehiculo_id = p_vehiculo_id and n.estado <> 'baja' order by n.id for update;

  select string_agg(n.posicion::text, ', ' order by n.posicion) into v_fuera
    from public.neumaticos n
   where n.vehiculo_id = p_vehiculo_id and n.estado <> 'baja'
     and n.posicion is not null and n.posicion <> 99 and n.posicion > v_ruedas;
  if v_fuera is not null then
    raise exception 'la distribución tiene % ruedas y hay neumáticos montados en las posiciones %: retirarlos o elegir otra distribución',
      v_ruedas, v_fuera using errcode = '23514';
  end if;

  select v.distribucion into v_ant from public.vehiculos v where v.id = p_vehiculo_id;
  update public.vehiculos v set distribucion = v_dist_n, tipo_ruedas = v_tipo where v.id = p_vehiculo_id;

  return jsonb_build_object('vehiculo_id', p_vehiculo_id, 'distribucion', v_dist_n, 'tipo_ruedas', v_tipo, 'anterior', v_ant);
end
$function$;

revoke all on function public.vehiculo_cambiar_distribucion(bigint, text, smallint) from public, anon;
grant execute on function public.vehiculo_cambiar_distribucion(bigint, text, smallint) to authenticated;
