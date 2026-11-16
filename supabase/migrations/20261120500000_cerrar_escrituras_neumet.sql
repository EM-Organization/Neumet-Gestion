-- =============================================================================
-- NEUMET · Migración C2 del plan de roles (docs/17 §4.1 y §9, PR 11): el equipo Neumet queda sin escritura directa
-- =============================================================================
-- Requiere 20261120000000_precio_mensual_rpc.sql (C1) y los PR 9 y 10 del front ya fusionados: Balance usa las RPC de
-- precio y ningún flujo del panel escribe como admin salvo los que aquí se conservan (docs/17 §4.3).
-- Sin begin/commit; idempotente (el CI la aplica dos veces).
--
-- Qué hace (P1: el equipo Neumet mira, no opera dentro de una empresa):
--  1. Quita la rama de admin (is_admin()) de las RPC de escritura: se recorta en los siete helpers de autorización y
--     en las funciones que además tenían rama directa. El admin recibe 42501 de manera uniforme (también ante un id
--     inexistente: ya no se distingue «no existe» de «no autorizado»). La lectura del admin no se toca.
--     Se conservan `asignar_dispositivo_a_cliente` y `cliente_eliminar_suave` (RPC de plataforma) y las RPC de
--     lectura con rama de admin (precios, costos, km_tramos_cubierta, cuentas_api_listar, get_unregistered_devices).
--  2. Escritura directa por PostgREST: `*_admin_all` (FOR ALL) pasa a `*_admin_select` en clientes, neumaticos,
--     eventos_neumatico, perfiles, stock_neumaticos, sucursales y vehiculos; más `clientes_admin_update` (FOR UPDATE).
--     Se conservan `dispositivos_admin_all` y `gastos_admin_all` (hardware y contabilidad de la plataforma).
--  3. Privilegios: revoke insert/update/delete/truncate a authenticated en esas siete tablas y en las vistas de
--     public (defensa en profundidad: una política futura mal escrita no reabre la escritura).
--  4. `clientes` por columna: sin `precio_mensual` en el SELECT (se lee y fija con las RPC de C1, solo admin) y
--     UPDATE solo de `nombre` (`auth_user_id` no: la cuenta dueña no se reasigna por la API). Los umbrales los escribe únicamente `alerta_configurar`.
--  Las Edge Functions con clave de servicio y las RPC SECURITY DEFINER no pasan por estas políticas ni grants.
-- =============================================================================

-- Tiempo máximo de espera de bloqueos: revoke, DROP POLICY y CREATE POLICY toman ACCESS EXCLUSIVE sobre siete tablas en
-- producción (única base). Sin tope, una transacción larga ajena haría esperar la migración y, detrás de ella, a todas
-- las lecturas de la API. Con 5 s la migración falla limpiamente (se revierte entera) y se reintenta.
-- `set local` solo rige dentro de una transacción explícita (fuera de ella avisa y no hace nada); este archivo no lleva
-- begin/commit y lo ejecutan por igual el runner (`psql -1`) y `supabase db push`, así que se usa `set` de sesión y se
-- devuelve con `reset` al final (si algo falla, el rollback de la transacción también revierte el `set`).
set lock_timeout = '5s';

