-- =============================================================================
-- NEUMET · La rueda de auxilio no cuenta como advertencia de desgaste
-- =============================================================================
-- Requiere 20261123000000_categorias_desgaste.sql. Sin begin/commit. Idempotente.
--
-- Regla de negocio: el auxilio (la rueda en la posición 99) casi siempre tiene poca vida útil,
-- así que su mayor desgaste / desgaste límite no es una advertencia. Se sigue mostrando con su estado y su
-- medición (v_estado_neumaticos no cambia) y sigue en el total de neumáticos.
--
-- UNA sola regla en SQL y JS: es auxilio la rueda que está en la posición 99. La posición manda; el indicador
-- neumaticos.auxilio no es confiable (v_estado_neumaticos no lo expone y neumatico_rotar no lo mantenía).
--  1. alerta_sincronizar: el auxilio nunca abre alerta; las abiertas de una rueda que pasa a 99 se resuelven con
--     resuelta_motivo = 'sin_datos' (no se borra nada). Al salir de 99 el trigger de neumaticos la reevalúa y,
--     si sigue en límite, abre alerta.
--  2. v_alertas: excluye las alertas de una rueda en 99 (por su posición actual).
--  3. v_resumen_flota_cliente: su mayor desgaste / límite se cuenta como poco desgaste (mismas columnas).
--  4. neumatico_rotar mantiene auxilio = (posicion = 99) y ya no aparca en 99 durante el intercambio (cerraría
--     la alerta de una rueda de ruta por un instante); solo usa 99 si no queda otra posición libre.
--  5. Sincroniza el dato: auxilio = (posicion = 99) en los neumáticos montados.
--  6. Reevaluación inicial de todos los clientes.
-- La misma regla vive en assets/js/domain/auxilio.js.
-- =============================================================================

