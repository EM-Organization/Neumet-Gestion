-- =============================================================================
-- NEUMET · Migración B del plan de roles (docs/17 §5 y §9, PR 6): uso mensual por cliente
-- =============================================================================
-- Requiere 20261106000000_init_schema.sql (ingesta_log, mediciones, perfiles, is_admin) y
-- 20261106020000_producto_vistas.sql. Sin begin/commit; idempotente (el CI la aplica dos veces).
--
-- Qué agrega:
--   1. Índices para agregar por cliente y mes sobre ingesta_log y mediciones.
--   2. uso_cliente_mensual: una fila por (cliente, mes), permanente. Sin grants ni políticas: solo la leen las RPC.
--   3. uso_cerrar_mes(p_mes): función de cierre. SOLO servicio (y el rol dueño, que es el de pg_cron). NO se programa aquí:
--      programarla con pg_cron es un paso operativo posterior (docs/11).
--   4. uso_clientes_listar(...): RPC de lectura para el panel; solo el equipo Neumet (docs/17 §5), 42501 al resto.
--
-- Qué cuenta (todo por mes calendario UTC):
--   * api_llamadas / api_por_endpoint: filas de ingesta_log con cliente_id del mes, EXCLUYENDO endpoint = 'login'
--     (el login se cuenta aparte en `logins`; contarlo en ambos lo duplicaría). Por endpoint y estado (ok|rechazado|error).
--   * logins: ingesta_log con endpoint = 'login' (api-proveedor solo registra los exitosos, desde 2026-11-16).
--   * mediciones: filas de mediciones con cliente_id del mes.
--   Estos tres son RECALCULABLES: volver a cerrar un mes los reescribe desde ingesta_log y mediciones.
--   * vehiculos_activos, dispositivos_activos (activos y con alguna medición en el mes), usuarios (perfiles `cliente`,
--     no `api`) y ultimo_ingreso_at (max auth.users.last_sign_in_at de esos usuarios) son FOTOS del primer cierre:
--     un re-cierre no las pisa (no se pueden reconstruir hacia atrás). ultimo_ingreso_at es el último ingreso a la fecha
--     del cierre, no dentro del mes.
-- Uso NO es para facturar (docs/17 P5). Solo se puede cerrar un mes ya terminado.
-- =============================================================================

-- 1. Índices ------------------------------------------------------------------
create index if not exists ingesta_log_cliente_recibido_idx on public.ingesta_log (cliente_id, recibido_at);
-- mediciones ya tiene mediciones_cliente_fecha_idx (cliente_id, created_at desc): sirve a las consultas del cierre; no se agrega otro.

-- 2. Tabla ---------------------------------------------------------------------
create table if not exists public.uso_cliente_mensual (
  cliente_id           bigint not null references public.clientes (id) on delete restrict,
  mes                  date   not null,                 -- primer día del mes (UTC)
  api_llamadas         integer not null default 0 check (api_llamadas >= 0),
  api_por_endpoint     jsonb   not null default '{}'::jsonb,   -- {"endpoint": {"ok": n, "rechazado": n, "error": n}}
  logins               integer not null default 0 check (logins >= 0),
  mediciones           integer not null default 0 check (mediciones >= 0),
  vehiculos_activos    integer not null default 0 check (vehiculos_activos >= 0),   -- foto del primer cierre
  dispositivos_activos integer not null default 0 check (dispositivos_activos >= 0), -- foto del primer cierre
  usuarios             integer not null default 0 check (usuarios >= 0),            -- foto del primer cierre
  ultimo_ingreso_at    timestamptz,                                                 -- foto del primer cierre
  cerrado_at           timestamptz not null default now(),                          -- primer cierre
  primary key (cliente_id, mes),
  constraint uso_cliente_mensual_mes_ck check (mes = date_trunc('month', mes)::date)
);
alter table public.uso_cliente_mensual enable row level security;
-- Sin políticas ni grants: los privilegios por defecto de public dan todo a anon y authenticated, por eso se revocan.
revoke all on table public.uso_cliente_mensual from public, anon, authenticated;

