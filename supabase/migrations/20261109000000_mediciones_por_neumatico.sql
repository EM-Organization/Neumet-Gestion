-- =============================================================================
-- NEUMET · Las mediciones siguen al NEUMÁTICO, no a la posición
-- =============================================================================
-- Requiere 20261106000000_init_schema.sql, 20261106010000_api_proveedor.sql y
-- 20261106020000_producto_vistas.sql; usa eventos_neumatico.
-- Sin begin/commit: la herramienta que aplica la migración ya la envuelve.
-- Idempotente (create or replace + create index if not exists + revoke/grant).
--
-- Problema: v_ultima_medicion / v_estado_neumaticos tomaban la última medición por
-- (vehículo, POSICIÓN). Tras cambiar un neumático crítico, la rueda nueva seguía
-- mostrando los mm del viejo; tras rotar, el estado se quedaba en la posición.
--
-- Regla (documentada en docs/08-esquema-datos.md):
--   1. Una medición pertenece al neumático cuyo idneumatico coincide con el suyo,
--      esté donde esté ahora (rotación) y en el estado que sea.
--   2. Medición histórica con idneumatico NULL: se atribuye al neumático MONTADO
--      en su (vehículo, posición) solo si se cumplen las dos condiciones:
--        a) ese neumático no tiene NINGUNA medición con idneumatico; y
--        b) ningún evento de montaje/desmontaje/rotación/baja del vehículo tocó esa
--           posición (origen o destino) DESPUÉS de la medición.
--      Si no, la medición queda huérfana (no cuenta para el estado actual): es
--      preferible 'sin datos' a mostrar mm de otro neumático.
--   3. Posición sin ninguna fila en neumaticos: se conserva el comportamiento
--      anterior (última medición de la posición), pero solo con mediciones que no
--      son de un neumático conocido ni anteriores a un evento que movió esa posición.
--   4. Un neumático recién montado sin mediciones propias figura 'sin_datos' y
--      'sin medir'; no hereda nada de la posición.
--   5. La tasa de desgaste (regresión) se calcula por neumático.
-- v_alertas conserva su definición funcional (solo lee v_estado_neumaticos una vez en vez de cinco);
-- v_resumen_flota_cliente no cambia.
-- Las vistas conservan EXACTAMENTE sus columnas, security_invoker y grants.
-- =============================================================================

-- Búsqueda de mediciones por neumático (regla 1 y condición 2a).
create index if not exists mediciones_idneumatico_idx
  on public.mediciones (idneumatico, created_at desc) where idneumatico is not null;
-- Último evento por vehículo y posición (condición 2b).
create index if not exists eventos_neumatico_veh_fecha_idx
  on public.eventos_neumatico (vehiculo_id, created_at desc) where vehiculo_id is not null;

-- -----------------------------------------------------------------------------
-- 1. Mediciones atribuidas (una fila por medición atribuible)
-- -----------------------------------------------------------------------------
-- posicion_actual: dónde está HOY el neumático (no donde se midió).
-- estado_montaje: 'montado' | 'almacenado' | 'reparacion' | 'baja'; las posiciones
-- sin fila en neumaticos (regla 3) figuran 'montado' con neumatico_id NULL.
--
-- Plan robusto sin estadísticas (p. ej. base recién cargada sin ANALYZE): las sondas
-- correlacionadas van contra índices (mediciones por idneumatico y por vehículo/posición,
-- eventos por vehículo) y se evalúan por neumático, no por medición.
-- "Ningún evento posterior a la medición" = medición >= último evento de la posición.
create or replace view public.v_mediciones_neumatico
with (security_invoker = true) as
-- Regla 1: por idneumatico
select v.cliente_id, n.vehiculo_id, n.id as neumatico_id, n.idneumatico,
       n.estado as estado_montaje, n.posicion as posicion_actual,
       m.posicion as posicion_medicion, m.id as medicion_id,
       m.mm1, m.mm2, m.mm3, m.promedio, m.odometro_km, m.device_id, m.created_at,
       'idneumatico'::text as atribucion
