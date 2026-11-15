-- =============================================================================
-- NEUMET · Migración A del plan de roles (docs/17 §4.1, PR 2): administración de empresa
-- =============================================================================
-- Requiere 20261106000000_init_schema.sql (perfiles, audit_row, is_admin), 20261107020000_seccionales.sql
-- (perfiles.sucursal_id y email, sucursales), 20261108000000_cambio_neumatico.sql (vehiculos) y
-- 20261118500000_alerta_critica.sql (alerta_configurar).
-- Sin begin/commit: la herramienta que aplica la migración ya la envuelve. Idempotente (el CI la aplica dos veces).
--
-- Qué agrega (nada se quita: el front vigente sigue funcionando; el recorte para el equipo Neumet es la migración C2):
--   1. admin_empresa_cliente_id(): única definición de «administrador de empresa» (perfil `cliente` sin sucursal).
--   2. accesos_quitados: auditoría de bajas de acceso (con emails de todas las empresas: sin ningún grant a
--      authenticated ni anon; solo la leen las RPC SECURITY DEFINER y el servicio).
--   3. usuarios_empresa_listar, usuario_empresa_quitar_acceso, usuario_empresa_reponer_acceso y
--      accesos_quitados_marcar_auth (solo servicio, para las Edge Functions del PR 3).
--   4. vehiculo_corregir_odometro: el administrador de empresa baja un kilometraje.
--   5. alerta_configurar ampliada: todos los umbrales y huella_absurda_mm.
--   6. audit_row rotula al actor como 'admin_empresa' o 'sucursal' (antes 'cliente').
--
-- «Quitar acceso» = borrar la fila de perfiles: toda ruta de autorización ya niega a quien no tiene fila (docs/17 §4.1),
-- así que no hay indicador de estado que olvidar. Se anula además clientes.auth_user_id del usuario en TODA empresa
-- (si no, decidirRol lo mostraría como cliente vinculado en lugar de «Sin acceso»). El usuario de Auth no se borra
-- ni se bloquea aquí: eso lo hace la Edge Function con la clave de servicio (PR 3).
-- Toda precondición no cumplida responde 42501 (uniforme: no revela si el usuario existe en otra empresa). Excepciones,
-- porque el operario puede corregirlas: quitarse a sí mismo (22023), quitar al último administrador (23514), sucursal
-- destino inexistente (22023) y valores fuera de rango (23514 / 22023).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. admin_empresa_cliente_id()
-- -----------------------------------------------------------------------------
-- cliente_id del administrador de empresa (rol 'cliente' sin sucursal) o NULL. NULL también para el equipo Neumet
-- (rol 'admin'), el usuario de sucursal, 'api', quien no tiene perfil y el administrador de una empresa dada de baja
-- (clientes.deleted_at): las RPC nuevas la reutilizan, así que ninguna opera sobre una empresa dada de baja.
create or replace function public.admin_empresa_cliente_id()
returns bigint
language sql
stable
security definer
set search_path = ''
as $$
  select p.cliente_id from public.perfiles p
  where p.user_id = (select auth.uid()) and p.rol = 'cliente' and p.sucursal_id is null
    and exists (select 1 from public.clientes c where c.id = p.cliente_id and c.deleted_at is null)
$$;
revoke all on function public.admin_empresa_cliente_id() from public, anon;
grant execute on function public.admin_empresa_cliente_id() to authenticated;

-- -----------------------------------------------------------------------------
-- 2. accesos_quitados
-- -----------------------------------------------------------------------------
-- Una fila por baja. «La más reciente del usuario» (mayor id) es la única que autoriza reintentos o reposición.
-- user_id sin clave foránea: la auditoría debe sobrevivir a un usuario de Auth borrado; el email se copia al quitar.
create table if not exists public.accesos_quitados (
  id                        bigint generated always as identity primary key,
  cliente_id                bigint not null references public.clientes (id) on delete cascade,
  user_id                   uuid   not null,
  email                     text,
  rol                       text   not null,
  sucursal_id               bigint,             -- sucursal previa; puede haberse borrado después (sin FK)
  clientes_desvinculados    bigint[] not null default '{}',  -- clientes.auth_user_id anulados al quitar
  quitado_por               uuid   not null,
  quitado_at                timestamptz not null default now(),
  repuesto_por              uuid,
  repuesto_at               timestamptz,
  bloqueo_auth_aplicado_at  timestamptz,        -- la Edge Function bloqueó al usuario en Auth
  bloqueo_auth_levantado_at timestamptz         -- la Edge Function levantó el bloqueo al reponer
);
create index if not exists accesos_quitados_user_idx    on public.accesos_quitados (user_id, id desc);
create index if not exists accesos_quitados_cliente_idx on public.accesos_quitados (cliente_id, quitado_at desc);