-- 1. alerta_sincronizar
create or replace function public.alerta_sincronizar(p_cliente_id bigint, p_neumaticos bigint[] default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := now();
begin
  if p_cliente_id is null then
    return;
  end if;

  -- 1. El neumático ya no está montado: cambio o baja.
  update public.alertas a
     set estado = 'resuelta', resuelta_at = v_now, updated_at = v_now, silenciada_hasta = null,
         resuelta_motivo = case when n.estado = 'baja' then 'baja' else 'cambio' end
    from public.neumaticos n
   where n.id = a.neumatico_id
     and a.cliente_id = p_cliente_id
     and a.estado <> 'resuelta'
     and n.estado <> 'montado'
     and (p_neumaticos is null or a.neumatico_id = any (p_neumaticos));

  -- 2. Neumáticos montados: cierra, actualiza, reabre o abre.
  with e as (
    select s.neumatico_id, s.vehiculo_id, s.posicion, s.idneumatico, s.promedio, s.ultima_medicion_at,
           c.umbral_retiro_mm as umbral, c.alerta_histeresis_mm as hist,
           -- Regla del auxilio: su poca vida útil es normal, no es advertencia. Es auxilio la rueda en la posición 99.
           (s.posicion = 99) as auxilio
      from public.v_estado_neumaticos s
      join public.clientes c on c.id = s.cliente_id
     where s.cliente_id = p_cliente_id
       and s.neumatico_id is not null
       and (p_neumaticos is null or s.neumatico_id = any (p_neumaticos))
  ),
  cierra as (
    update public.alertas a
       set estado = 'resuelta', resuelta_at = v_now, updated_at = v_now, silenciada_hasta = null,
           resuelta_motivo = case when e.promedio is null or e.auxilio then 'sin_datos' else 'recuperada' end,
           mm_actual = coalesce(e.promedio, a.mm_actual), umbral_mm = e.umbral,
           vehiculo_id = e.vehiculo_id, posicion = e.posicion
      from e
     where e.neumatico_id = a.neumatico_id
       and a.estado <> 'resuelta'
       and (e.promedio is null or e.auxilio or e.promedio >= e.umbral + e.hist)
     returning a.neumatico_id
  ),
  sigue as (
    update public.alertas a
       set mm_actual = e.promedio, mm_minimo = least(a.mm_minimo, e.promedio), umbral_mm = e.umbral,
           vehiculo_id = e.vehiculo_id, posicion = e.posicion, idneumatico = e.idneumatico,
           ultima_medicion_at = e.ultima_medicion_at, updated_at = v_now
      from e
     where e.neumatico_id = a.neumatico_id
       and a.estado <> 'resuelta'
       and e.promedio is not null
       and not e.auxilio
       and e.promedio < e.umbral + e.hist
     returning a.neumatico_id
  ),
  candidatos as (
    -- Neumáticos en desgaste límite sin alerta no resuelta (el promedio nulo nunca genera alerta).
    select e.* from e
     where e.promedio is not null
       and not e.auxilio
       and e.promedio < e.umbral
       and not exists (select 1 from public.alertas x
                        where x.neumatico_id = e.neumatico_id and x.estado <> 'resuelta')
  ),
  reabre as (
    update public.alertas a
       set estado = 'abierta', resuelta_at = null, resuelta_motivo = null, resuelta_por = null, nota_resolucion = null,
           reconocida_at = null, reconocida_por = null, nota_reconocida = null,
           silenciada_hasta = null, silencio_motivo = null, silenciada_por = null,
           veces_reabierta = a.veces_reabierta + 1, abierta_at = v_now, updated_at = v_now,
           mm_apertura = k.promedio, mm_minimo = k.promedio, mm_actual = k.promedio, umbral_mm = k.umbral,
           vehiculo_id = k.vehiculo_id, posicion = k.posicion, idneumatico = k.idneumatico,
           ultima_medicion_at = k.ultima_medicion_at
      from (select u.id as alerta_id, c.*
              from candidatos c
              -- Solo la última alerta resuelta del neumático, y solo si fue por recuperación reciente.
              cross join lateral (select r.id, r.resuelta_motivo, r.resuelta_at
                                    from public.alertas r
                                   where r.neumatico_id = c.neumatico_id and r.estado = 'resuelta'
                                   order by r.resuelta_at desc, r.id desc limit 1) u
             where u.resuelta_motivo = 'recuperada'
               and u.resuelta_at >= v_now - interval '7 days') k
     where a.id = k.alerta_id
    returning a.neumatico_id
  )
  insert into public.alertas (cliente_id, vehiculo_id, neumatico_id, posicion, idneumatico, umbral_mm,
                              mm_apertura, mm_minimo, mm_actual, ultima_medicion_at)
  select p_cliente_id, c.vehiculo_id, c.neumatico_id, c.posicion, c.idneumatico, c.umbral,
         c.promedio, c.promedio, c.promedio, c.ultima_medicion_at
    from candidatos c
   where c.neumatico_id not in (select neumatico_id from reabre)
  on conflict (neumatico_id) where estado <> 'resuelta' do nothing;
end
$$;
revoke all on function public.alerta_sincronizar(bigint, bigint[]) from public, anon, authenticated;

-- 2. v_alertas
create or replace view public.v_alertas
with (security_invoker = true) as
select a.cliente_id, a.vehiculo_id, v.nombre as vehiculo_nombre, v.patente, a.posicion, a.neumatico_id, a.idneumatico,
       a.tipo, 3 as severidad, a.mm_actual::numeric as valor,
       format('Desgaste límite: %s mm (umbral %s mm)', replace(trim_scale(a.mm_actual)::text, '.', ','),
              replace(trim_scale(a.umbral_mm)::text, '.', ',')) as mensaje,
       a.ultima_medicion_at,
       a.id as alerta_id, a.estado, a.umbral_mm, a.mm_apertura, a.mm_minimo, a.abierta_at, a.reconocida_at,
       a.silenciada_hasta, a.veces_reabierta
from public.alertas a
join public.vehiculos v on v.id = a.vehiculo_id
left join public.neumaticos n on n.id = a.neumatico_id
join public.clientes c on c.id = a.cliente_id and c.deleted_at is null
where a.estado <> 'resuelta'
  -- El auxilio (la rueda en la posición 99) no genera advertencias; manda la posición actual del neumático.
  and coalesce(n.posicion, a.posicion) is distinct from 99;

revoke all on public.v_alertas from public, anon;
grant select on public.v_alertas to authenticated;

-- 3. v_resumen_flota_cliente
create or replace view public.v_resumen_flota_cliente
with (security_invoker = true) as
select
  c.id as cliente_id,
  c.nombre,
  coalesce(veh.n, 0)         as n_vehiculos_activos,
  coalesce(e.n_con_datos, 0) as n_neumaticos_con_datos,
  coalesce(e.n_nuevo, 0)     as n_ok,
  coalesce(e.n_poco_desgaste, 0) as n_bajo,
  coalesce(e.n_mayor_desgaste, 0) as n_mayor_desgaste,
  coalesce(e.n_desgaste_limite, 0) as n_critico,
  coalesce(e.n_desconocido, 0) as n_sin_datos,
  coalesce(a.sev1, 0)        as n_alertas_sev1,
  coalesce(a.sev2, 0)        as n_alertas_sev2,
  coalesce(a.sev3, 0)        as n_alertas_sev3,
  mm.ultima_medicion_at
from public.clientes c
left join (select cliente_id, count(*) as n from public.vehiculos where activo group by cliente_id) veh
       on veh.cliente_id = c.id
left join (select cliente_id,
                  count(*) filter (where estado <> 'desconocido') as n_con_datos,
                  count(*) filter (where estado = 'nuevo')         as n_nuevo,
                  count(*) filter (where estado = 'poco_desgaste')       as n_poco_desgaste,
                  count(*) filter (where estado = 'mayor_desgaste')    as n_mayor_desgaste,
                  count(*) filter (where estado = 'desgaste_limite')    as n_desgaste_limite,
                  count(*) filter (where estado = 'desconocido')  as n_desconocido
           -- Auxilio: sigue en el total, pero su mayor desgaste / desgaste límite cuenta como poco desgaste.
           from (select s.cliente_id,
                        case when s.estado in ('mayor_desgaste', 'desgaste_limite')
                                  and s.posicion = 99
                             then 'poco_desgaste' else s.estado end as estado
                   from public.v_estado_neumaticos s) s
          group by cliente_id) e on e.cliente_id = c.id
left join (select cliente_id,
                  count(*) filter (where severidad = 1) as sev1,
                  count(*) filter (where severidad = 2) as sev2,
                  count(*) filter (where severidad = 3) as sev3
           from public.v_alertas group by cliente_id) a on a.cliente_id = c.id
left join (select cliente_id, max(created_at) as ultima_medicion_at
           from public.mediciones where cliente_id is not null group by cliente_id) mm
       on mm.cliente_id = c.id
where c.deleted_at is null;

revoke all on public.v_resumen_flota_cliente from authenticated, public, anon;
grant select on public.v_resumen_flota_cliente to authenticated;

-- 4. neumatico_rotar: mantiene auxilio = (posicion = 99) y no aparca en 99 mientras intercambia.
-- Misma lógica y autorización que 20261108000000; cambia el aparcamiento y el indicador auxilio.
-- El índice único de un auxilio por vehículo se respeta en cada paso: el indicador solo es true en 99.
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
    -- Posición de aparcamiento: la más alta libre por debajo de 99 (en 99 la rueda contaría como auxilio un
    -- instante y el trigger le cerraría la alerta). 99 solo si no queda otra.
    select g into v_tmp
      from generate_series(98, 1, -1) g
     where not exists (select 1 from public.neumaticos n
                        where n.vehiculo_id = p_vehiculo_id and n.posicion = g)
     limit 1;
    if v_tmp is null and not exists (select 1 from public.neumaticos n
                                      where n.vehiculo_id = p_vehiculo_id and n.posicion = 99) then
      v_tmp := 99;
    end if;
    if v_tmp is null then
      raise exception 'no hay posición libre para intercambiar' using errcode = '53400';
    end if;
    update public.neumaticos set posicion = v_tmp,   auxilio = (v_tmp = 99)   where id = v_a.id;
    update public.neumaticos set posicion = p_pos_a, auxilio = (p_pos_a = 99) where id = v_b.id;
    update public.neumaticos set posicion = p_pos_b, auxilio = (p_pos_b = 99) where id = v_a.id;
  else
    update public.neumaticos set posicion = p_pos_b, auxilio = (p_pos_b = 99) where id = v_a.id;
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

-- 5. Sincronizar el dato: auxilio = (posicion = 99) en los montados. Dos pasos para respetar el índice único
-- de un auxilio por vehículo (primero se libera, luego se asigna). No dispara el trigger de alertas (no mira auxilio).
update public.neumaticos set auxilio = false
 where estado = 'montado' and vehiculo_id is not null and auxilio and posicion is distinct from 99;
update public.neumaticos set auxilio = true
 where estado = 'montado' and vehiculo_id is not null and posicion = 99 and not auxilio;

-- 6. Reevaluación inicial
select public.alerta_sincronizar(c.id, null) from public.clientes c where c.deleted_at is null;