from public.mediciones m
join public.neumaticos n on n.idneumatico = m.idneumatico
join public.vehiculos v on v.id = n.vehiculo_id
union all
-- Regla 2: histórico sin idneumatico -> neumático montado en esa posición.
-- Por cada neumático montado se calcula una vez su corte (último evento que movió la posición)
-- y si tiene mediciones etiquetadas; después se leen sus mediciones de posición por índice.
select v.cliente_id, n.vehiculo_id, n.id, n.idneumatico,
       n.estado, n.posicion,
       m.posicion, m.id,
       m.mm1, m.mm2, m.mm3, m.promedio, m.odometro_km, m.device_id, m.created_at,
       'posicion'::text
from public.neumaticos n
join public.vehiculos v on v.id = n.vehiculo_id
left join lateral (
  select max(e.created_at) as ultimo
  from public.eventos_neumatico e
  where e.vehiculo_id = n.vehiculo_id
    and e.tipo in ('montaje', 'desmontaje', 'rotacion', 'baja')
    and (e.posicion_origen = n.posicion or e.posicion_destino = n.posicion)
) ev on true
join public.mediciones m on m.vehiculo_id = n.vehiculo_id and m.posicion = n.posicion
where n.estado = 'montado'
  and m.idneumatico is null
  and (ev.ultimo is null or m.created_at >= ev.ultimo)
  and (n.idneumatico is null
       or not exists (select 1 from public.mediciones t where t.idneumatico = n.idneumatico))
union all
-- Regla 3: posición sin ninguna fila en neumaticos
select v.cliente_id, m.vehiculo_id, null::bigint, m.idneumatico,
       'montado'::text, m.posicion,
       m.posicion, m.id,
       m.mm1, m.mm2, m.mm3, m.promedio, m.odometro_km, m.device_id, m.created_at,
       'posicion'::text
from public.mediciones m
join public.vehiculos v on v.id = m.vehiculo_id
where not exists (select 1 from public.neumaticos np
                   where np.vehiculo_id = m.vehiculo_id and np.posicion = m.posicion)
  and (m.idneumatico is null
       or not exists (select 1 from public.neumaticos nt where nt.idneumatico = m.idneumatico))
  and not exists (select 1 from public.eventos_neumatico e
                   where e.vehiculo_id = m.vehiculo_id
                     and e.tipo in ('montaje', 'desmontaje', 'rotacion', 'baja')
                     and (e.posicion_origen = m.posicion or e.posicion_destino = m.posicion)
                     and e.created_at > m.created_at);

-- -----------------------------------------------------------------------------
-- 2. Última medición por posición ACTUAL = la del neumático montado ahí
-- -----------------------------------------------------------------------------
-- Mismas columnas que antes. posicion = posición actual del neumático.
create or replace view public.v_ultima_medicion
with (security_invoker = true) as
select distinct on (h.vehiculo_id, h.posicion_actual)
  h.cliente_id,
  h.vehiculo_id,
  h.posicion_actual as posicion,
  h.medicion_id,
  h.idneumatico,
  h.mm1, h.mm2, h.mm3,
  h.promedio,
  h.odometro_km,
  h.device_id,
  h.created_at
from public.v_mediciones_neumatico h
where h.estado_montaje = 'montado'
order by h.vehiculo_id, h.posicion_actual, h.created_at desc, h.medicion_id desc;