-- -----------------------------------------------------------------------------
-- 1. RPC: se quita la rama de admin de escritura (cuerpos tomados de la última versión de cada función)
-- -----------------------------------------------------------------------------
create or replace function public.neumatico_autorizar_vehiculo(p_vehiculo_id bigint)
 RETURNS TABLE(cliente_id bigint, es_admin boolean, es_global boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
declare
  v_uid  uuid := auth.uid();
  v_veh  public.vehiculos%rowtype;
  v_perf public.perfiles%rowtype;
begin
  if v_uid is null then
    raise exception 'permiso denegado' using errcode = '42501';
  end if;
  if p_vehiculo_id is null then
    raise exception 'parámetros obligatorios' using errcode = '22004';
  end if;

  select * into v_perf from public.perfiles p where p.user_id = v_uid and p.rol = 'cliente';
  if not found or v_perf.cliente_id is null then
    raise exception 'permiso denegado' using errcode = '42501';
  end if;

  select * into v_veh from public.vehiculos v
   where v.id = p_vehiculo_id
     and v.cliente_id = v_perf.cliente_id
     and (v_perf.sucursal_id is null or v.sucursal_id = v_perf.sucursal_id)
     and exists (select 1 from public.clientes c where c.id = v.cliente_id and c.deleted_at is null)
     for update of v;
  if not found then
    raise exception 'permiso denegado' using errcode = '42501';
  end if;
  return query select v_veh.cliente_id, false, (v_perf.sucursal_id is null);
end
$$;

create or replace function public.sucursal_autorizar_gestion(p_cliente_id bigint)
 RETURNS TABLE(cliente_id bigint, es_admin boolean)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
declare
  v_uid  uuid := auth.uid();
  v_perf public.perfiles%rowtype;
begin
  if v_uid is null then
    raise exception 'permiso denegado' using errcode = '42501';
  end if;

  select * into v_perf from public.perfiles p where p.user_id = v_uid and p.rol = 'cliente';
  -- Solo el perfil GLOBAL gestiona sucursales; el de sucursal queda fuera.
  if not found or v_perf.cliente_id is null or v_perf.sucursal_id is not null
     or (p_cliente_id is not null and p_cliente_id <> v_perf.cliente_id)
     or not exists (select 1 from public.clientes c where c.id = v_perf.cliente_id and c.deleted_at is null) then
    raise exception 'permiso denegado' using errcode = '42501';
  end if;
  return query select v_perf.cliente_id, false;
end
$$;

create or replace function public.sucursal_autorizar_por_id(p_sucursal_id bigint)
 RETURNS TABLE(cliente_id bigint, nombre text)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
declare
  v_suc public.sucursales%rowtype;
  v_aut record;
begin
  if p_sucursal_id is null then
    raise exception 'parámetros obligatorios' using errcode = '22004';
  end if;
  select * into v_suc from public.sucursales s where s.id = p_sucursal_id;
  if not found then
    raise exception 'permiso denegado' using errcode = '42501';
  end if;
  select * into v_aut from public.sucursal_autorizar_gestion(v_suc.cliente_id);
  -- Bloquea la fila: serializa renombrar/eliminar contra ella.
  select * into v_suc from public.sucursales s where s.id = p_sucursal_id for update;
  if not found then
    raise exception 'permiso denegado' using errcode = '42501';
  end if;
  return query select v_suc.cliente_id, v_suc.nombre;
end
$$;

create or replace function public.stock_cubierta_autorizar_por_id(p_id bigint)
 RETURNS SETOF neumaticos
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
declare
  v_n    public.neumaticos%rowtype;
  v_aut  record;
begin
  if p_id is null then
    raise exception 'parámetros obligatorios' using errcode = '22004';
  end if;
  select * into v_n from public.neumaticos n where n.id = p_id;
  if not found then
    raise exception 'permiso denegado' using errcode = '42501';
  end if;
  select * into v_aut from public.sucursal_autorizar_gestion(v_n.cliente_id);
  select * into v_n from public.neumaticos n where n.id = p_id for update;
  if not found then
    raise exception 'permiso denegado' using errcode = '42501';
  end if;
  if v_n.vehiculo_id is not null then
    raise exception 'la cubierta está montada en un vehículo: no se gestiona desde el stock' using errcode = '55000';
  end if;
  return next v_n;
end
$$;

create or replace function public.recauchutado_autorizar(p_id bigint)
 RETURNS recauchutados
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
declare
  v_r   public.recauchutados%rowtype;
  v_aut record;
begin
  if p_id is null then
    raise exception 'parámetros obligatorios' using errcode = '22004';
  end if;
  select * into v_r from public.recauchutados r where r.id = p_id;
  if not found then
    raise exception 'permiso denegado' using errcode = '42501';
  end if;
  select * into v_aut from public.sucursal_autorizar_gestion(v_r.cliente_id);
  select * into v_r from public.recauchutados r where r.id = p_id for update;
  perform 1 from public.neumaticos n where n.id = v_r.neumatico_id for update;
  perform set_config('neumet.recauchutado', 'on', true);
  return v_r;
end
$$;

create or replace function public.medicion_autorizar(p_medicion_id bigint)
 RETURNS mediciones
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
declare
  v_uid  uuid := auth.uid();
  v_m    public.mediciones%rowtype;
  v_perf public.perfiles%rowtype;
begin
  if v_uid is null then
    raise exception 'permiso denegado' using errcode = '42501';
  end if;
  if p_medicion_id is null then
    raise exception 'parámetros obligatorios' using errcode = '22004';
  end if;
  select * into v_perf from public.perfiles p where p.user_id = v_uid and p.rol = 'cliente';
  if not found or v_perf.cliente_id is null then
    raise exception 'permiso denegado' using errcode = '42501';
  end if;
  select * into v_m from public.mediciones m
   where m.id = p_medicion_id and m.cliente_id = v_perf.cliente_id
     and exists (select 1 from public.clientes c where c.id = m.cliente_id and c.deleted_at is null)
     and (v_perf.sucursal_id is null
          or exists (select 1 from public.vehiculos v
                      where v.id = m.vehiculo_id and v.cliente_id = m.cliente_id and v.sucursal_id = v_perf.sucursal_id))
   for update of m;
  if not found then
    raise exception 'permiso denegado' using errcode = '42501';
  end if;
  return v_m;
end
$$;

create or replace function public.alerta_cargar(p_alerta_id bigint)
 RETURNS alertas
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
declare
  v_a public.alertas%rowtype;
begin
  if auth.uid() is null then
    raise exception 'permiso denegado' using errcode = '42501';
  end if;
  if p_alerta_id is null then
    raise exception 'parámetros obligatorios' using errcode = '22004';
  end if;
  select * into v_a from public.alertas where id = p_alerta_id;
  if not found then
    raise exception 'permiso denegado' using errcode = '42501';
  end if;
  -- Autoriza y bloquea el vehículo (serializa con cambios y rotaciones). Lanza 42501 si no corresponde.
  perform 1 from public.neumatico_autorizar_vehiculo(v_a.vehiculo_id);
  -- Relee con bloqueo: el vehículo pudo cambiar mientras tanto (la alerta sigue al neumático).
  select * into v_a from public.alertas where id = p_alerta_id for update;
  if not found then
    raise exception 'permiso denegado' using errcode = '42501';
  end if;
  return v_a;
end
$$;

create or replace function public.alerta_configurar(p_cliente_id bigint, p_umbral_critico_mm numeric DEFAULT NULL::numeric, p_histeresis_mm numeric DEFAULT NULL::numeric, p_umbral_bajo_mm numeric DEFAULT NULL::numeric, p_umbral_retiro_mm numeric DEFAULT NULL::numeric, p_dias_sin_medir integer DEFAULT NULL::integer, p_irregularidad_mm numeric DEFAULT NULL::numeric, p_huella_absurda_mm numeric DEFAULT NULL::numeric)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
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
  v_cli_id := public.admin_empresa_cliente_id();
  if v_cli_id is null or (p_cliente_id is not null and p_cliente_id <> v_cli_id) then
    raise exception 'permiso denegado' using errcode = '42501';
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

create or replace function public.costo_registrar(p_neumatico_id bigint, p_concepto text, p_monto numeric, p_fecha date DEFAULT NULL::date, p_notas text DEFAULT NULL::text, p_moneda text DEFAULT 'UYU'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
declare
  v_n        public.neumaticos%rowtype;
  v_aut      record;
  v_concepto text := lower(btrim(coalesce(p_concepto, '')));
  v_moneda   text := upper(btrim(coalesce(p_moneda, 'UYU')));
  v_fecha    date := coalesce(p_fecha, current_date);
  v_notas    text := nullif(btrim(coalesce(p_notas, '')), '');
  v_monto    numeric;
  v_vida     smallint;
  v_id       bigint;
begin
  select * into v_n from public.neumaticos n where n.id = p_neumatico_id;
  if not found then
    raise exception 'permiso denegado' using errcode = '42501';
  end if;
  select * into v_aut from public.sucursal_autorizar_gestion(v_n.cliente_id);

  if v_concepto not in ('compra', 'reparacion', 'recauchutado', 'montaje', 'otro') then
    raise exception 'concepto inválido' using errcode = '23514';
  end if;
  if p_monto is null then
    raise exception 'monto obligatorio' using errcode = '22004';
  end if;
  if p_monto = 'NaN'::numeric or p_monto < 0 then
    raise exception 'monto inválido: debe ser mayor o igual a 0' using errcode = '23514';
  end if;
  v_monto := round(p_monto, 2);
  if v_monto > 9999999999.99 then
    raise exception 'monto fuera de rango' using errcode = '22003';
  end if;
  if v_moneda !~ '^[A-Z]{3}$' then
    raise exception 'moneda inválida: código de 3 letras' using errcode = '23514';
  end if;
  if v_fecha > current_date + 1 or v_fecha < date '2000-01-01' then
    raise exception 'fecha inválida' using errcode = '23514';
  end if;
  if v_notas is not null and length(v_notas) > 500 then
    raise exception 'notas demasiado largas (máximo 500 caracteres)' using errcode = '23514';
  end if;

  v_vida := case when v_concepto = 'compra'
                 then greatest(v_n.vida - (select count(*) from public.eventos_neumatico e
                                            where e.neumatico_id = v_n.id and e.tipo = 'reencauche'), 0)
                 else v_n.vida end;
  insert into public.costos_neumatico (cliente_id, neumatico_id, concepto, monto, moneda, fecha, notas, vida, created_by)
  values (v_n.cliente_id, v_n.id, v_concepto, v_monto, v_moneda, v_fecha, v_notas, v_vida, auth.uid())
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'neumatico_id', v_n.id, 'concepto', v_concepto, 'monto', v_monto,
                            'moneda', v_moneda, 'fecha', v_fecha);
end
$$;

create or replace function public.costo_eliminar(p_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
declare
  v_c   public.costos_neumatico%rowtype;
  v_aut record;
begin
  select * into v_c from public.costos_neumatico c where c.id = p_id;
  if not found then
    raise exception 'permiso denegado' using errcode = '42501';
  end if;
  select * into v_aut from public.sucursal_autorizar_gestion(v_c.cliente_id);
  delete from public.costos_neumatico c where c.id = v_c.id;
  return jsonb_build_object('id', v_c.id, 'neumatico_id', v_c.neumatico_id);
end
$$;

create or replace function public.recauchutado_enviar(p_neumatico_id bigint, p_proveedor text, p_fecha date DEFAULT NULL::date, p_notas text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
declare
  v_n         public.neumaticos%rowtype;
  v_aut       record;
  v_proveedor text := nullif(btrim(coalesce(p_proveedor, '')), '');
  v_notas     text := nullif(btrim(coalesce(p_notas, '')), '');
  v_fecha     date;
  v_id        bigint;
begin
  select * into v_n from public.neumaticos n where n.id = p_neumatico_id;
  if not found then
    raise exception 'permiso denegado' using errcode = '42501';
  end if;
  select * into v_aut from public.sucursal_autorizar_gestion(v_n.cliente_id);
  select * into v_n from public.neumaticos n where n.id = p_neumatico_id for update;

  if v_proveedor is null then
    raise exception 'indicar el proveedor' using errcode = '22023';
  end if;
  if length(v_proveedor) > 80 then
    raise exception 'proveedor demasiado largo (máximo 80 caracteres)' using errcode = '22023';
  end if;
  if v_notas is not null and length(v_notas) > 500 then
    raise exception 'notas demasiado largas (máximo 500 caracteres)' using errcode = '23514';
  end if;
  v_fecha := public.recauchutado_validar_fecha(p_fecha);
  if v_n.estado = 'montado' then
    raise exception 'la cubierta está montada: retirarla del vehículo antes de enviarla' using errcode = '55000';
  end if;
  if v_n.estado <> 'almacenado' then
    raise exception 'la cubierta no está disponible (estado %)', v_n.estado using errcode = '55000';
  end if;
  if v_n.vida >= 3 then
    raise exception 'la carcasa ya alcanzó la vida máxima (3 recauchutados)' using errcode = '23514';
  end if;
  if exists (select 1 from public.recauchutados r
              where r.neumatico_id = v_n.id and r.estado in ('enviado', 'apto')) then
    raise exception 'la cubierta ya está en recauchutado' using errcode = '55000';
  end if;

  perform set_config('neumet.recauchutado', 'on', true);
  -- Sale de donde estuviera (stock o posición de aparcamiento) y queda «en el proveedor»: sin vehículo ni sucursal.
  update public.neumaticos
     set vehiculo_id = null, posicion = null, auxilio = false, sucursal_id = null
   where id = v_n.id;
  insert into public.recauchutados
    (cliente_id, neumatico_id, idneumatico, numero_quema, marca, modelo, vida_origen, proveedor, fecha_envio,
     sucursal_origen_id, notas, created_by)
  values (v_n.cliente_id, v_n.id, v_n.idneumatico, v_n.numero_quema, v_n.marca, v_n.modelo, v_n.vida, v_proveedor,
          v_fecha, v_n.sucursal_id, v_notas, auth.uid())
  returning id into v_id;
  insert into public.eventos_neumatico
    (cliente_id, vehiculo_id, neumatico_id, idneumatico, tipo, sucursal_origen_id, notas, created_by)
  values (v_n.cliente_id, null, v_n.id, v_n.idneumatico, 'envio_recauchutado', v_n.sucursal_id,
          'Enviado a recauchutar: ' || v_proveedor, auth.uid());

  perform set_config('neumet.recauchutado', '', true);
  return jsonb_build_object('id', v_id, 'neumatico_id', v_n.id, 'estado', 'enviado', 'proveedor', v_proveedor,
                            'fecha_envio', v_fecha);
end
$$;

create or replace function public.stock_cubierta_editar(p_id bigint, p_datos jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
declare
  v_n      public.neumaticos%rowtype;
  v_marca  text;
  v_modelo text;
  v_fecha  date;
  v_precio numeric(12,2);
  v_cond   text;
  v_k      text;
  v_txt    text;
begin
  select * into v_n from public.stock_cubierta_autorizar_por_id(p_id);
  if p_datos is null or jsonb_typeof(p_datos) <> 'object' then
    raise exception 'datos inválidos' using errcode = '22023';
  end if;
  for v_k in select jsonb_object_keys(p_datos) loop
    if v_k not in ('marca', 'modelo', 'fecha_compra', 'precio', 'condicion') then
      raise exception 'campo no editable: %', v_k using errcode = '22023';
    end if;
  end loop;

  v_marca := v_n.marca; v_modelo := v_n.modelo; v_fecha := v_n.fecha_compra;
  v_precio := v_n.precio_unidad; v_cond := v_n.condicion;

  if p_datos ? 'marca' then
    if jsonb_typeof(p_datos -> 'marca') <> 'string' then
      raise exception 'marca inválida' using errcode = '22023';
    end if;
    v_marca := nullif(btrim(p_datos ->> 'marca'), '');
    if v_marca is null then
      raise exception 'indicar la marca' using errcode = '22023';
    end if;
  end if;
  if p_datos ? 'modelo' then
    if jsonb_typeof(p_datos -> 'modelo') not in ('string', 'null') then
      raise exception 'modelo inválido' using errcode = '22023';
    end if;
    v_modelo := nullif(btrim(coalesce(p_datos ->> 'modelo', '')), '');
  end if;
  if length(v_marca) > 60 or length(coalesce(v_modelo, '')) > 60 then
    raise exception 'marca o modelo demasiado largos (máx. 60)' using errcode = '22023';
  end if;
  if p_datos ? 'fecha_compra' then
    if jsonb_typeof(p_datos -> 'fecha_compra') not in ('string', 'null') then
      raise exception 'fecha de compra inválida' using errcode = '22023';
    end if;
    v_fecha := nullif(btrim(coalesce(p_datos ->> 'fecha_compra', '')), '')::date;
    if v_fecha > current_date + 1 then
      raise exception 'la fecha de compra no puede ser futura' using errcode = '23514';
    end if;
  end if;
  if p_datos ? 'precio' then
    if jsonb_typeof(p_datos -> 'precio') not in ('number', 'null') then
      raise exception 'precio inválido' using errcode = '22023';
    end if;
    v_txt := p_datos ->> 'precio';
    if v_txt is null then
      v_precio := null;
    else
      if v_txt::numeric < 0 or v_txt::numeric >= 10000000000 then
        raise exception 'precio fuera de rango' using errcode = '23514';
      end if;
      v_precio := round(v_txt::numeric, 2);
    end if;
  end if;
  if p_datos ? 'condicion' then
    if jsonb_typeof(p_datos -> 'condicion') <> 'string'
       or (p_datos ->> 'condicion') not in ('reparado', 'recauchutado') then
      raise exception 'condición inválida: solo reparado o recauchutado' using errcode = '22023';
    end if;
    v_cond := p_datos ->> 'condicion';
  end if;

  update public.neumaticos
     set marca = v_marca, modelo = v_modelo, fecha_compra = v_fecha, precio_unidad = v_precio, condicion = v_cond
   where id = p_id;

  if v_cond is distinct from v_n.condicion then
    insert into public.eventos_neumatico
      (cliente_id, vehiculo_id, neumatico_id, idneumatico, tipo, notas, created_by)
    values (v_n.cliente_id, null, v_n.id, v_n.idneumatico, 'cambio_condicion',
            'Condición: ' || v_n.condicion || ' → ' || v_cond, auth.uid());
  end if;
  insert into public.audit_log (actor_id, actor_rol, accion, entidad, entidad_id, antes, despues)
  values (auth.uid(), 'cliente',
          'STOCK_CUBIERTA_EDITAR', 'neumaticos', p_id::text,
          jsonb_build_object('marca', v_n.marca, 'modelo', v_n.modelo, 'fecha_compra', v_n.fecha_compra,
                             'precio_unidad', v_n.precio_unidad, 'condicion', v_n.condicion),
          jsonb_build_object('marca', v_marca, 'modelo', v_modelo, 'fecha_compra', v_fecha,
                             'precio_unidad', v_precio, 'condicion', v_cond, 'cliente_id', v_n.cliente_id));
  return jsonb_build_object('id', p_id, 'cliente_id', v_n.cliente_id, 'condicion', v_cond);
end
$$;

create or replace function public.stock_cubierta_eliminar(p_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
declare
  v_n      public.neumaticos%rowtype;
begin
  select * into v_n from public.stock_cubierta_autorizar_por_id(p_id);
  if exists (select 1 from public.mediciones m where m.idneumatico = v_n.idneumatico)
     or exists (select 1 from public.eventos_neumatico e
                 where e.neumatico_id = v_n.id
                   and e.tipo not in ('alta_stock', 'traslado', 'cambio_condicion')) then
    raise exception 'la cubierta ya tuvo uso (montajes, mediciones o eventos): no se puede eliminar' using errcode = '55000';
  end if;
  insert into public.audit_log (actor_id, actor_rol, accion, entidad, entidad_id, antes, despues)
  values (auth.uid(), 'cliente',
          'STOCK_CUBIERTA_ELIMINAR', 'neumaticos', p_id::text, to_jsonb(v_n), null);
  delete from public.eventos_neumatico where neumatico_id = v_n.id;
  delete from public.neumaticos where id = v_n.id;
  return jsonb_build_object('id', p_id, 'cliente_id', v_n.cliente_id, 'numero_quema', v_n.numero_quema);
end
$$;

create or replace function public.stock_cubierta_mover(p_id bigint, p_sucursal_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
declare
  v_n      public.neumaticos%rowtype;
  v_orig   text;
  v_dest   text;
begin
  select * into v_n from public.stock_cubierta_autorizar_por_id(p_id);
  v_dest := public.stock_cubierta_sucursal(v_n.cliente_id, p_sucursal_id);
  if v_n.sucursal_id is not distinct from p_sucursal_id then
    return jsonb_build_object('id', p_id, 'anterior', v_n.sucursal_id, 'nueva', p_sucursal_id, 'movido', false);
  end if;
  select s.nombre into v_orig from public.sucursales s where s.id = v_n.sucursal_id;

  update public.neumaticos set sucursal_id = p_sucursal_id where id = p_id;
  insert into public.eventos_neumatico
    (cliente_id, vehiculo_id, neumatico_id, idneumatico, tipo, sucursal_origen_id, sucursal_destino_id, notas, created_by)
  values (v_n.cliente_id, null, v_n.id, v_n.idneumatico, 'traslado', v_n.sucursal_id, p_sucursal_id,
          'Traslado: ' || coalesce(v_orig, 'sin sucursal') || ' → ' || coalesce(v_dest, 'sin sucursal'), auth.uid());
  insert into public.audit_log (actor_id, actor_rol, accion, entidad, entidad_id, antes, despues)
  values (auth.uid(), 'cliente',
          'MOVER_SUCURSAL', 'neumaticos', p_id::text,
          jsonb_build_object('sucursal_id', v_n.sucursal_id),
          jsonb_build_object('sucursal_id', p_sucursal_id, 'cliente_id', v_n.cliente_id));
  return jsonb_build_object('id', p_id, 'anterior', v_n.sucursal_id, 'nueva', p_sucursal_id, 'movido', true);
end
$$;

create or replace function public.medicion_invalidar(p_medicion_id bigint, p_motivo text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
declare
  v_m      public.mediciones%rowtype;
  v_motivo text := nullif(btrim(coalesce(p_motivo, '')), '');
  v_rol    text;
begin
  v_m := public.medicion_autorizar(p_medicion_id);
  if v_motivo is null or length(v_motivo) < 3 then
    raise exception 'el motivo es obligatorio' using errcode = '22023';
  end if;
  if length(v_motivo) > 300 then
    raise exception 'motivo demasiado largo (máx. 300)' using errcode = '22023';
  end if;
  if v_m.calidad = 'invalidada' then
    return jsonb_build_object('id', v_m.id, 'calidad', 'invalidada', 'cambiado', false);
  end if;
  v_rol := 'cliente';
  update public.mediciones
     set calidad = 'invalidada', calidad_motivo = v_motivo, calidad_at = now(), calidad_por = auth.uid()::text
   where id = v_m.id;
  insert into public.audit_log (actor_id, actor_rol, accion, entidad, entidad_id, antes, despues)
  values (auth.uid(), v_rol, 'INVALIDAR_MEDICION', 'mediciones', v_m.id::text,
          jsonb_build_object('calidad', v_m.calidad, 'motivo', v_m.calidad_motivo, 'por', v_m.calidad_por),
          jsonb_build_object('calidad', 'invalidada', 'motivo', v_motivo, 'cliente_id', v_m.cliente_id));
  return jsonb_build_object('id', v_m.id, 'calidad', 'invalidada', 'cambiado', true);
end
$$;

create or replace function public.medicion_revalidar(p_medicion_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
declare
  v_m   public.mediciones%rowtype;
  v_rol text;
begin
  v_m := public.medicion_autorizar(p_medicion_id);
  if v_m.calidad = 'valida' then
    return jsonb_build_object('id', v_m.id, 'calidad', 'valida', 'cambiado', false);
  end if;
  v_rol := 'cliente';
  update public.mediciones
     set calidad = 'valida', calidad_motivo = null, calidad_at = now(), calidad_por = auth.uid()::text
   where id = v_m.id;
  insert into public.audit_log (actor_id, actor_rol, accion, entidad, entidad_id, antes, despues)
  values (auth.uid(), v_rol, 'REVALIDAR_MEDICION', 'mediciones', v_m.id::text,
          jsonb_build_object('calidad', v_m.calidad, 'motivo', v_m.calidad_motivo, 'por', v_m.calidad_por),
          jsonb_build_object('calidad', 'valida', 'cliente_id', v_m.cliente_id));
  return jsonb_build_object('id', v_m.id, 'calidad', 'valida', 'cambiado', true);
end
$$;

-- vehiculo_mover_sucursal: sin la etiqueta de admin en la auditoría (el helper ya no lo devuelve como autorizado)
create or replace function public.vehiculo_mover_sucursal(p_vehiculo_id bigint, p_sucursal_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_aut  record;
  v_veh  public.vehiculos%rowtype;
begin
  -- Autoriza y bloquea el vehículo (el perfil de sucursal recibe 42501 abajo).
  select * into v_aut from public.neumatico_autorizar_vehiculo(p_vehiculo_id);
  if not v_aut.es_global then
    raise exception 'permiso denegado' using errcode = '42501';
  end if;
  if p_sucursal_id is not null then
    perform 1 from public.sucursales s
     where s.id = p_sucursal_id and s.cliente_id = v_aut.cliente_id for share;
    if not found then
      raise exception 'permiso denegado' using errcode = '42501';
    end if;
  end if;

  select * into v_veh from public.vehiculos v where v.id = p_vehiculo_id;
  if v_veh.sucursal_id is not distinct from p_sucursal_id then
    return jsonb_build_object('vehiculo_id', p_vehiculo_id, 'anterior', v_veh.sucursal_id,
                              'nueva', p_sucursal_id, 'movido', false);
  end if;

  update public.vehiculos set sucursal_id = p_sucursal_id where id = p_vehiculo_id;
  insert into public.audit_log (actor_id, actor_rol, accion, entidad, entidad_id, antes, despues)
  values (auth.uid(), 'cliente',
          'MOVER_SUCURSAL', 'vehiculos', p_vehiculo_id::text,
          jsonb_build_object('sucursal_id', v_veh.sucursal_id),
          jsonb_build_object('sucursal_id', p_sucursal_id, 'cliente_id', v_aut.cliente_id));
  return jsonb_build_object('vehiculo_id', p_vehiculo_id, 'anterior', v_veh.sucursal_id,
                            'nueva', p_sucursal_id, 'movido', true);
end
$function$;

-- -----------------------------------------------------------------------------
-- 2. Políticas: el admin solo lee (salvo dispositivos y gastos, que conservan `*_admin_all`)
-- -----------------------------------------------------------------------------
do $$
declare
  r record;
begin
  for r in select * from (values
    ('clientes', 'clientes_admin_all', 'clientes_admin_select'),
    ('neumaticos', 'neumaticos_admin_all', 'neumaticos_admin_select'),
    ('eventos_neumatico', 'eventos_admin_all', 'eventos_admin_select'),
    ('perfiles', 'perfiles_admin_all', 'perfiles_admin_select'),
    ('stock_neumaticos', 'stock_admin_all', 'stock_admin_select'),
    ('sucursales', 'sucursales_admin_all', 'sucursales_admin_select'),
    ('vehiculos', 'vehiculos_admin_all', 'vehiculos_admin_select')
  ) as t(tabla, vieja, nueva)
  loop
    execute format('drop policy if exists %I on public.%I', r.vieja, r.tabla);
    execute format('drop policy if exists %I on public.%I', r.nueva, r.tabla);
    execute format('create policy %I on public.%I for select to authenticated using ((select public.is_admin()))',
                   r.nueva, r.tabla);
  end loop;
end $$;

-- Con solo FOR SELECT el UPDATE de `clientes.nombre` / `auth_user_id` afectaría 0 filas: la política por fila también
-- debe permitirlo (el grant por columna de la sección 4 limita qué columnas).
drop policy if exists clientes_admin_update on public.clientes;
create policy clientes_admin_update on public.clientes for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));

-- -----------------------------------------------------------------------------
-- 3. Privilegios de escritura
-- -----------------------------------------------------------------------------
revoke insert, update, delete, truncate on
  public.clientes, public.neumaticos, public.eventos_neumatico, public.perfiles,
  public.stock_neumaticos, public.sucursales, public.vehiculos
  from authenticated;

-- Vistas (security_invoker, no actualizables hoy): se cierra por higiene, un grant sobre una vista futura simple
-- pasaría por la tabla base con los privilegios del invocador.
do $$
declare
  r record;
begin
  for r in select c.relname from pg_class c
            where c.relnamespace = 'public'::regnamespace and c.relkind in ('v', 'm', 'f') loop
    execute format('revoke insert, update, delete, truncate on public.%I from authenticated, anon', r.relname);
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 4. clientes por columna
-- -----------------------------------------------------------------------------
-- Una política es por fila: para ocultar `precio_mensual` hace falta el privilegio por columna. Revocar el de tabla
-- revoca también los de columna; se otorgan de nuevo todas menos la sensible (mismo mecanismo que
-- 20261116500000_privilegios_precios.sql).
do $$
declare
  v_cols text;
begin
  revoke select, update on public.clientes from authenticated;
  select string_agg(quote_ident(a.attname), ', ' order by a.attnum) into v_cols
    from pg_attribute a
   where a.attrelid = 'public.clientes'::regclass and a.attnum > 0 and not a.attisdropped
     and a.attname <> 'precio_mensual';
  execute format('grant select (%s) on public.clientes to authenticated', v_cols);
  grant update (nombre) on public.clientes to authenticated;
end $$;

comment on column public.clientes.precio_mensual is
  'Sin SELECT ni UPDATE para authenticated (privilegios por columna): solo las RPC cliente_precios_mensuales() y cliente_precio_mensual_fijar() (equipo Neumet). docs/08 apéndice Q.';

reset lock_timeout;
