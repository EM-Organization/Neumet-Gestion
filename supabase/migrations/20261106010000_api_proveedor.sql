-- =============================================================================
-- NEUMET · API de proveedor: idempotencia, rate limit y RPC (2026-11-06)
-- =============================================================================
-- Depende de 20261106000000_init_schema.sql. NO aplicada a ninguna base:
-- la aplica el director. Todo lo de esta migración es SOLO para service_role
-- (la Edge Function `api-proveedor`); anon/authenticated no tienen acceso.
-- Ver docs/07-api-proveedor.md (apéndice de decisiones).
-- =============================================================================

begin;

-- 1. Idempotencia ---------------------------------------------------------------
-- clave = 'k:<Idempotency-Key>' (TTL 24 h) o 'h:<hash del contenido>' (ventana 10 min).
create table if not exists public.api_idempotencia (
  cuenta     uuid        not null,
  clave      text        not null,
  respuesta  jsonb       not null,   -- {hash, resp}
  created_at timestamptz not null default now(),
  primary key (cuenta, clave)
);
create index if not exists api_idempotencia_created_idx on public.api_idempotencia (created_at);
alter table public.api_idempotencia enable row level security;   -- sin políticas
revoke all on public.api_idempotencia from public, anon, authenticated;
grant select, insert, update, delete on public.api_idempotencia to service_role;

-- 2. Rate limit (contadores por minuto) ---------------------------------------
create table if not exists public.api_rate_limit (
  cuenta  uuid        not null,
  ventana timestamptz not null,
  n       integer     not null default 0,
  primary key (cuenta, ventana)
);
create index if not exists api_rate_limit_ventana_idx on public.api_rate_limit (ventana);
alter table public.api_rate_limit enable row level security;     -- sin políticas
revoke all on public.api_rate_limit from public, anon, authenticated;
grant select, insert, update, delete on public.api_rate_limit to service_role;

-- api_rate_limit_hit: cuenta una petición; true = permitida, false = excedido.
create or replace function public.api_rate_limit_hit(p_cuenta uuid, p_max integer)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n integer;
begin
  insert into public.api_rate_limit as r (cuenta, ventana, n)
  values (p_cuenta, date_trunc('minute', now()), 1)
  on conflict (cuenta, ventana) do update set n = r.n + 1
  returning r.n into v_n;

  -- limpieza oportunista (~1 de cada 50 llamadas)
  if random() < 0.02 then
    delete from public.api_rate_limit where ventana < now() - interval '1 hour';
  end if;
  return v_n <= p_max;
end
$$;

-- 3. obtener montaje: UNA consulta, última medición por posición (DISTINCT ON) ----
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
    left join (
      select distinct on (me.posicion) me.posicion, me.mm1, me.mm2, me.mm3
        from public.mediciones me
       where me.vehiculo_id = v_veh.id and me.cliente_id = p_cliente_id
       order by me.posicion, me.created_at desc, me.id desc
    ) m on m.posicion = n.posicion
   where n.vehiculo_id = v_veh.id and n.idneumatico is not null;

  return jsonb_build_object('encontrado', true, 'vehiculo_id', v_veh.id,
    'matricula', coalesce(v_veh.patente_norm, ''), 'numero', coalesce(v_veh.numero, ''),
    'data', v_data);
end
$$;

-- 4. guardar montaje: atómico por request, fallo parcial por posición ------------
-- p_montajes: [{posicion, mm1, mm2, mm3, rechazar?}] con columnas YA mapeadas a BD
--   (la traducción API->BD ocurre en la Edge Function, mapping.ts).
-- Devuelve {estado: ok|no_encontrado|conflicto, replay, vehiculo_id, resultados:[{posicion,guardado,motivo}]}
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
         where vehiculo_id = v_veh_id and cliente_id = p_cliente_id and posicion = v_pos;
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

-- 5. Privilegios: solo service_role -------------------------------------------
revoke all on function public.api_rate_limit_hit(uuid, integer)  from public, anon, authenticated;
revoke all on function public.api_obtener_montaje(bigint, text, text) from public, anon, authenticated;
revoke all on function public.api_guardar_montaje(bigint, uuid, text, jsonb, uuid, text, text)
  from public, anon, authenticated;
grant execute on function public.api_rate_limit_hit(uuid, integer)  to service_role;
grant execute on function public.api_obtener_montaje(bigint, text, text) to service_role;
grant execute on function public.api_guardar_montaje(bigint, uuid, text, jsonb, uuid, text, text) to service_role;

commit;