-- -----------------------------------------------------------------------------
-- 3. Estado por posición montada (tasa por neumático)
-- -----------------------------------------------------------------------------
-- Las mediciones atribuidas se calculan UNA vez (h, materializada) y de ahí salen la
-- última medición y la tasa; v_ultima_medicion equivale a u pero la vista no se
-- consulta aquí para no repetir el cálculo.
create or replace view public.v_estado_neumaticos
with (security_invoker = true) as
with h as materialized (
  select * from public.v_mediciones_neumatico where estado_montaje = 'montado'
),
-- Una sola pasada por neumático: última medición + tasa de los últimos 90 días (ventana por
-- neumático; las posiciones sin fila en neumaticos, por posición). Sin joins entre agregados.
u as materialized (
  select distinct on (x.vehiculo_id, x.posicion)
    x.vehiculo_id, x.posicion, x.idneumatico,
    x.mm1, x.mm2, x.mm3, x.promedio, x.odometro_km, x.created_at,
    x.n_mediciones_90d, x.n_fechas, x.slope_mm_s
  from (
    select h.vehiculo_id, h.posicion_actual as posicion, h.idneumatico, h.medicion_id,
      h.mm1, h.mm2, h.mm3, h.promedio, h.odometro_km, h.created_at,
      count(*) filter (where h.created_at >= now() - interval '90 days')
        over w as n_mediciones_90d,
      (max((h.created_at at time zone 'UTC')::date) filter (where h.created_at >= now() - interval '90 days') over w
        - min((h.created_at at time zone 'UTC')::date) filter (where h.created_at >= now() - interval '90 days') over w) as n_fechas,
      regr_slope(h.promedio::float8, extract(epoch from h.created_at))
        filter (where h.created_at >= now() - interval '90 days') over w as slope_mm_s
    from h
    window w as (partition by h.vehiculo_id, h.posicion_actual)
  ) x
  order by x.vehiculo_id, x.posicion, x.created_at desc, x.medicion_id desc
),
slots as materialized (
  select n.vehiculo_id, n.posicion, n.id as neumatico_id, n.idneumatico as neum_idneumatico,
         n.marca, n.modelo, n.vida, n.estado as estado_montaje
  from public.neumaticos n
  union all
  select u.vehiculo_id, u.posicion, null::bigint, null::text, null::text, null::text, null::smallint, null::text
  from u
  where not exists (select 1 from public.neumaticos n
                    where n.vehiculo_id = u.vehiculo_id and n.posicion = u.posicion)
),
b as (
  select
    v.cliente_id, s.vehiculo_id, v.nombre as vehiculo_nombre, v.patente, s.posicion,
    s.neumatico_id,
    coalesce(u.idneumatico, s.neum_idneumatico) as idneumatico,
    s.marca, s.modelo, s.vida,
    coalesce(s.estado_montaje, 'montado') as estado_montaje,
    u.mm1, u.mm2, u.mm3, u.promedio, u.odometro_km,
    u.created_at as ultima_medicion_at,
    case when u.created_at is null then null
         else floor(extract(epoch from now() - u.created_at) / 86400)::integer end as dias_desde_medicion,
    case when u.promedio is null               then 'sin_datos'
         when u.promedio < c.umbral_critico_mm then 'critico'
         when u.promedio < c.umbral_bajo_mm    then 'bajo'
         else 'ok' end as estado,
    case when u.created_at is null then s.neumatico_id is not null
         else u.created_at < now() - make_interval(days => c.dias_sin_medir_alerta) end as sin_medir,
    case when u.promedio is null then null
         else greatest(u.mm1, u.mm2, u.mm3) - least(u.mm1, u.mm2, u.mm3) end as diferencia_huellas_mm,
    coalesce(greatest(u.mm1, u.mm2, u.mm3) - least(u.mm1, u.mm2, u.mm3) > c.irregularidad_mm, false)
      as desgaste_irregular,
    coalesce(u.n_mediciones_90d, 0) as n_mediciones_90d,
    case when u.n_fechas >= 1 and u.slope_mm_s is not null
         then round((-u.slope_mm_s * 604800)::numeric, 3) end as tasa_mm_semana,
    c.umbral_bajo_mm, c.umbral_critico_mm, c.umbral_retiro_mm, c.dias_sin_medir_alerta
  from slots s
  join public.vehiculos v on v.id = s.vehiculo_id and v.activo
  join public.clientes  c on c.id = v.cliente_id and c.deleted_at is null
  left join u on u.vehiculo_id = s.vehiculo_id and u.posicion = s.posicion
  where coalesce(s.estado_montaje, 'montado') = 'montado'
)
select b.*,
  case when b.tasa_mm_semana > 0 and b.promedio is not null
       then round(greatest(b.promedio - b.umbral_critico_mm, 0) / b.tasa_mm_semana, 2) end as semanas_hasta_critico,
  case when b.tasa_mm_semana > 0 and b.promedio is not null
       then round(greatest(b.promedio - b.umbral_retiro_mm, 0) / b.tasa_mm_semana, 2) end  as semanas_hasta_retiro