-- 3. Cierre ---------------------------------------------------------------------
-- p_mes nulo = el mes anterior. Devuelve cuántas filas (clientes) escribió. Reejecutable: mismo resultado.
create or replace function public.uso_cerrar_mes(p_mes date default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actual date := date_trunc('month', now() at time zone 'UTC')::date;
  v_mes    date := date_trunc('month', coalesce(p_mes, (v_actual - interval '1 month')::date))::date;
  v_ini    timestamptz;
  v_fin    timestamptz;
  v_n      integer;
begin
  if v_mes >= v_actual then
    raise exception 'solo se cierra un mes ya terminado' using errcode = '22023';
  end if;
  v_ini := v_mes::timestamp at time zone 'UTC';
  v_fin := (v_mes + interval '1 month')::timestamp at time zone 'UTC';
  perform pg_advisory_xact_lock(hashtext('uso_cerrar_mes'));

  with clientes_mes as (
    select c.id from public.clientes c
    where c.created_at < v_fin and (c.deleted_at is null or c.deleted_at >= v_ini)
  ), por_ep as (
    select l.cliente_id, coalesce(l.endpoint, '(sin endpoint)') as endpoint,
           jsonb_object_agg(l.status, l.n) as estados, sum(l.n)::integer as total
    from (select cliente_id, endpoint, status, count(*) as n from public.ingesta_log
          where recibido_at >= v_ini and recibido_at < v_fin and cliente_id is not null
            and endpoint is distinct from 'login'
          group by cliente_id, endpoint, status) l
    group by l.cliente_id, coalesce(l.endpoint, '(sin endpoint)')
  ), api as (
    select cliente_id, jsonb_object_agg(endpoint, estados) as por_endpoint, sum(total)::integer as total
    from por_ep group by cliente_id
  ), lg as (
    select cliente_id, count(*)::integer as n from public.ingesta_log
    where recibido_at >= v_ini and recibido_at < v_fin and cliente_id is not null and endpoint = 'login'
    group by cliente_id
  ), me as (
    select cliente_id, count(*)::integer as n from public.mediciones
    where created_at >= v_ini and created_at < v_fin and cliente_id is not null
    group by cliente_id
  )
  insert into public.uso_cliente_mensual as u
    (cliente_id, mes, api_llamadas, api_por_endpoint, logins, mediciones,
     vehiculos_activos, dispositivos_activos, usuarios, ultimo_ingreso_at)
  select cm.id, v_mes,
         coalesce(api.total, 0), coalesce(api.por_endpoint, '{}'::jsonb), coalesce(lg.n, 0), coalesce(me.n, 0),
         (select count(*)::integer from public.vehiculos v where v.cliente_id = cm.id and v.activo),
         (select count(*)::integer from public.dispositivos d
           where d.cliente_id = cm.id and d.activo
             and exists (select 1 from public.mediciones m
                         where m.device_id = d.mac_address and m.created_at >= v_ini and m.created_at < v_fin)),
         (select count(*)::integer from public.perfiles p where p.cliente_id = cm.id and p.rol = 'cliente'),
         (select max(au.last_sign_in_at) from public.perfiles p
            join auth.users au on au.id = p.user_id
           where p.cliente_id = cm.id and p.rol = 'cliente')
  from clientes_mes cm
  left join api on api.cliente_id = cm.id
  left join lg  on lg.cliente_id  = cm.id
  left join me  on me.cliente_id  = cm.id
  on conflict (cliente_id, mes) do update
    set api_llamadas = excluded.api_llamadas, api_por_endpoint = excluded.api_por_endpoint,
        logins = excluded.logins, mediciones = excluded.mediciones;   -- las fotos del primer cierre no se pisan
  get diagnostics v_n = row_count;
  return v_n;
end
$$;
revoke all on function public.uso_cerrar_mes(date) from public, anon, authenticated;
grant execute on function public.uso_cerrar_mes(date) to service_role;

-- 4. RPC de lectura para el panel (solo equipo Neumet) -----------------------------
create or replace function public.uso_clientes_listar(
  p_desde date default null, p_hasta date default null, p_cliente_id bigint default null)
returns table (
  cliente_id bigint, cliente_nombre text, mes date, api_llamadas integer, api_por_endpoint jsonb, logins integer,
  mediciones integer, vehiculos_activos integer, dispositivos_activos integer, usuarios integer,
  ultimo_ingreso_at timestamptz, cerrado_at timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (select public.is_admin()) then
    raise exception 'no autorizado' using errcode = '42501';
  end if;
  return query
    select u.cliente_id, c.nombre, u.mes, u.api_llamadas, u.api_por_endpoint, u.logins, u.mediciones,
           u.vehiculos_activos, u.dispositivos_activos, u.usuarios, u.ultimo_ingreso_at, u.cerrado_at
    from public.uso_cliente_mensual u
    join public.clientes c on c.id = u.cliente_id
    where (p_desde is null or u.mes >= date_trunc('month', p_desde)::date)
      and (p_hasta is null or u.mes <= date_trunc('month', p_hasta)::date)
      and (p_cliente_id is null or u.cliente_id = p_cliente_id)
    order by u.mes desc, c.nombre, u.cliente_id;
end
$$;
revoke all on function public.uso_clientes_listar(date, date, bigint) from public, anon;
grant execute on function public.uso_clientes_listar(date, date, bigint) to authenticated;