alter table public.accesos_quitados enable row level security;
-- Sin políticas ni grants: contiene los emails de todas las empresas. Los privilegios por defecto de public dan todo a
-- anon y authenticated, por eso se revocan explícitamente (la migración corre dos veces: el revoke es idempotente).
revoke all on table public.accesos_quitados from public, anon, authenticated;
revoke all on sequence public.accesos_quitados_id_seq from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- 3a. accesos_quitados_marcar_auth: solo servicio; devuelve siempre el estado vigente
-- -----------------------------------------------------------------------------
-- Es lo que las Edge Functions (PR 3) leen para converger con Auth (docs/17 §4.1): NO rechaza, devuelve el estado
-- vigente del usuario (`tiene_perfil`) y si la marca se escribió. p_marca nulo = solo lectura. Escribe únicamente si la
-- marca es cierta, bajo el bloqueo de la fila más reciente del usuario: 'aplicado' si p_id es la más reciente, no está
-- repuesta y el perfil sigue ausente; 'levantado' si es la más reciente, está repuesta y el perfil está presente.
-- Ninguna marca condiciona una decisión: son informativas.
-- `id` es el pedido; `ultima_*` describen la fila MÁS RECIENTE del usuario (que puede ser otra: ver `es_la_mas_reciente`).
create or replace function public.accesos_quitados_marcar_auth(p_id bigint, p_marca text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user   uuid;
  v_ult    public.accesos_quitados%rowtype;
  v_perfil boolean;
  v_ok     boolean := false;
begin
  if p_id is null then
    raise exception 'parámetros obligatorios' using errcode = '22004';
  end if;
  if p_marca is not null and p_marca not in ('aplicado', 'levantado') then
    raise exception 'marca desconocida' using errcode = '22023';
  end if;
  select a.user_id into v_user from public.accesos_quitados a where a.id = p_id;
  if not found then
    return jsonb_build_object('id', p_id, 'existe', false, 'tiene_perfil', null, 'escrita', false);
  end if;
  select * into v_ult from public.accesos_quitados a where a.user_id = v_user order by a.id desc limit 1 for update;
  select exists (select 1 from public.perfiles p where p.user_id = v_user) into v_perfil;

  if p_marca = 'aplicado' and v_ult.id = p_id and v_ult.repuesto_at is null and not v_perfil then
    v_ok := true;
    update public.accesos_quitados a set bloqueo_auth_aplicado_at = coalesce(a.bloqueo_auth_aplicado_at, now())
     where a.id = p_id returning * into v_ult;
  elsif p_marca = 'levantado' and v_ult.id = p_id and v_ult.repuesto_at is not null and v_perfil then
    v_ok := true;
    update public.accesos_quitados a set bloqueo_auth_levantado_at = coalesce(a.bloqueo_auth_levantado_at, now())
     where a.id = p_id returning * into v_ult;
  end if;
  return jsonb_build_object('id', p_id, 'existe', true, 'tiene_perfil', v_perfil, 'escrita', v_ok,
    'es_la_mas_reciente', v_ult.id = p_id, 'ultima_repuesta', v_ult.repuesto_at is not null,
    'ultima_bloqueo_auth_aplicado_at', v_ult.bloqueo_auth_aplicado_at,
    'ultima_bloqueo_auth_levantado_at', v_ult.bloqueo_auth_levantado_at);
end
$$;
revoke all on function public.accesos_quitados_marcar_auth(bigint, text) from public, anon, authenticated;
grant execute on function public.accesos_quitados_marcar_auth(bigint, text) to service_role;

-- -----------------------------------------------------------------------------
-- 3b. usuarios_empresa_listar
-- -----------------------------------------------------------------------------
-- Usuarios del cliente con su alcance, su email real (de auth.users: perfiles.email es nulo para el primer usuario) y su
-- estado. Los quitados usan solo el email copiado en accesos_quitados al quitar (sin leer auth.users). Incluye a los quitados (la fila más reciente sin reponer y sin perfil): «Reponer acceso» los necesita.
-- Administrador de empresa: solo su cliente (p_cliente_id se ignora si es nulo; si no coincide, 42501).
-- Equipo Neumet: debe indicar p_cliente_id y lo recibe en solo lectura. Los demás roles: 42501.
-- Las cuentas 'api' no se listan aquí (cuentas_api_listar).
create or replace function public.usuarios_empresa_listar(p_cliente_id bigint default null)
returns table (
  user_id               uuid,
  email                 text,
  alcance               text,
  sucursal_id           bigint,
  sucursal_nombre       text,
  estado                text,
  desde                 timestamptz,
  acceso_id             bigint,
  bloqueo_auth_pendiente boolean
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cli bigint;
begin
  if auth.uid() is null then
    raise exception 'permiso denegado' using errcode = '42501';
  end if;
  if public.is_admin() then
    if p_cliente_id is null then
      raise exception 'parámetros obligatorios' using errcode = '22004';
    end if;
    v_cli := p_cliente_id;
  else
    v_cli := public.admin_empresa_cliente_id();
    if v_cli is null or (p_cliente_id is not null and p_cliente_id <> v_cli) then
      raise exception 'permiso denegado' using errcode = '42501';
    end if;
  end if;

  return query
    select p.user_id, coalesce(u.email::text, p.email),
           case when p.sucursal_id is null then 'empresa' else 'sucursal' end,
           p.sucursal_id, s.nombre, 'vigente'::text, p.created_at, null::bigint, false
      from public.perfiles p
      left join auth.users u on u.id = p.user_id
      left join public.sucursales s on s.id = p.sucursal_id and s.cliente_id = p.cliente_id
     where p.cliente_id = v_cli and p.rol = 'cliente'
    union all
    select a.user_id, a.email,
           case when a.sucursal_id is null then 'empresa' else 'sucursal' end,
           a.sucursal_id, s.nombre, 'quitado'::text, a.quitado_at, a.id, (a.bloqueo_auth_aplicado_at is null)
      from public.accesos_quitados a
      left join public.sucursales s on s.id = a.sucursal_id and s.cliente_id = a.cliente_id
     where a.cliente_id = v_cli
       and a.repuesto_at is null
       and a.id = (select max(a2.id) from public.accesos_quitados a2 where a2.user_id = a.user_id)
       and not exists (select 1 from public.perfiles p2 where p2.user_id = a.user_id)
     order by 6, 3, 2;
end
$$;
revoke all on function public.usuarios_empresa_listar(bigint) from public, anon;
grant execute on function public.usuarios_empresa_listar(bigint) to authenticated;

-- -----------------------------------------------------------------------------
-- 3c. usuario_empresa_quitar_acceso
-- -----------------------------------------------------------------------------
-- Estados de éxito: 'quitado' (baja hecha ahora) y 'ya_quitado' (reintento de una baja que sigue vigente; la Edge
-- Function converge con Auth tenga o no la marca). Todo lo demás es error.
-- Baja nueva o reintento los decide quien llama con p_acceso_id (la baja que reintenta, la `acceso_id` que devolvió
-- 'quitado' o que lista usuarios_empresa_listar), no la presencia del perfil: con solo p_user_id no se distingue un
-- reintento que perdió frente a «reponer» de una baja nueva pedida a propósito.
--   p_acceso_id nulo: baja nueva. El objetivo debe tener perfil de este cliente; sin perfil, 42501.
--   p_acceso_id dado: reintento de esa baja. Solo vale si el perfil del usuario sigue ausente y la fila es de este
--     cliente, de ese usuario, la más reciente y sin reponer; con perfil presente (p. ej. «reponer» ganó la carrera) o
--     cualquier otra cosa, 42501, sin escribir nada.
-- Concurrencia: se bloquean (for update, order by user_id: orden determinista, sin 40P01) los administradores vigentes
-- del cliente ANTES de validar. Dos que se quitan a la vez se serializan; el actor se valida después, dentro del
-- conjunto bloqueado: si otro ya lo quitó, su fila no está y recibe 42501 en lugar de quitar a un tercero.
-- Orden de bloqueos (común a reponer): filas de perfiles primero, fila de auditoría después.
-- Se elimina la firma de un parámetro: quedaría como una segunda ruta de baja nueva sin la distinción.
drop function if exists public.usuario_empresa_quitar_acceso(uuid);
create or replace function public.usuario_empresa_quitar_acceso(p_user_id uuid, p_acceso_id bigint default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid     uuid := auth.uid();
  v_cli     bigint;
  v_admins  uuid[];
  v_t       public.perfiles%rowtype;
  v_ult     public.accesos_quitados%rowtype;
  v_email   text;
  v_desv    bigint[];
  v_id      bigint;
begin
  if v_uid is null then
    raise exception 'permiso denegado' using errcode = '42501';
  end if;
  v_cli := public.admin_empresa_cliente_id();
  if v_cli is null then
    raise exception 'permiso denegado' using errcode = '42501';
  end if;
  if p_user_id is null then
    raise exception 'parámetros obligatorios' using errcode = '22004';
  end if;

  select array_agg(x.user_id order by x.user_id) into v_admins
    from (select p.user_id from public.perfiles p
           where p.cliente_id = v_cli and p.rol = 'cliente' and p.sucursal_id is null
           order by p.user_id for update) x;
  if v_admins is null or not (v_uid = any (v_admins)) then
    raise exception 'permiso denegado' using errcode = '42501';
  end if;
  if p_user_id = v_uid then
    raise exception 'no se puede quitar el acceso propio' using errcode = '22023';
  end if;

  -- Solo se bloquea el perfil si es de este cliente (no se toca ni se espera por filas de otra empresa).
  select * into v_t from public.perfiles p where p.user_id = p_user_id and p.cliente_id = v_cli for update;
  if not found then
    -- Sin perfil de este cliente: o es un reintento (p_acceso_id) o no hay nada que quitar. Si el usuario tiene perfil
    -- en otra empresa tampoco hay reintento que valga.
    if p_acceso_id is null or exists (select 1 from public.perfiles p where p.user_id = p_user_id) then
      raise exception 'permiso denegado' using errcode = '42501';
    end if;
    select * into v_ult from public.accesos_quitados a where a.user_id = p_user_id order by a.id desc limit 1 for update;
    if not found or v_ult.id <> p_acceso_id or v_ult.cliente_id <> v_cli or v_ult.repuesto_at is not null then
      raise exception 'permiso denegado' using errcode = '42501';
    end if;
    return jsonb_build_object('estado', 'ya_quitado', 'acceso_id', v_ult.id, 'user_id', p_user_id);
  end if;

  -- Con perfil presente solo cabe una baja nueva: un p_acceso_id es un reintento que perdió frente a «reponer».
  if p_acceso_id is not null or v_t.rol <> 'cliente' then
    raise exception 'permiso denegado' using errcode = '42501';
  end if;
  -- Defensa, no ejercitable hoy: con el actor distinto del objetivo y dentro del conjunto bloqueado siempre queda al
  -- menos uno, así que el 23514 no se alcanza; se deja explícito por si un cambio futuro altera la validación del actor.
  if v_t.sucursal_id is null and cardinality(array_remove(v_admins, p_user_id)) < 1 then
    raise exception 'no se puede quitar al último administrador de la empresa' using errcode = '23514';
  end if;

  select u.email::text into v_email from auth.users u where u.id = p_user_id;
  -- (a) vínculo clientes.auth_user_id en CUALQUIER cliente (el trigger no recrea el perfil: new.auth_user_id es nulo)
  select coalesce(array_agg(c.id order by c.id), '{}') into v_desv from public.clientes c where c.auth_user_id = p_user_id;
  update public.clientes c set auth_user_id = null where c.auth_user_id = p_user_id;
  -- (b) rastro, con rol y sucursal previos para poder reponer
  insert into public.accesos_quitados (cliente_id, user_id, email, rol, sucursal_id, clientes_desvinculados, quitado_por)
  values (v_cli, p_user_id, coalesce(v_email, v_t.email), v_t.rol, v_t.sucursal_id, v_desv, v_uid)
  returning id into v_id;
  -- (c) la baja: sin fila, toda ruta de autorización niega
  delete from public.perfiles p where p.user_id = p_user_id;

  return jsonb_build_object('estado', 'quitado', 'acceso_id', v_id, 'user_id', p_user_id, 'email', coalesce(v_email, v_t.email));
end
$$;
revoke all on function public.usuario_empresa_quitar_acceso(uuid, bigint) from public, anon;
grant execute on function public.usuario_empresa_quitar_acceso(uuid, bigint) to authenticated;

-- -----------------------------------------------------------------------------
-- 3d. usuario_empresa_reponer_acceso
-- -----------------------------------------------------------------------------
-- p_acceso_id: fila de accesos_quitados (viene de usuarios_empresa_listar). p_sucursal_id: destino; nulo = el alcance
-- previo (la sucursal original o toda la empresa); debe ser del mismo cliente y, si la original se borró, hay que
-- elegir otra (22023).
-- Estados de éxito: 'repuesto' (perfil insertado ahora) y 'ya_repuesto' (el usuario ya tiene perfil: la segunda de dos
-- llamadas simultáneas, un reintento, o un usuario reasignado por el equipo Neumet tras quitarlo; también cuando la fila
-- de auditoría no está repuesta). En ambos casos la Edge Function converge con Auth. Cualquier otra precondición: 42501.
-- Con perfil ausente solo vale la fila MÁS RECIENTE del usuario, de este cliente y sin reponer. Con perfil presente basta
-- que el perfil sea de este cliente o que la fila más reciente lo sea (así otra empresa no obtiene nada).
-- No aplica la regla del último administrador (repone) ni restituye clientes.auth_user_id (el perfil basta).
-- Dos «reponer» a la vez se serializan sobre la fila más reciente del usuario: nunca 23505.
create or replace function public.usuario_empresa_reponer_acceso(p_acceso_id bigint, p_sucursal_id bigint default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_cli    bigint;
  v_user   uuid;
  v_ult    public.accesos_quitados%rowtype;
  v_suc    bigint;
  v_perf   public.perfiles%rowtype;
begin
  if v_uid is null then
    raise exception 'permiso denegado' using errcode = '42501';
  end if;
  v_cli := public.admin_empresa_cliente_id();
  if v_cli is null then
    raise exception 'permiso denegado' using errcode = '42501';
  end if;
  if p_acceso_id is null then
    raise exception 'parámetros obligatorios' using errcode = '22004';
  end if;
  -- Primero la fila de perfil del actor (que sigue siendo administrador de este cliente), después la de auditoría:
  -- el mismo orden que quitar, así que no hay ciclo de bloqueos.
  perform 1 from public.perfiles p
   where p.user_id = v_uid and p.rol = 'cliente' and p.sucursal_id is null and p.cliente_id = v_cli for share;
  if not found then
    raise exception 'permiso denegado' using errcode = '42501';
  end if;

  select a.user_id into v_user from public.accesos_quitados a where a.id = p_acceso_id;
  if not found then
    raise exception 'permiso denegado' using errcode = '42501';
  end if;
  select * into v_ult from public.accesos_quitados a where a.user_id = v_user order by a.id desc limit 1 for update;

  select * into v_perf from public.perfiles p where p.user_id = v_user;
  if found then
    if v_perf.cliente_id is distinct from v_cli and v_ult.cliente_id <> v_cli then
      raise exception 'permiso denegado' using errcode = '42501';
    end if;
    return jsonb_build_object('estado', 'ya_repuesto', 'repuesto_ahora', false, 'acceso_id', v_ult.id, 'user_id', v_user);
  end if;

  if v_ult.id <> p_acceso_id or v_ult.cliente_id <> v_cli or v_ult.repuesto_at is not null then
    raise exception 'permiso denegado' using errcode = '42501';
  end if;
  v_suc := coalesce(p_sucursal_id, v_ult.sucursal_id);
  if v_suc is not null and not exists (
    select 1 from public.sucursales s where s.id = v_suc and s.cliente_id = v_cli
  ) then
    raise exception 'la sucursal no existe en la empresa: elegir otra' using errcode = '22023';
  end if;
  insert into public.perfiles (user_id, rol, cliente_id, sucursal_id, email)
  values (v_user, 'cliente', v_cli, v_suc, v_ult.email)
  on conflict (user_id) do nothing;
  if not found then
    raise exception 'permiso denegado' using errcode = '42501';
  end if;
  update public.accesos_quitados a set repuesto_por = v_uid, repuesto_at = now() where a.id = v_ult.id;
  return jsonb_build_object('estado', 'repuesto', 'repuesto_ahora', true, 'acceso_id', v_ult.id, 'user_id', v_user);
end
$$;
revoke all on function public.usuario_empresa_reponer_acceso(bigint, bigint) from public, anon;
grant execute on function public.usuario_empresa_reponer_acceso(bigint, bigint) to authenticated;

-- -----------------------------------------------------------------------------
-- 4. vehiculo_corregir_odometro
-- -----------------------------------------------------------------------------
-- Baja (o repite) el kilometraje de un vehículo del cliente del administrador de empresa. El alza sigue siendo
-- vehiculo_registrar_odometro. Autoriza SOLO al administrador de empresa del cliente dueño del vehículo (42501 para el
-- usuario de sucursal, otra empresa, api, sin perfil y el equipo Neumet: P1, el equipo Neumet solo mira). El rastro lo
-- deja trg_audit_vehiculos (audit_row): valor anterior, nuevo, actor y rol.
create or replace function public.vehiculo_corregir_odometro(p_vehiculo_id bigint, p_odometro_km integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_cli bigint;
  v_veh public.vehiculos%rowtype;
begin
  if auth.uid() is null then
    raise exception 'permiso denegado' using errcode = '42501';
  end if;
  v_cli := public.admin_empresa_cliente_id();
  if v_cli is null then
    raise exception 'permiso denegado' using errcode = '42501';
  end if;
  if p_vehiculo_id is null or p_odometro_km is null then
    raise exception 'parámetros obligatorios' using errcode = '22004';
  end if;
  select * into v_veh from public.vehiculos v
   where v.id = p_vehiculo_id and v.cliente_id = v_cli
     and exists (select 1 from public.clientes c where c.id = v.cliente_id and c.deleted_at is null)
   for update of v;
  if not found then
    raise exception 'permiso denegado' using errcode = '42501';
  end if;
  if p_odometro_km < 0 then
    raise exception 'odómetro negativo' using errcode = '23514';
  end if;
  if v_veh.odometro_km is null or p_odometro_km > v_veh.odometro_km then
    raise exception 'la corrección solo baja el kilometraje: para subirlo se registra el odómetro' using errcode = '23514';
  end if;
  update public.vehiculos v set odometro_km = p_odometro_km, odometro_actualizado_at = now() where v.id = v_veh.id;
  return jsonb_build_object('vehiculo_id', v_veh.id, 'odometro_km', p_odometro_km, 'anterior', v_veh.odometro_km);
end
$$;
revoke all on function public.vehiculo_corregir_odometro(bigint, integer) from public, anon;
grant execute on function public.vehiculo_corregir_odometro(bigint, integer) to authenticated;

-- -----------------------------------------------------------------------------
-- 5. alerta_configurar ampliada: todos los umbrales que el panel escribe y huella_absurda_mm
-- -----------------------------------------------------------------------------
-- Parámetro nulo = no cambia. Mantiene retiro < crítico < bajo (clientes_umbrales_ck) comparando con los valores
-- resultantes. La rama de admin (equipo Neumet) sigue hasta la migración C2 (docs/17): el front vigente la usa.
-- La firma cambia: se elimina la de tres parámetros (los llamadores con nombres o posiciones anteriores siguen válidos).
drop function if exists public.alerta_configurar(bigint, numeric, numeric);
create or replace function public.alerta_configurar(
  p_cliente_id         bigint,
  p_umbral_critico_mm  numeric default null,
  p_histeresis_mm      numeric default null,
  p_umbral_bajo_mm     numeric default null,
  p_umbral_retiro_mm   numeric default null,
  p_dias_sin_medir     integer default null,
  p_irregularidad_mm   numeric default null,
  p_huella_absurda_mm  numeric default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid      uuid := auth.uid();
  v_cli_id   bigint;
  v_c        public.clientes%rowtype;
  v_bajo     numeric;
  v_critico  numeric;
  v_retiro   numeric;
  v_abiertas bigint;
begin
  if v_uid is null then
    raise exception 'permiso denegado' using errcode = '42501';
  end if;
  if public.is_admin() then
    if p_cliente_id is null then
      raise exception 'parámetros obligatorios' using errcode = '22004';
    end if;
    v_cli_id := p_cliente_id;
  else
    v_cli_id := public.admin_empresa_cliente_id();
    if v_cli_id is null or (p_cliente_id is not null and p_cliente_id <> v_cli_id) then
      raise exception 'permiso denegado' using errcode = '42501';
    end if;
  end if;

  select * into v_c from public.clientes c where c.id = v_cli_id and c.deleted_at is null for update;
  if not found then
    raise exception 'permiso denegado' using errcode = '42501';
  end if;

  if p_umbral_critico_mm is null and p_histeresis_mm is null and p_umbral_bajo_mm is null and p_umbral_retiro_mm is null
     and p_dias_sin_medir is null and p_irregularidad_mm is null and p_huella_absurda_mm is null then
    raise exception 'parámetros obligatorios' using errcode = '22004';
  end if;

  -- Milímetros: un decimal, mayor que 0 y hasta 99,9 (igual que el panel, assets/js/domain/umbrales.js)
  if p_umbral_critico_mm is not null and (p_umbral_critico_mm <> round(p_umbral_critico_mm, 1)) then
    raise exception 'el umbral admite un decimal' using errcode = '22023';
  end if;
  if p_umbral_bajo_mm is not null and (p_umbral_bajo_mm <> round(p_umbral_bajo_mm, 1)) then
    raise exception 'el umbral admite un decimal' using errcode = '22023';
  end if;
  if p_umbral_retiro_mm is not null and (p_umbral_retiro_mm <> round(p_umbral_retiro_mm, 1)) then
    raise exception 'el umbral admite un decimal' using errcode = '22023';
  end if;
  if p_irregularidad_mm is not null and (p_irregularidad_mm <> round(p_irregularidad_mm, 1)) then
    raise exception 'la irregularidad admite un decimal' using errcode = '22023';
  end if;
  if p_huella_absurda_mm is not null and (p_huella_absurda_mm <> round(p_huella_absurda_mm, 1)) then
    raise exception 'la huella admite un decimal' using errcode = '22023';
  end if;
  if (p_umbral_bajo_mm is not null and (p_umbral_bajo_mm <= 0 or p_umbral_bajo_mm > 99.9))
     or (p_umbral_retiro_mm is not null and (p_umbral_retiro_mm <= 0 or p_umbral_retiro_mm > 99.9))
     or (p_umbral_critico_mm is not null and (p_umbral_critico_mm <= 0 or p_umbral_critico_mm > 99.9)) then
    raise exception 'los umbrales van de 0,1 a 99,9 mm' using errcode = '23514';
  end if;
  if p_irregularidad_mm is not null and (p_irregularidad_mm <= 0 or p_irregularidad_mm > 99.9) then
    raise exception 'la irregularidad va de 0,1 a 99,9 mm' using errcode = '23514';
  end if;
  if p_huella_absurda_mm is not null and (p_huella_absurda_mm <= 0 or p_huella_absurda_mm > 40) then
    raise exception 'la huella absurda va de 0,1 a 40 mm' using errcode = '23514';
  end if;
  if p_dias_sin_medir is not null and (p_dias_sin_medir < 1 or p_dias_sin_medir > 3650) then
    raise exception 'los días sin medir van de 1 a 3650' using errcode = '23514';
  end if;
  if p_histeresis_mm is not null then
    if p_histeresis_mm <> round(p_histeresis_mm, 1) or p_histeresis_mm < 0 or p_histeresis_mm > 3 then
      raise exception 'la histéresis va de 0 a 3 mm, con un decimal' using errcode = '23514';
    end if;
  end if;

  v_bajo    := coalesce(p_umbral_bajo_mm,    v_c.umbral_bajo_mm);
  v_critico := coalesce(p_umbral_critico_mm, v_c.umbral_critico_mm);
  v_retiro  := coalesce(p_umbral_retiro_mm,  v_c.umbral_retiro_mm);
  if not (v_retiro < v_critico and v_critico < v_bajo) then
    raise exception 'el nivel crítico debe quedar entre el de retiro (% mm) y el de desgaste bajo (% mm)', v_retiro, v_bajo
      using errcode = '23514';
  end if;

  update public.clientes c
     set umbral_bajo_mm        = v_bajo,
         umbral_critico_mm     = v_critico,
         umbral_retiro_mm      = v_retiro,
         dias_sin_medir_alerta = coalesce(p_dias_sin_medir, c.dias_sin_medir_alerta),
         irregularidad_mm      = coalesce(p_irregularidad_mm, c.irregularidad_mm),
         alerta_histeresis_mm  = coalesce(p_histeresis_mm, c.alerta_histeresis_mm),
         huella_absurda_mm     = coalesce(p_huella_absurda_mm, c.huella_absurda_mm)
   where c.id = v_c.id;

  select count(*) into v_abiertas from public.alertas a where a.cliente_id = v_c.id and a.estado <> 'resuelta';
  select * into v_c from public.clientes c where c.id = v_c.id;
  return jsonb_build_object('cliente_id', v_c.id, 'umbral_critico_mm', v_c.umbral_critico_mm,
                            'histeresis_mm', v_c.alerta_histeresis_mm, 'umbral_bajo_mm', v_c.umbral_bajo_mm,
                            'umbral_retiro_mm', v_c.umbral_retiro_mm, 'dias_sin_medir_alerta', v_c.dias_sin_medir_alerta,
                            'irregularidad_mm', v_c.irregularidad_mm, 'huella_absurda_mm', v_c.huella_absurda_mm,
                            'alertas_abiertas', v_abiertas);
end
$$;
revoke all on function public.alerta_configurar(bigint, numeric, numeric, numeric, numeric, integer, numeric, numeric) from public, anon;
grant execute on function public.alerta_configurar(bigint, numeric, numeric, numeric, numeric, integer, numeric, numeric) to authenticated;

-- -----------------------------------------------------------------------------
-- 6. audit_row: rótulo del actor por alcance
-- -----------------------------------------------------------------------------
-- 'cliente' se desdobla en 'admin_empresa' (sin sucursal) y 'sucursal'. Las RPC que insertan en audit_log por su cuenta
-- (stock, calidad de datos, gestión de sucursales) conservan su rótulo 'cliente': no se reescriben aquí.
create or replace function public.audit_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_rol text;
  v_suc bigint;
  v_old jsonb := case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) end;
  v_new jsonb := case when tg_op in ('INSERT','UPDATE') then to_jsonb(new) end;
begin
  if v_uid is not null then
    select p.rol, p.sucursal_id into v_rol, v_suc from public.perfiles p where p.user_id = v_uid;
    if v_rol = 'cliente' then
      v_rol := case when v_suc is null then 'admin_empresa' else 'sucursal' end;
    end if;
  end if;
  insert into public.audit_log (actor_id, actor_rol, accion, entidad, entidad_id, antes, despues)
  values (
    v_uid,
    coalesce(v_rol, case when v_uid is null then 'sistema' else 'sin_perfil' end),
    tg_op,
    tg_table_name,
    coalesce(v_new ->> 'id', v_old ->> 'id'),
    v_old,
    v_new
  );
  return null; -- AFTER trigger
end
$$;
revoke all on function public.audit_row() from public, anon, authenticated;