from b;

-- -----------------------------------------------------------------------------
-- 3b. Alertas: v_estado_neumaticos se lee UNA vez (antes 5) y cada fila genera sus alertas
-- -----------------------------------------------------------------------------
-- Mismas columnas, tipos y reglas que 20261106020000; solo cambia la forma de la consulta.
create or replace view public.v_alertas
with (security_invoker = true) as
select e.cliente_id, e.vehiculo_id, e.vehiculo_nombre, e.patente, e.posicion, e.neumatico_id, e.idneumatico,
       a.tipo, a.severidad, a.valor, a.mensaje, e.ultima_medicion_at
from public.v_estado_neumaticos e
cross join lateral (
  select 'critico'::text as tipo, 3 as severidad, e.promedio as valor,
         format('Neumático crítico: %s mm (límite %s mm)', e.promedio, e.umbral_critico_mm) as mensaje
  where e.estado = 'critico'
  union all
  select 'bajo', 2, e.promedio,
         format('Desgaste bajo: %s mm (límite %s mm)', e.promedio, e.umbral_bajo_mm)
  where e.estado = 'bajo'
  union all
  select 'cruza_critico_pronto', 2, e.semanas_hasta_critico,
         format('Cruzará el nivel crítico en ~%s semanas', e.semanas_hasta_critico)
  where e.estado in ('ok', 'bajo') and e.semanas_hasta_critico <= 4
  union all
  select 'desgaste_irregular', 2, e.diferencia_huellas_mm,
         format('Desgaste irregular: %s mm entre huellas (máx. %s mm)', e.diferencia_huellas_mm,
                (select c.irregularidad_mm from public.clientes c where c.id = e.cliente_id))
  where e.desgaste_irregular
  union all
  select 'sin_medir', 1, e.dias_desde_medicion,
         case when e.ultima_medicion_at is null then 'Neumático montado sin ninguna medición'
              else format('Sin medir hace %s días (alerta a los %s)', e.dias_desde_medicion, e.dias_sin_medir_alerta) end
  where e.sin_medir
) a;

-- -----------------------------------------------------------------------------
-- 4. Permisos (iguales que las demás vistas de producto)
-- -----------------------------------------------------------------------------
revoke all on public.v_mediciones_neumatico, public.v_ultima_medicion, public.v_estado_neumaticos,
  public.v_alertas from public, anon;
grant select on public.v_mediciones_neumatico, public.v_ultima_medicion, public.v_estado_neumaticos,
  public.v_alertas to authenticated;

-- -----------------------------------------------------------------------------
-- 5. API de proveedor: solo neumáticos MONTADOS, con la medición del propio neumático
-- -----------------------------------------------------------------------------
-- Igual que 20261106010000 (mismo contrato JSON y privilegios) salvo:
--   * el join de mediciones va por neumático (v_mediciones_neumatico);
--   * solo los neumáticos 'montado': tras un cambio el viejo queda aparcado en
--     otra posición y no debe ofrecerse ni aceptar mediciones.
-- api_guardar_montaje ya inserta con el idneumatico del neumático actual de la posición.
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
    'data', v_data);
end
$$;

revoke all on function public.api_obtener_montaje(bigint, text, text) from public, anon, authenticated;
grant execute on function public.api_obtener_montaje(bigint, text, text) to service_role;

-- api_guardar_montaje: igual que 20261106010000 salvo "and estado = 'montado'" al
-- buscar el neumático de la posición (mismo montaje visible que api_obtener_montaje).
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

  for v_item in select * from jsonb_array_elements(p_montajes) loop
    v_pos := (v_item->>'posicion')::smallint;
    v_ok := false; v_motivo := null;
    begin   -- subtransacción (savepoint) por posición
      if v_item ? 'rechazar' and v_item->>'rechazar' is not null then
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
